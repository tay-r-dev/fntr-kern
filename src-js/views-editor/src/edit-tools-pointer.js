import { getBaseKeyFromKeyEvent, getShortCuts } from "@fontra/core/actions.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  ChangeCollector,
  applyChange,
  consolidateChanges,
} from "@fontra/core/changes.js";
import { translate } from "@fontra/core/localization.js";
import { connectContours, toggleSmooth } from "@fontra/core/path-functions.js";
import {
  centeredRect,
  normalizeRect,
  offsetRect,
  pointInRect,
  rectSize,
} from "@fontra/core/rectangle.ts";
import {
  difference,
  isSuperset,
  symmetricDifference,
  union,
} from "@fontra/core/set-ops.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { Transform } from "@fontra/core/transform.js";
import {
  assert,
  boolInt,
  commandKeyProperty,
  enumerate,
  isMac,
  modulo,
  parseSelection,
  range,
} from "@fontra/core/utils.ts";
import { copyBackgroundImage, copyComponent } from "@fontra/core/var-glyph.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import * as vector from "@fontra/core/vector.js";
import {
  BASE_EXPAND_BEHAVIOR_NAME,
  createBaseExpandTargetEntries,
  getBaseExpandBehaviorName,
} from "./base-expand-editing.js";
import { EditBehaviorFactory } from "./edit-behavior.js";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import { handlesEqual } from "./edit-tools-pen.js";
import { MeasureInteraction } from "./measure-interactions.js";
import { getPinPoint } from "./panel-transformation.js";
import { equalGlyphSelection } from "./scene-controller.js";
import {
  createEditableGeneratedHandleTargetEntries,
  createEditableGeneratedPointTargetEntries,
  createSkeletonRibTargetEntries,
  getSelectionTargetKinds,
  getSkeletonModifierBehaviorName,
  getSkeletonRibBehaviorName,
  hasSkeletonPointSelection,
  makeSkeletonModifierOptions,
  makeSkeletonPointKey,
  makeSkeletonPointTargetEntry,
  parseSkeletonPointKey,
  toggleEditableGeneratedHandleDetached,
  toggleSkeletonSmooth,
} from "./skeleton-editing.js";
import {
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeRoundNode,
  strokeSquareNode,
} from "./visualization-layer-definitions.js";
// Import Tunni functions for integration with pointer tool
import {
  equalizeSkeletonTunniTensions,
  handleGeneratedTunniCommand,
  handleGeneratedTunniDrag,
  handleSkeletonTunniDrag,
  handleTrueTunniPointMouseDown,
  handleTunniDrag,
  handleTunniPointMouseDown,
  tunniHoverResult,
} from "./tunni-interactions.js";

const transformHandleMargin = 6;
const transformHandleSize = 8;
const rotationHandleSizeFactor = 1.2;
const REALTIME_RIB_TANGENT_ACTION = "action.realtime.rib-tangent";
const REALTIME_FIXED_RIB_ACTION = "action.realtime.fixed-rib";
const REALTIME_FIXED_RIB_COMPRESS_ACTION = "action.realtime.fixed-rib-compress";

const REALTIME_MODIFIER_ACTIONS = [
  {
    action: REALTIME_RIB_TANGENT_ACTION,
    modeProperty: "tangentRibMode",
  },
  {
    action: REALTIME_FIXED_RIB_ACTION,
    modeProperty: "fixedRibMode",
  },
  {
    action: REALTIME_FIXED_RIB_COMPRESS_ACTION,
    modeProperty: "fixedRibCompressMode",
  },
];

function matchEventModifiers(shortCut, event) {
  const expectedModifiers = { ...shortCut };
  if (shortCut.commandKey) {
    expectedModifiers[commandKeyProperty] = true;
  }
  return ["metaKey", "ctrlKey", "shiftKey", "altKey"].every(
    (modifierProp) => !!expectedModifiers[modifierProp] === !!event[modifierProp]
  );
}

function eventMatchesActionShortCut(actionIdentifier, event) {
  const shortCuts = getShortCuts(actionIdentifier);
  if (!shortCuts?.length) return false;
  const baseKey = getBaseKeyFromKeyEvent(event);
  for (const shortCut of shortCuts) {
    if (!shortCut?.baseKey) continue;
    if (shortCut.baseKey !== baseKey) continue;
    if (!matchEventModifiers(shortCut, event)) continue;
    return true;
  }
  return false;
}

function eventMatchesActionBaseKey(actionIdentifier, event) {
  const shortCuts = getShortCuts(actionIdentifier);
  if (!shortCuts?.length) return false;
  const baseKey = getBaseKeyFromKeyEvent(event);
  return shortCuts.some((shortCut) => shortCut?.baseKey === baseKey);
}

export class PointerTools {
  identifier = "pointer-tools";
  subTools = [PointerTool, PointerToolScale];
}

export class PointerTool extends BaseTool {
  iconPath = "/images/pointer.svg";
  identifier = "pointer-tool";

  constructor(...args) {
    super(...args);
    this.measureInteraction = new MeasureInteraction(this);
    this.tangentRibMode = false;
    this.fixedRibMode = false;
    this.fixedRibCompressMode = false;
    this._realtimeModifierKeyUpHandlers = new Map();
    this._boundRealtimeModifierWindowBlur = null;
  }

  handleHover(event) {
    if (this.measureInteraction.handleHover(event)) {
      return;
    }
    const sceneController = this.sceneController;
    const point = sceneController.localPoint(event);
    const size = sceneController.mouseClickMargin;
    const selRect = centeredRect(point.x, point.y, size);
    const { selection, pathHit } = this.sceneModel.selectionAtPoint(
      point,
      size,
      sceneController.selection,
      sceneController.hoverSelection,
      event.altKey
    );

    this.sceneController.sceneModel.showTransformSelection = true;

    let insertHandles = null;

    if (
      this.sceneModel.canEdit &&
      event.altKey &&
      pathHit?.segment.points.length == 2
    ) {
      ({ insertHandles } = this.editor
        .getPenTool()
        .getInsertHandlesFromPathHit(pathHit));

      sceneController.hoverSelection = new Set();
      sceneController.hoverPathHit = undefined;
    } else {
      sceneController.hoverSelection = selection;
      sceneController.hoverPathHit = pathHit;
    }

    if (!handlesEqual(insertHandles, this.sceneModel.pathInsertHandles)) {
      this.sceneModel.pathInsertHandles = insertHandles;
      this.canvasController.requestUpdate();
    }

    if (!sceneController.hoverSelection.size && !sceneController.hoverPathHit) {
      sceneController.hoveredGlyph = this.sceneModel.glyphAtPoint(point);
    } else {
      sceneController.hoveredGlyph = undefined;
    }

    this.sceneController.sceneModel.showTransformSelection = true;

    const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
    if (positionedGlyph) {
      const glyphPoint = {
        x: point.x - positionedGlyph.x,
        y: point.y - positionedGlyph.y,
      };
      const tunni = tunniHoverResult(
        glyphPoint,
        size,
        positionedGlyph,
        this.editor.visualizationLayersSettings,
        this.sceneModel
      );
      if (tunni) {
        this.canvasController.canvas.style.cursor = tunni.cursor;
        return;
      }
    }

    const resizeHandle = this.getResizeHandle(event, sceneController.selection);
    const rotationHandle = !resizeHandle
      ? this.getRotationHandle(event, sceneController.selection)
      : undefined;
    if (this.sceneController.sceneModel.hoverResizeHandle != resizeHandle) {
      this.sceneController.sceneModel.hoverResizeHandle = resizeHandle;
      this.canvasController.requestUpdate();
    }
    if (rotationHandle) {
      this.setCursorForRotationHandle(rotationHandle);
    } else if (resizeHandle) {
      this.setCursorForResizeHandle(resizeHandle);
    } else {
      // Tunni-point hover cursors are handled earlier via tunniHoverResult(),
      // which sets the cursor and returns before reaching this point.
      this.setCursor();
    }
  }

