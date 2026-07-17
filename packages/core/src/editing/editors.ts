/**
 * `LIB-EDITOR-API` — the `CellEditor` extension point + the five built-in editors
 * (`text`, `number`, `date`, `boolean` checkbox, `select` dropdown) and a
 * custom-editor registration path (`EditorSpec.kind:'custom'`).
 *
 * The grid calls a `CellEditor` in order: `mount` → (`getValue`/`validate`) →
 * `destroy` (Interfaces `LIB-EDITOR-API`). `mount` builds the concrete control
 * inside the `DOM-EDITOR` node (`data-mg-editor`) and moves focus into it
 * (`A11Y-EDITOR`, synchronous placement); `getValue` returns the typed draft;
 * `destroy` tears the control down.
 *
 * The default editor is chosen from `column.type`; `column.editor` (an
 * `EditorSpec`) overrides it.
 */
import type { CellRef, ColumnType } from '../types.js';
import type { ColumnDef } from '../api/options.js';
import type { ValidationError } from './validation.js';

/** Context passed to `CellEditor.mount` — the mount node + seed value + hooks. */
export interface EditorContext {
  /** The `DOM-EDITOR` node (`data-mg-editor`) the editor mounts into. */
  container: HTMLElement;
  document: Document;
  column: ColumnDef;
  /** The current cell value (edit seed). */
  initialValue: unknown;
  /** Type-to-replace seed text (a single printable char), when the trigger was typing. */
  initialText?: string | undefined;
  /** Accessible name for the control (= column header) (`A11Y-EDITOR`). */
  ariaLabel: string;
  /**
   * The origin `DOM-CELL` node (the edit trigger). A `renderInPopover` editor
   * positions its overlay against this cell and toggles its `aria-expanded`
   * (managed by the host); Esc restores focus here (`A11Y-EDITOR`).
   */
  cellNode: HTMLElement;
  /**
   * Portal target for a `renderInPopover` editor's overlay (`document.body` /
   * a grid-overlay layer) — the surface escapes the cell's clipped subtree
   * (like `LAYER-CONTEXT-MENU` / `LAYER-FILTER-MENU`).
   */
  overlayContainer: HTMLElement;
  /** Editor asks the host to commit (e.g. dropdown/checkbox change, Enter). */
  requestCommit(): void;
  /** Editor asks the host to cancel (Esc handled by the host). */
  requestCancel(): void;
}

/**
 * `interface CellEditor { mount; getValue; validate?; destroy }` — the developer-
 * (and built-in) editor contract (`LIB-EDITOR-API`).
 */
export interface CellEditor {
  mount(cell: CellRef, ctx: EditorContext): void;
  getValue(): unknown;
  validate?(): true | ValidationError;
  destroy(): void;
  /**
   * *(v1.1)* When `true`, the host commits the editor's value on the editor's
   * own `change` event (immediately), so the value is applied before any blur
   * can discard it. The built-in `boolean`/checkbox editor uses this
   * (`CE-BOOL-COMMIT`).
   */
  immediateCommit?: boolean;
  /**
   * *(v1.1)* When `true`, the editor renders its interactive surface in the
   * host-supplied `overlayContainer` (escaping the cell's overflow clip) rather
   * than inside the cell, and the host marks the origin cell `aria-expanded`.
   * The built-in `select` editor uses this (`CE-SELECT-POPOVER`).
   */
  renderInPopover?: boolean;
}

/** A zero-arg factory that produces a fresh `CellEditor` instance. */
export type EditorFactory = () => CellEditor;

/** Selectable option for the built-in `select` editor. */
export interface SelectOption {
  value: unknown;
  label?: string | undefined;
}

/** `ENTITY-COLUMN.editor` — overrides the type-default editor. */
export type EditorSpec =
  | { kind: 'text' }
  | { kind: 'number' }
  | { kind: 'date' }
  | { kind: 'boolean' }
  | { kind: 'select'; options: readonly SelectOption[] }
  | { kind: 'custom'; create: EditorFactory };

function seedInput(input: HTMLInputElement, ctx: EditorContext, fallback: string): void {
  if (ctx.initialText !== undefined) {
    input.value = ctx.initialText;
  } else {
    input.value = fallback;
  }
}

function focusEnd(input: HTMLInputElement): void {
  input.focus();
  const len = input.value.length;
  try {
    input.setSelectionRange(len, len);
  } catch {
    // Some input types (number/date) disallow setSelectionRange — ignore.
  }
}

