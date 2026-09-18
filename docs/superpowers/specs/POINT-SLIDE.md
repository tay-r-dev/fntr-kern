# Point slide

## Short specification

Point slide moves one selected on-curve point along the contour while preserving the drawn shape as closely as the path representation allows. The gesture is **V-drag**.

The point is not moved freely in x/y. It is projected onto one of its adjacent contour segments, and the user drags it forward or backward along that segment. Handles and the neighboring segment representation are rebuilt so the contour stays on the original path. The operation is one undoable edit.

The exact shape-preserving operation is:

1. identify the selected point and its two neighboring segments;
2. choose a destination on the adjacent segment from the pointer's projected position;
3. split the destination cubic exactly at that parameter;
4. rebuild the two neighboring pieces from the same underlying curve;
5. preserve smoothness, metadata, point order, and interpolation compatibility.

There is no merge step and no approximation fallback. The point can move only within the interval bounded by its two neighboring on-curves. The shape remains exact because the operation changes the split location on the existing curve, just as a skeleton insertion point changes its stored segment parameter.

## Important reference findings

- Bezier.js provides exact `split(t)` and point evaluation. We use that same de Casteljau construction for the slide.
- `svg-path-simplify` is not needed for Point Slide. The useful reference is Fontra's existing skeleton insertion-point parameter math.
- Fontra stores points in packed contours with explicit on-curve/off-curve types and smooth flags. A slide must operate on that model, not on an SVG string.

## Decisions

1. **V means slide, not free move.** The pointer is projected to the contour before any write.
2. **The contour is the source of truth.** Do not reconstruct a point by nearest outline geometry after the drag.
3. **Use source parameters.** Capture the original neighboring segments at mouse-down and calculate every frame from that snapshot.
4. **Preserve exact geometry.** Use de Casteljau split and keep the original curve construction.
5. **No deletion or merging.** The operation changes the point's position within its neighboring interval.
6. **No generated contours.** V-drag edits source contours only. Skeleton points need a separate feature decision because their generator owns the outline.
7. **One point per gesture.** Multi-selection is disabled for the first version.

## Detailed implementation plan

### Step 1 — Inspect and document the path representation

1. Read `VarPackedPath.getUnpackedContour` and `setUnpackedContour`.
2. Confirm how a segment is represented when it is a line.
3. Confirm how a cubic's two off-curves are ordered.
4. Confirm open-contour endpoint behavior.
5. Confirm metadata and selection behavior after point insertion.
6. Confirm generated-contour detection.
7. Record all answers in comments beside the new geometry helper.

### Step 2 — Add pure point-slide geometry

Create or extend a core module, preferably `fontra-core/src/point-slide.js`.

Implement these small functions:

1. `getAdjacentSegments(contour, onCurveIndex)`.
   - Return the previous and next segment.
   - Handle open endpoints by returning only the available side.
   - Handle a closed seam without changing the contour array.
2. `projectPointToSegment(segment, pointer)`.
   - Use the existing Bézier projection helper.
   - Return the segment parameter and projected point.
3. `chooseSlideInterval(adjacent, pointer, originalPoint)`.
   - Project the pointer onto the existing contour interval between the two neighboring on-curves.
   - Use the interval selected at mouse-down for the whole gesture.
4. `splitSegmentAt(segment, t)`.
   - Use de Casteljau splitting.
   - Return left and right cubic pieces with exact endpoints and handles.
5. `makeSlideCandidate(contour, pointIndex, interval, t)`.
   - Copy the original contour.
   - Split the selected neighboring interval at `t`.
   - Replace the old point with the new point location.
   - Rebuild adjacent handles.
6. `slidePointOnContour(contour, pointIndex, pointer, options)`.
   - Clamp the parameter to the interval between the neighboring on-curves.
   - Return the exact split candidate.
   - Never mutate the input contour.

### Step 3 — Define the actual topology operation

The initial implementation must support only the neighboring-interval operation:

1. If the selected point is on a straight segment, move it along that straight and retain the straight topology.
2. If the selected point is at the boundary of an adjacent cubic, use the existing segment parameter and de Casteljau split to place the point at the new parameter.
3. Keep the original selected point as the new on-curve point.
4. Preserve the neighboring on-curve points and all unaffected segments.
5. For a smooth point, preserve the tangent direction and set the new handle directions collinear with that tangent.
6. For a corner point, preserve the two independent side tangents.
7. Do not silently change a corner to smooth or smooth to corner.

The point never crosses either neighboring on-curve. There is no “last valid” approximate position: every clamped parameter in this interval is valid, and the endpoints are the only limits.

### Step 4 — Add the V-drag interaction

1. Add a realtime `point-slide` mode to the pointer tool.
2. Bind it to the `V` key while the pointer is down.
3. On pointer-down, require exactly one selected editable on-curve point or the point under the pointer.
4. Reject off-curve points, generated contours, components, and multi-selection.
5. Capture:
   - the original layer glyph;
   - contour index;
   - point index and stable source identity;
   - both adjacent segments;
   - chosen neighboring interval;
   - original pointer position;
   - original point parameter;
6. On every pointer move:
   - project the pointer to the captured neighboring interval;
   - clamp the parameter to the neighboring on-curves;
   - build the exact split candidate from the original contour;
   - apply it directly.
7. On key-up or pointer-up, commit one change through the change recorder.
8. On Escape, roll back the entire gesture.
9. Release the V mode on blur and pointer cancellation.
10. Keep snapping disabled during V-drag unless the snap result is projected back onto the selected segment.

### Step 5 — Selection and metadata rules

1. Keep the selected point selected after the slide.
2. Preserve its `smooth` flag and point attributes.
3. Preserve all unaffected point ids and attributes.
4. If the candidate inserts a temporary point, do not expose a new permanent id unless the final topology requires it.
5. Update marker anchors through the existing marker rules. A point-count change must use the existing marker signature behavior.
6. For a variable glyph, build a candidate for every editable master.
7. Only commit if all masters accept the same topology and point ordering.
8. Otherwise stop at the last common accepted parameter.

### Step 6 — Tests

Add core tests for:

1. Straight segment slide.
2. Cubic segment projection.
3. Split at `t = 0`, `0.5`, and `1`.
4. Open contour endpoint refusal.
5. Closed contour seam.
6. Smooth point tangent preservation.
7. Corner tangent preservation.
8. Exact shape equality after a parameter move.
9. Metadata preservation.
10. Marker behavior when topology stays unchanged.
11. Two compatible masters accepting the same slide.
12. Two masters disagreeing on the source parameter and refusing the gesture.
13. Generated contour refusal.

Use parameter sweeps rather than one example. For every sweep, measure the maximum point-to-curve deviation and tangent discontinuity.

### Step 7 — Manual acceptance matrix

1. V-drag a point on a straight.
2. V-drag a point beside one cubic.
3. V-drag a smooth point and inspect both handles.
4. V-drag a corner and confirm its two tangents stay independent.
5. Drag to each segment endpoint and confirm clamping.
6. Drag beyond either neighboring on-curve and confirm the point clamps at that endpoint.
7. Undo and redo.
8. Test open and closed contours.
9. Test a marker attached to the moved point.
10. Test a variable glyph with compatible masters.
11. Test a variable glyph with incompatible masters.
12. Test generated contours and confirm refusal.
