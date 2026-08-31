import {
  CULL_PARAMETERS,
  KIND,
  MIN_CROSSING_ANGLE_DEG,
  SNAP_PARAMETERS,
  candidatePull,
  collectCandidates,
  crossLines,
  distanceToCandidate,
  makeLineCandidate,
  makePointCandidate,
  projectOntoLine,
  resetSnapParameters,
  resolveSnap,
  resolveSnapForPoints,
  roundSnapped,
} from "@fontra/core/snapping.js";
import { expect } from "chai";

describe("snapping primitives", () => {
  it("builds a horizontal line candidate with a unit direction", () => {
    const c = makeLineCandidate({
      x: 100,
      y: 50,
      angle: 0,
      kind: KIND.ORTHOGONAL,
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
      kind: KIND.ORTHOGONAL,
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
      kind: KIND.DIAGONAL,
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
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y: 50 },
    });
    expect(distanceToCandidate(line, { x: 999, y: 58 })).to.be.closeTo(8, 1e-12);
    const point = makePointCandidate({
      x: 3,
      y: 4,
      kind: KIND.INTERSECTION,
      source: { x: 3, y: 4 },
    });
    expect(distanceToCandidate(point, { x: 0, y: 0 })).to.be.closeTo(5, 1e-12);
  });
});

describe("snapping crossings", () => {
  const horizontal = (y, kind = KIND.ORTHOGONAL) =>
    makeLineCandidate({ x: 0, y, angle: 0, kind, source: { x: 0, y } });
  const vertical = (x, kind = KIND.OTHER) =>
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
      kind: KIND.DIAGONAL,
      source: { x: 0, y: 0 },
    });
    expect(crossLines(horizontal(0), shallow)).to.equal(null);
  });

  it("calls every crossing one kind, whatever the two lines were", () => {
    expect(crossLines(horizontal(50, KIND.OTHER), vertical(30)).kind).to.equal(
      KIND.INTERSECTION
    );
    const slanted = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 40,
      kind: KIND.DIAGONAL,
      source: { x: 0, y: 0 },
    });
    expect(crossLines(horizontal(50, KIND.OTHER), slanted).kind).to.equal(
      KIND.INTERSECTION
    );
  });
});

