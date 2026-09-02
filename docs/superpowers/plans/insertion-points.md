# Insertion points

**Date:** 2026-09-02. **Target:** `skeleton-model.js`, `skeleton-generator.js`,
`offset-contour.js`, `skeleton-editing.js`, `scene-model.js`,
`visualization-layer-skeleton.js`, `panel-skeleton-parameters.js`.

**Status:** design of record. No code written.

---

## 1. What it is

An insertion point is a second kind of skeleton point. It sits on a centerline segment and it
slides along it. It does not set the shape of the centerline. No handle moves and no on-curve
moves when the designer adds one, drags it, or deletes it.

An insertion point carries a rib. The rib crosses the centerline where the insertion point sits.
The generator emits one on-curve point per side for that rib, so the generated contour gains two
points.

At the width the stroke already draws there, the letter does not change at all. The generator
cuts the emitted curve rather than redrawing it. When the designer changes the rib width, the two
emitted on-curves leave the old edge and the stroke swells or narrows at that place.

**Why an ordinary skeleton point is the wrong tool.** An ordinary point is a point of the
centerline path. Adding one makes the generator solve two short segments where it solved one long
one, and the natural solver's answer for two halves is not the answer for the whole. The letter
shifts. An insertion point exists so that the designer gains a rib and loses nothing.

---

## 2. Where it is stored

**Not in the point list.** A point in `contour.points` is a point the segment builder sees.
`buildSegmentsFromPoints` would make two segments out of one and the outline would change. The
centerline passes that already exist — harmonize, balance, the pen, the knife — would see it too.

An insertion point is stored in a new per-contour list beside `points`. Each entry holds:

| field     | meaning                                                       |
| --------- | ------------------------------------------------------------- |
| `id`      | stable id, from the same non-reusing counter skeleton ids use |
| `pointId` | the stable id of the segment's **start** point                |
| `t`       | the source parameter along that segment, in 0 to 1            |
| `width`   | a ratio per side, plus the link and lock flags, section 4     |
| `easing`  | the transition setting, section 5                             |

`id` shares the skeleton's id space, so one lookup finds either kind of point and no id is ever
reused. This is what makes the provenance map able to name the emitted points (rail R-D).

**The address is a segment, not a coordinate.** Nothing stores where the insertion point is in
glyph space. Its position is `pointAt(segment, t)`, read live, the way a rib's position is. A
stored coordinate would drift when the segment is redrawn.

**Deleting the start point deletes the insertion points on its segment.** Deleting a skeleton
point merges the two segments beside it, so the parameter would address a different curve and the
insertion point would slide on its own. Deleting it is the honest answer.

---

## 3. Generation

The pipeline gains one step and changes nothing above it.

1. The generator solves the contour whole, exactly as it does today. Segmentation, offsetting,
   the natural solver and the handle domain all see the same input they see now.
2. The authored layers run as they do today: attached adjustments, then the pinned harmonic-mean
   tension, then detached handles.
3. **Then the split.** For each insertion point, each side's emitted cubic is cut at the
   parameter `t`. The cut is a de Casteljau split, so the two pieces draw the same curve.
4. **Then the width move**, section 4.
5. Corner rounding, caps, assembly and the smoothing pass follow as they do today.

**The parameter is the source parameter.** The emitted cubic is not the true offset, so the rib
end and the emitted curve do not meet exactly. The natural solver already samples the true offset
at fixed source parameters and works in that coordinate, so the emitted curve is already read that
way. The insertion point uses the same one. Both sides use the same `t`.

The alternative is to place each emitted on-curve at the rib end itself. That moves the outline
off the curve it drew, which breaks the whole promise of the feature.

**The rib bar reads its ends off the outline.** It does not reconstruct them from a normal and a
half-width, because the emitted point is not at the rib end. Each end is looked up through the
published provenance and taken as it is. This is the rule the corner join already follows, for
the same reason.

**On a straight segment there is no cubic.** The emitted edge is a straight line between two
projected rib ends. The insertion point emits a point on that line at parameter `t`. Nothing is
split.

