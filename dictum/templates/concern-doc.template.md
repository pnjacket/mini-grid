---
artifact: product-doc
role: concern                     # this is a product's concern document
concern-id: <concern-id>          # e.g. security-and-privacy
behavior: <core|baseline|module>
trigger: <always | the trait that activated this module>
in-scope-subaspects: []           # OPTIONAL readout, DERIVED = (concern's published keys − manifest out_of_scope_subaspects).
                                  # The manifest is the single source of truth (Part 7); this list must not contradict it.
                                  # Sub-aspects scoped out (per the manifest) go in Non-goals below.
current-rung: sketch              # absent|sketch|specified|contract-grade  (Verified is tracked by Delivery)
status: draft                     # draft|published
version: 0.1.0
---

# <Concern Name> — <Product Name>

> One-line: what this concern covers for this product.
<!-- BUILD: Read ../concerns/11.x-<concern>.md for this concern's sub-aspects, the contracts it OWNS (and their ID scheme), what each rung MEANS here, and the Contract-grade bar. Author the sections below as you climb the ladder; they appear rung by rung. -->

## Purpose & Scope            <!-- rung: Sketch -->
<!-- BUILD: What this concern covers FOR THIS PRODUCT, and what it explicitly does not (delegated to which concern). -->

## Non-goals / Out-of-scope   <!-- rung: Sketch — LOAD-BEARING for PoC↔production calibration -->
<!-- BUILD: List concerns/sub-aspects deliberately excluded. This is where PoC-ness is recorded. -->

## Requirements               <!-- rung: Sketch (outline) → Specified (complete) -->
<!-- BUILD: Sketch = bullets/intent. Specified = complete prose requirements a human could build from. -->

## Open Questions             <!-- rung: Sketch onward, while unresolved -->

## Dependencies & Cross-references   <!-- rung: Specified -->
<!-- BUILD: Link the IDs this concern CONSUMES from other concerns (e.g. CAP-###, ENTITY-###). -->

## Examples / Worked scenarios   <!-- rung: Specified -->

## Design Decisions           <!-- rung: Specified (begun) → Contract-grade (complete) -->
<!-- BUILD: Decision + rationale table. Cross-cutting decisions go in Architecture's ADR-### register instead. -->

## Contracts                  <!-- rung: Contract-grade -->
<!-- BUILD: The contracts this concern OWNS, by stable ID (see the spec's ID scheme). Each entry complete enough to build/reference. -->

## Acceptance criteria        <!-- rung: Contract-grade — testable & unambiguous; each maps to an observable check -->
<!-- BUILD: Meet the concern's Contract-grade bar (in its spec). Every criterion must be checkable. -->

---
<!-- Status markers (subject, stay published): [GAP] [ASSUMPTION] [REVISIT] [FUTURE-SCOPE].
     Build markers (stripped on publish): these <!-- BUILD: ... --> comments. -->
