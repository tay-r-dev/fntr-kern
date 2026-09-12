# 25: Visual: SpeedPunk header toggle

**Status:** ready-for-agent

**Blocked by:** 24 (Visual: Coarse Grid header toggle with the freeze)

## Today

The Designspace panel in the left sidebar is an accordion: Font axes, Glyph axes, Glyph sources, Source layers, Coarse grid, SpeedPunk, Snapping (debug). Coarse grid holds a Display checkbox, a Spacing slider, a Custom checkbox, and Start and Increment fields. SpeedPunk holds a Display checkbox and six number inputs. The accordion takes an auxiliary header element per item. SpeedPunk's Display checkbox is bound to the `fontra.curvature` layer key.

## Target

1. SpeedPunk's title bar carries the toggle bound to `fontra.curvature`. The Display row is removed. Off freezes its six inputs.

## Done when

- [ ] Toggle, View menu and comb agree.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Toggle off | Comb gone, inputs grey |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
