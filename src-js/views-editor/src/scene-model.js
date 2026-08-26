import {
  pointInConvexPolygon,
  rectIntersectsPolygon,
} from "@fontra/core/convex-hull.js";
import { calculateHandleMeasure } from "@fontra/core/distance-angle.js";
import {
  getSuggestedGlyphName,
  guessDirectionFromCodePoints,
} from "@fontra/core/glyph-data.js";
import { loaderSpinner } from "@fontra/core/loader-spinner.js";
import {
  centeredRect,
  insetRect,
  isEmptyRect,
  normalizeRect,
  offsetRect,
  pointInRect,
  rectFromPoints,
  rectToPoints,
  sectRect,
  unionRect,
} from "@fontra/core/rectangle.ts";
import { difference, isEqualSet, union, updateSet } from "@fontra/core/set-ops.js";
import { MAX_UNICODE } from "@fontra/core/shaper.js";
import {
  buildGeneratedTunniSegments,
  findGeneratedPathAddress,
  formatGeneratedCurvature,
  generatedTunniHitTest,
  getGeneratedPathContourIndices,
  getGeneratedSegmentCurvature,
  getSkeletonData,
  getSkeletonPointHalfWidth,
  getSkeletonPointWidth,
  getSkeletonRibAddress,
  isSkeletonSideLocked,
  iterSkeletonRibTargets,
  parseEditableGeneratedHandleKey,
  parseEditableGeneratedPointKey,
  resolveEditableGeneratedTarget,
  skeletonTunniHitTest,
} from "@fontra/core/skeleton-model.js";
import { decomposedToTransform } from "@fontra/core/transform.js";
import { calculateCurvatureGizmoPoint } from "@fontra/core/tunni-calculations.js";

import {
  assert,
  consolidateCalls,
  disambiguateGlyphName,
  enumerate,
  mapObjectKeys,
  objectsEqualSerialized,
  parseSelection,
  range,
  reversed,
  valueInRange,
} from "@fontra/core/utils.ts";
import { normalizeLocation, unnormalizeLocation } from "@fontra/core/var-model.js";
import * as vector from "@fontra/core/vector.js";
import { BASE_EXPAND_BEHAVIOR_NAME } from "./base-expand-editing.js";
import {
  getSkeletonPointAddress,
  makeSkeletonPointKey,
  parseSkeletonPointKey,
  skeletonRibBehaviorIsTangentSlide,
} from "./skeleton-editing.js";

