import { recordChanges } from "@fontra/core/change-recorder.js";
import { ChangeCollector } from "@fontra/core/changes.js";
import {
  areSkeletonTensionsEqualized,
  buildSkeletonTunniSegments,
  calculateGeneratedCurvatureEdits,
  calculateGeneratedOnCurveEdits,
  calculateSkeletonControlPointsFromTunniDelta,
  calculateSkeletonEqualizedControlPoints,
  calculateSkeletonOnCurveFromTunni,
  calculateSkeletonTrueTunniPoint,
  calculateSkeletonTunniPoint,
  getGeneratedPathContourIndices,
  getSkeletonData,
  getSkeletonHandleOffset,
  getSkeletonPointNudge,
  isSkeletonSideLocked,
  setSkeletonHandleDetached,
  setSkeletonHandleOffset,
  setSkeletonPointSideNudge,
  setSkeletonSegmentCurvature,
} from "@fontra/core/skeleton-model.js";
import {
  areTensionsEqualized,
  calculateControlHandlePoint,
  calculateEqualizedControlPoints,
  calculateTunniPoint,
  snapToGrid,
} from "@fontra/core/tunni-calculations.js";
import { assert } from "@fontra/core/utils.ts";
import {
  distance,
  dotVector,
  normalizeVector,
  subVectors,
} from "@fontra/core/vector.js";
import {
  editSkeleton,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";

function applyTunniDragChanges(path, dragChanges, isTrueTunniPoint) {
  if (isTrueTunniPoint) {
    path.setPointPosition(
      dragChanges.onPoint1Index,
      dragChanges.newOnPoint1.x,
      dragChanges.newOnPoint1.y
    );
    path.setPointPosition(
      dragChanges.onPoint2Index,
      dragChanges.newOnPoint2.x,
      dragChanges.newOnPoint2.y
    );
    path.setPointPosition(
      dragChanges.controlPoint1Index,
      dragChanges.newControlPoint1.x,
      dragChanges.newControlPoint1.y
    );
    path.setPointPosition(
      dragChanges.controlPoint2Index,
      dragChanges.newControlPoint2.x,
      dragChanges.newControlPoint2.y
    );
  } else {
    path.setPointPosition(
      dragChanges.controlPoint1Index,
      dragChanges.newControlPoint1.x,
      dragChanges.newControlPoint1.y
    );
    path.setPointPosition(
      dragChanges.controlPoint2Index,
      dragChanges.newControlPoint2.x,
      dragChanges.newControlPoint2.y
    );
  }
}

export function tunniHoverResult(
  point,
  size,
  positionedGlyph,
  visualizationLayersSettings,
  sceneModel = null
) {
  if (visualizationLayersSettings.model["fontra.skeleton.tunni"] && sceneModel) {
    const scenePoint = {
      x: point.x + positionedGlyph.x,
      y: point.y + positionedGlyph.y,
    };
    const skeletonHit = sceneModel.skeletonTunniAtPoint(
      scenePoint,
      size,
      positionedGlyph
    );
    if (skeletonHit?.type === "true-tunni") {
      return { cursor: "crosshair", skeletonHit };
    }
    if (skeletonHit?.type === "tunni") {
      return { cursor: "pointer", skeletonHit };
    }
  }

  if (
    visualizationLayersSettings.model["fontra.skeleton.generated-tunni"] &&
    sceneModel
  ) {
    const generatedHit = sceneModel.generatedTunniAtPoint(
      { x: point.x + positionedGlyph.x, y: point.y + positionedGlyph.y },
      size,
      positionedGlyph,
      { onCurveOffset: size * 2 }
    );
    if (generatedHit) {
      // Same cursor split as the skeleton's gizmos: crosshair moves on-curve
      // points, pointer reshapes between them.
      return {
        cursor: generatedHit.type === "generated-on-curve" ? "crosshair" : "pointer",
        generatedHit,
      };
    }
  }

  const handleLayerOn = visualizationLayersSettings.model["fontra.tunni.handle"];
  const pointLayerOn = visualizationLayersSettings.model["fontra.tunni.point"];
  if (!handleLayerOn && !pointLayerOn) {
    return null;
  }
  const hit = tunniLayerHitTest(point, size, positionedGlyph);
  if (!hit) {
    return null;
  }
  if (hit.hitType === "true-tunni-point" && pointLayerOn) {
    return { cursor: "crosshair" };
  }
  if (hit.hitType === "tunni-point" && handleLayerOn) {
    return { cursor: "pointer" };
  }
  return null;
}

export async function handleTunniDrag({
  sceneController,
  eventStream,
  initialEvent,
  isTrueTunniPoint,
  tunniInitialState,
}) {
  if (!isTrueTunniPoint && initialEvent.ctrlKey && initialEvent.shiftKey) {
    await equalizeSegmentDistances(
      tunniInitialState.tunniPointHit.segment,
      tunniInitialState.originalSegmentPoints,
      sceneController.sceneModel,
      sceneController.sceneModel.getSelectedPositionedGlyph(),
      sceneController
    );
    return;
  }

  const gridSnap = sceneController.sceneSettings?.gridSnapEnabled;

  await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const layerInfo = Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    ).map(([layerName, layerGlyph]) => ({
      layerGlyph,
      changePath: ["layers", layerName, "glyph"],
    }));
    assert(layerInfo.length >= 1, "no layer to edit");

    let accumulated = new ChangeCollector();
    let dragged = false;

    for await (const event of eventStream) {
      if (event.type === "mouseup") {
        break;
      }
      if (event.type !== "mousemove") {
        continue;
      }
      const dragChanges = isTrueTunniPoint
        ? handleTrueTunniPointMouseDrag(
            event,
            tunniInitialState,
            sceneController,
            gridSnap
          )
        : handleTunniPointMouseDrag(
            event,
            tunniInitialState,
            sceneController,
            gridSnap
          );
      if (!dragChanges) {
        continue;
      }
      dragged = true;

      let frame = new ChangeCollector();
      for (const { layerGlyph, changePath } of layerInfo) {
        const layerChanges = recordChanges(layerGlyph, (proxy) => {
          applyTunniDragChanges(proxy.path, dragChanges, isTrueTunniPoint);
        });
        frame = frame.concat(layerChanges.prefixed(changePath));
      }
      accumulated = accumulated.concat(frame);
      await sendIncrementalChange(frame.change, true);
    }

    if (!dragged || !accumulated.hasChange) {
      return;
    }

    return {
      changes: accumulated,
      undoLabel: isTrueTunniPoint
        ? "Move On-Curve Points via Tunni"
        : "Move Tunni Points",
      broadcast: true,
    };
  });
}

