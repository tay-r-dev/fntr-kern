import { Bezier } from "bezier-js";
import { expect } from "chai";
import { generateFromSkeleton } from "../src/skeleton-generator.js";
import { normalizeSkeletonData } from "../src/skeleton-model.js";

// A V-slide moves a generated on-curve along the outline it sits on. The
// outline it slid along must still be drawn: every sample of the slid outline
// lies on the unslid one.
function skeleton(middle = {}, end = {}) {
  return normalizeSkeletonData({
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 60,
        points: [
          { id: 2, x: 0, y: 0 },
          { id: 3, x: 60, y: 120, type: "cubic" },
          { id: 4, x: 180, y: 160, type: "cubic" },
          { id: 5, x: 260, y: 160, smooth: true, ...middle },
          { id: 6, x: 340, y: 160, type: "cubic" },
          { id: 7, x: 440, y: 120, type: "cubic" },
          { id: 8, x: 500, y: 0, ...end },
        ],
      },
    ],
  });
}

function curves(points) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const segment = [0, 1, 2, 3].map((k) => points[(i + k) % points.length]);
    if (!segment[0].type && segment[1].type && segment[2].type && !segment[3].type)
      result.push(new Bezier(segment));
  }
  return result;
}

function departure(slid, plain) {
  const reference = curves(plain);
  let worst = 0;
  for (const curve of curves(slid))
    for (let j = 0; j <= 40; j++) {
      const p = curve.get(j / 40);
      worst = Math.max(worst, Math.min(...reference.map((c) => c.project(p).d)));
    }
  return worst;
}

function onCurve(result, predicate) {
  const map = result.provenance[0].pointMap;
  return result.contours[0].points.find((p, i) => !p.type && predicate(map[i]));
}

describe("V-slide of generated points", () => {
  it("slides a rib's generated on-curve along its own outline", () => {
    const plain = generateFromSkeleton(skeleton());
    for (const side of ["left", "right"])
      for (const value of [-0.4, 0.3]) {
        const slid = generateFromSkeleton(skeleton({ vSlide: { [side]: value } }));
        expect(slid.contours[0].points).to.have.length(plain.contours[0].points.length);
        const at = (result) =>
          onCurve(
            result,
            (m) => m?.skeletonPointId === 5 && m.side === side && m.role === "onCurve"
          );
        const moved = Math.hypot(at(slid).x - at(plain).x, at(slid).y - at(plain).y);
        expect(moved, `${side} ${value}`).to.be.greaterThan(10);
        expect(
          departure(slid.contours[0].points, plain.contours[0].points),
          `${side} ${value}`
        ).to.be.below(1.5);
      }
  });

  it("lands every point it moves on whole units, like a drawn V-slide", () => {
    const cases = [
      [{}, {}, { vSlide: { left: 0.337 } }, {}],
      [{}, {}, { vSlide: { right: -0.413 } }, {}],
    ];
    for (const [plainMiddle, plainEnd, slidMiddle, slidEnd] of cases) {
      const plain = generateFromSkeleton(skeleton(plainMiddle, plainEnd)).contours[0];
      const slid = generateFromSkeleton(skeleton(slidMiddle, slidEnd)).contours[0];
      // A smooth point keeps its handles on one line, so one handle beside it
      // may be re-aimed off the grid; every other moved point is whole.
      let movedCount = 0;
      let offGrid = 0;
      slid.points.forEach((point, i) => {
        const before = plain.points[i];
        if (point.x === before.x && point.y === before.y) return;
        movedCount++;
        if (Number.isInteger(point.x) && Number.isInteger(point.y)) return;
        expect(point.type, `${i}`).to.equal("cubic");
        offGrid++;
      });
      expect(movedCount).to.be.greaterThan(0);
      expect(offGrid).to.be.at.most(1);
    }
  });

  it("slides the same way along the skeleton on both sides", () => {
    const plain = generateFromSkeleton(skeleton());
    const at = (result, side) =>
      onCurve(
        result,
        (m) => m?.skeletonPointId === 5 && m.side === side && m.role === "onCurve"
      );
    for (const side of ["left", "right"]) {
      const slid = generateFromSkeleton(skeleton({ vSlide: { [side]: 0.3 } }));
      // Positive runs toward the next skeleton point, which lies at larger x.
      expect(at(slid, side).x, side).to.be.greaterThan(at(plain, side).x);
    }
  });

  it("V-slides only the neck, keeping four bulb roles and the wall entry", () => {
    const cap = { capStyle: "drop", capBallEasing: 0.5, capBallSide: "right" };
    const plain = generateFromSkeleton(skeleton({}, cap));
    for (const value of [-0.3, 0.3]) {
      const slid = generateFromSkeleton(
        skeleton({}, { ...cap, capBallEdits: { neck: { vslide: value } } })
      );
      const at = (result, role) =>
        onCurve(result, (m) => m?.bulbRole === role && m.bulbSlot === "onCurve");
      expect(
        Math.hypot(
          at(slid, "neck").x - at(plain, "neck").x,
          at(slid, "neck").y - at(plain, "neck").y
        )
      ).to.be.greaterThan(2);
      expect(at(slid, "entry")).to.deep.equal(at(plain, "entry"));
      expect(slid.contours[0].points).to.have.length(plain.contours[0].points.length);
      expect(
        slid.provenance[0].pointMap.filter((m) => m?.bulbSlot === "onCurve")
      ).to.have.length(4);
    }
    for (const role of ["entry", "bottom", "side"]) {
      const ignored = generateFromSkeleton(
        skeleton({}, { ...cap, capBallEdits: { [role]: { vslide: 0.3 } } })
      );
      expect(ignored.contours).to.deep.equal(plain.contours);
    }
  });
});

