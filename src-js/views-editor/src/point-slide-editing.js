import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  canSlideTogether,
  chooseSlideInterval,
  getSlidableSegments,
  makeSlideCandidate,
  roundSlideCandidate,
  slideInsertions,
  slideIntervalsCompatible,
} from "@fontra/core/point-slide.js";
import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import {
  CAP_BALL_EDIT_ROLES,
  bulbRoleOfSide,
  getSkeletonCapBallEdit,
  getSkeletonData,
  getSkeletonPointVSlide,
  isSkeletonSideLocked,
  parseSkeletonPointKey,
  setSkeletonCapBallEdit,
  setSkeletonPointVSlide,
} from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import {
  cloneLayerGlyphForSkeletonEdit,
  makeEditSkeletonChange,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";

export const POINT_SLIDE_BEHAVIOR_NAME = "point-slide";

/**
 * Point slide engages on V-hold with on-curve points selected, all drawn or
 * all on a skeleton centerline. One point slides whatever it is: an open
 * contour's endpoint slides along its one segment. Several points slide
 * together when every one of them is a smooth point with a segment on both
 * sides, or a corner with no handles. A point on a generated contour does not
 * engage (its skeleton owns it).
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
  if (findGeneratedSlideItem(selection)) return POINT_SLIDE_BEHAVIOR_NAME;
  if (targetKinds?.has("skeletonRib")) return null;
  const targets = findSlideTargets(layerGlyph, selection, { isGeneratedContour });
  return targets ? POINT_SLIDE_BEHAVIOR_NAME : null;
}

/**
 * Resolve the selection to slide targets, in selection order, or null when it
 * cannot slide. A skeleton selection is addressed through the edit layer's
 * skeleton data and resolved into this layer by structural ordinal.
 */
function findSlideTargets(
  layerGlyph,
  selection,
  { isGeneratedContour = null, referenceSkeletonData = null } = {}
) {
  const { point: pointSelection, skeletonPoint } = parseSelection(
    selection || new Set()
  );
  const pointCount = pointSelection?.length ?? 0;
  const skeletonCount = skeletonPoint?.length ?? 0;
  if (!pointCount === !skeletonCount) return null;
  const targets = skeletonCount
    ? skeletonPoint.map((key) =>
        findSkeletonSlideTarget(layerGlyph, key, referenceSkeletonData)
      )
    : pointSelection.map((pointIndex) =>
        findPathSlideTarget(layerGlyph, pointIndex, isGeneratedContour)
      );
  if (targets.some((target) => !target)) return null;
  if (
    targets.length > 1 &&
    !targets.every((target) =>
      canSlideTogether(target.contour, target.contourPointIndex)
    )
  ) {
    return null;
  }
  return targets;
}

function findPathSlideTarget(layerGlyph, pointIndex, isGeneratedContour) {
  if (!layerGlyph?.path) return null;
  const path = layerGlyph.path;
  const point = path.getPoint(pointIndex);
  if (!point || point.type) return null;
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  if (isGeneratedContour?.(contourIndex)) return null;
  const contour = path.getUnpackedContour(contourIndex);
  const adjacent = getSlidableSegments(contour, contourPointIndex);
  if (!adjacent.previous && !adjacent.next) return null;
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
  const adjacent = getSlidableSegments(contour, address.pointIndex);
  if (!adjacent.previous && !adjacent.next) return null;
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
 * frame it projects each selected point's pointer onto that point's contour
 * and publishes the chosen side and source parameter to the session, point by
 * point. Every other layer's entry applies those same sides and parameters to
 * its own captured contours, so all masters share the split locations. A layer
 * whose slide intervals do not match the edit layer's is left untouched for
 * the whole gesture.
 *
 * One point follows the pointer itself. Several points each follow their own
 * position moved by the pointer's travel. Points on one contour slide one
 * after another on that contour, each from where the ones before it left it,
 * so two neighbours that share a segment both land on it.
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
  if (findGeneratedSlideItem(selection)) {
    return createGeneratedSlideTargetEntries(layerGlyph, selection, {
      referenceSkeletonData,
      initialPointer,
      isPrimary,
      session,
    });
  }
  const targets = findSlideTargets(layerGlyph, selection, {
    isGeneratedContour,
    referenceSkeletonData,
  });
  if (!targets || !initialPointer || !session) return [];

  // The edit layer publishes the intervals every frame. Every other layer is
  // checked against them once, at construction: a master that offers a
  // different interval cannot take the shared parameter, so it sits the
  // gesture out.
  if (isPrimary) {
    session.referenceAdjacents = targets.map((target) => target.adjacent);
  } else if (
    session.referenceAdjacents?.length !== targets.length ||
    targets.some(
      (target, i) =>
        !slideIntervalsCompatible(session.referenceAdjacents[i], target.adjacent)
    )
  ) {
    return [];
  }

  const write = targets[0].skeleton
    ? makeSkeletonWriter(layerGlyph)
    : makePathWriter(layerGlyph);

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
        const travel = vector.subVectors(pointer, initialPointer);
        const pointerFor = (point) =>
          targets.length === 1 ? pointer : vector.addVectors(point, travel);
        if (isPrimary) {
          // The point ahead in the travel slides first, so the points behind
          // it find their way clear. Taken the other way round, a point sliding
          // toward its neighbour stopped at the neighbour's old place.
          const ahead = targets.map((target) => {
            const point = target.contour.points[target.contourPointIndex];
            const side = chooseSlideInterval(
              target.adjacent,
              pointerFor(point),
              point
            )?.side;
            return side === "previous"
              ? -target.contourPointIndex
              : target.contourPointIndex;
          });
          // ponytail: array order, so a group across a closed contour's seam
          // can still meet itself there; order along the contour if it matters.
          session.order = targets.map((_, i) => i).sort((a, b) => ahead[b] - ahead[a]);
          session.moves = [];
        } else if (session.order?.length !== targets.length) {
          return null;
        }
        // contourIndex -> {contour, insertions}, the state each slide starts from.
        const slid = new Map();
        for (const i of session.order) {
          const target = targets[i];
          const { contourIndex, contourPointIndex } = target;
          const state = slid.get(contourIndex) ?? {
            contour: target.contour,
            insertions: target.insertions,
          };
          let move;
          if (isPrimary) {
            const point = state.contour.points[contourPointIndex];
            const adjacent = getSlidableSegments(state.contour, contourPointIndex);
            // A tension point keeps to its straight: the side refused at
            // mouse-down stays refused while its neighbours slide.
            for (const side of ["previous", "next"]) {
              if (!target.adjacent[side]) adjacent[side] = null;
            }
            const destination = chooseSlideInterval(adjacent, pointerFor(point), point);
            move = destination && { side: destination.side, t: destination.t };
            session.moves[i] = move;
          } else {
            move = session.moves[i];
          }
          if (!move) continue;
          const candidate = makeSlideCandidate(
            state.contour,
            contourPointIndex,
            move.side,
            move.t
          );
          if (!candidate) continue;
          // The slide lands on whole units, like every other drag, with the
          // smooth points it touched kept smooth.
          const rounded = roundSlideCandidate(state.contour, candidate);
          slid.set(contourIndex, {
            contour: { points: rounded.points, isClosed: rounded.isClosed },
            insertions:
              target.skeleton &&
              slideInsertions(
                state.contour,
                rounded,
                move.side,
                move.t,
                state.insertions
              ),
          });
        }
        if (!slid.size) return null;
        const changes = write(slid);
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}

function makePathWriter(layerGlyph) {
  const originalPath = layerGlyph.path.copy();
  return (slid) => {
    const scratch = { ...layerGlyph, path: originalPath.copy() };
    return recordChanges(scratch, (layerGlyphProxy) => {
      for (const [contourIndex, { contour }] of slid) {
        layerGlyphProxy.path.setUnpackedContour(contourIndex, contour);
      }
    });
  };
}

function makeSkeletonWriter(layerGlyph) {
  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layerGlyph);
  return (slid) =>
    makeEditSkeletonChange(originalLayerGlyph, (working) => {
      for (const [contourIndex, { contour, insertions }] of slid) {
        const workingContour = working.contours[contourIndex];
        workingContour.points = structuredClone(contour.points);
        workingContour.insertions = structuredClone(insertions);
      }
    });
}

