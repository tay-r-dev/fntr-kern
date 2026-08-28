import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "./fontra-internal-schema.js";

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

export function markerIsStale(marker, path) {
  if (!marker.ends?.some(endIsPathAnchored)) {
    // Skeleton anchors carry stable ids and cast ends own nothing. Neither can shift.
    return false;
  }
  const now = computeMarkerSignature(path);
  const then = marker.signature;
  if (!then || then.counts?.length !== now.counts.length) {
    return true;
  }
  // Compared whole: an added or removed contour shifts every index after it, and
  // telling "shifted" from "resized" is the search this design refuses to do.
  return now.counts.some(
    (count, i) => count !== then.counts[i] || now.closed[i] !== then.closed[i]
  );
}

function endIsPathAnchored(end) {
  return end.kind === "pathSegment" || end.kind === "pathPoint";
}
