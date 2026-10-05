import { expect } from "chai";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { makeEmptySkeletonData } from "@fontra/core/skeleton-model.js";
import {
  distanceToCandidate,
  makeCurveCandidate,
  KIND,
} from "@fontra/core/snapping.js";
import { SNAP_PARAMETERS, resetSnapParameters } from "@fontra/core/snapping.js";

// Only the shortcut imports need browser storage; the scene and resolver are real.
const savedWindow = globalThis.window;
const savedStorage = globalThis.localStorage;
globalThis.window = { addEventListener() {} };
globalThis.localStorage = {
  getItem() {
    return null;
  },
  setItem() {},
};
const { SnappingSession, forceRefreshSnapping } =
  await import("../src/snapping-interactions.js");
if (savedWindow === undefined) delete globalThis.window;
else globalThis.window = savedWindow;
if (savedStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = savedStorage;

function setup(options = {}) {
  const controller = {
    onePixelUnit: 1,
    sceneSettings: {},
    sceneModel: {
      getSelectedPositionedGlyph() {
        return null;
      },
    },
  };
  const session = new SnappingSession(controller, options);
  // Frozen scene records are the input boundary, independent of glyph storage.
  session.scene = { metrics: [{ value: 0 }], guides: [{ x: 0, y: 0, angle: 90 }] };
  session._speed = () => 0;
  return { session, controller };
}

describe("snap session lifetime", () => {
  afterEach(resetSnapParameters);

  it("retains and reports the full crossing", () => {
    const { session, controller } = setup();
    session.resolve({ x: 1, y: 1 });
    expect(session.held.candidate.sources).to.have.length(2);
    expect(controller.sceneModel.snapDebugReadout.winningKind).to.equal("intersection");
    expect(controller.sceneModel.snapIndicator).to.include({
      x: 0,
      y: 0,
      snapped: true,
    });
  });

  it("drops a held target excluded by a mode key", () => {
    const { session, controller } = setup();
    session.resolve({ x: 1, y: 1 });
    controller.sceneModel.snapCurvatureOnly = true;
    session.resolve({ x: 1, y: 1 });
    expect(session.held).to.equal(null);
    expect(controller.sceneModel.snapHeldCandidates).to.deep.equal([]);
  });

  it("force refresh clears the internal hold as well as the drawing", () => {
    const { session, controller } = setup();
    session.resolve({ x: 1, y: 1 });
    forceRefreshSnapping(controller);
    session.resolve({ x: 1, y: 1 });
    expect(session.held).to.equal(null);
    expect(controller.sceneModel.snapIndicator).to.equal(null);
  });

  it("measures initial travel from mouse-down, including the first delivered frame", () => {
    const { session } = setup({ startCursor: { x: -20, y: 1 } });
    session.resolveSet([{ x: 1, y: 1 }], { x: 1, y: 1 });
    expect(session.held).to.not.equal(null);
  });

  it("keeps escape refusal after releasing a multi-point hold", () => {
    SNAP_PARAMETERS.startTravelPixels = 0;
    const { session } = setup();
    session.scene = { metrics: [{ value: 0 }] };
    session.resolveSet([{ x: 0, y: 1 }], { x: 0, y: 1 });
    session.resolveSet([{ x: 0, y: 1 }], { x: 0, y: 1 });
    session._speed = () => SNAP_PARAMETERS.escapeSpeedPixels + 1;
    session.resolveSet([{ x: 0, y: 2 }], { x: 0, y: 2 });
    expect(session.held).to.equal(null);
    session._speed = () => 0;
    session.resolveSet([{ x: 0, y: 3 }], { x: 0, y: 3 });
    expect(session.held).to.equal(null);
    expect(session.escape.refused).to.not.equal(null);
  });

  it("ends all published and gesture state", () => {
    const { session, controller } = setup();
    session.resolve({ x: 1, y: 1 });
    session.end();
    expect(session.held).to.equal(null);
    expect(controller.sceneModel.snapDebugReadout).to.equal(null);
    expect(controller.sceneModel.snapIndicator).to.equal(null);
  });
});

const { getPenToolBehavior } = await import("../src/edit-tools-pen.js");
const { SkeletonPenTool } = await import("../src/edit-tools-skeleton.js");

function penSetup(path = new VarPackedPath(), selection = new Set()) {
  const { session, controller } = setup();
  controller.selection = selection;
  controller.selectedGlyphPoint = (event) => ({ x: event.x, y: event.y });
  controller.localPoint = controller.selectedGlyphPoint;
  controller.sceneModel.pointSelectionAtPoint = () => new Set();
  session.scene = {
    metrics: [{ value: 0.75 }],
    guides: [{ x: 12.25, y: 0, angle: 90 }],
  };
  session.refresh = () => {};
  return { session, controller, path };
}

describe("pen placement uses the resolved position", () => {
  afterEach(resetSnapParameters);
  it("places an anchor and its dragged handle at the displayed fractional crossing", () => {
    const { session, controller, path } = penSetup();
    const event = { x: 13, y: 1 };
    const behavior = getPenToolBehavior(controller, event, path, "cubic", session);
    behavior.initialChanges(path, event);
    expect(path.getPoint(0)).to.include({ x: 12.25, y: 0.75 });
    behavior.setupDrag(path, event);
    behavior.drag(path, event);
    expect(path.getPoint(1)).to.include({ x: 12.25, y: 0.75 });
    expect(controller.sceneModel.snapIndicator).to.include({ x: 12.25, y: 0.75 });
  });

  it("resolves Shift before inserting the anchor", () => {
    const path = VarPackedPath.fromUnpackedContours([
      { isClosed: false, points: [{ x: 0, y: 0 }] },
    ]);
    const { session, controller } = penSetup(path, new Set(["point/0"]));
    const event = { x: 13, y: 1, shiftKey: true };
    const behavior = getPenToolBehavior(controller, event, path, "cubic", session);
    behavior.initialChanges(path, event);
    expect(path.getPoint(1)).to.include({ x: 12.25, y: 0 });
    expect(controller.sceneModel.snapIndicator).to.include({ x: 12.25, y: 0 });
  });

  it("keeps inserted anchors on a curvature guide over a sweep", () => {
    SNAP_PARAMETERS.curvatureEnabled = 1;
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 55 },
      { x: 45, y: 100 },
      { x: 100, y: 100 },
    ];
    const curve = makeCurveCandidate({ points, kind: KIND.CURVATURE });
    for (let x = 102; x <= 140; x += 2) {
      const { session, controller, path } = penSetup();
      session.scene = { curves: [{ points }] };
      const event = { x, y: 100 };
      const behavior = getPenToolBehavior(controller, event, path, "cubic", session);
      behavior.initialChanges(path, event);
      expect(session.held).to.not.equal(null);
      expect(distanceToCandidate(curve, path.getPoint(0))).to.be.lessThan(0.002);
      expect(path.getPoint(0).x).to.equal(controller.sceneModel.snapIndicator.x);
      expect(path.getPoint(0).y).to.equal(controller.sceneModel.snapIndicator.y);
    }
  });

  it("keeps skeleton pen coordinates when constructing the persisted point", async () => {
    const { session, controller } = penSetup();
    const tool = new SkeletonPenTool({ sceneController: controller });
    const skeleton = makeEmptySkeletonData();
    tool._snapSession = () => session;
    tool._getSelectedOpenEndpoint = () => null;
    tool._getMasterDefaultWidth = () => 80;
    tool._editSkeletonAcrossLayers = async (_label, edit) => edit(skeleton, skeleton);
    await tool._handleAddSkeletonPoint([], { x: 13, y: 1 });
    expect(skeleton.contours[0].points[0]).to.include({ x: 12.25, y: 0.75 });
    expect(controller.sceneModel.snapIndicator).to.include({ x: 12.25, y: 0.75 });
  });
});

describe("live snap parameter changes", () => {
  afterEach(resetSnapParameters);
  it("drops a held off-curve source when its switch is turned off", () => {
    SNAP_PARAMETERS.offCurveSources = 1;
    const { session } = setup();
    session.scene = { points: [{ x: 100, y: 0, offCurve: true }] };
    session.resolve({ x: 0, y: 1 });
    expect(session.held).to.not.equal(null);
    SNAP_PARAMETERS.offCurveSources = 0;
    session.resolve({ x: 0, y: 1 });
    expect(session.held).to.equal(null);
  });

  it("replaces a held curve when its extension length changes", () => {
    SNAP_PARAMETERS.curvatureEnabled = 1;
    const { session } = setup();
    session.scene = {
      curves: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 55 },
            { x: 45, y: 100 },
            { x: 100, y: 100 },
          ],
        },
      ],
    };
    session.resolve({ x: 130, y: 100 });
    expect(session.held.candidate.extend).to.equal(1);
    SNAP_PARAMETERS.curvatureExtend = 0.5;
    session.resolve({ x: 130, y: 100 });
    expect(session.held.candidate.extend).to.equal(0.5);
  });
});
