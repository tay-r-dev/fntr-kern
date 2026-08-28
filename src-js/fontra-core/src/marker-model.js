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
