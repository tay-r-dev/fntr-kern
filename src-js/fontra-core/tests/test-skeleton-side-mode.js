import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import {
  collapsedSideForSingleSided,
  makeEmptySkeletonData,
  moveCenterlineForSingleSidedChange,
  normalizeSkeletonData,
  setSkeletonContourSingleSided,
} from "@fontra/core/skeleton-model.js";
import { expect } from "chai";

// A horizontal centerline running left to right. The left normal points DOWN,
// so a left half-width of 60 puts the left edge at y = -60, and every distance
// in these tests reads off the y coordinate.
function makeContour({ left = 60, right = 20, singleSided = null, nudge = null } = {}) {
  const skeletonData = normalizeSkeletonData({
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: left + right,
        singleSided,
        points: [
          {
            id: 2,
            x: 0,
            y: 0,
            width: { left, right },
            ...(nudge ? { nudge } : {}),
          },
          {
            id: 3,
            x: 200,
            y: 0,
            width: { left, right },
            ...(nudge ? { nudge } : {}),
          },
        ],
      },
    ],
  });
  return skeletonData;
}

// Run the change the way the write path does: move the centerline on a working
// copy, then write the mode.
function changeMode(skeletonData, targetMode, options = {}) {
  const working = structuredClone(skeletonData);
  moveCenterlineForSingleSidedChange(
    skeletonData.contours[0],
    working.contours[0],
    targetMode,
    options
  );
  setSkeletonContourSingleSided(working.contours[0], targetMode);
  return working;
}

// The band of black the stroke covers, along the normal.
function strokeExtent(skeletonData) {
  const ys = generateFromSkeleton(skeletonData).contours[0].points.map(
    (point) => point.y
  );
  return { low: Math.min(...ys), high: Math.max(...ys) };
}

describe("skeleton side mode", () => {
  it("names the side that lands on the centerline", () => {
    // A stroke set to "left" carries its width on the left, so the right edge
    // is the one lying on the centerline.
    expect(collapsedSideForSingleSided("left")).to.equal("right");
    expect(collapsedSideForSingleSided("right")).to.equal("left");
    expect(collapsedSideForSingleSided(null)).to.equal(null);
  });

  it("moves nothing when the mode does not change", () => {
    const skeletonData = makeContour();
    const working = structuredClone(skeletonData);
    expect(
      moveCenterlineForSingleSidedChange(
        skeletonData.contours[0],
        working.contours[0],
        null
      )
    ).to.equal(false);
  });

  it("moves the centerline onto the edge that is about to collapse", () => {
    // Left 60, right 20. Going to left-only, the centerline travels 20 toward
    // the right edge, which is 20 down.
    const working = changeMode(makeContour(), "left");
    expect(working.contours[0].points.map((point) => point.y)).to.deep.equal([20, 20]);
  });

  it("leaves the letter where it is, going two-sided to one-sided", () => {
    const before = makeContour();
    expect(strokeExtent(before)).to.deep.equal({ low: -60, high: 20 });
    expect(strokeExtent(changeMode(before, "left"))).to.deep.equal({
      low: -60,
      high: 20,
    });
    expect(strokeExtent(changeMode(before, "right"))).to.deep.equal({
      low: -60,
      high: 20,
    });
  });

  it("leaves the letter where it is, going between the two one-sided modes", () => {
    const before = makeContour({ singleSided: "left" });
    const extent = strokeExtent(before);
    expect(strokeExtent(changeMode(before, "right"))).to.deep.equal(extent);
  });

  it("leaves the letter where it is, going back to two-sided", () => {
    const before = makeContour({ singleSided: "right" });
    const extent = strokeExtent(before);
    expect(strokeExtent(changeMode(before, null))).to.deep.equal(extent);
  });

  it("writes no width, so the stored split survives the change", () => {
    const working = changeMode(makeContour(), "left");
    for (const point of working.contours[0].points) {
      expect(point.width.left).to.equal(60);
      expect(point.width.right).to.equal(20);
    }
  });

  it("returns to the shape it started from over a round trip", () => {
    const before = makeContour();
    const back = changeMode(changeMode(before, "left"), null);
    expect(back.contours[0].points.map((point) => [point.x, point.y])).to.deep.equal(
      before.contours[0].points.map((point) => [point.x, point.y])
    );
    expect(strokeExtent(back)).to.deep.equal(strokeExtent(before));
  });

  it("lands on the solved edge, leaving a slide stored and unapplied", () => {
    // The right edge's on-curves are slid 15 along the outline. With the option
    // off the centerline lands on the edge the generator solved, so the slide
    // does not move it and stays on the point.
    const before = makeContour({ nudge: { left: 0, right: 15 } });
    const working = changeMode(before, "left");
    expect(working.contours[0].points.map((point) => point.x)).to.deep.equal([0, 200]);
    expect(working.contours[0].points[0].nudge.right).to.equal(15);
  });

  it("lands on the drawn edge when asked, and spends the slide doing it", () => {
    // The same slide, with the option on: the centerline travels 15 along
    // itself as well, and the slide is cleared because it has been spent.
    const before = makeContour({ nudge: { left: 0, right: 15 } });
    const working = changeMode(before, "left", { respectChanges: true });
    expect(working.contours[0].points.map((point) => point.x)).to.deep.equal([15, 215]);
    expect(working.contours[0].points[0].nudge.right).to.equal(0);
    expect(working.contours[0].points.map((point) => point.y)).to.deep.equal([20, 20]);
  });

  it("carries no slide from the side that keeps the width", () => {
    // Only the collapsing side's slide can move the centerline. The other
    // side's edge does not move, so its slide still describes it.
    const before = makeContour({ nudge: { left: 15, right: 0 } });
    const working = changeMode(before, "left", { respectChanges: true });
    expect(working.contours[0].points.map((point) => point.x)).to.deep.equal([0, 200]);
    expect(working.contours[0].points[0].nudge.left).to.equal(15);
  });

  it("moves the centerline by each point's own distance on a tapered stroke", () => {
    const skeletonData = makeEmptySkeletonData();
    skeletonData.contours.push(
      normalizeSkeletonData({
        contours: [
          {
            id: 1,
            closed: false,
            defaultWidth: 80,
            singleSided: null,
            points: [
              { id: 2, x: 0, y: 0, width: { left: 60, right: 20 } },
              { id: 3, x: 200, y: 0, width: { left: 30, right: 50 } },
            ],
          },
        ],
      }).contours[0]
    );
    const working = changeMode(skeletonData, "left");
    expect(working.contours[0].points.map((point) => point.y)).to.deep.equal([20, 50]);
  });
});
