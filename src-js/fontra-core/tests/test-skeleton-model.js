import {
  DEFAULT_CORNER_CURVATURE,
  DEFAULT_SERIF_PRESET,
  DEFAULT_SKELETON_WIDTH,
  SKELETON_SCHEMA_VERSION,
  allocateSkeletonIds,
  appendSkeletonContour,
  appendSkeletonPoint,
  applySerifPreset,
  buildSegmentsFromSkeletonPoints,
  calculateNormalAtSkeletonPoint,
  captureSerifPreset,
  clearSkeletonData,
  closeSkeletonContour,
  deleteSkeletonPoints,
  getSkeletonContour,
  getSkeletonData,
  getSkeletonHandleOffset,
  getSkeletonHandleOffsetKey,
  getSkeletonPoint,
  getSkeletonPointHalfWidth,
  getSkeletonPointNudge,
  getSkeletonPointWidth,
  getSkeletonRibEndpoints,
  getSkeletonRibPosition,
  getSkeletonRibSidesForPoint,
  getSkeletonRibTieGroup,
  getTiedRibGroup,
  harmonizeSkeletonPoints,
  joinSkeletonContours,
  makeEmptySkeletonData,
  makeSkeletonContour,
  makeSkeletonInsertion,
  makeSkeletonPoint,
  measureGeneratedHalfWidths,
  normalizeSkeletonData,
  normalizeSkeletonPoint,
  projectSkeletonRibPoint,
  resetSkeletonEditableRib,
  resetSkeletonEditableRibHandle,
  resetSkeletonEditableRibHandles,
  reverseSkeletonContourPoints,
  setSkeletonCapParameters,
  setSkeletonContourDefaultWidth,
  setSkeletonContourReversed,
  setSkeletonContourSingleSided,
  setSkeletonCornerParameters,
  setSkeletonData,
  setSkeletonHandleDetached,
  setSkeletonHandleOffset,
  setSkeletonPointRibAngleLock,
  setSkeletonPointSideNudge,
  setSkeletonPointSideWidth,
  setSkeletonPointTotalWidth,
  setSkeletonPointWidthDistribution,
  setSkeletonPointWidthFromSide,
  setSkeletonPointWidthLinked,
  setSkeletonRibTiedAcrossGroup,
  setSkeletonSerifParameters,
  skeletonRibReach,
  splitSkeletonContourAtPoint,
  transformSkeletonData,
  transformSkeletonPointMetadata,
  translateSkeletonData,
  updateSkeletonPoint,
} from "@fontra/core/skeleton-model.js";
import { Transform } from "@fontra/core/transform.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

// Splitting a contour at one of its own on-curve points: a closed one opens
// there, an open one becomes two. The point appears at both ends of the cut.
describe("splitting a skeleton contour", () => {
  // Two straight segments with a handle pair on the second, so the tests can
  // check that handles stay with the half they belong to.
  function makeOpenSkeleton() {
    const skeleton = makeEmptySkeletonData();
    const contour = appendSkeletonContour(skeleton, {
      closed: false,
      defaultWidth: 60,
      singleSided: "left",
    });
    for (const data of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 140, y: 40, type: "cubic" },
      { x: 160, y: 80, type: "cubic" },
      { x: 200, y: 100 },
    ]) {
      appendSkeletonPoint(skeleton, contour.id, data);
    }
    return { skeleton, contour };
  }

  function makeClosedSkeleton() {
    const skeleton = makeEmptySkeletonData();
    const contour = appendSkeletonContour(skeleton, { closed: true });
    for (const data of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]) {
      appendSkeletonPoint(skeleton, contour.id, data);
    }
    return { skeleton, contour };
  }

  it("opens a closed contour at the point, which then appears at both ends", () => {
    const { skeleton, contour } = makeClosedSkeleton();
    const middle = contour.points[1];
    splitSkeletonContourAtPoint(skeleton, contour.id, middle.id);

    expect(skeleton.contours).to.have.length(1);
    const split = skeleton.contours[0];
    expect(split.id).to.equal(contour.id);
    expect(split.closed).to.equal(false);
    expect(split.points).to.have.length(4);
    expect(split.points[0]).to.include({ x: 100, y: 0 });
    expect(split.points.at(-1)).to.include({ x: 100, y: 0 });
    // Only one of the two can keep the name.
    expect(split.points[0].id).to.equal(middle.id);
    expect(split.points.at(-1).id).to.not.equal(middle.id);
  });

  it("cuts an open contour into two, keeping every segment", () => {
    const { skeleton, contour } = makeOpenSkeleton();
    const middle = contour.points[1];
    splitSkeletonContourAtPoint(skeleton, contour.id, middle.id);

    expect(skeleton.contours).to.have.length(2);
    const [first, second] = skeleton.contours;
    expect(first.id).to.equal(contour.id);
    expect(second.id).to.not.equal(contour.id);
    // The straight goes left, the curve goes right, and the cut point is on
    // both: two points one side, four the other.
    expect(first.points).to.have.length(2);
    expect(second.points).to.have.length(4);
    expect(first.points.at(-1)).to.include({ x: 100, y: 0 });
    expect(second.points[0]).to.include({ x: 100, y: 0 });
    expect(second.points[1].type).to.equal("cubic");
    expect(second.points[2].type).to.equal("cubic");
  });

  it("gives the new contour the old one's own settings", () => {
    const { skeleton, contour } = makeOpenSkeleton();
    splitSkeletonContourAtPoint(skeleton, contour.id, contour.points[1].id);
    const second = skeleton.contours[1];
    expect(second.defaultWidth).to.equal(60);
    expect(second.singleSided).to.equal("left");
    expect(second.closed).to.equal(false);
  });

  it("carries every setting onto both copies of the cut point", () => {
    const { skeleton, contour } = makeOpenSkeleton();
    const middle = contour.points[1];
    setSkeletonPointSideWidth(middle, 60, "left", 17, { linked: false });
    splitSkeletonContourAtPoint(skeleton, contour.id, middle.id);
    const [first, second] = skeleton.contours;
    expect(getSkeletonPointHalfWidth(first.points.at(-1), 60, "left")).to.equal(17);
    expect(getSkeletonPointHalfWidth(second.points[0], 60, "left")).to.equal(17);
  });

  // A smooth point with one handle has no direction of its own, which is what
  // ties the ribs across a straight. An endpoint made by a cut has one side, so
  // leaving it smooth would tie a straight the designer never asked to tie.
  it("leaves neither new end smooth", () => {
    const { skeleton, contour } = makeOpenSkeleton();
    const middle = contour.points[1];
    middle.smooth = true;
    splitSkeletonContourAtPoint(skeleton, contour.id, middle.id);
    const [first, second] = skeleton.contours;
    expect(first.points.at(-1).smooth).to.equal(false);
    expect(second.points[0].smooth).to.equal(false);
  });

  it("does nothing at an open contour's own ends", () => {
    const { skeleton, contour } = makeOpenSkeleton();
    for (const point of [contour.points[0], contour.points.at(-1)]) {
      expect(splitSkeletonContourAtPoint(skeleton, contour.id, point.id)).to.equal(
        null
      );
    }
    expect(skeleton.contours).to.have.length(1);
    expect(skeleton.contours[0].points).to.have.length(5);
  });

  it("does nothing at a handle, or at a point that is not there", () => {
    const { skeleton, contour } = makeOpenSkeleton();
    expect(
      splitSkeletonContourAtPoint(skeleton, contour.id, contour.points[2].id)
    ).to.equal(null);
    expect(splitSkeletonContourAtPoint(skeleton, contour.id, 999)).to.equal(null);
    expect(skeleton.contours).to.have.length(1);
  });
});

describe("skeleton-model constructors and normalization", () => {
  it("creates an empty skeleton data object", () => {
    expect(makeEmptySkeletonData()).to.deep.equal({
      version: SKELETON_SCHEMA_VERSION,
      nextId: 1,
      contours: [],
      generated: [],
    });
  });

  it("allocates stable contour and point ids from nextId", () => {
    const skeleton = makeEmptySkeletonData();
    const contour = makeSkeletonContour({}, skeleton);
    const p0 = makeSkeletonPoint({ x: 10, y: 20 }, skeleton);
    const p1 = makeSkeletonPoint({ x: 30, y: 40, type: "cubic" }, skeleton);

    expect(contour.id).to.equal(1);
    expect(p0.id).to.equal(2);
    expect(p1.id).to.equal(3);
    expect(skeleton.nextId).to.equal(4);
    expect(contour.defaultWidth).to.equal(DEFAULT_SKELETON_WIDTH);
    expect(p0.type).to.equal(null);
    expect(p1.type).to.equal("cubic");
  });

  it("normalizes missing and malformed fields without reusing ids", () => {
    const normalized = normalizeSkeletonData({
      version: 99,
      nextId: 2,
      contours: [
        {
          id: 10,
          closed: true,
          singleSided: "right",
          points: [
            { id: 11, x: 1, y: 2, width: { left: 10, right: 20, linked: false } },
            { x: Number.NaN, y: Infinity, type: "bogus" },
          ],
        },
      ],
      generated: [{ skeletonContourId: 10, pathContourIndex: 3, pointMap: [] }],
    });

    expect(normalized.version).to.equal(1);
    expect(normalized.nextId).to.equal(13);
    expect(normalized.contours[0].id).to.equal(10);
    expect(normalized.contours[0].closed).to.equal(true);
    expect(normalized.contours[0].singleSided).to.equal("right");
    expect(normalized.contours[0].points[0].id).to.equal(11);
    expect(normalized.contours[0].points[1]).to.include({
      id: 12,
      x: 0,
      y: 0,
      type: null,
    });
    expect(normalized.generated).to.deep.equal([
      { skeletonContourId: 10, pathContourIndex: 3, pointMap: [] },
    ]);
  });

  it("preserves cap and corner parameters through normalization", () => {
    const normalized = normalizeSkeletonData({
      nextId: 1,
      contours: [
        {
          capStyle: "round",
          reversed: true,
          points: [
            { x: 0, y: 0, capStyle: "square", capAngle: 30, capDistance: 12 },
            {
              x: 10,
              y: 0,
              capStyle: "bogus",
              capRadiusRatio: 0.25,
              capTension: 0.6,
            },
          ],
        },
      ],
    });

    const contour = normalized.contours[0];
    expect(contour).to.include({
      capStyle: "round",
      reversed: true,
    });
    expect(contour.points[0]).to.include({
      capStyle: "square",
      capAngle: 30,
      capDistance: 12,
    });
    expect(contour.points[1].capStyle).to.equal(null);
    expect(contour.points[1]).to.include({
      capRadiusRatio: 0.25,
      capTension: 0.6,
    });
  });

  it("normalizes the corner block, per side, linked by default", () => {
    const normalized = normalizeSkeletonData({
      nextId: 1,
      contours: [
        {
          points: [
            { x: 0, y: 0, corner: { left: { distance: 12, curvature: 0.3 } } },
            { x: 50, y: 0 },
          ],
        },
      ],
    });

    const points = normalized.contours[0].points;
    expect(points[0].corner).to.deep.equal({
      linked: true,
      left: { distance: 12, curvature: 0.3 },
      right: { distance: 0, curvature: DEFAULT_CORNER_CURVATURE },
    });
    // An unset corner is off: distance zero draws the sharp corner it drew
    // before the control existed.
    expect(points[1].corner).to.deep.equal({
      linked: true,
      left: { distance: 0, curvature: DEFAULT_CORNER_CURVATURE },
      right: { distance: 0, curvature: DEFAULT_CORNER_CURVATURE },
    });
  });

  it("drops the four withdrawn corner fields", () => {
    const normalized = normalizeSkeletonData({
      nextId: 1,
      contours: [
        {
          cornerTrimRatio: 0.5,
          cornerRadiusBoost: 1.5,
          points: [
            {
              x: 0,
              y: 0,
              cornerRoundness: 0.4,
              cornerReach: 0.6,
              roundnessStrength: 1.5,
              cornerAsymmetry: 0.25,
            },
          ],
        },
      ],
    });

    const contour = normalized.contours[0];
    expect(contour.cornerTrimRatio).to.equal(undefined);
    expect(contour.cornerRadiusBoost).to.equal(undefined);
    expect(contour.points[0].cornerRoundness).to.equal(undefined);
    expect(contour.points[0].cornerReach).to.equal(undefined);
    expect(contour.points[0].roundnessStrength).to.equal(undefined);
    expect(contour.points[0].cornerAsymmetry).to.equal(undefined);
  });
});