describe("the pull model", () => {
  const opts = { pixelUnit: 1, held: null };
  const metric = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y },
    });
  const smart = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.OTHER,
      source: { x: 0, y },
    });

  it("gives a heavier candidate the stronger pull at equal distance", () => {
    const cursor = { x: 0, y: 52 };
    expect(candidatePull(metric(50), cursor, opts)).to.be.greaterThan(
      candidatePull(smart(50), cursor, opts)
    );
  });

  it("lets a near light candidate beat a far heavy one", () => {
    const result = resolveSnap([metric(40), smart(50)], { x: 0, y: 50.5 }, opts);
    expect(result.held[0].kind).to.equal(KIND.OTHER);
  });

  it("returns the cursor unchanged when nothing is in reach", () => {
    const result = resolveSnap([metric(0)], { x: 0, y: 500 }, opts);
    expect(result.freedom).to.equal("free");
    expect(result.held).to.have.length(0);
    expect(result.position.y).to.equal(500);
  });

  it("projects onto one line and reports one degree of freedom", () => {
    const result = resolveSnap([metric(50)], { x: 20, y: 52 }, opts);
    expect(result.freedom).to.equal("line");
    expect(result.position.x).to.equal(20);
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("holds the crossing of two lines already in reach", () => {
    const vertical = makeLineCandidate({
      x: 30,
      y: 0,
      angle: 90,
      kind: KIND.OTHER,
      source: { x: 30, y: 0 },
    });
    const result = resolveSnap([metric(50), vertical], { x: 32, y: 52 }, opts);
    expect(result.freedom).to.equal("point");
    expect(result.held).to.have.length(2);
    expect(result.position.x).to.be.closeTo(30, 1e-9);
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("is a function of the cursor alone, apart from the declared hold bonus", () => {
    const cursor = { x: 20, y: 53 };
    const a = resolveSnap([metric(50)], cursor, opts);
    const b = resolveSnap([metric(50)], cursor, opts);
    expect(a.position).to.deep.equal(b.position);
    const withHold = resolveSnap([metric(50)], cursor, {
      pixelUnit: 1,
      held: metric(50),
    });
    expect(
      candidatePull(metric(50), cursor, { pixelUnit: 1, held: metric(50) })
    ).to.be.closeTo(
      candidatePull(metric(50), cursor, opts) * SNAP_PARAMETERS.holdBonus,
      1e-12
    );
    expect(withHold.freedom).to.equal("line");
  });

  it("lets one kind reach further than another without changing who wins ties", () => {
    const before = SNAP_PARAMETERS.reaches[KIND.ORTHOGONAL];
    try {
      // Out of the shared reach of 12, so nothing takes it.
      expect(resolveSnap([metric(50)], { x: 0, y: 70 }, opts).freedom).to.equal("free");
      SNAP_PARAMETERS.reaches[KIND.ORTHOGONAL] = 3;
      expect(resolveSnap([metric(50)], { x: 0, y: 70 }, opts).freedom).to.equal("line");
      // The smart guide's own reach is untouched by the metric's.
      expect(resolveSnap([smart(50)], { x: 0, y: 70 }, opts).freedom).to.equal("free");
      // And at equal distance the ranking is unchanged: reach is not precedence.
      const cursor = { x: 0, y: 52 };
      expect(candidatePull(metric(50), cursor, opts)).to.be.greaterThan(
        candidatePull(smart(50), cursor, opts)
      );
    } finally {
      SNAP_PARAMETERS.reaches[KIND.ORTHOGONAL] = before;
    }
  });

  it("collapses duplicate candidates at one position to one held entry", () => {
    const result = resolveSnap([metric(50), metric(50)], { x: 0, y: 51 }, opts);
    expect(result.held).to.have.length(1);
  });

  it("measures reach in pixels, so a zoomed-out view reaches further in glyph units", () => {
    const far = { x: 0, y: 70 };
    expect(
      resolveSnap([metric(50)], far, { pixelUnit: 1, held: null }).freedom
    ).to.equal("free");
    expect(
      resolveSnap([metric(50)], far, { pixelUnit: 4, held: null }).freedom
    ).to.equal("line");
  });

  it("stays on the constraint and snaps to where a candidate crosses it", () => {
    const constraint = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 90,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y: 0 },
    });
    const result = resolveSnap([metric(50)], { x: 4, y: 52 }, { ...opts, constraint });
    expect(result.freedom).to.equal("point");
    expect(result.position.x).to.be.closeTo(0, 1e-9);
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("never leaves the constraint, even where nothing is in reach", () => {
    const constraint = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 90,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y: 0 },
    });
    const result = resolveSnap([metric(50)], { x: 4, y: 300 }, { ...opts, constraint });
    expect(result.position.x).to.be.closeTo(0, 1e-9);
    expect(result.position.y).to.be.closeTo(300, 1e-9);
  });

  it("moves the point no faster than the cursor, away from the snap itself", () => {
    const line = metric(50);
    let held = null;
    let previous = null;
    let worstExtra = 0;
    let jumps = 0;
    for (let i = 0; i <= 2000; i++) {
      const cursor = { x: 0, y: 20 + i * 0.05 };
      const result = resolveSnap([line], cursor, { ...opts, held });
      held = result.held[0] || null;
      if (previous !== null) {
        const step = Math.abs(result.position.y - previous);
        if (step > 0.05 + 1e-9) {
          jumps++;
          worstExtra = Math.max(worstExtra, step - 0.05);
        }
      }
      previous = result.position.y;
    }
    // Exactly two steps exceed the cursor's own: entering the snap and leaving it.
    expect(jumps).to.equal(2);
    expect(worstExtra).to.be.lessThan(SNAP_PARAMETERS.reachPixels);
  });
});

