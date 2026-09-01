import { registerAction } from "@fontra/core/actions.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import {
  ShowLocationSettings,
  setShowEffectiveLocationDefaults,
  setupLocationDependencies,
} from "@fontra/core/axis-ui.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  ChangeCollector,
  applyChange,
  consolidateChanges,
  hasChange,
} from "@fontra/core/changes.js";
import {
  characterLinesFromString,
  stringFromCharacterLines,
} from "@fontra/core/character-lines.js";
import {
  decomposeComponents,
  roundComponentOrigins,
} from "@fontra/core/glyph-controller.js";
import {
  GlyphSetsController,
  getMyGlyphSets,
  readProjectGlyphSets,
} from "@fontra/core/glyphsets-controller.js";
import {
  balancePathInPlace,
  expandToJoints,
  harmonizePathInPlace,
} from "@fontra/core/harmonization.js";
import * as html from "@fontra/core/html-utils.js";
import { translate, translatePlural } from "@fontra/core/localization.js";
import { MouseTracker } from "@fontra/core/mouse-tracker.js";
import { ObservableController } from "@fontra/core/observable-object.ts";
import {
  addOverlapToPath,
  connectContours,
  scalePoint,
  splitPathAtPointIndices,
} from "@fontra/core/path-functions.js";
import {
  equalRect,
  offsetRect,
  rectAddMargin,
  rectFromArray,
  rectRound,
  rectToArray,
} from "@fontra/core/rectangle.ts";
import {
  difference,
  isSuperset,
  lenientIsEqualSet,
  union,
} from "@fontra/core/set-ops.js";
import { ShaperController } from "@fontra/core/shaper-controller.js";
import {
  SKELETON_CONVERSION_REFUSALS,
  appendSkeletonContourFromPathContour,
  skeletonConversionRefusal,
} from "@fontra/core/skeleton-from-contour.js";
import {
  SKELETON_SOURCE_DEFAULT_KEYS,
  clearSkeletonData,
  getDefaultSkeletonWidthKeyForGlyphName,
  getSkeletonContour,
  getSkeletonData,
  getSkeletonGlyphCase,
  resolveEffectiveSourceSkeletonDefault,
  setSkeletonData,
} from "@fontra/core/skeleton-model.js";
import { SNAP_PARAMETERS, setSnapParameter } from "@fontra/core/snapping.js";
import {
  arrowKeyDeltas,
  assert,
  commandKeyProperty,
  consolidateCalls,
  enumerate,
  getCharFromCodePoint,
  glyphMapToItemList,
  isObjectEmpty,
  objectsEqual,
  parseSelection,
  reversed,
  withTimeout,
  zip,
} from "@fontra/core/utils.ts";
import { GlyphSource, Layer } from "@fontra/core/var-glyph.js";
import { isLocationAtDefault } from "@fontra/core/var-model.js";
import { VarPackedPath, packContour } from "@fontra/core/var-path.js";
import * as vector from "@fontra/core/vector.js";
import { dialog, dialogSetup, message } from "@fontra/web-components/modal-dialog.js";
import {
  componentCountOf,
  recordComponentDelete,
  recordComponentInsert,
} from "./composition-editing.js";
import { EditBehaviorFactory } from "./edit-behavior.js";
import { SceneModel } from "./scene-model.js";
import {
  applyGeneratedContourRemap,
  applySkeletonEditInPlace,
  computeGeneratedContourRemap,
  createEditableGeneratedHandleTargetEntries,
  createEditableGeneratedPointTargetEntries,
  createSkeletonRibTargetEntries,
  getSelectionTargetKinds,
  getSkeletonModifierBehaviorName,
  getSkeletonRibBehaviorName,
  isFixedRibBehaviorName,
  makeSkeletonModifierOptions,
  makeSkeletonPointTargetEntry,
  parseSkeletonPointKey,
  recordSkeletonContourIndexShift,
} from "./skeleton-editing.js";
import {
  closePanelSkeletonContours,
  balancePanelSkeletonPoints,
  harmonizePanelSkeletonPoints,
  joinPanelSkeletonContours,
  splitPanelSkeletonContours,
  togglePanelContourReversed,
} from "./skeleton-panel-edits.js";
import { skeletonContourEndpointIndices } from "./skeleton-panel-model.js";
import { forceRefreshSnapping } from "./snapping-interactions.js";
import {
  createTensionAwareTargetEntries,
  getTensionAwareBehaviorName,
} from "./tension-aware-editing.js";
//// grid

// Minimum pixels per em and maximum pixels per unit for zooming out and in.
//
// Note that these are not _screen pixels_, they are css "pixels" which are
// scaled by screen DPI and browser zoom level. So on a high dpi display or
// in a browser with a higher zoom level set, the minimum and maximum scale
// in _screen pixels_ will be higher (for both).
//
// Zooming out is capped by pixels per em to allow a consistent size when
// zoomed all the way out at different em scales, and zooming in is capped
// by pixels per unit to allow a consistent 1 unit size when zoomed all the
// way in regardless of em scale.
//
// These values are chosen arbitrarily and in the future there may
// be some merit to letting users configure this to their own taste.
const MIN_PIX_PER_EM = 5;
const MAX_PIX_PER_UNIT = 200;

export const numQuadraticOffCurvePointsOptions = [1, 2, 3, 4, 5];

export class SceneController {
  constructor(
    fontController,
    canvasController,
    applicationSettingsController,
    visualizationLayersSettings
  ) {
    this.canvasController = canvasController;
    this.applicationSettings = applicationSettingsController.model;
    this.fontController = fontController;
    this.autoViewBox = true;

    this.setupSceneSettings();
    //// grid
    this.sceneSettingsController.setItem("coarseGridSpacing", 10);
    this.sceneSettingsController.setItem("snappingEnabled", true);
    this.sceneSettingsController.setItem("speedPunkPeakHeightUpm", 24);
    this.sceneSettingsController.setItem("speedPunkReferenceTurnDegrees", 90);
    this.sceneSettingsController.setItem("speedPunkColorFlatTurnDegrees", 30);
    this.sceneSettingsController.setItem("speedPunkColorTightTurnDegrees", 120);
    this.sceneSettingsController.setItem("speedPunkSharpness", 1);
    this.sceneSettingsController.setItem("speedPunkOpacity", 0.5);
    this.sceneSettings = this.sceneSettingsController.model;
    this.visualizationLayersSettings = visualizationLayersSettings;

    // We need to do isPointInPath without having a context, we'll pass a bound method
    const isPointInPath = canvasController.context.isPointInPath.bind(
      canvasController.context
    );

    this.sceneModel = new SceneModel(
      fontController,
      this.sceneSettingsController,
      isPointInPath,
      visualizationLayersSettings
    );

    this.selectedTool = undefined;
    this._currentGlyphChangeListeners = [];
    this.contextMenuState = {};

    this.shaperController = new ShaperController(
      fontController,
      applicationSettingsController
    );

    this.setupGlyphSetsController();
    this.setupChangeListeners();
    this.setupSettingsListeners();
    this.setupEventHandling();
    this.setupContextMenuActions();
  }

  setupSceneSettings() {
    this.sceneSettingsController = new ObservableController({
      ...getSceneSettingsDefaults(),
      // fork: extra scene settings for coarse-grid snapping + Point labels
      gridSnapEnabled: true, // Default to enabled
      showLabelsDistance: true,
      showLabelsTension: true,
      showLabelsAngle: false,
    });
    this.sceneSettings = this.sceneSettingsController.model;

    this.sceneSettings.viewBox = this.canvasController.getViewBox();
    this.sceneSettings.myGlyphSets = getMyGlyphSets();

    this.fontController.ensureInitialized.then(() => {
      setShowEffectiveLocationDefaults(this.fontController, this.sceneSettings);

      this.sceneSettingsController.setItem(
        "projectGlyphSets",
        readProjectGlyphSets(this.fontController),
        { sentFromInitializer: true }
      );
      this.updateShaperInfo();
      this.setCanvasMagnificationLimits();
    });

    // Set up the mutual relationship between text and characterLines
    this.sceneSettingsController.addKeyListener(
      ["text", "combinedCharacterMap"],
      async (event) => {
        if (event.senderInfo?.senderID === this) {
          return;
        }
        await this.fontController.ensureInitialized;
        const characterLines = characterLinesFromString(
          this.sceneSettings.text,
          this.fontController.characterMap,
          this.fontController.glyphMap,
          this.sceneSettings.combinedCharacterMap,
          this.sceneSettings.combinedGlyphMap,
          this.sceneSettings.substituteGlyphName
        );
        this.sceneSettingsController.setItem("characterLines", characterLines, {
          senderID: this,
        });
      }
    );

    this.sceneSettingsController.addKeyListener(
      "characterLines",
      (event) => {
        if (event.senderInfo?.senderID === this) {
          return;
        }
        const text = stringFromCharacterLines(event.newValue);
        this.sceneSettingsController.setItem("text", text, { senderID: this });
      },
      true
    );

    // auto view box
    this.sceneSettingsController.addKeyListener("selectedGlyph", (event) => {
      if (event.newValue?.isEditing) {
        this.autoViewBox = false;
      }
      this.canvasController.requestUpdate();
    });

    this.sceneSettingsController.addKeyListener(
      "positionedLines",
      (event) => {
        this.setAutoViewBox();
        this.canvasController.requestUpdate();
      },
      true
    );

    setupLocationDependencies(this.fontController, this.sceneSettingsController);

    // Set up convenience property "selectedGlyphName"
    this.sceneSettingsController.addKeyListener(
      ["selectedGlyph", "positionedLines"],
      (event) => {
        this.sceneSettings.selectedGlyphName = this.getSelectedGlyphName();
        if (this.sceneSettings.selectedGlyphName) {
          this.sceneSettings.substituteGlyphName = this.sceneSettings.selectedGlyphName;
        }
      },
      true
    );

    // Set up convenience property "combinedSelection", which is the union of
    // selection and hoverSelection
    this.sceneSettingsController.addKeyListener(
      ["selection", "hoverSelection"],
      (event) => {
        if (event.key === "selection") {
          this._checkSelectionForLockedItems();
        }
        this.sceneSettings.combinedSelection = union(
          this.sceneSettings.selection,
          this.sceneSettings.hoverSelection
        );
        this.canvasController.requestUpdate();
      },
      true
    );

    // Set up the viewBox relationships
    this.sceneSettingsController.addKeyListener(
      "viewBox",
      (event) => {
        if (event.senderInfo?.senderID === this) {
          return;
        }
        if (!event.newValue) {
          // Ignore null-ish
          return;
        }
        this.canvasController.setViewBox(event.newValue);
        const actualViewBox = this.canvasController.getViewBox();
        if (!equalRect(rectRound(event.newValue), rectRound(actualViewBox))) {
          this.sceneSettingsController.setItem("viewBox", actualViewBox, {
            senderID: this,
            adjustViewBox: true,
          });
        }
      },
      true
    );

    this.canvasController.canvas.addEventListener("viewBoxChanged", (event) => {
      if (event.detail === "canvas-size") {
        this.setAutoViewBox();
      } else if (event.detail !== "set-view-box") {
        this.autoViewBox = false;
      }
      this.sceneSettingsController.setItem(
        "viewBox",
        this.canvasController.getViewBox(),
        { senderID: this }
      );
    });

    // Update background layer glyphs
    this.sceneSettingsController.addKeyListener(
      ["backgroundLayers", "editingLayers"],
      (event) => {
        this.sceneModel.updateBackgroundGlyphs();
        this.canvasController.requestUpdate();
      }
    );

    // Switch shapers on toggling applyTextShaping
    this.sceneSettingsController.addKeyListener("applyTextShaping", (event) =>
      this.updateShaper()
    );

    // Set up combinedGlyphMap and combinedCharacterMap dependencies
    const updateCombinedGlyphAndCharacterMapping = consolidateCalls((event) =>
      this.updateCombinedGlyphAndCharacterMapping(event)
    );

    this.sceneSettingsController.addKeyListener(
      ["projectGlyphSetSelection", "myGlyphSetSelection"],
      updateCombinedGlyphAndCharacterMapping
    );

    this.fontController.addChangeListener({ glyphMap: null }, (change) =>
      updateCombinedGlyphAndCharacterMapping(null, change)
    );

    this.fontController.addChangeListener({ unitsPerEm: null }, (change) =>
      this.setCanvasMagnificationLimits()
    );
  }

