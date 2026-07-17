# Editing & validation

> Typechecked source: [`docs/examples/editing-and-validation.ts`](../examples/editing-and-validation.ts).

## Enabling editing

Mark a column `editable`. The editor is chosen from `type` unless you override it
with `editor`:

| `type` | Default editor |
| --- | --- |
| `text` | text input |
| `number` | numeric input |
| `date` | date input |
| `boolean` | checkbox |
| `select` | dropdown (requires `editor: { kind: 'select', options }`) |

A user opens an editor by typing (type-to-replace), pressing Enter/F2, or
double-clicking; Enter commits and Escape cancels. Programmatic edits go through the
same commit path:

```ts
await grid.updateCell(1, 'name', 'Grace'); // resolves the EditResult; fires afterEdit
```

## Declarative validation

Attach rules to a column; they run on commit. Built-in kinds: `required`, `type`,
`min`, `max`, `range`, `regex`, `oneOf`, and an escape-hatch `custom`.

```ts
import type { ColumnDef } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'name', field: 'name', header: 'Name', type: 'text', editable: true,
    validation: [{ kind: 'required', message: 'Name is required' }] },
  { id: 'score', field: 'score', header: 'Score', type: 'number', editable: true,
    validation: [
      { kind: 'range', min: 0, max: 100, message: 'Score must be 0–100' },
      { kind: 'custom', validate: (value) => (Number(value) % 2 === 0 ? true : { message: 'Must be even' }) },
    ] },
];
```

An invalid commit is rejected: the editor stays open with `aria-invalid` and an
inline tip, `updateCell` rejects with `GridError{VALIDATION_FAILED}`, and a
`validationError` event fires.

```ts
grid.on('validationError', ({ error }) => console.warn('invalid:', error.message));
```

## Custom editors

Implement the `CellEditor` contract (`mount → getValue → destroy`) and register it
as `editor: { kind: 'custom', create }`:

```ts
import type { CellEditor, EditorContext } from '@mini-grid/core';

function upperEditor(): CellEditor {
  let input: HTMLInputElement | undefined;
  return {
    mount(_cell, ctx: EditorContext) {
      input = ctx.document.createElement('input');
      input.value = ctx.initialText ?? String(ctx.initialValue ?? '');
      ctx.container.appendChild(input);
      input.focus();
    },
    getValue() { return (input?.value ?? '').toUpperCase(); },
    destroy() { input?.remove(); input = undefined; },
  };
}
```

## Undo / redo

Edits, CRUD, sort, resize, reorder, freeze, merge, group, styling, and paste/fill
are undoable commands. Bound the history with `historyMaxDepth`.

```ts
await grid.undo();
await grid.redo();
```
