// editSkeleton-backed edit operations for the skeleton parameters panel. This
// module is the panel's ONLY write path: every function folds one editSkeleton
// mutation across all editable layers into a single undo item. It never calls
// setSkeletonData/regenerateSkeletonContours directly and never recovers
// generated geometry (Global Constraints).

import { ChangeCollector } from "@fontra/core/changes.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import { MAX_TIP_CUT_ANGLE } from "@fontra/core/serif-geometry.js";
import {
  SERIF_HALF_DEFAULTS,
  generateFromSkeleton,
} from "@fontra/core/skeleton-generator.js";
import {
  findGeneratedPathAddress,
  getSkeletonData,
  getSkeletonHandleOffset,
  getSkeletonHandleOffsetKey,
  getSkeletonPointHalfWidth,
  getSkeletonPointWidth,
  isSkeletonSideLocked,
  resetSkeletonEditableRib,
  resetSkeletonEditableRibHandle,
  resetSkeletonEditableRibHandles,
  setSkeletonCapParameters,
  setSkeletonContourDefaultWidth,
  setSkeletonContourSingleSided,
  setSkeletonCornerParameters,
  setSkeletonData,
  setSkeletonHandleDetached,
  setSkeletonHandleOffset,
  setSkeletonPointRibAngleLock,
  setSkeletonPointSideWidth,
  setSkeletonPointTotalWidth,
  setSkeletonPointWidthDistribution,
  setSkeletonPointWidthLinked,
  setSkeletonPointWidthTied,
  setSkeletonSerifParameters,
  setSkeletonSideLocked,
} from "@fontra/core/skeleton-model.js";
import {
  editSkeleton,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";
import { skeletonContourEndpointIndices } from "./skeleton-panel-model.js";

// Sender identity for every edit made through this module. The skeleton
// parameters panel filters glyphChanged events by it: its own edits already
// rebuild the form in _onFieldChange, and the async echo arriving after the
// suppression window would otherwise trigger a second rebuild that replaces
// the slider input the user is still interacting with.
export const SKELETON_PANEL_SENDER = { senderID: "skeleton-panel-edits" };

// Resolve a target skeleton contour in `target` layer from a reference-layer
// contour id, by structural ordinal (cross-layer addressing, WS-9). Returns the
// target contour or null when the structure is incompatible.
function resolveContourAcrossLayers(reference, target, contourId) {
  const contourIndex = (reference?.contours || []).findIndex(
    (contour) => contour.id === contourId
  );
  if (contourIndex < 0) {
    return null;
  }
  if (reference === target) {
    return reference.contours[contourIndex];
  }
  return target?.contours?.[contourIndex] || null;
}

// The generic loop: run `applyToLayer(working, referenceSkeletonData, isEditLayer)`
// on every editable layer's working skeleton, combine the per-layer changes into
// one undo item. Mirrors edit-tools-skeleton.js `_editSkeletonAcrossLayers`.
export async function runSkeletonPanelEdit(sceneController, undoLabel, applyToLayer) {
  return await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const editingLayers = sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
    const entries = Object.entries(editingLayers);
    if (!entries.length) {
      return;
    }
    const editLayerName = sceneController.sceneSettings?.editLayerName;
    const editLayerGlyph = editingLayers[editLayerName] || entries[0][1];
    const referenceSkeletonData = getSkeletonData(editLayerGlyph);

    const allChanges = [];
    for (const [layerName, layerGlyph] of entries) {
      const isEditLayer = layerGlyph === editLayerGlyph;
      const changes = editSkeleton(layerGlyph, (working) => {
        applyToLayer(working, referenceSkeletonData, isEditLayer);
      });
      allChanges.push(changes.prefixed(["layers", layerName, "glyph"]));
    }

    const combined = new ChangeCollector().concat(...allChanges);
    await sendIncrementalChange(combined.change);
    return { changes: combined, undoLabel, broadcast: true };
  }, SKELETON_PANEL_SENDER);
}

