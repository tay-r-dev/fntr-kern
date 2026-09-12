# 79: Decide: the Skeleton heading's two icons

**Status:** needs-info

**Blocked by:** None (can start immediately)

## Today

The redesign draws an external-link icon and a gear beside the Skeleton heading, and an external-link icon beside Harmonize. Nothing is specified for any of them.

## Target

1. Ask the designer what each opens.
2. Record it in spec §5 and write build tickets.

## Done when

- [ ] Spec §5 states each icon's action, or drops it.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.1, §5.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
