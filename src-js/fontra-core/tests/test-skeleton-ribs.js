import { applyChange } from "@fontra/core/changes.js";
import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import {
  applySkeletonRibExecutorResult,
  createSkeletonRibExecutor,
  findGeneratedPathAddress,
  getEffectiveRibHalfWidth,
  getSkeletonData,
  getSkeletonRibAddress,
  getSkeletonRibPosition,
  getTiedRibGroup,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  setSkeletonData,
  setSkeletonHandleDetached,
  setSkeletonHandleOffset,
} from "@fontra/core/skeleton-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import {
  createEditableGeneratedPointTargetEntries,
  createSkeletonRibTargetEntries,
  editSkeleton,
} from "../../views-editor/src/skeleton-editing.js";
import { computeRibDetachConversions } from "../../views-editor/src/skeleton-panel-edits.js";

describe("skeleton rib executor", () => {
  const makeAddress = (side, pointData = {}) => {
    const skeleton = normalizeSkeletonData({
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
              ...pointData,
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
    return getSkeletonRibAddress(skeleton, 10, 1, side);
  };

  const makeDelta = (address, side, normalAmount, tangentAmount) => {
    const n = address.normal;
    const t = { x: -n.y, y: n.x };
    const normalSign = side === "left" ? 1 : -1;
    return {
      x: normalSign * normalAmount * n.x + tangentAmount * t.x,
      y: normalSign * normalAmount * n.y + tangentAmount * t.y,
    };
  };

  it("free drag on an unlocked rib changes width only, never nudge", () => {
    const address = makeAddress("left");
    const executor = createSkeletonRibExecutor(address, "rib-default");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7));

    expect(result.halfWidth).to.equal(50);
    expect(result.nudge).to.equal(0);
  });

  it("rib-tangent drag on an unlocked rib changes nudge only", () => {
    const address = makeAddress("left");
    const executor = createSkeletonRibExecutor(address, "rib-tangent");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7));

    expect(result.halfWidth).to.equal(40);
    expect(result.nudge).to.equal(7);
  });

  it("tangent constrain mode on an unlocked rib changes nudge only", () => {
    const address = makeAddress("left");
    const executor = createSkeletonRibExecutor(address, "rib-default");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7), {
      constrainMode: "tangent",
    });

    expect(result.halfWidth).to.equal(40);
    expect(result.nudge).to.equal(7);
  });

  it("locked ribs never nudge, even under rib-tangent", () => {
    const address = makeAddress("left", { locked: { left: true } });
    const executor = createSkeletonRibExecutor(address, "rib-tangent");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7));

    expect(result.halfWidth).to.equal(40);
    expect(result.nudge).to.equal(0);
  });

  it("alt-drag interpolation slides nudge without carrying handles", () => {
    const address = makeAddress("left", {
      handleOffsets: {
        leftIn: { x: 3, y: 0 },
        leftOut: { x: -2, y: 0 },
      },
    });
    const n = address.normal;
    const tangent = { x: -n.y, y: n.x };
    const executor = createSkeletonRibExecutor(address, "rib-interpolate", {
      // Axis parallel to the tangent: full delta projection becomes nudge.
      interpolationAxis: {
        dir: tangent,
        hasHandle: { in: true, out: true },
      },
    });

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7));

    expect(result.halfWidth).to.equal(40);
    expect(result.nudge).to.equal(7);
    // Generator nudges no longer carry handles, so Alt needs no compensation.
    expect(result).to.not.have.property("handleOffsets");
  });

  it("interpolation without an axis falls back to pure tangent nudge", () => {
    const address = makeAddress("left");
    const executor = createSkeletonRibExecutor(address, "rib-interpolate");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7));

    expect(result.halfWidth).to.equal(40);
    expect(result.nudge).to.equal(7);
  });

  it("interpolation on locked ribs behaves like a plain width drag", () => {
    const address = makeAddress("left", { locked: { left: true } });
    const executor = createSkeletonRibExecutor(address, "rib-interpolate");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 7));

    expect(result.halfWidth).to.equal(50);
    expect(result.nudge).to.equal(0);
  });

  it("applying an interpolation result leaves handle offsets unchanged", () => {
    const address = makeAddress("left", {
      handleOffsets: { leftOut: { x: 0, y: 0 } },
    });
    const n = address.normal;
    const tangent = { x: -n.y, y: n.x };
    const executor = createSkeletonRibExecutor(address, "rib-interpolate", {
      interpolationAxis: { dir: tangent, hasHandle: { out: true } },
    });

    const result = executor.applyDelta(makeDelta(address, "left", 0, 5));
    applySkeletonRibExecutorResult(address, result);

    expect(address.point.nudge.left).to.equal(5);
    expect(address.point.handleOffsets.leftOut).to.deep.include({
      x: 0,
      y: 0,
    });
    expect(address.point.handleOffsets.leftIn).to.equal(undefined);
  });

  it("applying an executor result persists nudge only for unlocked sides", () => {
    const address = makeAddress("right");
    const executor = createSkeletonRibExecutor(address, "rib-tangent");

    const result = executor.applyDelta(makeDelta(address, "right", 0, -5));
    applySkeletonRibExecutorResult(address, result);

    expect(address.point.nudge.right).to.equal(-5);
    expect(address.point.width.right).to.equal(40);
  });

  // A linked rib drag states a total through its own side's share, the way the
  // panel's total-width field does. Moving both sides by one delta preserves
  // left − right instead, which is a different statement and loses the
  // distribution the designer set.
  it("a linked rib drag keeps the width distribution", () => {
    const address = makeAddress("left", {
      width: { left: 60, right: 20, linked: true },
    });
    const executor = createSkeletonRibExecutor(address, "rib-default");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 0));
    applySkeletonRibExecutorResult(address, result);

    // 70 on a 75/25 split: the far side follows in proportion, not by ten.
    expect(address.point.width.left).to.equal(70);
    expect(address.point.width.right).to.equal(23);
  });

  it("a linked rib drag leaves a zero far side at zero", () => {
    const address = makeAddress("left", {
      width: { left: 60, right: 0, linked: true },
    });
    const executor = createSkeletonRibExecutor(address, "rib-default");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 0));
    applySkeletonRibExecutorResult(address, result);

    expect(address.point.width.left).to.equal(70);
    expect(address.point.width.right).to.equal(0);
  });

  // A side holding zero has no share, so it cannot state a total. That rib is
  // pinned on the centerline until the distribution or the per-side number
  // lifts it off.
  it("a rib with no width of its own refuses a linked drag", () => {
    const address = makeAddress("right", {
      width: { left: 60, right: 0, linked: true },
    });
    const executor = createSkeletonRibExecutor(address, "rib-default");

    const result = executor.applyDelta(makeDelta(address, "right", 10, 0));
    applySkeletonRibExecutorResult(address, result);

    expect(address.point.width.right).to.equal(0);
    expect(address.point.width.left).to.equal(60);
  });

  it("an unlinked rib drag still moves one side alone", () => {
    const address = makeAddress("left", {
      width: { left: 60, right: 20, linked: false },
    });
    const executor = createSkeletonRibExecutor(address, "rib-default");

    const result = executor.applyDelta(makeDelta(address, "left", 10, 0));
    applySkeletonRibExecutorResult(address, result);

    expect(address.point.width.left).to.equal(70);
    expect(address.point.width.right).to.equal(20);
  });
});