// Core point-editing helper: for every selected point address, resolve it into
// the current layer (by stable id in the edit layer, structural ordinal
// elsewhere) and run `mutator(point, resolvedAddress, { contour })`.
export async function editSelectedSkeletonPoints(
  sceneController,
  selectionAddresses,
  mutator,
  undoLabel
) {
  if (!selectionAddresses.length) {
    return null;
  }
  return await runSkeletonPanelEdit(
    sceneController,
    undoLabel,
    (working, reference) => {
      for (const address of selectionAddresses) {
        const resolved = resolveSkeletonAddressAcrossLayers(
          reference,
          working,
          address.contourId,
          address.pointId
        );
        if (!resolved || resolved.point.type) {
          continue;
        }
        mutator(resolved.point, address, {
          contour: resolved.contour,
          defaultWidth: resolved.contour.defaultWidth,
        });
      }
    }
  );
}

// Core contour-editing helper.
export async function editSelectedSkeletonContours(
  sceneController,
  contourAddresses,
  mutator,
  undoLabel
) {
  if (!contourAddresses.length) {
    return null;
  }
  return await runSkeletonPanelEdit(
    sceneController,
    undoLabel,
    (working, reference) => {
      for (const address of contourAddresses) {
        const contour = resolveContourAcrossLayers(
          reference,
          working,
          address.contourId
        );
        if (!contour) {
          continue;
        }
        mutator(contour, address);
      }
    }
  );
}

// ---- Point width operations -------------------------------------------------

export async function setPanelPointSideWidth(
  sceneController,
  pointAddresses,
  side,
  value,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { defaultWidth }) => {
      setSkeletonPointSideWidth(point, defaultWidth, side, value, {
        linked: point?.width?.linked !== false,
      });
    },
    undoLabel
  );
}

export async function setPanelPointTotalWidth(
  sceneController,
  pointAddresses,
  value,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { defaultWidth }) => {
      setSkeletonPointTotalWidth(point, defaultWidth, value);
    },
    undoLabel
  );
}

export async function setPanelPointDistribution(
  sceneController,
  pointAddresses,
  value,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { defaultWidth }) => {
      setSkeletonPointWidthDistribution(point, defaultWidth, value);
    },
    undoLabel
  );
}

// The one streaming edit. Applies a live drag's values to the canvas as they
// arrive (throttled) while producing exactly ONE undo record spanning the whole
// drag: every tick restores the pre-drag layer state and re-applies from there,
// so the last recorded change IS original -> final (1.2.2 recipe). Restoring
// first is also what lets a RELATIVE drag work — a nudge or a scale re-reads the
// same starting numbers each frame instead of compounding on its own output.
//
// Points and contours both ride on this; only the mutator differs.
async function streamOntoSkeleton(sceneController, valueStream, mutate, undoLabel) {
  const THROTTLE_MS = 32;
  return await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const editingLayers = sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
    const entries = Object.entries(editingLayers);
    if (!entries.length) {
      return;
    }
    const editLayerName = sceneController.sceneSettings?.editLayerName;
    const editLayerGlyph = editingLayers[editLayerName] || entries[0][1];
    const referenceSkeletonData = getSkeletonData(editLayerGlyph);

    const originals = entries.map(([layerName, layerGlyph]) => ({
      layerName,
      layerGlyph,
      path: layerGlyph.path.copy(),
      skeleton: structuredClone(getSkeletonData(layerGlyph)),
    }));

    const restoreOriginals = () => {
      for (const original of originals) {
        original.layerGlyph.path = original.path.copy();
        setSkeletonData(original.layerGlyph, structuredClone(original.skeleton));
      }
    };

    const applyValue = (value) => {
      const allChanges = [];
      for (const [layerName, layerGlyph] of entries) {
        const changes = editSkeleton(layerGlyph, (working) => {
          mutate(working, referenceSkeletonData, value);
        });
        allChanges.push(changes.prefixed(["layers", layerName, "glyph"]));
      }
      return new ChangeCollector().concat(...allChanges);
    };

    let lastValue = null;
    let lastApplied = null;
    let lastCollector = null;
    let lastTime = 0;
    let cancelled = false;
    for await (const value of valueStream) {
      if (isScrubCancelled(value)) {
        cancelled = true;
        break;
      }
      lastValue = value;
      const now = Date.now();
      if (now - lastTime < THROTTLE_MS) {
        continue;
      }
      lastTime = now;
      restoreOriginals();
      lastCollector = applyValue(value);
      lastApplied = value;
      await sendIncrementalChange(lastCollector.change, true);
    }

    // Abandoned: put the shape back where the drag found it and record nothing.
    // Returning no changes is what makes it not an undo step — the same ending
    // a drag that never crossed the dead zone already had.
    if (cancelled) {
      if (lastCollector) {
        restoreOriginals();
        await sendIncrementalChange(lastCollector.rollbackChange);
      }
      return;
    }
    if (lastValue === null) {
      return;
    }
    if (lastApplied !== lastValue || !lastCollector) {
      restoreOriginals();
      lastCollector = applyValue(lastValue);
    }
    await sendIncrementalChange(lastCollector.change);
    return { changes: lastCollector, undoLabel, broadcast: true };
  }, SKELETON_PANEL_SENDER);
}

