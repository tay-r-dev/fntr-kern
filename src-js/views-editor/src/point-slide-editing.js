import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  chooseSlideInterval,
  getAdjacentSegments,
  makeSlideCandidate,
  slideIntervalsCompatible,
} from "@fontra/core/point-slide.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";

export const POINT_SLIDE_BEHAVIOR_NAME = "point-slide";

/**
 * Point slide engages on V-hold with exactly one on-curve point selected. The
 * point needs two bounding on-curves to slide between, so an open contour's
 * endpoint does not engage, and neither does a generated contour. When the
 * slide is not possible the behavior name is null and the drag falls through
 * to the plain move.
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
  if (targetKinds?.has("skeletonPoint") || targetKinds?.has("skeletonRib")) return null;
  const slideTarget = findSlideTarget(layerGlyph, selection, isGeneratedContour);
  return slideTarget ? POINT_SLIDE_BEHAVIOR_NAME : null;
}

/**
 * Resolve the selection to a slide target: a single on-curve point on a
 * non-generated contour with a segment on both sides.
 */
function findSlideTarget(layerGlyph, selection, isGeneratedContour) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (pointSelection?.length !== 1 || !layerGlyph?.path) return null;
  const path = layerGlyph.path;
  const pointIndex = pointSelection[0];
  const point = path.getPoint(pointIndex);
  if (!point || point.type) return null;
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  if (isGeneratedContour?.(contourIndex)) return null;
  const contour = path.getUnpackedContour(contourIndex);
  const adjacent = getAdjacentSegments(contour, contourPointIndex);
  if (!adjacent.previous || !adjacent.next) return null;
  return {
    contourIndex,
    contourPointIndex,
    startIndex: path.getAbsolutePointIndex(contourIndex, 0),
    contour,
    adjacent,
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
 * The entry records against a fresh copy of the pre-drag path every frame, the
 * same scratch-per-frame the base expand entry uses, so the shape cannot creep
 * and the rollback describes the whole gesture.
 *
 * @param {Object} layerGlyph - The layer glyph being edited
 * @param {Set} selection - The current selection
 * @param {Object} options - `isGeneratedContour`, `initialPointer` in glyph
 *   coordinates, `isPrimary` for the edit layer, and the per-drag `session`
 *   shared across layers
 * @returns {Array} Zero or one target entry
 */
export function createPointSlideTargetEntries(
  layerGlyph,
  selection,
  {
    isGeneratedContour = null,
    initialPointer = null,
    isPrimary = false,
    session = null,
  } = {}
) {
  const target = findSlideTarget(layerGlyph, selection, isGeneratedContour);
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

  const originalPath = layerGlyph.path.copy();
  const { contourIndex, contourPointIndex, startIndex, contour, adjacent } = target;

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
        const candidate = makeSlideCandidate(contour, contourPointIndex, side, t);
        if (!candidate) return null;
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          layerGlyphProxy.path.setUnpackedContour(contourIndex, {
            points: candidate.points,
            isClosed: candidate.isClosed,
          });
        });
        rollbackChange = changes.rollbackChange;
        if (isPrimary) {
          session.movedPointIndex = startIndex + candidate.movedPointIndex;
        }
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}
