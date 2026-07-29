import { buildHandleDomain } from "@fontra/core/natural-handle-solver.js";
import { offsetCubicSide } from "@fontra/core/offset-cubic.js";
import { expect } from "chai";

function ribInputs(p0, p1, p2, p3, d0, d3) {
  const unit = (vector) => {
    const length = Math.hypot(vector.x, vector.y) || 1;
    return { x: vector.x / length, y: vector.y / length };
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

function authoredBaseRequest() {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 40, y: 0 };
  const p2 = { x: 80, y: 40 };
  const p3 = { x: 120, y: 40 };
  const d0 = 20;
  const d3 = 30;
  return {
    p0,
    p1,
    p2,
    p3,
    d0,
    d3,
    ...ribInputs(p0, p1, p2, p3, d0, d3),
  };
}

function changedSkeletonAndWidthRequest() {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 72, y: 0 };
  const p2 = { x: 105, y: 70 };
  const p3 = { x: 160, y: 70 };
  const d0 = 55;
  const d3 = 12;
  return {
    p0,
    p1,
    p2,
    p3,
    d0,
    d3,
    ...ribInputs(p0, p1, p2, p3, d0, d3),
  };
}

function harmonicMeanTension(handles, request) {
  const domain = buildHandleDomain(request.q0, request.q3, request.u0, request.u1);
  const start = handles.startLength / domain.startReach;
  const end = handles.endLength / domain.endReach;
  return (2 * start * end) / (start + end);
}

describe("offset-cubic: authored handle state", () => {
  it("applies attached adjustments after the natural answer", () => {
    const request = authoredBaseRequest();
    const base = offsetCubicSide(request);
    const adjusted = offsetCubicSide({
      ...request,
      startAdjustment: { x: 8, y: 0, detached: false },
    });
    expect(adjusted.startLength - base.startLength).to.be.closeTo(8, 1);
    expect(adjusted.endLength).to.be.closeTo(base.endLength, 1e-9);
  });

  it("sets the pinned harmonic-mean tension after attached adjustments", () => {
    const request = {
      ...authoredBaseRequest(),
      pinnedTension: 0.55,
      startAdjustment: { x: 8, y: 0, detached: false },
      endAdjustment: { x: -4, y: 0, detached: false },
    };
    const result = offsetCubicSide(request);
    expect(harmonicMeanTension(result, request)).to.be.closeTo(0.55, 1e-9);
  });

  it("keeps detached handles absolute when skeleton and widths change", () => {
    const adjustment = { x: 24, y: 0, detached: true };
    const first = offsetCubicSide({
      ...authoredBaseRequest(),
      startAdjustment: adjustment,
    });
    const second = offsetCubicSide({
      ...changedSkeletonAndWidthRequest(),
      startAdjustment: adjustment,
    });
    expect(first.startLength).to.equal(second.startLength);
  });

  it("is deterministic", () => {
    const request = {
      ...authoredBaseRequest(),
      pinnedTension: 0.55,
      startAdjustment: { x: 8, y: 0, detached: false },
    };
    expect(offsetCubicSide(request)).to.deep.equal(offsetCubicSide(request));
  });
});

describe("offset-cubic: bounds and degenerate inputs", () => {
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

  const degenerateCases = {
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

  for (const [name, [p0, p1, p2, p3]] of Object.entries(degenerateCases)) {
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

describe("offset-cubic: perturbation continuity", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 60 },
    { x: 120, y: 60 },
    { x: 160, y: 0 },
  ];
  const build = (controlPoints, d0, d3) => {
    const [p0, p1, p2, p3] = controlPoints;
    return offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0,
      d3,
      ...ribInputs(p0, p1, p2, p3, d0, d3),
    });
  };
  const moved = (first, second) =>
    Math.max(
      Math.abs(first.startLength - second.startLength),
      Math.abs(first.endLength - second.endLength)
    );

  it("has bounded response to every coordinate and width perturbation", () => {
    const epsilon = 1e-4;
    const base = build(points, 25, 25);
    for (let index = 0; index < 4; index++) {
      for (const axis of ["x", "y"]) {
        const nudged = points.map((point, pointIndex) =>
          pointIndex === index ? { ...point, [axis]: point[axis] + epsilon } : point
        );
        expect(moved(base, build(nudged, 25, 25))).to.be.at.most(0.2);
      }
    }
    expect(moved(base, build(points, 25, 25 + epsilon))).to.be.at.most(0.2);
  });
});

const U1 = {
  p0: { x: 408, y: 105 },
  p3: { x: 936, y: 338 },
  startHandleLength: 337,
  endHandleLength: Math.hypot(30, 162),
  startDirection: { x: 1, y: 0 },
  endDirection: {
    x: -30 / Math.hypot(30, 162),
    y: -162 / Math.hypot(30, 162),
  },
};

