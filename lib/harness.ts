import type { TestCase } from "./types";

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
export function buildHarness(tests: TestCase[]): string {
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
    t = traceback.format_exc()
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
