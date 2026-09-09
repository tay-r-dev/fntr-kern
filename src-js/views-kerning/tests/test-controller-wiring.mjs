import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as inputTokens from "../src/input-tokens.js";
import { retainVisible } from "../src/results-selection.js";
import { layoutPairPreview, normalizePairsPerRow } from "../src/pair-preview-layout.js";

// Evaluate the actual controller class without importing browser-only modules.
// No copied method implementations: deleting a method from kerning.js must fail.
const source = readFileSync(
  process.env.KERNING_CONTROLLER_SOURCE ||
    new URL("../src/kerning.js", import.meta.url),
  "utf8"
);
const classSource = source
  .slice(
    source.indexOf("export class KerningViewController"),
    source.indexOf("const GLYPH_LIST_TRUNCATE_AT")
  )
  .replace("export class", "class")
  .replaceAll("import.meta.url", JSON.stringify(import.meta.url));
const tbody = {
  textContent: "",
  children: [],
  appendChild(row) {
    this.children.push(row);
  },
};
const frames = [];
const Controller = vm.runInNewContext(`${classSource}\nKerningViewController;`, {
  ViewController: class {},
  ...inputTokens,
  retainVisible,
  rowId: (source, left, right) => JSON.stringify([source, left, right]),
  AUTOKERN_PREVIEW_EXCLUDED_CUSTOM_DATA_KEY: "fontra.autokernPreviewExcluded",
  pairKey: (left, right) => `${left}/${right}`,
  layoutPairPreview,
  normalizePairsPerRow,
  requestAnimationFrame: (callback) => {
    frames.push(callback);
    return frames.length;
  },
  document: {
    querySelector: (selector) =>
      selector === "#kerning-pairtable-body" ? tbody : null,
    querySelectorAll: () => [],
    // Enough of an element for the row-action builders: they set properties,
    // set attributes and append children, and nothing here renders.
    createElement: (tagName) => ({
      tagName,
      attributes: {},
      children: [],
      style: {},
      classList: { toggle() {} },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      appendChild(child) {
        this.children.push(child);
      },
    }),
  },
});

test("table and preview callbacks remain methods of the actual controller", () => {
  for (const name of [
    "renderPairTable",
    "handlePreviewPairModifierClick",
    "previewFilterPairs",
    "pairMatchesInputScope",
    "pairMatchesTypes",
    "isLeftClassed",
    "isRightClassed",
    "bucketForPair",
    "wouldShadowClassCell",
    "describeShadowedClassCell",
    "overrideDivergence",
    "isOverrideCandidate",
    "updateNonUnicodeNote",
  ]) {
    assert.equal(typeof Controller.prototype[name], "function", name);
  }
});

test("Shift-click rerenders through the restored table renderer and toggles he/el", () => {
  const view = Object.create(Controller.prototype);
  let previews = 0;
  Object.assign(view, {
    _chipMode: "phrase",
    _previewPairSelections: new Map(),
    _previewPairsChip: {},
    autokernCache: new Map(),
    kerningController: {
      kernData: {},
      leftPairGroupMapping: {},
      rightPairGroupMapping: {},
    },
    fontController: { glyphMap: { h: [104], e: [101], l: [108] }, characterMap: {} },
    autokernFiltersController: {
      model: {
        glyphName: "h, e, l",
        side: "both",
        unicodeTypes: ["lowercase"],
        relationships: ["unique-unique"],
      },
    },
    autokernParamsController: { model: { threshold: 0, groupThreshold: 0 } },
    resultSelection: { selected: new Set() },
    sceneModel: {
      positionedLines: [{ glyphs: [..."hello"].map((glyphName) => ({ glyphName })) }],
    },
    canvasController: { requestUpdate() {} },
    renderAutokernStatus() {},
    renderStaleSection() {},
    renderAnalyticsSection() {},
    activeSourceIdentifier: () => "source",
    syncSelectAllCheckboxes() {},
    refreshResetArmState() {},
    updatePairPreview: () => {
      previews++;
    },
  });
  const hit = { lineIndex: 0, glyphIndex: 1 };
  view.handlePreviewPairModifierClick(hit);
  assert.equal(JSON.stringify(view.previewFilterPairs()), '[["h","e"],["e","l"]]');
  assert.equal(view.pairMatchesInputScope("h", "e"), true);
  assert.equal(view.pairMatchesInputScope("e", "h"), false);
  assert.equal(view.pairMatchesInputScope("l", "l"), false);
  assert.equal(view._previewPairsChip.hidden, false);
  view.handlePreviewPairModifierClick(hit);
  assert.equal(view.previewFilterPairs().length, 0);
  assert.equal(view._previewPairsChip.hidden, true);
  assert.equal(view.pairMatchesInputScope("e", "h"), true);
  assert.equal(previews, 2);
});

