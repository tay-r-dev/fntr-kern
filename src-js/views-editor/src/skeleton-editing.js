import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import { alignHandle, alignHandles } from "@fontra/core/path-functions.js";
import {
  generateFromSkeleton,
  outlineContourToPackedPath,
} from "@fontra/core/skeleton-generator.js";
import {
  applyFixedRibDelta,
  applySkeletonRibExecutorResult,
  clearSkeletonSegmentCurvatureForHandle,
  createSkeletonRibExecutor,
  equalizeEditableGeneratedHandleOffsets,
  equalizeSkeletonHandleFromDelta,
  equalizeSkeletonHandleToPoint,
  findGeneratedPathAddress,
  getSkeletonData,
  getSkeletonHandleDirectionForPoint,
  getSkeletonHandleEqualizeInfo,
  getSkeletonHandleOffset,
  getSkeletonPointAddress,
  getSkeletonRibAddress,
  getSkeletonRibPosition,
  getSkeletonSegmentCurvature,
  getSkeletonSegmentHandles,
  getTiedRibGroup,
  isSkeletonSideLocked,
  makeEditableGeneratedHandleKey,
  makeEditableGeneratedPointKey,
  makeEmptySkeletonData,
  makeSkeletonRibKey,
  normalizeSkeletonData,
  parseEditableGeneratedHandleKey,
  parseEditableGeneratedPointKey,
  parseSkeletonPointKey,
  parseSkeletonRibKey,
  setSkeletonData,
  setSkeletonHandleOffset,
  setSkeletonSegmentCurvature,
  transformSkeletonContourMetadata,
  transformSkeletonPointMetadata,
} from "@fontra/core/skeleton-model.js";
import { isObjectEmpty, parseSelection, range } from "@fontra/core/utils.ts";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { dotVector, mulVectorScalar } from "@fontra/core/vector.js";
import { EditBehaviorFactory } from "./edit-behavior.js";

export function makeSkeletonPointKey(contourId, pointId) {
  return `skeletonPoint/${contourId}/${pointId}`;
}

export { getSkeletonPointAddress, parseSkeletonPointKey };

// A rib is a second entry point into the same drag, not a second drag. Grabbing
// a rib end and holding the modifier moves the skeleton point that rib belongs
// to, exactly as grabbing the point itself would.
export function getSkeletonModifierBehaviorName(event, modifiers = {}, targetKinds) {
  const canFixRib = targetKinds.has("skeletonPoint") || targetKinds.has("skeletonRib");
  if (modifiers.fixedRibCompressMode && canFixRib) {
    return "fixed-rib-compress";
  }
  if (modifiers.fixedRibMode && canFixRib) {
    return "fixed-rib";
  }
  return null;
}

// A plain drag changes the rib's width; Z slides the rib end along its tangent
// instead. Alt is the second axis: it interpolates the nudge across the selection.
export function getSkeletonRibBehaviorName(event, modifiers = {}) {
  if (modifiers.tangentRibMode && event?.altKey) return "rib-tangent-interpolate";
  if (modifiers.tangentRibMode) return "rib-tangent";
  if (event?.altKey) return "rib-interpolate";
  return "rib-default";
}

// The two Z behaviors slide the rib end along its tangent and leave the width
// exactly where it was, so anything that reports a width — the drag readout — has
// nothing to say during one. Stated as the tangent pair rather than as "not the
// width pair": the same drag can carry a fixed-rib behavior instead, and that one
// does change widths.
export function skeletonRibBehaviorIsTangentSlide(behaviorName) {
  return behaviorName === "rib-tangent" || behaviorName === "rib-tangent-interpolate";
}

export function getSelectionTargetKinds(selection) {
  const parsed = parseSelection([...selection]);
  const kinds = new Set();
  if (parsed.skeletonPoint?.length) kinds.add("skeletonPoint");
  if (parsed.skeletonRib?.length) kinds.add("skeletonRib");
  if (parsed.editableGeneratedPoint?.length) kinds.add("editableGeneratedPoint");
  if (parsed.editableGeneratedHandle?.length) kinds.add("editableGeneratedHandle");
  return kinds;
}

export function makeSkeletonModifierOptions(behaviorName, extra = {}) {
  return {
    ...extra,
    behaviorName,
    equalize: behaviorName?.startsWith("equalize") === true,
    fixedRib: behaviorName === "fixed-rib",
    fixedRibCompress: behaviorName === "fixed-rib-compress",
  };
}

// Cross-layer addressing (see Global Constraints): selection ids are canonical
// in the edit layer only. Other editable layers resolve the same point by
// structural ordinal (contour position, point position). Returns null when the
// target layer's structure is incompatible; callers skip that layer.
export function resolveSkeletonAddressAcrossLayers(
  referenceSkeletonData,
  targetSkeletonData,
  contourId,
  pointId
) {
  const reference = getSkeletonPointAddress(referenceSkeletonData, contourId, pointId);
  if (!reference) {
    return null;
  }
  if (referenceSkeletonData === targetSkeletonData) {
    return reference;
  }
  const contour = targetSkeletonData?.contours?.[reference.contourIndex];
  const point = contour?.points?.[reference.pointIndex];
  if (!contour || !point || !point.type !== !reference.point.type) {
    return null;
  }
  return {
    contour,
    contourIndex: reference.contourIndex,
    point,
    pointIndex: reference.pointIndex,
  };
}

export function editSkeleton(layerGlyph, mutate, options = {}) {
  return recordChanges(layerGlyph, (layerGlyphProxy) => {
    applySkeletonMutation(layerGlyphProxy, mutate, options);
  });
}

export function makeEditSkeletonChange(layerGlyph, mutate, options = {}) {
  const scratch = cloneLayerGlyphForSkeletonEdit(layerGlyph);
  return editSkeleton(scratch, mutate, options);
}

function applySkeletonMutation(layerGlyph, mutate, options = {}) {
  const original = getSkeletonData(layerGlyph);
  if (!original && !options.createIfMissing) {
    return;
  }

  const working = normalizeSkeletonData(
    structuredClone(original || makeEmptySkeletonData())
  );
  mutate(working);
  const generated = generateFromSkeleton(working);
  replaceGeneratedSkeletonContours(layerGlyph, working, generated);
  setSkeletonData(layerGlyph, working);
}

export function cloneLayerGlyphForSkeletonEdit(layerGlyph) {
  return {
    ...layerGlyph,
    path: layerGlyph.path.copy(),
    customData: structuredClone(layerGlyph.customData || {}),
  };
}

