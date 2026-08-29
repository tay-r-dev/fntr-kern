# Skeleton Backlog

**Date:** 2026-08-29. Written on `feature/markers`, verified against the tree at `fbbe86fc4`.

Seven items, from the designer. Each row states what you see, the rule it should follow, and
the files it lands in. Every file path and symbol below came from a grep against the tree, not
from the other documents (architecture map, maintenance rule).

This is a backlog, not a spec. Two rows — **B4** and **B6** — are architectural and each owes
its own design document before any code. The other five are bounded.

| #   | Item                          | Size        | Owns                                              |
| --- | ----------------------------- | ----------- | ------------------------------------------------- |
| B1  | RMB drops the drawn contour   | bounded     | `edit-tools-pen.js`, `edit-tools-skeleton.js`, `editor.js` |
| B2  | Click a point to resume it    | bounded     | `edit-tools-skeleton.js`                          |
| B3  | Three per-side locks, drawn   | bounded     | `skeleton-model.js`, `skeleton-generator.js`, panel, layers |
| B4  | Corner join by intersection   | **architectural** | `skeleton-generator.js`, `offset-contour.js` |
| B5  | Skeleton points snap          | bounded     | `snapping-interactions.js`                        |
| B6  | Convert a contour to skeleton | **architectural** | new core module, `scene-controller.js`, dialog |
| B7  | Gizmo mode still draws labels | bounded     | `visualization-layer-skeleton.js`, `visualization-layer-definitions.js` |

---

## B1 — Right-click drops the contour being drawn

**What you see.** A pen tool keeps the last point active, so the next click appends to the
contour you are already drawing. There is no way to say "that contour is finished". Right-click
opens the canvas context menu instead.

**The rule.** While a pen tool is active, right-click means "let go". It clears the drawing
endpoint, so the next click starts a new contour. **No pen tool shows the canvas context menu at
all**, whether or not a contour is being drawn. This is the designer's decision: one gesture, one
meaning, with nothing to learn about when it applies.

It applies to every pen: the ordinary pen, its quadratic sub-tool, the skeleton pen and the
single-sided skeleton pen.

**Where it lands.** `editor.js:331` binds `contextmenu` on the canvas with no route for a tool to
refuse it. The tool needs a say. Follow the dispatch shape the pointer tool already uses rather
than testing the tool's name at the binding.

The skeleton pen's endpoint lives in `_getDrawingContourId` / `_getDrawingEndpointPosition`
(`edit-tools-skeleton.js`). What "drop it" writes is the open question: clearing the selection is
the obvious answer, and it must go through `editSkeleton` like every other skeleton write (R-C).

**Open.** Escape probably means the same thing and is not bound either. Decide whether B1 covers
both gestures or only the mouse.

---

## B2 — Clicking an existing point makes it the active one

**What you see.** The inverse of B1. With a pen tool, clicking a point that is already drawn
should make that point active, so the next click continues from there.

**The rule.** It already holds for the basic pens. Extend it to both skeleton pens.

**Where it lands.** `edit-tools-skeleton.js:179` already selects an existing skeleton point on
click. So half of this exists. What is unverified is whether selecting it also makes it the
endpoint the next click extends — `_getDrawingContourId` derives the drawing contour from the
selection, so it may already work, and it may only work on a contour end.

**First job is a measurement, not a change.** Click a mid-contour point and a contour end, then
click on empty canvas, and record what each one appends to. Only a point at an open end can be
extended; a mid-contour point cannot, and the tool must do nothing rather than something
surprising.

---

## B3 — Three per-side locks, and a way to see them

**What you see.** A side of a rib can be locked today, and nothing on the canvas says so.

**What locked means today, exactly.** One flag, `locked`, per point per side
(`isSkeletonSideLocked`, `skeleton-model.js:2440`). It does one thing: the side keeps its stored
nudge and handle offsets and **does not apply them**, and the side's generated geometry is not
editable. It does not hold the rib against a width change and it does not lock curvature.

**The rule.** One flag becomes three independent checkboxes per side. They are a check block, not
a mode:

1. **Lock handles** — the side's generated handles hold. The curvature pin is kept and the
   natural solve may not move them. The curvature gizmo on that side is locked with them.
2. **Lock on-curve slide** — the side's generated on-curve holds. The nudge does not apply, and
   the on-curve gizmo is locked.
3. **Lock width** — the side's edge holds its position when the width or the distribution
   changes. This overrides the distribution: a width write moves the other side alone.

Today's single flag is roughly (1) and (2) fused. It is replaced, not migrated — there is no
production release, so no file has to be adapted.

**Then draw them.** A locked side must be visible on the canvas without opening the panel. Which
of the three locks is on has to be readable, because they mean different things.

**Where it lands.** `skeleton-model.js` owns the schema and the accessors, and its
`normalizeLocked` (`:3369`) is the one place the shape is decided. The generator reads the flag
in four places today (`skeleton-generator.js:265, 535, 561, 645`); (3) is a new reader on the
width cascade, and (1) is a new reader on the natural solve. The panel is
`panel-skeleton-parameters.js` through `skeleton-panel-edits.js`. The drawing is a new draw in
`visualization-layer-skeleton.js`.