  setCanvasMagnificationLimits() {
    // The lower magnification limit is implemented relative to UPM
    // to provide a consistent em size when zoomed all the way out.
    this.canvasController.minMagnification =
      MIN_PIX_PER_EM / this.fontController.unitsPerEm;

    // The upper magnification limit is implemented relative to individual
    // units, so that when zoomed all the way in the size of an individual
    // unit is the same regardless of em size.
    this.canvasController.maxMagnification = MAX_PIX_PER_UNIT;
  }

  async updateCombinedGlyphAndCharacterMapping(event, change) {
    if (
      event &&
      (event.key === "projectGlyphSetSelection" ||
        event.key === "myGlyphSetSelection") &&
      event.newValue.length === 0 &&
      event.oldValue?.length === 0
    ) {
      return;
    }

    const fontGlyphItemList = glyphMapToItemList(this.fontController.glyphMap);
    const { combinedGlyphMap, combinedCharacterMap } =
      await this.glyphSetsController.getCombinedGlyphMap(fontGlyphItemList);

    this.sceneSettings.combinedGlyphMap = combinedGlyphMap;
    this.sceneSettings.combinedCharacterMap = combinedCharacterMap;
  }

  async updateSceneSettingsFromViewInfo(viewInfo) {
    const defaultSettings = getSceneSettingsDefaults();
    const sceneSettings = this.sceneSettings;

    for (let { key, infoKey, waitKeyBefore, waitKeyAfter } of persistentSceneSettings) {
      if (!infoKey) {
        infoKey = key;
      }
      assert(key in defaultSettings, key);

      const defaultValue = defaultSettings[key];
      const viewValue =
        key !== "viewBox"
          ? viewInfo[infoKey]
          : convertViewBoxArrayToRect(viewInfo[infoKey]);

      if (viewValue === undefined) {
        continue;
      }

      if (waitKeyBefore) {
        await this.sceneSettingsController.waitForKeyChange(waitKeyBefore, false, 20);
      }

      if (
        defaultValue === null ||
        typeof defaultValue == "number" ||
        typeof defaultValue == "string" ||
        typeof defaultValue == "boolean"
      ) {
        sceneSettings[key] = viewValue;
      } else if (defaultValue instanceof Set) {
        assert(defaultValue.size === 0, defaultValue);
        sceneSettings[key] = new Set(viewValue);
      } else if (defaultValue instanceof Array) {
        assert(defaultValue.length === 0, defaultValue);
        sceneSettings[key] = Array.from(viewValue);
      } else if (typeof defaultValue == "object") {
        assert(isObjectEmpty(defaultValue), defaultValue);
        sceneSettings[key] = viewValue;
      } else {
        assert(false, `can't get here ${[key, defaultValue, viewValue]}`);
      }

      if (waitKeyAfter) {
        await this.sceneSettingsController.waitForKeyChange(waitKeyAfter, false, 20);
      }
    }
  }

  getViewInfoFromSceneSettings() {
    const viewInfo = {};

    const defaultSettings = getSceneSettingsDefaults();
    const sceneSettings = this.sceneSettings;

    for (let { key, infoKey } of persistentSceneSettings) {
      if (!infoKey) {
        infoKey = key;
      }

      const defaultValue = defaultSettings[key];
      const settingsValue =
        key !== "viewBox"
          ? sceneSettings[key]
          : convertViewBoxRectToArray(sceneSettings[key]);

      if (
        defaultValue === null ||
        typeof defaultValue == "number" ||
        typeof defaultValue == "string" ||
        typeof defaultValue == "boolean"
      ) {
        if (settingsValue !== defaultValue) {
          viewInfo[infoKey] = settingsValue;
        }
      } else if (defaultValue instanceof Set) {
        if (settingsValue?.size) {
          viewInfo[infoKey] = Array.from(settingsValue);
        }
      } else if (defaultValue instanceof Array) {
        if (settingsValue?.length) {
          viewInfo[infoKey] = Array.from(settingsValue);
        }
      } else if (typeof defaultValue == "object") {
        if (settingsValue && !isObjectEmpty(settingsValue)) {
          viewInfo[infoKey] = { ...settingsValue };
        }
      } else {
        assert(false, `can't get here ${[key, defaultValue, settingsValue]}`);
      }
    }

    return viewInfo;
  }

  updateShaperInfo() {
    this.sceneSettingsController.model.shaperInfo =
      this.shaperController.getShaper(true);
    this.sceneSettingsController.model.dumbShaperInfo =
      this.shaperController.getShaper(false);
    this.updateShaper();
  }

  async updateShaper() {
    const applyTextShaping = this.sceneSettings.applyTextShaping;

    const { shaper } = await (this.sceneSettings.applyTextShaping
      ? this.sceneSettings.shaperInfo
      : this.sceneSettings.dumbShaperInfo);

    if (applyTextShaping == this.sceneSettings.applyTextShaping) {
      // If the setting was changed since we were called we should *not*
      // set the shaper. This method can get galled again before an
      // earlier call completes. The later call should "win".
      this.sceneSettings.shaper = shaper;
    }
  }

  async setLocationFromSourceIndex(sourceIndex) {
    if (sourceIndex == undefined) {
      return;
    }
    const varGlyphController =
      await this.sceneModel.getSelectedVariableGlyphController();

    const location =
      varGlyphController.getDenseSourceLocationForSourceIndex(sourceIndex);
    const { fontLocation, glyphLocation } = varGlyphController.splitLocation(location);

    this.sceneSettingsController.model.fontLocationSourceMapped = fontLocation;
    this.sceneSettingsController.model.glyphLocation =
      varGlyphController.foldNLIAxes(glyphLocation);
  }

  _checkSelectionForLockedItems() {
    if (
      this.sceneSettings.backgroundImagesAreLocked ||
      !this.visualizationLayersSettings.model["fontra.background-image"]
    ) {
      this._deselectBackgroundImage();
    }
  }

  _deselectBackgroundImage() {
    if (this.sceneSettings.selection.has("backgroundImage/0")) {
      this.sceneSettings.selection = difference(this.sceneSettings.selection, [
        "backgroundImage/0",
      ]);
    }
  }

  setupGlyphSetsController() {
    this.glyphSetsController = new GlyphSetsController(
      this.fontController,
      this.sceneSettingsController
    );
  }

  setupChangeListeners() {
    this.fontController.addChangeListener({ glyphMap: null }, () => {
      this.updateShaperInfo();

      const selectedGlyph = this.sceneSettings.selectedGlyph;
      if (
        selectedGlyph?.isEditing &&
        !this.fontController.hasGlyph(this.sceneSettings.selectedGlyphName)
      ) {
        // The glyph being edited got deleted, change state to selected
        this.sceneSettings.selectedGlyph = {
          ...selectedGlyph,
          isEditing: false,
        };
      }
    });

    this.fontController.addChangeListener(
      { axes: null, kerning: null },
      async () => {
        await this.sceneModel.updateScene();
        this.canvasController.requestUpdate();
      },
      true
    );

    this.fontController.addChangeListener({ features: null, glyphInfos: null }, () => {
      this.updateShaperInfo();
    });

    this.shaperController.addInvalidateShaperListener(() => {
      this.updateShaperInfo();
    });
  }

  setupSettingsListeners() {
    //// grid
    this.sceneSettingsController.addKeyListener("coarseGridSpacing", () => {
      this._updateCoarseGridRuntimeSpacing();
      this.canvasController.requestUpdate();
    });

    this.visualizationLayersSettings.addKeyListener("fontra.coarse.grid", () => {
      this._updateCoarseGridRuntimeSpacing();
      this.canvasController.requestUpdate();
    });
    this._updateCoarseGridRuntimeSpacing();

    this.sceneSettingsController.addKeyListener("selectedGlyph", (event) => {
      this._resetStoredGlyphPosition();
    });

    this.sceneSettingsController.addKeyListener(
      "selectedGlyph",
      (event) => {
        if (event.newValue) {
          this.sceneSettings.glyphRenderInfoLineIndex = event.newValue.lineIndex;
        }
      },
      true // immediate
    );

    this.sceneSettingsController.addKeyListener(
      "align",
      (event) => {
        this.scrollAdjustBehavior = "text-align";
      },
      true
    );

    this.sceneSettingsController.addKeyListener(
      "featureSettings",
      (event) => {
        this.scrollAdjustBehavior = "pin-glyph-center";
      },
      true
    );

    this.sceneSettingsController.addKeyListener("selectedGlyphName", (event) => {
      this._updateCurrentGlyphChangeListeners();
    });

    this.sceneSettingsController.addKeyListener("substituteGlyphName", (event) => {
      this._updateSubstituteGlyph();
    });

    this.sceneSettingsController.addKeyListener(
      "positionedLines",
      (event) => {
        this._adjustScrollPosition();
      },
      true
    );

    this.sceneSettingsController.addKeyListener(
      "backgroundImagesAreLocked",
      (event) => {
        if (event.newValue) {
          this._deselectBackgroundImage();
        }
      },
      true
    );

    this.visualizationLayersSettings.addKeyListener(
      "fontra.background-image",
      (event) => {
        if (!event.newValue) {
          this._deselectBackgroundImage();
        }
      }
    );
  }

  _updateCoarseGridRuntimeSpacing() {
    window.coarseGridSpacing = this.visualizationLayersSettings.model[
      "fontra.coarse.grid"
    ]
      ? this.sceneSettings.coarseGridSpacing || 1
      : 1;
  }

  setupEventHandling() {
    this.mouseTracker = new MouseTracker({
      drag: async (eventStream, initialEvent) =>
        await this.handleDrag(eventStream, initialEvent),
      hover: (event) => this.handleHover(event),
      element: this.canvasController.canvas,
    });
    this._eventElement = document.createElement("div");

    this.fontController.addEditListener(
      async (...args) => await this.editListenerCallback(...args)
    );
    this.canvasController.canvas.addEventListener("keydown", (event) =>
      this.handleKeyDown(event)
    );
  }

  setupContextMenuActions() {
    const topic = "0030-action-topics.menu.edit";

    //// grid
    registerAction(
      "action.decrease-coarse-grid",
      { titleKey: "action.decrease-coarse-grid", defaultShortCuts: [{ baseKey: "f" }] },
      () => {
        const v = this.sceneSettings.coarseGridSpacing;
        if (v > 5) this.sceneSettingsController.setItem("coarseGridSpacing", v - 5);
      }
    );

    registerAction(
      "action.toggle-snapping",
      {
        titleKey: "action.toggle-snapping",
        defaultShortCuts: [{ baseKey: "g", shiftKey: true }],
      },
      () => {
        this.sceneSettingsController.setItem(
          "snappingEnabled",
          !this.sceneSettings.snappingEnabled
        );
        // Switching snapping off must take the guides off the canvas with it,
        // and switching it back on must not resume against a scene read before
        // the drawing changed. Both are the same forced refresh, so the toggle
        // is also the way out of a snap the designer cannot account for.
        forceRefreshSnapping(this);
        this.canvasController.requestUpdate();
      }
    );

    registerAction(
      "action.toggle-snap-diagonals",
      {
        titleKey: "action.toggle-snap-diagonals",
        defaultShortCuts: [{ baseKey: "r", shiftKey: true }],
      },
      () => {
        setSnapParameter("diagonalsEnabled", SNAP_PARAMETERS.diagonalsEnabled ? 0 : 1);
        this.canvasController.requestUpdate();
      }
    );

    registerAction(
      "action.increase-coarse-grid",
      { titleKey: "action.increase-coarse-grid", defaultShortCuts: [{ baseKey: "g" }] },
      () => {
        const v = this.sceneSettings.coarseGridSpacing;
        if (v < 40) this.sceneSettingsController.setItem("coarseGridSpacing", v + 5);
      }
    );

    registerAction(
      "action.join-contours",
      {
        topic,
        sortIndex: 100,
        defaultShortCuts: [{ baseKey: "j", commandKey: true }],
      },
      () => {
        // One gesture, four answers. The skeleton comes first because a
        // centerline selection is never also a path selection: a generated
        // outline cannot be selected as an ordinary point.
        if (this.contextMenuState.skeletonJoinSelection?.length === 2) {
          this.doJoinSelectedSkeletonContours();
        } else if (this.contextMenuState.skeletonCloseSelection?.length) {
          this.doCloseSelectedSkeletonContours();
        } else if (this.contextMenuState.joinContourSelection?.length === 2) {
          this.doJoinSelectedOpenContours();
        } else {
          this.doCloseSelectedOpenContours();
        }
      },
      () =>
        this.contextMenuState.joinContourSelection?.length ||
        this.contextMenuState.openContourSelection?.length ||
        this.contextMenuState.skeletonJoinSelection?.length ||
        this.contextMenuState.skeletonCloseSelection?.length
    );

    registerAction(
      "action.break-contour",
      { topic },
      () => this.doBreakSelectedContours(),
      () =>
        this.contextMenuState.pointSelection?.length ||
        this.contextMenuState.skeletonPointSelection?.length
    );

    registerAction(
      "action.reverse-contour",
      { topic },
      () => this.doReverseSelectedContours(),
      () =>
        this.contextMenuState.pointSelection?.length ||
        this.contextMenuState.skeletonContourIds?.length
    );

    registerAction(
      "action.set-contour-start",
      { topic },
      () => this.doSetStartPoint(),
      () => this.contextMenuState.pointSelection?.length
    );

    registerAction(
      "action.realize-skeleton-contours",
      { topic },
      () => this.doRealizeSkeletonContours(),
      () => this.contextMenuState.skeletonPointSelection?.length
    );

    registerAction(
      "action.convert-contour-to-skeleton",
      { topic },
      () => this.doConvertContoursToSkeleton(),
      () => this.contextMenuState.convertibleContours?.length
    );

    registerAction(
      "action.decompose-component",
      {
        topic,
        defaultShortCuts: [{ baseKey: "d", commandKey: true, shiftKey: true }],
      },
      () => this.doDecomposeSelectedComponents(),
      () => !!this.contextMenuState?.componentSelection?.length
    );

    registerAction("action.lock-background-images", { topic }, () => {
      this.sceneSettings.backgroundImagesAreLocked =
        !this.sceneSettings.backgroundImagesAreLocked;
      if (!this.sceneSettings.backgroundImagesAreLocked) {
        // If background images are hidden, show them
        this.visualizationLayersSettings.model["fontra.background-image"] = true;
      }
    });

    registerAction(
      "action.add-overlap",
      {
        topic,
        defaultShortCuts: [{ baseKey: "o", commandKey: true, shiftKey: true }],
      },
      () => this.doAddOverlap(),
      () => this.contextMenuState.pointSelection?.length
    );

    registerAction("action.harmonize", { topic }, () => this.doHarmonize());
    registerAction("action.balance", { topic }, () => this.doBalance());
  }

