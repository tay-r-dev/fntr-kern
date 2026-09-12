# 26: Visual: SpeedPunk compact scrub fields

**Status:** ready-for-agent

**Blocked by:** 25 (Visual: SpeedPunk header toggle)

**Builds:** the compact scrub field. Later tickets reuse it: 35 (Metrics panel: Area, Depth and Overshoot as compact scrub fields), 38 (Selection: Transform rows as compact scrub fields), 46 (Skeleton block: Generation layout), 51 (Terminal: Square section), 54 (Terminal: Rounded section), 55 (Terminal: Drop section), 61 (Corner rounding: chained rows). Build it once, where they can import it.

## Today

The Designspace panel in the left sidebar is an accordion: Font axes, Glyph axes, Glyph sources, Source layers, Coarse grid, SpeedPunk, Snapping (debug). Coarse grid holds a Display checkbox, a Spacing slider, a Custom checkbox, and Start and Increment fields. SpeedPunk holds a Display checkbox and six number inputs. The accordion takes an auxiliary header element per item. The six SpeedPunk inputs are full-width rows bound to application settings `speedPunkPeakHeightUpm`, `speedPunkReferenceTurnDegrees`, `speedPunkColorFlatTurnDegrees`, `speedPunkColorTightTurnDegrees`, `speedPunkSharpness`, `speedPunkOpacity`. They do not scrub. Scrubbing exists in `ui-form`: a field row with a scrub flag makes its label draggable, with the pixel arithmetic in core `number-scrub.js`.

## Target

1. A compact scrub field exists: one box holding its name at the left, a scrub icon, and its value right-aligned. Dragging anywhere in the box outside the value text scrubs; clicking the value edits it.
2. SpeedPunk shows its six values as compact scrub fields, two per row: Peak height, Tight colour at turn; Full height at turn, Sharpness; Full colour at turn, Opacity.

## Constraints

- Reuse `number-scrub.js` for the arithmetic and the cancel sentinel. Do not write a second scrub.
- Shift is the fine adjust. Right-click abandons the drag and restores the start value.
- It must work inside `ui-form` and outside it: the Metrics and Selection panels build their rows with `ui-form`, this panel does not.
- Every existing full-width scrub row must behave as before.

## Done when

- [ ] Each field scrubs, types and persists to its setting.
- [ ] The comb redraws while scrubbing.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Scrub Peak height right | Value rises, comb grows |
| 2 | Shift-scrub | Tenth the rate |
| 3 | Scrub then right-click | Value returns to start |
| 4 | Scrub a skeleton width label | Unchanged behavior |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.5; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