export function replaceGeneratedSkeletonContours(layerGlyph, skeletonData, generated) {
  const previous = (skeletonData.generated || []).filter(
    (entry) =>
      Number.isInteger(entry.pathContourIndex) &&
      entry.pathContourIndex >= 0 &&
      entry.pathContourIndex < layerGlyph.path.numContours
  );

  if (canUpdateGeneratedContoursInPlace(layerGlyph.path, previous, generated)) {
    // Steady state (every width/nudge/coordinate drag): write point coordinates
    // in place. pathContourIndex stays stable, per-frame change objects contain
    // only "=xy" point updates, and contour order stays identical across
    // designspace sources (interpolation compatibility).
    skeletonData.generated = previous.map((entry, i) => {
      const pathContourIndex = entry.pathContourIndex;
      const contour = generated.contours[i];
      for (const [j, point] of contour.points.entries()) {
        const pointIndex = layerGlyph.path.getAbsolutePointIndex(pathContourIndex, j);
        layerGlyph.path.setPointPosition(pointIndex, point.x, point.y);
      }
      return {
        skeletonContourId: generated.provenance[i].skeletonContourId,
        pathContourIndex,
        pointMap: generated.provenance[i].pointMap,
      };
    });
    return;
  }

  // Topology changed: structural replace at stable positions. Delete the old
  // generated contours (descending), then insert the new ones contiguously at
  // the position the first old one occupied (append when none existed).
  // Generated contours must never migrate to the end of the path: change
  // objects are built against the drag-start state, and positional
  // deleteContour/insertContour ops only stay valid across frames when the
  // generated block keeps its position.
  const previousIndices = previous
    .map((entry) => entry.pathContourIndex)
    .sort((a, b) => b - a);
  for (const pathContourIndex of previousIndices) {
    layerGlyph.path.deleteContour(pathContourIndex);
  }
  const insertBase = previousIndices.length
    ? Math.min(...previousIndices)
    : layerGlyph.path.numContours;
  skeletonData.generated = generated.contours.map((contour, i) => {
    const pathContourIndex = insertBase + i;
    layerGlyph.path.insertContour(
      pathContourIndex,
      outlineContourToPackedPath(contour)
    );
    return {
      skeletonContourId: generated.provenance[i].skeletonContourId,
      pathContourIndex,
      pointMap: generated.provenance[i].pointMap,
    };
  });
}

function canUpdateGeneratedContoursInPlace(path, previousEntries, generated) {
  if (previousEntries.length !== generated.contours.length) {
    return false;
  }
  return previousEntries.every((entry, i) => {
    const contour = generated.contours[i];
    // Positional pairing is only valid when both sides agree on which
    // skeleton contour position i belongs to; otherwise a delete+add with
    // matching point structure could mispair skeletonContourId with
    // pathContourIndex across designspace sources.
    if (entry.skeletonContourId !== generated.provenance[i].skeletonContourId) {
      return false;
    }
    if (path.getNumPointsOfContour(entry.pathContourIndex) !== contour.points.length) {
      return false;
    }
    const existing = path.getUnpackedContour(entry.pathContourIndex);
    if (existing.isClosed !== (contour.isClosed === true)) {
      return false;
    }
    return contour.points.every(
      (point, j) =>
        (existing.points[j].type || null) === (point.type || null) &&
        (existing.points[j].smooth === true) === (point.smooth === true)
    );
  });
}

export function hasSkeletonPointSelection(selection) {
  return !!parseSelection([...selection]).skeletonPoint?.length;
}

// Toggle (or force) the `smooth` flag of the selected on-curve skeleton points.
// Off-curve handles are ignored. Returns the ChangeCollector from editSkeleton.
export function toggleSkeletonSmooth(layer, selection, forceValue = null) {
  const skeletonData = getSkeletonData(layer);
  if (!skeletonData) return null;
  const { skeletonPoint } = parseSelection([...selection]);
  const keys = skeletonPoint || [];
  if (!keys.length) return null;

  return editSkeleton(layer, (working) => {
    // Determine the new value from the current state of the first togglable
    // on-curve point, so all selected points flip together (matches toggleSmooth).
    let newValue = forceValue;
    for (const item of keys) {
      const { contourId, pointId } = parseSkeletonPointKey(item);
      const address = getSkeletonPointAddress(working, contourId, pointId);
      if (!address || address.point.type) continue;
      const [prevPoint, nextPoint] = skeletonNeighborPoints(
        address.contour,
        address.pointIndex
      );
      // Matches toggleSmooth's guard: a corner between two straight segments
      // (or an open-contour endpoint) cannot become smooth.
      if (
        (!prevPoint || !nextPoint || (!prevPoint.type && !nextPoint.type)) &&
        !address.point.smooth
      ) {
        continue;
      }
      if (newValue === null) {
        newValue = !address.point.smooth;
      }
      address.point.smooth = newValue;
      if (newValue) {
        snapSkeletonHandlesCollinear(address.point, prevPoint, nextPoint);
      }
    }
  });
}

function skeletonNeighborPoints(contour, pointIndex) {
  const points = contour.points;
  const numPoints = points.length;
  let prevIndex = pointIndex - 1;
  let nextIndex = pointIndex + 1;
  if (contour.closed) {
    prevIndex = (prevIndex + numPoints) % numPoints;
    nextIndex = nextIndex % numPoints;
  }
  const prevPoint =
    prevIndex >= 0 && prevIndex !== pointIndex ? points[prevIndex] : undefined;
  const nextPoint =
    nextIndex < numPoints && nextIndex !== pointIndex ? points[nextIndex] : undefined;
  return [prevPoint, nextPoint];
}

// Snap the off-curve neighbors of a freshly-smoothed skeleton point into a
// collinear position, mirroring toggleSmooth's handle fix-up on regular paths.
function snapSkeletonHandlesCollinear(anchorPoint, prevPoint, nextPoint) {
  if (prevPoint?.type && nextPoint?.type) {
    const [newPrevPoint, newNextPoint] = alignHandles(
      prevPoint,
      anchorPoint,
      nextPoint
    );
    prevPoint.x = newPrevPoint.x;
    prevPoint.y = newPrevPoint.y;
    nextPoint.x = newNextPoint.x;
    nextPoint.y = newNextPoint.y;
  } else if (prevPoint?.type) {
    const newPrevPoint = alignHandle(nextPoint, anchorPoint, prevPoint);
    prevPoint.x = newPrevPoint.x;
    prevPoint.y = newPrevPoint.y;
  } else if (nextPoint?.type) {
    const newNextPoint = alignHandle(prevPoint, anchorPoint, nextPoint);
    nextPoint.x = newNextPoint.x;
    nextPoint.y = newNextPoint.y;
  }
}

