import { expect } from "chai";

import {
  buildSimplifyRuns,
  classifySimplifyContour,
  contourToCubicPieces,
  cubicDerivative,
  cubicExtremaParameters,
  cubicPoint,
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
    const contour = {
      isClosed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10, type: "cubic" },
        { x: 20, y: 10, type: "cubic" },
        { x: 30, y: 10, smooth: true },
        { x: 40, y: 10, type: "cubic" },
        { x: 50, y: 10, type: "cubic" },
        { x: 60, y: 0 },
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
    const simplified = simplifyContour(openContour, { tolerance: 1.0 });
    expect(simplified).to.not.equal(null);
    expect(simplified.isClosed).to.be.false;
    expectPointClose(simplified.points[0], 0, 0);
    expectPointClose(simplified.points.at(-1), 200, 0);
    // The two halves merge into a single cubic.
    const onCurves = simplified.points.filter((p) => !p.type);
    expect(onCurves.length).to.equal(2);
  });

  it("preserves closed state and winding direction", () => {
    const simplified = simplifyContour(lensContour, { tolerance: 1.0 });
    expect(simplified).to.not.equal(null);
    expect(simplified.isClosed).to.be.true;
    expect(Math.sign(signedArea(simplified))).to.equal(
      Math.sign(signedArea(lensContour))
    );
    // Two arcs: 4 segments merge into 2.
    const onCurves = simplified.points.filter((p) => !p.type);
    expect(onCurves.length).to.equal(2);
  });

  it("keeps attrs on a surviving protected point", () => {
    const contour = {
      isClosed: true,
      points: lensContour.points.map((p, i) =>
        i === 6 ? { ...p, attrs: { note: "keep" } } : { ...p }
      ),
    };
    const simplified = simplifyContour(contour, { tolerance: 1.0 });
    const withAttrs = simplified.points.filter((p) => p.attrs?.note === "keep");
    expect(withAttrs.length).to.equal(1);
    expectPointClose(withAttrs[0], 200, 0);
  });

  it("repeating simplify produces no additional change", () => {
    const once = simplifyContour(lensContour, { tolerance: 1.0 });
    // null = no change; the simplified contour is a fixed point.
    expect(simplifyContour(once, { tolerance: 1.0 })).to.equal(null);
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
    const masterA = lensContour;
    const masterB = scaleContour(lensContour, 0.8);
    const results = simplifyContourCompatible([masterA, masterB], {
      tolerance: 1.0,
    });
    expect(results).to.not.equal(null);
    expect(results.length).to.equal(2);
    // Both masters merged to the same topology: 2 cubics, 2 on-curve points.
    for (const result of results) {
      const onCurves = result.points.filter((p) => !p.type);
      expect(onCurves.length).to.equal(2);
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
    const results = simplifyContourCompatible([lensContour, kinked], {
      tolerance: 1.0,
    });
    // Nothing is written when masters disagree.
    expect(results).to.equal(null);
  });
});
