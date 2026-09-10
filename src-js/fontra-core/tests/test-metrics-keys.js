import { expect } from "chai";
import { FONTRA_INTERNAL_KEY } from "@fontra/core/fontra-internal-schema.js";
import {
  deleteSidebearingKey,
  formatMetricsKeyDisplay,
  getEffectiveMetricsKey,
  getSidebearingKey,
  hasAnySidebearingKey,
  isMetricsValueStale,
  isSelfReferenceSameSide,
  parseMetricsKey,
  setSidebearingKey,
  SIDE_METRIC_PROPERTY,
} from "@fontra/core/metrics-keys.js";

describe("metrics-keys", () => {
  describe("parseMetricsKey", () => {
    it("recognizes a simple key", () => {
      expect(parseMetricsKey("=n")).to.deep.equal({ isKey: true, expression: "n" });
    });

    it("trims whitespace around the prefix and the expression", () => {
      expect(parseMetricsKey("  =  n  ")).to.deep.equal({
        isKey: true,
        expression: "n",
      });
    });

    it("keeps the opposite-side marker", () => {
      expect(parseMetricsKey("=o!")).to.deep.equal({ isKey: true, expression: "o!" });
    });

    it("keeps a full expression verbatim", () => {
      expect(parseMetricsKey("=(a+b)/2")).to.deep.equal({
        isKey: true,
        expression: "(a+b)/2",
      });
    });

    it("treats a bare glyph name as not a key", () => {
      expect(parseMetricsKey("n")).to.deep.equal({ isKey: false });
    });

    it("treats a plain number as not a key", () => {
      expect(parseMetricsKey("80")).to.deep.equal({ isKey: false });
    });

    it("treats a non-string as not a key", () => {
      expect(parseMetricsKey(80)).to.deep.equal({ isKey: false });
      expect(parseMetricsKey(undefined)).to.deep.equal({ isKey: false });
    });

    it("reports an error for a bare prefix", () => {
      const result = parseMetricsKey("=");
      expect(result.isKey).to.equal(false);
      expect(result.error).to.be.a("string");
    });

    it("reports an error for a prefix with only whitespace", () => {
      expect(parseMetricsKey("=   ").error).to.be.a("string");
    });
  });

  describe("formatMetricsKeyDisplay", () => {
    it("puts the prefix back", () => {
      expect(formatMetricsKeyDisplay("n")).to.equal("=n");
    });
  });

  describe("key storage", () => {
    it("round-trips a key", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      expect(getSidebearingKey(entity, "left")).to.equal("n");
      expect(getSidebearingKey(entity, "right")).to.equal(undefined);
    });

    it("stores under the sidebearingKeys section", () => {
      const entity = {};
      setSidebearingKey(entity, "right", "o!");
      expect(
        entity.customData[FONTRA_INTERNAL_KEY].sidebearingKeys.right.expression
      ).to.equal("o!");
    });

    it("replaces an existing key on the same side", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      setSidebearingKey(entity, "left", "m");
      expect(getSidebearingKey(entity, "left")).to.equal("m");
    });

    it("keeps the other side when one side is deleted", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      setSidebearingKey(entity, "right", "o");
      expect(deleteSidebearingKey(entity, "left")).to.equal(true);
      expect(getSidebearingKey(entity, "left")).to.equal(undefined);
      expect(getSidebearingKey(entity, "right")).to.equal("o");
    });

    it("returns false when deleting a key that isn't there", () => {
      expect(deleteSidebearingKey({}, "left")).to.equal(false);
    });

    it("removes fontra.internal entirely when the last key goes", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      deleteSidebearingKey(entity, "left");
      expect(entity.customData[FONTRA_INTERNAL_KEY]).to.equal(undefined);
    });

    it("leaves fontra.internal alone when another section is present", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      entity.customData[FONTRA_INTERNAL_KEY].skeleton = { contours: [] };
      deleteSidebearingKey(entity, "left");
      expect(entity.customData[FONTRA_INTERNAL_KEY].skeleton).to.deep.equal({
        contours: [],
      });
      expect(entity.customData[FONTRA_INTERNAL_KEY].sidebearingKeys).to.equal(
        undefined
      );
    });

    it("reports whether any key exists", () => {
      const entity = {};
      expect(hasAnySidebearingKey(entity)).to.equal(false);
      setSidebearingKey(entity, "left", "n");
      expect(hasAnySidebearingKey(entity)).to.equal(true);
    });

    it("tolerates an entity with no customData", () => {
      expect(getSidebearingKey({}, "left")).to.equal(undefined);
      expect(getSidebearingKey(undefined, "left")).to.equal(undefined);
      expect(hasAnySidebearingKey(undefined)).to.equal(false);
    });
  });

  describe("getEffectiveMetricsKey", () => {
    it("returns null when neither level has a key", () => {
      expect(getEffectiveMetricsKey({}, {}, "left")).to.equal(null);
    });

    it("falls back to the shared key", () => {
      const varGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      expect(getEffectiveMetricsKey(varGlyph, {}, "left")).to.deep.equal({
        expression: "n",
        level: "shared",
      });
    });

    it("prefers the source override", () => {
      const varGlyph = {};
      const layerGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      setSidebearingKey(layerGlyph, "left", "m");
      expect(getEffectiveMetricsKey(varGlyph, layerGlyph, "left")).to.deep.equal({
        expression: "m",
        level: "source",
      });
    });

    it("applies the cascade per side", () => {
      const varGlyph = {};
      const layerGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      setSidebearingKey(varGlyph, "right", "o");
      setSidebearingKey(layerGlyph, "right", "p");
      expect(getEffectiveMetricsKey(varGlyph, layerGlyph, "left").level).to.equal(
        "shared"
      );
      expect(getEffectiveMetricsKey(varGlyph, layerGlyph, "right").level).to.equal(
        "source"
      );
    });

    it("tolerates a missing layer glyph", () => {
      const varGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      expect(getEffectiveMetricsKey(varGlyph, undefined, "left").level).to.equal(
        "shared"
      );
    });
  });

  describe("isMetricsValueStale", () => {
    it("is false when the values agree", () => {
      expect(isMetricsValueStale(80, 80)).to.equal(false);
    });

    it("is false for sub-epsilon drift", () => {
      expect(isMetricsValueStale(80, 80.2)).to.equal(false);
    });

    it("is true for a one-unit difference", () => {
      expect(isMetricsValueStale(80, 81)).to.equal(true);
    });

    it("is false when either value is not a finite number", () => {
      expect(isMetricsValueStale(undefined, 80)).to.equal(false);
      expect(isMetricsValueStale(80, undefined)).to.equal(false);
      expect(isMetricsValueStale(80, NaN)).to.equal(false);
    });
  });

  describe("isSelfReferenceSameSide", () => {
    it("is true when a glyph keys its own side to itself", () => {
      expect(isSelfReferenceSameSide("o", "o")).to.equal(true);
    });

    it("tolerates surrounding whitespace", () => {
      expect(isSelfReferenceSameSide("  o  ", "o")).to.equal(true);
    });

    it("is false for the opposite side", () => {
      expect(isSelfReferenceSameSide("o!", "o")).to.equal(false);
    });

    it("is false for another glyph", () => {
      expect(isSelfReferenceSameSide("n", "o")).to.equal(false);
    });

    it("is false for an expression that merely mentions the glyph", () => {
      expect(isSelfReferenceSameSide("(o+n)/2", "o")).to.equal(false);
    });
  });

  describe("SIDE_METRIC_PROPERTY", () => {
    it("maps sides to controller properties", () => {
      expect(SIDE_METRIC_PROPERTY.left).to.equal("leftMargin");
      expect(SIDE_METRIC_PROPERTY.right).to.equal("rightMargin");
    });
  });
});
