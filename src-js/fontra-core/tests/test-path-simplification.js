import { expect } from "chai";

import {
  buildSimplifyRuns,
  classifySimplifyContour,
  contourToCubicPieces,
  cubicDerivative,
  cubicExtremaParameters,
  cubicPoint,
  insertExtremaPoints,
  splitCubic,
} from "@fontra/core/path-simplification.js";

const EPSILON = 1e-9;

function expectPointClose(point, x, y, tolerance = EPSILON) {
  expect(point.x).to.be.closeTo(x, tolerance);
  expect(point.y).to.be.closeTo(y, tolerance);
}

describe("cubicPoint", () => {
  const points = [
    { x: 10, y: 20 },
    { x: 40, y: 80 },
    { x: 90, y: 60 },
    { x: 130, y: 5 },
  ];

  it("returns the start point at t=0 and the end point at t=1", () => {
    expectPointClose(cubicPoint(points, 0), 10, 20);
    expectPointClose(cubicPoint(points, 1), 130, 5);
  });
});

describe("cubicDerivative", () => {
  it("is constant for a line-like cubic (collinear, evenly spaced handles)", () => {
    // A cubic whose control points are collinear and spaced at thirds
    // degenerates to a straight line with constant derivative.
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const d = cubicDerivative(points, t);
      expect(d.x).to.be.closeTo(90, EPSILON);
      expect(d.y).to.be.closeTo(0, EPSILON);
    }
  });
});

describe("cubicExtremaParameters", () => {
  it("returns one interior root for a cubic with one x extremum", () => {
    // Parabola-like in x: x(t) has a single turning point at t=0.5.
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 50, y: 20 },
      { x: 0, y: 30 },
    ];
    const roots = cubicExtremaParameters(points);
    expect(roots.length).to.equal(1);
    expect(roots[0]).to.be.closeTo(0.5, EPSILON);
  });

  it("returns one interior root for a cubic with one y extremum", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 50 },
      { x: 20, y: 50 },
      { x: 30, y: 0 },
    ];
    const roots = cubicExtremaParameters(points);
    expect(roots.length).to.equal(1);
    expect(roots[0]).to.be.closeTo(0.5, EPSILON);
  });

  it("excludes roots at t=0 and t=1", () => {
    // Straight, evenly spaced line: derivative is constant zero nowhere,
    // but a degenerate cubic where dx/dt has its only roots at the ends
    // must yield no interior roots.
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 0 },
    ];
    const roots = cubicExtremaParameters(points);
    expect(roots).to.deep.equal([]);
  });

  it("returns sorted roots for a cubic with both x and y extrema", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ];
    const roots = cubicExtremaParameters(points);
    expect(roots.length).to.be.greaterThan(0);
    for (let i = 1; i < roots.length; i++) {
      expect(roots[i]).to.be.greaterThan(roots[i - 1]);
    }
    for (const t of roots) {
      expect(t).to.be.greaterThan(0);
      expect(t).to.be.lessThan(1);
    }
  });
});

describe("splitCubic", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 30, y: 90 },
    { x: 100, y: 90 },
    { x: 130, y: 0 },
  ];

  it("reconstructs the original curve at fixed sample parameters", () => {
    for (const splitT of [0.25, 0.5, 0.8]) {
      const { left, right } = splitCubic(points, splitT);
      // The split point lies on the original curve.
      const onCurve = cubicPoint(points, splitT);
      expectPointClose(left[3], onCurve.x, onCurve.y);
      expectPointClose(right[0], onCurve.x, onCurve.y);
      // Left half at t=0.5 equals the original at splitT * 0.5, etc.
      for (const sampleT of [0.125, 0.5, 0.875]) {
        const expected = cubicPoint(points, splitT * sampleT);
        expectPointClose(cubicPoint(left, sampleT), expected.x, expected.y, 1e-7);
        const expectedRight = cubicPoint(points, splitT + (1 - splitT) * sampleT);
        expectPointClose(
          cubicPoint(right, sampleT),
          expectedRight.x,
          expectedRight.y,
          1e-7
        );
      }
    }
  });
});

