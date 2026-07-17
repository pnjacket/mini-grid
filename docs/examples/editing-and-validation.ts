/**
 * Editing & validation — built-in editors, declarative validators, a custom
 * editor + custom validator, and undo/redo. Referenced by
 * `docs/guide/editing-and-validation.md`.
 */
import { createGrid } from '@mini-grid/core';
import type { CellEditor, ColumnDef, EditorContext, Grid } from '@mini-grid/core';

/** A trivial custom editor: an uppercase-forcing text input (LIB-EDITOR-API). */
function upperEditor(): CellEditor {
  let input: HTMLInputElement | undefined;
  return {
    mount(_cell, ctx: EditorContext) {
      input = ctx.document.createElement('input');
      input.value = ctx.initialText ?? String(ctx.initialValue ?? '');
      ctx.container.appendChild(input);
      input.focus();
    },
    getValue() {
      return (input?.value ?? '').toUpperCase();
    },
    destroy() {
      input?.remove();
      input = undefined;
    },
  };
}

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number' },
  {
    id: 'name',
    field: 'name',
    header: 'Name',
    type: 'text',
    editable: true,
    validation: [{ kind: 'required', message: 'Name is required' }],
  },
  {
    id: 'score',
    field: 'score',
    header: 'Score',
    type: 'number',
    editable: true,
    validation: [
      { kind: 'range', min: 0, max: 100, message: 'Score must be 0–100' },
      { kind: 'custom', validate: (value) => (Number(value) % 2 === 0 ? true : { message: 'Must be even' }) },
    ],
  },
  { id: 'code', field: 'code', header: 'Code', type: 'text', editable: true, editor: { kind: 'custom', create: upperEditor } },
];

export async function build(host: HTMLElement): Promise<Grid> {
  const grid = createGrid(host, { columns, keyField: 'id', historyMaxDepth: 100 });
  await grid.setData([{ id: 1, name: 'Ada', score: 42, code: 'ab' }]);

  grid.on('validationError', ({ error }) => console.warn('invalid:', error.message));
  grid.on('afterEdit', ({ cell, newValue }) => console.log(cell.columnId, '→', newValue));

  // Programmatic edit (same commit path as the interactive editor).
  await grid.updateCell(1, 'name', 'Grace');

  // Undo / redo.
  await grid.undo();
  await grid.redo();

  return grid;
}
