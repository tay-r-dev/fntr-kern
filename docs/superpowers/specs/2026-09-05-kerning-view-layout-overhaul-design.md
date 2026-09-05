# Kerning view layout overhaul

**Date:** 2026-09-05. **Branch:** `feature/kerning-view`. **State:** designed, not built.

Supersedes `KERNING-VIEW.md` §6 (left pane) and §7 (right pane) on layout only. The
algorithm (§2), the cache (§4), the class data model (§5.1–5.3), and every "Closed
during design" decision in §9 are unchanged — this document is about where things sit
on screen and how a class gets built by hand, not about what a class is or how it's
measured.

Two related but separate items came out of the conversation that produced this design
and are deliberately **not** part of it, to keep this document buildable as one plan:

- **Kern-row clustering tolerance.** `deriveKernRowClusters` (`autokern-classes.js`)
  requires a glyph to agree, within tolerance, with *every* shared column of every
  existing cluster member before it can join — one disagreeing column anywhere blocks
  the merge. This is why composite inheritance is the only tactic that has ever
  produced a proposal in practice: it's exact by construction, while the clique
  requirement makes row clustering fire close to never on real measured data, so
  optically-driven classes (`O C G Q`-style) are never proposed. Fixing this means
  changing what "agree" means (tolerate a minority of outlier columns, the same
  "exceptions allowed" posture §5.2's fold view already has via median + spread), which
  is its own design question, not a layout one. Tracked for a follow-up brainstorm.
- **Automatic junk detection.** Also flagged as a follow-up brainstorm, and likely
  related to the clustering fix above (both are "mostly agrees, flag the outlier"
  problems).

---

## 1. Panes

Three resizable columns, using the same drag-splitter mechanism `views-editor` already
uses for its own panels — reused, not reimplemented. Replaces the current two-pane
(scene | parameters+table) split entirely.

### 1.1 Left column — the pair/results table

Today's §7.3 content, moved here unchanged: the glyph field (overridden by the scene
selection), the three sections (side-1-class-vs-every-side-2-class,
every-side-1-class-vs-side-2-class, flat/unclassed), every filter (side, grouping,
sign, state, junk, threshold), the excluded-glyph field, and the five actions (apply
selected, apply all, reset to current, reset to zero, mark junk). No logic changes —
this is a relocation.

### 1.2 Middle column — preview, two rows

**Top row: the scene.** Chip selector gains a third value: `phrase | pair | font`
(§2 below covers `font`).

**Bottom row: the class panel.** Always visible, regardless of which chip mode the top
row is in — it is not part of the scene and does not get replaced when the chip
switches. Contents, top to bottom:

- **New class** control: three buttons, `1st` / `2nd` / `both`, mirroring the icon
  convention in the FontLab reference (a class is created for side 1, side 2, or both
  at once). "Both" is a creation-time convenience only: it writes two independent
  classes, one per side's group dictionary, with the same name and the same starting
  membership. After creation they are two ordinary, independent rows — editing one's
  membership later never touches the other. This adds no new concept to the data
  model (spec §5: "a glyph holds one class per side and the two are independent"); it
  just does two of today's single-side writes in one action.
- **Derive** control: the tolerance field and Derive button, relocated from today's
  pair-table section, unchanged in behavior. Proposals it produces are inserted into
  the class list below, marked proposed, exactly as today (spec §5.3) — a proposal is
  not a separate UI concept from an accepted class, only a display state of one.
- **Class list**: one flat list, every class from both `groupsSide1` and
  `groupsSide2`, each row tagged with a small 1st/2nd badge (same icon convention as
  the New class buttons) and colored by its assigned swatch (§3). Long membership
  lists truncate with a count, as the fold view already does (spec §5.2). Selecting a
  row is what "selected class" means everywhere else in this panel and in font mode's
  add-to-class actions (§2).
- **Glyph-swatch strip**: shows the selected class's members as glyph swatches, the
  same visual language `views-editor`'s glyph search / glyphsets panels already use
  for a list of glyphs. This is what makes a class's membership visible without
  switching to font mode or hunting through the pair table — it answers the "I
  accepted a class and can't see what's in it" complaint directly, independent of
  the pair table's own cache-coverage-gated display.

### 1.3 Right column — parameters and status

Status strip (spec §7.5: source selector, font-wide counts) moves to the **top** of
this column, always visible. Below it, the parameters section (threshold, envelope
reach, envelope type, reduction, strength, Run button), then the calibration readout
(§7.4), collapsed by default as today. No content changes, only the top/bottom order
flip relative to today's spec (§7.5 currently sits at the bottom).

---

## 2. Font mode

A third scene mode, alongside `phrase` and `pair`. A font-overview-style glyph grid
that supports multi-select. Reuses `font-overview.js`'s existing grid and selection
machinery rather than building a second implementation of a glyph grid (rail R-A: the
same reuse discipline the rest of this view already follows for the scene, the tools,
and the pair-reading path).

Two ways to act on a font-mode multi-selection, both requiring a class already
selected in the class list (§1.2):

- A button on the class panel, **"Add selection to selected class."** Disabled unless
  both a grid selection and a class-list selection exist.
- A right-click context menu on the grid selection, with two entries:
  - **Add to selected class** — same action as the button, available without moving
    focus to the class panel.
  - **Add to…** — opens a picker dialog to choose a different existing class (by
    side) or create a new one, using the same 1st/2nd/both control as §1.2's New
    class action.

Neither path is drag-and-drop — declined during this design as excessive interaction
for a multi-select-then-act flow that a button and a context menu already cover.

---

## 3. Class color

Each class gets an assignable color. Stored as project data — a class color is the
designer's judgement about how to scan their own class list, not derived data, and it
must survive a change of machine, so it follows the same storage rule spec §4.1 already
sets for junk marks and the excluded-glyph list: font backend customData, not
browser-side storage. Key shape: one entry per (side, class name) pair, e.g.
`fontra.autokernClassColors: { side1: { <className>: <color> }, side2: { ... } }`,
written through `fontController.performEdit` the same way
`writeJunkMarksToProject`/the excluded-glyph field already do.

**Display only.** The color shows as the swatch background behind a class's row in the
class list (§1.2) and nowhere else — not on the canvas, not in the font-mode grid.
Declined the FontLab-style grid tinting during this design: this workspace's grid glyphs
already carry their own multi-select highlighting, and layering a second, independent
color meaning (class membership) on the same cells was judged more confusing than
useful without a concrete need for it yet.

---

## 4. What this does not change

- The algorithm (§2 of `KERNING-VIEW.md`), the cache and its persistence (§4), the
  junk mechanisms (§4.2), and the class data model itself (§5.1–5.3) are untouched.
  This document only relocates existing UI and adds the class list, font mode, and
  color as new UI surfaces over the same data.
- Resizable panes and glyph-color marking are not new engineering: both already exist
  in `views-editor` and are reused, not rebuilt.
- Kern-row clustering's strictness and automatic junk detection are explicitly out of
  scope (see the top of this document) and will each get their own brainstorm.
