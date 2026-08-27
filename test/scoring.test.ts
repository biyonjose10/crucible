import assert from "node:assert/strict";
import test from "node:test";

import { MEDIAN } from "../lib/assignment";
import { failureSignature, score } from "../lib/scoring";
import type { ExecutionOutcome, TestResult } from "../lib/types";

/**
 * Unit tests for the scoring engine.
 *
 * These are pure — no interpreter, no network, no model — because the thing
 * being tested is pure. `scripts/verify.ts` covers the other half by running
 * real Python through the real sandbox; this file covers the edge cases that
 * are awkward to provoke with real code, chiefly the difference between a test
 * that failed and a test that never reported.
 */

const outcomeFrom = (
  results: TestResult[],
  extra: Partial<ExecutionOutcome> = {},
): ExecutionOutcome => ({
  submissionId: "t",
  results,
  durationMs: 1,
  ...extra,
});

const allPassing = (): TestResult[] =>
  MEDIAN.tests.map((t) => ({ id: t.id, status: "pass" as const }));

test("a submission that passes every test earns every point", () => {
  const report = score(MEDIAN, outcomeFrom(allPassing()));
  assert.equal(report.status, "graded");
  assert.equal(report.earned, report.total);
  assert.equal(report.earned, 10);
});

test("a clause is all-or-nothing: one failing test forfeits the whole clause", () => {
  const results = allPassing();
  const victim = MEDIAN.tests.find((t) => t.clause === 2)!;
  results.find((r) => r.id === victim.id)!.status = "fail";

  const report = score(MEDIAN, outcomeFrom(results));
  const clause2 = report.clauses.find((c) => c.clause === 2)!;

  assert.equal(clause2.status, "fail");
  assert.equal(clause2.earned, 0, "partial credit within a clause is a judgement call we refuse to make");
  assert.equal(report.earned, 8);
});

test("a test that never reported is inconclusive, not a failure", () => {
  // Drop one result entirely, as a killed interpreter would.
  const results = allPassing().filter((r) => r.id !== "t2a");
  const report = score(MEDIAN, outcomeFrom(results, { inconclusive: "timeout" }));

  const clause2 = report.clauses.find((c) => c.clause === 2)!;
  assert.equal(clause2.status, "inconclusive");
  assert.equal(report.status, "inconclusive");
  assert.equal(clause2.earned, 0, "an unanswered question earns nothing, but is not marked wrong");
});

test("an import error fails every test rather than leaving them unknown", () => {
  // The module never loaded, so we know each test would not have passed —
  // that is different from not having asked.
  const report = score(
    MEDIAN,
    outcomeFrom([], { importError: "SyntaxError: expected ':'" }),
  );

  assert.equal(report.status, "graded");
  assert.equal(report.earned, 0);
  assert.ok(report.clauses.every((c) => c.status === "fail"));
});

test("scoring is deterministic for identical input", () => {
  const results = allPassing();
  results.find((r) => r.id === "t4a")!.status = "fail";

  const a = score(MEDIAN, outcomeFrom(results));
  const b = score(MEDIAN, outcomeFrom(results));
  assert.deepEqual(a, b);
});

test("failure signatures collapse identical failures and separate different ones", () => {
  const withClause = (clause: number) => {
    const results = allPassing();
    const victim = MEDIAN.tests.find((t) => t.clause === clause)!;
    results.find((r) => r.id === victim.id)!.status = "fail";
    return failureSignature(score(MEDIAN, outcomeFrom(results)));
  };

  assert.equal(withClause(2), withClause(2), "same mistake, same signature — this is what makes one diagnosis serve many students");
  assert.notEqual(withClause(2), withClause(4));
});

test("a clean run has a distinct signature from any failure", () => {
  const clean = failureSignature(score(MEDIAN, outcomeFrom(allPassing())));
  assert.equal(clean, "clean");
});

test("import errors collapse to their final line, not the whole traceback", () => {
  const one = failureSignature(
    score(MEDIAN, outcomeFrom([], {
      importError: 'File "/a.py", line 1\n    def f(\nSyntaxError: bad',
    })),
  );
  const two = failureSignature(
    score(MEDIAN, outcomeFrom([], {
      importError: 'File "/b.py", line 9\n    def g(\nSyntaxError: bad',
    })),
  );
  assert.equal(one, two, "two students with the same syntax error should share one diagnosis");
});