export async function setPanelPointValuesStream(
  sceneController,
  pointAddresses,
  valueStream,
  applyToPoint,
  undoLabel
) {
  if (!pointAddresses.length) {
    return null;
  }
  return streamOntoSkeleton(
    sceneController,
    valueStream,
    (working, reference, value) => {
      for (const address of pointAddresses) {
        const resolved = resolveSkeletonAddressAcrossLayers(
          reference,
          working,
          address.contourId,
          address.pointId
        );
        if (!resolved || resolved.point.type) {
          continue;
        }
        applyToPoint(resolved.point, resolved.contour, value);
      }
    },
    undoLabel
  );
}

export async function setPanelContourValuesStream(
  sceneController,
  contourAddresses,
  valueStream,
  applyToContour,
  undoLabel
) {
  if (!contourAddresses.length) {
    return null;
  }
  return streamOntoSkeleton(
    sceneController,
    valueStream,
    (working, reference, value) => {
      for (const address of contourAddresses) {
        const contour = resolveContourAcrossLayers(
          reference,
          working,
          address.contourId
        );
        if (!contour) {
          continue;
        }
        applyToContour(contour, value);
      }
    },
    undoLabel
  );
}

export async function setPanelPointDistributionStream(
  sceneController,
  pointAddresses,
  valueStream,
  undoLabel
) {
  return setPanelPointValuesStream(
    sceneController,
    pointAddresses,
    valueStream,
    (point, contour, value) => {
      setSkeletonPointWidthDistribution(point, contour.defaultWidth, value);
    },
    undoLabel
  );
}

export async function setPanelPointLinked(
  sceneController,
  pointAddresses,
  linked,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point) => {
      setSkeletonPointWidthLinked(point, linked);
    },
    undoLabel
  );
}

export async function setPanelPointTied(
  sceneController,
  pointAddresses,
  tied,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point) => {
      setSkeletonPointWidthTied(point, tied);
    },
    undoLabel
  );
}

// ---- Scrubbing: move by a change rather than set to a value -----------------
//
// Dragging a field's label sends the CHANGE from where the drag started, not a
// value. Adding that change to each point's own number is what keeps a mixed
// selection mixed: a 40 and a 60 dragged up by 10 become a 50 and a 70, where
// setting them both would collapse the difference with no warning.
//
// All of these are relative, so they MUST run through the streaming helper,
// which restores the pre-drag skeleton before every frame. Applied to their own
// output instead they would compound and run away within a single drag.

export async function nudgePanelPointWidthStream(
  sceneController,
  pointAddresses,
  side,
  valueStream,
  undoLabel
) {
  return setPanelPointValuesStream(
    sceneController,
    pointAddresses,
    valueStream,
    (point, contour, change) => moveOnePointWidth(point, contour, side, added(change)),
    undoLabel
  );
}

// Both ways of changing a width land here. A scrub adds to what the point
// holds; the multiply beside it scales what the point holds. The only
// difference is the arithmetic, so it is the argument.
function moveOnePointWidth(point, contour, side, next) {
  const defaultWidth = contour.defaultWidth;
  if (side === "total") {
    setSkeletonPointTotalWidth(
      point,
      defaultWidth,
      next(getSkeletonPointWidth(point, defaultWidth))
    );
    return;
  }
  setSkeletonPointSideWidth(
    point,
    defaultWidth,
    side,
    next(getSkeletonPointHalfWidth(point, defaultWidth, side)),
    { linked: point?.width?.linked !== false }
  );
}

