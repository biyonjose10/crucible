import type { ScoreReport } from "./scoring";

/**
 * The gradebook as CSV.
 *
 * Extracted from the component so it can be tested without a browser: the
 * failure modes here are quoting and empty fields, and both are much easier to
 * assert on a string than to eyeball in a spreadsheet.
 *
 * An inconclusive submission gets an empty mark rather than a zero. Writing 0
 * would silently record "this student scored nothing" for a run that was
 * terminated before it could be judged, and a gradebook is exactly the wrong
 * place to guess.
 */

export interface GradebookRow {
  student: string;
  report: ScoreReport;
  signature?: string;
  durationMs?: number;
}

export const CSV_HEADER = [
  "student",
  "mark",
  "out_of",
  "status",
  "failure_signature",
  "runtime_ms",
] as const;

/** RFC 4180: wrap in quotes, and double any quote inside. */
function escape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(rows: GradebookRow[]): string {
  const body = rows.map((r) =>
    [
      escape(r.student),
      // Empty, not zero — see above.
      r.report.status === "inconclusive" ? "" : String(r.report.earned),
      String(r.report.total),
      r.report.status,
      escape(r.signature ?? ""),
      r.durationMs === undefined ? "" : String(r.durationMs),
    ].join(","),
  );

  return [CSV_HEADER.join(","), ...body].join("\n") + "\n";
}
