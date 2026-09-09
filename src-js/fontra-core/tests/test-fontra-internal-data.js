import {
  deleteFontraInternalSection,
  ensureFontraInternal,
  getFontraInternal,
  getFontraInternalSection,
  setFontraInternalSection,
} from "@fontra/core/fontra-internal-data.js";
import {
  FONTRA_INTERNAL_KEY,
  FONTRA_INTERNAL_SECTIONS,
  withoutNonInterpolableData,
} from "@fontra/core/fontra-internal-schema.js";
import { expect } from "chai";

describe("fontra-internal-data", () => {
  it("getFontraInternal is null-safe and returns null when absent", () => {
    expect(getFontraInternal(null)).to.equal(null);
    expect(getFontraInternal({})).to.equal(null);
  });

  it("ensureFontraInternal creates the container with a schema version", () => {
    const e = {};
    const internal = ensureFontraInternal(e);
    expect(e.customData[FONTRA_INTERNAL_KEY]).to.equal(internal);
    expect(internal.schemaVersion).to.equal(1);
  });

  it("set/get a section round-trips a deep copy", () => {
    const e = {};
    const value = { area: 400, depth: 15 };
    setFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, value);
    const read = getFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER);
    expect(read).to.deep.equal(value);
    value.area = 999;
    expect(
      getFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER).area
    ).to.equal(400);
  });

  it("setting a section to undefined, and delete, remove it", () => {
    const e = {};
    setFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, { area: 1 });
    setFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, undefined);
    expect(getFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER)).to.equal(
      undefined
    );
    setFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, { area: 2 });
    deleteFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER);
    expect(getFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.LETTERSPACER)).to.equal(
      undefined
    );
  });

  it("round-trips the skeleton section name", () => {
    expect(FONTRA_INTERNAL_SECTIONS.SKELETON).to.equal("skeleton");
    const e = {};
    const skeleton = {
      version: 1,
      nextId: 1,
      contours: [],
      generated: [],
    };
    setFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.SKELETON, skeleton);
    expect(
      getFontraInternalSection(e, FONTRA_INTERNAL_SECTIONS.SKELETON)
    ).to.deep.equal(skeleton);
  });
});

describe("withoutNonInterpolableData", () => {
  it("drops the whole internal block and leaves everything else alone", () => {
    const customData = {
      [FONTRA_INTERNAL_KEY]: {
        [FONTRA_INTERNAL_SECTIONS.SKELETON]: { contours: [] },
        [FONTRA_INTERNAL_SECTIONS.MARKERS]: { markers: [{ id: "m1" }] },
      },
      somethingElse: 1,
    };
    const stripped = withoutNonInterpolableData(customData);
    expect(stripped[FONTRA_INTERNAL_KEY]).to.equal(undefined);
    expect(stripped.somethingElse).to.equal(1);
  });

  it("does not mutate the customData it was given", () => {
    const customData = { [FONTRA_INTERNAL_KEY]: { schemaVersion: 1 } };
    withoutNonInterpolableData(customData);
    expect(customData[FONTRA_INTERNAL_KEY]).to.deep.equal({ schemaVersion: 1 });
  });

  it("returns the same object when there is nothing to strip", () => {
    const customData = { somethingElse: 1 };
    expect(withoutNonInterpolableData(customData)).to.equal(customData);
    expect(withoutNonInterpolableData(undefined)).to.equal(undefined);
  });

  // Two masters whose skeletons were edited differently carry different sets of
  // entries. Before the strip, the compatibility check stopped on a skeleton point
  // that had handle offsets in one master and none in the other, on a glyph whose
  // 26 outline points matched exactly.
  it("makes two differently-edited skeletons compare as equal", () => {
    const withOffsets = {
      [FONTRA_INTERNAL_KEY]: {
        [FONTRA_INTERNAL_SECTIONS.SKELETON]: {
          points: [{ handleOffsets: { rightIn: { x: 0, y: 0 } }, nudge: -18 }],
        },
      },
    };
    const without = {
      [FONTRA_INTERNAL_KEY]: {
        [FONTRA_INTERNAL_SECTIONS.SKELETON]: { points: [{ handleOffsets: {} }] },
      },
    };
    expect(withoutNonInterpolableData(withOffsets)).to.deep.equal(
      withoutNonInterpolableData(without)
    );
  });
});
