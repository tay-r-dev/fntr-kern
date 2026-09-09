import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  computeContourExpandOffsets,
  offsetContourAlongNormals,
} from "@fontra/core/offset-contour.js";
import { parseSelection } from "@fontra/core/utils.ts";

export const BASE_EXPAND_BEHAVIOR_NAME = "base-expand";

/**
 * The expansion keys drive the skeleton version wherever skeleton geometry is in
 * the selection; only a selection with none of it reaches this one. Both keys do
 * the same thing here, exactly as they do on a single-sided stroke, where the
 * anchored edge is decided by the contour rather than by which key is held: the
 * drag direction alone decides whether the shape grows or shrinks.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Set} selection - The current selection
 * @returns {string|null} The behavior name, or null
 */
export function getBaseExpandBehaviorName(modifiers, targetKinds, selection) {
  if (!modifiers?.fixedRibMode && !modifiers?.fixedRibCompressMode) return null;
  if (targetKinds?.has("skeletonPoint") || targetKinds?.has("skeletonRib")) return null;
  const { point: pointSelection } = parseSelection(selection || new Set());
  return pointSelection?.length ? BASE_EXPAND_BEHAVIOR_NAME : null;
}

/**
 * Group the selected path point indices by contour, dropping generated contours
 * and any point that is not an on-curve.
 */
function collectSelectedOnCurvesByContour(path, pointIndices, isGeneratedContour) {
  const byContour = new Map();
  for (const pointIndex of pointIndices) {
    const point = path.getPoint(pointIndex);
    if (!point || point.type) continue;
    const [contourIndex] = path.getContourAndPointIndex(pointIndex);
    if (isGeneratedContour?.(contourIndex)) continue;
    let indices = byContour.get(contourIndex);
    if (!indices) {
      indices = new Set();
      byContour.set(contourIndex, indices);
    }
    indices.add(pointIndex);
  }
  return byContour;
}

/**
 * The same offsets for a contour that does not hold the axis point: expand its
 * own coupled groups, but take the distance from the axis contour's projection.
 */
function borrowOffsets(contour, selectedIndices, axisContour, axisIndex, delta) {
  const axisOffsets = computeContourExpandOffsets(
    axisContour.points,
    axisContour.isClosed,
    new Set([axisIndex]),
    axisIndex,
    delta
  );
  const distance = axisOffsets.get(axisIndex);
  if (distance === undefined) return new Map();
  const own = computeContourExpandOffsets(
    contour.points,
    contour.isClosed,
    selectedIndices,
    [...selectedIndices][0],
    { x: 0, y: 0 }
  );
  for (const key of own.keys()) own.set(key, distance);
  return own;
}

/**
 * One target entry for the whole path. It captures the pre-drag geometry once at
 * construction and recomputes absolute positions from it every frame, so the
 * shape cannot creep and a drag back to zero restores the original exactly.
 * @param {Object} layerGlyph - The layer glyph being edited
 * @param {Set} selection - The current selection
 * @param {number} clickedPointIndex - Absolute index of the point under the cursor
 * @param {Object} options - `isGeneratedContour(contourIndex) => boolean`
 * @returns {Array} Zero or one target entry
 */
export function createBaseExpandTargetEntries(
  layerGlyph,
  selection,
  clickedPointIndex,
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];
  const path = layerGlyph.path;
  const byContour = collectSelectedOnCurvesByContour(
    path,
    pointSelection,
    isGeneratedContour
  );
  if (!byContour.size) return [];

  // The clicked point owns the projection axis for the whole drag. When the
  // gesture started somewhere without one - a marquee selection dragged from
  // empty space - the first selected on-curve stands in, so the axis is still a
  // point on the geometry rather than the cursor's own direction.
  const clickedIsUsable = [...byContour.values()].some((indices) =>
    indices.has(clickedPointIndex)
  );
  const axisPointIndex = clickedIsUsable
    ? clickedPointIndex
    : [...byContour.values()][0].values().next().value;
  const [axisContourIndex] = path.getContourAndPointIndex(axisPointIndex);
  const axisContour = path.getUnpackedContour(axisContourIndex);
  const axisContourStart = path.getAbsolutePointIndex(axisContourIndex, 0);

  // Captured once: every frame is measured from here, never accumulated.
  const originals = new Map();
  for (const contourIndex of byContour.keys()) {
    originals.set(contourIndex, {
      contour: path.getUnpackedContour(contourIndex),
      startIndex: path.getAbsolutePointIndex(contourIndex, 0),
    });
  }

  // The pre-drag path, kept whole. Every frame records against a fresh copy of
  // it rather than against the live glyph, which already carries the frame
  // before. Recorded against the live glyph the rollback describes one frame,
  // so an undo after the drag returns the shape to the second-to-last frame
  // instead of to where it started. This is the same scratch-per-frame the
  // skeleton's own entry uses.
  const originalPath = path.copy();

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          for (const [contourIndex, selectedAbsolute] of byContour) {
            const { contour, startIndex } = originals.get(contourIndex);
            const selectedIndices = new Set(
              [...selectedAbsolute].map((absolute) => absolute - startIndex)
            );
            const clickedIndex =
              contourIndex === axisContourIndex
                ? axisPointIndex - axisContourStart
                : -1;
            // The axis is one point's normal for the whole drag, so a contour
            // that does not contain it borrows the projected distance rather
            // than re-projecting on a normal of its own - otherwise two
            // contours in one selection would travel different distances.
            const offsets =
              clickedIndex >= 0
                ? computeContourExpandOffsets(
                    contour.points,
                    contour.isClosed,
                    selectedIndices,
                    clickedIndex,
                    delta
                  )
                : borrowOffsets(
                    contour,
                    selectedIndices,
                    axisContour,
                    axisPointIndex - axisContourStart,
                    delta
                  );
            if (!offsets.size) continue;
            const workingPoints = structuredClone(contour.points);
            if (
              !offsetContourAlongNormals(
                contour.points,
                contour.isClosed,
                offsets,
                workingPoints,
                { offsetCorners: true }
              )
            ) {
              continue;
            }
            for (let i = 0; i < workingPoints.length; i++) {
              const before = contour.points[i];
              const after = workingPoints[i];
              if (after.x === before.x && after.y === before.y) continue;
              layerGlyphProxy.path.setPointPosition(startIndex + i, after.x, after.y);
            }
          }
        });
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}
