/**
 * Module-worker entry for `COMPONENT-DATA-WORKER` (`ADR-WORKER-OPS`,
 * `ADR-SORT-FILTER-SEAM`). tsup emits this as a SEPARATE chunk (`dist/worker.js`)
 * that the ESM build loads with
 * `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`.
 *
 * It hosts an `EngineHost` (which owns the canonical `IndexEngine`) and speaks
 * the `MSG-*` protocol over the worker's `postMessage`/`onmessage`. Only
 * serializable payloads cross the seam (`PATTERN-WORKER-PROTOCOL`): built-in
 * sort/filter (`BuiltinFilter` + declarative `SortSpec`) run here OFF the main
 * thread; the main thread handles any custom comparator/predicate function.
 */
import { connectDataWorker } from './worker-entry.js';
import type { WorkerScope } from './worker-entry.js';

connectDataWorker(self as unknown as WorkerScope);
