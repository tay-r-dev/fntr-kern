import { endpointCurvature, offsetCubicSide } from "@fontra/core/offset-cubic.js";
import { expect } from "chai";

const KAPPA = 0.5522847498307933;

function quarterCircle(r) {
  return {
    p0: { x: r, y: 0 },
    p1: { x: r, y: r * KAPPA },
    p2: { x: r * KAPPA, y: r },
    p3: { x: 0, y: r },
  };
}

function arcEndpointCurvature(r) {
  return (2 * (1 - KAPPA)) / (3 * KAPPA ** 2 * r);
}

function ribInputs(p0, p1, p2, p3, d0, d3) {
  const unit = (v) => {
    const length = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / length, y: v.y / length };
  };
  const start = unit({ x: p1.x - p0.x, y: p1.y - p0.y });
  const end = unit({ x: p3.x - p2.x, y: p3.y - p2.y });
  return {
    q0: { x: p0.x + start.y * d0, y: p0.y - start.x * d0 },
    q3: { x: p3.x + end.y * d3, y: p3.y - end.x * d3 },
    u0: start,
    u1: { x: -end.x, y: -end.y },
  };
}

describe("offset-cubic: endpointCurvature", () => {
  it("matches the closed form at both ends of an arc", () => {
    const { p0, p1, p2, p3 } = quarterCircle(100);
    const expected = arcEndpointCurvature(100);
    expect(endpointCurvature(p0, p1, p2, p3, false)).to.be.closeTo(expected, 1e-9);
    expect(endpointCurvature(p0, p1, p2, p3, true)).to.be.closeTo(expected, 1e-9);
  });

  it("is positive for a counter-clockwise arc and negative for clockwise", () => {
    const ccw = quarterCircle(100);
    expect(endpointCurvature(ccw.p0, ccw.p1, ccw.p2, ccw.p3, false)).to.be.above(0);
    expect(endpointCurvature(ccw.p3, ccw.p2, ccw.p1, ccw.p0, false)).to.be.below(0);
  });

  it("is zero on a straight segment", () => {
    expect(
      endpointCurvature(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        false
      )
    ).to.be.closeTo(0, 1e-9);
  });

  it("is zero when the end tangent is degenerate", () => {
    const p0 = { x: 0, y: 0 };
    expect(endpointCurvature(p0, p0, { x: 10, y: 5 }, { x: 20, y: 0 }, false)).to.equal(
      0
    );
  });
});

describe("offset-cubic: bounds", () => {
  it("uses the chord backstop when tangent rays are parallel", () => {
    const { startLength } = offsetCubicSide({
      p0: { x: 0, y: 0 },
      p1: { x: 8, y: 26 },
      p2: { x: 32, y: 26 },
      p3: { x: 40, y: 0 },
      d0: 60,
      d3: 60,
      q0: { x: -60, y: 0 },
      q3: { x: 100, y: 0 },
      u0: { x: 0, y: 1 },
      u1: { x: 0, y: 1 },
    });
    expect(startLength).to.be.at.most(320 + 1e-6);
  });

  it("floors every handle at one unit", () => {
    const { startLength, endLength } = offsetCubicSide({
      p0: { x: 0, y: 0 },
      p1: { x: 6, y: 9 },
      p2: { x: 18, y: 9 },
      p3: { x: 24, y: 0 },
      d0: -40,
      d3: -40,
      q0: { x: 0, y: 40 },
      q3: { x: 24, y: 40 },
      u0: { x: 1, y: 0 },
      u1: { x: -1, y: 0 },
    });
    expect(startLength).to.be.at.least(1);
    expect(endLength).to.be.at.least(1);
  });

  it("leaves ordinary offsets exactly unchanged", () => {
    const source = quarterCircle(100);
    const k = arcEndpointCurvature(100);
    const { startLength } = offsetCubicSide({
      ...source,
      d0: 15,
      d3: 15,
      q0: { x: 115, y: 0 },
      q3: { x: 0, y: 115 },
      u0: { x: 0, y: 1 },
      u1: { x: 1, y: 0 },
    });
    expect(startLength).to.be.closeTo(63.50451538382562, 0.01);
  });
});

