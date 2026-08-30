import {
  generateFromSkeleton,
  outlineContourToPackedPath,
  removeCollapsedOutlinePoints,
} from "@fontra/core/skeleton-generator.js";
import {
  SERIF_HALF_FIELDS,
  calculateGeneratedCurvatureEdits,
  normalizeSkeletonData,
} from "@fontra/core/skeleton-model.js";
import { calculateSegmentTension } from "@fontra/core/tunni-calculations.js";
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

  it("leaves a generated handle fixed when its rib point is nudged", () => {
    // Nudge is a pure post-step on emitted on-curves. Handles remain in the
    // construction space where the fit, adjustments, and pin all live.
    const base = nudgedRibGeometry(0);
    for (const nudge of [5, 10, 17]) {
      const moved = nudgedRibGeometry(nudge);
      expect(moved.handle, `nudge ${nudge}`).to.deep.equal(base.handle);
    }
  });

  it("leaves both generated handles fixed when a smooth rib point is nudged", () => {
    const base = smoothJunctionPositions(0);
    for (const nudge of [5, 10, 17]) {
      const moved = smoothJunctionPositions(nudge);
      expect(moved.in, `incoming handle at nudge ${nudge}`).to.deep.equal(base.in);
      expect(moved.out, `outgoing handle at nudge ${nudge}`).to.deep.equal(base.out);
    }
  });

  it("publishes the on-curve nudge vector in provenance", () => {
    const base = nudgedRibGeometry(0);
    const moved = nudgedRibGeometry(17);
    expect(base.onCurveProvenance).to.not.have.property("nudge");
    expect(moved.onCurveProvenance.nudge.x).to.be.closeTo(
      moved.onCurve.x - base.onCurve.x,
      1
    );
    expect(moved.onCurveProvenance.nudge.y).to.be.closeTo(
      moved.onCurve.y - base.onCurve.y,
      1
    );
  });

  it("holds a construction-space pin through nudge and handle adjustments", () => {
    const options = {
      pin: 0.55,
      startHandleOffsets: { leftOut: { x: 7, y: -3, detached: false } },
      endHandleOffsets: { leftIn: { x: -5, y: 4, detached: false } },
    };
    const base = nudgedRibGeometry(0, options);
    const moved = nudgedRibGeometry(17, options);
    expect(moved.segmentPoints[1]).to.deep.equal(base.segmentPoints[1]);
    expect(moved.segmentPoints[2]).to.deep.equal(base.segmentPoints[2]);
    for (const geometry of [base, moved]) {
      const constructionPoints = geometry.segmentPoints.map((point, index) =>
        index === 0 || index === 3
          ? {
              x: point.x - (geometry.provenance[index].nudge?.x ?? 0),
              y: point.y - (geometry.provenance[index].nudge?.y ?? 0),
            }
          : point
      );
      expect(
        calculateSegmentTension(
          constructionPoints[1],
          constructionPoints[0],
          constructionPoints[2],
          constructionPoints[3]
        )
      ).to.be.closeTo(0.55, 0.02);
    }
  });

  it("keeps handles fixed when width changes across a mutually-controlled straight", () => {
    // A smooth point with only one handle takes its direction from the straight
    // segment on its other side, so two such points joined by a straight define
    // each other. Their ribs are locked parallel and share an offset; adjusting
    // either width moves both together. Without that, the generated rib-to-rib
    // line tilts and the handles, which stay colinear with it, rotate with width
    // — measured at 8.5 deg of drift over a width sweep, the two sides shearing
    // in opposite directions.
    const straightAngle = (Math.atan2(100 - 60, 140 - 60) * 180) / Math.PI;
    for (const halfWidth of [8, 12, 20, 27, 34]) {
      const handles = straightControlledHandles(halfWidth);
      expect(handles, "one handle per side at the smooth point").to.have.length(2);
      for (const handle of handles) {
        // Points back along the straight, so 180 deg away from it.
        expect(handle.angle, `half-width ${halfWidth} ${handle.side}`).to.be.closeTo(
          straightAngle - 180,
          1e-6
        );
      }
    }
  });

  it("keeps handles fixed when only one end of the straight is controlled", () => {
    // The far end being an ordinary corner does not give the one-handle smooth
    // point a direction of its own, so the same tilt happens with one such point
    // as with two — measured at 15.6 deg over the same sweep before the whole
    // projected straight moved as a unit. What is left is not width drift: it is
    // non-monotonic in width and inside the +/-0.6 deg a handle of this length
    // can express on the grid at all.
    const straightAngle = (Math.atan2(100 - 60, 140 - 60) * 180) / Math.PI;
    for (const halfWidth of [8, 12, 20, 27, 34]) {
      const handles = straightControlledHandles(
        halfWidth,
        straightControlledSkeleton(halfWidth, { farEnd: "corner" })
      );
      expect(handles, "one handle per side at the smooth point").to.have.length(2);
      for (const handle of handles) {
        expect(handle.angle, `half-width ${halfWidth} ${handle.side}`).to.be.closeTo(
          straightAngle - 180,
          0.6
        );
      }
    }
  });

  it("ties the far rib of the straight even when it owns its direction", () => {
    // Point 6 is a corner here, so nothing forces its rib angle — but its offset
    // is still shared, because the projected straight has to move as one. Within
    // a unit: the corner rib rounds to the grid off a different normal.
    const tiedOffsets = straightControlledRibOffsets(30, true, { farEnd: "corner" });
    const freeOffsets = straightControlledRibOffsets(30, false, { farEnd: "corner" });
    for (const offset of tiedOffsets) {
      expect(offset, "mean of 30 and 20").to.be.closeTo(25, 1);
    }
    expect(freeOffsets[0], "stored at point 5").to.be.closeTo(30, 1);
    expect(freeOffsets[1], "stored at point 6").to.be.closeTo(20, 1);
  });

  it("frees the ribs when either point unticks tied ribs", () => {
    // The opt-out. Untying restores independent widths, and with them the
    // handle rotation the coupling exists to prevent — that is the trade the
    // designer is choosing, so assert it moves rather than that it looks good.
    const angles = [8, 20, 34].map((halfWidth) => {
      const skeleton = straightControlledSkeleton(halfWidth);
      // Point 5 opts out; point 6 stays tied. Either side frees the pair.
      skeleton.contours[0].points[3].width.tied = false;
      return straightControlledHandles(halfWidth, skeleton)[0].angle;
    });
    expect(
      new Set(angles.map((a) => a.toFixed(3))).size,
      "handle angles differ"
    ).to.equal(3);
  });

  it("keeps ribs untied out of the generated width of the other point", () => {
    // Tied: both ribs sit at the mean of 30 and 20. Untied: each keeps its own.
    const tiedOffsets = straightControlledRibOffsets(30, true);
    const freeOffsets = straightControlledRibOffsets(30, false);
    expect(tiedOffsets[0]).to.be.closeTo(tiedOffsets[1], 1e-6);
    expect(freeOffsets[0]).to.be.above(freeOffsets[1] + 5);
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

describe("skeleton-generator outline boundary invariants", () => {
  it("copies the collapsed side exactly from the skeleton cubic", () => {
    const skeleton = boundaryCubicSkeleton({ singleSided: "left" });
    const result = generateFromSkeleton(skeleton);
    for (const [id, point] of [
      [2, skeleton.contours[0].points[0]],
      [5, skeleton.contours[0].points[3]],
    ]) {
      expect(
        generatedPointFor(result, id, "right", "onCurve"),
        `${id}/right/onCurve`
      ).to.include({ x: point.x, y: point.y });
    }
    const generatedPoints = result.contours.flatMap((contour) => contour.points);
    for (const control of skeleton.contours[0].points.slice(1, 3)) {
      expect(
        generatedPoints.some(
          (point) =>
            point.type === "cubic" && point.x === control.x && point.y === control.y
        ),
        `collapsed control ${control.id}`
      ).to.equal(true);
    }
  });

  it("keeps generated point count stable across the four U1 width modes", () => {
    const variants = [
      boundaryCubicSkeleton({ startWidth: 40, endWidth: 145 }),
      boundaryCubicSkeleton({
        startWidth: 40,
        endWidth: 145,
        singleSided: "left",
      }),
      boundaryCubicSkeleton({
        startWidth: 40,
        endWidth: 145,
        singleSided: "right",
      }),
      boundaryCubicSkeleton({
        startWidth: 20,
        endWidth: 110,
        rightStartWidth: 60,
        rightEndWidth: 180,
      }),
    ].map((skeleton) => generateFromSkeleton(skeleton));
    const signature = (result) =>
      result.contours.map((contour) => ({
        closed: contour.isClosed,
        types: contour.points.map((point) => point.type ?? null),
      }));
    for (const variant of variants.slice(1)) {
      expect(signature(variant)).to.deep.equal(signature(variants[0]));
    }
  });

  it("is mirror-equivalent by provenance role", () => {
    const original = generateFromSkeleton(boundaryCubicSkeleton());
    const mirrored = generateFromSkeleton(boundaryCubicSkeleton({ mirrorX: true }));
    const mirroredPoints = provenancePointMap(mirrored);
    let compared = 0;
    for (const [key, point] of provenancePointMap(original)) {
      const [id, side, role] = key.split("/");
      const mirrorKey = `${id}/${side === "left" ? "right" : "left"}/${role}`;
      const mirrorPoint = mirroredPoints.get(mirrorKey);
      if (!mirrorPoint) {
        continue;
      }
      expect(mirrorPoint.x, mirrorKey).to.equal(-point.x);
      expect(mirrorPoint.y, mirrorKey).to.equal(point.y);
      compared++;
    }
    expect(compared).to.be.at.least(8);
  });

  it("is reversal-equivalent by provenance role", () => {
    const forward = provenancePointMap(generateFromSkeleton(boundaryCubicSkeleton()));
    const reversed = provenancePointMap(
      generateFromSkeleton(boundaryCubicSkeleton({ reversed: true }))
    );
    expect([...reversed.keys()].sort()).to.deep.equal([...forward.keys()].sort());
    for (const [key, point] of forward) {
      expect(reversed.get(key), key).to.deep.equal(point);
    }
  });

  it("emits finite output for coincident points and retracted handles", () => {
    for (const skeleton of [
      boundaryCubicSkeleton({
        points: [
          { x: 10, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 10 },
        ],
      }),
      boundaryCubicSkeleton({
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 180, y: 20 },
          { x: 180, y: 20 },
        ],
      }),
    ]) {
      const result = generateFromSkeleton(skeleton);
      expect(result.contours.length).to.be.greaterThan(0);
      expect(allGeneratedCoordinatesFinite(result)).to.equal(true);
    }
  });

  it("keeps emitted cubic handles on the skeleton-owned axes", () => {
    const skeleton = boundaryCubicSkeleton();
    const result = generateFromSkeleton(skeleton);
    const points = skeleton.contours[0].points;
    const expected = [
      [2, "out", unitVector(points[0], points[1])],
      [5, "in", unitVector(points[3], points[2])],
    ];
    for (const side of ["left", "right"]) {
      for (const [id, role, axis] of expected) {
        const anchor = generatedPointFor(result, id, side, "onCurve");
        const handle = generatedPointFor(result, id, side, role);
        const vector = { x: handle.x - anchor.x, y: handle.y - anchor.y };
        const cross = vector.x * axis.y - vector.y * axis.x;
        const dot = vector.x * axis.x + vector.y * axis.y;
        expect(Math.abs(cross), `${id}/${side}/${role}`).to.be.at.most(
          Math.SQRT1_2 + 1e-9
        );
        expect(dot, `${id}/${side}/${role} forward`).to.be.above(0);
      }
    }
  });

  it("keeps line segments as direct rib-to-rib projections", () => {
    const fixture = fixtures.find((item) => item.name === "open-line-butt-cap");
    const result = generateFromSkeleton(fixture.canonical);
    const pointMap = result.provenance[0].pointMap;
    const count = result.contours[0].points.length;
    for (const side of ["left", "right"]) {
      const indices = [2, 3].map((id) =>
        pointMap.findIndex(
          (entry) =>
            entry?.skeletonPointId === id &&
            entry.side === side &&
            entry.role === "onCurve"
        )
      );
      expect(
        indices.every((index) => index >= 0),
        side
      ).to.equal(true);
      const cyclicDistance = Math.min(
        Math.abs(indices[0] - indices[1]),
        count - Math.abs(indices[0] - indices[1])
      );
      expect(cyclicDistance, side).to.equal(1);
      expect(result.contours[0].points[indices[0]].type).to.equal(undefined);
      expect(result.contours[0].points[indices[1]].type).to.equal(undefined);
    }
  });

  it("leaves the natural solve unchanged by an on-curve nudge", () => {
    const base = nudgedRibGeometry(0);
    const moved = nudgedRibGeometry(17);
    expect(moved.segmentPoints[1]).to.deep.equal(base.segmentPoints[1]);
    expect(moved.segmentPoints[2]).to.deep.equal(base.segmentPoints[2]);
  });

  it("keeps detached handles absolute across width and taper changes", () => {
    const narrow = detachedHandleGeometry({
      startWidth: 20,
      endWidth: 20,
    });
    const tapered = detachedHandleGeometry({
      startWidth: 20,
      endWidth: 80,
    });
    expect(tapered.leftStartHandle).to.deep.equal(narrow.leftStartHandle);
  });

  // A stored handle offset is a request, and the ceiling on handle length can
  // refuse most of it. Publish the part that was honored, so the editor can
  // restate the store instead of letting it climb into a dead zone.
  it("publishes the part of a handle offset it honored", () => {
    const asked = nudgedRibGeometry(0, {
      startHandleOffsets: { leftOut: { x: 400, y: 0, detached: false } },
    });
    const honored = asked.provenance[1].honoredAdjustment;
    expect(honored).to.not.equal(undefined);
    expect(Math.hypot(honored.x, honored.y)).to.be.lessThan(400);
    const restated = nudgedRibGeometry(0, {
      startHandleOffsets: { leftOut: { x: honored.x, y: honored.y, detached: false } },
    });
    expect(restated.handle.x).to.equal(asked.handle.x);
    expect(restated.handle.y).to.equal(asked.handle.y);
  });

  // The floor on handle length belongs to the generator's own answer. A hand on
  // the handle outranks it: zero is a legal place to put a handle.
  it("lets an authored offset collapse a handle onto its point", () => {
    const collapsed = nudgedRibGeometry(0, {
      startHandleOffsets: { leftOut: { x: -400, y: 0, detached: false } },
    });
    expect(collapsed.handle.x).to.equal(collapsed.onCurve.x);
    expect(collapsed.handle.y).to.equal(collapsed.onCurve.y);
  });

  it("keeps the floor on the generator's own answer", () => {
    const natural = nudgedRibGeometry(0);
    expect(
      Math.hypot(
        natural.handle.x - natural.onCurve.x,
        natural.handle.y - natural.onCurve.y
      )
    ).to.be.greaterThan(0);
  });

  // A handle carries its own emission slide, and the curvature gizmo has to be
  // able to take it back off to reach the curve the generator solved. The
  // on-curve has published its own for exactly this reason all along.
  it("publishes the emission slide it gave a handle", () => {
    const slid = nudgedRibGeometry(0, { handleNudge: 25 });
    const still = nudgedRibGeometry(0);
    const published = slid.provenance[1].handleNudge;
    expect(published).to.not.equal(undefined);
    expect(slid.handle.x - published.x).to.equal(still.handle.x);
    expect(slid.handle.y - published.y).to.equal(still.handle.y);
  });

  it("publishes no emission slide for a handle that did not move", () => {
    expect(nudgedRibGeometry(0).provenance[1].handleNudge).to.equal(undefined);
  });

  // The ceiling stops the DRAWN handles crossing, so emission's own slide has to
  // come off it. Forwards it takes room away, which is what keeps an untouched
  // segment from rendering past its own crossing. The other direction gives room
  // back, and is stated exactly on the domain itself, where a short forward
  // reach can be built on purpose.
  it("takes the handle's emission slide off the ceiling", () => {
    const asked = { leftOut: { x: 400, y: 0, detached: false } };
    const still = nudgedRibGeometry(0, { startHandleOffsets: asked });
    const constructed = (result) =>
      Math.hypot(
        result.handle.x - (result.provenance[1].handleNudge?.x ?? 0) - result.onCurve.x,
        result.handle.y - (result.provenance[1].handleNudge?.y ?? 0) - result.onCurve.y
      );
    const base = constructed(still);
    const forward = nudgedRibGeometry(0, {
      handleNudge: 40,
      startHandleOffsets: asked,
    });
    expect(constructed(forward)).to.be.closeTo(base - 40, 1);
    // The drawn handle therefore lands where it would have without the slide.
    expect(forward.handle.x).to.be.closeTo(still.handle.x, 1);
  });

  it("publishes no honored offset for a detached handle", () => {
    const detached = nudgedRibGeometry(0, {
      startHandleOffsets: { leftOut: { x: 400, y: 0, detached: true } },
    });
    expect(detached.provenance[1].honoredAdjustment).to.equal(undefined);
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

  function cornerBlock(values = {}) {
    const { linked = true, left = {}, right = {} } = values;
    return {
      corner: {
        linked,
        left: { distance: 0, curvature: 0.55, ...left },
        right: { distance: 0, curvature: 0.55, ...right },
      },
    };
  }

  function onCurves(result) {
    return result.contours.flatMap((contour) =>
      contour.points.filter((point) => !point.type)
    );
  }

  const roundKey = (point) => `${Math.round(point.x)},${Math.round(point.y)}`;

  // The corner on-curves the rounding replaced, and the pairs it put in their
  // place. Comparing against the sharp outline is what makes each assertion
  // about the rounding alone rather than about the whole stroke.
  function cornerDiff(plain, rounded) {
    const plainKeys = new Set(onCurves(plain).map(roundKey));
    const roundedKeys = new Set(onCurves(rounded).map(roundKey));
    return {
      gone: onCurves(plain).filter((point) => !roundedKeys.has(roundKey(point))),
      added: onCurves(rounded).filter((point) => !plainKeys.has(roundKey(point))),
    };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // The four points of one rounded corner, in emission order: the two on-curves
  // the arc runs between and the two handles between them.
  function arcRuns(result) {
    const runs = [];
    for (const contour of result.contours) {
      const points = contour.points;
      for (let i = 0; i + 3 < points.length; i++) {
        if (
          !points[i].type &&
          points[i + 1].type &&
          points[i + 2].type &&
          !points[i + 3].type &&
          points[i].smooth &&
          points[i + 3].smooth
        ) {
          runs.push({
            start: points[i],
            handleIn: points[i + 1],
            handleOut: points[i + 2],
            end: points[i + 3],
          });
        }
      }
    }
    return runs;
  }

  it("a distance of zero leaves the corner sharp", () => {
    const plain = generateFromSkeleton(makeAnglePointSkeleton());
    const off = generateFromSkeleton(makeAnglePointSkeleton(cornerBlock()));
    expect(off.contours).to.deep.equal(plain.contours);
  });

  it("trims each arm back by the distance, on both sides", () => {
    const plain = generateFromSkeleton(makeAnglePointSkeleton());
    const rounded = generateFromSkeleton(
      makeAnglePointSkeleton(
        cornerBlock({ left: { distance: 20 }, right: { distance: 20 } })
      )
    );
    const { gone, added } = cornerDiff(plain, rounded);
    expect(gone).to.have.length(2);
    expect(added).to.have.length(4);
    for (const corner of gone) {
      const near = added.filter((point) => Math.abs(distance(point, corner) - 20) <= 1);
      expect(near).to.have.length(2);
    }
  });

  it("draws a straight chamfer at curvature zero", () => {
    const rounded = generateFromSkeleton(
      makeAnglePointSkeleton(
        cornerBlock({
          left: { distance: 20, curvature: 0 },
          right: { distance: 20, curvature: 0 },
        })
      )
    );
    const runs = arcRuns(rounded);
    expect(runs).to.have.length(2);
    for (const run of runs) {
      expect(distance(run.handleIn, run.start)).to.be.at.most(1);
      expect(distance(run.handleOut, run.end)).to.be.at.most(1);
    }
  });

  it("puts both handles on the corner at curvature one", () => {
    const plain = generateFromSkeleton(makeAnglePointSkeleton());
    const rounded = generateFromSkeleton(
      makeAnglePointSkeleton(
        cornerBlock({
          left: { distance: 20, curvature: 1 },
          right: { distance: 20, curvature: 1 },
        })
      )
    );
    const { gone } = cornerDiff(plain, rounded);
    const runs = arcRuns(rounded);
    expect(runs).to.have.length(2);
    for (const run of runs) {
      const corner = gone.find((point) => distance(point, run.start) <= 21);
      expect(corner).to.not.equal(undefined);
      expect(distance(run.handleIn, corner)).to.be.at.most(1);
      expect(distance(run.handleOut, corner)).to.be.at.most(1);
    }
  });

  it("rounds one side only when the two sides are unlinked", () => {
    const plain = generateFromSkeleton(makeAnglePointSkeleton());
    const rounded = generateFromSkeleton(
      makeAnglePointSkeleton(
        cornerBlock({ linked: false, left: { distance: 20 }, right: { distance: 0 } })
      )
    );
    const { gone, added } = cornerDiff(plain, rounded);
    expect(gone).to.have.length(1);
    expect(added).to.have.length(2);
  });

  it("clamps a distance longer than the arm it runs along", () => {
    const far = generateFromSkeleton(
      makeAnglePointSkeleton(
        cornerBlock({ left: { distance: 1000 }, right: { distance: 1000 } })
      )
    );
    const farther = generateFromSkeleton(
      makeAnglePointSkeleton(
        cornerBlock({ left: { distance: 10000 }, right: { distance: 10000 } })
      )
    );
    for (const point of onCurves(far)) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).to.equal(true);
    }
    expect(farther.contours).to.deep.equal(far.contours);
  });

  it("keeps a collapsed side sharp", () => {
    // A side under half a unit lies on the skeleton exactly, and rounding it
    // would pull that edge off the line the designer drew. Single-sided mode is
    // the deliberate exception: there the collapsed side borrows the live
    // side's base and rounds with it, so both edges of the stroke agree.
    const withCollapsedSide = (cornerFields) => {
      const skeleton = makeAnglePointSkeleton(cornerFields);
      skeleton.contours[0].points[1].width = { left: 40, right: 0.2 };
      return generateFromSkeleton(skeleton);
    };
    const { gone, added } = cornerDiff(
      withCollapsedSide(),
      withCollapsedSide(
        cornerBlock({ left: { distance: 20 }, right: { distance: 20 } })
      )
    );
    expect(gone).to.have.length(1);
    expect(added).to.have.length(2);
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

  // Where the NECK's far end sits on the inner edge. Once easing is on, the ball
  // attachment also lands near this edge and sits forward of the neck's far end,
  // so the rejoin above can report either one. The on-curves under the skeleton
  // points (x=40 and x=240) are excluded, and the rearmost of what is left is the
  // far end. At full easing the far end collapses onto x=240 and nothing is left.
  function neckFarEndX(capFields) {
    const points = generateFromSkeleton(horizontalDrop(capFields)).contours[0].points;
    const candidates = points
      .filter((p) => !p.type && Math.abs(p.y - 160) <= 2 && p.x > 241)
      .map((p) => p.x);
    return candidates.length ? Math.min(...candidates) : 240;
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
      { capBallEasing: 0 },
      { capBallEasing: 1 },
      { capBallShape: 1, capBallEasing: 1 },
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
      { capStyle: "drop", capBallRatio: 2, capBallEasing: 0.5 },
      { capStyle: "drop", capBallRatio: 3, capBallShape: 1, capBallEasing: 1 },
    ]) {
      expect(overshoot(capFields), JSON.stringify(capFields)).to.be.lessThan(0.5);
    }
  });

  it("places the ball continuously as the skeleton moves under a curved terminal", () => {
    // The ball is cut into a curving outer edge, and the cut has to go further
    // back the more that edge has turned. Choosing the cut by testing whether a
    // ball merely fits, and taking the first that does, makes the answer a step
    // function of where the test happens to trip. It also lands the flattest
    // ball the geometry permits, because a cut that only just fits leaves almost
    // no depth. Both showed on the reported glyph: a quarter unit of skeleton
    // moved the outline 94 units, between a ball 21 units deep and one 75 deep.
    //
    // A sweep is the test this needs. No single configuration can see it.
    const width = { left: 30, linked: true, right: 30, tied: true };
    const swept = (offset) => ({
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 60,
          singleSided: null,
          points: [
            { id: 2, x: 216 + offset, y: 615, type: null, smooth: false, width },
            { id: 3, x: 316, y: 615, type: "cubic" },
            { id: 4, x: 382, y: 552, type: "cubic" },
            {
              id: 5,
              x: 360,
              y: 488,
              type: null,
              smooth: false,
              width,
              capStyle: "drop",
              capBallRatio: 1.85,
              capBallShape: 0.25,
              capBallEasing: 1,
            },
          ],
        },
      ],
      generated: [],
    });
    let previous = null;
    let worstStep = 0;
    for (let step = -40; step <= 40; step++) {
      const points = generateFromSkeleton(swept(step / 4)).contours[0].points;
      if (previous) {
        expect(points.length).to.equal(previous.length);
        worstStep = Math.max(
          ...points.map((point, index) =>
            Math.hypot(point.x - previous[index].x, point.y - previous[index].y)
          ),
          worstStep
        );
      }
      previous = points;
    }
    // A quarter-unit driver step, so anything past a few units is a branch
    // change rather than the outline following the skeleton.
    expect(worstStep).to.be.lessThan(6);
  });

  it("capBallEasing slides the neck further back along the inner edge", () => {
    // The neck rejoins the inner edge further back as easing rises, and must
    // ease in from above — no valley cutting below the edge.
    const crisp = neckFarEndX({ capBallEasing: 0 });
    const soft = neckFarEndX({ capBallEasing: 0.5 });
    expect(soft).to.be.lessThan(crisp - 10);

    const points = generateFromSkeleton(horizontalDrop({ capBallEasing: 0.5 }))
      .contours[0].points;
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

  it("capBallEasing 1 collapses the neck's far end onto the next on-curve", () => {
    // The inner edge's terminal segment runs from the on-curve under skeleton
    // point x=240 to the terminal. Full easing puts the neck's far end exactly
    // there and no further: that is the whole meaning of the number, and it is
    // what makes the panel's top of range a real stop rather than a preference.
    expect(neckFarEndX({ capBallEasing: 1 })).to.be.closeTo(240, 0.5);
  });

  it("capBallEasing moves the neck's far end continuously across its range", () => {
    let previous = neckFarEndX({ capBallEasing: 0 });
    for (let easing = 0.05; easing <= 1.0001; easing += 0.05) {
      const current = neckFarEndX({ capBallEasing: easing });
      expect(current, `easing ${easing.toFixed(2)}`).to.be.at.most(previous + 0.5);
      previous = current;
    }
  });

  it("capBallEaseCurvature shapes the eased neck without moving its ends", () => {
    const neckEnds = (curvature) => {
      const points = generateFromSkeleton(
        horizontalDrop({ capBallEasing: 0.6, capBallEaseCurvature: curvature })
      ).contours[0].points;
      return points
        .filter((point) => !point.type)
        .map((point) => `${point.x},${point.y}`);
    };
    const slack = neckEnds(0.3);
    const taut = neckEnds(0.9);
    expect(slack).to.deep.equal(taut);

    const handles = (curvature) => {
      const points = generateFromSkeleton(
        horizontalDrop({ capBallEasing: 0.6, capBallEaseCurvature: curvature })
      ).contours[0].points;
      return points
        .filter((point) => point.type)
        .map((point) => `${point.x},${point.y}`);
    };
    expect(handles(0.3)).to.not.deep.equal(handles(0.9));
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

function boundaryCubicSkeleton({
  startWidth = 40,
  endWidth = 145,
  rightStartWidth = startWidth,
  rightEndWidth = endWidth,
  singleSided = null,
  mirrorX = false,
  reversed = false,
  points = null,
} = {}) {
  const sourcePoints = points ?? [
    { x: 408, y: 105 },
    { x: 745, y: 105 },
    { x: 906, y: 176 },
    { x: 936, y: 338 },
  ];
  const position = (point) => ({
    x: mirrorX ? -point.x : point.x,
    y: point.y,
  });
  const onCurve = (id, point, left, right) => ({
    id,
    ...position(point),
    type: null,
    smooth: false,
    width: { left, right, linked: left === right },
    nudge: { left: 0, right: 0 },
    editable: { left: true, right: true },
    handleOffsets: {},
  });
  return {
    version: 1,
    nextId: 6,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 80,
        singleSided,
        capStyle: "butt",
        reversed,
        points: [
          onCurve(2, sourcePoints[0], startWidth, rightStartWidth),
          {
            id: 3,
            ...position(sourcePoints[1]),
            type: "cubic",
            smooth: false,
          },
          {
            id: 4,
            ...position(sourcePoints[2]),
            type: "cubic",
            smooth: false,
          },
          onCurve(5, sourcePoints[3], endWidth, rightEndWidth),
        ],
      },
    ],
    generated: [],
  };
}

function generatedPointFor(result, skeletonPointId, side, role) {
  for (const [contourIndex, provenance] of result.provenance.entries()) {
    const pointIndex = provenance.pointMap.findIndex(
      (entry) =>
        entry?.skeletonPointId === skeletonPointId &&
        entry.side === side &&
        entry.role === role
    );
    if (pointIndex >= 0) {
      return result.contours[contourIndex].points[pointIndex];
    }
  }
  return undefined;
}

function provenancePointMap(result) {
  const mapped = new Map();
  for (const [contourIndex, provenance] of result.provenance.entries()) {
    for (const [pointIndex, entry] of provenance.pointMap.entries()) {
      if (!entry) {
        continue;
      }
      mapped.set(
        `${entry.skeletonPointId}/${entry.side}/${entry.role}`,
        result.contours[contourIndex].points[pointIndex]
      );
    }
  }
  return mapped;
}

function allGeneratedCoordinatesFinite(result) {
  return result.contours.every((contour) =>
    contour.points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
    )
  );
}

function unitVector(from, to) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}

