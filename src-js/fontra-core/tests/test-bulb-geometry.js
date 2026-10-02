import { Bezier } from "bezier-js";
import { expect } from "chai";
import { bulbEntry, buildFourPointBulb, makeBulbBall } from "../src/bulb-geometry.js";
import { splitCubicAt } from "../src/offset-contour.js";
import { generateFromSkeleton } from "../src/skeleton-generator.js";

function specimen({ cap = {}, start = false, mirror = false, single = true } = {}) {
  let points = [
    { x: 0, y: 200 },
    { x: 300, y: 200, type: "cubic" },
    { x: 360, y: 100, type: "cubic" },
    { x: 340, y: 0 },
  ];
  if (start) points.reverse();
  const side = start !== mirror ? "left" : "right";
  const inner = side === "left" ? "right" : "left";
  return {
    contours: [
      {
        id: 1,
        defaultWidth: 80,
        singleSided: single ? inner : null,
        points: points.map((p, i) => ({
          ...p,
          id: i + 2,
          x: mirror ? -p.x : p.x,
          ...(i === (start ? 0 : 3)
            ? { capStyle: "drop", capBallSide: side, capBallEasing: 0.5, ...cap }
            : {}),
        })),
      },
    ],
  };
}
function bulb(result) {
  const points = result.contours[0].points,
    map = result.provenance[0].pointMap;
  const roles = ["entry", "bottom", "side", "neck"];
  const indices = roles.map((role) =>
    map.findIndex((p) => p?.bulbRole === role && p.bulbSlot === "onCurve")
  );
  expect(indices.every((i) => i >= 0)).to.equal(true);
  const direction = (indices[0] + 3) % points.length === indices[1] ? 1 : -1;
  const at = (j) =>
    points[(indices[0] + direction * j + 3 * points.length) % points.length];
  return {
    points,
    map,
    indices,
    origin: map[indices[0]],
    run: Array.from({ length: 16 }, (_, i) => at(i - 3)),
  };
}
function combStep(a, b) {
  const ka = new Bezier(a).curvature(1).k,
    kb = new Bezier(b).curvature(0).k;
  return Math.abs(ka - kb) / Math.max(1e-4, Math.abs(ka), Math.abs(kb));
}
function verifyApexes(run) {
  for (const [i, axis] of [
    [3, "x"],
    [6, "y"],
    [9, "x"],
  ]) {
    expect(run[i - 1][axis]).to.be.closeTo(run[i][axis], 1e-9);
    expect(run[i + 1][axis]).to.be.closeTo(run[i][axis], 1e-9);
  }
}