  setAutoViewBox() {
    if (!this.autoViewBox) {
      return;
    }
    let bounds = this.getSceneBounds();
    if (!bounds) {
      return;
    }
    bounds = rectAddMargin(bounds, 0.1);
    this.sceneSettings.viewBox = bounds;
  }

  glyphInfoFromGlyphName(glyphName) {
    const glyphInfo = { glyphName: glyphName };
    const codePoint = this.sceneSettings.combinedGlyphMap[glyphName]?.[0];
    if (codePoint !== undefined) {
      glyphInfo["character"] = getCharFromCodePoint(codePoint);
    }
    return glyphInfo;
  }

  _resetStoredGlyphPosition() {
    this._previousGlyphPosition = positionedGlyphPosition(
      this.sceneModel.getSelectedPositionedGlyph()
    );
  }

  _adjustScrollPosition() {
    let originXDelta = 0;
    let originYDelta = 0;

    const glyphPosition = positionedGlyphPosition(
      this.sceneModel.getSelectedPositionedGlyph()
    );

    const [minX, maxX] = this.sceneModel.getTextHorizontalExtents();

    if (this.scrollAdjustBehavior === "text-align" && this._previousTextExtents) {
      const [minXPre, maxXPre] = this._previousTextExtents;
      originXDelta = minX - minXPre;
    } else if (
      this.scrollAdjustBehavior === "pin-glyph-center" &&
      this._previousGlyphPosition &&
      glyphPosition
    ) {
      const previousGlyphCenter =
        this._previousGlyphPosition.x + this._previousGlyphPosition.xAdvance / 2;
      const glyphCenter = glyphPosition.x + glyphPosition.xAdvance / 2;
      originXDelta = glyphCenter - previousGlyphCenter;
      originYDelta = glyphPosition.y - this._previousGlyphPosition.y;
    } else if (
      typeof this.scrollAdjustBehavior == "string" &&
      this.scrollAdjustBehavior.startsWith("pin-glyph-origin") &&
      this._previousGlyphPosition &&
      glyphPosition
    ) {
      originXDelta = glyphPosition.x - this._previousGlyphPosition.x;
      originYDelta = glyphPosition.y - this._previousGlyphPosition.y;
    } else if (this.scrollAdjustBehavior?.behavior === "tool-pin-point") {
      originXDelta = this.scrollAdjustBehavior.getPinPointDelta();
    }

    if (originXDelta || originYDelta) {
      this.sceneSettings.viewBox = offsetRect(
        this.sceneSettings.viewBox,
        originXDelta,
        originYDelta
      );
    }

    this.scrollAdjustBehavior =
      this.scrollAdjustBehavior === "pin-glyph-origin" ? "pin-glyph-origin" : null;
    this._previousTextExtents = [minX, maxX];
    this._previousGlyphPosition = glyphPosition;
  }

  async editListenerCallback(editMethodName, senderID, ...args) {
    // console.log(editMethodName, senderID, ...args);
    switch (editMethodName) {
      case "editBegin":
        {
          const glyphController = this.sceneModel.getSelectedPositionedGlyph()?.glyph;
          this.sceneModel.ghostPath = glyphController?.flattenedPath2d;
        }
        break;
      case "editEnd":
        delete this.sceneModel.ghostPath;
        break;
      case "editIncremental":
      case "editFinal":
        await this.sceneModel.updateScene();
        this.canvasController.requestUpdate();
        break;
    }
  }

  _updateCurrentGlyphChangeListeners() {
    const glyphName = this.sceneSettings.selectedGlyphName;
    if (glyphName === this._currentSelectedGlyphName) {
      return;
    }
    for (const listener of this._currentGlyphChangeListeners) {
      this.fontController.removeGlyphChangeListener(
        this._currentSelectedGlyphName,
        listener
      );
      this.fontController.addGlyphChangeListener(glyphName, listener);
    }
    this._currentSelectedGlyphName = glyphName;
  }

  _updateSubstituteGlyph() {
    if (
      !this.sceneSettings.characterLines.some((line) =>
        line.some((glyphInfo) => glyphInfo.isPlaceholder)
      )
    ) {
      // No /? placeholder in the input, nothing to do
      return;
    }

    const characterLines = characterLinesFromString(
      this.sceneSettings.text,
      this.fontController.characterMap,
      this.fontController.glyphMap,
      this.sceneSettings.combinedCharacterMap,
      this.sceneSettings.combinedGlyphMap,
      this.sceneSettings.substituteGlyphName
    );
    this.sceneSettingsController.setItem("characterLines", characterLines, {
      senderID: this,
    });
  }

  addCurrentGlyphChangeListener(listener) {
    this._currentGlyphChangeListeners.push(listener);
    if (this._currentSelectedGlyphName) {
      this.fontController.addGlyphChangeListener(
        this._currentSelectedGlyphName,
        listener
      );
    }
  }

  removeCurrentGlyphChangeListener(listener) {
    if (this._currentSelectedGlyphName) {
      this.fontController.removeGlyphChangeListener(
        this._currentSelectedGlyphName,
        listener
      );
    }
    this._currentGlyphChangeListeners = this._currentGlyphChangeListeners.filter(
      (item) => item !== listener
    );
  }

  setSelectedTool(tool) {
    this.selectedTool?.deactivate();
    this.selectedTool = tool;
    this.selectedTool?.activate();
    this.hoverSelection = new Set();
    this.updateHoverState();
    this.canvasController.requestUpdate();
  }

  updateHoverState() {
    // Do this too soon and we'll risk stale hover info
    setTimeout(() => this.selectedTool.handleHover({}), 0);
  }

  handleKeyDown(event) {
    if ((!event[commandKeyProperty] || event.shiftKey) && event.key in arrowKeyDeltas) {
      event.preventDefault();
      if (this.selectedTool?.handleArrowKeys) {
        this.selectedTool.handleArrowKeys(event);
      } else {
        this.handleArrowKeys(event);
      }
      return;
    } else {
      this.selectedTool?.handleKeyDown(event);
    }
  }

