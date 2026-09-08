import { expect } from "chai";
import {
  createCache,
  markGlyphStale,
  markPairJunk,
  setPairValue,
} from "@fontra/core/autokern-cache.js";
import {
  aggregateStale,
  countMedianContributors,
  diffStaleRerun,
  explicitPairExists,
  getStaleGlyphNames,
  isStaleAsyncResult,
  passesNumericFilters,
  rowId,
  valuesForDisplay,
} from "../src/results-model.js";

describe("results-model", () => {
  it("rowId includes source and distinguishes class from literal addresses", () => {
    expect(rowId("s1", "@A", "@V")).to.not.equal(rowId("s1", "A", "V"));
    expect(rowId("s1", "A", "V")).to.not.equal(rowId("s2", "A", "V"));
    expect(rowId("s1", "A", "V")).to.equal(rowId("s1", "A", "V"));
  });

  it("valuesForDisplay hides proposed/delta when stale, keeps current", () => {
    expect(valuesForDisplay(-80, -30, true)).to.deep.equal({
      current: -80,
      proposed: null,
      delta: null,
      stale: true,
    });
    expect(valuesForDisplay(-80, -30, false)).to.deep.equal({
      current: -80,
      proposed: -30,
      delta: 50,
      stale: false,
    });
  });

  it("valuesForDisplay treats a non-finite proposed as unavailable even when not stale", () => {
    expect(valuesForDisplay(-80, undefined, false)).to.deep.equal({
      current: -80,
      proposed: null,
      delta: null,
      stale: false,
    });
  });

  it("explicitPairExists is true for a stored zero, false for absence", () => {
    const controllerWithZero = { getPairValues: () => [0, null] };
    const controllerWithNothing = { getPairValues: () => undefined };
    expect(explicitPairExists(controllerWithZero, "Adieresis", "W")).to.equal(true);
    expect(explicitPairExists(controllerWithNothing, "Adieresis", "W")).to.equal(
      false
    );
  });

  it("passesNumericFilters: column visibility never enters this predicate", () => {
    const f = { minDelta: 5, maxDelta: 20, hideZeroCurrentSuggestions: false };
    expect(
      passesNumericFilters({ current: -80, proposed: -60, delta: 20 }, f)
    ).to.equal(true);
    expect(
      passesNumericFilters({ current: -80, proposed: -100, delta: -20 }, f)
    ).to.equal(true);
    expect(
      passesNumericFilters({ current: -80, proposed: -84, delta: -4 }, f)
    ).to.equal(false);
    expect(
      passesNumericFilters({ current: -80, proposed: 0, delta: 80 }, {
        ...f,
        maxDelta: 20,
      })
    ).to.equal(false);
  });

  it("passesNumericFilters: exact hideZeroCurrentSuggestions predicate", () => {
    const f = { minDelta: 0, maxDelta: null, hideZeroCurrentSuggestions: true };
    expect(
      passesNumericFilters({ current: 0, proposed: 10, delta: 10 }, f)
    ).to.equal(false);
    expect(
      passesNumericFilters({ current: 0, proposed: 0, delta: 0 }, f)
    ).to.equal(true);
    expect(
      passesNumericFilters({ current: -5, proposed: 10, delta: 15 }, f)
    ).to.equal(true);
  });

  it("passesNumericFilters: F18 inclusive bounds -- min and max are both eligible at the boundary", () => {
    const f = { minDelta: 5, maxDelta: 20, hideZeroCurrentSuggestions: false };
    expect(passesNumericFilters({ current: 0, proposed: 5, delta: 5 }, f)).to.equal(
      true
    );
    expect(passesNumericFilters({ current: 0, proposed: -5, delta: -5 }, f)).to.equal(
      true
    );
    expect(passesNumericFilters({ current: 0, proposed: 20, delta: 20 }, f)).to.equal(
      true
    );
    expect(passesNumericFilters({ current: 0, proposed: 21, delta: 21 }, f)).to.equal(
      false
    );
    expect(
      passesNumericFilters({ current: 0, proposed: 4.9, delta: 4.9 }, f)
    ).to.equal(false);
  });

  it("passesNumericFilters: an unavailable delta always passes the numeric bounds", () => {
    const f = { minDelta: 50, maxDelta: 60, hideZeroCurrentSuggestions: false };
    expect(
      passesNumericFilters({ current: -80, proposed: null, delta: null }, f)
    ).to.equal(true);
  });

  // Task 12, spec F26/§12.3: loadAutokernCacheFromStorage's own async guard
  // (kerning.js) is exactly `isStaleAsyncResult(revisionAtStart,
  // this.autokernCacheLoadRevision, sourceIdentifierAtStart,
  // this.autokernSource)`, called after the await, before installing the
  // result.
  it("isStaleAsyncResult: a matching revision and source is not stale", () => {
    expect(isStaleAsyncResult(1, 1, "a", "a")).to.equal(false);
  });

  it("isStaleAsyncResult: a revision that has moved on (a newer call started) is stale", () => {
    expect(isStaleAsyncResult(1, 2, "a", "a")).to.equal(true);
  });

  it("isStaleAsyncResult: the same revision but the active source changed mid-flight is stale", () => {
    expect(isStaleAsyncResult(1, 1, "a", "b")).to.equal(true);
  });

  // Task 17, ledger §10.6/§10.7 gap 2.
  describe("getStaleGlyphNames / diffStaleRerun", () => {
    function threeGlyphCache() {
      let cache = createCache();
      cache = setPairValue(cache, "l", "l", 999);
      cache = setPairValue(cache, "l", "n", 999);
      cache = setPairValue(cache, "n", "l", 999);
      cache = setPairValue(cache, "n", "o", 999);
      cache = setPairValue(cache, "o", "n", 999);
      return cache;
    }

    it("collects every glyph on either side of a non-junk stale pair, not just the marked glyph", () => {
      const cache = markGlyphStale(threeGlyphCache(), "n");
      // markGlyphStale marks every entry touching "n": l x n, n x l, n x o
      // (o x n has no entry). The affected glyph set is n's own partners too
      // -- "l" and "o" -- not only "n" itself, matching the raster-coverage
      // requirement (§10.2's silent-skip finding).
      expect(getStaleGlyphNames(cache)).to.deep.equal(["l", "n", "o"]);
    });

    it("excludes a stale pair that is also marked junk (pairsForRerun's own rule)", () => {
      let cache = markGlyphStale(threeGlyphCache(), "n");
      // Junk every entry touching n except one, so only that one remains a
      // real rerun target.
      cache = markPairJunk(cache, "l", "n", true);
      cache = markPairJunk(cache, "n", "l", true);
      // Only "n" x "o" is left stale and non-junk.
      expect(getStaleGlyphNames(cache)).to.deep.equal(["n", "o"]);
    });

    it("empty when nothing is stale -- the panel's own empty-state condition", () => {
      expect(getStaleGlyphNames(threeGlyphCache())).to.deep.equal([]);
    });

    it("diffStaleRerun: a fully-recomputed target set has no remaining stale glyphs", () => {
      const before = markGlyphStale(threeGlyphCache(), "n");
      const target = getStaleGlyphNames(before); // ["l", "n", "o"]
      let after = setPairValue(before, "l", "n", 1);
      after = setPairValue(after, "n", "l", 1);
      after = setPairValue(after, "n", "o", 1);
      after = setPairValue(after, "o", "n", 1);
      expect(diffStaleRerun(target, after)).to.deep.equal({
        completedGlyphs: ["l", "n", "o"],
        remainingGlyphs: [],
      });
    });

    it("diffStaleRerun: a partner glyph with no raster is left stale -- reported as remaining, not silently dropped", () => {
      const before = markGlyphStale(threeGlyphCache(), "n");
      const target = getStaleGlyphNames(before);
      // Only "n" x "l" got remeasured (e.g. only n's own raster was
      // supplied); "l" x "n" and "n" x "o" are still stale.
      const after = setPairValue(before, "n", "l", 1);
      expect(diffStaleRerun(target, after)).to.deep.equal({
        completedGlyphs: [],
        remainingGlyphs: ["l", "n", "o"],
      });
    });

    it("diffStaleRerun: a cancelled/rejected run whose cache is untouched reports every target still remaining", () => {
      const before = markGlyphStale(threeGlyphCache(), "n");
      const target = getStaleGlyphNames(before);
      // Cache never changed (cancel, error, or a source-mismatch rejection
      // per ledger §10.5/gap 3) -- F02's own requirement: "a failed or
      // cancelled run must not label unprocessed results fresh."
      expect(diffStaleRerun(target, before)).to.deep.equal({
        completedGlyphs: [],
        remainingGlyphs: ["l", "n", "o"],
      });
    });
  });

  // Task 17, ledger §11.4/§11.5 gap 1.
  describe("countMedianContributors", () => {
    it("counts inliers only, when at least one inlier exists", () => {
      const samples = [
        { divergence: 2 }, // inlier
        { divergence: -70 }, // outlier
        { divergence: 4 }, // inlier
      ];
      expect(countMedianContributors(samples, 10)).to.deep.equal({
        includedCount: 2,
        excludedCount: 1,
      });
    });

    it("when every sample is an outlier, mirrors medianDroppingOutliers's own fallback -- everyone counts as included", () => {
      const samples = [{ divergence: 20 }, { divergence: -30 }];
      expect(countMedianContributors(samples, 10)).to.deep.equal({
        includedCount: 2,
        excludedCount: 0,
      });
    });
  });

  // Task 17 (F23's own open question, judgment call): "any contributor
  // stale" marks the aggregate stale.
  describe("aggregateStale", () => {
    it("stale when at least one contributing entry is stale", () => {
      expect(
        aggregateStale([{ stale: false }, { stale: true }, { stale: false }])
      ).to.equal(true);
    });

    it("not stale when no contributor is stale", () => {
      expect(aggregateStale([{ stale: false }, { stale: false }])).to.equal(false);
    });

    it("not stale for an empty contributor set", () => {
      expect(aggregateStale([])).to.equal(false);
    });
  });
});
