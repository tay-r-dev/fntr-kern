# 35: Metrics panel: Area, Depth and Overshoot as compact scrub fields

**Status:** ready-for-agent

**Blocked by:** 26 (Visual: SpeedPunk compact scrub fields)

## Today

Area, Depth and Overshoot are `edit-number` rows in the Letterspacer form, persisted per source.

## Target

1. The three are compact scrub fields on one row.
2. Apply left and Apply right, stored today as 0 or 1 number fields, become Left and Right checkboxes; May replace metrics keys becomes an Override variables checkbox. Reference and the three checks share one row.

## Done when

- [ ] Each field scrubs and types, persists, and clears the calculated values as a typed change does today.
- [ ] The three checks write the same stored values as the number fields did.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Scrub Area | Value changes, calculated values clear |
| 2 | Untick Left, Apply | Only the right margin changes |

**Spec:** docs/superpowers/UI-REFACTOR.md §4.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
