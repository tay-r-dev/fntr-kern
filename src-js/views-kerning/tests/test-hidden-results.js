import { expect } from "chai";
import {
  hiddenFromCacheEntry,
  rowVisibleForHiddenState,
  rowId,
} from "../src/results-model.js";
import { retainVisible } from "../src/results-selection.js";

// Task 11, spec F10/F17. Three pure pieces named in the brief: the
// junk/hidden field-mapping decision, the hidden-state visibility
// predicate, and selection pruning when a hide action removes a row from
// display (F25's existing mechanism, reused rather than rebuilt).
describe("hidden results (Task 11)", () => {
  it("hiddenFromCacheEntry reads the cache's own `junk` field without renaming it in storage", () => {
    expect(hiddenFromCacheEntry({ junk: true })).to.equal(true);
    expect(hiddenFromCacheEntry({ junk: false })).to.equal(false);
    expect(hiddenFromCacheEntry({})).to.equal(false);
    expect(hiddenFromCacheEntry(undefined)).to.equal(false);
  });

  it("rowVisibleForHiddenState: hidden rows are suppressed unless Show hidden is on", () => {
    expect(rowVisibleForHiddenState(false, false)).to.equal(true);
    expect(rowVisibleForHiddenState(true, false)).to.equal(false);
    expect(rowVisibleForHiddenState(true, true)).to.equal(true);
    expect(rowVisibleForHiddenState(false, true)).to.equal(true);
  });

  it("hiding a selected row removes it from the visible set, which prunes its highlight/tick (F10 + F25)", () => {
    const id = rowId("s1", "A", "V");
    let selection = { highlighted: new Set([id]), ticked: new Set([id]) };
    // Simulate a render pass: the row is now hidden, so it is not part of
    // the visible-row-id set the next renderPairTable computes -- exactly
    // how kerning.js's own retainVisible call already works for filtering
    // (Task 3/F25); Task 11 introduces no second pruning mechanism.
    const visibleIdsAfterHiding = new Set(); // this row no longer renders
    selection = retainVisible(selection, visibleIdsAfterHiding);
    expect(selection.highlighted.size).to.equal(0);
    expect(selection.ticked.size).to.equal(0);
  });

  it("restoring a hidden row (Show hidden + eye action) does not require re-selecting it automatically", () => {
    // F17: restoring visibility is reversible, but selection is not part of
    // what an eye action touches -- a restored row starts unselected, same
    // as any other row appearing in a fresh render.
    const id = rowId("s1", "A", "V");
    let selection = { highlighted: new Set(), ticked: new Set() };
    const visibleIdsAfterRestore = new Set([id]);
    selection = retainVisible(selection, visibleIdsAfterRestore);
    expect(selection.highlighted.has(id)).to.equal(false);
    expect(selection.ticked.has(id)).to.equal(false);
  });
});
