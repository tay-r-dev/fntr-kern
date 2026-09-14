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
