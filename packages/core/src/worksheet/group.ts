/**
 * `GroupModel` — the in-memory forest of `ENTITY-GROUP-NODE`s (owned by
 * `COMPONENT-STORE`, driven through the `Grid` facade's `CAP-GROUP`). Pure /
 * DOM-free so the invariant is unit-checkable in isolation.
 *
 * Enforces `INV-GROUP-NEST` by construction: same-axis nodes are pairwise
 * **disjoint-or-nested** (a forest); a partially-overlapping `group()` throws
 * `GROUP_OVERLAP` (`source:'operation'`). `level` is the node's nesting depth.
 *
 * A **collapsed** node hides its spanned rows (row axis) or columns (column
 * axis) — the grid drops those indices from the virtualization window.
 * Structural row/column insert & delete adjust each same-axis node (`shift` /
 * `expand-on-insert-inside` / `shrink` / `remove-if-span→0`).
 */
import { GridError } from '../errors.js';
import type { GroupAxis, GroupNode } from '../types.js';

/** Half-open axis span `[start, start+span)`. */
interface Span {
  start: number;
  end: number;
}

function spanOf(n: { start: number; span: number }): Span {
  return { start: n.start, end: n.start + n.span };
}

/** `a` fully contains `b` (nested — allowed by `INV-GROUP-NEST`). */
function containsSpan(a: Span, b: Span): boolean {
  return a.start <= b.start && b.end <= a.end;
}

/** `a` and `b` are disjoint. */
function disjoint(a: Span, b: Span): boolean {
  return a.end <= b.start || b.end <= a.start;
}

/** `a` and `b` partially overlap (neither disjoint nor nested) — rejected. */
function partialOverlap(a: Span, b: Span): boolean {
  return !disjoint(a, b) && !containsSpan(a, b) && !containsSpan(b, a);
}

/**
 * `INV-GROUP-NEST` runnable predicate: every same-axis pair is disjoint or
 * nested. (Quality: the invariant asserted.)
 */
export function groupInvariantHolds(nodes: readonly GroupNode[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i] as GroupNode;
    if (a.span < 1) return false;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j] as GroupNode;
      if (a.axis !== b.axis) continue;
      if (partialOverlap(spanOf(a), spanOf(b))) return false;
    }
  }
  return true;
}

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

export class GroupModel {
  private nodes: GroupNode[] = [];
  private seq = 0;

  list(): readonly GroupNode[] {
    return this.nodes;
  }

  get(id: string): GroupNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  clear(): void {
    this.nodes = [];
  }

  /**
   * `CAP-GROUP` — validate + add a group node. Throws `GROUP_OVERLAP`
   * (`source:'operation'`) for a partial same-axis overlap (`INV-GROUP-NEST`) or a
   * non-positive span.
   */
  add(o: { axis: GroupAxis; start: number; span: number }): GroupNode {
    const start = Math.max(0, Math.floor(o.start));
    const span = Math.floor(o.span);
    if (span < 1) {
      throw new GridError('GROUP_OVERLAP', 'A group must span at least 1 row/column', {
        source: 'operation',
      });
    }
    const s = { start, end: start + span };
    let level = 0;
    for (const n of this.nodes) {
      if (n.axis !== o.axis) continue;
      const ns = spanOf(n);
      if (partialOverlap(ns, s)) {
        throw new GridError('GROUP_OVERLAP', 'Group partially overlaps an existing same-axis group', {
          source: 'operation',
        });
      }
      if (containsSpan(ns, s)) level++;
    }
    const node: GroupNode = {
      id: `mggrp${++this.seq}`,
      axis: o.axis,
      start,
      span,
      level,
      collapsed: false,
    };
    this.nodes.push(node);
    return node;
  }

  /** Re-insert a node without validation (undo/redo restore; keeps its id). */
  addNode(node: GroupNode): void {
    this.nodes.push({ ...node });
  }

  remove(id: string): GroupNode | undefined {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return undefined;
    return this.nodes.splice(idx, 1)[0];
  }

  setCollapsed(id: string, collapsed: boolean): GroupNode | undefined {
    const node = this.get(id);
    if (node) node.collapsed = collapsed;
    return node;
  }

  /** Union of rows hidden by collapsed row-axis nodes. */
  hiddenRows(): Set<number> {
    return this.hiddenOn('row');
  }

  /** Union of columns hidden by collapsed column-axis nodes. */
  hiddenCols(): Set<number> {
    return this.hiddenOn('column');
  }

  private hiddenOn(axis: GroupAxis): Set<number> {
    const set = new Set<number>();
    for (const n of this.nodes) {
      if (n.axis === axis && n.collapsed) {
        for (let i = n.start; i < n.start + n.span; i++) set.add(i);
      }
    }
    return set;
  }

  // --- Structural adjustment -------------------------------------------------

  adjustRowInsert(at: number, n: number): void {
    this.axisInsert('row', at, n);
  }

  adjustRowDelete(deleted: readonly number[]): void {
    this.axisDelete('row', deleted);
  }

  adjustColInsert(at: number, n: number): void {
    this.axisInsert('column', at, n);
  }

  adjustColDelete(deleted: readonly number[]): void {
    this.axisDelete('column', deleted);
  }

  private axisInsert(axis: GroupAxis, at: number, n: number): void {
    for (const node of this.nodes) {
      if (node.axis !== axis) continue;
      const end = node.start + node.span;
      if (at <= node.start) node.start += n; // shift down/right
      else if (at < end) node.span += n; // insert inside → expand
    }
  }

  private axisDelete(axis: GroupAxis, deleted: readonly number[]): void {
    const del = [...deleted].sort((a, b) => a - b);
    this.nodes = this.nodes.filter((node) => {
      if (node.axis !== axis) return true;
      const shrunk = shrinkAxis(node.start, node.start + node.span - 1, del);
      if (!shrunk) return false; // span → 0 → remove
      node.start = shrunk.lo;
      node.span = shrunk.hi - shrunk.lo + 1;
      return true;
    });
  }
}
