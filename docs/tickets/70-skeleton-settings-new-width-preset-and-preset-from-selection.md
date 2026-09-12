# 70: Skeleton settings: New width preset and Preset from selection

**Status:** ready-for-agent

**Blocked by:** 68 (Skeleton settings: width presets table)

## Today

An Add button appends a custom width.

## Target

1. New preset adds a row in the filtered master and case.
2. Preset from selection takes the selected rib's width and side.

## Done when

- [ ] Both add one row.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
