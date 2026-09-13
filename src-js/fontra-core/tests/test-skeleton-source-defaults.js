import { FONTRA_INTERNAL_KEY } from "@fontra/core/fontra-internal-schema.js";
import {
  DEFAULT_SKELETON_WIDTH,
  SKELETON_SOURCE_DEFAULT_FALLBACKS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  applySkeletonWidthPreset,
  getSkeletonBaseWidthForCase,
  getSkeletonGlyphCase,
  getSourceSkeletonDefaultsValue,
  normalizeSkeletonSourceDefaults,
  setSourceSkeletonDefaultsValues,
} from "@fontra/core/skeleton-model.js";
import { expect } from "chai";

function makeSource(defaults) {
  const source = {};
  if (defaults !== undefined) {
    source.customData = {
      [FONTRA_INTERNAL_KEY]: {
        schemaVersion: 1,
        skeletonDefaults: defaults,
      },
    };
  }
  return source;
}

describe("skeleton-source-defaults", () => {
  it("returns an empty preset list for an unknown / empty source", () => {
    const source = makeSource();
    expect(
      getSourceSkeletonDefaultsValue(
        source,
        SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS,
        "fallback"
      )
    ).to.deep.equal([]);
  });

  it("returns the fallback for a truly absent source", () => {
    expect(
      getSourceSkeletonDefaultsValue(null, SKELETON_SOURCE_DEFAULT_KEYS.CAP_ANGLE, 42)
    ).to.equal(42);
  });

  it("returns the stored value for a known key", () => {
    const source = makeSource({
      widthPresets: [{ name: "Base", width: 77, side: "both", case: "uppercase" }],
    });
    expect(
      getSourceSkeletonDefaultsValue(
        source,
        SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS,
        []
      )
    ).to.deep.equal([{ name: "Base", width: 77, side: "both", case: "uppercase" }]);
  });

  it("creates fontra.internal with schemaVersion and skeletonDefaults on set", () => {
    const source = makeSource();
    const presets = [{ name: "Base", width: 90, side: "both", case: "uppercase" }];
    const changed = setSourceSkeletonDefaultsValues(source, {
      [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS]: presets,
    });
    expect(changed).to.equal(true);
    const internal = source.customData[FONTRA_INTERNAL_KEY];
    expect(internal.schemaVersion).to.equal(1);
    expect(internal.skeletonDefaults.widthPresets).to.deep.equal(presets);
  });

  it("returns false and does not mutate when only unknown keys are set", () => {
    const source = makeSource();
    const changed = setSourceSkeletonDefaultsValues(source, {
      notAKnownKey: 5,
    });
    expect(changed).to.equal(false);
    expect(source.customData).to.equal(undefined);
  });

  it("normalization preserves custom cap profile arrays", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      capProfiles: { square: [{ name: "a", angle: 10 }] },
    });
    expect(normalized.capProfiles.square).to.deep.equal([{ name: "a", angle: 10 }]);
  });

  it("normalization creates capDefaults/capProfiles containers and an empty width preset list", () => {
    const normalized = normalizeSkeletonSourceDefaults(undefined);
    expect(normalized.capDefaults.square).to.deep.equal({});
    expect(normalized.capDefaults.round).to.deep.equal({});
    expect(normalized.capProfiles.square).to.deep.equal([]);
    expect(normalized.capProfiles.round).to.deep.equal([]);
    expect(normalized.widthPresets).to.deep.equal([]);
  });

  it("resolves glyph case: lowercase -> lowercase", () => {
    expect(getSkeletonGlyphCase("a")).to.equal("lowercase");
  });

  it("resolves glyph case: uppercase -> uppercase", () => {
    expect(getSkeletonGlyphCase("A")).to.equal("uppercase");
  });

  it("resolves glyph case with suffix via base glyph name", () => {
    expect(getSkeletonGlyphCase("a.alt")).to.equal("lowercase");
  });

  it("falls back to uppercase for an unknown glyph", () => {
    expect(getSkeletonGlyphCase("nonexistentglyph123")).to.equal("uppercase");
  });

  it("exposes a fallback for every default key", () => {
    for (const key of Object.values(SKELETON_SOURCE_DEFAULT_KEYS)) {
      expect(SKELETON_SOURCE_DEFAULT_FALLBACKS).to.have.property(key);
    }
  });
});

