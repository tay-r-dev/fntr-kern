import { expect } from "chai";
import { buildFourPointBulb } from "../src/bulb-geometry.js";
import { bulbNeckDeparture } from "../src/bulb-neck-fit.js";

const cubic = (coordinates) =>
  coordinates.map(([x, y], i) => ({
    x,
    y,
    ...(i === 1 || i === 2 ? { type: "cubic" } : {}),
  }));
const options = {
  wall: cubic([
    [254, 498],
    [373, 498],
    [498, 447],
    [441, 187],
  ]),
  inner: cubic([
    [327, 212],
    [386, 415],
    [322, 435],
    [248, 435],
  ]),
  radius: 99.45,
  shape: 0,
  easing: 0.32,
  easeCurvature: 0.45,
  edits: { bottom: { slide: -4, in: 17 }, neck: { slide: -3, normal: 24, out: -4 } },
};
const xy = (points) => points.map(({ x, y }) => ({ x, y }));

describe("bulb neck fitted against its preview", () => {
  it("keeps the supplied C-N-Q outline within two units of the preview", () => {
    const preview = buildFourPointBulb({ ...options, preview: true });
    const result = buildFourPointBulb(options);
    expect(result.points.length).to.equal(13);
    expect(
      bulbNeckDeparture(result.points.slice(6), preview.points.slice(6))
    ).to.be.lessThan(2);
    expect(xy(result.referencePoints)).to.deep.equal(xy(preview.points));
    expect(result.points[12]).to.include(options.inner[3]);
    const p = result.points;
    const incoming = { x: p[9].x - p[8].x, y: p[9].y - p[8].y };
    const outgoing = { x: p[10].x - p[9].x, y: p[10].y - p[9].y };
    expect(incoming.x * outgoing.y - incoming.y * outgoing.x).to.be.closeTo(0, 1e-7);
    expect(incoming.x * outgoing.x + incoming.y * outgoing.y).to.be.greaterThan(0);
    const reference = JSON.stringify(result.referencePoints);
    p[9].x += 100;
    p[7].y += 100;
    expect(JSON.stringify(result.referencePoints)).to.equal(reference);
  });

  it("retains the body, fixed wall endpoint and zero-easing corner", () => {
    let body;
    for (const easing of [0, 0.01, 0.41, 0.8, 1]) {
      const result = buildFourPointBulb({ ...options, easing });
      expect(
        result.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
      ).to.equal(true);
      expect(result.points.length).to.equal(13);
      expect(result.points[9].smooth).to.equal(easing !== 0);
      expect(result.points[12]).to.include(options.inner[3]);
      if (body) expect(xy(result.points.slice(3, 7))).to.deep.equal(body);
      body = xy(result.points.slice(3, 7));
    }
  });
});