// Shift generated-contour path indices when a non-skeleton structural path edit
// inserts or deletes contours before the generated block. Keeps
// skeleton.generated[*].pathContourIndex valid without geometric recovery.
export function shiftGeneratedContourIndices(skeletonData, startIndex, delta) {
  for (const entry of skeletonData?.generated || []) {
    if (entry.pathContourIndex >= startIndex) {
      entry.pathContourIndex += delta;
    }
  }
}

// Records a generated-contour-index shift on a (proxied) layer glyph so it lands
// in the surrounding editGlyph change. No-op when the layer has no generated
// contours. Call after a non-skeleton structural path edit inserts/deletes
// contours before the generated block.
export function recordSkeletonContourIndexShift(layerGlyph, startIndex, delta) {
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData?.generated?.length || !delta) {
    return;
  }
  const updated = structuredClone(skeletonData);
  shiftGeneratedContourIndices(updated, startIndex, delta);
  setSkeletonData(layerGlyph, updated);
}

// --- Generated-contour index remapping across arbitrary structural edits ----
//
// Structural path edits that can't be expressed as a simple index shift
// (slicing, splitting, whole-contour deletion) maintain the
// skeleton.generated[*].pathContourIndex bookkeeping via explicit markers:
// tag the first point of every generated contour, run the edit, read the
// markers back. This is forward bookkeeping through identity markers, not
// geometric recovery — generated contours are never themselves restructured
// by these edits (they are unselectable and gated out of pen/knife targets).

const GENERATED_MARKER_ATTR = "fontra.skeleton.tmp.generated-contour";

// Tag the first point of each generated contour on `path` (mutates `path`;
// only call on detached copies, never on a change-recorded path).
export function markGeneratedContoursForRemap(path, skeletonData) {
  for (const [ordinal, entry] of (skeletonData?.generated || []).entries()) {
    const contourIndex = entry.pathContourIndex;
    if (
      !Number.isInteger(contourIndex) ||
      contourIndex < 0 ||
      contourIndex >= path.numContours ||
      !path.getNumPointsOfContour(contourIndex)
    ) {
      continue;
    }
    const pointIndex = path.getAbsolutePointIndex(contourIndex, 0);
    const point = path.getPoint(pointIndex);
    point.attrs = { ...point.attrs, [GENERATED_MARKER_ATTR]: ordinal };
    path.setPoint(pointIndex, point);
  }
}

// Find the markers after the structural edit, strip them from the path, and
// return a Map of generated-array ordinal → new pathContourIndex.
export function readGeneratedContourRemap(path) {
  const remap = new Map();
  for (const pointIndex of range(path.numPoints)) {
    const point = path.getPoint(pointIndex);
    const ordinal = point.attrs?.[GENERATED_MARKER_ATTR];
    if (ordinal === undefined) {
      continue;
    }
    const [contourIndex] = path.getContourAndPointIndex(pointIndex);
    remap.set(ordinal, contourIndex);
    point.attrs = { ...point.attrs };
    delete point.attrs[GENERATED_MARKER_ATTR];
    path.setPoint(pointIndex, point);
  }
  if (
    path.pointAttributes &&
    !path.pointAttributes.some((attrs) => attrs && !isObjectEmpty(attrs))
  ) {
    path.pointAttributes = null;
  }
  return remap;
}

// Clone of `skeletonData` with pathContourIndex rewritten per `remap`.
export function remapGeneratedEntries(skeletonData, remap) {
  const updated = structuredClone(skeletonData);
  for (const [ordinal, entry] of updated.generated.entries()) {
    if (remap.has(ordinal)) {
      entry.pathContourIndex = remap.get(ordinal);
    }
  }
  return updated;
}

// For in-place structural edits on a (proxied) layer glyph: dry-run the edit
// on a marked scratch copy of the path to learn where the generated contours
// land. Run this BEFORE the real edit; apply with applyGeneratedContourRemap
// AFTER it. Returns null when the layer has no generated contours.
export function computeGeneratedContourRemap(layerGlyph, structuralEditFn) {
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData?.generated?.length) {
    return null;
  }
  const scratch = layerGlyph.path.copy();
  markGeneratedContoursForRemap(scratch, skeletonData);
  structuralEditFn(scratch);
  return readGeneratedContourRemap(scratch);
}

export function applyGeneratedContourRemap(layerGlyph, remap) {
  if (!remap) {
    return;
  }
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData?.generated?.length) {
    return;
  }
  setSkeletonData(layerGlyph, remapGeneratedEntries(skeletonData, remap));
}

// Bounding box of the selected skeleton points in glyph space, or undefined.
export function getSkeletonSelectionBounds(layer, selection) {
  const skeletonData = getSkeletonData(layer);
  if (!skeletonData) return undefined;
  const { skeletonPoint } = parseSelection([...selection]);
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const item of skeletonPoint || []) {
    const { contourId, pointId } = parseSkeletonPointKey(item);
    const address = getSkeletonPointAddress(skeletonData, contourId, pointId);
    if (!address) continue;
    const { x, y } = address.point;
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  }
  if (xMin > xMax) return undefined;
  return { xMin, yMin, xMax, yMax };
}

