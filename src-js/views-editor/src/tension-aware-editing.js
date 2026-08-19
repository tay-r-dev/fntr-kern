import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import { applyTensionAwareEdit } from "@fontra/core/tension-aware-edit.js";
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
