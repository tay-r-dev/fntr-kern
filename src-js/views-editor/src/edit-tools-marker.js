import { aimCollapsedRay, markerGeometry } from "@fontra/core/marker-measure.js";
import {
  aimedCast,
  aimedRayOnPoint,
  computeMarkerSignature,
  nearestOnCurvePoint,
  resolveMarkerEnd,
  withAnchorPosition,
} from "@fontra/core/marker-model.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import {
  aimHoldElapsed,
  aimTowards,
  deleteMarkers,
  handleMarkerDrag,
  nearestMarkerAnchorage,
  placeMarker,
  unaimMarker,
} from "./marker-editing.js";
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
  }

  get pointerTool() {
    return this.editor.tools["pointer-tool"];
  }

  // The tool says what a click would do. Hovering a marker offers its grip; hovering a
  // contour previews the ray that would be placed there, cast and measured exactly as
  // the placement would cast it. Without this the tool aims blind.
  handleHover(event) {
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
      markerTarget ? null : this.previewAt(point, event.altKey)
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

  deactivate() {
    setMarkerPlacementPreview(null);
    super.deactivate();
  }

  setCursor() {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.pointerTool.setCursor();
      return;
    }
    this.canvasController.canvas.style.cursor = "crosshair";
  }

  handleKeyDown(event) {
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
    if (initialEvent.altKey) {
      if (!(await this.placeDimensionEnd(positionedGlyph, local))) {
        await this.pointerTool.handleDrag(eventStream, initialEvent);
        return;
      }
      eventStream.done();
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
  async placeDimensionEnd(positionedGlyph, local) {
    const glyphController = positionedGlyph.glyph;
    const end = nearestPathPointEnd(glyphController.flattenedPath, local);
    if (!end) {
      return false;
    }
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
function nearestPathPointEnd(path, local) {
  const best = nearestOnCurvePoint(path, local);
  if (!best || best.distance > PLACE_DIMENSION_RADIUS) {
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

function markerIdsIn(selection) {
  const parsed = parseSelection(selection || []);
  return [
    ...(parsed.marker || []).map(String),
    ...(parsed.markerEnd || []).map((key) => String(key).split("/")[0]),
  ];
}
