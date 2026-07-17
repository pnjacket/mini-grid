---
artifact: product-doc
role: concern
concern-id: business-and-legal
behavior: module
trigger: commercial (distributed package)
in-scope-subaspects: [commercial-licensing-model-tiers, ip-trademark-constraints]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Business & Legal — mini-grid

> One-line: a free, MIT-licensed OSS component — a single tier, no pricing, no SLAs, no contracts. This concern exists to assert that residual precisely.

## Purpose & Scope

Owns the licensing/distribution model (`LICENSE-TIER-*`) and IP/trademark constraints (`LEGAL-*`). **Mostly scoped out**; reaches Contract-grade via the residual-scope checklist.

## Non-goals / Out-of-scope
- `tier-capability-entitlements-limits` — *(absent)* single free tier; no entitlement gating.
- `pricing` — *(absent)* free OSS.
- `eula-tos` — *(absent)* governed solely by the MIT license.
- `business-slas` — *(absent)* no support SLA for an OSS library.
- `contractual-agreements` — *(absent)* no commercial contracts.

## Requirements

### Commercial / licensing model (`LICENSE-TIER-OSS`)
Distributed as a **free, MIT-licensed** package (monorepo: `@mini-grid/core` + the three adapters, lockstep-versioned). **A single tier** — **all `CAP-*` available**, no paid gating, no usage limits. (Feature flags are a developer capability, `CAP-FEATURE-FLAGS` — not a commercial entitlement mechanism.) Contrast Governance, which owns dependency-license *compliance*.

### IP / trademark constraints (`LEGAL-*`)
- `LEGAL-ATTRIBUTION` — MIT copyright/attribution notice retained in all distributed artifacts.
- `LEGAL-NAME` — project/package name **"mini-grid"**. **Check:** a **manual pre-publish clearance** (npm name availability + trademark search) — not automatable, so recorded as a Quality accountability item (`n/a — manual`). **[REVISIT] must be cleared before the first npm publish** (Delivery release gate).

## Open Questions
- npm package name availability / trademark for "mini-grid". [REVISIT]

## Dependencies & Cross-references
- **Consumes:** Governance `license-ip-compliance` (MIT + dep compatibility). **References:** `CAP-*` (all included in the single tier).

## Examples / Worked scenarios
- *Single tier:* every capability (editing, conditional formatting, export, merge/group, adapters) is available to every user at no cost; there is no entitlement check to build.

## Design Decisions
| Decision | Rationale |
|---|---|
| MIT, single free tier, no gating | Maximal OSS adoption; no monetization in scope. |
| Trademark/attribution stated as `LEGAL-*` | Even a permissive OSS project carries attribution + name-clearance obligations. |

## Contracts
- **`LICENSE-TIER-OSS`** — free, MIT, single tier; **all `CAP-*` included**; no gating/limits/pricing.
- **`LEGAL-ATTRIBUTION`** — MIT copyright/attribution notice retained in every distributed artifact. **Check:** a `LICENSE` file present + attribution in published packages (release-gate lint).
- **`LEGAL-NAME`** — "mini-grid"; manual pre-publish clearance (above).

## Acceptance criteria
Residual-scope assertion complete: **(1)** MIT single-free-tier stated (all caps included, no entitlement check to build); **(2)** the five scoped-out keys (`tier-capability-entitlements-limits`, `pricing`, `eula-tos`, `business-slas`, `contractual-agreements`) match the manifest's `out_of_scope_subaspects`; **(3)** `LEGAL-ATTRIBUTION` present (LICENSE-file check) and `LEGAL-NAME` clearance tracked as a pre-publish manual gate.

