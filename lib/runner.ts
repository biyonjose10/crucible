import { IMPORT_PROGRAM, MAX_TRACE, buildProbe, buildSetup } from "./harness";
import type { ExecutionOutcome, TestCase, TestResult } from "./types";

/**
 * Where a submission is judged.
 *
 * Everything in this file runs in TypeScript, outside the interpreter the
 * student's code executes in. Nothing here can be reached, read or replaced by
 * a submission: comparison is not a Python function it could patch, and a
 * result is not a line of text it could print. See lib/harness.ts for the
 * three archetypes that made this necessary.
 */

/** The subset of the Pyodide API we depend on. */
export interface PyodideLike {
  runPython(code: string): unknown;
}

/** Everything the sandbox needs in order to run one submission. */
export interface RunRequest {
  setup: string;
  importProgram: string;
  probes: Array<{ id: string; code: string }>;
}

/**
 * What the sandbox observed for one test expression.
 *
 * An observation, not a verdict — it records what the expression produced,
 * and says nothing about whether that was right.
 */
export interface Probe {
  id: string;
  raised: boolean;
  /** The returned value, already converted out of Python. */
  value?: unknown;
  /** Python's repr of that value. Display only, never compared. */
  repr?: string;
  /** The exception class name, when it raised. */
  errorType?: string;
  /** The formatted traceback, when it raised. */
  errorTrace?: string;
}

export function buildRunRequest(code: string, tests: TestCase[]): RunRequest {
  return {
    setup: buildSetup(code),
    importProgram: IMPORT_PROGRAM,
    probes: tests.map((t) => ({ id: t.id, code: buildProbe(t.expr) })),
  };
}

/**
 * Drive one submission through a Pyodide instance on this thread.
 *
 * The browser runs the identical sequence inside a Web Worker
 * (public/grader.worker.js), which cannot import this module because it is
 * served verbatim rather than bundled. The two are kept deliberately short and
 * boring so that reading them side by side is enough to see they agree.
 */
export function executeProbes(py: PyodideLike, request: RunRequest): {
  probes: Probe[];
  importError?: string;
} {
  py.runPython(request.setup);

  const importError = py.runPython(request.importProgram);
  if (typeof importError === "string") {
    return { probes: [], importError };
  }

  const probes: Probe[] = [];
  for (const probe of request.probes) {
    probes.push(observe(py, probe.id, probe.code));
  }
  return { probes };
}

/** Evaluate one expression and record what happened, whatever happened. */
function observe(py: PyodideLike, id: string, code: string): Probe {
  try {
    const returned = py.runPython(code) as unknown;
    const [value, repr] = unwrap(returned);
    return { id, raised: false, value, repr };
  } catch (err) {
    return {
      id,
      raised: true,
      errorType: errorTypeOf(err),
      errorTrace: String((err as Error)?.message ?? err),
    };
  }
}

/**
 * Pull `(value, repr)` out of whatever Pyodide handed back.
 *
 * A tuple arrives as a PyProxy, which must be converted and freed; the WASM
 * heap does not participate in JavaScript garbage collection, so a proxy left
 * undestroyed is a leak that lasts as long as the interpreter.
 */
function unwrap(returned: unknown): [unknown, string | undefined] {
  const proxy = returned as {
    toJs?: (options?: unknown) => unknown;
    destroy?: () => void;
  };

  if (typeof proxy?.toJs !== "function") {
    // Should not happen: the probe always evaluates to a tuple. If it somehow
    // did, report it rather than inventing a value.
    return [toPlain(returned), undefined];
  }

  try {
    const pair = proxy.toJs({ dict_converter: Object.fromEntries }) as unknown;
    if (Array.isArray(pair) && pair.length === 2) {
      return [toPlain(pair[0]), typeof pair[1] === "string" ? pair[1] : undefined];
    }
    return [toPlain(pair), undefined];
  } finally {
    proxy.destroy?.();
  }
}

