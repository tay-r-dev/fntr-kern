import { expect } from "chai";

import {
  StaticGlyphController,
  ensureGlyphCompatibility,
  stripNonInterpolatablesAndSortAnchors,
} from "@fontra/core/glyph-controller.js";
import { getMarkers, setMarkerData } from "@fontra/core/marker-model.js";
import {
  getSkeletonData,
  getSkeletonRibPosition,
  setSkeletonData,
} from "@fontra/core/skeleton-model.js";
import { getDecomposedIdentity } from "@fontra/core/transform.js";
import { addItemwise } from "@fontra/core/var-funcs.js";
import { range } from "@fontra/core/utils.ts";
import { StaticGlyph, VariableGlyph } from "@fontra/core/var-glyph.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { parametrize } from "./test-support.js";

function makeTestStaticGlyphObject() {
  return {
    xAdvance: 170,
    path: {
      contourInfo: [{ endPoint: 3, isClosed: true }],
      coordinates: [60, 0, 110, 0, 110, 120, 60, 120],
      pointTypes: [0, 0, 0, 0],
    },
    components: [
      {
        name: "test",
        location: { a: 0.5 },
        transformation: getDecomposedIdentity(),
      },
    ],
    anchors: [
      { name: "top", x: 100, y: 100 },
      { name: "bottom", x: 100, y: 0 },
    ],
    guidelines: [
      { name: "top", x: 100, y: 100, angle: 0 },
      { name: "center", x: 100, y: 0, angle: 90 },
    ],
  };
}

function makeTestEmptyStaticGlyphObject() {
  return {
    xAdvance: 170,
  };
}

function changeStaticGlyphLeftMargin(layerGlyph, layerGlyphController, value) {
  const translationX = value - layerGlyphController.leftMargin;
  for (const i of range(0, layerGlyph.path.coordinates.length, 2)) {
    layerGlyph.path.coordinates[i] += translationX;
  }
  for (const compo of layerGlyph.components) {
    compo.transformation.translateX += translationX;
  }
  layerGlyph.xAdvance += translationX;
}

describe("glyph-controller Tests", () => {
  it("get StaticGlyphController name", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController.name).to.equal("dummy");
  });

  it("get StaticGlyphController customData", () => {
    // Skeleton resolvers fall back to getSkeletonData(positionedGlyph.glyph)
    // — the controller must expose the instance's customData so interpolated
    // skeleton data is reachable at non-source (virtual) positions.
    const sgObj = makeTestStaticGlyphObject();
    sgObj.customData = { "fontra.internal": { marker: 1 } };
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController.customData).to.deep.equal({
      "fontra.internal": { marker: 1 },
    });
  });

  it("get StaticGlyphController xAdvance", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController.xAdvance).to.equal(170);
  });

  it("get empty StaticGlyphController xAdvance, leftMargin and rightMargin", () => {
    const sgObj = makeTestEmptyStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController.xAdvance).to.equal(170);
    expect(staticGlyphController.leftMargin).to.equal(undefined);
    expect(staticGlyphController.rightMargin).to.equal(undefined);
  });

  it("get StaticGlyphController path", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    const expectedPath = new VarPackedPath(
      [60, 0, 110, 0, 110, 120, 60, 120],
      [0, 0, 0, 0],
      [{ endPoint: 3, isClosed: true }]
    );
    expect(staticGlyphController.path).to.deep.equal(expectedPath);
  });

  it("get StaticGlyphController anchors", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    const expectedAnchors = [
      { name: "top", x: 100, y: 100 },
      { name: "bottom", x: 100, y: 0 },
    ];
    expect(staticGlyphController.anchors).to.deep.equal(expectedAnchors);
  });

  it("get StaticGlyphController anchors", () => {
    const sgObj = makeTestEmptyStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    const expectedAnchors = [];
    expect(staticGlyphController.anchors).to.deep.equal(expectedAnchors);
  });

  it("get StaticGlyphController guidelines", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    const expectedGuidelines = [
      { name: "top", x: 100, y: 100, angle: 0, locked: false },
      { name: "center", x: 100, y: 0, angle: 90, locked: false },
    ];
    expect(staticGlyphController.guidelines).to.deep.equal(expectedGuidelines);
  });

  it("get StaticGlyphController bounds", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );

    expect(staticGlyphController.bounds).to.deep.equal({
      xMin: 60,
      yMin: 0,
      xMax: 110,
      yMax: 120,
    });
  });

  it("get StaticGlyphController leftMargin", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController.leftMargin).to.equal(60);
  });

  it("get StaticGlyphController rightMargin", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController.rightMargin).to.equal(60);
  });

  it("modify leftMargin check leftMargin", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );

    changeStaticGlyphLeftMargin(staticGlyph, staticGlyphController, 70);
    expect(staticGlyph.xAdvance).to.deep.equal(180);
    const staticGlyphController2 = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    expect(staticGlyphController2.leftMargin).to.equal(70);
  });

  it("modify StaticGlyphController xAdvance check rightMargin", () => {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    const staticGlyphController = new StaticGlyphController(
      "dummy",
      staticGlyph,
      undefined
    );
    staticGlyph.xAdvance += 10;
    expect(staticGlyphController.rightMargin).to.equal(70);
  });
});

