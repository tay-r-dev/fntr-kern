import { FONTRA_INTERNAL_SECTIONS } from "@fontra/core/fontra-internal-schema.js";
import {
  allocateMarkerId,
  getMarkerData,
  getMarkerGroups,
  getMarkers,
  setMarkerData,
} from "@fontra/core/marker-model.js";
import { expect } from "chai";

describe("marker-model — the stored section", () => {
  it("names the section", () => {
    expect(FONTRA_INTERNAL_SECTIONS.MARKERS).to.equal("markers");
  });

  it("returns undefined for a glyph that has none", () => {
    expect(getMarkerData({})).to.equal(undefined);
  });

  it("returns empty lists for a glyph that has none", () => {
    expect(getMarkers({})).to.deep.equal([]);
    expect(getMarkerGroups({})).to.deep.equal([]);
  });

  it("round-trips a deep copy", () => {
    const layerGlyph = {};
    const marker = { id: "m1", ends: [], signature: [] };
    setMarkerData(layerGlyph, { markers: [marker], groups: [] });
    const read = getMarkerData(layerGlyph);
    expect(read.markers[0].id).to.equal("m1");
    expect(read.markers[0]).to.not.equal(marker);
  });

  it("allocates an id that is not already present", () => {
    const layerGlyph = {};
    setMarkerData(layerGlyph, { markers: [{ id: "m1" }, { id: "m2" }], groups: [] });
    const id = allocateMarkerId(layerGlyph);
    expect(id).to.not.equal("m1");
    expect(id).to.not.equal("m2");
  });

  it("does not reuse the id of a deleted marker", () => {
    const layerGlyph = {};
    setMarkerData(layerGlyph, { markers: [{ id: "m1" }, { id: "m2" }], groups: [] });
    const deleted = getMarkerData(layerGlyph);
    deleted.markers = [{ id: "m1" }];
    setMarkerData(layerGlyph, deleted);
    const id = allocateMarkerId(layerGlyph);
    expect(id).to.not.equal("m2");
  });
});
