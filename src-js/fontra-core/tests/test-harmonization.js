import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import {
  HARMONIZE_DEFAULTS,
  calculateG3Targets,
  calculateHarmonicTarget,
  curvatureDiscontinuity,
  curvatureRateDiscontinuity,
  expandToJoints,
  getJointContext,
  harmonizePath,
  harmonizePathInPlace,
  measureG2Discontinuity,
} from "@fontra/core/harmonization.js";
import { calculateTunniPoint } from "@fontra/core/tunni-calculations.js";
import VarArray from "@fontra/core/var-array.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { distance } from "@fontra/core/vector.js";
import { expect } from "chai";

// --- fixtures ---------------------------------------------------------------
//
// Every fixture is a closed contour of the shape
//
//     A(on)  PP(off)  P(off)  node(on, smooth)  N(off)  NN(off)  C(on)
//
// so `node` sits at absolute point index 3 and carries the 5-point stencil
// the harmonization algorithm needs.

function makeContour(points, isClosed = true) {
  return VarPackedPath.fromUnpackedContours([{ points, isClosed }]);
}

function cubic(x, y) {
  return { x, y, type: "cubic" };
}

// node is exactly at the harmonic position already
function symmetricPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(0, 50),
    cubic(50, 100),
    { x: 100, y: 100, smooth: true },
    cubic(150, 100),
    cubic(200, 50),
    { x: 200, y: 0 },
  ]);
}

// same tangent line, asymmetric outer handles -> needs a real correction
function asymmetricPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(0, 20),
    cubic(50, 100),
    { x: 110, y: 100, smooth: true },
    cubic(150, 100),
    cubic(200, 50),
    { x: 200, y: 0 },
  ]);
}

// outgoing outer handle is nearly degenerate: the harmonic target sits far
// past the floor of the outgoing handle -> clamping territory
function clampPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(0, 20),
    cubic(50, 100),
    { x: 110, y: 100, smooth: true },
    cubic(150, 100),
    cubic(150.1, 99.9),
    { x: 200, y: 0 },
  ]);
}

// two smooth joints sharing handles: correcting one disturbs the other
function coupledPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(0, 40),
    cubic(40, 100),
    { x: 110, y: 100, smooth: true },
    cubic(160, 100),
    cubic(220, 60),
    { x: 240, y: 20, smooth: true },
    cubic(250, 0),
    cubic(200, -40),
  ]);
}

// the joint sits far along the tangent and the incoming outer handle is nearly
// flat, so harmonization wants to grow the incoming handle straight past its
// segment's Tunni point -- the handle lines cross and the curve doubles back
function overshootPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(6, 60),
    cubic(40, 100),
    { x: 60, y: 100, smooth: true },
    cubic(300, 100),
    cubic(360, 60),
    { x: 380, y: 0 },
  ]);
}

// How far the joint's own handle on each side reaches toward that segment's
// Tunni point. 1 lands on it; past 1 the segment's handle lines have crossed.
function jointHandleTensions(path) {
  const ctx = getJointContext(path, NODE);
  const first = path.getPoint(0);
  const last = path.getPoint(6);
  const tunniIn = calculateTunniPoint([first, ctx.PP, ctx.P, ctx.node]);
  const tunniOut = calculateTunniPoint([ctx.node, ctx.N, ctx.NN, last]);
  return [
    tunniIn ? distance(ctx.node, ctx.P) / distance(ctx.node, tunniIn) : 0,
    tunniOut ? distance(ctx.node, ctx.N) / distance(ctx.node, tunniOut) : 0,
  ];
}

// the two outer handle lines are parallel -> no intersection
function parallelPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(0, 150),
    cubic(50, 100),
    { x: 110, y: 100, smooth: true },
    cubic(150, 100),
    cubic(200, 50),
    { x: 200, y: 0 },
  ]);
}

const NODE = 3; // absolute index of the smooth joint in all fixtures above

function nodePos(path) {
  const [x, y] = path.getPointPosition(NODE);
  return { x, y };
}

// --- donor reference implementation -----------------------------------------
//
// Direct transcription of Green Harmony's `harmonize()`
// (_external/green-harmony/.../plugin.py:32). Kept verbatim so the port can be
// checked against the donor rather than against itself.

function donorGetIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;
  return { x: px, y: py };
}

function donorRemap(oldValue, oldMin, oldMax, newMin, newMax) {
  return ((oldValue - oldMin) * (newMax - newMin)) / (oldMax - oldMin) + newMin;
}

function donorHarmonize(path, nodeIndex) {
  const P = path.getPoint(nodeIndex - 1);
  const PP = path.getPoint(nodeIndex - 2);
  const N = path.getPoint(nodeIndex + 1);
  const NN = path.getPoint(nodeIndex + 2);
  const intersection = donorGetIntersection(N.x, N.y, NN.x, NN.y, P.x, P.y, PP.x, PP.y);
  const r0 = distance(NN, N) / distance(N, intersection);
  const r1 = distance(intersection, P) / distance(P, PP);
  const ratio = Math.sqrt(r0 * r1);
  const t = ratio / (ratio + 1);
  return {
    x: donorRemap(t, 0, 1, N.x, P.x),
    y: donorRemap(t, 0, 1, N.y, P.y),
  };
}