describe("skeleton-model layer persistence helpers", () => {
  it("sets, normalizes, reads, and clears skeleton data on a layer", () => {
    const layer = {};
    setSkeletonData(layer, {
      nextId: 1,
      contours: [{ points: [{ x: 10, y: 20 }] }],
    });

    const skeleton = getSkeletonData(layer);
    expect(skeleton.version).to.equal(1);
    expect(skeleton.contours).to.have.length(1);
    expect(skeleton.contours[0].points[0]).to.include({ x: 10, y: 20 });
    expect(skeleton.contours[0].points[0].id).to.be.a("number");

    clearSkeletonData(layer);
    expect(getSkeletonData(layer)).to.equal(null);
  });

  it("returns null for absent or malformed skeleton data", () => {
    expect(getSkeletonData(null)).to.equal(null);
    expect(getSkeletonData({ customData: {} })).to.equal(null);
  });
});

describe("skeleton-model geometry helpers", () => {
  it("reads symmetric and asymmetric widths from the canonical schema", () => {
    const point = makeSkeletonPoint({
      width: { left: 12, right: 18, linked: false },
    });
    expect(getSkeletonPointHalfWidth(point, DEFAULT_SKELETON_WIDTH, "left")).to.equal(
      12
    );
    expect(getSkeletonPointHalfWidth(point, DEFAULT_SKELETON_WIDTH, "right")).to.equal(
      18
    );
    expect(getSkeletonPointWidth(point, DEFAULT_SKELETON_WIDTH)).to.equal(30);
    expect(getSkeletonPointWidth(point, DEFAULT_SKELETON_WIDTH, "left")).to.equal(24);
    expect(getSkeletonPointWidth(point, DEFAULT_SKELETON_WIDTH, "right")).to.equal(36);
  });

  it("returns nudge only for unlocked non-zero-width sides", () => {
    const point = makeSkeletonPoint({
      nudge: { left: 7, right: 9 },
      locked: { right: { slide: true } },
    });
    expect(getSkeletonPointNudge(point, "left")).to.equal(7);
    expect(getSkeletonPointNudge(point, "right")).to.equal(0);

    const zeroWidthPoint = makeSkeletonPoint({
      width: { left: 0, right: 40, linked: false },
      nudge: { left: 11, right: 13 },
    });
    expect(getSkeletonPointNudge(zeroWidthPoint, "left")).to.equal(0);
    expect(getSkeletonPointNudge(zeroWidthPoint, "right")).to.equal(13);
  });

  it("builds line and cubic segments between on-curve skeleton points", () => {
    const points = [
      makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
      makeSkeletonPoint({ id: 2, x: 25, y: 50, type: "cubic" }),
      makeSkeletonPoint({ id: 3, x: 75, y: 50, type: "cubic" }),
      makeSkeletonPoint({ id: 4, x: 100, y: 0 }),
    ];
    const segments = buildSegmentsFromSkeletonPoints(points, false);
    expect(segments).to.have.length(1);
    expect(segments[0].startPoint.id).to.equal(1);
    expect(segments[0].endPoint.id).to.equal(4);
    expect(segments[0].controlPoints.map((point) => point.id)).to.deep.equal([2, 3]);
  });

  it("calculates normals and rib endpoints using the donor orientation", () => {
    const contour = makeSkeletonContour({
      points: [
        makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
        makeSkeletonPoint({ id: 2, x: 100, y: 0 }),
      ],
    });
    const normal = calculateNormalAtSkeletonPoint(contour, 0);
    expect(normal.x).to.be.closeTo(0, 1e-9);
    expect(normal.y).to.be.closeTo(-1, 1e-9);

    expect(
      projectSkeletonRibPoint(contour.points[0], normal, 40, "left")
    ).to.deep.equal({
      x: 0,
      y: -40,
    });
    expect(
      projectSkeletonRibPoint(contour.points[0], normal, 40, "right", 10)
    ).to.deep.equal({
      x: 10,
      y: 40,
    });
  });
});

describe("skeleton-model rib mutation helpers", () => {
  it("sets linked symmetric side widths", () => {
    const point = makeSkeletonPoint({
      width: { left: 40, right: 40, linked: true },
    });

    setSkeletonPointSideWidth(point, DEFAULT_SKELETON_WIDTH, "left", 55);

    expect(point.width).to.deep.equal({
      left: 55,
      right: 55,
      linked: true,
      tied: true,
    });
  });

  it("sets unlinked asymmetric side widths without changing the opposite side", () => {
    const point = makeSkeletonPoint({
      width: { left: 40, right: 60, linked: false },
    });

    setSkeletonPointSideWidth(point, DEFAULT_SKELETON_WIDTH, "left", 55);

    expect(point.width).to.deep.equal({
      left: 55,
      right: 60,
      linked: false,
      tied: true,
    });
  });

  it("initializes missing width from the global default width", () => {
    const point = { id: 1, x: 0, y: 0, type: null };

    setSkeletonPointSideWidth(point, 120, "right", 55, { linked: false });

    expect(point.width).to.deep.equal({
      tied: true,
      left: DEFAULT_SKELETON_WIDTH / 2,
      right: 55,
      linked: false,
    });
  });

  it("returns only the active rib side for single-sided contours", () => {
    const contour = makeSkeletonContour({ singleSided: "right" });
    const point = makeSkeletonPoint();

    expect(getSkeletonRibSidesForPoint(contour, point)).to.deep.equal(["right"]);
  });

  it("sets canonical side nudge values", () => {
    const point = makeSkeletonPoint();

    setSkeletonPointSideNudge(point, "left", 12.4);
    setSkeletonPointSideNudge(point, "right", -8.6);

    expect(point.nudge).to.deep.equal({ left: 12, right: -9 });
  });

  it("sets non-negative rounded contour default widths", () => {
    const contour = makeSkeletonContour({ defaultWidth: 80 });

    setSkeletonContourDefaultWidth(contour, -12.4);
    expect(contour.defaultWidth).to.equal(0);

    setSkeletonContourDefaultWidth(contour, 95.6);
    expect(contour.defaultWidth).to.equal(96);
  });
});

describe("skeleton-model handle offset helpers", () => {
  it("returns a default handle offset for missing values", () => {
    expect(getSkeletonHandleOffset({}, "left", "in")).to.deep.equal({
      x: 0,
      y: 0,
      detached: false,
      collapsedByCurvature: false,
    });
  });

  it("sets rounded canonical 2D handle offsets", () => {
    const point = makeSkeletonPoint();

    setSkeletonHandleOffset(point, "left", "out", { x: 12.4, y: -3.7 });

    expect(point.handleOffsets.leftOut).to.deep.equal({
      x: 12,
      y: -4,
      detached: false,
    });
  });

  it("sets detached state for both handles on a side", () => {
    const point = makeSkeletonPoint();

    setSkeletonHandleDetached(point, "right", true);

    expect(point.handleOffsets.rightIn).to.deep.equal({
      x: 0,
      y: 0,
      detached: true,
    });
    expect(point.handleOffsets.rightOut).to.deep.equal({
      x: 0,
      y: 0,
      detached: true,
    });
  });

  it("clears detached state again (un-detach)", () => {
    const point = makeSkeletonPoint({
      handleOffsets: {
        rightIn: { x: 5, y: 6, detached: true },
        rightOut: { x: -5, y: -6, detached: true },
      },
    });

    setSkeletonHandleDetached(point, "right", false);

    expect(point.handleOffsets.rightIn).to.deep.equal({
      x: 5,
      y: 6,
      detached: false,
    });
    expect(point.handleOffsets.rightOut).to.deep.equal({
      x: -5,
      y: -6,
      detached: false,
    });
  });

  it("rejects invalid handle sides and roles", () => {
    expect(() => getSkeletonHandleOffsetKey("center", "in")).to.throw(
      "invalid skeleton rib side"
    );
    expect(() => getSkeletonHandleOffsetKey("left", "middle")).to.throw(
      "invalid skeleton handle role"
    );
  });
});

