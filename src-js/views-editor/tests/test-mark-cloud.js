import { expect } from "chai";

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.window ??= { addEventListener: () => {}, removeEventListener: () => {} };
const { computeMarkCloud } = await import("../src/composition-editing.js");

const glyphs = {
  A: { anchors: [{ name: "top", x: 250, y: 700 }] },
  tildecomb: { anchors: [{ name: "_top", x: 0, y: 500 }] },
  B: { anchors: [] },
};
const sceneController = {
  sceneSettings: { fontLocationSourceMapped: {} },
  fontController: {
    getGlyphInstance: async (name) =>
      glyphs[name] ? { ...glyphs[name], flattenedPath2d: null } : null,
  },
};

describe("mark cloud", () => {
  it("places a glyph whose underscore anchor matches the base's anchor", async () => {
    const placed = await computeMarkCloud(sceneController, "A", ["tildecomb", "B"]);
    expect(placed.map((mark) => mark.glyphName)).to.deep.equal(["tildecomb"]);
  });
});
