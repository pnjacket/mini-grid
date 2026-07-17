---
artifact: product-doc
role: concern
concern-id: delivery-process
behavior: core
trigger: always
in-scope-subaspects: [vertical-slice-rule-slice-types, definition-of-done, build-playbook-sequence, work-item-hierarchy-slice-level, external-tracker-binding, build-ready-gate-scope, verified-build-status-tracking, branching-release-versioning]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Delivery Process — mini-grid

> One-line: vertical slices (headless foundation → cross-cutting worker/error/flag layer → capability slices → hardening), a fidelity-staged DoD (merge gate split: typecheck/build/unit on GitHub Actions, E2E + perf on the reference machine; release gate = npm publish), GitHub-issue slices as a repo→tracker execution mirror, lockstep Changesets releases, and an in-repo build-status record.

## Purpose & Scope

Owns the process spine and the **Verified** build-status record (`IMPLEMENTATION.md`), kept separate from the manifest's doc rung. References `E2E-STANDARD` + the coverage gate (Quality) for proof-of-done.

## Non-goals / Out-of-scope
- None scoped out. No `SLICE-*` ID web (slices are process artifacts).

## Requirements

### Vertical-slice rule + slice types
A slice is a vertical cut (data model → worker/API → render → test) ending in a **verified, demoable increment** — not a per-`CAP-*` bijection. Types:
- **`slice:headless`** — foundation (core store, virtualization engine, worker `MSG-*` protocol); may precede the first UI journey.
- **`slice:full`** — a capability end-to-end **including its real-flow E2E**.
- **Cross-cutting / infrastructure slice** — shared path (error envelope `ERR-*` + feature-flag registry + event bus). Maps to several `CAP-*`.
- **Verification-only slice** — proof over built surface (perf-calibration spike; hardening battery).

### Definition of Done — fidelity-staged
**Merge gate** (per PR — the bar for code entering `main`. Since the **2026-07-03 CI split** the ten items run split across two surfaces: **GitHub Actions CI** runs typecheck + build + unit — including the `SEC-*` static scan over the built bundle — and **`E2E-STANDARD` + the `PERF-*` budgets run pre-merge on the reference machine**, not in CI; see Quality & Testing. Every merge is still gated on all ten):
1. Unit + component green (Vitest).
2. The touched capability's **real-flow E2E** green (Playwright, real Chromium).
3. **axe** zero violations on the touched surface.
4. **Perf budget not regressed** for the touched surface (reference machine; measurement tier — re-run per the Quality/Perf policy).
5. **Feature toggle honored ON and OFF** for the touched feature.
6. `.d.ts` exported + `tsc` typecheck passes.
7. **Escape-by-default upheld** — no new HTML-string sink (lint/review; `SEC-RENDERER-DOM-ONLY`).
8. **Coverage gate:** every touched in-scope ID maps to a passing test (or an accountability row); `AC-MAP-TOTAL` holds.
9. Touched contract IDs referenced in the issue; the owning concern doc(s) updated for the delta.
10. **Substitution set (stated, not omitted):** the only substitutable external is the **xlsx lib** (faked in unit tests). **No infra externals; nothing else substituted** (Operations absent — no external fidelity map).

**Release gate** (per release, degenerate — no real infra):
1. Full suite green on `main`.
2. **Cross-browser (Chrome/Firefox/Safari) + touch/tablet smoke** pass.
3. **Changesets** version bump + changelog; **lockstep publish** of `@mini-grid/core` + the three adapters.
4. **Build artifacts:** ESM + standalone UMD (worker inlined) produced; `SEC-*` static scan (no `fetch`/storage/`eval` in core) passes.
5. Serialized-state `version` compatibility check.
6. **Docs & demo:** README + TypeDoc API reference build clean; **docs examples typecheck/compile**; the demo page builds and is deployed (GitHub Pages).

