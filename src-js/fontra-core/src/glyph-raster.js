// Path -> coverage bitmap (forkra "Kerning view and autokern", spec §2.1,
// §3, §8: "path to coverage bitmap. Needs a canvas, so it stays about ten
// lines"). This is the ONLY file in the feature that touches a canvas or
// the DOM; autokern-engine.js's math never does (rail R-A), and mocha has
// no DOM in this harness, so nothing here can be unit-tested -- keep it
// small and put every real decision in autokern-engine.js instead, where it
// can be.
//
// Output matches autokern-engine.js's raster contract exactly:
//   { data: Float64Array (row-major, coverage 0..1), width, height,
//     originX, originY, advance } -- all in pixels at the caller's chosen
// rendering size, padded on every side by `bias` (the envelope reach,
// spec §2.1).
//
// Vertical alignment is shared across a whole run, not per-glyph: pass the
// same `verticalExtent` ({ yTop, yBottom }, font units) to every call so
// two different glyphs' rasters put the same absolute vertical position on
// the same row. Sizing each raster to its own tight bounding box instead
// would let a descender and a plain cap land "the same" position on
// different rows, which silently breaks overlapRaster's row-for-row
// assumption in autokern-engine.js.

export function rasterizeGlyph(
  glyph,
  { renderSize, unitsPerEm, bias, verticalExtent }
) {
  const scale = renderSize / unitsPerEm;
  const bounds = glyph.controlBounds;
  const xMin = bounds ? bounds.xMin : 0;
  const xMax = bounds ? bounds.xMax : 0;
  const { yTop, yBottom } = verticalExtent;

  const pixelXMin = Math.floor(scale * xMin);
  const pixelXMax = Math.ceil(scale * xMax);
  const pixelYTop = Math.ceil(scale * yTop);
  const pixelYBottom = Math.floor(scale * yBottom);

  const width = Math.max(0, pixelXMax - pixelXMin) + 2 * bias;
  const height = Math.max(0, pixelYTop - pixelYBottom) + 2 * bias;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  // Canvas y grows down, font y grows up; move the glyph so its ink starts
  // right after the bias padding on every side.
  context.translate(bias - pixelXMin, pixelYTop + bias);
  context.scale(scale, -scale);
  context.fillStyle = "black";
  context.fill(glyph.flattenedPath2d);

  const imageData = context.getImageData(0, 0, width, height);
  const data = new Float64Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = imageData.data[i * 4 + 3] / 255; // alpha channel, normalized
  }

  return {
    data,
    width,
    height,
    originX: bias - pixelXMin,
    originY: pixelYTop + bias,
    advance: scale * glyph.xAdvance,
  };
}
