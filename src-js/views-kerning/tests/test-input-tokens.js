import { expect } from "chai";
import {
  appendGlyphToken,
  crossProductPairs,
  pairsFromInputs,
  parseToken,
  parseTokenList,
  replaceGlyphToken,
  resolveTokenToGlyphNames,
} from "../src/input-tokens.js";

describe("input-tokens", () => {
  describe("parseToken", () => {
    it("recognizes /glyphname, @ClassName, %glyphname%! and a literal character", () => {
      expect(parseToken("/A")).to.deep.equal({ kind: "glyph", name: "A" });
      expect(parseToken("@A")).to.deep.equal({ kind: "class", name: "A" });
      expect(parseToken("%Adieresis%!")).to.deep.equal({
        kind: "member",
        name: "Adieresis",
      });
      expect(parseToken("Ä")).to.deep.equal({ kind: "literal", name: "Ä" });
    });

    it("rejects an unrecognized token", () => {
      expect(() => parseToken("%%!")).to.throw();
      expect(() => parseToken("AB")).to.throw();
      expect(() => parseToken("@")).to.throw();
    });
  });

  describe("parseTokenList", () => {
    it("splits a comma-separated list of single tokens, identically for either input", () => {
      expect(parseTokenList("A, /V, @Adieresis")).to.deep.equal([
        { kind: "literal", name: "A" },
        { kind: "glyph", name: "V" },
        { kind: "class", name: "Adieresis" },
      ]);
    });

    it("an empty/blank string parses to no tokens, not an error", () => {
      expect(parseTokenList("")).to.deep.equal([]);
      expect(parseTokenList("   ")).to.deep.equal([]);
    });
  });

  describe("appendGlyphToken / replaceGlyphToken", () => {
    it("appends using comma separation and /name notation", () => {
      expect(appendGlyphToken("/A", "V")).to.equal("/A, /V");
    });

    it("ignores a duplicate addition", () => {
      expect(appendGlyphToken("/A, /V", "V")).to.equal("/A, /V");
    });

    it("replaceGlyphToken serializes a bare glyph name", () => {
      expect(replaceGlyphToken("V")).to.equal("/V");
    });
  });

  describe("resolveTokenToGlyphNames", () => {
    const resolver = {
      characterMap: { [0x0041]: "A", [0x00c4]: "Adieresis" },
      glyphMap: { A: [0x41], V: [0x56], Adieresis: [0xc4] },
      classMembers: (className, side) =>
        ({
          left: { UC: ["A", "Adieresis"] },
          right: { UC_R: ["V"] },
        }[side]?.[className]),
    };

    it("resolves a literal character through the character map", () => {
      expect(resolveTokenToGlyphNames({ kind: "literal", name: "A" }, resolver)).to.deep.equal([
        "A",
      ]);
    });

    it("resolves /glyphname and %glyphname%! through the glyph map", () => {
      expect(resolveTokenToGlyphNames({ kind: "glyph", name: "V" }, resolver)).to.deep.equal([
        "V",
      ]);
      expect(
        resolveTokenToGlyphNames({ kind: "member", name: "Adieresis" }, resolver)
      ).to.deep.equal(["Adieresis"]);
    });

    it("resolves @ClassName on the given side to its member list", () => {
      expect(
        resolveTokenToGlyphNames({ kind: "class", name: "UC" }, resolver, "left")
      ).to.deep.equal(["A", "Adieresis"]);
      expect(
        resolveTokenToGlyphNames({ kind: "class", name: "UC_R" }, resolver, "right")
      ).to.deep.equal(["V"]);
    });

    it("throws for an unknown name instead of silently matching nothing", () => {
      expect(() =>
        resolveTokenToGlyphNames({ kind: "glyph", name: "NotAGlyph" }, resolver)
      ).to.throw();
      expect(() =>
        resolveTokenToGlyphNames({ kind: "class", name: "NotAClass" }, resolver, "left")
      ).to.throw();
      expect(() =>
        resolveTokenToGlyphNames({ kind: "literal", name: "Z" }, resolver)
      ).to.throw();
    });
  });

  describe("crossProductPairs", () => {
    it("pairs every left name with every right name", () => {
      const { pairs, truncated } = crossProductPairs(["A", "B"], ["V", "W"]);
      expect(pairs).to.deep.equal([
        ["A", "V"],
        ["A", "W"],
        ["B", "V"],
        ["B", "W"],
      ]);
      expect(truncated).to.equal(false);
    });

    it("caps at maxPairs and reports truncation instead of silently dropping", () => {
      const { pairs, truncated } = crossProductPairs(["A", "B", "C"], ["V", "W"], 3);
      expect(pairs).to.have.lengthOf(3);
      expect(truncated).to.equal(true);
    });
  });

  describe("pairsFromInputs -- ledger §8.1 many-to-many cross product", () => {
    const resolver = {
      characterMap: { [0x0041]: "A", [0x0056]: "V", [0x0057]: "W" },
      glyphMap: { A: [0x41], V: [0x56], W: [0x57], Adieresis: [0xc4] },
      classMembers: (className, side) =>
        side === "right" && className === "V_CLASS" ? ["V", "W"] : undefined,
    };

    it("literal pair: Glyph=A, Pair=V", () => {
      const result = pairsFromInputs("A", "V", resolver);
      expect(result).to.deep.equal({
        pairs: [["A", "V"]],
        truncated: false,
        explicit: true,
        error: null,
      });
    });

    it("named glyph pair via /glyphname on both sides", () => {
      const result = pairsFromInputs("/A", "/V", resolver);
      expect(result.pairs).to.deep.equal([["A", "V"]]);
      expect(result.explicit).to.equal(true);
    });

    it("class token on the Pair side expands to its members", () => {
      const result = pairsFromInputs("A", "@V_CLASS", resolver);
      expect(result.pairs).to.deep.equal([
        ["A", "V"],
        ["A", "W"],
      ]);
    });

    it("exposed member token resolves like a named glyph", () => {
      const result = pairsFromInputs("%Adieresis%!", "V", resolver);
      expect(result.pairs).to.deep.equal([["Adieresis", "V"]]);
    });

    it("comma-separated choices on both sides cross-produce all four pairs", () => {
      const result = pairsFromInputs("A, /Adieresis", "V, /W", resolver);
      expect(result.pairs).to.deep.equal([
        ["A", "V"],
        ["A", "W"],
        ["Adieresis", "V"],
        ["Adieresis", "W"],
      ]);
    });

    it("an invalid name is reported as an error, not a silent empty match", () => {
      const result = pairsFromInputs("/NotAGlyph", "V", resolver);
      expect(result.pairs).to.deep.equal([]);
      expect(result.explicit).to.equal(false);
      expect(result.error).to.be.a("string");
    });

    it("empty Pair input produces no pairs and no restriction, not an all-table preview", () => {
      const result = pairsFromInputs("A", "", resolver);
      expect(result).to.deep.equal({
        pairs: [],
        truncated: false,
        explicit: false,
        error: null,
      });
    });

    it("empty Glyph input alone also produces no pairs", () => {
      const result = pairsFromInputs("", "V", resolver);
      expect(result.pairs).to.deep.equal([]);
      expect(result.explicit).to.equal(false);
    });

    it("both empty produces no pairs, no error", () => {
      expect(pairsFromInputs("", "", resolver)).to.deep.equal({
        pairs: [],
        truncated: false,
        explicit: false,
        error: null,
      });
    });
  });
});
