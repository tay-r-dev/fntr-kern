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
function movedCopy(points, movedIndices, delta) {
  const moved = new Set([movedIndices].flat());
  return points.map((point, index) =>
    moved.has(index)
      ? { ...point, x: point.x + delta.x, y: point.y + delta.y }
      : { ...point }
  );
}

describe("power axis scale", () => {
  it("carries the extremes between the clicked point and the anchor", () => {
    const before = circleContour();
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
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
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
    expect(after[3].y).to.equal(100);
    expect(after[9].y).to.equal(0);
  });

  it("walks the contour, not the axis order", () => {
    // The top extreme sorts between the two side extremes on x, so an axis
    // order would pair the right extreme with a partner across the counter.
    const before = circleContour();
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
    // Every control point is left to the tension correction.
    expect(after[1].x).to.equal(100);
  });

  it("writes nothing when the drag states no axis amount", () => {
    const before = circleContour();
    const delta = { x: 0, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
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
    applyPowerAxisScale(before, after, false, new Set([1]), delta);
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
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
    expect(after[3].x).to.equal(60);
  });

  it("carries an extreme that carries no smooth flag", () => {
    const before = circleContour().map((point) => {
      const { smooth, ...rest } = point;
      return rest;
    });
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
    expect(after[3].x).to.equal(60);
  });

  it("stops at a corner, which is not square across the axis", () => {
    const before = circleContour();
    // The top point's outgoing handle is steep, so the run ends there.
    before[2].y = 80;
    before[4].y = 80;
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, 0, delta);
    applyPowerAxisScale(before, after, true, new Set([0]), delta);
    expect(after[3].x).to.equal(50);
  });
});

// The leg of "n" from _external/skeletron.fontra, the outline layer. Points 8
// to 11 are the leg; 5 is the extreme of the left arch and 14 the extreme of
// the right one, and both are square across x.
function legOfN() {
  return [
    { x: 58, y: 0 },
    { x: 118, y: 0 },
    { x: 117, y: 349, smooth: true },
    { x: 117, y: 429, type: "cubic" },
    { x: 162, y: 476, type: "cubic" },
    { x: 214, y: 476, smooth: true },
    { x: 269, y: 476, type: "cubic" },
    { x: 294, y: 420, type: "cubic" },
    { x: 294, y: 349, smooth: true },
    { x: 294, y: -5 },
    { x: 358, y: -5 },
    { x: 358, y: 370, smooth: true },
    { x: 358, y: 471, type: "cubic" },
    { x: 300, y: 530, type: "cubic" },
    { x: 225, y: 530, smooth: true },
    { x: 165, y: 530, type: "cubic" },
    { x: 134, y: 496, type: "cubic" },
    { x: 114, y: 461 },
    { x: 113, y: 461 },
    { x: 117, y: 520 },
    { x: 58, y: 520 },
  ];
}

describe("power axis scale, a selection of several points", () => {
  it("carries a run at each end of the moved body", () => {
    const before = legOfN();
    const leg = [8, 9, 10, 11];
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, leg, delta);
    applyPowerAxisScale(before, after, true, new Set(leg), delta);
    // Both arch extremes take their share: 5 behind the leg, 14 in front of it.
    expect(after[5].x).to.be.above(before[5].x);
    expect(after[14].x).to.be.above(before[14].x);
    // The stem and the corner the arch lands on hold.
    expect(after[2].x).to.equal(before[2].x);
    expect(after[17].x).to.equal(before[17].x);
  });

  it("does not stop at a neighbour that shares the pivot's coordinate", () => {
    // Point 9 sits at the leg's own x. It is part of the moved body, so the
    // walk steps over it instead of reading it as the end of the run.
    const before = legOfN();
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, [8, 9, 10, 11], delta);
    applyPowerAxisScale(before, after, true, new Set([8, 9, 10, 11]), delta);
    expect(after[9].x).to.equal(314);
  });

  it("writes nothing when the whole contour moves", () => {
    const before = legOfN();
    const all = before.map((point, index) => index);
    const delta = { x: 20, y: 0 };
    const after = movedCopy(before, all, delta);
    applyPowerAxisScale(before, after, true, new Set(all), delta);
    expect(after[5].x).to.equal(before[5].x + 20);
  });
});

// The centerline of "n" from _external/skeletron.fontra, an open contour whose
// on-curve points are 0, 3, 6, 9 and 12.
function centerlineOfN() {
  return [
    { x: 461, y: 224 },
    { x: 461, y: 311, type: "cubic" },
    { x: 433, y: 364, type: "cubic" },
    { x: 387, y: 364, smooth: true },
    { x: 457, y: 364, type: "cubic" },
    { x: 321, y: 263, type: "cubic" },
    { x: 266, y: 263, smooth: true },
    { x: 213, y: 263, type: "cubic" },
    { x: 208, y: 364, type: "cubic" },
    { x: 145, y: 364, smooth: true },
    { x: 102, y: 364, type: "cubic" },
    { x: 68, y: 308, type: "cubic" },
    { x: 68, y: 233 },
  ];
}

describe("power axis scale, the handles", () => {
  it("carries each handle with its own point", () => {
    const before = centerlineOfN();
    const delta = { x: 40, y: 0 };
    const after = movedCopy(before, [0], delta);
    applyPowerAxisScale(before, after, false, new Set([0]), delta);
    // A handle left behind reaches back once its point has passed it, and the
    // segment turns through half a circle.
    for (const [handle, point] of [
      [2, 3],
      [4, 3],
      [5, 6],
      [7, 6],
      [8, 9],
      [10, 9],
    ]) {
      expect(after[handle].x - after[point].x).to.equal(
        before[handle].x - before[point].x
      );
    }
  });

  it("leaves the anchor's own handle alone", () => {
    const before = centerlineOfN();
    const delta = { x: 40, y: 0 };
    const after = movedCopy(before, [0], delta);
    applyPowerAxisScale(before, after, false, new Set([0]), delta);
    expect(after[12].x).to.equal(before[12].x);
    expect(after[11].x).to.equal(before[11].x);
  });
});
