"use client";

import type { Assignment } from "@/lib/types";

/**
 * The rubric and tests a model wrote, shown before they are used on anyone.
 *
 * This screen is the condition under which model-authored tests are honest at
 * all. A grader that marks you against a ruler you were never shown is asking
 * to be trusted; one that puts the ruler on the table first can be checked. So
 * every test appears here in full — the exact Python expression, the exact
 * expected value — and nothing runs until the visitor accepts them.
 *
 * Read-only on purpose. An editable suite invalidates the self-check that ran
 * before this rendered: the marks shown are only meaningful because *these*
 * tests were the ones a known-good solution passed.
 */
export function GeneratedSuite({
  assignment,
  onAccept,
  onDiscard,
  disabled,
}: {
  assignment: Assignment;
  onAccept: () => void;
  onDiscard: () => void;
  disabled: boolean;
}) {
  const total = assignment.clauses.reduce((sum, c) => sum + c.points, 0);

  return (
    <div className="mt-5 rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
          Generated assignment
        </p>
        <p className="mt-1.5 text-sm text-ink">{assignment.title}</p>
        <p className="mt-1 font-mono text-[11px] text-muted break-all">
          {assignment.signature}
        </p>
      </div>

      <div className="border-b border-line px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
          Rubric · {total} points
        </p>
        <ul className="mt-2 space-y-1.5">
          {assignment.clauses.map((c) => (
            <li key={c.id} className="flex gap-3 text-[12px] leading-relaxed">
              <span className="font-mono text-faint shrink-0">
                {String(c.points).padStart(2, " ")}
              </span>
              <span className="text-muted">{c.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="border-b border-line">
        <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] text-faint transition-colors hover:text-muted">
          {assignment.tests.length} tests · read them before you accept
        </summary>
        {/* Expressions can be long; they scroll rather than widening the page. */}
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full border-separate border-spacing-y-1 text-[11.5px]">
            <tbody>
              {assignment.tests.map((t) => (
                <tr key={t.id} className="font-mono align-top">
                  <td className="pr-3 text-faint whitespace-nowrap">
                    c{t.clause} {t.visible ? "shown" : "hidden"}
                  </td>
                  <td className="pr-3 text-ink">{t.expr}</td>
                  <td className="text-muted whitespace-nowrap">
                    {t.kind === "raises"
                      ? `raises ${String(t.expected)}`
                      : `→ ${JSON.stringify(t.expected)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="px-4 py-3">
        {/* Said plainly rather than buried: the visitor should weigh the tests
            knowing what wrote them, and knowing what was already checked. */}
        <p className="text-[12px] leading-relaxed text-muted">
          A model wrote this rubric and these tests. Before you were shown them,
          it also wrote a solution of its own and the sandbox ran it against
          them — it scored full marks, which is the only reason they are here.
          Your mark will still be computed by running your code, not by a model.
        </p>

        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <button
            onClick={onAccept}
            disabled={disabled}
            className="rounded-lg bg-ink px-4 py-2.5 font-medium text-bg transition-all duration-200
                       hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(255,255,255,0.35)]
                       disabled:cursor-not-allowed disabled:opacity-40
                       disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {disabled ? "Running…" : "Grade my code against these"}
          </button>
          <button
            onClick={onDiscard}
            disabled={disabled}
            className="font-mono text-[11px] text-faint transition-colors hover:text-ink disabled:opacity-40"
          >
            discard and rewrite
          </button>
        </div>
      </div>
    </div>
  );
}
