import {
  boxDistanceMeasures,
  calculateHandleMeasure,
  calculateProjectedDistanceComponents,
  handleGizmoLines,
  handleLabelGoesUp,
} from "@fontra/core/distance-angle.js";
import { calculateSegmentTension } from "@fontra/core/tunni-calculations.js";
import { expect } from "chai";

describe("distance-angle measure helpers", () => {
  it("calculateProjectedDistanceComponents returns absolute deltas", () => {
    expect(
      calculateProjectedDistanceComponents({ x: 10, y: 20 }, { x: 13, y: 16 })
    ).deep.equals({
      dx: 3,
      dy: 4,
    });
    expect(
      calculateProjectedDistanceComponents({ x: 13, y: 16 }, { x: 10, y: 20 })
    ).deep.equals({
      dx: 3,
      dy: 4,
    });
  });

  it("calculateHandleMeasure returns distance/angle/tension for the start handle", () => {
    const seg = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ];
    const m = calculateHandleMeasure(seg, "start");
    expect(m).to.not.equal(null);
    expect(m.distance).to.be.closeTo(100, 1e-6);
    expect(m.angle).to.be.closeTo(90, 1e-6);
    expect(m.tension).to.be.a("number");
  });

  it("calculateHandleMeasure reports per-handle tension, distinct from segment tension on an unbalanced curve", () => {
    // Unbalanced curve: the start handle (length 50) is shorter than the end
    // handle (length 100). Both anchors are 200 from the Tunni point at (0, 200).
    const seg = [
      { x: 0, y: 0 }, // onStart
      { x: 0, y: 50 }, // offStart -> handle length 50
      { x: 100, y: 200 }, // offEnd -> handle length 100
      { x: 200, y: 200 }, // onEnd
    ];
    const start = calculateHandleMeasure(seg, "start");
    const end = calculateHandleMeasure(seg, "end");
    // Per-handle tension = handle length / (anchor -> Tunni point distance).
    expect(start.tension).to.be.closeTo(50 / 200, 1e-9); // 0.25
    expect(end.tension).to.be.closeTo(100 / 200, 1e-9); // 0.5
    // The two handles differ, and neither equals the symmetric segment tension.
    expect(start.tension).to.not.be.closeTo(end.tension, 1e-6);
    const segmentTension = calculateSegmentTension(seg[1], seg[0], seg[2], seg[3]);
    expect(start.tension).to.not.be.closeTo(segmentTension, 1e-6);
  });

  it("calculateHandleMeasure measures the end handle from the end anchor", () => {
    const seg = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ];
    const m = calculateHandleMeasure(seg, "end");
    expect(m.distance).to.be.closeTo(100, 1e-6);
  });

  it("calculateHandleMeasure rejects malformed input", () => {
    expect(calculateHandleMeasure(null, "start")).to.equal(null);
    expect(calculateHandleMeasure([{ x: 0, y: 0 }], "start")).to.equal(null);
    expect(
      calculateHandleMeasure(
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
        ],
        "middle"
      )
    ).to.equal(null);
  });
});

// Q with a selection, hovering something else: the gaps between the two boxes, the way
// Figma measures between two layers. A point is a box of no size.
describe("distance-angle — the distance from a selection to what is hovered", () => {
  const box = (xMin, yMin, xMax, yMax) => ({ xMin, yMin, xMax, yMax });
  const plain = (measures) =>
    measures.map(({ p1, p2, value, guide }) =>
      guide ? { p1, p2, value, guide } : { p1, p2, value }
    );

  it("measures one gap between boxes side by side, across their shared height", () => {
    expect(
      plain(boxDistanceMeasures(box(0, 0, 10, 10), box(30, 5, 40, 20)))
    ).to.deep.equal([{ p1: { x: 10, y: 7.5 }, p2: { x: 30, y: 7.5 }, value: 20 }]);
  });

  it("measures both gaps between diagonal boxes, with guides to the far box", () => {
    expect(
      plain(boxDistanceMeasures(box(0, 0, 10, 10), box(30, 40, 40, 50)))
    ).to.deep.equal([
      {
        p1: { x: 10, y: 5 },
        p2: { x: 30, y: 5 },
        value: 20,
        guide: { p1: { x: 30, y: 5 }, p2: { x: 30, y: 40 } },
      },
      {
        p1: { x: 5, y: 10 },
        p2: { x: 5, y: 40 },
        value: 30,
        guide: { p1: { x: 5, y: 40 }, p2: { x: 30, y: 40 } },
      },
    ]);
  });

  it("measures to each edge of a box the selection sits inside", () => {
    expect(
      plain(boxDistanceMeasures(box(10, 10, 20, 20), box(0, 0, 40, 40))).map(
        (measure) => measure.value
      )
    ).to.deep.equal([10, 20, 10, 20]);
  });

  it("leaves out an edge the two boxes share", () => {
    expect(
      plain(boxDistanceMeasures(box(0, 10, 20, 20), box(0, 0, 40, 40))).map(
        (measure) => measure.value
      )
    ).to.deep.equal([20, 10, 20]);
  });

  it("measures point to point as x and y", () => {
    expect(
      plain(boxDistanceMeasures(box(0, 0, 0, 0), box(30, 40, 30, 40))).map(
        (measure) => measure.value
      )
    ).to.deep.equal([30, 40]);
  });

  it("measures the same whichever way round the boxes are", () => {
    const a = box(0, 0, 10, 10);
    const b = box(30, 40, 40, 50);
    expect(boxDistanceMeasures(b, a).map((measure) => measure.value)).to.deep.equal(
      boxDistanceMeasures(a, b).map((measure) => measure.value)
    );
  });
});

describe("which side of its handle a label goes", () => {
  it("both horizontal handles of a smooth top point go above, whatever their slope", () => {
    const top = { x: 100, y: 700 };
    // The left handle tips a hair up, the right a hair down; both curves fall away.
    expect(handleLabelGoesUp({ x: 40, y: 701 }, top, { x: 0, y: 350 })).to.equal(true);
    expect(handleLabelGoesUp({ x: 160, y: 699 }, top, { x: 200, y: 350 })).to.equal(
      true
    );
  });

  it("a mostly vertical handle points the way", () => {
    const side = { x: 0, y: 350 };
    expect(handleLabelGoesUp({ x: 1, y: 420 }, side, { x: 100, y: 700 })).to.equal(
      true
    );
    expect(handleLabelGoesUp({ x: 1, y: 280 }, side, { x: 100, y: 0 })).to.equal(false);
  });
});

describe("handleGizmoLines", () => {
  it("carries the handle's length, then its tension", () => {
    expect(handleGizmoLines({ distance: 55.04, tension: 0.5523 })).to.deep.equal([
      "55.0",
      "0.55",
    ]);
  });

  it("says n/a for a tension there is none of", () => {
    expect(handleGizmoLines({ distance: 10, tension: null })[1]).to.equal("n/a");
  });
});
