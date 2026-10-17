import { applyChange } from "@fontra/core/changes.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import { PointSlideNudge } from "../src/point-slide-editing.js";

// A bowl; point 3 is a smooth point between two curves.
function bowl() {
  const points = [
    { x: 0, y: 0, smooth: true },
    { x: 0, y: 110, type: "cubic" },
    { x: 90, y: 200, type: "cubic" },
    { x: 200, y: 200, smooth: true },
    { x: 310, y: 200, type: "cubic" },
    { x: 400, y: 110, type: "cubic" },
    { x: 400, y: 0, smooth: true },
  ];
  return {
    path: VarPackedPath.fromUnpackedContours([{ points, isClosed: false }]),
    components: [],
    anchors: [],
    guidelines: [],
  };
}

const selection = new Set(["point/3"]);

function press(nudge, glyph, delta) {
  const layers = [["default", glyph]];
  const [entry] = nudge
    .targetEntries(layers, "default", selection, delta)
    .get("default");
  applyChange(glyph, entry.makeChangeForDelta(delta));
  nudge.remember(layers);
}

function coordinates(glyph) {
  return glyph.path.getUnpackedContour(0).points.map(({ x, y }) => [x, y]);
}

describe("point slide nudge", () => {
  it("comes back to the drawing it started from", () => {
    const glyph = bowl();
    const start = coordinates(glyph);
    const nudge = new PointSlideNudge();
    for (let i = 0; i < 3; i++) press(nudge, glyph, { x: 1, y: 0 });
    expect(coordinates(glyph)).to.not.deep.equal(start);
    for (let i = 0; i < 3; i++) press(nudge, glyph, { x: -1, y: 0 });
    expect(coordinates(glyph)).to.deep.equal(start);
  });

  it("lands where one press of the whole distance lands", () => {
    const stepped = bowl();
    const nudge = new PointSlideNudge();
    for (let i = 0; i < 3; i++) press(nudge, stepped, { x: 1, y: 0 });
    const once = bowl();
    press(new PointSlideNudge(), once, { x: 3, y: 0 });
    expect(coordinates(stepped)).to.deep.equal(coordinates(once));
  });

  it("starts over after an edit made some other way", () => {
    const glyph = bowl();
    const nudge = new PointSlideNudge();
    press(nudge, glyph, { x: 1, y: 0 });
    // Some other edit moves the far end; the next press starts from it.
    glyph.path.setPointPosition(6, 410, 0);
    press(nudge, glyph, { x: 1, y: 0 });
    expect(glyph.path.getPoint(6)).to.deep.include({ x: 410, y: 0 });
  });
});