  setCursorForRotationHandle(handleName) {
    this.setCursor(`url('/images/cursor-rotate-${handleName}.svg') 16 16, auto`);
  }

  setCursorForResizeHandle(handleName) {
    if (handleName === "bottom-left" || handleName === "top-right") {
      this.setCursor("nesw-resize");
    } else if (handleName === "bottom-right" || handleName === "top-left") {
      this.setCursor("nwse-resize");
    } else if (handleName === "bottom-center" || handleName === "top-center") {
      this.setCursor("ns-resize");
    } else if (handleName === "middle-left" || handleName === "middle-right") {
      this.setCursor("ew-resize");
    } else {
      this.setCursor();
    }
  }

  setCursor(cursor = undefined) {
    if (cursor) {
      this.canvasController.canvas.style.cursor = cursor;
    } else {
      // Check if Tunni visualization layer is active and if we're hovering over a Tunni point
      // This check is only relevant when called from hover event, so we don't check it here
      // since this method is also called from other contexts
      if (
        this.sceneController.hoverSelection?.size ||
        this.sceneController.hoverPathHit
      ) {
        this.canvasController.canvas.style.cursor = "pointer";
      } else {
        this.canvasController.canvas.style.cursor = "default";
      }
    }
  }

  async handleDrag(eventStream, initialEvent) {
    if (this.measureInteraction.isActive) {
      return;
    }
    if (this.sceneModel.pathInsertHandles) {
      await this.editor.getPenTool().handleInsertHandles();
      return;
    }

    const sceneController = this.sceneController;
    const initialSelection = sceneController.selection;
    const point = sceneController.localPoint(initialEvent);
    const size = sceneController.mouseClickMargin;
    const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
    const isSkeletonTunniLayerActive =
      this.editor.visualizationLayersSettings.model["fontra.skeleton.tunni"];
    const isGeneratedTunniLayerActive =
      this.editor.visualizationLayersSettings.model["fontra.skeleton.generated-tunni"];

    if (initialEvent.ctrlKey && initialEvent.shiftKey && positionedGlyph) {
      const tunniHit = this.sceneModel.skeletonTunniAtPoint(
        point,
        size * 2,
        positionedGlyph,
        { midpointOnly: true }
      );
      if (tunniHit) {
        await equalizeSkeletonTunniTensions({
          sceneController,
          tunniHit,
        });
        return;
      }
    }

    if (isSkeletonTunniLayerActive && positionedGlyph) {
      const skeletonPointSelection = this.sceneModel.skeletonPointAtPoint(
        point,
        size,
        parseSelection(sceneController.selection)
      );
      if (!skeletonPointSelection.size) {
        const tunniHit = this.sceneModel.skeletonTunniAtPoint(
          point,
          size,
          positionedGlyph
        );
        if (tunniHit) {
          this.sceneModel.tunniDragTarget = makeSkeletonTunniDragTarget(tunniHit);
          try {
            await handleSkeletonTunniDrag({
              sceneController,
              eventStream,
              initialEvent,
              tunniHit,
            });
          } finally {
            this.sceneModel.tunniDragTarget = null;
          }
          return;
        }
      }
    }

    // The generated contours' own gizmos. Checked after the skeleton's Tunni
    // gizmos so a skeleton control is never stolen by an outline control lying
    // underneath it, and before path selection so a click on a gizmo does not
    // fall through to selecting the outline point behind it.
    if (isGeneratedTunniLayerActive && positionedGlyph) {
      const gizmoHit = this.sceneModel.generatedTunniAtPoint(
        point,
        size,
        positionedGlyph
      );
      if (gizmoHit) {
        if (initialEvent.detail >= 2) {
          await handleGeneratedTunniCommand({
            sceneController,
            gizmoHit,
            command: "reset",
          });
          return;
        }
        // Equalizing the two handles is a click on the curvature gizmo, so the
        // modifiers must not cost the drag: once the pointer moves this falls
        // through to the ordinary curvature drag. The on-curve gizmo has no
        // modified gesture at all.
        if (
          initialEvent.ctrlKey &&
          initialEvent.shiftKey &&
          gizmoHit.type === "generated-curvature" &&
          !(await shouldInitiateDrag(eventStream, initialEvent))
        ) {
          await handleGeneratedTunniCommand({
            sceneController,
            gizmoHit,
            command: "equalize",
          });
          return;
        }
        // The readout layer re-reads the segment from live geometry each frame,
        // so it shows the curvature the drag is arriving at even when the label
        // layer is switched off.
        this.sceneModel.generatedCurvatureDragTarget =
          gizmoHit.type === "generated-curvature"
            ? makeGeneratedCurvatureDragTarget(gizmoHit)
            : null;
        try {
          await handleGeneratedTunniDrag({
            sceneController,
            eventStream,
            initialEvent,
            gizmoHit,
          });
        } finally {
          this.sceneModel.generatedCurvatureDragTarget = null;
        }
        return;
      }
    }

    const isTunniCombinedLayerActive =
      this.editor.visualizationLayersSettings.model["fontra.tunni.handle"];
    const isTunniActualLayerActive =
      this.editor.visualizationLayersSettings.model["fontra.tunni.point"];
    let tunniInitialState = null;
    let isTrueTunniPoint = false;

    if (isTunniCombinedLayerActive || isTunniActualLayerActive) {
      if (isTunniActualLayerActive) {
        tunniInitialState = handleTrueTunniPointMouseDown(
          initialEvent,
          sceneController,
          this.editor.visualizationLayersSettings
        );
        if (tunniInitialState) {
          isTrueTunniPoint = true;
        }
      }

      if (!tunniInitialState && isTunniCombinedLayerActive) {
        tunniInitialState = handleTunniPointMouseDown(
          initialEvent,
          sceneController,
          this.editor.visualizationLayersSettings
        );
      }
    }

    if (tunniInitialState) {
      this.sceneModel.tunniDragTarget = makePathTunniDragTarget(tunniInitialState);
      try {
        await handleTunniDrag({
          sceneController,
          eventStream,
          initialEvent,
          isTrueTunniPoint,
          tunniInitialState,
        });
      } finally {
        this.sceneModel.tunniDragTarget = null;
      }
      return;
    }

    const resizeHandle = this.getResizeHandle(initialEvent, initialSelection);
    const rotationHandle = this.getRotationHandle(initialEvent, initialSelection);
    if (resizeHandle || rotationHandle) {
      sceneController.sceneModel.clickedTransformSelectionHandle =
        resizeHandle || rotationHandle;
      await this.handleBoundsTransformSelection(
        initialSelection,
        eventStream,
        initialEvent,
        !!rotationHandle
      );
      delete sceneController.sceneModel.clickedTransformSelectionHandle;
      initialEvent.preventDefault();
      return;
    }

    const { selection, pathHit, isSegment } = this.sceneModel.selectionAtPoint(
      point,
      size,
      sceneController.selection,
      sceneController.hoverSelection,
      initialEvent.altKey
    );
    let initialClickedPointIndex;
    let initialClickedSkeletonPointKey;
    let initialClickedSkeletonRibKey;
    let initialClickedGeneratedKey;
    if (!pathHit) {
      const {
        point: pointIndices,
        skeletonPoint,
        skeletonRib,
        editableGeneratedPoint,
        editableGeneratedHandle,
      } = parseSelection(selection);
      if (pointIndices?.length) {
        initialClickedPointIndex = pointIndices[0];
      }
      if (skeletonPoint?.length) {
        const [contourId, pointId] = skeletonPoint[0].split("/").map(Number);
        initialClickedSkeletonPointKey = makeSkeletonPointKey(contourId, pointId);
      }
      if (skeletonRib?.length) {
        initialClickedSkeletonRibKey = `skeletonRib/${skeletonRib[0]}`;
      }
      if (editableGeneratedPoint?.length) {
        initialClickedGeneratedKey = `editableGeneratedPoint/${editableGeneratedPoint[0]}`;
      } else if (editableGeneratedHandle?.length) {
        initialClickedGeneratedKey = `editableGeneratedHandle/${editableGeneratedHandle[0]}`;
      }
    }
    if (initialEvent.detail == 2 || initialEvent.myTapCount == 2) {
      initialEvent.preventDefault(); // don't let our dbl click propagate to other elements
      eventStream.done();
      await this.handleDoubleClick(selection, point, initialEvent);
      return;
    }

    if (!this.sceneSettings.selectedGlyph?.isEditing) {
      this.sceneSettings.selectedGlyph = this.sceneModel.glyphAtPoint(point);
      eventStream.done();
      return;
    }

    let initiateDrag = false;
    let initiateRectSelect = false;

    const modeFunc = getSelectModeFunction(event);
    const newSelection =
      isSegment && modeFunc === symmetricDifference
        ? toggleSegmentSelection(sceneController.selection, selection)
        : modeFunc(sceneController.selection, selection);
    const cleanSel = selection;
    if (
      !selection.size ||
      event.shiftKey ||
      event.altKey ||
      !isSuperset(sceneController.selection, cleanSel)
    ) {
      this._selectionBeforeSingleClick = sceneController.selection;
      sceneController.selection = newSelection;
    }

    if (isSuperset(sceneController.selection, cleanSel)) {
      initiateDrag = true;
    }
    if (!selection.size) {
      initiateRectSelect = true;
    }

    if (initiateRectSelect || initiateDrag) {
      if (!(await shouldInitiateDrag(eventStream, initialEvent))) {
        initiateRectSelect = false;
        initiateDrag = false;
        if (!selection.size) {
          const selectedGlyph = this.sceneModel.glyphAtPoint(point);
          if (
            selectedGlyph &&
            !equalGlyphSelection(selectedGlyph, this.sceneSettings.selectedGlyph)
          ) {
            this.sceneSettings.selectedGlyph = selectedGlyph;
            eventStream.done();
            return;
          }
        }
      }
    }

    sceneController.hoveredGlyph = undefined;
    if (initiateRectSelect) {
      return await this.handleRectSelect(eventStream, initialEvent, initialSelection);
    } else if (initiateDrag) {
      this.sceneController.sceneModel.initialClickedPointIndex =
        initialClickedPointIndex;
      this.sceneController.sceneModel.initialClickedSkeletonPointKey =
        initialClickedSkeletonPointKey;
      this.sceneController.sceneModel.initialClickedSkeletonRibKey =
        initialClickedSkeletonRibKey;
      this.sceneController.sceneModel.initialClickedGeneratedKey =
        initialClickedGeneratedKey;
      const result = await this.handleDragSelection(eventStream, initialEvent);
      delete this.sceneController.sceneModel.initialClickedPointIndex;
      delete this.sceneController.sceneModel.initialClickedSkeletonPointKey;
      delete this.sceneController.sceneModel.initialClickedSkeletonRibKey;
      delete this.sceneController.sceneModel.initialClickedGeneratedKey;
      delete this.sceneController.sceneModel.skeletonDragBehaviorName;
      return result;
    }
  }

