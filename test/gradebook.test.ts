import assert from "node:assert/strict";
import test from "node:test";

import { CSV_HEADER, toCsv, type GradebookRow } from "../lib/gradebook";
import type { ScoreReport } from "../lib/scoring";

const report = (
  earned: number,
  status: ScoreReport["status"] = "graded",
): ScoreReport => ({ earned, total: 10, status, clauses: [] });

test("emits a header and one row per submission", () => {
  const csv = toCsv([
    { student: "A. Okafor", report: report(10), signature: "clean", durationMs: 74 },
    { student: "B. Lindqvist", report: report(8), signature: "2:fail", durationMs: 72 },
  ]);
  const lines = csv.trim().split("\n");

  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_HEADER.join(","));
  assert.equal(lines[1], '"A. Okafor",10,10,graded,"clean",74');
});

test("every row has exactly as many fields as the header", () => {
  const csv = toCsv([
    { student: "X", report: report(4), signature: "2:fail,4:fail", durationMs: 1 },
  ]);
  // The signature contains a comma, which is precisely why it is quoted.
  for (const line of csv.trim().split("\n")) {
    const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter((f) => f !== "");
    assert.equal(fields.length, CSV_HEADER.length, `bad field count in: ${line}`);
  }
});

test("an inconclusive submission has an empty mark, not a zero", () => {
  const csv = toCsv([
    { student: "G. Petrov", report: report(0, "inconclusive"), signature: "", durationMs: 5741 },
  ]);
  const row = csv.trim().split("\n")[1];

  assert.match(row, /^"G\. Petrov",,10,inconclusive/);
  assert.doesNotMatch(
    row,
    /^"G\. Petrov",0,/,
    "recording 0 would assert the student scored nothing for a run we never judged",
  );
});

test("quotes inside a name are escaped rather than breaking the row", () => {
  const csv = toCsv([
    { student: 'A "Ace" Okafor', report: report(10), signature: "clean", durationMs: 5 },
  ]);
  assert.match(csv, /"A ""Ace"" Okafor"/);
  assert.equal(csv.trim().split("\n").length, 2, "the row must not split");
});

test("a missing runtime is empty rather than undefined", () => {
  const csv = toCsv([{ student: "Y", report: report(6) }]);
  const row = csv.trim().split("\n")[1];
  assert.doesNotMatch(row, /undefined/);
  assert.match(row, /,$/);
});

test("output ends with a trailing newline", () => {
  const rows: GradebookRow[] = [{ student: "Z", report: report(2) }];
  assert.ok(toCsv(rows).endsWith("\n"));
});
