/**
 * Validation for model-authored assignments.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  This file is pure. It imports only `./types`, reads no environment, and
 *  calls no model — so it can be unit-tested without an API key, and the same
 *  function can run on the server that generated an assignment and again on
 *  the server that later receives it back from a browser. That symmetry is the
 *  point: nothing downstream has to trust where an assignment came from.
 *
 *  Same split as lib/prose-guard.ts, for the same reason.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A model may write the test suite. It still cannot mark anything: the tests
 * it produces are executed by the sandbox and scored by `lib/scoring.ts`,
 * which has no path to any model. What this file does is refuse a suite that
 * would produce a *meaningless* mark — one with a clause nothing tests, or a
 * test naming a clause that does not exist.
 */

import type { Assignment, RubricClause, TestCase } from "./types";

/**
 * Size limits.
 *
 * These are cost controls as much as sanity checks. A generated assignment
 * travels back to `/api/diagnose` from the browser and is rendered into the
 * model's prompt there, so an unbounded rubric is an unbounded bill on a key
 * that cannot be quickly rotated. Every ceiling here is well above anything a
 * real exercise needs.
 */
export const AUTHOR_LIMITS = {
  problem: 2_000,
  title: 120,
  prompt: 600,
  signature: 200,
  starterCode: 1_000,
  reference: 4_000,
  clauseText: 200,
  testLabel: 120,
  testExpr: 200,
  expectedJson: 400,
  minClauses: 2,
  maxClauses: 5,
  minPoints: 1,
  maxPoints: 5,
  minTotal: 6,
  maxTotal: 20,
  minTests: 6,
  maxTests: 14,
  /** Ceiling on a whole assignment as JSON, checked on the way back in. */
  maxAssignmentBytes: 16_000,
} as const;

/** The shape a model is asked to produce. Every field is unknown until checked. */
export interface GeneratedAssignment {
  assignment: Assignment;
  /**
   * The model's own solution, written blind alongside the tests.
   *
   * It exists to be executed, not read: if it does not score full marks against
   * the suite that shipped with it, the suite is wrong and grading anyone
   * against it would be meaningless. See `selfCheckPassed`.
   */
  reference: string;
}

/** Prefix marking an assignment that no server registry can vouch for. */
export const CUSTOM_SLUG_PREFIX = "custom-";

export function isCustomSlug(slug: string): boolean {
  return slug.startsWith(CUSTOM_SLUG_PREFIX);
}

/**
 * A slug derived from the assignment's own content.
 *
 * Content-addressed rather than random because `lib/diagnose.ts` keys its
 * explanation cache on `slug#failureSignature`. A constant slug for every
 * generated assignment would let two unrelated problems whose reports happen
 * to share a failure signature serve each other's explanation.
 */