export async function handleSkeletonTunniDrag({
  sceneController,
  eventStream,
  initialEvent,
  tunniHit,
}) {
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return;
  }

  const startPoint = sceneController.localPoint(initialEvent);
  const startGlyphPoint = {
    x: startPoint.x - positionedGlyph.x,
    y: startPoint.y - positionedGlyph.y,
  };
  const originalSegment = copySkeletonTunniSegment(tunniHit.segment);
  const isTrueTunni = tunniHit.type === "true-tunni";
  const originalTunniPoint = isTrueTunni
    ? calculateSkeletonTrueTunniPoint(originalSegment)
    : calculateSkeletonTunniPoint(originalSegment);
  if (!originalTunniPoint) {
    return;
  }

  await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const layerInfo = Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    )
      .map(([layerName, layerGlyph]) => ({
        layerName,
        layerGlyph,
        changePath: ["layers", layerName, "glyph"],
        originalSkeletonData: getSkeletonData(layerGlyph),
      }))
      .filter((entry) => entry.originalSkeletonData?.contours?.length);
    if (!layerInfo.length) {
      return;
    }

    let accumulated = new ChangeCollector();
    let dragged = false;

    for await (const event of eventStream) {
      if (event.type === "mouseup") {
        break;
      }
      if (event.type !== "mousemove") {
        continue;
      }
      const currentPoint = sceneController.localPoint(event);
      const currentGlyphPoint = {
        x: currentPoint.x - positionedGlyph.x,
        y: currentPoint.y - positionedGlyph.y,
      };
      const delta = {
        x: currentGlyphPoint.x - startGlyphPoint.x,
        y: currentGlyphPoint.y - startGlyphPoint.y,
      };
      const nextTrueTunniPoint = {
        x: originalTunniPoint.x + delta.x,
        y: originalTunniPoint.y + delta.y,
      };
      const round = sceneController.sceneSettings?.gridSnapEnabled
        ? Math.round
        : (value) => value;
      let frame = new ChangeCollector();

      for (const { layerGlyph, changePath, originalSkeletonData } of layerInfo) {
        const changes = editSkeleton(layerGlyph, (working) => {
          const target = resolveSkeletonTunniSegment(
            originalSkeletonData,
            working,
            tunniHit
          );
          if (!target) {
            return;
          }
          if (isTrueTunni) {
            const endpoints = calculateSkeletonOnCurveFromTunni(
              nextTrueTunniPoint,
              target.originalSegment,
              !event.altKey
            );
            if (!endpoints) {
              return;
            }
            const [nextStartPoint, nextEndPoint] = endpoints;
            writePointPosition(
              target.workingContour.points[target.originalSegment.startIndex],
              nextStartPoint,
              round
            );
            writePointPosition(
              target.workingContour.points[target.originalSegment.endIndex],
              nextEndPoint,
              round
            );
          } else {
            const controlPoints = calculateSkeletonControlPointsFromTunniDelta(
              delta,
              target.originalSegment,
              !event.altKey
            );
            if (!controlPoints) {
              return;
            }
            const [controlIndex1, controlIndex2] =
              target.originalSegment.controlIndices;
            writePointPosition(
              target.workingContour.points[controlIndex1],
              controlPoints[0],
              round
            );
            writePointPosition(
              target.workingContour.points[controlIndex2],
              controlPoints[1],
              round
            );
          }
        });
        if (changes.hasChange) {
          frame = frame.concat(changes.prefixed(changePath));
        }
      }

      if (!frame.hasChange) {
        continue;
      }
      dragged = true;
      accumulated = accumulated.concat(frame);
      await sendIncrementalChange(frame.change, true);
    }

    if (!dragged || !accumulated.hasChange) {
      return;
    }

    return {
      changes: accumulated,
      undoLabel: isTrueTunni
        ? "Move Skeleton On-Curve Points (Tunni)"
        : "Move Skeleton Control Points (Tunni)",
      broadcast: true,
    };
  });
}

