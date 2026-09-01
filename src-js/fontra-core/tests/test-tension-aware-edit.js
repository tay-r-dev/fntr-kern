import {
  buildIndexedSegments,
  recollinearizeStraightHandles,
  restoreSegmentTensions,
  segmentTensions,
} from "@fontra/core/tension-aware-edit.js";
import { expect } from "chai";

// Unpacked VarPackedPath points: on-curves carry no `type`, off-curves carry
// `type: "cubic"`.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });
const copy = (points) => points.map((point) => ({ ...point }));

// A quarter circle: up from (0, -100) with a vertical tangent, round to
// (100, 0) with a horizontal tangent. The two tangents cross at the origin, and
// both handles reach 0.5523 of the way to it.
const quarter = () => [
  onCurve(0, -100),
  control(0, -44.77),
  control(44.77, 0),
  onCurve(100, 0),
];

describe("tension-aware edit — segments and tensions", () => {
  it("walks an open contour into one segment per on-curve pair", () => {
    const segments = buildIndexedSegments(quarter(), false);
    expect(segments.length).to.equal(1);
    expect(segments[0]).to.deep.equal({
      startIndex: 0,
      endIndex: 3,
      controlIndices: [1, 2],
    });
  });

  it("closes the loop on a closed contour", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const segments = buildIndexedSegments(points, true);
    expect(segments.length).to.equal(3);
    expect(segments[2]).to.deep.equal({
      startIndex: 2,
      endIndex: 0,
      controlIndices: [],
    });
  });

  it("reads both handle tensions off the tangent crossing", () => {
    const points = quarter();
    const tensions = segmentTensions(points, buildIndexedSegments(points, false)[0]);
    expect(tensions.start).to.be.closeTo(0.5523, 0.001);
    expect(tensions.end).to.be.closeTo(0.5523, 0.001);
  });
});

describe("tension-aware edit — the restore", () => {
  it("stretches a quarter circle into a quarter ellipse", () => {
    const before = quarter();
    const after = copy(before);
    after[3] = onCurve(200, 0); // the right end dragged 100 units right
    restoreSegmentTensions(before, after, false);
    // The crossing does not move, because neither tangent turned. The vertical
    // leg is unchanged, so its handle keeps its length. The horizontal leg
    // doubles, so its handle doubles.
    expect(after[1].x).to.equal(0);
    expect(after[1].y).to.equal(-45);
    expect(after[2].x).to.equal(90);
    expect(after[2].y).to.equal(0);
  });

  it("leaves a segment alone when both ends take the same delta", () => {
    const before = quarter();
    const after = copy(before).map((point) => ({ ...point, x: point.x + 30 }));
    const changed = restoreSegmentTensions(before, after, false);
    expect(changed).to.equal(false);
    expect(after[1].y).to.equal(-44.77);
    expect(after[2].x).to.be.closeTo(74.77, 1e-9);
  });

  it("falls back to the chord ratio where the tangents are parallel", () => {
    // Both handles point straight up, so the tangent rays never cross.
    const before = [onCurve(0, 0), control(0, 40), control(100, 40), onCurve(100, 0)];
    const after = copy(before);
    // The ordinary rules carry a point's own handle with it, so the end handle
    // moves with the end point and its direction does not turn.
    after[2] = control(200, 40);
    after[3] = onCurve(200, 0);
    restoreSegmentTensions(before, after, false);
    // Chord 100 -> 200, so each handle doubles along its own direction.
    expect(after[1].y).to.equal(80);
    expect(after[2].y).to.equal(80);
  });

  it("falls back where the crossing sits behind an end", () => {
    // The start handle points away from the segment, so the crossing is behind
    // the start point.
    const before = [onCurve(0, 0), control(-30, 0), control(70, 40), onCurve(100, 0)];
    const after = copy(before);
    after[3] = onCurve(150, 0);
    restoreSegmentTensions(before, after, false);
    expect(after[1].x).to.equal(-45); // 30 * 1.5, along its own direction
  });

  it("leaves a segment whose two ends land on the same place", () => {
    const before = quarter();
    const after = copy(before);
    after[3] = onCurve(0, -100);
    const changed = restoreSegmentTensions(before, after, false);
    expect(changed).to.equal(false);
  });
});