### Build playbook / sequence (capability-granular E2E; foundations may precede first journey)
0. **Perf-calibration spike** *(verification-only)* — harness + 1M-row benchmark → sets `PERF-*`; settles worker seam timing.
1. **Headless foundation** *(slice:headless)* — core store + variable-height virtualization + main↔worker `MSG-*` + data load/window (read-only large dataset renders).
2. **Cross-cutting slice** *(slice:full, infra)* — error envelope (`ERR-*`), feature-flag registry, vetoable event bus.
3. **First UI journey** *(slice:full)* — render + scroll + selection + keyboard/ARIA → `CAP-VIRTUALIZE`/`-SELECT`/`-A11Y`.
4. **Editing** — `CAP-EDIT` (incl. row/col CRUD) + `CAP-VALIDATE` + `CAP-UNDO`.
5. **Formatting** — `CAP-FMT-CELL`/`-FMT-VALUE`/`-COND-FMT` (+ worker aggregates) + `CAP-THEME`.
6. **Worksheet fns** — `CAP-SORT`/`-FILTER` → `CAP-RESIZE`/`-REORDER`/`-FREEZE` → `CAP-MERGE`/`-GROUP` (last; highest complexity × virtualization).
7. **Clipboard** — `CAP-CLIPBOARD`.
8. **Export + state** — `CAP-EXPORT`, `CAP-PERSIST-STATE`.
9. **i18n / RTL** — `CAP-I18N`.
10. **Framework adapters** — React, Vue, Svelte (`COMPONENT-ADAPTER-*`).
11. **Hardening** *(verification-only)* — a11y battery (WCAG 2.1 AA), security battery (XSS/paste/export/static-scan), feature-flag pairwise matrix.
12. **Docs & demo** *(deliverable slice)* — the **kitchen-sink demo page** (all features + toggles; doubles as the Quality E2E/manual-exploratory harness; deployed to GitHub Pages) + **developer docs**: README/getting-started + **TypeDoc API reference** (generated from `.d.ts`) + usage guides. Realizes `SUCCESS-DX`. **[REVISIT]** single-page viability — may split into focused example pages if unwieldy; **escalate to a thin single-file doc-spec only if it becomes a hosted docs *site* with its own IA.**
Manuals/cross-browser last. No `CAP-*` completes without its real-flow E2E.

**Deliverables beyond the library:** the demo page and developer documentation are **artifacts** (not `CAP-*`), owned as this slice; the demo also serves Quality as the harness surface.

### Work-item hierarchy & slice level
**GitHub Issues.** Epic = a milestone/label per playbook phase; **slice level = issue**. Each issue references the IDs it touches (`CAP-*`, `COMPONENT-*`, `LIB-*`/`EVT-*`) and links its build-status row. **In-repo `IMPLEMENTATION.md` is the authoritative Verified record**; GitHub Issues track work (the tracker-binding declaration below governs the boundary).

### External tracker binding (`external-tracker-binding`)
**Channel: GitHub Issues** — an external tracker mirrors this build (slice = issue, per the hierarchy above). The binding is a thin, product-local adapter (11.6 spec / STANDARD Part 10c):
- **ID-carrying channel:** an issue carries the repo contract IDs it touches (`CAP-*`, `COMPONENT-*`, `LIB-*`/`EVT-*`) **verbatim in its body** — the item *references* a contract, never restates it. The repo stores **no** issue number/URL back-reference; the stable ID is the only join, resolved at projection time.
- **Projection direction — repo→tracker only:** issues are derived from the build playbook and closed against their `IMPLEMENTATION.md` build-status rows. The tracker is a **downstream mirror of what the repo owns**; contracts and `Verified`/build-status stay **repo-authoritative**.
- **Reconciliation — repo-wins:** a divergent tracker edit is a convenience note, never a source; on conflict the repo record stands.

**Item roles** (transitions of one item — the role is fixed by whether the item yet references a Contract-grade repo ID):
- **Execution** — *the role in active use here*: every slice issue references its contract IDs and links its build-status row (the mirrored, buildable role).
- **Demand** — a request for new/changed behavior. **No current usage:** to date every new-behavior request entered doc-first as a `doc-feature` delta (v1.1–v1.7); a demand item arriving in the tracker would be ingested the same way (`doc-feature`) before earning contract IDs.
- **Triage** — an unadjudicated defect hypothesis. **No current usage:** defects to date (e.g. the v1.1 editor fixes, the v1.4.1 header-interaction bugs) were found in-repo (demo/E2E) and adjudicated directly; an externally-reported bug would sit repo-invisible in the tracker until **reproduced**, then enter as an externally-sourced `drift`-type change event (Part 10d).

**Gates** (the downstream-mirror invariant, Part 10c):
- **Build gate:** no tracker item is built until it references a repo contract ID at **Contract-grade** (slice issues satisfy this by construction — the playbook derives them from Contract-grade `CAP-*`).
- **Write gate:** a suspected defect earns its **first repo write only on reproduction + adjudication**; a code-defect verdict revokes the affected `Verified` row in `IMPLEMENTATION.md` via a regression case and leaves the contract text untouched.

### Build-ready gate scope
v1 gate = **every in-scope `CAP-*` at Contract-grade** (single sheet, client-side ops, merge/group + row/col CRUD included). **Outside the v1 gate ([FUTURE-SCOPE] v2):** async/server DataSource adapter, multi-sheet/workbook, server-side op delegation, crash-recovery edit-replay.