describe("editable generated on-curve drag modes", () => {
  const makeLayer = () => {
    const layer = {
      path: new VarPackedPath(),
      components: [],
      anchors: [],
      guidelines: [],
      customData: {},
    };
    setSkeletonData(
      layer,
      normalizeSkeletonData({
        contours: [
          makeSkeletonContour({
            id: 80,
            defaultWidth: 40,
            points: [
              makeSkeletonPoint({ id: 1, x: 0, y: 0 }),
              makeSkeletonPoint({ id: 2, x: 20, y: 40, type: "cubic" }),
              makeSkeletonPoint({ id: 3, x: 50, y: 40, type: "cubic" }),
              makeSkeletonPoint({
                id: 4,
                x: 60,
                y: 60,
                smooth: true,
                editable: { left: true },
              }),
              makeSkeletonPoint({ id: 5, x: 70, y: 80, type: "cubic" }),
              makeSkeletonPoint({ id: 6, x: 100, y: 100, type: "cubic" }),
              makeSkeletonPoint({ id: 7, x: 120, y: 60 }),
            ],
          }),
        ],
      })
    );
    editSkeleton(layer, () => {});
    return layer;
  };

  const positions = (layer) =>
    Object.fromEntries(
      ["onCurve", "in", "out"].map((role) => {
        const address = findGeneratedPathAddress(
          getSkeletonData(layer),
          80,
          4,
          "left",
          role
        );
        return [
          role,
          layer.path.getPoint(
            layer.path.getAbsolutePointIndex(
              address.pathContourIndex,
              address.contourPointIndex
            )
          ),
        ];
      })
    );

  const drag = (layer, behaviorName, delta) => {
    const selection = new Set(["editableGeneratedPoint/80/4/left"]);
    const entries = createEditableGeneratedPointTargetEntries(
      layer,
      selection,
      behaviorName,
      { referenceSkeletonData: getSkeletonData(layer) }
    );
    expect(entries).to.have.length(1);
    applyChange(layer, entries[0].makeChangeForDelta(delta));
  };

  it("Z-normal carries both adjacent generated handles with the on-curve", () => {
    const layer = makeLayer();
    const before = positions(layer);
    drag(layer, "rib-tangent", { x: 7, y: 4 });
    const after = positions(layer);
    const movement = {
      x: after.onCurve.x - before.onCurve.x,
      y: after.onCurve.y - before.onCurve.y,
    };
    expect(movement).to.not.deep.equal({ x: 0, y: 0 });
    for (const role of ["in", "out"]) {
      expect(
        {
          x: after[role].x - before[role].x,
          y: after[role].y - before[role].y,
        },
        `${role} handle`
      ).to.deep.equal(movement);
    }
  });

  it("carries the handles the same way when the drag came in through the rib", () => {
    // The rib gizmo sits exactly on the generated on-curve, so a rib drag and a
    // generated-point drag are two entry points to one nudge. They must agree
    // about whether the adjacent handles come along.
    const layer = makeLayer();
    const before = positions(layer);
    const entries = createSkeletonRibTargetEntries(
      layer,
      new Set(["skeletonRib/80/4/left"]),
      "rib-tangent",
      { referenceSkeletonData: getSkeletonData(layer), constrainMode: "tangent" }
    );
    expect(entries).to.have.length(1);
    applyChange(layer, entries[0].makeChangeForDelta({ x: 7, y: 4 }));
    const after = positions(layer);
    const movement = {
      x: after.onCurve.x - before.onCurve.x,
      y: after.onCurve.y - before.onCurve.y,
    };
    expect(movement).to.not.deep.equal({ x: 0, y: 0 });
    for (const role of ["in", "out"]) {
      expect(
        { x: after[role].x - before[role].x, y: after[role].y - before[role].y },
        `${role} handle`
      ).to.deep.equal(movement);
    }
  });

  it("Z-Alt moves the on-curve while leaving adjacent handles fixed", () => {
    const layer = makeLayer();
    const before = positions(layer);
    drag(layer, "rib-tangent-interpolate", { x: 7, y: 4 });
    const after = positions(layer);
    expect(after.onCurve).to.not.deep.equal(before.onCurve);
    expect(after.in).to.deep.equal(before.in);
    expect(after.out).to.deep.equal(before.out);
  });

  it("keeps a prior Z-normal carry fixed during a later Z-Alt drag", () => {
    const layer = makeLayer();
    drag(layer, "rib-tangent", { x: 7, y: 4 });
    const carried = positions(layer);
    drag(layer, "rib-tangent-interpolate", { x: -5, y: 8 });
    const afterAlt = positions(layer);
    expect(afterAlt.onCurve).to.not.deep.equal(carried.onCurve);
    expect(afterAlt.in).to.deep.equal(carried.in);
    expect(afterAlt.out).to.deep.equal(carried.out);
  });
});

