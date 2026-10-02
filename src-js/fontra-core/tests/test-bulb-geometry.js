import { Bezier } from "bezier-js";
import { makeSlideCandidate } from "../src/point-slide.js";
import { curvatureDiscontinuity, gridKinkAllowance } from "../src/harmonization.js";
import { expect } from "chai";
import { buildBulbArc, makeBulbBall, slideBulbEntry } from "../src/bulb-geometry.js";
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

// The inner side's last cubic at the capped end, as four points in contour
// order: the wall segment the cap cuts.
function innerWallSegment(result, side, endId) {
  const points = result.contours[0].points,
    map = result.provenance[0].pointMap,
    n = points.length;
  for (let i = 0; i < n; i++) {
    const segment = [0, 1, 2, 3].map((k) => (i + k) % n);
    const [a, b, c, d] = segment.map((k) => points[k]);
    if (a.type || !b.type || !c.type || d.type) continue;
    const origins = segment.map((k) => map[k]);
    if (origins.some((o) => o?.side !== side || o.capCurvatureField)) continue;
    if (!origins.some((o) => o.skeletonPointId === endId && o.role !== "onCurve"))
      continue;
    return [a, b, c, d];
  }
  throw new Error(`no inner wall segment on ${side}`);
}

function finite(result) {
  expect(result.contours).to.have.length(1);
  expect(result.contours[0].isClosed).to.equal(true);
  expect(
    result.contours[0].points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  ).to.equal(true);
}

