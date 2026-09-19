import { cubicPointAt } from "@fontra/core/offset-contour.js";
import {
  chooseSlideInterval,
  getAdjacentSegments,
  makeSlideCandidate,
  projectPointToSegment,
  slideIntervalsCompatible,
  slidePointOnContour,
  splitSegmentAt,
} from "@fontra/core/point-slide.js";
import { expect } from "chai";

// Plain contour points, exactly as they come out of VarPackedPath's unpacked
// form: on-curves have no `type`, off-curves carry `type: "cubic"`. A line
// segment is two on-curves with nothing between; a cubic is two on-curves with
// two off-curves between. On a closed contour the closing segment's handles sit
// at the tail of the array, behind the last on-curve.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });

// A bowed span A -> P -> B with a curve on both sides of P, capped by a
// straight at each end.
function bowedContour() {
  return {
    points: [
      onCurve(0, 100),
      onCurve(0, 0),
      control(30, 20),
      control(70, 20),
      onCurve(100, 0, true),
      control(130, 20),
      control(170, 20),
      onCurve(200, 0),
      onCurve(200, 100),
    ],
    isClosed: false,
  };
}
// Indices in bowedContour: A is 1, P is 4, B is 7. A previous-side candidate
// adds three points before B, so every piece right of the splice shifts by 3.

function closedContour() {
  return {
    points: [
      onCurve(100, 0, true),
      control(130, 20),
      control(170, 20),
      onCurve(200, 0),
      control(200, -30),
      control(150, -60),
      onCurve(100, -60),
      control(50, -60),
      control(0, -30),
      onCurve(0, 0),
      control(30, 20),
      control(70, 20),
    ],
    isClosed: true,
  };
}

function evalPiece(piece, t) {
  if (piece.length === 2) {
    return {
      x: piece[0].x + (piece[1].x - piece[0].x) * t,
      y: piece[0].y + (piece[1].y - piece[0].y) * t,
    };
  }
  return cubicPointAt(piece, t);
}