//
// Dragging one of the two gizmos on a GENERATED segment (D8).
//
// Both write skeleton fields that already exist — the curvature gizmo writes
// handle offsets, the on-curve gizmo writes nudges — so this adds an affordance,
// not a storage mode (D10). Nothing here is reachable only through a gizmo: the
// same two edits can be made by hand.
//
// Edits are computed ONCE, from the geometry under the pointer, and applied as
// deltas on top of each edited layer's own original value. Recomputing per layer
// would need that layer's generated geometry, which is only produced after the
// skeleton is written — and a delta is what keeps interpolation honest anyway.
//
export async function handleGeneratedTunniDrag({
  sceneController,
  eventStream,
  initialEvent,
  gizmoHit,
}) {
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return;
  }
  const segment = gizmoHit.segment;
  const originalPoints = segment.points.map((point) => ({ x: point.x, y: point.y }));
  const isCurvature = gizmoHit.type === "generated-curvature";
  const originalTunniPoint = calculateTunniPoint(originalPoints);
  if (!originalTunniPoint) {
    return;
  }

  const startPoint = sceneController.localPoint(initialEvent);
  const startGlyphPoint = {
    x: startPoint.x - positionedGlyph.x,
    y: startPoint.y - positionedGlyph.y,
  };

  await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const layerInfo = Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    )
      .map(([layerName, layerGlyph]) => ({
        layerName,
        layerGlyph,
        changePath: ["layers", layerName, "glyph"],
        originalSkeletonData: getSkeletonData(layerGlyph),
      }))
      .filter((entry) => entry.originalSkeletonData?.contours?.length);
    if (!layerInfo.length) {
      return;
    }

    // Drag-start values, per layer. Read once: `working` accumulates as the
    // drag proceeds, so reading it per frame would compound the delta.
    const referenceSkeletonData = getSkeletonData(
      positionedGlyph.varGlyph?.glyph?.layers?.[positionedGlyph.glyph?.layerName]
        ?.glyph || positionedGlyph.glyph
    );
    for (const entry of layerInfo) {
      entry.originals = segment.provenance.map((provenance) => {
        const resolved = resolveSkeletonAddressAcrossLayers(
          referenceSkeletonData,
          entry.originalSkeletonData,
          provenance.skeletonContourId ?? segment.skeletonContourId,
          provenance.skeletonPointId
        );
        if (!resolved) {
          return null;
        }
        // A segment's four provenance entries are two handles and two rib ends.
        // Only handles have a stored offset — asking for one under an "onCurve"
        // role is an error, not an empty result — and only rib ends have a
        // nudge. Read each where it exists.
        //
        const isHandle = provenance.role === "in" || provenance.role === "out";
        return {
          contourIndex: resolved.contourIndex,
          pointIndex: resolved.pointIndex,
          side: provenance.side,
          role: provenance.role,
          offset: isHandle
            ? getSkeletonHandleOffset(resolved.point, provenance.side, provenance.role)
            : null,
          nudge: isHandle
            ? 0
            : getSkeletonPointNudge(
                resolved.point,
                provenance.side,
                resolved.contour.defaultWidth
              ),
        };
      });
    }

    let accumulated = new ChangeCollector();
    let dragged = false;

    for await (const event of eventStream) {
      if (event.type === "mouseup") {
        break;
      }
      if (event.type !== "mousemove") {
        continue;
      }
      const currentPoint = sceneController.localPoint(event);
      const delta = {
        x: currentPoint.x - positionedGlyph.x - startGlyphPoint.x,
        y: currentPoint.y - positionedGlyph.y - startGlyphPoint.y,
      };
      const round = sceneController.sceneSettings?.gridSnapEnabled
        ? Math.round
        : (value) => value;

      const writes = isCurvature
        ? generatedCurvatureWrites(originalPoints, segment, delta)
        : generatedOnCurveWrites(originalPoints, segment, delta);
      if (!writes) {
        continue;
      }

      let frame = new ChangeCollector();
      for (const { layerGlyph, changePath, originals } of layerInfo) {
        const changes = editSkeleton(layerGlyph, (working) => {
          for (const [index, write] of writes) {
            const original = originals[index];
            const point =
              working?.contours?.[original?.contourIndex]?.points?.[
                original?.pointIndex
              ];
            if (!original || !point || isSkeletonSideLocked(point, original.side)) {
              continue;
            }
            if (write.pinnedTension !== undefined) {
              // Absolute, not a delta: the drag already computed the tension it
              // wants from the geometry it grabbed, and every mousemove restates
              // it against the same original. Accumulating it would compound.
              setSkeletonSegmentCurvature(point, original.side, write.pinnedTension);
            } else if (write.offsetDelta && original.offset) {
              setSkeletonHandleOffset(
                point,
                original.side,
                original.role,
                {
                  x: original.offset.x + write.offsetDelta.x,
                  y: original.offset.y + write.offsetDelta.y,
                  detached: original.offset.detached,
                },
                { round }
              );
            } else if (write.nudgeDelta !== undefined) {
              setSkeletonPointSideNudge(
                point,
                original.side,
                original.nudge + write.nudgeDelta,
                { round }
              );
            }
          }
        });
        if (changes.hasChange) {
          frame = frame.concat(changes.prefixed(changePath));
        }
      }

      if (!frame.hasChange) {
        continue;
      }
      dragged = true;
      accumulated = accumulated.concat(frame);
      await sendIncrementalChange(frame.change, true);
    }

    if (!dragged || !accumulated.hasChange) {
      return;
    }
    return {
      changes: accumulated,
      undoLabel: isCurvature
        ? "Adjust Generated Curvature"
        : "Move Generated On-Curves",
      broadcast: true,
    };
  });
}

export async function handleGeneratedTunniCommand({
  sceneController,
  gizmoHit,
  command,
}) {
  const segment = gizmoHit.segment;
  let writes;
  let undoLabel;
  if (command === "equalize") {
    // Only the curvature gizmo equalizes: it owns the split between the two
    // handles. The on-curve gizmo has no equalize gesture.
    if (gizmoHit.type !== "generated-curvature") {
      return;
    }
    writes = generatedCurvatureEqualizationWrites(segment);
    undoLabel = "Equalize Generated Handles";
  } else if (gizmoHit.type === "generated-curvature") {
    writes = generatedCurvatureResetWrites(segment);
    undoLabel = "Reset Generated Curvature";
  } else {
    writes = generatedOnCurveResetWrites(segment);
    undoLabel = "Reset Generated On-Curves";
  }
  if (!writes?.length) {
    return;
  }
  await applyGeneratedSegmentWrites(sceneController, segment, writes, undoLabel);
}

function generatedCurvatureEqualizationWrites(segment) {
  const points = segment.points.map((point, index) => {
    const nudge = index === 0 || index === 3 ? segment.provenance[index]?.nudge : null;
    return {
      x: point.x - (nudge?.x || 0),
      y: point.y - (nudge?.y || 0),
    };
  });
  const [p0, h1, h2, p3] = points;
  const intersection = calculateTunniPoint(points);
  const u1 = normalizeVector(subVectors(h1, p0));
  const u2 = normalizeVector(subVectors(h2, p3));
  if (!intersection || !u1 || !u2) {
    return null;
  }
  const r1 = dotVector(subVectors(intersection, p0), u1);
  const r2 = dotVector(subVectors(intersection, p3), u2);
  const l1 = distance(p0, h1);
  const l2 = distance(p3, h2);
  if (r1 <= 0 || r2 <= 0 || l1 <= 0 || l2 <= 0) {
    return null;
  }
  const t1 = l1 / r1;
  const t2 = l2 / r2;
  const tension = (2 * t1 * t2) / (t1 + t2);
  if (!Number.isFinite(tension)) {
    return null;
  }
  return [
    [
      1,
      {
        offsetDelta: {
          x: p0.x + u1.x * r1 * tension - h1.x,
          y: p0.y + u1.y * r1 * tension - h1.y,
        },
      },
    ],
    [
      2,
      {
        offsetDelta: {
          x: p3.x + u2.x * r2 * tension - h2.x,
          y: p3.y + u2.y * r2 * tension - h2.y,
        },
      },
    ],
  ];
}

function generatedCurvatureResetWrites(segment) {
  const startIndex = segment.provenance[1]?.role === "out" ? 0 : 3;
  return [
    [startIndex, { pinnedTension: null }],
    [1, { resetHandle: true }],
    [2, { resetHandle: true }],
  ];
}

function generatedOnCurveResetWrites() {
  return [
    [0, { resetNudge: true }],
    [3, { resetNudge: true }],
  ];
}

