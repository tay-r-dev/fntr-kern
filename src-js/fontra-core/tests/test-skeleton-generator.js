import {
  generateFromSkeleton,
  outlineContourToPackedPath,
} from "@fontra/core/skeleton-generator.js";
import { packContour } from "@fontra/core/var-path.js";
import { expect } from "chai";

import { readRepoPathAsJSON } from "./test-support.js";

// The recorded outlines this generator currently emits. Regenerate with
// tests/scripts/make-skeleton-generator-fixtures.js.
const fixtures = readRepoPathAsJSON("tests/data/skeleton-generator/fixtures.json");

describe("skeleton-generator golden master", () => {
  for (const fixture of fixtures) {
    it(`matches the recorded outline for ${fixture.name}`, () => {
      const result = generateFromSkeleton(fixture.canonical);
      expect(roundContours(result.contours)).to.deep.equal(
        roundContours(fixture.expectedContours)
      );
    });
  }

  it("outlineContourToPackedPath matches packContour", () => {
    const contour = fixtures[0].expectedContours[0];
    expect(outlineContourToPackedPath(contour)).to.deep.equal(packContour(contour));
  });
});

describe("skeleton-generator provenance", () => {
  it("emits contour-level provenance keyed by skeleton contour id", () => {
    const fixture = fixtures.find((item) => item.name === "open-line-butt-cap");
    const result = generateFromSkeleton(fixture.canonical);
    expect(result.provenance).to.have.length(result.contours.length);
    expect(result.provenance[0]).to.include({
      skeletonContourId: 1,
      generatedContourIndex: 0,
    });
    expect(result.provenance[0].pointMap).to.have.length(
      result.contours[0].points.length
    );
  });

  it("maps generated points to stable skeleton point ids and roles", () => {
    const fixture = fixtures.find((item) => item.name === "open-cubic-round-cap");
    const result = generateFromSkeleton(fixture.canonical);
    const pointMaps = result.provenance.flatMap((entry) => entry.pointMap);
    expect(pointMaps.some((entry) => entry?.skeletonPointId === 2)).to.equal(true);
    expect(pointMaps.some((entry) => entry?.skeletonPointId === 5)).to.equal(true);
    expect(pointMaps.some((entry) => entry?.role === "onCurve")).to.equal(true);
    expect(pointMaps.some((entry) => entry?.role === "in")).to.equal(true);
    expect(pointMaps.some((entry) => entry?.role === "out")).to.equal(true);
  });

  it("does not persist private provenance on output contour points", () => {
    const fixture = fixtures.find((item) => item.name === "open-line-butt-cap");
    const result = generateFromSkeleton(fixture.canonical);
    expect(
      result.contours.some((contour) =>
        contour.points.some((point) => Object.hasOwn(point, "_provenance"))
      )
    ).to.equal(false);
  });

  it("keeps the smooth-junction handle axis independent of rib width", () => {
    // A smooth skeleton point has colinear handles, so both generated handles
    // beside it are constructed on that one axis. Rib width may change their
    // LENGTH but must never rotate them: the axis previously came from a
    // length-weighted average of the two rounded handle directions, so every
    // width change rotated it (measured: 1.1 deg mean, 12.5 deg worst, per
    // single unit of width).
    const axesByWidth = [];
    for (const halfWidth of [5, 6, 7, 12, 20, 28, 35]) {
      axesByWidth.push(smoothJunctionAxes(smoothJunctionSkeleton(halfWidth)));
    }
    for (const axes of axesByWidth) {
      expect(axes, "a smooth junction with two handles on each side").to.have.length(2);
    }
    for (const axes of axesByWidth.slice(1)) {
      for (const [index, axis] of axes.entries()) {
        expect(axis.angle, `axis ${index} angle`).to.be.closeTo(
          axesByWidth[0][index].angle,
          1e-6
        );
      }
    }
  });

  it("keeps generated handles exactly colinear across a smooth junction", () => {
    for (const halfWidth of [5, 12, 20, 35]) {
      for (const axis of smoothJunctionAxes(smoothJunctionSkeleton(halfWidth))) {
        // Anti-parallel to within floating point, not merely within the 2.5 deg
        // the old length-weighted gate allowed through.
        expect(axis.misalignmentDegrees, `half-width ${halfWidth}`).to.be.closeTo(
          0,
          1e-6
        );
      }
    }
  });

  it("emits side-bearing on-curve provenance for every rib point", () => {
    const fixture = fixtures.find((item) => item.name === "open-line-butt-cap");
    const result = generateFromSkeleton(fixture.canonical);
    const pointMaps = result.provenance.flatMap((entry) => entry.pointMap);
    for (const skeletonPointId of [2, 3]) {
      for (const side of ["left", "right"]) {
        expect(
          pointMaps.some(
            (entry) =>
              entry?.skeletonPointId === skeletonPointId &&
              entry.side === side &&
              entry.role === "onCurve"
          ),
          `onCurve ${skeletonPointId}/${side}`
        ).to.equal(true);
      }
    }
  });

  it("emits side-bearing handle provenance adjacent to skeleton on-curves", () => {
    // Butt-cap variant: split-outline round caps (3.4) consume the terminal
    // side segment, so terminal handle provenance only survives on cap styles
    // that keep the side outline intact.
    const fixture = fixtures.find((item) => item.name === "open-cubic-butt-cap");
    const result = generateFromSkeleton(fixture.canonical);
    const pointMaps = result.provenance.flatMap((entry) => entry.pointMap);
    for (const side of ["left", "right"]) {
      expect(
        pointMaps.some(
          (entry) =>
            entry?.skeletonPointId === 2 && entry.side === side && entry.role === "out"
        ),
        `out handle 2/${side}`
      ).to.equal(true);
      expect(
        pointMaps.some(
          (entry) =>
            entry?.skeletonPointId === 5 && entry.side === side && entry.role === "in"
        ),
        `in handle 5/${side}`
      ).to.equal(true);
    }
  });
});

