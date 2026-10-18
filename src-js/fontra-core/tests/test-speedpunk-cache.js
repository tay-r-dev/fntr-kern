import {
  cachedSpeedPunkSamples,
  computeSpeedPunkSamples,
  SpeedPunkSegmentCache,
  speedPunkFillGroups,
  speedPunkStepRung,
} from "@fontra/core/curvature.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

function quarterPath() {
  return VarPackedPath.fromUnpackedContours([
    {
      points: [
        { x: 0, y: 0 },
        { x: 55, y: 0, type: "cubic" },
        { x: 100, y: 45, type: "cubic" },
        { x: 100, y: 100 },
      ],
      isClosed: false,
    },
  ]);
}

describe("SpeedPunk step rungs", () => {
  it("rounds a step count up to the next rung, a square root of two apart", () => {
    expect(speedPunkStepRung(16)).to.equal(16);
    expect(speedPunkStepRung(17)).to.equal(23);
    expect(speedPunkStepRung(23)).to.equal(23);
    expect(speedPunkStepRung(24)).to.equal(32);
    expect(speedPunkStepRung(5)).to.equal(6);
  });
});

describe("cachedSpeedPunkSamples", () => {
  const params = { baseSegmentBudget: 600, minSegmentsPerCurve: 5 };

  it("hands back the same samples for zooms on one rung, without recomputing", () => {
    const owner = {};
    let built = 0;
    const makePath = () => {
      built++;
      return quarterPath();
    };
    // 600 * sqrt(1.0) = 600 and 600 * sqrt(1.1) = 630 steps: both on the 724 rung.
    const a = cachedSpeedPunkSamples(owner, makePath, { ...params, zoomFactor: 1 });
    const b = cachedSpeedPunkSamples(owner, makePath, { ...params, zoomFactor: 1.1 });
    expect(b).to.equal(a);
    expect(built).to.equal(1);
  });

  it("computes afresh on another rung, and for another owner", () => {
    const owner = {};
    const a = cachedSpeedPunkSamples(owner, quarterPath, { ...params, zoomFactor: 1 });
    const far = cachedSpeedPunkSamples(owner, quarterPath, {
      ...params,
      zoomFactor: 4,
    });
    expect(far).to.not.equal(a);
    const other = cachedSpeedPunkSamples({}, quarterPath, { ...params, zoomFactor: 1 });
    expect(other).to.not.equal(a);
  });

  it("holds the last comb while the zoom moves, across rungs", () => {
    const owner = {};
    let built = 0;
    const makePath = () => {
      built++;
      return quarterPath();
    };
    const a = cachedSpeedPunkSamples(owner, makePath, { ...params, zoomFactor: 1 });
    const held = cachedSpeedPunkSamples(
      owner,
      makePath,
      { ...params, zoomFactor: 16 },
      "",
      { holdRung: true }
    );
    expect(held).to.equal(a);
    expect(built).to.equal(1);
    // Once the zoom settles, the comb for its rung.
    const settled = cachedSpeedPunkSamples(owner, makePath, {
      ...params,
      zoomFactor: 16,
    });
    expect(settled).to.not.equal(a);
    expect(settled.length).to.be.above(a.length);
  });

  it("does not hold a comb drawn with other settings, or for another owner", () => {
    const owner = {};
    const a = cachedSpeedPunkSamples(owner, quarterPath, { ...params, zoomFactor: 1 });
    const otherSettings = cachedSpeedPunkSamples(
      owner,
      quarterPath,
      { ...params, zoomFactor: 16, sharpness: 2 },
      "",
      { holdRung: true }
    );
    expect(otherSettings).to.not.equal(a);
    const otherOwner = cachedSpeedPunkSamples(
      {},
      quarterPath,
      { ...params, zoomFactor: 16 },
      "",
      { holdRung: true }
    );
    expect(otherOwner.length).to.be.above(0);
  });

  it("draws the samples computeSpeedPunkSamples draws at the rung's step count", () => {
    const samples = cachedSpeedPunkSamples({}, quarterPath, {
      ...params,
      zoomFactor: 1,
    });
    const direct = computeSpeedPunkSamples(quarterPath(), {
      ...params,
      contourSegmentBudget: speedPunkStepRung(600),
    });
    expect(samples).to.deep.equal(direct);
  });
});

describe("SpeedPunk per-contour sampling", () => {
  it("adding another curved contour leaves an existing contour's comb untouched", () => {
    const quarter = quarterPath().unpackedContours()[0];
    const ring = {
      points: [
        { x: 300, y: 0 },
        { x: 355, y: 0, type: "cubic" },
        { x: 400, y: 45, type: "cubic" },
        { x: 400, y: 100 },
        { x: 400, y: 155, type: "cubic" },
        { x: 355, y: 200, type: "cubic" },
        { x: 300, y: 200 },
        { x: 245, y: 200, type: "cubic" },
        { x: 200, y: 155, type: "cubic" },
        { x: 200, y: 100 },
      ],
      isClosed: true,
    };
    const params = { contourSegmentBudget: 64, minSegmentsPerCurve: 5 };
    const alone = computeSpeedPunkSamples(
      VarPackedPath.fromUnpackedContours([quarter]),
      params
    );
    const withRing = computeSpeedPunkSamples(
      VarPackedPath.fromUnpackedContours([quarter, ring]),
      params
    );
    expect(withRing.slice(0, alone.length)).to.deep.equal(alone);
  });
});

