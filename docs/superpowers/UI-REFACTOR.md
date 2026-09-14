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

**Three things in Visual are not defined.** The Tunni labels do not map cleanly onto the layers:
Basic curvature, Basic on-curve and Skeleton curvature read as Tunni point, Tunni handles and
Skeleton Tunni, and Skeleton on-curve has no layer that is not already the gizmo-mode switch. Show
generated geometry and Speedpunk on skeleton have no setting behind them. All three need the
designer before they are built.

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

---

## 3. Pair table

**Image:** `kerning results.jpg`. **Feature:** F13, kerning view.
**Files:** `views-kerning/kerning.html`, the `#kerning-pairtable-section` column.
`views-kerning/src/kerning.js` renders the table. `views-kerning/src/results-model.js` owns row
visibility.
**Nature of the change:** the control block is regrouped, and the table becomes a windowed list.

### 3.1 What the image keeps

The column order is today's, unchanged: Glyph L, Current, Proposed, Delta, Glyph R, Apply, Hide.
Sorting works already, and the small triangle is the indicator the header draws. The row-count line
is the load-status element. The select-all tick stays in the Glyph L header cell, where it adds no
column of its own.

### 3.2 The new order

| Band | Holds |
| --- | --- |
| Title row | **Kerning**, and the two tabs at the right end |
| Glyph | The label and the glyph field, unchanged |
| Switches | Only marked, zero-current, group members, show hidden |
| Rule | A plain horizontal rule |
| Dropdowns | Side, Glyphset, Class relationship, Unicode types |
| Table | The table, with a vertical resize grip |
| Count | Showing N of N rows |
| Actions | Apply selected, Reset selected to zero, Deselect |

Three moves.

1. **The tabs rise to the title row**, right-aligned, drawn as a pill with the active half filled.
   They stay a **tab swap**: one is active, never both. They are two buttons in a tablist today, so
   this is placement and styling only.
2. **The action buttons fall below the table.** They act on what the table shows, so they belong
   after it. They sit above it today.
3. **Only marked becomes a labeled toggle.** The other three stay checkboxes, because they belong
   to a set. See `UI-NOMENCLATURE.md` §14.1.

**Show hidden keeps its place on that switch row.** It is not drawn in the image. It cannot be
dropped: the autokern panel's Hidden results counter turns it on by name, and a hidden row is
reachable in no other way.

**Zero-current is a shorter label over the same mechanics.** It still shows or hides rows whose
current value is zero. The wiring does not change.

### 3.3 The four dropdowns

Side, Glyphset, Class relationship and Unicode types share one row. Each is a button that opens a
list of checkboxes.

| Dropdown | Today |
| --- | --- |
| Side | A plain select: left or right, glyph on left, glyph on right |
| Glyphset | A plain select |
| Class relationship | A fieldset of four checkboxes, always open |
| Unicode types | A fieldset of seven checkboxes and a note, always open |

The two fieldsets cost a block of the panel each and are set once and then left. A dropdown gives
the row back. Four instances on one row is why this is a shared component and not four local
builds. See `UI-NOMENCLATURE.md` §14.

### 3.4 The column toggles move to the header

The Columns fieldset goes. Current, Proposed, Delta and Apply become entries in a context menu on
the table header, opened with the right mouse button. Same four settings, same effect on display
only. They never change which rows show and never change what an action targets.

### 3.5 The table becomes a windowed list

This is the one change in behavior, and the largest piece of work in this chapter.

**Today the table only grows.** It renders 100 rows, and a Load next 100 button raises the limit by
100 and appends. The limit never falls. Nothing is ever removed. On a large font the document ends
up holding every row the filters admit.

**The target holds a window.** It loads 25 rows at a time as the designer scrolls, drops the 25
furthest behind, and keeps at most 100 rows in the document. Scrolling back loads the dropped rows
again. The Load next 100 button goes with the old model.

Three things this must not break.

- **A ticked row keeps its tick while it is out of the window.** Selection is held by row identity
  today, not by element, and it has to stay that way.
- **The count line still counts every row the filters admit**, not the rows in the window.
- **Select-all still means every row the filters admit.** Its label says loaded rows today. That
  wording has to change with the model.

**The table also gains a vertical resize grip** at its bottom edge, so the designer sets how much
of the column the table takes. The middle column already has such a gutter to copy.

---

## 4. Metrics panel