test("progressive table load creates 100 rows per request, preserving existing rows", () => {
  tbody.children = [];
  const view = Object.create(Controller.prototype);
  let built = 0;
  Object.assign(view, {
    _pairTableItems: Array.from({ length: 235 }, (_, id) => ({
      renderKind: id % 2 ? "pair" : "class-rule",
      row: { id },
      group: { id },
    })),
    _pairTableLoadedCount: 0,
    _pairTableLoadMore: {},
    _pairTableLoadStatus: {},
    buildPairRowElement: (row) => {
      built++;
      return { id: row.id };
    },
    buildClassSummaryRowElement: (group) => {
      built++;
      return { id: group.id };
    },
    syncSelectAllCheckboxes() {},
  });
  view.loadNextPairTableBatch();
  assert.equal(built, 100);
  assert.equal(tbody.children.length, 100);
  assert.equal(view._pairTableLoadStatus.textContent, "Showing 100 of 235 rows");
  const first = tbody.children[0];
  view.loadNextPairTableBatch();
  assert.equal(built, 200);
  assert.equal(tbody.children[0], first);
  view.loadNextPairTableBatch();
  assert.equal(built, 235);
  assert.equal(view._pairTableLoadMore.hidden, true);
  view.loadNextPairTableBatch();
  assert.equal(built, 235);
  assert.equal(new Set(tbody.children.map((row) => row.id)).size, 235);
});

test("highlighted individual rows cannot produce more than 100 canvas pairs", () => {
  const view = Object.create(Controller.prototype);
  view._pairTableItems = Array.from({ length: 1000 }, (_, i) => ({
    sortId: String(i),
    renderKind: "pair",
    left: "h",
    right: String(i),
  }));
  view.resultSelection = {
    selected: new Set(view._pairTableItems.map((r) => r.sortId)),
  };
  assert.equal(view.expandHighlightedRowsToPairs().length, 100);
  assert.ok(view._classSummaryTruncationCount);
});

test("live table refresh coalesces edits and reads the updated value on the next frame", () => {
  frames.length = 0;
  const view = Object.create(Controller.prototype);
  let current = 0;
  const displayed = [];
  view.renderPairTable = () => displayed.push(current);
  view.schedulePairTableRefresh();
  current = -40;
  view.schedulePairTableRefresh();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(displayed, [-40]);
  current = 0;
  view.schedulePairTableRefresh();
  frames.shift()();
  assert.deepEqual(displayed, [-40, 0]);
});

function makePairScene(count, kern = -40) {
  return {
    positionedLines: Array.from({ length: count }, (_, index) => {
      const y = -index * 1100;
      return {
        origin: { x: 0, y },
        endPoint: { x: 1200 + kern, y },
        bounds: { xMin: 0, xMax: 1200 + kern, yMin: y - 200, yMax: y + 800 },
        glyphs: [0, 1].map((glyphIndex) => {
          const x = glyphIndex ? 600 + kern : 0;
          return {
            x,
            y,
            glyph: { xAdvance: 600 },
            bounds: { xMin: x, xMax: x + 600, yMin: y - 200, yMax: y + 800 },
          };
        }),
      };
    }),
  };
}

