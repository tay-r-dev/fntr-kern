// The kerning view (forkra "Kerning view and autokern", spec KERNING-VIEW.md).
//
// WORKSTREAM 5: the left pane's scene, and only the scene. This replaces the
// workstream-4 plumbing stub with a controller that actually constructs and
// renders the editor's scene, reused via the widened views-editor exports
// (spec §8: "widen the views-editor exports map and import across views").
//
// In scope (workstream 5): a read-only glyph-string scene, pan/zoom only (the
// hand tool, always active), driven by a plain text input standing in for the
// future phrase presets/parameters panel.
//
// WORKSTREAM 6 adds: a bespoke, selection-only pointer tool
// (edit-tools-select.js) alongside the hand tool, and a minimal two-button
// tool switcher. Still nothing else -- see spec §6 for what the left pane
// eventually becomes, and the workstream brief for the explicit list of what
// does NOT belong here yet (sidebearing tool, kerning tool, the chip
// selector, the right pane, undo, menus).
//
// WORKSTREAM 8 adds the right pane's container and its first section (spec
// §7.1: preview phrase field + presets dropdown). This replaces the
// workstream-5 temporary phrase input (which lived inside
// #kerning-view-container, "standing in for the future phrase
// presets/parameters panel") with the real thing, in the new
// #kerning-panel-container. §7.2 onward are out of scope for this
// workstream; the rest of the right pane is deliberately empty.
//
// WORKSTREAM 9 adds §7.2's parameters section: threshold and Run (always
// visible), and a collapsible group for envelope reach, envelope type,
// reduction and strength. This wires the controls to an observable
// this.autokernParamsController only -- it does NOT run anything yet. The
// Run button and the values it reads are plumbing for the run worker of
// §4/§7.3, which is a later workstream; wiring them up here would mean
// guessing at a cache/worker interface that hasn't been built for this view
// yet (autokern-cache.js and autokern-engine.js exist and are tested, but
// nothing in views-kerning calls them).
import {
  doPerformAction,
  getActionIdentifierFromKeyEvent,
  registerAction,
} from "@fontra/core/actions.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { CanvasController } from "@fontra/core/canvas-controller.js";
import { parsePhrasePresets } from "@fontra/core/character-lines.js";
import { rasterizeGlyph } from "@fontra/core/glyph-raster.js";
import { ObservableController } from "@fontra/core/observable-object.ts";
import { SceneView } from "@fontra/core/scene-view.js";
import { themeController } from "@fontra/core/theme-settings.js";
import { ViewController } from "@fontra/core/view-controller.js";
import { dialogSetup } from "@fontra/web-components/modal-dialog.js";
import { HandTool } from "@fontra/views-editor/edit-tools-hand.js";
import { SceneController } from "@fontra/views-editor/scene-controller.js";
import { visualizationLayerDefinitions } from "@fontra/views-editor/visualization-layer-definitions.js";
import {
  VisualizationContext,
  VisualizationLayers,
} from "@fontra/views-editor/visualization-layers.js";
import { SelectTool } from "./edit-tools-select.js";

// Spec §2.4: the three control glyphs calibration reads.
const CONTROL_GLYPH_NAMES = ["l", "n", "o"];

