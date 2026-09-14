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
  findGeneratedOutputPosition,
  generatedSegmentCapCurvatureField,
  generatedSegmentConstructionPoints,
  generatedSegmentHandleAxes,
  getSkeletonData,
  getSkeletonHandleOffset,
  getSkeletonPointNudge,
  segmentToTunniPoints,
  isSkeletonSideLocked,
  setSkeletonCapCurvature,
  setSkeletonHandleDetached,
  setSkeletonHandleOffset,
  setSkeletonPointSideNudge,
  setSkeletonSegmentCurvature,
} from "@fontra/core/skeleton-model.js";
import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import {
  areTensionsEqualized,
  calculateCurvatureDragScale,
  calculateCurvatureGizmoAxis,
  calculateEqualizedControlPoints,
  calculateHarmonicHandleDrag,
  calculateTunniPoint,
  harmonicDragLead,
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

// Alt on a curvature gizmo keeps the curvature at the leading handle's end
// (calculateHarmonicHandleDrag). Which handle leads is decided once the pointer
// has moved far enough to say, and held for the rest of the drag.
const HARMONIC_LEAD_DEAD_ZONE = 2;

function latchHarmonicLead(segmentPoints) {
  let lead = null;
  return (delta) => {
    if (lead === null && Math.hypot(delta.x, delta.y) >= HARMONIC_LEAD_DEAD_ZONE) {
      lead = harmonicDragLead(segmentPoints, delta);
    }
    return lead;
  };
}

// The gizmo's drag on an ordinary curve. The skeleton's centerline runs the
// same geometry, so both kinds of curve answer a drag identically.
export async function handleTunniDrag({
  sceneController,
  eventStream,
  initialEvent,
  gizmo,
}) {
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return;
  }
  const segment = gizmo.segment;
  const originalPoints = segment.points.map((point) => ({ x: point.x, y: point.y }));
  const isOnCurve = gizmo.type === "on-curve";

  if (!isOnCurve && initialEvent.ctrlKey && initialEvent.shiftKey) {
    await equalizeSegmentDistances(segment, originalPoints, sceneController);
    return;
  }

  const tunniSegment = {
    startPoint: originalPoints[0],
    controlPoints: [originalPoints[1], originalPoints[2]],
    endPoint: originalPoints[3],
  };
  const originalTunniPoint = calculateTunniPoint(originalPoints);
  if (isOnCurve && !originalTunniPoint) {
    return;
  }
  const harmonicLead = latchHarmonicLead(originalPoints);
  const [onIndex1, controlIndex1, controlIndex2, onIndex2] = segment.parentPointIndices;
  const startPoint = sceneController.localPoint(initialEvent);

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
      const currentPoint = sceneController.localPoint(event);
      const delta = {
        x: currentPoint.x - startPoint.x,
        y: currentPoint.y - startPoint.y,
      };
      const round = sceneController.sceneSettings?.gridSnapEnabled
        ? Math.round
        : (value) => value;

      let writes = null;
      if (isOnCurve) {
        const endpoints = calculateSkeletonOnCurveFromTunni(
          { x: originalTunniPoint.x + delta.x, y: originalTunniPoint.y + delta.y },
          tunniSegment,
          !event.altKey
        );
        writes = endpoints && [
          [onIndex1, endpoints[0]],
          [onIndex2, endpoints[1]],
        ];
      } else {
        const lead = event.altKey ? harmonicLead(delta) : null;
        const controlPoints = event.altKey
          ? lead === null
            ? null
            : calculateHarmonicHandleDrag(originalPoints, delta, lead)
          : calculateSkeletonControlPointsFromTunniDelta(delta, tunniSegment, true);
        writes = controlPoints && [
          [controlIndex1, controlPoints[0]],
          [controlIndex2, controlPoints[1]],
        ];
      }
      if (!writes) {
        continue;
      }
      dragged = true;

      let frame = new ChangeCollector();
      for (const { layerGlyph, changePath } of layerInfo) {
        const layerChanges = recordChanges(layerGlyph, (proxy) => {
          for (const [index, point] of writes) {
            proxy.path.setPointPosition(index, round(point.x), round(point.y));
          }
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
      undoLabel: isOnCurve ? "Move On-Curve Points via Tunni" : "Adjust Curvature",
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
  // Decided on the layer under the pointer and applied on every edited layer,
  // so the same handle leads in every master.
  const harmonicLead = latchHarmonicLead(segmentToTunniPoints(originalSegment));

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
            const lead = event.altKey ? harmonicLead(delta) : null;
            const controlPoints = event.altKey
              ? lead === null
                ? null
                : calculateHarmonicHandleDrag(
                    segmentToTunniPoints(target.originalSegment),
                    delta,
                    lead
                  )
              : calculateSkeletonControlPointsFromTunniDelta(
                  delta,
                  target.originalSegment,
                  true
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
//
// A drag that starts on a segment the gizmo has already flattened, expressed
// against the shape it flattened.
//
// The gizmo shifts both tensions from where they were when the drag began. On a
// bevel there is no "where they were": the handles are on their points and the
// segment remembers nothing of the curve it used to be. The pin alone cannot
// supply it either — the pin holds the segment's harmonic MEAN, which the
// shorter handle dominates, so raising it off zero puts the longer handle back
// most of the way in a single frame. Measured: 0 and 0 units answered the first
// step up with 83 and 6.
//
// The memory is in the stored displacement, and in what the generator would
// draw without it. So the base is a regeneration with the gizmo's own collapse
// released, and the drag is seeded with the distance that maps that base onto
// the bevel on screen. The way up then retraces the way down, step for step,
// and the released displacement shrinks to nothing exactly as the pin's floor
// is reached.
//
// Only the gizmo's own collapse is released (R-D: the mark says who placed the
// handle). A handle the designer put on its point by hand is part of the base.
//
function collapsedSegmentBase(skeletonData, segment) {
  const addresses = [segment.provenance?.[1], segment.provenance?.[2]];
  if (addresses.some((address) => !address)) {
    return null;
  }
  const scratch = structuredClone(skeletonData);
  const marked = [];
  for (const address of addresses) {
    const point = findSkeletonPointById(
      scratch,
      address.skeletonContourId ?? segment.skeletonContourId,
      address.skeletonPointId
    );
    const offset = point
      ? getSkeletonHandleOffset(point, address.side, address.role)
      : null;
    if (!offset?.collapsedByCurvature) {
      marked.push(false);
      continue;
    }
    marked.push(true);
    setSkeletonHandleOffset(point, address.side, address.role, {
      x: 0,
      y: 0,
      detached: offset.detached,
    });
  }
  if (!marked.some(Boolean)) {
    return null;
  }

  const generated = generateFromSkeleton(scratch);
  const points = segment.provenance.map((address) =>
    findGeneratedOutputPosition(
      generated,
      address.skeletonContourId ?? segment.skeletonContourId,
      address.skeletonPointId,
      address.side,
      address.role
    )
  );
  if (points.some((point) => !point)) {
    return null;
  }
  const basePoints = points.map((point) => ({ x: point.x, y: point.y }));
  const seed = collapseSeedDelta(basePoints, segment);
  return seed ? { points: basePoints, seed, marked } : null;
}

// How far down the axis the segment already sits, as a drag distance from the
// released base. The gizmo moves both tensions by one shared increment, so the
// increment is read off whichever handle is still off its point, and off the
// longer one where both are down.
function collapseSeedDelta(basePoints, segment) {
  const handleAxes = generatedSegmentHandleAxes(segment.provenance);
  const axis = calculateCurvatureGizmoAxis(basePoints, handleAxes);
  const scale = calculateCurvatureDragScale(basePoints, handleAxes);
  if (!axis || !scale) {
    return null;
  }
  // The drawn handles read against the BASE's units, because the drag holds its
  // units fixed from the geometry it started on.
  const drawn = segment.points;
  const drops = [
    distance(drawn[0], drawn[1]) / scale.units[0] - scale.tensions[0],
    distance(drawn[3], drawn[2]) / scale.units[1] - scale.tensions[1],
  ];
  // One shared increment took both handles down, and the deeper drop is the one
  // that still shows all of it: the shallower handle stopped at its point and
  // has been reporting zero ever since.
  const increment = Math.min(...drops);
  const distanceAlongAxis = (increment * (scale.units[0] + scale.units[1])) / 2;
  return { x: axis.x * distanceAlongAxis, y: axis.y * distanceAlongAxis };
}

function findSkeletonPointById(skeletonData, contourId, pointId) {
  for (const contour of skeletonData?.contours || []) {
    if (contourId !== undefined && contour.id !== contourId) {
      continue;
    }
    const point = contour.points?.find((entry) => entry.id === pointId);
    if (point) {
      return point;
    }
  }
  return null;
}

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
  const isCurvature = gizmoHit.type === "generated-curvature";
  // A segment the gizmo flattened is dragged against the shape it flattened,
  // and the drag is seeded with the distance that already separates them.
  const collapsed = isCurvature
    ? collapsedSegmentBase(
        getSkeletonData(
          positionedGlyph.varGlyph?.glyph?.layers?.[positionedGlyph.glyph?.layerName]
            ?.glyph || positionedGlyph.glyph
        ),
        segment
      )
    : null;
  const originalPoints =
    collapsed?.points || segment.points.map((point) => ({ x: point.x, y: point.y }));
  // The crossing the whole control is built on. For the curvature gizmo a
  // collapsed handle contributes its published axis rather than a line it cannot
  // draw — without that a beveled segment refused the drag before it started.
  const hasCrossing = isCurvature
    ? !!calculateCurvatureGizmoAxis(
        originalPoints,
        generatedSegmentHandleAxes(segment.provenance)
      )
    : !!calculateTunniPoint(originalPoints);
  if (!hasCrossing) {
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
      // The seed is where the segment already sits on the axis, measured from
      // the released base. Zero for every drag that starts on a segment the
      // gizmo has not flattened.
      const delta = {
        x:
          currentPoint.x -
          positionedGlyph.x -
          startGlyphPoint.x +
          (collapsed?.seed.x ?? 0),
        y:
          currentPoint.y -
          positionedGlyph.y -
          startGlyphPoint.y +
          (collapsed?.seed.y ?? 0),
      };
      const round = sceneController.sceneSettings?.gridSnapEnabled
        ? Math.round
        : (value) => value;

      const writes = isCurvature
        ? generatedCurvatureWrites(originalPoints, segment, delta, {
            fromBase: !!collapsed,
          })
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
            // Curvature, so the handle lock is the one that speaks.
            if (
              !original ||
              !point ||
              isSkeletonSideLocked(point, original.side, "handles")
            ) {
              continue;
            }
            if (write.capCurvature !== undefined) {
              setSkeletonCapCurvature(
                point,
                write.capCurvatureField,
                write.capCurvature
              );
            } else if (write.pinnedTension !== undefined) {
              // Absolute, not a delta: the drag already computed the tension it
              // wants from the geometry it grabbed, and every mousemove restates
              // it against the same original. Accumulating it would compound.
              setSkeletonSegmentCurvature(point, original.side, write.pinnedTension);
            } else if (write.offsetAbsolute && original.offset) {
              const collapsed = !!(write.offsetAbsolute.x || write.offsetAbsolute.y);
              setSkeletonHandleOffset(
                point,
                original.side,
                original.role,
                {
                  ...write.offsetAbsolute,
                  detached: original.offset.detached,
                  collapsedByCurvature: collapsed,
                },
                { round }
              );
            } else if (write.release && original.offset) {
              // Only what this gizmo put down. An unmarked offset is the
              // designer's own placement and is not the gizmo's to undo.
              if (original.offset.collapsedByCurvature) {
                setSkeletonHandleOffset(point, original.side, original.role, {
                  x: 0,
                  y: 0,
                  detached: original.offset.detached,
                });
              }
            } else if (write.offsetDelta && original.offset) {
              setSkeletonHandleOffset(
                point,
                original.side,
                original.role,
                {
                  x: original.offset.x + write.offsetDelta.x,
                  y: original.offset.y + write.offsetDelta.y,
                  detached: original.offset.detached,
                  collapsedByCurvature:
                    write.collapsedByCurvature || original.offset.collapsedByCurvature,
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
    // A bulb's neck takes one tension for both of its handles, so it is always
    // equalized and there is nothing for this gesture to do.
    if (generatedSegmentCapCurvatureField(segment.provenance)) {
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
  const points = generatedSegmentConstructionPoints(segment.points, segment.provenance);
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
  // A bulb's neck keeps its curvature in a cap field and has no rib handles
  // behind it, so clearing the field is the whole reset. Sending the ordinary
  // writes instead cleared a pin the neck never had and zeroed the cap-owning
  // point's rib handle offsets, which is a different part of the drawing.
  const capCurvatureField = generatedSegmentCapCurvatureField(segment.provenance);
  if (capCurvatureField) {
    return [[startIndex, { capCurvature: null, capCurvatureField }]];
  }
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
            isSkeletonSideLocked(point, provenance.side, "handles")
          ) {
            continue;
          }
          if (write.capCurvature !== undefined) {
            setSkeletonCapCurvature(point, write.capCurvatureField, write.capCurvature);
          } else if (write.pinnedTension !== undefined) {
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
              collapsedByCurvature: offset.collapsedByCurvature,
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
function generatedCurvatureWrites(originalPoints, segment, delta, { fromBase } = {}) {
  const edit = calculateGeneratedCurvatureEdits({
    segmentPoints: originalPoints,
    provenance: segment.provenance,
    delta,
  });
  if (!edit) {
    return null;
  }
  if (edit.capCurvatureField) {
    // A bulb's neck: one write, into the cap field on the cap-owning point.
    return [
      [
        edit.segmentPointIndex,
        { capCurvature: edit.tension, capCurvatureField: edit.capCurvatureField },
      ],
    ];
  }
  // Below the pin's floor the drag keeps going on the one handle still off its
  // point, and that part travels as a displacement — the pin cannot say it,
  // because its number reads zero for every length the survivor has left. It is
  // marked as the gizmo's own, so a later drag can release it and leave a handle
  // the designer collapsed by hand alone.
  const tail = new Map(
    edit.collapse.map((entry) => [entry.segmentPointIndex, entry.offsetDelta])
  );
  if (fromBase) {
    // The drag is measured from the released base, so its answer for each handle
    // is the WHOLE displacement, not an addition to the one on file. Both
    // handles are written every frame, which is what makes the tail shrink to
    // nothing as the drag rises and take the mark with it.
    return [
      [edit.segmentPointIndex, { pinnedTension: edit.tension }],
      ...[1, 2].map((index) => [
        index,
        { offsetAbsolute: tail.get(index) || { x: 0, y: 0 } },
      ]),
    ];
  }
  return [
    [edit.segmentPointIndex, { pinnedTension: edit.tension }],
    ...edit.collapse.map((entry) => [
      entry.segmentPointIndex,
      { offsetDelta: entry.offsetDelta, collapsedByCurvature: true },
    ]),
    // Above the floor the pin describes the segment on its own again, so a
    // displacement the gizmo left below the floor has nothing left to say.
    ...(edit.releaseCollapse ? [1, 2].map((index) => [index, { release: true }]) : []),
  ];
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
 * @param {Object} sceneController - The scene controller to perform edits
 */
export async function equalizeSegmentDistances(
  segment,
  segmentPoints,
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
