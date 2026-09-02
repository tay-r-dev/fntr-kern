import {
  applyInsertionEasing,
  applyInsertionRatio,
  splitSideAtParameter,
} from "@fontra/core/skeleton-insertions.js";
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

describe("applyInsertionRatio", () => {
  const points = [
    { x: 0, y: 30 },
    { x: 50, y: 30 },
    { x: 100, y: 30 },
  ];

  it("returns the same array at a ratio of one", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 1);
    expect(result).to.equal(points);
  });

  it("moves the on-curve out along the line from the centerline", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 2);
    expect(result[1]).to.include({ x: 50, y: 60 });
    expect(result[0]).to.deep.equal(points[0]);
    expect(result[2]).to.deep.equal(points[2]);
  });

  it("moves it in at a ratio below one", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 0.5);
    expect(result[1]).to.include({ x: 50, y: 15 });
  });

  it("takes the point onto the centerline at a ratio of zero", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 0);
    expect(result[1]).to.include({ x: 50, y: 0 });
  });

  it("moves continuously as the ratio sweeps", () => {
    let previous = null;
    let worst = 0;
    for (let i = 0; i <= 400; i++) {
      const ratio = i / 200;
      const at = applyInsertionRatio(points, 1, { x: 50, y: 0 }, ratio)[1];
      if (previous) {
        worst = Math.max(worst, Math.hypot(at.x - previous.x, at.y - previous.y));
      }
      previous = at;
    }
    expect(worst).to.be.lessThan(0.5);
  });

  it("leaves the input array untouched", () => {
    const before = JSON.stringify(points);
    applyInsertionRatio(points, 1, { x: 50, y: 0 }, 3);
    expect(JSON.stringify(points)).to.equal(before);
  });
});

// The angle the outline turns through at the emitted point, in degrees. Zero is
// a smooth pass and anything above it is a corner.
function jointAngle(points, at) {
  const incoming = {
    x: points[at].x - points[at - 1].x,
    y: points[at].y - points[at - 1].y,
  };
  const outgoing = {
    x: points[at + 1].x - points[at].x,
    y: points[at + 1].y - points[at].y,
  };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

describe("applyInsertionEasing", () => {
  // A cut cubic whose middle on-curve has been displaced, so the joint is bent.
  const bent = () => [
    { x: 0, y: 0 },
    { x: 20, y: 20, type: "cubic" },
    { x: 40, y: 20, type: "cubic" },
    { x: 50, y: 40 },
    { x: 60, y: 20, type: "cubic" },
    { x: 80, y: 20, type: "cubic" },
    { x: 100, y: 0 },
  ];

  it("returns the same array at zero", () => {
    const points = bent();
    expect(applyInsertionEasing(points, 3, 0)).to.equal(points);
  });

  it("leaves the joint bent at zero and straightens it at one", () => {
    const points = bent();
    expect(jointAngle(applyInsertionEasing(points, 3, 0), 3)).to.be.greaterThan(20);
    expect(jointAngle(applyInsertionEasing(points, 3, 1), 3)).to.be.lessThan(1e-6);
  });

  it("moves no on-curve point at any value", () => {
    const points = bent();
    for (let i = 0; i <= 20; i++) {
      const result = applyInsertionEasing(points, 3, i / 20);
      for (const index of [0, 3, 6]) {
        expect(result[index]).to.deep.equal(points[index]);
      }
    }
  });

  it("closes the joint angle without stepping", () => {
    const points = bent();
    let previous = null;
    let worst = 0;
    for (let i = 0; i <= 400; i++) {
      const angle = jointAngle(applyInsertionEasing(points, 3, i / 400), 3);
      if (previous !== null) {
        worst = Math.max(worst, Math.abs(angle - previous));
      }
      previous = angle;
    }
    expect(worst).to.be.lessThan(1);
  });

  it("leaves the input array untouched", () => {
    const points = bent();
    const before = JSON.stringify(points);
    applyInsertionEasing(points, 3, 0.5);
    expect(JSON.stringify(points)).to.equal(before);
  });
});
