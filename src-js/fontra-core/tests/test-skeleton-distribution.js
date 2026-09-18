import { expect } from "chai";
import {
  applySkeletonDistributionDelta,
  calculateNormalAtSkeletonPoint,
  getSkeletonPointHalfWidth,
  getSkeletonPointWidth,
} from "@fontra/core/skeleton-model.js";

// A straight vertical centerline, so the normal runs along x and a sideways
// drag is read whole.
function skeleton({ left = 35, right = 35, singleSided = null, locked = null } = {}) {
  const point = (id, y) => ({
    id,
    x: 100,
    y,
    type: null,
    smooth: false,
    width: { left, right, linked: true, tied: false },
    ...(locked
      ? {
          locked: {
            left: { handles: false, slide: false, width: locked === "left" },
            right: { handles: false, slide: false, width: locked === "right" },
          },
        }
      : {}),
  });
  return {
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 70,
        singleSided,
        insertions: [],
        points: [point(2, 0), point(3, 200)],
      },
    ],
  };
}

function drag(options, delta) {
  const original = skeleton(options);
  const working = structuredClone(original);
  const changed = applySkeletonDistributionDelta(
    original,
    working,
    new Set(["skeletonPoint/1/2"]),
    "skeletonPoint/1/2",
    delta
  );
  return { original, working, changed, point: working.contours[0].points[0] };
}

describe("A on a skeleton point: the outline stands still", () => {
  it("trades the two half-widths, so both edges hold", () => {
    const { point, original } = drag({}, { x: 10, y: 0 });
    const before = original.contours[0].points[0];
    const normal = calculateNormalAtSkeletonPoint(original.contours[0], 0);
    // Where each edge stands: the point, plus its half-width along the normal
    // for the left side and against it for the right.
    const edges = (p, contour) => ({
      left: {
        x: p.x + normal.x * getSkeletonPointHalfWidth(p, 70, "left"),
        y: p.y + normal.y * getSkeletonPointHalfWidth(p, 70, "left"),
      },
      right: {
        x: p.x - normal.x * getSkeletonPointHalfWidth(p, 70, "right"),
        y: p.y - normal.y * getSkeletonPointHalfWidth(p, 70, "right"),
      },
    });
    expect(Math.abs(point.x - before.x)).to.equal(10);
    expect(edges(point)).to.deep.equal(edges(before));
    // The total is untouched: this is a distribution, not a width edit.
    expect(getSkeletonPointWidth(point, 70)).to.equal(70);
  });

  it("carries the drag along the stroke nowhere", () => {
    const { point, changed } = drag({}, { x: 0, y: 25 });
    expect(changed).to.equal(true);
    expect(point.y).to.equal(0);
    expect(getSkeletonPointHalfWidth(point, 70, "left")).to.equal(35);
  });

  it("writes the total on a single-sided contour, and moves the point", () => {
    const { point, original } = drag({ singleSided: "left" }, { x: 10, y: 0 });
    const before = original.contours[0].points[0];
    const normal = calculateNormalAtSkeletonPoint(original.contours[0], 0);
    expect(Math.abs(point.x - before.x)).to.equal(10);
    // The one visible edge holds, so the total pays the whole travel.
    const visibleEdge = (p) => p.x + normal.x * getSkeletonPointWidth(p, 70);
    expect(visibleEdge(point)).to.equal(visibleEdge(before));
  });

  it("stops the travel where the giving side reaches its floor", () => {
    const { point, original } = drag({ left: 3, right: 35 }, { x: 60, y: 0 });
    const travel = Math.abs(point.x - original.contours[0].points[0].x);
    expect(travel).to.equal(2);
    expect(getSkeletonPointHalfWidth(point, 70, "left")).to.equal(1);
  });

  it("holds the point still when either side's width is locked", () => {
    const { point, changed } = drag({ locked: "right" }, { x: 10, y: 0 });
    expect(changed).to.equal(false);
    expect(point.x).to.equal(100);
    expect(getSkeletonPointHalfWidth(point, 70, "left")).to.equal(35);
  });
});
