---
name: doc-change-impact
description: Use when a contract in a documentation set changes, is added to, or is retired, to propagate the change along the ID web under the Documentation Standard (Part 10d). Computes who is affected, challenges an understated classification, writes cause-attributed staleness + markers, and manages tombstones. Triggers - "what breaks if I change API-012", "propagate this contract change", "retire CAP-OLD-EXPORT", "reconcile the stale docs".
---

# doc-change-impact

Operationalizes the standard's **Enhancement Lifecycle** (STANDARD Part 10d). Given a changeset against the doc set, it propagates the change one hop along the **ID web read backwards** — the change-impact graph. Advisory: it proposes the impact set and the writes; the operator confirms. It never blocks.

> The reverse-reference set is **derived every run** (by resolving IDs across the doc set), never read from a stored edge list — a second copy would itself drift (STANDARD Part 0.5).

## Procedure

1. **Identify the changeset.** The set of **change events** since a baseline (a git diff / PR) — each `{ id, source, classification, ref }` per STANDARD Part 10d, with `classification` one of `cosmetic` · `additive` · `breaking` · `retiring`. If a classification is missing, infer it and confirm with the operator. Events with `source: drift` (from the drift-detector, **or a defect filed by a human in an external tracker — the same event shape, sourced externally**) also carry `direction` / `evidence` / `adjudication`. A tracker bug enters as a **triage** hypothesis whose `classification`/`direction` is **proposed until a reproducing case adjudicates it** (STANDARD Part 10c) — **do not act on an unreproduced one** (it earns no repo write). Act only on those adjudicated `doc-stale` / `doc-defect` (a wrong or missing contract → propagate here, or hand a *missing* one to `doc-feature`); leave `code-defect` to Delivery — **no doc change**: the contract stands as the oracle and its `Verified` is revoked via a regression case (build-status, 11.6).
2. **Challenge the classification (integrity check).** Compare each changed contract's structural shape before/after — typed fields, identifiers, enum values, `INV-###` invariants. If a *structural* break is present but the author called it `cosmetic`/`additive`, surface the understatement and propose the higher class. Note the limit: a **semantic** change with no structural footprint is only reliably caught at **Contract-grade+** (where semantics live as checkable `INV-###`); below that, warn that propagation is unreliable (rung-gated fidelity).
3. **Derive the reverse-reference set.** Resolve each changed ID across the doc set (`Grep` for the ID), at the **reference granularity the manifest declares** (entity- vs field-level). This is the impact set. When granularity is ambiguous, prefer the broader (over-flag): a needless re-verify is cheap; a missed break ships.
4. **Propagate — one hop.**
   - `cosmetic` → nothing (an ID's human label is mutable; the ID is not).
   - `additive` → **soft flag**: open an informational `[REVISIT]` at each referencer. Do **not** write staleness; never blocks a gate. Each consumer's own review decides whether it was breaking *for them*.
   - `breaking` → **hard flag**: for each dependent, add the causing change-event id (the commit/PR) to its `staleness` set in the manifest, and open a `[REVISIT]` at the reference site.
   - `retiring` → treat as `breaking`, then write/extend a **tombstone** (with `superseded_by: [ID…]` if a replacement exists). **Enforce the retirement precondition:** refuse to finalize the tombstone while live inbound references remain — list them — unless they retire in the same changeset.
5. **Stop at one hop.** Do not cascade. A flagged dependent propagates further only if *re-examining it* produces a **new** change event (a fresh run). Confirmed-correct ends the chain. A cycle that won't settle is a signal that two contracts should be merged.
6. **Report.** Show the impact set, the proposed staleness writes, markers, and tombstones; confirm before editing. State the release-gate consequence: stale in-scope contracts **block the release gate** (Part 10a) though their **rung is unchanged**.

## Reconcile mode (clearing staleness)

When invoked to reconcile a stale contract:
- Re-examine the dependent against the changed contract; where Verified-rung checks are automated, **re-run** them (re-verify = re-run).
- If reconciled, remove **that one cause** from its `staleness` set and close the corresponding `[REVISIT]`. The flag clears only when the set is **empty** — concurrent changes can't clear each other.
- If reconciling forces the dependent's own contract to change, that is a **new change event** — start a fresh run (step 1) from it.

## Guardrails

- **Derive, never store** the edge list / impact graph (Part 0.5). The manifest holds only current state: `tombstones` + cause-attributed `staleness`. History rides on git.
- **Staleness keeps the rung.** Never lower a rung to represent staleness — it is an orthogonal, clearable signal that blocks the *release gate* only.
- **Don't silently upgrade a classification** — surface the challenge; the operator decides.
- **A waiver is recorded, not deleted.** To ship against a known-stale contract (e.g. a hotfix), downgrade the stale flag to an accountable marker with the waiver rationale; never just clear it.
- **The tracker is a downstream mirror** (STANDARD Part 10c). This skill writes only the repo (contracts + `staleness` + tombstones); it never writes back to a tracker item, and an **unreproduced** bug earns no repo write. An externally-filed bug reaches this skill only once adjudicated `doc-stale`/`doc-defect`.
- **Out of scope (seams left explicit):** cross-product/platform **federation** of the reverse index, and drift **detection** — the `drift-detector` feeds detected code↔doc drift into this same change-event interface (as does a reproduced tracker bug).