// --- getJointContext --------------------------------------------------------

describe("harmonization: getJointContext", () => {
  it("returns the five-point stencil around a smooth curve joint", () => {
    const ctx = getJointContext(asymmetricPath(), NODE);
    expect(ctx.reason).to.equal(undefined);
    expect(ctx.contourIndex).to.equal(0);
    expect(ctx.pointIndex).to.equal(NODE);
    expect(ctx.node).to.deep.equal({ x: 110, y: 100 });
    expect(ctx.P).to.deep.equal({ x: 50, y: 100 });
    expect(ctx.PP).to.deep.equal({ x: 0, y: 20 });
    expect(ctx.N).to.deep.equal({ x: 150, y: 100 });
    expect(ctx.NN).to.deep.equal({ x: 200, y: 50 });
    expect(ctx.indices).to.deep.equal({ PP: 1, P: 2, N: 4, NN: 5 });
  });

  it("reports not-smooth for a corner point", () => {
    const path = asymmetricPath();
    path.setPointType(NODE, undefined, false);
    expect(getJointContext(path, NODE).reason).to.equal("not-smooth");
  });

  it("reports not-smooth for an off-curve point", () => {
    expect(getJointContext(asymmetricPath(), 2).reason).to.equal("not-smooth");
  });

  it("reports not-curve-joint when one side is a line", () => {
    const path = makeContour([
      { x: 0, y: 0 },
      { x: 100, y: 100, smooth: true },
      cubic(150, 100),
      cubic(200, 50),
      { x: 200, y: 0 },
    ]);
    expect(getJointContext(path, 1).reason).to.equal("not-curve-joint");
  });

  it("reports not-curve-joint for quadratic neighbours", () => {
    const path = makeContour([
      { x: 0, y: 0 },
      { x: 0, y: 50, type: "quad" },
      { x: 50, y: 100, type: "quad" },
      { x: 100, y: 100, smooth: true },
      { x: 150, y: 100, type: "quad" },
      { x: 200, y: 50, type: "quad" },
      { x: 200, y: 0 },
    ]);
    expect(getJointContext(path, NODE).reason).to.equal("not-curve-joint");
  });

  it("wraps around a closed contour", () => {
    // rotate the symmetric fixture so the joint sits at index 0
    const path = makeContour([
      { x: 100, y: 100, smooth: true },
      cubic(150, 100),
      cubic(200, 50),
      { x: 200, y: 0 },
      { x: 0, y: 0 },
      cubic(0, 50),
      cubic(50, 100),
    ]);
    const ctx = getJointContext(path, 0);
    expect(ctx.P).to.deep.equal({ x: 50, y: 100 });
    expect(ctx.PP).to.deep.equal({ x: 0, y: 50 });
  });

  it("does not wrap around an open contour", () => {
    const path = makeContour(
      [
        cubic(50, 100),
        { x: 100, y: 100, smooth: true },
        cubic(150, 100),
        cubic(200, 50),
        { x: 200, y: 0 },
      ],
      false
    );
    expect(getJointContext(path, 1).reason).to.equal("not-curve-joint");
  });
});

// --- calculateHarmonicTarget ------------------------------------------------

describe("harmonization: calculateHarmonicTarget", () => {
  it("matches the Green Harmony reference implementation", () => {
    for (const path of [symmetricPath(), asymmetricPath(), clampPath()]) {
      const expected = donorHarmonize(path, NODE);
      const { target } = calculateHarmonicTarget(getJointContext(path, NODE));
      expect(target.x).to.be.closeTo(expected.x, 1e-9);
      expect(target.y).to.be.closeTo(expected.y, 1e-9);
    }
  });

  it("returns fixup as node minus target", () => {
    const ctx = getJointContext(asymmetricPath(), NODE);
    const { target, fixup } = calculateHarmonicTarget(ctx);
    expect(fixup.x).to.be.closeTo(ctx.node.x - target.x, 1e-9);
    expect(fixup.y).to.be.closeTo(ctx.node.y - target.y, 1e-9);
  });

  it("returns a zero fixup for an already harmonic joint", () => {
    const { fixup } = calculateHarmonicTarget(getJointContext(symmetricPath(), NODE));
    expect(Math.hypot(fixup.x, fixup.y)).to.be.closeTo(0, 1e-9);
  });

  it("returns null when the outer handle lines are parallel", () => {
    expect(calculateHarmonicTarget(getJointContext(parallelPath(), NODE))).to.equal(
      null
    );
  });

  it("returns null when an outer handle has zero length", () => {
    const path = asymmetricPath();
    path.setPointPosition(1, 50, 100); // PP onto P
    expect(calculateHarmonicTarget(getJointContext(path, NODE))).to.equal(null);
  });
});

// --- measureG2Discontinuity -------------------------------------------------

describe("harmonization: measureG2Discontinuity", () => {
  it("is zero at an already harmonic joint", () => {
    const d = measureG2Discontinuity(getJointContext(symmetricPath(), NODE));
    expect(d).to.be.closeTo(0, 1e-12);
  });

  it("is positive at a joint that needs correction", () => {
    const d = measureG2Discontinuity(getJointContext(asymmetricPath(), NODE));
    expect(d).to.be.greaterThan(1e-6);
  });

  it("drops to zero once the joint has been harmonized", () => {
    const { path } = harmonizePath(asymmetricPath(), [NODE], { handleBias: 0 });
    expect(measureG2Discontinuity(getJointContext(path, NODE))).to.be.closeTo(0, 1e-9);
  });
});

