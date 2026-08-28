import { MEDIAN } from "../lib/assignment";
import { ARCHETYPES, type Archetype } from "./archetypes";

/**
 * A seeded class of 30 submissions.
 *
 * Built from the eight archetypes rather than hand-written thirty times. Each
 * clone is given a different local variable name and docstring so it reads as
 * a different student's work, but the behaviour — and therefore the failure
 * signature — is identical to its archetype. That is the point: 30 students
 * produce only 8 distinct ways of being wrong, which is why diagnosis cost
 * grows with the number of misconceptions in a class rather than the number of
 * people in it.
 *
 * The roster is fixed and ordered, so a demo runs the same way every time.
 */

export interface Submission {
  id: string;
  student: string;
  /** Which archetype this came from. Drives the expected score in tests. */
  archetype: string;
  code: string;
}

const STUDENTS = [
  "A. Okafor", "B. Lindqvist", "C. Moreau", "D. Nakamura", "E. Barros",
  "F. Haddad", "G. Petrov", "H. Silva", "I. Novak", "J. Mensah",
  "K. Andersen", "L. Rossi", "M. Dubois", "N. Kowalski", "O. Fitzgerald",
  "P. Nguyen", "Q. Almeida", "R. Bergström", "S. Iqbal", "T. Varga",
  "U. Castellanos", "V. Larsen", "W. Oyelaran", "X. Marchetti", "Y. Sørensen",
  "Z. Delacroix", "A. Villanueva", "B. Karlsson", "C. Adeyemi", "D. Halvorsen",
];

/**
 * The distribution. Deliberately realistic: a third of the class has it right,
 * the even-length midpoint is the dominant misconception, and the three
 * interesting pathologies appear once or twice each.
 */
const ROSTER: string[] = [
  "correct", "off-by-one", "correct", "int-return", "empty-crash",
  "correct", "infinite-loop", "off-by-one", "correct", "hardcoded",
  "int-return", "prompt-injection", "correct", "off-by-one", "empty-crash",
  "correct", "syntax-error", "off-by-one", "correct", "int-return",
  "empty-crash", "correct", "off-by-one", "hardcoded", "correct",
  "int-return", "syntax-error", "off-by-one", "correct", "empty-crash",
];

/** Synonyms for the sorted-copy variable. All behaviourally identical. */
const VAR_NAMES = ["ordered", "values", "srt", "arr", "data", "seq"];

const DOCSTRINGS = [
  "",
  '    """Return the median."""\n',
  "    # sort first, then pick the middle\n",
  "    # CS101 assignment 3\n",
];

/**
 * Rewrite a submission so it looks like a different person wrote it, without
 * changing what it does. Whole-word replacement only, so we never corrupt a
 * substring inside another identifier.
 */
function perturb(code: string, seed: number): string {
  const name = VAR_NAMES[seed % VAR_NAMES.length];
  let out = code.replace(/\bordered\b/g, name);

  const doc = DOCSTRINGS[seed % DOCSTRINGS.length];
  if (doc) {
    const firstLine = out.indexOf("\n");
    // Only inject after a def line; the syntax-error archetype has no valid
    // body to inject into and is left exactly as authored.
    if (firstLine !== -1 && out.slice(0, firstLine).includes("def median")) {
      out = out.slice(0, firstLine + 1) + doc + out.slice(firstLine + 1);
    }
  }
  return out;
}

function archetypeFor(key: string): Archetype {
  const found = ARCHETYPES.find((a) => a.key === key);
  if (!found) throw new Error(`fixtures/class.ts references unknown archetype: ${key}`);
  return found;
}

export const CLASS: Submission[] = ROSTER.map((key, index) => {
  const archetype = archetypeFor(key);
  return {
    id: `s${String(index + 1).padStart(2, "0")}`,
    student: STUDENTS[index],
    archetype: key,
    // The syntax-error archetype must stay byte-exact: perturbing broken code
    // risks accidentally fixing it.
    code: key === "syntax-error" ? archetype.code : perturb(archetype.code, index),
  };
});

/**
 * Distinct failure modes present in the class. Drives the dedupe headline.
 *
 * A submission that earns full marks is not a failure mode, so `correct` is
 * excluded. Counting it made the landing page advertise one more distinct
 * mistake than a run could ever report — the stat read 8 while the finished
 * queue, on the same screen, said "29 marked from 7 distinct mistakes".
 *
 * The test is the same one the queue applies at runtime: did this lose marks?
 */
const FULL_MARKS = MEDIAN.clauses.reduce((sum, c) => sum + c.points, 0);

export const DISTINCT_ARCHETYPES = new Set(
  ROSTER.filter((key) => {
    const { expected } = archetypeFor(key);
    return expected.status !== "graded" || expected.earned < FULL_MARKS;
  }),
).size;

/** Find a submission by archetype — used to jump straight to a demo beat. */
export function firstOf(archetypeKey: string): Submission | undefined {
  return CLASS.find((s) => s.archetype === archetypeKey);
}
