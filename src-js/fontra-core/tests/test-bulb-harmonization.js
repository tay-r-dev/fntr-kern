import { readFileSync } from "node:fs";
import { Bezier } from "bezier-js";
import { expect } from "chai";
import { bulbEndCurvature, harmonizeBulb } from "../src/bulb-harmonization.js";

// The user's three realized bulbs. Only normalize the small hand-drawn kink
// at N before asking the length solver for G2 continuity.
const examples = JSON.parse(
  readFileSync(new URL("./data/bulb-examples.json", import.meta.url))
);
function smoothNeck(points) {
  const p = structuredClone(points),
    n = p[9];
  const dx = p[10].x - p[8].x,
    dy = p[10].y - p[8].y;
  const distance = Math.hypot(dx, dy);
  for (const [i, sign] of [
    [8, -1],
    [10, 1],
  ]) {
    const length = Math.hypot(p[i].x - n.x, p[i].y - n.y);
    p[i].x = n.x + (sign * length * dx) / distance;
    p[i].y = n.y + (sign * length * dy) / distance;
  }
  return p;
}
function verifyJoins(wall, points, next) {
  const curves = [wall, ...[0, 3, 6, 9].map((i) => points.slice(i, i + 4)), next];
  for (let i = 1; i < curves.length; i++) {
    const a = new Bezier(curves[i - 1]),
      b = new Bezier(curves[i]);
    expect(a.curvature(1).k).to.be.closeTo(b.curvature(0).k, 1e-8);
    const u = a.derivative(1),
      v = b.derivative(0);
    expect(
      (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
    ).to.be.closeTo(1, 1e-10);
  }
}

describe("the joint bulb harmonizer", () => {
  for (const [index, example] of examples.entries()) {
    it(`matches all five signed joins in the user's bulb ${index + 1}`, () => {
      const points = smoothNeck(example.points);
      const input = {
        points,
        wall: example.wall,
        nextCurvature: bulbEndCurvature(example.next),
        radius: 80,
      };
      const snapshot = structuredClone(input);
      const result = harmonizeBulb(input);
      expect(input).to.deep.equal(snapshot);
      expect(result.status).to.equal("matched");
      verifyJoins(example.wall, result.points, example.next);
      for (const i of [0, 3, 6, 9, 12])
        expect(result.points[i]).to.deep.equal(points[i]);
      expect(
        Math.max(
          ...points.map((p, i) =>
            Math.hypot(p.x - result.points[i].x, p.y - result.points[i].y)
          )
        )
      ).to.be.below(16);
      expect(harmonizeBulb(input)).to.deep.equal(result);
    });
  }

  it("is invariant under scale, translation and reflection", () => {
    const example = examples[1];
    const points = smoothNeck(example.points);
    const base = harmonizeBulb({
      points,
      wall: example.wall,
      nextCurvature: bulbEndCurvature(example.next),
      radius: 80,
    });
    const transform = (p) => ({ ...p, x: 100 - 2 * p.x, y: -200 + 2 * p.y });
    const next = example.next.map(transform);
    const result = harmonizeBulb({
      points: points.map(transform),
      wall: example.wall.map(transform),
      nextCurvature: bulbEndCurvature(next),
      radius: 160,
    });
    verifyJoins(example.wall.map(transform), result.points, next);
    result.points.forEach((p, i) => {
      const expected = transform(base.points[i]);
      expect(p.x).to.be.closeTo(expected.x, 1e-5);
      expect(p.y).to.be.closeTo(expected.y, 1e-5);
    });
  });

  it("allows the C-N inflection and bounds optional point motion", () => {
    const example = examples[0];
    const points = smoothNeck(example.points);
    const result = harmonizeBulb({
      points,
      wall: example.wall,
      nextCurvature: bulbEndCurvature(example.next),
      radius: 80,
      movePoints: true,
    });
    verifyJoins(example.wall, result.points, example.next);
    const neck = new Bezier(result.points.slice(6, 10));
    expect(neck.curvature(0).k * neck.curvature(1).k).to.be.below(0);
    expect(result.points[3].y).to.equal(points[3].y);
    expect(result.points[6].x).to.equal(points[6].x);
    expect(Math.abs(result.points[3].x - points[3].x)).to.be.at.most(12);
    expect(Math.abs(result.points[6].y - points[6].y)).to.be.at.most(12);
  });
});
