import { aimCollapsedRay, markerGeometry } from "@fontra/core/marker-measure.js";
import {
  aimedCast,
  aimedRayOnPoint,
  computeMarkerSignature,
  nearestOnCurvePoint,
  resolveMarkerEnd,
  snapToCurvatureApex,
  withAnchorPosition,
} from "@fontra/core/marker-model.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import {
  CURVATURE_APEX_REACH,
  aimHoldElapsed,
  aimTowards,
  deleteMarkers,
  handleMarkerDrag,
  nearestMarkerAnchorage,
  placeMarker,
  unaimMarker,
} from "./marker-editing.js";
import { rulerExtraLinesFor } from "./edit-tools-power-ruler.js";
import { setMarkerPlacementPreview } from "./visualization-layer-markers.js";

// The escape hatch, and deliberately narrow: this tool places, moves and deletes
// markers, and delegates everything else to the pointer tool.
//
// It delegates rather than subclassing. The pointer tool's drag dispatches over
// selection kinds a marker tool has no business inheriting — skeleton ribs, generated
// gizmos, tension-aware editing, base-curve expansion. Delegation gives the pointer's
// behaviour where it is wanted and nothing where it is not, and the two cannot drift.
//
// Its own hit test does NOT apply the pointer tool's generated-geometry precedence: this
// tool exists precisely to reach the markers that precedence hides.
export class MarkerTool extends BaseTool {
  iconPath = "/images/markertool.svg";
  identifier = "marker-tool";

  constructor(editor) {
    super(editor);
    this.pendingDimensionEnd = null;
    // C held: a click places a curvature marker instead of a ray.
    this.curvatureKeyDown = false;
    this.lastHoverEvent = null;
  }

  get pointerTool() {
    return this.editor.tools["pointer-tool"];
  }

  // The tool says what a click would do. Hovering a marker offers its grip; hovering a
  // contour previews the ray that would be placed there, cast and measured exactly as
  // the placement would cast it. Without this the tool aims blind.
  handleHover(event) {
    this.lastHoverEvent = event;
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      setMarkerPlacementPreview(null);
      this.pointerTool.handleHover(event);
      return;
    }
    const point = this.sceneController.localPoint(event);
    const size = this.sceneController.mouseClickMargin;
    const markerTarget = this.sceneModel.markerAtPoint(point, size);
    this.sceneController.hoverSelection = markerTarget
      ? new Set([
          markerTarget.endIndex === undefined
            ? `marker/${markerTarget.markerId}`
            : `markerEnd/${markerTarget.markerId}/${markerTarget.endIndex}`,
        ])
      : new Set();