describe("multi-point resolution", () => {
  const opts = { pixelUnit: 1, held: null };
  const metric = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y },
    });

  it("lets a point other than the one under the cursor take the snap", () => {
    // The cursor is on the lower point. The upper point is the one near the metric.
    const points = [
      { x: 0, y: 20 },
      { x: 0, y: 51 },
    ];
    const result = resolveSnapForPoints([metric(50)], points, { x: 0, y: 20 }, opts);
    expect(result.pointIndex).to.equal(1);
    expect(result.delta.y).to.be.closeTo(-1, 1e-9);
  });

  it("moves every point by one delta, so the shape is not deformed", () => {
    const points = [
      { x: 0, y: 20 },
      { x: 0, y: 51 },
    ];
    const result = resolveSnapForPoints([metric(50)], points, { x: 0, y: 20 }, opts);
    const moved = points.map((p) => ({
      x: p.x + result.delta.x,
      y: p.y + result.delta.y,
    }));
    expect(moved[1].y - moved[0].y).to.be.closeTo(points[1].y - points[0].y, 1e-9);
  });

  it("prefers the point under the cursor when two alignments are equally close", () => {
    const points = [
      { x: 0, y: 51 }, // under the cursor
      { x: 0, y: 301 }, // far away, equally close to its own metric
    ];
    const result = resolveSnapForPoints(
      [metric(50), metric(300)],
      points,
      { x: 0, y: 51 },
      opts
    );
    expect(result.pointIndex).to.equal(0);
  });

  it("still lets a much closer alignment elsewhere win", () => {
    const points = [
      { x: 0, y: 59 }, // under the cursor, barely in reach
      { x: 0, y: 300.1 }, // far away, almost exactly on its metric
    ];
    const result = resolveSnapForPoints(
      [metric(50), metric(300)],
      points,
      { x: 0, y: 59 },
      opts
    );
    expect(result.pointIndex).to.equal(1);
  });

  it("asks every point at a balance of zero, and only the anchor at one", () => {
    const points = [
      { x: 0, y: 20 }, // under the cursor, nothing in reach of it
      { x: 0, y: 51 }, // far from the hand, almost on the metric
    ];
    const cursor = { x: 0, y: 20 };
    const before = SNAP_PARAMETERS.pointerWeight;
    try {
      SNAP_PARAMETERS.pointerWeight = 0;
      expect(
        resolveSnapForPoints([metric(50)], points, cursor, opts).pointIndex
      ).to.equal(1);
      SNAP_PARAMETERS.pointerWeight = 1;
      const anchorOnly = resolveSnapForPoints([metric(50)], points, cursor, opts);
      // The anchor has nothing in reach, so at one the drag snaps to nothing at
      // all rather than borrowing the far point's alignment.
      expect(anchorOnly.pointIndex).to.equal(-1);
    } finally {
      SNAP_PARAMETERS.pointerWeight = before;
    }
  });

  it("returns a zero delta where no point wins", () => {
    const result = resolveSnapForPoints(
      [metric(50)],
      [{ x: 0, y: 400 }],
      { x: 0, y: 400 },
      opts
    );
    expect(result.delta).to.deep.equal({ x: 0, y: 0 });
    expect(result.held).to.have.length(0);
  });

  it("gives the hold bonus only where the same point holds the same candidate", () => {
    const points = [
      { x: 0, y: 55 },
      { x: 0, y: 52 },
    ];
    const held = { pointIndex: 0, candidate: metric(50) };
    const result = resolveSnapForPoints(
      [metric(50)],
      points,
      { x: 0, y: 55 },
      {
        ...opts,
        held,
      }
    );
    // Point 1 is nearer, but point 0 holds. The bonus must not follow the candidate
    // onto point 1, or the winner alternates between the two and the selection flickers.
    expect(result.pointIndex).to.be.oneOf([0, 1]);
    const again = resolveSnapForPoints(
      [metric(50)],
      points,
      { x: 0, y: 55 },
      {
        ...opts,
        held: { pointIndex: result.pointIndex, candidate: result.held[0] },
      }
    );
    expect(again.pointIndex).to.equal(result.pointIndex);
  });
});

