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
// excluded-glyph parameter to wire into -- CORRECTION, a later fix: it now
// is, via this.autokernExcludedGlyphNames -- see runAutokern's own comment),
// and the five actions (apply
// selected, apply all with a second-press confirm, reset to current, reset
// to zero, mark junk). Deliberately NOT built here: §5.2's fold (every row
// stays one flat pair; "apply" therefore always writes a flat exception,
// never a class cell -- see the writePairValues comment), §5.3 derivation,
// §7.4 calibration readout, §7.5 status strip.
//
// Undo, current state (see writePairValues's and acceptDeriveProposal's own
// comments for the full trace): this view now carries its OWN font-level
// undo stack, this.autokernUndoStack (a plain UndoStack, built in the
// constructor, imported from font-controller.js), for exactly the pair-table
// writes (writePairValues, real broadcast/persisted font kerning data
// through the same kerningController.getEditContext(...).edit(...) path
// editor.js's kerning tool uses) and derive-accept class writes
// (acceptDeriveProposal's kerningController.editGroupSide1/editGroupSide2
// calls) this comment used to say were structurally unreachable from any
// undo stack. They still cannot use fontController's own per-glyph
// `undoStacks` (font-controller.js's pushUndoRecord asserts exactly one
// glyph name touched; a "kerning" root-key change touches zero) -- but that
// was never the only option: views-fontinfo/src/panel-base.js's
// BaseInfoPanel already solves this exact problem (a non-per-glyph,
// font-root-key edit that still needs to be locally undoable) by owning its
// own UndoStack instance instead of using fontController's, and this view
// now does the same. Junk marks and the excluded-glyph list
// (writeJunkMarksToProject, also a fontController.performEdit under
// "customData") are deliberately left OUT of this undo stack: spec section
// 4.2 frames them as the designer's judgement/settings, not a kerning
// suggestion being applied, and they are not among the actions spec section
// 7.3 enumerates as "one undo step" -- this is a judgement call, not a
// limitation, and can be revisited if a designer explicitly asks for
// Ctrl-Z on a junk mark. Glyph-layer edits made through this view's
// sidebearing/kerning TOOLS (edit-tools-metrics.js, workstream 17) reach
// Ctrl-Z through a third, independent path -- see initUndoActions/
// callDelegateMethod below, which routes "action.undo"/"action.redo" to the
// active tool's own doUndoRedo first, and only falls through to
// this.autokernUndoStack (then the shared per-glyph scene undo) when no
// metrics tool is active. callDelegateMethod's own comment states the exact,
// honest limitation this produces: while a sidebearing/kerning tool IS the
// active tool, its own undo stack always wins over a more recent autokern
// edit, because the dispatch only checks whether the tool implements the
// method, not whether its own stack is non-empty.
import {
  markGlyphStale,
  markPairJunk,
  markPairOverride,
  medianDroppingOutliers,
  pairKey,
} from "@fontra/core/autokern-cache.js";
// Design doc §0: kern-row clustering (deriveKernRowClusters) is removed from
// this view's derive UI/call site -- composite inheritance is now the only
// tactic -- but the function itself stays exported/unmodified in
// autokern-classes.js (may still be useful elsewhere or in tests), so it is
// simply not imported here anymore.
import { classSpread, inheritCompositeClasses } from "@fontra/core/autokern-classes.js";
import {
  doPerformAction,
  getActionIdentifierFromKeyEvent,
  registerAction,
  registerActionCallbacks,
} from "@fontra/core/actions.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { CanvasController } from "@fontra/core/canvas-controller.js";
// Task 12, spec F26/§12.3, ledger §5.5: the exact wildcard-match-pattern
// primitive KerningController's own constructor already subscribes with
// (kerning-controller.js: `{ kerning: { [wildcard]: { values: null } } }`)
// -- reused here for kerning.js's own subscription, not a second wildcard
// convention.
import { wildcard } from "@fontra/core/changes.js";
import {
  characterLinesFromString,
  parsePhrasePresets,
} from "@fontra/core/character-lines.js";
import { rasterizeGlyph } from "@fontra/core/glyph-raster.js";
import { GlyphOrganizer } from "@fontra/core/glyph-organizer.js";
import {
  getMyGlyphSets,
  GlyphSetsController,
  readProjectGlyphSets,
  THIS_FONTS_GLYPHSET,
} from "@fontra/core/glyphsets-controller.js";
import * as html from "@fontra/core/html-utils.js";
import { UndoStack, reverseUndoRecord } from "@fontra/core/font-controller.js";
import { translate } from "@fontra/core/localization.js";
import { glyphMapToItemList, round } from "@fontra/core/utils.ts";
import { ObservableController } from "@fontra/core/observable-object.ts";
import { getOPFS } from "@fontra/core/opfs.js";
import { SceneView } from "@fontra/core/scene-view.js";
// Bug fix (kerning view, font mode grid): Shift/Ctrl/Cmd-click modifier
// handling, used only to override GlyphCellView.handleSingleClick on THIS
// view's own instance below (initFontModeSection) -- see that override's own
// comment for why font-overview.js's shared glyph-cell-view.js is read, not
// edited, and for the exact live-tested symptom this fixes.
import { difference, union } from "@fontra/core/set-ops.js";
import { themeController } from "@fontra/core/theme-settings.js";
import { ViewController } from "@fontra/core/view-controller.js";
import { GlyphCell } from "@fontra/web-components/glyph-cell.js";
import { GlyphCellView } from "@fontra/web-components/glyph-cell-view.js";
import { IconButton } from "@fontra/web-components/icon-button.js"; // for <icon-button>, the delete-class control
import { MenuItemDivider, showMenu } from "@fontra/web-components/menu-panel.js";
import { dialogSetup, message } from "@fontra/web-components/modal-dialog.js";
// Backlog items 9+10 (combined): the exact settings-accordion mechanism
// views-editor's own visualization-layer settings already use (e.g.
// panel-designspace-navigation.js's coarse-grid-accordion-item) -- imported
// unmodified, not reinvented.
import { Accordion } from "@fontra/web-components/ui-accordion.js";
import { HandTool } from "@fontra/views-editor/edit-tools-hand.js";
import {
  KerningTool,
  SidebearingTool,
} from "@fontra/views-editor/edit-tools-metrics.js";
import { SceneController } from "@fontra/views-editor/scene-controller.js";
import { Sidebar } from "@fontra/views-editor/sidebar.js";
import {
  glyphSelector,
  strokeLine,
  visualizationLayerDefinitions,
} from "@fontra/views-editor/visualization-layer-definitions.js";
import {
  VisualizationContext,
  VisualizationLayers,
} from "@fontra/views-editor/visualization-layers.js";
import { SelectTool } from "./edit-tools-select.js";
import {
  appendGlyphToken,
  crossProductPairs,
  pairsFromInputs,
  parseTokenList,
  replaceGlyphToken,
} from "./input-tokens.js";
import {
  explicitPairExists,
  glyphMatchesCategory,
  hiddenFromCacheEntry,
  isStaleAsyncResult,
  pairMatchesGlyphset,
  pairMatchesUnicodeTypes,
  passesNumericFilters,
  rowId,
  rowMatchesRelationships,
  rowVisibleForHiddenState,
  rowVisibleInDefault,
  rowVisibleInPotential,
  valuesForDisplay,
} from "./results-model.js";
import { deselectAll, retainVisible, selectRow, tickRow } from "./results-selection.js";

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
// Design doc §3: "Stored as project data... Key shape: one entry per (side,
// class name) pair... fontra.autokernClassColors: { side1: { <className>:
// <color> }, side2: { ... } }, written through fontController.performEdit the
// same way writeJunkMarksToProject... already do[es]." Same customData
// mechanism as the two keys above -- see the file-top comment for the exact
// citation and pattern this follows.
const AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY = "fontra.autokernClassColors";

