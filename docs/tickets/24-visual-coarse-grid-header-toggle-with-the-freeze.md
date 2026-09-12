# 24: Visual: Coarse Grid header toggle with the freeze

**Status:** ready-for-agent

**Blocked by:** 14 (Pair table: switch row)

**Builds:** the header toggle and the freeze. Later tickets reuse it: 25 (Visual: SpeedPunk header toggle), 27 (Visual: Snapping and smart guides), 28 (Visual: Measurements), 29 (Visual: Tunni), 30 (Visual: Skeleton switches). Build it once, where they can import it.

## Today

The Designspace panel in the left sidebar is an accordion: Font axes, Glyph axes, Glyph sources, Source layers, Coarse grid, SpeedPunk, Snapping (debug). Coarse grid holds a Display checkbox, a Spacing slider, a Custom checkbox, and Start and Increment fields. SpeedPunk holds a Display checkbox and six number inputs. The accordion takes an auxiliary header element per item. The Display checkbox reads and writes the `fontra.coarse.grid` key of the editor's visualization layer settings, which persist to local storage and which the View menu also reads.

## Target

1. A Visual heading sits above Coarse Grid.
2. Coarse Grid's title bar carries the shared toggle at its right end, bound to `fontra.coarse.grid`.
3. The Display row is removed.
4. Off disables and greys Spacing, Custom, Start and Increment. On makes them live. This is the freeze.
5. Clicking the toggle does not open or close the accordion.

## Constraints

- Place the toggle through the accordion's auxiliary header element. Do not change `ui-accordion`.
- Build the freeze once so the next five accordions reuse it: a helper that disables every control inside an accordion item's content.
- No second store: the toggle and the View menu share one key.

## Done when

- [ ] View menu and toggle always agree, whichever changes.
- [ ] The toggle state survives a reload.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Toggle off | Grid gone, four controls grey, View menu unchecked |
| 2 | Check the View menu entry | Toggle on, controls live |
| 3 | Accordion closed, click toggle | Accordion stays closed |

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3, §2.4; docs/superpowers/UI-NOMENCLATURE.md §14.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
