"use client";

import { motion } from "motion/react";

export interface ClauseMiss {
  clause: number;
  text: string;
  missed: number;
}

/**
 * What to teach next.
 *
 * Every other view here answers a question about one submission. A teacher's
 * actual question after a marking run is which single misconception is worth
 * spending Monday on, and that is a property of the cohort, not of any student
 * in it. The numbers are already computed — this is the same clause results,
 * counted the other way round.
 */
export function ClassInsights({
  misses,
  total,
  inconclusive,
}: {
  misses: ClauseMiss[];
  total: number;
  inconclusive: number;
}) {
  const ranked = misses.filter((m) => m.missed > 0);
  if (ranked.length === 0) return null;

  const worst = ranked[0];
  // Only call something out as widespread if it actually is. A third of the
  // class is the point at which re-teaching beats individual comments.
  const widespread = worst.missed / Math.max(total, 1) >= 0.33;

  return (
    <motion.section
      initial={{ y: 6 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mb-6 rounded-lg border border-line bg-surface px-5 py-4"
      aria-label="Class insights"
    >
      <p className="text-[10px] uppercase tracking-wider text-faint">
        What to re-teach
      </p>

      <p className="mt-2 text-[14px] leading-relaxed">
        {widespread ? (
          <>
            <span className="text-ink">
              {worst.missed} of {total}
            </span>{" "}
            missed <span className="text-ink">{worst.text.toLowerCase()}</span>.
            That is the one worth a lesson.
          </>
        ) : (
          <>No single mistake dominates this class — the misses are spread out,
          so individual feedback will do more than a re-teach.</>
        )}
      </p>

      <ul className="mt-4 space-y-2">
        {ranked.map((m) => {
          const pct = Math.round((m.missed / Math.max(total, 1)) * 100);
          return (
            <li key={m.clause} className="flex items-center gap-3">
              <span className="w-10 shrink-0 font-mono text-[11px] text-muted">
                {m.missed}/{total}
              </span>
              {/* Width is the share of the class, so the bar carries the same
                  information as the number for someone scanning. */}
              <span
                className="h-1.5 shrink-0 rounded-full bg-fail/70"
                style={{ width: `${Math.max(pct, 2)}%` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                {m.text}
              </span>
            </li>
          );
        })}
      </ul>

      {inconclusive > 0 && (
        <p className="mt-4 text-[12px] text-warn">
          {inconclusive} submission{inconclusive === 1 ? "" : "s"} could not be
          scored automatically and {inconclusive === 1 ? "is" : "are"} waiting on
          you.
        </p>
      )}
    </motion.section>
  );
}
