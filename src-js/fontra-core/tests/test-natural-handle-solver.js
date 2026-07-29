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
