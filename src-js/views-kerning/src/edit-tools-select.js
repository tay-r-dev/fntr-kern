// The kerning view's pointer tool (spec KERNING-VIEW.md §6: "four tools only:
// pointer, sidebearing, kerning, hand"). This workstream builds pointer only.
//
// Deliberately NOT a PointerTools subclass and does NOT import anything from
// views-editor/src/edit-tools-pointer.js. That file is the real editor's
// point-editing tool: nothing in scene-model.js gates point-dragging behind
// an "isEditing" flag, so reusing it here would let someone reshape a
// glyph's outline from inside what the spec calls a read-only view. This was
// investigated and decided against -- see the workstream brief. This tool
// only ever selects/deselects a glyph in the string, or opens one for
// editing in a separate browser tab; it never sets `isEditing` on this
// view's own `sceneSettings`, and no code path here mutates font data.
import { rerouteViewPath } from "@fontra/core/fontra-menus.js";
import { dumpURLFragment } from "@fontra/core/utils.ts";
import { BaseTool, shouldInitiateDrag } from "@fontra/views-editor/edit-tools-base.js";

export class SelectTool extends BaseTool {
  iconPath = "/images/pointer.svg";
  identifier = "pointer-tool";

  handleHover(event) {
    this.setCursor();
  }

  async handleDrag(eventStream, initialEvent) {
    // Every mousedown gesture -- click, double-click or an actual drag --
    // starts here (scene-controller.js calls only handleDrag/handleHover/
    // handleArrowKeys on the selected tool). Double-click is already known
    // synchronously from initialEvent, before consuming the event stream, so
    // it is checked first; shouldInitiateDrag consumes the stream, so it can
    // only be asked once and only for the remaining (non-double-click) case.
    if (initialEvent.detail == 2 || initialEvent.myTapCount == 2) {
      initialEvent.preventDefault();
      eventStream.done();
      this.openSelectedGlyphForEditing(initialEvent);
      return;
    }

    // A plain click vs. an actual drag: shouldInitiateDrag consumes the
    // event stream until either the pointer moves past a minimum distance
    // (a real drag -- absorbed here, doing nothing: this is a
    // selection-only tool, no marquee-select and no point/handle dragging
    // exist yet) or the stream ends (it was just a click).
    const point = this.sceneController.localPoint(initialEvent);
    if (await shouldInitiateDrag(eventStream, initialEvent)) {
      // A real drag. Nothing to do: this tool never mutates anything on
      // drag. A future kerning-pair-selection tool or marquee-select tool
      // can add drag behavior later, as its own workstream.
      return;
    }

    this.sceneSettings.selectedGlyph = this.sceneModel.glyphAtPoint(point);
  }

  openSelectedGlyphForEditing(initialEvent) {
    const point = this.sceneController.localPoint(initialEvent);
    const selectedGlyph = this.sceneModel.glyphAtPoint(point);
    if (!selectedGlyph) {
      return;
    }
    const url = new URL(window.location);
    url.hash = dumpURLFragment({
      text: this.sceneSettings.text,
      selectedGlyph: { ...selectedGlyph, isEditing: true },
    });
    url.pathname = rerouteViewPath(url.pathname, "editor");
    window.open(url.toString(), `fontra.editor.${this.editor.projectIdentifier}`);
  }
}
