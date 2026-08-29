import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  ChangeCollector,
  applyChange,
  consolidateChanges,
} from "@fontra/core/changes.js";
import { translate } from "@fontra/core/localization.js";
import { insertHandles, insertPoint, scalePoint } from "@fontra/core/path-functions.js";
import { isEqualSet } from "@fontra/core/set-ops.js";
import { modulo, parseSelection } from "@fontra/core/utils.ts";
import { VarPackedPath } from "@fontra/core/var-path.js";
import * as vector from "@fontra/core/vector.js";
import { constrainHorVerDiag } from "./edit-behavior.js";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import { recordSkeletonContourIndexShift } from "./skeleton-editing.js";

import { SnappingSession } from "./snapping-interactions.js";

export class PenTool {
  identifier = "pen-tool";
  subTools = [PenToolCubic, PenToolQuad];
}

export class PenToolCubic extends BaseTool {
  iconPath = "/images/pointeradd.svg";
  identifier = "pen-tool-cubic";

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.setCursor();
    // The preview must show the result before the click, so the hover resolves
    // through the same session the click will use. The scene is re-read first:
    // the pen adds geometry as it goes, and a point just placed is a source.
    const snapSession = this._snapSession();
    snapSession.refresh();
    this.sceneModel.penSnappedPoint = snapSession.resolve(
      this.sceneController.selectedGlyphPoint(event)
    );
    // The hover redraw below fires only when the connect target changes, so the
    // snap draw needs its own. Without it the guide appears only where some other
    // hover state happens to change, which reads as snapping over geometry alone.
    const snapState = JSON.stringify([
      this.sceneModel.snapHeldCandidates?.map((c) => [c.kind, c.x, c.y, c.dx, c.dy]),
      this.sceneModel.snapIndicator,
    ]);
    if (snapState !== this._lastSnapState) {
      this._lastSnapState = snapState;
      this.canvasController.requestUpdate();
    }
    const {
      insertHandles,
      targetPoint,
      danglingOffCurve,
      canDragOffCurve,
      inertPoint,
      resumePoint,
    } = this._getPathConnectTargetPoint(event);
    const prevInsertHandles = this.sceneModel.pathInsertHandles;
    const prevTargetPoint = this.sceneModel.pathConnectTargetPoint;
    const prevDanglingOffCurve = this.sceneModel.pathDanglingOffCurve;
    const prevCanDragOffCurve = this.sceneModel.pathCanDragOffCurve;
    const prevInertPoint = this.sceneModel.pathInertPoint;
    const prevResumePoint = this.sceneModel.pathResumePoint;

