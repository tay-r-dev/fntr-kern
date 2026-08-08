import { makeSerifWall } from "@fontra/core/serif-wall.js";
import { expect } from "chai";

// A line wall standing straight up the depth axis from u = 50. This is exactly
// what the old straight-flank model assumed, so it is the parity case.
const straight = () =>
  makeSerifWall([
    { u: 50, v: 0 },
    { u: 50, v: 400 },
  ]);

// A wall that leans and bends away from the depth axis, which is what a curved
// stem produces.
const curved = () =>
  makeSerifWall([
    { u: 50, v: 0 },
    { u: 40, v: 100 },
    { u: 10, v: 200 },
    { u: -60, v: 300 },
  ]);

const close = (actual, expected, tolerance = 1e-6) =>
  expect(Math.abs(actual - expected)).to.be.lessThan(tolerance);

describe("serif wall", () => {
  it("finds a point at a requested depth on a straight wall", () => {
    const wall = straight();
    const point = wall.pointAt(wall.parameterAtDepth(120));
    close(point.v, 120, 1e-4);
    close(point.u, 50, 1e-4);
  });

  it("finds a point at a requested depth on a curved wall", () => {
    const wall = curved();
    const point = wall.pointAt(wall.parameterAtDepth(120));
    close(point.v, 120, 1e-3);
    // The curved wall has moved inward by that depth, which the straight model
    // could not see at all.
    expect(point.u).to.be.lessThan(45);
  });

  it("clamps a depth request past its own reach to its maximum", () => {
    const wall = curved();
    expect(wall.parameterAtDepth(100000)).to.equal(wall.maxParameter);
  });

  it("meets a ray that crosses it", () => {
    const wall = curved();
    // A ray from out on the wing, running inward and slightly deeper.
    const t = wall.meetRay({ u: 200, v: 60 }, { u: -1, v: 0.2 });
    expect(t).to.be.a("number");
    const hit = wall.pointAt(t);
    // The hit lies on the ray as well as on the wall.
    close((hit.u - 200) * 0.2 - (hit.v - 60) * -1, 0, 1e-3);
  });

  it("returns null for a ray that runs away from it", () => {
    const wall = curved();
    expect(wall.meetRay({ u: 200, v: 60 }, { u: 1, v: 0 })).to.equal(null);
  });

  it("points its tangent into the stroke", () => {
    const wall = curved();
    expect(wall.tangentAt(0.3).v).to.be.greaterThan(0);
  });

  it("stops short of consuming its whole segment", () => {
    const wall = straight();
    expect(wall.maxParameter).to.be.lessThan(1);
    expect(wall.maxDepth).to.be.lessThan(400);
  });
});

describe("serif wall arc length", () => {
  it("advances by true distance along a straight wall", () => {
    const wall = straight();
    const from = wall.parameterAtDepth(100);
    const to = wall.parameterAtDistance(from, 40);
    close(wall.pointAt(to).v, 140, 1e-3);
  });

  it("advances by true distance along a curved wall", () => {
    const wall = curved();
    const from = wall.parameterAtDepth(100);
    const a = wall.pointAt(from);
    const b = wall.pointAt(wall.parameterAtDistance(from, 40));
    // Straight-line distance is a touch under the arc it travelled, and nowhere
    // near the 40 of depth the old measurement would have advanced.
    expect(Math.hypot(b.u - a.u, b.v - a.v)).to.be.greaterThan(39);
    expect(Math.hypot(b.u - a.u, b.v - a.v)).to.be.at.most(40.001);
    expect(b.v - a.v).to.be.lessThan(39);
  });

  it("stops at its own limit", () => {
    const wall = curved();
    expect(wall.parameterAtDistance(0, 100000)).to.equal(wall.maxParameter);
  });

  it("reports the length it may be consumed for", () => {
    const wall = straight();
    close(wall.maxLength, 380, 1e-3);
    close(wall.lengthAt(wall.parameterAtDepth(100)), 100, 1e-3);
  });
});