describe("rib detach toggle", () => {
  const makeCurveLayer = () => {
    const layer = {
      path: new VarPackedPath(),
      components: [],
      anchors: [],
      guidelines: [],
      customData: {},
    };
    setSkeletonData(
      layer,
      normalizeSkeletonData({
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
                handleOffsets: { leftOut: { x: 6, y: 4, detached: false } },
              }),
              makeSkeletonPoint({ id: 5, x: 130, y: -40, type: "cubic" }),
              makeSkeletonPoint({ id: 6, x: 170, y: -40, type: "cubic" }),
              makeSkeletonPoint({ id: 7, x: 200, y: 0 }),
            ],
          }),
        ],
      })
    );
    editSkeleton(layer, () => {});
    return layer;
  };

  const positionOf = (layer, role) => {
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

  const applyConversions = (layer, conversions, detached) => {
    editSkeleton(layer, (working) => {
      const point = working.contours[0].points[3];
      for (const conversion of conversions) {
        for (const [role, offset] of Object.entries(conversion.offsets)) {
          setSkeletonHandleOffset(point, "left", role, offset);
        }
        setSkeletonHandleDetached(point, "left", detached);
      }
    });
  };

  it("toggling detach on and off keeps the handles in place", () => {
    const layer = makeCurveLayer();
    const addresses = [{ contourId: 80, pointId: 4, side: "left" }];
    const before = {
      in: positionOf(layer, "in"),
      out: positionOf(layer, "out"),
    };

    const detachConversions = computeRibDetachConversions(
      layer,
      getSkeletonData(layer),
      addresses,
      true
    );
    expect(detachConversions).to.have.length(1);
    applyConversions(layer, detachConversions, true);

    const detachedPoint = getSkeletonData(layer).contours[0].points[3];
    expect(detachedPoint.handleOffsets.leftOut.detached).to.equal(true);
    for (const role of ["in", "out"]) {
      const position = positionOf(layer, role);
      expect(Math.abs(position.x - before[role].x), `${role} x`).to.be.at.most(1);
      expect(Math.abs(position.y - before[role].y), `${role} y`).to.be.at.most(1);
    }

    const attachConversions = computeRibDetachConversions(
      layer,
      getSkeletonData(layer),
      addresses,
      false
    );
    expect(attachConversions).to.have.length(1);
    applyConversions(layer, attachConversions, false);

    const attachedPoint = getSkeletonData(layer).contours[0].points[3];
    expect(attachedPoint.handleOffsets.leftOut.detached).to.equal(false);
    for (const role of ["in", "out"]) {
      const position = positionOf(layer, role);
      expect(Math.abs(position.x - before[role].x), `${role} x`).to.be.at.most(2);
      expect(Math.abs(position.y - before[role].y), `${role} y`).to.be.at.most(2);
    }
  });
});

