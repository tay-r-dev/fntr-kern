import { applyChange } from "@fontra/core/changes.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";
import { EditBehaviorFactory } from "../../views-editor/src/edit-behavior.js";

before(() => {
  globalThis.window = { coarseGridSpacing: 1, event: null };
});

// A smooth on-curve at (100, 100) whose handles lie at 30 degrees, between two
// curve segments.
function makeAngledSmoothGlyph() {
  return {
    path: VarPackedPath.fromUnpackedContours([
      {
        isClosed: false,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 40, type: "cubic" },
          { x: 56.7, y: 75, type: "cubic" },
          { x: 100, y: 100, smooth: true },
          { x: 143.3, y: 125, type: "cubic" },
          { x: 180, y: 140, type: "cubic" },
          { x: 200, y: 100 },
        ],
      },
    ]),
    components: [],
    anchors: [],
    guidelines: [],
    backgroundImage: null,
  };
}

const angle = (from, to) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

describe("Shift+Alt on the handle of an angled smooth point", () => {
  for (const delta of [
    { x: 10, y: 30 },
    { x: 20, y: -5 },
  ]) {
    it(`snaps the handle to 0/45/90 around its on-curve (delta ${delta.x},${delta.y})`, () => {
      const glyph = makeAngledSmoothGlyph();
      const behavior = new EditBehaviorFactory(
        glyph,
        new Set(["point/4"]),
        false
      ).getBehavior("alternate-constrain");
      applyChange(glyph, behavior.makeChangeForDelta(delta));
      const point = (index) => glyph.path.getPoint(index);

      expect(point(3)).to.include({ x: 100, y: 100 });
      const outAngle = angle(point(3), point(4));
      expect(Math.abs(outAngle / 45 - Math.round(outAngle / 45))).to.be.below(1e-6);
      expect(angle(point(2), point(3))).to.be.closeTo(outAngle, 1e-6);
    });
  }
});
