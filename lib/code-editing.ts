/**
 * The minimum a textarea needs to be usable for Python.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Pure: every function here maps (text, selection) to a described edit. No
 *  DOM, no React, no side effects — so the fiddly parts (what Tab does inside
 *  a multi-line selection, where the caret lands after a dedent) are unit
 *  tested rather than discovered by a visitor mid-demo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The visitor box is a plain `<textarea>` on purpose — a syntax-highlighting
 * editor would add a dependency, a bundle and a set of failure modes to
 * something whose job is to accept a dozen lines of Python. But a bare
 * textarea drops indentation on Enter and lets Tab escape the field, and in a
 * language where indentation *is* the syntax that makes it unusable. This is
 * the smallest thing that fixes that without becoming an editor.
 */

/** Python's conventional indent, and the one the seeded code uses. */
export const INDENT = "    ";
const WIDTH = INDENT.length;

/**
 * A replacement of `[start, end)` with `text`, plus where the selection should
 * end up. Expressed as data so the caller can apply it however it must — the
 * browser wants `execCommand` to keep native undo working, a test wants plain
 * string slicing.
 */
export interface Edit {
  start: number;
  end: number;
  text: string;
  /** Caret position after applying. Defaults to the end of the inserted text. */
  caret: number;
  /** Set when the edit should leave a range selected rather than a caret. */
  caretEnd?: number;
}

/** Apply an edit to a string. The browser path does not use this; tests do. */
export function applyEdit(value: string, edit: Edit): string {
  return value.slice(0, edit.start) + edit.text + value.slice(edit.end);
}

function lineStartAt(value: string, index: number): number {
  return value.lastIndexOf("\n", index - 1) + 1;
}

/**
 * Enter keeps the current indentation, and opens a new level after a colon.
 *
 * The colon test looks at the line up to the caret, not the whole line, so
 * pressing Enter in the middle of a line does not invent an indent from a
 * colon that is still ahead of the cursor.
 */
export function editForEnter(value: string, start: number, end: number): Edit {
  const before = value.slice(lineStartAt(value, start), start);
  const indent = /^[ \t]*/.exec(before)?.[0] ?? "";
  // A trailing comment does not open a block: `if x:  # go` still does, but
  // `x = {}  # a: b` must not. Only a colon at the very end counts.
  const opensBlock = /:\s*$/.test(before);
  const text = "\n" + indent + (opensBlock ? INDENT : "");

  return { start, end, text, caret: start + text.length };
}

/** Indent or dedent every line the selection touches. */
function shiftLines(value: string, start: number, end: number, out: boolean): Edit {
  const from = lineStartAt(value, start);
  // A selection ending exactly at a line start should not drag in the line
  // below it — that is the line the user stopped short of.
  const to = end > from && value[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = value.indexOf("\n", to) === -1 ? value.length : value.indexOf("\n", to);

  const block = value.slice(from, lineEnd);
  const lines = block.split("\n");

  const shifted = lines.map((line) => {
    if (out) return INDENT + line;
    const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
    // Remove up to one indent's worth, and no more than there is.
    const drop = Math.min(lead.length, WIDTH);
    return line.slice(drop);
  });

  const text = shifted.join("\n");
  const delta = text.length - block.length;
  const firstDelta = shifted[0].length - lines[0].length;

  return {
    start: from,
    end: lineEnd,
    text,
    // Keep the same lines selected, so Tab can be pressed repeatedly. A
    // selection that began at a line start stays there rather than being
    // pushed past the indent just inserted — otherwise the first line falls
    // out of the selection and the second Tab indents one line fewer.
    caret: start === from ? from : Math.max(from, start + firstDelta),
    caretEnd: Math.max(from, end + delta),
  };
}

/**
 * Tab indents; Shift+Tab dedents.
 *
 * A caret with nothing selected inserts one indent — but only spaces up to the
 * next stop, so Tab in the middle of already-indented code lands on the grid
 * rather than pushing everything out of alignment.
 */
export function editForTab(
  value: string,
  start: number,
  end: number,
  shift: boolean,
): Edit {
  const multiline = value.slice(start, end).includes("\n");
  if (multiline || (shift && start === end)) {
    return shiftLines(value, start, end, !shift);
  }

  if (start !== end) return shiftLines(value, start, end, !shift);

  const column = start - lineStartAt(value, start);
  const text = " ".repeat(WIDTH - (column % WIDTH));
  return { start, end, text, caret: start + text.length };
}

/**
 * Backspace inside leading whitespace removes a whole indent level.
 *
 * Only inside leading whitespace: everywhere else it must delete one character,
 * which is what returning null asks the caller to let the browser do.
 */
export function editForBackspace(
  value: string,
  start: number,
  end: number,
): Edit | null {
  if (start !== end || start === 0) return null;

  const from = lineStartAt(value, start);
  const before = value.slice(from, start);
  if (before.length === 0 || !/^ +$/.test(before)) return null;

  const column = before.length;
  const drop = column % WIDTH === 0 ? WIDTH : column % WIDTH;

  return { start: start - drop, end: start, text: "", caret: start - drop };
}
