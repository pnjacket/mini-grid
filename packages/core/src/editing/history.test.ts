import { describe, expect, it } from 'vitest';

import { History } from './history.js';
import type { Command } from './history.js';

/** A tiny reversible command over a shared cell for INV-HISTORY-LINEAR tests. */
function editCmd(cell: { v: number }, from: number, to: number): Command {
  return {
    kind: 'edit',
    targetThread: 'worker',
    apply: () => {
      cell.v = to;
    },
    revert: () => {
      cell.v = from;
    },
  };
}

describe('COMPONENT-HISTORY — INV-HISTORY-LINEAR', () => {
  it('undo reverts and redo re-applies the last command', async () => {
    const cell = { v: 0 };
    const h = new History();
    cell.v = 1;
    h.push(editCmd(cell, 0, 1));

    await h.undo();
    expect(cell.v).toBe(0);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);

    await h.redo();
    expect(cell.v).toBe(1);
    expect(h.canRedo()).toBe(false);
  });

  it('a new command after an undo clears the redo stack', async () => {
    const cell = { v: 0 };
    const h = new History();
    cell.v = 1;
    h.push(editCmd(cell, 0, 1));
    cell.v = 2;
    h.push(editCmd(cell, 1, 2));

    await h.undo(); // back to 1, redo has the 1→2 command
    expect(cell.v).toBe(1);
    expect(h.redoDepth).toBe(1);

    // A fresh command must make the undone future unreachable.
    cell.v = 9;
    h.push(editCmd(cell, 1, 9));
    expect(h.redoDepth).toBe(0);
    expect(h.canRedo()).toBe(false);

    await h.redo(); // no-op (redo cleared)
    expect(cell.v).toBe(9);
  });

  it('maxDepth bounds the undo stack, dropping the oldest command', async () => {
    const cell = { v: 0 };
    const h = new History(2); // keep at most 2
    h.push(editCmd(cell, 0, 1));
    h.push(editCmd(cell, 1, 2));
    h.push(editCmd(cell, 2, 3)); // drops the oldest (0→1)
    expect(h.undoDepth).toBe(2);

    cell.v = 3;
    await h.undo(); // 3→2
    await h.undo(); // 2→1
    expect(cell.v).toBe(1);
    expect(h.canUndo()).toBe(false); // the 0→1 command was dropped
  });

  it('clear empties both stacks (rebind reset)', () => {
    const cell = { v: 0 };
    const h = new History();
    h.push(editCmd(cell, 0, 1));
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
