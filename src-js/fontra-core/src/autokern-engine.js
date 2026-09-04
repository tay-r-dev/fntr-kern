// Autokern measurement engine (forkra "Kerning view and autokern", spec §2, §10, workstream 1).
//
// Pure geometry/math, no DOM, no canvas: typed arrays and numbers only.
// This module CONSUMES rasters (it does not render glyphs). A raster is:
//   { data, width, height, originX, originY, advance }
// where `data` is a row-major typed array of length width*height holding
// coverage in the 0..1 range (this module is consistent in 0..1 throughout;
// callers rasterizing at 0..255 must normalize before calling in).
//
// Ported semantics (not code) from halfkern's kern_pair.py: gaussian, kernel,
// blur, overlap, surface_sum, kern_pair, find_s. See _external/_spacing-kerning/
// halfkern/kern_pair.py for the reference this was checked against.

// ---------------------------------------------------------------------------
// 2.2 Envelope: exact Euclidean distance transform (Felzenszwalb-Huttenlocher)
// ---------------------------------------------------------------------------

// One-dimensional generalized distance transform of a sampled function `f`
// (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions").
// Works for arbitrary real-valued f (including +Infinity as "no value"), not
// just a 0/Infinity indicator function -- that generality is what lets us
// seed sub-pixel offsets directly into the transform (see distanceFieldEnvelope).
// A large finite stand-in for "no value" -- using literal Infinity in the
// parabola-lower-envelope arithmetic below produces Infinity-Infinity = NaN
// whenever two unseeded columns/rows are compared, so unseeded positions are
// represented with this sentinel instead. It must be far larger than any
// squared pixel distance this module will compute, but small enough that
// double-precision arithmetic on it (NO_VALUE + q*q) does not lose the q*q
// term to rounding -- doubles are exact for integers up to 2^53, so 1e9
// leaves ample headroom below that for realistic raster sizes.
const NO_VALUE = 1e9;

function distanceTransform1D(f) {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}

// Exact 2D squared Euclidean distance transform of a sampled function `f`
// (row-major, length width*height). Two-pass separable: columns then rows.
// This is the general form (works for any real f, +Infinity allowed), so it
// serves both as a plain binary-mask EDT (f = 0 at foreground, Infinity
// elsewhere) and as the sub-pixel-seeded transform used by
// distanceFieldEnvelope below.
export function squaredDistanceTransform2D(f, width, height) {
  const afterColumns = new Float64Array(width * height);
  const colBuf = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const v = f[y * width + x];
      colBuf[y] = v === Infinity ? NO_VALUE : v;
    }
    const dcol = distanceTransform1D(colBuf);
    for (let y = 0; y < height; y++) {
      afterColumns[y * width + x] = dcol[y];
    }
  }

  const out = new Float64Array(width * height);
  const rowBuf = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rowBuf[x] = afterColumns[y * width + x];
    }
    const drow = distanceTransform1D(rowBuf);
    for (let x = 0; x < width; x++) {
      out[y * width + x] = drow[x];
    }
  }
  return out;
}

// Build the distance-field envelope from a coverage raster (0..1).
//
// Inside the glyph the envelope stays at full intensity (1). Outside, it
// ramps linearly from HALF intensity at the edge to 0 at `bias` (the
// envelope reach) pixels away: max(0, 0.5 - (0.5/bias) * edgeDistance).
//
// Sub-pixel accuracy: a pixel is "inside" when its coverage is > 0.5.
// Every outside pixel adjacent to an inside pixel is a boundary seed; it is
// seeded with (0.5 - its own coverage) *before* the distance transform runs,
// so a boundary pixel at exactly 50% coverage seeds at distance 0 (giving
// envelope 0.5 right there, matching "half intensity at the edge"), while a
// less-covered boundary pixel seeds at a small positive sub-pixel distance
// (the true edge is estimated to be nearer than a whole pixel away). This is
// folded into the squared-distance seed (seed^2) rather than binarizing.
export function distanceFieldEnvelope(coverage, width, height, bias) {
  const n = width * height;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = coverage[i] > 0.5 ? 1 : 0;
  }

  const f = new Float64Array(n).fill(Infinity);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (inside[idx]) continue;
      let isBoundary = false;
      if (x > 0 && inside[idx - 1]) isBoundary = true;
      if (x < width - 1 && inside[idx + 1]) isBoundary = true;
      if (y > 0 && inside[idx - width]) isBoundary = true;
      if (y < height - 1 && inside[idx + width]) isBoundary = true;
      if (isBoundary) {
        const seed = 0.5 - coverage[idx];
        f[idx] = seed * seed;
      }
    }
  }

  const dist2 = squaredDistanceTransform2D(f, width, height);
  const envelope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (inside[i]) {
      envelope[i] = 1;
    } else {
      const d = Math.sqrt(dist2[i]);
      envelope[i] = Math.max(0, 0.5 - (0.5 / bias) * d);
    }
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// 2.2 Envelope: Gaussian alternative (separable convolution)
// ---------------------------------------------------------------------------

function gaussian(x, a, b, c) {
  return a * Math.exp(-((x - b) ** 2) / (2 * c * c));
}

