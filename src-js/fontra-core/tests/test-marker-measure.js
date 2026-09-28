import {
  AIM_FALLBACK_LENGTH,
  aimCollapsedRay,
  markerGeometry,
  measureDimension,
  measureRay,
  measureSkeletonAnchor,
  walkRayIntersections,
} from "@fontra/core/marker-measure.js";
import { aimedCast, computeMarkerSignature } from "@fontra/core/marker-model.js";
import { PathHitTester } from "@fontra/core/path-hit-tester.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

function rectContour(x1, y1, x2, y2, clockwise = false) {
  const points = [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
  return { points: clockwise ? points.reverse() : points, isClosed: true };
}

function pathOf(...contours) {
  const path = new VarPackedPath();
  for (const contour of contours) {
    path.appendUnpackedContour(contour);
  }
  return path;
}

function hitTesterFor(path) {
  return new PathHitTester(path, path.getControlBounds());
}

describe("marker-measure — the winding walk", () => {
  it("crosses the interior edge of an overlapping contour", () => {
    // Two overlapping rectangles, 0..100 and 50..200. The black runs to 200, and the
    // shared edges at 50 and 100 are interior: the ray crosses them, it does not stop.
    const path = pathOf(rectContour(0, 0, 100, 100), rectContour(50, 0, 200, 100));
    const measured = measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 });
    expect(measured.distance).to.be.closeTo(200, 0.001);
    expect(measured.farPoint.x).to.be.closeTo(200, 0.001);
  });

  it("stops on entering a counter", () => {
    const path = pathOf(
      rectContour(0, 0, 200, 100),
      rectContour(50, 20, 150, 80, true)
    );
    const measured = measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 });
    expect(measured.distance).to.be.closeTo(50, 0.001);
  });

  it("reports null where the ray never leaves the black", () => {
    // An open contour the ray never crosses. A fabricated distance would be a lie.
    const path = pathOf({
      points: [
        { x: 0, y: 300 },
        { x: 100, y: 300 },
      ],
      isClosed: false,
    });
    expect(measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 })).to.equal(
      null
    );
  });

  it("accumulates winding across a hand-built crossing list", () => {
    const spans = walkRayIntersections([
      { x: 0, y: 0, winding: 1 },
      { x: 10, y: 0, winding: 1 },
      { x: 20, y: 0, winding: -1 },
      { x: 30, y: 0, winding: -1 },
    ]);
    expect(spans.map((span) => span.inside)).to.deep.equal([true, true, true]);
    expect(spans.map((span) => span.distance)).to.deep.equal([10, 10, 10]);
  });

  it("measures a dimension as the plain hypotenuse", () => {
    expect(measureDimension({ x: 0, y: 0 }, { x: 3, y: 4 })).to.equal(5);
  });
});

// A straight centerline running left to right along y = 50. The left side of a skeleton
// contour is the direction of the travel direction turned a quarter clockwise, which for
// this centerline points downward.
function straightSkeleton(singleSided = null) {
  return {
    contours: [
      {
        id: "c1",
        closed: false,
        singleSided,
        points: [
          { id: "p1", x: 0, y: 50 },
          { id: "p2", x: 100, y: 50 },
        ],
      },
    ],
  };
}

const centerlineEnd = { kind: "skeletonPoint", contourId: "c1", pointId: "p1", t: 0.5 };

describe("marker-measure — the skeleton cases", () => {
  it("reports the full stroke width from a double-sided centerline", () => {
    const path = pathOf(rectContour(0, 0, 100, 100));
    const measured = measureSkeletonAnchor(
      hitTesterFor(path),
      centerlineEnd,
      straightSkeleton()
    );
    expect(measured.distance).to.be.closeTo(100, 0.001);
  });

  it("reports one side from a single-sided centerline", () => {
    // The stroke lies below the centerline, which is the left side.
    const path = pathOf(rectContour(0, 0, 100, 50));
    const measured = measureSkeletonAnchor(
      hitTesterFor(path),
      centerlineEnd,
      straightSkeleton("left")
    );
    expect(measured.distance).to.be.closeTo(50, 0.001);
  });

  it("measures an anchor on a generated contour as an ordinary ray", () => {
    const path = pathOf(rectContour(0, 0, 100, 100));
    const measured = measureSkeletonAnchor(
      hitTesterFor(path),
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 0, t: 0.5 },
      straightSkeleton(),
      path
    );
    expect(measured.distance).to.be.closeTo(100, 0.001);
  });

  it("reports null for an anchor that no longer resolves", () => {
    const path = pathOf(rectContour(0, 0, 100, 100));
    const measured = measureSkeletonAnchor(
      hitTesterFor(path),
      { kind: "skeletonPoint", contourId: "gone", pointId: "p1", t: 0.5 },
      straightSkeleton()
    );
    expect(measured).to.equal(null);
  });
});

