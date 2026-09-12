# 23: Designspace panel: Phrase group

**Status:** ready-for-agent

**Blocked by:** 11 (Autokern panel: alignment row)

## Today

The Designspace panel in the left sidebar is an accordion: Font axes, Glyph axes, Glyph sources, Source layers, Coarse grid, SpeedPunk, Snapping (debug). Coarse grid holds a Display checkbox, a Spacing slider, a Custom checkbox, and Start and Increment fields. SpeedPunk holds a Display checkbox and six number inputs. The accordion takes an auxiliary header element per item. The Text Entry panel owns the phrase box and a hand-built alignment row. Both write the editor's scene settings controller: text and align.

## Target

1. The Designspace panel opens with a Phrase heading, a phrase box and an alignment row of three icon buttons.
2. Both write the same scene settings keys, and listen to them.
3. The Text Entry tab stays as it is.

## Constraints

- Use the icon button's on state from `ak-align`. Do not copy the Text Entry row's markup.
- Do not refactor the Text Entry panel.

## Done when

- [ ] Typing in either box updates the other and the canvas.
- [ ] Alignment set in either place shows in both.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Type in the new box | Text Entry box and canvas follow |
| 2 | Click right in Text Entry | New row turns right on |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
