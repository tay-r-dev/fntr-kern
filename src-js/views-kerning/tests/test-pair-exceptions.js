// Task 10 (plan's own sequence, adapted to Mocha/Chai and this project's real
// fixture convention -- test-pairtable-writes.js's own `{kerning: {...}}`
// wrapper and FontSourcesInstancer stand-in, not a new format): verifies the
// exact controller-level mechanisms Task 10 binds to
// (docs/superpowers/kerning-ux-integration.md §5.1-§5.3):
//   - KerningController.getPairValues / getPairValueForSource for rule
//     provenance (explicit vs. inherited, including an explicit zero),
//   - KerningController.getEditContext(...).edit(...) to create/edit an
//     explicit pair,
//   - KerningEditContext.delete(undoLabel) to remove one (real deletion,
//     first caller anywhere in the app per the ledger),
//   - KerningController.getPairNames, the exact primitive
//     edit-tools-metrics.js's KerningTool already calls (getPairNamesFromSelector)
//     to decide what a preview drag edits -- read directly here to confirm
//     it already prefers an existing literal exception over the class
//     address, with no change needed in edit-tools-metrics.js itself.
import { applyChange } from "@fontra/core/changes.js";
import { FontSourcesInstancer } from "@fontra/core/font-sources-instancer.js";
import { KerningController } from "@fontra/core/kerning-controller.js";
import { deepCopyObject } from "@fontra/core/utils.ts";
import { expect } from "chai";
import { explicitPairExists } from "../src/results-model.js";

function makeTestFontController(sourceIdentifiers) {
  const sources = {};
  for (const id of sourceIdentifiers) {
    sources[id] = { location: {} };
  }
  const testFontController = {
    editIncremental: () => {},
    editFinal: () => {},
    fontAxesSourceSpace: [],
    sources,
  };
  testFontController.fontSourcesInstancer = new FontSourcesInstancer(
    testFontController.fontAxesSourceSpace,
    testFontController.sources
  );
  return testFontController;
}

