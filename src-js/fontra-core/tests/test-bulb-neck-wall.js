import { expect } from "chai";
import { buildFourPointBulb } from "../src/bulb-geometry.js";
import { bulbEndCurvature } from "../src/bulb-harmonization.js";
import { splitCubicAt } from "../src/offset-contour.js";

const wall = [
  { x: 241, y: 471 },
  { x: 369, y: 471, type: "cubic" },
  { x: 449, y: 361, type: "cubic" },
  { x: 427, y: 255 },
];
const inner = [
  { x: 355, y: 270 },
  { x: 378, y: 362, type: "cubic" },
  { x: 326, y: 434, type: "cubic" },
  { x: 235, y: 434 },
];
const xy = (points) => points.map(({ x, y }) => ({ x, y }));

describe("single bulb neck on the generated inner wall", () => {
  it("preserves the wall and body while N travels beyond one bulb radius", () => {
    for (const edits of [
      null,
      { bottom: { slide: -4, in: 17 }, neck: { normal: 16, slide: -19, out: -4 } },
    ]) {
      let body, firstNeck, lastNeck;
      for (const easing of [0, 0.01, 0.41, 0.8, 1]) {
        const result = buildFourPointBulb({
          wall,
          inner,
          radius: 62.9,
          shape: 0,
          easing,
          easeCurvature: 0.82,
          edits,
        });
        const p = result.points;
        expect(p.length).to.equal(13);
        expect(xy(p.slice(9))).to.deep.equal(
          xy(splitCubicAt(inner, result.cutParameter).second)
        );
        expect(p[12]).to.include(inner[3]);
        if (body) expect(xy(p.slice(3, 7))).to.deep.equal(body);
        body = xy(p.slice(3, 7));
        firstNeck ??= p[9];
        lastNeck = p[9];
        if (easing) {
          expect(p[9].smooth).to.equal(true);
          expect(bulbEndCurvature(p.slice(6, 10), true)).to.be.closeTo(
            bulbEndCurvature(p.slice(9)),
            1e-7
          );
          expect(bulbEndCurvature(p.slice(3, 7), true)).to.be.closeTo(
            bulbEndCurvature(p.slice(6, 10)),
            1e-7
          );
        } else expect(p[9].smooth).to.equal(false);
        expect(result.entrySlide?.direction).to.equal("previous");
      }
      expect(
        Math.hypot(lastNeck.x - firstNeck.x, lastNeck.y - firstNeck.y)
      ).to.be.greaterThan(100);
    }
  });
});