### Verified / build-status tracking
The **build-status record** is `IMPLEMENTATION.md` (instantiated from `dictum/templates/build-status.template.md`), one row per slice: built · verified (stage: **merge** = local/reference-machine; **release** = published) · proof (`E2E-STANDARD`/test id). **Separate from the manifest's doc rung.** The record is **populated**: the v1 grid + the v1.1–v1.7 deltas (including the `CAP-FORMULA` engine and its 475-function catalog) are built and merge-verified — see `IMPLEMENTATION.md`.

### Branching / release / versioning
Trunk-based: short-lived feature branch per issue → PR → `main` (confirmed). CI: **GitHub Actions** runs typecheck + build + unit (build before test — several unit tests scan the built bundle); **E2E (`E2E-STANDARD`) + the perf tier run pre-merge on the reference machine** (the 2026-07-03 CI split — see Quality & Testing). **Lockstep single version** across core + adapters via **Changesets**; one changelog; **SemVer**. Serialized-state `version` (Interfaces) bumps independently within a release.

## Open Questions
- None open.

**Resolved (2026-07-03 CI split):** the perf tier — and `E2E-STANDARD` with it — runs **pre-merge on the reference machine**, not in GitHub Actions (CI runners are noisy and lack the browser/hardware budget); GitHub Actions is scoped to typecheck + build + unit. Recorded in Quality & Testing; a CI-resourcing choice, not a coverage reduction.

## Dependencies & Cross-references
- **References:** `E2E-STANDARD` + coverage gate (Quality) for proof-of-done; `CAP-*` (slices realize), `COMPONENT-*` (slices map to), `LIB-*`/`EVT-*` (issues reference), `PERF-*` (merge-gate budget).
- **Note:** the Operations fidelity map the staged DoD would reference is **absent** → substitution set stated empty-but-for-xlsx.

## Examples / Worked scenarios
- *Cross-cutting slice:* worker `MSG-*` + error envelope + feature-flag registry ship as one `slice:full`, verified end-to-end; editing/sort/filter slices ride that path after.
- *Capability slice DoD:* `CAP-SORT` issue → worker index + `LIB-SORT` async API + header UI + a real-flow E2E asserting reorder — merged only when the 10 merge-gate items pass on GitHub Actions + the reference machine.

## Design Decisions
| Decision | Rationale |
|---|---|
| Headless foundation + cross-cutting slice precede capability slices | Shared path everything rides; build first to avoid rework. |
| Merge/group + col-CRUD sequenced late | Highest complexity × virtualization; land on a proven base. |
| Release gate degenerate (npm + cross-browser, no infra) | Ops absent; no real-infra stage. |
| GitHub Issues (slice=issue), GitHub Actions, Changesets, lockstep | Operator-chosen; coherent monorepo toolchain. |
| `IMPLEMENTATION.md` is the authoritative Verified record | Doc maturity (manifest) ≠ implementation status; kept separate + in-repo. |
| *(2026-07-12)* `external-tracker-binding` brought **in scope**; GitHub Issues declared as a repo→tracker **execution mirror** (channel + three roles + two gates, Part 10c) | The build *is* mirrored to GitHub Issues (slice = issue), so the v1.0.0 sub-aspect applies — declared rather than left implicitly absent. Demand/triage have **no current usage** and are stated so (grounded in how this repo actually works), not invented as process. |
| *(2026-07-12)* Merge-gate wording aligned to the 2026-07-03 CI split (Actions = typecheck/build/unit; reference machine = E2E/perf) | The gate bar is unchanged — only *where* each item runs; the doc had drifted behind the decision already recorded in Quality & Testing and `IMPLEMENTATION.md`. |

## Contracts
The slice rule + slice types, the fidelity-staged **DoD checklist**, the **build playbook**, the **hierarchy declaration**, the **tracker-binding declaration** (channel + roles + gates), the **build-ready gate scope**, and the **`IMPLEMENTATION.md` build-status record** above are the contracts. No `SLICE-*` ID web.

## Acceptance criteria
- **AC-DOD:** no PR merges to `main` unless all 10 merge-gate items pass — typecheck/build/unit (incl. the `SEC-*` static scan) on GitHub Actions CI, `E2E-STANDARD` + the `PERF-*` budgets on the reference machine (the 2026-07-03 CI split).
- **AC-TRACKER-BIND:** every tracker (GitHub-issue) item that reaches build references at least one Contract-grade repo contract ID verbatim, and no repo file stores an issue number/URL; a defect issue produces a repo write only after reproduction + adjudication.
- **AC-BUILD-STATUS:** every in-scope `CAP-*` has a row in `IMPLEMENTATION.md`; none is marked Verified without its `E2E-STANDARD` proof.
- **AC-GATE-SCOPE:** the v1 build-ready gate covers exactly the in-scope Contract-grade `CAP-*`; v2 items are excluded and labeled.
- **AC-RELEASE:** a release publishes core + 3 adapters at one lockstep version via Changesets, with ESM + UMD artifacts and a passing `SEC-*` static scan.

