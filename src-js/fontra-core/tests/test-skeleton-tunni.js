import {
  areSkeletonTensionsEqualized,
  buildSkeletonTunniSegments,
  calculateGeneratedCurvatureEdits,
  calculateSkeletonControlPointsFromTunniDelta,
  calculateSkeletonEqualizedControlPoints,
  calculateSkeletonOnCurveFromTunni,
  calculateSkeletonTrueTunniPoint,
  calculateSkeletonTunniPoint,
  segmentToTunniPoints,
  skeletonTunniHitTest,
} from "@fontra/core/skeleton-model.js";
import {
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoAxis,
  calculateTunniPoint,
} from "@fontra/core/tunni-calculations.js";
import { expect } from "chai";

describe("skeleton Tunni segment helpers", () => {
  it("builds stable cubic segments for open contours without wrapping", () => {
    const contour = makeOpenContour();
    const segments = buildSkeletonTunniSegments(contour);

    expect(segments).to.have.length(1);
    expect(segments[0]).to.include({
      contourId: 10,
      startPointId: 1,
      endPointId: 4,
      startIndex: 0,
      endIndex: 3,
      segmentIndex: 0,
    });
    expect(segments[0].controlPointIds).to.deep.equal([2, 3]);
    expect(segments[0].controlIndices).to.deep.equal([1, 2]);
    expect(segments[0].startPoint).to.equal(contour.points[0]);
  });

  it("wraps closed contours from the final on-curve to the first on-curve", () => {
    const contour = {
      ...makeOpenContour(),
      closed: true,
      points: [
        ...makeOpenContour().points,
        { id: 5, x: 130, y: 100, type: "cubic" },
        { id: 6, x: -30, y: 0, type: "cubic" },
      ],
    };

    const segments = buildSkeletonTunniSegments(contour);

    expect(segments).to.have.length(2);
    expect(segments[1]).to.include({
      startPointId: 4,
      endPointId: 1,
      startIndex: 3,
      endIndex: 0,
      segmentIndex: 1,
    });
    expect(segments[1].controlPointIds).to.deep.equal([5, 6]);
    expect(segments[1].controlIndices).to.deep.equal([4, 5]);
  });

  it("returns non-cubic segments while Tunni point conversion rejects them", () => {
    const contour = {
      id: 20,
      closed: false,
      points: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
      ],
    };

    const segments = buildSkeletonTunniSegments(contour);

    expect(segments).to.have.length(1);
    expect(segments[0].controlPointIds).to.deep.equal([]);
    expect(segmentToTunniPoints(segments[0])).to.equal(null);
    expect(calculateSkeletonTunniPoint(segments[0])).to.equal(null);
    expect(calculateSkeletonTrueTunniPoint(segments[0])).to.equal(null);
  });
});

describe("skeleton Tunni geometry helpers", () => {
  it("calculates midpoint and true Tunni points for a cubic skeleton segment", () => {
    const segment = buildSkeletonTunniSegments(makeIntersectingContour())[0];

    expect(calculateSkeletonTunniPoint(segment)).to.deep.equal({ x: 50, y: 50 });
    expect(roundPoint(calculateSkeletonTrueTunniPoint(segment))).to.deep.equal({
      x: 50,
      y: 100,
    });
  });

  it("moves controls from midpoint delta with preserved and independent tensions", () => {
    const segment = buildSkeletonTunniSegments(makeIntersectingContour())[0];

    expect(
      roundPoints(
        calculateSkeletonControlPointsFromTunniDelta({ x: 0, y: 20 }, segment, true)
      )
    ).to.deep.equal([
      { x: 34, y: 68 },
      { x: 66, y: 68 },
    ]);
    expect(
      roundPoints(
        calculateSkeletonControlPointsFromTunniDelta({ x: 0, y: 20 }, segment, false)
      )
    ).to.deep.equal([
      { x: 33, y: 66 },
      { x: 67, y: 66 },
    ]);
  });

  it("moves on-curve points from true Tunni with coupled and independent distances", () => {
    const segment = buildSkeletonTunniSegments(makeIntersectingContour())[0];

    expect(
      roundPoints(calculateSkeletonOnCurveFromTunni({ x: 50, y: 120 }, segment, true))
    ).to.deep.equal([
      { x: 8, y: 16 },
      { x: 92, y: 16 },
    ]);
    expect(
      roundPoints(calculateSkeletonOnCurveFromTunni({ x: 60, y: 120 }, segment, false))
    ).to.deep.equal([
      { x: 10, y: 20 },
      { x: 94, y: 12 },
    ]);
  });

  it("equalizes skeleton control tensions and reports equalized state", () => {
    const segment = buildSkeletonTunniSegments(makeUnequalTensionContour())[0];

    expect(areSkeletonTensionsEqualized(segment)).to.equal(false);
    const [control1, control2] = calculateSkeletonEqualizedControlPoints(segment);

    expect(roundPoint(control1)).to.deep.equal({ x: 38, y: 75 });
    expect(roundPoint(control2)).to.deep.equal({ x: 81, y: 44 });
    expect(
      areSkeletonTensionsEqualized({
        ...segment,
        controlPoints: [control1, control2],
      })
    ).to.equal(true);
  });

  it("guards parallel handle rays without throwing", () => {
    const segment = buildSkeletonTunniSegments({
      id: 40,
      closed: false,
      points: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 50, y: 0, type: "cubic" },
        { id: 3, x: 50, y: 100, type: "cubic" },
        { id: 4, x: 0, y: 100 },
      ],
    })[0];

    expect(calculateSkeletonTrueTunniPoint(segment)).to.equal(null);
    expect(calculateSkeletonEqualizedControlPoints(segment)).to.deep.equal([
      segment.controlPoints[0],
      segment.controlPoints[1],
    ]);
    expect(areSkeletonTensionsEqualized(segment)).to.equal(true);
  });
});