describe("Task 10: pair-exception create/edit/remove/undo, real KerningController", () => {
  // Spec §7 F12's own acceptance example: @A x @V = -80, members
  // Adieresis/A and V/W, no pre-existing explicit pair.
  const testFontController = makeTestFontController(["a"]);
  const testKerning = {
    kern: {
      groupsSide1: { A: ["Adieresis", "A"] },
      groupsSide2: { V: ["V", "W"] },
      sourceIdentifiers: ["a"],
      values: {
        "@A": { "@V": [-80] },
      },
    },
  };

  function freshController() {
    const editedFont = { kerning: deepCopyObject(testKerning) };
    return {
      controller: new KerningController("kern", editedFont.kerning, testFontController),
      editedFont,
    };
  }

  // Reads go straight through the CONTROLLER (getGlyphPairValueForLocation),
  // the exact primitive kerning.js's pairRowData/wouldShadowClassCell already
  // use, deliberately NOT through a persisted KerningInstance -- a
  // KerningInstance keeps its own additional per-pair cache
  // (KerningInstance.valueCache) that would mask whether the CONTROLLER's own
  // cache (_pairFunctions) is invalidated correctly by each write, which is
  // exactly what this sequence is verifying.
  function current(controller, left, right) {
    return controller.getGlyphPairValueForLocation(left, right, {});
  }

  it("runs the plan's own read/create/edit/edit-class/remove/undo sequence", async () => {
    const { controller } = freshController();
    const sourceId = "a";

    // read Adieresis/W -> -80, explicitPairExists false
    expect(current(controller, "Adieresis", "W")).to.equal(-80);
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(false);

    // create explicit Adieresis/W = -80 -> explicitPairExists true
    let editContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: sourceId },
    ]);
    await editContext.edit([-80], "kerning view: create pair exception");
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(true);
    expect(current(controller, "Adieresis", "W")).to.equal(-80);

    // edit explicit pair to -30 -> pair is -30; A/W remains -80 (A/W is a
    // DIFFERENT literal address -- only the class rule answers for it).
    editContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: sourceId },
    ]);
    await editContext.edit([-30], "kerning view: edit pair exception");
    expect(current(controller, "Adieresis", "W")).to.equal(-30);
    expect(current(controller, "A", "W")).to.equal(-80);

    // edit class to -90 -> explicit pair remains -30
    editContext = controller.getEditContext([
      { leftName: "@A", rightName: "@V", sourceIdentifier: sourceId },
    ]);
    await editContext.edit([-90], "kerning view: edit class rule");
    expect(current(controller, "Adieresis", "W")).to.equal(-30);
    expect(current(controller, "A", "W")).to.equal(-90);

    // remove explicit pair -> pair is -90; explicitPairExists false
    const deleteContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: sourceId },
    ]);
    const deleteChanges = await deleteContext.delete(
      "kerning view: remove pair exception"
    );
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(false);
    expect(current(controller, "Adieresis", "W")).to.equal(-90);

    // undo removal -> explicit pair is -30. KerningEditContext.delete has
    // zero other callers in the app (ledger §5.2) -- this is the exact
    // {change, rollbackChange} shape kerning.js's createPairException/
    // removePairException push onto this.autokernUndoStack, replayed via
    // applyChange the same way writePairValues' own undo already is
    // (test-pairtable-writes.js's own pattern). delete()'s own changes are
    // recorded against `{kerning: controller.kerning}` (kerning-controller.js's
    // own delete()), so replaying against that exact live object, not a
    // detached copy, means the controller's next read sees it directly.
    applyChange({ kerning: controller.kerning }, deleteChanges.rollbackChange);
    controller.clearPairCache("Adieresis", "W");
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(true);
    expect(current(controller, "Adieresis", "W")).to.equal(-30);
  });

  it("an exception created at the explicit value 0 is still a real exception, not absence", async () => {
    const { controller } = freshController();
    const sourceId = "a";

    const editContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: sourceId },
    ]);
    await editContext.edit([0], "kerning view: create pair exception");

    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(true);
    expect(current(controller, "Adieresis", "W")).to.equal(0);

    const deleteContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: sourceId },
    ]);
    await deleteContext.delete("kerning view: remove pair exception");
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(false);
    expect(current(controller, "Adieresis", "W")).to.equal(-80); // back to the class rule
  });

  it("creating an exception at one source leaves another source's own value inherited (source-switch variant)", async () => {
    const twoSourceFontController = makeTestFontController(["a", "b"]);
    const twoSourceKerning = {
      kern: {
        groupsSide1: { A: ["Adieresis", "A"] },
        groupsSide2: { V: ["V", "W"] },
        sourceIdentifiers: ["a", "b"],
        values: {
          "@A": { "@V": [-80, -95] },
        },
      },
    };
    const editedFont = { kerning: deepCopyObject(twoSourceKerning) };
    const controller = new KerningController(
      "kern",
      editedFont.kerning,
      twoSourceFontController
    );

    const editContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: "a" },
    ]);
    await editContext.edit([-25], "kerning view: create pair exception");

    // explicitPairExists is source-independent -- the literal address now
    // has a values array at all.
    expect(explicitPairExists(controller, "Adieresis", "W")).to.equal(true);
    expect(controller.getGlyphPairValue("Adieresis", "W", {}, "a")).to.equal(-25);
    // Source "b" was never written -- its array slot is null (sparse), so
    // the cascade falls through to the class rule for that source instead
    // of reading a stray null as "no kerning at all".
    expect(controller.getGlyphPairValue("Adieresis", "W", {}, "b")).to.equal(-95);
  });

  it("KerningController.getPairNames already prefers an existing literal exception over the class address (edit-tools-metrics.js's own targeting primitive)", () => {
    const { controller } = freshController();
    const sourceId = "a";

    // No exception yet -- falls all the way through to the class/class
    // address, the pre-existing 'class-default' targeting.
    expect(controller.getPairNames("Adieresis", "W", sourceId)).to.deep.equal({
      leftName: "@A",
      rightName: "@V",
    });

    // Now create one at the literal address...
    const editContext = controller.getEditContext([
      { leftName: "Adieresis", rightName: "W", sourceIdentifier: sourceId },
    ]);
    return editContext.edit([-30], "kerning view: create pair exception").then(() => {
      // ...and the SAME lookup now resolves to the literal pair, not the
      // class address -- this is what a preview drag on this exact pair
      // will edit, unchanged code, already correct.
      expect(controller.getPairNames("Adieresis", "W", sourceId)).to.deep.equal({
        leftName: "Adieresis",
        rightName: "W",
      });
      // An unrelated pair sharing the same two classes is unaffected.
      expect(controller.getPairNames("A", "V", sourceId)).to.deep.equal({
        leftName: "@A",
        rightName: "@V",
      });
    });
  });
});
