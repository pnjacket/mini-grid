import { describe, expect, it } from 'vitest';

import { formatValue } from './format-mask.js';
import type { CellContext } from '../types.js';

const ctx: CellContext = {
  rowKey: 'r1',
  columnId: 'c',
  field: 'c',
  value: 0,
  data: {},
  rowIndex: 0,
  colIndex: 0,
};

describe('CAP-FMT-VALUE — value-format masks (LIB-FORMATTER-API)', () => {
  it('no mask → raw String(value); null/undefined → empty string', () => {
    expect(formatValue(42, undefined, ctx)).toBe('42');
    expect(formatValue('hi', undefined, ctx)).toBe('hi');
    expect(formatValue(null, undefined, ctx)).toBe('');
    expect(formatValue(undefined, 'number', ctx)).toBe('');
  });

  it('number mask formats with grouping + fixed fraction digits', () => {
    expect(formatValue(1234567, 'number', ctx)).toBe('1,234,567');
    expect(formatValue(3.14159, 'number:2', ctx)).toBe('3.14');
    expect(formatValue('2500', 'number:0', ctx)).toBe('2,500');
  });

  it('currency mask formats with the currency symbol', () => {
    expect(formatValue(9.99, 'currency:USD', ctx)).toBe('$9.99');
    expect(formatValue(1000, 'currency:USD:0', ctx)).toBe('$1,000');
  });

  it('percent mask scales by 100 and appends %', () => {
    expect(formatValue(0.5, 'percent', ctx)).toBe('50%');
    expect(formatValue(0.1234, 'percent:1', ctx)).toBe('12.3%');
  });

  it('date mask formats a Date / epoch / ISO string', () => {
    const d = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    // Default numeric mask (MM/DD/YYYY under en-US). Assert the parts appear.
    const out = formatValue(d, 'date', ctx);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/01/);
    expect(out).toMatch(/15/);
    // A styled date (medium) also renders the year.
    expect(formatValue('2026-01-15', 'date:medium', ctx)).toMatch(/2026/);
  });

  it('a custom FormatterFn is called with (value, ctx)', () => {
    const fn = (v: unknown, c: CellContext): string => `${c.columnId}=${String(v)}`;
    expect(formatValue(7, fn, ctx)).toBe('c=7');
  });

  it('a non-numeric value under a numeric mask falls back to String(value)', () => {
    expect(formatValue('n/a', 'number', ctx)).toBe('n/a');
    expect(formatValue('bad-date', 'date', ctx)).toBe('bad-date');
  });

  // P1 (PERF-CELL-PATH): formatters are memoized by (locale, mask). Guard that the
  // cache is keyed correctly — no cross-contamination across masks or locales, and
  // repeated calls (the per-cell case) stay identical.
  it('memoized formatters do not cross-contaminate across masks or locales', () => {
    // Interleave distinct masks — each must keep its own compiled formatter.
    expect(formatValue(9.99, 'currency:USD', ctx)).toBe('$9.99');
    expect(formatValue(0.5, 'percent', ctx)).toBe('50%');
    expect(formatValue(1234567, 'number', ctx)).toBe('1,234,567');
    expect(formatValue(9.99, 'currency:USD', ctx)).toBe('$9.99'); // repeat → same
    // Same mask, different locale → distinct cache entries with locale-correct output.
    expect(formatValue(1234.5, 'currency:USD', ctx, 'en-US')).toBe('$1,234.50');
    expect(formatValue(1234.5, 'currency:EUR', ctx, 'de-DE')).toBe('1.234,50 €');
    expect(formatValue(1234.5, 'currency:USD', ctx, 'en-US')).toBe('$1,234.50'); // still correct
  });

  it('repeated calls with the same mask are stable (per-cell invariance)', () => {
    const first = formatValue(0.1234, 'percent:1', ctx);
    for (let i = 0; i < 5; i++) expect(formatValue(0.1234, 'percent:1', ctx)).toBe(first);
    expect(first).toBe('12.3%');
  });
});
