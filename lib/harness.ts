import type { TestCase } from "./types";

export const SOLUTION_DIR = "/home/pyodide";
export const SOLUTION_PATH = `${SOLUTION_DIR}/solution.py`;

/** Marker prefix for machine-readable lines on stdout. */
export const EMIT = "@@CRU@@";

/** Longest traceback we keep. Real evidence, but bounded token cost. */
const MAX_TRACE = 2000;

/**
 * Generate the Python harness that runs a student's module against the tests.
 *
 * Results are emitted one JSON line at a time and flushed immediately, so that
 * if the interpreter is killed mid-run (an infinite loop, say) every result
 * produced before the kill still survives. Tests that never reported are
 * scored "inconclusive" — never assumed to pass, never assumed to fail.
 */
function buildTestBody(tests: TestCase[]): string {
  const payload = JSON.stringify(
    tests.map((t) => ({ id: t.id, expr: t.expr, kind: t.kind, expected: t.expected })),
  );

  return `
import json, math, traceback

TESTS = json.loads(${JSON.stringify(payload)})
MAX_TRACE = ${MAX_TRACE}

def _emit(o):
    print("${EMIT}" + json.dumps(o), flush=True)

def _trace():
    raw = traceback.format_exc().split("\\n")
    # Drop our own frames. A student debugging their code should see their
    # file and their line numbers, not the scaffolding that called them.
    kept = [ln for ln in raw if '"<exec>"' not in ln and '"<string>"' not in ln]
    t = "\\n".join(kept)
    return t[:MAX_TRACE] + (" ... [truncated]" if len(t) > MAX_TRACE else "")

def _same(got, expected):
    numeric = (int, float)
    if isinstance(got, bool) or isinstance(expected, bool):
        return got is expected
    if isinstance(got, numeric) and isinstance(expected, numeric):
        return math.isclose(got, expected, rel_tol=1e-9, abs_tol=1e-9)
    return got == expected

try:
    import solution
except BaseException:
    _emit({"kind": "import_error", "trace": _trace()})
else:
    ns = {"__builtins__": __builtins__, "solution": solution}
    for _k in dir(solution):
        if not _k.startswith("__"):
            ns[_k] = getattr(solution, _k)

    for t in TESTS:
        try:
            value = eval(t["expr"], dict(ns))
        except BaseException as exc:
            name = type(exc).__name__
            if t["kind"] == "raises" and name == t["expected"]:
                _emit({"kind": "result", "id": t["id"], "status": "pass",
                       "got": name, "expected": t["expected"]})
            else:
                _emit({"kind": "result", "id": t["id"], "status": "fail",
                       "got": name + ": " + str(exc),
                       "expected": ("raises " + str(t["expected"])) if t["kind"] == "raises" else repr(t["expected"]),
                       "trace": _trace()})
        else:
            if t["kind"] == "raises":
                _emit({"kind": "result", "id": t["id"], "status": "fail",
                       "got": "returned " + repr(value) + " without raising",
                       "expected": "raises " + str(t["expected"])})
            else:
                ok = _same(value, t["expected"])
                _emit({"kind": "result", "id": t["id"], "status": "pass" if ok else "fail",
                       "got": repr(value), "expected": repr(t["expected"])})
`;
}

/**
 * Build a complete, self-contained Python program for one submission.
 *
 * Everything the sandbox needs is in this string: the student's code, the
 * module reset, and the test harness. That keeps the Web Worker completely
 * generic — it knows how to run Python and nothing about grading — so the
 * browser and the Node verification path execute byte-identical programs.
 *
 * The student's source is embedded via json.loads rather than interpolated
 * into a literal, so no combination of quotes, backslashes or newlines in a
 * submission can break out of the string and alter the harness.
 */
export function buildProgram(solution: string, tests: TestCase[]): string {
  const embedded = JSON.stringify(JSON.stringify(solution));

  const preamble = [
    "import json, sys",
    `SOLUTION = json.loads(${embedded})`,
    `with open("${SOLUTION_PATH}", "w") as _f:`,
    "    _f.write(SOLUTION)",
    `if "${SOLUTION_DIR}" not in sys.path:`,
    `    sys.path.insert(0, "${SOLUTION_DIR}")`,
    // A module cached from a previous submission would silently grade the
    // wrong student's code.
    'sys.modules.pop("solution", None)',
  ].join("\n");

  return preamble + buildTestBody(tests);
}
