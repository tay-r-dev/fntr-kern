import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "./fontra-internal-schema.js";

// An attachment says: this component hangs on the base glyph's anchor of this
// name. Two fields, both structure, so the entry is the same in every layer and
// the section carries no per-layer data. Nothing records what was written: the
// state is read off the drawing, by asking whether the two anchors coincide.
// See docs/superpowers/specs/composition.md section 4.

export function getCompositionData(glyph) {
  return getFontraInternalSection(glyph, FONTRA_INTERNAL_SECTIONS.COMPOSITION);
}

export function setCompositionData(glyph, data) {
  setFontraInternalSection(glyph, FONTRA_INTERNAL_SECTIONS.COMPOSITION, data);
}

export function getAttachments(glyph, componentCount) {
  const stored = getCompositionData(glyph)?.attachments || [];
  const attachments = new Array(componentCount);
  for (let i = 0; i < componentCount; i++) {
    attachments[i] = stored[i] || null;
  }
  return attachments;
}