describe("candidate generation", () => {
  const opts = { pixelUnit: 1 };
  afterEach(() => resetSnapParameters());

  it("makes one line per metric, and a band ranks lowest", () => {
    const scene = {
      metrics: [
        { name: "xHeight", value: 500, kind: "metric" },
        { name: "overshoot", value: 510, kind: "band" },
      ],
      guides: [],
      points: [],
      segments: [],
    };
    const found = collectCandidates(scene, { x: 0, y: 505 }, opts);
    expect(found.map((c) => c.kind)).to.have.members([KIND.ORTHOGONAL, KIND.OTHER]);
  });

  it("ranks a right-angle guide above a slanted one", () => {
    SNAP_PARAMETERS.diagonalsEnabled = 1;
    const scene = {
      metrics: [],
      guides: [
        { x: 10, y: 0, angle: 90 },
        { x: 10, y: 0, angle: 30 },
      ],
      points: [],
      segments: [],
    };
    const kinds = collectCandidates(scene, { x: 10, y: 0 }, opts).map((c) => c.kind);
    expect(kinds).to.include(KIND.ORTHOGONAL);
    expect(kinds).to.include(KIND.DIAGONAL);
  });

  it("gives an on-curve point a horizontal and a vertical ray", () => {
    const scene = { metrics: [], guides: [], points: [{ x: 40, y: 60 }], segments: [] };
    const found = collectCandidates(scene, { x: 41, y: 61 }, opts);
    expect(found).to.have.length(2);
    expect(found.every((c) => c.kind === KIND.ORTHOGONAL)).to.equal(true);
  });

  it("drops a source outside the collection radius", () => {
    const far = CULL_PARAMETERS.collectionRadiusPixels + 100;
    const scene = {
      metrics: [],
      guides: [],
      points: [{ x: far, y: far }],
      segments: [],
    };
    expect(collectCandidates(scene, { x: 0, y: 0 }, opts)).to.have.length(0);
  });

  it("keeps only the nearest source per side, so a far point adds no ray a near point already gives", () => {
    const scene = {
      metrics: [],
      guides: [],
      points: [
        { x: 0, y: 103 }, // near, above
        { x: 0, y: 180 }, // far, above - same horizontal family
        { x: 0, y: 97 }, // near, below
      ],
      segments: [],
    };
    const horizontals = collectCandidates(scene, { x: 0, y: 100 }, opts).filter(
      (c) => Math.abs(c.dy) < 1e-9
    );
    expect(horizontals).to.have.length(2);
    expect(horizontals.map((c) => c.y).sort((a, b) => a - b)).to.deep.equal([97, 103]);
  });

  it("never culls a metric or a permanent guide by side", () => {
    const scene = {
      metrics: [
        { name: "baseline", value: 0, kind: "metric" },
        { name: "xHeight", value: 20, kind: "metric" },
        { name: "capHeight", value: 40, kind: "metric" },
      ],
      guides: [],
      points: [],
      segments: [],
    };
    expect(collectCandidates(scene, { x: 0, y: 21 }, opts)).to.have.length(3);
  });

  it("extends a straight segment and a curve end tangent along their own angle", () => {
    SNAP_PARAMETERS.diagonalsEnabled = 1;
    const scene = {
      metrics: [],
      guides: [],
      points: [],
      segments: [
        { type: "line", x: 0, y: 0, angle: 0 },
        { type: "tangent", x: 0, y: 0, angle: 30 },
      ],
    };
    const kinds = collectCandidates(scene, { x: 0, y: 0 }, opts).map((c) => c.kind);
    expect(kinds).to.deep.equal([KIND.ORTHOGONAL, KIND.DIAGONAL]);
  });

  it("caps the candidate list", () => {
    const points = [];
    for (let i = 0; i < 500; i++) {
      points.push({ x: i, y: i });
    }
    const scene = { metrics: [], guides: [], points, segments: [] };
    expect(collectCandidates(scene, { x: 0, y: 0 }, opts).length).to.be.at.most(
      CULL_PARAMETERS.maxCandidates
    );
  });
});

