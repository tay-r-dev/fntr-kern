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

describe("the hot gizmos", () => {
  it("lists the keys whose hover emphasis is showing, with how far it is in", () => {
    globalThis.requestAnimationFrame ??= () => 0;
    const reveal = new TunniGizmoReveal(() => {});
    const key = tunniGizmoKey("basic", "curvature", "0/0");
    reveal._setHot(key);
    const later = performance.now() + 10000;
    expect(reveal.hotKeys(later)).to.deep.equal([{ key, hotness: 1 }]);
    reveal._setHot(null);
    expect(reveal.hotKeys(performance.now() + 20000)).to.deep.equal([]);
  });
});
