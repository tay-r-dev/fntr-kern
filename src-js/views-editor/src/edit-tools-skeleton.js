import { ChangeCollector } from "@fontra/core/changes.js";
import { translate } from "@fontra/core/localization.js";
import {
  DEFAULT_SKELETON_WIDTH,
  appendSkeletonContour,
  appendSkeletonPoint,
  closeSkeletonContour,
  getDefaultSkeletonWidthKeyForGlyphName,
  getSkeletonData,
  makeSkeletonPoint,
  resolveEffectiveSourceSkeletonDefault,
} from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import { Bezier } from "bezier-js";
import { BaseTool } from "./edit-tools-base.js";
import { shiftConstrainPoint } from "./edit-tools-pen.js";
import {
  editSkeleton,
  getSkeletonPointAddress,
  hasSkeletonPointSelection,
  makeSkeletonPointKey,
  parseSkeletonPointKey,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";
import { SnappingSession } from "./snapping-interactions.js";

// The dropdown, laid out like the ordinary pen's: one button that opens onto the
// two pens. They differ in one thing, which is the state a contour they start is
// born in.
export class SkeletonPenTools {
  identifier = "skeleton-pen-tool";
  subTools = [SkeletonPenTool, SkeletonPenToolSingleSided];
}

export class SkeletonPenTool extends BaseTool {
  iconPath = "/images/skeleton-pen.svg";
  identifier = "skeleton-pen-tool-standard";

  // Which side a new contour puts its width on, or null for both. Everything
  // else about the two pens is identical, so this is the whole of the subclass
  // below.
  get newContourSingleSided() {
    return null;
  }

  // The edit layer's skeleton data. Selection ids are canonical here (WS-9
  // cross-layer addressing); other editable layers resolve by structural
  // ordinal inside editSkeleton mutations.
  _getEditLayerSkeletonData() {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph?.glyph?.canEdit) {
      return null;
    }
    // Mirror scene-model._getEditLayerSkeletonData so this tool's centerline /
    // close / drawing-contour lookups reference the SAME layer whose ids the
    // scene-model hit test treats as canonical.
    const editLayerName =
      this.sceneSettings?.editLayerName || positionedGlyph.glyph?.layerName;
    const layerGlyph =
      editLayerName && positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph;
    return getSkeletonData(layerGlyph || positionedGlyph.glyph);
  }

  // Master (source) default width for the edited glyph's case; falls back to
  // the model constant when no source defaults are stored.
  _getMasterDefaultWidth() {
    const glyphName = this.sceneSettings?.selectedGlyphName;
    const location =
      this.sceneSettings?.fontLocationSourceMapped ||
      this.sceneSettings?.fontLocationSource ||
      {};
    const value = resolveEffectiveSourceSkeletonDefault(
      this.editor.fontController,
      location,
      getDefaultSkeletonWidthKeyForGlyphName(glyphName)
    );
    return Number.isFinite(Number(value)) && Number(value) > 0
      ? Number(value)
      : DEFAULT_SKELETON_WIDTH;
  }

  // Positioned-glyph-relative point from a mouse event, in glyph coordinates.
  _getGlyphPoint(event) {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return null;
    }
    const point = this.sceneController.localPoint(event);
    return {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
  }

  // Id-based skeleton point hit test. Reuses the WS-9 scene-model hit test so
  // there is a single stable-id hit path; returns { contourId, pointId } or null.
  _hitTestSkeletonPoint(event) {
    const point = this.sceneController.localPoint(event);
    const size = this.sceneController.mouseClickMargin;
    const parsedCurrentSelection = parseSelection([...this.sceneController.selection]);
    const hit = this.sceneModel.skeletonPointAtPoint(
      point,
      size,
      parsedCurrentSelection
    );
    const key = [...hit][0];
    return key ? parseSkeletonPointKey(key) : null;
  }

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      // Outside editing the pen is not the tool answering the pointer, so its
      // mark must not stay behind on the canvas.
      this._setPenPointHover(null);
      this._endSnapping();
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.setCursor();
    this._updateSnapHover(event);
    this._updateInsertHandlesPreview(event);
    this._updatePenPointHover(event);
  }

  // One session for the length of the hover, rebuilt when the glyph changes.
  // Nothing is excluded: the point being placed is not in the skeleton yet, and
  // the point the stroke is extended from is the most useful source there.
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

  // The same rule the ordinary pen follows: the click resolves through the
  // session the hover just drew, so the mark on the canvas is where the point
  // lands. The scene is re-read first, because the pen adds geometry as it goes
  // and a point just placed is a source.
  _snapPoint(event) {
    const session = this._snapSession();
    const point = this.sceneController.selectedGlyphPoint(event);
    return point ? session.resolve(point) : point;
  }

  // The hover redraw below fires only when the pen's own hover answers change,
  // so the snap draw needs its own. Without it a guide appears only where some
  // other hover state happens to change.
  _updateSnapHover(event) {
    const session = this._snapSession();
    session.refresh();
    const point = this.sceneController.selectedGlyphPoint(event);
    if (point) {
      session.resolve(point);
    }
    const snapState = JSON.stringify([
      this.sceneModel.snapHeldCandidates?.map((c) => [
        c.kind,
        c.x,
        c.y,
        c.dx,
        c.dy,
        // A curve projection has none of the above: its four points are what
        // tells one from another.
        c.points,
      ]),
      this.sceneModel.snapIndicator,
    ]);
    if (snapState !== this._lastSnapState) {
      this._lastSnapState = snapState;
      this.canvasController.requestUpdate();
    }
  }

  _endSnapping() {
    this._snapping?.end();
    this._snapping = null;
    this._lastSnapState = undefined;
  }

  // What a click on the hovered skeleton point would do. Three answers, because
  // handleDrag branches three ways on a point hit: "close" joins the contour
  // shut on it, "resume" selects an open end the next click extends from, and
  // "select" selects a point the pen cannot draw on from. Without this the
  // designer only finds out by clicking, and the click has already committed.
  _getPenPointHoverTarget(event) {
    const hit = this._hitTestSkeletonPoint(event);
    if (!hit) {
      return null;
    }
    const skeletonData = this._getEditLayerSkeletonData();
    if (!skeletonData) {
      return null;
    }
    const address = getSkeletonPointAddress(skeletonData, hit.contourId, hit.pointId);
    if (!address) {
      return null;
    }
    let kind;
    if (this._getCloseTarget(hit)) {
      kind = "close";
    } else if (
      this._getOpenEndpointAt(skeletonData, skeletonData, hit.contourId, hit.pointId)
    ) {
      kind = "resume";
    } else {
      kind = "select";
    }
    return { x: address.point.x, y: address.point.y, kind };
  }

  // Repaint only when the answer changes. The hit test runs on every move, and
  // a redraw on every move reads as the canvas snapping under the pointer.
  _updatePenPointHover(event) {
    this._setPenPointHover(this._getPenPointHoverTarget(event));
  }

  _setPenPointHover(target) {
    const previous = this.sceneModel.skeletonPenHoverTarget;
    if (
      previous?.kind === target?.kind &&
      previous?.x === target?.x &&
      previous?.y === target?.y
    ) {
      return;
    }
    this.sceneModel.skeletonPenHoverTarget = target;
    this.canvasController.requestUpdate();
  }

  // Preview the two cubic handles that an Alt-click would insert on a hovered
  // line segment. Cleared otherwise. Rendered by the skeleton insert-handles
  // visualization layer.
  _updateInsertHandlesPreview(event) {
    let preview = null;
    if (event.altKey && !this._hitTestSkeletonPoint(event)) {
      const centerlineHit = this._hitTestSkeletonCenterline(event);
      if (centerlineHit?.isLineSegment) {
        const skeletonData = this._getEditLayerSkeletonData();
        const address =
          skeletonData &&
          getSkeletonPointAddress(
            skeletonData,
            centerlineHit.contourId,
            centerlineHit.startPointId
          );
        const endAddress =
          skeletonData &&
          getSkeletonPointAddress(
            skeletonData,
            centerlineHit.contourId,
            centerlineHit.endPointId
          );
        if (address && endAddress) {
          const start = address.point;
          const end = endAddress.point;
          preview = {
            points: [
              {
                x: Math.round(start.x + (end.x - start.x) / 3),
                y: Math.round(start.y + (end.y - start.y) / 3),
              },
              {
                x: Math.round(start.x + ((end.x - start.x) * 2) / 3),
                y: Math.round(start.y + ((end.y - start.y) * 2) / 3),
              },
            ],
          };
        }
      }
    }
    if (!insertHandlesEqual(this.sceneModel.skeletonInsertHandles, preview)) {
      this.sceneModel.skeletonInsertHandles = preview;
      this.canvasController.requestUpdate();
    }
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }

    const skeletonHit = this._hitTestSkeletonPoint(initialEvent);
    if (skeletonHit) {
      const closeTarget = this._getCloseTarget(skeletonHit);
      if (closeTarget) {
        await this._handleCloseSkeletonContour(closeTarget);
        eventStream.done();
        return;
      }
      // Clicking an existing skeleton point selects it (dragging is handled by
      // the pointer tool's skeleton behavior).
      this.sceneController.selection = new Set([
        makeSkeletonPointKey(skeletonHit.contourId, skeletonHit.pointId),
      ]);
      eventStream.done();
      return;
    }

    const centerlineHit = this._hitTestSkeletonCenterline(initialEvent);
    if (centerlineHit) {
      // While drawing (an open endpoint is selected), a hit on a different
      // contour's centerline should extend the drawn contour, not insert there.
      const drawingContourId = this._getDrawingContourId();
      if (drawingContourId != null && centerlineHit.contourId !== drawingContourId) {
        await this._handleAddSkeletonPoint(eventStream, initialEvent);
        return;
      }
      if (initialEvent.altKey && centerlineHit.isLineSegment) {
        await this._handleInsertSkeletonHandles(centerlineHit);
      } else {
        await this._handleInsertSkeletonPoint(centerlineHit);
      }
      eventStream.done();
      return;
    }

    await this._handleAddSkeletonPoint(eventStream, initialEvent);
  }

  // Where the contour being drawn currently ends, in glyph coordinates, or null
  // when nothing is being extended.
  _getDrawingEndpointPosition() {
    const skeletonData = this._getEditLayerSkeletonData();
    if (!skeletonData) {
      return null;
    }
    const endpoint = this._getSelectedOpenEndpoint(skeletonData, skeletonData);
    return endpoint ? { x: endpoint.point.x, y: endpoint.point.y } : null;
  }

  _getDrawingContourId() {
    const skeletonData = this._getEditLayerSkeletonData();
    if (!skeletonData) {
      return null;
    }
    const endpoint = this._getSelectedOpenEndpoint(skeletonData, skeletonData);
    return endpoint ? endpoint.contour.id : null;
  }

  // Runs one editSkeleton mutation across every editable layer and folds the
  // per-layer changes into one undo item. `applyMutation(working, reference)`
  // mutates a layer's working skeleton and returns the selection keys to apply
  // (honored from the edit layer only, where ids are canonical).
  async _editSkeletonAcrossLayers(undoLabel, applyMutation) {
    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const editingLayers = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );
      const entries = Object.entries(editingLayers);
      if (!entries.length) {
        return;
      }
      // The reference layer is the one whose ids the scene-model hit test treats
      // as canonical (sceneSettings.editLayerName); resolve every other editable
      // layer against it by structural ordinal (WS-9 cross-layer addressing).
      const editLayerName = this.sceneSettings?.editLayerName;
      const editLayerGlyph = editingLayers[editLayerName] || entries[0][1];
      const referenceSkeletonData = getSkeletonData(editLayerGlyph);

      let primarySelection = null;
      const allChanges = [];
      for (const [layerName, layerGlyph] of entries) {
        const isEditLayer = layerGlyph === editLayerGlyph;
        const changes = editSkeleton(
          layerGlyph,
          (working) => {
            const selectionKeys = applyMutation(working, referenceSkeletonData);
            if (isEditLayer && selectionKeys) {
              primarySelection = new Set(selectionKeys);
            }
          },
          { createIfMissing: true }
        );
        allChanges.push(changes.prefixed(["layers", layerName, "glyph"]));
      }

      const combined = new ChangeCollector().concat(...allChanges);
      await sendIncrementalChange(combined.change);
      if (primarySelection) {
        this.sceneController.selection = primarySelection;
      }
      return { changes: combined, undoLabel, broadcast: true };
    });
  }

  // referenceSkeletonData is the EDIT layer's skeleton; selection ids are
  // canonical there and resolve into this layer by structural ordinal (WS-9
  // cross-layer addressing). parseSelection returns arrays (WS-9 Task 0).
  _getSelectedOpenEndpoint(skeletonData, referenceSkeletonData) {
    const { skeletonPoint } = parseSelection([...this.sceneController.selection]);
    if (!skeletonPoint || skeletonPoint.length !== 1) {
      return null;
    }
    const { contourId, pointId } = parseSkeletonPointKey(skeletonPoint[0]);
    return this._getOpenEndpointAt(
      skeletonData,
      referenceSkeletonData,
      contourId,
      pointId
    );
  }

  // Whether a named skeleton point is an end of an open contour, and so which
  // way the pen would extend from it. Null for anything else: a closed contour,
  // an off-curve, or a point in the middle of the run.
  _getOpenEndpointAt(skeletonData, referenceSkeletonData, contourId, pointId) {
    const address = resolveSkeletonAddressAcrossLayers(
      referenceSkeletonData || skeletonData,
      skeletonData,
      contourId,
      pointId
    );
    if (!address || address.contour.closed || address.point.type) {
      return null;
    }
    const onCurves = address.contour.points.filter((point) => !point.type);
    if (onCurves.length < 1) {
      return null;
    }
    if (onCurves[0].id === address.point.id) {
      return { ...address, appendMode: "prepend" };
    }
    if (onCurves.at(-1).id === address.point.id) {
      return { ...address, appendMode: "append" };
    }
    return null;
  }

  async _handleAddSkeletonPoint(eventStream, initialEvent) {
    let glyphPoint = this._snapPoint(initialEvent);
    if (!glyphPoint) {
      eventStream.done();
      return;
    }
    // Shift holds the new point on a whole angle from the one it extends, the
    // same as the ordinary pen. Only while a contour is being drawn: the first
    // point of a contour has nothing to be square to. The constraint is taken
    // once, from the edit layer, so every layer receives the same point - which
    // is what the unconstrained path already did.
    if (initialEvent.shiftKey) {
      const previous = this._getDrawingEndpointPosition();
      if (previous) {
        glyphPoint = shiftConstrainPoint(previous, glyphPoint);
      }
    }
    const pointData = {
      x: Math.round(glyphPoint.x),
      y: Math.round(glyphPoint.y),
      type: null,
      smooth: false,
    };

    await this._editSkeletonAcrossLayers(
      translate("edit-tools-skeleton.undo.add-point"),
      (working, referenceSkeletonData) => {
        const endpoint = this._getSelectedOpenEndpoint(working, referenceSkeletonData);
        if (endpoint) {
          // Continuing a stroke keeps that stroke's width. The point being
          // extended states it, per layer, so a stroke drawn or tapered to
          // anything other than the default does not step back to the default
          // at every new point. Only the width travels: everything else on the
          // endpoint is that point's own.
          const point = makeSkeletonPoint(
            { ...pointData, width: { ...endpoint.point.width } },
            working
          );
          if (endpoint.appendMode === "append") {
            endpoint.contour.points.push(point);
          } else {
            endpoint.contour.points.unshift(point);
          }
          return [makeSkeletonPointKey(endpoint.contour.id, point.id)];
        }
        // New contours seed their default width from the master (source)
        // defaults for the glyph's case, not the hardcoded model fallback.
        //
        // The first point takes it too. A point always carries its own width, so
        // the contour's number is never read for geometry — set on the contour
        // alone it would be a label the stroke did not obey.
        const defaultWidth = this._getMasterDefaultWidth();
        const contour = appendSkeletonContour(working, {
          closed: false,
          defaultWidth,
          singleSided: this.newContourSingleSided,
          points: [],
        });
        const point = appendSkeletonPoint(working, contour.id, {
          ...pointData,
          width: { left: defaultWidth / 2, right: defaultWidth / 2 },
        });
        return [makeSkeletonPointKey(contour.id, point.id)];
      }
    );

    // Drag-to-curve is out of scope for the Skeleton Pen (WS-10 Deviations):
    // consume any remaining drag events without action.
    for await (const event of eventStream) {
      // consume
    }
  }

  // If the click hits the opposite endpoint of the same open contour whose
  // endpoint is currently selected, return the close target (edit-layer
  // canonical ids); otherwise null. Uses edit-layer skeleton data.
  _getCloseTarget(skeletonHit) {
    const skeletonData = this._getEditLayerSkeletonData();
    if (!skeletonData) {
      return null;
    }
    const { skeletonPoint } = parseSelection([...this.sceneController.selection]);
    if (!skeletonPoint || skeletonPoint.length !== 1) {
      return null;
    }
    const selected = parseSkeletonPointKey(skeletonPoint[0]);
    if (selected.contourId !== skeletonHit.contourId) {
      return null;
    }
    const address = getSkeletonPointAddress(
      skeletonData,
      skeletonHit.contourId,
      skeletonHit.pointId
    );
    if (!address || address.contour.closed) {
      return null;
    }
    const onCurves = address.contour.points.filter((point) => !point.type);
    if (onCurves.length < 2) {
      return null;
    }
    const firstId = onCurves[0].id;
    const lastId = onCurves.at(-1).id;
    const clickedId = skeletonHit.pointId;
    const selectedId = selected.pointId;
    const opposite =
      (selectedId === lastId && clickedId === firstId) ||
      (selectedId === firstId && clickedId === lastId);
    if (!opposite) {
      return null;
    }
    return { contourId: skeletonHit.contourId, clickedPointId: clickedId };
  }

  async _handleCloseSkeletonContour(closeTarget) {
    await this._editSkeletonAcrossLayers(
      translate("edit-tools-skeleton.undo.close-contour"),
      (working, referenceSkeletonData) => {
        const address = resolveSkeletonAddressAcrossLayers(
          referenceSkeletonData || working,
          working,
          closeTarget.contourId,
          closeTarget.clickedPointId
        );
        if (!address) {
          return null;
        }
        // One close, one rule: two ends already standing in the same place
        // become one point rather than two stacked on each other.
        closeSkeletonContour(working, address.contour.id);
        return [
          makeSkeletonPointKey(closeTarget.contourId, closeTarget.clickedPointId),
        ];
      }
    );
  }

  // Hit test skeleton centerline segments on the edit layer. Returns a stable-id
  // descriptor { contourId, startPointId, endPointId, t, point, isLineSegment,
  // isClosingSegment } or null. Geometry semantics ported from donor fd76d3abe.
  _hitTestSkeletonCenterline(event) {
    const skeletonData = this._getEditLayerSkeletonData();
    if (!skeletonData?.contours?.length) {
      return null;
    }
    const glyphPoint = this._getGlyphPoint(event);
    if (!glyphPoint) {
      return null;
    }
    // Centerline is a thin line; use a slightly larger margin for easy targeting.
    const margin = this.sceneController.mouseClickMargin * 1.5;

    for (const contour of skeletonData.contours) {
      const points = contour.points;
      const onCurveIndices = [];
      for (let i = 0; i < points.length; i++) {
        if (!points[i].type) {
          onCurveIndices.push(i);
        }
      }
      if (onCurveIndices.length < 2) {
        continue;
      }

      // Open (and interior) segments between consecutive on-curve points.
      for (let i = 0; i < onCurveIndices.length - 1; i++) {
        const startIdx = onCurveIndices[i];
        const endIdx = onCurveIndices[i + 1];
        const hasOffCurve = endIdx - startIdx > 1;
        const bezierPoints = points.slice(startIdx, endIdx + 1);
        const hit = this._projectToSegment(glyphPoint, bezierPoints);
        if (hit && hit.distance <= margin) {
          return {
            contourId: contour.id,
            startPointId: points[startIdx].id,
            endPointId: points[endIdx].id,
            t: hit.t,
            point: hit.point,
            isLineSegment: !hasOffCurve,
            isClosingSegment: false,
          };
        }
      }

      // Closing segment (wrap from last to first on-curve).
      if (contour.closed) {
        const lastIdx = onCurveIndices[onCurveIndices.length - 1];
        const firstIdx = onCurveIndices[0];
        const bezierPoints = [
          points[lastIdx],
          ...points.slice(lastIdx + 1),
          ...points.slice(0, firstIdx),
          points[firstIdx],
        ];
        const hasOffCurve = bezierPoints.length > 2;
        const hit = this._projectToSegment(glyphPoint, bezierPoints);
        if (hit && hit.distance <= margin) {
          return {
            contourId: contour.id,
            startPointId: points[lastIdx].id,
            endPointId: points[firstIdx].id,
            t: hit.t,
            point: hit.point,
            isLineSegment: !hasOffCurve,
            isClosingSegment: true,
          };
        }
      }
    }
    return null;
  }

  // Project a glyph point onto a line/bezier segment defined by control points.
  // Returns { distance, t, point } or null.
  _projectToSegment(point, controlPoints) {
    if (controlPoints.length < 2) {
      return null;
    }
    if (controlPoints.length === 2) {
      return this._projectToLine(point, controlPoints[0], controlPoints[1]);
    }
    const bezier = makeBezier(controlPoints);
    const projected = bezier.project(point);
    return {
      distance: projected.d,
      t: projected.t,
      point: { x: projected.x, y: projected.y },
    };
  }

  _projectToLine(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
      return {
        distance: vector.distance(point, lineStart),
        t: 0,
        point: { ...lineStart },
      };
    }
    let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const closest = { x: lineStart.x + t * dx, y: lineStart.y + t * dy };
    return { distance: vector.distance(point, closest), t, point: closest };
  }

  // Resolve a centerline hit's start/end on-curve endpoints into a working layer
  // by structural ordinal (cross-layer addressing). Returns
  // { contour, startIndex, endIndex } or null.
  _locateHitSegment(working, referenceSkeletonData, hit) {
    const reference = referenceSkeletonData || working;
    const start = resolveSkeletonAddressAcrossLayers(
      reference,
      working,
      hit.contourId,
      hit.startPointId
    );
    const end = resolveSkeletonAddressAcrossLayers(
      reference,
      working,
      hit.contourId,
      hit.endPointId
    );
    if (!start || !end || start.contour !== end.contour) {
      return null;
    }
    return {
      contour: start.contour,
      startIndex: start.pointIndex,
      endIndex: end.pointIndex,
    };
  }

  async _handleInsertSkeletonPoint(centerlineHit) {
    await this._editSkeletonAcrossLayers(
      translate("edit-tools-skeleton.undo.insert-point"),
      (working, referenceSkeletonData) => {
        const seg = this._locateHitSegment(
          working,
          referenceSkeletonData,
          centerlineHit
        );
        if (!seg) {
          return null;
        }
        const { contour, startIndex, endIndex } = seg;
        const t = centerlineHit.t;

        if (centerlineHit.isLineSegment) {
          const startPoint = contour.points[startIndex];
          const endPoint = contour.points[endIndex];
          const newPoint = makeSkeletonPoint(
            {
              x: Math.round(startPoint.x + (endPoint.x - startPoint.x) * t),
              y: Math.round(startPoint.y + (endPoint.y - startPoint.y) * t),
              type: null,
              smooth: false,
            },
            working
          );
          const insertIndex = centerlineHit.isClosingSegment
            ? contour.points.length
            : startIndex + 1;
          contour.points.splice(insertIndex, 0, newPoint);
          return [makeSkeletonPointKey(contour.id, newPoint.id)];
        }

        const newOnCurveId = centerlineHit.isClosingSegment
          ? this._splitClosingCubic(working, contour, startIndex, endIndex, t)
          : this._splitCubic(working, contour, startIndex, endIndex, t);
        if (newOnCurveId == null) {
          return null;
        }
        return [makeSkeletonPointKey(contour.id, newOnCurveId)];
      }
    );
  }

  // Split a non-closing cubic/quad segment at t, replacing the off-curve span
  // with left handles, a new smooth on-curve, and right handles. Existing point
  // ids are preserved; new points get fresh stable ids. Returns new on-curve id.
  _splitCubic(working, contour, startIndex, endIndex, t) {
    const points = contour.points;
    const bezierPoints = points.slice(startIndex, endIndex + 1);
    const bezier = makeBezier(bezierPoints);
    const split = bezier.split(t);
    const splitPoint = bezier.get(t);
    const insert = [];
    for (let k = 1; k < split.left.points.length - 1; k++) {
      insert.push(
        makeSkeletonPoint(
          {
            x: Math.round(split.left.points[k].x),
            y: Math.round(split.left.points[k].y),
            type: "cubic",
          },
          working
        )
      );
    }
    const newOnCurve = makeSkeletonPoint(
      {
        x: Math.round(splitPoint.x),
        y: Math.round(splitPoint.y),
        type: null,
        smooth: true,
      },
      working
    );
    insert.push(newOnCurve);
    for (let k = 1; k < split.right.points.length - 1; k++) {
      insert.push(
        makeSkeletonPoint(
          {
            x: Math.round(split.right.points[k].x),
            y: Math.round(split.right.points[k].y),
            type: "cubic",
          },
          working
        )
      );
    }
    points.splice(startIndex + 1, endIndex - startIndex - 1, ...insert);
    return newOnCurve.id;
  }

  // Split a closing cubic segment (off-curves wrap around the array end). Rebuild
  // the contour starting at the first on-curve; preserve existing point ids for
  // the non-closing span and allocate fresh ids for the split handles/on-curve.
  _splitClosingCubic(working, contour, lastOnCurveIndex, firstOnCurveIndex, t) {
    const points = contour.points;
    const bezierPoints = [
      points[lastOnCurveIndex],
      ...points.slice(lastOnCurveIndex + 1),
      ...points.slice(0, firstOnCurveIndex),
      points[firstOnCurveIndex],
    ];
    const bezier = makeBezier(bezierPoints);
    const split = bezier.split(t);
    const splitPoint = bezier.get(t);

    const newPoints = [];
    // Preserve the non-closing span (first on-curve .. last on-curve), keeping ids.
    for (let j = firstOnCurveIndex; j <= lastOnCurveIndex; j++) {
      newPoints.push(points[j]);
    }
    for (let k = 1; k < split.left.points.length - 1; k++) {
      newPoints.push(
        makeSkeletonPoint(
          {
            x: Math.round(split.left.points[k].x),
            y: Math.round(split.left.points[k].y),
            type: "cubic",
          },
          working
        )
      );
    }
    const newOnCurve = makeSkeletonPoint(
      {
        x: Math.round(splitPoint.x),
        y: Math.round(splitPoint.y),
        type: null,
        smooth: true,
      },
      working
    );
    newPoints.push(newOnCurve);
    for (let k = 1; k < split.right.points.length - 1; k++) {
      newPoints.push(
        makeSkeletonPoint(
          {
            x: Math.round(split.right.points[k].x),
            y: Math.round(split.right.points[k].y),
            type: "cubic",
          },
          working
        )
      );
    }
    contour.points = newPoints;
    return newOnCurve.id;
  }

  // Alt-click a line segment: insert two cubic handles at 1/3 and 2/3, converting
  // the line to a curve. Line segments only (verified by centerlineHit).
  async _handleInsertSkeletonHandles(centerlineHit) {
    await this._editSkeletonAcrossLayers(
      translate("edit-tools-skeleton.undo.insert-handles"),
      (working, referenceSkeletonData) => {
        const seg = this._locateHitSegment(
          working,
          referenceSkeletonData,
          centerlineHit
        );
        if (!seg) {
          return null;
        }
        const { contour, startIndex, endIndex } = seg;
        const startPoint = contour.points[startIndex];
        const endPoint = contour.points[endIndex];
        const handle1 = makeSkeletonPoint(
          {
            x: Math.round(startPoint.x + (endPoint.x - startPoint.x) / 3),
            y: Math.round(startPoint.y + (endPoint.y - startPoint.y) / 3),
            type: "cubic",
          },
          working
        );
        const handle2 = makeSkeletonPoint(
          {
            x: Math.round(startPoint.x + ((endPoint.x - startPoint.x) * 2) / 3),
            y: Math.round(startPoint.y + ((endPoint.y - startPoint.y) * 2) / 3),
            type: "cubic",
          },
          working
        );
        const insertIndex = centerlineHit.isClosingSegment
          ? contour.points.length
          : startIndex + 1;
        contour.points.splice(insertIndex, 0, handle1, handle2);
        return [
          makeSkeletonPointKey(contour.id, handle1.id),
          makeSkeletonPointKey(contour.id, handle2.id),
        ];
      }
    );
  }

  // The delete action is dispatched to the active tool via callDelegateMethod.
  // Delete selected skeleton points; otherwise fall back to the editor's default
  // delete (regular points, components, anchors, ...).
  async doDelete(event) {
    if (hasSkeletonPointSelection(this.sceneController.selection)) {
      await this._handleDeleteSkeletonPoints();
    } else {
      await this.editor.doDelete(event);
    }
  }

  async _handleDeleteSkeletonPoints() {
    const { skeletonPoint } = parseSelection([...this.sceneController.selection]);
    const selectedIds = (skeletonPoint || []).map((item) =>
      parseSkeletonPointKey(item)
    );
    if (!selectedIds.length) {
      return;
    }

    await this._editSkeletonAcrossLayers(
      translate("edit-tools-skeleton.undo.delete-point"),
      (working, referenceSkeletonData) => {
        const reference = referenceSkeletonData || working;
        const deleteRefs = new Set();
        for (const { contourId, pointId } of selectedIds) {
          const address = resolveSkeletonAddressAcrossLayers(
            reference,
            working,
            contourId,
            pointId
          );
          if (address) {
            deleteRefs.add(address.point);
          }
        }
        if (!deleteRefs.size) {
          return null;
        }

        // Deleting an on-curve point orphans its adjacent off-curve handles;
        // remove those too so no dangling handles remain.
        for (const contour of working.contours) {
          const pts = contour.points;
          const n = pts.length;
          for (let i = 0; i < n; i++) {
            if (pts[i].type || !deleteRefs.has(pts[i])) {
              continue;
            }
            const neighbors = [];
            if (i > 0) {
              neighbors.push(pts[i - 1]);
            } else if (contour.closed) {
              neighbors.push(pts[n - 1]);
            }
            if (i < n - 1) {
              neighbors.push(pts[i + 1]);
            } else if (contour.closed) {
              neighbors.push(pts[0]);
            }
            for (const neighbor of neighbors) {
              if (neighbor.type) {
                deleteRefs.add(neighbor);
              }
            }
          }
        }

        for (let ci = working.contours.length - 1; ci >= 0; ci--) {
          const contour = working.contours[ci];
          contour.points = contour.points.filter((point) => !deleteRefs.has(point));
          const onCurveCount = contour.points.filter((point) => !point.type).length;
          if (onCurveCount === 0) {
            working.contours.splice(ci, 1);
          } else if (contour.closed && onCurveCount < 2) {
            // Too few on-curve points to remain a closed contour: reopen it.
            contour.closed = false;
          }
        }

        // Clear selection (the deleted ids are gone); honored from edit layer.
        return [];
      }
    );
  }

  deactivate() {
    super.deactivate();
    this._endSnapping();
    delete this.sceneModel.skeletonInsertHandles;
    delete this.sceneModel.skeletonPenHoverTarget;
    this.sceneController.hoverSelection = new Set();
    this.canvasController.requestUpdate();
  }

  // Same rule as the base pen: the drawing endpoint is a selected skeleton
  // point, so clearing the selection ends the contour and the next click starts
  // a new one. No skeleton data changes, so no editSkeleton write and no undo
  // record. A pen never opens the canvas context menu.
  handleContextMenu(event) {
    this.sceneController.selection = new Set();
    this._endSnapping();
    delete this.sceneModel.skeletonInsertHandles;
    delete this.sceneModel.skeletonPenHoverTarget;
    this.sceneController.hoverSelection = new Set();
    this.canvasController.requestUpdate();
    return true;
  }

  setCursor() {
    this.canvasController.canvas.style.cursor = this.sceneModel.selectedGlyph?.isEditing
      ? "crosshair"
      : "default";
  }
}