function detachedHandleGeometry({ startWidth, endWidth }) {
  const skeleton = boundaryCubicSkeleton({ startWidth, endWidth });
  skeleton.contours[0].points[0].handleOffsets.leftOut = {
    x: 24,
    y: 0,
    detached: true,
  };
  const result = generateFromSkeleton(skeleton);
  return {
    leftStartHandle: generatedPointFor(result, 2, "left", "out"),
  };
}

// A single cubic segment whose first on-curve point (id 2) carries a left-side
// nudge. Returns that point's generated left rib point and the generated handle
// leaving it.
function nudgedRibGeometry(
  nudge,
  { pin = null, startHandleOffsets = {}, endHandleOffsets = {}, handleNudge = 0 } = {}
) {
  const skeleton = {
    version: 1,
    nextId: 6,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 40,
        singleSided: null,
        points: [
          {
            id: 2,
            x: 0,
            y: 0,
            type: null,
            smooth: false,
            width: { left: 20, right: 20, linked: true },
            nudge: { left: nudge, right: 0 },
            handleNudge: { left: handleNudge, right: 0 },
            segmentCurvature: { left: pin, right: null },
            editable: { left: true, right: true },
            handleOffsets: startHandleOffsets,
          },
          { id: 3, x: 40, y: 60, type: "cubic", smooth: false },
          { id: 4, x: 120, y: 60, type: "cubic", smooth: false },
          {
            id: 5,
            x: 160,
            y: 0,
            type: null,
            smooth: false,
            width: { left: 20, right: 20, linked: true },
            nudge: { left: 0, right: 0 },
            editable: { left: true, right: true },
            handleOffsets: endHandleOffsets,
          },
        ],
      },
    ],
    generated: [],
  };
  const result = generateFromSkeleton(skeleton);
  const points = result.contours[0].points;
  const pointMap = result.provenance[0].pointMap;
  const findEntry = (skeletonPointId, role) => {
    const index = pointMap.findIndex(
      (entry) =>
        entry &&
        entry.skeletonPointId === skeletonPointId &&
        entry.side === "left" &&
        entry.role === role
    );
    return index < 0 ? null : { point: points[index], provenance: pointMap[index] };
  };
  const entries = [
    findEntry(2, "onCurve"),
    findEntry(2, "out"),
    findEntry(5, "in"),
    findEntry(5, "onCurve"),
  ];
  return {
    onCurve: entries[0].point,
    onCurveProvenance: entries[0].provenance,
    handle: entries[1].point,
    segmentPoints: entries.map((entry) => entry.point),
    provenance: entries.map((entry) => entry.provenance),
  };
}

