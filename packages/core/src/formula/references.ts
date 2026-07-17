/**
 * `CAP-FORMULA-REF` — A1-notation cell references. A column letter maps to a
 * **0-based canonical column index** (`A`→0, `Z`→25, `AA`→26, bijective base-26);
 * a row number maps to a **0-based canonical row index** (`A1`→row 0). Absolute
 * markers (`$`) are recorded (honoured by structural-edit translation; drag-fill/
 * copy-paste relative translation is [FUTURE-SCOPE] — a filled formula is verbatim).
 */

/** A single A1 cell reference in resolved (0-based) grid coordinates. */
export interface CellRefA1 {
  col: number;
  row: number;
  colAbs: boolean;
  rowAbs: boolean;
}

/** A rectangular A1 range (order-normalized at expansion time). */
export interface RangeRefA1 {
  start: CellRefA1;
  end: CellRefA1;
}

const A1_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

/** `"A"→0`, `"Z"→25`, `"AA"→26`. Returns -1 for an invalid column string. */
export function colLettersToIndex(letters: string): number {
  let n = 0;
  const up = letters.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const c = up.charCodeAt(i);
    if (c < 65 || c > 90) return -1;
    n = n * 26 + (c - 64); // A=1 in the accumulator
  }
  return n - 1; // shift to 0-based
}

/** `0→"A"`, `25→"Z"`, `26→"AA"`. */
export function indexToColLetters(index: number): string {
  if (index < 0) return '';
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Parse an A1 token (e.g. `A1`, `$A$1`, `B$12`) into a resolved `CellRefA1`.
 * Returns `null` when the text is not a well-formed A1 reference.
 */
export function parseA1(token: string): CellRefA1 | null {
  const m = A1_RE.exec(token);
  if (!m) return null;
  const col = colLettersToIndex(m[2] as string);
  if (col < 0 || col > 16383) return null; // Excel column ceiling
  const rowNum = Number(m[4]);
  if (!Number.isInteger(rowNum) || rowNum < 1) return null;
  return {
    col,
    row: rowNum - 1,
    colAbs: m[1] === '$',
    rowAbs: m[3] === '$',
  };
}

/** `true` when a bare token has A1 shape (used to classify a NAME token in the parser). */
export function looksLikeA1(token: string): boolean {
  return A1_RE.test(token);
}

/** Render a resolved reference back to A1 text (used by fill/copy translation). */
export function refToA1(ref: CellRefA1): string {
  return `${ref.colAbs ? '$' : ''}${indexToColLetters(ref.col)}${ref.rowAbs ? '$' : ''}${ref.row + 1}`;
}

/**
 * Translate a reference by (dCol, dRow) for fill/copy — absolute axes are pinned,
 * relative axes shift. A shift below the grid origin marks the ref out-of-grid
 * (caller renders `#REF!`).
 */
export function translateRef(ref: CellRefA1, dCol: number, dRow: number): CellRefA1 | null {
  const col = ref.colAbs ? ref.col : ref.col + dCol;
  const row = ref.rowAbs ? ref.row : ref.row + dRow;
  if (col < 0 || row < 0) return null;
  return { col, row, colAbs: ref.colAbs, rowAbs: ref.rowAbs };
}

/** Serialize an A1 cell reference back to text (`$A$1`), honouring absolute markers. */
export function formatA1(ref: CellRefA1): string {
  return `${ref.colAbs ? '$' : ''}${indexToColLetters(ref.col)}${ref.rowAbs ? '$' : ''}${ref.row + 1}`;
}
