import { expect } from "chai";
import { rowVisibleInDefault, rowVisibleInPotential } from "../src/results-model.js";

// Task 8 (plan Task 8's own fixture): one class summary, one unique pair,
// one exposed member, one saved exception, and one candidate. Spec §2.1
// invariants 5/6, F19.
describe("results-model: tab/exposure row visibility (Task 8)", () => {
  const classSummary = { kind: "class-rule", left: "@Upper", right: "@Lower" };
  const uniquePair = { kind: "unique-pair", left: "comma", right: "quotedblleft" };
  // A grouped member with no saved rule of its own -- hidden by default
  // (invariant 5), shown only through deliberate exposure.
  const hiddenMember = { kind: "member-pair", left: "A", right: "V" };
  // Same kind, but named directly via "%name%!" -- exposedNames carries it.
  const exposedMember = { kind: "member-pair", left: "Adieresis", right: "W" };
  // A saved exception is a stored explicit rule -- always in Default,
  // regardless of exposure, and never a Potential candidate (spec F19:
  // "Existing saved exceptions are included in Default").
  const savedException = { kind: "pair-exception", left: "T", right: "comma" };
  // A candidate: outside class tolerance, not saved -- Potential only,
  // unless also deliberately exposed.
  const candidate = {
    kind: "member-pair",
    left: "B",
    right: "V",
    isCandidate: true,
  };

  const allRows = [
    classSummary,
    uniquePair,
    hiddenMember,
    exposedMember,
    savedException,
    candidate,
  ];

  it("Default contains the summary, the unique pair, and the saved exception even with nothing exposed", () => {
    const exposed = new Set();
    const visible = allRows.filter((row) => rowVisibleInDefault(row, exposed, false));
    expect(visible).to.include(classSummary);
    expect(visible).to.include(uniquePair);
    expect(visible).to.include(savedException);
    expect(visible).to.not.include(hiddenMember);
    expect(visible).to.not.include(candidate); // not exposed, not shown yet
  });

  it("naming a member with %name%! exposes it without hiding its class summary", () => {
    const exposed = new Set(["Adieresis"]);
    const visible = allRows.filter((row) => rowVisibleInDefault(row, exposed, false));
    expect(visible).to.include(exposedMember);
    expect(visible).to.include(classSummary); // invariant 6: summary stays
    expect(visible).to.not.include(hiddenMember); // still hidden -- not named
  });

  it('"Show individual class members" exposes every member row at once, summaries stay', () => {
    const visible = allRows.filter((row) => rowVisibleInDefault(row, new Set(), true));
    expect(visible).to.include(hiddenMember);
    expect(visible).to.include(exposedMember);
    expect(visible).to.include(candidate); // a candidate is still a member-pair row
    expect(visible).to.include(classSummary);
  });

  it("a candidate qualifying as a member also appearing in Default does not save anything -- it is just visible", () => {
    // Exposing the specific candidate glyph shows it in Default too (F19:
    // "including members that also qualify as candidates").
    const exposed = new Set(["B"]);
    const visible = allRows.filter((row) => rowVisibleInDefault(row, exposed, false));
    expect(visible).to.include(candidate);
  });

  it("Potential shows only rows flagged as candidates by the caller -- it never computes candidacy itself", () => {
    const visible = allRows.filter(rowVisibleInPotential);
    expect(visible).to.deep.equal([candidate]);
    expect(visible).to.not.include(savedException);
    expect(visible).to.not.include(classSummary);
  });
});