async function applyGeneratedSegmentWrites(
  sceneController,
  segment,
  writes,
  undoLabel
) {
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return;
  }
  const referenceSkeletonData = getSkeletonData(
    positionedGlyph.varGlyph?.glyph?.layers?.[positionedGlyph.glyph?.layerName]
      ?.glyph || positionedGlyph.glyph
  );
  await sceneController.editGlyph(async (_sendIncrementalChange, glyph) => {
    let accumulated = new ChangeCollector();
    for (const [layerName, layerGlyph] of Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    )) {
      const originalSkeletonData = getSkeletonData(layerGlyph);
      const changes = editSkeleton(layerGlyph, (working) => {
        for (const [index, write] of writes) {
          const provenance = segment.provenance[index];
          const resolved = resolveSkeletonAddressAcrossLayers(
            referenceSkeletonData,
            originalSkeletonData,
            provenance.skeletonContourId ?? segment.skeletonContourId,
            provenance.skeletonPointId
          );
          if (!resolved) continue;
          const originalPoint =
            originalSkeletonData.contours?.[resolved.contourIndex]?.points?.[
              resolved.pointIndex
            ];
          const contour = originalSkeletonData.contours?.[resolved.contourIndex];
          const point =
            working.contours?.[resolved.contourIndex]?.points?.[resolved.pointIndex];
          if (
            !originalPoint ||
            !contour ||
            !point ||
            isSkeletonSideLocked(point, provenance.side)
          ) {
            continue;
          }
          if (write.pinnedTension !== undefined) {
            setSkeletonSegmentCurvature(point, provenance.side, write.pinnedTension);
          } else if (write.resetHandle) {
            setSkeletonHandleDetached(point, provenance.side, false);
            setSkeletonHandleOffset(point, provenance.side, provenance.role, {
              x: 0,
              y: 0,
              detached: false,
            });
          } else if (write.resetNudge) {
            setSkeletonPointSideNudge(point, provenance.side, 0);
          } else if (write.offsetDelta) {
            const offset = getSkeletonHandleOffset(
              originalPoint,
              provenance.side,
              provenance.role
            );
            setSkeletonHandleOffset(point, provenance.side, provenance.role, {
              x: offset.x + write.offsetDelta.x,
              y: offset.y + write.offsetDelta.y,
              detached: offset.detached,
            });
          } else if (write.nudgeDelta !== undefined) {
            setSkeletonPointSideNudge(
              point,
              provenance.side,
              getSkeletonPointNudge(
                originalPoint,
                provenance.side,
                contour.defaultWidth
              ) + write.nudgeDelta
            );
          }
        }
      });
      if (changes.hasChange) {
        accumulated = accumulated.concat(
          changes.prefixed(["layers", layerName, "glyph"])
        );
      }
    }
    if (!accumulated.hasChange) return;
    return { changes: accumulated, undoLabel, broadcast: true };
  });
}

// Curvature: one pin on the skeleton segment's start point, not two handle
// displacements. The gizmo sets a number and the generator reproduces it.
function generatedCurvatureWrites(originalPoints, segment, delta) {
  const edit = calculateGeneratedCurvatureEdits({
    segmentPoints: originalPoints,
    provenance: segment.provenance,
    delta,
  });
  if (!edit) {
    return null;
  }
  return [[edit.segmentPointIndex, { pinnedTension: edit.tension }]];
}

// On-curve: the two rib ends, tangent-constrained (D12).
function generatedOnCurveWrites(originalPoints, segment, delta) {
  const edits = calculateGeneratedOnCurveEdits({
    segmentPoints: originalPoints,
    provenance: segment.provenance,
    delta,
    movable: segment.onCurveMovable,
  });
  if (!edits) {
    return null;
  }
  return [
    [
      0,
      {
        nudgeDelta: edits[0].nudgeDelta,
      },
    ],
    [
      3,
      {
        nudgeDelta: edits[1].nudgeDelta,
      },
    ],
  ];
}

export async function equalizeSkeletonTunniTensions({ sceneController, tunniHit }) {
  if (areSkeletonTensionsEqualized(tunniHit.segment)) {
    return true;
  }

  let handled = false;
  await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    let accumulated = new ChangeCollector();
    const layerInfo = Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    )
      .map(([layerName, layerGlyph]) => ({
        layerName,
        layerGlyph,
        changePath: ["layers", layerName, "glyph"],
        originalSkeletonData: getSkeletonData(layerGlyph),
      }))
      .filter((entry) => entry.originalSkeletonData?.contours?.length);

    for (const { layerGlyph, changePath, originalSkeletonData } of layerInfo) {
      const changes = editSkeleton(layerGlyph, (working) => {
        const target = resolveSkeletonTunniSegment(
          originalSkeletonData,
          working,
          tunniHit
        );
        if (!target || areSkeletonTensionsEqualized(target.originalSegment)) {
          return;
        }
        const controlPoints = calculateSkeletonEqualizedControlPoints(
          target.originalSegment
        );
        if (!controlPoints) {
          return;
        }
        const [controlIndex1, controlIndex2] = target.originalSegment.controlIndices;
        writePointPosition(
          target.workingContour.points[controlIndex1],
          controlPoints[0],
          Math.round
        );
        writePointPosition(
          target.workingContour.points[controlIndex2],
          controlPoints[1],
          Math.round
        );
      });
      if (changes.hasChange) {
        accumulated = accumulated.concat(changes.prefixed(changePath));
      }
    }

    if (!accumulated.hasChange) {
      return;
    }
    handled = true;
    return {
      changes: accumulated,
      undoLabel: "Equalize Skeleton Tunni Tensions",
      broadcast: true,
    };
  });

  return handled;
}

function copySkeletonTunniSegment(segment) {
  return {
    ...segment,
    startPoint: { ...segment.startPoint },
    endPoint: { ...segment.endPoint },
    controlPoints: segment.controlPoints.map((point) => ({ ...point })),
    controlPointIds: [...(segment.controlPointIds || [])],
    controlIndices: [...(segment.controlIndices || [])],
  };
}

function resolveSkeletonTunniSegment(referenceSkeletonData, workingSkeletonData, hit) {
  const referenceContour = referenceSkeletonData?.contours?.[hit.contourIndex];
  const workingContour = workingSkeletonData?.contours?.[hit.contourIndex];
  if (!referenceContour || !workingContour) {
    return null;
  }
  const referenceSegments = buildSkeletonTunniSegments(referenceContour);
  const originalSegment = referenceSegments[hit.segmentIndex];
  if (
    !originalSegment ||
    originalSegment.controlPoints.length !== 2 ||
    !workingContour.points?.[originalSegment.startIndex] ||
    !workingContour.points?.[originalSegment.endIndex]
  ) {
    return null;
  }
  for (const index of originalSegment.controlIndices) {
    if (!workingContour.points?.[index]?.type) {
      return null;
    }
  }
  return { originalSegment, workingContour };
}

