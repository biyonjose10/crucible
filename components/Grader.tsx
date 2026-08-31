"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MEDIAN } from "@/lib/assignment";
import { GraderPool } from "@/lib/grader-pool";
import { failureSignature, score, type ScoreReport } from "@/lib/scoring";
import { CLASS, DISTINCT_ARCHETYPES, type Submission } from "@/fixtures/class";
import { SubmissionCard } from "./SubmissionCard";
import { StatBar } from "./StatBar";
import { StudentView } from "./StudentView";
import { TryYourOwn } from "./TryYourOwn";
import { ClassInsights } from "./ClassInsights";
import { toCsv } from "@/lib/gradebook";
import type { Assignment } from "@/lib/types";

/** The shape /api/author returns. Failures arrive as values, never as a throw. */
interface AuthorResponse {
  ok: boolean;
  reason?: string;
  assignment?: Assignment;
  reference?: string;
}

export type RowState = "queued" | "running" | "done";

export interface Row {
  submission: Submission;
  state: RowState;
  report?: ScoreReport;
  /** Stable identifier for *how* this submission failed. Drives dedupe. */
  signature?: string;
  durationMs?: number;
}

type Phase = "idle" | "grading" | "complete";

/** How long the interpreter is given to boot before we admit something is wrong. */
const BOOT_TIMEOUT_MS = 90_000;

