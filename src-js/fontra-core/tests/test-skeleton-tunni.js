import {
  areSkeletonTensionsEqualized,
  buildGeneratedTunniSegments,
  buildSkeletonTunniSegments,
  calculateGeneratedCurvatureEdits,
  calculateGeneratedOnCurveEdits,
  calculateSkeletonControlPointsFromTunniDelta,
  calculateSkeletonEqualizedControlPoints,
  calculateSkeletonOnCurveFromTunni,
  calculateSkeletonTrueTunniPoint,
  calculateSkeletonTunniPoint,
  generatedTunniHitTest,
  getGeneratedPathContourIndices,
  getSkeletonData,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  segmentToTunniPoints,
  setSkeletonData,
  skeletonTunniHitTest,
} from "@fontra/core/skeleton-model.js";
import {
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoAxis,
  calculateCurvatureGizmoPoint,
  calculateTunniPoint,
} from "@fontra/core/tunni-calculations.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import { editSkeleton } from "../../views-editor/src/skeleton-editing.js";

before(() => {
  globalThis.window = { coarseGridSpacing: 1, event: null };
});

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

// Enumerating the generated contours' cubic segments, and hit-testing the two
// gizmos on them. This is the join the visualization layer and the pointer tool
// both need, so it lives in one place rather than twice.
describe("generated Tunni segments", () => {
  function makeGlyph() {
    const layer = {
      path: new VarPackedPath(),
      components: [],
      anchors: [],
      guidelines: [],
      customData: {},
    };
    setSkeletonData(
      layer,
      normalizeSkeletonData({
        contours: [
          makeSkeletonContour({
            id: 80,
            defaultWidth: 80,
            points: [
              makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
              makeSkeletonPoint({ id: 2, x: 30, y: 40, type: "cubic" }),
              makeSkeletonPoint({ id: 3, x: 70, y: 40, type: "cubic" }),
              makeSkeletonPoint({ id: 4, x: 100, y: 0, smooth: true }),
              makeSkeletonPoint({ id: 5, x: 130, y: -40, type: "cubic" }),
              makeSkeletonPoint({ id: 6, x: 170, y: -40, type: "cubic" }),
              makeSkeletonPoint({ id: 7, x: 200, y: 0 }),
            ],
          }),
        ],
      })
    );
    editSkeleton(layer, () => {});
    return layer;
  }

  it("finds the cubic segments of the generated contours", () => {
    const layer = makeGlyph();
    const segments = buildGeneratedTunniSegments(getSkeletonData(layer), layer.path);
    expect(segments.length).to.be.above(0);
    for (const segment of segments) {
      expect(segment.points).to.have.length(4);
      expect(segment.pointIndices).to.have.length(4);
      expect(segment.provenance).to.have.length(4);
    }
  });

  it("carries each point's own provenance, in segment order", () => {
    const layer = makeGlyph();
    const segments = buildGeneratedTunniSegments(getSkeletonData(layer), layer.path);
    const roles = segments.map((segment) =>
      segment.provenance.map((entry) => entry?.role)
    );
    expect(
      roles.some((r) => r[0] === "onCurve" && r[1] === "out" && r[2] === "in")
    ).to.equal(true);
    for (const segment of segments) {
      const sides = new Set(segment.provenance.map((entry) => entry?.side));
      expect(sides.size).to.equal(1);
    }
  });

  it("skips contours that are not generated", () => {
    const layer = makeGlyph();
    const skeletonData = getSkeletonData(layer);
    const generatedIndices = getGeneratedPathContourIndices(skeletonData);
    for (const segment of buildGeneratedTunniSegments(skeletonData, layer.path)) {
      expect(generatedIndices.has(segment.pathContourIndex)).to.equal(true);
    }
  });

  it("hits the curvature gizmo where the curve's centre is", () => {
    const layer = makeGlyph();
    const skeletonData = getSkeletonData(layer);
    const [segment] = buildGeneratedTunniSegments(skeletonData, layer.path);
    const anchor = calculateCurvatureGizmoPoint(segment.points);
    const hit = generatedTunniHitTest(anchor, 4, skeletonData, layer.path);
    expect(hit?.type).to.equal("generated-curvature");
    expect(hit.gizmoPoint.x).to.be.closeTo(anchor.x, 1e-9);
    expect(hit.gizmoPoint.y).to.be.closeTo(anchor.y, 1e-9);
  });

  it("hits the on-curve gizmo at the segment's true Tunni point", () => {
    const layer = makeGlyph();
    const skeletonData = getSkeletonData(layer);
    const [segment] = buildGeneratedTunniSegments(skeletonData, layer.path);
    const truePoint = calculateTunniPoint(segment.points);
    const hit = generatedTunniHitTest(truePoint, 4, skeletonData, layer.path);
    expect(hit?.type).to.equal("generated-on-curve");
  });

  it("misses when nothing is near", () => {
    const layer = makeGlyph();
    expect(
      generatedTunniHitTest(
        { x: -5000, y: -5000 },
        4,
        getSkeletonData(layer),
        layer.path
      )
    ).to.equal(null);
  });
});

