import { cubicPointAt } from "@fontra/core/offset-contour.js";
import {
  chooseSlideInterval,
  getAdjacentSegments,
  makeSlideCandidate,
  projectPointToSegment,
  roundSlideCandidate,
  slideIntervalsCompatible,
  slidePointOnContour,
  splitSegmentAt,
} from "@fontra/core/point-slide.js";
import { Bezier } from "bezier-js";
import { expect } from "chai";

// Plain contour points, exactly as they come out of VarPackedPath's unpacked
// form: on-curves have no `type`, off-curves carry `type: "cubic"`. A line
// segment is two on-curves with nothing between; a cubic is two on-curves with
// two off-curves between. On a closed contour the closing segment's handles sit
// at the tail of the array, behind the last on-curve.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });

// A bowed span A -> P -> B with a curve on both sides of P, capped by a
// straight at each end. P is a corner here; smoothness is set per test.
function bowedContour() {
  return {
    points: [
      onCurve(0, 100),
      onCurve(0, 0),
      control(30, 20),
      control(70, 20),
      onCurve(100, 0),
      control(130, 20),
      control(170, 20),
      onCurve(200, 0),
      onCurve(200, 100),
    ],
    isClosed: false,
  };
}
// Indices in bowedContour: A is 1, P is 4, B is 7. A slide never changes the
// point count: the dragged point keeps its slot and the neighbouring
// on-curves anchor the gesture.