describe("offset-cubic: analytic length", () => {
  const u0 = { x: 0, y: 1 };
  const u1 = { x: 1, y: 0 };

  function lengthsFor(sourceRadius, d) {
    const source = quarterCircle(sourceRadius);
    const outer = quarterCircle(sourceRadius + d);
    return offsetCubicSide({
      ...source,
      d0: d,
      d3: d,
      q0: outer.p0,
      q3: outer.p3,
      u0,
      u1,
    });
  }

  it("scales the skeleton handle by 1 + d*curvature, outward", () => {
    const k = arcEndpointCurvature(100);
    const expected = 100 * KAPPA * (1 + 20 * k);
    const { startLength, endLength } = lengthsFor(100, 20);
    expect(startLength).to.be.closeTo(66.26319551740771, 0.01);
    expect(endLength).to.be.closeTo(66.26319551740771, 0.01);
  });

  it("scales the skeleton handle by 1 + d*curvature, inward", () => {
    const k = arcEndpointCurvature(100);
    const expected = 100 * KAPPA * (1 - 20 * k);
    const { startLength, endLength } = lengthsFor(100, -20);
    expect(startLength).to.be.closeTo(44.19375444875097, 0.01);
    expect(endLength).to.be.closeTo(44.19375444875097, 0.01);
  });

  it("reproduces the skeleton handle length at zero offset", () => {
    const { startLength, endLength } = lengthsFor(100, 0);
    expect(startLength).to.be.closeTo(100 * KAPPA, 0.01);
    expect(endLength).to.be.closeTo(100 * KAPPA, 0.01);
  });
});

describe("offset-cubic: degenerate inputs", () => {
  const cases = {
    "retracted start handle": [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ],
    "retracted end handle": [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
    ],
    "all four coincident": [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ],
    "collinear control polygon": [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ],
  };

  for (const [name, [p0, p1, p2, p3]] of Object.entries(cases)) {
    it(`produces finite lengths for ${name}`, () => {
      const { startLength, endLength } = offsetCubicSide({
        p0,
        p1,
        p2,
        p3,
        d0: 25,
        d3: 25,
        q0: { x: p0.x, y: p0.y + 25 },
        q3: { x: p3.x, y: p3.y + 25 },
        u0: { x: 1, y: 0 },
        u1: { x: -1, y: 0 },
      });
      expect(Number.isFinite(startLength), `${name} start`).to.equal(true);
      expect(Number.isFinite(endLength), `${name} end`).to.equal(true);
    });
  }
});