  async handleDoubleClick(selection, point, event) {
    const sceneController = this.sceneController;
    if (!sceneController.hoverPathHit && (!selection || !selection.size)) {
      const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
      if (positionedGlyph?.isUndefined) {
        sceneController._dispatchEvent("doubleClickedUndefinedGlyph");
      } else {
        const selectedGlyph = this.sceneModel.glyphAtPoint(point);
        this.sceneSettings.selectedGlyph = selectedGlyph
          ? { ...selectedGlyph, isEditing: true }
          : undefined;
      }
    } else {
      const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;
      const clickedSelection = parseSelection(selection || []);
      if (clickedSelection.editableGeneratedHandle?.length) {
        await this.handleEditableGeneratedHandlesDoubleClick(selection);
        return;
      }
      if (hasSkeletonPointSelection(sceneController.selection)) {
        // Double-click on the centerline itself (no point under the cursor)
        // selects the whole skeleton contour; on a point it toggles smooth.
        const size = sceneController.mouseClickMargin;
        const directPointHit = this.sceneModel.skeletonPointAtPoint(point, size);
        if (!directPointHit.size) {
          const segmentHit = this.sceneModel.skeletonSegmentSelectionAtPoint(
            point,
            size
          );
          if (segmentHit.size) {
            const skeletonData = this.sceneModel._getEditLayerSkeletonData(
              this.sceneModel.getSelectedPositionedGlyph()
            );
            const newSelection = new Set();
            for (const key of segmentHit) {
              const { contourId } = parseSkeletonPointKey(key);
              const contour = skeletonData?.contours?.find(
                (candidate) => candidate.id === contourId
              );
              for (const contourPoint of contour?.points || []) {
                if (!contourPoint.type) {
                  newSelection.add(makeSkeletonPointKey(contourId, contourPoint.id));
                }
              }
            }
            if (newSelection.size) {
              this._selectionBeforeSingleClick = undefined;
              sceneController.selection = newSelection;
              return;
            }
          }
        }
        await this.handleSkeletonPointsDoubleClick();
      }
      const {
        point: pointIndices,
        component: componentIndices,
        anchor: anchorIndices,
        guideline: guidelineIndices,
        // TODO: Font Guidelines
        // fontGuideline: fontGuidelineIndices,
      } = parseSelection(sceneController.selection);
      if (componentIndices?.length && !pointIndices?.length && !anchorIndices?.length) {
        componentIndices.sort();
        sceneController.doubleClickedComponentIndices = componentIndices;
        sceneController._dispatchEvent("doubleClickedComponents");
      } else if (
        anchorIndices?.length &&
        !pointIndices?.length &&
        !componentIndices?.length
      ) {
        anchorIndices.sort();
        sceneController.doubleClickedAnchorIndices = anchorIndices;
        sceneController._dispatchEvent("doubleClickedAnchors");
      } else if (
        guidelineIndices?.length &&
        !pointIndices?.length &&
        !componentIndices?.length
      ) {
        guidelineIndices.sort();
        sceneController.doubleClickedGuidelineIndices = guidelineIndices;
        sceneController._dispatchEvent("doubleClickedGuidelines");
      } else if (pointIndices?.length && !sceneController.hoverPathHit) {
        await this.handlePointsDoubleClick(pointIndices);
      } else if (sceneController.hoverPathHit) {
        const contourIndex = sceneController.hoverPathHit.contourIndex;
        const startPoint = instance.path.getAbsolutePointIndex(contourIndex, 0);
        const endPoint = instance.path.contourInfo[contourIndex].endPoint;
        const newSelection = new Set();
        for (const i of range(startPoint, endPoint + 1)) {
          const pointType = instance.path.pointTypes[i] & VarPackedPath.POINT_TYPE_MASK;
          if (pointType === VarPackedPath.ON_CURVE) {
            newSelection.add(`point/${i}`);
          }
        }
        const selection = this._selectionBeforeSingleClick || sceneController.selection;
        this._selectionBeforeSingleClick = undefined;
        const modeFunc = getSelectModeFunction(event);
        sceneController.selection = modeFunc(selection, newSelection);
      }
    }
  }