describe("skeleton-generator corner rounding input", () => {
  function makeAnglePointSkeleton(cornerFields = {}) {
    // open polyline with a sharp angle at the middle point
    return {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false },
            { id: 3, x: 100, y: 0, type: null, smooth: false, ...cornerFields },
            { id: 4, x: 100, y: 100, type: null, smooth: false },
          ],
        },
      ],
      generated: [],
    };
  }

  it("corner rounding parameters change the generated outline", () => {
    const plain = generateFromSkeleton(makeAnglePointSkeleton());
    const rounded = generateFromSkeleton(
      makeAnglePointSkeleton({ cornerRoundness: 0.8, cornerReach: 0.6 })
    );
    expect(rounded.contours).to.not.deep.equal(plain.contours);
  });
});

describe("skeleton-generator round caps", () => {
  // Regression: round caps on line terminal segments threw in bezier-js
  // (linear beziers must be constructed with the point[] form).
  it("generates round caps on straight-line terminal segments", () => {
    const skeleton = {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 60,
          singleSided: null,
          points: [
            {
              id: 2,
              x: 0,
              y: 0,
              type: null,
              smooth: false,
              capStyle: "round",
              capRadiusRatio: 1 / 8,
              capTension: 0.55,
            },
            { id: 3, x: 200, y: 0, type: null, smooth: false },
            { id: 4, x: 400, y: 50, type: null, smooth: false },
          ],
        },
      ],
      generated: [],
    };
    const generated = generateFromSkeleton(skeleton);
    expect(generated.contours.length).to.equal(1);
  });

  // Regression: the round-cap terminal split rebuilt the trimmed segment
  // without provenance, so the endpoint-facing generated handles of the
  // neighboring skeleton point lost their side/role attribution and stopped
  // being addressable (editable handles next to a round cap unselectable).
  it("keeps provenance on handles next to a round-capped endpoint", () => {
    const skeleton = {
      version: 1,
      nextId: 20,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 60,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false },
            { id: 3, x: 60, y: 10, type: "cubic" },
            { id: 4, x: 140, y: 30, type: "cubic" },
            { id: 5, x: 200, y: 50, type: null, smooth: true },
            { id: 6, x: 260, y: 70, type: "cubic" },
            { id: 7, x: 340, y: 90, type: "cubic" },
            {
              id: 8,
              x: 400,
              y: 100,
              type: null,
              smooth: false,
              capStyle: "round",
              capRadiusRatio: 1 / 8,
              capTension: 0.55,
            },
          ],
        },
      ],
      generated: [],
    };
    const { provenance } = generateFromSkeleton(skeleton);
    const pointMap = provenance[0].pointMap;
    for (const side of ["left", "right"]) {
      const entry = pointMap.find(
        (item) =>
          item?.skeletonPointId === 5 && item.side === side && item.role === "out"
      );
      expect(entry, `point 5 ${side} out`).to.not.equal(undefined);
    }
  });
});

