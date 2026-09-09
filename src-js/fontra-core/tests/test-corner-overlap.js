import { expect } from "chai";
import { addOverlap } from "@fontra/core/corner-overlap.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { Bezier } from "bezier-js";

const arcLength = ([p1, p2, p3, p4]) =>
  new Bezier(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y).length();

// A cubic quarter-arc into a sharp corner, then a straight line out of it.
function cornerPath() {
  const path = new VarPackedPath();
  path.appendUnpackedContour({
    isClosed: true,
    points: [
      { x: 0, y: 100 },
      { x: 55, y: 100, type: "cubic" },
      { x: 100, y: 55, type: "cubic" },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ],
  });
  return path;
}

// Curvature of a cubic at t, up to the positive factor common to both curves.
function curvatureAt(points, t) {
  const [p1, p2, p3, p4] = points;
  const d1 = (a, b) => ({ x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) });
  const at = (pts, u) => {
    const [a, b, c] = pts;
    return {
      x: a.x * (1 - u) ** 2 + 2 * b.x * (1 - u) * u + c.x * u ** 2,
      y: a.y * (1 - u) ** 2 + 2 * b.y * (1 - u) * u + c.y * u ** 2,
    };
  };
  const first = [d1(p1, p2), d1(p2, p3), d1(p3, p4)];
  const second = [
    { x: 2 * (first[1].x - first[0].x), y: 2 * (first[1].y - first[0].y) },
    { x: 2 * (first[2].x - first[1].x), y: 2 * (first[2].y - first[1].y) },
  ];
  const v = at(first, t);
  const a = {
    x: second[0].x * (1 - t) + second[1].x * t,
    y: second[0].y * (1 - t) + second[1].y * t,
  };
  return (v.x * a.y - v.y * a.x) / Math.hypot(v.x, v.y) ** 3;
}

describe("corner overlap", () => {
  it("splits the selected corner into two points", () => {
    const before = cornerPath();
    const after = addOverlap(before, [3]);
    expect(after.numPoints).to.equal(before.numPoints + 1);
    expect(before.numPoints).to.equal(5); // the source path is untouched
  });

  it("extends the curved side along its own curvature, not along the chord", () => {
    const before = cornerPath();
    const curveBefore = [0, 1, 2, 3].map((i) => before.getPoint(i));
    const after = addOverlap(before, [3]);
    const curveAfter = [0, 1, 2, 3].map((i) => after.getPoint(i));

    // The handles moved: a chord-only extension would leave them alone.
    expect(curveAfter[1]).to.not.deep.equal(curveBefore[1]);
    expect(curveAfter[2]).to.not.deep.equal(curveBefore[2]);

    // Same curve, longer domain: the curvature the old corner sat at is the
    // curvature the extended curve still has there.
    const oldEnd = curvatureAt(curveBefore, 1);
    const sampled = [0.6, 0.7, 0.8, 0.9].map((t) => curvatureAt(curveAfter, t));
    expect(Math.min(...sampled)).to.be.below(oldEnd);
    expect(Math.max(...sampled)).to.be.above(oldEnd);

    // And the corner really did move outward, past where it was.
    expect(curveAfter[3].y).to.be.below(curveBefore[3].y);
  });

  it("extends the straight side along its own direction", () => {
    const after = addOverlap(cornerPath(), [3]);
    // The line out of the corner used to start at (100, 0) heading to (0, 0).
    // It now starts before that, still on the same line.
    const lineStart = after.getPoint(4);
    expect(lineStart.y).to.equal(0);
    expect(lineStart.x).to.equal(130);
  });

  it("runs exactly the overlap distance past the corner", () => {
    // The n's upper right terminal: a short arc arriving at a corner fast.
    // Stepping the curve's parameter by the distance over its length overshoots
    // here, and an extrapolated cubic bends harder the further out it goes, so
    // the overshoot showed up as the corner curling away.
    const path = new VarPackedPath();
    path.appendUnpackedContour({
      isClosed: true,
      points: [
        { x: 186, y: 526 },
        { x: 153, y: 526, type: "cubic" },
        { x: 129, y: 510, type: "cubic" },
        { x: 114, y: 478 },
        { x: 113, y: 478 },
        { x: 107, y: 520 },
      ],
    });
    const before = [0, 1, 2, 3].map((i) => path.getPoint(i));
    const after = addOverlap(path, [3]);
    const extended = [0, 1, 2, 3].map((i) => after.getPoint(i));
    const added = arcLength(extended) - arcLength(before);
    expect(added).to.be.closeTo(30, 0.05);
    // The straight side runs the same distance the other way.
    expect(after.getPoint(4).x).to.be.closeTo(144, 1e-6);
  });

  it("leaves an unselected corner alone", () => {
    const before = cornerPath();
    const after = addOverlap(before, []);
    expect(after.numPoints).to.equal(before.numPoints);
  });
});
