/**
 * The build gate.
 *
 * Asserts three things that the entire product rests on:
 *   1. Every archetype scores exactly what its test suite dictates.
 *   2. Scoring is deterministic — the same submission twice gives the same score.
 *   3. lib/scoring.ts contains no path to a language model.
 *
 * If any of these fail, the central claim of the project is false and the
 * build should not ship.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { ARCHETYPES } from "../fixtures/archetypes";
import { MEDIAN } from "../lib/assignment";
import { score } from "../lib/scoring";
import type { ExecutionOutcome } from "../lib/types";

/** Wall-clock budget for execution, measured after the interpreter is warm. */
const EXEC_BUDGET_MS = 5_000;
const BOOT_BUDGET_MS = 60_000;

function runIsolated(key: string): Promise<ExecutionOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/run-one.ts", key],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let killTimer: NodeJS.Timeout;
    const bootTimer = setTimeout(() => child.kill("SIGKILL"), BOOT_BUDGET_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      if (String(d).includes("READY")) {
        clearTimeout(bootTimer);
        // The interpreter is warm; now the submission gets its 5 seconds.
        killTimer = setTimeout(() => child.kill("SIGKILL"), EXEC_BUDGET_MS);
      }
    });

    child.on("close", () => {
      clearTimeout(bootTimer);
      clearTimeout(killTimer);
      const marker = stdout.indexOf("OUTCOME:");
      if (marker === -1) {
        resolve({
          submissionId: key,
          results: [],
          inconclusive: "timeout",
          durationMs: Date.now() - started,
        });
        return;
      }
      resolve(JSON.parse(stdout.slice(marker + "OUTCOME:".length)));
    });
  });
}

async function main() {
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };

  console.log("\nCrucible verification\n" + "─".repeat(60));

  // ── 1. Import hygiene ──────────────────────────────────────────────────────
  const scoringSrc = readFileSync("lib/scoring.ts", "utf8");
  const imports = [...scoringSrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const forbidden = imports.filter((i) => /anthropic|diagnose|openai|ai/i.test(i));
  console.log("\n[1] lib/scoring.ts import hygiene");
  console.log(`    imports: ${imports.join(", ") || "(none)"}`);
  if (forbidden.length) fail(`scoring.ts reaches a model: ${forbidden.join(", ")}`);
  else console.log("  ✓ no path from scoring to any language model");

  // ── 2. Archetype scores ────────────────────────────────────────────────────
  console.log("\n[2] Archetype scores");
  const outcomes = new Map<string, ExecutionOutcome>();

  for (const a of ARCHETYPES) {
    const outcome = await runIsolated(a.key);
    outcomes.set(a.key, outcome);
    const report = score(MEDIAN, outcome);
    const ok =
      report.earned === a.expected.earned && report.status === a.expected.status;

    const shown = report.status === "inconclusive" ? "INCONCLUSIVE" : `${report.earned}/10`;
    const want =
      a.expected.status === "inconclusive" ? "INCONCLUSIVE" : `${a.expected.earned}/10`;

    console.log(
      `  ${ok ? "✓" : "✗"} ${a.label.padEnd(38)} ${shown.padEnd(13)} ` +
        `${String(outcome.durationMs).padStart(6)}ms`,
    );
    if (!ok) fail(`${a.key}: expected ${want}, got ${shown}`);

    // Visible-vs-hidden breakdown makes the hardcoding archetype legible.
    if (a.key === "hardcoded") {
      const byId = new Map(outcome.results.map((r) => [r.id, r]));
      const split = (visible: boolean) =>
        MEDIAN.tests
          .filter((t) => t.visible === visible)
          .map((t) => byId.get(t.id)?.status ?? "inconclusive");
      const vis = split(true);
      const hid = split(false);
      const visPass = vis.filter((s) => s === "pass").length;
      const hidFail = hid.filter((s) => s === "fail").length;
      console.log(
        `      visible: ${visPass}/${vis.length} pass   hidden: ${hidFail}/${hid.length} fail`,
      );
      // Not every hidden test fails, and that is fine: returning 0.0 for
      // unknown inputs still satisfies "is a float", and the empty-list guard
      // was copied honestly. The point is narrower and stronger — a perfect
      // score on every published test still earns 4/10.
      if (visPass !== vis.length)
        fail("hardcoded archetype no longer passes every visible test");
      if (hidFail < 5)
        fail(`hardcoded archetype should fail at least 5 hidden tests, failed ${hidFail}`);
    }
  }

  // ── 3. Determinism ─────────────────────────────────────────────────────────
  console.log("\n[3] Determinism (same submission, second run)");
  for (const key of ["correct", "off-by-one", "prompt-injection"]) {
    const first = score(MEDIAN, outcomes.get(key)!);
    const second = score(MEDIAN, await runIsolated(key));
    const a = JSON.stringify(first.clauses);
    const b = JSON.stringify(second.clauses);
    console.log(`  ${a === b ? "✓" : "✗"} ${key}: ${first.earned}/10 twice`);
    if (a !== b) fail(`${key} is not deterministic`);
  }

  console.log("\n" + "─".repeat(60));
  if (failures) {
    console.error(`FAILED — ${failures} check(s)\n`);
    process.exit(1);
  }
  console.log("All checks passed.\n");

}

main();