describe("skeleton-generator drop caps", () => {
  function makeDropSkeleton(endpointFields = {}, points = null) {
    return {
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: points || [
            { id: 2, x: 0, y: 0, type: null, smooth: false },
            { id: 3, x: 200, y: 0, type: null, smooth: false },
            {
              id: 4,
              x: 400,
              y: 60,
              type: null,
              smooth: false,
              capStyle: "drop",
              ...endpointFields,
            },
          ],
        },
      ],
      generated: [],
    };
  }

  function allFinite(result) {
    return result.contours
      .flatMap((contour) => contour.points)
      .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  function vectorNormalize(v) {
    const length = Math.hypot(v.x, v.y);
    return { x: v.x / length, y: v.y / length };
  }

  // Control points overshoot the curve, so extents have to be read off samples
  // of the outline itself.
  function sampleContourPoints(points) {
    const count = points.length;
    const isOnCurve = (point) => !point.type;
    const samples = [];
    let index = points.findIndex(isOnCurve);
    let consumed = 0;
    while (consumed < count) {
      const anchor = points[index % count];
      const next = points[(index + 1) % count];
      if (isOnCurve(next)) {
        samples.push(anchor, next);
        index = (index + 1) % count;
        consumed += 1;
        continue;
      }
      const handle2 = points[(index + 2) % count];
      const end = points[(index + 3) % count];
      for (let step = 0; step <= 24; step++) {
        const t = step / 24;
        const m = 1 - t;
        samples.push({
          x:
            m ** 3 * anchor.x +
            3 * m * m * t * next.x +
            3 * m * t * t * handle2.x +
            t ** 3 * end.x,
          y:
            m ** 3 * anchor.y +
            3 * m * m * t * next.y +
            3 * m * t * t * handle2.y +
            t ** 3 * end.y,
        });
      }
      index = (index + 3) % count;
      consumed += 3;
    }
    return samples;
  }

  function horizontalDrop(capFields) {
    // Horizontal stroke (width 80) ending at (440, 120): outer edge y=80, inner
    // edge y=160, terminal cross-section at x=440.
    return {
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            { id: 2, x: 40, y: 120, type: null, smooth: false },
            { id: 3, x: 240, y: 120, type: null, smooth: false },
            {
              id: 4,
              x: 440,
              y: 120,
              type: null,
              smooth: false,
              capStyle: "drop",
              ...capFields,
            },
          ],
        },
      ],
      generated: [],
    };
  }

  it("produces a finite closed contour on a straight terminal", () => {
    const result = generateFromSkeleton(makeDropSkeleton());
    expect(result.contours.length).to.equal(1);
    expect(result.contours[0].isClosed).to.equal(true);
    expect(allFinite(result)).to.equal(true);
  });

  it("differs from a butt cap (the ball adds outline points)", () => {
    const drop = generateFromSkeleton(makeDropSkeleton());
    const butt = generateFromSkeleton(makeDropSkeleton({ capStyle: "butt" }));
    expect(drop.contours[0].points.length).to.be.greaterThan(
      butt.contours[0].points.length
    );
  });

  it("scales the ball with capBallRatio", () => {
    const boundsSpan = (result) => {
      const xs = result.contours[0].points.map((p) => p.x);
      const ys = result.contours[0].points.map((p) => p.y);
      return Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
    };
    const small = generateFromSkeleton(makeDropSkeleton({ capBallRatio: 0.8 }));
    const big = generateFromSkeleton(makeDropSkeleton({ capBallRatio: 2.5 }));
    expect(boundsSpan(big)).to.be.greaterThan(boundsSpan(small));
  });

  it("the capBallSide override changes which side swells", () => {
    const left = generateFromSkeleton(makeDropSkeleton({ capBallSide: "left" }));
    const right = generateFromSkeleton(makeDropSkeleton({ capBallSide: "right" }));
    expect(left.contours[0].points).to.not.deep.equal(right.contours[0].points);
    expect(allFinite(left)).to.equal(true);
    expect(allFinite(right)).to.equal(true);
  });

  it("handles a curved terminal (auto side inference)", () => {
    const result = generateFromSkeleton(
      makeDropSkeleton({}, [
        { id: 2, x: 0, y: 0, type: null, smooth: false },
        { id: 3, x: 120, y: 40, type: "cubic" },
        { id: 4, x: 260, y: 60, type: "cubic" },
        { id: 5, x: 380, y: 40, type: null, smooth: false, capStyle: "drop" },
      ])
    );
    expect(result.contours.length).to.equal(1);
    expect(allFinite(result)).to.equal(true);
  });

  // Where the outline rejoins the inner edge (y=160) behind the ball: the
  // smaller the x, the further back the neck reaches.
  function neckRejoinX(capFields) {
    const points = generateFromSkeleton(horizontalDrop(capFields)).contours[0].points;
    // The trim removes everything forward of the rejoin, so it is the
    // furthest-forward on-curve left on the inner edge.
    const nearEdge = points.filter((p) => !p.type && Math.abs(p.y - 160) <= 2);
    return Math.max(...nearEdge.map((p) => p.x));
  }

  // Furthest the outline reaches along the stroke.
  function tipReach(capFields) {
    const points = generateFromSkeleton(horizontalDrop(capFields)).contours[0].points;
    return Math.max(...sampleContourPoints(points).map((p) => p.x));
  }

  it("never reaches past the terminal — same length as a butt cap", () => {
    // The whole point of pulling the ball back onto the terminal: whatever the
    // ball size, shape or tension, the drop cap must not lengthen the stroke.
    const buttReach = tipReach({ capStyle: "butt" });
    expect(buttReach).to.be.closeTo(440, 0.5);
    for (const capFields of [
      {},
      { capBallRatio: 0.8 },
      { capBallRatio: 2 },
      { capBallRatio: 3 },
      { capBallShape: 0.5 },
      { capBallShape: 1 },
      { capTension: 0 },
      { capTension: 3 },
      { capBallShape: 1, capTension: 3 },
    ]) {
      expect(tipReach(capFields), JSON.stringify(capFields)).to.be.closeTo(
        buttReach,
        0.5
      );
    }
  });

  it("never reaches past the terminal on a curved terminal either", () => {
    // Measured along the outward tangent, since the terminal plane is no longer
    // vertical here.
    const curvedPoints = [
      { id: 2, x: 60, y: 250, type: null, smooth: false },
      { id: 3, x: 160, y: 110, type: "cubic" },
      { id: 4, x: 300, y: 60, type: "cubic" },
      { id: 5, x: 430, y: 90, type: null, smooth: false, capStyle: "drop" },
    ];
    const tangent = vectorNormalize({ x: 430 - 300, y: 90 - 60 });
    const overshoot = (capFields) => {
      const points = generateFromSkeleton(
        makeDropSkeleton(
          {},
          curvedPoints.map((point, index) =>
            index === curvedPoints.length - 1 ? { ...point, ...capFields } : point
          )
        )
      ).contours[0].points;
      return Math.max(
        ...sampleContourPoints(points).map(
          (p) => (p.x - 430) * tangent.x + (p.y - 90) * tangent.y
        )
      );
    };
    expect(overshoot({ capStyle: "butt" })).to.be.closeTo(0, 0.5);
    for (const capFields of [
      { capStyle: "drop" },
      { capStyle: "drop", capBallShape: 1 },
      { capStyle: "drop", capBallRatio: 2, capTension: 1 },
      { capStyle: "drop", capBallRatio: 3, capBallShape: 1, capTension: 3 },
    ]) {
      expect(overshoot(capFields), JSON.stringify(capFields)).to.be.lessThan(0.5);
    }
  });

  it("capTension eases the neck further back along the inner edge", () => {
    // The neck rejoins the inner edge further back as tension rises, and must
    // ease in from above — no valley cutting below the edge.
    const crisp = neckRejoinX({ capTension: 0 });
    const soft = neckRejoinX({ capTension: 0.9 });
    expect(soft).to.be.lessThan(crisp - 10);

    const points = generateFromSkeleton(horizontalDrop({ capTension: 0.9 })).contours[0]
      .points;
    // The neck region: behind where the ball leaves the outer edge, and above
    // the skeleton axis (so neither the outer edge at y=80 nor the ball's front
    // arc counts as a "dip").
    const leaveOuterX = Math.max(
      ...points.filter((p) => !p.type && Math.abs(p.y - 80) <= 0.6).map((p) => p.x)
    );
    const neck = sampleContourPoints(points).filter(
      (p) => p.y > 120 && p.x >= soft && p.x <= leaveOuterX
    );
    expect(Math.min(...neck.map((p) => p.y))).to.be.gte(159.5);
  });

  it("capTension keeps reaching back well past 1", () => {
    expect(neckRejoinX({ capTension: 1.5 })).to.be.lessThan(
      neckRejoinX({ capTension: 1 })
    );
    expect(neckRejoinX({ capTension: 3 })).to.be.lessThan(
      neckRejoinX({ capTension: 1.5 })
    );
  });

  it("capBallShape stretches the ball backward without resizing it", () => {
    // A teardrop, not a bigger ball: the swell is unchanged, but it leaves the
    // outer edge earlier and tapers back further along the inner edge.
    const swell = (shape) => {
      const points = generateFromSkeleton(horizontalDrop({ capBallShape: shape }))
        .contours[0].points;
      const samples = sampleContourPoints(points);
      const outerEdge = points.filter((p) => !p.type && Math.abs(p.y - 80) <= 0.6);
      return {
        maxY: Math.max(...samples.map((p) => p.y)),
        leaveOuterX: Math.max(...outerEdge.map((p) => p.x)),
      };
    };
    const round = swell(0);
    const half = swell(0.5);
    const full = swell(1);
    // Lateral swell (the ball's actual size) is untouched...
    expect(half.maxY).to.be.closeTo(round.maxY, 0.5);
    expect(full.maxY).to.be.closeTo(round.maxY, 0.5);
    // ...while the ball starts further back along the stroke.
    expect(half.leaveOuterX).to.be.lessThan(round.leaveOuterX - 10);
    expect(full.leaveOuterX).to.be.lessThan(half.leaveOuterX - 10);
    expect(neckRejoinX({ capBallShape: 1 })).to.be.lessThan(
      neckRejoinX({ capBallShape: 0 }) - 10
    );
  });

  it("capBallShape 0 leaves the round ball unchanged", () => {
    const round = generateFromSkeleton(makeDropSkeleton());
    const shaped = generateFromSkeleton(makeDropSkeleton({ capBallShape: 0 }));
    expect(shaped.contours[0].points).to.deep.equal(round.contours[0].points);
  });

  it("works on the start endpoint too", () => {
    const result = generateFromSkeleton(
      makeDropSkeleton({}, [
        {
          id: 2,
          x: 0,
          y: 0,
          type: null,
          smooth: false,
          capStyle: "drop",
        },
        { id: 3, x: 200, y: 0, type: null, smooth: false },
        { id: 4, x: 400, y: 60, type: null, smooth: false },
      ])
    );
    expect(result.contours.length).to.equal(1);
    expect(allFinite(result)).to.equal(true);
  });
});

