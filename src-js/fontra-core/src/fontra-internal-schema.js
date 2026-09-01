export const FONTRA_INTERNAL_KEY = "fontra.internal";
export const FONTRA_INTERNAL_SCHEMA_VERSION = 1;

export const FONTRA_INTERNAL_SECTIONS = Object.freeze({
  COMPOSITION: "composition",
  LETTERSPACER: "letterspacer",
  MARKERS: "markers",
  SKELETON: "skeleton",
  SKELETON_DEFAULTS: "skeletonDefaults",
});

// None of a layer's own `fontra.internal` block is interpolable, and the whole of it
// is dropped before a glyph reaches the interpolation model or the compatibility
// check.
//
// A layer's customData goes into that model whole, and the model compares it entry by
// entry the same way it compares points. The block holds ids, mode names and entries
// that are only written when they are not the default, so two masters edited
// differently carry different sets of entries and the comparison stops. That is
// reported to the designer as an interpolation error, on a glyph whose outlines are
// perfectly compatible.
//
// Measured on `F^1.json`: 26 matching points in both masters, and the check stopped on
// a skeleton point that had handle offsets in one master and none in the other.
//
// What lives in the block is the skeleton and the markers, and neither is outline
// geometry. The outline is what interpolates; the skeleton is the recipe that drew it
// and it lives on masters only. Adjusting a gizmo or nudging a generated point must
// never change whether two masters interpolate.
//
// The customData is returned untouched when there is nothing to strip, so the common
// case copies nothing.
export function withoutNonInterpolableData(customData) {
  if (customData?.[FONTRA_INTERNAL_KEY] === undefined) {
    return customData;
  }
  const stripped = { ...customData };
  delete stripped[FONTRA_INTERNAL_KEY];
  return stripped;
}
