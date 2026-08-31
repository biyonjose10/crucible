/**
 * Ask /api/author for a suite, then check it the way the browser will.
 *
 * The product runs this self-check client-side in the visitor's warm Pyodide
 * pool. This script does the same thing from Node against a running dev server,
 * so a change to the authoring prompt can be tested across a dozen problems in
 * a minute instead of by clicking through a browser a dozen times.
 *
 *   npm run check-suite -- "return the two largest numbers, largest first"
 *   npm run check-suite            # runs the built-in sample problems
 *
 * The bar is the same one the UI enforces: the model's own reference solution
 * must score full marks against the suite it shipped with. Anything less means
 * the tests are wrong, and grading a visitor against them would be meaningless.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";

import { validateTransported } from "../lib/authoring";
import { parseOutcome, runSubmission } from "../lib/runner";
import { score } from "../lib/scoring";
import type { Assignment } from "../lib/types";

const ENDPOINT = process.env.CRUCIBLE_URL ?? "http://localhost:3000";

const SAMPLES = [
  "Return the two largest numbers in a list, largest first. Raise ValueError if there are fewer than two.",
  "Count how many times each word appears in a sentence, returning a dictionary. Ignore case.",
  "Return the nth Fibonacci number, where the 0th is 0 and the 1st is 1. Raise ValueError for negative n.",
  "Check whether a string is a palindrome, ignoring case, spaces and punctuation.",
  "Return the list sorted, but with all the even numbers before all the odd ones.",
];

interface AuthorResponse {
  ok: boolean;
  reason?: string;
  assignment?: unknown;
  reference?: string;
}

async function requestSuite(
  problem: string,
  retryHint?: string,
): Promise<{ assignment: Assignment; reference: string } | string> {
  const response = await fetch(`${ENDPOINT}/api/author`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ problem, retryHint }),
  });

  if (!response.ok) return `HTTP ${response.status}: ${await response.text()}`;

  const body = (await response.json()) as AuthorResponse;
  if (!body.ok) return body.reason ?? "refused with no reason";

  // Deliberately validated through the *transport* path rather than trusting
  // the route's own output, so this also exercises the slug round-trip that
  // /api/diagnose depends on.
  const assignment = validateTransported(body.assignment);
  if (typeof assignment === "string") return `transport rejected: ${assignment}`;

  return { assignment, reference: body.reference ?? "" };
}

/** Run one submission against one suite. Mirrors GraderPool.run in the browser. */
function runAgainst(py: PyodideInterface, assignment: Assignment, code: string) {
  const started = Date.now();
  const lines: string[] = [];
  const marker = runSubmission(py as never, code, assignment.tests, (l) => lines.push(l));

  return parseOutcome(
    "reference",
    assignment.tests,
    lines,
    Date.now() - started,
    undefined,
    marker,
  );
}

async function checkOne(py: PyodideInterface, problem: string): Promise<boolean> {
  process.stdout.write(`\n\x1b[1m${problem}\x1b[0m\n`);

  let hint: string | undefined;

  // One retry, feeding back why the first attempt failed — the same budget the
  // UI gives it. A blind second attempt mostly reproduces the first mistake.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const suite = await requestSuite(problem, hint);
    if (typeof suite === "string") {
      process.stdout.write(`  \x1b[31mattempt ${attempt}: ${suite}\x1b[0m\n`);
      hint = suite;
      continue;
    }

    const { assignment, reference } = suite;
    const outcome = runAgainst(py, assignment, reference);
    const report = score(assignment, outcome);
    const clean = report.status === "graded" && report.earned === report.total;

    const summary =
      `  attempt ${attempt}: ${assignment.clauses.length} clauses, ` +
      `${assignment.tests.length} tests, reference scores ` +
      `${report.earned}/${report.total} (${report.status})`;

    if (clean) {
      process.stdout.write(`\x1b[32m${summary}\x1b[0m\n`);
      return true;
    }

    process.stdout.write(`\x1b[31m${summary}\x1b[0m\n`);

    // Name the failing tests. This is exactly what the retry hint carries.
    const failures = report.clauses
      .flatMap((c) => c.results)
      .filter((r) => r.status !== "pass")
      .map((r) => {
        const test = assignment.tests.find((t) => t.id === r.id);
        return `${test?.expr ?? r.id} gave ${r.got ?? "no result"}, expected ${r.expected}`;
      });

    for (const f of failures) process.stdout.write(`      ${f}\n`);
    if (outcome.importError) {
      // The last line of a Python traceback is blank, and the harness strips
      // its own frames — so take the last line that actually says something.
      const lines = outcome.importError.split("\n").filter((l) => l.trim());
      process.stdout.write(`      import error: ${lines.at(-1) ?? "(empty)"}\n`);
      process.stdout.write(`      reference:\n${reference.replace(/^/gm, "        ")}\n`);
    }

    hint =
      "Your reference solution failed your own tests: " +
      failures.slice(0, 4).join("; ");
  }

  return false;
}

async function main() {
  const problems = process.argv.slice(2).length ? process.argv.slice(2) : SAMPLES;

  const py = await loadPyodide({ stdout: () => {} });

  let passed = 0;
  for (const problem of problems) {
    if (await checkOne(py, problem)) passed++;
  }

  process.stdout.write(
    `\n${passed}/${problems.length} problems produced a suite their own author passes.\n`,
  );
  process.exit(passed === problems.length ? 0 : 1);
}

main();
