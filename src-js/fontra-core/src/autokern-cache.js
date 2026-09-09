// Cache / prefilter for forkra "Kerning view and autokern" (spec §4, §4.1,
// §4.2, workstream 4). Sits between "a font's glyphs" and "a run measures
// every pair".
//
// Pure data-transform, no DOM, no font/canvas objects: plain objects, Maps,
// arrays and numbers only -- the same discipline autokern-engine.js and
// autokern-classes.js keep. This module does not rasterize, measure, or
// resolve fonts; it only decides WHICH pairs are worth measuring (the
// prefilter) and holds the flat, measured result (the cache).
//
// Every exported function that touches a cache returns NEW data. None of
// them mutate an input, the same discipline autokern-classes.js documents
// for itself.
//
// ---------------------------------------------------------------------------
// Input contracts
// ---------------------------------------------------------------------------
//
// glyph envelope descriptor (for pairEnvelopesCanTouch):
//   { xMin: number, xMax: number, advance: number }
// All three in the SAME pixel space autokern-engine.js works in (pixels at
// the rendering size, the raster/units convention from that module's header
// comment) -- font-unit-agnostic, the caller has already converted. `xMin`/
// `xMax` are the glyph's own ink extent in its OWN local frame, i.e. the
// frame where the glyph's advance box runs from 0 to `advance` (ink may
// extend before 0 or past `advance`, same as a real sidebearing can be
// negative). This is deliberately NOT the raster's `originX`/`width` --
// those only exist once a raster has been built, and the whole point of a
// prefilter is to decide before any raster is built (spec §4: "a bounding
// test", done at no cost).
//
// cache entry: { left: string, right: string, value: number, junk: boolean,
// stale: boolean, override?: boolean }. `left`/`right` are glyph names;
// `value` is whatever unit the caller uses (mirrors autokern-classes.js's
// convention -- this module never interprets it). `junk` and `stale` are
// flags this module manages (spec §4, §4.2). `override` (KERNING-VIEW-BACKLOG.md
// item 8) is the designer's deliberate decision that this literal glyph×glyph
// value is meant to shadow the class cell that would otherwise answer for the
// pair -- independent of `junk` and `stale`, set/cleared by markPairOverride.
//
// cache: a Map<string, entry> keyed by pairKey(left, right) (see below) --
// deliberately NOT keyed by class (spec §4: "addressed by two glyph names,
// never by a class").

// ---------------------------------------------------------------------------
// The prefilter (spec §4: "Skip any pair whose envelopes cannot touch at any
// kern in range... a bounding test... removes most of the matrix at no
// cost.")
// ---------------------------------------------------------------------------

// Can `left`'s and `right`'s envelopes touch at ANY integer kern in
// [-maxKernMagnitude, +maxKernMagnitude]? Pure arithmetic, no raster needed
// (rail R-B: re-derived here rather than copy-pasted from overlapRaster's
// per-pixel placement, because no raster/originX exists yet at prefilter
// time -- see the input-contract comment above).
//
// Derivation. Work in a shared frame where left's own origin is 0. Placing
// `right` at a candidate kern `k` sits its origin at `left.advance + k`
// (the ordinary "after left's advance, offset by the kern" placement --
// this is the frame-free equivalent of autokern-engine.js's
// `lOffset = -(left.advance + left.originX) + right.originX - kern`, read
// with both originX terms taken as 0 since neither raster exists yet).
//
// Each glyph's envelope extends `bias` pixels past its own ink on every
// side (spec §2.2), so:
//   left envelope (fixed):     [left.xMin  - bias,               left.xMax  + bias]
//   right envelope (at k):     [right.xMin + left.advance + k - bias,
//                                right.xMax + left.advance + k + bias]
//
// Two intervals overlap iff each one's low end is <= the other's high end.
// Solving the two inequalities for k gives the exact range of kerns at
// which the envelopes touch:
//   kLow  = left.xMin - right.xMax - left.advance - 2*bias
//   kHigh = left.xMax - right.xMin - left.advance + 2*bias
// (touch happens for every k in [kLow, kHigh]). The pair can touch
// somewhere in the search range iff [kLow, kHigh] intersects
// [-maxKernMagnitude, +maxKernMagnitude], i.e.
//   kLow <= maxKernMagnitude  AND  kHigh >= -maxKernMagnitude
//
// Boundary convention: INCLUSIVE. Envelopes exactly touching (interval ends
// coincide) or a touch range ending exactly at maxKernMagnitude both count
// as "can touch" -- spec's instruction is to skip pairs that CANNOT touch,
// so ties are resolved toward keeping the pair (a false negative here
// silently drops a real pair from the whole-font run; a false positive
// only costs one wasted measurement). Deliberate, not incidental.
//
// `maxKernMagnitude` is the search's own constant to own (spec §2.5: "give
// up past twice the bias"), so it is a required parameter here, not
// hardcoded -- the caller will typically pass 2 * bias.
export function pairEnvelopesCanTouch(left, right, bias, maxKernMagnitude) {
  const kLow = left.xMin - right.xMax - left.advance - 2 * bias;
  const kHigh = left.xMax - right.xMin - left.advance + 2 * bias;
  return kLow <= maxKernMagnitude && kHigh >= -maxKernMagnitude;
}

