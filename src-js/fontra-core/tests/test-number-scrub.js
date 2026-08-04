import {
  SCRUB_CANCELLED,
  SCRUB_COARSE_FACTOR,
  SCRUB_FINE_FACTOR,
  clampScrubValue,
  isScrubCancelled,
  roundScrubValue,
  scrubFactor,
  scrubIncrement,
} from "@fontra/core/number-scrub.js";
import { expect } from "chai";

describe("number scrub factor", () => {
  it("moves one step per pixel with no modifier held", () => {
    expect(scrubFactor({})).to.equal(1);
    expect(scrubFactor()).to.equal(1);
  });

  it("slows down on shift and speeds up on control", () => {
    expect(scrubFactor({ shiftKey: true })).to.equal(SCRUB_FINE_FACTOR);
    expect(scrubFactor({ ctrlKey: true })).to.equal(SCRUB_COARSE_FACTOR);
    expect(scrubFactor({ metaKey: true })).to.equal(SCRUB_COARSE_FACTOR);
  });

  it("takes the fine factor when both are held", () => {
    // Overshooting is the expensive mistake, so the tie goes to the slower one.
    expect(scrubFactor({ shiftKey: true, ctrlKey: true })).to.equal(SCRUB_FINE_FACTOR);
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
    expect(scrubIncrement(10, { step: 0.5, ctrlKey: true })).to.equal(50);
    expect(scrubIncrement(10, { step: 2, shiftKey: true })).to.be.closeTo(2, 1e-9);
  });

  it("treats a missing or zero step as one", () => {
    expect(scrubIncrement(7, { step: 0 })).to.equal(7);
    expect(scrubIncrement(7, {})).to.equal(7);
  });

  it("charges for each move separately, not for the whole travel", () => {
    // Reaching for a modifier halfway through has to change the rest of the
    // drag, not retroactively rescale what came before it — which is what
    // summing the total travel and multiplying once would do, and it makes the
    // value jump under the hand.
    let travel = 0;
    travel += scrubIncrement(10, {});
    travel += scrubIncrement(10, { ctrlKey: true });
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

  it("does not round, so the caller can fold the clamp back on its own", () => {
    expect(clampScrubValue(42.4, {})).to.equal(42.4);
    expect(clampScrubValue(42.4, { minValue: 0, maxValue: 100 })).to.equal(42.4);
  });
});

describe("number scrub rounding", () => {
  it("gives whole numbers unless a field asks otherwise", () => {
    // Font units. A fraction here only stores a number the outline never uses.
    expect(roundScrubValue(42.4)).to.equal(42);
    expect(roundScrubValue(42.6)).to.equal(43);
    expect(roundScrubValue(-42.6)).to.equal(-43);
    expect(roundScrubValue(42.4, { integer: false })).to.equal(42.4);
  });

  it("keeps a fine drag from vanishing", () => {
    // The caller carries the travel unrounded and rounds only on the way out, so
    // ten one-tenth moves add up to one. Rounding each move on its own would
    // floor every one of them to zero and the fine modifier would move nothing.
    let travel = 0;
    for (let i = 0; i < 10; i++) {
      travel += scrubIncrement(1, { shiftKey: true });
    }
    expect(roundScrubValue(travel)).to.equal(1);
  });

  it("does not let a fine drag stall against a clamp fold-back", () => {
    // The bug this split exists to prevent: clamping and rounding in one call
    // means the caller folds the ROUNDED value back into its travel, cancelling
    // each fine move before the next one can build on it.
    let travel = 0;
    const start = 40;
    for (let i = 0; i < 10; i++) {
      travel += scrubIncrement(1, { shiftKey: true });
      travel = clampScrubValue(start + travel, { minValue: 0 }) - start;
    }
    expect(roundScrubValue(start + travel)).to.equal(41);
  });
});

describe("cancelled scrub", () => {
  it("is a value the stream can carry and nothing else can be mistaken for", () => {
    expect(isScrubCancelled(SCRUB_CANCELLED)).to.equal(true);
    for (const value of [0, -1, 1e9, NaN, null, undefined, "cancel", {}]) {
      expect(isScrubCancelled(value), String(value)).to.equal(false);
    }
  });
});