import {
  applyTensionAwareEdit,
  carryCoupledStraights,
  slideTensionPoints,
} from "@fontra/core/tension-aware-edit.js";

// The inner arch of the n in _external/skeletron.fontra/glyphs/a.json, in local
// coordinates with the left stem's outer wall at x = 0. Point 0 is the foot of
// the stem's inner wall, point 1 is the tension point at the top of that wall,
// and the arch runs from there to the apex at point 4.
const archContour = () => [
  onCurve(60, 0),
  onCurve(60, 385, true),
  control(60, 432),
  control(86, 463),
  onCurve(125, 463, true),
];

describe("tension-aware edit — the slide", () => {
  it("slides the tension point to keep the corner in proportion", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(115, 463, true); // the apex dragged 10 units left
    slideTensionPoints(before, after, false);
    // The horizontal leg goes 65 -> 55, a ratio of 0.846. The vertical leg goes
    // 78 -> 66, so the tension point rises 12 units.
    expect(after[1].x).to.equal(60);
    expect(after[1].y).to.equal(397);
  });

  it("leaves a tension point that is itself in the edit", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(115, 463, true);
    after[1] = onCurve(60, 390, true); // the ordinary edit already moved it
    slideTensionPoints(before, after, false);
    expect(after[1].y).to.equal(390);
  });

  it("slides a corner point too, along its own straight", () => {
    // A corner point on a straight has a line to travel and keeps its own
    // handle angle while it travels, so it slides like a smooth one.
    const before = archContour();
    before[1] = onCurve(60, 385); // no smooth flag
    const after = copy(before);
    after[3] = control(76, 463);
    after[4] = onCurve(115, 463, true);
    slideTensionPoints(before, after, false);
    expect(after[1].x).to.equal(60);
    expect(after[1].y).to.equal(397);
  });

  it("slides a tension point the edit moved across its own straight", () => {
    // The right stem of the b: both of its on-curve points are in the drag, so
    // the ordinary rules carry the tension point sideways. The slide still owes
    // it the travel up the stem, because the edit changed no distance along it.
    const before = [
      onCurve(173, 464, true),
      control(207, 464),
      control(228, 433),
      onCurve(228, 389, true),
      onCurve(228, 1),
    ];
    const after = copy(before);
    for (const index of [2, 3, 4]) {
      after[index] = { ...after[index], x: after[index].x - 20 };
    }
    slideTensionPoints(before, after, false);
    expect(after[3].x).to.equal(208); // the drag's own 20 units
    // The arch's horizontal leg goes 55 -> 35, so its vertical leg goes 75 ->
    // 48 and the tension point climbs the stem to meet it.
    expect(after[3].y).to.equal(416);
  });

  it("leaves a tension point the edit moved along its own straight", () => {
    const before = archContour();
    const after = copy(before);
    after[3] = control(76, 463);
    after[4] = onCurve(115, 463, true);
    after[1] = onCurve(60, 390, true);
    after[2] = control(60, 437);
    slideTensionPoints(before, after, false);
    expect(after[1].y).to.equal(390);
  });

  it("does not slide past the far end of its own straight", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(1000, 463, true); // an absurd pull outward
    slideTensionPoints(before, after, false);
    // The straight runs from y = 0 up to the tension point, so the slide stops
    // one unit short of its far end rather than crossing it.
    expect(after[1].y).to.be.at.least(1);
  });

  it("slides first and restores the handles after", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(115, 463, true);
    applyTensionAwareEdit(before, after, false);
    // The whole segment is the same drawing at 0.846 of the size: the vertical
    // handle is 47 * 0.846 and the horizontal one is 39 * 0.846.
    expect(after[1].y).to.equal(397);
    expect(after[2].y).to.equal(397 + 40);
    expect(after[3].x).to.equal(115 - 33);
  });
});

