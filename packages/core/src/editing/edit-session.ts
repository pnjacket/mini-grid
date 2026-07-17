/**
 * `COMPONENT-EDIT` — the edit-session controller that drives the cell-edit
 * lifecycle (`ENTITY-EDIT-SESSION`): `idle → editing → validating →`
 * `committed | rejected | cancelled`.
 *
 * `INV-EDIT-SINGLE` holds **by construction**: a single `session` slot; a second
 * `beginEdit` resolves the prior one (commit-or-discard) before opening the new.
 *
 * Commit path (shared by the interactive editor and programmatic
 * `LIB-UPDATE-CELL`): validate (`LIB-VALIDATOR-API`) → on failure emit
 * `EVT-VALIDATION-ERROR` + `GridError{VALIDATION_FAILED}` and stay `rejected`; on
 * success emit the vetoable `EVT-BEFORE-EDIT` (`preventDefault()` aborts) →
 * `MSG-APPLY-EDIT` to the worker → mark the row `dirty` → push an `edit`
 * `Command` (`COMPONENT-HISTORY`) → refresh → emit `EVT-EDIT-COMMIT` +
 * `EVT-AFTER-EDIT`.
 *
 * Editing a **merged region** targets the anchor cell; merge lands in a later
 * slice, so this controller simply edits the addressed cell (anchor === self).
 */
import { GridError } from '../errors.js';
import type { GridEventBus } from '../api/event-bus.js';
import type { ColumnDef } from '../api/options.js';
import type { CellRef, ChangeState, ColumnId, RowData, RowKey } from '../types.js';
import { resolveEditorFactory } from './editors.js';
import type { CellEditor, EditorContext } from './editors.js';
import { compileValidation } from './validation.js';
import type { ValidationError, Validator } from './validation.js';
import type { Translate } from '../i18n/i18n.js';
import { defaultTranslate } from '../i18n/i18n.js';
import { History } from './history.js';
import type { CommandKind } from './history.js';
import { isFormulaSource } from '../formula/index.js';
import { parseFormula } from '../formula/parser.js';

/** Parse a formula body; returns the error message on failure, else `null`. */
function formulaParseError(src: string): string | null {
  try {
    parseFormula(src);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid formula';
  }
}

/** `LIB-UPDATE-CELL`/`LIB-EDIT-CONTROL` resolution (`AC-RESULT`). */
export interface EditResult {
  rowKey: RowKey;
  columnId: ColumnId;
  oldValue: unknown;
  newValue: unknown;
  changeState: ChangeState;
}

/** `ENTITY-EDIT-SESSION.state`. */
export type EditSessionState =
  | 'editing'
  | 'validating'
  | 'committed'
  | 'rejected'
  | 'cancelled';

