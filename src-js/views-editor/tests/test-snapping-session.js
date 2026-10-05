import { expect } from "chai";
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
