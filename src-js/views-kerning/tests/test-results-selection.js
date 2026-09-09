import { expect } from "chai";
import {
  deselectAll,
  pressReset,
  retainVisible,
  selectRow,
  tickRow,
} from "../src/results-selection.js";

describe("results-selection", () => {
  it("ordinary click highlights alone; shift-click toggles individually, never a range", () => {
    let s = { highlighted: new Set(), ticked: new Set() };
    s = selectRow(s, "a", false);
    expect([...s.highlighted]).to.deep.equal(["a"]);
    s = selectRow(s, "c", true);
    expect([...s.highlighted]).to.deep.equal(["a", "c"]);
    // shift-click again on "a" removes only "a", "b" (never selected) stays absent
    s = selectRow(s, "a", true);
    expect([...s.highlighted]).to.deep.equal(["c"]);
    // plain click replaces the whole highlighted set
    s = selectRow(s, "b", false);
    expect([...s.highlighted]).to.deep.equal(["b"]);
  });

  it("checking a highlighted row ticks every highlighted row; unhighlighted rows tick alone", () => {
    let s = { highlighted: new Set(), ticked: new Set() };
    s = selectRow(s, "a", false);
    s = selectRow(s, "c", true);
    s = tickRow(s, "a", true);
    expect([...s.ticked].sort()).to.deep.equal(["a", "c"]);
    expect([...s.highlighted].sort()).to.deep.equal(["a", "c"]); // ticking preserves highlight

    s = tickRow(s, "z", true); // "z" is not highlighted
    expect([...s.ticked].sort()).to.deep.equal(["a", "c", "z"]);

    s = tickRow(s, "c", false);
    expect([...s.ticked].sort()).to.deep.equal(["z"]); // "c" was highlighted, so was "a"
  });

  it("retainVisible drops selection for rows no longer displayed", () => {
    let s = { highlighted: new Set(["a", "c"]), ticked: new Set(["a", "c"]) };
    s = retainVisible(s, new Set(["c"]));
    expect([...s.highlighted]).to.deep.equal(["c"]);
    expect([...s.ticked]).to.deep.equal(["c"]);
  });

  it("deselectAll clears both layers", () => {
    const s = deselectAll();
    expect(s.highlighted.size).to.equal(0);
    expect(s.ticked.size).to.equal(0);
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
