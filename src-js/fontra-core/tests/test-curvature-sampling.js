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
    expect(calculateSegmentBudget(4, 400, 5)).to.equal(100);
    expect(calculateSegmentBudget(1000, 400, 5)).to.equal(5);
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

// --- a fixed scale, and a height that squeezes instead of clipping ---------
//
// The fringe is scaled by one curve tightness taken from the em, so nothing on
// the glyph feeds the scale. Two earlier rules both took it from the outline:
// the segment its own tallest point, which drew one curvature at two lengths
// across a joint, and then the glyph its tallest point, which rescaled every
// fringe on the glyph whenever any one segment was redrawn. A pair of hard caps
// then drew two different curvatures at one length, so the height now leans
// over towards twice the peak instead of stopping at a ceiling.
describe("curvature comb: a fixed scale", () => {
  // A circle of radius r has curvature 1/r everywhere, so every fringe on it is
  // the same length and that length is known in advance.
  function circleContour(r) {
    const k = 0.5522847498 * r;
    return {
      points: [
        { x: r, y: 0, smooth: true },
        { x: r, y: k, type: "cubic" },
        { x: k, y: r, type: "cubic" },
        { x: 0, y: r, smooth: true },
        { x: -k, y: r, type: "cubic" },
        { x: -r, y: k, type: "cubic" },
        { x: -r, y: 0, smooth: true },
        { x: -r, y: -k, type: "cubic" },
        { x: -k, y: -r, type: "cubic" },
        { x: 0, y: -r, smooth: true },
        { x: k, y: -r, type: "cubic" },
        { x: r, y: -k, type: "cubic" },
      ],
      isClosed: true,
    };
  }

  function circle(r) {
    return VarPackedPath.fromUnpackedContours([circleContour(r)]);
  }

  function fringeLengths(path, params = {}) {
    return computeSpeedPunkSamples(path, {
      peakHeightGlyphUnits: 24,
      referenceRadius: 100,
      illustrationPosition: "outsideOfCurve",
      ...params,
    }).map(({ points: [onCurve, , , outer] }) =>
      Math.hypot(outer[0] - onCurve[0], outer[1] - onCurve[1])
    );
  }

  // A cubic circle is not exactly a circle. Its curvature runs about 2 per cent
  // either side of the true value, which is what these tolerances are.
  it("draws the full height where the curve is as tight as the reference", () => {
    const lengths = fringeLengths(circle(100));
    expect(Math.max(...lengths)).to.be.closeTo(24, 0.6);
    expect(Math.min(...lengths)).to.be.closeTo(24, 0.6);
  });

  it("draws in proportion to how tight the curve is", () => {
    // Halving the curvature halves the fringe, anywhere on the scale.
    const gentle = Math.max(...fringeLengths(circle(1000)));
    const gentler = Math.max(...fringeLengths(circle(2000)));
    expect(gentle / gentler).to.be.closeTo(2, 0.05);
  });

  it("samples a curve the same way however far the view is zoomed", () => {
    // The magnification used to reach the sample count. The count is a whole
    // number, so it stepped as the view changed, every segment resampled at
    // once, and the comb changed height with the drawing untouched.
    const lengths = (budget) =>
      fringeLengths(circle(100), { baseSegmentBudget: budget });
    expect(Math.max(...lengths(400))).to.be.closeTo(Math.max(...lengths(80)), 0.5);
  });

  it("does not rescale one shape when another one is redrawn", () => {
    // Two circles in one glyph. Retightening the second must leave the first
    // exactly as it was drawn.
    const together = (second) =>
      VarPackedPath.fromUnpackedContours([circleContour(100), circleContour(second)]);
    const before = fringeLengths(together(100)).slice(0, 12);
    const after = fringeLengths(together(30)).slice(0, 12);
    expect(after).to.deep.equal(before);
  });

  it("keeps a peak a peak, however tight the curve", () => {
    // Straight proportion the whole way. A squeeze towards a ceiling drew a
    // curve four times tighter than the reference at 1.6 times the height and
    // one twice as tight again at 1.8, which is a plateau where the drawing
    // has two different peaks.
    const atReference = Math.max(...fringeLengths(circle(100)));
    const fourTimes = Math.max(...fringeLengths(circle(25)));
    const eightTimes = Math.max(...fringeLengths(circle(12.5)));
    expect(fourTimes / atReference).to.be.closeTo(4, 0.1);
    expect(eightTimes / fourTimes).to.be.closeTo(2, 0.05);
  });

  it("draws two different curvatures at two different lengths, always", () => {
    // A hard ceiling gave both of these the same fringe, which is the reading
    // the comb exists to prevent.
    const tight = Math.max(...fringeLengths(circle(5)));
    const tighter = Math.max(...fringeLengths(circle(2)));
    expect(tighter).to.be.greaterThan(tight + 0.5);
  });

  it("gives one curvature one colour, whichever segment it is on", () => {
    // A tight circle and a shallow one in the same glyph. Colour rides the same
    // fixed scale as the height, so the two never share a colour. Colouring each
    // segment against its own range would run both through the whole set of
    // stops and paint two very different curvatures the same.
    const quads = computeSpeedPunkSamples(
      VarPackedPath.fromUnpackedContours([circleContour(50), circleContour(400)]),
      { peakHeightGlyphUnits: 24, referenceRadius: 100 }
    );
    const half = quads.length / 2;
    const tight = new Set(quads.slice(0, half).map((quad) => quad.color));
    const shallow = new Set(quads.slice(half).map((quad) => quad.color));
    expect([...tight].some((color) => shallow.has(color))).to.equal(false);
  });

  it("puts the last stop on the tightest place on the glyph", () => {
    // Colour is relative to the glyph, so whatever a letter contains, the
    // gentlest place takes the first stop and the tightest takes the last.
    const quads = computeSpeedPunkSamples(
      VarPackedPath.fromUnpackedContours([circleContour(400), circleContour(40)]),
      { peakHeightGlyphUnits: 24, referenceRadius: 100 }
    );
    const half = quads.length / 2;
    const gentle = new Set(quads.slice(0, half).map((quad) => quad.color));
    const tight = new Set(quads.slice(half).map((quad) => quad.color));
    expect(tight.has("rgba(227, 0, 79, 1)")).to.equal(true); // the last stop
    expect(gentle.has("rgba(139, 147, 156, 1)")).to.equal(true); // the first
    expect([...gentle].some((color) => tight.has(color))).to.equal(false);
  });

  it("uses the whole set of stops whatever the glyph is drawn at", () => {
    // Two glyphs, one ten times the size of the other, each drawn to itself.
    // An absolute colour scale painted one of them a single colour.
    const stopsUsed = (scale) => {
      const quads = computeSpeedPunkSamples(
        VarPackedPath.fromUnpackedContours([
          circleContour(40 * scale),
          circleContour(200 * scale),
        ]),
        { peakHeightGlyphUnits: 24, referenceRadius: 100 }
      );
      return new Set(quads.map((quad) => quad.color));
    };
    for (const scale of [1, 10]) {
      const colors = stopsUsed(scale);
      expect(colors.has("rgba(227, 0, 79, 1)")).to.equal(true);
      expect(colors.has("rgba(139, 147, 156, 1)")).to.equal(true);
    }
  });

  it("restyles the comb with sharpness and leaves the colour alone", () => {
    // Sharpness is the shape of the comb. A curve keeps its colour while the
    // comb over it is restyled, so the two readings cannot contradict.
    const sample = (sharpness) =>
      computeSpeedPunkSamples(circle(40), {
        peakHeightGlyphUnits: 24,
        referenceRadius: 100,
        sharpness,
      });
    const plain = sample(1);
    const sharp = sample(2.5);
    expect(sharp.map((quad) => quad.color)).to.deep.equal(
      plain.map((quad) => quad.color)
    );
    const fringe = (quads) =>
      Math.hypot(
        quads[0].points[3][0] - quads[0].points[0][0],
        quads[0].points[3][1] - quads[0].points[0][1]
      );
    expect(fringe(sharp)).to.not.be.closeTo(fringe(plain), 1);
  });

  it("draws nothing on a straight", () => {
    const lengths = fringeLengths(
      VarPackedPath.fromUnpackedContours([
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0, type: "cubic" },
            { x: 200, y: 0, type: "cubic" },
            { x: 300, y: 0 },
          ],
          isClosed: false,
        },
      ])
    );
    expect(Math.max(...lengths)).to.be.closeTo(0, 1e-9);
  });
});
