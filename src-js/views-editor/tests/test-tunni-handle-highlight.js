import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import {
  TunniGizmoReveal,
  tunniCurvatureSegmentPoints,
  tunniGizmoKey,
} from "../src/tunni-gizmos.js";

// A quarter curve from (0, 0) to (100, 100), then back by a line.
function quarterPath() {
  return VarPackedPath.fromUnpackedContours([
    {
      points: [
        { x: 0, y: 0 },
        { x: 55, y: 0, type: "cubic" },
        { x: 100, y: 45, type: "cubic" },
        { x: 100, y: 100 },
      ],
      isClosed: true,
    },
  ]);
}

describe("the segment a curvature gizmo stands for", () => {
  it("finds an ordinary path segment by its gizmo key", () => {
    const points = tunniCurvatureSegmentPoints(tunniGizmoKey("basic", "curvature", "0/0"), {
      path: quarterPath(),
      skeletonData: null,
    });
    expect(points.map(({ x, y }) => [x, y])).to.deep.equal([
      [0, 0],
      [55, 0],
      [100, 45],
      [100, 100],
    ]);
  });

  it("finds a skeleton segment by its gizmo key", () => {
    const skeletonData = {
      contours: [
        {
          id: "c1",
          closed: false,
          points: [
            { id: "a", x: 0, y: 0 },
            { id: "b", x: 30, y: 0, type: "cubic" },
            { id: "c", x: 60, y: 30, type: "cubic" },
            { id: "d", x: 60, y: 60 },
          ],
        },
      ],
    };
    const points = tunniCurvatureSegmentPoints(
      tunniGizmoKey("skeleton", "curvature", "c1/a"),
      { path: null, skeletonData }
    );
    expect(points.map(({ x, y }) => [x, y])).to.deep.equal([
      [0, 0],
      [30, 0],
      [60, 30],
      [60, 60],
    ]);
  });

  it("is null for a key that names no segment", () => {
    expect(
      tunniCurvatureSegmentPoints(tunniGizmoKey("basic", "curvature", "4/0"), {
        path: quarterPath(),
        skeletonData: null,
      })
    ).to.equal(null);
  });
});

describe("the dragged gizmo", () => {
  it("eases in while its drag lasts and out after it, and hovering alone does not", () => {
    globalThis.requestAnimationFrame ??= () => 0;
    const reveal = new TunniGizmoReveal(() => {});
    const key = tunniGizmoKey("basic", "curvature", "0/0");
    reveal._setHot(key);
    expect(reveal.draggedKeys(performance.now() + 10000)).to.deep.equal([]);
    reveal.setDragged(key);
    const start = performance.now();
    const early = reveal.draggedKeys(start + 20)[0]?.alpha ?? 0;
    expect(early).to.be.above(0).and.below(1);
    expect(reveal.draggedKeys(start + 10000)).to.deep.equal([{ key, alpha: 1 }]);
    reveal.setDragged(null);
    expect(reveal.draggedKeys(performance.now() + 10000)).to.deep.equal([]);
  });
});
