/**
 * The sandbox worker.
 *
 * This file is deliberately generic: it knows how to boot CPython, run a
 * program, and evaluate expressions. It knows nothing about rubrics, marks or
 * whether an answer was right — it reports what each expression *produced* and
 * lib/runner.ts decides what that is worth.
 *
 * That split is the security model, not a tidiness preference. The comparison
 * used to happen in Python, in the same `__main__` namespace the student's
 * module is imported into, which meant a submission could replace the
 * comparator or forge a result line and award itself full marks. Nothing in
 * this file is worth stealing: there is no marker, no emitter, and no verdict
 * on this side of the boundary.
 *
 * It lives in public/ rather than in the bundle on purpose. It is served
 * verbatim, so there is no bundler transform between the source you can read
 * and the code that actually runs the sandbox. That is also why it cannot
 * import from lib/ — the drive loop below is mirrored by `executeProbes` in
 * lib/runner.ts, and both are kept short so reading them side by side is
 * enough to see they agree.
 *
 * Protocol
 *   in   { type: "boot" }
 *   in   { type: "run",   jobId, setup, importProgram, probes: [{id, code}] }
 *   out  { type: "ready" }
 *   out  { type: "probe", jobId, probe }
 *   out  { type: "done",  jobId, importError }
 *   out  { type: "error", jobId, message }
 *
 * Probes are posted one at a time as they complete, so a submission killed
 * mid-run still yields everything that finished before the kill. There is no
 * "stop" message, and there cannot be: a Python infinite loop blocks this
 * worker's event loop, so nothing sent here would ever be read. The only way
 * to stop a runaway submission is Worker.terminate() from the main thread,
 * which is exactly what lib/grader-pool.ts does.
 */

import { loadPyodide } from "/pyodide/pyodide.mjs";

let pyodidePromise = null;

function boot() {
  if (!pyodidePromise) {
    // indexURL points at our own origin. No CDN: a demo must not be breakable
    // by someone else's outage or rate limit.
    pyodidePromise = loadPyodide({ indexURL: "/pyodide/" });
  }
  return pyodidePromise;
}

/**
 * Reduce a converted Python value to something structured-cloneable.
 *
 * Anything with no JSON counterpart becomes undefined rather than travelling
 * as a proxy: postMessage cannot clone one, and a value that is not JSON can
 * never equal an expected value that is. The repr still describes it, so the
 * student is told what came back even when the value itself does not survive.
 */
function toPlain(value) {
  if (value === null || value === undefined) return null;

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") return Number.isFinite(value) ? value : String(value);

  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Map) {
    const out = {};
    for (const [k, v] of value) out[String(k)] = toPlain(v);
    return out;
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = toPlain(value[k]);
    return out;
  }
  return undefined;
}

/** Pull (value, repr) out of the tuple a probe evaluates to, and free it. */
function unwrap(returned) {
  if (!returned || typeof returned.toJs !== "function") {
    return { value: toPlain(returned), repr: undefined };
  }
  try {
    const pair = returned.toJs({ dict_converter: Object.fromEntries });
    if (Array.isArray(pair) && pair.length === 2) {
      return {
        value: toPlain(pair[0]),
        repr: typeof pair[1] === "string" ? pair[1] : undefined,
      };
    }
    return { value: toPlain(pair), repr: undefined };
  } finally {
    // The WASM heap does not participate in JavaScript garbage collection, so
    // a proxy left undestroyed leaks for the life of the interpreter.
    returned.destroy?.();
  }
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === "boot") {
    try {
      await boot();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", jobId: null, message: describe(err) });
    }
    return;
  }

  if (msg.type !== "run") return;

  try {
    const py = await boot();

    py.runPython(msg.setup);

    // Evaluates to the traceback on failure and to None on success. Read as a
    // return value, not parsed out of a stream a submission could write to.
    const importError = py.runPython(msg.importProgram);
    if (typeof importError === "string") {
      self.postMessage({ type: "done", jobId: msg.jobId, importError });
      return;
    }

    for (const probe of msg.probes) {
      let result;
      try {
        result = { id: probe.id, raised: false, ...unwrap(py.runPython(probe.code)) };
      } catch (err) {
        result = {
          id: probe.id,
          raised: true,
          errorType: typeof err?.type === "string" ? err.type : undefined,
          errorTrace: String(err?.message ?? err),
        };
      }
      self.postMessage({ type: "probe", jobId: msg.jobId, probe: result });
    }

    self.postMessage({ type: "done", jobId: msg.jobId });
  } catch (err) {
    // Reaching here means the scaffolding failed, not the student. A student's
    // error is caught per probe above and reported as an observation.
    self.postMessage({ type: "error", jobId: msg.jobId, message: describe(err) });
  }
};

function describe(err) {
  if (!err) return "Unknown sandbox error.";
  return String(err.message || err).slice(0, 500);
}
