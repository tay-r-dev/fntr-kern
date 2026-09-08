import { expect } from "chai";
import {
  appendGlyphToken,
  parseToken,
  parseTokenList,
  replaceGlyphToken,
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
});
