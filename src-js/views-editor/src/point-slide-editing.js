import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  chooseSlideInterval,
  getAdjacentSegments,
  makeSlideCandidate,
  slideInsertions,
  slideIntervalsCompatible,
} from "@fontra/core/point-slide.js";
import { getSkeletonData, parseSkeletonPointKey } from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import {
  cloneLayerGlyphForSkeletonEdit,
  makeEditSkeletonChange,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";

export const POINT_SLIDE_BEHAVIOR_NAME = "point-slide";

/**
 * Point slide engages on V-hold with exactly one on-curve point selected: a
 * drawn point or a skeleton centerline point. The point needs two bounding
 * on-curves to slide between, so an open contour's endpoint does not engage,
 * and neither does a point on a generated contour (its skeleton owns it).
 * When the slide is not possible the behavior name is null and the drag falls
 * through to the plain move.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Set} selection - The current selection
 * @param {Object} layerGlyph - The edit layer's glyph
 * @param {Object} options - `isGeneratedContour(contourIndex) => boolean`
 * @returns {string|null} The behavior name, or null
 */
export function getPointSlideBehaviorName(
  modifiers,
  targetKinds,
  selection,
  layerGlyph,
  { isGeneratedContour = null } = {}
) {
  if (!modifiers?.pointSlideMode) return null;
  if (targetKinds?.has("skeletonRib")) return null;
  const slideTarget = findSlideTarget(layerGlyph, selection, {
    isGeneratedContour,
  });
  return slideTarget ? POINT_SLIDE_BEHAVIOR_NAME : null;
}

/**
 * Resolve the selection to a slide target: a single on-curve point with a
 * segment on both sides, either on a drawn contour or on a skeleton
 * centerline. A skeleton selection is addressed through the edit layer's
 * skeleton data and resolved into this layer by structural ordinal.
 */
function findSlideTarget(
  layerGlyph,
  selection,
  { isGeneratedContour = null, referenceSkeletonData = null } = {}
) {
  const { point: pointSelection, skeletonPoint } = parseSelection(
    selection || new Set()
  );
  const pointCount = pointSelection?.length ?? 0;
  const skeletonCount = skeletonPoint?.length ?? 0;
  if (pointCount + skeletonCount !== 1) return null;
  return skeletonCount
    ? findSkeletonSlideTarget(layerGlyph, skeletonPoint[0], referenceSkeletonData)
    : findPathSlideTarget(layerGlyph, pointSelection[0], isGeneratedContour);
}

function findPathSlideTarget(layerGlyph, pointIndex, isGeneratedContour) {
  if (!layerGlyph?.path) return null;
  const path = layerGlyph.path;
  const point = path.getPoint(pointIndex);
  if (!point || point.type) return null;
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  if (isGeneratedContour?.(contourIndex)) return null;
  const contour = path.getUnpackedContour(contourIndex);
  const adjacent = getAdjacentSegments(contour, contourPointIndex);
  if (!adjacent.previous || !adjacent.next) return null;
  return { contourIndex, contourPointIndex, contour, adjacent };
}

function findSkeletonSlideTarget(layerGlyph, key, referenceSkeletonData) {
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData) return null;
  const parsed = parseSkeletonPointKey(key);
  if (!parsed) return null;
  const address = resolveSkeletonAddressAcrossLayers(
    referenceSkeletonData || skeletonData,
    skeletonData,
    parsed.contourId,
    parsed.pointId
  );
  if (!address || address.point.type) return null;
  const contour = {
    points: structuredClone(address.contour.points),
    isClosed: address.contour.closed === true,
  };
  const adjacent = getAdjacentSegments(contour, address.pointIndex);
  if (!adjacent.previous || !adjacent.next) return null;
  return {
    skeleton: true,
    contourIndex: address.contourIndex,
    contourPointIndex: address.pointIndex,
    contour,
    adjacent,
    insertions: structuredClone(address.contour.insertions || []),
  };
}

