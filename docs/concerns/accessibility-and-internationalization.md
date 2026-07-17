---
artifact: product-doc
role: concern
concern-id: accessibility-and-internationalization
behavior: module
trigger: interactive_ui (a11y) + multi_locale (i18n)
in-scope-subaspects: [a11y-conformance, string-externalization, locale-formats, rtl-support, pluralization]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Accessibility & Internationalization — mini-grid

> One-line: WCAG 2.1 AA ARIA-grid accessibility with keyboard-complete operation, a finalized **live-region announcement contract** for the worker's ambient updates, per-layer focus contracts, and full RTL + locale formatting.

## Purpose & Scope

Owns accessibility conformance (`A11Y-*`, per `SCREEN-*`/layer) and i18n. mini-grid **is a live-updating UI**, so the a11y bar includes the accessible-announcement contract.

## Non-goals / Out-of-scope
- `translation-process` — *(absent, confirmed)* the component externalizes strings + consumes host bundles; it owns no translation workflow.

## Requirements

### `A11Y-GRID` (`SCREEN-GRID`) — WCAG 2.1 AA
- **Roles/attrs:** `DOM-ROOT` `role="grid"`, `aria-rowcount`/`aria-colcount` = **full logical counts** (virtualization-aware), `aria-multiselectable="true"`; rows `role="row"` `aria-rowindex`; cells `role="gridcell"` `aria-colindex` `aria-selected` `aria-readonly`; headers `role="columnheader"` `aria-sort`; `aria-busy` during loading.
- **Multi-band header region** *(v1.3, `CAP-HEADER`)*: each of the N column-header bands is a `role="row"` band (`data-band`); header cells are `role="columnheader"` (row-header gutter cells `role="rowheader"` `aria-rowindex`, M bands), and a developer **span/merge** carries **`aria-colspan`/`aria-rowspan`** on the cell. The **corner** (`DOM-CORNER`) is a `role="columnheader"` with an accessible name ("Select all", localized) and, when `header.corner.selectAll`, activates select-all on Enter/Space. Row-header gutter cells are keyboard-focusable and, when `header.rows.select`, activate **whole-row line-selection** (Enter/Space); column-header cells likewise activate **whole-column line-selection** (*(v1.4.1)* a **spanning** cell activates selection of **all columns it spans**). *(v1.4.1)* `aria-sort` is present on **exactly one cell per sorted column** — its affordance-band cell — and is never set on the column's other bands or a spanning cell (so assistive tech announces a single sort state). (Generalizes the v1.2 rowheader clause to the full symmetric region.)
- **Multi-range selection semantics** *(v1.3)*: `aria-selected="true"` is set on **every** cell across the disjoint range-set (and the materialized line ranges); `aria-multiselectable="true"` (already present) advertises the model; the active cell keeps roving `tabindex=0`. Adding a disjoint range or a line-select does not move focus off the active cell except per gesture.
- **Focus model:** **roving `tabindex`** — the grid is one tab stop; the active cell has `tabindex=0`, others `-1`; arrows/Home/End/PageUp-Down move; the **focused cell is kept rendered** (never a recycled node). Visible focus ring (`--mg-focus-ring`, ≥3:1).
- **Keyboard-complete:** the remappable `BIND-KEYS` map (arrows/Tab/Enter/Esc/F2/Ctrl+C-X-V/Ctrl+Z-Y/Shift-extend).
- **Contrast:** default themes meet AA (4.5:1 text; 3:1 UI/graphical/focus).
- **OS prefs (confirmed):** honor `prefers-reduced-motion` (no smooth-scroll/animation) and `forced-colors`/high-contrast (system colors; visible borders + focus).

### Accessible-announcement contract (`A11Y-GRID`, live region)
- **Two** visually-hidden **ARIA live regions** (one `aria-live="polite"`, one `aria-live="assertive"`, both `aria-atomic`) on the grid **container** (siblings of `role="grid"`, so outside the grid ARIA tree — axe-clean) announce ambient updates **without stealing focus** (regions are never focusable/focused). Realized by `Announcer` (`packages/core/src/a11y/announcer.ts`); the host may also push its own messages through `grid.announce(message, { assertive? })`.
- **Politeness (finalized):** `polite` — sort settle ("Sorted by {col} {dir}, {N} rows"), filter settle ("Filtered, {N} of {total}"), row/column insert/delete ("{n} rows/columns inserted/removed"), *(v1.3)* **column hide/show** ("Column {header} hidden/shown"), **pin** ("Column {header} pinned/unpinned"), **autofit** ("Column {header} resized to fit" / "All columns resized to fit"); **`assertive`** — validation errors ("Invalid: {message}"). **Edit-commit announcements are OFF by default** (opt-in via the `announceEdits` option) — moving focus to the cell already conveys its value; avoids chattiness. *(Confirmed: off-by-default; opt-in realized as `announceEdits`.)*
- **Burst coalescing:** rapid/bulk updates announce the final state only — a single DOM write per politeness per scheduling window (default: a microtask).
- **Named exclusions (silent, by provenance):** scroll-driven **virtualization repaint**, **drag previews** (resize/reorder/fill/range-select), per-keystroke **selection movement** (conveyed by focus), placeholder→filled **window arrival** (conveyed by `aria-busy` on `DOM-ROOT`, set while any async data op — window fetch / sort / filter / load — is pending, cleared on settle). These provenances are simply never routed to the announcer.

