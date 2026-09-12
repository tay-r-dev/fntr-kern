# 31: Skeleton contour width preference

**Status:** ready-for-agent

**Blocked by:** 30 (Visual: Skeleton switches)

## Today

The skeleton centerline layer draws at a fixed thickness. No setting controls it.

## Target

1. An application setting holds the centerline's drawn thickness in screen pixels.
2. A Skeleton width number field in the Visual Skeleton accordion edits it.
3. The centerline layer draws at that thickness at every zoom.

## Constraints

- Application settings, not the font (decision D9).

## Done when

- [ ] Changing the value redraws the centerline and survives a reload.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Set 3, zoom in and out | Centerline stays 3 pixels |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