/**
 * One target entry per layer. The edit layer's entry owns the geometry: every
 * frame it projects the pointer onto the contour captured at mouse-down and
 * publishes the chosen side and source parameter to the session. Every other
 * layer's entry applies that same side and parameter to its own captured
 * contour, so all masters share one split location. A layer whose slide
 * interval does not match the edit layer's is left untouched for the whole
 * gesture.
 *
 * A drawn contour is written straight into the path. A skeleton centerline is
 * written into the skeleton data, insertion points carried along, and the
 * outline regenerated through the one skeleton write path.
 *
 * Every frame records against a fresh copy of the pre-drag layer, so the shape
 * cannot creep and the rollback describes the whole gesture.
 *
 * @param {Object} layerGlyph - The layer glyph being edited
 * @param {Set} selection - The current selection
 * @param {Object} options - `isGeneratedContour`, `referenceSkeletonData` (the
 *   edit layer's), `initialPointer` in glyph coordinates, `isPrimary` for the
 *   edit layer, and the per-drag `session` shared across layers
 * @returns {Array} Zero or one target entry
 */
export function createPointSlideTargetEntries(
  layerGlyph,
  selection,
  {
    isGeneratedContour = null,
    referenceSkeletonData = null,
    initialPointer = null,
    isPrimary = false,
    session = null,
  } = {}
) {
  const target = findSlideTarget(layerGlyph, selection, {
    isGeneratedContour,
    referenceSkeletonData,
  });
  if (!target || !initialPointer || !session) return [];

  // The edit layer publishes the interval every frame. Every other layer is
  // checked against it once, at construction: a master that offers a different
  // interval cannot take the shared parameter, so it sits the gesture out.
  if (isPrimary) {
    session.referenceAdjacent = target.adjacent;
  } else if (
    !session.referenceAdjacent ||
    !slideIntervalsCompatible(session.referenceAdjacent, target.adjacent)
  ) {
    return [];
  }

  const { contourIndex, contourPointIndex, contour, adjacent } = target;
  const write = target.skeleton
    ? makeSkeletonWriter(layerGlyph, target)
    : makePathWriter(layerGlyph, contourIndex);

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        // The pointer lands on the grid first, then projects onto the curve.
        const pointer = vector.roundVector({
          x: initialPointer.x + delta.x,
          y: initialPointer.y + delta.y,
        });
        let side;
        let t;
        if (isPrimary) {
          const destination = chooseSlideInterval(
            adjacent,
            pointer,
            contour.points[contourPointIndex]
          );
          if (!destination) return null;
          side = destination.side;
          t = destination.t;
          session.side = side;
          session.t = t;
        } else {
          side = session.side;
          t = session.t;
          if (side === undefined || t === undefined) return null;
        }
        const slid = makeSlideCandidate(contour, contourPointIndex, side, t);
        if (!slid) return null;
        // The slide lands on whole units, like every other drag. Only the
        // points it actually moved are rounded: a contour may hold fractional
        // points the slide never touched, and those are not this drag's to
        // change.
        const candidate = {
          ...slid,
          points: slid.points.map((point, i) => {
            const original = contour.points[i];
            return point.x === original?.x && point.y === original?.y
              ? point
              : { ...point, x: Math.round(point.x), y: Math.round(point.y) };
          }),
        };
        const changes = write(candidate, side, t);
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}

function makePathWriter(layerGlyph, contourIndex) {
  const originalPath = layerGlyph.path.copy();
  return (candidate) => {
    const scratch = { ...layerGlyph, path: originalPath.copy() };
    return recordChanges(scratch, (layerGlyphProxy) => {
      layerGlyphProxy.path.setUnpackedContour(contourIndex, {
        points: candidate.points,
        isClosed: candidate.isClosed,
      });
    });
  };
}

function makeSkeletonWriter(layerGlyph, target) {
  const { contourIndex, contour, insertions } = target;
  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layerGlyph);
  return (candidate, side, t) => {
    const movedInsertions = slideInsertions(contour, candidate, side, t, insertions);
    return makeEditSkeletonChange(originalLayerGlyph, (working) => {
      const workingContour = working.contours[contourIndex];
      workingContour.points = structuredClone(candidate.points);
      workingContour.insertions = structuredClone(movedInsertions);
    });
  };
}
