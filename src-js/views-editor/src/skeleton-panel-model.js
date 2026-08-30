// Pure selection-aggregation and mixed-value helpers for the skeleton
// parameters panel. No persistence, no editSkeleton, no DOM: this module only
// reads skeleton data and reports what the panel should display. All edits go
// through skeleton-panel-edits.js -> editSkeleton (Global Constraints).

import {
  SERIF_HALF_FIELDS,
  getSkeletonHandleOffset,
  getSkeletonPointHalfWidth,
  getSkeletonPointWidth,
  getSkeletonRibAddress,
  getSkeletonRibSidesForPoint,
  SKELETON_LOCK_KINDS,
  isSkeletonSideLocked,
  parseEditableGeneratedHandleKey,
  parseEditableGeneratedPointKey,
  parseSkeletonRibKey,
} from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { getSkeletonPointAddress, parseSkeletonPointKey } from "./skeleton-editing.js";

function resolvePointAddress(skeletonData, contourId, pointId) {
  return getSkeletonPointAddress(skeletonData, Number(contourId), Number(pointId));
}

// Aggregate the current selection into skeleton points, ribs, generated
// points/handles and touched contours, all resolved against `skeletonData`
// (the display/edit layer). Addresses carry stable ids (used for edits) plus
// indices (used only for display).
export function collectSkeletonPanelSelection({ selection, skeletonData }) {
  const result = {
    points: [],
    ribs: [],
    generatedPoints: [],
    generatedHandles: [],
    contours: [],
  };
  if (!skeletonData) {
    return result;
  }
  const parsed = parseSelection([...(selection || [])]);
  const seenContours = new Set();

  const noteContour = (address) => {
    if (address && !seenContours.has(address.contour.id)) {
      seenContours.add(address.contour.id);
      result.contours.push({
        contourId: address.contour.id,
        contour: address.contour,
        contourIndex: address.contourIndex,
      });
    }
  };

  for (const item of parsed.skeletonPoint || []) {
    const { contourId, pointId } = parseSkeletonPointKey(item);
    const address = resolvePointAddress(skeletonData, contourId, pointId);
    if (!address) continue;
    result.points.push({
      contourId: address.contour.id,
      pointId: address.point.id,
      contour: address.contour,
      contourIndex: address.contourIndex,
      point: address.point,
      pointIndex: address.pointIndex,
    });
    noteContour(address);
  }

  for (const item of parsed.skeletonRib || []) {
    const { contourId, pointId, side } = parseSkeletonRibKey(`skeletonRib/${item}`);
    const address = getSkeletonRibAddress(skeletonData, contourId, pointId, side);
    if (!address) continue;
    result.ribs.push({
      contourId: address.contour.id,
      pointId: address.point.id,
      side,
      contour: address.contour,
      contourIndex: address.contourIndex,
      point: address.point,
      pointIndex: address.pointIndex,
    });
    noteContour(address);
  }

  for (const item of parsed.editableGeneratedPoint || []) {
    let parsedKey;
    try {
      parsedKey = parseEditableGeneratedPointKey(`editableGeneratedPoint/${item}`);
    } catch {
      continue;
    }
    const address = resolvePointAddress(
      skeletonData,
      parsedKey.contourId,
      parsedKey.pointId
    );
    if (!address) continue;
    result.generatedPoints.push({
      contourId: address.contour.id,
      pointId: address.point.id,
      side: parsedKey.side,
      contour: address.contour,
      point: address.point,
      pointIndex: address.pointIndex,
    });
    noteContour(address);
  }

  for (const item of parsed.editableGeneratedHandle || []) {
    let parsedKey;
    try {
      parsedKey = parseEditableGeneratedHandleKey(`editableGeneratedHandle/${item}`);
    } catch {
      continue;
    }
    const address = resolvePointAddress(
      skeletonData,
      parsedKey.contourId,
      parsedKey.pointId
    );
    if (!address) continue;
    result.generatedHandles.push({
      contourId: address.contour.id,
      pointId: address.point.id,
      side: parsedKey.side,
      role: parsedKey.role,
      contour: address.contour,
      point: address.point,
      pointIndex: address.pointIndex,
    });
    noteContour(address);
  }

  return result;
}

