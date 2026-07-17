---
name: doc-feature
description: Use when ADDING or CHANGING a feature in an existing doc set (doc-as-source-of-truth) — author the change into the owning concern(s) to Contract-grade on the delta, classify it, emit the doc-edit change event(s), wire the ID web, and stub the binding map, so the delta is implementation-ready for the implementation-planner. Triggers - "add a feature to the docs", "spec a new capability / field / endpoint / screen", "change this contract", "edit the doc so we can build it", "ingest a product/tracker request into the docs".
---

# doc-feature

Operationalizes the **doc-led forward flow** (STANDARD Part 10e). The author moves the documentation ahead of the code on purpose; this skill makes that edit *usable for implementation* — Contract-grade on the delta, correctly classified, and wired. Advisory: confirm before writing; **never writes code** (that is Delivery's, after the `implementation-planner`).

Sibling to `doc-levelup`: level-up raises a concern's **depth** (next rung); doc-feature adds/changes a **feature** across **breadth** (new or changed contracts) in an already-Contract-grade set.

## Inputs you rely on
- The Dictum standard: `STANDARD.md` (Part 4 document contract, Part 10d change event, Part 10e), the relevant `concerns/11.x-*.md` (the owning concern's Contract-grade bar + owned-contract ID scheme), the product's `manifest.yaml` and `bindings.yaml`.

## Procedure

1. **Capture intent → locate owners.** State the feature as an outcome — **a request filed in an external tracker (a *demand-role* item, STANDARD Part 10c) is a valid trigger and just *one input* to this step: it *seeds* the interview, never substitutes for it** (a ticket is a thin brief; Part 0.6) — then **interview to saturation** (interactive default, STANDARD Part 0.6) before enumerating contracts: a feature hides as many unasked lifecycle/edge/failure/responsibility requirements as a fresh concern (a "cancel a running job" feature drags in partial completion, already-dispatched side effects, undo, and what a second cancel does). Run small rounds — happy path, then modify/cancel/reverse/expire/fail/conflict and any irreversible-effect/third-party branches — until a round surfaces nothing new or the operator stops you; don't stop at "inferred enough" (unattended runs may infer instead, marking each `[ASSUMPTION]`). Then enumerate which contracts the feature adds or changes and **which concern owns each** (owned-once): a capability → Product (`CAP-###`); an entity/field/rule → Domain (`ENTITY/INV-###`); an endpoint/function → Interfaces (`API/LIB-###`); a screen/journey → UX (`SCREEN/JOURNEY-###`); a component/pattern → Architecture; a role/authz → Security (`ROLE-###`). A cross-layer feature touches several — that is the doc-side of one vertical slice.
2. **Edit each owning concern to Contract-grade ON THE DELTA.** Apply the **document contract** (Part 4) and the concern's Contract-grade bar to *just* the new/changed contract — do not lower the bar for a delta:
   - new `ENTITY` field → type + identifier role (if any) + classification tag (`pii`/`sensitive`/`secret`) + which `INV-###` constrain it;
   - new/changed `API-###` → signature + typed I/O (ref `ENTITY-###`) + error catalog + pre/postconditions + side-effects + owning `COMPONENT-###` + served `CAP-###`;
   - new `CAP-###` → primary persona + a **measurable** `SUCCESS-###` + in/out-of-scope mark;
   - new `INV-###` → a checkable condition;
   - new `SCREEN-###` → route + nav-wiring + guarding `ROLE-###` + realized `CAP` + called `API` + required states (loading/empty/error).
3. **Wire the ID web (owned once, referenced everywhere).** Add the references *from the consuming concerns*: UX screen → API → CAP; Quality coverage map → new `CAP`/`INV` (incl. real-flow E2E for a user-facing CAP); Security per-interface authz for a new `API`; Delivery build-ready gate scope if the feature is in this iteration. Never duplicate a contract another concern owns.
4. **Classify each change + emit the `doc-edit` event(s)** (Part 10d): `cosmetic` (label only — no work) · `additive` (new optional field/enum/capability) · `breaking` (type/invariant/semantic change) · `retiring` (removed → tombstone + supersession). Author intent is **authoritative**. Emit `{ id, source: doc-edit, classification, ref }` per affected ID. For a **breaking** change, run `doc-change-impact` to mark referencing docs stale; for a **retiring** change, add the tombstone and honor the retirement precondition.
5. **Stub the binding map** (`bindings.yaml`). For each **new** code-realizable contract, add its key with an empty/placeholder `locators: []` (or omit it) — the **unbound** new contract is the planner's *build-new* signal; if the map declares a curated `coverage:` subset, decide whether the new contract joins the bound set. For a **changed bound** contract, leave the binding (Delivery updates the locators when code lands). Never point a binding at code that doesn't exist yet.
6. **Update the manifest only if scope changed.** A feature is usually **breadth within an already-Contract-grade concern** — the rung is unchanged. If it brings a previously-out-of-scope sub-aspect into scope, update `out_of_scope_subaspects` (using the concern spec's published `key`). Regenerate the derived README only if the in-scope concern set or rungs changed (usually not).
7. **Hand off.** Report: the emitted change events (id · classification), the new vs changed contract IDs, and any `[GAP]`/`[REVISIT]` the delta exposes. Recommend running **`implementation-planner`** to turn the delta into an ordered build plan, then Delivery Process to build it.

## Guardrails
- **Plan the docs, not the code** — never write implementation code or point a binding at not-yet-existing code.
- **Don't weaken Contract-grade for a delta** — a new field still needs a type; a new endpoint still needs its error catalog and side-effects.
- **Classify honestly** — a type/semantic/invariant change is `breaking`, not `additive`; under-classifying ships a silent break (the `doc-change-impact` skill will challenge an understated classification).
- **Owned once** — a new contract gets exactly one owning concern; others reference it by ID.
- **The ticket is not the contract.** A tracker demand item (or a bug adjudicated to a doc-defect) is *ingested* here; the contract it becomes lives in the repo, owned-once. Nothing is built from the tracker item until it references a **Contract-grade repo ID** (the boundary's *build gate* — 11.6, STANDARD Part 10c), and the repo stores **no back-reference** to the item (Part 0.5).