**Image:** `metrics.jpg`. **Feature:** core Fontra, F6 Letterspacer, F14 metrics keys.
**Files:** `views-editor/src/panel-selection-info.js` is the panel.
`views-editor/src/panel-letterspacer.js` is the block inside it.
**Nature of the change:** a rename, a new heading with one new button, and three controls that
change shape. Nothing about spacing math moves.

The image shows the panel with nothing selected. The panel also grows coordinate rows for a
selection, which do not change. It also hosts the Skeleton defaults block today, which leaves for
the Skeleton settings tab, per §6.1.

### 4.1 What is already built

Glyph name, Unicode, Advance width, Sidebearings and Dimensions are all here and stay as they are.
So is the kern group pair of fields. So is the whole Letterspacer block, bulk apply included: the
glyphset select, the subset checkboxes, the Apply bulk button with its status line, and the
Calculate and Apply buttons.

### 4.2 The rename

The panel is **Metrics**. It reads **Glyph info** today, from `sidebar.selection-info.title`.
Change the string. The identifiers do not change.

### 4.3 Kerning becomes a heading

The kern group left and right fields sit loose in the form today, with no heading above them. They
gain one, and a **Go to kerning view** button beside them.

The button opens the kerning view and writes the current glyph into that view's glyph field, so the
designer arrives at the pairs for the glyph they were drawing. The Font menu already reaches the
view with nothing carried across.

### 4.4 Three controls change shape

**The Letterspacer enable becomes a header toggle.** It is a checkbox today. The setting is the same
one, stored per font. This is the header toggle from §2.4.

**Area, Depth and Overshoot become compact scrub fields, three across.** They are number rows today.

**Apply left, Apply right and May replace metrics keys become checkboxes**, labeled Left, Right and
Override variables, on one row with Reference. They are number fields holding 0 or 1 today.
Same control the SpeedPunk group asks for, in `UI-NOMENCLATURE.md` §14.

**Reverse becomes an icon inside the Area field.** It is a button labeled Reverse today, sitting
beside the three sliders. It becomes a pair of round arrows at the left end of the Area field,
because Area is the number it solves for.

Its behavior does not change, and the part worth keeping is the guard. The first press arms a
warning and shows it as a tooltip. Only the second press reverses. An icon must keep both presses.

### 4.5 Calculated becomes a table

One line of text today: `Calculated: LSB=…, RSB=…`. It becomes a small table, a column for left
and a column for right, with the current row above the calculated row. Calculate and Apply move to
the right of it, from their container under the section.

Layout only. Both buttons keep what they do and when they are greyed out.

---

## 5. Selection panel

**Image:** `transform.jpg`. **Feature:** core Fontra, F4 Tunni, F7 Skeleton, F10 tension-aware
scale.
**Files:** `views-editor/src/panel-transformation.js` and
`views-editor/src/panel-skeleton-parameters.js` become one panel.
`views-editor/src/skeleton-panel-model.js` and `skeleton-panel-edits.js` are unchanged.
**Nature of the change:** two panels merge, several controls change shape, and one command is
deleted.

### 5.1 Two panels become one

The panel is **Selection**. It holds two title-level blocks.

| Block | Sections |
| --- | --- |
| **Selection** | Transform, Flip, Align, Distribute, Bools, Smart scale, Harmonize |
| **Skeleton** | Generation, Terminal, Corner rounding |

The Skeleton block carries a Gizmo and Handles pair at its top right. That is the gizmo-mode
switch, which the layer setting already owns as its single source of truth.

**Point labels leaves this panel.** It becomes Measurements in the left sidebar, per §2.3. Nothing
is left behind.

### 5.2 The image draws every terminal at once. A point never does.

Square, Rounded, Drop and Serif are all drawn, and Corner rounding under them. A real point shows
**one** of the five terminal kinds, or Corner rounding. Never both, and never two terminals.

### 5.3 Transform

**The origin control gets smaller and gains a direct-point button.** The nine-position grid stays.
The new button beside it sets the origin to a point the designer picks.

> **Reported defect, not confirmed in the code.** The designer reports that the origin steers Flip
> and nothing else. The code routes Move, Scale, Rotate, Skew, Dimensions and both Flips through one
> transform entry that pins every transform at the origin, so the fault is not visible by reading.
> Reproduce it in the editor before changing anything.

**Preserve aspect ratio has no setting today** and no stated effect. It needs the designer before it
is built.

**Smart scale is the tension-aware scale**, the behavior held on X (F10). Two labeled toggles:
preserve aspect ratio, and slide adjacent tension points. The second is `slideBothTensionPoints`
and already has a control. The development log's F10 section is the reference for what these do.

