import assert from "node:assert/strict";
import test from "node:test";

import { judge, pyRepr, sameValue } from "../lib/runner";
import type { Probe } from "../lib/runner";
import type { TestCase } from "../lib/types";

/**
 * Unit tests for the judge.
 *
 * This is where a grade is now decided, so it is worth testing directly rather
 * than only through `scripts/verify.ts`. The comparison used to live in Python
 * inside the sandbox, where a submission could replace it; moving it here is
 * what made three forgery archetypes stop working, and these tests pin the
 * semantics that move preserved.
 */

const valueTest = (id: string, expected: unknown): TestCase => ({
  id,
  clause: 1,
  visible: true,
  label: id,
  expr: `f(${id})`,
  kind: "value",
  expected,
});

const raisesTest = (id: string, expected: string): TestCase => ({
  ...valueTest(id, expected),
  kind: "raises",
});

const returned = (id: string, value: unknown, repr?: string): Probe => ({
  id,
  raised: false,
  value,
  repr,
});

const threw = (id: string, errorType: string, errorTrace?: string): Probe => ({
  id,
  raised: true,
  errorType,
  errorTrace,
});

// ── sameValue ──────────────────────────────────────────────────────────────

test("floats are compared with a tolerance, not exact equality", () => {
  assert.equal(sameValue(0.1 + 0.2, 0.3), true);
  assert.equal(sameValue(2.5, 2.5), true);
  assert.equal(sameValue(2.5, 3.0), false);
});

test("a bool is never equal to a number, though Python's bool subclasses int", () => {
  // Python evaluates `True == 1` as true. The old harness guarded against that
  // with an identity check; losing the guard would let `return True` pass a
  // test expecting 1.
  assert.equal(sameValue(true, 1), false);
  assert.equal(sameValue(1, true), false);
  assert.equal(sameValue(false, 0), false);
  assert.equal(sameValue(true, true), true);
});

test("lists compare element-wise, with the same float tolerance", () => {
  assert.equal(sameValue([1, 2, 3], [1, 2, 3]), true);
  assert.equal(sameValue([0.1 + 0.2], [0.3]), true);
  assert.equal(sameValue([1, 2], [1, 2, 3]), false);
  assert.equal(sameValue([1, 2, 3], [3, 2, 1]), false);
});

test("a value that could not cross out of Python matches nothing", () => {
  // Unconvertible objects arrive as undefined. They must not accidentally
  // equal an expected value — least of all a missing one.
  assert.equal(sameValue(undefined, null), false);
  assert.equal(sameValue(undefined, undefined), true);
});

// ── pyRepr ─────────────────────────────────────────────────────────────────

test("expected values are rendered the way Python's repr would", () => {
  // These strings are shown to the student beside `got`, and the old harness
  // produced them with Python's repr on the JSON-decoded value.
  assert.equal(pyRepr("float"), "'float'");
  assert.equal(pyRepr(2.5), "2.5");
  assert.equal(pyRepr(true), "True");
  assert.equal(pyRepr(null), "None");
  assert.equal(pyRepr([1, "a"]), "[1, 'a']");
  assert.equal(pyRepr("it's"), "'it\\'s'");
});

// ── judge ──────────────────────────────────────────────────────────────────

test("a returned value that matches passes, and reports Python's repr", () => {
  const tests = [valueTest("t1", 2.5)];
  const outcome = judge("s", tests, [returned("t1", 2.5, "2.5")], 1, undefined);

  assert.equal(outcome.results[0].status, "pass");
  assert.equal(outcome.results[0].got, "2.5");
});

test("a mismatch fails and shows both sides", () => {
  const tests = [valueTest("t1", 2.5)];
  const outcome = judge("s", tests, [returned("t1", 3, "3.0")], 1, undefined);

  assert.equal(outcome.results[0].status, "fail");
  assert.equal(outcome.results[0].got, "3.0");
  assert.equal(outcome.results[0].expected, "2.5");
});

test("the repr is display only — it cannot turn a wrong value into a pass", () => {
  // The `patched-repr` archetype in fixture form: a submission that rewrites
  // repr changes this string and nothing else.
  const tests = [valueTest("t1", 2.5)];
  const outcome = judge("s", tests, [returned("t1", 3, "2.5")], 1, undefined);

  assert.equal(outcome.results[0].status, "fail");
});

test("a raises test passes only on the named exception", () => {
  const tests = [raisesTest("t1", "ValueError")];

  assert.equal(
    judge("s", tests, [threw("t1", "ValueError")], 1, undefined).results[0].status,
    "pass",
  );
  assert.equal(
    judge("s", tests, [threw("t1", "TypeError")], 1, undefined).results[0].status,
    "fail",
  );
});

test("a raises test fails when the call returns instead of raising", () => {
  const tests = [raisesTest("t1", "ValueError")];
  const outcome = judge("s", tests, [returned("t1", 0, "0.0")], 1, undefined);

  assert.equal(outcome.results[0].status, "fail");
  assert.match(outcome.results[0].got ?? "", /without raising/);
});

test("an unexpected exception on a value test fails with its last line", () => {
  const tests = [valueTest("t1", 2.5)];
  const trace = 'Traceback (most recent call last):\n  File "x"\nValueError: empty list\n';
  const outcome = judge("s", tests, [threw("t1", "ValueError", trace)], 1, undefined);

  assert.equal(outcome.results[0].status, "fail");
  assert.equal(outcome.results[0].got, "ValueError: empty list");
});

test("harness frames are stripped from the traceback a student sees", () => {
  const tests = [valueTest("t1", 2.5)];
  const trace = 'Traceback:\n  File "<exec>", line 1\n  File "solution.py", line 3\nValueError: x';
  const outcome = judge("s", tests, [threw("t1", "ValueError", trace)], 1, undefined);

  assert.ok(!outcome.results[0].trace?.includes("<exec>"));
  assert.ok(outcome.results[0].trace?.includes("solution.py"));
});

test("a test with no observation is omitted, never guessed at", () => {
  // scoring.ts turns an absent result into "inconclusive". Inventing a pass or
  // a fail here would be the whole project's failure mode.
  const tests = [valueTest("t1", 1), valueTest("t2", 2)];
  const outcome = judge("s", tests, [returned("t1", 1, "1")], 1, "timeout");

  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].id, "t1");
  assert.equal(outcome.inconclusive, "timeout");
});

test("an import error is carried through with no results", () => {
  const tests = [valueTest("t1", 1)];
  const outcome = judge("s", tests, [], 1, undefined, "SyntaxError: bad");

  assert.equal(outcome.results.length, 0);
  assert.equal(outcome.importError, "SyntaxError: bad");
});

test("results follow the suite's declaration order, not the probes'", () => {
  // The pool pushes probes as they arrive. A reordering would show a student
  // their failures in an order that does not match the rubric.
  const tests = [valueTest("t1", 1), valueTest("t2", 2), valueTest("t3", 3)];
  const outcome = judge(
    "s",
    tests,
    [returned("t3", 3, "3"), returned("t1", 1, "1"), returned("t2", 2, "2")],
    1,
    undefined,
  );

  assert.deepEqual(
    outcome.results.map((r) => r.id),
    ["t1", "t2", "t3"],
  );
});
