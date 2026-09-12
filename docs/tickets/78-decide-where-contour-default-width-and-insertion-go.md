# 78: Decide: where Contour default width and Insertion go

**Status:** needs-info

**Blocked by:** None (can start immediately)

## Today

The skeleton panel has a Contour section with a default width field, and an Insertion section with two widths and an easing for insertion points. Neither is in the redesign.

## Target

1. Ask the designer where each goes, or whether it is dropped.
2. Record it in spec §5 and write build tickets.

## Done when

- [ ] Spec §5 places both, or drops them.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
