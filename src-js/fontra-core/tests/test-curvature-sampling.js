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

  it("draws in proportion up to the reference tightness", () => {
    // Under the reference the rule is a straight proportion, so halving the
    // curvature halves the fringe.
    const gentle = Math.max(...fringeLengths(circle(1000)));
    const gentler = Math.max(...fringeLengths(circle(2000)));
    expect(gentle / gentler).to.be.closeTo(2, 0.05);
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

  it("keeps a peak a peak above the reference tightness", () => {
    // A squeeze towards a ceiling drew a curve four times tighter than the
    // reference at 1.6 times the height and one twice as tight again at 1.8,
    // which is a plateau where the drawing has two different peaks.
    const atReference = Math.max(...fringeLengths(circle(100)));
    const fourTimes = Math.max(...fringeLengths(circle(25)));
    const eightTimes = Math.max(...fringeLengths(circle(12.5)));
    expect(fourTimes / atReference).to.be.closeTo(2.39, 0.05);
    expect(eightTimes / fourTimes).to.be.greaterThan(1.25);
  });

  it("grows without a ceiling, but slowly, so a cusp stays on the screen", () => {
    // A hundred times the reference tightness is under six times the height.
    const hundredTimes = Math.max(...fringeLengths(circle(1)));
    expect(hundredTimes).to.be.greaterThan(5 * 24);
    expect(hundredTimes).to.be.lessThan(6 * 24);
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

  it("does not run out of colour on a tight curve", () => {
    // Colour rides the same squeeze as the height. Against a flat range every
    // curvature at or above the reference sat on the last stop, so most of a
    // normal glyph came out one colour.
    const colorsOf = (r) =>
      new Set(
        computeSpeedPunkSamples(circle(r), {
          peakHeightGlyphUnits: 24,
          referenceRadius: 100,
        }).map((quad) => quad.color)
      );
    const tight = colorsOf(20);
    const tighter = colorsOf(5);
    expect([...tight].some((color) => tighter.has(color))).to.equal(false);
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

  it("saves the last colour stop for handles that have crossed", () => {
    // Handle tension is how far a handle reaches towards the point where its
    // segment's two handle lines cross. A well-formed arc sits near a half. At
    // 1 the handles meet, and past that the curve doubles back — so a half must
    // read cool and well past 1 must read hot.
    //
    // A symmetric arc whose tangents leave at sixty degrees. The crossing point
    // is above the middle of the chord, and the handles are a stated fraction
    // of the way to it.
    function arc(tension) {
      const angle = Math.PI / 3;
      const reach = Math.hypot(50, 50 * Math.tan(angle));
      const length = tension * reach;
      return VarPackedPath.fromUnpackedContours([
        {
          points: [
            { x: 0, y: 0 },
            { x: Math.cos(angle) * length, y: Math.sin(angle) * length, type: "cubic" },
            {
              x: 100 - Math.cos(angle) * length,
              y: Math.sin(angle) * length,
              type: "cubic",
            },
            { x: 100, y: 0 },
          ],
          isClosed: false,
        },
      ]);
    }
    const hottest = (path) =>
      Math.max(
        ...computeSpeedPunkSamples(path, {
          peakHeightGlyphUnits: 24,
          referenceRadius: 100,
        }).map((quad) => quad.color.match(/\d+/g).slice(0, 3).map(Number)[0])
      );
    const asRed = (path) => {
      const colors = computeSpeedPunkSamples(path, {
        peakHeightGlyphUnits: 24,
        referenceRadius: 100,
      }).map((quad) => quad.color);
      return colors.some((color) => color === "rgba(227, 0, 79, 1)");
    };
    expect(asRed(arc(0.5))).to.equal(false);
    expect(asRed(arc(1))).to.equal(false);
    expect(asRed(arc(1.5))).to.equal(true);
    expect(hottest(arc(0.5))).to.be.greaterThan(0); // and it does draw something
  });

  it("spends the colour stops over the range a letter draws in", () => {
    // Every curve on a letter used to come out within a few per cent of the
    // middle stop, which is one colour to the eye. The three stops are grey,
    // orange and red; against the reference radius of 100 the middle one falls
    // at a radius of about 22.
    const rgb = (color) => color.match(/\d+/g).slice(0, 3).map(Number);
    const away = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const colorsOf = (r) =>
      computeSpeedPunkSamples(circle(r), {
        peakHeightGlyphUnits: 24,
        referenceRadius: 100,
      }).map((quad) => rgb(quad.color));

    const grey = [0x8b, 0x93, 0x9c];
    const orange = [0xf2, 0x94, 0x00];
    const red = [0xe3, 0x00, 0x4f];

    const gentle = colorsOf(400);
    const middle = colorsOf(22);
    const tight = colorsOf(4);

    // the gentle one sits near the first stop
    expect(Math.min(...gentle.map((c) => away(c, grey)))).to.be.lessThan(
      Math.min(...gentle.map((c) => away(c, orange)))
    );
    // the middle one lands on the middle stop
    expect(Math.min(...middle.map((c) => away(c, orange)))).to.be.lessThan(20);
    // the tight one sits near the last
    expect(Math.min(...tight.map((c) => away(c, red)))).to.be.lessThan(
      Math.min(...tight.map((c) => away(c, orange)))
    );
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
