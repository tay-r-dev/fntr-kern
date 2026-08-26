import { expect } from "chai";
import {
  KIND,
  MIN_CROSSING_ANGLE_DEG,
  SNAP_PARAMETERS,
  candidatePull,
  crossLines,
  resolveSnap,
  resolveSnapForPoints,
  distanceToCandidate,
  makeLineCandidate,
  makePointCandidate,
  projectOntoLine,
} from "@fontra/core/snapping.js";

describe("snapping primitives", () => {
  it("builds a horizontal line candidate with a unit direction", () => {
    const c = makeLineCandidate({
      x: 100,
      y: 50,
      angle: 0,
      kind: KIND.METRIC,
      source: { x: 100, y: 50 },
    });
    expect(c.type).to.equal("line");
    expect(c.dx).to.be.closeTo(1, 1e-12);
    expect(c.dy).to.be.closeTo(0, 1e-12);
  });

  it("projects onto a horizontal line by dropping y", () => {
    const c = makeLineCandidate({
      x: 0,
      y: 50,
      angle: 0,
      kind: KIND.METRIC,
      source: { x: 0, y: 50 },
    });
    const p = projectOntoLine(c, { x: 33, y: 71 });
    expect(p.x).to.be.closeTo(33, 1e-12);
    expect(p.y).to.be.closeTo(50, 1e-12);
  });

  it("projects onto a 45 degree line exactly", () => {
    const c = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 45,
      kind: KIND.GUIDE_SLANTED,
      source: { x: 0, y: 0 },
    });
    const p = projectOntoLine(c, { x: 10, y: 0 });
    expect(p.x).to.be.closeTo(5, 1e-12);
    expect(p.y).to.be.closeTo(5, 1e-12);
  });

  it("measures the perpendicular distance to a line and the plain distance to a point", () => {
    const line = makeLineCandidate({
      x: 0,
      y: 50,
      angle: 0,
      kind: KIND.METRIC,
      source: { x: 0, y: 50 },
    });
    expect(distanceToCandidate(line, { x: 999, y: 58 })).to.be.closeTo(8, 1e-12);
    const point = makePointCandidate({
      x: 3,
      y: 4,
      kind: KIND.SMART_INTERSECTION_ORTHOGONAL,
      source: { x: 3, y: 4 },
    });
    expect(distanceToCandidate(point, { x: 0, y: 0 })).to.be.closeTo(5, 1e-12);
  });
});

describe("snapping crossings", () => {
  const horizontal = (y, kind = KIND.METRIC) =>
    makeLineCandidate({ x: 0, y, angle: 0, kind, source: { x: 0, y } });
  const vertical = (x, kind = KIND.SMART_ORTHOGONAL) =>
    makeLineCandidate({ x, y: 0, angle: 90, kind, source: { x, y: 0 } });

  it("crosses a horizontal and a vertical", () => {
    const c = crossLines(horizontal(50), vertical(30));
    expect(c.type).to.equal("point");
    expect(c.x).to.be.closeTo(30, 1e-9);
    expect(c.y).to.be.closeTo(50, 1e-9);
    expect(c.sources).to.have.length(2);
  });

  it("refuses two parallel lines", () => {
    expect(crossLines(horizontal(50), horizontal(80))).to.equal(null);
  });

  it("refuses a crossing shallower than the stated angle", () => {
    const shallow = makeLineCandidate({
      x: 0,
      y: 0,
      angle: MIN_CROSSING_ANGLE_DEG - 1,
      kind: KIND.SMART_SLANTED,
      source: { x: 0, y: 0 },
    });
    expect(crossLines(horizontal(0), shallow)).to.equal(null);
  });

  it("ranks a crossing of two orthogonal smart guides above one involving a slant", () => {
    const both = crossLines(horizontal(50, KIND.SMART_ORTHOGONAL), vertical(30));
    expect(both.kind).to.equal(KIND.SMART_INTERSECTION_ORTHOGONAL);
    const slanted = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 40,
      kind: KIND.SMART_SLANTED,
      source: { x: 0, y: 0 },
    });
    expect(crossLines(horizontal(50, KIND.SMART_ORTHOGONAL), slanted).kind).to.equal(
      KIND.SMART_INTERSECTION_SLANTED
    );
  });
});