// --- one call is the whole answer -------------------------------------------
//
// Every joint on this contour shares a segment with the two next to it, so
// correcting any one of them moves the other two off. The sweep has to keep
// going until the whole ring is quiet. It used to finish a joint the first time
// that joint's own correction fell under the tolerance, or the first time a
// step ran into a limit, and never look at it again — so a neighbour's later
// move was left standing and running the command a second time kept helping.
function ringPath() {
  return makeContour([
    { x: 300, y: 0, smooth: true },
    cubic(300, 210),
    cubic(150, 260),
    { x: 0, y: 300, smooth: true },
    cubic(-190, 300),
    cubic(-300, 190),
    { x: -300, y: 0, smooth: true },
    cubic(-300, -120),
    cubic(-120, -300),
    { x: 0, y: -300, smooth: true },
    cubic(205, -300),
    cubic(300, -205),
  ]);
}

const RING_JOINTS = [0, 3, 6, 9];

describe("harmonization: a ring of coupled joints", () => {
  function worstDiscontinuity(path) {
    return Math.max(
      ...RING_JOINTS.map((index) =>
        measureG2Discontinuity(getJointContext(path, index))
      )
    );
  }

  it("settles the whole ring in one call", () => {
    const path = ringPath();
    expect(worstDiscontinuity(path)).to.be.greaterThan(1e-4);
    harmonizePathInPlace(path, RING_JOINTS, {});
    expect(worstDiscontinuity(path)).to.be.closeTo(0, 1e-6);
  });

  it("has nothing left for a second call to do", () => {
    const path = ringPath();
    harmonizePathInPlace(path, RING_JOINTS, {});
    const once = [...Array(path.numPoints).keys()].map((index) =>
      path.getPointPosition(index)
    );
    harmonizePathInPlace(path, RING_JOINTS, {});
    for (let index = 0; index < path.numPoints; index++) {
      const [x, y] = path.getPointPosition(index);
      expect(
        distance({ x, y }, { x: once[index][0], y: once[index][1] })
      ).to.be.lessThan(0.01);
    }
  });

  it("lands on the same whole units when it is run twice", () => {
    // The editor rounds to whole units, and rounding is a nudge the sweep never
    // saw, so from the rounded drawing there is a real correction to make
    // again. That is what the second press of the button used to do.
    const path = ringPath();
    harmonizePathInPlace(path, RING_JOINTS, { roundCoordinates: true });
    const once = Array.from(path.coordinates);
    harmonizePathInPlace(path, RING_JOINTS, { roundCoordinates: true });
    expect(Array.from(path.coordinates)).to.deep.equal(once);
  });

  it("takes the better whole-unit state when the exact answer is sub-grid", () => {
    // Every correction the sweep finds here is under half a unit, so rounding
    // each coordinate to its own nearest unit puts the drawing back exactly as
    // it was. A better whole-unit state exists all the same, and the command
    // has to reach it — this is the ring-sized form of the arch joint below.
    // a ring that is harmonic to start with, nudged by one unit
    const harmonic = VarPackedPath.fromUnpackedContours([
      {
        points: [
          { x: 300, y: 0, smooth: true },
          cubic(300, 165),
          cubic(165, 300),
          { x: 0, y: 300, smooth: true },
          cubic(-165, 300),
          cubic(-300, 165),
          { x: -300, y: 0, smooth: true },
          cubic(-300, -165),
          cubic(-165, -300),
          { x: 0, y: -300, smooth: true },
          cubic(165, -300),
          cubic(300, -165),
        ],
        isClosed: true,
      },
    ]);
    harmonic.setPointPosition(1, 300, 166);
    const residual = () =>
      RING_JOINTS.reduce(
        (sum, index) => sum + measureG2Discontinuity(getJointContext(harmonic, index)),
        0
      );
    const before = residual();
    const report = harmonizePathInPlace(harmonic, RING_JOINTS, {
      roundCoordinates: true,
    });
    expect(report.length).to.equal(RING_JOINTS.length);
    expect(residual()).to.be.lessThan(before);
  });

  it("writes nothing at all when the drawing is already harmonic", () => {
    // In the editor every write is a recorded change, so a command that has
    // nothing to improve must not take an undo step. This is the guarantee the
    // grid search must not cost: it may only move a point onto a whole-unit
    // position that scores better than the one the point is already on.
    const path = ringPath();
    const before = Array.from(path.coordinates);
    harmonizePathInPlace(path, RING_JOINTS, { roundCoordinates: true });
    harmonizePathInPlace(path, RING_JOINTS, { roundCoordinates: true });
    const settled = Array.from(path.coordinates);

    harmonizePathInPlace(path, RING_JOINTS, { roundCoordinates: true });
    expect(Array.from(path.coordinates)).to.deep.equal(settled);
    expect(before.length).to.equal(settled.length);
  });

  it("reports every joint harmonized, not partial", () => {
    const report = harmonizePathInPlace(ringPath(), RING_JOINTS, {});
    expect(report.map((entry) => entry.status)).to.deep.equal(
      RING_JOINTS.map(() => "harmonized")
    );
  });
});