describe("skeleton-generator near-zero handle stabilization", () => {
  it("does not flip near-zero handles across the anchor", () => {
    const skeleton = {
      version: 1,
      nextId: 6,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            {
              id: 2,
              x: 0,
              y: 0,
              type: null,
              smooth: false,
              width: { left: 40, right: 40, linked: true },
              nudge: { left: 0, right: 0 },
              editable: { left: false, right: false },
              handleOffsets: {},
            },
            { id: 3, x: 0.00001, y: 0, type: "cubic", smooth: false },
            { id: 4, x: 120, y: 40, type: "cubic", smooth: false },
            {
              id: 5,
              x: 160,
              y: 0,
              type: null,
              smooth: false,
              width: { left: 40, right: 40, linked: true },
              nudge: { left: 0, right: 0 },
              editable: { left: false, right: false },
              handleOffsets: {},
            },
          ],
        },
      ],
      generated: [],
    };

    const result = generateFromSkeleton(skeleton);
    const allPoints = result.contours.flatMap((contour) => contour.points);
    for (const point of allPoints) {
      expect(Number.isFinite(point.x)).to.equal(true);
      expect(Number.isFinite(point.y)).to.equal(true);
    }
  });
});

// Two cubic segments meeting at a smooth on-curve point (id 5), whose skeleton
// handles (ids 4 and 6) are exactly colinear through it.
function smoothJunctionSkeleton(halfWidth) {
  const onCurve = (id, x, y, smooth) => ({
    id,
    x,
    y,
    type: null,
    smooth,
    width: { left: halfWidth, right: halfWidth, linked: true },
    nudge: { left: 0, right: 0 },
    editable: { left: false, right: false },
    handleOffsets: {},
  });
  const offCurve = (id, x, y) => ({ id, x, y, type: "cubic", smooth: false });
  return {
    version: 1,
    nextId: 9,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: halfWidth * 2,
        singleSided: null,
        points: [
          onCurve(2, 0, 0, false),
          offCurve(3, 20, 40),
          offCurve(4, 50, 40),
          onCurve(5, 60, 60, true),
          offCurve(6, 70, 80),
          offCurve(7, 100, 100),
          onCurve(8, 120, 60, false),
        ],
      },
    ],
    generated: [],
  };
}

// For each generated smooth on-curve point flanked by two off-curve handles:
// the incoming handle's angle and how far from anti-parallel the pair sits.
function smoothJunctionAxes(skeleton) {
  const axes = [];
  for (const contour of generateFromSkeleton(skeleton).contours) {
    const points = contour.points;
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i];
      if (point.type || !point.smooth) continue;
      const previous = points[i - 1];
      const next = points[i + 1];
      if (!previous.type || !next.type) continue;
      const angleIn = Math.atan2(previous.y - point.y, previous.x - point.x);
      const angleOut = Math.atan2(next.y - point.y, next.x - point.x);
      axes.push({
        angle: (angleIn * 180) / Math.PI,
        misalignmentDegrees: Math.abs(
          (Math.abs(angleIn - angleOut) * 180) / Math.PI - 180
        ),
      });
    }
  }
  return axes;
}

function roundContours(contours) {
  return contours.map((contour) => ({
    isClosed: contour.isClosed === true,
    points: contour.points.map((point) => {
      const rounded = {
        x: round(point.x),
        y: round(point.y),
      };
      if (point.type) rounded.type = point.type;
      if (point.smooth) rounded.smooth = true;
      return rounded;
    }),
  }));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
