import { Bezier } from "bezier-js";
import { fitCubic } from "./fit-cubic.js";
import {
  deleteFontraInternalSection,
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import {
  FONTRA_INTERNAL_KEY,
  FONTRA_INTERNAL_SECTIONS,
} from "./fontra-internal-schema.js";
import { getGlyphInfoFromGlyphName } from "./glyph-data.js";
import { buildHandleDomain } from "./natural-handle-solver.js";
import { offsetCubicSide } from "./offset-cubic.js";
import {
  areTensionsEqualized,
  calculateControlHandlePoint,
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoPoint,
  calculateEqualizedControlPoints,
  calculateOnCurvePointsFromTunni,
  calculateSegmentTension,
  calculateTunniPoint,
  harmonicMeanTension,
  hasForwardTangentIntersection,
} from "./tunni-calculations.js";
import { deepCopyObject, splitGlyphNameExtension } from "./utils.ts";
import { VarPackedPath } from "./var-path.js";
import {
  addVectors,
  distance,
  dotVector,
  mulVectorScalar,
  normalizeVector,
  rotateVector90CW,
  subVectors,
  vectorLength,
} from "./vector.js";

export const SKELETON_SCHEMA_VERSION = 1;
export const DEFAULT_SKELETON_WIDTH = 80;

// Mirrors MIN_HANDLE_LENGTH in offset-cubic.js: the shortest handle the
// generator will emit. The on-curve gizmo stops before driving a handle past it,
// because beyond that point the generator floors the length and the handle
// starts riding along with the rib end instead of holding still.
const MIN_GENERATED_HANDLE_LENGTH = 1;

// D1's ceiling of 1 is enforced where a person is choosing how far to drag, not
// on the way into storage. A nudged rib end slides along its tangent while its
// handle stays put, which shortens the reach, so an untouched segment can render
// above 1 without anyone having asked for it — and clamping that on storage
// would drag the curve back the moment the gizmo was grabbed.
//
// This is a data-sanity guard on a stored number, deliberately far above
// anything the drag can produce. It is not the design ceiling.
const MAX_STORED_SEGMENT_TENSION = 4;

const VALID_POINT_TYPES = new Set([null, "cubic"]);
const VALID_SINGLE_SIDED = new Set([null, "left", "right"]);
const VALID_CAP_STYLES = new Set(["butt", "round", "square", "drop", "serif"]);
const VALID_CAP_BALL_SIDES = new Set(["auto", "left", "right"]);
// A rib may be locked to an axis, overriding the normal the geometry computes.
// Named for the direction the RIB runs — which is what the designer sees, since
// a flat terminal is drawn along the rib — so "vertical" means the normal is the
// y axis. Independent of cap style: every style is built on the locked rib.
export const VALID_RIB_ANGLE_LOCKS = new Set([null, "horizontal", "vertical"]);
export const CAP_POINT_FIELDS = [
  "capRadiusRatio",
  "capTension",
  "capAngle",
  "capDistance",
  "capBallRatio",
  "capBallShape",
];
export const VALID_SERIF_AXIS_MODES = new Set([
  "perpendicular",
  "horizontal",
  "vertical",
  "absolute",
]);
export const VALID_SERIF_UNITS_MODES = new Set(["absolute", "normalized"]);

// One half-serif's shape. Absolute font units unless the source's serif units
// mode says otherwise; `tipCutAngle` is degrees and `tension`, `concavity` and
// `easeCurvature` are dimensionless in every mode.
export const SERIF_HALF_FIELDS = Object.freeze([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "tipCutAngle",
  "reach",
  "tension",
  "concavity",
  "easeDistance",
  "easeCurvature",
]);

// Shared by both halves of one terminal. The underside cup is deliberately NOT
// per half: the foot is one curve across the whole terminal, and one cup per
// half produces two scoops meeting at a break in the middle.
export const SERIF_TERMINAL_FIELDS = Object.freeze(["axisAngle", "undersideCup"]);
// An unset serif field is zero. Every one of them, with no exceptions: a serif
// that has never been shaped draws nothing, rather than carrying a bracket
// nobody asked for. The starting shape comes from the seed at the moment a
// terminal becomes a serif, not from a fallback under every read.
export const SERIF_HALF_ZEROS = Object.freeze(
  Object.fromEntries(SERIF_HALF_FIELDS.map((field) => [field, 0]))
);
// Corner rounding is the angle-point engine's parameter set — related to caps
// only in that both live on on-curve points
export const CORNER_POINT_FIELDS = [
  "cornerRoundness",
  "cornerReach",
  "roundnessStrength",
  "cornerAsymmetry",
];

export function makeEmptySkeletonData() {
  return {
    version: SKELETON_SCHEMA_VERSION,
    nextId: 1,
    contours: [],
    generated: [],
  };
}

export function parseSkeletonPointKey(key) {
  if (!key) {
    return null;
  }
  const parts = `${key}`.split("/");
  if (parts[0] === "skeletonPoint") {
    parts.shift();
  }
  if (parts.length !== 2) {
    return null;
  }
  const contourId = Number(parts[0]);
  const pointId = Number(parts[1]);
  if (!Number.isInteger(contourId) || !Number.isInteger(pointId)) {
    return null;
  }
  return { contourId, pointId };
}

export function getSkeletonContourAddress(skeletonData, contourId) {
  const contourIndex = (skeletonData?.contours || []).findIndex(
    (contour) => contour.id === contourId
  );
  if (contourIndex < 0) {
    return null;
  }
  return { contour: skeletonData.contours[contourIndex], contourIndex };
}

export function getSkeletonPointAddress(skeletonData, contourId, pointId) {
  const contourAddress = getSkeletonContourAddress(skeletonData, contourId);
  if (!contourAddress) {
    return null;
  }
  const pointIndex = (contourAddress.contour.points || []).findIndex(
    (point) => point.id === pointId
  );
  if (pointIndex < 0) {
    return null;
  }
  return {
    ...contourAddress,
    point: contourAddress.contour.points[pointIndex],
    pointIndex,
  };
}

export const SKELETON_SOURCE_DEFAULT_KEYS = Object.freeze({
  WIDTH_CAPITAL_BASE: "widthCapitalBase",
  WIDTH_CAPITAL_HORIZONTAL: "widthCapitalHorizontal",
  WIDTH_CAPITAL_CONTRAST: "widthCapitalContrast",
  WIDTH_CAPITAL_DISTRIBUTION: "widthCapitalDistribution",
  WIDTH_LOWERCASE_BASE: "widthLowercaseBase",
  WIDTH_LOWERCASE_HORIZONTAL: "widthLowercaseHorizontal",
  WIDTH_LOWERCASE_CONTRAST: "widthLowercaseContrast",
  WIDTH_LOWERCASE_DISTRIBUTION: "widthLowercaseDistribution",
  CAP_RADIUS_RATIO: "capRadiusRatio",
  CAP_TENSION: "capTension",
  CAP_ANGLE: "capAngle",
  CAP_DISTANCE: "capDistance",
  CUSTOM_WIDTHS_UPPERCASE: "customWidthsUppercase",
  CUSTOM_WIDTHS_LOWERCASE: "customWidthsLowercase",
  CUSTOM_CAP_SQUARE: "customCapSquare",
  CUSTOM_CAP_ROUNDED: "customCapRounded",
  SERIF_UNITS_MODE: "serifUnitsMode",
  SERIF_REMOVE_COLLAPSED: "serifRemoveCollapsedPoints",
  SERIF_NEW_WING_LENGTH: "serifNewWingLength",
  SERIF_NEW_TIP_THICKNESS: "serifNewTipThickness",
  SERIF_NEW_WING_SLOPE: "serifNewWingSlope",
  CUSTOM_SERIFS: "customSerifs",
});

export const SKELETON_SOURCE_DEFAULT_FALLBACKS = Object.freeze({
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE]: 60,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_HORIZONTAL]: 50,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_CONTRAST]: 40,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_DISTRIBUTION]: 0,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_BASE]: 60,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_HORIZONTAL]: 50,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_CONTRAST]: 40,
  [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_DISTRIBUTION]: 0,
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_RADIUS_RATIO]: 1 / 8,
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_TENSION]: 0.55,
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_ANGLE]: 0,
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_DISTANCE]: 0,
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_WIDTHS_UPPERCASE]: [],
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_WIDTHS_LOWERCASE]: [],
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_SQUARE]: [],
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_ROUNDED]: [],
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_UNITS_MODE]: "absolute",
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED]: false,
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_WING_LENGTH]: 20,
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_TIP_THICKNESS]: 20,
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_WING_SLOPE]: 20,
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS]: [],
});

const SKELETON_SOURCE_DEFAULT_KEY_PATHS = new Map([
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE,
    ["widthDefaults", "uppercase", "base"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_HORIZONTAL,
    ["widthDefaults", "uppercase", "horizontal"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_CONTRAST,
    ["widthDefaults", "uppercase", "contrast"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_DISTRIBUTION,
    ["widthDefaults", "uppercase", "distribution"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_BASE,
    ["widthDefaults", "lowercase", "base"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_HORIZONTAL,
    ["widthDefaults", "lowercase", "horizontal"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_CONTRAST,
    ["widthDefaults", "lowercase", "contrast"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_DISTRIBUTION,
    ["widthDefaults", "lowercase", "distribution"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.CAP_RADIUS_RATIO,
    ["capDefaults", "round", "radiusRatio"],
  ],
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_TENSION, ["capDefaults", "round", "tension"]],
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_ANGLE, ["capDefaults", "square", "angle"]],
  [SKELETON_SOURCE_DEFAULT_KEYS.CAP_DISTANCE, ["capDefaults", "square", "distance"]],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_WIDTHS_UPPERCASE,
    ["widthProfiles", "uppercase"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_WIDTHS_LOWERCASE,
    ["widthProfiles", "lowercase"],
  ],
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_SQUARE, ["capProfiles", "square"]],
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_ROUNDED, ["capProfiles", "round"]],
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_UNITS_MODE, ["serifDefaults", "unitsMode"]],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED,
    ["serifDefaults", "removeCollapsedPoints"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_WING_LENGTH,
    ["serifDefaults", "newWingLength"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_TIP_THICKNESS,
    ["serifDefaults", "newTipThickness"],
  ],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_WING_SLOPE,
    ["serifDefaults", "newWingSlope"],
  ],
  [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS, ["serifProfiles"]],
]);

function cloneSkeletonDefaultValue(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function ensureSkeletonDefaultsObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key]))
    parent[key] = {};
  return parent[key];
}

function ensureSkeletonDefaultsArray(parent, key) {
  if (!Array.isArray(parent[key])) parent[key] = [];
  return parent[key];
}

export function normalizeSkeletonSourceDefaults(rawDefaults) {
  const defaults = cloneSkeletonDefaultValue(rawDefaults) || {};
  const widthDefaults = ensureSkeletonDefaultsObject(defaults, "widthDefaults");
  ensureSkeletonDefaultsObject(widthDefaults, "uppercase");
  ensureSkeletonDefaultsObject(widthDefaults, "lowercase");
  const capDefaults = ensureSkeletonDefaultsObject(defaults, "capDefaults");
  ensureSkeletonDefaultsObject(capDefaults, "square");
  ensureSkeletonDefaultsObject(capDefaults, "round");
  const widthProfiles = ensureSkeletonDefaultsObject(defaults, "widthProfiles");
  ensureSkeletonDefaultsArray(widthProfiles, "uppercase");
  ensureSkeletonDefaultsArray(widthProfiles, "lowercase");
  const capProfiles = ensureSkeletonDefaultsObject(defaults, "capProfiles");
  ensureSkeletonDefaultsArray(capProfiles, "square");
  ensureSkeletonDefaultsArray(capProfiles, "round");
  // Both of these are properties of how the font is being worked on, not of any
  // one letter, which is why they sit at source level rather than per terminal.
  // Removing collapsed points forfeits cross-master interpolation for serifed
  // terminals, so it is off until a designer turns it on for production.
  const serifDefaults = ensureSkeletonDefaultsObject(defaults, "serifDefaults");
  serifDefaults.unitsMode = VALID_SERIF_UNITS_MODES.has(serifDefaults.unitsMode)
    ? serifDefaults.unitsMode
    : "absolute";
  serifDefaults.removeCollapsedPoints =
    serifDefaults.removeCollapsedPoints === true ||
    serifDefaults.removeCollapsedPoints === 1;
  return defaults;
}

function skeletonDefaultAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function setSkeletonDefaultAtPath(root, path, value) {
  let current = root;
  for (let i = 0; i < path.length - 1; i++)
    current = ensureSkeletonDefaultsObject(current, path[i]);
  current[path[path.length - 1]] = cloneSkeletonDefaultValue(value);
}

export function getSourceSkeletonDefaultsValue(source, key, fallback) {
  const path = SKELETON_SOURCE_DEFAULT_KEY_PATHS.get(key);
  if (!path) return fallback;
  const defaults = normalizeSkeletonSourceDefaults(
    getFontraInternalSection(source, FONTRA_INTERNAL_SECTIONS.SKELETON_DEFAULTS)
  );
  const value = skeletonDefaultAtPath(defaults, path);
  return value === undefined ? fallback : value;
}

export function setSourceSkeletonDefaultsValues(source, values) {
  if (!source || !values || typeof values !== "object") return false;
  const defaults = normalizeSkeletonSourceDefaults(
    getFontraInternalSection(source, FONTRA_INTERNAL_SECTIONS.SKELETON_DEFAULTS)
  );
  let hasKnownKeys = false;
  for (const [key, value] of Object.entries(values)) {
    const path = SKELETON_SOURCE_DEFAULT_KEY_PATHS.get(key);
    if (!path) continue;
    setSkeletonDefaultAtPath(defaults, path, value);
    hasKnownKeys = true;
  }
  if (!hasKnownKeys) return false;
  setFontraInternalSection(
    source,
    FONTRA_INTERNAL_SECTIONS.SKELETON_DEFAULTS,
    defaults
  );
  return true;
}

export function resolveEffectiveSourceSkeletonDefault(fontController, location, key) {
  const sourceId =
    fontController?.fontSourcesInstancer?.getSourceIdentifierForLocation(
      location || {}
    ) || fontController?.defaultSourceIdentifier;
  const source = sourceId ? fontController?.sources?.[sourceId] : null;
  const fallback = SKELETON_SOURCE_DEFAULT_FALLBACKS[key];
  return source ? getSourceSkeletonDefaultsValue(source, key, fallback) : fallback;
}

export function getSkeletonGlyphCase(glyphName) {
  if (!glyphName) return "uppercase";
  let info = getGlyphInfoFromGlyphName(glyphName);
  if (!info) {
    const [baseGlyphName] = splitGlyphNameExtension(glyphName);
    if (baseGlyphName && baseGlyphName !== glyphName)
      info = getGlyphInfoFromGlyphName(baseGlyphName);
  }
  return info?.case === "lower" ? "lowercase" : "uppercase";
}

export function getDefaultSkeletonWidthKeyForGlyphName(glyphName) {
  return getSkeletonGlyphCase(glyphName) === "lowercase"
    ? SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_BASE
    : SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE;
}

export function applyFixedRibDelta(
  originalSkeletonData,
  workingSkeletonData,
  selectedPointKeys,
  clickedPointKey,
  delta,
  { compress = false, scaleControlPoints = true, round = Math.round } = {}
) {
  const clicked = parseSkeletonPointKey(clickedPointKey);
  if (!clicked || !selectedPointKeys?.size) return false;
  const clickedAddress = getSkeletonPointAddress(
    originalSkeletonData,
    clicked.contourId,
    clicked.pointId
  );
  if (!clickedAddress || clickedAddress.point.type) return false;
  const clickedNormal = calculateNormalAtSkeletonPoint(
    clickedAddress.contour,
    clickedAddress.pointIndex
  );
  if (!(Math.hypot(clickedNormal.x, clickedNormal.y) > 1e-6)) return false;
  const projectedDelta = delta.x * clickedNormal.x + delta.y * clickedNormal.y;
  const selected = collectSelectedPointKeys(selectedPointKeys);
  let changed = false;
  for (const [contourId, pointIds] of selected) {
    const originalContourAddress = getSkeletonContourAddress(
      originalSkeletonData,
      contourId
    );
    const workingContourAddress = getSkeletonContourAddress(
      workingSkeletonData,
      contourId
    );
    if (!originalContourAddress || !workingContourAddress) continue;
    const originalContour = originalContourAddress.contour;
    const workingContour = workingContourAddress.contour;
    const anchorSide = getFixedRibAnchorSide(originalContour, projectedDelta, compress);
    // On a single-sided contour the skeleton IS one edge of the stroke, so it has
    // to hold still: the drag moves the other edge, which is the sum of the two
    // half-widths, and nothing else. Moving the centerline as well would drag the
    // flat edge off the skeleton it is defined to lie on.
    const singleSided =
      originalContour.singleSided === "left" || originalContour.singleSided === "right";
    const pointDeltas = new Map();
    // The same allowance again, as the signed distance each end actually travelled.
    // The handle construction needs it as a scalar per end, and it must be the
    // clamped one: handles scaled by the raw drag kept the shape moving after the
    // on-curves had stopped, which on a curved skeleton is the whole shape.
    const pointOffsets = new Map();
    const affected = expandToTiedRibGroups(originalContour, pointIds);
    const allowed = collectFixedRibAllowances(
      originalContour,
      affected,
      anchorSide,
      projectedDelta,
      singleSided
    );
    for (const pointId of affected) {
      const originalPointIndex = originalContour.points.findIndex(
        (point) => point.id === pointId
      );
      const originalPoint = originalContour.points[originalPointIndex];
      const workingPoint = workingContour.points?.[originalPointIndex];
      if (!originalPoint || !workingPoint || originalPoint.type) continue;
      // Each point travels only as far as its own rib can pay for. A point at the
      // floor stops narrowing AND stops moving - otherwise the drag carries on and
      // the edge that width was pinning walks away with it. Its neighbours are
      // unaffected and keep going until they reach the floor too, at which point
      // the drag has nothing left to move and stands still.
      const allowedDelta = allowed.has(pointId) ? allowed.get(pointId) : projectedDelta;
      if (!singleSided) {
        const normal = calculateNormalAtSkeletonPoint(
          originalContour,
          originalPointIndex
        );
        const pointDelta = {
          x: normal.x * allowedDelta,
          y: normal.y * allowedDelta,
        };
        pointDeltas.set(originalPointIndex, pointDelta);
        pointOffsets.set(originalPointIndex, allowedDelta);
        workingPoint.x = round(originalPoint.x + pointDelta.x);
        workingPoint.y = round(originalPoint.y + pointDelta.y);
      }
      applyFixedRibWidthDelta(
        workingPoint,
        originalPoint,
        originalContour.defaultWidth,
        anchorSide,
        allowedDelta,
        round,
        singleSided
      );
      changed = true;
    }
    if (scaleControlPoints && pointDeltas.size)
      offsetControlPointsWithFixedRibSegments(
        originalContour,
        workingContour,
        pointDeltas,
        pointOffsets,
        round
      );
  }
  return changed;
}

