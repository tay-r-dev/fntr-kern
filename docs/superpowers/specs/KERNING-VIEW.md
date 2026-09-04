# Kerning view and autokern

**Date:** 2026-09-04. **Branch:** `feature/kerning-view`. **State:** specified, not built.

A spacing and kerning workspace, reached from the Font menu after Font Overview. The left half is
a string preview with three tools. The right half computes kerning suggestions for every pair in
the font, shows them against what is stored, and writes the ones the designer accepts.

The suggestion engine is ported from **halfkern** (`_external/_spacing-kerning/halfkern`, Google,
Behdad Esfahbod). Nothing of its Python is kept. §2 states the algorithm, §3 states what the port
replaces and why.

Three sibling tools sit beside it in `_external/_spacing-kerning` and are not ported: `atokern`
(neural), `bubble-kern` (hand-drawn envelopes, Glyphs plugin), `counter-space` (counter-shape
spacing). BubbleKern's README carries the argument against an unfiltered all-against-all run and is
worth reading before §4.

---

## 1. What the feature is

The designer types a phrase, reads it, and fixes the spacing and the kerning in it. Beside that, one
run measures every glyph pair in the font and reports where its answer disagrees with what the font
already says. The designer accepts what they agree with, one pair or one class at a time, or all of
it.

The tool suggests. It never writes on its own. A run fills a table and nothing else.

**It kerns relative to the spacing that is already there.** The calibration in §2 reads the current
sidebearings of three glyphs. If those are wrong every number the tool produces is wrong, and
nothing else on screen will say so. This is why the calibration readout is an instrument rather
than a setting, and why the letterspacer (map F6) is the other half of this job.

---

## 2. The algorithm

Five steps. Every quantity below is in pixels at the rendering size, until §2.6 converts it.

### 2.1 Raster

Rasterize the glyph's outline to an 8-bit coverage bitmap, padded on all sides by the envelope
reach, which the code calls the **bias**. On a skeleton glyph this is the generated outline, which
needs no special case: `glyph.flattenedPath2d` is a cached `Path2D` that already carries the
decomposed components, and filling it onto an offscreen canvas is the whole of it.

The rendering size is derived from the font's units per em so that one pixel is a few units. The
original fixes it at 100, which at 1000 units per em makes every answer a multiple of ten. That is
too coarse to ship.

### 2.2 Envelope

Two forms, and the first is the default.

**Distance field.** Full intensity inside the glyph. Outside, a linear ramp falling from half
intensity at the edge to nothing at the bias distance. The original solves the eikonal equation
with `scikit-fmm`; an exact Euclidean distance transform is the same quantity and is more accurate.
Seed each boundary pixel at one half minus its coverage, so the envelope starts sub-pixel accurate
the way a solve over the antialiased coverage does. A transform on a binarized mask throws that
away.

**Gaussian.** A separable convolution, twice, rows then columns.

### 2.3 Overlap

Place the two envelopes at a candidate kern and take the per-pixel product over the range where
they overlap. Reduce the products by the sum of their squares, which is the default, or by their
maximum.

### 2.4 Calibration

Take three control glyphs, `l`, `n` and `o`, and measure each against itself at its own current
spacing. The smallest and largest of the three results are the target band. If the smallest is
under half the largest the three disagree, so widen the bias and measure again.

The envelope reach in the panel is therefore a **starting value**, not a fixed one. Calibration may
raise it. The panel shows the value it settled on.

### 2.5 Search

At kern zero, measure the overlap. Below the band, step the kern negative by one pixel at a time
until the overlap reaches the band. Above the band, step positive. Give up past twice the bias.

The overlap against kern curve is smooth and monotone, so interpolate between the two bracketing
integers. That buys sub-pixel accuracy for nothing and it is what keeps two geometrically identical
glyphs from landing a step apart, which §5 depends on.

### 2.6 Strength, and the units

**Strength is one multiplier on the answer, applied whatever its sign.** It is a control here, and
halfkern has it as a hardcoded constant.

That constant is also asymmetric there. `kern_pair` returns `kern // 2 if half and kern < 0 else
kern`, so it halves a kern that tightens and passes a kern that loosens through whole. `half`
defaults on and no command-line flag reaches it, and the tool is named after the behaviour. The
source states it and never says why.

