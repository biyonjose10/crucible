"use client";

import { useState } from "react";
import { MEDIAN } from "@/lib/assignment";

/**
 * The part a visitor can break themselves.
 *
 * Everything else on this page is a fixed cast of thirty, which invites the
 * fair objection that the eight interesting cases were rigged. This runs
 * arbitrary code through the same sandbox, the same tests and the same scoring
 * function, and returns the same feedback — so the claim can be tested rather
 * than believed.
 *
 * It is deliberately a plain textarea. A syntax-highlighting editor would add a
 * dependency, a bundle, and a set of failure modes to something whose entire
 * job is to accept a dozen lines of Python.
 */

/** Prefilled with a plausible near-miss rather than the empty starter: a blank
 *  box asks the visitor to invent a task, a wrong answer asks them to spot a
 *  bug, and the second is a far easier invitation to accept. */
const SEED = `def median(nums: list[float]) -> float:
    ordered = sorted(nums)
    return ordered[len(ordered) // 2]
`;

export function TryYourOwn({
  onGrade,
  disabled,
}: {
  onGrade: (code: string) => Promise<void>;
  disabled: boolean;
}) {
  const [code, setCode] = useState(SEED);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || disabled || !code.trim()) return;
    setBusy(true);
    try {
      await onGrade(code);
    } finally {
      setBusy(false);
    }
  };

  return (
    // The id is the target of the hero's "or paste your own code" link. The
    // scroll margin keeps the heading off the very top edge of the viewport,
    // so the section lands with its title and the prompt both visible.
    <section id="try-your-own" className="mt-16 scroll-mt-10 border-t border-line pt-10">
      <h2 className="text-lg font-medium tracking-tight">
        Or grade something of your own.
      </h2>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
        {MEDIAN.prompt}
      </p>

      <label htmlFor="own-code" className="sr-only">
        Your Python solution
      </label>
      <textarea
        id="own-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter submits, the convention every code box uses. Tab is
          // left alone so keyboard users can still leave the field.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        spellCheck={false}
        rows={8}
        className="mt-5 w-full resize-y rounded-lg border border-line bg-surface p-4
                   font-mono text-[12px] leading-[1.7] text-ink
                   outline-none transition-colors
                   focus:border-line-hi focus-visible:ring-1 focus-visible:ring-ink/30"
      />

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          onClick={submit}
          disabled={disabled || busy || !code.trim()}
          className="rounded-lg bg-ink px-4 py-2.5 font-medium text-bg transition-all duration-200
                     hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(255,255,255,0.35)]
                     disabled:cursor-not-allowed disabled:opacity-40
                     disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          {busy ? "Running…" : "Grade my code"}
        </button>
        <span className="font-mono text-[11px] text-faint">
          {disabled
            ? "waiting for the interpreter"
            : "runs in your browser · ⌘/Ctrl + Enter"}
        </span>
      </div>
    </section>
  );
}
