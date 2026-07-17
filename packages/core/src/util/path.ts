/**
 * Dot-path accessors — `ENTITY-COLUMN.field` is "a dot-path into the row object".
 * A path without a dot is a plain property read/write (the common case).
 */
import type { RowData } from '../types.js';

export function getByPath(data: RowData, path: string): unknown {
  if (!path.includes('.')) return data[path];
  let cur: unknown = data;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function setByPath(data: RowData, path: string, value: unknown): void {
  if (!path.includes('.')) {
    data[path] = value;
    return;
  }
  const segs = path.split('.');
  const last = segs.pop() as string;
  let cur: Record<string, unknown> = data;
  for (const seg of segs) {
    const next = cur[seg];
    if (next == null || typeof next !== 'object') {
      const created: Record<string, unknown> = {};
      cur[seg] = created;
      cur = created;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[last] = value;
}
