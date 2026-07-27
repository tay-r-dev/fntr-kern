import { applyChange } from "@fontra/core/changes.js";
import {
  applyFixedRibDelta,
  equalizeEditableGeneratedHandleOffsets,
  equalizeSkeletonHandleFromDelta,
  equalizeSkeletonHandleToPoint,
  findGeneratedPathAddress,
  getSkeletonData,
  getSkeletonHandleEqualizeInfo,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  parseSkeletonPointKey,
  setSkeletonData,
} from "@fontra/core/skeleton-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import { EditBehaviorFactory } from "../../views-editor/src/edit-behavior.js";
import {
  createEditableGeneratedHandleTargetEntries,
  editSkeleton,
  makeSkeletonPointKey,
  makeSkeletonPointTargetEntry,
} from "../../views-editor/src/skeleton-editing.js";

before(() => {
  globalThis.window = {
    coarseGridSpacing: 1,
    event: null,
  };
});

describe("skeleton point key helpers", () => {
  it("rejects malformed keys instead of returning NaN addresses", () => {
    expect(parseSkeletonPointKey("skeletonPoint/10")).to.equal(null);
    expect(parseSkeletonPointKey("skeletonPoint/x/1")).to.equal(null);
    expect(parseSkeletonPointKey("skeletonPoint/10/1/extra")).to.equal(null);
  });
});

describe("skeleton modifier fixed-rib helpers", () => {
  it("moves selected on-curve points and expands the opposite anchored width", () => {
    const original = makeLineSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));

    const changed = applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/10/1"]),
      "skeletonPoint/10/1",
      { x: 0, y: -10 }
    );

    expect(changed).to.equal(true);
    expect(working.contours[0].points[0]).to.include({ x: 0, y: -10 });
    expect(working.contours[0].points[0].width).to.deep.equal({
      tied: true,
      left: 50,
      right: 50,
      linked: true,
    });
  });

  it("compresses the drag-side anchored width", () => {
    const original = makeLineSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/10/1"]),
      "skeletonPoint/10/1",
      { x: 0, y: -10 },
      { compress: true }
    );

    expect(working.contours[0].points[0]).to.include({ x: 0, y: -10 });
    expect(working.contours[0].points[0].width).to.deep.equal({
      tied: true,
      left: 30,
      right: 30,
      linked: true,
    });
  });

  it("returns false without a clicked point or with a clicked off-curve point", () => {
    const original = makeLineSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));

    expect(
      applyFixedRibDelta(original, working, new Set(["skeletonPoint/10/1"]), null, {
        x: 0,
        y: -10,
      })
    ).to.equal(false);

    const cubicOriginal = normalizeSkeletonData({
      contours: [
        {
          id: 20,
          points: [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: 50, y: 50, type: "cubic" },
            { id: 3, x: 100, y: 0 },
          ],
        },
      ],
    });
    const cubicWorking = normalizeSkeletonData(structuredClone(cubicOriginal));
    expect(
      applyFixedRibDelta(
        cubicOriginal,
        cubicWorking,
        new Set(["skeletonPoint/20/2"]),
        "skeletonPoint/20/2",
        { x: 0, y: -10 }
      )
    ).to.equal(false);
  });

  it("moves cubic control points with selected segment endpoints", () => {
    const original = normalizeSkeletonData({
      contours: [
        {
          id: 30,
          defaultWidth: 80,
          points: [
            { id: 1, x: 0, y: 0, width: { left: 40, right: 40, linked: true } },
            { id: 2, x: 30, y: 50, type: "cubic" },
            { id: 3, x: 70, y: 50, type: "cubic" },
            { id: 4, x: 100, y: 0, width: { left: 40, right: 40, linked: true } },
          ],
        },
      ],
    });
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/30/1", "skeletonPoint/30/4"]),
      "skeletonPoint/30/1",
      { x: 0, y: -10 },
      { scaleControlPoints: true }
    );

    expect(working.contours[0].points[1]).not.to.include({ x: 30, y: 50 });
    expect(working.contours[0].points[2]).not.to.include({ x: 70, y: 50 });
    expect(working.contours[0].points[1].y).to.be.lessThan(50);
    expect(working.contours[0].points[2].y).to.be.lessThan(50);
  });
});

