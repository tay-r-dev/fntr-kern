import { expect } from "chai";
import { applyPowerAxisScale } from "../src/tension-aware-editing.js";

// A circle of radius 50 around (50, 50), four extremes, in contour order
// starting at the right one.
const K = 27.6;
function circleContour() {
  return [
    { x: 100, y: 50, smooth: true },
    { x: 100, y: 50 + K, type: "cubic" },
    { x: 50 + K, y: 100, type: "cubic" },
    { x: 50, y: 100, smooth: true },
    { x: 50 - K, y: 100, type: "cubic" },
    { x: 0, y: 50 + K, type: "cubic" },
    { x: 0, y: 50, smooth: true },
    { x: 0, y: 50 - K, type: "cubic" },
    { x: 50 - K, y: 0, type: "cubic" },
    { x: 50, y: 0, smooth: true },
    { x: 50 + K, y: 0, type: "cubic" },
    { x: 100, y: 50 - K, type: "cubic" },
  ];
}

// What the ordinary rules leave behind: the clicked point has travelled, the
// rest stands still.
function movedCopy(points, clickedIndex, delta) {
  return points.map((point, index) =>
    index === clickedIndex
      ? { ...point, x: point.x + delta.x, y: point.y + delta.y }
      : { ...point }
  );
}

describe("power axis scale", () => {
  it("carries the extremes between the clicked point and the anchor", () => {
    const before = circleContour();
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    // Anchor at x = 0 holds, pivot goes to 120, so the middle extremes take
    // their share of the wider span.
    expect(after[3].x).to.equal(60);
    expect(after[9].x).to.equal(60);
    expect(after[6].x).to.equal(0);
    expect(after[0].x).to.equal(120);
  });

  it("leaves the cross axis alone", () => {
    const before = circleContour();
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    expect(after[3].y).to.equal(100);
    expect(after[9].y).to.equal(0);
  });

  it("walks the contour, not the axis order", () => {
    // The top extreme sorts between the two side extremes on x, so an axis
    // order would pair the right extreme with a partner across the counter.
    const before = circleContour();
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    // Every control point is left to the tension correction.
    expect(after[1].x).to.equal(100);
  });

  it("writes nothing when the drag states no axis amount", () => {
    const before = circleContour();
    const delta = { x: 0, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    expect(after.map((point) => point.x)).to.deep.equal(before.map((point) => point.x));
  });

  it("writes nothing when the run reaches no anchor", () => {
    // Two on-curve points and nothing to stop the walk.
    const before = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const delta = { x: 10, y: 0 };
    const after = movedCopy(before, 1, delta);
    applyPowerAxisScale(before, after, false, 1, delta);
    expect(after[0].x).to.equal(0);
  });
});

describe("power axis scale, drawn glyphs", () => {
  it("still reads a hand-placed extreme as one", () => {
    const before = circleContour();
    // The top extreme's handles miss the horizontal by half a unit.
    before[2].y = 99.5;
    before[4].y = 100.5;
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    expect(after[3].x).to.equal(60);
  });

  it("carries an extreme that carries no smooth flag", () => {
    const before = circleContour().map((point) => {
      const { smooth, ...rest } = point;
      return rest;
    });
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    expect(after[3].x).to.equal(60);
  });

  it("stops at a corner, which is not square across the axis", () => {
    const before = circleContour();
    // The top point's outgoing handle is steep, so the run ends there.
    before[2].y = 80;
    before[4].y = 80;
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, 0, delta);
    expect(after[3].x).to.equal(50);
  });
});