// Angled on-curve, handle, handle, smooth on-curve, straight, on-curve, handle,
// handle, angled on-curve. Point 5 is a smooth point carrying only one handle,
// on the far side, colinear with the straight; only its width varies, point 6
// stays at 20.
//
// `farEnd` picks what sits at the other end of the straight: "smooth" makes
// point 6 the mirror of point 5, so the two control each other; "corner" makes
// it an ordinary corner that owns its own direction, leaving point 5 as the
// straight's only controlled end.
function straightControlledSkeleton(halfWidthAtFive, { farEnd = "smooth" } = {}) {
  const a = { x: 60, y: 60 };
  const b = { x: 140, y: 100 };
  const along = Math.atan2(b.y - a.y, b.x - a.x);
  const reach = 45;
  const onCurve = (id, x, y, smooth, halfWidth) => ({
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
  const smoothFarEnd = farEnd === "smooth";
  return {
    version: 1,
    nextId: 10,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 40,
        singleSided: null,
        points: [
          onCurve(2, 0, 0, false, 20),
          offCurve(3, 10, 50),
          offCurve(
            4,
            Math.round(a.x - Math.cos(along) * reach),
            Math.round(a.y - Math.sin(along) * reach)
          ),
          onCurve(5, a.x, a.y, true, halfWidthAtFive),
          onCurve(6, b.x, b.y, smoothFarEnd, 20),
          smoothFarEnd
            ? offCurve(
                7,
                Math.round(b.x + Math.cos(along) * reach),
                Math.round(b.y + Math.sin(along) * reach)
              )
            : // Off the straight, so point 6 is a real corner rather than a
              // smooth point that happens to be flagged otherwise.
              offCurve(7, 200, 160),
          smoothFarEnd ? offCurve(8, 190, 60) : offCurve(8, 240, 60),
          onCurve(9, 200, 0, false, 20),
        ],
      },
    ],
    generated: [],
  };
}

