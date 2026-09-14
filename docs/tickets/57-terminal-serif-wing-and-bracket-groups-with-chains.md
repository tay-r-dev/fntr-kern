# 57: Terminal: Serif Wing and Bracket groups with chains

**Status:** done

**Blocked by:** 50 (Terminal: kind picker and one section per point), 45 (Skeleton block: chain on the width row)

## Today

The Serif section shows a Sides row (Both, L, R), per-half headers when halves differ, Use this half on both sides and Add serif to the other side buttons, then nine fields per half under Wing, Bracket and Contour easing.

## Target

1. Wing: Width, Height, Slope, Tip cut. Bracket: Reach, Tension, Concavity. Each is a row of left value, chain, right value.
2. A closed chain writes both halves from the left, which is today's linked halves. An open chain edits each half.
3. The Sides row, the per-half headers and the symmetrize and add-other-side buttons are removed.

## Constraints

- A wingless half is still switched off at width zero (feature model §8).
- Decided 2026-09-14: one on/off check above each column replaces the Sides row, and right-clicking a left or right field offers Force to L/R side for the field, its group and all fields. See UI-REFACTOR.md §5.6.

## Done when

- [ ] Every field writes the same serif field as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
