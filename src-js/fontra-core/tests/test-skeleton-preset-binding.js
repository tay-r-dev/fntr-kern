import { expect } from "chai";
import {
  SERIF_PRESETS,
  applySkeletonWidthPreset,
  applyTerminalPreset,
  getSkeletonPointPreset,
  isSkeletonPointPresetStale,
  liftChangedPresetBindings,
  normalizeSkeletonData,
  normalizeSkeletonPoint,
  setSkeletonCapParameters,
  setSkeletonPointPreset,
  setSkeletonPointTotalWidth,
} from "@fontra/core/skeleton-model.js";

function skeletonWithPoint(point) {
  return normalizeSkeletonData({
    contours: [
      {
        id: "c1",
        closed: false,
        defaultWidth: 40,
        points: [
          { id: "p1", x: 0, y: 0, ...point },
          { id: "p2", x: 0, y: 100 },
        ],
      },
    ],
  });
}

describe("skeleton preset binding", () => {
  it("survives normalization, and an unbound point carries no field", () => {
    const bound = normalizeSkeletonPoint({ x: 0, y: 0, preset: { width: "Stem" } });
    expect(getSkeletonPointPreset(bound, "width")).to.equal("Stem");
    expect(getSkeletonPointPreset(bound, "terminal")).to.equal(null);
    expect(normalizeSkeletonPoint({ x: 0, y: 0 })).to.not.have.property("preset");
  });

  it("sets and clears one kind without touching the other", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    setSkeletonPointPreset(point, "width", "Stem");
    setSkeletonPointPreset(point, "terminal", "Egyptian");
    setSkeletonPointPreset(point, "width", null);
    expect(getSkeletonPointPreset(point, "width")).to.equal(null);
    expect(getSkeletonPointPreset(point, "terminal")).to.equal("Egyptian");
    setSkeletonPointPreset(point, "terminal", null);
    expect(point).to.not.have.property("preset");
  });

  it("is stale only when the preset states a different width", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    applySkeletonWidthPreset(point, 40, { width: 60 });
    const contour = { defaultWidth: 40, singleSided: null };
    expect(isSkeletonPointPresetStale(point, "width", { width: 60 }, contour)).to.equal(
      false
    );
    expect(isSkeletonPointPresetStale(point, "width", { width: 70 }, contour)).to.equal(
      true
    );
  });

  it("is stale when the preset states a different projection side", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    applySkeletonWidthPreset(point, 40, { width: 60 });
    const both = { defaultWidth: 40, singleSided: null };
    const left = { defaultWidth: 40, singleSided: "left" };
    expect(
      isSkeletonPointPresetStale(point, "width", { width: 60, side: "both" }, both)
    ).to.equal(false);
    expect(
      isSkeletonPointPresetStale(point, "width", { width: 60, side: "left" }, both)
    ).to.equal(true);
    expect(
      isSkeletonPointPresetStale(point, "width", { width: 60, side: "left" }, left)
    ).to.equal(false);
  });

  it("lifts a width bond when the contour's projection side changes", () => {
    const before = skeletonWithPoint({ preset: { width: "Stem" } });
    const after = structuredClone(before);
    after.contours[0].singleSided = "right";
    liftChangedPresetBindings(before, after);
    expect(getSkeletonPointPreset(after.contours[0].points[0], "width")).to.equal(null);
  });

  it("is stale only when the terminal preset states a different shape", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    applyTerminalPreset(point, "serif", SERIF_PRESETS[0]);
    expect(
      isSkeletonPointPresetStale(point, "terminal", SERIF_PRESETS[0], {
        defaultWidth: 40,
      })
    ).to.equal(false);
    expect(
      isSkeletonPointPresetStale(point, "terminal", SERIF_PRESETS[1], {
        defaultWidth: 40,
      })
    ).to.equal(true);
    const square = normalizeSkeletonPoint({ x: 0, y: 0 });
    applyTerminalPreset(square, "square", { capAngle: 10, capDistance: 5 });
    expect(
      isSkeletonPointPresetStale(
        square,
        "terminal",
        { capAngle: 10, capDistance: 5 },
        { defaultWidth: 40 }
      )
    ).to.equal(false);
    expect(
      isSkeletonPointPresetStale(
        square,
        "terminal",
        { capAngle: 10, capDistance: 6 },
        { defaultWidth: 40 }
      )
    ).to.equal(true);
  });

  it("lifts a width bond when the width changes, and keeps the terminal bond", () => {
    const before = skeletonWithPoint({
      preset: { width: "Stem", terminal: "Egyptian" },
    });
    const after = structuredClone(before);
    setSkeletonPointTotalWidth(after.contours[0].points[0], 40, 90);
    liftChangedPresetBindings(before, after);
    const point = after.contours[0].points[0];
    expect(getSkeletonPointPreset(point, "width")).to.equal(null);
    expect(getSkeletonPointPreset(point, "terminal")).to.equal("Egyptian");
  });

  it("lifts a terminal bond when the terminal changes", () => {
    const before = skeletonWithPoint({ preset: { terminal: "Wedge" } });
    const after = structuredClone(before);
    setSkeletonCapParameters(after.contours[0].points[0], { capStyle: "round" });
    liftChangedPresetBindings(before, after);
    expect(getSkeletonPointPreset(after.contours[0].points[0], "terminal")).to.equal(
      null
    );
  });

  it("keeps every bond when nothing it covers changed", () => {
    const before = skeletonWithPoint({ preset: { width: "Stem" } });
    const after = structuredClone(before);
    after.contours[0].points[0].x = 25;
    liftChangedPresetBindings(before, after);
    expect(getSkeletonPointPreset(after.contours[0].points[0], "width")).to.equal(
      "Stem"
    );
  });
});
