import {
  adjustStepsForCurve,
  calculateCurvatureForSegment,
  calculateSegmentBudget,
  computeSpeedPunkSamples,
  countCurveSegments,
  estimateCurveLength,
} from "@fontra/core/curvature.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

describe("curvature sampling helpers", () => {
  it("calculateSegmentBudget divides budget across curves, respecting the minimum", () => {
    expect(calculateSegmentBudget(4, 1, 400, 5)).to.equal(100);
    expect(calculateSegmentBudget(1000, 1, 400, 5)).to.equal(5);
  });

  it("estimateCurveLength sums the control polygon (cubic and quadratic)", () => {
    expect(estimateCurveLength([0, 0], [0, 10], [10, 10], [10, 0])).to.equal(30);
    expect(estimateCurveLength([0, 0], [5, 10], [10, 0])).to.be.closeTo(22.3607, 1e-3);
  });

  it("adjustStepsForCurve scales by length ratio, clamped to maxAdjustment", () => {
    expect(adjustStepsForCurve(100, 30, 30)).to.equal(100);
    expect(adjustStepsForCurve(100, 60, 30, 2)).to.equal(200);
    expect(adjustStepsForCurve(100, 10, 30, 2)).to.equal(50);
    expect(adjustStepsForCurve(100, 30, 0)).to.equal(100);
  });

  it("countCurveSegments counts cubic and quadratic on/off-curve runs", () => {
    const empty = new VarPackedPath();
    expect(countCurveSegments(empty)).to.equal(0);

    const oneCubic = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 30, type: "cubic" },
          { x: 20, y: 30, type: "cubic" },
          { x: 30, y: 0 },
        ],
        isClosed: true,
      },
    ]);
    expect(countCurveSegments(oneCubic)).to.equal(1);
  });
});

describe("computeSpeedPunkSamples", () => {
  const cubicPath = VarPackedPath.fromUnpackedContours([
    {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100, type: "cubic" },
        { x: 100, y: 100, type: "cubic" },
        { x: 100, y: 0 },
      ],
      isClosed: true,
    },
  ]);

  it("returns drawable quads for a curved segment", () => {
    const quads = computeSpeedPunkSamples(cubicPath, {
      peakHeightGlyphUnits: 24,
      sharpness: 1,
      baseSegmentBudget: 40,
      minSegmentsPerCurve: 5,
      zoomFactor: 1,
    });
    expect(quads.length).to.be.greaterThan(0);
    for (const quad of quads) {
      expect(quad.points).to.have.lengthOf(4);
      for (const [x, y] of quad.points) {
        expect(Number.isFinite(x)).to.equal(true);
        expect(Number.isFinite(y)).to.equal(true);
      }
      expect(quad.color).to.match(/^rgba?\(/);
    }
  });

  it("scales comb height with peakHeightGlyphUnits", () => {
    const small = computeSpeedPunkSamples(cubicPath, {
      peakHeightGlyphUnits: 10,
      baseSegmentBudget: 40,
      zoomFactor: 1,
    });
    const big = computeSpeedPunkSamples(cubicPath, {
      peakHeightGlyphUnits: 100,
      baseSegmentBudget: 40,
      zoomFactor: 1,
    });
    const outsideGlyphBox = (quads) =>
      Math.max(
        ...quads.flatMap((q) =>
          q.points.map(([x, y]) => Math.max(0 - x, x - 100, 0 - y, y - 100, 0))
        )
      );
    expect(outsideGlyphBox(big)).to.be.greaterThan(outsideGlyphBox(small));
  });

  it("returns an empty array for a path with no curves", () => {
    const lineOnly = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        isClosed: true,
      },
    ]);
    expect(computeSpeedPunkSamples(lineOnly, {})).to.deep.equal([]);
  });
});

// --- one height scale for the whole glyph -----------------------------------
//
// The fringe used to be scaled to its own segment's tallest point, so the same
// curvature drew a different length on either side of a joint whenever the two
// segments peaked at different heights. A comb that reports a step where the
// curve has none cannot be used to judge continuity, which is the only thing it
// is for.
describe("curvature comb: one height scale for the whole glyph", () => {
  // Two cubics meeting at (100, 0). The first bulges much harder in its middle
  // than the second, so the two segments peak far apart.
  const JOINT = [
    { x: 0, y: 0 },
    { x: 20, y: 90, type: "cubic" },
    { x: 80, y: 40, type: "cubic" },
    { x: 100, y: 0, smooth: true },
    { x: 120, y: -40, type: "cubic" },
    { x: 180, y: -55, type: "cubic" },
    { x: 200, y: 0 },
  ];

  function unequalPeaks() {
    return VarPackedPath.fromUnpackedContours([
      { points: JOINT.map((p) => ({ ...p })), isClosed: false },
    ]);
  }

  // Fringe length is the distance from each outline point to its own outer
  // point, which is what the drawing puts on screen.
  function fringeLengths(path, peakHeightGlyphUnits = 24) {
    return computeSpeedPunkSamples(path, {
      peakHeightGlyphUnits,
      illustrationPosition: "outsideOfCurve",
    }).map(({ points: [onCurve, , , outer] }) =>
      Math.hypot(outer[0] - onCurve[0], outer[1] - onCurve[1])
    );
  }

  function segmentPeakCurvature(points) {
    const quad = points.map(({ x, y }) => [x, y]);
    return Math.max(
      ...calculateCurvatureForSegment(...quad, 40).map((s) => Math.abs(s.curvature))
    );
  }

  it("scales every fringe by the same curvature, whichever segment it is on", () => {
    const first = segmentPeakCurvature(JOINT.slice(0, 4));
    const second = segmentPeakCurvature(JOINT.slice(3));
    // The fixture is only meaningful while the two segments peak apart.
    expect(Math.max(first, second) / Math.min(first, second)).to.be.greaterThan(1.5);

    const lengths = fringeLengths(unequalPeaks());
    const half = Math.floor(lengths.length / 2);
    const drawnFirst = Math.max(...lengths.slice(0, half));
    const drawnSecond = Math.max(...lengths.slice(half));

    // Each segment's tallest fringe is now in proportion to its own peak
    // curvature. A per-segment scale would draw both at the full height.
    expect(drawnFirst / drawnSecond).to.be.closeTo(first / second, 0.05);
  });

  it("gives the tallest fringe in the glyph the full height", () => {
    const lengths = fringeLengths(unequalPeaks());
    expect(Math.max(...lengths)).to.be.closeTo(24, 0.5);
  });

  it("holds that scale when only one segment is redrawn", () => {
    // Flattening the second segment must not lengthen the first one's fringe.
    const before = fringeLengths(unequalPeaks());
    const flattened = JOINT.map((p) => ({ ...p }));
    flattened[5] = { x: 180, y: -20, type: "cubic" };
    const after = fringeLengths(
      VarPackedPath.fromUnpackedContours([{ points: flattened, isClosed: false }])
    );
    const half = Math.floor(before.length / 2);
    expect(Math.max(...after.slice(0, half))).to.be.closeTo(
      Math.max(...before.slice(0, half)),
      0.5
    );
  });
});