// --- expandToJoints ---------------------------------------------------------

describe("harmonization: expandToJoints", () => {
  it("maps an incoming handle to its parent on-curve point", () => {
    expect(expandToJoints(asymmetricPath(), [2])).to.deep.equal([NODE]);
  });

  it("maps an outgoing handle to its parent on-curve point", () => {
    expect(expandToJoints(asymmetricPath(), [4])).to.deep.equal([NODE]);
  });

  it("keeps on-curve points as they are", () => {
    expect(expandToJoints(asymmetricPath(), [0, 3])).to.deep.equal([0, NODE]);
  });

  it("deduplicates and sorts", () => {
    expect(expandToJoints(asymmetricPath(), [4, 2, 3])).to.deep.equal([NODE]);
  });

  it("returns every on-curve point for an empty selection", () => {
    expect(expandToJoints(asymmetricPath(), [])).to.deep.equal([0, 3, 6]);
    expect(expandToJoints(asymmetricPath(), undefined)).to.deep.equal([0, 3, 6]);
  });
});

// --- harmonizePath ----------------------------------------------------------

describe("harmonization: harmonizePath", () => {
  it("moves only the node at handleBias 0, in a single pass", () => {
    const path = asymmetricPath();
    const expected = donorHarmonize(path, NODE);
    const result = harmonizePath(path, [NODE], { handleBias: 0 });

    expect(result.report).to.have.lengthOf(1);
    expect(result.report[0].status).to.equal("harmonized");
    expect(result.report[0].iterations).to.equal(1);
    expect(nodePos(result.path).x).to.be.closeTo(expected.x, 1e-9);
    expect(nodePos(result.path).y).to.be.closeTo(expected.y, 1e-9);
    // handles untouched
    expect(result.path.getPointPosition(2)).to.deep.equal([50, 100]);
    expect(result.path.getPointPosition(4)).to.deep.equal([150, 100]);
  });

  it("moves only the handles at handleBias 1, leaving the node bit-identical", () => {
    const result = harmonizePath(asymmetricPath(), [NODE], { handleBias: 1 });

    expect(result.report[0].status).to.equal("harmonized");
    expect(result.path.getPointPosition(NODE)).to.deep.equal([110, 100]);
    expect(result.path.getPointPosition(2)).to.not.deep.equal([50, 100]);
    expect(result.path.getPointPosition(4)).to.not.deep.equal([150, 100]);
    expect(measureG2Discontinuity(getJointContext(result.path, NODE))).to.be.closeTo(
      0,
      1e-6
    );
  });

  it("converges at an intermediate bias too", () => {
    const result = harmonizePath(asymmetricPath(), [NODE], { handleBias: 0.5 });
    expect(result.report[0].status).to.equal("harmonized");
    expect(measureG2Discontinuity(getJointContext(result.path, NODE))).to.be.closeTo(
      0,
      1e-6
    );
    // both node and handles moved
    expect(result.path.getPointPosition(NODE)).to.not.deep.equal([110, 100]);
    expect(result.path.getPointPosition(2)).to.not.deep.equal([50, 100]);
  });

  it("leaves an already harmonic joint alone", () => {
    const path = symmetricPath();
    const before = path.coordinates.slice();
    const result = harmonizePath(path, [NODE], { handleBias: 1 });

    expect(result.report[0].status).to.equal("skipped");
    expect(result.report[0].reason).to.equal("already-harmonic");
    expect(Array.from(result.path.coordinates)).to.deep.equal(Array.from(before));
  });

  it("does not mutate the input path", () => {
    const path = asymmetricPath();
    const before = Array.from(path.coordinates);
    harmonizePath(path, [NODE], { handleBias: 1 });
    expect(Array.from(path.coordinates)).to.deep.equal(before);
  });

  // The floor is a fraction of the chord between the segment's two on-curve
  // points, and half a chord is about the handle length of a well-formed arc.
  // Taking it from the handle instead made it a different number every time the
  // command ran, because the handle it was measured from had just been cut.
  const CLAMP_FLOOR =
    ((1 - HARMONIZE_DEFAULTS.cuspSafetyMargin) / 2) *
    distance({ x: 110, y: 100 }, { x: 200, y: 0 }); // outgoing chord

  it("clamps instead of collapsing a handle, and reports partial", () => {
    const result = harmonizePath(clampPath(), [NODE], { handleBias: 1 });

    expect(result.report[0].status).to.equal("partial");
    expect(result.report[0].reason).to.equal("clamped");

    const ctx = getJointContext(result.path, NODE);
    const remaining = distance(ctx.node, ctx.N);
    expect(remaining).to.be.closeTo(CLAMP_FLOOR, 1e-6);
    expect(remaining).to.be.greaterThan(0);
  });

  it("clamps at handleBias 0 as well - the node slides toward the handle", () => {
    const result = harmonizePath(clampPath(), [NODE], { handleBias: 0 });
    expect(result.report[0].status).to.equal("partial");
    const ctx = getJointContext(result.path, NODE);
    expect(distance(ctx.node, ctx.N)).to.be.closeTo(CLAMP_FLOOR, 1e-6);
  });

  it("stops in the same place when it is run twice", () => {
    // The floor does not move when the handle it limits is cut, so a second
    // call has nothing left to take. Measured from the handle, each call
    // allowed another cut of the same fraction and ten calls left nothing.
    const path = clampPath();
    const handleLength = () => {
      const ctx = getJointContext(path, NODE);
      return distance(ctx.node, ctx.N);
    };
    harmonizePathInPlace(path, [NODE], {});
    const afterOne = handleLength();
    harmonizePathInPlace(path, [NODE], {});
    expect(handleLength()).to.be.closeTo(afterOne, 1e-9);
  });

  it("reports degenerate for parallel outer handle lines", () => {
    const path = parallelPath();
    const before = Array.from(path.coordinates);
    const result = harmonizePath(path, [NODE], { handleBias: 1 });

    expect(result.report[0].status).to.equal("skipped");
    expect(result.report[0].reason).to.equal("degenerate");
    expect(Array.from(result.path.coordinates)).to.deep.equal(before);
  });

  it("reports non-joint points instead of dropping them silently", () => {
    const result = harmonizePath(asymmetricPath(), [0, 3, 6], { handleBias: 1 });
    expect(result.report.map((entry) => entry.pointIndex)).to.deep.equal([0, 3, 6]);
    expect(result.report[0]).to.include({ status: "skipped", reason: "not-smooth" });
    expect(result.report[1].status).to.equal("harmonized");
    expect(result.report[2]).to.include({ status: "skipped", reason: "not-smooth" });
  });

  it("harmonizes the whole path when no selection is given", () => {
    const result = harmonizePath(asymmetricPath(), undefined, { handleBias: 1 });
    expect(result.report).to.have.lengthOf(3);
    expect(result.report.filter((e) => e.status === "harmonized")).to.have.lengthOf(1);
  });

  it("preserves point count, contour count and point types", () => {
    const path = asymmetricPath();
    const result = harmonizePath(path, undefined, { handleBias: 0.5 });
    expect(result.path.numPoints).to.equal(path.numPoints);
    expect(result.path.numContours).to.equal(path.numContours);
    expect(Array.from(result.path.pointTypes)).to.deep.equal(
      Array.from(path.pointTypes)
    );
  });

  it("is idempotent", () => {
    const first = harmonizePath(asymmetricPath(), [NODE], { handleBias: 1 });
    const second = harmonizePath(first.path, [NODE], { handleBias: 1 });
    expect(second.report[0].status).to.equal("skipped");
    expect(second.report[0].reason).to.equal("already-harmonic");
    expect(Array.from(second.path.coordinates)).to.deep.equal(
      Array.from(first.path.coordinates)
    );
  });

  it("solves an isolated joint in a single pass at any bias", () => {
    // the harmonic ratio depends only on how far the outer handles sit off the
    // tangent line, which no bias disturbs -- so one correction is exact
    for (const handleBias of [0, 0.25, 0.5, 1]) {
      const result = harmonizePath(asymmetricPath(), [NODE], {
        handleBias,
        toleranceUnits: 1e-9,
      });
      expect(result.report[0].status, `bias ${handleBias}`).to.equal("harmonized");
      expect(result.report[0].iterations, `bias ${handleBias}`).to.equal(1);
    }
  });

  it("iterates until coupled joints agree", () => {
    const result = harmonizePath(coupledPath(), [3, 6], { handleBias: 1 });

    expect(result.report.map((e) => e.status)).to.deep.equal([
      "harmonized",
      "harmonized",
    ]);
    // harmonizing one joint moves the other's outer handle, so neither settles
    // on the first pass
    expect(result.report[0].iterations).to.be.greaterThan(1);
    expect(result.report[1].iterations).to.be.greaterThan(1);
    for (const pointIndex of [3, 6]) {
      expect(
        measureG2Discontinuity(getJointContext(result.path, pointIndex))
      ).to.be.closeTo(0, 1e-4);
    }
  });

  it("records a change the editor can round-trip", () => {
    // The editor harmonizes inside recordChanges, so the path it hands us is a
    // Proxy. Writing a whole new path object into layerGlyph.path puts a live
    // VarPackedPath in the change payload, which does not survive; per-point
    // writes must come out as `=xy` operations instead.
    const layerGlyph = { path: asymmetricPath() };
    const changes = recordChanges(layerGlyph, (proxy) =>
      harmonizePathInPlace(proxy.path, [NODE], { handleBias: 1 })
    );

    const ops = changes.change.c.map((c) => c.f);
    expect(ops).to.deep.equal(["=xy", "=xy"]); // the two handles, nothing else
    expect(layerGlyph.path.coordinates).to.be.an.instanceOf(VarArray);

    // replaying the change onto the untouched original reproduces it exactly
    const replayed = { path: asymmetricPath() };
    applyChange(replayed, changes.change);
    expect(Array.from(replayed.path.coordinates)).to.deep.equal(
      Array.from(layerGlyph.path.coordinates)
    );

    // and rolling back returns to the original
    applyChange(layerGlyph, changes.rollbackChange);
    expect(Array.from(layerGlyph.path.coordinates)).to.deep.equal(
      Array.from(asymmetricPath().coordinates)
    );
  });

  it("records nothing when there is nothing to harmonize", () => {
    const layerGlyph = { path: symmetricPath() };
    const changes = recordChanges(layerGlyph, (proxy) =>
      harmonizePathInPlace(proxy.path, [NODE], { handleBias: 1 })
    );
    expect(changes.hasChange).to.equal(false);
  });

  it("never drives a handle past its Tunni point", () => {
    // unlimited, this joint sends the incoming handle to tension 2.6: it
    // overshoots the Tunni point, the segment's two handle lines cross, and the
    // curve doubles back on itself
    const unlimited = harmonizePath(overshootPath(), [NODE], {
      handleBias: 1,
      maxHandleTension: Infinity,
    });
    expect(Math.max(...jointHandleTensions(unlimited.path))).to.be.greaterThan(2);

    const limited = harmonizePath(overshootPath(), [NODE], { handleBias: 1 });
    expect(Math.max(...jointHandleTensions(limited.path))).to.be.closeTo(1, 1e-6);
    expect(limited.report[0]).to.include({
      status: "partial",
      reason: "tension-limited",
    });
  });

  it("limits tension at any bias", () => {
    for (const handleBias of [0, 0.5, 1]) {
      const result = harmonizePath(overshootPath(), [NODE], { handleBias });
      expect(
        Math.max(...jointHandleTensions(result.path)),
        `bias ${handleBias}`
      ).to.be.at.most(1 + 1e-6);
    }
  });

  it("brings a handle that is already over the limit back under it", () => {
    // over-tension is a defect, not a style to preserve: harmonize corrects it
    // rather than working around it
    const path = overshootPath();
    // the incoming segment's Tunni point sits at x=10 on the tangent, so an
    // incoming handle at x=5 already reaches past it
    path.setPointPosition(2, 5, 100);
    expect(Math.max(...jointHandleTensions(path))).to.be.greaterThan(1);

    const result = harmonizePath(path, [NODE], { handleBias: 1 });
    expect(Math.max(...jointHandleTensions(result.path))).to.be.at.most(1 + 1e-6);
    expect(result.report[0].tensionReduced).to.equal(true);
    expect(result.report[0].status).to.not.equal("skipped");
  });

  it("leaves tensionReduced false when nothing was over the limit", () => {
    const result = harmonizePath(asymmetricPath(), [NODE], { handleBias: 1 });
    expect(result.report[0].tensionReduced).to.equal(false);
  });

  it("holds the tension ceiling even with equalization on", () => {
    // balance averages a segment's two tensions, and that average can land
    // above the ceiling on its own
    const result = harmonizePath(overshootPath(), [NODE], {
      handleBias: 1,
      equalizeTension: true,
    });
    expect(Math.max(...jointHandleTensions(result.path))).to.be.at.most(1 + 1e-6);
  });

  it("rounds every point it moved, and nothing else", () => {
    const before = asymmetricPath();
    const result = harmonizePath(before, [NODE], {
      handleBias: 1,
      roundCoordinates: true,
    });

    for (const index of [2, 4]) {
      const [x, y] = result.path.getPointPosition(index);
      expect(Number.isInteger(x), `point ${index} x`).to.equal(true);
      expect(Number.isInteger(y), `point ${index} y`).to.equal(true);
    }
    // untouched points keep their exact original coordinates
    for (const index of [0, 1, 3, 5, 6]) {
      expect(result.path.getPointPosition(index)).to.deep.equal(
        before.getPointPosition(index)
      );
    }
  });

  it("rounds the point, not the handles, at handleBias 0", () => {
    const result = harmonizePath(asymmetricPath(), [NODE], {
      handleBias: 0,
      roundCoordinates: true,
    });
    const [x, y] = result.path.getPointPosition(NODE);
    expect(Number.isInteger(x)).to.equal(true);
    expect(Number.isInteger(y)).to.equal(true);
    expect(result.path.getPointPosition(2)).to.deep.equal([50, 100]);
  });

  it("keeps full precision when rounding is off", () => {
    const result = harmonizePath(asymmetricPath(), [NODE], { handleBias: 1 });
    const [x] = result.path.getPointPosition(2);
    expect(Number.isInteger(x)).to.equal(false);
  });

  it("does not land mid-range on a junk bias", () => {
    // a bias of 0.2 moves the point AND the handles; that must never be what a
    // string, an out-of-range number or a NaN quietly turns into
    for (const handleBias of ["1", 1.4, undefined, NaN, null]) {
      const result = harmonizePath(asymmetricPath(), [NODE], { handleBias });
      expect(result.path.getPointPosition(NODE), `bias ${handleBias}`).to.deep.equal([
        110, 100,
      ]);
    }
  });

  it("never moves the outer handles without tension equalization", () => {
    // PP and NN are inputs to the curvature at the joint, not outputs: the G2
    // construction reads them and leaves them alone. Both donors agree
    // (SuperTool+Harmonize.m:55-56 moves prevNode and nextNode only).
    for (const handleBias of [0, 0.5, 1]) {
      const path = asymmetricPath();
      const result = harmonizePath(path, [NODE], { handleBias });
      expect(result.path.getPointPosition(1), `bias ${handleBias}`).to.deep.equal([
        0, 20,
      ]);
      expect(result.path.getPointPosition(5), `bias ${handleBias}`).to.deep.equal([
        200, 50,
      ]);
    }
  });

  it("moves the outer handles when tension equalization is on", () => {
    const result = harmonizePath(asymmetricPath(), [NODE], {
      handleBias: 1,
      equalizeTension: true,
    });
    expect(result.path.getPointPosition(1)).to.not.deep.equal([0, 20]);
    expect(result.path.getPointPosition(5)).to.not.deep.equal([200, 50]);
  });

  it("tension equalization costs exactness at the joint", () => {
    // the donor's trailing balance changes handle lengths after the fact, which
    // perturbs the curvature match harmonization just established
    const exact = harmonizePath(asymmetricPath(), [NODE], { handleBias: 1 });
    const equalized = harmonizePath(asymmetricPath(), [NODE], {
      handleBias: 1,
      equalizeTension: true,
    });
    const exactError = measureG2Discontinuity(getJointContext(exact.path, NODE));
    const equalizedError = measureG2Discontinuity(
      getJointContext(equalized.path, NODE)
    );
    expect(exactError).to.be.lessThan(1e-9);
    expect(equalizedError).to.be.greaterThan(exactError);
  });

  it("reports not-converged when the iteration budget runs out", () => {
    const result = harmonizePath(coupledPath(), [3, 6], {
      handleBias: 1,
      maxIterations: 1,
    });
    expect(result.report.map((e) => e.status)).to.deep.equal(["partial", "partial"]);
    expect(result.report.map((e) => e.reason)).to.deep.equal([
      "not-converged",
      "not-converged",
    ]);
  });
});