/** The grid-side services `COMPONENT-EDIT` calls back into. */
export interface EditHost {
  document: Document;
  bus: GridEventBus;
  columns: readonly ColumnDef[];
  /** `COMPONENT-I18N` translator for default validation messages (optional). */
  t?: Translate;
  /** The `editing` feature flag (`PATTERN-FEATURE-FLAGS`). */
  isEditingEnabled(): boolean;
  /** `CAP-FORMULA` — the `formula` flag, so a paste can reject an invalid `=…`. */
  isFormulaEnabled?(): boolean;
  /** `MSG-APPLY-EDIT` — write one cell in the worker; resolves old/new value. */
  applyEdit(
    rowKey: RowKey,
    field: string,
    value: unknown,
  ): Promise<{ oldValue: unknown; newValue: unknown }>;
  /**
   * `MSG-PASTE-APPLY` — write a resolved block of cells in one worker round-trip
   * (`COMPONENT-CLIPBOARD` paste/cut/fill); resolves the per-cell old/new values.
   */
  applyPasteBatch(
    anchor: CellRef,
    cells: readonly { rowKey: RowKey; field: string; value: unknown }[],
  ): Promise<Array<{ rowKey: RowKey; field: string; oldValue: unknown; newValue: unknown }>>;
  /** Best-effort current value of a rendered cell (edit seed / veto oldValue). */
  getCellValue(rowKey: RowKey, field: string): unknown;
  /** Best-effort row record for the validation context. */
  getRowData(rowKey: RowKey): Readonly<RowData> | undefined;
  /** The live `DOM-CELL` node at a logical position, or `undefined`. */
  cellNodeAt(row: number, col: number): HTMLElement | undefined;
  /** `RowKey` for a rendered logical row index. */
  resolveRowKey(row: number): RowKey | undefined;
  /** Rendered logical row index for a `RowKey` (for `LIB-EDIT-CONTROL.beginEdit`). */
  resolveRowIndex(rowKey: RowKey): number | undefined;
  /** Re-query + repaint the visible window (so a committed value shows). */
  refresh(): Promise<void>;
  /** Toggle the "an editor is open" flag the interaction layer reads. */
  setEditing(active: boolean): void;
  /** Restore DOM focus to the origin cell (`A11Y-EDITOR` Esc/commit). */
  focusCell(row: number, col: number): void;
  /** Move the active cell after a commit (Enter ↓ / Tab → / Shift+Tab ←). */
  moveAfterCommit(direction: 'down' | 'right' | 'left'): Promise<void>;
  /**
   * `CAP-MERGE` — the anchor index of the merge region covering `(row, col)`, or
   * `undefined` when the cell is not merged. Editing a covered cell redirects to
   * the anchor (the only editable cell of a merged region).
   */
  mergeAnchorOf?(row: number, col: number): { row: number; col: number } | undefined;
}

interface EditSession {
  rowKey: RowKey;
  columnId: ColumnId;
  field: string;
  column: ColumnDef;
  rowIndex: number;
  colIndex: number;
  initialValue: unknown;
  editor: CellEditor;
  container: HTMLElement;
  cellNode: HTMLElement;
  state: EditSessionState;
  tip?: HTMLElement;
  keyHandler?: (e: KeyboardEvent) => void;
  /** `immediateCommit` change listener (checkbox) to detach on teardown. */
  changeHandler?: ((e: Event) => void) | undefined;
  /** `renderInPopover` editor — the cell carries `aria-expanded` while open. */
  popover?: boolean;
}

/** `LIB-GET-CHANGES` projection — pending row changes bucketed by `changeState`. */
export interface RowChanges {
  new: RowKey[];
  dirty: RowKey[];
  removed: RowKey[];
}

/**
 * `ENTITY-ROW.changeState` tracker — the per-row `changeState` (`clean` default).
 * Shared by `COMPONENT-EDIT` (cell edits) and the structural CRUD commands so an
 * `edit`/`insertRows`/`removeRows`/`insertCols`/`removeCols` `Command.revert` can
 * restore the prior state (`INV-ROWSTATE`, `INV-HISTORY-LINEAR`).
 */
export class ChangeTracker {
  private readonly states = new Map<RowKey, ChangeState>();
  get(rowKey: RowKey): ChangeState {
    return this.states.get(rowKey) ?? 'clean';
  }
  set(rowKey: RowKey, state: ChangeState): void {
    this.states.set(rowKey, state);
  }
  /** Drop a row's tracking entry entirely (e.g. `new → removed` drops the row). */
  delete(rowKey: RowKey): void {
    this.states.delete(rowKey);
  }
  clear(): void {
    this.states.clear();
  }
  /** `LIB-GET-CHANGES` — bucket every tracked row by state (clean rows omitted). */
  getChanges(): RowChanges {
    const out: RowChanges = { new: [], dirty: [], removed: [] };
    for (const [key, state] of this.states) {
      if (state === 'new') out.new.push(key);
      else if (state === 'dirty') out.dirty.push(key);
      else if (state === 'removed') out.removed.push(key);
    }
    return out;
  }
}

export class EditController {
  private session: EditSession | undefined;
  private readonly tracker = new ChangeTracker();
  private readonly validators = new Map<ColumnId, Validator>();
  readonly history: History;
  private tipSeq = 0;

