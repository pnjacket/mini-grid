---
artifact: product-doc
role: concern
concern-id: integrations-and-external-dependencies
behavior: module
trigger: third_party_deps
in-scope-subaspects: [per-external-contract, failure-modes-fallback-degradation, criticality, fidelity-substitution, version-pinning, data-mapping]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Integrations & External Dependencies — mini-grid

> One-line: a **dependency-light** library — the core has zero required runtime deps; the only externals are the three framework **peer dependencies** (React/Vue/Svelte, all v1) and a lazy-loaded **exceljs** for styled `.xlsx` export.

## Purpose & Scope

Owns the outbound dependency contracts (`DEP-*`): call/auth, criticality, failure/fallback, fidelity substitution, version pin, data mapping. The **core runs with none of them** (plain HTML).

## Non-goals / Out-of-scope
- None scoped out. (The v2 async **server** DataSource is a future integration — **[FUTURE-SCOPE]**, behind the same eventual `DEP-DATASOURCE` contract.)
- **Build/test toolchain** (Vitest, Playwright, axe-core, TypeScript) is **not** a `DEP-*` (not runtime) — co-owned by Quality/Delivery as toolchain pins (Ops absent).

## Requirements

### External dependencies (`DEP-*`)
| ID | Dependency · use · auth | Failure & fallback | Criticality | Version pin |
|---|---|---|---|---|
| `DEP-REACT` | React (peer); `@mini-grid/react` binds React lifecycle/reactivity to core; no auth | absent → that adapter unusable; **core + other adapters unaffected** | capability-degrading (React consumers only) | **`^18 \|\| ^19`** *(the adapter uses `createRoot`, so React ≥18)* |
| `DEP-VUE` | Vue (peer); `@mini-grid/vue` adapter; no auth | as above | capability-degrading (Vue consumers) | **`^3.3`** |
| `DEP-SVELTE` | Svelte (peer); `@mini-grid/svelte` adapter; no auth | as above | capability-degrading (Svelte consumers) | **`^4 \|\| ^5`** |
| `DEP-XLSX` | **exceljs** (MIT); invoked only by `LIB-EXPORT.exportXlsx`; **lazy-loaded** (dynamic `import()`) so only xlsx users pay the bundle; no auth | absent/import-fail → `XLSX_UNAVAILABLE` (reject + `EVT-ERROR`); **CSV export still works** | fail-soft (one export format) | **`^4`** |

All three framework adapters ship in **v1** (operator-decided). CSV export needs **no** dependency.

### Data mapping (external ↔ `ENTITY-*`)
**`DEP-XLSX` (exceljs)** — grid → workbook, mapping the **resolved** cell state (Domain style cascade):
| Grid | exceljs |
|---|---|
| `cell.value` (typed) | `cell.value` (number/string/Date/boolean) |
| `formatMask` (`CAP-FMT-VALUE`) | `cell.numFmt` |
| `CellStyle.textColor` / `fontFamily`/`fontSize`/`fontWeight`/`italic`/`underline` | `cell.font` |
| `CellStyle.fillColor` | `cell.fill` (pattern `solid`, `fgColor`) |
| `CellStyle.borders` (per side/style/color) | `cell.border` |
| `CellStyle.align`/`wrap`/`indent` | `cell.alignment` |
| `MERGE-REGION` | `worksheet.mergeCells` |
| `FREEZE-PANE` | `worksheet.views` (frozen) |
| column `width` | `column.width` |

Conditional-format **resolved** styles export as concrete cell styles. **CSV** — values only, TSV/CSV escaping + `SEC-EXPORT-FORMULA-GUARD`. Export scope = current sorted/filtered view by default (`allData` opt).

### Fidelity substitution
`DEP-XLSX` is **faked** in unit tests (a stub asserting the mapping calls); a real exceljs round-trip runs in a component/E2E test. Framework peer-deps are exercised via adapter test suites in a real browser. No prod/dev fidelity axis (client library, no infra).

## Open Questions
- Framework peer ranges confirmed and shipped (slice 10): React `^18||^19` (createRoot ≥18), Vue `^3.3`, Svelte `^4||^5`. (Resolved.)

## Dependencies & Cross-references
- **Feeds:** Governance `license-ip-compliance` (exceljs MIT; framework peers MIT — all cleared). **Applies:** `PATTERN-ERROR` (failure surfacing), `SEC-EXPORT-FORMULA-GUARD` (export).
- **Maps to:** `ENTITY-*`, `CellStyle`, `MERGE-REGION`, `FREEZE-PANE` (Domain) for export.

## Examples / Worked scenarios
- *xlsx lazy + fail-soft:* first `exportXlsx()` dynamically imports exceljs; if the import fails, it rejects with `XLSX_UNAVAILABLE` + `EVT-ERROR` while `exportCsv()` keeps working.
- *Styled export:* a red-fill conditional-format cell exports with `cell.fill.fgColor` red in the .xlsx (resolved-style mapping).

## Design Decisions
| Decision | Rationale |
|---|---|
| Frameworks as peer-deps; zero required runtime deps in core | Framework-agnostic reach + plain-HTML + resilience. |
| `DEP-XLSX` = **exceljs**, lazy-loaded, fail-soft | MIT + full cell-style fidelity (unlike SheetJS community, which can't write styles); only xlsx users pay the bundle. |
| CSV dependency-free | The common export path needs no third party. |
| All three adapters in v1 | Operator-decided; widest reach at launch. |

## Contracts
The four `DEP-*` entries (contract + auth + failure/fallback + criticality + fidelity substitution + version pin) and the xlsx/CSV **data-mapping** table above are the contracts.

## Acceptance criteria
- **AC-DEP-OPTIONAL:** the core mounts and runs in plain HTML with **no** framework and **no** xlsx lib present.
- **AC-XLSX-FAILSOFT:** with exceljs unavailable, `exportXlsx` rejects `XLSX_UNAVAILABLE` (+ `EVT-ERROR`) and `exportCsv` still succeeds.
- **AC-XLSX-MAPPING:** an exported .xlsx round-trips value + number format + font/fill/border/alignment + merges + frozen panes (component/E2E).
- **AC-LICENSE:** the CI license-scan (Governance) passes — all deps MIT-compatible (exceljs MIT; frameworks MIT).

