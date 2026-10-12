import { expect } from "chai";
import { slideBulbEntryForCurvature } from "../src/bulb-entry-slide.js";
import { bulbEndCurvature } from "../src/bulb-harmonization.js";
import { buildBulb } from "../src/bulb-geometry.js";
import { splitCubicAt } from "../src/offset-contour.js";

describe("bulb entry V-slide fallback", () => {
  it("matches the entry joins without moving the remaining bulb controls", () => {
    const wall = [
      { x: 244, y: 471, smooth: true },
      { x: 369, y: 471, type: "cubic" },
      { x: 451, y: 417, type: "cubic" },
      { x: 451, y: 292, smooth: true },
    ];
    const points = [
      { x: 451, y: 292, smooth: true },
      { x: 451, y: 248.8650495258047, type: "cubic" },
      { x: 423.07919459759415, y: 224.66, type: "cubic" },
      { x: 388.81467594826023, y: 224.66, smooth: true },
      { x: 344.93202749287747, y: 224.66, type: "cubic" },
      { x: 316.31999999999994, y: 254.39985681560856, type: "cubic" },
      { x: 316.31999999999994, y: 291.6585977098151, smooth: true },
      { x: 316.31999999999994, y: 324.7909780567659, type: "cubic" },
      { x: 338.80473050620003, y: 351.8073211008684, type: "cubic" },
      { x: 370.6632499921291, y: 358.0738986986075 },
      { x: 355.35725965189533, y: 411.79235663117277, type: "cubic" },
      { x: 309.1388476876018, y: 434, type: "cubic" },
      { x: 238, y: 434, smooth: true },
    ];
    const result = slideBulbEntryForCurvature({ wall, points, radius: 67.34 });
    expect(result).not.to.equal(null);
    // The fit holds at the extreme. Whole units are a refining pass, not a
    // condition, so E does not slide; the wall piece it keeps is exact.
    expect(result.direction).to.equal("stationary");
    expect(result.points.slice(3)).to.deep.equal(points.slice(3));
    expect(result.points.length).to.equal(13);
    const retainedWall = splitCubicAt(wall, result.parameter).first;
    expect(result.wall.map(({ x, y }) => ({ x, y }))).to.deep.equal(
      retainedWall.map(({ x, y }) => ({ x, y }))
    );
    expect(bulbEndCurvature(result.wall, true)).to.be.closeTo(
      bulbEndCurvature(result.points.slice(0, 4)),
      1e-8
    );
    expect(bulbEndCurvature(result.points.slice(0, 4), true)).to.be.closeTo(
      bulbEndCurvature(points.slice(3, 7)),
      1e-8
    );
    expect(result.departure).to.be.below(1.35);
  });
  it("keeps E at the extreme and reports the jump when no position fits both shapes", () => {
    const wall = [
      [304, 498],
      [475, 498],
      [536, 427],
      [585, 284],
    ].map(([x, y], i) => ({ x, y, ...(i === 1 || i === 2 ? { type: "cubic" } : {}) }));
    const inner = [
      [474, 246],
      [440, 392],
      [417, 435],
      [304, 435],
    ].map(([x, y], i) => ({ x, y, ...(i === 1 || i === 2 ? { type: "cubic" } : {}) }));
    const r = buildBulb({
      wall,
      inner,
      radius: 94.77,
      shape: 0,
      easing: 0.59,
    });
    // No position between the extreme and the wall's centre meets the jump
    // while keeping the wall exact and the ball within tolerance. The shapes
    // win: nothing slides, the ball stays exact, and the jump is reported.
    // The wall has no extreme, so E stays at its end: on the wall, never on
    // the ball.
    expect(r.entrySlide).to.equal(null);
    expect(r.points[0].x).to.be.closeTo(585, 1e-8);
    expect(r.points[0].y).to.be.closeTo(284, 1e-8);
    r.wall.forEach((p, i) => {
      expect(p.x).to.be.closeTo(wall[i].x, 1e-8);
      expect(p.y).to.be.closeTo(wall[i].y, 1e-8);
    });
    expect(r.error).to.be.greaterThan(0);
  });
});