// A tension point — smooth with a single handle — has no direction of its own:
// the straight beside it sets one, which holds the ribs at both ends of that
// straight to a shared offset (SKELETON-FEATURE-MODEL §3.0). Dragging either end
// therefore has to carry the whole group, the same way a rib width drag pulls its
// tied group in, or the straight tilts out of the projection it is meant to keep.
function expandToTiedRibGroups(contour, pointIds) {
  const points = contour?.points || [];
  const isClosed = contour?.closed === true;
  const segments = buildSegmentsFromSkeletonPoints(points, isClosed);
  const groupByPoint = collectTiedRibGroups(
    segments,
    isClosed,
    ribTiedByDefault,
    collectSerifTerminals(segments, isClosed, contour?.capStyle)
  );
  if (!groupByPoint.size) return pointIds;
  const expanded = new Set(pointIds);
  for (const pointId of pointIds) {
    const point = points.find((candidate) => candidate.id === pointId);
    for (const member of groupByPoint.get(point) || []) {
      expanded.add(member.id);
    }
  }
  return expanded;
}

// Every moved on-curve travels the same distance along its own normal, so an
// affected segment is a constant-distance offset of itself — or a tapered one
// where only one of its ends moved. Both are what the outline generator already
// constructs, so the drag runs the same construction on the centerline: handle
// directions are preserved and their lengths scale by 1 + d·kappa.
//
// Displacing the handles by an interpolation of the two endpoint deltas instead
// shears the segment, because it can never lengthen a handle. On a quarter arc of
// radius 100 pushed out 20 units the middle of the curve came up 6 units short of
// its ends, which is the curvature loss the whole tool is supposed to avoid.
function offsetControlPointsWithFixedRibSegments(
  originalContour,
  workingContour,
  pointDeltas,
  pointOffsets,
  round
) {
  const points = originalContour.points || [];
  const onCurveIndices = points
    .map((point, index) => (point?.type ? null : index))
    .filter((index) => index !== null);
  const segmentCount = originalContour.closed
    ? onCurveIndices.length
    : onCurveIndices.length - 1;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const startIndex = onCurveIndices[segmentIndex];
    const endIndex = onCurveIndices[(segmentIndex + 1) % onCurveIndices.length];
    const startMoved = pointDeltas.has(startIndex);
    const endMoved = pointDeltas.has(endIndex);
    if (!startMoved && !endMoved) continue;
    const controlIndices = getControlPointIndicesBetween(
      points,
      startIndex,
      endIndex,
      originalContour.closed
    );
    if (!controlIndices.length) continue;
    if (
      controlIndices.length !== 2 ||
      !offsetFixedRibSegmentHandles(
        points,
        workingContour,
        startIndex,
        endIndex,
        controlIndices,
        startMoved ? pointOffsets.get(startIndex) || 0 : 0,
        endMoved ? pointOffsets.get(endIndex) || 0 : 0,
        round
      )
    ) {
      // A segment with a single handle has no second length to receive, and a
      // degenerate one has no direction to keep. Carry those along with the
      // endpoints instead, which at least holds their relative position.
      interpolateFixedRibSegmentHandles(
        points,
        workingContour,
        controlIndices,
        pointDeltas.get(startIndex),
        pointDeltas.get(endIndex),
        round
      );
    }
  }
}

function offsetFixedRibSegmentHandles(
  points,
  workingContour,
  startIndex,
  endIndex,
  controlIndices,
  d0,
  d3,
  round
) {
  const p0 = points[startIndex];
  const p3 = points[endIndex];
  const p1 = points[controlIndices[0]];
  const p2 = points[controlIndices[1]];
  const q0 = workingContour.points?.[startIndex];
  const q3 = workingContour.points?.[endIndex];
  const handle1 = workingContour.points?.[controlIndices[0]];
  const handle2 = workingContour.points?.[controlIndices[1]];
  if (!p0 || !p1 || !p2 || !p3 || !q0 || !q3 || !handle1 || !handle2) return false;
  const u0 = normalizeVector(subVectors(p1, p0));
  const u1 = normalizeVector(subVectors(p2, p3));
  if (!vectorLength(u0) || !vectorLength(u1)) return false;
  const { startLength, endLength } = offsetCubicSide({
    p0,
    p1,
    p2,
    p3,
    d0,
    d3,
    q0,
    q3,
    u0,
    u1,
  });
  handle1.x = round(q0.x + u0.x * startLength);
  handle1.y = round(q0.y + u0.y * startLength);
  handle2.x = round(q3.x + u1.x * endLength);
  handle2.y = round(q3.y + u1.y * endLength);
  return true;
}

function interpolateFixedRibSegmentHandles(
  points,
  workingContour,
  controlIndices,
  startDelta,
  endDelta,
  round
) {
  for (let i = 0; i < controlIndices.length; i++) {
    const controlIndex = controlIndices[i];
    const originalPoint = points[controlIndex];
    const workingPoint = workingContour.points?.[controlIndex];
    if (!originalPoint || !workingPoint) continue;
    const t = controlIndices.length === 1 ? 0.5 : i / (controlIndices.length - 1);
    workingPoint.x = round(
      originalPoint.x + interpolateDelta(startDelta?.x || 0, endDelta?.x || 0, t)
    );
    workingPoint.y = round(
      originalPoint.y + interpolateDelta(startDelta?.y || 0, endDelta?.y || 0, t)
    );
  }
}

function getControlPointIndicesBetween(points, startIndex, endIndex, closed) {
  const indices = [];
  let index = startIndex + 1;
  while (index !== endIndex) {
    if (index >= points.length) {
      if (!closed) break;
      index = 0;
      if (index === endIndex) break;
    }
    if (points[index]?.type) indices.push(index);
    index++;
  }
  return indices;
}

const interpolateDelta = (a, b, t) => a + (b - a) * t;

export function getSkeletonHandleEqualizeInfo(contour, pointIdOrIndex) {
  const points = contour?.points || [];
  const handleIndex = resolvePointIndex(contour, pointIdOrIndex);
  const handle = points[handleIndex];
  if (!handle?.type) return null;
  const previousIndex = getPreviousPointIndex(contour, handleIndex);
  const nextIndex = getNextPointIndex(contour, handleIndex);
  const previous = points[previousIndex];
  const next = points[nextIndex];
  let smoothIndex;
  let oppositeIndex;
  if (previous && !previous.type && previous.smooth) {
    smoothIndex = previousIndex;
    oppositeIndex = getNextPointIndex(contour, handleIndex);
  } else if (next && !next.type && next.smooth) {
    smoothIndex = nextIndex;
    oppositeIndex = getPreviousPointIndex(contour, handleIndex);
  } else return null;
  const smoothPoint = points[smoothIndex];
  const oppositePoint = points[oppositeIndex];
  if (!smoothPoint || !oppositePoint?.type) return null;
  return {
    smoothPointId: smoothPoint.id,
    oppositePointId: oppositePoint.id,
    smoothIndex,
    oppositeIndex,
  };
}

export function equalizeSkeletonHandleToPoint(
  contour,
  pointId,
  currentPoint,
  { constrain = false, round = Math.round } = {}
) {
  const handleIndex = resolvePointIndex(contour, pointId);
  const handle = contour?.points?.[handleIndex];
  const info = getSkeletonHandleEqualizeInfo(contour, handleIndex);
  if (!handle || !info) return false;
  const smooth = contour.points[info.smoothIndex];
  const vector = constrainVector(
    { x: currentPoint.x - smooth.x, y: currentPoint.y - smooth.y },
    constrain
  );
  handle.x = round(smooth.x + vector.x);
  handle.y = round(smooth.y + vector.y);
  const opposite = contour.points[info.oppositeIndex];
  opposite.x = round(smooth.x - vector.x);
  opposite.y = round(smooth.y - vector.y);
  return true;
}

export function equalizeSkeletonHandleFromDelta(
  contour,
  pointId,
  delta,
  { constrain = false, round = Math.round } = {}
) {
  const handleIndex = resolvePointIndex(contour, pointId);
  const handle = contour?.points?.[handleIndex];
  const info = getSkeletonHandleEqualizeInfo(contour, handleIndex);
  if (!handle || !info) return false;
  const movedPoint = { x: handle.x + delta.x, y: handle.y + delta.y };
  if (constrain)
    return equalizeSkeletonHandleToPoint(contour, handleIndex, movedPoint, {
      constrain,
      round,
    });
  const smooth = contour.points[info.smoothIndex];
  handle.x = round(movedPoint.x);
  handle.y = round(movedPoint.y);
  const draggedVector = { x: handle.x - smooth.x, y: handle.y - smooth.y };
  const draggedLength = vectorLength(draggedVector);
  const opposite = contour.points[info.oppositeIndex];
  const oppositeDirection = normalizeVector({
    x: opposite.x - smooth.x,
    y: opposite.y - smooth.y,
  });
  if (!vectorLength(oppositeDirection)) {
    opposite.x = round(smooth.x - draggedVector.x);
    opposite.y = round(smooth.y - draggedVector.y);
  } else {
    opposite.x = round(smooth.x + oppositeDirection.x * draggedLength);
    opposite.y = round(smooth.y + oppositeDirection.y * draggedLength);
  }
  return true;
}

export function equalizeEditableGeneratedHandleOffsets(
  point,
  side,
  role,
  delta,
  geometry,
  { round = Math.round } = {}
) {
  const oppositeRole = role === "in" ? "out" : "in";
  const { ribPos, draggedPos, oppositePos, draggedBase, oppositeBase } = geometry;
  if (!ribPos || !draggedPos || !oppositePos || !draggedBase || !oppositeBase)
    return false;
  let moved;
  if (geometry.draggedDetached === true)
    moved = { x: draggedPos.x + delta.x, y: draggedPos.y + delta.y };
  else {
    const draggedDirection = normalizeVector(
      geometry.draggedDirection || { x: 0, y: 0 }
    );
    if (!vectorLength(draggedDirection)) return false;
    const projected = dotVector(delta, draggedDirection);
    moved = {
      x: draggedPos.x + draggedDirection.x * projected,
      y: draggedPos.y + draggedDirection.y * projected,
    };
  }
  const length = vectorLength(subVectors(moved, ribPos));
  const oppositeDirection = normalizeVector(subVectors(oppositePos, ribPos));
  if (!vectorLength(oppositeDirection)) return false;
  const newOpposite = {
    x: ribPos.x + oppositeDirection.x * length,
    y: ribPos.y + oppositeDirection.y * length,
  };
  setSkeletonHandleOffset(point, side, role, {
    x: round(moved.x - draggedBase.x),
    y: round(moved.y - draggedBase.y),
    detached: geometry.draggedDetached === true,
  });
  setSkeletonHandleOffset(point, side, oppositeRole, {
    x: round(newOpposite.x - oppositeBase.x),
    y: round(newOpposite.y - oppositeBase.y),
    detached: geometry.oppositeDetached === true,
  });
  return true;
}

function resolvePointIndex(contour, pointIdOrIndex) {
  const points = contour?.points || [];
  if (
    Number.isInteger(pointIdOrIndex) &&
    pointIdOrIndex >= 0 &&
    pointIdOrIndex < points.length
  )
    return pointIdOrIndex;
  return points.findIndex((point) => point.id === pointIdOrIndex);
}
function getPreviousPointIndex(contour, pointIndex) {
  return pointIndex > 0
    ? pointIndex - 1
    : contour?.closed
      ? (contour.points || []).length - 1
      : -1;
}
function getNextPointIndex(contour, pointIndex) {
  return pointIndex < (contour?.points || []).length - 1
    ? pointIndex + 1
    : contour?.closed
      ? 0
      : -1;
}
function constrainVector(vector, constrain) {
  if (!constrain) return vector;
  const length = vectorLength(vector);
  if (!length) return vector;
  const angle = Math.atan2(vector.y, vector.x);
  const constrainedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: Math.cos(constrainedAngle) * length,
    y: Math.sin(constrainedAngle) * length,
  };
}
// The narrowest a rib may be driven: one unit of half-width either side of the
// centerline, so two units of stroke. Named once, because the fixed-rib drag reads
// it both to clamp a width and to decide when a point may no longer move.
const MIN_FIXED_RIB_HALF_WIDTH = 1;
const MIN_FIXED_RIB_TOTAL_WIDTH = 2 * MIN_FIXED_RIB_HALF_WIDTH;

// How much of the drag each affected point can pay for, in the drag's own projected
// units. Only a shrinking drag is bounded; growing has no ceiling here.
//
// Tied ribs share one offset by definition (feature model 3.0), so a tied group
// travels together and is held to whichever member reaches the floor first. Letting
// members clamp separately would pull the group apart at exactly the moment the
// coupling matters most.
function collectFixedRibAllowances(
  contour,
  pointIds,
  anchorSide,
  projectedDelta,
  singleSided
) {
  const allowances = new Map();
  const points = contour?.points || [];
  const towardTheDrag = anchorSide === "left" ? projectedDelta : -projectedDelta;
  const widthDelta = singleSided ? towardTheDrag : -towardTheDrag;
  if (widthDelta >= 0) {
    return allowances;
  }
  const farSide = anchorSide === "left" ? "right" : "left";
  const roomFor = (point) => {
    if (singleSided) {
      return Math.max(
        0,
        getSkeletonPointWidth(point, contour?.defaultWidth) - MIN_FIXED_RIB_TOTAL_WIDTH
      );
    }
    // A fixed-rib drag moves BOTH sides by the same amount, so the far side can
    // reach the floor before the anchor does - and when it does the drag is
    // finished, because that edge is already down on the skeleton. Without this
    // the far side pinned at zero while the drag carried on compressing the
    // anchor alone.
    const sides = [anchorSide, farSide];
    return Math.max(
      0,
      Math.min(
        ...sides.map(
          (side) =>
            getSkeletonPointHalfWidth(point, contour?.defaultWidth, side) -
            MIN_FIXED_RIB_HALF_WIDTH
        )
      )
    );
  };
  for (const pointId of pointIds) {
    const point = points.find((candidate) => candidate.id === pointId);
    if (!point || point.type) continue;
    const group = getTiedRibGroup(contour, point) || [point];
    const room = Math.min(...group.map(roomFor));
    const magnitude = Math.min(Math.abs(projectedDelta), room);
    allowances.set(pointId, Math.sign(projectedDelta) * magnitude);
  }
  return allowances;
}

