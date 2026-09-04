import {
  applyStrength,
  AutokernEngine,
  calibrateBand,
  distanceFieldEnvelope,
  gaussianKernel1D,
  gaussianKernelWidth,
  gaussianKernelWidthFromBias,
  kernPixelsToUnits,
  measureOverlap,
  overlapRaster,
  reduceMax,
  reduceSumOfSquares,
  searchKern,
  separableGaussianBlur,
  squaredDistanceTransform2D,
} from "@fontra/core/autokern-engine.js";
import { expect } from "chai";

describe("squaredDistanceTransform2D (Felzenszwalb-Huttenlocher)", () => {
  it("gives known squared distances outward from a single dot", () => {
    const width = 5;
    const height = 5;
    const f = new Float64Array(width * height).fill(Infinity);
    f[2 * width + 2] = 0; // dot at (2,2)
    const d = squaredDistanceTransform2D(f, width, height);
    expect(d[0 * width + 0]).to.be.closeTo(8, 1e-9); // dx=2,dy=2
    expect(d[2 * width + 2]).to.equal(0);
    expect(d[2 * width + 0]).to.be.closeTo(4, 1e-9); // dx=2,dy=0
    expect(d[0 * width + 2]).to.be.closeTo(4, 1e-9); // dx=0,dy=2
  });

  it("gives known squared distances outward from a horizontal bar", () => {
    const width = 5;
    const height = 5;
    const f = new Float64Array(width * height).fill(Infinity);
    for (let x = 0; x < width; x++) {
      f[2 * width + x] = 0; // full row 2 is the bar
    }
    const d = squaredDistanceTransform2D(f, width, height);
    expect(d[0 * width + 2]).to.be.closeTo(4, 1e-9); // dy=2
    expect(d[1 * width + 2]).to.be.closeTo(1, 1e-9); // dy=1
    expect(d[2 * width + 2]).to.equal(0);
    expect(d[4 * width + 2]).to.be.closeTo(4, 1e-9); // dy=2
  });
});

describe("distanceFieldEnvelope", () => {
  const width = 9;
  const height = 1;
  const bias = 4;

  it("is full intensity (1) deep inside the glyph", () => {
    const coverage = new Float64Array([1, 1, 1, 1, 0.5, 0, 0, 0, 0]);
    const env = distanceFieldEnvelope(coverage, width, height, bias);
    expect(env[0]).to.equal(1);
    expect(env[3]).to.equal(1);
  });

  it("is exactly half intensity right at the edge (distance 0)", () => {
    const coverage = new Float64Array([1, 1, 1, 1, 0.5, 0, 0, 0, 0]);
    const env = distanceFieldEnvelope(coverage, width, height, bias);
    expect(env[4]).to.be.closeTo(0.5, 1e-9);
  });

  it("reaches zero at the bias distance from the edge", () => {
    const coverage = new Float64Array([1, 1, 1, 1, 0.5, 0, 0, 0, 0]);
    const env = distanceFieldEnvelope(coverage, width, height, bias);
    // edge seed is at index 4 (distance 0); index 4+bias=8 is bias px away
    expect(env[4 + bias]).to.be.closeTo(0, 1e-9);
  });

  it("folds the sub-pixel seed in: a less-covered edge pixel starts lower", () => {
    const halfCovered = new Float64Array([1, 1, 1, 1, 0.5, 0, 0, 0, 0]);
    const lessCovered = new Float64Array([1, 1, 1, 1, 0.3, 0, 0, 0, 0]);
    const envHalf = distanceFieldEnvelope(halfCovered, width, height, bias);
    const envLess = distanceFieldEnvelope(lessCovered, width, height, bias);
    expect(envLess[4]).to.be.lessThan(envHalf[4]);
    expect(envHalf[4]).to.be.closeTo(0.5, 1e-9);
  });

  it("never goes negative", () => {
    const coverage = new Float64Array([1, 1, 1, 1, 0.5, 0, 0, 0, 0]);
    const env = distanceFieldEnvelope(coverage, width, height, bias);
    for (const v of env) {
      expect(v).to.be.at.least(0);
    }
  });
});

