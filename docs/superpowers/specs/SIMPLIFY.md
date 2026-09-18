# Simplify

## Short specification

Simplify reduces the number of editable points in one selected contour while keeping the contour visually and geometrically close to its original shape.

The operation works on ordinary editable contours only. It does not edit generated contours, skeleton data, components, anchors, or other glyph objects. It creates a new contour shape in one undoable change and preserves the contour's open/closed state and winding direction.

The result must:

- keep every required endpoint and corner;
- keep all true curve extrema and inflection boundaries needed by the editor;
- keep the same contour topology and cubic representation used by interpolation;
- avoid changing the number of points differently between compatible masters;
- move the fewest possible points for the requested tolerance;
- report when the requested tolerance cannot be met without changing a protected point.

The user chooses a tolerance. A lower tolerance removes fewer points. A higher tolerance permits more replacement of adjacent cubic segments by one cubic. The default must be conservative and must be expressed in font units, not screen pixels.

The reference `svg-path-simplify` is useful for its analysis order: normalize cubics, mark extrema/corners/inflections, then merge adjacent cubics only after measuring error at several points. Its whole-SVG cleanup and command minification must not be imported.

## Decisions

1. **Extrema first, deletion second.** First split cubics at interior derivative roots so extrema become on-curve points. Then simplify only the spans between protected points.
2. **Protected points are permanent.** Contour endpoints, corners, true extrema, inflections, and points carrying editor metadata stay. A point that cannot be safely classified stays.
3. **Merge by fitting, not by deleting blindly.** A candidate run is replaced by one cubic whose endpoints and endpoint tangents come from the original run. Accept it only when sampled deviation and tangent error are within tolerance.
4. **Exact topology wins over compression.** If a master cannot accept the same merge as its peers, do not merge that run. The feature must never make interpolation incompatible.
5. **One contour at a time.** A multi-contour selection runs the same operation independently per contour, inside one undo transaction.
6. **No generated geometry.** Generated contours are rejected before analysis. The user must simplify the skeleton or source contour instead.

## Detailed implementation plan

### Step 1 — Confirm the existing path model

1. Read `VarPackedPath`, `getUnpackedContour`, `insertPoint`, `deletePoint`, and `setPointType`.
2. Write down the exact point order for a cubic: on-curve, first off-curve, second off-curve, next on-curve.
3. Confirm how open contours represent their first and last points.
4. Confirm how `smooth` is stored and copied.
5. Confirm how `pointAttributes` and any editor metadata move when a point is inserted or deleted.
6. Confirm the generated-contour predicate in `scene-model.js`.
7. Do not implement anything until these answers are written in code comments or this document.

### Step 2 — Add pure cubic geometry helpers

Create a core module, preferably `fontra-core/src/path-simplification.js`.

Add these functions, each with a small unit test:

1. `cubicDerivative(p0, p1, p2, p3, t)`.
2. `cubicExtremaParameters(points)`.
   - Solve the quadratic derivative for x and y.
   - Keep roots strictly inside `(0, 1)`.
   - Deduplicate roots within a small epsilon.
3. `splitCubicAtParameters(points, parameters)`.
   - Sort parameters.
   - Use de Casteljau splitting.
   - Return exact cubic pieces in path order.
4. `cubicPoint(points, t)`.
5. `cubicTangent(points, t)`.
6. `cubicArcLength(points, t0, t1)`.
   - Use the existing core length helper if one already exists.
   - Do not add a second numerical integrator.
7. `fitCubicToSpan(span, startTangent, endTangent)`.
   - Keep the span endpoints fixed.
   - Keep tangent directions fixed.
   - Solve only the two handle lengths.
8. `maxCubicDeviation(originalPieces, candidate, samples)`.
   - Sample the original pieces at fixed source parameters.
   - Measure geometric distance to the candidate.
   - Include midpoint and quarter points; do not use only endpoints.
9. `mergeCubicPiecesIfSafe(pieces, tolerance)`.
   - Fit one cubic.
   - Reject if any sampled deviation exceeds tolerance.
   - Reject if tangent direction changes beyond the configured angle tolerance.
   - Return the original pieces on rejection.

Use the existing vector and Bézier helpers. Do not copy Bezier.js wholesale.

### Step 3 — Mark protected points

Implement `classifySimplifyContour(contour, options)`.

For every on-curve point:

