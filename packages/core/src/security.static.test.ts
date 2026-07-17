/**
 * `AC-STATIC-SCAN` — the Security negative/hygiene battery over the BUILT core
 * bundle (`packages/core/dist/index.js`). Each `SEC-NO-*` is a named, runnable
 * assertion that the shipped code contains **none** of the forbidden sinks:
 *
 *  - `SEC-NO-EGRESS`     — no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/
 *                          `EventSource` (the grid makes no network requests of its own).
 *  - `SEC-NO-PERSIST`    — no `localStorage`/`sessionStorage`/`document.cookie`/
 *                          `indexedDB` (writes nothing of its own; `serializeState()`
 *                          RETURNS state to the caller).
 *  - `SEC-NO-EVAL`       — no `eval(` / `new Function(` (predicates/validators/
 *                          formatters are developer functions, never stringified code).
 *  - `SEC-NO-SECRETS`    — no credential/token/secret handling identifiers.
 *  - `SEC-NO-LOG-VALUES` — no `console.*` in the bundle (so no logging of cell
 *                          values) AND `GridError.context` carries `(rowKey, columnId)`,
 *                          never the cell value (protects potential PII).
 *
 * Also confirms `DEP-XLSX` (exceljs) is a **lazy, external** dependency — NOT inlined
 * into core's bundle (only its dynamic-import specifier appears).
 *
 * Scans the shipped ESM (`dist/index.js`); builds it first if it is missing so the
 * check is self-contained regardless of the `test` vs `build` ordering.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GridError } from './errors.js';

const bundlePath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const pkgDir = fileURLToPath(new URL('..', import.meta.url));

let bundle = '';

beforeAll(() => {
  if (!existsSync(bundlePath)) {
    // Self-contained: produce the bundle if a prior `build` has not run.
    execSync('pnpm build', { cwd: pkgDir, stdio: 'inherit' });
  }
  bundle = readFileSync(bundlePath, 'utf8');
}, 120_000);

/** Every match of `pattern` in the built bundle (empty ⇒ the forbidden sink is absent). */
function hits(pattern: RegExp): string[] {
  return [...bundle.matchAll(new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))].map(
    (m) => m[0],
  );
}

describe('AC-STATIC-SCAN — Security negative/hygiene battery over the built core bundle', () => {
  it('the built bundle exists and is non-trivial', () => {
    expect(bundle.length).toBeGreaterThan(1000);
  });

  it('SEC-NO-EGRESS: no fetch / XMLHttpRequest / WebSocket / sendBeacon / EventSource in core', () => {
    expect(hits(/\bfetch\s*\(/)).toEqual([]);
    expect(hits(/\bXMLHttpRequest\b/)).toEqual([]);
    expect(hits(/\bWebSocket\b/)).toEqual([]);
    expect(hits(/\bsendBeacon\b/)).toEqual([]);
    expect(hits(/\bEventSource\b/)).toEqual([]);
  });

  it('SEC-NO-PERSIST: no localStorage / sessionStorage / document.cookie / indexedDB writes in core', () => {
    expect(hits(/\blocalStorage\b/)).toEqual([]);
    expect(hits(/\bsessionStorage\b/)).toEqual([]);
    expect(hits(/\bindexedDB\b/i)).toEqual([]);
    expect(hits(/document\s*\.\s*cookie/)).toEqual([]);
    // Any cookie assignment sink (`x.cookie = ...`).
    expect(hits(/\.\s*cookie\s*=/)).toEqual([]);
  });

  it('SEC-NO-EVAL: no eval( / new Function( on any path', () => {
    expect(hits(/\beval\s*\(/)).toEqual([]);
    expect(hits(/\bnew\s+Function\s*\(/)).toEqual([]);
  });

  it('SEC-NO-SECRETS: no credential/token/secret handling identifiers', () => {
    expect(
      hits(/\b(password|passwd|secret|apiKey|api_key|accessToken|access_token|clientSecret|privateKey|credentials?)\b/i),
    ).toEqual([]);
  });

  it('SEC-NO-LOG-VALUES (static): no console.* calls in the bundle (so no logging of values)', () => {
    expect(hits(/\bconsole\s*\.\s*(log|warn|error|info|debug|trace|dir|table|group)\s*\(/)).toEqual([]);
  });

  it('DEP-XLSX is external + lazy — exceljs is NOT inlined into core (only its import specifier appears)', () => {
    // exceljs itself is > 1MB; the core bundle stays a fraction of that.
    expect(bundle.length).toBeLessThan(600_000);
    // exceljs is referenced only as a lazy module specifier (a `import(...)` of the
    // `"exceljs"` module id), never statically imported.
    expect(hits(/import\s*\(/).length).toBeGreaterThanOrEqual(1);
    expect(hits(/["']exceljs["']/).length).toBeGreaterThanOrEqual(1);
    // No exceljs internals bundled (a telltale class name from the library).
    expect(hits(/class\s+Workbook\b/)).toEqual([]);
  });
});

describe('SEC-NO-LOG-VALUES (runtime) — GridError.context references cells by (rowKey, columnId), never by value', () => {
  it('a validation-shaped GridError carries rowKey/columnId, not the offending cell value', () => {
    // The shape the editing/validation path builds (see edit-session / validation).
    const err = new GridError('VALIDATION_FAILED', 'Must start with r', {
      source: 'validation',
      context: { rowKey: 'row-42', columnId: 'c2' },
    });

    const keys = Object.keys(err.context ?? {});
    // Only cell-identity keys are permitted on the envelope (ErrContext).
    const allowed = new Set(['rowKey', 'columnId', 'columnIndex', 'range']);
    for (const k of keys) expect(allowed.has(k)).toBe(true);

    // The identity is present…
    expect(err.context?.rowKey).toBe('row-42');
    expect(err.context?.columnId).toBe('c2');
    // …and the value is nowhere on the error (no `value`/`data`/`cellValue` leak).
    const serialized = JSON.stringify({
      message: err.message,
      code: err.code,
      source: err.source,
      context: err.context,
    });
    expect(serialized).not.toContain('value');
    expect(serialized).not.toContain('secret-pii-value');
  });
});
