import { MouseTracker } from "@fontra/core/mouse-tracker.js";
import { expect } from "chai";

// The right button during a drag cancels it, as in Blender.
describe("MouseTracker: the right button cancels a drag", () => {
  const listeners = [];
  before(() => {
    globalThis.window = {
      addEventListener: (type, listener, options) =>
        listeners.push({ type, listener, options }),
    };
  });

  it("ends the drag stream and reports the cancel", async () => {
    let cancelled = 0;
    let finished = false;
    const tracker = new MouseTracker({
      drag: async (eventStream) => {
        for await (const event of eventStream) {
          // Only the moves before the cancel arrive.
          expect(event.type).to.equal("mousemove");
        }
        finished = true;
      },
      hover: () => {},
      cancel: () => cancelled++,
      element: { addEventListener: () => {} },
    });
    const at = { pageX: 0, pageY: 0, timeStamp: 1 };
    tracker.handleMouseDown({ ...at, type: "mousedown", button: 0 });
    tracker.handleMouseMove({
      ...at,
      type: "mousemove",
      pageX: 20,
      stopImmediatePropagation: () => {},
    });
    tracker.handleMouseDown({ ...at, type: "mousedown", button: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).to.equal(1);
    expect(finished).to.equal(true);
    // The context menu the right button would open is swallowed, once.
    const swallow = listeners.find((entry) => entry.type === "contextmenu");
    expect(swallow.options).to.include({ capture: true, once: true });
  });
});