describe("skeleton Tunni hit testing", () => {
  it("prefers true Tunni hits when true and midpoint are both in range", () => {
    const skeletonData = { contours: [makeIntersectingContour()] };

    const hit = skeletonTunniHitTest({ x: 50, y: 75 }, 30, skeletonData);

    expect(hit).to.include({
      type: "true-tunni",
      contourId: 30,
      contourIndex: 0,
      segmentIndex: 0,
    });
    expect(hit.segment.startPointId).to.equal(1);
    expect(hit.segment.endPointId).to.equal(4);
    expect(hit.segment.controlPointIds).to.deep.equal([2, 3]);
    expect(roundPoint(hit.tunniPoint)).to.deep.equal({ x: 50, y: 100 });
  });

  it("returns midpoint hits for midpoint-only mode and ignores true Tunni points", () => {
    const skeletonData = { contours: [makeIntersectingContour()] };

    const hit = skeletonTunniHitTest({ x: 50, y: 50 }, 5, skeletonData, {
      midpointOnly: true,
    });
    const trueHit = skeletonTunniHitTest({ x: 50, y: 100 }, 5, skeletonData, {
      midpointOnly: true,
    });

    expect(hit).to.include({
      type: "tunni",
      contourId: 30,
      contourIndex: 0,
      segmentIndex: 0,
    });
    expect(hit.tunniPoint).to.deep.equal({ x: 50, y: 50 });
    expect(trueHit).to.equal(null);
  });

  it("can exclude true Tunni hits without midpoint-only targeting", () => {
    const skeletonData = { contours: [makeIntersectingContour()] };

    const hit = skeletonTunniHitTest({ x: 50, y: 100 }, 5, skeletonData, {
      includeTrueTunni: false,
    });

    expect(hit).to.equal(null);
  });

  it("returns null for misses and missing skeleton contours", () => {
    expect(skeletonTunniHitTest({ x: 500, y: 500 }, 5, { contours: [] })).to.equal(
      null
    );
    expect(skeletonTunniHitTest({ x: 50, y: 50 }, 5, null)).to.equal(null);
  });
});

function makeOpenContour() {
  return {
    id: 10,
    closed: false,
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, type: "cubic", x: 50, y: 0 },
      { id: 3, type: "cubic", x: 50, y: 100 },
      { id: 4, x: 100, y: 100 },
    ],
  };
}

function makeIntersectingContour() {
  return {
    id: 30,
    closed: false,
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, type: "cubic", x: 25, y: 50 },
      { id: 3, type: "cubic", x: 75, y: 50 },
      { id: 4, x: 100, y: 0 },
    ],
  };
}

function makeUnequalTensionContour() {
  return {
    id: 30,
    closed: false,
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, type: "cubic", x: 25, y: 50 },
      { id: 3, type: "cubic", x: 75, y: 25 },
      { id: 4, x: 100, y: 100 },
    ],
  };
}

