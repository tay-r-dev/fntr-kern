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
    const points = tunniCurvatureSegmentPoints(
      tunniGizmoKey("basic", "curvature", "0/0"),
      {
        path: quarterPath(),
        skeletonData: null,
      }
    );
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
  it("shows at once while its drag lasts and fades after it, and hovering alone does not", () => {
    globalThis.requestAnimationFrame ??= () => 0;
    const reveal = new TunniGizmoReveal(() => {});
    const key = tunniGizmoKey("basic", "curvature", "0/0");
    reveal._setHot(key);
    expect(reveal.draggedKeys(performance.now() + 10000)).to.deep.equal([]);
    reveal.setDragged(key);
    expect(reveal.draggedKeys(performance.now())).to.deep.equal([{ key, alpha: 1 }]);
    reveal.setDragged(null);
    const end = performance.now();
    const fading = reveal.draggedKeys(end + 20)[0]?.alpha ?? 0;
    expect(fading).to.be.above(0).and.below(1);
    expect(reveal.draggedKeys(end + 10000)).to.deep.equal([]);
  });

  it("re-arms a gizmo it just dropped without the reveal delay", () => {
    globalThis.requestAnimationFrame ??= () => 0;
    globalThis.cancelAnimationFrame ??= () => {};
    const reveal = new TunniGizmoReveal(() => {});
    const key = tunniGizmoKey("basic", "curvature", "0/0");
    reveal._armedKey = key;
    reveal.hover(null);
    expect(reveal.isArmed(key)).to.equal(false);
    reveal.hover(key);
    expect(reveal.isArmed(key)).to.equal(true);
    reveal.hover(null);
  });
});

describe("the segment a generated-outline curvature gizmo stands for", () => {
  it("finds a generated segment by its gizmo key", async () => {
    const { VarPackedPath: Path } = await import("@fontra/core/var-path.js");
    const skeleton = await import("@fontra/core/skeleton-model.js");
    const { editSkeleton } = await import("../src/skeleton-editing.js");
    const { generatedTunniSegmentId } = await import("../src/tunni-gizmos.js");
    const layer = {
      path: new Path(),
      components: [],
      anchors: [],
      guidelines: [],
      customData: {},
    };
    skeleton.setSkeletonData(
      layer,
      skeleton.normalizeSkeletonData({
        contours: [
          skeleton.makeSkeletonContour({
            id: 80,
            defaultWidth: 80,
            points: [
              skeleton.makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
              skeleton.makeSkeletonPoint({ id: 2, x: 30, y: 40, type: "cubic" }),
              skeleton.makeSkeletonPoint({ id: 3, x: 70, y: 40, type: "cubic" }),
              skeleton.makeSkeletonPoint({ id: 4, x: 100, y: 0 }),
            ],
          }),
        ],
      })
    );
    editSkeleton(layer, () => {});
    const skeletonData = skeleton.getSkeletonData(layer);
    const [segment] = skeleton.buildGeneratedTunniSegments(skeletonData, layer.path);
    const points = tunniCurvatureSegmentPoints(
      tunniGizmoKey("generated", "curvature", generatedTunniSegmentId(segment)),
      { path: layer.path, skeletonData }
    );
    expect(points).to.have.length(4);
  });
});