test("pair preview lays out six across then down, moving hit bounds with glyphs", () => {
  const scene = layoutPairPreview(makePairScene(8), undefined, 1000);
  assert.deepEqual(scene.positionedLines[5].origin, { x: 8500, y: 0 });
  assert.deepEqual(scene.positionedLines[6].origin, { x: 0, y: -1100 });
  assert.equal(scene.positionedLines[6].glyphs[0].bounds.yMin, -1300);
  assert.equal(scene.positionedLines[5].glyphs[0].bounds.xMin, 8500);
  assert.equal(scene.longestLineLength, 9660);
  assert.equal(scene.positionedLines[6].glyphs.length, 2);
});

test("pair columns are configurable and kerning edits do not move other cells", () => {
  const before = layoutPairPreview(makePairScene(8, -40), 3, 1000);
  const after = layoutPairPreview(makePairScene(8, 80), 3, 1000);
  assert.deepEqual(
    before.positionedLines.map((line) => line.origin),
    after.positionedLines.map((line) => line.origin)
  );
  assert.deepEqual(after.positionedLines[3].origin, { x: 0, y: -1100 });
  for (const bad of [0, -1, 1.5, "", "bad", 101])
    assert.equal(normalizePairsPerRow(bad), 6);
  assert.equal(normalizePairsPerRow("8"), 8);
});

test("a growing result set fills the requested batch instead of retaining one row", () => {
  const view = Object.create(Controller.prototype);
  Object.assign(view, {
    _pairTableQueryKey: "same",
    _pairTableLoadedCount: 1,
    _pairTableLoadLimit: 100,
    _pairTableItems: Array.from({ length: 4 }, (_, id) => ({
      renderKind: "pair",
      row: { id },
    })),
    buildPairRowElement: (row) => row,
    syncSelectAllCheckboxes() {},
  });
  const limit = view.getPairTableLoadLimit("same");
  assert.equal(limit, 100);
  tbody.children = [];
  view._pairTableLoadedCount = 0;
  view.appendPairTableRows(limit);
  assert.equal(tbody.children.length, 4);
  view._pairTableLoadLimit = 300;
  assert.equal(view.getPairTableLoadLimit("same"), 300);
  assert.equal(view.getPairTableLoadLimit("different"), 100);
});

