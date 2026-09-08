// Pure, view-local helpers for kerning result rows: stable row identity,
// display-value derivation, rule provenance, and numeric filter predicates.
// No DOM, no font writes -- kerning.js is the only caller that touches the
// real KerningController or the document.
//
// docs/superpowers/plans/2026-09-08-kerning-view-ux.md Task 2/5;
// docs/superpowers/kerning-ux-integration.md §5.1/§9 (binding to
// KerningController.getPairValues, not the approximate wouldShadowClassCell
// detector).

// A row's identity must include its source (a pair can have different
// stored values per source) and the exact left/right names as addressed
// (a class address like "@A" is a different row from the literal pair it
// can shadow, spec §2.1 invariant 1: "class membership... and saved
// exception state are separate concepts").
export function rowId(sourceId, leftName, rightName) {
  return JSON.stringify([sourceId, leftName, rightName]);
}

// Spec F23: "the table does not display an obsolete suggestion as though
// it were current and reliable." A stale row's Proposed/Delta are
// unavailable (null); `current` always passes through unchanged --
// staleness is a property of the suggestion, not of what's actually
// stored.
export function valuesForDisplay(current, proposed, stale) {
  const available = !stale && Number.isFinite(proposed);
  return {
    current,
    proposed: available ? proposed : null,
    delta: available ? proposed - current : null,
    stale: !!stale,
  };
}

// Ledger §5.1/§9: rule provenance must be read through the literal-address
// primitive (KerningController.getPairValues), never approximated from the
// resolved cascade value -- a stored explicit zero and "nothing stored,
// cascade fell through to 0" are different facts, and only this read tells
// them apart. `controller` is duck-typed to `{getPairValues(leftName,
// rightName)}` so this is testable without constructing a real
// KerningController.
export function explicitPairExists(controller, leftName, rightName) {
  return controller.getPairValues(leftName, rightName) !== undefined;
}

// F13's exact predicate ("Current == 0 && Proposed != 0"), F16 (magnitude
// only, no sign filter) and F18's numeric interval (inclusive bounds,
// `maxDelta == null` means no maximum). A row whose delta is unavailable
// (stale/missing suggestion, per valuesForDisplay above) always passes --
// its warning must stay discoverable regardless of the numeric bounds in
// effect (plan Task 5's own decision note).
export function passesNumericFilters(row, filters) {
  if (
    filters.hideZeroCurrentSuggestions &&
    row.current === 0 &&
    Number.isFinite(row.proposed) &&
    row.proposed !== 0
  ) {
    return false;
  }
  if (!Number.isFinite(row.delta)) {
    return true;
  }
  const magnitude = Math.abs(row.delta);
  if (magnitude < filters.minDelta) {
    return false;
  }
  if (filters.maxDelta != null && magnitude > filters.maxDelta) {
    return false;
  }
  return true;
}