describe("skeleton-model id accessors and mutators", () => {
  it("appends contours and points using stable ids", () => {
    const skeleton = makeEmptySkeletonData();
    const contour = appendSkeletonContour(skeleton, { closed: true });
    const p0 = appendSkeletonPoint(skeleton, contour.id, { x: 100, y: 200 });
    const p1 = appendSkeletonPoint(skeleton, contour.id, { x: 150, y: 250 });

    expect(getSkeletonContour(skeleton, contour.id)).to.equal(contour);
    expect(getSkeletonPoint(skeleton, contour.id, p0.id)).to.equal(p0);
    expect(getSkeletonPoint(skeleton, contour.id, p1.id)).to.equal(p1);
    expect(skeleton.nextId).to.equal(4);
  });

  it("updates a point by id and keeps canonical point shape", () => {
    const skeleton = makeEmptySkeletonData();
    const contour = appendSkeletonContour(skeleton);
    const point = appendSkeletonPoint(skeleton, contour.id, { x: 10, y: 20 });

    const updated = updateSkeletonPoint(skeleton, contour.id, point.id, {
      x: Number.NaN,
      y: 35,
      type: "bogus",
      width: { left: 14, right: 18, linked: false },
    });

    expect(updated).to.equal(getSkeletonPoint(skeleton, contour.id, point.id));
    expect(updated).to.include({ id: point.id, x: 0, y: 35, type: null });
    expect(updated.width).to.deep.equal({
      left: 14,
      right: 18,
      linked: false,
      tied: true,
    });
  });

  it("deletes points by id and reports missing targets", () => {
    const skeleton = makeEmptySkeletonData();
    const contour = appendSkeletonContour(skeleton);
    const point = appendSkeletonPoint(skeleton, contour.id, { x: 10, y: 20 });

    expect(deleteSkeletonPoints(skeleton, [[contour.id, point.id]])).to.equal(true);
    expect(getSkeletonContour(skeleton, contour.id)).to.equal(null);
    expect(deleteSkeletonPoints(skeleton, [[contour.id, point.id]])).to.equal(false);
    expect(appendSkeletonPoint(skeleton, 999, { x: 1, y: 2 })).to.equal(null);
    expect(updateSkeletonPoint(skeleton, 999, point.id, { x: 1 })).to.equal(null);
  });
});

describe("skeleton-model shape-preserving multi-point deletion", () => {
  function makeCurveContour(skeleton) {
    // A --curve-- B --curve-- C (open)
    const contour = appendSkeletonContour(skeleton);
    const a = appendSkeletonPoint(skeleton, contour.id, { x: 0, y: 0 });
    const h1 = appendSkeletonPoint(skeleton, contour.id, {
      x: 30,
      y: 0,
      type: "cubic",
    });
    const h2 = appendSkeletonPoint(skeleton, contour.id, {
      x: 70,
      y: 40,
      type: "cubic",
    });
    const b = appendSkeletonPoint(skeleton, contour.id, {
      x: 100,
      y: 40,
      smooth: true,
    });
    const h3 = appendSkeletonPoint(skeleton, contour.id, {
      x: 130,
      y: 40,
      type: "cubic",
    });
    const h4 = appendSkeletonPoint(skeleton, contour.id, {
      x: 170,
      y: 0,
      type: "cubic",
    });
    const c = appendSkeletonPoint(skeleton, contour.id, { x: 200, y: 0 });
    return { contour, a, h1, h2, b, h3, h4, c };
  }

  it("deleting a mid on-curve removes adjacent handles and refits the bridge", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, a, b, c } = makeCurveContour(skeleton);

    const modified = deleteSkeletonPoints(skeleton, [[contour.id, b.id]]);

    expect(modified).to.equal(true);
    const points = getSkeletonContour(skeleton, contour.id).points;
    expect(points[0].id).to.equal(a.id);
    expect(points[points.length - 1].id).to.equal(c.id);
    // no dangling handles at either end, refit produced a single cubic segment
    expect(points).to.have.length(4);
    expect(points[1].type).to.equal("cubic");
    expect(points[2].type).to.equal("cubic");
    // fresh handle points must carry unique minted ids below nextId
    const ids = points.map((point) => point.id);
    expect(new Set(ids).size).to.equal(ids.length);
    for (const id of ids) {
      expect(id).to.be.below(skeleton.nextId);
    }
  });

  it("deleting an off-curve also removes its paired handle, leaving a line", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, a, h1, b } = makeCurveContour(skeleton);

    deleteSkeletonPoints(skeleton, [[contour.id, h1.id]]);

    const points = getSkeletonContour(skeleton, contour.id).points;
    // both h1 and h2 gone; A--B is now a straight segment
    expect(points[0].id).to.equal(a.id);
    expect(points[1].id).to.equal(b.id);
    expect(points[1].type).to.equal(null);
    // B lost its incoming handle but keeps the outgoing pair to C
    expect(points.slice(2).filter((point) => point.type === "cubic")).to.have.length(2);
  });

  it("deleting an off-curve realigns the smooth point's surviving handle", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, a, h1, b, h3 } = makeCurveContour(skeleton);

    deleteSkeletonPoints(skeleton, [[contour.id, h1.id]]);

    // A--B is a line now, and B is smooth, so B's surviving handle has to lie
    // on that line's continuation. Left where it was, the outline generator
    // honours the smooth flag by throwing its own handle backwards.
    const points = getSkeletonContour(skeleton, contour.id).points;
    const survivor = points.find((point) => point.id === h3.id);
    const along = { x: b.x - a.x, y: b.y - a.y };
    const out = { x: survivor.x - b.x, y: survivor.y - b.y };
    // handle positions are rounded to whole units, as everywhere else
    const offLine =
      Math.abs(along.x * out.y - along.y * out.x) / Math.hypot(along.x, along.y);
    expect(offLine).to.be.below(0.5);
    expect(along.x * out.x + along.y * out.y).to.be.above(0);
    // realigning turns the handle, it does not stretch it
    expect(Math.hypot(out.x, out.y)).to.be.closeTo(30, 0.5);
  });

  it("deleting an open-contour endpoint clears its handles and moves cap data", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, a, b } = makeCurveContour(skeleton);
    updateSkeletonPoint(skeleton, contour.id, a.id, {
      capStyle: "round",
      capRadiusRatio: 0.125,
      ribAngleLock: "vertical",
    });

    deleteSkeletonPoints(skeleton, [[contour.id, a.id]]);

    const points = getSkeletonContour(skeleton, contour.id).points;
    // no leading dangling handles
    expect(points[0].id).to.equal(b.id);
    expect(points[0].type).to.equal(null);
    // cap parameters of the deleted terminal migrate to the new terminal
    expect(points[0].capStyle).to.equal("round");
    expect(points[0].capRadiusRatio).to.equal(0.125);
    // as does the rib angle lock, which describes the same terminal
    expect(points[0].ribAngleLock).to.equal("vertical");
  });

  it("moves cap fields to the new endpoint but not corner-rounding fields", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, a, b } = makeCurveContour(skeleton);
    updateSkeletonPoint(skeleton, contour.id, a.id, {
      capStyle: "square",
      capAngle: 30,
      corner: {
        linked: true,
        left: { distance: 12, curvature: 0.5 },
        right: { distance: 12, curvature: 0.5 },
      },
    });

    deleteSkeletonPoints(skeleton, [[contour.id, a.id]]);

    const newFirst = getSkeletonContour(skeleton, contour.id).points[0];
    expect(newFirst.id).to.equal(b.id);
    expect(newFirst.capStyle).to.equal("square");
    expect(newFirst.capAngle).to.equal(30);
    // corner rounding belongs to the angle-point engine, not to caps
    expect(newFirst.corner?.left?.distance ?? 0).to.equal(0);
    expect(newFirst.corner?.right?.distance ?? 0).to.equal(0);
  });

  it("removes a contour once no on-curve points remain", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, a, b, c } = makeCurveContour(skeleton);

    deleteSkeletonPoints(skeleton, [
      [contour.id, a.id],
      [contour.id, b.id],
      [contour.id, c.id],
    ]);

    expect(getSkeletonContour(skeleton, contour.id)).to.equal(null);
  });

  it("clears the smooth flag when a surviving point loses all handles", () => {
    const skeleton = makeEmptySkeletonData();
    const { contour, h1, b, h3 } = makeCurveContour(skeleton);

    deleteSkeletonPoints(skeleton, [
      [contour.id, h1.id],
      [contour.id, h3.id],
    ]);

    const points = getSkeletonContour(skeleton, contour.id).points;
    const survivorB = points.find((point) => point.id === b.id);
    expect(survivorB.smooth).to.equal(false);
  });
});

