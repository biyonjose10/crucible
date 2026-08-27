/**
 * Execute a single archetype in an isolated process and print its outcome.
 *
 * Isolation is the point: a submission with an infinite loop cannot be stopped
 * from inside its own interpreter, so the parent kills this process instead.
 * That mirrors exactly what the browser does with Worker.terminate().
 */
import { loadPyodide } from "pyodide";
import { ARCHETYPES } from "../fixtures/archetypes";
import { MEDIAN } from "../lib/assignment";
import { parseOutcome, runSubmission } from "../lib/runner";

async function main() {
  const key = process.argv[2];
  const archetype = ARCHETYPES.find((a) => a.key === key);
  if (!archetype) {
    console.error(`unknown archetype: ${key}`);
    process.exit(2);
  }

  const started = Date.now();
  const lines: string[] = [];

  const py = await loadPyodide({ stdout: () => {} });
  // Signal to the parent that boot finished, so its timeout measures execution.
  process.stderr.write("READY\n");

  runSubmission(py as never, archetype.code, MEDIAN.tests, (line) => lines.push(line));

  const outcome = parseOutcome(archetype.key, MEDIAN.tests, lines, Date.now() - started);
  process.stdout.write("OUTCOME:" + JSON.stringify(outcome) + "\n");

}

main();
