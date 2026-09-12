# 73: Skeleton settings: New terminal preset and Preset from selection

**Status:** ready-for-agent

**Blocked by:** 71 (Skeleton settings: terminal presets table)

## Today

Create from selection stores the selected serif.

## Target

1. New preset adds a row.
2. Preset from selection takes the selected terminal's kind and shape, for all four kinds.

## Done when

- [ ] A Rounded endpoint's preset stores Radius and Roundness.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
