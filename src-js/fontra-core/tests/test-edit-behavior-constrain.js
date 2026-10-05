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

// A corner at the end of a straight that leaves a smooth point, with one handle
// of its own on the other side. Shift+Alt moves the corner on the axis like
// any Shift drag; its own handle stays, as under Alt alone, and the smooth
// point keeps its handle on the straight.
function makeCornerAfterSmoothGlyph(reversed) {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 60, type: "cubic" },
    { x: 60, y: 80, type: "cubic" },
    { x: 100, y: 100, smooth: true },
    { x: 200, y: 150 },
    { x: 240, y: 150, type: "cubic" },
    { x: 280, y: 100, type: "cubic" },
    { x: 300, y: 0 },
  ];
  return {
    path: VarPackedPath.fromUnpackedContours([
      { isClosed: false, points: reversed ? [...points].reverse() : points },
    ]),
    components: [],
    anchors: [],
    guidelines: [],
    backgroundImage: null,
  };
}

describe("Shift+Alt on a one-handle corner", () => {
  for (const reversed of [false, true])
    for (const [delta, moved] of [
      [
        { x: 30, y: 7 },
        { x: 30, y: 0 },
      ],
      [
        { x: 5, y: -40 },
        { x: 0, y: -40 },
      ],
    ]) {
      it(`moves the corner on the axis and leaves its handle (delta ${delta.x},${delta.y}${reversed ? ", reversed" : ""})`, () => {
        const glyph = makeCornerAfterSmoothGlyph(reversed);
        const at = (index) => (reversed ? 7 - index : index);
        const behavior = new EditBehaviorFactory(
          glyph,
          new Set([`point/${at(4)}`]),
          false
        ).getBehavior("alternate-constrain");
        applyChange(glyph, behavior.makeChangeForDelta(delta));
        const point = (index) => glyph.path.getPoint(at(index));

        expect(point(4)).to.include({ x: 200 + moved.x, y: 150 + moved.y });
        expect(point(5)).to.include({ x: 240, y: 150 });
        expect(point(3)).to.include({ x: 100, y: 100 });
        // The smooth point's handle stays on the straight it leaves.
        expect(angle(point(2), point(3))).to.be.closeTo(angle(point(3), point(4)), 1);
      });
    }
});

describe("Shift+Alt moves a point horizontally or vertically only", () => {
  const drag = (name, delta) => {
    const glyph = makeCornerAfterSmoothGlyph(false);
    const behavior = new EditBehaviorFactory(
      glyph,
      new Set(["point/4"]),
      false
    ).getBehavior(name);
    applyChange(glyph, behavior.makeChangeForDelta(delta));
    return glyph.path.getPoint(4);
  };

  it("takes the larger axis where Shift alone would go diagonal", () => {
    expect(drag("alternate-constrain", { x: 30, y: 25 })).to.include({
      x: 230,
      y: 150,
    });
    expect(drag("alternate-constrain", { x: -24, y: 30 })).to.include({
      x: 200,
      y: 180,
    });
  });

  it("leaves plain Shift its diagonal", () => {
    expect(drag("constrain", { x: 30, y: 26 })).to.include({ x: 228, y: 178 });
  });
});

describe("a snap owns the final point rounding", () => {
  it("preserves fractional placement through change application, and resets on release", () => {
    const glyph = makeCornerAfterSmoothGlyph(false);
    const behavior = new EditBehaviorFactory(glyph, new Set(["point/4"])).getBehavior(
      "default"
    );
    applyChange(
      glyph,
      behavior.makeChangeForDelta({ x: 0.25, y: 0.75 }, { preserveSnap: true })
    );
    expect(glyph.path.getPoint(4)).to.include({ x: 200.25, y: 150.75 });
    applyChange(glyph, behavior.makeChangeForDelta({ x: 0.25, y: 0.75 }));
    expect(glyph.path.getPoint(4)).to.include({ x: 200, y: 151 });
  });
});
