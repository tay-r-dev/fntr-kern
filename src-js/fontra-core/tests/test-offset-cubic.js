import {
  endpointCurvature,
  offsetCubicSide,
  resetTensionBoundStats,
  tensionBoundStats,
} from "@fontra/core/offset-cubic.js";
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

  it("counts tension-bound evaluations", () => {
    resetTensionBoundStats();
    const source = quarterCircle(100);
    offsetCubicSide({
      ...source,
      d0: 10,
      d3: 10,
      q0: { x: 110, y: 0 },
      q3: { x: 0, y: 110 },
      u0: { x: 0, y: 1 },
      u1: { x: 1, y: 0 },
    });
    expect(tensionBoundStats.evaluated).to.equal(2);
  });

  it("leaves ordinary offsets exactly unchanged", () => {
    resetTensionBoundStats();
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
    expect(tensionBoundStats.active).to.equal(0);
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
