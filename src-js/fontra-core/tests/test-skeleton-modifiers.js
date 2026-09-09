import { applyChange } from "@fontra/core/changes.js";
import {
  applyFixedRibDelta,
  equalizeEditableGeneratedHandleOffsets,
  equalizeSkeletonHandleFromDelta,
  equalizeSkeletonHandleToPoint,
  findGeneratedPathAddress,
  getSkeletonData,
  getSkeletonHandleEqualizeInfo,
  getSkeletonSegmentCurvature,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  parseSkeletonPointKey,
  setSkeletonData,
  setSkeletonSegmentCurvature,
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

describe("fixed-rib drag geometry", () => {
  it("offsets a curved segment instead of shearing its handles", () => {
    // A quarter-circle cubic of radius 100 about the origin. Both endpoints are
    // selected, so the whole segment moves out along its own normals by the same
    // distance - a constant-distance offset, whose result is the concentric arc.
    const original = makeArcSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));
    const radiusBefore = midRadius(original.contours[0].points);

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/50/1", "skeletonPoint/50/4"]),
      "skeletonPoint/50/1",
      { x: 20, y: 0 }
    );

    const points = working.contours[0].points;
    expect(points[0]).to.include({ x: 120, y: 0 });
    expect(points[3]).to.include({ x: 0, y: 120 });
    // The middle of the arc has to travel the same 20 units as its ends. Moving
    // the handles by an interpolation of the two endpoint deltas leaves it about
    // 6 units short, because it never lengthens them.
    expect(midRadius(points) - radiusBefore).to.be.closeTo(20, 0.6);
  });

  it("carries a tension point's whole straight, not just the dragged end", () => {
    // Point 2 is smooth with a single handle, so the straight 1-2 owns its
    // direction and the two ribs are tied. Dragging either end must move both.
    const original = makeTensionPointSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/60/1"]),
      "skeletonPoint/60/1",
      { x: 0, y: -10 }
    );

    const points = working.contours[0].points;
    expect(points[0]).to.include({ x: 0, y: -10 });
    expect(points[1]).to.include({ x: 100, y: -10 });
    expect(points[1].width.right).to.equal(points[0].width.right);
  });

  it("changes only the width on a single-sided contour", () => {
    // The skeleton is one edge of a single-sided stroke, so it must hold still:
    // the drag moves the generated edge, which is the sum of the half-widths.
    const original = makeSingleSidedSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/70/1", "skeletonPoint/70/2"]),
      "skeletonPoint/70/1",
      { x: 0, y: -10 }
    );

    const before = original.contours[0].points[0];
    const after = working.contours[0].points[0];
    expect(after).to.include({ x: before.x, y: before.y });
    expect(after.width.left + after.width.right).to.equal(
      before.width.left + before.width.right + 10
    );
  });

  // Single-sided renders the SUM of the two half-widths on the visible side, so
  // the split between them is nothing the drag has any business touching. It is
  // still the distribution the point returns to when the contour goes back to
  // double-sided, and a drag that quietly rewrites it changes a shape the
  // designer cannot even see while they are working.
  const distributionOf = (point) => {
    const total = point.width.left + point.width.right;
    return total > 0 ? ((point.width.left - point.width.right) / total) * 100 : 0;
  };

  it("leaves the width distribution alone on a single-sided contour", () => {
    const original = makeSingleSidedSkeleton();
    original.contours[0].points[0].width = { left: 60, right: 20 };
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/70/1", "skeletonPoint/70/2"]),
      "skeletonPoint/70/1",
      { x: 0, y: -10 }
    );

    const after = working.contours[0].points[0];
    expect(after.width.left + after.width.right).to.equal(90);
    // Held to within grid rounding, which is as well as it can be held: the two
    // sides are whole units, so a 60/20 split at a total of 90 wants 67.5/22.5 and
    // has to land on 68/22. One unit of either side is 100/total percent of the
    // distribution — 1.2 here. Rounding both sides independently, as this used to,
    // would instead have missed the total itself.
    expect(distributionOf(after)).to.be.closeTo(
      distributionOf(original.contours[0].points[0]),
      100 / 90
    );
  });

  it("stops a single-sided drag at a total width of 2, not at the far side's", () => {
    // The floor belongs to the width the designer sees, which single-sided reads
    // as the total. Flooring one side instead stopped the edge a whole far-side
    // width away from the skeleton.
    const original = makeSingleSidedSkeleton();
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/70/1", "skeletonPoint/70/2"]),
      "skeletonPoint/70/1",
      { x: 0, y: 500 }
    );

    for (const point of working.contours[0].points) {
      expect(point.width.left + point.width.right).to.equal(2);
    }
  });

  it("holds a point still once its own rib is at the floor", () => {
    // Double-sided: the anchor edge is pinned by taking the drag back out of the
    // half-width. Once that width can give no more, the point has to stop moving
    // too — otherwise the drag carries on and the edge it was pinning walks away.
    // Each point stops on its own, so a narrow one does not hold up a wide one.
    const original = makeLineSkeleton();
    original.contours[0].points[0].width = { left: 40, right: 40 };
    original.contours[0].points[1].width = { left: 4, right: 4 };
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/10/1", "skeletonPoint/10/2"]),
      "skeletonPoint/10/1",
      { x: 0, y: 20 },
      // Compress: the anchor is the side the drag moves toward, and it is the one
      // that gives up width. Plain fixed-rib anchors the far side, which grows.
      { compress: true }
    );

    const [wide, narrow] = working.contours[0].points;
    // The narrow point could only give 3 of the 20 before hitting the floor.
    expect(narrow.width.right).to.equal(1);
    expect(narrow.y).to.equal(original.contours[0].points[1].y + 3);
    // The wide one had room for all 20 and must not have been held back.
    expect(wide.width.right).to.equal(20);
    expect(wide.y).to.equal(original.contours[0].points[0].y + 20);
  });

  it("stops the handles too, not just the on-curves", () => {
    // Past the floor the drag must do nothing at all. The on-curves were being
    // held while the segment's HANDLES kept scaling by the raw drag, so on a
    // curved skeleton — which is every real one — the shape carried on moving.
    const atTheFloor = makeArcSkeleton();
    for (const point of atTheFloor.contours[0].points) {
      point.width = { left: 12, right: 12, linked: true };
    }
    const selection = new Set(["skeletonPoint/50/1", "skeletonPoint/50/4"]);
    const drag = (magnitude) => {
      const working = normalizeSkeletonData(structuredClone(atTheFloor));
      applyFixedRibDelta(
        atTheFloor,
        working,
        selection,
        "skeletonPoint/50/1",
        { x: magnitude, y: 0 },
        { compress: true }
      );
      return working.contours[0].points;
    };

    // 11 of the 12 units is all the rib can give. Anything past that is refused.
    expect(drag(200)).to.deep.equal(drag(11));
  });

  it("stops on whichever of the two sides runs out first", () => {
    // Linked ribs move both sides by the same amount, so the FAR side can reach
    // the floor before the anchor does. It used to be pinned at zero there while
    // the drag carried on compressing the anchor — the opposite edge sitting on
    // the skeleton, visibly done, and the drag still going.
    const original = makeLineSkeleton();
    original.contours[0].points[0].width = { left: 60, right: 10, linked: true };
    original.contours[0].points[1].width = { left: 60, right: 10, linked: true };
    const working = normalizeSkeletonData(structuredClone(original));

    applyFixedRibDelta(
      original,
      working,
      new Set(["skeletonPoint/10/1", "skeletonPoint/10/2"]),
      "skeletonPoint/10/1",
      { x: 0, y: -40 },
      { compress: true }
    );

    for (const point of working.contours[0].points) {
      // The right side had 9 units to give before the floor; the left keeps the
      // rest of its width rather than being compressed on alone.
      expect(point.width.right).to.equal(1);
      expect(point.width.left).to.equal(51);
    }
  });
});