  async handleSkeletonPointsDoubleClick() {
    const selection = this.sceneController.selection;
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        toggleSkeletonSmooth(layerGlyph, selection);
      }
      return translate("edit-tools-pointer.undo.toggle-smooth");
    });
  }

  async handleEditableGeneratedHandlesDoubleClick(selection) {
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        toggleEditableGeneratedHandleDetached(layerGlyph, selection);
      }
      return translate("edit-tools-pointer.undo.toggle-smooth");
    });
    this.sceneController.selection = new Set(selection);
  }

  async handlePointsDoubleClick(pointIndices) {
    let newPointType;
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        newPointType = toggleSmooth(layerGlyph.path, pointIndices, newPointType);
      }
      return translate("edit-tools-pointer.undo.toggle-smooth");
    });
  }

  async handleRectSelect(eventStream, initialEvent, initialSelection) {
    const sceneController = this.sceneController;
    const initialPoint = sceneController.localPoint(initialEvent);
    for await (const event of eventStream) {
      const modifierEvent = sceneController.applicationSettings
        .rectSelectLiveModifierKeys
        ? event
        : initialEvent;
      const currentPoint = sceneController.localPoint(event);
      const selRect = normalizeRect({
        xMin: initialPoint.x,
        yMin: initialPoint.y,
        xMax: currentPoint.x,
        yMax: currentPoint.y,
      });
      const selection = this.sceneModel.selectionAtRect(
        selRect,
        modifierEvent.altKey ? (point) => !!point.type : (point) => !point.type
      );
      const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
      sceneController.selectionRect = offsetRect(
        selRect,
        -positionedGlyph.x,
        -positionedGlyph.y
      );

      const modeFunc = getSelectModeFunction(modifierEvent);
      sceneController.selection = modeFunc(initialSelection, selection);
    }
    sceneController.selectionRect = undefined;
    this._selectionBeforeSingleClick = undefined;
  }

  async handleDragSelection(eventStream, initialEvent) {
    this.sceneController.sceneModel.showTransformSelection = false;
    this._selectionBeforeSingleClick = undefined;
    const sceneController = this.sceneController;
    await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const initialPoint = sceneController.selectedGlyphPoint(initialEvent);
      const targetKinds = getSelectionTargetKinds(sceneController.selection);
      const getRealtimeModifiers = () => ({
        fixedRibMode: this.fixedRibMode,
        fixedRibCompressMode: this.fixedRibCompressMode,
        tangentRibMode: this.tangentRibMode,
      });
      const getSelectionBehaviorName = (event) =>
        getSkeletonModifierBehaviorName(event, getRealtimeModifiers(), targetKinds) ||
        getBaseExpandBehaviorName(
          getRealtimeModifiers(),
          targetKinds,
          sceneController.selection
        ) ||
        (hasRibLikeSelection(sceneController.selection)
          ? getSkeletonRibBehaviorName(event, getRealtimeModifiers())
          : hasEditableGeneratedHandleSelection(sceneController.selection)
            ? getGeneratedHandleBehaviorName(event, getRealtimeModifiers())
            : getBehaviorName(event));
      let behaviorName = getSelectionBehaviorName(initialEvent);
      // Published for the drag readouts, which have no route to the realtime
      // modifier state of their own. Updated wherever the behavior is, so a Z
      // pressed or released mid-drag is reflected on the next frame.
      sceneController.sceneModel.skeletonDragBehaviorName = behaviorName;

      // Read the edit layer's skeleton data once; every layer's skeleton target
      // entry resolves selection ids against this single reference by structural
      // ordinal (cross-layer addressing).
      const editingLayers = sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );
      const editLayerName = sceneController.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        editingLayers[editLayerName] || Object.values(editingLayers)[0]
      );
      const makeSkeletonTargetEntries = (layerGlyph, name) => {
        if (name === BASE_EXPAND_BEHAVIOR_NAME) {
          return createBaseExpandTargetEntries(
            layerGlyph,
            sceneController.selection,
            sceneController.sceneModel.initialClickedPointIndex,
            {
              isGeneratedContour: (contourIndex) =>
                this.sceneModel.isGeneratedPathContour(contourIndex),
            }
          );
        }
        const modifierOptions = makeSkeletonModifierOptions(name, {
          referenceSkeletonData,
          clickedSkeletonPointKey:
            sceneController.sceneModel.initialClickedSkeletonPointKey,
        });
        if (hasEditableGeneratedHandleSelection(sceneController.selection)) {
          // Generated geometry is adjustable by default, so the modifier is the
          // safety: only Z (move) and Alt (equalize) reach a generated handle.
          // A plain drag builds no entry and leaves the derived handle alone.
          if (!isGeneratedHandleAdjustBehavior(name)) {
            return [];
          }
          return createEditableGeneratedHandleTargetEntries(
            layerGlyph,
            sceneController.selection,
            name,
            modifierOptions
          );
        }
        // Checked before the rib branch. A rib is the second entry point into
        // the skeleton drag, so under this modifier pair the selection has to
        // route to the skeleton point rather than to the width edit that a rib
        // selection otherwise means.
        if (
          hasRibLikeSelection(sceneController.selection) &&
          name !== "fixed-rib" &&
          name !== "fixed-rib-compress"
        ) {
          const targetEntries = [];
          targetEntries.push(
            ...createSkeletonRibTargetEntries(
              layerGlyph,
              sceneController.selection,
              name,
              {
                ...modifierOptions,
                constrainMode: this.tangentRibMode ? "tangent" : null,
                clickedRibKey: sceneController.sceneModel.initialClickedSkeletonRibKey,
              }
            )
          );
          targetEntries.push(
            ...createEditableGeneratedPointTargetEntries(
              layerGlyph,
              sceneController.selection,
              name,
              {
                ...modifierOptions,
                constrainMode: this.tangentRibMode ? "tangent" : null,
              }
            )
          );
          return targetEntries;
        }
        const entry = makeSkeletonPointTargetEntry(
          layerGlyph,
          sceneController.selection,
          name,
          referenceSkeletonData,
          modifierOptions
        );
        return entry ? [entry] : [];
      };

      const layerInfo = Object.entries(editingLayers).map(([layerName, layerGlyph]) => {
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          sceneController.selection,
          this.scalingEditBehavior,
          { targetEntries: makeSkeletonTargetEntries(layerGlyph, behaviorName) }
        );
        return {
          layerName,
          layerGlyph,
          changePath: ["layers", layerName, "glyph"],
          pathPrefix: [],
          connectDetector: sceneController.getPathConnectDetector(layerGlyph.path),
          shouldConnect: false,
          behaviorFactory,
          editBehavior: behaviorFactory.getBehavior(behaviorName),
        };
      });

      assert(layerInfo.length >= 1, "no layer to edit");

      layerInfo[0].isPrimaryLayer = true;

      this.sceneController.scrollAdjustBehavior = "pin-glyph-origin";
      let editChange;

      for await (const event of eventStream) {
        const newEditBehaviorName = getSelectionBehaviorName(event);
        if (behaviorName !== newEditBehaviorName) {
          // Behavior changed, undo current changes
          behaviorName = newEditBehaviorName;
          sceneController.sceneModel.skeletonDragBehaviorName = behaviorName;
          const rollbackChanges = [];
          for (const layer of layerInfo) {
            applyChange(layer.layerGlyph, layer.editBehavior.rollbackChange);
            rollbackChanges.push(
              consolidateChanges(layer.editBehavior.rollbackChange, layer.changePath)
            );
            // Skeleton target entries bind their behavior at construction and
            // capture the (now rolled-back) original layer state, so rebuild the
            // factory for the new behavior name.
            layer.behaviorFactory = new EditBehaviorFactory(
              layer.layerGlyph,
              sceneController.selection,
              this.scalingEditBehavior,
              {
                targetEntries: makeSkeletonTargetEntries(
                  layer.layerGlyph,
                  behaviorName
                ),
              }
            );
            layer.editBehavior = layer.behaviorFactory.getBehavior(behaviorName);
          }
          await sendIncrementalChange(consolidateChanges(rollbackChanges));
        }
        const currentPoint = sceneController.selectedGlyphPoint(event);
        const delta = {
          x: currentPoint.x - initialPoint.x,
          y: currentPoint.y - initialPoint.y,
        };

        const deepEditChanges = [];
        for (const layer of layerInfo) {
          const editChange = layer.editBehavior.makeChangeForDelta(delta);
          applyChange(layer.layerGlyph, editChange);
          deepEditChanges.push(consolidateChanges(editChange, layer.changePath));
          layer.shouldConnect = layer.connectDetector.shouldConnect(
            layer.isPrimaryLayer
          );
        }

        editChange = consolidateChanges(deepEditChanges);

        await sendIncrementalChange(editChange, true); // true: "may drop"
      }
      let changes = ChangeCollector.fromChanges(
        editChange,
        consolidateChanges(
          layerInfo.map((layer) =>
            consolidateChanges(layer.editBehavior.rollbackChange, layer.changePath)
          )
        )
      );
      let shouldConnect;
      for (const layer of layerInfo) {
        if (!layer.shouldConnect) {
          continue;
        }
        shouldConnect = true;
        if (layer.isPrimaryLayer) {
          layer.connectDetector.clearConnectIndicator();
        }

        const connectChanges = recordChanges(layer.layerGlyph, (layerGlyph) => {
          const selection = connectContours(
            layerGlyph.path,
            layer.connectDetector.connectSourcePointIndex,
            layer.connectDetector.connectTargetPointIndex
          );
          if (layer.isPrimaryLayer) {
            sceneController.selection = selection;
          }
        });
        if (connectChanges.hasChange) {
          changes = changes.concat(connectChanges.prefixed(layer.changePath));
        }
      }
      return {
        undoLabel: shouldConnect
          ? translate("edit-tools-pointer.undo.drag-selection-and-connect-contours")
          : translate("edit-tools-pointer.undo.drag-selection"),
        changes: changes,
        broadcast: true,
      };
    });
    this.sceneController.sceneModel.showTransformSelection = true;
    this.sceneController.scrollAdjustBehavior = null;
  }

  async handleBoundsTransformSelection(
    selection,
    eventStream,
    initialEvent,
    rotation = false
  ) {
    const sceneController = this.sceneController;
    const clickedHandle = sceneController.sceneModel.clickedTransformSelectionHandle;

    // The following may seem wrong, but it's correct, because we say
    // for example bottom-left and not left-bottom. Y-X order.
    const [handlePositionY, handlePositionX] = clickedHandle.split("-");

    const origin = { x: handlePositionX, y: handlePositionY };
    // origin must be the opposite side of where we have our mouse
    if (handlePositionX === "left") {
      origin.x = "right";
    } else if (handlePositionX === "right") {
      origin.x = "left";
    }
    if (handlePositionY === "top") {
      origin.y = "bottom";
    } else if (handlePositionY === "bottom") {
      origin.y = "top";
    }
    // no else because could be middle or center

    // must be set to the opposite side of the mouse if left or bottom
    const fixDragLeftValue = clickedHandle.includes("left") ? -1 : 1;
    const fixDragBottomValue = clickedHandle.includes("bottom") ? -1 : 1;

    const glyphController =
      await sceneController.sceneModel.getSelectedStaticGlyphController();

    // The following is only needed in case of rotation, because we want to have
    // the roation angle for all layers the same and not different.
    let regularPinPointSelectedLayer, altPinPointSelectedLayer;
    if (rotation) {
      const selectedLayerBounds = glyphController.getSelectionBounds(
        selection,
        this.editor.fontController.getBackgroundImageBoundsFunc
      );
      regularPinPointSelectedLayer = getPinPoint(
        selectedLayerBounds,
        origin.x,
        origin.y
      );
      altPinPointSelectedLayer = getPinPoint(selectedLayerBounds, undefined, undefined);
    }

    const staticGlyphControllers = await sceneController.getStaticGlyphControllers();

    await sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const initialPoint = sceneController.selectedGlyphPoint(initialEvent);

      // Skeleton points transform through the same target entry the drag path
      // uses; without it the handles move the path selection only, and a pure
      // skeleton selection gets a bounds box that does nothing. Rib and
      // editable-generated entries have no transform semantics and return null,
      // so only the point entry is built here.
      const editingLayers = sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );
      const editLayerName = sceneController.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        editingLayers[editLayerName] || Object.values(editingLayers)[0]
      );

      const layerInfo = Object.entries(editingLayers).map(([layerName, layerGlyph]) => {
        const skeletonEntry = makeSkeletonPointTargetEntry(
          layerGlyph,
          sceneController.selection,
          "default",
          referenceSkeletonData,
          makeSkeletonModifierOptions("default", { referenceSkeletonData })
        );
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          sceneController.selection,
          this.scalingEditBehavior,
          { targetEntries: skeletonEntry ? [skeletonEntry] : [] }
        );
        const layerBounds = (
          staticGlyphControllers[layerName] || glyphController
        ).getSelectionBounds(
          selection,
          this.editor.fontController.getBackgroundImageBoundsFunc
        );

        return {
          layerName,
          changePath: ["layers", layerName, "glyph"],
          layerGlyph: layerGlyph,
          editBehavior: behaviorFactory.getTransformBehavior("default"),
          regularPinPoint: getPinPoint(layerBounds, origin.x, origin.y),
          altPinPoint: getPinPoint(layerBounds, undefined, undefined),
          regularPinPointSelectedLayer: regularPinPointSelectedLayer,
          altPinPointSelectedLayer: altPinPointSelectedLayer,
          selectionWidth: layerBounds.xMax - layerBounds.xMin,
          selectionHeight: layerBounds.yMax - layerBounds.yMin,
        };
      });

      this.sceneController.scrollAdjustBehavior = "pin-glyph-origin";
      let editChange;

      for await (const event of eventStream) {
        const currentPoint = sceneController.selectedGlyphPoint(event);

        const deepEditChanges = [];
        for (const layer of layerInfo) {
          const layerGlyph = layer.layerGlyph;
          const pinPoint = event.altKey ? layer.altPinPoint : layer.regularPinPoint;
          let transformation;
          if (rotation) {
            // Rotate (based on pinPoint of selected layer)
            this.sceneController.sceneModel.showTransformSelection = false;
            const pinPointSelectedLayer = event.altKey
              ? layer.altPinPointSelectedLayer
              : layer.regularPinPointSelectedLayer;
            const angle = Math.atan2(
              pinPointSelectedLayer.y - currentPoint.y,
              pinPointSelectedLayer.x - currentPoint.x
            );
            const angleInitial = Math.atan2(
              pinPointSelectedLayer.y - initialPoint.y,
              pinPointSelectedLayer.x - initialPoint.x
            );
            // Snap to 45 degrees by rounding to the nearest 45 degree angle if shift is pressed
            const rotationAngle = !event.shiftKey
              ? angle - angleInitial
              : Math.round((angle - angleInitial) / (Math.PI / 4)) * (Math.PI / 4);
            transformation = new Transform().rotate(rotationAngle);
          } else {
            // Scale (based on pinPoint)
            const delta = {
              x: (currentPoint.x - initialPoint.x) * fixDragLeftValue,
              y: (currentPoint.y - initialPoint.y) * fixDragBottomValue,
            };

            let scaleX = (layer.selectionWidth + delta.x) / layer.selectionWidth;
            let scaleY = (layer.selectionHeight + delta.y) / layer.selectionHeight;

            if (clickedHandle.includes("middle")) {
              scaleY = event.shiftKey ? scaleX : 1;
            } else if (clickedHandle.includes("center")) {
              scaleX = event.shiftKey ? scaleY : 1;
            } else if (event.shiftKey) {
              scaleX = scaleY = Math.max(scaleX, scaleY);
            }
            transformation = new Transform().scale(scaleX, scaleY);
          }

          const pinnedTransformation = new Transform()
            .translate(pinPoint.x, pinPoint.y)
            .transform(transformation)
            .translate(-pinPoint.x, -pinPoint.y);

          const editChange =
            layer.editBehavior.makeChangeForTransformation(pinnedTransformation);

          applyChange(layerGlyph, editChange);
          deepEditChanges.push(consolidateChanges(editChange, layer.changePath));
        }

        editChange = consolidateChanges(deepEditChanges);
        await sendIncrementalChange(editChange, true); // true: "may drop"
      }

      let changes = ChangeCollector.fromChanges(
        editChange,
        consolidateChanges(
          layerInfo.map((layer) =>
            consolidateChanges(layer.editBehavior.rollbackChange, layer.changePath)
          )
        )
      );

      return {
        undoLabel: rotation
          ? translate("edit-tools-pointer.undo.rotate-selection")
          : translate("edit-tools-pointer.undo.resize-selection"),
        changes: changes,
        broadcast: true,
      };
    });

    this.sceneController.scrollAdjustBehavior = null;
  }

  getRotationHandle(event, selection) {
    return this.getTransformSelectionHandle(event, selection, true);
  }

  getResizeHandle(event, selection) {
    return this.getTransformSelectionHandle(event, selection);
  }

  getTransformSelectionHandle(event, selection, rotation = false) {
    if (!this.editor.visualizationLayersSettings.model["fontra.transform.selection"]) {
      return undefined;
    }
    if (!selection.size) {
      return undefined;
    }
    const glyph = this.sceneController.sceneModel.getSelectedPositionedGlyph()?.glyph;
    if (!glyph) {
      return undefined;
    }
    const bounds = getTransformSelectionBounds(
      glyph,
      selection,
      this.editor.fontController.getBackgroundImageBoundsFunc
    );
    // bounds can be undefined if for example only one point is selected
    if (!bounds) {
      return undefined;
    }

    const handleSize =
      transformHandleSize * this.editor.visualizationLayers.scaleFactor;
    const handleMargin =
      transformHandleMargin * this.editor.visualizationLayers.scaleFactor;

    const point = this.sceneController.selectedGlyphPoint(event);
    const resizeHandles = getTransformHandles(bounds, handleMargin + handleSize / 2);
    const rotationHandles = rotation
      ? getTransformHandles(
          bounds,
          handleMargin + (handleSize * rotationHandleSizeFactor) / 2 + handleSize / 2
        )
      : {};
    for (const [handleName, handle] of Object.entries(resizeHandles)) {
      const inCircle = pointInCircleHandle(point, handle, handleSize);
      if (rotation) {
        const inSquare = pointInSquareHandle(
          point,
          rotationHandles[handleName],
          handleSize * rotationHandleSizeFactor
        );
        if (inSquare && !inCircle) {
          return handleName;
        }
      } else {
        if (inCircle) {
          return handleName;
        }
      }
    }
    return undefined;
  }

  get scalingEditBehavior() {
    return false;
  }

  handleKeyDown(event) {
    if (this.measureInteraction.handleKeyDown(event)) {
      return;
    }
    if (this._handleRealtimeModifierKeyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab" || !this.sceneSettings.selectedGlyph?.isEditing) {
      return;
    }

    const glyph = this.sceneModel.getSelectedPositionedGlyph()?.glyph;
    if (!glyph) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const selectionTypes = ["point", "component", "anchor", "guideline"];

    const parsedSelection = parseSelection(this.sceneSettings.selection);

    const numItems = {
      point: glyph.path.numPoints,
      component: glyph.components.length,
      anchor: glyph.anchors.length,
      guideline: glyph.guidelines.length,
    };

    const selectionType =
      selectionTypes.find((tp) => parsedSelection[tp]) ??
      selectionTypes.find((tp) => numItems[tp]);

    if (!selectionType) {
      return;
    }

    const currentSelection = parsedSelection[selectionType];
    const currentIndex = currentSelection?.at(event.shiftKey ? 0 : -1);
    const numSelectionItems = numItems[selectionType];
    const delta = event.shiftKey ? -1 : 1;

    const newIndex = currentSelection
      ? event.altKey && selectionType == "point"
        ? // if we are selecting points, and the alt key is pressed,
          // go to the next or previous contour
          glyph.path.getAbsolutePointIndex(
            modulo(
              glyph.path.getContourIndex(currentIndex) + delta,
              glyph.path.numContours
            ),
            event.shiftKey ? -1 : 0
          )
        : modulo(currentIndex + delta, numSelectionItems)
      : event.shiftKey
        ? numSelectionItems - 1
        : 0;

    this.sceneSettings.selection = new Set([`${selectionType}/${newIndex}`]);
  }

  _handleRealtimeModifierKeyDown(event) {
    const modifier = REALTIME_MODIFIER_ACTIONS.find((modifier) =>
      eventMatchesActionShortCut(modifier.action, event)
    );
    if (!modifier) {
      return false;
    }
    if (!this[modifier.modeProperty]) {
      this[modifier.modeProperty] = true;
      const keyUpHandler = (e) => this._handleRealtimeModifierKeyUp(e, modifier.action);
      this._realtimeModifierKeyUpHandlers.set(modifier.action, keyUpHandler);
      window.addEventListener("keyup", keyUpHandler);
      if (!this._boundRealtimeModifierWindowBlur) {
        this._boundRealtimeModifierWindowBlur = () =>
          this._endAllRealtimeModifierModes();
        window.addEventListener("blur", this._boundRealtimeModifierWindowBlur);
      }
      this.canvasController.requestUpdate();
    }
    return true;
  }

  _handleRealtimeModifierKeyUp(event, action) {
    if (eventMatchesActionBaseKey(action, event)) {
      this._endRealtimeModifierMode(action);
    }
  }

  _endRealtimeModifierMode(action) {
    const modifier = REALTIME_MODIFIER_ACTIONS.find(
      (modifier) => modifier.action === action
    );
    if (!modifier || !this[modifier.modeProperty]) {
      return;
    }
    this[modifier.modeProperty] = false;
    const keyUpHandler = this._realtimeModifierKeyUpHandlers.get(action);
    if (keyUpHandler) {
      window.removeEventListener("keyup", keyUpHandler);
      this._realtimeModifierKeyUpHandlers.delete(action);
    }
    this._removeRealtimeModifierBlurHandlerIfIdle();
    this.canvasController.requestUpdate();
  }

  _endAllRealtimeModifierModes() {
    let changed = false;
    for (const modifier of REALTIME_MODIFIER_ACTIONS) {
      if (this[modifier.modeProperty]) {
        this[modifier.modeProperty] = false;
        changed = true;
      }
      const keyUpHandler = this._realtimeModifierKeyUpHandlers.get(modifier.action);
      if (keyUpHandler) {
        window.removeEventListener("keyup", keyUpHandler);
      }
    }
    this._realtimeModifierKeyUpHandlers.clear();
    this._removeRealtimeModifierBlurHandlerIfIdle();
    if (changed) {
      this.canvasController.requestUpdate();
    }
  }

  _removeRealtimeModifierBlurHandlerIfIdle() {
    if (
      this._boundRealtimeModifierWindowBlur &&
      !this._realtimeModifierKeyUpHandlers.size
    ) {
      window.removeEventListener("blur", this._boundRealtimeModifierWindowBlur);
      this._boundRealtimeModifierWindowBlur = null;
    }
  }

  activate() {
    super.activate();
    this.sceneController.sceneModel.showTransformSelection = true;
    this.canvasController.requestUpdate();
  }

  deactivate() {
    super.deactivate();
    this.sceneController.sceneModel.showTransformSelection = false;
    this.canvasController.requestUpdate();
  }
}

