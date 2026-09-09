import {
  classSpread,
  deriveKernRowClusters,
  inheritCompositeClasses,
} from "@fontra/core/autokern-classes.js";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Composite inheritance (spec §5.3 tactic 1)
// ---------------------------------------------------------------------------

describe("inheritCompositeClasses", () => {
  it("a composite with no class inherits its base's class", () => {
    const existing = new Map([["a", "classA"]]);
    const bases = new Map([["aacute", "a"]]);
    const result = inheritCompositeClasses(existing, bases);
    expect(result.get("aacute")).to.equal("classA");
    expect(result.get("a")).to.equal("classA");
  });

  it("a composite that already has an explicit class keeps it", () => {
    const existing = new Map([
      ["a", "classA"],
      ["aacute", "classOwn"],
    ]);
    const bases = new Map([["aacute", "a"]]);
    const result = inheritCompositeClasses(existing, bases);
    expect(result.get("aacute")).to.equal("classOwn");
  });

  it("a base glyph with no class propagates 'no class' (nothing to inherit)", () => {
    const existing = new Map(); // "a" has no explicit class
    const bases = new Map([["aacute", "a"]]);
    const result = inheritCompositeClasses(existing, bases);
    expect(result.get("aacute") ?? null).to.equal(null);
  });

  it("resolves a chain transitively (composite of a composite)", () => {
    // A base has a class. B is a composite of A with no class of its own.
    // C is a composite of B with no class of its own. C should inherit A's
    // class through B, and B itself should also resolve to A's class.
    const existing = new Map([["a", "classA"]]);
    const bases = new Map([
      ["b", "a"],
      ["c", "b"],
    ]);
    const result = inheritCompositeClasses(existing, bases);
    expect(result.get("b")).to.equal("classA");
    expect(result.get("c")).to.equal("classA");
  });

  it("does not overwrite an explicit class partway down a chain", () => {
    const existing = new Map([
      ["a", "classA"],
      ["b", "classB"], // b has its own explicit class
    ]);
    const bases = new Map([
      ["b", "a"],
      ["c", "b"],
    ]);
    const result = inheritCompositeClasses(existing, bases);
    expect(result.get("b")).to.equal("classB"); // unchanged, explicit wins
    expect(result.get("c")).to.equal("classB"); // inherits from b, not a
  });

  it("does not mutate its inputs", () => {
    const existing = new Map([["a", "classA"]]);
    const bases = new Map([["aacute", "a"]]);
    inheritCompositeClasses(existing, bases);
    expect(existing.has("aacute")).to.equal(false);
  });
});

// ---------------------------------------------------------------------------
// Kern-row clustering (spec §5.3 tactic 2)
// ---------------------------------------------------------------------------

function makeScripts(pairs) {
  return new Map(pairs);
}

