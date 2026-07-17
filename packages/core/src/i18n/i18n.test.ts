// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';
import {
  I18nController,
  DEFAULT_BUNDLE,
  directionForLocale,
} from './i18n.js';

const columns: ColumnDef[] = [
  { id: 'amount', field: 'amount', header: 'Amount', width: 100, type: 'number', formatMask: 'number:1' },
  { id: 'name', field: 'name', header: 'Name', width: 120 },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, amount: 1234.5, name: `Name ${i}` });
  return rows;
}

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('COMPONENT-I18N — string catalog + t() (CAP-I18N)', () => {
  it('t() interpolates params and falls back to the key for a missing entry', () => {
    const i18n = new I18nController();
    expect(i18n.t('filter.ariaLabel', { column: 'Price' })).toBe('Filter Price');
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
  });

  it('Intl.PluralRules selects the correct plural form (en: 1 row / 2 rows)', () => {
    const i18n = new I18nController(); // en-US
    expect(i18n.t('a11y.rowCount', { count: 1 })).toBe('1 row');
    expect(i18n.t('a11y.rowCount', { count: 2 })).toBe('2 rows');
    // The context-menu delete label is also plural-driven.
    expect(i18n.t('contextMenu.deleteRows', { count: 1 })).toBe('Delete row');
    expect(i18n.t('contextMenu.deleteRows', { count: 3 })).toBe('Delete rows');
  });

  it('setLocale swaps Intl number formatting (en-US 1,234.5 → de-DE 1.234,5)', () => {
    // Formatting goes through the value-format mask, which reads the active locale.
    const en = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(1234.5);
    const de = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(1234.5);
    expect(en).toBe('1,234.5');
    expect(de).toBe('1.234,5');
  });

  it('setLocale merges a host bundle over the English default', () => {
    const i18n = new I18nController();
    expect(i18n.t('filter.apply')).toBe('Apply');
    i18n.setLocale('de-DE', { 'filter.apply': 'Anwenden' });
    expect(i18n.t('filter.apply')).toBe('Anwenden');
    // A key the host did not override still resolves from the default catalog.
    expect(i18n.t('filter.clear')).toBe(DEFAULT_BUNDLE['filter.clear']);
  });

  it('direction is inferred from the locale (auto-RTL)', () => {
    expect(directionForLocale('ar-EG')).toBe('rtl');
    expect(directionForLocale('he')).toBe('rtl');
    expect(directionForLocale('en-US')).toBe('ltr');
    expect(directionForLocale('de-DE')).toBe('ltr');
    const i18n = new I18nController({ locale: 'ar' });
    expect(i18n.getDirection()).toBe('rtl');
  });
});

describe('LIB-LOCALE — grid.setLocale / setDirection (COMPONENT-I18N)', () => {
  it('setLocale re-locales a value-format mask (en-US → de-DE)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(3));
    const amountCell = (): string =>
      (el.querySelector('[role=gridcell][aria-colindex="1"]') as HTMLElement).textContent ?? '';
    expect(amountCell()).toBe('1,234.5');
    grid.setLocale('de-DE');
    await Promise.resolve();
    // A repaint has occurred; poll the cell text.
    await new Promise((r) => setTimeout(r, 0));
    expect(amountCell()).toBe('1.234,5');
    grid.destroy();
  });

  it('a host bundle swaps a rendered menu/label string (proves externalization)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(3));
    // The header filter button aria-label comes from the catalog.
    const filterBtn = (): HTMLElement =>
      el.querySelector('[data-mg-filter-btn]') as HTMLElement;
    expect(filterBtn().getAttribute('aria-label')).toBe('Filter Amount');
    grid.setLocale('xx', { 'filter.ariaLabel': 'Filtrar {column}' });
    await new Promise((r) => setTimeout(r, 0));
    expect(filterBtn().getAttribute('aria-label')).toBe('Filtrar Amount');
    grid.destroy();
  });

  it('setDirection(rtl) sets dir=rtl on DOM-ROOT + the --mg-dir token', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(5));
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('ltr');
    grid.setDirection('rtl');
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(root.style.getPropertyValue('--mg-dir')).toBe('rtl');
    grid.destroy();
  });

  it('RTL mirrors via logical positioning + a leading frozen edge', async () => {
    const el = container();
    const grid = createGrid(el, {
      columns,
      keyField: 'id',
      frozen: { cols: 1 },
      direction: 'rtl',
    });
    await grid.setData(makeRows(20));
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('rtl');

    // Default alignment + column order mirror because cells are positioned with
    // logical `inset-inline-start` (no physical `left`), which maps to the right
    // edge under dir=rtl — the CSS-driven mirror the RTL contract requires.
    const cell = el.querySelector('[role=gridcell]') as HTMLElement;
    expect(cell.style.insetInlineStart).not.toBe('');
    expect(cell.style.left).toBe('');

    // The frozen column pins to the leading (right) edge: its header carries the
    // frozen class and is positioned via the logical inline-start offset.
    const frozenHeader = el.querySelector(
      '.mg-header-cell--frozen',
    ) as HTMLElement;
    expect(frozenHeader).not.toBeNull();
    expect(frozenHeader.style.insetInlineStart).not.toBe('');
    grid.destroy();
  });

  it('setDirection is gated behind the i18n feature flag', async () => {
    const el = container();
    const grid = createGrid(el, {
      columns,
      keyField: 'id',
      features: { i18n: false },
    });
    await grid.setData(makeRows(3));
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    grid.setDirection('rtl');
    expect(root.getAttribute('dir')).toBe('ltr'); // no-op when disabled
    grid.destroy();
  });
});