export function Grader({
  /**
   * The real import list of lib/scoring.ts, read at build time in app/page.tsx.
   * Rendered so the page can show the evidence for its own central claim rather
   * than only asserting it.
   */
  scoringImports = [],
}: {
  scoringImports?: string[];
}) {
  const poolRef = useRef<GraderPool | null>(null);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [boot, setBoot] = useState({ ready: 0, total: 2 });
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Submission id currently shown as the student would receive it. */
  const [studentView, setStudentView] = useState<string | null>(null);
  /**
   * A one-off submission typed by the visitor, graded the same way as the class.
   *
   * Carries its own assignment because it may have been graded against a
   * model-authored one rather than the seeded exercise — the student view and
   * the explanation both need the rubric the mark actually came from.
   */
  const [custom, setCustom] = useState<{
    submission: Submission;
    report: ScoreReport;
    assignment: Assignment;
  } | null>(null);

  const [rows, setRows] = useState<Row[]>(() =>
    CLASS.map((submission) => ({ submission, state: "queued" as const })),
  );

  // ── Interpreter lifecycle ────────────────────────────────────────────────
  // Boot while the user is still reading the page, so that pressing the button
  // starts grading rather than starting a download.
  useEffect(() => {
    const pool = new GraderPool({
      size: 2,
      execTimeoutMs: 5_000,
      bootTimeoutMs: BOOT_TIMEOUT_MS,
      onReady: (ready, total) => setBoot({ ready, total }),
    });
    poolRef.current = pool;

    let cancelled = false;
    pool
      .warm()
      .then(() => !cancelled && setBooted(true))
      .catch((err: unknown) =>
        !cancelled
          ? setBootError(err instanceof Error ? err.message : String(err))
          : undefined,
      );

    return () => {
      cancelled = true;
      pool.dispose();
      poolRef.current = null;
    };
  }, []);

  // ── Elapsed clock ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "grading" || startedAt === null) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  const gradeAll = useCallback(async () => {
    const pool = poolRef.current;
    if (!pool || phase === "grading") return;

    const t0 = Date.now();
    setPhase("grading");
    setStartedAt(t0);
    setElapsed(0);
    setExpanded(null);
    setRows(CLASS.map((submission) => ({ submission, state: "queued" as const })));

    const patch = (id: string, next: Partial<Row>) =>
      setRows((prev) =>
        prev.map((r) => (r.submission.id === id ? { ...r, ...next } : r)),
      );

    await Promise.all(
      CLASS.map(async (submission) => {
        patch(submission.id, { state: "running" });

        const outcome = await pool.run(submission.id, submission.code, MEDIAN.tests);
        // The grade is computed here, from execution, and nowhere else.
        const report = score(MEDIAN, outcome);

        patch(submission.id, {
          state: "done",
          report,
          signature: failureSignature(report),
          durationMs: outcome.durationMs,
        });
      }),
    );

    setElapsed(Date.now() - t0);
    setPhase("complete");
  }, [phase]);

  /**
   * Grade a single piece of code the visitor wrote.
   *
   * Same pool, same tests, same scoring function as the seeded class — the
   * point is that this path is not special. A fresh id per run keeps the
   * diagnosis memo from serving the previous attempt's explanation.
   */
  const gradeOne = useCallback(async (code: string, against: Assignment) => {
    const pool = poolRef.current;
    if (!pool) return;

    const id = `you-${Date.now()}`;
    const submission: Submission = {
      id,
      student: "You",
      archetype: "custom",
      code,
    };

    const outcome = await pool.run(id, code, against.tests);
    const report = score(against, outcome);

    setCustom({ submission, report, assignment: against });
    setStudentView(id);
  }, []);

  /**
   * Have a model write an assignment for `problem`, and refuse to use it unless
   * it survives being executed.
   *
   * The check is the whole point. `/api/author` returns a suite together with a
   * reference solution the model wrote alongside it, and that solution is run
   * here — in the visitor's own already-warm interpreter, at no cost and with
   * no server-side Python — against the very tests it shipped with. A suite its
   * own author cannot score full marks on is wrong, and grading a visitor
   * against wrong tests would produce exactly the meaningless mark this project
   * exists to rule out. So it is discarded rather than shown.
   *
   * One retry, carrying the reason back: a blind second attempt mostly
   * reproduces the first mistake, while naming the failing test usually fixes
   * it. After that the honest answer is that we could not build a fair test for
   * this problem.
   */
  const buildSuite = useCallback(
    async (
      problem: string,
      onProgress: (step: "authoring" | "checking") => void,
    ): Promise<Assignment | { error: string }> => {
      const pool = poolRef.current;
      if (!pool) return { error: "The interpreter is not ready yet." };

      let hint: string | undefined;

      for (let attempt = 0; attempt < 2; attempt++) {
        onProgress("authoring");

        let body: AuthorResponse;
        try {
          const response = await fetch("/api/author", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ problem, retryHint: hint }),
          });
          if (!response.ok) {
            return { error: await response.text() };
          }
          body = (await response.json()) as AuthorResponse;
        } catch {
          return {
            error:
              "Could not reach the server to write the tests. The median " +
              "exercise below still works — grading it needs no network.",
          };
        }

        if (!body.ok || !body.assignment || !body.reference) {
          return { error: body.reason ?? "The test suite could not be written." };
        }

        onProgress("checking");

        const outcome = await pool.run(
          `ref-${Date.now()}`,
          body.reference,
          body.assignment.tests,
        );
        const report = score(body.assignment, outcome);

        if (report.status === "graded" && report.earned === report.total) {
          return body.assignment;
        }

        hint =
          "Your reference solution scored " +
          `${report.earned}/${report.total} against your own tests. ` +
          report.clauses
            .flatMap((c) => c.results)
            .filter((r) => r.status !== "pass")
            .slice(0, 4)
            .map((r) => {
              const test = body.assignment!.tests.find((t) => t.id === r.id);
              return `${test?.expr ?? r.id} gave ${r.got ?? "no result"}, expected ${r.expected}`;
            })
            .join("; ");
      }

      return {
        error:
          "Couldn't build a reliable test suite for this problem. The " +
          "generated tests didn't agree with a known-good solution, so " +
          "grading you against them would be meaningless. Try rephrasing it, " +
          "or describing a single function more precisely.",
      };
    },
    [],
  );

  /**
   * Stable identity on purpose. An inline arrow here re-created the callback on
   * every Grader render, which tore down and re-ran the dialog's focus-trap
   * effect — pulling focus behind the modal and then slamming it back to the
   * Close button while a keyboard user was reading.
   */
  const closeStudentView = useCallback(() => setStudentView(null), []);

  /**
   * Back to the landing page.
   *
   * Resets every piece of run state rather than only `phase`, so a second run
   * starts from the same place the first one did. The pool is deliberately left
   * alone — it is warm, and re-booting Pyodide to return to a static page would
   * make the button feel broken.
   */
  const goHome = useCallback(() => {
    setPhase("idle");
    setRows(CLASS.map((submission) => ({ submission, state: "queued" as const })));
    setStartedAt(null);
    setElapsed(0);
    setExpanded(null);
    setStudentView(null);
    setCustom(null);
  }, []);

  const stats = useMemo(() => {
    const done = rows.filter((r) => r.state === "done" && r.report);
    const graded = done.filter((r) => r.report!.status === "graded");
    const inconclusive = done.filter((r) => r.report!.status === "inconclusive");
    const points = graded.reduce((sum, r) => sum + r.report!.earned, 0);

    // Distinct ways of being wrong, among submissions that lost marks.
    const signatures = new Set(
      done
        .filter((r) => r.report!.earned < r.report!.total)
        .map((r) => r.signature ?? ""),
    );

    return {
      done: done.length,
      total: rows.length,
      inconclusive: inconclusive.length,
      mean: graded.length ? points / graded.length : 0,
      distinctFailures: signatures.size,
    };
  }, [rows]);

  /**
   * How many submissions share each failure signature.
   *
   * This is the same hash that lets one diagnosis serve many students. Shown to
   * the instructor it stops being an efficiency trick and becomes the useful
   * question: which single mistake should Monday's lesson address.
   */
  const cohort = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.report || !r.signature) continue;
      if (r.report.earned === r.report.total) continue;
      counts.set(r.signature, (counts.get(r.signature) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  /**
   * The same clause results, counted across the cohort instead of per student.
   * Only outright failures count — an inconclusive clause is a question we did
   * not get to ask, not evidence that the class misunderstood it.
   */
  const clauseMisses = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of rows) {
      if (!r.report) continue;
      for (const c of r.report.clauses) {
        if (c.status === "fail") {
          counts.set(c.clause, (counts.get(c.clause) ?? 0) + 1);
        }
      }
    }
    return MEDIAN.clauses
      .map((c) => ({ clause: c.id, text: c.text, missed: counts.get(c.id) ?? 0 }))
      .sort((a, b) => b.missed - a.missed);
  }, [rows]);

  /** Gradebook as CSV. Held in memory only — nothing is uploaded anywhere. */
  const exportCsv = useCallback(() => {
    const csv = toCsv(
      rows
        .filter((r) => r.report)
        .map((r) => ({
          student: r.submission.student,
          report: r.report!,
          signature: r.signature,
          durationMs: r.durationMs,
        })),
    );

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${MEDIAN.slug}-gradebook.csv`;
    // Firefox ignores a click on a detached anchor, and cancels the download if
    // the object URL is revoked in the same tick. Attach, click, then clean up
    // on a later turn.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }, [rows]);

  return (
    <div className="flex flex-col min-h-full">
      <StatBar
        phase={phase}
        booted={booted}
        bootError={bootError}
        elapsed={elapsed}
        stats={stats}
        onHome={phase === "idle" ? undefined : goHome}
      />

      <main className="flex-1 w-full max-w-5xl mx-auto px-5 pb-24">
        {/* No mode="wait": the queue must mount as soon as grading starts. Gating
            it on the hero's exit animation means a throttled rAF (backgrounded tab,
            reduced motion, slow device) leaves a finished run showing the hero. */}
        <AnimatePresence>
          {phase === "idle" ? (
            <motion.section
              key="hero"
              // See SubmissionCard: no opacity gate. A judge opening this in a
              // background tab must not be shown a blank landing page.
              initial={{ y: 8 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="pt-24 pb-16"
            >
              <p className="font-mono text-xs tracking-widest text-faint uppercase">
                {MEDIAN.title}
              </p>
              <h1 className="mt-5 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08] max-w-2xl">
                The AI code grader that cannot set the grade.
              </h1>
              <p className="mt-6 text-muted max-w-xl leading-relaxed">
                Every submission runs in a real Python sandbox. The tests compute
                the score arithmetically. The model is shown only the failing
                traces, and writes the explanation — it has no way to change what
                a submission is worth.
              </p>

              {scoringImports.length > 0 && (
                <details className="mt-6 max-w-xl">
                  <summary className="cursor-pointer font-mono text-[11px] text-faint transition-colors hover:text-muted">
                    Why you can trust the score
                  </summary>
                  <div className="mt-3 rounded-lg border border-line bg-surface px-4 py-3">
                    <p className="text-[12px] leading-relaxed text-muted">
                      The grade is computed by{" "}
                      <code className="font-mono text-ink">lib/scoring.ts</code>,
                      a pure function from test results to a mark. Read at build
                      time, everything that file imports is:
                    </p>
                    <ul className="mt-2.5 space-y-1">
                      {scoringImports.map((i) => (
                        <li key={i} className="font-mono text-[12px] text-pass">
                          {i}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
                      No model, no network, no API client. This list is extracted
                      from the file itself, so wiring a model into the grading
                      path would change what you are reading right now.
                    </p>
                  </div>
                </details>
              )}

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <button
                  onClick={gradeAll}
                  disabled={!booted || phase !== "idle"}
                  className="group relative px-5 py-3 rounded-lg bg-ink text-bg font-medium
                             transition-all duration-200
                             hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(255,255,255,0.35)]
                             active:translate-y-0
                             disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                >
                  Grade a sample class of {CLASS.length}
                </button>

                <span className="font-mono text-xs text-faint">
                  {bootError
                    ? "sandbox unavailable"
                    : booted
                      ? "no login · no API key · runs in your browser"
                      : `starting Python… ${boot.ready}/${boot.total} ready`}
                </span>

                {/* The second path, stated on the first screen.
                    "Or grade something of your own" lives below the stat grid,
                    which is a bordered box and therefore reads as the end of the
                    page — so a visitor who never scrolls never learns they can
                    run their own code, which is the answer to "did you rig the
                    eight cases?". A plain anchor, so it works without JS and
                    leaves the next Tab stop inside the section it points at.
                    Sits in this row rather than on a line of its own: the fold
                    is the whole problem here, and this costs no extra height. */}
                <a
                  href="#try-your-own"
                  className="font-mono text-xs text-muted underline decoration-line
                             underline-offset-4 transition-colors hover:text-ink
                             hover:decoration-muted"
                >
                  or paste your own code ↓
                </a>
              </div>

              {bootError && (
                <div className="mt-8 max-w-xl rounded-lg border border-fail/30 bg-fail-dim px-4 py-3">
                  <p className="font-mono text-[12px] text-fail">
                    The Python sandbox could not start.
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                    Crucible downloads a real CPython interpreter (about 13 MB)
                    and runs it in your browser, so a blocked or very slow
                    connection will stop it. Reloading usually fixes it.
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-faint">
                    {bootError}
                  </p>
                </div>
              )}

              <dl className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-px bg-line rounded-lg overflow-hidden border border-line">
                {[
                  { k: "Students", v: String(CLASS.length) },
                  { k: "Rubric clauses", v: String(MEDIAN.clauses.length) },
                  { k: "Tests each", v: String(MEDIAN.tests.length) },
                  { k: "Distinct mistakes", v: String(DISTINCT_ARCHETYPES) },
                ].map((s) => (
                  <div key={s.k} className="bg-surface px-4 py-4">
                    <dt className="text-[11px] uppercase tracking-wider text-faint">
                      {s.k}
                    </dt>
                    <dd className="mt-1 font-mono text-xl">{s.v}</dd>
                  </div>
                ))}
              </dl>

              <TryYourOwn
                assignment={MEDIAN}
                onBuildSuite={buildSuite}
                onGrade={gradeOne}
                disabled={!booted || !!bootError}
              />
            </motion.section>
          ) : (
            <section key="queue" className="pt-8">
              {phase === "complete" && (
                <ClassInsights
                  misses={clauseMisses}
                  total={stats.done}
                  inconclusive={stats.inconclusive}
                />
              )}

              {phase === "complete" && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12px] text-muted">
                    {stats.done - stats.inconclusive} marked from{" "}
                    <span className="text-ink">{stats.distinctFailures}</span>{" "}
                    distinct mistakes.
                  </p>
                  <button
                    onClick={exportCsv}
                    className="rounded-md border border-line-hi bg-surface-hi px-2.5 py-1
                               font-mono text-[10px] text-muted transition-colors
                               hover:border-ink/30 hover:text-ink"
                  >
                    Export gradebook (.csv)
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <SubmissionCard
                    key={row.submission.id}
                    row={row}
                    assignment={MEDIAN}
                    index={i}
                    expanded={expanded === row.submission.id}
                    onToggle={() =>
                      setExpanded((cur) =>
                        cur === row.submission.id ? null : row.submission.id,
                      )
                    }
                    cohortCount={
                      row.signature ? (cohort.get(row.signature) ?? 0) - 1 : 0
                    }
                    onOpenStudentView={() => setStudentView(row.submission.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </AnimatePresence>
      </main>

      {(() => {
        if (!studentView) return null;
        const pair =
          custom?.submission.id === studentView
            ? custom
            : (() => {
                const row = rows.find((r) => r.submission.id === studentView);
                // Everyone in the seeded class was graded against the seeded
                // assignment; only the visitor's own submission can carry
                // another one.
                return row?.report
                  ? {
                      submission: row.submission,
                      report: row.report,
                      assignment: MEDIAN,
                    }
                  : null;
              })();
        if (!pair) return null;
        return (
          <StudentView
            submission={pair.submission}
            assignment={pair.assignment}
            report={pair.report}
            onClose={closeStudentView}
          />
        );
      })()}
    </div>
  );
}
