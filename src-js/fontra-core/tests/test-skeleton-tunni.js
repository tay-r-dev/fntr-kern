import {
  areSkeletonTensionsEqualized,
  buildGeneratedTunniSegments,
  buildSkeletonTunniSegments,
  calculateGeneratedCurvatureEdits,
  calculateGeneratedOnCurveEdits,
  calculateGeneratedOnCurveGizmoPoint,
  calculateSkeletonControlPointsFromTunniDelta,
  calculateSkeletonEqualizedControlPoints,
  calculateSkeletonOnCurveFromTunni,
  calculateSkeletonTrueTunniPoint,
  calculateSkeletonTunniPoint,
  generatedTunniHitTest,
  getGeneratedPathContourIndices,
  getSkeletonData,
  getSkeletonPointNudge,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  segmentToTunniPoints,
  setSkeletonData,
  setSkeletonPointSideNudge,
  skeletonTunniHitTest,
} from "@fontra/core/skeleton-model.js";
import {
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoAxis,
  calculateCurvatureGizmoPoint,
  calculateSegmentTension,
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

  it("addresses the skeleton segment's start point, from provenance", () => {
    expect(drag(10)).to.include({
      segmentPointIndex: 0,
      skeletonPointId: 2,
      side: "left",
    });
  });

  it("reports the segment tension the drag arrives at", () => {
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis().x * 10, y: axis().y * 10 },
      segmentPoints
    );
    expect(drag(10).tension).to.be.closeTo(
      calculateSegmentTension(moved[0], segmentPoints[0], moved[1], segmentPoints[3]),
      1e-9
    );
  });

  it("reports the segment's current tension for a drag that goes nowhere", () => {
    expect(drag(0).tension).to.be.closeTo(
      calculateSegmentTension(
        segmentPoints[1],
        segmentPoints[0],
        segmentPoints[2],
        segmentPoints[3]
      ),
      1e-9
    );
  });

  it("stores construction-space tension when rendered ends carry nudges", () => {
    const constructionPoints = segmentPoints;
    const nudgedProvenance = provenance.map((entry, index) =>
      index === 0
        ? { ...entry, nudge: { x: 12, y: -4 } }
        : index === 3
          ? { ...entry, nudge: { x: -7, y: 5 } }
          : entry
    );
    const renderedPoints = constructionPoints.map((point, index) => ({
      x: point.x + (nudgedProvenance[index].nudge?.x ?? 0),
      y: point.y + (nudgedProvenance[index].nudge?.y ?? 0),
    }));
    const edit = calculateGeneratedCurvatureEdits({
      segmentPoints: renderedPoints,
      provenance: nudgedProvenance,
      delta: { x: 0, y: 0 },
    });
    expect(edit.tension).to.be.closeTo(
      calculateSegmentTension(
        constructionPoints[1],
        constructionPoints[0],
        constructionPoints[2],
        constructionPoints[3]
      ),
      1e-9
    );
  });

  it("pins a fuller curve for a drag toward the Tunni point", () => {
    expect(drag(10).tension).to.be.above(drag(0).tension);
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

  it("works on a contour that runs backwards, where the roles swap", () => {
    // The right-side generated contour is emitted in reverse, so its segments
    // carry "in" first and "out" second. That is an orientation, not a defect,
    // and the control must not refuse it.
    const reversed = [
      { skeletonPointId: 2, side: "right", role: "onCurve" },
      { skeletonPointId: 2, side: "right", role: "in" },
      { skeletonPointId: 5, side: "right", role: "out" },
      { skeletonPointId: 5, side: "right", role: "onCurve" },
    ];
    const edit = calculateGeneratedCurvatureEdits({
      segmentPoints,
      provenance: reversed,
      delta: { x: axis().x * 10, y: axis().y * 10 },
    });
    // Index 3, not 0: on the reversed side the skeleton segment's start is the
    // segment's LAST point. Both sides of one skeleton segment must land on the
    // same skeleton point, or the two sides pin independently and drift.
    expect(edit).to.include({
      segmentPointIndex: 3,
      skeletonPointId: 5,
      side: "right",
    });
    expect(edit.tension).to.be.above(0);
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
    expect(drag(5000).tension).to.be.at.most(1 + 1e-9);
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
    const hit = generatedTunniHitTest(anchor, 4, skeletonData, layer.path, {
      includeOnCurve: false,
    });
    expect(hit?.type).to.equal("generated-curvature");
    expect(hit.gizmoPoint.x).to.be.closeTo(anchor.x, 1e-9);
    expect(hit.gizmoPoint.y).to.be.closeTo(anchor.y, 1e-9);
  });

  it("hits the on-curve gizmo at its outside placement", () => {
    const layer = makeGlyph();
    const skeletonData = getSkeletonData(layer);
    const [segment] = buildGeneratedTunniSegments(skeletonData, layer.path);
    const gizmoPoint = calculateGeneratedOnCurveGizmoPoint(segment, 24);
    const hit = generatedTunniHitTest(gizmoPoint, 4, skeletonData, layer.path, {
      onCurveOffset: 24,
    });
    expect(hit?.type).to.equal("generated-on-curve");
  });

  it("places the on-curve gizmo away from the curve by its supplied offset", () => {
    const layer = makeGlyph();
    const skeletonData = getSkeletonData(layer);
    const [segment] = buildGeneratedTunniSegments(skeletonData, layer.path);
    const midpoint = calculateCurvatureGizmoPoint(segment.points);
    const hit = generatedTunniHitTest(midpoint, 100, skeletonData, layer.path, {
      includeCurvature: false,
      onCurveOffset: 24,
    });
    expect(hit?.type).to.equal("generated-on-curve");
    expect(
      Math.hypot(hit.gizmoPoint.x - midpoint.x, hit.gizmoPoint.y - midpoint.y)
    ).to.be.closeTo(24, 1e-9);
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

describe("generated on-curve gizmo eligibility", () => {
  it("does not expose a control when both far skeleton segments are curves", () => {
    const path = new VarPackedPath();
    path.moveTo(0, 0);
    path.cubicCurveTo(20, 80, 80, 80, 100, 0);
    path.cubicCurveTo(120, -80, 180, -80, 200, 0);
    path.cubicCurveTo(220, 80, 280, 80, 300, 0);

    const ids = [1, 2, 3, 4];
    const skeletonData = {
      contours: [
        {
          id: 71,
          closed: false,
          points: [
            { id: ids[0], x: 0, y: 0 },
            { id: 11, x: 20, y: 80, type: "cubic" },
            { id: 12, x: 80, y: 80, type: "cubic" },
            { id: ids[1], x: 100, y: 0 },
            { id: 13, x: 120, y: -80, type: "cubic" },
            { id: 14, x: 180, y: -80, type: "cubic" },
            { id: ids[2], x: 200, y: 0 },
            { id: 15, x: 220, y: 80, type: "cubic" },
            { id: 16, x: 280, y: 80, type: "cubic" },
            { id: ids[3], x: 300, y: 0 },
          ],
        },
      ],
      generated: [
        {
          skeletonContourId: 71,
          pathContourIndex: 0,
          pointMap: [
            {
              skeletonContourId: 71,
              skeletonPointId: 1,
              side: "left",
              role: "onCurve",
            },
            { skeletonContourId: 71, skeletonPointId: 1, side: "left", role: "out" },
            { skeletonContourId: 71, skeletonPointId: 2, side: "left", role: "in" },
            {
              skeletonContourId: 71,
              skeletonPointId: 2,
              side: "left",
              role: "onCurve",
            },
            { skeletonContourId: 71, skeletonPointId: 2, side: "left", role: "out" },
            { skeletonContourId: 71, skeletonPointId: 3, side: "left", role: "in" },
            {
              skeletonContourId: 71,
              skeletonPointId: 3,
              side: "left",
              role: "onCurve",
            },
            { skeletonContourId: 71, skeletonPointId: 3, side: "left", role: "out" },
            { skeletonContourId: 71, skeletonPointId: 4, side: "left", role: "in" },
            {
              skeletonContourId: 71,
              skeletonPointId: 4,
              side: "left",
              role: "onCurve",
            },
          ],
        },
      ],
    };
    const segment = buildGeneratedTunniSegments(skeletonData, path)[1];
    const truePoint = calculateTunniPoint(segment.points);

    expect(generatedTunniHitTest(truePoint, 0.1, skeletonData, path)).to.equal(null);
  });
});

// The on-curve gizmo's writes: two nudges, tangent-constrained (D12).
//
// The drag reads in ABSOLUTE coordinates, never in the gizmo's own frame: up or
// right spreads the two on-curve points apart along their generated curves,
// down or left brings them together. Handle lengths are untouched - the nudge
// carries each handle with its point - so the curve keeps its shape and only
// its extent changes.
describe("generated on-curve gizmo edits", () => {
  const segmentPoints = [
    { x: 0, y: 0 },
    { x: 20, y: 80 },
    { x: 160, y: 60 },
    { x: 200, y: 0 },
  ];
  // Left side: the segment runs with the skeleton, so its first handle is "out".
  const provenance = [
    { skeletonPointId: 2, side: "left", role: "onCurve" },
    { skeletonPointId: 2, side: "left", role: "out" },
    { skeletonPointId: 5, side: "left", role: "in" },
    { skeletonPointId: 5, side: "left", role: "onCurve" },
  ];
  // Right side: the generated contour runs backwards, so the roles swap.
  const reversedProvenance = [
    { skeletonPointId: 2, side: "right", role: "onCurve" },
    { skeletonPointId: 2, side: "right", role: "in" },
    { skeletonPointId: 5, side: "right", role: "out" },
    { skeletonPointId: 5, side: "right", role: "onCurve" },
  ];
  const drag = (delta, prov = provenance, points = segmentPoints) =>
    calculateGeneratedOnCurveEdits({ segmentPoints: points, provenance: prov, delta });
  // Positive means "this end moved away from the other one", whichever way the
  // stored nudge axis happens to point.
  const spread = (edits, prov = provenance) => {
    const orientation = prov[1].role === "out" ? 1 : -1;
    return [-edits[0].nudgeDelta * orientation, edits[1].nudgeDelta * orientation];
  };

  it("addresses both rib ends by their own provenance", () => {
    const edits = drag({ x: 0, y: 20 });
    expect(edits).to.have.length(2);
    expect(edits[0]).to.include({ skeletonPointId: 2, side: "left", role: "onCurve" });
    expect(edits[1]).to.include({ skeletonPointId: 5, side: "left", role: "onCurve" });
  });

  it("reports a scalar nudge, never a free displacement", () => {
    for (const edit of drag({ x: 7, y: 13 })) {
      expect(edit.nudgeDelta).to.be.a("number");
      expect(Number.isFinite(edit.nudgeDelta)).to.equal(true);
      expect(edit).to.not.have.property("displacement");
      expect(edit).to.not.have.property("handleCompensation");
    }
  });

  it("spreads the points apart when the cursor goes right", () => {
    const [start, end] = spread(drag({ x: 20, y: 0 }));
    expect(start).to.be.above(0);
    expect(end).to.be.above(0);
  });

  it("spreads them apart when the cursor goes up", () => {
    const [start, end] = spread(drag({ x: 0, y: 20 }));
    expect(start).to.be.above(0);
    expect(end).to.be.above(0);
  });

  it("draws them together when the cursor goes left or down", () => {
    for (const delta of [
      { x: -20, y: 0 },
      { x: 0, y: -20 },
    ]) {
      const [start, end] = spread(drag(delta));
      expect(start).to.be.below(0);
      expect(end).to.be.below(0);
    }
  });

  it("adds up and right rather than letting them cancel", () => {
    const right = spread(drag({ x: 20, y: 0 }))[0];
    const both = spread(drag({ x: 20, y: 20 }))[0];
    expect(both).to.be.above(right);
  });

  it("reads the drag in absolute coordinates, not the segment's frame", () => {
    // Same absolute drag, segment rotated 90 degrees: the response must not
    // change, or the control would mean something different per segment.
    const rotated = segmentPoints.map((p) => ({ x: -p.y, y: p.x }));
    const flat = spread(drag({ x: 15, y: 15 }));
    const turned = spread(drag({ x: 15, y: 15 }, provenance, rotated));
    expect(turned[0]).to.be.closeTo(flat[0], 1e-9);
    expect(turned[1]).to.be.closeTo(flat[1], 1e-9);
  });

  it("spreads the same way on a contour that runs backwards", () => {
    const forward = spread(drag({ x: 20, y: 20 }));
    const backward = spread(
      drag({ x: 20, y: 20 }, reversedProvenance),
      reversedProvenance
    );
    expect(backward[0]).to.be.closeTo(forward[0], 1e-9);
    expect(backward[1]).to.be.closeTo(forward[1], 1e-9);
  });

  it("stays put for a drag that goes nowhere", () => {
    for (const edit of drag({ x: 0, y: 0 })) {
      expect(edit.nudgeDelta).to.be.closeTo(0, 1e-9);
    }
  });

  it("moves only the eligible end when the other end holds", () => {
    const edits = calculateGeneratedOnCurveEdits({
      segmentPoints,
      provenance,
      delta: { x: 20, y: 20 },
      movable: [false, true],
    });
    expect(edits[0].nudgeDelta).to.equal(0);
    expect(spread(edits)[1]).to.be.above(0);
  });

  it("declines the drag when neither end is eligible", () => {
    expect(
      calculateGeneratedOnCurveEdits({
        segmentPoints,
        provenance,
        delta: { x: 20, y: 20 },
        movable: [false, false],
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

// End-to-end: an on-curve drag must slide the rib ends along the outline and
// leave the handles where they are. Dragging the point and its handles together
// slides the whole curve bodily, which is not what the control is for.
describe("generated on-curve gizmo, through the generator", () => {
  const points = [
    makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
    makeSkeletonPoint({ id: 2, x: 30, y: 40, type: "cubic" }),
    makeSkeletonPoint({ id: 3, x: 70, y: 40, type: "cubic" }),
    makeSkeletonPoint({ id: 4, x: 100, y: 0, smooth: true }),
    makeSkeletonPoint({ id: 5, x: 130, y: -40, type: "cubic" }),
    makeSkeletonPoint({ id: 6, x: 170, y: -40, type: "cubic" }),
    makeSkeletonPoint({ id: 7, x: 200, y: 0 }),
  ];

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
        contours: [makeSkeletonContour({ id: 80, defaultWidth: 80, points })],
      })
    );
    editSkeleton(layer, () => {});
    return layer;
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function dragFirstSegment(delta) {
    const layer = makeGlyph();
    const before = buildGeneratedTunniSegments(getSkeletonData(layer), layer.path)[0];
    const snapshot = before.points.map((p) => ({ x: p.x, y: p.y }));
    const edits = calculateGeneratedOnCurveEdits({
      segmentPoints: before.points,
      provenance: before.provenance,
      delta,
    });
    editSkeleton(layer, (working) => {
      const contour = working.contours[0];
      for (const edit of edits) {
        const point = contour.points.find((p) => p.id === edit.skeletonPointId);
        setSkeletonPointSideNudge(
          point,
          edit.side,
          getSkeletonPointNudge(point, edit.side, contour.defaultWidth) +
            edit.nudgeDelta,
          { round: (v) => v }
        );
      }
    });
    const after = buildGeneratedTunniSegments(getSkeletonData(layer), layer.path).find(
      (s) =>
        s.pathContourIndex === before.pathContourIndex &&
        s.segmentIndex === before.segmentIndex
    );
    return { snapshot, after: after.points };
  }

  it("moves the rib ends", () => {
    const { snapshot, after } = dragFirstSegment({ x: 20, y: 20 });
    expect(dist(snapshot[0], after[0])).to.be.above(5);
    expect(dist(snapshot[3], after[3])).to.be.above(5);
  });

  it("leaves the handles where they were", () => {
    const { snapshot, after } = dragFirstSegment({ x: 20, y: 20 });
    expect({ x: after[1].x, y: after[1].y }).to.deep.equal(snapshot[1]);
    expect({ x: after[2].x, y: after[2].y }).to.deep.equal(snapshot[2]);
  });

  it("holds the handles still in the other direction too", () => {
    const { snapshot, after } = dragFirstSegment({ x: -20, y: -20 });
    expect({ x: after[1].x, y: after[1].y }).to.deep.equal(snapshot[1]);
    expect({ x: after[2].x, y: after[2].y }).to.deep.equal(snapshot[2]);
  });
});
