// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { resolveEditorFactory } from './editors.js';
import type { CellEditor, EditorContext } from './editors.js';
import type { ColumnDef } from '../api/options.js';
import type { CellRef } from '../types.js';

const cell: CellRef = { rowKey: 1, columnId: 'c' };

function mountEditor(
  column: ColumnDef,
  initialValue: unknown,
  initialText?: string,
): { getValue: () => unknown; destroy: () => void; container: HTMLElement } {
  const cellNode = document.createElement('div');
  cellNode.setAttribute('role', 'gridcell');
  document.body.appendChild(cellNode);
  const container = document.createElement('div');
  cellNode.appendChild(container);
  const editor = resolveEditorFactory(column)();
  const ctx: EditorContext = {
    container,
    document,
    column,
    initialValue,
    initialText,
    ariaLabel: column.header ?? column.id,
    cellNode,
    overlayContainer: document.body,
    requestCommit: () => {},
    requestCancel: () => {},
  };
  editor.mount(cell, ctx);
  return { getValue: () => editor.getValue(), destroy: () => editor.destroy(), container };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('LIB-EDITOR-API — built-in editors getValue', () => {
  it('text editor returns the input string', () => {
    const { getValue, container } = mountEditor(
      { id: 'c', field: 'c', type: 'text' },
      'hello',
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('hello'); // seeded from initialValue
    input.value = 'world';
    expect(getValue()).toBe('world');
  });

  it('type-to-replace seeds the editor with the typed character', () => {
    const { container } = mountEditor({ id: 'c', field: 'c', type: 'text' }, 'hello', 'Z');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Z');
  });

  it('number editor parses to a number (empty → null)', () => {
    const { getValue, container } = mountEditor(
      { id: 'c', field: 'c', type: 'number' },
      5,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    input.value = '42';
    expect(getValue()).toBe(42);
    input.value = '';
    expect(getValue()).toBeNull();
  });

  it('date editor parses to a Date (empty → null)', () => {
    const { getValue, container } = mountEditor(
      { id: 'c', field: 'c', type: 'date' },
      null,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    input.value = '2020-01-02';
    const v = getValue();
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).getUTCFullYear()).toBe(2020);
  });

  it('boolean editor is a checkbox and returns its checked state', () => {
    const { getValue, container } = mountEditor(
      { id: 'c', field: 'c', type: 'boolean' },
      true,
    );
    const box = container.querySelector('input') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
    expect(getValue()).toBe(true);
    box.checked = false;
    expect(getValue()).toBe(false);
  });

  it('destroy removes the control from the DOM', () => {
    const { destroy, container } = mountEditor({ id: 'c', field: 'c', type: 'text' }, 'x');
    expect(container.querySelector('input')).not.toBeNull();
    destroy();
    expect(container.querySelector('input')).toBeNull();
  });

  it('boolean editor declares immediateCommit (CE-BOOL-COMMIT)', () => {
    const editor = resolveEditorFactory({ id: 'c', field: 'c', type: 'boolean' })();
    expect(editor.immediateCommit).toBe(true);
  });
});

describe('CE-SELECT-POPOVER — the select editor renders an overlay listbox', () => {
  const selectColumn: ColumnDef = {
    id: 'c',
    field: 'c',
    type: 'select',
    header: 'Choice',
    editor: {
      kind: 'select',
      options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }, { value: 'c', label: 'Cherry' }],
    },
  };

  function mountSelect(initialValue: unknown): {
    editor: CellEditor;
    cellNode: HTMLElement;
    popover: HTMLElement;
    counts: { commits: number; cancels: number };
  } {
    const cellNode = document.createElement('div');
    cellNode.setAttribute('role', 'gridcell');
    document.body.appendChild(cellNode);
    const container = document.createElement('div');
    cellNode.appendChild(container);
    const counts = { commits: 0, cancels: 0 };
    const editor = resolveEditorFactory(selectColumn)();
    const ctx: EditorContext = {
      container,
      document,
      column: selectColumn,
      initialValue,
      ariaLabel: selectColumn.header ?? selectColumn.id,
      cellNode,
      overlayContainer: document.body,
      requestCommit: () => {
        counts.commits++;
      },
      requestCancel: () => {
        counts.cancels++;
      },
    };
    editor.mount({ rowKey: 1, columnId: 'c' }, ctx);
    const popover = document.querySelector('[data-mg-select-popover]') as HTMLElement;
    return { editor, cellNode, popover, counts };
  }

  const press = (el: HTMLElement, key: string): void =>
    void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('mounts a role=listbox OUTSIDE the cell (escapes the cell clip)', () => {
    const { popover, cellNode, editor } = mountSelect('a');
    expect(popover).not.toBeNull();
    expect(popover.getAttribute('role')).toBe('listbox');
    // The listbox is portaled to the overlay (body), NOT a descendant of the cell.
    expect(cellNode.contains(popover)).toBe(false);
    expect(popover.parentElement).toBe(document.body);
    expect(popover.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(editor.renderInPopover).toBe(true);
  });

  it('preselects the current value + Enter commits it', () => {
    const { editor, popover, counts } = mountSelect('b');
    expect(editor.getValue()).toBe('b'); // initialValue highlighted
    press(popover, 'Enter');
    expect(counts.commits).toBe(1);
    expect(editor.getValue()).toBe('b');
  });

  it('clicking an option commits the new value', () => {
    const { editor, popover, counts } = mountSelect('a');
    const cherry = popover.querySelectorAll('[role="option"]')[2] as HTMLElement;
    cherry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.getValue()).toBe('c');
    expect(counts.commits).toBe(1);
  });

  it('ArrowDown/ArrowUp move the highlight', () => {
    const { editor, popover } = mountSelect('a'); // index 0
    press(popover, 'ArrowDown');
    expect(editor.getValue()).toBe('b');
    press(popover, 'ArrowDown');
    expect(editor.getValue()).toBe('c');
    press(popover, 'ArrowUp');
    expect(editor.getValue()).toBe('b');
  });

  it('type-ahead jumps to the matching option', () => {
    const { editor, popover } = mountSelect('a');
    press(popover, 'c');
    expect(editor.getValue()).toBe('c'); // "Cherry"
  });

  it('Esc requests cancel (host restores focus)', () => {
    const { popover, counts } = mountSelect('a');
    press(popover, 'Escape');
    expect(counts.cancels).toBe(1);
  });

  it('destroy removes the popover from the overlay', () => {
    const { editor } = mountSelect('a');
    expect(document.querySelector('[data-mg-select-popover]')).not.toBeNull();
    editor.destroy();
    expect(document.querySelector('[data-mg-select-popover]')).toBeNull();
  });
});
