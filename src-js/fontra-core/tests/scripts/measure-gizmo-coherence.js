import { strict as assert } from "node:assert";

import { offsetCubicSide } from "@fontra/core/offset-cubic.js";
import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import { calculateGeneratedCurvatureEdits } from "@fontra/core/skeleton-model.js";
import {
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoAxis,
  calculateSegmentTension,
  calculateTunniPoint,
} from "@fontra/core/tunni-calculations.js";

const NUDGES = [0, 20, 40];
const PIN = 0.55;

for (const nudge of NUDGES) {
  const before = segmentGeometry(makeSkeleton({ nudge }));
  const edit = calculateGeneratedCurvatureEdits({
    segmentPoints: before.points,
    provenance: before.provenance,
    delta: { x: 0, y: 0 },
  });
  const after = segmentGeometry(makeSkeleton({ nudge, pin: edit.tension }));
  const movement = maxHandleMovement(before.points, after.points);
  assert.ok(movement <= 1, `zero-delta grab moved ${movement} at nudge ${nudge}`);

  const construction = constructionPoints(before);
  const ceilingControls = calculateControlPointsFromCurvatureDelta(
    scale(calculateCurvatureGizmoAxis(before.points), 1e6),
    construction,
    { axisSegmentPoints: before.points }
  );
  const ceiling = handleTensions(construction, ceilingControls);
  assert.ok(Math.abs(Math.max(...ceiling) - 1) < 1e-9);

  console.log(
    `nudge ${nudge}: grab movement ${movement.toFixed(6)}, leading ceiling ${Math.max(...ceiling).toFixed(6)}`
  );
}

const referenceHandles = segmentGeometry(makeSkeleton()).points.slice(1, 3);
for (const nudge of NUDGES) {
  const handles = segmentGeometry(makeSkeleton({ nudge })).points.slice(1, 3);
  assert.deepEqual(handles, referenceHandles, `handles moved at nudge ${nudge}`);
}
console.log("on-curve nudge sweep: handles byte-identical");

const smoothReference = smoothJunctionHandles(0);
for (const nudge of NUDGES) {
  assert.deepEqual(
    smoothJunctionHandles(nudge),
    smoothReference,
    `smooth handles moved at nudge ${nudge}`
  );
}
console.log("smooth-junction nudge sweep: handles byte-identical");

let worstPinError = 0;
for (const width of [20, 35, 50, 70])
  for (const nudge of [-40, -20, 0, 20, 40])
    for (const adjustment of [-8, 0, 8]) {
      const geometry = segmentGeometry(
        makeSkeleton({ width, nudge, pin: PIN, adjustment })
      );
      const tension = constructionTension(geometry);
      worstPinError = Math.max(worstPinError, Math.abs(tension - PIN));
    }
assert.ok(worstPinError < 0.02, `pin error ${worstPinError}`);
console.log(
  `pin width/nudge/handle sweep: max error ${worstPinError.toExponential(3)}`
);

const continuity = measureContinuity(6000);
assert.ok(continuity < 1, `continuity step ${continuity}`);
console.log(
  `6000-step continuity sweep: max handle-length step ${continuity.toFixed(6)}`
);

function makeSkeleton({ width = 20, nudge = 0, pin = null, adjustment = 0 } = {}) {
  return {
    version: 1,
    nextId: 6,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: width * 2,
        singleSided: null,
        points: [
          {
            id: 2,
            x: 0,
            y: 0,
            type: null,
            smooth: false,
            width: { left: width, right: width, linked: true },
            nudge: { left: nudge, right: 0 },
            segmentCurvature: { left: pin, right: null },
            editable: { left: true, right: true },
            handleOffsets: {
              leftOut: { x: adjustment * 0.6, y: adjustment * 0.8 },
            },
          },
          { id: 3, x: 40, y: 60, type: "cubic", smooth: false },
          { id: 4, x: 120, y: 60, type: "cubic", smooth: false },
          {
            id: 5,
            x: 160,
            y: 0,
            type: null,
            smooth: false,
            width: { left: width, right: width, linked: true },
            nudge: { left: 0, right: 0 },
            editable: { left: true, right: true },
          },
        ],
      },
    ],
    generated: [],
  };
}

