import {
  handleOwnerIndex,
  slideHandleAlongItself,
} from "@fontra/core/handle-length.js";
import { expect } from "chai";

const on = (x, y) => ({ x, y });
const off = (x, y) => ({ x, y, type: "cubic" });

describe("handleOwnerIndex", () => {
  const cubic = [on(0, 0), off(0, 50), off(50, 100), on(100, 100)];

  it("gives each cubic handle the on-curve next to it", () => {
    expect(handleOwnerIndex(cubic, false, 1)).to.equal(0);
    expect(handleOwnerIndex(cubic, false, 2)).to.equal(3);
  });

  it("wraps around a closed contour", () => {
    const points = [off(0, 50), off(50, 100), on(100, 100), on(0, 0)];
    expect(handleOwnerIndex(points, true, 0)).to.equal(3);
  });

  it("gives an on-curve point no owner", () => {
    expect(handleOwnerIndex(cubic, false, 0)).to.equal(-1);
  });

  it("gives a single quadratic control point no owner", () => {
    const points = [on(0, 0), { x: 50, y: 50, type: "quad" }, on(100, 0)];
    expect(handleOwnerIndex(points, false, 1)).to.equal(-1);
  });

  it("gives a point inside a quadratic chain no owner", () => {
    const quad = (x, y) => ({ x, y, type: "quad" });
    const points = [on(0, 0), quad(10, 50), quad(50, 60), quad(90, 50), on(100, 0)];
    expect(handleOwnerIndex(points, false, 2)).to.equal(-1);
  });
});

describe("slideHandleAlongItself", () => {
  it("keeps the angle and takes only the movement along the handle", () => {
    const moved = slideHandleAlongItself(on(0, 0), on(30, 40), { x: 30, y: -100 });
    // The handle points (0.6, 0.8) and is 50 long; the delta projects to
    // 18 - 80 = -62, which is past the on-curve, so it stops there.
    expect(Math.hypot(moved.x, moved.y)).to.be.closeTo(0, 1e-9);
    const grown = slideHandleAlongItself(on(0, 0), on(30, 40), { x: 6, y: 8 });
    expect(grown.x).to.be.closeTo(36, 1e-9);
    expect(grown.y).to.be.closeTo(48, 1e-9);
  });

  it("ignores movement across the handle", () => {
    const moved = slideHandleAlongItself(on(10, 10), on(10, 60), { x: 25, y: 0 });
    expect(moved).to.deep.equal({ x: 10, y: 60 });
  });

  it("stops on its own on-curve point rather than passing through it", () => {
    const moved = slideHandleAlongItself(on(0, 0), on(0, 20), { x: 0, y: -50 });
    expect(moved.x).to.be.closeTo(0, 1e-9);
    expect(moved.y).to.be.closeTo(0, 1e-9);
  });

  it("does not move a handle that has no direction", () => {
    const moved = slideHandleAlongItself(on(5, 5), on(5, 5), { x: 10, y: 10 });
    expect(moved).to.deep.equal({ x: 5, y: 5 });
  });
});
