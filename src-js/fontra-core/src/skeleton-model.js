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
import {
  balancePathInPlace,
  expandToJoints,
  harmonizePathInPlace,
} from "./harmonization.js";
import { buildHandleDomain } from "./natural-handle-solver.js";
import {
  buildContourSegments,
  calculateContourNormalAtPoint,
  collectCoupledPointGroups,
  cornerRibPlacement,
  isStraightControlledSmoothPoint,
  offsetContourAlongNormals,
  straightSegmentNormal,
} from "./offset-contour.js";
import { offsetCubicSide } from "./offset-cubic.js";
import { alignHandle, alignHandles } from "./path-functions.js";
import { PathHitTester } from "./path-hit-tester.js";
import {
  DEFAULT_UNDERSIDE_CUP_TENSION,
  maxSerifEaseDistance,
} from "./serif-geometry.js";
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

export { isStraightControlledSmoothPoint, straightSegmentNormal };

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
// What a forced rib holds on to. "stroke" keeps the stroke as wide as its stored
// width and lets the rib run further to reach the edge, which is the flat cut a
// single master wants. "rib" keeps the rib itself the stored width long, which
// draws the stroke thinner by the cosine of the turn and is the one that
// interpolates. Neither is right for every drawing; see the development log,
// "the forced rib, and what it cannot do at once".
export const VALID_RIB_ANGLE_LOCK_MODES = new Set(["stroke", "rib"]);
export const DEFAULT_RIB_ANGLE_LOCK_MODE = "stroke";
export const CAP_POINT_FIELDS = [
  "capRadiusRatio",
  "capTension",
  "capAngle",
  "capDistance",
  "capBallRatio",
  "capBallShape",
  // Bulb easing: how far back along the inner edge the neck starts, 0..1 as a
  // fraction of the run to the next on-curve. Its curvature is the neck cubic's
  // own tension, which the curvature gizmo reads and writes — a neck has no
  // skeleton segment behind it, so it cannot live in `segmentCurvature`.
  "capBallEasing",
  "capBallEaseCurvature",
];
// Where a bulb's neck keeps the number the curvature gizmo writes. Named once
// here and matched against the provenance the generator stamps, so the two
// cannot drift apart.
export const CAP_CURVATURE_FIELDS = new Set(["capBallEaseCurvature"]);
// `tilt` is `perpendicular` turned off the rib by a stated angle. It is a mode
// rather than a number every mode reads, so the plain perpendicular stays the
// default and the tilt is something a designer asks for. The three named modes
// state a direction outright and have no rib to be turned off.
export const VALID_SERIF_AXIS_MODES = new Set([
  "perpendicular",
  "horizontal",
  "vertical",
  "absolute",
  "tilt",
]);
export const VALID_SERIF_UNITS_MODES = new Set(["absolute", "normalized"]);
// Which sides of the terminal the serif is built on, and whether the two are
// edited as one shape. A side left out generates nothing at all — it still
// emits every one of its points, collapsed, because point count is the
// interpolation contract.
//
// "both" is one shape on two sides. "split" is two wings shaped separately,
// which only the panel's create-the-other-side button produces. They are one
// field rather than a side list plus a link flag, because two flags can
// half-apply and leave a state neither of them describes.
export const VALID_SERIF_SIDES = new Set(["both", "left", "right", "split"]);

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
// The cup is three numbers. `undersideCup` is the depth, which places the foot
// centre. `undersideCupTension` is how long the four handles reaching it are,
// which used to be a fixed third of the span. `undersideCupBalance` slides that
// centre along the foot, from the midpoint of the two tips out onto either one.
export const SERIF_TERMINAL_FIELDS = Object.freeze([
  "axisAngle",
  "axisTilt",
  "undersideCup",
  "undersideCupTension",
  "undersideCupBalance",
]);
// The one serif field whose zero is not its default. Zero is a sharp V, which
// is a shape somebody may want, so it cannot double as "never set" — and a
// terminal drawn before the control existed has to keep the foot it had.
export const SERIF_FIELD_DEFAULTS = Object.freeze({
  undersideCupTension: DEFAULT_UNDERSIDE_CUP_TENSION,
});
// An unset serif field is zero. Every one of them, with no exceptions: a serif
// that has never been shaped draws nothing, rather than carrying a bracket
// nobody asked for. The starting shape comes from the seed at the moment a
// terminal becomes a serif, not from a fallback under every read.
export const SERIF_HALF_ZEROS = Object.freeze(
  Object.fromEntries(SERIF_HALF_FIELDS.map((field) => [field, 0]))
);
// Corner rounding is the angle-point engine's parameter set — related to caps
// only in that both live on on-curve points.
//
// Two numbers per side, shaped like `width`. `distance` is how far back along
// each arm the rounding starts, in font units, and zero is a sharp corner.
// `curvature` is how full the arc is: 0 draws a straight chamfer, 1 puts both
// handles on the corner point. This is the same scale the serif's contour
// easing and the curvature gizmo use, so one number means one thing everywhere.
//
// The four fields this replaced — cornerRoundness, cornerReach,
// roundnessStrength and cornerAsymmetry — all multiplied into the one trim
// distance, and the contour-level cornerTrimRatio/cornerRadiusBoost were a dead
// level with a reader and no writer. Nothing reads any of them now, so a corner
// drawn before this change comes back sharp.
export const DEFAULT_CORNER_CURVATURE = 0.55;

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
  {
    compress = false,
    scaleControlPoints = true,
    round = Math.round,
    independent = false,
  } = {}
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
    // The signed distance each end actually travels, which must be the clamped
    // allowance: handles scaled by the raw drag kept the shape moving after the
    // on-curves had stopped, which on a curved skeleton is the whole shape.
    const offsetsByIndex = new Map();
    const affected = expandToTiedRibGroups(originalContour, pointIds);
    const allowed = collectFixedRibAllowances(
      originalContour,
      affected,
      anchorSide,
      projectedDelta,
      singleSided,
      independent
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
      // A width-locked side holds its edge where it stands. The drag pays for
      // its movement out of the width, so with the width refused the point
      // cannot move either - the centerline would walk the pinned edge away.
      // Single-sided renders the sum, so a lock on either side holds it.
      const widthHeld = singleSided
        ? isSkeletonSideLocked(originalPoint, "left", "width") ||
          isSkeletonSideLocked(originalPoint, "right", "width")
        : isSkeletonSideLocked(originalPoint, anchorSide, "width");
      if (widthHeld) {
        continue;
      }
      if (!singleSided) {
        offsetsByIndex.set(originalPointIndex, allowedDelta);
      }
      applyFixedRibWidthDelta(
        workingPoint,
        originalPoint,
        originalContour.defaultWidth,
        anchorSide,
        allowedDelta,
        round,
        singleSided,
        independent
      );
      changed = true;
    }
    if (offsetsByIndex.size) {
      offsetContourAlongNormals(
        originalContour.points,
        originalContour.closed,
        offsetsByIndex,
        workingContour.points,
        {
          round,
          rebuildHandles: scaleControlPoints,
          normalAt: (pointIndex) =>
            calculateNormalAtSkeletonPoint(originalContour, pointIndex),
        }
      );
    }
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
  singleSided,
  independent = false
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
    //
    // Under A the far side is not paying for anything: it keeps the width it
    // has and its edge simply travels with the point. So it cannot reach a floor
    // and has no say in how far the drag goes.
    const sides = independent ? [anchorSide] : [anchorSide, farSide];
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
  singleSided = false,
  independent = false
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
    //
    // A asks for exactly that lopsided result, per drag rather than per point:
    // the anchor edge stays pinned, the far side keeps the width it had, and
    // the far edge therefore travels the whole drag with the centerline.
    { linked: !independent, round }
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
    normalized.corner = normalizeCorner(point?.corner);
    normalized.capStyle = VALID_CAP_STYLES.has(point?.capStyle) ? point.capStyle : null;
    normalized.capBallSide = VALID_CAP_BALL_SIDES.has(point?.capBallSide)
      ? point.capBallSide
      : null;
    normalized.ribAngleLock = VALID_RIB_ANGLE_LOCKS.has(point?.ribAngleLock)
      ? (point.ribAngleLock ?? null)
      : null;
    normalized.ribAngleLockMode = VALID_RIB_ANGLE_LOCK_MODES.has(
      point?.ribAngleLockMode
    )
      ? point.ribAngleLockMode
      : DEFAULT_RIB_ANGLE_LOCK_MODE;
    for (const field of CAP_POINT_FIELDS) {
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

// G2-harmonize the skeleton's own centerline.
//
// The skeleton is a path, so the ordinary path's harmonize applies to it
// unchanged: build the centerline as a path, run the same pass over it, and
// write the moved points back. Nothing here knows about widths, ribs or the
// generated outline — the outline follows on its own, because the one skeleton
// write path regenerates it after every edit.
//
// `pointKeys` is a set of "contourId/pointId" strings naming the points to
// harmonize, or null for the whole skeleton. Passing an empty set does nothing,
// which is not the same as passing null.
//
// Returns the report `harmonizePathInPlace` produced, with each entry's point
// index replaced by the skeleton address it came from.
export function harmonizeSkeletonPoints(skeletonData, pointKeys = null, options = {}) {
  return runSkeletonCenterlinePass(skeletonData, pointKeys, (path, selected) =>
    harmonizePathInPlace(path, expandToJoints(path, selected), {
      roundCoordinates: true,
      ...options,
    })
  );
}

// Balancing reaches the centerline the same way harmonizing does, and for the
// same reason: a centerline is an ordinary path carrying ordinary smooth flags,
// and what it makes is regenerated from it afterwards. It takes the selection
// as given rather than expanding it to joints — balancing is a statement about
// a segment, and the segments a selection touches are the segments it means.
export function balanceSkeletonPoints(skeletonData, pointKeys = null) {
  return runSkeletonCenterlinePass(skeletonData, pointKeys, (path, selected) =>
    balancePathInPlace(path, selected)
  );
}

// Build the centerline as a path, run one ordinary path pass over it, and write
// back only the points that ended up somewhere else. Reports are addressed by
// contour and point id, because the path built here is thrown away.
function runSkeletonCenterlinePass(skeletonData, pointKeys, pass) {
  const path = new VarPackedPath();
  const addresses = [];
  const selected = [];
  for (const contour of skeletonData?.contours || []) {
    path.appendUnpackedContour({
      points: contour.points.map((point) => ({
        x: point.x,
        y: point.y,
        ...(point.type ? { type: point.type } : {}),
        ...(point.smooth ? { smooth: true } : {}),
      })),
      isClosed: contour.closed === true,
    });
    for (const point of contour.points) {
      if (!pointKeys || pointKeys.has(`${contour.id}/${point.id}`)) {
        selected.push(addresses.length);
      }
      addresses.push({ contourId: contour.id, point });
    }
  }
  if (!selected.length) {
    return [];
  }
  const report = pass(path, selected);
  // Only where the point ended up somewhere else. Writing the same number back
  // is still a recorded change, and a command that had nothing to do would take
  // an undo step for it.
  for (let index = 0; index < addresses.length; index++) {
    const moved = path.getPoint(index);
    const point = addresses[index].point;
    if (point.x !== moved.x) {
      point.x = moved.x;
    }
    if (point.y !== moved.y) {
      point.y = moved.y;
    }
  }
  return report.map((entry) => {
    const index = entry.pointIndex ?? entry.segmentIndex;
    return {
      ...entry,
      contourId: addresses[index]?.contourId,
      pointId: addresses[index]?.point.id,
    };
  });
}

// Cut a contour at one of its own on-curve points. A closed contour opens there
// and stays one contour; an open one becomes two, and the second is appended.
// The point sits at both ends of the cut: one copy keeps the id, the other takes
// a fresh one, because two points can never share a name.
//
// Returns the ids of the contours the cut produced, or null when there is
// nothing to cut — a handle, a point that is not on this contour, or an open
// contour's own end, which is already where a contour stops.
//
// Every segment survives. Rotating a closed contour to start at the cut keeps
// the segment that used to close it, and cutting an open one at an on-curve
// leaves each handle pair on the side it was drawn for, so nothing is orphaned
// and nothing has to be dropped.
export function splitSkeletonContourAtPoint(skeletonData, contourId, pointId) {
  const contour = getSkeletonContour(skeletonData, contourId);
  if (!contour) {
    return null;
  }
  const index = contour.points.findIndex((point) => point.id === pointId);
  if (index < 0 || contour.points[index].type) {
    return null;
  }

  // An end made by a cut has stroke on one side only, so it cannot be smooth:
  // a smooth point carrying a single handle is what ties the ribs across a
  // straight, and a cut is not a request to tie anything.
  const openEnd = (point) => ({ ...deepCopyObject(point), smooth: false });
  const renamed = (point) => ({
    ...openEnd(point),
    id: allocateSkeletonId(skeletonData),
  });

  if (contour.closed) {
    contour.points = [
      openEnd(contour.points[index]),
      ...contour.points.slice(index + 1),
      ...contour.points.slice(0, index),
      renamed(contour.points[index]),
    ];
    contour.closed = false;
    return [contour.id];
  }

  const onCurveIndices = contour.points
    .map((point, i) => (point.type ? -1 : i))
    .filter((i) => i >= 0);
  if (index === onCurveIndices[0] || index === onCurveIndices.at(-1)) {
    return null;
  }

  const tail = [renamed(contour.points[index]), ...contour.points.slice(index + 1)];
  contour.points = [...contour.points.slice(0, index), openEnd(contour.points[index])];
  // The new contour is the old one in everything but its points and its name,
  // so it draws the same stroke on the same terms.
  const second = appendSkeletonContour(skeletonData, {
    ...deepCopyObject(contour),
    id: undefined,
    points: tail,
  });
  return [contour.id, second.id];
}

// Reverse the order a centerline is travelled in.
//
// Nothing moves. What turns over is the frame every stored number is written
// against: the tangent points the other way, so the side that was left of it is
// now right of it, and a handle that led OUT of a point now leads INTO it. Three
// transpositions follow, and all three are needed - the fork found each of the
// equivalents separately when mirroring was built.
//
//   1. Side ownership, on every per-side field.
//   2. Handle role, which combines with the side: leftOut becomes rightIn.
//   3. A curvature pin, which is keyed on its segment's START point (feature
//      model section 7). Reversed, that segment starts at its other end, so the
//      pin travels there or it states the tension of a curve nobody asked about.
//
// Absolute directions are left alone, and this is the difference from a mirror.
// A mirror reflects the plane, so `capAngle` and a serif's axis angle negate. A
// reversal moves no geometry at all, so a direction named in glyph space still
// means what it meant.
export function reverseSkeletonContourPoints(contour) {
  const reversed = deepCopyObject(contour);
  reversed.points = reversed.points.slice().reverse();

  for (const point of reversed.points) {
    if (point.type) {
      continue;
    }
    for (const field of ["width", "nudge", "handleNudge", "locked", "corner"]) {
      swapProperties(point[field], "left", "right");
    }
    // Side and role turn over together, so the two diagonals exchange.
    swapProperties(point.handleOffsets, "leftOut", "rightIn");
    swapProperties(point.handleOffsets, "leftIn", "rightOut");
    point.capBallSide = swapSideName(point.capBallSide);
    if (point.serif && typeof point.serif === "object") {
      point.serif.sides = swapSideName(point.serif.sides);
    }
  }

  // The pins, in one pass over the reversed list, because moving one to its new
  // owner would otherwise overwrite a pin not yet read.
  const onCurves = reversed.points.filter((point) => !point.type);
  const pins = onCurves.map((point) => point.segmentCurvature);
  for (const [index, point] of onCurves.entries()) {
    // Reversed, the segment leaving this point is the one that used to leave its
    // successor in the new order. The last point leaves nothing, and on a closed
    // contour it leaves the closing segment, which was the first point's.
    const source = reversed.closed ? pins[(index + 1) % pins.length] : pins[index + 1];
    point.segmentCurvature = normalizeSegmentCurvature(
      source ? { left: source.right, right: source.left } : null
    );
  }
  return reversed;
}

// Which end of an open contour a point is, or null where it is neither.
function skeletonOpenEndRole(contour, pointId) {
  if (!contour || contour.closed) {
    return null;
  }
  const onCurves = contour.points.filter((point) => !point.type);
  if (onCurves.length < 1) {
    return null;
  }
  if (onCurves[0].id === pointId) {
    return "head";
  }
  return onCurves.at(-1).id === pointId ? "tail" : null;
}

// Two ends standing in the same place are one place. The designer put them
// there, usually by snapping one onto the other, so the coordinates agree
// exactly and the test is equality rather than a tolerance: a tolerance would
// decide that two points a third of a unit apart are the same point, which is a
// judgement nobody asked this function to make.
function skeletonPointsCoincide(first, second) {
  return first.x === second.x && first.y === second.y;
}

// Close an open contour on the two ends it already has.
//
// No point is moved and none is added. Where the two ends already stand in the
// same place the last is dropped instead, so a stroke drawn back onto its own
// start closes into the loop it already draws rather than gaining a second point
// on top of the first. The handles that led into the dropped end stay, and shape
// the closing segment into the point that survives.
export function closeSkeletonContour(skeletonData, contourId) {
  const contour = getSkeletonContour(skeletonData, contourId);
  if (!contour || contour.closed) {
    return false;
  }
  const onCurveIndices = contour.points
    .map((point, index) => (point.type ? -1 : index))
    .filter((index) => index >= 0);
  if (onCurveIndices.length < 2) {
    return false;
  }
  const first = contour.points[onCurveIndices[0]];
  const last = contour.points[onCurveIndices.at(-1)];
  if (skeletonPointsCoincide(first, last)) {
    // One on-curve and nothing between the two ends is a point, not a loop.
    if (onCurveIndices.length === 2 && contour.points.length === 2) {
      return false;
    }
    contour.points.splice(onCurveIndices.at(-1), 1);
  }
  contour.closed = true;
  return true;
}

// Join two open ends into one contour.
//
// Where both ends belong to one contour this is a close, and it answers that
// way: the designer selected the two ends of a stroke and asked for them to
// meet, and which of the two operations that is is the machine's problem.
//
// Otherwise the second contour is absorbed into the first, and whichever of the
// two must be turned around is reversed through the transposition above. The
// absorbed contour's id is retired and never reused, like every skeleton id.
export function joinSkeletonContours(skeletonData, firstEnd, secondEnd) {
  const first = getSkeletonContour(skeletonData, firstEnd?.contourId);
  const second = getSkeletonContour(skeletonData, secondEnd?.contourId);
  const firstRole = skeletonOpenEndRole(first, firstEnd?.pointId);
  const secondRole = skeletonOpenEndRole(second, secondEnd?.pointId);
  if (!firstRole || !secondRole) {
    return null;
  }

  if (first === second) {
    if (firstRole === secondRole) {
      return null; // one end asked to meet itself
    }
    return closeSkeletonContour(skeletonData, first.id)
      ? { contourId: first.id, closed: true }
      : null;
  }

  // The survivor keeps its own direction wherever it can. A tail meeting a head
  // needs nothing turned around; the other three cases each turn exactly one
  // contour, and never both.
  let head = first;
  let tail = second;
  if (firstRole === "head" && secondRole === "tail") {
    head = second;
    tail = first;
  } else if (firstRole === "head" && secondRole === "head") {
    head = reverseSkeletonContourPoints(first);
  } else if (firstRole === "tail" && secondRole === "tail") {
    tail = reverseSkeletonContourPoints(second);
  }

  const survivor = head === second ? second : first;
  const absorbed = survivor === first ? second : first;
  // Where the two ends already stand in the same place they are one point, and
  // the survivor keeps its own. What the dropped end carried in front of it -
  // the handles leaving it - stays, and shapes the segment leaving the joint.
  let tailPoints = tail.points;
  const joint = head.points.at(-1);
  const tailFirst = tailPoints.findIndex((point) => !point.type);
  if (tailFirst >= 0 && joint && skeletonPointsCoincide(joint, tailPoints[tailFirst])) {
    tailPoints = tailPoints.slice(tailFirst + 1);
  }
  survivor.points = [...head.points, ...tailPoints];
  survivor.closed = false;
  skeletonData.contours = skeletonData.contours.filter(
    (contour) => contour !== absorbed
  );
  return { contourId: survivor.id, closed: false };
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
  targetPoint.ribAngleLockMode =
    sourcePoint.ribAngleLockMode ?? DEFAULT_RIB_ANGLE_LOCK_MODE;
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

  // On-curve points that sat next to something the deletion takes away: the
  // segment on that side changes shape under them, so a smooth flag they carry
  // now describes a neighbourhood that no longer exists.
  const disturbedOnCurveIds = new Set();
  for (const idx of deleteSet) {
    for (const direction of [-1, 1]) {
      const neighbor = findSurvivingOnCurve(
        points,
        idx,
        deletedOnCurves,
        isClosed,
        direction
      );
      if (neighbor !== null) {
        disturbedOnCurveIds.add(points[neighbor].id);
      }
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

  fixSkeletonSmoothFlags(newPoints, isClosed, disturbedOnCurveIds);
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
function fixSkeletonSmoothFlags(points, isClosed, disturbedIds = null) {
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
      continue;
    }
    // One side is a straight segment now, and the point is still smooth: its
    // surviving handle has to lie on that segment's continuation. Left where
    // the deletion found it, the outline generator obeys the smooth flag by
    // throwing its own handles the other way, and the shape folds over itself
    // until the next edit realigns the handle.
    if (
      (!prevPoint?.type || !nextPoint?.type) &&
      (!disturbedIds || disturbedIds.has(point.id))
    ) {
      alignSkeletonSmoothHandles(point, prevPoint, nextPoint);
    }
  }
}

// Put the off-curve neighbors of a smooth skeleton point into a collinear
// position, mirroring toggleSmooth's handle fix-up on regular paths.
export function alignSkeletonSmoothHandles(anchorPoint, prevPoint, nextPoint) {
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

// How wide the stroke actually is at a place on the centerline, measured against the
// outline that is already drawn there.
//
// A point put into an existing stroke has to take the width the stroke has where it
// lands, or the stroke pinches or bulges at the new point. That width is not stored
// anywhere between two skeleton points -- only the two ends carry one -- so it is
// measured: a ray leaves the centerline square to it and stops at the first generated
// edge it meets, once each way.
//
// Left and right follow the generator's own convention: the travel direction turned a
// quarter clockwise is the left side.
//
// Returns {left, right}, or null when either side has no edge to stop at.
export function measureGeneratedHalfWidths(
  skeletonData,
  contourId,
  path,
  position,
  direction
) {
  const outline = generatedOutlineSubPath(skeletonData, contourId, path);
  if (!outline || !outline.numContours) {
    return null;
  }
  const travel = normalizeVector(direction);
  if (!Number.isFinite(travel.x) || !Number.isFinite(travel.y)) {
    return null;
  }
  const normal = rotateVector90CW(travel);
  const hitTester = new PathHitTester(outline, outline.getControlBounds());

  // A stroke drawn on one side only has its other edge lying on the centerline itself,
  // so a ray sent that way meets nothing belonging to this stroke and comes back with
  // whatever else it ran into. Only the drawn side is measured, and the answer is split
  // evenly between the two halves: the two halves add up to the width that is drawn,
  // which is the number the generator reads, and nothing in the drawing says how a
  // single-sided stroke divided it.
  const drawnSide = getSkeletonContour(skeletonData, contourId)?.singleSided;
  if (drawnSide === "left" || drawnSide === "right") {
    const measured = firstEdgeDistance(
      hitTester,
      position,
      drawnSide === "left" ? normal : mulVectorScalar(normal, -1)
    );
    return measured === null ? null : { left: measured / 2, right: measured / 2 };
  }

  const left = firstEdgeDistance(hitTester, position, normal);
  const right = firstEdgeDistance(hitTester, position, mulVectorScalar(normal, -1));
  return left === null || right === null ? null : { left, right };
}

// Just the contours this skeleton contour generated, so the ray cannot stop on some
// other stroke that happens to lie across it.
function generatedOutlineSubPath(skeletonData, contourId, path) {
  if (!path) {
    return null;
  }
  const outline = new VarPackedPath();
  for (const entry of skeletonData?.generated || []) {
    if (entry.skeletonContourId !== contourId) {
      continue;
    }
    const contourIndex = entry.pathContourIndex;
    if (!Number.isInteger(contourIndex) || contourIndex >= path.numContours) {
      continue;
    }
    outline.appendUnpackedContour(path.getUnpackedContour(contourIndex));
  }
  return outline;
}

// The nearest crossing in front of the origin. Anything at or behind it is the edge on
// the other side, or the centerline's own place in a single-sided stroke.
const EDGE_DISTANCE_EPSILON = 1e-6;

function firstEdgeDistance(hitTester, origin, direction) {
  let nearest = null;
  for (const crossing of hitTester.rayIntersections(origin, direction)) {
    const along = dotVector(subVectors(crossing, origin), direction);
    if (along > EDGE_DISTANCE_EPSILON && (nearest === null || along < nearest)) {
      nearest = along;
    }
  }
  return nearest;
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
  if (isSkeletonSideLocked(point, side, "slide")) {
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
  { linked = point?.width?.linked !== false, round = Math.round, force = false } = {}
) {
  assertSkeletonRibSide(side);
  const otherSide = side === "left" ? "right" : "left";
  // The lowest width writer, so this is where the width lock has to bite: every
  // route to a half-width comes through here, the fixed-rib drag included.
  // `force` is for the act of locking itself, which must write the number the
  // edge is standing at.
  if (!force && isSkeletonSideLocked(point, side, "width")) {
    return;
  }
  // A linked write moves both sides by the same delta. With the other side
  // locked, that half of the write is refused and this one goes alone.
  const carryToOtherSide =
    linked && (force || !isSkeletonSideLocked(point, otherSide, "width"));
  const width = normalizeWidth(point?.width);
  const value = Math.max(0, round(halfWidth));
  if (carryToOtherSide) {
    // Both sides move by the same delta, which preserves left − right. That is a
    // statement about the two EDGES, and it is what the fixed-rib drag wants: it
    // holds one edge while the point follows the cursor.
    //
    // It is NOT what the distribution means, and this function is no longer the
    // one a designer's per-side write goes through. Use
    // setSkeletonPointWidthFromSide for that — it preserves the share, which is
    // the distribution the panel shows.
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
    collapsedByCurvature: offset?.collapsedByCurvature === true,
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
      ...markCollapsedByCurvature(offset?.collapsedByCurvature),
    },
  };
}

// Which control drove this handle onto its point. The curvature gizmo stores a
// displacement below the pin's floor, because the pin's number reads zero for
// every length left down there, and it releases its OWN displacement on the way
// back up. A handle the designer put on its point by hand carries no mark and is
// left where it was put.
//
// Stored only where it is true, so an ordinary handle offset keeps the shape it
// always had. The reader reports it as a plain boolean either way.
//
// Not OR'd with the existing state, unlike `detached`: any later write that does
// not claim the mark is a new statement about this handle, and it takes
// ownership away from the gizmo.
function markCollapsedByCurvature(collapsedByCurvature) {
  return collapsedByCurvature === true ? { collapsedByCurvature: true } : {};
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
    handleOffsets[key] = {
      x: offset.x,
      y: offset.y,
      detached: detached === true,
      // The detach flag says how the handle is placed, not who placed it, so it
      // carries the collapse mark across unchanged.
      ...markCollapsedByCurvature(offset.collapsedByCurvature),
    };
  }
  point.handleOffsets = handleOffsets;
}

// The one rule for every width write that names a side: the rib gizmo on canvas,
// the panel's left and right boxes, and the label scrubs on both of them. They
// are the same statement made three ways, so they go through one function.
//
// Linked preserves the SHARE, not the difference. Moving both sides by one delta
// preserves left − right, which is a different statement: on a 60/0 point it
// answers a drag of 10 with 70/10, and the distribution the designer set has
// gone from 100 to 75. So a linked write states a TOTAL through this side's
// share, which is the panel's total-width write reached through one side.
//
// Unlinked, the two sides are independent numbers and the write states one.
//
// A side holding zero has no share, so it cannot state a total: zero times any
// total is zero. That rib is pinned on the centerline, and only the distribution
// or the total lifts it off. Returns false there, so a caller can leave the
// width alone and still apply a drag's nudge.
//
// `independent` is the A modifier: for the length of one drag the write states
// this side alone, whatever the link says, and the far side stays exactly where
// it stands. The stored link flag is read and never written, so releasing A
// returns the point to the linkage the designer chose, with a new distribution.
// It dissolves the zero-share refusal above, because there is no share left to
// refuse on — which is how a rib pinned on the centerline is lifted off it.
export function setSkeletonPointWidthFromSide(
  point,
  defaultWidth,
  side,
  halfWidth,
  { round = Math.round, independent = false } = {}
) {
  assertSkeletonRibSide(side);
  // A width-locked side holds its edge, so it refuses to be written at all.
  // A does not lift this: the lock is a stored hold on one edge, not a statement
  // about how the two sides travel together.
  if (isSkeletonSideLocked(point, side, "width")) {
    return false;
  }
  const otherSide = side === "left" ? "right" : "left";
  if (independent) {
    const linked = point?.width?.linked !== false;
    setSkeletonPointSideWidth(point, defaultWidth, side, halfWidth, {
      linked: false,
      round,
    });
    point.width.linked = linked;
    clearCollapsedRibSides(point);
    return true;
  }
  // The lock overrides the distribution: with the other side held, this one is
  // written alone and the share is not carried across.
  if (
    point?.width?.linked === false ||
    isSkeletonSideLocked(point, otherSide, "width")
  ) {
    setSkeletonPointSideWidth(point, defaultWidth, side, halfWidth, {
      linked: false,
      round,
    });
    return true;
  }
  const width = normalizeWidth(point?.width);
  const total = width.left + width.right;
  const share = total > 0 ? width[side] / total : 0.5;
  if (!(share > 0)) {
    return false;
  }
  // The dragged side lands exactly where the cursor put it, and the other side
  // is derived from the share. The total-width writer rounds the other way round,
  // because there the total is what was asked for.
  const value = Math.max(0, round(halfWidth));
  width[side] = value;
  width[otherSide] = Math.max(0, round((value * (1 - share)) / share));
  point.width = width;
  clearCollapsedRibSides(point);
  return true;
}

export function setSkeletonPointTotalWidth(
  point,
  defaultWidth,
  totalWidth,
  { round = Math.round } = {}
) {
  // Both halves are rewritten here, so a lock on either one holds the whole.
  if (
    isSkeletonSideLocked(point, "left", "width") ||
    isSkeletonSideLocked(point, "right", "width")
  ) {
    return;
  }
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

export function setSkeletonPointRibAngleLockMode(point, mode) {
  point.ribAngleLockMode = VALID_RIB_ANGLE_LOCK_MODES.has(mode)
    ? mode
    : DEFAULT_RIB_ANGLE_LOCK_MODE;
}

export function setSkeletonContourSingleSided(contour, sideOrNull) {
  contour.singleSided = VALID_SINGLE_SIDED.has(sideOrNull) ? sideOrNull : null;
}

// Which way round the generated outline runs. It flips the winding of what the
// generator emits and leaves the centerline exactly as it was drawn, which is
// what "reverse contour" asks of a stroke: the letter's fill direction changes,
// the drawing does not. Reversing the point order instead would swap which side
// is left, and every per-side field would have to travel with it.
export function setSkeletonContourReversed(contour, reversed) {
  contour.reversed = reversed === true;
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
    // The ease distance stops where the rounding runs out of bracket to eat.
    // Every path into a serif comes through here — the panel field, the scrub,
    // a preset — so the ceiling belongs here rather than on any one of them,
    // and it is re-applied on every write because moving the wing or the reach
    // moves the ceiling.
    serif[side].easeDistance = Math.min(
      serif[side].easeDistance,
      Math.round(maxSerifEaseDistance(serif[side]))
    );
  }
  if (VALID_SERIF_AXIS_MODES.has(values.axisMode)) {
    serif.axisMode = values.axisMode;
  }
  if ("linked" in values) {
    serif.linked = values.linked === true;
  }
  if (VALID_SERIF_SIDES.has(values.sides)) {
    serif.sides = values.sides;
  }
  for (const field of SERIF_TERMINAL_FIELDS) {
    if (!(field in values)) {
      continue;
    }
    const value = values[field];
    // The two angles keep what they hold rather than dropping to zero. Both sit
    // behind a mode, on a summary slider, and a mixed selection delivers an
    // empty value through it — zeroing every terminal from that is not what the
    // designer touched. Every other terminal field takes an emptied box as zero.
    serif[field] = Number.isFinite(value)
      ? value
      : field === "axisAngle" || field === "axisTilt"
        ? serif[field]
        : 0;
  }
  // The balance runs tip to tip and stops there. Bounded here rather than in the
  // geometry alone, so the number the panel shows is the number that draws: a
  // field that keeps counting past a shape which has already stopped is the
  // defect this writer exists to prevent.
  serif.undersideCupBalance = Math.min(Math.max(serif.undersideCupBalance, -1), 1);
  point.serif = serif;
}

// A preset is ONE wing plus the underside cup, which is per terminal. Applying
// it writes that wing to both sides. Asymmetry is a decision about the terminal
// being edited, not about the shape that was saved, so the link flag does not
// travel with a preset and a preset never stores two different wings.
export const SERIF_PRESET_FIELDS = Object.freeze([
  ...SERIF_HALF_FIELDS,
  "undersideCup",
  "undersideCupTension",
  "undersideCupBalance",
]);

function normalizeSerifPreset(preset) {
  const normalized = {};
  for (const field of SERIF_PRESET_FIELDS) {
    // A preset written before the wings collapsed carries a `left` block.
    const raw = preset?.[field] ?? preset?.left?.[field];
    const value = Number(raw);
    // A preset saved before the cup gained its tension keeps the foot it was
    // captured with, the same as a terminal does.
    normalized[field] = Number.isFinite(value)
      ? value
      : (SERIF_FIELD_DEFAULTS[field] ?? 0);
  }
  return normalized;
}

// Ported from the serif lab, whose numbers are drawn at stem width 150 and are
// already one wing. Lengths divide by 7.5 onto this project's 20-unit scale.
// The tip cut is an angle and the two bracket numbers are ratios, so all three
// carry across untouched. The lab predates contour easing, so that pair is 0.
//
// Egyptian is the shape a terminal gets when it becomes a serif. It is the
// plain slab: three 20s and nothing else.
export const SERIF_PRESETS = Object.freeze(
  [
    { name: "Egyptian", wingLength: 20, tipThickness: 20, wingSlope: 20 },
    {
      name: "Clarendon",
      wingLength: 18,
      tipThickness: 10,
      wingSlope: 1,
      reach: 19,
      tension: 0.9,
      concavity: 0.85,
    },
    {
      name: "Didone",
      wingLength: 19,
      tipThickness: 3,
      reach: 13,
      tension: 0.7,
      concavity: 0.8,
    },
    {
      name: "Old style",
      wingLength: 15,
      tipThickness: 5,
      wingSlope: 7,
      tipCutAngle: 22,
      undersideCup: 3,
      reach: 20,
      tension: 0.62,
      concavity: 0.66,
    },
    {
      name: "Wedge",
      wingLength: 13,
      tipThickness: 2,
      wingSlope: 13,
      reach: 5,
      tension: 0.05,
      concavity: -0.18,
    },
  ].map((preset) =>
    Object.freeze({ name: preset.name, ...normalizeSerifPreset(preset) })
  )
);

export const DEFAULT_SERIF_PRESET = SERIF_PRESETS[0];

// One wing off a drawn terminal. The left one: a preset holds a single wing, so
// capturing an asymmetric terminal has to pick, and picking silently is better
// than refusing a shape the designer can see.
export function captureSerifPreset(point) {
  const serif = normalizeSerif(point?.serif);
  return normalizeSerifPreset({
    ...serif.left,
    undersideCup: serif.undersideCup,
    undersideCupTension: serif.undersideCupTension,
    undersideCupBalance: serif.undersideCupBalance,
  });
}

// The partial the serif writer takes. Scope "both" puts the one wing on both
// sides; a single side leaves the other wing and the cup alone.
export function applySerifPreset(preset, { scope = "both" } = {}) {
  const wing = normalizeSerifPreset(preset);
  const cup = wing.undersideCup;
  const cupTension = wing.undersideCupTension;
  const cupBalance = wing.undersideCupBalance;
  delete wing.undersideCup;
  delete wing.undersideCupTension;
  delete wing.undersideCupBalance;
  if (scope === "left" || scope === "right") {
    return { [scope]: wing };
  }
  return {
    left: wing,
    right: { ...wing },
    undersideCup: cup,
    undersideCupTension: cupTension,
    undersideCupBalance: cupBalance,
  };
}

export function makeSerifPreset(name = "Serif") {
  return { name, ...normalizeSerifPreset(DEFAULT_SERIF_PRESET) };
}

export function setSkeletonCornerParameters(point, values, { round = null } = {}) {
  if (!values || typeof values !== "object") {
    return;
  }
  const corner = normalizeCorner(point.corner);
  if ("linked" in values) {
    corner.linked = values.linked === true;
  }
  // The bound lives here because the scrub, the typed field and a preset are
  // three ways into the same number, and only the writer sits under all of them
  // (dev log §29).
  const sides =
    corner.linked || !values.side ? ["left", "right"] : [assertCornerSide(values.side)];
  for (const side of sides) {
    if (Number.isFinite(values.distance)) {
      const distance = round ? round(values.distance) : values.distance;
      corner[side].distance = Math.max(0, distance);
    }
    if (Number.isFinite(values.curvature)) {
      corner[side].curvature = clampCornerCurvature(values.curvature);
    }
  }
  point.corner = corner;
}

function assertCornerSide(side) {
  if (side !== "left" && side !== "right") {
    throw new Error(`invalid skeleton corner side: ${side}`);
  }
  return side;
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

// Is one named freedom of this side blocked? The kind is required: there is no
// such thing as "locked" on its own any more.
export function isSkeletonSideLocked(point, side, kind) {
  assertSkeletonRibSide(side);
  assertSkeletonLockKind(kind);
  return normalizeLocked(point?.locked)[side][kind];
}

// Any lock at all on this side. For questions about the side as a whole, never
// as a stand-in for one of the three.
export function isSkeletonSideLockedAtAll(point, side) {
  assertSkeletonRibSide(side);
  const locks = normalizeLocked(point?.locked)[side];
  return SKELETON_LOCK_KINDS.some((kind) => locks[kind]);
}

export function setSkeletonSideLocked(point, side, kind, locked) {
  assertSkeletonRibSide(side);
  assertSkeletonLockKind(kind);
  const next = normalizeLocked(point?.locked);
  next[side][kind] = locked === true;
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
    "corner",
  ]) {
    swapProperties(point[field], "left", "right");
  }
  swapProperties(point.handleOffsets, "leftIn", "rightIn");
  swapProperties(point.handleOffsets, "leftOut", "rightOut");
  point.capBallSide = swapSideName(point.capBallSide);
  // Swapping the two halves moves the shapes; which sides are built has to
  // follow them, or a mirrored one-sided serif appears on the wrong wing.
  if (point.serif && typeof point.serif === "object") {
    point.serif.sides = swapSideName(point.serif.sides);
  }
  if (Number.isFinite(point.capAngle)) {
    point.capAngle = -point.capAngle;
  }
  // The absolute serif axis angle is a direction in glyph space, so it reflects
  // like capAngle. `axisMode` does not: horizontal stays horizontal under a
  // mirror. `tipCutAngle` and `wingSlope` also do not, because they are measured
  // inside their own half's frame and swapping the halves is the whole
  // correction.
  if (Number.isFinite(point.serif?.axisAngle)) {
    point.serif.axisAngle = -point.serif.axisAngle;
  }
  // The tilt negates too, and for its own reason rather than by analogy. A
  // mirror takes the frame to (-M(axis), M(depth)): the axis is re-oriented to
  // the new left while depth still points into the stroke. A tilt of θ on the
  // old frame is a tilt of -θ on that one.
  if (Number.isFinite(point.serif?.axisTilt)) {
    point.serif.axisTilt = -point.serif.axisTilt;
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

// The group a rib WOULD be tied into, reading the geometry and ignoring every
// opt-out flag in it.
//
// `getTiedRibGroup` answers what is tied; this answers what could be. The two
// differ exactly where the flag is off, which is the case the flag has to be
// written across: once a straight is freed there is no effective group left to
// carry a re-tie to, so a write that asked the effective group would be a one-way
// door.
export function getSkeletonRibTieGroup(contour, point) {
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
      () => true,
      collectSerifTerminals(segments, isClosed, contour.capStyle)
    ).get(point) || null
  );
}

// Tie or free a straight, from either of its ends.
//
// The flag describes a straight, not a rib: freeing one end frees the segment,
// so the other end's stored flag would go on saying "tied" about a straight that
// is not. The panel then reads the pair as mixed and the designer is looking at
// a checkbox that disagrees with itself. One write, every member.
export function setSkeletonRibTiedAcrossGroup(contour, point, tied) {
  const group = getSkeletonRibTieGroup(contour, point) || [point];
  for (const member of group) {
    setSkeletonPointWidthTied(member, tied);
  }
}

// The half-width the generator will actually use for this rib: the stored value,
// or the mean across a tied group, matching coupledHalfWidths in
// skeleton-generator.js. Rendering and hit-testing must use this rather than the
// stored value, or the gizmo sits somewhere the outline is not.
export function getEffectiveRibHalfWidth(contour, point, side) {
  const group = getTiedRibGroup(contour, point);
  // A width-locked side holds its own edge, so it keeps its own number rather
  // than following the tied group's mean. Otherwise a sibling's width drag
  // would move the locked edge through that mean, which is the thing the lock
  // exists to stop.
  if (!group || isSkeletonSideLocked(point, side, "width")) {
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
  // A forced rib is the cut across the stroke, not a measure of it, so its end
  // reaches the edge the stroke's own width puts there rather than stopping at
  // the width itself.
  const reach = skeletonRibReach(contour, pointIndex >= 0 ? pointIndex : point.id);
  return projectSkeletonRibPoint(point, normal, halfWidth * reach, side, nudge);
}

// Both ends of one point's rib. In a single-sided contour one end is the
// centerline itself, because that side is collapsed onto the skeleton. Null
// where the point states no rib on that side.
export function getSkeletonRibEndpoints(contour, point) {
  const activeSingleSide =
    contour.singleSided === "left" || contour.singleSided === "right"
      ? contour.singleSided
      : null;
  return {
    left:
      activeSingleSide === "right"
        ? point
        : getSkeletonRibPosition(contour, point, "left"),
    right:
      activeSingleSide === "left"
        ? point
        : getSkeletonRibPosition(contour, point, "right"),
  };
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
    ribReach: skeletonRibReach(contour, pointIndex),
  };
}

export function createSkeletonRibExecutor(
  address,
  behaviorName = "rib-default",
  { interpolationAxis = null, carryNudgeToHandles = false } = {}
) {
  const { contour, point, side, defaultWidth, normal } = address;
  // A forced rib's end stands further out than the width it states, so a drag
  // of that end covers more ground than the width it is changing.
  const ribReach = address.ribReach || 1;
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
  const adjustable = !isSkeletonSideLocked(point, side, "slide");
  const forceTangent =
    behaviorName === "rib-tangent" || behaviorName === "rib-tangent-interpolate";
  // A: this side's width is written alone. Published on every frame's result
  // rather than read from the name again downstream, so the write and the drag
  // that asked for it cannot disagree.
  const independent = behaviorName === "rib-independent";
  const interpolateRequested =
    behaviorName === "rib-interpolate" || behaviorName === "rib-tangent-interpolate";
  const interpolate = adjustable && interpolateRequested;
  // Alt-drag asks the rib to slide along its axis and nothing else. On a
  // slide-locked side there is nothing for it to do, so the whole gesture is
  // refused rather than falling through to the plain width drag - which would
  // change the width by whatever part of the drag missed the axis.
  const frozen = interpolateRequested && !adjustable;
  const axis = interpolate
    ? interpolationAxis || { dir: tangent, hasHandle: {} }
    : null;
  return {
    contourId: contour.id,
    pointId: point.id,
    side,
    normal,
    applyDelta(delta, { constrainMode = null, round = Math.round } = {}) {
      if (frozen) {
        return {
          halfWidth: originalHalfWidth,
          nudge: originalNudge,
          handleNudge: originalHandleNudge,
          side,
          independent,
        };
      }
      if (axis) {
        const deltaAlongAxis = delta.x * axis.dir.x + delta.y * axis.dir.y;
        const axisDotTangent = axis.dir.x * tangent.x + axis.dir.y * tangent.y;
        const deltaNudge = axisDotTangent * deltaAlongAxis;
        return {
          halfWidth: originalHalfWidth,
          nudge: round(originalNudge + deltaNudge),
          handleNudge: originalHandleNudge,
          side,
          independent,
        };
      }
      const normalSign = side === "left" ? 1 : -1;
      const normalDelta =
        (normalSign * (delta.x * normal.x + delta.y * normal.y)) / ribReach;
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
      return { halfWidth, nudge, handleNudge, side, independent };
    },
  };
}

export function applySkeletonRibExecutorResult(address, result) {
  const { contour, point, side, defaultWidth } = address;
  if (contour.singleSided === "left" || contour.singleSided === "right") {
    setSingleSidedTotalWidth(point, defaultWidth, side, result.halfWidth);
  } else {
    // A zero-share side refuses, and the nudge below still applies. Under A
    // there is no share to refuse on, so that side lifts off the centerline.
    setSkeletonPointWidthFromSide(point, defaultWidth, side, result.halfWidth, {
      independent: result.independent === true,
    });
  }
  if (!isSkeletonSideLocked(point, side, "slide")) {
    setSkeletonPointSideNudge(point, side, result.nudge);
  }
  if (!isSkeletonSideLocked(point, side, "handles")) {
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
  // In a single-sided contour the visible width is the sum of the two stored
  // halves, so a lock on the side carrying it holds the whole edge.
  if (isSkeletonSideLocked(point, side, "width")) {
    return;
  }
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
    capCurvatureField: provenance.capCurvatureField ?? null,
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
  // A bulb's neck names the cap-owning point so its curvature gizmo can find it.
  // Its points are not that point's rib geometry, though, so they are not
  // directly editable: dragging one would move the rib the neck hangs off.
  if (provenance.capCurvatureField) return null;
  if (provenance.point?.type) return null;
  // Each gizmo answers to its own lock: the on-curve to the slide lock, the two
  // handles to the handle lock.
  const lockKind = provenance.role === "onCurve" ? "slide" : "handles";
  if (isSkeletonSideLocked(provenance.point, provenance.side, lockKind)) return null;
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
  return buildContourSegments(points, closed);
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

// The single definition of the coupling lives in offset-contour.js. What the
// skeleton adds is its own opt-out — `width.tied` on either end frees a straight
// from the shared offset — and its serif terminals, both of which are fields a
// base contour does not have.
export function collectTiedRibGroups(
  segments,
  isClosed,
  isTied = ribTiedByDefault,
  serifTerminals = new Set()
) {
  return collectCoupledPointGroups(segments, isClosed, isTied, serifTerminals);
}

// The generic normal plus the skeleton's per-point rib-angle override, which is
// a pure post-transform of the result and so composes after it.
// How far a forced rib may reach for its edge, as a multiple of the half-width.
// Four is two full stroke widths, the same bound the corner join and the
// ordinary-outline offset drag both hold. It bites where the rib is turned past
// about 76 degrees, which is a rib running nearly along the centerline and
// reaching for an edge nearly parallel to it.
export const RIB_ANGLE_LOCK_LIMIT = 4;

/**
 * How far along a forced rib the outline sits, as a multiple of the half-width.
 *
 * A rib angle lock turns the rib off the perpendicular, and the point's own mode
 * says what that holds on to.
 *
 * In `stroke` mode the stroke stays as wide as its stored width. The outline
 * point stays on the edge it was always on, so the forced rib runs one over the
 * cosine of the angle it was turned through to reach it. Every master then draws
 * the width its panel states.
 *
 * In `rib` mode the rib itself is the stored width long. The stroke it is turned
 * across draws thinner, by that same cosine. This is the one that interpolates:
 * a fixed offset along a fixed direction blends exactly, while one over a cosine
 * curves upward and a weight between two masters comes out too wide.
 *
 * One is the answer wherever no lock is in force.
 *
 * The single copy. The generator imports it, so the drawn edge and the rib bar
 * cannot disagree about where that edge is (rail R-B).
 */
export function ribAngleLockReach(point, forcedNormal, unlockedNormal) {
  if (!point?.ribAngleLock) {
    return 1;
  }
  if ((point.ribAngleLockMode ?? DEFAULT_RIB_ANGLE_LOCK_MODE) === "rib") {
    return 1;
  }
  const cosTurn = Math.abs(
    forcedNormal.x * unlockedNormal.x + forcedNormal.y * unlockedNormal.y
  );
  return cosTurn > 1 / RIB_ANGLE_LOCK_LIMIT ? 1 / cosTurn : RIB_ANGLE_LOCK_LIMIT;
}

// The rib's direction at a point, both before and after any forced angle, and
// how far along the forced one the outline sits. One walk of the contour
// answers all three, and the two exported readers below each take what they
// need from it.
function skeletonRibGeometry(skeletonContour, pointIndexOrPointId) {
  const points = skeletonContour?.points || [];
  const pointIndex =
    pointIndexOrPointId >= 0 && pointIndexOrPointId < points.length
      ? pointIndexOrPointId
      : points.findIndex((point) => point.id === pointIndexOrPointId);
  // At a corner the outline's own points stand where the two offset edges of a
  // side meet, out along the line that splits the corner. The bar lies on that
  // line and reaches that far, so its ends land on the points the outline draws.
  // Where the outline holds the corner instead — folded back, or past the miter
  // limit — the bar holds with it, square to the arriving arm. Every other point
  // keeps the answer it had.
  const corner = cornerRibPlacement(points, skeletonContour?.closed, pointIndex);
  const unlocked =
    corner?.normal ??
    calculateContourNormalAtPoint(points, skeletonContour?.closed, pointIndex);
  const cornerScale = corner?.scale ?? 1;
  const point = points[pointIndex];
  if (!point || point.type) {
    return { normal: unlocked, unlocked, reach: cornerScale };
  }
  const normal = getEffectiveNormal(point, unlocked);
  // A forced rib replaces the split line outright, and the generator ends each
  // arm on the forced rib rather than at a meeting place. So a lock takes the
  // corner's reach off the bar along with its direction; the two reaches are
  // answers to the same question and never multiply.
  return {
    normal,
    unlocked,
    reach: point.ribAngleLock
      ? ribAngleLockReach(point, normal, unlocked)
      : cornerScale,
  };
}

export function calculateNormalAtSkeletonPoint(skeletonContour, pointIndexOrPointId) {
  return skeletonRibGeometry(skeletonContour, pointIndexOrPointId).normal;
}

/**
 * How far out the rib bar's end sits, as a multiple of the half-width.
 *
 * One everywhere but a point whose rib angle is forced. There the bar is the
 * cut across the stroke, so it is longer than the stroke is wide and its ends
 * still land on the outline. A drag of that end divides by this to get back to
 * the width it is stating.
 */
export function skeletonRibReach(skeletonContour, pointIndexOrPointId) {
  return skeletonRibGeometry(skeletonContour, pointIndexOrPointId).reach;
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

function normalizeCornerSide(side) {
  return {
    distance: Math.max(0, asFiniteNumber(side?.distance, 0)),
    curvature: clampCornerCurvature(side?.curvature),
  };
}

// Two sides, linked by default, like `width`. A point that has never been
// rounded holds two zero distances, so the block is always present and a reader
// never falls through to a table.
function normalizeCorner(corner) {
  return {
    linked: corner?.linked !== false,
    left: normalizeCornerSide(corner?.left),
    right: normalizeCornerSide(corner?.right),
  };
}

function clampCornerCurvature(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CORNER_CURVATURE;
  }
  return Math.min(Math.max(value, 0), 1);
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
    // A file written before the tab row carries the old link flag instead, and
    // an unlinked terminal is exactly what "split" now means.
    sides: VALID_SERIF_SIDES.has(serif?.sides)
      ? serif.sides
      : serif?.linked === false
        ? "split"
        : "both",
    axisMode: VALID_SERIF_AXIS_MODES.has(serif?.axisMode)
      ? serif.axisMode
      : "perpendicular",
  };
  normalized.axisAngle = Number.isFinite(serif?.axisAngle) ? serif.axisAngle : 0;
  normalized.axisTilt = Number.isFinite(serif?.axisTilt) ? serif.axisTilt : 0;
  for (const field of SERIF_TERMINAL_FIELDS) {
    if (field === "axisAngle" || field === "axisTilt") continue;
    normalized[field] = Number.isFinite(serif?.[field])
      ? serif[field]
      : (SERIF_FIELD_DEFAULTS[field] ?? 0);
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

// Side locks. Three independent ones per side, because the single donor flag
// meant three different things at once and could not say any of them alone:
//
//   handles — the curvature is the designer's. The natural solve may not move
//             the handles, and their gizmos do not answer the pointer.
//   slide   — the generated on-curve does not slide along the rib. Its nudge is
//             kept but not applied, and its gizmo does not answer the pointer.
//   width   — this side's edge holds its distance from the centerline. A width
//             or distribution change goes to the other side instead.
//
// Absence means unlocked, so adjustment is available by default and the lock is
// what blocks it. A lock never clears stored adjustments — unlocking re-exposes
// them.
export const SKELETON_LOCK_KINDS = Object.freeze(["handles", "slide", "width"]);

function assertSkeletonLockKind(kind) {
  if (!SKELETON_LOCK_KINDS.includes(kind)) {
    throw new Error(`invalid skeleton lock kind: ${kind}`);
  }
}

function normalizeLockedSide(locked) {
  const side = {};
  for (const kind of SKELETON_LOCK_KINDS) {
    side[kind] = locked?.[kind] === true;
  }
  return side;
}

function normalizeLocked(locked) {
  return {
    left: normalizeLockedSide(locked?.left),
    right: normalizeLockedSide(locked?.right),
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

// Where one addressed point of a generated result landed. The address is the
// skeleton contour, the skeleton point, the side and the role — the same four
// facts provenance publishes — so a caller that regenerates under changed
// settings can find the same point in the new output and compare.
export function findGeneratedOutputPosition(generated, contourId, pointId, side, role) {
  for (const entry of generated?.provenance || []) {
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

// The axis each of a generated segment's two handles was constructed along, as
// the generator published it. A handle sitting exactly on its point draws no
// line of its own, and this is the line it would have drawn — which is what lets
// the curvature gizmo find its crossing, and its axis, on a segment it has
// already flattened into a straight bevel.
//
// Every reader of a beveled segment needs the same pair (R-B): the layer that
// draws the gizmo's axis stub, the hit test, and the drag.
export function generatedSegmentHandleAxes(provenance) {
  return [provenance?.[1]?.constructionAxis, provenance?.[2]?.constructionAxis];
}

// The published axes belong to the EMITTED handles, so they describe the emitted
// segment and nothing else. Where the segment being measured is the untrimmed
// construction snapshot instead, they are the wrong pair: a serif's trim re-aims
// the handle it anchors onto the terminal's depth axis and stamps that. The
// snapshot is taken before colinearity ever runs, so its own drawn directions
// are already the ones it was constructed on and need no correction.
// The pair of directions a segment's two handle lengths are a fraction OF.
//
// A published axis belongs to the handle that was emitted, so it is the right
// answer for a segment that reaches the outline whole: a smooth joint rotates
// the drawn handle after the solve, keeping its length and moving the
// intersection, so the drawn direction is the one thing that must not be
// measured against.
//
// A cut segment is a different curve. The snapshot the cut published is the
// whole curve the generator solved, taken before emission, so its own end
// tangents are the axes it was built on and nothing has rotated them. The
// emitted handles belong to the leftover piece and one of them points somewhere
// the solved curve does not go.
//
// Falling back to no axes at all is what this replaces. That sent the reader
// down the plain-Tunni path while the generator went on reproducing the pin
// through the handle domain, and where the domain has no usable forward
// crossing the two are not the same quantity at all — a factor of 3.28 on the
// inner side of `b.json`, so the gizmo displayed 0.18, wrote 0.18 and redrew at
// 0.055. Both readings build the domain now, so both land in the same branch of
// it.
function constructionSegmentAxes(segmentPoints, provenance, constructionPoints) {
  if (untrimmedConstructionSegment(segmentPoints, provenance)) {
    if (constructionPoints?.length !== 4) {
      return null;
    }
    const start = normalizeVector(
      subVectors(constructionPoints[1], constructionPoints[0])
    );
    const end = normalizeVector(
      subVectors(constructionPoints[2], constructionPoints[3])
    );
    return start && end ? [start, end] : null;
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
  // Two readings of the same drag. `pinned` is where the shared shift can go —
  // down to the shorter handle sitting on its point, which is what the stored
  // mean can still describe. `moved` is where the drag actually asked for,
  // which past that point takes the surviving handle down on its own.
  const handleAxes = generatedSegmentHandleAxes(provenance);
  //
  // They serve both readings, the emitted segment the gizmo is aimed on and the
  // construction segment it is measured on. constructionSegmentAxes exists to
  // correct a handle that colinearity ROTATED, which is a different question and
  // does not arise here: a handle with no length has no direction to have been
  // rotated away from.
  const options = {
    maxTension,
    axisSegmentPoints: segmentPoints,
    handleAxes,
  };
  const pinned = calculateControlPointsFromCurvatureDelta(
    delta,
    constructionPoints,
    options
  );
  const moved = calculateControlPointsFromCurvatureDelta(delta, constructionPoints, {
    ...options,
    allowCollapse: true,
  });
  if (!pinned || !moved) {
    return null;
  }
  const tension = generatedSegmentTension(
    constructionPoints,
    constructionSegmentAxes(segmentPoints, provenance, constructionPoints),
    pinned
  );
  if (!Number.isFinite(tension) || tension < 0) {
    return null;
  }
  // Index 1 is this segment's first off-curve. "out" there means the segment
  // runs in skeleton order, so its start is index 0; otherwise it is index 3.
  const segmentPointIndex = addresses[0].role === "out" ? 0 : 3;
  const start = provenance[segmentPointIndex];
  if (!start || start.role !== "onCurve" || start.skeletonPointId === undefined) {
    return null;
  }
  // A bulb's neck stores its curvature in a cap field on the cap-owning point,
  // because there is no skeleton segment behind it to pin. Nothing else about
  // the drag changes: the same tension is measured the same way. It carries no
  // collapse tail either — a cap handle has no stored offset to put one on, so
  // the pin is the whole answer and a drag below its floor simply stops.
  const capCurvatureField = generatedSegmentCapCurvatureField(provenance);
  if (capCurvatureField) {
    return {
      segmentPointIndex,
      skeletonPointId: start.skeletonPointId,
      side: start.side,
      capCurvatureField,
      tension,
      collapse: [],
    };
  }
  // The tail below the pin's floor, if the drag reached it: whatever `moved`
  // asks for beyond what the pin can hold, carried as a displacement on the one
  // handle still off its point. It is measured against the pinned reading, not
  // against the generator's own answer, so the pin's own contribution is not
  // counted twice — the generator applies the displacement first and the pin
  // after it, and a pin of zero leaves an already-collapsed pair alone.
  const collapse = [1, 2]
    .map((index) => {
      const address = provenance[index];
      const offsetDelta = {
        x: moved[index - 1].x - pinned[index - 1].x,
        y: moved[index - 1].y - pinned[index - 1].y,
      };
      if (!address || (!offsetDelta.x && !offsetDelta.y)) {
        return null;
      }
      return {
        segmentPointIndex: index,
        skeletonPointId: address.skeletonPointId,
        side: address.side,
        role: address.role,
        offsetDelta,
      };
    })
    .filter((entry) => entry);

  // Not clamped here: the drag above already saturated each construction
  // tension independently at the ceiling.
  return {
    segmentPointIndex,
    skeletonPointId: start.skeletonPointId,
    side: start.side,
    tension,
    collapse,
    // Above the floor the pin describes the whole segment on its own, so a
    // displacement the gizmo stored below the floor has nothing left to say and
    // is released. Leaving it there would hold one handle short of where the pin
    // puts it, and would go on holding it as the skeleton, the width or the
    // taper moved underneath — which is the whole reason curvature is pinned as
    // a tension rather than kept as a displacement.
    releaseCollapse: tension > 0,
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
      // A locked gizmo is not offered at all. Blocking only the write left the
      // control looking live and moving the curve through whichever end was
      // still free, which reads as the lock being ignored.
      const locks = getGeneratedSegmentLocks(skeletonData, generatedSegment);
      generatedSegment.handlesLocked = locks.handlesLocked;
      generatedSegment.onCurveMovable = generatedSegment.onCurveMovable.map(
        (movable, index) => movable && !locks.slideLocked[index]
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

// The locks that govern a generated segment's two gizmos. The curvature gizmo
// belongs to both ends at once, so a handle lock at either end takes it away.
// The on-curve gizmo is per end, so each end answers for itself.
function getGeneratedSegmentLocks(skeletonData, segment) {
  const contour = findGeneratedSegmentSkeletonContour(skeletonData, segment);
  const lockedAt = (index, kind) => {
    const provenance = segment.provenance[index];
    if (!contour || !provenance?.side) {
      return false;
    }
    const point = (contour.points || []).find(
      (candidate) => candidate?.id === provenance.skeletonPointId
    );
    return point ? isSkeletonSideLocked(point, provenance.side, kind) : false;
  };
  return {
    handlesLocked: [0, 1, 2, 3].some((index) => lockedAt(index, "handles")),
    slideLocked: [lockedAt(0, "slide"), lockedAt(3, "slide")],
  };
}

function getGeneratedOnCurveMovability(skeletonData, segment) {
  const contour = findGeneratedSegmentSkeletonContour(skeletonData, segment);
  if (!contour) {
    return [false, false];
  }
  // A bulb's neck carries the curvature gizmo and nothing else. Its two ends are
  // cap geometry — one on the ball, one a trim point — so the on-curve gizmo has
  // no rib end to slide, and offering it would move the whole rib instead.
  if (generatedSegmentCapCurvatureField(segment.provenance)) {
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

// A terminal that trims the stroke edge and reproduces its pin on the WHOLE
// segment emits only the part that survived the cut. Measuring the emitted part
// would then report a number the pin does not mean, and the first drag would
// jump the shape from one curve to the other. Such a terminal publishes the
// uncut segment on the inserted point, stored in side order, so it is turned to
// face the same way as the emitted segment before being used.
//
// A serif no longer does this. Its pin is applied after the trim, so the piece
// on screen IS the curve the pin governs and there is nothing to publish. Null
// here is the ordinary answer, and the caller falls back to the emitted segment,
// which is the right one to measure.
// The uncut segment a point publishes, for the side of it being measured.
//
// A trimmed terminal is cut at one end and publishes one snapshot, under
// `constructionSegment`. An inner corner is cut on BOTH sides of a single point
// — the arm arriving at it and the arm leaving it are each shortened — so it
// publishes one snapshot per arm and the carrier's own position picks between
// them. Index 0 means the point starts the segment being measured, so the arm
// leaving it is the one that was cut; index 3 means it ends it.
function storedConstructionSegment(item, index) {
  const perArm =
    index === 0 ? item?.constructionSegmentOut : item?.constructionSegmentIn;
  const stored = perArm ?? item?.constructionSegment;
  return stored?.length === 4 ? stored : null;
}

function untrimmedConstructionSegment(segmentPoints, provenance) {
  if (segmentPoints?.length !== 4) {
    return null;
  }
  const carrier = provenance?.findIndex(
    (item, index) => storedConstructionSegment(item, index) !== null
  );
  if (carrier === undefined || carrier < 0) {
    return null;
  }
  const stored = storedConstructionSegment(provenance[carrier], carrier);
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
    // The two ends carry the on-curve nudge; the two handles carry their own,
    // which is a different amount at the same rib. Subtracting one and not the
    // other hands the caller an end and a handle from two different curves.
    // The untrimmed snapshot predates emission, so it carries neither.
    const displacement =
      index === 0 || index === 3
        ? provenance?.[index]?.nudge
        : untrimmed
          ? null
          : provenance?.[index]?.handleNudge;
    return {
      x: point.x - asFiniteNumber(displacement?.x, 0),
      y: point.y - asFiniteNumber(displacement?.y, 0),
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
  if (!address) {
    return null;
  }
  return {
    ...address,
    side: segment.side,
    capCurvatureField: generatedSegmentCapCurvatureField(segment.provenance),
  };
}

// The cap field a segment's curvature is stored in, or null for the ordinary
// case where it is a side's `segmentCurvature`. A bulb's neck is the one segment
// with no skeleton segment behind it: both of its handles name the cap-owning
// point and the field instead. Both must agree, or the segment is not a neck.
export function generatedSegmentCapCurvatureField(provenance) {
  const field = provenance?.[1]?.capCurvatureField;
  if (!field || provenance?.[2]?.capCurvatureField !== field) {
    return null;
  }
  return CAP_CURVATURE_FIELDS.has(field) ? field : null;
}

export function getSkeletonCapCurvature(point, field) {
  const value = point?.[field];
  return Number.isFinite(value) ? value : null;
}

export function setSkeletonCapCurvature(point, field, tension) {
  if (!CAP_CURVATURE_FIELDS.has(field)) {
    return;
  }
  point[field] = Number.isFinite(tension)
    ? Math.min(Math.max(tension, 0), MAX_STORED_SEGMENT_TENSION)
    : null;
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
    constructionSegmentAxes(segment?.points, segment?.provenance, points),
    [points[1], points[2]]
  );
  if (!Number.isFinite(tension) || tension <= 0) {
    return null;
  }
  const address = generatedSegmentPinAddress(skeletonData, segment);
  const pin = !address
    ? null
    : address.capCurvatureField
      ? getSkeletonCapCurvature(address.point, address.capCurvatureField)
      : getSkeletonSegmentCurvature(address.point, address.side);
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
    if (includeCurvature && !segment.handlesLocked) {
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
