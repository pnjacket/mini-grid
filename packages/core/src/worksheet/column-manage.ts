/**
 * `LIB-COLUMN-MANAGE` (`CAP-COLUMN-MANAGE`, v1.3) — the column-management
 * controller: hide/show, leading-edge pin, and autofit. Non-destructive view
 * projection ops (contrast the destructive `LIB-COLUMN-CRUD`):
 *
 *  - **hide/show** toggle `ENTITY-COLUMN.hidden`; the store's visible-column
 *    projection excludes hidden columns (`INV-COLUMN-HIDDEN-EXCLUDED`) while their
 *    def + data are retained, so `showColumn` restores the column unchanged.
 *  - **pin** sets `ENTITY-COLUMN.pinned:'leading'` and reflows the pinned columns
 *    into a **leading contiguous block** that joins the frozen leading prefix
 *    (`INV-COLUMN-PIN-LEADING`), RTL-aware; `null` unpins.
 *  - **autofit** measures the widest **visible** cell content only — a **bounded**
 *    pass over the rendered/overscan window, never a full-column scan over 1M rows
 *    (Performance) — and sets the column width.
 *
 * Each mutation is idempotent, fires its `EVT-COLUMN-*`, updates the store
 * projection, announces on the live region (`A11Y-GRID`), and is undoable. An
 * unknown column id throws `INVALID_COLUMN_DEF`; a bad pin edge throws
 * `INVALID_OPTIONS`. Every behavior is independently feature-flag gated
 * (`columnManage` / `autofit`). The grid wires the host primitives (mutation +
 * reflow + bounded measure + width apply) that touch its viewport/renderer state.
 */
import { GridError } from '../errors.js';
import type { ColumnDef } from '../api/options.js';
import type { ColumnId } from '../types.js';
import type { GridEventBus } from '../api/event-bus.js';
import type { CommandKind } from '../editing/history.js';
import type { Translate } from '../i18n/i18n.js';

export interface ColumnManageHost {
  /** `columnManage` flag — hide/show + pin are gated on it. */
  columnManageEnabled(): boolean;
  /** `autofit` flag — autofit (single + all) is gated on it. */
  autofitEnabled(): boolean;
  /** Look up a live `ColumnDef` by id (the `INVALID_COLUMN_DEF` source of truth). */
  getColumn(id: ColumnId): ColumnDef | undefined;
  /** The live visible column ids (excludes hidden), used by `autofitAllColumns`. */
  visibleColumnIds(): ColumnId[];
  /** Mutate `ENTITY-COLUMN.hidden` + reproject the view/index (`INV-COLUMN-HIDDEN-EXCLUDED`). */
  setHidden(id: ColumnId, hidden: boolean): void;
  /** Mutate `ENTITY-COLUMN.pinned` + reflow the leading block + freeze (`INV-COLUMN-PIN-LEADING`). */
  setPinned(id: ColumnId, pinned: 'leading' | null): void;
  /**
   * Bounded, VISIBLE-ONLY widest-content measure (px) for the column — never scans
   * the full column. Returns `null` when unmeasurable (e.g. a hidden column).
   */
  measureColumnWidth(id: ColumnId): number | null;
  /** Apply a width (non-undoable primitive; the controller owns the undo Command). */
  applyWidth(id: ColumnId, width: number): void;
  /** The column's current width (px). */
  currentWidth(id: ColumnId): number;
  /** Minimum column width (px) autofit clamps to. */
  minColumnWidth: number;
  bus: GridEventBus;
  /** Push an undoable main-thread Command (mirrors resize/reorder). */
  pushCommand(kind: CommandKind, apply: () => void, revert: () => void): void;
  /** Announce a polite live-region message (`A11Y-GRID`). */
  announce(message: string): void;
  t: Translate;
  /** The human header label for a column (announcement text). */
  columnHeaderOf(id: ColumnId): string;
}

export class ColumnManageController {
  constructor(private readonly host: ColumnManageHost) {}

  /** Resolve a column or throw `INVALID_COLUMN_DEF` (the unknown-id error). */
  private requireColumn(id: ColumnId): ColumnDef {
    const col = this.host.getColumn(id);
    if (!col) {
      throw new GridError('INVALID_COLUMN_DEF', `Unknown column id: ${String(id)}`, {
        source: 'config',
        context: { columnId: id },
      });
    }
    return col;
  }

  /** `hideColumn` — exclude from the projection (idempotent); `EVT-COLUMN-HIDDEN`. */
  hideColumn(id: ColumnId): void {
    const col = this.requireColumn(id);
    if (!this.host.columnManageEnabled()) return;
    if (col.hidden === true) return; // idempotent — hiding a hidden column is a no-op
    this.host.setHidden(id, true);
    this.host.pushCommand(
      'reorder',
      () => this.host.setHidden(id, true),
      () => this.host.setHidden(id, false),
    );
    this.host.bus.emit('columnHidden', { columnId: id, hidden: true });
    this.host.announce(this.host.t('a11y.columnHidden', { column: this.host.columnHeaderOf(id) }));
  }

