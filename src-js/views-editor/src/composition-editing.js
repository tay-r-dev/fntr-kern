import {
  anchorsCoincide,
  attachmentState,
  getAttachments,
  getCompositionData,
  markAnchorNames,
  matchAnchorNames,
  plainAnchorNames,
  setCompositionData,
  solveOffset,
  transformedAnchorMap,
} from "@fontra/core/composition.js";
import { translate } from "@fontra/core/localization.js";

// THE ONE WRITE PATH. Nothing outside this module writes the composition
// section, and nothing outside it writes a component transform on behalf of an
// attachment. This is rail R-C applied to a second feature: undo, incremental
// sync and multi-layer editing then come from the existing change system with
// no work of their own.

function setComponentOffset(component, offset) {
  component.transformation.translateX = offset[0];
  component.transformation.translateY = offset[1];
}

// Read every component glyph this composite uses, instantiated at the location
// of each of the composite's own sources. Returns, per layer name, the anchor
// list of each component's own glyph.
async function readAnchorsPerLayer(fontController, varGlyph) {
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
    const perComponent = [];
    for (const component of layerGlyph.components) {
      const baseVarGlyph = await fontController.getGlyph(component.name);
      if (!baseVarGlyph) {
        perComponent.push(null);
        continue;
      }
      const { instance } = await baseVarGlyph.instantiate(
        { ...source.location, ...component.location },
        getGlyphFunc
      );
      perComponent.push(instance?.anchors || []);
    }
    perLayer[source.layerName] = perComponent;
  }
  return perLayer;
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
