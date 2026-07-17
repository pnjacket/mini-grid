---
name: doc-levelup
description: Use to raise one concern's documentation to its next maturity rung (Sketch -> Specified -> Contract-grade) under the Documentation Standard. Triggers - "level up the X docs", "bring X to contract-grade", "fill the gaps in X", "make the security docs build-ready".
---

# doc-levelup

Operationalizes the standard's **Author-to-rung** phase for one concern. Advisory: co-author with the operator; confirm edits.

## Procedure

1. **Load context:** the manifest, the target concern's doc, and its spec (`concerns/11.x-*.md`) — the spec gives the sub-aspects, the owned-contract ID scheme, what each rung MEANS here, and the Contract-grade bar.
2. **Determine current & next rung.** From the doc's front-matter and actual section completeness (sections map to rungs — see STANDARD Part 4).
3. **Identify the gap to the next rung:**
   - which contract sections are missing/incomplete for that rung,
   - unresolved `[GAP]` subject markers and `<!-- BUILD: -->` next-rung notes,
   - for Contract-grade: acceptance criteria that aren't testable, contracts without stable IDs, referenced IDs that don't resolve.
4. **Co-author the delta — operator-led, not skill-led.** Interview to **saturation** (interactive default, STANDARD Part 0.6): drive small rounds of questions off a coverage map (this concern's sub-aspects × each capability's lifecycle/edge/failure/NFR) until a round surfaces nothing new or the operator stops you — don't stop at "inferred enough." Only when running unattended (no operator) may you infer instead of ask, marking every inferred answer `[ASSUMPTION]` for later review.
   - **Open the floor first.** Before filling sections, ask the operator what else matters for this concern that the section structure won't prompt for — an explicit slot to volunteer requirements the questionnaire would never reach.
   - **Walk the unhappy paths.** For every capability/entity in play, don't stop at the happy path. Enumerate its full lifecycle and ask about each transition the operator hasn't covered: not just create/read, but **modify, cancel, undo/reverse, expire, fail, conflict** — and, wherever an **irreversible effect or a third party** is involved, the **responsibility** branches (e.g. an external side effect already dispatched when the action is cancelled; the third party stops responding; a timeout mid-operation). Treat a missing reverse/cancel/failure path as an open question, never a settled "no."
   - Then fill the sections, reusing the cross-concern ID registry (reference, don't duplicate a contract another concern owns).
5. **Surface every inference; never bake a decision silently.** Anything you settle that the operator didn't explicitly state — a default value, an assumed behavior, a whole capability or a lifecycle path scoped *out* — must be (a) written visibly as `[ASSUMPTION]`, or as a confirmed scope-out in *Non-goals* with its Part 9 kind (`deferred` vs `absent`), **and** (b) read back to the operator for an explicit yes/no before it stands. Scoping out a capability (e.g. an undo/retract path) or omitting a lifecycle state (e.g. cancellation) is a product decision that belongs to the operator — propose it, don't assume it. If the operator would be surprised to learn what you chose, you assumed too much.
6. **On reaching Contract-grade**, verify against the concern's Contract-grade bar: every owned contract has a stable ID; every acceptance criterion maps to an observable check; **and every in-scope capability's lifecycle — including its cancel/reverse/failure/conflict paths — is either specified or explicitly, operator-confirmed out-of-scope.** Happy-path-only coverage is not Contract-grade.
7. **Update state:** set `current_rung` in the doc front-matter and the manifest; clear resolved build markers.
8. **Publish (optional):** strip `<!-- BUILD: -->` markers, flip `status: published`, bump the version. Subject markers (`[GAP]` etc.) remain.

## Guardrails
- **Don't make scope or product decisions on the operator's behalf.** When in doubt, ask — or write `[ASSUMPTION]` and surface it for confirmation. Flying the operator blind past a decision (a silent scope-out, an unmodelled cancel/undo path) violates the no-guessing principle even when the *form* (deferred + re-entry note) is correct.
- Right-size via scope, not by weakening Contract-grade: if something's out of scope, record it in *Non-goals*, don't lower the bar.
- Never delete subject markers to "look done" — resolve the underlying gap or leave it visible.
- Keep contracts single-sourced: reference, don't copy.