**We do not carry the asymmetry.** A case can be made for it: the envelope method over-tightens
round and diagonal pairs, so a fraction of a tightening answer is the safer number, while a
loosening answer usually marks a real collision that wants fixing in full. It was put to the
designer and declined. One number, both signs, decided 2026-09-04.

The answer converts as the kern in pixels over the rendering size, times the units per em.

---

## 3. What the port replaces

| halfkern needs                        | here                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| `pycairo` + `freetype` to rasterize   | `flattenedPath2d` filled onto an offscreen canvas                  |
| `scikit-fmm` for the distance field   | an exact Euclidean distance transform, about forty lines           |
| `scipy` for the Gaussian              | a separable convolution                                            |
| `numpy`                               | typed arrays                                                       |
| `uharfbuzz` to read the existing kern | `kerning-controller.js`, which already resolves groups and sources |
| a PDF proof                           | the left pane                                                      |

No hard dependency survives, and there is no case for WebAssembly.

**The Python route is closed.** Running the tool unchanged needs a compiled binary font, so every
run compiles the whole source and a skeleton glyph's generated outline has to survive the round
trip. It needs cairo, FreeType and `scikit-fmm` as native libraries on the designer's machine. And
it can never answer while the cursor sits on a pair, which is the reason to put this in an editor at
all.

**`kern_triples.py` is not ported.** It adjusts the position of the middle glyph of a trigram and
emits a contextual rule, which is a different feature from kerning a pair.

---

## 4. The cache

**One run measures every glyph pair in the font and the result is the cache.** It is flat: one entry
per glyph pair, addressed by two glyph names, never by a class. Classes are a view over it (§5) and
a decision about where to write, and they are never the thing that is measured.

**The threshold filters the display, not the run.** Scrubbing it costs nothing because the matrix is
already in memory.

Three things the run needs.

- **A prefilter.** Skip any pair whose envelopes cannot touch at any kern in range. This is a
  bounding test and it removes most of the matrix at no cost. Without it a few hundred glyphs is
  tens of thousands of pairs.
- **A worker**, with progress and cancel, shown in a popup.
- **Per-glyph keys.** The font controller's change listener names the glyph that changed. Every
  cached row with that glyph on either side is **marked** and left in place. The rerun has two
  modes, everything or marked only.

A marked row is a suggestion for a shape that no longer exists. It is not deleted, because deleting
it hides the fact that it went stale.

### 4.1 The cache is per source, and it is stored

**A run measures and writes one source.** The outlines differ per source, so the cache is keyed by
source and switching source shows a different cache, not a converted one. The source is chosen in
the status strip (§7.5), which is therefore an interactive control and not a readout.

**The cache persists between sessions.** It is expensive enough to rebuild that a session should not
start by rebuilding it.

**Derived data is stored locally; decisions are stored in the project.** The cache is derived, it is
large — a few hundred glyphs give tens of thousands of surviving entries per source — and it can
always be recomputed, so it belongs in browser-side storage. The junk marks and the excluded-glyph
list of §4.2 are the designer's judgement rather than derived data, they are small, and they must
survive a change of machine, so they belong in the project's own data beside the other per-font
settings.

Writing a cache of that size into the project file would put derived data permanently into the
designer's sources, which every backend round-trips.

### 4.2 Junk

A whole-font run measures pairs no language produces. They clutter the table, and they corrupt class
derivation (§5.3), which is the worse of the two.

Three mechanisms, and they are separate.

- **An excluded-glyph field** sits beside the table. Glyphs named in it take no part in a run and
  appear in no row. It is parsed the same way as the phrase field, so a glyph with no character can
  be named directly.
- **A pair can be marked junk** from its row. The mark is per pair, it survives a rerun, and a junk
  pair is never measured again, never shown by default, and never reaches class derivation.
- **A junk filter** on the table shows or hides marked pairs, so a mark can be found and undone.

The excluded-glyph field is the blunt instrument for whole categories. The junk mark is for the
individual pair that survives it.

---

## 5. Classes

A class is what the field also calls a kerning group. Fontra stores them as `groupsSide1` and
`groupsSide2` and addresses them with an `@` prefix. Side 1 is the left member of a pair, so a
side-1 class is a statement about a glyph's **right** profile. Side 2 is the right member, so a
side-2 class is about its **left** profile. A glyph holds one class per side and the two are
independent.

### 5.1 Why a flat write is not the same as kerning by hand

`getPairsToTry` in `kerning-controller.js` returns four addresses in a fixed order, and the read
takes the first that holds a value:

