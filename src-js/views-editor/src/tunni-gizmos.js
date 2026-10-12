import { applicationSettingsController } from "@fontra/core/application-settings.js";
import {
  buildGeneratedTunniSegments,
  buildSkeletonTunniSegments,
  calculateGeneratedOnCurveGizmoPoint,
  calculateSkeletonTrueTunniPoint,
  calculateSkeletonTunniPoint,
  getGeneratedPathContourIndices,
  segmentToTunniPoints,
} from "@fontra/core/skeleton-model.js";
import {
  calculateCurvatureGizmoPoint,
  calculateTunniPoint,
} from "@fontra/core/tunni-calculations.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { distance } from "@fontra/core/vector.js";
import { GIZMO_TUNING, GIZMO_TUNING_DEFAULTS, GizmoReveal } from "./gizmo.js";

// The Tunni gizmos on all three kinds of curve, in one place: which setting
// switches each one, where each one sits, and whether the cursor has rested on
// it long enough for it to show.
//
// Each switch governs a gizmo's drawing AND its function. A gizmo that is off
// is not a hidden control, it is no control.

export const TUNNI_SETTINGS = {
  basicCurvature: "fontra.tunni.curvature",
  basicOnCurve: "fontra.tunni.on-curve",
  basicLabels: "fontra.tunni.labels",
  skeletonCurvature: "fontra.skeleton.tunni-curvature",
  skeletonOnCurve: "fontra.skeleton.tunni-on-curve",
  skeletonLabels: "fontra.skeleton.tunni-labels",
  // Gizmo mode for generated contours: on, the gizmos edit the outline and the
  // generated points and handles cannot be dragged directly; off, the reverse.
  generatedMode: "fontra.skeleton.generated-tunni",
  generatedCurvature: "fontra.skeleton.generated-curvature",
  generatedOnCurve: "fontra.skeleton.generated-on-curve",
  generatedLabels: "fontra.skeleton.generated-curvature-labels",
};

// The three switches per kind of curve. The curvature switch is the kind's main
// toggle: the on-curve gizmo and the label work only while it is on, whatever
// their own checks say.
export const TUNNI_KINDS = {
  basic: {
    curvature: TUNNI_SETTINGS.basicCurvature,
    onCurve: TUNNI_SETTINGS.basicOnCurve,
    labels: TUNNI_SETTINGS.basicLabels,
  },
  skeleton: {
    curvature: TUNNI_SETTINGS.skeletonCurvature,
    onCurve: TUNNI_SETTINGS.skeletonOnCurve,
    labels: TUNNI_SETTINGS.skeletonLabels,
  },
  generated: {
    curvature: TUNNI_SETTINGS.generatedCurvature,
    onCurve: TUNNI_SETTINGS.generatedOnCurve,
    labels: TUNNI_SETTINGS.generatedLabels,
  },
};

// Whether one control of one kind does anything. `control` is "curvature",
// "onCurve" or "labels". A generated control also needs gizmo mode.
export function isTunniControlLive(settingsModel, kind, control) {
  const keys = TUNNI_KINDS[kind];
  const on = (key) => settingsModel?.[key] === true;
  // A generated gizmo needs its outline on screen.
  const main =
    on(keys.curvature) &&
    (kind !== "generated" ||
      (on(TUNNI_SETTINGS.generatedMode) &&
        applicationSettingsController.model.skeletonShowGeneratedGeometry !== false));
  return control === "curvature" ? main : main && on(keys[control]);
}

// The on-curve gizmos. They wait for the cursor as the curvature gizmo does,
// on their own, longer timings.
export function isTunniOnCurveType(type) {
  return type === "on-curve" || type === "true-tunni" || type === "generated-on-curve";
}

// The mode and the visibility are two settings with one rule between them:
// handles mode has no gizmos, so leaving gizmo mode switches them off, and asking
// for a gizmo while in handles mode is asking for gizmo mode. Entering gizmo mode
// brings the curvature gizmo back, so the mode switch never lands on a mode that
// shows and does nothing.
export function coupleGeneratedGizmoSettings(settings) {
  const { generatedMode, generatedCurvature, generatedOnCurve } = TUNNI_SETTINGS;
  // Listeners run after the change, so each reads the current value: a queued
  // notice from before a newer switch must not undo it.
  settings.addKeyListener(generatedMode, () => {
    if (settings.model[generatedMode] === true) {
      settings.model[generatedCurvature] = true;
    } else {
      settings.model[generatedCurvature] = false;
      settings.model[generatedOnCurve] = false;
    }
  });
  settings.addKeyListener([generatedCurvature, generatedOnCurve], (event) => {
    if (settings.model[event.key] === true && settings.model[generatedMode] !== true) {
      settings.model[generatedMode] = true;
    }
  });
}

