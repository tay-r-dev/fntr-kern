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
//
// WORKSTREAM 11 adds §7.3's pair table: a glyph field (overridden by the
// left pane's single-glyph selection via sceneSettings.selectedGlyphName),
// three sections (side-1-class-vs-every-side-2-class,
// every-side-1-class-vs-side-2-class, flat/unclassed), reading classes only
// from what's already stored (kerningController.leftPairGroupMapping /
// rightPairGroupMapping, i.e. groupsSide1/groupsSide2 -- NOT §5.3
// derivation), every filter named in §7.3 (side, grouping, sign, state,
// junk, plus the existing threshold control), an excluded-glyph field
// (stored only, not wired into a rerun -- runAutokern above has no
// excluded-glyph parameter to wire into), and the five actions (apply
// selected, apply all with a second-press confirm, reset to current, reset
// to zero, mark junk). Deliberately NOT built here: §5.2's fold (every row
// stays one flat pair; "apply" therefore always writes a flat exception,
// never a class cell -- see the writePairValues comment), §5.3 derivation,
// §7.4 calibration readout, §7.5 status strip. See applyPairs's own comment
// for the honest state of undo: this writes real, broadcast, persisted font
// kerning data through the exact path editor.js's kerning tool uses
// (kerningController.getEditContext(...).edit(...) ->
// fontController.editFinal), but does NOT reach this view's own undo stack,
// because this view has none (see the workstream comments above -- no undo
// mechanism exists in kerning.js at all yet).
import { markPairJunk, pairKey } from "@fontra/core/autokern-cache.js";
import {
  classSpread,
  deriveKernRowClusters,
  inheritCompositeClasses,
} from "@fontra/core/autokern-classes.js";
import {
  doPerformAction,
  getActionIdentifierFromKeyEvent,
  registerAction,
} from "@fontra/core/actions.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { CanvasController } from "@fontra/core/canvas-controller.js";
import {
  characterLinesFromString,
  parsePhrasePresets,
} from "@fontra/core/character-lines.js";
import {
  getGlyphInfoFromCodePoint,
  getGlyphInfoFromGlyphName,
} from "@fontra/core/glyph-data.js";
import { rasterizeGlyph } from "@fontra/core/glyph-raster.js";
import { script as scriptOfCodePoint } from "@fontra/core/unicode-scripts-blocks.js";
import { ObservableController } from "@fontra/core/observable-object.ts";
import { getOPFS } from "@fontra/core/opfs.js";
import { SceneView } from "@fontra/core/scene-view.js";
import { themeController } from "@fontra/core/theme-settings.js";
import { ViewController } from "@fontra/core/view-controller.js";
import { dialogSetup, message } from "@fontra/web-components/modal-dialog.js";
import { HandTool } from "@fontra/views-editor/edit-tools-hand.js";
import {
  KerningTool,
  SidebearingTool,
} from "@fontra/views-editor/edit-tools-metrics.js";
import { SceneController } from "@fontra/views-editor/scene-controller.js";
import { visualizationLayerDefinitions } from "@fontra/views-editor/visualization-layer-definitions.js";
import {
  VisualizationContext,
  VisualizationLayers,
} from "@fontra/views-editor/visualization-layers.js";
import { SelectTool } from "./edit-tools-select.js";

// Spec §2.4: the three control glyphs calibration reads.
const CONTROL_GLYPH_NAMES = ["l", "n", "o"];

// WORKSTREAM 12, spec §4.1: "Derived data is stored locally; decisions are
// stored in the project." Two separate mechanisms follow from that one
// sentence, and they are not interchangeable:
//
// - The cache itself (this.autokernCache's contents) is derived, large, and
//   always recomputable from a run -- it is machine-local, browser-side
//   storage, keyed by font + source. OPFS is the established pattern for
//   this in this codebase (fontra-core/opfs.js, used the same way by
//   views-editor/panel-reference-font.js for dropped reference font files:
//   "browser-side storage" for something derived/large/per-something). No
//   IndexedDB usage exists anywhere in this tree to imitate instead (grepped
//   the whole src-js tree for indexedDB/IDBDatabase; nothing), so OPFS,
//   already imported above, is reused rather than inventing a second
//   browser-storage mechanism.
// - Junk marks and the excluded-glyph list are the designer's judgement,
//   small, and must survive a change of machine (spec §4.1) -- they go
//   through the font backend as ordinary per-font customData, the exact
//   mechanism glyphsets-controller.js's PROJECT_GLYPH_SETS_CUSTOM_DATA_KEY
//   already uses for a different piece of project-level designer data:
//   fontController.performEdit(editLabel, "customData", (root) => { ...
//   root.customData[KEY] = value ... }, senderID) to write, and
//   fontController.customData[KEY] to read (font-controller.js:151-153,
//   populated from the backend's getCustomData() at initialize() time --
//   font-controller.js:84 -- i.e. already loaded before this view's
//   constructor runs, since ViewController.start() awaits
//   fontController.initialize() before the view is constructed).
const AUTOKERN_CACHE_OPFS_DIR = ["kerning-autokern-cache"];
const AUTOKERN_JUNK_PAIRS_CUSTOM_DATA_KEY = "fontra.autokernJunkPairs";
const AUTOKERN_EXCLUDED_GLYPHS_CUSTOM_DATA_KEY = "fontra.autokernExcludedGlyphs";

let _autokernOPFS;
async function getAutokernOPFS() {
  if (!_autokernOPFS) {
    _autokernOPFS = await getOPFS();
  }
  return _autokernOPFS;
}

// One cache file per font + source (spec §4.1: "the cache is keyed by
// source"). `projectIdentifier` stands in for "font identity" here -- it's
// the same identifier ViewController.fromBackend() reads from the `project`
// URL parameter and passes into every view's constructor, so it already
// distinguishes one font/project from another the same way the rest of the
// app does. encodeURIComponent guards against a project identifier that
// isn't a bare filesystem-safe token (it can be a path).
function autokernCacheFileName(projectIdentifier, source) {
  return `${encodeURIComponent(projectIdentifier || "")}--${encodeURIComponent(source)}.json`;
}

// Returns a plain array of cache entries, or null if nothing is stored yet
// (never-run font, first session on this machine, or an unreadable/corrupt
// file) -- the caller's job in that case is to "start with an empty cache
// exactly as today" (workstream 12 brief), which is what an untouched
// this.autokernCache already is.
async function readAutokernCacheFromOPFS(projectIdentifier, source) {
  const opfs = await getAutokernOPFS();
  try {
    const file = await opfs.readFile([
      ...AUTOKERN_CACHE_OPFS_DIR,
      autokernCacheFileName(projectIdentifier, source),
    ]);
    return JSON.parse(await file.text());
  } catch (e) {
    return null;
  }
}

async function writeAutokernCacheToOPFS(projectIdentifier, source, cache) {
  const opfs = await getAutokernOPFS();
  await opfs.createDirectory(AUTOKERN_CACHE_OPFS_DIR);
  const entries = [...cache.values()];
  const blob = new Blob([JSON.stringify(entries)], { type: "application/json" });
  await opfs.writeFile(
    [...AUTOKERN_CACHE_OPFS_DIR, autokernCacheFileName(projectIdentifier, source)],
    blob
  );
}