**Watch the cascade.** Lock width has to state which quantity it holds — the side's own
half-width, or the edge's position. They differ the moment the point moves, and the width
fallback cascade (feature model §2) means a point that stores nothing follows the contour
default. A lock that writes a width onto a point to hold it would kill that point's link to the
default. Hold the edge, do not materialize a number.

---

## B4 — A corner is solved by intersecting the two edges

**Architectural. Owes a design document.**

**What you see.** Where the centerline turns a sharp corner, the generated outline is wrong. On
the reported glyph — a diagonal stroke meeting a vertical stem — the outline runs out into two
thin spikes instead of closing the corner. The intended shape is the two strokes meeting at a
clean joint, the way the reference image shows.

**What the code does today.** `calculateCornerNormal` (`skeleton-generator.js:2911`) takes the
signed angle between the two segments' tangents, halves it to get the bisector, and returns the
perpendicular of that bisector as the rib normal. The rib end is then projected one plain
half-width along it. Two things follow, and both are the fault:

- **Both sides get the same normal and the same distance.** The outer side of a corner needs to
  reach further than the half-width to close the gap, and the inner side needs to reach less.
  Neither happens.
- **`halfWidth` is passed to the function and never used.** So the corner's geometry does not
  depend on how wide the stroke is, which is exactly the "the algorithm chooses by the angle
  alone" complaint.

**The rule.** Each of the two arms is offset by its own half-width, on its own. The corner point
lands **where the two offset edges cross**. On the outer side both edges are extended forward to
that crossing; on the inner side both are trimmed back to it. This is one construction for both
sides, and the side falls out of which way the corner turns rather than being branched on.

**It applies to every corner, curves included.** Not only straight-to-straight. Where an arm is a
cubic, what is intersected is that arm's offset cubic, not a tangent ray standing in for it.