test("manual kerning starts from the preview and the ribbon shows the remaining suggestion", async () => {
  const view = Object.create(Controller.prototype);
  let saved = 0;
  const proposal = { value: -40 };
  const unrelated = { value: -80 };
  const live = [];
  const tool = {
    selectedHandles: [{ selector: {} }],
    getGlyphNamesFromSelector: () => ({ leftGlyph: "r", rightGlyph: "o" }),
    getSourceIdentifier: () => "s1",
    getEditContext: () => ({
      values: [saved],
      editContext: {
        async editContinuous(values) {
          assert.equal(view.sceneController.autoViewBox, false);
          for await (const step of values) {
            saved = step.values[0];
            live.push(view.getSuggestionPreviewValue("r", "o", proposal));
          }
        },
        edit(values) {
          return this.editContinuous([{ values }]);
        },
        delete() {
          saved = 0;
        },
      },
    }),
  };
  Object.assign(view, {
    tools: { "kerning-tool": tool },
    _chipMode: "phrase",
    suggestionPreviewSettings: { model: { enabled: true } },
    _autokernSourceIdentifier: "s1",
    autokernCache: new Map([
      ["r/o", proposal],
      ["o/r", unrelated],
    ]),
    kerningController: { getGlyphPairValueForSource: () => saved },
    // Excluding a pair from the preview is written to the project, the same
    // way a junk mark is.
    fontController: { customData: {}, async performEdit(name, key, mutate) {} },
    sceneController: { autoViewBox: true },
    canvasController: { requestUpdate() {} },
  });
  view.installManualKerningPreviewBehavior();
  const first = tool.getEditContext();
  assert.equal(first.values[0], -40);
  assert.equal(saved, 0); // Selecting a handle does not write the proposal.
  await first.editContext.editContinuous([
    { values: [first.values[0] + 10] },
    { values: [first.values[0] + 20] },
  ]);
  assert.deepEqual(live, [-30, -20]);
  assert.equal(view.getSuggestionPreviewValue("o", "r", unrelated), -80);
  assert.equal(view.getSuggestionPreviewValue("r", "o", proposal, "s2"), -40);
  const second = tool.getEditContext();
  assert.equal(second.values[0], -20);
  await second.editContext.edit([second.values[0] + 10]);
  assert.equal(saved, -10);
  assert.equal(view.getSuggestionPreviewValue("r", "o", proposal), -10);
  // With an already shaped saved value, preview must not add kerning twice.
  const glyphs = [
    { glyphName: "r", x: 0, kernValue: 0 },
    { glyphName: "o", x: 590, kernValue: saved },
  ];
  view._previewOriginalX = new WeakMap();
  view._previewPairValue = new WeakMap();
  view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
  assert.equal(glyphs[1].x, 590);
  assert.equal(view._previewPairValue.get(glyphs[1]), -30);
  // Positive proposal with negative manual kerning: 12 - (-4) = 16.
  proposal.value = 12;
  saved = -4;
  glyphs[1].kernValue = saved;
  view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
  assert.equal(view._previewPairValue.get(glyphs[1]), 16);
  assert.equal(glyphs[1].x, 590);
  saved = 12;
  glyphs[1].kernValue = saved;
  view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
  assert.equal(view._previewPairValue.get(glyphs[1]), 0);
  saved = 0; // Undo follows the font value instead of a frozen manual number.
  assert.equal(view.getSuggestionPreviewValue("r", "o", proposal), 0);
  // A fresh measurement used to win the preview back. It no longer does: the
  // manual edit above put this pair out of the preview, and only the table's
  // own mark puts it back. Another pair, and the same pair in another source,
  // are untouched.
  assert.equal(view.getSuggestionPreviewValue("r", "o", { value: -35 }), undefined);
  assert.equal(view.getSuggestionPreviewValue("o", "r", unrelated), -80);
  assert.equal(view.getSuggestionPreviewValue("r", "o", { value: -35 }, "s2"), -35);
  await view.setPairExcludedFromPreview("r", "o", false, "s1");
  assert.equal(view.getSuggestionPreviewValue("r", "o", { value: -35 }), -35);
  view.suggestionPreviewSettings.model.enabled = false;
  assert.equal(tool.getEditContext().values[0], 0);
});

test("undo reaches this view's own stack when the active tool has nothing to undo", () => {
  const view = Object.create(Controller.prototype);
  const called = [];
  Object.assign(view, {
    selectedToolIdentifier: "kerning-tool",
    tools: {
      "kerning-tool": {
        canUndoRedo: (isRedo) => toolHasRecord,
        doUndoRedo: (isRedo) => called.push(["tool", isRedo]),
      },
    },
    doUndoRedo: (isRedo) => called.push(["view", isRedo]),
  });
  let toolHasRecord = false;
  // A metrics tool is the normal state of this view. With an empty stack of
  // its own it used to win anyway, so a pair-table edit was never reached.
  view.callDelegateMethod("doUndoRedo", false);
  toolHasRecord = true;
  view.callDelegateMethod("doUndoRedo", false);
  assert.deepEqual(called, [
    ["view", false],
    ["tool", false],
  ]);
});