/** Build a bare text-style `<input>` editor for the given HTML input `type`. */
function makeInputEditor(inputType: string, read: (v: string) => unknown): EditorFactory {
  return () => {
    let input: HTMLInputElement | undefined;
    return {
      mount(_cell: CellRef, ctx: EditorContext): void {
        const el = ctx.document.createElement('input');
        el.type = inputType;
        el.className = 'mg-editor-input';
        el.setAttribute('aria-label', ctx.ariaLabel);
        el.style.boxSizing = 'border-box';
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.border = '0';
        el.style.margin = '0';
        el.style.padding = 'var(--mg-cell-padding)';
        el.style.font = 'inherit';
        const fallback = ctx.initialValue == null ? '' : String(ctx.initialValue);
        ctx.container.appendChild(el);
        seedInput(el, ctx, fallback);
        input = el;
        focusEnd(el);
      },
      getValue(): unknown {
        return read(input?.value ?? '');
      },
      destroy(): void {
        input?.remove();
        input = undefined;
      },
    };
  };
}

const textEditor: EditorFactory = makeInputEditor('text', (v) => v);

const numberEditor: EditorFactory = makeInputEditor('text', (v) => {
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? trimmed : n;
});

const dateEditor: EditorFactory = makeInputEditor('text', (v) => {
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? trimmed : d;
});

const booleanEditor: EditorFactory = () => {
  let input: HTMLInputElement | undefined;
  return {
    // `CE-BOOL-COMMIT` — the toggled state is committed on the checkbox's own
    // `change` event (the host wires it), so a blur can't discard it first.
    immediateCommit: true,
    mount(_cell: CellRef, ctx: EditorContext): void {
      const el = ctx.document.createElement('input');
      el.type = 'checkbox';
      el.className = 'mg-editor-checkbox';
      el.setAttribute('aria-label', ctx.ariaLabel);
      el.checked = Boolean(ctx.initialValue);
      // A pointer-down on the checkbox must NOT bubble to the interaction layer,
      // whose "mousedown while editing → commit" would fire BEFORE the click
      // toggles `checked` and thus commit the STALE value (the demo bug). The
      // native toggle still happens (stopPropagation ≠ preventDefault); its
      // `change` then drives the immediate-commit above.
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      ctx.container.appendChild(el);
      input = el;
      el.focus();
    },
    getValue(): unknown {
      return input?.checked ?? false;
    },
    destroy(): void {
      input?.remove();
      input = undefined;
    },
  };
};

let popoverSeq = 0;

/**
 * `CE-SELECT-POPOVER` — the `select` dropdown editor. Its option list is a
 * `role="listbox"` **overlay popover** portaled into `ctx.overlayContainer`
 * (escaping the cell's overflow clip), NOT drawn inside the cell (where it was
 * clipped to the current value). Opens below the cell, **flips above** when the
 * room below is insufficient, and **scrolls internally** for long lists.
 *
 * Keyboard (`A11Y-EDITOR`): ↑/↓ (and Home/End) move the highlighted option,
 * type-ahead jumps to a label prefix, Enter/Tab selects + commits, Esc cancels;
 * the popover **dismisses** on select / Esc / outside pointer-down / grid scroll.
 * Roving focus tracks the highlighted `role="option"`; the listbox mirrors it via
 * `aria-activedescendant`. The host marks the origin cell `aria-expanded` and
 * restores focus to it on cancel/commit.
 */
