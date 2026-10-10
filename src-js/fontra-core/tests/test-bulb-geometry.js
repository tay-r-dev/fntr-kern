import { Bezier } from "bezier-js";
import { expect } from "chai";
import { bulbEntry, buildBulb, makeBulbBall } from "../src/bulb-geometry.js";
import { bulbEndCurvature } from "../src/bulb-harmonization.js";
import { cubicPointAt, splitCubicAt } from "../src/offset-contour.js";
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
  const roles = ["entry", "bottom", "side", "fillet-ball", "fillet-wall"];
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
    run: Array.from({ length: 19 }, (_, i) => at(i - 3)),
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
  const departure = (points, reference) =>
    Math.max(
      ...points.map((p) => {
        let distance = Infinity;
        for (let i = 1; i < reference.length; i++) {
          const a = reference[i - 1],
            b = reference[i];
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)
            )
          );
          distance = Math.min(
            distance,
            Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
          );
        }
        return distance;
      })
    );
  let largest = 0;
  for (let i = 0; i + 3 < a.length; i += 3) {
    const p = samples(a.slice(i, i + 4)),
      q = samples(b.slice(i, i + 4));
    largest = Math.max(largest, departure(p, q), departure(q, p));
  }
  return largest;
}
// E is checked only while the entry says it stayed at the wall's extreme. Slid
// up the wall to meet the curvature, it leaves at the wall's own angle.
function verifyApexes(run, entryOrthogonal = true) {
  for (const [i, axis] of [
    ...(entryOrthogonal ? [[3, "x"]] : []),
    [6, "y"],
    [9, "x"],
  ]) {
    expect(run[i - 1][axis]).to.be.closeTo(run[i][axis], 1e-9);
    expect(run[i + 1][axis]).to.be.closeTo(run[i][axis], 1e-9);
  }
}

// The bulb inputs of three glyphs the designer drew in skeletron-test: one
// stroke, its terminal moved and turned a little between them. The outer wall
// runs toward the rib, the inner wall away from it.
const cubic = (coordinates) =>
  coordinates.map(([x, y], i) => ({
    x,
    y,
    ...(i === 1 || i === 2 ? { type: "cubic" } : {}),
  }));
const DRAWN = {
  Q: {
    wall: cubic([
      [24, 477],
      [141, 477],
      [223, 417],
      [186, 233],
    ]),
    inner: cubic([
      [127, 245],
      [159, 400],
      [107, 438],
      [24, 438],
    ]),
  },
  R: {
    wall: cubic([
      [24, 477],
      [141, 477],
      [223, 417],
      [146, 281],
    ]),
    inner: cubic([
      [94, 311],
      [155, 417],
      [91, 438],
      [24, 438],
    ]),
  },
  S: {
    wall: cubic([
      [24, 477],
      [141, 477],
      [223, 417],
      [204, 284],
    ]),
    inner: cubic([
      [145, 292],
      [161, 402],
      [99, 438],
      [24, 438],
    ]),
  },
};
const drawn = (name, easing, extra = {}) =>
  buildBulb({ ...DRAWN[name], radius: 51, shape: 0, easing, ...extra });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const samples = (curve, n = 60) =>
  Array.from({ length: n + 1 }, (_, i) => cubicPointAt(curve, i / n));
// Signed distance from the inner wall, positive on the counter side: the side
// the ball's side apex stands on.
function counterSide(inner, reference) {
  const wall = samples(inner, 600);
  const signed = (p) => {
    let k = 0;
    wall.forEach((w, i) => {
      if (distance(p, w) < distance(p, wall[k])) k = i;
    });
    const a = wall[Math.max(k - 1, 0)],
      b = wall[Math.min(k + 1, wall.length - 1)];
    const cross = (b.x - a.x) * (p.y - wall[k].y) - (b.y - a.y) * (p.x - wall[k].x);
    return Math.sign(cross) * distance(p, wall[k]);
  };
  const sign = Math.sign(signed(reference));
  return (p) => sign * signed(p);
}
// The nearest point of a cubic, to far better than a unit: a dense scan, then
// narrowed down. The curve library's own projection is good to about a tenth.
function project(curve, p) {
  let best = 0;
  for (let i = 1; i <= 2000; i++)
    if (
      distance(p, cubicPointAt(curve, i / 2000)) <
      distance(p, cubicPointAt(curve, best))
    )
      best = i / 2000;
  let lo = Math.max(0, best - 1 / 2000),
    hi = Math.min(1, best + 1 / 2000);
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3,
      m2 = hi - (hi - lo) / 3;
    if (distance(p, cubicPointAt(curve, m1)) < distance(p, cubicPointAt(curve, m2)))
      hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { t, d: distance(p, cubicPointAt(curve, t)) };
}
// Length along the ball between two angles. The ball's frame can be sheared,
// so an angle times the radius is not a length.
function alongBall(ball, from, to) {
  let total = 0,
    p = ball.at(from);
  for (let i = 1; i <= 4000; i++) {
    const q = ball.at(from + ((to - from) * i) / 4000);
    total += distance(p, q);
    p = q;
  }
  return total;
}
const EASINGS = Array.from({ length: 51 }, (_, i) => i / 50);

