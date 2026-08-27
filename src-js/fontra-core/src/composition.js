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

// Matching compares two name sets: the base's plain anchor names, and the
// component's underscore anchor names with the underscore removed. Exactly one
// shared name is an attachment. Anything else is a refusal, because more than
// one answer means no answer. Spec section 5.1.

export function matchAnchorNames(baseNames, markNames) {
  const base = new Set(baseNames);
  const shared = [...new Set(markNames)].filter((name) => base.has(name)).sort();
  if (shared.length === 1) {
    return { anchorName: shared[0] };
  }
  if (shared.length === 0) {
    return { refusal: "no-shared-anchor", names: [] };
  }
  return { refusal: "ambiguous-mark", names: shared };
}

export function planAttachments(baseNames, markNamesPerComponent) {
  const results = [];
  const refusals = [];
  const claimedBy = new Map();

  for (const [index, markNames] of markNamesPerComponent.entries()) {
    const match = matchAnchorNames(baseNames, markNames);
    if (match.refusal) {
      refusals.push({
        componentIndex: index,
        reason: match.refusal,
        names: match.names,
      });
      continue;
    }
    const previous = claimedBy.get(match.anchorName);
    if (previous === undefined) {
      claimedBy.set(match.anchorName, index);
      results.push({ componentIndex: index, anchorName: match.anchorName });
      continue;
    }
    // Two components want the same anchor. Neither is attached: the glyph has
    // more than one answer, so it has none.
    claimedBy.set(match.anchorName, index);
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].anchorName === match.anchorName) {
        refusals.push({
          componentIndex: results[i].componentIndex,
          reason: "anchor-taken",
          names: [match.anchorName],
        });
        results.splice(i, 1);
      }
    }
    refusals.push({
      componentIndex: index,
      reason: "anchor-taken",
      names: [match.anchorName],
    });
  }

  refusals.sort((a, b) => a.componentIndex - b.componentIndex);
  return { results, refusals };
}