// --- G3: matching the rate of change of curvature ---------------------------
//
// The joint reported on `_external/skeletron.fontra` glyph `d`. Curvature
// matches across it to 1.6% and its rate reverses sign, so the comb dips to a
// local minimum exactly at the joint.
function reportedG3Path() {
  return makeContour([
    { x: 285, y: 460 },
    cubic(363, 460),
    cubic(412, 518),
    { x: 399, y: 598, smooth: true },
    cubic(388, 670),
    cubic(334, 710),
    { x: 250, y: 710 },
  ]);
}

// the same joint before it was redrawn: the two outer handles sit on opposite
// sides of the tangent, so the two curvatures disagree in sign
function inflectedPath() {
  return makeContour([
    { x: 361, y: 84 },
    cubic(361, 235),
    cubic(335, 278),
    { x: 217, y: 278, smooth: true },
    cubic(149, 278),
    cubic(84, 500),
    { x: 230, y: 541 },
  ]);
}

function jointSegmentPoints(path) {
  const points = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const [x, y] = path.getPointPosition(i);
    return { x, y };
  });
  return { incoming: points.slice(0, 4), outgoing: points.slice(3) };
}

describe("harmonization: calculateG3Targets", () => {
  it("matches curvature and its rate on both sides of the joint", () => {
    const path = reportedG3Path();
    const { incoming, outgoing } = jointSegmentPoints(path);
    const targets = calculateG3Targets(incoming, outgoing);
    expect(targets).to.not.equal(null);

    const solvedIn = [incoming[0], incoming[1], targets.P, incoming[3]];
    const solvedOut = [outgoing[0], targets.N, outgoing[2], outgoing[3]];
    expect(measureG2Discontinuity(getJointContext(path, NODE))).to.be.greaterThan(1e-5);
    expect(curvatureDiscontinuity(solvedIn, solvedOut)).to.be.lessThan(1e-9);
    expect(curvatureRateDiscontinuity(solvedIn, solvedOut)).to.be.lessThan(1e-9);
  });

  it("moves the two inner handles and nothing else", () => {
    const { incoming, outgoing } = jointSegmentPoints(reportedG3Path());
    const targets = calculateG3Targets(incoming, outgoing);
    expect(distance(targets.P, incoming[2])).to.be.greaterThan(1);
    expect(distance(targets.N, outgoing[1])).to.be.greaterThan(1);
  });

  it("puts both inner handles on one line through the joint", () => {
    const { incoming, outgoing } = jointSegmentPoints(reportedG3Path());
    const { P, N } = calculateG3Targets(incoming, outgoing);
    const node = incoming[3];
    const cross = (P.x - node.x) * (N.y - node.y) - (P.y - node.y) * (N.x - node.x);
    expect(Math.abs(cross)).to.be.lessThan(1e-9);
  });

  it("keeps a symmetric joint symmetric", () => {
    const { incoming, outgoing } = jointSegmentPoints(symmetricPath());
    const { P, N } = calculateG3Targets(incoming, outgoing);
    const node = incoming[3];
    expect(distance(P, node)).to.be.closeTo(distance(N, node), 1e-9);
  });

  it("returns null when the two curvatures disagree in sign", () => {
    const { incoming, outgoing } = jointSegmentPoints(inflectedPath());
    expect(calculateG3Targets(incoming, outgoing)).to.equal(null);
  });
});