describe("contourToCubicPieces", () => {
  it("marks line segments as non-mergeable", () => {
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 130, y: 0, type: "cubic" },
        { x: 170, y: 40, type: "cubic" },
        { x: 200, y: 100 },
      ],
    };
    const pieces = contourToCubicPieces(contour);
    expect(pieces.length).to.equal(2);
    expect(pieces[0].kind).to.equal("line");
    expect(pieces[0].mergeable).to.equal(false);
    expect(pieces[1].kind).to.equal("cubic");
    expect(pieces[1].points.length).to.equal(4);
  });

  it("includes the closing segment for a closed contour", () => {
    const contour = {
      isClosed: true,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0, type: "cubic" },
        { x: 60, y: 30, type: "cubic" },
        { x: 60, y: 60 },
        { x: 30, y: 60, type: "cubic" },
        { x: 0, y: 30, type: "cubic" },
      ],
    };
    const pieces = contourToCubicPieces(contour);
    expect(pieces.length).to.equal(2);
    expect(pieces.every((piece) => piece.kind === "cubic")).to.be.true;
    // Closing piece goes from the last on-curve (index 3) back to index 0.
    expect(pieces[1].startPointIndex).to.equal(3);
    expect(pieces[1].endPointIndex).to.equal(0);
  });

  it("preserves original contour point indices on pieces", () => {
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0, type: "cubic" },
        { x: 20, y: 0, type: "cubic" },
        { x: 30, y: 0 },
      ],
    };
    const pieces = contourToCubicPieces(contour);
    expect(pieces[0].startPointIndex).to.equal(0);
    expect(pieces[0].endPointIndex).to.equal(3);
  });
});

describe("classifySimplifyContour", () => {
  it("protects a corner (non-smooth on-curve point)", () => {
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0, type: "cubic" },
        { x: 60, y: 30, type: "cubic" },
        { x: 60, y: 60 }, // corner: smooth absent
        { x: 90, y: 60, type: "cubic" },
        { x: 120, y: 90, type: "cubic" },
        { x: 150, y: 90 },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    expect(analysis.protectedPointKeys.has(3)).to.be.true;
  });

  it("does not protect an interior smooth point", () => {
    const contour = {
      isClosed: true,
      points: [
        { x: 0, y: 0, smooth: true },
        { x: 30, y: 30, type: "cubic" },
        { x: 70, y: 30, type: "cubic" },
        { x: 100, y: 0, smooth: true },
        { x: 70, y: -30, type: "cubic" },
        { x: 30, y: -30, type: "cubic" },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    expect(analysis.protectedPointKeys.has(0)).to.be.false;
    expect(analysis.protectedPointKeys.has(3)).to.be.false;
  });

  it("inserts and protects an extrema point", () => {
    // Single open cubic arc with a y extremum at t=0.5.
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 100, type: "cubic" },
        { x: 70, y: 100, type: "cubic" },
        { x: 100, y: 0 },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    // The original cubic is split into two pieces at the extremum.
    expect(analysis.pieces.length).to.equal(2);
    // The inserted extrema point appears in sourcePointMap and is protected.
    const insertedKeys = [...analysis.sourcePointMap.keys()];
    expect(insertedKeys.length).to.equal(1);
    expect(analysis.protectedPointKeys.has(insertedKeys[0])).to.be.true;
    const inserted = analysis.sourcePointMap.get(insertedKeys[0]);
    expect(inserted.sourceSegmentIndex).to.equal(0);
    expect(inserted.t).to.be.closeTo(0.5, 1e-9);
  });

  it("protects a point with non-empty attrs", () => {
    const contour = {
      isClosed: true,
      points: [
        { x: 0, y: 0, smooth: true, attrs: { name: "keepme" } },
        { x: 30, y: 30, type: "cubic" },
        { x: 70, y: 30, type: "cubic" },
        { x: 100, y: 0, smooth: true },
        { x: 70, y: -30, type: "cubic" },
        { x: 30, y: -30, type: "cubic" },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    expect(analysis.protectedPointKeys.has(0)).to.be.true;
  });

  it("protects both endpoints of an open contour", () => {
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0, smooth: true },
        { x: 30, y: 0, type: "cubic" },
        { x: 70, y: 0, type: "cubic" },
        { x: 100, y: 0, smooth: true },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    expect(analysis.protectedPointKeys.has(0)).to.be.true;
    expect(analysis.protectedPointKeys.has(3)).to.be.true;
  });
});

describe("buildSimplifyRuns", () => {
  it("merges consecutive cubic pieces between protected points into one run", () => {
    // The joint runs diagonally: a joint on a flat top or side would be an
    // extremum, and extrema are protected, which would split the run in two.
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10, type: "cubic" },
        { x: 20, y: 15, type: "cubic" },
        { x: 30, y: 20, smooth: true },
        { x: 40, y: 25, type: "cubic" },
        { x: 50, y: 30, type: "cubic" },
        { x: 60, y: 40 },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    const runs = buildSimplifyRuns(analysis);
    expect(runs.length).to.equal(1);
    expect(runs[0].pieces.length).to.equal(2);
  });

  it("stops a run at a corner", () => {
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10, type: "cubic" },
        { x: 20, y: 10, type: "cubic" },
        { x: 30, y: 10 }, // corner
        { x: 40, y: 10, type: "cubic" },
        { x: 50, y: 10, type: "cubic" },
        { x: 60, y: 0 },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    const runs = buildSimplifyRuns(analysis);
    // Each side of the corner is a one-piece run, which is not mergeable.
    expect(runs.length).to.equal(0);
  });

  it("stops a run at a line segment", () => {
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 40, y: 10, type: "cubic" },
        { x: 50, y: 10, type: "cubic" },
        { x: 60, y: 0 },
      ],
    };
    const analysis = classifySimplifyContour(contour);
    const runs = buildSimplifyRuns(analysis);
    expect(runs.length).to.equal(0);
  });
});

