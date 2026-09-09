import { expect } from "chai";
import {
  countHiddenClassRules,
  countHiddenPairs,
  countSavedPairExceptions,
  flattenPairAddresses,
  rowId,
} from "../src/results-model.js";

// Task 18, spec F03, ledger §8.6: the four analytics metrics' own counting
// rules. Navigation and DOM rendering live in kerning.js (untestable under
// plain Node/Mocha, per Task 16's own confirmed blocker, ledger §11.2/§11.5)
// -- this file covers only the pure counting logic that decides each
// metric's number, against fixture data shaped exactly like the real
// KerningController.values map and autokern cache entries.
describe("kerning analytics counts (Task 18)", () => {
  const values = {
    // A × V: literal pair, neither side classed -- a plain stored unique
    // value, never a "class exception".
    A: { V: [-10] },
    // Adieresis × W: literal pair, Adieresis IS a class member -- a real
    // saved pair exception.
    Adieresis: { W: [-30] },
    // A class rule address (both sides class tokens) -- must never be
    // counted as one of its own exceptions.
    "@A": { "@V": [-80] },
    // A mixed class/glyph rule address (one side a class token) -- also not
    // a member-pair exception.
    "@A2": { W: [-50] },
  };
  const isLeftClassed = (name) => name === "Adieresis";
  const isRightClassed = (name) => false;

  it("flattenPairAddresses excludes any address with a class-token side", () => {
    const addresses = flattenPairAddresses(values);
    expect(addresses).to.deep.equal([
      { left: "A", right: "V" },
      { left: "Adieresis", right: "W" },
    ]);
  });

  it("countSavedPairExceptions counts only literal pairs with a classed side", () => {
    const addresses = flattenPairAddresses(values);
    expect(countSavedPairExceptions(addresses, isLeftClassed, isRightClassed)).to.equal(
      1
    );
  });

  it("countSavedPairExceptions is 0 when no address has any classed side", () => {
    const addresses = flattenPairAddresses(values);
    expect(countSavedPairExceptions(addresses, () => false, () => false)).to.equal(0);
  });

  it("countSavedPairExceptions never sees a class-rule address at all", () => {
    // Even a class token that would (wrongly) read as "classed" can't be
    // counted, because flattenPairAddresses already excluded it.
    const alwaysClassed = () => true;
    const addresses = flattenPairAddresses({ "@A": { "@V": [-80] } });
    expect(addresses).to.deep.equal([]);
    expect(countSavedPairExceptions(addresses, alwaysClassed, alwaysClassed)).to.equal(
      0
    );
  });

  it("countHiddenPairs reads the cache's own junk field, not a render-time filtered list", () => {
    const cacheEntries = [
      { left: "A", right: "V", junk: true },
      { left: "B", right: "W", junk: false },
      { left: "C", right: "X" },
    ];
    expect(countHiddenPairs(cacheEntries)).to.equal(1);
  });

  it("countHiddenClassRules scopes to one source and ignores another source's hidden rows", () => {
    const hiddenIds = new Set([
      rowId("s1", "@A", "@V"),
      rowId("s1", "@B", "@W"),
      rowId("s2", "@A", "@V"),
    ]);
    expect(countHiddenClassRules(hiddenIds, "s1")).to.equal(2);
    expect(countHiddenClassRules(hiddenIds, "s2")).to.equal(1);
    expect(countHiddenClassRules(hiddenIds, "s3")).to.equal(0);
  });
});
