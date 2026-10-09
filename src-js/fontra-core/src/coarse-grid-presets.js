export const COARSE_GRID_DEFAULT_BASE = 5;
export const COARSE_GRID_DEFAULT_INCREMENT = 5;
export const COARSE_GRID_DEFAULT_STEP_COUNT = 8;
export const COARSE_GRID_DEFAULT_SPACING = 10;

export function normalizeCoarseGridBase(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return COARSE_GRID_DEFAULT_BASE;
  }
  return Math.max(1, Math.round(n));
}

export function normalizeCoarseGridIncrement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return COARSE_GRID_DEFAULT_INCREMENT;
  }
  return Math.max(1, Math.round(n));
}

// The spacing steps: a starting point and an increment, and always the same
// number of steps as the standard grid, custom or not.
export function buildCoarseGridValues(settings) {
  const base =
    settings && settings.custom
      ? normalizeCoarseGridBase(settings.base)
      : COARSE_GRID_DEFAULT_BASE;
  const increment =
    settings && settings.custom
      ? normalizeCoarseGridIncrement(settings.increment)
      : COARSE_GRID_DEFAULT_INCREMENT;
  const values = [];
  for (let i = 0; i < COARSE_GRID_DEFAULT_STEP_COUNT; i++) {
    values.push(base + i * increment);
  }
  return values;
}

export function snapCoarseGridSpacing(value, values) {
  if (!values || !values.length) {
    return COARSE_GRID_DEFAULT_SPACING;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return values[Math.min(1, values.length - 1)];
  }
  let closest = values[0];
  let closestDistance = Math.abs(numericValue - closest);
  for (const candidate of values) {
    const distance = Math.abs(numericValue - candidate);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

export const COARSE_GRID_DEFAULT_VALUES = buildCoarseGridValues({ custom: false });

// The secondary grid marks every Nth crossing of the grid: its spacing is the
// grid's times the multiplier (2, 5 or 10). Null while the multiplier is off
// (0).
export const SECONDARY_GRID_MULTIPLIERS = [2, 5, 10];

export function secondaryCoarseGridSpacing(settings, primarySpacing) {
  const multiplier = Number(settings?.coarseGridSecondaryMultiplier);
  if (!SECONDARY_GRID_MULTIPLIERS.includes(multiplier)) {
    return null;
  }
  return primarySpacing * multiplier;
}

// The coarse grid's dots are drawn as one tile, repeated, so a frame costs the
// same however many dots are on screen: a circle per crossing was tens of
// thousands of circles a frame just before the dots give way, zoomed out. The
// tile is whole pixels and the grid's period is not, so the pattern is scaled
// down onto the period, by under one pixel's worth across the tile; every dot
// centre still lands exactly on its crossing. All in device pixels: `period` is
// the distance between crossings, `originX`/`originY` one crossing's position.
// Past COARSE_GRID_TILE_MAX_PERIOD the dots are few and the tile would be large,
// so there is no tile and the dots are drawn one by one.
export const COARSE_GRID_TILE_MAX_PERIOD = 64;

export function coarseGridDotTile({ period, radius, originX, originY }) {
  if (!(period > 0) || period > COARSE_GRID_TILE_MAX_PERIOD) {
    return null;
  }
  const size = Math.ceil(period);
  const scale = period / size;
  // The dot sits in the tile's centre; the matrix takes that centre to the
  // crossing.
  return {
    size,
    radius: radius / scale,
    matrix: {
      a: scale,
      d: scale,
      e: originX - period / 2,
      f: originY - period / 2,
    },
  };
}

// A grid preset: a name, the custom spacing's base and increment, and the
// secondary grid's multiplier (0 for off). The presets are an app setting,
// as the grid's own settings are.
export function captureGridPreset(settings, name) {
  const custom = !!settings?.coarseGridCustom;
  const secondary = Number(settings?.coarseGridSecondaryMultiplier);
  return {
    name,
    base: custom
      ? normalizeCoarseGridBase(settings.coarseGridBase)
      : COARSE_GRID_DEFAULT_BASE,
    increment: custom
      ? normalizeCoarseGridIncrement(settings.coarseGridIncrement)
      : COARSE_GRID_DEFAULT_INCREMENT,
    secondary: SECONDARY_GRID_MULTIPLIERS.includes(secondary) ? secondary : 0,
  };
}

// Whether the grid is the preset's: its base, increment and secondary grid.
// A grid without custom spacing has the default base and increment.
export function gridMatchesPreset(settings, preset) {
  const current = captureGridPreset(settings, "");
  return (
    normalizeCoarseGridBase(preset.base) === current.base &&
    normalizeCoarseGridIncrement(preset.increment) === current.increment &&
    (Number(preset.secondary) || 0) === current.secondary
  );
}

// Applying a preset turns custom spacing on with its base and increment and
// sets the secondary grid. The spacing snaps to the new steps where it is read.
// The preset is kept as the pick, so every preset dropdown shows it, however
// it was applied; a bound grid stays bound, to this preset.
export function applyGridPreset(settings, preset) {
  const secondary = Number(preset.secondary);
  settings.coarseGridPresetPick = preset.name ?? null;
  const bond = settings.coarseGridPresetBond;
  if ((settings.coarseGridPresets || []).some((other) => other.name === bond)) {
    settings.coarseGridPresetBond = preset.name ?? null;
  }
  settings.coarseGridCustom = true;
  settings.coarseGridBase = normalizeCoarseGridBase(preset.base);
  settings.coarseGridIncrement = normalizeCoarseGridIncrement(preset.increment);
  settings.coarseGridSecondaryMultiplier = SECONDARY_GRID_MULTIPLIERS.includes(
    secondary
  )
    ? secondary
    : 0;
}
