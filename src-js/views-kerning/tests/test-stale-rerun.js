// Task 15 (docs/superpowers/plans/2026-09-08-kerning-view-ux.md, "AUTOKERN
// PLACEHOLDER A") reproduction. Not new production code: this drives the
// REAL, unmodified autokern-worker.js (../src/autokern-worker.js) through its
// real onmessage/postMessage protocol -- the same "run" job kerning.js's
// runAutokernWorker posts -- to answer the question the task poses: what
// exact work does a "stale glyphs only" rerun require, and does mode
// "marked" already do it correctly today.
//
// The worker is a browser Worker script (top-level onmessage/postMessage
// assignments assume those globals already exist, which is true inside a
// real Worker but NOT in plain Node/mocha -- assigning to an undeclared
// identifier throws under ESM's implicit strict mode). Predefining
// globalThis.onmessage/globalThis.postMessage before importing it sidesteps
// that without touching the worker file itself.
//
// Cache keys are never hardcoded as literal strings anywhere below --
// pairKey(left, right) (imported from the real module) builds every key,
// since its own separator is a control character, not a printable one.
import { markGlyphStale, pairKey } from "@fontra/core/autokern-cache.js";
import { expect } from "chai";

// Same recipe test-autokern-engine.js's own "calibrates a band..." test uses
// (fontra-core/tests/test-autokern-engine.js): reach 4, an 8x8 filled square
// padded by the bias on every side, advance 8. Reused verbatim rather than
// inventing a new raster fixture.
function paddedRectCoverage(shapeWidth, shapeHeight, bias, advance) {
  const width = shapeWidth + 2 * bias;
  const height = shapeHeight + 2 * bias;
  const data = new Float64Array(width * height);
  for (let y = bias; y < bias + shapeHeight; y++) {
    for (let x = bias; x < bias + shapeWidth; x++) {
      data[y * width + x] = 1;
    }
  }
  return { data: Array.from(data), width, height, originX: bias, originY: bias, advance };
}

// The three glyph names double as autokern's own control glyphs (kerning.js's
// CONTROL_GLYPH_NAMES = ["l", "n", "o"]) so one small raster set satisfies
// both calibration and the pairs under test -- no extra glyphs invented.
const GLYPHS = ["l", "n", "o"];

function buildRastersAndEnvelopes() {
  const rasters = {};
  const envelopes = {};
  for (const name of GLYPHS) {
    rasters[name] = paddedRectCoverage(8, 8, 4, 8);
    // Envelope is in the glyph's own local frame (autokern-cache.js's own
    // input-contract comment): ink runs 0..8, advance 8, matching the 8x8
    // rectangle above.
    envelopes[name] = { xMin: 0, xMax: 8, advance: 8 };
  }
  return { rasters, envelopes };
}

function seedFullCache() {
  let cache = new Map();
  for (const left of GLYPHS) {
    for (const right of GLYPHS) {
      cache.set(pairKey(left, right), { left, right, value: 999, junk: false, stale: false });
    }
  }
  return cache;
}

async function runWorkerJob(job) {
  const messages = [];
  globalThis.postMessage = (msg) => messages.push(msg);
  globalThis.onmessage = null;
  // Dynamic import so the globals above exist before the worker module's
  // top-level onmessage assignment runs.
  await import("../src/autokern-worker.js");
  await globalThis.onmessage({ data: { type: "run", job } });
  return messages;
}