// A closed ring of six curves, one handle of the first one pulled by `pull`.
function hexRing(pull = 0) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const b = ((i + 1) * Math.PI) / 3;
    const k = 0.36;
    const on = [100 * Math.cos(a), 100 * Math.sin(a)];
    points.push({ x: on[0], y: on[1] });
    points.push({
      x: on[0] - k * 100 * Math.sin(a) + (i === 0 ? pull : 0),
      y: on[1] + k * 100 * Math.cos(a),
      type: "cubic",
    });
    points.push({
      x: 100 * Math.cos(b) + k * 100 * Math.sin(b),
      y: 100 * Math.sin(b) - k * 100 * Math.cos(b),
      type: "cubic",
    });
  }
  return VarPackedPath.fromUnpackedContours([{ points, isClosed: true }]);
}

describe("SpeedPunk per-segment cache", () => {
  const params = { contourSegmentBudget: 64, minSegmentsPerCurve: 5 };

  it("draws exactly what an uncached computation draws", () => {
    const cache = new SpeedPunkSegmentCache();
    computeSpeedPunkSamples(hexRing(), params, cache);
    const cached = computeSpeedPunkSamples(hexRing(30), params, cache);
    expect(cached).to.deep.equal(computeSpeedPunkSamples(hexRing(30), params));
  });

  it("recomputes only the edited segment and the two beside it", () => {
    const cache = new SpeedPunkSegmentCache();
    computeSpeedPunkSamples(hexRing(), params, cache);
    expect(cache.misses).to.equal(6);
    computeSpeedPunkSamples(hexRing(30), params, cache);
    expect(cache.misses).to.equal(6 + 3);
  });

  it("recomputes nothing when nothing changed", () => {
    const cache = new SpeedPunkSegmentCache();
    computeSpeedPunkSamples(hexRing(), params, cache);
    computeSpeedPunkSamples(hexRing(), params, cache);
    expect(cache.misses).to.equal(6);
  });

  it("recomputes every segment when a comb setting changes", () => {
    const cache = new SpeedPunkSegmentCache();
    computeSpeedPunkSamples(hexRing(), params, cache);
    computeSpeedPunkSamples(hexRing(), { ...params, sharpness: 2 }, cache);
    expect(cache.misses).to.equal(12);
  });

  it("lets the oldest entries go past its limit", () => {
    const cache = new SpeedPunkSegmentCache(6);
    computeSpeedPunkSamples(hexRing(), params, cache);
    computeSpeedPunkSamples(hexRing(30), params, cache);
    computeSpeedPunkSamples(hexRing(), params, cache);
    expect(cache.misses).to.equal(6 + 3 + 3);
  });

  it("holds its quads under a budget, whatever the entry count", () => {
    const cache = new SpeedPunkSegmentCache(20000, 500);
    for (let i = 0; i < 50; i++) {
      computeSpeedPunkSamples(hexRing(i), params, cache);
    }
    expect(cache.quadCount).to.be.at.most(500);
    const counted = [...cache.entries.values()].reduce((n, q) => n + q.length, 0);
    expect(cache.quadCount).to.equal(counted);
  });

  it("keeps unchanged segments under the budget", () => {
    const cache = new SpeedPunkSegmentCache(20000, 500);
    computeSpeedPunkSamples(hexRing(), params, cache);
    const misses = cache.misses;
    computeSpeedPunkSamples(hexRing(), params, cache);
    expect(cache.misses).to.equal(misses);
  });
});

describe("speedPunkFillGroups", () => {
  it("puts every quad in the one group of its colour", () => {
    const quads = computeSpeedPunkSamples(hexRing(30), {
      contourSegmentBudget: 64,
      minSegmentsPerCurve: 5,
    });
    const groups = speedPunkFillGroups(quads);
    const colours = new Set(quads.map((q) => q.color));
    expect(groups.map((g) => g.color)).to.have.members([...colours]);
    expect(groups.flatMap((g) => g.quads)).to.have.members(quads);
  });

  // Every distinct colour is one fill a frame, and an unstepped ramp gave
  // almost every quad its own: about 200 fills a frame on an "o".
  it("takes the colours in steps, so a dense comb is a few fills", () => {
    const quads = computeSpeedPunkSamples(hexRing(30), {
      contourSegmentBudget: 4000,
      minSegmentsPerCurve: 5,
    });
    expect(quads.length).to.be.above(1000);
    expect(speedPunkFillGroups(quads).length).to.be.at.most(33);
  });
});
