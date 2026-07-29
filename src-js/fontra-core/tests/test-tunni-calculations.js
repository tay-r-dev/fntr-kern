import {
  areTensionsEqualized,
  calculateControlHandlePoint,
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoAxis,
  calculateCurvatureGizmoPoint,
  calculateSegmentTension,
  calculateTunniPoint,
  hasForwardTangentIntersection,
  shiftTensionsToMean,
} from "@fontra/core/tunni-calculations.js";
import { expect } from "chai";

describe("tunni-calculations: hasForwardTangentIntersection", () => {
  it("is true when the tangent rays meet ahead of both endpoints", () => {
    expect(
      hasForwardTangentIntersection([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 5 },
        { x: 10, y: 10 },
      ])
    ).to.be.true;
  });

  it("is false when the intersection lies behind an endpoint", () => {
    // Both handles run right; the rays meet far behind the second endpoint.
    // A plain distance cannot tell this apart from a forward reach, which is
    // how a segment reported a tension above 1 with nothing overshooting.
    expect(
      hasForwardTangentIntersection([
        { x: 0, y: 0 },
        { x: 60, y: 1 },
        { x: 40, y: 99 },
        { x: 100, y: 100 },
      ])
    ).to.be.false;
  });

  it("is false when the tangents are parallel and never meet", () => {
    expect(
      hasForwardTangentIntersection([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 90, y: 100 },
        { x: 100, y: 100 },
      ])
    ).to.be.false;
  });
});

describe("tunni-calculations: calculateSegmentTension", () => {
  it("returns 1.0 when both handles point at the corner (a=b=c=d)", () => {
    const t = calculateSegmentTension(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    );
    expect(t).to.be.closeTo(1.0, 1e-9);
  });

  it("returns 2/3 for an asymmetric handle (a=5,b=10,c=10,d=10)", () => {
    const t = calculateSegmentTension(
      { x: 5, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    );
    expect(t).to.be.closeTo(2 / 3, 1e-9);
  });

  it("returns 0 for a degenerate (zero-length) handle", () => {
    const t = calculateSegmentTension(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    );
    expect(t).to.equal(0);
  });
});

describe("tunni-calculations: geometry naming (D2/D3)", () => {
  const seg = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 200 },
    { x: 200, y: 200 },
  ];

  it("calculateControlHandlePoint is the midpoint of the two controls", () => {
    expect(calculateControlHandlePoint(seg)).deep.equals({ x: 50, y: 150 });
  });

  it("calculateTunniPoint is the tangent-ray intersection", () => {
    const p = calculateTunniPoint(seg);
    expect(p.x).to.be.closeTo(0, 1e-9);
    expect(p.y).to.be.closeTo(200, 1e-9);
  });
});

describe("tunni-calculations: areTensionsEqualized (option C)", () => {
  it("true when both handle tensions match", () => {
    expect(
      areTensionsEqualized([
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 200 },
        { x: 200, y: 200 },
      ])
    ).to.equal(true);
  });

  it("false when handle tensions differ", () => {
    expect(
      areTensionsEqualized([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 200 },
        { x: 200, y: 200 },
      ])
    ).to.equal(false);
  });
});

