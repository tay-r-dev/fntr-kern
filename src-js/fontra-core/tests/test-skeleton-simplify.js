import { expect } from "chai";

import { simplifyContourCompatible } from "@fontra/core/path-simplification.js";
import {
  appendSkeletonContour,
  makeEmptySkeletonData,
  planSkeletonContourSimplify,
} from "@fontra/core/skeleton-model.js";

// The cacute of wip.fontra drawn as a centerline: two smooth points sit near,
// not on, the tops of two bumps, and Simplify replaces them.
const CACUTE = [
  [47, 357],
  [-24, 287, "cubic"],
  [-156, 351, "cubic"],
  [-106, 471, "s"],
  [-79, 537, "cubic"],
  [-7, 595, "cubic"],
  [81, 565, "s"],
  [193, 527, "cubic"],
  [163, 471, "cubic"],
  [253, 471, "s"],
  [350, 471, "cubic"],
  [301, 541, "cubic"],
  [385, 565, "s"],
  [470, 589, "cubic"],
  [533, 423, "cubic"],
  [648, 520],
];

function cacuteSkeleton(widthScale = 1, edit = () => {}) {
  const skeletonData = makeEmptySkeletonData();
  let ordinal = 0;
  const contour = appendSkeletonContour(skeletonData, {
    closed: false,
    points: CACUTE.map(([x, y, kind]) => {
      if (kind === "cubic") {
        return { x, y, type: "cubic" };
      }
      // Every on-curve its own width, so an interpolated one can be told apart.
      const left = (20 + 4 * ordinal) * widthScale;
      const right = (10 + 2 * ordinal) * widthScale;
      ordinal++;
      return { x, y, smooth: kind === "s", width: { left, right } };
    }),
  });
  edit(contour);
  return { skeletonData, contour };
}

const simplifyAt = (tolerance) => (contours) =>
  simplifyContourCompatible(contours, { tolerance, keepSourceIndex: true });

const onCurves = (points) => points.filter((point) => !point.type);
const at = (points, x, y) => points.find((point) => point.x === x && point.y === y);

describe("simplifyContourCompatible keepSourceIndex", () => {
  it("names the original index of every on-curve that survives", () => {
    const contour = {
      isClosed: false,
      points: CACUTE.map(([x, y, kind]) =>
        kind === "cubic" ? { x, y, type: "cubic" } : { x, y, smooth: kind === "s" }
      ),
    };
    const [result] = simplifyAt(1)([contour]);
    const tagged = onCurves(result.points).filter((p) => p.sourceIndex !== undefined);
    for (const point of tagged) {
      expect(contour.points[point.sourceIndex]).to.deep.include({
        x: point.x,
        y: point.y,
      });
    }
    expect(tagged.map((p) => p.sourceIndex)).to.include.members([0, 9, 15]);
    // An inserted extremum has no source.
    expect(at(result.points, 34, 573).sourceIndex).to.equal(undefined);
  });
});

describe("planSkeletonContourSimplify", () => {
  it("keeps survivors' ids and widths and drops the replaced points", () => {
    const { skeletonData, contour } = cacuteSkeleton();
    const plan = planSkeletonContourSimplify(
      [contour],
      simplifyAt(1),
      skeletonData.nextId
    );
    const points = plan.pointsPerLayer[0];
    const survivor = at(points, 253, 471);
    const original = contour.points[9];
    expect(survivor.id).to.equal(original.id);
    expect(survivor.width).to.deep.include({ left: original.width.left });
    expect(at(points, 81, 565)).to.equal(undefined);
    expect(at(points, 385, 565)).to.equal(undefined);
  });

  it("gives a new point fresh ids and whole-unit widths between its neighbours", () => {
    const { skeletonData, contour } = cacuteSkeleton();
    const plan = planSkeletonContourSimplify(
      [contour],
      simplifyAt(1),
      skeletonData.nextId
    );
    const points = plan.pointsPerLayer[0];
    const oldIds = new Set(contour.points.map((point) => point.id));
    const top = at(points, 34, 573);
    expect(oldIds.has(top.id)).to.equal(false);
    expect(top.id).to.be.at.least(skeletonData.nextId);
    expect(plan.nextId).to.be.above(Math.max(...points.map((point) => point.id)));
    // The nearest drawn points that survive on either side of the top are the
    // open start (47, 357), left 20, and (253, 471), left 32.
    for (const side of ["left", "right"]) {
      expect(Number.isInteger(top.width[side])).to.equal(true);
    }
    expect(top.width.left).to.be.within(20, 32);
    // The new point between the drawn (253, 471), left 32, and the open end
    // (648, 520), left 40, takes a width between the two.
    const inflection = onCurves(points).find((p) => p.x > 253 && p.x < 402);
    expect(inflection.width.left).to.be.within(32, 40);
    expect(Number.isInteger(inflection.width.left)).to.equal(true);
  });

  it("gives every layer the same structure and the same new ids", () => {
    const a = cacuteSkeleton(1);
    const b = cacuteSkeleton(1.5);
    const plan = planSkeletonContourSimplify(
      [a.contour, b.contour],
      simplifyAt(1),
      Math.max(a.skeletonData.nextId, b.skeletonData.nextId)
    );
    const [first, second] = plan.pointsPerLayer;
    expect(second.map((point) => point.id)).to.deep.equal(
      first.map((point) => point.id)
    );
    expect(second.map((point) => point.type)).to.deep.equal(
      first.map((point) => point.type)
    );
  });

  it("keeps a point that carries authored data", () => {
    const { skeletonData, contour } = cacuteSkeleton(1, (contour) => {
      contour.points[6].nudge = { left: 5, right: 0 };
    });
    const plan = planSkeletonContourSimplify(
      [contour],
      simplifyAt(1),
      skeletonData.nextId
    );
    const kept = at(plan.pointsPerLayer[0], 81, 565);
    expect(kept.id).to.equal(contour.points[6].id);
    expect(kept.nudge.left).to.equal(5);
  });
});