// The on-curve gizmo's writes: two nudges, tangent-constrained (D12).
describe("generated on-curve gizmo edits", () => {
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

  it("addresses both rib ends by their own provenance", () => {
    const edits = calculateGeneratedOnCurveEdits({
      segmentPoints,
      provenance,
      delta: { x: 0, y: 20 },
    });
    expect(edits).to.have.length(2);
    expect(edits[0]).to.include({ skeletonPointId: 2, side: "left", role: "onCurve" });
    expect(edits[1]).to.include({ skeletonPointId: 5, side: "left", role: "onCurve" });
  });

  it("reports a scalar nudge, never a free displacement", () => {
    const edits = calculateGeneratedOnCurveEdits({
      segmentPoints,
      provenance,
      delta: { x: 7, y: 13 },
    });
    for (const edit of edits) {
      expect(edit.nudgeDelta).to.be.a("number");
      expect(Number.isFinite(edit.nudgeDelta)).to.equal(true);
      expect(edit).to.not.have.property("displacement");
    }
  });

  it("slides the rib end by the amount dragged along its own axis", () => {
    const axis = { x: 20 / Math.hypot(20, 80), y: 80 / Math.hypot(20, 80) };
    for (const amount of [-40, -10, 10, 40]) {
      const edits = calculateGeneratedOnCurveEdits({
        segmentPoints,
        provenance,
        delta: { x: axis.x * amount, y: axis.y * amount },
      });
      // A tangent-constrained control should track the pointer 1:1 along the
      // axis it is constrained to, not merely move in the right direction.
      expect(edits[0].nudgeDelta).to.be.closeTo(amount, Math.abs(amount) * 0.2);
    }
  });

  it("responds monotonically, so a drag never doubles back", () => {
    const axis = { x: 20 / Math.hypot(20, 80), y: 80 / Math.hypot(20, 80) };
    let previous = -Infinity;
    for (const amount of [-40, -20, -5, 0, 5, 20, 40]) {
      const edits = calculateGeneratedOnCurveEdits({
        segmentPoints,
        provenance,
        delta: { x: axis.x * amount, y: axis.y * amount },
      });
      expect(edits[0].nudgeDelta).to.be.above(previous);
      previous = edits[0].nudgeDelta;
    }
  });

  it("stays put for a drag that goes nowhere", () => {
    const edits = calculateGeneratedOnCurveEdits({
      segmentPoints,
      provenance,
      delta: { x: 0, y: 0 },
    });
    for (const edit of edits) {
      expect(edit.nudgeDelta).to.be.closeTo(0, 1e-9);
    }
  });

  it("declines when the segment has no Tunni point", () => {
    expect(
      calculateGeneratedOnCurveEdits({
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

  it("declines rather than guessing when a rib end has no provenance", () => {
    expect(
      calculateGeneratedOnCurveEdits({
        segmentPoints,
        provenance: [null, provenance[1], provenance[2], provenance[3]],
        delta: { x: 5, y: 5 },
      })
    ).to.equal(null);
  });
});