function pointInSquareHandle(point, handle, handleSize) {
  const selRect = centeredRect(handle.x, handle.y, handleSize);
  return pointInRect(point.x, point.y, selRect);
}

function pointInCircleHandle(point, handle, handleSize) {
  return vector.distance(handle, point) <= handleSize / 2;
}

function getBehaviorName(event) {
  const behaviorNames = ["default", "constrain", "alternate", "alternate-constrain"];
  return behaviorNames[boolInt(event.shiftKey) + 2 * boolInt(event.altKey)];
}

function hasSkeletonRibSelection(selection) {
  return !!parseSelection([...selection]).skeletonRib?.length;
}

function hasEditableGeneratedPointSelection(selection) {
  return !!parseSelection([...selection]).editableGeneratedPoint?.length;
}

function hasEditableGeneratedHandleSelection(selection) {
  return !!parseSelection([...selection]).editableGeneratedHandle?.length;
}

// Generated handles move only under a modifier (donor side-lock model): Z
// moves the handle, Alt equalizes. The name carries Z so that pressing or
// releasing it mid-drag rebuilds the behavior through the normal path.
function getGeneratedHandleBehaviorName(event, modifiers = {}) {
  if (event?.altKey) {
    return getBehaviorName(event);
  }
  return modifiers.tangentRibMode
    ? "generated-handle-move"
    : "generated-handle-default";
}

