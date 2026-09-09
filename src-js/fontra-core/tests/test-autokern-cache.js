import {
  candidatePairs,
  createCache,
  markGlyphStale,
  markPairJunk,
  markPairOverride,
  glyphNamesNotInCache,
  glyphNamesWithGeometryChange,
  medianDroppingOutliers,
  pairEnvelopesCanTouch,
  pairKey,
  pairsForRerun,
  setPairValue,
} from "@fontra/core/autokern-cache.js";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// pairEnvelopesCanTouch (spec §4 prefilter)
// ---------------------------------------------------------------------------

describe("pairEnvelopesCanTouch", () => {
  it("returns true for adjacent-ish glyphs with a generous kern range", () => {
    const left = { xMin: 0, xMax: 10, advance: 10 };
    const right = { xMin: 0, xMax: 10, advance: 10 };
    expect(pairEnvelopesCanTouch(left, right, 5, 100)).to.equal(true);
  });

  it("returns false for wide glyphs with a large gap and a small kern range", () => {
    const left = { xMin: 0, xMax: 10, advance: 100 };
    const right = { xMin: 0, xMax: 10, advance: 100 };
    expect(pairEnvelopesCanTouch(left, right, 5, 2)).to.equal(false);
  });

  it("boundary: touches exactly at the extreme of the allowed kern range (inclusive)", () => {
    // Constructed so the touch range is exactly [-80, ...] and
    // maxKernMagnitude is exactly 80: kHigh == -maxKernMagnitude at the
    // boundary must count as CAN touch (inclusive convention, documented).
    const left = { xMin: 0, xMax: 10, advance: 100 };
    const right = { xMin: 0, xMax: 10, advance: 100 };
    // From the derivation: kHigh = left.xMax - right.xMin - left.advance + 2*bias
    //                          = 10 - 0 - 100 + 2*bias
    // Choose bias so kHigh = -80: 10 - 100 + 2*bias = -80 => 2*bias = 10 => bias = 5
    expect(pairEnvelopesCanTouch(left, right, 5, 80)).to.equal(true);
    // One unit past the boundary must not touch.
    expect(pairEnvelopesCanTouch(left, right, 5, 79)).to.equal(false);
  });

  it("returns true when the envelopes already overlap at kern zero", () => {
    const left = { xMin: 0, xMax: 500, advance: 500 };
    const right = { xMin: -10, xMax: 400, advance: 500 };
    expect(pairEnvelopesCanTouch(left, right, 5, 0)).to.equal(true);
  });
});

// ---------------------------------------------------------------------------
// pairKey
// ---------------------------------------------------------------------------

describe("pairKey", () => {
  it("is stable for the same pair", () => {
    expect(pairKey("a", "b")).to.equal(pairKey("a", "b"));
  });

  it("distinguishes order (a,b) from (b,a)", () => {
    expect(pairKey("a", "b")).to.not.equal(pairKey("b", "a"));
  });

  it("does not collide across a naive concatenation ambiguity", () => {
    // "ab" + "c" vs "a" + "bc" must not produce the same key.
    expect(pairKey("ab", "c")).to.not.equal(pairKey("a", "bc"));
  });
});

// ---------------------------------------------------------------------------
// Cache basics
// ---------------------------------------------------------------------------

describe("createCache", () => {
  it("is empty", () => {
    const cache = createCache();
    expect(cache.size).to.equal(0);
  });
});

describe("setPairValue", () => {
  it("sets a value and clears stale", () => {
    let cache = createCache();
    cache = markGlyphStale(setPairValue(cache, "a", "b", 1), "a");
    expect(cache.get(pairKey("a", "b")).stale).to.equal(true);
    cache = setPairValue(cache, "a", "b", 5);
    const entry = cache.get(pairKey("a", "b"));
    expect(entry.value).to.equal(5);
    expect(entry.stale).to.equal(false);
  });

  it("preserves an existing junk flag on remeasurement", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    cache = markPairJunk(cache, "a", "b", true);
    cache = setPairValue(cache, "a", "b", 99);
    const entry = cache.get(pairKey("a", "b"));
    expect(entry.junk).to.equal(true);
    expect(entry.value).to.equal(99);
    expect(entry.stale).to.equal(false);
  });

  it("does not mutate the input cache", () => {
    const cache = createCache();
    setPairValue(cache, "a", "b", 1);
    expect(cache.size).to.equal(0);
  });

  it("does not mutate an existing cache when updating a pair", () => {
    const cache1 = setPairValue(createCache(), "a", "b", 1);
    const cache2 = setPairValue(cache1, "a", "b", 2);
    expect(cache1.get(pairKey("a", "b")).value).to.equal(1);
    expect(cache2.get(pairKey("a", "b")).value).to.equal(2);
  });
});

