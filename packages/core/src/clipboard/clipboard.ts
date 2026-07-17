/**
 * `COMPONENT-CLIPBOARD` — owns `LIB-CLIPBOARD` (`copy()` / `cut()` / `paste()` /
 * `fill(range)`) plus the fill-handle affordance. Gated behind the `clipboard`
 * feature flag.
 *
 * Serialization is **TSV plain text**: rows joined on `\n`, cells on `\t`.
 *
 * `SEC-PASTE-UNTRUSTED` — paste **only ever reads `text/plain`** (`readText()` or
 * the `text/plain` flavor of a paste event); the `text/html` clipboard flavor is
 * never read and never rendered as HTML. Parsed values flow through the normal
 * edit/commit path (`SEC-ESCAPE-DEFAULT` → `textContent`); nothing is `innerHTML`'d
 * or evaluated.
 *
 * Writes (paste / cut-clear / fill) go through `COMPONENT-EDIT`'s batch-commit
 * (`applyBatch`): per-cell validation applies, invalid cells are rejected, and the
 * whole block is ONE undoable `Command`. Vetoable via `EVT-BEFORE-PASTE`
 * (`preventDefault()` aborts — no cells change, no `EVT-AFTER-PASTE`); notify
 * `EVT-AFTER-PASTE` carries `{ targetRange, data }`.
 */
import type { ColumnDef } from '../api/options.js';
import type { GridEventBus } from '../api/event-bus.js';
import type { CellRef, ColumnId, ColumnType, Range, RowData, RowKey } from '../types.js';
import { getByPath } from '../util/path.js';

/** One resolved window row (`{ key, data }`) as returned by the data client. */
export interface ClipboardRow {
  key: RowKey;
  data: RowData;
}

/** Index-space cursor `{ row, col }`. */
export interface ClipboardIndex {
  row: number;
  col: number;
}

/** The grid-side services `COMPONENT-CLIPBOARD` calls back into. */
export interface ClipboardHost {
  document: Document;
  bus: GridEventBus;
  /** The live, mutable column model (display order). */
  columns: readonly ColumnDef[];
  /** `clipboard` feature flag (`PATTERN-FEATURE-FLAGS`). */
  isEnabled(): boolean;
  /** `editing` feature flag — paste/cut/fill mutate, so they require it. */
  isEditingEnabled(): boolean;
  /** `true` while a `LAYER-EDITOR` is open (the editor owns copy/paste then). */
  isEditing(): boolean;
  /** Post-filter logical row count. */
  rowCount(): number;
  /** Logical column count. */
  colCount(): number;
  /** The active selection range in index space, or `null` when empty. */
  getSelectionRange(): Range | null;
  /** The active cell index `{ row, col }` (paste anchor), or `null`. */
  getActiveIndex(): ClipboardIndex | null;
  /** Ordered rows `[top, bottomExclusive)` (works off the rendered window). */
  getRowsWindow(top: number, bottomExclusive: number): Promise<ClipboardRow[]>;
  /** `COMPONENT-EDIT.applyBatch` — validate + apply a block as one undoable Command. */
  commitBatch(
    anchor: CellRef,
    writes: readonly { rowKey: RowKey; columnId: ColumnId; value: unknown }[],
  ): Promise<{ applied: Array<{ cell: CellRef; oldValue: unknown; newValue: unknown }> }>;
  /** Replace the selection with `range` (anchored at its top-left). */
  setSelectionRange(range: Range, active: ClipboardIndex): void;
  /** The live `DOM-CELL` node at a logical position (fill-handle mount / hit-test). */
  cellAt(row: number, col: number): HTMLElement | undefined;
  /** `DOM-ROOT` (`role="grid"`) — key + fill-handle listener root. */
  root: HTMLElement;
}

