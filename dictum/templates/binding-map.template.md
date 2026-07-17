---
artifact: documentation-standard
role: template
status: draft
version: 0.4.0
---

# Contract→Code Binding Map — Template

The machine-readable index from each owned **contract ID** to where it is **realized in code** — the input the drift-detector needs (STANDARD Part 10d), and useful on its own as doc↔code traceability + coverage-gap detection. A sibling of the manifest (`bindings.yaml` beside `manifest.yaml`); the human never reads it directly.

> **It is an index, not the contract.** The doc stays canonical (Part 5; cf. the 11.4 anti-pattern of generating the contract *from* code). The binding map is the **one stored edge list Part 0.5 permits**, allowed only because it records *underivable* doc↔code correspondence (which can't be derived from the doc set, unlike the reverse-reference graph) and is **self-validated every run** — a binding that stops resolving is itself a drift finding, so it can't silently rot.

```yaml
# bindings.yaml — CURRENT doc<->code correspondence only. Populated as each slice is built.
bindings:

  API-012:                                   # key = contract ID (must be in-scope + Contract-grade+)
    locators:
      - { path: src/handlers/users.py, symbol: get_user }
    compare_via: openapi                     # optional (model B): how the code-side shape is extracted

  ENTITY-USER:
    locators:
      - { path: src/models/user.py, symbol: User }    # ORM model
      - { path: db/schema.sql,      symbol: users }    # storage schema (one contract, several realizations)
    fields:                                  # optional; INDEPENDENT of manifest reference_granularity (adds drift precision)
      email: { path: src/models/user.py, symbol: User.email }

  SCREEN-007:
    locators:
      - { path: src/app/users/user-detail.component.ts, symbol: UserDetailComponent }

  INV-USER-EMAIL-UNIQUE:                      # a SEMANTIC contract binds to its assertion — and a STRUCTURAL
    locators:                                 # invariant MAY also bind its ENFORCEMENT SITE (dual shape):
      - { path: db/schema.sql, symbol: users }                  # the constraint / transaction scope that enforces it
    asserted_by:                              # prefer ONE invariant per test (so a failure attributes cleanly)
      - { path: tests/users/test_user.py, symbol: test_email_unique,
          run: "python3 -m pytest tests/users/test_user.py::test_email_unique" }  # runnable selector; a failing assertion = a drift event
      # multi-arm INVs (INV-004a/b) may list one asserted_by entry per arm, labeled with the arm token.
      # An assertion that can only land with a later slice is recorded as owed, never left blank-silent:
      #   asserted_by owed by slice 9          (enforcement bound now ≠ assertion bound)

# OPTIONAL coverage policy. Omit it and every code-realizable kind is bind-all (silence = bind-all).
# Use it only to declare an intentional CURATED subset, so 'didn't bind' can't masquerade as 'covered'.
coverage:
  fully_bound: [ENTITY, LIB, INV, SCREEN]     # an unbound in-scope Contract-grade+ member of these kinds IS a real coverage gap
  curated:                                    # partial-by-intent; unbound members are NOT flagged — but you must say why
    # …and NAME the curation locus: the realizing module the detector compares every member against
    API: "state-changing + measured-read endpoints are bound; simple CRUD/read routes are realized but not individually indexed (locus: src/routes/)"
    # An EVENT SURFACE dispatched by a SINGLE handler is a natural curated-locus case: every EVT-### frame
    # (input/output/resize/closed/…) realizes in one function, so per-frame symbols don't exist — bind the
    # dispatcher once as the locus rather than tripping the owned-twice warning N times.
    EVT: "all frames handled by one WS dispatcher (locus: src/api/ws.go:handleWS); per-frame symbols n/a"
```

## Self-validation (run every time; this is what keeps the map honest)

- **Doc end** — every key resolves to a stable ID owned by an **in-scope, Contract-grade+** concern. Unknown ID → error; sub-Contract-grade or out-of-scope → warning (premature binding); **tombstoned** ID → error (the binding must be dropped on retirement).
- **Code end** — every `path` exists and every `symbol`/`asserted_by` resolves within it (use the `asserted_by.run` selector to execute the test). A locator that no longer resolves is a **dangling binding** → reported as a `binding-stale` finding (a defect in the index itself, not a code↔doc drift; fix or retire the binding). Locators point at **own code** (real), never at a substituted external dependency (Part 10a substitution rule). An `asserted_by.symbol` must match the **actual test title (or declared symbol) verbatim**; a substring/elided label that still uniquely matches is a **hygiene warning**, and one matching no test is a dangling binding. The **`run:` selector's filter may legitimately be an abbreviated-but-uniquely-matching substring** (idiomatic with `vitest -t 'partial title'` / `pytest -k`); that is fine as long as it resolves to exactly one test and the `symbol` itself stays verbatim.
- **INV bindings — dual shape, arms, deferral.** A structural `INV-###` may bind **both** `locators` (the enforcement site — schema constraint, transaction scope) **and** `asserted_by` (the observing test); each evidences a different thing, validate both ends. A **multi-arm** invariant may carry one `asserted_by` entry per arm, labeled with the verbatim arm token. An assertion that lands with a later slice is recorded as a deferral on the binding — `asserted_by owed by slice N` — keeping "realized but not yet asserted" visible instead of silently unbound.
- **Coverage** — by default every in-scope Contract-grade+ contract of a **code-realizable kind** has ≥1 binding; a missing one is a **coverage gap** (drift there can't be detected, only flagged, by the `doc-maturity-auditor`). A map MAY declare a **curated subset** for a kind via the top-level `coverage:` block above: a kind under `fully_bound` keeps the bind-all rule (an unbound member is a real gap); a kind under `curated` is intentionally partial, so its unbound members are **not** flagged — but the declaration must state *why* (so curation is a recorded decision, not an oversight). A kind that is **neither** declared nor fully bound defaults to `fully_bound` — silence means bind-all, so every curation is explicit. This resolves "is a partial binding a gap or intentional?": the map answers it.
- **Hygiene** — one code locator realizing two different contract IDs → warning (possible owned-twice smell).

## Which contract kinds bind

- **Code-realizable (expected in the map):** `API/CLI/LIB/EVT-###`, `ENTITY-###`, `SCREEN/ROUTE-###`, `COMPONENT-###`, and `INV-###` (via `asserted_by`).
- **Not directly bound (excluded from coverage):** `CAP-###` (realized *transitively* through its API/SCREEN slice), and contracts checked by other gates — `PERF-###` (perf tests), `POLICY-###` (audits), `ROLE-###`, `LICENSE-TIER-###`. Also excluded: any otherwise-code-realizable contract that its doc declares a pure **external dependency** — e.g. a `COMPONENT-###` realized only as a `DEP-###` / physical infrastructure (PostgreSQL, a managed queue). The substitution rule (Part 10a) says bindings point at *own* code, so the external system itself has nothing to bind; bind its own-code realization (schema/migrations/client) instead, and don't count the external as a coverage gap.
- **Deliverable-shaped / gate-checked kinds** (`POLICY-###`, audit-checked `LEGAL/TOOL-###`, byte-exact deliverables like a CSP-style `SEC-###`) are verified by their own gates, not by this map — so a slice whose entire *Realizes* set is such kinds legitimately has a **vacuous binding-upkeep DoD item**: record the proof in the build-status record's **Proof** column instead, and say so in the slice's DoD.

## Ownership & lifecycle

Authored **during the build** — the slice that realizes a contract records its binding (Delivery Process territory) — and **validated continuously** by the lifecycle tooling that consumes it. A lightweight complement is a **build-time in-code ID annotation** (a `// DICT: <ID>` tag at the realizing code site): it carries the same ID→code link *in the source*, always in sync and human-visible, and is what lets a later code→doc reverse-authoring pass (Part 10f) **recover** the author's own IDs instead of coining fresh ones. The binding map remains the machine-readable index the detector consumes; the in-code tag is the durable, drift-proof hint. A binding is **removed when its contract is tombstoned**, alongside the retirement precondition (Part 10d). The map holds *current* correspondence only; history rides on git.
