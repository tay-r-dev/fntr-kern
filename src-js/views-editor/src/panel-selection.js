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
    // One scroll area for both parts, so the Skeleton block follows the
    // Transform block down one column instead of each taking half the height
    // and scrolling on its own.
    const scrollArea = html.div(
      {
        class:
          "panel-section panel-section--flex panel-section--scrollable selection-cards",
      },
      []
    );
    // Each part is a card on the sidebar's grey, 8px apart (Figma
    // 287:18592).
    this._appendStyle(`
      .selection-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background-color: var(--background-color);
      }

      .selection-cards > div {
        flex: none;
        padding: 8px;
        border: 1px solid #00000008;
        border-radius: 14px;
        background-color: var(--ui-element-background-color);
      }
    `);
    this.contentElement.appendChild(scrollArea);
    this.transformationPart = new TransformationPanel(editorController, scrollArea);
    this.skeletonPart = new SkeletonParametersPanel(editorController, scrollArea);
  }

  async toggle(on, focus) {
    await this.transformationPart.toggle(on, focus);
    await this.skeletonPart.toggle(on, focus);
  }
}

customElements.define("panel-selection", SelectionPanel);
