// The shared table's pure rules: which rows the window holds, when a scroll
// moves it, and what text an editable cell commits. <data-table> reads these;
// they touch no DOM, so they carry the tests.

export function clampWindowStart(start, total, size) {
  const maxStart = Math.max(0, total - size);
  return Math.max(0, Math.min(start, maxStart));
}

export function windowEnd(start, total, size) {
  return Math.min(start + size, total);
}

// A scroll within `edge` pixels of the box's top or bottom moves the window by
// `step` rows toward that edge, if rows remain past it. Returns the row delta.
export function scrollWindowShift({
  scrollTop,
  scrollHeight,
  clientHeight,
  start,
  total,
  size,
  step,
  edge,
}) {
  const nearBottom = scrollHeight - scrollTop - clientHeight < edge;
  if (nearBottom && windowEnd(start, total, size) < total) {
    return step;
  }
  if (scrollTop < edge && start > 0) {
    return -step;
  }
  return 0;
}

// A number cell commits only a finite number; empty text is not zero. With
// `allowEmpty`, empty text commits null, for a value that can be cleared.
export function parseCellValue(
  text,
  { type = "text", round = false, allowEmpty = false } = {}
) {
  if (type !== "number") {
    return { valid: true, value: String(text ?? "") };
  }
  const trimmed = String(text ?? "").trim();
  const numeric = Number(trimmed);
  if (trimmed === "" && allowEmpty) {
    return { valid: true, value: null };
  }
  if (trimmed === "" || !Number.isFinite(numeric)) {
    return { valid: false, value: undefined };
  }
  return { valid: true, value: round ? Math.round(numeric) : numeric };
}

// An arrow key on a number cell: one `step` up or down, ten with Shift. Text
// that is not a number steps from zero. The sum is rounded to the step's own
// decimals, so 0.5 + 0.1 is 0.6, not 0.6000000000000001.
export function stepCellValue(text, { step = 1, direction = 1, big = false } = {}) {
  const current = Number(String(text ?? "").trim());
  const base =
    String(text ?? "").trim() !== "" && Number.isFinite(current) ? current : 0;
  const value = base + direction * step * (big ? 10 : 1);
  const decimals = (String(step).split(".")[1] || "").length;
  return Number(value.toFixed(decimals));
}

// Column widths kept in localStorage, as {columnId: px}. Anything that is not
// a positive number is dropped, and unreadable text is no widths at all, so a
// damaged entry never breaks the table.
export function parseStoredColumnWidths(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const widths = {};
  for (const [id, width] of Object.entries(parsed)) {
    if (typeof width === "number" && Number.isFinite(width) && width > 0) {
      widths[id] = width;
    }
  }
  return widths;
}

// A column's width after a drag of `dx` pixels: whole pixels, never below
// `minimum`.
export function resizedColumnWidth(startWidth, dx, minimum = 24) {
  return Math.max(minimum, Math.round(startWidth + dx));
}

// Widths that fit `available`: when they add up to more, every column gives
// up the same amount. A column that reaches `minimum` gives what it can, and
// its unmet share goes to the others. When even the minimums do not fit,
// every column is at its minimum.
export function fitColumnWidths(widths, available, minimum = 24) {
  const result = [...widths];
  let excess = result.reduce((sum, width) => sum + width, 0) - available;
  while (excess > 1e-6) {
    const free = result
      .map((width, index) => index)
      .filter((index) => result[index] > minimum);
    if (!free.length) {
      break;
    }
    const share = excess / free.length;
    for (const index of free) {
      const take = Math.min(share, result[index] - minimum);
      result[index] -= take;
      excess -= take;
    }
  }
  return result.map((width) => Math.round(width));
}

// The columns' widths after their box changed by `delta` pixels: every column
// gains or gives up the same amount; giving up stops at `minimum`, the unmet
// share going to the others (fitColumnWidths).
export function spreadColumnWidths(widths, delta, minimum = 24) {
  if (delta < 0) {
    const sum = widths.reduce((total, width) => total + width, 0);
    return fitColumnWidths(widths, sum + delta, minimum);
  }
  if (delta > 0 && widths.length) {
    const share = delta / widths.length;
    return widths.map((width) => Math.round(width + share));
  }
  return [...widths];
}
