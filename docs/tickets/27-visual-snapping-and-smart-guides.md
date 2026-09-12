# 27: Visual: Snapping and smart guides

**Status:** ready-for-agent

**Blocked by:** 24 (Visual: Coarse Grid header toggle with the freeze)

## Today

The Designspace panel in the left sidebar is an accordion: Font axes, Glyph axes, Glyph sources, Source layers, Coarse grid, SpeedPunk, Snapping (debug). Coarse grid holds a Display checkbox, a Spacing slider, a Custom checkbox, and Start and Increment fields. SpeedPunk holds a Display checkbox and six number inputs. The accordion takes an auxiliary header element per item. The Snapping (debug) accordion holds about thirty controls, including toggles `offCurveSources` and `snapDuringFixedRib`, stored in application settings `snapDebugParameters`.

## Target

1. A Snapping and smart guides accordion in the Visual group holds Off-curve points cast rays and Snap during a fixed-rib drag as labeled toggles, bound to those two parameters.
2. Its header toggle is not specified by a stored setting. Leave the header toggle out of this accordion until one exists; see Out of scope.
3. Snapping (debug) stays where it is and the two controls there stay in sync.

## Done when

- [ ] Changing either toggle changes the matching debug control, and back.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Turn off rays here | Debug control shows off; off-curve rays stop |

## Out of scope

A master snapping on/off switch. The image draws one; nothing stores one today. Raise it with the designer before adding it.

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