    if (
      !handlesEqual(insertHandles, prevInsertHandles) ||
      !pointsEqual(targetPoint, prevTargetPoint) ||
      !pointsEqual(danglingOffCurve, prevDanglingOffCurve) ||
      !pointsEqual(canDragOffCurve, prevCanDragOffCurve) ||
      !pointsEqual(inertPoint, prevInertPoint) ||
      !pointsEqual(resumePoint, prevResumePoint)
    ) {
      this.sceneModel.pathInsertHandles = insertHandles;
      this.sceneModel.pathConnectTargetPoint = targetPoint;
      this.sceneModel.pathDanglingOffCurve = danglingOffCurve;
      this.sceneModel.pathCanDragOffCurve = canDragOffCurve;
      this.sceneModel.pathInertPoint = inertPoint;
      this.sceneModel.pathResumePoint = resumePoint;
      this.canvasController.requestUpdate();
    }
  }

  get curveType() {
    return "cubic";
  }

  deactivate() {
    super.deactivate();
    this._resetHover();
    this.canvasController.requestUpdate();
  }

  // The pen appends to whichever contour endpoint is selected, so dropping the
  // selection is what ends the contour: the next click starts a new one. This
  // touches no glyph data, so there is nothing to undo. A pen never opens the
  // canvas context menu, drawing or not, so the gesture is always consumed.
  handleContextMenu(event) {
    this.sceneController.selection = new Set();
    this._resetHover();
    this.canvasController.requestUpdate();
    return true;
  }

  // One session for the length of the hover, rebuilt when the glyph changes.
  // Nothing is excluded: the point being placed is not in the path yet, and the
  // previous point of the chain is the most useful source there (spec section 6).
  _snapSession() {
    const glyphName = this.sceneModel.selectedGlyph?.glyphName;
    if (!this._snapping || this._snappingGlyph !== glyphName) {
      this._snapping = new SnappingSession(this.sceneController, {
        excludePointIndices: [],
      });
      this._snappingGlyph = glyphName;
    }
    return this._snapping;
  }

  _resetHover() {
    this._snapping?.end();
    this._snapping = null;
    this._lastSnapState = undefined;
    delete this.sceneModel.penSnappedPoint;
    delete this.sceneModel.pathInsertHandles;
    delete this.sceneModel.pathConnectTargetPoint;
    delete this.sceneModel.pathDanglingOffCurve;
    delete this.sceneModel.pathCanDragOffCurve;
    delete this.sceneModel.pathInertPoint;
    delete this.sceneModel.pathResumePoint;
  }

  setCursor() {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].setCursor();
    } else {
      this.canvasController.canvas.style.cursor = "crosshair";
    }
  }

  _getPathConnectTargetPoint(event) {
    // Requirements:
    // - we must have an edited glyph at an editable location
    // - we must be in append/prepend mode for an existing contour
    // - the hovered point must be eligible to connect to:
    //   - must be a start or end point of an open contour
    //   - must not be the currently selected point

    const hoveredPointIndex = getHoveredPointIndex(this.sceneController, event);

    const glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
    if (!glyphController.canEdit) {
      return {};
    }
    const path = glyphController.instance.path;

    const appendInfo = getAppendInfo(path, this.sceneController.selection);
    if (hoveredPointIndex === undefined && appendInfo.createContour) {
      const point = this.sceneController.localPoint(event);
      // The following max() call makes sure that the margin is never
      // less than half a font unit. This works around a visualization
      // artifact caused by bezier-js: Bezier.project() returns t values
      // with a max precision of 0.001.
      const size = Math.max(1, this.sceneController.mouseClickMargin);
      let hit = this.sceneModel.pathHitAtPoint(point, size);
      if (this.sceneModel.isGeneratedPathContour(hit.contourIndex)) {
        // Skeleton-generated contours are derived geometry: the pen must not
        // insert points or handles into them. Treat the hover as empty canvas.
        hit = {};
      }
      if (event.altKey && hit.segment?.points?.length === 2) {
        return this.getInsertHandlesFromPathHit(hit, event);
      } else {
        const targetPoint = { ...hit };
        if ("x" in targetPoint) {
          // Don't use vector.roundVector, as there are more properties besides
          // x and y, and we want to preserve them
          targetPoint.x = Math.round(targetPoint.x);
          targetPoint.y = Math.round(targetPoint.y);
        }
        return { targetPoint: targetPoint };
      }
    }

    if (hoveredPointIndex === undefined || appendInfo.createContour) {
      if (hoveredPointIndex === undefined) {
        return {};
      }
      // Nothing is being drawn. An end of an open contour is picked up by a
      // click, and drawing resumes from it; anything else is inert, because a
      // click adds a point where it lands and leaves that one alone.
      const point = path.getPoint(hoveredPointIndex);
      return this._canResumeFrom(path, hoveredPointIndex)
        ? { resumePoint: point }
        : { inertPoint: point };
    }

    const [contourIndex, contourPointIndex] =
      path.getContourAndPointIndex(hoveredPointIndex);
    const contourInfo = path.contourInfo[contourIndex];

    if (
      appendInfo.contourIndex == contourIndex &&
      appendInfo.contourPointIndex == contourPointIndex
    ) {
      // We're hovering over the source point
      const point = path.getPoint(hoveredPointIndex);
      if (!appendInfo.isOnCurve) {
        return { danglingOffCurve: point };
      } else {
        return { canDragOffCurve: point };
      }
    }

    if (
      contourInfo.isClosed ||
      (contourPointIndex != 0 && hoveredPointIndex != contourInfo.endPoint) ||
      // Skeleton-generated contours are derived geometry: the pen never joins to
      // one, the same way it never inserts into one above.
      this.sceneModel.isGeneratedPathContour(contourIndex)
    ) {
      // Only an end of an open contour can be connected to. Anything else is
      // inert: a click adds a point where it lands and leaves this one alone.
      return { inertPoint: path.getPoint(hoveredPointIndex) };
    }
    return { targetPoint: path.getPoint(hoveredPointIndex) };
  }

  // A click here picks the point up rather than starting a new contour. Not on
  // generated geometry: the pen never edits a skeleton's outline.
  _canResumeFrom(path, pointIndex) {
    if (!isResumablePointIndex(path, pointIndex)) {
      return false;
    }
    const [contourIndex] = path.getContourAndPointIndex(pointIndex);
    return !this.sceneModel.isGeneratedPathContour(contourIndex);
  }

  getInsertHandlesFromPathHit(hit, event) {
    const pt1 = hit.segment.points[0];
    const pt2 = hit.segment.points[1];
    const handle1 = vector.roundVector(vector.interpolateVectors(pt1, pt2, 1 / 3));
    const handle2 = vector.roundVector(vector.interpolateVectors(pt1, pt2, 2 / 3));
    return { insertHandles: { points: [handle1, handle2], hit: hit } };
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }

    if (this.sceneModel.pathConnectTargetPoint?.segment) {
      await this._handleInsertPoint();
    } else if (this.sceneModel.pathInsertHandles) {
      await this.handleInsertHandles();
    } else if (this._handleResumeFromPoint(initialEvent)) {
      eventStream.done();
    } else {
      this._resetHover();
      await this._handleAddPoints(eventStream, initialEvent);
    }
  }

  // Clicking an end of an open contour while nothing is being drawn selects it,
  // so the next click extends that contour. Without this the click started a
  // new contour on top of the point instead. Selection only: no glyph data
  // changes, so there is nothing to undo. Returns whether it took the click.
  _handleResumeFromPoint(event) {
    const glyphController = this.sceneModel.getSelectedPositionedGlyph()?.glyph;
    if (!glyphController?.canEdit) {
      return false;
    }
    const path = glyphController.instance.path;
    if (!getAppendInfo(path, this.sceneController.selection).createContour) {
      // Already drawing: the connect and insert paths above own this click.
      return false;
    }
    const hoveredPointIndex = getHoveredPointIndex(this.sceneController, event);
    if (!this._canResumeFrom(path, hoveredPointIndex)) {
      return false;
    }
    this.sceneController.selection = new Set([`point/${hoveredPointIndex}`]);
    this._resetHover();
    this.canvasController.requestUpdate();
    return true;
  }

  async _handleInsertPoint() {
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      const selection = new Set();
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const { numPointsInserted, selectedPointIndices } = insertPoint(
          layerGlyph.path,
          this.sceneModel.pathConnectTargetPoint
        );
        selection.add(`point/${selectedPointIndices[0]}`);
      }
      delete this.sceneModel.pathConnectTargetPoint;
      this.sceneController.selection = selection;
      return translate("edit-tools-pen.undo.insert-point");
    });
  }

  async handleInsertHandles() {
    const segmentPointIndices =
      this.sceneModel.pathInsertHandles.hit.segment.pointIndices;
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      let selection;
      for (const layerGlyph of Object.values(layerGlyphs)) {
        const path = layerGlyph.path;
        selection = insertHandles(
          path,
          segmentPointIndices.map((i) => path.getPoint(i)),
          segmentPointIndices[1],
          //// quad handles
          this.curveType,
          this.sceneModel.pathInsertHandles.shiftKey
        );
      }
      delete this.sceneModel.pathInsertHandles;
      this.sceneController.selection = selection;
      return translate("edit-tools-pen.undo.insert-handles");
    });
  }

  async _handleAddPoints(eventStream, initialEvent) {
    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const layerInfo = Object.entries(
        this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
      ).map(([layerName, layerGlyph]) => {
        return {
          layerName,
          layerGlyph,
          behavior: getPenToolBehavior(
            this.sceneController,
            initialEvent,
            layerGlyph.path,
            this.curveType,
            this._snapSession()
          ),
        };
      });

      const primaryBehavior = layerInfo[0].behavior;

      if (!primaryBehavior) {
        // Nothing to do
        return;
      }

      const initialChanges = recordLayerChanges(layerInfo, (behavior, layerGlyph) => {
        behavior.initialChanges(layerGlyph.path, initialEvent);
        if (behavior.context.generatedIndexShift) {
          const { startIndex, delta } = behavior.context.generatedIndexShift;
          recordSkeletonContourIndexShift(layerGlyph, startIndex, delta);
        }
      });
      this.sceneController.selection = primaryBehavior.selection;
      await sendIncrementalChange(initialChanges.change);
      let preDragChanges = new ChangeCollector();
      let dragChanges = new ChangeCollector();

      if (await shouldInitiateDrag(eventStream, initialEvent)) {
        preDragChanges = recordLayerChanges(layerInfo, (behavior, layerGlyph) => {
          behavior.setupDrag(layerGlyph.path, initialEvent);
        });
        this.sceneController.selection = primaryBehavior.selection;
        await sendIncrementalChange(preDragChanges.change);
        for await (const event of eventStream) {
          dragChanges = recordLayerChanges(layerInfo, (behavior, layerGlyph) => {
            behavior.drag(layerGlyph.path, event);
          });
          await sendIncrementalChange(dragChanges.change, true); // true: "may drop"
        }
      } else {
        dragChanges = recordLayerChanges(layerInfo, (behavior, layerGlyph) => {
          behavior.noDrag(layerGlyph.path);
        });
        this.sceneController.selection = primaryBehavior.selection;
      }
      await sendIncrementalChange(dragChanges.change);

      const finalChanges = initialChanges.concat(preDragChanges, dragChanges);

      return {
        changes: finalChanges,
        undoLabel: primaryBehavior.undoLabel,
      };
    });
  }
}

