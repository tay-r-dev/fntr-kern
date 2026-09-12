import assert from "node:assert/strict";
import { aggregateStale, countMedianContributors } from "../src/results-model.js";
import { medianDroppingOutliers, medianOfValues } from "@fontra/core/autokern-cache.js";
import { classSpread } from "@fontra/core/autokern-classes.js";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as inputTokens from "../src/input-tokens.js";
import { retainVisible, selectRange, selectRow } from "../src/results-selection.js";
import { layoutPairPreview, normalizePairsPerRow } from "../src/pair-preview-layout.js";
import {
  explicitPairExists,
  hiddenFromCacheEntry,
  passesNumericFilters,
  pairMatchesGlyphset,
  rowMatchesRelationships,
  rowVisibleForHiddenState,
  valuesForDisplay,
} from "../src/results-model.js";

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
  _textContent: "",
  children: [],
  // Ticket 20: renderPairTableWindow sets textContent = "" to clear the
  // body before every rebuild, the same way the real DOM does (assigning
  // textContent removes every child node) -- mirror that here so this fake
  // tbody behaves the way the real one does.
  get textContent() {
    return this._textContent;
  },
  set textContent(value) {
    this._textContent = value;
    if (value === "") {
      this.children = [];
    }
  },
  appendChild(row) {
    this.children.push(row);
  },
};
const frames = [];
const Controller = vm.runInNewContext(`${classSource}\nKerningViewController;`, {
  ViewController: class {},
  ...inputTokens,
  retainVisible,
  aggregateStale,
  classSpread,
  countMedianContributors,
  medianDroppingOutliers,
  medianOfValues,
  explicitPairExists,
  hiddenFromCacheEntry,
  selectRange,
  selectRow,
  passesNumericFilters,
  pairMatchesGlyphset,
  rowMatchesRelationships,
  rowVisibleForHiddenState,
  valuesForDisplay,
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
    _previewPairsChipLabel: {},
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
  // The selection ends only when the designer ends it: the chip's cross or
  // Escape, both of which call this one method. Nothing else clears it, so
  // leaving pair mode -- which sets the scene text -- keeps it.
  view.handlePreviewPairModifierClick(hit);
  assert.equal(view._previewPairSelections.size, 1);
  view.clearPreviewPairSelection();
  assert.equal(view._previewPairSelections.size, 0);
});

