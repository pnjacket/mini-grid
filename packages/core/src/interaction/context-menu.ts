/**
 * `LAYER-CONTEXT-MENU` + `LAYER-HEADER-MENU` (`A11Y-CONTEXT-MENU` /
 * `A11Y-HEADER-MENU`) — the builder-driven, target-branched context menu
 * (`CAP-MENU`, v1.4). One controller serves **both** the body-cell menu and the
 * dedicated header/row-header/corner menu (`DOM-HEADER-MENU`), opened by
 * **right-click / long-press / ContextMenu key / Shift+F10** or programmatically
 * (`openMenu`, `LIB-MENU`).
 *
 * The controller is **dumb about what items do**: the grid resolves the
 * `MenuBuilder` output into `RenderMenuItem[]` (flag-filtered, command-routed,
 * labels localized, `EVT-MENU-OPEN` fired) via `host.resolve`; the controller
 * only mounts them and owns the accessible interaction model:
 *
 *  - roles by kind — `role="menuitem"` (action/submenu), `menuitemcheckbox`
 *    (checkbox/toggle, `aria-checked`), `menuitemradio` (radio); a submenu parent
 *    is `aria-haspopup="menu"` `aria-expanded` over a nested `role="menu"`;
 *    a `custom` item mounts its developer node **as-is** (`SEC-MENU-CUSTOM-RENDER`).
 *  - keyboard — ↑/↓ move (skip disabled/separators, wrap); Home/End; Enter/click
 *    activate; →/Enter open a submenu, ←/Esc step back; **Space toggles** a
 *    checkbox/radio without closing; **Esc closes + restores focus** to the origin.
 *  - light-dismiss on outside pointer-down / scroll / blur.
 */
import type { MenuTarget } from '../types.js';
import type { RenderMenuItem } from './menu.js';
import type { Translate } from '../i18n/i18n.js';
import { defaultTranslate } from '../i18n/i18n.js';

/** What the grid tells the controller when a trigger fires. */
export interface MenuTargetResolution {
  target: MenuTarget;
  /** The DOM node the menu was opened from (focus-restore origin). */
  origin: HTMLElement;
}

export interface ContextMenuHost {
  document: Document;
  /** `DOM-ROOT` (`role="grid"`) — trigger listeners + theme-class source. */
  root: HTMLElement;
  /** `COMPONENT-I18N` translator for the menu accessible name (optional). */
  t?: Translate;
  /**
   * Map an event's DOM target node → the addressed `MenuTarget` + origin node, or
   * `null` when the node addresses no menu surface. Grid owns the DOM knowledge
   * (cell vs column-header vs row-header vs corner).
   */
  targetFromNode(node: HTMLElement | null): MenuTargetResolution | null;
  /**
   * Resolve a target into render-ready items (fires `EVT-MENU-OPEN`), or `null`
   * to **not open** (menu disabled / feature-flag off / no items after filtering).
   * `origin` is passed through for index/anchor derivation.
   */
  resolve(
    target: MenuTarget,
    position: { x: number; y: number },
    event: Event,
    origin: HTMLElement | undefined,
  ): RenderMenuItem[] | null;
  /** The active cell, for a keyboard-triggered open (Shift+F10 / ContextMenu). */
  getActiveCell(): { row: number; col: number } | null;
  /** The live cell node at a logical position. */
  cellAt(row: number, col: number): HTMLElement | undefined;
  /** The origin node for a programmatic `openMenu(target)` (focus + anchor). */
  originForTarget(target: MenuTarget): HTMLElement | undefined;
}

/** A rendered focusable entry within a menu level. */
interface LevelItem {
  node: HTMLElement;
  item: RenderMenuItem;
}

/** One open menu (`role="menu"`) — the root menu or an open submenu. */
interface MenuLevel {
  el: HTMLElement;
  /** The focusable items (menuitem/checkbox/radio) in order. */
  items: LevelItem[];
  /** The submenu parent this level was opened from (for ←/Esc step-back). */
  parent?: LevelItem | undefined;
  /** The keydown handler bound to this level's element. */
  onKeyDown: (e: KeyboardEvent) => void;
}

export class ContextMenuController {
  private levels: MenuLevel[] = [];
  private origin: HTMLElement | null = null;