function isGeneratedHandleAdjustBehavior(name) {
  return (
    name === "generated-handle-move" ||
    name === "alternate" ||
    name === "alternate-constrain" ||
    name?.startsWith("equalize") === true
  );
}

// Identify the segment under a Tunni drag so the readout layer can re-read it
// from live geometry each frame. Path segments are addressed by their four
// parent point indices, skeleton segments by contour + endpoint ids.
function makePathTunniDragTarget(tunniInitialState) {
  const indices = tunniInitialState?.selectedSegment?.parentPointIndices;
  return indices?.length === 4 ? { kind: "path", pointIndices: [...indices] } : null;
}

function makeSkeletonTunniDragTarget(tunniHit) {
  const contourId = tunniHit?.contourId;
  const startPointId = tunniHit?.segment?.startPoint?.id;
  const endPointId = tunniHit?.segment?.endPoint?.id;
  if (contourId == null || startPointId == null || endPointId == null) {
    return null;
  }
  return { kind: "skeleton", contourId, startPointId, endPointId };
}

// Address the dragged generated segment by its place in the path, so the readout
// can rebuild it from live geometry rather than the snapshot taken at mousedown.
function makeGeneratedCurvatureDragTarget(gizmoHit) {
  const segment = gizmoHit?.segment;
  if (!Number.isInteger(segment?.pathContourIndex)) {
    return null;
  }
  return {
    pathContourIndex: segment.pathContourIndex,
    segmentIndex: segment.segmentIndex,
  };
}

