# 75: Decide: corner rounding Distribution

**Status:** needs-info

**Blocked by:** None (can start immediately)

## Today

Corner rounding stores a distance and a curvature per side and a linked flag. The redesign draws a Distribution slider at 60 in Corner rounding. No such field exists and nothing defines it.

## Target

1. Brainstorm with the designer what Distribution sets and in what unit.
2. Record the answer in the spec §5.7 and write a build ticket for it.

## Done when

- [ ] Spec §5.7 states what Distribution does, or states that it is dropped.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.7. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
