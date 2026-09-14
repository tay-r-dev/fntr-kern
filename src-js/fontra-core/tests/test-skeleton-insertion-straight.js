import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import { normalizeSkeletonData } from "@fontra/core/skeleton-model.js";
import { expect } from "chai";

// The longest distance from any handle to the on-curve next to it.
function longestHandle(points) {
  let longest = 0;
  points.forEach((point, i) => {
    if (!point.type) {
      return;
    }
    const anchors = [points[i - 1], points[i + 1]].filter((p) => p && !p.type);
    for (const anchor of anchors.slice(0, 1)) {
      longest = Math.max(longest, Math.hypot(point.x - anchor.x, point.y - anchor.y));
    }
  });
  return longest;
}

describe("an insertion point on a straight, at zero easing", () => {
  for (const smooth of [false, true]) {
    for (const ratio of [1, 1.3]) {
      it(`emits no handle length (smooth ${smooth}, ratio ${ratio})`, () => {
        const data = normalizeSkeletonData({
          contours: [
            {
              id: 10,
              defaultWidth: 60,
              capStyle: "butt",
              points: [
                { id: 11, x: 0, y: 0, smooth },
                { id: 12, x: 200, y: 0, smooth },
                { id: 13, x: 400, y: 100, smooth },
              ],
              insertions: [
                {
                  id: 20,
                  pointId: 11,
                  t: 0.5,
                  width: { left: ratio, right: ratio },
                  easing: { left: 0, right: 0 },
                },
              ],
            },
          ],
        });
        const [contour] = generateFromSkeleton(data).contours;
        expect(longestHandle(contour.points)).to.be.below(1e-9);
      });
    }
  }
});
