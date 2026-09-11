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

---

## 2. Left sidebar: Phrase, Designspace, Visual

**Image:** `designspace.jpg`. **Feature:** core Fontra, F1, F3, F4, F5, F7, F12.
**Files:** `views-editor/src/panel-designspace-navigation.js` is the panel that grows.
`panel-text-entry.js` supplies the phrase block. `panel-transformation.js` and
`editor.js`'s View menu lose entries to it.
**Nature of the change:** one tab gains a second and a third group, and three groups of switches
move into it from two other places.

### 2.1 The three groups

One tab, one scroll, three headings.

| Heading | Holds | Where it is today |
| --- | --- | --- |
| **Phrase** | The phrase box and the alignment row | The Text Entry tab |
| **Designspace** | Font axes, glyph axes, glyph sources, source layers | This panel, unchanged |
| **Visual** | Coarse Grid, SpeedPunk, Snapping and smart guides, Measurements, Tunni, Skeleton | Three places, see §2.3 |

**Phrase is reused, not moved.** The Text Entry tab stays exactly as it is. This panel shows the
same box and the same alignment row, for the designer who is already here. Both write the same
text settings, so they cannot disagree.

The Designspace group is the panel's own top half and does not change. Its accordion headers
already carry their icons through the accordion's auxiliary header element.

### 2.2 Two mistakes in the image

The second **Coarse Grid** heading is SpeedPunk. **Basic curvature** and **Basic on-curve** are
misspelled in the Tunni group.

### 2.3 What Visual gathers

Six accordions. Three of them are already in this panel. Three come from elsewhere.

| Accordion | Contents | Comes from |
| --- | --- | --- |
| Coarse Grid | Spacing, Custom, Start, Increment | this panel |
| SpeedPunk | Peak height, Full height at turn, Full colour at turn, Tight colour at turn, Sharpness, Opacity | this panel |
| Snapping and smart guides | Off-curve points cast rays. Snap during a fixed-rib drag. | this panel, the Snapping debug accordion |
| Measurements | Distance, Tension, Angle | `panel-transformation.js`, the Point labels block, right sidebar |
| Tunni | Basic curvature, Skeleton curvature, Basic on-curve, Skeleton on-curve | the View menu, Glyph editor appearance |
| Skeleton | Show generated geometry, Speedpunk on skeleton, Skeleton width | the View menu, and one new field |

**Snapping shows two rows out of about thirty.** The Snapping debug accordion holds the whole
resolver: a weight and a reach per candidate kind, and the acquire and break-free speeds. Those two
rows are the only ones a designer sets. Leave the debug accordion where it is and show these two
here.

**Visual does not replace the View menu.** It is a second way to reach the same switches. Both read
and write `visualizationLayersSettings`, which is the single source of truth. This is the pattern
the gizmo-mode switch already uses, where a panel checkbox and the View menu share one setting. Do
not add a second store.

**Skeleton width is not built.** It is the drawn thickness of a skeleton contour, in screen pixels.
It is a view preference, so it belongs in `applicationSettingsController` with the other two
(decision D9), not in the font.

### 2.4 The toggle

New. Nothing in the tree has one. Every boolean today is a plain checkbox, in core, in the shared
components and in the editor.

Three controls, and the difference between them is what they govern:

| Control | Where | What it does |
| --- | --- | --- |
| **Header toggle** | The right end of an accordion header | Turns the visualization on or off. Off also freezes every control inside the accordion. |
| **Labeled toggle** | A row of its own, label beside it | Turns one option off. Nothing freezes. |
| **Checkbox** | A row, often several across | Picks one of a set. |

A checkbox and a labeled toggle do the same job to the machine. They say different things to the
designer, so both exist. A checkbox belongs to a set, and a toggle stands alone.

**The freeze has no precedent.** Nothing in the tree greys a whole accordion from one control
today. See `UI-NOMENCLATURE.md` §14.

### 2.5 The compact scrub field

The SpeedPunk group draws six fields in two columns. Each is one box holding its own name, a scrub
icon and a right-aligned value.

**The scrub itself is already shared and does not change.** `number-scrub.js` in core owns what a
pixel of drag is worth, and `ui-form.js` puts the scrub on the label of any field row that asks for
it. Five panels use it.

What is new is the shape. A field row today is full width, with the label on the left and the box
on the right, and the label is what you drag. The image wants the name inside the box, a visible
scrub affordance, and two fields per row. That is a field type in `ui-form`, not a second scrub.
See `UI-NOMENCLATURE.md` §14.
