import {
  attachmentState,
  decomposeToGlyphNames,
  getAttachments,
  getCompositionData,
  markAnchorNames,
  matchAnchorNames,
  plainAnchorNames,
  planAttachments,
  remapAttachmentsForDelete,
  remapAttachmentsForInsert,
  setCompositionData,
  solveOffset,
  transformedAnchorMap,
} from "@fontra/core/composition.js";
import { getDecomposedIdentity } from "@fontra/core/transform.js";
import { FONTRA_INTERNAL_SECTIONS } from "@fontra/core/fontra-internal-schema.js";
import { expect } from "chai";

describe("composition — stored section", () => {
  it("names the section", () => {
    expect(FONTRA_INTERNAL_SECTIONS.COMPOSITION).to.equal("composition");
  });

  it("returns undefined for a glyph that has none", () => {
    expect(getCompositionData({})).to.equal(undefined);
  });

  it("round-trips a deep copy", () => {
    const glyph = {};
    const entry = { anchorName: "top", detached: false };
    setCompositionData(glyph, { attachments: [null, entry] });
    const read = getCompositionData(glyph);
    expect(read.attachments[1].anchorName).to.equal("top");
    expect(read.attachments[1]).to.not.equal(entry);
  });

  it("pads the attachment list to the component count", () => {
    const glyph = {};
    setCompositionData(glyph, { attachments: [null] });
    expect(getAttachments(glyph, 3)).to.deep.equal([null, null, null]);
  });

  it("truncates an attachment list longer than the component count", () => {
    const glyph = {};
    const entry = { anchorName: "top", detached: false };
    setCompositionData(glyph, { attachments: [null, entry, entry] });
    expect(getAttachments(glyph, 2).length).to.equal(2);
  });

  it("returns all-null for a glyph with no section", () => {
    expect(getAttachments({}, 2)).to.deep.equal([null, null]);
  });
});

describe("composition — matching", () => {
  it("matches the one shared name", () => {
    expect(matchAnchorNames(["top", "bottom"], ["top"])).to.deep.equal({
      anchorName: "top",
    });
  });

  it("refuses a mark carrying no underscore anchor", () => {
    expect(matchAnchorNames(["top"], [])).to.deep.equal({
      refusal: "no-mark-anchor",
      names: [],
    });
  });

  it("refuses where nothing is shared", () => {
    expect(matchAnchorNames(["top"], ["bottom"])).to.deep.equal({
      refusal: "no-shared-anchor",
      names: [],
    });
  });

  it("refuses a mark that matches two base anchors", () => {
    expect(matchAnchorNames(["top", "bottom"], ["top", "bottom"])).to.deep.equal({
      refusal: "ambiguous-mark",
      names: ["bottom", "top"],
    });
  });

  it("ignores a mark anchor the base does not carry", () => {
    expect(matchAnchorNames(["top"], ["top", "center"])).to.deep.equal({
      anchorName: "top",
    });
  });
});

describe("composition — planning a whole glyph", () => {
  it("attaches two marks to two different anchors", () => {
    const plan = planAttachments(["top", "bottom"], [["top"], ["bottom"]]);
    expect(plan.results).to.deep.equal([
      { componentIndex: 0, anchorName: "top" },
      { componentIndex: 1, anchorName: "bottom" },
    ]);
    expect(plan.refusals).to.deep.equal([]);
  });

  it("refuses both components where two claim one anchor", () => {
    const plan = planAttachments(["top"], [["top"], ["top"]]);
    expect(plan.results).to.deep.equal([]);
    expect(plan.refusals.map((r) => r.reason)).to.deep.equal([
      "anchor-taken",
      "anchor-taken",
    ]);
  });

  it("refuses only the bad component and keeps the good one", () => {
    const plan = planAttachments(["top", "bottom"], [["top"], ["nothing"]]);
    expect(plan.results).to.deep.equal([{ componentIndex: 0, anchorName: "top" }]);
    expect(plan.refusals).to.deep.equal([
      { componentIndex: 1, reason: "no-shared-anchor", names: [] },
    ]);
  });
});