// Resolve a selected skeleton point entry to the on-curve point that owns it.
// Off-curve handles belong to the adjacent on-curve: the handle right after an
// on-curve is its "out" handle; otherwise the handle leads into the next
// on-curve ("in").
function anchorOnCurveEntry(entry) {
  if (!entry.point?.type) {
    return entry;
  }
  const points = entry.contour?.points || [];
  const n = points.length;
  const closed = entry.contour?.closed === true;
  const at = (index) => {
    if (closed) {
      return points[((index % n) + n) % n];
    }
    return index >= 0 && index < n ? points[index] : null;
  };
  const indexAt = (index) => (closed ? ((index % n) + n) % n : index);
  const prev = at(entry.pointIndex - 1);
  let anchorIndex = null;
  if (prev && !prev.type) {
    anchorIndex = indexAt(entry.pointIndex - 1);
  } else {
    for (let step = 1; step < n; step++) {
      const candidate = at(entry.pointIndex + step);
      if (!candidate) {
        break;
      }
      if (!candidate.type) {
        anchorIndex = indexAt(entry.pointIndex + step);
        break;
      }
    }
  }
  if (anchorIndex === null) {
    return null;
  }
  return {
    contourId: entry.contourId,
    pointId: points[anchorIndex].id,
    contour: entry.contour,
    point: points[anchorIndex],
    pointIndex: anchorIndex,
  };
}