test("leaving a pair out of the preview is one undo step", async () => {
  const view = Object.create(Controller.prototype);
  const pushed = [];
  let customData = {};
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    _previewExcludedPairs: new Set(),
    fontController: {
      get customData() {
        return customData;
      },
      async performEdit(label, key, mutate) {
        const before = JSON.parse(JSON.stringify(customData));
        mutate({ customData });
        return { hasChange: true, change: { customData }, rollbackChange: before };
      },
    },
    autokernUndoStack: { pushUndoRecord: (record) => pushed.push(record) },
  });
  await view.setPairExcludedFromPreview("r", "o", true);
  assert.equal(view.isPairExcludedFromPreview("r", "o"), true);
  // Another source is a separate statement about the same pair.
  assert.equal(view.isPairExcludedFromPreview("r", "o", "s2"), false);
  // Compared as text: the controller is evaluated in its own realm, so its
  // objects are never reference-equal to this file's.
  assert.equal(
    JSON.stringify(customData["fontra.autokernPreviewExcluded"]),
    JSON.stringify([{ source: "s1", left: "r", right: "o" }])
  );
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].info.kind, "pairValues");

  await view.setPairExcludedFromPreview("r", "o", false);
  assert.equal(view.isPairExcludedFromPreview("r", "o"), false);
  assert.equal(customData["fontra.autokernPreviewExcluded"], undefined);
  assert.equal(pushed.length, 2);

  // Setting it to what it already is writes nothing and pushes nothing.
  await view.setPairExcludedFromPreview("r", "o", false);
  assert.equal(pushed.length, 2);
});

test("every pair row carries a check that writes its own proposal", async () => {
  const view = Object.create(Controller.prototype);
  const written = [];
  Object.assign(view, {
    resultSelection: { selected: new Set() },
    activeSourceIdentifier: () => "s1",
    async writePairValues(pairs, valueFn, markApplied, confirmShadow) {
      written.push({
        pairs: pairs.map(({ left, right }) => ({ left, right })),
        value: valueFn({ value: -42 }),
        markApplied,
        confirmShadow,
      });
    },
  });

  const button = view.buildApplyProposalButton({
    left: "A",
    right: "V",
    suggestion: -42.4,
  });
  assert.equal(button.src, "/tabler-icons/check.svg");
  assert.equal(button.disabled, undefined);
  button.onclick({ stopPropagation() {} });
  assert.equal(written.length, 1);
  assert.equal(written[0].value, -42);
  assert.equal(written[0].markApplied, true);
  // The same shadow warning the batch action gives, for the same reason.
  assert.equal(written[0].confirmShadow, true);
  assert.equal(
    JSON.stringify(written[0].pairs),
    JSON.stringify([{ left: "A", right: "V" }])
  );

  // A stale proposal is the one number the table knows is wrong.
  const stale = view.buildApplyProposalButton({
    left: "A",
    right: "V",
    suggestion: -42,
    stale: true,
  });
  assert.equal(stale.disabled, true);
  assert.equal(stale.onclick, undefined);
});

test("a row's icon acts on every selected row, and alone when the row is not selected", () => {
  const view = Object.create(Controller.prototype);
  const rowAV = { left: "A", right: "V", suggestion: -40 };
  const rowAW = { left: "A", right: "W", suggestion: -30 };
  const rowTo = { left: "T", right: "o", suggestion: -50 };
  const idOf = (row) => JSON.stringify(["s1", row.left, row.right]);
  Object.assign(view, {
    activeSourceIdentifier: () => "s1",
    _pairRowByRowId: new Map([
      [idOf(rowAV), rowAV],
      [idOf(rowAW), rowAW],
      [idOf(rowTo), rowTo],
    ]),
    resultSelection: { selected: new Set([idOf(rowAV), idOf(rowAW)]) },
  });

  // Compared as text: the arrays come back from the vm realm, where
  // deepStrictEqual refuses to match a plain array of this realm.
  const rights = (row) =>
    JSON.stringify(view.rowActionTargets(row).map((target) => target.right));
  // Pressed on a selected row: the whole selection.
  assert.equal(rights(rowAV), JSON.stringify(["V", "W"]));
  // Pressed outside the selection: that row alone.
  assert.equal(rights(rowTo), JSON.stringify(["o"]));
  // One selected row is still one row.
  view.resultSelection = { selected: new Set([idOf(rowAV)]) };
  assert.equal(rights(rowAV), JSON.stringify(["V"]));
});
