import {
  adjustStepsForCurve,
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

  const ringOfRadius = (radius, pull = 1) => {
    const k = 0.5523 * radius; // a cubic circle approximation
    return VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 0, y: -radius, smooth: true },
          { x: k, y: -radius, type: "cubic" },
          { x: radius, y: -k, type: "cubic" },
          { x: radius, y: 0, smooth: true },
          // the pull factor tightens this one quadrant and leaves the rest alone
          { x: radius, y: k * pull, type: "cubic" },
          { x: k * pull, y: radius, type: "cubic" },
          { x: 0, y: radius, smooth: true },
          { x: -k, y: radius, type: "cubic" },
          { x: -radius, y: k, type: "cubic" },
          { x: -radius, y: 0, smooth: true },
          { x: -radius, y: -k, type: "cubic" },
          { x: -k, y: -radius, type: "cubic" },
        ],
        isClosed: true,
      },
    ]);
  };

  const fringeHeights = (quads) =>
    quads.map((q) =>
      Math.hypot(q.points[3][0] - q.points[0][0], q.points[3][1] - q.points[0][1])
    );

  it("draws the peak height at the reference radius", () => {
    // A circle of radius R has curvature 1/R everywhere, so at a reference
    // radius of R every fringe is exactly the peak height.
    const quads = computeSpeedPunkSamples(ringOfRadius(100), {
      peakHeightGlyphUnits: 24,
      referenceRadiusGlyphUnits: 100,
      sharpness: 1,
      baseSegmentBudget: 400,
      zoomFactor: 1,
    });
    for (const height of fringeHeights(quads)) {
      // 3 per cent, which is the cubic circle approximation's own curvature
      // ripple, not the scale's error
      expect(height).to.be.closeTo(24, 24 * 0.03);
    }
  });

  it("halves the fringe when the radius doubles", () => {
    const quads = computeSpeedPunkSamples(ringOfRadius(200), {
      peakHeightGlyphUnits: 24,
      referenceRadiusGlyphUnits: 100,
      sharpness: 1,
      baseSegmentBudget: 400,
      zoomFactor: 1,
    });
    for (const height of fringeHeights(quads)) {
      expect(height).to.be.closeTo(12, 12 * 0.03);
    }
  });

  it("leaves a segment's fringe alone when a neighbour changes", () => {
    const options = {
      peakHeightGlyphUnits: 24,
      referenceRadiusGlyphUnits: 100,
      sharpness: 1,
      baseSegmentBudget: 400,
      zoomFactor: 1,
    };
    // The untouched quadrant runs from (0, -100) to (100, 0). Both of its own
    // end points are excluded, because the joint at (100, 0) also leads the
    // first quad of the quadrant that does change.
    const untouchedQuadrant = (path) =>
      fringeHeights(
        computeSpeedPunkSamples(path, options).filter(
          (q) => q.points[0][0] > 1e-9 && q.points[0][1] < -1e-9
        )
      );

    const asDrawn = untouchedQuadrant(ringOfRadius(100));
    const neighbourTightened = untouchedQuadrant(ringOfRadius(100, 0.5));

    expect(asDrawn.length).to.be.greaterThan(10);
    expect(neighbourTightened).to.have.lengthOf(asDrawn.length);
    for (let i = 0; i < asDrawn.length; i++) {
      expect(neighbourTightened[i]).to.be.closeTo(asDrawn[i], 1e-9);
    }
  });

  const STOPS = ["#8b939c", "#f29400", "#e3004f"];
  const channelsOf = (quads) =>
    quads.map((q) => q.color.match(/\d+/g).slice(0, 3).map(Number));
  const expectAllNear = (quads, hex) => {
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const got of channelsOf(quads)) {
      for (let i = 0; i < 3; i++) {
        expect(got[i]).to.be.closeTo(want[i], 6);
      }
    }
  };

  const COLOUR_RAMP = {
    colorFlatRadiusGlyphUnits: 400,
    colorTightRadiusGlyphUnits: 100,
    colorStops: STOPS,
    baseSegmentBudget: 400,
    zoomFactor: 1,
  };

  it("paints the colour stops at the named radii", () => {
    // The two ends are named outright. The middle stop falls on their geometric
    // mean, because the ramp is geometric in radius.
    expectAllNear(computeSpeedPunkSamples(ringOfRadius(400), COLOUR_RAMP), STOPS[0]);
    expectAllNear(computeSpeedPunkSamples(ringOfRadius(200), COLOUR_RAMP), STOPS[1]);
    expectAllNear(computeSpeedPunkSamples(ringOfRadius(100), COLOUR_RAMP), STOPS[2]);
  });

  it("pins the colour past either end of the ramp", () => {
    expectAllNear(computeSpeedPunkSamples(ringOfRadius(2000), COLOUR_RAMP), STOPS[0]);
    expectAllNear(computeSpeedPunkSamples(ringOfRadius(20), COLOUR_RAMP), STOPS[2]);
  });

  it("does not move the colour ramp when the height anchor changes", () => {
    const ring = ringOfRadius(200);
    const near = computeSpeedPunkSamples(ring, {
      ...COLOUR_RAMP,
      referenceRadiusGlyphUnits: 50,
    });
    const far = computeSpeedPunkSamples(ring, {
      ...COLOUR_RAMP,
      referenceRadiusGlyphUnits: 900,
    });
    expect(channelsOf(far)).to.deep.equal(channelsOf(near));
  });

  it("leaves a segment's colour alone when a neighbour changes", () => {
    const options = COLOUR_RAMP;
    const untouchedQuadrant = (path) =>
      channelsOf(
        computeSpeedPunkSamples(path, options).filter(
          (q) => q.points[0][0] > 1e-9 && q.points[0][1] < -1e-9
        )
      );

    const asDrawn = untouchedQuadrant(ringOfRadius(100));
    const neighbourTightened = untouchedQuadrant(ringOfRadius(100, 0.5));

    expect(asDrawn.length).to.be.greaterThan(10);
    expect(neighbourTightened).to.deep.equal(asDrawn);
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
