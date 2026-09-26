import { expect } from "chai";
import { buildBulbTerminal } from "../src/bulb-geometry.js";
import { generateFromSkeleton } from "../src/skeleton-generator.js";

function specimen({
  cap = {},
  start = false,
  angle = 0,
  singleSided = null,
  taper = false,
  short = false,
  lock = null,
} = {}) {
  const points = short
    ? [
        { x: 410, y: 85 },
        { x: 418, y: 87, type: "cubic" },
        { x: 424, y: 89, type: "cubic" },
        { x: 430, y: 90 },
      ]
    : [
        { x: 60, y: 250 },
        { x: 160, y: 110, type: "cubic" },
        { x: 300, y: 60, type: "cubic" },
        { x: 430, y: 90 },
      ];
  return {
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 80,
        singleSided,
        points: points.map((point, i) => ({
          ...point,
          id: i + 2,
          smooth: false,
          x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
          y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
          ...(!point.type && taper
            ? { width: { left: i ? 55 : 12, right: i ? 20 : 30, linked: false } }
            : {}),
          ...(i === (start ? 0 : 3)
            ? { capStyle: "drop", capBallSide: "left", ribAngleLock: lock, ...cap }
            : {}),
        })),
      },
    ],
  };
}

function walls(result) {
  const map = result.provenance[0].pointMap;
  return result.contours[0].points.flatMap((point, i) => {
    const origin = map[i];
    return origin?.side && !origin.capCurvatureField
      ? [{ x: point.x, y: point.y, type: point.type ?? null, origin }]
      : [];
  });
}

function capPoints(result) {
  const map = result.provenance[0].pointMap;
  return result.contours[0].points.filter(
    (_, i) => !map[i]?.side || map[i]?.capCurvatureField
  );
}

function finite(result) {
  expect(result.contours).to.have.length(1);
  expect(result.contours[0].isClosed).to.equal(true);
  expect(
    result.contours[0].points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  ).to.equal(true);
}

function worstMovement(one, two) {
  expect(two).to.have.length(one.length);
  return Math.max(...two.map((p, i) => Math.hypot(p.x - one[i].x, p.y - one[i].y)));
}