export class KerningViewController extends ViewController {
  constructor(font, projectIdentifier) {
    super(font, projectIdentifier);

    // Construction order below follows EditorController's constructor in
    // views-editor/src/editor.js (roughly lines 153-260), minus everything
    // that view does beyond the scene: no sidebars, no other tools, no
    // undo, no double-click handling, no CJK design frame.

    const canvas = document.querySelector("#kerning-canvas");
    canvas.focus();

    const canvasController = new CanvasController(canvas, (magnification) =>
      this.canvasMagnificationChanged(magnification)
    );
    this.canvasController = canvasController;

    this.visualizationLayers = new VisualizationLayers(
      visualizationLayerDefinitions,
      this.isThemeDark
    );

    this.visualizationLayersSettings = newVisualizationLayersSettings(
      this.visualizationLayers
    );
    this.visualizationLayersSettings.addListener((event) => {
      this.visualizationLayers.toggle(event.key, event.newValue);
      this.canvasController.requestUpdate();
    }, true);

    this.sceneController = new SceneController(
      this.fontController,
      canvasController,
      applicationSettingsController,
      this.visualizationLayersSettings
    );

    this.sceneSettingsController = this.sceneController.sceneSettingsController;
    this.sceneSettings = this.sceneSettingsController.model;
    this.sceneModel = this.sceneController.sceneModel;

    const sceneView = new SceneView(this.sceneModel, (model, controller) =>
      this.visualizationLayers.drawVisualizationLayers(
        new VisualizationContext(model, controller)
      )
    );
    canvasController.sceneView = sceneView;
    this.defaultSceneView = sceneView;

    // Workstream 6: a minimal two-tool switcher (pointer, hand). Pointer is
    // selected by default, mirroring editor.js's own default
    // (this.setSelectedTool("pointer-tool")). Mirrors editor.js's `this.tools`
    // convention: tools are stored by their `identifier` field.
    this.tools = {};
    for (const tool of [new SelectTool(this), new HandTool(this)]) {
      this.tools[tool.identifier] = tool;
    }
    this.setSelectedTool("pointer-tool");

    this.initPhraseSection();
    this.initParametersSection();
    this.initRunSection();
    this.initToolSwitcher();
    this.initToolShortcuts();

    window.addEventListener("keydown", (event) => this.keyDownHandler(event));
    window.addEventListener("keyup", (event) => this.keyUpHandler(event));

    // Live theme changes (spec-neutral, but a real gap without it: this
    // canvas seeds its color scheme once at construction otherwise, and
    // never updates again if the app theme changes while the view stays
    // open). Mirrors editor.js's own theme wiring exactly.
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addListener((event) => this.themeChanged());
    themeController.addListener((event) => {
      this.themeChanged();
    });
  }

  themeChanged() {
    this.visualizationLayers.darkTheme = this.isThemeDark;
    this.canvasController.requestUpdate();
  }

  // Workstream 8, spec §7.1: the phrase field and its presets dropdown, in
  // the right pane. Replaces workstream 5's temporary plain input in the
  // left pane (see the file-top comment) -- that input's own "input"/
  // "change" listeners are gone along with the element itself; this method
  // is their only replacement, on the new #kerning-phrase-input textarea.
  async initPhraseSection() {
    const phraseInput = document.querySelector("#kerning-phrase-input");
    const presetSelect = document.querySelector("#kerning-preset-select");

    const setText = () => {
      this.sceneSettingsController.setItem("text", phraseInput.value);
    };
    phraseInput.addEventListener("input", setText);
    phraseInput.addEventListener("change", setText);

    presetSelect.addEventListener("change", () => {
      const preset = this.phrasePresets[presetSelect.selectedIndex - 1];
      if (!preset) {
        return;
      }
      phraseInput.value = preset.text;
      setText();
    });

    // Presets file format (spec §7.1) is NOT a phrase string -- it's parsed
    // by parsePhrasePresets (character-lines.js), a separate, pure parser
    // for the presets file's own name-comment-block format. Each preset's
    // own text is still, in turn, a phrase string, parsed the usual way by
    // characterLinesFromString once it lands in sceneSettings.text.
    const response = await fetch("./assets/phrase-presets.txt");
    const presetsText = await response.text();
    this.phrasePresets = parsePhrasePresets(presetsText);
    for (const preset of this.phrasePresets) {
      const option = document.createElement("option");
      option.value = preset.name;
      option.textContent = preset.name;
      presetSelect.appendChild(option);
    }
  }

  // Workstream 9, spec §7.2. `defaultOn` engine values here are placeholders
  // that get replaced once §2.4 calibration exists in this view; that's why
  // reach has no principled default yet (calibration is what settles it) and
  // gets a plainly-arbitrary starting number instead. threshold is display
  // filtering (§7.3), not an engine input, and lives here anyway because the
  // spec table (§7.2) lists it alongside the engine parameters.
  initParametersSection() {
    this.autokernParamsController = new ObservableController({
      threshold: 5,
      reach: 10,
      envelope: "distanceField",
      reduce: "sum",
      strength: 1,
    });
    this.autokernParamsController.synchronizeWithLocalStorage(
      "fontra-kerning-autokern-params."
    );
    const params = this.autokernParamsController.model;

    const bindings = [
      ["#kerning-param-threshold", "threshold", Number],
      ["#kerning-param-reach", "reach", Number],
      ["#kerning-param-envelope", "envelope", String],
      ["#kerning-param-reduce", "reduce", String],
      ["#kerning-param-strength", "strength", Number],
    ];
    for (const [selector, key, convert] of bindings) {
      const element = document.querySelector(selector);
      element.value = params[key];
      element.addEventListener("change", () => {
        this.autokernParamsController.setItem(key, convert(element.value));
      });
    }
  }

