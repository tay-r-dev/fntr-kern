import {
  centerlineCornerDistanceFor,
  getSkeletonCornerDistances,
  linkedCornerSideDistances,
  setSkeletonCornerDistribution,
  setSkeletonCornerLinked,
  setSkeletonCornerSideDistance,
} from "@fontra/core/skeleton-model.js";
import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import { expect } from "chai";

// A right angle, 20 units of stroke either side: the half turn is 45 degrees,
// so each side's reach off the centerline is its own half-width.
function rightAngleContour(corner) {
  return {
    id: 1,
    closed: false,
    defaultWidth: 40,
    singleSided: null,
    points: [
      { id: 2, x: 0, y: 0, smooth: false, width: { left: 20, right: 20 } },
      { id: 3, x: 200, y: 0, smooth: false, width: { left: 20, right: 20 }, corner },
      { id: 4, x: 200, y: 200, smooth: false, width: { left: 20, right: 20 } },
    ],
  };
}

const linked = (distance, distribution = 0) => ({
  linked: true,
  distance,
  distribution,
  left: { distance: 0, curvature: 0.55 },
  right: { distance: 0, curvature: 0.55 },
});

describe("linked corner rounding: the shared centre", () => {
  const rightAngle = {
    outerHalfWidth: 20,
    innerHalfWidth: 20,
    halfTurnTangent: 1,
    leftIsOuter: true,
  };

  it("offsets the two sides like a rounded centerline", () => {
    const sides = linkedCornerSideDistances({ ...rightAngle, distance: 30 });
    expect(sides.left).to.be.closeTo(50, 1e-9);
    expect(sides.right).to.be.closeTo(10, 1e-9);
  });

  it("keeps a zero distance sharp on both sides", () => {
    const sides = linkedCornerSideDistances({ ...rightAngle, distance: 0 });
    expect(sides).to.deep.equal({ left: 0, right: 0 });
  });

  it("grows without a jump from a sharp corner", () => {
    let previous = linkedCornerSideDistances({ ...rightAngle, distance: 0 });
    for (let distance = 0.1; distance <= 120; distance += 0.1) {
      const sides = linkedCornerSideDistances({ ...rightAngle, distance });
      expect(sides.left - previous.left).to.be.within(-1e-9, 0.2 + 1e-9);
      expect(sides.right - previous.right).to.be.within(-1e-9, 0.2 + 1e-9);
      previous = sides;
    }
  });

  it("gives a corner with no turn the same distance on both sides", () => {
    const sides = linkedCornerSideDistances({
      ...rightAngle,
      halfTurnTangent: 0,
      distance: 25,
    });
    expect(sides).to.deep.equal({ left: 25, right: 25 });
  });

  it("moves distance between the sides and keeps their sum", () => {
    for (let distribution = -100; distribution <= 100; distribution += 5) {
      const sides = linkedCornerSideDistances({
        ...rightAngle,
        distance: 30,
        distribution,
      });
      expect(sides.left + sides.right).to.be.closeTo(60, 1e-9);
    }
    const allLeft = linkedCornerSideDistances({
      ...rightAngle,
      distance: 30,
      distribution: 100,
    });
    const allRight = linkedCornerSideDistances({
      ...rightAngle,
      distance: 30,
      distribution: -100,
    });
    expect(allLeft).to.deep.equal({ left: 60, right: 0 });
    expect(allRight).to.deep.equal({ left: 0, right: 60 });
  });
});

describe("linked corner rounding on a skeleton point", () => {
  it("puts the longer distance on the side the generator treats as outer", () => {
    const contour = rightAngleContour(linked(30));
    const sides = getSkeletonCornerDistances(contour, contour.points[1]);
    const longer = sides.left > sides.right ? "left" : "right";
    expect(Math.max(sides.left, sides.right)).to.be.closeTo(50, 1e-6);
    expect(Math.min(sides.left, sides.right)).to.be.closeTo(10, 1e-6);

    // The same corner, unlinked, with the resolved numbers typed in by hand, must
    // generate the same outline: the generator reads the linked form through the
    // resolver and nothing else.
    const unlinked = rightAngleContour({
      linked: false,
      left: { distance: sides.left, curvature: 0.55 },
      right: { distance: sides.right, curvature: 0.55 },
    });
    const outline = (skeletonContour) =>
      JSON.stringify(
        generateFromSkeleton({ version: 1, nextId: 5, contours: [skeletonContour] })
          .contours
      );
    expect(outline(contour)).to.equal(outline(unlinked));
    expect(longer).to.be.oneOf(["left", "right"]);
  });

  it("turns a side's typed distance back into the shared distance", () => {
    const contour = rightAngleContour(linked(30));
    const point = contour.points[1];
    const sides = getSkeletonCornerDistances(contour, point);
    const outer = sides.left > sides.right ? "left" : "right";
    const inner = outer === "left" ? "right" : "left";

    setSkeletonCornerSideDistance(contour, point, inner, 25);
    const after = getSkeletonCornerDistances(contour, point);
    expect(after[inner]).to.be.closeTo(25, 1e-6);
    expect(after[outer]).to.be.closeTo(65, 1e-6);
    expect(centerlineCornerDistanceFor(contour, point, outer, 65)).to.be.closeTo(
      45,
      1e-6
    );
  });

  it("keeps the outline when the link is opened, and the sum when it closes", () => {
    const contour = rightAngleContour(linked(30, 40));
    const point = contour.points[1];
    const before = getSkeletonCornerDistances(contour, point);

    setSkeletonCornerLinked(contour, point, false);
    expect(getSkeletonCornerDistances(contour, point).left).to.be.closeTo(
      before.left,
      1e-9
    );
    expect(getSkeletonCornerDistances(contour, point).right).to.be.closeTo(
      before.right,
      1e-9
    );

    setSkeletonCornerLinked(contour, point, true);
    const relinked = getSkeletonCornerDistances(contour, point);
    expect(relinked.left + relinked.right).to.be.closeTo(
      before.left + before.right,
      1e-6
    );
  });

  it("stores the distribution bounded", () => {
    const contour = rightAngleContour(linked(30));
    setSkeletonCornerDistribution(contour.points[1], 250);
    expect(contour.points[1].corner.distribution).to.equal(100);
  });
});