describe("tension-aware edit — continuity", () => {
  it("moves no point by more than the step that drove it, over a 200-step sweep", () => {
    let worst = 0;
    let previous = null;
    for (let step = 0; step <= 200; step++) {
      const apexX = 125 - step * 0.25; // 50 units of travel in quarter units
      const before = archContour();
      const after = copy(before);
      // The ordinary rules carry the apex's own handle with it.
      after[3] = control(86 - step * 0.25, 463);
      after[4] = onCurve(apexX, 463, true);
      applyTensionAwareEdit(before, after, false);
      if (previous) {
        for (let i = 0; i < after.length; i++) {
          const moved = Math.hypot(
            after[i].x - previous[i].x,
            after[i].y - previous[i].y
          );
          worst = Math.max(worst, moved);
        }
      }
      previous = after;
    }
    // A quarter unit of input, plus whole-unit grid rounding on both axes.
    expect(worst).to.be.at.most(2);
  });
});

import {
  solvePlainAxisScale,
  solveRigidLinkScale,
} from "@fontra/core/tension-aware-edit.js";

// The whole outer contour of the n, in local coordinates. Two stems of 60 units
// joined by an inner arch and an outer arch.
const nContour = () => ({
  points: [
    onCurve(0, 500),
    onCurve(0, 0),
    onCurve(60, 0),
    onCurve(60, 385, true),
    control(60, 432),
    control(86, 463),
    onCurve(125, 463, true),
    control(164, 463),
    control(190, 429),
    onCurve(190, 378, true),
    onCurve(190, 0),
    onCurve(250, 0),
    onCurve(250, 407, true),
    control(250, 471),
    control(210, 516),
    onCurve(152, 516, true),
    control(108, 516),
    control(75, 491),
    onCurve(60, 455),
    onCurve(60, 500),
  ],
  isClosed: true,
});

describe("tension-aware edit — the rigid-link scale", () => {
  it("narrows the n to 230 and keeps both stems at 60", () => {
    const contour = nContour();
    const [coordinates] = solveRigidLinkScale([contour], "x", 230 / 250, 0);
    expect(coordinates.get(1)).to.equal(0); // left outer wall
    expect(coordinates.get(2)).to.equal(60); // left inner wall
    expect(coordinates.get(9)).to.equal(170); // right inner wall
    expect(coordinates.get(11)).to.equal(230); // right outer wall
  });

  it("gives each run its own factor", () => {
    const contour = nContour();
    const [coordinates] = solveRigidLinkScale([contour], "x", 230 / 250, 0);
    // The inner run spans 60 to 190 and takes 110 of 130. The outer run spans
    // 60 to 250 and takes 170 of 190. The two apexes therefore move by
    // different amounts.
    expect(coordinates.get(6)).to.be.closeTo(115, 0.5);
    expect(coordinates.get(15)).to.be.closeTo(142.3, 0.5);
  });

  it("stands down where a contour has no elastic run", () => {
    const rectangle = {
      points: [onCurve(0, 0), onCurve(100, 0), onCurve(100, 50), onCurve(0, 50)],
      isClosed: true,
    };
    expect(solveRigidLinkScale([rectangle], "x", 0.5, 0)).to.equal(null);
  });

  it("plain-scales a contour that has no straight anywhere", () => {
    // The ordinary shape of a skeleton centerline: one run of curves, no
    // straights. There is no drawn width to hold, so every point takes the
    // scale and the tension correction keeps the curves.
    const allCurves = {
      points: [
        onCurve(0, 0),
        control(0, 100),
        control(100, 200),
        onCurve(200, 200),
        control(300, 200),
        control(400, 100),
        onCurve(400, 0),
      ],
      isClosed: false,
    };
    const [coordinates] = solveRigidLinkScale([allCurves], "x", 0.5, 0);
    expect(coordinates.get(0)).to.be.closeTo(0, 1e-6);
    expect(coordinates.get(3)).to.be.closeTo(100, 1e-6);
    expect(coordinates.get(6)).to.be.closeTo(200, 1e-6);
  });

  it("stands down where every run returns to its own body", () => {
    // A stem with a bowl hung off it: the bowl's two ends sit on the same run
    // of straights, so nothing can be distributed.
    const bowl = {
      points: [
        onCurve(0, 0),
        onCurve(0, 500),
        onCurve(60, 500),
        control(200, 500),
        control(200, 0),
        onCurve(60, 0),
      ],
      isClosed: true,
    };
    expect(solveRigidLinkScale([bowl], "x", 0.5, 0)).to.equal(null);
  });
});