describe("composition — anchors and the offset", () => {
  const anchors = [
    { name: "top", x: 250, y: 700 },
    { name: "_top", x: 100, y: 0 },
  ];

  it("splits plain from underscore names", () => {
    expect(plainAnchorNames(anchors)).to.deep.equal(["top"]);
    expect(markAnchorNames(anchors)).to.deep.equal(["top"]);
  });

  it("moves anchors by the component transform", () => {
    const transformation = {
      ...getDecomposedIdentity(),
      translateX: 30,
      translateY: -5,
    };
    const map = transformedAnchorMap(anchors, transformation);
    expect(map["top"]).to.deep.equal([280, 695]);
  });

  it("scales anchors by the component transform", () => {
    const transformation = { ...getDecomposedIdentity(), scaleX: 2, scaleY: 0.5 };
    const map = transformedAnchorMap(anchors, transformation);
    expect(map["top"]).to.deep.equal([500, 350]);
  });

  it("the offset is base minus mark", () => {
    expect(solveOffset([250, 700], [100, 0])).to.deep.equal([150, 700]);
  });

  it("the offset is negative where the mark anchor is above the base anchor", () => {
    expect(solveOffset([0, 100], [0, 300])).to.deep.equal([0, -200]);
  });
});

describe("composition — states", () => {
  const entry = (detached = false) => ({ anchorName: "top", detached });

  it("no entry is unattached", () => {
    expect(attachmentState({ entry: null, aligned: true })).to.equal("unattached");
  });

  it("a missing anchor is broken", () => {
    expect(attachmentState({ entry: entry(), aligned: null })).to.equal("broken");
  });

  it("broken beats detached", () => {
    expect(attachmentState({ entry: entry(true), aligned: null })).to.equal("broken");
  });

  it("detached beats out of date", () => {
    expect(attachmentState({ entry: entry(true), aligned: false })).to.equal(
      "detached"
    );
  });

  it("anchors that do not coincide are out of date", () => {
    expect(attachmentState({ entry: entry(), aligned: false })).to.equal("outOfDate");
  });

  it("anchors that coincide are in sync", () => {
    expect(attachmentState({ entry: entry(), aligned: true })).to.equal("inSync");
  });

  it("a detached component that happens to be aligned reads in sync", () => {
    // The flag says the designer overruled the solve. Where the drawing agrees
    // with the solve anyway, there is nothing to overrule and nothing to report.
    expect(attachmentState({ entry: entry(true), aligned: true })).to.equal("inSync");
  });
});

describe("composition — component-list bookkeeping", () => {
  const a = { anchorName: "top", detached: false };
  const b = { anchorName: "bottom", detached: false };

  it("inserting at the end leaves entries alone", () => {
    expect(remapAttachmentsForInsert([null, a], 2, 1)).to.deep.equal([null, a, null]);
  });

  it("inserting in the middle shifts later entries right", () => {
    expect(remapAttachmentsForInsert([null, a, b], 1, 2)).to.deep.equal([
      null,
      null,
      null,
      a,
      b,
    ]);
  });

  it("deleting one entry shifts later entries left", () => {
    expect(remapAttachmentsForDelete([null, a, b], [1])).to.deep.equal([null, b]);
  });

  it("deletes several indices in any order", () => {
    expect(remapAttachmentsForDelete([null, a, b], [2, 0])).to.deep.equal([a]);
  });

  it("deleting nothing changes nothing", () => {
    expect(remapAttachmentsForDelete([null, a], [])).to.deep.equal([null, a]);
  });
});

describe("composition — decomposition", () => {
  const names = { 0x61: "a", 0x301: "acutecomb" };
  const lookup = (codePoint) => names[codePoint];

  it("names the parts of aacute", () => {
    // U+00E1 LATIN SMALL LETTER A WITH ACUTE
    const result = decomposeToGlyphNames(0x00e1, lookup);
    expect(result.glyphNames).to.deep.equal(["a", "acutecomb"]);
    expect(result.missing).to.deep.equal([]);
  });

  it("reports a part the font cannot name", () => {
    const result = decomposeToGlyphNames(0x00e1, (cp) =>
      cp === 0x61 ? "a" : undefined
    );
    expect(result.glyphNames).to.deep.equal(["a"]);
    expect(result.missing).to.deep.equal([0x301]);
  });

  it("returns nothing for a character with no decomposition", () => {
    const result = decomposeToGlyphNames(0x61, lookup);
    expect(result.glyphNames).to.deep.equal([]);
    expect(result.missing).to.deep.equal([]);
  });
});