function closedContour() {
  return {
    points: [
      onCurve(100, 0),
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

// The largest distance between a candidate piece and the original segment
// restricted to the source interval [t0, t1], compared at matched parameters:
// the piece at u draws the original at t0 + (t1 - t0) * u. No projection
// instrument is involved, so the tolerance measures the math and nothing else.
function pieceDeviation(originalSeg, t0, t1, piece) {
  let worst = 0;
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    const a = evalPiece(piece, u);
    const b = evalPiece(originalSeg, t0 + (t1 - t0) * u);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return worst;
}

// The largest distance between the two split pieces and the original segment,
// compared at matched source parameters.
function splitDeviation(originalSeg, t, left, right) {
  return Math.max(
    pieceDeviation(originalSeg, 0, t, left),
    pieceDeviation(originalSeg, t, 1, right)
  );
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

const angleOfVectors = (a, b) =>
  Math.abs((Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180) / Math.PI);

// The far segment's anchor always keeps its handle direction. At the moved
// point: a smooth point leaves along the old curve, colinear with the
// traveled piece's handle; a corner keeps its own old handle direction.
function expectFarSegmentAdapted(
  contour,
  candidate,
  pointIndex,
  nearIndex,
  farIndex,
  anchorIndex,
  traveledHandleIndex
) {
  const anchor = contour.points[anchorIndex];
  expect(candidate.points[anchorIndex]).to.deep.include({ x: anchor.x, y: anchor.y });
  const oldFarVec = {
    x: contour.points[farIndex].x - anchor.x,
    y: contour.points[farIndex].y - anchor.y,
  };
  const newFarVec = {
    x: candidate.points[farIndex].x - anchor.x,
    y: candidate.points[farIndex].y - anchor.y,
  };
  const cross = oldFarVec.x * newFarVec.y - oldFarVec.y * newFarVec.x;
  const dot = oldFarVec.x * newFarVec.x + oldFarVec.y * newFarVec.y;
  expect(Math.abs((Math.atan2(cross, dot) * 180) / Math.PI)).to.be.closeTo(0, 1e-6);
  const oldPoint = contour.points[pointIndex];
  const oldNear = contour.points[nearIndex];
  const wasCorner =
    angleBetween(contour.points[traveledHandleIndex], oldPoint, oldNear) < 179.4;
  const moved = candidate.points[pointIndex];
  const near = candidate.points[nearIndex];
  if (wasCorner) {
    expect(
      angleOfVectors(
        { x: oldNear.x - oldPoint.x, y: oldNear.y - oldPoint.y },
        { x: near.x - moved.x, y: near.y - moved.y }
      )
    ).to.be.closeTo(0, 1e-6);
    return;
  }
  const traveled = candidate.points[traveledHandleIndex];
  if (Math.hypot(traveled.x - moved.x, traveled.y - moved.y) > 1e-6) {
    expect(angleBetween(traveled, moved, near)).to.be.closeTo(180, 1e-6);
  }
}

// A previous-side slide on bowedContour: the count holds, the traveled
// segment A -> P' is the split's exact first piece, the far segment (P -> B)
// rescales around B, and everything else is a copy.
function expectPreviousSlide(contour, candidate, t) {
  expect(candidate.points).to.have.length(contour.points.length);
  expect(candidate.movedPointIndex).to.equal(4);
  expectSamePiece(candidate.points.slice(0, 2), contour.points.slice(0, 2));
  expect(
    pieceDeviation(contour.points.slice(1, 5), 0, t, candidate.points.slice(1, 5))
  ).to.be.lessThan(1e-6);
  expectFarSegmentAdapted(contour, candidate, 4, 5, 6, 7, 3);
  expectSamePiece(candidate.points.slice(7, 9), contour.points.slice(7, 9));
}

// The same for a next-side slide: P' -> B is the split's exact second piece,
// and the far segment (A -> P) rescales around A.
function expectNextSlide(contour, candidate, t) {
  expect(candidate.points).to.have.length(contour.points.length);
  expect(candidate.movedPointIndex).to.equal(4);
  expectSamePiece(candidate.points.slice(0, 2), contour.points.slice(0, 2));
  expectFarSegmentAdapted(contour, candidate, 4, 3, 2, 1, 5);
  expect(
    pieceDeviation(contour.points.slice(4, 8), t, 1, candidate.points.slice(4, 8))
  ).to.be.lessThan(1e-6);
  expectSamePiece(candidate.points.slice(7, 9), contour.points.slice(7, 9));
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

  it("slides the dragged point itself along a straight, count unchanged", () => {
    const contour = {
      points: [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)],
      isClosed: false,
    };
    const candidate = slidePointOnContour(contour, 1, { x: 30, y: 5 });
    // No new point, no leftover: three points in, three points out.
    expect(candidate.points).to.have.length(3);
    expect(candidate.movedPointIndex).to.equal(1);
    const moved = candidate.points[1];
    expect(moved.x).to.be.closeTo(30, 1e-9);
    expect(moved.y).to.be.closeTo(0, 1e-9);
    // The anchors did not move.
    expectSamePiece([candidate.points[0]], [contour.points[0]]);
    expectSamePiece([candidate.points[2]], [contour.points[2]]);
  });

  it("keeps the traveled segment exact on a cubic, both sides", () => {
    const contour = bowedContour();
    for (let t = 0.02; t <= 0.98; t += 0.02) {
      expectPreviousSlide(contour, makeSlideCandidate(contour, 4, "previous", t), t);
    }
    for (let t = 0.02; t <= 0.98; t += 0.02) {
      expectNextSlide(contour, makeSlideCandidate(contour, 4, "next", t), t);
    }
  });

  // A smooth arc A -> P -> B with no inflection: one cubic can draw what a
  // slide leaves the far segment to cover.
  function arcContour() {
    return {
      points: [
        onCurve(0, 0),
        control(0, 55.23),
        control(44.77, 100),
        onCurve(100, 100, true),
        control(155.23, 100),
        control(200, 55.23),
        onCurve(200, 0),
      ],
      isClosed: false,
    };
  }

  // The largest distance from the old path between the moved point and the far
  // anchor to the refit far segment.
  function farDeviation(oldPieces, farSegment) {
    const bezier = new Bezier(farSegment);
    let worst = 0;
    for (const [piece, t0, t1] of oldPieces) {
      for (let i = 0; i <= 100; i++) {
        const p = evalPiece(piece, t0 + ((t1 - t0) * i) / 100);
        const q = bezier.project(p);
        worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y));
      }
    }
    return worst;
  }

  // Near t = 0 the far segment spans almost a half circle, which a single
  // cubic draws only to about 1.5% of the radius: the bound sits there.
  it("refits the far segment to keep drawing the old path", () => {
    const contour = arcContour();
    const ap = contour.points.slice(0, 4);
    const pb = contour.points.slice(3, 7);
    for (let t = 0.1; t <= 0.9; t += 0.1) {
      const toA = makeSlideCandidate(contour, 3, "previous", t);
      expect(
        farDeviation(
          [
            [ap, t, 1],
            [pb, 0, 1],
          ],
          toA.points.slice(3, 7)
        )
      ).to.be.lessThan(1.5);
      const toB = makeSlideCandidate(contour, 3, "next", t);
      expect(
        farDeviation(
          [
            [ap, 0, 1],
            [pb, 0, t],
          ],
          toB.points.slice(0, 4)
        )
      ).to.be.lessThan(1.5);
      // The traveled side is still exact, the join still smooth.
      expect(pieceDeviation(ap, 0, t, toA.points.slice(0, 4))).to.be.lessThan(1e-6);
      expect(angleBetween(toA.points[2], toA.points[3], toA.points[4])).to.be.closeTo(
        180,
        1e-6
      );
    }
  });

  it("leaves the far segment as it was when the point does not move", () => {
    const contour = arcContour();
    const candidate = makeSlideCandidate(contour, 3, "previous", 1);
    for (const i of [4, 5]) {
      expect(candidate.points[i].x).to.be.closeTo(contour.points[i].x, 1e-3);
      expect(candidate.points[i].y).to.be.closeTo(contour.points[i].y, 1e-3);
    }
  });

  it("carries the dragged point's attributes to the new position", () => {
    const contour = bowedContour();
    contour.points[4] = { ...contour.points[4], name: "kept" };
    const candidate = makeSlideCandidate(contour, 4, "previous", 0.4);
    expect(candidate.points[4].name).to.equal("kept");
    // Nothing new was minted: every other slot holds an original point object.
    expect(candidate.points).to.have.length(contour.points.length);
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
    expect(candidate.points).to.have.length(contour.points.length);
    expect(candidate.movedPointIndex).to.equal(0);
    // The traveled piece is exact: 9 -> tail handles -> moved point 0.
    expect(
      pieceDeviation(
        [contour.points[9], contour.points[10], contour.points[11], contour.points[0]],
        0,
        t,
        [
          candidate.points[9],
          candidate.points[10],
          candidate.points[11],
          candidate.points[0],
        ]
      )
    ).to.be.lessThan(1e-6);
    // The far segment (0 -> 3, next side) rescales around anchor 3.
    expectFarSegmentAdapted(contour, candidate, 0, 1, 2, 3, 11);
    expectSamePiece(candidate.points.slice(3, 9), contour.points.slice(3, 9));
  });

  it("slides a closed contour's last on-curve forward over the seam", () => {
    const contour = closedContour();
    const t = 0.5;
    const candidate = makeSlideCandidate(contour, 9, "next", t);
    expect(candidate.isClosed).to.equal(true);
    expect(candidate.points).to.have.length(contour.points.length);
    expect(candidate.movedPointIndex).to.equal(9);
    // The kept piece trails the array: moved 9 -> tail handles -> 0.
    expect(
      pieceDeviation(
        [contour.points[9], contour.points[10], contour.points[11], contour.points[0]],
        t,
        1,
        [
          candidate.points[9],
          candidate.points[10],
          candidate.points[11],
          candidate.points[0],
        ]
      )
    ).to.be.lessThan(1e-6);
    // The far segment (6 -> 9, previous side) rescales around anchor 6.
    expectFarSegmentAdapted(contour, candidate, 9, 8, 7, 6, 10);
    expectSamePiece(candidate.points.slice(0, 6), contour.points.slice(0, 6));
  });

  it("accepts the same slide on two compatible contours", () => {
    const first = bowedContour();
    const second = bowedContour();
    second.points = second.points.map((p) => ({ ...p, x: p.x + 7, y: p.y + 3 }));
    const adjacentA = getAdjacentSegments(first, 4);
    const adjacentB = getAdjacentSegments(second, 4);
    expect(slideIntervalsCompatible(adjacentA, adjacentB)).to.equal(true);
    expectPreviousSlide(first, makeSlideCandidate(first, 4, "previous", 0.4), 0.4);
    expectPreviousSlide(second, makeSlideCandidate(second, 4, "previous", 0.4), 0.4);
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
    expect(atA.points).to.have.length(contour.points.length);
    const atB = makeSlideCandidate(contour, 4, "next", 1);
    expect(atB.points[atB.movedPointIndex].x).to.be.closeTo(200, 1e-9);
    expect(atB.points).to.have.length(contour.points.length);
    // The traveled piece still draws the original, degenerate ends included.
    expectPreviousSlide(contour, atA, 0);
    expectNextSlide(contour, atB, 1);
  });

  it("never mutates the input contour", () => {
    const contour = bowedContour();
    contour.points[4].smooth = true;
    const snapshot = JSON.parse(JSON.stringify(contour));
    slidePointOnContour(contour, 4, { x: 60, y: 40 });
    makeSlideCandidate(contour, 4, "next", 0.3);
    expect(contour).to.deep.equal(snapshot);
  });

  it("keeps a corner's curve handle direction while it slides along a straight", () => {
    // The j bowl: 4 -> 7 is a curve arriving at a corner, 7 -> 0 the closing
    // straight. Sliding 7 along the straight must not swing handle 6.
    const contour = {
      points: [
        onCurve(472, 364),
        control(291, 395),
        control(227, 250),
        onCurve(282, -14),
        onCurve(348, -14),
        control(330, 242),
        control(383, 292),
        onCurve(456.170751591, 270.517260874),
      ],
      isClosed: true,
    };
    const unit = (h, p) => {
      const length = Math.hypot(h.x - p.x, h.y - p.y);
      return { x: (h.x - p.x) / length, y: (h.y - p.y) / length };
    };
    const before6 = unit(contour.points[6], contour.points[7]);
    const before5 = unit(contour.points[5], contour.points[4]);
    for (let t = 0.1; t <= 0.9; t += 0.1) {
      const candidate = makeSlideCandidate(contour, 7, "next", t);
      const after6 = unit(candidate.points[6], candidate.points[7]);
      const after5 = unit(candidate.points[5], candidate.points[4]);
      expect(after6.x).to.be.closeTo(before6.x, 1e-9);
      expect(after6.y).to.be.closeTo(before6.y, 1e-9);
      expect(after5.x).to.be.closeTo(before5.x, 1e-9);
      expect(after5.y).to.be.closeTo(before5.y, 1e-9);
    }
    // No slide, no change.
    const still = makeSlideCandidate(contour, 7, "next", 0);
    for (const i of [5, 6]) {
      expect(still.points[i].x).to.be.closeTo(contour.points[i].x, 1e-9);
      expect(still.points[i].y).to.be.closeTo(contour.points[i].y, 1e-9);
    }
  });

  it("answers a full slide from a pointer position", () => {
    const contour = bowedContour();
    const candidate = slidePointOnContour(contour, 4, { x: 50, y: 50 });
    expect(candidate).to.not.equal(null);
    expect(candidate.side).to.equal("previous");
    expect(candidate.t).to.be.greaterThan(0).and.lessThan(1);
    expectPreviousSlide(contour, candidate, candidate.t);
  });
});

