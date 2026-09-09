import { expect } from "chai";
import {
  glyphMatchesCategory,
  pairMatchesCategory,
  pairMatchesGlyphset,
  pairMatchesUnicodeTypes,
  rowMatchesRelationships,
  rowRelationship,
} from "../src/results-model.js";

// Task 9, spec F09/F14; ledger §8.3/§8.4. Every category assertion below
// resolves through the real glyph-data.js CSV-backed lookup (glyph-data.csv,
// scanned directly for these exact rows), not a fixture that fakes category
// strings -- a wrong category string in the predicate would fail these.
describe("results-model: glyphMatchesCategory (F09, ledger §8.3)", () => {
  it("encoded /A resolves to Letter/upper -- uppercase, not lowercase or non-Unicode", () => {
    expect(glyphMatchesCategory("A", "uppercase")).to.equal(true);
    expect(glyphMatchesCategory("A", "lowercase")).to.equal(false);
    expect(glyphMatchesCategory("A", "non-unicode")).to.equal(false);
  });

  it("an accented uppercase letter (Adieresis) remains a letter, not a combining mark", () => {
    expect(glyphMatchesCategory("Adieresis", "uppercase")).to.equal(true);
    expect(glyphMatchesCategory("Adieresis", "marks")).to.equal(false);
  });

  it("a combining mark (gravecomb, category Mark) is Combining diacritics; its own case field (lower) is a separate, independent fact, not exclusive with it", () => {
    expect(glyphMatchesCategory("gravecomb", "marks")).to.equal(true);
    expect(glyphMatchesCategory("gravecomb", "lowercase")).to.equal(true);
    expect(glyphMatchesCategory("gravecomb", "uppercase")).to.equal(false);
  });

  it("smallCaps counts as uppercase (visually cased-upper, ledger §8.3)", () => {
    expect(glyphMatchesCategory("jacute.sc", "uppercase")).to.equal(true);
  });

  it("an unencoded alternate glyph name (no CSV entry, no uniXXXX pattern) is non-Unicode only", () => {
    expect(glyphMatchesCategory("A.ss01", "non-unicode")).to.equal(true);
    expect(glyphMatchesCategory("A.ss01", "uppercase")).to.equal(false);
  });

  it("Numbers is its own category (ledger §8.3, added 2026-09-08)", () => {
    expect(glyphMatchesCategory("zero", "numbers")).to.equal(true);
    expect(glyphMatchesCategory("zero", "uppercase")).to.equal(false);
  });

  it("Punctuation and Symbols read the exact CSV category strings", () => {
    expect(glyphMatchesCategory("comma", "punctuation")).to.equal(true);
    expect(glyphMatchesCategory("at", "symbols")).to.equal(true);
    expect(glyphMatchesCategory("at", "punctuation")).to.equal(false);
  });
});

describe("results-model: pairMatchesCategory / pairMatchesUnicodeTypes (F09 pair-side matching)", () => {
  // Both mixed class/glyph orientations: a class-summary row passes its
  // full membership list on each side; an ordinary pair row passes a
  // single-element array. Same predicate either way.
  const upperMembers = ["A", "Adieresis"];
  const lowerMembers = ["a", "gravecomb"]; // mixed-category class: a + a combining mark

  it("Side = left only tests the left side's names", () => {
    expect(pairMatchesCategory(upperMembers, lowerMembers, "left", "uppercase")).to.equal(
      true
    );
    expect(pairMatchesCategory(upperMembers, lowerMembers, "left", "marks")).to.equal(
      false
    );
  });

  it("Side = right only tests the right side's names", () => {
    expect(pairMatchesCategory(upperMembers, lowerMembers, "right", "marks")).to.equal(
      true
    );
    expect(pairMatchesCategory(upperMembers, lowerMembers, "right", "uppercase")).to.equal(
      false
    );
  });

  it("Side = all (anything other than left/right) matches if either side matches", () => {
    expect(pairMatchesCategory(upperMembers, lowerMembers, "all", "marks")).to.equal(true);
    expect(pairMatchesCategory(upperMembers, lowerMembers, "all", "numbers")).to.equal(
      false
    );
  });

  it("mixed-category class: matches a checked category if ANY member belongs to it", () => {
    // lowerMembers mixes a plain lowercase letter with a combining mark --
    // the class as a whole must match both categories, not just the
    // majority one.
    expect(pairMatchesCategory([], lowerMembers, "right", "lowercase")).to.equal(true);
    expect(pairMatchesCategory([], lowerMembers, "right", "marks")).to.equal(true);
  });

  it("pairMatchesUnicodeTypes ORs multiple checked categories", () => {
    const categories = new Set(["marks", "numbers"]);
    expect(
      pairMatchesUnicodeTypes(upperMembers, lowerMembers, "all", categories)
    ).to.equal(true); // right side has a mark
    expect(
      pairMatchesUnicodeTypes(upperMembers, ["a"], "all", categories)
    ).to.equal(false); // neither side matches marks or numbers
  });

  it("an empty category multi-select matches nothing -- the caller renders the distinct empty state", () => {
    expect(
      pairMatchesUnicodeTypes(upperMembers, lowerMembers, "all", new Set())
    ).to.equal(false);
  });
});