### 5.4 Harmonize

**The method becomes a text segmented control**: preserve, recompute, move on-curve. It is a
three-position slider today. One press still draws one answer, so this is the shape the control
should always have had.

G3 becomes a labeled toggle. Equalize handles and Other sources stay checkboxes. **Run** keeps its label and sits
at the right of the section header.

**Balance is deleted.** It is a separate command today, beside Harmonize, with its own action and
context-menu entry. Remove the panel entry, the action and the menu item. The development log
records why the two could never be one press. That reasoning stands and is now moot.

The small external-link icon beside the Harmonize heading is not specified. Ignore it.

### 5.5 Generation

Total and Distribution on one row, left and right widths on the next. Then four icon groups: Lock,
Projection, Link, Reset.

**The section header carries a preset control.** A dropdown, an add button and an update button.
Add writes the current values as a new preset. Update writes them over the selected one. Every
terminal section carries the same three.

**Force angle moves to Generation**, under the widths, for every point. It is the rib angle lock:
Free, Vertical, Horizontal, with the lock mode behind its overflow. It applies at ends and at
corners, as the lock always has. Commit 06ce4ab21 opened it to every point because the field and
the generator were always per point.

**Projection is the contour's sides.** D, L and R are both, left and right, today's Sides select.
Its overflow is a multi-select dropdown with two checks, keep shape and preserve changes. They are
today's Keep form and Keep edits settings, and preserve changes stays disabled while keep shape is
off. This is the component from §3.3.

**Lock, Link and Reset are today's checkboxes and buttons.** Lock holds the three lock kinds:
handles, slide and width. Link holds Linked and Tied ribs. Reset holds reset rib, reset handles and
reset this handle. **Detached is not drawn** and stays reachable until the designer places it.

### 5.6 Terminal

**A text segmented control picks the kind**, five across: Flat, Square, Rounded, Ball, Serif.

**Flat and Square stay separate kinds.** A Square cap adds a point on a side only once its distance
or angle leaves zero, so folding Flat into it would put every former flat end one nudge away from a
point-count change. Flat has no fields and no section.

| Section | Fields | Called today |
| --- | --- | --- |
| Square | Project angle, Distance | Cap angle, Cap distance |
| Rounded | Radius, Roundness | Cap radius ratio, Cap tension |
| Drop | Size, Shape, Ease | Ball size, Ball shape, Easing |
| Serif, Wing | Width, Height, Slope, Tip cut | Wing length, Tip thickness, Wing slope, Tip cut |
| Serif, Bracket | Reach, Tension, Concavity | Reach, Tension, Concavity |
| Serif, Easing | Distance, Curvature | Ease distance, Ease curvature |
| Serif, Cup | Cup, Cup balance, Cup tension | Underside cup, Cup balance, Cup tension |
| Serif, Angle | Force angle, Tilt | Serif axis, Axis tilt |

A group heading now carries the word each label used to repeat, which is where the shorter names
come from. **Tension keeps its name** in the Bracket group.

**Serif Force angle is a segmented control with an overflow.** It is the serif axis. Free, Vertical
and Horizontal are on the control, and absolute angle and tilt sit behind the overflow.

**The rib angle lock mode is the overflow on Generation's Force angle**, see §5.5, not Square's.
It was drawn under Square in the image. Two entries: keep the footprint, or keep the stem
width. That is `ribAngleLockMode`, whose two values are `rib` and `stroke`. The feature model
§3.2 states the trade, and the development log measured it: a locked rib cannot hold both the
stated width and a clean interpolation, so the point says which it keeps.

**The serif carries two preset controls**, one per half, with a chain between them.

### 5.7 Corner rounding

Distance and Curvature, each a left and right pair with a chain. Both exist.

**Distribution is not specified and is not built.** The image draws a slider at 60. Corner rounding
is a distance and a curvature per side and a linked flag, and nothing else. **This needs
brainstorming before anyone builds it.** Do not guess it from the picture.

### 5.8 The chain

Every skeleton row is a left value, a chain, and a right value. A closed chain greys the right
value and writes both from the left.

The linked state exists in the data. The per-row chain does not: the panel has one linked flag per
block today, shown as a checkbox. The chain is a new control and this panel uses about twenty of
them, so it is shared. See `UI-NOMENCLATURE.md` §14.

---

## 6. Skeleton settings