describe("bulb construction", () => {
  it("emits E, B, C, the fillet's two ends and the existing wall point", () => {
    for (const start of [false, true])
      for (const mirror of [false, true]) {
        for (const capBallEasing of [0, 0.01, 0.5, 1]) {
          const input = specimen({ start, mirror, cap: { capBallEasing } });
          const r = bulb(generateFromSkeleton(input));
          expect(r.points.filter((p) => !p.type)).to.have.length(7);
          expect(r.points).to.have.length(19);
          const q = r.map[r.points.indexOf(r.run[18])];
          expect(q.bulbRole).to.equal(undefined);
          expect(q.skeletonPointId).to.equal(start ? 5 : 2);
          const plain = structuredClone(input);
          plain.contours[0].points.find((p) => p.capStyle).capStyle = "butt";
          const source = generateFromSkeleton(plain);
          const qIndex = source.provenance[0].pointMap.findIndex(
            (p) =>
              p?.skeletonPointId === q.skeletonPointId &&
              p.side === q.side &&
              p.role === "onCurve"
          );
          expect(qIndex).to.be.at.least(0);
          expect(r.run[18].x).to.equal(source.contours[0].points[qIndex].x);
          expect(r.run[18].y).to.equal(source.contours[0].points[qIndex].y);
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
      it(`keeps five roles, orthogonal apexes and an exact skeleton wall (${start}, ${mirror})`, () => {
        const input = specimen({ start, mirror });
        const result = generateFromSkeleton(input),
          { run, origin, map } = bulb(result);
        expect(origin.bulbEntryOrthogonal).to.equal(true);
        expect(
          map
            .filter((p) => p?.bulbSlot === "onCurve")
            .map((p) => p.bulbRole)
            .sort()
        ).to.deep.equal(["bottom", "entry", "fillet-ball", "fillet-wall", "side"]);
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
        for (let i = 3; i <= 15; i += 3)
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
    const result = buildBulb({ wall, inner, radius: 50, shape: 0.4, easing: 0.5 });
    expect(result.entryParameter).to.be.below(1);
    expect(result.ball.at(-Math.PI / 2).x).to.be.closeTo(wall[3].x, 1e-10);
    expect(result.ball.at(-Math.PI / 2).y).to.be.closeTo(wall[3].y, 1e-10);
    expect(
      Math.hypot(result.points[0].x - wall[3].x, result.points[0].y - wall[3].y)
    ).to.be.greaterThan(10);
  });

  it("uses P's outgoing handle when E moves onto the first ball arc", () => {
    const wall = [
      { x: 0, y: 100 },
      { x: 30, y: 70, type: "cubic" },
      { x: 60, y: 40, type: "cubic" },
      { x: 90, y: 10 },
    ];
    const result = buildBulb({
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

  it("does not depend on the previous glyph or slider history", () => {
    const input = specimen(),
      expected = generateFromSkeleton(input);
    for (const ratio of [3, 1.2, 2, 1.4])
      generateFromSkeleton(specimen({ mirror: true, cap: { capBallRatio: ratio } }));
    expect(generateFromSkeleton(input)).to.deep.equal(expected);
  });

  it("keeps topology, curvature and point travel stable through parameter sweeps", function () {
    this.timeout(90000);
    for (const field of ["capBallRatio", "capBallShape", "capBallEasing"]) {
      let previous;
      const steps = field === "capBallRatio" ? 300 : 100;
      for (let i = 0; i <= steps; i++) {
        // Ball sizes under 1.1 of the stroke width are not a case to design for.
        const value = field === "capBallRatio" ? 1.1 + (1.9 * i) / steps : i / steps;
        const { points, run, origin } = bulb(
          generateFromSkeleton(specimen({ cap: { [field]: value } }))
        );
        verifyApexes(run, origin.bulbEntryOrthogonal);
        expect(
          points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        ).to.equal(true);
        for (let join = 3; join <= 15; join += 3) {
          // At zero easing the fillet lies on the corner, which is a corner.
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

// Easing is a fillet in the corner where the ball meets the inner wall, the way
// solder fills the corner between a part and its pad. It only adds material.
describe("bulb easing fillet", () => {
  for (const name of Object.keys(DRAWN))
    it(`keeps the ball under the fillet and the stroke beside it (${name})`, () => {
      for (const easing of EASINGS) {
        const r = drawn(name, easing);
        const p = r.points;
        // C to A is the ball itself.
        for (const point of samples(p.slice(6, 10))) {
          const { u, v } = r.ball.localOf(point);
          expect(Math.hypot(u, v), `easing ${easing}`).to.be.closeTo(1, 0.01);
        }
        // The fillet stays outside the ball and on the counter side of the wall.
        const side = counterSide(DRAWN[name].inner, p[6]);
        for (const point of samples(p.slice(9, 13))) {
          const { u, v } = r.ball.localOf(point);
          // A graze under a quarter of a unit is under what the grid can draw.
          expect((1 - Math.hypot(u, v)) * 51, `easing ${easing}`).to.be.at.most(0.25);
          expect(side(point), `easing ${easing}`).to.be.at.least(-1e-6);
        }
      }
    });

  for (const name of Object.keys(DRAWN))
    it(`leaves the wall exact from W to the next wall point (${name})`, () => {
      for (const easing of EASINGS) {
        const p = drawn(name, easing).points;
        expect(p[15]).to.deep.include({
          x: DRAWN[name].inner[3].x,
          y: DRAWN[name].inner[3].y,
        });
        for (const point of samples(p.slice(12, 16), 20))
          expect(project(DRAWN[name].inner, point).d, `easing ${easing}`).to.be.below(
            1e-6
          );
      }
    });

  for (const name of Object.keys(DRAWN))
    it(`joins the ball and the wall with no step in the comb (${name})`, () => {
      for (const easing of EASINGS.slice(1)) {
        const p = drawn(name, easing).points;
        for (const join of [9, 12]) {
          const before = p.slice(join - 3, join + 1),
            after = p.slice(join, join + 4);
          expect(
            Math.abs(bulbEndCurvature(before, true) - bulbEndCurvature(after)) * 51,
            `easing ${easing}, join ${join}`
          ).to.be.below(1e-6);
          const u = { x: before[3].x - before[2].x, y: before[3].y - before[2].y };
          const v = { x: after[1].x - after[0].x, y: after[1].y - after[0].y };
          expect(
            (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)),
            `easing ${easing}, join ${join}`
          ).to.be.closeTo(1, 1e-9);
        }
      }
    });

  for (const name of Object.keys(DRAWN))
    it(`grows from the corner, stops on the ball and climbs the wall (${name})`, () => {
      const zero = drawn(name, 0);
      // No easing: the ball meets the wall at a corner, and the fillet's four
      // points lie on it.
      for (const i of [10, 11, 12])
        expect(distance(zero.points[i], zero.points[9])).to.be.below(1e-9);
      expect(zero.points[9].smooth).to.not.equal(true);
      const corner = project(DRAWN[name].inner, zero.points[12]).t;
      const cornerTheta = zero.ball.thetaOf(zero.points[9]);
      let previous;
      for (const easing of EASINGS.slice(1)) {
        const r = drawn(name, easing);
        const ballTravel = alongBall(r.ball, r.ball.thetaOf(r.points[9]), cornerTheta);
        const wallTravel = project(DRAWN[name].inner, r.points[12]).t - corner;
        expect(ballTravel, `easing ${easing}`).to.be.greaterThan(0);
        // The ball end stops 0.75 of a radius back from the corner.
        expect(ballTravel, `easing ${easing}`).to.be.at.most(0.75 * 51 + 1e-6);
        if (previous) {
          expect(ballTravel, `easing ${easing}`).to.be.at.least(
            previous.ballTravel - 1e-9
          );
          expect(wallTravel, `easing ${easing}`).to.be.greaterThan(previous.wallTravel);
        }
        previous = { ballTravel, wallTravel };
      }
      expect(previous.ballTravel).to.be.closeTo(0.75 * 51, 1e-6);
    });

  for (const name of Object.keys(DRAWN))
    it(`moves a little for a little change of easing or terminal (${name})`, () => {
      // From C to the next wall point: the ball's return, the fillet and the
      // wall. The entry has its own rule and is not this test's subject.
      const neck = (points) => points.slice(6);
      let previous = neck(drawn(name, 0).points);
      for (let i = 1; i <= 200; i++) {
        const points = neck(drawn(name, i / 200).points);
        expect(curveMovement(points, previous), `easing ${i / 200}`).to.be.below(3);
        previous = points;
      }
      // The terminal moved a quarter of a unit at a time, as the designer
      // moved it between the glyphs.
      const base = DRAWN[name];
      previous = null;
      for (let i = 0; i <= 80; i++) {
        const shift = { x: -i / 4, y: (i / 4) * 1.2 };
        const move = (p) => ({ ...p, x: p.x + shift.x, y: p.y + shift.y });
        const points = neck(
          buildBulb({
            wall: base.wall.map((p, k) => (k === 3 ? move(p) : p)),
            inner: base.inner.map((p, k) => (k === 0 ? move(p) : p)),
            radius: 51,
            shape: 0,
            easing: 0.6,
          }).points
        );
        if (previous)
          expect(curveMovement(points, previous), `shift ${i / 4}`).to.be.below(3);
        previous = points;
      }
    });

  it("draws about the same fillet for the same easing on all three glyphs", () => {
    for (const easing of [0.25, 0.5, 0.75, 1]) {
      const handles = Object.keys(DRAWN).map((name) => {
        const p = drawn(name, easing).points;
        return [distance(p[9], p[10]), distance(p[12], p[11])];
      });
      for (const k of [0, 1]) {
        const values = handles.map((h) => h[k]);
        expect(
          Math.max(...values) - Math.min(...values),
          `easing ${easing}`
        ).to.be.below(0.5 * Math.max(...values));
      }
    }
  });
});
