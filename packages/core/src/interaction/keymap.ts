/**
 * `BIND-KEYS` — the remappable default keyboard map plus the pure navigation math
 * (`computeMove`) it drives. Owned by `COMPONENT-INTERACTION`.
 *
 * A `KeyMap` binds a **key token** (`e.key`, prefixed `Ctrl+` for ctrl/meta, and
 * `Shift+Tab` as its own token) to a `NavAction`. `resolveKey` turns a
 * `KeyboardEvent` into `{ action, extend }` where `extend` = the Shift modifier
 * (range-extend) for every movement except `collapse`/Tab. Hosts remap by
 * passing `options.keyBindings` (a partial override merged over the defaults).
 *
 * `computeMove` is a pure function (index-space in, clamped index-space out) so
 * the arrow/Home/End/Page/Tab semantics are unit-testable without a DOM.
 */

/** A normalized navigation action produced by a key binding. */
export type NavAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'rowStart'
  | 'rowEnd'
  | 'gridStart'
  | 'gridEnd'
  | 'pageUp'
  | 'pageDown'
  | 'nextCell'
  | 'prevCell'
  | 'collapse';

/** Key-token → action map (`BIND-KEYS`). Remappable via `options.keyBindings`. */
export type KeyMap = Record<string, NavAction>;

/** The default `BIND-KEYS` map (Interfaces `BIND-KEYS`, Accessibility `A11Y-GRID`). */
export const DEFAULT_KEY_MAP: KeyMap = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'rowStart',
  End: 'rowEnd',
  'Ctrl+Home': 'gridStart',
  'Ctrl+End': 'gridEnd',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
  Tab: 'nextCell',
  'Shift+Tab': 'prevCell',
  Escape: 'collapse',
};

/** Merge a partial remap over the defaults (immutable copy). */
export function resolveKeyMap(overrides?: Partial<KeyMap>): KeyMap {
  const map: KeyMap = { ...DEFAULT_KEY_MAP };
  if (overrides) {
    for (const [token, action] of Object.entries(overrides)) {
      if (action) map[token] = action;
    }
  }
  return map;
}

/** A resolved binding: the action + whether it extends the selection range. */
export interface ResolvedKey {
  action: NavAction;
  extend: boolean;
}

/** Minimal structural view of the `KeyboardEvent` fields `resolveKey` reads. */
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Resolve a keyboard event against a `KeyMap`. Tab/Shift+Tab are distinct tokens
 * (Shift changes the *action*, not extend); for all other movements Shift is the
 * range-extend modifier. Returns `null` for an unbound key (event not consumed).
 */
export function resolveKey(e: KeyLike, map: KeyMap = DEFAULT_KEY_MAP): ResolvedKey | null {
  const ctrl = e.ctrlKey === true || e.metaKey === true;
  const shift = e.shiftKey === true;
  if (e.key === 'Tab') {
    const action = shift ? map['Shift+Tab'] : map['Tab'];
    return action ? { action, extend: false } : null;
  }
  const token = (ctrl ? 'Ctrl+' : '') + e.key;
  const action = map[token];
  if (!action) return null;
  return { action, extend: shift && action !== 'collapse' };
}

/** Logical extents for clamping a move (post-filter counts + a page size). */
export interface Extents {
  rowCount: number;
  colCount: number;
  /** Rows advanced by PageUp/PageDown (≈ one viewport of rows). */
  pageRows: number;
}

/**
 * Pure navigation: apply `action` to `pos`, clamped to `[0, count)` on each axis.
 * Tab/Shift+Tab wrap across row boundaries; grid-start/end jump to the corners.
 */
export function computeMove(pos: CellPos, action: NavAction, ext: Extents): CellPos {
  const clampRow = (r: number): number => Math.max(0, Math.min(r, ext.rowCount - 1));
  const clampCol = (c: number): number => Math.max(0, Math.min(c, ext.colCount - 1));
  const page = Math.max(1, ext.pageRows);
  switch (action) {
    case 'up':
      return { row: clampRow(pos.row - 1), col: pos.col };
    case 'down':
      return { row: clampRow(pos.row + 1), col: pos.col };
    case 'left':
      return { row: pos.row, col: clampCol(pos.col - 1) };
    case 'right':
      return { row: pos.row, col: clampCol(pos.col + 1) };
    case 'rowStart':
      return { row: pos.row, col: 0 };
    case 'rowEnd':
      return { row: pos.row, col: clampCol(ext.colCount - 1) };
    case 'gridStart':
      return { row: 0, col: 0 };
    case 'gridEnd':
      return { row: clampRow(ext.rowCount - 1), col: clampCol(ext.colCount - 1) };
    case 'pageUp':
      return { row: clampRow(pos.row - page), col: pos.col };
    case 'pageDown':
      return { row: clampRow(pos.row + page), col: pos.col };
    case 'nextCell': {
      let col = pos.col + 1;
      let row = pos.row;
      if (col >= ext.colCount) {
        col = 0;
        row = clampRow(pos.row + 1);
      }
      return { row, col: clampCol(col) };
    }
    case 'prevCell': {
      let col = pos.col - 1;
      let row = pos.row;
      if (col < 0) {
        col = ext.colCount - 1;
        row = clampRow(pos.row - 1);
      }
      return { row, col: clampCol(col) };
    }
    case 'collapse':
      return { row: pos.row, col: pos.col };
  }
}

/** Index-space cursor `{ row, col }` (0-based). */
export interface CellPos {
  row: number;
  col: number;
}