```
[glyph, glyph]  ->  [glyph, @class]  ->  [@class, glyph]  ->  [@class, @class]
```

The order is specificity, so a flat cell is an exception that overrides the general rule. That is
what a flat cell is for.

It follows that **a flat cell always beats the class cell that would otherwise answer.** Apply a
whole-font run flat onto a project that has classes and every class cell is shadowed. The classes
stay in the file, stay in the panel, and stop affecting anything drawn. Change one later and nothing
moves. The write is legal; the failure happens on every read afterwards.

The second cost is the tool's own. Kerning `ó` by hand you would copy the number from `o`, because
the right side of the two glyphs is the same shape. The engine measures them separately and its
search lands on whole pixels, so it hands back two values a step apart for shapes that are identical
on the side that matters. A class forces them equal, which is correct. This is why §2.5 interpolates.

This is the same mechanism as the skeleton's width cascade (feature model §2). A point that stores
nothing follows the contour default, and writing a width onto every point silently kills it. A class
cell is that cascade for kerning, and a flat run kills it the same way.

### 5.2 Classes are a fold in the pair table

The cache is flat. A toggle above the table folds every row whose pair resolves to the same cell
into one parent.

Flat, selected glyph `T`:

```
T        -48   o
T        -52   ó
Tcaron   -44   o
T        -20   s
```

Folded:

```
> T Tcaron Tbar   -48   o ó ö +9      40 pairs, spread 8
  T               -20   s             unclassed
```

Three things follow.

**The fold is the write granularity.** Applying a parent writes one cell at the median of its
members. Applying a child writes a flat exception. The designer chooses per row by which one they
apply, so there is no write-granularity setting.

The median is the reducer because it is what the eye does and one odd member cannot drag it. A mean
can.

**Spread is the class quality readout.** The parent carries the range across its members. Tight
means the class is right. Wide means the class is wrong or one member genuinely wants an exception,
and expanding shows which. Nothing in the fork gives this today.

**A class's stored name is an address, and the table shows its membership instead.** Naming a class
after one representative glyph is the field's convention and it is misleading, because a class
holding `o c e d q` is not the `o` class. Long lists truncate with a count. An imported UFO keeps
whatever names it arrived with, and the designer may rename anything.

### 5.3 Making classes

Today there is one interface and it is `panel-selection-info.js:326`: two text fields on the
selected glyph, one per side, where typing a name joins that class. One glyph at a time, no list, no
membership view. A font imported from UFO or Glyphs arrives with its classes; a font started in
forkra has none.

The **derive** action sits beside the fold toggle. It clusters the cache and fills the table with
proposed parents marked as proposals, writing nothing until one is accepted.

Two tactics, in this order.

1. **Composite inheritance.** A glyph built from components takes its base glyph's classes. This is
   exact rather than heuristic, needs no tolerance, and covers most of the glyph count in an
   accented Latin font. BubbleKern does the same with its bubbles.
2. **Kern-row clustering.** Glyphs whose whole row of cached values agrees are one class. This is
   not a heuristic; it is the definition, and it is what a compiler's class compression does at
   export. It costs one pass over data the run already produced.

Profile matching and name-suffix rules are the fallbacks and add nothing on top of these two here.

Two constraints on any of them. **Never merge across scripts or Unicode categories without asking**,
or a Latin `o` lands in a class with a bracket. And the clustering needs a tolerance, which is what
makes the sub-pixel interpolation of §2.5 load-bearing rather than a nicety.

Selecting a parent row lists its members and edits them, which replaces the one-glyph field above.

---

## 6. The left pane

The editor's scene, with four tools only: **pointer**, **sidebearing**, **kerning**, **hand**. No
drawing tools, which is the point of a separate view. Pointer is the plain click-to-select tool —
without it there is no way to select a glyph in the string at all, which every other tool and the
pair table's row-to-scene selection depend on. Corrected 2026-09-04: an earlier pass of this spec
said three tools and dropped pointer by mistake.

- **Double-click a glyph** opens the editor on it in a new tab. `getFontMenuItems` in
  `fontra-menus.js` already does this, through `rerouteViewPath` and a URL fragment carrying view
  state.
- **A chip selector sits in the bottom left corner**, holding `pair` and `phrase`. It is the only
  thing that decides what the pane draws. `pair` is disabled until a pair is selected. It has a
  hotkey. Clicking a row in the table selects that pair and flips the chip to `pair`; switching back
  to `phrase` restores what was typed, which is not destroyed.

