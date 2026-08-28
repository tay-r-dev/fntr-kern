import { Bezier } from "bezier-js";
import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import {
  FONTRA_INTERNAL_KEY,
  FONTRA_INTERNAL_SECTIONS,
} from "./fontra-internal-schema.js";
import {
  buildSkeletonTunniSegments,
  getSkeletonContour,
  getSkeletonPoint,
} from "./skeleton-model.js";
import * as vector from "./vector.js";

// A marker is a measurement the designer places on a contour and keeps. It stores an
// address and nothing else: every distance is derived on read.
//
//   marker = {id, ends: [End, End], signature, target?, groupId?}
//   group  = {id, name, visible}
//
// Ids are allocated once and never reused, so the copies of one marker that land in
// several sources are recognisably one marker. That is why the next id is held in the
// section rather than derived from the list: deleting a marker must not free its id
// while a twin in another source still carries it.

export function getMarkerData(layerGlyph) {
  return getFontraInternalSection(layerGlyph, FONTRA_INTERNAL_SECTIONS.MARKERS);
}

export function setMarkerData(layerGlyph, data) {
  setFontraInternalSection(layerGlyph, FONTRA_INTERNAL_SECTIONS.MARKERS, data);
}

export function getMarkers(layerGlyph) {
  return getMarkerData(layerGlyph)?.markers || [];
}

export function getMarkerGroups(layerGlyph) {
  return getMarkerData(layerGlyph)?.groups || [];
}

export function allocateMarkerId(layerGlyph) {
  const data = getMarkerData(layerGlyph) || { markers: [], groups: [] };
  const next = Math.max(data.nextId || 0, highestUsedId(data) + 1);
  setMarkerData(layerGlyph, { ...data, nextId: next + 1 });
  return `marker${next}`;
}

function highestUsedId(data) {
  let highest = -1;
  for (const marker of data.markers || []) {
    const number = parseInt(String(marker.id).replace(/^marker/, ""));
    if (Number.isFinite(number) && number > highest) {
      highest = number;
    }
  }
  return highest;
}

// The signature is a count, not a geometry. There is no tolerance in it: it verifies an
// address, it never searches for one. The rule it serves is the whole of the anchoring
// design — the point count under an anchor changes, the marker goes stale; anything
// else, the marker rides the geometry.
//
// The comparison runs on read and writes nothing, so undoing past a structural edit
// restores the count and the marker comes back to life on its own.

export function computeMarkerSignature(path) {
  const counts = [];
  const closed = [];
  for (let i = 0; i < path.contourInfo.length; i++) {
    counts.push(path.getNumPointsOfContour(i));
    closed.push(!!path.contourInfo[i].isClosed);
  }
  return { counts, closed };
}

// Where an anchor last stood, remembered so a later edit can be checked against it.
//
// This is the one stored coordinate in the whole feature, and it earns its place: it is
// never used to resolve a healthy anchor, and it never searches among candidates. It
// answers exactly one question — is the outline still where this anchor was? — and it
// answers it by looking, not by guessing. Everything else is still derived on read.
export function withAnchorPosition(end, path, skeletonData) {
  if (end.kind !== "pathSegment" && end.kind !== "pathPoint") {
    return end;
  }
  const resolved = resolveMarkerAnchor(end, { path, skeletonData });
  if (resolved.verdict !== "ok") {
    return end;
  }
  return { ...end, at: { x: resolved.point.x, y: resolved.point.y } };
}

// How far the outline may have drifted from the remembered spot and still count as the
// same place, in font units. Subdividing a curve is exact, so an intact outline lands
// within rounding; half a unit on a 1000-unit em is far below anything a designer would
// call "the same place", and far above the arithmetic.
const REPAIR_TOLERANCE = 0.5;

