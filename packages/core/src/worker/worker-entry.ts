/**
 * Web Worker host entry for `COMPONENT-DATA-WORKER`. `connectDataWorker` wires an
 * `EngineHost` to a message port (the worker's `self`, or any `MessagePort`).
 * When bundled as a worker it self-connects; otherwise call `connectDataWorker`
 * explicitly. The main-thread side uses `WorkerTransport`.
 */
import { EngineHost } from '../protocol/engine-host.js';
import type { MainToWorker } from '../protocol/messages.js';

export interface WorkerScope {
  postMessage(msg: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export function connectDataWorker(scope: WorkerScope): void {
  const host = new EngineHost();
  scope.onmessage = (ev) => {
    const replies = host.handle(ev.data as MainToWorker);
    for (const reply of replies) scope.postMessage(reply);
  };
}

// Auto-connect only inside a real worker realm (identified by `importScripts`),
// never on the main thread or in jsdom.
const g = globalThis as unknown as {
  importScripts?: unknown;
  postMessage?: unknown;
};
if (typeof g.importScripts === 'function' && typeof g.postMessage === 'function') {
  connectDataWorker(globalThis as unknown as WorkerScope);
}