The sidebearing tool edits a glyph layer, so this view carries the glyph edit path and its undo
beside the kerning one.

---

## 7. The right pane

Top to bottom.

### 7.1 Preview phrase

A field and a dropdown of presets. The presets come from a text file of blank-line separated blocks
whose first line is a comment naming the entry:

```
# Lowercase control
nnonoono
# Caps and rounds
HAMBURGEFONSTIV
HOHOHOOO
```

Parsing is `characterLinesFromString` in `character-lines.js`, unchanged. It already handles
`/glyphname` for glyphs with no character, and splits on newlines, which is what makes a multi-line
entry work.

### 7.2 Parameters

Not collapsed. **Threshold and Run are always visible.** The rest may collapse.

| control        | note                                              |
| -------------- | ------------------------------------------------- |
| threshold      | filters the display, on the delta                 |
| envelope reach | a starting value; calibration may raise it (§2.4) |
| envelope type  | distance field or Gaussian                        |
| reduction      | sum of squares or maximum                         |
| strength       | replaces the hardcoded halving (§2.6)             |

### 7.3 Pair table

A glyph input, overridden by the selection in the left pane. Three sections for that glyph:

1. its side-1 class against every side-2 class,
2. every side-1 class against its side-2 class,
3. flat rows for whatever is unclassed on either side.

**A glyph has two class memberships and they are different lists.** Sections 1 and 2 are not
redundant.

Columns are **left, delta, right**, with an optional current column behind a checkbox. **The delta
is the suggestion minus what is stored**, so a negative delta means tighten further. Sorted by delta
magnitude, worst first, so the table reads as an audit. Alphabetical is a second sort and not the
default.

Filters, composing with the threshold:

- **Side.** Glyph on the left, on the right, or both.
- **Grouping.** Classed rows, flat rows, or both.
- **Sign.** Negative, positive, or both. Tightening and loosening are different passes of work.
- **State.** Pending, applied, or stale. **This one is load-bearing.** Applying a row drops its
  delta to nothing, so it falls under the threshold and leaves the table. With no way to show
  applied rows every apply reads as the row vanishing.
- **Junk.** Marked pairs hidden or shown (§4.2). Hidden is the default, and the filter is the only
  way back to a mark.

An **excluded-glyph field** sits beside the table, holding glyphs that take no part in a run at all.

Actions: **apply selected**, **apply all**, **reset to current**, **reset to zero**, and **mark
junk** on a row. Apply all states how many cells it will write and needs a second press. Each action
is one undo step.

### 7.4 Calibration

Collapsed. It names the three control glyphs, what each measured, the reach it settled on, and
whether the three disagreed and it had to widen.

### 7.5 Status

The bottom of the pane, always visible, and **interactive rather than a readout**. It holds the
**source selector**, which decides what the preview draws, which cache the table shows and where an
apply writes (§4.1). Beside it, font-level counts: pairs cached, pairs above the threshold, pairs
marked junk, and how many cells are covered by a class against how many are flat.

---

## 8. Where the code goes

Rail R-A decides most of this. Rail R-G decides the split between what can be tested and what
cannot.

**Core, pure, mocha-tested.**

