import { measureRuler } from "@fontra/core/marker-measure.js";
import { aimedDirection, getMarkers, markerKind } from "@fontra/core/marker-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import {
  deleteMarkers,
  handleMarkerDrag,
  placeMarker,
  rulerPlacement,
} from "./marker-editing.js";
import { drawGrips, drawPill, eachMarker } from "./visualization-layer-markers.js";
import {
  fillCircle,
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeLine,
} from "./visualization-layer-definitions.js";

// The Power Ruler, kept. A ruler is a marker (kind "ruler"): a line through a place at
// an angle, measuring every span it crosses in the black and in the white. It is saved
// with the glyph like every other marker, a glyph holds as many as the designer places,
// and the Markers panel lists them in their own table.
//
// Click on the canvas away from the glyph's neighbours to place one: it runs square to
// the outline nearest to the click, and while the button is down it follows the cursor.
// Drag a ruler's dot to move it, double-click the dot to delete it, and Backspace
// deletes the selected ones. Shift holds a ruler to the horizontal, the vertical and the
// diagonals.

let thePowerRulerTool; // singleton

const POWER_RULER_IDENTIFIER = "fontra.power.ruler";

registerVisualizationLayerDefinition({
  identifier: POWER_RULER_IDENTIFIER,
  name: "sidebar.user-settings.glyph.powerruler",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 600,
  screenParameters: {
    strokeWidth: 1,
    fontSize: 12,
    intersectionRadius: 4,
    gripRadius: 4,
    hoverRingGap: 3,
  },
  colors: {
    strokeColor: "#0004",
    insideBlobColor: "#FFFB",
    insideTextColor: "#000B",
    outsideBlobColor: "#000B",
    outsideTextColor: "#FFFB",
    intersectionColor: "#F085",
    gripColor: "#08AD",
    selectedGripColor: "#06CF",
  },
  colorsDarkMode: {
    strokeColor: "#FFF6",
    insideBlobColor: "#444B",
    insideTextColor: "#FFFB",
    outsideBlobColor: "#FFFB",
    outsideTextColor: "#444B",
    intersectionColor: "#F696",
    gripColor: "#6BFD",
    selectedGripColor: "#9EFF",
  },
  draw: (context, positionedGlyph, parameters, model, controller) =>
    thePowerRulerTool?.draw(context, positionedGlyph, parameters, model, controller),
});

// The side-bearing lines a ruler measures against, as well as the outline: the two
// side bearings, and with the CJK design frame on, its four sides instead. The layer and
// the Markers panel both read spans through this, so they give the same numbers.
export function rulerExtraLines(editor, glyphController) {
  const extraLines = [];
  let doTopAndBottom = false;
  let left, right, top, bottom;
  if (editor.visualizationLayersSettings.model["fontra.cjk.design.frame"]) {
    doTopAndBottom = true;
    const { frameBottomLeft, frameHeight } =
      editor.cjkDesignFrame.cjkDesignFrameParameters;
    left = frameBottomLeft.x;
    right = glyphController.xAdvance - frameBottomLeft.x;
    bottom = frameBottomLeft.y;
    top = bottom + frameHeight;
  } else {
    left = 0;
    right = glyphController.xAdvance;
    top = editor.fontController.unitsPerEm;
    bottom = -editor.fontController.unitsPerEm;
  }

  for (const x of [left, right]) {
    extraLines.push({ p1: { x: x, y: bottom }, p2: { x: x, y: top } });
  }

  if (doTopAndBottom) {
    for (const y of [bottom, top]) {
      extraLines.push({ p1: { x: left, y: y }, p2: { x: right, y: y } });
    }
  }
  return extraLines;
}

export class PowerRulerTool extends BaseTool {
  iconPath = "/images/ruler.svg";
  identifier = "power-ruler-tool";

  constructor(editor) {
    super(editor);
    thePowerRulerTool = this;
    // The ruler being placed, before the button comes up and it is written.
    this.placing = null;
  }

  draw(context, positionedGlyph, parameters, model, controller) {
    const extraLines = rulerExtraLines(this.editor, positionedGlyph.glyph);
    for (const { geometry, isSelected, isHovered } of eachMarker(
      positionedGlyph,
      model,
      "ruler",
      { extraLines }
    )) {
      drawRuler(context, parameters, geometry);
      drawGrips(
        context,
        parameters,
        geometry.grips,
        isSelected,
        isHovered,
        isSelected ? parameters.selectedGripColor : parameters.gripColor
      );
    }
    if (this.placing) {
      const direction = aimedDirection({ angle: this.placing.angle });
      drawRuler(context, parameters, {
        ...measureRuler(
          positionedGlyph.glyph.flattenedPathHitTester,
          this.placing.at,
          direction,
          extraLines
        ),
      });
    }
  }

  haveHoveredGlyph(event) {
    const point = this.sceneController.localPoint(event);
    return !!this.sceneModel.glyphAtPoint(point);
  }

