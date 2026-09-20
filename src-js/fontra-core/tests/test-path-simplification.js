import { expect } from "chai";

import {
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
        const expectedRight = cubicPoint(
          points,
          splitT + (1 - splitT) * sampleT
        );
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
