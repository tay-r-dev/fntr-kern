# Corner join by intersection — design

**Date:** 2026-08-30. Backlog item **B4**.
**Owns:** `skeleton-generator.js`, `skeleton-model.js`, and the rib readers that follow from it.

## Terms

A **corner** is a skeleton point where the centerline changes direction. Two centerline segments
meet at that point. Each of those two segments is an **arm**. The arm that arrives at the skeleton
point is the **ingoing arm**. The arm that leaves it is the **outgoing arm**.

The stroke has two **edges**. One edge runs along the left of the centerline. One edge runs along
the right. Each edge is the centerline offset by the half-width for that side.

Each arm, offset by the half-width, produces one piece of edge. That piece ends at a point square
to that arm's own direction at the skeleton point. I will call that point the arm's **edge end**.
The two arms have different directions, so their two edge ends are at two different places.

An **outline point** below means an on-curve point of the generated outline. It does not mean a
handle and it does not mean a skeleton point.

## The fault

At a corner the generator takes the direction of each arm. It splits the angle between those two
directions. It places one point on that split line, one half-width out from the skeleton point,
and gives that same point to both arms.

One half-width is the wrong distance. The two pieces of edge on one side of the stroke cross
further out than one half-width. The distance grows as the corner turns sharper. At a right-angle
corner it is about 1.41 half-widths. At a 120 degree turn it is 2 half-widths.

Because the point sits too close to the centerline, the outer side of the corner does not reach
the joint and the inner side does not reach the trim. The reported shape is a diagonal arm meeting
a vertical arm, where the outline runs out into two thin spikes instead of closing.

The stroke width is handed to the routine that computes the corner and is then never used. So the
corner shape today does not depend on the stroke width at all.

## Which side of the corner is which

One side of the stroke has a gap between the two edge ends. The other has an overlap.

The test does not read the sign of the turn. It takes the direction the ingoing arm's edge is
travelling at its edge end, and the vector from the ingoing arm's edge end to the outgoing arm's
edge end. If those two point the same way there is a gap and this is the **outer** side. If they
point opposite ways the two pieces of edge overlap and this is the **inner** side.

This is Inkscape's test in `lpe-powerstroke.cpp`. It is used here because it reads the geometry
that is actually there rather than inferring it from the turn.

## The outer side

**Neither piece of edge is altered.** Each one ends at its own edge end, square to its own arm.
That keeps each piece of edge the true offset of its arm, so the stroke holds its stated width
right up to the corner.

Each edge end is carried on in a straight line, in its own arm's direction. The two straight lines
meet at one place. That place is the **apex**.

The outline runs: ingoing arm's edge end, then a straight line to the apex, then a straight line
to the outgoing arm's edge end.

**The outer side of a corner is three outline points.**

This is Inkscape's miter join and it is the shape drawn in the designer's images 2 and 3.

### The extension is a straight line, not a carried-on curve

Offsetting a curve does not change its direction. So at an edge end the piece of edge is already
travelling in its arm's own direction. A straight line in that direction is the edge continuing
the way it is already going.

The alternative is to carry each piece of edge on as a curve and intersect the two curves. That is
exact for curved arms. It is rejected, for two reasons.

Two curves can meet at more than one place, so the code must choose one, and that choice can
change from one frame to the next while the designer drags. The outline is rebuilt on every frame
of a drag. A construction that changes which meeting place it returns is the jitter the offset
construction removed over five rounds. See the development log, offset construction rounds 5 to 7.

Inkscape has that join. It is present in the source as the extrapolated miter and it is switched
off in the user interface. The comment in the source reads "disabled because doesn't work well".

**This costs accuracy on curved arms and the amount is not yet measured.** The plan must measure
it. Hold a corner fixed, walk the arms' curvature through its range, and compare the straight-line
apex against the apex two carried-on curves would give. Report the largest gap in font units.

## The inner side

**The two pieces of edge overlap.** They cross each other. That crossing is taken, and both pieces
of edge are trimmed back to it.

**The crossing is of the two pieces of edge themselves, not of their tangents.** A tangent
crossing would sit in the wrong place, because both pieces of edge are curves that bend away from
their tangents over the reach.

**The inner side of a corner is one outline point.** That point is the crossing.

