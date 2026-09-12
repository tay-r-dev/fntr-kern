# 71: Skeleton settings: terminal presets table

**Status:** ready-for-agent

**Blocked by:** 67 (Skeleton settings tab), 04 (Lift the pair table into a shared table component), 07 (Terminal presets cover the four kinds with fields)

## Today

Serif presets are rows of an expand chevron, a name input and a two-press delete; expanding shows the preset's fields inline.

## Target

1. A terminal presets table: Type, Name with master and case in grey, pencil and trash.

## Done when

- [ ] Every existing serif preset appears as a Serif row.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
