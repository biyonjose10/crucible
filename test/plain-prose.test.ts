/**
 * toPlainProse — the backstop for a model that formats when asked not to.
 *
 * The diagnosis is rendered with `whitespace-pre-wrap` and no markdown parser,
 * so anything left here reaches the student as literal punctuation. These cases
 * are taken from what the deployed build actually produced on 2026-08-28.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlainProse } from "../lib/prose-guard";

test("strips an ATX heading but keeps its words", () => {
  assert.equal(toPlainProse("### What Went Wrong"), "What Went Wrong");
  assert.equal(toPlainProse("# H1\n###### H6"), "H1\nH6");
});

test("unwraps bold without eating the surrounding sentence", () => {
  assert.equal(
    toPlainProse("1. **Even-length lists**: your code selects the wrong index."),
    "1. Even-length lists: your code selects the wrong index.",
  );
  assert.equal(toPlainProse("__Return type__ is wrong"), "Return type is wrong");
});

test("handles the observed multi-issue answer end to end", () => {
  const raw = [
    "### What Went Wrong",
    "",
    "1. **Even-length lists**: returns `ordered[len // 2]`.",
    "2. **Empty input**: raises `IndexError`.",
  ].join("\n");

  assert.equal(
    toPlainProse(raw),
    [
      "What Went Wrong",
      "",
      "1. Even-length lists: returns `ordered[len // 2]`.",
      "2. Empty input: raises `IndexError`.",
    ].join("\n"),
  );
});

test("leaves backticks alone", () => {
  // The panels rely on these reading as code, and mentionsUnknownIdentifier
  // parses them to decide whether a cached explanation may be reused.
  const s = "Check whether `nums` is empty and raise `ValueError`.";
  assert.equal(toPlainProse(s), s);
});

test("leaves list markers and lone asterisks alone", () => {
  assert.equal(toPlainProse("- first\n- second"), "- first\n- second");
  // More likely arithmetic or a glob than emphasis.
  assert.equal(toPlainProse("use i * 2 == len(s)"), "use i * 2 == len(s)");
});

test("leaves a hash that is not a heading alone", () => {
  assert.equal(toPlainProse("the # character"), "the # character");
  assert.equal(toPlainProse("#nospace"), "#nospace");
});

test("is a no-op on the prose we actually want", () => {
  const s = "You are missing a colon at the end of your function definition line.";
  assert.equal(toPlainProse(s), s);
});

test("tolerates a half-arrived bold marker mid-stream", () => {
  // The opener has streamed but the closer has not. It must not eat the tail.
  assert.equal(toPlainProse("1. **Even-length"), "1. **Even-length");
  // And resolves once the closer lands.
  assert.equal(toPlainProse("1. **Even-length**"), "1. Even-length");
});

test("is empty-safe", () => {
  assert.equal(toPlainProse(""), "");
});