  // This workstream: the run worker (spec §4) and the Run button
  // (#kerning-run-button, previously unwired -- see the workstream-9 comment
  // above). What this method does NOT build, deliberately:
  //   - persistence (§4.1's "the cache persists between sessions") -- the
  //     cache built here is in-memory only, on this.autokernCache, and is
  //     gone on reload. IndexedDB/localStorage row storage is a separate,
  //     later workstream.
  //   - the pair table UI (§7.3) that reads this.autokernCache.
  //   - the status strip / source selector (§7.5) -- see the `source`
  //     comment below for how the job shape stays ready for it anyway.
  //   - classing UI (§5).
  //   - the calibration readout (§7.4) -- the calibration result IS kept
  //     (this.autokernCalibration), just not displayed yet.
  initRunSection() {
    this.autokernCache = new Map();
    this.autokernCalibration = null;

    const runButton = document.querySelector("#kerning-run-button");
    runButton.addEventListener("click", () => this.runAutokern());
  }

  // Rendering size: pixels at which the raster is built (spec §2.1: "derived
  // from the font's units per em so that one pixel is a few units", against
  // halfkern's fixed-100 which the spec calls too coarse). No further spec
  // constant is given, so this keeps roughly halfkern's own pixel density
  // (100px at 1000 upm) scaled to the font's actual unitsPerEm.
  get autokernRenderSize() {
    const unitsPerEm = this.fontController.unitsPerEm || 1000;
    return Math.round((unitsPerEm / 1000) * 100);
  }

  // Vertical extent shared by every raster in a run (glyph-raster.js: "so
  // two different glyphs' rasters put the same absolute vertical position on
  // the same row"). No ascender/descender metric is exposed by
  // font-controller.js today, so this is a placeholder fraction of
  // unitsPerEm, not a read font metric -- a real gap, left for whoever wires
  // §7.4/real vertical metrics, noted here rather than silently guessed at
  // without comment.
  get autokernVerticalExtent() {
    const unitsPerEm = this.fontController.unitsPerEm || 1000;
    return { yTop: unitsPerEm * 0.8, yBottom: unitsPerEm * -0.25 };
  }

  async runAutokern() {
    const params = this.autokernParamsController.model;
    const renderSize = this.autokernRenderSize;
    const unitsPerEm = this.fontController.unitsPerEm;
    const verticalExtent = this.autokernVerticalExtent;
    // Pre-calibration bias: the starting envelope reach (spec §2.4: "a
    // starting value, not a fixed one"). Rasters are padded by this bias at
    // build time (glyph-raster.js). If calibration widens the bias beyond
    // this padding, the envelope built from a too-narrow raster gets clipped
    // at its own edge -- a known, documented gap of this workstream (fixing
    // it means re-rasterizing survivors after calibration, out of scope
    // here; the search/calibration math itself is unaffected and correct on
    // whatever raster it is given).
    const bias = params.reach;

    // §4.2's excluded-glyph field is not built yet (out of scope), so no
    // glyph is excluded from this workstream's run.
    const excludedGlyphNames = [];
    const glyphNames = Object.keys(this.fontController.glyphMap || {}).filter(
      (name) => !excludedGlyphNames.includes(name)
    );

    // §7.5's source selector doesn't exist yet either, but the job still
    // carries a `source` identifier so the cache/job shape is ready for it:
    // right now there is exactly one selectable source, the font's default.
    const source = "default";

    const glyphsToRasterize = new Set([...CONTROL_GLYPH_NAMES, ...glyphNames]);
    const rasters = {};
    const envelopes = {};
    for (const glyphName of glyphsToRasterize) {
      const glyphInstance = await this.fontController.getGlyphInstance(glyphName, {});
      if (!glyphInstance) {
        continue;
      }
      const raster = rasterizeGlyph(glyphInstance, {
        renderSize,
        unitsPerEm,
        bias,
        verticalExtent,
      });
      // Structured-clone-friendly: a plain array, not the Float64Array
      // itself (Float64Array clones fine too, but the worker rebuilds its
      // own typed array either way -- see autokern-worker.js's
      // reviveRaster).
      rasters[glyphName] = { ...raster, data: Array.from(raster.data) };

      const scale = renderSize / unitsPerEm;
      const bounds = glyphInstance.controlBounds;
      envelopes[glyphName] = {
        xMin: bounds ? scale * bounds.xMin : 0,
        xMax: bounds ? scale * bounds.xMax : 0,
        advance: scale * glyphInstance.xAdvance,
      };
    }

    if (CONTROL_GLYPH_NAMES.some((name) => !rasters[name])) {
      throw new Error(
        `autokern: control glyph(s) missing from font (need ${CONTROL_GLYPH_NAMES.join(", ")})`
      );
    }

    const mode = "everything";
    const job = {
      source,
      renderSize,
      unitsPerEm,
      params,
      rasters,
      envelopes,
      controlGlyphNames: CONTROL_GLYPH_NAMES,
      glyphNames,
      mode,
      existingCache: [...this.autokernCache.entries()],
    };

    await this.runAutokernWorker(job);
  }