### Per-layer focus contracts (focus-order refinement; layers are non-modal, UX owns dismissal)
- `A11Y-EDITOR` — on open, focus moves into the editor input (accessible name = column header); `aria-invalid` + `aria-describedby`→`LAYER-VALIDATION-TIP` on rejection; **Esc restores focus to the origin cell**; commit returns focus to the cell then moves per convention. Placement is **synchronous** (no async enabling-read race). *(v1.1)* the **`select` editor popover** is a `role="listbox"` (`role="option"` children, roving focus / `aria-activedescendant`); the trigger cell carries `aria-expanded`; Esc closes + restores focus to the origin cell. The **`boolean` editor** is a labelled checkbox committing on `change` (no focus-loss race).
- `A11Y-FILTER-MENU` — `aria-expanded` on the trigger; on open focus moves to the first control; arrow/Tab within; **Esc closes + restores focus to the filter icon**; operator select + value input are labeled.
- `A11Y-CONTEXT-MENU` *(rich items v1.4, `LAYER-CONTEXT-MENU`)* — `role="menu"`; **keyboard-openable** (Shift+F10 / ContextMenu key) and via `openMenu`; arrow-navigable. Builder items carry a **role by kind**: `role="menuitem"` (action), **`role="menuitemcheckbox"`** (checkbox/toggle, `aria-checked`), **`role="menuitemradio"`** (radio, `aria-checked` within its group), and a **submenu** parent is **`aria-haspopup="menu"`** `aria-expanded` over a nested `role="menu"`. **Keyboard parity:** ↑/↓ move; →/Enter opens a submenu (focus its first item), ←/Esc closes it back to the parent; **Space toggles** a checkbox/radio without closing; disabled items `aria-disabled` and skipped; a `custom` item is focusable + operable by its own DOM. **Esc closes + restores focus** to the origin cell.
- `A11Y-HEADER-MENU` *(v1.3, rich items v1.4, `LAYER-HEADER-MENU`)* — the dedicated header menu is `role="menu"`, **keyboard-openable** from a focused header cell (Shift+F10 / ContextMenu key) and via `openMenu`; arrow-navigable. Items carry role by kind exactly as `A11Y-CONTEXT-MENU`: `role="menuitem"`/**`menuitemcheckbox`**/**`menuitemradio`**, submenu parent **`aria-haspopup="menu"`**/`aria-expanded` over a nested `role="menu"`; the default items are labeled `role="menuitem"` (sort/filter/hide/show/pin/autofit/insert/delete/group-by). **Keyboard parity:** →/Enter opens a submenu, ←/Esc steps back, **Space toggles** checkbox/radio (`aria-checked` reflects state), disabled items `aria-disabled` and skipped, a `custom` item operable by its own DOM. **Esc closes + restores focus to the origin header cell.** The a11y contract (roles/keyboard/focus/Esc-restore) holds for whatever items the `MenuBuilder` returns *(v1.4 — resolves the former menu-config deferral)*.

### `A11Y-I18N` — i18n
- **String externalization:** all UI strings (menu labels, filter operators, aria-labels, announcements) externalized; **English default bundle**; host supplies other locales via `LIB-LOCALE`. No hard-coded user-facing text.
- **Locale formats:** `Intl` number/currency/percent/date, integrated with `CAP-FMT-VALUE` masks.
- **RTL:** full mirroring — column order, horizontal scroll, freeze on the trailing edge, alignment, resize/reorder/fill handles, menus; `dir` on `DOM-ROOT`.
- **Pluralization:** `Intl.PluralRules` for count-bearing strings.