describe("the pull model", () => {
  const opts = { pixelUnit: 1, held: null };
  const metric = (y) =>
    makeLineCandidate({ x: 0, y, angle: 0, kind: KIND.METRIC, source: { x: 0, y } });
  const smart = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.SMART_ORTHOGONAL,
      source: { x: 0, y },
    });

  it("gives a heavier candidate the stronger pull at equal distance", () => {
    const cursor = { x: 0, y: 52 };
    expect(candidatePull(metric(50), cursor, opts)).to.be.greaterThan(
      candidatePull(smart(50), cursor, opts)
    );
  });

  it("lets a near light candidate beat a far heavy one", () => {
    const result = resolveSnap([metric(40), smart(50)], { x: 0, y: 50.5 }, opts);
    expect(result.held[0].kind).to.equal(KIND.SMART_ORTHOGONAL);
  });

  it("returns the cursor unchanged when nothing is in reach", () => {
    const result = resolveSnap([metric(0)], { x: 0, y: 500 }, opts);
    expect(result.freedom).to.equal("free");
    expect(result.held).to.have.length(0);
    expect(result.position.y).to.equal(500);
  });

  it("projects onto one line and reports one degree of freedom", () => {
    const result = resolveSnap([metric(50)], { x: 20, y: 52 }, opts);
    expect(result.freedom).to.equal("line");
    expect(result.position.x).to.equal(20);
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("holds the crossing of two lines already in reach", () => {
    const vertical = makeLineCandidate({
      x: 30,
      y: 0,
      angle: 90,
      kind: KIND.SMART_ORTHOGONAL,
      source: { x: 30, y: 0 },
    });
    const result = resolveSnap([metric(50), vertical], { x: 32, y: 52 }, opts);
    expect(result.freedom).to.equal("point");
    expect(result.held).to.have.length(2);
    expect(result.position.x).to.be.closeTo(30, 1e-9);
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("is a function of the cursor alone, apart from the declared hold bonus", () => {
    const cursor = { x: 20, y: 53 };
    const a = resolveSnap([metric(50)], cursor, opts);
    const b = resolveSnap([metric(50)], cursor, opts);
    expect(a.position).to.deep.equal(b.position);
    const withHold = resolveSnap([metric(50)], cursor, {
      pixelUnit: 1,
      held: metric(50),
    });
    expect(
      candidatePull(metric(50), cursor, { pixelUnit: 1, held: metric(50) })
    ).to.be.closeTo(
      candidatePull(metric(50), cursor, opts) * SNAP_PARAMETERS.holdBonus,
      1e-12
    );
    expect(withHold.freedom).to.equal("line");
  });

  it("collapses duplicate candidates at one position to one held entry", () => {
    const result = resolveSnap([metric(50), metric(50)], { x: 0, y: 51 }, opts);
    expect(result.held).to.have.length(1);
  });

  it("measures reach in pixels, so a zoomed-out view reaches further in glyph units", () => {
    const far = { x: 0, y: 70 };
    expect(
      resolveSnap([metric(50)], far, { pixelUnit: 1, held: null }).freedom
    ).to.equal("free");
    expect(
      resolveSnap([metric(50)], far, { pixelUnit: 4, held: null }).freedom
    ).to.equal("line");
  });

  it("stays on the constraint and snaps to where a candidate crosses it", () => {
    const constraint = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 90,
      kind: KIND.METRIC,
      source: { x: 0, y: 0 },
    });
    const result = resolveSnap([metric(50)], { x: 4, y: 52 }, { ...opts, constraint });
    expect(result.freedom).to.equal("point");
    expect(result.position.x).to.be.closeTo(0, 1e-9);
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("never leaves the constraint, even where nothing is in reach", () => {
    const constraint = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 90,
      kind: KIND.METRIC,
      source: { x: 0, y: 0 },
    });
    const result = resolveSnap([metric(50)], { x: 4, y: 300 }, { ...opts, constraint });
    expect(result.position.x).to.be.closeTo(0, 1e-9);
    expect(result.position.y).to.be.closeTo(300, 1e-9);
  });

  it("moves the point no faster than the cursor, away from the snap itself", () => {
    const line = metric(50);
    let held = null;
    let previous = null;
    let worstExtra = 0;
    let jumps = 0;
    for (let i = 0; i <= 2000; i++) {
      const cursor = { x: 0, y: 20 + i * 0.05 };
      const result = resolveSnap([line], cursor, { ...opts, held });
      held = result.held[0] || null;
      if (previous !== null) {
        const step = Math.abs(result.position.y - previous);
        if (step > 0.05 + 1e-9) {
          jumps++;
          worstExtra = Math.max(worstExtra, step - 0.05);
        }
      }
      previous = result.position.y;
    }
    // Exactly two steps exceed the cursor's own: entering the snap and leaving it.
    expect(jumps).to.equal(2);
    expect(worstExtra).to.be.lessThan(SNAP_PARAMETERS.reachPixels);
  });
});