describe("StaticGlyphController getSelectionBounds", () => {
  const sgObj = makeTestStaticGlyphObject();
  const staticGlyph = StaticGlyph.fromObject(sgObj);
  const staticGlyphController = new StaticGlyphController(
    "dummy",
    staticGlyph,
    undefined
  );

  staticGlyphController.components.push({
    bounds: { xMin: 0, yMin: 0, xMax: 100, yMax: 200 },
  });

  parametrize(
    "StaticGlyphController getSelectionBounds",
    [
      [
        ["point/0", "point/1", "point/2", "point/3"],
        { xMin: 60, yMin: 0, xMax: 110, yMax: 120 },
      ],
      [["point/0"], { xMin: 60, yMin: 0, xMax: 60, yMax: 0 }],
      [["point/0", "point/1"], { xMin: 60, yMin: 0, xMax: 110, yMax: 0 }],
      [["component/0"], { xMin: 0, yMin: 0, xMax: 100, yMax: 200 }],
      [
        ["point/0", "point/1", "component/0"],
        { xMin: 0, yMin: 0, xMax: 110, yMax: 200 },
      ],
      [["point/0", "point/1", "anchor/0"], { xMin: 60, yMin: 0, xMax: 110, yMax: 100 }],
      [["point/18"], undefined], // out of bounds
    ],
    (testData) => {
      const [selection, result] = testData;
      expect(
        staticGlyphController.getSelectionBounds(new Set(selection))
      ).to.deep.equal(result);
    }
  );
});

