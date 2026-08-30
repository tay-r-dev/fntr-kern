# Corner join by intersection — design

**Date:** 2026-08-30. Backlog item **B4**.
**Owns:** `skeleton-generator.js`, `skeleton-model.js`, and the rib readers that follow from it.

## Terms

A **corner** is a skeleton point where the centerline changes direction. Two centerline segments
meet at that point. Each of those two segments is an **arm**.

The stroke has two **edges**. One edge runs along the left of the centerline. One edge runs along
the right. Each edge is the centerline offset by the half-width for that side.

An **outline point** below means an on-curve point of the generated outline. It does not mean a
handle and it does not mean a skeleton point.

## The fault

At a corner the generator takes the direction of each arm. It splits the angle between those two
directions. It places one point on that split line, one half-width out from the skeleton point,
and gives that same point to both arms.

One half-width is the wrong distance. The two edges of one side of the stroke cross further out
than one half-width. The distance grows as the corner turns sharper. At a right-angle corner it is
about 1.41 half-widths. At a 120 degree turn it is 2 half-widths.

Because the point sits too close to the centerline, the outer side of the corner does not reach
the joint and the inner side does not reach the trim. The reported shape is a diagonal arm meeting
a vertical arm, where the outline runs out into two thin spikes instead of closing.

The stroke width is handed to the routine that computes the corner and is then never used. So the
corner shape today does not depend on the stroke width at all.

## The construction

Each arm is offset on its own. Each arm's edge ends at a point square to that arm's own direction
at the skeleton point. The two arms have different directions, so those two ends are at two
different places.

Each edge is then carried on in a straight line, in its own arm's direction.

The two carried edges meet at one place. That place is the corner point for that edge of the
stroke.

The left edge gets its corner point this way. The right edge gets its corner point this way. A
corner therefore has two outline points, one per edge, which is what it has today.

The distance from the skeleton point to the corner point is the half-width divided by the cosine
of half the turn. The direction is the line that splits the angle between the two arms, which is
the direction the code already uses. So the change to the outline is a change of distance only.

### The extension is a straight line, not a carried-on curve

Offsetting a curve does not change its direction. So where an arm's edge ends, that edge is
already travelling in the arm's own direction at the skeleton point. A straight line in that
direction is the edge continuing the way it is already going.

The alternative is to carry the curve on as a curve. That is exact for curved arms. It is rejected
for now, for one reason: two curves can meet at more than one place, so the code must choose one,
and that choice can change from one frame to the next while the designer drags. The outline is
rebuilt on every frame of a drag. A construction that changes which meeting place it returns is
the jitter the offset construction removed over five rounds. See the development log, offset
construction rounds 5 to 7.

**This costs accuracy on curved arms and the amount is not yet measured.** The plan must measure
it. Hold a corner fixed, walk the arms' curvature through its range, and compare the straight-line
meeting place against the meeting place two carried-on curves give. Report the largest gap in font
units. If the gap stays under one font unit the question is closed. If it is large, say so, and
the decision is reopened with a number behind it.

### No miter limit and no bevel

An earlier version of this design added a number on the skeleton point, limiting how far the
corner point may travel, with a flat cut across the corner past that limit.

That is dropped. Corner rounding already softens a sharp corner and is set per skeleton point per
side. One shape must not have two controls.

So the corner point always goes to the meeting place, however far that is. Nothing new is stored
on the skeleton point. Nothing is added to the panel.

## The fold-back

The cosine of half the turn is zero when the turn is 180 degrees. The centerline folds back on
itself at the skeleton point. Both arms leave the skeleton point travelling the same way.

At that turn the two edges of one side of the stroke are parallel. They never meet, so there is no
meeting place to take.

**That side keeps both arms' edge ends.** It has two outline points rather than one. The straight
line between those two points is what closes the outline there.

The other side of the stroke behaves differently, because the arms are curves. They fold at the
skeleton point and separate further along. The two edges on that side do cross, so that side has
one outline point at the meeting place.

A fold-back corner therefore has three outline points. An ordinary corner has two. This is the
case drawn in the designer's image 1.

### The threshold, and what it costs

The code decides between the two shapes by asking whether the two edges meet. Two edges that are
nearly parallel meet at a place that is very far away, so the decision needs a threshold on the
turn angle.

The outline changes shape and changes point count as a corner crosses that threshold. Both
consequences are accepted:

- **The shape changes.** Just under the threshold the corner draws as a very long spike. Just over
  it, the spike is replaced by a straight line between the two arms' edge ends. This is a
  discontinuity. It sits at a turn nobody draws on purpose.
- **The point count changes.** A corner drawn as a fold-back in one master and as an ordinary
  corner in another has three outline points against two, so that letter does not interpolate
  between those two masters. The designer accepted this. Contours rarely change this much between
  masters, and this is not animation software.

**The threshold value is the one number this design leaves open.** It has to be chosen before
implementation. The distance from the skeleton point to the meeting place, at a range of turns,
for a stroke 60 units wide in a 1000 unit em:

| turn of the corner | distance to the meeting place | on a 60 unit stroke |
| ------------------ | ----------------------------- | ------------------- |
| 90 degrees         | 1.41 half-widths              | 42 units            |
| 120 degrees        | 2 half-widths                 | 60 units            |
| 151 degrees        | 4 half-widths                 | 120 units           |
| 170 degrees        | 11.5 half-widths              | 344 units           |
| 178 degrees        | 57.3 half-widths              | 1719 units          |
| 179.5 degrees      | 229 half-widths               | 6875 units          |

The recommendation is to state the threshold as a distance rather than as an angle, because a
distance is what the designer sees. A threshold of 4 half-widths engages at a turn of about 151
degrees. Whatever number is chosen, it is fixed in the code and is not a setting in the panel.

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

## What does not change

- **Corner rounding.** It still trims back along each arm from the corner point and puts an arc
  there. It reads the corner point, and the corner point has moved further out, so rounded corners
  in existing drawings change shape. The rounding rule itself is untouched.
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

Three sweeps are required:

1. **The turn.** Walk the corner from a gentle turn to just under the fold-back threshold. The
   outline must move smoothly. The one place it may jump is the threshold itself.
2. **The half-width.** Walk the stroke width through its range at several fixed turns. The corner
   point must move in proportion to the width, which is what it fails to do today.
3. **The arms' curvature.** Walk the handles of one arm. This is the sweep that also produces the
   accuracy number for the straight-line extension.

Golden-master fixtures exist for the generator. The corner geometry changes, so those fixtures
move. That is expected. Each moved fixture must be reviewed and the reason for its movement
stated, rather than regenerated in bulk.

`fontra-core` has a test harness. The generator lives in `fontra-core`. So this work is testable
and test-driven development applies to it.

## Reference material

`_external/inkscape` holds Inkscape. Its stroke-to-path and its Power Stroke path effect solve
this same construction. Read it before implementing, for the fold-back handling in particular.

`offset-contour.js` in this repository already places corner points by the same rule, for the drag
that offsets an ordinary outline. It scales the travel by the cosine of half the turn and holds
the scale at four times the offset. Rail R-B says there is one copy of every geometry function, so
the plan must decide whether the generator calls that module or whether the two constructions are
genuinely different.

## Open

1. **The fold-back threshold value.** Stated above as the one number left to choose.
2. **The accuracy of the straight-line extension on curved arms.** Measured in the plan, reported
   in font units.
3. **Whether the rib direction function is shared with the ordinary-outline offset drag.**
