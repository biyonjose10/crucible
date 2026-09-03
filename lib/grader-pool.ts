import { buildRunRequest, judge } from "./runner";
import type { Probe } from "./runner";
import type { ExecutionOutcome, TestCase } from "./types";

/**
 * A small pool of sandbox workers.
 *
 * Two responsibilities, both of which exist because a runaway submission
 * cannot be stopped politely:
 *
 *   1. Enforce a wall-clock budget per submission. A Python infinite loop
 *      blocks its worker's event loop, so no message we send could ever be
 *      read. Worker.terminate() is the only thing that actually stops it.
 *
 *   2. Keep grading the rest of the class after that happens. A terminated
 *      worker is replaced immediately, so one bad submission costs one slot
 *      for one boot, not the run.
 *
 * A submission killed this way is never guessed at. Every test that finished
 * before the kill is kept, and every test that did not is scored
 * "inconclusive" — see lib/scoring.ts.
 */

const WORKER_URL = "/grader.worker.js";

export interface GraderPoolOptions {
  /** Concurrent sandboxes. Each holds its own CPython instance. */
  size?: number;
  /** Wall-clock budget for a single submission, once the worker is warm. */
  execTimeoutMs?: number;
  /** Ceiling on interpreter boot. Exceeding it is a hard failure, not a hang. */
  bootTimeoutMs?: number;
  /**
   * Called as each interpreter finishes booting. Boot is the only part of this
   * a user waits on, and a several-megabyte download with no feedback reads as
   * a broken page — so the count is reported rather than guessed at with a
   * timer.
   */
  onReady?: (ready: number, total: number) => void;
}

interface Slot {
  worker: Worker;
  ready: Promise<void>;
  busy: boolean;
}

export class GraderPool {
  private slots: Slot[] = [];
  private waiters: Array<(slot: Slot | null) => void> = [];
  private jobSeq = 0;
  private disposed = false;

  private readonly size: number;
  private readonly execTimeoutMs: number;
  private readonly bootTimeoutMs: number;
  private readonly onReady?: (ready: number, total: number) => void;
  private readyCount = 0;

  constructor(options: GraderPoolOptions = {}) {
    this.size = options.size ?? 2;
    this.execTimeoutMs = options.execTimeoutMs ?? 5_000;
    this.bootTimeoutMs = options.bootTimeoutMs ?? 60_000;
    this.onReady = options.onReady;

    for (let i = 0; i < this.size; i++) this.slots.push(this.createSlot());
  }

  /**
   * Boot every interpreter.
   *
   * Called while the user is still reading the landing page, so that clicking
   * "grade" starts grading rather than starting a download.
   */
  async warm(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.ready));
  }

  /** Grade one submission. Never rejects; failure arrives as an outcome. */
  async run(
    submissionId: string,
    code: string,
    tests: TestCase[],
  ): Promise<ExecutionOutcome> {
    const slot = await this.acquire();
    if (!slot) {
      // The pool was disposed while this call was queued. Report it the same
      // way as any other failure to execute: inconclusive, never guessed at.
      return judge(submissionId, tests, [], 0, "worker_error");
    }
    try {
      return await this.exec(slot, submissionId, code, tests);
    } finally {
      slot.busy = false;
      this.pump();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];

    // Settle everyone still queued. Dropping the array left their promises
    // pending forever, so an unmount mid-run left `Promise.all` in the caller
    // hanging and the run never reached "complete".
    const stranded = this.waiters;
    this.waiters = [];
    for (const resolve of stranded) resolve(null);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private createSlot(): Slot {
    const worker = new Worker(WORKER_URL, { type: "module" });

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Sandbox interpreter failed to boot in time.")),
        this.bootTimeoutMs,
      );
      const onMessage = (event: MessageEvent) => {
        // The worker reports a failed Pyodide load as an error with no job id.
        // Only listening for "ready" meant a blocked or missing runtime sat
        // silently until the boot timeout — ninety seconds of a disabled
        // button before the real reason surfaced.
        if (event.data?.type === "error" && event.data?.jobId == null) {
          clearTimeout(timer);
          worker.removeEventListener("message", onMessage);
          reject(
            new Error(
              String(event.data.message ?? "The sandbox interpreter failed to load."),
            ),
          );
          return;
        }
        if (event.data?.type !== "ready") return;
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        // Replacement workers must not inflate the count past the pool size.
        if (this.readyCount < this.size) {
          this.readyCount += 1;
          this.onReady?.(this.readyCount, this.size);
        }
        resolve();
      };
      worker.addEventListener("message", onMessage);
    });

    worker.postMessage({ type: "boot" });
    return { worker, ready, busy: false };
  }

  /** Resolves null once the pool is disposed — there will never be a slot. */
  private acquire(): Promise<Slot | null> {
    if (this.disposed) return Promise.resolve(null);
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise<Slot | null>((resolve) => this.waiters.push(resolve));
  }

  private pump(): void {
    if (this.disposed || this.waiters.length === 0) return;
    const free = this.slots.find((s) => !s.busy);
    if (!free) return;
    free.busy = true;
    this.waiters.shift()!(free);
  }

  /** Terminate a wedged worker and put a fresh one in its place. */
  private replace(slot: Slot): void {
    slot.worker.terminate();
    const fresh = this.createSlot();
    slot.worker = fresh.worker;
    slot.ready = fresh.ready;
  }

  private async exec(
    slot: Slot,
    submissionId: string,
    code: string,
    tests: TestCase[],
  ): Promise<ExecutionOutcome> {
    // Wait for the interpreter before starting the clock. The budget is meant
    // to measure the student's code, not our cold start — charging a 4s boot
    // against a 5s budget would fail perfectly good submissions.
    try {
      await slot.ready;
    } catch {
      this.replace(slot);
      return judge(submissionId, tests, [], 0, "worker_error");
    }

    const request = buildRunRequest(code, tests);
    const jobId = ++this.jobSeq;
    const probes: Probe[] = [];
    const started = Date.now();
    let importError: string | undefined;

    // Captured now: on timeout `slot.worker` is swapped for a replacement, and
    // we must still detach from the worker we actually attached to.
    const worker = slot.worker;

    return new Promise<ExecutionOutcome>((resolve) => {
      let settled = false;
      // Declared before it is assigned so `finish`, defined below, can close
      // over it and clear it. prefer-const cannot see that ordering.
      // eslint-disable-next-line prefer-const
      let timer: ReturnType<typeof setTimeout>;

      const finish = (inconclusive?: ExecutionOutcome["inconclusive"]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        resolve(
          judge(
            submissionId,
            tests,
            probes,
            Date.now() - started,
            inconclusive,
            importError,
          ),
        );
      };

      const onMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || (msg.jobId != null && msg.jobId !== jobId)) return;

        if (msg.type === "probe") {
          // Kept as they arrive, so a submission killed part-way through still
          // reports everything that finished. The rest score "inconclusive".
          if (msg.probe) probes.push(msg.probe as Probe);
        } else if (msg.type === "done") {
          if (typeof msg.importError === "string") importError = msg.importError;
          finish();
        } else if (msg.type === "error") {
          finish("worker_error");
        }
      };

      worker.addEventListener("message", onMessage);

      timer = setTimeout(() => {
        this.replace(slot);
        finish("timeout");
      }, this.execTimeoutMs);

      // Boot may still be in flight; the worker queues this until it is ready.
      worker.postMessage({
        type: "run",
        jobId,
        setup: request.setup,
        importProgram: request.importProgram,
        probes: request.probes,
      });
    });
  }
}