// Distance of each of the two coupled rib points from its skeleton point, left
// side: [at point 5, at point 6]. Equal when tied.
function straightControlledRibOffsets(halfWidthAtFive, tied, options = {}) {
  const skeleton = straightControlledSkeleton(halfWidthAtFive, options);
  skeleton.contours[0].points[3].width.tied = tied;
  skeleton.contours[0].points[4].width.tied = tied;
  const result = generateFromSkeleton(skeleton);
  const points = result.contours[0].points;
  const pointMap = result.provenance[0].pointMap;
  return [
    [5, { x: 60, y: 60 }],
    [6, { x: 140, y: 100 }],
  ].map(([id, skeletonPoint]) => {
    const index = pointMap.findIndex(
      (entry) =>
        entry &&
        entry.skeletonPointId === id &&
        entry.side === "left" &&
        entry.role === "onCurve"
    );
    const rib = points[index];
    return Math.hypot(rib.x - skeletonPoint.x, rib.y - skeletonPoint.y);
  });
}

// The generated handle at skeleton point 5, per side, with its angle measured
// from that side's rib point.
function straightControlledHandles(halfWidthAtFive, skeletonOverride = null) {
  const result = generateFromSkeleton(
    skeletonOverride ?? straightControlledSkeleton(halfWidthAtFive)
  );
  const points = result.contours[0].points;
  const pointMap = result.provenance[0].pointMap;
  const find = (side, role) => {
    const index = pointMap.findIndex(
      (entry) =>
        entry &&
        entry.skeletonPointId === 5 &&
        entry.side === side &&
        entry.role === role
    );
    return index < 0 ? null : points[index];
  };
  const handles = [];
  for (const side of ["left", "right"]) {
    const anchor = find(side, "onCurve");
    const handle = find(side, "in");
    if (!anchor || !handle) continue;
    handles.push({
      side,
      angle: (Math.atan2(handle.y - anchor.y, handle.x - anchor.x) * 180) / Math.PI,
    });
  }
  return handles;
}

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

function smoothJunctionPositions(nudge) {
  const skeleton = smoothJunctionSkeleton(20);
  const smoothPoint = skeleton.contours[0].points.find((point) => point.id === 5);
  smoothPoint.nudge.left = nudge;
  smoothPoint.editable.left = true;
  const generated = generateFromSkeleton(skeleton);
  const positions = {};
  for (const [contourIndex, entry] of generated.provenance.entries()) {
    for (const [pointIndex, provenance] of entry.pointMap.entries()) {
      if (
        provenance?.skeletonPointId === 5 &&
        provenance.side === "left" &&
        ["onCurve", "in", "out"].includes(provenance.role)
      ) {
        positions[provenance.role] =
          generated.contours[contourIndex].points[pointIndex];
      }
    }
  }
  return positions;
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

describe("skeleton-generator rib angle lock", () => {
  // Open diagonal line: without a lock the terminal rib is perpendicular to the
  // diagonal, so its two ends differ in both x and y.
  function diagonalSkeleton(ribAngleLock, capStyle = "butt") {
    return {
      version: 1,
      nextId: 4,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          capStyle,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false },
            { id: 3, x: 100, y: 100, type: null, smooth: false, ribAngleLock },
          ],
        },
      ],
      generated: [],
    };
  }

  function terminalOnCurves(result) {
    const points = result.contours[0].points;
    const pointMap = result.provenance[0].pointMap;
    return points.filter(
      (point, index) =>
        pointMap[index]?.skeletonPointId === 3 && pointMap[index].role === "onCurve"
    );
  }

  it("leaves the rib on the geometric normal without a lock", () => {
    const ends = terminalOnCurves(generateFromSkeleton(diagonalSkeleton(null)));
    expect(ends).to.have.length(2);
    expect(ends[0].x).to.not.equal(ends[1].x);
    expect(ends[0].y).to.not.equal(ends[1].y);
  });

  it("locks the terminal rib vertical", () => {
    const ends = terminalOnCurves(generateFromSkeleton(diagonalSkeleton("vertical")));
    expect(ends).to.have.length(2);
    expect(ends[0].x).to.equal(100);
    expect(ends[1].x).to.equal(100);
    expect(Math.abs(ends[0].y - ends[1].y)).to.equal(80);
  });

  it("locks the terminal rib horizontal", () => {
    const ends = terminalOnCurves(generateFromSkeleton(diagonalSkeleton("horizontal")));
    expect(ends).to.have.length(2);
    expect(ends[0].y).to.equal(100);
    expect(ends[1].y).to.equal(100);
    expect(Math.abs(ends[0].x - ends[1].x)).to.equal(80);
  });

  // The donor gated this on the flat cap; here it supersedes the cap style, so
  // every style builds on the locked rib.
  it("applies under every cap style", () => {
    for (const capStyle of ["butt", "square", "round", "drop"]) {
      const locked = generateFromSkeleton(diagonalSkeleton("vertical", capStyle));
      const plain = generateFromSkeleton(diagonalSkeleton(null, capStyle));
      expect(locked.contours, capStyle).to.not.deep.equal(plain.contours);
      // Round and drop caps put their own points beyond the rib, so only the
      // flat-ended styles can be checked on the rib line itself.
      if (capStyle === "butt" || capStyle === "square") {
        const ends = terminalOnCurves(locked);
        expect(ends.length, capStyle).to.be.greaterThan(0);
        for (const end of ends) {
          expect(end.x, capStyle).to.equal(100);
        }
      }
    }
  });
});

describe("skeleton-generator serif field translation", () => {
  // A stem with a serif on its open start. The fixture stores serif data
  // verbatim so the migration tests can exercise old null-valued files.
  function serifStem({ serif = undefined, contourSerif = undefined } = {}) {
    return {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle: "serif",
          ...(contourSerif ? { serif: contourSerif } : {}),
          points: [
            { id: 2, x: 0, y: 0, ...(serif ? { serif } : {}) },
            { id: 3, x: 0, y: 400 },
          ],
        },
      ],
      generated: [],
    };
  }

  const ALL_NULL_HALF = Object.fromEntries(
    SERIF_HALF_FIELDS.map((field) => [field, null])
  );

  it("keeps a null-valued serif terminal at its recorded shape", () => {
    const result = generateFromSkeleton(
      serifStem({ serif: { left: ALL_NULL_HALF, right: ALL_NULL_HALF } })
    );
    const terminal = result.contours[0].points.slice(0, 7);
    expect(terminal).to.deep.equal([
      { x: 40, y: 0, smooth: true },
      { x: 40, y: 400, smooth: true },
      { x: 40, y: 400, type: "cubic" },
      { x: 40, y: 400, type: "cubic" },
      { x: 40, y: 400, smooth: true },
      { x: 40, y: 400, type: "cubic" },
      { x: 40, y: 400, type: "cubic" },
    ]);
  });

  it("normalizes every serif field to a number", () => {
    const point = normalizeSkeletonData(
      serifStem({
        serif: {
          left: ALL_NULL_HALF,
          right: ALL_NULL_HALF,
          undersideCup: null,
        },
      })
    ).contours[0].points[0];

    for (const side of ["left", "right"]) {
      for (const field of SERIF_HALF_FIELDS) {
        expect(point.serif[side][field], `${side}.${field}`).to.be.a("number");
      }
    }
    expect(point.serif.undersideCup).to.be.a("number");
  });

  it("does not read a contour serif after normalization", () => {
    const serif = { left: ALL_NULL_HALF, right: ALL_NULL_HALF };
    const contourSerif = {
      left: { wingLength: 80 },
      right: { wingLength: 80 },
    };
    const baseline = generateFromSkeleton(serifStem({ serif }));
    const withContourSerif = generateFromSkeleton(serifStem({ serif, contourSerif }));

    expect(withContourSerif.contours).to.deep.equal(baseline.contours);
  });

  it("carries per-point serif values through to generation", () => {
    // A serif cap that draws nothing but a butt cap unless the fields arrive.
    const canonical = {
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle: "serif",
          points: [
            { id: 1, x: 0, y: 0, serif: { left: { wingLength: 80 } } },
            { id: 2, x: 0, y: 300 },
          ],
        },
      ],
      generated: [],
    };
    const result = generateFromSkeleton(canonical);
    const xs = result.contours[0].points.map((point) => point.x);
    // Without the wing the outline never passes 50; with it, it reaches 130.
    expect(Math.max(...xs)).to.be.above(100);
  });
});