// The panel points that participate in width/cap/corner editing: every selected
// skeleton object resolved to its owning on-curve skeleton point — explicit
// skeleton points, skeleton handles (via their anchor), ribs, and generated
// points/handles (whose keys already carry the skeleton point id).
export function collectWidthEditPoints(panelSelection) {
  const byKey = new Map();
  const add = (entry) => {
    if (!entry) {
      return;
    }
    const key = `${entry.contourId}/${entry.pointId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        contourId: entry.contourId,
        pointId: entry.pointId,
        contour: entry.contour,
        point: entry.point,
        pointIndex: entry.pointIndex,
      });
    }
  };
  for (const entry of panelSelection.points) add(anchorOnCurveEntry(entry));
  for (const entry of panelSelection.ribs) add(entry);
  for (const entry of panelSelection.generatedPoints) add(anchorOnCurveEntry(entry));
  for (const entry of panelSelection.generatedHandles) {
    add(anchorOnCurveEntry(entry));
  }
  return [...byKey.values()];
}

// Reduce a set of per-entry values into { value, mixed } (value is the shared
// value, or the first when mixed). `disabled` when the set is empty.
function reduceValues(values, { tolerance = 0 } = {}) {
  if (!values.length) {
    return { value: null, mixed: false, disabled: true, placeholder: null };
  }
  const first = values[0];
  const mixed = values.some((value) =>
    typeof value === "number" && typeof first === "number"
      ? Math.abs(value - first) > tolerance
      : value !== first
  );
  return {
    value: mixed ? null : first,
    mixed,
    disabled: false,
    placeholder: mixed ? "mixed" : null,
  };
}

function pointDefaultWidth(entry) {
  return entry.contour?.defaultWidth;
}

export function summarizeSkeletonPointWidths(selectedPoints) {
  const left = reduceValues(
    selectedPoints.map((entry) =>
      getSkeletonPointHalfWidth(entry.point, pointDefaultWidth(entry), "left")
    )
  );
  const right = reduceValues(
    selectedPoints.map((entry) =>
      getSkeletonPointHalfWidth(entry.point, pointDefaultWidth(entry), "right")
    )
  );
  const total = reduceValues(
    selectedPoints.map((entry) =>
      getSkeletonPointWidth(entry.point, pointDefaultWidth(entry))
    )
  );
  const distribution = reduceValues(
    selectedPoints.map((entry) =>
      pointDistribution(entry.point, pointDefaultWidth(entry))
    )
  );
  const linked = reduceValues(
    selectedPoints.map((entry) => entry.point?.width?.linked !== false)
  );
  const tied = reduceValues(
    selectedPoints.map((entry) => entry.point?.width?.tied !== false)
  );
  // A single-sided contour renders the SUM of the two half-widths on its visible
  // side, so per-side numbers and the split between them describe nothing the
  // designer can see. They are still stored, and still what the point returns to
  // when the contour goes back to double-sided — the panel greys them rather than
  // hiding them, so it is clear they are being kept rather than lost.
  const singleSided =
    selectedPoints.length > 0 &&
    selectedPoints.every(
      (entry) =>
        entry.contour?.singleSided === "left" || entry.contour?.singleSided === "right"
    );
  return { left, right, total, distribution, linked, tied, singleSided };
}

// Distribution percent in [-100, 100]: negative favors the right side, positive
// the left. Matches setSkeletonPointWidthDistribution (skeleton-model.js).
export function pointDistribution(point, defaultWidth) {
  const left = getSkeletonPointHalfWidth(point, defaultWidth, "left");
  const right = getSkeletonPointHalfWidth(point, defaultWidth, "right");
  const total = left + right;
  if (total <= 0) {
    return 0;
  }
  return ((left - right) / total) * 100;
}

export function summarizeSkeletonContourSelection(contours) {
  return {
    singleSided: reduceValues(
      contours.map((entry) => entry.contour.singleSided ?? null)
    ),
    defaultWidth: reduceValues(contours.map((entry) => entry.contour.defaultWidth)),
  };
}

// First/last on-curve point indices of an open skeleton contour, or null when
// the contour is closed (or has no on-curve points). Cap styles only exist at
// open-contour endpoints.
export function skeletonContourEndpointIndices(contour) {
  if (!contour || contour.closed) {
    return null;
  }
  let first = -1;
  let last = -1;
  const points = contour.points || [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  return first < 0 ? null : { first, last };
}

// Cap style state for the selected points: editable only when EVERY selected
// point is an endpoint of an open contour (donor parity). The effective style
// falls back point -> contour -> "butt".
export function summarizeSkeletonCapStyleSelection(selectedPoints) {
  if (!selectedPoints.length) {
    return { canEdit: false, mixed: false, value: null };
  }
  const styles = [];
  for (const entry of selectedPoints) {
    const endpoints = skeletonContourEndpointIndices(entry.contour);
    if (
      !endpoints ||
      (entry.pointIndex !== endpoints.first && entry.pointIndex !== endpoints.last)
    ) {
      return { canEdit: false, mixed: false, value: null };
    }
    styles.push(entry.point.capStyle ?? entry.contour.capStyle ?? "butt");
  }
  const reduced = reduceValues(styles);
  return { canEdit: true, mixed: reduced.mixed, value: reduced.value };
}

/**
 * The rib angle lock over a selection.
 *
 * It is a property of a point's rib, not of a cap, so it is offered at every
 * skeleton point. At a corner it replaces the line that splits the angle between
 * the two arms, so both arms' edge ends land on the forced rib and the corner
 * sits at a plain half-width along it.
 */
export function summarizeSkeletonRibAngleLockSelection(selectedPoints) {
  if (!selectedPoints.length) {
    return { canEdit: false, mixed: false, value: null, mode: {} };
  }
  const reduced = reduceValues(
    selectedPoints.map((entry) => entry.point.ribAngleLock ?? null)
  );
  // What a forced rib holds on to. Offered only where at least one selected
  // point has a lock, because with no lock there is nothing for it to decide.
  const locked = selectedPoints.filter((entry) => entry.point.ribAngleLock);
  const mode = reduceValues(
    locked.map((entry) => entry.point.ribAngleLockMode ?? "stroke")
  );
  return {
    canEdit: true,
    mixed: reduced.mixed,
    value: reduced.value,
    mode: { canEdit: locked.length > 0, mixed: mode.mixed, value: mode.value },
  };
}

export function summarizeSkeletonCapSelection(selectedPoints) {
  return {
    capStyle: reduceValues(selectedPoints.map((entry) => entry.point.capStyle ?? null)),
    capRadiusRatio: reduceValues(
      selectedPoints.map((entry) => entry.point.capRadiusRatio ?? null)
    ),
    capTension: reduceValues(
      selectedPoints.map((entry) => entry.point.capTension ?? null)
    ),
    capAngle: reduceValues(selectedPoints.map((entry) => entry.point.capAngle ?? null)),
    capDistance: reduceValues(
      selectedPoints.map((entry) => entry.point.capDistance ?? null)
    ),
    capBallRatio: reduceValues(
      selectedPoints.map((entry) => entry.point.capBallRatio ?? null)
    ),
    capBallShape: reduceValues(
      selectedPoints.map((entry) => entry.point.capBallShape ?? null)
    ),
    capBallEasing: reduceValues(
      selectedPoints.map((entry) => entry.point.capBallEasing ?? null)
    ),
    capBallSide: reduceValues(
      selectedPoints.map((entry) => entry.point.capBallSide ?? null)
    ),
  };
}

// Serif parameters for the selected points. Gated exactly like the cap style,
// because a serif IS a cap style — it is only offered on open-contour endpoints.
// Each serif field is stored on its endpoint.
export function summarizeSkeletonSerifSelection(selectedPoints) {
  const half = (side) => {
    const summary = {};
    for (const field of SERIF_HALF_FIELDS) {
      summary[field] = reduceValues(
        selectedPoints.map((entry) => entry.point.serif?.[side]?.[field] ?? null)
      );
    }
    return summary;
  };
  const terminal = (field, fallback = null) =>
    reduceValues(selectedPoints.map((entry) => entry.point.serif?.[field] ?? fallback));
  return {
    left: half("left"),
    right: half("right"),
    // Which sides carry a serif, and whether the two are shaped as one. A side
    // left out of it generates nothing. It falls back through the old link flag
    // so a file written before the tab row reads the same way it drew.
    sides: reduceValues(
      selectedPoints.map(
        (entry) =>
          entry.point.serif?.sides ??
          (entry.point.serif?.linked === false ? "split" : "both")
      )
    ),
    axisMode: terminal("axisMode", "perpendicular"),
    axisAngle: terminal("axisAngle", 0),
    undersideCup: terminal("undersideCup"),
    undersideCupTension: terminal("undersideCupTension"),
    // Neutral is the midpoint of the two tips, so a terminal drawn before the
    // control existed reads zero and draws exactly what it drew.
    undersideCupBalance: terminal("undersideCupBalance", 0),
  };
}

// Corner rounding is the angle-point engine: two numbers per side of the
// stroke, live on the point, and editable only when EVERY selected point is a
// non-smooth on-curve that is not an open-contour endpoint — the inverse of the
// cap gate.
export function summarizeSkeletonCornerSelection(selectedPoints) {
  let canEdit = selectedPoints.length > 0;
  for (const entry of selectedPoints) {
    if (entry.point.smooth) {
      canEdit = false;
      break;
    }
    if (!entry.contour.closed) {
      const endpoints = skeletonContourEndpointIndices(entry.contour);
      if (
        !endpoints ||
        entry.pointIndex === endpoints.first ||
        entry.pointIndex === endpoints.last
      ) {
        canEdit = false;
        break;
      }
    }
  }
  const sideValue = (side, field) =>
    reduceValues(
      selectedPoints.map((entry) => entry.point.corner?.[side]?.[field] ?? null)
    );
  return {
    canEdit,
    linked: reduceValues(
      selectedPoints.map((entry) => entry.point.corner?.linked !== false)
    ),
    left: {
      distance: sideValue("left", "distance"),
      curvature: sideValue("left", "curvature"),
    },
    right: {
      distance: sideValue("right", "distance"),
      curvature: sideValue("right", "curvature"),
    },
  };
}

// The ribs the panel's rib section acts on.
//
// An explicit rib selection wins and is used verbatim. Otherwise every selected
// skeleton object contributes *both* ribs of its owning on-curve point, so the
// rib parameters — and the reset buttons — are reachable from a plain skeleton
// point, handle or generated-point selection instead of only from a rib
// endpoint. Single-sided contours contribute only their live side, via the
// shared `getSkeletonRibSidesForPoint`.
//
// `derived` tells the panel it is acting on both sides of a point rather than
// on one hand-picked rib, so it can label the reset buttons accordingly.
export function collectRibEditTargets(panelSelection) {
  if (panelSelection?.ribs?.length) {
    return { ribs: panelSelection.ribs, derived: false };
  }
  const ribs = [];
  const seen = new Set();
  for (const entry of collectWidthEditPoints(panelSelection)) {
    for (const side of getSkeletonRibSidesForPoint(entry.contour, entry.point)) {
      const key = `${entry.contourId}/${entry.pointId}/${side}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      ribs.push({ ...entry, side });
    }
  }
  return { ribs, derived: true };
}

