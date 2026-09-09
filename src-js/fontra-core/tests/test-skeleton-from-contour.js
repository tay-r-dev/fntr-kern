import {
  SKELETON_CONVERSION_REFUSALS,
  appendSkeletonContourFromPathContour,
  skeletonConversionRefusal,
} from "@fontra/core/skeleton-from-contour.js";
import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import { makeEmptySkeletonData } from "@fontra/core/skeleton-model.js";
import { expect } from "chai";

// An open cubic contour: two on-curve points with a curve between them, and a
// smooth on-curve at the far end carrying one handle beside a straight.
function drawnContour() {
  return {
    isClosed: false,
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 40, type: "cubic" },
      { x: 70, y: 60, type: "cubic" },
      { x: 100, y: 100, smooth: true },
      { x: 200, y: 100 },
    ],
  };
}

describe("skeleton-from-contour", () => {
  describe("refusals", () => {
    it("refuses a contour carrying quadratic off-curve points", () => {
      const contour = {
        isClosed: true,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50, type: "quad" },
          { x: 100, y: 0 },
        ],
      };
      expect(skeletonConversionRefusal(contour)).to.equal(
        SKELETON_CONVERSION_REFUSALS.QUADRATIC
      );
      expect(
        appendSkeletonContourFromPathContour(makeEmptySkeletonData(), contour, {
          width: 60,
        })
      ).to.equal(null);
    });

    it("refuses a contour with no on-curve points", () => {
      const contour = {
        isClosed: true,
        points: [
          { x: 0, y: 0, type: "cubic" },
          { x: 50, y: 50, type: "cubic" },
        ],
      };
      expect(skeletonConversionRefusal(contour)).to.equal(
        SKELETON_CONVERSION_REFUSALS.NO_ON_CURVE_POINTS
      );
    });

    it("accepts an ordinary cubic contour", () => {
      expect(skeletonConversionRefusal(drawnContour())).to.equal(null);
    });
  });

  describe("the copy", () => {
    it("keeps every coordinate, type and smooth flag exactly as drawn", () => {
      const skeletonData = makeEmptySkeletonData();
      const contour = appendSkeletonContourFromPathContour(
        skeletonData,
        drawnContour(),
        {
          width: 60,
        }
      );
      expect(contour.points.length).to.equal(5);
      expect(contour.points.map((point) => [point.x, point.y])).to.deep.equal([
        [0, 0],
        [30, 40],
        [70, 60],
        [100, 100],
        [200, 100],
      ]);
      expect(contour.points.map((point) => point.type)).to.deep.equal([
        null,
        "cubic",
        "cubic",
        null,
        null,
      ]);
      expect(contour.points.map((point) => point.smooth)).to.deep.equal([
        false,
        false,
        false,
        true,
        false,
      ]);
    });

    it("carries the closed flag", () => {
      const skeletonData = makeEmptySkeletonData();
      const contour = appendSkeletonContourFromPathContour(
        skeletonData,
        { ...drawnContour(), isClosed: true },
        { width: 60 }
      );
      expect(contour.closed).to.equal(true);
    });

    it("writes the width onto every on-curve point, not only onto the contour", () => {
      // Normalization materializes a width on every on-curve point, so the
      // contour's own number is never read for geometry. A conversion that set
      // it on the contour alone would draw the model's fallback width instead
      // of the width the designer asked for.
      const skeletonData = makeEmptySkeletonData();
      const contour = appendSkeletonContourFromPathContour(
        skeletonData,
        drawnContour(),
        {
          width: 80,
        }
      );
      expect(contour.defaultWidth).to.equal(80);
      for (const point of contour.points) {
        if (point.type) {
          continue;
        }
        expect(point.width.left).to.equal(40);
        expect(point.width.right).to.equal(40);
      }
    });

    it("gives every contour and point an id nothing else in the skeleton holds", () => {
      const skeletonData = makeEmptySkeletonData();
      const first = appendSkeletonContourFromPathContour(skeletonData, drawnContour(), {
        width: 60,
      });
      const second = appendSkeletonContourFromPathContour(
        skeletonData,
        drawnContour(),
        {
          width: 60,
        }
      );
      const ids = [
        first.id,
        second.id,
        ...first.points.map((point) => point.id),
        ...second.points.map((point) => point.id),
      ];
      expect(new Set(ids).size).to.equal(ids.length);
    });

    it("records the side mode it was given", () => {
      const skeletonData = makeEmptySkeletonData();
      expect(
        appendSkeletonContourFromPathContour(skeletonData, drawnContour(), {
          width: 60,
        }).singleSided
      ).to.equal(null);
      expect(
        appendSkeletonContourFromPathContour(skeletonData, drawnContour(), {
          width: 60,
          singleSided: "left",
        }).singleSided
      ).to.equal("left");
    });
  });

  describe("what the stroke comes out as", () => {
    it("leaves the drawn contour on one edge when the stroke is single-sided", () => {
      // The whole width goes to the named side and the other collapses onto the
      // centerline, so every point of the drawn contour is still on the outline.
      const skeletonData = makeEmptySkeletonData();
      appendSkeletonContourFromPathContour(skeletonData, drawnContour(), {
        width: 60,
        singleSided: "left",
      });
      const generated = generateFromSkeleton(skeletonData);
      const outline = generated.contours[0].points;
      for (const drawn of drawnContour().points) {
        if (drawn.type) {
          continue;
        }
        const landed = outline.some(
          (point) =>
            Math.abs(point.x - drawn.x) < 0.5 && Math.abs(point.y - drawn.y) < 0.5
        );
        expect(landed, `no outline point at ${drawn.x},${drawn.y}`).to.equal(true);
      }
    });

    it("builds a stroke either side of the drawn contour when it is double-sided", () => {
      const skeletonData = makeEmptySkeletonData();
      appendSkeletonContourFromPathContour(skeletonData, drawnContour(), { width: 60 });
      const generated = generateFromSkeleton(skeletonData);
      expect(generated.contours.length).to.equal(1);
      // The last drawn on-curve is at y = 100 with 30 units of half-width, so
      // the two edges there stand at 70 and 130.
      const ys = generated.contours[0].points.map((point) => point.y);
      expect(Math.min(...ys)).to.be.at.most(70.5);
      expect(Math.max(...ys)).to.be.at.least(129.5);
    });

    it("emits two contours from a closed drawn contour", () => {
      // A closed centerline strokes into an outer loop and a counter-wound
      // inner one, so one drawn loop becomes two.
      const skeletonData = makeEmptySkeletonData();
      appendSkeletonContourFromPathContour(
        skeletonData,
        {
          isClosed: true,
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
        { width: 40 }
      );
      expect(generateFromSkeleton(skeletonData).contours.length).to.equal(2);
    });
  });
});