// A sweep, not an assertion. A per-configuration assertion has missed every fault in
// this project's geometry so far: what matters is that the reported number moves
// smoothly with its driver, not that it equals a particular value at one configuration.
//
// Each sweep starts away from a degenerate configuration, because a sweep that begins at
// a zero-length or coincident state reports its own seed as a large jump.

describe("marker-measure — sweeps", () => {
  it("the anchor rides a moving neighbour without jumping", () => {
    // The right wall of a stem walks right in fine steps. A ray across the stem must
    // follow it step for step: the anchor is a parameter on a curve, and the curve is
    // read live.
    const STEP = 1;
    const STEPS = 200;
    let previous = null;
    let worst = 0;
    for (let i = 0; i < STEPS; i++) {
      const right = 120 + i * STEP;
      const path = pathOf(rectContour(0, 0, right, 100));
      const measured = measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 });
      expect(measured).to.not.equal(null);
      if (previous !== null) {
        worst = Math.max(worst, Math.abs(measured.distance - previous - STEP));
      }
      previous = measured.distance;
    }
    // The reported distance moves exactly as far as its driver does, every step.
    expect(worst).to.be.lessThan(1e-6);
  });

  it("a dragged anchor crosses a segment joint without jumping", () => {
    // The anchor walks along the bottom edge of a rectangle, across the corner and up
    // the right edge. The measured distance changes shape at the corner, as the
    // geometry does, but never jumps: the worst single step stays within what one step
    // of the driver can account for.
    const path = pathOf(rectContour(0, 0, 300, 100));
    const hitTester = hitTesterFor(path);
    const STEP = 1;
    let previous = null;
    let worst = 0;
    for (let x = 20; x <= 280; x += STEP) {
      const measured = measureRay(hitTester, { x, y: 0 }, { x: 0, y: 1 });
      expect(measured).to.not.equal(null);
      if (previous !== null) {
        worst = Math.max(worst, Math.abs(measured.distance - previous));
      }
      previous = measured.distance;
    }
    // Along a straight edge of a rectangle the measured height is constant, so no step
    // may move it at all.
    expect(worst).to.be.lessThan(1e-6);
  });

  it("a ray on a slanted edge follows its anchor smoothly", () => {
    // A wedge, so the measured distance genuinely changes as the anchor walks. The
    // reported number must change no faster than the geometry does — the slope here is
    // one unit of height per two units along.
    const path = pathOf({
      points: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 200 },
      ],
      isClosed: true,
    });
    const hitTester = hitTesterFor(path);
    const STEP = 1;
    let previous = null;
    let worst = 0;
    for (let x = 20; x <= 380; x += STEP) {
      const measured = measureRay(hitTester, { x, y: 0 }, { x: 0, y: 1 });
      expect(measured).to.not.equal(null);
      if (previous !== null) {
        worst = Math.max(worst, Math.abs(measured.distance - previous));
      }
      previous = measured.distance;
    }
    expect(worst).to.be.lessThan(0.51);
  });
});

describe("marker-measure — a freshly placed marker", () => {
  // A ray's far end is a cast: it resolves to nothing on purpose, and reading that as a
  // failure made every ray stale the instant it was placed.
  it("is not stale, and reports its measurement", () => {
    const path = pathOf(rectContour(0, 0, 100, 200));
    const glyphController = {
      flattenedPath: path,
      flattenedPathHitTester: hitTesterFor(path),
    };
    const marker = {
      id: "m1",
      ends: [
        {
          kind: "pathSegment",
          contourIndex: 0,
          segmentIndex: 0,
          t: 0.5,
          at: { x: 50, y: 0 },
        },
        { kind: "cast" },
      ],
      signature: computeMarkerSignature(path),
    };
    const geometry = markerGeometry(glyphController, marker, null);
    expect(geometry.stale).to.equal(false);
    expect(geometry.distance).to.be.closeTo(200, 0.001);
  });

  it("is stale when it is free of the outline entirely", () => {
    const path = pathOf(rectContour(0, 0, 100, 200));
    const glyphController = {
      flattenedPath: path,
      flattenedPathHitTester: hitTesterFor(path),
    };
    const marker = {
      id: "m1",
      ends: [{ kind: "free", x: 400, y: 400 }, { kind: "cast" }],
      signature: computeMarkerSignature(path),
    };
    const geometry = markerGeometry(glyphController, marker, null);
    expect(geometry.stale).to.equal(true);
    expect(geometry.distance).to.equal(null);
  });
});