  constructor(
    private readonly host: EditHost,
    maxDepth: number | null = null,
  ) {
    this.history = new History(maxDepth);
  }

  /** `true` while an editor overlay is open (interaction layer guard). */
  isEditing(): boolean {
    return this.session !== undefined;
  }

  /** The active session's `state`, or `'idle'` when none (test hook). */
  get sessionState(): EditSessionState | 'idle' {
    return this.session?.state ?? 'idle';
  }

  /** The active session's target cell, or `null` (test hook / `INV-EDIT-SINGLE`). */
  get activeTarget(): CellRef | null {
    return this.session
      ? { rowKey: this.session.rowKey, columnId: this.session.columnId }
      : null;
  }

  /** `ENTITY-ROW.changeState` for a row (default `clean`). */
  changeStateOf(rowKey: RowKey): ChangeState {
    return this.tracker.get(rowKey);
  }

  /**
   * The shared `ChangeTracker` — the structural CRUD commands (`COMPONENT-API`)
   * transition `changeState` on it so `getChanges()` sees edits + inserts +
   * deletes uniformly and undo restores state across both (`INV-ROWSTATE`).
   */
  get changeTracker(): ChangeTracker {
    return this.tracker;
  }

  // --- Triggers (COMPONENT-INTERACTION / LIB-EDIT-CONTROL) -------------------

  /**
   * Open an editor at a rendered `(row, col)` (`LAYER-EDITOR` triggers). Returns
   * `false` (no editor) when editing is disabled, the column is not editable, or
   * the cell is not currently rendered. A prior session is resolved first
   * (`INV-EDIT-SINGLE`).
   */
  beginEditAt(row: number, col: number, initialText?: string): boolean {
    if (!this.host.isEditingEnabled()) return false;
    // `CAP-MERGE` — an edit addressed to a covered cell redirects to the anchor
    // (the anchor is the only editable cell of a merged region).
    const anchor = this.host.mergeAnchorOf?.(row, col);
    if (anchor && (anchor.row !== row || anchor.col !== col)) {
      row = anchor.row;
      col = anchor.col;
    }
    const column = this.host.columns[col];
    if (!column || column.editable !== true) return false;
    const cellNode = this.host.cellNodeAt(row, col);
    if (!cellNode) return false;
    const rowKey = this.host.resolveRowKey(row);
    if (rowKey === undefined) return false;

    // INV-EDIT-SINGLE — resolve the prior session before claiming the slot.
    if (this.session) {
      const prior = this.session;
      this.session = undefined;
      void this.commitSession(prior, false);
    }

    const field = column.field;
    const initialValue = this.host.getCellValue(rowKey, field);
    const cellRef: CellRef = { rowKey, columnId: column.id };

    const doc = this.host.document;
    const container = doc.createElement('div');
    container.className = 'mg-editor';
    container.setAttribute('data-mg-editor', '');
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    // Mount INTO the gridcell (ARIA: a row's children must be gridcells; a
    // gridcell may host an input). Clear the cell text, mark the cell as
    // editing so `refresh` won't overwrite the editor, and let the validation
    // tip escape the cell's clip.
    cellNode.textContent = '';
    cellNode.setAttribute('data-mg-editing', '');
    cellNode.style.overflow = 'visible';
    cellNode.appendChild(container);

    const editor = resolveEditorFactory(column)();
    const ctx: EditorContext = {
      container,
      document: doc,
      column,
      initialValue,
      initialText,
      ariaLabel: column.header ?? column.id,
      cellNode,
      // Portal target for a `renderInPopover` editor's overlay — mirrors how
      // `LAYER-CONTEXT-MENU` / `LAYER-FILTER-MENU` escape the grid's clip.
      overlayContainer: doc.body,
      requestCommit: () => {
        void this.commitEdit().catch(() => {
          /* validation failure keeps the session open (rejected) */
        });
      },
      requestCancel: () => this.cancelEdit(),
    };
    editor.mount(cellRef, ctx);

    const keyHandler = (e: KeyboardEvent): void => this.onEditorKeyDown(e);
    container.addEventListener('keydown', keyHandler);

    // `CE-BOOL-COMMIT` — an `immediateCommit` editor commits on its own `change`
    // (the checkbox toggle), before any blur can discard the new value. `change`
    // bubbles from the control to the editor container.
    let changeHandler: ((e: Event) => void) | undefined;
    if (editor.immediateCommit) {
      changeHandler = () => {
        void this.commitEdit().catch(() => {
          /* validation failure keeps the session open (rejected) */
        });
      };
      container.addEventListener('change', changeHandler);
    }

    // `CE-SELECT-POPOVER` — a `renderInPopover` editor's surface lives in the
    // overlay layer; the origin cell is the trigger and carries `aria-expanded`.
    if (editor.renderInPopover) cellNode.setAttribute('aria-expanded', 'true');

    this.session = {
      rowKey,
      columnId: column.id,
      field,
      column,
      rowIndex: row,
      colIndex: col,
      initialValue,
      editor,
      container,
      cellNode,
      state: 'editing',
      keyHandler,
      changeHandler,
      popover: editor.renderInPopover === true,
    };
    this.host.setEditing(true);
    this.host.bus.emit('editBegin', { cell: cellRef });
    return true;
  }

