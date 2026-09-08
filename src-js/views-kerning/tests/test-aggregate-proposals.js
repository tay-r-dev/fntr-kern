// Task 16 (docs/superpowers/plans/2026-09-08-kerning-view-ux.md): "which
// suggestions contribute to a class median, and what baseline determines an
// out-of-tolerance candidate?"
//
// -----------------------------------------------------------------------
// CONFIRMED BLOCKER, read before editing this file
// -----------------------------------------------------------------------
// kerning.js itself could not be imported directly for this test. Confirmed
// by direct reproduction (three throwaway `node --import <loader>` repro
// runs from this workspace directory, not assumed):
//
//   1. kerning.js's own transitive graph (via edit-tools-select.js ->
//      views-editor) reaches views-editor/src/snapping-interactions.js,
//      which imports "@fontra/core/utils.js" -- a specifier that does not
//      resolve under plain Node ESM, because only "utils.ts" exists on
//      disk and fontra-core's package.json exports map ("./*": "./src/*")
//      does no extension substitution. Every OTHER working import of this
//      file in the codebase uses the real ".ts" extension explicitly
//      (kerning-controller.js:4, test-pairtable-writes.js:11) or goes
//      through webpack at build time, which isn't present under plain
//      Node/Mocha. This is a real, pre-existing defect in
//      snapping-interactions.js, unrelated to Task 16's own subject --
//      found only because this is the first test in the repo to attempt
//      importing kerning.js at all (grepped every existing
//      views-kerning/tests/*.js file: none import "../src/kerning.js").
//   2. Past that (confirmed with a throwaway resolve-fallback loader
//      mapping unresolvable "*.js" specifiers to "*.ts"), the SAME import
//      graph hits real browser-only side effects at MODULE TOP LEVEL:
//      fontra-core/src/localization.js calls synchronizeWithLocalStorage
//      at import time, which touches `localStorage` and
//      `window.addEventListener`; past a global shim for those,
//      fontra-core/src/theme-settings.js touches
//      `document.documentElement.classList` at import time too. This is a
//      deep, cascading chain of real browser dependencies, not a single
//      fixable specifier. Building a DOM shim deep enough to satisfy it
//      would mean emulating a browser -- exactly what the dispatch brief
//      rules out ("Do NOT use the live-server/CDP browser-testing
//      harness") and what an investigation task should not build as a new
//      piece of scope.
//
// Given that confirmed blocker, this file does not live-import kerning.js.
// It runs the CURRENT, VERBATIM source text of the exact methods this task
// investigates -- copied character-for-character from kerning.js at commit
// 3b8ce8fc466d0172d83254213f9cc6b469b4d153 (see the line numbers cited next
// to each), not reimplemented, paraphrased, or "improved" -- as plain
// methods on a throwaway probe object, called with real fixture data built
// from the REAL, directly-importable KerningController
// (@fontra/core/kerning-controller.js has no such import problem) and the
// REAL autokern-cache.js primitives (createCache/setPairValue/
// medianDroppingOutliers, also directly importable, used unmodified).
//
// This observes real numeric output from the real algorithm as it exists
// today; it is NOT a live import, and if a future change edits kerning.js's
// own copies of these methods, this file's copies will silently drift out
// of sync (there is no automated check tying them together). See the
// ledger's Task 16 section for the exact line ranges to re-diff this
// against if kerning.js changes computeFoldGroupStats, overrideDivergence,
// isOverrideCandidate, wouldShadowClassCell, isLeftClassed, isRightClassed,
// or the static medianOf.
import { FontSourcesInstancer } from "@fontra/core/font-sources-instancer.js";
import {
  createCache,
  medianDroppingOutliers,
  pairKey,
  setPairValue,
} from "@fontra/core/autokern-cache.js";
import { KerningController } from "@fontra/core/kerning-controller.js";
import { deepCopyObject } from "@fontra/core/utils.ts";
import { expect } from "chai";