    setMarkerPlacementPreview(
      markerTarget
        ? null
        : this.curvatureKeyDown
          ? this.curvaturePreviewAt(point)
          : this.previewAt(point, event.altKey)
    );
    this.canvasController.requestUpdate();
    this.setCursor();
  }

  previewAt(point, wantDimension) {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return null;
    }
    const glyphController = positionedGlyph.glyph;
    const local = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    if (wantDimension) {
      const end = nearestPathPointEnd(glyphController.flattenedPath, local);
      if (!end) {
        return null;
      }
      return {
        point: glyphController.flattenedPath.getContourPoint(
          end.contourIndex,
          end.pointIndex
        ),
      };
    }
    // The preview is the placement: same anchorage, same cast, same measurement. Two
    // routines answering "where would this go" is two answers waiting to disagree.
    const end = nearestMarkerAnchorage(
      glyphController.flattenedPathHitTester,
      glyphController.flattenedPath,
      local,
      this.skeletonData
    );
    if (!end) {
      return null;
    }
    return this.rayPreview(glyphController, this.rayEnds(glyphController, end));
  }

  // The ends a ray placed on `end` is written with. Aimed where the designer dragged a
  // direction; otherwise a plain ray, unless the normal measures nothing there, and then
  // it is aimed at the nearest on-curve point instead (aimCollapsedRay).
  rayEnds(glyphController, end, direction = undefined) {
    if (direction) {
      return aimedRayOnPoint(
        [end, aimedCast(direction)],
        glyphController.flattenedPath
      );
    }
    const ends = [end, { kind: "cast" }];
    return (
      aimCollapsedRay(
        ends,
        glyphController.flattenedPath,
        glyphController.flattenedPathHitTester
      ) || ends
    );
  }

  // The ray those ends draw, derived exactly as a placed marker is derived.
  rayPreview(glyphController, ends) {
    const geometry = markerGeometry(
      glyphController,
      {
        id: "preview",
        ends,
        signature: computeMarkerSignature(glyphController.flattenedPath),
      },
      this.skeletonData
    );
    if (geometry.stale) {
      return null;
    }
    return {
      point: geometry.anchorPoint,
      farPoint: geometry.farPoint,
      secondFarPoint: geometry.secondFarPoint,
    };
  }

  // What a C-click would place: the curvature marker, read exactly as the placed one is.
  curvaturePreviewAt(point) {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return null;
    }
    const glyphController = positionedGlyph.glyph;
    const end = this.curvatureEndAt(positionedGlyph, point);
    if (!end) {
      return null;
    }
    const geometry = markerGeometry(
      glyphController,
      this.curvatureMarker(glyphController, end),
      this.skeletonData
    );
    return geometry.stale ? null : { point: geometry.point, curvature: geometry };
  }

  curvatureMarker(glyphController, end) {
    return {
      kind: "curvature",
      ends: [end],
      signature: computeMarkerSignature(glyphController.flattenedPath),
    };
  }

  // Where a curvature marker placed at `point` sits: the outline or centerline under
  // the cursor, snapped onto the apex of its curve when the cursor is near it.
  curvatureEndAt(positionedGlyph, point) {
    const end = this.anchorageAt(positionedGlyph, point);
    return end
      ? snapToCurvatureApex(
          end,
          {
            path: positionedGlyph.glyph.flattenedPath,
            skeletonData: this.skeletonData,
          },
          { x: point.x - positionedGlyph.x, y: point.y - positionedGlyph.y },
          this.sceneController.mouseClickMargin * CURVATURE_APEX_REACH
        )
      : end;
  }

  anchorageAt(positionedGlyph, point) {
    const glyphController = positionedGlyph.glyph;
    return nearestMarkerAnchorage(
      glyphController.flattenedPathHitTester,
      glyphController.flattenedPath,
      { x: point.x - positionedGlyph.x, y: point.y - positionedGlyph.y },
      this.skeletonData
    );
  }

  deactivate() {
    setMarkerPlacementPreview(null);
    this.releaseCurvatureKey();
    super.deactivate();
  }

  // C is held, not toggled. Its release is watched on the window, so a release outside
  // the canvas or a lost focus still ends it.
  holdCurvatureKey() {
    if (this.curvatureKeyDown) {
      return;
    }
    this.curvatureKeyDown = true;
    this._curvatureKeyUp = (event) => {
      if (event.type === "blur" || isCurvatureKey(event)) {
        this.releaseCurvatureKey();
      }
    };
    window.addEventListener("keyup", this._curvatureKeyUp);
    window.addEventListener("blur", this._curvatureKeyUp);
    this.refreshHover();
  }

  releaseCurvatureKey() {
    if (!this.curvatureKeyDown) {
      return;
    }
    this.curvatureKeyDown = false;
    window.removeEventListener("keyup", this._curvatureKeyUp);
    window.removeEventListener("blur", this._curvatureKeyUp);
    this._curvatureKeyUp = null;
    this.refreshHover();
  }

  refreshHover() {
    if (this.lastHoverEvent) {
      this.handleHover(this.lastHoverEvent);
    }
  }

  setCursor() {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.pointerTool.setCursor();
      return;
    }
    this.canvasController.canvas.style.cursor = "crosshair";
  }

  handleKeyDown(event) {
    if (isCurvatureKey(event)) {
      event.stopImmediatePropagation();
      this.holdCurvatureKey();
      return;
    }
    if (event.key !== "Backspace") {
      return super.handleKeyDown(event);
    }
    const doomed = markerIdsIn(this.sceneController.selection);
    if (!doomed.length) {
      return;
    }
    event.stopImmediatePropagation();
    deleteMarkers(this.sceneController, doomed);
    this.sceneController.selection = new Set();
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.pointerTool.handleDrag(eventStream, initialEvent);
      return;
    }

    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      await this.pointerTool.handleDrag(eventStream, initialEvent);
      return;
    }

    const point = this.sceneController.localPoint(initialEvent);
    const size = this.sceneController.mouseClickMargin;
    const markerTarget = this.sceneModel.markerAtPoint(point, size, positionedGlyph);

    if (markerTarget) {
      if (initialEvent.detail == 2 || initialEvent.myTapCount == 2) {
        eventStream.done();
        await deleteMarkers(this.sceneController, [markerTarget.markerId]);
        return;
      }
      this.sceneController.selection = new Set([
        markerTarget.endIndex === undefined
          ? `marker/${markerTarget.markerId}`
          : `markerEnd/${markerTarget.markerId}/${markerTarget.endIndex}`,
      ]);
      if (initialEvent.ctrlKey) {
        eventStream.done();
        await unaimMarker(
          this.sceneController,
          markerTarget.markerId,
          positionedGlyph.glyph.flattenedPath
        );
        return;
      }
      if (await shouldInitiateDrag(eventStream, initialEvent)) {
        await handleMarkerDrag({
          sceneController: this.sceneController,
          eventStream,
          initialEvent,
          markerId: markerTarget.markerId,
          endIndex: markerTarget.endIndex,
          extraLines: rulerExtraLinesFor(this.editor, this.sceneController),
        });
      }
      return;
    }

    // Alt places a dimension, two clicks on two points. Anything else places a ray on the
    // contour under the cursor.
    const local = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };
    // C held places a curvature marker on the outline or centerline under the cursor.
    if (this.curvatureKeyDown) {
      const end = this.curvatureEndAt(positionedGlyph, point);
      if (!end) {
        await this.pointerTool.handleDrag(eventStream, initialEvent);
        return;
      }
      eventStream.done();
      const glyphController = positionedGlyph.glyph;
      await placeMarker(
        this.sceneController,
        () => this.curvatureMarker(glyphController, end),
        "Place Curvature Marker"
      );
      return;
    }
    // Alt places a dimension. A click on a point takes it as one end, and the next
    // click the other: a direct dimension. Dragging from the second point instead, or
    // from a segment, draws an axis dimension -- across or up, by the drag.
    if (initialEvent.altKey) {
      await this.handleDimensionDrag(eventStream, initialEvent, positionedGlyph, local);
      return;
    }

    // A ray takes hold of whatever is nearest and within reach — an outline, or the
    // centerline of a stroke. The centerline is not outline geometry, so asking only the
    // path leaves the skeleton invisible to this tool.
    const glyphController = positionedGlyph.glyph;
    const end = nearestMarkerAnchorage(
      glyphController.flattenedPathHitTester,
      glyphController.flattenedPath,
      local,
      this.skeletonData
    );
    if (!end) {
      await this.pointerTool.handleDrag(eventStream, initialEvent);
      return;
    }
    await this.aimAndPlaceRay(eventStream, initialEvent, positionedGlyph, end);
  }

  // A quick press places a plain ray along the normal. Holding the button for the hold
  // time aims it: from then on the ray leaves the anchor toward the cursor, and it is
  // placed where the button is released. The hold keeps an ordinary click, which always
  // moves the mouse a little, from turning the ray by accident.
  async aimAndPlaceRay(eventStream, initialEvent, positionedGlyph, end) {
    const glyphController = positionedGlyph.glyph;
    const anchor = resolveMarkerEnd(end, {
      path: glyphController.flattenedPath,
      skeletonData: this.skeletonData,
    });
    if (anchor.verdict !== "ok") {
      return;
    }
    let direction = null;
    for await (const event of eventStream) {
      if (event.type !== "mousemove" && event.type !== "mouseup") {
        continue;
      }
      const point = this.sceneController.localPoint(event);
      const local = {
        x: point.x - positionedGlyph.x,
        y: point.y - positionedGlyph.y,
      };
      if (aimHoldElapsed(initialEvent, event)) {
        direction =
          aimTowards(anchor.point, local, {
            constrain: event.shiftKey,
            path: glyphController.flattenedPath,
            snapRadius: this.sceneController.mouseClickMargin,
          }) || direction;
      }
      if (event.type === "mouseup") {
        break;
      }
      if (!direction) {
        continue;
      }
      setMarkerPlacementPreview(
        this.rayPreview(glyphController, this.rayEnds(glyphController, end, direction))
      );
      this.canvasController.requestUpdate();
    }
    setMarkerPlacementPreview(null);
    await this.placeRay(
      glyphController,
      this.rayEnds(glyphController, end, direction || undefined)
    );
  }

  async placeRay(glyphController, ends) {
    const signature = computeMarkerSignature(glyphController.flattenedPath);
    await placeMarker(this.sceneController, () => ({ ends, signature }));
  }

  get skeletonData() {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    return positionedGlyph
      ? getSkeletonData(this.sceneModel._getEditLayerGlyph(positionedGlyph))
      : null;
  }

  // A dimension takes two clicks. The first is remembered on the tool and nothing is
  // written; the second writes the whole marker, so a half-placed dimension never
  // reaches the file.
  async handleDimensionDrag(eventStream, initialEvent, positionedGlyph, local) {
    const glyphController = positionedGlyph.glyph;
    const path = glyphController.flattenedPath;
    const margin = this.sceneController.mouseClickMargin;
    // A point right under the cursor wins; then a segment under it; then the nearest
    // point within the placement radius, as a plain click always found.
    const pointEnd = nearestPathPointEnd(path, local, margin);
    const segmentEnds = pointEnd ? null : segmentEndsAt(glyphController, local, margin);
    const end = pointEnd || (segmentEnds ? null : nearestPathPointEnd(path, local));
    if (!end && !segmentEnds) {
      await this.pointerTool.handleDrag(eventStream, initialEvent);
      return;
    }
    const dragging = await shouldInitiateDrag(eventStream, initialEvent);
    if (segmentEnds) {
      if (dragging) {
        await this.dragAxisDimension(eventStream, positionedGlyph, segmentEnds, local);
      }
      return;
    }
    if (dragging && this.pendingDimensionEnd) {
      const first = this.pendingDimensionEnd;
      this.pendingDimensionEnd = null;
      await this.dragAxisDimension(eventStream, positionedGlyph, [first, end], local);
      return;
    }
    await this.placeDimensionEnd(glyphController, end);
  }

  // The drag that makes an axis dimension. It measures across when the drag runs
  // mostly up or down, and up when it runs mostly sideways, the way a CAD linear
  // dimension follows the cursor; its measure line sits where the cursor is.
  async dragAxisDimension(eventStream, positionedGlyph, ends, startLocal) {
    const glyphController = positionedGlyph.glyph;
    const signature = computeMarkerSignature(glyphController.flattenedPath);
    let placed = null;
    for await (const event of eventStream) {
      if (event.type !== "mousemove" && event.type !== "mouseup") {
        continue;
      }
      const point = this.sceneController.localPoint(event);
      const local = { x: point.x - positionedGlyph.x, y: point.y - positionedGlyph.y };
      const dx = local.x - startLocal.x;
      const dy = local.y - startLocal.y;
      if (Math.hypot(dx, dy) > 0) {
        const axis = Math.abs(dy) >= Math.abs(dx) ? "x" : "y";
        placed = { axis, line: Math.round(axis === "x" ? local.y : local.x) };
      }
      if (event.type === "mouseup") {
        break;
      }
      if (placed) {
        const geometry = markerGeometry(
          glyphController,
          { id: "preview", ends, signature, ...placed },
          this.skeletonData
        );
        setMarkerPlacementPreview(
          geometry.stale ? null : { point: geometry.points[0], dimension: geometry }
        );
        this.canvasController.requestUpdate();
      }
    }
    setMarkerPlacementPreview(null);
    this.canvasController.requestUpdate();
    if (!placed) {
      return;
    }
    await placeMarker(
      this.sceneController,
      () => ({ ends, signature, ...placed }),
      "Place Dimension"
    );
  }

  async placeDimensionEnd(glyphController, end) {
    if (!this.pendingDimensionEnd) {
      this.pendingDimensionEnd = end;
      return true;
    }
    const first = this.pendingDimensionEnd;
    this.pendingDimensionEnd = null;
    const signature = computeMarkerSignature(glyphController.flattenedPath);
    await placeMarker(
      this.sceneController,
      () => ({ ends: [first, end], signature }),
      "Place Dimension"
    );
    return true;
  }
}