function writePointPosition(point, nextPoint, round) {
  point.x = round(nextPoint.x);
  point.y = round(nextPoint.y);
}
/**
 * Equalize the distances of control points in a segment using arithmetic mean
 * @param {Object} segment - The segment to modify
 * @param {Array} segmentPoints - Array of 4 points: [start, control1, control2, end]
 * @param {Object} sceneModel - The scene model
 * @param {Object} positionedGlyph - The positioned glyph
 * @param {Object} sceneController - The scene controller to perform edits
 */
export async function equalizeSegmentDistances(
  segment,
  segmentPoints,
  sceneModel,
  positionedGlyph,
  sceneController
) {
  // Check if distances are already equalized
  if (areTensionsEqualized(segmentPoints)) {
    return;
  }

  // Calculate new control points with equalized distances using arithmetic mean
  const newControlPoints = calculateEqualizedControlPoints(segmentPoints);

  // Update the path with new control points using editLayersAndRecordChanges
  try {
    await sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;

        // Validate that the path and segment indices exist
        if (!path || !segment?.parentPointIndices) {
          console.warn("Invalid path or segment indices", {
            path: !!path,
            parentPointIndices: segment?.parentPointIndices,
          });
          return "Equalize Control Point Distances"; // Return early but still provide undo label
        }

        // Find the indices of the control points within the segment
        // In a cubic segment, control points are typically at indices 1 and 2
        const controlPoint1Index = segment.parentPointIndices[1];
        const controlPoint2Index = segment.parentPointIndices[2];

        // Validate the control point indices
        if (controlPoint1Index === undefined || controlPoint2Index === undefined) {
          console.warn("Invalid control point indices", {
            controlPoint1Index: controlPoint1Index,
            controlPoint2Index: controlPoint2Index,
          });
          return "Equalize Control Point Distances"; // Return early but still provide undo label
        }

        const rounded1 = snapToGrid(newControlPoints[0]);
        const rounded2 = snapToGrid(newControlPoints[1]);

        // Update the control points in the path
        path.setPointPosition(controlPoint1Index, rounded1.x, rounded1.y);
        path.setPointPosition(controlPoint2Index, rounded2.x, rounded2.y);
      }
      return "Equalize Control Point Distances";
    });
  } catch (error) {
    console.error("Error equalizing control point distances:", error);
    throw error; // Re-throw the error so it can be handled upstream
  }
}

/**
 * Handles mouse down event when clicking on a Tunni point
 * @param {Object} event - Mouse event
 * @param {Object} sceneController - Scene controller for scene access
 * @param {Object} visualizationLayerSettings - To check if Tunni layer is active
 * @returns {Object} Initial state for drag operation (initial mouse pos, vectors, etc.)
 */
export function handleTunniPointMouseDown(
  event,
  sceneController,
  visualizationLayerSettings
) {
  // Check if any Tunni layer is active
  if (
    !visualizationLayerSettings.model["fontra.tunni.handle"] &&
    !visualizationLayerSettings.model["fontra.tunni.point"]
  ) {
    return null;
  }

  const point = sceneController.localPoint(event);
  const size = sceneController.mouseClickMargin;

  // Convert from scene coordinates to glyph coordinates
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return null; // No positioned glyph, so no Tunni point interaction possible
  }

  const glyphPoint = {
    x: point.x - positionedGlyph.x,
    y: point.y - positionedGlyph.y,
  };

  // First check if we clicked on an existing Tunni point
  // Use the same hit testing function that's used for hover detection to ensure consistency
  const hit = tunniLayerHitTest(glyphPoint, size, positionedGlyph);
  if (!hit) {
    return null;
  }

  const segmentPoints = hit.segmentPoints;

  // Store initial positions
  const initialOnPoint1 = { ...segmentPoints[0] }; // p1
  const initialOffPoint1 = { ...segmentPoints[1] }; // p2
  const initialOffPoint2 = { ...segmentPoints[2] }; // p3
  const initialOnPoint2 = { ...segmentPoints[3] }; // p4

  // Calculate initial vectors from on-curve to off-curve points
  const initialVector1 = {
    x: initialOffPoint1.x - initialOnPoint1.x,
    y: initialOffPoint1.y - initialOnPoint1.y,
  };

  const initialVector2 = {
    x: initialOffPoint2.x - initialOnPoint2.x,
    y: initialOffPoint2.y - initialOnPoint2.y,
  };

  // Calculate unit vectors for movement direction
  const length1 = Math.sqrt(
    initialVector1.x * initialVector1.x + initialVector1.y * initialVector1.y
  );
  const length2 = Math.sqrt(
    initialVector2.x * initialVector2.x + initialVector2.y * initialVector2.y
  );

  const unitVector1 =
    length1 > 0
      ? {
          x: initialVector1.x / length1,
          y: initialVector1.y / length1,
        }
      : { x: 1, y: 0 };

  const unitVector2 =
    length2 > 0
      ? {
          x: initialVector2.x / length2,
          y: initialVector2.y / length2,
        }
      : { x: 1, y: 0 };

  // Calculate 45-degree vector (average of the two unit vectors)
  let fortyFiveVector = {
    x: (unitVector1.x + unitVector2.x) / 2,
    y: (unitVector1.y + unitVector2.y) / 2,
  };

  // Normalize the 45-degree vector
  const fortyFiveLength = Math.sqrt(
    fortyFiveVector.x * fortyFiveVector.x + fortyFiveVector.y * fortyFiveVector.y
  );
  if (fortyFiveLength > 0) {
    fortyFiveVector.x /= fortyFiveLength;
    fortyFiveVector.y /= fortyFiveLength;
  }

  // Store original control point positions for undo functionality
  let originalControlPoints = null;
  if (positionedGlyph && positionedGlyph.glyph && positionedGlyph.glyph.path) {
    const path = positionedGlyph.glyph.path;
    const controlPoint1Index = hit.segment.parentPointIndices[1];
    const controlPoint2Index = hit.segment.parentPointIndices[2];
    if (controlPoint1Index !== undefined && controlPoint2Index !== undefined) {
      originalControlPoints = {
        controlPoint1Index: controlPoint1Index,
        controlPoint2Index: controlPoint2Index,
        originalControlPoint1: { ...path.getPoint(controlPoint1Index) },
        originalControlPoint2: { ...path.getPoint(controlPoint2Index) },
      };
    }
  }

  // Return initial state for drag operation
  return {
    initialMousePosition: { ...glyphPoint }, // Make a copy to avoid reference issues
    initialOnPoint1,
    initialOffPoint1,
    initialOffPoint2,
    initialOnPoint2,
    initialVector1,
    initialVector2,
    unitVector1,
    unitVector2,
    fortyFiveVector,
    selectedSegment: hit.segment,
    originalSegmentPoints: [...segmentPoints],
    originalControlPoints,
    tunniPointHit: hit,
  };
}

