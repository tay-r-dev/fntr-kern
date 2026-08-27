import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "./fontra-internal-schema.js";
import { decomposedToTransform } from "./transform.js";
import { unicodeMadeOf } from "./unicode-utils.js";

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
  // A mark with no underscore anchor at all is the commonest fault and the one
  // hardest to read off "no shared anchor": the designer drew `top` where the
  // convention wants `_top`, so the anchor names the place something attaches
  // to the mark rather than the place the mark attaches by.
  if (!markNames.length) {
    return { refusal: "no-mark-anchor", names: [] };
  }
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

export function plainAnchorNames(anchors) {
  return (anchors || []).filter((a) => !a.name?.startsWith("_")).map((a) => a.name);
}

export function markAnchorNames(anchors) {
  return (anchors || [])
    .filter((a) => a.name?.startsWith("_"))
    .map((a) => a.name.slice(1));
}

export function anchorMap(anchors) {
  return Object.fromEntries((anchors || []).map((a) => [a.name, [a.x, a.y]]));
}

// The base glyph is a component too, so its anchors are only where the drawing
// says they are once its own transform has been applied. A base that is scaled
// or shifted carries its anchors with it. Spec section 5.2.
export function transformedAnchorMap(anchors, transformation) {
  const t = decomposedToTransform(transformation);
  return Object.fromEntries(
    (anchors || []).map((a) => [a.name, [...t.transformPoint(a.x, a.y)]])
  );
}

export function solveOffset(basePosition, markPosition) {
  return [basePosition[0] - markPosition[0], basePosition[1] - markPosition[1]];
}

// Spec section 6. The order of these checks is the behavior, not a style
// choice. Broken is checked before detached, because a missing anchor is a
// fault the designer has to see whatever else they said. Detached is checked
// before out of date, because it is the designer overruling the solve.
export function attachmentState({ entry, aligned }) {
  if (!entry) {
    return "unattached";
  }
  if (aligned === null || aligned === undefined) {
    return "broken";
  }
  if (aligned) {
    return "inSync";
  }
  return entry.detached ? "detached" : "outOfDate";
}

// Grid coordinates are whole units, so an exact comparison is the right one.
// A tolerance here would report a component one unit off as attached.
export function anchorsCoincide(basePosition, markPosition) {
  if (!basePosition || !markPosition) {
    return null;
  }
  return basePosition[0] === markPosition[0] && basePosition[1] === markPosition[1];
}

// The attachment list is positional, because components carry no stable id in
// Fontra. So every operation that restructures the component list moves the
// entries in the same change. Five sites do that: add component, paste, cut,
// delete selection, and decompose. Spec section 4.1.

export function remapAttachmentsForInsert(attachments, index, count) {
  const remapped = [...attachments];
  remapped.splice(index, 0, ...new Array(count).fill(null));
  return remapped;
}

export function remapAttachmentsForDelete(attachments, indices) {
  const drop = new Set(indices);
  return attachments.filter((_, index) => !drop.has(index));
}

// The Related Glyphs panel already displays this decomposition. The build
// action uses the same table, so the two cannot disagree about what a
// character is made of. Spec section 7.1.
export function decomposeToGlyphNames(codePoint, glyphNameForCodePoint) {
  const glyphNames = [];
  const missing = [];
  for (const partCodePoint of unicodeMadeOf(codePoint)) {
    const glyphName = glyphNameForCodePoint(partCodePoint);
    if (glyphName) {
      glyphNames.push(glyphName);
    } else {
      missing.push(partCodePoint);
    }
  }
  return { glyphNames, missing };
}