describe("skeleton-model panel-facing mutators", () => {
  function makePoint(overrides = {}) {
    return makeSkeletonPoint({ x: 0, y: 0, ...overrides });
  }

  it("total width preserves existing distribution", () => {
    const point = makePoint({ width: { left: 30, right: 10, linked: false } });
    setSkeletonPointTotalWidth(point, 80, 80);
    expect(point.width.left).to.equal(60);
    expect(point.width.right).to.equal(20);
  });

  it("side width with linked true applies the same delta to the other side", () => {
    const point = makePoint({ width: { left: 40, right: 40, linked: true } });
    setSkeletonPointSideWidth(point, 80, "left", 30);
    expect(point.width.left).to.equal(30);
    expect(point.width.right).to.equal(30);
  });

  // The same delta on both sides, which holds left − right. This is what the
  // fixed-rib drag wants, and it is NOT the distribution. A designer's per-side
  // write goes through setSkeletonPointWidthFromSide instead.
  it("linked side width moves an asymmetric pair by one delta", () => {
    const point = makePoint({ width: { left: 60, right: 20, linked: true } });
    setSkeletonPointSideWidth(point, 80, "left", 50);
    expect(point.width.left).to.equal(50);
    expect(point.width.right).to.equal(10);
  });

  it("width from a side keeps the share, not the difference", () => {
    const point = makePoint({ width: { left: 60, right: 20, linked: true } });
    setSkeletonPointWidthFromSide(point, 80, "left", 50);
    expect(point.width.left).to.equal(50);
    expect(point.width.right).to.equal(17);
  });

  it("width from a side refuses a side that holds no width", () => {
    const point = makePoint({ width: { left: 60, right: 0, linked: true } });
    expect(setSkeletonPointWidthFromSide(point, 80, "right", 20)).to.equal(false);
    expect(point.width.left).to.equal(60);
    expect(point.width.right).to.equal(0);
  });

  it("width from a side states one side when unlinked", () => {
    const point = makePoint({ width: { left: 60, right: 20, linked: false } });
    setSkeletonPointWidthFromSide(point, 80, "left", 50);
    expect(point.width.left).to.equal(50);
    expect(point.width.right).to.equal(20);
  });

  it("linked side width clamps the other side at zero", () => {
    const point = makePoint({ width: { left: 60, right: 20, linked: true } });
    setSkeletonPointSideWidth(point, 80, "left", 10);
    expect(point.width.left).to.equal(10);
    expect(point.width.right).to.equal(0);
  });

  it("side width with linked false changes one side", () => {
    const point = makePoint({ width: { left: 40, right: 40, linked: false } });
    setSkeletonPointSideWidth(point, 80, "left", 30);
    expect(point.width.left).to.equal(30);
    expect(point.width.right).to.equal(40);
  });

  it("distribution -100 collapses left and preserves total", () => {
    const point = makePoint({ width: { left: 40, right: 40, linked: false } });
    setSkeletonPointWidthDistribution(point, 80, -100);
    expect(point.width.left).to.equal(0);
    expect(point.width.right).to.equal(80);
  });

  it("distribution 100 collapses right and preserves total", () => {
    const point = makePoint({ width: { left: 40, right: 40, linked: false } });
    setSkeletonPointWidthDistribution(point, 80, 100);
    expect(point.width.left).to.equal(80);
    expect(point.width.right).to.equal(0);
  });

  it("linked toggle preserves current effective widths", () => {
    const point = makePoint({ width: { left: 30, right: 50, linked: false } });
    setSkeletonPointWidthLinked(point, true);
    expect(point.width.left).to.equal(30);
    expect(point.width.right).to.equal(50);
    expect(point.width.linked).to.equal(true);
  });

  it("collapsing a side clears its rib adjustments but not its lock", () => {
    const point = makePoint({
      width: { left: 40, right: 40, linked: false },
      locked: { left: { slide: true } },
      nudge: { left: 5, right: 5 },
      handleOffsets: { leftIn: { x: 1, y: 2, detached: true } },
    });
    setSkeletonPointWidthDistribution(point, 80, -100);
    expect(point.nudge.left).to.equal(0);
    expect(point.handleOffsets.leftIn).to.equal(undefined);
    // Collapsing is a geometry change; it must not touch lock state.
    expect(point.locked.left.slide).to.equal(true);
    expect(point.nudge.right).to.equal(5);
  });

  it("single-sided null/left/right normalizes contour.singleSided", () => {
    const contour = makeSkeletonContour();
    setSkeletonContourSingleSided(contour, "left");
    expect(contour.singleSided).to.equal("left");
    setSkeletonContourSingleSided(contour, "right");
    expect(contour.singleSided).to.equal("right");
    setSkeletonContourSingleSided(contour, "bogus");
    expect(contour.singleSided).to.equal(null);
  });

  // The flag the generator has always read and nothing ever wrote. Reversing a
  // skeleton contour flips the emitted outline's winding and leaves the drawn
  // centerline alone.
  it("reversed is a boolean the contour always holds", () => {
    const contour = makeSkeletonContour();
    expect(contour.reversed).to.equal(false);
    setSkeletonContourReversed(contour, true);
    expect(contour.reversed).to.equal(true);
    setSkeletonContourReversed(contour, false);
    expect(contour.reversed).to.equal(false);
    setSkeletonContourReversed(contour, "yes");
    expect(contour.reversed).to.equal(false);
  });

  it("contour default width clamps and rounds", () => {
    const contour = makeSkeletonContour();
    setSkeletonContourDefaultWidth(contour, -10);
    expect(contour.defaultWidth).to.equal(0);
    setSkeletonContourDefaultWidth(contour, 42.4);
    expect(contour.defaultWidth).to.equal(42);
  });

  it("cap round params write canonical cap fields only", () => {
    const point = makePoint();
    setSkeletonCapParameters(point, {
      capStyle: "round",
      capRadiusRatio: 0.25,
      capTension: 0.6,
      leftWidth: 99,
    });
    expect(point.capStyle).to.equal("round");
    expect(point.capRadiusRatio).to.equal(0.25);
    expect(point.capTension).to.equal(0.6);
    expect(point.leftWidth).to.equal(undefined);
  });

  it("cap square params write canonical cap fields only", () => {
    const point = makePoint();
    setSkeletonCapParameters(point, {
      capStyle: "square",
      capAngle: 30,
      capDistance: 12,
    });
    expect(point.capStyle).to.equal("square");
    expect(point.capAngle).to.equal(30);
    expect(point.capDistance).to.equal(12);
  });

  it("a linked corner write reaches both sides", () => {
    const point = makePoint();
    setSkeletonCornerParameters(point, { side: "left", distance: 18 });
    expect(point.corner.left.distance).to.equal(18);
    expect(point.corner.right.distance).to.equal(18);
  });

  it("an unlinked corner write reaches one side", () => {
    const point = makePoint({ corner: { linked: false } });
    setSkeletonCornerParameters(point, { side: "left", distance: 18 });
    expect(point.corner.left.distance).to.equal(18);
    expect(point.corner.right.distance).to.equal(0);
  });

  it("corner values are bounded where they are written", () => {
    const point = makePoint();
    setSkeletonCornerParameters(point, { side: "left", distance: -5, curvature: 4 });
    expect(point.corner.left.distance).to.equal(0);
    expect(point.corner.left.curvature).to.equal(1);
  });

  it("the link flag is written on its own", () => {
    const point = makePoint();
    setSkeletonCornerParameters(point, { linked: false });
    expect(point.corner.linked).to.equal(false);
  });

  it("reset rib removes nudge/handle offsets/curvature for one side, leaving locks", () => {
    const point = makePoint({
      locked: { left: { handles: true }, right: { handles: true } },
      nudge: { left: 5, right: 7 },
      handleNudge: { left: 4, right: 6 },
      segmentCurvature: { left: 0.4, right: 0.7 },
      handleOffsets: {
        leftIn: { x: 1, y: 2, detached: true },
        rightOut: { x: 3, y: 4, detached: false },
      },
    });
    resetSkeletonEditableRib(point, "left");
    expect(point.nudge.left).to.equal(0);
    expect(point.handleNudge.left).to.equal(0);
    expect(point.segmentCurvature.left).to.equal(null);
    expect(point.handleOffsets.leftIn).to.equal(undefined);
    // Reset clears adjustments only — the lock is independent.
    expect(point.locked.left.handles).to.equal(true);
    expect(point.nudge.right).to.equal(7);
    expect(point.handleNudge.right).to.equal(6);
    expect(point.segmentCurvature.right).to.equal(0.7);
    expect(point.handleOffsets.rightOut).to.not.equal(undefined);
  });

  it("reset rib handles removes only handle offsets for one side", () => {
    const point = makePoint({
      nudge: { left: 5, right: 7 },
      segmentCurvature: { left: 0.4, right: 0.7 },
      handleOffsets: {
        leftIn: { x: 1, y: 2, detached: true },
        rightOut: { x: 3, y: 4, detached: false },
      },
    });
    resetSkeletonEditableRibHandles(point, "left");
    expect(point.handleOffsets.leftIn).to.equal(undefined);
    expect(point.nudge.left).to.equal(5);
    expect(point.segmentCurvature.left).to.equal(0.4);
    expect(point.handleOffsets.rightOut).to.not.equal(undefined);
  });

  it("reset single rib handle clears only that handle, not its pair", () => {
    const point = makePoint({
      nudge: { left: 5, right: 7 },
      handleOffsets: {
        leftIn: { x: 1, y: 2, detached: false },
        leftOut: { x: 3, y: 4, detached: false },
        rightIn: { x: 5, y: 6, detached: false },
      },
    });
    resetSkeletonEditableRibHandle(point, "left", "in");
    expect(point.handleOffsets.leftIn).to.equal(undefined);
    // The opposite handle on the same side, the other side, the nudge and the
    // editable flag are all untouched.
    expect(point.handleOffsets.leftOut).to.deep.equal({ x: 3, y: 4, detached: false });
    expect(point.handleOffsets.rightIn).to.deep.equal({ x: 5, y: 6, detached: false });
    expect(point.nudge.left).to.equal(5);
  });

  it("reset single rib handle drops detach so the handle re-derives", () => {
    // A detached offset is an absolute position relative to the rib point, so
    // "reset to derived" must remove the entry outright — keeping detach with a
    // zeroed offset would collapse the handle onto the rib.
    const point = makePoint({
      handleOffsets: {
        leftIn: { x: 12, y: -8, detached: true },
        leftOut: { x: 3, y: 4, detached: true },
      },
    });
    resetSkeletonEditableRibHandle(point, "left", "in");
    expect(point.handleOffsets.leftIn).to.equal(undefined);
    expect(point.handleOffsets.leftOut.detached).to.equal(true);
  });

  it("reset single rib handle rejects a bad side or role", () => {
    const point = makePoint({});
    expect(() => resetSkeletonEditableRibHandle(point, "middle", "in")).to.throw();
    expect(() => resetSkeletonEditableRibHandle(point, "left", "onCurve")).to.throw();
  });
});

