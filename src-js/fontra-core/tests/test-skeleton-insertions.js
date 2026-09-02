import { splitSideAtParameter } from "@fontra/core/skeleton-insertions.js";
import { Bezier } from "bezier-js";
import { expect } from "chai";

const cubicSide = () => [
  { x: 0, y: 0 },
  { x: 30, y: 60, type: "cubic" },
  { x: 70, y: 60, type: "cubic" },
  { x: 100, y: 0 },
];

const straightSide = () => [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

// Twenty places along each piece. The split must draw the same curve, so each
// piece at its own parameter must land on the whole curve at the parameter the
// cut maps it to. Compared against the whole curve directly, not against a
// projection onto it: bezier-js searches for a projection on a coarse table and
// its own answer is off by about a tenth of a unit here, which would hide an
// error a hundred times larger than the one this test exists to catch.
function sampleDeparture(original, points, insertedIndex, t) {
  const whole = new Bezier(original.map(({ x, y }) => ({ x, y })));
  const first = new Bezier(
    points.slice(0, insertedIndex + 1).map(({ x, y }) => ({ x, y }))
  );
  const second = new Bezier(points.slice(insertedIndex).map(({ x, y }) => ({ x, y })));
  let worst = 0;
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    for (const [piece, wholeParameter] of [
      [first, t * u],
      [second, t + (1 - t) * u],
    ]) {
      const at = piece.get(u);
      const near = whole.get(wholeParameter);
      worst = Math.max(worst, Math.hypot(at.x - near.x, at.y - near.y));
    }
  }
  return worst;
}

describe("splitSideAtParameter", () => {
  it("cuts a cubic and draws the same curve", () => {
    const side = cubicSide();
    const result = splitSideAtParameter(side, 0, 0.25);
    expect(result.points).to.have.length(7);
    expect(result.insertedIndex).to.equal(3);
    expect(
      sampleDeparture(side, result.points, result.insertedIndex, 0.25)
    ).to.be.lessThan(1e-9);
  });

  it("puts the new on-curve on the curve", () => {
    const side = cubicSide();
    const result = splitSideAtParameter(side, 0, 0.4);
    const at = new Bezier(side.map(({ x, y }) => ({ x, y }))).get(0.4);
    const inserted = result.points[result.insertedIndex];
    expect(inserted.x).to.be.closeTo(at.x, 1e-9);
    expect(inserted.y).to.be.closeTo(at.y, 1e-9);
    expect(inserted.type).to.equal(undefined);
  });

  it("cuts a straight by interpolation and adds no handles", () => {
    const result = splitSideAtParameter(straightSide(), 0, 0.25);
    expect(result.points).to.have.length(3);
    expect(result.insertedIndex).to.equal(1);
    expect(result.points[1]).to.include({ x: 25, y: 0 });
    expect(result.points[1].type).to.equal(undefined);
  });

  it("emits the point at a collapsed parameter rather than dropping it", () => {
    for (const t of [0, 1]) {
      const result = splitSideAtParameter(cubicSide(), 0, t);
      expect(result.points).to.have.length(7);
      expect(result.points[result.insertedIndex].type).to.equal(undefined);
    }
  });

  it("leaves the input array untouched", () => {
    const side = cubicSide();
    const before = JSON.stringify(side);
    splitSideAtParameter(side, 0, 0.5);
    expect(JSON.stringify(side)).to.equal(before);
  });

  it("carries the outer handles' construction axis onto the outer pieces", () => {
    // The smoothing pass estimates a missing axis from the handle's length and
    // rotates it. A rotated handle draws a different curve, which is the one
    // thing the split may not do.
    const side = cubicSide();
    side[1]._axis = { x: 1, y: 0 };
    side[2]._axis = { x: -1, y: 0 };
    const result = splitSideAtParameter(side, 0, 0.4);
    expect(result.points[1]._axis).to.deep.equal({ x: 1, y: 0 });
    expect(result.points[5]._axis).to.deep.equal({ x: -1, y: 0 });
  });

  it("returns null where the anchor names no segment", () => {
    expect(splitSideAtParameter(cubicSide(), 3, 0.5)).to.equal(null);
    expect(splitSideAtParameter([], 0, 0.5)).to.equal(null);
  });

  it("moves the split point continuously as the parameter sweeps", () => {
    const side = cubicSide();
    let previous = null;
    let worst = 0;
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const result = splitSideAtParameter(side, 0, t);
      const at = result.points[result.insertedIndex];
      if (previous) {
        worst = Math.max(worst, Math.hypot(at.x - previous.x, at.y - previous.y));
      }
      previous = at;
    }
    expect(worst).to.be.lessThan(0.5);
  });
});
