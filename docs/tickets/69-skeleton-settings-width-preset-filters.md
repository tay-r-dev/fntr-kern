# 69: Skeleton settings: width preset filters

**Status:** ready-for-agent

**Blocked by:** 68 (Skeleton settings: width presets table), 15 (Pair table: Unicode types dropdown)

## Today

The block shows only the current master and case.

## Target

1. The table header carries Current, a Master dropdown and a Case dropdown. Current sets both to the edited glyph's master and case.

## Done when

- [ ] Each filter narrows the rows.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