const added = (amount) => (current) => current + Number(amount);
const scaled = (amount) => (current) => Math.round(current * Number(amount));

export async function scalePanelPointWidth(
  sceneController,
  pointAddresses,
  side,
  factor,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { contour }) =>
      moveOnePointWidth(point, contour, side, scaled(factor)),
    undoLabel
  );
}

export async function nudgePanelContourDefaultWidthStream(
  sceneController,
  contourAddresses,
  valueStream,
  undoLabel
) {
  return setPanelContourValuesStream(
    sceneController,
    contourAddresses,
    valueStream,
    (contour, change) =>
      setSkeletonContourDefaultWidth(contour, added(change)(contour.defaultWidth ?? 0)),
    undoLabel
  );
}

export async function scalePanelContourDefaultWidth(
  sceneController,
  contourAddresses,
  factor,
  undoLabel
) {
  return editSelectedSkeletonContours(
    sceneController,
    contourAddresses,
    (contour) =>
      setSkeletonContourDefaultWidth(
        contour,
        scaled(factor)(contour.defaultWidth ?? 0)
      ),
    undoLabel
  );
}

export async function nudgePanelCapParameterStream(
  sceneController,
  pointAddresses,
  field,
  valueStream,
  undoLabel
) {
  return setPanelPointValuesStream(
    sceneController,
    pointAddresses,
    valueStream,
    (point, _contour, change) => moveOnePointCapParameter(point, field, added(change)),
    undoLabel
  );
}

// A cap parameter the point does not store is inheriting, and there is no
// resolved value to move away from here. Treat the change as starting from zero
// rather than pinning the point to a default it never chose.
function moveOnePointCapParameter(point, field, next) {
  setSkeletonCapParameters(point, {
    [field]: next(Number.isFinite(point[field]) ? point[field] : 0),
  });
}

export async function scalePanelCapParameter(
  sceneController,
  pointAddresses,
  field,
  factor,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point) => moveOnePointCapParameter(point, field, scaled(factor)),
    undoLabel
  );
}

// Apply a width snapshot (profile revert), restoring exact canonical widths.
export async function applyPanelPointWidthSnapshot(
  sceneController,
  pointAddresses,
  snapshot,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, address) => {
      const entry = snapshot.get(`${address.contourId}/${address.pointId}`);
      if (!entry) {
        return;
      }
      point.width = {
        left: Math.max(0, entry.left),
        right: Math.max(0, entry.right),
        linked: entry.linked !== false,
      };
    },
    undoLabel
  );
}

// ---- Contour operations -----------------------------------------------------

export async function setPanelContourSingleSided(
  sceneController,
  contourAddresses,
  sideOrNull,
  undoLabel
) {
  return editSelectedSkeletonContours(
    sceneController,
    contourAddresses,
    (contour) => {
      setSkeletonContourSingleSided(contour, sideOrNull);
    },
    undoLabel
  );
}

export async function setPanelContourDefaultWidth(
  sceneController,
  contourAddresses,
  value,
  undoLabel
) {
  return editSelectedSkeletonContours(
    sceneController,
    contourAddresses,
    (contour) => {
      setSkeletonContourDefaultWidth(contour, value);
    },
    undoLabel
  );
}

// ---- Cap and corner operations ----------------------------------------------

export async function setPanelCapParameters(
  sceneController,
  pointAddresses,
  values,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point) => {
      setSkeletonCapParameters(point, values);
    },
    undoLabel
  );
}