function applyFixedRibWidthDelta(
  workingPoint,
  originalPoint,
  defaultWidth,
  anchorSide,
  projectedDelta,
  round,
  singleSided = false
) {
  const linked = originalPoint.width?.linked !== false;
  // Double-sided: the centerline has already moved by the drag, and this pins one
  // outline edge by taking the same amount back out of its half-width. Single-
  // sided: the centerline held still, so the sign flips - the width alone has to
  // carry the edge to the cursor.
  const towardTheDrag = anchorSide === "left" ? projectedDelta : -projectedDelta;
  const widthDelta = singleSided ? towardTheDrag : -towardTheDrag;
  if (singleSided) {
    // Single-sided renders the SUM of the two half-widths on its visible side, so
    // the drag owns the total and the split between the two sides is none of its
    // business. That split is the distribution the point returns to when the
    // contour goes back to double-sided, and a drag that rewrote it would be
    // changing a shape the designer cannot see while they work. Writing the total
    // preserves it by construction - and it also puts the floor on the width they
    // can see rather than on one side of it, which is what let the visible edge
    // stop a whole far-side width away from the skeleton.
    setSkeletonPointTotalWidth(
      workingPoint,
      defaultWidth,
      Math.max(
        MIN_FIXED_RIB_TOTAL_WIDTH,
        getSkeletonPointWidth(originalPoint, defaultWidth) + widthDelta
      ),
      { round }
    );
    workingPoint.width.linked = linked;
    return;
  }
  const originalHalfWidth = getSkeletonPointHalfWidth(
    originalPoint,
    defaultWidth,
    anchorSide
  );
  setSkeletonPointSideWidth(
    workingPoint,
    defaultWidth,
    anchorSide,
    Math.max(MIN_FIXED_RIB_HALF_WIDTH, originalHalfWidth + widthDelta),
    // Both sides always move by the same amount here, whatever the point's own
    // width link says. The drag holds one edge while the skeleton point follows
    // the cursor, and that is a statement about the two edges, not about how the
    // designer chose to type widths in. Taking it out of the anchor side alone
    // instead - which is what the link flag used to do - leaves the point
    // lopsided, and on a selection where only some points are linked it leaves
    // half of them lopsided and the other half not, which is what turns the
    // panel's per-side and distribution readouts to mixed after one drag.
    { linked: true, round }
  );
  // The link flag is the designer's, not the drag's, so put it back.
  workingPoint.width.linked = linked;
}
function getFixedRibAnchorSide(contour, projectedDelta, compress) {
  if (contour.singleSided === "left" || contour.singleSided === "right")
    return contour.singleSided;
  if (compress) return projectedDelta >= 0 ? "left" : "right";
  return projectedDelta >= 0 ? "right" : "left";
}
function collectSelectedPointKeys(selectedPointKeys) {
  const selected = new Map();
  for (const key of selectedPointKeys) {
    const parsed = parseSkeletonPointKey(key);
    if (!parsed) continue;
    if (!selected.has(parsed.contourId)) selected.set(parsed.contourId, new Set());
    selected.get(parsed.contourId).add(parsed.pointId);
  }
  return selected;
}

export function buildSkeletonTunniSegments(contour) {
  const points = contour?.points || [];
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i]?.type) {
      onCurveIndices.push(i);
    }
  }
  if (onCurveIndices.length < 2) {
    return [];
  }

  const segments = [];
  for (let i = 0; i < onCurveIndices.length - 1; i++) {
    segments.push(
      makeSkeletonTunniSegment(contour, onCurveIndices[i], onCurveIndices[i + 1])
    );
  }
  if (contour?.closed) {
    segments.push(
      makeSkeletonTunniSegment(
        contour,
        onCurveIndices[onCurveIndices.length - 1],
        onCurveIndices[0]
      )
    );
  }
  return segments.map((segment, segmentIndex) => ({ ...segment, segmentIndex }));
}

export function segmentToTunniPoints(segment) {
  if (!segment?.controlPoints || segment.controlPoints.length !== 2) {
    return null;
  }
  return [
    segment.startPoint,
    segment.controlPoints[0],
    segment.controlPoints[1],
    segment.endPoint,
  ];
}

export function calculateSkeletonTunniPoint(segment) {
  const points = segmentToTunniPoints(segment);
  return points ? calculateControlHandlePoint(points) : null;
}

export function calculateSkeletonTrueTunniPoint(segment) {
  const points = segmentToTunniPoints(segment);
  return points ? (calculateTunniPoint(points) ?? null) : null;
}

export function calculateSkeletonControlPointsFromTunniDelta(
  delta,
  segment,
  preserveTensions = true
) {
  const points = segmentToTunniPoints(segment);
  if (!points) {
    return null;
  }
  const [startPoint, controlPoint1, controlPoint2, endPoint] = points;
  const direction1 = normalizeVector(subVectors(controlPoint1, startPoint));
  const direction2 = normalizeVector(subVectors(controlPoint2, endPoint));

  const averageDirection = normalizeVector(addVectors(direction1, direction2));
  const projection = dotVector(delta, averageDirection);

  if (preserveTensions) {
    const trueTunniPoint = calculateSkeletonTrueTunniPoint(segment);
    if (trueTunniPoint) {
      const startDistance = distance(startPoint, trueTunniPoint);
      const endDistance = distance(endPoint, trueTunniPoint);
      if (startDistance > 0 && endDistance > 0) {
        const scale = (2 * projection) / (startDistance + endDistance);
        return [
          addProjected(controlPoint1, direction1, scale * startDistance),
          addProjected(controlPoint2, direction2, scale * endDistance),
        ];
      }
    }
    return [
      addProjected(controlPoint1, direction1, projection),
      addProjected(controlPoint2, direction2, projection),
    ];
  }

  return [
    addProjected(controlPoint1, direction1, dotVector(delta, direction1)),
    addProjected(controlPoint2, direction2, dotVector(delta, direction2)),
  ];
}

export function calculateSkeletonOnCurveFromTunni(
  nextTrueTunniPoint,
  segment,
  equalizeDistances = true
) {
  const points = segmentToTunniPoints(segment);
  if (!points) {
    return null;
  }
  const [startPoint, controlPoint1, controlPoint2, endPoint] = points;
  const originalTrueTunniPoint = calculateSkeletonTrueTunniPoint(segment);
  if (!originalTrueTunniPoint) {
    return null;
  }

  const direction1 = normalizeVector(subVectors(controlPoint1, startPoint));
  const direction2 = normalizeVector(subVectors(controlPoint2, endPoint));
  const delta = subVectors(nextTrueTunniPoint, originalTrueTunniPoint);
  const projection1 = dotVector(delta, direction1);
  const projection2 = dotVector(delta, direction2);
  const finalProjection = equalizeDistances ? (projection1 + projection2) / 2 : null;

  return [
    addProjected(startPoint, direction1, finalProjection ?? projection1),
    addProjected(endPoint, direction2, finalProjection ?? projection2),
  ];
}

export function calculateSkeletonEqualizedControlPoints(segment) {
  const points = segmentToTunniPoints(segment);
  return points ? calculateEqualizedControlPoints(points) : null;
}

export function areSkeletonTensionsEqualized(segment, tolerance = 0.01) {
  const points = segmentToTunniPoints(segment);
  return points ? areTensionsEqualized(points, tolerance) : true;
}

export function skeletonTunniHitTest(point, size, skeletonData, options = {}) {
  if (!skeletonData?.contours?.length) {
    return null;
  }
  const { midpointOnly = false, includeTrueTunni = true } = options;

  for (
    let contourIndex = skeletonData.contours.length - 1;
    contourIndex >= 0;
    contourIndex--
  ) {
    const contour = skeletonData.contours[contourIndex];
    const segments = buildSkeletonTunniSegments(contour);
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      if (segment.controlPoints.length !== 2) {
        continue;
      }
      if (!midpointOnly && includeTrueTunni) {
        const trueTunniPoint = calculateSkeletonTrueTunniPoint(segment);
        if (trueTunniPoint && distance(point, trueTunniPoint) <= size) {
          return {
            type: "true-tunni",
            contourId: contour.id,
            contourIndex,
            segmentIndex: segment.segmentIndex,
            segment,
            tunniPoint: trueTunniPoint,
          };
        }
      }

      const tunniPoint = calculateSkeletonTunniPoint(segment);
      if (tunniPoint && distance(point, tunniPoint) <= size) {
        return {
          type: "tunni",
          contourId: contour.id,
          contourIndex,
          segmentIndex: segment.segmentIndex,
          segment,
          tunniPoint,
        };
      }
    }
  }
  return null;
}

function makeSkeletonTunniSegment(contour, startIndex, endIndex) {
  const points = contour.points || [];
  const controlEntries =
    startIndex < endIndex
      ? collectControlEntries(points, startIndex + 1, endIndex)
      : [
          ...collectControlEntries(points, startIndex + 1, points.length),
          ...collectControlEntries(points, 0, endIndex),
        ];
  return {
    contourId: contour.id,
    startPoint: points[startIndex],
    endPoint: points[endIndex],
    controlPoints: controlEntries.map((entry) => entry.point),
    startPointId: points[startIndex]?.id,
    endPointId: points[endIndex]?.id,
    controlPointIds: controlEntries.map((entry) => entry.point.id),
    startIndex,
    endIndex,
    controlIndices: controlEntries.map((entry) => entry.index),
  };
}

function collectControlEntries(points, startIndex, endIndex) {
  const entries = [];
  for (let i = startIndex; i < endIndex; i++) {
    if (points[i]?.type === "cubic") {
      entries.push({ point: points[i], index: i });
    }
  }
  return entries;
}

function addProjected(point, direction, projection) {
  const offset = mulVectorScalar(direction, projection);
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
  };
}

export function makeSkeletonContour(data = {}, skeletonData = null) {
  return normalizeSkeletonContour(
    {
      id: allocateSkeletonId(skeletonData, data.id),
      closed: false,
      defaultWidth: DEFAULT_SKELETON_WIDTH,
      singleSided: null,
      points: [],
      ...data,
    },
    skeletonData
  );
}

export function makeSkeletonPoint(data = {}, skeletonData = null) {
  return normalizeSkeletonPoint(
    {
      id: allocateSkeletonId(skeletonData, data.id),
      x: 0,
      y: 0,
      type: null,
      smooth: false,
      ...data,
    },
    skeletonData
  );
}

export function normalizeSkeletonData(data) {
  const normalized = makeEmptySkeletonData();
  const usedIds = new Set();

  for (const contour of Array.isArray(data?.contours) ? data.contours : []) {
    normalized.contours.push(normalizeSkeletonContour(contour, normalized, usedIds));
  }

  normalized.generated = Array.isArray(data?.generated)
    ? data.generated.map((entry) => ({
        skeletonContourId: asInteger(entry?.skeletonContourId, null),
        pathContourIndex: asInteger(entry?.pathContourIndex, null),
        pointMap: Array.isArray(entry?.pointMap) ? deepCopyObject(entry.pointMap) : [],
      }))
    : [];

  normalized.nextId = Math.max(
    asInteger(data?.nextId, 1),
    maxUsedId(usedIds) + 1,
    normalized.nextId
  );
  normalized.version = SKELETON_SCHEMA_VERSION;
  return normalized;
}

export function normalizeSkeletonContour(contour, skeletonData = null, usedIds = null) {
  const id = normalizeId(contour?.id, skeletonData, usedIds);
  const normalized = {
    id,
    closed: contour?.closed === true,
    defaultWidth: asNonNegativeNumber(contour?.defaultWidth, DEFAULT_SKELETON_WIDTH),
    singleSided: VALID_SINGLE_SIDED.has(contour?.singleSided)
      ? contour.singleSided
      : null,
    capStyle: VALID_CAP_STYLES.has(contour?.capStyle) ? contour.capStyle : "butt",
    reversed: contour?.reversed === true,
    points: [],
  };
  if (VALID_CAP_BALL_SIDES.has(contour?.capBallSide)) {
    normalized.capBallSide = contour.capBallSide;
  }
  if (Number.isFinite(contour?.cornerTrimRatio)) {
    normalized.cornerTrimRatio = contour.cornerTrimRatio;
  }
  if (Number.isFinite(contour?.cornerRadiusBoost)) {
    normalized.cornerRadiusBoost = contour.cornerRadiusBoost;
  }
  for (const point of Array.isArray(contour?.points) ? contour.points : []) {
    normalized.points.push(normalizeSkeletonPoint(point, skeletonData, usedIds));
  }
  return normalized;
}

export function normalizeSkeletonPoint(point, skeletonData = null, usedIds = null) {
  const type = VALID_POINT_TYPES.has(point?.type) ? point.type : null;
  const normalized = {
    id: normalizeId(point?.id, skeletonData, usedIds),
    x: asFiniteNumber(point?.x, 0),
    y: asFiniteNumber(point?.y, 0),
    type,
    smooth: point?.smooth === true,
  };

  if (!type) {
    normalized.width = normalizeWidth(point?.width);
    normalized.nudge = normalizeNudge(point?.nudge);
    normalized.handleNudge = normalizeNudge(point?.handleNudge);
    normalized.segmentCurvature = normalizeSegmentCurvature(point?.segmentCurvature);
    normalized.locked = normalizeLocked(point?.locked);
    normalized.handleOffsets = normalizeHandleOffsets(point?.handleOffsets);
    normalized.serif = normalizeSerif(point?.serif);
    normalized.capStyle = VALID_CAP_STYLES.has(point?.capStyle) ? point.capStyle : null;
    normalized.capBallSide = VALID_CAP_BALL_SIDES.has(point?.capBallSide)
      ? point.capBallSide
      : null;
    normalized.ribAngleLock = VALID_RIB_ANGLE_LOCKS.has(point?.ribAngleLock)
      ? (point.ribAngleLock ?? null)
      : null;
    for (const field of [...CAP_POINT_FIELDS, ...CORNER_POINT_FIELDS]) {
      if (Number.isFinite(point?.[field])) {
        normalized[field] = point[field];
      }
    }
  }

  return normalized;
}

export function getSkeletonContour(skeletonData, contourId) {
  return skeletonData?.contours?.find((contour) => contour.id === contourId) ?? null;
}

export function getSkeletonPoint(skeletonData, contourId, pointId) {
  const contour = getSkeletonContour(skeletonData, contourId);
  return contour?.points?.find((point) => point.id === pointId) ?? null;
}

export function appendSkeletonContour(skeletonData, contourData = {}) {
  if (!skeletonData) {
    return null;
  }
  const contour = makeSkeletonContour(contourData, skeletonData);
  skeletonData.contours.push(contour);
  return contour;
}

export function appendSkeletonPoint(skeletonData, contourId, pointData = {}) {
  const contour = getSkeletonContour(skeletonData, contourId);
  if (!contour) {
    return null;
  }
  const point = makeSkeletonPoint(pointData, skeletonData);
  contour.points.push(point);
  return point;
}

export function updateSkeletonPoint(skeletonData, contourId, pointId, patch) {
  const contour = getSkeletonContour(skeletonData, contourId);
  if (!contour) {
    return null;
  }
  const pointIndex = contour.points.findIndex((point) => point.id === pointId);
  if (pointIndex < 0) {
    return null;
  }
  const updatedPoint = normalizeSkeletonPoint({
    ...contour.points[pointIndex],
    ...patch,
    id: pointId,
  });
  contour.points[pointIndex] = updatedPoint;
  return updatedPoint;
}

// ---- Shape-preserving multi-point deletion ----
// Ported from the donor's deleteSkeletonPoints (path-functions.js), adapted to
// this model: id-addressed points, `closed` flag, cubic-only off-curves, and
// fork-specific cap/corner fields. Deleting an on-curve consumes its adjacent
// handle runs and refits the bridging segment against the original geometry;
// deleting an off-curve removes its paired handle; contours left without
// on-curves are removed entirely.

export function deleteSkeletonPoints(skeletonData, pointRefs) {
  if (!skeletonData?.contours) {
    return false;
  }

  // Resolve [contourId, pointId] pairs into per-contour index sets
  const indicesByContour = new Map();
  for (const [contourId, pointId] of pointRefs || []) {
    const contour = getSkeletonContour(skeletonData, contourId);
    if (!contour) {
      continue;
    }
    const pointIndex = contour.points.findIndex((point) => point.id === pointId);
    if (pointIndex < 0) {
      continue;
    }
    if (!indicesByContour.has(contourId)) {
      indicesByContour.set(contourId, new Set());
    }
    indicesByContour.get(contourId).add(pointIndex);
  }
  if (!indicesByContour.size) {
    return false;
  }

  const contourIdsToRemove = [];
  for (const [contourId, selectedIndices] of indicesByContour) {
    const contour = getSkeletonContour(skeletonData, contourId);
    const deleteSet = expandSkeletonDeleteSet(contour, selectedIndices);

    let inheritFirstCap = null;
    let inheritLastCap = null;
    if (!contour.closed) {
      const firstOnCurve = findEndpointOnCurveIndex(contour.points, false);
      const lastOnCurve = findEndpointOnCurveIndex(contour.points, true);
      if (firstOnCurve !== null && deleteSet.has(firstOnCurve)) {
        inheritFirstCap = contour.points[firstOnCurve];
      }
      if (lastOnCurve !== null && deleteSet.has(lastOnCurve)) {
        inheritLastCap = contour.points[lastOnCurve];
      }
    }

    const newPoints = rebuildSkeletonContourPoints(
      contour.points,
      deleteSet,
      contour.closed,
      skeletonData
    );

    if (!contour.closed && newPoints.length) {
      const newFirst = findEndpointOnCurveIndex(newPoints, false);
      const newLast = findEndpointOnCurveIndex(newPoints, true);
      if (newFirst !== null && newLast !== null) {
        if (newFirst === newLast) {
          const source = inheritLastCap || inheritFirstCap;
          if (source) {
            copySkeletonCapData(source, newPoints[newFirst]);
          }
        } else {
          if (inheritFirstCap) {
            copySkeletonCapData(inheritFirstCap, newPoints[newFirst]);
          }
          if (inheritLastCap) {
            copySkeletonCapData(inheritLastCap, newPoints[newLast]);
          }
        }
      }
    }

    if (!newPoints.some((point) => !point.type)) {
      contourIdsToRemove.push(contourId);
    } else {
      contour.points = newPoints;
    }
  }

  for (const contourId of contourIdsToRemove) {
    const contourIndex = skeletonData.contours.findIndex(
      (contour) => contour.id === contourId
    );
    if (contourIndex >= 0) {
      skeletonData.contours.splice(contourIndex, 1);
    }
  }

  return true;
}