describe("tension-aware edit — the vertical scale", () => {
  it("squashes every on-curve point in height and nothing in width", () => {
    const contour = nContour();
    const [coordinates] = solvePlainAxisScale([contour], "y", 0.8, 0);
    expect(coordinates.get(6)).to.be.closeTo(463 * 0.8, 0.001);
    expect(coordinates.get(15)).to.be.closeTo(516 * 0.8, 0.001);
    expect(coordinates.get(1)).to.be.closeTo(0, 0.001);
    expect(coordinates.has(4)).to.equal(false); // handles are not solved
  });

  it("holds each curve's tension through the squash", () => {
    const contour = nContour();
    const [coordinates] = solvePlainAxisScale([contour], "y", 0.8, 0);
    const before = contour.points;
    const after = before.map((point) => ({ ...point }));
    for (const [index, y] of coordinates) {
      after[index].y = Math.round(y);
    }
    // The handles ride down with their own points, then the restore rebuilds
    // their lengths.
    after[4].y = before[4].y + (after[3].y - before[3].y);
    after[5].y = before[5].y + (after[6].y - before[6].y);
    applyTensionAwareEdit(before, after, true);
    const tensionBefore = segmentTensions(
      before,
      buildIndexedSegments(before, true)[3]
    );
    const tensionAfter = segmentTensions(after, buildIndexedSegments(after, true)[3]);
    expect(tensionAfter.start).to.be.closeTo(tensionBefore.start, 0.02);
    expect(tensionAfter.end).to.be.closeTo(tensionBefore.end, 0.02);
  });
});

describe("tension-aware edit — the coupled straight", () => {
  // The left stem of the b: a corner at the foot, a tension point at the top,
  // and the arch leaving that tension point.
  const stemContour = () => [
    onCurve(117, 0),
    onCurve(117, 396, true),
    control(117, 437),
    control(138, 464),
    onCurve(173, 464, true),
  ];

  it("carries the whole straight when its tension point moves across it", () => {
    const before = stemContour();
    const after = copy(before);
    after[1] = onCurve(97, 396, true);
    after[2] = control(97, 437);
    carryCoupledStraights(before, after, false);
    // The foot follows, so the stem stays upright instead of tilting.
    expect(after[0].x).to.equal(97);
    expect(after[0].y).to.equal(0);
  });

  it("leaves the straight alone when its tension point moves along it", () => {
    const before = stemContour();
    const after = copy(before);
    after[1] = onCurve(117, 376, true);
    after[2] = control(117, 417);
    carryCoupledStraights(before, after, false);
    // Along the straight is the straight getting shorter, which it may do.
    expect(after[0].x).to.equal(117);
    expect(after[0].y).to.equal(0);
  });

  it("couples no straight that has no tension point on it", () => {
    const rectangle = [
      onCurve(0, 0),
      onCurve(100, 0),
      onCurve(100, 50),
      onCurve(0, 50),
    ];
    const after = copy(rectangle);
    after[1] = onCurve(120, 0);
    expect(carryCoupledStraights(rectangle, after, true)).to.equal(false);
  });
});