export class PenToolQuad extends PenToolCubic {
  iconPath = "/images/pointeraddquad.svg";
  identifier = "pen-tool-quad";

  get curveType() {
    return "quad";
  }

  // The only thing the quadratic pen does differently on hover: Alt inserts one
  // handle at the midpoint, and Alt-Shift inserts the cubic pair. Everything
  // else about the connect target is the same, so it stays in one place above.
  getInsertHandlesFromPathHit(hit, event) {
    const pt1 = hit.segment.points[0];
    const pt2 = hit.segment.points[1];
    if (event.shiftKey) {
      const handle1 = vector.roundVector(vector.interpolateVectors(pt1, pt2, 1 / 3));
      const handle2 = vector.roundVector(vector.interpolateVectors(pt1, pt2, 2 / 3));
      return {
        insertHandles: { points: [handle1, handle2], hit: hit, shiftKey: true },
      };
    }
    const handle = vector.roundVector(vector.interpolateVectors(pt1, pt2, 0.5));
    return { insertHandles: { points: [handle], hit: hit, shiftKey: false } };
  }
}

const AppendModes = {
  APPEND: "append",
  PREPEND: "prepend",
};

function getPenToolBehavior(
  sceneController,
  initialEvent,
  path,
  curveType,
  snapSession
) {
  const appendInfo = getAppendInfo(path, sceneController.selection);

  let behaviorFuncs;

  if (appendInfo.createContour) {
    // Let's add a new contour
    behaviorFuncs = {
      setup: [insertContourAndSetupAnchorPoint, insertAnchorPoint],
      setupDrag: insertHandleOut,
      drag: dragHandle,
    };
  } else {
    behaviorFuncs = {
      setup: [setupAnchorPoint, insertAnchorPoint],
      setupDrag: appendInfo.isOnCurve ? insertHandleOut : insertHandleInOut,
      drag: dragHandle,
      noDrag: ensureCubicOffCurves,
    };

    const selectedPoint = path.getContourPoint(
      appendInfo.contourIndex,
      appendInfo.contourPointIndex
    );
    const clickedSelection = sceneController.sceneModel.pointSelectionAtPoint(
      sceneController.localPoint(initialEvent),
      sceneController.mouseClickMargin
    );
    if (isEqualSet(clickedSelection, sceneController.selection)) {
      // We clicked on the selected point
      if (selectedPoint.type) {
        // off-curve
        if (path.getNumPointsOfContour(appendInfo.contourIndex) < 2) {
          // Contour is a single off-curve point, let's not touch it
          return null;
        }
        behaviorFuncs = { setup: [deleteHandle] };
      } else {
        // on-curve
        behaviorFuncs = {
          setup: [setupExistingAnchorPoint],
          setupDrag: insertHandleOut,
          drag: dragHandle,
          noDrag: clickOnCurveNoDragSetSelection,
        };
      }
    } else if (clickedSelection.size === 1) {
      const { point: pointSelection } = parseSelection(clickedSelection);
      const pointIndex = pointSelection[0];
      if (pointIndex !== undefined) {
        const [clickedContourIndex, clickedContourPointIndex] =
          path.getContourAndPointIndex(pointIndex);
        const numClickedContourPoints = path.getNumPointsOfContour(clickedContourIndex);
        if (
          clickedContourPointIndex === 0 ||
          clickedContourPointIndex === numClickedContourPoints - 1
        ) {
          const clickedPoint = path.getContourPoint(
            clickedContourIndex,
            clickedContourPointIndex
          );
          if (clickedContourIndex === appendInfo.contourIndex) {
            // Close the current contour
            behaviorFuncs = { setup: [closeContour], noDrag: ensureCubicOffCurves };
          } else {
            // Connect to other open contour
            appendInfo.targetContourIndex = clickedContourIndex;
            appendInfo.targetContourPointIndex = clickedContourPointIndex;
            behaviorFuncs = { setup: [connectToContour], noDrag: ensureCubicOffCurves };
          }
          if (!clickedPoint.type && selectedPoint.type) {
            behaviorFuncs.setupDrag = insertHandleIn;
            behaviorFuncs.drag = dragHandle;
          }
        }
      }
    }
  }

  // The one place the pen turns an event into a position, so the click and the
  // preview cannot disagree. One point is placed, so this is resolve, not
  // resolveSet: there is no set to choose from.
  const getPointFromEvent = (event) =>
    snapSession
      ? snapSession.resolve(sceneController.selectedGlyphPoint(event))
      : sceneController.selectedGlyphPoint(event);

  return new PenToolBehavior(getPointFromEvent, appendInfo, behaviorFuncs, curveType);
}