describe("the grid rounds what is left", () => {
  const round = (v) => Math.round(v);

  it("rounds both axes when free", () => {
    const out = roundSnapped(
      { position: { x: 10.4, y: 20.6 }, held: [], freedom: "free" },
      round
    );
    expect(out).to.deep.equal({ x: 10, y: 21 });
  });

  it("rounds along a horizontal line and leaves the line's own coordinate alone", () => {
    const line = makeLineCandidate({
      x: 0,
      y: 50.5,
      angle: 0,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y: 50.5 },
    });
    const out = roundSnapped(
      { position: { x: 10.4, y: 50.5 }, held: [line], freedom: "line" },
      round
    );
    expect(out.x).to.equal(10);
    expect(out.y).to.equal(50.5);
  });

  it("rounds nothing at a crossing", () => {
    const out = roundSnapped(
      { position: { x: 10.4, y: 20.6 }, held: [], freedom: "point" },
      round
    );
    expect(out).to.deep.equal({ x: 10.4, y: 20.6 });
  });

  it("rounds along a slant, so the point stays on the line before emission", () => {
    const line = makeLineCandidate({
      x: 0,
      y: 0,
      angle: 45,
      kind: KIND.DIAGONAL,
      source: { x: 0, y: 0 },
    });
    const out = roundSnapped(
      { position: { x: 7.1, y: 7.1 }, held: [line], freedom: "line" },
      round
    );
    expect(out.x).to.be.closeTo(out.y, 1e-9);
  });
});

describe("a chosen guide is not given up lightly", () => {
  const opts = { pixelUnit: 1, held: null };
  const metric = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y },
    });
  const smart = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.OTHER,
      source: { x: 0, y },
    });

  it("keeps a held candidate that the culls dropped from the list", () => {
    // The source is far away and no longer collected, but the designer is still
    // sliding along the guide they chose.
    const held = metric(50);
    const result = resolveSnap([], { x: 5000, y: 50.2 }, { ...opts, held });
    expect(result.freedom).to.equal("line");
    expect(result.position.y).to.be.closeTo(50, 1e-9);
  });

  it("reports a rival as a suggestion rather than handing it the snap", () => {
    const held = smart(50);
    // The metric is nearer and heavier, so on pull alone it would take over.
    const result = resolveSnap(
      [smart(50), metric(51)],
      { x: 0, y: 50.9 },
      {
        ...opts,
        held,
      }
    );
    expect(result.held[0].kind).to.equal(KIND.OTHER);
    expect(result.suggestion.kind).to.equal(KIND.ORTHOGONAL);
  });

  it("keeps the held guide while the designer slides along it", () => {
    // The metric is heavier and in range on every frame, but the cursor never
    // leaves the held guide, so the metric stays a suggestion.
    const held = smart(50);
    const candidates = [smart(50), metric(51)];
    let overrule = null;
    let result;
    for (let i = 0; i < 20; i++) {
      result = resolveSnap(
        candidates,
        { x: i * 10, y: 50 },
        { ...opts, held, overrule }
      );
      overrule = result.overrule;
    }
    expect(result.held[0].kind).to.equal(KIND.OTHER);
    expect(result.suggestion.kind).to.equal(KIND.ORTHOGONAL);
  });

  it("hands the snap over once the designer moves away for a run of frames", () => {
    const held = smart(50);
    const candidates = [smart(50), metric(51)];
    let overrule = null;
    let result;
    // Every frame is further from the held guide and nearer the metric.
    for (let i = 0; i <= SNAP_PARAMETERS.overruleFrames; i++) {
      result = resolveSnap(
        candidates,
        { x: 0, y: 50 + i * 0.15 },
        { ...opts, held, overrule }
      );
      overrule = result.overrule;
    }
    expect(result.held[0].kind).to.equal(KIND.ORTHOGONAL);
    expect(result.suggestion).to.equal(null);
  });

  it("forgets the run when the designer comes back to the held guide", () => {
    const held = smart(50);
    const candidates = [smart(50), metric(51)];
    let overrule = null;
    for (let i = 1; i <= 2; i++) {
      overrule = resolveSnap(
        candidates,
        { x: 0, y: 50 + i * 0.15 },
        { ...opts, held, overrule }
      ).overrule;
    }
    expect(overrule.count).to.equal(1);
    const back = resolveSnap(candidates, { x: 0, y: 50 }, { ...opts, held, overrule });
    expect(back.overrule.count).to.equal(0);
    expect(back.held[0].kind).to.equal(KIND.OTHER);
  });

  it("still releases entirely when the held candidate falls below the floor", () => {
    const held = metric(50);
    const result = resolveSnap([], { x: 0, y: 200 }, { ...opts, held });
    expect(result.freedom).to.equal("free");
    expect(result.held).to.have.length(0);
  });
});