// The curvature gizmo for generated contours. Anchored on the CURVE, dragged
// along the ray toward the true Tunni point. Distinct from the basic editor's
// "tunni-point" control, which anchors on the midpoint of the two HANDLES and
// drags along a fixed 45-degree vector.
describe("tunni-calculations: curvature gizmo", () => {
  // deliberately asymmetric, so curve centre and handle midpoint differ
  const asymmetric = [
    { x: 0, y: 0 },
    { x: 20, y: 80 },
    { x: 160, y: 60 },
    { x: 200, y: 0 },
  ];
  const symmetric = [
    { x: 0, y: 0 },
    { x: 40, y: 80 },
    { x: 160, y: 80 },
    { x: 200, y: 0 },
  ];

  const tensions = (points) => {
    const tunni = calculateTunniPoint(points);
    const [p1, p2, p3, p4] = points;
    const reach = (from) => Math.hypot(tunni.x - from.x, tunni.y - from.y);
    return [
      Math.hypot(p2.x - p1.x, p2.y - p1.y) / reach(p1),
      Math.hypot(p3.x - p4.x, p3.y - p4.y) / reach(p4),
    ];
  };
  const directions = (points) => {
    const [p1, p2, p3, p4] = points;
    return [Math.atan2(p2.y - p1.y, p2.x - p1.x), Math.atan2(p3.y - p4.y, p3.x - p4.x)];
  };

  it("anchors on the curve at t = 0.5, not on the handle midpoint", () => {
    const anchor = calculateCurvatureGizmoPoint(asymmetric);
    const [p1, p2, p3, p4] = asymmetric;
    expect(anchor.x).to.be.closeTo((p1.x + 3 * p2.x + 3 * p3.x + p4.x) / 8, 1e-9);
    expect(anchor.y).to.be.closeTo((p1.y + 3 * p2.y + 3 * p3.y + p4.y) / 8, 1e-9);

    const handleMidpoint = calculateControlHandlePoint(asymmetric);
    expect(
      Math.hypot(anchor.x - handleMidpoint.x, anchor.y - handleMidpoint.y)
    ).to.be.above(1);
  });

  it("takes its axis from the anchor toward the true Tunni point", () => {
    const anchor = calculateCurvatureGizmoPoint(asymmetric);
    const tunni = calculateTunniPoint(asymmetric);
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const expected = { x: tunni.x - anchor.x, y: tunni.y - anchor.y };
    const length = Math.hypot(expected.x, expected.y);
    expect(Math.hypot(axis.x, axis.y)).to.be.closeTo(1, 1e-9);
    expect(axis.x).to.be.closeTo(expected.x / length, 1e-9);
    expect(axis.y).to.be.closeTo(expected.y / length, 1e-9);
  });

  it("has no axis when the handles are parallel and no Tunni point exists", () => {
    const parallel = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(calculateCurvatureGizmoAxis(parallel)).to.equal(null);
    expect(
      calculateControlPointsFromCurvatureDelta({ x: 10, y: 10 }, parallel)
    ).to.equal(null);
  });

  it("fills the curve out when dragged toward the Tunni point", () => {
    const axis = calculateCurvatureGizmoAxis(symmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 10, y: axis.y * 10 },
      symmetric
    );
    const [beforeStart, beforeEnd] = tensions(symmetric);
    const [afterStart, afterEnd] = tensions([symmetric[0], ...moved, symmetric[3]]);
    expect(afterStart).to.be.above(beforeStart);
    expect(afterEnd).to.be.above(beforeEnd);
  });

  it("flattens the curve when dragged away from the Tunni point", () => {
    const axis = calculateCurvatureGizmoAxis(symmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: -axis.x * 10, y: -axis.y * 10 },
      symmetric
    );
    const [beforeStart, beforeEnd] = tensions(symmetric);
    const [afterStart, afterEnd] = tensions([symmetric[0], ...moved, symmetric[3]]);
    expect(afterStart).to.be.below(beforeStart);
    expect(afterEnd).to.be.below(beforeEnd);
  });

  it("moves both tensions together, preserving their difference", () => {
    const [beforeStart, beforeEnd] = tensions(asymmetric);
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 8, y: axis.y * 8 },
      asymmetric
    );
    const [afterStart, afterEnd] = tensions([asymmetric[0], ...moved, asymmetric[3]]);
    expect(afterStart - beforeStart).to.be.closeTo(afterEnd - beforeEnd, 1e-6);
    expect(afterStart).to.be.above(beforeStart);
  });

  it("never changes a handle direction", () => {
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    for (const amount of [-30, -5, 5, 30]) {
      const moved = calculateControlPointsFromCurvatureDelta(
        { x: axis.x * amount, y: axis.y * amount },
        asymmetric
      );
      const [beforeStart, beforeEnd] = directions(asymmetric);
      const [afterStart, afterEnd] = directions([
        asymmetric[0],
        ...moved,
        asymmetric[3],
      ]);
      expect(afterStart).to.be.closeTo(beforeStart, 1e-9);
      expect(afterEnd).to.be.closeTo(beforeEnd, 1e-9);
    }
  });

  it("ignores movement across the axis", () => {
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const across = { x: -axis.y * 25, y: axis.x * 25 };
    const moved = calculateControlPointsFromCurvatureDelta(across, asymmetric);
    expect(moved[0].x).to.be.closeTo(asymmetric[1].x, 1e-9);
    expect(moved[0].y).to.be.closeTo(asymmetric[1].y, 1e-9);
    expect(moved[1].x).to.be.closeTo(asymmetric[2].x, 1e-9);
    expect(moved[1].y).to.be.closeTo(asymmetric[2].y, 1e-9);
  });

  it("stops at tension 1 however far it is pushed", () => {
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 5000, y: axis.y * 5000 },
      asymmetric
    );
    const [afterStart, afterEnd] = tensions([asymmetric[0], ...moved, asymmetric[3]]);
    expect(afterStart).to.be.at.most(1 + 1e-9);
    expect(afterEnd).to.be.at.most(1 + 1e-9);
    expect(Math.max(afterStart, afterEnd)).to.be.closeTo(1, 1e-6);
  });

  it("keeps moving the trailing handle until both tensions reach 1", () => {
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 5000, y: axis.y * 5000 },
      asymmetric
    );
    const [afterStart, afterEnd] = tensions([asymmetric[0], ...moved, asymmetric[3]]);
    expect(afterStart).to.be.closeTo(1, 1e-6);
    expect(afterEnd).to.be.closeTo(1, 1e-6);
  });

  it("reproduces an independently saturated tension pair from its mean", () => {
    const shifted = shiftTensionsToMean({ start: 0.2, end: 0.5 }, 1, 1);
    expect(shifted.start).to.be.closeTo(1, 1e-9);
    expect(shifted.end).to.be.closeTo(1, 1e-9);
  });

  it("does not pull an existing over-ceiling handle back on grab", () => {
    const overCeiling = [
      { x: 0, y: 0 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
      { x: 200, y: 0 },
    ];
    const moved = calculateControlPointsFromCurvatureDelta({ x: 0, y: 0 }, overCeiling);
    expect(moved).to.deep.equal(overCeiling.slice(1, 3));
  });
});