class PenToolBehavior {
  undoLabel = translate("edit-tools-pen.undo.add-points");

  constructor(getPointFromEvent, appendInfo, behaviorFuncs, curveType) {
    this.getPointFromEvent = getPointFromEvent;
    this.context = { ...appendInfo };
    this.context.curveType = curveType;
    this.context.appendBias = this.context.appendMode === AppendModes.APPEND ? 1 : 0;
    this.context.prependBias = this.context.appendMode === AppendModes.PREPEND ? 1 : 0;
    this.context.appendDirection =
      this.context.appendMode === AppendModes.APPEND ? +1 : -1;
    this.behaviorFuncs = behaviorFuncs;
  }

  get selection() {
    return this.context.selection || new Set();
  }

  initialChanges(path, event) {
    const point = this.getPointFromEvent(event);
    for (const func of this.behaviorFuncs.setup || []) {
      func(this.context, path, point, event.shiftKey);
    }
  }

  setupDrag(path, event) {
    const point = this.getPointFromEvent(event);
    this.behaviorFuncs.setupDrag?.(this.context, path, point, event.shiftKey);
  }

  drag(path, event) {
    const point = this.getPointFromEvent(event);
    this.behaviorFuncs.drag?.(this.context, path, point, event.shiftKey);
  }

  noDrag(path) {
    this.behaviorFuncs.noDrag?.(this.context, path);
  }
}

