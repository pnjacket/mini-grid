# CLAUDE.md — mini-grid

## Documentation standard (Dictum)

This repo follows the **Dictum** build-ready documentation standard. The standard
material is **vendored** under [`dictum/`](dictum/):

- `dictum/STANDARD.md` — the method (Parts 0–13).
- `dictum/GLOSSARY.md` — vocabulary.
- `dictum/failure-mode-catalog.md` — each rule tied to the failure it prevents.
- `dictum/concerns/11.x-*.md` — the 15 concern specifications.
- `dictum/templates/` — fill-in skeletons (concern-doc, single-file, manifest, binding-map).

The advisory tooling is installed in `.claude/`:

- **Skills** (`.claude/skills/`): `doc-scaffold`, `doc-excavate`, `doc-levelup`, `doc-feature`, `doc-change-impact`.
- **Agents** (`.claude/agents/`): `doc-maturity-auditor`, `code-cartographer`, `drift-detector`, `implementation-planner`, `concern-specialist`.

**Path resolution:** when a skill or agent references `STANDARD.md`, `concerns/11.x`,
`templates/`, `GLOSSARY.md`, or `failure-mode-catalog.md`, resolve them under
`dictum/` in this repo (the vendored checkout). The product's own docs
(`manifest.yaml`, `bindings.yaml`, and generated concern docs) live at the repo root
or wherever `doc-scaffold` places them.
