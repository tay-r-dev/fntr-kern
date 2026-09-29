import { translate } from "@fontra/core/localization.js";
import { slicePaths } from "@fontra/core/path-functions.js";
import { getSkeletonData, setSkeletonData } from "@fontra/core/skeleton-model.js";
import { mapObjectValues, zip } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import { constrainHorVerDiag } from "./edit-behavior.js";
import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import {
  markGeneratedContoursForRemap,
  readGeneratedContourRemap,
  remapGeneratedEntries,
} from "./skeleton-editing.js";
import {
  fillRoundNode,
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeLine,
} from "./visualization-layer-definitions.js";

export class KnifeTool extends BaseTool {
  iconPath = "/images/knifetool.svg";
  identifier = "knife-tool";

  setCursor() {
    if (this.sceneModel.selectedGlyph?.isEditing) {
      this.canvasController.canvas.style.cursor = "crosshair";
    }
  }

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this.setCursor();
  }

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }

    if (!(await shouldInitiateDrag(eventStream, initialEvent))) {
      return;
    }

    const pointA = this.sceneController.selectedGlyphPoint(initialEvent);
    this.sceneModel.knifeToolPointA = pointA;
    const glyphController = await this.sceneModel.getSelectedStaticGlyphController();

    let pointB;
    let intersections;
    for await (const event of eventStream) {
      const point = this.sceneController.selectedGlyphPoint(event);
      if (point.x === undefined) {
        // We can receive non-pointer events like keyboard events: ignore
        continue;
      }

      if (event.shiftKey) {
        const delta = constrainHorVerDiag(vector.subVectors(point, pointA));
        pointB = vector.addVectors(pointA, delta);
      } else {
        pointB = point;
      }

      this.sceneModel.knifeToolPointB = pointB;
      // Skeleton-generated contours are derived geometry: the knife must not
      // slice them, so their intersections are neither shown nor cut.
      this.sceneModel.knifeToolIntersections = intersections =
        glyphController.pathHitTester
          .lineIntersections(pointA, pointB)
          .filter(
            (intersection) =>
              !this.sceneModel.isGeneratedPathContour(intersection.contourIndex)
          );

      this.canvasController.requestUpdate();
    }

    delete this.sceneModel.knifeToolPointB;
    delete this.sceneModel.knifeToolIntersections;
    this.canvasController.requestUpdate();

    if (intersections.length >= 1) {
      this.doSliceGlyph(intersections);
    }
  }

  async doSliceGlyph(intersections) {
    this.sceneController.selection = new Set(); // Clear selection

    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    const varGlyph = positionedGlyph.varGlyph.glyph;
    const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
      varGlyph.layers
    );
    const layerPaths = mapObjectValues(editLayerGlyphs, (layerGlyph) =>
      layerGlyph.path.copy()
    );

    // Slicing restructures the contour list arbitrarily (splits, merges,
    // reinsertions), so generated-contour indices can't be maintained by a
    // simple shift. The generated contours themselves are never sliced (their
    // intersections are filtered out above), so carry their identity through
    // the slice with temporary point attributes and re-derive the indices.
    const markedSkeletons = markGeneratedContours(editLayerGlyphs, layerPaths);

    slicePaths(intersections, ...Object.values(layerPaths));

    const updatedSkeletons = remapGeneratedContours(markedSkeletons, layerPaths);

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        for (const [layerName, layerPath] of Object.entries(layerPaths)) {
          glyph.layers[layerName].glyph.path = layerPath;
          if (updatedSkeletons[layerName]) {
            setSkeletonData(glyph.layers[layerName].glyph, updatedSkeletons[layerName]);
          }
        }
        return translate("edit-tools-knife.undo.slice-glyph");
      },
      undefined,
      true
    );
  }

  deactivate() {
    super.deactivate();
    this.canvasController.requestUpdate();
  }
}

// Tag the generated contours on each layer's path copy so their indices can
// be re-derived after slicing. Returns { layerName: skeletonData } for the
// layers that have generated contours.
function markGeneratedContours(editLayerGlyphs, layerPaths) {
  const markedSkeletons = {};
  for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
    const skeletonData = getSkeletonData(layerGlyph);
    if (!skeletonData?.generated?.length) {
      continue;
    }
    markGeneratedContoursForRemap(layerPaths[layerName], skeletonData);
    markedSkeletons[layerName] = skeletonData;
  }
  return markedSkeletons;
}

// Find the markers again after slicing (stripping them from the paths) and
// rewrite each layer's generated pathContourIndex bookkeeping.
function remapGeneratedContours(markedSkeletons, layerPaths) {
  const updatedSkeletons = {};
  for (const [layerName, skeletonData] of Object.entries(markedSkeletons)) {
    const remap = readGeneratedContourRemap(layerPaths[layerName]);
    updatedSkeletons[layerName] = remapGeneratedEntries(skeletonData, remap);
  }
  return updatedSkeletons;
}

registerVisualizationLayerDefinition({
  identifier: "fontra.knifetool.line",
  name: "Knife tool line",
  selectionFunc: glyphSelector("editing"),
  zIndex: 500,
  screenParameters: { strokeWidth: 1, nodeSize: 10 },
  colors: { strokeColor: "#1118", nodeColor: "#3080FF80" },
  colorsDarkMode: { strokeColor: "#FFFB", nodeColor: "#50A0FF80" },
  draw: ({ context, positionedGlyph, parameters, model, controller }) => {
    const pointA = model.knifeToolPointA;
    const pointB = model.knifeToolPointB;
    if (!pointA || !pointB) {
      return;
    }

    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;
    strokeLine(context, pointA.x, pointA.y, pointB.x, pointB.y);

    context.fillStyle = parameters.nodeColor;
    for (const intersection of model.knifeToolIntersections) {
      fillRoundNode(context, intersection, parameters.nodeSize);
    }
  },
});
