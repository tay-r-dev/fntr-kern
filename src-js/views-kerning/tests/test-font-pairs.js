import { expect } from "chai";
import { pairKey } from "@fontra/core/autokern-cache.js";
import { fontPairs, splitZeroWrites, tableEntries } from "../src/results-model.js";

describe("font pairs before a run", () => {
  const envelope = (xMin, xMax, advance) => ({ xMin, xMax, advance });

  it("lists every ordered pair whose outlines could touch", () => {
    const envelopes = {
      a: envelope(10, 90, 100),
      b: envelope(10, 90, 100),
    };
    const pairs = fontPairs(["a", "b"], envelopes, 5);
    expect(pairs.map(({ left, right }) => left + right).sort()).to.deep.equal([
      "aa",
      "ab",
      "ba",
      "bb",
    ]);
  });

  it("leaves out a pair that can never touch and a glyph with no outline", () => {
    const envelopes = {
      a: envelope(0, 10, 1000),
      b: envelope(900, 1000, 1000),
    };
    const pairs = fontPairs(["a", "b", "space"], envelopes, 1);
    const names = pairs.map(({ left, right }) => left + right);
    expect(names).to.not.include("ab");
    expect(names.some((name) => name.includes("space"))).to.equal(false);
  });
});

describe("table entries", () => {
  it("adds an unmeasured entry for each font pair the cache does not hold", () => {
    const cache = new Map([[pairKey("A", "V"), { left: "A", right: "V", value: -40 }]]);
    const entries = [
      ...tableEntries(cache, [
        { left: "A", right: "V" },
        { left: "T", right: "o" },
      ]),
    ];
    expect(entries).to.deep.equal([
      { left: "A", right: "V", value: -40 },
      { left: "T", right: "o", value: null, unmeasured: true },
    ]);
  });

  it("is the cache alone when there is no font pair list yet", () => {
    const cache = new Map([[pairKey("A", "V"), { left: "A", right: "V", value: -40 }]]);
    expect([...tableEntries(cache, null)]).to.have.length(1);
  });
});

describe("zero writes", () => {
  const sel = (leftName, rightName) => ({ leftName, rightName, sourceIdentifier: "s" });

  it("removes a zero entry unless a class value would show through", () => {
    const inherited = { "A/V": 0, "T/o": -40 };
    const { writes, deletes } = splitZeroWrites(
      [sel("A", "V"), sel("T", "o"), sel("L", "T")],
      [0, 0, -60],
      (selector) => inherited[`${selector.leftName}/${selector.rightName}`] ?? 0
    );
    expect(deletes).to.deep.equal([sel("A", "V")]);
    expect(writes.selectors).to.deep.equal([sel("T", "o"), sel("L", "T")]);
    expect(writes.values).to.deep.equal([0, -60]);
  });
});
