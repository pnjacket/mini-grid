/**
 * `CAP-MENU` / `LIB-MENU` (v1.4) — the **content** half of the configurable
 * context menus: the `builtinItems` factory registry, the `BuiltinCommandId`
 * catalog (+ its capability-flag and i18n-label maps), and the **default menu
 * builder** that preserves today's items (no out-of-box regression) while adding
 * the slice 17–19 built-ins on the header surfaces.
 *
 * The **presentation/behavior** half — resolving a `MenuBuilder`'s output against
 * feature flags, routing `command` ids to the owning controllers, firing
 * `EVT-MENU-OPEN`, and mounting the `role="menu"` overlay — lives in
 * `context-menu.ts` (the `ContextMenuController`) and `api/grid.ts` (the routing +
 * `openMenu`/`closeMenu` facade), which have access to the grid internals.
 */
import type { FeatureFlag } from '../api/features.js';
import type { BuiltinCommandId, MenuBuilder, MenuContext, MenuItem } from '../types.js';

/** The full `BuiltinCommandId` catalog (drives validation of raw `{ command }` ids). */
export const BUILTIN_COMMAND_IDS: readonly BuiltinCommandId[] = [
  'copy',
  'cut',
  'paste',
  'insert-row-above',
  'insert-row-below',
  'delete-rows',
  'insert-col-left',
  'insert-col-right',
  'delete-cols',
  'sort-asc',
  'sort-desc',
  'clear-sort',
  'filter',
  'hide-column',
  'show-column',
  'pin-column',
  'unpin-column',
  'autofit',
  'autofit-all',
  'group-by',
  'ungroup',
  'select-all',
];

const BUILTIN_SET = new Set<string>(BUILTIN_COMMAND_IDS);

/** Is `id` a known `BuiltinCommandId`? (an unknown `command` → `INVALID_OPTIONS`). */
export function isBuiltinCommand(id: string): id is BuiltinCommandId {
  return BUILTIN_SET.has(id);
}

/**
 * Command → the capability flag that gates it. A built-in whose flag is **off**
 * is inert and its item **auto-hides** (`PATTERN-FEATURE-FLAGS`); developer
 * `handler`/`custom` items are unaffected.
 */
export const COMMAND_FLAG: Record<BuiltinCommandId, FeatureFlag> = {
  copy: 'clipboard',
  cut: 'clipboard',
  paste: 'clipboard',
  'insert-row-above': 'editing',
  'insert-row-below': 'editing',
  'delete-rows': 'editing',
  'insert-col-left': 'editing',
  'insert-col-right': 'editing',
  'delete-cols': 'editing',
  'sort-asc': 'sorting',
  'sort-desc': 'sorting',
  'clear-sort': 'sorting',
  filter: 'filtering',
  'hide-column': 'columnManage',
  'show-column': 'columnManage',
  'pin-column': 'columnManage',
  'unpin-column': 'columnManage',
  autofit: 'autofit',
  'autofit-all': 'autofit',
  'group-by': 'group',
  ungroup: 'group',
  'select-all': 'selection',
};

/** Command → its i18n label key (resolved through the bundle via `LIB-LOCALE`). */
export const COMMAND_LABEL_KEY: Record<BuiltinCommandId, string> = {
  copy: 'contextMenu.copy',
  cut: 'contextMenu.cut',
  paste: 'contextMenu.paste',
  'insert-row-above': 'contextMenu.insertRowAbove',
  'insert-row-below': 'contextMenu.insertRowBelow',
  'delete-rows': 'contextMenu.deleteRows',
  'insert-col-left': 'contextMenu.insertColLeft',
  'insert-col-right': 'contextMenu.insertColRight',
  'delete-cols': 'contextMenu.deleteCols',
  'sort-asc': 'menu.sortAsc',
  'sort-desc': 'menu.sortDesc',
  'clear-sort': 'menu.clearSort',
  filter: 'menu.filter',
  'hide-column': 'menu.hideColumn',
  'show-column': 'menu.showColumn',
  'pin-column': 'menu.pinColumn',
  'unpin-column': 'menu.unpinColumn',
  autofit: 'menu.autofit',
  'autofit-all': 'menu.autofitAll',
  'group-by': 'menu.groupBy',
  ungroup: 'menu.ungroup',
  'select-all': 'menu.selectAll',
};

/** A ready-wired `{ kind:'action', command }` built-in item. */
function cmd(command: BuiltinCommandId): MenuItem {
  return { kind: 'action', id: command, command, labelKey: COMMAND_LABEL_KEY[command] };
}

/**
 * `builtinItems` — the registry of ready-made item **factories** (the first
 * built-in path). Each returns a fully-wired, localized `MenuItem` (equivalent to
 * `{ kind:'action', command: <id> }`); developers **compose** these into a
 * `MenuBuilder`'s returned array. The `ctx`-taking factories accept the context
 * so a developer can branch, but the behavior always routes off `ctx.target`.
 */
