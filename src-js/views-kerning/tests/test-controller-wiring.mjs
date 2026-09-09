import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as inputTokens from "../src/input-tokens.js";
import { retainVisible } from "../src/results-selection.js";
import { layoutPairPreview, normalizePairsPerRow } from "../src/pair-preview-layout.js";

// Evaluate the actual controller class without importing browser-only modules.
// No copied method implementations: deleting a method from kerning.js must fail.
const source = readFileSync(process.env.KERNING_CONTROLLER_SOURCE ||
  new URL("../src/kerning.js", import.meta.url), "utf8");
const classSource = source.slice(source.indexOf("export class KerningViewController"),
  source.indexOf("const GLYPH_LIST_TRUNCATE_AT")).replace("export class", "class")
  .replaceAll("import.meta.url", JSON.stringify(import.meta.url));
const tbody = { textContent: "", children: [], appendChild(row) { this.children.push(row); } };
const frames = [];
const Controller = vm.runInNewContext(`${classSource}\nKerningViewController;`, {
  ViewController: class {},
  ...inputTokens,
  retainVisible,
  layoutPairPreview, normalizePairsPerRow,
  requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
  document: {
    querySelector: (selector) => selector === "#kerning-pairtable-body" ? tbody : null,
    querySelectorAll: () => [],
  },
});

test("table and preview callbacks remain methods of the actual controller", () => {
  for (const name of ["renderPairTable", "handlePreviewPairModifierClick",
    "previewFilterPairs", "pairMatchesInputScope", "pairMatchesTypes",
    "classAddressLabel", "isLeftClassed", "isRightClassed", "bucketForPair",
    "wouldShadowClassCell", "describeShadowedClassCell", "overrideDivergence",
    "isOverrideCandidate", "updateNonUnicodeNote"]) {
    assert.equal(typeof Controller.prototype[name], "function", name);
  }
});

test("Shift-click rerenders through the restored table renderer and toggles he/el", () => {
  const view = Object.create(Controller.prototype);
  let previews = 0;
  Object.assign(view, {
    _chipMode: "phrase", _previewPairSelections: new Map(), _previewPairsChip: {},
    autokernCache: new Map(),
    kerningController: { kernData: {}, leftPairGroupMapping: {}, rightPairGroupMapping: {} },
    fontController: { glyphMap: { h: [104], e: [101], l: [108] }, characterMap: {} },
    autokernFiltersController: { model: { glyphName: "h, e, l", side: "both",
      unicodeTypes: ["lowercase"], relationships: ["unique-unique"] } },
    autokernParamsController: { model: { threshold: 0, groupThreshold: 0 } },
    resultSelection: { highlighted: new Set(), ticked: new Set() },
    sceneModel: { positionedLines: [{ glyphs: [..."hello"].map((glyphName) => ({ glyphName })) }] },
    canvasController: { requestUpdate() {} },
    renderAutokernStatus() {}, renderStaleSection() {}, renderAnalyticsSection() {},
    activeSourceIdentifier: () => "source", syncSelectAllCheckboxes() {},
    refreshResetArmState() {}, updatePairPreview: () => { previews++; },
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
      renderKind: id % 2 ? "pair" : "class-rule", row: { id }, group: { id },
    })),
    _pairTableLoadedCount: 0,
    _pairTableLoadMore: {}, _pairTableLoadStatus: {},
    buildPairRowElement: (row) => { built++; return { id: row.id }; },
    buildClassSummaryRowElement: (group) => { built++; return { id: group.id }; },
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
    sortId: String(i), renderKind: "pair", left: "h", right: String(i),
  }));
  view.resultSelection = { highlighted: new Set(view._pairTableItems.map((r) => r.sortId)) };
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
  return { positionedLines: Array.from({ length: count }, (_, index) => {
    const y = -index * 1100;
    return { origin: { x: 0, y }, endPoint: { x: 1200 + kern, y },
      bounds: { xMin: 0, xMax: 1200 + kern, yMin: y - 200, yMax: y + 800 },
      glyphs: [0, 1].map((glyphIndex) => {
        const x = glyphIndex ? 600 + kern : 0;
        return { x, y, glyph: { xAdvance: 600 },
          bounds: { xMin: x, xMax: x + 600, yMin: y - 200, yMax: y + 800 } };
      }),
    };
  }) };
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
  assert.deepEqual(before.positionedLines.map((line) => line.origin),
    after.positionedLines.map((line) => line.origin));
  assert.deepEqual(after.positionedLines[3].origin, { x: 0, y: -1100 });
  for (const bad of [0, -1, 1.5, "", "bad", 101]) assert.equal(normalizePairsPerRow(bad), 6);
  assert.equal(normalizePairsPerRow("8"), 8);
});