export function slugFor(assignment: Omit<Assignment, "slug">): string {
  // FNV-1a. Not a security primitive — nothing here is a secret, and the only
  // requirement is that different content lands on different keys.
  const json = JSON.stringify([
    assignment.signature,
    assignment.clauses,
    assignment.tests,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return CUSTOM_SLUG_PREFIX + hash.toString(36);
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrowing helpers
//
// Hand-rolled, matching the rest of the codebase — there is no schema library
// here, and `parseTriage` in lib/diagnose.ts establishes the pattern: parse
// defensively, narrow field by field, and never trust that a constrained
// decode came back in the shape it was constrained to.
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A non-empty string within `max`, or null. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max
    ? v
    : null;
}

/**
 * Validate a model's raw output into an assignment, or explain the refusal.
 *
 * Returns a string on rejection rather than throwing — the `T | string`
 * convention `parseBody` uses in app/api/diagnose/route.ts, where a string is
 * the message a human should read.
 */
export function validateGenerated(raw: unknown): GeneratedAssignment | string {
  if (!isRecord(raw)) return "The model did not return an object.";

  const title = str(raw.title, AUTHOR_LIMITS.title);
  if (!title) return "The generated assignment has no usable title.";

  const signature = str(raw.signature, AUTHOR_LIMITS.signature);
  if (!signature) return "The generated assignment has no function signature.";
  if (!signature.startsWith("def ")) {
    return `The generated signature is not a Python function definition: ${signature}`;
  }

  const prompt = str(raw.prompt, AUTHOR_LIMITS.prompt);
  if (!prompt) return "The generated assignment has no problem statement.";

  const reference = str(raw.reference, AUTHOR_LIMITS.reference);
  if (!reference) return "The model did not return a reference solution.";

  // Starter code is the one optional field: a stub is a convenience, and a
  // missing one costs a visitor nothing.
  const starterCode = str(raw.starterCode, AUTHOR_LIMITS.starterCode) ?? `${signature}:\n    ...\n`;

  const clauses = parseClauses(raw.clauses);
  if (typeof clauses === "string") return clauses;

  const tests = parseTests(raw.tests, clauses);
  if (typeof tests === "string") return tests;

  const withoutSlug = {
    title,
    language: "python" as const,
    signature,
    prompt,
    starterCode,
    clauses,
    tests,
  };

  return {
    assignment: { slug: slugFor(withoutSlug), ...withoutSlug },
    reference,
  };
}

function parseClauses(raw: unknown): RubricClause[] | string {
  if (!Array.isArray(raw)) return "The generated rubric is not a list.";
  if (raw.length < AUTHOR_LIMITS.minClauses || raw.length > AUTHOR_LIMITS.maxClauses) {
    return `A rubric needs between ${AUTHOR_LIMITS.minClauses} and ${AUTHOR_LIMITS.maxClauses} clauses; this one has ${raw.length}.`;
  }

  const clauses: RubricClause[] = [];
  const seen = new Set<number>();

  for (const entry of raw) {
    if (!isRecord(entry)) return "A rubric clause is not an object.";

    const id = int(entry.id, 1, AUTHOR_LIMITS.maxClauses);
    if (id === null) return "A rubric clause has no valid id.";
    if (seen.has(id)) return `Two rubric clauses share the id ${id}.`;
    seen.add(id);

    const points = int(entry.points, AUTHOR_LIMITS.minPoints, AUTHOR_LIMITS.maxPoints);
    if (points === null) {
      return `Clause ${id} is worth an invalid number of points.`;
    }

    const text = str(entry.text, AUTHOR_LIMITS.clauseText);
    if (!text) return `Clause ${id} has no description.`;

    clauses.push({ id, points, text });
  }

  const total = clauses.reduce((sum, c) => sum + c.points, 0);
  if (total < AUTHOR_LIMITS.minTotal || total > AUTHOR_LIMITS.maxTotal) {
    return `The rubric totals ${total} points; it must be between ${AUTHOR_LIMITS.minTotal} and ${AUTHOR_LIMITS.maxTotal}.`;
  }

  return clauses;
}

function parseTests(raw: unknown, clauses: RubricClause[]): TestCase[] | string {
  if (!Array.isArray(raw)) return "The generated test suite is not a list.";
  if (raw.length < AUTHOR_LIMITS.minTests || raw.length > AUTHOR_LIMITS.maxTests) {
    return `A suite needs between ${AUTHOR_LIMITS.minTests} and ${AUTHOR_LIMITS.maxTests} tests; this one has ${raw.length}.`;
  }

  const clauseIds = new Set(clauses.map((c) => c.id));
  const tests: TestCase[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!isRecord(entry)) return "A test is not an object.";

    const id = str(entry.id, 32);
    if (!id) return "A test has no usable id.";
    if (seen.has(id)) return `Two tests share the id "${id}".`;
    seen.add(id);

    const clause = int(entry.clause, 1, AUTHOR_LIMITS.maxClauses);
    if (clause === null || !clauseIds.has(clause)) {
      return `Test "${id}" names clause ${String(entry.clause)}, which is not in the rubric.`;
    }

    const label = str(entry.label, AUTHOR_LIMITS.testLabel);
    if (!label) return `Test "${id}" has no label.`;

    const expr = str(entry.expr, AUTHOR_LIMITS.testExpr);
    if (!expr) return `Test "${id}" has no expression to evaluate.`;

    const kind = entry.kind;
    if (kind !== "value" && kind !== "raises") {
      return `Test "${id}" has an unknown kind "${String(kind)}".`;
    }

    // `expected` is any JSON value, which JSON Schema cannot express as a
    // single field, so the model emits it encoded and it is decoded here. The
    // harness round-trips it back through JSON into Python either way.
    const encoded = str(entry.expectedJson, AUTHOR_LIMITS.expectedJson);
    if (!encoded) return `Test "${id}" has no expected value.`;

    let expected: unknown;
    try {
      expected = JSON.parse(encoded);
    } catch {
      return `Test "${id}" has an expected value that is not valid JSON: ${encoded}`;
    }

    if (kind === "raises" && typeof expected !== "string") {
      return `Test "${id}" expects an exception, so its expected value must be the exception's name.`;
    }

    tests.push({ id, clause, visible: entry.visible === true, label, expr, kind, expected });
  }

  // A clause with no tests scores `inconclusive` in lib/scoring.ts, which would
  // withhold its marks from every submission without ever saying why. Refusing
  // here is the difference between a rubric and a rubric-shaped decoration.
  const tested = new Set(tests.map((t) => t.clause));
  const orphan = clauses.find((c) => !tested.has(c.id));
  if (orphan) {
    return `Clause ${orphan.id} ("${orphan.text}") has no test, so nothing could earn its marks.`;
  }

  // Hidden tests are what make hardcoding the visible answers a losing
  // strategy; visible ones are what let a student see what is being asked.
  if (!tests.some((t) => t.visible)) return "The suite has no visible tests.";
  if (!tests.some((t) => !t.visible)) return "The suite has no hidden tests.";

  return tests;
}

/**
 * Re-validate an assignment arriving from a browser.
 *
 * `/api/diagnose` trusts its own registry for the seeded assignment. A
 * generated one has no entry there, so it arrives as input and is checked
 * again — including that its slug still matches its content, which is what
 * stops a rewritten rubric from riding in on a familiar cache key.
 */
export function validateTransported(raw: unknown): Assignment | string {
  if (!isRecord(raw)) return "Field `assignment` must be an object.";

  const size = JSON.stringify(raw).length;
  if (size > AUTHOR_LIMITS.maxAssignmentBytes) {
    return `Field \`assignment\` is ${size} bytes; the limit is ${AUTHOR_LIMITS.maxAssignmentBytes}.`;
  }

  const slug = str(raw.slug, 64);
  if (!slug || !isCustomSlug(slug)) {
    return "Field `assignment.slug` must name a generated assignment.";
  }

  // Reuse the authoring validator rather than writing a second, subtly
  // different one. Two fields have to be adapted first:
  //
  //   • `reference` is not transported. It has already done its job in the
  //     browser, and re-sending it would only enlarge the prompt.
  //   • tests arrive with `expected` decoded, because that is the shape the
  //     harness runs. Re-encoding it is exact — `validateGenerated` parses it
  //     straight back — which is what lets the slug still match below.
  const tests = Array.isArray(raw.tests)
    ? raw.tests.map((t) =>
        isRecord(t) ? { ...t, expectedJson: JSON.stringify(t.expected) } : t,
      )
    : raw.tests;

  const checked = validateGenerated({ ...raw, tests, reference: "pass" });
  if (typeof checked === "string") return checked;

  if (checked.assignment.slug !== slug) {
    return "Field `assignment.slug` does not match the assignment's contents.";
  }

  return checked.assignment;
}
