import { expect } from "chai";
import { slideBulbEntryForCurvature } from "../src/bulb-entry-slide.js";
import { bulbEndCurvature } from "../src/bulb-harmonization.js";
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
    expect(result.direction).to.equal("previous");
    expect(result.points.slice(3)).to.deep.equal(points.slice(3));
    expect(result.points.length).to.equal(13);
    const retainedWall = splitCubicAt(wall, result.parameter).first;
    expect(result.wall.map(({ x, y }) => ({ x, y }))).to.deep.equal(
      retainedWall.map(({ x, y }) => ({ x, y }))
    );
    expect(Math.abs(result.points[1].x - result.points[0].x)).to.be.greaterThan(0.01);
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
});