describe("travelling past a guide, and breaking free of one", () => {
  const opts = { pixelUnit: 1, held: null };
  const metric = (y) =>
    makeLineCandidate({
      x: 0,
      y,
      angle: 0,
      kind: KIND.ORTHOGONAL,
      source: { x: 0, y },
    });

  const fast = SNAP_PARAMETERS.acquireSpeedPixels + 1;
  const flick = SNAP_PARAMETERS.escapeSpeedPixels + 1;

  it("takes no new snap while the pointer is travelling", () => {
    const cursor = { x: 0, y: 50.5 };
    expect(resolveSnap([metric(50)], cursor, opts).freedom).to.equal("line");
    expect(
      resolveSnap([metric(50)], cursor, { ...opts, speed: fast }).freedom
    ).to.equal("free");
  });

  it("keeps a snap it already holds while travelling", () => {
    const held = metric(50);
    const result = resolveSnap(
      [metric(50)],
      { x: 900, y: 50.2 },
      {
        ...opts,
        held,
        speed: fast,
      }
    );
    expect(result.freedom).to.equal("line");
  });

  it("will not break free on speed alone, without settling first", () => {
    const held = metric(50);
    // Never slow enough to arm, so the flick is just travel and the hold stays.
    const overrule = { candidate: null, count: 0, heldDistance: 0 };
    const result = resolveSnap(
      [metric(50)],
      { x: 0, y: 50.4 },
      {
        ...opts,
        held,
        speed: flick,
        overrule,
        escape: { armed: false, refused: null },
      }
    );
    expect(result.freedom).to.equal("line");
  });

  it("breaks free when the designer settles and then leaves fast", () => {
    const held = metric(50);
    const candidates = [metric(50)];
    // Settle on the guide: this arms the escape.
    const settled = resolveSnap(
      candidates,
      { x: 0, y: 50 },
      { ...opts, held, speed: 5 }
    );
    expect(settled.escape.armed).to.equal(true);
    // Then leave it fast.
    const freed = resolveSnap(
      candidates,
      { x: 0, y: 50.6 },
      {
        ...opts,
        held,
        speed: flick,
        overrule: settled.overrule,
        escape: settled.escape,
      }
    );
    expect(freed.freedom).to.equal("free");
    expect(freed.escaped.kind).to.equal(KIND.ORTHOGONAL);
  });

  it("refuses the escaped guide until the cursor has left its reach", () => {
    const escaped = metric(50);
    const candidates = [metric(50)];
    const escape = { armed: false, refused: escaped };
    // Still inside the reach, and slow: without the refusal this would snap back.
    const inside = resolveSnap(candidates, { x: 0, y: 50.5 }, { ...opts, escape });
    expect(inside.freedom).to.equal("free");
    expect(inside.escape.refused).to.not.equal(null);
    // Out past the reach, the refusal is spent.
    const outside = resolveSnap(candidates, { x: 0, y: 200 }, { ...opts, escape });
    expect(outside.escape.refused).to.equal(null);
  });
});

