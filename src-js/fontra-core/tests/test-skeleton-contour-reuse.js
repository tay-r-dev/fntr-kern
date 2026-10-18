import {
  generateFromSkeleton,
  skeletonContourCache,
} from "@fontra/core/skeleton-generator.js";
import { makeSkeletonContour, makeSkeletonPoint } from "@fontra/core/skeleton-model.js";
import { expect } from "chai";

function strokes(count, firstX = 0) {
  const contours = [];
  for (let j = 0; j < count; j++) {
    const x = 500 * j;
    const base = 100 * j;
    contours.push(
      makeSkeletonContour({
        id: base + 1,
        defaultWidth: 80,
        points: [
          makeSkeletonPoint({ id: base + 2, x: x + (j === 0 ? firstX : 0), y: 0 }),
          makeSkeletonPoint({ id: base + 3, x, y: 120, type: "cubic" }),
          makeSkeletonPoint({ id: base + 4, x: x + 200, y: 200, type: "cubic" }),
          makeSkeletonPoint({ id: base + 5, x: x + 240, y: 400 }),
        ],
      })
    );
  }
  return { contours, generated: [] };
}

function fresh(data, options) {
  skeletonContourCache.clear();
  return generateFromSkeleton(data, options);
}

describe("skeleton contour reuse", () => {
  it("regenerates only the contour that changed", () => {
    skeletonContourCache.clear();
    generateFromSkeleton(strokes(8));
    const misses = skeletonContourCache.misses;
    generateFromSkeleton(strokes(8, 1));
    expect(skeletonContourCache.misses - misses).to.equal(1);
  });

  it("emits what a full generation emits after a local edit", () => {
    skeletonContourCache.clear();
    generateFromSkeleton(strokes(4));
    const reused = generateFromSkeleton(strokes(4, 7));
    expect(reused).to.deep.equal(fresh(strokes(4, 7)));
  });

  it("does not reuse across different options", () => {
    skeletonContourCache.clear();
    generateFromSkeleton(strokes(2));
    const misses = skeletonContourCache.misses;
    generateFromSkeleton(strokes(2), { bulbPreview: true });
    expect(skeletonContourCache.misses - misses).to.equal(2);
  });

  it("hands out results a caller can change without changing the next one", () => {
    skeletonContourCache.clear();
    const first = generateFromSkeleton(strokes(1));
    first.contours[0].points[0].x = 9999;
    first.provenance[0].pointMap[0] = null;
    expect(generateFromSkeleton(strokes(1))).to.deep.equal(fresh(strokes(1)));
  });

  it("numbers generated contours by their place in this output", () => {
    skeletonContourCache.clear();
    generateFromSkeleton(strokes(3));
    const data = strokes(3);
    data.contours.shift();
    const result = generateFromSkeleton(data);
    expect(result.provenance.map((entry) => entry.generatedContourIndex)).to.deep.equal(
      [0, 1]
    );
  });
});
