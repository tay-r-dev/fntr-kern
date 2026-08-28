import { computeMarkerSignature } from "@fontra/core/marker-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import { deleteMarkers, handleMarkerDrag, placeMarker } from "./marker-editing.js";

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

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.pointerTool.handleHover(event);
      return;
    }
    this.setCursor();
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
      return;
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
    const placed = initialEvent.altKey
      ? await this.placeDimensionEnd(positionedGlyph, local)
      : await this.placeRay(positionedGlyph, local);
    if (!placed) {
      await this.pointerTool.handleDrag(eventStream, initialEvent);
      return;
    }
    eventStream.done();
  }

  async placeRay(positionedGlyph, local) {
    const glyphController = positionedGlyph.glyph;
    const hit = glyphController.flattenedPathHitTester.findNearest(local);
    if (!hit || hit.contourIndex === undefined) {
      return false;
    }
    const signature = computeMarkerSignature(glyphController.flattenedPath);
    await placeMarker(this.sceneController, () => ({
      ends: [
        {
          kind: "pathSegment",
          contourIndex: hit.contourIndex,
          segmentIndex: hit.segmentIndex,
          t: hit.t,
        },
        { kind: "cast" },
      ],
      signature,
    }));
    return true;
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

function nearestPathPointEnd(path, local) {
  let best;
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    const numPoints = path.getNumPointsOfContour(contourIndex);
    for (let pointIndex = 0; pointIndex < numPoints; pointIndex++) {
      const candidate = path.getContourPoint(contourIndex, pointIndex);
      const distance = Math.hypot(candidate.x - local.x, candidate.y - local.y);
      if (!best || distance < best.distance) {
        best = { distance, contourIndex, pointIndex };
      }
    }
  }
  if (!best || best.distance > PLACE_DIMENSION_RADIUS) {
    return undefined;
  }
  return {
    kind: "pathPoint",
    contourIndex: best.contourIndex,
    pointIndex: best.pointIndex,
  };
}

function markerIdsIn(selection) {
  const parsed = parseSelection(selection || []);
  return [
    ...(parsed.marker || []).map(String),
    ...(parsed.markerEnd || []).map((key) => String(key).split("/")[0]),
  ];
}
