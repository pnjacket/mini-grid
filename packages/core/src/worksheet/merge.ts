/**
 * `MergeModel` — the in-memory set of `ENTITY-MERGE-REGION`s (owned by
 * `COMPONENT-STORE`, driven through the `Grid` facade's `CAP-MERGE`). Pure /
 * DOM-free so the invariants are unit-checkable in isolation.
 *
 * Enforces, by construction:
 *  - `INV-MERGE-MIN2` — every region covers `≥2` cells; a `merge()` of `<2` cells
 *    is rejected, and a structural shrink to `≤1` cell **dissolves** the region.
 *  - `INV-MERGE-NONOVERLAP` — regions are pairwise-disjoint with one anchor
 *    (`= range top-left`); an overlapping `merge()` throws `MERGE_OVERLAP`.
 *
 * Structural row/column insert & delete adjust every region (`shift` /
 * `expand-on-insert-inside` / `shrink` / `dissolve`) so the invariants stay valid
 * after any CRUD (Domain "structural adjustment" rules).
 */
import { GridError } from '../errors.js';
import type { MergeRegion, Range } from '../types.js';

/** Normalize a range (`top≤bottom`, `left≤right`) — a merge range is a rectangle. */
export function normalizeMergeRange(r: Range): Range {
  return {
    top: Math.min(r.top, r.bottom),
    bottom: Math.max(r.top, r.bottom),
    left: Math.min(r.left, r.right),
    right: Math.max(r.left, r.right),
  };
}

function cellCount(r: Range): number {
  return (r.bottom - r.top + 1) * (r.right - r.left + 1);
}

function intersects(a: Range, b: Range): boolean {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}

function contains(r: Range, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}

/**
 * `INV-MERGE-NONOVERLAP` + `INV-MERGE-MIN2` runnable predicate: every region has
 * `≥2` cells and no two regions intersect. (Quality: the invariant asserted.)
 */
export function mergeInvariantHolds(regions: readonly MergeRegion[]): boolean {
  for (let i = 0; i < regions.length; i++) {
    const a = regions[i] as MergeRegion;
    if (cellCount(a.range) < 2) return false;
    if (a.anchor.row !== a.range.top || a.anchor.col !== a.range.left) return false;
    for (let j = i + 1; j < regions.length; j++) {
      if (intersects(a.range, (regions[j] as MergeRegion).range)) return false;
    }
  }
  return true;
}

/**
 * Shrink an inclusive axis span `[lo, hi]` by a sorted set of deleted indices:
 * remaps the survivors to their post-delete indices (they compress to a
 * contiguous block) and returns the new `[lo, hi]`, or `null` when no cell of the
 * span survives.
 */