/**
 * Calculates new control points based on Tunni point movement during drag
 * @param {Object} event - Mouse event
 * @param {Object} initialState - Initial state from mouse down
 * @param {Object} sceneController - Scene controller for editing operations
 * @returns {Object} Object containing control point indices and new positions
 */
export function calculateTunniPointDragChanges(
  event,
  initialState,
  sceneController,
  gridSnapEnabled = false
) {
  // Check if we have the necessary data to process the drag
  if (
    !initialState ||
    !initialState.initialMousePosition ||
    !initialState.initialOffPoint1 ||
    !initialState.initialOffPoint2 ||
    !initialState.selectedSegment ||
    !initialState.originalSegmentPoints
  ) {
    return null;
  }

  const point = sceneController.localPoint(event);

  // Convert from scene coordinates to glyph coordinates
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return null; // No positioned glyph, so no Tunni point interaction possible
  }

  const glyphPoint = {
    x: point.x - positionedGlyph.x,
    y: point.y - positionedGlyph.y,
  };

  // Calculate mouse movement vector
  const mouseDelta = {
    x: glyphPoint.x - initialState.initialMousePosition.x,
    y: glyphPoint.y - initialState.initialMousePosition.y,
  };

  // Check if Alt key is pressed to disable equalizing distances
  // (proportional editing is now the default behavior)
  const equalizeDistances = !event.altKey;

  let newControlPoint1, newControlPoint2;

  if (equalizeDistances) {
    const projection =
      mouseDelta.x * initialState.fortyFiveVector.x +
      mouseDelta.y * initialState.fortyFiveVector.y;

    // forkra original: move both handles by the same projection.
    // newControlPoint1 = {
    //   x: initialState.initialOffPoint1.x + initialState.unitVector1.x * projection,
    //   y: initialState.initialOffPoint1.y + initialState.unitVector1.y * projection,
    // };
    // newControlPoint2 = {
    //   x: initialState.initialOffPoint2.x + initialState.unitVector2.x * projection,
    //   y: initialState.initialOffPoint2.y + initialState.unitVector2.y * projection,
    // };

    const trueTunni = calculateTunniPoint(initialState.originalSegmentPoints);
    const distToTunni1 = trueTunni
      ? distance(initialState.initialOnPoint1, trueTunni)
      : 0;
    const distToTunni2 = trueTunni
      ? distance(initialState.initialOnPoint2, trueTunni)
      : 0;
    if (trueTunni && distToTunni1 > 0 && distToTunni2 > 0) {
      const totalDist = distToTunni1 + distToTunni2;
      const k = (2 * projection) / totalDist;
      const move1 = k * distToTunni1;
      const move2 = k * distToTunni2;
      newControlPoint1 = {
        x: initialState.initialOffPoint1.x + initialState.unitVector1.x * move1,
        y: initialState.initialOffPoint1.y + initialState.unitVector1.y * move1,
      };
      newControlPoint2 = {
        x: initialState.initialOffPoint2.x + initialState.unitVector2.x * move2,
        y: initialState.initialOffPoint2.y + initialState.unitVector2.y * move2,
      };
    } else {
      newControlPoint1 = {
        x: initialState.initialOffPoint1.x + initialState.unitVector1.x * projection,
        y: initialState.initialOffPoint1.y + initialState.unitVector1.y * projection,
      };

      newControlPoint2 = {
        x: initialState.initialOffPoint2.x + initialState.unitVector2.x * projection,
        y: initialState.initialOffPoint2.y + initialState.unitVector2.y * projection,
      };
    }
  } else {
    // Non-proportional editing: Each control point moves independently along its own vector
    // Project mouse movement onto each control point's individual unit vector
    const projection1 =
      mouseDelta.x * initialState.unitVector1.x +
      mouseDelta.y * initialState.unitVector1.y;
    const projection2 =
      mouseDelta.x * initialState.unitVector2.x +
      mouseDelta.y * initialState.unitVector2.y;

    // Move each control point by its own projection amount
    newControlPoint1 = {
      x: initialState.initialOffPoint1.x + initialState.unitVector1.x * projection1,
      y: initialState.initialOffPoint1.y + initialState.unitVector1.y * projection1,
    };

    newControlPoint2 = {
      x: initialState.initialOffPoint2.x + initialState.unitVector2.x * projection2,
      y: initialState.initialOffPoint2.y + initialState.unitVector2.y * projection2,
    };
  }

  // Apply grid snapping if enabled
  if (gridSnapEnabled) {
    newControlPoint1 = snapToGrid(newControlPoint1);
    newControlPoint2 = snapToGrid(newControlPoint2);
  }

  // Return the changes instead of applying them
  return {
    controlPoint1Index: initialState.selectedSegment.parentPointIndices[1],
    controlPoint2Index: initialState.selectedSegment.parentPointIndices[2],
    newControlPoint1: newControlPoint1,
    newControlPoint2: newControlPoint2,
  };
}

/**
 * Handles mouse drag event to calculate control point changes based on Tunni point movement
 * @param {Object} event - Mouse event
 * @param {Object} initialState - Initial state from mouse down
 * @param {Object} sceneController - Scene controller for editing operations
 * @returns {Object} Object containing control point indices and new positions
 */
export function handleTunniPointMouseDrag(
  event,
  initialState,
  sceneController,
  gridSnapEnabled = false
) {
  // Calculate the changes for this mouse move event
  return calculateTunniPointDragChanges(
    event,
    initialState,
    sceneController,
    gridSnapEnabled
  );
}

/**
 * Handles mouse up event to return the final state for the Tunni point drag operation
 * @param {Object} initialState - Initial state from mouse down
 * @param {Object} sceneController - Scene controller for editing operations
 * @returns {Object} Object containing original control point indices and their final positions
 */
export function handleTunniPointMouseUp(initialState, sceneController) {
  // Check if we have the necessary data to process the mouse up event
  if (
    !initialState ||
    !initialState.selectedSegment ||
    !initialState.originalControlPoints
  ) {
    return null;
  }

  // Return the original control point information without applying changes
  // The actual changes will be applied in the pointer tool as a single atomic operation
  return {
    controlPoint1Index: initialState.originalControlPoints.controlPoint1Index,
    controlPoint2Index: initialState.originalControlPoints.controlPoint2Index,
    originalControlPoint1: initialState.originalControlPoints.originalControlPoint1,
    originalControlPoint2: initialState.originalControlPoints.originalControlPoint2,
  };
}

