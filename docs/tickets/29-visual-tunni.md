# 29: Visual: Tunni

**Status:** needs-info

**Blocked by:** 24 (Visual: Coarse Grid header toggle with the freeze)

## Today

Tunni layers are reachable only from the View menu's Glyph editor appearance list: `fontra.tunni.point` (Tunni point), `fontra.tunni.handle` (Tunni handles), `fontra.skeleton.tunni` (Skeleton Tunni). `fontra.skeleton.generated-tunni` (Generated contour gizmos) is also the gizmo-mode switch.

## Target

1. A Tunni accordion in the Visual group with four checkboxes: Basic curvature, Skeleton curvature, Basic on-curve, Skeleton on-curve, each bound to one layer key.

## Constraints

- The mapping of the four labels to layers is not confirmed. The likely reading is Basic curvature to Tunni point, Basic on-curve to Tunni handles, Skeleton curvature to Skeleton Tunni. Skeleton on-curve has no layer that is not already the gizmo-mode switch. Confirm the mapping with the designer before binding.

## Done when

- [ ] Each checkbox and its View menu entry always agree.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Uncheck each in turn | Its layer vanishes, View menu unchecked |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
