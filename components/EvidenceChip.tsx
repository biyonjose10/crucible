"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * A claim's receipt.
 *
 * Every statement Crucible makes about a submission is attached to one of
 * these, and what opens is the raw interpreter output — captured, never
 * generated. If there is no evidence, there is no chip, and the UI does not
 * render the claim at all.
 */
export function EvidenceChip({
  label,
  evidence,
}: {
  label: string;
  evidence: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line-hi
                   bg-surface-hi px-2 py-1 font-mono text-[10px] text-muted
                   transition-colors hover:border-ink/30 hover:text-ink"
        aria-expanded={open}
      >
        <span
          className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        {label}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <code
              className="mt-2 block overflow-x-auto rounded-md border border-line
                         bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted
                         whitespace-pre"
            >
              {evidence}
            </code>
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}