function insertContourAndSetupAnchorPoint(context, path, point, shiftKey) {
  // A brand-new pen contour is inserted at context.contourIndex (= path end),
  // i.e. after any skeleton-generated block; existing generated indices are
  // unaffected. Pen contour merges (connectToContour, below) do change the
  // contour count and record a generated-index shift via context.
  path.insertContour(context.contourIndex, emptyContour());
  context.anchorIndex = context.contourPointIndex;
}

function setupAnchorPoint(context, path, point, shiftKey) {
  context.anchorIndex = context.contourPointIndex + context.appendBias;
}

function setupExistingAnchorPoint(context, path, point, shiftKey) {
  context.anchorIndex = context.contourPointIndex;
  context.anchorPoint = path.getContourPoint(
    context.contourIndex,
    context.contourPointIndex
  );
}

function insertAnchorPoint(context, path, point, shiftKey) {
  if (shiftKey && !context.createContour && context.isOnCurve) {
    // Shift-constrain the point to 0/45/90/etc degrees
    // Only if a contour exists and the selected point is an on-curve point
    const referencePoint = path.getContourPoint(
      context.contourIndex,
      context.contourPointIndex
    );
    point = shiftConstrainPoint(referencePoint, point);
  }

  point = vector.roundVector(point);
  path.insertPoint(context.contourIndex, context.anchorIndex, point);
  context.anchorPoint = point;
  context.selection = getPointSelection(
    path,
    context.contourIndex,
    context.anchorIndex
  );
}

