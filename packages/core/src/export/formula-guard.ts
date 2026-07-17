/**
 * `SEC-EXPORT-FORMULA-GUARD` — CSV/xlsx formula-injection neutralization.
 *
 * A spreadsheet application (Excel, Sheets, LibreOffice) treats a cell whose
 * text begins with `=`, `+`, `-`, `@` (or a leading TAB / carriage-return) as a
 * **formula**. If untrusted grid content is exported verbatim, opening the file
 * can execute an attacker-controlled formula (data exfiltration, command
 * injection via `=HYPERLINK`/`=cmd|…`). The guard **neutralizes** such values by
 * prefixing a single quote (`'`), which forces the cell to be interpreted as
 * literal text.
 *
 * **On by default**; the export caller can opt out with `exportOpts.sanitizeFormulas =
 * false` (developers with known-safe intentional `=`-leading text).
 *
 * The guard applies to **string** cell values only — typed numbers/dates/booleans
 * are never formula-injectable and are left untouched (so `-5` stays the number
 * `-5`, not the text `'-5`).
 */

/** Leading characters a spreadsheet may interpret as the start of a formula. */
const TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Does `value` begin with a formula-trigger character? */
export function needsFormulaGuard(value: string): boolean {
  return value.length > 0 && TRIGGER_CHARS.has(value[0] as string);
}

/**
 * Neutralize one cell value. When `sanitize` is on and `value` is a string that
 * begins with a trigger char, prefix a `'`; otherwise return it unchanged.
 * Non-string values pass through (typed numbers/dates/booleans are safe).
 */
export function guardFormula(value: unknown, sanitize: boolean): unknown {
  if (!sanitize || typeof value !== 'string') return value;
  return needsFormulaGuard(value) ? `'${value}` : value;
}
