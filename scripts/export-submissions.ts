/**
 * Writes the sample class out as individual .py files.
 *
 * The demo video opens on "a folder of submissions", and until now that folder
 * did not exist - the class lives in fixtures/class.ts as data. These are the
 * same thirty submissions the app grades, byte for byte, so the opening shot
 * shows the real thing rather than a mock-up.
 *
 *   npx tsx scripts/export-submissions.ts "<output folder>"
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLASS } from "../fixtures/class";

const out = process.argv[2];
if (!out) {
  console.error('Usage: npx tsx scripts/export-submissions.ts "<output folder>"');
  process.exit(1);
}

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const submission of CLASS) {
  // "A. Okafor" -> "01_A_Okafor.py", so Explorer sorts them in roster order.
  const safe = submission.student.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const file = `${submission.id.replace(/^s/, "")}_${safe}.py`;
  writeFileSync(join(out, file), `${submission.code}\n`, "utf8");
}

console.log(`wrote ${CLASS.length} submissions to ${out}`);