describe("skeleton width presets", () => {
  it("turns a legacy base/horizontal/contrast/custom block into four presets", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      widthDefaults: { uppercase: { base: 60, horizontal: 50, contrast: 40 } },
      widthProfiles: { uppercase: [{ name: "Stem", value: 35 }] },
    });
    const uppercasePresets = normalized.widthPresets.filter(
      (preset) => preset.case === "uppercase"
    );
    expect(uppercasePresets).to.have.lengthOf(4);
    expect(
      uppercasePresets.map((preset) => preset.width).sort((a, b) => a - b)
    ).to.deep.equal([35, 40, 50, 60]);
    expect(uppercasePresets.every((preset) => preset.side === "both")).to.equal(true);
  });

  it("drops the legacy distribution default entirely", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      widthDefaults: { uppercase: { base: 60, distribution: 25 } },
    });
    expect(normalized).to.not.have.property("widthDefaults");
    for (const preset of normalized.widthPresets) {
      expect(preset).to.not.have.property("distribution");
    }
    for (const key of Object.keys(SKELETON_SOURCE_DEFAULT_KEYS)) {
      expect(key.toLowerCase()).to.not.include("distribution");
    }
  });

  it("leaves an already-migrated preset list alone, even if empty", () => {
    const normalized = normalizeSkeletonSourceDefaults({ widthPresets: [] });
    expect(normalized.widthPresets).to.deep.equal([]);
  });

  it("applies a both-side preset to the point's total width", () => {
    const point = { width: { left: 10, right: 10 } };
    applySkeletonWidthPreset(point, DEFAULT_SKELETON_WIDTH, {
      name: "Base",
      width: 60,
      side: "both",
      case: "uppercase",
    });
    expect(point.width.left + point.width.right).to.equal(60);
  });

  it("applies a left-side preset without touching the right width", () => {
    const point = { width: { left: 10, right: 40 } };
    applySkeletonWidthPreset(point, DEFAULT_SKELETON_WIDTH, {
      name: "Stem",
      width: 70,
      side: "left",
      case: "uppercase",
    });
    expect(point.width.left).to.equal(70);
    expect(point.width.right).to.equal(40);
  });

  it("resolves the base width for a case from its named preset", () => {
    const source = makeSource({
      widthPresets: [
        { name: "Base", width: 77, side: "both", case: "uppercase" },
        { name: "Base", width: 55, side: "both", case: "lowercase" },
      ],
    });
    expect(getSkeletonBaseWidthForCase(source, "uppercase")).to.equal(77);
    expect(getSkeletonBaseWidthForCase(source, "lowercase")).to.equal(55);
  });

  it("falls back to the module default width when no Base preset is stored", () => {
    const source = makeSource({ widthPresets: [] });
    expect(getSkeletonBaseWidthForCase(source, "uppercase")).to.equal(
      DEFAULT_SKELETON_WIDTH
    );
  });
});

describe("skeleton source defaults for serifs", () => {
  it("reads the serif seed fallbacks from an empty source", () => {
    const source = makeSource();
    for (const [key, expected] of [["CUSTOM_SERIFS", []]]) {
      expect(
        getSourceSkeletonDefaultsValue(
          source,
          SKELETON_SOURCE_DEFAULT_KEYS[key],
          SKELETON_SOURCE_DEFAULT_FALLBACKS[SKELETON_SOURCE_DEFAULT_KEYS[key]]
        )
      ).to.deep.equal(expected);
    }
  });

  it("writes and deep-clones serif presets", () => {
    const source = makeSource();
    const customSerifs = [{ name: "Slab foot", wingLength: 30 }];
    setSourceSkeletonDefaultsValues(source, {
      [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS]: customSerifs,
    });
    customSerifs[0].wingLength = 99;

    expect(
      getSourceSkeletonDefaultsValue(
        source,
        SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS,
        []
      )
    ).to.deep.equal([{ name: "Slab foot", wingLength: 30 }]);
  });

  it("defaults to absolute units with collapsed-point removal off", () => {
    const normalized = normalizeSkeletonSourceDefaults({});
    expect(normalized.serifDefaults.unitsMode).to.equal("absolute");
    expect(normalized.serifDefaults.removeCollapsedPoints).to.equal(false);
  });

  it("keeps a stored units mode", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      serifDefaults: { unitsMode: "normalized" },
    });
    expect(normalized.serifDefaults.unitsMode).to.equal("normalized");
  });

  it("rejects an unknown units mode", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      serifDefaults: { unitsMode: "percent" },
    });
    expect(normalized.serifDefaults.unitsMode).to.equal("absolute");
  });

  it("coerces collapsed-point removal to a boolean", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      serifDefaults: { removeCollapsedPoints: 1 },
    });
    expect(normalized.serifDefaults.removeCollapsedPoints).to.equal(true);
  });
});