// Mirrors halfkern's initial KERNEL_WIDTH before any calibration has run:
// round(0.2 * renderSize), forced odd. A caller picks an initial "reach" for
// gaussian mode from this (e.g. floor(width/2)); the engine itself derives
// its working kernel width from the calibrated bias instead, via
// gaussianKernelWidthFromBias below, so widening during calibration takes
// effect.
export function gaussianKernelWidth(renderSize) {
  let width = Math.round(0.2 * renderSize);
  if (width % 2 === 0) width += 1;
  return width;
}

// The kernel width implied by a given envelope reach (bias): the inverse of
// halving a forced-odd width. halfkern's BIAS = KERNEL_WIDTH // 2 with
// KERNEL_WIDTH always odd, so KERNEL_WIDTH = 2*bias + 1 exactly (always odd,
// and floor(width/2) recovers bias). This is what ties the Gaussian envelope
// to the same "envelope reach" that calibration (§2.4) widens -- halfkern's
// find_s() rebuilds the shared KERNEL every time BIAS changes, so widening
// the reach changes the Gaussian blur radius there too, and must here.
export function gaussianKernelWidthFromBias(bias) {
  return 2 * bias + 1;
}

// Mirrors halfkern's kernel(width): gaussian(x, 1, width//2, width/4) for
// x in 0..width, normalized to sum 1.
export function gaussianKernel1D(width) {
  const mean = Math.floor(width / 2);
  const sigma = width / 4;
  const kernel = new Float64Array(width);
  let sum = 0;
  for (let x = 0; x < width; x++) {
    kernel[x] = gaussian(x, 1, mean, sigma);
    sum += kernel[x];
  }
  for (let x = 0; x < width; x++) {
    kernel[x] /= sum;
  }
  return kernel;
}

function convolve1DSameZeroPad(values, n, kernel) {
  const kw = kernel.length;
  const half = Math.floor(kw / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < kw; k++) {
      const j = i + k - half;
      if (j >= 0 && j < n) {
        acc += values[j] * kernel[k];
      }
    }
    out[i] = acc;
  }
  return out;
}

// Separable Gaussian blur: rows then columns (mirrors halfkern's
// convolve -> transpose -> convolve -> transpose, i.e. horizontal blur then
// vertical blur), zero-padded at the edges.
export function separableGaussianBlur(data, width, height, kernel) {
  const afterRows = new Float64Array(width * height);
  const rowBuf = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rowBuf[x] = data[y * width + x];
    }
    const blurred = convolve1DSameZeroPad(rowBuf, width, kernel);
    for (let x = 0; x < width; x++) {
      afterRows[y * width + x] = blurred[x];
    }
  }

  const out = new Float64Array(width * height);
  const colBuf = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colBuf[y] = afterRows[y * width + x];
    }
    const blurred = convolve1DSameZeroPad(colBuf, height, kernel);
    for (let y = 0; y < height; y++) {
      out[y * width + x] = blurred[y];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2.3 Overlap
// ---------------------------------------------------------------------------

// Placement + per-pixel product overlap raster (halfkern overlap()):
//   l_offset = -(l.advance + l.originX) + r.originX - kern
//   width = max(0, min(l.width + l_offset, r.width))
// `r` supplies the source (unshifted); `l` is placed at `l_offset` and
// multiplied in (cairo's OPERATOR_IN == per-pixel product here).
export function overlapRaster(left, right, kern) {
  if (left.height !== right.height) {
    throw new Error("overlapRaster: left and right rasters must have equal height");
  }
  const height = left.height;
  const lOffset = -(left.advance + left.originX) + right.originX - kern;
  const width = Math.max(0, Math.min(left.width + lOffset, right.width));
  const widthInt = Math.max(0, Math.floor(width));
  const data = new Float64Array(widthInt * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < widthInt; x++) {
      const rVal = right.data[y * right.width + x];
      const lx = x - lOffset;
      let lVal = 0;
      if (lx >= 0 && lx < left.width) {
        lVal = left.data[y * left.width + Math.round(lx)];
      }
      data[y * widthInt + x] = rVal * lVal;
    }
  }
  return { data, width: widthInt, height };
}

export function reduceSumOfSquares(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) {
    s += data[i] * data[i];
  }
  return s;
}

export function reduceMax(data) {
  let m = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] * data[i];
    if (v > m) m = v;
  }
  return m;
}

export function measureOverlap(left, right, kern, reduce = "sum") {
  const raster = overlapRaster(left, right, kern);
  return reduce === "max" ? reduceMax(raster.data) : reduceSumOfSquares(raster.data);
}

// ---------------------------------------------------------------------------
// 2.4 Calibration
// ---------------------------------------------------------------------------