  async handleArrowKeys(event) {
    if (!this.sceneSettings.selectedGlyph?.isEditing || !this.selection.size) {
      return;
    }
    let [dx, dy] = arrowKeyDeltas[event.key];
    if (event.shiftKey && (event.metaKey || event.ctrlKey)) {
      dx *= 100;
      dy *= 100;
    } else if (event.shiftKey) {
      dx *= 10;
      dy *= 10;
    }
    const delta = { x: dx, y: dy };
    const parsedSelection = parseSelection(this.selection);
    const hasGeneratedHandleSelection =
      !!parsedSelection.editableGeneratedHandle?.length;
    const hasRibSelection = !!parsedSelection.skeletonRib?.length;
    const hasGeneratedPointSelection = !!parsedSelection.editableGeneratedPoint?.length;
    const hasRibLikeSelection = hasRibSelection || hasGeneratedPointSelection;
    const isFixedRibBehavior = isFixedRibBehaviorName;
    const modifiers = {
      fixedRibMode: this.selectedTool?.fixedRibMode === true,
      fixedRibCompressMode: this.selectedTool?.fixedRibCompressMode === true,
      tangentRibMode: this.selectedTool?.tangentRibMode === true,
      tensionAwareMode: this.selectedTool?.tensionAwareMode === true,
      independentRibMode: this.selectedTool?.independentRibMode === true,
    };
    const targetKinds = getSelectionTargetKinds(this.selection);
    // An arrow key is a drag of one grid step, so X means here what it means
    // under the pointer. It needs no axis lock: an arrow key names its axis.
    const tensionAwareName = getTensionAwareBehaviorName(modifiers, targetKinds);
    const behaviorName =
      tensionAwareName ||
      getSkeletonModifierBehaviorName(event, modifiers, targetKinds) ||
      (hasRibLikeSelection
        ? getSkeletonRibBehaviorName(event, modifiers)
        : event.altKey
          ? "alternate"
          : "default");
    await this.editGlyph((sendIncrementalChange, glyph) => {
      const editingLayers = this.getEditingLayerFromGlyphLayers(glyph.layers);
      const editLayerName = this.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        editingLayers[editLayerName] || Object.values(editingLayers)[0]
      );
      const layerInfo = Object.entries(editingLayers).map(([layerName, layerGlyph]) => {
        const modifierOptions = makeSkeletonModifierOptions(behaviorName, {
          referenceSkeletonData,
        });
        const targetEntries = tensionAwareName
          ? createTensionAwareTargetEntries(
              layerGlyph,
              this.selection,
              tensionAwareName,
              {
                isGeneratedContour: (contourIndex) =>
                  this.sceneModel.isGeneratedPathContour(contourIndex),
                scalingEditBehavior: this.selectedTool.scalingEditBehavior,
              }
            )
          : hasGeneratedHandleSelection
            ? createEditableGeneratedHandleTargetEntries(
                layerGlyph,
                this.selection,
                behaviorName,
                modifierOptions
              )
            : // A rib under this modifier pair is an entry point into the
              // skeleton drag, not the width edit it otherwise means.
              hasRibLikeSelection && !isFixedRibBehavior(behaviorName)
              ? [
                  ...createSkeletonRibTargetEntries(
                    layerGlyph,
                    this.selection,
                    behaviorName,
                    modifierOptions
                  ),
                  ...createEditableGeneratedPointTargetEntries(
                    layerGlyph,
                    this.selection,
                    behaviorName,
                    modifierOptions
                  ),
                ]
              : [
                  makeSkeletonPointTargetEntry(
                    layerGlyph,
                    this.selection,
                    behaviorName,
                    referenceSkeletonData,
                    modifierOptions
                  ),
                ].filter((entry) => entry);
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          this.selection,
          this.selectedTool.scalingEditBehavior,
          { targetEntries }
        );
        return {
          layerName,
          layerGlyph,
          changePath: ["layers", layerName, "glyph"],
          pathPrefix: [],
          editBehavior: behaviorFactory.getBehavior(behaviorName),
        };
      });

      const editChanges = [];
      const rollbackChanges = [];
      for (const { layerGlyph, changePath, editBehavior } of layerInfo) {
        const editChange = editBehavior.makeChangeForDelta(delta);
        applyChange(layerGlyph, editChange);
        editChanges.push(consolidateChanges(editChange, changePath));
        rollbackChanges.push(
          consolidateChanges(editBehavior.rollbackChange, changePath)
        );
      }

      let changes = ChangeCollector.fromChanges(
        consolidateChanges(editChanges),
        consolidateChanges(rollbackChanges)
      );

      let newSelection;
      for (const { layerGlyph, changePath } of layerInfo) {
        const connectDetector = this.getPathConnectDetector(layerGlyph.path);
        if (connectDetector.shouldConnect()) {
          const connectChanges = recordChanges(layerGlyph, (layerGlyph) => {
            const thisSelection = connectContours(
              layerGlyph.path,
              connectDetector.connectSourcePointIndex,
              connectDetector.connectTargetPointIndex
            );
            if (newSelection === undefined) {
              newSelection = thisSelection;
            }
          });
          if (connectChanges.hasChange) {
            changes = changes.concat(connectChanges.prefixed(changePath));
          }
        }
      }
      if (newSelection) {
        this.selection = newSelection;
      }

      return {
        changes: changes,
        undoLabel: translate("action.nudge-selection"),
        broadcast: true,
      };
    });

    this.scrollAdjustBehavior = "pin-glyph-origin-once";
  }

  addEventListener(eventName, handler, options) {
    this._eventElement.addEventListener(eventName, handler, options);
  }

  _dispatchEvent(eventName, detail) {
    const event = new CustomEvent(eventName, {
      bubbles: false,
      detail: detail || this,
    });
    this._eventElement.dispatchEvent(event);
  }

  updateContextMenuState(event = null) {
    this.contextMenuState = {};
    if (!this.sceneSettings.selectedGlyph?.isEditing) {
      return;
    }
    let relevantSelection;
    if (!event) {
      relevantSelection = this.selection;
    } else {
      const { selection: clickedSelection } = this.sceneModel.selectionAtPoint(
        this.localPoint(event),
        this.mouseClickMargin
      );
      if (!clickedSelection.size) {
        // Clicked on nothing, ignore selection
        relevantSelection = clickedSelection;
      } else {
        if (!isSuperset(this.selection, clickedSelection)) {
          // Clicked on something that wasn't yet selected; select it
          this.selection = clickedSelection;
        } else {
          // Use the existing selection as context
        }
        relevantSelection = this.selection;
      }
    }
    const {
      point: pointSelection,
      component: componentSelection,
      skeletonPoint: skeletonPointSelection,
      skeletonRib: skeletonRibSelection,
    } = parseSelection(relevantSelection);
    this.contextMenuState.pointSelection = pointSelection;
    this.contextMenuState.componentSelection = componentSelection;
    this.contextMenuState.skeletonPointSelection = skeletonPointSelection;
    // Which skeleton contours the click is about. A rib belongs to its contour
    // as much as a centerline point does, so both answer a contour command. The
    // contour id is the first field of either key; the point key parser is no
    // use here because it refuses a rib's third field.
    this.contextMenuState.skeletonContourIds = [
      ...new Set(
        [...(skeletonPointSelection || []), ...(skeletonRibSelection || [])]
          .map((item) => Number(`${item}`.split("/")[0]))
          .filter((contourId) => Number.isInteger(contourId))
      ),
    ];

    // Which drawn contours can become centerlines. A generated contour is the
    // stroke a centerline already made, so it is never offered: converting one
    // would build a stroke around an outline the app is about to rebuild.
    this.contextMenuState.convertibleContours = [
      ...new Set(
        (pointSelection || []).map(
          (pointIndex) =>
            this.sceneModel
              .getSelectedPositionedGlyph()
              ?.glyph?.instance?.path?.getContourAndPointIndex(pointIndex)?.[0]
        )
      ),
    ].filter(
      (contourIndex) =>
        Number.isInteger(contourIndex) &&
        !this.sceneModel.isGeneratedPathContour(contourIndex)
    );

    // The skeleton's own answer to the same two questions the path answers
    // below. A join wants two open ends on two contours; a close wants ends of
    // one. Both are read off the selected centerline points alone: a rib says
    // which contour, not which end.
    const skeletonEnds = getSelectedSkeletonOpenEnds(
      this.sceneModel._getEditLayerSkeletonData(
        this.sceneModel.getSelectedPositionedGlyph()
      ),
      skeletonPointSelection
    );
    this.contextMenuState.skeletonJoinSelection =
      skeletonEnds.length === 2 &&
      skeletonEnds[0].contourId !== skeletonEnds[1].contourId
        ? skeletonEnds
        : [];
    this.contextMenuState.skeletonCloseSelection =
      skeletonEnds.length &&
      skeletonEnds.every((end) => end.contourId === skeletonEnds[0].contourId)
        ? [skeletonEnds[0]]
        : [];

    const glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
    this.contextMenuState.openContourSelection = glyphController.canEdit
      ? getSelectedClosableContours(glyphController.instance.path, pointSelection)
      : [];
    this.contextMenuState.joinContourSelection = glyphController.canEdit
      ? getSelectedJoinContoursPointIndices(
          glyphController.instance.path,
          pointSelection
        )
      : [];
  }

  getContextMenuItems(event) {
    const contextMenuItems = [
      {
        title: () =>
          this.contextMenuState.joinContourSelection?.length === 2 ||
          this.contextMenuState.skeletonJoinSelection?.length === 2
            ? translate("action.join-contours")
            : translatePlural(
                "action.close-contour",
                this.contextMenuState.openContourSelection?.length ||
                  this.contextMenuState.skeletonCloseSelection?.length
              ),
        actionIdentifier: "action.join-contours",
      },
      { actionIdentifier: "action.break-contour" },
      { actionIdentifier: "action.reverse-contour" },
      { actionIdentifier: "action.set-contour-start" },
      { actionIdentifier: "action.harmonize" },
      { actionIdentifier: "action.balance" },
      { actionIdentifier: "action.realize-skeleton-contours" },
      {
        title: () =>
          translatePlural(
            "action.convert-contour-to-skeleton",
            this.contextMenuState.convertibleContours?.length
          ),
        actionIdentifier: "action.convert-contour-to-skeleton",
      },
      {
        title: translate("action.glyph.convert-curves"),
        getItems: () => [
          { actionIdentifier: "action.glyph.convert-curves-to-cubic" },
          ...numQuadraticOffCurvePointsOptions.map((i) => ({
            actionIdentifier: `action.glyph.convert-curves-to-quadratic-${i}`,
          })),
        ],
      },
      {
        title: () =>
          translatePlural(
            "action.decompose-component",
            this.contextMenuState.componentSelection?.length
          ),
        actionIdentifier: "action.decompose-component",
      },
      { actionIdentifier: "action.glyph.add-background-image" },
      {
        title: () =>
          translate(
            this.sceneSettings.backgroundImagesAreLocked
              ? "action.unlock-background-images"
              : "action.lock-background-images"
          ),
        actionIdentifier: "action.lock-background-images",
      },
    ];
    return contextMenuItems;
  }

  // 4.2 "Realize contours" (donor: realize skeleton projection): detach the
  // selected skeleton contours, keeping their generated outlines in the path
  // as plain editable contours. Pure skeleton-data edit — the path and the
  // realized contours' geometry are untouched, so this must NOT go through
  // editSkeleton (regeneration would drop the now-orphaned outlines).
  async doRealizeSkeletonContours() {
    const skeletonPointSelection = this.contextMenuState.skeletonPointSelection || [];
    if (!skeletonPointSelection.length) {
      return;
    }
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      const editLayerName = this.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        layerGlyphs[editLayerName] || Object.values(layerGlyphs)[0]
      );
      if (!referenceSkeletonData) {
        return;
      }
      // Selection ids are canonical in the edit layer; other layers resolve
      // the affected contours by structural ordinal (WS-9)
      const contourIds = new Set(
        skeletonPointSelection.map((item) => parseSkeletonPointKey(`${item}`).contourId)
      );
      const ordinals = [];
      referenceSkeletonData.contours.forEach((contour, index) => {
        if (contourIds.has(contour.id)) {
          ordinals.push(index);
        }
      });
      if (!ordinals.length) {
        return;
      }
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const original = getSkeletonData(layerGlyph);
        if (!original) {
          continue;
        }
        const skeletonData = structuredClone(original);
        const removeIds = new Set(
          ordinals
            .map((ordinal) => skeletonData.contours[ordinal]?.id)
            .filter((id) => id !== undefined)
        );
        if (!removeIds.size) {
          continue;
        }
        skeletonData.generated = (skeletonData.generated || []).filter(
          (entry) => !removeIds.has(entry.skeletonContourId)
        );
        skeletonData.contours = skeletonData.contours.filter(
          (contour) => !removeIds.has(contour.id)
        );
        if (!skeletonData.contours.length && !skeletonData.generated.length) {
          clearSkeletonData(layerGlyph);
        } else {
          setSkeletonData(layerGlyph, skeletonData);
        }
      }
      this.selection = new Set(
        [...this.selection].filter((key) => !key.startsWith("skeletonPoint/"))
      );
      return translate("action.realize-skeleton-contours");
    });
  }

  // The width choices the conversion dialog offers: the master's three base
  // widths for the edited glyph's case, plus whatever named widths that master
  // stores for the same case. This is the list the skeleton parameters panel
  // already offers on a point, read the same way, so one glyph cannot be told
  // two different sets of widths.
  _skeletonWidthProfileOptions() {
    const glyphName = this.getSelectedGlyphName();
    const location =
      this.sceneSettings?.fontLocationSourceMapped ||
      this.sceneSettings?.fontLocationSource ||
      {};
    const read = (key) =>
      resolveEffectiveSourceSkeletonDefault(this.fontController, location, key);
    const isLower = getSkeletonGlyphCase(glyphName) === "lowercase";
    const K = SKELETON_SOURCE_DEFAULT_KEYS;
    const options = [
      {
        label: translate("sidebar.skeleton-parameters.default-base"),
        value: read(isLower ? K.WIDTH_LOWERCASE_BASE : K.WIDTH_CAPITAL_BASE),
      },
      {
        label: translate("sidebar.skeleton-parameters.default-horizontal"),
        value: read(
          isLower ? K.WIDTH_LOWERCASE_HORIZONTAL : K.WIDTH_CAPITAL_HORIZONTAL
        ),
      },
      {
        label: translate("sidebar.skeleton-parameters.default-contrast"),
        value: read(isLower ? K.WIDTH_LOWERCASE_CONTRAST : K.WIDTH_CAPITAL_CONTRAST),
      },
    ];
    const custom = read(
      isLower ? K.CUSTOM_WIDTHS_LOWERCASE : K.CUSTOM_WIDTHS_UPPERCASE
    );
    if (Array.isArray(custom)) {
      custom.forEach((item, index) => {
        options.push({
          label: item?.name || `${index + 1}`,
          value: Number(item?.value),
        });
      });
    }
    return options.filter((option) => Number.isFinite(Number(option.value)));
  }

  // Asks for a stroke width and a side mode. Returns null when the designer
  // cancels. The width box is the value that is used; picking a named width
  // fills that box, so a typed number is never overruled by a select.
  async _runConvertToSkeletonDialog(defaultWidth) {
    const profiles = this._skeletonWidthProfileOptions();

    const widthInput = html.input({
      type: "number",
      min: 0,
      step: 1,
      value: defaultWidth,
      style: "width: 6em;",
    });

    const profileSelect = html.select(
      {
        onchange: (event) => {
          const chosen = profiles[Number(event.target.value)];
          if (chosen) {
            widthInput.value = Number(chosen.value);
          }
        },
      },
      [
        html.option({ value: "" }, [
          translate("action.convert-contour-to-skeleton.width-profile.custom"),
        ]),
        ...profiles.map((profile, index) =>
          html.option({ value: `${index}` }, [`${profile.label} (${profile.value})`])
        ),
      ]
    );

    const modeSelect = html.select({}, [
      html.option({ value: "" }, [
        translate("action.convert-contour-to-skeleton.mode.double"),
      ]),
      html.option({ value: "left" }, [
        translate("action.convert-contour-to-skeleton.mode.left"),
      ]),
      html.option({ value: "right" }, [
        translate("action.convert-contour-to-skeleton.mode.right"),
      ]),
    ]);

    const content = html.div({ style: "display: grid; gap: 0.6em;" }, [
      html.div({}, [
        translate("action.convert-contour-to-skeleton.width-profile"),
        " ",
        profileSelect,
      ]),
      html.div({}, [
        translate("action.convert-contour-to-skeleton.width"),
        " ",
        widthInput,
      ]),
      html.div({}, [
        translate("action.convert-contour-to-skeleton.mode"),
        " ",
        modeSelect,
      ]),
    ]);

    const dialogBox = await dialogSetup(
      translate("action.convert-contour-to-skeleton.title"),
      null,
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        {
          title: translate("dialog.okay"),
          isDefaultButton: true,
          resultValue: true,
        },
      ]
    );
    dialogBox.setContent(content);

    if (!(await dialogBox.run())) {
      return null;
    }
    const width = Number(widthInput.value);
    if (!Number.isFinite(width) || width < 0) {
      return null;
    }
    return { width, singleSided: modeSelect.value || null };
  }

  // Convert drawn contours into centerlines. The inverse of "Realize contours":
  // there a skeleton is dropped and its outline kept, here an outline becomes a
  // centerline and a new stroke is built around it.
  //
  // Every point keeps its position, its type and its smooth flag. Nothing is
  // fitted and no shape is guessed at.
  //
  // The drawn contour is consumed. Deleting it moves every generated contour
  // after it down one, which the skeleton has to be told in the same change, or
  // its record of which path contours it built points at the wrong ones.
  async doConvertContoursToSkeleton() {
    const contourIndices = [...(this.contextMenuState.convertibleContours || [])].sort(
      (a, b) => b - a
    );
    if (!contourIndices.length) {
      return;
    }

    const path = this.sceneModel.getSelectedPositionedGlyph()?.glyph?.instance?.path;
    if (!path) {
      return;
    }
    for (const contourIndex of contourIndices) {
      const refusal = skeletonConversionRefusal(path.getUnpackedContour(contourIndex));
      if (refusal) {
        await message(
          translate("action.convert-contour-to-skeleton.title"),
          translate(
            refusal === SKELETON_CONVERSION_REFUSALS.QUADRATIC
              ? "action.convert-contour-to-skeleton.refused.quadratic"
              : "action.convert-contour-to-skeleton.refused.empty"
          )
        );
        return;
      }
    }

    const glyphName = this.getSelectedGlyphName();
    const location =
      this.sceneSettings?.fontLocationSourceMapped ||
      this.sceneSettings?.fontLocationSource ||
      {};
    const masterWidth = Number(
      resolveEffectiveSourceSkeletonDefault(
        this.fontController,
        location,
        getDefaultSkeletonWidthKeyForGlyphName(glyphName)
      )
    );
    const answer = await this._runConvertToSkeletonDialog(
      Number.isFinite(masterWidth) && masterWidth > 0 ? masterWidth : 60
    );
    if (!answer) {
      return;
    }

    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        // Read every contour before deleting any of them, highest index first,
        // so the indices stay valid while the reads happen.
        const contours = contourIndices.map((contourIndex) =>
          layerGlyph.path.getUnpackedContour(contourIndex)
        );
        for (const contourIndex of contourIndices) {
          layerGlyph.path.deleteContour(contourIndex);
          recordSkeletonContourIndexShift(layerGlyph, contourIndex, -1);
        }
        applySkeletonEditInPlace(
          layerGlyph,
          (working) => {
            // Lowest index first, so the centerlines come out in the order the
            // contours stood in.
            for (const contour of [...contours].reverse()) {
              appendSkeletonContourFromPathContour(working, contour, answer);
            }
          },
          // The path was restructured, so the generated contours cannot be
          // updated in their old slots.
          { createIfMissing: true, replaceContours: true }
        );
      }
      this.selection = new Set();
      return translatePlural(
        "action.convert-contour-to-skeleton",
        contourIndices.length
      );
    });
  }

  getSelectedGlyphName() {
    return this.sceneModel.getSelectedGlyphName();
  }

  async handleDrag(eventStream, initialEvent) {
    if (this.selectedTool) {
      await this.selectedTool.handleDrag(eventStream, initialEvent);
    }
  }

  handleHover(event) {
    if (this.selectedTool) {
      this.selectedTool.handleHover(event);
    }
  }

  localPoint(event) {
    if (event && event.x !== undefined) {
      this._currentLocalPoint = this.canvasController.localPoint(event);
    }
    return this._currentLocalPoint || { x: Infinity, y: Infinity };
  }

  selectedGlyphPoint(event) {
    // Return the event location in the selected-glyph coordinate system
    const canvasPoint = this.localPoint(event);
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (positionedGlyph === undefined) {
      return undefined;
    }
    return {
      x: canvasPoint.x - positionedGlyph.x,
      y: canvasPoint.y - positionedGlyph.y,
    };
  }

  get onePixelUnit() {
    return this.canvasController.onePixelUnit;
  }

  get mouseClickMargin() {
    return this.onePixelUnit * 12;
  }

  get selection() {
    return this.sceneModel.selection;
  }

  set selection(selection) {
    if (!lenientIsEqualSet(selection, this.selection)) {
      this.sceneModel.selection = selection || new Set();
      this.sceneModel.hoverSelection = new Set();
    }
  }

  get hoverSelection() {
    return this.sceneModel.hoverSelection;
  }

  set hoverSelection(selection) {
    if (!lenientIsEqualSet(selection, this.hoverSelection)) {
      this.sceneModel.hoverSelection = selection;
      this.canvasController.requestUpdate();
    }
  }

  get hoveredGlyph() {
    return this.sceneModel.hoveredGlyph;
  }

  set hoveredGlyph(hoveredGlyph) {
    if (!equalGlyphSelection(this.sceneModel.hoveredGlyph, hoveredGlyph)) {
      this.sceneModel.hoveredGlyph = hoveredGlyph;
      this.canvasController.requestUpdate();
    }
  }

  get selectionRect() {
    return this.sceneModel.selectionRect;
  }

  set selectionRect(selRect) {
    this.sceneModel.selectionRect = selRect;
    this.canvasController.requestUpdate();
  }

  get editingLayerNames() {
    const primaryLayerName =
      this.sceneModel.getSelectedPositionedGlyph()?.glyph?.layerName;
    const layerNames = Object.keys(this.sceneSettings.editingLayers);
    if (primaryLayerName) {
      // Ensure the primary editing layer name is first in the list
      const i = layerNames.indexOf(primaryLayerName);
      if (i > 0) {
        layerNames.splice(i, 1);
        layerNames.unshift(primaryLayerName);
      }
    }
    return layerNames;
  }

  getGlyphLocations(filterShownGlyphs = false) {
    return this.sceneModel.getGlyphLocations(filterShownGlyphs);
  }

  updateGlyphLocations(glyphLocations) {
    this.sceneModel.updateGlyphLocations(glyphLocations);
  }

  getSceneBounds() {
    return this.sceneModel.getSceneBounds();
  }

  cancelEditing(reason) {
    if (this._glyphEditingDonePromise) {
      this._cancelGlyphEditing = reason;
    }
    return this._glyphEditingDonePromise;
  }

  async editGlyphAndRecordChanges(
    editFunc,
    senderID,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    return await this._editGlyphOrInstanceAndRecordChanges(
      null,
      editFunc,
      senderID,
      false,
      requireSelectedLayer,
      ignoreGlyphLock
    );
  }

  async editNamedGlyphAndRecordChanges(
    glyphName,
    editFunc,
    senderID,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    return await this._editGlyphOrInstanceAndRecordChanges(
      glyphName,
      editFunc,
      senderID,
      false,
      requireSelectedLayer,
      ignoreGlyphLock
    );
  }

  async editLayersAndRecordChanges(editFunc, senderID) {
    return await this._editGlyphOrInstanceAndRecordChanges(
      null,
      (glyph) => {
        const layerGlyphs = this.getEditingLayerFromGlyphLayers(glyph.layers);
        return editFunc(layerGlyphs);
      },
      senderID,
      false,
      true
    );
  }

  getEditingLayerFromGlyphLayers(layers) {
    const layerArray = this.editingLayerNames
      .map((layerName) => [layerName, layers[layerName]?.glyph])
      .filter((layer) => layer[1]);
    if (!layerArray.length) {
      // While this shouldn't really happen, it is mostly harmless:
      // if the layers list is empty but we are in fact at an editable position,
      // populate the list with the editing instance.
      const glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
      if (glyphController?.canEdit) {
        layerArray.push([glyphController.layerName, glyphController.instance]);
      }
    }
    return Object.fromEntries(layerArray);
  }

  async _editGlyphOrInstanceAndRecordChanges(
    glyphName,
    editFunc,
    senderID,
    doInstance,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    await this._editGlyphOrInstance(
      glyphName,
      (sendIncrementalChange, subject) => {
        let undoLabel;
        const changes = recordChanges(subject, (subject) => {
          undoLabel = editFunc(subject);
        });
        return {
          changes: changes,
          undoLabel: undoLabel,
          broadcast: true,
        };
      },
      senderID,
      doInstance,
      requireSelectedLayer,
      ignoreGlyphLock
    );
  }

  async editGlyph(editFunc, senderID) {
    return await this._editGlyphOrInstance(null, editFunc, senderID, false, true);
  }

  async _editGlyphOrInstance(
    glyphName,
    editFunc,
    senderID,
    doInstance,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    if (this._glyphEditingDonePromise) {
      try {
        // A previous call to _editGlyphOrInstance is still ongoing.
        // Let's wait a bit, but not forever.
        await withTimeout(this._glyphEditingDonePromise, 5000);
      } catch (error) {
        throw new Error("can't call _editGlyphOrInstance() while it's still running");
      }
    }
    let editingDone;
    this._glyphEditingDonePromise = new Promise((resolve) => {
      editingDone = resolve;
    });
    try {
      return await this._editGlyphOrInstanceUnchecked(
        glyphName,
        editFunc,
        senderID,
        doInstance,
        requireSelectedLayer,
        ignoreGlyphLock
      );
    } finally {
      // // Simulate slow response
      // console.log("...delay");
      // await new Promise((resolve) => setTimeout(resolve, 1000));
      // console.log("...done");
      editingDone();
      delete this._glyphEditingDonePromise;
      delete this._cancelGlyphEditing;
    }
  }

  async _editGlyphOrInstanceUnchecked(
    glyphName,
    editFunc,
    senderID,
    doInstance,
    requireSelectedLayer,
    ignoreGlyphLock = false
  ) {
    if (this.fontController.readOnly) {
      this._dispatchEvent("glyphEditCannotEditReadOnly");
      return;
    }
    if (!glyphName) {
      glyphName = this.getSelectedGlyphName();
    }
    const varGlyph = await this.fontController.getGlyph(glyphName);
    const baseChangePath = ["glyphs", glyphName];

    if (!!varGlyph?.glyph.customData["fontra.glyph.locked"] && !ignoreGlyphLock) {
      this._dispatchEvent("glyphEditCannotEditLocked");
      return;
    }

    let addSourceChanges;
    let glyphController;
    if (doInstance || requireSelectedLayer) {
      glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
      if (!glyphController.canEdit) {
        assert(!doInstance); // doInstance seems to be no longer used, always false
        addSourceChanges = this._insertGlyphSourceIfAtFontSource(
          varGlyph,
          glyphController
        );
        if (!addSourceChanges) {
          this._dispatchEvent("glyphEditLocationNotAtSource");
          return;
        }
      }
    }

    let editSubject;
    if (doInstance) {
      editSubject = glyphController.instance;
      baseChangePath.push("layers", glyphController.layerName, "glyph");
    } else {
      editSubject = varGlyph.glyph;
    }

    const editContext = await this.fontController.getGlyphEditContext(
      glyphName,
      baseChangePath,
      senderID || this
    );
    const sendIncrementalChange = async (change, mayDrop = false) => {
      if (change && hasChange(change)) {
        await editContext.editIncremental(change, mayDrop);
      }
    };
    const initialSelection = this.selection;
    // editContext.editBegin();
    let result;
    try {
      result = await editFunc(sendIncrementalChange, editSubject);
    } catch (error) {
      this.selection = initialSelection;
      editContext.editCancel();
      throw error;
    }

    let { changes, undoLabel, broadcast } = result || {};

    if (addSourceChanges) {
      changes = addSourceChanges.concat(changes);
    }

    if (changes && changes.hasChange) {
      const undoInfo = {
        label: undoLabel,
        undoSelection: initialSelection,
        redoSelection: this.selection,
        fontLocation: this.sceneSettings.fontLocationSourceMapped,
        glyphLocation: this.sceneSettings.glyphLocation,
        editingLayers: this.sceneSettings.editingLayers,
        editLayerName: this.sceneSettings.editLayerName,
        gridSnapEnabled: this.sceneSettings.gridSnapEnabled,
      };
      if (!this._cancelGlyphEditing) {
        editContext.editFinal(
          changes.change,
          changes.rollbackChange,
          undoInfo,
          broadcast
        );
      } else {
        applyChange(editSubject, changes.rollbackChange);
        await editContext.editIncremental(changes.rollbackChange, false);
        editContext.editCancel();
        message(
          translate("message.glyph-could-not-be-saved"),
          `${translate("message.edit-has-been-reverted")}\n\n${
            this._cancelGlyphEditing
          }`
        );
      }
    } else {
      this.selection = initialSelection;
      editContext.editCancel();
    }
  }

  _insertGlyphSourceIfAtFontSource(varGlyph, glyphController) {
    if (!isLocationAtDefault(this.sceneSettings.glyphLocation, varGlyph.axes)) {
      return undefined;
    }

    const sourceIdentifier =
      this.fontController.fontSourcesInstancer.getSourceIdentifierForLocation(
        this.sceneSettings.fontLocationSourceMapped
      );
    if (!sourceIdentifier) {
      return undefined;
    }

    if (varGlyph.sources.some((source) => source.locationBase === sourceIdentifier)) {
      // We already have a source here, but it is inactive.
      return undefined;
    }

    const instance = glyphController.instance.copy();
    // Round coordinates and component positions
    instance.path = instance.path.roundCoordinates();
    roundComponentOrigins(instance.components);

    const layerName = sourceIdentifier;

    const addSourceChanges = recordChanges(varGlyph.glyph, (glyph) => {
      glyph.sources.push(
        GlyphSource.fromObject({
          name: "", // Will be taken from font source
          layerName: layerName,
          location: {},
          locationBase: sourceIdentifier,
        })
      );
      glyph.layers[layerName] = Layer.fromObject({ glyph: instance });
    });
    this.sceneSettings.editingLayers = {
      [layerName]: varGlyph.getSparseLocationStringForSourceLocation(
        this.sceneSettings.fontLocationSourceMapped
      ),
    };
    return addSourceChanges;
  }

  getSelectionBounds(considerSceneBounds = true) {
    return this.sceneModel.getSelectionBounds(considerSceneBounds);
  }

  getUndoRedoInfo(isRedo) {
    const glyphName = this.getSelectedGlyphName();
    if (glyphName === undefined) {
      return;
    }
    return this.fontController.getUndoRedoInfo(glyphName, isRedo);
  }

  async doUndoRedo(isRedo) {
    const glyphName = this.getSelectedGlyphName();
    if (glyphName === undefined) {
      return;
    }
    const undoInfo = await this.fontController.undoRedoGlyph(glyphName, isRedo);
    if (undoInfo !== undefined) {
      this.selection = undoInfo.undoSelection;
      if (undoInfo.fontLocation) {
        this.scrollAdjustBehavior = "pin-glyph-origin-once";
        // Pass a copy of the location to ensure the listeners are called even
        // if the location didn't change: its dependents may vary depending on
        // the glyph data (eg. a source being there or not)
        this.sceneSettings.fontLocationSourceMapped = { ...undoInfo.fontLocation };
        this.sceneSettings.glyphLocation = { ...undoInfo.glyphLocation };
        this.sceneSettings.editingLayers = undoInfo.editingLayers;
        this.sceneSettings.editLayerName = undoInfo.editLayerName;
        if (undoInfo.gridSnapEnabled !== undefined) {
          this.sceneSettings.gridSnapEnabled = undoInfo.gridSnapEnabled;
        }
      }
      await this.sceneModel.updateScene();
      this.canvasController.requestUpdate();
    }
    return undoInfo !== undefined;
  }

  // One command for both kinds of contour. A selection can name skeleton
  // contours, path contours, or both at once, and each kind is reversed the way
  // that kind is reversed: a skeleton flips the flag its generator reads, a
  // path contour has its points turned around. Returning after the skeleton, as
  // this did, left the path contours in a mixed selection untouched.
  async doReverseSelectedContours() {
    const {
      point: pointSelection,
      skeletonPoint,
      skeletonRib,
    } = parseSelection(this.selection);
    // Same derivation the context menu state uses: the contour id is the first
    // field of either key, and a rib belongs to its contour as much as a
    // centerline point does.
    const skeletonContourIds = [
      ...new Set(
        [...(skeletonPoint || []), ...(skeletonRib || [])]
          .map((item) => Number(`${item}`.split("/")[0]))
          .filter((contourId) => Number.isInteger(contourId))
      ),
    ];
    if (skeletonContourIds.length) {
      await this.doReverseSelectedSkeletonContours(skeletonContourIds);
    }
    if (!pointSelection?.length) {
      return;
    }
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      let selection;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        const selectedContours = getSelectedContours(path, pointSelection);
        selection = reversePointSelection(path, pointSelection);

        for (const contourIndex of selectedContours) {
          const contour = path.getUnpackedContour(contourIndex);
          contour.points.reverse();
          if (contour.isClosed) {
            const [lastPoint] = contour.points.splice(-1, 1);
            contour.points.splice(0, 0, lastPoint);
          }
          const packedContour = packContour(contour);
          // Net-zero contour count (delete + re-insert at same index): generated
          // contour indices are unaffected, no skeleton bookkeeping needed.
          layerGlyph.path.deleteContour(contourIndex);
          layerGlyph.path.insertContour(contourIndex, packedContour);
        }
        // Reversing needs no marker bookkeeping. It leaves the outline exactly where it
        // is, so an anchor's place is unchanged and the address is simply rewritten to
        // wherever that place now lives. Under the old count rule this was the one
        // structural change that had to be declared broken by hand.
      }
      this.selection = selection;
      return translate("action.reverse-contour");
    });
  }

  // Reverse, for a skeleton. It flips the flag the generator already reads, so
  // the generated outline's winding turns over and the centerline stays exactly
  // as it was drawn. Each selected contour flips its own state, the same way
  // reversing a mixed selection of ordinary contours does.
  async doReverseSelectedSkeletonContours(skeletonContourIds) {
    // Markers need nothing here either: a reversal leaves both the centerline and the
    // emitted outline where they are, and an anchor is a place, not an index.
    await togglePanelContourReversed(
      this,
      skeletonContourIds.map((contourId) => ({ contourId })),
      translate("action.reverse-contour")
    );
  }

  async doSetStartPoint() {
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      let newSelection;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        const { point: pointSelection } = parseSelection(this.selection);
        const contourToPointMap = new Map();
        for (const pointIndex of pointSelection) {
          const contourIndex = path.getContourIndex(pointIndex);
          const contourStartPoint = path.getAbsolutePointIndex(contourIndex, 0);
          if (contourToPointMap.has(contourIndex)) {
            continue;
          }
          contourToPointMap.set(contourIndex, pointIndex - contourStartPoint);
        }
        newSelection = new Set();

        contourToPointMap.forEach((contourPointIndex, contourIndex) => {
          if (contourPointIndex === 0) {
            // Already start point
            newSelection.add(`point/${path.getAbsolutePointIndex(contourIndex, 0)}`);
            return;
          }
          if (!path.contourInfo[contourIndex].isClosed) {
            // Open path, ignore
            return;
          }
          const contour = path.getUnpackedContour(contourIndex);
          const head = contour.points.splice(0, contourPointIndex);
          contour.points.push(...head);
          // Net-zero contour count (delete + re-insert at same index): no shift.
          layerGlyph.path.deleteContour(contourIndex);
          layerGlyph.path.insertContour(contourIndex, packContour(contour));
          newSelection.add(`point/${path.getAbsolutePointIndex(contourIndex, 0)}`);
        });
      }

      this.selection = newSelection;
      return translate("action.set-contour-start");
    });
  }

  async doJoinSelectedOpenContours() {
    const newSelection = new Set();
    const [pointIndex1, pointIndex2] = this.contextMenuState.joinContourSelection;
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        // joinContours removes the second (higher-indexed) contour; compute its
        // index before the join, while the point indices are still valid, so
        // only generated contours after it shift down.
        const [removedContourIndex] = layerGlyph.path.getContourAndPointIndex(
          Math.max(pointIndex1, pointIndex2)
        );
        const selectionPointIndices = joinContours(
          layerGlyph.path,
          pointIndex1,
          pointIndex2
        );

        for (const pointIndex of selectionPointIndices) {
          newSelection.add(`point/${pointIndex}`);
        }
        recordSkeletonContourIndexShift(layerGlyph, removedContourIndex, -1);
      }
      this.selection = newSelection;
      return translate("action.join-contours");
    });
  }

  async doCloseSelectedOpenContours() {
    const openContours = this.contextMenuState.openContourSelection;
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        for (const contourIndex of openContours) {
          // close open contour
          path.contourInfo[contourIndex].isClosed = true;
          closeContourEnsureCubicOffCurves(path, contourIndex);
        }
      }
      return translatePlural("action.close-contour", openContours.length);
    });
  }

  // Join, for a skeleton. Two open centerline ends become one contour, and the
  // generated outline follows on its own: the one write path regenerates it
  // whenever the topology changes.
  async doJoinSelectedSkeletonContours() {
    const [firstEnd, secondEnd] = this.contextMenuState.skeletonJoinSelection;
    await joinPanelSkeletonContours(
      this,
      firstEnd,
      secondEnd,
      translate("action.join-contours")
    );
    this.selection = new Set();
  }

  // Close, for a skeleton: the contour meets its own two ends. No point is added
  // and none is moved, which is what the pen's click on the far end already does.
  async doCloseSelectedSkeletonContours() {
    await closePanelSkeletonContours(
      this,
      this.contextMenuState.skeletonCloseSelection,
      translatePlural("action.close-contour", 1)
    );
    this.selection = new Set();
  }

  // Break, for a skeleton: cut the contour at the selected centerline point. A
  // closed contour opens there, an open one becomes two. The generated outline
  // follows on its own, because the one write path regenerates it and replaces
  // the contours whenever the topology changes.
  async doBreakSelectedSkeletonContours(skeletonPointSelection) {
    const pointAddresses = skeletonPointSelection
      .map((item) => parseSkeletonPointKey(`${item}`))
      .filter((address) => address);
    if (!pointAddresses.length) {
      return;
    }
    await splitPanelSkeletonContours(
      this,
      pointAddresses,
      translatePlural("action.break-contour", pointAddresses.length)
    );
    this.selection = new Set();
  }

  async doBreakSelectedContours() {
    const skeletonPointSelection = this.contextMenuState.skeletonPointSelection || [];
    if (skeletonPointSelection.length) {
      await this.doBreakSelectedSkeletonContours(skeletonPointSelection);
      return;
    }
    const { point: pointIndices } = parseSelection(this.selection);
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      let numSplits;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        // Splitting inserts contours, shifting skeleton-generated contour
        // indices; dry-run on a marked scratch copy to learn where they land.
        const remap = computeGeneratedContourRemap(layerGlyph, (scratchPath) =>
          splitPathAtPointIndices(scratchPath, pointIndices)
        );
        numSplits = splitPathAtPointIndices(layerGlyph.path, pointIndices);
        applyGeneratedContourRemap(layerGlyph, remap);
      }
      this.selection = new Set();
      return translatePlural("action.break-contour", numSplits);
    });
  }

  async doDecomposeSelectedComponents() {
    const varGlyph = await this.sceneModel.getSelectedVariableGlyphController();

    // Retrieve the global location for each editing layer
    const layerLocations = {};
    for (const [sourceIndex, source] of enumerate(varGlyph.sources)) {
      if (
        this.editingLayerNames.indexOf(source.layerName) >= 0 &&
        !(source.layerName in layerLocations)
      ) {
        layerLocations[source.layerName] =
          varGlyph.getDenseSourceLocationForSourceIndex(sourceIndex);
      }
    }

    // Get the decomposed path/components for each editing layer
    const { component: componentSelection } = parseSelection(this.selection);
    componentSelection.sort((a, b) => (a > b) - (a < b));
    const getGlyphFunc = (glyphName) => this.fontController.getGlyph(glyphName);
    const decomposed = {};
    for (const layerName of this.editingLayerNames) {
      const layerGlyph = varGlyph.layers[layerName]?.glyph;
      if (!layerGlyph) {
        continue;
      }
      decomposed[layerName] = await decomposeComponents(
        layerGlyph.components,
        componentSelection,
        layerLocations[layerName],
        getGlyphFunc
      );
    }

    await this.editGlyphAndRecordChanges(
      (glyph) => {
        const layerGlyphs = this.getEditingLayerFromGlyphLayers(glyph.layers);
        // Decompose appends the decomposed components at the end and then
        // removes the ones it decomposed, so the attachment list has to follow
        // both moves in the same change. Spec section 4.1.
        const componentCountBefore = componentCountOf(glyph);
        const appendedCount = Object.values(decomposed)[0]?.components.length || 0;
        for (const [layerName, layerGlyph] of Object.entries(layerGlyphs)) {
          const decomposeInfo = decomposed[layerName];
          const path = layerGlyph.path;
          const components = layerGlyph.components;
          const anchors = layerGlyph.anchors;

          for (const contour of decomposeInfo.path.iterContours()) {
            // Hm, rounding should be optional
            // contour.coordinates = contour.coordinates.map(c => Math.round(c));
            path.appendContour(contour);
          }
          components.push(...decomposeInfo.components);
          for (const anchor of decomposeInfo.anchors) {
            // preserve existing anchors
            const exists = anchors.some((a) => a.name === anchor.name);
            if (!exists) {
              anchors.push(anchor);
            }
          }

          // Next, delete the components we decomposed
          for (const componentIndex of reversed(componentSelection)) {
            components.splice(componentIndex, 1);
          }
        }
        recordComponentInsert(
          glyph,
          componentCountBefore,
          appendedCount,
          componentCountBefore
        );
        recordComponentDelete(
          glyph,
          componentSelection || [],
          componentCountBefore + appendedCount
        );
        this.selection = new Set();
        return translatePlural(
          "action.decompose-component",
          componentSelection?.length
        );
      },
      undefined,
      true
    );
  }

  async doAddOverlap() {
    const { point: pointSelection } = parseSelection(this.selection);
    await this.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        // Validate that path is a VarPackedPath instance with all required methods
        if (!path || typeof path !== "object") {
          console.warn("Invalid path object for addOverlap, skipping - not an object");
          continue;
        }
        if (!(path instanceof VarPackedPath)) {
          console.warn(
            "Invalid path object for addOverlap, skipping - not a VarPackedPath instance"
          );
          continue;
        }

        const requiredMethods = [
          "copy",
          "getPoint",
          "getAbsolutePointIndex",
          "getNumPointsOfContour",
          "setPointPosition",
          "insertPoint",
        ];
        let hasAllMethods = true;
        for (const method of requiredMethods) {
          if (typeof path[method] !== "function") {
            console.warn(
              `Invalid path object for addOverlap, skipping - missing method: ${method}`
            );
            hasAllMethods = false;
            break;
          }
        }

        // Additional check for getPoint method specifically
        if (typeof path.getPoint !== "function") {
          console.warn(
            "Invalid path object for addOverlap, skipping - missing getPoint method"
          );
          continue;
        }

        if (!hasAllMethods) {
          continue;
        }

        if (typeof path.numContours === "undefined") {
          console.warn(
            "Invalid path object for addOverlap, skipping - missing numContours property"
          );
          continue;
        }

        try {
          // Create a copy of the path with overlap added
          const newPath = addOverlapToPath(path, pointSelection);
          // Replace the path with the new path that has overlap
          layerGlyph.path = newPath;
        } catch (error) {
          console.warn("Error while adding overlap:", error);
          console.warn("Error stack:", error.stack);
        }
      }
      // Clear the selection after adding overlap
      this.selection = new Set();
      return translate("action.add-overlap");
    });
  }

  //
  // G2-harmonize the smooth joints implied by the current point selection.
  // An empty selection means the whole layer, matching both donors.
  //
  // Returns a Map of layer name -> report entries (see harmonization.js), so the
  // caller can tell the user what happened per source. No change is recorded
  // when nothing is harmonizable: a no-op that eats an undo step is worse than
  // no undo step at all.
  //
  async doHarmonize(options = {}) {
    const {
      useG3 = applicationSettingsController.model.harmonizeG3,
      method = applicationSettingsController.model.harmonizeMethod,
      applyToOtherSources = applicationSettingsController.model.harmonizeOtherSources,
    } = options;

    // One control names one construction. G3 has one, so the position is not
    // read under it.
    const continuity = useG3 ? "G3" : "G2";
    const construction =
      { 1: "nearest", 2: "canonical", 3: "canonical-slide" }[method] ?? "canonical";

    const reports = new Map();

    // A skeleton selection answers this itself, the same way break and reverse
    // do. The centerline is an ordinary path and harmonize applies to it
    // unchanged, but it is written through the skeleton's own path so the
    // outline is regenerated. Skeleton and ordinary points are never mixed into
    // one pass: that would take two write paths and cost two undo steps.
    const skeletonPointSelection = parseSelection(this.selection).skeletonPoint || [];
    if (skeletonPointSelection.length) {
      return await harmonizePanelSkeletonPoints(
        this,
        skeletonPointSelection
          .map((item) => parseSkeletonPointKey(`${item}`))
          .filter((address) => address),
        {
          continuity,
          method: construction,
        },
        translate("action.harmonize")
      );
    }

    const path = this.sceneModel.getSelectedPositionedGlyph()?.glyph?.path;
    if (!path) {
      return reports;
    }

    // Structure (point count, point types, contour layout) is shared by all
    // compatible layers, so the candidate set and the generated-contour
    // exclusion can both be derived from the layer on screen.
    const { point: pointSelection } = parseSelection(this.selection);
    const candidates = expandToJoints(path, pointSelection);

    const refused = [];
    const pointIndices = [];
    for (const pointIndex of candidates) {
      const contourIndex = path.getContourIndex(pointIndex);
      if (this.sceneModel.isGeneratedPathContour(contourIndex)) {
        // R-D: generated geometry is regenerated on every edit, so editing it
        // directly would be thrown away.
        refused.push({
          pointIndex,
          contourIndex,
          status: "skipped",
          reason: "generated-contour",
          iterations: 0,
        });
      } else {
        pointIndices.push(pointIndex);
      }
    }

    if (!pointIndices.length) {
      if (refused.length) {
        reports.set(this.sceneSettings.editLayerName, refused);
      }
      return reports;
    }

    await this.editLayersAndRecordChanges((layerGlyphs) => {
      const editLayerName = this.sceneSettings.editLayerName;
      const targets = applyToOtherSources
        ? Object.entries(layerGlyphs)
        : [
            [
              editLayerName,
              layerGlyphs[editLayerName] || Object.values(layerGlyphs)[0],
            ],
          ];

      for (const [layerName, layerGlyph] of targets) {
        if (!layerGlyph) {
          continue;
        }
        // Recompute per layer rather than propagating one layer's correction:
        // the other sources have different handles, hence a different target.
        //
        // The sweep runs on a copy and only the points that ended up somewhere
        // else are written back. It moves a point several times on the way to
        // an answer, and it rounds at the end, so a joint that was already
        // harmonic could be written to three times and land exactly where it
        // started. Every one of those writes is a recorded change, which put an
        // undo step on the stack for a command that did nothing.
        //
        // Written point by point, not `layerGlyph.path = newPath`: the recorder
        // turns each setPointPosition into an `=xy` change, whereas a
        // whole-path assignment smuggles a live VarPackedPath into the change
        // payload and it does not survive the round trip.
        const path = layerGlyph.path;
        const working = path.copy();
        const report = harmonizePathInPlace(working, pointIndices, {
          continuity,
          method: construction,
          roundCoordinates: true,
        });
        for (let index = 0; index < path.numPoints; index++) {
          const [x, y] = path.getPointPosition(index);
          const [newX, newY] = working.getPointPosition(index);
          if (newX !== x || newY !== y) {
            path.setPointPosition(index, newX, newY);
          }
        }
        reports.set(layerName, [...report, ...refused]);
      }

      return translate("action.harmonize");
    });

    return reports;
  }

  //
  // Balance the segments the current point selection touches.
  //
  // Its own command, not a step of harmonizing. Both want the same handles: a
  // segment's end curvature is set by its last three control points, so the
  // inner handle is what harmonizing moves to make two segments agree at a
  // joint, and it is also half of what balancing sets. Neither can have them
  // exactly, so the designer chooses the order and sees each effect on its own.
  //
  // Same shape as `doHarmonize` throughout: the same selection rule, the same
  // skeleton route, the same per-source option, and a report per layer.
  //
  async doBalance(options = {}) {
    const {
      applyToOtherSources = applicationSettingsController.model.harmonizeOtherSources,
    } = options;

    const reports = new Map();

    const skeletonPointSelection = parseSelection(this.selection).skeletonPoint || [];
    if (skeletonPointSelection.length) {
      return await balancePanelSkeletonPoints(
        this,
        skeletonPointSelection
          .map((item) => parseSkeletonPointKey(`${item}`))
          .filter((address) => address),
        translate("action.balance")
      );
    }

    const path = this.sceneModel.getSelectedPositionedGlyph()?.glyph?.path;
    if (!path) {
      return reports;
    }

    // The selection as given. Balancing states one thing about a segment, and
    // the segments a selection touches are the segments it means — there is no
    // joint to expand to.
    const { point: pointSelection } = parseSelection(this.selection);
    const candidates = pointSelection?.length
      ? pointSelection
      : expandToJoints(path, undefined);

    const refused = [];
    const pointIndices = [];
    for (const pointIndex of candidates) {
      const contourIndex = path.getContourIndex(pointIndex);
      if (this.sceneModel.isGeneratedPathContour(contourIndex)) {
        // R-D: generated geometry is regenerated on every edit, so editing it
        // directly would be thrown away.
        refused.push({
          pointIndex,
          contourIndex,
          status: "skipped",
          reason: "generated-contour",
        });
      } else {
        pointIndices.push(pointIndex);
      }
    }

    if (!pointIndices.length) {
      if (refused.length) {
        reports.set(this.sceneSettings.editLayerName, refused);
      }
      return reports;
    }

    await this.editLayersAndRecordChanges((layerGlyphs) => {
      const editLayerName = this.sceneSettings.editLayerName;
      const targets = applyToOtherSources
        ? Object.entries(layerGlyphs)
        : [
            [
              editLayerName,
              layerGlyphs[editLayerName] || Object.values(layerGlyphs)[0],
            ],
          ];

      for (const [layerName, layerGlyph] of targets) {
        if (!layerGlyph) {
          continue;
        }
        // Per layer, and point by point on the way back, for the two reasons
        // harmonize has: another source has different handles and so a
        // different answer, and a whole-path assignment does not survive the
        // change recorder.
        const path = layerGlyph.path;
        const working = path.copy();
        const report = balancePathInPlace(working, pointIndices);
        for (let index = 0; index < path.numPoints; index++) {
          const [x, y] = path.getPointPosition(index);
          const [newX, newY] = working.getPointPosition(index);
          if (newX !== x || newY !== y) {
            path.setPointPosition(index, newX, newY);
          }
        }
        reports.set(layerName, [...report, ...refused]);
      }

      return translate("action.balance");
    });

    return reports;
  }

  getPathConnectDetector(path) {
    if (!path) {
      const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
      path = positionedGlyph.glyph.path;
    }
    return new PathConnectDetector(this, path);
  }

  async getStaticGlyphControllers() {
    const varGlyph = await this.sceneModel.getSelectedVariableGlyphController();

    const layerGlyphs = this.getEditingLayerFromGlyphLayers(varGlyph.layers);
    const staticGlyphControllers = {};

    for (const [i, source] of enumerate(varGlyph.sources)) {
      for (const layerInfo of varGlyph.getSourceLayerNamesForSourceIndex(i)) {
        const layerName = layerInfo.fullName;
        if (layerName in layerGlyphs) {
          staticGlyphControllers[layerName] =
            await this.fontController.getLayerGlyphController(
              varGlyph.name,
              layerName,
              i
            );
        }
      }
    }
    return staticGlyphControllers;
  }
}

