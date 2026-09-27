import { fitSerifEasing } from "@fontra/core/serif-easing-fit.js";
import { splitCubicAt } from "@fontra/core/offset-contour.js";
import { expect } from "chai";

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a, b) => a.x * b.y - a.y * b.x;
const curvature = ([p, q, r]) => {
  const d = sub(q, p);
  return ((2 / 3) * cross(d, sub(r, q))) / Math.hypot(d.x, d.y) ** 3;
};
const source = (dx = 0) => [
  { x: 0, y: 0 },
  { x: 0, y: 60 },
  { x: 80 + dx, y: 100 },
  { x: 140 + dx, y: 100 },
];
const pieces = (curve) => {
  const { first, second } = splitCubicAt(curve, 0.6);
  return [first, second];
};
const fit = (curve, preceding) =>
  fitSerifEasing(
    pieces(curve),
    sub(curve[1], curve[0]),
    sub(curve[2], curve[3]),
    preceding
  );

describe("bounded serif easing fit", () => {
  it("preserves endpoints and tangent directions when replacing two pieces", () => {
    const curve = source(),
      result = fit(curve);
    expect(result).not.to.equal(null);
    expect(result[0]).to.deep.equal(curve[0]);
    expect(result[3]).to.deep.equal(curve[3]);
    expect(cross(sub(result[1], result[0]), sub(curve[1], curve[0]))).to.equal(0);
    expect(cross(sub(result[2], result[3]), sub(curve[2], curve[3]))).to.equal(0);
  });

  it("changes handles continuously under a small drag", () => {
    let previous;
    for (let i = -100; i <= 100; i++) {
      const result = fit(source(i / 100));
      expect(result).not.to.equal(null);
      if (previous)
        for (const j of [1, 2]) {
          expect(
            Math.hypot(result[j].x - previous[j].x, result[j].y - previous[j].y)
          ).to.be.below(0.05);
        }
      previous = result;
    }
  });

  it("matches incoming curvature with a bounded change", () => {
    const curve = source();
    const preceding = [
      { x: 140, y: -100 },
      { x: 80, y: -60 },
      { x: 0, y: -60 },
      curve[0],
    ];
    const result = fit(curve, preceding);
    expect(result).not.to.equal(null);
    const incoming = -curvature([...preceding].reverse());
    expect(Math.abs(curvature(result) - incoming)).to.be.below(1e-9);
  });

  it("declines an incompatible incoming tangent instead of rotating it", () => {
    const curve = source();
    expect(
      fit(curve, [{ x: -100, y: 0 }, { x: -80, y: 0 }, { x: -20, y: 0 }, curve[0]])
    ).to.equal(null);
  });
});
