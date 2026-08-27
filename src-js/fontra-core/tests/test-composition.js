import {
  getAttachments,
  getCompositionData,
  markAnchorNames,
  matchAnchorNames,
  plainAnchorNames,
  planAttachments,
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