class PathConnectDetector {
  constructor(sceneController, path) {
    this.sceneController = sceneController;
    this.path = path;
    const selection = sceneController.selection;
    if (selection.size !== 1) {
      return;
    }
    const { point: pointSelection } = parseSelection(selection);
    if (
      pointSelection?.length !== 1 ||
      !this.path.isStartOrEndPoint(pointSelection[0])
    ) {
      return;
    }
    this.connectSourcePointIndex = pointSelection[0];
  }

  shouldConnect(showConnectIndicator = false) {
    if (this.connectSourcePointIndex === undefined) {
      return false;
    }

    const sceneController = this.sceneController;
    const connectSourcePoint = this.path.getPoint(this.connectSourcePointIndex);
    const connectTargetPointIndex = this.path.pointIndexNearPoint(
      connectSourcePoint,
      sceneController.mouseClickMargin,
      this.connectSourcePointIndex
    );
    const shouldConnect =
      connectTargetPointIndex !== undefined &&
      connectTargetPointIndex !== this.connectSourcePointIndex &&
      !!this.path.isStartOrEndPoint(connectTargetPointIndex);
    if (showConnectIndicator) {
      if (shouldConnect) {
        sceneController.sceneModel.pathConnectTargetPoint = this.path.getPoint(
          connectTargetPointIndex
        );
      } else {
        delete sceneController.sceneModel.pathConnectTargetPoint;
      }
    }
    this.connectTargetPointIndex = connectTargetPointIndex;
    return shouldConnect;
  }