function findEndpointOnCurveIndex(points, useEnd) {
  if (!points?.length) {
    return null;
  }
  if (useEnd) {
    for (let i = points.length - 1; i >= 0; i--) {
      if (!points[i].type) {
        return i;
      }
    }
    return null;
  }
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      return i;
    }
  }
  return null;
}

function copySkeletonCapData(sourcePoint, targetPoint) {
  if (!sourcePoint || !targetPoint || targetPoint.type) {
    return;
  }
  targetPoint.capStyle = sourcePoint.capStyle ?? null;
  targetPoint.capBallSide = sourcePoint.capBallSide ?? null;
  // The lock describes the terminal, not the point, so it moves with the cap
  // when the terminal does (donor parity: it travelled in the same key list).
  targetPoint.ribAngleLock = sourcePoint.ribAngleLock ?? null;
  for (const field of CAP_POINT_FIELDS) {
    if (Number.isFinite(sourcePoint[field])) {
      targetPoint[field] = sourcePoint[field];
    } else {
      delete targetPoint[field];
    }
  }
}

// Expand a set of selected point indices: an on-curve pulls in its adjacent
// off-curve runs on both sides; an off-curve pulls in its paired handle.
function expandSkeletonDeleteSet(contour, selectedIndices) {
  const points = contour.points;
  const numPoints = points.length;
  const isClosed = contour.closed;
  const expanded = new Set(selectedIndices);

  for (const pointIndex of selectedIndices) {
    const point = points[pointIndex];
    if (!point) {
      continue;
    }

    if (!point.type) {
      // Backward off-curve run
      for (let i = 1; i < numPoints; i++) {
        const idx = (pointIndex - i + numPoints) % numPoints;
        if (!isClosed && idx > pointIndex) {
          break;
        }
        if (points[idx].type) {
          expanded.add(idx);
        } else {
          break;
        }
      }
      // Forward off-curve run
      for (let i = 1; i < numPoints; i++) {
        const idx = (pointIndex + i) % numPoints;
        if (!isClosed && idx < pointIndex) {
          break;
        }
        if (points[idx].type) {
          expanded.add(idx);
        } else {
          break;
        }
      }
      continue;
    }

    // Off-curve: include the paired handle of the same segment
    const prevIdx = (pointIndex - 1 + numPoints) % numPoints;
    const nextIdx = (pointIndex + 1) % numPoints;
    const prevPoint = points[prevIdx];
    const nextPoint = points[nextIdx];
    if (!prevPoint?.type && nextPoint?.type) {
      expanded.add(nextIdx);
    } else if (prevPoint?.type && !nextPoint?.type) {
      expanded.add(prevIdx);
    }
  }

  return expanded;
}

function rebuildSkeletonContourPoints(points, deleteSet, isClosed, skeletonData) {
  const numPoints = points.length;

  const deletedOnCurves = new Set();
  for (const idx of deleteSet) {
    if (!points[idx]?.type) {
      deletedOnCurves.add(idx);
    }
  }

  const newPoints = [];
  const processedSegments = new Set();

  for (let i = 0; i < numPoints; i++) {
    const point = points[i];

    if (!deleteSet.has(i)) {
      newPoints.push(point);
      continue;
    }
    if (point.type) {
      continue;
    }

    // Deleted on-curve: refit the bridge between the surviving neighbors,
    // sampling the ORIGINAL geometry through the deleted point.
    const prevOnCurve = findSurvivingOnCurve(points, i, deletedOnCurves, isClosed, -1);
    const nextOnCurve = findSurvivingOnCurve(points, i, deletedOnCurves, isClosed, +1);
    const segmentKey = `${prevOnCurve}-${nextOnCurve}`;
    if (processedSegments.has(segmentKey)) {
      continue;
    }
    processedSegments.add(segmentKey);

    if (prevOnCurve !== null && nextOnCurve !== null) {
      const handles = computeHandlesForSkeletonSegment(
        points,
        prevOnCurve,
        nextOnCurve,
        skeletonData
      );
      if (handles?.length) {
        const prevIdx = newPoints.findIndex(
          (candidate) => candidate.id === points[prevOnCurve].id
        );
        if (prevIdx >= 0) {
          newPoints.splice(prevIdx + 1, 0, ...handles);
        }
      }
    }
  }

  fixSkeletonSmoothFlags(newPoints, isClosed);
  return newPoints;
}

function findSurvivingOnCurve(points, startIdx, deletedOnCurves, isClosed, direction) {
  const numPoints = points.length;
  for (let j = 1; j < numPoints; j++) {
    const idx = (startIdx + direction * j + numPoints * j) % numPoints;
    if (!isClosed && (direction < 0 ? idx > startIdx : idx < startIdx)) {
      return null;
    }
    if (!points[idx].type && !deletedOnCurves.has(idx)) {
      return idx;
    }
  }
  return null;
}

// A surviving on-curve can only stay smooth with at least one adjacent handle
function fixSkeletonSmoothFlags(points, isClosed) {
  const numPoints = points.length;
  if (numPoints < 2) {
    return;
  }
  for (let i = 0; i < numPoints; i++) {
    const point = points[i];
    if (point.type || !point.smooth) {
      continue;
    }
    if (!isClosed && (i === 0 || i === numPoints - 1)) {
      point.smooth = false;
      continue;
    }
    const prevPoint = points[(i - 1 + numPoints) % numPoints];
    const nextPoint = points[(i + 1) % numPoints];
    if (!prevPoint?.type && !nextPoint?.type) {
      point.smooth = false;
    }
  }
}

function computeHandlesForSkeletonSegment(points, prevIdx, nextIdx, skeletonData) {
  const segment = collectSkeletonSegmentPoints(points, prevIdx, nextIdx);
  if (segment.length < 2) {
    return null;
  }
  // Pure line run between the survivors: no handles needed
  if (segment.length === 2 || !segment.slice(1, -1).some((point) => point.type)) {
    return [];
  }

  const samples = sampleSkeletonCurve(segment);
  if (samples.length < 2) {
    return null;
  }
  const leftTangent = getSkeletonEndTangent(segment, true);
  const rightTangent = getSkeletonEndTangent(segment, false);
  const bezier = fitCubic(samples, leftTangent, rightTangent, 0.1);
  if (!bezier || bezier.points.length !== 4) {
    return null;
  }
  return [
    makeSkeletonPoint(
      { x: bezier.points[1].x, y: bezier.points[1].y, type: "cubic" },
      skeletonData
    ),
    makeSkeletonPoint(
      { x: bezier.points[2].x, y: bezier.points[2].y, type: "cubic" },
      skeletonData
    ),
  ];
}

function collectSkeletonSegmentPoints(points, prevIdx, nextIdx) {
  const numPoints = points.length;
  const segment = [];
  let idx = prevIdx;
  while (true) {
    segment.push(points[idx]);
    if (idx === nextIdx) {
      break;
    }
    idx = (idx + 1) % numPoints;
    if (segment.length > numPoints) {
      break; // safety against malformed input
    }
  }
  return segment;
}

function sampleSkeletonCurve(segment) {
  const samples = [{ x: segment[0].x, y: segment[0].y }];

  let i = 0;
  while (i < segment.length - 1) {
    const startPt = segment[i];
    let j = i + 1;
    while (j < segment.length && segment[j].type) {
      j++;
    }
    if (j >= segment.length) {
      break;
    }
    const endPt = segment[j];
    const handles = segment.slice(i + 1, j);

    if (handles.length === 0) {
      for (const t of [0.25, 0.5, 0.75]) {
        samples.push({
          x: startPt.x + (endPt.x - startPt.x) * t,
          y: startPt.y + (endPt.y - startPt.y) * t,
        });
      }
      samples.push({ x: endPt.x, y: endPt.y });
    } else {
      const bez =
        handles.length === 1
          ? new Bezier(
              startPt.x,
              startPt.y,
              handles[0].x,
              handles[0].y,
              endPt.x,
              endPt.y
            )
          : new Bezier(
              startPt.x,
              startPt.y,
              handles[0].x,
              handles[0].y,
              handles[handles.length - 1].x,
              handles[handles.length - 1].y,
              endPt.x,
              endPt.y
            );
      for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
        const pt = bez.compute(t);
        samples.push({ x: pt.x, y: pt.y });
      }
      samples.push({ x: endPt.x, y: endPt.y });
    }

    i = j;
  }

  return samples;
}

function getSkeletonEndTangent(segment, isStart) {
  if (segment.length < 2) {
    return { x: 1, y: 0 };
  }
  let from, to;
  if (isStart) {
    from = segment[0];
    to = segment[1];
  } else {
    from = segment[segment.length - 1];
    to = segment[segment.length - 2];
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-10) {
    return { x: 1, y: 0 };
  }
  return { x: dx / len, y: dy / len };
}

// Path contour indices currently occupied by generated skeleton contours.
// Generated geometry is derived data: interaction surfaces (point selection,
// Tunni, segment hits) must not treat it as regular path geometry.
export function getGeneratedPathContourIndices(skeletonData) {
  const indices = new Set();
  for (const entry of skeletonData?.generated || []) {
    if (Number.isInteger(entry.pathContourIndex) && entry.pathContourIndex >= 0) {
      indices.add(entry.pathContourIndex);
    }
  }
  return indices;
}

export function getSkeletonPointHalfWidth(point, defaultWidth, side) {
  const width = normalizeWidth(point?.width);
  if (side === "left") {
    return width.left;
  }
  if (side === "right") {
    return width.right;
  }
  return asNonNegativeNumber(defaultWidth, DEFAULT_SKELETON_WIDTH) / 2;
}

export function getSkeletonPointWidth(point, defaultWidth, side = null) {
  if (side === "left") {
    return getSkeletonPointHalfWidth(point, defaultWidth, "left") * 2;
  }
  if (side === "right") {
    return getSkeletonPointHalfWidth(point, defaultWidth, "right") * 2;
  }
  return (
    getSkeletonPointHalfWidth(point, defaultWidth, "left") +
    getSkeletonPointHalfWidth(point, defaultWidth, "right")
  );
}

export function getSkeletonPointNudge(
  point,
  side,
  defaultWidth = DEFAULT_SKELETON_WIDTH
) {
  if (isSkeletonSideLocked(point, side)) {
    return 0;
  }
  if (getSkeletonPointHalfWidth(point, defaultWidth, side) < 0.5) {
    return 0;
  }
  return normalizeNudge(point?.nudge)[side];
}

export function setSkeletonPointSideWidth(
  point,
  defaultWidth,
  side,
  halfWidth,
  { linked = point?.width?.linked !== false, round = Math.round } = {}
) {
  assertSkeletonRibSide(side);
  const width = normalizeWidth(point?.width);
  const value = Math.max(0, round(halfWidth));
  const otherSide = side === "left" ? "right" : "left";
  if (linked) {
    // Linked means both sides move by the same delta, preserving the
    // left/right distribution — it does NOT mean symmetrical (donor parity).
    width[otherSide] = Math.max(0, round(width[otherSide] + value - width[side]));
  }
  width[side] = value;
  width.linked = linked;
  point.width = width;
}

export function setSkeletonPointSideNudge(
  point,
  side,
  nudge,
  { round = Math.round } = {}
) {
  assertSkeletonRibSide(side);
  const normalizedNudge = normalizeNudge(point?.nudge);
  normalizedNudge[side] = round(asFiniteNumber(nudge, 0));
  point.nudge = normalizedNudge;
}

export function getSkeletonPointHandleNudge(point, side) {
  assertSkeletonRibSide(side);
  return normalizeNudge(point?.handleNudge)[side];
}

export function setSkeletonPointSideHandleNudge(
  point,
  side,
  nudge,
  { round = Math.round } = {}
) {
  assertSkeletonRibSide(side);
  const normalizedNudge = normalizeNudge(point?.handleNudge);
  normalizedNudge[side] = round(asFiniteNumber(nudge, 0));
  point.handleNudge = normalizedNudge;
}

export function setSkeletonContourDefaultWidth(
  contour,
  defaultWidth,
  { round = Math.round } = {}
) {
  contour.defaultWidth = Math.max(0, round(asFiniteNumber(defaultWidth, 0)));
}

//
// The pinned segment tension for the segment starting at `point` on `side`, or
// null where the segment is unpinned and the generator's own fit stands.
//
export function getSkeletonSegmentCurvature(point, side) {
  assertSkeletonRibSide(side);
  const value = point?.segmentCurvature?.[side];
  return Number.isFinite(value) ? value : null;
}

//
// Pin, or clear with null. Only a sanity guard is applied on the way in — the
// design ceiling belongs to the drag, which is where someone is choosing how far
// to go, and where it can be applied without ever pulling the curve backwards.
//
// Nothing in generation calls this. A pin is only ever written by a deliberate
// drag, which is what lets an unreachable pin clamp its OUTPUT and still come
// back intact once the skeleton allows it again.
//
export function setSkeletonSegmentCurvature(point, side, tension) {
  assertSkeletonRibSide(side);
  const curvature = normalizeSegmentCurvature(point?.segmentCurvature);
  curvature[side] = Number.isFinite(tension)
    ? Math.min(Math.max(tension, 0), MAX_STORED_SEGMENT_TENSION)
    : null;
  point.segmentCurvature = curvature;
}

export function getSkeletonHandleOffsetKey(side, role) {
  assertSkeletonRibSide(side);
  assertSkeletonHandleRole(role);
  return `${side}${role === "in" ? "In" : "Out"}`;
}

export function getSkeletonHandleOffset(point, side, role) {
  const key = getSkeletonHandleOffsetKey(side, role);
  const offset = point?.handleOffsets?.[key];
  return {
    x: asFiniteNumber(offset?.x, 0),
    y: asFiniteNumber(offset?.y, 0),
    detached: offset?.detached === true,
  };
}

export function setSkeletonHandleOffset(
  point,
  side,
  role,
  offset,
  { round = Math.round } = {}
) {
  const key = getSkeletonHandleOffsetKey(side, role);
  const existing = getSkeletonHandleOffset(point, side, role);
  point.handleOffsets = {
    ...normalizeHandleOffsets(point?.handleOffsets),
    [key]: {
      x: round(asFiniteNumber(offset?.x, 0)),
      y: round(asFiniteNumber(offset?.y, 0)),
      detached: offset?.detached === true || existing.detached === true,
    },
  };
}

export function setSkeletonHandleDetached(point, side, detached) {
  assertSkeletonRibSide(side);
  // Write the flag directly: setSkeletonHandleOffset ORs `detached` with the
  // existing state (a drag must never silently re-attach), which would make
  // un-detaching impossible through it.
  const handleOffsets = normalizeHandleOffsets(point?.handleOffsets);
  for (const role of ["in", "out"]) {
    const key = getSkeletonHandleOffsetKey(side, role);
    const offset = getSkeletonHandleOffset(point, side, role);
    handleOffsets[key] = { x: offset.x, y: offset.y, detached: detached === true };
  }
  point.handleOffsets = handleOffsets;
}

export function setSkeletonPointTotalWidth(
  point,
  defaultWidth,
  totalWidth,
  { round = Math.round } = {}
) {
  const width = normalizeWidth(point?.width);
  const total = Math.max(0, asFiniteNumber(totalWidth, 0));
  const currentTotal = width.left + width.right;
  const leftFrac = currentTotal > 0 ? width.left / currentTotal : 0.5;
  // Round one side and take the other as the remainder, so the total asked for is
  // the total stored. Rounding both independently can overshoot by a unit, which
  // on a single-sided contour puts the visible edge a unit past the cursor.
  const rounded = Math.max(0, round(total));
  width.left = Math.min(rounded, Math.max(0, round(total * leftFrac)));
  width.right = rounded - width.left;
  point.width = width;
  clearCollapsedRibSides(point);
}

export function setSkeletonPointWidthDistribution(
  point,
  defaultWidth,
  distribution,
  { round = Math.round } = {}
) {
  const width = normalizeWidth(point?.width);
  const total = width.left + width.right;
  const d = Math.max(-100, Math.min(100, asFiniteNumber(distribution, 0)));
  width.left = Math.max(0, round((total * (1 + d / 100)) / 2));
  width.right = Math.max(0, round((total * (1 - d / 100)) / 2));
  point.width = width;
  clearCollapsedRibSides(point);
}

export function setSkeletonPointWidthLinked(point, linked) {
  const width = normalizeWidth(point?.width);
  width.linked = linked === true;
  point.width = width;
}

export function setSkeletonPointWidthTied(point, tied) {
  const width = normalizeWidth(point?.width);
  width.tied = tied === true;
  point.width = width;
}

