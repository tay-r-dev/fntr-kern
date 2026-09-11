# forkra UI Refactor Spec

**Date:** 2026-09-12.
**Source images:** `_external/__ui/`. Each image is a redesigned panel, not the panel as it stands.
**Companion:** `UI-NOMENCLATURE.md` names every element. Read it before you build a chapter here.
Anything this spec needs that the nomenclature does not already list goes into its §14, once, so
the next chapter reuses it instead of inventing it again.

One chapter per image. A chapter states the difference between the tree and the image, and nothing
else. Where the image agrees with the tree, the chapter says so and moves on.

---

## 1. Autokern panel

**Image:** `autokern.jpg`. **Feature:** F13, kerning view.
**Files:** `views-kerning/kerning.html`, the `#kerning-panel-container` column.
`views-kerning/src/kerning.js` owns every section body.
**Nature of the change:** section order, with one control moved into a dialog.

### 1.1 Order

| # | Today | Target |
| - | ----- | ------ |
| 1 | Source and counts | Panel title, **Autokern** |
| 2 | Stale and new glyphs | Source and counts |
| 3 | Analytics | Thresholds, Run and Parameters |
| 4 | Presets and phrase | Stale and new glyphs |
| 5 | Thresholds, Run, Parameters disclosure | Presets, phrase and alignment |
| 6 | Visual settings | Visual settings |
| 7 | Calibration | Analytics, with Calibration inside it |

Four moves and two additions.

1. The threshold row and Run rise to sit directly under the counts. A designer reads the counts and
   then starts a run. Today three sections stand between those two acts.
2. Analytics falls to the bottom. It reports on a finished run and steers nothing.
3. Calibration stops being its own section. It becomes the last block inside Analytics, where the
   rest of the run report already is.
4. Parameters stops being an open disclosure. See §1.2.
5. The panel gains a title, **Autokern**. It has none today.
6. The phrase box gains an alignment control. See §1.3.

The two collapsible sections, Visual settings and Analytics, open by default and remember what the
designer last did with them. This matches every other accordion in the app.

### 1.2 The Parameters dialog

This is the only change in behavior.

Four controls live in a `<details>` at the bottom of the threshold section today: Envelope reach,
Envelope type, Reduction and Strength. They move into a dialog. The **Parameters** button sits on
the Run row, to the right of Run.

The reason is how often each is touched. The three thresholds change between runs. The four
parameters are set once for a font and then read on every run. A control set once does not earn a
row in the column a designer scans.

The dialog writes the same settings the disclosure writes. Closing the dialog applies nothing by
itself. A changed parameter takes effect on the next Run, exactly as it does today.

### 1.3 The alignment control

Three icon buttons in a row, left, center and right, with exactly one on. It sits under the phrase
box. It sets how the typed phrase sits in the preview.

New to this panel only. The Text Entry panel in the editor has the same row, and the three icons
ship already. The setting exists here too: `kerning.js` writes `sceneSettings.align` as `"left"`
and no control reads or changes it. This adds the control and nothing else.

`<icon-button>` has no on state, which is why Text Entry hand-built its row out of bare icons.
Give the shared component that state and use it here. See `UI-NOMENCLATURE.md` §14.

The row is not a component. The panel owns the setting, so it sets the on state on three buttons
from one listener. Six lines. A group element would cost more than it saves.

### 1.4 What does not change

- Every readout keeps its wording and its scope. The counts still read cached pairs, pairs above
  threshold, marked junk, then classed cells and flat cells.
- The four Analytics rows keep their tooltips, and the same three of the four stay clickable.
  Saved pair exceptions stays plain text, because it still has nowhere to jump to.
- Stale and new glyphs keeps both buttons, its empty state and its progress line.
- The thresholds keep their names and their meaning. Minimum and Maximum absolute delta filter the
  pair table. Class tolerance is the class one. Neither filter changes a run.
