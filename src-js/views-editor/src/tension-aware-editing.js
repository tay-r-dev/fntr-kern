import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import {
  applyTensionAwareEdit,
  buildIndexedSegments,
  curvesAreAboveFloor,
  isCubicSegment,
  solvePlainAxisScale,
  solveRigidLinkScale,
} from "@fontra/core/tension-aware-edit.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { EditBehaviorFactory } from "./edit-behavior.js";

export const TENSION_AWARE_BEHAVIOR_NAME = "tension-aware";
export const SKELETON_TENSION_AWARE_BEHAVIOR_NAME = "skeleton-tension-aware";

/**
 * X drives the correction on whatever geometry the selection holds: ordinary
 * path points take it directly, skeleton points take it on their centerline.
 * A rib selection is the width edit and keeps its own drag.
 *
 * Shift adds nothing. X already states an axis, which is the stronger of the
 * two constraints, and 0/45/90 has no diagonal left to offer under it.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @returns {string|null} The behavior name, or null
 */
export function getTensionAwareBehaviorName(modifiers, targetKinds) {
  if (!modifiers?.tensionAwareMode) return null;
  // A rib drag is the width edit: it states a distance across the stroke, and
  // there is no tension along it for the correction to hold. X stays out.
  if (targetKinds?.has("skeletonRib")) return null;
  // The centerline is a path, so it takes the same correction - but only
  // through the skeleton write path, which the ordinary entry cannot reach.
  if (targetKinds?.has("skeletonPoint")) return SKELETON_TENSION_AWARE_BEHAVIOR_NAME;
  return TENSION_AWARE_BEHAVIOR_NAME;
}

// The ordinary behavior name behind ours. The correction runs on top of what
// the ordinary rules produce, so the rules have to run somewhere.
const BASE_BEHAVIOR_NAMES = {
  [TENSION_AWARE_BEHAVIOR_NAME]: "default",
};

/**
 * One target entry for the whole path. It reproduces the ordinary edit on a
 * scratch copy of the pre-drag path, corrects it, and records the result. Every
 * frame is measured from that copy, never from the frame before it, so a slow
 * drag and a fast one ending in the same place give the same shape and the
 * rollback describes the whole gesture.
 */
