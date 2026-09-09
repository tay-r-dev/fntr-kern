import { resolveMarkerAnchor } from "@fontra/core/marker-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

// One cubic from (0,0) to (100,0), bulging upward, then a line closing it. At t = 0.5 a
// symmetric cubic sits at the midpoint in x, and its derivative is horizontal, so the
// normal is straight up or straight down.
function cubicPath() {
  const path = new VarPackedPath();
  path.appendUnpackedContour({
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100, type: "cubic" },
      { x: 100, y: 100, type: "cubic" },
      { x: 100, y: 0 },
    ],
    isClosed: true,
  });
  return path;
}

describe("marker-model — resolving an anchor", () => {
  it("resolves a segment anchor to a point on the curve", () => {
    const result = resolveMarkerAnchor(
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 0, t: 0.5 },
      { path: cubicPath() }
    );
    expect(result.verdict).to.equal("ok");
    expect(result.point.x).to.be.closeTo(50, 0.001);
    expect(result.point.y).to.be.closeTo(75, 0.001);
  });

  it("resolves a unit normal square to the derivative", () => {
    const result = resolveMarkerAnchor(
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 0, t: 0.5 },
      { path: cubicPath() }
    );
    expect(Math.hypot(result.normal.x, result.normal.y)).to.be.closeTo(1, 0.001);
    expect(Math.abs(result.normal.x)).to.be.closeTo(0, 0.001);
    expect(Math.abs(result.normal.y)).to.be.closeTo(1, 0.001);
  });

  it("resolves a point anchor to its coordinates, with no normal", () => {
    const result = resolveMarkerAnchor(
      { kind: "pathPoint", contourIndex: 0, pointIndex: 3 },
      { path: cubicPath() }
    );
    expect(result.verdict).to.equal("ok");
    expect(result.point).to.deep.include({ x: 100, y: 0 });
    expect(result.normal).to.equal(undefined);
  });

  it("stales an out-of-range contour index rather than throwing", () => {
    const result = resolveMarkerAnchor(
      { kind: "pathSegment", contourIndex: 7, segmentIndex: 0, t: 0.5 },
      { path: cubicPath() }
    );
    expect(result.verdict).to.equal("stale");
  });

  it("stales an out-of-range segment index", () => {
    const result = resolveMarkerAnchor(
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 9, t: 0.5 },
      { path: cubicPath() }
    );
    expect(result.verdict).to.equal("stale");
  });

  it("stales a skeleton anchor whose point is gone", () => {
    const result = resolveMarkerAnchor(
      { kind: "skeletonPoint", contourId: "c1", pointId: "p1", t: 0.5 },
      { path: cubicPath(), skeletonData: { contours: [] } }
    );
    expect(result.verdict).to.equal("stale");
  });
});
