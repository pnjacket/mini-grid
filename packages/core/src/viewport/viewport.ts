/**
 * `COMPONENT-VIEWPORT` — variable-height virtualization windowing. Computes the
 * visible row/col window plus overscan from scroll position, using the
 * `HeightIndex` for rows and a prefix-sum over fixed column widths for columns.
 * Emits `MSG-QUERY-WINDOW` (via the client) — the window it returns is what the
 * renderer paints; live nodes stay bounded to viewport + overscan (`PERF-NODES`).
 */
import { HeightIndex } from './height-index.js';

export interface RowWindow {
  /** First visible row (with overscan applied), inclusive. */
  firstRow: number;
  /** Last visible row (with overscan applied), inclusive. `-1` when empty. */
  lastRow: number;
}

export interface ColWindow {
  firstCol: number;
  lastCol: number;
}

export class Viewport {
  readonly heightIndex: HeightIndex;
  private colWidths: number[];
  /** Prefix sums of column widths; `colOffsets[i]` = left edge of column `i`. */
  private colOffsets: number[] = [0];

  constructor(heightIndex: HeightIndex, colWidths: readonly number[]) {
    this.heightIndex = heightIndex;
    this.colWidths = [...colWidths];
    this.rebuildColOffsets();
  }

  setColWidths(widths: readonly number[]): void {
    this.colWidths = [...widths];
    this.rebuildColOffsets();
  }

  getColWidths(): readonly number[] {
    return this.colWidths;
  }

  getColOffsets(): readonly number[] {
    return this.colOffsets;
  }

  totalWidth(): number {
    return this.colOffsets[this.colOffsets.length - 1] as number;
  }

  computeRowWindow(
    scrollTop: number,
    viewportHeight: number,
    overscan: number,
    rowCount: number,
  ): RowWindow {
    if (rowCount === 0) return { firstRow: 0, lastRow: -1 };
    const first = this.heightIndex.indexAt(scrollTop);
    const last = this.heightIndex.indexAt(scrollTop + viewportHeight);
    return {
      firstRow: Math.max(0, first - overscan),
      lastRow: Math.min(rowCount - 1, last + overscan),
    };
  }

  computeColWindow(
    scrollLeft: number,
    viewportWidth: number,
    overscan: number,
  ): ColWindow {
    const colCount = this.colWidths.length;
    if (colCount === 0) return { firstCol: 0, lastCol: -1 };
    const first = this.colIndexAt(scrollLeft);
    const last = this.colIndexAt(scrollLeft + viewportWidth);
    return {
      firstCol: Math.max(0, first - overscan),
      lastCol: Math.min(colCount - 1, last + overscan),
    };
  }

  private colIndexAt(offset: number): number {
    const offsets = this.colOffsets;
    const colCount = this.colWidths.length;
    if (offset <= 0) return 0;
    // Linear scan is fine — column counts are small.
    for (let i = 0; i < colCount; i++) {
      if ((offsets[i + 1] as number) > offset) return i;
    }
    return colCount - 1;
  }

  private rebuildColOffsets(): void {
    const offsets = [0];
    for (let i = 0; i < this.colWidths.length; i++) {
      offsets.push((offsets[i] as number) + (this.colWidths[i] as number));
    }
    this.colOffsets = offsets;
  }
}