  /** `showColumn` — restore a hidden column (idempotent); `EVT-COLUMN-HIDDEN`. */
  showColumn(id: ColumnId): void {
    const col = this.requireColumn(id);
    if (!this.host.columnManageEnabled()) return;
    if (col.hidden !== true) return; // idempotent — showing a shown column is a no-op
    this.host.setHidden(id, false);
    this.host.pushCommand(
      'reorder',
      () => this.host.setHidden(id, false),
      () => this.host.setHidden(id, true),
    );
    this.host.bus.emit('columnHidden', { columnId: id, hidden: false });
    this.host.announce(this.host.t('a11y.columnShown', { column: this.host.columnHeaderOf(id) }));
  }

  /** `pinColumn` — leading pin / unpin; reflows the leading block; `EVT-COLUMN-PINNED`. */
  pinColumn(id: ColumnId, edge: 'leading' | null): void {
    const col = this.requireColumn(id);
    if (edge !== 'leading' && edge !== null) {
      throw new GridError('INVALID_OPTIONS', `Invalid pin edge: ${String(edge)} (expected 'leading' | null)`, {
        source: 'config',
        context: { columnId: id },
      });
    }
    if (!this.host.columnManageEnabled()) return;
    const current = col.pinned === 'leading' ? 'leading' : null;
    if (current === edge) return; // idempotent
    this.host.setPinned(id, edge);
    this.host.pushCommand(
      'reorder',
      () => this.host.setPinned(id, edge),
      () => this.host.setPinned(id, current),
    );
    this.host.bus.emit('columnPinned', { columnId: id, pinned: edge });
    this.host.announce(
      this.host.t(edge === 'leading' ? 'a11y.columnPinned' : 'a11y.columnUnpinned', {
        column: this.host.columnHeaderOf(id),
      }),
    );
  }

  /**
   * `autofitColumn` — size to the widest VISIBLE content (bounded measure). A
   * hidden column is a no-op; fires `EVT-COLUMN-AUTOFIT`; undoable (`resize`).
   */
  autofitColumn(id: ColumnId): void {
    const col = this.requireColumn(id);
    if (!this.host.autofitEnabled()) return;
    if (col.hidden === true) return; // no-op on a hidden column
    const width = this.fit(id);
    if (width == null) return;
    const from = this.host.currentWidth(id);
    if (width === from) {
      // Still notify (the measure ran) but no undo entry for a no-change fit.
      this.host.bus.emit('columnAutofit', { columnId: id, width });
      this.host.announce(this.host.t('a11y.columnAutofit', { column: this.host.columnHeaderOf(id) }));
      return;
    }
    this.host.applyWidth(id, width);
    this.host.pushCommand(
      'resize',
      () => this.host.applyWidth(id, width),
      () => this.host.applyWidth(id, from),
    );
    this.host.bus.emit('columnAutofit', { columnId: id, width });
    this.host.announce(this.host.t('a11y.columnAutofit', { column: this.host.columnHeaderOf(id) }));
  }

  /** `autofitAllColumns` — autofit every visible column (bounded); one `EVT-COLUMN-AUTOFIT`. */
  autofitAllColumns(): void {
    if (!this.host.autofitEnabled()) return;
    const applied: { columnId: ColumnId; width: number }[] = [];
    const priors: { columnId: ColumnId; width: number }[] = [];
    for (const id of this.host.visibleColumnIds()) {
      const width = this.fit(id);
      if (width == null) continue;
      const from = this.host.currentWidth(id);
      if (width !== from) {
        priors.push({ columnId: id, width: from });
        this.host.applyWidth(id, width);
      }
      applied.push({ columnId: id, width });
    }
    if (applied.length === 0) return;
    if (priors.length > 0) {
      const redo = applied.filter((a) => priors.some((p) => p.columnId === a.columnId));
      this.host.pushCommand(
        'resize',
        () => {
          for (const a of redo) this.host.applyWidth(a.columnId, a.width);
        },
        () => {
          for (const p of priors) this.host.applyWidth(p.columnId, p.width);
        },
      );
    }
    this.host.bus.emit('columnAutofit', { columns: applied });
    this.host.announce(this.host.t('a11y.columnsAutofit', { count: applied.length }));
  }

  /** Bounded measure → clamped autofit width (px), or `null` when unmeasurable. */
  private fit(id: ColumnId): number | null {
    const measured = this.host.measureColumnWidth(id);
    if (measured == null) return null;
    return Math.max(this.host.minColumnWidth, Math.round(measured));
  }
}
