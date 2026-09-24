import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  handleOwnerIndex,
  slideHandleAlongItself,
} from "@fontra/core/handle-length.js";
import { getSkeletonData, parseSkeletonPointKey } from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import {
  cloneLayerGlyphForSkeletonEdit,
  makeEditSkeletonChange,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";

export const HANDLE_LENGTH_BEHAVIOR_NAME = "handle-length";

/**
 * The B drag engages on B-hold where the selection holds at least one handle
 * with an owner: a drawn handle, or a handle on a skeleton centerline. A handle
 * on a generated contour does not engage (its skeleton owns it). Everything
 * else in the selection holds still for the drag.
 * When nothing qualifies the behavior name is null and the drag falls through
 * to the plain move.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Set} selection - The current selection
 * @param {Object} layerGlyph - The edit layer's glyph
 * @param {Object} options - `isGeneratedContour(contourIndex) => boolean`
 * @returns {string|null} The behavior name, or null
 */
export function getHandleLengthBehaviorName(
  modifiers,
  targetKinds,
  selection,
  layerGlyph,
  { isGeneratedContour = null } = {}
) {
  if (!modifiers?.handleLengthMode) return null;
  if (targetKinds?.has("skeletonRib")) return null;
  const targets = findHandleTargets(layerGlyph, selection, { isGeneratedContour });
  return targets ? HANDLE_LENGTH_BEHAVIOR_NAME : null;
}

/**
 * The selected handles, each with the on-curve it grows from. Skeleton handles
 * win over drawn ones when a selection holds both: a skeleton write regenerates
 * the outline, and one entry per layer keeps one write path (R-C).
 */
function findHandleTargets(
  layerGlyph,
  selection,
  { isGeneratedContour = null, referenceSkeletonData = null } = {}
) {
  const { point: pointSelection, skeletonPoint } = parseSelection(
    selection || new Set()
  );
  if (skeletonPoint?.length) {
    const handles = findSkeletonHandles(
      layerGlyph,
      skeletonPoint,
      referenceSkeletonData
    );
    if (handles.length) return { skeleton: true, handles };
  }
  if (pointSelection?.length && layerGlyph?.path) {
    const handles = findPathHandles(
      layerGlyph.path,
      pointSelection,
      isGeneratedContour
    );
    if (handles.length) return { skeleton: false, handles };
  }
  return null;
}

function findPathHandles(path, pointIndices, isGeneratedContour) {
  const handles = [];
  for (const pointIndex of pointIndices) {
    const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
    if (isGeneratedContour?.(contourIndex)) continue;
    const contour = path.getUnpackedContour(contourIndex);
    const owner = handleOwnerIndex(contour.points, contour.isClosed, contourPointIndex);
    if (owner < 0) continue;
    handles.push({
      pointIndex,
      ownerIndex: pointIndex - contourPointIndex + owner,
    });
  }
  return handles;
}

function findSkeletonHandles(layerGlyph, keys, referenceSkeletonData) {
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData) return [];
  const handles = [];
  for (const key of keys) {
    const parsed = parseSkeletonPointKey(`${key}`);
    if (!parsed) continue;
    const address = resolveSkeletonAddressAcrossLayers(
      referenceSkeletonData || skeletonData,
      skeletonData,
      parsed.contourId,
      parsed.pointId
    );
    if (!address) continue;
    const owner = handleOwnerIndex(
      address.contour.points,
      address.contour.closed === true,
      address.pointIndex
    );
    if (owner < 0) continue;
    handles.push({
      contourIndex: address.contourIndex,
      pointIndex: address.pointIndex,
      ownerIndex: owner,
    });
  }
  return handles;
}

/**
 * One target entry per layer. Every layer applies the pointer's movement to
 * its own handles, each along its own direction, so every master keeps its own
 * angles.
 *
 * Every frame records against a fresh copy of the pre-drag layer, so the
 * direction is read from where the handle started and a handle that reaches
 * its on-curve point keeps its direction for the rest of the drag.
 *
 * @param {Object} layerGlyph - The layer glyph being edited
 * @param {Set} selection - The current selection
 * @param {Object} options - `isGeneratedContour`, `referenceSkeletonData` (the
 *   edit layer's)
 * @returns {Array} Zero or one target entry
 */
export function createHandleLengthTargetEntries(
  layerGlyph,
  selection,
  { isGeneratedContour = null, referenceSkeletonData = null } = {}
) {
  const targets = findHandleTargets(layerGlyph, selection, {
    isGeneratedContour,
    referenceSkeletonData,
  });
  if (!targets) return [];
  const write = targets.skeleton
    ? makeSkeletonWriter(layerGlyph, targets.handles)
    : makePathWriter(layerGlyph, targets.handles);

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const changes = write(delta);
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}

function makePathWriter(layerGlyph, handles) {
  const originalPath = layerGlyph.path.copy();
  return (delta) => {
    const scratch = { ...layerGlyph, path: originalPath.copy() };
    return recordChanges(scratch, (layerGlyphProxy) => {
      for (const { pointIndex, ownerIndex } of handles) {
        const moved = vector.roundVector(
          slideHandleAlongItself(
            originalPath.getPoint(ownerIndex),
            originalPath.getPoint(pointIndex),
            delta
          )
        );
        layerGlyphProxy.path.setPointPosition(pointIndex, moved.x, moved.y);
      }
    });
  };
}

function makeSkeletonWriter(layerGlyph, handles) {
  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layerGlyph);
  const originalContours = getSkeletonData(originalLayerGlyph).contours;
  return (delta) =>
    makeEditSkeletonChange(originalLayerGlyph, (working) => {
      for (const { contourIndex, pointIndex, ownerIndex } of handles) {
        const points = originalContours[contourIndex].points;
        const moved = vector.roundVector(
          slideHandleAlongItself(points[ownerIndex], points[pointIndex], delta)
        );
        const point = working.contours[contourIndex].points[pointIndex];
        point.x = moved.x;
        point.y = moved.y;
      }
    });
}
