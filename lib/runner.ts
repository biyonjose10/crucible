import { buildHarness, EMIT } from "./harness";
import type { ExecutionOutcome, TestCase, TestResult } from "./types";

/** The subset of the Pyodide API we depend on. */
export interface PyodideLike {
  FS: { writeFile(path: string, data: string, opts: { encoding: "utf8" }): void };
  runPython(code: string): unknown;
  setStdout(options: { batched: (line: string) => void }): void;
}

const SOLUTION_PATH = "/home/pyodide/solution.py";

/**
 * Execute one submission against the test suite.
 *
 * Each emitted line is handed to `onLine` as it is produced, so a caller that
 * later kills this interpreter still keeps everything printed before the kill.
 */
export function runSubmission(
  py: PyodideLike,
  code: string,
  tests: TestCase[],
  onLine: (line: string) => void,
): void {
  py.FS.writeFile(SOLUTION_PATH, code, { encoding: "utf8" });

  // Fresh import every time: a module cached from a previous submission would
  // silently grade the wrong student's code.
  py.runPython(
    `import sys\n` +
      `if "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")\n` +
      `sys.modules.pop("solution", None)\n`,
  );

  py.setStdout({ batched: onLine });
  py.runPython(buildHarness(tests));
}

/**
 * Turn emitted stdout lines into an execution outcome.
 *
 * Anything that is not a marker line is ignored — a student printing to stdout
 * must not be able to forge a result. The marker alone is not enough either:
 * lines are only accepted for test ids that actually exist in the suite.
 */
export function parseOutcome(
  submissionId: string,
  tests: TestCase[],
  lines: string[],
  durationMs: number,
  inconclusive?: ExecutionOutcome["inconclusive"],
): ExecutionOutcome {
  const known = new Set(tests.map((t) => t.id));
  const seen = new Set<string>();
  const results: TestResult[] = [];
  let importError: string | undefined;

  for (const raw of lines) {
    for (const line of raw.split("\n")) {
      const at = line.indexOf(EMIT);
      if (at === -1) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line.slice(at + EMIT.length));
      } catch {
        continue;
      }

      if (parsed.kind === "import_error") {
        importError = String(parsed.trace ?? "Module failed to import.");
        continue;
      }
      if (parsed.kind !== "result") continue;

      const id = String(parsed.id);
      // Reject ids the suite never declared, and duplicate reports for an id.
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);

      results.push({
        id,
        status: parsed.status === "pass" ? "pass" : "fail",
        got: parsed.got === undefined ? undefined : String(parsed.got),
        expected: parsed.expected === undefined ? undefined : String(parsed.expected),
        trace: parsed.trace === undefined ? undefined : String(parsed.trace),
      });
    }
  }

  return { submissionId, results, importError, inconclusive, durationMs };
}