// A generated on-curve slides too. It is reached as a generated point, a bulb
// point, or the rib end that sits on it, one at a time. The slide is stored as
// the share of the neighbouring segment the point went into, and the generator
// repeats it on every rebuild: see the V-slide step in the generator.
function findGeneratedSlideItem(selection) {
  const parsed = parseSelection(selection || new Set());
  if (parsed.point?.length || parsed.skeletonPoint?.length) return null;
  const generated = parsed.editableGeneratedPoint || [];
  const ribs = parsed.skeletonRib || [];
  if (generated.length + ribs.length !== 1) return null;
  const [contourId, pointId, side] = `${generated[0] ?? ribs[0]}`.split("/");
  const bulbRole = bulbRoleOfSide(side);
  if (!bulbRole && side !== "left" && side !== "right") return null;
  if (bulbRole && bulbRole !== "neck") return null;
  return { contourId: Number(contourId), pointId: Number(pointId), side, bulbRole };
}

function createGeneratedSlideTargetEntries(
  layerGlyph,
  selection,
  { referenceSkeletonData, initialPointer, isPrimary, session }
) {
  const item = findGeneratedSlideItem(selection);
  const skeletonData = getSkeletonData(layerGlyph);
  if (!item || !skeletonData || !initialPointer || !session) return [];
  if (item.bulbRole && item.bulbRole !== "neck") return [];
  const address = resolveSkeletonAddressAcrossLayers(
    referenceSkeletonData || skeletonData,
    skeletonData,
    item.contourId,
    item.pointId
  );
  if (!address || address.point.type) return [];
  if (!item.bulbRole && isSkeletonSideLocked(address.point, item.side, "slide")) {
    return [];
  }
  const read = (point) =>
    item.bulbRole
      ? getSkeletonCapBallEdit(point, item.bulbRole).vslide
      : getSkeletonPointVSlide(point, item.side);
  const write = (point, value) =>
    item.bulbRole
      ? setSkeletonCapBallEdit(point, item.bulbRole, { vslide: value })
      : setSkeletonPointVSlide(point, item.side, value);

  // The outline this point slides on: the one the generator slides it on,
  // which is the outline with this one slide taken away.
  // ponytail: other slides and bulb edits stay in; a neighbour's own slide can
  // move the segment the generator starts from. Exact when one point is slid.
  const unslid = structuredClone(skeletonData);
  write(unslid.contours[address.contourIndex].points[address.pointIndex], 0);
  const generated = generateFromSkeleton(unslid);
  const matches = (origin) =>
    item.bulbRole
      ? origin?.bulbRole === item.bulbRole && origin.bulbSlot === "onCurve"
      : origin?.skeletonPointId === item.pointId &&
        origin.side === item.side &&
        origin.role === "onCurve" &&
        !origin.bulbRole;
  let found = null;
  generated.provenance.forEach((entry, k) => {
    if (found || entry.skeletonContourId !== address.contour.id) return;
    const index = entry.pointMap.findIndex(
      (origin) => origin?.skeletonPointId === item.pointId && matches(origin)
    );
    if (index >= 0) found = { k, index, pointMap: entry.pointMap };
  });
  if (!found) return [];
  const contour = {
    points: generated.contours[found.k].points,
    isClosed: generated.contours[found.k].isClosed,
  };
  const adjacent = getSlidableSegments(contour, found.index);
  if (!adjacent.previous && !adjacent.next) return [];
  const forward = generatedSlideForward(contour, found, item);
  const point = contour.points[found.index];
  const projectedShare = (pointer) => {
    const destination = chooseSlideInterval(adjacent, pointer, point);
    if (!destination) return null;
    const share = destination.side === "next" ? destination.t : 1 - destination.t;
    return destination.side === forward ? share : -share;
  };
  // Calibrate at mouse-down, so rounding a still grab of an already edited
  // neck preserves its value.
  const initialShare = item.bulbRole
    ? (projectedShare(vector.roundVector(initialPointer)) ?? 0)
    : 0;
  const originalShare = read(address.point) ?? 0;

  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layerGlyph);
  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        let value;
        if (isPrimary) {
          // The pointer lands on the grid first, as in the drawn V-slide.
          const pointer = vector.roundVector({
            x: initialPointer.x + delta.x,
            y: initialPointer.y + delta.y,
          });
          const share = projectedShare(pointer);
          if (share === null) return null;
          value = item.bulbRole ? originalShare + share - initialShare : share;
          if (item.bulbRole) value = Math.max(-0.8, Math.min(0.8, value));
          session.generatedSlide = value;
        } else {
          value = session.generatedSlide;
          if (value === undefined) return null;
        }
        const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
          const target =
            working.contours?.[address.contourIndex]?.points?.[address.pointIndex];
          if (target) write(target, Math.round(value * 1000) / 1000);
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

// Which way along the contour a positive share runs. A rib's share is stated
// along the skeleton: its left side is emitted in skeleton order, its right
// side backwards. A bulb point's share runs from the outer wall to the inner,
// which is the contour's own order where the next bulb point follows it.
const BULB_ORDER = CAP_BALL_EDIT_ROLES;
function generatedSlideForward(contour, found, item) {
  if (!item.bulbRole) return item.side === "left" ? "next" : "previous";
  const onCurveOrigin = (step) => {
    const n = contour.points.length;
    for (let i = 1; i < n; i++) {
      const index = (found.index + step * i + n) % n;
      if (!contour.points[index].type) return found.pointMap[index];
    }
    return null;
  };
  const position = BULB_ORDER.indexOf(item.bulbRole);
  const nextRole = onCurveOrigin(1)?.bulbRole;
  const previousRole = onCurveOrigin(-1)?.bulbRole;
  if (nextRole) return BULB_ORDER.indexOf(nextRole) > position ? "next" : "previous";
  if (previousRole)
    return BULB_ORDER.indexOf(previousRole) < position ? "next" : "previous";
  return "next";
}
