/**
 * `COMPONENT-STORE` (Slice-1 subset) — holds the columns and view counts, and is
 * a reactive store emitting **microtask-coalesced batched** change events
 * (`PATTERN-REACTIVE-STORE`). `subscribe(fn)` returns an unsubscribe.
 *
 * Column binding enforces `INV-COLKEY-UNIQUE` by construction via a `Map<id>`:
 * a duplicate id throws `DUPLICATE_COLUMN_ID`.
 */
import { GridError } from '../errors.js';
import type { ColumnDef } from '../api/options.js';
import type { ColumnId } from '../types.js';

export type Unsubscribe = () => void;

export interface StoreCounts {
  rowCount: number;
  totalRowCount: number;
}

export class ReactiveStore {
  private columns: ColumnDef[] = [];
  private columnById = new Map<ColumnId, ColumnDef>();
  private rowCount = 0;
  private totalRowCount = 0;

  private readonly subscribers = new Set<() => void>();
  private flushScheduled = false;

  /** Bind columns; enforces `INV-COLKEY-UNIQUE` (throws `DUPLICATE_COLUMN_ID`). */
  setColumns(defs: readonly ColumnDef[]): void {
    const map = new Map<ColumnId, ColumnDef>();
    for (const def of defs) {
      if (map.has(def.id)) {
        throw new GridError(
          'DUPLICATE_COLUMN_ID',
          `Duplicate column id: ${def.id}`,
          { source: 'config', context: { columnId: def.id } },
        );
      }
      map.set(def.id, def);
    }
    this.columns = defs.slice();
    this.columnById = map;
    this.scheduleNotify();
  }

  getColumns(): readonly ColumnDef[] {
    return this.columns;
  }

  /**
   * `CAP-COLUMN-MANAGE` — the **visible-column projection** (`INV-COLUMN-HIDDEN-EXCLUDED`
   * + `INV-COLUMN-PIN-LEADING`): `hidden` columns are filtered out of the view +
   * ordered index, and `pinned:'leading'` columns are stably hoisted into a leading
   * contiguous block (unpinned columns follow in their existing order). The RTL
   * mirror of "leading" is applied at render time (`inset-inline-start`), so the
   * projection order is direction-agnostic. Hidden columns retain their def + data
   * (parked in `columns`), so `showColumn` restores them unchanged.
   */
  getVisibleColumns(): readonly ColumnDef[] {
    const visible = this.columns.filter((c) => c.hidden !== true);
    const pinned = visible.filter((c) => c.pinned === 'leading');
    if (pinned.length === 0 || pinned.length === visible.length) return visible;
    const rest = visible.filter((c) => c.pinned !== 'leading');
    return [...pinned, ...rest];
  }

  getColumn(id: ColumnId): ColumnDef | undefined {
    return this.columnById.get(id);
  }

  setCounts(rowCount: number, totalRowCount: number): void {
    this.rowCount = rowCount;
    this.totalRowCount = totalRowCount;
    this.scheduleNotify();
  }

  getCounts(): StoreCounts {
    return { rowCount: this.rowCount, totalRowCount: this.totalRowCount };
  }

  subscribe(fn: () => void): Unsubscribe {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private scheduleNotify(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      for (const fn of [...this.subscribers]) fn();
    });
  }
}
