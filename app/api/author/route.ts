/**
 * POST /api/author — write an assignment from a description.
 *
 * Request:
 *   { problem: string, retryHint?: string }
 *
 * Response, always 200 unless the request itself is malformed:
 *   { ok: true,  assignment: Assignment, reference: string }
 *   { ok: false, reason: string }
 *
 * Plain JSON, not the SSE the diagnosis route uses: generation is one shot
 * with no prose to stream, so there is nothing for a stream to buy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Failures are values, not exceptions. A provider outage, a refusal, an
 *  unusable suite — all arrive as `{ ok: false, reason }` with a message
 *  written for a visitor to read. The browser renders `reason` and offers the
 *  median demo instead. Nothing here ever 500s at a user.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { author } from "@/lib/author";
import { AUTHOR_LIMITS } from "@/lib/authoring";

// The Gemini client reads process.env and is Node-only.
export const runtime = "nodejs";

/** Bodies larger than this are refused unread. */
const MAX_BODY_BYTES = 4_096;

/**
 * A speed bump, and described as one.
 *
 * This endpoint is public, unauthenticated, and every call spends real money
 * on a key shared with two other projects that cannot be quickly rotated —
 * and writing a rubric plus a suite is a larger prompt than a diagnosis, so a
 * call here is worth more to an abuser than one to /api/diagnose.
 *
 * The honest caveat: Vercel runs this on ephemeral, horizontally-scaled
 * lambdas, so this Map is per-instance and resets on every cold start. It
 * raises the cost of casual abuse. It is not a spend ceiling, and it should
 * not be described as one. The real fix, if abuse ever appears, is a shared
 * store plus a daily budget that degrades to the same `ok: false` path this
 * already returns.
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function overLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Bound the map itself. Without this, one instance living long enough under
  // a spray of addresses would grow it without limit.
  if (hits.size > 5_000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }

  return recent.length > MAX_PER_WINDOW;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function refuse(reason: string): Response {
  return Response.json({ ok: false, reason });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return badRequest(
      `Request body is ${body.length} bytes; the limit is ${MAX_BODY_BYTES}.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return badRequest("Request body must be JSON.");
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return badRequest("Request body must be an object.");
  }

  const { problem, retryHint } = raw as Record<string, unknown>;

  if (typeof problem !== "string" || problem.trim().length === 0) {
    return badRequest("Field `problem` must be a non-empty string.");
  }
  if (problem.length > AUTHOR_LIMITS.problem) {
    return badRequest(
      `Field \`problem\` is ${problem.length} characters; the limit is ${AUTHOR_LIMITS.problem}.`,
    );
  }
  if (retryHint !== undefined && typeof retryHint !== "string") {
    return badRequest("Field `retryHint` must be a string when present.");
  }

  if (overLimit(clientIp(request))) {
    return refuse(
      "This machine has asked for a lot of test suites in the last hour, and " +
        "each one costs real money on a shared key. Try again later — the " +
        "median demo below still works, and grading it is free.",
    );
  }

  // `retryHint` is bounded here rather than in the validator: it is echoed
  // into the prompt, so it is a cost input like any other.
  const result = await author(
    problem.trim(),
    typeof retryHint === "string" ? retryHint.slice(0, 400) : undefined,
    request.signal,
  );

  return Response.json(result);
}
