import {
  areTensionsEqualized,
  balanceSegment,
  calculateControlHandlePoint,
  calculateControlPointsFromCurvatureDelta,
  calculateCurvatureGizmoAxis,
  calculateCurvatureGizmoPoint,
  calculateHarmonicHandleDrag,
  calculateSegmentTension,
  harmonicDragLead,
  calculateTunniPoint,
  hasForwardTangentIntersection,
  shiftTensionsToMean,
} from "@fontra/core/tunni-calculations.js";
import { distance } from "@fontra/core/vector.js";
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

  const chordDistance = (points, point) => {
    const [p1, , , p4] = points;
    const chord = { x: p4.x - p1.x, y: p4.y - p1.y };
    return (
      Math.abs(chord.x * (point.y - p1.y) - chord.y * (point.x - p1.x)) /
      Math.hypot(chord.x, chord.y)
    );
  };
  const curveAt = (points, t) => {
    const [p1, p2, p3, p4] = points;
    const s = 1 - t;
    const at = (key) =>
      s * s * s * p1[key] +
      3 * s * s * t * p2[key] +
      3 * s * t * t * p3[key] +
      t ** 3 * p4[key];
    return { x: at("x"), y: at("y") };
  };

  it("anchors on the curve where it stands furthest from its chord", () => {
    const anchor = calculateCurvatureGizmoPoint(asymmetric);
    const reach = chordDistance(asymmetric, anchor);
    for (let t = 0; t <= 1; t += 0.001) {
      expect(chordDistance(asymmetric, curveAt(asymmetric, t))).to.be.at.most(
        reach + 1e-9
      );
    }
    const handleMidpoint = calculateControlHandlePoint(asymmetric);
    expect(
      Math.hypot(anchor.x - handleMidpoint.x, anchor.y - handleMidpoint.y)
    ).to.be.above(1);
  });

  it("anchors a symmetric curve at its middle", () => {
    const anchor = calculateCurvatureGizmoPoint(symmetric);
    expect(anchor.x).to.be.closeTo(100, 1e-9);
    expect(anchor.y).to.be.closeTo(60, 1e-9);
  });

  it("anchors an S curve on its larger bump", () => {
    const sCurve = [
      { x: 0, y: 0 },
      { x: 30, y: 120 },
      { x: 170, y: -40 },
      { x: 200, y: 0 },
    ];
    const anchor = calculateCurvatureGizmoPoint(sCurve);
    expect(anchor.y).to.be.above(0);
  });

  it("slides toward the middle on a near-flat or balanced curve, without a jump", () => {
    const balanced = [
      { x: 0, y: 0 },
      { x: 70, y: 40 },
      { x: 130, y: -40 },
      { x: 200, y: 0 },
    ];
    const anchor = calculateCurvatureGizmoPoint(balanced);
    expect(anchor.x).to.be.closeTo(100, 1e-6);
    expect(anchor.y).to.be.closeTo(0, 1e-6);
    // Flattening a bulge moves the gizmo a little per step, never across the curve.
    let previous = null;
    for (let height = 40; height >= 0; height -= 0.25) {
      const point = calculateCurvatureGizmoPoint([
        { x: 0, y: 0 },
        { x: 30, y: height },
        { x: 170, y: height * 0.9 },
        { x: 200, y: 0 },
      ]);
      if (previous) {
        expect(Math.hypot(point.x - previous.x, point.y - previous.y)).to.be.below(2);
      }
      previous = point;
    }
  });

  it("anchors a straight or closed segment at t = 0.5", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(calculateCurvatureGizmoPoint(straight)).to.deep.equal({ x: 100, y: 0 });
    const loop = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
      { x: 0, y: 0 },
    ];
    expect(calculateCurvatureGizmoPoint(loop)).to.deep.equal(curveAt(loop, 0.5));
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

  // The mirror of the ceiling behaviour above. The shared shift bottoms out
  // when the shorter handle lands on its point; past that the gizmo keeps
  // taking the survivor down on its own, until both sit on their points.
  // Measured as plain handle lengths: once a handle sits on its point there is
  // no tangent intersection left to state a tension against.
  const handleLengths = (points, moved) => [
    Math.hypot(moved[0].x - points[0].x, moved[0].y - points[0].y),
    Math.hypot(moved[1].x - points[3].x, moved[1].y - points[3].y),
  ];

  it("keeps moving the surviving handle until both lengths reach 0", () => {
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: -axis.x * 5000, y: -axis.y * 5000 },
      asymmetric,
      { allowCollapse: true }
    );
    const [start, end] = handleLengths(asymmetric, moved);
    expect(start).to.be.closeTo(0, 1e-9);
    expect(end).to.be.closeTo(0, 1e-9);
  });

  it("stops the shared shift at the shorter handle without the option", () => {
    const axis = calculateCurvatureGizmoAxis(asymmetric);
    const moved = calculateControlPointsFromCurvatureDelta(
      { x: -axis.x * 5000, y: -axis.y * 5000 },
      asymmetric
    );
    const [start, end] = handleLengths(asymmetric, moved);
    expect(Math.min(start, end)).to.be.closeTo(0, 1e-9);
    expect(Math.max(start, end)).to.be.above(1);
  });

  // A pin of zero is the bottom of the shared shift, not "no pin". It has to
  // render, or the gizmo's last step down is thrown away on reload.
  it("puts the shorter handle on its point for a mean of zero", () => {
    const shifted = shiftTensionsToMean({ start: 0.5, end: 0.2 }, 0, 1);
    expect(shifted.end).to.be.closeTo(0, 1e-9);
    expect(shifted.start).to.be.closeTo(0.3, 1e-9);
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

describe("tunni-calculations: balanceSegment", () => {
  function tensions(points) {
    const [p0, p1, p2, p3] = points;
    const tunniPoint = calculateTunniPoint(points);
    return [
      distance(p0, p1) / distance(p0, tunniPoint),
      distance(p3, p2) / distance(p3, tunniPoint),
    ];
  }

  function pointOnCurve([p0, p1, p2, p3], t) {
    const s = 1 - t;
    return {
      x: s ** 3 * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t ** 3 * p3.x,
      y: s ** 3 * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t ** 3 * p3.y,
    };
  }

  // The worst the curve moves anywhere along its length.
  function deviation(before, after) {
    let worst = 0;
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      worst = Math.max(
        worst,
        distance(pointOnCurve(before, t), pointOnCurve(after, t))
      );
    }
    return worst;
  }

  // Both handles set to one fraction of the way to the Tunni point, which is
  // what every balanced segment looks like. This is the old rule: the plain
  // mean of the two tensions.
  function balancedByPlainMean(points) {
    const [p0, , , p3] = points;
    const tunniPoint = calculateTunniPoint(points);
    const [tensionStart, tensionEnd] = tensions(points);
    const mean = (tensionStart + tensionEnd) / 2;
    const along = (from) => ({
      x: from.x + mean * (tunniPoint.x - from.x),
      y: from.y + mean * (tunniPoint.y - from.y),
    });
    return [p0, along(p0), along(p3), p3];
  }

  // a lopsided quarter turn: one handle far out, the other short
  const lopsided = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 100, y: 30 },
    { x: 100, y: 100 },
  ];

  // one end reaches much further toward the Tunni point than the other
  const unevenReach = [
    { x: 0, y: 0 },
    { x: 10, y: 70 },
    { x: 60, y: 120 },
    { x: 180, y: 130 },
  ];

  it("puts both handles at one tension", () => {
    const [tensionStart, tensionEnd] = tensions(balanceSegment(lopsided));
    expect(Math.abs(tensionStart - tensionEnd)).to.be.lessThan(1e-9);
  });

  it("holds a segment that is already balanced exactly still", () => {
    const arc = [
      { x: 0, y: 100 },
      { x: 55.228, y: 100 },
      { x: 100, y: 55.228 },
      { x: 100, y: 0 },
    ];
    for (const [i, point] of balanceSegment(arc).entries()) {
      expect(distance(point, arc[i]), `point ${i}`).to.be.lessThan(1e-6);
    }
  });

  it("is the plain mean where the two ends reach equally far", () => {
    // both tangent rays are 100 units long here, so the weights match and the
    // answer is the average of 0.8 and 0.7
    const [tensionStart] = tensions(balanceSegment(lopsided));
    expect(tensionStart).to.be.closeTo(0.75, 1e-9);
  });

  it("moves the curve less than the plain mean does", () => {
    const balanced = deviation(unevenReach, balanceSegment(unevenReach));
    const plainMean = deviation(unevenReach, balancedByPlainMean(unevenReach));
    expect(balanced).to.be.lessThan(plainMean);
  });

  it("lands between the two tensions it balances", () => {
    for (const segment of [lopsided, unevenReach]) {
      const [before, after] = [tensions(segment), tensions(balanceSegment(segment))];
      expect(after[0]).to.be.at.least(Math.min(...before) - 1e-9);
      expect(after[0]).to.be.at.most(Math.max(...before) + 1e-9);
    }
  });

  it("leaves the two on-curve points where they are", () => {
    const balanced = balanceSegment(lopsided);
    expect(balanced[0]).to.deep.equal(lopsided[0]);
    expect(balanced[3]).to.deep.equal(lopsided[3]);
  });

  it("refuses a segment whose handles sit on opposite sides of the chord", () => {
    // an S-shaped segment: no one tension describes it, so balancing it fights
    // the drawing rather than tidying it
    const inflected = [
      { x: 0, y: 0 },
      { x: 60, y: 40 },
      { x: 40, y: -40 },
      { x: 100, y: 0 },
    ];
    expect(balanceSegment(inflected)).to.deep.equal(inflected);
  });

  it("refuses a segment whose handle lines are parallel", () => {
    const parallel = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 70, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(balanceSegment(parallel)).to.deep.equal(parallel);
  });

  it("gives the same answer whichever way round the segment runs", () => {
    const forward = balanceSegment(unevenReach);
    const backward = balanceSegment([...unevenReach].reverse());
    for (const [i, point] of forward.entries()) {
      expect(distance(point, backward[3 - i]), `point ${i}`).to.be.lessThan(1e-9);
    }
  });
});

