import { expect } from "chai";
import {
  PANE_CANVAS,
  PANE_OVERVIEW,
  clampSplitRatio,
  closePane,
  completeViewInfo,
  openGlyphInPane,
  paneStateFromViewInfo,
  paneViewInfo,
  showOverviewInPane,
  splitPanes,
} from "../src/canvas-split-model.js";

describe("canvas split model", () => {
  describe("splitPanes", () => {
    it("keeps the canvas live in the first pane and opens the overview in the second", () => {
      expect(splitPanes()).to.deep.equal({
        panes: [PANE_CANVAS, PANE_OVERVIEW],
        live: 0,
      });
    });
  });

  describe("openGlyphInPane", () => {
    it("turns an overview pane into the live canvas", () => {
      const layout = openGlyphInPane(splitPanes(), 1);
      expect(layout).to.deep.equal({ panes: [PANE_CANVAS, PANE_CANVAS], live: 1 });
    });

    it("leaves the other pane as it was", () => {
      const layout = openGlyphInPane(
        { panes: [PANE_OVERVIEW, PANE_OVERVIEW], live: 0 },
        1
      );
      expect(layout.panes).to.deep.equal([PANE_OVERVIEW, PANE_CANVAS]);
    });
  });

  describe("showOverviewInPane", () => {
    it("moves the live canvas to the other pane when that one is a canvas", () => {
      const layout = showOverviewInPane(
        { panes: [PANE_CANVAS, PANE_CANVAS], live: 0 },
        0
      );
      expect(layout).to.deep.equal({ panes: [PANE_OVERVIEW, PANE_CANVAS], live: 1 });
    });

    it("keeps the live pane when the other one is an overview too", () => {
      const layout = showOverviewInPane(
        { panes: [PANE_CANVAS, PANE_OVERVIEW], live: 0 },
        0
      );
      expect(layout).to.deep.equal({ panes: [PANE_OVERVIEW, PANE_OVERVIEW], live: 0 });
    });

    it("does not move the live canvas when the passive pane turns into an overview", () => {
      const layout = showOverviewInPane(
        { panes: [PANE_CANVAS, PANE_CANVAS], live: 1 },
        0
      );
      expect(layout).to.deep.equal({ panes: [PANE_OVERVIEW, PANE_CANVAS], live: 1 });
    });
  });

  describe("closePane", () => {
    it("keeps the other pane when it is a canvas", () => {
      expect(closePane({ panes: [PANE_CANVAS, PANE_CANVAS], live: 0 }, 0)).to.equal(1);
      expect(closePane({ panes: [PANE_CANVAS, PANE_CANVAS], live: 0 }, 1)).to.equal(0);
    });

    it("keeps the canvas when the other pane is an overview", () => {
      expect(closePane({ panes: [PANE_CANVAS, PANE_OVERVIEW], live: 0 }, 0)).to.equal(
        0
      );
      expect(closePane({ panes: [PANE_OVERVIEW, PANE_CANVAS], live: 1 }, 1)).to.equal(
        1
      );
    });

    it("keeps the live canvas when both panes are overviews", () => {
      expect(closePane({ panes: [PANE_OVERVIEW, PANE_OVERVIEW], live: 1 }, 0)).to.equal(
        1
      );
      expect(closePane({ panes: [PANE_OVERVIEW, PANE_OVERVIEW], live: 1 }, 1)).to.equal(
        1
      );
    });
  });

  describe("clampSplitRatio", () => {
    it("passes a ratio that leaves both panes their minimum", () => {
      expect(clampSplitRatio(0.3, 1000, 200)).to.equal(0.3);
    });

    it("holds the first pane at its minimum", () => {
      expect(clampSplitRatio(0.1, 1000, 200)).to.equal(0.2);
    });

    it("holds the second pane at its minimum", () => {
      expect(clampSplitRatio(0.95, 1000, 200)).to.equal(0.8);
    });

    it("splits evenly when the box cannot hold two minimums", () => {
      expect(clampSplitRatio(0.1, 300, 200)).to.equal(0.5);
    });
  });

  describe("paneStateFromViewInfo", () => {
    it("keeps what belongs to a pane: its text, glyph, selection and view", () => {
      const state = paneStateFromViewInfo({
        text: "Aacute",
        selectedGlyph: { lineIndex: 0, glyphIndex: 1, isEditing: true },
        viewBox: [0, 0, 100, 100],
        location: { wght: 400 },
        selection: ["point/1"],
      });
      expect(state).to.deep.equal({
        text: "Aacute",
        selectedGlyph: { lineIndex: 0, glyphIndex: 1, isEditing: true },
        selection: ["point/1"],
        viewBox: [0, 0, 100, 100],
      });
    });

    it("fills what the view info leaves out", () => {
      expect(paneStateFromViewInfo({})).to.deep.equal({
        text: "",
        selectedGlyph: null,
        selection: [],
        viewBox: null,
      });
    });
  });

  describe("paneViewInfo", () => {
    const liveInfo = {
      text: "a",
      selectedGlyph: { lineIndex: 0, glyphIndex: 0, isEditing: true },
      viewBox: [1, 2, 3, 4],
      location: { wght: 700 },
      selection: ["point/3"],
      editLayerName: "a-layer",
      editingLayers: { "a-layer": {} },
      substituteGlyphName: "a",
      align: "left",
    };

    it("puts the pane's text, glyph and view in the live view info", () => {
      const info = paneViewInfo(liveInfo, {
        text: "/acutecomb",
        selectedGlyph: { lineIndex: 0, glyphIndex: 0, isEditing: true },
        viewBox: [5, 6, 7, 8],
      });
      expect(info.text).to.equal("/acutecomb");
      expect(info.viewBox).to.deep.equal([5, 6, 7, 8]);
      expect(info.location).to.deep.equal({ wght: 700 });
      expect(info.align).to.equal("left");
    });

    it("carries the pane's own selection", () => {
      const info = paneViewInfo(liveInfo, {
        text: "b",
        selectedGlyph: { lineIndex: 0, glyphIndex: 0, isEditing: true },
        selection: ["point/7"],
        viewBox: null,
      });
      expect(info.selection).to.deep.equal(["point/7"]);
    });

    it("drops what only fits the live glyph", () => {
      const info = paneViewInfo(liveInfo, {
        text: "b",
        selectedGlyph: null,
        viewBox: null,
      });
      expect(info).to.not.have.any.keys(
        "selection",
        "editLayerName",
        "editingLayers",
        "substituteGlyphName",
        "viewBox"
      );
      expect(info.selectedGlyph).to.equal(null);
    });
  });

  describe("completeViewInfo", () => {
    const settings = [
      { key: "text" },
      { key: "viewBox" },
      { key: "fontLocationUser", infoKey: "location" },
      { key: "selectedGlyph" },
      { key: "selection" },
      { key: "editingLayers" },
      { key: "align" },
    ];
    const defaults = {
      text: "",
      viewBox: null,
      fontLocationUser: {},
      selectedGlyph: null,
      selection: new Set(),
      editingLayers: {},
      align: "center",
    };

    it("gives every missing key its default, so nothing of the old view stays", () => {
      expect(completeViewInfo({ text: "x" }, settings, defaults)).to.deep.equal({
        text: "x",
        location: {},
        selectedGlyph: null,
        selection: [],
        editingLayers: {},
        align: "center",
      });
    });

    it("keeps the keys the view info has", () => {
      const info = completeViewInfo(
        { viewBox: [0, 0, 1, 1], location: { wght: 1 }, selection: ["p/1"] },
        settings,
        defaults
      );
      expect(info.viewBox).to.deep.equal([0, 0, 1, 1]);
      expect(info.location).to.deep.equal({ wght: 1 });
      expect(info.selection).to.deep.equal(["p/1"]);
    });
  });
});