function hasRibLikeSelection(selection) {
  return (
    hasSkeletonRibSelection(selection) || hasEditableGeneratedPointSelection(selection)
  );
}

function replace(setA, setB) {
  return setB;
}

// Shift-clicking a segment toggles the segment as a whole: add its points
// unless all of them are already selected, in which case remove them. Plain
// symmetric difference would deselect the point an adjacent segment shares
// with the segment selected before it.
function toggleSegmentSelection(currentSelection, segmentSelection) {
  return isSuperset(currentSelection, segmentSelection)
    ? difference(currentSelection, segmentSelection)
    : union(currentSelection, segmentSelection);
}

// Adding to a selection is the command key's job, and on this fork that means
// the Mac's command key only. Upstream spells the command key as control on
// Windows, but control is already the coarse-grid modifier during a drag, and
// control with shift is the equalize gesture. Shift on its own still builds a
// selection up on either platform, so nothing is lost by leaving control to the
// grid.
function extendsSelection(event) {
  return isMac ? event.metaKey : false;
}

function getSelectModeFunction(event) {
  return event.shiftKey
    ? extendsSelection(event)
      ? difference
      : symmetricDifference
    : extendsSelection(event)
      ? union
      : replace;
}

registerVisualizationLayerDefinition({
  identifier: "fontra.transform.selection",
  name: "edit-tools-pointer.transform.selection",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 400,
  screenParameters: {
    strokeWidth: 1,
    lineDash: [2, 4],
    handleSize: transformHandleSize,
    hoverStrokeOffset: 4,
    margin: transformHandleMargin,
  },

  colors: { handleColor: "#BBB", strokeColor: "#DDD" },
  colorsDarkMode: { handleColor: "#777", strokeColor: "#555" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    if (!model.showTransformSelection) {
      return;
    }
    const transformBounds = getTransformSelectionBounds(
      positionedGlyph.glyph,
      model.selection,
      model.fontController.getBackgroundImageBoundsFunc
    );
    if (!transformBounds) {
      return;
    }

    context.strokeStyle = parameters.handleColor;
    context.lineWidth = parameters.strokeWidth;

    // The following code is helpful for designing/adjusting the invisible rotation handle areas
    // draw rotation handles
    // const rotationHandles = getTransformHandles(transformBounds, parameters.margin + parameters.handleSize * rotationHandleSizeFactor / 2 + parameters.handleSize / 2);
    // for (const [handleName, handle] of Object.entries(rotationHandles)) {
    //   strokeSquareNode(context, handle, parameters.handleSize * rotationHandleSizeFactor);
    // }

    // draw resize handles
    const handles = getTransformHandles(
      transformBounds,
      parameters.margin + parameters.handleSize / 2
    );
    for (const [handleName, handle] of Object.entries(handles)) {
      strokeRoundNode(context, handle, parameters.handleSize);
    }

    // draw resize handles hover
    if (!model.clickedTransformSelectionHandle && handles[model.hoverResizeHandle]) {
      strokeRoundNode(
        context,
        handles[model.hoverResizeHandle],
        parameters.handleSize + parameters.hoverStrokeOffset
      );
    }

    // because of the dashed line draw resize bounding box last
    context.strokeStyle = parameters.strokeColor;
    context.setLineDash(parameters.lineDash);
    context.strokeRect(
      transformBounds.xMin,
      transformBounds.yMin,
      transformBounds.xMax - transformBounds.xMin,
      transformBounds.yMax - transformBounds.yMin
    );
  },
});

