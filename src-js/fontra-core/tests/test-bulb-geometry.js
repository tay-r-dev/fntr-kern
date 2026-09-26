import { expect } from "chai";
import { buildBulbArc, makeBulbBall } from "../src/bulb-geometry.js";
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

describe("rib-apex bulbs", () => {
  it("keeps the outer wall complete while cutting the inner wall", () => {
    for (const start of [false, true])
      for (const singleSided of [null, "left", "right"])
        for (const capBallSide of ["left", "right"]) {
          const options = { start, singleSided };
          const ordinary = walls(
            generateFromSkeleton(specimen({ ...options, cap: { capStyle: "butt" } }))
          );
          const outerWall = ordinary.filter((p) => p.origin.side === capBallSide);
          for (const capBallRatio of [0.5, 1.25, 3])
            for (const capBallShape of [0, 1])
              for (const capBallEasing of [0, 0.5, 1]) {
                const result = generateFromSkeleton(
                  specimen({
                    ...options,
                    cap: {
                      capBallSide,
                      capBallRatio,
                      capBallShape,
                      capBallEasing,
                    },
                  })
                );
                finite(result);
                expect(
                  walls(result).filter((p) => p.origin.side === capBallSide)
                ).to.deep.equal(outerWall);
              }
        }
    const ordinary = walls(
      generateFromSkeleton(specimen({ cap: { capStyle: "butt" } }))
    );
    const bulb = walls(generateFromSkeleton(specimen({ cap: { capBallRatio: 1.25 } })));
    expect(bulb.filter((p) => p.origin.side === "right")).to.not.deep.equal(
      ordinary.filter((p) => p.origin.side === "right")
    );
  });

  it("keeps tapered and locked outer walls when a bulb setting changes", () => {
    for (const start of [false, true])
      for (const lock of [null, "horizontal", "vertical"])
        for (const capBallSide of ["left", "right"]) {
          const options = { start, taper: true, lock };
          const outer = (result) =>
            walls(result).filter((p) => p.origin.side === capBallSide);
          const before = outer(
            generateFromSkeleton(specimen({ ...options, cap: { capBallSide } }))
          );
          for (const cap of [
            { capBallRatio: 3 },
            { capBallShape: 1 },
            { capBallEasing: 1 },
            { capBallEaseCurvature: 0 },
          ]) {
            const result = generateFromSkeleton(
              specimen({ ...options, cap: { ...cap, capBallSide } })
            );
            finite(result);
            expect(outer(result)).to.deep.equal(before);
          }
        }
  });

  it("anchors a round ball at the rib apex and stretches only its rear half", () => {
    for (const shape of [0, 0.5, 1]) {
      const ball = makeBulbBall({
        outer: { x: 0, y: 0 },
        inner: { x: 0, y: 80 },
        outerDirection: { x: 1, y: 0 },
        radius: 50,
        shape,
      });
      expect(ball.at(-Math.PI / 2).x).to.be.closeTo(0, 1e-10);
      expect(ball.at(-Math.PI / 2).y).to.be.closeTo(0, 1e-10);
      expect(ball.at(0)).to.deep.equal({ x: 50, y: 50 });
      expect(ball.at(Math.PI).x).to.be.closeTo(-50 * (1 + 1.4 * shape), 1e-10);
      const points = buildBulbArc(ball, 1.3 * Math.PI);
      expect(points.filter((p) => !p.type)).to.have.length(4);
      expect(Math.max(...points.map((p) => p.x))).to.be.closeTo(50, 1e-10);
      if (!shape) {
        for (let i = 0; i <= 64; i++) {
          const p = ball.at((i * Math.PI) / 32);
          expect(Math.hypot(p.x, p.y - 50)).to.be.closeTo(50, 1e-10);
        }
      }
    }
  });

  it("inverts the locked rib frame for the inner-wall intersection", () => {
    const ball = makeBulbBall({
      outer: { x: 10, y: 20 },
      inner: { x: 30, y: 100 },
      outerDirection: { x: 1, y: 0.5 },
      radius: 50,
      shape: 1,
    });
    for (let i = 0; i < 100; i++) {
      const theta = (i * Math.PI) / 50;
      const p = ball.at(theta),
        local = ball.localOf(p);
      expect(local.u).to.be.closeTo(Math.cos(theta), 1e-10);
      expect(local.v).to.be.closeTo(Math.sin(theta), 1e-10);
    }
    expect(ball.contains(ball.center)).to.equal(true);
  });

  it("reaches exactly one radius beyond the rib for both ends, sides and short strokes", () => {
    for (const start of [false, true])
      for (const short of [false, true])
        for (const capBallSide of ["left", "right"])
          for (const capBallRatio of [0.5, 1.25, 3]) {
            const options = { start, short };
            const ordinary = generateFromSkeleton(
              specimen({ ...options, cap: { capStyle: "butt" } })
            );
            const map = ordinary.provenance[0].pointMap,
              points = ordinary.contours[0].points;
            const endId = start ? 2 : 5;
            const outerIndex = map.findIndex(
              (p) =>
                p?.skeletonPointId === endId &&
                p.side === capBallSide &&
                p.role === "onCurve"
            );
            const innerIndex = map.findIndex(
              (p) =>
                p?.skeletonPointId === endId &&
                p.side &&
                p.side !== capBallSide &&
                p.role === "onCurve"
            );
            const outer = points[outerIndex],
              inner = points[innerIndex];
            const handle = points.find(
              (p, i) =>
                p.type &&
                map[i]?.side === capBallSide &&
                map[i]?.skeletonPointId === endId
            );
            const length = Math.hypot(outer.x - handle.x, outer.y - handle.y);
            const ex = {
              x: (outer.x - handle.x) / length,
              y: (outer.y - handle.y) / length,
            };
            const ey = { x: inner.x - outer.x, y: inner.y - outer.y };
            const det = ex.x * ey.y - ex.y * ey.x;
            for (const capBallShape of [0, 1])
              for (const capBallEasing of [0, 0.5, 1]) {
                const result = generateFromSkeleton(
                  specimen({
                    ...options,
                    cap: { capBallSide, capBallRatio, capBallShape, capBallEasing },
                  })
                );
                finite(result);
                const reach = Math.max(
                  ...capPoints(result)
                    .filter((p) => !p.type)
                    .map((p) => ((p.x - outer.x) * ey.y - (p.y - outer.y) * ey.x) / det)
                );
                expect(reach).to.be.closeTo(40 * capBallRatio, 1e-7);
              }
          }
  });

  it("joins the ball tangentially at the unchanged outer rib apex", () => {
    for (const start of [false, true])
      for (const capBallSide of ["left", "right"]) {
        const result = generateFromSkeleton(
          specimen({ start, cap: { capBallSide, capBallEasing: 0.5 } })
        );
        const points = result.contours[0].points,
          map = result.provenance[0].pointMap;
        const i = map.findIndex(
          (p) =>
            p?.skeletonPointId === (start ? 2 : 5) &&
            p.side === capBallSide &&
            !p.capCurvatureField &&
            p.role === "onCurve"
        );
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
      }
  });

  it("keeps finite geometry through size, shape, easing and rotation sweeps", () => {
    for (const capBallSide of ["left", "right"])
      for (const field of [
        "capBallRatio",
        "capBallShape",
        "capBallEasing",
        "capBallEaseCurvature",
        "angle",
      ])
        for (let step = 0; step <= 100; step++) {
          const value =
            field === "capBallRatio"
              ? 0.5 + step / 40
              : field === "angle"
                ? -0.3 + step / 100
                : step / 100;
          finite(
            generateFromSkeleton(
              specimen({
                cap: { capBallSide, ...(field !== "angle" ? { [field]: value } : {}) },
                angle: field === "angle" ? value : 0,
              })
            )
          );
        }
  });

  it("changes only neck handles when neck curvature changes", () => {
    const result = (capBallEaseCurvature) =>
      generateFromSkeleton(
        specimen({ cap: { capBallEasing: 0.5, capBallEaseCurvature } })
      );
    const one = result(0.2),
      two = result(0.8);
    expect(one.contours[0].points.filter((p) => !p.type)).to.deep.equal(
      two.contours[0].points.filter((p) => !p.type)
    );
    expect(walls(one)).to.deep.equal(walls(two));
    expect(capPoints(one)).to.not.deep.equal(capPoints(two));
  });
});