describe("StaticGlyphController getSelectionBounds — skeleton", () => {
  function makeSkeletonController() {
    const sgObj = makeTestStaticGlyphObject();
    const staticGlyph = StaticGlyph.fromObject(sgObj);
    setSkeletonData(staticGlyph, {
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          singleSided: null,
          defaultWidth: 80,
          points: [
            {
              id: 2,
              x: 100,
              y: 200,
              type: null,
              smooth: false,
              width: { left: 40, right: 40, linked: true },
            },
            {
              id: 3,
              x: 300,
              y: 200,
              type: null,
              smooth: false,
              width: { left: 40, right: 40, linked: true },
            },
          ],
        },
      ],
      generated: [],
    });
    return new StaticGlyphController("dummy", staticGlyph, undefined);
  }

  it("resolves a single skeleton point to its coordinate rect", () => {
    const controller = makeSkeletonController();
    expect(controller.getSelectionBounds(new Set(["skeletonPoint/1/2"]))).to.deep.equal(
      { xMin: 100, yMin: 200, xMax: 100, yMax: 200 }
    );
  });

  it("unions two skeleton points", () => {
    const controller = makeSkeletonController();
    expect(
      controller.getSelectionBounds(new Set(["skeletonPoint/1/2", "skeletonPoint/1/3"]))
    ).to.deep.equal({ xMin: 100, yMin: 200, xMax: 300, yMax: 200 });
  });

  it("resolves a skeleton rib via the shared forward projection", () => {
    const controller = makeSkeletonController();
    const skeletonData = controller.instance.customData["fontra.internal"].skeleton;
    const contour = skeletonData.contours[0];
    const expected = getSkeletonRibPosition(contour, contour.points[0], "left");
    expect(
      controller.getSelectionBounds(new Set(["skeletonRib/1/2/left"]))
    ).to.deep.equal({
      xMin: expected.x,
      yMin: expected.y,
      xMax: expected.x,
      yMax: expected.y,
    });
  });

  it("unions a path point and a skeleton point", () => {
    const controller = makeSkeletonController();
    const bounds = controller.getSelectionBounds(
      new Set(["point/0", "skeletonPoint/1/3"])
    );
    // path point 0 is (60, 0); skeleton point 3 is (300, 200)
    expect(bounds).to.deep.equal({ xMin: 60, yMin: 0, xMax: 300, yMax: 200 });
  });
});

describe("interpolation ignores markers", () => {
  function layerGlyphWithMarker() {
    const glyph = StaticGlyph.fromObject(makeTestStaticGlyphObject());
    setMarkerData(glyph, {
      markers: [
        {
          id: "marker0",
          ends: [
            { kind: "pathSegment", contourIndex: 0, segmentIndex: 0, t: 0.5 },
            { kind: "cast" },
          ],
          signature: { counts: [4], closed: [true] },
        },
      ],
      groups: [],
    });
    return glyph;
  }

  // A layer's customData reaches TWO comparisons: the interpolation model, and the
  // compatibility check the source panel's warning reads. Markers are not interpolable
  // data — ids and address kinds, not numbers — and two sources need not carry the same
  // ones, so both must drop them. Dropping only one leaves a glyph that interpolates
  // correctly while the panel still reports it broken.

  it("the compatibility check drops markers", () => {
    const stripped = stripNonInterpolatablesAndSortAnchors(layerGlyphWithMarker());
    expect(getMarkers(stripped)).to.deep.equal([]);
  });

  it("the interpolation model drops markers", () => {
    const [stripped] = ensureGlyphCompatibility(
      [{ sourceLocation: {}, glyph: layerGlyphWithMarker() }],
      {}
    );
    expect(getMarkers(stripped)).to.deep.equal([]);
  });

  // This assertion used to read `to.not.equal(undefined)`, and getSkeletonData answers
  // a missing block with null, so it went on passing when the skeleton stopped
  // reaching the model. Assert the thing itself.

  it("the compatibility check drops the skeleton as well", () => {
    // The check asks whether two drawings match, and the skeleton is not a drawing.
    const glyph = layerGlyphWithMarker();
    setSkeletonData(glyph, { contours: [], generated: [], nextId: 1 });
    expect(getSkeletonData(stripNonInterpolatablesAndSortAnchors(glyph))).to.equal(
      null
    );
  });

  it("the interpolation model keeps the skeleton", () => {
    const glyph = layerGlyphWithMarker();
    setSkeletonData(glyph, { contours: [], generated: [], nextId: 1 });
    const [stripped] = ensureGlyphCompatibility([{ sourceLocation: {}, glyph }], {});
    expect(getSkeletonData(stripped)).to.not.equal(null);
  });

  it("leaves the original glyph's markers alone", () => {
    const glyph = layerGlyphWithMarker();
    stripNonInterpolatablesAndSortAnchors(glyph);
    ensureGlyphCompatibility([{ sourceLocation: {}, glyph }], {});
    expect(getMarkers(glyph)).to.have.lengthOf(1);
  });
});