export class SceneModel {
  constructor(
    fontController,
    sceneSettingsController,
    isPointInPath,
    visualizationLayersSettings
  ) {
    this.fontController = fontController;
    this.sceneSettingsController = sceneSettingsController;
    this.sceneSettings = sceneSettingsController.model;
    this.isPointInPath = isPointInPath;
    this.visualizationLayersSettings = visualizationLayersSettings;
    this.hoveredGlyph = undefined;
    this._glyphLocations = {}; // glyph name -> glyph location
    this.longestLineLength = 0;
    this.usedGlyphNames = new Set();
    this.cachedGlyphNames = new Set();
    this.updateSceneCancelSignal = {};

    // fork: Q-measure realtime overlay state (WS-2; no skeleton/rib)
    this.measureMode = false;
    this.measureShowDirect = false;
    this.measureHoverSegment = null;
    this.measureHoverPoints = null;
    this.measureHoverHandle = null;
    this.measureHoverSkeletonRib = null;

    // The snap candidates the current gesture holds, for the snapping layer to draw.
    this.snapHeldCandidates = [];
    this.snapIndicator = null;
    this.snapSuggestion = null;
    this.snapDebugReadout = null;

    this.sceneSettingsController.addKeyListener(
      [
        "characterLines",
        "align",
        "featureSettings",
        "applyTextShaping",
        "selectedGlyph",
        "editLayerName",
        "textDirection",
        "textScript",
        "textLanguage",
        "shaper",
        "combinedCharacterMap",
        "shapingDebuggerEnabled",
        "shapingDebuggerBreakIndex",
      ],
      (event) => {
        this.updateScene();
      }
    );

    this.sceneSettingsController.addKeyListener(
      "applyTextShaping",
      async (event) => {
        if (!this.sceneSettings.selectedGlyph) {
          return;
        }

        // Try to keep the same glyph selection after toggling applyTextShaping

        const selectedCharacter = this.glyphSelectionToCharacterSelection(
          this.sceneSettings.selectedGlyph
        );

        await this.sceneSettingsController.waitForKeyChange("positionedLines");

        this.sceneSettings.selectedGlyph =
          this.characterSelectionToGlyphSelection(selectedCharacter);
      },
      true // immediately
    );

    this.sceneSettingsController.addKeyListener(
      ["fontLocationSourceMapped", "glyphLocation"],
      (event) => {
        this._resetKerningInstance();
        this._syncGlyphLocations();
        this.updateScene();
      }
    );

    this.fontController.addChangeListener(
      { kerning: null },
      () => this._resetKerningInstance(),
      true,
      true
    );

    this.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      (event) => {
        this.sceneSettings.selection = new Set();
        this._syncLocationFromGlyphName();
      },
      true
    );
  }

  get characterLines() {
    return this.sceneSettings.characterLines;
  }

  get selectedGlyph() {
    return this.sceneSettings.selectedGlyph;
  }

  get positionedLines() {
    return this.sceneSettings.positionedLines;
  }

  get selection() {
    return this.sceneSettings.selection;
  }

  set selection(selection) {
    this.sceneSettings.selection = selection;
  }

  get hoverSelection() {
    return this.sceneSettings.hoverSelection;
  }

  set hoverSelection(hoverSelection) {
    this.sceneSettings.hoverSelection = hoverSelection;
  }

  getSelectedPositionedGlyph() {
    return this.getPositionedGlyphFromSelection(this.selectedGlyph);
  }

  setMeasureActive(active, options = {}) {
    this.measureMode = !!active;
    if (!this.measureMode) {
      this.measureShowDirect = false;
      this._clearMeasureHover();
      return;
    }
    this.measureShowDirect = !!options.showDirect;
  }

  setMeasureShowDirect(showDirect) {
    this.measureShowDirect = !!showDirect;
  }

  _clearMeasureHover() {
    this.measureHoverSegment = null;
    this.measureHoverPoints = null;
    this.measureHoverHandle = null;
    this.measureHoverSkeletonRib = null;
  }

  setMeasureHoverTarget(kind, payload = null) {
    this._clearMeasureHover();
    switch (kind) {
      case "handle":
        this.measureHoverHandle = payload;
        break;
      case "segment":
        this.measureHoverSegment = payload;
        break;
      case "points":
        this.measureHoverPoints = payload;
        break;
      case "skeletonRib":
        this.measureHoverSkeletonRib = payload;
        break;
    }
  }

  getMeasureHoverTarget() {
    if (this.measureHoverHandle) {
      return { kind: "handle", payload: this.measureHoverHandle };
    }
    if (this.measureHoverSegment) {
      return { kind: "segment", payload: this.measureHoverSegment };
    }
    if (this.measureHoverPoints) {
      return { kind: "points", payload: this.measureHoverPoints };
    }
    if (this.measureHoverSkeletonRib) {
      return { kind: "skeletonRib", payload: this.measureHoverSkeletonRib };
    }
    return null;
  }

  resetMeasureState() {
    this.setMeasureActive(false);
  }

  getHoveredPositionedGlyph() {
    return this.getPositionedGlyphFromSelection(this.hoveredGlyph);
  }

  getPositionedGlyphFromSelection(glyphSelection) {
    if (!glyphSelection) {
      return undefined;
    }
    return this.positionedLines[glyphSelection.lineIndex]?.glyphs[
      glyphSelection.glyphIndex
    ];
  }

  getSelectedGlyphName() {
    return this.getSelectedPositionedGlyph()?.glyphName;
  }

  isSelectedGlyphLocked() {
    return !!this.getSelectedPositionedGlyph()?.varGlyph?.glyph.customData[
      "fontra.glyph.locked"
    ];
  }

  async getSelectedVariableGlyphController() {
    if (!this.selectedGlyph) {
      return undefined;
    }
    return await this.fontController.getGlyph(this.getSelectedGlyphName());
  }

  _getSelectedStaticGlyphController() {
    return this.getSelectedPositionedGlyph()?.glyph;
  }

  async getSelectedStaticGlyphController() {
    return await this.getGlyphInstance(
      this.sceneSettings.selectedGlyphName,
      this.sceneSettings.editLayerName
    );
  }

  glyphSelectionToCharacterSelection({ lineIndex, glyphIndex, isEditing }) {
    const line = this.sceneSettings.positionedLines[lineIndex].glyphs;
    const characterIndex = line[glyphIndex].cluster;
    return { lineIndex, characterIndex, isEditing };
  }

  characterSelectionToGlyphSelection({ lineIndex, characterIndex, isEditing }) {
    const line = this.sceneSettings.positionedLines[lineIndex].glyphs;
    let glyphIndex = -1;

    // Not every cluster/character index is guaranteed to exist, for example
    // when f i translates to an fi ligature, then the fi ligature has a single
    // cluster, and we won't find a glyph index for i's character index.
    // In that case we try the previous character index, and on, until we find
    // a match.
    while (glyphIndex === -1 && characterIndex >= 0) {
      glyphIndex = line.findIndex(
        (positionedGlyph) => positionedGlyph.cluster === characterIndex
      );
      characterIndex--;
    }

    if (glyphIndex === -1) {
      glyphIndex = 0; // last resort
    }

    return { lineIndex, glyphIndex, isEditing };
  }

  _resetKerningInstance() {
    delete this._kerningInstance;
  }

  async getKerningInstance(kernTag) {
    if (!this._kerningInstance) {
      const controller = await this.fontController.getKerningController(kernTag);
      if (controller) {
        this._kerningInstance = controller.instantiate(
          this.sceneSettings.fontLocationSourceMapped
        );
      } else {
        this._kerningInstance = { getGlyphPairValue: (leftGlyph, rightGlyph) => null };
      }
    }
    return this._kerningInstance;
  }

  getGlyphLocations(filterShownGlyphs = false) {
    let glyphLocations;
    if (filterShownGlyphs) {
      glyphLocations = {};
      for (const positionedLine of this.positionedLines) {
        for (const glyphInfo of positionedLine.glyphs) {
          if (
            !glyphLocations[glyphInfo.glyphName] &&
            this._glyphLocations[glyphInfo.glyphName]
          ) {
            const glyphLocation = this._glyphLocations[glyphInfo.glyphName];
            if (Object.keys(glyphLocation).length) {
              glyphLocations[glyphInfo.glyphName] =
                this._glyphLocations[glyphInfo.glyphName];
            }
          }
        }
      }
    } else {
      glyphLocations = this._glyphLocations;
    }
    return glyphLocations;
  }

  _syncGlyphLocations() {
    const glyphLocation = this.sceneSettings.glyphLocation;

    const glyphName = this.sceneSettings.selectedGlyphName;
    if (glyphName !== undefined) {
      if (Object.keys(glyphLocation).length) {
        this._glyphLocations[glyphName] = glyphLocation;
      } else {
        delete this._glyphLocations[glyphName];
      }
    }
  }

  _syncLocationFromGlyphName() {
    const glyphName = this.sceneSettings.selectedGlyphName;
    this.sceneSettings.glyphLocation = { ...this._glyphLocations[glyphName] };
  }

  setGlyphLocations(glyphLocations) {
    this._glyphLocations = glyphLocations || {};
  }

  updateGlyphLocations(glyphLocations) {
    this._glyphLocations = { ...this._glyphLocations, ...glyphLocations };
  }

  getTextHorizontalExtents() {
    switch (this.sceneSettings.align) {
      case "left":
        return [0, this.longestLineLength];
      case "center":
        return [-this.longestLineLength / 2, this.longestLineLength / 2];
      case "right":
        return [-this.longestLineLength, 0];
    }
  }

  async updateBackgroundGlyphs() {
    this.backgroundLayerGlyphs = [];
    this.editingLayerGlyphs = [];
    const glyphName = await this.getSelectedGlyphName();
    if (!glyphName) {
      return;
    }
    const varGlyph = await this.fontController.getGlyph(glyphName);
    if (!varGlyph) {
      return;
    }
    this.backgroundLayerGlyphs = await this._setupBackgroundGlyphs(
      glyphName,
      varGlyph,
      this.sceneSettings.backgroundLayers,
      this.sceneSettings.editingLayers
    );
    this.editingLayerGlyphs = await this._setupBackgroundGlyphs(
      glyphName,
      varGlyph,
      this.sceneSettings.editingLayers,
      {}
    );
  }

  async _setupBackgroundGlyphs(glyphName, varGlyph, layers, skipLayers) {
    const layerGlyphs = [];
    for (const [layerName, sourceLocationString] of Object.entries(layers)) {
      if (layerName in skipLayers) {
        continue;
      }
      let layerGlyph;
      if (varGlyph.layers.hasOwnProperty(layerName)) {
        // Proper layer glyph
        let sourceIndex =
          varGlyph.getSourceIndexForSourceLocationString(sourceLocationString) || 0;
        layerGlyph = await this.fontController.getLayerGlyphController(
          glyphName,
          layerName,
          sourceIndex
        );
      } else if (this.fontController.sources.hasOwnProperty(layerName)) {
        // Virtual layer glyph
        const location = this.fontController.sources[layerName].location;
        layerGlyph = await this.fontController.getGlyphInstance(
          glyphName,
          location,
          undefined
        );
      }
      if (layerGlyph) {
        layerGlyphs.push(layerGlyph);
      }
    }
    return layerGlyphs;
  }

  async updateScene() {
    this.updateSceneCancelSignal.shouldCancel = true;
    const cancelSignal = {};
    this.updateSceneCancelSignal = cancelSignal;

    this.updateBackgroundGlyphs();

    this.fontSourceInstance = this.fontController.fontSourcesInstancer.instantiate(
      this.sceneSettings.fontLocationSourceMapped
    );

    // const startTime = performance.now();
    const result = await this.buildScene(cancelSignal);
    if (!result) {
      return;
    }
    // const elapsed = performance.now() - startTime;
    // console.log("buildScene", elapsed);

    if (cancelSignal.shouldCancel) {
      return;
    }

    this.longestLineLength = result.longestLineLength;
    this.sceneSettings.positionedLines = result.positionedLines;

    const usedGlyphNames = getUsedGlyphNames(this.fontController, this.positionedLines);
    const cachedGlyphNames = difference(
      this.fontController.getCachedGlyphNames(),
      usedGlyphNames
    );

    this._adjustSubscriptions(usedGlyphNames, this.usedGlyphNames, true);
    this._adjustSubscriptions(cachedGlyphNames, this.cachedGlyphNames, false);

    this.usedGlyphNames = usedGlyphNames;
    this.cachedGlyphNames = cachedGlyphNames;

    if (
      result.shaperMessages &&
      !objectsEqualSerialized(
        result.shaperMessages,
        this.sceneSettings.shapingDebuggerMessages
      )
    ) {
      const breakIndex = this.sceneSettings.shapingDebuggerBreakIndex;
      if (
        breakIndex != null &&
        !objectsEqualSerialized(
          result.shaperMessages.slice(0, breakIndex + 1),
          this.sceneSettings.shapingDebuggerMessages?.slice(0, breakIndex + 1)
        )
      ) {
        this.sceneSettings.shapingDebuggerBreakIndex = null;
      }
      this.sceneSettings.shapingDebuggerMessages = result.shaperMessages;
    }
  }

  _adjustSubscriptions(currentGlyphNames, previousGlyphNames, wantLiveChanges) {
    if (isEqualSet(currentGlyphNames, previousGlyphNames)) {
      return;
    }
    const unsubscribeGlyphNames = difference(previousGlyphNames, currentGlyphNames);
    const subscribeGlyphNames = difference(currentGlyphNames, previousGlyphNames);
    if (unsubscribeGlyphNames.size) {
      this.fontController.unsubscribeChanges(
        makeGlyphNamesPattern(unsubscribeGlyphNames),
        wantLiveChanges
      );
    }
    if (subscribeGlyphNames.size) {
      this.fontController.subscribeChanges(
        makeGlyphNamesPattern(subscribeGlyphNames),
        wantLiveChanges
      );
    }
  }

  getGlyphSubscriptionPatterns() {
    return {
      subscriptionPattern: makeGlyphNamesPattern(this.cachedGlyphNames),
      liveSubscriptionPattern: makeGlyphNamesPattern(this.usedGlyphNames),
    };
  }

  async buildScene(cancelSignal) {
    const shaper = this.sceneSettings.shaper;
    if (!shaper) {
      return;
    }

    const fallbackCharacterMap = this.sceneSettings.combinedCharacterMap;

    const fontController = this.fontController;

    const characterLines = this.characterLines;
    const {
      lineIndex: selectedLineIndex,
      glyphIndex: selectedGlyphIndex,
      isEditing: selectedGlyphIsEditing,
    } = this.selectedGlyph || {};
    const editLayerName = this.sceneSettings.editLayerName;

    let y = 0;
    const lineDistance = 1.1 * fontController.unitsPerEm; // TODO make factor user-configurable
    const positionedLines = [];
    let longestLineLength = 0;

    const neededGlyphs = [
      ...new Set(
        characterLines
          .map((characterLine) => characterLine.map((glyphInfo) => glyphInfo.glyphName))
          .flat()
      ),
    ];
    if (!fontController.areGlyphsCached(neededGlyphs)) {
      // Pre-load the needed glyphs. loadGlyphs() does this in parallel
      // if possible, so can be a lot faster than requesting the glyphs
      // sequentially.
      await loaderSpinner(fontController.loadGlyphs(neededGlyphs));
    }

    if (cancelSignal.shouldCancel) {
      return;
    }

    const lineSetter = new LineSetter(
      fontController,
      shaper,
      (glyphName, layerName) => this.getGlyphInstance(glyphName, layerName),
      this.sceneSettings.align,
      cancelSignal,
      fallbackCharacterMap
    );

    const featureEntries = Object.entries(this.sceneSettings.featureSettings ?? {});

    const emulatedFeatures = Object.fromEntries(
      featureEntries
        .filter(([k, v]) => v !== undefined && k.endsWith("-emulated"))
        .map(([k, v]) => [k.slice(0, 4), v])
    );

    const nativeFeatures = featureEntries.filter(
      ([k, v]) => v != undefined && !k.endsWith("-emulated")
    );

    const shaperLocation = this.getShaperLocation(
      this.sceneSettings.fontLocationSourceMapped
    );

    const emulateKerning =
      emulatedFeatures["kern"] ?? shaper.emulatedDefaultValues["kern"];
    const kerningInstance = emulateKerning
      ? await this.getKerningInstance("kern")
      : null;
    const kerningPairFunc = kerningInstance
      ? (g1, g2) => kerningInstance.getGlyphPairValue(g1, g2)
      : null;

    const shaperOptions = {
      variations: shaperLocation,
      features: nativeFeatures,
      direction: this.sceneSettings.textDirection,
      script: this.sceneSettings.textScript,
      language: this.sceneSettings.textLanguage,
      emulatedFeatures,
      kerningPairFunc,
      traceBreakIndex: this.sceneSettings.shapingDebuggerBreakIndex,
    };

    let shaperMessages;

    for (const [lineIndex, characterLine] of enumerate(characterLines)) {
      shaperOptions.trace =
        this.sceneSettings.shapingDebuggerEnabled &&
        lineIndex == this.sceneSettings.glyphRenderInfoLineIndex;

      const { positionedLine, shaperMessages: lineShaperMessages } =
        await lineSetter.setLine(
          { x: 0, y },
          characterLine,
          lineIndex == selectedLineIndex ? selectedGlyphIndex : undefined,
          selectedGlyphIsEditing,
          editLayerName,
          shaperOptions
        );

      if (!positionedLine) {
        return;
      }

      longestLineLength = Math.max(longestLineLength, positionedLine.endPoint.x);

      y -= lineDistance;
      positionedLines.push(positionedLine);

      if (lineShaperMessages) {
        assert(!shaperMessages);
        shaperMessages = lineShaperMessages;
      }
    }

    return { longestLineLength, positionedLines, shaperMessages };
  }

  getShaperLocation(sourceLocation) {
    // The shaper font works with user coordinates, but does not do avar mapping,
    // so we want to feed it our fontLocationSourceMapped location, but with user
    // coordinates. We need to filter out discrete axes, as they are not properly
    // supported here yet.

    const nameToTagMapping = Object.fromEntries(
      this.fontController.axes.axes.map((axis) => [axis.name, axis.tag])
    );

    const shaperLocation = unnormalizeLocation(
      normalizeLocation(
        sourceLocation,
        this.fontController.fontAxesSourceSpace.filter((axis) => !axis.values)
      ),
      this.fontController.axes.axes.filter((axis) => !axis.values)
    );

    return mapObjectKeys(shaperLocation, (key) => nameToTagMapping[key]);
  }

  get canEdit() {
    const glyphController = this.getSelectedPositionedGlyph()?.glyph;
    return !!glyphController?.canEdit;
  }

  getLocationForGlyph(glyphName) {
    return {
      ...this.sceneSettings.fontLocationSourceMapped,
      ...this._glyphLocations[glyphName],
    };
  }

  async getGlyphInstance(glyphName, layerName) {
    return await this.fontController.getGlyphInstance(
      glyphName,
      this.getLocationForGlyph(glyphName),
      layerName
    );
  }

  selectionAtPoint(
    point,
    size,
    currentSelection,
    currentHoverSelection,
    preferTCenter
  ) {
    if (!this.selectedGlyph?.isEditing) {
      return { selection: new Set() };
    }

    let selection;

    // First we'll see if the clicked point falls within the current selection
    selection = this._selectionAtPoint(point, size, currentSelection);

    if (selection.selection?.size) {
      return selection;
    }

    // If not, search all items
    selection = this._selectionAtPoint(point, size, undefined);
    if (selection.selection?.size) {
      return selection;
    }

    // Then, look for segment selection (they should *not* participate in the
    // "prefer if it's in the current selection" logic). Skeleton segments
    // first: the centerline is the primary editing target while a skeleton
    // is present, and clicking it selects the segment's two skeleton points,
    // mirroring how regular segment clicks select the two parent points.
    const skeletonSegmentSelection = this.skeletonSegmentSelectionAtPoint(point, size);
    if (skeletonSegmentSelection.size) {
      return { selection: skeletonSegmentSelection, isSegment: true };
    }

    selection = this.segmentSelectionAtPoint(point, size);
    if (selection.pathHit) {
      return selection;
    }

    // Then, look for components (ditto)
    const componentSelection = this.componentSelectionAtPoint(
      point,
      size,
      currentSelection ? union(currentSelection, currentHoverSelection) : undefined,
      preferTCenter
    );
    if (componentSelection.size) {
      return { selection: componentSelection };
    }

    // Lastly, look for background images
    const backgroundImageSelection = this.backgroundImageSelectionAtPoint(point);
    return { selection: backgroundImageSelection };
  }

  _selectionAtPoint(point, size, currentSelection) {
    const parsedCurrentSelection = currentSelection
      ? parseSelection(currentSelection)
      : undefined;

    const anchorSelection = this.anchorSelectionAtPoint(
      point,
      size,
      parsedCurrentSelection
    );
    if (anchorSelection.size) {
      return { selection: anchorSelection };
    }

    const skeletonPointSelection = this.skeletonPointAtPoint(
      point,
      size,
      parsedCurrentSelection
    );
    if (skeletonPointSelection.size) {
      return { selection: skeletonPointSelection };
    }

    const skeletonRibSelection = this.skeletonRibSelectionAtPoint(
      point,
      size,
      parsedCurrentSelection
    );
    if (skeletonRibSelection.size) {
      return { selection: skeletonRibSelection };
    }

    const editableGeneratedTarget = this.editableGeneratedAtPoint(
      point,
      size,
      undefined,
      parsedCurrentSelection
    );
    if (editableGeneratedTarget) {
      return { selection: new Set([editableGeneratedTarget.selectionKey]) };
    }

    const pointSelection = this.pointSelectionAtPoint(
      point,
      size,
      parsedCurrentSelection
    );
    if (pointSelection.size) {
      return { selection: pointSelection };
    }

    const guidelineSelection = this.guidelineSelectionAtPoint(
      point,
      size,
      parsedCurrentSelection
    );
    if (guidelineSelection.size) {
      return { selection: guidelineSelection };
    }

    // TODO: Font Guidelines
    // const fontGuidelineSelection = this.fontGuidelineSelectionAtPoint(point, size);
    // if (fontGuidelineSelection.size) {
    //   return { selection: fontGuidelineSelection };
    // }

    return {};
  }

  pointSelectionAtPoint(point, size, parsedCurrentSelection) {
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };

    // Skeleton-generated contour points are never regular point/N selections:
    // they are only reachable through the editable-generated hit test, which
    // requires the per-point editable flag.
    const generatedPointIndices = this._getGeneratedPointIndices(positionedGlyph);
    const path = positionedGlyph.glyph.path;
    let pointIndex;
    if (parsedCurrentSelection) {
      const currentPointIndices = generatedPointIndices
        ? (parsedCurrentSelection.point || []).filter(
            (index) => !generatedPointIndices.has(index)
          )
        : parsedCurrentSelection.point || [];
      pointIndex = path.pointIndexNearPointFromPointIndices(
        glyphPoint,
        size,
        currentPointIndices
      );
    } else if (!generatedPointIndices) {
      pointIndex = path.pointIndexNearPoint(glyphPoint, size);
    } else {
      const candidateIndices = [];
      for (let i = 0; i < path.numPoints; i++) {
        if (!generatedPointIndices.has(i)) {
          candidateIndices.push(i);
        }
      }
      pointIndex = path.pointIndexNearPointFromPointIndices(
        glyphPoint,
        size,
        candidateIndices
      );
    }
    if (pointIndex !== undefined) {
      return new Set([`point/${pointIndex}`]);
    }

    return new Set();
  }

  // Absolute path point indices of all skeleton-generated contours, or null
  // when the glyph has none. Generated geometry is derived data: it must not
  // be selectable or editable as regular path points.
  _getGeneratedPointIndices(positionedGlyph) {
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.generated?.length) {
      return null;
    }
    const path = positionedGlyph.glyph.path;
    const indices = new Set();
    for (const entry of skeletonData.generated) {
      const contourIndex = entry.pathContourIndex;
      if (
        !Number.isInteger(contourIndex) ||
        contourIndex < 0 ||
        contourIndex >= path.numContours
      ) {
        continue;
      }
      const startIndex = path.getAbsolutePointIndex(contourIndex, 0);
      const numPoints = path.getNumPointsOfContour(contourIndex);
      for (let i = 0; i < numPoints; i++) {
        indices.add(startIndex + i);
      }
    }
    return indices.size ? indices : null;
  }

  _getEditLayerSkeletonData(positionedGlyph) {
    const editLayerName =
      this.sceneSettings?.editLayerName || positionedGlyph.glyph?.layerName;
    const layerGlyph =
      editLayerName && positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph;
    return getSkeletonData(layerGlyph || positionedGlyph.glyph);
  }

  // Whether the given path contour index belongs to a skeleton-generated
  // contour of the selected glyph. Tools that insert/slice path geometry
  // (pen, knife) use this to keep derived contours untouchable.
  isGeneratedPathContour(contourIndex) {
    if (!Number.isInteger(contourIndex)) {
      return false;
    }
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return false;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    return getGeneratedPathContourIndices(skeletonData).has(contourIndex);
  }

  skeletonPointAtPoint(point, size, parsedCurrentSelection) {
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return new Set();
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };

    const isHit = (skeletonPoint) =>
      Math.abs(skeletonPoint.x - glyphPoint.x) <= size &&
      Math.abs(skeletonPoint.y - glyphPoint.y) <= size;

    // Prefer points already in the current selection, matching regular point
    // hit-test behavior (cycles among stacked points).
    const currentKeys = new Set(
      (parsedCurrentSelection?.skeletonPoint || []).map((item) => `${item}`)
    );
    if (currentKeys.size) {
      for (const contour of skeletonData.contours) {
        for (const skeletonPoint of contour.points) {
          if (
            currentKeys.has(`${contour.id}/${skeletonPoint.id}`) &&
            isHit(skeletonPoint)
          ) {
            return new Set([makeSkeletonPointKey(contour.id, skeletonPoint.id)]);
          }
        }
      }
    }

    // Otherwise search all skeleton points in reverse contour/point order.
    for (let ci = skeletonData.contours.length - 1; ci >= 0; ci--) {
      const contour = skeletonData.contours[ci];
      for (let pi = contour.points.length - 1; pi >= 0; pi--) {
        const skeletonPoint = contour.points[pi];
        if (isHit(skeletonPoint)) {
          return new Set([makeSkeletonPointKey(contour.id, skeletonPoint.id)]);
        }
      }
    }

    return new Set();
  }

  editableGeneratedAtPoint(
    point,
    size,
    positionedGlyph = this.getSelectedPositionedGlyph(),
    parsedCurrentSelection = undefined
  ) {
    if (!positionedGlyph) {
      return null;
    }
    // D9: gizmo editing is the default, and dragging a generated handle
    // directly is the opt-out. The two would otherwise compete for the same
    // click - the gizmos sit on and around the very handles this targets - so
    // exactly one of them is live at a time. Neither owns the data: both write
    // the same nudge and handle-offset fields, so the switch loses no work.
    if (
      this.visualizationLayersSettings?.model["fontra.skeleton.generated-tunni"] ===
      true
    ) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.generated?.length) {
      return null;
    }
    const path = positionedGlyph.glyph.path;
    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    const currentPointIndices = this._getEditableGeneratedCurrentPointIndices(
      skeletonData,
      path,
      parsedCurrentSelection
    );
    if (parsedCurrentSelection && !currentPointIndices.length) {
      return null;
    }
    const pointIndex = currentPointIndices.length
      ? path.pointIndexNearPointFromPointIndices(glyphPoint, size, currentPointIndices)
      : path.pointIndexNearPoint(glyphPoint, size);
    if (pointIndex === undefined) {
      return null;
    }
    const target = resolveEditableGeneratedTarget(skeletonData, path, pointIndex);
    if (!target) {
      return null;
    }
    return {
      selectionKey: target.selectionKey,
      kind: target.kind,
      contourId: target.contourId,
      pointId: target.pointId,
      side: target.side,
      role: target.role,
      pathContourIndex: target.pathContourIndex,
      pathPointIndex: target.pathPointIndex,
      point: path.getPoint(pointIndex),
    };
  }

  // Transient readouts shown while a control is being adjusted: rib width for a
  // rib drag, and one per handle for a Tunni drag. Returns an array of
  // { x, y, label, kind } in glyph space (empty when nothing applies).
  //
  // Everything is re-read from live geometry, so the numbers track the drag
  // rather than showing the values captured at mousedown.
  getDragReadouts(positionedGlyph = this.getSelectedPositionedGlyph()) {
    if (!positionedGlyph) {
      return [];
    }
    const curvatureReadout = this._getGeneratedCurvatureDragReadout(positionedGlyph);
    if (curvatureReadout) {
      return [curvatureReadout];
    }
    const baseExpandReadout = this._getBaseExpandDragReadout(positionedGlyph);
    if (baseExpandReadout) {
      return [baseExpandReadout];
    }
    const ribReadout = this._getRibDragReadout(positionedGlyph);
    if (ribReadout) {
      return [ribReadout];
    }
    return this._getTunniDragReadouts(positionedGlyph);
  }

  // The curvature a generated-segment drag is arriving at, beside its gizmo.
  // Suppressed while the label layer is on, which already says the same thing —
  // the same rule the Tunni readouts follow against the native point labels.
  _getGeneratedCurvatureDragReadout(positionedGlyph) {
    const target = this.generatedCurvatureDragTarget;
    if (!target) {
      return null;
    }
    if (
      this.visualizationLayersSettings?.model?.[
        "fontra.skeleton.generated-curvature-labels"
      ]
    ) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    const segment = buildGeneratedTunniSegments(
      skeletonData,
      positionedGlyph.glyph?.path
    ).find(
      (candidate) =>
        candidate.pathContourIndex === target.pathContourIndex &&
        candidate.segmentIndex === target.segmentIndex
    );
    if (!segment) {
      return null;
    }
    const curvature = getGeneratedSegmentCurvature(skeletonData, segment);
    const anchor = calculateCurvatureGizmoPoint(segment.points);
    if (!curvature || !anchor) {
      return null;
    }
    return {
      x: anchor.x,
      y: anchor.y,
      kind: "skeleton",
      label: formatGeneratedCurvature(curvature),
    };
  }

  // How far the base expansion drag has travelled, beside the point under the
  // cursor. Measured against the ghost rather than against the drag's own delta,
  // so it reports what the geometry actually did - the same rule the other
  // readouts follow (re-read from live geometry, not captured at mousedown).
  _getBaseExpandDragReadout(positionedGlyph) {
    if (this.skeletonDragBehaviorName !== BASE_EXPAND_BEHAVIOR_NAME) {
      return null;
    }
    const ghostPath = this.baseExpandGhostPath;
    const pointIndex = this.initialClickedPointIndex;
    const path = positionedGlyph?.glyph?.path;
    if (!ghostPath || !path || pointIndex === undefined) {
      return null;
    }
    const before = ghostPath.getPoint(pointIndex);
    const after = path.getPoint(pointIndex);
    if (!before || !after) {
      return null;
    }
    return {
      x: after.x,
      y: after.y,
      kind: "skeleton",
      label: Math.hypot(after.x - before.x, after.y - before.y).toFixed(1),
    };
  }

  _getRibDragReadout(positionedGlyph) {
    if (!this.initialClickedSkeletonRibKey) {
      return null;
    }
    // The plaque reports a width. A Z-drag slides the rib end along its tangent
    // and changes no width, so during one it would be quoting a number that
    // nothing on screen is editing.
    if (skeletonRibBehaviorIsTangentSlide(this.skeletonDragBehaviorName)) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData) {
      return null;
    }
    for (const target of iterSkeletonRibTargets(skeletonData)) {
      if (
        target.selectionKey !== this.initialClickedSkeletonRibKey ||
        !target.position
      ) {
        continue;
      }
      const address = getSkeletonRibAddress(
        skeletonData,
        target.contourId,
        target.pointId,
        target.side
      );
      if (!address) {
        return null;
      }
      const { point, defaultWidth } = address;
      const left = getSkeletonPointHalfWidth(point, defaultWidth, "left");
      const right = getSkeletonPointHalfWidth(point, defaultWidth, "right");
      return {
        x: target.position.x,
        y: target.position.y,
        kind: "skeleton",
        label: `${getSkeletonPointWidth(point, defaultWidth).toFixed(1)}
L ${left.toFixed(1)}  R ${right.toFixed(1)}`,
      };
    }
    return null;
  }

  // One readout per handle, sitting on that handle and carrying ITS OWN
  // distance and tension (not the segment's) — the same per-handle numbers the
  // native point labels show, which is why this is suppressed while those
  // labels are on: they would be saying the same thing twice.
  _getTunniDragReadouts(positionedGlyph) {
    if (!this.tunniDragTarget) {
      return [];
    }
    if (this.visualizationLayersSettings?.model?.["fontra.point.labels"]) {
      return [];
    }
    const segmentPoints = this._resolveTunniDragSegment(positionedGlyph);
    if (segmentPoints?.length !== 4 || segmentPoints.some((point) => !point)) {
      return [];
    }
    const kind = this.tunniDragTarget.kind === "skeleton" ? "skeleton" : "path";
    const readouts = [];
    for (const [side, handleIndex] of [
      ["start", 1],
      ["end", 2],
    ]) {
      const measure = calculateHandleMeasure(segmentPoints, side);
      if (!measure) {
        continue;
      }
      const handle = segmentPoints[handleIndex];
      readouts.push({
        x: handle.x,
        y: handle.y,
        kind,
        label: `T ${measure.tension.toFixed(2)}
d ${measure.distance.toFixed(1)}`,
      });
    }
    return readouts;
  }

  // Re-read the dragged Tunni segment from live geometry each frame.
  _resolveTunniDragSegment(positionedGlyph) {
    const target = this.tunniDragTarget;
    if (target?.kind === "skeleton") {
      const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
      const contour = (skeletonData?.contours || []).find(
        (candidate) => candidate.id === target.contourId
      );
      if (!contour) {
        return null;
      }
      for (const segment of iterSkeletonCurveSegments(contour)) {
        if (
          segment.startPoint?.id === target.startPointId &&
          segment.endPoint?.id === target.endPointId &&
          segment.offCurvePoints.length === 2
        ) {
          return [
            segment.startPoint,
            segment.offCurvePoints[0],
            segment.offCurvePoints[1],
            segment.endPoint,
          ];
        }
      }
      return null;
    }
    const path = positionedGlyph.glyph?.path;
    const indices = target?.pointIndices;
    if (!path || indices?.length !== 4) {
      return null;
    }
    return indices.map((index) => {
      try {
        return path.getPoint(index);
      } catch {
        return null;
      }
    });
  }

  // Live position of the object that started the current drag, for the
  // drag-crosshair layer. Regular path points, skeleton points/handles, rib
  // endpoints and editable generated points/handles all resolve here, so the
  // layer itself stays render-only. Returns undefined when no drag is active.
  getDragCrosshairPosition(positionedGlyph = this.getSelectedPositionedGlyph()) {
    if (!positionedGlyph) {
      return undefined;
    }
    const path = positionedGlyph.glyph?.path;

    if (this.initialClickedPointIndex !== undefined) {
      return path?.getPoint(this.initialClickedPointIndex);
    }

    // No skeleton drag in progress: don't pay for a skeleton-data lookup on
    // every frame the layer is enabled.
    if (
      !this.initialClickedSkeletonPointKey &&
      !this.initialClickedSkeletonRibKey &&
      !this.initialClickedGeneratedKey
    ) {
      return undefined;
    }

    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData) {
      return undefined;
    }

    if (this.initialClickedSkeletonPointKey) {
      const { contourId, pointId } = parseSkeletonPointKey(
        this.initialClickedSkeletonPointKey
      );
      const address = getSkeletonPointAddress(skeletonData, contourId, pointId);
      return address ? { x: address.point.x, y: address.point.y } : undefined;
    }

    if (this.initialClickedSkeletonRibKey) {
      for (const target of iterSkeletonRibTargets(skeletonData)) {
        if (
          target.selectionKey === this.initialClickedSkeletonRibKey &&
          target.position
        ) {
          return target.position;
        }
      }
      return undefined;
    }

    if (this.initialClickedGeneratedKey && path) {
      const pointIndices = this._getEditableGeneratedCurrentPointIndices(
        skeletonData,
        path,
        parseSelection(new Set([this.initialClickedGeneratedKey]))
      );
      if (pointIndices.length) {
        return path.getPoint(pointIndices[0]);
      }
    }

    return undefined;
  }

  _getEditableGeneratedCurrentPointIndices(skeletonData, path, parsedSelection) {
    const keys = [
      ...(parsedSelection?.editableGeneratedPoint || []).map(
        (item) => `editableGeneratedPoint/${item}`
      ),
      ...(parsedSelection?.editableGeneratedHandle || []).map(
        (item) => `editableGeneratedHandle/${item}`
      ),
    ];
    const pointIndices = [];
    for (const key of keys) {
      let parsed;
      try {
        parsed = key.startsWith("editableGeneratedPoint/")
          ? parseEditableGeneratedPointKey(key)
          : parseEditableGeneratedHandleKey(key);
      } catch {
        continue;
      }
      const address = findGeneratedPathAddress(
        skeletonData,
        parsed.contourId,
        parsed.pointId,
        parsed.side,
        parsed.role
      );
      if (!address) {
        continue;
      }
      try {
        pointIndices.push(
          path.getAbsolutePointIndex(
            address.pathContourIndex,
            address.contourPointIndex
          )
        );
      } catch {
        continue;
      }
    }
    return pointIndices;
  }

  skeletonRibAtPoint(point, size, positionedGlyph = this.getSelectedPositionedGlyph()) {
    if (!positionedGlyph) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return null;
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    const isHit = (ribPoint) =>
      Math.abs(ribPoint.x - glyphPoint.x) <= size &&
      Math.abs(ribPoint.y - glyphPoint.y) <= size;

    for (const target of iterSkeletonRibTargets(skeletonData)) {
      if (target.position && isHit(target.position)) {
        return {
          selectionKey: target.selectionKey,
          contourId: target.contourId,
          pointId: target.pointId,
          side: target.side,
          point: target.position,
          normal: target.normal,
          layerName:
            this.sceneSettings?.editLayerName || positionedGlyph.glyph?.layerName,
        };
      }
    }
    return null;
  }

  skeletonTunniAtPoint(
    point,
    size,
    positionedGlyph = this.getSelectedPositionedGlyph(),
    options = {}
  ) {
    if (!positionedGlyph) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return null;
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    return skeletonTunniHitTest(glyphPoint, size, skeletonData, options);
  }

  // The gizmos on the GENERATED contours, as opposed to skeletonTunniAtPoint,
  // which targets the skeleton itself.
  generatedTunniAtPoint(
    point,
    size,
    positionedGlyph = this.getSelectedPositionedGlyph(),
    options = {}
  ) {
    if (!positionedGlyph?.glyph?.path) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.generated?.length) {
      return null;
    }
    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    return generatedTunniHitTest(
      glyphPoint,
      size,
      skeletonData,
      positionedGlyph.glyph.path,
      options
    );
  }

  skeletonRibSelectionAtPoint(point, size, parsedCurrentSelection) {
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return new Set();
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    const isHit = (ribPoint) =>
      Math.abs(ribPoint.x - glyphPoint.x) <= size &&
      Math.abs(ribPoint.y - glyphPoint.y) <= size;

    const currentKeys = new Set(
      (parsedCurrentSelection?.skeletonRib || []).map((item) => `skeletonRib/${item}`)
    );
    if (currentKeys.size) {
      for (const target of iterSkeletonRibTargets(skeletonData)) {
        if (
          currentKeys.has(target.selectionKey) &&
          target.position &&
          isHit(target.position)
        ) {
          return new Set([target.selectionKey]);
        }
      }
    }

    for (const target of [...iterSkeletonRibTargets(skeletonData)].reverse()) {
      if (target.position && isHit(target.position)) {
        return new Set([target.selectionKey]);
      }
    }
    return new Set();
  }

  segmentSelectionAtPoint(point, size) {
    const pathHit = this.pathHitAtPoint(point, size);
    if (
      pathHit.segment?.parentPoints.every(
        (point) => vector.distance(pathHit, point) > size
      )
    ) {
      const pointIndices = [
        pathHit.segment.parentPointIndices[0],
        pathHit.segment.parentPointIndices.at(-1),
      ];
      // Skeleton-generated contours are derived geometry: their segments are
      // not selectable, just like their points.
      const generatedPointIndices = this._getGeneratedPointIndices(
        this.getSelectedPositionedGlyph()
      );
      if (generatedPointIndices?.has(pointIndices[0])) {
        return { selection: new Set() };
      }
      const selection = new Set(pointIndices.map((i) => `point/${i}`));
      return { selection, pathHit, isSegment: true };
    }
    return { selection: new Set() };
  }

  // Hit-test the skeleton centerline. A hit selects the segment's two
  // on-curve skeleton points (the skeleton counterpart of
  // segmentSelectionAtPoint's `point/N` pair).
  skeletonSegmentSelectionAtPoint(point, size) {
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return new Set();
    }
    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    for (let ci = skeletonData.contours.length - 1; ci >= 0; ci--) {
      const contour = skeletonData.contours[ci];
      for (const segment of iterSkeletonCurveSegments(contour)) {
        if (skeletonSegmentDistance(segment, glyphPoint) <= size) {
          return new Set([
            makeSkeletonPointKey(contour.id, segment.startPoint.id),
            makeSkeletonPointKey(contour.id, segment.endPoint.id),
          ]);
        }
      }
    }
    return new Set();
  }

  // Hit-test the skeleton centerline for measurement. Returns the hit
  // segment's two on-curve endpoints ({ p1, p2 }) in glyph space, or null.
  // Distance/angle only — curve tension is measured by hovering a handle
  // (skeletonHandleAtPoint), matching the path-segment measure.
  skeletonSegmentAtPoint(
    point,
    size,
    positionedGlyph = this.getSelectedPositionedGlyph()
  ) {
    if (!positionedGlyph) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return null;
    }
    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    for (let ci = skeletonData.contours.length - 1; ci >= 0; ci--) {
      const contour = skeletonData.contours[ci];
      for (const segment of iterSkeletonCurveSegments(contour)) {
        if (skeletonSegmentDistance(segment, glyphPoint) <= size) {
          return {
            p1: { x: segment.startPoint.x, y: segment.startPoint.y },
            p2: { x: segment.endPoint.x, y: segment.endPoint.y },
          };
        }
      }
    }
    return null;
  }

  // Hit-test a skeleton off-curve handle for measurement. Returns
  // { p1: handle, p2: anchor, tensionContext } in glyph space, or null.
  // For cubic segments the tension context carries the four segment points
  // and which side is hovered, so calculateHandleMeasure can report tension;
  // for quadratic handles tension is n/a (context is null).
  skeletonHandleAtPoint(
    point,
    size,
    positionedGlyph = this.getSelectedPositionedGlyph()
  ) {
    if (!positionedGlyph) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    if (!skeletonData?.contours?.length) {
      return null;
    }
    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    const within = (pt) =>
      Math.abs(pt.x - glyphPoint.x) <= size && Math.abs(pt.y - glyphPoint.y) <= size;
    const handleTarget = (handle, anchor, tensionContext) => ({
      p1: { x: handle.x, y: handle.y },
      p2: { x: anchor.x, y: anchor.y },
      tensionContext,
    });
    for (let ci = skeletonData.contours.length - 1; ci >= 0; ci--) {
      const contour = skeletonData.contours[ci];
      for (const segment of iterSkeletonCurveSegments(contour)) {
        const { startPoint, endPoint, offCurvePoints } = segment;
        if (offCurvePoints.length === 2) {
          const [cp1, cp2] = offCurvePoints;
          const segmentPoints = [startPoint, cp1, cp2, endPoint].map((pt) => ({
            x: pt.x,
            y: pt.y,
          }));
          if (within(cp1)) {
            return handleTarget(cp1, startPoint, {
              segmentPoints,
              hoveredHandleSide: "start",
            });
          }
          if (within(cp2)) {
            return handleTarget(cp2, endPoint, {
              segmentPoints,
              hoveredHandleSide: "end",
            });
          }
        } else if (offCurvePoints.length === 1) {
          const [cp] = offCurvePoints;
          if (within(cp)) {
            const anchor =
              Math.hypot(cp.x - startPoint.x, cp.y - startPoint.y) <=
              Math.hypot(cp.x - endPoint.x, cp.y - endPoint.y)
                ? startPoint
                : endPoint;
            return handleTarget(cp, anchor, null);
          }
        }
      }
    }
    return null;
  }

  componentSelectionAtPoint(point, size, currentSelection, preferTCenter) {
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }

    let currentSelectedComponentIndices;
    if (currentSelection) {
      const { component, componentOrigin, componentTCenter } =
        parseSelection(currentSelection);
      currentSelectedComponentIndices = new Set([
        ...(component || []),
        ...(componentOrigin || []),
        ...(componentTCenter || []),
      ]);
    }
    const components = positionedGlyph.glyph.components;
    const x = point.x - positionedGlyph.x;
    const y = point.y - positionedGlyph.y;
    const selRect = centeredRect(x, y, size);
    const componentHullMatches = [];
    for (let i = components.length - 1; i >= 0; i--) {
      const component = components[i];
      if (currentSelectedComponentIndices?.has(i)) {
        const compo = component.compo;
        const originMatch = pointInRect(
          compo.transformation.translateX,
          compo.transformation.translateY,
          selRect
        );
        const tCenterMatch = pointInRect(
          compo.transformation.translateX + compo.transformation.tCenterX,
          compo.transformation.translateY + compo.transformation.tCenterY,
          selRect
        );
        if (originMatch || tCenterMatch) {
          const selection = new Set([]);
          if (originMatch && (!tCenterMatch || !preferTCenter)) {
            selection.add(`componentOrigin/${i}`);
          }
          if (tCenterMatch && (!originMatch || preferTCenter)) {
            selection.add(`componentTCenter/${i}`);
          }
          return selection;
        }
      }
      if (
        pointInRect(x, y, component.controlBounds) &&
        this.isPointInPath(component.path2d, x, y)
      ) {
        componentHullMatches.push({ index: i, component: component });
      }
    }
    switch (componentHullMatches.length) {
      case 0:
        return new Set();
      case 1:
        return new Set([`component/${componentHullMatches[0].index}`]);
    }
    // If we have multiple matches, take the first that has an actual
    // point inside the path, and not just inside the hull
    for (const match of componentHullMatches) {
      if (this.isPointInPath(match.component.path2d, x, y)) {
        return new Set([`component/${match.index}`]);
      }
    }
    // Else, fall back to the first match
    return new Set([`component/${componentHullMatches[0].index}`]);
  }

  anchorSelectionAtPoint(point, size, parsedCurrentSelection) {
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }

    const anchors = positionedGlyph.glyph.anchors;
    const x = point.x - positionedGlyph.x;
    const y = point.y - positionedGlyph.y;
    const selRect = centeredRect(x, y, size);
    const indices = parsedCurrentSelection
      ? parsedCurrentSelection.anchor || []
      : [...range(anchors.length)];
    for (const i of reversed(indices)) {
      const anchor = anchors[i];
      if (anchor && pointInRect(anchor.x, anchor.y, selRect)) {
        return new Set([`anchor/${i}`]);
      }
    }
    return new Set([]);
  }

  guidelineSelectionAtPoint(point, size, parsedCurrentSelection) {
    if (!this.visualizationLayersSettings.model["fontra.guidelines"]) {
      // If guidelines are hidden, don't allow selection
      return new Set();
    }
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }

    const guidelines = positionedGlyph.glyph.guidelines;
    const x = point.x - positionedGlyph.x;
    const y = point.y - positionedGlyph.y;
    const indices = parsedCurrentSelection
      ? parsedCurrentSelection.guideline || []
      : [...range(guidelines.length)];
    for (const i of reversed(indices)) {
      const guideline = guidelines[i];
      if (!guideline) {
        continue;
      }
      const angle = (guideline.angle * Math.PI) / 180;
      const distance = Math.abs(
        Math.cos(angle) * (guideline.y - y) - Math.sin(angle) * (guideline.x - x)
      );
      if (distance < size / 2) {
        return new Set([`guideline/${i}`]);
      }
    }
    return new Set([]);
  }

  // TODO: Font Guidelines
  //fontGuidelineSelectionAtPoint(point, size) {
  // }

  backgroundImageSelectionAtPoint(point) {
    return this._backgroundImageSelectionAtPointOrRect(point);
  }

  backgroundImageSelectionAtRect(selRect) {
    return this._backgroundImageSelectionAtPointOrRect(undefined, selRect);
  }

  _backgroundImageSelectionAtPointOrRect(point = undefined, selRect = undefined) {
    if (
      !this.visualizationLayersSettings.model["fontra.background-image"] ||
      this.sceneSettings.backgroundImagesAreLocked
    ) {
      // If background images are hidden or locked, don't allow selection
      return new Set();
    }
    // TODO: If background images are locked don't allow selection

    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return new Set();
    }

    if (point) {
      const x = point.x - positionedGlyph.x;
      const y = point.y - positionedGlyph.y;
      selRect = centeredRect(x, y, 0);
    }

    if (!selRect) {
      return new Set();
    }

    const backgroundImage = positionedGlyph.glyph.backgroundImage;
    if (!backgroundImage) {
      return new Set();
    }

    const affine = decomposedToTransform(backgroundImage.transformation);
    const backgroundImageBounds = this.fontController.getBackgroundImageBounds(
      backgroundImage.identifier
    );
    if (!backgroundImageBounds) {
      return new Set();
    }
    const rectPoly = rectToPoints(backgroundImageBounds);
    const polygon = rectPoly.map((point) => affine.transformPointObject(point));

    if (
      pointInConvexPolygon(selRect.xMin, selRect.yMin, polygon) ||
      rectIntersectsPolygon(selRect, polygon)
    ) {
      return new Set(["backgroundImage/0"]);
    }

    return new Set();
  }

  selectionAtRect(selRect, pointFilterFunc) {
    const selection = new Set();
    if (!this.selectedGlyph?.isEditing) {
      return selection;
    }
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return selection;
    }
    selRect = offsetRect(selRect, -positionedGlyph.x, -positionedGlyph.y);
    const generatedPointIndices = this._getGeneratedPointIndices(positionedGlyph);
    for (const hit of positionedGlyph.glyph.path.iterPointsInRect(selRect)) {
      if (generatedPointIndices?.has(hit.pointIndex)) {
        continue;
      }
      if (!pointFilterFunc || pointFilterFunc(hit)) {
        selection.add(`point/${hit.pointIndex}`);
      }
    }
    const components = positionedGlyph.glyph.components;
    for (let i = 0; i < components.length; i++) {
      if (components[i].intersectsRect(selRect)) {
        selection.add(`component/${i}`);
      }
    }

    const anchors = positionedGlyph.glyph.anchors;
    for (let i = 0; i < anchors.length; i++) {
      if (pointInRect(anchors[i].x, anchors[i].y, selRect)) {
        selection.add(`anchor/${i}`);
      }
    }

    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    for (const contour of skeletonData?.contours || []) {
      for (const skeletonPoint of contour.points) {
        if (pointInRect(skeletonPoint.x, skeletonPoint.y, selRect)) {
          if (!pointFilterFunc || pointFilterFunc(skeletonPoint)) {
            selection.add(makeSkeletonPointKey(contour.id, skeletonPoint.id));
          }
        }
      }
    }

    const backgroundImageSelection = this.backgroundImageSelectionAtRect(selRect);
    if (backgroundImageSelection.size) {
      // As long as we don't have multiple background images,
      // we can just add a single selection
      selection.add("backgroundImage/0");
    }

    // Ribs are marquee-selectable only as a fallback: any other object in
    // the rect (points, skeleton points, anchors, components, background
    // image) takes precedence and drops the rib selection. Alt-marquee
    // (handles only) never selects ribs.
    if (!selection.size && (!pointFilterFunc || pointFilterFunc({}))) {
      for (const target of iterSkeletonRibTargets(skeletonData)) {
        if (
          target.position &&
          pointInRect(target.position.x, target.position.y, selRect)
        ) {
          selection.add(target.selectionKey);
        }
      }
    }

    return selection;
  }

  pathHitAtPoint(point, size) {
    if (!this.selectedGlyph?.isEditing) {
      return {};
    }
    const positionedGlyph = this.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return {};
    }
    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    return positionedGlyph.glyph.pathHitTester.hitTest(glyphPoint, size / 2);
  }

  glyphAtPoint(point, skipEditingGlyph = true) {
    const matches = [];
    for (let i = this.positionedLines.length - 1; i >= 0; i--) {
      const positionedLine = this.positionedLines[i];
      if (
        !positionedLine.bounds ||
        !pointInRect(point.x, point.y, positionedLine.bounds)
      ) {
        continue;
      }
      for (let j = positionedLine.glyphs.length - 1; j >= 0; j--) {
        const positionedGlyph = positionedLine.glyphs[j];
        if (
          !positionedGlyph.bounds ||
          !pointInRect(point.x, point.y, positionedGlyph.bounds)
        ) {
          continue;
        }
        if (
          positionedGlyph.isEmpty ||
          pointInConvexPolygon(
            point.x - positionedGlyph.x,
            point.y - positionedGlyph.y,
            positionedGlyph.glyph.convexHull
          )
        ) {
          if (
            !skipEditingGlyph ||
            !this.selectedGlyph?.isEditing ||
            this.selectedGlyph.lineIndex != i ||
            this.selectedGlyph.glyphIndex != j
          ) {
            matches.push([i, j]);
          }
        }
      }
    }
    let foundGlyph = undefined;
    if (matches.length == 1) {
      const [i, j] = matches[0];
      foundGlyph = { lineIndex: i, glyphIndex: j };
    } else if (matches.length > 1) {
      // The target point is inside the convex hull of multiple glyphs.
      // We prefer the glyph that has the point properly inside, and if
      // that doesn't resolve it we take the glyph with the smallest
      // convex hull area, as that's the one most likely to be hard to
      // hit otherwise.
      // These heuristics should help selecting the glyph intended by the
      // user, regardless of its order in the string.
      const decoratedMatches = matches.map(([i, j]) => {
        const positionedGlyph = this.positionedLines[i].glyphs[j];
        return {
          i: i,
          j: j,
          inside: this.isPointInPath(
            positionedGlyph.glyph.flattenedPath2d,
            point.x - positionedGlyph.x,
            point.y - positionedGlyph.y
          ),
          area: positionedGlyph.glyph.convexHullArea,
        };
      });
      decoratedMatches.sort((a, b) => b.inside - a.inside || a.area - b.area);
      const { i, j } = decoratedMatches[0];
      foundGlyph = { lineIndex: i, glyphIndex: j };
    }
    return foundGlyph;
  }

  lineAtPoint(point) {
    if (!this.positionedLines.length) {
      return;
    }

    const ascender = this.ascender;
    const descender = this.descender;

    for (const [lineIndex, line] of enumerate(this.positionedLines)) {
      if (!line.glyphs.length) {
        continue;
      }
      const firstGlyph = line.glyphs[0];
      const lastGlyph = line.glyphs.at(-1);
      const lastGlyphRight = lastGlyph.x + lastGlyph.glyph.xAdvance;
      const y = line.origin.y;

      const metricsBox = {
        xMin: line.bounds ? Math.min(firstGlyph.x, line.bounds.xMin) : firstGlyph.x,
        yMin: y + descender,
        xMax: line.bounds ? Math.max(lastGlyphRight, line.bounds.xMax) : lastGlyphRight,
        yMax: y + ascender,
      };
      if (!pointInRect(point.x, point.y, metricsBox)) {
        continue;
      }

      return { lineIndex, line };
    }
  }

  sidebearingAtPoint(point, size, previousLineIndex, previousGlyphIndex) {
    const glyphHit = this.glyphAtPoint(point);
    let lineIndex;
    let glyphsToTry;

    if (glyphHit) {
      lineIndex = glyphHit.lineIndex;
      glyphsToTry = [
        [
          glyphHit.glyphIndex,
          this.positionedLines[lineIndex].glyphs[glyphHit.glyphIndex],
        ],
      ];
    } else {
      const lineHit = this.lineAtPoint(point);
      if (!lineHit) {
        return;
      }
      lineIndex = lineHit.lineIndex;
      glyphsToTry = enumerate(lineHit.line.glyphs);
    }

    const matches = [];

    for (const [glyphIndex, positionedGlyph] of glyphsToTry) {
      const glyph = positionedGlyph.glyph;

      const xLeft = positionedGlyph.x;
      const xRight = positionedGlyph.x + glyph.xAdvance;

      const xLeftSB = xLeft + (glyph.leftMargin || 0);
      const xRightSB = xRight - (glyph.rightMargin || 0);

      const [leftZone1, leftZone2] = sorted([xLeft, xLeftSB]);
      const [rightZone1, rightZone2] = sorted([xRight, xRightSB]);

      const middle = (xLeft + xRight) / 2;

      const leftExtra = glyph.leftMargin > 0 ? 0 : size;
      const rightExtra = glyph.rightMargin > 0 ? 0 : size;

      const zonesOverlap = leftZone2 > rightZone1;

      if (
        !zonesOverlap &&
        valueInRange(rightZone1 - size, point.x, rightZone2 + rightExtra)
      ) {
        matches.push({ lineIndex, glyphIndex, metric: "right" });
      } else if (
        !zonesOverlap &&
        valueInRange(leftZone1 - leftExtra, point.x, leftZone2 + size)
      ) {
        matches.push({ lineIndex, glyphIndex, metric: "left" });
      } else if (glyphHit) {
        matches.push({ lineIndex, glyphIndex, metric: "shape" });
      } else if (valueInRange(middle, point.x, xRight)) {
        matches.push({ lineIndex, glyphIndex, metric: "right" });
      } else if (valueInRange(xLeft, point.x, middle)) {
        matches.push({ lineIndex, glyphIndex, metric: "left" });
      }
    }

    if (!matches.length) {
      return;
    }

    const match =
      matches.find(
        (match) =>
          match.lineIndex === previousLineIndex &&
          match.glyphIndex === previousGlyphIndex
      ) || matches[0];

    return match;
  }

  kerningAtPoint(point, size) {
    const result = this.lineAtPoint(point);
    if (!result) {
      return;
    }
    const { lineIndex, line } = result;

    for (let glyphIndex = 1; glyphIndex < line.glyphs.length; glyphIndex++) {
      const positionedGlyph = line.glyphs[glyphIndex];
      const leftPos = positionedGlyph.x;
      const kernRange = [leftPos - positionedGlyph.kernValue, leftPos].sort(
        (a, b) => a - b
      );
      if (valueInRange(kernRange[0] - size, point.x, kernRange[1] + size)) {
        return { lineIndex, glyphIndex };
      }
    }
  }

  get ascender() {
    const lineMetrics = this.fontSourceInstance?.lineMetricsHorizontalLayout;
    return lineMetrics?.ascender?.value || this.fontController.unitsPerEm * 0.8;
  }

  get descender() {
    const lineMetrics = this.fontSourceInstance?.lineMetricsHorizontalLayout;
    return lineMetrics?.descender?.value || this.fontController.unitsPerEm * -0.2;
  }

  getSceneBounds() {
    let bounds = undefined;
    for (const line of this.positionedLines) {
      for (const glyph of line.glyphs) {
        if (!bounds) {
          bounds = glyph.bounds;
        } else if (glyph.bounds) {
          bounds = unionRect(bounds, glyph.bounds);
        }
      }
    }
    return bounds;
  }

  getSelectionBounds(considerSceneBounds = true) {
    if (!this.selectedGlyph) {
      return considerSceneBounds ? this.getSceneBounds() : null;
    }

    let bounds;

    if (this.selectedGlyph?.isEditing && this.selection.size) {
      const positionedGlyph = this.getSelectedPositionedGlyph();
      const [x, y] = [positionedGlyph.x, positionedGlyph.y];
      const instance = this._getSelectedStaticGlyphController();

      bounds = instance.getSelectionBounds(
        this.selection,
        this.fontController.getBackgroundImageBoundsFunc
      );
      if (bounds) {
        bounds = offsetRect(bounds, x, y);
      }
    }

    if (!bounds) {
      const positionedGlyph = this.getSelectedPositionedGlyph();
      bounds = positionedGlyph.bounds;
    }

    if (!bounds) {
      bounds = this.getSceneBounds();
    }

    return bounds;
  }
}