// Exactly one selected generated off-curve handle and nothing else skeleton-ish,
// which is the only state where "reset this handle" is unambiguous. Returns the
// handle entry ({contourId, pointId, side, role, …}) or null.
export function singleGeneratedHandleTarget(panelSelection) {
  if (panelSelection?.generatedHandles?.length !== 1) {
    return null;
  }
  if (
    panelSelection.points.length ||
    panelSelection.ribs.length ||
    panelSelection.generatedPoints.length
  ) {
    return null;
  }
  return panelSelection.generatedHandles[0];
}

export function summarizeSkeletonRibSelection(selectedRibs) {
  return {
    // One summary per lock kind: three independent controls need three answers.
    locked: Object.fromEntries(
      SKELETON_LOCK_KINDS.map((kind) => [
        kind,
        reduceValues(
          selectedRibs.map((entry) =>
            isSkeletonSideLocked(entry.point, entry.side, kind)
          )
        ),
      ])
    ),
    detached: reduceValues(
      selectedRibs.map(
        (entry) =>
          getSkeletonHandleOffset(entry.point, entry.side, "in").detached === true ||
          getSkeletonHandleOffset(entry.point, entry.side, "out").detached === true
      )
    ),
  };
}

// Snapshots power donor-style profile apply/revert: capture the exact canonical
// width objects keyed by contourId/pointId, restore them verbatim.
export function capturePointWidthSnapshot(selectedPoints) {
  const snapshot = new Map();
  for (const entry of selectedPoints) {
    const width = entry.point?.width;
    snapshot.set(`${entry.contourId}/${entry.pointId}`, {
      left: getSkeletonPointHalfWidth(entry.point, pointDefaultWidth(entry), "left"),
      right: getSkeletonPointHalfWidth(entry.point, pointDefaultWidth(entry), "right"),
      linked: width?.linked !== false,
    });
  }
  return snapshot;
}