// A label follows its curvature gizmo, showing and fading with it, unless the
// Tunni section's "Always show labels" toggle is on.
export function tunniLabelAlpha(model, key) {
  return applicationSettingsController.model.tunniLabelsAlwaysVisible
    ? 1
    : (model.gizmoReveal?.alpha(key) ?? 0);
}

export function tunniGizmoKey(kind, type, id) {
  return `${kind}:${type}:${id}`;
}

// Every segment id starts with its contour, so a gizmo key names its contour.
export function tunniGizmoContourKey(key) {
  const [kind, , id] = key.split(":");
  return `${kind}:${id.split("/")[0]}`;
}

function isOnCurveGizmoKey(key) {
  return key.split(":")[1] === "on-curve";
}

// The ordinary path's cubic segments that carry gizmos: every one outside the
// generated contours, which have their own.
export function* iterBasicTunniSegments(path, skeletonData) {
  if (!path) {
    return;
  }
  const generated = getGeneratedPathContourIndices(skeletonData);
  const isCubicControl = (index) =>
    (path.pointTypes[index] & VarPackedPath.POINT_TYPE_MASK) ===
    VarPackedPath.OFF_CURVE_CUBIC;
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    if (generated.has(contourIndex)) {
      continue;
    }
    for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
      if (
        segment.points.length === 4 &&
        isCubicControl(segment.parentPointIndices[1]) &&
        isCubicControl(segment.parentPointIndices[2])
      ) {
        yield {
          contourIndex,
          segment,
          id: `${contourIndex}/${segment.parentPointIndices[0]}`,
        };
      }
    }
  }
}

export function skeletonTunniSegmentId(contour, segment) {
  return `${contour.id}/${segment.startPointId}`;
}

export function generatedTunniSegmentId(segment) {
  return `${segment.pathContourIndex}/${segment.segmentIndex}`;
}

// The four points of the segment a curvature gizmo key stands for, from live
// geometry, or null where the key names nothing now.
export function tunniCurvatureSegmentPoints(key, { path, skeletonData }) {
  const [kind, , id] = key.split(":");
  if (kind === "basic") {
    for (const segment of iterBasicTunniSegments(path, skeletonData)) {
      if (segment.id === id) {
        return segment.segment.points;
      }
    }
    return null;
  }
  if (kind === "skeleton") {
    for (const contour of skeletonData?.contours || []) {
      for (const segment of buildSkeletonTunniSegments(contour)) {
        if (skeletonTunniSegmentId(contour, segment) === id) {
          return segmentToTunniPoints(segment);
        }
      }
    }
    return null;
  }
  if (kind === "generated" && skeletonData?.generated?.length) {
    const segment = buildGeneratedTunniSegments(skeletonData, path).find(
      (candidate) => generatedTunniSegmentId(candidate) === id
    );
    return segment?.points ?? null;
  }
  return null;
}

//
// The nearest live gizmo within `radius` of `point`, in glyph coordinates, or
// null. Each result carries the hit the matching drag handler takes.
//
export function findTunniGizmo(point, radius, { path, skeletonData, settingsModel }) {
  let best = null;
  const consider = (key, gizmoPoint, hit) => {
    if (!gizmoPoint) {
      return;
    }
    const gap = distance(point, gizmoPoint);
    if (gap <= radius && (!best || gap < best.distance)) {
      best = { key, distance: gap, gizmoPoint, ...hit };
    }
  };

  const basicCurvature = isTunniControlLive(settingsModel, "basic", "curvature");
  const basicOnCurve = isTunniControlLive(settingsModel, "basic", "onCurve");
  if (basicCurvature || basicOnCurve) {
    for (const { segment, id } of iterBasicTunniSegments(path, skeletonData)) {
      const hit = { kind: "basic", segment };
      if (basicCurvature) {
        consider(
          tunniGizmoKey("basic", "curvature", id),
          calculateCurvatureGizmoPoint(segment.points),
          { ...hit, type: "curvature" }
        );
      }
      if (basicOnCurve) {
        consider(
          tunniGizmoKey("basic", "on-curve", id),
          calculateTunniPoint(segment.points),
          { ...hit, type: "on-curve" }
        );
      }
    }
  }

  const skeletonCurvature = isTunniControlLive(settingsModel, "skeleton", "curvature");
  const skeletonOnCurve = isTunniControlLive(settingsModel, "skeleton", "onCurve");
  if (skeletonCurvature || skeletonOnCurve) {
    (skeletonData?.contours || []).forEach((contour, contourIndex) => {
      for (const segment of buildSkeletonTunniSegments(contour)) {
        if (segment.controlPoints.length !== 2) {
          continue;
        }
        const id = skeletonTunniSegmentId(contour, segment);
        const hit = {
          kind: "skeleton",
          contourId: contour.id,
          contourIndex,
          segmentIndex: segment.segmentIndex,
          segment,
        };
        if (skeletonCurvature) {
          consider(
            tunniGizmoKey("skeleton", "curvature", id),
            calculateSkeletonTunniPoint(segment),
            { ...hit, type: "tunni" }
          );
        }
        if (skeletonOnCurve) {
          consider(
            tunniGizmoKey("skeleton", "on-curve", id),
            calculateSkeletonTrueTunniPoint(segment),
            { ...hit, type: "true-tunni" }
          );
        }
      }
    });
  }

  const generatedCurvature = isTunniControlLive(
    settingsModel,
    "generated",
    "curvature"
  );
  const generatedOnCurve = isTunniControlLive(settingsModel, "generated", "onCurve");
  if ((generatedCurvature || generatedOnCurve) && skeletonData?.generated?.length) {
    for (const segment of buildGeneratedTunniSegments(skeletonData, path)) {
      const id = generatedTunniSegmentId(segment);
      if (generatedCurvature && !segment.handlesLocked) {
        consider(
          tunniGizmoKey("generated", "curvature", id),
          calculateCurvatureGizmoPoint(segment.points),
          { kind: "generated", type: "generated-curvature", segment }
        );
      }
      if (generatedOnCurve && segment.onCurveMovable?.some(Boolean)) {
        consider(
          tunniGizmoKey("generated", "on-curve", id),
          calculateGeneratedOnCurveGizmoPoint(segment),
          { kind: "generated", type: "generated-on-curve", segment }
        );
      }
    }
  }

  return best;
}