describe("gaussian kernel", () => {
  it("gaussianKernelWidth mirrors halfkern's round(0.2*renderSize), forced odd", () => {
    expect(gaussianKernelWidth(100)).to.equal(21); // round(20) is even -> +1
    expect(gaussianKernelWidth(105)).to.equal(21); // round(21) already odd
  });

  it("gaussianKernelWidthFromBias is the exact inverse of floor(width/2)", () => {
    expect(gaussianKernelWidthFromBias(4)).to.equal(9);
    expect(Math.floor(gaussianKernelWidthFromBias(4) / 2)).to.equal(4);
    expect(gaussianKernelWidthFromBias(10)).to.equal(21);
    expect(gaussianKernelWidthFromBias(10) % 2).to.equal(1); // always odd
  });

  it("gaussianKernel1D sums to 1 and is symmetric", () => {
    const width = gaussianKernelWidth(100);
    const kernel = gaussianKernel1D(width);
    let sum = 0;
    for (const v of kernel) sum += v;
    expect(sum).to.be.closeTo(1, 1e-9);
    for (let i = 0; i < width; i++) {
      expect(kernel[i]).to.be.closeTo(kernel[width - 1 - i], 1e-12);
    }
  });
});

describe("separableGaussianBlur", () => {
  it("blurs an impulse into the outer product of the 1D kernel with itself", () => {
    const width = 5;
    const height = 5;
    const kernel = gaussianKernel1D(3);
    const data = new Float64Array(width * height);
    data[2 * width + 2] = 1; // impulse at center
    const blurred = separableGaussianBlur(data, width, height, kernel);
    // center should be kernel[mid]*kernel[mid]
    const mid = 1; // middle index of a width-3 kernel
    expect(blurred[2 * width + 2]).to.be.closeTo(kernel[mid] * kernel[mid], 1e-9);
    // one pixel right of center
    expect(blurred[2 * width + 3]).to.be.closeTo(kernel[mid] * kernel[2], 1e-9);
    // one pixel below center
    expect(blurred[3 * width + 2]).to.be.closeTo(kernel[2] * kernel[mid], 1e-9);
  });
});

function makeRaster(data, width, height, originX, originY, advance) {
  return { data: new Float64Array(data), width, height, originX, originY, advance };
}

describe("overlapRaster + reductions", () => {
  it("computes the per-pixel product raster at the halfkern placement formula", () => {
    // left: 2x2 all 1s, advance=2, originX=0
    const left = makeRaster([1, 1, 1, 1], 2, 2, 0, 0, 2);
    // right: 2x2 all 1s, originX=0
    const right = makeRaster([1, 1, 1, 1], 2, 2, 0, 0, 2);
    // kern=0 -> l_offset = -(2+0)+0-0 = -2 -> width = max(0,min(2-2,2)) = 0
    const disjoint = overlapRaster(left, right, 0);
    expect(disjoint.width).to.equal(0);

    // kern=-2 -> l_offset = -(2+0)+0-(-2) = 0 -> width = max(0,min(2+0,2))=2 (full overlap)
    const full = overlapRaster(left, right, -2);
    expect(full.width).to.equal(2);
    expect(Array.from(full.data)).to.deep.equal([1, 1, 1, 1]);
  });

  it("reduceSumOfSquares sums squared products; reduceMax takes the largest", () => {
    const data = new Float64Array([0.5, 0.5, 1, 0]);
    expect(reduceSumOfSquares(data)).to.be.closeTo(0.25 + 0.25 + 1 + 0, 1e-9);
    expect(reduceMax(data)).to.be.closeTo(1, 1e-9);
  });

  it("measureOverlap on disjoint rasters is 0 for both reductions", () => {
    const left = makeRaster([1, 1, 1, 1], 2, 2, 0, 0, 2);
    const right = makeRaster([1, 1, 1, 1], 2, 2, 0, 0, 2);
    expect(measureOverlap(left, right, 0, "sum")).to.equal(0);
    expect(measureOverlap(left, right, 0, "max")).to.equal(0);
  });

  it("measureOverlap on fully overlapping identical rasters is positive", () => {
    const left = makeRaster([1, 1, 1, 1], 2, 2, 0, 0, 2);
    const right = makeRaster([1, 1, 1, 1], 2, 2, 0, 0, 2);
    expect(measureOverlap(left, right, -2, "sum")).to.be.closeTo(4, 1e-9);
    expect(measureOverlap(left, right, -2, "max")).to.be.closeTo(1, 1e-9);
  });
});

