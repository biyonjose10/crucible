"use client";

import { useEffect } from "react";

/**
 * The last graceful state.
 *
 * Everything else in this app degrades rather than breaks — a killed
 * interpreter becomes INCONCLUSIVE, a missing API key becomes "explanations
 * are off", a rejected claim is shown struck through. An uncaught render error
 * was the one path that still produced a blank page, which is the worst thing
 * that can happen while a judge is clicking or a camera is rolling.
 *
 * Note what this does not say: it does not claim the grades are wrong. They are
 * computed in a Web Worker by a pure function, so a UI crash tells you nothing
 * about them either way — and overstating the blast radius of a bug is its own
 * kind of dishonesty.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side digests are all a production build exposes; log the whole
    // thing so a developer with the console open has something to go on.
    console.error("[crucible] unhandled render error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="font-mono text-[11px] uppercase tracking-widest text-faint">
        Crucible
      </p>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Something in the interface broke.
      </h1>

      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        This is a display failure, not a grading one. Marks are computed in a
        sandboxed worker by a pure function that this page only reads from, so
        nothing about a crash here changes what a submission is worth.
      </p>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-ink px-4 py-2.5 font-medium text-bg transition-all duration-200
                     hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_rgba(255,255,255,0.35)]"
        >
          Try again
        </button>
        {/* A plain anchor, deliberately. This renders only after the React
            tree has already crashed, and <Link> would attempt a client-side
            navigation inside that broken tree. A full page load is the whole
            point of the escape hatch. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="rounded-lg border border-line px-4 py-2.5 font-mono text-[12px] text-muted
                     transition-colors hover:border-line-hi hover:text-ink"
        >
          Start over
        </a>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-[11px] text-faint">
          reference {error.digest}
        </p>
      )}
    </main>
  );
}