// ---------------------------------------------------------------------------
// The flat cache (spec §4: "one entry per glyph pair, addressed by two
// glyph names, never by a class")
// ---------------------------------------------------------------------------

// The single way to build a cache key from a pair (rail R-B). Uses a
// control character as separator -- one no glyph name can legally contain
// -- so "ab"+"c" and "a"+"bc" never collide (a bare "+" or "-" join would).
const PAIR_KEY_SEPARATOR = "\u0000";

export function pairKey(left, right) {
  return `${left}${PAIR_KEY_SEPARATOR}${right}`;
}

export function createCache() {
  return new Map();
}

// Sets/updates a pair's measured value. Returns a NEW cache (does not
// mutate `cache`). Clears `stale` (a fresh measurement is definitionally
// not stale, spec §4). Preserves an existing `junk` flag rather than
// resetting it -- marking junk is a separate, deliberate designer action
// (spec §4.2: "a junk pair is never measured again"), so a remeasurement
// must never silently un-junk a pair the designer already excluded.
//
// Judgement call: the RIGHT place to enforce "never measured again" is the
// run itself -- it should never call setPairValue on a junk pair in the
// first place (see pairsForRerun below, which excludes junk pairs from
// both rerun modes so a conforming run never produces this call for a junk
// pair). This function stays defined and safe if it happens anyway: it
// still records the value (so a value is never silently lost) and still
// clears stale, but leaves `junk` exactly as it was.
export function setPairValue(cache, left, right, value) {
  const key = pairKey(left, right);
  const existing = cache.get(key);
  const result = new Map(cache);
  result.set(key, {
    left,
    right,
    value,
    junk: existing ? existing.junk : false,
    stale: false,
    // Carry an existing override decision through a remeasurement, the same
    // reason junk is carried above: it is the designer's judgement (item 8),
    // not something a fresh measurement should silently discard.
    override: existing ? !!existing.override : false,
  });
  return result;
}

// Sets (or clears, when `junk` is false) a pair's junk flag. Returns a NEW
// cache. Unmarking is supported deliberately (spec §4.2: "a mark... can be
// found and undone").
//
// Judgement call: if the pair has no existing entry, one is created here
// with `value: 0` and `stale: false` and the requested `junk` flag. In
// practice a junk mark is applied from an existing table row (spec §4.2:
// "a pair can be marked junk from its row"), so the pair will already have
// been measured -- this branch only guards against being called on a pair
// that somehow has no entry yet, so the function never throws or silently
// drops the mark.
export function markPairJunk(cache, left, right, junk = true) {
  const key = pairKey(left, right);
  const existing = cache.get(key);
  const result = new Map(cache);
  result.set(key, {
    left,
    right,
    value: existing ? existing.value : 0,
    junk,
    stale: existing ? existing.stale : false,
    // Independent flag -- a junk toggle must not clear an override decision.
    override: existing ? !!existing.override : false,
  });
  return result;
}

// Sets (or clears, when `override` is false) a pair's override flag
// (KERNING-VIEW-BACKLOG.md item 8: "a unique value shadowing an existing
// class"). Returns a NEW cache. Mirrors markPairJunk exactly: same
// immutability, same "create a value:0 entry if the pair somehow has none
// yet" guard so the mark is never silently dropped, and `override` is an
// independent flag alongside `junk`/`stale` -- setting it never touches
// either. Persists for free through the OPFS cache file (whole entry objects
// are serialised and rebuilt, no field whitelist).
export function markPairOverride(cache, left, right, override = true) {
  const key = pairKey(left, right);
  const existing = cache.get(key);
  const result = new Map(cache);
  result.set(key, {
    left,
    right,
    value: existing ? existing.value : 0,
    junk: existing ? existing.junk : false,
    stale: existing ? existing.stale : false,
    override,
  });
  return result;
}