/**
 * Performs hit testing specifically for Tunni visualization layer elements
 * @param {Object} point - The point to check (x, y coordinates)
 * @param {number} size - The hit margin size
 * @param {Object} positionedGlyph - The positioned glyph to test against
 * @returns {Object|null} Hit result object if Tunni point is near the given point, null otherwise
 */
export function tunniLayerHitTest(point, size, positionedGlyph) {
  if (!positionedGlyph || !positionedGlyph.glyph || !positionedGlyph.glyph.path) {
    return null;
  }

  const path = positionedGlyph.glyph.path;

  // The point is already in the glyph coordinate system when passed from the pointer tool
  const glyphPoint = point;

  // Generated skeleton contours are derived geometry: they get no regular
  // Tunni points (skeleton Tunni operates on the skeleton itself).
  const skeletonData = getSkeletonData(
    positionedGlyph.varGlyph?.glyph?.layers?.[positionedGlyph.glyph?.layerName]
      ?.glyph || positionedGlyph.glyph
  );
  const generatedContourIndices = getGeneratedPathContourIndices(skeletonData);

  // Iterate through ALL contours and check if the point is near any Tunni point
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    if (generatedContourIndices.has(contourIndex)) {
      continue;
    }
    for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
      // Process each segment in the contour
      if (segment.points.length === 4) {
        // Check if it's a cubic segment
        const pointTypes = segment.parentPointIndices.map(
          (index) => path.pointTypes[index]
        );

        if (pointTypes[1] === 2 && pointTypes[2] === 2) {
          // Both are cubic control points
          // Calculate the true Tunni point (intersection-based) for this segment
          const trueTunniPoint = calculateTunniPoint(segment.points);
          const visualTunniPoint = calculateControlHandlePoint(segment.points);

          // Check both the true intersection point and the visual point (midpoint)
          // This ensures we can hit both the actual intersection and the visual representation
          if (trueTunniPoint && distance(glyphPoint, trueTunniPoint) <= size) {
            return {
              tunniPoint: trueTunniPoint,
              segment: segment,
              segmentPoints: segment.points,
              contourIndex: contourIndex,
              hitType: "true-tunni-point",
            };
          }

          if (visualTunniPoint && distance(glyphPoint, visualTunniPoint) <= size) {
            return {
              tunniPoint: visualTunniPoint,
              segment: segment,
              segmentPoints: segment.points,
              contourIndex: contourIndex,
              hitType: "tunni-point",
            };
          }
        }
      }
    }
  }

  // If no Tunni point is found within the hit margin, return null
  return null;
}

/**
 * Handles mouse down event when clicking on a true Tunni point (intersection)
 * @param {Object} event - Mouse event
 * @param {Object} sceneController - Scene controller for scene access
 * @param {Object} visualizationLayerSettings - To check if Tunni layer is active
 * @returns {Object} Initial state for drag operation (initial mouse pos, vectors, etc.)
 */
export function handleTrueTunniPointMouseDown(
  event,
  sceneController,
  visualizationLayerSettings
) {
  // Check if any Tunni layer is active
  if (
    !visualizationLayerSettings.model["fontra.tunni.handle"] &&
    !visualizationLayerSettings.model["fontra.tunni.point"]
  ) {
    return null;
  }

  const point = sceneController.localPoint(event);
  const size = sceneController.mouseClickMargin;

  // Convert from scene coordinates to glyph coordinates
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return null; // No positioned glyph, so no Tunni point interaction possible
  }

  const glyphPoint = {
    x: point.x - positionedGlyph.x,
    y: point.y - positionedGlyph.y,
  };

  // First check if we clicked on an existing true Tunni point
  // Use the same hit testing function that's used for hover detection to ensure consistency
  const hit = tunniLayerHitTest(glyphPoint, size, positionedGlyph);
  if (!hit || hit.hitType !== "true-tunni-point") {
    return null;
  }

  const segmentPoints = hit.segmentPoints;

  // Store initial positions
  const initialOnPoint1 = { ...segmentPoints[0] }; // p1 (on-curve)
  const initialOffPoint1 = { ...segmentPoints[1] }; // p2 (off-curve)
  const initialOffPoint2 = { ...segmentPoints[2] }; // p3 (off-curve)
  const initialOnPoint2 = { ...segmentPoints[3] }; // p4 (on-curve)

  // Calculate initial vectors from on-curve to off-curve points
  const initialVector1 = {
    x: initialOffPoint1.x - initialOnPoint1.x,
    y: initialOffPoint1.y - initialOnPoint1.y,
  };

  const initialVector2 = {
    x: initialOffPoint2.x - initialOnPoint2.x,
    y: initialOffPoint2.y - initialOnPoint2.y,
  };

  // Calculate unit vectors for movement direction
  const length1 = Math.sqrt(
    initialVector1.x * initialVector1.x + initialVector1.y * initialVector1.y
  );
  const length2 = Math.sqrt(
    initialVector2.x * initialVector2.x + initialVector2.y * initialVector2.y
  );

  const unitVector1 =
    length1 > 0
      ? {
          x: initialVector1.x / length1,
          y: initialVector1.y / length1,
        }
      : { x: 1, y: 0 };

  const unitVector2 =
    length2 > 0
      ? {
          x: initialVector2.x / length2,
          y: initialVector2.y / length2,
        }
      : { x: 1, y: 0 };

  // Store original control point positions (these should remain unchanged)
  let originalControlPoints = null;
  if (positionedGlyph && positionedGlyph.glyph && positionedGlyph.glyph.path) {
    const path = positionedGlyph.glyph.path;
    const controlPoint1Index = hit.segment.parentPointIndices[1];
    const controlPoint2Index = hit.segment.parentPointIndices[2];
    if (controlPoint1Index !== undefined && controlPoint2Index !== undefined) {
      originalControlPoints = {
        controlPoint1Index: controlPoint1Index,
        controlPoint2Index: controlPoint2Index,
        originalControlPoint1: { ...path.getPoint(controlPoint1Index) },
        originalControlPoint2: { ...path.getPoint(controlPoint2Index) },
      };
    }
  }

  // Return initial state for drag operation
  return {
    initialMousePosition: { ...glyphPoint }, // Make a copy to avoid reference issues
    initialOnPoint1,
    initialOffPoint1,
    initialOffPoint2,
    initialOnPoint2,
    initialVector1,
    initialVector2,
    unitVector1,
    unitVector2,
    selectedSegment: hit.segment,
    originalSegmentPoints: [...segmentPoints],
    originalControlPoints,
    tunniPointHit: hit,
    hitType: "true-tunni-point", // Distinguish from current handle
  };
}