// Lock this point's rib to an axis, or clear the lock. Anything unrecognized
// clears it, so the field can never hold a value the normal override ignores.
export function setSkeletonPointRibAngleLock(point, lock) {
  point.ribAngleLock = VALID_RIB_ANGLE_LOCKS.has(lock) ? (lock ?? null) : null;
}

export function setSkeletonContourSingleSided(contour, sideOrNull) {
  contour.singleSided = VALID_SINGLE_SIDED.has(sideOrNull) ? sideOrNull : null;
}

export function setSkeletonCapParameters(point, values, { round = null } = {}) {
  if (!values || typeof values !== "object") {
    return;
  }
  if (VALID_CAP_STYLES.has(values.capStyle)) {
    point.capStyle = values.capStyle;
  }
  if (VALID_CAP_BALL_SIDES.has(values.capBallSide)) {
    point.capBallSide = values.capBallSide;
  }
  for (const field of CAP_POINT_FIELDS) {
    if (field in values && Number.isFinite(values[field])) {
      point[field] = round ? round(values[field]) : values[field];
    }
  }
}

// Partial merge into the point's serif data. Only the keys present in `values`
// are written, so the panel can send one field at a time.
export function setSkeletonSerifParameters(point, values) {
  if (!values || typeof values !== "object") {
    return;
  }
  const serif = normalizeSerif(point?.serif);
  for (const side of ["left", "right"]) {
    if (!values[side] || typeof values[side] !== "object") {
      continue;
    }
    for (const field of SERIF_HALF_FIELDS) {
      if (!(field in values[side])) {
        continue;
      }
      // Clearing a box stores zero. The migration table is for reading old data
      // that never held a number, not for a designer who just emptied a field.
      const value = values[side][field];
      serif[side][field] = Number.isFinite(value) ? value : 0;
    }
  }
  if (VALID_SERIF_AXIS_MODES.has(values.axisMode)) {
    serif.axisMode = values.axisMode;
  }
  if ("linked" in values) {
    serif.linked = values.linked === true;
  }
  for (const field of SERIF_TERMINAL_FIELDS) {
    if (!(field in values)) {
      continue;
    }
    const value = values[field];
    serif[field] = Number.isFinite(value)
      ? value
      : field === "axisAngle"
        ? serif.axisAngle
        : 0;
  }
  point.serif = serif;
}

export function captureSerifPreset(point) {
  const serif = normalizeSerif(point?.serif);
  return {
    linked: serif.linked,
    undersideCup: serif.undersideCup,
    left: { ...serif.left },
    right: { ...serif.right },
  };
}

export function applySerifPreset(preset, { scope = "both" } = {}) {
  const serif = normalizeSerif(preset);
  if (scope === "left" || scope === "right") {
    return { [scope]: { ...serif[scope] } };
  }
  return {
    linked: serif.linked,
    undersideCup: serif.undersideCup,
    left: { ...serif.left },
    right: { ...serif.right },
  };
}

// Only three fields have a master default. Everything else on a fresh serif is
// zero, which is why this maps rather than lists.
const SERIF_SEED_KEYS = Object.freeze({
  wingLength: SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_WING_LENGTH,
  tipThickness: SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_TIP_THICKNESS,
  wingSlope: SKELETON_SOURCE_DEFAULT_KEYS.SERIF_NEW_WING_SLOPE,
});

// The one description of a fresh serif. The cap-style seed and the defaults
// panel's add button both go through it, so they cannot drift apart.
export function makeSerifSeed(sourceDefaults = {}) {
  const half = {};
  for (const field of SERIF_HALF_FIELDS) {
    const key = SERIF_SEED_KEYS[field];
    const value = key ? Number(sourceDefaults[key]) : 0;
    half[field] = Number.isFinite(value)
      ? value
      : Number(SKELETON_SOURCE_DEFAULT_FALLBACKS[key]);
  }
  return { linked: true, undersideCup: 0, left: half, right: { ...half } };
}

export function makeSerifPreset(sourceDefaults = {}, name = "Serif") {
  return { name, ...makeSerifSeed(sourceDefaults) };
}

export function setSkeletonCornerParameters(point, values, { round = null } = {}) {
  if (!values || typeof values !== "object") {
    return;
  }
  for (const field of CORNER_POINT_FIELDS) {
    if (field in values && Number.isFinite(values[field])) {
      point[field] = round ? round(values[field]) : values[field];
    }
  }
}

// Reset one generated handle (side + role) to its derived position, leaving the
// opposite handle on the same side, the side nudge and the editable flag alone.
//
// Removing the entry — rather than zeroing it — is what "derived" means:
// copyHandleOffsetsToGenerator skips absent offsets entirely, so the generator
// sees no OffsetX/OffsetY/Detached for this handle and re-derives it.
//
// This clears `detached` along with the offset, because the flag is stored on
// the very entry being removed. Callers that want a detached handle to STAY
// detached re-anchor it afterwards at the derived position — see
// resetPanelGeneratedHandle in skeleton-panel-edits.js.
export function resetSkeletonEditableRibHandle(point, side, role) {
  const offsets = normalizeHandleOffsets(point?.handleOffsets);
  delete offsets[getSkeletonHandleOffsetKey(side, role)];
  point.handleOffsets = offsets;
}

export function resetSkeletonEditableRibHandles(point, side) {
  assertSkeletonRibSide(side);
  for (const role of ["in", "out"]) {
    resetSkeletonEditableRibHandle(point, side, role);
  }
}

// Is this side's generated geometry blocked from adjustment?
export function isSkeletonSideLocked(point, side) {
  assertSkeletonRibSide(side);
  return normalizeLocked(point?.locked)[side];
}

export function setSkeletonSideLocked(point, side, locked) {
  assertSkeletonRibSide(side);
  const next = normalizeLocked(point?.locked);
  next[side] = locked === true;
  point.locked = next;
}

// Clear one side's generated adjustments (nudge + both handle offsets). The
// lock flag is deliberately untouched: locking and adjusting are independent,
// so a reset must not silently unlock and a lock must not silently reset.
export function resetSkeletonEditableRib(point, side) {
  assertSkeletonRibSide(side);
  const nudge = normalizeNudge(point?.nudge);
  nudge[side] = 0;
  point.nudge = nudge;
  const handleNudge = normalizeNudge(point?.handleNudge);
  handleNudge[side] = 0;
  point.handleNudge = handleNudge;
  setSkeletonSegmentCurvature(point, side, null);
  resetSkeletonEditableRibHandles(point, side);
}

function clearCollapsedRibSides(point) {
  for (const side of ["left", "right"]) {
    if (getSkeletonPointHalfWidth(point, null, side) < 0.5) {
      resetSkeletonEditableRib(point, side);
    }
  }
}

// Pure translate of all skeleton point coordinates. Returns a new data object.
// Widths, nudges and handle offsets are relative to the point and therefore
// translation-invariant, so they are left untouched.
export function translateSkeletonData(skeletonData, dx, dy) {
  const data = deepCopyObject(skeletonData);
  for (const contour of data?.contours || []) {
    for (const point of contour.points || []) {
      point.x = asFiniteNumber(point.x, 0) + dx;
      point.y = asFiniteNumber(point.y, 0) + dy;
    }
  }
  return data;
}

function affineFlipsOrientation(affine) {
  return affine.xx * affine.yy - affine.xy * affine.yx < 0;
}

function swapProperties(object, firstKey, secondKey) {
  if (!object || typeof object !== "object") {
    return;
  }
  const hasFirst = Object.hasOwn(object, firstKey);
  const hasSecond = Object.hasOwn(object, secondKey);
  const first = object[firstKey];
  const second = object[secondKey];
  if (hasSecond) {
    object[firstKey] = second;
  } else {
    delete object[firstKey];
  }
  if (hasFirst) {
    object[secondKey] = first;
  } else {
    delete object[secondKey];
  }
}

function swapSideName(value) {
  return value === "left" ? "right" : value === "right" ? "left" : value;
}

// Transform the metadata owned by one skeleton on-curve point. Handle offsets
// are glyph-space vectors, so they receive only the affine's linear part.
// Reflections additionally exchange geometric left/right.
export function transformSkeletonPointMetadata(point, affine) {
  const linearX = (x, y) => affine.xx * x + affine.yx * y;
  const linearY = (x, y) => affine.xy * x + affine.yy * y;
  if (point.handleOffsets && typeof point.handleOffsets === "object") {
    for (const key of Object.keys(point.handleOffsets)) {
      const offset = point.handleOffsets[key];
      if (!offset || typeof offset !== "object") {
        continue;
      }
      const ox = asFiniteNumber(offset.x, 0);
      const oy = asFiniteNumber(offset.y, 0);
      offset.x = linearX(ox, oy);
      offset.y = linearY(ox, oy);
    }
  }

  if (!affineFlipsOrientation(affine) || point.type) {
    return;
  }
  for (const field of [
    "width",
    "nudge",
    "handleNudge",
    "locked",
    "segmentCurvature",
    "serif",
  ]) {
    swapProperties(point[field], "left", "right");
  }
  swapProperties(point.handleOffsets, "leftIn", "rightIn");
  swapProperties(point.handleOffsets, "leftOut", "rightOut");
  point.capBallSide = swapSideName(point.capBallSide);
  if (Number.isFinite(point.capAngle)) {
    point.capAngle = -point.capAngle;
  }
  if (Number.isFinite(point.cornerAsymmetry)) {
    point.cornerAsymmetry = -point.cornerAsymmetry;
  }
  // The absolute serif axis angle is a direction in glyph space, so it reflects
  // like capAngle. `axisMode` does not: horizontal stays horizontal under a
  // mirror. `tipCutAngle` and `wingSlope` also do not, because they are measured
  // inside their own half's frame and swapping the halves is the whole
  // correction.
  if (Number.isFinite(point.serif?.axisAngle)) {
    point.serif.axisAngle = -point.serif.axisAngle;
  }
}

// Contour-wide side ownership can only be transformed when the entire contour
// participates in the edit. Whole-data transforms always satisfy that rule;
// partial editor transforms call this helper only for fully selected contours.
export function transformSkeletonContourMetadata(contour, affine) {
  if (!affineFlipsOrientation(affine)) {
    return;
  }
  contour.singleSided = swapSideName(contour.singleSided);
  contour.capBallSide = swapSideName(contour.capBallSide);
}

// Pure affine of all skeleton point coordinates and transform-owned metadata.
export function transformSkeletonData(skeletonData, affine) {
  const data = deepCopyObject(skeletonData);
  for (const contour of data?.contours || []) {
    transformSkeletonContourMetadata(contour, affine);
    for (const point of contour.points || []) {
      const [x, y] = affine.transformPoint(
        asFiniteNumber(point.x, 0),
        asFiniteNumber(point.y, 0)
      );
      point.x = x;
      point.y = y;
      transformSkeletonPointMetadata(point, affine);
    }
  }
  return data;
}

// Re-key every contour and point id from `nextId` upward, remapping provenance
// references (generated[].skeletonContourId and each pointMap entry's
// skeletonPointId). Used on paste so pasted ids never collide with the target
// glyph's existing skeleton ids. Returns { data, nextId }.
export function allocateSkeletonIds(skeletonData, nextId) {
  const data = deepCopyObject(skeletonData);
  let counter = Number.isInteger(nextId) && nextId > 0 ? nextId : 1;
  const contourIdMap = new Map();
  const pointIdMap = new Map();
  for (const contour of data?.contours || []) {
    const oldContourId = contour.id;
    contour.id = counter++;
    contourIdMap.set(oldContourId, contour.id);
    for (const point of contour.points || []) {
      const oldPointId = point.id;
      point.id = counter++;
      pointIdMap.set(oldPointId, point.id);
    }
  }
  for (const entry of data?.generated || []) {
    if (contourIdMap.has(entry.skeletonContourId)) {
      entry.skeletonContourId = contourIdMap.get(entry.skeletonContourId);
    }
    for (const mapEntry of entry.pointMap || []) {
      if (pointIdMap.has(mapEntry.skeletonPointId)) {
        mapEntry.skeletonPointId = pointIdMap.get(mapEntry.skeletonPointId);
      }
    }
  }
  data.nextId = counter;
  return { data, nextId: counter };
}

export function getSkeletonRibSidesForPoint(contour, point) {
  if (!point || point.type) {
    return [];
  }
  if (contour?.singleSided === "left" || contour?.singleSided === "right") {
    return [contour.singleSided];
  }
  return ["left", "right"];
}

// The on-curve points whose ribs move as one with this point's — itself
// included — or null when its rib stands alone.
//
// Contour-level entry to collectTiedRibGroups, the rule the generator resolves
// widths through. Used by the rib drag and by rib rendering so the gizmo, the
// stored width and the generated geometry cannot disagree about where the rib
// is.
export function getTiedRibGroup(contour, point) {
  if (!point || point.type) {
    return null;
  }
  const points = contour?.points || [];
  if (!points.includes(point)) {
    return null;
  }
  const isClosed = contour.closed === true;
  const segments = buildSegmentsFromSkeletonPoints(points, isClosed);
  return (
    collectTiedRibGroups(
      segments,
      isClosed,
      ribTiedByDefault,
      collectSerifTerminals(segments, isClosed, contour.capStyle)
    ).get(point) || null
  );
}

// The half-width the generator will actually use for this rib: the stored value,
// or the mean across a tied group, matching coupledHalfWidths in
// skeleton-generator.js. Rendering and hit-testing must use this rather than the
// stored value, or the gizmo sits somewhere the outline is not.
export function getEffectiveRibHalfWidth(contour, point, side) {
  const group = getTiedRibGroup(contour, point);
  if (!group) {
    return getSkeletonPointHalfWidth(point, contour?.defaultWidth, side);
  }
  return meanHalfWidth(group, (member) =>
    getSkeletonPointHalfWidth(member, contour?.defaultWidth, side)
  );
}

// The shared half-width of a tied group. The mean rather than any one member's
// value: symmetric, so no point wins, and continuous in every input, so dragging
// any one width moves the whole group together and smoothly.
export function meanHalfWidth(group, halfWidthOf) {
  return group.reduce((total, member) => total + halfWidthOf(member), 0) / group.length;
}

// Forward projection of a rib endpoint in glyph space (the C4 gizmo position).
// This is the single shared source used by rendering (WS-8), hit-testing
// (WS-11) and selection bounds (WS-16); never re-derive it locally.
export function getSkeletonRibPosition(contour, point, side) {
  assertSkeletonRibSide(side);
  if (!getSkeletonRibSidesForPoint(contour, point).includes(side)) {
    return null;
  }
  const pointIndex = (contour.points || []).indexOf(point);
  const normal = calculateNormalAtSkeletonPoint(
    contour,
    pointIndex >= 0 ? pointIndex : point.id
  );
  const defaultWidth = contour.defaultWidth;
  const leftHalfWidth = getEffectiveRibHalfWidth(contour, point, "left");
  const rightHalfWidth = getEffectiveRibHalfWidth(contour, point, "right");
  const halfWidth =
    contour.singleSided === "left" || contour.singleSided === "right"
      ? leftHalfWidth + rightHalfWidth
      : getEffectiveRibHalfWidth(contour, point, side);
  const nudge = getSkeletonPointNudge(point, side, defaultWidth);
  return projectSkeletonRibPoint(point, normal, halfWidth, side, nudge);
}

const VALID_GENERATED_ROLES = new Set(["onCurve", "in", "out"]);

export function findGeneratedPathAddress(skeletonData, contourId, pointId, side, role) {
  if (side !== "left" && side !== "right") {
    throw new Error(`invalid editable generated side: ${side}`);
  }
  if (!VALID_GENERATED_ROLES.has(role)) {
    throw new Error(`invalid editable generated role: ${role}`);
  }
  const numericContourId = asStrictSkeletonInteger(contourId);
  const numericPointId = asStrictSkeletonInteger(pointId);
  if (numericContourId === null || numericPointId === null) {
    return null;
  }
  for (const generatedEntry of skeletonData?.generated || []) {
    if (generatedEntry?.skeletonContourId !== numericContourId) continue;
    const pointMap = generatedEntry.pointMap || [];
    for (
      let contourPointIndex = 0;
      contourPointIndex < pointMap.length;
      contourPointIndex++
    ) {
      const provenance = pointMap[contourPointIndex];
      if (
        provenance?.skeletonPointId === numericPointId &&
        provenance.side === side &&
        provenance.role === role
      ) {
        return {
          pathContourIndex: generatedEntry.pathContourIndex,
          contourPointIndex,
          pathPointIndex: contourPointIndex,
        };
      }
    }
  }
  return null;
}

function asStrictSkeletonInteger(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    return Number(value);
  }
  return null;
}

const SKELETON_RIB_KEY_KIND = "skeletonRib";

export function makeSkeletonRibKey(contourId, pointId, side) {
  assertSkeletonRibSide(side);
  return `${SKELETON_RIB_KEY_KIND}/${contourId}/${pointId}/${side}`;
}

export function parseSkeletonRibKey(key) {
  const parts = `${key}`.split("/");
  if (parts.length !== 4 || parts[0] !== SKELETON_RIB_KEY_KIND) {
    throw new Error(`invalid skeleton rib key: ${key}`);
  }
  const [, contourId, pointId, side] = parts;
  assertSkeletonRibSide(side);
  if (!contourId || !pointId) {
    throw new Error(`invalid skeleton rib key: ${key}`);
  }
  return { contourId, pointId, side };
}