// Set the cap style on selected open-contour endpoints. Non-endpoint points
// are skipped per layer (cross-layer structures may differ). Round caps clear
// rib adjustments on both sides (donor parity: round cap endpoints must not
// keep rib nudges/handle offsets).
export async function setPanelCapStyle(
  sceneController,
  pointAddresses,
  capStyle,
  undoLabel,
  presetValues = null
) {
  const presetFields =
    capStyle === "round"
      ? ["capRadiusRatio", "capTension"]
      : capStyle === "square"
        ? ["capAngle", "capDistance"]
        : capStyle === "drop"
          ? ["capBallRatio", "capBallShape", "capTension"]
          : [];
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { contour }) => {
      const endpoints = skeletonContourEndpointIndices(contour);
      if (!endpoints) {
        return;
      }
      const pointIndex = contour.points.indexOf(point);
      if (pointIndex !== endpoints.first && pointIndex !== endpoints.last) {
        return;
      }
      setSkeletonCapParameters(point, { capStyle });
      // Master cap presets ("Default caps") seed the style's parameters when
      // the point doesn't carry explicit values yet (donor "Base" profile)
      const seeded = {};
      for (const field of presetFields) {
        if (!Number.isFinite(point[field]) && Number.isFinite(presetValues?.[field])) {
          seeded[field] = presetValues[field];
        }
      }
      if (Object.keys(seeded).length) {
        setSkeletonCapParameters(point, seeded);
      }
      if (capStyle === "round") {
        resetSkeletonEditableRib(point, "left");
        resetSkeletonEditableRib(point, "right");
      }
    },
    undoLabel
  );
}

// Serif parameters, gated to open-contour endpoints like the cap style is,
// since a serif is a cap style and is only offered there.
export async function setPanelSerifParameters(
  sceneController,
  pointAddresses,
  values,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { contour }) => {
      const endpoints = skeletonContourEndpointIndices(contour);
      if (!endpoints) {
        return;
      }
      const pointIndex = contour.points.indexOf(point);
      if (pointIndex !== endpoints.first && pointIndex !== endpoints.last) {
        return;
      }
      setSkeletonSerifParameters(point, values);
    },
    undoLabel
  );
}

// What a scrub may move each serif number to, in stored units. Distances cannot
// go below zero, which is the default. Two exceptions:
//
// - `wingSlope` is a signed offset. Negative tilts the wing's inner face the
//   other way, and that whole half of its range is a real family of shapes.
// - `tipCutAngle` is signed AND capped, at the geometry's own limit. Without the
//   cap here the stored number would keep climbing past a shape that had already
//   stopped moving, and the panel would show an angle the terminal is not at.
const SERIF_NUDGE_BOUNDS = {
  wingSlope: { min: null, max: null },
  tipCutAngle: { min: -MAX_TIP_CUT_ANGLE, max: MAX_TIP_CUT_ANGLE },
};
const DEFAULT_SERIF_NUDGE_BOUNDS = { min: 0, max: null };

// Move one serif number per point by the drag's change, keeping a mixed
// selection mixed. `targets` is a list of {side, field} for half fields, or
// {field} for the terminal-level ones.
//
// A value the point does not store starts from the generator's migration value.
function nudgeOnePointSerif(point, contour, targets, next) {
  const values = {};
  for (const { side, field } of targets) {
    const stored = side ? point.serif?.[side]?.[field] : point.serif?.[field];
    const current = Number.isFinite(stored)
      ? stored
      : side
        ? (SERIF_HALF_DEFAULTS[field] ?? 0)
        : 0;
    // Serif lengths are font units and the generator quantizes to the grid
    // anyway, so a fraction left behind only stores a number the outline never
    // uses — and makes the next drag start from a value the panel isn't showing.
    const bounds = SERIF_NUDGE_BOUNDS[field] ?? DEFAULT_SERIF_NUDGE_BOUNDS;
    let raw = next(current);
    if (bounds.min != null) {
      raw = Math.max(raw, bounds.min);
    }
    if (bounds.max != null) {
      raw = Math.min(raw, bounds.max);
    }
    const moved = Math.round(raw);
    if (side) {
      values[side] = { ...(values[side] || {}), [field]: moved };
    } else {
      values[field] = moved;
    }
  }
  setSkeletonSerifParameters(point, values);
}

export async function nudgePanelSerifValueStream(
  sceneController,
  pointAddresses,
  targets,
  valueStream,
  undoLabel
) {
  return setPanelPointValuesStream(
    sceneController,
    pointAddresses,
    valueStream,
    (point, contour, change) => {
      const endpoints = skeletonContourEndpointIndices(contour);
      if (!endpoints) {
        return;
      }
      const pointIndex = contour.points.indexOf(point);
      if (pointIndex !== endpoints.first && pointIndex !== endpoints.last) {
        return;
      }
      nudgeOnePointSerif(point, contour, targets, added(change));
    },
    undoLabel
  );
}

