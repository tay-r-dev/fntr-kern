import { expect } from "chai";
import {
  clampWindowStart,
  parseCellValue,
  scrollWindowShift,
  windowEnd,
} from "../src/data-table-model.js";

describe("data-table-model", () => {
  it("clamps the window start inside the item list", () => {
    expect(clampWindowStart(0, 4, 100)).to.equal(0);
    expect(clampWindowStart(50, 4, 100)).to.equal(0);
    expect(clampWindowStart(200, 150, 100)).to.equal(50);
    expect(clampWindowStart(-5, 150, 100)).to.equal(0);
  });

  it("ends the window at the size or at the list end", () => {
    expect(windowEnd(0, 235, 100)).to.equal(100);
    expect(windowEnd(135, 235, 100)).to.equal(235);
    expect(windowEnd(0, 4, 100)).to.equal(4);
  });

  it("shifts the window by a step near an edge that has more rows", () => {
    const box = {
      scrollHeight: 2000,
      clientHeight: 300,
      size: 100,
      step: 25,
      edge: 200,
    };
    expect(
      scrollWindowShift({ ...box, scrollTop: 1600, start: 0, total: 235 })
    ).to.equal(25);
    expect(
      scrollWindowShift({ ...box, scrollTop: 1600, start: 135, total: 235 })
    ).to.equal(0);
    expect(
      scrollWindowShift({ ...box, scrollTop: 100, start: 25, total: 235 })
    ).to.equal(-25);
    expect(
      scrollWindowShift({ ...box, scrollTop: 100, start: 0, total: 235 })
    ).to.equal(0);
    expect(
      scrollWindowShift({ ...box, scrollTop: 800, start: 25, total: 235 })
    ).to.equal(0);
  });

  it("parses a number cell, rounding when asked, and rejects empty or bad text", () => {
    expect(parseCellValue("12.6", { type: "number", round: true })).to.deep.equal({
      valid: true,
      value: 13,
    });
    expect(parseCellValue("12.6", { type: "number" })).to.deep.equal({
      valid: true,
      value: 12.6,
    });
    expect(parseCellValue(" ", { type: "number" }).valid).to.equal(false);
    expect(parseCellValue("abc", { type: "number" }).valid).to.equal(false);
  });

  it("keeps a text cell as text", () => {
    expect(parseCellValue("Stem", { type: "text" })).to.deep.equal({
      valid: true,
      value: "Stem",
    });
    expect(parseCellValue("", {})).to.deep.equal({ valid: true, value: "" });
  });
});
