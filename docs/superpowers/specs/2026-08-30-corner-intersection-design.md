# Corner join by intersection — design

**Date:** 2026-08-30. Backlog item **B4**.
**Owns:** `skeleton-generator.js`, `skeleton-model.js`, and the rib readers that follow from it.

## Terms

A **corner** is a skeleton point where the centerline changes direction. Two centerline segments
meet at that point. Each of those two segments is an **arm**. The arm that arrives at the skeleton
point is the **ingoing arm**. The arm that leaves it is the **outgoing arm**.

The stroke has two **edges**. One edge runs along the left of the centerline. One edge runs along
the right.

An arm's **true edge** is that arm offset by the half-width for the side in question. It is the
exact shape the outline should follow along that arm. It ends at a point square to the arm's own
direction at the skeleton point. I will call that point the arm's **edge end**. The two arms have
different directions, so their two edge ends are at two different places.

An **outline point** below means an on-curve point of the generated outline. It does not mean a
handle and it does not mean a skeleton point.

## The fault

At a corner the generator takes the direction of each arm. It splits the angle between those two
directions. It places one point on that split line, one half-width out from the skeleton point,
and gives that same point to both arms.

One half-width is the wrong distance. The two true edges on one side of the stroke cross further
out than one half-width. The distance grows as the corner turns sharper. At a right-angle corner
it is about 1.41 half-widths. At a 120 degree turn it is 2 half-widths.

Because the point sits too close to the centerline, the outer side of the corner does not reach
the joint and the inner side does not reach the trim. The reported shape is a diagonal arm meeting
a vertical arm, where the outline runs out into two thin spikes instead of closing.

The stroke width is handed to the routine that computes the corner and is then never used. So the
corner shape today does not depend on the stroke width at all.

## Which side of the corner is which

One side of the stroke has a gap between the two edge ends. The other has an overlap.

The test does not read the sign of the turn. It takes the direction the ingoing arm's true edge is
travelling at its edge end, and the vector from the ingoing arm's edge end to the outgoing arm's
edge end. If those two point the same way there is a gap and this is the **outer** side. If they
point opposite ways the two true edges overlap and this is the **inner** side.

This is Inkscape's test in `lpe-powerstroke.cpp`. It is used here because it reads the geometry
that is actually there rather than inferring it from the turn.

A corner is outer on one side of the stroke and inner on the other. The two sides are decided
independently, so the test is run once per side.

## The outer side

### Finding the apex

Take the ingoing arm's edge end. Draw a straight line from it, along the ingoing arm's own
direction. Take the outgoing arm's edge end. Draw a straight line from it, along the outgoing
arm's own direction.

The two lines cross at one place. That place is the **apex**.

The straight lines exist only to find the apex. Nothing straight is drawn in the outline.

The distance from the skeleton point to the apex is the half-width divided by the cosine of half
the turn.

### Drawing the corner

**The apex is the outline point, and it is the only one.** The two edge ends are not emitted. The
apex carries a handle on each side.

The ingoing arm's edge is one cubic. It runs from the previous outline point to the apex.
The outgoing arm's edge is one cubic. It runs from the apex to the next outline point.

**A corner therefore has two outline points, one per edge.** That is what it has today.

### Fitting the cubic

Each cubic must match the true edge of its own arm. The true edge does not reach the apex, and the
cubic must end there. So the fit takes the true edge as the shape to match and the apex as a fixed
endpoint.

**The existing solver does this without change to its contract.** The generator already fits each
generated cubic to the true edge by sampling the true edge at five fixed parameters and choosing
the two handle lengths that minimise the error, with the endpoints fixed and the directions taken
from the skeleton. The only thing this design changes is which point the endpoint is fixed at. The
samples do not move. The directions do not move. The solver's convexity, its single answer and its
continuity all come through untouched. See the feature model, step 2 of the generation pipeline.

**The direction at the apex stays the arm's own direction.** That is the direction the straight
line used to find the apex, so the cubic arrives at the apex travelling the way the straight line
did.

### The cost

The apex sits further from the centerline than the true edge reaches. So the cubic is stretched to
get there, and near the apex it departs from the true edge. The stroke is then slightly wider than
its stated width as it approaches a corner.

At a right-angle corner on a 60 unit stroke the endpoint moves about 12 units from where it sits
today.

The fit is what keeps that departure small. It has a fixed endpoint and two fixed directions, and
it solves the two handle lengths to stay as close to the true edge as it can. So this is a fitting
problem with one answer, not an error running loose.

**Measure the residual after building and record it in the development log.** Hold a corner fixed.
Walk the turn through its range and the half-width through its range. Measure the largest distance
from the emitted cubic to the true edge. Report it in font units. This is the check that the fit
is doing its job, not a defect to weigh against the design.

## The inner side

The two arms' edges overlap. Their two emitted cubics cross each other.

**The crossing is the outline point, and it is the only one.** Both cubics are cut back to it.

No fitting is needed. A piece of a cubic is exactly a cubic, so cutting changes no shape.

**The crossing is of the two cubics themselves, not of their directions.** A crossing of the two
directions would sit in the wrong place, because both cubics bend away from their directions over
the reach.

**If there is no crossing, or more than one, the code does not choose.** It keeps both edge ends
as outline points and runs a straight line between them. That side is then two outline points.
This is Inkscape's rule. Choosing among several crossings is a choice that can change from one
frame to the next while the designer drags, and the outline is rebuilt on every frame of a drag.

### A cut owes the rest of the editor the uncut curve

Cutting makes the emitted cubic shorter than the cubic the generator solved. Anything that
measures the emitted cubic then measures a different curve from the one the generator reproduces.

