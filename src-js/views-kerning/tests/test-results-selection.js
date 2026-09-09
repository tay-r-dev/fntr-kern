import { expect } from "chai";
import {
  deselectAll,
  pressReset,
  retainVisible,
  selectRow,
} from "../src/results-selection.js";

describe("results-selection", () => {
  it("ordinary click selects alone; shift-click toggles individually, never a range", () => {
    let s = { selected: new Set() };
    s = selectRow(s, "a", false);
    expect([...s.selected]).to.deep.equal(["a"]);
    s = selectRow(s, "c", true);
    expect([...s.selected]).to.deep.equal(["a", "c"]);
    // shift-click again on "a" removes only "a", "b" (never selected) stays absent
    s = selectRow(s, "a", true);
    expect([...s.selected]).to.deep.equal(["c"]);
    // plain click replaces the whole selection
    s = selectRow(s, "b", false);
    expect([...s.selected]).to.deep.equal(["b"]);
  });

  it("retainVisible drops selection for rows no longer displayed", () => {
    let s = { selected: new Set(["a", "c"]) };
    s = retainVisible(s, new Set(["c"]));
    expect([...s.selected]).to.deep.equal(["c"]);
  });

  it("deselectAll clears the selection", () => {
    const s = deselectAll();
    expect(s.selected.size).to.equal(0);
  });

  it("pressReset needs two presses on the same unordered target set", () => {
    const a = pressReset(null, ["a", "b"]);
    expect(a.commit).to.equal(false);
    expect(pressReset(a.armedKey, ["b", "a"]).commit).to.equal(true);
  });

  it("pressReset disarms when the target set changes between presses", () => {
    const a = pressReset(null, ["a", "b"]);
    expect(pressReset(a.armedKey, ["a"]).commit).to.equal(false);
  });

  it("pressReset never commits with no targets", () => {
    expect(pressReset(null, []).commit).to.equal(false);
  });
});
