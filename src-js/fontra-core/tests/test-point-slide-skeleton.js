import { applyChange } from "@fontra/core/changes.js";
import {
  getSkeletonData,
  getSkeletonInsertionPosition,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  setSkeletonData,
} from "@fontra/core/skeleton-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import {
  createPointSlideTargetEntries,
  getPointSlideBehaviorName,
  POINT_SLIDE_BEHAVIOR_NAME,
} from "../../views-editor/src/point-slide-editing.js";
import {
  editSkeleton,
  makeSkeletonPointKey,
} from "../../views-editor/src/skeleton-editing.js";

before(() => {
  globalThis.window = { coarseGridSpacing: 1, event: null };
});

// A centerline arc A(1) -> P(2) -> B(3), a cubic on each side, with one
// insertion point on each segment.
function makeLayer() {
  const layer = {
    path: new VarPackedPath(),
    components: [],
    anchors: [],
    guidelines: [],
    customData: {},
  };
  setSkeletonData(
    layer,
    normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 40,
          points: [
            makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
            makeSkeletonPoint({ id: 11, x: 0, y: 55.23, type: "cubic" }),
            makeSkeletonPoint({ id: 12, x: 44.77, y: 100, type: "cubic" }),
            makeSkeletonPoint({ id: 2, x: 100, y: 100, smooth: true }),
            makeSkeletonPoint({ id: 21, x: 155.23, y: 100, type: "cubic" }),
            makeSkeletonPoint({ id: 22, x: 200, y: 55.23, type: "cubic" }),
            makeSkeletonPoint({ id: 3, x: 200, y: 0 }),
          ],
          insertions: [
            { id: 50, pointId: 1, t: 0.25 },
            { id: 51, pointId: 2, t: 0.5 },
          ],
        }),
      ],
    })
  );
  // Generate the outline once, the way any skeleton edit does.
  editSkeleton(layer, () => {});
  return layer;
}

const contourOf = (layer) => getSkeletonData(layer).contours[0];
const insertionPosition = (layer, id) => {
  const contour = contourOf(layer);
  return getSkeletonInsertionPosition(
    contour,
    contour.insertions.find((entry) => entry.id === id)
  );
};

function slide(layer, delta) {
  const selection = new Set([makeSkeletonPointKey(40, 2)]);
  const entries = createPointSlideTargetEntries(layer, selection, {
    referenceSkeletonData: getSkeletonData(layer),
    initialPointer: { x: 100, y: 100 },
    isPrimary: true,
    session: {},
  });
  expect(entries).to.have.length(1);
  const change = entries[0].makeChangeForDelta(delta);
  applyChange(layer, change);
  return entries[0];
}

describe("point slide on a skeleton centerline", () => {
  it("engages on a single skeleton point under V", () => {
    const layer = makeLayer();
    const name = getPointSlideBehaviorName(
      { pointSlideMode: true },
      new Set(["skeletonPoint"]),
      new Set([makeSkeletonPointKey(40, 2)]),
      layer
    );
    expect(name).to.equal(POINT_SLIDE_BEHAVIOR_NAME);
    // An open centerline's endpoint has nothing to slide between.
    expect(
      getPointSlideBehaviorName(
        { pointSlideMode: true },
        new Set(["skeletonPoint"]),
        new Set([makeSkeletonPointKey(40, 1)]),
        layer
      )
    ).to.equal(null);
  });

  it("slides the point along the centerline and regenerates the outline", () => {
    const layer = makeLayer();
    const outlineBefore = JSON.stringify(layer.path);
    // Toward A: the pointer sits over the arc's left half.
    slide(layer, { x: -70, y: -30 });
    const points = contourOf(layer).points;
    expect(points.map((point) => point.id)).to.deep.equal([1, 11, 12, 2, 21, 22, 3]);
    const moved = points[3];
    expect(moved.x).to.be.lessThan(100);
    expect(moved.smooth).to.equal(true);
    // Still on the old arc: distance from its center (100, 0) stays ~100.
    // The slide lands on whole units, which can sit up to ~0.7 off the arc.
    expect(Math.hypot(moved.x - 100, moved.y)).to.be.closeTo(100, 1);
    // The anchors did not move.
    expect(points[0]).to.deep.include({ x: 0, y: 0 });
    expect(points[6]).to.deep.include({ x: 200, y: 0 });
    expect(JSON.stringify(layer.path)).to.not.equal(outlineBefore);
  });

  it("carries insertion points with the slide", () => {
    const layer = makeLayer();
    const onKept = insertionPosition(layer, 50);
    const onFar = insertionPosition(layer, 51);
    slide(layer, { x: -70, y: -30 });
    // On the kept piece: where it was, up to the whole unit both the slide
    // and the generated outline now round to.
    const keptAfter = insertionPosition(layer, 50);
    expect(keptAfter.x).to.be.closeTo(onKept.x, 1);
    expect(keptAfter.y).to.be.closeTo(onKept.y, 1);
    // On the refit far segment: within the fit's reach.
    const farAfter = insertionPosition(layer, 51);
    expect(Math.hypot(farAfter.x - onFar.x, farAfter.y - onFar.y)).to.be.lessThan(1.5);
  });

  it("rolls the whole gesture back", () => {
    const layer = makeLayer();
    const before = JSON.stringify(getSkeletonData(layer));
    const entry = slide(layer, { x: -70, y: -30 });
    applyChange(layer, entry.rollbackChange);
    expect(JSON.stringify(getSkeletonData(layer))).to.equal(before);
  });
});
