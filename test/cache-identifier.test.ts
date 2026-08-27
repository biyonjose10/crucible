import assert from "node:assert/strict";
import test from "node:test";

import { mentionsUnknownIdentifier as guard } from "../lib/prose-guard";

/**
 * The cached-prose identifier guard.
 *
 * Two students with the same misconception share a cached explanation — that
 * reuse is what keeps cost proportional to the number of distinct mistakes.
 * But `fixtures/class.ts` renames each student's local variable, so a cached
 * "your `ordered` list" must not be shown to a student whose variable is `seq`.
 *
 * The word-boundary test is the fragile part. Written with a single
 * backslash inside a template literal it becomes the backspace character,
 * matches nothing, and the predicate silently returns true for everything —
 * destroying the dedupe without failing anything visible. The second test
 * below is what catches that, and it has already caught it once.
 */

const CODE_SEQ =
  "def median(nums: list[float]) -> float:\n" +
  "    seq = sorted(nums)\n" +
  "    n = len(seq)\n" +
  "    return float(seq[n // 2])\n";

test("prose naming a variable this student did not write is rejected", () => {
  assert.equal(guard("your `ordered` list is already sorted", CODE_SEQ), true);
});

test("prose naming this student's own variable is accepted", () => {
  assert.equal(
    guard("your `seq` list is already sorted", CODE_SEQ),
    false,
    "a bare \\b would be a backspace character and make this fail",
  );
});

test("shared vocabulary is not treated as a mismatch", () => {
  assert.equal(guard("the `median` function must return a `float`", CODE_SEQ), false);
});

test("prose quoting no identifiers is shared with everyone", () => {
  assert.equal(
    guard("The two middle values must be averaged, not indexed.", CODE_SEQ),
    false,
  );
});

test("one unknown identifier among known ones still rejects", () => {
  assert.equal(
    guard("`median` sorts into `ordered`, then indexes `seq`", CODE_SEQ),
    true,
  );
});
