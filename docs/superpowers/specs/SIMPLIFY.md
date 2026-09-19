# Simplify contour

## Read this first: what this repository is

This repository is **forkra**, a fork of the type-design application Fontra. It edits font glyphs, not ordinary SVG illustrations. A glyph is stored as one or more contours. A contour is an ordered list of on-curve points and off-curve Bézier handles. The same point structure is used by variable-font interpolation, so point order and point counts matter.

We are adding **Simplify contour** because a designer can create a contour with too many points. Too many points make editing, interpolation, and later adjustments harder. Simplify should remove unnecessary curve points while keeping the drawn shape visually the same.

Read these project rules before coding:

- Pure geometry belongs in `src-js/fontra-core/src/`.
- Editor actions belong in `src-js/views-editor/src/`.
- Use existing geometry helpers. Do not create a second copy of a helper that already exists.
- Generated contours are machine output. Do not simplify them.
- All changes must go through the normal change recorder so Undo works.
- `views-editor` has no automated test harness. Put geometry tests in `src-js/fontra-core/tests/` and make a manual editor test list.
- Do not change the bundle setup. The developer runs `bundle-watch`.
- Work on a branch and commit each completed step with `git add .`.

The reference repository is [`herrstrietzel/svg-path-simplify`](https://github.com/herrstrietzel/svg-path-simplify). Use its cubic math as a reference, especially extrema detection and tolerance-checked adjacent-cubic merging. Do not copy its SVG document cleanup, command minification, path reordering, arc conversion, or coordinate-rounding pipeline.

## Short specification

Add a command named **Simplify contour**.

The command operates on selected ordinary editable contours. It does not operate on generated contours, skeleton data, components, or anchors.

The command must:

1. Find curve extrema.
2. Insert on-curve points at interior extrema.
3. Mark required points as protected.
4. Try to replace runs of neighboring cubic segments with fewer cubic segments.
5. Keep a replacement only when its measured error is no larger than the user-selected tolerance.
6. Preserve contour direction, open/closed state, point metadata, and compatible interpolation topology.
7. Apply as one undoable change.

Use a conservative default tolerance in font units. A lower tolerance removes fewer points. A higher tolerance permits more merging.

## Do not change these decisions

- **Use extrema first.** Add extrema before attempting any deletion or merging.
- **Never remove protected points.** Protect contour endpoints, corners, extrema, inflections, and points with non-empty attributes.
- **Merge only adjacent cubic segments.** Do not merge lines, quadratics, arcs, or mixed command types in the first version.
- **Keep endpoints and tangent directions fixed.** A replacement cubic must start and end at the same points and use the same endpoint tangent directions as the original run.
- **Use a tolerance.** Exact equality is not required for a merge. The maximum sampled distance must be within tolerance.
- **Do not cross a protected point.** A candidate run starts after one protected point and ends before the next protected point.
- **Do not simplify generated contours.** Disable the command or show an error.
- **Do not change master topology independently.** If compatible masters do not accept the same merge, leave that run unchanged in every master.
- **Do not convert to SVG commands.** Work directly with Fontra contour points.

## Implementation order

Complete the steps in this order. Do not skip ahead.

### Step 1 — Inspect the existing path data types

Open these files before writing code:

1. `src-js/fontra-core/src/var-path.js`
   - Find `getUnpackedContour`.
   - Find `insertPoint` and `deletePoint`.
   - Find `setPointType`.
   - Write down the shape of an unpacked point: `x`, `y`, optional `type`, optional `smooth`, optional `attrs`.
2. `src-js/fontra-core/src/path-functions.js`
   - Find `deleteSelectedPoints`.
   - Find any existing segment-walking helpers.
3. `src-js/fontra-core/src/path-hit-tester.js`
   - Reuse its Bézier projection or segment representation if useful.
4. `src-js/views-editor/src/scene-model.js`
   - Find `isGeneratedPathContour`.
5. `src-js/views-editor/src/scene-controller.js`
   - Find how editor commands call `editGlyph`.
6. `src-js/fontra-core/src/change-recorder.js`
   - Confirm how replacing a contour is recorded and undone.

Do not invent a new point representation. Use the representation already returned by `getUnpackedContour`.

### Step 2 — Create the pure geometry module

Create:

```text
src-js/fontra-core/src/path-simplification.js
```

Export these functions:

```js
export function cubicPoint(points, t) {}
export function cubicDerivative(points, t) {}
export function cubicExtremaParameters(points) {}
export function splitCubic(points, t) {}
export function fitCubicToSpan(points, startTangent, endTangent) {}
export function maxCubicDeviation(originalPieces, candidate) {}
export function canMergeCubicPieces(originalPieces, tolerance) {}
```

Each function must be pure. It must not modify its input arrays or point objects.

Use this cubic point formula:

```js
export function cubicPoint([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x +
       3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y +
       3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}
```

Use this derivative formula:

```js
export function cubicDerivative([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return {
    x: 3 * u ** 2 * (p1.x - p0.x) +
       6 * u * t * (p2.x - p1.x) +
       3 * t ** 2 * (p3.x - p2.x),
    y: 3 * u ** 2 * (p1.y - p0.y) +
       6 * u * t * (p2.y - p1.y) +
       3 * t ** 2 * (p3.y - p2.y),
  };
}
```

For `cubicExtremaParameters(points)`:

1. Derive the quadratic for `dx/dt = 0`.
2. Derive the quadratic for `dy/dt = 0`.
3. Solve both quadratics.
4. Keep only roots strictly greater than `0` and strictly less than `1`.
5. Remove duplicate roots within `1e-9`.
6. Return sorted numbers.

Do not use a sampled scan to find extrema. Solve the derivative equations.

For `splitCubic(points, t)`, use de Casteljau:

```js
const p01 = lerp(points[0], points[1], t);
const p12 = lerp(points[1], points[2], t);
const p23 = lerp(points[2], points[3], t);
const p012 = lerp(p01, p12, t);
const p123 = lerp(p12, p23, t);
const middle = lerp(p012, p123, t);

return {
  left: [points[0], p01, p012, middle],
  right: [middle, p123, p23, points[3]],
};
```

Round only when writing back into a Fontra path. Keep floating-point values during the calculation.

### Step 3 — Convert one Fontra contour into cubic pieces

In the same module, add:

```js
export function contourToCubicPieces(contour) {}
```

Rules:

1. Walk the contour in point order.
2. An on-curve point has no `type`.
3. A cubic segment has exactly two off-curve points between its start and end on-curves.
4. A line segment has no off-curve points.
5. In the first version, return line segments unchanged and mark them as non-mergeable.
6. For a closed contour, include the closing segment from the final on-curve back to the first on-curve.
7. Preserve the original contour point indices on every piece.

Return records shaped like:

```js
{
  kind: "cubic",
  points: [p0, p1, p2, p3],
  startPointIndex,
  endPointIndex,
  sourceSegmentIndex,
}
```

### Step 4 — Mark extrema and protected points

Add:

```js
export function classifySimplifyContour(contour, options = {}) {}
```

For every on-curve point:

1. Protect the first point of an open contour.
2. Protect the last point of an open contour.
3. Protect every point where `point.smooth !== true`.
4. Protect every point with non-empty `point.attrs`.
5. Protect every point already carrying editor-specific metadata.
6. For every cubic piece, calculate extrema parameters.
7. Split that cubic at each interior extrema parameter with `splitCubic`.
8. Create an on-curve point at every split location.
9. Mark each inserted extrema point as protected.
10. Keep the source segment index and source parameter on the temporary analysis record.

Do not mutate the original contour in this step.

The result must contain:

```js
{
  pieces,
  protectedPointKeys,
  sourcePointMap,
}
```

A protected-point key must be stable within this operation. Use the original point index for existing points and a generated analysis key for inserted extrema points.

### Step 5 — Build merge candidates

Add:

```js
export function buildSimplifyRuns(analysis) {}
```

Walk the analyzed pieces in contour order.

1. Start a run after a protected point.
2. Add neighboring cubic pieces to the run.
3. Stop before the next protected point.
4. Stop at a line segment.
5. Stop at an open-contour endpoint.
6. Stop at the closed-contour seam unless the seam is explicitly handled.

A run must contain at least two cubic pieces. A one-piece run is copied unchanged.

### Step 6 — Fit one cubic to a candidate run

Implement `fitCubicToSpan` with these exact rules:

1. Candidate start is the first piece's `p0`.
2. Candidate end is the last piece's `p3`.
3. Candidate start tangent is `firstPiece.p1 - firstPiece.p0`.
4. Candidate end tangent is `lastPiece.p3 - lastPiece.p2`.
5. Keep both endpoint positions fixed.
6. Keep both tangent directions fixed.
7. Solve only two positive handle lengths.
8. Start with handle lengths equal to one-third of the run chord.
9. Search the two lengths deterministically.
10. Return `null` if either tangent is zero-length.

A simple first implementation may use a fixed grid search over 20 values per handle, followed by a local refinement. Keep the search deterministic. Do not use random values.

### Step 7 — Measure candidate error

Implement `maxCubicDeviation(originalPieces, candidate)`.

Use these fixed samples:

```js
const sampleTs = [0.125, 0.25, 0.5, 0.75, 0.875];
```

For each original piece:

1. Evaluate the original piece at every sample `t`.
2. Convert that sample to the candidate's normalized span parameter.
3. Evaluate the candidate at that parameter.
4. Measure Euclidean distance.
5. Return the largest distance.

Also calculate endpoint tangent angle error. Reject a candidate when either:

```js
maxDistance > tolerance
```

or

```js
maxTangentAngle > options.maxTangentAngle
```

Use `maxTangentAngle = 1` degree for the default.

### Step 8 — Greedily simplify each run

Add:

```js
export function simplifyRun(run, options) {}
```

For each run:

1. Set `start = 0`.
2. Try the longest candidate ending at the final piece.
3. Fit one cubic.
4. Measure distance and tangent error.
5. If accepted, emit one cubic and finish the run.
6. If rejected, move the candidate end one piece toward the start.
7. Try again.
8. When no merge is accepted, emit the first original piece and repeat from the next piece.

This is deterministic and simple. Do not add a second optimization strategy.

### Step 9 — Rebuild a Fontra contour

Add:

```js
export function rebuildSimplifiedContour(analysis, simplifiedPieces) {}
```

Rules:

1. Preserve the original contour's `closed` flag.
2. Preserve the original winding direction.
3. Preserve the first on-curve point for an open contour.
4. Emit each accepted cubic with two off-curves and one end on-curve.
5. Copy `smooth` only when the replacement preserves the original smooth tangent.
6. Copy attributes only to points that were protected and retained.
7. Do not copy metadata onto a newly created replacement point unless the metadata source is unambiguous.
8. Round coordinates only at the final write.
9. Return a new contour object. Do not mutate the original.

### Step 10 — Protect variable-font interpolation

Before writing any simplified contour:

1. Find the same glyph and contour in every editable master.
2. Run Steps 3–9 on every master.
3. Compare the protected-point sequence and accepted merge boundaries.
4. If every master accepts the same boundaries, write all results.
5. If any master disagrees, write the original contour to every master for that run.
6. Never let one master have a different point count from another compatible master.

Do not invent a new interpolation strategy in this task. If the master correspondence is unavailable, disable Simplify for that glyph and show a clear message.

### Step 11 — Add the editor command

Add the command in the existing editor command area, following the pattern used by other contour-edit commands.

Required behavior:

1. Command name: `Simplify contour`.
2. Enable only when the selection identifies one or more ordinary editable contours.
3. Disable when selection contains a generated contour.
4. Disable when the selection is only a component, anchor, or handle.
5. Open a small settings UI with one field: `Tolerance`.
6. Default tolerance: `0.5` font units.
7. Minimum tolerance: `0.01`.
8. Maximum tolerance: `10`.
9. Preview the proposed result before applying.
10. Apply one change through `editGlyph` and the change recorder.
11. Preserve selection on the nearest surviving on-curve points.
12. Make Undo restore the exact original contour.

Inspect these files while wiring the command:

- `src-js/views-editor/src/scene-controller.js` — command dispatch and glyph edits.
- `src-js/views-editor/src/editor.js` — action registration and shortcut labels.
- `src-js/views-editor/src/panel-transformation.js` — existing numeric control patterns.
- `src-js/views-editor/src/visualization-layer-definitions.js` — preview layer registration.
- `src-js/fontra-core/src/change-recorder.js` — undoable writes.

Do not put geometry code in the editor files.

### Step 12 — Add tests

Create:

```text
src-js/fontra-core/tests/test-path-simplification.js
```

Add these tests in this order:

1. `cubicPoint` returns both endpoints at `t=0` and `t=1`.
2. `cubicDerivative` is correct for a horizontal line-like cubic.
3. A cubic with one x extremum returns one interior root.
4. A cubic with one y extremum returns one interior root.
5. Roots at `0` and `1` are excluded.
6. `splitCubic` reconstructs the original curve at fixed sample parameters.
7. A line segment is never merged as a cubic.
8. A smooth cubic run merges when tolerance is generous.
9. The same run does not merge when tolerance is small.
10. A corner is protected.
11. An extrema point is inserted and protected.
12. A metadata-bearing point is protected.
13. Open contour endpoints remain unchanged.
14. Closed contour state and winding remain unchanged.
15. Two compatible masters receive identical merge boundaries.
16. Two incompatible masters remain unchanged for that run.
17. Repeating Simplify produces no additional change.

For geometry tests, compare sampled positions with an explicit tolerance. Do not assert exact floating-point equality after fitting.

### Step 13 — Manual test matrix

Run this manually in the editor:

1. Open a glyph with a deliberately over-pointed cubic contour.
2. Select the contour.
3. Run Simplify with tolerance `0.1`.
4. Confirm only very safe merges occur.
5. Run it again with tolerance `1.0`.
6. Confirm more points may disappear, but extrema and corners remain.
7. Confirm a line segment is unchanged.
8. Confirm an open contour keeps both endpoints.
9. Confirm a closed contour remains closed.
10. Confirm the contour does not reverse direction.
11. Confirm Undo restores the exact original points.
12. Confirm Redo reapplies the same result.
13. Test a variable glyph whose masters have compatible topology.
14. Test a glyph whose masters disagree; confirm the unsafe run remains unchanged.
15. Select a generated contour; confirm the command is disabled or reports that generated contours cannot be simplified.
