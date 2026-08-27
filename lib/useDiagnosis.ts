"use client";

import { useEffect, useRef, useState } from "react";
import type { Diagnosis } from "./diagnose";
import type { ScoreReport } from "./scoring";

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
  assignmentSlug: string,
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

    const controller = new AbortController();
    setState({ text: "", streaming: true });

    (async () => {
      try {
        const res = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentSlug, code, report }),
          signal: controller.signal,
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
              setState({ text: prose, streaming: true });
            } else if (event === "done") {
              const result = payload as Diagnosis;
              memo.set(submissionId, result);
              setState({
                text: result.summary || prose,
                streaming: false,
                result,
              });
              settled.current?.(result);
            } else if (event === "error") {
              throw new Error(
                (payload as { message: string }).message ||
                  "The diagnosis stream ended unexpectedly.",
              );
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          text: "",
          streaming: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => controller.abort();
  }, [active, submissionId, assignmentSlug, code, report]);

  return state;
}
