import {
  getAttachments,
  getCompositionData,
  setCompositionData,
} from "@fontra/core/composition.js";
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
