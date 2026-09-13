import * as html from "@fontra/core/html-utils.js";
import Panel from "./panel.js";
import SkeletonParametersPanel from "./panel-skeleton-parameters.js";
import TransformationPanel from "./panel-transformation.js";

// One "Selection" sidebar tab composing the former Transformation and
// Skeleton parameters panels (ticket 05). Each part keeps its own form,
// its own rebuild trigger and its own in-place update, so a skeleton edit
// does not rebuild the transform fields and steal focus, or vice versa.
export default class SelectionPanel extends Panel {
  identifier = "selection";
  iconPath = "/tabler-icons/shape.svg";

  getContentElement() {
    return html.div({ class: "panel" }, []);
  }

  constructor(editorController) {
    super(editorController);
    // Panel's own constructor calls getContentElement() before this body
    // runs, so contentElement already exists here.
    this.transformationPart = new TransformationPanel(
      editorController,
      this.contentElement
    );
    this.skeletonPart = new SkeletonParametersPanel(
      editorController,
      this.contentElement
    );
  }

  async toggle(on, focus) {
    await this.transformationPart.toggle(on, focus);
    await this.skeletonPart.toggle(on, focus);
  }
}

customElements.define("panel-selection", SelectionPanel);