1. Mark open-contour endpoints as protected.
2. Mark non-smooth points as protected.
3. Mark points with non-empty `attrs` as protected unless the caller explicitly opts into metadata migration.
4. For each cubic segment, solve extrema parameters.
5. If an extrema root is interior, split the segment and mark the inserted point protected.
6. Mark inflection and direction-change boundaries protected when the existing path analysis can identify them.
7. Keep a source signature for every point: contour id, source segment, source parameter, and original point id when present.
8. If classification is uncertain, protect the point.

The classifier must return a new contour description. It must not mutate the glyph.

### Step 4 — Build candidate spans

1. Walk the normalized contour in path order.
2. Start a span after each protected point.
3. End the span immediately before the next protected point.
4. Never let a candidate cross a corner, extrema, inflection, metadata point, contour endpoint, or close-path seam.
5. For a closed contour, handle the seam explicitly. Rotate the working list temporarily if that gives a longer safe span, then rotate it back before writing.
6. Keep the original source segment range for every candidate.

### Step 5 — Simplify conservatively

For each candidate span:

1. Try the longest possible replacement first.
2. Fit one cubic to the entire span.
3. Measure error against the original pieces at fixed source parameters.
4. Check endpoint tangent directions.
5. Check that the candidate does not introduce a new extremum, inflection, cusp, or self-intersection.
6. If accepted, emit one cubic.
7. If rejected, shorten the span by one source cubic and try again.
8. Continue until the span is emitted with no loss of geometry.
9. Never merge across a protected point.

The algorithm must be deterministic: same source contour, options, and tolerance produce the same output.

### Step 6 — Preserve interpolation

Before applying a merge:

1. Identify corresponding contours in every editable master.
2. Run classification on every master.
3. Compare protected-point signatures and candidate span boundaries.
4. Only apply a merge when all participating masters agree on the same topology change.
5. If they disagree, leave that span unchanged in every master.
6. Keep point order identical after the operation.
7. Keep each resulting point's `smooth` value explicit.
8. Do not invent a stable id for ordinary path points unless the existing path model requires one.

This is the most important safety rule. A visually good simplification that breaks interpolation is a failed simplification.

### Step 7 — Add the editor command

1. Add a command named `Simplify contour`.
2. Enable it only when the selection resolves to one or more editable contours.
3. Reject generated contours with a clear UI message.
4. Open a small options panel with:
   - tolerance in font units;
   - “protect extrema” enabled by default;
   - “protect inflections” enabled by default;
   - preview and cancel buttons.
5. Preview by drawing the proposed contour over the original.
6. On apply, write one change through the normal change recorder.
7. Keep selection on the nearest surviving points.
8. Make undo restore the exact original contour and metadata.

Likely files to inspect or extend:

- `fontra-core/src/path-functions.js` for path structure and edits;
- `fontra-core/src/var-path.js` for point insertion/deletion;
- `fontra-core/src/path-hit-tester.js` for segment geometry;
- `views-editor/src/scene-controller.js` for commands and selection;
- `views-editor/src/edit-tools-pointer.js` for dispatch;
- `views-editor/src/visualization-layer-definitions.js` for preview;
- `fontra-core/src/change-recorder.js` for undo;
- `fontra-core/tests/` for geometry tests.

### Step 8 — Tests

Add core tests for:

1. A straight line: no unnecessary new point.
2. A cubic with one x extremum: the extremum is inserted and protected.
3. A cubic with one y extremum.
4. Two adjacent cubics that merge within tolerance.
5. Two adjacent cubics that fail the tolerance and remain separate.
6. A corner: never merged across it.
7. An inflection: never merged across it when protection is enabled.
8. An open contour: endpoints remain fixed.
9. A closed contour: seam remains valid and winding is unchanged.
10. Metadata point: point remains and metadata remains.
11. Two masters agreeing: both simplify with identical topology.
12. Two masters disagreeing: neither simplifies that span.
13. Generated contour: command refuses it.
14. Repeated application: second application makes no additional change within tolerance.
15. A dense curve: sample error stays below tolerance.

Use sweeps over tolerances and source shapes. Do not rely on one hand-picked assertion.

### Step 9 — Manual acceptance matrix

1. Select a contour with many points and preview at low tolerance.
2. Increase tolerance and confirm only safe spans merge.
3. Confirm extrema remain visible and on-curve.
4. Confirm corners and inflections do not move.
5. Confirm the preview does not alter neighboring contours.
6. Apply, undo, and redo.
7. Test a variable glyph with two compatible masters.
8. Test a variable glyph with incompatible topology and confirm the span stays unchanged.
9. Test open and closed contours.
10. Test a generated contour and confirm the command is disabled or rejected.
