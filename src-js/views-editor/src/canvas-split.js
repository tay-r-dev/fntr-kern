import { CanvasController } from "@fontra/core/canvas-controller.js";
import {
  characterLinesFromString,
  stringFromCharacterLines,
} from "@fontra/core/character-lines.js";
import { GlyphOrganizer } from "@fontra/core/glyph-organizer.js";
import * as html from "@fontra/core/html-utils.js";
import { ObservableController } from "@fontra/core/observable-object.ts";
import { rectAddMargin, rectFromArray, rectToArray } from "@fontra/core/rectangle.ts";
import { SceneView } from "@fontra/core/scene-view.js";
import {
  consolidateCalls,
  dumpURLFragment,
  getCharFromCodePoint,
  glyphMapToItemList,
} from "@fontra/core/utils.ts";
import { GlyphCellView } from "@fontra/web-components/glyph-cell-view.js";
import { GlyphSearchField } from "@fontra/web-components/glyph-search-field.js";
import {
  PANE_CANVAS,
  PANE_OVERVIEW,
  clampSplitRatio,
  closePane,
  openGlyphInPane,
  paneStateFromViewInfo,
  paneViewInfo,
  showOverviewInPane,
  splitPanes,
} from "./canvas-split-model.js";
import { getSceneSettingsDefaults } from "./scene-controller.js";
import { SceneModel } from "./scene-model.js";
import { allGlyphsCleanVisualizationLayerDefinition } from "./visualization-layer-definitions.js";
import { VisualizationContext, VisualizationLayers } from "./visualization-layers.js";

const MIN_PANE_WIDTH = 160;
const RATIO_STORAGE_KEY = "fontra-canvas-split-ratio";

// The settings the passive canvas takes from the live one: both panes show
// the font at one location, set by the same text settings.
const SHARED_SCENE_KEYS = [
  "shaper",
  "combinedCharacterMap",
  "combinedGlyphMap",
  "fontLocationUser",
  "fontLocationSource",
  "fontLocationSourceMapped",
  "align",
  "featureSettings",
  "applyTextShaping",
  "textDirection",
  "textScript",
  "textLanguage",
];

// The editor's canvas split in two panes. The editor's own canvas is the live
// one: the panels and tools act on it. The other pane shows its glyphs filled,
// kept current as the font is edited, and takes the live canvas when clicked.
// Either pane can show the font overview instead, to pick its glyph.
export class CanvasSplit {
  constructor(editor) {
    this.editor = editor;
    this.layout = null; // null while the canvas is whole
    this.root = document.querySelector("#canvas-split");
    this.slots = [...this.root.querySelectorAll(".canvas-slot")];
    this.divider = this.root.querySelector(".canvas-split-divider");
    this.livePane = document.querySelector("#canvas-pane-live");
    this.passive = null; // built on the first split
    this.overviews = [null, null];
    // The pane a context menu was opened on; the pane actions act on it.
    this.menuPaneIndex = null;
    this.ratio = readStoredRatio();
    this._setupDivider();
  }

  get isSplit() {
    return !!this.layout;
  }

  // The pane actions act on: the one the menu came from, else the live one.
  get targetPaneIndex() {
    return this.menuPaneIndex ?? this.layout?.live ?? 0;
  }

  // An action run from a menu uses up the pane the menu was opened on; the
  // next one, from a shortcut, acts on the live pane again.
  _takeTargetPaneIndex() {
    const index = this.targetPaneIndex;
    this.menuPaneIndex = null;
    return index;
  }

  closeTargetPane() {
    return this.closePane(this._takeTargetPaneIndex());
  }

  separateTargetPane() {
    return this.separatePane(this._takeTargetPaneIndex());
  }

  showOverviewInTargetPane() {
    return this.showOverview(this._takeTargetPaneIndex());
  }

  canShowOverview(index = this.targetPaneIndex) {
    return this.isSplit && this.layout.panes[index] === PANE_CANVAS;
  }

  toggle() {
    if (this.isSplit) {
      this.closePane(1 - this.layout.live);
    } else {
      this.split();
    }
  }

  split() {
    if (this.isSplit) {
      return;
    }
    const viewBox = this.editor.canvasController.getViewBox();
    this.layout = splitPanes();
    this.root.classList.add("split");
    this._applyRatio();
    this._ensurePassive();
    this._render();
    this._keepLiveView(viewBox);
  }

  // A canvas that changes width keeps its origin, so what was in its middle
  // ends up off to one side. The live canvas shows again what it showed.
  _keepLiveView(viewBox) {
    this.editor.sceneSettings.viewBox = viewBox;
  }

