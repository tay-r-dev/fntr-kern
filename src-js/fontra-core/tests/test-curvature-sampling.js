import {
  adjustStepsForCurve,
  calculateSegmentBudget,
  collectCurveRuns,
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

describe("collectCurveRuns", () => {
  const twoCubics = (smooth) =>
    VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 60, type: "cubic" },
          { x: 60, y: 100, type: "cubic" },
          { x: 160, y: 100, smooth },
          { x: 200, y: 100, type: "cubic" },
          { x: 240, y: 93.6, type: "cubic" },
          { x: 250, y: 40 },
        ],
        isClosed: false,
      },
    ]);

  it("joins two curves at a smooth point", () => {
    const runs = collectCurveRuns(twoCubics(true));
    expect(runs).to.have.lengthOf(1);
    expect(runs[0]).to.have.lengthOf(2);
  });

  it("breaks the run at a corner", () => {
    const runs = collectCurveRuns(twoCubics(false));
    expect(runs).to.have.lengthOf(2);
  });

  it("breaks the run at a line", () => {
    const curveLineCurve = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 60, type: "cubic" },
          { x: 60, y: 100, type: "cubic" },
          { x: 160, y: 100, smooth: true },
          { x: 260, y: 100, smooth: true },
          { x: 300, y: 100, type: "cubic" },
          { x: 340, y: 60, type: "cubic" },
          { x: 340, y: 0 },
        ],
        isClosed: false,
      },
    ]);
    expect(collectCurveRuns(curveLineCurve)).to.have.lengthOf(2);
  });

  it("closes a run around a closed contour", () => {
    const ring = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: -100, smooth: true },
          { x: 55, y: -100, type: "cubic" },
          { x: 100, y: -55, type: "cubic" },
          { x: 100, y: 0, smooth: true },
          { x: 100, y: 55, type: "cubic" },
          { x: 55, y: 100, type: "cubic" },
          { x: 0, y: 100, smooth: true },
          { x: -55, y: 100, type: "cubic" },
          { x: -100, y: 55, type: "cubic" },
          { x: -100, y: 0, smooth: true },
          { x: -100, y: -55, type: "cubic" },
          { x: -55, y: -100, type: "cubic" },
        ],
        isClosed: true,
      },
    ]);
    const runs = collectCurveRuns(ring);
    expect(runs).to.have.lengthOf(1);
    expect(runs[0]).to.have.lengthOf(4);
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

  it("draws one height for one curvature across a smooth joint", () => {
    // Two cubics meeting smoothly at (160, 100) with equal curvature on both
    // sides, and very different peaks of their own: 0.0111 on the first, 0.0086
    // on the second. Per-segment normalization draws the joint at 0.24 of full
    // height from the left and 0.31 from the right.
    const twoCubics = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 60, type: "cubic" },
          { x: 60, y: 100, type: "cubic" },
          { x: 160, y: 100, smooth: true },
          { x: 200, y: 100, type: "cubic" },
          { x: 240, y: 93.6, type: "cubic" },
          { x: 250, y: 40 },
        ],
        isClosed: false,
      },
    ]);
    const quads = computeSpeedPunkSamples(twoCubics, {
      peakHeightGlyphUnits: 24,
      sharpness: 1,
      baseSegmentBudget: 40,
      minSegmentsPerCurve: 5,
      zoomFactor: 1,
    });

    const atJoint = (quad) =>
      quad.points.findIndex(([x, y]) => Math.abs(x - 160) < 1e-6 && y === 100);
    const heights = [];
    for (const quad of quads) {
      const onCurveIndex = atJoint(quad);
      if (onCurveIndex < 0 || onCurveIndex > 1) {
        continue;
      }
      // point i is the on-curve sample, point 3-i its own fringe tip
      const [x0, y0] = quad.points[onCurveIndex];
      const [x1, y1] = quad.points[3 - onCurveIndex];
      heights.push(Math.hypot(x1 - x0, y1 - y0));
    }

    expect(heights).to.have.lengthOf(2);
    expect(heights[0]).to.be.greaterThan(0);
    expect(heights[1]).to.be.closeTo(heights[0], 1e-9);
  });

  it("draws one colour for one curvature across a smooth joint", () => {
    // The top of `_external/N^1.json`, contour points 0 to 6, layer 5daac8f8.
    // The two curvatures at the joint agree to 0.29 per cent, and the joint is
    // the flattest place on the segment arriving at it — so a per-segment
    // colour range paints it the bottom of the scale from that side (t = 0.000)
    // and a third of the way up from the other (t = 0.362).
    const twoCubics = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 680, y: 410 },
          { x: 680, y: 579, type: "cubic" },
          { x: 526, y: 706, type: "cubic" },
          { x: 350, y: 706, smooth: true },
          { x: 159, y: 706, type: "cubic" },
          { x: 32, y: 556, type: "cubic" },
          { x: 32, y: 367 },
        ],
        isClosed: false,
      },
    ]);
    const quads = computeSpeedPunkSamples(twoCubics, {
      baseSegmentBudget: 40,
      minSegmentsPerCurve: 5,
      zoomFactor: 1,
    });

    const channels = quads
      .filter((quad) => {
        const index = quad.points.findIndex(
          ([x, y]) => Math.abs(x - 350) < 1e-6 && y === 706
        );
        return index === 0 || index === 1;
      })
      .map((quad) => quad.color.match(/\d+/g).slice(0, 3).map(Number));

    expect(channels).to.have.lengthOf(2);
    // A quad is painted by its own leading sample, so the two are one sample
    // apart and never identical. They must not be two different colours.
    for (let i = 0; i < 3; i++) {
      expect(channels[1][i]).to.be.closeTo(channels[0][i], 4);
    }
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
