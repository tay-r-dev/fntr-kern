import {
  buildHandleDomain,
  solveNaturalHandles,
} from "@fontra/core/natural-handle-solver.js";
import { expect } from "chai";

const KAPPA = 0.5522847498307933;

function quarterCircle(radius) {
  return [
    { x: radius, y: 0 },
    { x: radius, y: radius * KAPPA },
    { x: radius * KAPPA, y: radius },
    { x: 0, y: radius },
  ];
}

function arcRequest(sourceRadius, offset) {
  const skeletonControlPoints = quarterCircle(sourceRadius);
  const outline = quarterCircle(sourceRadius + offset);
  const startHandleDirection = { x: 0, y: 1 };
  const endHandleDirection = { x: 1, y: 0 };
  return {
    skeletonControlPoints,
    startSignedWidth: offset,
    endSignedWidth: offset,
    startOutlinePoint: outline[0],
    endOutlinePoint: outline[3],
    startHandleDirection,
    endHandleDirection,
    handleDomain: buildHandleDomain(
      outline[0],
      outline[3],
      startHandleDirection,
      endHandleDirection
    ),
  };
}

function unit(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function requestFor(points, startSignedWidth, endSignedWidth) {
  const [p0, p1, p2, p3] = points;
  const startHandleDirection = unit({ x: p1.x - p0.x, y: p1.y - p0.y });
  const endHandleDirection = unit({ x: p2.x - p3.x, y: p2.y - p3.y });
  const startNormal = {
    x: startHandleDirection.y,
    y: -startHandleDirection.x,
  };
  const endNormal = {
    x: -endHandleDirection.y,
    y: endHandleDirection.x,
  };
  const startOutlinePoint = {
    x: p0.x + startNormal.x * startSignedWidth,
    y: p0.y + startNormal.y * startSignedWidth,
  };
  const endOutlinePoint = {
    x: p3.x + endNormal.x * endSignedWidth,
    y: p3.y + endNormal.y * endSignedWidth,
  };
  return {
    skeletonControlPoints: points,
    startSignedWidth,
    endSignedWidth,
    startOutlinePoint,
    endOutlinePoint,
    startHandleDirection,
    endHandleDirection,
    handleDomain: buildHandleDomain(
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection
    ),
  };
}

function makeTightTaperRequest({
  startSkeletonLength = 40,
  endSkeletonLength = 100,
} = {}) {
  return requestFor(
    [
      { x: 0, y: 0 },
      { x: startSkeletonLength, y: 0 },
      { x: 140, y: 75 - endSkeletonLength },
      { x: 140, y: 75 },
    ],
    25,
    110
  );
}

function makeTightTurnRequest(width) {
  return requestFor(
    [
      { x: 0, y: 0 },
      { x: 20, y: 90 },
      { x: 120, y: 90 },
      { x: 140, y: 0 },
    ],
    -width,
    -width
  );
}

describe("natural-handle-solver: fixed perpendicular fit", () => {
  it("uses the chord cap when a tangent intersection is behind an endpoint", () => {
    const domain = buildHandleDomain(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 1, y: 0 },
      { x: 0, y: 1 }
    );
    expect(domain.startReach).to.be.closeTo(100, 1e-9);
    expect(domain.endReach).to.be.closeTo(200 * Math.sqrt(2), 1e-9);
  });

  it("recovers a circular offset without rematching samples", () => {
    const result = solveNaturalHandles(arcRequest(100, 25));
    expect(result.startLength).to.be.closeTo(125 * KAPPA, 0.1);
    expect(result.endLength).to.be.closeTo(125 * KAPPA, 0.1);
    expect(result.perpendicularRms).to.be.below(0.1);
    expect(result.pullWeightRatio).to.be.below(0.01);
  });

  it("is deterministic and does not mutate its request", () => {
    const request = arcRequest(100, -25);
    const before = structuredClone(request);
    expect(solveNaturalHandles(request)).to.deep.equal(solveNaturalHandles(request));
    expect(request).to.deep.equal(before);
  });
});

describe("natural-handle-solver: constrained answer", () => {
  it("keeps both lengths inside the positive non-crossing domain", () => {
    const request = {
      ...arcRequest(30, -80),
      startSignedWidth: -80,
      endSignedWidth: -80,
    };
    const { handleDomain } = request;
    const result = solveNaturalHandles(request);
    expect(result.startLength / handleDomain.startReach).to.be.within(
      handleDomain.minStartTension,
      handleDomain.maxStartTension
    );
    expect(result.endLength / handleDomain.endReach).to.be.within(
      handleDomain.minEndTension,
      handleDomain.maxEndTension
    );
  });

  for (const { name, points, expected } of [
    {
      name: "coincident controls",
      points: Array(4).fill({ x: 10, y: 10 }),
      expected: { startLength: 1, endLength: 1 },
    },
    {
      name: "retracted handles",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
      ],
      expected: { startLength: 1, endLength: 1 },
    },
    {
      name: "straight control polygon",
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 60, y: 0 },
        { x: 90, y: 0 },
      ],
      expected: { startLength: 30, endLength: 30 },
    },
  ]) {
    it(`returns the finite reference answer for ${name}`, () => {
      const start = points[0];
      const end = points[3];
      const startDirection = { x: 1, y: 0 };
      const endDirection = { x: -1, y: 0 };
      const startOutlinePoint = { x: start.x, y: start.y + 25 };
      const endOutlinePoint = { x: end.x, y: end.y + 25 };
      const result = solveNaturalHandles({
        skeletonControlPoints: points,
        startSignedWidth: 25,
        endSignedWidth: 25,
        startOutlinePoint,
        endOutlinePoint,
        startHandleDirection: startDirection,
        endHandleDirection: endDirection,
        handleDomain: buildHandleDomain(
          startOutlinePoint,
          endOutlinePoint,
          startDirection,
          endDirection
        ),
      });
      expect(Number.isFinite(result.startLength)).to.equal(true);
      expect(Number.isFinite(result.endLength)).to.equal(true);
      expect(result.startLength).to.be.closeTo(expected.startLength, 1e-6);
      expect(result.endLength).to.be.closeTo(expected.endLength, 1e-6);
    });
  }

  it("meets the representative coordinate-step ceiling", () => {
    const base = makeTightTurnRequest(120);
    const points = base.skeletonControlPoints.map((point, index) =>
      index === 1 ? { ...point, x: point.x + 1 } : point
    );
    const perturbed = requestFor(points, base.startSignedWidth, base.endSignedWidth);
    const before = solveNaturalHandles(base);
    const after = solveNaturalHandles(perturbed);
    const moved = Math.max(
      Math.abs(after.startLength - before.startLength),
      Math.abs(after.endLength - before.endLength)
    );
    expect(moved).to.be.at.most(3);
  });

  it("takes the reference tension along a rank-one null direction", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ];
    const startOutlinePoint = { x: 0, y: 25 };
    const endOutlinePoint = { x: 90, y: 25 };
    const startHandleDirection = { x: 1, y: 0 };
    const endHandleDirection = { x: 0, y: -1 };
    const domain = buildHandleDomain(
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection
    );
    const result = solveNaturalHandles({
      skeletonControlPoints: points,
      startSignedWidth: 25,
      endSignedWidth: 25,
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection,
      handleDomain: domain,
    });
    const expected = (30 / 180) * domain.startReach;
    expect(result.startLength).to.be.closeTo(expected, 1e-9);
  });
});
