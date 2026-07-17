# mini-grid — Documentation Index

> **Derived from [`../manifest.yaml`](../manifest.yaml).** Do not hand-edit scope/rungs here; change the manifest and regenerate. The `doc-maturity-auditor` flags README↔manifest drift.

**Product:** mini-grid — a programmatic, framework-agnostic (TypeScript) JavaScript **data-grid** giving web developers an Excel-worksheet-like presentation and data-entry surface over large datasets, including a first-class **opt-in formula engine** (`CAP-FORMULA`, `formula` flag, default off). Rendered as **virtualized DOM**; every feature independently toggleable.

**Packaging:** per-concern · **Target rung (all in-scope):** contract-grade · **Current:** ✅ **ALL 13 in-scope concerns at contract-grade — the build-ready gate is met** (docs **published**, v1.1.0). Performance's `PERF-*` targets are **calibrated**: the Slice-0 spike is done and six of the eight v1 targets are **frozen from measurement** on the reference machine; `PERF-EDIT-OPEN`/`-COMMIT` and the formula `PERF-RECALC-*` thresholds remain `[PROVISIONAL]` at the owner (see [performance-and-scalability.md](concerns/performance-and-scalability.md)). Build-status record: [IMPLEMENTATION.md](../IMPLEMENTATION.md).

## Traits
`library` + `ui` + `events` · interactive UI · **not** a deployed service · no datastore of its own · third-party deps (framework peer-deps, xlsx export) · **perf/scale** (~1M rows) · **multi-locale** (i18n + RTL) · **commercial/distributed** (MIT) · unregulated

## In-scope concerns (13)

| # | Concern | Behavior | Rung | Doc |
|---|---|---|---|---|
| 11.1 | Product & Requirements | Core | **contract-grade** ✓ | [product-and-requirements.md](concerns/product-and-requirements.md) |
| 11.2 | Domain & Data | Core | **contract-grade** ✓ | [domain-and-data.md](concerns/domain-and-data.md) |
| 11.3 | Architecture | Core | **contract-grade** ✓ | [architecture.md](concerns/architecture.md) |
| 11.4 | Interfaces & Contracts *(library+ui+events)* | Core | **contract-grade** ✓ | [interfaces-and-contracts.md](concerns/interfaces-and-contracts.md) |
| 11.5 | Quality & Testing | Core | **contract-grade** ✓ | [quality-and-testing.md](concerns/quality-and-testing.md) |
| 11.6 | Delivery Process | Core | **contract-grade** ✓ | [delivery-process.md](concerns/delivery-process.md) |
| 11.7 | Security & Privacy *(XSS-focused)* | Baseline | **contract-grade** ✓ | [security-and-privacy.md](concerns/security-and-privacy.md) |
| 11.8 | Governance & Compliance *(mostly scoped out)* | Baseline | **contract-grade** ✓ | [governance-and-compliance.md](concerns/governance-and-compliance.md) |
| 11.9 | User Experience | Module | **contract-grade** ✓ | [user-experience.md](concerns/user-experience.md) |
| 11.12 | Integrations & External Dependencies | Module | **contract-grade** ✓ | [integrations-and-external-dependencies.md](concerns/integrations-and-external-dependencies.md) |
| 11.13 | Performance & Scalability | Module | **contract-grade** ✓ | [performance-and-scalability.md](concerns/performance-and-scalability.md) |
| 11.14 | Accessibility & Internationalization | Module | **contract-grade** ✓ | [accessibility-and-internationalization.md](concerns/accessibility-and-internationalization.md) |
| 11.15 | Business & Legal *(MIT, mostly scoped out)* | Module | **contract-grade** ✓ | [business-and-legal.md](concerns/business-and-legal.md) |

## Absent concerns (2)
- **11.10 Operations & Infrastructure** — no deployed running service (client-side library).
- **11.11 Observability & Monitoring** — no deployed running service.

## Key scope decisions & deferrals
- **Formula engine** — first-class, fully-supported, **opt-in** (`formula` flag, default off so a leading `=` stays literal text unless enabled); see [`formula-support.md`](formula-support.md). **Single sheet** (cross-worksheet references absent for v1).
- **Rendering:** virtualized DOM (chosen over Canvas for testability/E2E + native styling/editing/a11y).
- **Data ops:** client-side sort/filter/paging over an **in-memory** source in v1. **[FUTURE-SCOPE] v2:** async/server-side data-source adapter + server-side op delegation (configurable-per-source, designed as an extension point now).
- **License:** MIT.

## Next step
The doc set is **published** (all 13 concerns Contract-grade) and the product is **built through v1.7** and merge-verified — see [IMPLEMENTATION.md](../IMPLEMENTATION.md). Remaining tracked work:
- **Build the v1.6 spill-surface delta** (public `EVT-SPILL-CHANGE` emission, `LIB-FORMULA-SPILL`, the spill outline + edit-guard — specced in [`formula-support.md`](formula-support.md); run `implementation-planner` on that delta).
- **Release gate** (npm lockstep publish + Pages deploy) — set up, awaiting owner actions (`LEGAL-NAME` clearance, `NPM_TOKEN`, repo public for Pages).
