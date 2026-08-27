"use client";

import { motion } from "motion/react";
import { MEDIAN } from "@/lib/assignment";
import { useDiagnosis } from "@/lib/useDiagnosis";
import type { Diagnosis } from "@/lib/diagnose";
import type { ScoreReport } from "@/lib/scoring";

const REJECTION_COPY: Record<string, string> = {
  malformed: "Malformed claim",
  "unknown-clause": "Cited a rubric clause that does not exist",
  "unknown-test": "Cited a test that does not exist",
  "test-did-not-fail": "Cited a test that actually passed",
  "clause-test-mismatch": "Test does not belong to the cited clause",
  "line-out-of-range": "Pointed at a line beyond the end of the file",
  duplicate: "Duplicate of an earlier claim",
};

function testLabel(testId: string) {
  return MEDIAN.tests.find((t) => t.id === testId)?.label ?? testId;
}

export function DiagnosisPanel({
  submissionId,
  code,
  report,
  active,
  onSettled,
}: {
  submissionId: string;
  code: string;
  report: ScoreReport;
  active: boolean;
  onSettled?: (d: Diagnosis) => void;
}) {
  const { text, streaming, result, error } = useDiagnosis(
    submissionId,
    MEDIAN.slug,
    code,
    report,
    active,
    onSettled,
  );

  const clean = report.earned === report.total && report.status === "graded";
  if (clean) {
    return (
      <div className="border-b border-line px-4 py-3">
        <p className="text-[11px] text-faint">
          Every clause passed. No diagnosis was requested, and no tokens were
          spent on this submission.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3 pb-2">
        <p className="text-[10px] uppercase tracking-wider text-faint">
          Diagnosis
        </p>
        {result && (
          <span className="font-mono text-[10px] text-faint">
            {result.cached
              ? "reused — identical failure already diagnosed"
              : `$${result.costUsd.toFixed(5)} · ${result.elapsedMs}ms`}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-warn/30 bg-warn-dim px-3 py-2">
          <p className="font-mono text-[11px] text-warn">
            Diagnosis unavailable.
          </p>
          <p className="mt-1 text-[11px] text-muted leading-relaxed">
            {error} The score above is unaffected — it was computed by the
            sandbox, not the model.
          </p>
        </div>
      )}

      {result?.unavailable && !error && (
        <div className="rounded-md border border-warn/30 bg-warn-dim px-3 py-2">
          <p className="font-mono text-[11px] text-warn">
            Written explanations are switched off.
          </p>
          {/* `reason` already states that scoring is unaffected — do not
              repeat it here. */}
          <p className="mt-1 text-[11px] text-muted leading-relaxed">
            {result.reason}
          </p>
        </div>
      )}

      {!error && !result?.unavailable && (
        <>
          {text && (
            <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
              {text}
              {streaming && (
                <motion.span
                  className="inline-block ml-0.5 w-1.5 h-3.5 align-middle bg-ink"
                  animate={{ opacity: [1, 0.15, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </p>
          )}

          {!text && streaming && (
            <p className="font-mono text-[11px] text-faint">
              reading the failing traces…
            </p>
          )}

          {/* Verified claims. Each one names the clause and the test that
              evidences it, so nothing here is unattributable. */}
          {result && result.claims.length > 0 && (
            <ul className="mt-3 space-y-2">
              {result.claims.map((c, i) => (
                <li
                  key={i}
                  className="rounded-md border border-line bg-bg/60 px-3 py-2"
                >
                  <p className="text-[12px] leading-snug text-ink">{c.message}</p>
                  <p className="mt-1.5 font-mono text-[10px] text-faint">
                    clause C{c.clauseId}
                    {c.line !== undefined && ` · line ${c.line}`} · evidenced by{" "}
                    <span className="text-muted">{testLabel(c.testId)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Showing what the model got wrong is the point, not an
              embarrassment. A claim with no verifiable anchor is never
              rendered as if it were true. */}
          {result && result.rejected.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-faint">
                Rejected by the validator ({result.rejected.length})
              </p>
              <ul className="mt-2 space-y-2">
                {result.rejected.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-dashed border-line px-3 py-2 opacity-55"
                  >
                    <p className="text-[12px] leading-snug text-muted line-through decoration-faint">
                      {r.claim.message || "(no message)"}
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] text-warn">
                      {REJECTION_COPY[r.reason] ?? r.reason} — {r.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