function insertHandleOut(context, path, point, shiftKey) {
  point = vector.roundVector(point);
  _insertHandleOut(context, path, point);
  _setHandleOutAbsIndex(context, path);
  context.selection = getPointSelectionAbs(context.handleOutAbsIndex);
}

function insertHandleIn(context, path, point, shiftKey) {
  point = vector.roundVector(point);
  _insertHandleIn(context, path, point);
  _setHandleInAbsIndex(context, path);
  context.selection = new Set();
}

function insertHandleInOut(context, path, point, shiftKey) {
  point = vector.roundVector(point);
  _insertHandleIn(context, path, point);
  _insertHandleOut(context, path, point);
  _setHandleInAbsIndex(context, path);
  _setHandleOutAbsIndex(context, path);
  const anchorIndex = path.getAbsolutePointIndex(
    context.contourIndex,
    context.anchorIndex
  );
  path.pointTypes[anchorIndex] = VarPackedPath.SMOOTH_FLAG;
  context.selection = getPointSelectionAbs(context.handleOutAbsIndex);
}

function _insertHandleIn(context, path, point, shiftKey) {
  path.insertPoint(context.contourIndex, context.anchorIndex + context.prependBias, {
    ...point,
    type: context.curveType,
  });
  context.anchorIndex += context.appendBias;
}

function _insertHandleOut(context, path, point, shiftKey) {
  path.insertPoint(context.contourIndex, context.anchorIndex + context.appendBias, {
    ...point,
    type: context.curveType,
  });
  context.anchorIndex += context.prependBias;
}

function _setHandleInAbsIndex(context, path) {
  context.handleInAbsIndex = path.getAbsolutePointIndex(
    context.contourIndex,
    context.anchorIndex - context.appendDirection
  );
}

function _setHandleOutAbsIndex(context, path) {
  context.handleOutAbsIndex = path.getAbsolutePointIndex(
    context.contourIndex,
    context.anchorIndex + context.appendDirection
  );
}

function deleteHandle(context, path, point, shiftKey) {
  path.deletePoint(context.contourIndex, context.contourPointIndex);
  const anchorIndex = path.getAbsolutePointIndex(
    context.contourIndex,
    context.contourPointIndex - context.appendBias
  );
  path.pointTypes[anchorIndex] = VarPackedPath.ON_CURVE;
  context.selection = getPointSelectionAbs(anchorIndex);
}

function closeContour(context, path, point, shiftKey) {
  path.contourInfo[context.contourIndex].isClosed = true;
  const numPoints = path.getNumPointsOfContour(context.contourIndex);
  if (!context.contourPointIndex) {
    const lastPointIndex = numPoints - 1;
    const lastPoint = path.getContourPoint(context.contourIndex, lastPointIndex);
    path.deletePoint(context.contourIndex, lastPointIndex);
    path.insertPoint(context.contourIndex, 0, lastPoint);
  }
  // When appending, we pretend the anchor index is beyond the last point,
  // so we insert the handle at the end of the contour, instead of at the front
  context.anchorIndex = context.appendMode === AppendModes.APPEND ? numPoints : 0;
  context.anchorPoint = path.getContourPoint(context.contourIndex, 0);
  context.selection = getPointSelection(path, context.contourIndex, 0);
}

