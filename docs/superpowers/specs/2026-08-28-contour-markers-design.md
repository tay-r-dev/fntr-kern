# Contour markers — design

**Date:** 2026-08-28
**Status:** design agreed, not built
**Feature:** F11 — markers

A marker is a measurement the designer places on a drawing and keeps. It sits on a
contour, measures across the black, and stays where it was put while the drawing is
edited. It is saved in the project file per source, and it never reaches a compiled
font.

Two shapes of the same object:

- A **ray**. Placed on a contour, it points inward along that contour's normal and
  stops where the outline leaves the black. It measures that distance.
- A **dimension**. Placed between two points, it measures the distance between them
  and moves with both.

---

## 1. What already exists, and what markers add

Upstream ships a **Power Ruler** (`views-editor/src/edit-tools-power-ruler.js`, 345
lines). It is the ray, already built:

- `flattenedPathHitTester.findNearest(point, extraLines)` finds the outline under the
  cursor and returns the segment and its `t`.
- The normal comes from `nearestHit.segment.bezier.derivative(t)`, rotated a quarter
  turn.
- `pathHitTester.rayIntersections(basePoint, directionVector, extraLines)` returns
  every crossing along the ray.
- Walking those crossings and **accumulating winding** decides which spans are inside
  the black.

That winding walk is the stopping rule this feature asked for: the ray stops where it
leaves the black, so an overlapping contour's interior edge is crossed rather than
stopped at, and entering a counter stops it correctly.

**Do not rewrite any of it.** Markers reuse it whole (rail R-B). What markers add is
everything the Power Ruler deliberately does not have:

|                | Power Ruler                       | Markers                                |
| -------------- | --------------------------------- | -------------------------------------- |
| How many       | one per glyph                     | many                                   |
| Lifetime       | in memory, gone on reload         | saved in the project file              |
| Anchoring      | a base point in glyph coordinates | an address on a segment or a point     |
| Under an edit  | recast from the same coordinates  | rides the curve, or stales loudly      |
| Sources        | the one being viewed              | one per source, same id across sources |
| A wanted value | none                              | target plus delta                      |

---

## 2. Data model

### Where it lives

A new section in `fontra-core/src/fontra-internal-schema.js`:

```js
FONTRA_INTERNAL_SECTIONS = {
  COMPOSITION,
  LETTERSPACER,
  SKELETON,
  SKELETON_DEFAULTS,
  MARKERS,
};
```

Per **layer**, beside `SKELETON`, reached only through `getFontraInternalSection` and
`setFontraInternalSection`. It round-trips through every Fontra backend into the user's
project files, and no font compiler reads `customData`, so it cannot ship into a
binary.

### The section

```js
{
  markers: [ /* marker */ ],
  groups:  [ { id, name, visible } ],
}
```

### A marker

```js
{
  id,                 // stable, never reused
  ends: [end, end],
  signature,          // the structural signature the anchors were written against
  target,             // optional wanted value, in font units
  groupId,            // optional
}
```

`id` is allocated once at placement and never reused, following the skeleton's stable-id
rule. It is what makes multi-source editing coherent: Fontra applies one edit to every
source selected for editing, so the same marker lands in each of them carrying the same
id, and a reader can tell that those copies are one marker seen in several masters.
Placement defaults to the active source alone.

A marker holds no measured distance. The distance is derived on every frame, like a rib.

### An end

Four kinds. A ray is `[anchor, cast]`; a dimension is `[anchor, anchor]`.

```js
{
  kind: ("pathSegment", contourIndex, segmentStart, t);
}
{
  kind: ("pathPoint", contourIndex, pointIndex);
}
{
  kind: ("skeletonPoint", contourId, pointId, t);
}
{
  kind: "cast";
}
```

`cast` carries no address at all — it is the free end of a ray, re-derived every frame
from the anchor's normal and the winding walk.

**An end stores an address and nothing else.** No control points, no coordinates, no
curve snapshot. Validity is decided by the marker-level `signature` (§3), which is a
count and not a geometry. Nothing here searches for an address, and nothing compares a
stored position against a drawn one — that is defect P1 and rail R-D.

### Path addresses are in flattened-path space

`contourIndex` counts through `glyphController.flattenedPath`, which is the glyph's own
contours followed by every component's. That is the path the Power Ruler already
hit-tests against, so a marker can be placed on a component's outline as well as on the
glyph's own.

The consequence is deliberate: adding, removing or reordering a component changes the
signature, so markers stale. That is the loud failure, which is what we want.

---

## 3. Anchoring, and the one rule