/** Inclusive, normalized range from two corners. */
function normalize(a: ClipboardIndex, b: ClipboardIndex): Range {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * Parse a TSV block as PLAIN TEXT (`SEC-PASTE-UNTRUSTED`): rows split on `\n`
 * (a `\r\n` / `\r` newline is normalized first), cells on `\t`. A single trailing
 * newline (common from a spreadsheet copy) is dropped so it doesn't add a blank row.
 */
export function parseTsv(text: string): string[][] {
  if (text === '') return [];
  let s = text.replace(/\r\n?/g, '\n');
  if (s.endsWith('\n')) s = s.slice(0, -1);
  if (s === '') return [];
  return s.split('\n').map((line) => line.split('\t'));
}

/** Serialize a value matrix to a TSV string (rows on `\n`, cells on `\t`). */
export function serializeTsv(matrix: readonly (readonly unknown[])[]): string {
  return matrix
    .map((row) => row.map((v) => (v == null ? '' : String(v))).join('\t'))
    .join('\n');
}

/** Coerce a pasted text cell to the column type (numbers become `number`). */
function coerce(raw: string, type: ColumnType | undefined): unknown {
  if (type === 'number') {
    if (raw.trim() === '') return '';
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw; // non-numeric → leave text; validation catches it
  }
  return raw;
}

export class ClipboardController {
  private fillHandle: HTMLElement | undefined;
  private filling = false;
  private fillSource: Range | null = null;
  private fillTarget: Range | null = null;
  /** Last `text/plain` seen on a paste event (fallback when `readText` is blocked). */
  private lastPasteText = '';

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onPaste: (e: ClipboardEvent) => void;
  private readonly onFillDown: (e: MouseEvent) => void;
  private readonly onFillTouchStart: (e: TouchEvent) => void;
  private readonly onDocMove: (e: MouseEvent) => void;
  private readonly onDocUp: (e: MouseEvent) => void;
  private readonly onDocTouchMove: (e: TouchEvent) => void;
  private readonly onDocTouchEnd: () => void;

  constructor(private readonly host: ClipboardHost) {
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onPaste = (e) => {
      // Only ever capture the plain-text flavor (`SEC-PASTE-UNTRUSTED`).
      this.lastPasteText = e.clipboardData?.getData('text/plain') ?? '';
    };
    this.onFillDown = (e) => this.handleFillDown(e);
    this.onFillTouchStart = (e) => this.handleFillTouchStart(e);
    this.onDocMove = (e) => this.handleDocMove(e.clientX, e.clientY, e.target);
    this.onDocUp = () => void this.endFill();
    this.onDocTouchMove = (e) => {
      const t = e.touches[0];
      if (t) this.handleDocMove(t.clientX, t.clientY, e.target);
    };
    this.onDocTouchEnd = () => void this.endFill();

    const { root } = host;
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('paste', this.onPaste as EventListener);
  }

  destroy(): void {
    this.removeFillHandle();
    const { root } = this.host;
    root.removeEventListener('keydown', this.onKeyDown);
    root.removeEventListener('paste', this.onPaste as EventListener);
    const doc = this.host.document;
    doc.removeEventListener('mousemove', this.onDocMove);
    doc.removeEventListener('mouseup', this.onDocUp);
    doc.removeEventListener('touchmove', this.onDocTouchMove);
    doc.removeEventListener('touchend', this.onDocTouchEnd);
  }

  // --- LIB-CLIPBOARD --------------------------------------------------------

  /** `copy()` — serialize the selection to TSV and write the system clipboard. */
  async copy(): Promise<void> {
    if (!this.host.isEnabled()) return;
    const range = this.host.getSelectionRange();
    if (!range) return;
    const tsv = await this.serializeRange(range);
    await this.writeClipboard(tsv);
  }

  /** `cut()` — copy, then clear the (editable) source cells as one undoable Command. */
  async cut(): Promise<void> {
    if (!this.host.isEnabled() || !this.host.isEditingEnabled()) return;
    const range = this.host.getSelectionRange();
    if (!range) return;
    await this.copy();
    const rows = await this.host.getRowsWindow(range.top, range.bottom + 1);
    const writes: { rowKey: RowKey; columnId: ColumnId; value: unknown }[] = [];
    for (const row of rows) {
      for (let c = range.left; c <= range.right; c++) {
        const col = this.host.columns[c];
        if (col?.editable === true) writes.push({ rowKey: row.key, columnId: col.id, value: '' });
      }
    }
    if (writes.length === 0) return;
    const anchor: CellRef = { rowKey: rows[0]!.key, columnId: this.host.columns[range.left]!.id };
    await this.host.commitBatch(anchor, writes);
  }

  /**
   * `paste()` — read `text/plain` from the clipboard, parse as TSV, and apply the
   * block anchored at the active cell (expanding the target range, clamped to
   * extents). Resolves `{ targetRange }`. Vetoable via `EVT-BEFORE-PASTE`.
   */
  async paste(): Promise<{ targetRange: Range }> {
    const anchor = this.host.getActiveIndex();
    const anchorRange: Range = anchor
      ? { top: anchor.row, bottom: anchor.row, left: anchor.col, right: anchor.col }
      : { top: 0, bottom: 0, left: 0, right: 0 };
    if (!this.host.isEnabled() || !this.host.isEditingEnabled() || !anchor) {
      return { targetRange: anchorRange };
    }
    const rowCount = this.host.rowCount();
    const colCount = this.host.colCount();
    if (rowCount === 0 || colCount === 0) return { targetRange: anchorRange };

    const text = await this.readClipboard();
    const data = parseTsv(text);
    if (data.length === 0) return { targetRange: anchorRange };

    const nRows = data.length;
    const nCols = data.reduce((m, r) => Math.max(m, r.length), 0);
    const top = anchor.row;
    const left = anchor.col;
    const bottom = clamp(top + nRows - 1, 0, rowCount - 1);
    const right = clamp(left + nCols - 1, 0, colCount - 1);
    const targetRange: Range = { top, bottom, left, right };

    // EVT-BEFORE-PASTE (vetoable) — a veto aborts before anything is applied.
    if (this.host.bus.emitVetoable('beforePaste', { targetRange, data })) {
      return { targetRange };
    }

    const rows = await this.host.getRowsWindow(top, bottom + 1);
    const writes: { rowKey: RowKey; columnId: ColumnId; value: unknown }[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; left + j <= right; j++) {
        const col = this.host.columns[left + j];
        if (col?.editable !== true) continue; // paste only writes editable cells
        const raw = data[i]?.[j] ?? '';
        writes.push({ rowKey: rows[i]!.key, columnId: col.id, value: coerce(raw, col.type) });
      }
    }
    const anchorRef: CellRef = {
      rowKey: rows[0]?.key ?? (top as unknown as RowKey),
      columnId: this.host.columns[left]!.id,
    };
    if (writes.length > 0) await this.host.commitBatch(anchorRef, writes);

    // EVT-AFTER-PASTE — notify with the parsed block + the resolved target range.
    this.host.bus.emit('afterPaste', { targetRange, data });
    // Expand the selection to cover the pasted block.
    this.host.setSelectionRange(targetRange, { row: top, col: left });
    return { targetRange };
  }

  /**
   * `fill(range)` — pattern-fill the source selection's values across `range`
   * (the fill target, a superset of the source). One undoable Command. The source
   * is the current selection; cells inside the source are left unchanged.
   */
  async fill(range: Range): Promise<void> {
    if (!this.host.isEnabled() || !this.host.isEditingEnabled()) return;
    const source = this.host.getSelectionRange();
    if (!source) return;
    const rowCount = this.host.rowCount();
    const colCount = this.host.colCount();
    const target: Range = {
      top: clamp(Math.min(range.top, range.bottom), 0, rowCount - 1),
      bottom: clamp(Math.max(range.top, range.bottom), 0, rowCount - 1),
      left: clamp(Math.min(range.left, range.right), 0, colCount - 1),
      right: clamp(Math.max(range.left, range.right), 0, colCount - 1),
    };
    const srcH = source.bottom - source.top + 1;
    const srcW = source.right - source.left + 1;

    // Source value matrix (raw typed values).
    const srcRows = await this.host.getRowsWindow(source.top, source.bottom + 1);
    const values: unknown[][] = srcRows.map((r) => {
      const arr: unknown[] = [];
      for (let c = source.left; c <= source.right; c++) {
        const col = this.host.columns[c];
        arr.push(col ? getByPath(r.data, col.field) : undefined);
      }
      return arr;
    });
    if (values.length === 0) return;

    const targetRows = await this.host.getRowsWindow(target.top, target.bottom + 1);
    const writes: { rowKey: RowKey; columnId: ColumnId; value: unknown }[] = [];
    for (let ri = 0; ri < targetRows.length; ri++) {
      const r = target.top + ri;
      for (let c = target.left; c <= target.right; c++) {
        // Leave the source cells themselves untouched.
        if (r >= source.top && r <= source.bottom && c >= source.left && c <= source.right) continue;
        const col = this.host.columns[c];
        if (col?.editable !== true) continue;
        const sr = ((r - source.top) % srcH + srcH) % srcH;
        const sc = ((c - source.left) % srcW + srcW) % srcW;
        writes.push({ rowKey: targetRows[ri]!.key, columnId: col.id, value: values[sr]?.[sc] });
      }
    }
    if (writes.length === 0) return;
    const anchorRef: CellRef = {
      rowKey: targetRows[0]!.key,
      columnId: this.host.columns[target.left]!.id,
    };
    await this.host.commitBatch(anchorRef, writes);
    this.host.setSelectionRange(target, { row: target.top, col: target.left });
  }

  // --- Serialization / clipboard IO -----------------------------------------

  private async serializeRange(range: Range): Promise<string> {
    const rows = await this.host.getRowsWindow(range.top, range.bottom + 1);
    const matrix = rows.map((row) => {
      const cells: unknown[] = [];
      for (let c = range.left; c <= range.right; c++) {
        const col = this.host.columns[c];
        cells.push(col ? getByPath(row.data, col.field) : '');
      }
      return cells;
    });
    return serializeTsv(matrix);
  }

  /** Write text to the system clipboard, falling back to `execCommand('copy')`. */
  private async writeClipboard(text: string): Promise<void> {
    const view = this.host.document.defaultView;
    const clip = view?.navigator?.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      try {
        await clip.writeText(text);
        return;
      } catch {
        /* permission/headless failure → fall back below */
      }
    }
    this.execCopyFallback(text);
  }

  /** Hidden-textarea `execCommand('copy')` fallback (older/headless environments). */
  private execCopyFallback(text: string): void {
    const doc = this.host.document;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    try {
      (doc as unknown as { execCommand?: (c: string) => boolean }).execCommand?.('copy');
    } catch {
      /* nothing more we can do */
    }
    ta.remove();
  }

  /** Read `text/plain` from the clipboard (never `text/html` — `SEC-PASTE-UNTRUSTED`). */
  private async readClipboard(): Promise<string> {
    const view = this.host.document.defaultView;
    const clip = view?.navigator?.clipboard;
    if (clip && typeof clip.readText === 'function') {
      try {
        return await clip.readText();
      } catch {
        /* permission/headless failure → fall back to the last paste-event text */
      }
    }
    return this.lastPasteText;
  }

  // --- Keyboard (BIND-KEYS: Ctrl+C / Ctrl+X / Ctrl+V) -----------------------

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.host.isEnabled()) return;
    if (this.host.isEditing()) return; // the open editor owns copy/paste
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'c') {
      e.preventDefault();
      void this.copy();
    } else if (key === 'x') {
      e.preventDefault();
      void this.cut();
    } else if (key === 'v') {
      e.preventDefault();
      void this.paste();
    }
  }

  // --- Fill handle (BIND-POINTER: drag the active-range corner) --------------

  /**
   * Reposition (or remove) the fill handle after every render / selection change.
   * The handle sits at the active range's bottom-right cell corner; it is hidden
   * while an editor is open or when there is no selection.
   */
  afterRender(): void {
    this.removeFillHandle();
    if (!this.host.isEnabled() || !this.host.isEditingEnabled() || this.host.isEditing()) return;
    const range = this.host.getSelectionRange();
    if (!range) return;
    const cell = this.host.cellAt(range.bottom, range.right);
    if (!cell) return;
    const handle = this.host.document.createElement('div');
    handle.className = 'mg-fill-handle';
    handle.setAttribute('data-mg-fill-handle', '');
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('mousedown', this.onFillDown);
    handle.addEventListener('touchstart', this.onFillTouchStart, { passive: false });
    cell.appendChild(handle);
    this.fillHandle = handle;
  }

  private removeFillHandle(): void {
    if (this.fillHandle) {
      this.fillHandle.removeEventListener('mousedown', this.onFillDown);
      this.fillHandle.removeEventListener('touchstart', this.onFillTouchStart);
      this.fillHandle.remove();
      this.fillHandle = undefined;
    }
  }

  private beginFill(): void {
    this.fillSource = this.host.getSelectionRange();
    if (!this.fillSource) return;
    this.filling = true;
    this.fillTarget = this.fillSource;
    const doc = this.host.document;
    doc.addEventListener('mousemove', this.onDocMove);
    doc.addEventListener('mouseup', this.onDocUp);
    doc.addEventListener('touchmove', this.onDocTouchMove, { passive: false });
    doc.addEventListener('touchend', this.onDocTouchEnd);
  }

  private handleFillDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.beginFill();
  }

  private handleFillTouchStart(e: TouchEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.beginFill();
  }

  private handleDocMove(x: number, y: number, target: EventTarget | null): void {
    if (!this.filling || !this.fillSource) return;
    const pos = this.cellIndexFromPoint(x, y, target);
    if (!pos) return;
    // Fill extends the source rectangle out to the pointer cell (union).
    this.fillTarget = normalize(
      { row: this.fillSource.top, col: this.fillSource.left },
      { row: Math.max(pos.row, this.fillSource.bottom), col: Math.max(pos.col, this.fillSource.right) },
    );
  }

  private async endFill(): Promise<void> {
    if (!this.filling) return;
    this.filling = false;
    const doc = this.host.document;
    doc.removeEventListener('mousemove', this.onDocMove);
    doc.removeEventListener('mouseup', this.onDocUp);
    doc.removeEventListener('touchmove', this.onDocTouchMove);
    doc.removeEventListener('touchend', this.onDocTouchEnd);
    const target = this.fillTarget;
    const source = this.fillSource;
    this.fillTarget = null;
    this.fillSource = null;
    // Only fill when the target actually extended beyond the source.
    if (!target || !source) return;
    if (target.bottom === source.bottom && target.right === source.right) return;
    await this.fill(target);
  }

  private cellIndexFromPoint(
    x: number,
    y: number,
    target: EventTarget | null,
  ): ClipboardIndex | null {
    let cell: HTMLElement | null = null;
    const el = target as HTMLElement | null;
    if (el && typeof el.closest === 'function') {
      cell = el.closest('[role="gridcell"]') as HTMLElement | null;
    }
    if (!cell) {
      const doc = this.host.document;
      const hit = doc.elementFromPoint?.(x, y) as HTMLElement | null;
      cell = hit?.closest?.('[role="gridcell"]') as HTMLElement | null;
    }
    if (!cell || !this.host.root.contains(cell)) return null;
    const row = Number(cell.getAttribute('aria-rowindex')) - 1;
    const col = Number(cell.getAttribute('aria-colindex')) - 1;
    if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0) return null;
    return { row, col };
  }
}