describe("deriveKernRowClusters", () => {
  const scriptsAllLatin = makeScripts([
    ["A", "Latin"],
    ["B", "Latin"],
    ["C", "Latin"],
    ["bracketleft", "Latin"],
  ]);
  const categoriesAllLetter = makeScripts([
    ["A", "Letter"],
    ["B", "Letter"],
    ["C", "Letter"],
    ["bracketleft", "Punctuation"],
  ]);

  it("merges two glyphs whose rows fully agree within tolerance", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "A", right: "v", value: -20 },
      { left: "B", right: "o", value: -10.4 },
      { left: "B", right: "v", value: -19.6 },
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      scriptsAllLatin,
      categoriesAllLetter
    );
    expect(clusters).to.have.lengthOf(1);
    expect(clusters[0].sort()).to.deep.equal(["A", "B"]);
  });

  it("does not merge two glyphs with a disagreeing column", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "A", right: "v", value: -20 },
      { left: "B", right: "o", value: -10 },
      { left: "B", right: "v", value: -50 }, // disagrees far past tolerance
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      scriptsAllLatin,
      categoriesAllLetter
    );
    expect(clusters).to.have.lengthOf(0);
  });

  it("does not merge two glyphs sharing zero columns (no evidence)", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "v", value: -10 }, // no shared column with A
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      scriptsAllLatin,
      categoriesAllLetter
    );
    expect(clusters).to.have.lengthOf(0);
  });

  it("resolves the non-transitive edge case: A~B, B~C, A NOT~C, principled clique growth", () => {
    // A and B agree on column "o". B and C agree on column "v". A and C
    // share the column "x" but disagree on it far past tolerance, so a naive
    // transitive closure (union-find on pairwise edges) would wrongly merge
    // {A, B, C} into one class. This module requires every pair within a
    // proposed class to mutually agree (a clique), grown greedily in
    // ascending glyph-name order, so C is rejected from the A/B cluster and
    // left on its own (and a singleton produces no proposal).
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -10.2 },
      { left: "B", right: "v", value: -20 },
      { left: "C", right: "v", value: -20.1 },
      { left: "A", right: "x", value: -5 },
      { left: "C", right: "x", value: -50 },
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      scriptsAllLatin,
      categoriesAllLetter
    );
    expect(clusters).to.have.lengthOf(1);
    expect(clusters[0].sort()).to.deep.equal(["A", "B"]);
  });

  it("never merges across scripts, even with identical rows", () => {
    const scriptsMixed = makeScripts([
      ["A", "Latin"],
      ["B", "Cyrillic"],
    ]);
    const categories = makeScripts([
      ["A", "Letter"],
      ["B", "Letter"],
    ]);
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -10 },
    ];
    const clusters = deriveKernRowClusters(cache, "left", 1, scriptsMixed, categories);
    expect(clusters).to.have.lengthOf(0);
  });

  it("never merges two glyphs absent from the script/category maps (unknown is not 'same')", () => {
    // Neither glyph has an entry in either map -- both scripts.get() calls
    // return undefined, and so do both categories.get() calls. Spec §5.3's
    // guard is an absolute ("never merge... without asking"), so unknown must
    // never be silently treated as "same known value" just because two
    // undefineds are strictly equal to each other.
    const emptyMap = makeScripts([]);
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -10 }, // identical row otherwise
    ];
    const clusters = deriveKernRowClusters(cache, "left", 1, emptyMap, emptyMap);
    expect(clusters).to.have.lengthOf(0);
  });

  it("never merges when only one of the pair has a known script/category", () => {
    const partialScripts = makeScripts([["A", "Latin"]]); // B is absent
    const partialCategories = makeScripts([
      ["A", "Letter"],
      ["B", "Letter"],
    ]);
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -10 },
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      partialScripts,
      partialCategories
    );
    expect(clusters).to.have.lengthOf(0);
  });

  it("never merges across Unicode categories, even with identical rows", () => {
    const scripts = makeScripts([
      ["A", "Latin"],
      ["bracketleft", "Latin"],
    ]);
    const categories = makeScripts([
      ["A", "Letter"],
      ["bracketleft", "Punctuation"],
    ]);
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "bracketleft", right: "o", value: -10 },
    ];
    const clusters = deriveKernRowClusters(cache, "left", 1, scripts, categories);
    expect(clusters).to.have.lengthOf(0);
  });

  it("treats a difference exactly at the tolerance as within (inclusive boundary)", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -11 }, // difference is exactly 1
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      scriptsAllLatin,
      categoriesAllLetter
    );
    expect(clusters).to.have.lengthOf(1);
    expect(clusters[0].sort()).to.deep.equal(["A", "B"]);
  });

  it("treats a difference just past the tolerance as not within", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -11.001 },
    ];
    const clusters = deriveKernRowClusters(
      cache,
      "left",
      1,
      scriptsAllLatin,
      categoriesAllLetter
    );
    expect(clusters).to.have.lengthOf(0);
  });

  it("operates on side 'right' independently of side 'left'", () => {
    // As side1 (left) glyphs, A and B disagree; as side2 (right) glyphs
    // (i.e. reading the "right" column of the cache), they agree.
    const cache = [
      { left: "A", right: "x", value: -10 },
      { left: "B", right: "x", value: -50 }, // left-side rows disagree
      { left: "p", right: "A", value: -8 },
      { left: "p", right: "B", value: -8.2 }, // right-side rows agree
    ];
    const scripts = makeScripts([
      ["A", "Latin"],
      ["B", "Latin"],
      ["p", "Latin"],
      ["x", "Latin"],
    ]);
    const categories = makeScripts([
      ["A", "Letter"],
      ["B", "Letter"],
      ["p", "Letter"],
      ["x", "Letter"],
    ]);
    const leftClusters = deriveKernRowClusters(cache, "left", 1, scripts, categories);
    const rightClusters = deriveKernRowClusters(cache, "right", 1, scripts, categories);
    expect(leftClusters).to.have.lengthOf(0);
    expect(rightClusters).to.have.lengthOf(1);
    expect(rightClusters[0].sort()).to.deep.equal(["A", "B"]);
  });

  it("does not mutate the cache array it is given", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -10 },
    ];
    const before = JSON.stringify(cache);
    deriveKernRowClusters(cache, "left", 1, scriptsAllLatin, categoriesAllLetter);
    expect(JSON.stringify(cache)).to.equal(before);
  });
});

// ---------------------------------------------------------------------------
// Spread (spec §5.2)
// ---------------------------------------------------------------------------

describe("classSpread", () => {
  it("computes a small spread for a tight class", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -10.4 },
      { left: "A", right: "v", value: -20 },
      { left: "B", right: "v", value: -19.8 },
    ];
    const result = classSpread(["A", "B"], cache, "left");
    expect(result.overall).to.be.closeTo(0.4, 1e-9);
    expect(result.perColumn.get("o")).to.be.closeTo(0.4, 1e-9);
    expect(result.perColumn.get("v")).to.be.closeTo(0.2, 1e-9);
  });

  it("computes a large spread for a wide (wrong) class", () => {
    const cache = [
      { left: "A", right: "o", value: -10 },
      { left: "B", right: "o", value: -60 },
    ];
    const result = classSpread(["A", "B"], cache, "left");
    expect(result.overall).to.be.closeTo(50, 1e-9);
  });

  it("a class of one member has zero spread", () => {
    const cache = [{ left: "A", right: "o", value: -10 }];
    const result = classSpread(["A"], cache, "left");
    expect(result.overall).to.equal(0);
    expect(result.perColumn.get("o")).to.equal(0);
  });
});
