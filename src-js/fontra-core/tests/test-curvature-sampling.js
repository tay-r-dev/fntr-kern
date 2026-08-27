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

  // A ring cut into `count` equal cubic arcs. Every segment turns through
  // 360/count degrees whatever the radius, so this is how a named turn is
  // reached in a test: the shape states the turn, and the size states nothing.
  const ringInSegments = (count, radius = 100) => {
    const step = (2 * Math.PI) / count;
    // the standard handle length for a circular arc of this angle
    const k = ((4 / 3) * Math.tan(step / 4)) / 1;
    const points = [];
    for (let i = 0; i < count; i++) {
      const a = i * step;
      const b = a + step;
      const at = (angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];
      const tangent = (angle) => [
        -radius * Math.sin(angle) * k,
        radius * Math.cos(angle) * k,
      ];
      const [ax, ay] = at(a);
      const [atx, aty] = tangent(a);
      const [bx, by] = at(b);
      const [btx, bty] = tangent(b);
      points.push({ x: ax, y: ay, smooth: true });
      points.push({ x: ax + atx, y: ay + aty, type: "cubic" });
      points.push({ x: bx - btx, y: by - bty, type: "cubic" });
    }
    return VarPackedPath.fromUnpackedContours([{ points, isClosed: true }]);
  };

  const fringeHeights = (quads) =>
    quads.map((q) =>
      Math.hypot(q.points[3][0] - q.points[0][0], q.points[3][1] - q.points[0][1])
    );

  const HEIGHT = {
    peakHeightGlyphUnits: 24,
    referenceTurnDegrees: 90,
    sharpness: 1,
    baseSegmentBudget: 400,
    zoomFactor: 1,
  };

  it("draws the peak height on a circle drawn in quadrants", () => {
    // A circle drawn as four cubic quadrants turns through 90 degrees per
    // segment. At a reference turn of 90 every fringe is the peak height.
    for (const height of fringeHeights(
      computeSpeedPunkSamples(ringOfRadius(100), HEIGHT)
    )) {
      // 3 per cent, which is the cubic circle approximation's own curvature
      // ripple, not the scale's error
      expect(height).to.be.closeTo(24, 24 * 0.03);
    }
  });

  it("draws the same fringe at every radius, because a circle is a circle", () => {
    // This is the whole of the readout. Curvature carries one over length, so an
    // absolute reading of it reports size. The turn does not, so scaling the
    // drawing does not move the comb.
    const small = fringeHeights(computeSpeedPunkSamples(ringOfRadius(50), HEIGHT));
    const large = fringeHeights(computeSpeedPunkSamples(ringOfRadius(800), HEIGHT));
    expect(small).to.have.lengthOf(large.length);
    for (let i = 0; i < small.length; i++) {
      expect(large[i]).to.be.closeTo(small[i], 1e-6);
    }
  });

  it("leaves a segment's fringe alone beyond its immediate neighbours", () => {
    // The normalizer is the mean of the segments meeting at each on-curve, so a
    // redrawn segment reaches the two beside it and nothing further. The
    // tightened quadrant here runs from (100, 0) to (0, 100); the quadrant
    // measured is the opposite one, from (-100, 0) to (0, -100).
    const oppositeQuadrant = (path) =>
      fringeHeights(
        computeSpeedPunkSamples(path, HEIGHT).filter(
          (q) => q.points[0][0] < -1e-9 && q.points[0][1] < -1e-9
        )
      );

    const asDrawn = oppositeQuadrant(ringOfRadius(100));
    const neighbourTightened = oppositeQuadrant(ringOfRadius(100, 0.5));

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

  // A quadrant ring turns 90 degrees per segment, which this ramp puts exactly
  // on the middle stop, so these tests read a colour that can still move either
  // way rather than one pinned at an end.
  const COLOUR_RAMP = {
    colorFlatTurnDegrees: 22.5,
    colorTightTurnDegrees: 360,
    colorStops: STOPS,
    baseSegmentBudget: 400,
    zoomFactor: 1,
  };

  // The stops land on 22.5, 45 and 90 degrees, which are the turns of a ring cut
  // into 16, 8 and 4 arcs. A ring is the only shape holding one turn the whole
  // way round, and a cubic stops approximating an arc well below about three
  // segments, so the ends are reached by cutting the ring rather than by naming
  // a wider ramp.
  const STOPS_RAMP = {
    ...COLOUR_RAMP,
    colorFlatTurnDegrees: 22.5,
    colorTightTurnDegrees: 90,
  };

  it("paints the colour stops at the named turns", () => {
    expectAllNear(computeSpeedPunkSamples(ringInSegments(16), STOPS_RAMP), STOPS[0]);
    expectAllNear(computeSpeedPunkSamples(ringInSegments(8), STOPS_RAMP), STOPS[1]);
    expectAllNear(computeSpeedPunkSamples(ringInSegments(4), STOPS_RAMP), STOPS[2]);
  });

  it("pins the colour past either end of the ramp", () => {
    expectAllNear(computeSpeedPunkSamples(ringInSegments(32), STOPS_RAMP), STOPS[0]);
    expectAllNear(
      computeSpeedPunkSamples(ringInSegments(4), {
        ...STOPS_RAMP,
        colorFlatTurnDegrees: 5,
        colorTightTurnDegrees: 20,
      }),
      STOPS[2]
    );
  });

  it("does not move the colour with the size of the drawing", () => {
    const small = channelsOf(computeSpeedPunkSamples(ringOfRadius(40), COLOUR_RAMP));
    const large = channelsOf(computeSpeedPunkSamples(ringOfRadius(900), COLOUR_RAMP));
    expect(large).to.deep.equal(small);
  });

  it("does not move the colour ramp when the height anchor changes", () => {
    const ring = ringOfRadius(200);
    const near = computeSpeedPunkSamples(ring, {
      ...COLOUR_RAMP,
      referenceTurnDegrees: 20,
    });
    const far = computeSpeedPunkSamples(ring, {
      ...COLOUR_RAMP,
      referenceTurnDegrees: 300,
    });
    expect(channelsOf(far)).to.deep.equal(channelsOf(near));
  });

  it("leaves a segment's colour alone beyond its immediate neighbours", () => {
    const options = COLOUR_RAMP;
    const untouchedQuadrant = (path) =>
      channelsOf(
        computeSpeedPunkSamples(path, options).filter(
          (q) => q.points[0][0] < -1e-9 && q.points[0][1] < -1e-9
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