describe("skeleton-generator serif reach clamping", () => {
  function shortStem(reach) {
    const half = {
      wingLength: 80,
      tipThickness: 30,
      wingSlope: 0,
      tipCutAngle: 0,
      reach,
      tension: 0.7,
      concavity: 0.8,
    };
    return {
      version: 1,
      nextId: 4,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle: "serif",
          points: [
            {
              id: 1,
              x: 0,
              y: 0,
              serif: {
                left: half,
                right: half,
                axisMode: "perpendicular",
                axisAngle: 0,
                undersideCup: 0,
              },
            },
            { id: 2, x: 0, y: 40 },
            { id: 3, x: 0, y: 400 },
          ],
        },
      ],
      generated: [],
    };
  }

  it("never consumes more than the terminal segment", () => {
    const result = generateFromSkeleton(shortStem(400));
    const ys = result.contours[0].points.map((point) => point.y);
    expect(Math.max(...ys)).to.be.closeTo(400, 2);
  });

  it("keeps the emitted point count stable at the clamped terminal", () => {
    const clamped = generateFromSkeleton(shortStem(400));
    const roomy = generateFromSkeleton(shortStem(20));
    expect(clamped.contours[0].points.length).to.equal(roomy.contours[0].points.length);
  });

  it("produces a finite outline when reach far exceeds the segment", () => {
    const result = generateFromSkeleton(shortStem(10000));
    for (const point of result.contours[0].points) {
      expect(Number.isFinite(point.x)).to.equal(true);
      expect(Number.isFinite(point.y)).to.equal(true);
    }
  });
});

describe("skeleton-generator serif units mode", () => {
  const ratios = {
    wingLength: 0.8,
    tipThickness: 0.3,
    wingSlope: 0,
    tipCutAngle: 10,
    reach: 0.6,
    tension: 0.7,
    concavity: 0.8,
  };
  const stem = (width) => ({
    version: 1,
    nextId: 3,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: width,
        capStyle: "serif",
        points: [
          {
            id: 1,
            x: 0,
            y: 0,
            width: { left: width / 2, right: width / 2 },
            serif: {
              left: ratios,
              right: ratios,
              axisMode: "perpendicular",
              axisAngle: 0,
              undersideCup: 0,
            },
          },
          { id: 2, x: 0, y: 400, width: { left: width / 2, right: width / 2 } },
        ],
      },
    ],
    generated: [],
  });
  const widthOf = (result) => {
    const xs = result.contours[0].points.map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  it("scales serif lengths with stroke width in normalized mode", () => {
    const thin = generateFromSkeleton(stem(100), { serifUnitsMode: "normalized" });
    const thick = generateFromSkeleton(stem(200), { serifUnitsMode: "normalized" });
    expect(widthOf(thick)).to.be.closeTo(widthOf(thin) * 2, 2);
  });
  it("defaults to absolute units", () => {
    expect(widthOf(generateFromSkeleton(stem(150)))).to.be.closeTo(
      widthOf(generateFromSkeleton(stem(150), { serifUnitsMode: "absolute" })),
      1e-6
    );
  });
});

describe("skeleton-generator serif on a stroke the axis is not square to", () => {
  // Switching a serif on may not move the wall above it. The wall is the
  // stroke's own offset and belongs to the skeleton and its widths; the serif
  // only replaces what is below the point it lets go at.
  //
  // A rib angle lock is the case that exposes it: the rib stays flat while the
  // stem leans, so the serif's frame is no longer square to the stroke, and the
  // release found straight up that frame lands off the wall — the same way on
  // both sides, so one side moves in and the other out by as much.
  const halfSerif = {
    wingLength: 40,
    tipThickness: 20,
    wingSlope: 20,
    tipCutAngle: 0,
    reach: 0,
    tension: 0.5,
    concavity: 0.5,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const stem = (tiltDegrees, { serif = true } = {}) => {
    const radians = (tiltDegrees * Math.PI) / 180;
    const width = { left: 40, right: 40, linked: true, tied: true };
    return {
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          capStyle: "butt",
          points: [
            {
              id: 1,
              x: 0,
              y: 0,
              width,
              ribAngleLock: "horizontal",
              capStyle: serif ? "serif" : null,
              serif: {
                left: halfSerif,
                right: halfSerif,
                axisMode: "perpendicular",
                axisAngle: 0,
                undersideCup: 0,
              },
            },
            {
              id: 2,
              x: Math.sin(radians) * 400,
              y: Math.cos(radians) * 400,
              width,
              ribAngleLock: "horizontal",
            },
          ],
        },
      ],
      generated: [],
    };
  };

  // Every on-curve point the two walls own, as a distance from the centerline.
  // Provenance names them, so nothing here has to guess from position.
  function wallDistances(data) {
    const result = generateFromSkeleton(data);
    const points = result.contours[0].points;
    const [start, end] = data.contours[0].points;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const perpendicular = {
      x: (end.y - start.y) / length,
      y: -(end.x - start.x) / length,
    };
    return result.provenance[0].pointMap
      .map((entry, index) => ({ entry, point: points[index] }))
      .filter(({ entry }) => entry.role === "onCurve" && entry.side)
      .map(({ point }) =>
        Math.abs(
          (point.x - start.x) * perpendicular.x + (point.y - start.y) * perpendicular.y
        )
      );
  }

  it("leaves both walls where the stroke alone put them", () => {
    for (const tilt of [0, 10, 20, 30, 40]) {
      const [plain] = wallDistances(stem(tilt, { serif: false }));
      for (const distance of wallDistances(stem(tilt))) {
        // Half a unit of slack: the rib ends are emitted on the integer grid
        // and the serif's release is not.
        expect(Math.abs(distance - plain), `tilt ${tilt}`).to.be.below(0.51);
      }
    }
  });
});