// Radius of the segment's midpoint about the origin, for the arc fixture.
function midRadius(points) {
  const [p0, p1, p2, p3] = points;
  const at = (a, b, c, d) => (a + 3 * b + 3 * c + d) / 8;
  return Math.hypot(at(p0.x, p1.x, p2.x, p3.x), at(p0.y, p1.y, p2.y, p3.y));
}

function makeArcSkeleton() {
  return normalizeSkeletonData({
    contours: [
      makeSkeletonContour({
        id: 50,
        defaultWidth: 80,
        points: [
          makeSkeletonPoint({ id: 1, x: 100, y: 0 }),
          makeSkeletonPoint({ id: 2, x: 100, y: 55, type: "cubic" }),
          makeSkeletonPoint({ id: 3, x: 55, y: 100, type: "cubic" }),
          makeSkeletonPoint({ id: 4, x: 0, y: 100 }),
        ],
      }),
    ],
  });
}

function makeTensionPointSkeleton() {
  return normalizeSkeletonData({
    contours: [
      makeSkeletonContour({
        id: 60,
        defaultWidth: 80,
        points: [
          makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
          makeSkeletonPoint({ id: 2, x: 100, y: 0, smooth: true }),
          makeSkeletonPoint({ id: 3, x: 150, y: 0, type: "cubic" }),
          makeSkeletonPoint({ id: 4, x: 200, y: 100 }),
        ],
      }),
    ],
  });
}