  /** `LIB-EDIT-CONTROL.beginEdit(cell)` — open an editor by identity (if rendered). */
  beginEdit(cell: CellRef): boolean {
    const col = this.host.columns.findIndex((c) => c.id === cell.columnId);
    if (col < 0) return false;
    const row = this.host.resolveRowIndex(cell.rowKey);
    if (row === undefined) return false;
    return this.beginEditAt(row, col);
  }

  private onEditorKeyDown(e: KeyboardEvent): void {
    if (!this.session) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void this.commitAndMove('down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      void this.commitAndMove(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancelEdit();
    }
  }

  private async commitAndMove(direction: 'down' | 'right' | 'left'): Promise<void> {
    try {
      const res = await this.commitEdit();
      if (res) await this.host.moveAfterCommit(direction);
    } catch {
      // Validation failed — stay in the (now `rejected`) session; no move.
    }
  }

  // --- Commit / cancel (LIB-EDIT-CONTROL) -----------------------------------

  /**
   * `LIB-EDIT-CONTROL.commitEdit` — validate + apply the open editor's draft.
   * Resolves the `EditResult` on success, `undefined` when there is no session
   * or the edit was vetoed; **rejects** with `GridError{VALIDATION_FAILED}` when
   * invalid (the session stays open in the `rejected` state).
   */
  async commitEdit(): Promise<EditResult | undefined> {
    const s = this.session;
    if (!s) return undefined;
    return this.commitSession(s, true);
  }

  /** `LIB-EDIT-CONTROL.cancelEdit` — discard the draft, restore focus to the cell. */
  cancelEdit(): void {
    const s = this.session;
    if (!s) return;
    s.state = 'cancelled';
    void this.teardown(s, 'cancel');
  }

  private async commitSession(
    s: EditSession,
    keepOnReject: boolean,
  ): Promise<EditResult | undefined> {
    s.state = 'validating';
    const newValue = s.editor.getValue();
    const extraValidate = s.editor.validate ? (): true | ValidationError => s.editor.validate!() : undefined;
    let outcome: { result: EditResult; applied: boolean };
    try {
      outcome = await this.commitValue({
        rowKey: s.rowKey,
        columnId: s.columnId,
        field: s.field,
        column: s.column,
        newValue,
        oldBest: s.initialValue,
        extraValidate,
        // The editor overlay is torn down + refreshed below, so skip the
        // in-commit refresh (it would repaint before the editor is removed).
        refreshAfter: false,
      });
    } catch (err) {
      if (err instanceof GridError && err.code === 'VALIDATION_FAILED') {
        if (keepOnReject) {
          this.rejectSession(s, err.message);
          throw err;
        }
        // Resolving a prior session that turns out invalid — discard it.
        await this.teardown(s, 'cancel');
        return undefined;
      }
      throw err;
    }
    if (!outcome.applied) {
      // EVT-BEFORE-EDIT vetoed — abort (treated as a cancel of this session).
      await this.teardown(s, 'cancel');
      return undefined;
    }
    s.state = 'committed';
    await this.teardown(s, 'commit');
    return outcome.result;
  }

