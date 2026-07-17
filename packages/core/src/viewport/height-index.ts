/**
 * `HeightIndex` — the variable per-row height cache behind `PATTERN-VIRTUALIZATION`
 * / `ADR-ROW-HEIGHT`. Each row starts at an estimated default height and is
 * replaced by an exact measured height on first render. A Fenwick (binary
 * indexed) tree over the per-row heights gives O(log n) prefix-sum
 * (`offsetOf`) and O(log n) inverse binary search (`indexAt`) — the index↔offset
 * lookup — plus O(log n) point updates when a height is measured.
 */
export class HeightIndex {
  private count = 0;
  private heights = new Float64Array(0);
  private measured = new Uint8Array(0);
  /** 1-based Fenwick tree of `heights`. */
  private tree = new Float64Array(1);

  constructor(private readonly estimated = 28) {}

  getCount(): number {
    return this.count;
  }

  /** Resize the index, preserving measured heights for surviving rows. */
  setCount(n: number): void {
    const prevHeights = this.heights;
    const prevMeasured = this.measured;
    const prevCount = this.count;

    const heights = new Float64Array(n);
    const measured = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (i < prevCount && prevMeasured[i]) {
        heights[i] = prevHeights[i] as number;
        measured[i] = 1;
      } else {
        heights[i] = this.estimated;
      }
    }
    this.count = n;
    this.heights = heights;
    this.measured = measured;
    this.rebuild();
  }

  /** Record an exact measured height for a row (invalidates offsets after it). */
  setMeasured(index: number, height: number): void {
    if (index < 0 || index >= this.count) return;
    if (this.measured[index] && this.heights[index] === height) return;
    const delta = height - (this.heights[index] as number);
    this.heights[index] = height;
    this.measured[index] = 1;
    for (let i = index + 1; i <= this.count; i += i & -i) {
      this.tree[i] = (this.tree[i] as number) + delta;
    }
  }

  height(index: number): number {
    if (index < 0 || index >= this.count) return this.estimated;
    return this.heights[index] as number;
  }

  isMeasured(index: number): boolean {
    return index >= 0 && index < this.count && this.measured[index] === 1;
  }

  /** Pixel offset of the top of `index` = sum of heights of rows `[0, index)`. */
  offsetOf(index: number): number {
    let i = Math.max(0, Math.min(index, this.count));
    let sum = 0;
    for (; i > 0; i -= i & -i) sum += this.tree[i] as number;
    return sum;
  }

  /** Total scrollable height. */
  totalHeight(): number {
    return this.offsetOf(this.count);
  }

  /** Row index whose band contains `offset` — the inverse of `offsetOf`. */
  indexAt(offset: number): number {
    if (this.count === 0) return 0;
    if (offset <= 0) return 0;
    let pos = 0;
    let cum = 0;
    let bit = 1;
    while (bit * 2 <= this.count) bit *= 2;
    for (; bit > 0; bit >>= 1) {
      const next = pos + bit;
      if (next <= this.count && cum + (this.tree[next] as number) <= offset) {
        pos = next;
        cum += this.tree[next] as number;
      }
    }
    // `pos` = number of rows fully above `offset`; that row index contains it.
    return Math.min(pos, this.count - 1);
  }

  private rebuild(): void {
    const n = this.count;
    const tree = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++) {
      tree[i] = (tree[i] as number) + (this.heights[i - 1] as number);
      const parent = i + (i & -i);
      if (parent <= n) tree[parent] = (tree[parent] as number) + (tree[i] as number);
    }
    this.tree = tree;
  }
}
