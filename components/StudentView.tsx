"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { MEDIAN } from "@/lib/assignment";
import { useDiagnosis } from "@/lib/useDiagnosis";
import type { ScoreReport } from "@/lib/scoring";
import type { Submission } from "@/fixtures/class";
import type { Diagnosis } from "@/lib/diagnose";

/**
 * The same result, addressed to the person who has to act on it.
 *
 * The instructor queue answers "how did the class do". This answers "what did I
 * get wrong, and what do I do about it" — the only question a student actually
 * has. Nothing is recomputed here: the score was fixed by the sandbox before
 * this view opened, and the prose is the diagnosis already fetched for the
 * card, served from the same memo cache.
 *
 * The mark is deliberately small and last. A number a student cannot act on is
 * the least useful thing on the page.
 */
export function StudentView({
  submission,
  report,
  onClose,
  onDiagnosis,
}: {
  submission: Submission;
  report: ScoreReport;
  onClose: () => void;
  /** Reports real spend upward. Without it this view billed silently. */
  onDiagnosis?: (d: Diagnosis) => void;
}) {
  const { text, streaming, result } = useDiagnosis(
    submission.id,
    MEDIAN.slug,
    submission.code,
    report,
    true,
    onDiagnosis,
  );

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Remember where focus came from so it can be handed back on close.
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Keep Tab inside the dialog. Without this, focus walks into the queue
      // behind it, which a screen reader still announces even though the
      // dialog covers it visually.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const failed = report.clauses.filter((c) => c.status !== "pass");
  const passed = report.clauses.filter((c) => c.status === "pass");
  const lines = submission.code.replace(/\n$/, "").split("\n");

  // Only lines carried by a validated claim are highlighted. An unverified
  // line number would point a student at innocent code.
  const flagged = new Set(
    (result?.claims ?? [])
      .map((c) => c.line)
      .filter((n): n is number => typeof n === "number"),
  );

  const headline =
    report.status === "inconclusive"
      ? "Your submission could not be checked automatically."
      : failed.length === 0
        ? "Everything passed. Nothing to fix."
        : failed.length === 1
          ? "One thing to fix."
          : `${failed.length} things to fix.`;

  return (
    <motion.div
      initial={{ y: 12 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      ref={panelRef}
      className="fixed inset-0 z-50 overflow-y-auto bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label={`Feedback for ${submission.student}`}
    >
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-faint">
              {MEDIAN.title}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Feedback for {submission.student}
            </h1>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 font-mono text-[11px]
                       text-muted transition-colors hover:border-line-hi hover:text-ink"
          >
            Close · Esc
          </button>
        </div>

        {/* The headline is what to do, not what you scored. */}
        <p className="mt-8 text-lg leading-relaxed">{headline}</p>

        {report.status === "inconclusive" && (
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            It ran for longer than the five seconds allowed and was stopped, so
            some tests never reported. This has been flagged for your instructor
            to look at by hand. It has not been marked wrong.
          </p>
        )}

        {report.importError && (
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Your file could not be run at all, so no test could execute. Fix the
            error below first, then the rest can be checked.
          </p>
        )}

        {/* The explanation, in plain language, before any rubric talk. */}
        {(text || streaming) && (
          <div className="mt-6 rounded-lg border border-line bg-surface px-5 py-4">
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
              {text}
              {streaming && (
                <motion.span
                  className="ml-0.5 inline-block h-4 w-1.5 align-middle bg-ink"
                  animate={{ opacity: [1, 0.15, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </p>
          </div>
        )}

        {/* Each failure as a requirement the student can re-read, with the
            concrete input that broke it. No test ids, no jargon. */}
        {failed.length > 0 && (
          <ol className="mt-8 space-y-5">
            {failed.map((clause) => {
              const claim = result?.claims.find(
                (c) => c.clauseId === clause.clause,
              );
              const example = clause.results.find((r) => r.status === "fail");
              const test = MEDIAN.tests.find((t) => t.id === example?.id);
              return (
                <li key={clause.clause} className="border-l-2 border-fail/50 pl-5">
                  <p className="text-[14px] font-medium leading-snug">
                    {clause.text}
                  </p>

                  {claim?.line !== undefined && (
                    <p className="mt-1 font-mono text-[11px] text-muted">
                      look at line {claim.line}
                    </p>
                  )}

                  {example && test && (
                    <p className="mt-2 font-mono text-[12px] text-muted">
                      <span className="text-faint">with</span> {test.label}
                      <br />
                      <span className="text-faint">expected</span>{" "}
                      <span className="text-ink">{example.expected}</span>{" "}
                      <span className="text-faint">but got</span>{" "}
                      <span className="text-fail">{example.got}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-10">
          <p className="text-[10px] uppercase tracking-wider text-faint">
            What you submitted
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface p-4 text-[12px] leading-[1.75]">
            <code className="font-mono">
              {lines.map((line, i) => {
                const hit = flagged.has(i + 1);
                return (
                  <div
                    key={i}
                    className={`flex ${hit ? "-mx-2 rounded bg-fail-dim px-2" : ""}`}
                  >
                    <span className="w-8 shrink-0 select-none pr-3 text-right text-faint">
                      {i + 1}
                    </span>
                    <span
                      className={`whitespace-pre ${hit ? "text-ink" : "text-muted"}`}
                    >
                      {line || " "}
                    </span>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>

        {passed.length > 0 && (
          <p className="mt-6 text-[13px] leading-relaxed text-muted">
            <span className="text-pass">Already correct:</span>{" "}
            {passed.map((c) => c.text.toLowerCase()).join("; ")}.
          </p>
        )}

        {/* The number, last and small, where it belongs. */}
        <div className="mt-10 border-t border-line pt-5">
          <p className="font-mono text-[11px] leading-relaxed text-faint">
            {report.status === "inconclusive"
              ? "Mark withheld pending review."
              : `Mark ${report.earned} out of ${report.total}, from ${MEDIAN.tests.length} automated tests. Computed by running your code — not by the model that wrote this feedback.`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
