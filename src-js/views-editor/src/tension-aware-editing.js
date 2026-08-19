import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import {
  applyTensionAwareEdit,
  curvesAreAboveFloor,
  solveRigidLinkScale,
} from "@fontra/core/tension-aware-edit.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { EditBehaviorFactory } from "./edit-behavior.js";

export const TENSION_AWARE_BEHAVIOR_NAME = "tension-aware";
export const TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME = "tension-aware-constrain";

/**
 * X drives the correction wherever the selection is ordinary path geometry.
 * A selection holding skeleton geometry keeps the skeleton drag, which has its
 * own width semantics.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Object} event - The pointer event, for shift-constrain
 * @returns {string|null} The behavior name, or null
 */
export function getTensionAwareBehaviorName(modifiers, targetKinds, event) {
  if (!modifiers?.tensionAwareMode) return null;
  if (targetKinds?.has("skeletonPoint") || targetKinds?.has("skeletonRib")) return null;
  return event?.shiftKey
    ? TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME
    : TENSION_AWARE_BEHAVIOR_NAME;
}

// The ordinary behavior name behind each of ours. The correction runs on top of
// what the ordinary rules produce, so the rules have to run somewhere.
const BASE_BEHAVIOR_NAMES = {
  [TENSION_AWARE_BEHAVIOR_NAME]: "default",
  [TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME]: "constrain",
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
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  const baseFactory = new EditBehaviorFactory(
    { ...layerGlyph, path: originalPath },
    selection,
    false
  );
  const baseBehavior = baseFactory.getBehavior(
    BASE_BEHAVIOR_NAMES[behaviorName] || "default"
  );

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          // What the ordinary rules do with this delta, on its own copy.
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
            // What the ordinary rules alone left, kept for the comparison below.
            const uncorrected = after.points.map((point) => ({
              x: point.x,
              y: point.y,
            }));
            applyTensionAwareEdit(before.points, after.points, after.isClosed);
            const startIndex = moved.path.getAbsolutePointIndex(contourIndex, 0);
            for (let i = 0; i < after.points.length; i++) {
              const point = after.points[i];
              // The match tree already wrote the uncorrected position. Write
              // only where the correction disagrees with it, which includes a
              // correction that puts a point back where it started.
              if (point.x === uncorrected[i].x && point.y === uncorrected[i].y)
                continue;
              layerGlyphProxy.path.setPointPosition(startIndex + i, point.x, point.y);
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
  const originals = contourIndices.map((contourIndex) => ({
    contourIndex,
    startIndex: originalPath.getAbsolutePointIndex(contourIndex, 0),
    contour: originalPath.getUnpackedContour(contourIndex),
  }));

  let rollbackChange = null;
  let lastGood = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta() {
        return null;
      },
      makeChangeForTransformation(transformation) {
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

        const solved = solveRigidLinkScale(
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
        if (!lastGood) {
          return null;
        }
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          lastGood.forEach(({ points }, i) => {
            const { startIndex, contour } = originals[i];
            for (let p = 0; p < points.length; p++) {
              if (
                points[p].x === contour.points[p].x &&
                points[p].y === contour.points[p].y
              ) {
                continue;
              }
              layerGlyphProxy.path.setPointPosition(
                startIndex + p,
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

// Move every on-curve to its solved coordinate on the scaled axis, then run the
// slide and the restore over the result.
function buildFrames(originals, solved, axis) {
  return originals.map(({ contour }, i) => {
    const before = contour.points;
    const after = before.map((point) => ({ ...point }));
    for (const [index, coordinate] of solved[i]) {
      after[index][axis] = Math.round(coordinate);
    }
    applyTensionAwareEdit(before, after, contour.isClosed);
    return { points: after, isClosed: contour.isClosed };
  });
}
