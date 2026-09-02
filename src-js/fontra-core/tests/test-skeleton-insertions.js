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

// The angle the outline turns through at the emitted point, in degrees. Zero is
// a smooth pass and anything above it is a corner.
//
// Measured from the drawn tangents, not from the two neighbouring control
// points. A control point that sits on its own on-curve states no direction,
// and the curve's tangent there comes from the next one along instead.
function tangentAt(points, at, step) {
  for (let i = at + step; i >= 0 && i < points.length; i += step) {
    const away = {
      x: (points[i].x - points[at].x) * step,
      y: (points[i].y - points[at].y) * step,
    };
    if (Math.hypot(away.x, away.y) > 1e-9) {
      return away;
    }
  }
  return { x: 0, y: 0 };
}

function jointAngle(points, at) {
  const incoming = tangentAt(points, at, -1);
  const outgoing = tangentAt(points, at, 1);
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
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

  it("cuts a straight into two cubics that still draw the straight", () => {
    // A straight becomes a curve, because the on-curves at its two ends are
    // often smooth points whose other handle is held colinear with it. Two
    // straights would aim the first one at the insertion point and break that.
    const result = splitSideAtParameter(straightSide(), 0, 0.25);
    expect(result.points).to.have.length(7);
    expect(result.insertedIndex).to.equal(3);
    expect(result.points[3]).to.include({ x: 25, y: 0 });
    expect(result.points[3].type).to.equal(undefined);
    // Every point is still on the line, so the two cubics draw the straight.
    for (const point of result.points) {
      expect(point.y).to.be.closeTo(0, 1e-9);
    }
    // The outer handles keep the line's own direction, which is what holds a
    // smooth end point smooth once the ratio moves the middle off the line.
    expect(result.points[1]._axis.x).to.equal(1);
    expect(result.points[1]._axis.y).to.be.closeTo(0, 1e-12);
    expect(result.points[5]._axis.x).to.equal(-1);
    expect(result.points[5]._axis.y).to.be.closeTo(0, 1e-12);
  });

  it("collapses the insertion point's own handles onto it", () => {
    // They are emitted, because the count must not change with the value of a
    // setting, and they state nothing until easing gives them a length.
    const result = splitSideAtParameter(straightSide(), 0, 0.25);
    const at = result.points[3];
    for (const index of [2, 4]) {
      expect(result.points[index]._insertionStub).to.equal(true);
      expect(result.points[index].x).to.be.closeTo(at.x, 1e-9);
      expect(result.points[index].y).to.be.closeTo(at.y, 1e-9);
    }
  });

  it("gives a straight between corners no handles at all", () => {
    // Nothing here needs holding colinear, so the two pieces stay plain
    // straight lines and the joint is a plain angle.
    const cut = splitSideAtParameter(straightSide(), 0, 0.5);
    const swollen = applyInsertionRatio(
      cut.points,
      cut.insertedIndex,
      { x: 50, y: -30 },
      2
    );
    for (const [handle, anchor] of [
      [1, 0],
      [2, 3],
      [4, 3],
      [5, 6],
    ]) {
      expect(
        Math.hypot(
          swollen[handle].x - swollen[anchor].x,
          swollen[handle].y - swollen[anchor].y
        )
      ).to.be.closeTo(0, 1e-9);
    }
  });

  it("keeps an outer handle where the on-curve it belongs to is smooth", () => {
    const smoothSide = () => [
      { x: 0, y: 0, smooth: true },
      { x: 100, y: 0, smooth: true },
    ];
    const cut = splitSideAtParameter(smoothSide(), 0, 0.5);
    const swollen = applyInsertionRatio(
      cut.points,
      cut.insertedIndex,
      { x: 50, y: -30 },
      2
    );
    // On the line it was built on, so the smooth end keeps its direction.
    expect(swollen[1]).to.include({ y: 0 });
    expect(swollen[1].x).to.be.greaterThan(0);
    expect(swollen[5]).to.include({ y: 0 });
    expect(swollen[5].x).to.be.lessThan(100);
  });

  it("aims the insertion's own handles at their neighbours when it moves", () => {
    const cut = splitSideAtParameter(straightSide(), 0, 0.5);
    const moved = applyInsertionRatio(
      cut.points,
      cut.insertedIndex,
      { x: 50, y: -30 },
      2
    );
    const at = moved[cut.insertedIndex];
    expect(at).to.include({ x: 50, y: 30 });
    // Each stub publishes the direction it faces, which is where easing grows
    // it. A stub left parallel to the line it was built on would stay colinear
    // with its partner, and two colinear handles are a smooth pass, not the
    // angle a corner is.
    for (const [index, neighbour, step] of [
      [cut.insertedIndex - 1, { x: 0, y: 0 }, -1],
      [cut.insertedIndex + 1, { x: 100, y: 0 }, 1],
    ]) {
      const aim = moved[index]._axis;
      const toNeighbour = {
        x: (neighbour.x - at.x) * step,
        y: (neighbour.y - at.y) * step,
      };
      const length = Math.hypot(toNeighbour.x, toNeighbour.y);
      expect(aim.x * step).to.be.closeTo(toNeighbour.x / length, 1e-9);
      expect(aim.y * step).to.be.closeTo(toNeighbour.y / length, 1e-9);
    }
  });

  it("turns a cut straight into an angle, not a smooth bulge", () => {
    const cut = splitSideAtParameter(straightSide(), 0, 0.5);
    const swollen = applyInsertionRatio(
      cut.points,
      cut.insertedIndex,
      { x: 50, y: -30 },
      2
    );
    // At easing zero the two handles either side of the point are not colinear,
    // so the outline turns a corner there.
    expect(jointAngle(swollen, cut.insertedIndex)).to.be.greaterThan(20);
    // At one they are, so it passes through smoothly.
    expect(
      jointAngle(applyInsertionEasing(swollen, cut.insertedIndex, 1), cut.insertedIndex)
    ).to.be.lessThan(1e-6);
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
    expect(result.points[1]._axis.x).to.equal(1);
    expect(result.points[1]._axis.y).to.be.closeTo(0, 1e-12);
    expect(result.points[5]._axis.x).to.equal(-1);
    expect(result.points[5]._axis.y).to.be.closeTo(0, 1e-12);
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

  it("lengthens the neighbours' handles without turning them", () => {
    const points = bent();
    const eased = applyInsertionEasing(points, 3, 1);
    for (const [outer, anchor] of [
      [1, 0],
      [5, 6],
    ]) {
      const before = points[outer];
      const after = eased[outer];
      const cross =
        (before.x - points[anchor].x) * (after.y - points[anchor].y) -
        (before.y - points[anchor].y) * (after.x - points[anchor].x);
      // Same line through the same on-curve: a turn here would rotate a handle
      // that a smooth end point is held colinear with.
      expect(cross).to.be.closeTo(0, 1e-9);
      expect(
        Math.hypot(after.x - points[anchor].x, after.y - points[anchor].y)
      ).to.not.be.closeTo(
        Math.hypot(before.x - points[anchor].x, before.y - points[anchor].y),
        1e-6
      );
    }
  });

  it("moves the drawn curve on a cut straight, where the handles are stubs", () => {
    // The fault this guards: on a cut straight the insertion point's handles are
    // one unit long, and turning a one-unit handle moves the curve by less than
    // the width of the line it is drawn with. Easing did nothing a designer
    // could see. It has to reach the length as well as the direction.
    const cut = splitSideAtParameter(straightSide(), 0, 0.5);
    const swollen = applyInsertionRatio(
      cut.points,
      cut.insertedIndex,
      { x: 50, y: -30 },
      2
    );
    const travel = (easing) => {
      const eased = applyInsertionEasing(swollen, cut.insertedIndex, easing);
      const handle = eased[cut.insertedIndex + 1];
      const at = eased[cut.insertedIndex];
      return Math.hypot(handle.x - at.x, handle.y - at.y);
    };
    // Nothing at zero: the handle states only what easing gives it.
    expect(travel(0)).to.be.closeTo(0, 1e-9);
    // A third of the way to the on-curve at the end of the piece.
    expect(travel(1)).to.be.greaterThan(10);
    // And it grows without stepping.
    let previous = travel(0);
    let worst = 0;
    for (let i = 1; i <= 200; i++) {
      const now = travel(i / 200);
      worst = Math.max(worst, Math.abs(now - previous));
      previous = now;
    }
    expect(worst).to.be.lessThan(0.5);
  });
});