**This construction already exists in the tree, once.** `offset-contour.js` states the same rule
for the base-curve expansion drag: *each segment moves along its own normal by its own offset,
and the corner point lands where its two moved segments cross* (feature model §12, log "Base-curve
expansion"). Rail R-B says there is one copy of every geometry function. So the first design
question is whether the generator can call that module rather than grow a second copy — and the
log records that stating this rule as a derivation rather than as a miter length is what made it
come out right last time.

**The bound.** `offset-contour.js` holds the crossing at four times the offset, the standard miter
limit, which bites at a turn of about 151 degrees. Two edges doubling back move to parallel
positions and never cross at all.

The designer's position is that two curves emitted from one corner point always cross. That is
true of an ordinary corner and it is not true at the two ends of the range: as the turn goes to
zero the crossing runs to infinity, and at a doubled-back corner the two offsets are parallel.
The design has to say what happens at the limit, and the answer has to be continuous through it —
a drag passes through these configurations.

**Three hard constraints this must not break.** They are the same three the offset construction
already lives under, and they are why this is architectural rather than a fix:

1. **Point-count stability.** The corner must emit the same number of points at every parameter
   value, or a corner in one master will not interpolate against the same corner in another. A
   crossing that sometimes exists and sometimes does not cannot decide the point count.
2. **Continuity in the input.** The outline is rebuilt on every frame of a drag. Two cubics can
   cross zero, one or several times, and picking "the" crossing is a search. A search that changes
   which root it returns as the skeleton moves smoothly is exactly the jitter the offset
   construction spent five rounds removing (log, offset construction rounds 5–7). Read that
   section before designing the root find.
3. **Corner rounding sits on top.** `roundSharpCornersOnSide` replaces the sharp corner with an
   arc, and reads the corner the construction produced. Moving where the corner point is moves
   what rounding starts from.

**Test it with a sweep, not an assertion.** Hold the geometry fixed, walk the corner's turn and
the half-width through their ranges in fine steps, and measure the worst single-step movement of
any emitted point. Start away from a degenerate configuration. This is the method that has caught
every fault in this area and the one that assertions have missed.

---

## B5 — Skeleton points take part in snapping

**What you see.** Drag something near a centerline point and nothing snaps to it.

**What the code does today.** The snapping subsystem is `fontra-core/src/snapping.js`,
`views-editor/src/snapping-interactions.js` and `visualization-layer-snapping.js`. Skeleton points
already enter it as **movers**: `draggedSnapPositions` reads the `skeletonPoint` selection and asks
the resolver about those positions. What they never do is enter it as **targets** —
`buildSnapScene` walks `glyph.path` and nothing else, so the only things anything can snap *to*
are path points and segments.

So this is one gap, in one function, and the half that is harder is already built.

**The rule.** A skeleton contributes three kinds of target:

1. **Its on-curve points**, the way path on-curve points already do.
2. **Its rib endpoints** — the stroke's edge at that point.
3. **Alignment rays from its on-curve points**, so geometry can be lined up with a centerline.

Skeleton segments are deliberately **not** targets. On-segment snapping to a centerline was
offered and not taken.

**Where it lands.** `buildSnapScene` in `snapping-interactions.js`. Rib positions and normals come
from `skeleton-model.js` and must not be recomputed there (architecture map §8, "make feature X
skeleton-aware").

**The exclusion rule already has the shape this needs.** `excludedPointIndices` drops the moved
geometry and the generated geometry that follows it, and it finds the second by provenance lookup
and never by geometric match (R-D). A skeleton point that is itself being dragged must not be a
target for its own drag, and that is the same lookup.

**Note for the architecture map.** The snapping subsystem has no row in the feature inventory and
appears in none of the four documents, although `docs/superpowers/specs/snapping.md` and
`plans/2026-08-26-snapping.md` exist. Whoever takes this row should add the row while they are in
there.

---

## B6 — Convert a contour to a skeleton

**Architectural. Owes a design document.**

**What you see.** Nothing. A drawn outline cannot become a skeleton.

**The rule.** Right-click a base contour, pick "Convert to skeleton", and a small dialog asks for
three things: a **width**, a **width preset**, and a **mode** — single-sided with a side, or
double-sided.

**The geometry is verbatim.** Every point and handle of the contour is copied to a new skeleton
contour, unchanged, and the chosen width is applied to its points. Nothing is fitted and nothing
is searched for. On single-sided the drawn contour therefore stays exactly where it is and
becomes one edge of the stroke; on double-sided it becomes the centerline and the stroke grows
either side of it.

Deriving a centerline from a filled letter shape — a medial axis — is a different and much harder
feature. It is **not** this row. File it separately if it is wanted.

**Which presets.** The per-source base widths, held by glyph case in the skeleton defaults
(`panel-skeleton-defaults.js`, `FONTRA_INTERNAL_SECTIONS.SKELETON_DEFAULTS`). Note that the only
preset *list* in the tree today is the serif one; the widths are defaults rather than a named
list, so the dialog's "preset" select may need that list to exist first. Settle this in the
design.

**Where it lands.** The conversion itself is pure and belongs in `fontra-core` with mocha tests
(R-A). The menu entry goes in `scene-controller.js` beside the other contour actions. The write
goes through `editSkeleton` (R-C) — the conversion produces a skeleton and a generated outline in
one change, with rollback.

**The three things the design has to answer.**

1. **What happens to the original contour.** It is consumed, and the generated contour takes its
   place. That changes the contour list, so `generatedContourIndices` has to be correct in the
   same change — this is the bug the donor hit twice (architecture map §9).
2. **Smooth flags and direction ownership.** A smooth point with one handle has no direction of
   its own, which is what ties ribs across a straight (feature model §3, step 0). A converted
   contour arrives carrying whatever smooth flags it was drawn with, so a conversion can tie ribs
   the designer never asked to tie. Decide whether that is right or whether the flags are cleared.
3. **Closed contours.** A closed skeleton emits two generated contours, an outer and a
   counter-wound inner. Converting a closed outline therefore turns one loop into two, which is
   correct and is worth saying out loud in the dialog.

---

## B7 — Gizmo mode still draws the generated handle labels

**What you see.** Turn the generated-segment gizmos on, and the labels on the generated handles
are still drawn. They belong to the direct-manipulation mode the gizmos replace.

**What the code does today.** `fontra.skeleton.generated-tunni` is the single source of truth for
gizmo mode: the panel checkbox and the View menu both read and write it, and
`editableGeneratedAtPoint` returns null while it is on (architecture map §3 F7). Two label layers
draw near generated geometry, and **neither reads that switch**:
`fontra.skeleton.point-labels` (`visualization-layer-skeleton.js:883`), which draws the
centerline's own handle labels, and the ordinary `fontra.point.labels`, which the generated path
points share with hand-drawn ones.

**The rule.** While gizmo mode is on, the generated handles' labels are not drawn. The
centerline's own labels are unaffected — the two label sets were separated on purpose (registry
item 4.1) and stay separate.

**Where it lands.** Whichever layer is actually drawing them, which the first ten minutes of this
row must establish. `visualization-layer-skeleton.js` for the skeleton set;
`visualization-layer-definitions.js` for the ordinary one.

**Read the switch, do not add a second one.** Gizmo mode has one source of truth and the reason
it has one is that a panel checkbox and a menu item drifted apart before.

**Precedent.** The log records the wrong version of this fix: hiding all generated nodes to stop
them looking selected removed the symptom and the feature together. Only the off-curve nodes are
hidden, and only in gizmo mode. Hide the labels on the same terms.

---

## Order

**B7, then B1, then B2, then B5, then B3.** B7 is the smallest and is a one-layer read. B1 and B2
are one gesture pair and are best done together. B5 is one function. B3 is a schema change and a
new drawing, so it is the largest of the bounded rows.

**B4 and B6 wait for their design documents.** B4 is the one with real risk: it changes the
geometry of every corner in every glyph, under a construction that has to stay continuous while
the designer drags and has to keep the point count fixed. B6 is large but low-risk, because it
writes new data and changes nothing already drawn.