function makeSelectEditor(options: readonly SelectOption[]): EditorFactory {
  return () => {
    const values = options.map((o) => o.value);
    const labels = options.map((o) => o.label ?? String(o.value));
    const seq = ++popoverSeq;

    let doc: Document | undefined;
    let popover: HTMLElement | undefined;
    let optionNodes: HTMLElement[] = [];
    let highlighted = 0;
    let ctxRef: EditorContext | undefined;
    let typeAhead = '';
    let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;
    let onDocPointerDown: ((e: Event) => void) | undefined;
    let onScroll: (() => void) | undefined;
    let scrollEl: Element | null = null;

    const setHighlight = (idx: number): void => {
      const clamped = Math.max(0, Math.min(idx, optionNodes.length - 1));
      highlighted = clamped;
      optionNodes.forEach((n, i) => {
        const on = i === clamped;
        n.setAttribute('aria-selected', on ? 'true' : 'false');
        n.tabIndex = on ? 0 : -1;
        n.classList.toggle('mg-select-option--active', on);
      });
      const node = optionNodes[clamped];
      if (node) {
        popover?.setAttribute('aria-activedescendant', node.id);
        node.focus();
        node.scrollIntoView?.({ block: 'nearest' });
      }
    };

    const position = (): void => {
      if (!popover || !ctxRef) return;
      const cell = ctxRef.cellNode;
      const rect = cell.getBoundingClientRect();
      const view = ctxRef.document.defaultView;
      const vh = view?.innerHeight ?? 768;
      popover.style.left = `${rect.left}px`;
      popover.style.minWidth = `${rect.width}px`;
      const below = vh - rect.bottom;
      const above = rect.top;
      const desired = popover.offsetHeight; // 0 in jsdom — harmless
      // Flip above only when there is not enough room below AND above is roomier.
      if (below < desired && above > below) {
        popover.style.maxHeight = `${Math.max(80, above - 8)}px`;
        popover.style.top = `${Math.max(0, rect.top - Math.min(desired, above - 8))}px`;
      } else {
        popover.style.maxHeight = `${Math.max(80, below - 8)}px`;
        popover.style.top = `${rect.bottom}px`;
      }
    };

    const jumpTypeAhead = (ch: string): void => {
      typeAhead += ch.toLowerCase();
      if (typeAheadTimer) clearTimeout(typeAheadTimer);
      typeAheadTimer = setTimeout(() => (typeAhead = ''), 600);
      const from = labels.findIndex((l, i) => i > highlighted && l.toLowerCase().startsWith(typeAhead));
      const idx =
        from >= 0 ? from : labels.findIndex((l) => l.toLowerCase().startsWith(typeAhead));
      if (idx >= 0) setHighlight(idx);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setHighlight(highlighted + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setHighlight(highlighted - 1);
          break;
        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          setHighlight(0);
          break;
        case 'End':
          e.preventDefault();
          e.stopPropagation();
          setHighlight(optionNodes.length - 1);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          e.stopPropagation();
          ctxRef?.requestCommit();
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          ctxRef?.requestCancel();
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            jumpTypeAhead(e.key);
          }
      }
    };

    return {
      // `CE-SELECT-POPOVER` — the option list mounts in the overlay layer.
      renderInPopover: true,
      mount(_cell: CellRef, ctx: EditorContext): void {
        ctxRef = ctx;
        doc = ctx.document;
        const pop = doc.createElement('div');
        pop.className = ctx.cellNode.closest('.mg-theme-dark')
          ? 'mg-select-popover mg-select-popover--dark'
          : 'mg-select-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', ctx.ariaLabel);
        pop.setAttribute('data-mg-select-popover', '');
        pop.tabIndex = -1;
        pop.style.position = 'fixed';
        pop.style.zIndex = '11';
        pop.style.overflowY = 'auto';

        optionNodes = options.map((_opt, i) => {
          const o = doc!.createElement('div');
          o.id = `mg-opt-${seq}-${i}`;
          o.className = 'mg-select-option';
          o.setAttribute('role', 'option');
          o.setAttribute('data-index', String(i));
          o.textContent = labels[i]!;
          o.tabIndex = -1;
          // Keep focus in the listbox (don't blur to the option on pointer-down).
          o.addEventListener('mousedown', (e) => e.preventDefault());
          o.addEventListener('click', () => {
            setHighlight(i);
            ctx.requestCommit();
          });
          pop.appendChild(o);
          return o;
        });

        pop.addEventListener('keydown', onKeyDown);
        ctx.overlayContainer.appendChild(pop);
        popover = pop;
        position();

        const initialIdx = values.findIndex((v) => v === ctx.initialValue);
        setHighlight(initialIdx >= 0 ? initialIdx : 0);

        // Light-dismiss: an outside pointer-down or a grid scroll cancels.
        onDocPointerDown = (e: Event): void => {
          const t = e.target;
          if (t instanceof Node && (pop.contains(t) || ctx.cellNode.contains(t))) return;
          ctx.requestCancel();
        };
        doc.addEventListener('mousedown', onDocPointerDown, true);
        doc.addEventListener('touchstart', onDocPointerDown, true);
        scrollEl = ctx.cellNode.closest('[data-mini-grid]')?.querySelector('.mg-scroll') ?? null;
        onScroll = (): void => ctx.requestCancel();
        scrollEl?.addEventListener('scroll', onScroll);
      },
      getValue(): unknown {
        return values[highlighted];
      },
      destroy(): void {
        if (typeAheadTimer) clearTimeout(typeAheadTimer);
        if (doc && onDocPointerDown) {
          doc.removeEventListener('mousedown', onDocPointerDown, true);
          doc.removeEventListener('touchstart', onDocPointerDown, true);
        }
        if (onScroll) scrollEl?.removeEventListener('scroll', onScroll);
        popover?.remove();
        popover = undefined;
        optionNodes = [];
        ctxRef = undefined;
      },
    };
  };
}

/** The built-in editor factories keyed by `ENTITY-COLUMN.type`. */
export const BUILT_IN_EDITORS: Record<ColumnType, EditorFactory> = {
  text: textEditor,
  number: numberEditor,
  date: dateEditor,
  boolean: booleanEditor,
  // `select` needs options; without an `EditorSpec` it degrades to a text input.
  select: textEditor,
  custom: textEditor,
};

/**
 * Resolve the `EditorFactory` for a column: `column.editor` (an `EditorSpec`)
 * wins; otherwise the `column.type` default (`text` when unset).
 */
export function resolveEditorFactory(column: ColumnDef): EditorFactory {
  const spec = column.editor;
  if (spec) {
    switch (spec.kind) {
      case 'text':
        return textEditor;
      case 'number':
        return numberEditor;
      case 'date':
        return dateEditor;
      case 'boolean':
        return booleanEditor;
      case 'select':
        return makeSelectEditor(spec.options);
      case 'custom':
        return spec.create;
    }
  }
  return BUILT_IN_EDITORS[column.type ?? 'text'];
}