// The on-curve gizmos' own timings, added to the shared gizmo tuning: one live
// object, which the Visual panel's debug section edits.
export const TUNNI_GIZMO_TUNING_DEFAULTS = {
  ...GIZMO_TUNING_DEFAULTS,
  onCurveRevealDelay: 450,
  onCurveHideDelay: 600,
  onCurveFadeDuration: 400,
};
export const TUNNI_GIZMO_TUNING = Object.assign(
  GIZMO_TUNING,
  TUNNI_GIZMO_TUNING_DEFAULTS
);

// Tunni's on-curve gizmos reveal a contour at a time, on slower timings than
// the shared ones: the cursor on any segment of a contour shows every on-curve
// gizmo on it. Everything else is the shared gizmo reveal.
export class TunniGizmoReveal extends GizmoReveal {
  constructor(requestUpdate) {
    super(requestUpdate);
    this._armedContour = null;
    this._pendingContour = null;
    this._contourTimer = null;
    this._contourHoveredThisPass = false;
  }

  beginHoverPass() {
    super.beginHoverPass();
    this._contourHoveredThisPass = false;
  }

  endHoverPass() {
    super.endHoverPass();
    if (!this._contourHoveredThisPass) {
      this.hoverContour(null);
    }
  }

  // The on-curve gizmos reveal a contour at a time: the cursor on any segment
  // of a contour shows every on-curve gizmo on it, on the on-curve timings.
  hoverContour(contourKey) {
    this._contourHoveredThisPass = true;
    if (contourKey === this._armedContour) {
      this._cancelPendingContour();
      return;
    }
    if (contourKey && contourKey === this._pendingContour) {
      return;
    }
    this._cancelPendingContour();
    if (this._armedContour) {
      this._tweenTo("contour", this._armedContour, 0, true);
      this._armedContour = null;
    }
    if (contourKey) {
      this._pendingContour = contourKey;
      this._contourTimer = setTimeout(() => {
        this._pendingContour = null;
        this._contourTimer = null;
        this._armedContour = contourKey;
        this._tweenTo("contour", contourKey, 1, true);
      }, TUNNI_GIZMO_TUNING.onCurveRevealDelay);
    }
  }

  isContourArmed(contourKey) {
    return !!contourKey && contourKey === this._armedContour;
  }

  _cancelPendingContour() {
    clearTimeout(this._contourTimer);
    this._contourTimer = null;
    this._pendingContour = null;
  }

  // An on-curve gizmo is shown by its contour, so here it only takes the hover
  // emphasis.
  hover(key, options = {}) {
    if (key && isOnCurveGizmoKey(key)) {
      super.hover(null);
      this._setHot(options.hot && this.isArmed(key) ? key : null);
      return;
    }
    super.hover(key, options);
  }

  isArmed(key) {
    if (key && isOnCurveGizmoKey(key)) {
      return this.isContourArmed(tunniGizmoContourKey(key));
    }
    return super.isArmed(key);
  }

  alpha(key, now = performance.now()) {
    return isOnCurveGizmoKey(key)
      ? this._value("contour", tunniGizmoContourKey(key), now)
      : super.alpha(key, now);
  }

  // An on-curve gizmo (`slow`) fades on its own timing and lingers first.
  _duration(channel, slow = false) {
    return slow && channel !== "hot"
      ? Math.max(TUNNI_GIZMO_TUNING.onCurveFadeDuration, 1)
      : super._duration(channel, slow);
  }

  _linger(slow) {
    return slow ? TUNNI_GIZMO_TUNING.onCurveHideDelay : 0;
  }
}