  // The ruler whose dot is under the cursor. Only rulers: this tool places and moves
  // rulers, and the marker tool is for the others.
  rulerAtPoint(event) {
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return undefined;
    }
    const point = this.sceneController.localPoint(event);
    const target = this.sceneModel.markerAtPoint(
      point,
      this.sceneController.mouseClickMargin,
      positionedGlyph
    );
    if (!target) {
      return undefined;
    }
    const marker = getMarkers(this.sceneModel._getEditLayerGlyph(positionedGlyph)).find(
      (candidate) => candidate.id === target.markerId
    );
    return marker && markerKind(marker) === "ruler" ? marker : undefined;
  }

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    const ruler = this.rulerAtPoint(event);
    this.sceneController.hoverSelection = ruler
      ? new Set([`marker/${ruler.id}`])
      : new Set();
    if (!ruler && this.haveHoveredGlyph(event)) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.canvasController.requestUpdate();
    this.setCursor();
  }

  setCursor() {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].setCursor();
    } else {
      this.canvasController.canvas.style.cursor = "default";
    }
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return;
    }

    const ruler = this.rulerAtPoint(initialEvent);
    if (ruler) {
      if (initialEvent.detail == 2 || initialEvent.myTapCount == 2) {
        eventStream.done();
        await deleteMarkers(this.sceneController, [ruler.id], "Delete Ruler");
        this.sceneController.selection = new Set();
        return;
      }
      this.sceneController.selection = new Set([`marker/${ruler.id}`]);
      if (await shouldInitiateDrag(eventStream, initialEvent)) {
        await handleMarkerDrag({
          sceneController: this.sceneController,
          eventStream,
          initialEvent,
          markerId: ruler.id,
          extraLines: rulerExtraLines(this.editor, positionedGlyph.glyph),
        });
      }
      return;
    }

    if (this.haveHoveredGlyph(initialEvent)) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }
    await this.placeRuler(eventStream, initialEvent, positionedGlyph);
  }

  // A new ruler follows the cursor while the button is down, and is written once, on
  // release, so placing one is one undo step.
  async placeRuler(eventStream, initialEvent, positionedGlyph) {
    const glyphController = positionedGlyph.glyph;
    const extraLines = rulerExtraLines(this.editor, glyphController);
    const placementAt = (event) => {
      const point = this.sceneController.localPoint(event);
      return rulerPlacement(
        glyphController.flattenedPathHitTester,
        { x: point.x - positionedGlyph.x, y: point.y - positionedGlyph.y },
        extraLines,
        event.shiftKey
      );
    };

    this.placing = placementAt(initialEvent);
    this.canvasController.requestUpdate();
    for await (const event of eventStream) {
      if (event.type === "mousemove" || event.type === "mouseup") {
        this.placing = placementAt(event) || this.placing;
        this.canvasController.requestUpdate();
      }
    }
    const placed = this.placing;
    this.placing = null;
    this.canvasController.requestUpdate();
    if (!placed) {
      return;
    }
    await placeMarker(
      this.sceneController,
      () => ({ kind: "ruler", ends: [], at: placed.at, angle: placed.angle }),
      "Place Ruler"
    );
  }

  handleKeyDown(event) {
    if (event.key === "Backspace") {
      const doomed = rulerIdsIn(this.sceneController.selection);
      if (doomed.length) {
        event.stopImmediatePropagation();
        deleteMarkers(this.sceneController, doomed, "Delete Ruler");
        this.sceneController.selection = new Set();
        return true;
      }
    }
    return super.handleKeyDown(event);
  }
}

function rulerIdsIn(selection) {
  return (parseSelection(selection || []).marker || []).map(String);
}

// One ruler's line, its crossings and its spans, in the look the Power Ruler always had:
// a span in the black on a light pill, a span in the white on a dark one.
function drawRuler(context, parameters, { intersections, measurePoints }) {
  if (!intersections || intersections.length < 2) {
    return;
  }
  const p1 = intersections[0];
  const p2 = intersections.at(-1);

  context.lineWidth = parameters.strokeWidth;
  context.strokeStyle = parameters.strokeColor;
  strokeLine(context, p1.x, p1.y, p2.x, p2.y);

  context.fillStyle = parameters.intersectionColor;
  for (const intersection of intersections) {
    fillCircle(context, intersection.x, intersection.y, parameters.intersectionRadius);
  }

  for (const measurePoint of measurePoints) {
    if (measurePoint.distance < 0.1) {
      continue;
    }
    drawPill(
      context,
      {
        ...parameters,
        blobColor: measurePoint.inside
          ? parameters.insideBlobColor
          : parameters.outsideBlobColor,
        textColor: measurePoint.inside
          ? parameters.insideTextColor
          : parameters.outsideTextColor,
      },
      measurePoint,
      measurePoint.distance.toString()
    );
  }
}
