/**
 * POST /api/diagnose — Server-Sent Events.
 *
 * This is the server-side half of the guarantee. The client sends a report so
 * the server knows *which* failures to explain; it does not send anything that
 * grants, changes, or is echoed back as a grade. Read the response shape
 * below: there is no score field in it, and there is nowhere for one to hide.
 * The grade was computed in the browser sandbox by lib/scoring.ts before this
 * route was called, and the UI renders it from there.
 *
 * ── Request ──────────────────────────────────────────────────────────────
 *   {
 *     assignmentSlug: string,   // must name a known assignment
 *     code: string,             // the student's source, untrusted
 *     report: ScoreReport       // used only to select failing evidence
 *   }
 *
 * A malformed body gets a 400 with a plain-text reason. Everything else gets
 * a 200 and a well-formed event stream, including the no-API-key case.
 *
 * ── Response: text/event-stream ──────────────────────────────────────────
 *
 *   event: stage
 *   data: { "stage": "triage" | "diagnosis", "model": string }
 *       Fired when the pipeline moves between model tiers. Informational —
 *       a client may ignore it entirely.
 *
 *   event: delta
 *   data: { "text": string }
 *       One fragment of the prose diagnosis. Concatenate in arrival order.
 *       Zero or more of these arrive before `done`.
 *
 *   event: done
 *   data: Diagnosis            // the exact type exported by lib/diagnose.ts
 *       Always the last event on a successful stream. Carries the validated
 *       claims, the rejected claims and why each was refused, per-call token
 *       counts, and the computed USD cost. `data.summary` is the complete
 *       prose, so a client that ignored every `delta` still renders correctly.
 *       Check `data.unavailable` — when true, `data.reason` is a sentence
 *       written for display.
 *
 *   event: error
 *   data: { "message": string }
 *       Only for faults the diagnose module could not turn into a value —
 *       in practice, a stream that breaks mid-flight. Terminal.
 *
 * The stream always ends with exactly one `done` or one `error`.
 */

import { ASSIGNMENTS } from "@/lib/assignment";
import { diagnoseCached } from "@/lib/diagnose";
import { failureSignature } from "@/lib/scoring";

import type { Diagnosis } from "@/lib/diagnose";
import type { ScoreReport } from "@/lib/scoring";
import type { Assignment } from "@/lib/types";

// The Gemini SDK and GEMINI_API_KEY are Node-side only. The key is read
// inside lib/diagnose.ts and never crosses to the client — not in a response
// body, not in an error message.
export const runtime = "nodejs";

/** The `done` event's payload. Re-exported so the UI has one name for it. */
export type DiagnoseDonePayload = Diagnosis;

interface DiagnoseBody {
  assignmentSlug: string;
  code: string;
  report: ScoreReport;
}

function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Validate the body defensively.
 *
 * The report is client-supplied, so it is treated as a *selector* and nothing
 * more: we check that it is shaped like a ScoreReport and that its clauses
 * refer to real clauses, then use it to pick which failures to explain. Its
 * `earned` and `total` are never read here, never forwarded to the model, and
 * never echoed back — a client that lies about them changes nothing.
 */
function parseBody(raw: unknown, assignment: Assignment): DiagnoseBody | string {
  if (typeof raw !== "object" || raw === null) {
    return "Request body must be a JSON object.";
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.code !== "string") {
    return "Field `code` must be a string containing the submission.";
  }
  if (body.code.length > 200_000) {
    return "Field `code` is too large to diagnose.";
  }

  const report = body.report;
  if (typeof report !== "object" || report === null) {
    return "Field `report` must be a ScoreReport object.";
  }
  const r = report as Record<string, unknown>;
  if (!Array.isArray(r.clauses)) {
    return "Field `report.clauses` must be an array.";
  }

  const validClauses = new Set(assignment.clauses.map((c) => c.id));
  for (const entry of r.clauses) {
    if (typeof entry !== "object" || entry === null) {
      return "Every entry in `report.clauses` must be an object.";
    }
    const clause = entry as Record<string, unknown>;
    if (typeof clause.clause !== "number" || !validClauses.has(clause.clause)) {
      return `Field \`report.clauses[].clause\` must name a clause of "${assignment.slug}".`;
    }
    if (!Array.isArray(clause.results)) {
      return "Field `report.clauses[].results` must be an array.";
    }
  }

  return {
    assignmentSlug: assignment.slug,
    code: body.code,
    report: report as ScoreReport,
  };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body is not valid JSON.");
  }

  const slug =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).assignmentSlug
      : undefined;
  if (typeof slug !== "string") {
    return badRequest("Field `assignmentSlug` must be a string.");
  }
  const assignment = ASSIGNMENTS[slug];
  if (!assignment) {
    return badRequest(`Unknown assignment "${slug}".`);
  }

  const parsed = parseBody(raw, assignment);
  if (typeof parsed === "string") {
    return badRequest(parsed);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        // The failure signature is derived from the client's report, so it
        // only ever selects which cached explanation to reuse. There is no
        // capability behind it to escalate to.
        const signature = failureSignature(parsed.report);

        const diagnosis = await diagnoseCached(signature, {
          assignment,
          code: parsed.code,
          report: parsed.report,
          signal: request.signal,
          onStage: (stage, model) => send("stage", { stage, model }),
          onDelta: (text) => send("delta", { text }),
        });

        // diagnoseCached never throws: outages arrive here as a well-formed
        // Diagnosis with `unavailable: true`, so the client's `done` handler
        // is the only path it needs.
        send("done", diagnosis);
      } catch (err) {
        // Reached only if the stream itself broke. The message is ours, not
        // the provider's, so nothing from the server environment leaks.
        send("error", {
          message:
            err instanceof Error && err.name === "AbortError"
              ? "The request was cancelled."
              : "The diagnosis stream failed. The grade is unaffected.",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Defeats proxy buffering, which would hold the deltas until the end
      // and quietly turn the stream back into a single blocking response.
      "x-accel-buffering": "no",
    },
  });
}