**Provenance.** Each emitted on-curve names the insertion point's id, its side, and the role
`onCurve`. The four handles the split creates name it with the roles `in` and `out`. Nothing
recovers any of them by geometric matching.

**The curvature pin stays on the whole original segment.** The pin is keyed on the segment's start
point, and the generator reproduces it on the segment it solved, which is the uncut one. Both
pieces therefore publish the uncut segment on their inserted point's provenance as
`constructionSegment`, the way `splitTerminalSideForRoundCap` already does. Every reader goes
through `generatedSegmentConstructionPoints`. Without this the curvature gizmo would measure a
piece and write a number the generator reproduces on the whole, and the first drag would jump.

**One pin per original segment, not one per piece.** An insertion point is not a place to state a
curvature. It states a width.

---

## 4. The width is a ratio

**An insertion point's width is relative, always, with no absolute mode.**

**The reference is what the split already drew.** The split puts an emitted point on each side.
The distance from the centerline point at that parameter out to that emitted point is the
half-width the stroke already has there. It is read off the emitted geometry. It is not
interpolated between the two neighbouring ribs, because the generator states no width between ribs
and inventing one would be a second answer to a question the outline already answers.

**The stored number is a multiplier of that reference**, one per side, with the link and lock
flags an ordinary rib carries. One means the stroke as it stands. Above one the stroke swells and
below one it narrows. There is no unset state and no cascade. The field always holds a number, the
way every serif field does.

**A ratio survives the slide, and an absolute width does not.** The insertion point's whole gesture
is sliding along the centerline. On a tapering stroke the reference changes as it slides. A stored
absolute width would hold still while the stroke under it moved, so sliding would change the shape.
That contradicts the promise the feature is built on. A ratio slides and changes nothing.

**A ratio also survives a trip between masters.** It is dimensionless, so it never needs a units
mode, and it interpolates between two masters drawn at different weights. Absolute lengths do not,
which is why serif presets are held per master.

Once the ratio leaves one, the two emitted on-curves move along the rib normal, each by the
difference between the stated half-width and the reference.

**A ratio of one must emit exactly the split points.** This is the identity the whole feature rests
on, and it is a test rather than a claim.

The move is applied at emission, after the authored layers, at the step the rib nudge is applied
at. It is the same species of thing: a later and more specific statement about where an emitted
point sits.

**The panel reads and writes units, and the model stores the ratio.** A designer thinks in units.
The field shows the resulting half-width, and a typed number is divided by the reference before it
is stored. That is one number in a derived display, not two stored numbers. The conversion is one
function and every writer goes through it.

**Two costs, both stated.** A collapsed side is under half a unit and lies on the skeleton exactly.
Any ratio times a collapsed side is still collapsed, so an insertion point cannot lift a rib off a
single-sided edge. And where the stroke narrows toward a point, the swell a fixed ratio draws
narrows with it. Both follow from the ratio being relative, and both are the behavior a relative
number promises.

---

## 5. Easing

The move leaves the four surviving pieces with one end displaced. Their handles have to answer,
and easing is the number that says how.

**Easing runs from 0 to 1 and is dimensionless**, like corner curvature, serif tension and the
drop cap's neck easing. At 0 the outline turns a corner at the emitted point. At 1 the outline
passes through it smoothly and the swell runs long. Between the two it opens gradually.

The two handles either side of the emitted point are turned toward the outline's own direction at
that parameter and scaled by the easing. At 0 they keep the directions the split gave them, which
after a perpendicular displacement is a corner. At 1 they lie on one line through the emitted
point, so the joint is smooth.

**Easing shapes handles and moves no on-curve.** It may not change the neighbouring ribs' widths.
A rib states a width, and a control that quietly restated a neighbour's width would make the panel
disagree with the shape.

**This is the one part of the design inferred rather than stated.** The designer named the field
and its owner. Where easing turns out to mean a length along the outline instead, the change is
local to this section and to the generator's emission step.

---

## 6. Ties

