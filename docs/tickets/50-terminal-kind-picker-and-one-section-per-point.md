# 50: Terminal: kind picker and one section per point

**Status:** ready-for-agent

**Blocked by:** 42 (Selection: Harmonize method as a segmented control), 05 (Merge the Transformation and Skeleton parameters panels)

## Today

The Caps section has a Cap style select and shows parameter rows only for the chosen style. Corner rounding is a separate section gated to angle points. Picking serif applies Egyptian.

## Target

1. A Terminal accordion opens with a segmented control Flat, Square, Rounded, Ball, Serif, writing butt, square, round, drop, serif. Flat shows no section.
2. A selected open endpoint shows only its kind's section. A selected corner shows only Corner rounding.
3. Picking Serif still applies Egyptian.

## Done when

- [ ] Switching kind shows that section alone and writes the style.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.2, §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
