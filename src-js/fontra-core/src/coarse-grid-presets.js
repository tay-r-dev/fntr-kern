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

// Applying a preset turns custom spacing on with its base and increment and
// sets the secondary grid. The spacing snaps to the new steps where it is read.
export function applyGridPreset(settings, preset) {
  const secondary = Number(preset.secondary);
  settings.coarseGridCustom = true;
  settings.coarseGridBase = normalizeCoarseGridBase(preset.base);
  settings.coarseGridIncrement = normalizeCoarseGridIncrement(preset.increment);
  settings.coarseGridSecondaryMultiplier = SECONDARY_GRID_MULTIPLIERS.includes(
    secondary
  )
    ? secondary
    : 0;
}
