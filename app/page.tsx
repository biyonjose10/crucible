import { readFileSync } from "node:fs";
import path from "node:path";
import { Grader } from "@/components/Grader";

/**
 * Read the scoring module's own import list at build time.
 *
 * The project's central claim is that `lib/scoring.ts` cannot reach a language
 * model. That claim is enforced by `npm run verify` and stated in the README,
 * but both ask the reader to take our word for it. Extracting the real import
 * list here and rendering it in the page lets the app show its own evidence —
 * if someone ever wires a model into the grading path, this display changes on
 * its own.
 *
 * Runs on the server during the build, so `fs` never reaches the browser.
 */
function scoringImports(): string[] {
  try {
    const src = readFileSync(
      path.join(process.cwd(), "lib", "scoring.ts"),
      "utf8",
    );
    return [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  } catch {
    // A missing file must not take the page down; the panel simply hides.
    return [];
  }
}

export default function Home() {
  return <Grader scoringImports={scoringImports()} />;
}