  // --- Programmatic edit (LIB-UPDATE-CELL) ----------------------------------

  /**
   * `LIB-UPDATE-CELL` — commit a value without opening an editor. Same commit
   * path (validate → veto → apply → history → `EVT-AFTER-EDIT`). Rejects with
   * `GridError{VALIDATION_FAILED}` on invalid input.
   */
  async updateCell(rowKey: RowKey, columnId: ColumnId, value: unknown): Promise<EditResult> {
    const column = this.host.columns.find((c) => c.id === columnId);
    if (!column) {
      throw new GridError('WORKER_OP_FAILED', `Unknown column id: ${String(columnId)}`, {
        source: 'data-op',
        context: { columnId },
      });
    }
    const oldBest = this.host.getCellValue(rowKey, column.field);
    const outcome = await this.commitValue({
      rowKey,
      columnId,
      field: column.field,
      column,
      newValue: value,
      oldBest,
      refreshAfter: true,
    });
    return outcome.result;
  }

  // --- Batch commit (COMPONENT-CLIPBOARD paste / cut / fill) ----------------

  /**
   * Commit a **block** of cell writes as ONE undoable `Command` — the write path
   * shared by clipboard paste, cut (clear source), and fill.
   *
   * Each cell runs through the same validation gate as an edit (`LIB-VALIDATOR-API`);
   * an invalid cell is **rejected** (dropped from the block, `EVT-VALIDATION-ERROR`
   * fires) rather than aborting the whole paste (per the validation contract).
   * Non-editable / unknown columns are skipped. The accepted cells are applied in
   * one worker round-trip (`MSG-PASTE-APPLY`), their rows marked `dirty`
   * (`INV-ROWSTATE`), and a single reversible `Command` is pushed (undo reverts the
   * entire block). Resolves the applied projections (`{ cell, oldValue, newValue }`).
   */
  async applyBatch(
    anchor: CellRef,
    writes: readonly { rowKey: RowKey; columnId: ColumnId; value: unknown }[],
    kind: CommandKind = 'paste',
  ): Promise<{ applied: Array<{ cell: CellRef; oldValue: unknown; newValue: unknown }> }> {
    // Resolve + validate each write; keep only the accepted (rowKey, field, value).
    // P13 (SCALE-PASTE-APPLY): resolve columns via an O(1) map built once — a paste/
    // fill block is O(writes), not O(writes × columns) (was `columns.find` per write).
    const columnById = new Map(this.host.columns.map((c) => [c.id, c]));
    const accepted: { rowKey: RowKey; columnId: ColumnId; field: string; value: unknown }[] = [];
    for (const w of writes) {
      const column = columnById.get(w.columnId);
      if (!column) continue;
      // `CAP-FORMULA` — an invalid pasted formula is REJECTED per-cell (Excel-like:
      // an unparseable `=…` is not silently kept as text), dropping just this cell
      // from the batch + firing `EVT-VALIDATION-ERROR`; the rest of the paste applies.
      if (this.host.isFormulaEnabled?.() && isFormulaSource(w.value)) {
        const parseErr = formulaParseError(w.value);
        if (parseErr) {
          const cell: CellRef = { rowKey: w.rowKey, columnId: w.columnId };
          this.host.bus.emit('validationError', {
            cell,
            error: new GridError('FORMULA_PARSE_FAILED', parseErr, {
              source: 'validation',
              context: { rowKey: w.rowKey, columnId: w.columnId },
            }),
          });
          continue;
        }
      }
      const error = this.validate(column, w.value, w.rowKey, column.field);
      if (error) {
        const cell: CellRef = { rowKey: w.rowKey, columnId: w.columnId };
        const gridErr = new GridError('VALIDATION_FAILED', error.message, {
          source: 'validation',
          context: { rowKey: w.rowKey, columnId: w.columnId },
        });
        this.host.bus.emit('validationError', { cell, error: gridErr });
        continue;
      }
      accepted.push({ rowKey: w.rowKey, columnId: w.columnId, field: column.field, value: w.value });
    }
    if (accepted.length === 0) return { applied: [] };

    const applyCells = accepted.map((a) => ({ rowKey: a.rowKey, field: a.field, value: a.value }));
    const results = await this.host.applyPasteBatch(anchor, applyCells);

    // Snapshot prior changeState per unique row (for the revert), then mark dirty.
    const priorState = new Map<RowKey, ChangeState>();
    for (const r of results) {
      if (!priorState.has(r.rowKey)) priorState.set(r.rowKey, this.tracker.get(r.rowKey));
    }
    for (const key of priorState.keys()) this.tracker.set(key, 'dirty');

    const redoCells = results.map((r) => ({ rowKey: r.rowKey, field: r.field, value: r.newValue }));
    const undoCells = results.map((r) => ({ rowKey: r.rowKey, field: r.field, value: r.oldValue }));
    this.history.push({
      kind,
      targetThread: 'worker',
      apply: async () => {
        await this.host.applyPasteBatch(anchor, redoCells);
        for (const key of priorState.keys()) this.tracker.set(key, 'dirty');
        await this.host.refresh();
      },
      revert: async () => {
        await this.host.applyPasteBatch(anchor, undoCells);
        for (const [key, state] of priorState) this.tracker.set(key, state);
        await this.host.refresh();
      },
    });

    await this.host.refresh();
    const byField = new Map(accepted.map((a) => [`${String(a.rowKey)} ${a.field}`, a.columnId]));
    const applied = results.map((r) => ({
      cell: {
        rowKey: r.rowKey,
        columnId: byField.get(`${String(r.rowKey)} ${r.field}`) as ColumnId,
      },
      oldValue: r.oldValue,
      newValue: r.newValue,
    }));
    return { applied };
  }

