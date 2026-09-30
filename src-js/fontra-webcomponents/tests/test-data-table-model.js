import { expect } from "chai";
import {
  clampWindowStart,
  fitColumnWidths,
  spreadColumnWidths,
  parseCellValue,
  parseStoredColumnWidths,
  resizedColumnWidth,
  scrollWindowShift,
  stepCellValue,
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

  it("commits empty number text as null only when empty is allowed", () => {
    expect(parseCellValue("", { type: "number", allowEmpty: true })).to.deep.equal({
      valid: true,
      value: null,
    });
    expect(parseCellValue("  ", { type: "number", allowEmpty: true }).value).to.equal(
      null
    );
    expect(parseCellValue("x", { type: "number", allowEmpty: true }).valid).to.equal(
      false
    );
  });

  it("keeps a text cell as text", () => {
    expect(parseCellValue("Stem", { type: "text" })).to.deep.equal({
      valid: true,
      value: "Stem",
    });
    expect(parseCellValue("", {})).to.deep.equal({ valid: true, value: "" });
  });

  it("steps a number cell by its step, ten steps with Shift", () => {
    expect(stepCellValue("12", { step: 1, direction: 1 })).to.equal(13);
    expect(stepCellValue("12", { step: 1, direction: -1 })).to.equal(11);
    expect(stepCellValue("12", { step: 1, direction: 1, big: true })).to.equal(22);
    expect(stepCellValue("12", { step: 1, direction: -1, big: true })).to.equal(2);
    expect(stepCellValue("0.5", { step: 0.1, direction: 1 })).to.equal(0.6);
  });

  it("steps from zero when the cell holds no number", () => {
    expect(stepCellValue("", { step: 1, direction: 1 })).to.equal(1);
    expect(stepCellValue("x", { step: 1, direction: -1, big: true })).to.equal(-10);
  });

  it("reads stored column widths, keeping only sane pixel values", () => {
    expect(parseStoredColumnWidths('{"L":80,"R":64.5}')).to.deep.equal({
      L: 80,
      R: 64.5,
    });
    expect(parseStoredColumnWidths('{"L":"wide","R":-4,"C":0}')).to.deep.equal({});
    expect(parseStoredColumnWidths("not json")).to.deep.equal({});
    expect(parseStoredColumnWidths(null)).to.deep.equal({});
    expect(parseStoredColumnWidths("[1,2]")).to.deep.equal({});
  });

  it("resizes a column by the drag, never below its minimum", () => {
    expect(resizedColumnWidth(80, 20)).to.equal(100);
    expect(resizedColumnWidth(80, -70)).to.equal(24);
    expect(resizedColumnWidth(80, -70, 40)).to.equal(40);
    expect(resizedColumnWidth(80, 0.4)).to.equal(80);
  });

  it("leaves widths that fit as they are", () => {
    expect(fitColumnWidths([56, 64, 96, 56], 300)).to.deep.equal([56, 64, 96, 56]);
  });

  it("takes the same amount off every column when they do not fit", () => {
    // 272 into 232: 40 over, 10 off each.
    expect(fitColumnWidths([56, 64, 96, 56], 232)).to.deep.equal([46, 54, 86, 46]);
  });

  it("shares a column's unmet share among the others once it hits the minimum", () => {
    // 150 into 110: 40 over. 30 can give 6; the rest give 34 between them.
    expect(fitColumnWidths([30, 60, 60], 110, 24)).to.deep.equal([24, 43, 43]);
  });

  it("stops at the minimum when even that does not fit", () => {
    expect(fitColumnWidths([56, 64], 20, 24)).to.deep.equal([24, 24]);
  });

  it("spreads a wider box equally over the columns", () => {
    expect(spreadColumnWidths([56, 64, 96, 56], 40)).to.deep.equal([66, 74, 106, 66]);
  });

  it("takes a narrower box equally from the columns, down to the minimum", () => {
    expect(spreadColumnWidths([56, 64, 96, 56], -40)).to.deep.equal([46, 54, 86, 46]);
    expect(spreadColumnWidths([30, 60, 60], -40, 24)).to.deep.equal([24, 43, 43]);
  });

  it("leaves the widths alone when the box does not change", () => {
    expect(spreadColumnWidths([56, 64], 0)).to.deep.equal([56, 64]);
  });
});