  // The live canvas moves to the pane at `index`, and the view that pane
  // showed goes with it. The view the live canvas left stays where it was, on
  // the passive canvas.
  activate(index) {
    if (
      !this.isSplit ||
      index === this.layout.live ||
      this.layout.panes[index] !== PANE_CANVAS
    ) {
      return this._swapping;
    }
    if (!this._swapping) {
      this._swapping = this._moveLive(index).finally(() => (this._swapping = null));
    }
    return this._swapping;
  }

  async _moveLive(index) {
    const editor = this.editor;
    const liveInfo = editor.sceneController.getViewInfoFromSceneSettings();
    const passiveState = this.passive.getState();
    this.layout = { ...this.layout, live: index };
    this._render();
    this.passive.setState(paneStateFromViewInfo(liveInfo));
    await editor.applyPaneViewInfo(paneViewInfo(liveInfo, passiveState));
    editor.canvasController.canvas.focus();
  }

  async openGlyph(index, paneState) {
    if (index === this.layout.live) {
      this.layout = openGlyphInPane(this.layout, index);
      this._render();
      const liveInfo = this.editor.sceneController.getViewInfoFromSceneSettings();
      await this.editor.applyPaneViewInfo(paneViewInfo(liveInfo, paneState));
      this.editor.canvasController.canvas.focus();
      return;
    }
    this.passive.setState(paneState);
    this.layout = { ...this.layout, panes: openGlyphInPane(this.layout, index).panes };
    this._render();
    await this.activate(index);
  }

  async showOverview(index) {
    if (!this.canShowOverview(index)) {
      return;
    }
    const next = showOverviewInPane(this.layout, index);
    if (next.live !== this.layout.live) {
      await this.activate(next.live);
    }
    this.layout = { ...this.layout, panes: next.panes };
    this._render();
    this.overviews[index]?.focus();
  }

  // The split closes; the pane that stays fills the whole area.
  async closePane(index) {
    if (!this.isSplit) {
      return;
    }
    const keep = closePane(this.layout, index);
    if (keep !== this.layout.live) {
      await this.activate(keep);
    }
    const viewBox = this.editor.canvasController.getViewBox();
    this.layout = null;
    this.root.classList.remove("split");
    this.root.style.gridTemplateColumns = "";
    this._render();
    this._keepLiveView(viewBox);
    this.editor.canvasController.canvas.focus();
  }

  canSeparatePane(index = this.targetPaneIndex) {
    return this.isSplit && this.layout.panes[index] === PANE_CANVAS;
  }

  // The pane's view opens in a new browser tab, and leaves the split.
  async separatePane(index) {
    if (!this.canSeparatePane(index)) {
      return;
    }
    const liveInfo = this.editor.sceneController.getViewInfoFromSceneSettings();
    const viewInfo =
      index === this.layout.live
        ? liveInfo
        : paneViewInfo(liveInfo, this.passive.getState());
    const url = new URL(window.location);
    url.hash = dumpURLFragment(viewInfo);
    window.open(url.toString(), "_blank");
    await this.closePane(index);
  }

  // The index of the pane holding this element, or -1.
  paneIndexOfElement(element) {
    return this.slots.findIndex((slot) => slot.contains(element));
  }

  themeChanged() {
    this.passive?.themeChanged();
  }

  _ensurePassive() {
    if (!this.passive) {
      this.passive = new PassivePane(this);
    }
  }

  _ensureOverview(index) {
    if (!this.overviews[index]) {
      const overview = new PaneOverview(this.editor, (paneState) =>
        this.openGlyph(index, paneState)
      );
      overview.element.addEventListener("contextmenu", (event) =>
        this._overviewContextMenu(event, index)
      );
      this.overviews[index] = overview;
      this.slots[index].appendChild(overview.element);
    }
    return this.overviews[index];
  }

  _overviewContextMenu(event, index) {
    event.preventDefault();
    this.menuPaneIndex = index;
    this.editor.showCanvasSplitMenu(event);
  }

  // Puts each pane's elements in its slot: the live canvas in the live slot,
  // the passive one in the other, and an overview over a slot that shows one.
  _render() {
    const layout = this.layout;
    const live = layout?.live ?? 0;
    this._place(this.livePane, this.slots[live]);
    if (this.passive) {
      this._place(this.passive.element, this.slots[1 - live]);
    }
    for (const [index, slot] of this.slots.entries()) {
      const showsOverview = layout?.panes[index] === PANE_OVERVIEW;
      if (showsOverview && !slot.classList.contains("shows-overview")) {
        this._ensureOverview(index).update();
      }
      slot.classList.toggle("shows-overview", showsOverview);
      slot.classList.toggle("live", !!layout && index === live);
    }
    // The canvases take their new sizes now, not a frame later, so a view
    // handed to them is fitted to the pane it will be seen in.
    this.editor.canvasController.setupSize();
    this.editor.canvasController.requestUpdate();
    if (this.passive && layout) {
      this.passive.canvasController.setupSize();
      this.passive.canvasController.requestUpdate();
    }
  }