export function makeSkeletonPointTargetEntry(
  layer,
  selection,
  behaviorName,
  referenceSkeletonData = null,
  options = {}
) {
  const skeletonData = getSkeletonData(layer);
  if (!skeletonData) return null;
  // Cross-layer addressing: selection ids are canonical in the edit layer;
  // resolve them into this layer by structural ordinal (Global Constraints).
  const reference = referenceSkeletonData || skeletonData;
  const selected = collectSkeletonPointSelection(selection, reference, skeletonData);

  if (behaviorName === "fixed-rib" || behaviorName === "fixed-rib-compress") {
    // Only this behavior pair reads the ribs. Folding rib owners into the
    // shared collector would drag the skeleton on a plain rib drag too, which
    // is the width edit and has to stay where it is.
    const withRibOwners = withSkeletonRibOwners(
      selected,
      selection,
      reference,
      skeletonData
    );
    if (!withRibOwners.length) return null;
    return makeFixedRibSkeletonPointTargetEntry(
      layer,
      skeletonData,
      reference,
      withRibOwners,
      behaviorName,
      options
    );
  }

  if (!selected.length) return null;

  if (behaviorName === "equalize" || behaviorName === "equalize-constrain") {
    return makeEqualizeSkeletonHandleTargetEntry(
      layer,
      skeletonData,
      reference,
      selected,
      behaviorName
    );
  }

  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layer);
  const synthetic = makeSyntheticSkeletonPathInstance(skeletonData, selected);
  // Separate factories for delta vs transform: EditBehaviorFactory caches
  // behaviors under behaviorName regardless of doFullTransform, so sharing one
  // factory would hand back the delta behavior for the transform path too.
  const deltaFactory = new EditBehaviorFactory(synthetic.instance, synthetic.selection);
  const transformFactory = new EditBehaviorFactory(
    synthetic.instance,
    synthetic.selection
  );
  const syntheticDeltaBehavior = deltaFactory.getBehavior(behaviorName);
  const syntheticTransformBehavior =
    transformFactory.getTransformBehavior(behaviorName);
  const selectedPointIdsByContour = new Map();
  for (const { contourId, pointId } of selected) {
    let pointIds = selectedPointIdsByContour.get(contourId);
    if (!pointIds) {
      pointIds = new Set();
      selectedPointIdsByContour.set(contourId, pointIds);
    }
    pointIds.add(pointId);
  }

  let rollbackChange = null;
  const makeChange = (behavior, method, argument, transformMetadata = false) => {
    // 1. Run the regular point-behavior rules on the synthetic path. The
    //    behavior computes absolute coordinates from the captured originals,
    //    so applying its change to the synthetic instance per frame yields
    //    current-frame positions.
    applyChange(synthetic.instance, behavior[method](argument));
    // 2. Copy EVERY mapped point position back onto the skeleton working copy
    //    (not only selected points — the rules move unselected neighbors too).
    const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
      for (const [pointIndex, address] of synthetic.pointAddresses) {
        const target = resolveSkeletonAddressAcrossLayers(
          skeletonData,
          working,
          address.contourId,
          address.pointId
        );
        if (!target) continue;
        const [x, y] = synthetic.instance.path.getPointPosition(pointIndex);
        target.point.x = x;
        target.point.y = y;
      }
      if (transformMetadata) {
        for (const [contourId, pointIds] of selectedPointIdsByContour) {
          const contourAddress = getSkeletonPointAddress(
            working,
            contourId,
            pointIds.values().next().value
          );
          if (!contourAddress) {
            continue;
          }
          const { contour } = contourAddress;
          for (const pointId of pointIds) {
            const pointAddress = getSkeletonPointAddress(working, contourId, pointId);
            if (pointAddress) {
              transformSkeletonPointMetadata(pointAddress.point, argument);
            }
          }
          if (pointIds.size === contour.points.length) {
            transformSkeletonContourMetadata(contour, argument);
          }
        }
      }
    });
    rollbackChange = changes.rollbackChange;
    return changes.change;
  };

  return {
    get rollbackChange() {
      return rollbackChange;
    },
    makeChangeForDelta(delta) {
      return makeChange(syntheticDeltaBehavior, "makeChangeForDelta", delta);
    },
    makeChangeForTransformation(transformation) {
      return makeChange(
        syntheticTransformBehavior,
        "makeChangeForTransformation",
        transformation,
        true
      );
    },
  };
}

function makeFixedRibSkeletonPointTargetEntry(
  layer,
  skeletonData,
  referenceSkeletonData,
  selected,
  behaviorName,
  options
) {
  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layer);
  const selectedPointKeys = new Set(
    selected.map((item) => makeSkeletonPointKey(item.contourId, item.pointId))
  );
  const clickedPointKey =
    resolveClickedSkeletonPointKey(
      skeletonData,
      referenceSkeletonData,
      options.clickedSkeletonPointKey
    ) || selectedPointKeys.values().next().value;
  let rollbackChange = null;
  return {
    get rollbackChange() {
      return rollbackChange;
    },
    makeChangeForDelta(delta) {
      const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
        applyFixedRibDelta(
          skeletonData,
          working,
          selectedPointKeys,
          clickedPointKey,
          delta,
          {
            compress: behaviorName === "fixed-rib-compress",
            scaleControlPoints: true,
          }
        );
      });
      rollbackChange = changes.rollbackChange;
      return changes.change;
    },
    makeChangeForTransformation() {
      return null;
    },
  };
}

function makeEqualizeSkeletonHandleTargetEntry(
  layer,
  skeletonData,
  referenceSkeletonData,
  selected,
  behaviorName
) {
  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layer);
  const handles = selected
    .map((item) => {
      const reference = getSkeletonPointAddress(
        referenceSkeletonData,
        item.referenceContourId,
        item.referencePointId
      );
      const target = reference
        ? skeletonData === referenceSkeletonData
          ? reference
          : {
              contour: skeletonData?.contours?.[reference.contourIndex],
              contourIndex: reference.contourIndex,
              point:
                skeletonData?.contours?.[reference.contourIndex]?.points?.[
                  reference.pointIndex
                ],
              pointIndex: reference.pointIndex,
            }
        : null;
      if (
        !reference?.point?.type ||
        !target?.point?.type ||
        target.point.type !== reference.point.type ||
        !getSkeletonHandleEqualizeInfo(reference.contour, reference.pointIndex)
      ) {
        return null;
      }
      return {
        contourId: target.contour.id,
        pointId: target.point.id,
        originalPoint: { x: target.point.x, y: target.point.y },
      };
    })
    .filter((item) => item);
  if (!handles.length) {
    return null;
  }
  const constrain = behaviorName === "equalize-constrain";
  let rollbackChange = null;
  return {
    get rollbackChange() {
      return rollbackChange;
    },
    makeChangeForDelta(delta) {
      const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
        for (const handle of handles) {
          const target = resolveSkeletonAddressAcrossLayers(
            skeletonData,
            working,
            handle.contourId,
            handle.pointId
          );
          if (!target) {
            continue;
          }
          if (constrain) {
            equalizeSkeletonHandleToPoint(
              target.contour,
              target.pointIndex,
              {
                x: handle.originalPoint.x + delta.x,
                y: handle.originalPoint.y + delta.y,
              },
              { constrain: true }
            );
          } else {
            equalizeSkeletonHandleFromDelta(target.contour, target.pointIndex, delta);
          }
        }
      });
      rollbackChange = changes.rollbackChange;
      return changes.change;
    },
    makeChangeForTransformation() {
      return null;
    },
  };
}

