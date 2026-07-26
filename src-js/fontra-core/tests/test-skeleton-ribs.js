import { generateFromSkeleton } from "@fontra/core/skeleton-generator.js";
import {
  applySkeletonRibExecutorResult,
  createSkeletonRibExecutor,
  findGeneratedPathAddress,
  getEffectiveRibHalfWidth,
  getSkeletonData,
  getSkeletonRibAddress,
  getSkeletonRibPosition,
  getTiedRibPartner,
  makeSkeletonContour,
  makeSkeletonPoint,
  normalizeSkeletonData,
  setSkeletonData,
  setSkeletonHandleDetached,
  setSkeletonHandleOffset,
} from "@fontra/core/skeleton-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import { editSkeleton } from "../../views-editor/src/skeleton-editing.js";
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

  it("alt-drag interpolation slides nudge along the axis and keeps width", () => {
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
    // Handles are compensated so they stay fixed on canvas.
    expect(result.handleOffsets.in).to.deep.include({
      x: Math.round(3 - tangent.x * 7),
      y: Math.round(0 - tangent.y * 7),
    });
    expect(result.handleOffsets.out).to.deep.include({
      x: Math.round(-2 - tangent.x * 7),
      y: Math.round(0 - tangent.y * 7),
    });
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

  it("applying an interpolation result persists compensated handle offsets", () => {
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
      x: Math.round(-tangent.x * 5) || 0,
      y: Math.round(-tangent.y * 5) || 0,
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

describe("tied rib partner", () => {
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

  const pointById = (skeletonData, id) =>
    skeletonData.contours[0].points.find((point) => point.id === id);

  it("pairs the two smooth points across the straight, both ways", () => {
    const skeletonData = makeTiedSkeleton();
    const contour = skeletonData.contours[0];
    expect(getTiedRibPartner(contour, pointById(skeletonData, 5))?.id).to.equal(6);
    expect(getTiedRibPartner(contour, pointById(skeletonData, 6))?.id).to.equal(5);
  });

  it("pairs nothing for points that own their direction", () => {
    const skeletonData = makeTiedSkeleton();
    const contour = skeletonData.contours[0];
    // Angled endpoints and off-curve handles are never half of a tied pair.
    expect(getTiedRibPartner(contour, pointById(skeletonData, 2))).to.equal(null);
    expect(getTiedRibPartner(contour, pointById(skeletonData, 9))).to.equal(null);
    expect(getTiedRibPartner(contour, pointById(skeletonData, 4))).to.equal(null);
  });

  it("pairs nothing once either point unticks tied ribs", () => {
    const skeletonData = makeTiedSkeleton({ tied: false });
    const contour = skeletonData.contours[0];
    expect(getTiedRibPartner(contour, pointById(skeletonData, 5))).to.equal(null);
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
