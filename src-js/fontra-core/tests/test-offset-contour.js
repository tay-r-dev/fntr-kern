import {
  buildContourSegments,
  calculateContourNormalAtPoint,
  collectCoupledPointGroups,
  offsetContourAlongNormals,
} from "@fontra/core/offset-contour.js";
import { expect } from "chai";

// Plain contour points, exactly as they come out of VarPackedPath's unpacked
// form: on-curves have no `type`, off-curves carry `type: "cubic"`. Nothing here
// has a width, an id, or any other skeleton field — that is the whole point.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });

describe("offset-contour geometry", () => {
  it("takes the normal at a corner from the miter bisector", () => {
    // A right angle at (100, 0): incoming direction +x, outgoing +y. The
    // bisector points up-right, so its CW normal is down-right, normalized.
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const normal = calculateContourNormalAtPoint(points, false, 1);
    expect(normal.x).to.be.closeTo(Math.SQRT1_2, 1e-9);
    expect(normal.y).to.be.closeTo(-Math.SQRT1_2, 1e-9);
  });

  it("takes the normal at a one-handled smooth point from its straight", () => {
    // Point 1 is smooth and has a handle only on the curve side, so it owns no
    // direction: the straight 0-1 sets it, and the normal is perpendicular to
    // that straight rather than to a miter average.
    const points = [
      onCurve(0, 0),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    const normal = calculateContourNormalAtPoint(points, false, 1);
    expect(normal.x).to.be.closeTo(0, 1e-9);
    expect(normal.y).to.be.closeTo(-1, 1e-9);
  });

  it("couples the two ends of a straight carrying a one-handled smooth point", () => {
    const points = [
      onCurve(0, 0),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    const groups = collectCoupledPointGroups(
      buildContourSegments(points, false),
      false
    );
    expect(groups.get(points[0])).to.have.members([points[0], points[1]]);
    expect(groups.get(points[1])).to.have.members([points[0], points[1]]);
    expect(groups.get(points[4])).to.equal(undefined);
  });

  it("leaves a plain straight between two corners uncoupled", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const groups = collectCoupledPointGroups(
      buildContourSegments(points, false),
      false
    );
    expect(groups.size).to.equal(0);
  });
});

// A quarter-circle cubic of radius 100 about the origin, in the same form the
// skeleton fixtures use. kappa = 0.5522847498 is the standard circular constant.
const K = 0.5522847498307936;
const makeArc = () => [
  onCurve(100, 0),
  control(100, 100 * K),
  control(100 * K, 100),
  onCurve(0, 100),
];

const midRadius = (points) => {
  // The cubic's own midpoint, by de Casteljau at t = 0.5: (p0 + 3p1 + 3p2 + p3)/8.
  const [p0, p1, p2, p3] = points;
  const x = (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8;
  const y = (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8;
  return Math.hypot(x, y);
};

describe("offsetContourAlongNormals", () => {
  it("offsets a curved segment instead of shearing its handles", () => {
    const points = makeArc();
    const working = structuredClone(points);
    const radiusBefore = midRadius(points);

    const changed = offsetContourAlongNormals(
      points,
      false,
      new Map([
        [0, 20],
        [3, 20],
      ]),
      working
    );

    expect(changed).to.equal(true);
    expect(working[0]).to.include({ x: 120, y: 0 });
    expect(working[3]).to.include({ x: 0, y: 120 });
    // The middle of the arc has to travel the same 20 units as its ends.
    // Displacing the handles by an interpolation of the two endpoint deltas
    // leaves it about 6 units short, because that can never lengthen a handle.
    expect(midRadius(working) - radiusBefore).to.be.closeTo(20, 0.6);
  });

  it("tapers a segment when only one of its ends is offset", () => {
    const points = makeArc();
    const working = structuredClone(points);

    offsetContourAlongNormals(points, false, new Map([[0, 20]]), working);

    expect(working[0]).to.include({ x: 120, y: 0 });
    expect(working[3]).to.include({ x: 0, y: 100 });
  });

  it("offsets a straight segment into a parallel straight", () => {
    const points = [onCurve(0, 0), onCurve(100, 0)];
    const working = structuredClone(points);

    offsetContourAlongNormals(
      points,
      false,
      new Map([
        [0, 10],
        [1, 10],
      ]),
      working
    );

    expect(working[0]).to.include({ x: 0, y: -10 });
    expect(working[1]).to.include({ x: 100, y: -10 });
  });

  it("uses a caller-supplied normal when one is given", () => {
    const points = [onCurve(0, 0), onCurve(100, 0)];
    const working = structuredClone(points);

    offsetContourAlongNormals(points, false, new Map([[0, 10]]), working, {
      normalAt: () => ({ x: 1, y: 0 }),
    });

    expect(working[0]).to.include({ x: 10, y: 0 });
  });
});