function getUsedGlyphNames(fontController, positionedLines) {
  const usedGlyphNames = new Set();
  for (const line of positionedLines) {
    for (const glyph of line.glyphs) {
      usedGlyphNames.add(glyph.glyph.name);
      updateSet(
        usedGlyphNames,
        fontController.iterGlyphsMadeOfRecursively(glyph.glyph.name)
      );
    }
  }
  return usedGlyphNames;
}

function makeGlyphNamesPattern(glyphNames) {
  const glyphsObj = {};
  for (const glyphName of glyphNames) {
    glyphsObj[glyphName] = null;
  }
  return { glyphs: glyphsObj };
}

function sorted(v) {
  v = [...v];
  v.sort((a, b) => a - b);
  return v;
}

class LineSetter {
  constructor(
    fontController,
    shaper,
    getGlyphInstanceFunc,
    align,
    cancelSignal,
    fallbackCharacterMap
  ) {
    this.fontController = fontController;
    this.shaper = shaper;
    this.getGlyphInstanceFunc = getGlyphInstanceFunc;
    this.align = align;
    this.cancelSignal = cancelSignal;
    this.glyphInstances = {};
    this.fallbackCharacterMap = fallbackCharacterMap;
  }

  async setLine(
    origin,
    characterLine,
    selectedGlyphIndex,
    selectedGlyphIsEditing,
    editLayerName,
    shaperOptions
  ) {
    const fontController = this.fontController;
    const fallbackCharacterMap = this.fallbackCharacterMap;
    const glyphs = [];

    let { x, y } = origin;

    const codePoints = characterLine.map((characterInfo) =>
      characterInfo.character
        ? characterInfo.character.codePointAt(0)
        : this.shaper.getGlyphNameCodePoint(characterInfo.glyphName)
    );

    if (!shaperOptions.direction) {
      const direction = guessDirectionFromCodePoints(codePoints);
      shaperOptions = { ...shaperOptions, direction };
    }

    let {
      glyphs: shapedGlyphs,
      shaperMessages,
      direction,
      requiredGlyphs,
    } = this.shaper.shape(codePoints, this.glyphInstances, shaperOptions);

    let needsReshape = false;
    for (const glyphName of requiredGlyphs) {
      if (!(glyphName in this.glyphInstances) && glyphName in fontController.glyphMap) {
        this.glyphInstances[glyphName] = await this.getGlyphInstanceFunc(glyphName);
        needsReshape = true;
      }
    }

    if (needsReshape) {
      ({
        glyphs: shapedGlyphs,
        shaperMessages,
        direction,
      } = this.shaper.shape(codePoints, this.glyphInstances, shaperOptions));
    }

    for (const [glyphIndex, glyphInfo] of enumerate(shapedGlyphs)) {
      const fallbackCodePoint = codePoints[glyphInfo.cluster];
      const glyphName =
        glyphInfo.codepoint != 0 || fallbackCodePoint >= MAX_UNICODE
          ? glyphInfo.glyphname
          : (fallbackCharacterMap[fallbackCodePoint] ??
            disambiguateGlyphName(
              getSuggestedGlyphName(fallbackCodePoint),
              fontController.glyphMap
            ));

      const isSelectedGlyph = glyphIndex == selectedGlyphIndex;

      const thisGlyphEditLayerName =
        editLayerName && isSelectedGlyph ? editLayerName : undefined;

      const varGlyph = await fontController.getGlyph(glyphName);
      let glyphInstance = thisGlyphEditLayerName
        ? await this.getGlyphInstanceFunc(glyphName, thisGlyphEditLayerName)
        : this.glyphInstances[glyphName];

      const xAdvanceLayerDifference = thisGlyphEditLayerName
        ? glyphInstance.xAdvance - this.glyphInstances[glyphName].xAdvance
        : 0;
      const yAdvanceLayerDifference = 0;

      if (this.cancelSignal.shouldCancel) {
        return {};
      }

      const isUndefined = !glyphInstance;
      if (isUndefined) {
        glyphInstance = fontController.getDummyGlyphInstanceController(glyphName);
      }

      const kernValue =
        (shaperOptions.traceBreakIndex == undefined ||
          shaperMessages?.length == shaperOptions.traceBreakIndex + 1) &&
        shaperOptions.kerningPairFunc &&
        glyphIndex > 0
          ? shaperOptions.kerningPairFunc(
              shapedGlyphs[glyphIndex - 1].glyphname,
              shapedGlyphs[glyphIndex].glyphname
            )
          : 0;

      const codePointForGlyph = isUndefined
        ? null
        : fontController.glyphMap[glyphInfo.glyphname]?.[0];

      const codePoint = isUndefined ? fallbackCodePoint : codePointForGlyph;

      glyphs.push({
        x: x + glyphInfo.xOffset,
        y: y + glyphInfo.yOffset,
        kernValue,
        glyph: glyphInstance,
        varGlyph,
        glyphName,
        character:
          codePoint && codePoint < MAX_UNICODE ? String.fromCodePoint(codePoint) : null,
        cluster: glyphInfo.cluster,
        isUndefined,
        isSelected: isSelectedGlyph,
        isEditing: !!(isSelectedGlyph && selectedGlyphIsEditing),
        isEmpty: !glyphInstance.controlBounds,
        glyphInfo,
      });

      x += glyphInfo.xAdvance + xAdvanceLayerDifference;
      y += glyphInfo.yAdvance + yAdvanceLayerDifference;
    }

    let offset = 0;

    switch (this.align) {
      case "center":
        offset = -x / 2;
        break;
      case "right":
        offset = -x;
        break;
    }

    if (offset) {
      glyphs.forEach((item) => {
        item.x += offset;
      });
    }

    // TODO: use font's ascender/descender values
    addBoundingBoxes(
      glyphs,
      -0.2 * fontController.unitsPerEm,
      0.8 * fontController.unitsPerEm
    );

    const bounds = unionRect(...glyphs.map((glyph) => glyph.bounds));

    const positionedLine = {
      bounds,
      glyphs,
      origin,
      endPoint: { x, y: origin.y },
      direction,
    };
    return { positionedLine, shaperMessages };
  }
}

