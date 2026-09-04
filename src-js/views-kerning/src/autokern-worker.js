"use strict";

// Autokern run worker (forkra "Kerning view and autokern", spec §4: "A
// worker, with progress and cancel, shown in a popup"). Runs the
// measurement matrix off the main thread.
//
// OffscreenCanvas-vs-main-thread decision (documented per the task brief):
// glyph-raster.js's own file-top comment states it is "the ONLY file in the
// feature that touches a canvas or the DOM", specifically so mocha (which
// has no DOM) never has to import canvas-touching code and so every real
// decision lives in autokern-engine.js where it is testable. Classic Web
// Workers DO get OffscreenCanvas in a browser, but routing rasterization
// through OffscreenCanvas here would mean a SECOND file that fills a path
// onto a canvas -- either a duplicate of glyph-raster.js's ten lines inside
// the worker, or an awkward transferable-ImageBitmap relay back out to
// glyph-raster.js and back in, neither of which is "confined to one file"
// any more. It also does not need a font -- `glyph.flattenedPath2d` is
// computed off `glyph.controlBounds` etc. by the glyph controller, itself an
// async, main-thread, network/font-backend-driven object (font-controller.js
// `getGlyphInstance`), which a worker cannot construct without re-plumbing
// the whole font backend into worker-land.
//
// So: RASTERIZATION STAYS ON THE MAIN THREAD, via glyph-raster.js exactly as
// written. Only the pure math -- calibration, prefilter, envelope, overlap,
// search, all of autokern-engine.js and autokern-cache.js, none of it
// touching DOM -- runs in this worker. The main thread's job (in kerning.js)
// is: resolve glyph names to glyph instances, call rasterizeGlyph for every
// glyph the job needs ONCE up front, and post the resulting rasters (as
// transferable typed arrays) into this worker as plain data. This worker
// then does every kernPair() call, every prefilter check and calibration
// step against that raster set, with no DOM access of its own.

import {
  candidatePairs,
  createCache,
  pairEnvelopesCanTouch,
  pairsForRerun,
  setPairValue,
} from "@fontra/core/autokern-cache.js";
import { AutokernEngine } from "@fontra/core/autokern-engine.js";

let cancelled = false;

onmessage = async (event) => {
  const { type } = event.data;
  if (type === "cancel") {
    cancelled = true;
    return;
  }
  if (type !== "run") {
    return;
  }
  cancelled = false;
  try {
    await runJob(event.data.job);
  } catch (error) {
    postMessage({ type: "error", error: error.toString() });
  }
};

// `job`:
//   {
//     source: string,               // §4.1/§7.5: which source this run is for
//     renderSize, unitsPerEm: number,
//     params: { reach, strength, envelope, reduce },
//     rasters: { [glyphName]: { data (plain array), width, height,
//                                originX, originY, advance } },
//     envelopes: { [glyphName]: { xMin, xMax, advance } },  // for the prefilter
//     controlGlyphNames: [string, string, string],  // spec §2.4: "l", "n", "o"
//     glyphNames: [string],         // candidate pool (excluded glyphs already removed)
//     mode: "everything" | "marked",
//     existingCache: [[key, entry], ...],  // Map entries, serialized
//   }
async function runJob(job) {
  const {
    source,
    renderSize,
    unitsPerEm,
    params,
    rasters,
    envelopes,
    controlGlyphNames,
    glyphNames,
    mode,
    existingCache,
  } = job;

  const engine = new AutokernEngine({
    renderSize,
    reach: params.reach,
    reduce: params.reduce,
    strength: params.strength,
    envelope: params.envelope,
    unitsPerEm,
  });

  const raster = (name) => reviveRaster(rasters[name]);

  // §2.4 calibration: measure "l", "n", "o" against themselves at their
  // current spacing to settle the band the rest of the run searches for.
  const controlRasters = controlGlyphNames.map((name) => raster(name));
  const calibration = engine.calibrate(controlRasters);
  postMessage({ type: "calibration", source, calibration });

  // §4 prefilter: reject pairs whose envelopes cannot touch at any kern in
  // the search range (2*bias, per autokern-engine's own "give up past twice
  // the bias", §2.5), before any pair is measured.
  const maxKernMagnitude = 2 * engine.bias;
  const canTouchFn = (left, right) =>
    pairEnvelopesCanTouch(
      envelopes[left],
      envelopes[right],
      engine.bias,
      maxKernMagnitude
    );
  const candidates = candidatePairs(glyphNames, [], canTouchFn);

  let cache = createCache();
  for (const [key, entry] of existingCache) {
    cache.set(key, entry);
  }

  const pairsToRun = pairsForRerun(cache, mode, candidates);
  const total = pairsToRun.length;

  for (let i = 0; i < total; i++) {
    if (cancelled) {
      postMessage({ type: "cancelled", source });
      return;
    }
    const { left, right } = pairsToRun[i];
    const leftRaster = raster(left);
    const rightRaster = raster(right);
    if (!leftRaster || !rightRaster) {
      // A candidate/rerun entry the main thread didn't rasterize (should not
      // happen for a conforming job, but never throw a whole run away for
      // one missing raster).
      continue;
    }
    const value = engine.kernPair(leftRaster, rightRaster);
    if (value !== null) {
      cache = setPairValue(cache, left, right, value);
    }
    if (i % 25 === 0 || i === total - 1) {
      postMessage({ type: "progress", source, done: i + 1, total });
    }
  }

  postMessage({
    type: "done",
    source,
    cache: [...cache.entries()],
    calibration,
  });
}

// The main thread posts rasters with plain (structured-cloned) arrays for
// `data` rather than the original Float64Array, so this worker's own copy is
// what gets mutated by nothing -- rebuild the typed array here once, cheaply,
// rather than paying a per-access conversion cost inside the hot pair loop.
const revived = new Map();
function reviveRaster(plain) {
  if (!plain) {
    return null;
  }
  if (revived.has(plain)) {
    return revived.get(plain);
  }
  const out = { ...plain, data: Float64Array.from(plain.data) };
  revived.set(plain, out);
  return out;
}