// KERNING-VIEW-BACKLOG.md item 8 part 6: median of a class-pair's member
// values with override-candidate outliers dropped, so the aggregate a
// class×class row shows isn't dragged by the very pairs a designer is likely
// to override out. `samples` is Array<{ value, divergence }> -- `divergence`
// is the member pair's own suggestion minus the value its class cascade
// currently resolves to (computed by the caller, which owns the font lookup).
// A sample whose |divergence| >= groupThreshold is an outlier (the same
// magnitude test the view uses for "override candidate", part 2) and is left
// out of the median. If EVERY sample is an outlier, fall back to the
// unfiltered median rather than returning NaN. Assumes a non-empty `samples`.
export function medianDroppingOutliers(samples, groupThreshold) {
  const inliers = samples.filter(
    (sample) => Math.abs(sample.divergence) < groupThreshold
  );
  const source = inliers.length ? inliers : samples;
  const sorted = source.map((sample) => sample.value).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Rounded, because this number is what "apply" writes to the font and the
  // kerning tool only ever writes whole units. An even-sized member list's
  // midpoint is the only way a half unit gets in here; every sample is
  // already whole (autokern-engine.js's kernPair rounds its own answer).
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median);
}

// Which glyphs a font change redrew (issue 4). A cached suggestion is a
// statement about a shape, so only a change to that shape can make it
// wrong -- a renamed source, a development-status mark, a glyph lock or a
// note leaves every measured number exactly as true as it was. Marking on
// those turns the stale list into noise the designer learns to ignore.
//
// Geometry here is anything under a glyph's `layers`: the outline itself,
// its components, its advance width (the tool kerns relative to the spacing
// already there, spec 1), and the skeleton customData a layer's generated
// outline is built from. Everything else on a glyph -- its own customData,
// its sources' names, locations and customData -- is not.
//
// Takes a change object of the shape font-controller.js hands its change
// listeners; returns a sorted array of glyph names. Pure: it reads the
// change's own paths and nothing else.
export function glyphNamesWithGeometryChange(change) {
  const glyphNames = new Set();
  collectGeometryChangedGlyphNames(change, [], glyphNames);
  return [...glyphNames].sort();
}

function collectGeometryChangedGlyphNames(change, prefix, glyphNames) {
  if (!change) {
    return;
  }
  const path = prefix.concat(change.p || []);
  if (change.f) {
    if (path[0] !== "glyphs") {
      return;
    }
    if (path.length === 1) {
      // A whole glyph written at once (added, replaced, pasted): its
      // geometry is part of what was written, so it counts.
      if (change.a?.length) {
        glyphNames.add(change.a[0]);
      }
      return;
    }
    // path is ["glyphs", glyphName, ...], and the field the change writes
    // is its own last step -- so `layers` can be the path's third element
    // or, for a change addressing the layer dictionary itself, the field.
    if (path[2] === "layers" || (path.length === 2 && change.a?.[0] === "layers")) {
      glyphNames.add(path[1]);
    }
    return;
  }
  for (const childChange of change.c || []) {
    collectGeometryChangedGlyphNames(childChange, path, glyphNames);
  }
}

