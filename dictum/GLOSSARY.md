---
artifact: documentation-standard
role: standard
status: published
version: 1.0.0
---

# Glossary

Terms used across the Documentation Standard and the concern specs.

## Structure

- **Concern** — one area of software-engineering documentation (e.g. Security & Privacy). The catalog has 15.
- **Concern behavior** — how a concern enters scope: **Core** (always, substantive), **Baseline** (always, minimal default, depth scales with risk), **Module** (absent unless a trait triggers it).
- **Breadth** — *which* concerns and sub-aspects are in scope. Driven by scope.
- **Depth** — *how complete* a concern's doc is. Measured on the maturity ladder.
- **Scope** — the in/out decision, at two granularities: **concern-level** (a whole concern) and **sub-aspect-level** (an aspect within a concern, e.g. error-handling). The *only* calibration lever; covers CLI↔platform and PoC↔production.
- **Scope-out kinds** — `absent` (the subject doesn't exist in the product; the justification is a trait fact; no re-entry owed) vs `deferred` (effort calibration; a `[FUTURE-SCOPE]` re-entry note is owed). Both are recorded under the concern's published sub-aspect key (Std Part 9).

## Maturity

- **Maturity ladder** — the universal 5 rungs: **Absent → Sketch → Specified → Contract-grade │ Verified**.
- **Contract-grade** — the author's finish line: testable acceptance + explicit contracts; an AI can build without guessing.
- **Verified** — built and proven by a real-flow test. Owned by Delivery Process, tracked separately from doc maturity (the **handoff line**).
- **Rung** — one step on the ladder; assigned per concern (concerns may differ).

## Documents & contracts

- **Document contract** — the uniform section skeleton every doc follows; *which sections are complete IS the maturity*.
- **Contract (inter-concern)** — an artifact one concern owns and others reference (e.g. the API surface). **Owned once, referenced everywhere.**
- **Stable ID** — a layout-independent identifier (`CAP-###`, `ENTITY-###`, …) used for cross-references; survives merge/split.
- **ID registry** — the web of stable IDs across concerns, forming end-to-end traceability. Numeric `###` is the default suffix; semantic suffixes are an allowed variant.
- **Forward reference** — a "described-here, minted-by-X" placeholder for a contract its owning concern hasn't minted yet; tightened to the real ID when the producer reaches Contract-grade. The sanctioned authoring-order seam — the consumer never mints the owner's ID (Std Part 5).
- **Contracts-as-bounds** — a contract that *bounds* a deliberately delegated value without fixing it (a min contrast ratio over delegated tokens; a frame budget over chosen algorithms). The bound is the owned, testable contract; the value inside stays the delegate's freedom (Std Part 5).
- **Workload script (`SEQ-###`)** — a contracted input sequence that *is* a real-time/client `PERF-###` target's load condition, standing where "requests/second" would (Performance 11.13).

## Markers & lifecycle

- **Subject marker** — `[GAP]` `[ASSUMPTION]` `[REVISIT]` `[FUTURE-SCOPE]`; about the *product*; stays in published docs.
- **Build marker** — `<!-- BUILD: ... -->`; about *maturing the document*; stripped on publish.
- **Draft / Published** — a doc's `status`; the **publish step** strips build markers and flips it.
- **Product-profile manifest** — the single machine-readable source of truth (traits, in-scope concerns/sub-aspects, locations, rungs, status); the human index is derived from it.
- **Trait / Trigger** — a product characteristic (has-UI, persists-data, multi-tenant, …) that switches modules on.

## Enhancement lifecycle

- **Enhancement lifecycle** — how a doc set is enhanced over the product's life after first publish (deepen, broaden, correct, retire). Adds no new structure; reuses the ID web (Std Part 10d).
- **Change-impact graph** — the ID registry read *backwards*: who must change when a contract changes. Always **derived** (reverse-reference traversal), never a stored edge list.
- **Change event** — the unit of enhancement, raised against an affected stable ID; **source-agnostic** (a doc edit or a detected drift emit the same event).
- **Change classification** — `cosmetic` (no propagation) · `additive` (**soft flag**) · `breaking` (**hard flag**) · `retiring` (breaking + tombstone). Classification is directional — additive to a producer can be breaking to an exhaustive consumer.
- **Soft / hard flag** — soft = informational `[REVISIT]`, never blocks a gate; hard = **staleness**, blocks the release gate.
- **Staleness** — a contract trusted at its rung but with an upstream change unreconciled. A **cause-attributed set** of change-event IDs (not a boolean); clears only when empty. Keeps the rung, blocks the release gate; downgradable by a **recorded waiver**.
- **Tombstone** — the manifest record of a retired ID (IDs are never reused/renamed), optionally `superseded-by` other IDs for split/merge; makes a dangling reference a detectable error.
- **Retirement precondition** — a tombstone can't finalize while live inbound references remain (unless they retire in the same changeset).
- **Drift / drift-detector** — code↔doc divergence after build; a read-only advisory agent (`agents/drift-detector.md`, model A) detects it and emits `source: drift` change events (detection only — it never edits or adjudicates). A deterministic, CI-gradeable detector (model B) is `[FUTURE-SCOPE]`.
- **Adjudication** — the operator's call on a drift event: `doc-stale` (doc realigns, then propagates) · `code-defect` (doc stands, fix the code) · `divergent` (split). The post-build source-of-truth decision.
- **Binding map** — the contract→code index drift detection needs; a stored-but-self-validating artifact recording *underivable* doc↔code correspondence (the one stored edge list Part 0.5 permits). Format: `templates/binding-map.template.md`.
- **Dangling binding** — a binding-map locator that no longer resolves in code; itself emitted as a `source: drift` change event.
- **Coverage gap** — an in-scope Contract-grade+ code-realizable contract with no binding; drift there can't be detected, only flagged (by the maturity-auditor).
- **`binding-stale` finding** — a binding-map locator that no longer resolves; a defect in the *index*, reported separately from code↔doc drift (no direction/adjudication — fix or retire the binding).
- **Undetectable under waiver** — the detector state for a contract whose only verification lies inside a recorded waiver's scope: reported as *unverifiable-here* — distinct from a coverage gap, never silently passed (Std Part 10d).
- **First-build mode** — Part 10e's input mode (c): an empty binding map plus a passed build-ready gate ⇒ the change set is every in-scope, Contract-grade, code-realizable contract, all trivially `build-new`. The whole product as the degenerate delta.
- **Completing slice** — the one slice where a contract's proof lands (Delivery's *Completes* column). Contracts may legitimately span slices, but each has exactly one completing slice (Std Part 10e).

