import { expect } from "chai";
import { deltaBoundsForTab } from "../src/results-model.js";
import { firstPairOfLines, layoutPairPreview } from "../src/pair-preview-layout.js";

describe("results tabs", () => {
  it("all ignores the suggestion threshold", () => {
    expect(deltaBoundsForTab("all", 20, 80)).to.deep.equal({
      minDelta: 0,
      maxDelta: null,
    });
  });

  it("potential overrides keeps the suggestion threshold", () => {
    expect(deltaBoundsForTab("potential", 20, 80)).to.deep.equal({
      minDelta: 20,
      maxDelta: 80,
    });
  });

  it("suggestions applies the suggestion threshold", () => {
    expect(deltaBoundsForTab("suggestions", 20, 80)).to.deep.equal({
      minDelta: 20,
      maxDelta: 80,
    });
  });
});

describe("pair preview layout", () => {
  const line = (advance) => ({
    origin: { x: 0, y: 0 },
    endPoint: { x: advance, y: 0 },
    bounds: null,
    glyphs: [{ x: 0, y: 0, bounds: null, glyph: { xAdvance: advance } }],
  });

  it("separates cells by the pair distance", () => {
    const scene = { positionedLines: [line(1200), line(1200)] };
    layoutPairPreview(scene, 6, 1000, 300);
    expect(scene.positionedLines[1].origin.x).to.equal(1500);
  });

  it("keeps half an em when no distance is given", () => {
    const scene = { positionedLines: [line(1200), line(1200)] };
    layoutPairPreview(scene, 6, 1000);
    expect(scene.positionedLines[1].origin.x).to.equal(1700);
  });
});

describe("initial preview pair", () => {
  it("takes the first two named glyphs of the phrase", () => {
    const lines = [
      [],
      [
        { glyphName: undefined },
        { glyphName: "A" },
        { glyphName: "V" },
        { glyphName: "o" },
      ],
    ];
    expect(firstPairOfLines(lines)).to.deep.equal(["A", "V"]);
  });

  it("has no pair when no line holds two glyphs", () => {
    expect(firstPairOfLines([[{ glyphName: "A" }], []])).to.equal(null);
  });
});