export function applyPointWidthSnapshot(point, snapshot) {
  if (!snapshot) {
    return;
  }
  point.width = {
    left: Math.max(0, snapshot.left),
    right: Math.max(0, snapshot.right),
    linked: snapshot.linked !== false,
  };
}

// A compact, stable signature of everything the panel renders, so the panel can
// skip a rebuild when nothing relevant changed (Task 10).
export function makeSkeletonPanelStateSignature({
  glyphName,
  editingLayerNames,
  selection,
  sourceDefaultsSignature,
  panelSelection,
}) {
  const parts = [
    `g:${glyphName || ""}`,
    `L:${(editingLayerNames || []).join(",")}`,
    `s:${[...(selection || [])].sort().join(",")}`,
    `d:${sourceDefaultsSignature || ""}`,
  ];
  if (panelSelection) {
    for (const entry of collectWidthEditPoints(panelSelection)) {
      parts.push(
        // `locked` is tracked so the rib section's checkbox stays correct
        // when a side is locked outside the panel. Handle offsets are
        // deliberately NOT tracked: they change every frame while a generated
        // handle is dragged, which would rebuild the panel per frame.
        `p:${entry.contourId}/${entry.pointId}:${JSON.stringify(entry.point.width)}:${JSON.stringify(entry.point.nudge)}:${JSON.stringify(entry.point.locked)}:${entry.point.capStyle}:${entry.point.capRadiusRatio}:${entry.point.capTension}:${entry.point.capAngle}:${entry.point.capDistance}:${entry.point.capBallRatio}:${entry.point.capBallShape}:${entry.point.capBallEasing}:${entry.point.capBallSide}:${entry.point.corner?.linked}:${JSON.stringify(entry.point.serif)}`
      );
    }
    for (const entry of panelSelection.contours) {
      parts.push(
        `c:${entry.contourId}:${entry.contour.singleSided}:${entry.contour.defaultWidth}`
      );
    }
  }
  return parts.join("|");
}
