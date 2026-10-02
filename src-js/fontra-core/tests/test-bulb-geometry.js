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
// Compare the drawn curves, not equal parameter values: refitting changes
// parameter speed even when the outline stays in the same place.
function curveMovement(a, b) {
  const samples = (points) => {
    const curve = new Bezier(points);
    return Array.from({ length: 41 }, (_, i) => curve.get(i / 40));
  };
  const departure = (points, reference) => Math.max(...points.map((p) => {
    let distance = Infinity;
    for (let i = 1; i < reference.length; i++) {
      const a = reference[i - 1], b = reference[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return distance;
  }));
  let largest = 0;
  for (let i = 0; i + 3 < a.length; i += 3) {
    const p = samples(a.slice(i, i + 4)), q = samples(b.slice(i, i + 4));
    largest = Math.max(largest, departure(p, q), departure(q, p));
  }
  return largest;
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
  it("emits only E, B, C and N between the existing wall points", () => {
    for (const start of [false, true]) for (const mirror of [false, true]) {
      for (const capBallEasing of [0, 0.01, 0.5, 1]) {
        const input = specimen({ start, mirror, cap: { capBallEasing } });
        const r = bulb(generateFromSkeleton(input));
        expect(r.points.filter((p) => !p.type)).to.have.length(6);
        expect(r.points).to.have.length(16);
        const q = r.map[r.points.indexOf(r.run[15])];
        expect(q.bulbRole).to.equal(undefined);
        expect(q.skeletonPointId).to.equal(start ? 5 : 2);
        const plain = structuredClone(input);
        plain.contours[0].points.find((p) => p.capStyle).capStyle = "butt";
        const source = generateFromSkeleton(plain);
        const qIndex = source.provenance[0].pointMap.findIndex((p) =>
          p?.skeletonPointId === q.skeletonPointId && p.side === q.side && p.role === "onCurve");
        expect(qIndex).to.be.at.least(0);
        expect(r.run[15].x).to.equal(source.contours[0].points[qIndex].x);
        expect(r.run[15].y).to.equal(source.contours[0].points[qIndex].y);
      }
    }
  });

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

  it("keeps N on the ball as a handled corner at zero easing", () => {
    const zero = bulb(generateFromSkeleton(specimen({ cap: { capBallEasing: 0 } })));
    expect(zero.run[12].smooth).to.not.equal(true);
    expect(
      Math.hypot(zero.run[11].x - zero.run[12].x, zero.run[11].y - zero.run[12].y)
    ).to.be.greaterThan(1);
    expect(Math.hypot(zero.run[13].x - zero.run[12].x,
      zero.run[13].y - zero.run[12].y)).to.be.greaterThan(1);
    expect(Math.hypot(zero.run[15].x - zero.run[12].x,
      zero.run[15].y - zero.run[12].y)).to.be.greaterThan(10);
    const near = bulb(generateFromSkeleton(specimen({ cap: { capBallEasing: 1e-5 } })));
    expect(near.run[12].smooth).to.equal(true);
    expect(near.points.length).to.equal(zero.points.length);
  });

  it("uses P's outgoing handle when E moves onto the first ball arc", () => {
    const wall = [
      { x: 0, y: 100 },
      { x: 30, y: 70, type: "cubic" },
      { x: 60, y: 40, type: "cubic" },
      { x: 90, y: 10 },
    ];
    const result = buildFourPointBulb({
      wall,
      radius: 50,
      shape: 0,
      easing: 0.5,
      inner: [
        { x: 33, y: -47 },
        { x: 0, y: -10, type: "cubic" },
        { x: -20, y: 20, type: "cubic" },
        { x: -30, y: 30 },
      ],
    });
    expect(result.entryBallParameter).to.be.within(0, 1);
    expect(result.wall[0]).to.deep.equal(wall[0]);
    expect(result.wall[1]).to.not.deep.equal(wall[1]);
    expect(result.wall[2].x).to.be.closeTo(result.points[0].x, 1e-8);
    expect(result.points[1].x).to.be.closeTo(result.points[0].x, 1e-8);
  });

  it("retains the round body and fits directly to the existing wall point", () => {
    // Approximate the curved walls in the annotated reference, in font axes.
    const wall = [
      { x: 547, y: -66 },
      { x: 917, y: -66, type: "cubic" },
      { x: 1182, y: -322, type: "cubic" },
      { x: 785, y: -618 },
    ];
    const inner = [
      { x: 685, y: -482 },
      { x: 848, y: -322, type: "cubic" },
      { x: 750, y: -145, type: "cubic" },
      { x: 545, y: -145 },
    ];
    const source = new Bezier(inner);
    let zero;
    for (const easing of [0, 0.001, 0.1, 0.3, 0.6, 1]) {
      const r = buildFourPointBulb({ wall, inner, radius: 197, shape: 0, easing });
      const normalizedEdits = buildFourPointBulb({ wall, inner, radius: 197, shape: 0, easing,
        edits: Object.fromEntries(["entry", "bottom", "side", "neck"].map((role) => [role,
          { in: 0, out: 0, slide: 0, carry: 0, normal: 0, turn: 0, vslide: 0 }])) });
      expect(normalizedEdits.points).to.deep.equal(r.points);
      const body = new Bezier(r.points.slice(3, 7));
      const retained = new Bezier(r.points.slice(9));
      expect(r.points.filter((p) => !p.type)).to.have.length(5);
      expect(r.points[12]).to.deep.equal(inner[3]);
      for (let i = 0; i <= 40; i++) {
        const local = r.ball.localOf(body.get(i / 40));
        expect(Math.abs(Math.hypot(local.u, local.v) - 1)).to.be.below(0.03);
        const a = source.get(r.cutParameter + ((1 - r.cutParameter) * i) / 40);
        if (!easing) {
          const b = retained.get(i / 40);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).to.be.below(1e-8);
        } else {
          expect(retained.project(a).d).to.be.below(0.05 * 197);
        }
      }
      expect(r.error, `easing=${easing}`).to.be.below(1e-5);
      if (!easing) {
        zero = r;
        const local = r.ball.localOf(r.points[9]);
        expect(Math.hypot(local.u, local.v)).to.be.closeTo(1, 1e-8);
      } else {
        expect(r.cutParameter).to.be.greaterThan(zero.cutParameter);
        expect(r.points[9].y).to.be.greaterThan(zero.points[9].y);
      }
    }
  });

  it("does not depend on the previous glyph or slider history", () => {
    const input = specimen(),
      expected = generateFromSkeleton(input);
    for (const ratio of [3, 0.5, 2, 0.6])
      generateFromSkeleton(specimen({ mirror: true, cap: { capBallRatio: ratio } }));
    expect(generateFromSkeleton(input)).to.deep.equal(expected);
  });

  it("keeps topology, curvature and point travel stable through parameter sweeps", function () {
    this.timeout(90000);
    for (const field of [
      "capBallRatio",
      "capBallShape",
      "capBallEasing",
      "capBallEaseCurvature",
    ]) {
      let previous;
      // The circle/wall contact travels fastest as the diameter approaches
      // the stroke width. Sample size at 0.005 intervals through that contact.
      const steps = field === "capBallRatio" ? 500 : 100;
      for (let i = 0; i <= steps; i++) {
        const value = field === "capBallRatio" ? 0.5 + (2.5 * i) / steps : i / steps;
        const { points, run } = bulb(
          generateFromSkeleton(specimen({ cap: { [field]: value } }))
        );
        verifyApexes(run);
        expect(
          points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        ).to.equal(true);
        for (let join = 3; join <= 12; join += 3) {
          if (join >= 12 && field === "capBallEasing" && i === 0) continue;
          expect(
            combStep(run.slice(join - 3, join + 1), run.slice(join, join + 4)),
            `${field}=${value}, join ${join}`
          ).to.be.below(0.001);
        }
        if (previous) {
          expect(points.length).to.equal(previous.count);
          expect(curveMovement(run, previous.run), `${field}=${value}`).to.be.below(5);
        }
        previous = { count: points.length, run };
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
