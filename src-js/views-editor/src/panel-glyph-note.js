import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { throttleCalls } from "@fontra/core/utils.ts";
import "@fontra/web-components/ui-text-input.js";
import Panel from "./panel.js";

export default class GlyphNotePanel extends Panel {
  identifier = "glyph-note";
  iconPath = "/tabler-icons/notes.svg";

  constructor(editorController) {
    super(editorController);
    this.throttledUpdate = throttleCalls((senderID) => this.update(senderID), 100);
    this.sceneController = this.editorController.sceneController;

    this.setupGlyphNoteElement();

    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName", "selection"],
      (event) => this.throttledUpdate()
    );

    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.throttledUpdate(event.senderID);
    });
  }

  // A card: the heading with the glyph's name beside it, over the note in
  // the several-line input/text.
  getContentElement() {
    return html.div({ class: "panel" }, [
      html.div({ class: "card-column panel-section--flex" }, [
        html.div({ class: "card" }, [
          html.div({ class: "card-heading-row" }, [
            html.div({ class: "card-heading" }, [translate("sidebar.glyph-note")]),
            html.div({ class: "section-label", id: "glyph-note-header" }),
          ]),
          html.createDomElement("ui-text-input", {
            id: "glyph-note-textarea",
            multiline: true,
          }),
        ]),
      ]),
    ]);
  }

  setupGlyphNoteElement() {
    this.glyphNoteElement = this.contentElement.querySelector("#glyph-note-textarea");
    this.glyphNoteHeaderElement =
      this.contentElement.querySelector("#glyph-note-header");

    this.glyphNoteElement.addEventListener("change", () => {
      if (!this._selectedGlyphName) {
        return;
      }
      saveGlyphNote(
        this._selectedGlyphName,
        this.sceneController,
        this.glyphNoteElement.value
      );
    });
  }

  async update() {
    // This method is called when the panel is opened or when the selected glyph changes.
    // Therefore we need to update the glyph note text area with the current glyph note
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;

    this._selectedGlyphName = varGlyph?.name;

    this.glyphNoteHeaderElement.textContent = varGlyph
      ? varGlyph.name
      : translate("sidebar.glyph-note.no-glyph-selected");
    const glyphNote = varGlyph?.customData["fontra.glyph.note"] ?? "";
    this.glyphNoteElement.value = glyphNote;
    this.glyphNoteElement.disabled = !varGlyph;
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
      // Delay focusing until after the panel slide in animation,
      // or else the sliding animation will look glitchy
      setTimeout(() => this.glyphNoteElement.focus(), 200);
    }
  }
}

async function saveGlyphNote(glyphName, sceneController, newNote) {
  await sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
    const oldNote = glyph.customData["fontra.glyph.note"];
    glyph.customData["fontra.glyph.note"] = newNote;
    return translate(
      oldNote
        ? newNote
          ? "sidebar.glyph-note.undo.edit"
          : "sidebar.glyph-note.undo.delete"
        : "sidebar.glyph-note.undo.add"
    );
  });
}

customElements.define("panel-glyph-note", GlyphNotePanel);
