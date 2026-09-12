# 09: Autokern panel: Calibration inside Analytics

**Status:** ready-for-agent

**Blocked by:** 08 (Autokern panel: title and section order)

## Today

Calibration is its own disclosure at the bottom of the column. The controller's calibration renderer fills its body with the control glyphs' measurements, the target band, the settled reach and a sentence.

## Target

1. Calibration is the last block inside Analytics, under the four rows.
2. Its own disclosure is removed. Its body keeps its content.

## Done when

- [ ] After a run, Analytics shows the calibration block.
- [ ] Before any run it shows the not-yet-calibrated line.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Reload a calibrated font | Calibration shows inside Analytics |

**Spec:** docs/superpowers/UI-REFACTOR.md §1.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