describe("skeleton-model transform/translate/id-allocation", () => {
  function makeFixture() {
    return {
      version: SKELETON_SCHEMA_VERSION,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: true,
          singleSided: "left",
          capBallSide: "right",
          defaultWidth: 80,
          points: [
            {
              id: 2,
              x: 100,
              y: 200,
              type: null,
              smooth: false,
              width: { left: 30, right: 50, linked: true, tied: false },
              nudge: { left: 3, right: -7 },
              handleNudge: { left: 2, right: -5 },
              locked: {
                left: { handles: true, slide: true, width: true },
                right: { handles: false, slide: false, width: false },
              },
              segmentCurvature: { left: 0.3, right: 0.8 },
              capBallSide: "left",
              capAngle: 12,
              corner: {
                linked: false,
                left: { distance: 12, curvature: 0.4 },
                right: { distance: 30, curvature: 0.9 },
              },
              editable: { left: true, right: false },
              handleOffsets: {
                leftIn: { x: 10, y: 2, detached: true },
                leftOut: { x: 4, y: 5, detached: false },
                rightIn: { x: -6, y: 7, detached: false },
                rightOut: { x: 8, y: -9, detached: true },
              },
            },
            { id: 3, x: 150, y: 250, type: "cubic", smooth: false },
          ],
        },
      ],
      generated: [
        {
          skeletonContourId: 1,
          pathContourIndex: 0,
          pointMap: [
            { skeletonPointId: 2, side: "left", role: "onCurve" },
            { skeletonPointId: 3, side: "left", role: "in" },
          ],
        },
      ],
    };
  }

  it("translate shifts every point by (dx, dy)", () => {
    const out = translateSkeletonData(makeFixture(), 5, -7);
    expect(out.contours[0].points[0].x).to.equal(105);
    expect(out.contours[0].points[0].y).to.equal(193);
    expect(out.contours[0].points[1].x).to.equal(155);
    expect(out.contours[0].points[1].y).to.equal(243);
  });

  it("translate leaves widths/nudges/handleOffsets unchanged", () => {
    const out = translateSkeletonData(makeFixture(), 5, -7);
    const point = out.contours[0].points[0];
    expect(point.width).to.deep.equal({
      left: 30,
      right: 50,
      linked: true,
      tied: false,
    });
    expect(point.nudge).to.deep.equal({ left: 3, right: -7 });
    expect(point.handleNudge).to.deep.equal({ left: 2, right: -5 });
    expect(point.handleOffsets.leftIn).to.deep.equal({
      x: 10,
      y: 2,
      detached: true,
    });
  });

  it("translate does not mutate the input", () => {
    const input = makeFixture();
    translateSkeletonData(input, 5, -7);
    expect(input.contours[0].points[0].x).to.equal(100);
  });

  it("transform applies the affine to point coordinates", () => {
    const out = transformSkeletonData(makeFixture(), new Transform(2, 0, 0, 3, 10, 20));
    expect(out.contours[0].points[0].x).to.equal(210);
    expect(out.contours[0].points[0].y).to.equal(620);
  });

  it("transform applies only the linear part to handle offsets", () => {
    const out = transformSkeletonData(makeFixture(), new Transform(2, 0, 0, 3, 10, 20));
    // offset (10, 2) under the linear part → (20, 6); translation ignored
    expect(out.contours[0].points[0].handleOffsets.leftIn.x).to.equal(20);
    expect(out.contours[0].points[0].handleOffsets.leftIn.y).to.equal(6);
    expect(out.contours[0].points[0].handleOffsets.leftIn.detached).to.equal(true);
  });

  it("transform of a reflection swaps side-owned point and contour data", () => {
    const out = transformSkeletonData(makeFixture(), new Transform(-1, 0, 0, 1, 0, 0));
    const contour = out.contours[0];
    const point = contour.points[0];
    expect(point.x).to.equal(-100);
    expect(point.width).to.deep.equal({
      left: 50,
      right: 30,
      linked: true,
      tied: false,
    });
    expect(point.nudge).to.deep.equal({ left: -7, right: 3 });
    expect(point.handleNudge).to.deep.equal({ left: -5, right: 2 });
    expect(point.locked).to.deep.equal({
      left: { handles: false, slide: false, width: false },
      right: { handles: true, slide: true, width: true },
    });
    expect(point.segmentCurvature).to.deep.equal({ left: 0.8, right: 0.3 });
    expect(point.handleOffsets).to.deep.equal({
      leftIn: { x: 6, y: 7, detached: false },
      leftOut: { x: -8, y: -9, detached: true },
      rightIn: { x: -10, y: 2, detached: true },
      rightOut: { x: -4, y: 5, detached: false },
    });
    expect(point.capBallSide).to.equal("right");
    expect(point.capAngle).to.equal(-12);
    // A mirror exchanges geometric left and right, so the two corner sides
    // travel with every other per-side field.
    expect(point.corner.left).to.deep.equal({ distance: 30, curvature: 0.9 });
    expect(point.corner.right).to.deep.equal({ distance: 12, curvature: 0.4 });
    expect(contour.singleSided).to.equal("right");
    expect(contour.capBallSide).to.equal("left");
  });

  it("transform without reflection keeps sides and signed side parameters", () => {
    const out = transformSkeletonData(makeFixture(), new Transform(0, 1, -1, 0, 0, 0));
    const contour = out.contours[0];
    const point = contour.points[0];
    expect(point.width).to.deep.equal({
      left: 30,
      right: 50,
      linked: true,
      tied: false,
    });
    expect(point.nudge).to.deep.equal({ left: 3, right: -7 });
    expect(point.segmentCurvature).to.deep.equal({ left: 0.3, right: 0.8 });
    expect(point.handleOffsets.leftIn).to.deep.equal({
      x: -2,
      y: 10,
      detached: true,
    });
    expect(point.capBallSide).to.equal("left");
    expect(point.capAngle).to.equal(12);
    expect(point.corner.left).to.deep.equal({ distance: 12, curvature: 0.4 });
    expect(point.corner.right).to.deep.equal({ distance: 30, curvature: 0.9 });
    expect(contour.singleSided).to.equal("left");
    expect(contour.capBallSide).to.equal("right");
  });

  it("allocateSkeletonIds re-keys contours and points from nextId", () => {
    const { data, nextId } = allocateSkeletonIds(makeFixture(), 100);
    expect(data.contours[0].id).to.equal(100);
    expect(data.contours[0].points[0].id).to.equal(101);
    expect(data.contours[0].points[1].id).to.equal(102);
    expect(nextId).to.equal(103);
    expect(data.nextId).to.equal(103);
  });

  it("allocateSkeletonIds rewrites provenance references", () => {
    const { data } = allocateSkeletonIds(makeFixture(), 100);
    expect(data.generated[0].skeletonContourId).to.equal(100);
    expect(data.generated[0].pointMap[0].skeletonPointId).to.equal(101);
    expect(data.generated[0].pointMap[1].skeletonPointId).to.equal(102);
  });

  it("allocateSkeletonIds preserves geometry and contour flags", () => {
    const { data } = allocateSkeletonIds(makeFixture(), 100);
    expect(data.contours[0].closed).to.equal(true);
    expect(data.contours[0].defaultWidth).to.equal(80);
    expect(data.contours[0].points[0].x).to.equal(100);
    expect(data.contours[0].points[0].width).to.deep.equal({
      left: 30,
      right: 50,
      linked: true,
      tied: false,
    });
  });
});

describe("skeleton-model serif schema", () => {
  it("captures one wing and applies it to both", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: {
        linked: false,
        undersideCup: 12,
        left: { wingLength: 40 },
        right: { wingLength: 30 },
      },
    });
    const preset = captureSerifPreset(point);

    expect(preset).to.include({ wingLength: 40, undersideCup: 12 });
    expect(preset).to.not.have.any.keys("left", "right", "linked", "axisMode");

    const both = applySerifPreset(preset);
    expect(both.left).to.deep.equal(both.right);
    expect(both.left.wingLength).to.equal(40);
    expect(both.left).to.not.have.property("undersideCup");
    expect(both.undersideCup).to.equal(12);
    expect(both).to.not.have.property("linked");

    const left = applySerifPreset(preset, { scope: "left" });
    expect(Object.keys(left)).to.deep.equal(["left"]);
    expect(left.left.wingLength).to.equal(40);
  });

  it("reads a preset saved with the old two-wing shape", () => {
    const applied = applySerifPreset({ left: { wingLength: 40 }, undersideCup: 5 });
    expect(applied.left.wingLength).to.equal(40);
    expect(applied.right.wingLength).to.equal(40);
    expect(applied.undersideCup).to.equal(5);
  });

  it("starts a new serif on the default preset", () => {
    expect(DEFAULT_SERIF_PRESET.name).to.equal("Egyptian");
    expect(DEFAULT_SERIF_PRESET).to.include({
      wingLength: 20,
      tipThickness: 20,
      wingSlope: 20,
      reach: 0,
      tension: 0,
      concavity: 0,
      undersideCup: 0,
    });
  });

  it("accepts serif as a cap style", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0, capStyle: "serif" });
    expect(point.capStyle).to.equal("serif");
  });

  it("fills every unset half field with zero", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { left: { wingLength: 40 } },
    });
    expect(point.serif.left.wingLength).to.equal(40);
    expect(point.serif.left.tension).to.equal(0);
    expect(point.serif.left.concavity).to.equal(0);
    expect(point.serif.left.easeCurvature).to.equal(0);
    expect(point.serif.right.wingLength).to.equal(0);
    expect(Object.keys(point.serif.left)).to.have.length(9);
  });

  // Every path into a serif goes through this writer, so the ease ceiling has
  // to live here. Bounding it further out left the typed field and the preset
  // able to store a number the terminal was never going to draw.
  it("stops the ease distance at the end of the bracket", () => {
    const point = { x: 0, y: 0 };
    setSkeletonSerifParameters(point, {
      left: { wingLength: 30, wingSlope: 10, reach: 30, easeDistance: 4000 },
    });
    expect(point.serif.left.easeDistance).to.equal(50);
  });

  it("re-reads the ease ceiling from the bracket in the same write", () => {
    const point = { x: 0, y: 0 };
    setSkeletonSerifParameters(point, {
      left: { wingLength: 30, wingSlope: 10, reach: 30, easeDistance: 50 },
    });
    setSkeletonSerifParameters(point, { left: { reach: 0 } });
    expect(point.serif.left.easeDistance).to.equal(Math.round(Math.hypot(30, 10)));
  });

  it("defaults the axis mode and the link flag", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    expect(point.serif.axisMode).to.equal("perpendicular");
    expect(point.serif.axisAngle).to.equal(0);
    expect(point.serif.axisTilt).to.equal(0);
    expect(point.serif.linked).to.equal(true);
  });

  it("accepts the tilt mode and stores its angle", () => {
    const point = { x: 0, y: 0 };
    setSkeletonSerifParameters(point, { axisMode: "tilt", axisTilt: -18 });
    expect(point.serif.axisMode).to.equal("tilt");
    expect(point.serif.axisTilt).to.equal(-18);
  });

  it("keeps the stored tilt when the field arrives empty", () => {
    // A mixed selection delivers an empty value through the summary slider.
    // Every other terminal field takes that as zero; the two angles do not,
    // because zeroing every terminal in the selection is not what was touched.
    const point = { x: 0, y: 0 };
    setSkeletonSerifParameters(point, { axisMode: "tilt", axisTilt: 12 });
    setSkeletonSerifParameters(point, { axisTilt: null });
    expect(point.serif.axisTilt).to.equal(12);
  });

  it("rejects an unknown axis mode", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { axisMode: "diagonal" },
    });
    expect(point.serif.axisMode).to.equal("perpendicular");
  });

  it("defaults terminal-level values to zero when unset", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    expect(point.serif.undersideCup).to.equal(0);
  });

  it("does not put serif data on off-curve points", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0, type: "cubic", serif: {} });
    expect(point.serif).to.equal(undefined);
  });
});

describe("skeleton-model serif mirroring", () => {
  const mirrorX = { xx: -1, xy: 0, yx: 0, yy: 1, dx: 0, dy: 0 };
  const scaleUp = { xx: 2, xy: 0, yx: 0, yy: 2, dx: 0, dy: 0 };

  function serifPoint() {
    return normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: {
        left: { wingLength: 40, tipCutAngle: 5 },
        right: { wingLength: 90, tipCutAngle: -12 },
        axisMode: "absolute",
        axisAngle: 30,
      },
    });
  }

  it("swaps the two halves on a determinant flip", () => {
    const point = serifPoint();
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.left.wingLength).to.equal(90);
    expect(point.serif.right.wingLength).to.equal(40);
  });

  it("negates the absolute axis angle on a flip", () => {
    const point = serifPoint();
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.axisAngle).to.equal(-30);
  });

  it("negates the axis tilt on a flip", () => {
    // A mirror takes the frame to (-M(axis), M(depth)), so a tilt of theta on
    // the old frame is a tilt of -theta on the new one. Unlike wingSlope and
    // tipCutAngle, which are measured inside a half and corrected by the swap.
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { axisMode: "tilt", axisTilt: 22 },
    });
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.axisTilt).to.equal(-22);
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.axisTilt).to.equal(22);
  });

  it("leaves the axis mode alone on a flip", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { axisMode: "horizontal" },
    });
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.axisMode).to.equal("horizontal");
  });

  it("does not swap halves when the determinant is positive", () => {
    const point = serifPoint();
    transformSkeletonPointMetadata(point, scaleUp);
    expect(point.serif.left.wingLength).to.equal(40);
    expect(point.serif.axisAngle).to.equal(30);
  });

  it("round-trips through two mirrors", () => {
    const point = serifPoint();
    const before = JSON.parse(JSON.stringify(point.serif));
    transformSkeletonPointMetadata(point, mirrorX);
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif).to.deep.equal(before);
  });
});