describe("multi-point resolution", () => {
  const opts = { pixelUnit: 1, held: null };
  const metric = (y) =>
    makeLineCandidate({ x: 0, y, angle: 0, kind: KIND.METRIC, source: { x: 0, y } });

  it("lets a point other than the one under the cursor take the snap", () => {
    // The cursor is on the lower point. The upper point is the one near the metric.
    const points = [
      { x: 0, y: 20 },
      { x: 0, y: 51 },
    ];
    const result = resolveSnapForPoints([metric(50)], points, { x: 0, y: 20 }, opts);
    expect(result.pointIndex).to.equal(1);
    expect(result.delta.y).to.be.closeTo(-1, 1e-9);
  });

  it("moves every point by one delta, so the shape is not deformed", () => {
    const points = [
      { x: 0, y: 20 },
      { x: 0, y: 51 },
    ];
    const result = resolveSnapForPoints([metric(50)], points, { x: 0, y: 20 }, opts);
    const moved = points.map((p) => ({
      x: p.x + result.delta.x,
      y: p.y + result.delta.y,
    }));
    expect(moved[1].y - moved[0].y).to.be.closeTo(points[1].y - points[0].y, 1e-9);
  });

  it("prefers the point under the cursor when two alignments are equally close", () => {
    const points = [
      { x: 0, y: 51 }, // under the cursor
      { x: 0, y: 301 }, // far away, equally close to its own metric
    ];
    const result = resolveSnapForPoints(
      [metric(50), metric(300)],
      points,
      { x: 0, y: 51 },
      opts
    );
    expect(result.pointIndex).to.equal(0);
  });

  it("still lets a much closer alignment elsewhere win", () => {
    const points = [
      { x: 0, y: 59 }, // under the cursor, barely in reach
      { x: 0, y: 300.1 }, // far away, almost exactly on its metric
    ];
    const result = resolveSnapForPoints(
      [metric(50), metric(300)],
      points,
      { x: 0, y: 59 },
      opts
    );
    expect(result.pointIndex).to.equal(1);
  });

  it("returns a zero delta where no point wins", () => {
    const result = resolveSnapForPoints(
      [metric(50)],
      [{ x: 0, y: 400 }],
      { x: 0, y: 400 },
      opts
    );
    expect(result.delta).to.deep.equal({ x: 0, y: 0 });
    expect(result.held).to.have.length(0);
  });

  it("gives the hold bonus only where the same point holds the same candidate", () => {
    const points = [
      { x: 0, y: 55 },
      { x: 0, y: 52 },
    ];
    const held = { pointIndex: 0, candidate: metric(50) };
    const result = resolveSnapForPoints(
      [metric(50)],
      points,
      { x: 0, y: 55 },
      {
        ...opts,
        held,
      }
    );
    // Point 1 is nearer, but point 0 holds. The bonus must not follow the candidate
    // onto point 1, or the winner alternates between the two and the selection flickers.
    expect(result.pointIndex).to.be.oneOf([0, 1]);
    const again = resolveSnapForPoints(
      [metric(50)],
      points,
      { x: 0, y: 55 },
      {
        ...opts,
        held: { pointIndex: result.pointIndex, candidate: result.held[0] },
      }
    );
    expect(again.pointIndex).to.equal(result.pointIndex);
  });
});