  clearConnectIndicator() {
    delete this.sceneController.sceneModel.pathConnectTargetPoint;
  }
}

const persistentSceneSettings = [
  // Keep this order, may be important
  { key: "align" },
  { key: "featureSettings" },
  { key: "applyTextShaping" },
  { key: "textDirection" },
  { key: "textScript" },
  { key: "textLanguage" },
  { key: "viewBox" },
  { key: "text", waitKeyAfter: "characterLines" },
  // "glyphLocations", // handled separately
  { key: "fontAxesUseSourceCoordinates" },
  { key: "fontAxesShowEffectiveLocation" },
  { key: "hiddenFontAxesShowEffectiveLocation" },
  { key: "fontAxesShowHidden" },
  { key: "fontAxesSkipMapping" },
  { key: "fontLocationUser", infoKey: "location" },
  { key: "selectedGlyph" },
  { key: "substituteGlyphName" },
  { key: "editLayerName" },
  { key: "editingLayers" },
  { key: "selection", waitKeyBefore: "positionedLines" },
  { key: "projectGlyphSetSelection" },
  { key: "myGlyphSetSelection" },
];

export const persistentSceneSettingsKeys = persistentSceneSettings.map(
  ({ key }) => key
);

function getSceneSettingsDefaults() {
  return {
    text: "",
    align: "center",
    editLayerName: null,
    characterLines: [],
    fontLocationUser: {},
    fontLocationSource: {},
    fontLocationSourceMapped: {},
    fontAxesUseSourceCoordinates: false,
    fontAxesShowEffectiveLocation: ShowLocationSettings.DontShowEffectiveLocation,
    hiddenFontAxesShowEffectiveLocation: ShowLocationSettings.DontShowEffectiveLocation,
    fontAxesShowHidden: false,
    fontAxesSkipMapping: false,
    glyphLocation: {},
    selectedGlyph: null,
    selectedGlyphName: null,
    substituteGlyphName: null,
    selection: new Set(),
    hoverSelection: new Set(),
    combinedSelection: new Set(), // dynamic: selection | hoverSelection
    viewBox: null,
    positionedLines: [],
    backgroundImagesAreLocked: true,
    backgroundLayers: {},
    editingLayers: {},
    featureSettings: {},
    applyTextShaping: true,
    textDirection: null,
    textScript: null,
    textLanguage: null,
    shaper: null,
    shaperInfo: null,
    dumbShaperInfo: null,
    glyphRenderInfoLineIndex: 0,
    shapingDebuggerEnabled: false,
    shapingDebuggerMessages: null,
    shapingDebuggerBreakIndex: null,
    projectGlyphSets: {},
    myGlyphSets: {},
    projectGlyphSetSelection: [],
    myGlyphSetSelection: [],
    combinedGlyphMap: {},
    combinedCharacterMap: {},
  };
}