describe("results-model: rowRelationship / rowMatchesRelationships (F14 Class relationship)", () => {
  it("both sides classed, no saved rule -- Class-to-class (covers class-summary rows and exposed members alike)", () => {
    expect(
      rowRelationship({ kind: "member-pair", explicitPairExists: false }, true, true)
    ).to.equal("class-class");
  });

  it("exactly one side classed, no saved rule -- Class-to-unique, either orientation", () => {
    expect(
      rowRelationship({ kind: "unique-pair", explicitPairExists: false }, true, false)
    ).to.equal("class-unique");
    expect(
      rowRelationship({ kind: "unique-pair", explicitPairExists: false }, false, true)
    ).to.equal("class-unique");
  });

  it("neither side classed -- Unique-to-unique, even with its own stored value (nothing to diverge from)", () => {
    expect(
      rowRelationship({ kind: "unique-pair", explicitPairExists: false }, false, false)
    ).to.equal("unique-unique");
    expect(
      rowRelationship({ kind: "unique-pair", explicitPairExists: true }, false, false)
    ).to.equal("unique-unique");
  });

  it("a saved explicit pair over an applicable class rule, both sides classed -- Class exceptions", () => {
    expect(
      rowRelationship({ kind: "pair-exception", explicitPairExists: true }, true, true)
    ).to.equal("exceptions");
  });

  it("corrected 2026-09-08 (designer): a saved explicit value on just ONE classed side is still a Class exception -- it diverges from other class members against the same partner", () => {
    expect(
      rowRelationship({ kind: "unique-pair", explicitPairExists: true }, true, false)
    ).to.equal("exceptions");
    expect(
      rowRelationship({ kind: "unique-pair", explicitPairExists: true }, false, true)
    ).to.equal("exceptions");
  });

  it("an exposed member with no saved exception is NOT classified as Class exceptions (ledger §8.4)", () => {
    // Same class pairing as its class-summary row -- Class-to-class, not
    // Class exceptions, exactly the ledger's own correction.
    const exposedNoException = { kind: "member-pair", explicitPairExists: false };
    expect(rowRelationship(exposedNoException, true, true)).to.equal("class-class");
  });

  it("rowMatchesRelationships ORs multiple checked buckets", () => {
    const relationships = new Set(["class-class", "exceptions"]);
    expect(
      rowMatchesRelationships(
        { kind: "member-pair", explicitPairExists: false },
        true,
        true,
        relationships
      )
    ).to.equal(true);
    expect(
      rowMatchesRelationships(
        { kind: "unique-pair", explicitPairExists: false },
        false,
        false,
        relationships
      )
    ).to.equal(false);
  });

  it("zero checked relationships matches nothing -- distinct from 'all' (ledger §8.4)", () => {
    expect(
      rowMatchesRelationships({ kind: "member-pair" }, true, true, new Set())
    ).to.equal(false);
  });
});

describe("results-model: pairMatchesGlyphset (F14, ledger §8.4 corrected uniform 'any' rule)", () => {
  const members = new Set(["A", "V"]);

  it("All (null members) imposes no restriction", () => {
    expect(pairMatchesGlyphset(["comma"], ["quotedblleft"], null)).to.equal(true);
  });

  it("a flat pair row matches if EITHER glyph is a member -- not both required", () => {
    expect(pairMatchesGlyphset(["A"], ["comma"], members)).to.equal(true); // left only
    expect(pairMatchesGlyphset(["comma"], ["V"], members)).to.equal(true); // right only
    expect(pairMatchesGlyphset(["comma"], ["quotedblleft"], members)).to.equal(false);
  });

  it("a class-summary row matches if any single member of the class is a member of the glyphset", () => {
    const leftClassMembers = ["comma", "period", "A"]; // A is a member, the rest are not
    expect(pairMatchesGlyphset(leftClassMembers, ["quotedblleft"], members)).to.equal(
      true
    );
  });
});
