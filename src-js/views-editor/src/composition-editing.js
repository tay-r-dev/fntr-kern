import {
  anchorsCoincide,
  attachmentState,
  getAttachments,
  getCompositionData,
  markAnchorNames,
  matchAnchorNames,
  decomposeToGlyphNames,
  plainAnchorNames,
  planAttachments,
  remapAttachmentsForDelete,
  remapAttachmentsForInsert,
  setCompositionData,
  solveOffset,
  transformedAnchorMap,
} from "@fontra/core/composition.js";
import { translate } from "@fontra/core/localization.js";
import { unicodeUsedBy } from "@fontra/core/unicode-utils.js";
import { getDecomposedIdentity } from "@fontra/core/transform.js";
import { parseSelection, unionIndexSets } from "@fontra/core/utils.ts";
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

// Instantiate a list of components at the location of each of the composite's
// own sources, and return, per layer name, what the solve needs from each of
// them: its anchors and its advance width. The component list is passed in
// rather than read off the glyph, so the build action can ask about components
// it has not written yet.
async function readComponentsPerLayer(fontController, varGlyph, componentList) {
  const perLayer = {};
  const getGlyphFunc = fontController.getGlyph.bind(fontController);

  for (const source of varGlyph.sources) {
    if (source.inactive) {
      continue;
    }
    const layerGlyph = varGlyph.layers[source.layerName]?.glyph;
    if (!layerGlyph) {
      continue;
    }
    // A component's location can differ per layer, so without an explicit list
    // each layer is asked about its own components.
    const perComponent = [];
    for (const component of componentList || layerGlyph.components) {
      const componentVarGlyph = await fontController.getGlyph(component.name);
      if (!componentVarGlyph) {
        perComponent.push(null);
        continue;
      }
      const { instance } = await componentVarGlyph.instantiate(
        { ...source.location, ...component.location },
        getGlyphFunc
      );
      perComponent.push(
        instance
          ? { anchors: instance.anchors || [], xAdvance: instance.xAdvance }
          : null
      );
    }
    perLayer[source.layerName] = perComponent;
  }
  return perLayer;
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

  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    writeAttachments(varGlyph, (attachments) => {
      attachments[componentIndex] = { anchorName: match.anchorName, detached: false };
    });
    return translate("composition.undo.attach");
  });

  await updateComponent(sceneController, componentIndex);
}

