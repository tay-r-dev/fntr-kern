import {
  glyphSelector,
  registerVisualizationLayerDefinition,
} from "./visualization-layer-definitions.js";

export const LetterspacerVisualizationLayer = {
  identifier: "letterspacer-visualization",
  name: "Letterspacer",
  selectionMode: "editing",
  userSwitchable: true,
  defaultOn: true,
  zIndex: 500,
  selectionFunc: glyphSelector("editing"),

  draw: ({ context, positionedGlyph, parameters, model, controller }) => {
    if (!positionedGlyph) return;

    const { path } = positionedGlyph.glyph;
    if (!path || path.coordinates.length === 0) return;

    let vizData = null;
    if (model && model.letterspacerVisualizationData) {
      vizData = model.letterspacerVisualizationData;
    } else {
      return;
    }

    if (!vizData.scanLines || vizData.scanLines.length === 0) return;

    context.save();
    const opacity =
      typeof vizData.opacity === "number"
        ? Math.max(0, Math.min(1, vizData.opacity))
        : 1;
    context.globalAlpha *= opacity;

    // Draw depth-limited margins (where algorithm actually looks)
    if (vizData.leftMarginsProcessed && vizData.rightMarginsProcessed) {
      context.strokeStyle = "rgba(255, 100, 100, 0.6)";
      context.lineWidth = 1.5;
      context.setLineDash([]);
      context.beginPath();
      // Left margins
      for (const p of vizData.leftMarginsProcessed) {
        context.moveTo(p.x - 4, p.y);
        context.lineTo(p.x + 4, p.y);
      }
      // Right margins
      for (const p of vizData.rightMarginsProcessed) {
        context.moveTo(p.x - 4, p.y);
        context.lineTo(p.x + 4, p.y);
      }
      context.stroke();
    }

    // Draw depth limit lines (showing the depth boundary)
    if (vizData.leftDepthLimit !== null && vizData.leftDepthLimit !== undefined) {
      context.strokeStyle = "rgba(255, 165, 0, 0.8)"; // Orange for depth limit
      context.lineWidth = 2;
      context.setLineDash([5, 5]);
      context.beginPath();
      context.moveTo(vizData.leftDepthLimit, vizData.referenceBounds?.minY || 0);
      context.lineTo(vizData.leftDepthLimit, vizData.referenceBounds?.maxY || 1000);
      context.stroke();
    }

    if (vizData.rightDepthLimit !== null && vizData.rightDepthLimit !== undefined) {
      context.strokeStyle = "rgba(255, 165, 0, 0.8)"; // Orange for depth limit
      context.lineWidth = 2;
      context.setLineDash([5, 5]);
      context.beginPath();
      context.moveTo(vizData.rightDepthLimit, vizData.referenceBounds?.minY || 0);
      context.lineTo(vizData.rightDepthLimit, vizData.referenceBounds?.maxY || 1000);
      context.stroke();
      context.setLineDash([]);
    }

    // Draw left sidebearing polygon (penetration area)
    if (vizData.leftSBPolygon && vizData.leftSBPolygon.length > 0) {
      context.strokeStyle = "rgba(0, 200, 0, 0.8)";
      context.fillStyle = "rgba(0, 200, 0, 0.15)";
      context.lineWidth = 1;
      context.beginPath();
      const firstPoint = vizData.leftSBPolygon[0];
      context.moveTo(firstPoint.x, firstPoint.y);
      for (let i = 1; i < vizData.leftSBPolygon.length; i++) {
        context.lineTo(vizData.leftSBPolygon[i].x, vizData.leftSBPolygon[i].y);
      }
      context.closePath();
      context.fill();
      context.stroke();

      // Draw sidebearing line
      if (vizData.leftSBLine !== null && vizData.leftSBLine !== undefined) {
        context.strokeStyle = "rgba(0, 150, 0, 0.9)";
        context.lineWidth = 2;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(vizData.leftSBLine, vizData.referenceBounds?.minY || 0);
        context.lineTo(vizData.leftSBLine, vizData.referenceBounds?.maxY || 1000);
        context.stroke();
      }
    }

    // Draw right sidebearing polygon (penetration area)
    if (vizData.rightSBPolygon && vizData.rightSBPolygon.length > 0) {
      context.strokeStyle = "rgba(0, 100, 200, 0.8)";
      context.fillStyle = "rgba(0, 100, 200, 0.15)";
      context.lineWidth = 1;
      context.beginPath();
      const firstPoint = vizData.rightSBPolygon[0];
      context.moveTo(firstPoint.x, firstPoint.y);
      for (let i = 1; i < vizData.rightSBPolygon.length; i++) {
        context.lineTo(vizData.rightSBPolygon[i].x, vizData.rightSBPolygon[i].y);
      }
      context.closePath();
      context.fill();
      context.stroke();

      // Draw sidebearing line
      if (vizData.rightSBLine !== null && vizData.rightSBLine !== undefined) {
        context.strokeStyle = "rgba(0, 50, 150, 0.9)";
        context.lineWidth = 2;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(vizData.rightSBLine, vizData.referenceBounds?.minY || 0);
        context.lineTo(vizData.rightSBLine, vizData.referenceBounds?.maxY || 1000);
        context.stroke();
      }
    }

    // Draw scan lines (faint)
    if (vizData.scanLines && vizData.scanLines.length > 0) {
      context.strokeStyle = "rgba(255, 0, 0, 0.15)";
      context.lineWidth = 0.5;
      context.setLineDash([2, 4]);
      context.beginPath();
      for (const scanLine of vizData.scanLines) {
        context.moveTo(scanLine.start.x, scanLine.start.y);
        context.lineTo(scanLine.end.x, scanLine.end.y);
      }
      context.stroke();
      context.setLineDash([]);
    }

    context.restore();
  },
};

registerVisualizationLayerDefinition(LetterspacerVisualizationLayer);