test("ticket 20: the window renders at most 100 rows and rebuilds fresh from the item list on every shift", () => {
  tbody.children = [];
  const view = Object.create(Controller.prototype);
  let built = 0;
  Object.assign(view, {
    _pairTableItems: Array.from({ length: 235 }, (_, id) => ({
      renderKind: id % 2 ? "pair" : "class-rule",
      row: { id },
      group: { id },
    })),
    _pairTableWindowStart: 0,
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

  view.renderPairTableWindow();
  assert.equal(built, 100);
  assert.equal(tbody.children.length, 100);
  assert.equal(tbody.children[0].id, 0);
  assert.equal(tbody.children[99].id, 99);
  // Ticket 21: the count line covers every admitted row, not the window.
  assert.equal(view._pairTableLoadStatus.textContent, "Showing 235 of 235 rows");

  built = 0;
  view.shiftPairTableWindow(25);
  assert.equal(view._pairTableWindowStart, 25);
  assert.equal(tbody.children.length, 100);
  assert.equal(tbody.children[0].id, 25);
  assert.equal(tbody.children[99].id, 124);
  // A full rebuild, never a patch: every one of the 100 rows was built again,
  // even the 75 that were already on screen.
  assert.equal(built, 100);

  // A huge forward shift clamps so the window never runs past the end.
  view.shiftPairTableWindow(1000);
  assert.equal(view._pairTableWindowStart, 135);
  assert.equal(tbody.children[99].id, 234);

  // And a huge backward shift clamps at the top.
  view.shiftPairTableWindow(-1000);
  assert.equal(view._pairTableWindowStart, 0);
  assert.equal(tbody.children[0].id, 0);
});

test("ticket 20: the window start clamps to the item list, never running past it", () => {
  const view = Object.create(Controller.prototype);
  view._pairTableItems = Array.from({ length: 4 }, (_, id) => ({ id }));
  assert.equal(view.clampPairTableWindowStart(0), 0);
  assert.equal(view.clampPairTableWindowStart(50), 0);
  view._pairTableItems = Array.from({ length: 150 }, (_, id) => ({ id }));
  assert.equal(view.clampPairTableWindowStart(200), 50);
  assert.equal(view.clampPairTableWindowStart(-5), 0);
});

test("ticket 21: select-all covers every admitted row, in and out of the window", () => {
  tbody.children = [];
  const view = Object.create(Controller.prototype);
  Object.assign(view, {
    _pairTableItems: Array.from({ length: 300 }, (_, i) => ({ sortId: String(i) })),
    _pairTableWindowStart: 0,
    resultSelection: { selected: new Set() },
  });
  const ids = view.admittedPairTableRowIds();
  assert.equal(ids.length, 300);

  view.resultSelection = { selected: new Set(ids) };
  assert.equal(view.resultSelection.selected.size, 300);

  // Rendering the window still only puts 100 rows in the document.
  Object.assign(view, {
    _pairTableLoadStatus: {},
    buildPairRowElement: (row) => ({ id: row.id }),
    buildClassSummaryRowElement: (group) => ({ id: group.id }),
    syncSelectAllCheckboxes() {},
  });
  view._pairTableItems = view._pairTableItems.map((item, i) => ({
    ...item,
    renderKind: "pair",
    row: { id: i },
  }));
  view.renderPairTableWindow();
  assert.equal(tbody.children.length, 100);
  assert.equal(view.resultSelection.selected.size, 300);
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

test("ticket 20: a result set smaller than one window renders every row", () => {
  tbody.children = [];
  const view = Object.create(Controller.prototype);
  Object.assign(view, {
    _pairTableWindowStart: 0,
    _pairTableLoadStatus: {},
    _pairTableItems: Array.from({ length: 4 }, (_, id) => ({
      renderKind: "pair",
      row: { id },
    })),
    buildPairRowElement: (row) => row,
    syncSelectAllCheckboxes() {},
  });
  view.renderPairTableWindow();
  assert.equal(tbody.children.length, 4);
  assert.equal(view._pairTableLoadStatus.textContent, "Showing 4 of 4 rows");
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
    kerningController: {
      getGlyphPairValueForSource: () => saved,
      getPairValues: () => undefined,
      leftPairGroupMapping: {},
      rightPairGroupMapping: {},
    },
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
  // The drags above are finished, and kerning by hand put this pair out of
  // the preview, so nothing is drawn over the designer's own answer.
  assert.equal(view._previewPairValue.get(glyphs[1]), undefined);
  // While a drag is live the ribbon measures what is left of the proposal.
  view._liveManualPreviewPairs.add(JSON.stringify(["s1", "r", "o"]));
  view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
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
  view._liveManualPreviewPairs.clear();
  saved = 0; // Undo follows the font value instead of a frozen manual number.
  assert.equal(view.getSuggestionPreviewValue("r", "o", proposal), 0);
  // A fresh measurement used to win the preview back. It no longer does: the
  // manual edit above put this pair out of the preview, and only the table's
  // own mark puts it back. Another pair, and the same pair in another source,
  // are untouched.
  assert.equal(view.getSuggestionPreviewValue("r", "o", { value: -35 }), undefined);
  assert.equal(view.getSuggestionPreviewValue("o", "r", unrelated), -80);
  assert.equal(view.getSuggestionPreviewValue("r", "o", { value: -35 }, "s2"), -35);
  // Put back into the preview, the pair moves to the proposal again: the
  // manual state ends with the mark that ended it.
  await view.setPairExcludedFromPreview("r", "o", false, "s1");
  assert.equal(view.getSuggestionPreviewValue("r", "o", { value: -35 }), -35);
  glyphs[1].kernValue = 0;
  view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
  assert.equal(glyphs[1].x, 602);
  assert.equal(view._previewPairValue.get(glyphs[1]), 12);
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

test("skip-all mode inverts what a mark means and each mode keeps its own marks", async () => {
  const view = Object.create(Controller.prototype);
  let customData = {};
  const settings = { skipAll: false };
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    _previewExcludedPairs: new Set(),
    _previewIncludedPairs: new Set(),
    suggestionPreviewSettings: { model: settings },
    fontController: {
      get customData() {
        return customData;
      },
      async performEdit(label, key, mutate) {
        mutate({ customData });
        return { hasChange: false };
      },
    },
  });

  // Ordinary mode: everything previews, a mark takes one pair out.
  await view.setPairExcludedFromPreview("r", "o", true);
  assert.equal(view.isPairExcludedFromPreview("r", "o"), true);
  assert.equal(view.isPairExcludedFromPreview("A", "V"), false);

  // Skip-all mode: nothing previews, and the ordinary mark does not carry
  // over as an inclusion.
  settings.skipAll = true;
  assert.equal(view.isPairExcludedFromPreview("A", "V"), true);
  assert.equal(view.isPairExcludedFromPreview("r", "o"), true);
  await view.setPairExcludedFromPreview("A", "V", false);
  assert.equal(view.isPairExcludedFromPreview("A", "V"), false);
  assert.equal(view.isPairMarkedForPreview("A", "V"), true);
  // Both modes' marks are stored, the skip-mode one labeled as such.
  assert.equal(
    JSON.stringify(customData["fontra.autokernPreviewExcluded"]),
    JSON.stringify([
      { source: "s1", left: "r", right: "o" },
      { source: "s1", left: "A", right: "V", mode: "skip" },
    ])
  );

  // Back to ordinary mode: the original mark is still the one that answers.
  settings.skipAll = false;
  assert.equal(view.isPairExcludedFromPreview("r", "o"), true);
  assert.equal(view.isPairExcludedFromPreview("A", "V"), false);
});

test("a pair left out of the preview draws no band and no number", () => {
  const view = Object.create(Controller.prototype);
  const key = "r/o"; // the harness's own pairKey
  const id = JSON.stringify(["s1", "r", "o"]);
  Object.assign(view, {
    _chipMode: "phrase",
    _autokernSourceIdentifier: "s1",
    suggestionPreviewSettings: { model: { enabled: true, skipAll: false } },
    autokernCache: new Map([[key, { left: "r", right: "o", value: -40 }]]),
    kerningController: {
      getGlyphPairValueForSource: () => 0,
      getPairValues: () => undefined,
      leftPairGroupMapping: {},
      rightPairGroupMapping: {},
    },
    _previewExcludedPairs: new Set(),
    _previewIncludedPairs: new Set(),
    _manualPreviewPairs: new Map(),
    _previewOriginalX: new WeakMap(),
    _previewPairValue: new WeakMap(),
  });
  const line = () => [
    { glyphName: "r", x: 0, kernValue: 0 },
    { glyphName: "o", x: 590, kernValue: 0 },
  ];
  const reposition = () => {
    const glyphs = line();
    view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
    return glyphs[1];
  };

  // In the preview: re-spaced, and the ribbon carries the proposal.
  let glyph = reposition();
  assert.equal(view._previewPairValue.get(glyph), -40);
  assert.equal(glyph.x, 550);

  // Left out: no ribbon and no re-spacing.
  view._previewExcludedPairs.add(id);
  glyph = reposition();
  assert.equal(view._previewPairValue.get(glyph), undefined);
  assert.equal(glyph.x, 590);

  // Skip-all mode: out until this pair's own mark puts it in.
  view.suggestionPreviewSettings.model.skipAll = true;
  glyph = reposition();
  assert.equal(view._previewPairValue.get(glyph), undefined);
  view._previewIncludedPairs.add(id);
  glyph = reposition();
  assert.equal(view._previewPairValue.get(glyph), -40);
  assert.equal(glyph.x, 550);
});

test("only marked pairs lists the exceptions to the mode, whichever mode is on", () => {
  const view = Object.create(Controller.prototype);
  const settings = { skipAll: false };
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    suggestionPreviewSettings: { model: settings },
    _previewExcludedPairs: new Set([JSON.stringify(["s1", "r", "o"])]),
    _previewIncludedPairs: new Set([JSON.stringify(["s1", "A", "V"])]),
    pairMatchesInputScope: () => true,
    pairMatchesTypes: () => true,
    isLeftClassed: () => false,
    isRightClassed: () => false,
    autokernParamsController: { model: { maxThreshold: null } },
    _relationshipsSet: new Set(["unique-unique"]),
    _tableGlyphsetMembers: null,
  });
  const filters = { showHidden: true, onlyMarked: true };
  const row = (left, right) => ({
    left,
    right,
    current: 0,
    suggestion: -10,
    kind: "unique-pair",
  });

  // Ordinary mode: the marked pair is the one taken out of the preview.
  assert.equal(view.pairRowVisible(row("r", "o"), filters, 0), true);
  assert.equal(view.pairRowVisible(row("A", "V"), filters, 0), false);
  assert.equal(view.pairRowVisible(row("T", "y"), filters, 0), false);

  // Skip-all mode: the marked pair is the one put into the preview, so the
  // list inverts rather than growing to the whole font.
  settings.skipAll = true;
  assert.equal(view.pairRowVisible(row("A", "V"), filters, 0), true);
  assert.equal(view.pairRowVisible(row("r", "o"), filters, 0), false);
  assert.equal(view.pairRowVisible(row("T", "y"), filters, 0), false);

  // Off, the filter says nothing about any row.
  filters.onlyMarked = false;
  assert.equal(view.pairRowVisible(row("T", "y"), filters, 0), true);
});

test("a mark on a class rule answers for every pair the rule covers", async () => {
  const view = Object.create(Controller.prototype);
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    suggestionPreviewSettings: { model: { skipAll: false, enabled: true } },
    _previewExcludedPairs: new Set(),
    _previewIncludedPairs: new Set(),
    kerningController: {
      leftPairGroupMapping: { T: "T_uc" },
      rightPairGroupMapping: { o: "o_lc", e: "o_lc" },
    },
    fontController: { customData: {}, async performEdit() {} },
    sceneModel: { updateScene() {} },
    renderPairTable() {},
  });

  // The class row's own circle, pressed once.
  await view.setPairExcludedFromPreview("@T_uc", "@o_lc", true);
  // Every pair under the rule reads it.
  assert.equal(view.isPairExcludedFromPreview("T", "o"), true);
  assert.equal(view.isPairExcludedFromPreview("T", "e"), true);
  // A pair outside the rule does not.
  assert.equal(view.isPairExcludedFromPreview("A", "o"), false);
  assert.equal(view.isPairExcludedFromPreview("T", "y"), false);
});