describe("rib-apex bulbs", function () {
  this.timeout(20000);
  it("keeps the original outer construction for its gizmo while sliding the entry", () => {
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
                const snapshot = walls(result).find(
                  (p) => p.origin.side === capBallSide && p.origin.constructionSegment
                )?.origin.constructionSegment;
                expect(snapshot).to.have.length(4);
                const coords = (ps) => ps.map(({ x, y }) => `${x},${y}`).sort();
                expect(
                  coords(
                    outerWall.length === 4 ? snapshot : [snapshot[0], snapshot.at(-1)]
                  )
                ).to.deep.equal(coords(outerWall));
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

  it("keeps the construction rib fixed for tapered and locked walls", () => {
    for (const start of [false, true])
      for (const lock of [null, "horizontal", "vertical"])
        for (const capBallSide of ["left", "right"]) {
          const options = { start, taper: true, lock };
          const outer = (result) =>
            walls(result).find(
              (p) => p.origin.side === capBallSide && p.origin.constructionSegment
            )?.origin.constructionSegment;
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
      // Three on-curves after the entry: the bottom, the side apex and the end.
      const points = buildBulbArc(ball, 1.3 * Math.PI);
      expect(points.filter((p) => !p.type)).to.have.length(3);
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

  it("keeps the forward radius within cubic arc accuracy after sliding", () => {
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
                const generated = result.contours[0].points;
                const samples = [...generated.filter((p) => !p.type)];
                for (let i = 0; i < generated.length; i++) {
                  if (generated[i].type || !generated[(i + 1) % generated.length].type)
                    continue;
                  const curve = new Bezier(
                    [0, 1, 2, 3].map((j) => generated[(i + j) % generated.length])
                  );
                  for (let j = 0; j <= 100; j++) samples.push(curve.get(j / 100));
                }
                const reach = Math.max(
                  ...samples.map(
                    (p) => ((p.x - outer.x) * ey.y - (p.y - outer.y) * ey.x) / det
                  )
                );
                expect(reach).to.be.closeTo(
                  40 * capBallRatio,
                  0.002 * 40 * capBallRatio
                );
              }
          }
  });

  it("joins the ball with matching tangent and curvature after the slide", () => {
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
        // Straight to within what whole units can bend.
        expect(
          Math.asin(
            Math.min(
              1,
              Math.abs(u.x * v.y - u.y * v.x) /
                (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
            )
          )
        ).to.be.at.most(gridKinkAllowance(before, p, after));
        expect(u.x * v.x + u.y * v.y).to.be.greaterThan(0);
        const at = (n) => points[(i + n + points.length) % points.length];
        const incoming = [-3, -2, -1, 0].map(at),
          outgoing = [0, 1, 2, 3].map(at);
        expect(curvatureDiscontinuity(incoming, outgoing)).to.be.below(1e-6);
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
        for (let step = 0; step <= 20; step++) {
          const value =
            field === "capBallRatio"
              ? 0.5 + step / 8
              : field === "angle"
                ? -0.3 + step / 20
                : step / 20;
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

  it("places the remaining ball on-curves at glyph-axis extrema at every lean", () => {
    for (const capBallSide of ["left", "right"])
      for (const start of [false, true])
        for (const angle of [0, 0.4, 1.3, 2.1]) {
          const result = generateFromSkeleton(
            specimen({
              start,
              angle,
              cap: { capBallSide, capBallShape: 1, capBallEasing: 0.5 },
            })
          );
          const points = result.contours[0].points,
            map = result.provenance[0].pointMap;
          let count = 0;
          points.forEach((p, i) => {
            if (p.type || map[i]?.side || map[i]?.role !== "onCurve") return;
            const before = points[(i - 1 + points.length) % points.length],
              after = points[(i + 1) % points.length];
            // A stop past the neck collapses onto it, and is no extreme.
            if ([before, after].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-8))
              return;
            expect(before.type).to.equal("cubic");
            expect(after.type).to.equal("cubic");
            const vertical =
              Math.abs(before.x - p.x) < 1e-8 && Math.abs(after.x - p.x) < 1e-8;
            const horizontal =
              Math.abs(before.y - p.y) < 1e-8 && Math.abs(after.y - p.y) < 1e-8;
            expect(vertical || horizontal, `apex ${i} at ${angle}`).to.equal(true);
            const axis = vertical ? "y" : "x";
            expect((before[axis] - p[axis]) * (after[axis] - p[axis])).to.be.at.most(
              1e-8
            );
            count++;
          });
          expect(count).to.be.at.least(1);
        }
  });

  it("uses the actual V-slide and keeps the retained ball arc exact", () => {
    const outer = { x: 439, y: 51 };
    const wall = [
      { x: 27, y: 227 },
      { x: 137, y: 74, type: "cubic" },
      { x: 293, y: 17, type: "cubic" },
      outer,
    ];
    const ball = makeBulbBall({
      outer,
      inner: { x: 421, y: 129 },
      outerDirection: { x: 146, y: 34 },
      radius: 50,
      shape: 0,
    });
    const arc = buildBulbArc(ball, 2.4),
      slid = slideBulbEntry(wall, arc);
    // A positive slide runs up the wall, a negative one into the ball.
    expect(Math.abs(slid.s)).to.be.greaterThan(0);
    expect(Math.abs(slid.s)).to.be.below(1);
    const candidate = makeSlideCandidate(
      { points: [...wall, ...arc.slice(0, 3)], isClosed: false },
      3,
      slid.s > 0 ? "previous" : "next",
      slid.s > 0 ? 1 - slid.s : -slid.s
    );
    expect(slid.wall.at(-1)).to.deep.equal(candidate.points[3]);
    // The slid segment's handle lengths are harmonized afterwards; its
    // on-curves are the V-slide's.
    expect(slid.arc[2]).to.deep.equal(candidate.points[6]);
    expect(slid.arc.slice(3)).to.deep.equal(arc.slice(3));
    expect(
      curvatureDiscontinuity(slid.wall, [slid.wall.at(-1), ...slid.arc.slice(0, 3)])
    ).to.be.below(1e-6);
  });

  it("keeps harmonious entry when the first orthogonal apex leaves little slide room", () => {
    for (const angle of [0, 1.3])
      for (const capBallSide of ["left", "right"])
        for (const capBallRatio of [0.5, 1.25, 3]) {
          const result = generateFromSkeleton(
            specimen({ angle, cap: { capBallSide, capBallRatio, capBallEasing: 0.5 } })
          );
          const p = result.contours[0].points,
            map = result.provenance[0].pointMap;
          const i = map.findIndex(
            (q) =>
              q?.side === capBallSide &&
              q.skeletonPointId === 5 &&
              q.role === "onCurve" &&
              !q.capCurvatureField
          );
          const at = (j) => p[(i + j + p.length) % p.length];
          expect(
            curvatureDiscontinuity([-3, -2, -1, 0].map(at), [0, 1, 2, 3].map(at))
          ).to.be.below(1e-6);
        }
  });

  it("makes a harmonious entry from a straight terminal too", () => {
    for (const capBallSide of ["left", "right"]) {
      const result = generateFromSkeleton({
        contours: [
          {
            id: 1,
            defaultWidth: 80,
            points: [
              { id: 2, x: 0, y: 0 },
              {
                id: 3,
                x: 200,
                y: 0,
                capStyle: "drop",
                capBallSide,
                capBallEasing: 0.5,
              },
            ],
          },
        ],
      });
      finite(result);
      const p = result.contours[0].points,
        map = result.provenance[0].pointMap;
      const i = map.findIndex(
        (q) =>
          q?.side === capBallSide &&
          q.skeletonPointId === 3 &&
          q.role === "onCurve" &&
          !q.capCurvatureField
      );
      const at = (j) => p[(i + j + p.length) % p.length];
      expect(
        curvatureDiscontinuity([-3, -2, -1, 0].map(at), [0, 1, 2, 3].map(at))
      ).to.be.below(1e-6);
    }
  });

  // The inner wall the ball does not take is the stroke's own wall, cut and
  // emitted unchanged. The old neck drew the stem piece and the neck as one
  // curve, which left the wall by up to 22 units on this specimen.
  it("keeps the inner wall it does not consume on the stroke's wall", () => {
    for (const start of [false, true])
      for (const capBallSide of ["left", "right"]) {
        const innerSide = capBallSide === "left" ? "right" : "left";
        const butt = generateFromSkeleton(
          specimen({ start, cap: { capStyle: "butt" } })
        );
        const wallCurve = new Bezier(innerWallSegment(butt, innerSide, start ? 2 : 5));
        for (const capBallEasing of [0, 0.2, 0.5, 0.8, 1]) {
          const result = generateFromSkeleton(
            specimen({ start, cap: { capBallSide, capBallEasing } })
          );
          finite(result);
          const piece = innerWallSegment(result, innerSide, start ? 2 : 5);
          const drawn = new Bezier(piece);
          for (let j = 0; j <= 50; j++) {
            const p = drawn.get(j / 50);
            expect(wallCurve.project(p).d, `easing ${capBallEasing}`).to.be.below(0.75);
          }
        }
      }
  });

  it("keeps one point count through easing, size and the ball leaving the wall", () => {
    for (const capBallSide of ["left", "right"]) {
      const counts = new Set();
      for (let step = 0; step <= 40; step++) {
        counts.add(
          generateFromSkeleton(
            specimen({ cap: { capBallSide, capBallEasing: step / 40 } })
          ).contours[0].points.length
        );
        counts.add(
          generateFromSkeleton(
            specimen({ cap: { capBallSide, capBallRatio: 0.3 + step / 40 } })
          ).contours[0].points.length
        );
      }
      expect([...counts], capBallSide).to.have.length(1);
    }
  });

  it("moves the neck continuously with easing and neck curvature", () => {
    for (const capBallSide of ["left", "right"])
      for (const field of ["capBallEasing", "capBallEaseCurvature"]) {
        let previous = null;
        for (let step = 0; step <= 200; step++) {
          const points = generateFromSkeleton(
            specimen({
              cap: { capBallSide, capBallEasing: 0.5, [field]: step / 200 },
            })
          ).contours[0].points;
          if (previous) {
            const worst = Math.max(
              ...points.map((p, i) =>
                Math.hypot(p.x - previous[i].x, p.y - previous[i].y)
              )
            );
            expect(worst, `${capBallSide} ${field} ${step}`).to.be.below(5);
          }
          previous = points;
        }
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