export class KerningViewController extends ViewController {
  constructor(font, projectIdentifier) {
    super(font, projectIdentifier);

    // Construction order below follows EditorController's constructor in
    // views-editor/src/editor.js (roughly lines 153-260), minus everything
    // that view does beyond the scene: no sidebars, no other tools, no
    // undo, no double-click handling, no CJK design frame.

    // Workstream 17: the id is "edit-canvas", not "kerning-canvas" -- see
    // the comment on the canvas element in kerning.html.
    const canvas = document.querySelector("#edit-canvas");
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
    //
    // WORKSTREAM 17, spec §6: "Four tools only: pointer, sidebearing,
    // kerning, hand... The sidebearing tool edits a glyph layer, so this view
    // carries the glyph edit path and its undo beside the kerning one."
    // SidebearingTool and KerningTool are edit-tools-metrics.js's own
    // classes, constructed exactly as editor.js's addEditTool constructs
    // them for MetricsTool's subTools (`new subToolClass(this)`, `this`
    // being the controller/editor object) -- reused, not copied (spec §8).
    this.tools = {};
    for (const tool of [
      new SelectTool(this),
      new SidebearingTool(this),
      new KerningTool(this),
      new HandTool(this),
    ]) {
      this.tools[tool.identifier] = tool;
    }
    this.setSelectedTool("pointer-tool");

    this.initToolSwitcher();
    this.initChipSection();
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

  // ViewController.fromBackend() constructs the controller (`new this(...)`)
  // and only AFTER that awaits start(), which is what actually calls
  // fontController.initialize() (see ViewController.start() in
  // view-controller.js). Reading font data -- customData, sources,
  // defaultSourceIdentifier, anything on fontController that isn't just the
  // font/projectIdentifier passed to the constructor -- from inside the
  // constructor throws, because fontController._rootObject doesn't exist
  // yet. editor.js follows the same rule: its own start() override does
  // `await super.start()` before touching anything font-shaped. This was a
  // real bug (workstreams 12 and 14 put font-data reads straight in the
  // constructor) that crashed every kerning-view page load; fixed by moving
  // all of it here.
  async start() {
    await super.start();

    // Spec §4.1/§7.5: "the source is chosen in the status strip".
    // this.autokernSource (getter below) reads this field, and
    // initRunSection's loadAutokernCacheFromStorage reads that getter -- so
    // this must be set before initRunSection runs.
    // this.fontController.defaultSourceIdentifier is the same "no explicit
    // choice yet" default panel-designspace-navigation.js's own source list
    // falls back to.
    this._autokernSourceIdentifier = this.fontController.defaultSourceIdentifier;

    this.initPhraseSection();
    this.initParametersSection();
    this.initRunSection();
    this.initPairTableSection();
    this.initAutokernStatusSection();
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
    this.phraseInputElement = phraseInput;

    // WORKSTREAM 16, spec §6: "switching back to `phrase` restores what was
    // typed, which is not destroyed." The chip selector (initChipSection)
    // owns the scene text while its mode is "pair" -- the phrase textarea
    // itself is never written to by pair mode (see selectPairForScene
    // below), so its own value survives untouched. This guard is what keeps
    // ordinary typing here from clobbering the pair's scene text while pair
    // mode is active; setChipMode reapplies phraseInput.value verbatim the
    // moment the chip flips back to "phrase".
    const setText = () => {
      if (this._chipMode === "pair") {
        return;
      }
      this.sceneSettingsController.setItem("text", phraseInput.value);
    };
    this.applyPhraseText = setText;
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

    // Threshold filters the pair table's display (spec §7.2: "filters the
    // display, on the delta"), not just the run -- re-render on every
    // change, including scrubs from other bound copies of the control.
    this.autokernParamsController.addKeyListener("threshold", () => {
      this.renderPairTable();
    });
  }

  // This workstream: the run worker (spec §4) and the Run button
  // (#kerning-run-button, previously unwired -- see the workstream-9 comment
  // above).
  //
  // WORKSTREAM 12 adds persistence (§4.1's "the cache persists between
  // sessions"): this.autokernCache is written to browser-side storage
  // (OPFS, see the file-top comment) on every successful run and read back
  // on load, before the designer clicks Run. Junk marks and the
  // excluded-glyph list persist separately, through the font backend as
  // project customData -- see togglePairJunk and the excluded-glyph input's
  // "change" listener in initPairTableSection.
  //
  // What this method still does NOT build, deliberately:
  //   - the pair table UI (§7.3) that reads this.autokernCache.
  //   - the status strip / source selector (§7.5) -- see the `autokernSource`
  //     getter below for how the job shape stays ready for it anyway.
  //   - classing UI (§5).
  //   - the calibration readout (§7.4) is now built -- see renderCalibration
  //     below, called here (initial "not yet calibrated" state) and again
  //     whenever this.autokernCalibration changes.
  initRunSection() {
    this.autokernCache = new Map();
    this.autokernCalibration = null;
    this.renderCalibration();

    const runButton = document.querySelector("#kerning-run-button");
    runButton.addEventListener("click", () =>
      this.runAutokern().catch((error) => {
        console.error(error);
        message("Autokern run failed", error.message || String(error));
      })
    );

    // Fire-and-forget: this.autokernCache is already a valid (empty) Map
    // synchronously above, so nothing else in this constructor waits on the
    // load. loadAutokernCacheFromStorage re-renders the pair table itself
    // once it resolves, whether or not the pair table's own init has run
    // yet (renderPairTable no-ops until its own preconditions are met, see
    // its comment below).
    this.loadAutokernCacheFromStorage();
  }

  // WORKSTREAM 14, spec §7.5: the source selector is real now, and this
  // getter reads the identifier it set (this._autokernSourceIdentifier,
  // constructor above / initAutokernStatusSection below). Still centralized
  // here so the cache's read path (loadAutokernCacheFromStorage) and its
  // write path (runAutokern) can never disagree about which source they
  // mean.
  get autokernSource() {
    return this._autokernSourceIdentifier;
  }

  // Spec §4.1: "The cache persists between sessions. It is expensive enough
  // to rebuild that a session should not start by rebuilding it." Read path:
  // OPFS -> plain array of entries -> a fresh Map keyed by pairKey(left,
  // right), the exact shape autokern-cache.js's own functions expect and
  // produce (mirrors how runAutokernWorker's "done" handler builds
  // this.autokernCache from the worker's own [...cache.entries()] array).
  // Then overlay the project's own junk marks (see
  // applyStoredJunkMarksToCache) so a cache that predates a junk mark made
  // on a DIFFERENT machine still shows it correctly -- the junk mark is
  // project data and outranks whatever the browser-local cache file itself
  // says about that pair's `junk` flag.
  async loadAutokernCacheFromStorage() {
    const entries = await readAutokernCacheFromOPFS(
      this.projectIdentifier,
      this.autokernSource
    );
    // No file for this source (never run) must reset to empty, not leave
    // whatever source was loaded previously on screen under the new label.
    this.autokernCache = entries
      ? new Map(entries.map((entry) => [pairKey(entry.left, entry.right), entry]))
      : new Map();
    this.autokernCache = this.applyStoredJunkMarksToCache(this.autokernCache);
    this.renderPairTable();
  }

  // Write path, called after every successful run (runAutokernWorker's
  // "done" handler) and after every junk-mark toggle (togglePairJunk), so
  // the browser-side cache file never falls out of sync with
  // this.autokernCache between the two events a reload could happen after.
  async writeAutokernCacheToStorage() {
    await writeAutokernCacheToOPFS(
      this.projectIdentifier,
      this.autokernSource,
      this.autokernCache
    );
  }

  // Overlays the project's stored junk-pair list (customData, see the
  // file-top comment) onto `cache`, via autokern-cache.js's own
  // markPairJunk (pure, returns a new Map -- `cache` itself is never
  // mutated). A pair the project marks junk that this browser's cache has
  // never seen still gets an entry (markPairJunk's own documented behavior:
  // "if the pair has no existing entry, one is created... with value: 0"),
  // so the mark is never silently dropped for a pair not yet measured here.
  applyStoredJunkMarksToCache(cache) {
    const junkPairs =
      this.fontController.customData?.[AUTOKERN_JUNK_PAIRS_CUSTOM_DATA_KEY] || [];
    let result = cache;
    for (const { left, right } of junkPairs) {
      result = markPairJunk(result, left, right, true);
    }
    return result;
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

    // WORKSTREAM 14: §7.5's source selector now sets this.autokernSource
    // (see the getter above); the job's `source` field, and the OPFS cache
    // file this run writes to (writeAutokernCacheToStorage), both follow it.
    const source = this.autokernSource;

    // Spec §2.4: calibration needs l, n and o. Check before doing any
    // rasterization work, and surface it to the designer instead of an
    // uncaught exception -- a font that's missing one of these (a test
    // project, an in-progress alphabet) is a real, expected state, not a
    // bug.
    const missingControlGlyphs = CONTROL_GLYPH_NAMES.filter(
      (name) => !this.fontController.glyphMap?.[name]
    );
    if (missingControlGlyphs.length) {
      await message(
        "Can't run autokern",
        `The font is missing the control glyph(s) calibration needs: ${missingControlGlyphs.join(
          ", "
        )}. Add ${missingControlGlyphs.length > 1 ? "them" : "it"} to the font first.`
      );
      return;
    }

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
      // params is ObservableController's model, which is a Proxy
      // (observable-object.ts's newModelProxy) -- postMessage's structured
      // clone algorithm cannot clone a Proxy ("Proxy object could not be
      // cloned"). Spread it into a plain object of the same values.
      params: { ...params },
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
      worker.onmessage = async (event) => {
        const data = event.data;
        if (data.type === "progress") {
          progressContent.textContent = `Measuring pairs: ${data.done} / ${data.total}`;
        } else if (data.type === "calibration") {
          this.autokernCalibration = data.calibration;
          this.renderCalibration();
        } else if (data.type === "done") {
          this.autokernCache = new Map(data.cache);
          // The worker's own cache already carries forward whatever junk
          // flags this.autokernCache had when the job was built (it never
          // re-measures a junk pair, see autokern-cache.js's
          // pairsForRerun), but overlay the project's junk list again
          // anyway -- cheap, and it means a run is never the one place that
          // could silently drop a project-level junk mark.
          this.autokernCache = this.applyStoredJunkMarksToCache(this.autokernCache);
          this.autokernCalibration = data.calibration;
          this.renderPairTable();
          this.renderCalibration();
          // Spec §4.1: "A run measures and writes one source" -- write path
          // for the browser-side cache (see the file-top comment).
          await this.writeAutokernCacheToStorage();
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

  // WORKSTREAM 11, spec §7.3. See the file-top comment for the overall scope
  // of this workstream.
  async initPairTableSection() {
    // Real KerningController for this font's "kern" table -- the same one
    // panel-selection-info.js and edit-tools-metrics.js use, obtained the
    // same way (fontController.getKerningController(kernTag), cached
    // per-tag by font-controller.js). Its leftPairGroupMapping /
    // rightPairGroupMapping are groupsSide1/groupsSide2 already resolved
    // glyph -> class name (kerning-controller.js's own
    // makeGlyphGroupMapping), which is exactly "read existing stored
    // classes only" -- nothing here derives or assigns a class.
    this.kerningController = await this.fontController.getKerningController("kern");

    // Per-pair "was this row's suggestion applied this session" (spec §7.3's
    // "state" filter's "applied" bucket). In-memory only, like
    // this.autokernCache itself -- no persistence workstream exists for
    // this yet either, so this Set (and therefore the "applied" state) is
    // lost on reload, same honesty as the WORKSTREAM 10 comment above about
    // this.autokernCache.
    this.autokernAppliedPairs = new Set();

    this.autokernFiltersController = new ObservableController({
      glyphName: "",
      excludedGlyphs: "",
      side: "both",
      grouping: "both",
      sign: "both",
      state: "pending",
      showJunk: false,
      showCurrent: false,
      sortAlphabetical: false,
      // WORKSTREAM 15, spec §5.2: "A toggle above the table folds every row
      // whose pair resolves to the same cell into one parent." Off by
      // default so this workstream never changes the existing flat-row
      // behaviour unless the designer opts in.
      foldClasses: false,
    });
    this.autokernFiltersController.synchronizeWithLocalStorage(
      "fontra-kerning-pairtable-filters."
    );
    const filters = this.autokernFiltersController.model;

    const glyphInput = document.querySelector("#kerning-pairtable-glyph");
    glyphInput.value = filters.glyphName;
    glyphInput.addEventListener("input", () => {
      this.autokernFiltersController.setItem("glyphName", glyphInput.value.trim());
    });

    // Left-pane selection override (spec §7.3: "A glyph input, overridden by
    // the selection in the left pane"). Traced: scene-controller.js sets
    // sceneSettings.selectedGlyphName to the single selected glyph's name
    // whenever the selection resolves to exactly one glyph, and to null
    // otherwise (scene-controller.js, the "Set up convenience property
    // selectedGlyphName" comment, ~line 287). This view already owns
    // this.sceneSettingsController (constructor above, shared with the left
    // pane's scene). Only override on an actual single-glyph selection --
    // clearing the selection leaves whatever the designer typed alone
    // rather than blanking the field.
    this.sceneSettingsController.addKeyListener("selectedGlyphName", (event) => {
      if (event.newValue) {
        glyphInput.value = event.newValue;
        this.autokernFiltersController.setItem("glyphName", event.newValue);
      }
    });

    const excludedInput = document.querySelector("#kerning-pairtable-excluded");
    // WORKSTREAM 12, spec §4.1/§4.2: the excluded-glyph list is the
    // designer's judgement, not derived data, so it must survive a change
    // of machine -- the project's own customData (read here from
    // this.fontController.customData, already populated before this view's
    // constructor runs, see the file-top comment) is authoritative over
    // whatever localStorage happened to sync onto THIS machine via
    // `filters.excludedGlyphs` above.
    const storedExcludedGlyphs =
      this.fontController.customData?.[AUTOKERN_EXCLUDED_GLYPHS_CUSTOM_DATA_KEY];
    const initialExcludedGlyphs =
      storedExcludedGlyphs !== undefined ? storedExcludedGlyphs : filters.excludedGlyphs;
    excludedInput.value = initialExcludedGlyphs;
    if (initialExcludedGlyphs !== filters.excludedGlyphs) {
      this.autokernFiltersController.setItem("excludedGlyphs", initialExcludedGlyphs);
    }
    excludedInput.addEventListener("change", async () => {
      // Stored on the controller (as before) AND, new in workstream 12,
      // written through to the project (see the file-top comment for the
      // exact mechanism). Still NOT wired into runAutokern's
      // excludedGlyphNames above: that method hardcodes
      // `excludedGlyphNames = []` with its own comment ("§4.2's
      // excluded-glyph field is not built yet"), so there is no rerun
      // interface here to plug into without guessing at one -- exactly the
      // brief's instruction not to half-wire it. Persisting the FIELD's
      // value is a separate concern from wiring it into a run.
      this.autokernFiltersController.setItem("excludedGlyphs", excludedInput.value);
      await this.fontController.performEdit(
        "kerning view: edit excluded glyphs",
        "customData",
        (root) => {
          if (excludedInput.value) {
            root.customData[AUTOKERN_EXCLUDED_GLYPHS_CUSTOM_DATA_KEY] = excludedInput.value;
          } else {
            delete root.customData[AUTOKERN_EXCLUDED_GLYPHS_CUSTOM_DATA_KEY];
          }
        },
        this
      );
    });

    const selectBindings = [
      ["#kerning-pairtable-filter-side", "side"],
      ["#kerning-pairtable-filter-grouping", "grouping"],
      ["#kerning-pairtable-filter-sign", "sign"],
      ["#kerning-pairtable-filter-state", "state"],
    ];
    for (const [selector, key] of selectBindings) {
      const element = document.querySelector(selector);
      element.value = filters[key];
      element.addEventListener("change", () => {
        this.autokernFiltersController.setItem(key, element.value);
      });
    }

    const junkCheckbox = document.querySelector("#kerning-pairtable-filter-junk");
    junkCheckbox.checked = filters.showJunk;
    junkCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem("showJunk", junkCheckbox.checked);
    });

    const currentCheckbox = document.querySelector("#kerning-pairtable-show-current");
    currentCheckbox.checked = filters.showCurrent;
    currentCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem("showCurrent", currentCheckbox.checked);
    });

    // WORKSTREAM 15, spec §5.2. See renderPairTable/buildFoldGroups for the
    // fold logic itself; this checkbox only toggles it.
    const foldCheckbox = document.querySelector("#kerning-pairtable-fold-classes");
    foldCheckbox.checked = filters.foldClasses;
    foldCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem("foldClasses", foldCheckbox.checked);
    });

    const sortButton = document.querySelector("#kerning-pairtable-sort-toggle");
    const updateSortButtonLabel = () => {
      sortButton.textContent = this.autokernFiltersController.model.sortAlphabetical
        ? "Sort: alphabetical"
        : "Sort: worst delta first";
    };
    updateSortButtonLabel();
    sortButton.addEventListener("click", () => {
      this.autokernFiltersController.setItem(
        "sortAlphabetical",
        !this.autokernFiltersController.model.sortAlphabetical
      );
      updateSortButtonLabel();
    });

    this.autokernFiltersController.addListener(() => this.renderPairTable());

    document
      .querySelector("#kerning-pairtable-apply-selected")
      .addEventListener("click", () => this.applySelectedPairRows());

    const applyAllButton = document.querySelector("#kerning-pairtable-apply-all");
    this._applyAllArmed = false;
    this._applyAllDefaultLabel = applyAllButton.textContent;
    applyAllButton.addEventListener("click", () => this.applyAllPairRows(applyAllButton));

    document
      .querySelector("#kerning-pairtable-reset-current")
      .addEventListener("click", () => this.resetSelectedPairRows("current"));
    document
      .querySelector("#kerning-pairtable-reset-zero")
      .addEventListener("click", () => this.resetSelectedPairRows("zero"));

    // WORKSTREAM 15, spec §5.3: "The derive action sits beside the fold
    // toggle." this.autokernDeriveProposals holds nothing until Derive is
    // clicked, and stays empty (writes nothing) until a proposal is
    // individually accepted -- see deriveClasses/renderDeriveProposals/
    // acceptDeriveProposal below.
    this.autokernDeriveProposals = [];
    document
      .querySelector("#kerning-derive-button")
      .addEventListener("click", () => this.deriveClasses());

    this.renderPairTable();
  }

  // Parses the excluded-glyph field the same way the phrase field is parsed
  // (spec §4.2: "parsed the same way as the phrase field, so a glyph with no
  // character can be named directly") -- reusing characterLinesFromString
  // (character-lines.js) rather than a bespoke splitter, by turning each
  // comma/space-separated token into a "/glyphname" reference the same way
  // the phrase field's own /glyphname syntax works, then reading back each
  // token's resolved glyphName. A token naming a glyph that exists in the
  // font's glyphMap comes back unchanged (character-lines.js only rewrites
  // glyphName when the literal name is NOT in glyphMap, via its
  // expandGlyphName fallback) -- so a glyph with no character still names
  // itself directly, per spec.
  parseExcludedGlyphNames(text) {
    const tokens = (text || "").split(/[\s,]+/).filter((token) => token.length > 0);
    if (!tokens.length) {
      return [];
    }
    const asPhrase = tokens.map((token) => `/${token}`).join(" ");
    const characterLines = characterLinesFromString(
      asPhrase,
      this.fontController.characterMap,
      this.fontController.glyphMap,
      {},
      {},
      undefined
    );
    const names = [];
    for (const line of characterLines) {
      for (const info of line) {
        if (info.glyphName) {
          names.push(info.glyphName);
        }
      }
    }
    return names;
  }

  // Builds the display row for one cache entry: reads the font's actually
  // stored kerning for this exact glyph pair (resolved through classes the
  // same way any other consumer reads kerning -- getGlyphPairValueForLocation
  // uses kerning-controller.js's own getPairsToTry cascade, spec §5.1's
  // [glyph,glyph] -> [glyph,@class] -> [@class,glyph] -> [@class,@class]
  // order), at the default (non-variable) location `{}` -- this view has no
  // design-space location control, so there is only ever the one location to
  // read. `delta` is the suggestion minus that stored value (spec §7.3: "The
  // delta is the suggestion minus what is stored"), with no stored value
  // read as 0.
  pairRowData(entry, classed) {
    const current =
      this.kerningController.getGlyphPairValueForLocation(entry.left, entry.right, {}) ??
      0;
    return {
      left: entry.left,
      right: entry.right,
      suggestion: entry.value,
      current,
      delta: entry.value - current,
      junk: entry.junk,
      stale: entry.stale,
      classed,
    };
  }

  // Every filter named in spec §7.3, composed with the threshold (§7.2: "the
  // threshold... filters the display, not the run"). Returns false the
  // moment any active filter rejects the row -- order doesn't matter, all
  // are independent AND conditions.
  pairRowVisible(row, filters, threshold, glyphName) {
    if (row.junk && !filters.showJunk) {
      return false;
    }
    if (!this.isRowAboveThreshold(row, threshold)) {
      return false;
    }
    if (filters.side === "left" && row.left !== glyphName) {
      return false;
    }
    if (filters.side === "right" && row.right !== glyphName) {
      return false;
    }
    if (filters.grouping === "classed" && !row.classed) {
      return false;
    }
    if (filters.grouping === "flat" && row.classed) {
      return false;
    }
    if (filters.sign === "negative" && !(row.delta < 0)) {
      return false;
    }
    if (filters.sign === "positive" && !(row.delta > 0)) {
      return false;
    }

    const applied = this.autokernAppliedPairs.has(pairKey(row.left, row.right));
    if (filters.state === "applied" && !applied) {
      return false;
    }
    if (filters.state === "stale" && !row.stale) {
      return false;
    }
    if (filters.state === "pending" && (applied || row.stale)) {
      return false;
    }

    return true;
  }

  // WORKSTREAM 14: the pair table's own threshold comparison (spec §7.2:
  // "filters the display, on the delta"), pulled out to a standalone method
  // so the status strip's "pairs above the threshold" count (§7.5) uses the
  // exact same abs-value comparison rather than a second, possibly-diverging
  // copy of it.
  isRowAboveThreshold(row, threshold) {
    return Math.abs(row.delta) >= threshold;
  }

  // WORKSTREAM 14: whether one cache entry counts as "classed" -- both
  // glyphs resolve into a class on the relevant side (spec §7.3's sections 1
  // and 2, as opposed to section 3's flat/unclassed). Pulled out of
  // renderPairTable's per-glyph section assignment below (which is anchored
  // to whichever glyph is in the field) so the status strip's font-wide
  // classed-vs-flat coverage count (§7.5) reads the SAME classification, not
  // a second copy of it that could diverge. See renderPairTable's own
  // comment for why section 1's "glyphName has a side-1 class, right glyph
  // has a side-2 class" and section 2's mirror of that are, underneath, the
  // one condition below: both sides of the pair resolve through a class.
  isEntryClassed(entry) {
    return (
      !!this.kerningController.leftPairGroupMapping[entry.left] &&
      !!this.kerningController.rightPairGroupMapping[entry.right]
    );
  }

  // Rebuilds all three <tbody> elements from this.autokernCache. Called on
  // every filter change, every threshold change, and once a run finishes.
  // Guards on missing state (this.autokernCache is set synchronously by
  // initRunSection, but this.kerningController/this.autokernFiltersController
  // are set asynchronously by initPairTableSection, and the threshold
  // listener in initParametersSection can fire before that promise settles)
  // by simply doing nothing until every piece exists.
  renderPairTable() {
    const bodies = [1, 2, 3].map((n) =>
      document.querySelector(`#kerning-pairtable-body-${n}`)
    );
    if (!this.autokernCache || !this.kerningController || !this.autokernFiltersController) {
      return;
    }

    // WORKSTREAM 14, spec §7.5: called from every place renderPairTable
    // already is (this method's own callers -- see this method's top
    // comment), so the status strip's counts never go stale relative to
    // what's on screen.
    this.renderAutokernStatus();

    const filters = this.autokernFiltersController.model;
    const threshold = this.autokernParamsController.model.threshold;
    const glyphName = filters.glyphName;

    for (const body of bodies) {
      body.textContent = "";
    }

    for (const el of document.querySelectorAll(".kerning-pairtable-current-col")) {
      el.style.display = filters.showCurrent ? "" : "none";
    }

    if (!glyphName) {
      return;
    }

    // Spec §7.3: "its side-1 class against every side-2 class" / "every
    // side-1 class against its side-2 class" / "flat rows for whatever is
    // unclassed on either side". No fold (§5.2 is out of scope): each cache
    // entry is still its own row, just sorted into one of the three
    // sections below by which of the glyph's two class memberships (if
    // either) the pair actually uses -- spec §7.3: "A glyph has two class
    // memberships and they are different lists. Sections 1 and 2 are not
    // redundant."
    //   Section 1: glyphName is the LEFT member, glyphName has a side-1
    //     class, and the RIGHT glyph has a side-2 class (both sides of the
    //     pair resolve through a class).
    //   Section 2: glyphName is the RIGHT member, glyphName has a side-2
    //     class, and the LEFT glyph has a side-1 class.
    //   Section 3: everything else touching glyphName (either member is
    //     unclassed on the relevant side) -- flat/unclassed.
    // WORKSTREAM 14: the "both sides resolve through a class" test itself is
    // isEntryClassed (above) -- section 1 vs section 2 here is only about
    // which side of the pair equals glyphName, not a different classed
    // test.
    const rowsBySection = { 1: [], 2: [], 3: [] };

    for (const entry of this.autokernCache.values()) {
      if (entry.left !== glyphName && entry.right !== glyphName) {
        continue;
      }
      let section;
      if (!this.isEntryClassed(entry)) {
        section = 3;
      } else if (entry.left === glyphName) {
        section = 1;
      } else {
        section = 2;
      }
      rowsBySection[section].push(entry);
    }

    for (const section of [1, 2, 3]) {
      const classed = section !== 3;
      const rows = rowsBySection[section]
        .map((entry) => this.pairRowData(entry, classed))
        .filter((row) => this.pairRowVisible(row, filters, threshold, glyphName));

      // Spec §7.3: "Sorted by delta magnitude, worst first... Alphabetical
      // is a second sort and not the default."
      if (filters.sortAlphabetical) {
        rows.sort((a, b) => (a.left + "\0" + a.right).localeCompare(b.left + "\0" + b.right));
      } else {
        rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      }

      // WORKSTREAM 15, spec §5.2: the fold only applies to sections 1 and 2
      // (both sides classed already, per isEntryClassed) -- section 3 is
      // flat/unclassed, and a group with only one member folds to nothing
      // (buildFoldGroups below), so it renders exactly like today either
      // way. classed is `section !== 3` from above.
      if (filters.foldClasses && classed) {
        for (const group of this.buildFoldGroups(section, rows, glyphName)) {
          if (group.members.length < 2) {
            bodies[section - 1].appendChild(this.buildPairRowElement(group.rows[0]));
            continue;
          }
          const { parentRow, childRows } = this.buildFoldRowElements(group, section);
          bodies[section - 1].appendChild(parentRow);
          for (const childRow of childRows) {
            bodies[section - 1].appendChild(childRow);
          }
        }
      } else {
        for (const row of rows) {
          bodies[section - 1].appendChild(this.buildPairRowElement(row));
        }
      }
    }
  }

  // WORKSTREAM 15, spec §5.2: "A toggle above the table folds every row
  // whose pair resolves to the same cell into one parent." The table is
  // already scoped to one glyph (the field above it), so within section 1
  // the LEFT side of every row resolves to the same side-1 class (the
  // glyph's own) -- what varies, and can repeat, is which side-2 class each
  // row's right glyph belongs to. Section 2 is the mirror: RIGHT is fixed,
  // LEFT varies. Grouping by the varying side's resolved class is therefore
  // the same grouping "same (left-class-or-glyph, right-class-or-glyph)
  // cell" the spec describes, scoped to what this table already shows.
  //
  // Returns Array<{ key, members: string[] (the varying side's resolved
  // class's full membership, from kerningController.kernData -- spec §5.2:
  // "the table shows its membership instead"), rows: pairRowData[] (the
  // folded rows themselves, i.e. the ones actually visible), leftClassName,
  // rightClassName }>. `members.length < 2` (the underlying class itself
  // has one member, or -- defensively -- the lookup failed) means "nothing
  // to fold", the caller falls back to the plain row.
  buildFoldGroups(section, rows, glyphName) {
    const kernData = this.kerningController.kernData;
    const groups = new Map();
    const order = [];

    for (const row of rows) {
      let leftClassName, rightClassName, key;
      if (section === 1) {
        leftClassName = this.kerningController.leftPairGroupMapping[glyphName];
        rightClassName = this.kerningController.rightPairGroupMapping[row.right];
        key = rightClassName;
      } else {
        leftClassName = this.kerningController.leftPairGroupMapping[row.left];
        rightClassName = this.kerningController.rightPairGroupMapping[glyphName];
        key = leftClassName;
      }
      let group = groups.get(key);
      if (!group) {
        const varyingClassName = section === 1 ? rightClassName : leftClassName;
        const members =
          (section === 1
            ? kernData.groupsSide2[varyingClassName]
            : kernData.groupsSide1[varyingClassName]) || [];
        group = { key, members, rows: [], leftClassName, rightClassName };
        groups.set(key, group);
        order.push(key);
      }
      group.rows.push(row);
    }

    return order.map((key) => groups.get(key));
  }

  // Median (not mean, spec §5.2: "the median is the reducer... a mean can
  // [get dragged]") of the folded rows' suggestion values -- these are the
  // cache's own `entry.value` (via row.suggestion, pairRowData above), the
  // same source applySelectedPairRows/applyAllPairRows write from for a
  // flat row.
  static medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  buildFoldRowElements(group, section) {
    const tr = document.createElement("tr");
    tr.className = "kerning-pairtable-fold-row";

    const selectCell = document.createElement("td");
    tr.appendChild(selectCell);

    const median = KerningViewController.medianOf(group.rows.map((row) => row.suggestion));

    // WORKSTREAM 15, spec §5.2: "Spread is the class quality readout... call
    // it, don't reimplement" -- classSpread (autokern-classes.js) computes
    // it over the WHOLE class's cached rows (every partner it has data
    // against, not just this table's fixed glyph), which is the class-wide
    // quality reading the spec describes, not a narrower one scoped to this
    // one cell.
    const cacheEntries = [...this.autokernCache.values()];
    const side = section === 1 ? "right" : "left";
    const spread = classSpread(group.members, cacheEntries, side);

    const nameCell = document.createElement("td");
    nameCell.textContent = truncateGlyphList(group.members);
    tr.appendChild(nameCell);

    const deltaCell = document.createElement("td");
    deltaCell.textContent = median > 0 ? `+${median.toFixed(1)}` : median.toFixed(1);
    tr.appendChild(deltaCell);

    const otherCell = document.createElement("td");
    otherCell.textContent =
      section === 1 ? group.rows[0].left : group.rows[0].right;
    tr.appendChild(otherCell);

    const currentCell = document.createElement("td");
    currentCell.className = "kerning-pairtable-current-col";
    currentCell.style.display = this.autokernFiltersController.model.showCurrent
      ? ""
      : "none";
    tr.appendChild(currentCell);

    const infoCell = document.createElement("td");
    infoCell.textContent = `${group.rows.length} pairs, spread ${spread.overall.toFixed(1)}`;
    tr.appendChild(infoCell);

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = "Apply class";
    applyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.applyFoldedParentRow(group, section, median);
    });
    infoCell.appendChild(applyButton);

    const childRows = group.rows.map((row) => {
      const childTr = this.buildPairRowElement(row);
      childTr.className = "kerning-pairtable-fold-children";
      return childTr;
    });

    tr.addEventListener("click", () => {
      const expanded = childRows[0]?.classList.contains(
        "kerning-pairtable-fold-expanded"
      );
      for (const childTr of childRows) {
        childTr.classList.toggle("kerning-pairtable-fold-expanded", !expanded);
      }
    });

    return { parentRow: tr, childRows };
  }

  // WORKSTREAM 15, spec §5.2: "Applying a parent writes one cell at the
  // median of its members." The pair-selector shape is the SAME one
  // getPairsToTry/kerning-controller.js's own [@class, @class] address uses
  // (kerning-controller.js: `addGroupPrefix` prepends "@" to a stored group
  // name before it is used as a lookup/write key into kernData.values) --
  // KerningEditContext (kerning-controller.js) writes into
  // kernData.values[leftName][rightName] for whatever leftName/rightName a
  // pairSelector carries, with no restriction to bare glyph names, so an
  // "@ClassName" pairSelector reaches the real class cell, not a flat
  // shadow of it (spec §5.1's whole argument against a flat write).
  async applyFoldedParentRow(group, section, median) {
    const sourceIdentifier =
      this.fontController.fontSourcesInstancer.getSourceIdentifierForLocation({}, false);
    if (!sourceIdentifier) {
      console.error(
        "kerning view: cannot apply, no font source resolves at the default location"
      );
      return;
    }
    const leftName = "@" + group.leftClassName;
    const rightName = "@" + group.rightClassName;
    const editContext = this.kerningController.getEditContext([
      { leftName, rightName, sourceIdentifier },
    ]);
    await editContext.edit([Math.round(median)], "kerning view: fold parent apply");

    for (const row of group.rows) {
      this.autokernAppliedPairs.add(pairKey(row.left, row.right));
    }
    this.renderPairTable();
  }

  // ---------------------------------------------------------------------
  // WORKSTREAM 15, spec §5.3: derive.
  // ---------------------------------------------------------------------

  // script/category maps, per glyph, the same source glyph-organizer.js
  // itself reads a glyph's "category" from (glyph-data.js's
  // getGlyphInfoFromCodePoint/getGlyphInfoFromGlyphName) and "script" from
  // (unicode-scripts-blocks.js's script(codePoint)) -- reused rather than
  // guessing at a second source, so the cross-script/category merge guard
  // inside deriveKernRowClusters agrees with what the rest of the app
  // already calls a glyph's script/category. A glyph with no resolvable
  // code point (no entry in glyphMap, or an empty one) is left OUT of both
  // maps entirely -- deriveKernRowClusters treats a glyph missing from
  // either map as blocking any merge involving it (autokern-classes.js's
  // rowsAgree: "a glyph missing from either map blocks the merge exactly
  // like a genuine mismatch would"), which is the safe default for a glyph
  // this view cannot classify.
  buildGlyphScriptCategoryMaps() {
    const scripts = new Map();
    const categories = new Map();
    for (const glyphName of Object.keys(this.fontController.glyphMap || {})) {
      const codePoint = this.fontController.glyphMap[glyphName]?.[0];
      const glyphInfo =
        (codePoint != null ? getGlyphInfoFromCodePoint(codePoint) : null) ||
        getGlyphInfoFromGlyphName(glyphName);
      if (glyphInfo?.category != null) {
        categories.set(glyphName, glyphInfo.category);
      }
      if (codePoint != null) {
        scripts.set(glyphName, scriptOfCodePoint(codePoint));
      }
    }
    return { scripts, categories };
  }

  // A composite's declared base, per glyph -- the first component's name,
  // if any (spec §5.3: "a glyph built from components takes its base
  // glyph's classes"; this view has no notion of "which component is the
  // base" beyond declaration order, the same simplification BubbleKern's
  // "bubbles" comment in autokern-classes.js's own file-top comment
  // gestures at without resolving it either). A glyph with no components
  // is absent from the returned map, exactly the input contract
  // inheritCompositeClasses documents ("compositeBases: ... already
  // resolved by the caller").
  async buildCompositeBases() {
    const compositeBases = new Map();
    for (const glyphName of Object.keys(this.fontController.glyphMap || {})) {
      const glyphInstance = await this.fontController.getGlyphInstance(glyphName, {});
      const baseName = glyphInstance?.components?.[0]?.compo?.name;
      if (baseName) {
        compositeBases.set(glyphName, baseName);
      }
    }
    return compositeBases;
  }

  // Runs both §5.3 tactics, in the order the spec gives them, and turns
  // their output into proposals -- writes nothing (autokern-classes.js's own
  // functions are pure, and neither tactic's result is written to the font
  // here). Populates this.autokernDeriveProposals and re-renders; accepting
  // one is a separate, explicit action (acceptDeriveProposal).
  async deriveClasses() {
    const { scripts, categories } = this.buildGlyphScriptCategoryMaps();
    const compositeBases = await this.buildCompositeBases();
    const cacheEntries = [...this.autokernCache.values()];
    const tolerance = Number(
      document.querySelector("#kerning-derive-tolerance").value || 0
    );

    const proposals = [];
    let proposalId = 0;

    // Tactic 1: composite inheritance (exact, spec §5.3 tactic 1), one side
    // at a time (the two sides are independent, spec §5).
    for (const [side, existingMapping, editSide] of [
      ["left", this.kerningController.leftPairGroupMapping, "side1"],
      ["right", this.kerningController.rightPairGroupMapping, "side2"],
    ]) {
      const existingClasses = new Map(Object.entries(existingMapping));
      const inherited = inheritCompositeClasses(existingClasses, compositeBases);
      // Group the newly-inherited composites (glyphs that had NO class of
      // their own before, per inheritCompositeClasses's own contract: "never
      // overwrites a glyph's own explicit class") by the class name they
      // inherited, so accepting one proposal joins every composite that
      // inherited that base's class in one go.
      const byClassName = new Map();
      for (const [glyphName, className] of inherited) {
        if (!className || existingClasses.get(glyphName) != null) {
          continue; // already had a class of its own -- nothing to propose
        }
        if (!byClassName.has(className)) {
          byClassName.set(className, []);
        }
        byClassName.get(className).push(glyphName);
      }
      for (const [className, members] of byClassName) {
        proposals.push({
          id: proposalId++,
          tactic: "composite",
          side,
          editSide,
          className,
          members: members.sort(),
        });
      }
    }

    // Tactic 2: kern-row clustering (needs the tolerance, spec §5.3), one
    // side at a time. No class name exists yet for a cluster -- the
    // designer names it before accepting (renderDeriveProposals).
    for (const [side, editSide] of [
      ["left", "side1"],
      ["right", "side2"],
    ]) {
      const clusters = deriveKernRowClusters(
        cacheEntries,
        side,
        tolerance,
        scripts,
        categories
      );
      for (const members of clusters) {
        proposals.push({
          id: proposalId++,
          tactic: "cluster",
          side,
          editSide,
          className: null,
          members,
        });
      }
    }

    this.autokernDeriveProposals = proposals;
    this.renderDeriveProposals();
  }

  renderDeriveProposals() {
    const container = document.querySelector("#kerning-derive-proposals");
    container.textContent = "";
    for (const proposal of this.autokernDeriveProposals) {
      container.appendChild(this.buildDeriveProposalElement(proposal));
    }
  }

  buildDeriveProposalElement(proposal) {
    const row = document.createElement("div");
    row.className = "kerning-derive-proposal";

    const label = document.createElement("span");
    label.className = "kerning-derive-proposal-label";
    label.textContent = `PROPOSED (${proposal.tactic}, ${proposal.side}): `;
    row.appendChild(label);

    const members = document.createElement("span");
    members.textContent = truncateGlyphList(proposal.members);
    row.appendChild(members);

    let nameInput;
    if (proposal.className) {
      const nameSpan = document.createElement("span");
      nameSpan.textContent = ` -> ${proposal.className}`;
      row.appendChild(nameSpan);
    } else {
      nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "class name";
      row.appendChild(nameInput);
    }

    const acceptButton = document.createElement("button");
    acceptButton.type = "button";
    acceptButton.textContent = "Accept";
    acceptButton.addEventListener("click", async () => {
      const className = proposal.className || nameInput.value.trim();
      if (!className) {
        return;
      }
      await this.acceptDeriveProposal(proposal, className);
    });
    row.appendChild(acceptButton);

    return row;
  }

  // WORKSTREAM 15, spec §5.3: accepting a proposal writes group membership
  // through the SAME mechanism panel-selection-info.js's existing per-glyph
  // class field uses (panel-selection-info.js:326:
  // `kerningController.editGroupSide2(glyphName, value)` /
  // `editGroupSide1`), called once per member glyph -- kerning-controller.js
  // is not touched, and no second write mechanism is invented. Nothing is
  // written until this method runs (deriveClasses above is pure/read-only).
  async acceptDeriveProposal(proposal, className) {
    const editFn =
      proposal.editSide === "side1"
        ? (glyphName) => this.kerningController.editGroupSide1(glyphName, className)
        : (glyphName) => this.kerningController.editGroupSide2(glyphName, className);
    for (const glyphName of proposal.members) {
      await editFn(glyphName);
    }
    this.autokernDeriveProposals = this.autokernDeriveProposals.filter(
      (p) => p.id !== proposal.id
    );
    this.renderDeriveProposals();
    this.renderPairTable();
  }

  // WORKSTREAM 14, spec §7.5: "font-level counts: pairs cached, pairs above
  // the threshold, pairs marked junk, and how many cells are covered by a
  // class against how many are flat" -- font-wide (every entry in
  // this.autokernCache for the CURRENT source), unlike the pair table above,
  // which is scoped to whatever glyph is in the field. Reuses
  // isRowAboveThreshold/isEntryClassed (above) and pairRowData (which
  // reads real stored kerning through kerningController the same way the
  // pair table does) rather than a second, possibly-diverging copy of any
  // of that logic. `junk` is read directly off the cache entry -- no
  // pairRowData needed for that one, it's already a plain field
  // (autokern-cache.js: "cache entry: { ..., junk: boolean, ... }").
  computeAutokernStatusCounts() {
    const counts = { cached: 0, aboveThreshold: 0, junk: 0, classed: 0, flat: 0 };
    if (!this.autokernCache || !this.kerningController) {
      return counts;
    }
    const threshold = this.autokernParamsController.model.threshold;
    counts.cached = this.autokernCache.size;
    for (const entry of this.autokernCache.values()) {
      if (entry.junk) {
        counts.junk++;
      }
      const row = this.pairRowData(entry, this.isEntryClassed(entry));
      if (this.isRowAboveThreshold(row, threshold)) {
        counts.aboveThreshold++;
      }
      if (row.classed) {
        counts.classed++;
      } else {
        counts.flat++;
      }
    }
    return counts;
  }

  // Renders the counts above into the status strip (§7.5, kerning.html's
  // #kerning-status-section). No-ops if the strip's elements aren't in the
  // DOM yet -- mirrors renderCalibration's own guard, for the same reason
  // (this can be called before initAutokernStatusSection's DOM lookups run,
  // e.g. from loadAutokernCacheFromStorage during construction).
  renderAutokernStatus() {
    const cachedEl = document.querySelector("#kerning-status-cached");
    if (!cachedEl) {
      return;
    }
    const counts = this.computeAutokernStatusCounts();
    cachedEl.textContent = `Pairs cached: ${counts.cached}`;
    document.querySelector("#kerning-status-threshold").textContent =
      `Above threshold: ${counts.aboveThreshold}`;
    document.querySelector("#kerning-status-junk").textContent =
      `Marked junk: ${counts.junk}`;
    document.querySelector("#kerning-status-coverage").textContent =
      `Classed cells: ${counts.classed} — Flat cells: ${counts.flat}`;
  }

  // WORKSTREAM 14, spec §7.5/§4.1: "the source selector... decides what the
  // preview draws, which cache the table shows and where an apply writes."
  // Lists the font's actual sources (this.fontController.sources, the same
  // dict font-controller.js's own getSortedSourceIdentifiers/sources getters
  // expose and panel-designspace-navigation.js's own source list is built
  // from), in the same sorted order that panel builds its list in
  // (fontController.getSortedSourceIdentifiers()).
  initAutokernStatusSection() {
    const select = document.querySelector("#kerning-status-source-select");
    const sourceIdentifiers = this.fontController.getSortedSourceIdentifiers();
    for (const sourceIdentifier of sourceIdentifiers) {
      const option = document.createElement("option");
      option.value = sourceIdentifier;
      option.textContent =
        this.fontController.sources[sourceIdentifier].name || sourceIdentifier;
      select.appendChild(option);
    }
    select.value = this.autokernSource;

    select.addEventListener("change", async () => {
      const sourceIdentifier = select.value;
      this._autokernSourceIdentifier = sourceIdentifier;

      // (a) What the left-pane scene draws: this is the SAME mechanism
      // panel-designspace-navigation.js uses for its own source list
      // selection (panel-designspace-navigation.js, e.g. its
      // "sourceListSetSelectedSource"/arrow-key navigation path around line
      // 2115-2116: `this.sceneSettings.fontLocationSourceMapped =
      // this.fontController.sources[newSourceIdentifier].location`).
      // sceneSettings here is this.sceneSettingsController.model, the exact
      // controller this view shares with the editor's scene (constructor
      // above) -- setting fontLocationSourceMapped to the chosen source's
      // own stored location is what makes the shared scene model resolve
      // and render that source's outlines, the same way it does when a
      // designer picks a source in the editor's own sources list.
      this.sceneSettingsController.setItem(
        "fontLocationSourceMapped",
        this.fontController.sources[sourceIdentifier].location
      );

      // (d, partial) A different source's cache is a different cache, never
      // a converted one (spec §4.1) -- a calibration readout carried over
      // from the PREVIOUS source's run would misdescribe this one, so clear
      // it until this source is run again.
      this.autokernCalibration = null;
      this.renderCalibration();

      // (b)/(c)/(d): this.autokernSource (the getter above) now reads the
      // new identifier, so loadAutokernCacheFromStorage below reads/writes
      // the newly-selected source's own OPFS cache file
      // (autokernCacheFileName keys on `source`), replaces
      // this.autokernCache with whatever that source's cache holds (or an
      // empty Map if it has never been run), and re-renders the pair table
      // and status counts for it (loadAutokernCacheFromStorage ->
      // renderPairTable -> renderAutokernStatus, see those methods' own
      // comments).
      await this.loadAutokernCacheFromStorage();
    });

    this.renderAutokernStatus();
  }

  // Spec §7.4: "Collapsed. It names the three control glyphs, what each
  // measured, the reach it settled on, and whether the three disagreed and
  // it had to widen." A readout only, no controls.
  //
  // Every value here traces to autokern-engine.js's calibrateBand (called
  // via AutokernEngine.calibrate in autokern-worker.js, posted back
  // unmodified as data.calibration and stored on this.autokernCalibration):
  // it returns { bias, measurements, widened, band: { min, max } }, where
  // `measurements` is the three control glyphs' own overlap values in the
  // same order as CONTROL_GLYPH_NAMES ("l", "n", "o") and `widened` is
  // already the true/false the engine settled on (min < max/2 forced at
  // least one extra widening pass) -- nothing here is recomputed or guessed.
  renderCalibration() {
    const body = document.querySelector("#kerning-calibration-body");
    if (!body) {
      return;
    }
    body.textContent = "";

    if (!this.autokernCalibration) {
      const p = document.createElement("p");
      p.textContent = "Not yet calibrated. Run autokern to calibrate.";
      body.appendChild(p);
      return;
    }

    const { bias, measurements, widened, band } = this.autokernCalibration;

    const list = document.createElement("ul");
    CONTROL_GLYPH_NAMES.forEach((name, i) => {
      const li = document.createElement("li");
      const measured = measurements[i];
      li.textContent = `${name}: measured ${
        Number.isFinite(measured) ? measured.toFixed(3) : measured
      }`;
      list.appendChild(li);
    });
    body.appendChild(list);

    const bandLine = document.createElement("p");
    bandLine.textContent = `Target band: ${band.min.toFixed(3)} – ${band.max.toFixed(3)}`;
    body.appendChild(bandLine);

    const reachLine = document.createElement("p");
    reachLine.textContent = `Envelope reach settled at ${bias}`;
    body.appendChild(reachLine);

    const widenLine = document.createElement("p");
    widenLine.textContent = widened
      ? "The three control glyphs disagreed, so calibration widened the reach."
      : "The three control glyphs agreed; calibration did not need to widen.";
    body.appendChild(widenLine);
  }

  buildPairRowElement(row) {
    const tr = document.createElement("tr");
    tr.dataset.left = row.left;
    tr.dataset.right = row.right;

    // WORKSTREAM 16, spec §6: "Clicking a row in the table selects that pair
    // and flips the chip to `pair`." Ignores clicks on the row's own
    // checkbox/junk-mark button (event.target.closest guard) so selecting
    // for apply/reset and marking junk are unaffected -- only a click on the
    // row itself (its plain cells) selects the pair for the scene.
    tr.addEventListener("click", (event) => {
      if (event.target.closest("input, button")) {
        return;
      }
      this.selectPairForScene(row.left, row.right);
    });

    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "kerning-pairtable-row-select";
    selectCell.appendChild(checkbox);
    tr.appendChild(selectCell);

    const leftCell = document.createElement("td");
    leftCell.textContent = row.left;
    tr.appendChild(leftCell);

    const deltaCell = document.createElement("td");
    deltaCell.textContent = row.delta > 0 ? `+${row.delta.toFixed(1)}` : row.delta.toFixed(1);
    tr.appendChild(deltaCell);

    const rightCell = document.createElement("td");
    rightCell.textContent = row.right;
    tr.appendChild(rightCell);

    const currentCell = document.createElement("td");
    currentCell.className = "kerning-pairtable-current-col";
    currentCell.textContent = row.current;
    currentCell.style.display = this.autokernFiltersController.model.showCurrent
      ? ""
      : "none";
    tr.appendChild(currentCell);

    const junkCell = document.createElement("td");
    const junkButton = document.createElement("button");
    junkButton.type = "button";
    junkButton.textContent = row.junk ? "Unmark junk" : "Mark junk";
    junkButton.addEventListener("click", () =>
      this.togglePairJunk(row.left, row.right, !row.junk)
    );
    junkCell.appendChild(junkButton);
    tr.appendChild(junkCell);

    return tr;
  }

  async togglePairJunk(left, right, junk) {
    // autokern-cache.js's markPairJunk is a pure function (returns a NEW
    // Map, spec §4.2: "a mark... can be found and undone") -- this module
    // is not touched, only called, per the brief's file-ownership rule.
    this.autokernCache = markPairJunk(this.autokernCache, left, right, junk);
    this.renderPairTable();

    // WORKSTREAM 12. Two separate writes, per the file-top comment's split:
    // the cache file (browser-side, derived data, kept in sync so a reload
    // between now and the next run still shows this mark) and the
    // project's own junk-pair list (font backend customData, the designer's
    // judgement, must survive a change of machine).
    await this.writeAutokernCacheToStorage();
    await this.writeJunkMarksToProject();
  }

  // Spec §4.1: junk marks "belong in the project's own data beside the
  // other per-font settings" -- written the same way
  // glyphsets-controller.js's PROJECT_GLYPH_SETS_CUSTOM_DATA_KEY is (see
  // the file-top comment for the exact citation). Recomputes the FULL junk
  // list from this.autokernCache each time (rather than patching one pair
  // in) so the project's list can never drift from what the cache itself
  // currently marks junk.
  async writeJunkMarksToProject() {
    const junkPairs = [...this.autokernCache.values()]
      .filter((entry) => entry.junk)
      .map((entry) => ({ left: entry.left, right: entry.right }));
    await this.fontController.performEdit(
      "kerning view: mark pair junk",
      "customData",
      (root) => {
        if (junkPairs.length) {
          root.customData[AUTOKERN_JUNK_PAIRS_CUSTOM_DATA_KEY] = junkPairs;
        } else {
          delete root.customData[AUTOKERN_JUNK_PAIRS_CUSTOM_DATA_KEY];
        }
      },
      this
    );
  }

  getSelectedPairTableRows() {
    return [...document.querySelectorAll(".kerning-pairtable-row-select:checked")]
      .map((checkbox) => checkbox.closest("tr"))
      .map((tr) => ({ left: tr.dataset.left, right: tr.dataset.right }));
  }

  async applySelectedPairRows() {
    await this.writePairValues(
      this.getSelectedPairTableRows(),
      (entry) => entry.value,
      true
    );
  }

  applyAllPairRows(button) {
    const visibleRows = [...document.querySelectorAll(".kerning-pairtable-table tbody tr")].map(
      (tr) => ({ left: tr.dataset.left, right: tr.dataset.right })
    );

    // Spec §7.3: "Apply all states how many cells it will write and needs a
    // second press." First press arms and relabels the button; a second
    // press within the window commits. Re-rendering the table (any filter
    // change, a Run finishing) between the two presses would silently
    // change what "all" means, so a fresh render is not forced here, but
    // the re-count on commit below uses whatever is on screen AT THE TIME
    // OF THE SECOND PRESS, not the count shown on the first press -- if the
    // table changed underneath, the write still matches what's actually
    // visible rather than a stale number.
    if (!this._applyAllArmed) {
      this._applyAllArmed = true;
      button.textContent = `Confirm: write ${visibleRows.length} cell(s)`;
      clearTimeout(this._applyAllArmTimeout);
      this._applyAllArmTimeout = setTimeout(() => {
        this._applyAllArmed = false;
        button.textContent = this._applyAllDefaultLabel;
      }, 8000);
      return;
    }

    clearTimeout(this._applyAllArmTimeout);
    this._applyAllArmed = false;
    button.textContent = this._applyAllDefaultLabel;
    this.writePairValues(visibleRows, (entry) => entry.value, true);
  }

  async resetSelectedPairRows(mode) {
    const rows = this.getSelectedPairTableRows();
    // "Reset to current" writes the pair's already-resolved stored value
    // back as an explicit flat entry (useful to break a class cell's value
    // out into a flat exception without changing the number, or to
    // re-confirm a value after inspecting it here). "Reset to zero" writes
    // 0, clearing the pair's effective kerning. Neither is "accepting the
    // suggestion", so neither marks the row applied (see writePairValues'
    // markApplied parameter) -- the state filter's "applied" bucket means
    // specifically "the suggestion was applied".
    const valueFn =
      mode === "zero"
        ? () => 0
        : (entry, left, right) =>
            this.kerningController.getGlyphPairValueForLocation(left, right, {}) ?? 0;
    await this.writePairValues(rows, valueFn, false);
  }

  // The single write path every pair-table action goes through. Reaches
  // REAL font kerning data: kerningController.getEditContext(...).edit(...)
  // is the exact mechanism kerning-controller.js documents and
  // edit-tools-metrics.js (editor.js's own kerning-drag tool) uses --
  // fontController.editFinal underneath, which writes to the font's
  // backend, broadcasts the change to every other open view (including a
  // live editor tab on the same font), and is what the project actually
  // saves. This is real, not a local mock.
  //
  // What it does NOT do: push onto an undo stack in THIS view. Spec §7.3
  // says "Each action is one undo step" and this workstream cannot deliver
  // that honestly. editor.js's kerning tool gets its undo step from
  // pushUndoItem, a mechanism belonging to that PARTICULAR tool
  // (edit-tools-metrics.js's own `this.undoStack`, fed to
  // sceneController.doUndoRedo). This view (kerning.js) has no undo stack
  // at all -- not for glyph edits, not for kerning edits, nothing; grep the
  // whole file, there is no `undoStack` here before this workstream and
  // this workstream does not add one. Building a real one is a batch-apply
  // undo mechanism in its own right (multiple pairs, one step, per spec's
  // "each action is one undo step") and is out of scope for this pass.
  // Concretely: applying a row from this table changes the saved font
  // immediately and permanently as far as this view is concerned; the
  // designer's only way back is to apply the opposite value by hand (e.g.
  // "reset to current" before the fact, or typing the old number back).
  async writePairValues(pairs, valueFn, markApplied) {
    if (!pairs.length) {
      return;
    }
    const sourceIdentifier =
      this.fontController.fontSourcesInstancer.getSourceIdentifierForLocation({}, false);
    if (!sourceIdentifier) {
      // Mirrors edit-tools-metrics.js's own guard (getEditContext there:
      // "if (!sourceIdentifier && wantValues) { this.showDialogLocationNotAtSource(); }")
      // -- this view has no design-space location control to be "not at",
      // so in practice this only fires for a font with zero sources, which
      // has no kerning to write regardless.
      console.error(
        "kerning view: cannot apply, no font source resolves at the default location"
      );
      return;
    }

    const pairSelectors = [];
    const values = [];
    const keys = [];
    for (const { left, right } of pairs) {
      const entry = this.autokernCache.get(pairKey(left, right));
      if (!entry) {
        continue;
      }
      pairSelectors.push({ leftName: left, rightName: right, sourceIdentifier });
      values.push(Math.round(valueFn(entry, left, right)));
      keys.push(pairKey(left, right));
    }
    if (!pairSelectors.length) {
      return;
    }

    const editContext = this.kerningController.getEditContext(pairSelectors);
    await editContext.edit(values, "kerning view: pair table write");

    if (markApplied) {
      for (const key of keys) {
        this.autokernAppliedPairs.add(key);
      }
    }

    this.renderPairTable();
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

  // WORKSTREAM 16, spec §6: "A chip selector sits in the bottom left corner,
  // holding `pair` and `phrase`. It is the only thing that decides what the
  // pane draws. `pair` is disabled until a pair is selected. It has a
  // hotkey." this._chipMode is the single source of truth read by
  // initPhraseSection's setText guard above and by selectPairForScene below.
  // `pair` starts disabled in kerning.html (the `disabled` attribute on
  // #kerning-chip-selector's [data-chip="pair"] button) and stays disabled
  // here until selectPairForScene (a pair-table row click) supplies a pair,
  // matching "disabled until a pair is selected" literally rather than
  // pre-enabling it and merely leaving it empty.
  initChipSection() {
    this._chipMode = "phrase";
    this._selectedPairText = null;

    const chipButtons = {};
    for (const button of document.querySelectorAll("[data-chip]")) {
      chipButtons[button.dataset.chip] = button;
      button.addEventListener("click", () => this.setChipMode(button.dataset.chip));
    }
    this._chipButtons = chipButtons;
    this.updateChipButtons();

    // Spec §6: "It has a hotkey." Tab is not used by any other action
    // registered in this file (registerAction calls above/below: the
    // per-tool number-key shortcuts and action.kerning.hold-hand-tool's
    // Space binding), so it is free here.
    registerAction(
      "action.kerning.toggle-chip",
      {
        topic: "0020-action-topics.menu.view",
        titleKey: "kerning.toggle-chip",
        defaultShortCuts: [{ baseKey: "Tab" }],
      },
      () => {
        // Tab is a text-field navigation key: firing while the phrase
        // textarea or any other text input/select has focus would hijack
        // normal tabbing/typing (and this handler's own preventDefault
        // would swallow the keystroke). Bail out and let the field behave
        // normally instead.
        const activeTag = document.activeElement?.tagName;
        if (activeTag === "TEXTAREA" || activeTag === "INPUT" || activeTag === "SELECT") {
          return;
        }
        this.setChipMode(this._chipMode === "phrase" ? "pair" : "phrase");
      }
    );
  }

  updateChipButtons() {
    for (const [mode, button] of Object.entries(this._chipButtons || {})) {
      button.style.fontWeight = mode === this._chipMode ? "bold" : "";
    }
  }

  // Spec §6: switching the chip is the only thing that decides what the left
  // pane draws. Switching to "pair" is refused (no-op) while no pair has
  // been selected yet -- selectPairForScene below is the only caller that
  // enables the "pair" button, so this can only be reached once a row has
  // been clicked.
  setChipMode(mode) {
    if (mode === "pair" && !this._selectedPairText) {
      return;
    }
    this._chipMode = mode;
    this.updateChipButtons();
    if (mode === "pair") {
      this.sceneSettingsController.setItem("text", this._selectedPairText);
    } else {
      // Spec §6: "switching back to `phrase` restores what was typed, which
      // is not destroyed." The phrase textarea's own value was never
      // touched while pair mode was active (setText's guard in
      // initPhraseSection), so re-applying it here restores exactly what
      // the designer typed.
      this.applyPhraseText();
    }
  }

  // Called from buildPairRowElement's row-click handler (spec §6: "Clicking
  // a row in the table selects that pair and flips the chip to `pair`").
  // Builds a two-glyph display string the same "/glyphname" syntax
  // characterLinesFromString already parses (character-lines.js) --
  // parseExcludedGlyphNames above uses the identical "/name" convention for
  // the same reason: it resolves whether or not the glyph has a literal
  // character, so an unencoded glyph name (e.g. a ligature or a name with no
  // Unicode mapping) still names itself directly rather than being silently
  // dropped or misread as literal text.
  selectPairForScene(left, right) {
    this._selectedPairText = `/${left} /${right}`;
    const pairButton = this._chipButtons?.pair;
    if (pairButton) {
      pairButton.disabled = false;
    }
    this.setChipMode("pair");
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
    // Tab is a text-field navigation key (spec §6's chip hotkey): if a text
    // input/textarea/select has focus, leave it alone entirely -- even
    // preventDefault() on the keydown here would swallow normal tabbing
    // and typing before the action callback gets a chance to no-op.
    if (event.key === "Tab") {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "TEXTAREA" || activeTag === "INPUT" || activeTag === "SELECT") {
        return;
      }
    }
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

// WORKSTREAM 15, spec §5.2: "A class's stored name is an address, and the
// table shows its membership instead... Long lists truncate with a count."
const GLYPH_LIST_TRUNCATE_AT = 6;
function truncateGlyphList(members) {
  if (members.length <= GLYPH_LIST_TRUNCATE_AT) {
    return members.join(" ");
  }
  return `${members.slice(0, GLYPH_LIST_TRUNCATE_AT).join(" ")}… (${members.length})`;
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