test("shift chains rows, ctrl picks them out, a plain click resets the anchor", () => {
  const view = Object.create(Controller.prototype);
  const order = ["r1", "r2", "r3", "r4"];
  Object.assign(view, {
    resultSelection: { selected: new Set() },
    loadedPairTableRowIds: () => order,
    applyResultSelectionToDom() {},
    syncSelectAllCheckboxes() {},
    refreshResetArmState() {},
    updatePairPreview() {},
  });
  const selected = () => [...view.resultSelection.selected].join(",");

  view.selectRowFromClick("r2", {});
  assert.equal(selected(), "r2");
  view.selectRowFromClick("r4", { shiftKey: true });
  assert.equal(selected(), "r2,r3,r4");
  // Ctrl takes one back out of the chain without touching the rest.
  view.selectRowFromClick("r3", { ctrlKey: true });
  assert.equal(selected(), "r2,r4");
  // Ctrl also moves the anchor, so the next chain runs from there.
  view.selectRowFromClick("r1", { metaKey: true });
  assert.equal(selected(), "r2,r4,r1");
  view.selectRowFromClick("r2", { shiftKey: true });
  assert.equal(selected(), "r1,r2");
  // A plain click starts again.
  view.selectRowFromClick("r3", {});
  assert.equal(selected(), "r3");
});