const u1Sides = {
  "single-sided right": {
    d0: -80,
    d3: -290,
    q0: { x: 408, y: 185 },
    q3: { x: 650, y: 388 },
  },
  "single-sided left": {
    d0: 80,
    d3: 290,
    q0: { x: 408, y: 25 },
    q3: { x: 1222, y: 288 },
  },
  "double-sided outer": {
    d0: 40,
    d3: 145,
    q0: { x: 408, y: 65 },
    q3: { x: 1079, y: 313 },
  },
  "double-sided inner": {
    d0: -40,
    d3: -145,
    q0: { x: 408, y: 145 },
    q3: { x: 793, y: 363 },
  },
};

function u1SkeletonAt(scale) {
  return {
    p0: U1.p0,
    p1: {
      x: U1.p0.x + U1.startDirection.x * U1.startHandleLength * scale,
      y: U1.p0.y + U1.startDirection.y * U1.startHandleLength * scale,
    },
    p2: {
      x: U1.p3.x + U1.endDirection.x * U1.endHandleLength * scale,
      y: U1.p3.y + U1.endDirection.y * U1.endHandleLength * scale,
    },
    p3: U1.p3,
  };
}

function sweepU1(side, authored = {}) {
  const at = (step) =>
    offsetCubicSide({
      ...u1SkeletonAt(0.5 + (step * 1.3) / 260),
      u0: U1.startDirection,
      u1: U1.endDirection,
      ...side,
      ...authored,
    });
  return {
    forward: Array.from({ length: 261 }, (_, step) => at(step)),
    reverse: Array.from({ length: 261 }, (_, step) => at(260 - step)),
  };
}

function sweepMetrics(values) {
  let worstStep = 0;
  let worstBacktrack = 0;
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    worstStep = Math.max(
      worstStep,
      Math.abs(current.startLength - previous.startLength),
      Math.abs(current.endLength - previous.endLength)
    );
    worstBacktrack = Math.max(
      worstBacktrack,
      previous.startLength - current.startLength,
      previous.endLength - current.endLength
    );
  }
  return { worstStep, worstBacktrack };
}

function expectContinuousMonotoneSweep(
  values,
  { maxStep = 3, maxBacktrack = 1e-9 } = {}
) {
  const { worstStep, worstBacktrack } = sweepMetrics(values);
  const diagnostic = `worst step ${worstStep}, worst backtrack ${worstBacktrack}`;
  expect(worstBacktrack, diagnostic).to.be.at.most(maxBacktrack);
  expect(worstStep, diagnostic).to.be.at.most(maxStep + 1e-9);
}

describe("offset-cubic: U^1 integration sweep", () => {
  for (const [name, side] of Object.entries(u1Sides)) {
    it(`is monotone and frame-independent for ${name}`, () => {
      const { forward, reverse } = sweepU1(side);
      expectContinuousMonotoneSweep(forward);
      expect(reverse).to.deep.equal([...forward].reverse());
    });

    it(`keeps a reachable pin continuous for ${name}`, () => {
      const { forward, reverse } = sweepU1(side, { pinnedTension: 0.55 });
      const { worstStep } = sweepMetrics(forward);
      expect(worstStep).to.be.at.most(3);
      expect(reverse).to.deep.equal([...forward].reverse());
    });

    it(`keeps attached adjustments continuous for ${name}`, () => {
      const startAmount = 8;
      const endAmount = 6;
      const { forward, reverse } = sweepU1(side, {
        startAdjustment: {
          x: U1.startDirection.x * startAmount,
          y: U1.startDirection.y * startAmount,
          detached: false,
        },
        endAdjustment: {
          x: U1.endDirection.x * endAmount,
          y: U1.endDirection.y * endAmount,
          detached: false,
        },
      });
      const withoutAdjustments = forward.map((handles) => ({
        startLength: handles.startLength - startAmount,
        endLength: handles.endLength - endAmount,
      }));
      expectContinuousMonotoneSweep(withoutAdjustments, {
        maxBacktrack: 1,
      });
      expect(reverse).to.deep.equal([...forward].reverse());
    });

    it(`keeps a detached handle absolute and its partner continuous for ${name}`, () => {
      const { forward, reverse } = sweepU1(side, {
        startAdjustment: { x: 24, y: 0, detached: true },
      });
      expect(new Set(forward.map((handles) => handles.startLength))).to.deep.equal(
        new Set([24])
      );
      expectContinuousMonotoneSweep(
        forward.map((handles) => ({
          startLength: 0,
          endLength: handles.endLength,
        }))
      );
      expect(reverse).to.deep.equal([...forward].reverse());
    });
  }
});