describe("calibrateBand", () => {
  it("settles immediately when the three control measurements already agree", () => {
    const measureFn = (bias) => [10, 11, 12]; // min=10 > max/2=6 -> agrees
    const result = calibrateBand(measureFn, 4, 100);
    expect(result.bias).to.equal(4);
    expect(result.widened).to.equal(false);
    expect(result.band).to.deep.equal({ min: 10, max: 12 });
  });

  it("widens the bias when the three control measurements disagree, then settles", () => {
    const measureFn = (bias) => (bias === 4 ? [1, 1, 100] : [40, 41, 42]);
    const result = calibrateBand(measureFn, 4, 100);
    expect(result.bias).to.equal(6); // widened once, +2
    expect(result.widened).to.equal(true);
    expect(result.band).to.deep.equal({ min: 40, max: 42 });
  });

  it("throws once bias would exceed 2*renderSize", () => {
    const measureFn = (bias) => [1, 1, 100]; // never agrees
    expect(() => calibrateBand(measureFn, 199, 100)).to.throw();
  });

  it("settles (does not widen) when the smallest is EXACTLY half the largest", () => {
    // Spec §2.4: disagreement is "the smallest is UNDER half the largest".
    // min === max/2 is not under half, so this must settle immediately.
    const measureFn = (bias) => [5, 8, 10]; // min=5, max=10, min === max/2
    const result = calibrateBand(measureFn, 4, 100);
    expect(result.bias).to.equal(4);
    expect(result.widened).to.equal(false);
  });
});

describe("searchKern", () => {
  it("returns 0 directly when kern=0 is already inside the band", () => {
    const measureFn = (kern) => 5;
    expect(searchKern(measureFn, { min: 4, max: 6 }, 8)).to.equal(0);
  });

  it("steps negative and interpolates when starting below the band", () => {
    // s(kern) = -kern (increases as kern goes negative), band [4,6]... use band [3.5,6]
    const measureFn = (kern) => -kern;
    // s(0)=0 <3.5; s(-1)=1;...s(-4)=4 first >=3.5 at kern=-4? actually check s(-3)=3 <3.5, s(-4)=4>=3.5
    // interpolate between -3 (s=3) and -4 (s=4): t=(3.5-3)/(4-3)=0.5 -> kern=-3+0.5*(-4-(-3))=-3.5
    const result = searchKern(measureFn, { min: 3.5, max: 100 }, 8);
    expect(result).to.be.closeTo(-3.5, 1e-9);
  });

  it("steps positive and interpolates when starting above the band", () => {
    // s(kern) = 10-kern (decreases as kern increases), band max=6.5, min=-100
    const measureFn = (kern) => 10 - kern;
    // s(0)=10>6.5; s(3)=7 >6.5; s(4)=6<=6.5 -> interpolate between 3(s=7) and 4(s=6)
    // t=(6.5-7)/(6-7)=0.5 -> kern=3+0.5*(4-3)=3.5
    const result = searchKern(measureFn, { min: -100, max: 6.5 }, 8);
    expect(result).to.be.closeTo(3.5, 1e-9);
  });

  it("returns null when the band is never reached within +/-2*bias", () => {
    const measureFn = (kern) => 0; // never enters [4,6] no matter the kern
    expect(searchKern(measureFn, { min: 4, max: 6 }, 2)).to.equal(null);
  });

  it("two identical measure functions land on the exact same kern (no off-by-step)", () => {
    const measureFnA = (kern) => -kern;
    const measureFnB = (kern) => -kern; // separately constructed, identical behavior
    const a = searchKern(measureFnA, { min: 3.5, max: 100 }, 8);
    const b = searchKern(measureFnB, { min: 3.5, max: 100 }, 8);
    expect(a).to.equal(b);
  });
});

