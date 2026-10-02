import { expect } from "chai";
import { bulbEndCurvature } from "../src/bulb-harmonization.js";
import { generateFromSkeleton } from "../src/skeleton-generator.js";

describe("bulb curvature near a vertical terminal", () => {
  it("matches the entry and body joins on both sides of vertical", () => {
    for (const dx of [-20, -5, -1, 0, 1, 5, 20]) {
      const generated = generateFromSkeleton({
        contours: [
          {
            id: 17,
            closed: false,
            defaultWidth: 80,
            singleSided: "right",
            points: [
              {
                id: 18,
                x: 451,
                y: 292,
                capStyle: "drop",
                capBallEasing: 0,
                capBallRatio: 1.82,
                capBallShape: 0,
                capBallEdits: { bottom: { slide: -4 }, neck: { out: -4 } },
                width: { left: 37, right: 37 },
              },
              { id: 19, x: 451 + dx, y: 417, type: "cubic" },
              { id: 20, x: 369, y: 471, type: "cubic" },
              {
                id: 21,
                x: 244,
                y: 471,
                smooth: true,
                nudge: { left: 0, right: 3 },
                width: { left: 18.5, right: 18.5 },
              },
              { id: 22, x: 116, y: 471, type: "cubic" },
              { id: 23, x: 40, y: 379, type: "cubic" },
              { id: 24, x: 40, y: 250, width: { left: 40, right: 40 } },
            ],
          },
        ],
      });
      const points = generated.contours[0].points;
      const map = generated.provenance[0].pointMap;
      const roleIndex = (role) =>
        map.findIndex((p) => p?.bulbRole === role && p.bulbSlot === "onCurve");
      const entry = roleIndex("entry");
      const direction = (entry + 3) % points.length === roleIndex("bottom") ? 1 : -1;
      const curve = (start) =>
        Array.from(
          { length: 4 },
          (_, i) =>
            points[
              (entry + direction * (start + i) + 3 * points.length) % points.length
            ]
        );
      for (const join of [0, 3, 6]) {
        const before = bulbEndCurvature(curve(join - 3), true);
        const after = bulbEndCurvature(curve(join));
        const relativeStep =
          Math.abs(before - after) / Math.max(1e-6, Math.abs(before), Math.abs(after));
        expect(relativeStep, `handle dx ${dx}, join ${join}`).to.be.below(0.002);
      }
      expect(points[roleIndex("neck")].smooth).not.to.equal(true);
    }
  });
});