  // --- Undo / redo (LIB-UNDO / LIB-REDO) ------------------------------------

  undo(): Promise<void> {
    return this.history.undo();
  }
  redo(): Promise<void> {
    return this.history.redo();
  }

  /** Clear session + history + change-tracking (rebind reset — `AC-REBIND`). */
  reset(): void {
    if (this.session) void this.teardown(this.session, 'cancel');
    this.history.clear();
    this.tracker.clear();
  }

  // --- Shared commit core ---------------------------------------------------

  private async commitValue(params: {
    rowKey: RowKey;
    columnId: ColumnId;
    field: string;
    column: ColumnDef;
    newValue: unknown;
    oldBest: unknown;
    extraValidate?: (() => true | ValidationError) | undefined;
    refreshAfter: boolean;
  }): Promise<{ result: EditResult; applied: boolean }> {
    const { rowKey, columnId, field, column, newValue, oldBest, extraValidate } = params;
    const cell: CellRef = { rowKey, columnId };

    // Validate (`LIB-VALIDATOR-API`): column rules first, then the editor's own.
    const error = this.validate(column, newValue, rowKey, field, extraValidate);
    if (error) {
      const gridErr = new GridError('VALIDATION_FAILED', error.message, {
        source: 'validation',
        context: { rowKey, columnId },
      });
      this.host.bus.emit('validationError', { cell, error: gridErr });
      throw gridErr;
    }

    // EVT-BEFORE-EDIT (vetoable) — a veto aborts before anything is applied.
    const vetoed = this.host.bus.emitVetoable('beforeEdit', {
      cell,
      oldValue: oldBest,
      newValue,
    });
    if (vetoed) {
      return {
        result: {
          rowKey,
          columnId,
          oldValue: oldBest,
          newValue: oldBest,
          changeState: this.tracker.get(rowKey),
        },
        applied: false,
      };
    }

    // Apply via the worker (`MSG-APPLY-EDIT`); use the authoritative oldValue.
    const applied = await this.host.applyEdit(rowKey, field, newValue);
    const oldValue = applied.oldValue;
    const priorState = this.tracker.get(rowKey);
    this.tracker.set(rowKey, 'dirty');

    // Push the reversible `edit` Command (`ENTITY-HISTORY-ENTRY`).
    this.history.push({
      kind: 'edit',
      targetThread: 'worker',
      apply: async () => {
        await this.host.applyEdit(rowKey, field, newValue);
        this.tracker.set(rowKey, 'dirty');
        await this.host.refresh();
      },
      revert: async () => {
        await this.host.applyEdit(rowKey, field, oldValue);
        this.tracker.set(rowKey, priorState);
        await this.host.refresh();
      },
    });

    if (params.refreshAfter) await this.host.refresh();
    this.host.bus.emit('afterEdit', { cell, oldValue, newValue });
    return {
      result: { rowKey, columnId, oldValue, newValue, changeState: 'dirty' },
      applied: true,
    };
  }

