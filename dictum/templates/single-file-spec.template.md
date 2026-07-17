---
artifact: product-doc
role: single-file-spec            # all in-scope concerns in one file (small products / CLIs)
product: <Product Name>
status: draft
version: 0.1.0
# Per-concern rung tracking lives in the manifest; this file holds the content.
---

# <Product Name> — Specification

<!-- BUILD: Single-file packaging for small products. Each concern below is a section instead of its own file.
     Keep the always-present concerns; add Module sections only if their trigger fires (see manifest).
     For each concern, consult ../concerns/11.x-*.md for sub-aspects, owned-contract IDs, and the Contract-grade bar.
     Within each concern, fill: Purpose/Non-goals → Requirements → Contracts → Acceptance, as you climb rungs. -->

## 1. Product & Requirements
<!-- BUILD: problem · personas (PERSONA-###) · success criteria (SUCCESS-###, measurable) · capability register (CAP-###) · non-goals -->

## 2. Domain & Data
<!-- BUILD: entities (ENTITY-###) + types + identifiers · invariants (INV-###, checkable) · classification tags · storage (if persisted) -->

## 3. Architecture
<!-- BUILD: components (COMPONENT-###) · cross-cutting patterns (PATTERN-###) · key decisions (ADR-###) -->

## 4. Interfaces & Contracts
<!-- BUILD: per element API/CLI/LIB/EVT-### — signature + typed I/O (ref ENTITY-###) + errors + pre/postconditions + owning COMPONENT + served CAP -->

## 5. Quality & Testing
<!-- BUILD: coverage map over CAP/INV/API · E2E-STANDARD (own code real; externals substitutable) · quality bars · test-data strategy -->

## 6. Delivery Process
<!-- BUILD: slice rule + DoD · work-item hierarchy/slice-level · build playbook · build-ready gate scope · fidelity-staged DoD (merge/release) -->

## 7. Security & Privacy            <!-- Baseline: minimal by default; depth scales with risk -->
<!-- BUILD: trust boundaries + secrets always; + roles (ROLE-###) + per-interface authz + field protection when risk warrants -->

## 8. Governance & Compliance       <!-- Baseline: license/IP baseline always; framework mapping when regulated -->
<!-- BUILD: license/IP always; + data-handling policy (POLICY-### per tag) + audit policy + framework→control map when regulated -->

<!-- Add Module sections only when triggered:
## User Experience (UI)                 — SCREEN-###/ROUTE-### nav contract; binds CAP+API+ROLE; states; journeys
## Operations & Infrastructure (service) — ENV-### + fidelity map; per-COMPONENT deploy; runbooks
## Observability & Monitoring (service)  — per-COMPONENT telemetry; SLO-###; audit trail mechanism
## Integrations & External Deps (deps)   — DEP-### per external; failure/fallback; fidelity substitution
## Performance & Scalability (perf)      — PERF-### targets + load profiles + scaling strategy
## Accessibility & i18n (UI / locales)   — WCAG per SCREEN-###; i18n surface if multi-locale
## Business & Legal (commercial)         — LICENSE-TIER-### → CAP entitlements; EULA/ToS; SLAs
-->
