# 59: Terminal: Serif Angle group

**Status:** ready-for-agent

**Blocked by:** 57 (Terminal: Serif Wing and Bracket groups with chains), 48 (Skeleton block: Projection with its overflow)

## Today

Serif axis is a select of five modes: perpendicular, horizontal, vertical, absolute, tilt, with Axis angle and Axis tilt fields.

## Target

1. Force angle is a segmented control Free, Vertical, Horizontal for perpendicular, vertical, horizontal, with an overflow offering absolute and tilt.
2. Tilt, and Axis angle while absolute, show as fields under it.

## Done when

- [ ] All five modes are reachable and write as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