// Task 11, spec F15: the non-color, textual half of the class/unique/
// exception distinction -- kerning.css keys the color cue off the exact
// same `data-kind` attribute already set by buildPairRowElement/
// buildClassSummaryRowElement (Task 8), so this is the one place both
// row builders read a row's category label from.
const ROW_KIND_CATEGORY_LABELS = {
  "class-rule": "Class rule",
  "member-pair": "Class member (inherits the class rule)",
  "unique-pair": "Unique pair",
  "pair-exception": "Pair exception",
};

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

    // Spec §10 ("No on-canvas display of a suggestion"): a view-specific
    // visualization layer, drawing the CURRENTLY SELECTED pair's measured
    // suggestion (this.autokernCache) the same visual language the editor's
    // own KerningTool uses for a STORED kern -- see
    // buildAutokernSuggestionVisualizationLayerDefinition below for why this
    // is a layer definition (matching the mechanism KerningTool's own
    // "fontra.kerning-indicators"/"-tool" layers in edit-tools-metrics.js
    // already use for the stored kern) rather than a second draw pass bolted
    // onto KerningTool itself. Appended to a COPY of the shared
    // visualizationLayerDefinitions array, never pushed into the shared
    // array itself (registerVisualizationLayerDefinition mutates a
    // module-level singleton that views-editor's own EditorController reads
    // from the same import -- pushing into it here would leak this
    // kerning-view-only layer into the editor view too).
    // Backlog item 10: per-glyph "before the preview shift was applied" x
    // positions, captured lazily (WeakMap keyed by the positioned-glyph
    // object itself, so a fresh buildScene() -- new objects -- naturally
    // invalidates old entries via garbage collection, no manual reset
    // needed) by _applySuggestionPreviewRepositioning below. Always the
    // basis the shift is added to, never accumulated onto an
    // already-shifted value, so re-running the shift pass (every repaint,
    // including a settings toggle) is idempotent.
    this._previewOriginalX = new WeakMap();
    // The cached suggestion for the pair ENDING at each positioned glyph,
    // recorded by the same once-per-frame pass that does the shifting, so
    // the band/label draw and the shift can never disagree about which
    // pairs have a suggestion. `undefined` means "no cache entry for that
    // pair" and draws nothing (spec §10: never a placeholder or a zero) --
    // distinct from a cached entry whose value happens to be 0.
    this._previewPairValue = new WeakMap();

    this.visualizationLayers = new VisualizationLayers(
      [
        ...visualizationLayerDefinitions,
        this.buildAutokernSuggestionVisualizationLayerDefinition(),
      ],
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

    // Backlog item 10: the preview's glyph re-spacing runs ONCE per frame,
    // here, BEFORE any visualization layer draws. It used to run from inside
    // the suggestion layer's own draw function, which is one frame too late:
    // VisualizationLayers walks its definitions array in plain array order
    // and never sorts, and this view appends its layer to a copy of the
    // shared array rather than going through
    // registerVisualizationLayerDefinition (the only thing that inserts by
    // zIndex) -- so the layer's declared zIndex of 195 had no effect and it
    // drew LAST, after "fontra.context.glyphs" (zIndex 200) had already
    // painted every glyph at the previous frame's x. The whole preview was
    // therefore one repaint behind: toggling it (eye icon or the P hotkey)
    // requested a repaint that still showed the old positions, and the next
    // unrelated repaint -- a pointer click, a Space-drag pan, a settings
    // checkbox -- was what finally revealed the change, which read as those
    // actions turning the preview on or off.
    const sceneView = new SceneView(this.sceneModel, (model, controller) => {
      this._applySuggestionPreviewRepositioning(model);
      this.visualizationLayers.drawVisualizationLayers(
        new VisualizationContext(model, controller)
      );
    });
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

    // Font-level (not per-glyph) undo for pair-table writes and derive-accept
    // class writes -- see writePairValues's and acceptDeriveProposal's own
    // comments, and initUndoActions/callDelegateMethod below for how this
    // reaches Ctrl-Z. Same construction BaseInfoPanel uses
    // (views-fontinfo/src/panel-base.js's `this.undoStack = new UndoStack()`)
    // for exactly the same reason: a non-per-glyph, font-root-key edit still
    // needs to be locally undoable, and UndoStack itself needs no font data,
    // so building it here in the constructor is safe (unlike the font-data
    // reads that crashed construction order before, see the comment on
    // start() below).
    this.autokernUndoStack = new UndoStack();

    this.initColumnSplitters();
    this.initToolSwitcher();
    this.initChipSection();
    this.initToolShortcuts();
    this.initUndoActions();

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
    this.initSuggestionPreviewSettingsSection();
    this.initSuggestionPreviewToggle();
    this.initRunSection();
    // Awaited: initPairTableSection is async and awaits
    // fontController.getKerningController internally to build
    // this.kerningController. It used to be called without awaiting here,
    // so start() raced ahead into initFontModeSection/initClassPanelSection
    // below before this.kerningController existed -- initClassPanelSection's
    // own initial renderClassList() call (guarded to no-op when
    // this.kerningController is still undefined) silently did nothing, so
    // existing classes only appeared once some later action (e.g. creating
    // a class) called renderClassList() again after the controller had
    // since become available. The comment on initClassPanelSection below
    // already assumed "runs after it" meant "runs after it completes" --
    // true only once this call is actually awaited.
    await this.initPairTableSection();
    this.initAutokernStatusSection();
    // Design doc §2: font mode. Needs this.fontController.glyphMap (populated
    // by super.start() above), so it can't run from the constructor the same
    // way initChipSection does -- see the file-top comment above start()
    // itself for why font-data reads belong here, not in the constructor.
    this.initFontModeSection();
    // Design doc §1.2: the class panel, in #autokern-class-panel-slot.
    // Needs this.kerningController (built in initPairTableSection, just
    // above) for groupsSide1/groupsSide2, so it runs after it.
    this.initClassPanelSection();
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
    this.appendPresetOptions(this.phrasePresets);

    // Backlog item 1: "Add…" button beside the dropdown, opening a hidden
    // file input (panel-reference-font.js's own hidden-input-plus-button
    // convention). Chosen file's presets are APPENDED to this.phrasePresets,
    // not a replacement -- appending is the least-surprising default for a
    // designer adding a second presets file on top of the built-in one; the
    // backlog doc left this as an open product decision.
    const presetAddButton = document.querySelector("#kerning-preset-add-button");
    const presetFileInput = document.querySelector("#kerning-preset-file-input");
    presetAddButton.addEventListener("click", () => presetFileInput.click());
    presetFileInput.addEventListener("change", async () => {
      const file = presetFileInput.files[0];
      presetFileInput.value = null;
      if (!file) {
        return;
      }
      const addedText = await file.text();
      const addedPresets = parsePhrasePresets(addedText);
      this.phrasePresets = [...this.phrasePresets, ...addedPresets];
      this.appendPresetOptions(addedPresets);
    });
  }

  appendPresetOptions(presets) {
    const presetSelect = document.querySelector("#kerning-preset-select");
    for (const preset of presets) {
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
      // Task 5, spec F18: "add an upper threshold." Blank/null means no
      // maximum (inclusive bound, same as the minimum above) -- see
      // passesNumericFilters in results-model.js.
      maxThreshold: null,
      // Backlog item 8 part 1: a SECOND, independent threshold -- divergence
      // of a shadowing pair's suggestion from the value its class cell
      // currently resolves to (isOverrideCandidate / overrideDivergence),
      // not from the pair's own stored value (that is `threshold` above).
      // Display-only: it never feeds the run or the cache, only the
      // pair-table render path (the "Potential overrides" section and the
      // outlier-dropped class×class median). Default 10 font units.
      groupThreshold: 10,
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
      ["#kerning-param-group-threshold", "groupThreshold", Number],
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

    // Task 5, spec F18: "use inclusive bounds; a blank maximum means no
    // maximum. Reject a minimum greater than the maximum with an inline
    // explanation." Handled separately from the generic `bindings` loop
    // above because Number("") is 0, not "no maximum".
    const maxThresholdInput = document.querySelector("#kerning-param-max-threshold");
    maxThresholdInput.value = params.maxThreshold ?? "";
    maxThresholdInput.addEventListener("change", () => {
      const raw = maxThresholdInput.value.trim();
      const newMax = raw === "" ? null : Number(raw);
      const minThreshold = this.autokernParamsController.model.threshold;
      if (newMax != null && (!Number.isFinite(newMax) || newMax < 0)) {
        maxThresholdInput.setCustomValidity("Maximum |Δ| must be a non-negative number.");
        maxThresholdInput.reportValidity();
        maxThresholdInput.value = this.autokernParamsController.model.maxThreshold ?? "";
        return;
      }
      if (newMax != null && newMax < minThreshold) {
        maxThresholdInput.setCustomValidity(
          "Maximum |Δ| cannot be smaller than Minimum |Δ|."
        );
        maxThresholdInput.reportValidity();
        maxThresholdInput.value = this.autokernParamsController.model.maxThreshold ?? "";
        return;
      }
      maxThresholdInput.setCustomValidity("");
      this.autokernParamsController.setItem("maxThreshold", newMax);
    });

    // Threshold filters the pair table's display (spec §7.2: "filters the
    // display, on the delta"), not just the run -- re-render on every
    // change, including scrubs from other bound copies of the control.
    this.autokernParamsController.addKeyListener("threshold", () => {
      this.renderPairTable();
    });
    // Task 5: same wiring as threshold above -- maxThreshold only affects
    // the pair table's own display filter.
    this.autokernParamsController.addKeyListener("maxThreshold", () => {
      this.renderPairTable();
    });

    // Backlog item 8 part 1: same display-only re-render wiring as threshold
    // above -- groupThreshold changes what the "Potential overrides" section
    // and the class×class median show, nothing else.
    this.autokernParamsController.addKeyListener("groupThreshold", () => {
      this.renderPairTable();
    });
  }

  // Backlog items 9+10, closed together as one settings-driven mechanism
  // (see the docstring on buildAutokernSuggestionVisualizationLayerDefinition
  // and _applySuggestionPreviewRepositioning below for what each setting
  // actually gates):
  //
  // - "enabled" is the master switch -- item 9's actual ask: an eye icon in
  //   the preview pane's own upper-right corner, plus a hotkey (initSuggestionPreviewToggle
  //   below), not a settings-panel checkbox -- the accordion checkbox this
  //   used to be was a wrong first reading and has been removed; the eye icon
  //   and hotkey are the only master control now. Defaults to true, matching
  //   the pre-existing "suggest: N" label's own defaultOn: true, so nobody
  //   who never touches either control sees a behavior change.
  // - "opacity" (item 2a) is applied (context.globalAlpha) to the two visual
  //   elements this feature draws under its own control: the highlight band
  //   and the "suggest: N" label. It is NOT applied to the re-spaced glyph's
  //   own fill -- that fill is drawn by views-editor's shared
  //   "fontra.context.glyphs" layer (visualization-layer-definitions.js),
  //   which this view is constrained to import, not edit (assignment: "don't
  //   touch anything outside views-kerning"). The glyph is still genuinely
  //   moved (see _applySuggestionPreviewRepositioning) -- only its opacity
  //   isn't independently adjustable from here. Flagged as a deliberate
  //   divergence, not an oversight.
  // - "showNumbers" (item 2b) toggles the "suggest: N" label independently of
  //   the band/re-spacing, exactly as asked.
  // - "showBand" (item 2c) toggles the highlight band (the fillRect + dashed
  //   boundary lines already drawn today) specifically, and its own control
  //   is disabled (not merely inert) whenever the master toggle is off --
  //   _updateSuggestionPreviewControlsEnabled below, same
  //   element.disabled = !enabled convention
  //   panel-designspace-navigation.js's _updateCoarseGridControlsEnabled uses
  //   for its own toggle's dependent controls. Chosen reading of the
  //   assignment's admittedly ambiguous wording ("a checkbox that
  //   shows/enables the overlay... depends on the preview toggle being on"):
  //   "the overlay" here means the band specifically (the one visual element
  //   distinct from both re-spacing itself and the numeric label, which
  //   already have their own controls), and "the preview toggle" is this
  //   section's own master "enabled" switch.
  //
  // Re-spacing itself (item 10) is NOT gated by any of these three settings
  // individually -- only by "enabled" -- and works in both pair and phrase
  // mode unconditionally once "enabled" is on (assignment: "This must work in
  // BOTH... not gated behind an extra checkbox").
  initSuggestionPreviewSettingsSection() {
    this.suggestionPreviewSettings = new ObservableController({
      enabled: true,
      opacity: 1,
      showNumbers: true,
      showBand: true,
    });
    this.suggestionPreviewSettings.synchronizeWithLocalStorage(
      "fontra-kerning-suggestion-preview."
    );

    const settings = this.suggestionPreviewSettings.model;

    const opacityInput = html.input({
      type: "range",
      id: "kerning-suggestion-preview-opacity",
      min: "0",
      max: "1",
      step: "0.05",
    });
    opacityInput.value = String(settings.opacity);
    opacityInput.addEventListener("input", () => {
      this.suggestionPreviewSettings.setItem("opacity", Number(opacityInput.value));
    });

    const numbersToggle = html.input({
      type: "checkbox",
      id: "kerning-suggestion-preview-numbers",
    });
    numbersToggle.checked = settings.showNumbers;
    numbersToggle.addEventListener("change", () => {
      this.suggestionPreviewSettings.setItem("showNumbers", numbersToggle.checked);
    });

    const bandToggle = html.input({
      type: "checkbox",
      id: "kerning-suggestion-preview-band",
    });
    bandToggle.checked = settings.showBand;
    bandToggle.addEventListener("change", () => {
      this.suggestionPreviewSettings.setItem("showBand", bandToggle.checked);
    });
    this._suggestionPreviewBandToggle = bandToggle;

    const content = html.div(
      {
        style: `
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5em;
          align-items: center;
        `,
      },
      [
        html.label({ for: "kerning-suggestion-preview-opacity" }, ["Opacity"]),
        opacityInput,
        html.label({ for: "kerning-suggestion-preview-numbers" }, ["Show numbers"]),
        numbersToggle,
        html.label({ for: "kerning-suggestion-preview-band" }, ["Show highlight band"]),
        bandToggle,
      ]
    );

    const accordion = new Accordion();
    accordion.items = [
      {
        id: "kerning-suggestion-preview-accordion-item",
        label: "Suggestion preview",
        open: false,
        content,
      },
    ];
    document
      .querySelector("#kerning-suggestion-preview-section")
      .appendChild(accordion);

    this._updateSuggestionPreviewControlsEnabled();

    this.suggestionPreviewSettings.addListener(() => {
      this._updateSuggestionPreviewControlsEnabled();
      this.canvasController.requestUpdate();
    });
  }

  _updateSuggestionPreviewControlsEnabled() {
    if (this._suggestionPreviewBandToggle) {
      this._suggestionPreviewBandToggle.disabled =
        !this.suggestionPreviewSettings.model.enabled;
    }
  }

  // Backlog #9's actual ask: an eye icon in the preview pane's own
  // upper-right corner, plus a hotkey, as the ONE master on/off control for
  // the suggestion-preview overlay (re-spacing + band + label) -- not a
  // settings-panel checkbox (that was this feature's first, wrong reading;
  // removed). Same <icon-button>/tabler-icons construction the class panel's
  // delete button already uses (assigning the `src` PROPERTY, not the
  // attribute -- see that code's own comment on why the attribute crashes).
  initSuggestionPreviewToggle() {
    const button = document.createElement("icon-button");
    button.id = "kerning-suggestion-preview-toggle";
    button.setAttribute("data-tooltipposition", "left");

    const updateButton = () => {
      const enabled = this.suggestionPreviewSettings.model.enabled;
      button.src = enabled ? "/tabler-icons/eye.svg" : "/tabler-icons/eye-closed.svg";
      button.setAttribute(
        "data-tooltip",
        `${enabled ? "Hide" : "Show"} suggestion preview (P)`
      );
    };
    updateButton();

    // One copy of the toggle (rail R-B), called by both the icon and the
    // hotkey. The hotkey used to call button.onclick() instead, which throws:
    // IconButton declares a SETTER for onclick and no getter (it forwards the
    // callback to its inner <button> and deliberately never assigns
    // this.onclick), so reading it back gives undefined. IconButton.click()
    // would work, but routing a keystroke through the DOM to reach a setting
    // this method already owns is a detour.
    const toggle = () =>
      this.suggestionPreviewSettings.setItem(
        "enabled",
        !this.suggestionPreviewSettings.model.enabled
      );
    button.onclick = toggle;
    this.suggestionPreviewSettings.addListener(updateButton);

    document
      .querySelector("#kerning-suggestion-preview-toggle-container")
      .appendChild(button);

    registerAction(
      "action.kerning.toggle-suggestion-preview",
      {
        topic: "0020-action-topics.menu.view",
        titleKey: "kerning.toggle-suggestion-preview",
        // Lowercase, matching every other single-letter hotkey in this tree
        // (editor.js: "q", "z", "d", ...) -- getBaseKeyFromKeyEvent resolves
        // the Keyboard API layout map / fallback keycode path to a lowercase
        // letter, so an uppercase baseKey here never matches and the hotkey
        // silently never fires.
        //
        // Same text-field guard as action.kerning.toggle-chip above: bail out
        // while a text input/textarea/select has focus rather than hijacking
        // the keystroke.
        defaultShortCuts: [{ baseKey: "p" }],
      },
      () => {
        const activeTag = document.activeElement?.tagName;
        if (
          activeTag === "TEXTAREA" ||
          activeTag === "INPUT" ||
          activeTag === "SELECT"
        ) {
          return;
        }
        toggle();
      }
    );
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
    // Task 12: loadAutokernCacheFromStorage's own stale-read guard.
    this.autokernCacheLoadRevision = 0;
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
  // Task 12, spec F26/§12.3: guards against a rapid double source-switch --
  // the OPFS read below is the one async, per-source read in this file that
  // can race. Plan's own proposed pattern (results-model.js's
  // isStaleAsyncResult, pure and tested on its own): capture the revision
  // and the source this call means BEFORE awaiting, and refuse to install
  // whichever read resolves last if either moved on while it was in flight
  // -- an older read finishing after a newer one must not clobber it, and a
  // read begun for a source that is no longer selected must not be shown
  // under the new source's label.
  async loadAutokernCacheFromStorage() {
    const revisionAtStart = ++this.autokernCacheLoadRevision;
    const sourceIdentifierAtStart = this.autokernSource;
    const entries = await readAutokernCacheFromOPFS(
      this.projectIdentifier,
      sourceIdentifierAtStart
    );
    if (
      isStaleAsyncResult(
        revisionAtStart,
        this.autokernCacheLoadRevision,
        sourceIdentifierAtStart,
        this.autokernSource
      )
    ) {
      return;
    }
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

    // Spec §4.2: the excluded-glyph field's own already-parsed list
    // (initPairTableSection, on `this.autokernExcludedGlyphNames` -- parsed
    // by parseExcludedGlyphNames, kept in sync with the field on load and on
    // every "change"). Read here, not re-parsed: one source of truth for
    // what "excluded" means. Falls back to an empty array if the pair-table
    // section hasn't initialized yet (initRunSection and
    // initPairTableSection both run from start(), but nothing enforces their
    // order against each other).
    //
    // Control glyphs (CONTROL_GLYPH_NAMES) are deliberately NOT filtered out
    // of the candidate pool here even if a designer names one in the
    // excluded-glyph field: calibration (below) structurally requires their
    // rasters, and excluding "l"/"n"/"o" from being KERNED against other
    // glyphs is still honored -- see glyphsToRasterize below, which unions
    // CONTROL_GLYPH_NAMES back in only for rasterization, not for
    // `glyphNames` (the candidate pool the worker turns into pairs), so a
    // designer who excludes a control glyph still gets calibration but no
    // pairs involving it, which is the sensible reading of "excluded from a
    // run" for a glyph the run structurally cannot omit entirely.
    const excludedGlyphNames = this.autokernExcludedGlyphNames || [];
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

    const dialog = await dialogSetup("Running autokern", null, [
      { title: "Cancel", resultValue: "cancel", isCancelButton: true },
    ]);
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

    // Task 3 (spec F04/F24/F25): highlight (preview selection) and tick
    // (action-target selection) are two independent Sets of row IDs, kept
    // outside the DOM -- see results-selection.js. renderPairTable prunes
    // this after every rebuild (F25); Deselect below clears it (F24).
    this.resultSelection = deselectAll();

    // Task 11, spec F10, ledger §8.5 (APPROVED): a class-summary row's own
    // hidden state, keyed by its own stable rowId. Unlike a pair row's
    // hidden state (the OPFS/project-persisted cache `junk` field, one
    // entry per literal pair -- see pairRowData/togglePairJunk), a
    // class-summary row has no per-row cache entry to carry a flag on
    // (its "current" is a computed aggregate, not a stored cache entry) --
    // ponytail: in-memory only for now, lost on reload, the same honesty
    // this.autokernAppliedPairs above already documents for its own
    // session-only state; add project-customData persistence (matching
    // AUTOKERN_JUNK_PAIRS_CUSTOM_DATA_KEY's pattern) if designers need a
    // hidden class row to survive a reload.
    this.hiddenClassRuleIds = new Set();

    this.autokernFiltersController = new ObservableController({
      glyphName: "",
      excludedGlyphs: "",
      side: "both",
      // Task 5, spec F16: the sign filter is removed -- Current/Proposed/
      // Delta keep their signs, magnitude filtering lives in
      // autokernParamsController's threshold/maxThreshold below. A
      // pre-existing "sign" value synced in from localStorage is simply
      // never read by anything anymore.
      state: "pending",
      // Task 11, spec F17: renamed from `showJunk` ("Show junk" -> "Show
      // hidden") -- this is the per-browser display-filter setting, not
      // the font/cache's own stored `junk` field (that stays as-is, see
      // pairRowData's own comment), so renaming this key is not a data
      // migration, the same way Task 8/9 already left old persisted keys
      // (bucket/status/sortColumn "state") unread rather than migrated.
      showHidden: false,
      // Task 5, spec F13: "Provide a Columns menu with independent
      // visibility controls for Current, Proposed, and Delta." Current
      // defaults hidden (unchanged pre-existing behavior); Proposed and
      // Delta default visible (Task 5's own migration default: "all
      // visible").
      showCurrent: false,
      showProposed: true,
      // Backlog item 15: hides/shows the Delta column across the whole
      // table.
      showSuggestion: true,
      // Task 5, spec F13: exact predicate `Current == 0 && Proposed != 0`,
      // applied in pairRowVisible via results-model.js's
      // passesNumericFilters. Does not apply to a stale/unavailable
      // suggestion (Task 5's own decision note: its warning must stay
      // discoverable).
      hideZeroCurrentSuggestions: false,
      // Task 9, spec F09/F14, ledger §8.3/§8.4: two multi-select filters,
      // persisted as plain arrays (JSON-safe for synchronizeWithLocalStorage
      // below -- Sets don't round-trip through JSON.stringify/parse), read
      // as Sets only at the point results-model.js's predicates need one
      // (plan Task 9's own bullet: "Normalize persisted arrays into Sets at
      // the UI boundary and back into arrays for storage"). Replaces the old
      // hideNonStandalone/hideNumbers/hidePunctuation ad hoc checkboxes
      // (Backlog item 3) entirely -- same glyph-data.js category source,
      // now the one dropdown F09 asks for.
      //
      // unicodeTypes defaults to every category except "non-unicode" (F09:
      // "unchecked by default"), so this replacement does not itself hide
      // any row that was visible before Task 9.
      unicodeTypes: [
        "uppercase",
        "lowercase",
        "punctuation",
        "symbols",
        "marks",
        "numbers",
      ],
      // relationships defaults to all four buckets checked -- F14 is a new
      // filter with no prior equivalent, so "everything" is the only
      // non-restrictive default.
      relationships: ["class-class", "class-unique", "unique-unique", "exceptions"],
      // F14: All by default (ledger §8.4), a glyphset URL/key otherwise.
      tableGlyphsetId: null,
      // Backlog item 11: sortColumn is one of "glyph" (Glyph L/Glyph R
      // headers, left+right localeCompare) / "current" / "delta" (the
      // table's own suggestion display). Task 8: "state" is no longer a
      // valid value -- its column is gone (F01/F23's stale section, Tasks
      // 15/17, replaces it; this filter model's own "state" select stays
      // for now, that removal is those tasks' job, not this one's, but
      // SORTING by it is this task's own bullet: "Remove status sorting
      // when the status column disappears"). Defaults reproduce the old
      // toggle's own default ("worst delta first") exactly.
      sortColumn: "delta",
      sortDirection: "desc",
      // Task 8, spec F22: "Add Show individual class members, off by
      // default, for broad exposure without entering each member
      // explicitly." Replaces the old per-bucket "Fold classes" escape
      // hatch (WORKSTREAM 15/layout overhaul) -- that toggle used to REPLACE
      // a class summary with its ungrouped member rows; this checkbox ADDS
      // member rows alongside the summary instead (spec §2.1 invariant 6:
      // exposing a member must not remove its class summary), which is a
      // deliberate, designer-visible behavior change, not a rename.
      showIndividualMembers: false,
    });
    this.autokernFiltersController.synchronizeWithLocalStorage(
      "fontra-kerning-pairtable-filters."
    );
    // Task 8, spec F11: a browser that used the pre-Task-8 four-bucket
    // "grouping" filter or the "foldClasses" toggle has those keys
    // persisted in localStorage; synchronizeWithLocalStorage above restores
    // them onto this.autokernFiltersController.model even though neither
    // key is declared above and neither is read by renderPairTable anymore
    // -- ObservableObject/synchronizeWithLocalStorage do not prune unknown
    // persisted keys. Harmless (nothing reads them), left in place rather
    // than deleted, so a designer's other unrelated persisted filter values
    // on the same key prefix are not disturbed by an extra write here.
    // Task 8: a browser with a persisted sortColumn of "state" (the now-
    // removed State column/sort) would otherwise silently fall back to
    // sortPairRows' own default-case delta sort forever without the header
    // ever showing as active -- reset the stored value itself so the
    // headers and the actual sort agree.
    if (this.autokernFiltersController.model.sortColumn === "state") {
      this.autokernFiltersController.setItem("sortColumn", "delta");
    }
    const filters = this.autokernFiltersController.model;

    const glyphInput = document.querySelector("#kerning-pairtable-glyph");
    glyphInput.value = filters.glyphName;
    glyphInput.addEventListener("input", () => {
      this.autokernFiltersController.setItem("glyphName", glyphInput.value.trim());
      this.updatePairPreview();
    });
    this._glyphInputElement = glyphInput;

    // Task 6, spec F07: "Ordinary clicks on preview glyphs do not change the
    // Glyph input." The pre-existing "left-pane selection override" listener
    // that used to live here (sceneSettings.selectedGlyphName -> glyphInput.
    // value on every single-glyph selection, including a plain click) did
    // exactly what F07 now forbids, so it is removed rather than modified --
    // there is no reduced form of "every selection change edits the input"
    // that is still correct. Its replacement is deliberate-only: Ctrl+Click
    // and Shift+Ctrl+Click on a preview glyph, wired in edit-tools-select.js
    // to this.handleGlyphInputModifierClick below.

    // Task 7, spec F06/F22: replaces the old exception input. Holds a
    // comma-separated list of single glyph-tokens -- the "other side" of
    // the pair, relative to whatever is in Glyph (ledger §8.1).
    const pairInput = document.querySelector("#kerning-pairtable-pair");
    const pairInputError = document.querySelector("#kerning-pairtable-pair-error");
    pairInput.addEventListener("input", () => {
      this.updatePairPreview();
      // Task 9: the Pair input isn't part of the persisted filter model
      // (it only ever restricts preview, per F06 -- unchanged by this
      // task), so it doesn't trigger renderPairTable on its own; the
      // non-Unicode note still needs to react to it directly.
      this.updateNonUnicodeNote();
    });
    this._pairInputElements = { glyphInput, pairInput, pairInputError };

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
      storedExcludedGlyphs !== undefined
        ? storedExcludedGlyphs
        : filters.excludedGlyphs;
    excludedInput.value = initialExcludedGlyphs;
    if (initialExcludedGlyphs !== filters.excludedGlyphs) {
      this.autokernFiltersController.setItem("excludedGlyphs", initialExcludedGlyphs);
    }
    // The single source of truth for a RUN's excluded-glyph list
    // (runAutokern reads this property, not the raw text field): parsed
    // once here at load and again on every "change" below, via
    // parseExcludedGlyphNames (this method's own comment explains why that
    // parser, not a second one). Kept as a plain instance property, not a
    // key on this.autokernFiltersController, because that controller is
    // localStorage-synchronized (synchronizeWithLocalStorage above) and the
    // raw text it already stores (`excludedGlyphs`) is enough to
    // reconstruct this on reload -- a second, redundant persisted copy of
    // the same data would just be one more place for the two to disagree.
    this.autokernExcludedGlyphNames =
      this.parseExcludedGlyphNames(initialExcludedGlyphs);
    excludedInput.addEventListener("change", async () => {
      // Stored on the controller (as before), reparsed into
      // this.autokernExcludedGlyphNames (the property runAutokern actually
      // reads -- see the comment above), AND, since workstream 12, written
      // through to the project (see the file-top comment for the exact
      // mechanism).
      this.autokernFiltersController.setItem("excludedGlyphs", excludedInput.value);
      this.autokernExcludedGlyphNames = this.parseExcludedGlyphNames(
        excludedInput.value
      );
      await this.fontController.performEdit(
        "kerning view: edit excluded glyphs",
        "customData",
        (root) => {
          if (excludedInput.value) {
            root.customData[AUTOKERN_EXCLUDED_GLYPHS_CUSTOM_DATA_KEY] =
              excludedInput.value;
          } else {
            delete root.customData[AUTOKERN_EXCLUDED_GLYPHS_CUSTOM_DATA_KEY];
          }
        },
        this
      );
    });

    const selectBindings = [
      ["#kerning-pairtable-filter-side", "side"],
      ["#kerning-pairtable-filter-state", "state"],
    ];
    for (const [selector, key] of selectBindings) {
      const element = document.querySelector(selector);
      element.value = filters[key];
      element.addEventListener("change", () => {
        this.autokernFiltersController.setItem(key, element.value);
      });
    }

    // Task 11, spec F17: "Show junk" -> "Show hidden."
    const showHiddenCheckbox = document.querySelector(
      "#kerning-pairtable-filter-hidden"
    );
    showHiddenCheckbox.checked = filters.showHidden;
    showHiddenCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem("showHidden", showHiddenCheckbox.checked);
    });

    const currentCheckbox = document.querySelector("#kerning-pairtable-show-current");
    currentCheckbox.checked = filters.showCurrent;
    currentCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem("showCurrent", currentCheckbox.checked);
    });

    // Backlog item 15: mirrors the showCurrent checkbox immediately above.
    const suggestionCheckbox = document.querySelector(
      "#kerning-pairtable-show-suggestion"
    );
    suggestionCheckbox.checked = filters.showSuggestion;
    suggestionCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem(
        "showSuggestion",
        suggestionCheckbox.checked
      );
    });

    // Task 5, spec F13: Proposed column visibility, same pattern as
    // showCurrent/showSuggestion above.
    const proposedCheckbox = document.querySelector("#kerning-pairtable-show-proposed");
    proposedCheckbox.checked = filters.showProposed;
    proposedCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem("showProposed", proposedCheckbox.checked);
    });

    // Task 5, spec F13: the exact `Current == 0 && Proposed != 0` predicate,
    // independent of column visibility above.
    const hideZeroCurrentCheckbox = document.querySelector(
      "#kerning-pairtable-hide-zero-current"
    );
    hideZeroCurrentCheckbox.checked = filters.hideZeroCurrentSuggestions;
    hideZeroCurrentCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem(
        "hideZeroCurrentSuggestions",
        hideZeroCurrentCheckbox.checked
      );
    });

    // Task 9, spec F09/F14: binds one checkbox group to one array-valued
    // filter key -- checking/unchecking one box adds/removes its value from
    // the persisted array (OR-combined by results-model.js's predicates at
    // render time, never re-derived here).
    const bindCheckboxGroup = (bindings, key) => {
      for (const [selector, value] of bindings) {
        const checkbox = document.querySelector(selector);
        checkbox.checked = filters[key].includes(value);
        checkbox.addEventListener("change", () => {
          const current = new Set(this.autokernFiltersController.model[key]);
          if (checkbox.checked) {
            current.add(value);
          } else {
            current.delete(value);
          }
          this.autokernFiltersController.setItem(key, [...current]);
        });
      }
    };
    bindCheckboxGroup(
      [
        ["#kerning-pairtable-unicode-uppercase", "uppercase"],
        ["#kerning-pairtable-unicode-lowercase", "lowercase"],
        ["#kerning-pairtable-unicode-punctuation", "punctuation"],
        ["#kerning-pairtable-unicode-symbols", "symbols"],
        ["#kerning-pairtable-unicode-marks", "marks"],
        ["#kerning-pairtable-unicode-numbers", "numbers"],
        ["#kerning-pairtable-unicode-non-unicode", "non-unicode"],
      ],
      "unicodeTypes"
    );
    bindCheckboxGroup(
      [
        ["#kerning-pairtable-rel-class-class", "class-class"],
        ["#kerning-pairtable-rel-class-unique", "class-unique"],
        ["#kerning-pairtable-rel-unique-unique", "unique-unique"],
        ["#kerning-pairtable-rel-exceptions", "exceptions"],
      ],
      "relationships"
    );

    // Task 9, spec F14: the table Glyphset filter. Reuses the existing
    // glyphsets-controller.js primitives (readProjectGlyphSets/
    // getMyGlyphSets/GlyphSetsController) that views-fontoverview.js
    // already wires up the same way -- this view only lists glyphsets the
    // project has already added, it does not offer an "add glyphset" UI of
    // its own (that already lives in Font Overview/the editor). Kept
    // entirely separate from the Font-mode preview glyphset selector
    // (F08/Task 13) -- distinct scopes, distinct controllers.
    this.tableGlyphsetSettingsController = new ObservableController({
      projectGlyphSets: readProjectGlyphSets(this.fontController),
      myGlyphSets: getMyGlyphSets(),
      projectGlyphSetSelection: [],
      myGlyphSetSelection: [],
    });
    this.tableGlyphsetsController = new GlyphSetsController(
      this.fontController,
      this.tableGlyphsetSettingsController
    );
    // null == "All", no restriction (ledger §8.4); populated below whenever
    // a real glyphset is selected. Read by pairRowVisible/
    // classClassRowVisible via pairMatchesGlyphset.
    this._tableGlyphsetMembers = null;

    const glyphsetSelect = document.querySelector("#kerning-pairtable-filter-glyphset");
    const glyphsetSettings = this.tableGlyphsetSettingsController.model;
    for (const info of Object.values({
      ...glyphsetSettings.projectGlyphSets,
      ...glyphsetSettings.myGlyphSets,
    })) {
      // THIS_FONTS_GLYPHSET ("") means "the font's own glyphs" -- that's
      // already what "All" means for this filter, so it isn't offered as a
      // second, redundant option.
      if (info.url === THIS_FONTS_GLYPHSET) {
        continue;
      }
      const option = document.createElement("option");
      option.value = info.url;
      option.textContent = info.name;
      glyphsetSelect.appendChild(option);
    }
    glyphsetSelect.value = filters.tableGlyphsetId || "";

    const applyTableGlyphsetSelection = async (glyphsetId) => {
      if (!glyphsetId) {
        this._tableGlyphsetMembers = null;
      } else {
        const entries = await this.tableGlyphsetsController.loadGlyphSet(glyphsetId);
        // ponytail: membership by the glyphset's own literal glyph name
        // only, no font-characterMap disambiguation (that's
        // getCombinedGlyphMap's own job for the different "merge glyph
        // sets into one browsable map" feature). Correct whenever the
        // glyphset's names already match the font's; upgrade to the
        // disambiguated cross-reference if a real project's glyphset uses
        // different names for the same character than this font does.
        this._tableGlyphsetMembers = new Set(entries.map((entry) => entry.glyphName));
      }
      this.renderPairTable();
    };
    if (filters.tableGlyphsetId) {
      applyTableGlyphsetSelection(filters.tableGlyphsetId);
    }
    glyphsetSelect.addEventListener("change", () => {
      const glyphsetId = glyphsetSelect.value || null;
      this.autokernFiltersController.setItem("tableGlyphsetId", glyphsetId);
      applyTableGlyphsetSelection(glyphsetId);
    });

    // Task 8, spec F22: broad member exposure, off by default -- see the
    // filters-controller comment above (replaces the old "Fold classes"
    // toggle).
    const showMembersCheckbox = document.querySelector("#kerning-pairtable-show-members");
    showMembersCheckbox.checked = filters.showIndividualMembers;
    showMembersCheckbox.addEventListener("change", () => {
      this.autokernFiltersController.setItem(
        "showIndividualMembers",
        showMembersCheckbox.checked
      );
    });

    // Backlog item 11: click a column header to sort by it, click again to
    // flip direction -- one sort UI (headers), not two (the old toggle
    // button is gone). Global across all four bucket tables, same scope the
    // old toggle button had; clicking any one bucket's header updates the
    // shared filters model, and updateSortHeaders (called from every
    // renderPairTable) keeps every bucket's headers in sync with it.
    for (const th of document.querySelectorAll(".kerning-pairtable-sortable")) {
      th.addEventListener("click", () => {
        const column = th.dataset.sortColumn;
        const current = this.autokernFiltersController.model;
        if (current.sortColumn === column) {
          this.autokernFiltersController.setItem(
            "sortDirection",
            current.sortDirection === "desc" ? "asc" : "desc"
          );
        } else {
          this.autokernFiltersController.setItem("sortColumn", column);
          // Delta's default direction matches the old toggle's own default
          // ("worst delta first" = descending by magnitude); every other
          // column defaults to ascending on first click.
          this.autokernFiltersController.setItem(
            "sortDirection",
            column === "delta" ? "desc" : "asc"
          );
        }
      });
    }

    this.autokernFiltersController.addListener(() => this.renderPairTable());

    document
      .querySelector("#kerning-pairtable-apply-selected")
      .addEventListener("click", () => this.applySelectedPairRows());

    // Task 4, spec F20: "Apply all", "Reset to current", and the
    // manual-value input are removed entirely (kerning.html) -- only Apply
    // selected and Reset selected (now a double-press-to-zero action)
    // remain.
    const resetZeroButton = document.querySelector("#kerning-pairtable-reset-zero");
    this._resetZeroDefaultLabel = resetZeroButton.textContent;
    this.resetArmedKey = null;
    resetZeroButton.addEventListener("click", () => this.resetSelectedPairRows());

    // Task 3, spec F24: Deselect clears highlight and tick only -- it does
    // not touch filters, class membership, or saved kerning.
    document.querySelector("#kerning-pairtable-deselect").addEventListener("click", () => {
      this.resultSelection = deselectAll();
      this.applyResultSelectionToDom();
      this.syncSelectAllCheckboxes();
      this.refreshResetArmState();
      // Task 7, spec F24: "Preview falls back according to the input/
      // selection rules in F06 when no highlighted rows remain."
      this.updatePairPreview();
    });

    // WORKSTREAM 15, spec §5.3: "The derive action sits beside the fold
    // toggle." this.autokernDeriveProposals holds nothing until Derive is
    // clicked, and stays empty (writes nothing) until a proposal is
    // individually accepted -- see deriveClasses/renderDeriveProposals/
    // acceptDeriveProposal below.
    this.autokernDeriveProposals = [];
    document
      .querySelector("#kerning-derive-button")
      .addEventListener("click", () => this.deriveClasses());

    // Task 8, spec F19: Default / Potential exceptions tabs. Wired once
    // here, like every other control in this method; renderPairTable reads
    // this.activeResultsTab and rebuilds the one row list for whichever tab
    // is active.
    this.activeResultsTab = "default";
    for (const tabButton of document.querySelectorAll(".kerning-pairtable-tab")) {
      tabButton.addEventListener("click", () => this.setResultsTab(tabButton.dataset.tab));
    }

    // Backlog item 13, Task 8: one select-all checkbox for the one table
    // (F11 removed the per-bucket tables, so there is only ever one now).
    // Wired once here, not rebuilt on every renderPairTable -- the
    // checkbox itself is static markup (kerning.html), only its checked/
    // indeterminate state and the rows it toggles change per render.
    for (const selectAll of document.querySelectorAll(
      ".kerning-pairtable-select-all"
    )) {
      selectAll.addEventListener("change", () => {
        // A real user click always clears indeterminate natively before this
        // handler runs; set it explicitly too so a programmatic `.checked =`
        // assignment (not a real click) still lands in a determinate
        // all-on/all-off state rather than leaving a stale indeterminate
        // flag behind.
        selectAll.indeterminate = false;
        for (const checkbox of this.getVisiblePairTableRowCheckboxes(
          selectAll.closest("table")
        )) {
          checkbox.checked = selectAll.checked;
          // Task 4: select-all sets .checked directly rather than firing a
          // "change" event per checkbox, so it must update
          // this.resultSelection itself -- otherwise Apply/Reset selected
          // (which now read the state, not the DOM) would silently ignore
          // rows ticked this way.
          const id = checkbox.closest("tr")?.dataset.rowId;
          if (id) {
            this.resultSelection = tickRow(this.resultSelection, id, selectAll.checked);
          }
        }
        this.refreshResetArmState();
      });
    }

    // Task 12, spec F26, ledger §5.5: "kerning.js itself does not subscribe
    // to either [kerning change pattern]... the pair table is refreshed
    // only by explicit local calls to renderPairTable() after actions THIS
    // view itself performs. An external kerning edit -- another open tab,
    // or the on-canvas KerningTool's own preview-drag edits in this same
    // view's left pane -- would not visibly update the table." This is
    // that subscription. Reuses the exact match-pattern shape
    // KerningController's own constructor already listens with (that
    // controller's cache invalidation and this table's refresh are two
    // separate, correctly-timed reactions to the SAME notification, not a
    // duplicated cache). `wantLiveChanges: true` (3rd arg) so a live
    // preview drag (fontController.editIncremental, throttled but real)
    // updates Current/Delta as it happens, not only once the drag commits
    // -- matches F26's "immediately as edits are reported." Current reads
    // (getGlyphPairValueForSource, Task 12's other fix) read straight from
    // kernData.values, not KerningController's own interpolation cache, so
    // there is no separate cache-freshness concern here to duplicate.
    // renderPairTable itself already does everything the plan's own
    // interface note asks for on every rebuild: recomputes each row's
    // Current/Delta from the unchanged Proposed cache entry against the
    // now-current stored value (pairRowData), preserves resultSelection for
    // any row ID still present, and prunes it for any row that no longer
    // matches (retainVisible, at renderPairTable's own end) -- so the
    // listener body is exactly one call, not a second parallel update path.
    this._kerningValuesChangeMatchPattern = {
      kerning: { [wildcard]: { values: null } },
    };
    this._kerningValuesChangeListener = () => this.renderPairTable();
    this.fontController.addChangeListener(
      this._kerningValuesChangeMatchPattern,
      this._kerningValuesChangeListener,
      true, // wantLiveChanges
      true // immediate
    );
    // "On view disposal, release the subscription." This app has no
    // internal view-teardown lifecycle to hook (grepped the whole tree:
    // no `dispose(`/`beforeunload`/`pagehide` anywhere -- each view is its
    // own full page load, per pyproject.toml's per-view entry points, torn
    // down only by browser navigation). "pagehide" is the real browser
    // event for exactly that moment; used here rather than inventing a
    // view-level dispose() this codebase has no other caller for.
    window.addEventListener("pagehide", () => this.disposeKerningChangeSubscription());

    this.renderPairTable();
  }

  // Task 12: the exact inverse of the addChangeListener call above --
  // removeChangeListener compares the matchPattern object by reference
  // (font-controller.js's own filterFunc), so the same object stored above
  // is reused here rather than a freshly-built equal-looking one (a new
  // `{kerning: {...}}` literal would never match and silently leak the
  // listener).
  disposeKerningChangeSubscription() {
    if (!this._kerningValuesChangeListener) {
      return;
    }
    this.fontController.removeChangeListener(
      this._kerningValuesChangeMatchPattern,
      this._kerningValuesChangeListener,
      true
    );
    this._kerningValuesChangeListener = null;
  }

  // Backlog item 13: every checkbox currently in the DOM is, by
  // construction, a currently-rendered/visible row -- renderPairTable
  // rebuilds the one tbody from scratch on every render (Task 8 removed
  // the old click-to-expand fold-parent/fold-children distinction that
  // used to need filtering out here; see buildClassSummaryRowElement).
  getVisiblePairTableRowCheckboxes(table) {
    return [...table.querySelectorAll(".kerning-pairtable-row-select")];
  }

  // Task 8, spec F19: switches which tab's row set renderPairTable builds.
  // Not itself a filter -- kept as its own piece of view state so a tab
  // switch reads exactly like any other renderPairTable trigger (filter
  // change, threshold change, run finishing).
  setResultsTab(tab) {
    if (tab !== "default" && tab !== "potential") {
      return;
    }
    this.activeResultsTab = tab;
    for (const tabButton of document.querySelectorAll(".kerning-pairtable-tab")) {
      const active = tabButton.dataset.tab === tab;
      tabButton.classList.toggle("kerning-pairtable-tab-active", active);
      tabButton.setAttribute("aria-selected", active ? "true" : "false");
    }
    this.renderPairTable();
  }

  // Backlog item 13: called at the end of every renderPairTable so each
  // bucket's select-all checkbox reflects the rows that render just put on
  // screen -- checked when every visible row in that table is checked,
  // indeterminate when some but not all are, unchecked when none are (or
  // the table has no rows at all).
  syncSelectAllCheckboxes() {
    for (const selectAll of document.querySelectorAll(
      ".kerning-pairtable-select-all"
    )) {
      const checkboxes = this.getVisiblePairTableRowCheckboxes(
        selectAll.closest("table")
      );
      const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
      selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
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
  // stored kerning for this exact glyph pair, addressed at the active
  // source (Task 12 fix, see activeSourceIdentifier below -- reads and
  // writes must agree on which source they mean). `delta` is the
  // suggestion minus that stored value (spec §7.3: "The delta is the
  // suggestion minus what is stored"), with no stored value read as 0.
  // Task 12 fix (kerning-ux-integration.md §5.4, spec F26/§12.3): every
  // rowId/read/write in this file used to resolve its source via
  // getSourceIdentifierForLocation({}, false), which always merges `{}`
  // with the font's defaultSourceLocation and so ALWAYS answers the
  // default source -- independent of the status-strip source selector.
  // This is the single place that used to do that; it now simply returns
  // the identifier the selector already set (this.autokernSource), no
  // location round-trip needed, since the view already knows the exact
  // source it means. Renamed from `defaultSourceIdentifier` to name what
  // it now actually returns.
  activeSourceIdentifier() {
    return this.autokernSource;
  }

  // Task 3: re-applies this.resultSelection onto whatever rows are
  // currently in the DOM -- called after every state change and after
  // every renderPairTable rebuild (tbodies are rebuilt from scratch each
  // time, so freshly built rows start with no selection styling).
  applyResultSelectionToDom() {
    for (const tr of document.querySelectorAll(".kerning-pairtable-table tr[data-row-id]")) {
      const id = tr.dataset.rowId;
      tr.classList.toggle(
        "kerning-pairtable-row-highlighted",
        this.resultSelection.highlighted.has(id)
      );
      const checkbox = tr.querySelector(".kerning-pairtable-row-select");
      if (checkbox) {
        checkbox.checked = this.resultSelection.ticked.has(id);
      }
    }
  }

  // Task 4, spec F20: "Changing targets must cancel the armed state so the
  // second press cannot affect a different set." Called after every
  // resultSelection change (tick, select-all, Deselect, filter-driven
  // pruning) so the button label never keeps advertising a target count
  // that no longer matches what's actually ticked.
  refreshResetArmState() {
    const currentTargetIds = [...this.resultSelection.ticked];
    const currentKey = currentTargetIds.length
      ? JSON.stringify([...currentTargetIds].sort())
      : null;
    if (this.resetArmedKey && this.resetArmedKey !== currentKey) {
      this.resetArmedKey = null;
    }
    this.updateResetButtonLabel();
  }

  updateResetButtonLabel() {
    const button = document.querySelector("#kerning-pairtable-reset-zero");
    if (!button) {
      return;
    }
    if (this.resetArmedKey) {
      const count = JSON.parse(this.resetArmedKey).length;
      button.textContent = `Reset ${count} row${count === 1 ? "" : "s"} to 0 — press again`;
    } else {
      button.textContent = this._resetZeroDefaultLabel;
    }
  }

  pairRowData(entry, classed) {
    // Task 12 fix: reads the exact source the status strip has selected
    // (this.autokernSource), the same identifier writePairValues/
    // applyFoldedParentRow/createPairException now write to -- not a
    // location-interpolated value at the font's default source.
    const current =
      this.kerningController.getGlyphPairValueForSource(
        entry.left,
        entry.right,
        this.autokernSource
      ) ?? 0;
    // Task 2 (kerning-ux-integration.md §5.1/§9): whether THIS literal
    // pair has an explicit stored rule, read via
    // KerningController.getPairValues -- true for a stored zero, false
    // only when nothing at all is stored for this exact address. Not
    // derived from `current`'s numeric value.
    const hasExplicitPair = explicitPairExists(
      this.kerningController,
      entry.left,
      entry.right
    );
    // Task 8's kind taxonomy (plan Task 2 text: "class-rule, unique-pair,
    // member-pair, or pair-exception"). A "member-pair"/"pair-exception"
    // distinction only exists for a pair that is actually part of a
    // class×class product (BOTH sides classed) -- that is the only case
    // with a real class-summary row for it to be exposed FROM (spec §2.1
    // invariant 5). A pair with only one classed side (this.bucketForPair's
    // "unique-class"/"class-unique") has no class-summary aggregate built
    // for it anywhere in this codebase, so it stays "unique-pair" and is
    // never exposure-gated, unchanged from its pre-Task-8 always-visible
    // behavior -- not this task's job to invent a second aggregate kind.
    const bothSidesClassed =
      this.isLeftClassed(entry.left) && this.isRightClassed(entry.right);
    const kind = !bothSidesClassed
      ? "unique-pair"
      : hasExplicitPair
        ? "pair-exception"
        : "member-pair";
    return {
      left: entry.left,
      right: entry.right,
      suggestion: entry.value,
      current,
      delta: entry.value - current,
      // Task 11, spec F10/F17: the cache/project storage field stays named
      // `junk` (results-model.js's hiddenFromCacheEntry is the one mapping
      // seam) -- the normalized row exposes it as `hidden`, the term the
      // rest of this task's UI/predicates use.
      hidden: hiddenFromCacheEntry(entry),
      stale: entry.stale,
      // Backlog item 8 part 5: a confirmed deliberate override (markPairOverride,
      // persisted in the OPFS cache entry) -- flips the row's shadow warning
      // to a neutral state label in buildPairRowElement.
      override: !!entry.override,
      classed,
      explicitPairExists: hasExplicitPair,
      kind,
      // F19: reuses the existing, already-built isOverrideCandidate
      // (wouldShadowClassCell AND divergence >= groupThreshold) -- this
      // does not compute a new candidate rule, per plan Task 8's own
      // interface ("consumes a candidate list supplied by the autokern
      // adapter; it does not calculate candidates").
      isCandidate: this.isOverrideCandidate(entry.left, entry.right, entry.value),
    };
  }

  // Every filter named in spec §7.3, composed with the threshold (§7.2: "the
  // threshold... filters the display, not the run"). Returns false the
  // moment any active filter rejects the row -- order doesn't matter, all
  // are independent AND conditions.
  //
  // Layout overhaul, design doc §1.1: the old "grouping" classed/flat check
  // that lived here is gone -- which BUCKET a row belongs to is now decided
  // once, up front (bucketForEntry), and the grouping filter shows or hides
  // whole buckets (renderPairTable), rather than this per-row predicate
  // re-deriving classed-ness from `row.classed` (still set by pairRowData,
  // now meaning "at least one side resolves through a class", used only by
  // the shadow-write guard below, not by this filter).
  pairRowVisible(row, filters, threshold, glyphName) {
    // Task 11, spec F10: a hidden result is display-suppressed unless
    // Show hidden is on -- results-model.js's own named predicate, shared
    // with the class-summary row's own hide gate in renderPairTable.
    if (!rowVisibleForHiddenState(row.hidden, filters.showHidden)) {
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
    // Task 5, spec F18 (numeric interval) and F13 (exact zero-current
    // predicate): `threshold` above is the existing lower |Δ| bound;
    // maxThreshold and hideZeroCurrentSuggestions are independent
    // conditions layered on top via the shared predicate, so this and
    // results-model.js's own test agree on one definition. A stale/
    // unavailable suggestion (valuesForDisplay -> delta: null) always
    // passes here, per Task 5's decision note -- its warning must stay
    // visible regardless of these bounds.
    const display = valuesForDisplay(row.current, row.suggestion, row.stale);
    if (
      !passesNumericFilters(display, {
        minDelta: 0,
        maxDelta: this.autokernParamsController.model.maxThreshold,
        hideZeroCurrentSuggestions: filters.hideZeroCurrentSuggestions,
      })
    ) {
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

    // Task 9, spec F09: Unicode types (this.pairRowVisible's own callers --
    // see this method's call sites -- only ever pass literal pair rows,
    // never a class-name address, so row.left/row.right are always real
    // glyph names here; a class-summary row's own mixed-membership category
    // check is classClassRowVisible's job, below).
    if (
      !pairMatchesUnicodeTypes([row.left], [row.right], filters.side, this._unicodeTypesSet)
    ) {
      return false;
    }

    // Task 9, spec F14: Class relationship. leftClassed/rightClassed are
    // read fresh per row (cheap object-lookup helpers, no caching needed)
    // rather than threaded through from pairRowData, keeping this filter's
    // own state (which buckets are checked) entirely local to this method.
    if (
      !rowMatchesRelationships(
        row,
        this.isLeftClassed(row.left),
        this.isRightClassed(row.right),
        this._relationshipsSet
      )
    ) {
      return false;
    }

    // Task 9, spec F14, ledger §8.4: table Glyphset filter -- "any glyph
    // involved" (either side), never "both sides required".
    if (!pairMatchesGlyphset([row.left], [row.right], this._tableGlyphsetMembers)) {
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

  // Backlog item 11, Task 8: one comparator shared by the whole flat row
  // list now (class-summary rows and pair rows alike -- Task 8's own
  // bullet: "apply it uniformly to normalized numeric fields"), driven by
  // autokernFiltersController's {sortColumn, sortDirection}. Delta always
  // sorts by magnitude (spec §7.3's original "worst first" meaning), so
  // that its default direction ("desc") reproduces the old toggle's own
  // default unchanged; every other column sorts by its actual value, since
  // ascending/descending has an ordinary spreadsheet-column meaning there.
  // Task 8: "state" is no longer a sortable column -- its header is gone
  // (F01/F23's stale section, Tasks 15/17, replaces the status concept).
  // Ties fall back to each row's own stable ID (rowId), a deterministic
  // order rather than whatever iteration order the cache happened to
  // produce.
  sortPairRows(rows, filters) {
    const dirMul = filters.sortDirection === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      let cmp;
      switch (filters.sortColumn) {
        case "glyph":
          cmp = (a.left + "\0" + a.right).localeCompare(b.left + "\0" + b.right);
          break;
        case "current":
          cmp = a.current - b.current;
          break;
        case "delta":
        default:
          cmp = Math.abs(a.delta) - Math.abs(b.delta);
          break;
      }
      if (cmp === 0) {
        cmp = (a.sortId || "").localeCompare(b.sortId || "");
      }
      return cmp * dirMul;
    });
  }


  // Backlog item 11: keeps every bucket table's header row in sync with the
  // shared sort state (one designer action, all four tables agree, same
  // global scope the old toggle button had). Called on every renderPairTable
  // rather than only from the click handler, so a filter change from
  // elsewhere (e.g. localStorage sync on load) still shows the right label.
  // Task 8: writes into a `.kerning-pairtable-sort-label` child span when
  // one exists (kerning.html's Glyph L header also carries the one
  // select-all checkbox now that buckets are gone -- overwriting the whole
  // th's textContent, as before, would silently delete that checkbox) and
  // falls back to the th itself for any header that has no such span.
  updateSortHeaders() {
    const { sortColumn, sortDirection } = this.autokernFiltersController.model;
    for (const th of document.querySelectorAll(".kerning-pairtable-sortable")) {
      const isActive = th.dataset.sortColumn === sortColumn;
      th.classList.toggle("kerning-pairtable-sort-active", isActive);
      const arrow = isActive ? (sortDirection === "desc" ? " ▼" : " ▲") : "";
      const label = th.querySelector(".kerning-pairtable-sort-label") || th;
      label.textContent = th.dataset.sortLabel + arrow;
    }
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

  // Layout overhaul, design doc §1.1/§0: whether ONE side alone resolves
  // through a class -- the per-side half of isEntryClassed above, needed
  // because the four-bucket model (unique×unique / unique×class /
  // class×unique / class×class) cares about each side independently, not
  // just "both sides classed or not" (isEntryClassed, kept unchanged and
  // still used by the status strip's classed-vs-flat coverage count).
  isLeftClassed(glyphName) {
    return !!this.kerningController.leftPairGroupMapping[glyphName];
  }

  isRightClassed(glyphName) {
    return !!this.kerningController.rightPairGroupMapping[glyphName];
  }

  // The cascade's own four addresses (spec §5.1), named the way design doc
  // §1.1 names them: "unique-unique", "unique-class", "class-unique",
  // "class-class". A bucket name is a statement about which cascade address
  // is the MOST SPECIFIC one available for this exact pair -- not about
  // which address currently holds a value.
  bucketForPair(left, right) {
    return `${this.isLeftClassed(left) ? "class" : "unique"}-${
      this.isRightClassed(right) ? "class" : "unique"
    }`;
  }

  // §1.1 "No override in v1": writing THIS pair as a literal [glyph,glyph]
  // flat cell (which every action on a per-entry row does --
  // writePairValues) always outranks any class-based address that would
  // otherwise answer for it (spec §5.1's cascade, most-specific-wins). That
  // is only a real hazard -- something the write would silently SHADOW --
  // if a class-based address for this exact pair already has kerning data.
  // A pair with no class on either side (unique×unique) has no class-based
  // address at all, so it can never shadow anything.
  //
  // Task 2 fix (kerning-ux-integration.md §5.1, "a confirmed, in-code-
  // acknowledged limitation"): this used to treat "the resolved cascade
  // value is nonzero" as evidence a class cell currently answers, which
  // cannot distinguish an explicit stored pair zero (not shadowing --
  // writing here would just update that existing literal rule) from
  // "nothing stored at this literal address, cascade fell through to 0"
  // (which IS shadowing -- the class cell answers with 0, and a flat write
  // would silently outrank it). Reading getPairValues at the literal
  // address (the same primitive Task 2's explicitPairExists uses) settles
  // it directly instead of inferring it from a number: a class-based
  // address can currently answer for this pair if, and only if, no literal
  // rule already exists for it.
  wouldShadowClassCell(left, right) {
    if (!this.isLeftClassed(left) && !this.isRightClassed(right)) {
      return false;
    }
    return this.kerningController.getPairValues(left, right) === undefined;
  }

  // Names the class-based address that answers today, for the shadow note
  // (§1.1: "a note pointing at the class cell that already answers for
  // it"). Mirrors getPairsToTry's own specificity order (spec §5.1) without
  // calling it directly (that method is private to kerning-controller.js's
  // own module scope in spirit, even though not underscore-prefixed --
  // leftPairGroupMapping/rightPairGroupMapping are the same public maps
  // every other read in this file already uses).
  describeShadowedClassCell(left, right) {
    const leftClass = this.kerningController.leftPairGroupMapping[left];
    const rightClass = this.kerningController.rightPairGroupMapping[right];
    if (leftClass && rightClass) {
      return `@${leftClass} × @${rightClass}`;
    }
    return leftClass ? `@${leftClass} × ${right}` : `${left} × @${rightClass}`;
  }

  // Backlog item 8 part 2: a shadowing pair's divergence FROM THE GROUP --
  // its suggested value minus whatever the class cascade currently resolves
  // that pair to at the active source (the same value wouldShadowClassCell
  // reads). Numerically this equals a normal row's `delta` (pairRowData.
  // current reads the same cascade value), but it is named and computed in
  // its own terms here so the "Potential overrides" section (part 3) and
  // the outlier-dropped class×class median (part 6) share one definition.
  // Orthogonal to isRowAboveThreshold, which compares against the pair's
  // own STORED value. Task 12 fix: reads this.autokernSource, not the
  // font's default source.
  overrideDivergence(left, right, suggestedValue) {
    const groupResolved =
      this.kerningController.getGlyphPairValueForSource(
        left,
        right,
        this.autokernSource
      ) ?? 0;
    return suggestedValue - groupResolved;
  }

  // Backlog item 8 part 2: a row is an "override candidate" when applying its
  // suggestion as a literal glyph×glyph value would shadow a class cell that
  // currently answers for the pair (wouldShadowClassCell) AND that value
  // diverges from the class cell by at least the group threshold (part 1).
  // Shared by renderPairTable's "Potential overrides" section (part 3) and,
  // via overrideDivergence, the class×class median filter (part 6).
  isOverrideCandidate(left, right, suggestedValue) {
    if (!this.wouldShadowClassCell(left, right)) {
      return false;
    }
    const groupThreshold = this.autokernParamsController.model.groupThreshold;
    return (
      Math.abs(this.overrideDivergence(left, right, suggestedValue)) >= groupThreshold
    );
  }

  // Rebuilds all four bucket <tbody> elements from this.autokernCache.
  // Called on every filter change, every threshold change, and once a run
  // finishes. Guards on missing state (this.autokernCache is set
  // synchronously by initRunSection, but
  // this.kerningController/this.autokernFiltersController are set
  // asynchronously by initPairTableSection, and the threshold listener in
  // initParametersSection can fire before that promise settles) by simply
  // doing nothing until every piece exists.
  //
  // Layout overhaul, design doc §1.1: the old three glyph-anchored sections
  // (side-1-class-vs-every-side-2-class / every-side-1-class-vs-side-2-class
  // / flat) are replaced by the four buckets the cascade itself defines
  // (spec §5.1): unique×unique, unique×class, class×unique, class×class.
  // The first three stay anchored to the typed/selected glyph (`glyphName`)
  // exactly like the old table was -- each is a per-cache-entry row, sorted
  // into its bucket by bucketForPair. class×class is different, per §0/§1.1:
  // "a class×class row exists once its two classes have any measured
  // coverage between their members, independent of any glyph being typed at
  // all" -- buildClassClassGroups below enumerates every side-1-class ×
  // side-2-class pair with cache coverage, font-wide, not merely the ones
  // touching glyphName (glyphName, when set, narrows this to classes that
  // glyphName is actually a member of -- a documented scoping choice, not a
  // requirement of the design doc, made so the bucket stays navigable
  // instead of listing the whole font's classes at all times).
  // Task 8, spec F11/F19/F32: rebuilds the ONE row list from
  // this.autokernCache, for whichever tab (this.activeResultsTab) is
  // active. Replaces the pre-Task-8 four-bucket-table model entirely --
  // there is exactly one <tbody> now, and a class-summary row renders
  // through the same builder/selection mechanism (selectRow/tickRow) an
  // ordinary pair row does, not a separate display element. Called on
  // every filter change, every threshold change, a tab switch, and once a
  // run finishes. Guards on missing state (this.autokernCache is set
  // synchronously by initRunSection, but this.kerningController/
  // this.autokernFiltersController are set asynchronously by
  // initPairTableSection) by doing nothing until every piece exists.
  renderPairTable() {
    const tbody = document.querySelector("#kerning-pairtable-body");
    if (
      !this.autokernCache ||
      !this.kerningController ||
      !this.autokernFiltersController ||
      !tbody
    ) {
      return;
    }

    // Spec §10: the on-canvas suggestion layer
    // (buildAutokernSuggestionVisualizationLayerDefinition) reads
    // this.autokernCache directly on every draw, but nothing else forces a
    // repaint when only the CACHE changes and the chip stays on "pair" (a
    // new run, a reload from OPFS, or an apply that doesn't change which
    // pair is selected) -- every caller of renderPairTable is exactly the
    // set of places the cache or an applied/junk mark can change, so this is
    // the one place to force it rather than duplicating this call at each
    // of those call sites.
    this.canvasController.requestUpdate();

    // WORKSTREAM 14, spec §7.5: called from every place renderPairTable
    // already is (this method's own callers -- see this method's top
    // comment), so the status strip's counts never go stale relative to
    // what's on screen.
    this.renderAutokernStatus();

    const filters = this.autokernFiltersController.model;
    const threshold = this.autokernParamsController.model.threshold;
    const groupThreshold = this.autokernParamsController.model.groupThreshold;
    const glyphName = filters.glyphName;
    const tab = this.activeResultsTab || "default";

    // Task 9, spec F09/F14: converted once per render (plan's own bullet:
    // "Normalize persisted arrays into Sets at the UI boundary"), read by
    // pairRowVisible/classClassRowVisible below via `this`.
    this._unicodeTypesSet = new Set(filters.unicodeTypes);
    this._relationshipsSet = new Set(filters.relationships);

    tbody.textContent = "";
    // Ledger §8.4: zero checked categories or zero checked relationships is
    // its own "nothing selected" empty state, distinct from "all" -- render
    // it directly and stop, rather than letting every row predicate above
    // reject everything and produce an ordinary-looking, unexplained empty
    // table.
    if (this._unicodeTypesSet.size === 0 || this._relationshipsSet.size === 0) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 7;
      emptyCell.className = "kerning-pairtable-nothing-selected";
      emptyCell.textContent =
        this._unicodeTypesSet.size === 0
          ? "No results: no Unicode types selected. Check at least one type to show results."
          : "No results: no Class relationships selected. Check at least one relationship to show results.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      this.syncSelectAllCheckboxes();
      this.resultSelection = retainVisible(this.resultSelection, new Set());
      this.refreshResetArmState();
      this.updatePairPreview();
      return;
    }
    // Task 8: rebuilt fresh every render, keyed by a class-summary row's own
    // stable ID -- expandHighlightedRowsToPairs (Task 7's own open decision,
    // resolved by ledger §8.1) reads this to expand a highlighted
    // class-summary row into its capped cross-product of concrete pairs.
    this._classSummaryMembersByRowId = new Map();
    // Task 8: same idea, for the row's own aggregate value -- writePairValues
    // has no autokernCache entry for a class address ("@Left"×"@Right" is
    // never a literal cache key), so a ticked class-summary row's Apply/
    // Reset write reads its median from here instead (this is what makes a
    // class-summary row's own tick actually do something on Apply, not just
    // highlight -- see writePairValues' own comment).
    this._classSummaryMedianByRowId = new Map();

    for (const el of document.querySelectorAll(".kerning-pairtable-current-col")) {
      el.style.display = filters.showCurrent ? "" : "none";
    }

    // Task 5, spec F13: same header-toggle mechanism as showCurrent above.
    for (const el of document.querySelectorAll(".kerning-pairtable-proposed-col")) {
      el.style.display = filters.showProposed ? "" : "none";
    }

    // Backlog item 15: same header-toggle mechanism as showCurrent above --
    // this only affects the <th> (tbody cells are cleared/rebuilt below and
    // set their own inline display at creation time, same as currentCell).
    for (const el of document.querySelectorAll(".kerning-pairtable-suggestion-col")) {
      el.style.display = filters.showSuggestion ? "" : "none";
    }

    // Backlog item 11: keeps the header label/arrow in sync with the
    // current sort column/direction on every render, not only on click.
    this.updateSortHeaders();

    // Task 8, spec F22: exposure state -- glyph names named directly via
    // "%name%!" in either input, plus the broad "Show individual class
    // members" checkbox. Only gates "member-pair" rows (results-model.js's
    // rowVisibleInDefault); every other kind is always in Default.
    const exposedNames = this.getExposedMemberNames();
    const showIndividualMembers = filters.showIndividualMembers;
    // Task 9, plan's own bullet, ledger §8.2: the Non-Unicode filter governs
    // the table only -- a /glyphname or %glyphname%! request for a
    // non-Unicode glyph still won't appear in the table while the box is
    // unchecked, but that must be explained, not a silent, unremarked gap.
    this.updateNonUnicodeNote();

    // Every row this render could possibly show, as one flat list, each
    // tagged with enough to sort/filter/render it uniformly regardless of
    // kind -- this IS "replace buckets with one row list" (F11): a
    // class-summary row and a literal pair row differ only in which
    // builder renders them, never in which table/section they belong to.
    const displayItems = [];

    // class-summary rows (§0/§1.1: independent of any typed glyph -- a
    // class×class row exists once its two classes have any measured
    // coverage between their members, font-wide). Always the class-pair
    // aggregate now -- Task 8 removes the old "Fold classes" escape hatch;
    // "Show individual class members" (below) is its declarative
    // replacement, and it ADDS member rows rather than replacing the
    // summary (invariant 6).
    const classGroups = this.buildClassClassGroups(
      glyphName,
      filters,
      threshold,
      groupThreshold
    );
    const sourceIdentifier = this.activeSourceIdentifier();
    for (const { group, stats, median } of classGroups) {
      const left = "@" + group.leftClassName;
      const right = "@" + group.rightClassName;
      displayItems.push({
        renderKind: "class-rule",
        group,
        stats,
        median,
        left,
        right,
        current: 0,
        delta: median,
        isCandidate: false,
        sortId: rowId(sourceIdentifier, left, right),
        // Task 11, ledger §8.5: this row's OWN hidden state only -- never
        // derived from or applied to group.rows below.
        hidden: this.hiddenClassRuleIds.has(rowId(sourceIdentifier, left, right)),
      });
      // group.rows are this class pair's own real cache entries (both
      // sides classed), already pairRowVisible-filtered by
      // buildClassClassGroups -- these become "member-pair"/"pair-exception"
      // rows, gated by exposure in Default and by candidacy in Potential.
      // Flattened onto the item (left/right/current/delta) so sortPairRows
      // below can sort every item -- class-rule or pair -- uniformly.
      for (const row of group.rows) {
        displayItems.push({
          renderKind: "pair",
          row,
          left: row.left,
          right: row.right,
          current: row.current,
          delta: row.delta,
          isCandidate: row.isCandidate,
          sortId: rowId(sourceIdentifier, row.left, row.right),
        });
      }
    }

    // unique-pair rows (bucketForPair anything other than "class-class"):
    // glyph-anchored, same scoping this table has always used for these
    // (Task 8 does not change WHEN they appear, only how they render --
    // see this method's own commit message for that scoping decision).
    if (glyphName) {
      for (const entry of this.autokernCache.values()) {
        if (entry.left !== glyphName && entry.right !== glyphName) {
          continue;
        }
        if (this.bucketForPair(entry.left, entry.right) === "class-class") {
          continue; // handled by the class-summary groups above
        }
        const row = this.pairRowData(
          entry,
          this.bucketForPair(entry.left, entry.right) !== "unique-unique"
        );
        if (!this.pairRowVisible(row, filters, threshold, glyphName)) {
          continue;
        }
        displayItems.push({
          renderKind: "pair",
          row,
          left: row.left,
          right: row.right,
          current: row.current,
          delta: row.delta,
          isCandidate: row.isCandidate,
          sortId: rowId(sourceIdentifier, row.left, row.right),
        });
      }
    }

    // Task 8, spec F19: which of the two tabs is active decides which items
    // from the SAME list above are kept -- not a second computation. A
    // class-rule row is Default-only (never itself a candidate); a pair
    // row is gated by exposure in Default and by its own isCandidate flag
    // in Potential (results-model.js's rowVisibleInDefault/
    // rowVisibleInPotential).
    const visibleItems = displayItems.filter((item) => {
      if (item.renderKind === "class-rule") {
        // Task 11, spec F10, ledger §8.5: this row's own hidden state,
        // never its members' (each "pair" item below carries its own
        // row.hidden, gated independently through pairRowVisible).
        return (
          tab === "default" && rowVisibleForHiddenState(item.hidden, filters.showHidden)
        );
      }
      return tab === "potential"
        ? rowVisibleInPotential(item.row)
        : rowVisibleInDefault(item.row, exposedNames, showIndividualMembers);
    });

    // Backlog item 11's column sort, now applied to the WHOLE flat list
    // (Task 8's own bullet: "apply it uniformly to normalized numeric
    // fields... use a stable row-ID tie-breaker"). sortPairRows only reads
    // .left/.right/.current/.delta, which every item above carries
    // (a class-rule item's own current/delta stand-ins, set above).
    this.sortPairRows(visibleItems, filters);

    for (const item of visibleItems) {
      if (item.renderKind === "class-rule") {
        tbody.appendChild(
          this.buildClassSummaryRowElement(item.group, item.stats, item.median)
        );
      } else {
        tbody.appendChild(this.buildPairRowElement(item.row));
      }
    }

    // Backlog item 13: the tbody was just rebuilt from scratch above, so
    // the select-all checkbox needs to reflect the freshly rendered (Task
    // 3: each row's own checkbox is now initialized from
    // this.resultSelection.ticked in buildPairRowElement, not always
    // unchecked) row set.
    this.syncSelectAllCheckboxes();

    // Task 3 (spec F25): every row was just rebuilt, so this is exactly the
    // full set of rows now actually displayed -- prune highlight/tick state
    // for any row ID that didn't render this time (filtered out, tab
    // switched, cache reloaded, etc).
    const visibleRowIds = new Set(
      [...document.querySelectorAll(".kerning-pairtable-table tr[data-row-id]")].map(
        (tr) => tr.dataset.rowId
      )
    );
    this.resultSelection = retainVisible(this.resultSelection, visibleRowIds);
    // Task 4, spec F20: a filter/render change that dropped a ticked row
    // must disarm Reset (it would otherwise silently commit against a
    // smaller set than the one shown when it was armed).
    this.refreshResetArmState();
    // Task 7, spec F25: "Update preview and action counts accordingly"
    // when a highlighted row leaves the displayed set.
    this.updatePairPreview();
  }

  // Task 8, spec F22: the exact glyph names named via "%name%!" in either
  // input -- reuses input-tokens.js's own parseTokenList/parseToken (Task
  // 6/7) rather than a second parser. A "member" token's `name` is already
  // the literal glyph name (parseToken slices it straight out of the
  // "%...%!" text), so no font-data resolution is needed here.
  getExposedMemberNames() {
    const names = new Set();
    const elements = this._pairInputElements;
    if (!elements) {
      return names;
    }
    for (const text of [elements.glyphInput.value, elements.pairInput.value]) {
      let tokens;
      try {
        tokens = parseTokenList(text);
      } catch {
        continue; // an invalid token is reported inline by updatePairPreview
      }
      for (const token of tokens) {
        if (token.kind === "member") {
          names.add(token.name);
        }
      }
    }
    return names;
  }

  // Task 9, plan's own bullet, ledger §8.2: same token source as
  // getExposedMemberNames above, but for BOTH "glyph" (/name) and "member"
  // (%name%!) tokens -- ledger §8.2's exact wording: "A non-Unicode glyph
  // named explicitly (/glyphname or %glyphname%!)". Only reports a note
  // when the Non-Unicode box is actually unchecked (otherwise nothing is
  // being excluded, no note needed).
  updateNonUnicodeNote() {
    const note = document.querySelector("#kerning-pairtable-nonunicode-note");
    if (!note) {
      return;
    }
    const filters = this.autokernFiltersController?.model;
    const elements = this._pairInputElements;
    if (!filters || !elements || filters.unicodeTypes.includes("non-unicode")) {
      note.textContent = "";
      return;
    }
    const named = new Set();
    for (const text of [elements.glyphInput.value, elements.pairInput.value]) {
      let tokens;
      try {
        tokens = parseTokenList(text);
      } catch {
        continue;
      }
      for (const token of tokens) {
        if (
          (token.kind === "glyph" || token.kind === "member") &&
          glyphMatchesCategory(token.name, "non-unicode")
        ) {
          named.add(token.name);
        }
      }
    }
    note.textContent = named.size
      ? `${[...named].join(", ")} ${named.size === 1 ? "is" : "are"} excluded from the table ` +
        `by the unchecked Non-Unicode glyphs filter (still available in preview).`
      : "";
  }

  // Median (not mean, spec §5.2: "the median is the reducer... a mean can
  // [get dragged]") of the folded rows' suggestion values -- these are the
  // cache's own `entry.value` (via row.suggestion, pairRowData above), the
  // same source applySelectedPairRows writes from for a flat row.
  static medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Layout overhaul, design doc §1.1/§0: every side-1-class × side-2-class
  // pair that has ANY measured coverage between their members, font-wide --
  // "a class×class row exists once its two classes have any measured
  // coverage between their members, independent of any glyph being typed at
  // all". When glyphName is set, narrowed to class pairs where glyphName is
  // actually a member of one of the two classes (a scoping choice for
  // navigability, not a requirement of the design doc -- see this method's
  // own caller comment in renderPairTable).
  //
  // Returns Array<{ group: {leftClassName, rightClassName, rows}, stats
  // (computeFoldGroupStats' return, unmodified), median }>, already filtered
  // by classClassRowVisible (threshold, Task 9's Unicode types/relationship/
  // glyphset) and already carrying each group's own filtered, visible child
  // rows for expand-to-browse (the same
  // per-row filters -- side/sign/state/junk/threshold -- that any other
  // bucket's rows go through, via pairRowVisible).
  buildClassClassGroups(glyphName, filters, threshold, groupThreshold) {
    const kernData = this.kerningController.kernData;
    const side1Names = Object.keys(kernData.groupsSide1 || {});
    const side2Names = Object.keys(kernData.groupsSide2 || {});
    // §1.1: the side filter ("glyph on left"/"glyph on right") presumes an
    // anchor glyph; with none typed, a class×class row has no single glyph
    // to test it against, so it is bypassed rather than hiding every row.
    const effectiveFilters = glyphName ? filters : { ...filters, side: "both" };

    const results = [];
    for (const leftClassName of side1Names) {
      const leftMembers = kernData.groupsSide1[leftClassName] || [];
      const leftHasGlyph = !!glyphName && leftMembers.includes(glyphName);
      for (const rightClassName of side2Names) {
        const rightMembers = kernData.groupsSide2[rightClassName] || [];
        if (glyphName && !leftHasGlyph && !rightMembers.includes(glyphName)) {
          continue;
        }
        const leftSet = new Set(leftMembers);
        const rightSet = new Set(rightMembers);
        let hasCoverage = false;
        for (const entry of this.autokernCache.values()) {
          if (leftSet.has(entry.left) && rightSet.has(entry.right)) {
            hasCoverage = true;
            break;
          }
        }
        if (!hasCoverage) {
          continue;
        }

        const group = { leftClassName, rightClassName, rows: [] };
        const stats = this.computeFoldGroupStats(group, groupThreshold);
        // §1.1: "its 'current' is whatever's stored at that class cell
        // (usually nothing, so effectively zero)" -- taken literally: the
        // aggregate row's own delta is its median against zero, the same
        // "usually nothing" reading the design doc gives it (a real stored
        // class-cell value, if any, is still visible on request via
        // kerningController.getPairFunction, deliberately not read here to
        // keep this exactly what the design doc describes).
        const median = stats.median;
        if (
          !this.classClassRowVisible(
            median,
            threshold,
            effectiveFilters,
            leftMembers,
            rightMembers
          )
        ) {
          continue;
        }

        group.rows = stats.entries
          .map((entry) => this.pairRowData(entry, true))
          .filter((row) =>
            this.pairRowVisible(row, effectiveFilters, threshold, glyphName || row.left)
          );
        // Backlog item 11: these child rows are real per-pair entries (they
        // DO have a current/state, unlike the fold parent itself), so the
        // same column sort applies to them for consistency when expanded.
        this.sortPairRows(group.rows, filters);

        results.push({ group, stats, median });
      }
    }
    return results;
  }

  // §1.1's sign/threshold filters, applied to a class×class row's own
  // aggregate delta (median, current treated as zero -- see
  // buildClassClassGroups' own comment). Junk and state (pending/applied/
  // stale) are per-PAIR concepts (spec §4.2/§7.3) with no single value for
  // an aggregate row spanning many pairs, so neither filters an aggregate
  // row out here -- a documented limitation, not an oversight: those two
  // filters still apply normally to the row's own child rows (via
  // pairRowVisible, in buildClassClassGroups above), which is where a junk
  // mark or an applied state actually lives.
  classClassRowVisible(median, threshold, filters, leftMembers, rightMembers) {
    if (Math.abs(median) < threshold) {
      return false;
    }
    // Task 5, spec F18: same inclusive upper bound as pairRowVisible. F16
    // removed the sign filter entirely -- magnitude only.
    const maxThreshold = this.autokernParamsController.model.maxThreshold;
    if (maxThreshold != null && Math.abs(median) > maxThreshold) {
      return false;
    }

    // Task 9, spec F09, ledger §8.3: "mixed-category class summary matches
    // a checked category if ANY member belongs to it" -- the exact same
    // predicate pairRowVisible uses, given the class's full membership
    // list instead of one glyph name.
    if (!pairMatchesUnicodeTypes(leftMembers, rightMembers, filters.side, this._unicodeTypesSet)) {
      return false;
    }
    // Task 9, spec F14: a class-summary row is always both-sides-classed by
    // construction (that's what makes it a class-summary row at all) with
    // no "explicit rule" concept of its own (its own saved value, if any,
    // is deliberately not read here -- see this method's own top comment) --
    // it is always exactly "Class-to-class".
    if (!this._relationshipsSet.has("class-class")) {
      return false;
    }
    // Task 9, spec F14, ledger §8.4: "any single member of the class" --
    // the same union-any rule as a flat pair row's own two glyphs.
    if (!pairMatchesGlyphset(leftMembers, rightMembers, this._tableGlyphsetMembers)) {
      return false;
    }

    return true;
  }

  // Spec §5.2/§10 Direction A (unmodified by the layout overhaul): computes
  // a class-pair's median/spread/count from the FULL class×class product --
  // every cache entry whose left is in leftClassName's full membership AND
  // whose right is in rightClassName's, drawn from the WHOLE cache, not
  // whatever `group.rows` happens to hold. `group.rows` is used only as a
  // defensive fallback for the median if the class product somehow has zero
  // cache coverage (cannot happen through the UI today -- buildClassClassGroups
  // only calls this once a coverage check has already passed).
  //
  // The `side`/`varyingMembers` choice for classSpread's own "which side is
  // varying" is fixed to "right" here (matching the old call sites'
  // `section === 1` branch) -- with no glyph anchoring one side as "fixed"
  // anymore (layout overhaul, §0/§1.1: a class×class row is independent of
  // any typed glyph), there is no principled "the other side is fixed"
  // choice to make; "right" is an arbitrary but consistent convention, not a
  // claim that side is somehow more relevant.
  computeFoldGroupStats(group, groupThreshold) {
    const kernData = this.kerningController.kernData;
    const leftMembers = kernData.groupsSide1[group.leftClassName] || [];
    const rightMembers = kernData.groupsSide2[group.rightClassName] || [];
    const leftSet = new Set(leftMembers);
    const rightSet = new Set(rightMembers);

    const entries = [];
    for (const entry of this.autokernCache.values()) {
      if (leftSet.has(entry.left) && rightSet.has(entry.right)) {
        entries.push(entry);
      }
    }

    // Backlog item 8 part 6: the aggregate median drops member pairs whose
    // own divergence from the class cell is at least the group threshold (the
    // same magnitude test as isOverrideCandidate, part 2), so the number a
    // class×class row shows isn't dragged by the very pairs a designer is
    // likely to override out. medianDroppingOutliers falls back to the
    // unfiltered median if EVERY member is an outlier. `classClassRowVisible`
    // and the expanded child rows (group.rows) are unaffected -- only this
    // aggregate changes.
    const median = entries.length
      ? medianDroppingOutliers(
          entries.map((entry) => ({
            value: entry.value,
            divergence: this.overrideDivergence(entry.left, entry.right, entry.value),
          })),
          groupThreshold
        )
      : KerningViewController.medianOf(group.rows.map((row) => row.suggestion));
    const spread = classSpread(rightMembers, entries, "right");

    return { leftMembers, rightMembers, entries, median, spread };
  }

  // Task 8: a class-summary row is now the SAME kind of row as an
  // individual pair row -- clickable, Shift-clickable, tickable,
  // highlightable, through the exact same selectRow/tickRow/retainVisible
  // mechanism buildPairRowElement uses (results-selection.js). It is not a
  // separate, non-interactive display element; the only difference from a
  // pair row is that its Glyph L/Glyph R columns show class names (F32)
  // instead of glyph names. "Left class"/"Right class" show each side's
  // FULL membership (truncated the same way a derive proposal's member
  // list truncates, truncateGlyphList), matching spec §5.2's own
  // illustration ("T Tcaron Tbar   -48   o ó ö").
  buildClassSummaryRowElement(group, stats, median) {
    const tr = document.createElement("tr");
    tr.className = "kerning-pairtable-summary-row";
    const left = "@" + group.leftClassName;
    const right = "@" + group.rightClassName;
    tr.dataset.left = left;
    tr.dataset.right = right;
    tr.dataset.kind = "class-rule";
    // Task 11, spec F15: same textual category cue buildPairRowElement uses.
    tr.title = ROW_KIND_CATEGORY_LABELS["class-rule"];

    // Task 3 (spec F04): same stable row ID mechanism a pair row uses.
    const id = rowId(this.activeSourceIdentifier(), left, right);
    tr.dataset.rowId = id;
    tr.classList.toggle(
      "kerning-pairtable-row-highlighted",
      this.resultSelection.highlighted.has(id)
    );
    // F04's own open decision, resolved by the ledger (§8.1): a highlighted
    // class-summary row expands to the capped cross-product of both sides'
    // full class membership -- expandHighlightedRowsToPairs reads this map
    // by rowId rather than re-deriving membership from the DOM.
    this._classSummaryMembersByRowId.set(id, {
      leftMembers: stats.leftMembers,
      rightMembers: stats.rightMembers,
    });
    this._classSummaryMedianByRowId.set(id, median);

    tr.addEventListener("click", (event) => {
      if (event.target.closest("input, button")) {
        return;
      }
      this.resultSelection = selectRow(this.resultSelection, id, event.shiftKey);
      this.applyResultSelectionToDom();
      this.updatePairPreview({ switchToPairMode: !event.shiftKey });
    });

    // F32: the tick lives inside the Glyph L cell, same placement a pair
    // row's own tick uses.
    const leftCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "kerning-pairtable-row-select";
    checkbox.checked = this.resultSelection.ticked.has(id);
    checkbox.addEventListener("change", () => {
      this.resultSelection = tickRow(this.resultSelection, id, checkbox.checked);
      this.applyResultSelectionToDom();
      this.syncSelectAllCheckboxes();
      this.refreshResetArmState();
    });
    leftCell.appendChild(checkbox);
    const leftLabel = document.createElement("span");
    leftLabel.className = "kerning-pairtable-class-name";
    leftLabel.textContent = `${left} (${truncateGlyphList(stats.leftMembers)})`;
    // F21 recommended detail: "disclose contributing-pair count and
    // excluded-result count in row details" -- no 8th column exists for
    // this (F32 fixes the header set at seven), so it is a tooltip.
    leftLabel.title = `${stats.entries.length} pairs, spread ${stats.spread.overall.toFixed(1)}`;
    leftCell.appendChild(leftLabel);
    tr.appendChild(leftCell);

    // A class-summary row has no single stored Current (§1.1: its own
    // "current" is whatever's stored at the class cell, usually nothing --
    // read on request via kerningController.getPairFunction, deliberately
    // not shown here to keep this exactly what the design doc describes).
    const currentCell = document.createElement("td");
    currentCell.className = "kerning-pairtable-current-col";
    currentCell.style.display = this.autokernFiltersController.model.showCurrent
      ? ""
      : "none";
    tr.appendChild(currentCell);

    // Proposed IS the aggregate suggestion for this class rule.
    const proposedCell = document.createElement("td");
    proposedCell.className = "kerning-pairtable-proposed-col";
    proposedCell.textContent = median > 0 ? `+${median.toFixed(1)}` : median.toFixed(1);
    proposedCell.style.display = this.autokernFiltersController.model.showProposed
      ? ""
      : "none";
    tr.appendChild(proposedCell);

    const deltaCell = document.createElement("td");
    deltaCell.className = "kerning-pairtable-suggestion-col";
    deltaCell.textContent = median > 0 ? `+${median.toFixed(1)}` : median.toFixed(1);
    deltaCell.style.display = this.autokernFiltersController.model.showSuggestion
      ? ""
      : "none";
    tr.appendChild(deltaCell);

    const rightCell = document.createElement("td");
    const rightLabel = document.createElement("span");
    rightLabel.className = "kerning-pairtable-class-name";
    rightLabel.textContent = `${right} (${truncateGlyphList(stats.rightMembers)})`;
    rightCell.appendChild(rightLabel);
    tr.appendChild(rightCell);

    // F32's override-action column: this row's own primary write action
    // (writes the class rule at the median -- applyFoldedParentRow,
    // unchanged). Task 10 owns building the per-pair lock this column
    // holds for member/exception rows; a class-summary row has no single
    // concrete pair to lock (F12: "A class-summary row must not create an
    // arbitrary representative-glyph exception").
    const exceptionCell = document.createElement("td");
    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = "Apply class";
    applyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.applyFoldedParentRow(group, median);
    });
    exceptionCell.appendChild(applyButton);
    tr.appendChild(exceptionCell);

    // F32's hide-action column. Task 11, ledger §8.5 (APPROVED): hiding a
    // class-summary row hides only this displayed aggregate row -- it never
    // cascades to its exposed members or saved exceptions, each of which is
    // hidden (or not) through its own separate rowId in
    // this.autokernCache's per-pair `junk` field, not this Set.
    const hidden = this.hiddenClassRuleIds.has(id);
    tr.classList.toggle("kerning-pairtable-row-hidden", hidden);
    const hideCell = document.createElement("td");
    const hideButton = document.createElement("icon-button");
    hideButton.className =
      "kerning-pairtable-hide-indicator kerning-pairtable-hide-action";
    if (hidden) {
      hideButton.src = "/tabler-icons/eye-closed.svg";
      hideButton.setAttribute(
        "aria-label",
        `Restore hidden class rule ${left} × ${right}`
      );
      hideButton.setAttribute(
        "data-tooltip",
        "Hidden. Restore to show this class rule again -- its exposed members and saved exceptions were never affected."
      );
    } else {
      hideButton.src = "/tabler-icons/eye.svg";
      hideButton.setAttribute("aria-label", `Hide class rule ${left} × ${right}`);
      hideButton.setAttribute(
        "data-tooltip",
        "Hide this class-rule row from normal browsing -- its exposed members and saved exceptions stay visible, subject to their own filters."
      );
    }
    hideButton.onclick = (event) => {
      event.stopPropagation();
      this.toggleClassRuleHidden(id, !hidden);
    };
    hideCell.appendChild(hideButton);
    tr.appendChild(hideCell);

    return tr;
  }

  // Task 11, ledger §8.5: the class-summary row's own hide/restore action.
  // Presentation-only, like togglePairJunk -- does not touch median/stats
  // computation (computeFoldGroupStats reads the full cache regardless) or
  // any member/exception row's own hidden state.
  toggleClassRuleHidden(id, hidden) {
    if (hidden) {
      this.hiddenClassRuleIds.add(id);
    } else {
      this.hiddenClassRuleIds.delete(id);
    }
    this.renderPairTable();
  }

  // WORKSTREAM 15, spec §5.2, now also the layout overhaul's class×class
  // apply (§1.1: "its delta and apply behave exactly like any other row's"):
  // "Applying a parent writes one cell at the median of its members." The
  // pair-selector shape is the SAME one getPairsToTry/kerning-controller.js's
  // own [@class, @class] address uses (kerning-controller.js: `addGroupPrefix`
  // prepends "@" to a stored group name before it is used as a lookup/write
  // key into kernData.values) -- KerningEditContext (kerning-controller.js)
  // writes into kernData.values[leftName][rightName] for whatever
  // leftName/rightName a pairSelector carries, with no restriction to bare
  // glyph names, so an "@ClassName" pairSelector reaches the real class
  // cell, not a flat shadow of it (spec §5.1's whole argument against a flat
  // write).
  async applyFoldedParentRow(group, median) {
    // Task 12 fix (ledger §5.4): write to the source the status strip has
    // selected, not always the font's default source.
    const sourceIdentifier = this.autokernSource;
    if (!sourceIdentifier) {
      console.error("kerning view: cannot apply, no source is selected");
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

  // Design doc §0: "kern-row clustering... is removed, not fixed." Composite
  // inheritance (exact, spec §5.3 tactic 1) is now the ONLY derive tactic --
  // the tactic-2 kern-row-clustering loop that used to run here (and the
  // tolerance field it read, #kerning-derive-tolerance, now removed from
  // kerning.html) is gone. autokern-classes.js's deriveKernRowClusters
  // itself is untouched and still exported (it may still be useful
  // elsewhere or in tests, per the design doc) -- only this call site is
  // removed, along with buildGlyphScriptCategoryMaps, which existed solely
  // to feed that tactic's cross-script/category merge guard and has no
  // other caller now.
  //
  // Writes nothing -- inheritCompositeClasses is pure, and its result is not
  // written to the font here. Populates this.autokernDeriveProposals and
  // re-renders; accepting one is a separate, explicit action
  // (acceptDeriveProposal).
  async deriveClasses() {
    const compositeBases = await this.buildCompositeBases();

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
  //
  // Undo: editGroupSide1/editGroupSide2 (kerning-controller.js's own
  // `_editGroup`) call fontController.performEdit internally and discard its
  // returned {change, rollbackChange} -- there is no change/rollbackChange
  // to capture from the outside without editing kerning-controller.js, which
  // is out of scope here. So this pushes a differently-shaped record onto
  // the SAME this.autokernUndoStack used by writePairValues (UndoStack
  // itself is agnostic about what a record contains -- it is popped by
  // doAutokernUndoRedo below, not replayed through
  // fontController.applyChange/editFinal the way a {change, rollbackChange}
  // record is): one entry per member glyph, the group name it belonged to
  // on the relevant side BEFORE this call (read off
  // kerningController.leftPairGroupMapping/rightPairGroupMapping, the same
  // already-computed mapping §7.3's pair table reads from -- no group is
  // written until after this snapshot) and the group name (`className`)
  // AFTER. Undo replays editGroupSide1/editGroupSide2 with each glyph's
  // `before` name (empty string if it had none); redo replays with `after`.
  async acceptDeriveProposal(proposal, className) {
    const groupMapping =
      proposal.editSide === "side1"
        ? this.kerningController.leftPairGroupMapping
        : this.kerningController.rightPairGroupMapping;
    const editFn =
      proposal.editSide === "side1"
        ? (glyphName, groupName) =>
            this.kerningController.editGroupSide1(glyphName, groupName)
        : (glyphName, groupName) =>
            this.kerningController.editGroupSide2(glyphName, groupName);

    const entries = proposal.members.map((glyphName) => ({
      glyphName,
      before: groupMapping[glyphName] || "",
      after: className,
    }));

    // Partial-failure handling (spec §10 "A derived class's Accept has no
    // rollback on partial failure"): editFn is the SAME
    // kerningController.editGroupSide1/editGroupSide2 call used above and by
    // doAutokernUndoRedo, so a rollback here is just another call to editFn
    // with a glyph's `before` value -- there is no second, more-reliable
    // write path to reach for. That means a rollback write is subject to the
    // exact same failure modes as the forward write (dropped connection,
    // backend rejection, ...) -- it is NOT guaranteed to succeed. So this
    // does not claim atomicity it cannot back up: it attempts a rollback of
    // every write that succeeded before the failure, and if every rollback
    // write also succeeds, the font is left exactly as it was before Accept
    // (real all-or-nothing, achieved, not merely assumed). If a rollback
    // write itself fails, the corresponding glyph is left classed into
    // className with no clean write path left to try synchronously -- rather
    // than hide that, this pushes an incremental undo record for exactly the
    // still-classed glyphs (so Ctrl-Z can retry the before-value write later)
    // and reports BOTH the original error and the rollback failure(s) to the
    // designer by name, so they know precisely which glyphs are and are not
    // still in the class.
    const succeeded = [];
    let writeError = null;
    let failedGlyphName = null;
    for (const entry of entries) {
      try {
        await editFn(entry.glyphName, className);
        succeeded.push(entry);
      } catch (error) {
        writeError = error;
        failedGlyphName = entry.glyphName;
        break;
      }
    }

    if (writeError) {
      const rollbackFailures = [];
      for (const entry of succeeded) {
        try {
          await editFn(entry.glyphName, entry.before);
        } catch (rollbackError) {
          rollbackFailures.push({ glyphName: entry.glyphName, error: rollbackError });
        }
      }

      let stillClassed = [];
      if (rollbackFailures.length === 0) {
        message(
          "Accept derive proposal failed",
          `Writing class "${className}" failed on glyph "${failedGlyphName}" ` +
            `(${writeError.message || String(writeError)}). ` +
            `${succeeded.length} earlier write(s) were rolled back; no member of ` +
            `this proposal is in the class.`
        );
      } else {
        stillClassed = rollbackFailures.map((failure) =>
          succeeded.find((entry) => entry.glyphName === failure.glyphName)
        );
        this.autokernUndoStack.pushUndoRecord({
          info: {
            label: "kerning view: accept derive proposal (partial)",
            kind: "groupMembership",
            editSide: proposal.editSide,
            entries: stillClassed,
          },
        });
        message(
          "Accept derive proposal partially failed",
          `Writing class "${className}" failed on glyph "${failedGlyphName}" ` +
            `(${writeError.message || String(writeError)}). Rolling back also failed ` +
            `for: ${rollbackFailures
              .map((f) => `${f.glyphName} (${f.error.message || String(f.error)})`)
              .join(", ")}. ` +
            `${rollbackFailures.length === 1 ? "That glyph is" : "Those glyphs are"} still ` +
            `in class "${className}" -- use Undo (Ctrl-Z) to retry removing ` +
            `${rollbackFailures.length === 1 ? "it" : "them"}, or fix manually.`
        );
      }

      // Design doc §1.2 "Rerun scoping": the glyphs left classed after a
      // partial-failure rollback still JOINED a class -- mark them the same
      // way any other class-membership change is marked (see
      // markGlyphsStaleForClassEdit, class panel section below). Glyphs that
      // rolled all the way back never actually joined anything, so they are
      // not in `stillClassed` and are correctly left unmarked.
      if (rollbackFailures.length) {
        this.markGlyphsStaleForClassEdit(stillClassed.map((entry) => entry.glyphName));
      }

      this.renderDeriveProposals();
      this.renderClassList();
      this.renderPairTable();
      return;
    }

    this.autokernUndoStack.pushUndoRecord({
      info: {
        label: "kerning view: accept derive proposal",
        kind: "groupMembership",
        editSide: proposal.editSide,
        entries,
      },
    });

    this.autokernDeriveProposals = this.autokernDeriveProposals.filter(
      (p) => p.id !== proposal.id
    );
    // Design doc §1.2 "Rerun scoping": every accepted member just joined a
    // class -- mark it the same way an edited outline already is (see
    // markGlyphsStaleForClassEdit, class panel section below).
    this.markGlyphsStaleForClassEdit(entries.map((entry) => entry.glyphName));
    this.renderDeriveProposals();
    this.renderClassList();
    this.renderPairTable();
  }

  // ---------------------------------------------------------------------
  // ---- Class panel (design doc §1.2) ----
  //
  // Everything below, down to the closing "---------" marker, is this
  // worker's own scope: the class panel built into
  // #autokern-class-panel-slot (kerning.html) -- New class (1st/2nd/both),
  // the relocated Derive button/proposals (see deriveClasses above; only its
  // button/proposals-list DOM location moved, the method itself is
  // unchanged except for §0's tactic-2 removal), the flat class list, the
  // glyph-swatch strip, class color, and the "Show class" context-menu
  // dialog. Kept as one new, clearly-delimited block rather than interleaved
  // into the pair-table/derive code above it, per this workstream's own
  // collision-avoidance instruction -- a concurrent worker (font mode) is
  // editing the SAME FILE, appending its own controls into the same slot at
  // runtime (initFontModeAddToClassActions, further down this file) but
  // never touching this block's markup or methods.
  //
  // `this.selectedClass` is the one piece of state other code is meant to
  // read: `{ side: "side1" | "side2", name: string } | null`. The font-mode
  // worker's own addFontModeSelectionToClass/updateFontModeAddToClassButton
  // already read exactly this shape (confirmed by reading their code before
  // writing this comment), so no renaming or reconciliation is needed there.
  // `addGlyphsToClass(side, className, glyphNames)` is the public write path
  // other code should call to join glyphs to a class through this view (used
  // by createNewClassViaDialog below). Reconciled post-merge: font mode's
  // own addFontModeSelectionToClass (further down this file) now delegates
  // to this method per glyph rather than duplicating its editGroupSide1/
  // editGroupSide2 write loop inline.
  // ---------------------------------------------------------------------

  initClassPanelSection() {
    // Read by the font-mode worker's "Add to selected class" action and by
    // this file's own class-list row click handler (selectClass below) --
    // the one property other code is meant to read, per this method's own
    // block comment above.
    this.selectedClass = null;

    document
      .querySelector("#autokern-class-new-side1")
      .addEventListener("click", () => this.createNewClassViaDialog("side1"));
    document
      .querySelector("#autokern-class-new-side2")
      .addEventListener("click", () => this.createNewClassViaDialog("side2"));
    document
      .querySelector("#autokern-class-new-both")
      .addEventListener("click", () => this.createNewClassViaDialog("both"));

    // Design doc §1.2's glyph-swatch strip reuses the SAME tile/rendering
    // component views-editor's own glyph search / glyphsets panels use
    // (fontra-webcomponents/glyph-cell.js's GlyphCell custom element, the
    // component GlyphCellView -- font mode's own grid, above -- wraps for a
    // full accordion/selection UI this strip does not need: it is a plain,
    // non-selectable read of one class's membership, so bare GlyphCell tiles
    // are the right level of reuse, not a second GlyphCellView instance).
    // GlyphCell's constructor takes a locationController + locationKey (it
    // reads `locationController.model[locationKey]` as the instance
    // location to render at) -- this view has no per-glyph location concept
    // of its own, so a fixed, empty-location controller built once here is
    // all any swatch anywhere in this panel ever needs.
    this._classPanelLocationController = new ObservableController({ location: {} });

    this.renderClassList();

    // F: "Show class" context menu, on a glyph in any scene mode. No
    // context-menu wiring existed anywhere on this view's own canvas before
    // this (grepped the whole file before writing this) -- the font-mode
    // worker's showMenu usage is on the FONT-MODE GRID's own contextmenu
    // event (a different element, this.fontModeGlyphCellView), not this
    // canvas, so this is a new, non-colliding listener. Mirrors editor.js's
    // own convention exactly: canvas.addEventListener("contextmenu", ...) ->
    // showMenu(items, {x, y}).
    this.canvasController.canvas.addEventListener("contextmenu", (event) =>
      this.classPanelContextMenuHandler(event)
    );
  }

  // ---- New class (design doc §1.2, "1st"/"2nd"/"both") ----

  // The data model has no way to record an empty class: a class exists only
  // as glyphs' own membership (kerning-controller.js's editGroupSide1/
  // editGroupSide2, spec §5.3: "there is one interface... typing a name
  // joins that class" -- no separate class registry exists to hold a name
  // with zero members). So "New class" asks for a name AND at least one
  // starting member, not a bare name -- an inference, not stated verbatim in
  // the design doc, but the only reading the data model supports.
  async createNewClassViaDialog(sides) {
    const headline =
      sides === "both"
        ? "New class (side 1 and side 2)"
        : sides === "side1"
          ? "New class (side 1)"
          : "New class (side 2)";
    const result = await this.promptClassNameAndMembers(headline);
    if (!result) {
      return;
    }
    const { name, members } = result;
    if (!name || !members.length) {
      return;
    }
    if (sides === "both") {
      // Design doc §1.2: "'Both' is a creation-time convenience only: it
      // writes two independent classes, one per side's group dictionary,
      // with the same name and the same starting membership. After
      // creation they are two ordinary, independent rows -- editing one's
      // membership later never touches the other." Two independent calls,
      // exactly that -- no shared state between them beyond this one
      // dialog's answer.
      await this.addGlyphsToClass("side1", name, members);
      await this.addGlyphsToClass("side2", name, members);
    } else {
      await this.addGlyphsToClass(sides, name, members);
    }
  }

  // A small, custom two-field dialog (name + members) -- modal-dialog.js's
  // own askString helper only offers one field, not enough here. Members are
  // parsed with the SAME parser the excluded-glyph field already uses
  // (parseExcludedGlyphNames, above), for the same reason spec §4.2 gives
  // that field: comma/space separated, "/glyphname" syntax for a glyph with
  // no character.
  async promptClassNameAndMembers(headline) {
    const dialog = await dialogSetup(headline, null, [
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: translate("dialog.okay"), isDefaultButton: true, resultValue: true },
    ]);

    const container = document.createElement("div");
    container.className = "autokern-show-class-dialog";

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Class name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    container.appendChild(nameLabel);
    container.appendChild(nameInput);

    const membersLabel = document.createElement("label");
    membersLabel.textContent = "Members (glyph names, comma or space separated)";
    const membersInput = document.createElement("input");
    membersInput.type = "text";
    container.appendChild(membersLabel);
    container.appendChild(membersInput);

    dialog.setContent(container);
    setTimeout(() => nameInput.focus(), 0);

    const ok = await dialog.run();
    if (!ok) {
      return null;
    }
    return {
      name: nameInput.value.trim(),
      members: this.parseExcludedGlyphNames(membersInput.value),
    };
  }

  // The one write path for joining glyphs to a class through this view --
  // PUBLIC: other code (the font-mode worker's own add-to-class actions) may
  // call this directly, per this workstream's brief ("a plain method other
  // code can call"). `side` is "side1" | "side2" (kernData's own property
  // names, not "left"/"right" -- matching editGroupSide1/editGroupSide2's
  // own naming). Writes through the SAME per-glyph mechanism
  // acceptDeriveProposal/panel-selection-info.js's own class field use
  // (kerningController.editGroupSide1/editGroupSide2) -- no second write
  // mechanism invented. Marks every glyph stale (§1.2 "Rerun scoping") and
  // refreshes the class list/swatch strip/pair table so the change is
  // visible immediately.
  async addGlyphsToClass(side, className, glyphNames) {
    const editFn =
      side === "side1"
        ? (glyphName) => this.kerningController.editGroupSide1(glyphName, className)
        : (glyphName) => this.kerningController.editGroupSide2(glyphName, className);
    for (const glyphName of glyphNames) {
      await editFn(glyphName);
    }
    this.markGlyphsStaleForClassEdit(glyphNames);
    this.renderClassList();
    if (this.selectedClass?.side === side && this.selectedClass?.name === className) {
      this.renderClassSwatchStrip();
    }
    this.renderPairTable();
  }

  // Design doc §1.2 "Rerun scoping": "Joining or leaving a class now marks
  // that glyph the same way an edited outline already does (spec §4's
  // per-glyph keys)... class membership changing is a reason its row set may
  // need new coverage, exactly like a shape edit is." autokern-cache.js's
  // markGlyphStale (pure, unmodified -- see the file-top comment's file-
  // ownership rule) IS that per-glyph marking mechanism; nothing in this
  // view wires it to a live outline-edit change listener yet (grepped before
  // writing this -- no such call site exists anywhere else in this file
  // either), so this calls it directly, the exact way togglePairJunk below
  // calls markPairJunk directly for the same kind of per-pair mark.
  markGlyphsStaleForClassEdit(glyphNames) {
    for (const glyphName of glyphNames) {
      this.autokernCache = markGlyphStale(this.autokernCache, glyphName);
    }
    this.writeAutokernCacheToStorage();
  }

  // ---- Class list (design doc §1.2) ----

  // One flat list, every class from both groupsSide1 and groupsSide2 (design
  // doc §1.2: "one flat list, every class from both groupsSide1 and
  // groupsSide2").
  getAllClassPanelEntries() {
    const kernData = this.kerningController.kernData;
    const entries = [];
    for (const [name, members] of Object.entries(kernData.groupsSide1 || {})) {
      entries.push({ side: "side1", name, members });
    }
    for (const [name, members] of Object.entries(kernData.groupsSide2 || {})) {
      entries.push({ side: "side2", name, members });
    }
    entries.sort((a, b) => (a.side + a.name).localeCompare(b.side + b.name));
    return entries;
  }

  renderClassList() {
    const container = document.querySelector("#autokern-class-list");
    if (!container || !this.kerningController) {
      // Defensive only: initClassPanelSection runs after initPairTableSection
      // (start()'s own ordering, see its comment) so this.kerningController
      // always exists by the time this is first called, but acceptDerive-
      // Proposal/addGlyphsToClass also call this, and nothing enforces they
      // can never run before initClassPanelSection in some future reordering.
      return;
    }
    container.textContent = "";
    for (const entry of this.getAllClassPanelEntries()) {
      container.appendChild(this.buildClassListRowElement(entry));
    }
  }

  buildClassListRowElement(entry) {
    const row = document.createElement("div");
    row.className = "autokern-class-list-row";
    if (
      this.selectedClass?.side === entry.side &&
      this.selectedClass?.name === entry.name
    ) {
      row.classList.add("autokern-class-list-row-selected");
    }

    // Design doc §1.2: "each row tagged with a small 1st/2nd badge (same
    // icon convention as the New class buttons)". Part 5 fix: the visible
    // text is "Left"/"Right" (plain, immediately understood), the more
    // precise "side 1"/"side 2" meaning stays one hover away via `title` --
    // the underlying `entry.side` value ("side1"/"side2") is unchanged.
    const badge = document.createElement("span");
    badge.className = "autokern-class-badge";
    badge.textContent = entry.side === "side1" ? "Left" : "Right";
    badge.title =
      entry.side === "side1"
        ? "Kerning side 1 (left member of a pair)"
        : "Kerning side 2 (right member of a pair)";
    row.appendChild(badge);

    // Design doc §3: "the color shows as the swatch background behind a
    // class's row in the class list... and nowhere else." A button (not a
    // bare colored div) so it can double as the color-picker affordance
    // (§3's own text does not specify the exact widget; a native
    // <input type="color"> triggered by clicking the swatch is the simplest
    // reading, per this workstream's "keep it simple" instruction).
    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "autokern-class-color-swatch";
    colorButton.title = "Class color";
    const currentColor = this.getClassColor(entry.side, entry.name);
    colorButton.style.backgroundColor = currentColor || "transparent";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentColor || "#cccccc";
    colorInput.style.display = "none";
    colorInput.addEventListener("input", () => {
      colorButton.style.backgroundColor = colorInput.value;
    });
    colorInput.addEventListener("change", async (event) => {
      event.stopPropagation();
      await this.setClassColor(entry.side, entry.name, colorInput.value);
    });
    colorButton.addEventListener("click", (event) => {
      event.stopPropagation();
      colorInput.click();
    });
    row.appendChild(colorButton);
    row.appendChild(colorInput);

    const nameSpan = document.createElement("span");
    nameSpan.className = "autokern-class-name";
    nameSpan.textContent = entry.name;
    row.appendChild(nameSpan);

    // Design doc §5.2 (referenced by §1.2): "Long membership lists truncate
    // with a count, as the fold view already does" -- the SAME
    // truncateGlyphList this file's fold/derive-proposal rendering already
    // uses (below), not a second truncation convention.
    const membersSpan = document.createElement("span");
    membersSpan.className = "autokern-class-members";
    membersSpan.textContent = truncateGlyphList(entry.members);
    row.appendChild(membersSpan);

    // Part 5 fix 1: "No way to delete a class." Same trash-icon convention
    // panel-axes.js's own delete-axis control uses (icon-button.js,
    // tabler-icons/trash.svg) -- no new delete-affordance widget invented.
    // icon-button.js's own click handling calls event.stopImmediatePropagation()
    // from its INTERNAL button, which stops the click from ever bubbling up
    // to this row's own "click" listener (selectClass) -- so the row is never
    // accidentally selected by a delete click, and no separate stopPropagation
    // guard is needed the way the color swatch above needs one (that swatch's
    // own click listener is on a plain <button>, not an <icon-button>, so it
    // bubbles unless stopped explicitly).
    const deleteButton = document.createElement("icon-button");
    deleteButton.className = "autokern-class-delete-button";
    // `src` is IconButton's own reactive property (html-utils.js's
    // UnlitElement._setupProperties defines it via Object.defineProperty,
    // entirely separate from the HTML attribute of the same name -- there is
    // no observedAttributes/attributeChangedCallback on IconButton to sync
    // the two). Setting the ATTRIBUTE here (as this line used to) left the
    // PROPERTY undefined, so render()'s `this.src` read undefined and handed
    // inline-svg.js an unset src -- the "svgElement.removeAttribute is not a
    // function" crash reported live. panel-axes.js's own delete-axis control
    // gets this right via `html.createDomElement("icon-button", {src: ...})`,
    // which assigns the PROPERTY (`element[key] = value`); assigning the
    // property directly here matches that, once diagnosed.
    deleteButton.src = "/tabler-icons/trash.svg";
    deleteButton.setAttribute("data-tooltip", `Delete class "${entry.name}"`);
    deleteButton.setAttribute("data-tooltipposition", "left");
    deleteButton.onclick = () => this.confirmAndDeleteClass(entry.side, entry.name);
    row.appendChild(deleteButton);

    row.addEventListener("click", () => this.selectClass(entry.side, entry.name));

    return row;
  }

  // ---- Delete class (Part 5 fix 1) ----
  //
  // The data model has no separate "class exists" registry (see
  // createNewClassViaDialog's own comment): a class IS its glyphs' own
  // membership. So "delete class X on side S" means "clear every member
  // glyph's side-S class assignment" -- there is no second thing to delete.
  // Confirmed by reading kernData's own groupsSide1/groupsSide2 getters
  // (kerning-controller.js's `_updatePairGroupMappings`/constructor): they
  // are derived straight from the stored kerning table's own groupsSide1/
  // groupsSide2 dictionaries, which in turn only ever hold a name because
  // some glyph's editGroupSide1/editGroupSide2 call put it there -- deleting
  // every glyph out of a group's list is equivalent to the group never
  // having existed (kerning-controller.js's own _editGroup already deletes
  // the dictionary entry itself once its glyph list goes empty).
  //
  // Clearing mechanism: `_editGroup` (kerning-controller.js) already
  // supports a falsy `newGroupName` as "remove this glyph from every group
  // on this side" (its own comment: "The glyph is not part of any group
  // anymore") -- editGroupSide1(glyphName, "")/editGroupSide2(glyphName, "")
  // is the existing, unmodified clear-path; no new support needed there.
  //
  // Undo: editGroupSide1/editGroupSide2 do NOT push anything onto
  // this.autokernUndoStack themselves (confirmed by reading them -- they
  // only call fontController.performEdit and discard its return value, the
  // same finding acceptDeriveProposal's own comment already states). Even
  // addGlyphsToClass (the ordinary "join a class" write path, above) pushes
  // no undo record. So a plain confirm() dialog alone would NOT be backed by
  // Ctrl-Z here -- unlike acceptDeriveProposal, which manually builds and
  // pushes a "groupMembership"-kind record before its own writes. This
  // method does the same: builds and pushes that identical record shape
  // (doAutokernUndoRedo, below the pair-table section, already knows how to
  // replay a "groupMembership" record generically -- no new undo-replay code
  // needed) so Ctrl-Z genuinely restores every glyph's membership if the
  // confirm was a misclick.
  async confirmAndDeleteClass(side, name) {
    const kernData = this.kerningController.kernData;
    const groups = side === "side1" ? kernData.groupsSide1 : kernData.groupsSide2;
    const members = groups?.[name] || [];
    const sideLabel = side === "side1" ? "side 1 (left)" : "side 2 (right)";
    const dialog = await dialogSetup(
      `Delete class "${name}"?`,
      `This clears the ${sideLabel} class assignment on ${members.length} ` +
        `glyph${members.length === 1 ? "" : "s"}: ${truncateGlyphList(members)}. ` +
        `This can be undone with Ctrl-Z.`,
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        { title: "Delete", resultValue: "delete", isDefaultButton: true },
      ]
    );
    const result = await dialog.run();
    if (result !== "delete") {
      return;
    }
    await this.deleteClass(side, name, members);
  }

  async deleteClass(side, name, members) {
    const editFn =
      side === "side1"
        ? (glyphName, groupName) =>
            this.kerningController.editGroupSide1(glyphName, groupName)
        : (glyphName, groupName) =>
            this.kerningController.editGroupSide2(glyphName, groupName);

    const entries = members.map((glyphName) => ({
      glyphName,
      before: name,
      after: "",
    }));
    for (const entry of entries) {
      await editFn(entry.glyphName, entry.after);
    }
    this.autokernUndoStack.pushUndoRecord({
      info: {
        label: `kerning view: delete class "${name}"`,
        kind: "groupMembership",
        editSide: side,
        entries,
      },
    });

    // Design doc §3: color storage must not accumulate an orphaned entry for
    // a class that no longer exists -- same performEdit-under-"customData"
    // pattern setClassColor already uses (copy both sides, mutate the copy,
    // reassign the whole object), just deleting the one (side, name) entry
    // instead of setting it.
    await this.fontController.performEdit(
      "kerning view: delete class color",
      "customData",
      (root) => {
        const stored = root.customData[AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY];
        if (stored?.[side]?.[name] === undefined) {
          return;
        }
        const colors = {
          side1: { ...(stored.side1 || {}) },
          side2: { ...(stored.side2 || {}) },
        };
        delete colors[side][name];
        root.customData[AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY] = colors;
      },
      this
    );

    this.markGlyphsStaleForClassEdit(members);
    if (this.selectedClass?.side === side && this.selectedClass?.name === name) {
      this.selectedClass = null;
    }
    // Same refresh pattern addGlyphsToClass already uses.
    this.renderClassList();
    this.renderClassSwatchStrip();
    this.renderPairTable();
  }

  // Design doc §1.2: "Selecting a row is what 'selected class' means
  // everywhere else in this panel and in font mode's add-to-class actions."
  selectClass(side, name) {
    this.selectedClass = { side, name };
    this.renderClassList();
    this.renderClassSwatchStrip();
    // Font mode's own "Add selection to selected class" button is disabled
    // until both a grid selection and a class-list selection exist
    // (updateFontModeAddToClassButton, below) -- selecting a class here is
    // one half of that condition, so it needs to re-check itself now. Only
    // called if font mode has actually initialized (it always has by the
    // time a designer can click a class row, since both init from the same
    // start(), but this guard costs nothing and avoids a hard dependency
    // on that section's own init order).
    this.updateFontModeAddToClassButton?.();
  }

  // ---- Glyph-swatch strip (design doc §1.2) ----

  renderClassSwatchStrip() {
    const container = document.querySelector("#autokern-class-swatch-strip");
    if (!container) {
      return;
    }
    container.textContent = "";
    if (!this.selectedClass) {
      return;
    }
    const kernData = this.kerningController.kernData;
    const groups =
      this.selectedClass.side === "side1" ? kernData.groupsSide1 : kernData.groupsSide2;
    const members = groups?.[this.selectedClass.name] || [];
    this.renderGlyphSwatches(container, members);
  }

  // Shared by the swatch strip and the "Show class" dialog's live preview
  // below -- one glyph-tile builder, not two. Part 5 fix 3: each tile's
  // background is now split, left half = the glyph's side-1 class color,
  // right half = its side-2 class color -- explicitly NOT the font-mode
  // grid's own GlyphCellView tiles (design doc §3 declined grid tinting
  // there; that component is untouched by this method, which only ever
  // builds bare GlyphCell instances for THIS panel and the Show-class
  // dialog).
  renderGlyphSwatches(container, glyphNames) {
    container.textContent = "";
    for (const glyphName of glyphNames) {
      const codePoints = this.fontController.glyphMap?.[glyphName];
      if (codePoints === undefined) {
        continue; // not a real glyph in this font -- nothing to show
      }
      container.appendChild(this.buildSplitColorGlyphSwatch(glyphName, codePoints));
    }
  }

  // One glyph tile, colored per Part 5 fix 3. Lookup mirrors
  // openShowClassDialog's own side1Name/side2Name reads
  // (leftPairGroupMapping/rightPairGroupMapping); the color for each comes
  // from getClassColor (design doc §3), already built by the class-color
  // work. DOM/styling approach: GlyphCell (glyph-cell.js) exposes its
  // resting background only through the CSS custom property
  // `--cell-background-color` (its shadow-DOM `#glyph-cell-container` sets
  // `--this-background-color: var(--cell-background-color)`, which every
  // other state -- hover/active/selected -- overrides on top of, so
  // overriding just this one custom property on the host element changes
  // only the resting/idle look, never fighting hover/selection) -- a real,
  // already-existing hook, not a new one added to glyph-cell.js. That alone
  // only allows ONE flat color, not a split, so an outer wrapper `<div>`
  // (`.autokern-glyph-swatch-split`) supplies the actual two-color
  // background as a hard-stop linear-gradient behind the cell, and the
  // cell's own `--cell-background-color` is set to `transparent` (only when
  // at least one side has a color -- see below) so the wrapper's gradient
  // shows through instead of being hidden underneath the cell's normal
  // opaque background.
  //
  // No color on either side (or neither side classed) renders EXACTLY as
  // before: no wrapper is created at all, and the cell's own
  // --cell-background-color is left untouched -- the uncolored case is not
  // regressed.
  buildSplitColorGlyphSwatch(glyphName, codePoints) {
    const cell = new GlyphCell(
      this.fontController,
      glyphName,
      codePoints,
      this._classPanelLocationController,
      "location"
    );

    const side1Name = this.kerningController.leftPairGroupMapping[glyphName];
    const side2Name = this.kerningController.rightPairGroupMapping[glyphName];
    const side1Color = side1Name ? this.getClassColor("side1", side1Name) : undefined;
    const side2Color = side2Name ? this.getClassColor("side2", side2Name) : undefined;

    if (!side1Color && !side2Color) {
      return cell;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "autokern-glyph-swatch-split";
    wrapper.style.background = `linear-gradient(to right, ${
      side1Color || "transparent"
    } 50%, ${side2Color || "transparent"} 50%)`;
    cell.style.setProperty("--cell-background-color", "transparent");
    wrapper.appendChild(cell);
    return wrapper;
  }

  // ---- Class color (design doc §3) ----

  getClassColor(side, name) {
    const colors =
      this.fontController.customData?.[AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY];
    return colors?.[side]?.[name];
  }

  // Same performEdit-under-"customData" pattern writeJunkMarksToProject uses
  // (see the file-top comment for the exact citation) -- recomputes nothing
  // else, only sets this one (side, name) entry, preserving every other
  // stored color.
  async setClassColor(side, name, color) {
    await this.fontController.performEdit(
      "kerning view: set class color",
      "customData",
      (root) => {
        const stored = root.customData[AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY] || {};
        const colors = {
          side1: { ...(stored.side1 || {}) },
          side2: { ...(stored.side2 || {}) },
        };
        colors[side][name] = color;
        root.customData[AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY] = colors;
      },
      this
    );
    this.renderClassList();
  }

  // ---- "Show class" context menu (design doc §1.2, item F) ----

  // The canvas's one contextmenu listener (initClassPanelSection, above).
  // Finds the glyph under the cursor via sceneModel.glyphAtPoint the same
  // way edit-tools-select.js's own pointer tool already resolves a click to
  // a glyph, then offers exactly one action -- there being only one
  // context-menu action this workstream defines, a single-item menu (rather
  // than a bare dialog with no menu at all) still follows the "context menu
  // registration" convention this brief asks to match (editor.js's own
  // canvas contextmenu -> showMenu(items, {x, y})), which is what makes this
  // extensible later without a second wiring mechanism.
  classPanelContextMenuHandler(event) {
    const point = this.sceneController.localPoint(event);
    const glyphHit = this.sceneModel.glyphAtPoint(point);
    if (!glyphHit) {
      return;
    }
    const positionedGlyph =
      this.sceneModel.positionedLines?.[glyphHit.lineIndex]?.glyphs?.[
        glyphHit.glyphIndex
      ];
    const glyphName = positionedGlyph?.glyphName;
    if (!glyphName) {
      return;
    }
    event.preventDefault();
    const { x, y } = event;
    showMenu(
      [
        {
          title: "Show class",
          callback: () => this.openShowClassDialog(glyphName),
        },
      ],
      { x: x + 1, y: y - 1 }
    );
  }

  // Design doc §1.2: "opens a dialog to pick one or more target glyphs --
  // typing plus preview swatches, same input style as the excluded-glyph
  // field -- then previews the selected glyph's class(es) against every
  // chosen target in the scene, one row per member."
  async openShowClassDialog(sourceGlyphName) {
    const side1Name = this.kerningController.leftPairGroupMapping[sourceGlyphName];
    const side2Name = this.kerningController.rightPairGroupMapping[sourceGlyphName];
    if (!side1Name && !side2Name) {
      await message(
        "Show class",
        `"${sourceGlyphName}" has no class on either side -- nothing to preview.`
      );
      return;
    }

    const dialog = await dialogSetup(`Show class: ${sourceGlyphName}`, null, [
      { title: translate("dialog.cancel"), isCancelButton: true },
      { title: translate("dialog.okay"), isDefaultButton: true, resultValue: true },
    ]);

    const container = document.createElement("div");
    container.className = "autokern-show-class-dialog";

    const label = document.createElement("label");
    label.textContent = "Target glyphs (comma or space separated)";
    const targetsInput = document.createElement("input");
    targetsInput.type = "text";
    container.appendChild(label);
    container.appendChild(targetsInput);

    const preview = document.createElement("div");
    preview.className = "autokern-show-class-dialog-preview";
    container.appendChild(preview);

    targetsInput.addEventListener("input", () => {
      this.renderGlyphSwatches(
        preview,
        this.parseExcludedGlyphNames(targetsInput.value)
      );
    });

    dialog.setContent(container);
    setTimeout(() => targetsInput.focus(), 0);

    const ok = await dialog.run();
    if (!ok) {
      return;
    }
    const targetGlyphNames = this.parseExcludedGlyphNames(targetsInput.value);
    if (!targetGlyphNames.length) {
      return;
    }

    this.showClassPreviewInScene(
      sourceGlyphName,
      side1Name,
      side2Name,
      targetGlyphNames
    );
  }

  // Builds one "/left /right" line per (class member, target glyph)
  // combination and sets it directly as the scene text -- the same
  // "/glyphname" syntax selectPairForScene already uses for the same reason
  // (characterLinesFromString resolves it whether or not the glyph has a
  // literal character). A side-1 class member is the LEFT glyph in the
  // language this class answers for (spec §5: "Side 1 is the left member of
  // a pair"); a side-2 member is the RIGHT glyph. Deliberately bypasses the
  // phrase/pair chip machinery (this._chipMode, this._selectedPairText) the
  // same way pair mode's own selectPairForScene does -- this is a THIRD,
  // temporary scene text, not a new chip mode (out of this workstream's
  // scope; the chip selector is the font-mode worker's/design doc §2's
  // region). Switching to "phrase" or "pair" afterward replaces it exactly
  // as it always did, per setChipMode's own restore logic.
  showClassPreviewInScene(sourceGlyphName, side1Name, side2Name, targetGlyphNames) {
    const kernData = this.kerningController.kernData;
    const lines = [];
    if (side1Name) {
      for (const member of kernData.groupsSide1[side1Name] || []) {
        for (const target of targetGlyphNames) {
          lines.push(`/${member} /${target}`);
        }
      }
    }
    if (side2Name) {
      for (const member of kernData.groupsSide2[side2Name] || []) {
        for (const target of targetGlyphNames) {
          lines.push(`/${target} /${member}`);
        }
      }
    }
    if (!lines.length) {
      return;
    }
    this.sceneSettingsController.setItem("text", lines.join("\n"));
  }

  // ---------------------------------------------------------------------

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

      // Task 12, spec F26/§12.3: "On a source change, cancel any armed
      // Reset and make sure a pending action can't target the wrong
      // source." Done SYNCHRONOUSLY, before the await below -- rowId's
      // source component means every currently-displayed row's ID is about
      // to be stale (renderPairTable, once it eventually reruns via
      // loadAutokernCacheFromStorage, will rebuild rows addressed at the
      // NEW source), but that rebuild is asynchronous; a click landing in
      // the gap between selecting a new source and that rebuild completing
      // must not resolve targets from the OLD source's still-displayed
      // rows (getSelectedPairTableRows reads left/right only, not source --
      // writePairValues/resetSelectedPairRows always write to
      // this.autokernSource, so a stale ticked row from the old source
      // would otherwise silently write into the NEW source instead).
      // Clearing selection outright is also what disarms Reset
      // (resetArmedKey's own target-key comparison, refreshResetArmState).
      this.resultSelection = deselectAll();
      this.resetArmedKey = null;
      this.applyResultSelectionToDom();
      this.refreshResetArmState();

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
    // Task 8: row kind (unique-pair/member-pair/pair-exception, from
    // pairRowData) -- distinguishes this row from a class-summary row
    // (dataset.kind "class-rule") for expandHighlightedRowsToPairs, which
    // reads a pair row's literal left/right directly but a class-summary
    // row's full membership instead.
    tr.dataset.kind = row.kind;
    // Task 11, spec F15: "reinforce those distinctions with names, icons,
    // or labels" -- a non-color cue alongside kerning.css's own
    // data-kind-keyed accent color, so the three categories (classes,
    // uniques, exceptions) are distinguishable without relying on color
    // alone. "member-pair" reads as a class row here (its cascade is still
    // class-derived; F15 groups it with "classes," not as a fourth
    // category) -- the same grouping rowRelationship already uses.
    tr.title = ROW_KIND_CATEGORY_LABELS[row.kind] || "";

    // Task 3 (spec F04): stable row ID for the highlight/tick selection
    // layer, independent of scene preview selection below.
    const id = rowId(this.activeSourceIdentifier(), row.left, row.right);
    tr.dataset.rowId = id;
    tr.classList.toggle(
      "kerning-pairtable-row-highlighted",
      this.resultSelection.highlighted.has(id)
    );

    // WORKSTREAM 16, spec §6: "Clicking a row in the table selects that pair
    // and flips the chip to `pair`." Ignores clicks on the row's own
    // checkbox/junk-mark button (event.target.closest guard) so selecting
    // for apply/reset and marking junk are unaffected -- only a click on the
    // row itself (its plain cells) selects the pair for the scene.
    //
    // Task 3 (spec F04 table): ordinary click highlights this row alone;
    // Shift-click adds/removes it from the highlighted set, never a range.
    // Highlight is the preview-selection layer -- separate from the tick
    // (action-target) layer below. Task 7: updatePairPreview reads the
    // highlighted set itself (every currently highlighted row's pair,
    // together -- spec F04: "Highlighted rows populate pair-mode preview
    // together"), so both an ordinary click and a Shift-click feed pair
    // preview now; only an ordinary click also flips the chip to `pair`
    // (WORKSTREAM 16, spec §6), matching the pre-existing single-pair
    // click behavior instead of forcing every Shift-click to jump the
    // designer out of whatever mode they're in.
    tr.addEventListener("click", (event) => {
      if (event.target.closest("input, button")) {
        return;
      }
      this.resultSelection = selectRow(this.resultSelection, id, event.shiftKey);
      this.applyResultSelectionToDom();
      this.updatePairPreview({ switchToPairMode: !event.shiftKey });
    });

    // F32: "place the tick inside the left-name cell so it does not add an
    // unrequested column" -- Glyph L (name) / Current / Proposed / Delta /
    // Glyph R (name) / Exception / Hide, in that order.
    const leftCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "kerning-pairtable-row-select";
    // Backlog item 8 part 4: the hard-disable is gone. A flat apply on a
    // shadowing row is now allowed but routed through a confirmation dialogue
    // (confirmShadowingWrite, from writePairValues) -- the checkbox stays
    // enabled; only a hint is shown until the override is deliberate.
    if (this.wouldShadowClassCell(row.left, row.right) && !row.override) {
      checkbox.title =
        "Applying this pair writes a value that shadows a class cell -- you'll be asked to confirm.";
    }
    checkbox.checked = this.resultSelection.ticked.has(id);
    // Task 3 (spec F04 table): checking/unchecking a HIGHLIGHTED row acts
    // on every highlighted row; an unhighlighted row's tick changes alone
    // (tickRow in results-selection.js). Re-applies to the DOM afterward
    // because this can change checkboxes on rows other than the one that
    // was actually clicked.
    //
    // Backlog item 13: keeps the select-all checkbox's checked/
    // indeterminate state truthful when a row is (un)checked by hand rather
    // than via select-all itself.
    checkbox.addEventListener("change", () => {
      this.resultSelection = tickRow(this.resultSelection, id, checkbox.checked);
      this.applyResultSelectionToDom();
      this.syncSelectAllCheckboxes();
      this.refreshResetArmState();
    });
    leftCell.appendChild(checkbox);
    const leftLabel = document.createElement("span");
    // Task 11, spec F17: the class kerning.css's own
    // .kerning-pairtable-row-hidden rule targets for the dimmed/
    // struck-through hidden-row name styling.
    leftLabel.className = "kerning-pairtable-glyph-name";
    leftLabel.textContent = row.left;
    leftCell.appendChild(leftLabel);
    tr.appendChild(leftCell);

    const currentCell = document.createElement("td");
    currentCell.className = "kerning-pairtable-current-col";
    currentCell.textContent = row.current;
    currentCell.style.display = this.autokernFiltersController.model.showCurrent
      ? ""
      : "none";
    tr.appendChild(currentCell);

    // Task 5, spec F13/F32: Proposed is its own column (the raw
    // suggestion, row.suggestion), independent of Delta (suggestion minus
    // current) below.
    const proposedCell = document.createElement("td");
    proposedCell.className = "kerning-pairtable-proposed-col";
    proposedCell.textContent =
      row.suggestion > 0 ? `+${row.suggestion.toFixed(1)}` : row.suggestion.toFixed(1);
    proposedCell.style.display = this.autokernFiltersController.model.showProposed
      ? ""
      : "none";
    tr.appendChild(proposedCell);

    const deltaCell = document.createElement("td");
    deltaCell.className = "kerning-pairtable-suggestion-col";
    deltaCell.textContent =
      row.delta > 0 ? `+${row.delta.toFixed(1)}` : row.delta.toFixed(1);
    deltaCell.style.display = this.autokernFiltersController.model.showSuggestion
      ? ""
      : "none";
    tr.appendChild(deltaCell);

    const rightCell = document.createElement("td");
    const rightLabel = document.createElement("span");
    rightLabel.className = "kerning-pairtable-glyph-name";
    rightLabel.textContent = row.right;
    rightCell.appendChild(rightLabel);
    tr.appendChild(rightCell);

    // F32's override-action column. Task 10, spec F12/F29/F19: the real
    // lock/Remove-exception control, plus the Potential tab's own
    // accept-candidate action in the same position. Ground truth is
    // row.explicitPairExists (Task 2's literal-address read), never the
    // cache's historical `row.override` badge (F12: "Do not infer exception
    // state solely from ... a historical cache badge") -- once any write
    // (this control OR a confirmed Apply-selected override) creates a
    // literal rule, explicitPairExists is true and this cell shows the same
    // Remove-exception control regardless of which path wrote it.
    const exceptionCell = document.createElement("td");
    const tab = this.activeResultsTab || "default";
    const hasApplicableClass = this.isLeftClassed(row.left) || this.isRightClassed(row.right);

    if (tab === "potential" && row.isCandidate) {
      // F19: "An apply-exception action must identify the exact pair and
      // proposed value it will save" -- row.suggestion (the candidate's own
      // proposed value), never row.current.
      const acceptButton = document.createElement("button");
      acceptButton.type = "button";
      acceptButton.className = "kerning-pairtable-accept-exception";
      acceptButton.textContent = "Apply exception";
      acceptButton.title = `Save ${row.left} × ${row.right} = ${row.suggestion} as a pair exception`;
      acceptButton.addEventListener("click", () =>
        this.createPairException(row.left, row.right, row.suggestion)
      );
      exceptionCell.appendChild(acceptButton);
    } else if (hasApplicableClass) {
      // F12: the lock only ever appears "for an individual pair with
      // applicable class kerning" -- a fully unique pair (neither side
      // classed) has no class rule to except from, so this cell stays empty
      // for it, same as before.
      if (row.explicitPairExists) {
        // F12: "A saved exception's indicator remains visible" (not muted,
        // unlike the create-lock below).
        const removeButton = document.createElement("icon-button");
        removeButton.className =
          "kerning-pairtable-exception-indicator kerning-pairtable-exception-saved";
        removeButton.src = "/tabler-icons/lock.svg";
        removeButton.setAttribute(
          "aria-label",
          `Remove pair exception for ${row.left} × ${row.right}`
        );
        removeButton.setAttribute(
          "data-tooltip",
          `Pair exception. Remove exception to restore the inherited value ` +
            `(${this.inheritedFallbackValue(row.left, row.right)}).`
        );
        removeButton.onclick = () => this.removePairException(row.left, row.right);
        exceptionCell.appendChild(removeButton);
      } else {
        // F12: "An inherited pair's lock is muted until hover or focus" --
        // kerning.css's own .kerning-pairtable-exception-create rule holds
        // the muted/reveal styling; this only assigns the class.
        const lockButton = document.createElement("icon-button");
        lockButton.className =
          "kerning-pairtable-exception-indicator kerning-pairtable-exception-create";
        lockButton.src = "/tabler-icons/lock-open-2.svg";
        lockButton.setAttribute(
          "aria-label",
          `Create a pair exception for ${row.left} × ${row.right}`
        );
        lockButton.setAttribute(
          "data-tooltip",
          `Inherited value: ${row.current} (Class value). Create exception to save it as a pair exception.`
        );
        lockButton.onclick = () => this.createPairException(row.left, row.right, row.current);
        exceptionCell.appendChild(lockButton);
      }
    }
    tr.appendChild(exceptionCell);

    // F32's hide-action column. Task 11, spec F10/F17: the eye control.
    // Reveal-on-hover/focus uses the exact same row-hover convention Task
    // 10's lock/Remove-exception cell already established (kerning.css's
    // tr:hover/tr:focus-within rule), not a second one.
    tr.classList.toggle("kerning-pairtable-row-hidden", !!row.hidden);
    const hideCell = document.createElement("td");
    const hideButton = document.createElement("icon-button");
    hideButton.className =
      "kerning-pairtable-hide-indicator kerning-pairtable-hide-action";
    if (row.hidden) {
      hideButton.src = "/tabler-icons/eye-closed.svg";
      hideButton.setAttribute(
        "aria-label",
        `Restore hidden result ${row.left} × ${row.right}`
      );
      hideButton.setAttribute(
        "data-tooltip",
        "Hidden. Restore to show this result again -- its saved kerning value is unchanged."
      );
    } else {
      hideButton.src = "/tabler-icons/eye.svg";
      hideButton.setAttribute("aria-label", `Hide result ${row.left} × ${row.right}`);
      hideButton.setAttribute(
        "data-tooltip",
        "Hide this result from normal browsing -- it does not delete saved kerning."
      );
    }
    hideButton.onclick = () => this.togglePairJunk(row.left, row.right, !row.hidden);
    hideCell.appendChild(hideButton);
    tr.appendChild(hideCell);

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

  // Task 4: reads TICKED rows from this.resultSelection, the state Task 3
  // introduced -- not a DOM-wide checkbox query. Parses each ticked row ID
  // (results-model.js's rowId, `JSON.stringify([sourceId, leftName,
  // rightName])`) back into an address. Addresses are snapshotted here,
  // before any asynchronous write, per plan Task 4's "snapshot addresses
  // before asynchronous writes."
  getSelectedPairTableRows() {
    return [...this.resultSelection.ticked].map((id) => {
      const [, left, right] = JSON.parse(id);
      return { left, right };
    });
  }

  async applySelectedPairRows() {
    await this.writePairValues(
      this.getSelectedPairTableRows(),
      (entry) => entry.value,
      true,
      true
    );
  }

  // Task 4, spec F20: "Remove Reset to current, Apply all, and the
  // manual-value input. Keep Apply selected and Reset selected." Reset
  // always writes explicit 0 -- it is not "reset to current" and it is not
  // "remove exception" (that stays its own, separate control -- plan
  // Task 10, not built yet). First press arms and shows the target count;
  // a second press with the SAME ticked set commits. Any change to the
  // ticked set between presses disarms (results-selection.js's pressReset,
  // called via refreshResetArmState from every place resultSelection.ticked
  // can change).
  //
  // "Scope-aware" routing of a class-summary row to its class address
  // versus a member row to its literal pair address (plan Task 4's own
  // text): Task 8 closes this gap. A ticked class-summary row's rowId
  // carries a "@ClassName" address (buildClassSummaryRowElement), which
  // writePairValues now resolves through its own stashed median rather
  // than a literal autokernCache lookup -- see writePairValues' own
  // comment. applyFoldedParentRow (the class-summary row's own dedicated
  // "Apply class" button) remains a separate, still-working control; this
  // tick/Reset path is an additional way to reach the same class address,
  // not a replacement for it.
  async resetSelectedPairRows() {
    const targetIds = [...this.resultSelection.ticked];
    const { commit, armedKey } = pressReset(this.resetArmedKey, targetIds);
    this.resetArmedKey = armedKey;
    this.updateResetButtonLabel();
    if (!commit) {
      return;
    }
    const rows = targetIds.map((id) => {
      const [, left, right] = JSON.parse(id);
      return { left, right };
    });
    await this.writePairValues(rows, () => 0, false);
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
  // Undo: fontController's own `undoStacks` (font-controller.js's
  // pushUndoRecord/getUndoRedoInfo/undoRedoGlyph) is keyed one stack per
  // GLYPH NAME, fed exclusively by GlyphEditContext.editFinal, and its
  // pushUndoRecord asserts the change touches exactly one glyph name -- a
  // kerning-table change, under the "kerning" root key, touches zero, so it
  // structurally cannot use that mechanism (this was the previous state of
  // this comment, and remains true: that specific stack is still closed to
  // kerning writes). What changed: this view now carries its OWN font-level
  // undo stack for exactly this situation, `this.autokernUndoStack` (built
  // in the constructor), following the SAME pattern
  // views-fontinfo/src/panel-base.js's BaseInfoPanel already uses for a
  // non-per-glyph, font-root-key edit that still needs to be locally
  // undoable (BaseInfoPanel's own `this.undoStack`/`postChange`). The
  // difference from BaseInfoPanel's postChange: KernPairEditContext.edit
  // (kerning-controller.js's editContinuous, called via
  // getEditContext(...).edit(...) below) already calls
  // fontController.editFinal itself and returns the ChangeCollector
  // (`{change, rollbackChange}`) it built -- so this method does not call
  // editFinal a second time; it captures that return value and pushes it
  // straight onto this.autokernUndoStack, in the same {change,
  // rollbackChange, info: {label}} shape BaseInfoPanel's postChange pushes.
  // doAutokernUndoRedo (see callDelegateMethod below) pops it and replays it
  // exactly the way BaseInfoPanel.doUndoRedo does: fontController.applyChange
  // then a rollback-direction fontController.editFinal.
  //
  // Backlog item 8 part 4, updated by Task 4 (spec F20 removed Apply all,
  // Reset to current, and the manual-value input; only Apply selected and
  // Reset selected remain): `confirmShadow` is passed true by
  // applySelectedPairRows and left false by resetSelectedPairRows --
  // writing an explicit zero is a deliberate flat-exception action, not an
  // accidental shadow, and must not pop a dialogue. When true and the batch
  // contains any pair whose
  // write would shadow a class cell (wouldShadowClassCell), ONE dialogue
  // summarising the batch is shown before anything is written; on "Apply as
  // override" the write proceeds unchanged and each shadowing pair's cache
  // entry is marked with markPairOverride (part 5).
  async writePairValues(pairs, valueFn, markApplied, confirmShadow = false) {
    if (!pairs.length) {
      return;
    }
    // Task 12 fix (ledger §5.4): write to the source the status strip has
    // selected, not always the font's default source -- this used to
    // resolve via getSourceIdentifierForLocation({}, false), which always
    // merges {} with the font's defaultSourceLocation and so always
    // answered the default source no matter which source was picked.
    const sourceIdentifier = this.autokernSource;
    if (!sourceIdentifier) {
      // Mirrors edit-tools-metrics.js's own guard (getEditContext there:
      // "if (!sourceIdentifier && wantValues) { this.showDialogLocationNotAtSource(); }")
      // -- this only fires for a font with zero sources, which has no
      // kerning to write regardless.
      console.error("kerning view: cannot apply, no source is selected");
      return;
    }

    const pairSelectors = [];
    const values = [];
    const keys = [];
    for (const { left, right } of pairs) {
      // Task 8: a ticked class-summary row addresses "@LeftClass"/
      // "@RightClass" (buildClassSummaryRowElement's own rowId), which is
      // never a literal autokernCache key -- its value is its own median,
      // stashed at render time (renderPairTable), not a per-pair cache
      // entry. `keys` (autokernAppliedPairs) still gets the class address
      // itself; nothing else reads that Set by class-address shape, so
      // this is harmless bookkeeping, not a claim that a class rule is a
      // "pair."
      if (left.startsWith("@") && right.startsWith("@")) {
        const id = rowId(sourceIdentifier, left, right);
        const median = this._classSummaryMedianByRowId?.get(id);
        if (median === undefined) {
          continue; // not currently rendered -- nothing to write
        }
        pairSelectors.push({ leftName: left, rightName: right, sourceIdentifier });
        values.push(Math.round(valueFn({ value: median }, left, right)));
        keys.push(pairKey(left, right));
        continue;
      }
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

    // Backlog item 8 part 4: confirm before writing any value that shadows a
    // class cell. One dialogue for the whole batch, not one per row.
    const shadowingPairs = confirmShadow
      ? pairSelectors
          .filter((sel) => this.wouldShadowClassCell(sel.leftName, sel.rightName))
          .map((sel) => ({ left: sel.leftName, right: sel.rightName }))
      : [];
    if (shadowingPairs.length) {
      const proceed = await this.confirmShadowingWrite(shadowingPairs, valueFn);
      if (!proceed) {
        return;
      }
    }

    const editContext = this.kerningController.getEditContext(pairSelectors);
    const changes = await editContext.edit(values, "kerning view: pair table write");

    if (changes?.hasChange) {
      this.autokernUndoStack.pushUndoRecord({
        change: changes.change,
        rollbackChange: changes.rollbackChange,
        info: {
          label: "kerning view: pair table write",
          kind: "pairValues",
        },
      });
    }

    if (markApplied) {
      for (const key of keys) {
        this.autokernAppliedPairs.add(key);
      }
    }

    // Backlog item 8 part 5: a confirmed shadowing write is now a deliberate
    // override -- flag each such pair's cache entry (markPairOverride, pure,
    // returns a new Map) and persist to the OPFS cache file so the neutral
    // "override" badge survives a reload, the same way junk marks do.
    if (shadowingPairs.length) {
      for (const { left, right } of shadowingPairs) {
        this.autokernCache = markPairOverride(this.autokernCache, left, right);
      }
      await this.writeAutokernCacheToStorage();
    }

    this.renderPairTable();
  }

  // Backlog item 8 part 4: the confirmation dialogue for a batch that would
  // write one or more values on top of a class cell that currently answers
  // for the pair. Names the shadowed address (describeShadowedClassCell) and
  // shows both numbers -- the group value now, and the value about to be
  // written -- for up to a handful of pairs, then a count for the rest.
  // Reuses this codebase's standard modal (modal-dialog.js's dialogSetup/run,
  // the same one every other dialogue in this view uses). Returns true only
  // on "Apply as override".
  async confirmShadowingWrite(shadowingPairs, valueFn) {
    const shown = shadowingPairs.slice(0, 6);
    const lines = shown.map(({ left, right }) => {
      const entry = this.autokernCache.get(pairKey(left, right));
      // Task 12 fix: same active-source read as pairRowData/overrideDivergence.
      const groupValue =
        this.kerningController.getGlyphPairValueForSource(
          left,
          right,
          this.autokernSource
        ) ?? 0;
      const newValue = Math.round(valueFn(entry, left, right));
      return (
        `  ${left} × ${right}: ${this.describeShadowedClassCell(left, right)} ` +
        `resolves to ${groupValue}, this writes ${newValue}`
      );
    });
    const extra = shadowingPairs.length - shown.length;
    const more = extra > 0 ? `\n  …and ${extra} more.` : "";
    const headline =
      shadowingPairs.length === 1
        ? "Write a value that shadows a class cell?"
        : `Write ${shadowingPairs.length} values that shadow class cells?`;
    const dialog = await dialogSetup(
      headline,
      `A literal glyph-pair value always wins over the class cell that would ` +
        `otherwise answer for the pair, and stays in the font as a per-pair ` +
        `exception until it is reset:\n${lines.join("\n")}${more}`,
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        {
          title: "Apply as override",
          resultValue: "override",
          isDefaultButton: true,
        },
      ]
    );
    return (await dialog.run()) === "override";
  }

  // Task 10, spec F12/F29: the lock control's own "create an exception" and
  // "Remove exception" actions, and F19's accept-a-candidate action (which
  // is the SAME path, just with the candidate's own suggested value instead
  // of the current value -- see buildPairRowElement's own call site below).
  // Ledger §5.2/§5.3: binds directly to KerningController.getEditContext(...)
  // .edit(...)/.delete(...), the exact real-font-write mechanism
  // writePairValues already uses, pushing the SAME {change, rollbackChange,
  // info: {label, kind}} shape onto this.autokernUndoStack so
  // doAutokernUndoRedo already replays it with no further changes needed
  // there. Deliberately NOT routed through writePairValues itself: that
  // method reads its values from this.autokernCache by pairKey (an autokern
  // suggestion-cache entry), which has nothing to do with "save the
  // CURRENT effective value" (a plain lock click) or "save this candidate's
  // own suggested value" (F19) -- both are already-known numbers here, not
  // cache lookups.
  //
  // F12: "Creating an exception saves an explicit glyph-glyph rule while
  // preserving both glyphs' class memberships" -- getEditContext only ever
  // touches font.kerning[...].values, never groupsSide1/groupsSide2, so
  // membership is untouched by construction, not by a separate guard here.
  async createPairException(left, right, value) {
    // Task 12 fix (ledger §5.4): same active-source write as
    // writePairValues/applyFoldedParentRow.
    const sourceIdentifier = this.autokernSource;
    if (!sourceIdentifier) {
      // Mirrors writePairValues' own guard/comment above.
      console.error("kerning view: cannot create a pair exception, no source is selected");
      return;
    }
    const editContext = this.kerningController.getEditContext([
      { leftName: left, rightName: right, sourceIdentifier },
    ]);
    const changes = await editContext.edit(
      [Math.round(value)],
      "kerning view: create pair exception"
    );
    if (changes?.hasChange) {
      this.autokernUndoStack.pushUndoRecord({
        change: changes.change,
        rollbackChange: changes.rollbackChange,
        info: { label: "kerning view: create pair exception", kind: "pairValues" },
      });
    }
    this.renderPairTable();
  }

  // F12: "the action becomes Remove exception. It deletes the explicit rule
  // and restores the applicable inherited value; it does not copy that
  // value into another explicit pair rule." Ledger §5.2: this is the FIRST
  // caller of KerningEditContext.delete anywhere in the app -- real
  // deletion (`delete values[leftName][rightName]`), never a zero write.
  async removePairException(left, right) {
    const editContext = this.kerningController.getEditContext([
      // delete() reads only leftName/rightName from its selectors -- it
      // deletes the whole per-source values array in one step, it does not
      // address a single source, so no sourceIdentifier is needed here
      // (unlike createPairException's selector).
      { leftName: left, rightName: right },
    ]);
    const changes = await editContext.delete("kerning view: remove pair exception");
    if (changes?.hasChange) {
      this.autokernUndoStack.pushUndoRecord({
        change: changes.change,
        rollbackChange: changes.rollbackChange,
        info: { label: "kerning view: remove pair exception", kind: "pairValues" },
      });
    }
    this.renderPairTable();
  }

  // F12's own "Recommended detail: show the inherited value in a tooltip or
  // row detail" for the Remove-exception control. Mirrors
  // getGlyphPairValueForSource's own cascade (getPairsToTry, most specific
  // first) but starts one entry later -- pairsToTry[0] is always this exact
  // literal pair itself, which is precisely the exception being considered
  // for removal, so this reads what the SECOND-most-specific address (a
  // partial or full class fallback) currently resolves to at the active
  // source, i.e. what removal would restore. Task 12 fix: reads
  // getPairValueForSource(..., this.autokernSource) instead of a
  // default-location pairFunction({}) call, matching every other read in
  // this file; skips a sparse null the same way getGlyphPairValueForSource
  // itself does (a stored-but-null entry at this source is not "resolved,"
  // the cascade keeps going).
  inheritedFallbackValue(left, right) {
    const pairsToTry = this.kerningController.getPairsToTry(left, right).slice(1);
    for (const [leftName, rightName] of pairsToTry) {
      const value = this.kerningController.getPairValueForSource(
        leftName,
        rightName,
        this.autokernSource
      );
      if (value != undefined) {
        return value;
      }
    }
    return 0;
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

  // Layout overhaul, design doc §1: "Three resizable columns, using the same
  // drag-splitter mechanism `views-editor` already uses for its own panels
  // -- reused, not reimplemented." Sidebar (views-editor/src/sidebar.js,
  // exported cross-view via that package's widened exports map, spec §8's
  // own pattern) already owns exactly this: a pointer-drag handler that
  // clamps a width and writes it to a CSS custom property
  // (`--sidebar-content-width-<identifier>`), plus the min/max clamp and
  // localStorage persistence, keyed by identifier. Two instances here own
  // the left and right column widths; the middle column is the `1fr` grid
  // track left over between them (kerning.css). Identifiers are
  // "kerning-left"/"kerning-right", NOT the editor's own "left"/"right" --
  // Sidebar's localStorage keys and its width/visibility state are keyed
  // only by identifier, and this view shares the same origin (hence the
  // same localStorage) as the editor view, so reusing "left"/"right" here
  // would read and write the EDITOR's own sidebar width/visibility state.
  // (This also required one small, behavior-preserving fix to sidebar.js
  // itself: its resize-drag handler hardcoded the CSS property name for
  // exactly the "left"/"right" identifiers instead of reading
  // `this.identifier` generically -- see that file's own comment.)
  //
  // What is deliberately NOT reused from Sidebar: its tab-toggle machinery
  // (addPanel, toggle, the tab-overlay-container/sidebar-tab/sidebar-shadow-
  // box DOM it expects) -- this view's columns are always visible, not
  // collapsible tabs, so only attach() (which itself only wires up the
  // resize gutter and restores a stored width) is called; addPanel/toggle
  // are simply never invoked. kerning.css supplies its own always-visible
  // width rule (via the same CSS custom property Sidebar's own drag handler
  // writes to) instead of Sidebar's own `.sidebar-container.visible` rule,
  // which this view's markup never adds the "visible" class to trigger.
  initColumnSplitters() {
    this.leftColumnSplitter = new Sidebar("kerning-left");
    this.leftColumnSplitter.attach(document.querySelector(".kerning-left"));
    this.rightColumnSplitter = new Sidebar("kerning-right");
    this.rightColumnSplitter.attach(document.querySelector(".kerning-right"));
    // Task 2 (part6): the middle column's own row divider (scene on top,
    // class panel below). See this method's own comment for why this is a
    // narrow, view-local handler rather than a third Sidebar instance or a
    // generalized vertical mode on the Sidebar class itself.
    this.initMiddleRowSplitter();
  }

  // Task 2 (part6, layout overhaul design doc §1.2): "make the divider
  // between the middle column's two rows... drag-resizable, reusing the same
  // views-editor Sidebar-style drag mechanism already reused for the three
  // columns... rather than inventing a new one."
  //
  // Read Sidebar (sidebar.js) in full first, per the brief, to decide (a)
  // generalize it to a vertical/row mode reused by both this splitter and
  // its existing horizontal ones, or (b) a narrowly-scoped, view-local
  // handler. Chose (b), for concrete reasons found by reading, not by
  // default caution:
  //
  //   - Sidebar.initResizeGutter/applyWidth/getStoredWidth are not just
  //     "horizontal-only" as a matter of an unparameterized axis (that part
  //     would be a small change: read clientY instead of clientX, write
  //     "height" instead of "width"). They are hardcoded to the EDITOR's
  //     own sidebar semantics in ways a row splitter doesn't share at all:
  //     MIN_SIDEBAR_WIDTH/MAX_SIDEBAR_WIDTH (200-500) are module-level
  //     constants shared by every Sidebar instance, but this row split needs
  //     a 140px minimum on one side and a 200px minimum on the OTHER side
  //     (the design doc's own grid-template-rows minimums,
  //     `minmax(200px, 1fr) minmax(140px, auto)`) -- an asymmetric
  //     constraint Sidebar has no parameter for today, and widening it to
  //     accept per-instance min/max risks every existing editor sidebar call
  //     site silently inheriting a new, unexercised code path.
  //   - Sidebar.attach/toggle/addPanel assume the sidebar-tab/sidebar-shadow-
  //     box/"visible" show-hide machinery (a collapsible panel with tabs) --
  //     none of which the middle row split has or wants; attach() itself
  //     calls initResizeGutter() as a side effect of a method whose whole
  //     other job is show/hide-tab wiring this splitter doesn't need, so
  //     "just call attach()" isn't actually available without either that
  //     unwanted machinery running too or splitting attach() apart (a
  //     bigger, riskier change to a class three other real sidebars, in
  //     views-editor, depend on).
  //   - The gutter/container selectors Sidebar's own methods query
  //     (`.sidebar-container.${identifier} .sidebar-resize-gutter`) assume
  //     the `sidebar-container`/`sidebar-content` class-name contract this
  //     view's own kerning-left/kerning-right columns already carry (see
  //     kerning.html's own comment on why: Sidebar's querySelectors look for
  //     exactly these class names) -- the middle column's two rows are not
  //     sidebar-containers and were never going to be made into one just to
  //     fit this one call.
  //
  // What IS reused, deliberately, rather than reinvented: the exact
  // mechanism, not the class -- one CSS custom property
  // (--kerning-middle-bottom-height, kerning.css) written on pointer-drag,
  // the same document-root cursor-lock class convention Sidebar's own
  // :root.sidebar-resizing uses (this view's own :root.kerning-row-resizing,
  // kerning.css), and localStorage persistence, keyed the same way
  // (`fontra-kerning-middle-bottom-height`, parallel to Sidebar's own
  // `fontra-sidebar-width-${identifier}` key shape).
  initMiddleRowSplitter() {
    const MIN_BOTTOM_HEIGHT = 140; // matches the design doc's own row minimum
    const MIN_TOP_HEIGHT = 200; // ditto, for the scene row
    const gutter = document.querySelector("#kerning-middle-resize-gutter");
    const middleColumn = document.querySelector(".kerning-middle");

    const clampBottomHeight = (height) => {
      const totalHeight = middleColumn.getBoundingClientRect().height;
      const maxBottomHeight = Math.max(MIN_BOTTOM_HEIGHT, totalHeight - MIN_TOP_HEIGHT);
      return Math.min(Math.max(height, MIN_BOTTOM_HEIGHT), maxBottomHeight);
    };

    const applyBottomHeight = (height, saveLocalStorage = false) => {
      if (height === undefined) {
        return;
      }
      if (saveLocalStorage) {
        localStorage.setItem("fontra-kerning-middle-bottom-height", height);
      }
      document.documentElement.style.setProperty(
        "--kerning-middle-bottom-height",
        `${height}px`
      );
    };

    // Restore whatever height was last dragged to, same "read localStorage
    // once, at attach time" convention as Sidebar.initResizeGutter's own
    // `this.getStoredWidth()`/`this.applyWidth(sidebarWidth)` pair.
    const storedHeight = localStorage.getItem("fontra-kerning-middle-bottom-height");
    if (storedHeight) {
      applyBottomHeight(clampBottomHeight(parseInt(storedHeight)));
    }

    let dragging = false;
    let initialHeight;
    let initialPointerCoordinateY;
    let height;

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }
      // The gutter sits at the TOP edge of the bottom row (kerning.css:
      // `bottom: -2px` inside #kerning-middle-top) -- dragging it UP (a
      // smaller clientY) grows the bottom row, dragging it DOWN shrinks it,
      // which is why this is a subtraction of the delta, not an addition
      // (the mirror image of Sidebar's own "growDirection" sign flip, here
      // fixed rather than configurable since there is only one gutter and
      // one direction it can mean).
      height = clampBottomHeight(
        initialHeight - (event.clientY - initialPointerCoordinateY)
      );
      applyBottomHeight(height);
    };
    const onPointerUp = () => {
      applyBottomHeight(height, true);
      middleColumn.classList.add("animating");
      dragging = false;
      initialHeight = undefined;
      initialPointerCoordinateY = undefined;
      document.documentElement.classList.remove("kerning-row-resizing");
      document.removeEventListener("pointermove", onPointerMove);
      // Trigger the canvas's own resize handling explicitly: the
      // ResizeObserver in canvas-controller.js already observes
      // #kerning-view-container's own box (see canvas-controller.js's
      // constructor), so a row-height drag that changes the scene row's
      // actual pixel size is picked up the same way a column-splitter drag
      // already is -- nothing extra needed here for that. This call is only
      // to be certain the canvas repaints promptly at drag-end even if the
      // ResizeObserver's own callback (already async by spec) hasn't fired
      // yet on this exact frame.
      this.canvasController?.requestUpdate();
    };
    gutter.addEventListener("pointerdown", (event) => {
      dragging = true;
      const bottomElement = document.querySelector("#kerning-middle-bottom");
      initialHeight = bottomElement.getBoundingClientRect().height;
      initialPointerCoordinateY = event.clientY;
      middleColumn.classList.remove("animating");
      document.documentElement.classList.add("kerning-row-resizing");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp, { once: true });
    });
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
  // Design doc §2: a third chip value, "font", was added here -- see
  // setChipMode's "font" branch and initFontModeSection (called from start(),
  // since it needs font data not yet available in the constructor). Unlike
  // "pair", the "font" button starts enabled (kerning.html) -- font mode
  // needs no prior selection to be useful.
  initChipSection() {
    this._chipMode = "phrase";
    this._selectedPairText = null;
    // The currently selected pair's two glyph names (spec §6/§10), read by
    // the suggestion visualization layer's draw function
    // (buildAutokernSuggestionVisualizationLayerDefinition below) to look up
    // this.autokernCache -- set once, in selectPairForScene, and never
    // cleared on switching back to "phrase": the layer itself re-gates on
    // this._chipMode === "pair" on every draw, so a stale pair name sitting
    // here while in "phrase" mode is inert, not wrong.
    this._selectedPairLeft = null;
    this._selectedPairRight = null;

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
        if (
          activeTag === "TEXTAREA" ||
          activeTag === "INPUT" ||
          activeTag === "SELECT"
        ) {
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
    // Design doc §2: "font" swaps the scene area for the glyph grid instead
    // of setting sceneSettings.text -- the canvas/metric-handle-container
    // stay in the DOM (untouched, just hidden) so switching away from font
    // mode restores whatever "phrase"/"pair" already had on the canvas
    // without recomputing anything.
    this.showFontModeGrid(mode === "font");
    if (mode === "font") {
      return;
    }
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

  // Design doc §2: toggles the canvas/font-grid visibility. Guarded on the
  // grid container existing yet -- setChipMode can run before
  // initFontModeSection (start()) has built it, since a designer could in
  // principle hit the Tab hotkey immediately; the guard makes that a no-op
  // rather than a crash, same defensive style as renderPairTable's own
  // "no-ops until its own preconditions are met" comment elsewhere in this
  // file.
  showFontModeGrid(show) {
    const gridContainer = document.querySelector("#kerning-font-grid-container");
    const canvas = document.querySelector("#edit-canvas");
    const metricHandleContainer = document.querySelector("#metric-handle-container");
    if (!gridContainer) {
      return;
    }
    gridContainer.classList.toggle("kerning-font-grid-hidden", !show);
    if (canvas) {
      canvas.style.visibility = show ? "hidden" : "";
    }
    if (metricHandleContainer) {
      metricHandleContainer.style.visibility = show ? "hidden" : "";
    }
  }

  // ---------------------------------------------------------------------
  // Design doc §2: font mode.
  //
  // Reuse path chosen (rail R-A): font-overview.js's own grid is built out
  // of two composable, already-broadly-exported pieces --
  // `GlyphCellView` (fontra-webcomponents/glyph-cell-view.js, a plain custom
  // element, self-registering on import) and `GlyphOrganizer`
  // (fontra-core/glyph-organizer.js, a plain class: sort/filter/group). Both
  // packages already export via `"./*"` in their package.json (checked
  // before writing this -- unlike sidebar.js in part 1, no exports map
  // needed widening here). This mounts those same two pieces directly,
  // fed by this view's OWN small ObservableController (glyphSelection/
  // closedGlyphSections/fontLocationSourceMapped -- the three keys
  // GlyphCellView's constructor actually reads, traced in its source),
  // rather than constructing a `FontOverviewController` and hiding
  // everything about it this view doesn't want (menu bar, its own undo
  // stack, copy/paste/build actions, window-location persistence -- all of
  // FontOverviewController, not just its grid). Composing the two pieces
  // font-overview.js itself composes is a narrower, more honest reuse than
  // instantiating and fighting a whole sibling view.
  //
  // No search/group-by controls are built here -- design doc §2 asks only
  // for "a font-overview-style glyph grid that supports multi-select", not
  // its search/filter chrome; GlyphOrganizer's default (no search string,
  // no group-by keys) shows one flat, alphabetically sorted section, which
  // is exactly "a glyph grid" reduced to its multi-select-relevant core. A
  // real search field is a one-line addition (glyphOrganizer.setSearchString)
  // if wanted later -- left as a leftover, not built now (no scope for it
  // named in this task).
  initFontModeSection() {
    this.fontModeSettingsController = new ObservableController({
      glyphSelection: new Set(),
      closedGlyphSections: new Set(),
      fontLocationSourceMapped: {},
    });

    this.fontModeGlyphCellView = new GlyphCellView(
      this.fontController,
      this.fontModeSettingsController
    );
    // Same bubbling convention font-overview.js itself uses
    // (fontoverview.js: `this.glyphCellView.oncontextmenu = (event) =>
    // this.handleContextMenu(event)`) -- a native `contextmenu` event on a
    // glyph cell bubbles up to the view element uncaught (glyph-cell-view.js
    // itself only calls the optional `onCellContextMenu` hook on a cell
    // right-click, never `preventDefault`/`stopPropagation`), so this is not
    // a new menu-wiring convention, it is the one already in this codebase.
    this.fontModeGlyphCellView.oncontextmenu = (event) =>
      this.handleFontModeContextMenu(event);

    // Bug fix, live-verified (CDP-driven click simulation against the running
    // view; window.kerningViewController.fontModeSettingsController.model.
    // glyphSelection read back after each click -- see the workstream's own
    // report for the exact before/after selections observed):
    //
    // glyph-cell-view.js's OWN handleSingleClick (read in full before writing
    // this) gives Shift a Finder/Explorer-style RANGE select
    // (extendSelection -> getGlyphNamesForRange, walking every cell between
    // the last-clicked cell and this one) and gives plain additive toggle
    // ONLY to event.metaKey/event.altKey -- event.ctrlKey is never checked
    // anywhere in that file. On a non-Mac keyboard "Ctrl" IS the platform's
    // multi-select modifier, but metaKey there is the Windows/Super key, so a
    // Ctrl-click there falls through to the plain-click branch and just
    // re-selects the single clicked glyph -- confirmed live: clicking A, then
    // Shift-clicking N (of A,F,G,N,b,d,...) selected the whole {A,F,G,N}
    // range, and clicking A then Ctrl-clicking G left the selection
    // unchanged from whatever it was before (no additive effect at all).
    // Design doc §2 wants Shift to be simple additive toggle here, not range
    // select, and Ctrl/Cmd to also toggle -- font-overview.js itself (the
    // "same selection machinery" this view is told to reuse, per its own
    // brief) is the thing that actually depends on the shared class's range-
    // select convention for Shift today, so that convention is NOT changed
    // in glyph-cell-view.js itself (would silently change font-overview.js's
    // own behavior too). Instead, only THIS view's own GlyphCellView
    // instance gets its handleSingleClick method replaced -- an own-property
    // on this one object shadows the shared prototype method for every
    // caller that already does `this.handleSingleClick(...)` (glyph-cell-
    // view.js's own onclick/ondblclick/oncontextmenu wiring, all of which
    // call it via `this.`, so the override is picked up with no further
    // change needed there) -- font-overview.js's OWN GlyphCellView instance
    // is untouched, prototype and all.
    this.fontModeGlyphCellView.handleSingleClick = (event, glyphCell) => {
      if (event.detail > 1) {
        // Part of a double click -- let glyph-cell-view.js's own ondblclick
        // handler deal with it, same guard the shared method itself uses.
        return;
      }
      const glyphName = glyphCell.glyphName;
      const view = this.fontModeGlyphCellView;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        view.glyphSelection = view.glyphSelection.has(glyphName)
          ? difference(view.glyphSelection, [glyphName])
          : union(view.glyphSelection, [glyphName]);
      } else {
        view.glyphSelection = new Set([glyphName]);
      }
    };

    document
      .querySelector("#kerning-font-grid-container")
      .appendChild(this.fontModeGlyphCellView);

    this.fontModeGlyphOrganizer = new GlyphOrganizer();

    this.updateFontModeGlyphSections = () => {
      const itemList = glyphMapToItemList(this.fontController.glyphMap);
      const sorted = this.fontModeGlyphOrganizer.sortGlyphs(itemList);
      const filtered = this.fontModeGlyphOrganizer.filterGlyphs(sorted);
      const sections = this.fontModeGlyphOrganizer.groupGlyphs(filtered);
      this.fontModeGlyphCellView.setGlyphSections(sections);
    };
    this.updateFontModeGlyphSections();

    this.fontController.addChangeListener({ glyphMap: null }, () => {
      this.updateFontModeGlyphSections();
    });

    this.initFontModeAddToClassActions();

    // Design doc §2's button ("Disabled unless both a grid selection and a
    // class-list selection exist") needs to react to grid-selection changes;
    // the class-panel worker's `this.selectedClass` half of that condition
    // has no change event this file can listen for yet (see the assumption
    // documented on updateFontModeAddToClassButton below), so this button's
    // enabled-state is also recomputed defensively on every render pass
    // (renderPairTable already runs often enough to keep it from going
    // stale for long; see that method's own call to this at its end).
    this.fontModeSettingsController.addKeyListener("glyphSelection", () =>
      this.updateFontModeAddToClassButton()
    );
    this.updateFontModeAddToClassButton();
  }

  // Design doc §2: "A button on the class panel... Disabled unless both a
  // grid selection and a class-list selection exist," plus a matching
  // context-menu entry ("Add to selected class") doing the identical write.
  //
  // ASSUMPTION, stated per the task brief: the class panel (built
  // concurrently by a different worker, in the delimited
  // `// ---- Class panel (design doc §1.2) ----` block elsewhere in this
  // file) is documented to expose the currently selected class as
  // `this.selectedClass`, shaped `{side, name}` (side is "side1" or "side2",
  // matching kerning-controller.js's own editGroupSide1/editGroupSide2
  // naming). At the time this was written, `grep -n selectedClass
  // kerning.js` found no matches -- the class panel had not landed yet --
  // so every read of `this.selectedClass` below is optional-chained and
  // treated as possibly undefined/null, never assumed present. If the
  // landed class panel names this field differently, every reference is
  // isolated to this block and the two methods immediately following it,
  // so retargeting is a small, localized fix, not a rewrite.
  initFontModeAddToClassActions() {
    const slot = document.querySelector("#autokern-class-panel-slot");

    // ---- Font mode add-to-class actions (design doc §2) ----
    // Appended AFTER whatever the class panel worker's own delimited block
    // has already put in the slot (or before it lands, if this runs first --
    // either order is safe, this only ever appends a new child, never
    // touches existing ones) so the two workers' DOM insertions can never
    // collide.
    const actionsContainer = document.createElement("div");
    actionsContainer.id = "kerning-font-mode-actions";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.id = "kerning-font-mode-add-to-class";
    addButton.textContent = "Add selection to selected class";
    addButton.disabled = true;
    addButton.addEventListener("click", () => this.addFontModeSelectionToClass());
    actionsContainer.appendChild(addButton);

    slot?.appendChild(actionsContainer);
    this._fontModeAddToClassButton = addButton;
  }

  updateFontModeAddToClassButton() {
    const button = this._fontModeAddToClassButton;
    if (!button) {
      return;
    }
    const hasGridSelection = !!this.fontModeGlyphCellView?.glyphSelection?.size;
    const hasClassSelection = !!this.selectedClass?.name;
    button.disabled = !(hasGridSelection && hasClassSelection);
  }

  // The one write action both the button and "Add to selected class" (context
  // menu) perform: every currently-selected font-mode glyph joins
  // `this.selectedClass`, through the exact mechanism
  // acceptDeriveProposal/writePairValues already use for group writes
  // (kerningController.editGroupSide1/editGroupSide2 -- see that method's own
  // comment for why this file does not invent a second write path). Kept
  // deliberately simpler than acceptDeriveProposal's own all-or-nothing
  // rollback: that machinery exists there because a DERIVED proposal is a
  // single all-or-nothing decision ("accept this class"); adding an
  // already-existing selection to an already-existing class is not that --
  // a partial success (some glyphs joined, one failed) is still a real,
  // useful, reportable outcome, not something to unwind.
  async addFontModeSelectionToClass(targetClass = this.selectedClass) {
    if (!targetClass?.name) {
      return;
    }
    const glyphNames = [...(this.fontModeGlyphCellView?.glyphSelection || [])];
    if (!glyphNames.length) {
      return;
    }
    // Reconciled per both workstreams' reports: this used to duplicate
    // addGlyphsToClass's own write loop (editGroupSide1/editGroupSide2 +
    // markGlyphStale) inline. Font mode's own failure needs (partial
    // success is reportable, not rolled back -- see this method's own
    // comment above) are met by wrapping each glyph's write in its own
    // try/catch here and delegating the actual write to the class panel's
    // public method, rather than keeping a second copy of the write path.
    const failed = [];
    for (const glyphName of glyphNames) {
      try {
        await this.addGlyphsToClass(targetClass.side, targetClass.name, [glyphName]);
      } catch (error) {
        failed.push({ glyphName, error });
      }
    }

    if (failed.length) {
      await message(
        "Add to class: some glyphs failed",
        failed
          .map(({ glyphName, error }) => `${glyphName}: ${error.message || error}`)
          .join("\n")
      );
    }
  }

  // Design doc §2's second context-menu entry: "Add to…" -- opens a picker
  // dialog to choose a different existing class (by side) or create a new
  // one, using the same 1st/2nd/both control §1.2's own New class action
  // describes. Its actual write now goes through addFontModeSelectionToClass
  // -> addGlyphsToClass (reconciled post-merge, no direct group writes
  // here). What remains a small, cosmetic duplicate of
  // createNewClassViaDialog is the side/name PICKER UI itself (this dialog
  // was written before that class-panel block existed in this file) -- not
  // a correctness issue, just two similar-looking dialogs; left as-is to
  // avoid touching the other worker's delimited block.
  async handleFontModeContextMenu(event) {
    event.preventDefault();
    const glyphNames = [...(this.fontModeGlyphCellView?.glyphSelection || [])];
    if (!glyphNames.length) {
      return;
    }
    showMenu(
      [
        {
          title: "Add to selected class",
          enabled: () => !!this.selectedClass?.name,
          callback: () => this.addFontModeSelectionToClass(),
        },
        {
          title: "Add to…",
          callback: () => this.showFontModeAddToDialog(glyphNames),
        },
      ],
      { x: event.clientX, y: event.clientY }
    );
  }

  // Minimal picker: side (1st/2nd/both -- §1.2's own New class convention)
  // plus a class-name field, offered as a <datalist> of the font's existing
  // class names on the chosen side(s) so picking an EXISTING class is one
  // click, while typing a name not in that list creates a new one on
  // whichever side(s) were picked (mirroring §1.2's "both" convenience: two
  // independent single-side writes, same name, same starting membership --
  // no new data-model concept, see that section's own text).
  async showFontModeAddToDialog(glyphNames) {
    const sideController = new ObservableController({ side: "side1", className: "" });
    const dialog = await dialogSetup("Add to…", null, [
      { title: "Cancel", resultValue: "cancel", isCancelButton: true },
      { title: "Add", resultValue: "add", isDefaultButton: true },
    ]);

    // Part 5 fix 2: "Left"/"Right", not "1st"/"2nd" -- display label only,
    // the underlying option `value` ("side1"/"side2"/"both", read into
    // sideController.model.side and passed straight to
    // addFontModeSelectionToClass below) is unchanged.
    const sideSelect = document.createElement("select");
    for (const [value, label, title] of [
      ["side1", "Left", "Kerning side 1 (left member of a pair)"],
      ["side2", "Right", "Kerning side 2 (right member of a pair)"],
      ["both", "Both", ""],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (title) {
        option.title = title;
      }
      sideSelect.appendChild(option);
    }
    sideSelect.value = sideController.model.side;
    sideSelect.addEventListener("change", () => {
      sideController.model.side = sideSelect.value;
    });

    const classNameInput = document.createElement("input");
    classNameInput.type = "text";
    classNameInput.setAttribute("list", "kerning-font-mode-add-to-classlist");
    classNameInput.placeholder = "class name (existing or new)";
    classNameInput.addEventListener("input", () => {
      sideController.model.className = classNameInput.value.trim();
    });

    const dataList = document.createElement("datalist");
    dataList.id = "kerning-font-mode-add-to-classlist";
    const existingNames = new Set([
      ...Object.keys(this.kerningController?.kernData?.groupsSide1 || {}),
      ...Object.keys(this.kerningController?.kernData?.groupsSide2 || {}),
    ]);
    for (const name of existingNames) {
      const option = document.createElement("option");
      option.value = name;
      dataList.appendChild(option);
    }

    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "0.5em";
    content.appendChild(sideSelect);
    content.appendChild(classNameInput);
    content.appendChild(dataList);
    dialog.setContent(content);

    const result = await dialog.run();
    const className = sideController.model.className;
    if (result !== "add" || !className) {
      return;
    }

    const side = sideController.model.side;
    const sidesToWrite = side === "both" ? ["side1", "side2"] : [side];
    for (const oneSide of sidesToWrite) {
      await this.addFontModeSelectionToClass({ side: oneSide, name: className });
    }
  }
  // ---------------------------------------------------------------------

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
    this.setPreviewPairs([[left, right]]);
    this.setChipMode("pair");
  }

  // Task 7, spec F06/F04: the single arbitration point between "pairs
  // supplied by highlighted table rows" and "pairs supplied by the Glyph/
  // Pair inputs" -- "highlighted rows take precedence while any remain;
  // clearing them restores the input-driven preview, if valid pairs are
  // specified" (F06 recommended detail). Reads DOM state (highlighted rows,
  // the two input fields) and writes DOM state (the error message, the
  // Pair chip's disabled attribute, the scene text via setPreviewPairs) --
  // this is the one non-pure seam that calls the pure input-tokens.js
  // pipeline with real font data.
  updatePairPreview({ switchToPairMode = false } = {}) {
    const elements = this._pairInputElements;
    if (!elements) {
      // initPairTableSection hasn't wired the inputs yet -- nothing to do.
      return;
    }
    const selectedPairs = this.expandHighlightedRowsToPairs();
    let previewPairs = selectedPairs;
    let matchResult = null;
    if (!previewPairs.length) {
      matchResult = pairsFromInputs(
        elements.glyphInput.value,
        elements.pairInput.value,
        this.pairInputResolver()
      );
      if (matchResult.explicit) {
        previewPairs = matchResult.pairs;
      }
    }
    if (elements.pairInputError) {
      // Ledger §8.1: a highlighted class-summary row's cross-product
      // remainder is "disclosed as a count, not silently dropped" --
      // shares the same error/status span an input-parse error uses; the
      // two never fire together (a truncation only happens when highlighted
      // rows already supplied pairs, in which case matchResult is null).
      const truncationCount = this._classSummaryTruncationCount || 0;
      elements.pairInputError.textContent =
        matchResult?.error ||
        (truncationCount
          ? `Preview capped at 50 pairs per highlighted class summary (${truncationCount} summar${truncationCount === 1 ? "y" : "ies"} truncated).`
          : "");
    }
    if (previewPairs.length) {
      this.setPreviewPairs(previewPairs);
      if (switchToPairMode) {
        this.setChipMode("pair");
      }
    } else {
      this._selectedPairText = null;
      this._selectedPairLeft = null;
      this._selectedPairRight = null;
      const pairButton = this._chipButtons?.pair;
      if (pairButton) {
        pairButton.disabled = true;
      }
      // Spec F06/Task 7: "If the active Pair mode loses every pair, restore
      // Phrase mode and its phrase."
      if (this._chipMode === "pair") {
        this.setChipMode("phrase");
      }
    }
  }

  // F04's own open decision, resolved by the ledger (§8.1) and closed by
  // Task 8: a highlighted PAIR row's pair is read straight off the DOM
  // element (dataset.left/dataset.right, the literal addresses used for
  // that row's own ID). A highlighted class-summary row (dataset.kind
  // "class-rule") has no single concrete pair -- it expands to the capped
  // cross-product of both sides' full class membership (ledger §8.1: "a
  // highlighted class-summary row still expands to the full cross-product
  // of both sides' class membership, capped at 50 pairs... with the
  // remainder disclosed as a count, not silently dropped"), reusing
  // input-tokens.js's crossProductPairs (Task 7) rather than a second
  // combinatorial helper. Membership is read from
  // this._classSummaryMembersByRowId (stashed by buildClassSummaryRowElement
  // at render time), not re-derived from the DOM.
  // Returns the flat pair list (updatePairPreview's own `previewPairs`
  // shape); a truncation note is stashed on `this._classSummaryTruncation`
  // rather than written straight to the error span here, because
  // updatePairPreview unconditionally overwrites that span right after
  // calling this method (its own `matchResult?.error || ""` -- writing here
  // too would just be immediately erased).
  expandHighlightedRowsToPairs() {
    const pairs = [];
    let truncatedCount = 0;
    for (const tr of document.querySelectorAll(
      ".kerning-pairtable-table tr[data-row-id]"
    )) {
      if (!this.resultSelection.highlighted.has(tr.dataset.rowId)) {
        continue;
      }
      if (tr.dataset.kind === "class-rule") {
        const members = this._classSummaryMembersByRowId?.get(tr.dataset.rowId);
        if (!members) {
          continue;
        }
        // Ledger §8.1: capped at 50 pairs per highlighted class-summary
        // row (matching truncateGlyphList's own per-row display cap), not
        // a shared budget across the whole highlighted selection.
        const { pairs: expanded, truncated } = crossProductPairs(
          members.leftMembers,
          members.rightMembers,
          50
        );
        pairs.push(...expanded);
        if (truncated) {
          truncatedCount++;
        }
      } else if (tr.dataset.left && tr.dataset.right) {
        pairs.push([tr.dataset.left, tr.dataset.right]);
      }
    }
    this._classSummaryTruncationCount = truncatedCount;
    return pairs;
  }

  // Duck-typed resolver input-tokens.js's pure resolveTokenToGlyphNames/
  // pairsFromInputs consume (kerning-ux-integration.md §8.1: a `@ClassName`
  // token's side is "left" for the Glyph input, "right" for the Pair
  // input -- kernData.groupsSide1/groupsSide2 are exactly that pair of
  // maps, already loaded onto this.kerningController by initPairTableSection).
  pairInputResolver() {
    return {
      characterMap: this.fontController.characterMap,
      glyphMap: this.fontController.glyphMap,
      classMembers: (className, side) => {
        const kernData = this.kerningController?.kernData;
        if (!kernData) {
          return undefined;
        }
        return side === "left"
          ? kernData.groupsSide1?.[className]
          : kernData.groupsSide2?.[className];
      },
    };
  }

  // Task 7's `setPreviewPairs(pairs)` interface (plan text): each pair is
  // `[leftGlyphName, rightGlyphName]`. Spec: "never concatenate them in a
  // way that introduces unintended cross-pair kerning" -- one pair per
  // line (characterLinesFromString/character-lines.js already treats each
  // "\n"-separated line as its own independent run, the same mechanism the
  // phrase field's multi-line text already relies on), not one long run of
  // every glyph back to back. this._selectedPairLeft/Right keep pointing at
  // the FIRST pair only: the on-canvas suggestion overlay
  // (buildAutokernSuggestionVisualizationLayerDefinition /
  // _applySuggestionPreviewRepositioning, both outside this dispatch's file
  // map) reads exactly those two fields and only ever draws its band/HUD
  // for positionedLines[0] -- extending that overlay to every previewed
  // pair is a leftover for whichever task next touches that visualization
  // layer, not silently done here.
  setPreviewPairs(pairs) {
    if (!pairs.length) {
      return;
    }
    this._selectedPairText = pairs.map(([left, right]) => `/${left} /${right}`).join("\n");
    this._selectedPairLeft = pairs[0][0];
    this._selectedPairRight = pairs[0][1];
    const pairButton = this._chipButtons?.pair;
    if (pairButton) {
      pairButton.disabled = false;
    }
    if (this._chipMode === "pair") {
      this.sceneSettingsController.setItem("text", this._selectedPairText);
    }
  }

  // Task 6, spec F07: called by edit-tools-select.js's SelectTool on a
  // Ctrl+Click (`additive` false, replaces the Glyph input) or a
  // Shift+Ctrl+Click (`additive` true, appends -- appendGlyphToken's own
  // comma-separated, duplicate-ignoring behavior). Only ever touches the
  // Glyph input; the Pair input is never written by a pointer click (spec
  // gives pointer shortcuts no defined role there).
  handleGlyphInputModifierClick(glyphName, additive) {
    const glyphInput = this._glyphInputElement;
    if (!glyphInput) {
      return;
    }
    glyphInput.value = additive
      ? appendGlyphToken(glyphInput.value, glyphName)
      : replaceGlyphToken(glyphName);
    this.autokernFiltersController.setItem("glyphName", glyphInput.value.trim());
    this.updatePairPreview();
  }

  // Spec §10 ("No on-canvas display of a suggestion"), closing it: draws the
  // pair-mode-selected pair's measured suggestion (this.autokernCache) as a
  // distance line + numeric label, matching the visual language
  // edit-tools-metrics.js's KerningTool already uses for a STORED kern.
  //
  // What "the visual language" actually is, traced from
  // edit-tools-metrics.js before choosing this: KerningTool itself draws NO
  // canvas line -- its numeric label (KerningHandle, a DOM custom element
  // positioned via canvasController.canvasPoint) is DOM, not canvas, and only
  // exists per-handle while the kerning tool is the active tool and a pair is
  // hovered/selected. The one thing that IS drawn on canvas for a stored kern
  // regardless of hover/selection, whenever the kerning tool is active, is
  // the registered visualization layer "fontra.kerning-indicators-tool"
  // (zIndex 190): a translucent fillRect spanning the kern gap, colored by
  // sign. That fillRect (not a DOM handle, which this view has no
  // infrastructure for and which would need building from scratch) is the
  // part of "how the editor draws a stored kern" that is actually a
  // visualization layer, so it -- not the DOM handle -- is what this layer
  // mirrors: a filled band over the same gap, at zIndex 195 (just above the
  // stored-kern band, so it never disappears underneath it), plus a
  // stroked boundary line (strokeLine, imported from
  // visualization-layer-definitions.js, the same helper
  // fontra.baseline/fontra.sidebearings-tool use for their own lines) at the
  // suggestion's edge, plus a canvas text label reading "suggest: <value>" --
  // the "suggest:" prefix and a dashed, differently-colored boundary line are
  // the distinguishing treatment from the kerning tool's own stored-kern
  // band, chosen because both CAN be visible at once (the kerning-indicators
  // layer is gated on KerningTool being the active tool, not on pair mode --
  // it draws for every glyph in the string, in every tool... no: re-checked,
  // kerningVisualizationSelector(true)'s selectionFunc returns [] unless
  // theKerningTool.isActive is true, i.e. it IS tool-gated, not scene-gated;
  // but it draws for every glyph pair in the whole string whenever the
  // kerning tool happens to be active, including while pair mode is also
  // showing a two-glyph pair -- so the two layers CAN legitimately overlap on
  // exactly the pair this layer draws, and must read as two different facts,
  // not one blurred shape).
  //
  // Gating: BOTH chip modes draw. Pair mode draws one band, over the
  // selected pair's own gap, with the pinned "suggest: N" HUD; phrase mode
  // draws a band per adjacent pair with its number above its own gap.
  // Neither reads this._chipMode to decide WHICH pairs have a suggestion --
  // _applySuggestionPreviewRepositioning does that once per frame and
  // records the answer per positioned glyph in this._previewPairValue, so
  // the shift and the overlay cannot disagree. Pair mode's own "only the
  // selected pair" rule lives there, and its object-identity check against
  // model.positionedLines[0].glyphs is exact rather than name-matching, so a
  // pair like o/o is not ambiguous.
  //
  // No cache entry (spec §10: "before a run, or an excluded/filtered pair --
  // draws nothing, not a placeholder/zero"): a recorded `undefined` is the
  // no-op return, and it is deliberately distinct from a cached value of 0.
  //
  // On zIndex: this layer is appended to a COPY of the shared definitions
  // array, and only registerVisualizationLayerDefinition inserts by zIndex,
  // so the 195 below is documentation rather than an instruction -- the
  // layer actually draws last, over the glyph fill. That is fine now that
  // the re-spacing has moved out of here (the constructor's scene-view
  // callback owns it): the band is translucent, and the label wants to be on
  // top anyway. It was NOT fine while the re-spacing lived here.
  //
  // Live updates: this method builds the layer definition ONCE, in the
  // constructor -- draw itself is a closure that reads its state fresh on
  // every call, so nothing about live update
  // lives here. It lives in what actually repaints the canvas afterward: (1)
  // switching pairs -- selectPairForScene -> setChipMode("pair") ->
  // sceneSettingsController.setItem("text", ...), the same scene-text change
  // that already repaints the left pane's glyphs today; (2) a new run or a
  // reload from storage -- runAutokernWorker's "done" handler and
  // loadAutokernCacheFromStorage both call renderPairTable(), which now also
  // calls this.canvasController.requestUpdate() (see renderPairTable's own
  // comment) specifically because nothing else forced a repaint when only
  // this.autokernCache changed and the chip stayed on "pair"; (3) applying a
  // row -- writePairValues also ends with renderPairTable(), the same call,
  // so an apply's repaint is the identical mechanism as (2), not a third one.
  buildAutokernSuggestionVisualizationLayerDefinition() {
    return {
      identifier: "forkra.kerning.autokern-suggestion",
      name: "Autokern suggestion (kerning view)",
      selectionFunc: glyphSelector("all"),
      // Not userSwitchable: gating is entirely on pair mode + a cache entry
      // existing (spec §10), not a designer-facing visibility toggle -- there
      // is no equivalent toggle for the kerning tool's own stored-kern band
      // either while pair mode is what's deciding visibility.
      userSwitchable: false,
      defaultOn: true,
      zIndex: 195,
      screenParameters: { strokeWidth: 1.5, fontSize: 11 },
      colors: {
        lineColor: "#9B30FFCC",
        fillColor: "#9B30FF26",
        textColor: "#9B30FF",
      },
      colorsDarkMode: {
        lineColor: "#C77DFFCC",
        fillColor: "#C77DFF26",
        textColor: "#C77DFF",
      },
      draw: (context, positionedGlyph, parameters, model, controller) => {
        // The re-spacing itself is NOT done here -- it runs once per frame
        // from the scene-view draw callback (see the constructor), which is
        // what puts it ahead of the glyph fill instead of one frame behind
        // it. This layer only draws, and it draws in BOTH chip modes: the
        // old `if (this._chipMode !== "pair") return;` guard sat above every
        // band/label line, so phrase mode got the silent shift and no
        // visible overlay at all, which is not what was asked for.
        const settings = this.suggestionPreviewSettings.model;
        if (!settings.enabled) {
          return;
        }
        // Set by that same once-per-frame pass, for the pair ENDING at this
        // glyph. undefined means no cache entry (no run yet, an excluded or
        // filtered pair, or -- in pair mode -- any glyph that is not the
        // selected pair's right-hand member), so this is also what keeps
        // pair mode drawing exactly one band, as before.
        const suggestionValue = this._previewPairValue.get(positionedGlyph);
        if (suggestionValue === undefined) {
          return;
        }

        const ascender = model.ascender ?? 0;
        const descender = model.descender ?? 0;

        if (settings.showBand) {
          context.globalAlpha = settings.opacity;
          context.strokeStyle = parameters.lineColor;
          context.lineWidth = parameters.strokeWidth;
          context.fillStyle = parameters.fillColor;
          context.fillRect(0, descender, -suggestionValue, ascender - descender);
          context.setLineDash([4, 3]);
          strokeLine(context, 0, descender, 0, ascender);
          strokeLine(context, -suggestionValue, descender, -suggestionValue, ascender);
          context.setLineDash([]);
          context.globalAlpha = 1;
        }

        if (!settings.showNumbers) {
          return;
        }

        // Phrase mode draws a number per pair, so it cannot use the pinned
        // HUD below -- every pair would stack on the same spot. It stays in
        // glyph space, just above the ascender over its own gap, using the
        // scale(1, -1)-then-negate-y convention every other text-drawing
        // layer in visualization-layer-definitions.js uses. parameters.
        // fontSize is already multiplied by the layer scale factor, so it
        // holds a constant size on screen.
        if (this._chipMode !== "pair") {
          context.globalAlpha = settings.opacity;
          context.fillStyle = parameters.textColor;
          context.textAlign = "center";
          context.font = `${parameters.fontSize}px fontra-ui-regular, sans-serif`;
          context.scale(1, -1);
          context.fillText(
            `${round(suggestionValue, 1)}`,
            -suggestionValue / 2,
            -ascender - 0.5 * parameters.fontSize
          );
          context.globalAlpha = 1;
          return;
        }

        // Designer follow-up (2026-09-06, backlog item 7's HUD variant):
        // pinned to a fixed spot at the top of the viewport instead of
        // tracked to the glyph's screen position, so it needs no
        // edge-clamping -- only the box/reference lines above stay in
        // glyph space and move with the glyph. Reset to the canvas's own
        // CSS-pixel coordinate space (undoing draw()'s glyph-space
        // scale/translate and this layer's own per-glyph translate,
        // src-js/views-editor/src/visualization-layers.js:90) so the text
        // draws at a fixed canvas position every time regardless of scroll,
        // zoom, or which glyph is selected. The outer drawVisualizationLayers
        // call already wraps this whole draw() in its own context.save()/
        // restore() (withSavedState), so this transform never leaks into
        // the next layer or glyph.
        context.setTransform(
          controller.devicePixelRatio,
          0,
          0,
          controller.devicePixelRatio,
          0,
          0
        );
        context.globalAlpha = settings.opacity;
        context.fillStyle = parameters.textColor;
        context.textAlign = "center";
        context.font = `${parameters.fontSize}px fontra-ui-regular, sans-serif`;
        context.fillText(
          `suggest: ${round(suggestionValue, 1)}`,
          controller.canvasWidth / 2,
          20
        );
        context.globalAlpha = 1;
      },
    };
  }

  // Backlog item 10: re-space glyphs on screen by their cached suggestion
  // delta, display-only -- never through fontController.performEdit or the
  // pair-table write path, and never touching this.autokernCache itself
  // (read-only lookup, same cache/gating the "suggest: N" label already
  // uses). Two chip modes:
  //   - "pair": only the selected pair's right-hand glyph shifts, by exactly
  //     the same this.autokernCache entry.value the label already shows for
  //     that pair.
  //   - "phrase": every adjacent glyph pair in every positioned line shifts
  //     simultaneously, each by its own cache entry (0 if no cached
  //     suggestion exists for that specific pair), threaded cumulatively
  //     along the line the same way a real applied kern would accumulate
  //     (shaper.js: "previousGlyph.xAdvance += kernValue" -- a positive
  //     suggestion pushes everything after it right; confirmed against that
  //     exact convention before picking the sign used here, which is the
  //     same sign pair mode already used).
  // "font" mode has no relevant positionedLines (grid, not scene text) --
  // the loop below simply no-ops on an empty/irrelevant array.
  //
  // Idempotent by construction: every call recomputes every glyph's x from
  // its own captured original (this._previewOriginalX), never from the
  // possibly-already-shifted current value, so toggling
  // suggestionPreviewSettings.enabled off (without a scene rebuild) snaps
  // positions back immediately on the next repaint, and repeated repaints of
  // an unchanged frame never compound the shift.
  //
  // Called once per frame from the scene-view draw callback (constructor),
  // BEFORE any visualization layer draws -- see that call site's comment for
  // why calling it from inside the suggestion layer's own draw was one frame
  // too late. It also records each pair's suggestion in
  // this._previewPairValue for that layer to draw from, so the shift and the
  // overlay always describe the same pairs.
  _applySuggestionPreviewRepositioning(model) {
    const settings = this.suggestionPreviewSettings?.model;
    const cache = this.autokernCache;
    for (const line of model.positionedLines || []) {
      const glyphs = line.glyphs || [];
      let cumulative = 0;
      for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i];
        if (!this._previewOriginalX.has(glyph)) {
          this._previewOriginalX.set(glyph, glyph.x);
        }
        const originalX = this._previewOriginalX.get(glyph);

        if (i > 0 && settings?.enabled && cache) {
          // undefined = this pair has no cache entry at all. The shift
          // treats that as zero; the band/label draw treats it as "draw
          // nothing" (spec §10). Keeping the two apart is why this is
          // recorded rather than recomputed in the draw function.
          let entryValue;
          if (this._chipMode === "pair") {
            if (
              line === model.positionedLines[0] &&
              i === 1 &&
              glyphs[0].glyphName === this._selectedPairLeft &&
              glyph.glyphName === this._selectedPairRight
            ) {
              entryValue = cache.get(
                pairKey(this._selectedPairLeft, glyph.glyphName)
              )?.value;
            }
          } else if (this._chipMode === "phrase") {
            entryValue = cache.get(
              pairKey(glyphs[i - 1].glyphName, glyph.glyphName)
            )?.value;
          }
          this._previewPairValue.set(glyph, entryValue);
          cumulative += entryValue ?? 0;
        } else {
          this._previewPairValue.set(glyph, undefined);
        }

        glyph.x = originalX + (settings?.enabled ? cumulative : 0);
      }
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

  // Routes Ctrl-Z/Cmd-Z (and shift for redo) to whichever undo mechanism the
  // active tool actually has, closing the spec §10 backlog item ("No undo
  // stack routed to Ctrl-Z in this view"). This is editor.js's own mechanism,
  // copied exactly rather than reinvented:
  //
  // - The action identifiers "action.undo"/"action.redo" are NOT registered
  //   here from scratch -- their actionInfo (topic, Cmd/Ctrl+Z default
  //   shortcut) is already registered once, at module-load time, by
  //   fontra-menus.js's own top-level registerActionInfo("action.undo", ...)
  //   / ("action.redo", ...) calls (fontra-menus.js:264-273). That module is
  //   already part of this view's bundle (edit-tools-select.js imports
  //   rerouteViewPath from it), so those two actionInfo entries exist before
  //   this method ever runs. Only the CALLBACKS are missing here -- exactly
  //   the gap this method closes -- which is why this calls
  //   registerActionCallbacks, not registerAction (registerAction would
  //   re-register the actionInfo too, which is unnecessary and not what
  //   editor.js does either: editor.js:383-395 also calls
  //   registerActionCallbacks only).
  // - callDelegateMethod below is editor.js's callDelegateMethod
  //   (editor.js:1642-1649) verbatim, adapted to this controller's own
  //   `this.tools`/`this.selectedToolIdentifier` (editor.js reads
  //   `this.sceneController.selectedTool` instead -- this view never set that
  //   property, see setSelectedTool above, so it tracks the active tool on
  //   the controller itself).
  initUndoActions() {
    registerActionCallbacks(
      "action.undo",
      () => this.callDelegateMethod("doUndoRedo", false),
      () => this.callDelegateMethod("canUndoRedo", false),
      () => this.callDelegateMethod("getUndoRedoLabel", false)
    );

    registerActionCallbacks(
      "action.redo",
      () => this.callDelegateMethod("doUndoRedo", true),
      () => this.callDelegateMethod("canUndoRedo", true),
      () => this.callDelegateMethod("getUndoRedoLabel", true)
    );
  }

  // editor.js:1642-1649, verbatim mechanism: the active tool wins if it
  // implements the method itself, otherwise the call falls through to this
  // controller's own same-named method. SidebearingTool/KerningTool
  // (edit-tools-metrics.js's MetricsBaseTool) implement doUndoRedo,
  // canUndoRedo and getUndoRedoLabel themselves, backed by their own
  // `this.undoStack` (a `UndoStack` instance, edit-tools-metrics.js:58) --
  // this is what makes a sidebearing/kerning-tool drag on this view's own
  // canvas actually undoable via Ctrl-Z for the first time. pointer-tool and
  // hand-tool implement none of the three, so they fall through to this
  // controller's own versions below.
  //
  // Ordering (three stacks total, not two): a tool that implements these
  // methods (sidebearing/kerning tool) always wins outright -- `tool?.[
  // methodName]` only checks the method EXISTS, not whether that tool's own
  // stack has anything to undo, so while one of those two tools is active,
  // this.autokernUndoStack is never consulted even if it holds a more
  // recent pair-table/derive-accept edit than the tool's own stack. This is
  // a real, documented limitation, not a bug introduced here: fixing it
  // would mean changing callDelegateMethod's dispatch (or MetricsBaseTool's
  // own canUndoRedo) to compare timestamps/emptiness across independently-
  // owned stacks, which is a deeper change to shared tool code
  // (edit-tools-metrics.js) than this task's file scope allows. While
  // pointer-tool or hand-tool is active (the common case for pair-table
  // work, since applying a row doesn't require a metrics tool to be
  // selected), this controller's own doUndoRedo/canUndoRedo/getUndoRedoLabel
  // below run, and THERE the ordering is correct: this.autokernUndoStack
  // (pair-table/derive-accept edits) is checked first, falling through to
  // the shared SceneController's fontController-backed per-glyph undo
  // (editor.js's own fallback, editor.js:1651-1665) only if
  // this.autokernUndoStack has nothing at the requested end. That ordering
  // choice -- autokern edits ahead of per-glyph edits, at this tier -- rests
  // on both being reachable only when no metrics tool is selected, so
  // neither can be "more recently touched" by a currently-active tool;
  // autokern edits are checked first simply because they are this tier's
  // more common case (the pair table and derive panel are this view's main
  // controls when pointer/hand is selected). Net effect: Ctrl-Z reverses
  // the true most-recent edit correctly UNLESS a sidebearing/kerning-tool
  // drag is currently the active tool AND an autokern edit happened more
  // recently than that tool's own last edit -- in that one case, Ctrl-Z
  // undoes the tool's (older) edit first. Switching to pointer/hand tool
  // before undoing avoids it.
  callDelegateMethod(methodName, ...args) {
    const tool = this.tools[this.selectedToolIdentifier];
    if (tool?.[methodName]) {
      return tool[methodName](...args);
    } else {
      return this[methodName](...args);
    }
  }

  getUndoRedoLabel(isRedo) {
    const autokernInfo = this.autokernUndoStack.getTopUndoRedoRecord(isRedo)?.info;
    const info = autokernInfo || this.sceneController.getUndoRedoInfo(isRedo);
    return (
      (isRedo ? translate("action.redo") : translate("action.undo")) +
      (info ? " " + info.label : "")
    );
  }

  canUndoRedo(isRedo) {
    return (
      !!this.autokernUndoStack.getTopUndoRedoRecord(isRedo) ||
      !!this.sceneController.getUndoRedoInfo(isRedo)
    );
  }

  async doUndoRedo(isRedo) {
    if (this.autokernUndoStack.getTopUndoRedoRecord(isRedo)) {
      await this.doAutokernUndoRedo(isRedo);
      return;
    }
    await this.sceneController.doUndoRedo(isRedo);
  }

  // Pops this.autokernUndoStack and replays it. Two record shapes, see
  // writePairValues's and acceptDeriveProposal's own comments for why each
  // exists:
  //
  // - "pairValues": a real {change, rollbackChange} pair, replayed exactly
  //   the way BaseInfoPanel.doUndoRedo (views-fontinfo/src/panel-base.js)
  //   replays its own records -- reverseUndoRecord on redo, then
  //   fontController.applyChange(rollbackChange) followed by a
  //   rollback-direction fontController.editFinal.
  // - "groupMembership": no change/rollbackChange exists to replay (see
  //   acceptDeriveProposal's comment for why) -- instead this re-invokes
  //   editGroupSide1/editGroupSide2 per member glyph, with each glyph's
  //   `before` group name on undo or `after` group name on redo.
  async doAutokernUndoRedo(isRedo) {
    let undoRecord = this.autokernUndoStack.popUndoRedoRecord(isRedo);
    if (!undoRecord) {
      return;
    }

    if (undoRecord.info.kind === "groupMembership") {
      const editFn =
        undoRecord.info.editSide === "side1"
          ? (glyphName, groupName) =>
              this.kerningController.editGroupSide1(glyphName, groupName)
          : (glyphName, groupName) =>
              this.kerningController.editGroupSide2(glyphName, groupName);
      for (const entry of undoRecord.info.entries) {
        await editFn(entry.glyphName, isRedo ? entry.after : entry.before);
      }
      this.renderDeriveProposals();
      // Part 5 addition: a "groupMembership" record can now also be a class
      // deletion (confirmAndDeleteClass/deleteClass, class panel section) --
      // undoing/redoing one changes which classes exist, so the class list
      // (and, if the deleted class was selected, the now-stale swatch strip)
      // must refresh here too, not just the pair table.
      this.renderClassList();
      this.renderClassSwatchStrip();
      this.renderPairTable();
      return;
    }

    // kind === "pairValues"
    if (isRedo) {
      undoRecord = reverseUndoRecord(undoRecord);
    }
    this.fontController.applyChange(undoRecord.rollbackChange);

    const error = await this.fontController.editFinal(
      undoRecord.rollbackChange,
      undoRecord.change,
      undoRecord.info.label,
      true
    );
    // TODO handle error
    this.fontController.notifyEditListeners("editFinal", this);

    this.renderPairTable();
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