  private readonly onContextMenu: (e: MouseEvent) => void;
  private readonly onRootKeyDown: (e: KeyboardEvent) => void;
  private readonly onTouchStart: (e: TouchEvent) => void;
  private readonly onTouchEnd: () => void;
  private readonly onDocPointerDown: (e: Event) => void;
  private readonly onDismiss: () => void;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: ContextMenuHost) {
    this.onContextMenu = (e) => this.handleContextMenu(e);
    this.onRootKeyDown = (e) => this.handleRootKeyDown(e);
    this.onTouchStart = (e) => this.handleTouchStart(e);
    this.onTouchEnd = () => this.cancelLongPress();
    this.onDocPointerDown = (e) => this.handleDocPointerDown(e);
    this.onDismiss = () => this.close(false);

    const { root } = host;
    root.addEventListener('contextmenu', this.onContextMenu);
    root.addEventListener('keydown', this.onRootKeyDown);
    root.addEventListener('touchstart', this.onTouchStart, { passive: true });
    root.addEventListener('touchend', this.onTouchEnd);
    root.addEventListener('touchmove', this.onTouchEnd);
  }

  isOpen(): boolean {
    return this.levels.length > 0;
  }

  destroy(): void {
    this.close(false);
    const { root } = this.host;
    root.removeEventListener('contextmenu', this.onContextMenu);
    root.removeEventListener('keydown', this.onRootKeyDown);
    root.removeEventListener('touchstart', this.onTouchStart);
    root.removeEventListener('touchend', this.onTouchEnd);
    root.removeEventListener('touchmove', this.onTouchEnd);
  }

  // --- Triggers -------------------------------------------------------------

  private handleContextMenu(e: MouseEvent): void {
    const resolution = this.host.targetFromNode(e.target as HTMLElement | null);
    if (!resolution) return;
    const items = this.host.resolve(resolution.target, { x: e.clientX, y: e.clientY }, e, resolution.origin);
    if (!items || items.length === 0) return; // menu disabled / no items → leave native menu
    e.preventDefault();
    this.mount(items, e.clientX, e.clientY, resolution.origin);
  }

  private handleRootKeyDown(e: KeyboardEvent): void {
    const isOpener = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
    if (!isOpener) return;
    // Keyboard open addresses the active cell (or the focused header cell).
    const focused = this.host.document.activeElement as HTMLElement | null;
    let resolution = focused ? this.host.targetFromNode(focused) : null;
    if (!resolution) {
      const active = this.host.getActiveCell();
      if (active) {
        const cell = this.host.cellAt(active.row, active.col);
        resolution = cell ? this.host.targetFromNode(cell) : null;
      }
    }
    if (!resolution) return;
    const rect = resolution.origin.getBoundingClientRect();
    const x = rect.left;
    const y = rect.bottom;
    const items = this.host.resolve(resolution.target, { x, y }, e, resolution.origin);
    if (!items || items.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.mount(items, x, y, resolution.origin);
  }

  private handleTouchStart(e: TouchEvent): void {
    const touch = e.touches[0];
    if (!touch) return;
    const resolution = this.host.targetFromNode(e.target as HTMLElement | null);
    if (!resolution) return;
    const x = touch.clientX;
    const y = touch.clientY;
    this.longPressTimer = setTimeout(() => {
      const items = this.host.resolve(resolution.target, { x, y }, e, resolution.origin);
      if (items && items.length > 0) this.mount(items, x, y, resolution.origin);
    }, 500);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== undefined) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
  }

  private handleDocPointerDown(e: Event): void {
    if (this.levels.length === 0) return;
    const t = e.target;
    if (t instanceof Node && this.levels.some((l) => l.el.contains(t))) return;
    this.close(false);
  }

  // --- Programmatic open (`LIB-MENU.openMenu`) ------------------------------

  /** Open the menu for a target at `position` (default: the target node's rect). */
  openForTarget(target: MenuTarget, position?: { x: number; y: number }): void {
    this.close(false);
    const origin = this.host.originForTarget(target);
    let x = position?.x;
    let y = position?.y;
    if (x === undefined || y === undefined) {
      const rect = origin?.getBoundingClientRect();
      x = rect ? rect.left : 0;
      y = rect ? rect.bottom : 0;
    }
    const syntheticEvent = new (this.host.document.defaultView?.Event ?? Event)('openMenu');
    const items = this.host.resolve(target, { x, y }, syntheticEvent, origin);
    if (!items || items.length === 0) return;
    this.mount(items, x, y, origin);
  }

  // --- Mount / close --------------------------------------------------------

  private mount(items: RenderMenuItem[], x: number, y: number, origin: HTMLElement | undefined): void {
    this.origin = origin ?? null;
    const level = this.renderLevel(items, x, y);
    this.levels = [level];

    const doc = this.host.document;
    doc.addEventListener('mousedown', this.onDocPointerDown, true);
    doc.addEventListener('touchstart', this.onDocPointerDown, true);
    this.host.root.querySelector('.mg-scroll')?.addEventListener('scroll', this.onDismiss);

    const first = this.firstEnabledIndex(level);
    if (first >= 0) this.focusItem(level, first);
    else level.el.focus();
  }

  /** Build one `role="menu"` element (root or submenu) and its items. */
  private renderLevel(
    items: RenderMenuItem[],
    x: number,
    y: number,
    parent?: LevelItem,
  ): MenuLevel {
    const doc = this.host.document;
    const menu = doc.createElement('div');
    menu.className = this.host.root.classList.contains('mg-theme-dark')
      ? 'mg-context-menu mg-context-menu--dark'
      : 'mg-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', (this.host.t ?? defaultTranslate)('contextMenu.ariaLabel'));
    menu.setAttribute('tabindex', '-1');
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = String(10 + this.levels.length);

    const level: MenuLevel = { el: menu, items: [], parent, onKeyDown: () => {} };
    level.onKeyDown = (e) => this.handleMenuKeyDown(e, level);
    menu.addEventListener('keydown', level.onKeyDown);

    for (const item of items) {
      if (item.kind === 'separator') {
        const s = doc.createElement('div');
        s.className = 'mg-context-menu-sep';
        s.setAttribute('role', 'separator');
        menu.appendChild(s);
        continue;
      }
      if (item.kind === 'custom') {
        // `SEC-MENU-CUSTOM-RENDER` — the developer-owned node is mounted **AS-IS**
        // (not escaped, not wrapped): the grid inserts exactly what `render`
        // returned. The developer owns the node's accessibility (roles/focus) —
        // this is a documented developer-trust boundary distinct from the cell
        // `SEC-RENDERER-DOM-ONLY` escape-by-default guarantee.
        if (item.node) menu.appendChild(item.node);
        continue;
      }

      const node = doc.createElement('div');
      node.className = 'mg-context-menu-item';
      node.setAttribute('data-item-id', item.id);
      node.setAttribute('tabindex', '-1');

      const role =
        item.kind === 'checkbox' || item.kind === 'toggle'
          ? 'menuitemcheckbox'
          : item.kind === 'radio'
            ? 'menuitemradio'
            : 'menuitem';
      node.setAttribute('role', role);
      if (role !== 'menuitem') node.setAttribute('aria-checked', item.checked ? 'true' : 'false');
      if (item.radioGroup) node.setAttribute('data-radio-group', item.radioGroup);

      const label = doc.createElement('span');
      label.className = 'mg-context-menu-label';
      label.textContent = item.label;
      node.appendChild(label);
      if (item.shortcut) {
        const sc = doc.createElement('span');
        sc.className = 'mg-context-menu-shortcut';
        sc.textContent = item.shortcut;
        node.appendChild(sc);
      }

      if (item.kind === 'submenu') {
        node.setAttribute('aria-haspopup', 'menu');
        node.setAttribute('aria-expanded', 'false');
      }

      if (item.disabled) {
        node.setAttribute('aria-disabled', 'true');
      } else {
        node.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.activate(level, { node, item });
        });
      }
      menu.appendChild(node);
      level.items.push({ node, item });
    }

    doc.body.appendChild(menu);
    return level;
  }

  /** Close every open level; optionally restore focus to the origin. */
  close(restoreFocus: boolean): void {
    this.cancelLongPress();
    if (this.levels.length === 0) {
      if (restoreFocus) this.origin?.focus();
      return;
    }
    const doc = this.host.document;
    doc.removeEventListener('mousedown', this.onDocPointerDown, true);
    doc.removeEventListener('touchstart', this.onDocPointerDown, true);
    this.host.root.querySelector('.mg-scroll')?.removeEventListener('scroll', this.onDismiss);
    for (const level of this.levels) {
      level.el.removeEventListener('keydown', level.onKeyDown);
      level.el.remove();
    }
    this.levels = [];
    const origin = this.origin;
    this.origin = null;
    if (restoreFocus && origin) origin.focus();
  }

  /** Pop the top submenu level, returning focus to its parent item. */
  private closeTopLevel(): void {
    if (this.levels.length <= 1) return;
    const level = this.levels.pop();
    if (!level) return;
    level.el.removeEventListener('keydown', level.onKeyDown);
    level.el.remove();
    const parent = level.parent;
    if (parent) {
      parent.node.setAttribute('aria-expanded', 'false');
      parent.node.focus();
    }
  }

  private activate(level: MenuLevel, li: LevelItem): void {
    const { item } = li;
    if (item.disabled) return;
    if (item.kind === 'submenu') {
      this.openSubmenu(level, li);
      return;
    }
    if (item.kind === 'checkbox' || item.kind === 'toggle' || item.kind === 'radio') {
      this.toggle(level, li);
      return;
    }
    // action — activate + close the whole menu.
    this.close(true);
    item.onSelect?.();
  }

  /** Toggle a checkbox/radio in place (does NOT close — `A11Y`: Space toggles). */
  private toggle(level: MenuLevel, li: LevelItem): void {
    const { item, node } = li;
    if (item.kind === 'radio') {
      // Clear siblings in the same radio group at this level, then set this one.
      for (const other of level.items) {
        if (other.item.radioGroup && other.item.radioGroup === item.radioGroup) {
          other.node.setAttribute('aria-checked', 'false');
          other.item.checked = false;
        }
      }
      item.checked = true;
      node.setAttribute('aria-checked', 'true');
    } else {
      item.checked = !item.checked;
      node.setAttribute('aria-checked', item.checked ? 'true' : 'false');
    }
    item.onSelect?.();
  }

  private openSubmenu(level: MenuLevel, li: LevelItem): void {
    // Already open? Just move focus into it.
    const existing = this.levels.find((l) => l.parent === li);
    if (existing) {
      const first = this.firstEnabledIndex(existing);
      if (first >= 0) this.focusItem(existing, first);
      return;
    }
    const children = li.item.children ?? [];
    if (children.length === 0) return;
    const rect = li.node.getBoundingClientRect();
    li.node.setAttribute('aria-expanded', 'true');
    const sub = this.renderLevel(children, rect.right, rect.top, li);
    this.levels.push(sub);
    const first = this.firstEnabledIndex(sub);
    if (first >= 0) this.focusItem(sub, first);
    else sub.el.focus();
    void level;
  }

  // --- Keyboard (A11Y-CONTEXT-MENU / A11Y-HEADER-MENU) ----------------------

  private handleMenuKeyDown(e: KeyboardEvent, level: MenuLevel): void {
    // Only the deepest open level handles the key (submenus stop propagation).
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(level, 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(level, -1);
        break;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        this.focusEdge(level, 1);
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        this.focusEdge(level, -1);
        break;
      case 'ArrowRight': {
        const li = this.focusedItem(level);
        if (li && li.item.kind === 'submenu' && !li.item.disabled) {
          e.preventDefault();
          e.stopPropagation();
          this.openSubmenu(level, li);
        }
        break;
      }
      case 'ArrowLeft':
        if (level.parent) {
          e.preventDefault();
          e.stopPropagation();
          this.closeTopLevel();
        }
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        this.activateFocused(level);
        break;
      case ' ': {
        // Space toggles a checkbox/radio in place; else activates.
        e.preventDefault();
        e.stopPropagation();
        const li = this.focusedItem(level);
        if (li && (li.item.kind === 'checkbox' || li.item.kind === 'toggle' || li.item.kind === 'radio')) {
          if (!li.item.disabled) this.toggle(level, li);
        } else {
          this.activateFocused(level);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (level.parent) this.closeTopLevel();
        else this.close(true);
        break;
      case 'Tab':
        e.preventDefault();
        this.close(true);
        break;
    }
  }

  private focusedIndex(level: MenuLevel): number {
    const active = this.host.document.activeElement;
    return level.items.findIndex((li) => li.node === active);
  }

  private focusedItem(level: MenuLevel): LevelItem | undefined {
    const idx = this.focusedIndex(level);
    return idx >= 0 ? level.items[idx] : undefined;
  }

  private isEnabled(li: LevelItem | undefined): boolean {
    return !!li && li.node.getAttribute('aria-disabled') !== 'true';
  }

  private firstEnabledIndex(level: MenuLevel): number {
    return level.items.findIndex((li) => this.isEnabled(li));
  }

  private focusItem(level: MenuLevel, index: number): void {
    for (const li of level.items) li.node.setAttribute('tabindex', '-1');
    const li = level.items[index];
    if (!li) return;
    li.node.setAttribute('tabindex', '0');
    li.node.focus();
  }

  private moveFocus(level: MenuLevel, dir: 1 | -1): void {
    const n = level.items.length;
    if (n === 0) return;
    let idx = this.focusedIndex(level);
    if (idx < 0) idx = dir === 1 ? -1 : n;
    for (let step = 0; step < n; step++) {
      idx = (idx + dir + n) % n;
      if (this.isEnabled(level.items[idx])) {
        this.focusItem(level, idx);
        return;
      }
    }
  }

  private focusEdge(level: MenuLevel, dir: 1 | -1): void {
    const n = level.items.length;
    let idx = dir === 1 ? 0 : n - 1;
    for (let step = 0; step < n; step++) {
      if (this.isEnabled(level.items[idx])) {
        this.focusItem(level, idx);
        return;
      }
      idx += dir;
    }
  }

  private activateFocused(level: MenuLevel): void {
    const li = this.focusedItem(level);
    if (!this.isEnabled(li)) return;
    this.activate(level, li!);
  }
}