If there is no crossing, or if there is more than one, the code does not choose. It draws a
straight line between the two edge ends instead, and the inner side is two outline points. This is
Inkscape's rule and its reason is the same one that rejects the carried-on curve on the outer
side: choosing among several crossings is a choice that can change between frames.

### A trim owes the rest of the editor the untrimmed curve

Trimming makes the emitted piece of edge shorter than the piece the generator solved. Anything
that measures the emitted piece then measures a different curve from the one the generator
reproduces.

This project already has a rule for that and this design must follow it. The untrimmed piece is
published on the inserted point's provenance, and one reader resolves it. The curvature gizmo goes
through that reader. Reading the emitted points directly makes the first drag of that gizmo jump.
See the feature model, "what a trimmed terminal owes the rest of the editor".

## No miter limit and no bevel setting

An earlier version of this design added a number on the skeleton point, limiting how far the apex
may travel, with a flat cut across the corner past that limit.

That is dropped. Corner rounding already softens a sharp corner and is set per skeleton point per
side. One shape must not have two controls.

So the apex always goes to the meeting place, however far that is. Nothing new is stored on the
skeleton point. Nothing is added to the panel.

Inkscape does carry such a limit and falls back to a straight line between the two edge ends past
it. That fallback shape is the same one the fold-back below produces. The difference is only that
here it is not a setting.

## The fold-back

The two straight lines carried on from the two edge ends are parallel when the centerline folds
back on itself at the skeleton point. Both arms then leave the skeleton point travelling the same
way. There is no apex to take.

**That side of the stroke drops the apex.** The outline runs straight from the ingoing arm's edge
end to the outgoing arm's edge end. That side is two outline points rather than three.

The other side of the stroke behaves differently, because the arms are curves. They fold at the
skeleton point and separate further along, so their two pieces of edge do cross and that side
takes its one crossing as normal.

This is the case drawn in the designer's image 1.

### The threshold, and what it costs

The code decides whether an apex exists. Two nearly-parallel lines meet at a place that is very
far away, so the decision needs a threshold.

The outline changes shape and changes point count as a corner crosses that threshold. Both
consequences are accepted:

- **The shape changes.** Just under the threshold the corner draws as a very long spike. Just over
  it, the spike is replaced by a straight line between the two edge ends. This is a discontinuity.
  It sits at a turn nobody draws on purpose.
- **The point count changes.** A corner drawn as a fold-back in one master and as an ordinary
  corner in another has a different number of outline points, so that letter does not interpolate
  between those two masters. The designer accepted this. Contours rarely change this much between
  masters, and this is not animation software.

**The threshold value is the one number this design leaves open.** It has to be chosen before
implementation. The distance from the skeleton point to the apex, at a range of turns, for a
stroke 60 units wide in a 1000 unit em:

| turn of the corner | distance to the apex | on a 60 unit stroke |
| ------------------ | -------------------- | ------------------- |
| 90 degrees         | 1.41 half-widths     | 42 units            |
| 120 degrees        | 2 half-widths        | 60 units            |
| 151 degrees        | 4 half-widths        | 120 units           |
| 170 degrees        | 11.5 half-widths     | 344 units           |
| 178 degrees        | 57.3 half-widths     | 1719 units          |
| 179.5 degrees      | 229 half-widths      | 6875 units          |

The recommendation is to state the threshold as a distance rather than as an angle, because a
distance is what the designer sees. A threshold of 4 half-widths engages at a turn of about 151
degrees. Whatever number is chosen, it is fixed in the code and is not a setting in the panel.

## The number of outline points

Today a corner is two outline points, one on each edge.

Under this design an ordinary corner is four: three on the outer side and one on the inner side.
So every glyph gains two outline points per corner.

The count is not the same at every corner:

| case                                       | outer side | inner side |
| ------------------------------------------ | ---------- | ---------- |
| ordinary corner                            | 3          | 1          |
| fold-back, or apex past the threshold      | 2          | 1          |
| inner edges cross zero times or many times | 3          | 2          |

Two masters whose corners fall in different rows of that table do not interpolate at that corner.
This is accepted, and it is stated here so that nobody reports it as a defect later.

## The rib

A rib is the bar drawn across the centerline at a skeleton point, showing the stroke width there.

**The rib bar is drawn square to the ingoing arm, at every skeleton point.** At a smooth point
that is what it draws today. At a corner it changes: today it lies on the line that splits the
angle between the two arms.