describe("markPairJunk", () => {
  it("sets junk on an existing pair", () => {
    let cache = setPairValue(createCache(), "a", "b", 1);
    cache = markPairJunk(cache, "a", "b", true);
    expect(cache.get(pairKey("a", "b")).junk).to.equal(true);
  });

  it("un-sets junk (a mark can be found and undone)", () => {
    let cache = setPairValue(createCache(), "a", "b", 1);
    cache = markPairJunk(cache, "a", "b", true);
    cache = markPairJunk(cache, "a", "b", false);
    expect(cache.get(pairKey("a", "b")).junk).to.equal(false);
  });

  it("does not mutate the input cache", () => {
    const cache1 = setPairValue(createCache(), "a", "b", 1);
    const cache2 = markPairJunk(cache1, "a", "b", true);
    expect(cache1.get(pairKey("a", "b")).junk).to.equal(false);
    expect(cache2.get(pairKey("a", "b")).junk).to.equal(true);
  });
});

describe("markPairOverride", () => {
  it("round-trips override:true, leaves other fields intact, returns a new Map", () => {
    let cache = setPairValue(createCache(), "a", "b", 42);
    cache = markPairJunk(cache, "a", "b", true);
    const before = cache;
    const after = markPairOverride(cache, "a", "b");
    expect(after).to.be.an.instanceof(Map);
    expect(after).to.not.equal(before);
    expect(before.get(pairKey("a", "b")).override).to.not.equal(true);
    const entry = after.get(pairKey("a", "b"));
    expect(entry.override).to.equal(true);
    expect(entry.value).to.equal(42);
    expect(entry.junk).to.equal(true);
    expect(entry.stale).to.equal(false);
  });
});

describe("medianDroppingOutliers", () => {
  it("excludes a gross outlier past the threshold from the median", () => {
    // Inliers cluster at 10; one member pair diverges by 200, far past a
    // threshold of 20 -- it must not drag the reported median.
    const samples = [
      { value: 8, divergence: 2 },
      { value: 10, divergence: 0 },
      { value: 12, divergence: 3 },
      { value: 210, divergence: 200 },
    ];
    expect(medianDroppingOutliers(samples, 20)).to.equal(10);
  });

  it("falls back to the unfiltered median when every sample is an outlier", () => {
    const samples = [
      { value: 100, divergence: 100 },
      { value: 300, divergence: 300 },
    ];
    expect(medianDroppingOutliers(samples, 20)).to.equal(200);
  });

  // Issue 1: a class row's aggregate is written to the font by "apply", and
  // the kerning tool only ever writes whole units, so an even-sized member
  // list must not produce a half unit.
  it("returns a whole number when the even-count midpoint falls on a half", () => {
    const samples = [
      { value: 9, divergence: 0 },
      { value: 10, divergence: 0 },
    ];
    expect(medianDroppingOutliers(samples, 20)).to.equal(Math.round(9.5));
    expect(medianDroppingOutliers(samples, 20) % 1).to.equal(0);
  });
});

