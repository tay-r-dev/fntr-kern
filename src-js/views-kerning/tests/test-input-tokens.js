import { expect } from "chai";
import {
  adjacentPairsForGlyph,
  crossProductPairs,
  pairMatchesGlyphFilter,
  parseToken,
  replaceGlyphToken,
  resolveGlyphFilter,
  serializeToken,
} from "../src/input-tokens.js";

const resolver = {
  characterMap: { 0x00c4: "Adieresis" },
  glyphMap: { h: [104], e: [101], l: [108], o: [111], Adieresis: [196] },
  classMembers: (name, side) => (name === "H" && side === "left" ? ["h"] : []),
};

describe("single Glyph filter", () => {
  it("accepts plain names and characters, and rejects the removed % shape", () => {
    expect(replaceGlyphToken("Adieresis")).to.equal("Adieresis");
    expect([...resolveGlyphFilter("Ä", resolver).left]).to.deep.equal(["Adieresis"]);
    expect(resolveGlyphFilter("/Adieresis", resolver).error).to.equal(null);
    expect(() => parseToken("%Adieresis%!")).to.throw();
    expect(() => parseToken("!")).to.throw();
  });
  it("shows all pairs for empty input and fails closed for unknown names", () => {
    expect(pairMatchesGlyphFilter("h", "o", resolveGlyphFilter("", resolver))).to.equal(
      true
    );
    expect(
      pairMatchesGlyphFilter("h", "o", resolveGlyphFilter("unknown", resolver))
    ).to.equal(false);
  });
  it("one glyph matches either side, with directional narrowing", () => {
    const filter = resolveGlyphFilter("h", resolver);
    expect(pairMatchesGlyphFilter("h", "o", filter)).to.equal(true);
    expect(pairMatchesGlyphFilter("o", "h", filter)).to.equal(true);
    expect(pairMatchesGlyphFilter("o", "h", filter, "left")).to.equal(false);
  });
  it("several glyphs include both orders and self-pairs, excluding other partners", () => {
    const filter = resolveGlyphFilter("h, e, l", resolver);
    expect(pairMatchesGlyphFilter("e", "h", filter)).to.equal(true);
    expect(pairMatchesGlyphFilter("h", "h", filter)).to.equal(true);
    expect(pairMatchesGlyphFilter("h", "o", filter)).to.equal(false);
    expect(crossProductPairs(filter.left, filter.right).pairs).to.have.length(9);
  });
  it("a class token resolves on its actual kerning side", () => {
    const filter = resolveGlyphFilter("@H", resolver);
    expect(pairMatchesGlyphFilter("h", "e", filter)).to.equal(true);
    expect(pairMatchesGlyphFilter("e", "h", filter)).to.equal(false);
  });
  it("Shift-click uses only the neighbors of the clicked occurrence", () => {
    const lines = [
      { glyphs: [..."hello"].map((glyphName) => ({ glyphName })) },
      { glyphs: [{ glyphName: "h" }] },
    ];
    expect(adjacentPairsForGlyph(lines, { lineIndex: 0, glyphIndex: 1 })).to.deep.equal(
      [
        ["h", "e"],
        ["e", "l"],
      ]
    );
    // A repeat is included only when it really touches the clicked glyph.
    expect(adjacentPairsForGlyph(lines, { lineIndex: 0, glyphIndex: 2 })).to.deep.equal(
      [
        ["e", "l"],
        ["l", "l"],
      ]
    );
    expect(adjacentPairsForGlyph(lines, { lineIndex: 1, glyphIndex: 0 })).to.deep.equal(
      []
    );
  });
});

describe("exposure, the trailing !", () => {
  it("marks the token and keeps the name clean", () => {
    expect(parseToken("h!")).to.deep.equal({ kind: "glyph", name: "h", expose: true });
    expect(parseToken("h")).to.deep.equal({ kind: "glyph", name: "h", expose: false });
    expect(parseToken("@H!")).to.deep.equal({ kind: "class", name: "H", expose: true });
  });

  it("resolves an exposed glyph into the filter's exposed set", () => {
    const filter = resolveGlyphFilter("h!", resolver);
    expect(filter.error).to.equal(null);
    expect([...filter.exposed]).to.deep.equal(["h"]);
    expect([...filter.left]).to.deep.equal(["h"]);
  });

  it("exposes every member of an exposed class", () => {
    const filter = resolveGlyphFilter("@H!", resolver);
    expect([...filter.exposed]).to.deep.equal(["h"]);
  });

  it("leaves the exposed set empty without the mark", () => {
    expect([...resolveGlyphFilter("h", resolver).exposed]).to.deep.equal([]);
  });

  it("a glyph typed twice, once exposed, stays ONE token", () => {
    // Two tokens would mean "pairs between them", which is a different
    // filter -- an exposure mark must not change what is being filtered.
    const filter = resolveGlyphFilter("h, h!", resolver);
    expect(filter.count).to.equal(1);
    expect([...filter.exposed]).to.deep.equal(["h"]);
    expect(pairMatchesGlyphFilter("h", "o", filter)).to.equal(true);
  });

  it("serializes the mark back, so a click cannot drop it", () => {
    expect(serializeToken(parseToken("h!"))).to.equal("h!");
    expect(serializeToken(parseToken("@H!"))).to.equal("@H!");
    expect(serializeToken(parseToken("h"))).to.equal("h");
  });
});