test("the delta threshold leaves an applied row on screen", () => {
  const view = Object.create(Controller.prototype);
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    suggestionPreviewSettings: { model: { skipAll: false } },
    _previewExcludedPairs: new Set(),
    _previewIncludedPairs: new Set(),
    pairMatchesInputScope: () => true,
    pairMatchesTypes: () => true,
    isLeftClassed: () => false,
    isRightClassed: () => false,
    autokernParamsController: { model: { maxThreshold: null } },
    _relationshipsSet: new Set(["unique-unique"]),
    _tableGlyphsetMembers: null,
  });
  const filters = { showHidden: true, onlyMarked: false };
  const row = (current, suggestion) => ({
    left: "r",
    right: "o",
    current,
    suggestion,
    kind: "unique-pair",
  });

  // Applying a row makes its delta zero. With a threshold of 20 it used to
  // disappear at the moment it was applied, which read as the write failing.
  assert.equal(view.pairRowVisible(row(-40, -40), filters, 20), true);
  // An unkerned pair below the threshold is what the threshold is for.
  assert.equal(view.pairRowVisible(row(0, -4), filters, 20), false);
  assert.equal(view.pairRowVisible(row(0, -40), filters, 20), true);
});

test("a class member reads its rule's proposal, candidate or not", () => {
  const view = Object.create(Controller.prototype);
  const entries = [
    { left: "a", right: "z", value: 24 },
    { left: "acircumflex", right: "z", value: 29 },
    { left: "adieresis", right: "z", value: 12 },
  ];
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    autokernParamsController: { model: { groupThreshold: 10 } },
    autokernCache: new Map(entries.map((e) => [`${e.left}/${e.right}`, e])),
    kerningController: {
      kernData: {
        groupsSide1: { a_R: ["a", "acircumflex", "adieresis"] },
        groupsSide2: {},
      },
      getGlyphPairValueForSource: () => 29,
      getPairValues: () => undefined,
      leftPairGroupMapping: { a: "a_R", acircumflex: "a_R", adieresis: "a_R" },
      rightPairGroupMapping: {},
    },
    isLeftClassed: (name) => name in { a: 1, acircumflex: 1, adieresis: 1 },
    isRightClassed: () => false,
    wouldShadowClassCell: () => true,
  });

  // The rule's proposal: the members' middle is 24, so 12 is the outlier at a
  // tolerance of 10 and the median of the rest is 26 (24 and 29 averaged, and
  // 26.5 rounds to 27).
  assert.equal(view.classProposalForPair("a", "z"), 27);

  // Every member reads that, including the outlier -- until it has a pair of
  // its own, the rule is what it gets.
  for (const entry of entries) {
    const row = view.pairRowData(entry, true);
    assert.equal(row.answeredByClass, true);
    assert.equal(row.suggestion, 27);
    assert.equal(row.ownSuggestion, entry.value);
    assert.equal(view.buildApplyProposalButton(row).disabled, true);
  }

  // The outlier is still flagged as a potential override.
  assert.equal(view.pairRowData(entries[2], true).isCandidate, true);
  assert.equal(view.pairRowData(entries[1], true).isCandidate, false);
});

