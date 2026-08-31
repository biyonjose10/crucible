"use client";

import { motion } from "motion/react";

interface Stats {
  done: number;
  total: number;
  inconclusive: number;
  mean: number;
  distinctFailures: number;
}

interface Props {
  phase: "idle" | "grading" | "complete";
  booted: boolean;
  bootError: string | null;
  elapsed: number;
  stats: Stats;
  /** Returns to the landing page. Absent while there is nothing to return from. */
  onHome?: () => void;
}

function Stat({
  label,
  value,
  tone,
  minor,
}: {
  label: string;
  value: string;
  tone?: string;
  /** Dropped on narrow screens. Six columns do not fit on a phone, and these
   *  are the ones a reader can live without. */
  minor?: boolean;
}) {
  return (
    <div
      className={`${minor ? "hidden sm:flex" : "flex"} flex-col items-end leading-none`}
    >
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className={`mt-1 font-mono text-sm ${tone ?? "text-ink"}`}>{value}</span>
    </div>
  );
}

export function StatBar({
  phase,
  booted,
  bootError,
  elapsed,
  stats,
  onHome,
}: Props) {
  const pct = stats.total ? (stats.done / stats.total) * 100 : 0;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="w-full max-w-5xl mx-auto px-5 h-14 flex items-center justify-between gap-6">
        <div className="flex items-baseline gap-3 min-w-0">
          {/* The header is sticky, so this stays reachable from anywhere in a
              thirty-card list — which is the whole point of putting it here
              rather than at the end of the results. */}
          {onHome ? (
            <button
              type="button"
              onClick={onHome}
              className="font-mono text-sm tracking-[0.2em] font-medium text-faint transition-colors hover:text-ink focus-visible:text-ink"
            >
              <span aria-hidden="true">←</span> CRUCIBLE
              <span className="sr-only"> — back to the start</span>
            </button>
          ) : (
            <span className="font-mono text-sm tracking-[0.2em] font-medium">
              CRUCIBLE
            </span>
          )}
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] ${
              bootError ? "text-fail" : booted ? "text-muted" : "text-faint"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                bootError ? "bg-fail" : booted ? "bg-pass" : "bg-warn animate-pulse"
              }`}
            />
            {bootError
              ? "sandbox unavailable"
              : booted
                ? "CPython 3.14 · WASM"
                : "booting"}
          </span>
        </div>

        {phase !== "idle" && (
          <div className="flex items-center gap-4 sm:gap-7">
            <Stat label="Graded" value={`${stats.done}/${stats.total}`} />
            <Stat
              minor
              label="Mean"
              value={stats.done ? `${stats.mean.toFixed(1)}/10` : "—"}
            />
            <Stat
              minor
              label="Review"
              value={String(stats.inconclusive)}
              tone={stats.inconclusive ? "text-warn" : "text-faint"}
            />
            <Stat
              minor
              label="Distinct"
              value={String(stats.distinctFailures)}
              tone="text-muted"
            />
            <Stat label="Elapsed" value={`${(elapsed / 1000).toFixed(1)}s`} />
          </div>
        )}
      </div>

      {/* Progress hairline. Only meaningful while work is in flight. */}
      {phase !== "idle" && (
        <motion.div
          className="h-px bg-ink origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct / 100 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </header>
  );
}