describe("tension-aware edit — the handle on a straight", () => {
  // The right stem of the n and the arch leaving it: a corner at the foot, a
  // tension point at the top, and the tension point's handle standing on the
  // straight.
  const stemContour = () => [
    onCurve(347, 1),
    onCurve(347, 377, true),
    control(347, 446),
    control(296, 516),
    onCurve(210, 516, true),
  ];

  const kink = (points) => {
    const straight = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
    const handle = Math.atan2(points[2].y - points[1].y, points[2].x - points[1].x);
    let degrees = ((handle - straight) * 180) / Math.PI;
    while (degrees > 180) degrees -= 360;
    while (degrees < -180) degrees += 360;
    return degrees;
  };

  it("puts the handle back on a straight the coupling un-tilted", () => {
    const before = stemContour();
    const after = copy(before);
    // What the ordinary point rules leave behind on a drag across: the point
    // has moved, the foot has not yet, and the handle has been turned onto the
    // tilted straight.
    after[0] = onCurve(377, 1);
    after[1] = onCurve(377, 377, true);
    after[2] = control(382, 446);
    expect(Math.abs(kink(after))).to.be.greaterThan(3);
    expect(recollinearizeStraightHandles(before, after, false)).to.equal(true);
    expect(Math.abs(kink(after))).to.be.lessThan(0.01);
  });

  it("keeps the handle's length while it squares it", () => {
    const before = stemContour();
    const after = copy(before);
    after[0] = onCurve(377, 1);
    after[1] = onCurve(377, 377, true);
    after[2] = control(382, 446);
    const length = Math.hypot(after[2].x - after[1].x, after[2].y - after[1].y);
    recollinearizeStraightHandles(before, after, false);
    const squared = Math.hypot(after[2].x - after[1].x, after[2].y - after[1].y);
    expect(Math.abs(squared - length)).to.be.lessThan(1);
  });

  it("leaves a corner point's handle alone", () => {
    const before = stemContour();
    before[1] = onCurve(347, 377);
    const after = copy(before);
    after[0] = onCurve(377, 1);
    after[1] = onCurve(377, 377);
    after[2] = control(382, 446);
    expect(recollinearizeStraightHandles(before, after, false)).to.equal(false);
  });

  it("leaves a handle alone where both sides of its point are curves", () => {
    const before = [
      onCurve(0, 0),
      control(0, 55),
      control(45, 100),
      onCurve(100, 100, true),
      control(155, 100),
      control(200, 55),
      onCurve(200, 0),
    ];
    const after = copy(before);
    after[3] = onCurve(100, 120, true);
    expect(recollinearizeStraightHandles(before, after, false)).to.equal(false);
  });
});

describe("tension-aware edit — the drag does not slide", () => {
  // The n's right stem and the arch leaving it: a corner at the foot, the
  // springing point at the top, and the apex, which has curves on both sides.
  const stemAndArch = () => [
    onCurve(347, 1),
    onCurve(347, 377, true),
    control(347, 446),
    control(296, 516),
    onCurve(210, 516, true),
    control(143, 516),
    control(77, 473),
    onCurve(77, 358),
  ];

  it("leaves every on-curve where the drag put it", () => {
    const before = stemAndArch();
    const after = copy(before);
    // The springing point pulled 40 down its own straight, handle carried.
    after[1] = onCurve(347, 337, true);
    after[2] = control(347, 406);
    applyTensionAwareEdit(before, after, false, { slide: false });
    for (let i = 0; i < after.length; i++) {
      if (after[i].type) continue;
      if (i === 1) continue;
      expect(after[i].x).to.equal(before[i].x);
      expect(after[i].y).to.equal(before[i].y);
    }
  });

  it("still holds the segment's tension", () => {
    const before = stemAndArch();
    const after = copy(before);
    after[1] = onCurve(347, 337, true);
    after[2] = control(347, 406);
    const segment = buildIndexedSegments(before, false).find(
      (candidate) => candidate.startIndex === 1
    );
    const wanted = segmentTensions(before, segment);
    applyTensionAwareEdit(before, after, false, { slide: false });
    const got = segmentTensions(after, segment);
    expect(Math.abs(got.start - wanted.start)).to.be.lessThan(0.01);
    expect(Math.abs(got.end - wanted.end)).to.be.lessThan(0.01);
  });

  it("still carries the straight when the springing point goes across it", () => {
    const before = stemAndArch();
    const after = copy(before);
    after[1] = onCurve(377, 377, true);
    after[2] = control(382, 446);
    applyTensionAwareEdit(before, after, false, { slide: false });
    // The foot follows, and the handle goes back on the straight.
    expect(after[0].x).to.equal(377);
    expect(after[2].x).to.equal(377);
  });
});