function dragHandle(context, path, point, shiftKey) {
  point = getHandle(point, context.anchorPoint, shiftKey);
  if (context.handleOutAbsIndex !== undefined) {
    path.setPointPosition(context.handleOutAbsIndex, point.x, point.y);
  }
  if (context.handleInAbsIndex !== undefined) {
    const oppositePoint = oppositeHandle(context.anchorPoint, point);
    path.setPointPosition(context.handleInAbsIndex, oppositePoint.x, oppositePoint.y);
  }
}

function connectToContour(context, path, point, shiftKey) {
  const isPrepend = context.appendMode === AppendModes.PREPEND;
  const targetContourBefore = context.targetContourIndex < context.contourIndex;
  const insertIndex = context.contourIndex - (targetContourBefore ? 1 : 0);
  const deleteIndices = [context.targetContourIndex, context.contourIndex];
  const sourceContourPoints = path.getUnpackedContour(context.contourIndex).points;
  const targetContourPoints = path.getUnpackedContour(
    context.targetContourIndex
  ).points;

  if (isPrepend === (context.targetContourPointIndex === 0)) {
    targetContourPoints.reverse();
  }
  const newContour = {
    points: isPrepend
      ? targetContourPoints.concat(sourceContourPoints)
      : sourceContourPoints.concat(targetContourPoints),
    isClosed: false,
  };
  if (targetContourBefore) {
    deleteIndices.reverse();
  }
  // Merging two pen contours nets one contour fewer. Generated contours above
  // targetContourIndex shift by -1 in both merge directions (target-before:
  // everything above the removed target slot; target-after: everything above
  // the removed target). The bare path has no skeleton data in scope, so the
  // caller (_handleAddPoints) records the shift on the layer glyph.
  context.generatedIndexShift = {
    startIndex: context.targetContourIndex,
    delta: -1,
  };
  for (const index of deleteIndices) {
    path.deleteContour(index);
  }
  path.insertUnpackedContour(insertIndex, newContour);
  context.contourIndex = insertIndex;
  context.anchorIndex =
    context.appendMode === AppendModes.APPEND
      ? sourceContourPoints.length
      : (context.anchorIndex = targetContourPoints.length - 1);
  context.anchorPoint = path.getContourPoint(context.contourIndex, context.anchorIndex);
  context.selection = getPointSelection(
    path,
    context.contourIndex,
    context.anchorIndex
  );
}

function ensureCubicOffCurves(context, path) {
  if (
    context.curveType !== "cubic" ||
    context.isOnCurve ||
    path.getNumPointsOfContour(context.contourIndex) < 3
  ) {
    return;
  }

  const [prevPrevPoint, prevPoint] = [
    context.anchorIndex - 2 * context.appendDirection,
    context.anchorIndex - context.appendDirection,
  ].map((i) => path.getContourPoint(context.contourIndex, i));
  const thisPoint = context.anchorPoint;

  if (prevPrevPoint.type || !prevPoint.type || thisPoint.type) {
    // Sanity check: we expect on-curve/off-curve/on-curve
    return;
  }

  // Compute handles for a cubic segment that will look the same as the
  // one-off-curve quad segment we have.
  const [handle1, handle2] = [prevPrevPoint, thisPoint].map((point) => {
    return {
      ...vector.roundVector(scalePoint(point, prevPoint, 2 / 3)),
      type: "cubic",
    };
  });

  path.setContourPoint(
    context.contourIndex,
    context.anchorIndex - context.appendDirection,
    handle1
  );
  path.insertPoint(
    context.contourIndex,
    context.anchorIndex + context.prependBias,
    handle2
  );
  context.selection = getPointSelection(
    path,
    context.contourIndex,
    modulo(
      context.anchorIndex + context.appendBias,
      path.getNumPointsOfContour(context.contourIndex)
    )
  );
}

function clickOnCurveNoDragSetSelection(context, path) {
  context.selection = getPointSelection(
    path,
    context.contourIndex,
    context.anchorIndex
  );
}

function getPointSelection(path, contourIndex, contourPointIndex) {
  const pointIndex = path.getAbsolutePointIndex(contourIndex, contourPointIndex);
  return new Set([`point/${pointIndex}`]);
}

