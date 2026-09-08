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
// Task 8, spec §2.1 invariants 5/6 and F19/F22: which of the two results
// tabs a normalized row belongs to. Only a "member-pair" row (a grouped
// glyph's own individual pair, part of a class-class product, with no
// saved rule of its own -- Task 2's own kind taxonomy) is gated by
// exposure; every other kind (a class-summary "class-rule" row, a plain
// "unique-pair" row, or a saved "pair-exception") is always in Default
// (invariant 5's own carve-outs -- deliberate exposure, saved exceptions,
// and the Potential tab are the ONLY three ways an individual member
// appears; a summary is never itself hidden by the exposure mechanism).
// `exposedNames` is the set of glyph names named directly via "%name%!" in
// either input (kerning.js's own token parsing, not repeated here);
// `showIndividualMembers` is the broad-exposure checkbox (F22). Exposing a
// member never removes its class summary (invariant 6) -- this predicate
// only ever adds a member-pair row in, it never removes a class-rule row,
// because callers apply it per-row independently.
export function rowVisibleInDefault(row, exposedNames, showIndividualMembers) {
  if (row.kind !== "member-pair") {
    return true;
  }
  return (
    showIndividualMembers || exposedNames.has(row.left) || exposedNames.has(row.right)
  );
}

// F19: "Potential exceptions displays individual member pairs whose
// suggestions fall outside class tolerance." `row.isCandidate` is supplied
// by the caller (kerning.js's own isOverrideCandidate) -- this predicate
// does not compute candidacy, per plan Task 8's own interface ("It
// consumes a candidate list supplied by the autokern adapter; it does not
// calculate candidates"). A row can be a candidate and still also appear
// in Default once exposed (F19: "including members that also qualify as
// candidates") -- the two tabs are independent views of the same row set,
// not a partition.
export function rowVisibleInPotential(row) {
  return !!row.isCandidate;
}

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
