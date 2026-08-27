import { buildProgram } from "./harness";
import { parseOutcome } from "./runner";
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
 * A submission killed this way is never guessed at. Whatever it printed before
 * the kill is kept, and every test that did not report is scored
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
}

interface Slot {
  worker: Worker;
  ready: Promise<void>;
  busy: boolean;
}

export class GraderPool {
  private slots: Slot[] = [];
  private waiters: Array<(slot: Slot) => void> = [];
  private jobSeq = 0;
  private disposed = false;

  private readonly size: number;
  private readonly execTimeoutMs: number;
  private readonly bootTimeoutMs: number;

  constructor(options: GraderPoolOptions = {}) {
    this.size = options.size ?? 2;
    this.execTimeoutMs = options.execTimeoutMs ?? 5_000;
    this.bootTimeoutMs = options.bootTimeoutMs ?? 60_000;

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
    this.waiters = [];
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
        if (event.data?.type !== "ready") return;
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        resolve();
      };
      worker.addEventListener("message", onMessage);
    });

    worker.postMessage({ type: "boot" });
    return { worker, ready, busy: false };
  }

  private acquire(): Promise<Slot> {
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise<Slot>((resolve) => this.waiters.push(resolve));
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
      return parseOutcome(submissionId, tests, [], 0, "worker_error");
    }

    const program = buildProgram(code, tests);
    const jobId = ++this.jobSeq;
    const lines: string[] = [];
    const started = Date.now();

    // Captured now: on timeout `slot.worker` is swapped for a replacement, and
    // we must still detach from the worker we actually attached to.
    const worker = slot.worker;

    return new Promise<ExecutionOutcome>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;

      const finish = (inconclusive?: ExecutionOutcome["inconclusive"]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        resolve(
          parseOutcome(
            submissionId,
            tests,
            lines,
            Date.now() - started,
            inconclusive,
          ),
        );
      };

      const onMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || (msg.jobId != null && msg.jobId !== jobId)) return;

        if (msg.type === "stdout") lines.push(String(msg.chunk));
        else if (msg.type === "done") finish();
        else if (msg.type === "error") finish("worker_error");
      };

      worker.addEventListener("message", onMessage);

      timer = setTimeout(() => {
        this.replace(slot);
        finish("timeout");
      }, this.execTimeoutMs);

      // Boot may still be in flight; the worker queues this until it is ready.
      worker.postMessage({ type: "run", jobId, program });
    });
  }
}