// An aimed ray leaves its anchor at an angle the designer set by dragging, not along the
// normal. It exists for the places the normal cannot measure: a corner under 90 degrees,
// where the normal of either arm points outside the black.
describe("marker-measure — an aimed ray", () => {
  function glyphFor(path) {
    return { flattenedPath: path, flattenedPathHitTester: hitTesterFor(path) };
  }

  function rayOn(path, segmentIndex, t, cast) {
    return {
      id: "m1",
      ends: [{ kind: "pathSegment", contourIndex: 0, segmentIndex, t }, cast],
      signature: computeMarkerSignature(path),
    };
  }

  it("measures along its angle, not along the normal", () => {
    // The left edge of a square, 0..100, runs down from (0, 100) to (0, 0) as the
    // fourth segment. Aimed at 45 degrees from its middle it meets the top at (50, 100).
    const path = pathOf(rectContour(0, 0, 100, 100));
    const geometry = markerGeometry(
      glyphFor(path),
      rayOn(path, 3, 0.5, aimedCast({ x: 1, y: 1 })),
      null
    );
    expect(geometry.distance).to.be.closeTo(Math.hypot(50, 50), 1e-6);
    expect(geometry.farPoint.x).to.be.closeTo(50, 1e-6);
    expect(geometry.farPoint.y).to.be.closeTo(100, 1e-6);
  });

  it("offers its arrow as a grip on the cast end", () => {
    const path = pathOf(rectContour(0, 0, 100, 100));
    const geometry = markerGeometry(
      glyphFor(path),
      rayOn(path, 3, 0.5, aimedCast({ x: 1, y: 0 })),
      null
    );
    expect(geometry.grips).to.have.length(2);
    expect(geometry.grips[0].endIndex).to.equal(undefined);
    expect(geometry.grips[1]).to.deep.include({ endIndex: 1 });
    expect(geometry.grips[1].point.x).to.be.closeTo(100, 1e-6);
  });

  it("keeps a grabbable arrow where it measures nothing", () => {
    // Aimed straight out of the square: the ray never enters the black.
    const path = pathOf(rectContour(0, 0, 100, 100));
    const geometry = markerGeometry(
      glyphFor(path),
      rayOn(path, 3, 0.5, aimedCast({ x: -1, y: 0 })),
      null
    );
    expect(geometry.stale).to.equal(false);
    expect(geometry.distance).to.equal(null);
    expect(geometry.grips[1].endIndex).to.equal(1);
    expect(geometry.grips[1].point.x).to.be.closeTo(-AIM_FALLBACK_LENGTH, 1e-6);
  });

  it("leaves a plain ray with no grip on its cast end", () => {
    const path = pathOf(rectContour(0, 0, 100, 100));
    const geometry = markerGeometry(
      glyphFor(path),
      rayOn(path, 3, 0.5, { kind: "cast" }),
      null
    );
    expect(geometry.grips.every((grip) => grip.endIndex === undefined)).to.equal(true);
  });
});

// Measured on `b.json` of skeletron-test: a ray on the corner at (12, 364) measured
// nothing. The corner is 89 degrees, so the normal of either arm points 0.9 degrees
// outside the black. A ray the normal cannot measure becomes an aimed ray on the
// nearest on-curve point, which the designer then aims.
describe("marker-measure — a collapsed ray", () => {
  // The corner at the origin: one arm runs out to (100, 2), the other down to (1, -26).
  function acuteCornerPath() {
    return pathOf({
      points: [
        { x: 100, y: 2 },
        { x: 0, y: 0 },
        { x: 1, y: -26 },
        { x: 100, y: -26 },
      ],
      isClosed: true,
    });
  }

  it("becomes an aimed ray on the nearest on-curve point, and measures", () => {
    const path = acuteCornerPath();
    const hitTester = hitTesterFor(path);
    const ends = [
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 1, t: 0 },
      { kind: "cast" },
    ];
    const aimed = aimCollapsedRay(ends, path, hitTester);
    expect(aimed).to.not.equal(null);
    expect(aimed[1].kind).to.equal("cast");
    expect(aimed[1].angle).to.be.a("number");
    const geometry = markerGeometry(
      { flattenedPath: path, flattenedPathHitTester: hitTester },
      { id: "m1", ends: aimed, signature: computeMarkerSignature(path) },
      null
    );
    expect(geometry.anchorPoint.x).to.be.closeTo(0, 1e-9);
    expect(geometry.anchorPoint.y).to.be.closeTo(0, 1e-9);
    expect(geometry.distance).to.be.greaterThan(10);
  });

  it("leaves a ray that measures alone", () => {
    const path = acuteCornerPath();
    const ends = [
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 2, t: 0.5 },
      { kind: "cast" },
    ];
    expect(aimCollapsedRay(ends, path, hitTesterFor(path))).to.equal(null);
  });

  it("leaves an aimed ray alone, whatever it measures", () => {
    const path = acuteCornerPath();
    const ends = [
      { kind: "pathSegment", contourIndex: 0, segmentIndex: 1, t: 0 },
      aimedCast({ x: -1, y: 0 }),
    ];
    expect(aimCollapsedRay(ends, path, hitTesterFor(path))).to.equal(null);
  });
});
