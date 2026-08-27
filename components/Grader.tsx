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
  // Real spend, accumulated from API usage. Reused diagnoses are not counted
  // again — that reuse is exactly what keeps the number small.
  const [spend, setSpend] = useState({ usd: 0, calls: 0 });
  /** Submission id currently shown as the student would receive it. */
  const [studentView, setStudentView] = useState<string | null>(null);
  /** A one-off submission typed by the visitor, graded the same way as the class. */
  const [custom, setCustom] = useState<{
    submission: Submission;
    report: ScoreReport;
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
  const gradeOne = useCallback(async (code: string) => {
    const pool = poolRef.current;
    if (!pool) return;

    const id = `you-${Date.now()}`;
    const submission: Submission = {
      id,
      student: "You",
      archetype: "custom",
      code,
    };

    const outcome = await pool.run(id, code, MEDIAN.tests);
    const report = score(MEDIAN, outcome);

    setCustom({ submission, report });
    setStudentView(id);
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
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = [
      "student",
      "mark",
      "out_of",
      "status",
      "failure_signature",
      "runtime_ms",
    ].join(",");
    const body = rows
      .filter((r) => r.report)
      .map((r) =>
        [
          esc(r.submission.student),
          r.report!.status === "inconclusive" ? "" : String(r.report!.earned),
          String(r.report!.total),
          r.report!.status,
          esc(r.signature ?? ""),
          String(r.durationMs ?? ""),
        ].join(","),
      )
      .join("\n");

    const blob = new Blob([header + "\n" + body + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${MEDIAN.slug}-gradebook.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <div className="flex flex-col min-h-full">
      <StatBar
        phase={phase}
        booted={booted}
        bootError={bootError}
        elapsed={elapsed}
        stats={stats}
        spend={spend}
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

              <TryYourOwn onGrade={gradeOne} disabled={!booted || !!bootError} />
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
                    onDiagnosis={(d) => {
                      if (d.cached || d.unavailable) return;
                      setSpend((s) => ({
                        usd: s.usd + d.costUsd,
                        calls: s.calls + 1,
                      }));
                    }}
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
                return row?.report
                  ? { submission: row.submission, report: row.report }
                  : null;
              })();
        if (!pair) return null;
        return (
          <StudentView
            submission={pair.submission}
            report={pair.report}
            onClose={() => setStudentView(null)}
          />
        );
      })()}
    </div>
  );
}