Two mechanisms, because the two geometries differ in what they can be named by.

**A skeleton anchor needs no maintenance.** Skeleton contours and points carry stable
ids that are never reused, so `{contourId, pointId, t}` survives any structural edit by
construction. It is never stale. This is rail R-D reused, not re-invented.

**A path anchor is an index, and indices shift.** An ordinary Fontra path point has no
id, so the address is a position in a list. There is one rule for it:

> **The point count changes, the marker goes stale. Anything else, the marker rides the
> geometry.**

That is the whole of it. Two cases, not three.

|     | what happened                             | result                                             |
| --- | ----------------------------------------- | -------------------------------------------------- |
| 1   | the flattened path's point counts changed | the marker goes **stale**                          |
| 2   | the points moved                          | nothing stored changes; the anchor rides the curve |

Case 2 needs no code. The anchor is a parameter on a curve, and the curve is read live.
That is the feature working: a marker is watched _while_ the stem is dragged, and the
number updates every frame.

### The signature

`signature` is the array of per-contour point counts over the flattened path, plus each
contour's closed flag, taken when the anchors were last written. On every read, compare
it against the path as it stands. A different length, or a different count on the
contour the anchor names, is stale.

It is a count, not a geometry. There is no tolerance in it, nothing is searched for, and
no stored coordinate is compared against a drawn one.

**Stale is derived, never stored.** The comparison runs on read and writes nothing. So
undoing past the structural edit restores the signature and the marker comes back to
life on its own. A stale flag written into the file would survive the undo and leave a
dead marker on a healthy contour.

**This deletes an obligation rather than adding one.** No tool has to update marker
anchors when it restructures a point list — not the pen, not the knife, not shape
append, delete-selection, paste or break-contour. A structural edit stales the markers
on that contour and the designer re-anchors with a click. The alternative was an audit
of every tool that touches a point list, with a quiet wrong measurement as the cost of
missing one. The donor's generated-contour indices produced exactly that quiet failure
twice.

**The price, stated.** Inserting a point on a contour stales every marker on it, even
though the curve through the anchor is unchanged. That is an ordinary edit and it will
be felt. It buys the absence of the audit above, and re-anchoring is one click.

**One count-preserving change is real: reverse contour.** It keeps the count and the
closed flag and reverses the point order, so every anchor on that contour would name a
different place while the signature says fine. Reverse-contour therefore stales the
markers on the contour it reverses, explicitly, in the same change. It is one command in
one place, which is why this is a line of code rather than a rule.

**Generated contours are path anchors and follow the path rule.** Point-count stability
across parameter values (feature model §3) means a rib drag, a width edit or a skeleton
move keeps the count, so those markers ride the regeneration. They stale where the count
genuinely changes: corner-rounding distance crossing zero, a cap style change, a serif
switched on. Expect that to read as a bug the first time; it is not one.

**Stale is a state, not a deletion.** A stale marker keeps its id, its target and its
group, draws greyed or not at all, and is listed as broken in the panel so that it can
be re-anchored or removed by hand.

---

## 4. Geometry

Pure, in `fontra-core`, with mocha tests, per rail R-A.

`fontra-core/src/marker-model.js`

- schema, stable-id allocation, accessors
- `computeSignature(flattenedPath)` → the per-contour count and closed-flag array
- `isStale(marker, flattenedPath)` → the signature comparison
- `resolveAnchor(anchorEnd, path, skeleton)` → a point, a normal, and a verdict of `ok`
  or `stale`

`fontra-core/src/marker-measure.js`

- `measureRay(glyphController, origin, normal)` → the far point and the distance, by
  `rayIntersections` plus the winding walk lifted out of the Power Ruler
- `measureDimension(p1, p2)` → the distance

The Power Ruler's own winding walk moves into `marker-measure.js` and the ruler imports
it, so there is one copy (R-B). Its `computeSideBearingLines` stays where it is — a
marker does not measure against sidebearings.

### The skeleton cases

- Anchored on a **generated contour**: an ordinary ray. It crosses the centerline,
  because a centerline is not outline geometry and casts no crossing, and stops at the
  far generated edge.
- Anchored on a **centerline**, double-sided: the ray runs **both** ways from the
  anchor and reports the sum. That is the stroke's full width at that point.
- Anchored on a **centerline**, single-sided: one way, like ordinary geometry, because
  the other edge lies on the centerline itself.

---

## 5. The tool

`views-editor/src/edit-tools-marker.js` — `MarkerTool extends BaseTool`, **delegating**
to the pointer tool for anything that is not marker business:

```js
await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
```

This is the Power Ruler's own pattern, already in the tree at four call sites
(`handleHover`, `setCursor`, `handleDrag`, and the not-editing guard).

**Not a clone** of `edit-tools-pointer.js`, and **not a subclass** of `PointerTools`.
That tool's `handleDrag` is a dispatch over selection kinds a marker tool has no
business inheriting — skeleton ribs, generated gizmos, tension-aware editing,
base-curve expansion. Delegation gives the pointer's behaviour where it is wanted and
nothing where it is not. The single-sided pen settled the same argument the same way:
inherit, do not copy, and the two cannot drift.

Registered in `editor.js` `initTools()` beside `PowerRulerTool`.

### The pointer tool reaches markers too

Markers are not a modal feature. **The pointer tool selects, moves and deletes them**,
through the same dispatch hooks Tunni already uses, so the ordinary tool stays the
ordinary tool and `edit-tools-pointer.js` stays a thin dispatcher (R-A).

The marker tool is the escape hatch, and it is deliberately narrow: **it moves and
deletes markers and does nothing else**, delegating everything that is not marker
business to the pointer tool.

**The marker grip loses to skeleton and generated geometry.** Hit order is generated
gizmos and skeleton ribs first, then the marker grip, then ordinary points. A marker
lying over a generated contour is therefore unreachable with the pointer tool while
gizmo mode is on, and that is what the marker tool is for. The alternative — a marker
winning the click — would put a readout in front of the geometry it describes.

The Power Ruler is untouched. Its double-click-to-dismiss lives inside its own tool, and
there is no ruler to dismiss from the pointer tool, so the two never arbitrate.

### Gestures

| gesture                                  | what it does                              |
| ---------------------------------------- | ----------------------------------------- |
| click a contour                          | place a ray at that point on that segment |
| Alt, click a point, click a second point | place a dimension                         |
| click a marker                           | select it                                 |
| **double-click a marker**                | delete it                                 |
| **drag a ray**                           | slide its anchor along the outline        |
| **drag a dimension end**                 | re-anchor that end to another point       |
| Backspace                                | delete the selection                      |
| anything else                            | delegate to the pointer tool              |

**Double-click deletes**, as the ordinary double-click gesture: two presses on the
marker with no drag in between. A press that moves is a drag, whatever its click count.
A double-click on empty canvas places nothing and deletes nothing.

### Dragging a placed marker

**A ray drags along the outline, not across the glyph.** The anchor is a point on a
curve, so the drag is tangent-constrained by construction: each frame runs the same
`findNearest` the placement ran, and writes whatever segment and `t` come back. Crossing
into the neighbouring segment is therefore ordinary — the address changes to that
segment, and nothing special happens at the joint. The ray recasts every frame, so the
measurement follows the cursor live.

The grip is the marker's own arrow, hit-tested in `scene-model.js` as `markerAtPoint`
per rail R-A. Grabbing the arrowhead is the same grip as grabbing the tail: the far end
is a cast and owns nothing, so there is only one thing to drag.

**A dimension drags by its ends.** Each end is hit-tested separately and re-anchors to
whichever point it is released on. Released on nothing, it stays where it was rather
than anchoring to empty space. Dragging the dimension's **body** moves nothing — both
ends belong to points, and a dimension that could be slid off its points would be
measuring something it no longer names.

**A drag rewrites the address and the signature together.** They are one write, through
one helper, so a marker can never hold an address from one moment and a signature from
another — that pair disagreeing is exactly what the stale check reads as a broken
anchor.

**A ray's drag stays on the contour it started on.** `findNearest` searches every
contour in the flattened path, so an unrestricted drag would let the anchor jump to a
different outline that happens to pass nearer the cursor. It also refuses `t` of exactly
0 and 1, so an anchor approaches a node without ever landing on it. Both are accepted:
to move a marker to another contour, delete it and place a new one.

**Every frame is recorded against a fresh copy of the pre-drag state**, never against
the live glyph. A rollback is a statement about the whole gesture. Base-curve expansion
records this fault costing an undo that restored one frame out of three.

---

## 6. Drawing

`views-editor/src/visualization-layer-markers.js`, registered in
`visualization-layer-definitions.js` with `draw: <importedFn>` only, per rail R-A.

Two layers, because a ray and a dimension read differently on screen even though the
data is one object:

- `fontra.markers.rays` — an arrow from the anchor to the far point, with the distance
  in a pill, following the Power Ruler's existing pill-and-blob drawing.
- `fontra.markers.dimensions` — extension lines, a witness gap and the distance, in the
  AutoCAD idiom.

