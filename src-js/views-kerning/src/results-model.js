// Pure, view-local helpers for kerning result rows: stable row identity,
// display-value derivation, rule provenance, and numeric filter predicates.
// No DOM, no font writes -- kerning.js is the only caller that touches the
// real KerningController or the document.
//
// docs/superpowers/plans/2026-09-08-kerning-view-ux.md Task 2/5;
// docs/superpowers/kerning-ux-integration.md §5.1/§9 (binding to
// KerningController.getPairValues, not the approximate wouldShadowClassCell
// detector).

import {
  getCodePointFromGlyphName,
  getGlyphInfoFromGlyphName,
} from "@fontra/core/glyph-data.js";
import { pairsForRerun } from "@fontra/core/autokern-cache.js";

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

// Task 9, spec F09, ledger §8.3/§7 (the confirmed CSV fields: `category`,
// `case`). One glyph's own membership in one Unicode-types checkbox --
// looked up through the real glyph-data.js service, never guessed from the
// name string. "non-unicode" is the one category that reads
// getCodePointFromGlyphName instead of category/case (ledger §7: "a glyph
// with no `unicode` field and no recognized uniXXXX/uXXXXXX name pattern
// returns null -- this is the correct, existing primitive").
export function glyphMatchesCategory(glyphName, category) {
  if (category === "non-unicode") {
    return getCodePointFromGlyphName(glyphName) == null;
  }
  const info = getGlyphInfoFromGlyphName(glyphName);
  switch (category) {
    case "uppercase":
      return info?.case === "upper" || info?.case === "smallCaps";
    case "lowercase":
      return info?.case === "lower";
    case "punctuation":
      return info?.category === "Punctuation";
    case "symbols":
      return info?.category === "Symbol";
    case "marks":
      return info?.category === "Mark";
    case "numbers":
      return info?.category === "Number";
    default:
      return false;
  }
}

// Ledger §8.3: pair-side matching and mixed-category class-summary matching
// are the SAME rule underneath -- "does any glyph on the tested side(s)
// belong to this category." `leftNames`/`rightNames` are the caller's own
// resolved glyph-name lists: a single-element array for an ordinary pair
// row, the full membership list for a class-summary row (that's what makes
// "any member belongs to it" fall out of the same code, not a second
// implementation). `side` is the Side filter's own value ("left"/"right"/
// anything else meaning "all"); Side = All checks either side, mirroring
// F14's own "Class-to-unique includes both orientations" resolution.
export function pairMatchesCategory(leftNames, rightNames, side, category) {
  const matchesAny = (names) => names.some((name) => glyphMatchesCategory(name, category));
  if (side === "left") {
    return matchesAny(leftNames);
  }
  if (side === "right") {
    return matchesAny(rightNames);
  }
  return matchesAny(leftNames) || matchesAny(rightNames);
}

// Multiple checked categories combine as alternatives (F14: "Multiple
// choices within a filter combine as alternatives"). Ledger §8.4: zero
// checked categories is its own "nothing selected" state, not "show
// everything" -- this predicate returns false for every row in that case,
// and the caller (kerning.js) is responsible for rendering the distinct
// empty-state message rather than an ordinary empty table.
export function pairMatchesUnicodeTypes(leftNames, rightNames, side, categories) {
  if (!categories || categories.size === 0) {
    return false;
  }
  for (const category of categories) {
    if (pairMatchesCategory(leftNames, rightNames, side, category)) {
      return true;
    }
  }
  return false;
}

// F14's Class relationship filter.
//
// Corrected 2026-09-08 by the designer directly: "Class exceptions are
// essentially when a member of a class has different kerning value against
// anything (class/unique) than other members." This is broader than the
// original reading (kind === "pair-exception", which pairRowData only ever
// sets when BOTH sides are classed) -- a member of just ONE classed side
// with its own stored value, kerned against a unique glyph, is still a
// class exception: that member's value against that glyph diverges from
// what the rest of the class would get. So the real test is
// `row.explicitPairExists && at least one side is classed`, independent of
// pairRowData's `kind` (which drives EXPOSURE-gating -- whether a row is
// hidden by default under a class×class summary -- a separate concern from
// which relationship bucket it's filed under here). A fully unique pair
// (neither side classed) has no class to diverge from, so its own stored
// value is never an "exception," just Unique-to-unique.
// `leftClassed`/`rightClassed` are the caller's own isLeftClassed/
// isRightClassed reads -- this module has no font/controller access.
export function rowRelationship(row, leftClassed, rightClassed) {
  if (row.explicitPairExists && (leftClassed || rightClassed)) {
    return "exceptions";
  }
  if (leftClassed && rightClassed) {
    return "class-class";
  }
  if (leftClassed || rightClassed) {
    return "class-unique";
  }
  return "unique-unique";
}