### Conformance claim
**WCAG 2.1 AA** for `SCREEN-GRID` + layers, **with no traced SC exceptions** at v1 (responsive/reflow is in scope; color is never the sole information carrier). **Forced-colors strategy:** conditional formatting is **presentational only — meaning is never color-alone** (the cell value/text is always present; icon sets convey via shape), so `1.4.1 Use of Color` holds; under `forced-colors` the OS may override fills/scales while borders + focus stay visible via system colors.

## Open Questions
- SR behavior of large `aria-rowcount` across NVDA/JAWS/VoiceOver — validated in the a11y manual-smoke residual (Quality accountability row).

## Dependencies & Cross-references
- **Realizes:** `SUCCESS-A11Y` (P&R pointer). **Binds:** `SCREEN-GRID` + `LAYER-*` (UX), the ambient-state register (announcement eligibility keyed to those triggers).
- **Consumes:** `DOM-*`/`BIND-*` (Interfaces). **Verified by:** Quality a11y tier (axe + keyboard + live-region assertions + SR smoke).

## Examples / Worked scenarios
- *Announce a sort:* sort 1M rows → `polite` region says "Sorted by Price descending, 1,000,000 rows"; focus stays on the header; no per-row announcement.
- *Editor focus:* open editor → focus in; invalid → `aria-invalid` + assertive error; Esc → focus back on the cell.

## Design Decisions
| Decision | Rationale |
|---|---|
| Live-region announcements with provenance-keyed exclusions | Worker updates arrive with no click; announce politely, exclude scroll/drag churn. |
| Edit-commit announcements off by default (opt-in via `announceEdits`) | Focus already conveys the value on navigation; avoids chattiness (confirmed). |
| Conformance = AA, no traced exceptions; color never sole carrier | Keeps `1.4.1` intact and forced-colors safe without special-casing. |
| Honor reduced-motion + forced-colors | Strongest real-world a11y posture (operator-chosen). |
| English default only; host owns translations | `translation-process` absent. |

## Contracts
`A11Y-GRID` (roles/attrs — incl. the v1.3 multi-band header region, corner, and multi-range-selection semantics — + roving-focus model + keyboard + contrast + OS-prefs + the announcement contract incl. hide/pin/autofit), the **four** per-layer focus contracts (`A11Y-EDITOR`/`-FILTER-MENU`/`-CONTEXT-MENU`/`-HEADER-MENU` — the two menus now carry the v1.4 rich-item roles `menuitem`/`menuitemcheckbox`/`menuitemradio`/`aria-haspopup`), and **`A11Y-I18N`** (externalized strings + `Intl` formats + RTL + PluralRules) above **are** the contracts — six `A11Y-*` IDs. Conformance = WCAG 2.1 AA, exceptions = none.

## Acceptance criteria
- **AC-AXE:** axe reports **zero violations** on `SCREEN-GRID` + open layers.
- **AC-KEYBOARD:** every action is reachable/operable by keyboard alone; roving focus never lands on a recycled node.
- **AC-ANNOUNCE:** a sort announces once (polite) with no focus move; a validation error announces assertively; scroll produces no announcement.
- **AC-FOCUS-RESTORE:** closing any layer (Esc) restores focus to its origin cell/trigger (incl. `LAYER-HEADER-MENU` → origin header cell).
- **AC-HEADER-A11Y** *(v1.3)*: multi-band headers expose `role="row"` bands + `columnheader`/`rowheader` with `aria-colspan`/`aria-rowspan` on spans; the corner has an accessible "Select all" name; a hide/pin/autofit action announces politely; axe reports zero violations with the header region + header menu open. *(v1.4.1)* a sorted column has **exactly one** `aria-sort`-bearing cell (its affordance-band cell) — no sibling band or spanning cell carries `aria-sort`.
- **AC-MULTI-SELECT-A11Y** *(v1.3)*: every cell in the disjoint range-set (and line ranges) carries `aria-selected="true"`; `aria-multiselectable="true"`; roving focus stays on the active cell.
- **AC-MENU-A11Y** *(v1.4)*: a builder-returned submenu is `aria-haspopup="menu"`/`aria-expanded` and arrow-openable (→/Enter open, ←/Esc back); a checkbox/radio item is `role="menuitemcheckbox"`/`menuitemradio` with `aria-checked` toggled by Space; a disabled item is `aria-disabled` and skipped; Esc closes + restores focus to the origin cell/header; axe reports zero violations with a rich cell **or** header menu open.
- **AC-RTL:** `dir=rtl` mirrors column order, freeze edge, and handles correctly.
- **AC-FORCED-COLORS:** in `forced-colors`, borders + focus remain visible and no information is conveyed by color alone.