This project already has a rule for that and this design must follow it. The uncut cubic is
published on the inserted point's provenance, and one reader resolves it. The curvature gizmo goes
through that reader. Reading the emitted points directly makes the first drag of that gizmo jump.
See the feature model, "what a trimmed terminal owes the rest of the editor".

## The miter limit

The apex can sit very far from the skeleton point. At a turn of 178 degrees on a 60 unit stroke it
sits about 1719 units out, which is longer than the letter is tall.

**The limit is 2 times the full stroke width, measured from the skeleton point to the apex.** On a
60 unit stroke that is 120 units. It engages at a turn of about 151 degrees.

That is the same limit the drag that offsets an ordinary outline already uses. That drag states it
as 4 times the half-width, which is the same number. So both gestures bevel at the same turn.

Past the limit, that side of the stroke keeps both edge ends as outline points and runs a straight
line between them. That side is then two outline points rather than one.

**The limit is fixed in the code. It is not a setting in the panel.**

**Corner rounding overrides it.** Where corner rounding is switched on at that skeleton point,
rounding decides the corner's shape and the limit does not apply.

## The fold-back

**There is no threshold on the turn.** Two straight lines cross unless they are exactly parallel.
They are exactly parallel only when the centerline folds back on itself at the skeleton point, so
that both arms leave it travelling the same way. Every other turn has an apex, and the miter limit
above is what stops it running away.

At the fold-back there is no apex. **That side of the stroke keeps both edge ends as outline
points** and runs a straight line between them. That side is two outline points rather than one.

The other side of the stroke behaves differently, because the arms are curves. They fold at the
skeleton point and separate further along, so their two edges do cross and that side takes its one
crossing as normal.

This is the case drawn in the designer's image 1.

**A corner in this state does not interpolate against an ordinary corner in another master**,
because the two have a different number of outline points. The designer accepted this. Contours
rarely change this much between masters, and this is not animation software.

## The number of outline points

An ordinary corner is two outline points, one per edge. That is what it is today, so ordinary
corners cost nothing.

Two cases have more:

| case                                       | that side of the stroke |
| ------------------------------------------ | ----------------------- |
| ordinary corner, either side               | 1                       |
| apex past the miter limit                  | 2                       |
| fold-back                                  | 2                       |
| inner edges cross zero times or many times | 2                       |

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

The drag that offsets an ordinary hand-drawn outline works from normal directions of its own and
does not read the rib. It is unaffected.

## Provenance

Every generated outline point carries a label saying which skeleton point it came from, which side
of the stroke it is on, and what job it does. Nothing in the editor recovers that label by
comparing coordinates. This is rail R-D.

The apex takes the label the corner's outline point carries today. It is the same skeleton point,
the same side, and the same job. A rib drag therefore keeps moving the outline points it owns with
no change.

Where a side has two outline points instead of one, each of the two records which arm it came
from: the ingoing arm or the outgoing arm. Without that, both would say the same thing, and a drag
of the skeleton point would move one of them and leave the other behind, tearing the outline.

## What does not change

- **Corner rounding.** It still trims back along each arm and puts an arc there. It reads a corner
  point that has moved further out, so rounded corners in existing drawings change shape. The
  rounding rule itself is untouched.
- **The straight-controlled smooth point.** A smooth skeleton point carrying only one handle takes
  its rib direction from the straight segment on its other side. That is not a corner and this
  design does not reach it.
- **The tied ribs across a straight.** Unchanged.
- **The two edges' half-widths.** A corner is one skeleton point, so it has one stored half-width
  per side. Both arms use the same half-width on the same side.
- **Every cap style.** A cap closes an open end of a contour. A corner is interior to a contour.
- **The handle solver.** Its samples, its directions, its convexity and its bounds are all
  untouched. Only the endpoint it is given changes.

## Testing

**Test with a sweep, not with an assertion.** Hold the geometry fixed. Walk one input through its
range in fine steps. Measure the worst single-step movement of any outline point against the step
of the input that drove it. Start the sweep away from a degenerate configuration. A sweep that
starts at zero-length handles reports its own first step as a large jump.

Four sweeps are required:

1. **The turn.** Walk the corner from a gentle turn through the miter limit and on to the
   fold-back. The outline must move smoothly. The one place it may jump is the miter limit, where
   the apex is replaced by a straight line between the two edge ends.
2. **The half-width.** Walk the stroke width through its range at several fixed turns. The corner
   must move in proportion to the width, which is what it fails to do today.
3. **The arms' curvature.** Walk the handles of one arm. This sweep also produces the number for
   how far the stretched cubic departs from the true edge.
4. **The inner crossing.** Walk the geometry through configurations where the two inner cubics go
   from one crossing to none and to several. The fallback must engage cleanly and the sweep must
   report where it engages.

Golden-master fixtures exist for the generator. The corner geometry changes, so those fixtures
move. That is expected. Each moved fixture must be reviewed and the reason for its movement
stated, rather than regenerated in bulk.

`fontra-core` has a test harness. The generator lives in `fontra-core`. So this work is testable
and test-driven development applies to it.

## Reference material

`_external/inkscape`, file `src/live_effects/lpe-powerstroke.cpp`. Its Power Stroke path effect is
this same problem, with variable width. It supplied the inside-or-outside test, the inner-side
curve crossing with its fallback, and the evidence that carrying the edges on as curves to find
the apex does not work well. Its own miter draws three outline points rather than one, because it
does not refit its curves. This design refits, so it keeps one.

`offset-contour.js` in this repository places corner points for the drag that offsets an ordinary
outline. It uses the same crossing of two lines and holds it at four times the offset. Rail R-B
says there is one copy of every geometry function, so the plan must decide whether anything here
can be shared with it.

## Open

Nothing in this design is undecided.

One measurement is owed after the work is built: how far the stretched cubic departs from the true
edge, in font units, recorded in the development log.