## External tracker boundary

- **Execution mirror (tracker binding)** — the relationship between the repo doc set and an external work-tracker (GitHub Issues, Jira, Azure DevOps). The tracker is a **downstream mirror of what Dictum owns**: contracts and `Verified`/build-status flow **repo→tracker only** and never originate in the tracker, which references contract IDs (owned-once) and stores nothing the repo points back to (Part 0.5). Declared by the **tracker-binding declaration** (Delivery Process 11.6). Live two-way sync is `[FUTURE-SCOPE]`.
- **Tracker item roles** — the three roles one tracker item plays over its life (fixed by whether it yet references a Contract-grade repo ID): **demand** (a request for new/changed behavior — business intent the repo doesn't own; ingested via `doc-feature`), **triage** (an unadjudicated defect hypothesis — repo-invisible until reproduced), **execution** (a slice referencing contract IDs — the mirrored, buildable role).
- **Tracker gates** — the two integrity gates at the boundary: *build* — no item is built until it references a repo contract ID at Contract-grade (a thin brief is never built from, Part 0.6); *write* — a suspected defect earns its first repo write only on reproduction + adjudication (Std Part 10c/10d).
- **Bug as falsification hypothesis** — a filed bug is a claim that observed behavior deviates from the contract (the oracle), not a rival source of truth. Reproduction adjudicates it; a **code-defect** verdict revokes `Verified` via a regression case and leaves the contract text untouched, a **doc-defect** verdict becomes demand. Enters the enhancement lifecycle as an externally-sourced `drift`-type change event (Std Part 10d).

## Reverse-authoring (brownfield bootstrap)

- **Reverse-authoring** — the **code→doc bootstrap** flow: adopting Dictum onto an existing, undocumented repo by reverse-mapping its code into a faithful as-built baseline doc set (Std Part 10f). The brownfield counterpart to the code-blind `doc-scaffold`; the bootstrap that `drift-detector` (10d) and `implementation-planner` (10e) presuppose.
- **Recoverability partition** — the split of concern content by what code can source: **code-derivable** (structure — Architecture, Interfaces, Domain/Data, Delivery, Integrations, Ops, Observability, Quality-mechanics: extracted), **partially derivable** (structure yes, intent no — Product/Requirements, Security, UX, Performance: extracted + interviewed), **not derivable** (Governance, Business/Legal, and — categorically — Non-goals & scope-out kinds: interviewed, never inferred from code). Structure is extracted; intent is interviewed (Std Part 10f).
- **Code-ahead baseline** — the initial state of a retro-adopted repo where every contract is code-ahead (code exists, no doc does). Reverse-authoring resolves it by adopting code-as-built into the docs and minting the binding map at authoring time, establishing the fixpoint drift-detection needs. Existing passing tests are **candidate Verified evidence** for Delivery — the flow never claims the Verified rung.
- **In-code ID annotation** — a recommended build-time convention (`// DICT: <ID>`) tagging a contract's stable ID at its realizing code site. Structure is recoverable from code regardless, but a contract's **identity is not** — the annotation is what lets a later reverse-authoring pass *recover* the author's IDs instead of coining fresh ones; a lightweight, always-in-sync complement to the binding map (Std Part 10f).
- **ID reconciliation** — the step owed when adopting a reverse-authored set onto an *existing* doc web: join the (freshly-coined, often over-fragmented) excavated IDs to the incumbent IDs, write a tombstone-alias table (never reuse/drop an ID), roll up to the incumbent granularity, and flag unmatched for adjudication. Mechanizable if in-code annotations survived, else manual (Std Part 10f). First bootstrap onto an empty web owes none.
- **Authoring granularity** — the *primary* contract grain of a doc set (`fine` = one contract per endpoint/entity/component; `grouped` = coarser). A **controlled view over one linked structure**, not a lossy choice: the reverse flow keeps fine contracts and synthesizes a coarse `CAP`/resource index over them, owned-once at each level and joined by the **reference web**, so both grains resolve. Default `fine` (maximal explicit context for an AI implementer). The real failure is not "too many contracts" but contracts emitted **flat and unlinked** (Std Part 10f).

## Process

- **Packaging** — how required content maps to files (one-file for small, per-concern for large); operator's call, guided by heuristics.
- **Playbook** — the generative phases: Intake → Scaffold → Author-to-rung → Review → Publish.
- **Build-ready gate** — every in-scope concern at Contract-grade; the handoff to implementation.
- **Fidelity-staged DoD** — Done is staged by environment fidelity.
  - **Merge gate** — bar for entering the repo (developer stage, externals substitutable).
  - **Release gate** — full-fidelity validation (real infra, DevOps).
  - **Fidelity map** (`ENV-###`) — per environment, what's real vs an approved substitute. Owned by Operations.
  - **Substitution rule** — own code always real; external deps substitutable. ("Mock S3 yes; bypass login no.") An empty substitution set is stated, not omitted.
  - **Harness affordance** — a declared test-harness capability that substitutes something outside the product's own code; registered per affordance, never silently widened. The **input-device/browser-chrome substitution class** substitutes the user's physical input stack or browser chrome (synthesized pointer-lock deltas/button events, a forced native-Esc) — legitimate with declaration; the product's own input handling stays real (Std Part 10a).
  - **Blocked-by-environment** — the gate-item state when the binding environment is structurally unavailable on the build host: open deferral **plus** a recorded accountable waiver (cause/scope/re-run condition). Never a pass, never a silent skip (Std Part 10a).
  - **Evidence run** — a named **off-gate, non-binding** run of gate suites at the highest fidelity the host can provide: binding assertions off, artifacts tagged with the observed fidelity, contracted gate config untouched. Accumulates honest signal for a blocked gate without turning it green (Std Part 10a).
- **`E2E-STANDARD`** — the real-flow E2E definition (own code real, no bypass), owned by Quality, referenced by Delivery's proof-of-done.

## Claude Code tooling (advisory)

- **Scaffold skill** (`doc-scaffold`) — greenfield: runs intake, writes the manifest, generates the doc set.
- **Excavate skill** (`doc-excavate`) — brownfield: runs the cartographer, then a confirm-and-fill interview, and writes the manifest + doc set + binding map from existing code (Std Part 10f).
- **Cartographer agent** (`code-cartographer`) — read-only; reverse-maps an existing repo into candidate contracts + a draft binding map + a recoverability report (Std Part 10f).
- **Maturity-audit agent** — read-only; reports rungs and gaps.
- **Level-up skill** — co-authors a concern's delta to the next rung.
- **Per-concern specialist agents** — deep on heavy concerns.

## Recurring patterns

- **facts → policy → mechanism** — Domain *tags* data → Governance sets *policy* → Security/Observability implement the *mechanism*.
- **define → enforce** — one concern defines a standard (Quality's `E2E-STANDARD`; Performance's targets); another enforces/measures it (Delivery; Observability).
