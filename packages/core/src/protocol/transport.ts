/**
 * Transport seam — the ONLY thing that crosses the main/worker boundary is the
 * typed `MSG-*` protocol (Architecture boundary contract). Two transports:
 *
 * - `InProcessTransport` — runs the `EngineHost` on the main thread (default for
 *   jsdom/unit tests and non-worker environments). Passes messages by reference
 *   (no structured clone) so `FilterPredicate`/`Comparator` functions survive;
 *   replies are delivered on a microtask so the client stays Promise-async.
 * - `WorkerTransport` — wraps a real `Worker`; structured-clone semantics apply.
 */
import { EngineHost } from './engine-host.js';
import type { MainToWorker, WorkerToMain } from './messages.js';

/** A fatal transport failure (worker crash/termination) — carries a message. */
export interface CrashInfo {
  message: string;
}

export interface DataTransport {
  post(msg: MainToWorker): void;
  onMessage(cb: (msg: WorkerToMain) => void): void;
  /**
   * Subscribe to a **fatal** transport failure (`WORKER_CRASHED`): the worker
   * errored/terminated. Optional so simple/mock transports may omit it.
   */
  onCrash?(cb: (info: CrashInfo) => void): void;
  terminate(): void;
}

export class InProcessTransport implements DataTransport {
  private cb: ((msg: WorkerToMain) => void) | undefined;
  private crashCb: ((info: CrashInfo) => void) | undefined;

  constructor(private readonly host: EngineHost = new EngineHost()) {}

  post(msg: MainToWorker): void {
    const replies = this.host.handle(msg);
    queueMicrotask(() => {
      for (const reply of replies) this.cb?.(reply);
    });
  }

  onMessage(cb: (msg: WorkerToMain) => void): void {
    this.cb = cb;
  }

  onCrash(cb: (info: CrashInfo) => void): void {
    this.crashCb = cb;
  }

  /**
   * Testing seam: simulate a fatal worker crash. Notifies the crash subscriber
   * (the `DataClient` then produces `WORKER_CRASHED`, rejects in-flight ops, and
   * degrades to read-only). The in-process engine survives, so a subsequent
   * `setData`/`load` recovers — mirroring the re-bind recovery policy.
   */
  crash(message = 'Worker crashed'): void {
    this.crashCb?.({ message });
  }

  terminate(): void {
    this.cb = undefined;
    this.crashCb = undefined;
  }
}

/** Minimal structural view of a `Worker` (main-thread side). */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror?: ((ev: { message?: string }) => void) | null;
  terminate(): void;
}

export class WorkerTransport implements DataTransport {
  private cb: ((msg: WorkerToMain) => void) | undefined;
  private crashCb: ((info: CrashInfo) => void) | undefined;

  constructor(private readonly worker: WorkerLike) {
    this.worker.onmessage = (ev) => this.cb?.(ev.data as WorkerToMain);
    // A worker `error` event is fatal for the data seam (`WORKER_CRASHED`).
    this.worker.onerror = (ev) =>
      this.crashCb?.({ message: ev?.message ?? 'Worker crashed' });
  }

  post(msg: MainToWorker): void {
    this.worker.postMessage(msg);
  }

  onMessage(cb: (msg: WorkerToMain) => void): void {
    this.cb = cb;
  }

  onCrash(cb: (info: CrashInfo) => void): void {
    this.crashCb = cb;
  }

  terminate(): void {
    this.worker.terminate();
  }
}
