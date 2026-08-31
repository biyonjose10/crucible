"use client";

import { useEffect, useRef, useState } from "react";
import type { Diagnosis } from "./diagnose";
import { toPlainProse } from "./prose-guard";
import type { ScoreReport } from "./scoring";
import type { Assignment } from "./types";

/**
 * Stream a diagnosis for one submission.
 *
 * Fires lazily — only when a card is actually expanded — so a run of 30
 * submissions costs nothing unless someone opens one. Results are memoised per
 * submission for the life of the page, so collapsing and re-expanding a card
 * never pays twice.
 *
 * Note what is *not* passed back into the app from here: the response carries
 * claims, prose, tokens and cost, and no score. The grade on screen came from
 * lib/scoring.ts before this request was made and is never revisited.
 */

const memo = new Map<string, Diagnosis>();

/**
 * Requests currently in flight, keyed by submission.
 *
 * The memo alone was not enough: it is only written when a stream finishes, so
 * opening the student view while the card's panel was still streaming missed
 * the memo and fired a second full triage-plus-diagnosis exchange for the same
 * submission — paid twice, on a shared key. A second consumer now waits on the
 * first request instead of starting its own. It forgoes the token-by-token
 * reveal and gets the finished text, which is the right trade for not paying
 * twice.
 */
const inflight = new Map<string, Promise<Diagnosis>>();

export interface DiagnosisState {
  /** Prose accumulated so far. Renders while the rest is still arriving. */
  text: string;
  streaming: boolean;
  result?: Diagnosis;
  /** Set only when the stream itself broke — the UI shows an amber notice. */
  error?: string;
}

const IDLE: DiagnosisState = { text: "", streaming: false };

export function useDiagnosis(
  submissionId: string,
  assignment: Assignment,
  code: string,
  report: ScoreReport | undefined,
  active: boolean,
  onSettled?: (d: Diagnosis) => void,
): DiagnosisState {
  const [state, setState] = useState<DiagnosisState>(IDLE);

  // Kept in a ref so the effect does not re-run when the callback identity
  // changes on a parent re-render.
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    if (!active || !report) return;

    // Nothing failed, so there is nothing to explain and nothing to spend.
    if (report.earned === report.total && report.status === "graded") {
      setState(IDLE);
      return;
    }

    const cached = memo.get(submissionId);
    if (cached) {
      setState({ text: cached.summary, streaming: false, result: cached });
      return;
    }

    // Not an AbortController: a shared request must not die because the
    // component that happened to start it unmounted. Aborting would not refund
    // anything either — by the time a stream is open the server has already
    // called Gemini. This is only a "am I still mounted" flag.
    let live = true;
    setState({ text: "", streaming: true });

    const pending = inflight.get(submissionId);
    if (pending) {
      pending
        .then((d) => {
          if (live) setState({ text: d.summary, streaming: false, result: d });
        })
        .catch(() => {
          if (live) {
            setState({ text: "", streaming: false, error: "Diagnosis failed." });
          }
        });
      return () => {
        live = false;
      };
    }

    const request = (async (): Promise<Diagnosis> => {
      try {
        const res = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignmentSlug: assignment.slug,
            // Sent only for runtime-generated assignments, which the server
            // cannot look up in its own registry. Known slugs resolve
            // server-side and any inline assignment is ignored, so the median
            // path is unchanged.
            assignment: assignment.slug.startsWith("custom-")
              ? assignment
              : undefined,
            code,
            report,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Diagnosis unavailable (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let prose = "";

        // SSE frames are separated by a blank line. Anything partial stays in
        // the buffer until its terminator arrives.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let split: number;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);

            let event = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;

            let payload: unknown;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }

            if (event === "delta") {
              prose += (payload as { text: string }).text ?? "";
              if (live) setState({ text: prose, streaming: true });
            } else if (event === "done") {
              const result = payload as Diagnosis;
              // Memoise and report spend regardless of whether this component
              // is still mounted — the cost was incurred either way, and a
              // later consumer should get the cached answer for free.
              memo.set(submissionId, result);
              settled.current?.(result);
              if (live) {
                setState({
                  text: result.summary || prose,
                  streaming: false,
                  result,
                });
              }
              return result;
            } else if (event === "error") {
              throw new Error(
                (payload as { message: string }).message ||
                  "The diagnosis stream ended unexpectedly.",
              );
            }
          }
        }
        throw new Error("The diagnosis stream ended without a result.");
      } catch (err) {
        if (live) {
          setState({
            text: "",
            streaming: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      } finally {
        inflight.delete(submissionId);
      }
    })();

    inflight.set(submissionId, request);
    // The originating hook already renders from state; this only stops an
    // unhandled rejection when the request fails.
    request.catch(() => {});

    return () => {
      live = false;
    };
  }, [active, submissionId, assignment, code, report]);

  // Cleaned here rather than at either render site, so every consumer gets
  // prose and a future one cannot forget to. Re-derived each render, which is
  // what makes it correct mid-stream: the whole accumulated string is passed,
  // so a `**` whose halves arrived in different chunks still matches.
  return { ...state, text: toPlainProse(state.text) };
}