import {
  canMergeCubicPieces,
  fitCubicToSpan,
  maxCubicDeviation,
  simplifyRun,
} from "@fontra/core/path-simplification.js";

describe("fitCubicToSpan", () => {
  it("returns null for a zero-length tangent", () => {
    const pieces = [
      {
        kind: "cubic",
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 100 },
        ],
      },
      {
        kind: "cubic",
        points: [
          { x: 100, y: 100 },
          { x: 150, y: 150 },
          { x: 200, y: 200 },
          { x: 300, y: 200 },
        ],
      },
    ];
    const candidate = fitCubicToSpan(pieces, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(candidate).to.equal(null);
  });
});

describe("maxCubicDeviation", () => {
  it("is zero when the candidate reproduces the original run exactly", () => {
    const original = [
      { x: 0, y: 0 },
      { x: 30, y: 90 },
      { x: 100, y: 90 },
      { x: 130, y: 0 },
    ];
    const { left, right } = splitCubic(original, 0.5);
    const pieces = [
      { kind: "cubic", points: left },
      { kind: "cubic", points: right },
    ];
    const deviation = maxCubicDeviation(pieces, original);
    expect(deviation).to.be.closeTo(0, 1e-7);
  });
});

describe("canMergeCubicPieces / simplifyRun", () => {
  // A smooth run: one cubic split in half. Merging must reproduce it.
  const arc = [
    { x: 0, y: 0 },
    { x: 10, y: 55 },
    { x: 45, y: 90 },
    { x: 90, y: 100 },
  ];
  const { left, right } = splitCubic(arc, 0.5);
  const smoothPieces = [
    { kind: "cubic", points: left },
    { kind: "cubic", points: right },
  ];

  it("a smooth cubic run merges when tolerance is generous", () => {
    expect(canMergeCubicPieces(smoothPieces, 1.0)).to.be.true;
    const simplified = simplifyRun({ pieces: smoothPieces }, { tolerance: 1.0 });
    expect(simplified.length).to.equal(1);
    expect(simplified[0].kind).to.equal("cubic");
    // The merged cubic stays close to the original arc.
    const deviation = maxCubicDeviation(smoothPieces, simplified[0].points);
    expect(deviation).to.be.lessThan(1.0);
  });

  it("the same run does not merge when tolerance is tiny", () => {
    // Two cubics joined at a visible angle cannot become one cubic.
    const kinkPieces = [
      {
        kind: "cubic",
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 60, y: 0 },
          { x: 90, y: 0 },
        ],
      },
      {
        kind: "cubic",
        points: [
          { x: 90, y: 0 },
          { x: 90, y: 30 },
          { x: 90, y: 60 },
          { x: 90, y: 90 },
        ],
      },
    ];
    expect(canMergeCubicPieces(kinkPieces, 0.01)).to.be.false;
    const simplified = simplifyRun({ pieces: kinkPieces }, { tolerance: 0.01 });
    expect(simplified.length).to.equal(2);
  });
});