// The largest distance between the two split pieces and the original segment,
// compared at matched source parameters: the left piece at u draws the
// original at t*u, the right piece at u draws the original at t+(1-t)*u. No
// projection instrument is involved, so the tolerance measures the math and
// nothing else.
function splitDeviation(originalSeg, t, left, right) {
  let worst = 0;
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    for (const [piece, mapped] of [
      [left, t * u],
      [right, t + (1 - t) * u],
    ]) {
      const a = evalPiece(piece, u);
      const b = evalPiece(originalSeg, mapped);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return worst;
}

// Two pieces must carry the same points in the same order: a piece the slide
// did not touch is copied, not recomputed.
function expectSamePiece(actual, expected) {
  expect(actual.length).to.equal(expected.length);
  actual.forEach((point, i) => {
    expect(point.x).to.be.closeTo(expected[i].x, 1e-9);
    expect(point.y).to.be.closeTo(expected[i].y, 1e-9);
    expect(!!point.type).to.equal(!!expected[i].type);
  });
}

// The whole check for a previous-side slide on bowedContour: the split pieces
// redraw the original previous segment, and every other piece is a copy.
function expectPreviousSlideExact(contour, candidate, t) {
  expectSamePiece(candidate.points.slice(0, 2), contour.points.slice(0, 2));
  expect(
    splitDeviation(
      contour.points.slice(1, 5),
      t,
      candidate.points.slice(1, 5),
      candidate.points.slice(4, 8)
    )
  ).to.be.lessThan(1e-6);
  expectSamePiece(candidate.points.slice(7, 12), contour.points.slice(4, 9));
}

// The same for a next-side slide.
function expectNextSlideExact(contour, candidate, t) {
  expectSamePiece(candidate.points.slice(0, 5), contour.points.slice(0, 5));
  expect(
    splitDeviation(
      contour.points.slice(4, 8),
      t,
      candidate.points.slice(4, 8),
      candidate.points.slice(7, 11)
    )
  ).to.be.lessThan(1e-6);
  expectSamePiece(candidate.points.slice(10, 12), contour.points.slice(7, 9));
}

function angleBetween(p, q, r) {
  // Angle at q between the rays q->p and q->r, in degrees.
  const u = { x: p.x - q.x, y: p.y - q.y };
  const v = { x: r.x - q.x, y: r.y - q.y };
  const cross = u.x * v.y - u.y * v.x;
  const dot = u.x * v.x + u.y * v.y;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

describe("point-slide geometry", () => {
  it("finds the two segments beside an on-curve", () => {
    const contour = bowedContour();
    const adjacent = getAdjacentSegments(contour, 4);
    expect(adjacent.previous.points.map((p) => [p.x, p.y])).to.deep.equal([
      [0, 0],
      [30, 20],
      [70, 20],
      [100, 0],
    ]);
    expect(adjacent.next.points.map((p) => [p.x, p.y])).to.deep.equal([
      [100, 0],
      [130, 20],
      [170, 20],
      [200, 0],
    ]);
    expect(adjacent.previous.kind).to.equal("cubic");
    expect(adjacent.next.kind).to.equal("cubic");
  });

  it("returns only the available side at an open contour's endpoint", () => {
    const contour = bowedContour();
    const first = getAdjacentSegments(contour, 0);
    expect(first.previous).to.equal(null);
    expect(first.next.kind).to.equal("line");
    const last = getAdjacentSegments(contour, 8);
    expect(last.next).to.equal(null);
    expect(last.previous.kind).to.equal("line");
  });

  it("projects a pointer onto a cubic", () => {
    const contour = bowedContour();
    const adjacent = getAdjacentSegments(contour, 4);
    // Straight above the middle of the previous cubic.
    const { t, point } = projectPointToSegment(adjacent.previous, { x: 50, y: 60 });
    expect(t).to.be.greaterThan(0).and.lessThan(1);
    const onCurvePoint = cubicPointAt(adjacent.previous.points, t);
    expect(point.x).to.be.closeTo(onCurvePoint.x, 1e-6);
    expect(point.y).to.be.closeTo(onCurvePoint.y, 1e-6);
  });

  it("projects a pointer onto a straight and clamps to it", () => {
    const contour = bowedContour();
    const first = getAdjacentSegments(contour, 0);
    const beyond = projectPointToSegment(first.next, { x: 0, y: 150 });
    expect(beyond.t).to.equal(0);
    const within = projectPointToSegment(first.next, { x: 0, y: 40 });
    expect(within.t).to.be.closeTo(0.6, 1e-9);
  });

  it("chooses the nearer side for the destination", () => {
    const contour = bowedContour();
    const adjacent = getAdjacentSegments(contour, 4);
    const nearA = chooseSlideInterval(adjacent, { x: 30, y: 40 }, contour.points[4]);
    expect(nearA.side).to.equal("previous");
    const nearB = chooseSlideInterval(adjacent, { x: 170, y: 40 }, contour.points[4]);
    expect(nearB.side).to.equal("next");
  });

  for (const t of [0, 0.5, 1]) {
    it(`splits a cubic at t = ${t} and draws the same curve`, () => {
      const contour = bowedContour();
      const adjacent = getAdjacentSegments(contour, 4);
      const { replacement, point } = splitSegmentAt(adjacent.previous.points, t);
      // A cubic's replacement is five points: two handles, the new on-curve,
      // two handles. The new on-curve sits on the original curve.
      expect(replacement).to.have.length(5);
      expect(replacement[2].type).to.equal(undefined);
      const expected = cubicPointAt(adjacent.previous.points, t);
      expect(point.x).to.be.closeTo(expected.x, 1e-9);
      expect(point.y).to.be.closeTo(expected.y, 1e-9);
      const left = [adjacent.previous.points[0], ...replacement.slice(0, 3)];
      const right = [
        replacement[2],
        ...replacement.slice(3),
        adjacent.previous.points[3],
      ];
      expect(splitDeviation(adjacent.previous.points, t, left, right)).to.be.lessThan(
        1e-6
      );
    });
  }

  it("splits a straight into two straights", () => {
    const { replacement, point } = splitSegmentAt(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      0.3
    );
    // A straight's replacement is the new on-curve alone: no handles, the two
    // pieces stay straights.
    expect(replacement).to.have.length(1);
    expect(point.x).to.be.closeTo(30, 1e-9);
    expect(point.y).to.be.closeTo(0, 1e-9);
  });

  it("refuses an open contour's endpoint", () => {
    const contour = bowedContour();
    expect(slidePointOnContour(contour, 0, { x: 0, y: 50 })).to.equal(null);
    expect(slidePointOnContour(contour, 8, { x: 200, y: 50 })).to.equal(null);
  });

  it("slides a point along a straight and keeps two straights", () => {
    const contour = {
      points: [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)],
      isClosed: false,
    };
    const candidate = slidePointOnContour(contour, 1, { x: 30, y: 5 });
    expect(candidate.movedPointIndex).to.equal(1);
    expect(candidate.points).to.have.length(4);
    const moved = candidate.points[1];
    expect(moved.x).to.be.closeTo(30, 1e-9);
    expect(moved.y).to.be.closeTo(0, 1e-9);
    // No handles anywhere: both pieces stay straights.
    expect(candidate.points.every((point) => !point.type)).to.equal(true);
    // The leftover sits at the old position.
    expect(candidate.points[2].x).to.equal(100);
    expect(candidate.points[2].y).to.equal(0);
  });

  it("slides a point along a cubic and redraws the identical curve", () => {
    const contour = bowedContour();
    for (let t = 0.02; t <= 0.98; t += 0.02) {
      expectPreviousSlideExact(
        contour,
        makeSlideCandidate(contour, 4, "previous", t),
        t
      );
    }
    for (let t = 0.02; t <= 0.98; t += 0.02) {
      expectNextSlideExact(contour, makeSlideCandidate(contour, 4, "next", t), t);
    }
  });

  it("keeps a smooth point's handles colinear through the slide", () => {
    const contour = bowedContour();
    for (let t = 0.05; t <= 0.95; t += 0.05) {
      const candidate = makeSlideCandidate(contour, 4, "previous", t);
      const i = candidate.movedPointIndex;
      const moved = candidate.points[i];
      expect(moved.smooth).to.equal(true);
      const before = candidate.points[i - 1];
      const after = candidate.points[i + 1];
      expect(before.type).to.equal("cubic");
      expect(after.type).to.equal("cubic");
      // Colinear through the point: the angle at the moved point reads 180.
      expect(angleBetween(before, moved, after)).to.be.closeTo(180, 1e-6);
    }
  });

  it("keeps a corner's flag and leaves the old corner geometry behind", () => {
    const contour = bowedContour();
    contour.points[4].smooth = false;
    const candidate = makeSlideCandidate(contour, 4, "previous", 0.4);
    const moved = candidate.points[candidate.movedPointIndex];
    expect(moved.smooth).to.equal(false);
    // The leftover inherits the old joint's position and its smooth flag,
    // nothing else.
    const leftover = candidate.points[candidate.movedPointIndex + 3];
    expect(leftover.x).to.equal(100);
    expect(leftover.y).to.equal(0);
    expect(leftover.smooth).to.equal(false);
    expectPreviousSlideExact(contour, candidate, 0.4);
  });

  it("keeps the moved point's attributes and adds none to the leftover", () => {
    const contour = bowedContour();
    contour.points[4] = { ...contour.points[4], name: "kept" };
    const candidate = makeSlideCandidate(contour, 4, "previous", 0.4);
    const moved = candidate.points[candidate.movedPointIndex];
    expect(moved.name).to.equal("kept");
    const leftover = candidate.points[candidate.movedPointIndex + 3];
    expect(leftover.name).to.equal(undefined);
  });

  it("slides across a closed contour's seam", () => {
    const contour = closedContour();
    // Point 0's previous segment is the wrapping one: last on-curve (index 9)
    // to point 0, with the two tail handles.
    const adjacent = getAdjacentSegments(contour, 0);
    expect(adjacent.previous.kind).to.equal("cubic");
    expect(adjacent.previous.points[0]).to.deep.include({ x: 0, y: 0 });
    expect(adjacent.previous.points.at(-1)).to.deep.include({ x: 100, y: 0 });
    const t = 0.5;
    const candidate = makeSlideCandidate(contour, 0, "previous", t);
    expect(candidate.isClosed).to.equal(true);
    expect(candidate.points).to.have.length(contour.points.length + 3);
    // The untouched pieces are copies. The split pair redraws the wrapping
    // segment: 9 -> moved -> 0, with the tail handles behind index 9.
    expectSamePiece(candidate.points.slice(0, 10), contour.points.slice(0, 10));
    expect(
      splitDeviation(
        [contour.points[9], contour.points[10], contour.points[11], contour.points[0]],
        t,
        candidate.points.slice(9, 13),
        [
          candidate.points[12],
          candidate.points[13],
          candidate.points[14],
          candidate.points[0],
        ]
      )
    ).to.be.lessThan(1e-6);
    // The moved point carries the original's attributes.
    expect(candidate.points[candidate.movedPointIndex].smooth).to.equal(true);
  });

  it("slides a closed contour's last on-curve forward over the seam", () => {
    const contour = closedContour();
    const t = 0.5;
    const candidate = makeSlideCandidate(contour, 9, "next", t);
    expect(candidate.isClosed).to.equal(true);
    // The split pair trails the array: 9 -> moved -> 0.
    expectSamePiece(candidate.points.slice(0, 9), contour.points.slice(0, 9));
    expect(
      splitDeviation(
        [contour.points[9], contour.points[10], contour.points[11], contour.points[0]],
        t,
        candidate.points.slice(9, 13),
        [
          candidate.points[12],
          candidate.points[13],
          candidate.points[14],
          candidate.points[0],
        ]
      )
    ).to.be.lessThan(1e-6);
  });

  it("accepts the same slide on two compatible contours", () => {
    const first = bowedContour();
    const second = bowedContour();
    second.points = second.points.map((p) => ({ ...p, x: p.x + 7, y: p.y + 3 }));
    const adjacentA = getAdjacentSegments(first, 4);
    const adjacentB = getAdjacentSegments(second, 4);
    expect(slideIntervalsCompatible(adjacentA, adjacentB)).to.equal(true);
    expectPreviousSlideExact(first, makeSlideCandidate(first, 4, "previous", 0.4), 0.4);
    expectPreviousSlideExact(
      second,
      makeSlideCandidate(second, 4, "previous", 0.4),
      0.4
    );
  });

  it("refuses when two contours disagree on the interval", () => {
    const first = bowedContour();
    const second = bowedContour();
    // Second contour's previous segment is a straight: drop its two handles.
    second.points = second.points.filter((_, index) => index !== 2 && index !== 3);
    const adjacentA = getAdjacentSegments(first, 4);
    const adjacentB = getAdjacentSegments(second, 2);
    expect(slideIntervalsCompatible(adjacentA, adjacentB)).to.equal(false);
  });

  it("clamps the destination to the neighboring on-curves", () => {
    const contour = bowedContour();
    const atA = makeSlideCandidate(contour, 4, "previous", 0);
    expect(atA.points[atA.movedPointIndex].x).to.be.closeTo(0, 1e-9);
    const atB = makeSlideCandidate(contour, 4, "next", 1);
    expect(atB.points[atB.movedPointIndex].x).to.be.closeTo(200, 1e-9);
    // And the shape still holds with the point collapsed onto its neighbour.
    expectPreviousSlideExact(contour, atA, 0);
    expectNextSlideExact(contour, atB, 1);
  });

  it("never mutates the input contour", () => {
    const contour = bowedContour();
    const snapshot = JSON.parse(JSON.stringify(contour));
    slidePointOnContour(contour, 4, { x: 60, y: 40 });
    makeSlideCandidate(contour, 4, "next", 0.3);
    expect(contour).to.deep.equal(snapshot);
  });

  it("answers a full slide from a pointer position", () => {
    const contour = bowedContour();
    const candidate = slidePointOnContour(contour, 4, { x: 50, y: 50 });
    expect(candidate).to.not.equal(null);
    expect(candidate.side).to.equal("previous");
    expect(candidate.t).to.be.greaterThan(0).and.lessThan(1);
    expectPreviousSlideExact(contour, candidate, candidate.t);
  });
});