export function createTensionAwareTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  { isGeneratedContour = null, scalingEditBehavior = false } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  // The same flag the caller built its own factory with. The entry measures
  // every write against what that factory put on the glyph, so a factory built
  // on the other setting hands it a baseline the glyph never held.
  const baseFactory = new EditBehaviorFactory(
    { ...layerGlyph, path: originalPath },
    selection,
    scalingEditBehavior
  );
  const baseBehavior = baseFactory.getBehavior(
    BASE_BEHAVIOR_NAMES[behaviorName] || "default"
  );

  let rollbackChange = null;
  // The axis the drag latches onto, held for the whole gesture.
  const lockDeltaToAxis = makeAxisLock();
  // Every point this entry has ever written during the gesture. See the write
  // loop below for why it has to remember them.
  const touched = new Set();
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(rawDelta) {
        // X states an axis. The larger of the two components wins and the other
        // is dropped, whatever the selection holds. The correction reads a
        // shape one axis at a time — the chain walk sorts bodies along the axis
        // being scaled, and a tension point travels on its own straight — so a
        // diagonal asks it two questions at once and neither answer is the one
        // the designer is watching.
        //
        // The axis is the drag's, not the frame's. Once the pointer has left
        // the dead zone the choice is latched, so reaching further across than
        // the drag ever went along cannot turn a narrowing into a lowering
        // halfway through. Inside the dead zone nothing is settled yet, and the
        // larger component still leads.
        const delta = lockDeltaToAxis(rawDelta);
        // What the match tree wrote to the glyph, which is the raw delta and
        // knows nothing of the lock. Every comparison below is against this,
        // because this is the state the entry's own change lands on top of.
        const written = { ...layerGlyph, path: originalPath.copy() };
        applyChange(written, baseBehavior.makeChangeForDelta(rawDelta));
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          // What the ordinary rules do with the locked delta, on its own copy.
          const moved = { ...layerGlyph, path: originalPath.copy() };
          applyChange(moved, baseBehavior.makeChangeForDelta(delta));
          for (
            let contourIndex = 0;
            contourIndex < moved.path.numContours;
            contourIndex++
          ) {
            if (isGeneratedContour?.(contourIndex)) continue;
            const before = originalPath.getUnpackedContour(contourIndex);
            const after = moved.path.getUnpackedContour(contourIndex);
            const uncorrected = written.path.getUnpackedContour(contourIndex).points;
            // No slide under a drag: the designer's own placement stands, and
            // the tension is what the correction holds. See the note on
            // `applyTensionAwareEdit`.
            applyTensionAwareEdit(before.points, after.points, after.isClosed, {
              slide: false,
            });
            const startIndex = moved.path.getAbsolutePointIndex(contourIndex, 0);
            for (let i = 0; i < after.points.length; i++) {
              const point = after.points[i];
              const absoluteIndex = startIndex + i;
              // Write wherever this differs from what the match tree put
              // there. That covers a correction that puts a point back where it
              // started, and the axis lock, which the match tree never saw.
              //
              // A point this entry has written once is written on every frame
              // after it, even where it now agrees with the match tree. Each
              // frame is measured from the pre-drag path, so a frame states the
              // whole answer or it states a lie: a point dropped from the set
              // keeps whatever an abandoned frame left on it, and the last
              // frame's rollback never names it, so the undo restores part of
              // the drag and leaves the rest.
              if (
                !touched.has(absoluteIndex) &&
                point.x === uncorrected[i].x &&
                point.y === uncorrected[i].y
              ) {
                continue;
              }
              touched.add(absoluteIndex);
              layerGlyphProxy.path.setPointPosition(absoluteIndex, point.x, point.y);
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

// A single-point drag states its own axis, and the dead zone is how far the
// pointer must travel before it counts as having stated it. Two units, so the
// first frame of a drag cannot settle the gesture on a jitter.
const AXIS_LOCK_DEADZONE = 2;

export function makeAxisLock() {
  let axis = null;
  return (rawDelta) => {
    const leading = Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? "x" : "y";
    if (
      !axis &&
      Math.max(Math.abs(rawDelta.x), Math.abs(rawDelta.y)) >= AXIS_LOCK_DEADZONE
    ) {
      axis = leading;
    }
    return (axis || leading) === "x"
      ? { x: rawDelta.x, y: 0 }
      : { x: 0, y: rawDelta.y };
  };
}

export const TENSION_AWARE_SCALE_BEHAVIOR_NAME = "tension-aware-scale";

/**
 * The transform-box half. It reads the transformation's factor and origin on
 * the one axis being scaled, solves the rigid links, then runs the same slide
 * and restore the drag uses.
 *
 * It keeps the last solve that passed the curve floor and emits that again
 * where the current one fails, so the shape stands still while the drag runs on.
 * @param {string} axis - "x" or "y"
 */
export function createTensionAwareTransformEntries(
  layerGlyph,
  selection,
  axis,
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  // Only a contour that holds a selected point takes part. A contour outside
  // the selection is not the box's to move, and it must not join the solve
  // either: its bodies would take a share of the change.
  const selectedContours = new Set(
    pointSelection.map(
      (pointIndex) => originalPath.getContourAndPointIndex(pointIndex)[0]
    )
  );
  const contourIndices = [];
  for (const i of selectedContours) {
    if (!isGeneratedContour?.(i)) contourIndices.push(i);
  }
  contourIndices.sort((a, b) => a - b);
  if (!contourIndices.length) return [];
  const solver = makeTensionAwareAxisScaleSolver(originalPath, contourIndices, axis);

  let rollbackChange = null;
  // Same rule as the drag entry: once written, written on every frame after.
  const touched = new Set();
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta() {
        return null;
      },
      makeChangeForTransformation(transformation) {
        const frames = solver.solve(transformation);
        if (!frames) {
          return null;
        }
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          frames.forEach(({ points }, i) => {
            const { startIndex, contour } = solver.originals[i];
            for (let p = 0; p < points.length; p++) {
              const absoluteIndex = startIndex + p;
              if (
                !touched.has(absoluteIndex) &&
                points[p].x === contour.points[p].x &&
                points[p].y === contour.points[p].y
              ) {
                continue;
              }
              touched.add(absoluteIndex);
              layerGlyphProxy.path.setPointPosition(
                absoluteIndex,
                points[p].x,
                points[p].y
              );
            }
          });
        });
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
    },
  ];
}