/**
 * Reduce a converted Python value to a plain JSON-shaped one.
 *
 * Mirrors `toPlain` in public/grader.worker.js — the browser has to do this
 * before postMessage, which cannot clone a proxy, and the two paths must agree
 * or the same submission would score differently in CI than in the app.
 * Anything with no JSON counterpart becomes undefined, which is correct: it
 * can never equal an expected value, and the repr still describes it.
 */
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") {
    return Number.isFinite(value as number) ? value : String(value);
  }

  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([k, v]) => [String(k), toPlain(v)]),
    );
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toPlain(v)]),
    );
  }
  return undefined;
}

/** Pyodide names the Python exception class on the error it throws. */
function errorTypeOf(err: unknown): string | undefined {
  const type = (err as { type?: unknown })?.type;
  return typeof type === "string" ? type : undefined;
}

/**
 * Python's `math.isclose` defaults, so a float that is right to nine
 * significant figures is not marked wrong for being a float.
 */
function isClose(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 1e-9);
}

/**
 * The comparison, in full.
 *
 * This is the function a submission used to be able to replace with one that
 * returned True. It now lives where a submission cannot reach it.
 */
export function sameValue(got: unknown, expected: unknown): boolean {
  // Python's bool is a subclass of int, so `True == 1`. The old harness guarded
  // against that with an identity check and so does this.
  if (typeof got === "boolean" || typeof expected === "boolean") return got === expected;

  if (typeof got === "number" && typeof expected === "number") return isClose(got, expected);

  if (Array.isArray(got) && Array.isArray(expected)) {
    return (
      got.length === expected.length && got.every((g, i) => sameValue(g, expected[i]))
    );
  }

  return got === expected;
}

/** Render a JSON value the way Python's repr would, for display beside `got`. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  return JSON.stringify(value) ?? String(value);
}

/**
 * Drop our own frames from a traceback.
 *
 * A student debugging their code should see their file and their line numbers,
 * not the scaffolding that called them.
 */
export function cleanTrace(raw: string): string {
  const kept = raw
    .split("\n")
    .filter((line) => !line.includes('"<exec>"') && !line.includes('"<string>"'))
    .join("\n");
  return kept.length > MAX_TRACE ? kept.slice(0, MAX_TRACE) + " ... [truncated]" : kept;
}

/**
 * Turn observations into results.
 *
 * A test with no observation is simply absent from the output; lib/scoring.ts
 * scores it "inconclusive" rather than assuming it would have passed or
 * failed. That is why a killed interpreter still produces an honest report of
 * everything that did finish.
 */
export function judge(
  submissionId: string,
  tests: TestCase[],
  probes: Probe[],
  durationMs: number,
  inconclusive: ExecutionOutcome["inconclusive"] | undefined,
  importError?: string,
): ExecutionOutcome {
  const byId = new Map(probes.map((p) => [p.id, p]));
  const results: TestResult[] = [];

  for (const test of tests) {
    const probe = byId.get(test.id);
    if (!probe) continue;

    const expectsRaise = test.kind === "raises";

    if (probe.raised) {
      const name = probe.errorType ?? "Exception";
      if (expectsRaise && name === test.expected) {
        results.push({
          id: test.id,
          status: "pass",
          got: name,
          expected: String(test.expected),
        });
      } else {
        results.push({
          id: test.id,
          status: "fail",
          got: lastLine(probe.errorTrace) || name,
          expected: expectsRaise
            ? `raises ${String(test.expected)}`
            : pyRepr(test.expected),
          trace: probe.errorTrace ? cleanTrace(probe.errorTrace) : undefined,
        });
      }
      continue;
    }

    if (expectsRaise) {
      results.push({
        id: test.id,
        status: "fail",
        got: `returned ${probe.repr ?? pyRepr(probe.value)} without raising`,
        expected: `raises ${String(test.expected)}`,
      });
      continue;
    }

    results.push({
      id: test.id,
      status: sameValue(probe.value, test.expected) ? "pass" : "fail",
      got: probe.repr ?? pyRepr(probe.value),
      expected: pyRepr(test.expected),
    });
  }

  return { submissionId, results, importError, inconclusive, durationMs };
}

/** "ValueError: empty list" — the line a student actually needs. */
function lastLine(trace?: string): string | undefined {
  if (!trace) return undefined;
  const lines = trace.trimEnd().split("\n").filter((l) => l.trim().length > 0);
  return lines[lines.length - 1]?.trim();
}