describe("skeleton modifier equalize helpers", () => {
  it("finds the smooth on-curve and opposite handle for a cubic off-curve", () => {
    const contour = makeSmoothHandleContour();

    expect(getSkeletonHandleEqualizeInfo(contour, 2)).to.deep.equal({
      smoothPointId: 1,
      oppositePointId: 3,
      smoothIndex: 1,
      oppositeIndex: 3,
    });
  });

  it("equalizes skeleton handle drag around the smooth point", () => {
    const contour = makeSmoothHandleContour();

    const changed = equalizeSkeletonHandleToPoint(contour, 2, { x: 80, y: 0 });

    expect(changed).to.equal(true);
    expect(contour.points[2]).to.include({ x: 80, y: 0 });
    expect(contour.points[3]).to.include({ x: 20, y: 0 });
  });

  it("equalizes skeleton handle arrow nudge while preserving opposite direction", () => {
    const contour = makeSmoothHandleContour();

    const changed = equalizeSkeletonHandleFromDelta(contour, 2, { x: 20, y: 0 });

    expect(changed).to.equal(true);
    expect(contour.points[2]).to.include({ x: 80, y: 0 });
    expect(contour.points[3]).to.include({ x: 20, y: 0 });
  });

  it("equalizes editable generated handle lengths around the rib point", () => {
    const point = makeSkeletonPoint({
      handleOffsets: {
        leftIn: { x: 0, y: 0, detached: false },
        leftOut: { x: 5, y: 0, detached: false },
      },
    });
    // Rib point at origin; dragged (out) handle at (25, 0) with base (20, 0);
    // opposite (in) handle at (-10, 0) with base (-10, 0).
    const geometry = {
      ribPos: { x: 0, y: 0 },
      draggedPos: { x: 25, y: 0 },
      oppositePos: { x: -10, y: 0 },
      draggedBase: { x: 20, y: 0 },
      oppositeBase: { x: -10, y: 0 },
      draggedDirection: { x: 1, y: 0 },
      draggedDetached: false,
      oppositeDetached: false,
    };

    const changed = equalizeEditableGeneratedHandleOffsets(
      point,
      "left",
      "out",
      { x: 15, y: 0 },
      geometry
    );

    // Dragged handle lands at (40, 0): length 40 from the rib point. The
    // opposite handle must take the SAME length along its own direction:
    // (-40, 0), i.e. offset (-30, 0) from its base — true equalization of
    // handle lengths, not equal offset deltas.
    expect(changed).to.equal(true);
    expect(point.handleOffsets.leftOut).to.deep.equal({
      x: 20,
      y: 0,
      detached: false,
    });
    expect(point.handleOffsets.leftIn).to.deep.equal({
      x: -30,
      y: 0,
      detached: false,
    });
  });

  it("equalize can move the dragged handle inside its base position", () => {
    const point = makeSkeletonPoint({
      handleOffsets: {
        leftIn: { x: 0, y: 0, detached: false },
        leftOut: { x: 0, y: 0, detached: false },
      },
    });
    const geometry = {
      ribPos: { x: 0, y: 0 },
      draggedPos: { x: 20, y: 0 },
      oppositePos: { x: -20, y: 0 },
      draggedBase: { x: 20, y: 0 },
      oppositeBase: { x: -20, y: 0 },
      draggedDirection: { x: 1, y: 0 },
      draggedDetached: false,
      oppositeDetached: false,
    };

    // Drag toward the rib point, well past the old zero-offset floor.
    const changed = equalizeEditableGeneratedHandleOffsets(
      point,
      "left",
      "out",
      { x: -15, y: 0 },
      geometry
    );

    expect(changed).to.equal(true);
    // Dragged handle at (5, 0): offset (-15, 0). Opposite matches length 5:
    // (-5, 0), offset (15, 0).
    expect(point.handleOffsets.leftOut).to.deep.equal({
      x: -15,
      y: 0,
      detached: false,
    });
    expect(point.handleOffsets.leftIn).to.deep.equal({
      x: 15,
      y: 0,
      detached: false,
    });
  });
});