// ---------------------------------------------------------------------
// Verbatim copies (kerning.js:2285-2382, 2752-2756, 2903-2937 at the commit
// named above). `this` below is always the throwaway probe object built in
// each test, carrying kerningController/autokernCache/autokernSource/
// autokernParamsController -- the exact fields the real class instance
// carries that these methods read.
// ---------------------------------------------------------------------
class AggregateProbe {
  // kerning.js:2285-2287
  isLeftClassed(glyphName) {
    return !!this.kerningController.leftPairGroupMapping[glyphName];
  }

  // kerning.js:2289-2291
  isRightClassed(glyphName) {
    return !!this.kerningController.rightPairGroupMapping[glyphName];
  }

  // kerning.js:2325-2330
  wouldShadowClassCell(left, right) {
    if (!this.isLeftClassed(left) && !this.isRightClassed(right)) {
      return false;
    }
    return this.kerningController.getPairValues(left, right) === undefined;
  }

  // kerning.js:2358-2366
  overrideDivergence(left, right, suggestedValue) {
    const groupResolved =
      this.kerningController.getGlyphPairValueForSource(
        left,
        right,
        this.autokernSource
      ) ?? 0;
    return suggestedValue - groupResolved;
  }

  // kerning.js:2374-2382
  isOverrideCandidate(left, right, suggestedValue) {
    if (!this.wouldShadowClassCell(left, right)) {
      return false;
    }
    const groupThreshold = this.autokernParamsController.model.groupThreshold;
    return (
      Math.abs(this.overrideDivergence(left, right, suggestedValue)) >= groupThreshold
    );
  }

  // kerning.js:2752-2756 (static on the real class; kept as a static here too)
  static medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // kerning.js:2903-2937
  computeFoldGroupStats(group, groupThreshold) {
    const kernData = this.kerningController.kernData;
    const leftMembers = kernData.groupsSide1[group.leftClassName] || [];
    const rightMembers = kernData.groupsSide2[group.rightClassName] || [];
    const leftSet = new Set(leftMembers);
    const rightSet = new Set(rightMembers);

    const entries = [];
    for (const entry of this.autokernCache.values()) {
      if (leftSet.has(entry.left) && rightSet.has(entry.right)) {
        entries.push(entry);
      }
    }

    const median = entries.length
      ? medianDroppingOutliers(
          entries.map((entry) => ({
            value: entry.value,
            divergence: this.overrideDivergence(entry.left, entry.right, entry.value),
          })),
          groupThreshold
        )
      : AggregateProbe.medianOf(group.rows.map((row) => row.suggestion));
    // spread (classSpread) is irrelevant to this task's contract questions
    // (median contributors / candidate baseline), omitted from the probe.
    return { leftMembers, rightMembers, entries, median };
  }
}