// Multiple checked relationships combine as alternatives, same "nothing
// selected" carve-out as pairMatchesUnicodeTypes above (ledger §8.4).
export function rowMatchesRelationships(row, leftClassed, rightClassed, relationships) {
  if (!relationships || relationships.size === 0) {
    return false;
  }
  return relationships.has(rowRelationship(row, leftClassed, rightClassed));
}

// F14's table Glyphset filter, ledger §8.4's corrected uniform "any" rule:
// "a row matches if at least one glyph involved (either side of a pair, or
// any member of a class) belongs to the selected glyphset" -- deliberately
// NOT "both sides required," which was the plan's original wrong
// assumption, explicitly overridden. `memberNames` is null for "All" (no
// restriction); otherwise a Set of glyph names in the selected glyphset,
// already resolved by the caller (kerning.js owns loading/caching the
// actual glyphset data -- this module stays pure).
export function pairMatchesGlyphset(leftNames, rightNames, memberNames) {
  if (!memberNames) {
    return true;
  }
  return (
    leftNames.some((name) => memberNames.has(name)) ||
    rightNames.some((name) => memberNames.has(name))
  );
}

// Task 11, spec F10/F17, ledger's own interface note: "retain backend/cache
// compatibility behind the UI label if existing storage uses `junk`;
// introduce no data rename unless migration requires it." The OPFS cache
// entry and the project's saved junk-pair list (kerning.js's
// AUTOKERN_JUNK_PAIRS_CUSTOM_DATA_KEY) both keep the `junk` field/shape
// exactly as-is -- renaming either would be a real data migration for no
// UI benefit. This is the one seam where that stored field becomes the
// normalized row's own presentation-facing `hidden` flag (spec §2.1's
// "Hidden result" concept), so the mapping decision has exactly one place
// to be wrong.
export function hiddenFromCacheEntry(entry) {
  return !!entry?.junk;
}

// F10: "Hiding removes the result from normal display without deleting
// kerning" -- a hidden row is display-suppressed unless Show hidden (F17)
// is on. Mirrors the exact shape passesNumericFilters/pairRowVisible's
// other per-row gates use, so pairRowVisible's `row.junk && !filters.showJunk`
// inline check (the pre-Task-11 form) becomes one named, tested predicate
// instead of staying an anonymous condition duplicated at each row kind
// (a pair row here, a class-summary row in kerning.js's own render loop).
export function rowVisibleForHiddenState(hidden, showHidden) {
  return !hidden || showHidden;
}

// Task 12, spec F26/§12.3, plan's own proposed pattern: guards an
// asynchronous per-source read (loadAutokernCacheFromStorage's OPFS read is
// the one call site in this file that races on rapid source switching) so a
// result that resolves after either the revision counter moved on or the
// active source changed mid-flight is rejected rather than installed. Pure
// so the exact comparison is testable without a real async OPFS round-trip.
export function isStaleAsyncResult(
  revisionAtStart,
  currentRevision,
  sourceIdentifierAtStart,
  currentSourceIdentifier
) {
  return (
    revisionAtStart !== currentRevision ||
    sourceIdentifierAtStart !== currentSourceIdentifier
  );
}

// Task 17 (plan 2026-09-08-kerning-view-ux.md; ledger §10.6's proposed
// `getStaleGlyphs` contract, gap 2: "the underlying engine doesn't provide a
// ready-made completed/remaining list -- this must be computed from what the
// worker actually reports"). Every glyph name touching a non-junk stale pair
// on EITHER side, via the real, already-tested `pairsForRerun(cache,
// "marked")` primitive -- not a second, hand-rolled scan of the cache. This
// is deliberately the SAME set used both to populate the Stale glyphs panel
// and to decide which glyphs' rasters a scoped rerun job must build (ledger
// §10.2/§10.7 gap 1: restricting raster coverage to only the glyph the
// designer edited, rather than every glyph any stale pair names, silently
// leaves the OTHER side's stale pairs stuck stale forever even though the
// run reports success).
export function getStaleGlyphNames(cache) {
  const names = new Set();
  for (const { left, right } of pairsForRerun(cache, "marked")) {
    names.add(left);
    names.add(right);
  }
  return [...names].sort();
}

// Task 17, ledger §10.6/§10.7 gap 2: "completedGlyphs/remainingGlyphs must be
// derived on the main thread by diffing `stale` flags before/after -- the
// worker itself reports no such breakdown." Works uniformly whether the run
// finished, was cancelled, errored, or was rejected for belonging to a
// stale/mismatched source (ledger §10.5/gap 3): in every one of those cases
// `afterCache` is either the freshly-applied result or the untouched prior
// cache, and a target glyph that still has any stale pair on it is simply
// still in `getStaleGlyphNames(afterCache)` -- no separate "did it succeed"
// branch is needed here.
export function diffStaleRerun(targetGlyphNames, afterCache) {
  const stillStale = new Set(getStaleGlyphNames(afterCache));
  return {
    completedGlyphs: targetGlyphNames.filter((name) => !stillStale.has(name)),
    remainingGlyphs: targetGlyphNames.filter((name) => stillStale.has(name)),
  };
}