describe("tunni-calculations: harmonic handle drag", () => {
  const segment = [
    { x: 0, y: 0 },
    { x: 20, y: 80 },
    { x: 160, y: 60 },
    { x: 200, y: 0 },
  ];

  // Signed curvature at one end, from the three control points nearest it.
  const endCurvature = (points, atEnd) => {
    const [a, b, c] = atEnd ? [points[3], points[2], points[1]] : points;
    const first = { x: b.x - a.x, y: b.y - a.y };
    const second = { x: c.x - b.x, y: c.y - b.y };
    return (
      ((2 / 3) * Math.abs(first.x * second.y - first.y * second.x)) /
      Math.hypot(first.x, first.y) ** 3
    );
  };
  const direction = (from, to) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  };

  it("leads with the handle the drag follows more closely", () => {
    const u = direction(segment[0], segment[1]);
    const v = direction(segment[3], segment[2]);
    expect(harmonicDragLead(segment, { x: u.x * 10, y: u.y * 10 })).to.equal(0);
    expect(harmonicDragLead(segment, { x: v.x * 10, y: v.y * 10 })).to.equal(1);
  });

  for (const lead of [0, 1]) {
    it(`keeps the curvature at the leading end (lead ${lead}) across a sweep`, () => {
      const anchor = lead === 0 ? 0 : 3;
      const handle = lead === 0 ? 1 : 2;
      const axis = direction(segment[anchor], segment[handle]);
      const before = endCurvature(segment, lead === 1);
      for (let step = -30; step <= 40; step += 0.5) {
        const delta = { x: axis.x * step, y: axis.y * step };
        const [c1, c2] = calculateHarmonicHandleDrag(segment, delta, lead);
        const moved = [segment[0], c1, c2, segment[3]];
        const lengths = [
          Math.hypot(c1.x - segment[0].x, c1.y - segment[0].y),
          Math.hypot(c2.x - segment[3].x, c2.y - segment[3].y),
        ];
        const original = Math.hypot(
          segment[handle].x - segment[anchor].x,
          segment[handle].y - segment[anchor].y
        );
        expect(lengths[lead]).to.be.closeTo(original + step, 1e-9);
        if (lengths[1 - lead] > 0) {
          expect(endCurvature(moved, lead === 1)).to.be.closeTo(before, 1e-9);
        }
      }
    });
  }

  it("keeps both handles on their own lines", () => {
    const [c1, c2] = calculateHarmonicHandleDrag(segment, { x: 7, y: 11 }, 0);
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    const u = direction(segment[0], segment[1]);
    const v = direction(segment[3], segment[2]);
    expect(cross(u, { x: c1.x - segment[0].x, y: c1.y - segment[0].y })).to.be.closeTo(
      0,
      1e-9
    );
    expect(cross(v, { x: c2.x - segment[3].x, y: c2.y - segment[3].y })).to.be.closeTo(
      0,
      1e-9
    );
  });

  it("declines parallel handles, where no length keeps the curvature", () => {
    const parallel = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 0 },
    ];
    expect(calculateHarmonicHandleDrag(parallel, { x: 0, y: 10 }, 0)).to.equal(null);
  });
});
