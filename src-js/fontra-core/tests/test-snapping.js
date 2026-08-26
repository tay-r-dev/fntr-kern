import { expect } from "chai";
import {
  KIND,
  MIN_CROSSING_ANGLE_DEG,
  crossLines,
  distanceToCandidate,
  makeLineCandidate,
  makePointCandidate,
  projectOntoLine,
} from "@fontra/core/snapping.js";

describe("snapping primitives", () => {
  it("builds a horizontal line candidate with a unit direction", () => {
    const c = makeLineCandidate({
      x: 100,
      y: 50,
      angle: 0,
      kind: KIND.METRIC,
      source: { x: 100, y: 50 },
    });
    expect(c.type).to.equal("line");
    expect(c.dx).to.be.closeTo(1, 1e-12);
    expect(c.dy).to.be.closeTo(0, 1e-12);
  });

  it("projects onto a horizontal line by dropping y", () => {
    const c = makeLineCandidate({
      x: 0,
      y: 50,
      angle: 0,
      kind: KIND.METRIC,
      source: { x: 0, y: 50 },
    });
    const p = projectOntoLine(c, { x: 33, y: 71 });
    expect(p.x).to.be.closeTo(33, 1e-12);
    expect(p.y).to.be.closeTo(50, 1e-12);
  });

  it("projects onto a 45 degree line exactly", () => {
    const c = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 45,
      kind: KIND.GUIDE_SLANTED,
      source: { x: 0, y: 0 },
    });
    const p = projectOntoLine(c, { x: 10, y: 0 });
    expect(p.x).to.be.closeTo(5, 1e-12);
    expect(p.y).to.be.closeTo(5, 1e-12);
  });

  it("measures the perpendicular distance to a line and the plain distance to a point", () => {
    const line = makeLineCandidate({
      x: 0,
      y: 50,
      angle: 0,
      kind: KIND.METRIC,
      source: { x: 0, y: 50 },
    });
    expect(distanceToCandidate(line, { x: 999, y: 58 })).to.be.closeTo(8, 1e-12);
    const point = makePointCandidate({
      x: 3,
      y: 4,
      kind: KIND.SMART_INTERSECTION_ORTHOGONAL,
      source: { x: 3, y: 4 },
    });
    expect(distanceToCandidate(point, { x: 0, y: 0 })).to.be.closeTo(5, 1e-12);
  });
});

describe("snapping crossings", () => {
  const horizontal = (y, kind = KIND.METRIC) =>
    makeLineCandidate({ x: 0, y, angle: 0, kind, source: { x: 0, y } });
  const vertical = (x, kind = KIND.SMART_ORTHOGONAL) =>
    makeLineCandidate({ x, y: 0, angle: 90, kind, source: { x, y: 0 } });

  it("crosses a horizontal and a vertical", () => {
    const c = crossLines(horizontal(50), vertical(30));
    expect(c.type).to.equal("point");
    expect(c.x).to.be.closeTo(30, 1e-9);
    expect(c.y).to.be.closeTo(50, 1e-9);
    expect(c.sources).to.have.length(2);
  });

  it("refuses two parallel lines", () => {
    expect(crossLines(horizontal(50), horizontal(80))).to.equal(null);
  });

  it("refuses a crossing shallower than the stated angle", () => {
    const shallow = makeLineCandidate({
      x: 0,
      y: 0,
      angle: MIN_CROSSING_ANGLE_DEG - 1,
      kind: KIND.SMART_SLANTED,
      source: { x: 0, y: 0 },
    });
    expect(crossLines(horizontal(0), shallow)).to.equal(null);
  });

  it("ranks a crossing of two orthogonal smart guides above one involving a slant", () => {
    const both = crossLines(horizontal(50, KIND.SMART_ORTHOGONAL), vertical(30));
    expect(both.kind).to.equal(KIND.SMART_INTERSECTION_ORTHOGONAL);
    const slanted = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 40,
      kind: KIND.SMART_SLANTED,
      source: { x: 0, y: 0 },
    });
    expect(crossLines(horizontal(50, KIND.SMART_ORTHOGONAL), slanted).kind).to.equal(
      KIND.SMART_INTERSECTION_SLANTED
    );
  });
});
