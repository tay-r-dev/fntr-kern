import {
  buildIndexedSegments,
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