// The whole anchoring rule, in one place.
//
//   1. The address still resolves and the outline is where the anchor left it — it
//      rides. Points moving under it is this case, and it needs no repair.
//   2. The address no longer names that place, but the place is still on the outline —
//      the address is rewritten to wherever it now lives. Inserting a point, deleting
//      one elsewhere, adding a contour and reversing a contour are all this case.
//   3. The place is gone from the outline — stale, AT THE SAME SPOT it last stood, so
//      it can be found and dragged somewhere useful rather than vanishing.
export function resolveMarkerEnd(end, { path, skeletonData, indicesChanged } = {}) {
  if (end?.kind === "free") {
    // Attached to nothing, so nothing can break it.
    return { verdict: "ok", end, point: { x: end.x, y: end.y } };
  }
  if (end?.kind !== "pathSegment" && end?.kind !== "pathPoint") {
    const resolved = resolveMarkerAnchor(end, { path, skeletonData });
    return { ...resolved, end };
  }

  const direct = resolveMarkerAnchor(end, { path, skeletonData });

  // While the indices still mean what they meant, the address is the truth and the
  // remembered position is only a memory. Preferring the memory here would drag a
  // marker back to where the stem used to be instead of letting it ride the stem —
  // which is the whole point of case 2.
  if (!indicesChanged) {
    return direct.verdict === "ok" ? { ...direct, end } : { verdict: "stale", end };
  }

  if (!end.at) {
    // Written before positions were remembered. There is nothing to check against, so
    // the address is all there is.
    return direct.verdict === "ok" ? { ...direct, end } : { verdict: "stale", end };
  }

  // What counts as "still there" depends on what the end names. A ray's anchor is a
  // place along the outline, so any spot on it will do. A dimension's end names a POINT,
  // and a point that has been deleted is gone even though its position still lies on the
  // outline — asking the segment question there would report a healthy anchor to a point
  // that no longer exists.
  const found =
    end.kind === "pathPoint"
      ? nearestPointOnPath(path, end.at)
      : nearestPlaceOnPath(path, end.at);
  if (found && isSamePlace(found.point, end.at)) {
    const rewritten = { ...end, ...found.address, at: end.at };
    const resolved = resolveMarkerAnchor(rewritten, { path, skeletonData });
    if (resolved.verdict === "ok") {
      return { ...resolved, end: rewritten };
    }
  }
  return { verdict: "stale", end, point: { x: end.at.x, y: end.at.y } };
}

// Whether the addresses in a marker still mean what they meant when it was written.
// This is what the signature is for now: not a verdict, but the switch that says which
// of the two readings of the outline applies.
export function markerIndicesChanged(marker, path) {
  const then = marker.signature;
  if (!then?.counts) {
    return true;
  }
  const now = computeMarkerSignature(path);
  if (then.counts.length !== now.counts.length) {
    return true;
  }
  return now.counts.some(
    (count, i) => count !== then.counts[i] || now.closed[i] !== then.closed[i]
  );
}

function isSamePlace(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= REPAIR_TOLERANCE;
}

// The nearest place on the outline to a remembered point. This is a measurement, not a
// search for a lost anchor: the result is accepted only if it lands on the remembered
// point, so it can confirm that a place still exists and never invent one.
// The nearest actual point of the outline, for an end that names one. Same discipline as
// nearestPlaceOnPath: the answer is accepted only if it lands on the remembered spot.
function nearestPointOnPath(path, at) {
  if (!path) {
    return undefined;
  }
  let best;
  for (let contourIndex = 0; contourIndex < path.contourInfo.length; contourIndex++) {
    const numPoints = path.getNumPointsOfContour(contourIndex);
    for (let pointIndex = 0; pointIndex < numPoints; pointIndex++) {
      const point = path.getContourPoint(contourIndex, pointIndex);
      const d = Math.hypot(point.x - at.x, point.y - at.y);
      if (!best || d < best.d) {
        best = { d, point, address: { contourIndex, pointIndex } };
      }
    }
  }
  return best;
}

function nearestPlaceOnPath(path, at) {
  if (!path) {
    return undefined;
  }
  let best;
  for (let contourIndex = 0; contourIndex < path.contourInfo.length; contourIndex++) {
    let segmentIndex = 0;
    for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
      const projected = new Bezier(segment.points).project(at);
      if (projected && (!best || projected.d < best.d)) {
        best = {
          d: projected.d,
          point: { x: projected.x, y: projected.y },
          address: { contourIndex, segmentIndex, t: projected.t },
        };
      }
      segmentIndex++;
    }
  }
  return best;
}

// A marker is stale when any of its ends is, and an end is stale only when the place it
// named is gone from the outline. The point count is no longer the test: counting made
// an inserted point anywhere in the glyph break every marker in it, which is a lot of
// false alarms to buy one rule.
export function markerIsStale(marker, path, skeletonData) {
  if (marker.broken) {
    return true;
  }
  const indicesChanged = markerIndicesChanged(marker, path);
  return (marker.ends || []).some(
    (end) =>
      end.kind !== "cast" &&
      resolveMarkerEnd(end, { path, skeletonData, indicesChanged }).verdict !== "ok"
  );
}

function endIsPathAnchored(end) {
  return end.kind === "pathSegment" || end.kind === "pathPoint";
}

// Resolving an address. The verdict is "ok" or "stale" and there is no third value:
// anything that cannot be resolved is stale, never guessed at and never thrown on.