export async function scalePanelSerifValue(
  sceneController,
  pointAddresses,
  targets,
  factor,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { contour }) => {
      const endpoints = skeletonContourEndpointIndices(contour);
      if (!endpoints) {
        return;
      }
      const pointIndex = contour.points.indexOf(point);
      if (pointIndex !== endpoints.first && pointIndex !== endpoints.last) {
        return;
      }
      nudgeOnePointSerif(point, contour, targets, scaled(factor));
    },
    undoLabel
  );
}

// Streaming variant, for the serif sliders: the terminal redraws under the
// thumb instead of jumping once on release. Same endpoint gate as the committed
// path, applied per point rather than up front because the stream helper hands
// the contour over one point at a time.
export async function setPanelSerifParametersStream(
  sceneController,
  pointAddresses,
  valueStream,
  makeValues,
  undoLabel
) {
  return setPanelPointValuesStream(
    sceneController,
    pointAddresses,
    valueStream,
    (point, contour, value) => {
      const endpoints = skeletonContourEndpointIndices(contour);
      if (!endpoints) {
        return;
      }
      const pointIndex = contour.points.indexOf(point);
      if (pointIndex !== endpoints.first && pointIndex !== endpoints.last) {
        return;
      }
      setSkeletonSerifParameters(point, makeValues(value));
    },
    undoLabel
  );
}

// Lock the ribs of selected open-contour endpoints to an axis (or clear it).
// Gated to endpoints like the cap style is, since that is where it is offered.
export async function setPanelRibAngleLock(
  sceneController,
  pointAddresses,
  ribAngleLock,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point, _address, { contour }) => {
      const endpoints = skeletonContourEndpointIndices(contour);
      if (!endpoints) {
        return;
      }
      const pointIndex = contour.points.indexOf(point);
      if (pointIndex !== endpoints.first && pointIndex !== endpoints.last) {
        return;
      }
      setSkeletonPointRibAngleLock(point, ribAngleLock);
    },
    undoLabel
  );
}

export async function setPanelCornerParameters(
  sceneController,
  pointAddresses,
  values,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    pointAddresses,
    (point) => {
      setSkeletonCornerParameters(point, values);
    },
    undoLabel
  );
}

// ---- Rib / editable-generated handle operations -----------------------------

export async function resetPanelRibs(
  sceneController,
  ribAddresses,
  { handlesOnly = false } = {},
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    ribAddresses,
    (point, address) => {
      // A locked side blocks every adjustment route, resets included.
      if (isSkeletonSideLocked(point, address.side)) {
        return;
      }
      if (handlesOnly) {
        resetSkeletonEditableRibHandles(point, address.side);
      } else {
        resetSkeletonEditableRib(point, address.side);
      }
    },
    undoLabel
  );
}

// Where a single generated handle lands once its own offset is removed: the
// position the generator produces on its own. Returns null when the handle was
// not detached (a plain removal is then all the reset needs), otherwise the
// rib-point-relative offset that re-anchors the detached handle there.
function computeResetHandleAnchor(layerGlyph, referenceSkeletonData, handleAddress) {
  const skeletonData = getSkeletonData(layerGlyph);
  const resolved = resolveSkeletonAddressAcrossLayers(
    referenceSkeletonData,
    skeletonData,
    handleAddress.contourId,
    handleAddress.pointId
  );
  if (!resolved || resolved.point.type) {
    return null;
  }
  const { side, role } = handleAddress;
  if (getSkeletonHandleOffset(resolved.point, side, role).detached !== true) {
    return null;
  }
  const scratch = structuredClone(skeletonData);
  const scratchPoint =
    scratch.contours[resolved.contourIndex]?.points?.[resolved.pointIndex];
  if (!scratchPoint) {
    return null;
  }
  const offsets = { ...(scratchPoint.handleOffsets || {}) };
  delete offsets[getSkeletonHandleOffsetKey(side, role)];
  scratchPoint.handleOffsets = offsets;

  const generated = generateFromSkeleton(scratch);
  const derived = findGeneratedOutputPosition(
    generated,
    resolved.contour.id,
    resolved.point.id,
    side,
    role
  );
  // Detached offsets are measured from the rib point (the generated on-curve).
  const ribPoint = findGeneratedOutputPosition(
    generated,
    resolved.contour.id,
    resolved.point.id,
    side,
    "onCurve"
  );
  if (!derived || !ribPoint) {
    return null;
  }
  return {
    x: Math.round(derived.x - ribPoint.x),
    y: Math.round(derived.y - ribPoint.y),
  };
}