describe("offset-cubic: tracks the true offset", () => {
  // The true offset, defined independently of the module: walk the source cubic
  // and step off along its normal. Deviation is measured as a distance from the
  // true curve to the generated one, not as a displacement at matching t --
  // matching t is precisely the assumption that makes the fit wrong.
  function trueOffsetPoints(p0, p1, p2, p3, d0, d3, count = 41) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const m = 1 - t;
      const base = {
        x: m ** 3 * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t ** 3 * p3.x,
        y: m ** 3 * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t ** 3 * p3.y,
      };
      const deriv = {
        x:
          3 * m * m * (p1.x - p0.x) +
          6 * m * t * (p2.x - p1.x) +
          3 * t * t * (p3.x - p2.x),
        y:
          3 * m * m * (p1.y - p0.y) +
          6 * m * t * (p2.y - p1.y) +
          3 * t * t * (p3.y - p2.y),
      };
      const speed = Math.hypot(deriv.x, deriv.y);
      if (speed < 1e-9) {
        points.push(base);
        continue;
      }
      const d = d0 + (d3 - d0) * t;
      points.push({
        x: base.x + (deriv.y * d) / speed,
        y: base.y - (deriv.x * d) / speed,
      });
    }
    return points;
  }

  function maxDeviation([p0, p1, p2, p3], d0, d3) {
    const rib = ribInputs(p0, p1, p2, p3, d0, d3);
    const { startLength, endLength } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0,
      d3,
      ...rib,
    });
    const c1 = {
      x: rib.q0.x + rib.u0.x * startLength,
      y: rib.q0.y + rib.u0.y * startLength,
    };
    const c2 = {
      x: rib.q3.x + rib.u1.x * endLength,
      y: rib.q3.y + rib.u1.y * endLength,
    };
    const generated = [];
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const m = 1 - t;
      generated.push({
        x:
          m ** 3 * rib.q0.x +
          3 * m * m * t * c1.x +
          3 * m * t * t * c2.x +
          t ** 3 * rib.q3.x,
        y:
          m ** 3 * rib.q0.y +
          3 * m * m * t * c1.y +
          3 * m * t * t * c2.y +
          t ** 3 * rib.q3.y,
      });
    }
    let worst = 0;
    for (const target of trueOffsetPoints(p0, p1, p2, p3, d0, d3)) {
      let nearest = Infinity;
      for (const point of generated) {
        const squared = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
        if (squared < nearest) nearest = squared;
      }
      worst = Math.max(worst, Math.sqrt(nearest));
    }
    return worst;
  }

  const arc = quarterCircle(100);
  const arcPoints = [arc.p0, arc.p1, arc.p2, arc.p3];

  it("follows a circular arc offset outward", () => {
    expect(maxDeviation(arcPoints, 25, 25)).to.be.at.most(1);
  });

  it("follows a circular arc offset inward", () => {
    expect(maxDeviation(arcPoints, -40, -40)).to.be.at.most(1);
  });

  // An inflected segment is the worst case for a fit at fixed t: the offset is
  // stretched on one side of the inflection and compressed on the other, so the
  // parameter drifts in opposite directions either side of it.
  const sCurve = [
    { x: 0, y: 0 },
    { x: 60, y: 60 },
    { x: 120, y: -60 },
    { x: 180, y: 0 },
  ];

  it("follows an S-curve", () => {
    expect(maxDeviation(sCurve, 35, 35)).to.be.at.most(2.5);
  });

  it("follows an S-curve offset the other way", () => {
    expect(maxDeviation(sCurve, -35, -35)).to.be.at.most(2.5);
  });

  it("follows a tight turn offset inward", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 90 },
      { x: 120, y: 90 },
      { x: 140, y: 0 },
    ];
    expect(maxDeviation(points, -70, -70)).to.be.at.most(1.5);
  });

  it("follows a shallow curve at a wide offset", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 150, y: 40 },
      { x: 200, y: 0 },
    ];
    expect(maxDeviation(points, 70, 70)).to.be.at.most(1);
  });

  it("follows a segment whose handles differ in length", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 25, y: 60 },
      { x: 150, y: 75 },
      { x: 190, y: 0 },
    ];
    expect(maxDeviation(points, 50, 50)).to.be.at.most(1);
  });

  it("keeps a handle off the collapse floor", () => {
    // The un-reparameterized solve drives this one's start handle onto
    // MIN_HANDLE_LENGTH exactly, while the other end balloons to compensate.
    const points = [
      { x: 0, y: 0 },
      { x: 25, y: 60 },
      { x: 150, y: 75 },
      { x: 190, y: 0 },
    ];
    const [p0, p1, p2, p3] = points;
    const d = 70;
    const { startLength } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0: d,
      d3: d,
      ...ribInputs(p0, p1, p2, p3, d, d),
    });
    expect(startLength).to.be.above(3);
  });
});

describe("offset-cubic: continuity", () => {
  const configurations = [
    [
      { x: 0, y: 0 },
      { x: 40, y: 60 },
      { x: 120, y: 60 },
      { x: 160, y: 0 },
    ],
    [
      { x: 0, y: 0 },
      { x: 6, y: 9 },
      { x: 18, y: 9 },
      { x: 24, y: 0 },
    ],
    [
      { x: 0, y: 0 },
      { x: 20, y: 30 },
      { x: 60, y: 30 },
      { x: 80, y: 0 },
    ],
    [
      { x: 0, y: 0 },
      { x: 90, y: 70 },
      { x: -70, y: 70 },
      { x: 20, y: 0 },
    ],
  ];
  const build = ([p0, p1, p2, p3], d0, d3) =>
    offsetCubicSide({ p0, p1, p2, p3, d0, d3, ...ribInputs(p0, p1, p2, p3, d0, d3) });
  const moved = (a, b) =>
    Math.max(
      Math.abs(a.startLength - b.startLength),
      Math.abs(a.endLength - b.endLength)
    );
  const EPS = 1e-4;
  for (const points of configurations) {
    it("has bounded response to every coordinate and width perturbation", () => {
      for (let i = 0; i < 4; i++)
        for (const axis of ["x", "y"]) {
          const nudged = points.map((p, index) =>
            index === i ? { ...p, [axis]: p[axis] + EPS } : p
          );
          expect(moved(build(points, 25, 25), build(nudged, 25, 25))).to.be.at.most(
            0.2
          );
        }
      expect(moved(build(points, 25, 25), build(points, 25, 25 + EPS))).to.be.at.most(
        0.2
      );
    });
  }
  it("has no jump along a 200-step drag", () => {
    const base = [{ x: 0, y: 0 }, { x: 30, y: 45 }, null, { x: 120, y: 0 }];
    let previous;
    let worst = 0;
    for (let step = 0; step <= 200; step++) {
      const current = build(
        [base[0], base[1], { x: 90 - step * 0.8, y: 45 }, base[3]],
        35,
        35
      );
      if (previous) worst = Math.max(worst, moved(previous, current));
      previous = current;
    }
    expect(worst).to.be.at.most(8);
  });
});