describe("Task 16: aggregate class-median and candidate-detection contract, real KerningController + real cache primitives, verbatim kerning.js method copies", () => {
  // ---------------------------------------------------------------------
  // The six-pair fixture, exactly the class×class product of @A x @V:
  //   A x V         -- ordinary, small divergence (inlier)
  //   A x W         -- ordinary, LARGE divergence (outlier + candidate)
  //   Adieresis x V -- hidden (junk:true), small divergence
  //   Adieresis x W -- stale (stale:true), small divergence
  //   Aacute x V    -- MISSING: no cache entry at all
  //   Aacute x W    -- saved exception: explicit stored -30 (vs. the
  //                    class's -80), cache suggestion close to THAT value
  // ---------------------------------------------------------------------
  const testFontController = {
    editIncremental: () => {},
    editFinal: () => {},
    fontAxesSourceSpace: [],
    sources: { a: { location: {} } },
  };
  testFontController.fontSourcesInstancer = new FontSourcesInstancer(
    testFontController.fontAxesSourceSpace,
    testFontController.sources
  );

  const testKerning = {
    kern: {
      groupsSide1: { A: ["A", "Adieresis", "Aacute"] },
      groupsSide2: { V: ["V", "W"] },
      sourceIdentifiers: ["a"],
      values: {
        "@A": { "@V": [-80] },
        Aacute: { W: [-30] }, // pre-existing saved exception
      },
    },
  };

  function freshController() {
    const editedFont = { kerning: deepCopyObject(testKerning) };
    return new KerningController("kern", editedFont.kerning, testFontController);
  }

  function freshCache() {
    let cache = createCache();
    cache = setPairValue(cache, "A", "V", -82); // ordinary, inlier
    cache = setPairValue(cache, "A", "W", -150); // ordinary, outlier
    cache = setPairValue(cache, "Adieresis", "V", -79); // hidden, inlier
    // Adieresis x W: stale, inlier -- constructed directly (real cache
    // entry shape, autokern-cache.js:32-43) because markGlyphStale marks
    // every entry touching a glyph on EITHER side (autokern-cache.js:
    // 225-233), which would also stale Adieresis x V above; no per-pair
    // "mark stale" primitive exists in autokern-cache.js at all -- itself
    // a real, confirmed fact recorded in the ledger below.
    cache = new Map(cache);
    cache.set(pairKey("Adieresis", "W"), {
      left: "Adieresis",
      right: "W",
      value: -83,
      junk: false,
      stale: true,
      override: false,
    });
    // Aacute x V intentionally has no entry at all (missing).
    cache = setPairValue(cache, "Aacute", "W", -28); // saved-exception pair
    // Mark the hidden entry junk, same as clicking the eye action would.
    const hiddenEntry = cache.get(pairKey("Adieresis", "V"));
    cache = new Map(cache);
    cache.set(pairKey("Adieresis", "V"), { ...hiddenEntry, junk: true });
    return cache;
  }

  function freshProbe(groupThreshold) {
    const probe = new AggregateProbe();
    probe.kerningController = freshController();
    probe.autokernCache = freshCache();
    probe.autokernSource = "a";
    probe.autokernParamsController = { model: { groupThreshold } };
    return probe;
  }

  it("current baseline resolves through the cascade -- explicit exception wins over the class value, exactly like an ordinary read", () => {
    const probe = freshProbe(10);
    // A x V and A x W: no explicit pair rule -> class value -80 answers.
    expect(probe.overrideDivergence("A", "V", -82)).to.equal(-2);
    expect(probe.overrideDivergence("A", "W", -150)).to.equal(-70);
    // Aacute x W: the SAVED EXCEPTION's own -30 answers, not the class's
    // -80 -- this is the confirmed answer to "current vs. proposed class
    // baseline": overrideDivergence's baseline is always the pair's own
    // CURRENT effective (cascade-resolved) value, never a class-wide
    // aggregate, and a saved exception's own value wins there exactly like
    // any other most-specific rule.
    expect(probe.overrideDivergence("Aacute", "W", -28)).to.equal(2);
  });

  it("isOverrideCandidate: a pair with an existing saved exception can NEVER be a candidate, regardless of divergence", () => {
    const probe = freshProbe(10);
    // Aacute x W has an explicit stored rule -> getPairValues() !==
    // undefined -> wouldShadowClassCell is false -> isOverrideCandidate is
    // false, unconditionally, even though this pair's suggestion (-28)
    // diverges hugely (+52) from the CLASS value (-80). Confirms: no
    // special "exclude existing exceptions from candidacy because they
    // diverge deliberately" rule is needed -- the existing
    // wouldShadowClassCell check already does exactly that, for a
    // different reason (it is already an explicit rule, so proposing to
    // create one is meaningless), not a comparison of divergence.
    expect(probe.isOverrideCandidate("Aacute", "W", -28)).to.equal(false);
  });

  it("isOverrideCandidate evaluates hidden and stale entries at face value -- neither flag gates candidacy", () => {
    const probe = freshProbe(10);
    // A x W: ordinary, large divergence -> candidate.
    expect(probe.isOverrideCandidate("A", "W", -150)).to.equal(true);
    // A x V: ordinary, small divergence -> not a candidate.
    expect(probe.isOverrideCandidate("A", "V", -82)).to.equal(false);
    // Adieresis x V: HIDDEN (junk), small divergence -> not a candidate,
    // same as any small-divergence pair -- confirms hidden-ness itself
    // plays no role in candidate detection (only pairRowVisible's DISPLAY
    // filter hides it from the Potential tab, a separate, later gate).
    expect(probe.isOverrideCandidate("Adieresis", "V", -79)).to.equal(false);
    // Adieresis x W: STALE, small divergence -> not a candidate. If this
    // pair's suggestion diverged by more than the threshold it WOULD be
    // flagged a candidate on its stale (possibly outdated) value -- there
    // is no staleness guard anywhere in isOverrideCandidate/
    // overrideDivergence/wouldShadowClassCell. Confirmed by code reading,
    // not merely this one small-divergence case.
    expect(probe.isOverrideCandidate("Adieresis", "W", -83)).to.equal(false);
  });

  it("computeFoldGroupStats: median contributors include hidden and stale entries, exclude only genuinely MISSING pairs", () => {
    const probe = freshProbe(10);
    const stats = probe.computeFoldGroupStats(
      { leftClassName: "A", rightClassName: "V", rows: [] },
      10
    );
    // 5 of the 6 fixture pairs have a cache entry (Aacute x V is missing).
    expect(stats.entries.length).to.equal(5);
    const entryFor = (l, r) => stats.entries.find((e) => e.left === l && e.right === r);
    expect(entryFor("Adieresis", "V")).to.exist; // hidden entry IS counted
    expect(entryFor("Adieresis", "V").junk).to.equal(true);
    expect(entryFor("Adieresis", "W")).to.exist; // stale entry IS counted
    expect(entryFor("Adieresis", "W").stale).to.equal(true);
    expect(entryFor("Aacute", "V")).to.equal(undefined); // missing, absent
  });

  it("computeFoldGroupStats: outlier-dropped median, groupThreshold=10 -- A x W (divergence -70) is dropped, the rest (all |divergence|<10) are averaged", () => {
    const probe = freshProbe(10);
    const stats = probe.computeFoldGroupStats(
      { leftClassName: "A", rightClassName: "V", rows: [] },
      10
    );
    // Inliers: A x V (-82), Adieresis x V (-79), Adieresis x W (-83),
    // Aacute x W (-28). Sorted: -83, -82, -79, -28. Even count -> average
    // of the two middle values: (-82 + -79) / 2 = -80.5. NOT rounded.
    expect(stats.median).to.equal(-80.5);
  });

  it("computeFoldGroupStats: when EVERY contributor is an outlier (groupThreshold below every real divergence), medianDroppingOutliers falls back to the unfiltered median of all 5 present entries", () => {
    const probe = freshProbe(10);
    const stats = probe.computeFoldGroupStats(
      { leftClassName: "A", rightClassName: "V", rows: [] },
      0.5 // smaller than every fixture divergence (min |divergence| is 1)
    );
    // All 5 present values: -82, -150, -79, -83, -28. Sorted:
    // -150, -83, -82, -79, -28. Odd count -> middle value -82.
    expect(stats.median).to.equal(-82);
  });

  it("computeFoldGroupStats: zero cache coverage falls back to medianOf(group.rows), which returns NaN for an empty group -- confirmed, not asserted safe", () => {
    const probe = freshProbe(10);
    // A class pair with no cache coverage at all -- unreachable through the
    // real UI (buildClassClassGroups only calls computeFoldGroupStats after
    // its own hasCoverage check passes, kerning.js:2794-2803), but the raw
    // function itself has no null-guard: entries.length is 0, so it falls
    // through to AggregateProbe.medianOf(group.rows.map(...)), and an empty
    // `rows` array produces NaN (sorted=[], mid=0, even-length branch reads
    // sorted[-1] and sorted[0], both undefined). This directly matters to
    // Task 16's contract: `getAggregateProposal(...) -> {value:
    // number|null, ...}` must explicitly guard against NaN if any future
    // caller invokes this path without the coverage gate -- NaN is neither
    // a number nor null under the contract's own type.
    const stats = probe.computeFoldGroupStats(
      { leftClassName: "NoSuchClass", rightClassName: "NoSuchClass", rows: [] },
      10
    );
    expect(stats.entries.length).to.equal(0);
    expect(Number.isNaN(stats.median)).to.equal(true);
  });
});
