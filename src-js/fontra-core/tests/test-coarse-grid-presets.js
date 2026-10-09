import {
  COARSE_GRID_DEFAULT_SPACING,
  COARSE_GRID_DEFAULT_VALUES,
  COARSE_GRID_TILE_MAX_PERIOD,
  buildCoarseGridValues,
  coarseGridDotTile,
  normalizeCoarseGridBase,
  normalizeCoarseGridIncrement,
  secondaryCoarseGridSpacing,
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

  it("the secondary spacing is the grid's times the multiplier", () => {
    const settings = { coarseGridCustom: true, coarseGridSecondaryMultiplier: 5 };
    expect(secondaryCoarseGridSpacing(settings, 20)).to.equal(100);
    expect(
      secondaryCoarseGridSpacing({ ...settings, coarseGridSecondaryMultiplier: 0 }, 20)
    ).to.equal(null);
    // Custom spacing does not matter.
    expect(
      secondaryCoarseGridSpacing({ ...settings, coarseGridCustom: false }, 20)
    ).to.equal(100);
  });

  it("the dot tile puts a dot centre on every crossing, at the asked radius", () => {
    for (const [period, radius, originX, originY] of [
      [6, 1.5, 0, 0],
      [7.37, 1.875, 123.4, -56.7],
      [63.9, 3, -1000.25, 2000.5],
    ]) {
      const tile = coarseGridDotTile({ period, radius, originX, originY });
      expect(Number.isInteger(tile.size)).to.equal(true);
      const { a, d, e, f } = tile.matrix;
      expect(tile.radius * a).to.be.closeTo(radius, 1 / 16);
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const tx = tile.size / 2 + i * tile.size;
          const ty = tile.size / 2 + j * tile.size;
          expect(a * tx + e).to.be.closeTo(originX + i * period, 1e-9);
          expect(d * ty + f).to.be.closeTo(originY + j * period, 1e-9);
        }
      }
    }
  });

  it("the dot tile shrinks its pattern by at most a pixel's worth", () => {
    for (const period of [6, 6.01, 9.99, 33.3, 64]) {
      const tile = coarseGridDotTile({ period, radius: 1, originX: 0, originY: 0 });
      expect(tile.matrix.a).to.be.at.most(1);
      expect(tile.matrix.a).to.be.above(1 - 1 / tile.size - 1e-9);
    }
  });

  it("periods that share a tile size share one tile, so a zoom reuses them", () => {
    const tiles = new Set();
    for (let period = 6.001; period <= 64; period += 0.01) {
      const tile = coarseGridDotTile({ period, radius: 1.5, originX: 0, originY: 0 });
      tiles.add(`${tile.size}|${tile.radius}`);
    }
    // 59 sizes, a few radii each: a few hundred tiles at most, not one a frame.
    expect(tiles.size).to.be.below(59 * 4);
  });

  it("no dot tile past the period where the dots are few", () => {
    expect(
      coarseGridDotTile({
        period: COARSE_GRID_TILE_MAX_PERIOD + 0.01,
        radius: 1,
        originX: 0,
        originY: 0,
      })
    ).to.equal(null);
  });
});
