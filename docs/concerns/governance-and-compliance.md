---
artifact: product-doc
role: concern
concern-id: governance-and-compliance
behavior: baseline
trigger: always
in-scope-subaspects: [license-ip-compliance, data-handling-policy]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Governance & Compliance — mini-grid

> One-line: an unregulated, MIT-licensed client library — governance reduces to license/IP hygiene and a one-paragraph client-side data-handling policy. Mostly scoped out.

## Purpose & Scope

Owns licensing/IP compliance and the data-handling policy (`POLICY-*`). Completes the facts→policy→mechanism chain: Domain has no field tags (host data) → Governance sets a uniform client-side policy → Security implements it (escape/no-log). This concern is **mostly scoped out**; it reaches Contract-grade by asserting the narrow residual.

## Non-goals / Out-of-scope
- `audit-requirements` — *(absent)* no audit obligations for an OSS UI library (no accounts, no server trail).
- `compliance-framework-mapping` — *(absent)* unregulated (no GDPR/HIPAA/PCI/SOC scope of its own).
- `records-retention-data-residency` — *(absent)* the grid stores/retains no data; residency is the host's concern.
- `consent-management` — *(absent)* collects no personal data; no consent surface.

## Requirements

### License / IP compliance (`license-ip-compliance`)
- **Product's own outbound license stance:** **MIT** (permissive, distributed) — stated as a deliberate contract, not merely inbound.
- **Inbound dependency-license inventory** (from Integrations `DEP-*`): `DEP-REACT` **MIT**, `DEP-VUE` **MIT**, `DEP-SVELTE` **MIT**, `DEP-XLSX` = **exceljs, MIT** — all cleared. **Enforcement:** a **CI license-scan** (e.g. license-checker) fails the build on any non-permissive (non-MIT/BSD/Apache-2.0/ISC) dependency license — the standing contract as deps evolve.
- MIT copyright/attribution notice retained in distributed artifacts.

### Data-handling policy (`POLICY-DATA-HANDLING`)
mini-grid processes host-provided data **entirely client-side**: it does **not transmit, persist, or share** cell data (realized by Security `SEC-NO-EGRESS`/`SEC-NO-PERSIST`/`SEC-NO-LOG-VALUES`). Sensitive-value safety is uniform (no field-level tags) — escape-by-default + no value logging. The host remains the data controller and owns any residency/retention/consent obligations.

## Open Questions
- None blocking. (xlsx lib resolved: exceljs, MIT — cleared.)

## Dependencies & Cross-references
- **Consumes:** Integrations `DEP-*` (dependency licenses); Domain classification stance (no tags → uniform policy).
- **Realized by:** Security `SEC-*` (the client-side no-transmit/no-store mechanisms). **Feeds:** Business & Legal (`LICENSE-TIER-*` = MIT).

## Examples / Worked scenarios
- *Policy in action:* a host renders PII in cells; `POLICY-DATA-HANDLING` guarantees the grid neither logs nor transmits those values — verifiable by the `SEC-*` static scan (Quality).

## Design Decisions
| Decision | Rationale |
|---|---|
| MIT outbound license, stated as a contract | Permissive OSS distribution; the stance is explicit, not implied. |
| Uniform client-side data-handling policy | No field tags (host data) → one policy covers all values; mechanism owned by Security. |
| Regulatory/audit/retention/consent scoped out (absent) | Unregulated, storage-less client library; the trait facts justify. |

## Contracts
- **`POLICY-DATA-HANDLING`** (final): mini-grid processes host data **entirely client-side**; it does not transmit, persist, or share cell data. Realized by `SEC-NO-EGRESS`/`-NO-PERSIST`/`-NO-LOG-VALUES`; the host is the data controller.
- **Outbound license:** MIT. **Inbound:** the dependency-license inventory above + the CI license-scan gate.

## Acceptance criteria
Residual-scope assertion complete: **(1)** MIT outbound + dependency MIT-compat inventory stated, enforced by CI license-scan; **(2)** client-side no-transmit/no-store `POLICY-DATA-HANDLING` stated, checkable via the `SEC-*` static scan; **(3)** the four scoped-out keys (`audit-requirements`, `compliance-framework-mapping`, `records-retention-data-residency`, `consent-management`) match the manifest's `out_of_scope_subaspects`; **(4)** every in-scope assertion has a check (license-scan / `SEC-*` scan).

