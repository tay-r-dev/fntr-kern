# 61: Corner rounding: chained rows

**Status:** ready-for-agent

**Blocked by:** 50 (Terminal: kind picker and one section per point), 45 (Skeleton block: chain on the width row), 26 (Visual: SpeedPunk compact scrub fields)

## Today

Corner rounding shows a Linked checkbox, Distance as a number and Curvature as a percent slider per side.

## Target

1. Distance and Curvature each a row of left, chain, right, as compact scrub fields. The chain is `corner:linked`.

## Constraints

- Distribution is not built. It needs a brainstorm with the designer. Do not add the slider the image draws.

## Done when

- [ ] Values write as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.7. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