// `measureFn(bias)` must return the three self-overlap measurements (at
// kern 0) for the control glyphs, in the order the caller chooses (spec:
// "l", "n", "o"), for the given envelope reach (`bias`). Widens by +2 while
// the three disagree (min <= max/2), and fails once bias would exceed
// 2*renderSize (spec §2.4).
export function calibrateBand(measureFn, initialBias, renderSize) {
  let bias = initialBias;
  let widened = false;
  for (;;) {
    const measurements = measureFn(bias);
    const min = Math.min(...measurements);
    const max = Math.max(...measurements);
    // Spec §2.4: "If the smallest is UNDER half the largest the three
    // disagree." Disagreement is min < max/2, so the settle condition is the
    // complement, min >= max/2 -- exact equality settles rather than widens.
    if (min >= max / 2) {
      return { bias, measurements, widened, band: { min, max } };
    }
    widened = true;
    bias += 2;
    if (bias > 2 * renderSize) {
      throw new Error(
        "calibrateBand: failed to find a reasonable envelope reach (bias > 2*renderSize)"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2.5 Search
// ---------------------------------------------------------------------------

// `measureFn(kern)` returns the overlap measurement at an integer kern
// (pixels). Starting from kern=0: if already inside [band.min, band.max]
// return 0 directly. If below, step kern -1px (more negative -> closer
// together) until the measurement reaches the band, give up past -2*bias.
// If above, step +1px until it falls to the band, give up past +2*bias.
// The bracketing pair of integers is then linearly interpolated for
// sub-pixel accuracy (load-bearing: keeps geometrically identical glyphs
// from landing a step apart, spec §5/§8). Returns null when not bracketed.
export function searchKern(measureFn, band, bias) {
  const s0 = measureFn(0);
  if (s0 >= band.min && s0 <= band.max) {
    return 0;
  }

  if (s0 < band.min) {
    let prevKern = 0;
    let prevS = s0;
    for (let kern = -1; kern >= -2 * bias; kern--) {
      const s = measureFn(kern);
      if (s >= band.min) {
        const t = (band.min - prevS) / (s - prevS);
        return prevKern + t * (kern - prevKern);
      }
      prevKern = kern;
      prevS = s;
    }
    return null;
  }

  // s0 > band.max
  let prevKern = 0;
  let prevS = s0;
  for (let kern = 1; kern <= 2 * bias; kern++) {
    const s = measureFn(kern);
    if (s <= band.max) {
      const t = (band.max - prevS) / (s - prevS);
      return prevKern + t * (kern - prevKern);
    }
    prevKern = kern;
    prevS = s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2.6 Strength and units
// ---------------------------------------------------------------------------

export function kernPixelsToUnits(kernPixels, renderSize, unitsPerEm) {
  return (kernPixels / renderSize) * unitsPerEm;
}

// One multiplier applied whatever the sign (declined halfkern's `half`
// asymmetry -- designer's call, 2026-09-04).
export function applyStrength(valueInUnits, strength) {
  return valueInUnits * strength;
}

// ---------------------------------------------------------------------------
// Engine: wires the pure pieces together, holds params (mirrors
// letterspacer-engine.js's pattern of pure functions + a params-holding class).
// ---------------------------------------------------------------------------

export class AutokernEngine {
  constructor(params) {
    this.renderSize = params.renderSize;
    this.reach = params.reach;
    this.bias = params.reach;
    this.reduce = params.reduce || "sum";
    this.strength = params.strength ?? 1;
    this.unitsPerEm = params.unitsPerEm;
    this.envelopeType = params.envelope || "distanceField";
    this.band = null;
  }

  buildEnvelope(raster) {
    let data;
    if (this.envelopeType === "gaussian") {
      // Derived from the current bias (reach), not renderSize alone, so
      // calibration's widening loop actually changes what gets measured
      // under gaussian mode too (see gaussianKernelWidthFromBias above).
      const width = gaussianKernelWidthFromBias(this.bias);
      const kernel = gaussianKernel1D(width);
      data = separableGaussianBlur(raster.data, raster.width, raster.height, kernel);
    } else {
      data = distanceFieldEnvelope(raster.data, raster.width, raster.height, this.bias);
    }
    return { ...raster, data };
  }

  measure(leftEnvelope, rightEnvelope, kern) {
    return measureOverlap(leftEnvelope, rightEnvelope, kern, this.reduce);
  }

  // `controlRasters` is an array of three raw (unblurred) coverage rasters,
  // conventionally [l, n, o].
  calibrate(controlRasters) {
    const measureFn = (bias) => {
      this.bias = bias;
      return controlRasters.map((raster) => {
        const env = this.buildEnvelope(raster);
        return this.measure(env, env, 0);
      });
    };
    const result = calibrateBand(measureFn, this.reach, this.renderSize);
    this.bias = result.bias;
    this.band = result.band;
    return result;
  }

  // Returns the kern in font units (after strength), or null if not bracketed.
  // `calibrate()` must be called first.
  kernPair(leftRaster, rightRaster) {
    if (!this.band) {
      throw new Error("AutokernEngine.kernPair: calibrate() must be called first");
    }
    const left = this.buildEnvelope(leftRaster);
    const right = this.buildEnvelope(rightRaster);
    const measureFn = (kern) => this.measure(left, right, kern);
    const kernPixels = searchKern(measureFn, this.band, this.bias);
    if (kernPixels === null) {
      return null;
    }
    const units = kernPixelsToUnits(kernPixels, this.renderSize, this.unitsPerEm);
    return applyStrength(units, this.strength);
  }
}
