import * as html from "@fontra/core/html-utils.js";
import Panel from "./panel.js";

// Everything the Designspace panel's design leaves out: Tunni, Skeleton,
// Speedpunk, snapping and smart guides, and the debug sections. They are that
// panel's own accordion, built and wired there; this panel shows it as an
// accordion switch in one card.
export default class DebugPanel extends Panel {
  identifier = "debug";
  iconPath = "bug";
  tabLabel = "settings";

  constructor(editorController, accordion) {
    super(editorController);
    accordion.setAttribute("switch", "");
    this.contentElement.querySelector(".card").appendChild(accordion);
  }

  getContentElement() {
    return html.div({ class: "panel" }, [
      html.div({ class: "card-column panel-section--flex" }, [
        html.div({ class: "card" }, [html.div({ class: "card-heading" }, ["debug"])]),
      ]),
    ]);
  }
}

customElements.define("panel-debug", DebugPanel);
