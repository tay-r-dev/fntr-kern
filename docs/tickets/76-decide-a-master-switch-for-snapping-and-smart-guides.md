# 76: Decide: a master switch for Snapping and smart guides

**Status:** needs-info

**Blocked by:** None (can start immediately)

## Today

The redesign draws a header toggle on Snapping and smart guides. Nothing stores snapping on or off as a whole; the debug parameters hold only per-kind values and switches.

## Target

1. Ask the designer what the header toggle turns off: all snapping, only guides, or only the two rows under it.
2. Record the answer in spec §2.3 and extend ticket 27 (Visual: Snapping and smart guides).

## Done when

- [ ] Spec §2.3 states what the switch does.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