export class PointerToolScale extends PointerTool {
  iconPath = "/images/pointerscale.svg";
  identifier = "pointer-tool-scale";

  get scalingEditBehavior() {
    return true;
  }
}

function getTransformHandles(transformBounds, margin) {
  const { width, height } = rectSize(transformBounds);

  const [x, y, w, h] = [
    transformBounds.xMin - margin,
    transformBounds.yMin - margin,
    transformBounds.xMax - transformBounds.xMin + margin * 2,
    transformBounds.yMax - transformBounds.yMin + margin * 2,
  ];

  const handles = {
    "bottom-left": { x: x, y: y },
    "bottom-center": { x: x + w / 2, y: y },
    "bottom-right": { x: x + w, y: y },
    "top-left": { x: x, y: y + h },
    "top-center": { x: x + w / 2, y: y + h },
    "top-right": { x: x + w, y: y + h },
    "middle-left": { x: x, y: y + h / 2 },
    "middle-right": { x: x + w, y: y + h / 2 },
  };

  if (width != 0 && height != 0) {
    return handles;
  }

  for (const handleName of Object.keys(handles)) {
    if (width == 0 && handleName != "top-center" && handleName != "bottom-center") {
      delete handles[handleName];
    }
    if (height == 0 && handleName != "middle-left" && handleName != "middle-right") {
      delete handles[handleName];
    }
  }

  return handles;
}

function getTransformSelectionBounds(glyph, selection, getBackgroundImageBoundsFunc) {
  if (selection.size == 1 && parseSelection(selection).point?.length == 1) {
    // Return if only a single point is selected, as in that case the "selection bounds"
    // is not really useful for the user, and is distracting instead.
    return undefined;
  }
  const selectionBounds = glyph.getSelectionBounds(
    selection,
    getBackgroundImageBoundsFunc
  );
  if (!selectionBounds) {
    return undefined;
  }
  const { width, height } = rectSize(selectionBounds);
  if (width == 0 && height == 0) {
    // return undefined if for example only one point is selected
    return undefined;
  }

  return selectionBounds;
}
