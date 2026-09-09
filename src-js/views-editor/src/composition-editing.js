import {
  anchorMap,
  anchorsCoincide,
  attachmentState,
  getAttachments,
  getCompositionData,
  markAnchorNames,
  matchAnchorNames,
  plainAnchorNames,
  remapAttachmentsForDelete,
  remapAttachmentsForInsert,
  setCompositionData,
  solveOffset,
  transformedAnchorMap,
} from "@fontra/core/composition.js";
import {
  planGlyphBuild,
  readComponentsPerLayer,
} from "@fontra/core/composition-build.js";
import { translate } from "@fontra/core/localization.js";
import { unicodeMadeOf, unicodeUsedBy } from "@fontra/core/unicode-utils.js";
import { deepCopyObject, parseSelection, unionIndexSets } from "@fontra/core/utils.ts";
import { copyComponent } from "@fontra/core/var-glyph.js";

// THE ONE WRITE PATH. Nothing outside this module writes the composition
// section, and nothing outside it writes a component transform on behalf of an
// attachment. This is rail R-C applied to a second feature: undo, incremental
// sync and multi-layer editing then come from the existing change system with
// no work of their own.

function setComponentOffset(component, offset) {
  component.transformation.translateX = offset[0];
  component.transformation.translateY = offset[1];
}

// The anchors alone, for the components the glyph already carries.
async function readAnchorsPerLayer(fontController, varGlyph) {
  const read = await readComponentsPerLayer(fontController, varGlyph, null);
  return Object.fromEntries(
    Object.entries(read).map(([layerName, perComponent]) => [
      layerName,
      perComponent.map((entry) => entry?.anchors || null),
    ])
  );
}

// The base is the first component. Its anchors are read through its own
// transform, so a base that is scaled or shifted carries its anchors with it.
export async function solveGlyphAttachments(fontController, varGlyph) {
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyph);
  const solved = {};

  for (const [layerName, perComponent] of Object.entries(anchorsPerLayer)) {
    const layerGlyph = varGlyph.layers[layerName].glyph;
    const attachments = getAttachments(varGlyph, layerGlyph.components.length);
    const baseAnchors = perComponent[0];
    const baseComponent = layerGlyph.components[0];
    const perIndex = {};

    const baseMap =
      baseAnchors && baseComponent
        ? transformedAnchorMap(baseAnchors, baseComponent.transformation)
        : {};

    for (const [index, entry] of attachments.entries()) {
      if (!entry || index === 0) {
        continue;
      }
      const component = layerGlyph.components[index];
      const basePosition = baseMap[entry.anchorName];
      const markAnchorName = "_" + entry.anchorName;
      const markAnchor = (perComponent[index] || []).find(
        (a) => a.name === markAnchorName
      );
      if (!basePosition || !markAnchor || !component) {
        perIndex[index] = { offset: null, aligned: null };
        continue;
      }
      // Where the mark's anchor sits now, with the component's own transform
      // applied. In sync is this landing on the base anchor.
      const placed = transformedAnchorMap([markAnchor], component.transformation)[
        markAnchor.name
      ];
      perIndex[index] = {
        offset: solveOffset(basePosition, [markAnchor.x, markAnchor.y]),
        aligned: anchorsCoincide(basePosition, placed),
      };
    }
    solved[layerName] = perIndex;
  }
  return solved;
}

async function getVarGlyph(sceneController) {
  const controller =
    await sceneController.sceneModel.getSelectedVariableGlyphController();
  return controller?.glyph || null;
}

export async function readCompositionState(sceneController) {
  const varGlyph = await getVarGlyph(sceneController);
  if (!varGlyph) {
    return { rows: [], baseGlyphName: null };
  }
  const fontController = sceneController.fontController;
  const layerName = sceneController.sceneSettings.editLayerName;
  const layerGlyph =
    varGlyph.layers[layerName]?.glyph ||
    Object.values(varGlyph.layers)[0]?.glyph ||
    null;
  if (!layerGlyph) {
    return { rows: [], baseGlyphName: null };
  }

  const solved = await solveGlyphAttachments(fontController, varGlyph);
  const solvedHere = solved[layerName] || Object.values(solved)[0] || {};
  const attachments = getAttachments(varGlyph, layerGlyph.components.length);
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyph);
  const perComponent = anchorsPerLayer[layerName] || Object.values(anchorsPerLayer)[0];

  const baseNames = plainAnchorNames(perComponent?.[0] || []);
  const rows = [];

  for (const [index, component] of layerGlyph.components.entries()) {
    if (index === 0) {
      rows.push({
        componentIndex: index,
        componentName: component.name,
        state: "base",
        anchorName: null,
        refusal: null,
      });
      continue;
    }
    const entry = attachments[index];
    const match = entry
      ? null
      : matchAnchorNames(baseNames, markAnchorNames(perComponent?.[index] || []));
    rows.push({
      componentIndex: index,
      componentName: component.name,
      state: attachmentState({ entry, aligned: solvedHere[index]?.aligned ?? null }),
      anchorName: entry?.anchorName || match?.anchorName || null,
      refusal: match?.refusal || null,
    });
  }

  return { rows, baseGlyphName: layerGlyph.components[0]?.name || null };
}