describe("four-point bulb construction", () => {
  it("grows its preferred ball from the rib, including a sheared frame", () => {
    for (const shape of [0, 0.5, 1]) {
      const ball = makeBulbBall({
        outer: { x: 10, y: 20 },
        inner: { x: -70, y: 40 },
        outerDirection: { x: 0, y: -1 },
        radius: 50,
        shape,
      });
      expect(ball.at(-Math.PI / 2).x).to.be.closeTo(10, 1e-10);
      expect(ball.at(-Math.PI / 2).y).to.be.closeTo(20, 1e-10);
      for (let i = 0; i < 20; i++) {
        const theta = (i * Math.PI) / 10,
          local = ball.localOf(ball.at(theta));
        expect(local.u).to.be.closeTo(Math.cos(theta), 1e-10);
        expect(local.v).to.be.closeTo(Math.sin(theta), 1e-10);
      }
      expect(ball.rearRadius).to.equal(50 * (1 + 1.4 * shape));
    }
  });

  it("cuts E exactly at the wall's horizontal extreme", () => {
    const wall = specimen().contours[0].points;
    const entry = bulbEntry(wall);
    expect(entry.orthogonal).to.equal(true);
    expect(entry.t).to.be.below(1);
    const source = new Bezier(wall),
      retained = new Bezier(entry.wall);
    for (let i = 0; i <= 50; i++) {
      const a = source.get((entry.t * i) / 50),
        b = retained.get(i / 50);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).to.be.below(1e-10);
    }
    const a = bulbEntry(splitCubicAt(wall, entry.t).first);
    expect(a.t).to.be.closeTo(1, 1e-9);
  });

  for (const start of [false, true])
    for (const mirror of [false, true]) {
      it(`keeps four roles, orthogonal apexes and an exact skeleton wall (${start}, ${mirror})`, () => {
        const input = specimen({ start, mirror });
        const result = generateFromSkeleton(input),
          { run, origin, map } = bulb(result);
        expect(origin.bulbEntryOrthogonal).to.equal(true);
        expect(
          map
            .filter((p) => p?.bulbSlot === "onCurve")
            .map((p) => p.bulbRole)
            .sort()
        ).to.deep.equal(["bottom", "entry", "neck", "side"]);
        verifyApexes(run);
        const wall = [...input.contours[0].points];
        if (start) wall.reverse();
        const source = new Bezier(wall),
          drawn = new Bezier(run.slice(0, 4));
        for (let i = 0; i <= 30; i++) {
          const a = source.get((origin.bulbEntryParameter * i) / 30),
            b = drawn.get(i / 30);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).to.be.below(1e-8);
        }
        for (let i = 3; i <= 12; i += 3)
          expect(combStep(run.slice(i - 3, i + 1), run.slice(i, i + 4))).to.be.below(
            1e-4
          );
      });
    }

  it("preserves the rib-grown preference when E moves back onto the wall", () => {
    const wall = specimen().contours[0].points;
    const inner = [
      { x: 260, y: 0 },
      { x: 280, y: 80 },
      { x: 220, y: 120 },
      { x: 0, y: 120 },
    ];
    const result = buildFourPointBulb({
      wall,
      inner,
      radius: 50,
      shape: 0.4,
      easing: 0.5,
    });
    expect(result.entryParameter).to.be.below(1);
    expect(result.ball.at(-Math.PI / 2).x).to.be.closeTo(wall[3].x, 1e-10);
    expect(result.ball.at(-Math.PI / 2).y).to.be.closeTo(wall[3].y, 1e-10);
    expect(
      Math.hypot(result.points[0].x - wall[3].x, result.points[0].y - wall[3].y)
    ).to.be.greaterThan(10);
  });

  it("has a continuous corner limit, with two collapsed handles only at zero easing", () => {
    const zero = bulb(generateFromSkeleton(specimen({ cap: { capBallEasing: 0 } })));
    expect(zero.run[12].smooth).to.not.equal(true);
    for (const i of [11, 13]) {
      expect(zero.run[i].x).to.equal(zero.run[12].x);
      expect(zero.run[i].y).to.equal(zero.run[12].y);
    }
    const near = bulb(generateFromSkeleton(specimen({ cap: { capBallEasing: 1e-5 } })));
    expect(near.run[12].smooth).to.equal(true);
    expect(
      Math.max(
        ...zero.run.map((p, i) => Math.hypot(p.x - near.run[i].x, p.y - near.run[i].y))
      )
    ).to.be.below(0.05);
  });

  it("does not depend on the previous glyph or slider history", () => {
    const input = specimen(),
      expected = generateFromSkeleton(input);
    for (const ratio of [3, 0.5, 2, 0.6])
      generateFromSkeleton(specimen({ mirror: true, cap: { capBallRatio: ratio } }));
    expect(generateFromSkeleton(input)).to.deep.equal(expected);
  });

  it("keeps topology, curvature and point travel stable through parameter sweeps", function () {
    this.timeout(30000);
    for (const field of [
      "capBallRatio",
      "capBallShape",
      "capBallEasing",
      "capBallEaseCurvature",
    ]) {
      let previous;
      for (let i = 0; i <= 100; i++) {
        const value = field === "capBallRatio" ? 0.5 + (2.5 * i) / 100 : i / 100;
        const { points, run } = bulb(
          generateFromSkeleton(specimen({ cap: { [field]: value } }))
        );
        verifyApexes(run);
        expect(
          points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        ).to.equal(true);
        for (let join = 3; join <= 12; join += 3) {
          if (join === 12 && field === "capBallEasing" && i === 0) continue;
          expect(
            combStep(run.slice(join - 3, join + 1), run.slice(join, join + 4)),
            `${field}=${value}, join ${join}`
          ).to.be.below(0.001);
        }
        if (previous) {
          expect(points.length).to.equal(previous.length);
          expect(
            Math.max(
              ...points.map((p, k) =>
                Math.hypot(p.x - previous[k].x, p.y - previous[k].y)
              )
            ),
            `${field}=${value}`
          ).to.be.below(5);
        }
        previous = points;
      }
    }
  });

  it("reports an incompatible entry while preserving a diagonal straight wall", () => {
    const wall = [
      { x: 0, y: 100 },
      { x: 30, y: 70 },
      { x: 60, y: 40 },
      { x: 90, y: 10 },
    ];
    const entry = bulbEntry(wall);
    expect(entry.orthogonal).to.equal(false);
    expect(entry.wall).to.deep.equal(wall);
  });
});