describe("markGlyphStale", () => {
  it("marks every row with the glyph on either side, leaves others untouched", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    cache = setPairValue(cache, "c", "a", 2);
    cache = setPairValue(cache, "c", "d", 3);
    cache = markGlyphStale(cache, "a");
    expect(cache.get(pairKey("a", "b")).stale).to.equal(true);
    expect(cache.get(pairKey("c", "a")).stale).to.equal(true);
    expect(cache.get(pairKey("c", "d")).stale).to.equal(false);
  });

  it("a junk pair still gets marked stale independently", () => {
    let cache = setPairValue(createCache(), "a", "b", 1);
    cache = markPairJunk(cache, "a", "b", true);
    cache = markGlyphStale(cache, "a");
    const entry = cache.get(pairKey("a", "b"));
    expect(entry.junk).to.equal(true);
    expect(entry.stale).to.equal(true);
  });

  it("does not mutate the input cache", () => {
    const cache1 = setPairValue(createCache(), "a", "b", 1);
    const cache2 = markGlyphStale(cache1, "a");
    expect(cache1.get(pairKey("a", "b")).stale).to.equal(false);
    expect(cache2.get(pairKey("a", "b")).stale).to.equal(true);
  });
});

describe("pairsForRerun", () => {
  it("'marked' returns only stale entries", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    cache = setPairValue(cache, "c", "d", 2);
    cache = markGlyphStale(cache, "a");
    const result = pairsForRerun(cache, "marked");
    expect(result).to.deep.equal([{ left: "a", right: "b" }]);
  });

  it("'everything' returns all non-junk entries and excludes junk ones", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    cache = setPairValue(cache, "c", "d", 2);
    cache = markPairJunk(cache, "c", "d", true);
    const result = pairsForRerun(cache, "everything");
    expect(result).to.deep.equal([{ left: "a", right: "b" }]);
  });

  it("'everything' excludes junk pairs even though they are also stale", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    cache = markPairJunk(cache, "a", "b", true);
    cache = markGlyphStale(cache, "a");
    const result = pairsForRerun(cache, "everything");
    expect(result).to.deep.equal([]);
  });

  it("'everything' with a candidatePairsList surfaces a brand-new pair not yet cached", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    const result = pairsForRerun(cache, "everything", [
      { left: "a", right: "b" },
      { left: "c", right: "d" }, // never measured, not in the cache at all
    ]);
    expect(result.sort((x, y) => x.left.localeCompare(y.left))).to.deep.equal([
      { left: "a", right: "b" },
      { left: "c", right: "d" },
    ]);
  });

  it("'everything' with a candidatePairsList still excludes a pair that is cached AND junk AND in the list", () => {
    let cache = createCache();
    cache = setPairValue(cache, "a", "b", 1);
    cache = markPairJunk(cache, "a", "b", true);
    const result = pairsForRerun(cache, "everything", [
      { left: "a", right: "b" }, // cached, junk, and (redundantly) listed as a candidate
      { left: "c", right: "d" },
    ]);
    expect(result).to.deep.equal([{ left: "c", right: "d" }]);
  });
});

// ---------------------------------------------------------------------------
// candidatePairs
// ---------------------------------------------------------------------------

describe("candidatePairs", () => {
  it("excludes named glyphs entirely, on either side", () => {
    const glyphs = ["a", "b", "c"];
    const result = candidatePairs(glyphs, ["b"], () => true);
    for (const { left, right } of result) {
      expect(left).to.not.equal("b");
      expect(right).to.not.equal("b");
    }
    // Self-pairs are allowed by design (see the "allows a glyph to pair with
    // itself" test below), so with an always-true canTouchFn, "a" and "c"
    // each pair with themselves too -- only "b" is excluded entirely.
    expect(result).to.deep.equal([
      { left: "a", right: "a" },
      { left: "a", right: "c" },
      { left: "c", right: "a" },
      { left: "c", right: "c" },
    ]);
  });

  it("only keeps pairs where the injected canTouchFn returns true", () => {
    const glyphs = ["a", "b"];
    const result = candidatePairs(
      glyphs,
      [],
      (left, right) => left === "a" && right === "b"
    );
    expect(result).to.deep.equal([{ left: "a", right: "b" }]);
  });

  it("allows a glyph to pair with itself (self-kern, e.g. 'oo')", () => {
    const glyphs = ["o"];
    const result = candidatePairs(glyphs, [], () => true);
    expect(result).to.deep.equal([{ left: "o", right: "o" }]);
  });
});