describe("skeleton-generator collapsed serif points", () => {
  const half = {
    wingLength: 0,
    tipThickness: 0,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 0,
    tension: 0,
    concavity: 0,
  };
  const data = () => ({
    version: 1,
    nextId: 3,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 100,
        capStyle: "serif",
        points: [
          {
            id: 1,
            x: 0,
            y: 0,
            serif: {
              left: half,
              right: half,
              axisMode: "perpendicular",
              axisAngle: 0,
              undersideCup: 0,
            },
          },
          { id: 2, x: 0, y: 300 },
        ],
      },
    ],
    generated: [],
  });
  it("drops coincident points only when requested", () => {
    const kept = generateFromSkeleton(data());
    const dropped = generateFromSkeleton(data(), { removeCollapsedPoints: true });
    expect(dropped.contours[0].points.length).to.be.below(
      kept.contours[0].points.length
    );
  });

  // A bracket at zero tension puts each handle on its own on-curve. The segment
  // is a straight line by geometry, still stored as a curve, and the two points
  // that make it a curve draw nothing.
  const straightBracket = {
    wingLength: 40,
    tipThickness: 30,
    wingSlope: 10,
    tipCutAngle: 0,
    reach: 60,
    tension: 0,
    concavity: 0,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const bracketData = () => {
    const skeleton = data();
    const serif = skeleton.contours[0].points[0].serif;
    serif.left = { ...straightBracket };
    serif.right = { ...straightBracket };
    return skeleton;
  };
  // Every curve segment of a closed contour, as [on, off, off, on].
  const curveSegments = (points) => {
    const segments = [];
    for (let index = 0; index < points.length; index++) {
      const window = [0, 1, 2, 3].map((step) => points[(index + step) % points.length]);
      if (window[0].type || !window[1].type || !window[2].type || window[3].type)
        continue;
      segments.push(window);
    }
    return segments;
  };
  const isFlat = ([start, first, second, end]) =>
    Math.abs(first.x - start.x) <= 0.5 &&
    Math.abs(first.y - start.y) <= 0.5 &&
    Math.abs(second.x - end.x) <= 0.5 &&
    Math.abs(second.y - end.y) <= 0.5;

  it("keeps the handles of a straight curve segment by default", () => {
    const points = generateFromSkeleton(bracketData()).contours[0].points;
    expect(curveSegments(points).filter(isFlat).length).to.be.above(0);
  });

  it("drops the handles of a straight curve segment when requested", () => {
    const points = generateFromSkeleton(bracketData(), {
      removeCollapsedPoints: true,
    }).contours[0].points;
    expect(curveSegments(points).filter(isFlat).length).to.equal(0);
  });

  // One handle off its on-curve is still a curve, and a curve with a handle at
  // the wrong end is a different shape, not a straight line.
  it("leaves a curve with only one collapsed handle alone", () => {
    const on = (x, y) => ({ x, y });
    const off = (x, y) => ({ x, y, type: "cubic" });
    const points = [on(0, 0), off(0, 0), off(50, 40), on(100, 0)];
    expect(removeCollapsedOutlinePoints(points).length).to.equal(4);
  });

  it("drops both handles of a straight curve segment", () => {
    const on = (x, y) => ({ x, y });
    const off = (x, y) => ({ x, y, type: "cubic" });
    const points = [on(0, 0), off(0, 0), off(100, 0), on(100, 0), on(100, 200)];
    expect(removeCollapsedOutlinePoints(points).map((point) => point.type)).to.eql([
      undefined,
      undefined,
      undefined,
    ]);
  });

  // The underside cup at 0 puts its two controls a third of the way along the
  // foot with no depth. That is a straight line drawn as a curve, exactly what
  // this option is for, and it is not covered by the handles sitting on their
  // own on-curves.
  it("drops handles spread along the chord, not only ones on their on-curve", () => {
    const on = (x, y) => ({ x, y });
    const off = (x, y) => ({ x, y, type: "cubic" });
    const points = [on(0, 0), off(33, 0), off(67, 0), on(100, 0), on(100, 200)];
    expect(removeCollapsedOutlinePoints(points).map((point) => point.type)).to.eql([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("keeps a handle that leaves the chord", () => {
    const on = (x, y) => ({ x, y });
    const off = (x, y) => ({ x, y, type: "cubic" });
    const points = [on(0, 0), off(33, 0), off(67, 9), on(100, 0), on(100, 200)];
    expect(removeCollapsedOutlinePoints(points).length).to.equal(5);
  });

  // Along the line but past its end, the segment doubles back on itself before
  // it arrives. It draws a straight line either way, and dropping the handles
  // draws the same one.
  it("drops handles that overshoot the chord along its own direction", () => {
    const on = (x, y) => ({ x, y });
    const off = (x, y) => ({ x, y, type: "cubic" });
    const points = [on(0, 0), off(-40, 0), off(67, 0), on(100, 0), on(100, 200)];
    expect(removeCollapsedOutlinePoints(points).map((point) => point.type)).to.eql([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("skeleton-generator single-sided serif", () => {
  const half = {
    wingLength: 20,
    tipThickness: 20,
    wingSlope: 20,
    tipCutAngle: 0,
    reach: 0,
    tension: 0,
    concavity: 0,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const data = (singleSided) => ({
    version: 1,
    nextId: 3,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 80,
        singleSided,
        capStyle: "serif",
        points: [
          {
            id: 1,
            x: 400,
            y: 100,
            serif: {
              left: { ...half },
              right: { ...half },
              axisMode: "perpendicular",
              axisAngle: 0,
              undersideCup: 0,
            },
          },
          { id: 2, x: 400, y: 600 },
        ],
      },
    ],
    generated: [],
  });
  it("emits the same points single-sided as it does two-sided", () => {
    const signature = (skeleton) =>
      generateFromSkeleton(skeleton).contours.map((contour) =>
        contour.points.map((point) => point.type ?? null)
      );
    expect(signature(data("left"))).to.deep.equal(signature(data(null)));
    expect(signature(data("right"))).to.deep.equal(signature(data(null)));
  });
});

describe("skeleton-generator serif stability", () => {
  const base = {
    wingLength: 80,
    tipThickness: 30,
    wingSlope: 10,
    tipCutAngle: 5,
    reach: 60,
    tension: 0.7,
    concavity: 0.6,
  };
  const outlineFor = (overrides) =>
    generateFromSkeleton({
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle: "serif",
          points: [
            {
              id: 1,
              x: 0,
              y: 0,
              serif: {
                left: { ...base, ...overrides },
                right: { ...base, ...overrides },
                axisMode: "perpendicular",
                axisAngle: 0,
                undersideCup: 0,
              },
            },
            { id: 2, x: 0, y: 400 },
          ],
        },
      ],
      generated: [],
    }).contours[0].points;
  for (const [field, from, to] of [
    ["wingLength", 20, 140],
    ["tipThickness", 10, 90],
    ["wingSlope", -20, 60],
    ["tipCutAngle", -30, 30],
    ["reach", 20, 200],
    ["tension", 0.05, 0.95],
    ["concavity", -0.9, 0.9],
  ]) {
    it(`keeps point count stable while ${field} sweeps`, () => {
      const counts = new Set();
      for (let step = 0; step <= 40; step++)
        counts.add(outlineFor({ [field]: from + ((to - from) * step) / 40 }).length);
      expect([...counts]).to.have.length(1);
    });
  }
});

describe("skeleton-generator serif terminal handles", () => {
  const SERIF_HALF = {
    wingLength: 120,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 60,
    tension: 0.7,
    concavity: 0.8,
  };

  function serifStem({ capStyle = "serif", offsets = {}, width = 100 } = {}) {
    const point = (id, extra) => ({ id, ...extra, handleOffsets: offsets[id] ?? {} });
    return {
      version: 1,
      nextId: 9,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: width,
          capStyle,
          points: [
            point(2, {
              x: 0,
              y: 0,
              editable: { left: true, right: true },
              serif: {
                left: SERIF_HALF,
                right: SERIF_HALF,
                axisMode: "perpendicular",
                axisAngle: 0,
                undersideCup: 0,
              },
            }),
            { id: 3, x: 120, y: 200, type: "cubic" },
            { id: 4, x: 180, y: 340, type: "cubic" },
            point(5, {
              x: 160,
              y: 400,
              smooth: true,
              editable: { left: true, right: true },
            }),
            { id: 6, x: 260, y: 460, type: "cubic" },
            { id: 7, x: 320, y: 600, type: "cubic" },
            { id: 8, x: 320, y: 800, capStyle: "butt" },
          ],
        },
      ],
      generated: [],
    };
  }

  function emitted(result, pointId, side, role) {
    for (const entry of result.provenance) {
      const index = entry.pointMap.findIndex(
        (point) =>
          point?.skeletonPointId === pointId &&
          point.side === side &&
          point.role === role
      );
      if (index >= 0) return result.contours[entry.generatedContourIndex].points[index];
    }
    return null;
  }

  function moved(before, after) {
    return Math.hypot(after.x - before.x, after.y - before.y);
  }

  it("measures the serif trim along the edge, not across its chord", () => {
    const result = generateFromSkeleton(serifStem());
    const release = emitted(result, 2, "left", "onCurve");
    const serifSide = emitted(result, 2, "left", "out");
    const far = emitted(result, 5, "left", "in");
    expect(release).to.not.equal(null);
    expect(serifSide).to.not.equal(null);
    expect(far).to.not.equal(null);
    expect(serifSide.x).to.be.closeTo(171.75999148079742, 0.5);
    expect(serifSide.y).to.be.closeTo(220.00472762674588, 0.5);
  });

  it("leaves the next segment's handle alone when a trimmed handle changes", () => {
    const adjustment = { 5: { leftIn: { x: 9.49, y: -28.46 } } };
    for (const capStyle of ["butt", "serif"]) {
      const before = generateFromSkeleton(serifStem({ capStyle }));
      const after = generateFromSkeleton(serifStem({ capStyle, offsets: adjustment }));
      const dragged = {
        before: emitted(before, 5, "left", "in"),
        after: emitted(after, 5, "left", "in"),
      };
      const neighbour = {
        before: emitted(before, 5, "left", "out"),
        after: emitted(after, 5, "left", "out"),
      };
      expect(moved(dragged.before, dragged.after), `${capStyle} dragged`).to.be.above(
        1
      );
      expect(
        moved(neighbour.before, neighbour.after),
        `${capStyle} neighbour`
      ).to.be.at.most(0.01);
    }
  });

  it("keeps the joint's handle axis independent of stroke width under a serif", () => {
    const angleAt = (width) => {
      const result = generateFromSkeleton(serifStem({ width }));
      const on = emitted(result, 5, "left", "onCurve");
      const out = emitted(result, 5, "left", "out");
      return (Math.atan2(out.y - on.y, out.x - on.x) * 180) / Math.PI;
    };
    let worstStep = 0;
    let previous = null;
    for (let width = 60; width <= 140; width += 1) {
      const angle = angleAt(width);
      if (previous !== null)
        worstStep = Math.max(worstStep, Math.abs(angle - previous));
      previous = angle;
    }
    expect(worstStep).to.be.at.most(0.05);
    expect(Math.abs(angleAt(140) - angleAt(60))).to.be.at.most(0.05);
  });

  it("moves a trimmed handle one-for-one with its adjustment", () => {
    const before = generateFromSkeleton(serifStem());
    const on = emitted(before, 5, "left", "onCurve");
    const handle = emitted(before, 5, "left", "in");
    const axisLength = Math.hypot(handle.x - on.x, handle.y - on.y);
    const axis = {
      x: (handle.x - on.x) / axisLength,
      y: (handle.y - on.y) / axisLength,
    };
    // Under the domain's own ceiling, which on this curved stem is reached at
    // about 23 units. Past it the handle stops, as any handle does at the point
    // where the segment's two handles would cross.
    const wanted = 20;
    const after = generateFromSkeleton(
      serifStem({
        offsets: { 5: { leftIn: { x: axis.x * wanted, y: axis.y * wanted } } },
      })
    );
    expect(moved(handle, emitted(after, 5, "left", "in"))).to.be.closeTo(wanted, 1.5);
  });

  it("leaves the other handle of a trimmed segment alone, in both directions", () => {
    const cases = [
      {
        offsets: { 5: { leftIn: { x: 9.49, y: -28.46 } } },
        dragged: [5, "in"],
        still: [2, "out"],
      },
      {
        offsets: { 2: { leftOut: { x: 0, y: 30 } } },
        dragged: [2, "out"],
        still: [5, "in"],
      },
    ];
    for (const { offsets, dragged, still } of cases) {
      const before = generateFromSkeleton(serifStem());
      const after = generateFromSkeleton(serifStem({ offsets }));
      expect(
        moved(
          emitted(before, dragged[0], "left", dragged[1]),
          emitted(after, dragged[0], "left", dragged[1])
        ),
        "dragged"
      ).to.be.above(1);
      expect(
        moved(
          emitted(before, still[0], "left", still[1]),
          emitted(after, still[0], "left", still[1])
        ),
        "still"
      ).to.be.at.most(0.01);
    }
  });

  it("keeps the release and the straight run fixed under any adjustment", () => {
    const before = generateFromSkeleton(serifStem());
    const releaseBefore = emitted(before, 2, "left", "onCurve");
    for (const offsets of [
      { 2: { leftOut: { x: 0, y: 40 } } },
      { 5: { leftIn: { x: 20, y: -60 } } },
      { 2: { leftOut: { x: 0, y: -40 } }, 5: { leftIn: { x: -20, y: 60 } } },
    ]) {
      const after = generateFromSkeleton(serifStem({ offsets }));
      expect(moved(releaseBefore, emitted(after, 2, "left", "onCurve"))).to.be.at.most(
        0.01
      );
      expect(after.contours[0].points.length).to.equal(
        before.contours[0].points.length
      );
    }
  });

  it("clamps an authored handle to the emitted segment's own reach", () => {
    const huge = generateFromSkeleton(
      serifStem({ offsets: { 5: { leftIn: { x: 300, y: -900 } } } })
    );
    const bigger = generateFromSkeleton(
      serifStem({ offsets: { 5: { leftIn: { x: 600, y: -1800 } } } })
    );
    expect(
      moved(emitted(huge, 5, "left", "in"), emitted(bigger, 5, "left", "in"))
    ).to.be.at.most(0.01);
  });

  it("publishes the axis an authored handle's length is measured along", () => {
    const result = generateFromSkeleton(serifStem());
    const find = (pointId, role) =>
      result.provenance
        .flatMap((entry) => entry.pointMap)
        .find(
          (item) =>
            item?.skeletonPointId === pointId &&
            item.side === "left" &&
            item.role === role
        );
    for (const role of ["out", "in"]) {
      const pointId = role === "out" ? 2 : 5;
      const axis = find(pointId, role)?.authoredAxis;
      expect(axis, `${pointId}/${role}`).to.not.equal(undefined);
      expect(Math.hypot(axis.x, axis.y)).to.be.closeTo(1, 0.001);
    }
    expect(find(8, "in")?.authoredAxis).to.equal(undefined);
  });

  it("moves an authored handle continuously across its whole range", () => {
    const base = generateFromSkeleton(serifStem());
    const on = emitted(base, 5, "left", "onCurve");
    const handle = emitted(base, 5, "left", "in");
    const length = Math.hypot(handle.x - on.x, handle.y - on.y);
    const axis = { x: (handle.x - on.x) / length, y: (handle.y - on.y) / length };
    let previous = null;
    let worstStep = 0;
    for (let amount = -40; amount <= 120; amount += 1) {
      const point = emitted(
        generateFromSkeleton(
          serifStem({
            offsets: { 5: { leftIn: { x: axis.x * amount, y: axis.y * amount } } },
          })
        ),
        5,
        "left",
        "in"
      );
      if (previous) worstStep = Math.max(worstStep, moved(previous, point));
      previous = point;
    }
    expect(worstStep).to.be.at.most(2.5);
  });

  it("moves no on-curve when only the curvature pin changes, with a serif", () => {
    const withPin = (pin) => {
      const skeleton = serifStem({
        offsets: { 5: { leftIn: { x: 9.49, y: -28.46 } } },
      });
      skeleton.contours[0].points[0].leftSegmentCurvature = pin;
      return generateFromSkeleton(skeleton);
    };
    const base = withPin(0.4);
    const onCurves = (result) =>
      result.contours[0].points.filter((point) => !point.type);
    for (let pin = 0.4; pin <= 0.95; pin += 0.01) {
      const a = onCurves(base);
      const b = onCurves(withPin(pin));
      expect(b.length).to.equal(a.length);
      expect(
        a.reduce((sum, point, index) => sum + moved(point, b[index]), 0),
        `pin ${pin.toFixed(2)}`
      ).to.equal(0);
    }
  });

  it("keeps the point count across degenerate serif values with an adjustment", () => {
    const counts = new Set();
    for (const half of [
      { ...SERIF_HALF, wingLength: 0 },
      { ...SERIF_HALF, tipThickness: 0 },
      { ...SERIF_HALF, reach: 0 },
      { ...SERIF_HALF, tension: 0, concavity: 0 },
      SERIF_HALF,
    ]) {
      const skeleton = serifStem({
        offsets: {
          2: { leftOut: { x: 0, y: 30 } },
          5: { leftIn: { x: 9.49, y: -28.46 } },
        },
      });
      skeleton.contours[0].points[0].serif.left = half;
      skeleton.contours[0].points[0].serif.right = half;
      counts.add(generateFromSkeleton(skeleton).contours[0].points.length);
    }
    expect(counts.size).to.equal(1);
  });

  // The pin governs the piece of the curve that gets drawn, because it is applied
  // after the trim. So there is no second curve to publish: the gizmo measures
  // the segment the pin governs. Publishing one would put the gizmo back to
  // measuring one curve and writing the answer onto another.
  it("hands the gizmo no second curve when a serif handle is authored", () => {
    const constructionSegments = (result) =>
      result.provenance.flatMap((entry) =>
        entry.pointMap.filter((point) => point?.constructionSegment)
      );
    expect(
      constructionSegments(
        generateFromSkeleton(
          serifStem({ offsets: { 5: { leftIn: { x: 9.49, y: -28.46 } } } })
        )
      )
    ).to.have.length(0);
  });
});

// Grabbing the curvature gizmo and releasing it without moving must leave the
// drawn curve exactly where it was. That holds only if the number the gizmo
// measures off the outline means, to the generator, the curve it was measured
// from — which is the whole contract between the two.
describe("skeleton-generator curvature pin round trip", () => {
  const SERIF_HALF = {
    wingLength: 120,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 60,
    tension: 0.7,
    concavity: 0.8,
  };

  function stem({ capStyle = "butt", pin = null, offsets = {} } = {}) {
    return {
      version: 1,
      nextId: 9,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle,
          points: [
            {
              id: 2,
              x: 0,
              y: 0,
              editable: { left: true, right: true },
              segmentCurvature: { left: pin, right: null },
              handleOffsets: offsets[2] ?? {},
              serif:
                capStyle === "serif"
                  ? {
                      left: SERIF_HALF,
                      right: SERIF_HALF,
                      axisMode: "perpendicular",
                      axisAngle: 0,
                      undersideCup: 0,
                    }
                  : undefined,
            },
            { id: 3, x: 120, y: 200, type: "cubic" },
            { id: 4, x: 180, y: 340, type: "cubic" },
            {
              id: 5,
              x: 160,
              y: 400,
              smooth: true,
              editable: { left: true, right: true },
              handleOffsets: offsets[5] ?? {},
            },
            { id: 6, x: 260, y: 460, type: "cubic" },
            { id: 7, x: 320, y: 600, type: "cubic" },
            { id: 8, x: 320, y: 800, capStyle: "butt" },
          ],
        },
      ],
      generated: [],
    };
  }

  function segment(skeleton) {
    const result = generateFromSkeleton(skeleton);
    const at = (pointId, role) => {
      for (const entry of result.provenance) {
        const index = entry.pointMap.findIndex(
          (point) =>
            point?.skeletonPointId === pointId &&
            point.side === "left" &&
            point.role === role
        );
        if (index >= 0) {
          return {
            point: result.contours[entry.generatedContourIndex].points[index],
            provenance: entry.pointMap[index],
          };
        }
      }
      throw new Error(`no ${pointId}/left/${role}`);
    };
    const entries = [at(2, "onCurve"), at(2, "out"), at(5, "in"), at(5, "onCurve")];
    return {
      points: entries.map((entry) => entry.point),
      provenance: entries.map((entry) => entry.provenance),
    };
  }

  const grabMovement = (options) => {
    const before = segment(stem(options));
    const edit = calculateGeneratedCurvatureEdits({
      segmentPoints: before.points,
      provenance: before.provenance,
      delta: { x: 0, y: 0 },
    });
    const after = segment(stem({ ...options, pin: edit.tension }));
    return Math.max(
      ...[1, 2].map((index) =>
        Math.hypot(
          after.points[index].x - before.points[index].x,
          after.points[index].y - before.points[index].y
        )
      )
    );
  };

  const adjusted = { 5: { leftIn: { x: 9.49, y: -28.46 } } };

  for (const capStyle of ["butt", "serif"]) {
    it(`stays put when the gizmo is grabbed and not moved, ${capStyle} cap`, () => {
      expect(grabMovement({ capStyle })).to.be.at.most(1);
    });

    it(`stays put when a handle was dragged first, ${capStyle} cap`, () => {
      expect(grabMovement({ capStyle, offsets: adjusted })).to.be.at.most(1);
    });
  }
});

// A curved stem with a serif on one end: the configuration the fault was
// reported from.
function curvedSerifSkeleton(tipThickness) {
  const halfParams = {
    wingLength: 48,
    tipThickness,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 0,
    tension: 0,
    concavity: 0,
    easeDistance: 0,
    easeCurvature: 0,
  };
  return {
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 60,
        points: [
          {
            id: 4,
            x: 372,
            y: 331,
            capStyle: "serif",
            width: { left: 30, right: 30, linked: true, tied: true },
            serif: {
              axisMode: "perpendicular",
              axisAngle: 0,
              sides: "right",
              linked: false,
              undersideCup: 0,
              undersideCupTension: 2 / 3,
              undersideCupBalance: 0,
              left: { ...halfParams },
              right: { ...halfParams },
            },
          },
          { id: 9, x: 317, y: 457, type: "cubic" },
          { id: 10, x: 252, y: 492, type: "cubic" },
          {
            id: 2,
            x: 63,
            y: 492,
            width: { left: 40, right: 40, linked: true, tied: true },
          },
        ],
      },
    ],
  };
}

