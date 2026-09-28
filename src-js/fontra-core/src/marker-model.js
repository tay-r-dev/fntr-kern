import { Bezier } from "bezier-js";
import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "./fontra-internal-schema.js";
import {
  buildSkeletonTunniSegments,
  getSkeletonContour,
  getSkeletonPoint,
} from "./skeleton-model.js";
import { solveCubicBezierCurvature } from "./curvature.js";
import * as vector from "./vector.js";

// A marker is a measurement the designer places on a contour and keeps. It stores an
// address and nothing else: every distance is derived on read.
//
//   marker = {id, ends: [End, End], signature, target?, groupId?}
//   group  = {id, name, visible}
//
// Four kinds (markerKind). A ray and a dimension are told apart by their ends. A ruler
// and a curvature marker say so in `kind`:
//
//   ruler     = {id, kind: "ruler", ends: [], at: {x, y}, angle}
//   curvature = {id, kind: "curvature", ends: [End], signature}
//
// A ruler is attached to nothing: it has no end that can go stale, and its place and
// angle are the only coordinates it keeps.
//
// Ids are allocated once and never reused, so the copies of one marker that land in
// several sources are recognisably one marker. That is why the next id is held in the
// section rather than derived from the list: deleting a marker must not free its id
// while a twin in another source still carries it.

export function markerKind(marker) {
  if (marker.kind === "ruler" || marker.kind === "curvature") {
    return marker.kind;
  }
  return (marker.ends || []).some((end) => end.kind === "cast") ? "ray" : "dimension";
}

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
    // Attached to nothing, so there is nothing to measure. A marker off the geometry is
    // stale for the same reason a marker whose geometry was deleted is stale, and takes
    // the same way back: it keeps its place so it can be dragged onto something.
    return { verdict: "stale", end, point: { x: end.x, y: end.y } };
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
// The question is asked about ONE end, because an end's address only names one contour.
// Adding a point to a contour a marker never touched used to count as a change for that
// marker too, which sent it down the repair road: the repair puts the anchor back on the
// spot it was last WRITTEN at, and an anchor that had since ridden the outline somewhere
// else was dragged back there. So the comparison is narrowed to the end's own contour.
//
// Two cases still have to look at the whole path. A different number of contours means
// the contour numbers themselves have shifted, so no single one can be compared. And an
// end that names no contour at all -- a skeleton anchor, a cast -- has nothing to narrow
// to.
export function markerIndicesChanged(marker, path, end = undefined) {
  const then = marker.signature;
  if (!then?.counts) {
    return true;
  }
  const now = computeMarkerSignature(path);
  if (then.counts.length !== now.counts.length) {
    return true;
  }
  const differs = (i) =>
    now.counts[i] !== then.counts[i] || now.closed[i] !== then.closed[i];
  const contourIndex = end?.contourIndex;
  if (
    endIsPathAnchored(end || {}) &&
    Number.isInteger(contourIndex) &&
    contourIndex >= 0 &&
    contourIndex < now.counts.length
  ) {
    return differs(contourIndex);
  }
  return now.counts.some((count, i) => differs(i));
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
  return (marker.ends || []).some(
    (end) =>
      end.kind !== "cast" &&
      resolveMarkerEnd(end, {
        path,
        skeletonData,
        indicesChanged: markerIndicesChanged(marker, path, end),
      }).verdict !== "ok"
  );
}

// Bringing the remembered positions up to date, run after every glyph edit.
//
// The remembered position is what the repair compares against, and it was only ever
// written when a marker was placed or dragged. A marker that rides the outline -- points
// moved under it, which is the common edit -- kept a memory of where the outline USED to
// be. The next edit that changed a point count then judged the marker against that old
// memory, found the outline nowhere near it, and called the marker broken. Refreshing
// after every edit is what makes the memory mean what the repair reads it as: where this
// anchor stood a moment ago.
//
// Only markers whose every end resolves are touched. A stale marker is left exactly as
// it is, so it keeps the spot it last stood at and stays draggable back onto geometry.
//
// Returns a new marker list, or null when nothing needed rewriting.
export function refreshedMarkers(markers, path, skeletonData) {
  let changed = false;
  const signature = computeMarkerSignature(path);
  const refreshed = (markers || []).map((marker) => {
    if (marker.broken) {
      return marker;
    }
    const resolved = marker.ends.map((end) =>
      end.kind === "cast"
        ? null
        : resolveMarkerEnd(end, {
            path,
            skeletonData,
            indicesChanged: markerIndicesChanged(marker, path, end),
          })
    );
    if (resolved.some((anchor) => anchor && anchor.verdict !== "ok")) {
      return marker;
    }
    const ends = marker.ends.map((end, i) =>
      resolved[i] ? withAnchorPosition(resolved[i].end, path, skeletonData) : end
    );
    const next = { ...marker, ends, signature };
    if (sameMarker(next, marker)) {
      return marker;
    }
    changed = true;
    return next;
  });
  return changed ? refreshed : null;
}