export function getSkeletonRibAddress(skeletonData, contourId, pointId, side) {
  assertSkeletonRibSide(side);
  const contours = skeletonData?.contours || [];
  const contourIndex = contours.findIndex(
    (contour) => `${contour.id}` === `${contourId}`
  );
  if (contourIndex < 0) return null;
  const contour = contours[contourIndex];
  const points = contour.points || [];
  const pointIndex = points.findIndex((point) => `${point.id}` === `${pointId}`);
  if (pointIndex < 0) return null;
  const point = points[pointIndex];
  if (point.type || !getSkeletonRibSidesForPoint(contour, point).includes(side)) {
    return null;
  }
  return {
    contour,
    contourIndex,
    point,
    pointIndex,
    side,
    defaultWidth: contour.defaultWidth,
    normal: calculateNormalAtSkeletonPoint(contour, pointIndex),
  };
}

export function createSkeletonRibExecutor(
  address,
  behaviorName = "rib-default",
  { interpolationAxis = null, carryNudgeToHandles = false } = {}
) {
  const { contour, point, side, defaultWidth, normal } = address;
  const leftHalfWidth = getSkeletonPointHalfWidth(point, defaultWidth, "left");
  const rightHalfWidth = getSkeletonPointHalfWidth(point, defaultWidth, "right");
  const isSingleSided =
    contour.singleSided === "left" || contour.singleSided === "right";
  const originalHalfWidth = isSingleSided
    ? leftHalfWidth + rightHalfWidth
    : getSkeletonPointHalfWidth(point, defaultWidth, side);
  const originalNudge = getSkeletonPointNudge(point, side, defaultWidth);
  const originalHandleNudge = getSkeletonPointHandleNudge(point, side);
  const tangent = { x: -normal.y, y: normal.x };
  const adjustable = !isSkeletonSideLocked(point, side);
  const forceTangent =
    behaviorName === "rib-tangent" || behaviorName === "rib-tangent-interpolate";
  const interpolate =
    adjustable &&
    (behaviorName === "rib-interpolate" || behaviorName === "rib-tangent-interpolate");
  const axis = interpolate
    ? interpolationAxis || { dir: tangent, hasHandle: {} }
    : null;
  return {
    contourId: contour.id,
    pointId: point.id,
    side,
    normal,
    applyDelta(delta, { constrainMode = null, round = Math.round } = {}) {
      if (axis) {
        const deltaAlongAxis = delta.x * axis.dir.x + delta.y * axis.dir.y;
        const axisDotTangent = axis.dir.x * tangent.x + axis.dir.y * tangent.y;
        const deltaNudge = axisDotTangent * deltaAlongAxis;
        return {
          halfWidth: originalHalfWidth,
          nudge: round(originalNudge + deltaNudge),
          handleNudge: originalHandleNudge,
          side,
        };
      }
      const normalSign = side === "left" ? 1 : -1;
      const normalDelta = normalSign * (delta.x * normal.x + delta.y * normal.y);
      const tangentDelta = delta.x * tangent.x + delta.y * tangent.y;
      const tangentOnly = forceTangent || constrainMode === "tangent";
      const halfWidth = tangentOnly
        ? originalHalfWidth
        : Math.max(0, round(originalHalfWidth + normalDelta));
      const nudge =
        adjustable && tangentOnly ? round(originalNudge + tangentDelta) : originalNudge;
      const handleNudge =
        adjustable && tangentOnly && carryNudgeToHandles
          ? round(originalHandleNudge + tangentDelta)
          : originalHandleNudge;
      return { halfWidth, nudge, handleNudge, side };
    },
  };
}

export function applySkeletonRibExecutorResult(address, result) {
  const { contour, point, side, defaultWidth } = address;
  if (contour.singleSided === "left" || contour.singleSided === "right") {
    setSingleSidedTotalWidth(point, defaultWidth, side, result.halfWidth);
  } else {
    setSkeletonPointSideWidth(point, defaultWidth, side, result.halfWidth);
  }
  if (!isSkeletonSideLocked(point, side)) {
    setSkeletonPointSideNudge(point, side, result.nudge);
    setSkeletonPointSideHandleNudge(point, side, result.handleNudge);
    for (const [role, offset] of Object.entries(result.handleOffsets || {})) {
      setSkeletonHandleOffset(point, side, role, offset, { round: (value) => value });
    }
  }
}

export function* iterSkeletonRibTargets(skeletonData) {
  for (const contour of skeletonData?.contours || []) {
    for (let pointIndex = 0; pointIndex < (contour.points || []).length; pointIndex++) {
      const point = contour.points[pointIndex];
      if (point.type) continue;
      const normal = calculateNormalAtSkeletonPoint(contour, pointIndex);
      for (const side of getSkeletonRibSidesForPoint(contour, point)) {
        yield {
          selectionKey: makeSkeletonRibKey(contour.id, point.id, side),
          contour,
          contourId: contour.id,
          point,
          pointId: point.id,
          pointIndex,
          side,
          defaultWidth: contour.defaultWidth,
          normal,
          position: getSkeletonRibPosition(contour, point, side),
        };
      }
    }
  }
}

function setSingleSidedTotalWidth(point, defaultWidth, side, totalWidth) {
  const linked = point.width?.linked !== false;
  const value = Math.max(0, totalWidth);
  if (linked) {
    const half = value / 2;
    for (const s of ["left", "right"]) {
      setSkeletonPointSideWidth(point, defaultWidth, s, half, {
        linked: false,
        round: (value) => value,
      });
    }
    point.width.linked = true;
    return;
  }
  const oppositeSide = side === "left" ? "right" : "left";
  const opposite = getSkeletonPointHalfWidth(point, defaultWidth, oppositeSide);
  setSkeletonPointSideWidth(point, defaultWidth, side, value - opposite, {
    linked: false,
  });
}

const EDITABLE_GENERATED_POINT_KEY_KIND = "editableGeneratedPoint";
const EDITABLE_GENERATED_HANDLE_KEY_KIND = "editableGeneratedHandle";
const EDITABLE_VALID_GENERATED_SIDES = new Set(["left", "right"]);
const EDITABLE_VALID_HANDLE_ROLES = new Set(["in", "out"]);

export function makeEditableGeneratedPointKey(contourId, pointId, side) {
  assertGeneratedSide(side);
  assertNumericId(contourId, "contourId");
  assertNumericId(pointId, "pointId");
  return `${EDITABLE_GENERATED_POINT_KEY_KIND}/${contourId}/${pointId}/${side}`;
}

export function parseEditableGeneratedPointKey(key) {
  const parts = normalizeGeneratedKeyParts(key, EDITABLE_GENERATED_POINT_KEY_KIND, 4);
  const [, contourId, pointId, side] = parts;
  assertGeneratedSide(side);
  assertNumericId(contourId, "contourId");
  assertNumericId(pointId, "pointId");
  return { contourId, pointId, side, role: "onCurve" };
}

export function makeEditableGeneratedHandleKey(contourId, pointId, side, role) {
  assertGeneratedSide(side);
  assertHandleRole(role);
  assertNumericId(contourId, "contourId");
  assertNumericId(pointId, "pointId");
  return `${EDITABLE_GENERATED_HANDLE_KEY_KIND}/${contourId}/${pointId}/${side}/${role}`;
}

export function parseEditableGeneratedHandleKey(key) {
  const parts = normalizeGeneratedKeyParts(key, EDITABLE_GENERATED_HANDLE_KEY_KIND, 5);
  const [, contourId, pointId, side, role] = parts;
  assertGeneratedSide(side);
  assertHandleRole(role);
  assertNumericId(contourId, "contourId");
  assertNumericId(pointId, "pointId");
  return { contourId, pointId, side, role };
}

export function resolveGeneratedPointProvenance(skeletonData, path, pathPointIndex) {
  if (!skeletonData || !path || !Number.isInteger(pathPointIndex)) return null;
  let pathContourIndex;
  let contourPointIndex;
  try {
    [pathContourIndex, contourPointIndex] =
      path.getContourAndPointIndex(pathPointIndex);
  } catch {
    return null;
  }
  const generatedEntry = (skeletonData.generated || []).find(
    (entry) => entry?.pathContourIndex === pathContourIndex
  );
  const provenance = generatedEntry?.pointMap?.[contourPointIndex];
  if (!provenance || !VALID_GENERATED_ROLES.has(provenance.role)) return null;
  const contourId = provenance.skeletonContourId ?? generatedEntry.skeletonContourId;
  const pointId = provenance.skeletonPointId;
  if (!Number.isInteger(contourId) || !Number.isInteger(pointId)) return null;
  const contourIndex = (skeletonData.contours || []).findIndex(
    (contour) => contour.id === contourId
  );
  if (contourIndex < 0) return null;
  const contour = skeletonData.contours[contourIndex];
  const pointIndex = (contour.points || []).findIndex((point) => point.id === pointId);
  if (pointIndex < 0) return null;
  return {
    generatedEntry,
    pathContourIndex,
    pathPointIndex,
    contourId,
    pointId,
    side: provenance.side,
    role: provenance.role,
    contour,
    contourIndex,
    point: contour.points[pointIndex],
    pointIndex,
  };
}

export function resolveEditableGeneratedTarget(skeletonData, path, pathPointIndex) {
  const provenance = resolveGeneratedPointProvenance(
    skeletonData,
    path,
    pathPointIndex
  );
  if (!provenance || !EDITABLE_VALID_GENERATED_SIDES.has(provenance.side)) return null;
  if (provenance.point?.type || isSkeletonSideLocked(provenance.point, provenance.side))
    return null;
  const kind =
    provenance.role === "onCurve"
      ? EDITABLE_GENERATED_POINT_KEY_KIND
      : EDITABLE_GENERATED_HANDLE_KEY_KIND;
  if (kind === EDITABLE_GENERATED_HANDLE_KEY_KIND) assertHandleRole(provenance.role);
  const selectionKey =
    kind === EDITABLE_GENERATED_POINT_KEY_KIND
      ? makeEditableGeneratedPointKey(
          provenance.contourId,
          provenance.pointId,
          provenance.side
        )
      : makeEditableGeneratedHandleKey(
          provenance.contourId,
          provenance.pointId,
          provenance.side,
          provenance.role
        );
  return { ...provenance, kind, selectionKey };
}

export function getSkeletonHandleDirectionForPoint(contour, pointIndex, role) {
  assertHandleRole(role);
  const points = contour?.points || [];
  const point = points[pointIndex];
  if (!point || point.type) return null;
  const handleIndex =
    role === "in"
      ? getPreviousGeneratedContourPointIndex(contour, pointIndex)
      : getNextGeneratedContourPointIndex(contour, pointIndex);
  const handle = points[handleIndex];
  if (!handle?.type) return null;
  const direction = normalizeVector(subVectors(handle, point));
  return vectorLength(direction) ? direction : null;
}

function normalizeGeneratedKeyParts(key, kind, expectedLength) {
  let parts = `${key}`.split("/");
  if (parts[0] !== kind) parts = [kind, ...parts];
  if (parts.length !== expectedLength || parts[0] !== kind) {
    throw new Error(`invalid ${kind} key: ${key}`);
  }
  return parts;
}

function assertGeneratedSide(side) {
  if (!EDITABLE_VALID_GENERATED_SIDES.has(side))
    throw new Error(`invalid editable generated side: ${side}`);
}

function assertHandleRole(role) {
  if (!EDITABLE_VALID_HANDLE_ROLES.has(role))
    throw new Error(`invalid editable generated handle role: ${role}`);
}

function assertNumericId(value, name) {
  if (asStrictSkeletonInteger(value) === null)
    throw new Error(`invalid editable generated ${name}: ${value}`);
}

function getPreviousGeneratedContourPointIndex(contour, pointIndex) {
  if (pointIndex > 0) return pointIndex - 1;
  return contour?.closed ? (contour.points || []).length - 1 : -1;
}

function getNextGeneratedContourPointIndex(contour, pointIndex) {
  if (pointIndex < (contour?.points || []).length - 1) return pointIndex + 1;
  return contour?.closed ? 0 : -1;
}

export function buildSegmentsFromSkeletonPoints(points, closed) {
  const segments = [];
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  if (onCurveIndices.length < 2) {
    return segments;
  }
  for (let i = 0; i < onCurveIndices.length - 1; i++) {
    segments.push(makeSegment(points, onCurveIndices[i], onCurveIndices[i + 1]));
  }
  if (closed) {
    const lastIdx = onCurveIndices[onCurveIndices.length - 1];
    const firstIdx = onCurveIndices[0];
    segments.push(makeWrappingSegment(points, lastIdx, firstIdx));
  }
  return segments;
}

/**
 * Is this on-curve point a smooth point whose only handle sits on `curveSegment`,
 * with a straight segment on the other side?
 *
 * Such a point cannot take its direction from its own handle: smoothness means
 * the handle has to be colinear with the straight segment, so the straight sets
 * the direction and the handle follows. Shared by contour generation and by rib
 * rendering/hit-testing, which must agree.
 * @param {Object} point - The shared on-curve skeleton point
 * @param {Object} straightSegment - The segment with no control points
 * @param {Object} curveSegment - The segment carrying the point's one handle
 * @returns {boolean}
 */
export function isStraightControlledSmoothPoint(point, straightSegment, curveSegment) {
  return (
    point?.smooth === true &&
    straightSegment?.controlPoints.length === 0 &&
    curveSegment?.controlPoints.length > 0
  );
}

const ribTiedByDefault = (point) => point?.width?.tied !== false;

/**
 * The end points an open contour draws a serif cap on.
 *
 * Cap style resolves per point with the contour's as the fallback, the same way
 * the generator resolves it. A closed contour has no caps, so it has none of
 * these.
 * @param {Array} segments - The contour's segments, in order
 * @param {boolean} isClosed - Whether the contour is closed
 * @param {string} contourCapStyle - The contour's own cap style
 * @returns {Set} skeleton points carrying a serif
 */
export function collectSerifTerminals(segments, isClosed, contourCapStyle) {
  const terminals = new Set();
  if (isClosed || !segments?.length) {
    return terminals;
  }
  const ends = [segments[0].startPoint, segments[segments.length - 1].endPoint];
  for (const point of ends) {
    if ((point?.capStyle ?? contourCapStyle) === "serif") {
      terminals.add(point);
    }
  }
  return terminals;
}

/**
 * Does this segment tie the ribs at its two ends to a shared offset?
 *
 * It does when it is a straight carrying at least one straight-controlled smooth
 * point (above). Such a point's rib is perpendicular to the straight, and the
 * generated handle leaving it stays colinear with the projected straight to keep
 * the outline smooth — so unless the far rib sits at the same offset, the
 * projected straight tilts with width and takes the handle with it. One such
 * point anywhere on the straight is enough: the whole projected straight has to
 * move as a unit.
 *
 * It also does when a straight carries a SERIF at either end. A serif sits on
 * the end of a straight run of stem, and that run is one wall with one
 * thickness — two widths across it draw a wall that changes thickness where
 * nothing was drawn to change it. Attached to a straight is the whole condition:
 * a serif on a curve has no flat wall behind it and ties nothing.
 *
 * Either end may opt out via its tied flag, which frees the segment. The handles
 * then rotate with width again; that is the accepted cost of asking for
 * independent rib widths here.
 * @param {Object} segment - Candidate segment
 * @param {Object} prevSegment - Segment before it, or null
 * @param {Object} nextSegment - Segment after it, or null
 * @param {Function} isTied - Reads a point's tied flag
 * @param {Set} serifTerminals - Points carrying a serif cap
 * @returns {boolean}
 */
function tiesTheRibsAtItsEnds(
  segment,
  prevSegment,
  nextSegment,
  isTied,
  serifTerminals
) {
  const startPoint = segment?.startPoint;
  const endPoint = segment?.endPoint;
  if (!startPoint || !endPoint || startPoint === endPoint) {
    return false;
  }
  if (!isTied(startPoint) || !isTied(endPoint)) {
    return false;
  }
  if (
    segment.controlPoints.length === 0 &&
    (serifTerminals.has(startPoint) || serifTerminals.has(endPoint))
  ) {
    return true;
  }
  return (
    isStraightControlledSmoothPoint(startPoint, segment, prevSegment) ||
    isStraightControlledSmoothPoint(endPoint, segment, nextSegment)
  );
}

/**
 * On-curve points whose ribs must share one offset, keyed by point. Each value
 * is the whole group, the key point included; points with an independent rib are
 * absent.
 *
 * The rule is per straight segment (above); segments that share an end point
 * merge, because that shared point has one rib and cannot sit at two offsets at
 * once. This is the single definition of the coupling — the generator resolves
 * widths through it, and rendering and hit-testing read it back through
 * getTiedRibGroup, so the outline and the gizmo cannot disagree.
 * @param {Array} segments - The contour's segments, in order
 * @param {boolean} isClosed - Whether the contour is closed
 * @param {Function} isTied - Reads a point's tied flag; defaults to the canonical field
 * @param {Set} serifTerminals - Points carrying a serif cap; empty ties none
 * @returns {Map} skeleton point -> array of skeleton points
 */