import {
  rebuildSimplifiedContour,
  simplifyContour,
} from "@fontra/core/path-simplification.js";

// A closed "lens" made of two arcs, each pre-split at its apex:
// 4 cubic segments, 4 smooth on-curve points, no interior extrema.
const lensContour = {
  isClosed: true,
  points: [
    { x: 0, y: 0, smooth: true },
    { x: 30, y: 40, type: "cubic" },
    { x: 65, y: 60, type: "cubic" },
    { x: 100, y: 60, smooth: true },
    { x: 135, y: 60, type: "cubic" },
    { x: 170, y: 40, type: "cubic" },
    { x: 200, y: 0, smooth: true },
    { x: 170, y: -40, type: "cubic" },
    { x: 135, y: -60, type: "cubic" },
    { x: 100, y: -60, smooth: true },
    { x: 65, y: -60, type: "cubic" },
    { x: 30, y: -40, type: "cubic" },
  ],
};

// Cut every cubic segment of a contour in two, at a parameter that is not an
// extremum. The shape is unchanged; the extra on-curve points are exactly the
// redundant ones Simplify is meant to remove.
function oversplit(contour, t = 0.4) {
  const points = [];
  for (const piece of contourToCubicPieces(contour)) {
    points.push(contour.points[piece.startPointIndex]);
    if (piece.kind !== "cubic") {
      continue;
    }
    const { left, right } = splitCubic(piece.points, t);
    points.push(
      { ...left[1], type: "cubic" },
      { ...left[2], type: "cubic" },
      { x: left[3].x, y: left[3].y, smooth: true },
      { ...right[1], type: "cubic" },
      { ...right[2], type: "cubic" }
    );
  }
  if (!contour.isClosed) {
    points.push(contour.points.at(-1));
  }
  return { points, isClosed: contour.isClosed };
}

// A circle of radius 100, drawn as four cubics meeting at the four extrema,
// on whole units the way a real drawing is.
function circleContour() {
  const radius = 100;
  const handle = 0.5522847498 * radius;
  const onCurves = [
    [radius, 0],
    [0, radius],
    [-radius, 0],
    [0, -radius],
  ];
  const points = [];
  for (const [i, [x, y]] of onCurves.entries()) {
    const [nextX, nextY] = onCurves[(i + 1) % onCurves.length];
    const round = (value) => Math.round(value);
    points.push(
      { x, y, smooth: true },
      {
        x: round(x - (y / radius) * handle),
        y: round(y + (x / radius) * handle),
        type: "cubic",
      },
      {
        x: round(nextX + (nextY / radius) * handle),
        y: round(nextY - (nextX / radius) * handle),
        type: "cubic",
      }
    );
  }
  return { points, isClosed: true };
}