  // Spec §4: "A worker, with progress and cancel, shown in a popup." Reuses
  // the existing <modal-dialog> element (kerning.html) and its
  // dialogSetup/run pattern (fontra-webcomponents/modal-dialog.js), the same
  // one font-overview.js uses for its own dialogs -- no new popup mechanism
  // invented for this.
  async runAutokernWorker(job) {
    const worker = new Worker(
      /* webpackChunkName: "autokern-worker" */ new URL(
        "./autokern-worker.js",
        import.meta.url
      ),
      { type: "module" } // this worker script uses ES `import`, unlike opfs-write-worker.js
    );

    const progressContent = document.createElement("div");
    progressContent.textContent = "Starting…";

    const dialog = await dialogSetup(
      "Running autokern",
      null,
      [{ title: "Cancel", resultValue: "cancel", isCancelButton: true }]
    );
    dialog.setContent(progressContent);

    const runResult = new Promise((resolve) => {
      worker.onmessage = (event) => {
        const data = event.data;
        if (data.type === "progress") {
          progressContent.textContent = `Measuring pairs: ${data.done} / ${data.total}`;
        } else if (data.type === "calibration") {
          this.autokernCalibration = data.calibration;
        } else if (data.type === "done") {
          this.autokernCache = new Map(data.cache);
          this.autokernCalibration = data.calibration;
          resolve("done");
        } else if (data.type === "cancelled") {
          resolve("cancelled");
        } else if (data.type === "error") {
          console.error("autokern worker error:", data.error);
          resolve("error");
        }
      };
      worker.onerror = (event) => {
        console.error("autokern worker error:", event);
        resolve("error");
      };
    });

    worker.postMessage({ type: "run", job });

    // Two ways this popup closes: the designer clicks Cancel/Escape (the
    // dialog's own run() promise resolves first), or the worker finishes or
    // errors out on its own (runResult resolves first). Race them; whichever
    // wins drives the other to a close so neither promise is left dangling.
    const dialogRunPromise = dialog.run();
    const outcome = await Promise.race([
      dialogRunPromise.then((result) =>
        result === "cancel" || result === null ? "cancel-clicked" : result
      ),
      runResult,
    ]);

    if (outcome === "cancel-clicked") {
      worker.postMessage({ type: "cancel" });
      await runResult; // wait for the worker to actually acknowledge cancellation
      dialog.cancel();
      worker.terminate();
      return "cancelled";
    }

    // The worker finished (done/cancelled/error) before the designer clicked
    // anything -- close the still-open dialog ourselves.
    dialog.cancel();
    worker.terminate();
    return outcome;
  }

  setSelectedTool(toolIdentifier) {
    this.selectedToolIdentifier = toolIdentifier;
    this.sceneController.setSelectedTool(this.tools[toolIdentifier]);
    for (const button of document.querySelectorAll("[data-tool]")) {
      // Inline style rather than a CSS rule, to keep this workstream's touch
      // confined to kerning.js/kerning.html/edit-tools-select.js.
      button.style.fontWeight = button.dataset.tool === toolIdentifier ? "bold" : "";
    }
  }