function writeAttachments(varGlyph, mutate) {
  const layerGlyph = Object.values(varGlyph.layers)[0]?.glyph;
  const count = layerGlyph?.components.length || 0;
  const attachments = getAttachments(varGlyph, count);
  mutate(attachments);
  setCompositionData(varGlyph, {
    ...(getCompositionData(varGlyph) || {}),
    attachments,
  });
}

// The offset one named anchor gives this component, per layer. It is solved
// from the anchor name alone and never from the stored entry, so an attach can
// solve before it has written anything and stay one change. One button press
// must be one undo step: undo is per glyph here, and a second recorded change
// makes the designer press Ctrl+Z twice to take back one action.
async function solveOffsetsForAnchor(
  fontController,
  varGlyph,
  componentIndex,
  anchorName
) {
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyph);
  const offsets = {};
  for (const [layerName, perComponent] of Object.entries(anchorsPerLayer)) {
    const layerGlyph = varGlyph.layers[layerName]?.glyph;
    const baseComponent = layerGlyph?.components[0];
    if (!baseComponent) {
      continue;
    }
    const basePosition = transformedAnchorMap(
      perComponent[0] || [],
      baseComponent.transformation
    )[anchorName];
    const markAnchor = (perComponent[componentIndex] || []).find(
      (anchor) => anchor.name === "_" + anchorName
    );
    if (!basePosition || !markAnchor) {
      continue;
    }
    offsets[layerName] = solveOffset(basePosition, [markAnchor.x, markAnchor.y]);
  }
  return offsets;
}

// Write one anchor name and the offsets it gives, in a single recorded change.
async function writeAttachment(
  sceneController,
  componentIndex,
  anchorName,
  undoLabelKey
) {
  const fontController = sceneController.fontController;
  const varGlyphBefore = await getVarGlyph(sceneController);
  if (!varGlyphBefore) {
    return;
  }
  const offsets = await solveOffsetsForAnchor(
    fontController,
    varGlyphBefore,
    componentIndex,
    anchorName
  );

  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    for (const [layerName, offset] of Object.entries(offsets)) {
      const component = varGlyph.layers[layerName]?.glyph?.components[componentIndex];
      if (component) {
        setComponentOffset(component, offset);
      }
    }
    writeAttachments(varGlyph, (attachments) => {
      attachments[componentIndex] = { anchorName, detached: false };
    });
    return translate(undoLabelKey);
  });
}

export async function attachComponent(sceneController, componentIndex) {
  const fontController = sceneController.fontController;
  const varGlyphBefore = await getVarGlyph(sceneController);
  if (!varGlyphBefore) {
    return;
  }
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyphBefore);
  const perComponent = Object.values(anchorsPerLayer)[0] || [];
  const match = matchAnchorNames(
    plainAnchorNames(perComponent[0] || []),
    markAnchorNames(perComponent[componentIndex] || [])
  );
  if (match.refusal) {
    return;
  }
  await writeAttachment(
    sceneController,
    componentIndex,
    match.anchorName,
    "composition.undo.attach"
  );
}

export async function updateComponent(sceneController, componentIndex) {
  const varGlyphBefore = await getVarGlyph(sceneController);
  if (!varGlyphBefore) {
    return;
  }
  const entry = getAttachments(varGlyphBefore, componentCountOf(varGlyphBefore))[
    componentIndex
  ];
  if (!entry) {
    return;
  }
  await writeAttachment(
    sceneController,
    componentIndex,
    entry.anchorName,
    "composition.undo.update"
  );
}

export async function overrideComponent(sceneController, componentIndex) {
  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    writeAttachments(varGlyph, (attachments) => {
      const entry = attachments[componentIndex];
      if (entry) {
        attachments[componentIndex] = { ...entry, detached: true };
      }
    });
    return translate("composition.undo.override");
  });
}

export async function detachComponent(sceneController, componentIndex) {
  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    writeAttachments(varGlyph, (attachments) => {
      attachments[componentIndex] = null;
    });
    return translate("composition.undo.detach");
  });
}

