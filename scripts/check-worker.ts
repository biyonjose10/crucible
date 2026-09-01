/**
 * Execute the real sandbox worker, outside a browser.
 *
 * `npm run verify` proves the *grading logic* is right, but it drives
 * `executeProbes` in lib/runner.ts — the Node path. The browser runs a
 * different file, public/grader.worker.js, which reimplements the same drive
 * loop because it is served verbatim and cannot import from lib/. Nothing
 * checked that file, so a change to the message protocol could pass every gate
 * and still leave the live site unable to grade anything.
 *
 * This runs that exact file. Two lines are patched, because they are the only
 * two that assume a browser:
 *
 *   - the Pyodide import specifier, an absolute URL Node cannot resolve
 *   - `indexURL`, which points at our own origin
 *
 * Both replacements are asserted, so if the worker is edited such that they no
 * longer match, this fails loudly rather than silently testing nothing.
 *
 * What it cannot cover: Worker.terminate(), and therefore the infinite-loop
 * archetype. A Python loop blocks the thread it runs on, and there is nothing
 * here to kill it — which is precisely why the browser uses a real Worker.
 * Timeout behaviour is covered by scripts/verify.ts instead.
 */
import { rm, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { ARCHETYPES } from "../fixtures/archetypes";
import { MEDIAN } from "../lib/assignment";
import { buildRunRequest, judge, type Probe } from "../lib/runner";
import { score } from "../lib/scoring";

const WORKER_SRC = "public/grader.worker.js";
const TEMP = "scripts/.worker-under-test.mjs";

interface Posted {
  type: string;
  jobId?: number | null;
  probe?: Probe;
  importError?: string;
  message?: string;
}

/** Stand in for the Web Worker global the file expects to be running inside. */
interface WorkerSelf {
  postMessage(message: Posted): void;
  onmessage?: (event: { data: unknown }) => Promise<void> | void;
}

function patch(source: string): string {
  const importFrom = 'from "/pyodide/pyodide.mjs"';
  const indexUrl = 'loadPyodide({ indexURL: "/pyodide/" })';

  if (!source.includes(importFrom)) {
    throw new Error(`${WORKER_SRC}: could not find the import to redirect (${importFrom})`);
  }
  if (!source.includes(indexUrl)) {
    throw new Error(`${WORKER_SRC}: could not find the loadPyodide call to patch (${indexUrl})`);
  }

  return source
    .replace(importFrom, 'from "pyodide"')
    .replace(indexUrl, "loadPyodide()");
}

async function main() {
  const source = await readFile(WORKER_SRC, "utf8");
  await writeFile(TEMP, patch(source), "utf8");

  const posted: Posted[] = [];
  const shim: WorkerSelf = { postMessage: (m) => void posted.push(m) };
  (globalThis as unknown as { self: WorkerSelf }).self = shim;

  process.stdout.write("\n\x1b[1mCrucible worker check\x1b[0m\n");
  process.stdout.write("─".repeat(60) + "\n\n");

  let failures = 0;
  try {
    await import(pathToFileURL(TEMP).href);

    if (!shim.onmessage) throw new Error("the worker never registered an onmessage handler");
    const send = async (data: unknown) => {
      posted.length = 0;
      await shim.onmessage!({ data });
      return posted.slice();
    };

    const booted = await send({ type: "boot" });
    if (!booted.some((m) => m.type === "ready")) {
      throw new Error(`worker did not report ready: ${JSON.stringify(booted)}`);
    }
    process.stdout.write("  \x1b[32m✓\x1b[0m interpreter booted and reported ready\n\n");

    // The infinite loop cannot be stopped without a real Worker to terminate.
    const runnable = ARCHETYPES.filter((a) => a.expected.status !== "inconclusive");

    for (const archetype of runnable) {
      const request = buildRunRequest(archetype.code, MEDIAN.tests);
      const messages = await send({ type: "run", jobId: 1, ...request });

      const probes = messages
        .filter((m) => m.type === "probe" && m.probe)
        .map((m) => m.probe as Probe);
      const done = messages.find((m) => m.type === "done");
      const errored = messages.find((m) => m.type === "error");

      if (errored) throw new Error(`${archetype.key}: worker errored — ${errored.message}`);
      if (!done) throw new Error(`${archetype.key}: worker never signalled done`);

      const report = score(
        MEDIAN,
        judge(archetype.key, MEDIAN.tests, probes, 0, undefined, done.importError),
      );

      const ok =
        report.earned === archetype.expected.earned &&
        report.status === archetype.expected.status;
      if (!ok) failures++;

      process.stdout.write(
        `  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ` +
          `${archetype.label.padEnd(42)}${report.earned}/${report.total}\n`,
      );
      if (!ok) {
        process.stdout.write(
          `      \x1b[31mexpected ${archetype.expected.earned}/${report.total} ` +
            `(${archetype.expected.status}), got ${report.status}\x1b[0m\n`,
        );
      }
    }
  } finally {
    await rm(TEMP, { force: true });
  }

  process.stdout.write("\n" + "─".repeat(60) + "\n");
  if (failures) {
    process.stdout.write(`\x1b[31m${failures} archetype(s) scored differently in the worker.\x1b[0m\n`);
    process.exit(1);
  }
  process.stdout.write("The shipped worker grades every archetype exactly as the gate does.\n");
}

main().catch((err) => {
  process.stderr.write(`\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
  process.exit(1);
});
