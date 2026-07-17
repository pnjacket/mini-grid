---
name: doc-scaffold
description: Use when starting a documentation set for a new product (or a new component) under the Documentation Standard. Runs an adaptive intake interview, writes the product-profile manifest, and generates the doc set from the templates. Triggers - "scaffold docs", "start documentation", "set up the doc set", "document this product".
---

# doc-scaffold

Operationalizes the standard's **Intake → Scaffold** phases. Advisory: confirm before writing files; never overwrite without asking.

## Inputs you rely on
- The Dictum standard: `STANDARD.md` (the method), `concerns/11.x-*.md` (per-concern guidance), `templates/` (skeletons).

## Procedure

1. **Open the floor first (free-form brief).** Before inferring anything — and **without assuming the product from the repo name** — ask the operator to describe, in their own words, what they want to build: the goal, who it's for, the core capabilities/flows, and anything they consider important. Say explicitly that this is their chance to put down details the structured questions below may never ask. Let them answer fully and read it back before you start narrowing. This brief, not the repo name, is the source of truth for what the product is.
2. **Interview to saturation (interactive default).** Ground in the brief, then **keep interviewing in small rounds** (a handful of questions each) until a round surfaces nothing new or the operator calls it — do NOT use a fixed questionnaire, and do NOT stop because you've "inferred enough" (that minimal posture is the autonomous-mode concession, not the interactive default — STANDARD Part 0.6). Adaptive means *which* questions are in scope, never *how few*. Drive the rounds from a **coverage map**: the traits below × each in-scope concern's sub-aspects × each capability's lifecycle/edge/failure/NFR dimensions; each round targets the still-uncovered cells and you tell the operator what's covered vs still open. The traits that drive scope:
   - interface kinds (cli / http / library / events / ui), interactive UI?, deployed service?, persists data?, third-party deps?, perf/scale needs?, multi-locale?, commercial?, regulated?, security risk (auth/pii/secrets/network)?
   - **Unattended exception:** only when running with no operator to interview (e.g. an autonomous build) do you substitute inference for a question — and then mark every inferred answer `[ASSUMPTION]` and list them for later review. Never the interactive path.
3. **Derive scope (breadth).** Always include the 6 **Core** + 2 **Baseline** concerns. Include **Module** concerns whose trigger fired. Note sub-aspects to leave out-of-scope, recording each one's kind (Part 9): `deferred` (calibration — this is how PoC↔production is right-sized; a re-entry note is owed) vs `absent` (the subject doesn't exist in the product; the trait fact is the justification, no re-entry note) — record them in each doc's *Non-goals*.
4. **Suggest a starting rung per concern** (depth), risk-aware (e.g. a product handling real PII starts Security higher). The operator may override.
5. **Choose packaging.** Recommend single-file for small products/CLIs, per-concern for larger ones (operator's call).
6. **Write the manifest** from `templates/manifest.template.md`: traits, packaging, per-concern `in_scope` + `current_rung` + `target_rung` (default contract-grade) + `out_of_scope_subaspects`.
7. **Generate the doc set.**
   - per-concern: copy `templates/concern-doc.template.md` once per in-scope concern; pre-fill front-matter and the sub-aspect list from the matching `concerns/11.x` spec.
   - single-file: copy `templates/single-file-spec.template.md`; keep always-present sections, add Module sections that triggered.
   - Seed subject markers (`[GAP]`) where content is owed.
8. **Generate the human index/README** from the manifest (concern list + locations + current rungs). Treat it as derived: regenerate it (or update it in lockstep) whenever the manifest changes. The `doc-maturity-auditor` will flag any later README↔manifest drift, so the index can't quietly fall out of sync.
9. **Report** what was created and the suggested next step (usually `doc-levelup` on the foundational concerns first: Product & Requirements → Domain/Architecture → Interfaces → downstream).

## Guardrails
- **Never assume the product from the repo name or directory contents.** Open with the free-form brief and treat the operator's own description as the source of truth; the repo name is at most a weak hint to confirm, never a starting assumption.
- Confirm the derived scope with the operator before generating.
- Never weaken Contract-grade; right-size via scope only.
- Don't invent product facts — leave `[GAP]` markers and Open Questions where unknown.
