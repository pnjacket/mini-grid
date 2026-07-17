import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KEY_MAP,
  resolveKeyMap,
  resolveKey,
  computeMove,
} from './keymap.js';
import type { Extents } from './keymap.js';

const ext: Extents = { rowCount: 100, colCount: 5, pageRows: 10 };

describe('BIND-KEYS — resolveKey', () => {
  it('maps arrows to moves; Shift is the extend modifier', () => {
    expect(resolveKey({ key: 'ArrowDown' })).toEqual({ action: 'down', extend: false });
    expect(resolveKey({ key: 'ArrowDown', shiftKey: true })).toEqual({
      action: 'down',
      extend: true,
    });
    expect(resolveKey({ key: 'ArrowRight' })).toEqual({ action: 'right', extend: false });
  });

  it('Ctrl+Home/End jump to grid extents; Home/End are row ends', () => {
    expect(resolveKey({ key: 'Home' })).toEqual({ action: 'rowStart', extend: false });
    expect(resolveKey({ key: 'End' })).toEqual({ action: 'rowEnd', extend: false });
    expect(resolveKey({ key: 'Home', ctrlKey: true })).toEqual({
      action: 'gridStart',
      extend: false,
    });
    expect(resolveKey({ key: 'End', metaKey: true })).toEqual({
      action: 'gridEnd',
      extend: false,
    });
  });

  it('Tab/Shift+Tab pick distinct actions (Shift does not extend here)', () => {
    expect(resolveKey({ key: 'Tab' })).toEqual({ action: 'nextCell', extend: false });
    expect(resolveKey({ key: 'Tab', shiftKey: true })).toEqual({
      action: 'prevCell',
      extend: false,
    });
  });

  it('Escape collapses; unbound keys return null', () => {
    expect(resolveKey({ key: 'Escape' })).toEqual({ action: 'collapse', extend: false });
    expect(resolveKey({ key: 'a' })).toBeNull();
  });

  it('resolveKeyMap merges a partial remap over the defaults', () => {
    const map = resolveKeyMap({ ArrowDown: 'pageDown' });
    expect(map['ArrowDown']).toBe('pageDown');
    expect(map['ArrowUp']).toBe('up'); // untouched default
    expect(DEFAULT_KEY_MAP['ArrowDown']).toBe('down'); // defaults not mutated
  });
});

describe('BIND-KEYS — computeMove (clamped to extents)', () => {
  it('arrows move one cell and clamp at the edges', () => {
    expect(computeMove({ row: 5, col: 2 }, 'down', ext)).toEqual({ row: 6, col: 2 });
    expect(computeMove({ row: 5, col: 2 }, 'up', ext)).toEqual({ row: 4, col: 2 });
    expect(computeMove({ row: 0, col: 0 }, 'up', ext)).toEqual({ row: 0, col: 0 });
    expect(computeMove({ row: 0, col: 4 }, 'right', ext)).toEqual({ row: 0, col: 4 });
    expect(computeMove({ row: 99, col: 0 }, 'down', ext)).toEqual({ row: 99, col: 0 });
  });

  it('Home/End move to row ends; Ctrl+Home/End to grid corners', () => {
    expect(computeMove({ row: 7, col: 3 }, 'rowStart', ext)).toEqual({ row: 7, col: 0 });
    expect(computeMove({ row: 7, col: 3 }, 'rowEnd', ext)).toEqual({ row: 7, col: 4 });
    expect(computeMove({ row: 7, col: 3 }, 'gridStart', ext)).toEqual({ row: 0, col: 0 });
    expect(computeMove({ row: 7, col: 3 }, 'gridEnd', ext)).toEqual({ row: 99, col: 4 });
  });

  it('PageUp/PageDown advance by pageRows, clamped', () => {
    expect(computeMove({ row: 50, col: 1 }, 'pageDown', ext)).toEqual({ row: 60, col: 1 });
    expect(computeMove({ row: 5, col: 1 }, 'pageUp', ext)).toEqual({ row: 0, col: 1 });
    expect(computeMove({ row: 95, col: 1 }, 'pageDown', ext)).toEqual({ row: 99, col: 1 });
  });

  it('Tab wraps across row boundaries', () => {
    expect(computeMove({ row: 2, col: 4 }, 'nextCell', ext)).toEqual({ row: 3, col: 0 });
    expect(computeMove({ row: 3, col: 0 }, 'prevCell', ext)).toEqual({ row: 2, col: 4 });
    expect(computeMove({ row: 0, col: 0 }, 'prevCell', ext)).toEqual({ row: 0, col: 4 });
  });
});
