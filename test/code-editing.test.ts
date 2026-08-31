import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEdit,
  editForBackspace,
  editForEnter,
  editForTab,
} from "../lib/code-editing";

/**
 * Each case writes the buffer with a caret marker so the intent is readable.
 * `|` is the caret; `[` and `]` bracket a selection.
 */
function parse(spec: string): { value: string; start: number; end: number } {
  if (spec.includes("[")) {
    const start = spec.indexOf("[");
    const end = spec.indexOf("]") - 1;
    return { value: spec.replace(/[[\]]/g, ""), start, end };
  }
  const start = spec.indexOf("|");
  return { value: spec.replace("|", ""), start, end: start };
}

function afterEnter(spec: string): string {
  const { value, start, end } = parse(spec);
  const edit = editForEnter(value, start, end);
  return applyEdit(value, edit);
}

function afterTab(spec: string, shift = false): string {
  const { value, start, end } = parse(spec);
  return applyEdit(value, editForTab(value, start, end, shift));
}

test("Enter carries the current indentation down", () => {
  assert.equal(afterEnter("    x = 1|"), "    x = 1\n    ");
  assert.equal(afterEnter("x = 1|"), "x = 1\n");
});

test("Enter opens a new level after a colon", () => {
  assert.equal(
    afterEnter("def f():|"),
    "def f():\n    ",
  );
  assert.equal(
    afterEnter("    if a > b:|"),
    "    if a > b:\n        ",
  );
});

test("a colon that is not at the end of the line does not open a block", () => {
  // The mistake this guards: treating any colon on the line as a block opener.
  assert.equal(afterEnter("d = {'a': 1}|"), "d = {'a': 1}\n");
});

test("Enter mid-line does not invent an indent from a colon ahead of the caret", () => {
  assert.equal(afterEnter("    x = 1| + 2:"), "    x = 1\n     + 2:");
});

test("Tab from a caret indents to the next stop, not by a fixed four", () => {
  assert.equal(afterTab("|x"), "    x");
  // Two columns in, only two spaces are needed to reach the grid.
  assert.equal(afterTab("  |x"), "    x");
  assert.equal(afterTab("    |x"), "        x");
});

test("Shift+Tab removes one level, and never more than exists", () => {
  assert.equal(afterTab("        x|", true), "    x");
  assert.equal(afterTab("  x|", true), "x");
  assert.equal(afterTab("x|", true), "x");
});

test("Tab indents every line a selection touches", () => {
  const spec = "def f():\n[a = 1\nb = 2\n]c = 3";
  assert.equal(afterTab(spec), "def f():\n    a = 1\n    b = 2\nc = 3");
});

test("a selection ending at a line start does not drag in the line below", () => {
  // `c = 3` is after the trailing newline and must be left alone.
  const { value, start, end } = parse("[a = 1\n]c = 3");
  const edit = editForTab(value, start, end, false);
  assert.equal(applyEdit(value, edit), "    a = 1\nc = 3");
});

test("Shift+Tab dedents a whole selection", () => {
  const spec = "[    a = 1\n    b = 2]";
  assert.equal(afterTab(spec, true), "a = 1\nb = 2");
});

test("a multi-line indent keeps the same lines selected", () => {
  const { value, start, end } = parse("[a = 1\nb = 2]");
  const edit = editForTab(value, start, end, false);

  const next = applyEdit(value, edit);
  assert.equal(next, "    a = 1\n    b = 2");
  // Both lines still covered, so Tab can be pressed again.
  assert.equal(next.slice(edit.caret, edit.caretEnd), "    a = 1\n    b = 2");
});

test("Backspace in leading whitespace removes a full level", () => {
  const { value, start, end } = parse("        |x");
  const edit = editForBackspace(value, start, end)!;
  assert.equal(applyEdit(value, edit), "    x");
});

test("Backspace off the grid falls back to the nearest stop", () => {
  const { value, start, end } = parse("      |x");
  const edit = editForBackspace(value, start, end)!;
  assert.equal(applyEdit(value, edit), "    x");
});

test("Backspace outside leading whitespace is left to the browser", () => {
  const mid = parse("    x = 1|");
  assert.equal(editForBackspace(mid.value, mid.start, mid.end), null);

  const home = parse("|x");
  assert.equal(editForBackspace(home.value, home.start, home.end), null);

  // A selection is a deletion of that selection, not an outdent.
  const sel = parse("    [x]");
  assert.equal(editForBackspace(sel.value, sel.start, sel.end), null);
});

test("indentation survives a realistic sequence", () => {
  // def f(): ⏎ if a: ⏎ return 1 — the shape the visitor box has to support.
  let value = "def largest(a, b):";
  let caret = value.length;

  const step = (edit: ReturnType<typeof editForEnter>) => {
    value = applyEdit(value, edit);
    caret = edit.caret;
  };

  step(editForEnter(value, caret, caret));
  value = applyEdit(value, { start: caret, end: caret, text: "if a > b:", caret });
  caret += "if a > b:".length;

  step(editForEnter(value, caret, caret));
  value = applyEdit(value, { start: caret, end: caret, text: "return a", caret });

  assert.equal(value, "def largest(a, b):\n    if a > b:\n        return a");
});