// Called from every operation that restructures the component list, inside the
// same change that restructures it. The attachment list is positional, so an
// operation that moves components and does not move entries silently retargets
// every attachment after the edit. Spec section 4.1.
export function recordComponentInsert(varGlyph, index, count, componentCountBefore) {
  const attachments = getAttachments(varGlyph, componentCountBefore);
  setCompositionData(varGlyph, {
    ...(getCompositionData(varGlyph) || {}),
    attachments: remapAttachmentsForInsert(attachments, index, count),
  });
}

export function recordComponentDelete(varGlyph, indices, componentCountBefore) {
  const attachments = getAttachments(varGlyph, componentCountBefore);
  setCompositionData(varGlyph, {
    ...(getCompositionData(varGlyph) || {}),
    attachments: remapAttachmentsForDelete(attachments, indices),
  });
}

// The cut and delete paths select components three ways, and every one of them
// removes the component. The same union the copy path takes.
export function selectedComponentIndices(selection) {
  const { component, componentOrigin, componentTCenter } = parseSelection(selection);
  return [...unionIndexSets(component, componentOrigin, componentTCenter)];
}

// The component count of any layer, which is the length the attachment list
// must have. Every layer of a glyph carries the same components.
export function componentCountOf(varGlyph) {
  return Object.values(varGlyph.layers)[0]?.glyph?.components.length || 0;
}

// Build one glyph from its Unicode decomposition. Spec section 7.1. Every
// question is answered before anything is written, because more than one
// answer means no answer: a glyph that would need a guess is refused whole,
// with nothing added and nothing attached.
export async function buildGlyph(sceneController, glyphName) {
  const fontController = sceneController.fontController;
  const sceneSettings = sceneController.sceneSettings;
  const plan = await planGlyphBuild(
    fontController,
    glyphName,
    sceneSettings.combinedGlyphMap,
    sceneSettings.combinedCharacterMap
  );
  if (plan.status !== "built") {
    return plan;
  }

  if (plan.created) {
    plan.apply(plan.varGlyph);
    await fontController.newGlyph(
      glyphName,
      plan.codePoint,
      plan.varGlyph,
      null,
      translate("composition.undo.build")
    );
  } else {
    await sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      plan.apply(glyph);
      return translate("composition.undo.build");
    });
  }

  return { status: "built" };
}

// Build a list of glyphs. Each one is its own change, so a refusal does not
// roll back the glyphs that came before it. Spec section 7.2.
//
// UNDO. Fontra keeps one undo stack per glyph, and Ctrl+Z pops the stack of the
// glyph on screen. A batch driven from a mark writes to other glyphs, so its
// records land on their stacks, not on the mark's: Ctrl+Z with the mark open
// takes back nothing. Each built glyph undoes on its own, from itself. There is
// no font-wide stack to push a whole batch onto, so the report says so rather
// than leaving the designer to discover it.
// What a build touches, and nothing else: the components of every layer, the
// advance width, and the stored section. A whole-glyph swap is not available,
// because assigning a top-level property on the recorded proxy does not
// register — the designspace panel hit the same wall and splices in place.
function snapshotGlyph(varGlyph) {
  const layers = {};
  for (const [layerName, layerEntry] of Object.entries(varGlyph.layers)) {
    const layerGlyph = layerEntry?.glyph;
    if (!layerGlyph) {
      continue;
    }
    layers[layerName] = {
      components: layerGlyph.components.map(copyComponent),
      xAdvance: layerGlyph.xAdvance,
    };
  }
  return {
    layers,
    composition: deepCopyObject(getCompositionData(varGlyph) || null),
  };
}

export async function buildGlyphs(sceneController, glyphNames) {
  const fontController = sceneController.fontController;
  const built = [];
  const skipped = [];
  const refused = [];
  // What each built glyph looked like beforehand, so the batch can be taken
  // back in one press from the mark it was driven from.
  const record = [];

  for (const glyphName of glyphNames) {
    const existed = fontController.hasGlyph(glyphName);
    const before = existed
      ? snapshotGlyph((await fontController.getGlyph(glyphName)).glyph)
      : null;
    const result = await buildGlyph(sceneController, glyphName);
    if (result.status === "built") {
      built.push(glyphName);
      record.push({ glyphName, created: !existed, before });
    } else if (result.status === "skipped") {
      skipped.push(glyphName);
    } else {
      refused.push({ glyphName, reason: result.reason });
    }
  }
  return { built, skipped, refused, record };
}

