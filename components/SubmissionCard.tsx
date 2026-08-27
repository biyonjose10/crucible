"use client";

import { AnimatePresence, motion } from "motion/react";
import { MEDIAN } from "@/lib/assignment";
import type { ClauseScore, ScoreReport } from "@/lib/scoring";
import type { Row } from "./Grader";
import { EvidenceChip } from "./EvidenceChip";

const EASE = [0.22, 1, 0.36, 1] as const;

function verdict(report: ScoreReport | undefined) {
  if (!report) return { label: "—", tone: "text-faint", dot: "bg-line-hi" };
  if (report.status === "inconclusive")
    return { label: "INCONCLUSIVE", tone: "text-warn", dot: "bg-warn" };
  if (report.earned === report.total)
    return { label: `${report.earned}/${report.total}`, tone: "text-pass", dot: "bg-pass" };
  return { label: `${report.earned}/${report.total}`, tone: "text-fail", dot: "bg-fail" };
}

function ClauseBlock({ clause }: { clause: ClauseScore }) {
  const tests = MEDIAN.tests.filter((t) => t.clause === clause.clause);
  const byId = new Map(tests.map((t) => [t.id, t]));

  const tone =
    clause.status === "pass"
      ? "text-pass"
      : clause.status === "inconclusive"
        ? "text-warn"
        : "text-fail";

  return (
    <div className="border-t border-line py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] leading-snug">
          <span className="font-mono text-[11px] text-faint mr-2">
            C{clause.clause}
          </span>
          {clause.text}
        </p>
        <span className={`font-mono text-[11px] shrink-0 ${tone}`}>
          {clause.status === "inconclusive"
            ? "— / " + clause.points
            : `${clause.earned} / ${clause.points}`}
        </span>
      </div>

      {/* Only failing and inconclusive tests are itemised. A passing clause
          needs no explanation, and listing it would bury the signal. */}
      {clause.status !== "pass" && (
        <ul className="mt-2 space-y-2">
          {clause.results
            .filter((r) => r.status !== "pass")
            .map((r) => {
              const test = byId.get(r.id);
              return (
                <li
                  key={r.id}
                  className="rounded-md border border-line bg-bg/60 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <code className="font-mono text-[11px] text-ink">
                      {test?.label ?? r.id}
                    </code>
                    <span
                      className={`font-mono text-[10px] rounded px-1.5 py-0.5 ${
                        test?.visible
                          ? "bg-surface-hi text-faint"
                          : "bg-warn-dim text-warn"
                      }`}
                    >
                      {test?.visible ? "visible" : "hidden"}
                    </span>
                  </div>

                  {r.status === "inconclusive" ? (
                    <p className="mt-1.5 font-mono text-[11px] text-warn">
                      did not report — interpreter stopped before this test ran
                    </p>
                  ) : (
                    <p className="mt-1.5 font-mono text-[11px] text-muted">
                      expected <span className="text-ink">{r.expected}</span>
                      {"  ·  got "}
                      <span className="text-fail">{r.got}</span>
                    </p>
                  )}

                  {r.trace && (
                    <EvidenceChip label="interpreter output" evidence={r.trace} />
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

export function SubmissionCard({
  row,
  index,
  expanded,
  onToggle,
}: {
  row: Row;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const v = verdict(row.report);
  const isRunning = row.state === "running";
  const isDone = row.state === "done";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        ease: EASE,
        // Stagger only on first paint, so the queue ignites rather than
        // appearing all at once.
        delay: Math.min(index * 0.02, 0.4),
      }}
      className={`relative overflow-hidden rounded-lg border bg-surface transition-colors
                  ${expanded ? "border-line-hi" : "border-line hover:border-line-hi"}`}
    >
      {isRunning && (
        <div className="shimmer pointer-events-none absolute inset-0" aria-hidden />
      )}

      <button
        onClick={onToggle}
        disabled={!isDone}
        className="relative w-full flex items-center gap-4 px-4 py-3 text-left
                   disabled:cursor-default"
      >
        <span className="font-mono text-[11px] text-faint w-7 shrink-0">
          {String(index + 1).padStart(2, "0")}
        </span>

        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.dot}`} />

        <span className="flex-1 min-w-0 truncate text-[13px]">
          {row.submission.student}
        </span>

        {isDone && row.durationMs !== undefined && (
          <span className="hidden sm:block font-mono text-[10px] text-faint">
            {row.durationMs}ms
          </span>
        )}

        <span className={`font-mono text-xs w-28 text-right shrink-0 ${v.tone}`}>
          {isRunning ? "running…" : v.label}
        </span>

        <span
          className={`text-faint text-xs transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          } ${isDone ? "opacity-100" : "opacity-0"}`}
        >
          ›
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && row.report && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden border-t border-line"
          >
            <div className="grid lg:grid-cols-2 gap-0">
              {/* Submitted code, with line numbers so a diagnosis can point. */}
              <div className="border-b lg:border-b-0 lg:border-r border-line">
                <p className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-wider text-faint">
                  Submitted
                </p>
                <pre className="overflow-x-auto px-4 pb-4 text-[11px] leading-[1.7]">
                  <code className="font-mono">
                    {row.submission.code.replace(/\n$/, "").split("\n").map((line, i) => (
                      <div key={i} className="flex">
                        <span className="select-none text-faint w-7 shrink-0 text-right pr-3">
                          {i + 1}
                        </span>
                        <span className="text-muted whitespace-pre">{line || " "}</span>
                      </div>
                    ))}
                  </code>
                </pre>
              </div>

              <div className="px-4 py-3">
                <p className="pb-1 text-[10px] uppercase tracking-wider text-faint">
                  Rubric
                </p>

                {row.report.inconclusiveReason === "timeout" && (
                  <div className="mb-3 rounded-md border border-warn/30 bg-warn-dim px-3 py-2">
                    <p className="font-mono text-[11px] text-warn">
                      Execution exceeded 5s and was terminated.
                    </p>
                    <p className="mt-1 text-[11px] text-muted leading-relaxed">
                      Flagged for human review. Results already produced are kept;
                      tests that never ran are not guessed at.
                    </p>
                  </div>
                )}

                {row.report.importError && (
                  <div className="mb-3">
                    <p className="font-mono text-[11px] text-fail">
                      Module failed to import — no test could run.
                    </p>
                    <EvidenceChip
                      label="interpreter output"
                      evidence={row.report.importError}
                    />
                  </div>
                )}

                {row.report.clauses.map((c) => (
                  <ClauseBlock key={c.clause} clause={c} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