function signedArea(contour) {
  // Sample the actual curve segments; on-curve points alone collapse to a
  // degenerate polygon after merging.
  const samples = [];
  for (const piece of contourToCubicPieces(contour)) {
    const ts = piece.kind === "cubic" ? [0, 0.25, 0.5, 0.75] : [0];
    for (const t of ts) {
      samples.push(
        piece.kind === "cubic" ? cubicPoint(piece.points, t) : piece.points[0]
      );
    }
  }
  let area = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

describe("fitCubicToSpan on a long piece and a sliver", () => {
  // Straight off a real drawing: the run that merges most of one segment with
  // the short leftover an extremum split off the next. Its error surface has
  // a narrow valley, and a fit that walks downhill from a single guess steps
  // over it and settles on wildly uneven handles that draw a visibly worse
  // curve.
  const pieces = [
    {
      points: [
        { x: 167, y: 248 },
        { x: 167, y: 186 },
        { x: 205, y: 149 },
        { x: 256, y: 144 },
      ],
    },
    {
      points: [
        { x: 256, y: 144 },
        { x: 260.695, y: 143.448 },
        { x: 265.399, y: 143.175 },
        { x: 270.082, y: 143.175 },
      ],
    },
  ];

  it("finds the even-handled fit, not the lopsided one", () => {
    const first = pieces[0].points;
    const last = pieces.at(-1).points;
    const fitted = fitCubicToSpan(
      pieces,
      { x: first[1].x - first[0].x, y: first[1].y - first[0].y },
      { x: last[3].x - last[2].x, y: last[3].y - last[2].y }
    );
    const start = Math.hypot(fitted[1].x - first[0].x, fitted[1].y - first[0].y);
    const end = Math.hypot(fitted[2].x - last[3].x, fitted[2].y - last[3].y);
    // The lopsided answer this used to return was 86 against 37.
    expect(Math.max(start, end) / Math.min(start, end)).to.be.lessThan(1.5);
    // And it really is the better fit, not merely the prettier one.
    expect(maxCubicDeviation(pieces, fitted)).to.be.lessThan(0.2);
  });
});

describe("simplifyContour / rebuildSimplifiedContour", () => {
  it("keeps both endpoints of an open contour unchanged", () => {
    const openContour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 40, type: "cubic" },
        { x: 65, y: 60, type: "cubic" },
        { x: 100, y: 60, smooth: true },
        { x: 135, y: 60, type: "cubic" },
        { x: 170, y: 40, type: "cubic" },
        { x: 200, y: 0 },
      ],
    };
    const simplified = simplifyContour(oversplit(openContour), { tolerance: 1.0 });
    expect(simplified).to.not.equal(null);
    expect(simplified.isClosed).to.be.false;
    expectPointClose(simplified.points[0], 0, 0);
    expectPointClose(simplified.points.at(-1), 200, 0);
    // The redundant split points go; the top extremum stays.
    const onCurves = simplified.points.filter((p) => !p.type);
    expect(onCurves.length).to.equal(3);
    expectPointClose(onCurves[1], 100, 60, 0.05);
  });

  it("preserves closed state and winding direction", () => {
    const simplified = simplifyContour(oversplit(lensContour), { tolerance: 1.0 });
    expect(simplified).to.not.equal(null);
    expect(simplified.isClosed).to.be.true;
    expect(Math.sign(signedArea(simplified))).to.equal(
      Math.sign(signedArea(oversplit(lensContour)))
    );
    // The 8 split segments merge back to the original 4, one per extremum.
    const onCurves = simplified.points.filter((p) => !p.type);
    expect(onCurves.length).to.equal(4);
  });

  it("keeps attrs on a surviving protected point", () => {
    const contour = {
      isClosed: true,
      points: oversplit(lensContour).points.map((p, i) =>
        p.x === 200 && p.y === 0 ? { ...p, attrs: { note: "keep" } } : { ...p }
      ),
    };
    const simplified = simplifyContour(contour, { tolerance: 1.0 });
    const withAttrs = simplified.points.filter((p) => p.attrs?.note === "keep");
    expect(withAttrs.length).to.equal(1);
    expectPointClose(withAttrs[0], 200, 0);
  });

  it("repeating simplify produces no additional change", () => {
    const once = simplifyContour(oversplit(lensContour), { tolerance: 1.0 });
    // null = no change; the simplified contour is a fixed point.
    expect(simplifyContour(once, { tolerance: 1.0 })).to.equal(null);
  });

  it("leaves an on-curve point on every extremum of the result", () => {
    const simplified = simplifyContour(oversplit(lensContour), { tolerance: 1.0 });
    // Asking again for the extrema finds them all occupied already.
    expect(insertExtremaPoints([simplified])[0]).to.deep.equal(simplified);
  });

  it("brings an over-pointed circle back to four points, one per extremum", () => {
    const circle = circleContour();
    // A circle drawn the usual way is already as simple as it gets.
    expect(simplifyContour(circle, { tolerance: 1.0 })).to.equal(null);
    // Cut every quarter in two and it comes straight back.
    const simplified = simplifyContour(oversplit(circle), { tolerance: 1.0 });
    expect(simplified.points.length).to.equal(circle.points.length);
    const onCurves = simplified.points.filter((p) => !p.type);
    expect(onCurves.length).to.equal(4);
    for (const [i, expected] of [
      [100, 0],
      [0, 100],
      [-100, 0],
      [0, -100],
    ].entries()) {
      expectPointClose(onCurves[i], expected[0], expected[1], 0.05);
    }
  });

  it("drops a point sitting in the middle of a straight", () => {
    // A stem drawn with a stray point halfway up its side.
    const contour = {
      isClosed: true,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 250 },
        { x: 0, y: 500 },
        { x: 80, y: 500 },
        { x: 80, y: 0 },
      ],
    };
    const simplified = simplifyContour(contour, { tolerance: 1.0 });
    expect(simplified.points.length).to.equal(4);
    expect(simplified.points.some((p) => p.y === 250)).to.be.false;
    // The corners stay put.
    expectPointClose(simplified.points[0], 0, 0);
  });

  it("keeps a point that only looks collinear", () => {
    const contour = {
      isClosed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 250 },
        { x: 0, y: 500 },
        { x: 80, y: 500 },
        { x: 80, y: 0 },
      ],
    };
    expect(simplifyContour(contour, { tolerance: 1.0 })).to.equal(null);
  });

  it("simplifies a closed contour that starts on a removable point", () => {
    // Runs do not wrap around the end of a closed contour, so the point the
    // contour happens to start on must not be privileged: here the start is a
    // redundant split point, and it has to go like all the others.
    const split = oversplit(circleContour());
    const rotated = {
      isClosed: true,
      // Move the start three points along, onto the first split point.
      points: [...split.points.slice(3), ...split.points.slice(0, 3)],
    };
    const simplified = simplifyContour(rotated, { tolerance: 1.0 });
    const onCurves = simplified.points.filter((p) => !p.type);
    expect(onCurves.length).to.equal(4);
    for (const point of onCurves) {
      // Every surviving point is on a turning point of the circle.
      expect(Math.min(Math.abs(point.x), Math.abs(point.y))).to.be.closeTo(0, 0.05);
    }
  });

  it("returns null when nothing can be simplified", () => {
    const cornered = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0, type: "cubic" },
        { x: 60, y: 30, type: "cubic" },
        { x: 60, y: 60 }, // corner
        { x: 90, y: 60, type: "cubic" },
        { x: 120, y: 90, type: "cubic" },
        { x: 150, y: 90 },
      ],
    };
    expect(simplifyContour(cornered, { tolerance: 1.0 })).to.equal(null);
  });
});