function addBoundingBoxes(glyphs, descender, ascender) {
  glyphs.forEach((item) => {
    let bounds = item.glyph.controlBounds;
    if (!bounds || isEmptyRect(bounds) || item.glyph.isEmptyIsh) {
      // Empty glyph, make up box based on advance so it can still be clickable/hoverable
      // If the advance is very small, add a bit of extra space on both sides so it'll be
      // clickable even with a zero advance width
      const extraSpace = item.glyph.xAdvance < 30 ? 20 : 0;
      bounds = insetRect(
        normalizeRect({
          xMin: 0,
          yMin: descender,
          xMax: item.glyph.xAdvance,
          yMax: ascender,
        }),
        -extraSpace,
        0
      );
      item.isEmpty = true;
    }
    item.bounds = offsetRect(bounds, item.x, item.y);
    item.unpositionedBounds = bounds;
  });
}

// Enumerate the on-curve-to-on-curve segments of a skeleton contour,
// including the closing segment for closed contours.
function* iterSkeletonCurveSegments(contour) {
  const points = contour.points || [];
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  if (onCurveIndices.length < 2) {
    return;
  }
  const segmentCount = contour.closed
    ? onCurveIndices.length
    : onCurveIndices.length - 1;
  for (let si = 0; si < segmentCount; si++) {
    const startIndex = onCurveIndices[si];
    const endIndex = onCurveIndices[(si + 1) % onCurveIndices.length];
    const offCurvePoints = [];
    let j = (startIndex + 1) % points.length;
    while (j !== endIndex) {
      if (points[j].type) {
        offCurvePoints.push(points[j]);
      }
      j = (j + 1) % points.length;
    }
    yield {
      startPoint: points[startIndex],
      endPoint: points[endIndex],
      offCurvePoints,
    };
  }
}