describe("tied rib group", () => {
  // angled / handle / handle / smooth / straight / smooth / handle / handle / angled.
  // Points 5 and 6 each carry one handle, on the far side, colinear with the
  // straight between them.
  function makeTiedSkeleton({ tied = true, widthAtFive = 30 } = {}) {
    const onCurve = (id, x, y, smooth, halfWidth) => ({
      id,
      x,
      y,
      type: null,
      smooth,
      width: { left: halfWidth, right: halfWidth, linked: true, tied },
    });
    const offCurve = (id, x, y) => ({ id, x, y, type: "cubic" });
    return normalizeSkeletonData({
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 40,
          points: [
            onCurve(2, 0, 0, false, 20),
            offCurve(3, 10, 50),
            offCurve(4, 20, 40),
            onCurve(5, 60, 60, true, widthAtFive),
            onCurve(6, 140, 100, true, 20),
            offCurve(7, 180, 120),
            offCurve(8, 190, 60),
            onCurve(9, 200, 0, false, 20),
          ],
        },
      ],
    });
  }

  // The same one-handle smooth point (5) and straight, with an arbitrary tail
  // after point 6 — which is left a corner, so only ONE end of the straight is
  // straight-controlled.
  function makeOneEndedSkeleton(tail = []) {
    const skeletonData = makeTiedSkeleton();
    const points = skeletonData.contours[0].points;
    points[4].smooth = false;
    skeletonData.contours[0].points = [...points.slice(0, 5), ...tail];
    return normalizeSkeletonData(skeletonData);
  }

  const pointById = (skeletonData, id) =>
    skeletonData.contours[0].points.find((point) => point.id === id);
  const groupIds = (skeletonData, id) =>
    getTiedRibGroup(skeletonData.contours[0], pointById(skeletonData, id))
      ?.map((point) => point.id)
      .sort() ?? null;

  it("groups the two smooth points across the straight, both ways", () => {
    const skeletonData = makeTiedSkeleton();
    expect(groupIds(skeletonData, 5)).to.deep.equal([5, 6]);
    expect(groupIds(skeletonData, 6)).to.deep.equal([5, 6]);
  });

  it("groups nothing for points that own their direction", () => {
    const skeletonData = makeTiedSkeleton();
    const contour = skeletonData.contours[0];
    // Angled endpoints and off-curve handles are never part of a tied group.
    expect(getTiedRibGroup(contour, pointById(skeletonData, 2))).to.equal(null);
    expect(getTiedRibGroup(contour, pointById(skeletonData, 9))).to.equal(null);
    expect(getTiedRibGroup(contour, pointById(skeletonData, 4))).to.equal(null);
  });

  it("groups nothing once either point unticks tied ribs", () => {
    const skeletonData = makeTiedSkeleton({ tied: false });
    const contour = skeletonData.contours[0];
    expect(getTiedRibGroup(contour, pointById(skeletonData, 5))).to.equal(null);
  });

  it("ties the far end of the straight whatever it is", () => {
    // One straight-controlled smooth point anywhere on the straight is enough:
    // the whole projected straight has to move as a unit, so the far rib is
    // tied even when that point owns its own direction.
    const smoothTied = { left: 20, right: 20, linked: true, tied: true };
    const cases = {
      // Terminal on-curve: the straight is the contour's last segment.
      "terminal": [],
      // Sharp corner into a cubic.
      "corner": [
        { id: 7, x: 200, y: 160, type: "cubic" },
        { id: 8, x: 240, y: 60, type: "cubic" },
        { id: 9, x: 200, y: 0, type: null, smooth: false, width: smoothTied },
      ],
      // A second straight, so point 6 carries no handle at all.
      "second straight": [
        { id: 9, x: 220, y: 130, type: null, smooth: false, width: smoothTied },
      ],
    };
    for (const [name, tail] of Object.entries(cases)) {
      const skeletonData = makeOneEndedSkeleton(tail);
      expect(groupIds(skeletonData, 5), name).to.deep.equal([5, 6]);
      expect(groupIds(skeletonData, 6), name).to.deep.equal([5, 6]);
    }
  });

  it("merges straights that share an end point into one group", () => {
    // smooth(5) / straight / corner(6) / straight / smooth(9): both straights
    // are tied, and point 6 has one rib, so all three share one offset.
    const smoothTied = (halfWidth) => ({
      left: halfWidth,
      right: halfWidth,
      linked: true,
      tied: true,
    });
    const skeletonData = makeOneEndedSkeleton([
      { id: 9, x: 220, y: 130, type: null, smooth: true, width: smoothTied(20) },
      { id: 10, x: 260, y: 190, type: "cubic" },
      { id: 11, x: 300, y: 120, type: "cubic" },
      { id: 12, x: 320, y: 60, type: null, smooth: false, width: smoothTied(20) },
    ]);
    expect(groupIds(skeletonData, 5)).to.deep.equal([5, 6, 9]);
    expect(groupIds(skeletonData, 6)).to.deep.equal([5, 6, 9]);
    expect(groupIds(skeletonData, 9)).to.deep.equal([5, 6, 9]);
    // And the shared offset is the mean across all three, not across a pair.
    const contour = skeletonData.contours[0];
    pointById(skeletonData, 5).width.left = 30;
    expect(
      getEffectiveRibHalfWidth(contour, pointById(skeletonData, 6), "left")
    ).to.be.closeTo((30 + 20 + 20) / 3, 1e-9);
  });

  it("reports the mean half-width for a tied rib, so the gizmo sits on the outline", () => {
    const skeletonData = makeTiedSkeleton({ widthAtFive: 30 });
    const contour = skeletonData.contours[0];
    // Stored 30 and 20; the generator uses 25 for both.
    expect(
      getEffectiveRibHalfWidth(contour, pointById(skeletonData, 5), "left")
    ).to.equal(25);
    expect(
      getEffectiveRibHalfWidth(contour, pointById(skeletonData, 6), "left")
    ).to.equal(25);
  });

  it("reports the stored half-width when untied", () => {
    const skeletonData = makeTiedSkeleton({ tied: false, widthAtFive: 30 });
    const contour = skeletonData.contours[0];
    expect(
      getEffectiveRibHalfWidth(contour, pointById(skeletonData, 5), "left")
    ).to.equal(30);
    expect(
      getEffectiveRibHalfWidth(contour, pointById(skeletonData, 6), "left")
    ).to.equal(20);
  });

  it("puts the rib gizmo where the outline is even with an off-colinear handle", () => {
    // "Smooth" is a flag, so a stored handle can sit slightly off the straight.
    // The gizmo angle then has to follow the straight, like the generator does,
    // rather than splitting the difference with a miter bisector.
    const skeletonData = makeTiedSkeleton({ widthAtFive: 24 });
    const contour = skeletonData.contours[0];
    const handle = contour.points.find((point) => point.id === 4);
    handle.x += 6;
    handle.y -= 4;
    const generated = generateFromSkeleton(skeletonData);
    const gizmo = getSkeletonRibPosition(contour, pointById(skeletonData, 5), "left");
    const index = generated.provenance[0].pointMap.findIndex(
      (entry) =>
        entry &&
        entry.skeletonPointId === 5 &&
        entry.side === "left" &&
        entry.role === "onCurve"
    );
    const rib = generated.contours[0].points[index];
    // Exact, not merely close: both sides now derive the normal the same way.
    expect(Math.hypot(gizmo.x - rib.x, gizmo.y - rib.y)).to.equal(0);
  });

  it("puts the rib gizmo where the generated outline actually is", () => {
    // The bug this guards: the gizmo read the stored width while the outline used
    // the coupled one, so dragging one rib moved the diamond twice as far as the
    // geometry and left its partner behind.
    const skeletonData = makeTiedSkeleton({ widthAtFive: 30 });
    const contour = skeletonData.contours[0];
    const generated = generateFromSkeleton(skeletonData);
    for (const id of [5, 6]) {
      const gizmo = getSkeletonRibPosition(
        contour,
        pointById(skeletonData, id),
        "left"
      );
      const index = generated.provenance[0].pointMap.findIndex(
        (entry) =>
          entry &&
          entry.skeletonPointId === id &&
          entry.side === "left" &&
          entry.role === "onCurve"
      );
      const rib = generated.contours[0].points[index];
      expect(Math.hypot(gizmo.x - rib.x, gizmo.y - rib.y), `point ${id}`).to.be.below(
        1
      );
    }
  });
});

