---
artifact: documentation-standard
role: template
status: draft
version: 0.4.0
---

# Product-Profile Manifest — Template

The single machine-readable source of truth for a product's doc set: traits (which modules apply), packaging, and each concern's scope + documentation rung. The human-facing index/README is **derived** from this. Copy the block below to `manifest.yaml` (or keep inline) and fill it in during Intake.

> **Doc maturity only.** Implementation status (the **Verified** rung — which slices are built & proven, at which fidelity stage) is tracked **separately by Delivery Process**, not here.

```yaml
product: <Product Name>
packaging: per-concern            # per-concern | single-file
authoring_granularity: fine       # fine | grouped — the PRIMARY contract grain. `fine` = one contract per
                                  # endpoint/entity/component (maximal explicit context, each independently
                                  # drift-checkable); a coarse CAP/resource index is synthesized OVER the fine
                                  # contracts either way (owned-once at each level, linked by the reference web).
                                  # Granularity is a view over one linked structure, not a lossy roll-up (Part 10f).
                                  # May be overridden per-concern in a concern's front-matter.

# Optional. Present only when the set was REVERSE-AUTHORED from existing code (Part 10f, doc-excavate)
# rather than authored doc-first — so consumers know it is an as-built baseline whose intent-level
# sections were interviewed/inferred, not specified up front. Omit for greenfield sets.
# provenance: { authored: reverse-from-code, base_ref: <commit/tag>, by: doc-excavate }

# Traits captured at intake — these switch Module concerns on.
traits:
  interface_kinds: []             # cli | http | library | events | ui
  interactive_ui: false           # → User Experience, Accessibility(a11y)
  deployed_service: false         # → Operations, Observability
  persists_data: true             # → deepens Domain & Data
  third_party_deps: false         # → Integrations
  perf_scale_needs: false         # → Performance & Scalability
  multi_locale: false             # → Internationalization
  commercial: false               # → Business & Legal
  regulated: false                # → deepens Governance & Compliance
  security_risk: []               # auth | pii | secrets | network → deepens Security

# One entry per concern. in_scope=false ⇒ omit/Absent. Always-present = Core + Baseline.
# out_of_scope_subaspects keys = the published `key` column of that concern spec's "Sub-aspects"
# table (Part 9), e.g. `migrations-versioning`, `authorization`, `encryption`; not free-form
# strings and not re-derived — copy the canonical key from the spec.
# Each entry's justification (in the doc's Non-goals) records its KIND (Part 9): `absent` (the subject
# doesn't exist in the product — the trait fact justifies; no re-entry note) vs `deferred` (calibrated
# out of this effort — a [FUTURE-SCOPE] re-entry note is owed).
concerns:
  product-and-requirements:  { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  domain-and-data:           { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  architecture:              { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  interfaces-and-contracts:  { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  quality-and-testing:       { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  delivery-process:          { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  security-and-privacy:      { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  governance-and-compliance: { in_scope: true,  current_rung: sketch, target_rung: contract-grade, out_of_scope_subaspects: [] }
  user-experience:           { in_scope: false }   # interactive_ui
  operations-and-infrastructure: { in_scope: false }   # deployed_service
  observability-and-monitoring:  { in_scope: false }   # deployed_service
  integrations-and-external-dependencies: { in_scope: false }   # third_party_deps
  performance-and-scalability:   { in_scope: false }   # perf_scale_needs
  accessibility-and-internationalization: { in_scope: false }   # a11y: interactive_ui ; i18n: multi_locale
  business-and-legal:        { in_scope: false }   # commercial

# Enhancement lifecycle (Part 10d) — CURRENT state only; change history lives in git.
# Both default empty; populated/cleared by the doc-change-impact skill. The reverse-
# reference (change-impact) graph is NEVER stored here — it is derived each run.
reference_granularity: entity     # entity | field — reverse-reference PROPAGATION only (independent of binding-map field locators)
tombstones:                       # retired IDs (never reused/renamed)
  # CAP-OLD-EXPORT: { retired_in: <commit/PR>, superseded_by: [CAP-DATA-EXPORT] }
staleness:                        # contract ID -> cause-attributed set of change-event ids
  # SCREEN-007: [<commit/PR-1>, <commit/PR-2>]   # clears only when the list is empty
```

## Build-ready check (derived)

The doc set is **build-ready** when every `in_scope: true` concern has `current_rung: contract-grade` (its `target_rung`). The maturity-audit agent computes this and flags any concern whose claimed rung outruns its actual section completeness.

Separately (Part 10d), a non-empty `staleness` entry on an in-scope contract **blocks the release gate** — without lowering any rung — until reconciled or waived.
