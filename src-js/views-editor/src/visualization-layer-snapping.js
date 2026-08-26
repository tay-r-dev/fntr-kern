import { KIND } from "@fontra/core/snapping.js";
import {
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeLine,
} from "./visualization-layer-definitions.js";

// A snap the designer cannot account for reads as a bug, so every held candidate
// is drawn back to the geometry it came from. A guide the designer placed and one
// the editor invented are drawn differently, because they behave differently.
const PERMANENT_KINDS = new Set([
  KIND.METRIC,
  KIND.GUIDE_ORTHOGONAL,
  KIND.GUIDE_SLANTED,
  KIND.GUIDE_INTERSECTION,
]);

registerVisualizationLayerDefinition({
  identifier: "fontra.snapping.guides",
  name: "sidebar.user-settings.snapping-guides",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 600,
  screenParameters: { strokeWidth: 1, dash: 4, markerRadius: 3 },
  colors: { permanentColor: "#00BFFF", smartColor: "#FF5FA2" },
  colorsDarkMode: { permanentColor: "#00BFFFC0", smartColor: "#FF8FC0" },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const held = model.snapHeldCandidates || [];
    if (!held.length) {
      return;
    }
    const { xMin, yMin, xMax, yMax } = controller.getViewBox();
    const reach = Math.max(Math.hypot(xMax - xMin, yMax - yMin), 2000);
    context.lineWidth = parameters.strokeWidth;
    context.setLineDash([parameters.dash, parameters.dash]);
    for (const candidate of held) {
      if (candidate.type !== "line") {
        continue;
      }
      context.strokeStyle = PERMANENT_KINDS.has(candidate.kind)
        ? parameters.permanentColor
        : parameters.smartColor;
      // The line is drawn through the source, so the reason for the snap is visible.
      strokeLine(
        context,
        candidate.source.x - candidate.dx * reach,
        candidate.source.y - candidate.dy * reach,
        candidate.source.x + candidate.dx * reach,
        candidate.source.y + candidate.dy * reach
      );
      context.beginPath();
      context.arc(
        candidate.source.x,
        candidate.source.y,
        parameters.markerRadius,
        0,
        2 * Math.PI
      );
      context.stroke();
    }
    context.setLineDash([]);
  },
});