// Reset a single generated handle to its derived position. `handleAddress`
// carries side + role, so only that one handle is cleared — its pair on the
// same side, the side nudge and the editable flag are untouched.
//
// A detached handle stays detached: it is re-anchored at the derived position,
// which becomes its new absolute starting point. (Detach can't simply ride
// through the reset, because the offset the flag lives on is exactly what is
// being cleared, and an all-zero detached offset would sit on the rib point.)
export async function resetPanelGeneratedHandle(
  sceneController,
  handleAddress,
  undoLabel
) {
  return await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const editingLayers = sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
    const entries = Object.entries(editingLayers);
    if (!entries.length) {
      return;
    }
    const editLayerName = sceneController.sceneSettings?.editLayerName;
    const editLayerGlyph = editingLayers[editLayerName] || entries[0][1];
    const referenceSkeletonData = getSkeletonData(editLayerGlyph);

    const allChanges = [];
    for (const [layerName, layerGlyph] of entries) {
      const anchor = computeResetHandleAnchor(
        layerGlyph,
        referenceSkeletonData,
        handleAddress
      );
      const changes = editSkeleton(layerGlyph, (working) => {
        const resolved = resolveSkeletonAddressAcrossLayers(
          referenceSkeletonData,
          working,
          handleAddress.contourId,
          handleAddress.pointId
        );
        if (!resolved || resolved.point.type) {
          return;
        }
        const { side, role } = handleAddress;
        if (isSkeletonSideLocked(resolved.point, side)) {
          return;
        }
        resetSkeletonEditableRibHandle(resolved.point, side, role);
        if (anchor) {
          setSkeletonHandleOffset(resolved.point, side, role, {
            x: anchor.x,
            y: anchor.y,
            detached: true,
          });
        }
      });
      allChanges.push(changes.prefixed(["layers", layerName, "glyph"]));
    }

    const combined = new ChangeCollector().concat(...allChanges);
    await sendIncrementalChange(combined.change);
    return { changes: combined, undoLabel, broadcast: true };
  });
}

// Position of a generated point in raw generator output (pre-packing), found
// by side-bearing provenance.
function findGeneratedOutputPosition(generated, contourId, pointId, side, role) {
  for (const entry of generated.provenance || []) {
    if (entry.skeletonContourId !== contourId) {
      continue;
    }
    const pointMap = entry.pointMap || [];
    for (let i = 0; i < pointMap.length; i++) {
      const provenance = pointMap[i];
      if (
        provenance?.skeletonPointId === pointId &&
        provenance.side === side &&
        provenance.role === role
      ) {
        return generated.contours[entry.generatedContourIndex]?.points?.[i] || null;
      }
    }
  }
  return null;
}