import { simplifyContourCompatible } from "@fontra/core/path-simplification.js";

function scaleContour(contour, factor) {
  return {
    ...contour,
    points: contour.points.map((p) => ({
      ...p,
      x: p.x * factor,
      y: p.y * factor,
    })),
  };
}

describe("simplifyContourCompatible (multi-master)", () => {
  it("two compatible masters receive identical merge boundaries", () => {
    const masterA = oversplit(lensContour);
    const masterB = oversplit(scaleContour(lensContour, 0.8));
    const results = simplifyContourCompatible([masterA, masterB], {
      tolerance: 1.0,
    });
    expect(results).to.not.equal(null);
    expect(results.length).to.equal(2);
    // Both masters merged to the same topology: 4 cubics, 4 on-curve points.
    for (const result of results) {
      const onCurves = result.points.filter((p) => !p.type);
      expect(onCurves.length).to.equal(4);
    }
    // Point types sequence identical across masters.
    const types = results.map((r) => r.points.map((p) => p.type ?? "on"));
    expect(types[0]).to.deep.equal(types[1]);
  });

  it("incompatible masters remain unchanged for the disagreeing run", () => {
    // Master B's first arc is replaced by two cubics joined at an angle:
    // it cannot merge, so no master may merge that run.
    const kinked = {
      isClosed: true,
      points: [
        { x: 0, y: 0, smooth: true },
        { x: 30, y: 0, type: "cubic" },
        { x: 70, y: 0, type: "cubic" },
        { x: 100, y: 60, smooth: true },
        { x: 135, y: 60, type: "cubic" },
        { x: 170, y: 40, type: "cubic" },
        { x: 200, y: 0, smooth: true },
        { x: 170, y: -40, type: "cubic" },
        { x: 135, y: -60, type: "cubic" },
        { x: 100, y: -60, smooth: true },
        { x: 65, y: -60, type: "cubic" },
        { x: 30, y: -40, type: "cubic" },
      ],
    };
    const results = simplifyContourCompatible([oversplit(lensContour), kinked], {
      tolerance: 1.0,
    });
    // Nothing is written when masters disagree.
    expect(results).to.equal(null);
  });
});