// Draws exactly what the pen above draws. The one difference is that a contour
// it starts puts all of its width on one side, so the line drawn is the edge of
// the letter rather than its middle. Left, which is the side the generator falls
// back to everywhere else, and the panel flips it afterwards like any other
// contour.
export class SkeletonPenToolSingleSided extends SkeletonPenTool {
  iconPath = "/images/skeleton-pen-single-sided.svg";
  identifier = "skeleton-pen-tool-single-sided";

  get newContourSingleSided() {
    return "left";
  }
}

function insertHandlesEqual(a, b) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b || a.points.length !== b.points.length) {
    return false;
  }
  return a.points.every(
    (point, i) => point.x === b.points[i].x && point.y === b.points[i].y
  );
}

// Build a bezier-js curve from 3 (quad) or 4 (cubic) control points. More than 4
// points are approximated as a cubic using the outer control points.
function makeBezier(controlPoints) {
  const coords = [];
  if (controlPoints.length <= 3) {
    for (const point of controlPoints) {
      coords.push(point.x, point.y);
    }
  } else {
    const p = controlPoints;
    coords.push(
      p[0].x,
      p[0].y,
      p[1].x,
      p[1].y,
      p[p.length - 2].x,
      p[p.length - 2].y,
      p[p.length - 1].x,
      p[p.length - 1].y
    );
  }
  return new Bezier(...coords);
}