describe("harmonization: the G3 cascade", () => {
  const G3 = { continuity: "G3" };

  function jointMeasures(path) {
    const { incoming, outgoing } = jointSegmentPoints(path);
    return {
      curvature: curvatureDiscontinuity(incoming, outgoing),
      rate: curvatureRateDiscontinuity(incoming, outgoing),
    };
  }

  it("matches curvature and its rate, and leaves the joint where it is", () => {
    const path = reportedG3Path();
    const before = jointMeasures(path);
    const report = harmonizePathInPlace(path, [NODE], G3);
    const after = jointMeasures(path);

    expect(report[0].status).to.equal("harmonized");
    expect(report[0].construction).to.equal("g3");
    expect(after.curvature).to.be.lessThan(1e-9);
    expect(after.rate).to.be.lessThan(1e-9);
    expect(before.rate).to.be.greaterThan(after.rate);
    expect(nodePos(path)).to.deep.equal({ x: 399, y: 598 });
  });

  it("falls back to G2 at an inflection, and says so", () => {
    const path = inflectedPath();
    const report = harmonizePathInPlace(path, [NODE], G3);
    expect(report[0].status).to.equal("harmonized");
    expect(report[0].construction).to.equal("g2");
  });

  it("falls back to G2 where the answer would cross its own handle lines", () => {
    const path = overshootPath();
    const report = harmonizePathInPlace(path, [NODE], G3);
    expect(report[0].construction).to.equal("g2");
    expect(report[0].status).to.be.oneOf(["harmonized", "partial"]);
  });

  it("reaches that joint by sliding the on-curve when the slide is allowed", () => {
    const path = overshootPath();
    const report = harmonizePathInPlace(path, [NODE], {
      ...G3,
      slideOnCurve: true,
    });
    const after = jointMeasures(path);
    expect(report[0].construction).to.equal("g3");
    expect(after.curvature).to.be.lessThan(1e-9);
    expect(after.rate).to.be.lessThan(1e-9);
    expect(nodePos(path)).to.not.deep.equal({ x: 60, y: 100 });
  });

  it("does not slide a joint that did not need it", () => {
    const path = reportedG3Path();
    harmonizePathInPlace(path, [NODE], { ...G3, slideOnCurve: true });
    expect(nodePos(path)).to.deep.equal({ x: 399, y: 598 });
  });

  it("leaves the two outer handles alone", () => {
    const path = reportedG3Path();
    const before = [1, 5].map((i) => path.getPointPosition(i));
    harmonizePathInPlace(path, [NODE], { ...G3, slideOnCurve: true });
    expect([1, 5].map((i) => path.getPointPosition(i))).to.deep.equal(before);
  });

  it("is off by default", () => {
    const path = reportedG3Path();
    const report = harmonizePathInPlace(path, [NODE], {});
    expect(report[0].construction).to.equal("g2");
  });
});