describe("endpoint-rib bulbs", () => {
  it("keeps the complete ordinary walls and their provenance", () => {
    for (const start of [false, true])
      for (const singleSided of [null, "left", "right"]) {
        const options = { start, singleSided };
        const ordinary = walls(
          generateFromSkeleton(specimen({ ...options, cap: { capStyle: "butt" } }))
        );
        expect(ordinary.length).to.be.at.least(6);
        for (const capBallSide of ["left", "right"])
          for (const capBallRatio of [0.5, 1.25, 3]) {
            const result = generateFromSkeleton(
              specimen({
                ...options,
                cap: { capBallSide, capBallRatio, capBallShape: 1, capBallEasing: 1 },
              })
            );
            finite(result);
            expect(walls(result)).to.deep.equal(ordinary);
          }
      }
  });

  it("does not move tapered or locked walls when a bulb setting changes", () => {
    for (const start of [false, true])
      for (const lock of [null, "horizontal", "vertical"]) {
        const options = { start, taper: true, lock };
        const before = walls(generateFromSkeleton(specimen(options)));
        for (const cap of [
          { capBallRatio: 3 },
          { capBallShape: 1 },
          { capBallEasing: 1 },
          { capBallEaseCurvature: 0 },
          { capBallSide: "right" },
        ]) {
          const result = generateFromSkeleton(specimen({ ...options, cap }));
          finite(result);
          expect(walls(result)).to.deep.equal(before);
        }
      }
  });

  it("grows beyond the rib, even on a very short terminal segment", () => {
    for (const start of [false, true])
      for (const short of [false, true]) {
        const results = [0.5, 1.25, 3].map((capBallRatio) =>
          generateFromSkeleton(specimen({ start, short, cap: { capBallRatio } }))
        );
        const source = specimen({ start, short }).contours[0].points;
        const end = source[start ? 0 : 3];
        const neighbour = source[start ? 1 : 2];
        const dx = end.x - neighbour.x,
          dy = end.y - neighbour.y;
        const reach = (result) =>
          Math.max(
            ...capPoints(result)
              .filter((p) => !p.type)
              .map(
                (p) => ((p.x - end.x) * dx + (p.y - end.y) * dy) / Math.hypot(dx, dy)
              )
          );
        results.forEach(finite);
        expect(reach(results[0])).to.be.greaterThan(20);
        expect(reach(results[1])).to.be.greaterThan(reach(results[0]));
        expect(reach(results[2])).to.be.greaterThan(reach(results[1]));
      }
  });

  it("keeps all added geometry beyond the rib on both ends and sides", () => {
    for (const start of [false, true])
      for (const capBallSide of ["left", "right"])
        for (const capBallRatio of [0.5, 1.25, 3]) {
          const result = generateFromSkeleton(
            specimen({ start, cap: { capBallSide, capBallRatio, capBallEasing: 1 } })
          );
          const wall = walls(result);
          const endId = start ? 2 : 5;
          const ends = wall.filter(
            (p) => p.origin.skeletonPointId === endId && p.origin.role === "onCurve"
          );
          const outer = ends.find((p) => p.origin.side === capBallSide);
          const inner = ends.find((p) => p !== outer);
          const rib = { x: inner.x - outer.x, y: inner.y - outer.y };
          const source = specimen().contours[0].points;
          const end = source[start ? 0 : 3],
            neighbour = source[start ? 1 : 2];
          const sign = Math.sign(
            (end.x - neighbour.x) * rib.y - (end.y - neighbour.y) * rib.x
          );
          for (const p of capPoints(result)) {
            expect(
              sign * ((p.x - outer.x) * rib.y - (p.y - outer.y) * rib.x)
            ).to.be.at.least(-1e-7);
          }
        }
  });

  it("keeps fixed topology and continuous travel through size, shape, easing and rotation sweeps", () => {
    for (const capBallSide of ["left", "right"])
      for (const field of [
        "capBallRatio",
        "capBallShape",
        "capBallEasing",
        "capBallEaseCurvature",
        "angle",
      ]) {
        let previous;
        let worst = 0;
        for (let step = 0; step <= 100; step++) {
          const value =
            field === "capBallRatio"
              ? 0.5 + step / 40
              : field === "angle"
                ? -0.3 + step / 100
                : step / 100;
          const options = {
            cap: { capBallSide, ...(field !== "angle" ? { [field]: value } : {}) },
            angle: field === "angle" ? value : 0,
          };
          const result = generateFromSkeleton(specimen(options));
          finite(result);
          const points = capPoints(result);
          if (previous) worst = Math.max(worst, worstMovement(previous, points));
          previous = points;
        }
        expect(worst, `${capBallSide} ${field}`).to.be.below(7);
      }
  });

  it("elongates forward without changing the ball's transverse size", () => {
    const cap = (shape, easing = 0) =>
      buildBulbTerminal({
        outer: { x: 0, y: 0 },
        inner: { x: 0, y: 80 },
        outerDirection: { x: 1, y: 0 },
        innerDirection: { x: 1, y: 0 },
        radius: 50,
        shape,
        easing,
        tension: 0.55,
      }).filter((p) => !p.type);
    const reach = (points) => Math.max(...points.map((p) => p.x));
    const round = cap(0),
      long = cap(1),
      eased = cap(1, 1);
    expect(reach(long)).to.be.greaterThan(reach(round));
    expect(reach(eased)).to.be.greaterThan(reach(long));
    for (const points of [round, long, eased]) {
      expect(Math.max(...points.map((p) => p.y))).to.be.closeTo(100, 1e-8);
    }
  });

  it("joins the unchanged wall tangents at both rib ends", () => {
    for (const start of [false, true])
      for (const capBallSide of ["left", "right"]) {
        const result = generateFromSkeleton(specimen({ start, cap: { capBallSide } }));
        const points = result.contours[0].points,
          map = result.provenance[0].pointMap;
        map.forEach((origin, i) => {
          if (
            origin?.skeletonPointId !== (start ? 2 : 5) ||
            !origin.side ||
            origin.capCurvatureField ||
            origin.role !== "onCurve"
          )
            return;
          const before = points[(i - 1 + points.length) % points.length],
            after = points[(i + 1) % points.length],
            p = points[i];
          const u = { x: p.x - before.x, y: p.y - before.y },
            v = { x: after.x - p.x, y: after.y - p.y };
          expect(
            Math.abs(u.x * v.y - u.y * v.x) /
              (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
          ).to.be.below(1e-10);
          expect(u.x * v.x + u.y * v.y).to.be.greaterThan(0);
        });
      }
  });

  it("changes only neck handles when its curvature changes", () => {
    const result = (capBallEaseCurvature) =>
      generateFromSkeleton(specimen({ cap: { capBallEaseCurvature } }));
    const one = result(0.2),
      two = result(0.8);
    expect(one.contours[0].points.filter((p) => !p.type)).to.deep.equal(
      two.contours[0].points.filter((p) => !p.type)
    );
    expect(walls(one)).to.deep.equal(walls(two));
    expect(capPoints(one)).to.not.deep.equal(capPoints(two));
  });
});