function convertViewBoxArrayToRect(viewBox) {
  return viewBox && viewBox.every((value) => !isNaN(value))
    ? rectFromArray(viewBox)
    : null;
}

function convertViewBoxRectToArray(viewBox) {
  viewBox = viewBox ? rectToArray(viewBox) : null;
  return viewBox && viewBox.every((value) => !isNaN(value)) ? viewBox : null;
}

function reversePointSelection(path, pointSelection) {
  const newSelection = [];
  for (const pointIndex of pointSelection) {
    const contourIndex = path.getContourIndex(pointIndex);
    const contourStartPoint = path.getAbsolutePointIndex(contourIndex, 0);
    const numPoints = path.getNumPointsOfContour(contourIndex);
    let newPointIndex = pointIndex;
    if (path.contourInfo[contourIndex].isClosed) {
      if (newPointIndex != contourStartPoint) {
        newPointIndex =
          contourStartPoint + numPoints - (newPointIndex - contourStartPoint);
      }
    } else {
      newPointIndex =
        contourStartPoint + numPoints - 1 - (newPointIndex - contourStartPoint);
    }
    newSelection.push(`point/${newPointIndex}`);
  }
  newSelection.sort((a, b) => (a > b) - (a < b));
  return new Set(newSelection);
}

// Which selected centerline points are the open END of their contour. An end is
// what a join and a close both need, and a point in the middle of a stroke is
// neither - so this returns the ends and says nothing about how many there are.
function getSelectedSkeletonOpenEnds(skeletonData, skeletonPointSelection) {
  const ends = [];
  for (const key of skeletonPointSelection || []) {
    const address = parseSkeletonPointKey(`${key}`);
    if (!address) {
      continue;
    }
    const contour = getSkeletonContour(skeletonData, address.contourId);
    const endpoints = skeletonContourEndpointIndices(contour);
    if (!endpoints) {
      continue; // closed, or no on-curve point
    }
    const pointId = contour.points[endpoints.first].id;
    const lastId = contour.points[endpoints.last].id;
    if (address.pointId === pointId || address.pointId === lastId) {
      ends.push({ contourId: contour.id, pointId: address.pointId });
    }
  }
  return ends;
}