function makeSingleSidedSkeleton() {
  return normalizeSkeletonData({
    contours: [
      makeSkeletonContour({
        id: 70,
        defaultWidth: 80,
        singleSided: "left",
        points: [
          makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
          makeSkeletonPoint({ id: 2, x: 100, y: 0 }),
        ],
      }),
    ],
  });
}

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
describe("direct handle drags override a stored curvature", () => {
  // A pin and a direct handle drag are two answers to the same question, and the
  // direct one is the later and more specific of the two: dragging the handle by
  // hand has to win, or the segment fights the cursor.
  const dragHandle = (layer, role, delta) => {
    const selection = new Set([`editableGeneratedHandle/80/4/left/${role}`]);
    const targetEntries = createEditableGeneratedHandleTargetEntries(
      layer,
      selection,
      "generated-handle-move",
      { referenceSkeletonData: getSkeletonData(layer) }
    );
    expect(targetEntries).to.have.length(1);
    applyChange(layer, targetEntries[0].makeChangeForDelta(delta));
  };

  const pointById = (layer, id) =>
    getSkeletonData(layer).contours[0].points.find((point) => point.id === id);

  const pin = (layer, id) => getSkeletonSegmentCurvature(pointById(layer, id), "left");

  const makePinnedLayer = () => {
    const layer = makeLayerGlyph(makeEditableGeneratedHandleSkeleton());
    editSkeleton(layer, (working) => {
      for (const id of [1, 4]) {
        setSkeletonSegmentCurvature(
          working.contours[0].points.find((point) => point.id === id),
          "left",
          0.6
        );
      }
    });
    return layer;
  };

  it("clears the pin of the segment an out handle leaves", () => {
    const layer = makePinnedLayer();
    expect(pin(layer, 4)).to.equal(0.6);
    dragHandle(layer, "out", { x: 4, y: -3 });
    expect(pin(layer, 4)).to.equal(null);
    // The segment arriving at point 4 is a different segment and keeps its own.
    expect(pin(layer, 1)).to.equal(0.6);
  });

  it("clears the pin of the segment an in handle arrives on", () => {
    const layer = makePinnedLayer();
    dragHandle(layer, "in", { x: 4, y: -3 });
    expect(pin(layer, 1)).to.equal(null);
    expect(pin(layer, 4)).to.equal(0.6);
  });

  // Discarding the pin must not MOVE anything. The pin contributes length to
  // both of its segment's handles, so dropping it bare snaps them back to the
  // fit's own answer — the curvature the designer just set, thrown away the
  // instant a handle is touched, with the drag then starting from a position
  // they never chose. A zero-delta drag is the test: it clears the pin and
  // moves nothing.
  const generatedPosition = (layer, pointId, role) => {
    const pathAddress = findGeneratedPathAddress(
      getSkeletonData(layer),
      80,
      pointId,
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

  it("holds both of the segment's handles still while the pin is discarded", () => {
    const layer = makePinnedLayer();
    // The segment leaving point 4: its start handle is out at 4, its end handle
    // is in at 7. The pin sets the two lengths together, so both move when it
    // goes — and only one of them is ever under the cursor.
    const before = [
      generatedPosition(layer, 4, "out"),
      generatedPosition(layer, 7, "in"),
    ];
    dragHandle(layer, "out", { x: 0, y: 0 });
    expect(pin(layer, 4)).to.equal(null);
    expect(generatedPosition(layer, 4, "out")).to.deep.equal(before[0]);
    expect(generatedPosition(layer, 7, "in")).to.deep.equal(before[1]);
  });
});

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
