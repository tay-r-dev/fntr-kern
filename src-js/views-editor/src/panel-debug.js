import * as html from "@fontra/core/html-utils.js";
import Panel from "./panel.js";

// Everything the Designspace panel's design leaves out: Tunni, Skeleton,
// Speedpunk, snapping and smart guides, and the debug sections. They are that
// panel's own accordion, built and wired there; this panel only shows it.
export default class DebugPanel extends Panel {
  identifier = "debug";
  iconPath = "/tabler-icons/bug.svg";

  constructor(editorController, accordion) {
    super(editorController);
    this.contentElement.firstChild.appendChild(accordion);
  }

  getContentElement() {
    return html.div({ class: "panel" }, [
      html.div({
        class: "panel-section panel-section--full-height panel-section--scrollable",
      }),
    ]);
  }
}

customElements.define("panel-debug", DebugPanel);