export const builtinItems = {
  copy: (): MenuItem => cmd('copy'),
  cut: (): MenuItem => cmd('cut'),
  paste: (): MenuItem => cmd('paste'),
  insertRowAbove: (): MenuItem => cmd('insert-row-above'),
  insertRowBelow: (): MenuItem => cmd('insert-row-below'),
  deleteRows: (): MenuItem => cmd('delete-rows'),
  insertColLeft: (): MenuItem => cmd('insert-col-left'),
  insertColRight: (): MenuItem => cmd('insert-col-right'),
  deleteCols: (): MenuItem => cmd('delete-cols'),
  sortAsc: (_ctx?: MenuContext): MenuItem => cmd('sort-asc'),
  sortDesc: (_ctx?: MenuContext): MenuItem => cmd('sort-desc'),
  clearSort: (): MenuItem => cmd('clear-sort'),
  filter: (_ctx?: MenuContext): MenuItem => cmd('filter'),
  hideColumn: (_ctx?: MenuContext): MenuItem => cmd('hide-column'),
  showColumn: (_ctx?: MenuContext): MenuItem => cmd('show-column'),
  pinColumn: (_ctx?: MenuContext): MenuItem => cmd('pin-column'),
  unpinColumn: (_ctx?: MenuContext): MenuItem => cmd('unpin-column'),
  autofit: (_ctx?: MenuContext): MenuItem => cmd('autofit'),
  autofitAll: (): MenuItem => cmd('autofit-all'),
  groupBy: (_ctx?: MenuContext): MenuItem => cmd('group-by'),
  ungroup: (_ctx?: MenuContext): MenuItem => cmd('ungroup'),
  selectAll: (): MenuItem => cmd('select-all'),
};

const sep = (id: string): MenuItem => ({ kind: 'separator', id });

/**
 * The **shipped default builder** (`GridOptions.menu` absent / `'default'`). Zero
 * config shows today's cell items (copy/cut/paste, insert/delete rows+cols — NO
 * regression) plus the new header built-ins (sort/filter/hide/show/pin/autofit/
 * group + col CRUD). Feature-flag-off built-ins auto-hide at resolution time, so
 * the visible set adapts to the enabled capabilities.
 */
export const defaultMenuBuilder: MenuBuilder = (ctx) => {
  switch (ctx.target.kind) {
    case 'cell':
      return [
        builtinItems.copy(),
        builtinItems.cut(),
        builtinItems.paste(),
        sep('sep-clip'),
        builtinItems.insertRowAbove(),
        builtinItems.insertRowBelow(),
        builtinItems.deleteRows(),
        sep('sep-row'),
        builtinItems.insertColLeft(),
        builtinItems.insertColRight(),
        builtinItems.deleteCols(),
      ];
    case 'column-header':
      return [
        builtinItems.sortAsc(ctx),
        builtinItems.sortDesc(ctx),
        builtinItems.clearSort(),
        sep('sep-sort'),
        builtinItems.filter(ctx),
        sep('sep-filter'),
        builtinItems.hideColumn(ctx),
        builtinItems.showColumn(ctx),
        builtinItems.pinColumn(ctx),
        builtinItems.autofit(ctx),
        sep('sep-manage'),
        builtinItems.insertColLeft(),
        builtinItems.insertColRight(),
        builtinItems.deleteCols(),
        sep('sep-group'),
        builtinItems.groupBy(ctx),
      ];
    case 'row-header':
      return [
        builtinItems.insertRowAbove(),
        builtinItems.insertRowBelow(),
        builtinItems.deleteRows(),
        sep('sep-row'),
        builtinItems.copy(),
        builtinItems.cut(),
        builtinItems.paste(),
      ];
    case 'corner':
      return [builtinItems.selectAll(), sep('sep-corner'), builtinItems.autofitAll(), builtinItems.clearSort()];
  }
};

/**
 * A fully-resolved, presentation-ready menu item the `ContextMenuController`
 * renders. Produced by `api/grid.ts` from a filtered `MenuItem` (labels resolved,
 * flags applied, `command`s routed to `onSelect`, `custom` `render` invoked).
 */
export interface RenderMenuItem {
  id: string;
  kind: MenuItem['kind'];
  label: string;
  icon?: string | Node;
  shortcut?: string;
  disabled: boolean;
  /** checkbox/toggle/radio checked state. */
  checked?: boolean;
  /** radio group name (mutual exclusion within a level). */
  radioGroup?: string;
  /** submenu children. */
  children?: RenderMenuItem[];
  /** custom: the developer-owned node, mounted **as-is** (`SEC-MENU-CUSTOM-RENDER`). */
  node?: Node;
  /** action/checkbox/toggle/radio activation. */
  onSelect?: () => void;
}