//
// The reported joint from `_external/skeletron.fontra/glyphs/n.json`, node 13:
// the outer arch meeting the right stem. Its two sides disagree by 3.16% of
// curvature, which a designer sees as a step in the curvature comb — and the
// exact G2 answer is a move of 0.344 units, because curvature goes as 1/L² and
// the two handles are only 51 and 38 units long.
//
// Whole-unit rounding to the NEAREST position discards all of it, so the
// command wrote nothing and reported success. A whole-unit answer does exist:
// one unit off the nearest one, and seven times better than the drawing.
//
function reportedArchJoint() {
  return makeContour([
    { x: 298, y: 420 },
    cubic(298, 476),
    cubic(282, 510),
    { x: 231, y: 510, smooth: true },
    cubic(192.9276123046875, 510),
    cubic(159.3152618408203, 490.4445495605469),
    { x: 138, y: 455.15167236328125 },
  ]);
}

describe("harmonization: a sub-grid correction on the grid", () => {
  it("improves the reported arch joint while keeping whole-unit coordinates", () => {
    const path = reportedArchJoint();
    const before = measureG2Discontinuity(getJointContext(path, 3));

    harmonizePathInPlace(path, [3], { roundCoordinates: true });

    const after = measureG2Discontinuity(getJointContext(path, 3));
    expect(after).to.be.lessThan(before / 2);

    // P, the joint and N are the only points a G2 correction can move, and
    // whatever it wrote has to be on the grid.
    for (const index of [2, 3, 4]) {
      const [x, y] = path.getPointPosition(index);
      expect(x).to.equal(Math.round(x));
      expect(y).to.equal(Math.round(y));
    }
  });
});

describe("harmonization: an honest report", () => {
  it("reports a correction the grid discarded instead of claiming success", () => {
    // Moving only the joint, the arch's correction is 0.344 units along the
    // tangent, and the whole-unit position it is already on is the best one
    // available. Nothing is written, so nothing may be reported as harmonized:
    // "1 harmonized" on an unchanged drawing is what sent this whole
    // investigation down the wrong path.
    const path = reportedArchJoint();
    const before = Array.from(path.coordinates);

    const report = harmonizePathInPlace(path, [3], {
      handleBias: 0,
      roundCoordinates: true,
    });

    expect(Array.from(path.coordinates)).to.deep.equal(before);
    expect(report[0].status).to.not.equal("harmonized");
    expect(report[0].reason).to.equal("below-grid");
  });
});