function sameMarker(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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
  return {
    verdict: "ok",
    point: bezier.get(end.t),
    normal: normalAt(bezier, end.t),
    curvature: signedCurvatureAt(bezier, end.t),
  };
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
  return {
    verdict: "ok",
    point: bezier.get(end.t),
    normal: normalAt(bezier, end.t),
    curvature: signedCurvatureAt(bezier, end.t),
  };
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

// An aimed ray. A ray's cast end owns nothing, so it is where the aim lives: an angle in
// degrees, in glyph space, set by the designer's drag. A cast end with no angle is a
// plain ray and runs along the normal at its anchor.
//
// The angle is in glyph space rather than against the normal, because the aim exists
// for the places where the normal says nothing useful: a corner, where it belongs to
// neither arm.
export function aimedCast(direction) {
  const degrees = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
  return { kind: "cast", angle: Math.round(degrees * 100) / 100 };
}

export function aimedDirection(castEnd) {
  if (typeof castEnd?.angle !== "number") {
    return null;
  }
  const radians = (castEnd.angle * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

// The curvature at t, signed so that the centre of the circle that fits the curve there
// lies at point + normal / curvature, with normalAt's normal. Its size is SpeedPunk's
// (solveCubicBezierCurvature, one copy of the formula); the sign is the turn.
function signedCurvatureAt(bezier, t) {
  if (bezier.points.length < 3) {
    return 0;
  }
  const d1 = bezier.derivative(t);
  const d2 = bezier.dderivative(t);
  const size = solveCubicBezierCurvature([d1.x, d1.y], [d2.x, d2.y]);
  return Math.sign(d1.x * d2.y - d1.y * d2.x) * size;
}

// The same quarter turn the Power Ruler takes at recalcRulerFromPoint.
function normalAt(bezier, t) {
  const derivative = bezier.derivative(t);
  return vector.normalizeVector({ x: -derivative.y, y: derivative.x });
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

// Only on-curve points are points a designer placed; an off-curve is a handle that shapes
// a curve and is not a place on the outline. Anything that names a point — a dimension's
// ends, the pull a dragged ray feels — asks here.
export function nearestOnCurvePoint(path, at) {
  if (!path) {
    return undefined;
  }
  let best;
  for (let contourIndex = 0; contourIndex < path.contourInfo.length; contourIndex++) {
    const numPoints = path.getNumPointsOfContour(contourIndex);
    for (let pointIndex = 0; pointIndex < numPoints; pointIndex++) {
      const point = path.getContourPoint(contourIndex, pointIndex);
      if (point.type) {
        continue;
      }
      const distance = Math.hypot(point.x - at.x, point.y - at.y);
      if (!best || distance < best.distance) {
        best = { distance, point, contourIndex, pointIndex };
      }
    }
  }
  return best;
}

// The same on-curve point, addressed as a place on the outline rather than as a point:
// what a ray anchors to. It is the start of the segment that leaves the point, so the
// address is exact rather than a parameter that happens to land near it.
export function nearestOnCurvePlace(path, at) {
  const found = nearestOnCurvePoint(path, at);
  if (!found) {
    return undefined;
  }
  const end = placeOfOnCurvePoint(path, found.contourIndex, found.pointIndex);
  if (!end) {
    return undefined;
  }
  return {
    distance: found.distance,
    point: { x: found.point.x, y: found.point.y },
    end,
  };
}

// An on-curve point as a place on the outline: the start of the segment that leaves it,
// or the end of the one that arrives where nothing leaves (an open contour's last point).
function placeOfOnCurvePoint(path, contourIndex, contourPointIndex) {
  // Segment point indices count across the whole path, not within the contour.
  const pointIndex = path.getAbsolutePointIndex(contourIndex, contourPointIndex);
  const segments = [...path.iterContourDecomposedSegments(contourIndex)];
  let segmentIndex = segments.findIndex(
    (segment) => segment.pointIndices[0] === pointIndex
  );
  let t = 0;
  if (segmentIndex < 0) {
    segmentIndex = segments.findIndex(
      (segment) => segment.pointIndices.at(-1) === pointIndex
    );
    t = 1;
  }
  if (segmentIndex < 0) {
    return undefined;
  }
  return withAnchorPosition(
    { kind: "pathSegment", contourIndex, segmentIndex, t },
    path
  );
}

// An aimed ray at a segment's end sits on an on-curve point, and is addressed as that
// point, so the file says what it sits on. A plain ray stays on its segment: it reads its
// normal off the segment, and a point has no normal. Returns the ends unchanged where
// there is nothing to readdress.
export function aimedRayOnPoint(ends, path) {
  const anchorIndex = ends.findIndex((end) => end.kind !== "cast");
  const cast = ends.find((end) => end.kind === "cast");
  const anchor = ends[anchorIndex];
  if (
    !aimedDirection(cast) ||
    anchor?.kind !== "pathSegment" ||
    (anchor.t !== 0 && anchor.t !== 1)
  ) {
    return ends;
  }
  const segment = [...path.iterContourDecomposedSegments(anchor.contourIndex)][
    anchor.segmentIndex
  ];
  if (!segment) {
    return ends;
  }
  const absolute =
    anchor.t === 0 ? segment.pointIndices[0] : segment.pointIndices.at(-1);
  const [contourIndex, pointIndex] = path.getContourAndPointIndex(absolute);
  const next = [...ends];
  next[anchorIndex] = withAnchorPosition(
    { kind: "pathPoint", contourIndex, pointIndex },
    path
  );
  return next;
}

// A ray returned to the normal (Ctrl-click). The aim goes, and a ray on a point goes
// back onto the segment that leaves the point, where it reads a normal again. Null for a
// ray that is not aimed, which has nothing to return from.
export function unaimedRay(ends, path) {
  const castIndex = ends.findIndex((end) => end.kind === "cast");
  if (castIndex < 0 || !aimedDirection(ends[castIndex])) {
    return null;
  }
  const next = ends.map((end) => {
    if (end.kind === "cast") {
      return { kind: "cast" };
    }
    if (end.kind === "pathPoint") {
      return placeOfOnCurvePoint(path, end.contourIndex, end.pointIndex) || end;
    }
    return end;
  });
  return next;
}
