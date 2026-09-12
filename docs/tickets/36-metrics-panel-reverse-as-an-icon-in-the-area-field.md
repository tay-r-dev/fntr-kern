# 36: Metrics panel: Reverse as an icon in the Area field

**Status:** ready-for-agent

**Blocked by:** 35 (Metrics panel: Area, Depth and Overshoot as compact scrub fields), 11 (Autokern panel: alignment row)

## Today

Reverse is a text button in the Letterspacer header. It solves the area value back from the drawn margins. Where its guard applies, the first press arms a warning shown as a tooltip and the second press reverses.

## Target

1. A round-arrows icon button sits at the left end of the Area field.
2. It runs the same reverse, with the same two-press guard and tooltip.
3. The Reverse text button is removed.

## Done when

- [ ] On a glyph where the guard applies, one press shows the warning and changes nothing; a second press reverses.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Press once on a guarded glyph | Tooltip, no change |
| 2 | Press again | Area solved from margins |

**Spec:** docs/superpowers/UI-REFACTOR.md §4.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