export function createSkeletonRibTargetEntries(
  layer,
  selection,
  behaviorName,
  { referenceSkeletonData = null, constrainMode = null, clickedRibKey = null } = {}
) {
  // Z carries the adjacent generated handles with the on-curve, so it reads as an
  // ordinary on-curve edit; Z-Alt leaves them. Derived here rather than passed in,
  // because a rib drag and a generated-point drag are two entry points to the one
  // nudge — the rib gizmo sits exactly on the generated on-curve — and when only
  // the second passed the flag, dragging the rib moved the on-curve and left its
  // handles behind.
  const carryNudgeToHandles = behaviorName === "rib-tangent";
  const skeletonData = getSkeletonData(layer);
  if (!skeletonData) {
    return [];
  }
  const reference = referenceSkeletonData || skeletonData;
  // Tangent and interpolate drags move the rib along the skeleton (nudge) rather
  // than changing its width. Only width is tied across a straight, so those
  // modes neither pull in the rest of a tied group nor share one delta.
  const changesWidth =
    constrainMode !== "tangent" &&
    behaviorName !== "rib-tangent" &&
    behaviorName !== "rib-interpolate" &&
    behaviorName !== "rib-tangent-interpolate";
  const selected = collectSkeletonRibSelection(selection, reference, skeletonData, {
    includeTiedRibs: changesWidth,
  });
  if (!selected.length) {
    return [];
  }

  const originalLayerGlyph = cloneLayerGlyphForSkeletonEdit(layer);
  const wantsInterpolation =
    behaviorName === "rib-interpolate" || behaviorName === "rib-tangent-interpolate";
  const executors = selected.map((address) => ({
    reference: {
      contourId: address.reference.contour.id,
      pointId: address.reference.point.id,
      side: address.reference.side,
    },
    executor: createSkeletonRibExecutor(address.target, behaviorName, {
      interpolationAxis: wantsInterpolation
        ? makeRibInterpolationAxis(originalLayerGlyph, skeletonData, address.target)
        : null,
      carryNudgeToHandles,
    }),
  }));

  // Multi-rib drag: all ribs receive the same width delta as the dragged
  // one (its canvas delta projected onto its own normal), rather than each
  // projecting the raw cursor delta onto their own normal — mixed rib
  // orientations must grow/shrink together.
  const clickedEntry =
    (clickedRibKey &&
      executors.find(
        ({ reference }) =>
          makeSkeletonRibKey(reference.contourId, reference.pointId, reference.side) ===
          clickedRibKey
      )) ||
    executors[0];
  const sharedWidthDelta = executors.length > 1 && changesWidth;

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        let ribDelta = () => delta;
        if (sharedWidthDelta) {
          const { normal, side } = clickedEntry.executor;
          const widthDelta =
            (side === "left" ? 1 : -1) * (delta.x * normal.x + delta.y * normal.y);
          ribDelta = (executor) => {
            const sign = executor.side === "left" ? 1 : -1;
            return {
              x: executor.normal.x * widthDelta * sign,
              y: executor.normal.y * widthDelta * sign,
            };
          };
        }
        const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
          for (const { reference, executor } of executors) {
            const target = resolveSkeletonRibAddressAcrossLayers(
              skeletonData,
              working,
              reference.contourId,
              reference.pointId,
              reference.side
            );
            if (!target) {
              continue;
            }
            const result = executor.applyDelta(ribDelta(executor), { constrainMode });
            applySkeletonRibExecutorResult(target, result);
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

// Interpolation axis for alt-drag on an editable rib (donor
// InterpolatingRibBehavior): the line between the rib point's generated
// handles as they sit on the pre-drag path; with a single handle the axis
// runs from the rib position to that handle. Null (pure-tangent fallback in
// the executor) when the rib has no generated handles or they can't be
// resolved.
function makeRibInterpolationAxis(originalLayerGlyph, skeletonData, address) {
  const { contour, point, side } = address;
  if (isSkeletonSideLocked(point, side)) {
    return null;
  }
  const handlePositions = {};
  for (const role of ["in", "out"]) {
    const pathAddress = findGeneratedPathAddress(
      skeletonData,
      contour.id,
      point.id,
      side,
      role
    );
    if (!pathAddress) {
      continue;
    }
    try {
      const pointIndex = originalLayerGlyph.path.getAbsolutePointIndex(
        pathAddress.pathContourIndex,
        pathAddress.contourPointIndex
      );
      handlePositions[role] = originalLayerGlyph.path.getPoint(pointIndex);
    } catch {
      continue;
    }
  }
  let lineStart;
  let lineEnd;
  if (handlePositions.in && handlePositions.out) {
    lineStart = handlePositions.in;
    lineEnd = handlePositions.out;
  } else if (handlePositions.in || handlePositions.out) {
    lineStart = getSkeletonRibPosition(contour, point, side);
    lineEnd = handlePositions.in || handlePositions.out;
  } else {
    return null;
  }
  if (!lineStart || !lineEnd) {
    return null;
  }
  const direction = { x: lineEnd.x - lineStart.x, y: lineEnd.y - lineStart.y };
  const length = Math.hypot(direction.x, direction.y);
  if (!length) {
    return null;
  }
  return {
    dir: { x: direction.x / length, y: direction.y / length },
    hasHandle: { in: !!handlePositions.in, out: !!handlePositions.out },
  };
}

// The selected skeleton points, plus the point behind every selected rib. A rib
// already selected through its own point contributes nothing new: both ends of
// one point's pair resolve to the same point, and a point cannot be dragged
// twice in one drag.
function withSkeletonRibOwners(
  selected,
  selection,
  referenceSkeletonData,
  targetSkeletonData
) {
  const { skeletonRib } = parseSelection([...selection]);
  if (!skeletonRib?.length) {
    return selected;
  }
  const merged = [...selected];
  const seen = new Set(merged.map((entry) => `${entry.contourId}/${entry.pointId}`));
  for (const item of skeletonRib) {
    const { contourId, pointId } = parseSkeletonRibKey(item);
    const address = resolveSkeletonAddressAcrossLayers(
      referenceSkeletonData,
      targetSkeletonData,
      contourId,
      pointId
    );
    if (!address) {
      continue;
    }
    const key = `${address.contour.id}/${address.point.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({
      contourId: address.contour.id,
      pointId: address.point.id,
      referenceContourId: contourId,
      referencePointId: pointId,
    });
  }
  return merged;
}

function collectSkeletonPointSelection(
  selection,
  referenceSkeletonData,
  targetSkeletonData
) {
  const { skeletonPoint } = parseSelection([...selection]);
  const selected = [];
  for (const item of skeletonPoint || []) {
    const { contourId, pointId } = parseSkeletonPointKey(item);
    const address = resolveSkeletonAddressAcrossLayers(
      referenceSkeletonData,
      targetSkeletonData,
      contourId,
      pointId
    );
    if (address) {
      selected.push({
        contourId: address.contour.id,
        pointId: address.point.id,
        referenceContourId: contourId,
        referencePointId: pointId,
      });
    }
  }
  return selected;
}

function resolveClickedSkeletonPointKey(
  targetSkeletonData,
  referenceSkeletonData,
  clickedSkeletonPointKey
) {
  if (!clickedSkeletonPointKey) {
    return null;
  }
  const { contourId, pointId } = parseSkeletonPointKey(clickedSkeletonPointKey);
  const reference = getSkeletonPointAddress(referenceSkeletonData, contourId, pointId);
  if (!reference) {
    return null;
  }
  const contour = targetSkeletonData?.contours?.[reference.contourIndex];
  const point = contour?.points?.[reference.pointIndex];
  if (!contour || !point || point.type) {
    return null;
  }
  return makeSkeletonPointKey(contour.id, point.id);
}

function collectSkeletonRibSelection(
  selection,
  referenceSkeletonData,
  targetSkeletonData,
  { includeTiedRibs = false } = {}
) {
  const { skeletonRib } = parseSelection([...selection]);
  const selected = [];
  const seen = new Set();
  const addRib = (contourId, pointId, side) => {
    const key = `${contourId}/${pointId}/${side}`;
    if (seen.has(key)) {
      return;
    }
    const reference = getSkeletonRibAddress(
      referenceSkeletonData,
      contourId,
      pointId,
      side
    );
    const target = resolveSkeletonRibAddressAcrossLayers(
      referenceSkeletonData,
      targetSkeletonData,
      contourId,
      pointId,
      side
    );
    if (reference && target) {
      seen.add(key);
      selected.push({ reference, target });
    }
  };
  for (const item of skeletonRib || []) {
    const { contourId, pointId, side } = parseSkeletonRibKey(`skeletonRib/${item}`);
    addRib(contourId, pointId, side);
  }
  // A rib tied across a straight segment drags with the rest of its group even
  // when only one is selected: the generator uses the mean of the group's stored
  // widths, so moving one alone would advance the outline by a fraction of the
  // cursor delta and leave the other gizmos behind. Every rib in the group then
  // receives the same shared width delta below, which is what selecting them all
  // by hand already did.
  if (includeTiedRibs) {
    for (const { reference } of [...selected]) {
      for (const member of getTiedRibGroup(reference.contour, reference.point) || []) {
        addRib(reference.contour.id, member.id, reference.side);
      }
    }
  }
  return selected;
}

function resolveSkeletonRibAddressAcrossLayers(
  referenceSkeletonData,
  targetSkeletonData,
  contourId,
  pointId,
  side
) {
  const reference = getSkeletonRibAddress(
    referenceSkeletonData,
    contourId,
    pointId,
    side
  );
  if (!reference) {
    return null;
  }
  if (referenceSkeletonData === targetSkeletonData) {
    return reference;
  }
  const contour = targetSkeletonData?.contours?.[reference.contourIndex];
  const point = contour?.points?.[reference.pointIndex];
  if (!contour || !point || point.type) {
    return null;
  }
  return getSkeletonRibAddress(targetSkeletonData, contour.id, point.id, side);
}

function makeSyntheticSkeletonPathInstance(skeletonData, selected) {
  const path = new VarPackedPath();
  const pointAddresses = new Map(); // absolute path point index -> { contourId, pointId }
  const selection = new Set();
  const selectedKeys = new Set(
    selected.map((item) => `${item.contourId}/${item.pointId}`)
  );
  let pointIndex = 0;
  for (const contour of skeletonData.contours) {
    path.appendUnpackedContour({
      points: contour.points.map((point) => ({
        x: point.x,
        y: point.y,
        ...(point.type ? { type: point.type } : {}),
        ...(point.smooth ? { smooth: true } : {}),
      })),
      isClosed: contour.closed,
    });
    for (const point of contour.points) {
      pointAddresses.set(pointIndex, { contourId: contour.id, pointId: point.id });
      if (selectedKeys.has(`${contour.id}/${point.id}`)) {
        selection.add(`point/${pointIndex}`);
      }
      pointIndex++;
    }
  }
  return {
    instance: { path, components: [], anchors: [], guidelines: [] },
    selection,
    pointAddresses,
  };
}

export function createEditableGeneratedPointTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  options = {}
) {
  const referenceSkeletonData =
    options.referenceSkeletonData || getSkeletonData(layerGlyph);
  const ribSelection = new Set();
  for (const item of parseSelection([...selection]).editableGeneratedPoint || []) {
    const { contourId, pointId, side } = parseEditableGeneratedPointKey(item);
    const address = getSkeletonRibAddress(
      referenceSkeletonData,
      contourId,
      pointId,
      side
    );
    if (!address || isSkeletonSideLocked(address.point, side)) continue;
    if (
      !findGeneratedPathAddress(
        referenceSkeletonData,
        address.contour.id,
        address.point.id,
        side,
        "onCurve"
      )
    )
      continue;
    ribSelection.add(makeSkeletonRibKey(address.contour.id, address.point.id, side));
  }
  if (!ribSelection.size) return [];
  return createSkeletonRibTargetEntries(layerGlyph, ribSelection, behaviorName, {
    ...options,
    referenceSkeletonData,
  });
}

export function createEditableGeneratedHandleTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  options = {}
) {
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData) return [];
  const referenceSkeletonData = options.referenceSkeletonData || skeletonData;
  const selected = collectEditableGeneratedHandleSelectionForEditing(
    selection,
    referenceSkeletonData,
    skeletonData
  );
  if (!selected.length) return [];
  const originalLayerGlyph = {
    ...layerGlyph,
    path: layerGlyph.path.copy(),
    customData: structuredClone(layerGlyph.customData || {}),
  };
  const executors = selected.map((address) => ({
    reference: {
      contourId: address.reference.contour.id,
      pointId: address.reference.point.id,
      side: address.reference.side,
      role: address.reference.role,
    },
    executor: createEditableGeneratedHandleExecutorForEditing(
      address.target,
      behaviorName,
      originalLayerGlyph.path,
      skeletonData
    ),
  }));
  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
          for (const { reference, executor } of executors) {
            const target = resolveEditableGeneratedHandleAddressAcrossLayersForEditing(
              skeletonData,
              working,
              reference.contourId,
              reference.pointId,
              reference.side,
              reference.role
            );
            if (target) executor.applyDelta(target, delta);
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

export function toggleEditableGeneratedHandleDetached(layerGlyph, selection) {
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData) return null;
  const handles = parseSelection([...selection]).editableGeneratedHandle || [];
  if (!handles.length) return null;
  const firstHandle = parseEditableGeneratedHandleKey(handles[0]);
  const current = resolveEditableGeneratedHandleAddressAcrossLayersForEditing(
    skeletonData,
    skeletonData,
    firstHandle.contourId,
    firstHandle.pointId,
    firstHandle.side,
    firstHandle.role
  );
  if (!current) return null;
  const detached = !getSkeletonHandleOffset(current.point, current.side, current.role)
    .detached;
  return editSkeleton(layerGlyph, (working) => {
    for (const item of handles) {
      const { contourId, pointId, side, role } = parseEditableGeneratedHandleKey(item);
      const target = resolveEditableGeneratedHandleAddressAcrossLayersForEditing(
        skeletonData,
        working,
        contourId,
        pointId,
        side,
        role
      );
      if (!target) continue;
      const offset = getSkeletonHandleOffset(target.point, side, role);
      setSkeletonHandleOffset(target.point, side, role, { ...offset, detached });
    }
  });
}

// Discarding a pinned curvature must not MOVE anything.
//
// A direct handle drag discards the pin on that handle's own segment, because the
// hand is the later and more specific answer. But the pin contributes LENGTH to
// both of that segment's handles, so dropping it bare snapped them back to the
// fit's own answer: the curvature just set with the gizmo was thrown away the
// instant a handle was touched, and the drag then started from a position the
// designer never chose.
//
// So the pin is baked before it is dropped. Regenerate once with the pin cleared,
// measure how far each of the segment's two handles moved, and carry that as a
// stored per-handle offset. Rendered geometry is then unchanged across the clear
// and the drag proceeds from where the curve actually was.
//
// Both handles, not just the dragged one: the pin sets the two lengths together,
// and only one of them is ever under the cursor.
//
// The generation here is a measurement, not a mutation — it writes nothing and
// touches no customData, so the one-write-path rail is intact.
function makeGeneratedHandlePinBakeForEditing(address, originalPath, skeletonData) {
  if (!originalPath || !skeletonData) {
    return null;
  }
  const segment = getSkeletonSegmentHandles(
    address.contour,
    address.point,
    address.role
  );
  if (!segment || getSkeletonSegmentCurvature(segment.owner, address.side) === null) {
    return null;
  }
  const unpinned = structuredClone(skeletonData);
  const unpinnedOwner = unpinned.contours
    ?.find((contour) => contour?.id === address.contour.id)
    ?.points?.find((point) => point?.id === segment.owner.id);
  if (!unpinnedOwner) {
    return null;
  }
  setSkeletonSegmentCurvature(unpinnedOwner, address.side, null);
  const generated = generateFromSkeleton(unpinned);
  const bakes = [];
  for (const handle of segment.handles) {
    const pinnedPosition = getGeneratedPathPositionForEditing(
      skeletonData,
      originalPath,
      address.contour.id,
      handle.point.id,
      address.side,
      handle.role
    );
    const unpinnedPosition = getGeneratedOutlinePositionForEditing(
      generated,
      address.contour.id,
      handle.point.id,
      address.side,
      handle.role
    );
    if (!pinnedPosition || !unpinnedPosition) {
      // Measure both ends or neither: baking one handle and not the other would
      // hold half the segment still and move the other half.
      return null;
    }
    bakes.push({
      pointId: handle.point.id,
      role: handle.role,
      offset: {
        x: pinnedPosition.x - unpinnedPosition.x,
        y: pinnedPosition.y - unpinnedPosition.y,
      },
    });
  }
  // The dragged handle's own bake is handed to whichever branch writes its
  // offset, so the two do not overwrite each other; the rest are written outright.
  const isDragged = (bake) =>
    bake.pointId === address.point.id && bake.role === address.role;
  return {
    contourId: address.contour.id,
    side: address.side,
    dragged: bakes.find(isDragged)?.offset || null,
    others: bakes.filter((bake) => !isDragged(bake)),
  };
}

function getGeneratedPathPositionForEditing(
  skeletonData,
  path,
  contourId,
  pointId,
  side,
  role
) {
  const pathAddress = findGeneratedPathAddress(
    skeletonData,
    contourId,
    pointId,
    side,
    role
  );
  if (!pathAddress) {
    return null;
  }
  try {
    return path.getPoint(
      path.getAbsolutePointIndex(
        pathAddress.pathContourIndex,
        pathAddress.contourPointIndex
      )
    );
  } catch {
    return null;
  }
}

function getGeneratedOutlinePositionForEditing(
  generated,
  contourId,
  pointId,
  side,
  role
) {
  const entryIndex = (generated?.provenance || []).findIndex(
    (entry) => entry?.skeletonContourId === contourId
  );
  if (entryIndex < 0) {
    return null;
  }
  const pointMap = generated.provenance[entryIndex].pointMap || [];
  const contourPointIndex = pointMap.findIndex(
    (provenance) =>
      provenance?.skeletonPointId === pointId &&
      provenance.side === side &&
      provenance.role === role
  );
  if (contourPointIndex < 0) {
    return null;
  }
  return generated.contours?.[entryIndex]?.points?.[contourPointIndex] || null;
}

function publishedAuthoredAxis(skeletonData, contourId, pointId, side, role) {
  const generated = (skeletonData?.generated || []).find(
    (entry) => entry?.skeletonContourId === contourId
  );
  const axis = generated?.pointMap?.find(
    (provenance) =>
      provenance?.skeletonPointId === pointId &&
      provenance.side === side &&
      provenance.role === role
  )?.authoredAxis;
  return axis && Number.isFinite(axis.x) && Number.isFinite(axis.y) ? axis : null;
}

// Writes each baked offset on top of whatever that handle already stored. Runs
// inside the mutate, on a working copy rebuilt from the original every frame, so
// it is idempotent and the values it adds are constants measured once.
function applyGeneratedHandlePinBakeForEditing(
  contour,
  pinBake,
  { round = Math.round }
) {
  if (!contour || contour.id !== pinBake.contourId) {
    return;
  }
  for (const bake of pinBake.others) {
    const point = (contour.points || []).find((item) => item?.id === bake.pointId);
    if (!point) {
      continue;
    }
    const offset = getSkeletonHandleOffset(point, pinBake.side, bake.role);
    if (offset.detached) {
      // A detached handle is absolute and never saw the pin, so there is nothing
      // of the pin in its position to preserve.
      continue;
    }
    setSkeletonHandleOffset(point, pinBake.side, bake.role, {
      ...offset,
      x: round(offset.x + bake.offset.x),
      y: round(offset.y + bake.offset.y),
    });
  }
}

function createEditableGeneratedHandleExecutorForEditing(
  address,
  behaviorName,
  originalPath = null,
  skeletonData = null
) {
  const pinBake = makeGeneratedHandlePinBakeForEditing(
    address,
    originalPath,
    skeletonData
  );
  const storedOffset = getSkeletonHandleOffset(
    address.point,
    address.side,
    address.role
  );
  // A detached handle is absolute and never saw the pin, so it has nothing of the
  // pin in its position to preserve.
  const draggedBake = storedOffset.detached ? null : pinBake?.dragged;
  const originalOffset = draggedBake
    ? {
        ...storedOffset,
        x: storedOffset.x + draggedBake.x,
        y: storedOffset.y + draggedBake.y,
      }
    : storedOffset;
  const equalize =
    behaviorName?.startsWith("equalize") === true ||
    behaviorName === "alternate" ||
    behaviorName === "alternate-constrain";
  const equalizeGeometry =
    equalize && originalPath && skeletonData
      ? makeEditableGeneratedHandleEqualizeGeometryForEditing(
          address,
          originalPath,
          skeletonData,
          draggedBake
        )
      : null;
  return {
    applyDelta(target, delta, { round = Math.round } = {}) {
      // Direct manipulation outranks a curvature the gizmo pinned earlier, for
      // this handle's own segment. Both branches below place the handle by hand.
      // The pin's contribution to the two handle lengths is preserved as stored
      // offsets first, so dropping it moves nothing.
      if (pinBake) {
        applyGeneratedHandlePinBakeForEditing(target.contour, pinBake, { round });
      }
      clearSkeletonSegmentCurvatureForHandle(
        target.contour,
        target.point,
        target.side,
        target.role
      );
      if (equalize && equalizeGeometry) {
        equalizeEditableGeneratedHandleOffsets(
          target.point,
          target.side,
          target.role,
          delta,
          equalizeGeometry,
          { round }
        );
        return;
      }
      setSkeletonHandleOffset(
        target.point,
        target.side,
        target.role,
        makeEditableGeneratedHandleOffsetForEditing(
          originalOffset,
          address.direction,
          delta,
          round
        )
      );
    },
  };
}

function makeEditableGeneratedHandleOffsetForEditing(
  originalOffset,
  direction,
  delta,
  round = Math.round
) {
  if (originalOffset.detached)
    return {
      x: round(originalOffset.x + delta.x),
      y: round(originalOffset.y + delta.y),
      detached: true,
    };
  const projectedDelta = dotVector(delta, direction);
  const offsetDelta = mulVectorScalar(direction, projectedDelta);
  return {
    x: round(originalOffset.x + offsetDelta.x),
    y: round(originalOffset.y + offsetDelta.y),
    detached: false,
  };
}

function makeEditableGeneratedHandleEqualizeGeometryForEditing(
  address,
  originalPath,
  skeletonData,
  draggedBake = null
) {
  const oppositeRole = address.role === "in" ? "out" : "in";
  const positions = {};
  for (const role of [address.role, oppositeRole, "onCurve"]) {
    const pathAddress = findGeneratedPathAddress(
      skeletonData,
      address.contour.id,
      address.point.id,
      address.side,
      role
    );
    if (!pathAddress) return null;
    try {
      const pointIndex = originalPath.getAbsolutePointIndex(
        pathAddress.pathContourIndex,
        pathAddress.contourPointIndex
      );
      positions[role] = originalPath.getPoint(pointIndex);
    } catch {
      return null;
    }
  }
  const draggedOffset = getSkeletonHandleOffset(
    address.point,
    address.side,
    address.role
  );
  const oppositeOffset = getSkeletonHandleOffset(
    address.point,
    address.side,
    oppositeRole
  );
  const ribPos = positions.onCurve;
  const baseFor = (position, offset) =>
    offset.detached ? ribPos : { x: position.x - offset.x, y: position.y - offset.y };
  // Where the generator will put this handle once the pin is gone: the offsets
  // below are stated against that base, so it has to be the post-clear one.
  const unpinBase = (base) =>
    draggedBake ? { x: base.x - draggedBake.x, y: base.y - draggedBake.y } : base;
  return {
    ribPos,
    draggedPos: positions[address.role],
    oppositePos: positions[oppositeRole],
    draggedBase: unpinBase(baseFor(positions[address.role], draggedOffset)),
    oppositeBase: baseFor(positions[oppositeRole], oppositeOffset),
    draggedDirection: address.direction,
    draggedDetached: draggedOffset.detached === true,
    oppositeDetached: oppositeOffset.detached === true,
  };
}

function collectEditableGeneratedHandleSelectionForEditing(
  selection,
  referenceSkeletonData,
  targetSkeletonData
) {
  const selected = [];
  for (const item of parseSelection([...selection]).editableGeneratedHandle || []) {
    const { contourId, pointId, side, role } = parseEditableGeneratedHandleKey(item);
    const reference = resolveEditableGeneratedHandleAddressAcrossLayersForEditing(
      referenceSkeletonData,
      referenceSkeletonData,
      contourId,
      pointId,
      side,
      role
    );
    const target = resolveEditableGeneratedHandleAddressAcrossLayersForEditing(
      referenceSkeletonData,
      targetSkeletonData,
      contourId,
      pointId,
      side,
      role
    );
    if (!reference || !target) continue;
    if (
      !findGeneratedPathAddress(
        referenceSkeletonData,
        reference.contour.id,
        reference.point.id,
        side,
        role
      )
    )
      continue;
    selected.push({ reference, target });
  }
  return selected;
}

function resolveEditableGeneratedHandleAddressAcrossLayersForEditing(
  referenceSkeletonData,
  targetSkeletonData,
  contourId,
  pointId,
  side,
  role
) {
  if (side !== "left" && side !== "right")
    throw new Error(`invalid editable generated side: ${side}`);
  if (role !== "in" && role !== "out")
    throw new Error(`invalid editable generated handle role: ${role}`);
  const reference = getSkeletonRibAddress(
    referenceSkeletonData,
    contourId,
    pointId,
    side
  );
  if (!reference || isSkeletonSideLocked(reference.point, side)) return null;
  const contour = targetSkeletonData?.contours?.[reference.contourIndex];
  const point = contour?.points?.[reference.pointIndex];
  if (!contour || !point || point.type || isSkeletonSideLocked(point, side))
    return null;
  const direction =
    publishedAuthoredAxis(referenceSkeletonData, contourId, pointId, side, role) ??
    getSkeletonHandleDirectionForPoint(contour, reference.pointIndex, role);
  if (!direction) return null;
  return {
    contour,
    contourIndex: reference.contourIndex,
    point,
    pointIndex: reference.pointIndex,
    side,
    role,
    direction,
  };
}
