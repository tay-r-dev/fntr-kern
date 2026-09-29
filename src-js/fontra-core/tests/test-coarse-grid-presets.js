import {
  COARSE_GRID_DEFAULT_SPACING,
  COARSE_GRID_DEFAULT_VALUES,
  buildCoarseGridValues,
  normalizeCoarseGridBase,
  normalizeCoarseGridIncrement,
  snapCoarseGridSpacing,
} from "@fontra/core/coarse-grid-presets.js";
import { expect } from "chai";

describe("coarse-grid-presets", () => {
  it("default values are 5..40 step 5", () => {
    expect(COARSE_GRID_DEFAULT_VALUES).deep.equals([5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it("normalizeCoarseGridBase clamps and rounds", () => {
    expect(normalizeCoarseGridBase(0)).equals(1);
    expect(normalizeCoarseGridBase(3.6)).equals(4);
    expect(normalizeCoarseGridBase(NaN)).equals(5);
    expect(normalizeCoarseGridBase("nope")).equals(5);
  });

  it("normalizeCoarseGridIncrement clamps and rounds", () => {
    expect(normalizeCoarseGridIncrement(0)).equals(1);
    expect(normalizeCoarseGridIncrement(2.4)).equals(2);
    expect(normalizeCoarseGridIncrement(undefined)).equals(5);
  });

  it("buildCoarseGridValues non-custom returns the defaults", () => {
    expect(
      buildCoarseGridValues({ custom: false, base: 99, increment: 99 })
    ).deep.equals([5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it("buildCoarseGridValues custom builds STEP_COUNT entries from base+increment", () => {
    expect(
      buildCoarseGridValues({ custom: true, base: 10, increment: 20 })
    ).deep.equals([10, 30, 50, 70, 90, 110, 130, 150]);
  });

  it("buildCoarseGridValues custom keeps values above the slider cap", () => {
    expect(
      buildCoarseGridValues({ custom: true, base: 45, increment: 20 })
    ).deep.equals([45, 65, 85, 105, 125, 145, 165, 185]);
  });

  it("buildCoarseGridValues custom normalizes bad base/increment", () => {
    expect(buildCoarseGridValues({ custom: true, base: 0, increment: 0 })).deep.equals([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("snapCoarseGridSpacing snaps to nearest value", () => {
    const values = [5, 10, 15, 20];
    expect(snapCoarseGridSpacing(12, values)).equals(10);
    expect(snapCoarseGridSpacing(13, values)).equals(15);
    expect(snapCoarseGridSpacing(100, values)).equals(20);
  });

  it("snapCoarseGridSpacing handles empty and non-finite", () => {
    expect(snapCoarseGridSpacing(12, [])).equals(COARSE_GRID_DEFAULT_SPACING);
    expect(snapCoarseGridSpacing(NaN, [5, 10, 15])).equals(10);
    expect(snapCoarseGridSpacing(NaN, [5])).equals(5);
  });
});
