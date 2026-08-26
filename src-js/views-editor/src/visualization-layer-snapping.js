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

// The ring breathes, so a live snap is distinguishable from a drawn guide at a
// glance. The canvas redraws on demand, so the layer drives its own frame while
// an indicator is on screen and stops the moment one is not.
let animationPending = false;

function requestAnimationTick(controller) {
  if (animationPending) {
    return;
  }
  animationPending = true;
  requestAnimationFrame(() => {
    animationPending = false;
    controller.requestUpdate();
  });
}

registerVisualizationLayerDefinition({
  identifier: "fontra.snapping.guides",
  name: "sidebar.user-settings.snapping-guides",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 600,
  screenParameters: {
    strokeWidth: 1,
    dash: 4,
    markerRadius: 3,
    ringRadius: 7,
    ringSwing: 3,
  },
  colors: { permanentColor: "#00BFFF", smartColor: "#FF5FA2", ringColor: "#00BFFF" },
  colorsDarkMode: {
    permanentColor: "#00BFFFC0",
    smartColor: "#FF8FC0",
    ringColor: "#7FE0FF",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const held = model.snapHeldCandidates || [];
    const indicator = model.snapIndicator;
    if (indicator) {
      drawIndicator(context, parameters, indicator);
      requestAnimationTick(controller);
    }
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

function drawIndicator(context, parameters, indicator) {
  // A held snap pulses at full strength. A snap still approaching holds a still,
  // faint ring that grows as the pull does, so the designer sees it coming.
  const phase = (Date.now() % 1000) / 1000;
  const swing = indicator.snapped ? Math.sin(phase * 2 * Math.PI) : 0;
  const radius = parameters.ringRadius + swing * parameters.ringSwing;
  context.save();
  context.globalAlpha = indicator.snapped ? 1 : 0.25 + 0.5 * indicator.strength;
  context.strokeStyle = parameters.ringColor;
  context.lineWidth = parameters.strokeWidth * (indicator.snapped ? 2 : 1);
  context.setLineDash([]);
  context.beginPath();
  context.arc(indicator.x, indicator.y, radius, 0, 2 * Math.PI);
  context.stroke();
  context.restore();
}
