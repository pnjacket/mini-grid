# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).
All `@mini-grid/*` packages are versioned in **lockstep** (`fixed` grouping in
`config.json`) — every release bumps them to one shared version.

Add a changeset for any user-facing change:

```sh
pnpm changeset
```
