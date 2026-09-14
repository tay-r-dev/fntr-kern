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
        expect(contour.points.filter((point) => point.type)).to.have.length(0);
      });
    }
  }

  // The H in the test project: a straight into a curve through a tension point.
  const straightIntoCurve = (insertions) =>
    normalizeSkeletonData({
      contours: [
        {
          id: 1,
          defaultWidth: 40,
          capStyle: "butt",
          points: [
            { id: 3, x: 138, y: 27 },
            { id: 4, x: 138, y: 324, smooth: true },
            { id: 5, x: 138, y: 461, type: "cubic" },
            { id: 6, x: 201, y: 482, type: "cubic" },
            { id: 7, x: 325, y: 482 },
          ],
          insertions,
        },
      ],
    });

  it("turns the tension points at the straight's end into corners", () => {
    const insertion = {
      id: 59,
      pointId: 3,
      t: 0.58,
      width: { left: 1.4, right: 1.4 },
      easing: { left: 0, right: 0 },
    };
    const [before] = generateFromSkeleton(straightIntoCurve([])).contours;
    const [after] = generateFromSkeleton(straightIntoCurve([insertion])).contours;
    const offCurves = (contour) => contour.points.filter((point) => point.type).length;
    const onCurves = (contour) => contour.points.filter((point) => !point.type).length;
    const smooth = (contour) =>
      contour.points.filter((point) => !point.type && point.smooth).length;
    expect(offCurves(after)).to.equal(offCurves(before));
    expect(onCurves(after)).to.equal(onCurves(before) + 2);
    expect(smooth(before)).to.equal(2);
    expect(smooth(after)).to.equal(0);
  });

  it("keeps the handles when easing is on", () => {
    const [contour] = generateFromSkeleton(
      straightIntoCurve([
        {
          id: 59,
          pointId: 3,
          t: 0.58,
          width: { left: 1.4, right: 1.4 },
          easing: { left: 0.5, right: 0.5 },
        },
      ])
    ).contours;
    expect(longestHandle(contour.points)).to.be.above(1);
  });
});