function getPointSelectionAbs(pointIndex) {
  return new Set([`point/${pointIndex}`]);
}

// The ends of an open contour are the points the pen can draw on from: they are
// exactly what getAppendInfo below accepts as a selection, so both read this.
function isResumablePointIndex(path, pointIndex) {
  if (pointIndex === undefined || pointIndex >= path.numPoints) {
    return false;
  }
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  if (path.contourInfo[contourIndex].isClosed) {
    return false;
  }
  const numPointsContour = path.getNumPointsOfContour(contourIndex);
  return contourPointIndex === 0 || contourPointIndex === numPointsContour - 1;
}

function getAppendInfo(path, selection) {
  if (selection.size === 1) {
    const { point: pointSelection } = parseSelection(selection);
    const pointIndex = pointSelection?.[0];
    if (pointIndex !== undefined && pointIndex < path.numPoints) {
      const [contourIndex, contourPointIndex] =
        path.getContourAndPointIndex(pointIndex);
      const numPointsContour = path.getNumPointsOfContour(contourIndex);
      if (
        !path.contourInfo[contourIndex].isClosed &&
        (contourPointIndex === 0 || contourPointIndex === numPointsContour - 1)
      ) {
        // Let's append or prepend a point to an existing contour
        const appendMode =
          contourPointIndex || numPointsContour === 1
            ? AppendModes.APPEND
            : AppendModes.PREPEND;
        const isOnCurve = !path.getPoint(pointIndex).type;
        const createContour = false;
        return {
          contourIndex,
          contourPointIndex,
          appendMode,
          isOnCurve,
          createContour,
        };
      }
    }
  }
  return {
    contourIndex: path.contourInfo.length,
    contourPointIndex: 0,
    appendMode: AppendModes.APPEND,
    isOnCurve: undefined,
    createContour: true,
  };
}

function emptyContour() {
  return { coordinates: [], pointTypes: [], isClosed: false };
}

function getHandle(handleOut, anchorPoint, shiftKey) {
  if (shiftKey) {
    handleOut = shiftConstrainPoint(anchorPoint, handleOut);
  }
  return vector.roundVector(handleOut);
}

function oppositeHandle(anchorPoint, handlePoint) {
  return vector.addVectors(
    anchorPoint,
    vector.mulVectorScalar(vector.subVectors(handlePoint, anchorPoint), -1)
  );
}

// Hold a point on a whole angle from the one it extends. Exported because the
// Skeleton Pen holds shift the same way, and one copy of the rule is what keeps
// the two pens feeling like one tool.
export function shiftConstrainPoint(anchorPoint, handlePoint) {
  const delta = constrainHorVerDiag(vector.subVectors(handlePoint, anchorPoint));
  return vector.addVectors(anchorPoint, delta);
}

function getHoveredPointIndex(sceneController, event) {
  const hoveredSelection = sceneController.sceneModel.pointSelectionAtPoint(
    sceneController.localPoint(event),
    sceneController.mouseClickMargin
  );
  if (!hoveredSelection.size) {
    return undefined;
  }

  const { point: pointSelection } = parseSelection(hoveredSelection);
  if (!pointSelection?.length) {
    return undefined;
  }
  return pointSelection[0];
}

export function handlesEqual(handles1, handles2) {
  const points1 = handles1?.points;
  const points2 = handles2?.points;
  return (
    points1 === points2 ||
    (pointsEqual(points1?.[0], points2?.[0]) && pointsEqual(points1?.[1], points2?.[1]))
  );
}

function pointsEqual(point1, point2) {
  return point1 === point2 || (point1?.x === point2?.x && point1?.y === point2?.y);
}

function recordLayerChanges(layerInfo, editFunc) {
  const layerChanges = [];
  for (const { layerName, layerGlyph, behavior } of layerInfo) {
    const layerChange = recordChanges(layerGlyph, (layerGlyph) =>
      editFunc(behavior, layerGlyph)
    );
    layerChanges.push(layerChange.prefixed(["layers", layerName, "glyph"]));
  }
  return new ChangeCollector().concat(...layerChanges);
}
