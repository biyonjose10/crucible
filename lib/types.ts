/**
 * Core domain types for Crucible.
 *
 * Note the deliberate absence of any AI-related type in this file. Scores,
 * test results and rubric clauses are produced entirely by sandboxed
 * execution. The model never touches them.
 */

export type TestKind = "value" | "raises";

/** A single executable assertion, derived from exactly one rubric clause. */
export interface TestCase {
  id: string;
  /** The rubric clause this test verifies. Every test must map to one. */
  clause: number;
  /** Visible tests are shown to students; hidden tests defeat hardcoding. */
  visible: boolean;
  label: string;
  /** A Python expression evaluated against the student's module. */
  expr: string;
  kind: TestKind;
  /** Expected value, or the exception name when kind === "raises". */
  expected: unknown;
}

export type TestStatus = "pass" | "fail" | "inconclusive";

/**
 * The outcome of one test. `trace` holds the raw Python traceback and is the
 * only evidence the diagnosis model is ever shown.
 */
export interface TestResult {
  id: string;
  status: TestStatus;
  got?: string;
  expected?: string;
  /** Raw interpreter output. Never generated, only captured. */
  trace?: string;
}

export interface RubricClause {
  id: number;
  points: number;
  text: string;
}

export interface Assignment {
  slug: string;
  title: string;
  language: "python";
  /** The function signature students must implement. */
  signature: string;
  prompt: string;
  starterCode: string;
  clauses: RubricClause[];
  tests: TestCase[];
}

/** Why a submission could not be scored, when that happens. */
export type InconclusiveReason = "timeout" | "worker_error";

export interface ExecutionOutcome {
  submissionId: string;
  results: TestResult[];
  /** Populated when the module failed to import (syntax errors, etc). */
  importError?: string;
  inconclusive?: InconclusiveReason;
  durationMs: number;
}