| file                                  | holds                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/autokern-engine.js`  | the distance transform, the Gaussian, the overlap, the calibration, the search. Takes typed arrays and numbers. No DOM. |
| `fontra-core/src/autokern-classes.js` | composite inheritance and kern-row clustering over a cache                                                              |

The engine takes a raster, it does not make one. That is what lets the whole of §2.2 through §2.5 be
tested against hand-built bitmaps, the way `letterspacer-engine.js` takes a path. It is the only way
any of this gets a test.

**Adapters and view.**

| file                              | holds                                                                 |
| --------------------------------- | --------------------------------------------------------------------- |
| `fontra-core/src/glyph-raster.js` | path to coverage bitmap. Needs a canvas, so it stays about ten lines. |
| `views-kerning/`                  | a new workspace: the view controller, the panel, the run worker       |

**The scene is imported, never copied.** `views-kerning` needs the scene controller, the scene
model, the tool base, the pointer tool, the metrics tool, the hand tool and the visualization
layers. The closure is
18,714 lines of the 48,114 in `views-editor`, and it does not strip further, because the scene model
imports skeleton editing and base-expand editing for its hit tests and the scene controller imports
six more.

Copying it breaks rail R-B and reproduces defect P4 at the largest possible scale. The specific
failure: kerning is applied where the scene model builds `positionedLines`, so a copy means two
implementations of where glyphs sit in a line, and a kerning fix in the editor would not reach the
view whose purpose is displaying kerning. The log settled this argument once already, on the
single-sided skeleton pen, where the request was to copy a file and the answer was a twelve-line
subclass.

**So: widen the `views-editor` exports map and import across views.** Nothing in the tree imports
across views today, which is the honest cost. It is reversible, it moves no code, and if the
coupling bites, the shared half of the scene moves to `fontra-core` later as its own workstream with
the import sites naming exactly which half is shared.

Registration: a workspace entry in the root `package.json`, a `fontra.view` field in the package, an
entry point in `pyproject.toml` beside the other four, and a menu item in `getFontMenuItems`
(`fontra-menus.js:182`) after `font-overview.title`.

**Test with a sweep, not an assertion.** Walk the kern, the width and the envelope reach in fine
steps and measure the worst single-step movement. Start away from a degenerate configuration.

---

## 9. Closed during design

| idea                                                       | why it is closed                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Run halfkern as a Python subprocess                        | Needs a compiled font every run, three native libraries on the designer's machine, and it can never answer while the cursor sits on a pair. §3. |
| Copy `views-editor` into `views-kerning` and strip it      | 18,714 lines duplicated, against rail R-B and defect P4. Two implementations of `positionedLines` is the specific harm. §8.                     |
| Apply a whole-font run as flat pairs                       | Every flat cell shadows the class cell that would answer, so the classes stay in the file and stop working. §5.1.                               |
| A write-granularity parameter                              | The fold in the table already says it: parent writes a class cell, child writes an exception. §5.2.                                             |
| Keep the halving of negative kerns as a constant           | It is a taste, so it is a control. §2.6.                                                                                                        |
| Name a class after a representative glyph                  | A class holding `o c e d q` is not the `o` class. The name is an address and the table shows membership. §5.2.                                  |
| Build the panel inside the editor first                    | Offered and declined. The separate view is wanted, and the exports route makes it affordable.                                                   |
| Drop stale rows on a glyph edit                            | Deleting a row hides that it went stale. Marked and left, with a marked-only rerun. §4.                                                         |
| Run across every source at once                            | One source per run. The cache is keyed by source and the source selector lives in the status strip. §4.1.                                       |
| Rebuild the cache each session                             | It is expensive enough that a session must not start by rebuilding it. Stored, locally, because it is derived. §4.1.                            |
| Exclude junk pairs by category or by a word list           | Neither knows what this designer considers junk. A per-pair mark and an excluded-glyph field do, and both are the designer's own. §4.2.         |
| Scale a tightening answer differently from a loosening one | halfkern does, and the tool is named after it. Declined by the designer 2026-09-04. One strength, both signs. §2.6.                             |

---

## 10. Open

Every numbered section above is built (2026-09-04: workstreams 1 through 17, engine through the
sidebearing/kerning tools). Build order was the measurement module first, with its tests, because it
was the only part with a harness and every other part consumed its output. What remains is debt
flagged honestly during the build, not unbuilt spec:

- **No undo stack routed to Ctrl-Z in this view.** The sidebearing and kerning tools each construct
  their own `UndoStack` (workstream 17) and pair-table/derive writes reach real, persisted font data
  (workstreams 11, 15) -- but nothing in `kerning.js` registers `action.undo`/`action.redo`, so none of
  it is locally reversible from this view yet.
- **The excluded-glyph field isn't wired into a rerun.** It's parsed, stored, and persisted as project
  data (workstream 11/12) exactly like a junk mark, but `runAutokern` doesn't read it, so it currently
  has no effect on what a run measures.
- **A derived class's Accept has no rollback on partial failure.** `acceptDeriveProposal` (workstream
  15) writes one glyph's group membership at a time; a failure partway through a proposal's member
  list leaves some glyphs joined and others not, with nothing to undo it.
- **The fold is anchored to the pair table's existing per-glyph sections, not the full class×class
  cross-product §5.2's own illustrative example shows** (the `T Tcaron Tbar` × `o ó ö` example).
  Building the general case means the table stops being anchored to one typed/selected glyph -- a
  re-architecture, not a small fix.