describe("the interpolation model carries the skeleton", () => {
  // The skeleton is the recipe the outline was drawn from, and a new source is created
  // from an interpolated instance. A model that drops the skeleton hands the new source
  // an outline with no recipe behind it, so the glyph stops being editable as a
  // skeleton the moment a second source exists. The same instance feeds the display at
  // a not-yet-created font source, which is why this is the model's own contract and
  // not the source panel's.
  //
  // What must not come back is the fault that made the skeleton dropped in the first
  // place: two masters holding different sets of entries stopped the itemwise
  // comparison and were reported to the designer as an interpolation error on a glyph
  // whose outlines matched exactly. So the block is normalized before the model sees
  // it, and it is dropped only where the two skeletons genuinely do not match.

  function skeletonGlyph(skeleton) {
    const glyph = StaticGlyph.fromObject(makeTestStaticGlyphObject());
    setSkeletonData(glyph, skeleton);
    return glyph;
  }

  function makeSkeleton(points) {
    return {
      version: 1,
      nextId: 100,
      contours: [{ id: 1, closed: false, defaultWidth: 80, singleSided: null, points }],
      generated: [],
    };
  }

  function onCurve(id, x, y, extra = {}) {
    return { id, x, y, type: null, smooth: false, ...extra };
  }

  it("keeps the skeleton on a single master", () => {
    const glyph = skeletonGlyph(makeSkeleton([onCurve(2, 0, 0), onCurve(3, 100, 0)]));
    const [master] = ensureGlyphCompatibility([{ sourceLocation: {}, glyph }], {});
    expect(getSkeletonData(master)?.contours).to.have.lengthOf(1);
  });

  it("keeps skeletons that differ only in the entries one master stores", () => {
    // The measured F^1.json case: a handle offset written in one master and absent in
    // the other. Normalization materializes both, so the entry sets agree.
    const masters = ensureGlyphCompatibility(
      [
        {
          sourceLocation: {},
          glyph: skeletonGlyph(
            makeSkeleton([
              onCurve(2, 0, 0, { handleOffsets: { leftIn: { x: 3, y: 4 } } }),
              onCurve(3, 100, 0),
            ])
          ),
        },
        {
          sourceLocation: { wght: 1 },
          glyph: skeletonGlyph(makeSkeleton([onCurve(2, 0, 0), onCurve(3, 120, 0)])),
        },
      ],
      {}
    );
    for (const master of masters) {
      expect(getSkeletonData(master)?.contours).to.have.lengthOf(1);
    }
    expect(() =>
      addItemwise(masters[0].customData, masters[1].customData)
    ).to.not.throw();
  });

  it("drops the skeleton from every master where two skeletons do not match", () => {
    const masters = ensureGlyphCompatibility(
      [
        {
          sourceLocation: {},
          glyph: skeletonGlyph(makeSkeleton([onCurve(2, 0, 0), onCurve(3, 100, 0)])),
        },
        {
          sourceLocation: { wght: 1 },
          glyph: skeletonGlyph(
            makeSkeleton([onCurve(2, 0, 0), onCurve(3, 100, 0), onCurve(4, 200, 0)])
          ),
        },
      ],
      {}
    );
    for (const master of masters) {
      expect(getSkeletonData(master)).to.equal(null);
    }
    expect(() =>
      addItemwise(masters[0].customData, masters[1].customData)
    ).to.not.throw();
  });

  it("still drops the markers it always dropped", () => {
    const glyph = skeletonGlyph(makeSkeleton([onCurve(2, 0, 0), onCurve(3, 100, 0)]));
    setMarkerData(glyph, {
      markers: [{ id: "marker0", ends: [], signature: {} }],
      groups: [],
    });
    const [master] = ensureGlyphCompatibility([{ sourceLocation: {}, glyph }], {});
    expect(getMarkers(master)).to.deep.equal([]);
    expect(getSkeletonData(master)?.contours).to.have.lengthOf(1);
  });
});