/**
 * The solve behind the transform box, on whatever path it is handed. The
 * outline entry runs it on the glyph's own path and the skeleton entry runs it
 * on the synthetic centerline path, so the rule has one copy and the two
 * callers differ only in how they write the answer back.
 *
 * It keeps the last solve that passed the curve floor and returns that again
 * where the current one fails, so the shape stands still while the drag runs on.
 *
 * @param {Object} originalPath - the pre-drag path, not written to
 * @param {number[]} contourIndices - the contours taking part, ascending
 * @param {string} axis - "x" or "y"
 */
export function makeTensionAwareAxisScaleSolver(originalPath, contourIndices, axis) {
  const originals = contourIndices.map((contourIndex) => ({
    contourIndex,
    startIndex: originalPath.getAbsolutePointIndex(contourIndex, 0),
    contour: originalPath.getUnpackedContour(contourIndex),
  }));
  let lastGood = null;
  return {
    originals,
    solve(transformation) {
      // The box hands over a full affine, already pinned about its own
      // point. On one axis it is a scale plus a shift, which are the only two
      // numbers this rule reads: `new = factor * old + shift`, so the fixed
      // coordinate is `shift / (1 - factor)`.
      const factor = axis === "x" ? transformation.xx : transformation.yy;
      const shift = axis === "x" ? transformation.dx : transformation.dy;
      if (Math.abs(factor - 1) < 1e-9) {
        return null;
      }
      const origin = shift / (1 - factor);

      // The two axes read the same shape differently. Across x a straight is
      // the drawn width and holds, while the curves take the change. Along y
      // a straight is the length the scale has to change, so every point
      // takes the plain scale and the tension correction holds the curves.
      const solve = axis === "x" ? solveRigidLinkScale : solvePlainAxisScale;
      const solved = solve(
        originals.map(({ contour }) => contour),
        axis,
        factor,
        origin
      );
      const frames = solved ? buildFrames(originals, solved, axis) : null;
      if (
        frames &&
        frames.every(({ points, isClosed }) => curvesAreAboveFloor(points, isClosed))
      ) {
        lastGood = frames;
      }
      return lastGood;
    },
  };
}

// Move every on-curve to its solved coordinate on the scaled axis, then run the
// slide and the restore over the result.
function buildFrames(originals, solved, axis) {
  return originals.map(({ contour }, i) => {
    const before = contour.points;
    const after = before.map((point) => ({ ...point }));
    // Which on-curve point each handle belongs to. A handle travels with its
    // own point, exactly as the point rules carry it under a drag. Left behind,
    // a handle stops being collinear with the straight its point stands on, and
    // the tension point's joint breaks.
    const ownerOfHandle = new Map();
    for (const segment of buildIndexedSegments(before, contour.isClosed)) {
      if (!isCubicSegment(segment)) continue;
      ownerOfHandle.set(segment.controlIndices[0], segment.startIndex);
      ownerOfHandle.set(segment.controlIndices[1], segment.endIndex);
    }
    const displacement = new Map();
    for (const [index, coordinate] of solved[i]) {
      const rounded = Math.round(coordinate);
      displacement.set(index, rounded - before[index][axis]);
      after[index][axis] = rounded;
    }
    for (const [handleIndex, ownerIndex] of ownerOfHandle) {
      const moved = displacement.get(ownerIndex);
      if (moved) {
        after[handleIndex][axis] = before[handleIndex][axis] + moved;
      }
    }
    // The axis tells the slide which straights are tracks for this scale. A
    // straight lying across the axis, held only by the curves at its two ends,
    // is not one: sliding on it moves the drawing in the direction the scale
    // never touched.
    applyTensionAwareEdit(before, after, contour.isClosed, { axis });
    return { points: after, isClosed: contour.isClosed };
  });
}