// The emitted stem wall next to the serif, as a cubic.
function emittedStemWall(result, side) {
  const points = result.contours[0].points;
  const map = result.provenance[0].pointMap;
  for (let i = 0; i < points.length; i++) {
    const p = map[i];
    if (!p || p.role !== "onCurve" || p.skeletonPointId !== 4 || p.side !== side)
      continue;
    for (const step of [1, -1]) {
      const at = (k) => (k + points.length * 4) % points.length;
      const c1 = points[at(i + step)];
      const c2 = points[at(i + 2 * step)];
      const far = points[at(i + 3 * step)];
      const farProvenance = map[at(i + 3 * step)];
      if (!c1?.type || !c2?.type || far?.type) continue;
      if (farProvenance?.skeletonPointId !== 2 || farProvenance?.side !== side)
        continue;
      return [points[i], c1, c2, far].map((q) => ({ x: q.x, y: q.y }));
    }
  }
  return null;
}

function cubicPoint(p, t) {
  const s = 1 - t;
  return {
    x:
      s ** 3 * p[0].x +
      3 * s * s * t * p[1].x +
      3 * s * t * t * p[2].x +
      t ** 3 * p[3].x,
    y:
      s ** 3 * p[0].y +
      3 * s * s * t * p[1].y +
      3 * s * t * t * p[2].y +
      t ** 3 * p[3].y,
  };
}

