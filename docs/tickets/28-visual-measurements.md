# 28: Visual: Measurements

**Status:** ready-for-agent

**Blocked by:** 24 (Visual: Coarse Grid header toggle with the freeze), 05 (Merge the Transformation and Skeleton parameters panels)

## Today

The Transformation panel's Point labels block has Distance, Tension and Angle checkboxes writing scene settings `showLabelsDistance`, `showLabelsTension`, `showLabelsAngle`. Its listeners bind by checkbox position in the form, and a comment warns that anything added ahead of them rebinds them. The `fontra.point.labels` layer draws them.

## Target

1. A Measurements accordion in the Visual group: header toggle bound to `fontra.point.labels`, and three checkboxes bound to the three scene settings.
2. The Point labels block and its position-bound listeners are removed from the Transformation panel.

## Constraints

- Bind by key, never by position.

## Done when

- [ ] Each checkbox shows or hides its label kind on the canvas.
- [ ] No position-based checkbox lookup remains in the Transformation panel.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Uncheck Angle | Angle labels vanish |
| 2 | Header off | All labels gone, checks grey |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