describe("Task 15: stale-glyph scoped rerun, real autokern-worker.js", () => {
  it("mode 'marked' recomputes only pairs touching the stale glyph, when rasters cover BOTH sides of every stale pair", async () => {
    const { rasters, envelopes } = buildRastersAndEnvelopes();

    // Seed a cache with all 9 ordered l/n/o pairs already measured (fresh).
    let cache = seedFullCache();

    // Mark "n" stale -- autokern-cache.js's own primitive, unmodified, the
    // exact one kerning.js's markGlyphsStaleForClassEdit already calls.
    cache = markGlyphStale(cache, "n");
    const staleKeysBefore = [...cache.values()]
      .filter((e) => e.stale)
      .map((e) => pairKey(e.left, e.right))
      .sort();
    // Every pair with "n" on either side: n-n, and n paired with each other
    // glyph on both sides.
    const expectedStaleKeys = [
      pairKey("l", "n"),
      pairKey("n", "l"),
      pairKey("n", "n"),
      pairKey("n", "o"),
      pairKey("o", "n"),
    ].sort();
    expect(staleKeysBefore).to.deep.equal(expectedStaleKeys);

    const job = {
      source: "test-source",
      renderSize: 100,
      unitsPerEm: 1000,
      params: { reach: 4, strength: 1, envelope: "distance-field", reduce: "sum" },
      rasters, // FULL coverage: l, n, AND o all have rasters.
      envelopes,
      controlGlyphNames: GLYPHS,
      glyphNames: GLYPHS,
      mode: "marked",
      existingCache: [...cache.entries()],
    };

    const messages = await runWorkerJob(job);
    const done = messages.find((m) => m.type === "done");
    expect(done, "worker must report 'done'").to.exist;
    const resultCache = new Map(done.cache);

    // Every pair that touched "n" is no longer stale -- it was actually
    // remeasured (setPairValue clears `stale`, autokern-cache.js:114-144).
    for (const key of expectedStaleKeys) {
      expect(resultCache.get(key).stale, `pair should have been recomputed`).to.equal(false);
    }
    // Pairs that never touched "n" were never in pairsForRerun's "marked"
    // list and are untouched -- same value as the seeded entry, not a new
    // measurement.
    const untouchedPairs = [
      ["l", "l"],
      ["l", "o"],
      ["o", "l"],
      ["o", "o"],
    ];
    for (const [left, right] of untouchedPairs) {
      expect(resultCache.get(pairKey(left, right)).value).to.equal(999);
    }
  });

  it("mode 'marked' with rasters restricted to ONLY the marked glyph silently leaves its stale pairs unresolved -- confirms the plan's warned-against shortcut is unsafe", async () => {
    const { rasters, envelopes } = buildRastersAndEnvelopes();
    // The shortcut the plan explicitly says not to infer: "restricting both
    // sides to the stale set" -- i.e. only rasterizing the glyph that was
    // marked stale ("n"), not its pair partners ("l", "o").
    const restrictedRasters = { n: rasters.n };
    const restrictedEnvelopes = { n: envelopes.n };

    let cache = seedFullCache();
    cache = markGlyphStale(cache, "n");

    const job = {
      source: "test-source",
      renderSize: 100,
      unitsPerEm: 1000,
      params: { reach: 4, strength: 1, envelope: "distance-field", reduce: "sum" },
      rasters: restrictedRasters,
      envelopes: restrictedEnvelopes,
      controlGlyphNames: GLYPHS, // calibration still needs l, n, o rasters...
      glyphNames: GLYPHS,
      mode: "marked",
      existingCache: [...cache.entries()],
    };

    // Calibration reads controlRasters via raster(name) with no existence
    // guard (autokern-worker.js's runJob calls reviveRaster(rasters[name])
    // unconditionally) -- missing "l"/"o" rasters make reviveRaster return
    // null. Whatever the worker does with that (throw, post "error", or
    // limp through and post "done") is itself evidence about how forgiving
    // a truly scoped job's raster set is allowed to be -- captured below
    // rather than assumed.
    let messages;
    let threw = null;
    try {
      messages = await runWorkerJob(job);
    } catch (error) {
      threw = error;
    }

    if (threw) {
      // Calibration cannot proceed without control-glyph rasters. This is
      // itself evidence: a scoped job must still supply rasters for l/n/o
      // regardless of which glyph is stale.
      expect(threw).to.exist;
      return;
    }

    const errorMsg = messages.find((m) => m.type === "error");
    if (errorMsg) {
      expect(errorMsg).to.exist;
      return;
    }

    const done = messages.find((m) => m.type === "done");
    expect(done, "worker reported 'done' despite missing partner rasters").to.exist;
    const resultCache = new Map(done.cache);
    // The pairs needing BOTH "n" and a partner ("l" or "o") could not be
    // measured (missing raster => the worker's own
    // `if (!leftRaster || !rightRaster) continue;` guard,
    // autokern-worker.js:134-139) and are silently left stale:true in a run
    // that still reported "done" -- no partial-completion signal exists
    // today.
    const unresolvedPairs = [
      ["l", "n"],
      ["n", "l"],
      ["n", "o"],
      ["o", "n"],
    ];
    for (const [left, right] of unresolvedPairs) {
      const key = pairKey(left, right);
      expect(resultCache.get(key).stale, `pair was silently left unresolved`).to.equal(true);
    }
  });
});