describe("tunni-calculations: curvature gizmo reach sign", () => {
  // Handles splaying outward: the tangent rays meet BEHIND both on-curve
  // points. The distance to that intersection is large and positive, but the
  // reach along each handle axis is negative — there is no tension ceiling to
  // enforce, exactly as offset-cubic treats it.
  const splayed = [
    { x: 0, y: 0 },
    { x: -40, y: 25 },
    { x: 240, y: 25 },
    { x: 200, y: 0 },
  ];

  it("does not invent a ceiling where the intersection is behind the ends", () => {
    const axis = calculateCurvatureGizmoAxis(splayed);
    const far = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 400, y: axis.y * 400 },
      splayed
    );
    const near = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 40, y: axis.y * 40 },
      splayed
    );
    const moved = (m) => Math.hypot(m[0].x - splayed[1].x, m[0].y - splayed[1].y);
    // With no meaningful ceiling the control keeps responding rather than
    // stopping at a tension computed from an unsigned distance.
    expect(moved(far)).to.be.above(moved(near) * 5);
  });

  it("still enforces the ceiling when the intersection is genuinely ahead", () => {
    const ahead = [
      { x: 0, y: 0 },
      { x: 30, y: 60 },
      { x: 170, y: 60 },
      { x: 200, y: 0 },
    ];
    const axis = calculateCurvatureGizmoAxis(ahead);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: axis.x * 5000, y: axis.y * 5000 },
      ahead
    );
    const tunni = calculateTunniPoint([ahead[0], ...moved, ahead[3]]);
    const tension =
      Math.hypot(moved[0].x - ahead[0].x, moved[0].y - ahead[0].y) /
      Math.hypot(tunni.x - ahead[0].x, tunni.y - ahead[0].y);
    expect(tension).to.be.at.most(1 + 1e-9);
  });
});