function roundPoint(point) {
  return point
    ? {
        x: Math.round(point.x),
        y: Math.round(point.y),
      }
    : point;
}

function roundPoints(points) {
  return points.map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
  }));
}

// Turning a curvature-gizmo drag on a GENERATED segment into skeleton writes.
// The addresses come from provenance, never from geometry (rail R-D).
describe("generated curvature gizmo edits", () => {
  const segmentPoints = [
    { x: 0, y: 0 },
    { x: 20, y: 80 },
    { x: 160, y: 60 },
    { x: 200, y: 0 },
  ];
  const provenance = [
    { skeletonPointId: 2, side: "left", role: "onCurve" },
    { skeletonPointId: 2, side: "left", role: "out" },
    { skeletonPointId: 5, side: "left", role: "in" },
    { skeletonPointId: 5, side: "left", role: "onCurve" },
  ];
  const axis = () => calculateCurvatureGizmoAxis(segmentPoints);
  const drag = (amount, overrides = {}) =>
    calculateGeneratedCurvatureEdits({
      segmentPoints,
      provenance,
      delta: { x: axis().x * amount, y: axis().y * amount },
      ...overrides,
    });

  it("addresses the two handles by their own provenance", () => {
    const edits = drag(10);
    expect(edits).to.have.length(2);
    expect(edits[0]).to.include({ skeletonPointId: 2, side: "left", role: "out" });
    expect(edits[1]).to.include({ skeletonPointId: 5, side: "left", role: "in" });
  });

  it("reports the offset each handle must move by", () => {
    const edits = drag(10);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis().x * 10, y: axis().y * 10 },
      segmentPoints
    );
    expect(edits[0].offsetDelta.x).to.be.closeTo(moved[0].x - segmentPoints[1].x, 1e-9);
    expect(edits[0].offsetDelta.y).to.be.closeTo(moved[0].y - segmentPoints[1].y, 1e-9);
    expect(edits[1].offsetDelta.x).to.be.closeTo(moved[1].x - segmentPoints[2].x, 1e-9);
    expect(edits[1].offsetDelta.y).to.be.closeTo(moved[1].y - segmentPoints[2].y, 1e-9);
  });

  it("produces zero offsets for a drag that goes nowhere", () => {
    const edits = drag(0);
    expect(edits).to.have.length(2);
    for (const edit of edits) {
      expect(edit.offsetDelta.x).to.be.closeTo(0, 1e-9);
      expect(edit.offsetDelta.y).to.be.closeTo(0, 1e-9);
    }
  });

  it("declines the drag when the segment has no Tunni point", () => {
    expect(
      calculateGeneratedCurvatureEdits({
        segmentPoints: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 150, y: 0 },
          { x: 200, y: 0 },
        ],
        provenance,
        delta: { x: 5, y: 5 },
      })
    ).to.equal(null);
  });

  it("declines rather than guessing when a handle has no provenance", () => {
    expect(
      calculateGeneratedCurvatureEdits({
        segmentPoints,
        provenance: [provenance[0], null, provenance[2], provenance[3]],
        delta: { x: 5, y: 5 },
      })
    ).to.equal(null);
  });

  it("declines when a handle's provenance is not a handle role", () => {
    expect(
      calculateGeneratedCurvatureEdits({
        segmentPoints,
        provenance: [
          provenance[0],
          { skeletonPointId: 2, side: "left", role: "onCurve" },
          provenance[2],
          provenance[3],
        ],
        delta: { x: 5, y: 5 },
      })
    ).to.equal(null);
  });

  it("carries the tension ceiling through", () => {
    const edits = drag(5000);
    const moved = [
      {
        x: segmentPoints[1].x + edits[0].offsetDelta.x,
        y: segmentPoints[1].y + edits[0].offsetDelta.y,
      },
      {
        x: segmentPoints[2].x + edits[1].offsetDelta.x,
        y: segmentPoints[2].y + edits[1].offsetDelta.y,
      },
    ];
    const points = [segmentPoints[0], ...moved, segmentPoints[3]];
    const tunni = calculateTunniPoint(points);
    const tension = (on, off) =>
      Math.hypot(off.x - on.x, off.y - on.y) /
      Math.hypot(tunni.x - on.x, tunni.y - on.y);
    expect(tension(points[0], points[1])).to.be.at.most(1 + 1e-9);
    expect(tension(points[3], points[2])).to.be.at.most(1 + 1e-9);
  });
});