function getSelectedJoinContoursPointIndices(path, pointSelection) {
  if (pointSelection?.length !== 2) {
    return [];
  }
  const contourIndices = [];
  for (const pointIndex of pointSelection) {
    if (!path.isStartOrEndPoint(pointIndex)) {
      // must be start or end point
      return [];
    }
    const contourIndex = path.getContourIndex(pointIndex);
    contourIndices.push(contourIndex);
    if (path.contourInfo[contourIndex].isClosed) {
      // return, because at least one of the selected points is a closed contour
      return [];
    }
  }

  const contourIndicesSet = new Set(contourIndices);
  if (contourIndicesSet.size !== 2) {
    // must be two distinct contours, if same use 'close contour'
    return [];
  }

  return pointSelection;
}

function getSelectedContours(path, pointSelection) {
  const selectedContours = new Set();
  for (const pointIndex of pointSelection) {
    const contourIndex = path.getContourIndex(pointIndex);
    if (contourIndex != undefined) {
      selectedContours.add(contourIndex);
    }
  }
  return [...selectedContours];
}

function getSelectedClosableContours(path, pointSelection) {
  if (!path || !pointSelection) {
    return [];
  }
  const selectedContours = new Set();
  for (const contourIndex of getSelectedContours(path, pointSelection)) {
    if (path.contourInfo[contourIndex].isClosed) {
      // skip if contour is closed already
      continue;
    }
    if (path.getNumPointsOfContour(contourIndex) <= 2) {
      // skip if contour has two (or less) points only
      // (two on-curve or one off-curve and one on-curve)
      continue;
    }
    const contour = path.getContour(contourIndex);
    const numOnCurvePoints = contour.pointTypes.reduce(
      (acc, pointType) =>
        acc +
        ((pointType & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE
          ? 1
          : 0),
      0
    );
    if (numOnCurvePoints <= 1) {
      // skip single point contour
      // could have one on-curve, but two off-curve points
      continue;
    }
    selectedContours.add(contourIndex);
  }

  return [...selectedContours];
}

function closeContourEnsureCubicOffCurves(path, contourIndex) {
  const startPoint = path.getContourPoint(contourIndex, 0);
  const secondPoint = path.getContourPoint(contourIndex, 1);
  const prevEndPoint = path.getContourPoint(contourIndex, -2);
  const endPoint = path.getContourPoint(contourIndex, -1);

  const offCurveAtStart = !secondPoint.type && startPoint.type && !endPoint.type;
  const firstPoint = offCurveAtStart ? secondPoint : prevEndPoint;
  const middlePoint = offCurveAtStart ? startPoint : endPoint;
  const lastPoint = offCurveAtStart ? endPoint : startPoint;

  if (firstPoint.type || middlePoint.type != "cubic" || lastPoint.type) {
    // Sanity check: we expect on-curve/cubic-off-curve/on-curve
    return;
  }

  // Compute handles for a cubic segment that will look the same as the
  // one-off-curve quad segment we have.
  const [handle1, handle2] = [firstPoint, lastPoint].map((point) => {
    return {
      ...vector.roundVector(scalePoint(point, middlePoint, 2 / 3)),
      type: "cubic",
    };
  });

  path.setContourPoint(contourIndex, offCurveAtStart ? 0 : -1, handle1);
  path.appendPoint(contourIndex, handle2);
}

function positionedGlyphPosition(positionedGlyph) {
  if (!positionedGlyph) {
    return undefined;
  }
  return {
    x: positionedGlyph.x,
    y: positionedGlyph.y,
    xAdvance: positionedGlyph.glyph.xAdvance,
  };
}

export function equalGlyphSelection(glyphSelectionA, glyphSelectionB) {
  return (
    glyphSelectionA?.lineIndex === glyphSelectionB?.lineIndex &&
    glyphSelectionA?.glyphIndex === glyphSelectionB?.glyphIndex &&
    glyphSelectionA?.metric === glyphSelectionB?.metric
  );
}

export function joinContours(path, firstPointIndex, secondPointIndex) {
  let selectedPointIndices = [];
  assert(
    path.isStartOrEndPoint(firstPointIndex) && path.isStartOrEndPoint(secondPointIndex),
    "firstPointIndex and secondPointIndex must be start or end points"
  );
  assert(
    firstPointIndex < secondPointIndex,
    "firstPointIndex must be less than secondPointIndex"
  );

  const [firstContourIndex, firstContourPointIndex] =
    path.getContourAndPointIndex(firstPointIndex);
  const [secondContourIndex, secondContourPointIndex] =
    path.getContourAndPointIndex(secondPointIndex);

  assert(
    firstContourIndex != secondContourIndex,
    "firstContourIndex and secondContourIndex must be different"
  );

  let firstContour = path.getUnpackedContour(firstContourIndex);
  let secondContour = path.getUnpackedContour(secondContourIndex);

  if (!!firstContourPointIndex == !!secondContourPointIndex) {
    secondContour.points.reverse();
  }

  if (!firstContourPointIndex) {
    [firstContour, secondContour] = [secondContour, firstContour];
  }
  let selectedContourPointIndex1 = firstContour.points.length - 1;
  let selectedContourPointIndex2 = selectedContourPointIndex1 + 1;
  let loneCubicHandle;
  const lastPointFirstContour = firstContour.points.at(-1);
  const firstPointSecondContour = secondContour.points.at(0);
  if (lastPointFirstContour.type && !firstPointSecondContour.type) {
    loneCubicHandle = firstContour.points.pop();
  } else if (firstPointSecondContour.type && !lastPointFirstContour.type) {
    loneCubicHandle = secondContour.points.shift();
  }

  if (loneCubicHandle) {
    const [handle1, handle2] = [
      firstContour.points.at(-1),
      secondContour.points.at(0),
    ].map((point) => {
      return {
        ...vector.roundVector(scalePoint(point, loneCubicHandle, 2 / 3)),
        type: "cubic",
      };
    });
    firstContour.points.push(handle1);
    firstContour.points.push(handle2);
    selectedContourPointIndex2 += 1;
  }

  const newContour = {
    points: firstContour.points.concat(secondContour.points),
    isClosed: false,
  };

  // Bare-path helper: net -1 contour. Skeleton generated-index bookkeeping is
  // handled by the caller (doJoinSelectedOpenContours) via
  // recordSkeletonContourIndexShift, where the layer glyph is in scope.
  path.deleteContour(firstContourIndex);
  path.insertUnpackedContour(firstContourIndex, newContour);
  path.deleteContour(secondContourIndex);

  selectedPointIndices.push(
    path.getAbsolutePointIndex(firstContourIndex, selectedContourPointIndex1)
  );
  selectedPointIndices.push(
    path.getAbsolutePointIndex(firstContourIndex, selectedContourPointIndex2)
  );

  return selectedPointIndices;
}
