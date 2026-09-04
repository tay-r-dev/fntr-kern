// The kerning view (forkra "Kerning view and autokern", spec KERNING-VIEW.md).
//
// STUB: this is workstream 4, the plumbing only (widened views-editor exports,
// this workspace, its registration). It proves the cross-view import path
// works end to end. The left pane (scene, tools), the right pane (panel,
// pair table, run worker) and the source/cache wiring are later workstreams
// -- see spec §6, §7, §8. Nothing below renders a scene yet.
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { ViewController } from "@fontra/core/view-controller.js";
// Cross-view imports (spec §8: "widen the views-editor exports map and
// import across views"). Referenced here so a build genuinely resolves and
// bundles them, ahead of the scene actually being built.
import { BaseTool } from "@fontra/views-editor/edit-tools-base.js";
import { HandTool } from "@fontra/views-editor/edit-tools-hand.js";
import { MetricsTool } from "@fontra/views-editor/edit-tools-metrics.js";
import { SceneController } from "@fontra/views-editor/scene-controller.js";
import { SceneModel } from "@fontra/views-editor/scene-model.js";
import "@fontra/views-editor/visualization-layer-definitions.js";
import { VisualizationLayers } from "@fontra/views-editor/visualization-layers.js";

// Not yet used for anything beyond proving the import resolves at build
// time; the scene workstream constructs real instances of these.
const CROSS_VIEW_IMPORTS = {
  SceneController,
  SceneModel,
  BaseTool,
  HandTool,
  MetricsTool,
  VisualizationLayers,
};

export class KerningViewController extends ViewController {
  afterStart() {
    super.afterStart();
    const container = document.querySelector("#kerning-view-container");
    container.appendChild(
      html.div({ class: "kerning-view-stub" }, [translate("kerning.title")])
    );
    console.debug(
      "Kerning view plumbing loaded; cross-view imports resolved:",
      Object.keys(CROSS_VIEW_IMPORTS)
    );
  }
}