**The rib bar keeps its present length.** It is drawn at the stored half-width on each side. It
therefore stops short of the outline at every corner, and by more the sharper the corner turns.
The bar states how wide the stroke is. It no longer states where the edges are.

One place in the code decides the rib direction. The rib gizmo, the rib drag, the snapping targets
and the measure readout all read that one place, so they cannot disagree with each other. This is
rail R-B.

**One thing to check in the plan.** The rib direction may be computed by a function that the drag
that offsets an ordinary outline also uses. That drag is a different feature and its behavior must
not change. If the function is shared, the skeleton rib takes its own direction and the shared
function is left alone.

## Provenance

Every generated outline point carries a label saying which skeleton point it came from, which side
of the stroke it is on, and what job it does. Nothing in the editor recovers that label by
comparing coordinates. This is rail R-D.

This design creates outline points that do not exist today and each needs a label:

- The two edge ends on the outer side. Each belongs to its skeleton point and its side. They need
  a job that says which arm they came from, because there are now two of them.
- The apex. It belongs to its skeleton point and its side, and it belongs to neither arm.
- The single crossing on the inner side. It belongs to its skeleton point and its side, and it
  carries the untrimmed pieces of edge as described above.

Getting these labels right is what lets a rib drag move the outline points it owns. The plan must
name each label before any of this is built.

## What does not change

- **Corner rounding.** It still trims back along each arm and puts an arc there. It now reads a
  corner that has moved and, on the outer side, a corner that is an apex between two straight
  lines. Rounded corners in existing drawings change shape. The rounding rule itself is untouched.
- **The straight-controlled smooth point.** A smooth skeleton point carrying only one handle takes
  its rib direction from the straight segment on its other side. That is not a corner and this
  design does not reach it.
- **The tied ribs across a straight.** Unchanged.
- **The two edges' half-widths.** A corner is one skeleton point, so it has one stored half-width
  per side. Both arms use the same half-width on the same side.
- **Every cap style.** A cap closes an open end of a contour. A corner is interior to a contour.

## Testing

**Test with a sweep, not with an assertion.** Hold the geometry fixed. Walk one input through its
range in fine steps. Measure the worst single-step movement of any outline point against the step
of the input that drove it. Start the sweep away from a degenerate configuration. A sweep that
starts at zero-length handles reports its own first step as a large jump.

Four sweeps are required:

1. **The turn.** Walk the corner from a gentle turn to just under the fold-back threshold. The
   outline must move smoothly. The one place it may jump is the threshold itself.
2. **The half-width.** Walk the stroke width through its range at several fixed turns. The corner
   must move in proportion to the width, which is what it fails to do today.
3. **The arms' curvature.** Walk the handles of one arm. This is the sweep that also produces the
   accuracy number for the straight-line extension.
4. **The inner crossing.** Walk the geometry through configurations where the two inner pieces of
   edge go from one crossing to none and to several. The fallback must engage cleanly and the
   sweep must report where it engages.

Golden-master fixtures exist for the generator. The corner geometry changes, so those fixtures
move. That is expected. Each moved fixture must be reviewed and the reason for its movement
stated, rather than regenerated in bulk.

`fontra-core` has a test harness. The generator lives in `fontra-core`. So this work is testable
and test-driven development applies to it.

## Reference material

`_external/inkscape`, file `src/live_effects/lpe-powerstroke.cpp`. Its Power Stroke path effect is
this same problem, with variable width. It supplied the inside-or-outside test, the outer-side
spike, the inner-side curve crossing with its fallback, and the evidence that carrying the edges
on as curves does not work well.

`offset-contour.js` in this repository places corner points for the drag that offsets an ordinary
outline. It uses the tangent crossing and holds it at four times the offset. Rail R-B says there
is one copy of every geometry function, so the plan must decide whether anything here can be
shared with it. The two are not the same construction: that drag moves an existing point, while
this one creates outline points that did not exist.

## Open

1. **The fold-back threshold value.** Stated above as the one number left to choose.
2. **The accuracy of the straight-line extension on curved arms.** Measured in the plan, reported
   in font units.
3. **Whether the rib direction function is shared with the ordinary-outline offset drag.**
4. **The provenance label for each new outline point.** Named in the plan before anything is
   built.
