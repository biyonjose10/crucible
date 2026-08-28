/**
 * Whether a cached explanation is safe to reuse for a different submission.
 *
 * Two students with the same misconception share a failure signature and
 * therefore a cached explanation. That reuse is what keeps cost proportional to
 * the number of distinct mistakes rather than the number of students, and it is
 * worth protecting.
 *
 * The hazard is that prose quotes identifiers in backticks, and a class rarely
 * agrees on variable names — `fixtures/class.ts` deliberately renames each
 * student's local. A cached "your `ordered` list" shown to a student whose
 * variable is `seq` is wrong in a way they would notice immediately.
 *
 * Rather than weaken the cache key and lose the dedupe entirely, a hit is
 * rejected only when its wording would actually be wrong for this submission.
 * Generic prose still serves everyone; specific prose is regenerated for
 * whoever it does not fit.
 *
 * This lives apart from lib/diagnose.ts on purpose: that module constructs a
 * Gemini client at import time, and a pure predicate should be testable
 * without a network or an API key.
 */

/** Names belonging to the language or the task, not to one student's code. */
export const SHARED_VOCABULARY = new Set([
  "median", "nums", "float", "int", "str", "list", "len", "sorted", "sort",
  "ValueError", "IndexError", "TypeError", "None", "True", "False", "return",
  "def", "raise", "if", "else", "elif", "for", "while", "in", "and", "or",
  "not", "is", "type", "print", "range", "sum", "abs", "round", "math",
]);

export function mentionsUnknownIdentifier(
  summary: string,
  code: string,
): boolean {
  const quoted = [...summary.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map(
    (m) => m[1],
  );
  if (quoted.length === 0) return false;

  return quoted.some((name) => {
    if (SHARED_VOCABULARY.has(name)) return false;
    // Escaped so the pattern is a word boundary. In a template literal a bare
    // \b is the backspace character, which would silently match nothing and
    // make this predicate always return true.
    return !new RegExp(`\\b${name}\\b`).test(code);
  });
}

/**
 * Strip the markdown a model reaches for when it writes a longer answer.
 *
 * The diagnosis is rendered as plain text with `whitespace-pre-wrap`, so a
 * heading arrives on screen as a literal "### What Went Wrong" and emphasis as
 * literal asterisks. Observed live: short single-issue answers came back clean,
 * but a submission failing three clauses produced a numbered list under a
 * heading — which is exactly what a visitor pasting badly broken code triggers.
 *
 * The system instruction now asks for prose without formatting. This is the
 * backstop for when the model does it anyway, and it runs on the whole
 * accumulated string at render rather than per streamed chunk, so a `**` split
 * across two chunks is still matched once both halves have arrived.
 *
 * Deliberately narrow:
 *  • Backticks are LEFT ALONE. The panels rely on `identifier` reading as code,
 *    and mentionsUnknownIdentifier above parses them to decide cache reuse.
 *  • List markers are left alone; "- item" reads correctly as plain text.
 *  • Only ** and __ are unwrapped. A single asterisk is more likely to be
 *    arithmetic or a glob than emphasis.
 */
export function toPlainProse(summary: string): string {
  return summary
    // ATX headings: drop the marker, keep the words.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    // Bold. The \S guards stop an empty match from eating adjacent text.
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "$1");
}
