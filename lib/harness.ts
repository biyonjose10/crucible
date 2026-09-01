export const SOLUTION_DIR = "/home/pyodide";
export const SOLUTION_PATH = `${SOLUTION_DIR}/solution.py`;

/**
 * The sandbox side of grading — and deliberately almost nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  NOTHING HERE DECIDES ANYTHING.
 *
 *  This module produces three kinds of Python: a setup program, an import
 *  program, and one expression per test. Every one of them *evaluates*; none
 *  of them compares, scores, or reports. The pass/fail decision is made in
 *  TypeScript, in lib/runner.ts, on values that have already crossed out of
 *  the interpreter the student's code runs in.
 *
 *  That is the whole point, and it was learned the hard way. This file used
 *  to run the comparison in Python and print result lines to a stdout channel
 *  tagged with an unguessable per-run marker. Both defences were real and both
 *  were beside the point: Pyodide executes `runPython` in `__main__`, and a
 *  submission is imported *before* the tests run, so the student's own module
 *  could reach `sys.modules["__main__"].__dict__` and simply help itself —
 *  replace the comparator with `lambda got, expected: True`, read the marker
 *  and write to the saved stdout handle, or call the emitter directly. Each
 *  scored 10/10 for code worth 8/10. They are the `patched-comparator`,
 *  `stolen-marker` and `borrowed-emit` archetypes in scripts/verify.ts.
 *
 *  An unguessable secret is no defence when it is a global in a namespace the
 *  attacker can read. The fix is not a better secret; it is having nothing
 *  worth stealing in the interpreter at all.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Longest traceback we keep. Real evidence, but bounded token cost. */
export const MAX_TRACE = 2000;

/**
 * Prepare the interpreter for one submission.
 *
 * Writes the student's source, resets the module cache, and points stdout at
 * a sink that discards. That last part is now housekeeping rather than
 * security: results no longer travel as text, so a submission that prints is
 * merely noisy. It is discarded rather than buffered because a loop printing
 * for five seconds would otherwise grow a string until the tab died.
 *
 * The source is embedded via json.loads rather than interpolated into a
 * literal, so no combination of quotes, backslashes or newlines can break out
 * of the string and alter the program around it.
 */
export function buildSetup(solution: string): string {
  const embedded = JSON.stringify(JSON.stringify(solution));

  return [
    "import json, sys",
    "",
    "class _CruSink:",
    "    def write(self, s):",
    "        return len(s)",
    "    def flush(self):",
    "        pass",
    "",
    "sys.stdout = _CruSink()",
    "sys.__stdout__ = sys.stdout",
    "",
    `SOLUTION = json.loads(${embedded})`,
    `with open(${JSON.stringify(SOLUTION_PATH)}, "w") as _f:`,
    "    _f.write(SOLUTION)",
    `if ${JSON.stringify(SOLUTION_DIR)} not in sys.path:`,
    `    sys.path.insert(0, ${JSON.stringify(SOLUTION_DIR)})`,
    // A module cached from a previous submission would silently grade the
    // wrong student's code.
    'sys.modules.pop("solution", None)',
    "",
  ].join("\n");
}

/**
 * Import the submission and report whether it imported.
 *
 * Evaluates to the traceback string on failure and to None on success, which
 * the caller reads as a return value rather than off a stream. On success the
 * module's public names are copied into globals so each test expression can
 * call `median(...)` rather than `solution.median(...)`.
 *
 * Student names landing in `__main__` is safe in a way it very much was not
 * before: there is no longer anything in that namespace whose corruption
 * could change a mark. A submission that defines its own `repr` will make its
 * own feedback read strangely and will not move a single point.
 */
export const IMPORT_PROGRAM = [
  "import traceback",
  "try:",
  "    import solution",
  "except BaseException:",
  "    _cru_import_error = traceback.format_exc()",
  "else:",
  "    _cru_import_error = None",
  "    for _cru_k in dir(solution):",
  "        if not _cru_k.startswith('__'):",
  "            globals()[_cru_k] = getattr(solution, _cru_k)",
  "_cru_import_error",
].join("\n");

/**
 * One test expression, wrapped so the value arrives with its Python repr.
 *
 * The repr is display only — it is what the student and the diagnosis model
 * see as "got". The comparison never touches it; lib/runner.ts compares the
 * *value*. A submission that patches `repr` can therefore make its own
 * feedback misleading and cannot alter its score, which is the right side of
 * that trade to be on.
 *
 * The lambda is built fresh inside the expression, so there is no name here
 * for a submission to have replaced beforehand.
 */
export function buildProbe(expr: string): string {
  return `(lambda _cru_v: (_cru_v, repr(_cru_v)))(${expr})`;
}