describe("skeleton modifier target-entry parity fixtures", () => {
  it("applies fixed-rib skeleton point movement through target-entry persistence", () => {
    const layer = makeLayerGlyph(makeLineSkeleton());
    const selection = new Set(["skeletonPoint/10/1"]);
    const targetEntry = makeSkeletonPointTargetEntry(
      layer,
      selection,
      "fixed-rib",
      getSkeletonData(layer),
      { clickedSkeletonPointKey: makeSkeletonPointKey(10, 1) }
    );
    const behavior = new EditBehaviorFactory(layer, selection, false, {
      targetEntries: [targetEntry],
    }).getBehavior("fixed-rib");

    applyChange(layer, behavior.makeChangeForDelta({ x: 0, y: -10 }));

    const point = getSkeletonData(layer).contours[0].points[0];
    expect(point).to.include({ x: 0, y: -10 });
    expect(point.width).to.deep.equal({
      left: 50,
      right: 50,
      linked: true,
      tied: true,
    });
    expect(layer.path.numContours).to.be.greaterThan(0);
  });

  it("applies fixed-rib-compress skeleton point movement through target-entry persistence", () => {
    const layer = makeLayerGlyph(makeLineSkeleton());
    const selection = new Set(["skeletonPoint/10/1"]);
    const targetEntry = makeSkeletonPointTargetEntry(
      layer,
      selection,
      "fixed-rib-compress",
      getSkeletonData(layer),
      { clickedSkeletonPointKey: makeSkeletonPointKey(10, 1) }
    );
    const behavior = new EditBehaviorFactory(layer, selection, false, {
      targetEntries: [targetEntry],
    }).getBehavior("fixed-rib-compress");

    applyChange(layer, behavior.makeChangeForDelta({ x: 0, y: -10 }));

    const point = getSkeletonData(layer).contours[0].points[0];
    expect(point).to.include({ x: 0, y: -10 });
    expect(point.width).to.deep.equal({
      left: 30,
      right: 30,
      linked: true,
      tied: true,
    });
  });

  it("ignores fixed-rib skeleton point selections on layers without skeleton data", () => {
    const layer = makeLayerGlyph();

    expect(
      makeSkeletonPointTargetEntry(
        layer,
        new Set(["skeletonPoint/10/1"]),
        "fixed-rib",
        null,
        { clickedSkeletonPointKey: makeSkeletonPointKey(10, 1) }
      )
    ).to.equal(null);
  });

  it("equalizes skeleton handles through target-entry persistence", () => {
    const layer = makeLayerGlyph(
      normalizeSkeletonData({
        contours: [
          makeSkeletonContour({
            id: 40,
            points: makeSmoothHandleContour().points,
          }),
        ],
      })
    );
    const selection = new Set(["skeletonPoint/40/2"]);
    const targetEntry = makeSkeletonPointTargetEntry(
      layer,
      selection,
      "equalize",
      getSkeletonData(layer)
    );
    const behavior = new EditBehaviorFactory(layer, selection, false, {
      targetEntries: [targetEntry],
    }).getBehavior("equalize");

    applyChange(layer, behavior.makeChangeForDelta({ x: 20, y: 0 }));

    const points = getSkeletonData(layer).contours[0].points;
    expect(points[2]).to.include({ x: 80, y: 0 });
    expect(points[3]).to.include({ x: 20, y: 0 });
  });

  it("bounds editable generated handle equalization through the live target-entry path", () => {
    const layer = makeLayerGlyph(makeEditableGeneratedHandleSkeleton());
    // Materialize the generated path + provenance-based pointMap.
    editSkeleton(layer, () => {});
    const selection = new Set(["editableGeneratedHandle/80/4/left/out"]);
    const targetEntries = createEditableGeneratedHandleTargetEntries(
      layer,
      selection,
      "alternate",
      { referenceSkeletonData: getSkeletonData(layer) }
    );
    const behavior = new EditBehaviorFactory(layer, selection, false, {
      targetEntries,
    }).getBehavior("alternate");

    const positionOf = (role) => {
      const pathAddress = findGeneratedPathAddress(
        getSkeletonData(layer),
        80,
        4,
        "left",
        role
      );
      return layer.path.getPoint(
        layer.path.getAbsolutePointIndex(
          pathAddress.pathContourIndex,
          pathAddress.contourPointIndex
        )
      );
    };
    const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const ribBefore = positionOf("onCurve");
    const outBefore = positionOf("out");
    const baseOutLength = distance(outBefore, ribBefore);
    // Drag straight toward the rib point, past the old zero-offset floor.
    const inward = {
      x: ((ribBefore.x - outBefore.x) / baseOutLength) * 10,
      y: ((ribBefore.y - outBefore.y) / baseOutLength) * 10,
    };

    applyChange(layer, behavior.makeChangeForDelta(inward));

    const rib = positionOf("onCurve");
    const outLength = distance(positionOf("out"), rib);
    const inLength = distance(positionOf("in"), rib);
    // The opposite segment only has 30 units of construction reach. Equalize
    // records the requested split, but emission must stop that handle at the
    // tension-1 ceiling rather than recreating the old post-bound overshoot.
    expect(inLength).to.be.closeTo(30, 0.001);
    expect(inLength).to.be.lessThan(outLength);
    // No minimum-distance floor: the handle went inside its base position.
    expect(outLength).to.be.lessThan(baseOutLength);
  });
});