describe("glyphNamesWithGeometryChange (issue 4)", () => {
  // A cached suggestion describes a shape. Only a change to that shape can
  // make it wrong, so only a change to that shape may mark it stale. The
  // font's change objects carry the path that was written, which is enough
  // to tell a redrawn outline from a renamed source or a development-status
  // mark set in the editor.
  const glyphChange = (glyphName, rest) => ({
    p: ["glyphs", glyphName, ...rest.slice(0, -1)],
    f: "=",
    a: [rest.at(-1), 1],
  });

  it("names a glyph whose layer outline changed", () => {
    const change = glyphChange("a", ["layers", "foreground", "glyph", "path", "x"]);
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal(["a"]);
  });

  it("names a glyph whose layer advance width changed", () => {
    const change = glyphChange("a", ["layers", "foreground", "glyph", "xAdvance"]);
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal(["a"]);
  });

  it("ignores a development-status mark on a glyph source", () => {
    const change = glyphChange("a", [
      "sources",
      0,
      "customData",
      "fontra.development.status",
    ]);
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal([]);
  });

  it("ignores glyph-level customData, and the glyph's own lock flag", () => {
    const change = glyphChange("a", ["customData", "fontra.glyph.locked"]);
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal([]);
  });

  it("ignores a change outside the glyphs tree entirely", () => {
    const change = { p: ["kerning", "kern"], f: "=", a: ["a", 1] };
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal([]);
  });

  it("names a wholly replaced glyph", () => {
    const change = { p: ["glyphs"], f: "=", a: ["a", {}] };
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal(["a"]);
  });

  it("collects every changed glyph from a nested change, geometry only", () => {
    const change = {
      c: [
        glyphChange("a", ["layers", "foreground", "glyph", "path", "x"]),
        glyphChange("b", ["sources", 0, "customData", "fontra.development.status"]),
        glyphChange("c", ["layers", "background", "glyph", "components"]),
      ],
    };
    expect(glyphNamesWithGeometryChange(change)).to.deep.equal(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// New glyphs: pairsForRerun "marked-and-new" + glyphNamesNotInCache
// ---------------------------------------------------------------------------

describe("pairsForRerun marked-and-new", () => {
  function cacheWith(entries) {
    let cache = createCache();
    for (const [left, right, value, flags] of entries) {
      cache = setPairValue(cache, left, right, value);
      if (flags?.stale) {
        cache = markGlyphStale(cache, left);
      }
      if (flags?.junk) {
        cache = markPairJunk(cache, left, right);
      }
    }
    return cache;
  }

  it("takes the stale pairs and every candidate the cache has never held", () => {
    const cache = cacheWith([
      ["A", "B", -10, { stale: true }],
      ["A", "C", -12],
    ]);
    const pairs = pairsForRerun(cache, "marked-and-new", [
      { left: "A", right: "B" },
      { left: "A", right: "C" },
      { left: "A", right: "N" },
      { left: "N", right: "A" },
    ]);
    expect(pairs).to.deep.equal([
      { left: "A", right: "B" },
      { left: "A", right: "N" },
      { left: "N", right: "A" },
    ]);
  });

  it("leaves a junk pair out, new or stale", () => {
    const cache = cacheWith([["A", "B", -10, { junk: true }]]);
    const pairs = pairsForRerun(cache, "marked-and-new", [{ left: "A", right: "B" }]);
    expect(pairs).to.deep.equal([]);
  });

  it("is the stale set alone with no candidate list", () => {
    const cache = cacheWith([["A", "B", -10, { stale: true }]]);
    expect(pairsForRerun(cache, "marked-and-new")).to.deep.equal([
      { left: "A", right: "B" },
    ]);
  });
});

describe("glyphNamesNotInCache", () => {
  it("names the glyphs the cache has never measured, sorted", () => {
    let cache = createCache();
    cache = setPairValue(cache, "A", "B", -10);
    expect(glyphNamesNotInCache(cache, ["B", "A", "Z", "N"])).to.deep.equal(["N", "Z"]);
  });

  it("answers nothing when every glyph is covered", () => {
    let cache = createCache();
    cache = setPairValue(cache, "A", "B", -10);
    expect(glyphNamesNotInCache(cache, ["A", "B"])).to.deep.equal([]);
  });
});
