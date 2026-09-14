import { FONTRA_INTERNAL_KEY } from "@fontra/core/fontra-internal-schema.js";
import {
  DEFAULT_SERIF_PRESET,
  DEFAULT_SKELETON_WIDTH,
  SERIF_PRESETS,
  SKELETON_SOURCE_DEFAULT_FALLBACKS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  applySkeletonWidthPreset,
  applyTerminalPreset,
  getSkeletonBaseWidthForCase,
  getSkeletonGlyphCase,
  getSourceSkeletonDefaultsValue,
  getTerminalPresetFields,
  getTerminalPresetSourceKey,
  normalizeSkeletonSourceDefaults,
  normalizeTerminalPreset,
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

  // A preset's side is the contour's projection, not a rib side, so the width
  // it carries is always the total, whatever projection it was stored with.
  it("applies a left-projection preset to the point's total width", () => {
    const point = { width: { left: 10, right: 40 } };
    applySkeletonWidthPreset(point, DEFAULT_SKELETON_WIDTH, {
      name: "Stem",
      width: 70,
      side: "left",
      case: "uppercase",
    });
    expect(point.width.left + point.width.right).to.equal(70);
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

describe("terminal presets", () => {
  it("routes each of the other three types to its own source-defaults key", () => {
    expect(getTerminalPresetSourceKey("square")).to.equal(
      SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_SQUARE
    );
    expect(getTerminalPresetSourceKey("round")).to.equal(
      SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_ROUNDED
    );
    expect(getTerminalPresetSourceKey("drop")).to.equal(
      SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_DROP
    );
    expect(getTerminalPresetSourceKey("serif")).to.equal(
      SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS
    );
    expect(getTerminalPresetSourceKey("flat")).to.equal(null);
  });

  // The panel captures a preset from the selection, so it needs the one list
  // of fields a type stores rather than a second copy of it.
  it("names the shape fields each of the other three types stores", () => {
    expect(getTerminalPresetFields("square")).to.deep.equal([
      "capAngle",
      "capDistance",
    ]);
    expect(getTerminalPresetFields("round")).to.deep.equal([
      "capRadiusRatio",
      "capTension",
    ]);
    expect(getTerminalPresetFields("drop")).to.deep.equal([
      "capBallRatio",
      "capBallShape",
      "capBallEasing",
      "capBallEaseCurvature",
    ]);
    expect(getTerminalPresetFields("flat")).to.equal(null);
  });

  it("reads an existing serif preset as type serif, unchanged", () => {
    const normalized = normalizeTerminalPreset("serif", DEFAULT_SERIF_PRESET);
    expect(normalized.type).to.equal("serif");
    for (const field of Object.keys(DEFAULT_SERIF_PRESET)) {
      if (field === "name") continue;
      expect(normalized[field]).to.equal(DEFAULT_SERIF_PRESET[field]);
    }
  });

  it("stores and applies a square preset", () => {
    const point = { capStyle: "round" };
    applyTerminalPreset(
      point,
      "square",
      normalizeTerminalPreset("square", { name: "Cut", capAngle: 12, capDistance: 8 })
    );
    expect(point.capStyle).to.equal("square");
    expect(point.capAngle).to.equal(12);
    expect(point.capDistance).to.equal(8);
  });

  it("stores and applies a round preset", () => {
    const point = { capStyle: "flat" };
    applyTerminalPreset(
      point,
      "round",
      normalizeTerminalPreset("round", {
        name: "Soft",
        capRadiusRatio: 0.3,
        capTension: 0.6,
      })
    );
    expect(point.capStyle).to.equal("round");
    expect(point.capRadiusRatio).to.equal(0.3);
    expect(point.capTension).to.equal(0.6);
  });

  it("stores and applies a drop preset", () => {
    const point = { capStyle: "square" };
    applyTerminalPreset(
      point,
      "drop",
      normalizeTerminalPreset("drop", {
        name: "Ball",
        capBallRatio: 1.5,
        capBallShape: 0.4,
        capBallEasing: 0.2,
        capBallEaseCurvature: 0.7,
      })
    );
    expect(point.capStyle).to.equal("drop");
    expect(point.capBallRatio).to.equal(1.5);
    expect(point.capBallShape).to.equal(0.4);
    expect(point.capBallEasing).to.equal(0.2);
    expect(point.capBallEaseCurvature).to.equal(0.7);
  });

  it("changes a point's kind to the preset's type when it was something else", () => {
    const point = { capStyle: "round", capRadiusRatio: 0.5, capTension: 0.5 };
    applyTerminalPreset(
      point,
      "serif",
      normalizeTerminalPreset("serif", SERIF_PRESETS[0])
    );
    expect(point.capStyle).to.equal("serif");
  });

  it("never writes a rib angle lock or lock mode from a square preset", () => {
    const point = {
      capStyle: "flat",
      ribAngleLock: "vertical",
      ribAngleLockMode: "rib",
    };
    applyTerminalPreset(
      point,
      "square",
      normalizeTerminalPreset("square", { name: "Cut", capAngle: 5, capDistance: 5 })
    );
    expect(point.ribAngleLock).to.equal("vertical");
    expect(point.ribAngleLockMode).to.equal("rib");
  });

  it("round-trips a drop preset list through source defaults", () => {
    const source = {};
    const presets = [
      normalizeTerminalPreset("drop", {
        name: "Ball",
        capBallRatio: 1.4,
        case: "lowercase",
      }),
    ];
    setSourceSkeletonDefaultsValues(source, {
      [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_DROP]: presets,
    });
    expect(
      getSourceSkeletonDefaultsValue(
        source,
        SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_CAP_DROP,
        []
      )
    ).to.deep.equal(presets);
  });
});
