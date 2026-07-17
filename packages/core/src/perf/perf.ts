/**
 * Measurement-hooks contract (Performance & Scalability). When `options.perf`
 * is true the grid emits User-Timing marks/measures for `mg:mount`,
 * `mg:window-query`, `mg:sort`, `mg:filter` and buffers them for
 * `grid.getPerfMarks()`. When disabled every method is a pass-through.
 */

export interface PerfMark {
  name: string;
  startTime: number;
  duration: number;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export class PerfRecorder {
  private readonly marks: PerfMark[] = [];

  constructor(private readonly enabled: boolean) {}

  measure<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const start = nowMs();
    try {
      return fn();
    } finally {
      this.record(name, start);
    }
  }

  async measureAsync<T>(name: string, work: Promise<T>): Promise<T> {
    if (!this.enabled) return work;
    const start = nowMs();
    try {
      return await work;
    } finally {
      this.record(name, start);
    }
  }

  getMarks(): PerfMark[] {
    return this.marks.slice();
  }

  private record(name: string, start: number): void {
    const end = nowMs();
    this.marks.push({ name, startTime: start, duration: end - start });
    try {
      if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
        performance.measure(name, { start, end } as PerformanceMeasureOptions);
      }
    } catch {
      // User-Timing unavailable / duplicate mark — the buffer is the source of truth.
    }
  }
}