export async function updateComponent(sceneController, componentIndex) {
  const fontController = sceneController.fontController;
  const varGlyphBefore = await getVarGlyph(sceneController);
  if (!varGlyphBefore) {
    return;
  }
  const solved = await solveGlyphAttachments(fontController, varGlyphBefore);

  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    for (const [layerName, perIndex] of Object.entries(solved)) {
      const offset = perIndex[componentIndex]?.offset;
      const component = varGlyph.layers[layerName]?.glyph?.components[componentIndex];
      if (!offset || !component) {
        continue;
      }
      setComponentOffset(component, offset);
    }
    writeAttachments(varGlyph, (attachments) => {
      const entry = attachments[componentIndex];
      if (entry) {
        attachments[componentIndex] = { ...entry, detached: false };
      }
    });
    return translate("composition.undo.update");
  });
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

  const codePoint =
    fontController.codePointForGlyph(glyphName) ??
    sceneSettings.combinedGlyphMap?.[glyphName]?.[0];
  if (!codePoint) {
    return { status: "refused", reason: "no-decomposition" };
  }

  // The font's own character map first, the combined map of the selected glyph
  // sets second. A character in neither is not a target.
  const nameForCodePoint = (cp) =>
    fontController.characterMap[cp] || sceneSettings.combinedCharacterMap?.[cp];
  const { glyphNames, missing } = decomposeToGlyphNames(codePoint, nameForCodePoint);
  if (!glyphNames.length) {
    return { status: "refused", reason: "no-decomposition" };
  }
  if (missing.length) {
    return { status: "refused", reason: "missing-glyph" };
  }
  for (const name of glyphNames) {
    if (!fontController.hasGlyph(name)) {
      return { status: "refused", reason: "missing-glyph" };
    }
  }

  if (!fontController.hasGlyph(glyphName)) {
    // A target in the glyph set but not in the font is created. The glyph set
    // is the project's statement that the font should carry it.
    await fontController.newGlyph(
      glyphName,
      codePoint,
      null,
      null,
      translate("composition.undo.build")
    );
  }
  const varGlyphController = await fontController.getGlyph(glyphName);
  const varGlyph = varGlyphController?.glyph;
  if (!varGlyph) {
    return { status: "refused", reason: "missing-glyph" };
  }

  const defaultLayerGlyph = Object.values(varGlyph.layers)[0]?.glyph;
  if (!defaultLayerGlyph) {
    return { status: "refused", reason: "missing-glyph" };
  }
  const existing = defaultLayerGlyph.components;
  const existingNames = new Set(existing.map((component) => component.name));

  const newComponents = [];
  for (const name of glyphNames) {
    if (existingNames.has(name)) {
      continue;
    }
    const componentVarGlyph = await fontController.getGlyph(name);
    newComponents.push({
      name,
      transformation: getDecomposedIdentity(),
      location: Object.fromEntries(
        componentVarGlyph.glyph.axes.map((axis) => [axis.name, axis.defaultValue])
      ),
    });
  }

  const prospective = [...existing, ...newComponents];
  const perLayer = await readComponentsPerLayer(fontController, varGlyph, prospective);
  const layerNames = Object.keys(perLayer);
  if (!layerNames.length) {
    return { status: "refused", reason: "missing-glyph" };
  }

  // Matching runs against the default layer. An attachment is structure, and
  // structure is the same in every layer.
  const referenceLayer = perLayer[layerNames[0]];
  const baseNames = plainAnchorNames(referenceLayer[0]?.anchors || []);
  const markNamesPerComponent = prospective
    .slice(1)
    .map((_, index) => markAnchorNames(referenceLayer[index + 1]?.anchors || []));
  const plan = planAttachments(baseNames, markNamesPerComponent);
  if (plan.refusals.length) {
    return { status: "refused", reason: plan.refusals[0].reason };
  }
  if (!plan.results.length) {
    return { status: "refused", reason: "no-shared-anchor" };
  }

  const storedBefore = getAttachments(varGlyph, existing.length);
  const alreadyPlanned =
    !newComponents.length &&
    plan.results.every(
      (result) =>
        storedBefore[result.componentIndex + 1]?.anchorName === result.anchorName
    );

  // The offset per layer, per component. One attachment gives a different
  // offset in each master, which is the whole point of storing the intent.
  const offsets = {};
  let everythingAligned = alreadyPlanned;
  for (const layerName of layerNames) {
    const perComponent = perLayer[layerName];
    const baseComponent = prospective[0];
    const baseMap = transformedAnchorMap(
      perComponent[0]?.anchors || [],
      baseComponent.transformation
    );
    const perIndex = {};
    for (const result of plan.results) {
      const index = result.componentIndex + 1;
      const basePosition = baseMap[result.anchorName];
      const markAnchor = (perComponent[index]?.anchors || []).find(
        (anchor) => anchor.name === "_" + result.anchorName
      );
      if (!basePosition || !markAnchor) {
        return { status: "refused", reason: "no-shared-anchor" };
      }
      const offset = solveOffset(basePosition, [markAnchor.x, markAnchor.y]);
      const placed = transformedAnchorMap(
        [markAnchor],
        prospective[index].transformation
      )[markAnchor.name];
      if (!anchorsCoincide(basePosition, placed)) {
        everythingAligned = false;
      }
      perIndex[index] = offset;
    }
    offsets[layerName] = perIndex;
  }

  if (everythingAligned) {
    return { status: "skipped" };
  }

  const baseWidths = Object.fromEntries(
    layerNames.map((layerName) => [layerName, perLayer[layerName][0]?.xAdvance])
  );

  await sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
    for (const [layerName, layerEntry] of Object.entries(glyph.layers)) {
      const layerGlyph = layerEntry?.glyph;
      if (!layerGlyph) {
        continue;
      }
      for (const component of newComponents) {
        layerGlyph.components.push(copyComponent(component));
      }
      // The advance width comes from the base glyph, once. Managing does not
      // keep enforcing it, so a designer can respace afterwards.
      const width = baseWidths[layerName] ?? baseWidths[layerNames[0]];
      if (width !== undefined) {
        layerGlyph.xAdvance = width;
      }
      const perIndex = offsets[layerName] || offsets[layerNames[0]];
      for (const [index, offset] of Object.entries(perIndex)) {
        const component = layerGlyph.components[index];
        if (component) {
          setComponentOffset(component, offset);
        }
      }
    }
    const attachments = new Array(prospective.length).fill(null);
    for (const [index, entry] of storedBefore.entries()) {
      attachments[index] = entry;
    }
    for (const result of plan.results) {
      attachments[result.componentIndex + 1] = {
        anchorName: result.anchorName,
        detached: false,
      };
    }
    setCompositionData(glyph, {
      ...(getCompositionData(glyph) || {}),
      attachments,
    });
    return translate("composition.undo.build");
  });

  return { status: "built" };
}

// Build a list of glyphs. Each one is its own change, so a refusal does not
// roll back the glyphs that came before it. Spec section 7.2.
export async function buildGlyphs(sceneController, glyphNames) {
  const built = [];
  const skipped = [];
  const refused = [];
  for (const glyphName of glyphNames) {
    const result = await buildGlyph(sceneController, glyphName);
    if (result.status === "built") {
      built.push(glyphName);
    } else if (result.status === "skipped") {
      skipped.push(glyphName);
    } else {
      refused.push({ glyphName, reason: result.reason });
    }
  }
  return { built, skipped, refused };
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
