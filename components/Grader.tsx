"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MEDIAN } from "@/lib/assignment";
import { GraderPool } from "@/lib/grader-pool";
import { failureSignature, score, type ScoreReport } from "@/lib/scoring";
import { CLASS, DISTINCT_ARCHETYPES, type Submission } from "@/fixtures/class";
import { SubmissionCard } from "./SubmissionCard";
import { StatBar } from "./StatBar";

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

export function Grader() {
  const poolRef = useRef<GraderPool | null>(null);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Real spend, accumulated from API usage. Reused diagnoses are not counted
  // again — that reuse is exactly what keeps the number small.
  const [spend, setSpend] = useState({ usd: 0, calls: 0 });

  const [rows, setRows] = useState<Row[]>(() =>
    CLASS.map((submission) => ({ submission, state: "queued" as const })),
  );

  // ── Interpreter lifecycle ────────────────────────────────────────────────
  // Boot while the user is still reading the page, so that pressing the button
  // starts grading rather than starting a download.
  useEffect(() => {
    const pool = new GraderPool({ size: 2, execTimeoutMs: 5_000, bootTimeoutMs: BOOT_TIMEOUT_MS });
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
                      : "booting CPython…"}
                </span>
              </div>

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
            </motion.section>
          ) : (
            <section key="queue" className="pt-8">
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
    </div>
  );
}
