/**
 * The scoring engine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS FILE MUST NEVER IMPORT FROM lib/diagnose.ts OR THE ANTHROPIC SDK.
 *
 *  Crucible's entire trust model rests on one property: the grade is a pure
 *  function of sandboxed test execution. The language model explains failures;
 *  it cannot cause them, hide them, or change what they are worth. A test in
 *  test/scoring.test.ts asserts this file's import list stays clean.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  Assignment,
  ExecutionOutcome,
  TestResult,
  TestStatus,
} from "./types";

export interface ClauseScore {
  clause: number;
  text: string;
  points: number;
  earned: number;
  status: TestStatus;
  /** Tests belonging to this clause, in declaration order. */
  results: TestResult[];
}

export interface ScoreReport {
  earned: number;
  total: number;
  clauses: ClauseScore[];
  /** "inconclusive" means at least one clause could not be established. */
  status: "graded" | "inconclusive";
  importError?: string;
  inconclusiveReason?: string;
}

/**
 * A clause is all-or-nothing: partial credit within a clause would require a
 * judgement call, and judgement calls are exactly what we refuse to automate.
 */
function scoreClause(results: TestResult[]): TestStatus {
  if (results.length === 0) return "inconclusive";
  if (results.some((r) => r.status === "inconclusive")) return "inconclusive";
  return results.every((r) => r.status === "pass") ? "pass" : "fail";
}

/**
 * Compute a score from an execution outcome.
 *
 * Deterministic by construction: the same outcome always yields the same
 * report. Running the same class twice produces byte-identical scores, which
 * is the observable proof that no model is involved.
 */
export function score(
  assignment: Assignment,
  outcome: ExecutionOutcome,
): ScoreReport {
  const byId = new Map(outcome.results.map((r) => [r.id, r]));

  const clauses: ClauseScore[] = assignment.clauses.map((clause) => {
    const tests = assignment.tests.filter((t) => t.clause === clause.id);

    const results: TestResult[] = tests.map(
      (t) =>
        byId.get(t.id) ?? {
          id: t.id,
          // A test that produced no result did not run. We do not assume it
          // would have passed, and we do not assume it would have failed.
          status: outcome.importError ? "fail" : "inconclusive",
          expected: String(t.expected),
        },
    );

    const status = scoreClause(results);
    return {
      clause: clause.id,
      text: clause.text,
      points: clause.points,
      earned: status === "pass" ? clause.points : 0,
      status,
      results,
    };
  });

  const total = assignment.clauses.reduce((sum, c) => sum + c.points, 0);
  const earned = clauses.reduce((sum, c) => sum + c.earned, 0);
  const anyInconclusive = clauses.some((c) => c.status === "inconclusive");

  return {
    earned,
    total,
    clauses,
    status: anyInconclusive ? "inconclusive" : "graded",
    importError: outcome.importError,
    inconclusiveReason: outcome.inconclusive,
  };
}

/**
 * A stable hash of *how* a submission failed, independent of who wrote it.
 *
 * Two students who make the same mistake produce the same signature, so the
 * diagnosis is generated once and reused. Cost therefore grows with the number
 * of distinct misconceptions in a class, not the number of students.
 */
export function failureSignature(report: ScoreReport): string {
  if (report.importError) {
    // Collapse the traceback to its final line: "SyntaxError: expected ':'".
    const lines = report.importError.trimEnd().split("\n");
    return `import:${lines[lines.length - 1].trim()}`;
  }
  const failed = report.clauses
    .filter((c) => c.status !== "pass")
    .map((c) => `${c.clause}:${c.status}`)
    .join(",");
  return failed || "clean";
}
