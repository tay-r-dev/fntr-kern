import {
  cachedSpeedPunkSamples,
  computeSpeedPunkSamples,
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
