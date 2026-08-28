import { FONTRA_INTERNAL_SECTIONS } from "@fontra/core/fontra-internal-schema.js";
import {
  allocateMarkerId,
  computeMarkerSignature,
  getMarkerData,
  getMarkerGroups,
  getMarkers,
  markerIsStale,
  setMarkerData,
} from "@fontra/core/marker-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
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

// A square and a triangle, so the two contours have different counts.
function twoContourPath() {
  const path = new VarPackedPath();
  path.appendUnpackedContour({
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    isClosed: true,
  });
  path.appendUnpackedContour({
    points: [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
      { x: 250, y: 100 },
    ],
    isClosed: true,
  });
  return path;
}

function markerOn(contourIndex, path) {
  return {
    id: "m1",
    ends: [
      { kind: "pathSegment", contourIndex, segmentStart: 0, t: 0.5 },
      { kind: "cast" },
    ],
    signature: computeMarkerSignature(path),
  };
}

describe("marker-model — the stale rule", () => {
  it("is not stale against the path it was written on", () => {
    const path = twoContourPath();
    expect(markerIsStale(markerOn(0, path), path)).to.equal(false);
  });

  it("is not stale when the points only move", () => {
    const marker = markerOn(0, twoContourPath());
    const moved = twoContourPath();
    moved.coordinates[0] = -40;
    moved.coordinates[1] = -40;
    expect(markerIsStale(marker, moved)).to.equal(false);
  });

  it("is stale when a point is inserted on its own contour", () => {
    const marker = markerOn(0, twoContourPath());
    const grown = twoContourPath();
    grown.insertPoint(0, 1, { x: 50, y: 0 });
    expect(markerIsStale(marker, grown)).to.equal(true);
  });

  it("is stale when a point is deleted from its own contour", () => {
    const marker = markerOn(0, twoContourPath());
    const shrunk = twoContourPath();
    shrunk.deletePoint(0, 1);
    expect(markerIsStale(marker, shrunk)).to.equal(true);
  });

  it("is stale when ANY contour changes count", () => {
    const marker = markerOn(0, twoContourPath());
    const other = twoContourPath();
    other.insertPoint(1, 1, { x: 260, y: 10 });
    expect(markerIsStale(marker, other)).to.equal(true);
  });

  it("is stale when a contour is removed", () => {
    const marker = markerOn(1, twoContourPath());
    const fewer = twoContourPath();
    fewer.deleteContour(0);
    expect(markerIsStale(marker, fewer)).to.equal(true);
  });

  it("is stale when a closed contour is opened", () => {
    const marker = markerOn(0, twoContourPath());
    const opened = twoContourPath();
    opened.contourInfo[0].isClosed = false;
    expect(markerIsStale(marker, opened)).to.equal(true);
  });

  it("comes back when the count is restored, which is the undo property", () => {
    const marker = markerOn(0, twoContourPath());
    const grown = twoContourPath();
    grown.insertPoint(0, 1, { x: 50, y: 0 });
    expect(markerIsStale(marker, grown)).to.equal(true);
    expect(markerIsStale(marker, twoContourPath())).to.equal(false);
  });

  it("never stales a skeleton anchor", () => {
    const marker = {
      id: "m1",
      ends: [
        { kind: "skeletonPoint", contourId: "c1", pointId: "p1", t: 0.5 },
        { kind: "cast" },
      ],
      signature: computeMarkerSignature(twoContourPath()),
    };
    const fewer = twoContourPath();
    fewer.deleteContour(0);
    expect(markerIsStale(marker, fewer)).to.equal(false);
  });
});