  private validate(
    column: ColumnDef,
    value: unknown,
    rowKey: RowKey,
    field: string,
    extra?: (() => true | ValidationError) | undefined,
  ): ValidationError | null {
    let validator = this.validators.get(column.id);
    if (!validator) {
      validator = compileValidation(column.validation, this.host.t ?? defaultTranslate);
      this.validators.set(column.id, validator);
    }
    const ctx = {
      rowKey,
      columnId: column.id,
      field,
      type: column.type ?? ('text' as const),
      data: this.host.getRowData(rowKey) ?? {},
    };
    const r1 = validator(value, ctx);
    if (r1 !== true) return r1;
    if (extra) {
      const r2 = extra();
      if (r2 !== true) return r2;
    }
    return null;
  }

  // --- DOM teardown / rejection ---------------------------------------------

  private async teardown(s: EditSession, kind: 'commit' | 'cancel'): Promise<void> {
    if (s.keyHandler) s.container.removeEventListener('keydown', s.keyHandler);
    if (s.changeHandler) s.container.removeEventListener('change', s.changeHandler);
    s.editor.destroy();
    s.tip?.remove();
    s.container.remove();
    // Restore the cell so `refresh` repaints its (committed or original) value.
    s.cellNode.removeAttribute('data-mg-editing');
    s.cellNode.style.overflow = '';
    if (s.popover) s.cellNode.removeAttribute('aria-expanded');
    if (this.session === s) this.session = undefined;
    this.host.setEditing(this.session !== undefined);
    const cell: CellRef = { rowKey: s.rowKey, columnId: s.columnId };
    this.host.bus.emit(kind === 'commit' ? 'editCommit' : 'editCancel', { cell });
    // Repaint the cell (drop the cleared/edited overlay text) then restore focus
    // — but only when no other editor is now open (avoids focus steal when a
    // prior session resolves while a new one is already mounted).
    await this.host.refresh();
    if (this.session === undefined) this.host.focusCell(s.rowIndex, s.colIndex);
  }

  /** Keep the session open, mark it invalid, and show the validation tip. */
  private rejectSession(s: EditSession, message: string): void {
    s.state = 'rejected';
    const control = s.container.querySelector('input, select') as HTMLElement | null;
    let tip = s.tip;
    if (!tip) {
      tip = this.host.document.createElement('div');
      tip.className = 'mg-validation-tip';
      tip.setAttribute('role', 'alert'); // assertive announcement (A11y)
      tip.id = `mg-tip-${++this.tipSeq}`;
      s.container.appendChild(tip);
      s.tip = tip;
    }
    tip.textContent = message;
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', tip.id);
      control.focus();
    }
  }
}
