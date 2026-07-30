import {
  DEFAULT_SKELETON_WIDTH,
  SKELETON_SCHEMA_VERSION,
  allocateSkeletonIds,
  appendSkeletonContour,
  appendSkeletonPoint,
  buildSegmentsFromSkeletonPoints,
  calculateNormalAtSkeletonPoint,
  clearSkeletonData,
  deleteSkeletonPoints,
  getSkeletonContour,
  getSkeletonData,
  getSkeletonHandleOffset,
  getSkeletonHandleOffsetKey,
  getSkeletonPoint,
  getSkeletonPointHalfWidth,
  getSkeletonPointNudge,
  getSkeletonPointWidth,
  getSkeletonRibSidesForPoint,
  makeEmptySkeletonData,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  normalizeSkeletonPoint,
  projectSkeletonRibPoint,
  resetSkeletonEditableRib,
  resetSkeletonEditableRibHandle,
  resetSkeletonEditableRibHandles,
  setSkeletonCapParameters,
  setSkeletonContourDefaultWidth,
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
  setSkeletonPointWidthLinked,
  transformSkeletonData,
  transformSkeletonPointMetadata,
  translateSkeletonData,
  updateSkeletonPoint,
} from "@fontra/core/skeleton-model.js";
import { Transform } from "@fontra/core/transform.js";
import { expect } from "chai";

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
          cornerTrimRatio: 0.5,
          cornerRadiusBoost: 1.5,
          points: [
            { x: 0, y: 0, capStyle: "square", capAngle: 30, capDistance: 12 },
            {
              x: 10,
              y: 0,
              capStyle: "bogus",
              capRadiusRatio: 0.25,
              capTension: 0.6,
              roundnessStrength: 0.8,
              cornerAsymmetry: -0.2,
            },
          ],
        },
      ],
    });

    const contour = normalized.contours[0];
    expect(contour).to.include({
      capStyle: "round",
      reversed: true,
      cornerTrimRatio: 0.5,
      cornerRadiusBoost: 1.5,
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
      roundnessStrength: 0.8,
      cornerAsymmetry: -0.2,
    });
  });

  it("preserves point-level corner-rounding fields through normalization", () => {
    const normalized = normalizeSkeletonData({
      nextId: 1,
      contours: [
        {
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

    expect(normalized.contours[0].points[0]).to.include({
      cornerRoundness: 0.4,
      cornerReach: 0.6,
      roundnessStrength: 1.5,
      cornerAsymmetry: 0.25,
    });
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
      locked: { left: false, right: true },
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
      cornerRoundness: 0.5,
      cornerReach: 0.7,
      roundnessStrength: 2,
      cornerAsymmetry: 0.3,
    });

    deleteSkeletonPoints(skeleton, [[contour.id, a.id]]);

    const newFirst = getSkeletonContour(skeleton, contour.id).points[0];
    expect(newFirst.id).to.equal(b.id);
    expect(newFirst.capStyle).to.equal("square");
    expect(newFirst.capAngle).to.equal(30);
    // corner rounding belongs to the angle-point engine, not to caps
    expect(newFirst.cornerRoundness).to.equal(undefined);
    expect(newFirst.cornerReach).to.equal(undefined);
    expect(newFirst.roundnessStrength).to.equal(undefined);
    expect(newFirst.cornerAsymmetry).to.equal(undefined);
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

  it("linked side width preserves an asymmetric distribution", () => {
    const point = makePoint({ width: { left: 60, right: 20, linked: true } });
    setSkeletonPointSideWidth(point, 80, "left", 50);
    expect(point.width.left).to.equal(50);
    expect(point.width.right).to.equal(10);
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
      locked: { left: true, right: false },
      nudge: { left: 5, right: 5 },
      handleOffsets: { leftIn: { x: 1, y: 2, detached: true } },
    });
    setSkeletonPointWidthDistribution(point, 80, -100);
    expect(point.nudge.left).to.equal(0);
    expect(point.handleOffsets.leftIn).to.equal(undefined);
    // Collapsing is a geometry change; it must not touch lock state.
    expect(point.locked.left).to.equal(true);
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

  it("corner params write canonical corner fields only", () => {
    const point = makePoint();
    setSkeletonCornerParameters(point, {
      cornerRoundness: 0.4,
      cornerReach: 0.6,
      roundnessStrength: 0.5,
      cornerAsymmetry: -0.25,
      cornerTrimRatio: 0.9,
    });
    expect(point.cornerRoundness).to.equal(0.4);
    expect(point.cornerReach).to.equal(0.6);
    expect(point.roundnessStrength).to.equal(0.5);
    expect(point.cornerAsymmetry).to.equal(-0.25);
    expect(point.cornerTrimRatio).to.equal(undefined);
  });

  it("reset rib removes nudge/handle offsets/curvature for one side, leaving locks", () => {
    const point = makePoint({
      locked: { left: true, right: true },
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
    expect(point.locked.left).to.equal(true);
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
              locked: { left: true, right: false },
              segmentCurvature: { left: 0.3, right: 0.8 },
              capBallSide: "left",
              capAngle: 12,
              cornerAsymmetry: -0.25,
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
    expect(point.locked).to.deep.equal({ left: false, right: true });
    expect(point.segmentCurvature).to.deep.equal({ left: 0.8, right: 0.3 });
    expect(point.handleOffsets).to.deep.equal({
      leftIn: { x: 6, y: 7, detached: false },
      leftOut: { x: -8, y: -9, detached: true },
      rightIn: { x: -10, y: 2, detached: true },
      rightOut: { x: -4, y: 5, detached: false },
    });
    expect(point.capBallSide).to.equal("right");
    expect(point.capAngle).to.equal(-12);
    expect(point.cornerAsymmetry).to.equal(0.25);
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
    expect(point.cornerAsymmetry).to.equal(-0.25);
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
  it("accepts serif as a cap style", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0, capStyle: "serif" });
    expect(point.capStyle).to.equal("serif");
  });

  it("fills every half field, leaving unset values null", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { left: { wingLength: 40 } },
    });
    expect(point.serif.left.wingLength).to.equal(40);
    expect(point.serif.left.tension).to.equal(null);
    expect(point.serif.right.wingLength).to.equal(null);
    expect(Object.keys(point.serif.left)).to.have.length(7);
  });

  it("defaults the axis mode and the link flag", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    expect(point.serif.axisMode).to.equal("perpendicular");
    expect(point.serif.axisAngle).to.equal(0);
    expect(point.serif.linked).to.equal(true);
  });

  it("rejects an unknown axis mode", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { axisMode: "diagonal" },
    });
    expect(point.serif.axisMode).to.equal("perpendicular");
  });

  it("leaves terminal-level values null when unset", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    expect(point.serif.undersideCup).to.equal(null);
    expect(point.serif.straightDepth).to.equal(null);
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
