import {
  buildContourSegments,
  calculateContourNormalAtPoint,
  collectCoupledPointGroups,
  computeContourExpandOffsets,
  expandIndicesToCoupledGroups,
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

describe("base-curve expansion offsets", () => {
  // Point 1 is smooth with a single handle, so the straight 0-1 owns its
  // direction and both its ends must travel. Point 4 is free.
  const makeTensionContour = () => [
    onCurve(0, 0),
    onCurve(100, 0, true),
    control(150, 0),
    control(200, 50),
    onCurve(200, 100),
  ];

  it("carries a tension point's whole straight, not just the dragged end", () => {
    const points = makeTensionContour();
    expect([
      ...expandIndicesToCoupledGroups(points, false, new Set([0])),
    ]).to.have.members([0, 1]);
    expect([
      ...expandIndicesToCoupledGroups(points, false, new Set([1])),
    ]).to.have.members([0, 1]);
  });

  it("leaves a plain straight between two corners free to taper", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    expect([
      ...expandIndicesToCoupledGroups(points, false, new Set([0])),
    ]).to.have.members([0]);
  });

  it("chains coupling through a shared point", () => {
    // Two straights, 3-4 and 4-5. Point 3 is smooth with its only handle on the
    // curve behind it and point 5 is smooth with its only handle on the curve
    // ahead, so each straight carries a tension point and is coupled. They share
    // point 4, which has one position and cannot sit at two offsets, so the two
    // groups merge and all three on-curves travel as one. Point 0 is a free
    // corner behind a curve, and a curve is never coupled.
    const chained = [
      onCurve(0, 200),
      control(0, 130),
      control(0, 70),
      onCurve(0, 0, true),
      onCurve(100, 0),
      onCurve(200, 0, true),
      control(230, 40),
      control(250, 70),
      onCurve(250, 100),
    ];
    expect(
      [...expandIndicesToCoupledGroups(chained, false, new Set([3]))].sort()
    ).to.deep.equal([3, 4, 5]);
    expect([
      ...expandIndicesToCoupledGroups(chained, false, new Set([0])),
    ]).to.have.members([0]);
  });

  it("gives every affected point the drag projected on the clicked normal", () => {
    const points = makeTensionContour();
    // The clicked point's normal is (0, -1): straight 0-1 runs along +x. A drag
    // of (5, -20) projects to 20 units of outward travel.
    const offsets = computeContourExpandOffsets(points, false, new Set([0]), 0, {
      x: 5,
      y: -20,
    });
    expect([...offsets.keys()].sort()).to.deep.equal([0, 1]);
    expect(offsets.get(0)).to.be.closeTo(20, 1e-9);
    expect(offsets.get(1)).to.be.closeTo(20, 1e-9);
  });

  it("does not clamp an inward drag past the curvature radius", () => {
    // A quarter arc of radius 100 pushed 250 units inward. There is no width to
    // run out of on a base curve, so the drag simply follows the cursor and the
    // result cusps - ordinary outline geometry, reachable by hand and undoable.
    const points = makeArc();
    const offsets = computeContourExpandOffsets(points, false, new Set([0, 3]), 0, {
      x: -250,
      y: 0,
    });
    expect(offsets.get(0)).to.be.closeTo(-250, 1e-9);
    expect(offsets.get(3)).to.be.closeTo(-250, 1e-9);
  });
});

describe("corner travel", () => {
  // How far an edge actually moved, square to itself.
  const edgeTravel = (a, b, a2, b2) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / L;
    const ny = -(b.x - a.x) / L;
    return [
      (a2.x - a.x) * nx + (a2.y - a.y) * ny,
      (b2.x - b.x) * nx + (b2.y - b.y) * ny,
    ];
  };

  it("carries a corner far enough to keep both its edges at the offset", () => {
    // A right angle. Travelling the offset distance ALONG the miter moves each
    // edge by only its cosine — 14.1 of a requested 20 — while the far ends of
    // those edges move the full 20, so the edges tilt instead of offsetting.
    // The corner has to travel the miter length instead: 20 / cos(45°).
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const working = structuredClone(points);

    offsetContourAlongNormals(
      points,
      false,
      new Map([
        [0, 20],
        [1, 20],
        [2, 20],
      ]),
      working,
      { miterCorrectTravel: true }
    );

    for (const [i, j] of [
      [0, 1],
      [1, 2],
    ]) {
      const [startMoved, endMoved] = edgeTravel(
        points[i],
        points[j],
        working[i],
        working[j]
      );
      expect(startMoved).to.be.closeTo(20, 0.5);
      expect(endMoved).to.be.closeTo(20, 0.5);
    }
  });

  it("leaves a smooth point's travel alone", () => {
    // A smooth point's two directions agree, so its miter is its own tangent
    // normal and the correction is exactly 1. Turning it on must not move it.
    const points = makeArc();
    const plain = structuredClone(points);
    const corrected = structuredClone(points);
    const offsets = new Map([
      [0, 20],
      [3, 20],
    ]);

    offsetContourAlongNormals(points, false, offsets, plain);
    offsetContourAlongNormals(points, false, offsets, corrected, {
      miterCorrectTravel: true,
    });

    expect(corrected).to.deep.equal(plain);
  });

  it("bounds the travel at a cusp instead of emitting infinity", () => {
    // Two segments doubling back on each other have no miter: the correction
    // divides by the cosine of a right angle. The bound is what stops the point
    // leaving the glyph, and it is the only limit in this drag.
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(0.0001, 0)];
    const working = structuredClone(points);

    offsetContourAlongNormals(points, false, new Map([[1, 20]]), working, {
      miterCorrectTravel: true,
    });

    expect(Number.isFinite(working[1].x)).to.equal(true);
    expect(Number.isFinite(working[1].y)).to.equal(true);
    expect(Math.hypot(working[1].x - 100, working[1].y)).to.be.at.most(20 * 4);
  });
});
