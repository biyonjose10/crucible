/**
 * Copy the Pyodide runtime into public/ so the app serves it itself.
 *
 * We deliberately do not load Pyodide from a CDN. The grader must keep working
 * during a demo on a flaky network, and a third-party outage or rate limit
 * must never be able to break the one thing the project claims to do.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const src = dirname(require.resolve("pyodide/package.json"));
const dest = join(process.cwd(), "public", "pyodide");

// Everything the browser needs to boot CPython, and nothing else.
const FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

mkdirSync(dest, { recursive: true });

let bytes = 0;
for (const file of FILES) {
  const from = join(src, file);
  if (!existsSync(from)) {
    console.error(`[pyodide] missing ${file} in ${src}`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, file));
  bytes += statSync(from).size;
}

console.log(
  `[pyodide] copied ${FILES.length} files (${(bytes / 1e6).toFixed(1)} MB) to public/pyodide`,
);