// Task 17 (ledger §11.4/§11.5 gap 1): `medianDroppingOutliers`
// (autokern-cache.js) computes its own inlier filter internally but does not
// return the count -- mirrors that exact filter (`|divergence| <
// groupThreshold`) and its exact fallback ("if that leaves zero inliers, the
// median falls back to the UNFILTERED set", so every sample counts as
// included in that case, not excluded) so this always agrees with what the
// median actually used. Kept here as a second, pure computation (the ledger's
// own named alternative to changing medianDroppingOutliers's return shape,
// which would touch every existing caller/test of that fontra-core function)
// rather than duplicating the filter inline at each render call site.
export function countMedianContributors(samples, groupThreshold) {
  const inlierCount = samples.filter(
    (sample) => Math.abs(sample.divergence) < groupThreshold
  ).length;
  const includedCount = inlierCount ? inlierCount : samples.length;
  return { includedCount, excludedCount: samples.length - includedCount };
}

// Task 17 (F23's own open question, ledger §10.4/§11.4: "a real open decision
// for whoever builds Task 17's F23 display, not something this investigation
// found already answered"). JUDGMENT CALL, not settled by any existing code:
// a class-summary row is treated as stale when ANY contributing pair is
// stale, not only when every contributor is -- the safer default per F23's
// own acceptance test ("the table does not display an obsolete suggestion as
// though it were current and reliable"), matching the plan's own suggested
// default. Flag this to the designer for confirmation; a future "only ALL
// contributors stale" reading would only need this one predicate changed.
export function aggregateStale(entries) {
  return entries.some((entry) => entry.stale);
}

// Task 18, spec F03, ledger §8.6. "Saved pair exceptions" must be counted
// from the real rule-provenance data (kernData.values, the same map
// explicitPairExists reads), never a historical cache badge -- so this
// starts from the raw stored-pair map, not the autokern cache (which only
// ever holds pairs autokern has actually measured; a manually created
// exception with no suggestion of its own would be invisible there).
// `values` is KerningController.values (kernData.values):
// {leftName: {rightName: [values per source]}}. A key on EITHER side
// starting with "@" addresses a class rule (addGroupPrefix's own
// convention: `_getPairNamesWithFallbacks`, kerning-controller.js), never a
// member-pair exception -- excluded here so a class rule's own stored value
// is never miscounted as one of its own exceptions (F03's no-double-count
// requirement).
export function flattenPairAddresses(values) {
  const addresses = [];
  for (const leftName of Object.keys(values || {})) {
    if (leftName.startsWith("@")) {
      continue;
    }
    for (const rightName of Object.keys(values[leftName] || {})) {
      if (rightName.startsWith("@")) {
        continue;
      }
      addresses.push({ left: leftName, right: rightName });
    }
  }
  return addresses;
}

// A saved pair exception is a literal-glyph address (flattenPairAddresses
// above) with at least one classed side -- the same "a member of a class
// kerns differently than the rest" test rowRelationship's own "exceptions"
// bucket uses (F14, above), not pairRowData's narrower `kind` field (which
// only calls a pair "pair-exception" when BOTH sides are classed). A fully
// unique pair's own stored value has no class to diverge from, so it is
// never counted here. `isLeftClassed`/`isRightClassed` are the caller's own
// live class-membership lookups -- this module has no font/controller
// access to derive them itself.
export function countSavedPairExceptions(addresses, isLeftClassed, isRightClassed) {
  return addresses.filter(
    ({ left, right }) => isLeftClassed(left) || isRightClassed(right)
  ).length;
}

// Task 18: "hidden results," the pair half -- every cache entry currently
// marked hidden (hiddenFromCacheEntry, Task 11's own field mapping), counted
// directly from the cache rather than from a render-time filtered row list.
// The render-time row list is the wrong source for this: pairRowVisible
// (kerning.js) already excludes a hidden row unless Show hidden is on, so a
// count taken from displayed rows would always read 0 while Show hidden is
// off -- exactly backwards for an analytics count meant to say how many
// things ARE hidden.
export function countHiddenPairs(cacheEntries) {
  return cacheEntries.filter(hiddenFromCacheEntry).length;
}

// Task 18: "hidden results," the class-summary half (Task 11/ledger §8.5's
// own separate per-class-row hide state, `hiddenClassRuleIds`, never
// cascaded to or from its members -- so this is a genuinely separate count,
// not a duplicate of countHiddenPairs above). Scoped to one source, since
// rowId embeds the source and a class row hidden under one source says
// nothing about another.
export function countHiddenClassRules(hiddenClassRuleIds, sourceIdentifier) {
  let count = 0;
  for (const id of hiddenClassRuleIds) {
    const [sourceId] = JSON.parse(id);
    if (sourceId === sourceIdentifier) {
      count++;
    }
  }
  return count;
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