describe("skeleton-model rib angle lock", () => {
  it("normalizes the lock to horizontal, vertical or null", () => {
    expect(makeSkeletonPoint({ ribAngleLock: "vertical" }).ribAngleLock).to.equal(
      "vertical"
    );
    expect(makeSkeletonPoint({ ribAngleLock: "horizontal" }).ribAngleLock).to.equal(
      "horizontal"
    );
    expect(makeSkeletonPoint({ ribAngleLock: "diagonal" }).ribAngleLock).to.equal(null);
    expect(makeSkeletonPoint({}).ribAngleLock).to.equal(null);
  });

  it("sets and clears the lock through the mutator", () => {
    const point = makeSkeletonPoint({});
    setSkeletonPointRibAngleLock(point, "horizontal");
    expect(point.ribAngleLock).to.equal("horizontal");
    setSkeletonPointRibAngleLock(point, null);
    expect(point.ribAngleLock).to.equal(null);
    setSkeletonPointRibAngleLock(point, "sideways");
    expect(point.ribAngleLock).to.equal(null);
  });

  it("overrides the rib normal, keeping the side orientation", () => {
    const contour = makeSkeletonContour({
      points: [
        makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
        makeSkeletonPoint({ id: 2, x: 100, y: 100, ribAngleLock: "vertical" }),
      ],
    });
    // Unlocked, the normal at the diagonal's end points down-right.
    const free = calculateNormalAtSkeletonPoint(
      makeSkeletonContour({
        points: [
          makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
          makeSkeletonPoint({ id: 2, x: 100, y: 100 }),
        ],
      }),
      1
    );
    const locked = calculateNormalAtSkeletonPoint(contour, 1);
    expect(locked).to.deep.equal({ x: 0, y: free.y >= 0 ? 1 : -1 });
  });
});

// The skeleton is a path, so harmonize applies to its own centerline points
// unchanged. Only the centerline: the generated outline is derived, and the
// one write path regenerates it.
describe("harmonizing a skeleton centerline", () => {
  function makeKinkedSkeleton() {
    return {
      version: SKELETON_SCHEMA_VERSION,
      nextId: 10,
      contours: [
        makeSkeletonContour({
          id: 1,
          closed: false,
          points: [
            makeSkeletonPoint({ id: 2, x: 0, y: 0 }),
            makeSkeletonPoint({ id: 3, x: 40, y: 0, type: "cubic" }),
            makeSkeletonPoint({ id: 4, x: 60, y: 40, type: "cubic" }),
            makeSkeletonPoint({ id: 5, x: 100, y: 60, smooth: true }),
            // Colinear with the incoming handle, so the joint is smooth, but
            // far shorter — the curvature does not match across it.
            makeSkeletonPoint({ id: 6, x: 120, y: 70, type: "cubic" }),
            makeSkeletonPoint({ id: 7, x: 190, y: 60, type: "cubic" }),
            makeSkeletonPoint({ id: 8, x: 200, y: 0 }),
          ],
        }),
      ],
      generated: [],
    };
  }

  it("moves the handles at a smooth centerline joint", () => {
    const skeleton = makeKinkedSkeleton();
    const before = skeleton.contours[0].points.map((point) => ({ ...point }));
    const report = harmonizeSkeletonPoints(skeleton);
    const after = skeleton.contours[0].points;
    expect(report.some((entry) => entry.status === "harmonized")).to.equal(true);
    const moved = after.filter(
      (point, index) => point.x !== before[index].x || point.y !== before[index].y
    );
    expect(moved.length).to.be.greaterThan(0);
    expect(moved.every((point) => point.type === "cubic")).to.equal(true);
  });

  it("touches nothing outside the points it was given", () => {
    const skeleton = makeKinkedSkeleton();
    const before = skeleton.contours[0].points.map((point) => ({ ...point }));
    harmonizeSkeletonPoints(skeleton, new Set(["1/2"]));
    const after = skeleton.contours[0].points;
    for (let index = 0; index < after.length; index++) {
      expect(after[index].x).to.equal(before[index].x);
      expect(after[index].y).to.equal(before[index].y);
    }
  });
});

describe("skeleton rib direction at a corner", () => {
  // (0,0) -> (100,0) -> (100,100). A quarter turn, so the split line's normal is
  // about (0.707, -0.707) and the two edges of a side meet one half-width over
  // the cosine of 45 degrees out along it — root two half-widths.
  const contour = {
    id: 1,
    closed: false,
    defaultWidth: 80,
    singleSided: null,
    points: [
      { id: 2, x: 0, y: 0, type: null, smooth: false },
      { id: 3, x: 100, y: 0, type: null, smooth: false },
      { id: 4, x: 100, y: 100, type: null, smooth: false },
    ],
  };

  it("lies on the split line, not square to the arriving arm", () => {
    const normal = calculateNormalAtSkeletonPoint(contour, 1);
    expect(Math.abs(normal.x)).to.be.closeTo(Math.SQRT1_2, 1e-9);
    expect(Math.abs(normal.y)).to.be.closeTo(Math.SQRT1_2, 1e-9);
  });

  it("reaches the place the two edges meet", () => {
    expect(skeletonRibReach(contour, 1)).to.be.closeTo(Math.SQRT2, 1e-9);
  });

  it("puts both ends on the outline's own corner points", () => {
    const point = contour.points[1];
    const left = getSkeletonRibPosition(contour, point, "left");
    const right = getSkeletonRibPosition(contour, point, "right");
    // 40 half-widths out along (0.707, -0.707) times root two is (40, -40) from
    // the corner, and the same distance the other way.
    expect(left.x).to.equal(140);
    expect(left.y).to.equal(-40);
    expect(right.x).to.equal(60);
    expect(right.y).to.equal(40);
  });

  it("holds the arriving arm's answer where the corner folds back", () => {
    // The two arms run back along each other, so the edges of a side are
    // parallel and never meet. There is no place to reach, and the bar states
    // the width of the arriving stroke, which is what it has always done.
    const folded = {
      ...contour,
      points: [
        { id: 2, x: 0, y: 0, type: null, smooth: false },
        { id: 3, x: 100, y: 0, type: null, smooth: false },
        { id: 4, x: 0, y: 0.0001, type: null, smooth: false },
      ],
    };
    expect(skeletonRibReach(folded, 1)).to.equal(1);
    const normal = calculateNormalAtSkeletonPoint(folded, 1);
    expect(normal.x).to.be.closeTo(0, 1e-6);
    expect(Math.abs(normal.y)).to.be.closeTo(1, 1e-6);
  });

  it("holds it past the miter limit too, where the outline holds", () => {
    // A turn sharp enough that the meeting place stands more than four
    // half-widths out is held by the generator, so the bar is held with it —
    // the two agree at every turn or the bar stops describing the outline.
    const spike = {
      ...contour,
      points: [
        { id: 2, x: 0, y: 0, type: null, smooth: false },
        { id: 3, x: 100, y: 0, type: null, smooth: false },
        { id: 4, x: 0, y: 20, type: null, smooth: false },
      ],
    };
    expect(skeletonRibReach(spike, 1)).to.equal(1);
  });

  it("takes each end from the outline where the outline is handed over", () => {
    // The top of a one. The stem arrives straight up and the flag leaves at 159
    // degrees, so the left side is the outer one and past the miter limit — the
    // outline stops that arm at its own edge end — while the right side is the
    // inner one and its two drawn edges cross a long way down, at (318,273).
    // Neither is a reach along one normal, and both are points the generator
    // already published. The bar takes them as they are.
    const one = {
      id: 1,
      closed: false,
      defaultWidth: 60,
      singleSided: null,
      points: [
        { id: 4, x: 348, y: 0, type: null, smooth: false },
        { id: 5, x: 348, y: 388, type: null, smooth: false },
        { id: 6, x: 316, y: 304, type: "cubic" },
        { id: 7, x: 280, y: 254, type: "cubic" },
        { id: 8, x: 174, y: 226, type: null, smooth: false },
      ],
    };
    const skeletonData = {
      contours: [one],
      generated: [
        {
          skeletonContourId: 1,
          pathContourIndex: 0,
          pointMap: [
            { skeletonPointId: 4, role: "onCurve", side: "left" },
            { skeletonPointId: 5, role: "onCurve", side: "left", arm: "in" },
            { skeletonPointId: 5, role: "onCurve", side: "left", arm: "out" },
            { skeletonPointId: 5, role: "out", side: "left" },
            { skeletonPointId: 8, role: "in", side: "left" },
            { skeletonPointId: 8, role: "onCurve", side: "left" },
            { skeletonPointId: 8, role: "onCurve", side: "right" },
            { skeletonPointId: 8, role: "in", side: "right" },
            { skeletonPointId: 5, role: "out", side: "right" },
            { skeletonPointId: 5, role: "onCurve", side: "right" },
            { skeletonPointId: 4, role: "onCurve", side: "right" },
          ],
        },
      ],
    };
    const path = VarPackedPath.fromUnpackedContours([
      {
        isClosed: true,
        points: [
          { x: 378, y: 0 },
          { x: 381, y: 388 },
          { x: 317, y: 400 },
          { x: 290, y: 328, type: "cubic" },
          { x: 266, y: 281, type: "cubic" },
          { x: 166, y: 255 },
          { x: 182, y: 197 },
          { x: 246, y: 214, type: "cubic" },
          { x: 288, y: 239, type: "cubic" },
          { x: 318, y: 273 },
          { x: 318, y: 0 },
        ],
      },
    ]);
    const ends = getSkeletonRibEndpoints(one, one.points[1], { skeletonData, path });
    expect(ends.left).to.deep.equal({ x: 381, y: 388 });
    expect(ends.right).to.deep.equal({ x: 318, y: 273 });
  });

  it("keeps the plain answer at a point that is not a corner", () => {
    // A straight run has no corner, so nothing is read off the outline even
    // where one is handed over: the bar states the width, not the drawing.
    const straight = {
      ...contour,
      points: [
        { id: 2, x: 0, y: 0, type: null, smooth: false },
        { id: 3, x: 100, y: 0, type: null, smooth: false },
        { id: 4, x: 200, y: 0, type: null, smooth: false },
      ],
    };
    const outline = {
      skeletonData: { contours: [straight], generated: [] },
      path: null,
    };
    const left = getSkeletonRibPosition(straight, straight.points[1], "left", outline);
    expect(left).to.deep.equal({ x: 100, y: -40 });
  });

  it("leaves a smooth point alone", () => {
    const smooth = {
      ...contour,
      points: contour.points.map((point, index) =>
        index === 1 ? { ...point, smooth: true } : point
      ),
    };
    const normal = calculateNormalAtSkeletonPoint(smooth, 1);
    expect(Math.abs(normal.x)).to.be.closeTo(Math.SQRT1_2, 1e-9);
  });
});

