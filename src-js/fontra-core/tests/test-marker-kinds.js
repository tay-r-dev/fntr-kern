import { markerGeometry } from "@fontra/core/marker-measure.js";
import {
  computeMarkerSignature,
  markerIsStale,
  markerKind,
  refreshedMarkers,
  snapToCurvatureApex,
} from "@fontra/core/marker-model.js";
import { PathHitTester } from "@fontra/core/path-hit-tester.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

function pathOf(...contours) {
  const path = new VarPackedPath();
  for (const contour of contours) {
    path.appendUnpackedContour(contour);
  }
  return path;
}

function square() {
  return pathOf({
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    isClosed: true,
  });
}

// A quarter circle of radius 100 about the origin, as one cubic from (100, 0) to
// (0, 100), closed by two straights through the centre.
const CIRCLE_HANDLE = 100 * 0.5523;
function quarterDisc() {
  return pathOf({
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: CIRCLE_HANDLE, type: "cubic" },
      { x: CIRCLE_HANDLE, y: 100, type: "cubic" },
      { x: 0, y: 100 },
    ],
    isClosed: true,
  });
}

function glyphFor(path) {
  return {
    flattenedPath: path,
    flattenedPathHitTester: new PathHitTester(path, path.getControlBounds()),
  };
}

describe("marker kinds", () => {
  it("names each kind", () => {
    const anchor = { kind: "pathSegment", contourIndex: 0, segmentIndex: 0, t: 0.5 };
    expect(markerKind({ ends: [anchor, { kind: "cast" }] })).to.equal("ray");
    expect(markerKind({ ends: [anchor, anchor] })).to.equal("dimension");
    expect(markerKind({ kind: "ruler", ends: [] })).to.equal("ruler");
    expect(markerKind({ kind: "curvature", ends: [anchor] })).to.equal("curvature");
  });
});

// A ruler is the Power Ruler kept: a line through the glyph at a place and an angle the
// designer chose, measuring every span it crosses, in the black and in the white. It is
// attached to nothing, so it can never go stale.
describe("marker kinds — a ruler", () => {
  const ruler = { id: "m1", kind: "ruler", ends: [], at: { x: -50, y: 50 }, angle: 0 };

  it("measures every span along its line", () => {
    const path = square();
    const geometry = markerGeometry(glyphFor(path), ruler, null);
    expect(geometry.stale).to.equal(false);
    expect(geometry.isRuler).to.equal(true);
    expect(geometry.angle).to.be.closeTo(0, 1e-9);
    const inside = geometry.measurePoints.filter((span) => span.inside);
    expect(inside.map((span) => span.distance)).to.deep.equal([100]);
  });

  it("orders its spans along the line and counts the extra lines", () => {
    // The side-bearing lines at x = -20 and x = 130 add two white spans.
    const path = square();
    const extraLines = [-20, 130].map((x) => ({
      p1: { x, y: -1000 },
      p2: { x, y: 1000 },
    }));
    const geometry = markerGeometry(glyphFor(path), ruler, null, { extraLines });
    expect(geometry.measurePoints.map((span) => span.distance)).to.deep.equal([
      20, 100, 30,
    ]);
  });

  it("has one grip, where it was put", () => {
    const geometry = markerGeometry(glyphFor(square()), ruler, null);
    expect(geometry.grips).to.deep.equal([{ point: { x: -50, y: 50 } }]);
  });

  it("is never stale, and a refresh leaves its place and angle", () => {
    const path = square();
    expect(markerIsStale(ruler, path, null)).to.equal(false);
    const refreshed = refreshedMarkers([ruler], path, null);
    const kept = refreshed ? refreshed[0] : ruler;
    expect(kept.at).to.deep.equal(ruler.at);
    expect(kept.angle).to.equal(0);
  });
});

// A curvature marker reads how hard the outline bends where it sits: the curvature, and
// the radius of the circle that fits the curve there.
describe("marker kinds — a curvature marker", () => {
  function curvatureMarker(path, segmentIndex, t) {
    return {
      id: "m1",
      kind: "curvature",
      ends: [{ kind: "pathSegment", contourIndex: 0, segmentIndex, t }],
      signature: computeMarkerSignature(path),
    };
  }

  it("reads the radius and the centre of a circular arc", () => {
    const path = quarterDisc();
    const geometry = markerGeometry(
      glyphFor(path),
      curvatureMarker(path, 1, 0.5),
      null
    );
    expect(geometry.stale).to.equal(false);
    expect(geometry.isCurvature).to.equal(true);
    // A cubic is not a circle: at its middle this one bends 0.6 per cent less than a
    // circle of radius 100 does, and its centre stands off the origin by as much.
    expect(geometry.radius).to.be.closeTo(100, 1);
    expect(geometry.curvature).to.be.closeTo(1 / geometry.radius, 1e-12);
    expect(geometry.center.x).to.be.closeTo(0, 1);
    expect(geometry.center.y).to.be.closeTo(0, 1);
    expect(geometry.grips).to.have.length(1);
  });

  it("reads a straight as no curvature and no centre", () => {
    const path = quarterDisc();
    const geometry = markerGeometry(
      glyphFor(path),
      curvatureMarker(path, 0, 0.5),
      null
    );
    expect(geometry.curvature).to.equal(0);
    expect(geometry.radius).to.equal(Infinity);
    expect(geometry.center).to.equal(null);
  });

  it("goes stale where its place is gone", () => {
    const path = quarterDisc();
    const marker = curvatureMarker(path, 7, 0.5);
    expect(markerGeometry(glyphFor(path), marker, null).stale).to.equal(true);
  });
});

// A curvature marker snaps to the apex of its curve: the place it bends hardest, a
// local maximum of the curvature inside the segment.
describe("marker kinds — the curvature apex", () => {
  // A symmetric arch from (0, 0) to (100, 0): its apex is its middle, (50, 75).
  function arch() {
    return pathOf({
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 100, type: "cubic" },
        { x: 50, y: 100, type: "cubic" },
        { x: 100, y: 0 },
      ],
      isClosed: true,
    });
  }
  const onArch = (t) => ({ kind: "pathSegment", contourIndex: 0, segmentIndex: 0, t });

  it("moves an end near the apex onto it", () => {
    const snapped = snapToCurvatureApex(
      onArch(0.46),
      { path: arch() },
      { x: 48, y: 75 },
      10
    );
    expect(snapped.t).to.be.closeTo(0.5, 1e-4);
    expect(snapped.at.x).to.be.closeTo(50, 1e-3);
    expect(snapped.at.y).to.be.closeTo(75, 1e-3);
  });

  it("leaves an end the cursor holds away from the apex", () => {
    const end = onArch(0.2);
    expect(snapToCurvatureApex(end, { path: arch() }, { x: 20, y: 40 }, 10)).to.equal(
      end
    );
  });

  it("leaves an end on a straight, which has no apex", () => {
    const end = { kind: "pathSegment", contourIndex: 0, segmentIndex: 1, t: 0.5 };
    expect(snapToCurvatureApex(end, { path: arch() }, { x: 50, y: 0 }, 10)).to.equal(
      end
    );
  });
});
