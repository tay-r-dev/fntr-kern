# Bulb easing and its curvature gizmo

Date: 2026-08-11
Status: approved design

## Problem

The bulb (drop cap) softens the notch where the ball meets the inner stroke edge.
The control for this is the shared cap tension value. It has three faults.

1. The name is wrong. The panel calls it tension, but for a bulb it does not set a
   tension. It sets how far back along the inner edge the neck starts.
2. The value is indirect and unbounded in practice. `buildDropCap` inflates the
   ball by `1 + tension * NECK_PULLBACK_FACTOR` and takes whatever crossing that
   inflated ball makes with the inner edge. The result cannot be aimed. The
   crossing search (`findSideBallCrossing`) also keeps walking backward across
   on-curves, so the neck can swallow several segments.
3. The curvature gizmo is absent at the terminal. `buildGeneratedTunniSegments`
   accepts a segment only when all four of its points carry provenance on one
   side. Cap points carry none, and `rebuildTrimmedSide` rewrites the trimmed
   segment's two handles with `buildSplitOffCurve`, which carries none either.
   So the neck has no gizmo and neither does the edge above it.

## Design

### 1. Easing replaces tension for the bulb

Easing is a fraction of the run along the inner stroke edge, from the plain ball
crossing back to the next generated on-curve.

- 0 means the hard corner the bulb draws today.
- 1 means the far end of the neck sits exactly on that on-curve. The two collapse
  into one point.
- Values in between place the far end at that fraction of the run.

The neck's far end is placed directly. The ball-inflation search and
`NECK_PULLBACK_FACTOR` go away for the bulb.

This is a different quantity from the stored `capTension`, so it takes its own
field, `capBallEasing`, on the same points that already carry `capBallRatio`,
`capBallShape` and `capBallSide`. `capTension` keeps its present meaning for
round and square caps and is no longer read by `buildDropCap`. Existing bulbs
read as easing 0. There is no production release, so no migration is written.

### 2. The bound

The plain ball crossing, found by `findSideBallCrossing` with no inflation, is
where the run starts. The first on-curve behind that crossing is where the run
ends. The neck's far end never goes past it, at any easing.

One function returns that run: the start point, the end on-curve, and the path
between them. The slider's top of range and the geometry's stop are then the same
fact, computed once (rail R-B).

### 3. The control

The bulb's cap tension slider becomes an easing slider in
`panel-skeleton-parameters.js`. It runs 0 to 100 as a percent of the run, with no
range beyond either end. Typing does not reach past it, because past it there is
no geometry. The label reads "easing".

### 4. The gizmo

Exactly one curvature gizmo lives at the bulb's terminal. Its position depends on
easing.

**Easing 0.** The gizmo sits above the incision, on the inner side's trimmed
terminal segment. `rebuildTrimmedSide` must carry provenance onto the two split
handles it builds, the same way it already carries it onto the crossing on-curve
through `withRoundCapProvenance`. The segment then satisfies
`buildGeneratedTunniSegments` and gets the ordinary per-side gizmo. It reads and
writes `segmentCurvature` on the parent skeleton point exactly as any other
segment does. The trim runs downstream of that and re-applies on every
regeneration.

**Easing above 0.** The gizmo moves onto the neck cubic. The inner terminal
segment does not also keep one. The neck is cap geometry with no skeleton segment
behind it, so its curvature needs its own store: `capBallEaseCurvature`, beside
`capBallEasing` on the same point. The gizmo reads and writes that value. It
replaces the fixed `NECK_HANDLE_FRACTION` the neck cubic uses today.

Addressing the neck gizmo needs a route that `buildGeneratedTunniSegments` does
not provide, because the neck's four points are not one skeleton side. The neck
segment is published with its own provenance kind naming the cap-owning skeleton
point and the field, and the segment walk accepts that kind in addition to the
per-side kind. This keeps one walk for drawing and hit-testing (rail R-B) and
keeps the kind test out of the emit code (rail R-E).

## Testing

`fontra-core` has the mocha harness (rail R-G), so every geometry claim is tested
there.

- Easing 0 draws the same neck the current tension 0 draws.
- Easing 1 puts the neck's far end on the next on-curve, to rounding.
- Easing between 0 and 1 places the far end at that fraction of the run.
- The crossing walk stops at the first on-curve behind the crossing, on a bulb
  large enough that it used to walk past.
- The trimmed inner terminal segment carries provenance on all four points.
- The neck segment is published with its cap provenance and the segment walk
  returns it.
- The neck's curvature follows its stored value.
- Point counts are unchanged for every existing fixture at easing 0.

The panel has no harness. Its change is the label, the range and the field it
writes, and it is verified by hand.