// Take back a whole batch from the glyph that drove it. Ctrl+Z cannot do this:
// the records live on the built glyphs' own stacks, and the mark's stack is
// empty. A glyph the batch created is deleted; a glyph it changed is put back
// as it was. Each step is itself a recorded change, so the restore is not a
// hole in the history — it is an ordinary edit that happens to undo one.
export async function undoBuildGlyphs(sceneController, record) {
  const fontController = sceneController.fontController;
  for (const entry of [...record].reverse()) {
    if (entry.created) {
      await fontController.deleteGlyph(
        entry.glyphName,
        translate("composition.undo.compose-all")
      );
      continue;
    }
    await sceneController.editNamedGlyphAndRecordChanges(entry.glyphName, (glyph) => {
      for (const [layerName, layerEntry] of Object.entries(glyph.layers)) {
        const layerGlyph = layerEntry?.glyph;
        const before = entry.before.layers[layerName];
        if (!layerGlyph || !before) {
          continue;
        }
        layerGlyph.components.splice(
          0,
          layerGlyph.components.length,
          ...before.components.map(copyComponent)
        );
        layerGlyph.xAdvance = before.xAdvance;
      }
      setCompositionData(glyph, entry.before.composition ?? undefined);
      return translate("composition.undo.compose-all");
    });
  }
}

// Every glyph that uses this mark, bounded by the combined glyph map. That map
// is the font's own glyphs plus the selected project and user glyph sets, so a
// character in no selected glyph set is not a target and is not reported.
export function targetsForMark(sceneController, markGlyphName) {
  const fontController = sceneController.fontController;
  const sceneSettings = sceneController.sceneSettings;
  const codePoint =
    fontController.codePointForGlyph(markGlyphName) ??
    sceneSettings.combinedGlyphMap?.[markGlyphName]?.[0];
  if (!codePoint) {
    return [];
  }
  const combinedGlyphMap = sceneSettings.combinedGlyphMap || {};
  const targets = [];
  for (const usedByCodePoint of unicodeUsedBy(codePoint)) {
    const glyphName =
      fontController.characterMap[usedByCodePoint] ||
      sceneSettings.combinedCharacterMap?.[usedByCodePoint];
    if (glyphName && glyphName in combinedGlyphMap) {
      targets.push(glyphName);
    }
  }
  return targets;
}

// The marks that can attach to this base. They come from the same Unicode
// table the build action uses, so the cloud and the build cannot disagree
// about what composes with a letter: every character that decomposes to
// include this glyph, minus the glyph itself.
export function markCandidatesForBase(sceneController, glyphName) {
  const fontController = sceneController.fontController;
  const sceneSettings = sceneController.sceneSettings;
  const codePoint =
    fontController.codePointForGlyph(glyphName) ??
    sceneSettings.combinedGlyphMap?.[glyphName]?.[0];
  if (!codePoint) {
    return [];
  }
  const nameForCodePoint = (cp) =>
    fontController.characterMap[cp] || sceneSettings.combinedCharacterMap?.[cp];
  const candidates = new Set();
  for (const usedByCodePoint of unicodeUsedBy(codePoint)) {
    for (const partCodePoint of unicodeMadeOf(usedByCodePoint)) {
      const partName = nameForCodePoint(partCodePoint);
      if (partName && partName !== glyphName && fontController.hasGlyph(partName)) {
        candidates.add(partName);
      }
    }
  }
  return [...candidates].sort();
}

// Where each mark would sit on this glyph's anchors. It writes nothing: the
// cloud is a drawing, and the solve that places it is the same one an
// attachment uses. Spec section 8.
export async function computeMarkCloud(sceneController, glyphName, markNames) {
  const fontController = sceneController.fontController;
  const location = sceneController.sceneSettings.fontLocationSourceMapped || {};
  const baseInstance = await fontController.getGlyphInstance(glyphName, location);
  if (!baseInstance) {
    return [];
  }
  const baseMap = anchorMap(baseInstance.anchors || []);
  const placed = [];

  for (const markName of markNames) {
    const markInstance = await fontController.getGlyphInstance(markName, location);
    if (!markInstance) {
      continue;
    }
    // A mark carrying more than one underscore anchor name is drawn once per
    // name, and the panel flags it.
    for (const anchor of markInstance.anchors || []) {
      if (!anchor.name?.startsWith("_")) {
        continue;
      }
      const basePosition = baseMap[anchor.name.slice(1)];
      if (!basePosition) {
        continue;
      }
      placed.push({
        glyphName: markName,
        anchorName: anchor.name.slice(1),
        offset: solveOffset(basePosition, [anchor.x, anchor.y]),
        path2d: markInstance.flattenedPath2d,
      });
    }
  }
  return placed;
}
