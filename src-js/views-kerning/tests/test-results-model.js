import { expect } from "chai";
import {
  explicitPairExists,
  isStaleAsyncResult,
  passesNumericFilters,
  rowId,
  valuesForDisplay,
} from "../src/results-model.js";

describe("results-model", () => {
  it("rowId includes source and distinguishes class from literal addresses", () => {
    expect(rowId("s1", "@A", "@V")).to.not.equal(rowId("s1", "A", "V"));
    expect(rowId("s1", "A", "V")).to.not.equal(rowId("s2", "A", "V"));
    expect(rowId("s1", "A", "V")).to.equal(rowId("s1", "A", "V"));
  });

  it("valuesForDisplay hides proposed/delta when stale, keeps current", () => {
    expect(valuesForDisplay(-80, -30, true)).to.deep.equal({
      current: -80,
      proposed: null,
      delta: null,
      stale: true,
    });
    expect(valuesForDisplay(-80, -30, false)).to.deep.equal({
      current: -80,
      proposed: -30,
      delta: 50,
      stale: false,
    });
  });

  it("valuesForDisplay treats a non-finite proposed as unavailable even when not stale", () => {
    expect(valuesForDisplay(-80, undefined, false)).to.deep.equal({
      current: -80,
      proposed: null,
      delta: null,
      stale: false,
    });
  });

  it("explicitPairExists is true for a stored zero, false for absence", () => {
    const controllerWithZero = { getPairValues: () => [0, null] };
    const controllerWithNothing = { getPairValues: () => undefined };
    expect(explicitPairExists(controllerWithZero, "Adieresis", "W")).to.equal(true);
    expect(explicitPairExists(controllerWithNothing, "Adieresis", "W")).to.equal(
      false
    );
  });

  it("passesNumericFilters: column visibility never enters this predicate", () => {
    const f = { minDelta: 5, maxDelta: 20, hideZeroCurrentSuggestions: false };
    expect(
      passesNumericFilters({ current: -80, proposed: -60, delta: 20 }, f)
    ).to.equal(true);
    expect(
      passesNumericFilters({ current: -80, proposed: -100, delta: -20 }, f)
    ).to.equal(true);
    expect(
      passesNumericFilters({ current: -80, proposed: -84, delta: -4 }, f)
    ).to.equal(false);
    expect(
      passesNumericFilters({ current: -80, proposed: 0, delta: 80 }, {
        ...f,
        maxDelta: 20,
      })
    ).to.equal(false);
  });

  it("passesNumericFilters: exact hideZeroCurrentSuggestions predicate", () => {
    const f = { minDelta: 0, maxDelta: null, hideZeroCurrentSuggestions: true };
    expect(
      passesNumericFilters({ current: 0, proposed: 10, delta: 10 }, f)
    ).to.equal(false);
    expect(
      passesNumericFilters({ current: 0, proposed: 0, delta: 0 }, f)
    ).to.equal(true);
    expect(
      passesNumericFilters({ current: -5, proposed: 10, delta: 15 }, f)
    ).to.equal(true);
  });

  it("passesNumericFilters: F18 inclusive bounds -- min and max are both eligible at the boundary", () => {
    const f = { minDelta: 5, maxDelta: 20, hideZeroCurrentSuggestions: false };
    expect(passesNumericFilters({ current: 0, proposed: 5, delta: 5 }, f)).to.equal(
      true
    );
    expect(passesNumericFilters({ current: 0, proposed: -5, delta: -5 }, f)).to.equal(
      true
    );
    expect(passesNumericFilters({ current: 0, proposed: 20, delta: 20 }, f)).to.equal(
      true
    );
    expect(passesNumericFilters({ current: 0, proposed: 21, delta: 21 }, f)).to.equal(
      false
    );
    expect(
      passesNumericFilters({ current: 0, proposed: 4.9, delta: 4.9 }, f)
    ).to.equal(false);
  });

  it("passesNumericFilters: an unavailable delta always passes the numeric bounds", () => {
    const f = { minDelta: 50, maxDelta: 60, hideZeroCurrentSuggestions: false };
    expect(
      passesNumericFilters({ current: -80, proposed: null, delta: null }, f)
    ).to.equal(true);
  });

  // Task 12, spec F26/§12.3: loadAutokernCacheFromStorage's own async guard
  // (kerning.js) is exactly `isStaleAsyncResult(revisionAtStart,
  // this.autokernCacheLoadRevision, sourceIdentifierAtStart,
  // this.autokernSource)`, called after the await, before installing the
  // result.
  it("isStaleAsyncResult: a matching revision and source is not stale", () => {
    expect(isStaleAsyncResult(1, 1, "a", "a")).to.equal(false);
  });

  it("isStaleAsyncResult: a revision that has moved on (a newer call started) is stale", () => {
    expect(isStaleAsyncResult(1, 2, "a", "a")).to.equal(true);
  });

  it("isStaleAsyncResult: the same revision but the active source changed mid-flight is stale", () => {
    expect(isStaleAsyncResult(1, 1, "a", "b")).to.equal(true);
  });
});