A straight carrying a straight-controlled smooth point holds the ribs at both its ends to one
offset. That is what keeps the generated edge parallel to the skeleton straight. `width.tied` on
either end frees it. `collectCoupledPointGroups` in `offset-contour.js` is the single definition,
and `collectTiedRibGroups` adds the skeleton's own two inputs.

**An insertion point cuts the tie.** A tie is a run along a straight, from the controlled point to
whatever stops it. Today only the far end stops it. An insertion point stops it too.

So on a straight running from a tension point to a corner, an insertion point takes the corner's
place in the tie. The run from the tension point to the insertion point must still come out
straight, so those two share one offset. The corner is released and its rib changes width freely.
The run from the insertion point to the corner may taper, because nothing on it is
direction-controlled.

Where **both** ends of the straight are controlled, nothing is released. Both runs still have to
come out straight, so the two ends and the insertion point all share one offset.

With several insertion points on one straight, only the runs touching a controlled end are held.
A run between two insertion points carries no controlled point and is free.

**The rule lives in one place.** `collectCoupledPointGroups` takes the insertion points on each
segment and returns the group cut at them. `getTiedRibGroup`, `getEffectiveRibHalfWidth` and the
rib drag then read the answer back through the same call they use today, so the gizmo, the stored
width and the emitted outline cannot disagree.

**A tied insertion point takes the group's offset, and its own ratio is inert.** It contributes
nothing to the group's mean. A ratio is a statement about the stroke where the point stands, and
while the point is tied there is no local stroke for it to be relative to. The panel greys the
ratio rather than hiding it, the way single-sided mode already greys the per-side numbers.

This is not a loss. What the insertion point buys on a tied straight is the release of the far
end, which is the whole of what the tie cut is for. To set a width on the held run instead, free
the straight with the switch that already exists.

---

## 7. Editing

**Selection kinds.** Two, both id-based:

```
skeletonInsertion/<contourId>/<insertionId>          the point on the centerline
skeletonRib/<contourId>/<insertionId>/<side>         its rib end, side in left|right
```

The rib kind is the existing one. It works unchanged because rib keys name a point by id, and an
insertion id comes from the same space.

**Dragging the insertion point slides it.** It has one degree of freedom. The drag projects the
cursor onto the segment and writes `t`. The point cannot leave the centerline.

**Dragging a rib end changes the width**, through the executors an ordinary rib already uses,
including the tied group and the modifier behaviors.

**One write path.** Every mutation goes through `editSkeleton` (rail R-C).

**No nudge.** An ordinary rib's nudge slides its emitted on-curve along the tangent. The parameter
already does that. Two numbers for one movement is the trap this project has recorded four times.

**No on-curve gizmo on the emitted points.** The insertion point on the centerline is the control
that moves them. A second control at a second place, writing the same number, is the same trap.

**Sliding onto a neighbour is legal.** At `t` of 0 or 1 the emitted points land on the neighbouring
rib's own points. They collapse and are not removed. That is the ground rule the serif terminal
already states: points collapse, they do not disappear.

**Reverse contour.** The segment runs the other way, so the address moves to the other end point
and the parameter becomes one minus itself. The two sides swap.

**Mirror.** Every per-side field swaps, the same list an ordinary point swaps. The parameter is
unchanged.

---

## 8. What it refuses

- **No cap.** An insertion point is never a contour end.
- **No serif.** Same reason.
- **No corner block.** It never kinks the centerline, so there is no corner to round.
- **No rib angle lock.** The lock is offered at open-contour endpoints, and this is not one.
- **No smooth flag and no handles.** It is not a point of the path.
- **No curvature pin.** The pin belongs to the segment it sits on, section 3.

---

## 9. Interpolation and point count

The emitted count is two per insertion point at every parameter and every width, including the
collapsed ends. Point-count stability holds within a master.

**Across masters the insertion points must match**, the same way cap styles must match. A master
with an insertion point and a master without do not interpolate at that segment. This is the same
contract corner rounding and cap styles already carry, and it is not made worse here.