  _place(element, slot) {
    if (element.parentElement !== slot) {
      slot.insertBefore(element, slot.firstChild);
    }
  }

  _applyRatio() {
    const width = this.root.getBoundingClientRect().width;
    const ratio = clampSplitRatio(this.ratio, width, MIN_PANE_WIDTH);
    this.root.style.gridTemplateColumns = `minmax(0, ${ratio}fr) auto minmax(0, ${
      1 - ratio
    }fr)`;
  }

  _setupDivider() {
    this.divider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.divider.setPointerCapture(event.pointerId);
      const move = (event) => {
        const rect = this.root.getBoundingClientRect();
        this.ratio = clampSplitRatio(
          (event.clientX - rect.left) / rect.width,
          rect.width,
          MIN_PANE_WIDTH
        );
        this._applyRatio();
      };
      const up = () => {
        this.divider.removeEventListener("pointermove", move);
        this.divider.removeEventListener("pointerup", up);
        this.divider.removeEventListener("pointercancel", up);
        storeRatio(this.ratio);
      };
      this.divider.addEventListener("pointermove", move);
      this.divider.addEventListener("pointerup", up);
      this.divider.addEventListener("pointercancel", up);
    });
  }
}

// The canvas of the pane that is not live. It lays out its own text with the
// live canvas's location and text settings, and draws the glyphs filled.
class PassivePane {
  constructor(split) {
    const editor = split.editor;
    this.split = split;
    this.editor = editor;
    this.fontController = editor.fontController;
    this.autoFit = true;

    this.canvas = html.createDomElement("canvas", {
      class: "canvas-split-passive",
      tabindex: "-1",
    });
    this.element = html.div({ class: "canvas-pane" }, [this.canvas]);
    // The canvas controller reads its size from the pane, so the pane is in
    // the page before it is made.
    split.slots[1].appendChild(this.element);

    this.canvasController = new CanvasController(this.canvas, () => {});
    this.canvasController.minMagnification = editor.canvasController.minMagnification;
    this.canvasController.maxMagnification = editor.canvasController.maxMagnification;

    this.settingsController = new ObservableController(getSceneSettingsDefaults());
    this.settings = this.settingsController.model;
    for (const key of SHARED_SCENE_KEYS) {
      this.settings[key] = editor.sceneSettings[key];
    }

    this.sceneModel = new SceneModel(
      this.fontController,
      this.settingsController,
      this.canvasController.context.isPointInPath.bind(this.canvasController.context),
      editor.visualizationLayersSettings
    );
    // The live scene keeps the font's glyph subscriptions; this one only reads.
    this.sceneModel._adjustSubscriptions = () => {};
    // A glyph shows at the location the live canvas gives it.
    this.sceneModel.getLocationForGlyph = (glyphName) =>
      editor.sceneModel.getLocationForGlyph(glyphName);

    this.layers = new VisualizationLayers(
      [allGlyphsCleanVisualizationLayerDefinition],
      editor.isThemeDark
    );
    this.canvasController.sceneView = new SceneView(
      this.sceneModel,
      (model, controller) =>
        this.layers.drawVisualizationLayers(new VisualizationContext(model, controller))
    );

    this.requestSceneUpdate = consolidateCalls(async () => {
      if (!split.isSplit) {
        return;
      }
      await this.sceneModel.updateScene();
      this.canvasController.requestUpdate();
    });

    editor.sceneSettingsController.addKeyListener(SHARED_SCENE_KEYS, (event) => {
      this.settings[event.key] = event.newValue;
      this.requestSceneUpdate();
    });

    this.settingsController.addKeyListener(
      ["text", "combinedCharacterMap", "combinedGlyphMap"],
      () => this._updateCharacterLines()
    );

    this.settingsController.addKeyListener("positionedLines", () => {
      if (this.autoFit) {
        this._fitScene();
      }
      this.canvasController.requestUpdate();
    });

    this.canvas.addEventListener("viewBoxChanged", (event) => {
      if (event.detail === "canvas-size") {
        if (this.autoFit) {
          this._fitScene();
        }
      } else if (event.detail !== "set-view-box") {
        this.autoFit = false;
      }
    });

    // An edit anywhere may change what this pane shows: a component it uses,
    // the glyph itself, its kerning.
    this.fontController.addEditListener(async (editMethodName) => {
      if (editMethodName === "editIncremental" || editMethodName === "editFinal") {
        this.requestSceneUpdate();
      }
    });
    this.fontController.addChangeListener({ glyphMap: null }, () =>
      this._updateCharacterLines()
    );

    // The first press on this pane makes it the live one; the gesture itself
    // is not handed on, so a click to switch panes edits nothing.
    this.canvas.addEventListener("pointerdown", (event) => {
      const index = split.paneIndexOfElement(this.element);
      if (index >= 0) {
        split.activate(index);
      }
    });
    this.canvas.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const index = split.paneIndexOfElement(this.element);
      await split.activate(index);
      editor.contextMenuHandler(event);
    });
  }

  getState() {
    return {
      text: this.settings.text,
      selectedGlyph: this.settings.selectedGlyph,
      viewBox: this.autoFit ? null : rectToArray(this.canvasController.getViewBox()),
    };
  }

  setState({ text, selectedGlyph, viewBox }) {
    this.autoFit = !viewBox;
    this.settings.selectedGlyph = selectedGlyph;
    this.settings.text = text;
    if (viewBox) {
      this.canvasController.setViewBox(rectFromArray(viewBox));
    }
    this._updateCharacterLines();
    this.canvasController.requestUpdate();
  }

  themeChanged() {
    this.layers.darkTheme = this.editor.isThemeDark;
    this.canvasController.requestUpdate();
  }

  _updateCharacterLines() {
    this.settings.characterLines = characterLinesFromString(
      this.settings.text,
      this.fontController.characterMap,
      this.fontController.glyphMap,
      this.settings.combinedCharacterMap,
      this.settings.combinedGlyphMap,
      null
    );
  }

  _fitScene() {
    const bounds = this.sceneModel.getSceneBounds();
    if (bounds) {
      this.canvasController.setViewBox(rectAddMargin(bounds, 0.1));
    }
  }
}