export function collectTiedRibGroups(
  segments,
  isClosed,
  isTied = ribTiedByDefault,
  serifTerminals = new Set()
) {
  const groupByPoint = new Map();
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const prevSegment =
      isClosed || i > 0 ? segments[(i - 1 + segments.length) % segments.length] : null;
    const nextSegment =
      isClosed || i < segments.length - 1 ? segments[(i + 1) % segments.length] : null;
    if (
      !tiesTheRibsAtItsEnds(segment, prevSegment, nextSegment, isTied, serifTerminals)
    ) {
      continue;
    }
    const group = [];
    for (const point of [
      ...(groupByPoint.get(segment.startPoint) || [segment.startPoint]),
      ...(groupByPoint.get(segment.endPoint) || [segment.endPoint]),
    ]) {
      if (!group.includes(point)) {
        group.push(point);
      }
    }
    for (const point of group) {
      groupByPoint.set(point, group);
    }
  }
  return groupByPoint;
}

/**
 * The rib normal for a point whose direction comes from a straight segment:
 * perpendicular to that segment, with no miter averaging against the handle.
 * @param {Object} straightSegment - The straight segment setting the direction
 * @returns {Object} Normal {x, y}
 */
export function straightSegmentNormal(straightSegment) {
  return rotateVector90CW(
    normalizeVector(subVectors(straightSegment.endPoint, straightSegment.startPoint))
  );
}

export function calculateNormalAtSkeletonPoint(skeletonContour, pointIndexOrPointId) {
  const points = skeletonContour?.points || [];
  if (points.length < 2) {
    return { x: 0, y: 1 };
  }
  const pointIndex =
    pointIndexOrPointId >= 0 && pointIndexOrPointId < points.length
      ? pointIndexOrPointId
      : points.findIndex((point) => point.id === pointIndexOrPointId);
  const point = points[pointIndex];
  if (!point || point.type) {
    return { x: 0, y: 1 };
  }

  const segments = buildSegmentsFromSkeletonPoints(points, skeletonContour.closed);
  let incomingSegment = null;
  let outgoingSegment = null;
  for (const segment of segments) {
    if (segment.endPoint === point) {
      incomingSegment = segment;
    }
    if (segment.startPoint === point) {
      outgoingSegment = segment;
    }
  }

  const dir1 = incomingSegment ? segmentEndDirection(incomingSegment) : null;
  const dir2 = outgoingSegment ? segmentStartDirection(outgoingSegment) : null;

  if (!dir1 && dir2) {
    return getEffectiveNormal(point, rotateVector90CW(dir2));
  }
  if (dir1 && !dir2) {
    return getEffectiveNormal(point, rotateVector90CW(dir1));
  }
  if (!dir1 && !dir2) {
    return getEffectiveNormal(point, { x: 0, y: 1 });
  }

  // A smooth point with one handle takes its direction from the straight segment
  // on the other side, matching contour generation (SKELETON-FEATURE-MODEL §3.0).
  // Without this the rib gizmo sits at a miter angle the outline never uses.
  if (isStraightControlledSmoothPoint(point, incomingSegment, outgoingSegment)) {
    return getEffectiveNormal(point, straightSegmentNormal(incomingSegment));
  }
  if (isStraightControlledSmoothPoint(point, outgoingSegment, incomingSegment)) {
    return getEffectiveNormal(point, straightSegmentNormal(outgoingSegment));
  }

  const dot = dir1.x * dir2.x + dir1.y * dir2.y;
  const cross = dir1.x * dir2.y - dir1.y * dir2.x;
  const halfAngle = Math.atan2(cross, dot) / 2;
  const cosH = Math.cos(halfAngle);
  const sinH = Math.sin(halfAngle);
  const bisector = normalizeVector({
    x: dir1.x * cosH - dir1.y * sinH,
    y: dir1.x * sinH + dir1.y * cosH,
  });
  return getEffectiveNormal(point, rotateVector90CW(bisector));
}

export function projectSkeletonRibPoint(point, normal, halfWidth, side, nudge = 0) {
  const sign = side === "left" ? 1 : -1;
  const tangent = { x: -normal.y, y: normal.x };
  const baseX = Math.round(point.x + sign * normal.x * halfWidth);
  const baseY = Math.round(point.y + sign * normal.y * halfWidth);
  return {
    x: Math.round(baseX + tangent.x * nudge),
    y: Math.round(baseY + tangent.y * nudge),
  };
}

// getSkeletonData is called from every visualization layer per rendered frame
// and from every hit test per mousemove, so the normalized result is memoized
// per stored-section object. All skeleton writes replace the section object
// wholesale (setSkeletonData / "=" change ops), which invalidates the cache by
// identity. The returned object is shared between callers: treat it as
// read-only — every mutation path must structuredClone first (they all do:
// applySkeletonMutation, makeEditSkeletonChange, recordSkeletonContourIndexShift).
const _normalizedSkeletonCache = new WeakMap();

function _getNormalizedSkeleton(rawSection) {
  if (!rawSection) {
    return null;
  }
  if (typeof rawSection !== "object") {
    return normalizeSkeletonData(rawSection);
  }
  let normalized = _normalizedSkeletonCache.get(rawSection);
  if (!normalized) {
    normalized = normalizeSkeletonData(rawSection);
    _normalizedSkeletonCache.set(rawSection, normalized);
  }
  return normalized;
}

export function getSkeletonData(layerOrCustomData) {
  if (layerOrCustomData?.customData) {
    const internalSkeleton = getFontraInternalSection(
      layerOrCustomData,
      FONTRA_INTERNAL_SECTIONS.SKELETON
    );
    return _getNormalizedSkeleton(internalSkeleton);
  }
  const customData = layerOrCustomData?.customData ?? layerOrCustomData;
  const internalSkeleton =
    customData?.[FONTRA_INTERNAL_KEY]?.[FONTRA_INTERNAL_SECTIONS.SKELETON];
  return _getNormalizedSkeleton(internalSkeleton);
}

export function setSkeletonData(layer, skeletonData) {
  if (!layer) {
    return;
  }
  if (skeletonData === null || skeletonData === undefined) {
    clearSkeletonData(layer);
    return;
  }
  setFontraInternalSection(
    layer,
    FONTRA_INTERNAL_SECTIONS.SKELETON,
    normalizeSkeletonData(skeletonData)
  );
}

export function clearSkeletonData(layer) {
  if (!layer) {
    return;
  }
  deleteFontraInternalSection(layer, FONTRA_INTERNAL_SECTIONS.SKELETON);
}

function makeSegment(points, startIdx, endIdx) {
  return {
    startPoint: points[startIdx],
    endPoint: points[endIdx],
    controlPoints: points.slice(startIdx + 1, endIdx).filter((point) => point.type),
  };
}

function makeWrappingSegment(points, lastIdx, firstIdx) {
  return {
    startPoint: points[lastIdx],
    endPoint: points[firstIdx],
    controlPoints: [
      ...points.slice(lastIdx + 1).filter((point) => point.type),
      ...points.slice(0, firstIdx).filter((point) => point.type),
    ],
  };
}

function segmentStartDirection(segment) {
  if (!segment.controlPoints.length) {
    return normalizeVector(subVectors(segment.endPoint, segment.startPoint));
  }
  const bezier = createBezierFromSegment(segment);
  const deriv = bezier.derivative(0);
  return normalizeVector({ x: deriv.x, y: deriv.y });
}

function segmentEndDirection(segment) {
  if (!segment.controlPoints.length) {
    return normalizeVector(subVectors(segment.endPoint, segment.startPoint));
  }
  const bezier = createBezierFromSegment(segment);
  const deriv = bezier.derivative(1);
  return normalizeVector({ x: deriv.x, y: deriv.y });
}

function createBezierFromSegment(segment) {
  return new Bezier(segment.startPoint, ...segment.controlPoints, segment.endPoint);
}

// Apply a point's rib angle lock to a computed normal, keeping the sign of the
// computed one so left and right stay on the sides they were. The single copy —
// the generator imports this rather than keeping its own (rail R-B).
export function getEffectiveNormal(point, calculatedNormal) {
  if (point?.ribAngleLock === "vertical") {
    // Rib along the y axis: normal is y, pointing the way it already pointed.
    return { x: 0, y: calculatedNormal.y >= 0 ? 1 : -1 };
  }
  if (point?.ribAngleLock === "horizontal") {
    return { x: calculatedNormal.x >= 0 ? 1 : -1, y: 0 };
  }
  return calculatedNormal;
}

function allocateSkeletonId(skeletonData, requestedId = undefined) {
  if (Number.isInteger(requestedId) && requestedId > 0) {
    if (skeletonData) {
      skeletonData.nextId = Math.max(skeletonData.nextId || 1, requestedId + 1);
    }
    return requestedId;
  }
  if (!skeletonData) {
    return 1;
  }
  const id = Math.max(1, asInteger(skeletonData.nextId, 1));
  skeletonData.nextId = id + 1;
  return id;
}

function normalizeId(value, skeletonData, usedIds) {
  let id = Number.isInteger(value) && value > 0 ? value : null;
  if (!id || usedIds?.has(id)) {
    id = allocateSkeletonId(skeletonData);
  } else if (skeletonData) {
    skeletonData.nextId = Math.max(skeletonData.nextId || 1, id + 1);
  }
  usedIds?.add(id);
  return id;
}

function maxUsedId(usedIds) {
  return usedIds?.size ? Math.max(...usedIds) : 0;
}

function normalizeWidth(width) {
  return {
    left: asNonNegativeNumber(width?.left, DEFAULT_SKELETON_WIDTH / 2),
    right: asNonNegativeNumber(width?.right, DEFAULT_SKELETON_WIDTH / 2),
    linked: width?.linked !== false,
    // Rib tied to the point across a straight segment. Default on, because two
    // smooth points joined by a straight define each other's direction and
    // untied ribs make the generated handles rotate with width. Opting out is
    // allowed but is a deliberate choice — see SKELETON-FEATURE-MODEL.md §3.0.
    tied: width?.tied !== false,
  };
}

function normalizeSerifHalf(half) {
  const normalized = {};
  for (const field of SERIF_HALF_FIELDS) {
    normalized[field] = Number.isFinite(half?.[field]) ? half[field] : 0;
  }
  return normalized;
}

function normalizeSerif(serif) {
  const normalized = {
    left: normalizeSerifHalf(serif?.left),
    right: normalizeSerifHalf(serif?.right),
    linked: serif?.linked !== false,
    axisMode: VALID_SERIF_AXIS_MODES.has(serif?.axisMode)
      ? serif.axisMode
      : "perpendicular",
  };
  normalized.axisAngle = Number.isFinite(serif?.axisAngle) ? serif.axisAngle : 0;
  for (const field of SERIF_TERMINAL_FIELDS) {
    if (field === "axisAngle") continue;
    normalized[field] = Number.isFinite(serif?.[field]) ? serif[field] : 0;
  }
  return normalized;
}

// The pinned segment tension for the generated segment STARTING at this point,
// per side. Null means unpinned, which is the default and is not the same as
// zero - zero is a legitimate pin meaning "as flat as this can go".
//
// Keyed on the segment's start point rather than on either generated segment,
// because the right-side contour is emitted backwards: keying on emission order
// would address the two sides of the same skeleton segment inconsistently.
function normalizeSegmentCurvature(curvature) {
  const clamp = (value) =>
    Number.isFinite(value)
      ? Math.min(Math.max(value, 0), MAX_STORED_SEGMENT_TENSION)
      : null;
  return {
    left: clamp(curvature?.left),
    right: clamp(curvature?.right),
  };
}

function normalizeNudge(nudge) {
  return {
    left: asFiniteNumber(nudge?.left, 0),
    right: asFiniteNumber(nudge?.right, 0),
  };
}

// Side locks (donor `leftLocked`/`rightLocked`). Absence means unlocked, so
// generated-side adjustment is available by default and the lock is what blocks
// it. A lock never clears stored adjustments — unlocking re-exposes them.
function normalizeLocked(locked) {
  return {
    left: locked?.left === true,
    right: locked?.right === true,
  };
}

function normalizeHandleOffsets(handleOffsets) {
  return handleOffsets &&
    typeof handleOffsets === "object" &&
    !Array.isArray(handleOffsets)
    ? deepCopyObject(handleOffsets)
    : {};
}

function assertSkeletonRibSide(side) {
  if (side !== "left" && side !== "right") {
    throw new Error(`invalid skeleton rib side: ${side}`);
  }
}

function assertSkeletonHandleRole(role) {
  if (role !== "in" && role !== "out") {
    throw new Error(`invalid skeleton handle role: ${role}`);
  }
}

