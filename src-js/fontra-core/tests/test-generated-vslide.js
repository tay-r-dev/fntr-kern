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

  it("slides a bulb point along the ball", () => {
    const cap = { capStyle: "drop", capBallEasing: 0.5, capBallSide: "left" };
    const plain = generateFromSkeleton(skeleton({}, cap));
    for (const role of ["bottom", "side", "neck"])
      for (const value of [-0.3, 0.3]) {
        const slid = generateFromSkeleton(
          skeleton({}, { ...cap, capBallEdits: { [role]: { vslide: value } } })
        );
        const at = (result) =>
          onCurve(result, (m) => m?.bulbRole === role && m.bulbSlot === "onCurve");
        const moved = Math.hypot(at(slid).x - at(plain).x, at(slid).y - at(plain).y);
        expect(moved, `${role} ${value}`).to.be.greaterThan(2);
        expect(
          departure(slid.contours[0].points, plain.contours[0].points),
          `${role} ${value}`
        ).to.be.below(1.5);
      }
  });
});