function makeLineSkeleton() {
  return normalizeSkeletonData({
    contours: [
      makeSkeletonContour({
        id: 10,
        defaultWidth: 80,
        points: [
          makeSkeletonPoint({
            id: 1,
            x: 0,
            y: 0,
            width: { left: 40, right: 40, linked: true },
          }),
          makeSkeletonPoint({
            id: 2,
            x: 100,
            y: 0,
            width: { left: 40, right: 40, linked: true },
          }),
        ],
      }),
    ],
  });
}

function makeSmoothHandleContour() {
  return makeSkeletonContour({
    id: 40,
    points: [
      makeSkeletonPoint({ id: 4, x: 0, y: 0 }),
      makeSkeletonPoint({ id: 1, x: 50, y: 0, smooth: true }),
      makeSkeletonPoint({ id: 2, x: 60, y: 0, type: "cubic" }),
      makeSkeletonPoint({ id: 3, x: 40, y: 0, type: "cubic" }),
      makeSkeletonPoint({ id: 5, x: 100, y: 0 }),
    ],
  });
}

function makeLayerGlyph(skeletonData = null) {
  const layer = {
    path: new VarPackedPath(),
    components: [],
    anchors: [],
    guidelines: [],
    customData: {},
  };
  if (skeletonData) {
    setSkeletonData(layer, skeletonData);
  }
  return layer;
}

// A middle smooth on-curve (id 4) between two curve segments, editable on the
// left: its generated left contour carries onCurve/in/out provenance so the
// editable-handle machinery can run against a REAL generated path.
function makeEditableGeneratedHandleSkeleton() {
  return normalizeSkeletonData({
    contours: [
      makeSkeletonContour({
        id: 80,
        defaultWidth: 80,
        points: [
          makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
          makeSkeletonPoint({ id: 2, x: 30, y: 40, type: "cubic" }),
          makeSkeletonPoint({ id: 3, x: 70, y: 40, type: "cubic" }),
          makeSkeletonPoint({
            id: 4,
            x: 100,
            y: 0,
            smooth: true,
            editable: { left: true },
          }),
          makeSkeletonPoint({ id: 5, x: 130, y: -40, type: "cubic" }),
          makeSkeletonPoint({ id: 6, x: 170, y: -40, type: "cubic" }),
          makeSkeletonPoint({ id: 7, x: 200, y: 0 }),
        ],
      }),
    ],
  });
}
