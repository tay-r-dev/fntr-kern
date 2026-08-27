import {
  anchorsCoincide,
  decomposeToGlyphNames,
  getAttachments,
  getCompositionData,
  markAnchorNames,
  plainAnchorNames,
  planAttachments,
  setCompositionData,
  solveOffset,
  transformedAnchorMap,
} from "./composition.js";
import { getDecomposedIdentity } from "./transform.js";
import { StaticGlyph, copyComponent } from "./var-glyph.js";

// Planning a build, shared by the two views. The glyph editor and the font
// overview both build glyphs, they write through different machinery, and they
// are sibling packages that cannot import from each other. So the question
// "what would building this glyph do" is answered here, once, and each view
// applies the answer its own way.
//
// Nothing here writes. `planGlyphBuild` returns a function that mutates a
// variable glyph, and the caller decides whether that glyph is a recorded
// proxy, a fresh shell handed to newGlyph, or an entry in a change the font
// overview is recording over the whole font.

// Instantiate a list of components at the location of each of the composite's
// own sources, and return, per layer name, what the solve needs from each of
// them: its anchors and its advance width. The component list is passed in
// rather than read off the glyph, so a build can ask about components it has
// not written yet.
export async function readComponentsPerLayer(fontController, varGlyph, componentList) {
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

// What this glyph is made of, if anything. A caller asks this to decide whether
// to offer a build at all, and the build asks it for the answer itself, so a
// greyed-out button and a refusal cannot disagree about what is buildable.
//
// `glyphMap` and `characterMap` are the combined maps: the font's own glyphs
// plus the selected glyph sets. Either may be omitted, and then only the font
// itself is consulted.
export function readDecomposition(
  fontController,
  glyphName,
  glyphMap = {},
  characterMap = {}
) {
  const codePoint =
    fontController.codePointForGlyph(glyphName) ?? glyphMap?.[glyphName]?.[0];
  if (!codePoint) {
    return { status: "refused", reason: "no-decomposition" };
  }

  // The font's own character map first, the combined map of the selected glyph
  // sets second. A character in neither is not a target.
  const nameForCodePoint = (cp) =>
    fontController.characterMap[cp] || characterMap?.[cp];
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
  return { status: "ok", codePoint, glyphNames };
}

// Everything a build would do to one glyph, decided before anything is written,
// because more than one answer means no answer: a glyph that would need a guess
// is refused whole, with nothing added and nothing attached.
//
// On success the result carries `apply`, which mutates a variable glyph, and
// `varGlyph`, the glyph `apply` was planned against — the font's own glyph
// where it has one, otherwise a fresh shell for the caller to add.
export async function planGlyphBuild(
  fontController,
  glyphName,
  glyphMap = {},
  characterMap = {}
) {
  const decomposition = readDecomposition(
    fontController,
    glyphName,
    glyphMap,
    characterMap
  );
  if (decomposition.status !== "ok") {
    return decomposition;
  }
  const { codePoint, glyphNames } = decomposition;

  // A target in the glyph set but not in the font is created. The glyph set is
  // the project's statement that the font should carry it. The shell is built
  // here rather than by creating the glyph first, because creating and then
  // filling would be two changes and two presses of Ctrl+Z for one build.
  const exists = fontController.hasGlyph(glyphName);
  const varGlyph = exists
    ? (await fontController.getGlyph(glyphName))?.glyph
    : fontController.makeVariableGlyphFromSingleStaticGlyph(
        glyphName,
        StaticGlyph.fromObject({ xAdvance: 0 })
      );
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

  const apply = (glyph) => {
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
          component.transformation.translateX = offset[0];
          component.transformation.translateY = offset[1];
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
  };

  return { status: "built", created: !exists, codePoint, varGlyph, apply };
}
