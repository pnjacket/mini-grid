---
artifact: documentation-standard
role: standard
status: published
version: 1.0.0
---

# Templates

Fill-in skeletons that instantiate the [document contract](../STANDARD.md#part-4--the-document-contract). They are deliberately **few**: each concern's authoring guidance already lives in its spec (`../concerns/11.x-*.md`) — the sub-aspects, the owned-contract ID schemes, what each rung means, and the Contract-grade bar. A template is the *blank shape*; the matching concern spec is the *instructions*.

## Files

| Template | Use |
|---|---|
| `concern-doc.template.md` | One concern as its own file (the **multi-file** packaging, for larger products). Copy once per in-scope concern. |
| `single-file-spec.template.md` | All in-scope concerns as sections of one file (the **single-file** packaging, for small products / CLIs). |
| `manifest.template.md` | The product-profile manifest — the single source of truth the human index is derived from. One per product. |
| `binding-map.template.md` | The contract→code index (`bindings.yaml`) for drift detection (Part 10d). Machine-readable, sibling of the manifest, populated during build. |
| `build-status.template.md` | The Delivery Process Verified/implementation-status record (what's built & proven, at which fidelity stage). Kept **separate** from the manifest (doc maturity ≠ implementation status). |

## How to use (manually, or via the scaffold skill)

1. **Intake** → decide which concerns and sub-aspects are in scope, and the packaging (one-file vs per-concern). Record them in `manifest.template.md`.
2. For each in-scope concern, **copy the matching template** and read its concern spec (`../concerns/11.x-*.md`) for the sub-aspects to cover, the IDs to own, and the Contract-grade bar.
3. **Author up the rungs.** Sections appear as you climb (Sketch → Specified → Contract-grade). Use `<!-- BUILD: ... -->` notes for next-rung targets; they strip on publish.
4. **Publish** when the manifest says the concern's target rung is reached: strip build markers, flip `status` to `published`, bump the version.

> PoC vs production is expressed by **scope** (Part 9): leave concerns/sub-aspects out, recorded in *Non-goals*. Contract-grade itself never weakens.
