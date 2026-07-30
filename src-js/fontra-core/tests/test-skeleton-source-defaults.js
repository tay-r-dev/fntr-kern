import { FONTRA_INTERNAL_KEY } from "@fontra/core/fontra-internal-schema.js";
import {
  SKELETON_SOURCE_DEFAULT_FALLBACKS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  getDefaultSkeletonWidthKeyForGlyphName,
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
  it("returns fallback for an unknown / empty source", () => {
    const source = makeSource();
    expect(
      getSourceSkeletonDefaultsValue(
        source,
        SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE,
        123
      )
    ).to.equal(123);
  });

  it("returns the stored value for a known width key", () => {
    const source = makeSource({
      widthDefaults: { uppercase: { base: 77 } },
    });
    expect(
      getSourceSkeletonDefaultsValue(
        source,
        SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE,
        60
      )
    ).to.equal(77);
  });

  it("creates fontra.internal with schemaVersion and skeletonDefaults on set", () => {
    const source = makeSource();
    const changed = setSourceSkeletonDefaultsValues(source, {
      [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE]: 90,
    });
    expect(changed).to.equal(true);
    const internal = source.customData[FONTRA_INTERNAL_KEY];
    expect(internal.schemaVersion).to.equal(1);
    expect(internal.skeletonDefaults.widthDefaults.uppercase.base).to.equal(90);
  });

  it("returns false and does not mutate when only unknown keys are set", () => {
    const source = makeSource();
    const changed = setSourceSkeletonDefaultsValues(source, {
      notAKnownKey: 5,
    });
    expect(changed).to.equal(false);
    expect(source.customData).to.equal(undefined);
  });

  it("normalization preserves custom profile arrays", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      widthProfiles: { uppercase: [{ name: "a", value: 50 }] },
    });
    expect(normalized.widthProfiles.uppercase).to.deep.equal([
      { name: "a", value: 50 },
    ]);
  });

  it("normalization creates widthDefaults/capDefaults/profile containers", () => {
    const normalized = normalizeSkeletonSourceDefaults(undefined);
    expect(normalized.widthDefaults.uppercase).to.deep.equal({});
    expect(normalized.widthDefaults.lowercase).to.deep.equal({});
    expect(normalized.capDefaults.square).to.deep.equal({});
    expect(normalized.capDefaults.round).to.deep.equal({});
    expect(normalized.widthProfiles.uppercase).to.deep.equal([]);
    expect(normalized.widthProfiles.lowercase).to.deep.equal([]);
    expect(normalized.capProfiles.square).to.deep.equal([]);
    expect(normalized.capProfiles.round).to.deep.equal([]);
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

  it("returns the lowercase base width key for a lowercase glyph", () => {
    expect(getDefaultSkeletonWidthKeyForGlyphName("a")).to.equal(
      SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_LOWERCASE_BASE
    );
  });

  it("returns the uppercase base width key for an uppercase glyph", () => {
    expect(getDefaultSkeletonWidthKeyForGlyphName("A")).to.equal(
      SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_CAPITAL_BASE
    );
  });

  it("exposes a fallback for every default key", () => {
    for (const key of Object.values(SKELETON_SOURCE_DEFAULT_KEYS)) {
      expect(SKELETON_SOURCE_DEFAULT_FALLBACKS).to.have.property(key);
    }
  });
});

describe("skeleton source defaults for serifs", () => {
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
