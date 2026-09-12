# 68: Skeleton settings: width presets table

**Status:** ready-for-agent

**Blocked by:** 67 (Skeleton settings tab), 04 (Lift the pair table into a shared table component), 06 (Width presets as one list with a side)

## Today

Custom widths are rows of a name input, a value input and a two-press delete.

## Target

1. A width presets table: Name with master and case in grey, Width, Side, and a trash.
2. Name, Width and Side are editable in the cell.

## Constraints

- The trash keeps the two-press confirm.

## Done when

- [ ] Edits persist to the master.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