function maxDeviation(a, b) {
  let worst = 0;
  for (let i = 0; i <= 100; i++) {
    const q = cubicPoint(a, i / 100);
    let nearest = Infinity;
    for (let j = 0; j <= 2000; j++) {
      const r = cubicPoint(b, j / 2000);
      nearest = Math.min(nearest, Math.hypot(r.x - q.x, r.y - q.y));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

describe("a serif on a curved stem", () => {
  it("does not reshape the stem as the tip thickens", () => {
    const reference = emittedStemWall(
      generateFromSkeleton(curvedSerifSkeleton(0)),
      "right"
    );
    for (const tip of [20, 40, 63, 80, 100]) {
      const wall = emittedStemWall(
        generateFromSkeleton(curvedSerifSkeleton(tip)),
        "right"
      );
      // The emitted piece is a slice of the same curve, so every point on it
      // lies on the reference wall. Two units covers grid rounding at both
      // ends and nothing else.
      expect(maxDeviation(wall, reference), `tip ${tip}`).to.be.lessThan(2);
    }
  });

  it("keeps its point count as the tip thickens", () => {
    const counts = [0, 20, 63, 100].map(
      (tip) => generateFromSkeleton(curvedSerifSkeleton(tip)).contours[0].points.length
    );
    expect(new Set(counts).size).to.equal(1);
  });
});

describe("a curvature pin on a serifed terminal", () => {
  function withPin(tension) {
    const skeleton = curvedSerifSkeleton(63);
    skeleton.contours[0].points[0].segmentCurvature = {
      left: null,
      right: tension,
    };
    return skeleton;
  }

  function onCurvePositions(result) {
    return result.contours[0].points
      .filter((point) => !point.type)
      .map((point) => ({ x: point.x, y: point.y }));
  }

  it("moves no on-curve point over its whole range", () => {
    const reference = onCurvePositions(generateFromSkeleton(withPin(0.1)));
    let travel = 0;
    for (let step = 1; step <= 40; step++) {
      const positions = onCurvePositions(
        generateFromSkeleton(withPin(0.1 + step * 0.02))
      );
      expect(positions.length).to.equal(reference.length);
      for (let i = 0; i < positions.length; i++) {
        travel += Math.hypot(
          positions[i].x - reference[i].x,
          positions[i].y - reference[i].y
        );
      }
    }
    expect(travel).to.equal(0);
  });

  it("still changes the handles it is supposed to change", () => {
    const low = generateFromSkeleton(withPin(0.2)).contours[0].points;
    const high = generateFromSkeleton(withPin(0.9)).contours[0].points;
    const moved = low.filter(
      (point, i) => point.type && (point.x !== high[i].x || point.y !== high[i].y)
    );
    expect(moved.length).to.be.greaterThan(0);
  });

  it("hands the gizmo no second curve to measure", () => {
    const result = generateFromSkeleton(curvedSerifSkeleton(63));
    const published = result.provenance[0].pointMap.filter(
      (entry) => entry?.constructionSegment
    );
    expect(published.length).to.equal(0);
  });
});

describe("skeleton-generator corner meeting place", () => {
  // A horizontal arm into a vertical arm, meeting at (100, 0). Half-width 40.
  // One side's two edges are the lines y = -40 and x = 140, which cross at
  // (140, -40). The other side's are y = 40 and x = 60, crossing at (60, 40).
  // Straight arms, so both crossings are exact and there is no rounding to
  // argue about, and the outer and inner rules give the same answer.
  function rightAngleSkeleton(halfWidth = 40) {
    // Half-width comes from each point's own width, not from defaultWidth:
    // getSkeletonPointHalfWidth reads point.width for a named side.
    const width = { left: halfWidth, right: halfWidth };
    return {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: halfWidth * 2,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false, width },
            { id: 3, x: 100, y: 0, type: null, smooth: false, width },
            { id: 4, x: 100, y: 100, type: null, smooth: false, width },
          ],
        },
      ],
      generated: [],
    };
  }

  function onCurvesOf(result) {
    return result.contours.flatMap((contour) =>
      contour.points.filter((point) => !point.type)
    );
  }

  function hasPoint(points, x, y) {
    return points.some(
      (point) => Math.abs(point.x - x) <= 1 && Math.abs(point.y - y) <= 1
    );
  }

  it("puts the outer side of a right-angle corner where its two edges cross", () => {
    const points = onCurvesOf(generateFromSkeleton(rightAngleSkeleton()));
    expect(hasPoint(points, 140, -40), "outer corner at (140, -40)").to.be.true;
  });

  it("moves the outer corner in proportion to the stroke width", () => {
    // Half-width 20: the edges are y = -20 and x = 120, crossing at (120, -20).
    const points = onCurvesOf(generateFromSkeleton(rightAngleSkeleton(20)));
    expect(hasPoint(points, 120, -20), "outer corner at (120, -20)").to.be.true;
  });

  // Provenance is returned beside the contours, not stamped on the points: one
  // pointMap per generated contour, in point order.
  function cornerOnCurves(result, skeletonPointId, side) {
    const found = [];
    result.contours.forEach((contour, contourIndex) => {
      const pointMap =
        result.provenance.find((item) => item.generatedContourIndex === contourIndex)
          ?.pointMap ?? [];
      contour.points.forEach((point, pointIndex) => {
        const provenance = pointMap[pointIndex];
        if (
          !point.type &&
          provenance?.skeletonPointId === skeletonPointId &&
          provenance?.side === side
        ) {
          found.push({ ...point, provenance });
        }
      });
    });
    return found;
  }

  // Two arms leaning gently into a right angle. Their two inner edges overlap
  // and cross once, so the inner side is cut back to that crossing.
  function gentleCornerSkeleton() {
    const width = { left: 40, right: 40 };
    return {
      version: 1,
      nextId: 9,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false, width },
            { id: 5, x: 35, y: 0, type: "cubic" },
            { id: 6, x: 70, y: 0, type: "cubic" },
            { id: 3, x: 100, y: 0, type: null, smooth: false, width },
            { id: 7, x: 100, y: 30, type: "cubic" },
            { id: 8, x: 100, y: 70, type: "cubic" },
            { id: 4, x: 100, y: 100, type: null, smooth: false, width },
          ],
        },
      ],
      generated: [],
    };
  }

  // The same right angle with both arms bowed hard. The two inner edges separate
  // before they would meet, so there is no crossing to cut back to.
  function bowedCornerSkeleton() {
    const width = { left: 40, right: 40 };
    return {
      version: 1,
      nextId: 9,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 40, type: null, smooth: false, width },
            { id: 5, x: 40, y: 40, type: "cubic" },
            { id: 6, x: 70, y: 0, type: "cubic" },
            { id: 3, x: 100, y: 0, type: null, smooth: false, width },
            { id: 7, x: 100, y: 40, type: "cubic" },
            { id: 8, x: 60, y: 100, type: "cubic" },
            { id: 4, x: 40, y: 100, type: null, smooth: false, width },
          ],
        },
      ],
      generated: [],
    };
  }

  it("gives every side of a corner exactly one on-curve point", () => {
    const result = generateFromSkeleton(gentleCornerSkeleton());
    expect(cornerOnCurves(result, 3, "left")).to.have.lengthOf(1);
    expect(cornerOnCurves(result, 3, "right")).to.have.lengthOf(1);
  });

  it("cuts the inner side back to where its two edges really cross", () => {
    // The inner edges here are the lines y = 40 and x = 60, which cross at
    // (60, 40). Projecting a half-width along the split line would put the
    // point at about (72, 28) instead.
    const inner = cornerOnCurves(
      generateFromSkeleton(gentleCornerSkeleton()),
      3,
      "right"
    );
    expect(inner).to.have.lengthOf(1);
    expect(inner[0].x).to.be.closeTo(60, 1);
    expect(inner[0].y).to.be.closeTo(40, 1);
  });

  it("keeps both edge ends where the inner edges never cross", () => {
    const inner = cornerOnCurves(
      generateFromSkeleton(bowedCornerSkeleton()),
      3,
      "right"
    );
    expect(inner).to.have.lengthOf(2);
    expect(inner.map((point) => point.provenance.arm).sort()).to.deep.equal([
      "in",
      "out",
    ]);
  });

  // Arms (0,0) -> (100,0) -> (0,10). The arriving direction is (1, 0) and the
  // leaving one is close to (-1, 0), so the turn is about 174 degrees and the
  // apex is about 19 half-widths out. The limit is 2 full stroke widths, which
  // is 4 half-widths when the two sides are equal, so this is well past it.
  function foldingSkeleton() {
    const width = { left: 40, right: 40 };
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
            { id: 2, x: 0, y: 0, type: null, smooth: false, width },
            { id: 3, x: 100, y: 0, type: null, smooth: false, width },
            { id: 4, x: 0, y: 10, type: null, smooth: false, width },
          ],
        },
      ],
      generated: [],
    };
  }

  it("holds the corner at two stroke widths", () => {
    const result = generateFromSkeleton(foldingSkeleton());
    const points = cornerOnCurves(result, 3, "left").concat(
      cornerOnCurves(result, 3, "right")
    );
    expect(points.length).to.be.greaterThan(0);
    for (const point of points) {
      const reach = Math.hypot(point.x - 100, point.y - 0);
      expect(reach, `point at (${point.x}, ${point.y})`).to.be.at.most(2 * 80 + 1);
    }
  });

  it("gives a held side two on-curve points, one per arm", () => {
    // Both sides are held here. The outer one is past the miter limit. The inner
    // one would meet the same distance out, which is far beyond the ends of two
    // arms 100 units long, so there is no crossing inside either drawn edge.
    const result = generateFromSkeleton(foldingSkeleton());
    for (const side of ["left", "right"]) {
      const points = cornerOnCurves(result, 3, side);
      expect(points, side).to.have.lengthOf(2);
      expect(points.map((point) => point.provenance.arm).sort(), side).to.deep.equal([
        "in",
        "out",
      ]);
    }
  });
});

describe("skeleton-generator corner sweeps", () => {
  // A sweep holds the geometry fixed, walks one input in fine steps, and reports
  // the worst single-step movement of any outline point. A per-configuration
  // assertion has missed every fault in this area so far. Steps where the point
  // count changes are skipped: that is the fallback engaging, and it is a change
  // of construction rather than a jump within one.
  function worstStep(makeSkeleton, from, to, steps) {
    let worst = 0;
    let previous = null;
    for (let i = 0; i <= steps; i++) {
      const value = from + ((to - from) * i) / steps;
      const points = generateFromSkeleton(makeSkeleton(value)).contours.flatMap(
        (contour) => contour.points.filter((point) => !point.type)
      );
      if (previous && previous.length === points.length) {
        for (let j = 0; j < points.length; j++) {
          worst = Math.max(
            worst,
            Math.hypot(points[j].x - previous[j].x, points[j].y - previous[j].y)
          );
        }
      }
      previous = points;
    }
    return worst;
  }

  function cornerAt(angleDegrees, halfWidth = 40) {
    const radians = (angleDegrees * Math.PI) / 180;
    const width = { left: halfWidth, right: halfWidth };
    return {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: halfWidth * 2,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false, width },
            { id: 3, x: 100, y: 0, type: null, smooth: false, width },
            {
              id: 4,
              x: 100 + 100 * Math.cos(radians),
              y: 100 * Math.sin(radians),
              type: null,
              smooth: false,
              width,
            },
          ],
        },
      ],
      generated: [],
    };
  }

  it("moves smoothly as the corner turns, up to the limit", () => {
    // 20 to 140 degrees in 240 steps, half a degree each. The limit engages at
    // about 151 degrees, so this sweep stays under it.
    expect(worstStep((angle) => cornerAt(angle), 20, 140, 240)).to.be.below(4);
  });

  it("moves smoothly as the stroke widens", () => {
    expect(worstStep((halfWidth) => cornerAt(90, halfWidth), 10, 100, 180)).to.be.below(
      4
    );
  });

  it("moves in proportion to the stroke width", () => {
    // Doubling the width doubles how far the corner sits from the skeleton
    // point. This is what the old construction failed to do, because it was
    // handed the width and did not use it.
    const reachAt = (halfWidth) => {
      const result = generateFromSkeleton(cornerAt(90, halfWidth));
      const reaches = [];
      result.contours.forEach((contour, contourIndex) => {
        const pointMap =
          result.provenance.find((item) => item.generatedContourIndex === contourIndex)
            ?.pointMap ?? [];
        contour.points.forEach((point, pointIndex) => {
          if (!point.type && pointMap[pointIndex]?.skeletonPointId === 3) {
            reaches.push(Math.hypot(point.x - 100, point.y));
          }
        });
      });
      return Math.max(...reaches);
    };
    expect(reachAt(80) / reachAt(40)).to.be.closeTo(2, 0.05);
  });

  it("moves smoothly as the inner crossing appears and goes", () => {
    // Bow one arm through its range so the inner side's two edges go from
    // crossing once to not crossing at all. The fallback must engage without the
    // outline jumping more than the step that drove it.
    const width = { left: 40, right: 40 };
    const bowed = (bow) => ({
      version: 1,
      nextId: 9,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: bow, type: null, smooth: false, width },
            { id: 5, x: 40, y: bow, type: "cubic" },
            { id: 6, x: 70, y: 0, type: "cubic" },
            { id: 3, x: 100, y: 0, type: null, smooth: false, width },
            { id: 7, x: 100, y: 40, type: "cubic" },
            { id: 8, x: 60, y: 100, type: "cubic" },
            { id: 4, x: 40, y: 100, type: null, smooth: false, width },
          ],
        },
      ],
      generated: [],
    });
    expect(worstStep(bowed, 0, 40, 160)).to.be.below(6);
  });
});
