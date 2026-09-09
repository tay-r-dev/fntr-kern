import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as inputTokens from "../src/input-tokens.js";
import { retainVisible } from "../src/results-selection.js";

// Evaluate the actual controller class without importing browser-only modules.
// No copied method implementations: deleting a method from kerning.js must fail.
const source = readFileSync(process.env.KERNING_CONTROLLER_SOURCE ||
  new URL("../src/kerning.js", import.meta.url), "utf8");
const classSource = source.slice(source.indexOf("export class KerningViewController"),
  source.indexOf("const GLYPH_LIST_TRUNCATE_AT")).replace("export class", "class")
  .replaceAll("import.meta.url", JSON.stringify(import.meta.url));
const tbody = { textContent: "" };
const Controller = vm.runInNewContext(`${classSource}\nKerningViewController;`, {
  ViewController: class {},
  ...inputTokens,
  retainVisible,
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
