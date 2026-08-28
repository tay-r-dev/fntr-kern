import {
  computeMarkerSignature,
  markerIndicesChanged,
  markerIsStale,
  resolveMarkerEnd,
  withAnchorPosition,
} from "@fontra/core/marker-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

// A square, so a point can be inserted mid-edge without moving the outline at all.
function squarePath() {
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
  return path;
}

function rayEndOn(path, contourIndex = 0, segmentIndex = 0, t = 0.5) {
  return withAnchorPosition(
    { kind: "pathSegment", contourIndex, segmentIndex, t },
    path
  );
}

function markerWith(end, path = squarePath()) {
  return {
    id: "m1",
    ends: [end, { kind: "cast" }],
    signature: computeMarkerSignature(path),
  };
}

// The tests below resolve a single end, so they state for themselves whether the
// indices moved — which is what a marker's signature answers in real use.
function resolveAgainst(end, path, marker = markerWith(end)) {
  return resolveMarkerEnd(end, {
    path,
    indicesChanged: markerIndicesChanged(marker, path),
  });
}

describe("marker anchoring — the three cases", () => {
  it("remembers where the anchor was, so it can be checked later", () => {
    const end = rayEndOn(squarePath());
    expect(end.at).to.deep.include({ x: 50, y: 0 });
  });

  // Case 2: the points moved, the indices did not. The anchor is a parameter on a
  // curve and the curve is read live, so it rides. No repair, no staleness.
  it("rides geometry that moved without changing the point count", () => {
    const end = rayEndOn(squarePath());
    const moved = squarePath();
    moved.coordinates[2] = 200; // the second point walks right
    const resolved = resolveAgainst(end, moved);
    expect(resolved.verdict).to.equal("ok");
    expect(resolved.point.x).to.be.closeTo(100, 0.001);
    expect(markerIsStale(markerWith(end), moved)).to.equal(false);
  });

  // Case 1: a point is inserted, so every index after it shifts, but the outline
  // through the anchor is untouched. The marker stays and its address is rewritten.
  it("survives an inserted point when the outline is unchanged", () => {
    const end = rayEndOn(squarePath(), 0, 1); // the right edge, x = 100
    const before = resolveAgainst(end, squarePath());

    const grown = squarePath();
    grown.insertPoint(0, 1, { x: 50, y: 0 }); // mid-way along the BOTTOM edge

    const after = resolveAgainst(end, grown);
    expect(after.verdict).to.equal("ok");
    expect(after.point.x).to.be.closeTo(before.point.x, 0.001);
    expect(after.point.y).to.be.closeTo(before.point.y, 0.001);
    // The address is rewritten to where that place now lives.
    expect(after.end.segmentIndex).to.not.equal(end.segmentIndex);
    expect(markerIsStale(markerWith(end), grown)).to.equal(false);
  });

  it("survives a whole new contour appearing elsewhere", () => {
    const end = rayEndOn(squarePath());
    const more = squarePath();
    more.appendUnpackedContour({
      points: [
        { x: 300, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 100 },
      ],
      isClosed: true,
    });
    expect(markerIsStale(markerWith(end), more)).to.equal(false);
    expect(resolveAgainst(end, more).verdict).to.equal("ok");
  });

  // Case 3: the indices changed AND the outline moved out from under the anchor.
  it("stales in place when the geometry under it is gone", () => {
    const end = rayEndOn(squarePath(), 0, 1); // the right edge, x = 100
    const wrecked = squarePath();
    wrecked.deletePoint(0, 1);
    wrecked.deletePoint(0, 1);

    const resolved = resolveAgainst(end, wrecked);
    expect(resolved.verdict).to.equal("stale");
    // Stale IN THE SAME PLACE: it stays where it was so it can be found and dragged.
    expect(resolved.point).to.deep.include({ x: end.at.x, y: end.at.y });
    expect(markerIsStale(markerWith(end), wrecked)).to.equal(true);
  });

  it("comes back when the geometry is restored, which is the undo property", () => {
    const end = rayEndOn(squarePath(), 0, 1);
    const wrecked = squarePath();
    wrecked.deletePoint(0, 1);
    wrecked.deletePoint(0, 1);
    expect(markerIsStale(markerWith(end), wrecked)).to.equal(true);
    expect(markerIsStale(markerWith(end), squarePath())).to.equal(false);
  });

  // A marker dropped on empty canvas belongs to nothing and cannot break.
  it("never stales a free marker", () => {
    const end = { kind: "free", x: 500, y: 500 };
    const resolved = resolveAgainst(end, squarePath());
    expect(resolved.verdict).to.equal("ok");
    expect(resolved.point).to.deep.include({ x: 500, y: 500 });
    expect(markerIsStale(markerWith(end), squarePath())).to.equal(false);
  });

  it("reversing a contour leaves the marker where it was", () => {
    // Reversal keeps the outline exactly where it is, so the anchor's place is
    // unchanged and the address is simply rewritten. It needs no special case.
    const end = rayEndOn(squarePath(), 0, 1);
    const before = resolveAgainst(end, squarePath());

    const reversed = new VarPackedPath();
    reversed.appendUnpackedContour({
      points: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 0 },
      ],
      isClosed: true,
    });
    const after = resolveAgainst(end, reversed);
    expect(after.verdict).to.equal("ok");
    expect(after.point.x).to.be.closeTo(before.point.x, 0.001);
    expect(after.point.y).to.be.closeTo(before.point.y, 0.001);
  });
});
