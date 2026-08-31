"use client";

import { useState } from "react";
import type { Assignment } from "@/lib/types";
import { GeneratedSuite } from "./GeneratedSuite";

/**
 * The part a visitor can break themselves.
 *
 * Everything else on this page is a fixed cast of thirty, which invites the
 * fair objection that the eight interesting cases were rigged. This runs
 * arbitrary code through the same sandbox, the same tests and the same scoring
 * function, and returns the same feedback — so the claim can be tested rather
 * than believed.
 *
 * It goes one step further than that now: describe a different problem and a
 * model writes the rubric and the tests for it. That answers the harder version
 * of the same objection — whether this is a grading engine or one hardcoded
 * exercise — and it does not touch the guarantee, because what the model
 * produces is a suite the sandbox executes, not a mark. See GeneratedSuite for
 * the approval step, and lib/authoring.ts for what a suite must satisfy to
 * reach it.
 *
 * The boxes are deliberately plain textareas. A syntax-highlighting editor
 * would add a dependency, a bundle, and a set of failure modes to something
 * whose entire job is to accept a dozen lines of Python.
 */

/** Prefilled with a plausible near-miss rather than the empty starter: a blank
 *  box asks the visitor to invent a task, a wrong answer asks them to spot a
 *  bug, and the second is a far easier invitation to accept. */
const SEED = `def median(nums: list[float]) -> float:
    ordered = sorted(nums)
    return ordered[len(ordered) // 2]
`;

/**
 * `authoring` and `checking` are separate states because they fail differently
 * and take noticeably different amounts of time — one is a model writing, the
 * other is its work being executed — and saying which is happening is the
 * difference between a wait that reads as progress and one that reads as a
 * hang.
 */
type Step = "idle" | "authoring" | "checking" | "review" | "grading";

export function TryYourOwn({
  assignment,
  onBuildSuite,
  onGrade,
  disabled,
}: {
  /** The seeded exercise, used when the visitor describes no problem of their own. */
  assignment: Assignment;
  onBuildSuite: (
    problem: string,
    onProgress: (step: "authoring" | "checking") => void,
  ) => Promise<Assignment | { error: string }>;
  onGrade: (code: string, against: Assignment) => Promise<void>;
  disabled: boolean;
}) {
  const [problem, setProblem] = useState("");
  const [code, setCode] = useState(SEED);
  const [step, setStep] = useState<Step>("idle");
  const [generated, setGenerated] = useState<Assignment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = step !== "idle" && step !== "review";
  const custom = problem.trim().length > 0;

  /** Grade against whichever assignment is in play. */
  const grade = async (against: Assignment) => {
    if (!code.trim()) return;
    setStep("grading");
    try {
      await onGrade(code, against);
    } finally {
      setStep(generated ? "review" : "idle");
    }
  };

  const build = async () => {
    setError(null);
    setGenerated(null);

    const result = await onBuildSuite(problem.trim(), setStep);

    if ("error" in result) {
      setError(result.error);
      setStep("idle");
      return;
    }

    // The seeded median solution is no longer a plausible starting point for a
    // different problem, so hand over the generated stub — but only if the
    // visitor has not written anything of their own.
    setCode((current) => (current === SEED ? result.starterCode : current));
    setGenerated(result);
    setStep("review");
  };

  const primary = async () => {
    if (busy || disabled) return;
    if (custom) return build();
    return grade(assignment);
  };

  const discard = () => {
    setGenerated(null);
    setError(null);
    setStep("idle");
  };

  return (
    // The id is the target of the hero's "or paste your own code" link. The
    // scroll margin keeps the heading off the very top edge of the viewport,
    // so the section lands with its title and the prompt both visible.
    <section id="try-your-own" className="mt-16 scroll-mt-10 border-t border-line pt-10">
      <h2 className="text-lg font-medium tracking-tight">
        Or grade something of your own.
      </h2>

      <label
        htmlFor="own-problem"
        className="mt-5 block font-mono text-[11px] uppercase tracking-wider text-faint"
      >
        The problem
      </label>
      <textarea
        id="own-problem"
        value={problem}
        onChange={(e) => {
          setProblem(e.target.value);
          // A suite belongs to the wording that produced it. Editing the
          // description without clearing it would let someone accept tests
          // written for a question they have since changed.
          if (generated) discard();
        }}
        placeholder="Describe a function to implement — for example: return the two largest numbers in a list, largest first, and raise ValueError if there are fewer than two."
        rows={2}
        disabled={busy}
        className="mt-2 w-full resize-y rounded-lg border border-line bg-surface p-4
                   text-[13px] leading-relaxed text-ink placeholder:text-faint
                   outline-none transition-colors disabled:opacity-50
                   focus:border-line-hi focus-visible:ring-1 focus-visible:ring-ink/30"
      />
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        {custom ? (
          <>
            A model will write the rubric and the tests. You will see all of them
            before anything is graded.
          </>
        ) : (
          <>
            Leave this blank to use the exercise the class was set:{" "}
            {assignment.prompt}
          </>
        )}
      </p>

      <label
        htmlFor="own-code"
        className="mt-6 block font-mono text-[11px] uppercase tracking-wider text-faint"
      >
        Your Python
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
            void (generated ? grade(generated) : primary());
          }
        }}
        spellCheck={false}
        rows={8}
        className="mt-2 w-full resize-y rounded-lg border border-line bg-surface p-4
                   font-mono text-[12px] leading-[1.7] text-ink
                   outline-none transition-colors
                   focus:border-line-hi focus-visible:ring-1 focus-visible:ring-ink/30"
      />

      {generated ? (
        <GeneratedSuite
          assignment={generated}
          onAccept={() => void grade(generated)}
          onDiscard={discard}
          disabled={step === "grading" || disabled}
        />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={primary}
            disabled={disabled || busy || !code.trim()}
            className="rounded-lg bg-ink px-4 py-2.5 font-medium text-bg transition-all duration-200
                       hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(255,255,255,0.35)]
                       disabled:cursor-not-allowed disabled:opacity-40
                       disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {step === "authoring"
              ? "Writing the tests…"
              : step === "checking"
                ? "Checking the tests…"
                : step === "grading"
                  ? "Running…"
                  : custom
                    ? "Write the tests"
                    : "Grade my code"}
          </button>
          <span className="font-mono text-[11px] text-faint">
            {disabled
              ? "waiting for the interpreter"
              : step === "checking"
                ? "running a known-good solution against them"
                : "runs in your browser · ⌘/Ctrl + Enter"}
          </span>
        </div>
      )}

      {error && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3"
        >
          <p className="text-[12px] leading-relaxed text-warn">{error}</p>
        </div>
      )}
    </section>
  );
}