function asInteger(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function asFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function asNonNegativeNumber(value, fallback) {
  return Math.max(0, asFiniteNumber(value, fallback));
}

// One number for a generated segment's curvature, in the unit the generator
// stores and reads back. Every reader goes through here (R-B), so the number a
// drag writes is the number the label shows and the number the generator
// reproduces.
//
// A handle's tension is its length over its own distance to the segment's
// tangent intersection, so one is the Tunni point at either end and the
// segment's tension is the harmonic mean of the two. Reading that off the drawn
// handles is only right while a drawn handle still points along the axis it was
// built on. At a smooth joint colinearity rotates it afterwards, keeping the
// length and moving the intersection, so the drawn direction is the wrong one to
// measure against — the generator never used it. The axes are therefore read
// from provenance and the drawn directions used for nothing.
//
// Where no axis was published — caps, line ribs, corner-rounding output — the
// drawn directions are all there is, which is what every reader had before.
function generatedSegmentTension(points, axes, controls) {
  if (!axes) {
    return calculateSegmentTension(controls[0], points[0], controls[1], points[3]);
  }
  const domain = buildHandleDomain(points[0], points[3], axes[0], axes[1]);
  // reach * maxTension is the real forward intersection: the domain's reach is a
  // clamped coordinate scale and the ceiling is where the intersection landed on
  // it, so their product puts one back at the Tunni point on both ends.
  const tensionAt = (control, anchor, reach, ceiling) =>
    Math.hypot(control.x - anchor.x, control.y - anchor.y) / (reach * ceiling);
  return harmonicMeanTension({
    start: tensionAt(controls[0], points[0], domain.startReach, domain.maxStartTension),
    end: tensionAt(controls[1], points[3], domain.endReach, domain.maxEndTension),
  });
}

// The published axes belong to the EMITTED handles, so they describe the emitted
// segment and nothing else. Where the segment being measured is the untrimmed
// construction snapshot instead, they are the wrong pair: a serif's trim re-aims
// the handle it anchors onto the terminal's depth axis and stamps that. The
// snapshot is taken before colinearity ever runs, so its own drawn directions
// are already the ones it was constructed on and need no correction.
function constructionSegmentAxes(segmentPoints, provenance) {
  if (untrimmedConstructionSegment(segmentPoints, provenance)) {
    return null;
  }
  const start = provenance?.[1]?.constructionAxis;
  const end = provenance?.[2]?.constructionAxis;
  return start && end ? [start, end] : null;
}

//
// A curvature-gizmo drag on a generated segment, expressed as skeleton writes.
//
// The two handles of a generated segment belong to DIFFERENT skeleton points —
// the start point's "out" and the end point's "in", on this generated side — so
// one drag produces two writes. Their addresses are read from the provenance the
// generator emitted, never recovered from geometry (rail R-D): if a handle has
// no provenance, or provenance that is not a handle, the drag is declined rather
// than aimed at a guess.
//
// The result is a PINNED SEGMENT TENSION, not a pair of handle displacements.
//
// A displacement is measured from wherever the generator happened to put the
// handle, so it stops meaning what the designer set the moment the skeleton,
// the width or the taper moves underneath it. A tension is a property of the
// segment's shape and survives all three. The generator reproduces the number
// on every regeneration and clamps only its output, never the stored value.
//
// One number for the whole segment: a segment's tension is the harmonic mean of
// its two handles' tensions, so pinning the mean leaves the split free — which
// is what equalization and the fit's faithful asymmetry both need.
//
// The write is addressed to the SKELETON segment's start point, which is index
// 0 on the left side and index 3 on the right: the right-side contour is
// emitted backwards, and its segments carry "in" where the left carries "out".
// Reading the orientation off that role is what keeps one skeleton segment's
// two sides addressed the same way.
//
export function calculateGeneratedCurvatureEdits({
  segmentPoints,
  provenance,
  delta,
  maxTension = 1,
}) {
  const addresses = [provenance?.[1], provenance?.[2]];
  // Both middles must be handles — but in EITHER order. The right-side
  // generated contour is emitted backwards, so its segments carry "in" first
  // and "out" second. Demanding out-then-in silently refused every segment on
  // that side, which is half the outline. Each write is addressed with its own
  // role below, so the order does not otherwise matter.
  if (
    addresses.some(
      (address) =>
        !address ||
        (address.role !== "in" && address.role !== "out") ||
        address.skeletonPointId === undefined
    ) ||
    addresses[0].role === addresses[1].role
  ) {
    return null;
  }
  const constructionPoints = generatedSegmentConstructionPoints(
    segmentPoints,
    provenance
  );
  const moved = calculateControlPointsFromCurvatureDelta(delta, constructionPoints, {
    maxTension,
    axisSegmentPoints: segmentPoints,
  });
  if (!moved) {
    return null;
  }
  const tension = generatedSegmentTension(
    constructionPoints,
    constructionSegmentAxes(segmentPoints, provenance),
    moved
  );
  if (!Number.isFinite(tension) || tension <= 0) {
    return null;
  }
  // Index 1 is this segment's first off-curve. "out" there means the segment
  // runs in skeleton order, so its start is index 0; otherwise it is index 3.
  const segmentPointIndex = addresses[0].role === "out" ? 0 : 3;
  const start = provenance[segmentPointIndex];
  if (!start || start.role !== "onCurve" || start.skeletonPointId === undefined) {
    return null;
  }
  // Not clamped here: the drag above already saturated each construction
  // tension independently at the ceiling.
  return {
    segmentPointIndex,
    skeletonPointId: start.skeletonPointId,
    side: start.side,
    tension,
  };
}

//
// Every cubic segment of every generated contour, paired with the provenance
// its four points were emitted with.
//
// The generated geometry lives in the path and its addresses live in the
// skeleton's `generated` entries, so this is the join both the visualization
// layer and the pointer tool need. One copy (R-B): a gizmo drawn from one walk
// and hit-tested from another would eventually disagree about where it is.
//
// A segment is only usable if all four of its points carry provenance on the
// same side. Anything else — a cap, a corner fill, a contour whose provenance
// did not survive — is skipped rather than half-addressed.
//
export function buildGeneratedTunniSegments(skeletonData, path) {
  const segments = [];
  if (!path) {
    return segments;
  }
  for (const entry of skeletonData?.generated || []) {
    const pathContourIndex = entry.pathContourIndex;
    if (!Number.isInteger(pathContourIndex) || pathContourIndex < 0) {
      continue;
    }
    const pointMap = entry.pointMap || [];
    const contourSignedArea = getPathContourSignedArea(path, pathContourIndex);
    let contourStart;
    try {
      contourStart = path.getAbsolutePointIndex(pathContourIndex, 0);
    } catch {
      continue;
    }
    let segmentIndex = 0;
    for (const segment of path.iterContourDecomposedSegments(pathContourIndex)) {
      const index = segmentIndex++;
      if (segment.points?.length !== 4) {
        continue;
      }
      const pointIndices = segment.parentPointIndices.map(
        (absolute) => absolute - contourStart
      );
      const isCubicControl = (absolute) =>
        (path.pointTypes[absolute] & VarPackedPath.POINT_TYPE_MASK) ===
        VarPackedPath.OFF_CURVE_CUBIC;
      if (
        !isCubicControl(segment.parentPointIndices[1]) ||
        !isCubicControl(segment.parentPointIndices[2])
      ) {
        continue;
      }
      const provenance = pointIndices.map((pointIndex) => pointMap[pointIndex] || null);
      if (provenance.some((item) => !item)) {
        continue;
      }
      const side = provenance[0].side;
      if (
        (side !== "left" && side !== "right") ||
        provenance.some((item) => item.side !== side)
      ) {
        continue;
      }
      const generatedSegment = {
        pathContourIndex,
        segmentIndex: index,
        skeletonContourId: entry.skeletonContourId,
        side,
        pointIndices,
        parentPointIndices: [...segment.parentPointIndices],
        points: segment.points,
        provenance,
        contourSignedArea,
      };
      generatedSegment.onCurveMovable = getGeneratedOnCurveMovability(
        skeletonData,
        generatedSegment
      );
      segments.push(generatedSegment);
    }
  }
  return segments;
}

function getPathContourSignedArea(path, contourIndex) {
  let contour;
  try {
    contour = path.getUnpackedContour(contourIndex);
  } catch {
    return 0;
  }
  const points = contour.points || [];
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
}

function findGeneratedSegmentSkeletonContour(skeletonData, segment) {
  const contourId =
    segment.provenance[0]?.skeletonContourId ?? segment.skeletonContourId;
  return (skeletonData?.contours || []).find((item) => item?.id === contourId);
}

function getGeneratedOnCurveMovability(skeletonData, segment) {
  const contour = findGeneratedSegmentSkeletonContour(skeletonData, segment);
  if (!contour) {
    return [false, false];
  }
  const startIndex = contour.points?.findIndex(
    (point) => point?.id === segment.provenance[0]?.skeletonPointId
  );
  const endIndex = contour.points?.findIndex(
    (point) => point?.id === segment.provenance[3]?.skeletonPointId
  );
  if (startIndex < 0 || endIndex < 0) {
    return [false, false];
  }
  const runsInSkeletonOrder = segment.provenance[1]?.role === "out";
  return [
    isFarSkeletonSegmentStraight(contour, startIndex, runsInSkeletonOrder ? -1 : 1),
    isFarSkeletonSegmentStraight(contour, endIndex, runsInSkeletonOrder ? 1 : -1),
  ];
}

function isFarSkeletonSegmentStraight(contour, pointIndex, direction) {
  const points = contour.points || [];
  if (!points.length) {
    return false;
  }
  let index = pointIndex;
  for (let steps = 0; steps < points.length; steps++) {
    index += direction;
    if (index < 0 || index >= points.length) {
      return !contour.closed;
    }
    if (!points[index]?.type) {
      return true;
    }
    // A far segment with even one off-curve is a curve, so this end holds.
    return false;
  }
  return false;
}

// How far the on-curve gizmo sits off its generated curve, in GLYPH units. Far
// enough to clear the curvature gizmo, which sits on the curve at the same
// parameter, and to leave room for its label above it.
//
// One constant, deliberately: it zooms with the letter, it is the same everywhere
// on the glyph, and there is nothing to reason about. Two rules that vary it were
// tried and are not wanted — a screen constant, which holds its pixel size but
// grows without bound in glyph space so the control drifted away from the outline
// as you zoomed out; and scaling by the local stroke thickness, which is defensible
// on paper and reads as unsettled in use.
export const GENERATED_ON_CURVE_GIZMO_OFFSET = 30;

// The curvature readout, one copy for the label layer and the drag readout: two
// decimals, with a dot when the number is a stored pin the generator is
// reproducing rather than the value its own fit arrived at.
export function formatGeneratedCurvature(curvature) {
  return `${curvature.tension.toFixed(2)}${curvature.pinned ? "•" : ""}`;
}

// A pin and a hand-placed handle are two answers to one question, and the hand is
// the later and more specific of them: a direct handle drag therefore discards the
// pin on the segment that handle belongs to, or the segment fights the cursor.
//
// Which segment that is follows from the role. A pin lives on its segment's START
// point (D16), so an "out" handle owns the pin at its own point, while an "in"
// handle sits at its segment's far end and the pin belongs to the previous
// on-curve point. Returns false when there was nothing to clear.
export function clearSkeletonSegmentCurvatureForHandle(contour, point, side, role) {
  const owner = getSkeletonSegmentHandles(contour, point, role)?.owner;
  if (!owner || getSkeletonSegmentCurvature(owner, side) === null) {
    return false;
  }
  setSkeletonSegmentCurvature(owner, side, null);
  return true;
}

// The two handles that shape the segment one generated handle belongs to: `out`
// at the segment's start point and `in` at its end point. One copy of the walk,
// beside the ownership rule above, because both readers have to agree about which
// segment a handle names — the pin lives on the start point, and the pin sets the
// two handle lengths together, so anything that touches one has to know the other.
export function getSkeletonSegmentHandles(contour, point, role) {
  const points = contour?.points || [];
  const index = points.indexOf(point);
  if (index < 0 || (role !== "in" && role !== "out")) {
    return null;
  }
  const step = (from, direction) => {
    let cursor = from;
    do {
      cursor =
        direction < 0
          ? getPreviousPointIndex(contour, cursor)
          : getNextPointIndex(contour, cursor);
    } while (cursor >= 0 && points[cursor]?.type);
    return cursor;
  };
  const ownerIndex = role === "out" ? index : step(index, -1);
  if (ownerIndex < 0) {
    return null;
  }
  const farIndex = role === "in" ? index : step(index, 1);
  const owner = points[ownerIndex] || null;
  const far = farIndex >= 0 ? points[farIndex] || null : null;
  if (!owner) {
    return null;
  }
  return {
    owner,
    far,
    handles: [
      { point: owner, role: "out" },
      ...(far ? [{ point: far, role: "in" }] : []),
    ],
  };
}

// A terminal that trims the stroke edge — a serif does — emits only the part of
// the segment that survived the cut, while the curvature pin is reproduced on
// the whole segment. Measuring the emitted part would therefore report a number
// the pin does not mean, and the first drag would jump the shape from one to the
// other. The generator publishes the uncut segment on the inserted point for
// exactly this; it is stored in side order, so it is turned to face the same way
// as the emitted segment before being used.
function untrimmedConstructionSegment(segmentPoints, provenance) {
  if (segmentPoints?.length !== 4) {
    return null;
  }
  const carrier = provenance?.findIndex(
    (item) => item?.constructionSegment?.length === 4
  );
  if (carrier === undefined || carrier < 0) {
    return null;
  }
  const stored = provenance[carrier].constructionSegment;
  if (
    stored.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))
  ) {
    return null;
  }
  // The end that was not cut is still exactly where the generator put it, so it
  // says which way round the stored segment goes.
  const anchor = carrier === 0 ? segmentPoints[3] : segmentPoints[0];
  const anchorIndex = carrier === 0 ? 3 : 0;
  const near = Math.hypot(
    stored[anchorIndex].x - anchor.x,
    stored[anchorIndex].y - anchor.y
  );
  const far = Math.hypot(
    stored[3 - anchorIndex].x - anchor.x,
    stored[3 - anchorIndex].y - anchor.y
  );
  return far < near ? [...stored].reverse() : stored;
}

// The segment as the generator constructed it. Emitted on-curves carry their
// nudge and handles never do, so subtracting the published nudge recovers the one
// space every stored number lives in. Every reader of a generated segment's
// curvature goes through here — the drag, the equalize command and the label.
export function generatedSegmentConstructionPoints(segmentPoints, provenance) {
  const untrimmed = untrimmedConstructionSegment(segmentPoints, provenance);
  const points = untrimmed ?? segmentPoints;
  return points.map((point, index) => {
    if (index !== 0 && index !== 3) {
      return point;
    }
    const nudge = provenance?.[index]?.nudge;
    return {
      x: point.x - asFiniteNumber(nudge?.x, 0),
      y: point.y - asFiniteNumber(nudge?.y, 0),
    };
  });
}

// The skeleton point a generated segment's curvature pin is stored on: the point
// its skeleton segment STARTS at, which is index 0 when the side is emitted in
// skeleton order and index 3 when it is emitted backwards.
export function generatedSegmentPinAddress(skeletonData, segment) {
  const startIndex = segment?.provenance?.[1]?.role === "out" ? 0 : 3;
  const entry = segment?.provenance?.[startIndex];
  if (!entry || entry.skeletonPointId === undefined) {
    return null;
  }
  const address = getSkeletonPointAddress(
    skeletonData,
    entry.skeletonContourId ?? segment.skeletonContourId,
    entry.skeletonPointId
  );
  return address ? { ...address, side: segment.side } : null;
}

// What the curvature gizmo owns for one generated segment: the construction-space
// segment tension, and whether that number is a stored pin the generator is
// reproducing rather than a value the fit arrived at on its own.
export function getGeneratedSegmentCurvature(skeletonData, segment) {
  const points = generatedSegmentConstructionPoints(
    segment?.points,
    segment?.provenance
  );
  if (points?.length !== 4 || points.some((point) => !point)) {
    return null;
  }
  // No forward intersection means no reach to be a fraction of, so there is no
  // tension to report — and the distance-based formula below would invent one
  // above 1 rather than say so.
  if (!hasForwardTangentIntersection(points)) {
    return null;
  }
  const tension = generatedSegmentTension(
    points,
    constructionSegmentAxes(segment?.points, segment?.provenance),
    [points[1], points[2]]
  );
  if (!Number.isFinite(tension) || tension <= 0) {
    return null;
  }
  const address = generatedSegmentPinAddress(skeletonData, segment);
  const pin = address ? getSkeletonSegmentCurvature(address.point, address.side) : null;
  return { tension, pinned: pin !== null && pin !== undefined };
}

export function calculateGeneratedOnCurveGizmoPoint(
  segment,
  offset = GENERATED_ON_CURVE_GIZMO_OFFSET
) {
  const anchor = calculateCurvatureGizmoPoint(segment.points);
  if (!anchor) {
    return null;
  }
  const [p0, p1, p2, p3] = segment.points;
  const tangent = normalizeVector({
    x: -p0.x - p1.x + p2.x + p3.x,
    y: -p0.y - p1.y + p2.y + p3.y,
  });
  if (!tangent) {
    return null;
  }
  const outwardNormal =
    segment.contourSignedArea >= 0
      ? { x: tangent.y, y: -tangent.x }
      : { x: -tangent.y, y: tangent.x };
  return {
    x: anchor.x + outwardNormal.x * offset,
    y: anchor.y + outwardNormal.y * offset,
  };
}

//
// Which generated gizmo, if any, sits under `point`.
//
// The on-curve gizmo is checked first: it sits at the segment's true Tunni
// point, out beyond the handles, while the curvature gizmo sits on the curve
// itself, so the two only compete on very flat segments — and there the
// on-curve control is the one that can still do something.
//
export function generatedTunniHitTest(point, size, skeletonData, path, options = {}) {
  const {
    includeOnCurve = true,
    includeCurvature = true,
    onCurveOffset = GENERATED_ON_CURVE_GIZMO_OFFSET,
  } = options;
  const segments = buildGeneratedTunniSegments(skeletonData, path);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (includeOnCurve && segment.onCurveMovable?.some(Boolean)) {
      const gizmoPoint = calculateGeneratedOnCurveGizmoPoint(segment, onCurveOffset);
      if (gizmoPoint && distance(point, gizmoPoint) <= size) {
        return { type: "generated-on-curve", segment, gizmoPoint };
      }
    }
    if (includeCurvature) {
      const anchor = calculateCurvatureGizmoPoint(segment.points);
      if (anchor && distance(point, anchor) <= size) {
        return { type: "generated-curvature", segment, gizmoPoint: anchor };
      }
    }
  }
  return null;
}

//
// An on-curve-gizmo drag on a generated segment, expressed as skeleton writes.
//
// The drag is read in ABSOLUTE coordinates, deliberately: up or right spreads
// the segment's two on-curve points apart along their own curves, down or left
// draws them together, and that stays true whichever way the segment happens to
// be pointing. A control whose meaning rotated with its segment would need
// re-learning at every joint.
//
// Only the extent changes. This default gizmo writes the on-curve nudge and
// leaves handleNudge untouched, giving it the same move-alone semantics as a
// Z-Alt drag. Existing carried handle positions therefore remain fixed too.
//
// Both rib ends are addressed from provenance, and the drag is declined outright
// rather than half-applied if either address is missing (R-D).
//
export function calculateGeneratedOnCurveEdits({
  segmentPoints,
  provenance,
  delta,
  movable = [true, true],
}) {
  const addresses = [provenance?.[0], provenance?.[3]];
  if (
    addresses.some(
      (address) =>
        !address || address.role !== "onCurve" || address.skeletonPointId === undefined
    )
  ) {
    return null;
  }
  const movableEnds = [Boolean(movable[0]), Boolean(movable[1])];
  const movableCount = Number(movableEnds[0]) + Number(movableEnds[1]);
  if (!movableCount) {
    return null;
  }

  // Up and right both spread, so they add rather than cancel: this is the
  // projection onto the 45-degree axis the basic Tunni control already uses.
  let spread = (delta.x + delta.y) / Math.SQRT2;

  // Closing the two ends together slides each rib end toward its own handle,
  // which the handle cannot outrun: past the point where it would invert, the
  // generator floors the length and the handle starts drifting with the point
  // instead of holding still. Stop at that limit here, so the control simply
  // stops rather than quietly changing what it does.
  const nudgeScale = movableCount === 1 ? 2 : 1;
  const reaches = [
    distance(segmentPoints[0], segmentPoints[1]),
    distance(segmentPoints[3], segmentPoints[2]),
  ];
  const maxClosing = Math.min(
    ...reaches.flatMap((reach, index) =>
      movableEnds[index]
        ? [Math.max(reach - MIN_GENERATED_HANDLE_LENGTH, 0) / nudgeScale]
        : []
    )
  );
  spread = Math.max(spread, -maxClosing);

  // A nudge slides along the SKELETON's tangent, which runs against the
  // generated contour on one of the two sides - the right-side contour is
  // emitted backwards, and its segments carry "in" where the left side carries
  // "out". Reading the orientation off that role keeps the gizmo spreading
  // outward on both sides instead of collapsing one while opening the other.
  const orientation = provenance[1]?.role === "out" ? 1 : -1;

  return addresses.map((address, index) => {
    const nudgeDelta = movableEnds[index]
      ? (index === 0 ? -spread : spread) * orientation * nudgeScale
      : 0;
    return {
      skeletonPointId: address.skeletonPointId,
      side: address.side,
      role: address.role,
      nudgeDelta,
    };
  });
}