// Compute position-preserving offset conversions for a detach toggle (donor
// parity): detaching rewrites each handle offset into rib-point space
// (offset = handle − rib point); re-attaching rewrites it into control-point
// space (offset = handle − base handle, where the base comes from
// regenerating with that side's offsets cleared). Either way the handle must
// not move on canvas when the checkbox is toggled.
export function computeRibDetachConversions(
  layerGlyph,
  referenceSkeletonData,
  ribAddresses,
  detached
) {
  const skeletonData = getSkeletonData(layerGlyph);
  const conversions = [];
  for (const address of ribAddresses) {
    const resolved = resolveSkeletonAddressAcrossLayers(
      referenceSkeletonData,
      skeletonData,
      address.contourId,
      address.pointId
    );
    if (
      !resolved ||
      resolved.point.type ||
      isSkeletonSideLocked(resolved.point, address.side)
    ) {
      continue;
    }
    const positions = {};
    for (const role of ["in", "out", "onCurve"]) {
      const pathAddress = findGeneratedPathAddress(
        skeletonData,
        resolved.contour.id,
        resolved.point.id,
        address.side,
        role
      );
      if (!pathAddress) {
        continue;
      }
      try {
        positions[role] = layerGlyph.path.getPoint(
          layerGlyph.path.getAbsolutePointIndex(
            pathAddress.pathContourIndex,
            pathAddress.contourPointIndex
          )
        );
      } catch {
        continue;
      }
    }
    if (!positions.onCurve || (!positions.in && !positions.out)) {
      continue;
    }

    let basePositions = null;
    if (!detached) {
      // Re-attaching: base = regeneration WITHOUT this side's offsets.
      const scratch = structuredClone(skeletonData);
      const scratchPoint =
        scratch.contours[resolved.contourIndex]?.points?.[resolved.pointIndex];
      if (!scratchPoint) {
        continue;
      }
      scratchPoint.handleOffsets = {
        ...scratchPoint.handleOffsets,
        [`${address.side}In`]: { x: 0, y: 0, detached: false },
        [`${address.side}Out`]: { x: 0, y: 0, detached: false },
      };
      const generated = generateFromSkeleton(scratch);
      basePositions = {
        in: findGeneratedOutputPosition(
          generated,
          resolved.contour.id,
          resolved.point.id,
          address.side,
          "in"
        ),
        out: findGeneratedOutputPosition(
          generated,
          resolved.contour.id,
          resolved.point.id,
          address.side,
          "out"
        ),
      };
    }

    const offsets = {};
    for (const role of ["in", "out"]) {
      const handlePos = positions[role];
      if (!handlePos) {
        continue;
      }
      const base = detached ? positions.onCurve : basePositions?.[role];
      if (!base) {
        continue;
      }
      offsets[role] = {
        x: Math.round(handlePos.x - base.x),
        y: Math.round(handlePos.y - base.y),
      };
    }
    conversions.push({
      contourId: address.contourId,
      pointId: address.pointId,
      side: address.side,
      offsets,
    });
  }
  return conversions;
}

// Detach the handle offsets of the selected rib sides from the skeleton
// (absolute positioning relative to the rib point) or re-attach them
// (relative to the generated base handles). Position-preserving in both
// directions.
export async function setPanelRibDetached(
  sceneController,
  ribAddresses,
  detached,
  undoLabel
) {
  if (!ribAddresses.length) {
    return null;
  }
  return await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
    const editingLayers = sceneController.getEditingLayerFromGlyphLayers(glyph.layers);
    const entries = Object.entries(editingLayers);
    if (!entries.length) {
      return;
    }
    const editLayerName = sceneController.sceneSettings?.editLayerName;
    const editLayerGlyph = editingLayers[editLayerName] || entries[0][1];
    const referenceSkeletonData = getSkeletonData(editLayerGlyph);

    const allChanges = [];
    for (const [layerName, layerGlyph] of entries) {
      const conversions = computeRibDetachConversions(
        layerGlyph,
        referenceSkeletonData,
        ribAddresses,
        detached
      );
      const changes = editSkeleton(layerGlyph, (working) => {
        for (const conversion of conversions) {
          const resolved = resolveSkeletonAddressAcrossLayers(
            referenceSkeletonData,
            working,
            conversion.contourId,
            conversion.pointId
          );
          if (!resolved || resolved.point.type) {
            continue;
          }
          for (const [role, offset] of Object.entries(conversion.offsets)) {
            const existing = getSkeletonHandleOffset(
              resolved.point,
              conversion.side,
              role
            );
            setSkeletonHandleOffset(resolved.point, conversion.side, role, {
              ...existing,
              x: offset.x,
              y: offset.y,
            });
          }
          // Direct flag write LAST: it both sets and clears `detached`.
          setSkeletonHandleDetached(resolved.point, conversion.side, detached);
        }
      });
      allChanges.push(changes.prefixed(["layers", layerName, "glyph"]));
    }

    const combined = new ChangeCollector().concat(...allChanges);
    await sendIncrementalChange(combined.change);
    return { changes: combined, undoLabel, broadcast: true };
  });
}

// Lock or unlock a rib side. A lock only blocks adjustment: stored nudges and
// handle offsets are preserved, and unlocking re-exposes them unchanged.
export async function setPanelRibLocked(
  sceneController,
  ribAddresses,
  locked,
  undoLabel
) {
  return editSelectedSkeletonPoints(
    sceneController,
    ribAddresses,
    (point, address) => {
      setSkeletonSideLocked(point, address.side, locked);
    },
    undoLabel
  );
}