describe("skeleton rib reach under a forced angle", () => {
  // A stem at 45 degrees. Its rib is square to it without a lock; forced
  // horizontal it is turned 45 degrees, so it has to run one over the cosine of
  // 45 degrees further to reach the same two edges.
  function stem(ribAngleLock, ribAngleLockMode) {
    const width = { left: 40, right: 40 };
    const point = { type: null, smooth: false, width, ribAngleLock, ribAngleLockMode };
    return {
      id: 1,
      closed: false,
      defaultWidth: 80,
      singleSided: null,
      points: [
        { id: 2, x: 0, y: 0, ...point },
        { id: 3, x: 100, y: 100, ...point },
      ],
    };
  }

  it("reaches one half-width where no angle is forced", () => {
    expect(skeletonRibReach(stem(null), 0)).to.equal(1);
  });

  it("reaches further where the angle is forced", () => {
    expect(skeletonRibReach(stem("horizontal"), 0)).to.be.closeTo(Math.SQRT2, 1e-9);
  });

  // In rib mode the bar is the stored width long whichever way it is turned, so
  // it reaches one half-width and the stroke draws thinner. That is the mode
  // that blends between masters; see the development log.
  it("reaches one half-width in rib mode", () => {
    expect(skeletonRibReach(stem("horizontal", "rib"), 0)).to.equal(1);
  });

  it("puts the rib bar's ends a plain half-width out in rib mode", () => {
    const contour = stem("horizontal", "rib");
    const point = contour.points[0];
    const left = getSkeletonRibPosition(contour, point, "left");
    const right = getSkeletonRibPosition(contour, point, "right");
    expect(Math.abs(left.x - right.x)).to.equal(80);
  });

  it("puts the forced bar's ends on the edges the stroke's own width sets", () => {
    const contour = stem("horizontal");
    const point = contour.points[0];
    const left = getSkeletonRibPosition(contour, point, "left");
    const right = getSkeletonRibPosition(contour, point, "right");
    // The bar is horizontal and 113 long, and the stroke is still 80 across.
    expect(left.y).to.equal(0);
    expect(right.y).to.equal(0);
    expect(Math.abs(left.x - right.x)).to.be.closeTo(80 * Math.SQRT2, 1);
    const across = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    expect(
      Math.abs((left.x - right.x) * across.x + (left.y - right.y) * across.y)
    ).to.be.closeTo(80, 1);
  });
});

describe("reversing a skeleton contour's own point order", () => {
  // Reversing the travel direction turns the tangent around, so the side that
  // was left of it is now right of it. The drawing does not move; what changes
  // is which stored number owns which edge.
  function contour() {
    return {
      id: 1,
      closed: false,
      points: [
        {
          id: 10,
          x: 0,
          y: 0,
          type: null,
          smooth: false,
          width: { left: 10, right: 30 },
          nudge: { left: 3, right: -4 },
          segmentCurvature: { left: 0.7, right: null },
          handleOffsets: { leftOut: { x: 1, y: 2 }, rightIn: { x: 5, y: 6 } },
          capBallSide: "left",
        },
        { id: 11, x: 10, y: 40, type: "cubic" },
        { id: 12, x: 30, y: 60, type: "cubic" },
        {
          id: 13,
          x: 60,
          y: 60,
          type: null,
          smooth: false,
          width: { left: 20, right: 50 },
          nudge: { left: 0, right: 0 },
          segmentCurvature: { left: null, right: null },
          handleOffsets: {},
          capBallSide: null,
        },
      ],
    };
  }

  it("reverses the points and keeps every id", () => {
    const reversed = reverseSkeletonContourPoints(contour());
    expect(reversed.points.map((point) => point.id)).to.deep.equal([13, 12, 11, 10]);
  });

  it("swaps the two sides of every per-side field", () => {
    const reversed = reverseSkeletonContourPoints(contour());
    expect(reversed.points[3].width).to.deep.equal({ left: 30, right: 10 });
    expect(reversed.points[3].nudge).to.deep.equal({ left: -4, right: 3 });
    expect(reversed.points[3].capBallSide).to.equal("right");
  });

  it("swaps the in and out roles as well as the sides", () => {
    // A handle that led out of a point now leads into it, and from the far side.
    const reversed = reverseSkeletonContourPoints(contour());
    const point = reversed.points[3];
    expect(point.handleOffsets.rightIn).to.deep.equal({ x: 1, y: 2 });
    expect(point.handleOffsets.leftOut).to.deep.equal({ x: 5, y: 6 });
  });

  it("carries a curvature pin to the point its segment now starts at", () => {
    // A pin is keyed on its segment's START point. Reversed, that segment starts
    // at the other end, so the pin has to travel or it describes another curve.
    const reversed = reverseSkeletonContourPoints(contour());
    expect(reversed.points[3].segmentCurvature.left).to.equal(null);
    expect(reversed.points[3].segmentCurvature.right).to.equal(null);
    expect(reversed.points[0].segmentCurvature.right).to.equal(0.7);
  });

  it("leaves absolute directions alone", () => {
    // A reversal moves nothing, so anything named in glyph space still means
    // what it meant. Only side ownership and handle role turn over.
    const source = contour();
    source.points[0].ribAngleLock = "horizontal";
    source.points[0].capAngle = 20;
    const reversed = reverseSkeletonContourPoints(source);
    expect(reversed.points[3].ribAngleLock).to.equal("horizontal");
    expect(reversed.points[3].capAngle).to.equal(20);
  });

  it("is its own inverse", () => {
    const source = contour();
    const twice = reverseSkeletonContourPoints(reverseSkeletonContourPoints(source));
    expect(twice).to.deep.equal(source);
  });
});

describe("joining two open skeleton contours", () => {
  function data() {
    const skeletonData = { nextId: 1, contours: [] };
    const first = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    const a = appendSkeletonPoint(skeletonData, first.id, { x: 0, y: 0 });
    const b = appendSkeletonPoint(skeletonData, first.id, { x: 50, y: 0 });
    const second = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    const c = appendSkeletonPoint(skeletonData, second.id, { x: 100, y: 0 });
    const d = appendSkeletonPoint(skeletonData, second.id, { x: 150, y: 0 });
    return { skeletonData, first, second, a, b, c, d };
  }

  it("joins a tail to a head, keeping the first contour", () => {
    const { skeletonData, first, second, b, c } = data();
    const result = joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(result.contourId).to.equal(first.id);
    expect(skeletonData.contours).to.have.length(1);
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 50, 100, 150,
    ]);
  });

  it("joins a head to a tail without reversing anything", () => {
    const { skeletonData, first, second, a, d } = data();
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: a.id },
      { contourId: second.id, pointId: d.id }
    );
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      100, 150, 0, 50,
    ]);
  });

  it("reverses one contour where two tails meet", () => {
    const { skeletonData, first, second, b, d } = data();
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: d.id }
    );
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 50, 150, 100,
    ]);
  });

  it("reverses one contour where two heads meet", () => {
    const { skeletonData, first, second, a, c } = data();
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: a.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      50, 0, 100, 150,
    ]);
  });

  it("never reuses the absorbed contour's id", () => {
    const { skeletonData, first, second, b, c } = data();
    const spent = second.id;
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    const fresh = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    expect(fresh.id).to.not.equal(spent);
  });

  it("closes the contour where both ends are its own", () => {
    // Two ends of one open contour is not a join, it is a close. Answering it
    // here means the one gesture does what the designer meant either way.
    const { skeletonData, first, a, b } = data();
    const result = joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: a.id },
      { contourId: first.id, pointId: b.id }
    );
    expect(result.closed).to.equal(true);
    expect(skeletonData.contours[0].closed).to.equal(true);
    expect(skeletonData.contours[0].points).to.have.length(2);
  });

  it("refuses a point that is not an open end", () => {
    const { skeletonData, first, second, b, c } = data();
    // `b` was the tail; appending past it makes it an interior point.
    appendSkeletonPoint(skeletonData, first.id, { x: 75, y: 0 });
    expect(
      joinSkeletonContours(
        skeletonData,
        { contourId: first.id, pointId: b.id },
        { contourId: second.id, pointId: c.id }
      )
    ).to.equal(null);
  });

  it("refuses to join a closed contour", () => {
    const { skeletonData, first, second, b, c } = data();
    skeletonData.contours[1].closed = true;
    expect(
      joinSkeletonContours(
        skeletonData,
        { contourId: first.id, pointId: b.id },
        { contourId: second.id, pointId: c.id }
      )
    ).to.equal(null);
  });
});

describe("closing a skeleton contour", () => {
  function openContour() {
    const skeletonData = { nextId: 1, contours: [] };
    const contour = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    appendSkeletonPoint(skeletonData, contour.id, { x: 0, y: 0 });
    appendSkeletonPoint(skeletonData, contour.id, { x: 50, y: 0 });
    appendSkeletonPoint(skeletonData, contour.id, { x: 50, y: 50 });
    return { skeletonData, contour };
  }

  it("closes an open contour of three points", () => {
    const { skeletonData, contour } = openContour();
    expect(closeSkeletonContour(skeletonData, contour.id)).to.equal(true);
    expect(skeletonData.contours[0].closed).to.equal(true);
  });

  it("adds no point, so the two ends stay the ends they were", () => {
    const { skeletonData, contour } = openContour();
    closeSkeletonContour(skeletonData, contour.id);
    expect(skeletonData.contours[0].points).to.have.length(3);
  });

  it("refuses a contour that is already closed", () => {
    const { skeletonData, contour } = openContour();
    closeSkeletonContour(skeletonData, contour.id);
    expect(closeSkeletonContour(skeletonData, contour.id)).to.equal(false);
  });

  it("refuses a contour with fewer than two on-curve points", () => {
    const skeletonData = { nextId: 1, contours: [] };
    const contour = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    appendSkeletonPoint(skeletonData, contour.id, { x: 0, y: 0 });
    expect(closeSkeletonContour(skeletonData, contour.id)).to.equal(false);
  });
});

