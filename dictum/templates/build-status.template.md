---
artifact: documentation-standard
role: template
status: draft
version: 0.3.0
---

# Build-Status Record — Template

The **Verified-rung / implementation-status** record owned by Delivery Process (Concern 11.6, `verified-build-status-tracking`). It is deliberately **separate from the manifest** — *doc maturity ≠ implementation status* (STANDARD Part 3). The manifest tracks how complete the *docs* are; this file tracks what is *built and proven*, and **at which fidelity stage** (STANDARD Part 10a: `merge` = developer/`ENV-DEV`, externals substitutable; `release` = real-infra/`ENV-K3S`-style).

Copy to `IMPLEMENTATION.md` (or wherever Delivery Process points) and keep current as slices land. History rides on git; this holds *current* status only.

## Slices

One row per vertical slice (Delivery Process's slice level — a `CAP-###`, a playbook step, or a sub-issue). `slice:full` ships its screen + API + tests together; `slice:headless` has no UI.

| # | Slice | Type | Realizes (`CAP/COMPONENT/API…`) | Built | Verified (stage) | Proof |
|---|-------|------|----------------------------------|:---:|---|---|
| 1 | <foundation/store + migration + health> | headless | `COMPONENT-…`, `API-HEALTH` | ☐/✅ | merge / release / — | <test or E2E id> |
| 2 | <auth + login screen> | full | `CAP-AUTH`, `API-LOGIN` | | | `E2E-STANDARD` |
| … | | | | | | |

- **Built** — code exists and meets the contract.
- **Verified (stage)** — the slice passed its Definition of Done at that fidelity gate (Quality's `E2E-STANDARD` for `slice:full`). `merge` = passed against local/substituted infra; `release` = passed against real infra. A slice may be `merge` now and `release` later (deferred-but-tracked, never silently skipped).
- **Proof** — the concrete check (a real-flow E2E name, a golden/invariant test id) that demonstrates Verified. A proof that can only land with a later slice is recorded in its row as **`proof owed by slice N`** — an intra-playbook deferral stays visible, never blank. Gate-checked contracts with no binding (POLICY/LEGAL/byte-exact deliverables) record their check here too (see the binding-map template).
- **Revoked Verified (a reproduced defect).** A bug adjudicated **code-defect** (STANDARD Part 10c — the contract was right, the code wasn't) **revokes** the affected slice's `Verified` here via a **failing regression case** (Quality's `E2E-STANDARD` or an `INV` test); the **contract text is untouched** (doc maturity ≠ implementation status). It re-greens when the fix lands. An **unreproduced** bug writes nothing here — the boundary's *write gate* (11.6).

## Gate status (summary)

- **Merge gate (`ENV-DEV`):** <pass/fail + test count> — every in-scope `INV-###` assertion + `E2E-STANDARD` green against the highest local fidelity.
- **Release gate (`ENV-K3S`/real infra):** <pass/fail> — deployed; real-infra checks not runnable at merge are listed here as **deferred + tracked** (not skipped).
- **Blocked-by-environment (Part 10a):** gate items whose binding `ENV-###` fidelity the host **cannot provide** take both recorded devices — they stay on the deferred-and-tracked list **and** cite a **recorded waiver** (`WVR-###`: cause / scope / re-run condition); optionally list **off-gate evidence-run artifacts** (non-binding, tagged with the observed fidelity). Never a pass, never a silent skip.

## Capability coverage

Confirm **every in-scope `CAP-###`** appears as a built+verified slice (no capability built in a single layer). List any `CAP-###` not yet built (must be inside the build-ready gate scope, Concern 11.6).