describe("V-slide of generated points, through the editor's entry", () => {
  before(() => {
    globalThis.window = globalThis.window ?? { coarseGridSpacing: 1, event: null };
  });

  async function layerWith(data) {
    const { VarPackedPath } = await import("../src/var-path.js");
    const { setSkeletonData } = await import("../src/skeleton-model.js");
    const { editSkeleton } = await import("../../views-editor/src/skeleton-editing.js");
    const layer = {
      path: new VarPackedPath(),
      components: [],
      anchors: [],
      guidelines: [],
      customData: {},
    };
    setSkeletonData(layer, data);
    editSkeleton(layer, () => {});
    return layer;
  }

  async function drag(layer, key, from, to) {
    const { applyChange } = await import("../src/changes.js");
    const { getSkeletonData } = await import("../src/skeleton-model.js");
    const { createPointSlideTargetEntries, getPointSlideBehaviorName } =
      await import("../../views-editor/src/point-slide-editing.js");
    const selection = new Set([key]);
    expect(
      getPointSlideBehaviorName({ pointSlideMode: true }, new Set(), selection, layer)
    ).to.be.a("string");
    const entries = createPointSlideTargetEntries(layer, selection, {
      referenceSkeletonData: getSkeletonData(layer),
      initialPointer: from,
      isPrimary: true,
      session: {},
    });
    expect(entries).to.have.length(1);
    applyChange(
      layer,
      entries[0].makeChangeForDelta({ x: to.x - from.x, y: to.y - from.y })
    );
  }

  function pathPoint(layer, predicate) {
    const { getSkeletonData } = globalThis.__model;
    const entry = getSkeletonData(layer).generated[0];
    const index = entry.pointMap.findIndex(predicate);
    return layer.path.getPoint(
      layer.path.getAbsolutePointIndex(entry.pathContourIndex, index)
    );
  }

  before(async () => {
    globalThis.__model = await import("../src/skeleton-model.js");
  });

  it("slides a rib's generated on-curve to where the pointer projects", async () => {
    const layer = await layerWith(skeleton());
    const outline = curves(generateFromSkeleton(skeleton()).contours[0].points);
    const isLeft = (m) =>
      m?.skeletonPointId === 5 && m.side === "left" && m.role === "onCurve";
    const start = pathPoint(layer, isLeft);
    const pointer = { x: start.x + 40, y: start.y + 3 };
    await drag(layer, "editableGeneratedPoint/1/5/left", start, pointer);
    const end = pathPoint(layer, isLeft);
    expect(end.x).to.be.greaterThan(start.x + 25);
    // The point lands where the pointer projects onto the outline.
    const projected = Math.min(...outline.map((curve) => curve.project(pointer).d));
    expect(Math.hypot(end.x - pointer.x, end.y - pointer.y)).to.be.below(projected + 1);
    const point = globalThis.__model
      .getSkeletonData(layer)
      .contours[0].points.find((p) => p.id === 5);
    expect(point.vSlide.left).to.be.greaterThan(0);
  });

  it("slides a bulb point through the same gesture", async () => {
    const layer = await layerWith(
      skeleton({}, { capStyle: "drop", capBallEasing: 0.5, capBallSide: "left" })
    );
    const isNeck = (m) => m?.bulbRole === "neck" && m.bulbSlot === "onCurve";
    const start = pathPoint(layer, isNeck);
    const side = pathPoint(
      layer,
      (m) => m?.bulbRole === "side" && m.bulbSlot === "onCurve"
    );
    const pointer = {
      x: start.x + (side.x - start.x) * 0.3,
      y: start.y + (side.y - start.y) * 0.3,
    };
    await drag(layer, "editableGeneratedPoint/1/8/bulb-neck", start, pointer);
    const end = pathPoint(layer, isNeck);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).to.be.greaterThan(3);
    const edits = globalThis.__model
      .getSkeletonData(layer)
      .contours[0].points.find((p) => p.id === 8).capBallEdits;
    expect(edits.neck.vslide).to.be.below(0);
    const before = [...layer.path.coordinates];
    await drag(layer, "editableGeneratedPoint/1/8/bulb-neck", end, end);
    expect([...layer.path.coordinates]).to.deep.equal(before);
  });
});
