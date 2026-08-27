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
  name: "sidebar.user-settings.composition-mark-cloud",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
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