// The font's glyphs in a pane, with a search field. Picking one opens it in
// that pane.
class PaneOverview {
  constructor(editor, onPick) {
    this.editor = editor;
    this.fontController = editor.fontController;
    this.onPick = onPick;
    this.organizer = new GlyphOrganizer();

    this.settingsController = new ObservableController({
      fontLocationSourceMapped: editor.sceneSettings.fontLocationSourceMapped,
      glyphSelection: new Set(),
      closedGlyphSections: new Set(),
      searchString: "",
    });
    editor.sceneSettingsController.addKeyListener(
      "fontLocationSourceMapped",
      (event) => {
        this.settingsController.model.fontLocationSourceMapped = event.newValue;
      }
    );
    this.settingsController.addKeyListener("searchString", (event) => {
      this.organizer.setSearchString(event.newValue);
      this.update();
    });

    this.searchField = new GlyphSearchField({
      settingsController: this.settingsController,
      searchStringKey: "searchString",
    });
    this.cellView = new GlyphCellView(this.fontController, this.settingsController);
    this.cellView.onOpenSelectedGlyphs = () => this._pickSelected();
    // A plain click on a cell picks its glyph. The cell has selected it by the
    // time the click reaches the view.
    this.cellView.addEventListener("click", (event) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.composedPath().some((node) => node.localName === "glyph-cell")) {
        this._pickSelected();
      }
    });

    this.element = html.div({ class: "canvas-pane-overview" }, [
      html.div({ class: "canvas-pane-overview-search" }, [this.searchField]),
      html.div({ class: "canvas-pane-overview-cells" }, [this.cellView]),
    ]);
    // Keys typed here are for the overview. Only shortcuts with a modifier
    // reach the editor, so an arrow key moves the cell selection and not the
    // points of the live glyph.
    this.element.addEventListener("keydown", (event) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
      }
    });

    this.fontController.addChangeListener({ glyphMap: null }, () => {
      if (this.element.isConnected && this.element.offsetParent) {
        this.update();
      }
    });
  }

  update() {
    const items = this.organizer.sortGlyphs(
      glyphMapToItemList(this.fontController.glyphMap)
    );
    const sections = this.organizer.groupGlyphs(this.organizer.filterGlyphs(items));
    this.cellView.setGlyphSections(sections);
  }

  focus() {
    this.searchField.focusSearchField();
  }

  _pickSelected() {
    const [glyphInfo] = this.cellView.getSelectedGlyphInfo(true);
    if (!glyphInfo) {
      return;
    }
    const character = getCharFromCodePoint(glyphInfo.codePoints?.[0]);
    const text = stringFromCharacterLines([
      [character ? { glyphName: glyphInfo.glyphName, character } : glyphInfo],
    ]);
    this.cellView.glyphSelection = new Set();
    this.onPick({
      text,
      selectedGlyph: { lineIndex: 0, glyphIndex: 0, isEditing: true },
      viewBox: null,
    });
  }
}

function readStoredRatio() {
  try {
    const ratio = parseFloat(localStorage.getItem(RATIO_STORAGE_KEY));
    return ratio > 0 && ratio < 1 ? ratio : 0.5;
  } catch {
    return 0.5;
  }
}

function storeRatio(ratio) {
  try {
    localStorage.setItem(RATIO_STORAGE_KEY, String(ratio));
  } catch {
    // The ratio is a convenience; without storage it starts even next time.
  }
}