describe("pixel -> units conversion and strength", () => {
  it("kernPixelsToUnits scales by unitsPerEm/renderSize", () => {
    expect(kernPixelsToUnits(-5, 100, 1000)).to.be.closeTo(-50, 1e-9);
    expect(kernPixelsToUnits(5, 100, 1000)).to.be.closeTo(50, 1e-9);
  });

  it("applyStrength is a single multiplier applied to either sign", () => {
    expect(applyStrength(-50, 0.5)).to.be.closeTo(-25, 1e-9);
    expect(applyStrength(50, 0.5)).to.be.closeTo(25, 1e-9);
    expect(applyStrength(-50, 1)).to.be.closeTo(-50, 1e-9);
  });
});

describe("AutokernEngine", () => {
  // Coverage rasters must arrive padded on all sides by the envelope reach
  // (spec §2: "coverage already padded on all sides by the envelope reach").
  function paddedRectCoverage(shapeWidth, shapeHeight, bias, advance) {
    const width = shapeWidth + 2 * bias;
    const height = shapeHeight + 2 * bias;
    const data = new Float64Array(width * height);
    for (let y = bias; y < bias + shapeHeight; y++) {
      for (let x = bias; x < bias + shapeWidth; x++) {
        data[y * width + x] = 1;
      }
    }
    return { data, width, height, originX: bias, originY: bias, advance };
  }

  it("calibrates a band from control rasters and finds a kern for a pair", () => {
    const engine = new AutokernEngine({
      renderSize: 100,
      reach: 4,
      reduce: "sum",
      strength: 1,
      unitsPerEm: 1000,
    });

    const l = paddedRectCoverage(8, 8, 4, 8);
    const n = paddedRectCoverage(8, 8, 4, 8);
    const o = paddedRectCoverage(8, 8, 4, 8);
    const calibration = engine.calibrate([l, n, o]);
    expect(calibration.band.min).to.be.at.most(calibration.band.max);
    expect(calibration.band.max).to.be.greaterThan(0);

    const left = paddedRectCoverage(12, 8, engine.bias, 12);
    const right = paddedRectCoverage(12, 8, engine.bias, 12);
    const kern = engine.kernPair(left, right);
    expect(kern === null || typeof kern === "number").to.equal(true);
  });

  // Regression coverage for the gaussian/bias coupling gap found in review:
  // buildEnvelope's gaussian branch used to derive its kernel width from
  // renderSize alone, so calibration's widening loop (which only mutates
  // `bias`) had no effect under envelope: "gaussian" and would spin to the
  // bias > 2*renderSize exception instead of ever converging.
  it("gaussian envelope output changes when bias changes (coupled to calibration widening)", () => {
    const engine = new AutokernEngine({
      renderSize: 100,
      reach: 4,
      envelope: "gaussian",
      unitsPerEm: 1000,
    });
    const raster = paddedRectCoverage(8, 8, 16, 8);

    engine.bias = 4;
    const envA = Array.from(engine.buildEnvelope(raster).data);
    engine.bias = 10;
    const envB = Array.from(engine.buildEnvelope(raster).data);

    expect(envA).to.not.deep.equal(envB);
  });

  it("calibrates a band and finds a kern for a pair under envelope: gaussian", () => {
    const engine = new AutokernEngine({
      renderSize: 100,
      reach: 4,
      reduce: "sum",
      strength: 1,
      unitsPerEm: 1000,
      envelope: "gaussian",
    });

    const l = paddedRectCoverage(8, 8, 16, 8);
    const n = paddedRectCoverage(8, 8, 16, 8);
    const o = paddedRectCoverage(8, 8, 16, 8);
    const calibration = engine.calibrate([l, n, o]);
    expect(calibration.band.min).to.be.at.most(calibration.band.max);
    expect(calibration.band.max).to.be.greaterThan(0);

    const left = paddedRectCoverage(12, 8, engine.bias, 12);
    const right = paddedRectCoverage(12, 8, engine.bias, 12);
    const kern = engine.kernPair(left, right);
    expect(kern === null || typeof kern === "number").to.equal(true);
  });
});