**The ratio interpolates and an absolute width would not.** Two masters drawn at different weights
hold the same ratio at the same parameter, and every weight between them draws a swell in
proportion to the stroke it sits on. This is the second reason the width is relative, section 4.

---

## 10. Files

| File                              | Work                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `skeleton-model.js`               | the schema and normalization, id allocation, accessors, the slide math, the tie cut |
| `offset-contour.js`               | `collectCoupledPointGroups` takes insertion points and cuts the run                 |
| `skeleton-generator.js`           | the split step, the width move, easing, provenance, the construction segment        |
| `skeleton-editing.js`             | the selection keys, the target entries, the slide executor, the rib executors       |
| `scene-model.js`                  | `skeletonInsertionAtPoint`, and the place in the hit cascade                        |
| `visualization-layer-skeleton.js` | the insertion point and its rib, on the existing rib and rib-point layers           |
| `panel-skeleton-parameters.js`    | the width fields and the easing field for the selected insertion point              |
| `skeleton-panel-model.js`         | the selection summary across insertion points                                       |
| `skeleton-panel-edits.js`         | the panel writes, through `editSkeleton`                                            |
| `lang/en.js`                      | the labels                                                                          |

---

## 11. Tests

`fontra-core` has the harness. `views-editor` has none, so the editing work owes a manual matrix
(rail R-G).

**The identity test comes first.** Generate a contour, then generate it again with an insertion
point at several parameters, at a ratio of one. Every point of the first output must be present in
the second, unchanged, with exactly two points added per insertion point. This is the promise, so
it is the test.

**Sweeps, not assertions.** The rails are explicit and every fault in this module so far has come
out of a sweep.

1. Sweep `t` from just above 0 to just below 1 in fine steps, at a ratio of one. Measure the worst
   single-step movement of any emitted point against the step. It must be the movement of the two
   inserted points alone, and every other point must not move at all.
2. Run that same sweep on a **tapered** stroke at a ratio above one. The swell must slide with the
   point and change no other point. This is the sweep the ratio exists for, and an absolute width
   fails it.
3. Sweep the ratio from the collapsed floor upward. Measure for backtracking.
4. Sweep easing from 0 to 1. Measure the joint angle at the emitted point. It must fall to zero.
5. Sweep `t` onto each end and past it. The count must hold and the points must collapse.

**Tie tests.** A straight from a tension point to a corner, with one insertion point. Assert the
group is the tension point and the insertion point. Assert the corner's rib changes width alone.
Then both ends controlled, and assert nothing is released. Then two insertion points, and assert
the middle run is free.

**Provenance tests.** Every emitted point and handle resolves to the insertion point, a side and a
role. Nothing resolves by coordinate.

**Golden fixtures.** The corpus carries no insertion point. Add one fixture with an insertion point
on a curve and one on a tied straight. The log records three times that a suite passing is not
evidence for a change the corpus cannot see.

---

## 12. Decisions taken, and what they closed

| Decision                                          | What it closed                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cut the emitted curve, not the centerline         | Cutting the centerline makes the solver answer two short segments instead of one long one, and the letter shifts at the moment the point is added                            |
| Store the address, not a coordinate               | A stored coordinate drifts when the segment is redrawn, and recovering the parameter from it is the geometric matching rail R-D forbids                                      |
| The emitted point is on the curve, not the rib    | Placing it at the rib end moves the outline off the curve it drew                                                                                                            |
| The parameter is the slide, and there is no nudge | Two numbers for one movement                                                                                                                                                 |
| The pin stays on the whole original segment       | A pin measured on a piece and reproduced on the whole makes the gizmo jump on first grab                                                                                     |
| An insertion point cuts a tie                     | Joining the tie instead would leave the designer no way to change the width on a straight, which is the case the feature is most wanted in                                   |
| The width is a ratio, with no absolute mode       | An absolute width holds still while the stroke under a sliding point moves, so the slide changes the shape. It also fails to interpolate between masters of different weight |
| A tied insertion point's ratio is inert           | A ratio is relative to the local stroke, and a tied run has none. Resolving the ratio to feed the tie's own mean is circular, because the mean is what decides the stroke    |