  initToolSwitcher() {
    for (const button of document.querySelectorAll("[data-tool]")) {
      button.addEventListener("click", () => this.setSelectedTool(button.dataset.tool));
    }
  }

  // Number-key tool shortcuts (mirrors editor.js: each tool gets its 1-based
  // position among the tools as a default key) and hold-space-for-hand-tool
  // (the same mechanism as editor.js's action.canvas.clean-view-and-hand-tool,
  // minus the "clean view" part -- there is no sidebar chrome here to hide).
  initToolShortcuts() {
    const topic = "0020-action-topics.menu.view";

    Object.keys(this.tools).forEach((toolIdentifier, index) => {
      registerAction(
        `actions.kerning.tools.${toolIdentifier}`,
        {
          topic,
          titleKey: `editor.${toolIdentifier}`,
          defaultShortCuts: [{ baseKey: `${index + 1}` }],
        },
        () => this.setSelectedTool(toolIdentifier)
      );
    });

    registerAction(
      "action.kerning.hold-hand-tool",
      {
        topic,
        titleKey: "kerning.hold-hand-tool",
        // Matches Space with any modifier combination, same hack editor.js
        // uses, so a stray Shift/Alt/Meta/Ctrl held alongside Space doesn't
        // stop this from firing.
        defaultShortCuts: [...Array(1 << 4).keys()].map((i) => ({
          baseKey: "Space",
          altKey: !!(i & 0x01),
          shiftKey: !!(i & 0x02),
          metaKey: !!(i & 0x04),
          ctrlKey: !!(i & 0x08),
        })),
      },
      (event) => this.enterTemporaryHandTool(event)
    );
  }

  keyDownHandler(event) {
    const actionIdentifier = getActionIdentifierFromKeyEvent(event);
    if (actionIdentifier) {
      event.preventDefault();
      doPerformAction(actionIdentifier, event);
    }
  }

  keyUpHandler(event) {
    if (
      this._matchingKeyUpHandler &&
      // At least on macOS, in Chrome and Safari, if the space key is held
      // when Meta is additionally pressed, no keyup ever arrives for space
      // itself -- so also respond to a keyup for Meta (event.metaKey reads
      // false by then, hence checking event.key instead). Same quirk
      // editor.js works around.
      (this._matchingKeyUpHandler.code == event.code || event.key == "Meta")
    ) {
      this._matchingKeyUpHandler.callback(event);
      delete this._matchingKeyUpHandler;
    }
  }

  enterTemporaryHandTool(event) {
    this.savedSelectedToolIdentifier = this.selectedToolIdentifier;
    this.setSelectedTool("hand-tool");
    this._matchingKeyUpHandler = {
      code: event.code,
      callback: () => this.leaveTemporaryHandTool(),
    };
  }

  leaveTemporaryHandTool() {
    this.setSelectedTool(this.savedSelectedToolIdentifier);
    delete this.savedSelectedToolIdentifier;
  }

  canvasMagnificationChanged(magnification) {
    this.visualizationLayers.scaleFactor = 1 / magnification;
  }

  get isThemeDark() {
    const themeValue = themeController.model.theme;
    if (themeValue === "automatic") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
      return themeValue === "dark";
    }
  }
}

// A copy of editor.js's (unexported) newVisualizationLayersSettings, with our
// own localStorage prefix -- sharing the editor's key would let this view's
// layer toggles bleed into the editor's and vice versa.
function newVisualizationLayersSettings(visualizationLayers) {
  const settings = [];
  for (const definition of visualizationLayers.definitions) {
    if (!definition.userSwitchable) {
      continue;
    }
    if (!(definition.identifier in settings)) {
      settings[definition.identifier] = !!definition.defaultOn;
    }
  }
  const controller = new ObservableController(settings);
  controller.synchronizeWithLocalStorage("fontra-kerning-visualization-layers.");
  for (const [key, onOff] of Object.entries(controller.model)) {
    visualizationLayers.toggle(key, onOff);
  }
  return controller;
}