export function resolveMarkerAnchor(end, { path, skeletonData } = {}) {
  switch (end?.kind) {
    case "pathSegment":
      return resolvePathSegment(end, path);
    case "pathPoint":
      return resolvePathPoint(end, path);
    case "skeletonPoint":
      return resolveSkeletonPoint(end, skeletonData);
    default:
      return STALE;
  }
}

const STALE = Object.freeze({ verdict: "stale" });

function resolvePathSegment(end, path) {
  const bezier = pathSegmentBezier(path, end.contourIndex, end.segmentIndex);
  if (!bezier) {
    return STALE;
  }
  return { verdict: "ok", point: bezier.get(end.t), normal: normalAt(bezier, end.t) };
}

function resolvePathPoint(end, path) {
  if (
    !path ||
    end.contourIndex < 0 ||
    end.contourIndex >= path.contourInfo.length ||
    end.pointIndex < 0 ||
    end.pointIndex >= path.getNumPointsOfContour(end.contourIndex)
  ) {
    return STALE;
  }
  const point = path.getContourPoint(end.contourIndex, end.pointIndex);
  return point ? { verdict: "ok", point } : STALE;
}

function resolveSkeletonPoint(end, skeletonData) {
  const contour = skeletonData
    ? getSkeletonContour(skeletonData, end.contourId)
    : undefined;
  if (!contour || !getSkeletonPoint(skeletonData, end.contourId, end.pointId)) {
    return STALE;
  }
  const segment = buildSkeletonTunniSegments(contour).find(
    (segment) => segment.startPointId === end.pointId
  );
  if (!segment) {
    return STALE;
  }
  const bezier = new Bezier(
    [segment.startPoint, ...segment.controlPoints, segment.endPoint].map((point) => ({
      x: point.x,
      y: point.y,
    }))
  );
  return { verdict: "ok", point: bezier.get(end.t), normal: normalAt(bezier, end.t) };
}

function pathSegmentBezier(path, contourIndex, segmentIndex) {
  if (!path || contourIndex < 0 || contourIndex >= path.contourInfo.length) {
    return undefined;
  }
  let i = 0;
  for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
    if (i++ === segmentIndex) {
      return new Bezier(segment.points);
    }
  }
  return undefined;
}

// The same quarter turn the Power Ruler takes at recalcRulerFromPoint.
function normalAt(bezier, t) {
  const derivative = bezier.derivative(t);
  return vector.normalizeVector({ x: -derivative.y, y: derivative.x });
}

// Markers must never reach the interpolation model. A layer's customData goes into it
// whole, and a marker is not interpolable data: it holds ids and address kinds, not
// numbers, and two sources need not carry the same markers at all. Left in, adding a
// marker to one source alone makes the glyph incompatible and interpolation stops.
//
// So markers live on masters only, and nothing in between reads them. The background
// image is dropped from that same call for the same kind of reason.
//
// The customData is returned untouched when there is nothing to strip, so the common
// case copies nothing.
export function withoutMarkerData(customData) {
  const internal = customData?.[FONTRA_INTERNAL_KEY];
  if (internal?.[FONTRA_INTERNAL_SECTIONS.MARKERS] === undefined) {
    return customData;
  }
  const strippedInternal = { ...internal };
  delete strippedInternal[FONTRA_INTERNAL_SECTIONS.MARKERS];
  return { ...customData, [FONTRA_INTERNAL_KEY]: strippedInternal };
}

// The nearest place on a stroke's centerline. The centerline is not outline geometry, so
// no path hit test can find it — a tool that only asks the path is blind to the skeleton,
// and every centerline measurement is unreachable.
//
// The end this returns carries stable ids rather than indices, so it never needs
// repairing and never goes stale.
export function nearestPlaceOnSkeleton(skeletonData, at) {
  let best;
  for (const contour of skeletonData?.contours || []) {
    for (const segment of buildSkeletonTunniSegments(contour)) {
      const points = [segment.startPoint, ...segment.controlPoints, segment.endPoint];
      if (points.some((point) => !point)) {
        continue;
      }
      const projected = new Bezier(
        points.map((point) => ({ x: point.x, y: point.y }))
      ).project(at);
      if (!projected || (best && projected.d >= best.distance)) {
        continue;
      }
      best = {
        distance: projected.d,
        point: { x: projected.x, y: projected.y },
        end: {
          kind: "skeletonPoint",
          contourId: contour.id,
          pointId: segment.startPointId,
          t: projected.t,
        },
      };
    }
  }
  return best;
}
