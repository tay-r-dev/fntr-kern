import {
  SCRUB_COARSE_FACTOR,
  SCRUB_FINE_FACTOR,
  clampScrubValue,
  scrubFactor,
  scrubIncrement,
} from "@fontra/core/number-scrub.js";
import { expect } from "chai";

describe("number scrub factor", () => {
  it("moves one step per pixel with no modifier held", () => {
    expect(scrubFactor({})).to.equal(1);
    expect(scrubFactor()).to.equal(1);
  });

  it("speeds up on shift and slows down on control", () => {
    expect(scrubFactor({ shiftKey: true })).to.equal(SCRUB_COARSE_FACTOR);
    expect(scrubFactor({ ctrlKey: true })).to.equal(SCRUB_FINE_FACTOR);
    expect(scrubFactor({ metaKey: true })).to.equal(SCRUB_FINE_FACTOR);
  });

  it("takes the coarse factor when both are held", () => {
    // Shift means "more" on the arrow keys too, so a hand holding both gets the
    // same answer here as it does there rather than an arbitrary one.
    expect(scrubFactor({ shiftKey: true, ctrlKey: true })).to.equal(
      SCRUB_COARSE_FACTOR
    );
  });
});

describe("number scrub increment", () => {
  it("is linear in the distance moved", () => {
    // Deliberately not accelerated: the same hand movement has to mean the same
    // change every time, or nothing about the control can be learned.
    expect(scrubIncrement(10)).to.equal(10);
    expect(scrubIncrement(20)).to.equal(20);
    expect(scrubIncrement(-10)).to.equal(-10);
  });

  it("scales by the field's own step", () => {
    expect(scrubIncrement(10, { step: 0.5 })).to.equal(5);
    expect(scrubIncrement(10, { step: 5 })).to.equal(50);
  });

  it("combines the step and the modifier", () => {
    expect(scrubIncrement(10, { step: 0.5, shiftKey: true })).to.equal(50);
    expect(scrubIncrement(10, { step: 2, ctrlKey: true })).to.be.closeTo(2, 1e-9);
  });

  it("treats a missing or zero step as one", () => {
    expect(scrubIncrement(7, { step: 0 })).to.equal(7);
    expect(scrubIncrement(7, {})).to.equal(7);
  });

  it("charges for each move separately, not for the whole travel", () => {
    // Pressing shift halfway through has to speed up the rest of the drag, not
    // retroactively rescale what came before it — which is what summing the
    // total travel and multiplying once would do, and it makes the value jump
    // under the hand.
    let travel = 0;
    travel += scrubIncrement(10, {});
    travel += scrubIncrement(10, { shiftKey: true });
    expect(travel).to.equal(110);
  });
});

describe("number scrub clamping", () => {
  it("passes a value through when the field has no bounds", () => {
    expect(clampScrubValue(42.5, {})).to.equal(42.5);
    expect(clampScrubValue(42.5)).to.equal(42.5);
  });

  it("holds the field's minimum and maximum", () => {
    expect(clampScrubValue(-5, { minValue: 0 })).to.equal(0);
    expect(clampScrubValue(500, { maxValue: 300 })).to.equal(300);
    expect(clampScrubValue(150, { minValue: 0, maxValue: 300 })).to.equal(150);
  });

  it("rounds a whole-number field", () => {
    expect(clampScrubValue(42.4, { integer: true })).to.equal(42);
    expect(clampScrubValue(42.6, { integer: true })).to.equal(43);
  });

  it("keeps a fine drag on a whole-number field from vanishing", () => {
    // The caller carries the travel unrounded and rounds only for display, so
    // ten one-tenth moves add up to one. Rounding each move to zero instead
    // would make the fine modifier do nothing at all.
    let travel = 0;
    for (let i = 0; i < 10; i++) {
      travel += scrubIncrement(1, { ctrlKey: true });
    }
    expect(clampScrubValue(travel, { integer: true })).to.equal(1);
  });
});