describe("joining and closing on a point that is already there", () => {
  function pointAt(skeletonData, contourId, x, y, extra = {}) {
    return appendSkeletonPoint(skeletonData, contourId, { x, y, ...extra });
  }

  function twoStrokes(meetX, meetY) {
    const skeletonData = { nextId: 1, contours: [] };
    const first = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    const a = pointAt(skeletonData, first.id, 0, 0);
    const b = pointAt(skeletonData, first.id, meetX, meetY);
    const second = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    const c = pointAt(skeletonData, second.id, 50, 0);
    const d = pointAt(skeletonData, second.id, 150, 0);
    return { skeletonData, first, second, a, b, c, d };
  }

  it("keeps one point where the two ends stand in the same place", () => {
    const { skeletonData, first, second, b, c } = twoStrokes(50, 0);
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 50, 150,
    ]);
  });

  it("keeps the surviving contour's own point, not the absorbed one", () => {
    const { skeletonData, first, second, b, c } = twoStrokes(50, 0);
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(skeletonData.contours[0].points[1].id).to.equal(b.id);
  });

  it("hands the absorbed point's handles to the point that survives", () => {
    const { skeletonData, first, second, b, c } = twoStrokes(50, 0);
    // A handle leaving the absorbed end shapes the segment leaving the joint.
    const contour = getSkeletonContour(skeletonData, second.id);
    contour.points.splice(1, 0, { id: 99, x: 70, y: 30, type: "cubic" });
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 50, 70, 150,
    ]);
  });

  it("keeps both points where the two ends stand apart", () => {
    const { skeletonData, first, second, b, c } = twoStrokes(40, 0);
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 40, 50, 150,
    ]);
  });

  it("keeps both where only one coordinate agrees", () => {
    const { skeletonData, first, second, b, c } = twoStrokes(50, 20);
    joinSkeletonContours(
      skeletonData,
      { contourId: first.id, pointId: b.id },
      { contourId: second.id, pointId: c.id }
    );
    expect(skeletonData.contours[0].points).to.have.length(4);
  });

  function loop(lastX, lastY) {
    const skeletonData = { nextId: 1, contours: [] };
    const contour = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    appendSkeletonPoint(skeletonData, contour.id, { x: 0, y: 0 });
    appendSkeletonPoint(skeletonData, contour.id, { x: 50, y: 0 });
    appendSkeletonPoint(skeletonData, contour.id, { x: 50, y: 50 });
    appendSkeletonPoint(skeletonData, contour.id, { x: lastX, y: lastY });
    return { skeletonData, contour };
  }

  it("drops the last point where a close would stack it on the first", () => {
    const { skeletonData, contour } = loop(0, 0);
    expect(closeSkeletonContour(skeletonData, contour.id)).to.equal(true);
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 50, 50,
    ]);
  });

  it("gives the closing segment the dropped point's handles", () => {
    const { skeletonData, contour } = loop(0, 0);
    const points = getSkeletonContour(skeletonData, contour.id).points;
    points.splice(3, 0, { id: 98, x: 20, y: 60, type: "cubic" });
    closeSkeletonContour(skeletonData, contour.id);
    expect(skeletonData.contours[0].points.map((point) => point.x)).to.deep.equal([
      0, 50, 50, 20,
    ]);
    expect(skeletonData.contours[0].closed).to.equal(true);
  });

  it("keeps every point where the two ends stand apart", () => {
    const { skeletonData, contour } = loop(0, 30);
    closeSkeletonContour(skeletonData, contour.id);
    expect(skeletonData.contours[0].points).to.have.length(4);
  });

  it("refuses a close that would leave a single point standing alone", () => {
    // Two coincident on-curves and nothing between them is not a loop, it is one
    // point, and a contour of one point draws nothing.
    const skeletonData = { nextId: 1, contours: [] };
    const contour = appendSkeletonContour(skeletonData, { closed: false, points: [] });
    appendSkeletonPoint(skeletonData, contour.id, { x: 0, y: 0 });
    appendSkeletonPoint(skeletonData, contour.id, { x: 0, y: 0 });
    expect(closeSkeletonContour(skeletonData, contour.id)).to.equal(false);
    expect(skeletonData.contours[0].closed).to.equal(false);
  });
});

describe("the tied flag belongs to the group, not to one rib", () => {
  // A straight from A to B, then a curve on from B. B is smooth carrying one
  // handle, so the straight controls it and the tie reaches back to A.
  function contour(tiedA = true, tiedB = true) {
    return normalizeSkeletonData({
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 60,
          points: [
            {
              id: 1,
              x: 0,
              y: 0,
              type: null,
              smooth: false,
              width: { left: 10, right: 30, tied: tiedA },
            },
            {
              id: 2,
              x: 200,
              y: 0,
              type: null,
              smooth: true,
              width: { left: 50, right: 30, tied: tiedB },
            },
            { id: 3, x: 300, y: 0, type: "cubic" },
            { id: 4, x: 400, y: 100, type: "cubic" },
            {
              id: 5,
              x: 400,
              y: 200,
              type: null,
              smooth: false,
              width: { left: 30, right: 30 },
            },
          ],
        },
      ],
    }).contours[0];
  }

  it("names the group a rib would be tied into, whatever the flags say", () => {
    // Off, the effective group is gone - but the two ribs are still the two ends
    // of one straight, and that is what the flag is written across.
    const off = contour(false, false);
    expect(getTiedRibGroup(off, off.points[0])).to.equal(null);
    const group = getSkeletonRibTieGroup(off, off.points[0]);
    expect(group).to.have.members([off.points[0], off.points[1]]);
  });

  it("clears the flag on every member", () => {
    const data = contour();
    setSkeletonRibTiedAcrossGroup(data, data.points[0], false);
    expect(data.points[0].width.tied).to.equal(false);
    expect(data.points[1].width.tied).to.equal(false);
  });

  it("sets it back on every member, from a point whose group is gone", () => {
    // The re-tie is the case that needs the flag-blind group: with the flags off
    // there is no effective group to carry the write to.
    const data = contour(false, false);
    setSkeletonRibTiedAcrossGroup(data, data.points[0], true);
    expect(data.points[0].width.tied).to.equal(true);
    expect(data.points[1].width.tied).to.equal(true);
    expect(getTiedRibGroup(data, data.points[0])).to.have.length(2);
  });

  it("leaves a rib outside the group alone", () => {
    const data = contour();
    setSkeletonRibTiedAcrossGroup(data, data.points[0], false);
    expect(data.points[4].width.tied).to.not.equal(false);
  });

  it("writes the one rib where it belongs to no group at all", () => {
    const data = contour();
    setSkeletonRibTiedAcrossGroup(data, data.points[4], false);
    expect(data.points[4].width.tied).to.equal(false);
    expect(data.points[0].width.tied).to.not.equal(false);
  });
});

// Inserting a point into an existing stroke: the point has to take the width the stroke
// already has where it lands, measured out to the drawn edges.
describe("skeleton-model - the width where a point lands", () => {
  function straightStroke(halfLeft, halfRight) {
    // A horizontal centerline from (0,0) to (200,0), with its two edges drawn as one
    // closed rectangle, registered as this contour's generated outline. Travelling east,
    // the generator's left side is the one below the centerline.
    const skeletonData = {
      contours: [
        {
          id: 1,
          closed: false,
          points: [
            { id: 2, x: 0, y: 0, width: { left: halfLeft, right: halfRight } },
            { id: 3, x: 200, y: 0, width: { left: halfLeft, right: halfRight } },
          ],
        },
      ],
      generated: [{ skeletonContourId: 1, pathContourIndex: 0, pointMap: [] }],
    };
    const path = new VarPackedPath();
    path.appendUnpackedContour({
      points: [
        { x: 0, y: -halfLeft },
        { x: 200, y: -halfLeft },
        { x: 200, y: halfRight },
        { x: 0, y: halfRight },
      ],
      isClosed: true,
    });
    return { skeletonData: normalizeSkeletonData(skeletonData), path };
  }

  it("measures both edges of a stroke drawn on both sides", () => {
    const { skeletonData, path } = straightStroke(40, 25);
    const measured = measureGeneratedHalfWidths(
      skeletonData,
      1,
      path,
      { x: 100, y: 0 },
      { x: 1, y: 0 }
    );
    expect(measured.left).to.be.closeTo(40, 0.001);
    expect(measured.right).to.be.closeTo(25, 0.001);
  });

  it("answers nothing where a ray meets no edge", () => {
    const { skeletonData, path } = straightStroke(40, 25);
    const measured = measureGeneratedHalfWidths(
      skeletonData,
      1,
      path,
      { x: 500, y: 0 },
      { x: 1, y: 0 }
    );
    expect(measured).to.equal(null);
  });

  it("answers nothing for a contour that generated no outline", () => {
    const { skeletonData, path } = straightStroke(40, 25);
    expect(
      measureGeneratedHalfWidths(
        skeletonData,
        99,
        path,
        { x: 100, y: 0 },
        { x: 1, y: 0 }
      )
    ).to.equal(null);
  });
});

describe("skeleton insertion points", () => {
  it("normalizes a contour with no insertions to an empty list", () => {
    const data = normalizeSkeletonData({
      contours: [makeSkeletonContour({ id: 10, points: [] })],
    });
    expect(data.contours[0].insertions).to.deep.equal([]);
  });

  it("fills every insertion field and never leaves one unset", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [{ id: 12, pointId: 11 }],
        }),
      ],
    });
    expect(data.contours[0].insertions[0]).to.deep.equal({
      id: 12,
      pointId: 11,
      t: 0.5,
      width: { left: 1, right: 1, linked: true },
      easing: 0,
    });
  });

  it("clamps t into 0 to 1 and keeps a stated ratio", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [
            { id: 12, pointId: 11, t: 2, width: { left: 1.5, right: 0.5 }, easing: 3 },
          ],
        }),
      ],
    });
    const insertion = data.contours[0].insertions[0];
    expect(insertion.t).to.equal(1);
    expect(insertion.width.left).to.equal(1.5);
    expect(insertion.width.right).to.equal(0.5);
    expect(insertion.easing).to.equal(1);
  });

  it("allocates an insertion id from the same counter points use", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [{ pointId: 11 }],
        }),
      ],
    });
    const insertion = data.contours[0].insertions[0];
    expect(insertion.id).to.be.a("number");
    expect(insertion.id).to.not.equal(10);
    expect(insertion.id).to.not.equal(11);
    expect(data.nextId).to.be.greaterThan(insertion.id);
  });

  it("drops an insertion whose start point is not on the contour", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [{ id: 12, pointId: 999 }],
        }),
      ],
    });
    expect(data.contours[0].insertions).to.deep.equal([]);
  });
});