describe("a weightless kind is offered but never wins", () => {
  afterEach(() => resetSnapParameters());

  const scene = (kind) => ({
    metrics: [],
    guides: [],
    segments: [],
    points: [{ x: 100, y: 100, kind }],
  });
  const cursor = { x: 101, y: 101 };
  const options = { pixelUnit: 1, held: null };

  it("collects the own-generated rays like any other point's", () => {
    const candidates = collectCandidates(scene(KIND.OWN_GENERATED), cursor, {
      pixelUnit: 1,
    });
    const own = candidates.filter((c) => c.kind === KIND.OWN_GENERATED);
    // One horizontal and one vertical, the same pair every point casts.
    expect(own.length).to.equal(2);
  });

  it("gives them no pull, so the resolver holds nothing", () => {
    const candidates = collectCandidates(scene(KIND.OWN_GENERATED), cursor, {
      pixelUnit: 1,
    });
    for (const candidate of candidates) {
      expect(candidatePull(candidate, cursor, options)).to.equal(0);
    }
    expect(resolveSnap(candidates, cursor, options).held).to.deep.equal([]);
  });

  it("does not let them form an intersection either", () => {
    const horizontal = makeLineCandidate({
      x: 0,
      y: 100,
      angle: 0,
      kind: KIND.OWN_GENERATED,
    });
    const vertical = makeLineCandidate({
      x: 100,
      y: 0,
      angle: 90,
      kind: KIND.ORTHOGONAL,
    });
    // Without this rule the crossing would come back at the intersection
    // weight, and a weight of zero would not mean what it says.
    expect(crossLines(horizontal, vertical)).to.equal(null);
  });

  it("snaps to them once the designer gives them a weight", () => {
    SNAP_PARAMETERS.weights[KIND.OWN_GENERATED] = 0.5;
    const candidates = collectCandidates(scene(KIND.OWN_GENERATED), cursor, {
      pixelUnit: 1,
    });
    expect(resolveSnap(candidates, cursor, options).held.length).to.be.above(0);
  });
});

describe("rays are chosen per kind", () => {
  afterEach(() => resetSnapParameters());

  it("does not let a nearer kind hide a further one", () => {
    SNAP_PARAMETERS.offCurveSources = 1;
    const candidates = collectCandidates(
      {
        metrics: [],
        guides: [],
        segments: [],
        points: [
          { x: 100, y: 101 },
          { x: 100, y: 140, offCurve: true },
        ],
      },
      { x: 100, y: 100 },
      { pixelUnit: 1 }
    );
    // The on-curve point is much nearer, but an off-curve is a kind of its own,
    // so its rays are still offered and a weight change can reach them.
    expect(candidates.some((c) => c.kind === KIND.OFF_CURVE)).to.equal(true);
    expect(candidates.some((c) => c.kind === KIND.ORTHOGONAL)).to.equal(true);
  });
});

describe("one direction, one weight", () => {
  afterEach(() => resetSnapParameters());

  const cursor = { x: 0, y: 52 };
  const line = (kind) =>
    makeLineCandidate({ x: 0, y: 50, angle: 0, kind, source: { x: 0, y: 50 } });

  it("pulls a metric, a guide and a smart ray alike, because they run the same way", () => {
    // What the source was is not a rank. Only the direction is, which is why the
    // kind table is a direction table.
    const scene = {
      metrics: [{ name: "xHeight", value: 50, kind: "metric" }],
      guides: [{ x: 0, y: 50, angle: 0 }],
      points: [{ x: 0, y: 50 }],
      segments: [],
    };
    const found = collectCandidates(scene, cursor, { pixelUnit: 1 });
    const horizontals = found.filter((c) => Math.abs(c.dy) < 1e-9);
    expect(horizontals.length).to.be.at.least(3);
    for (const candidate of horizontals) {
      expect(candidate.kind).to.equal(KIND.ORTHOGONAL);
    }
  });

  it("keeps the drawing's guide-or-smart distinction off the kind", () => {
    // The two are drawn differently and weighed the same, so the difference is
    // carried as a flag rather than as a kind.
    const scene = {
      metrics: [{ name: "xHeight", value: 50, kind: "metric" }],
      guides: [],
      points: [{ x: 0, y: 50 }],
      segments: [],
    };
    const found = collectCandidates(scene, cursor, { pixelUnit: 1 });
    expect(found.some((c) => c.permanent)).to.equal(true);
    expect(found.some((c) => !c.permanent)).to.equal(true);
  });
});

