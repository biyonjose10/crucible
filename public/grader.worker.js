/**
 * The sandbox worker.
 *
 * This file is deliberately generic: it knows how to boot CPython and run a
 * Python program, and nothing at all about grading, rubrics or scores. The
 * complete program — student code, module reset and test harness — is built on
 * the main thread by lib/harness.ts and shipped here as a string, so the
 * browser and the Node verification path execute byte-identical Python.
 *
 * It lives in public/ rather than in the bundle on purpose. It is served
 * verbatim, so there is no bundler transform between the source you can read
 * and the code that actually runs the sandbox.
 *
 * Protocol
 *   in   { type: "boot" }
 *   in   { type: "run",    jobId, program }
 *   out  { type: "ready" }
 *   out  { type: "stdout", jobId, chunk }
 *   out  { type: "done",   jobId }
 *   out  { type: "error",  jobId, message }
 *
 * There is no "stop" message, and there cannot be: a Python infinite loop
 * blocks this worker's event loop, so nothing sent here would ever be read.
 * The only way to stop a runaway submission is Worker.terminate() from the
 * main thread, which is exactly what lib/grader-pool.ts does.
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

    // Stream stdout back as it is produced. If this worker is terminated
    // mid-run, every line emitted before the kill has already been delivered,
    // so partial results survive.
    py.setStdout({
      batched: (chunk) =>
        self.postMessage({ type: "stdout", jobId: msg.jobId, chunk }),
    });

    py.runPython(msg.program);
    self.postMessage({ type: "done", jobId: msg.jobId });
  } catch (err) {
    // A Python-level error here means the harness itself failed, not the
    // student. Student errors are caught inside the harness and reported as
    // test results.
    self.postMessage({ type: "error", jobId: msg.jobId, message: describe(err) });
  }
};

function describe(err) {
  if (!err) return "Unknown sandbox error.";
  return String(err.message || err).slice(0, 500);
}
