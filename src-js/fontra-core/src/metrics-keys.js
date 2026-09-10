import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import {
  FONTRA_INTERNAL_KEY,
  FONTRA_INTERNAL_SECTIONS,
} from "./fontra-internal-schema.js";

const SECTION = FONTRA_INTERNAL_SECTIONS.SIDEBEARING_KEYS;

export const SIDEBEARING_SIDES = Object.freeze({ left: "left", right: "right" });

export const SIDE_METRIC_PROPERTY = Object.freeze({
  left: "leftMargin",
  right: "rightMargin",
});

// A leading "=" marks a persistent link, matching Glyphs and RoboFont. It is UI
// syntax only: the stored expression never carries it.
export const METRICS_KEY_PREFIX = "=";

// Margins are edited at one decimal, so anything under half a unit is display
// rounding, not a real divergence.
export const STALE_EPSILON = 0.5;

export function parseMetricsKey(input) {
  if (typeof input !== "string") {
    return { isKey: false };
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith(METRICS_KEY_PREFIX)) {
    return { isKey: false };
  }
  const expression = trimmed.slice(METRICS_KEY_PREFIX.length).trim();
  if (!expression) {
    return { isKey: false, error: "empty metrics key" };
  }
  return { isKey: true, expression };
}

export function formatMetricsKeyDisplay(expression) {
  return `${METRICS_KEY_PREFIX}${expression}`;
}

function getKeysSection(entity) {
  const section = getFontraInternalSection(entity, SECTION);
  return section && typeof section === "object" && !Array.isArray(section)
    ? section
    : null;
}

export function getSidebearingKey(entity, side) {
  const expression = getKeysSection(entity)?.[side]?.expression;
  return typeof expression === "string" ? expression : undefined;
}

export function hasAnySidebearingKey(entity) {
  if (!getKeysSection(entity)) {
    return false;
  }
  return Object.keys(SIDEBEARING_SIDES).some(
    (side) => getSidebearingKey(entity, side) !== undefined
  );
}

export function setSidebearingKey(entity, side, expression) {
  const section = { ...(getKeysSection(entity) || {}) };
  section[side] = { expression: String(expression) };
  setFontraInternalSection(entity, SECTION, section);
}

export function deleteSidebearingKey(entity, side) {
  const section = getKeysSection(entity);
  if (!section || !(side in section)) {
    return false;
  }
  const next = { ...section };
  delete next[side];
  if (Object.keys(next).length) {
    setFontraInternalSection(entity, SECTION, next);
  } else {
    setFontraInternalSection(entity, SECTION, undefined);
    pruneEmptyFontraInternal(entity);
  }
  return true;
}

// Leave no residue in a glyph that has no forkra data at all. Only prune when
// schemaVersion is the sole survivor -- other sections (skeleton, markers,
// letterspacer, composition) must be left alone.
function pruneEmptyFontraInternal(entity) {
  const internal = entity?.customData?.[FONTRA_INTERNAL_KEY];
  if (!internal) {
    return;
  }
  const remaining = Object.keys(internal).filter((key) => key !== "schemaVersion");
  if (!remaining.length) {
    delete entity.customData[FONTRA_INTERNAL_KEY];
  }
}

// The cascade: a source override shadows the shared key for that source only.
export function getEffectiveMetricsKey(varGlyph, layerGlyph, side) {
  const override = getSidebearingKey(layerGlyph, side);
  if (override !== undefined) {
    return { expression: override, level: "source" };
  }
  const shared = getSidebearingKey(varGlyph, side);
  if (shared !== undefined) {
    return { expression: shared, level: "shared" };
  }
  return null;
}

export function isMetricsValueStale(appliedValue, resolvedValue) {
  if (!Number.isFinite(appliedValue) || !Number.isFinite(resolvedValue)) {
    return false;
  }
  return Math.abs(appliedValue - resolvedValue) > STALE_EPSILON;
}

// "o"'s left keyed to "=o" is an identity: applying it can only write the value
// it just read (spec section 7 case 3). The opposite side ("=o!") is legitimate
// symmetry and is not caught here.
export function isSelfReferenceSameSide(expression, glyphName) {
  return typeof expression === "string" && expression.trim() === glyphName;
}