**Image:** `skeleton settings.jpg`. **Feature:** F7 Skeleton.
**Files:** `views-editor/src/panel-skeleton-defaults.js`, and the collapsed-points switch in
`panel-skeleton-parameters.js`.
**Nature of the change:** a new tab, and the source defaults stop being fixed fields and become two
preset tables.

### 6.1 Placement

**Skeleton settings takes the Skeleton tab's place** in the right sidebar. The point controls that
tab holds today move into the Selection panel, per §5. The Source defaults block leaves Glyph info
and comes here.

### 6.2 Settings

**Delete collapsing points** becomes a labeled toggle. It is the checkbox Drop points that draw
nothing today. It keeps its warning: taking it forfeits interpolation for serifed glyphs in that
master.

### 6.3 Width presets

One table for every master and every case.

| Column | Holds |
| --- | --- |
| Name | The preset name, with its master and case beside it in grey |
| Width | One number, the total width |
| Side | The projection: both, left or right |
| Action | Trash |

**New preset** and **Preset from selection** sit under the table. Preset from selection takes the
total width of the selected points and the projection of their contours.

**What this replaces.** Today each master stores base, horizontal and contrast widths and a
distribution, once for lowercase and once for capitals, plus a list of custom widths per case. The
block shows only the current glyph's case.

- Base, horizontal and contrast stop being fixed fields. They become three presets with those
  names.
- Custom widths become presets in the same table.
- **Distribution is dropped.**

**A width preset carries its side, and the side is the projection.** A preset always stores the
total width. Applied, it switches the selected contours to its projection, honoring Keep shape and
Preserve changes, then writes its total to the selected points. The image draws no Side column. Add
one.

### 6.4 Terminal presets

**Serif presets become terminal presets**, and cover the four terminal kinds of §5.6 that have fields. Flat has none, so it has no presets.

| Column | Holds |
| --- | --- |
| Type | Square, Rounded, Drop or Serif |
| Name | The preset name, with its master and case beside it in grey |
| Action | Pencil and trash |

**The pencil opens a dialog** holding every parameter of that preset. A terminal has too many
numbers to fit a row. The dialog uses the same controls the Terminal section of §5.6 uses.

**New preset** and **Preset from selection** sit under the table. Preset from selection takes the
selected terminal's kind and parameters. It is today's Create from selection, widened from serifs
to the four kinds that have fields.

A serif preset is one wing plus the underside cup and carries no axis, per feature model §8. The
other three kinds need the same rule written down before they are built: a preset shapes a
terminal and never places it.

### 6.5 Filters

Each table carries three controls in its header: **Current**, a **Master** dropdown and a **Case**
dropdown. The terminal table adds a **Type** dropdown.

**Current** sets the Master and Case filters to the master and case of the glyph being edited, in
one click. Master and Case then narrow the table from there.

---

## 7. Markers panel

**Image:** `markers.jpg`. **Feature:** F11 Markers.
**Files:** `views-editor/src/panel-markers.js`.
**Nature of the change:** form rows become tables, and the glyph-wide commands become per-section.
The model does not change.

### 7.1 Rays and Dimensions become tables

The image heads the first table **Heading**. It is **Rays**.

| Column | Holds | Today |
| --- | --- | --- |
| ID | The marker label | The first part of the row |
| Nodes | The two ends it spans, as `1 → 4` | The place after the label |
| Value | The measurement | The measurement |
| Goal | The target, with the delta beside it | An editable target, and the delta beside the measurement |
| Group | A group dropdown | A group select |
| Action | Eye and trash | A dot and a cross |

**Dimensions keep Goal.** The image draws their table without it. Both kinds carry a target today,
and both keep it.

**Everything editable stays editable.** The Goal cell takes a typed number, as the target field does
today. The Group cell is a dropdown.

**A stale marker** still reads as broken in the Value cell, and carries no delta.

Both tables carry a vertical resize grip.

### 7.2 The section commands

Show all, Hide all and Erase all sit under the lists today and act on every marker in the glyph.
They become an **eye and a trash in each section header**, and act on that section only.

**The trash keeps its guard.** Erase all takes two presses today. The first press only changes what
the button says, and the arming lapses after a few seconds. An icon has no text to change, so the
first press arms a tooltip instead, the way Reverse does in §4.4. The lapse stays.

### 7.3 Groups

A row per group: the name, the member count, an eye and a trash. **New group** sits under them.

The visibility checkbox becomes the eye. The cross becomes the trash. Deleting a group still leaves
its markers in place and ungrouped.