// Marks every cache row with `glyphName` on either side as stale. Returns a
// NEW cache; rows are never deleted or dropped, only flagged (spec §4: "A
// marked row is a suggestion for a shape that no longer exists. It is not
// deleted, because deleting it hides the fact that it went stale.").
//
// A junk pair is NOT exempt: junk and stale are independent flags (a junk
// pair can still go stale if the glyph shape changes underneath it -- the
// designer's decision to ignore the pair is orthogonal to whether the
// cached number still describes the current shape).
export function markGlyphStale(cache, glyphName) {
  const result = new Map(cache);
  for (const [key, entry] of cache) {
    if (entry.left === glyphName || entry.right === glyphName) {
      result.set(key, { ...entry, stale: true });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Metrics-only recalculation
// ---------------------------------------------------------------------------
//
// A kern is a distance between two inks. A run measures it by rasterizing
// both shapes and searching for the kern that makes the perceived gap match
// the calibrated band. Nothing about that search depends on where a glyph's
// origin sits -- only on the shapes themselves and on how far apart the
// placement puts them.
//
// So when a glyph keeps its shape and only its spacing moves, the answer
// does not have to be measured again. It moves by exactly as much as the
// placement moved, which is addition:
//
//   gap(k) = (advance(left) + k + xMin(right)) - xMax(left)
//
// The gap the run settled on is a property of the two shapes, so it is the
// same before and after. Solving for the new kern:
//
//   k' = k - (dAdvance(left) - dxMax(left) + dxMin(right))
//
// Read it as the two sidebearings the pair actually touches: left's right
// sidebearing (advance - xMax) and right's left sidebearing (xMin). Widen
// either by 10 units and the pair needs 10 less kern. Left's OWN left
// sidebearing cancels out, which is correct -- moving a glyph's ink and its
// advance together changes nothing between it and the glyph after it.
//
// glyph metrics record: { advance, xMin, xMax, yMin, yMax, numCoordinates },
// all in font units. The caller measures these; this module only compares
// them.

// Did this glyph keep its shape? Ink width, ink height, vertical position
// and the number of coordinates in the path all stay the same under a pure
// spacing change, and a real edit almost always moves one of them.
//
// ponytail: a fingerprint, not a proof. An edit that keeps every one of
// those four numbers (dragging one point exactly along a line that leaves
// the bounding box, say) reads as metrics-only here and its cached value
// would be adjusted rather than remeasured. The whole-font re-run stays the
// ground truth; upgrade this to a checksum of the coordinates themselves if
// a real font shows a false match.
export function glyphShapeUnchanged(before, after) {
  if (!before || !after) {
    return false;
  }
  return (
    before.numCoordinates === after.numCoordinates &&
    near(before.xMax - before.xMin, after.xMax - after.xMin) &&
    near(before.yMin, after.yMin) &&
    near(before.yMax, after.yMax)
  );
}

function near(a, b) {
  return Math.abs(a - b) < 0.001;
}

// The one arithmetic step, in font units. See the derivation above.
export function pairValueAfterMetricsChange(
  value,
  leftBefore,
  leftAfter,
  rightBefore,
  rightAfter
) {
  const leftRightSidebearing =
    leftAfter.advance - leftAfter.xMax - (leftBefore.advance - leftBefore.xMax);
  const rightLeftSidebearing = rightAfter.xMin - rightBefore.xMin;
  return Math.round(value - (leftRightSidebearing + rightLeftSidebearing));
}

// Recalculates every cache entry whose two glyphs both kept their shape, and
// clears its stale flag: a value corrected by arithmetic is as true as a
// measured one. `before` and `after` are plain objects of glyph metrics
// records keyed by glyph name -- `before` is what the run measured against,
// `after` is the font as it stands now.
//
// Returns { cache, recalculated, remaining }: a NEW cache, how many entries
// it corrected, and the sorted names of the glyphs it could not answer for,
// which are the glyphs that still need a real re-run.
export function recalculateMetricsOnly(cache, before, after) {
  const verdicts = new Map();
  const shapeKept = (glyphName) => {
    if (!verdicts.has(glyphName)) {
      verdicts.set(
        glyphName,
        glyphShapeUnchanged(before?.[glyphName], after?.[glyphName])
      );
    }
    return verdicts.get(glyphName);
  };

  const result = new Map(cache);
  let recalculated = 0;
  const remaining = new Set();
  for (const [key, entry] of cache) {
    const keptLeft = shapeKept(entry.left);
    const keptRight = shapeKept(entry.right);
    if (!keptLeft) {
      remaining.add(entry.left);
    }
    if (!keptRight) {
      remaining.add(entry.right);
    }
    // A junk pair is never measured and never recalculated -- the designer
    // has excluded it, and a number nobody reads is not worth correcting.
    if (!keptLeft || !keptRight || entry.junk) {
      continue;
    }
    const value = pairValueAfterMetricsChange(
      entry.value,
      before[entry.left],
      after[entry.left],
      before[entry.right],
      after[entry.right]
    );
    if (value === entry.value && !entry.stale) {
      continue;
    }
    result.set(key, { ...entry, value, stale: false });
    recalculated++;
  }
  return { cache: result, recalculated, remaining: [...remaining].sort() };
}

// Which pairs should be (re)measured, in one of three modes (spec §4: "The
// rerun has two modes, everything or marked only", plus the scoped mode
// below). Every mode excludes junk pairs (spec §4.2: "a junk pair is never
// measured again").
//
// mode "marked": every entry with `stale: true` (and not junk).
//
// mode "marked-and-new": those, plus every pair from `candidatePairsList`
// the cache has never held an entry for. A glyph added to the font since the
// last run is not stale -- staleness is a statement about an entry, and a new
// glyph has none -- so "marked" alone can never reach it, and the designer
// would have to rebuild the whole font to kern one added glyph. This is the
// scoped rerun's mode: it covers what changed and what appeared, and nothing
// that is already measured and still true.
//
// mode "everything": every non-junk entry already in the cache, PLUS --
// only if the caller supplies `candidatePairsList` -- any pair from that
// list not yet in the cache at all (a brand-new glyph pair, e.g. after a
// new glyph is added; a whole-font run must cover these too, spec §4:
// "one run measures every glyph pair in the font"). `candidatePairsList`
// is the output of `candidatePairs` below (already prefiltered). It is
// OPTIONAL: omitted, "everything" simply re-walks the existing cache
// (every non-junk row already known) -- this is the judgement call named
// in the report: the cache alone cannot enumerate pairs it has never seen,
// so a caller doing a true whole-font run (including brand-new glyphs)
// must pass the candidate list; a caller doing "recompute everything
// already tracked" does not need to.
export function pairsForRerun(cache, mode, candidatePairsList = null) {
  if (mode === "marked") {
    const result = [];
    for (const entry of cache.values()) {
      if (entry.junk) continue;
      if (entry.stale) {
        result.push({ left: entry.left, right: entry.right });
      }
    }
    return result;
  }

  if (mode === "marked-and-new") {
    const result = [];
    const seen = new Set();
    for (const entry of cache.values()) {
      if (entry.junk) continue;
      if (entry.stale) {
        seen.add(pairKey(entry.left, entry.right));
        result.push({ left: entry.left, right: entry.right });
      }
    }
    if (candidatePairsList) {
      for (const { left, right } of candidatePairsList) {
        const key = pairKey(left, right);
        // Already queued as stale, or already measured and still true.
        if (seen.has(key) || cache.has(key)) continue;
        seen.add(key);
        result.push({ left, right });
      }
    }
    return result;
  }

  if (mode === "everything") {
    const seen = new Set();
    const result = [];
    for (const entry of cache.values()) {
      if (entry.junk) continue;
      seen.add(pairKey(entry.left, entry.right));
      result.push({ left: entry.left, right: entry.right });
    }
    if (candidatePairsList) {
      for (const { left, right } of candidatePairsList) {
        const key = pairKey(left, right);
        if (seen.has(key)) continue;
        const existing = cache.get(key);
        if (existing && existing.junk) continue;
        seen.add(key);
        result.push({ left, right });
      }
    }
    return result;
  }

  throw new Error(`pairsForRerun: unknown mode "${mode}"`);
}

// Which of `glyphNames` the cache has never measured on either side. A glyph
// added to the font since the last run appears here; a glyph every one of
// whose pairs the prefilter rejected does too, which is the honest answer --
// the cache genuinely holds nothing about it, and a rerun that covers it
// costs one prefilter pass and measures nothing.
export function glyphNamesNotInCache(cache, glyphNames) {
  const seen = new Set();
  for (const entry of cache.values()) {
    seen.add(entry.left);
    seen.add(entry.right);
  }
  return glyphNames.filter((name) => !seen.has(name)).sort();
}

// ---------------------------------------------------------------------------
// Candidate enumeration (spec §4 prefilter + §4.2 excluded-glyph field)
// ---------------------------------------------------------------------------

// Every ordered pair (left, right) drawn from `glyphNames`, minus any glyph
// named in `excludedGlyphNames` (spec §4.2's excluded-glyph field --
// already parsed elsewhere, this just takes the plain list/Set of names),
// kept only when `canTouchFn(left, right)` returns true. `canTouchFn` is
// dependency-injected so this function needs no knowledge of rasters or
// bias (typically `(left, right) => pairEnvelopesCanTouch(envelopeOf(left),
// envelopeOf(right), bias, maxKernMagnitude)`, built by the caller).
//
// Judgement call: a glyph IS allowed to pair with itself (e.g. "oo" is a
// legitimate self-kern case, and the spec's own control glyphs are
// measured against themselves in calibration, §2.4) -- self-pairs are not
// filtered out here; `canTouchFn` decides case by case like any other pair.
export function candidatePairs(glyphNames, excludedGlyphNames, canTouchFn) {
  const excluded = new Set(excludedGlyphNames);
  const included = glyphNames.filter((name) => !excluded.has(name));
  const result = [];
  for (const left of included) {
    for (const right of included) {
      if (canTouchFn(left, right)) {
        result.push({ left, right });
      }
    }
  }
  return result;
}
