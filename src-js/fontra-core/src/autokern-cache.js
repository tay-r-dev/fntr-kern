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
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

// Which pairs should be (re)measured, in one of two modes (spec §4: "The
// rerun has two modes, everything or marked only"). Both modes exclude
// junk pairs (spec §4.2: "a junk pair is never measured again").
//
// mode "marked": every entry with `stale: true` (and not junk).
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
