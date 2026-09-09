import { solveNearestHandleScales } from "@fontra/core/harmonize-nearest.js";
import { expect } from "chai";

// A joint whose two sides bend by different amounts. The stencil order is
// [A, PP, P, node, N, NN, C].
function askewJoint() {
  return [
    { x: 0, y: 0 },
    { x: 0, y: 60 },
    { x: 40, y: 100 },
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 200, y: 60 },
    { x: 200, y: 0 },
  ];
}

// Both sides identical about the joint, so nothing needs to move.
function symmetricJoint() {
  return [
    { x: 0, y: 0 },
    { x: 0, y: 50 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 200, y: 50 },
    { x: 200, y: 0 },
  ];
}

function build(stencil, scales) {
  const scaled = (from, handle, scale) => ({
    x: from.x + (handle.x - from.x) * scale,
    y: from.y + (handle.y - from.y) * scale,
  });
  const [A, PP, P, node, N, NN, C] = stencil;
  return [
    A,
    scaled(A, PP, scales[0]),
    scaled(node, P, scales[1]),
    node,
    scaled(node, N, scales[2]),
    scaled(C, NN, scales[3]),
    C,
  ];
}

function curvatureStepOf(points) {
  const [A, PP, P, node, N, NN, C] = points;
  const kIn = endCurvature([A, PP, P, node], true);
  const kOut = endCurvature([node, N, NN, C], false);
  return Math.abs(kIn - kOut) / Math.max(Math.abs(kIn), Math.abs(kOut), 1e-12);
}

// Signed curvature at one end of a cubic, from its own control points.
function endCurvature([p0, p1, p2, p3], atEnd) {
  const [a, b, c] = atEnd ? [p3, p2, p1] : [p0, p1, p2];
  const first = { x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) };
  const second = { x: 6 * (c.x - 2 * b.x + a.x), y: 6 * (c.y - 2 * b.y + a.y) };
  const speed = Math.hypot(first.x, first.y);
  if (speed < 1e-9) {
    return 0;
  }
  const cross = first.x * second.y - first.y * second.x;
  const k = cross / (speed * speed * speed);
  return atEnd ? -k : k;
}

describe("solveNearestHandleScales", () => {
  it("matches the two curvatures exactly", () => {
    const stencil = askewJoint();
    const solved = solveNearestHandleScales(stencil, {});
    expect(solved.status).to.equal("solved");
    expect(curvatureStepOf(build(stencil, solved.scales))).to.be.below(1e-6);
  });

  it("leaves an already matched joint alone", () => {
    const solved = solveNearestHandleScales(symmetricJoint(), {});
    expect(solved.status).to.equal("skipped");
    expect(solved.reason).to.equal("already-harmonic");
    for (const scale of solved.scales) {
      expect(scale).to.equal(1);
    }
  });

  it("reaches a joint the two inner handles cannot reach alone", () => {
    // One side nearly flat and the other strongly bent. The two inner handles
    // run out of room before the two curvatures meet. All four reach it.
    const stencil = [
      { x: 0, y: 0 },
      { x: 0, y: 70 },
      { x: 30, y: 100 },
      { x: 100, y: 100 },
      { x: 180, y: 100 },
      { x: 240, y: 100 },
      { x: 240, y: -40 },
    ];
    // the outer two handles hold still, which is what the other constructions do
    const two = solveNearestHandleScales(stencil, { outerHandlesHold: true });
    expect(two.status).to.equal("partial");
    expect(two.reason).to.equal("tension-limited");

    const four = solveNearestHandleScales(stencil, {});
    expect(four.status).to.equal("solved");
    expect(curvatureStepOf(build(stencil, four.scales))).to.be.below(1e-6);
  });

  it("never lets a handle past the tension ceiling", () => {
    // both sides nearly straight, so matching two near-zero curvatures asks for
    // very long handles
    const stencil = [
      { x: 0, y: 0 },
      { x: 30, y: 1 },
      { x: 70, y: 2 },
      { x: 100, y: 2 },
      { x: 140, y: 2 },
      { x: 180, y: 1 },
      { x: 220, y: 0 },
    ];
    const solved = solveNearestHandleScales(stencil, {});
    const points = build(stencil, solved.scales);
    for (const [segment, nearSide] of [
      [points.slice(0, 4), "start"],
      [points.slice(0, 4), "end"],
      [points.slice(3, 7), "start"],
      [points.slice(3, 7), "end"],
    ]) {
      expect(tensionOf(segment, nearSide)).to.be.at.most(1 + 1e-9);
    }
  });

  it("says tension-limited rather than harmonized where a limit stopped it", () => {
    const stencil = [
      { x: 0, y: 0 },
      { x: 30, y: 1 },
      { x: 70, y: 2 },
      { x: 100, y: 2 },
      { x: 140, y: 2 },
      { x: 180, y: 1 },
      { x: 220, y: 0 },
    ];
    const solved = solveNearestHandleScales(stencil, {});
    if (solved.curvatureStep > 1e-6) {
      expect(solved.status).to.equal("partial");
      expect(solved.reason).to.equal("tension-limited");
    }
  });

  it("keeps every handle at one unit or longer", () => {
    const stencil = askewJoint();
    const solved = solveNearestHandleScales(stencil, {});
    const points = build(stencil, solved.scales);
    const lengths = [
      Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y),
      Math.hypot(points[4].x - points[3].x, points[4].y - points[3].y),
      Math.hypot(points[5].x - points[6].x, points[5].y - points[6].y),
    ];
    for (const length of lengths) {
      expect(length).to.be.at.least(1 - 1e-9);
    }
  });

  it("is continuous in its input", () => {
    // Walk the far on-curve point through 120 units in quarter-unit steps and
    // measure the worst single-step movement of the answer. A per-configuration
    // assertion has missed every fault of this kind in this project.
    const base = askewJoint();
    let worst = 0;
    let previous = null;
    for (let d = -60; d <= 60 + 1e-9; d += 0.25) {
      const stencil = base.map((p) => ({ x: p.x, y: p.y }));
      stencil[6] = { x: stencil[6].x + d, y: stencil[6].y };
      const solved = solveNearestHandleScales(stencil, {});
      const points = build(stencil, solved.scales);
      // measured against the input, so the driver's own travel does not count
      const answer = points.map((p, i) => ({
        x: p.x - stencil[i].x,
        y: p.y - stencil[i].y,
      }));
      if (previous) {
        let step = 0;
        for (let i = 0; i < answer.length; i++) {
          step += Math.hypot(answer[i].x - previous[i].x, answer[i].y - previous[i].y);
        }
        worst = Math.max(worst, step);
      }
      previous = answer;
    }
    expect(worst).to.be.below(2);
  });
});

// The tension of one handle: its length over the distance from its own on-curve
// point to the segment's tangent-ray crossing.
function tensionOf(points, nearSide) {
  const [p0, p1, p2, p3] = points;
  const direction = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  const d1 = direction(p0, p1);
  const d2 = direction(p3, p2);
  const denominator = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denominator) < 1e-12) {
    return 0;
  }
  const t = ((p3.x - p0.x) * d2.y - (p3.y - p0.y) * d2.x) / denominator;
  if (t <= 0) {
    return 0;
  }
  const crossing = { x: p0.x + d1.x * t, y: p0.y + d1.y * t };
  const [onCurve, handle] = nearSide === "start" ? [p0, p1] : [p3, p2];
  const reach = Math.hypot(crossing.x - onCurve.x, crossing.y - onCurve.y);
  return reach
    ? Math.hypot(handle.x - onCurve.x, handle.y - onCurve.y) / reach
    : Infinity;
}
