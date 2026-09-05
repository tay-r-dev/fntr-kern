# Kerning view layout overhaul

**Date:** 2026-09-05. **Branch:** `feature/kerning-view`. **State:** designed, not built.

Supersedes `KERNING-VIEW.md` §6 (left pane), §7 (right pane), and part of §5.3
(derivation tactics). The algorithm (§2), the cache (§4), the class data model itself
(§5.1/§5.2), and every "Closed during design" decision in §9 are unchanged. What
changed after a follow-up brainstorm on 2026-09-05, once the actual purpose of a class
was worked through from first principles (see §5 below), is derivation scope and the
pair table's own model — both now folded into this document rather than left as
separate open threads.

**Automatic junk detection** remains a genuinely separate, not-yet-brainstormed item,
tracked in `KERNING-VIEW-BACKLOG.md`.

---

## 0. What a class actually is (the premise the rest of this document builds on)

A stored kerning value is addressed by two sides, and each side is either a literal
glyph name or a class name — spec §5.1's four-step lookup cascade
(`[glyph,glyph] -> [glyph,@class] -> [@class,glyph] -> [@class,@class]`) is just those
four combinations in specificity order. A class name is a **shared variable**: many
glyphs answer to the same stored number. A literal glyph name is **unique**: it answers
only for itself. Class-to-class kerning is therefore not a summary statistic over
individually-measured member pairs — it is a real, storable, first-class kerning entry
in exactly the same sense a flat pair is one. Measuring a class's members is how a
*starting value* for that variable gets estimated; spread (spec §5.2) is how the
designer checks whether the members were actually a good bet for sharing one variable
in the first place. §5 below reworks the pair table around this idea directly.

A follow-up consequence, decided the same session: **kern-row clustering
(`deriveKernRowClusters` in `autokern-classes.js`) is removed, not fixed.** Investigated
first: it requires a glyph to agree, within tolerance, with *every* shared column of
every existing cluster member (a clique, zero exceptions), which is why composite
inheritance — exact by construction — has been the only tactic that ever actually
produced a proposal; optically-driven classes (`O C G Q`-style) were never reachable
through it. A pass over real shipped fonts (Inter, Involve — see conversation, not
re-derived here) confirmed a fixed shape taxonomy (round/vertical/diagonal) wouldn't
have reproduced their actual classes either: Inter's own groups split per side in ways
no 2–3-bucket rule predicts (`g` is its own class, not "round"; `G`/`Q` join it only on
their tail side; `H` groups with `B`/`a`, not with other vertical stems), and Involve
ships zero Latin kerning classes at all — flat pairs sufficed. Real classing reads as a
designer's optical judgement call, not a fixed rule or a tolerant statistical merge.
Derivation is therefore simplified to what's actually reliable:

- **Manual grouping** (font mode multi-select, §2) is the primary path.
- **Composite inheritance** (exact, spec §5.3 tactic 1) stays, unchanged.
- Kern-row clustering, its tolerance field, and the tolerance UI control are removed
  from the Derive section (§1.2).

---

## 1. Panes

Three resizable columns, using the same drag-splitter mechanism `views-editor` already
uses for its own panels — reused, not reimplemented. Replaces the current two-pane
(scene | parameters+table) split entirely.

### 1.1 Left column — the results table

Moved here from today's right pane, but reworked around §0's variable model rather than
relocated unchanged. Today's three glyph-anchored sections (side-1-class-vs-every-
side-2-class, every-side-1-class-vs-side-2-class, flat/unclassed) are replaced by a
filter over the four pair kinds the cascade already defines: **unique×unique**,
**unique×class**, **class×unique**, **class×class**. A row is no longer only "a cache
entry that happens to touch the typed glyph" — a class×class row exists once its two
classes have any measured coverage between their members, independent of any glyph
being typed at all, the same way a fold's parent row already computes real member
stats today (`computeFoldGroupStats`) except no longer gated behind first expanding a
row anchored to a typed glyph.

Every row, regardless of bucket, carries the same suggestion/current/delta/apply shape
already built (`pairRowData`) — a class×class row's suggestion is the median across its
members' measured pairs (unchanged computation, `classSpread`'s reducer), its "current"
is whatever's stored at that class cell (usually nothing, so effectively zero), and its
delta and apply behave exactly like any other row's. Spread displays alongside a
class×class row as its quality readout (spec §5.2, unchanged): tight spread says the
shared variable is a good fit, wide spread says at least one member disagrees and the
class should be expanded to find out which before trusting the number.

Every filter that exists today (side, grouping — now the four-bucket filter above,
sign, state, junk, threshold) carries over, plus the excluded-glyph field and the five
actions (apply selected, apply all, reset to current, reset to zero, mark junk). A
manual, directly-typed value is also always available on any row as an alternative to
accepting the computed suggestion — one input, one apply, regardless of bucket.

**No override in v1.** Applying a value onto a unique×unique or unique×class/class×unique
row when both sides would otherwise resolve through an existing class cell is not
supported yet — doing so silently shadows the class for that one pair (spec §5.1's
already-documented hazard), and making that transparent (a confirmation naming which
class gets shadowed, versus a persistent visual marker on already-overridden rows) is
an open decision, tracked in `KERNING-VIEW-BACKLOG.md` rather than resolved here. Until
it's designed, a suggestion for a pair that would create a silent override is shown but
its apply action is disabled, with a note pointing at the class cell that already
answers for it.

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
- **Derive** control: the Derive button, relocated from today's pair-table section.
  No tolerance field — per §0, composite inheritance is exact and needs no tolerance
  input; kern-row clustering (the only tactic that used one) is removed. Proposals it
  produces are inserted into the class list below, marked proposed, exactly as today
  (spec §5.3) — a proposal is not a separate UI concept from an accepted class, only a
  display state of one.
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
- **Show class** (context menu, on a glyph in any scene mode): opens a dialog to pick
  one or more target glyphs — typing plus preview swatches, same input style as the
  excluded-glyph field — then previews the selected glyph's class(es) against every
  chosen target in the scene, one row per member. This is the optical check spread
  can't give by itself: a number says a class disagrees, this shows what it looks
  like.

**Rerun scoping.** Joining or leaving a class now marks that glyph the same way an
edited outline already does (spec §4's per-glyph keys) — class membership changing
is a reason its row set may need new coverage, exactly like a shape edit is. This
makes the existing marked-only rerun mode (already built) the cheap way to fill in a
newly-classed glyph's missing pairs, rather than requiring a full whole-font run. A
further, narrower scope — restricting a run's candidate pool to only pairs where both
sides already resolve to a class — is a reasonable default for the common
"grouped-first" workflow but wasn't pinned down to a specific button/toggle in this
design; left as an implementation detail.

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

- The measurement algorithm (§2 of `KERNING-VIEW.md`), the cache and its persistence
  (§4), the junk mechanisms (§4.2), and the class data model itself (§5.1/§5.2 — what
  a class is, the cascade, the fold's median/spread reducer) are untouched. What
  changed is derivation scope (§0: kern-row clustering removed) and how the pair table
  presents and filters what the cache already contains (§1.1: four buckets instead of
  three glyph-anchored sections).
- Resizable panes and glyph-color marking are not new engineering: both already exist
  in `views-editor` and are reused, not rebuilt.
- Automatic junk detection remains a separate, not-yet-brainstormed item
  (`KERNING-VIEW-BACKLOG.md`). Override transparency for a unique value shadowing an
  existing class (§1.1) is also tracked there rather than decided here.