Both draw the target's delta beside the distance where a target is set, and both grey a
stale marker.

Colours follow the Power Ruler's light and dark tables.

---

## 7. The panel

`views-editor/src/panel-markers.js`, in the right sidebar.

- Every marker in the current glyph: its measurement, its target, its delta, its group,
  and whether it is stale.
- Select a row, and the marker highlights on canvas. Select on canvas, and the row
  highlights.
- Edit a target. Clear a target.
- Create a group, rename it, delete it, toggle its visibility. **There are no groups by
  default** — an ungrouped marker is the ordinary case, and grouping is something the
  designer asks for.
- Delete a marker. Re-anchor a stale one by clicking a new spot.

Groups carry **visibility only**. They hold no shared target: one number owned by two
levels is the trap this project has recorded four times.

Writes go through one helper module in the editor, in the shape
`skeleton-panel-edits.js` already has, so the panel never writes `customData` directly.

---

## 8. What must be preserved

- **A marker stores one address and no geometry.** Every distance, direction and far
  point is derived on read. A stored measurement is a number that drifts.
- **Nothing recovers an anchor by geometric matching.** The signature is a count and
  verifies an address; it never searches for one. This is rail R-D, and it is what
  separates markers from defect P1.
- **The count changes, the marker goes stale; anything else, it rides the geometry.**
  One rule. It never falls back to a nearest hit, and it never silently re-anchors.
- **Stale is derived on read, never written to the file**, so an undo past the
  structural edit brings the marker back on its own.
- **No tool owes marker anchors any bookkeeping.** The stale rule exists precisely so
  that the pen, the knife and everything else that restructures a point list can stay
  ignorant of markers. Reverse contour is the single named exception, because it
  preserves the count.
- **Ids are allocated once and never reused**, so multi-source copies of one marker are
  recognisably one marker.
- **One copy of the winding walk**, shared with the Power Ruler (R-B).
- **The tool delegates and does not clone.** A second copy of the pointer's dispatch
  would drift within a release.
- **Markers never reach a compiled font.** They live in `customData`, which no compiler
  reads.
- **A drag records against the pre-drag state**, and writes the address and its
  signature in one change.
- **The marker grip loses to skeleton and generated geometry**, and the marker tool is
  the way to reach what it loses.

---

## 9. Not in v1, deliberately

- **Editing through a marker** — dragging the arrowhead to push the far contour to a
  wanted distance. That is a constraint solver wearing a ruler's clothes, and it turns
  markers from a readout into an editing tool. Wanted, and its own feature.
- **Direction modes** — horizontal, vertical, a named angle. The normal is what a stroke
  measurement means. The serif's `axisMode` was reached for out of habit and dropped.
- **Reading one marker across every source in a column.** The id makes it possible and
  the panel is where it would go. Not v1.
- **Group-level targets.** See §7.
- **Export of measurements as a table.**

---

## 10. Testing

`fontra-core` carries mocha tests, `views-editor` carries none, per rail R-G.

**Automated**, in `fontra-core/tests/`:

- `test-marker-model.js` — id allocation and non-reuse; the signature over a flattened
  path with components; stale on an inserted point, on a deleted point, on a removed
  contour and on an added component; **not** stale when points only move; a skeleton
  anchor never staling; stale recovered by restoring the count, which is the undo
  property; round-trip through `fontra.internal`.
- `test-marker-measure.js` — the winding walk on an overlapping stem (rule 3 crosses the
  interior edge), on a counter (stops on entry), on an open contour that never crosses
  (no measurement rather than a fabricated one), and the double-sided centerline sum.

**A sweep, not an assertion, for the anchor.** Hold a marker fixed and walk the
neighbouring point through its range in fine steps, measuring the worst single-step
movement of the reported distance against the driver's own step. A per-configuration
assertion has missed every fault in this project's geometry so far.

A drag gets the same sweep: drive a ray's anchor along a contour in fine steps, across a
segment joint, and measure the worst single-step movement of the reported distance.

**Manual matrix owed** for the editor half: place a ray on each of an ordinary contour,
a generated contour and a centerline in both width modes; place a dimension; drag the
stem the marker sits on and confirm the number follows live; insert a point with the pen
and confirm stale; undo that and confirm the marker returns; knife the contour away and
confirm stale; reverse the contour and confirm stale; select, move and delete a marker
with the pointer tool; confirm a marker on a generated contour is unreachable with the
pointer tool in gizmo mode and reachable with the marker tool; edit in two sources at
once and confirm one id in both; undo each of the above.