function shrinkAxis(lo: number, hi: number, deletedSorted: readonly number[]): { lo: number; hi: number } | null {
  const del = new Set(deletedSorted);
  let first = -1;
  let last = -1;
  for (let i = lo; i <= hi; i++) {
    if (!del.has(i)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  const below = (idx: number): number => {
    let c = 0;
    for (const d of deletedSorted) {
      if (d < idx) c++;
      else break;
    }
    return c;
  };
  return { lo: first - below(first), hi: last - below(last) };
}

export class MergeModel {
  private regions: MergeRegion[] = [];

  /** The live regions (read-only view for rendering / invariant checks). */
  list(): readonly MergeRegion[] {
    return this.regions;
  }

  clear(): void {
    this.regions = [];
  }

  /** The region covering `(row, col)`, or `undefined`. */
  regionAt(row: number, col: number): MergeRegion | undefined {
    return this.regions.find((m) => contains(m.range, row, col));
  }

  /** The anchor index of the region covering `(row, col)`, or `undefined`. */
  anchorOf(row: number, col: number): { row: number; col: number } | undefined {
    return this.regionAt(row, col)?.anchor;
  }

  /** `(row, col)` is a **covered** (non-anchor) cell of some region. */
  isCovered(row: number, col: number): boolean {
    const m = this.regionAt(row, col);
    return !!m && !(row === m.anchor.row && col === m.anchor.col);
  }

  /** The region intersecting `range` (unmerge target), or `undefined`. */
  find(range: Range): MergeRegion | undefined {
    const r = normalizeMergeRange(range);
    return this.regions.find((m) => intersects(m.range, r));
  }

  /**
   * `CAP-MERGE` — validate + add a region. Throws `MERGE_OVERLAP`
   * (`source:'operation'`) for a `<2`-cell range (`INV-MERGE-MIN2`) or an overlap
   * with an existing region (`INV-MERGE-NONOVERLAP`).
   */
  add(range: Range): MergeRegion {
    const r = normalizeMergeRange(range);
    if (cellCount(r) < 2) {
      throw new GridError('MERGE_OVERLAP', 'A merge must cover at least 2 cells', {
        source: 'operation',
        context: { range: r },
      });
    }
    for (const m of this.regions) {
      if (intersects(m.range, r)) {
        throw new GridError('MERGE_OVERLAP', 'Merge overlaps an existing merged region', {
          source: 'operation',
          context: { range: r },
        });
      }
    }
    const region: MergeRegion = { range: r, anchor: { row: r.top, col: r.left } };
    this.regions.push(region);
    return region;
  }

  /** Re-insert a region without validation (undo/redo restore). */
  addRegion(region: MergeRegion): void {
    this.regions.push({
      range: { ...region.range },
      anchor: { ...region.anchor },
    });
  }

  /** Remove the region intersecting `range` (returns it), or `undefined`. */
  removeAt(range: Range): MergeRegion | undefined {
    const r = normalizeMergeRange(range);
    const idx = this.regions.findIndex((m) => intersects(m.range, r));
    if (idx < 0) return undefined;
    return this.regions.splice(idx, 1)[0];
  }

  removeRegion(region: MergeRegion): void {
    const i = this.regions.indexOf(region);
    if (i >= 0) this.regions.splice(i, 1);
  }

  // --- Structural adjustment (Domain "structural adjustment" rules) ----------

  /** Rows inserted at `at` (count `n`): a region spanning `at` expands, one below shifts. */
  adjustRowInsert(at: number, n: number): void {
    for (const m of this.regions) {
      const top = m.range.top >= at ? m.range.top + n : m.range.top;
      const bottom = m.range.bottom >= at ? m.range.bottom + n : m.range.bottom;
      m.range = { ...m.range, top, bottom };
      m.anchor = { row: top, col: m.range.left };
    }
  }

  /** Rows at `deleted` removed: regions shrink to survivors; dissolve if `≤1` cell. */
  adjustRowDelete(deleted: readonly number[]): void {
    const del = [...deleted].sort((a, b) => a - b);
    this.regions = this.regions.filter((m) => {
      const rows = shrinkAxis(m.range.top, m.range.bottom, del);
      if (!rows) return false;
      const range: Range = { ...m.range, top: rows.lo, bottom: rows.hi };
      if (cellCount(range) < 2) return false; // INV-MERGE-MIN2 → dissolve
      m.range = range;
      m.anchor = { row: range.top, col: range.left };
      return true;
    });
  }

  /** A column inserted at `at` (count `n`): spanning region expands, one to the right shifts. */
  adjustColInsert(at: number, n: number): void {
    for (const m of this.regions) {
      const left = m.range.left >= at ? m.range.left + n : m.range.left;
      const right = m.range.right >= at ? m.range.right + n : m.range.right;
      m.range = { ...m.range, left, right };
      m.anchor = { row: m.range.top, col: left };
    }
  }

  /** Columns at `deleted` removed: regions shrink to survivors; dissolve if `≤1` cell. */
  adjustColDelete(deleted: readonly number[]): void {
    const del = [...deleted].sort((a, b) => a - b);
    this.regions = this.regions.filter((m) => {
      const cols = shrinkAxis(m.range.left, m.range.right, del);
      if (!cols) return false;
      const range: Range = { ...m.range, left: cols.lo, right: cols.hi };
      if (cellCount(range) < 2) return false;
      m.range = range;
      m.anchor = { row: range.top, col: range.left };
      return true;
    });
  }
}