function distanceToLineSegment(a, b, p) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function skeletonSegmentDistance(segment, p) {
  const { startPoint, endPoint, offCurvePoints } = segment;
  if (!offCurvePoints.length) {
    return distanceToLineSegment(startPoint, endPoint, p);
  }
  const evalPoint =
    offCurvePoints.length === 1
      ? (t) => {
          const u = 1 - t;
          const [c] = offCurvePoints;
          return {
            x: u * u * startPoint.x + 2 * u * t * c.x + t * t * endPoint.x,
            y: u * u * startPoint.y + 2 * u * t * c.y + t * t * endPoint.y,
          };
        }
      : offCurvePoints.length === 2
        ? (t) => {
            const u = 1 - t;
            const [c1, c2] = offCurvePoints;
            return {
              x:
                u * u * u * startPoint.x +
                3 * u * u * t * c1.x +
                3 * u * t * t * c2.x +
                t * t * t * endPoint.x,
              y:
                u * u * u * startPoint.y +
                3 * u * u * t * c1.y +
                3 * u * t * t * c2.y +
                t * t * t * endPoint.y,
            };
          }
        : null;
  if (!evalPoint) {
    // Unexpected off-curve run: approximate with the control polygon
    const polyline = [startPoint, ...offCurvePoints, endPoint];
    let best = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
      best = Math.min(best, distanceToLineSegment(polyline[i], polyline[i + 1], p));
    }
    return best;
  }
  const numSamples = 24;
  let previous = startPoint;
  let best = Infinity;
  for (let i = 1; i <= numSamples; i++) {
    const current = evalPoint(i / numSamples);
    best = Math.min(best, distanceToLineSegment(previous, current, p));
    previous = current;
  }
  return best;
}
