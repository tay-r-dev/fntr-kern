import { strict as assert } from "node:assert";

import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import { transformSkeletonData } from "@fontra/core/skeleton-model.js";
import { Transform } from "@fontra/core/transform.js";

const skeleton = {
  version: 1,
  nextId: 6,
  contours: [
    {
      id: 1,
      closed: false,
      defaultWidth: 70,
      singleSided: null,
      points: [
        {
          id: 2,
          x: 0,
          y: 0,
          type: null,
          smooth: false,
          width: { left: 20, right: 90, linked: false },
          nudge: { left: 8, right: -6 },
          handleNudge: { left: 5, right: -3 },
          segmentCurvature: { left: 0.42, right: 0.68 },
          editable: { left: true, right: true },
          handleOffsets: {
            leftOut: { x: 7, y: -3, detached: false },
            rightOut: { x: -5, y: 4, detached: false },
          },
        },
        { id: 3, x: 40, y: 120, type: "cubic", smooth: false },
        { id: 4, x: 120, y: 120, type: "cubic", smooth: false },
        {
          id: 5,
          x: 160,
          y: 0,
          type: null,
          smooth: false,
          width: { left: 60, right: 15, linked: false },
          nudge: { left: -4, right: 5 },
          handleNudge: { left: -2, right: 4 },
          editable: { left: true, right: true },
          handleOffsets: {
            leftIn: { x: 3, y: 6, detached: false },
            rightIn: { x: -8, y: -2, detached: false },
          },
        },
      ],
    },
  ],
  generated: [],
};

const cases = [
  ["horizontal mirror", new Transform(-1, 0, 0, 1, 0, 0)],
  ["vertical mirror", new Transform(1, 0, 0, -1, 0, 0)],
  ["quarter rotation", new Transform(0, 1, -1, 0, 0, 0)],
];

for (const [name, affine] of cases) {
  const generatedThenTransformed = canonicalPointSets(
    transformGeneratedContours(generateFromSkeleton(skeleton).contours, affine)
  );
  const transformedThenGenerated = canonicalPointSets(
    generateFromSkeleton(transformSkeletonData(skeleton, affine)).contours
  );
  assert.deepEqual(transformedThenGenerated, generatedThenTransformed, name);
  console.log(`${name}: ${generatedThenTransformed.flat().length} points match`);
}

function transformGeneratedContours(contours, affine) {
  return contours.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => {
      const [x, y] = affine.transformPoint(point.x, point.y);
      return { ...point, x, y };
    }),
  }));
}

function canonicalPointSets(contours) {
  return contours
    .map((contour) =>
      contour.points
        .map((point) => `${point.x},${point.y},${point.type ?? "onCurve"}`)
        .sort()
    )
    .sort((a, b) => a.join("|").localeCompare(b.join("|")));
}