function smoothJunctionHandles(nudge) {
  const onCurve = (id, x, y, smooth) => ({
    id,
    x,
    y,
    type: null,
    smooth,
    width: { left: 20, right: 20, linked: true },
    nudge: { left: id === 5 ? nudge : 0, right: 0 },
    editable: { left: true, right: true },
  });
  const offCurve = (id, x, y) => ({ id, x, y, type: "cubic" });
  const generated = generateFromSkeleton({
    version: 1,
    nextId: 9,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 40,
        points: [
          onCurve(2, 0, 0, false),
          offCurve(3, 20, 40),
          offCurve(4, 50, 40),
          onCurve(5, 60, 60, true),
          offCurve(6, 70, 80),
          offCurve(7, 100, 100),
          onCurve(8, 120, 60, false),
        ],
      },
    ],
  });
  const handles = {};
  for (const [contourIndex, provenance] of generated.provenance.entries()) {
    for (const [pointIndex, entry] of provenance.pointMap.entries()) {
      if (
        entry?.skeletonPointId === 5 &&
        entry.side === "left" &&
        (entry.role === "in" || entry.role === "out")
      ) {
        handles[entry.role] = generated.contours[contourIndex].points[pointIndex];
      }
    }
  }
  return handles;
}

function segmentGeometry(skeleton) {
  const generated = generateFromSkeleton(skeleton);
  const points = generated.contours[0].points;
  const pointMap = generated.provenance[0].pointMap;
  const entry = (pointId, role) => {
    const index = pointMap.findIndex(
      (item) =>
        item?.skeletonPointId === pointId && item.side === "left" && item.role === role
    );
    assert.notEqual(index, -1, `${pointId}/${role}`);
    return { point: points[index], provenance: pointMap[index] };
  };
  const entries = [
    entry(2, "onCurve"),
    entry(2, "out"),
    entry(5, "in"),
    entry(5, "onCurve"),
  ];
  return {
    points: entries.map((item) => item.point),
    provenance: entries.map((item) => item.provenance),
  };
}

function constructionTension({ points, provenance }) {
  const construction = constructionPoints({ points, provenance });
  return calculateSegmentTension(
    construction[1],
    construction[0],
    construction[2],
    construction[3]
  );
}

function constructionPoints({ points, provenance }) {
  return points.map((point, index) => ({
    x: point.x - (provenance[index].nudge?.x ?? 0),
    y: point.y - (provenance[index].nudge?.y ?? 0),
  }));
}

function handleTensions(points, controls) {
  const tunni = calculateTunniPoint(points);
  const tensionAt = (onCurve, control) => {
    const axis = unit({ x: control.x - onCurve.x, y: control.y - onCurve.y });
    const reach = (tunni.x - onCurve.x) * axis.x + (tunni.y - onCurve.y) * axis.y;
    return Math.hypot(control.x - onCurve.x, control.y - onCurve.y) / reach;
  };
  return [tensionAt(points[0], controls[0]), tensionAt(points[3], controls[1])];
}

function maxHandleMovement(a, b) {
  return Math.max(
    Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y),
    Math.hypot(a[2].x - b[2].x, a[2].y - b[2].y)
  );
}

function scale(vector, amount) {
  return { x: vector.x * amount, y: vector.y * amount };
}

function unit(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function measureContinuity(steps) {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 30, y: 45 };
  const p3 = { x: 120, y: 0 };
  let previous = null;
  let worst = 0;
  for (let step = 0; step <= steps; step++) {
    const p2 = { x: 90 - step * (160 / steps), y: 45 };
    const current = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0: 35,
      d3: 35,
      ...ribInputs(p0, p1, p2, p3, 35, 35),
    });
    if (previous) {
      worst = Math.max(
        worst,
        Math.abs(current.startLength - previous.startLength),
        Math.abs(current.endLength - previous.endLength)
      );
    }
    previous = current;
  }
  return worst;
}

function ribInputs(p0, p1, p2, p3, d0, d3) {
  const start = unit({ x: p1.x - p0.x, y: p1.y - p0.y });
  const end = unit({ x: p3.x - p2.x, y: p3.y - p2.y });
  const q0 = { x: p0.x + start.y * d0, y: p0.y - start.x * d0 };
  const q3 = { x: p3.x + end.y * d3, y: p3.y - end.x * d3 };
  return { q0, q3, u0: start, u1: { x: -end.x, y: -end.y } };
}