// The reported case: one skeleton segment, two states differing only in the
// tension of its own handles. The skeleton's two handle tensions are equal to
// within 0.003 in BOTH states, and the segment is the same otherwise: a 100
// degree turn between two straights, stroke tapering 40 -> 114 per side.
//
// The generated pair used to come out at (0.40, 0.99) and (0.60, 0.97) on the
// wide side and (0.73, 0.016) on the narrow one, so one handle always sat on a
// bound - the clamp at tension 1, or collapsed on the floor. A near-symmetric
// skeleton must not produce a near-degenerate generated pair.
describe("offset-cubic: keeps the generated split near the skeleton's", () => {
  const START = { x: 126, y: 210 };
  const END = { x: 442, y: 380 };
  const END_DIR = { x: 16 / 88.459, y: -87 / 88.459 };

  // Tension of each handle: its length over the distance to where the two
  // tangent rays meet. Same measure the module bounds against.
  function tensions(p0, p1, p2, p3, d0, d3) {
    const rib = ribInputs(p0, p1, p2, p3, d0, d3);
    const { startLength, endLength } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0,
      d3,
      ...rib,
    });
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const between = { x: rib.q3.x - rib.q0.x, y: rib.q3.y - rib.q0.y };
    const denominator = cross(rib.u0, { x: -rib.u1.x, y: -rib.u1.y });
    const startReach = cross(between, { x: -rib.u1.x, y: -rib.u1.y }) / denominator;
    const endReach = cross(rib.u0, between) / denominator;
    return { start: startLength / startReach, end: endLength / endReach };
  }

  function segment(startHandle, endHandle) {
    return [
      START,
      { x: START.x + startHandle, y: START.y },
      { x: END.x + END_DIR.x * endHandle, y: END.y + END_DIR.y * endHandle },
      END,
    ];
  }

  // Both states, both sides. Skeleton reaches are 347.3 and 172.9, so these
  // handle pairs are equal-tension skeletons to within 0.003.
  const states = {
    "low tension (0.51)": segment(179, 88.459),
    "high tension (0.75)": segment(262, 130.231),
  };

  // Measured ratio between the two tensions, before this changed -> after:
  //   low  outer 2.46 -> 1.66     low  inner 33.0 -> 1.03
  //   high outer 1.62 -> 1.42     high inner 2.90 -> 1.57
  // The ceiling itself is not the complaint: the high-tension inner side still
  // saturates one handle at exactly 1, because its fit asks for 1.29 and 1 is
  // the wall. What must not happen is its partner being starved to 0.345 for it.
  for (const [name, [p0, p1, p2, p3]] of Object.entries(states)) {
    for (const [side, d0, d3] of [
      ["outer", 40, 114],
      ["inner", -40, -114],
    ]) {
      it(`spreads the tension across both handles, ${side} side, ${name}`, () => {
        const t = tensions(p0, p1, p2, p3, d0, d3);
        const low = Math.min(t.start, t.end);
        const high = Math.max(t.start, t.end);
        expect(low, "starved handle").to.be.above(0.3);
        expect(high / low, "tension ratio").to.be.at.most(1.8);
      });
    }
  }

  it("moves smoothly as the skeleton tension is swept through the collapse", () => {
    let previous = null;
    let worst = 0;
    for (let endHandle = 60; endHandle <= 200; endHandle += 1) {
      const [p0, p1, p2, p3] = segment((endHandle * 347.3) / 172.9, endHandle);
      const rib = ribInputs(p0, p1, p2, p3, -40, -114);
      const current = offsetCubicSide({ p0, p1, p2, p3, d0: -40, d3: -114, ...rib });
      if (previous) {
        worst = Math.max(
          worst,
          Math.abs(current.startLength - previous.startLength),
          Math.abs(current.endLength - previous.endLength)
        );
      }
      previous = current;
    }
    expect(worst, "jump per unit of skeleton handle").to.be.at.most(6);
  });
});
