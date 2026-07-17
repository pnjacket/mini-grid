/**
 * `COMPONENT-HISTORY` — the undo/redo command stack (`ENTITY-HISTORY`).
 *
 * A `Command` (`ENTITY-HISTORY-ENTRY`) is a reversible unit of work with
 * `apply()` / `revert()` and a `targetThread` ('worker' for data ops, 'main' for
 * structural ops). Slice 4a ships the `edit` command; the structural/CRUD
 * commands of 4b implement the same interface and push onto the same stack.
 *
 * `INV-HISTORY-LINEAR` is enforced by construction:
 *  - a new `push` after an `undo` **clears the redo stack**;
 *  - `undo`/`redo` move a command across the two stacks, calling `revert`/`apply`;
 *  - `maxDepth` (default `null` = unlimited) bounds the undo stack, dropping the
 *    **oldest** command when exceeded.
 */

/** `ENTITY-HISTORY-ENTRY.kind` — the command taxonomy (4a uses `edit`). */
export type CommandKind =
  | 'edit'
  | 'paste'
  | 'insertRows'
  | 'removeRows'
  | 'insertCols'
  | 'removeCols'
  | 'merge'
  | 'unmerge'
  | 'freeze'
  | 'group'
  | 'ungroup'
  | 'resize'
  | 'reorder'
  | 'style'
  | 'conditionalRule'
  | 'sort';

/**
 * `ENTITY-HISTORY-ENTRY` (`Command`) — a reversible operation. `apply`/`revert`
 * may be async (data commands round-trip the worker via `MSG-APPLY-EDIT`).
 */
export interface Command {
  readonly kind: CommandKind;
  readonly targetThread: 'worker' | 'main';
  apply(): void | Promise<void>;
  revert(): void | Promise<void>;
}

/**
 * `ENTITY-HISTORY` — the two-stack command history. `maxDepth` defaults to `null`
 * (unlimited). Realizes `INV-HISTORY-LINEAR`.
 */
export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  constructor(private readonly maxDepth: number | null = null) {}

  /**
   * Record a freshly-applied command. Clears the redo stack (`INV-HISTORY-LINEAR`:
   * a new command after an undo makes the undone future unreachable) and enforces
   * `maxDepth` by dropping the oldest command.
   */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    if (this.maxDepth !== null && this.undoStack.length > this.maxDepth) {
      this.undoStack.splice(0, this.undoStack.length - this.maxDepth);
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Revert the most recent command and move it to the redo stack. No-op when empty. */
  async undo(): Promise<void> {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    await cmd.revert();
    this.redoStack.push(cmd);
  }

  /** Re-apply the most recently undone command and move it back. No-op when empty. */
  async redo(): Promise<void> {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    await cmd.apply();
    this.undoStack.push(cmd);
  }

  /** Drop all history (rebind reset — `AC-REBIND`). */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Depth of the undo stack (test hook for `maxDepth` bound). */
  get undoDepth(): number {
    return this.undoStack.length;
  }

  /** Depth of the redo stack (test hook for `INV-HISTORY-LINEAR`). */
  get redoDepth(): number {
    return this.redoStack.length;
  }
}