// A serif sits on the end of a straight run of stem, and that run is one wall
// with one thickness. So a serif ties the ribs at both ends of the straight it
// is attached to, the same way a straight-controlled smooth point does — and
// through the same rule, so the gizmo, the stored width and the outline cannot
// disagree.
//
// Attached to a STRAIGHT is the whole condition. A serif on a curve has no flat
// wall behind it and ties nothing.
describe("tied rib group: serif on a straight", () => {
  const SERIF_HALF = {
    wingLength: 120,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 60,
    tension: 0.7,
    concavity: 0.8,
  };

  function makeSerifSkeleton({
    capStyle = "serif",
    curved = false,
    tied = true,
    neighbourWidth = 20,
    serifWidth = 50,
  } = {}) {
    const onCurve = (id, x, y, halfWidth, extra = {}) => ({
      id,
      x,
      y,
      type: null,
      smooth: false,
      width: { left: halfWidth, right: halfWidth, linked: true, tied },
      ...extra,
    });
    const offCurve = (id, x, y) => ({ id, x, y, type: "cubic" });
    return normalizeSkeletonData({
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle,
          points: [
            onCurve(2, 0, 0, serifWidth, {
              serif: {
                left: SERIF_HALF,
                right: SERIF_HALF,
                axisMode: "perpendicular",
                axisAngle: 0,
                undersideCup: 0,
              },
            }),
            ...(curved ? [offCurve(10, 40, 100), offCurve(11, -40, 200)] : []),
            onCurve(3, 0, 300, neighbourWidth),
            offCurve(4, 100, 400),
            offCurve(5, 200, 500),
            onCurve(6, 300, 600, 20, { capStyle: "butt" }),
          ],
        },
      ],
    });
  }

  const pointById = (skeletonData, id) =>
    skeletonData.contours[0].points.find((point) => point.id === id);
  const groupIds = (skeletonData, id) =>
    getTiedRibGroup(skeletonData.contours[0], pointById(skeletonData, id))
      ?.map((point) => point.id)
      .sort() ?? null;

  it("ties the straight's two ends when a serif is on one of them", () => {
    const skeletonData = makeSerifSkeleton();
    expect(groupIds(skeletonData, 2)).to.deep.equal([2, 3]);
    expect(groupIds(skeletonData, 3)).to.deep.equal([2, 3]);
  });

  it("ties nothing when the serif's own segment is a curve", () => {
    const skeletonData = makeSerifSkeleton({ curved: true });
    expect(groupIds(skeletonData, 2)).to.equal(null);
    expect(groupIds(skeletonData, 3)).to.equal(null);
  });

  it("ties nothing when the terminal is not a serif", () => {
    const skeletonData = makeSerifSkeleton({ capStyle: "butt" });
    expect(groupIds(skeletonData, 2)).to.equal(null);
  });

  it("ties nothing once either point unticks tied ribs", () => {
    expect(groupIds(makeSerifSkeleton({ tied: false }), 2)).to.equal(null);
  });

  it("gives both ends one width, which either of them moves", () => {
    const skeletonData = makeSerifSkeleton();
    const contour = skeletonData.contours[0];
    for (const id of [2, 3]) {
      expect(
        getEffectiveRibHalfWidth(contour, pointById(skeletonData, id), "left")
      ).to.equal(35);
    }
    const wider = makeSerifSkeleton({ neighbourWidth: 40 });
    expect(
      getEffectiveRibHalfWidth(wider.contours[0], pointById(wider, 2), "left")
    ).to.equal(45);
  });

  it("draws the outline at the shared width, not at either stored one", () => {
    expect(generateFromSkeleton(makeSerifSkeleton()).contours).to.deep.equal(
      generateFromSkeleton(makeSerifSkeleton({ neighbourWidth: 35, serifWidth: 35 }))
        .contours
    );
  });
});
