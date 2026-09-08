// Task 4 write-and-undo verification, per the dispatch constraint: use the
// same real-controller fixture pattern fontra-core's own
// tests/test-kerning-controller.js already uses, rather than a live
// browser. This proves the exact primitive kerning.js's resetSelectedPairRows
// and writePairValues call (KerningController.getEditContext(...).edit(...))
// writes an explicit 0 and is reversible via its own rollbackChange -- the
// real font-write path, not a mock of it.
import { applyChange } from "@fontra/core/changes.js";
import { FontSourcesInstancer } from "@fontra/core/font-sources-instancer.js";
import { KerningController } from "@fontra/core/kerning-controller.js";
import { deepCopyObject } from "@fontra/core/utils.ts";
import { expect } from "chai";
import { pressReset } from "../src/results-selection.js";
import { explicitPairExists, rowId } from "../src/results-model.js";

describe("Task 4: reset-selected write-and-undo, real KerningController", () => {
  // Mirrors the spec's own example (§7 F12 acceptance): a class rule plus a
  // member pair with an already-explicit value.
  const testFontController = {
    editIncremental: () => {},
    editFinal: () => {},
    fontAxesSourceSpace: [],
    sources: { a: { location: {} } },
  };
  testFontController.fontSourcesInstancer = new FontSourcesInstancer(
    testFontController.fontAxesSourceSpace,
    testFontController.sources
  );

  const testKerning = {
    kern: {
      groupsSide1: { A: ["Adieresis", "A"] },
      groupsSide2: { V: ["V", "W"] },
      sourceIdentifiers: ["a"],
      values: {
        "@A": { "@V": [-80] },
        "Adieresis": { "W": [-30] }, // pre-existing explicit exception
      },
    },
  };

  function freshController() {
    // Same wrapper shape fontra-core's own test-kerning-controller.js uses
    // (a `{kerning: {...}}` font stand-in): required because
    // KerningEditContext.editContinuous records changes against
    // `{kerning: this.kerningController.kerning}`, so a rollback/forward
    // change's path always starts with "kerning".
    const editedFont = { kerning: deepCopyObject(testKerning) };
    return {
      controller: new KerningController("kern", editedFont.kerning, testFontController),
      editedFont,
    };
  }

  it("explicitPairExists tells an existing pair rule apart from a class-only pair", () => {
    const { controller } = freshController();
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(true);
    // A/V has no literal entry at all -- only the class rule answers for it.
    expect(explicitPairExists(controller, "A", "V")).to.equal(false);
  });

  it("resetSelectedPairRows' write path: two presses on an unchanged ticked set writes 0, and it is undoable", async () => {
    const { controller, editedFont } = freshController();
    const beforeReset = deepCopyObject(editedFont);

    const sourceId = "a";
    const targetIds = [rowId(sourceId, "Adieresis", "W")];

    // First press only arms -- writePairValues-equivalent must not run yet.
    const firstPress = pressReset(null, targetIds);
    expect(firstPress.commit).to.equal(false);
    expect(editedFont).to.deep.equal(beforeReset); // nothing written

    // Second press, same target set -> commits.
    const secondPress = pressReset(firstPress.armedKey, targetIds);
    expect(secondPress.commit).to.equal(true);

    const pairSelectors = [{ sourceIdentifier: sourceId, leftName: "Adieresis", rightName: "W" }];
    const editContext = controller.getEditContext(pairSelectors);
    const changes = await editContext.edit([0], "kerning view: reset selected to 0");

    // Explicit zero is written, and it remains a real explicit pair (not
    // "removed" -- Reset writes 0, it does not restore inheritance).
    const instance = controller.instantiate({});
    expect(instance.getGlyphPairValue("Adieresis", "W")).to.equal(0);
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(true);
    // The class rule for other members (A x V) is untouched.
    expect(instance.getGlyphPairValue("A", "V")).to.equal(-80);

    // Undo: applying the rollback change restores the pre-reset value.
    const revertedFont = deepCopyObject(editedFont);
    applyChange(revertedFont, changes.rollbackChange);
    expect(revertedFont).to.deep.equal(beforeReset);
  });

  it("pressReset disarms if the ticked set changes before the second press, so a stale arm cannot commit against a different set", () => {
    const sourceId = "a";
    const original = [rowId(sourceId, "Adieresis", "W")];
    const changedSelection = [rowId(sourceId, "A", "V")];

    const armed = pressReset(null, original);
    expect(armed.commit).to.equal(false);

    const afterSelectionChanged = pressReset(armed.armedKey, changedSelection);
    expect(afterSelectionChanged.commit).to.equal(false); // re-arms instead, does not commit
  });
});
