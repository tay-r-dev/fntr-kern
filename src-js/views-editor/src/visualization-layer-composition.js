import {
  glyphSelector,
  registerVisualizationLayerDefinition,
} from "./visualization-layer-definitions.js";

// The mark cloud. Every mark that can attach to the open base glyph, drawn
// where the solve would put it. It writes nothing, and it holds no state of its
// own: the panel computes the placements and leaves them on the scene model,
// because instantiating a glyph is asynchronous and a draw is not.
// Spec section 8.

registerVisualizationLayerDefinition({
  identifier: "fontra.composition.mark-cloud",
  name: "Mark cloud",
  selectionFunc: glyphSelector("editing"),
  // Not user-switchable: the panel's own switch governs the cloud, and a second
  // switch in the View menu would let one of them silently overrule the other.
  // The draw returns at once while the cloud is empty, so an always-visible
  // layer costs nothing when the panel switch is off.
  userSwitchable: false,
  zIndex: 200,
  screenParameters: { strokeWidth: 1 },
  colors: { fillColor: "#00BFFF30", strokeColor: "#00BFFF80" },
  colorsDarkMode: { fillColor: "#7FE0FF30", strokeColor: "#7FE0FF80" },

  draw: (context, positionedGlyph, parameters, model, controller) => {
    const cloud = model?.compositionMarkCloud;
    if (!cloud?.length) {
      return;
    }

    context.fillStyle = parameters.fillColor;
    context.strokeStyle = parameters.strokeColor;
    context.lineWidth = parameters.strokeWidth;

    for (const mark of cloud) {
      if (!mark.path2d) {
        continue;
      }
      context.save();
      context.translate(mark.offset[0], mark.offset[1]);
      context.fill(mark.path2d);
      context.stroke(mark.path2d);
      context.restore();
    }
  },
});
