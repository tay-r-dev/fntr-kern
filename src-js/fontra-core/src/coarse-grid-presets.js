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
