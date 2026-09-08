// Task 12 (docs/superpowers/kerning-ux-integration.md §5.4, spec F26/§12.3):
// verifies the exact controller-level mechanism kerning.js's pairRowData,
// overrideDivergence, confirmShadowingWrite, inheritedFallbackValue,
// writePairValues, applyFoldedParentRow, and createPairException now all
// share -- KerningController.getGlyphPairValueForSource(left, right,
// sourceIdentifier) for reads and a literal `sourceIdentifier` (never
// getSourceIdentifierForLocation({}, false)) for writes. Before this fix,
// every one of those call sites resolved through an empty-location lookup
// that always answered the font's DEFAULT source regardless of which
// source was selected; this test reproduces the exact "write A, switch to
// B, write B, switch back to A" scenario the ledger names and confirms A's
// own value survived, not the default source's.
import { KerningController } from "@fontra/core/kerning-controller.js";
import { deepCopyObject } from "@fontra/core/utils.ts";
import { expect } from "chai";

function makeTestFontController(sourceIdentifiers) {
  const sources = {};
  for (const id of sourceIdentifiers) {
    sources[id] = { location: {} };
  }
  return {
    editIncremental: () => {},
    editFinal: () => {},
    fontAxesSourceSpace: [],
    sources,
  };
}

describe("Task 12: reads and writes address the active source, not the font's default source", () => {
  // Two real sources -- "a" happens to be the font's declared default, "b"
  // is a second, non-default source. The regression this test guards
  // against only shows up with a NON-default active source: writing while
  // "a" (default) is selected always happened to look correct before the
  // fix too, because the old {}-location resolution always landed on "a"
  // regardless of what was picked.
  const sourceIdentifiers = ["a", "b"];
  const testFontController = makeTestFontController(sourceIdentifiers);
  testFontController.defaultSourceIdentifier = "a";

  const testKerning = {
    kern: {
      groupsSide1: {},
      groupsSide2: {},
      sourceIdentifiers,
      values: {},
    },
  };

  function freshController() {
    const editedFont = { kerning: deepCopyObject(testKerning) };
    return new KerningController("kern", editedFont.kerning, testFontController);
  }

  // Mirrors pairRowData's own read exactly (kerning.js), addressed by
  // source identifier rather than by design-space location.
  function currentAt(controller, left, right, sourceIdentifier) {
    return controller.getGlyphPairValueForSource(left, right, sourceIdentifier) ?? 0;
  }

  // Mirrors writePairValues/applyFoldedParentRow/createPairException's own
  // write exactly: a literal sourceIdentifier in the pairSelector, never a
  // location resolved through fontSourcesInstancer.
  async function writeAt(controller, left, right, sourceIdentifier, value) {
    const editContext = controller.getEditContext([
      { leftName: left, rightName: right, sourceIdentifier },
    ]);
    return await editContext.edit([value], "kerning view: pair table write");
  }

  it("a write while source B is active never lands on source A, and switching back shows A's own value", async () => {
    const controller = freshController();

    // Write while "a" is the active source.
    await writeAt(controller, "A", "V", "a", -80);
    expect(currentAt(controller, "A", "V", "a")).to.equal(-80);
    // "b" was never written -- still nothing there.
    expect(currentAt(controller, "A", "V", "b")).to.equal(0);

    // Now the designer switches the status-strip source selector to "b"
    // and writes a DIFFERENT value.
    await writeAt(controller, "A", "V", "b", -25);
    expect(currentAt(controller, "A", "V", "b")).to.equal(-25);

    // Switching back to "a": its own value must be exactly what was
    // written to "a", untouched by "b"'s write -- this is the exact
    // regression the ledger names ("Apply/Reset always write the default
    // source, no matter which source was selected"). Before the Task 12
    // fix, BOTH writes above would really have landed on whichever source
    // resolves at the empty location (the font's default, "a" here) --
    // this assertion is what would catch that: "b"'s read would come back
    // -25 too if the bug still existed, because the second write would
    // have silently overwritten "a" a second time.
    expect(currentAt(controller, "A", "V", "a")).to.equal(-80);
  });

  it("a class-summary (applyFoldedParentRow-shaped) write also targets the literal active source", async () => {
    const controller = freshController();

    await writeAt(controller, "@A", "@V", "a", -80);
    await writeAt(controller, "@A", "@V", "b", -95);

    expect(currentAt(controller, "@A", "@V", "a")).to.equal(-80);
    expect(currentAt(controller, "@A", "@V", "b")).to.equal(-95);
  });
});