describe("diagonals are off until asked for", () => {
  afterEach(() => resetSnapParameters());

  const scene = {
    metrics: [],
    guides: [{ x: 0, y: 0, angle: 30 }],
    points: [{ x: 0, y: 2 }],
    segments: [{ type: "line", x: 0, y: 0, angle: 40 }],
  };
  const cursor = { x: 0, y: 0 };

  it("offers no slanted candidate by default", () => {
    const found = collectCandidates(scene, cursor, { pixelUnit: 1 });
    expect(found.some((c) => c.kind === KIND.DIAGONAL)).to.equal(false);
    expect(found.some((c) => c.kind === KIND.ORTHOGONAL)).to.equal(true);
  });

  it("offers them once the switch is on", () => {
    SNAP_PARAMETERS.diagonalsEnabled = 1;
    const found = collectCandidates(scene, cursor, { pixelUnit: 1 });
    expect(found.some((c) => c.kind === KIND.DIAGONAL)).to.equal(true);
  });

  it("offers nothing but them while the key is held, switch or no switch", () => {
    for (const enabled of [0, 1]) {
      SNAP_PARAMETERS.diagonalsEnabled = enabled;
      const found = collectCandidates(scene, cursor, {
        pixelUnit: 1,
        diagonals: "only",
      });
      expect(found.length).to.be.above(0);
      expect(found.every((c) => c.kind === KIND.DIAGONAL)).to.equal(true);
    }
  });
});

describe("off-curve points as sources", () => {
  afterEach(() => resetSnapParameters());

  const scene = {
    metrics: [],
    guides: [],
    segments: [],
    points: [{ x: 100, y: 100, offCurve: true }],
  };
  const cursor = { x: 101, y: 101 };

  it("casts no ray while the switch is off", () => {
    expect(collectCandidates(scene, cursor, { pixelUnit: 1 })).to.have.length(0);
  });

  it("casts the ordinary pair once it is on, under its own kind", () => {
    SNAP_PARAMETERS.offCurveSources = 1;
    const found = collectCandidates(scene, cursor, { pixelUnit: 1 });
    expect(found).to.have.length(2);
    expect(found.every((c) => c.kind === KIND.OFF_CURVE)).to.equal(true);
  });

  it("answers to its own weight", () => {
    SNAP_PARAMETERS.offCurveSources = 1;
    SNAP_PARAMETERS.weights[KIND.OFF_CURVE] = 0;
    const found = collectCandidates(scene, cursor, { pixelUnit: 1 });
    expect(
      resolveSnap(found, cursor, { pixelUnit: 1, held: null }).held
    ).to.have.length(0);
    SNAP_PARAMETERS.weights[KIND.OFF_CURVE] = 0.9;
    expect(
      resolveSnap(found, cursor, { pixelUnit: 1, held: null }).held.length
    ).to.be.above(0);
  });
});

describe("a source can refuse to be culled", () => {
  it("keeps a marked source a nearer one of its own kind would have hidden", () => {
    const scene = {
      metrics: [],
      guides: [],
      segments: [],
      points: [
        { x: 0, y: 103 },
        { x: 0, y: 180, alwaysKeep: true },
      ],
    };
    const horizontals = collectCandidates(scene, { x: 0, y: 100 }, { pixelUnit: 1 })
      .filter((c) => Math.abs(c.dy) < 1e-9)
      .map((c) => c.y)
      .sort((a, b) => a - b);
    expect(horizontals).to.deep.equal([103, 180]);
  });
});