test("applying a class rule settles: the median does not move when it is written", () => {
  const view = Object.create(Controller.prototype);
  let stored = 0;
  Object.assign(view, {
    _autokernSourceIdentifier: "s1",
    autokernParamsController: { model: { groupThreshold: 10 } },
    kerningController: {
      kernData: { groupsSide1: { a_R: ["a", "acircumflex"] }, groupsSide2: {} },
      getGlyphPairValueForSource: () => stored,
      getPairValueForSource: () => stored,
      getPairValues: () => undefined,
      leftPairGroupMapping: { a: "a_R", acircumflex: "a_R" },
      rightPairGroupMapping: {},
    },
    autokernCache: new Map(),
  });
  const group = {
    left: "@a_R",
    right: "x",
    leftClassName: "a_R",
    rightClassName: null,
    entries: [
      { left: "a", right: "x", value: -10 },
      { left: "acircumflex", right: "x", value: -10 },
      { left: "adieresis", right: "x", value: -40 },
    ],
    rows: [],
  };

  // Nothing stored yet: the rule proposes the members' own middle.
  const first = view.computeFoldGroupStats(group, 10);
  assert.equal(first.median, -10);

  // Apply it, and ask again. The members have not changed, so their middle
  // has not either -- the rule now matches what is stored and the row has no
  // leftover delta. Measured against the stored value, the outlier set moved
  // when this number was written and the median came back different.
  stored = -10;
  assert.equal(view.computeFoldGroupStats(group, 10).median, -10);
});

