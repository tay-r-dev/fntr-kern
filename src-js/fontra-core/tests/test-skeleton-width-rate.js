import {
  edgeTiltAngle,
  easedWidth,
  easedWidthRate,
  jointWidthRate,
} from "@fontra/core/skeleton-width-rate.js";
import { expect } from "chai";

describe("skeleton width rate", () => {
  describe("easedWidth", () => {
    it("lands exactly on the two on-curve widths", () => {
      expect(easedWidth(10, 40, 30, 0, 0)).to.equal(10);
      expect(easedWidth(10, 40, 30, 0, 1)).to.equal(40);
    });

    it("is the even change when both rates equal the change", () => {
      for (const t of [0.125, 0.25, 0.5, 0.75, 0.875]) {
        expect(easedWidth(10, 40, 30, 30, t)).to.be.closeTo(10 + 30 * t, 1e-12);
      }
    });

    it("reads 28.75 halfway when it leaves at 30 and arrives flat", () => {
      expect(easedWidth(10, 40, 30, 0, 0.5)).to.be.closeTo(28.75, 1e-12);
    });

    it("leaves and arrives at the rates it was given", () => {
      const h = 1e-6;
      const slope = (t) =>
        (easedWidth(10, 40, 30, 5, t + h) - easedWidth(10, 40, 30, 5, t - h)) / (2 * h);
      expect(slope(h)).to.be.closeTo(30, 1e-3);
      expect(slope(1 - h)).to.be.closeTo(5, 1e-3);
      expect(easedWidthRate(10, 40, 30, 5, 0)).to.be.closeTo(30, 1e-12);
      expect(easedWidthRate(10, 40, 30, 5, 1)).to.be.closeTo(5, 1e-12);
    });
  });

  describe("jointWidthRate", () => {
    it("keeps a steady change steady", () => {
      expect(jointWidthRate(0.4, 0.4)).to.be.closeTo(0.4, 1e-12);
    });

    it("is zero where the width peaks, bottoms out or stops changing", () => {
      expect(jointWidthRate(0.4, -0.2)).to.equal(0);
      expect(jointWidthRate(-0.4, 0.2)).to.equal(0);
      expect(jointWidthRate(0.4, 0)).to.equal(0);
      expect(jointWidthRate(0, -0.3)).to.equal(0);
    });

    it("never exceeds either neighbour, so the width cannot overshoot", () => {
      for (const [a, b] of [
        [0.1, 2],
        [3, 0.05],
        [-1, -0.2],
      ]) {
        const rate = jointWidthRate(a, b);
        expect(Math.abs(rate)).to.be.at.most(2 * Math.min(Math.abs(a), Math.abs(b)));
        expect(Math.sign(rate)).to.equal(Math.sign(a));
      }
    });

    it("is continuous as one side passes through zero", () => {
      const values = [-0.002, -0.001, 0, 0.001, 0.002].map((b) =>
        jointWidthRate(0.5, b)
      );
      for (let i = 1; i < values.length; i++) {
        expect(Math.abs(values[i] - values[i - 1])).to.be.below(0.005);
      }
    });
  });

  describe("edgeTiltAngle", () => {
    it("is zero at constant width, whatever the curvature", () => {
      expect(edgeTiltAngle(0, 30, 0.01)).to.equal(0);
      expect(edgeTiltAngle(0, -30, -0.02)).to.equal(0);
    });

    it("is the slope of the edge on a straight skeleton", () => {
      expect(edgeTiltAngle(0.5, 20, 0)).to.be.closeTo(Math.atan(0.5), 1e-12);
    });

    it("matches the true edge of a tapered curved stroke", () => {
      // A quarter circle of radius 100, from (100, 0) counter-clockwise, with the
      // signed width growing along the arc. The edge is p + n * w, and its
      // direction is measured by finite difference.
      const radius = 100;
      const width = (s) => -10 - 0.3 * s; // signed, per unit of arc
      const edge = (s) => {
        const a = s / radius;
        const p = { x: radius * Math.cos(a), y: radius * Math.sin(a) };
        const d = { x: -Math.sin(a), y: Math.cos(a) };
        const n = { x: d.y, y: -d.x };
        const w = width(s);
        return { x: p.x + n.x * w, y: p.y + n.y * w };
      };
      const s = 40;
      const h = 1e-5;
      const a = edge(s + h);
      const b = edge(s - h);
      const tangent = { x: -Math.sin(s / radius), y: Math.cos(s / radius) };
      const normal = { x: tangent.y, y: -tangent.x };
      const along = (a.x - b.x) * tangent.x + (a.y - b.y) * tangent.y;
      const across = (a.x - b.x) * normal.x + (a.y - b.y) * normal.y;
      const expected = Math.atan2(across, along);
      // The circle turns left, so in the normal convention (dy, -dx) the
      // signed curvature is 1 / radius, read the way the solver reads it.
      expect(edgeTiltAngle(-0.3, width(s), 1 / radius)).to.be.closeTo(expected, 1e-6);
    });
  });
});