/**
 * Calculates new on-curve point positions based on true Tunni point movement during drag
 * @param {Object} event - Mouse event
 * @param {Object} initialState - Initial state from mouse down
 * @param {Object} sceneController - Scene controller for editing operations
 * @returns {Object} Object containing on-curve point indices and new positions
 */
export function calculateTrueTunniPointDragChanges(
  event,
  initialState,
  sceneController,
  gridSnapEnabled = false
) {
  // Check if we have the necessary data to process the drag
  if (
    !initialState ||
    !initialState.initialMousePosition ||
    !initialState.initialOnPoint1 ||
    !initialState.initialOnPoint2 ||
    !initialState.selectedSegment ||
    !initialState.originalSegmentPoints
  ) {
    return null;
  }

  const point = sceneController.localPoint(event);

  // Convert from scene coordinates to glyph coordinates
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return null; // No positioned glyph, so no Tunni point interaction possible
  }

  const glyphPoint = {
    x: point.x - positionedGlyph.x,
    y: point.y - positionedGlyph.y,
  };

  // Calculate mouse movement vector
  const mouseDelta = {
    x: glyphPoint.x - initialState.initialMousePosition.x,
    y: glyphPoint.y - initialState.initialMousePosition.y,
  };

  // Check if Alt key is pressed to disable equalizing distances
  const equalizeDistances = !event.altKey;

  // Calculate how much to move the on-curve points along their fixed vectors
  // The movement should be based on the projection of mouse movement onto the fixed direction vectors
  const [p1, p2, p3, p4] = initialState.originalSegmentPoints;

  // Calculate unit vectors for the original directions (from on-curve to off-curve)
  const dir1 = normalizeVector(subVectors(p2, p1)); // direction from p1 to p2
  const dir2 = normalizeVector(subVectors(p3, p4)); // direction from p4 to p3 (reversed: from p4 to off-curve)

  // Project mouse movement onto the fixed direction vectors
  const projection1 = mouseDelta.x * dir1.x + mouseDelta.y * dir1.y;
  const projection2 = mouseDelta.x * dir2.x + mouseDelta.y * dir2.y;

  // For equalized distances, use the average of the projections
  let finalProjection1, finalProjection2;
  if (equalizeDistances) {
    const avgProjection = (projection1 + projection2) / 2;
    finalProjection1 = avgProjection;
    finalProjection2 = avgProjection;
  } else {
    finalProjection1 = projection1;
    finalProjection2 = projection2;
  }

  // Calculate new on-curve point positions by moving along the fixed direction vectors
  let newOnPoint1 = {
    x: initialState.initialOnPoint1.x + finalProjection1 * dir1.x,
    y: initialState.initialOnPoint1.y + finalProjection1 * dir1.y,
  };

  let newOnPoint2 = {
    x: initialState.initialOnPoint2.x + finalProjection2 * dir2.x,
    y: initialState.initialOnPoint2.y + finalProjection2 * dir2.y,
  };

  // Return the new on-curve points with original control points unchanged
  const newOnCurvePoints = [newOnPoint1, p2, p3, newOnPoint2];

  // Get the original on-curve point indices
  const onPoint1Index = initialState.selectedSegment.parentPointIndices[0];
  const onPoint2Index = initialState.selectedSegment.parentPointIndices[3];

  // Apply grid snapping if enabled
  if (gridSnapEnabled) {
    newOnPoint1 = snapToGrid(newOnPoint1);
    newOnPoint2 = snapToGrid(newOnPoint2);
  }

  // Return the changes instead of applying them
  return {
    onPoint1Index: onPoint1Index,
    onPoint2Index: onPoint2Index,
    newOnPoint1: newOnPoint1, // New position for initialOnPoint1
    newOnPoint2: newOnPoint2, // New position for initialOnPoint2
    // Keep control points unchanged
    controlPoint1Index: initialState.originalControlPoints.controlPoint1Index,
    controlPoint2Index: initialState.originalControlPoints.controlPoint2Index,
    newControlPoint1: initialState.initialOffPoint1, // Unchanged
    newControlPoint2: initialState.initialOffPoint2, // Unchanged
  };
}

/**
 * Handles mouse drag event to calculate on-curve point changes based on true Tunni point movement
 * @param {Object} event - Mouse event
 * @param {Object} initialState - Initial state from mouse down
 * @param {Object} sceneController - Scene controller for editing operations
 * @returns {Object} Object containing on-curve point indices and new positions
 */
export function handleTrueTunniPointMouseDrag(
  event,
  initialState,
  sceneController,
  gridSnapEnabled = false
) {
  // Calculate the changes for this mouse move event
  return calculateTrueTunniPointDragChanges(
    event,
    initialState,
    sceneController,
    gridSnapEnabled
  );
}

/**
 * Handles mouse up event to return the final state for the true Tunni point drag operation
 * @param {Object} initialState - Initial state from mouse down
 * @param {Object} sceneController - Scene controller for editing operations
 * @returns {Object} Object containing original on-curve point indices and their final positions
 */
export function handleTrueTunniPointMouseUp(initialState, sceneController) {
  // Check if we have the necessary data to process the mouse up event
  if (
    !initialState ||
    !initialState.selectedSegment ||
    !initialState.originalControlPoints
  ) {
    return null;
  }

  // Get the original on-curve point indices
  const onPoint1Index = initialState.selectedSegment.parentPointIndices[0];
  const onPoint2Index = initialState.selectedSegment.parentPointIndices[3];

  // Return the original control point information without applying changes
  // The actual changes will be applied in the pointer tool as a single atomic operation
  return {
    onPoint1Index: onPoint1Index,
    onPoint2Index: onPoint2Index,
    originalOnPoint1: initialState.initialOnPoint1,
    originalOnPoint2: initialState.initialOnPoint2,
    controlPoint1Index: initialState.originalControlPoints.controlPoint1Index,
    controlPoint2Index: initialState.originalControlPoints.controlPoint2Index,
    originalControlPoint1: initialState.originalControlPoints.originalControlPoint1,
    originalControlPoint2: initialState.originalControlPoints.originalControlPoint2,
  };
}