test("the canvas and the table propose the same number for a class member", () => {
  const view = Object.create(Controller.prototype);
  const entry = { left: "a", right: "x", value: 12 };
  let stored = 0;
  Object.assign(view, {
    _chipMode: "phrase",
    _autokernSourceIdentifier: "s1",
    suggestionPreviewSettings: { model: { enabled: true, skipAll: false } },
    autokernParamsController: { model: { groupThreshold: 10 } },
    autokernCache: new Map([
      ["a/x", entry],
      ["acircumflex/x", { left: "acircumflex", right: "x", value: 22 }],
      ["adieresis/x", { left: "adieresis", right: "x", value: 22 }],
    ]),
    kerningController: {
      kernData: {
        groupsSide1: { a_R: ["a", "acircumflex", "adieresis"] },
        groupsSide2: {},
      },
      getGlyphPairValueForSource: () => stored,
      getPairValueForSource: () => stored,
      getPairValues: () => undefined,
      leftPairGroupMapping: { a: "a_R", acircumflex: "a_R", adieresis: "a_R" },
      rightPairGroupMapping: {},
    },
    isLeftClassed: (name) => name in { a: 1, acircumflex: 1, adieresis: 1 },
    isRightClassed: () => false,
    wouldShadowClassCell: () => true,
    _previewExcludedPairs: new Set(),
    _previewIncludedPairs: new Set(),
    _manualPreviewPairs: new Map(),
    _previewOriginalX: new WeakMap(),
    _previewPairValue: new WeakMap(),
  });

  // The rule proposes 22. The member's own 12 is the outlier, and the canvas
  // used to preview that 12 -- a number its row never showed.
  assert.equal(view.pairRowData(entry, true).suggestion, 22);
  assert.equal(view.getSuggestionPreviewValue("a", "x", entry), 22);

  const reposition = () => {
    const glyphs = [
      { glyphName: "a", x: 0, kernValue: stored },
      { glyphName: "x", x: 500, kernValue: stored },
    ];
    view._applySuggestionPreviewRepositioning({ positionedLines: [{ glyphs }] });
    return glyphs[1];
  };

  // Before applying: the ribbon asks for the whole 22.
  assert.equal(view._previewPairValue.get(reposition()), 22);
  // After applying the rule, there is nothing left to ask for -- it used to
  // turn negative here, showing the member's own value minus what was written.
  stored = 22;
  view._classProposals = null;
  assert.equal(view._previewPairValue.get(reposition()), 0);
});