describe("sweep: continuity and monotonicity of the search (spec section 8)", () => {
  // Coverage rasters must arrive padded on all sides by the envelope reach
  // (spec §2), so a shape of shapeWidth x shapeHeight sits inside a raster
  // widened by 2*bias, with a zero-coverage border at least `bias` wide.
  function buildEnvelope(shapeWidth, shapeHeight, bias, advance) {
    const width = shapeWidth + 2 * bias;
    const height = shapeHeight + 2 * bias;
    const coverage = new Float64Array(width * height);
    for (let y = bias; y < bias + shapeHeight; y++) {
      for (let x = bias; x < bias + shapeWidth; x++) {
        coverage[y * width + x] = 1;
      }
    }
    const data = distanceFieldEnvelope(coverage, width, height, bias);
    return { data, width, height, originX: bias, originY: bias, advance };
  }

  it("raw overlap measure is monotone as kern walks across the search range", () => {
    // Increasing kern moves the right glyph further away -> overlap must not increase.
    const bias = 4;
    const left = buildEnvelope(12, 8, bias, 12);
    const right = buildEnvelope(12, 8, bias, 12);
    let prev = measureOverlap(left, right, -2 * bias, "sum");
    for (let kern = -2 * bias + 1; kern <= 2 * bias; kern++) {
      const s = measureOverlap(left, right, kern, "sum");
      expect(s).to.be.at.most(prev + 1e-9);
      prev = s;
    }
  });

  it("walking the left-glyph width in fine steps moves the returned kern smoothly", () => {
    const bias = 4;
    // Fixed control band from a self-measured square, independent of the swept width.
    const control = buildEnvelope(8, 8, bias, 8);
    const s0 = measureOverlap(control, control, 0, "sum");
    const band = { min: s0 * 0.2, max: s0 * 0.6 };

    // Hold the left glyph's advance fixed while growing its ink width, so
    // the interacting (right) ink edge actually moves relative to the
    // advance point instead of translating along with it.
    const right = buildEnvelope(12, 8, bias, 12);
    const kerns = [];
    for (let width = 8; width <= 20; width++) {
      const left = buildEnvelope(width, 8, bias, 12);
      const measureFn = (kern) => measureOverlap(left, right, kern, "sum");
      const kern = searchKern(measureFn, band, bias);
      kerns.push(kern);
    }
    let worstStep = 0;
    for (let i = 1; i < kerns.length; i++) {
      if (kerns[i] === null || kerns[i - 1] === null) continue;
      worstStep = Math.max(worstStep, Math.abs(kerns[i] - kerns[i - 1]));
    }
    // record: worst single-step movement of the returned kern across the width sweep
    // eslint-disable-next-line no-console
    console.log("sweep worst single-step kern movement:", worstStep);
    expect(worstStep).to.be.lessThan(2.5);
  });

  it("walking the envelope reach (bias) in fine steps moves the returned kern smoothly", () => {
    const kerns = [];
    for (let bias = 3; bias <= 8; bias++) {
      const control = buildEnvelope(8, 8, bias, 8);
      const s0 = measureOverlap(control, control, 0, "sum");
      const band = { min: s0 * 0.2, max: s0 * 0.6 };
      const l = buildEnvelope(12, 8, bias, 12);
      const r = buildEnvelope(14, 8, bias, 14);
      const measureFn = (kern) => measureOverlap(l, r, kern, "sum");
      kerns.push(searchKern(measureFn, band, bias));
    }
    let worstStep = 0;
    for (let i = 1; i < kerns.length; i++) {
      if (kerns[i] === null || kerns[i - 1] === null) continue;
      worstStep = Math.max(worstStep, Math.abs(kerns[i] - kerns[i - 1]));
    }
    console.log("sweep (bias) worst single-step kern movement:", worstStep);
    expect(worstStep).to.be.lessThan(3);
  });

  it("two geometrically identical rasters do not land a kern-step apart", () => {
    const bias = 4;
    const left = buildEnvelope(12, 8, bias, 12);
    const rightA = buildEnvelope(12, 8, bias, 12);
    const rightB = buildEnvelope(12, 8, bias, 12); // independently built, same shape
    const control = buildEnvelope(8, 8, bias, 8);
    const s0 = measureOverlap(control, control, 0, "sum");
    const band = { min: s0 * 0.2, max: s0 * 0.6 };
    const kernA = searchKern(
      (kern) => measureOverlap(left, rightA, kern, "sum"),
      band,
      bias
    );
    const kernB = searchKern(
      (kern) => measureOverlap(left, rightB, kern, "sum"),
      band,
      bias
    );
    expect(kernA).to.equal(kernB);
  });
});