const PLACE_DIMENSION_RADIUS = 30;

// A dimension runs between points a designer placed. An off-curve is a handle that
// shapes a curve, not a place on the drawing, so it is not offered.
function nearestPathPointEnd(path, local, radius = PLACE_DIMENSION_RADIUS) {
  const best = nearestOnCurvePoint(path, local);
  if (!best || best.distance > radius) {
    return undefined;
  }
  return withAnchorPosition(
    {
      kind: "pathPoint",
      contourIndex: best.contourIndex,
      pointIndex: best.pointIndex,
    },
    path
  );
}

// The two on-curve points of the segment under the cursor, as dimension ends, or null
// where no segment is within `margin`.
function segmentEndsAt(glyphController, local, margin) {
  const hit = glyphController.flattenedPathHitTester.findNearest(local);
  if (!hit?.segment || Math.hypot(hit.x - local.x, hit.y - local.y) > margin) {
    return null;
  }
  const path = glyphController.flattenedPath;
  const indices = hit.segment.pointIndices;
  return [indices[0], indices.at(-1)].map((absolute) => {
    const [contourIndex, pointIndex] = path.getContourAndPointIndex(absolute);
    return withAnchorPosition({ kind: "pathPoint", contourIndex, pointIndex }, path);
  });
}

// C with no modifier. Ctrl+C and friends stay the editor's.
function isCurvatureKey(event) {
  return (
    (event.key === "c" || event.key === "C" || event.code === "KeyC") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

function markerIdsIn(selection) {
  const parsed = parseSelection(selection || []);
  return [
    ...(parsed.marker || []).map(String),
    ...(parsed.markerEnd || []).map((key) => String(key).split("/")[0]),
  ];
}