describe("roundSlideCandidate", () => {
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // A closed S-ish contour whose every on-curve is smooth.
  const contour = {
    points: [
      onCurve(0, 0, true),
      control(40, -13),
      control(97, 21),
      onCurve(131, 60, true),
      control(170, 104),
      control(233, 137),
      onCurve(300, 131, true),
      control(367, 125),
      control(-40, 13),
    ],
    isClosed: true,
  };

  it("keeps every smooth point's handles on one line after rounding", () => {
    for (const t of [0.137, 0.41, 0.73]) {
      for (const side of ["previous", "next"]) {
        const slid = makeSlideCandidate(contour, 3, side, t);
        const rounded = roundSlideCandidate(contour, slid);
        const pts = rounded.points;
        for (const [h0, o, h1] of [
          [2, 3, 4],
          [5, 6, 7],
          [8, 0, 1],
        ]) {
          const length = Math.hypot(pts[h1].x - pts[o].x, pts[h1].y - pts[o].y);
          expect(Math.abs(cross(pts[o], pts[h0], pts[h1])) / length).to.be.below(1e-6);
        }
        // The slid on-curve lands on whole units.
        expect(Number.isInteger(pts[3].x) && Number.isInteger(pts[3].y)).to.be.true;
      }
    }
  });

  it("straightens a point flagged smooth whose handles were already apart", () => {
    const bent = structuredClone(contour);
    // Point 0's incoming handle, off its line by about two degrees.
    bent.points[8] = control(-40, 11.5);
    const slid = makeSlideCandidate(bent, 3, "previous", 0.4);
    const pts = roundSlideCandidate(bent, slid).points;
    const length = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    expect(Math.abs(cross(pts[0], pts[8], pts[1])) / length).to.be.below(1e-6);
  });

  it("leaves points the slide did not move untouched", () => {
    const slid = makeSlideCandidate(contour, 3, "next", 0.3);
    const rounded = roundSlideCandidate(contour, slid);
    expect(rounded.points[0]).to.deep.equal(contour.points[0]);
    expect(rounded.points[7]).to.deep.equal(contour.points[7]);
  });
});
