# 32: Metrics panel: rename

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

The Selection info panel's title and tab read Glyph info, from `sidebar.selection-info.title`.

## Target

1. Title and tab read Metrics.

## Constraints

- Change the English string only. Identifiers stay.

## Done when

- [ ] The tab tooltip and panel title read Metrics.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §4.2. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
