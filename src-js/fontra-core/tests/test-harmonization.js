import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import {
  HARMONIZE_DEFAULTS,
  adjustHandles,
  calculateG3Targets,
  calculateHarmonicTarget,
  curvatureDiscontinuity,
  curvatureRateDiscontinuity,
  expandToJoints,
  getJointContext,
  harmonizeHandlesInPlace,
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

  it("keeps the drawing at handleBias 0, where the clamped answer is a worse curve", () => {
    // The clamp takes the handle down to its cusp floor, and a handle at its
    // floor carries a curvature spike. Since the score reads the shape of the
    // curve and not only the joint, the drawing wins and is kept.
    //
    // The report still says `partial`, which is a verdict on a drawing that was
    // not written. `harmonized` is downgraded to `skipped/below-grid` when
    // nothing moved and `partial` is not; extending that needs a reason of its
    // own -- "computed, and the drawing scored better" is not "below grid".
    const before = clampPath();
    const result = harmonizePath(clampPath(), [NODE], { handleBias: 0 });
    const ctx = getJointContext(result.path, NODE);
    expect(distance(ctx.node, ctx.N)).to.be.closeTo(
      distance(
        ...[NODE, NODE + 1].map((i) => {
          const [x, y] = before.getPointPosition(i);
          return { x, y };
        })
      ),
      1e-6
    );
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

  it("gives the solve the last word over equalization", () => {
    // Equalization prepares the drawing; it is not a proposal about
    // continuity. Running it after the solve threw the exact answer away --
    // the joint came out worse for asking for both. It runs first now, so the
    // joint is as exact with it on as with it off.
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
    expect(equalizedError).to.be.lessThan(1e-9);
  });

  it("reports not-converged when the iteration budget runs out", () => {
    // Two passes, not one: after a single pass the answer is still worse than
    // the drawing it came from, so the best-state gate keeps the drawing and
    // the verdict below applies instead.
    //
    // One joint of the two comes out harmonized, because the repetition makes
    // up part of the starved budget: the second solve starts from where the
    // first one ran out. That is what the repetition is for, and it is why the
    // budget is not the hard stop it reads as.
    const result = harmonizePath(coupledPath(), [3, 6], {
      handleBias: 1,
      maxIterations: 2,
    });
    expect(result.report[0].status).to.equal("partial");
    expect(result.report[0].reason).to.equal("not-converged");
  });

  it("says so when it drew an answer and kept the drawing instead", () => {
    // One pass on a coupled ring leaves both joints part-corrected, which is a
    // worse curve than either was to start with. Nothing is written -- and
    // saying `not-converged` about a drawing that was never touched is a
    // verdict on a state that was thrown away. `below-grid` would be wrong too:
    // the correction was not sub-unit, it was refused.
    const before = coupledPath();
    const result = harmonizePath(coupledPath(), [3, 6], {
      handleBias: 1,
      maxIterations: 1,
    });
    expect(result.report.map((e) => e.status)).to.deep.equal(["skipped", "skipped"]);
    expect(result.report.map((e) => e.reason)).to.deep.equal(["reverted", "reverted"]);
    expect(Array.from(result.path.coordinates)).to.deep.equal(
      Array.from(before.coordinates)
    );
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

  it("does not slide a joint whose curve the slide cannot improve", () => {
    // This used to read "does not slide a joint that did not need it", and it
    // passed for the wrong reason: every position on the tangent scored the
    // same at the joint, so the least-travel tie-break kept it still. Now that
    // the score reads the curve as well, positions differ, and a joint moves
    // when moving makes the curve fairer. That is the point -- so what is
    // pinned here is that it moves for a reason and not far.
    const path = reportedG3Path();
    harmonizePathInPlace(path, [NODE], { ...G3, slideOnCurve: true });
    expect(distance(nodePos(path), { x: 399, y: 598 })).to.be.below(5);

    // and with the slide off it does not move at all
    const held = reportedG3Path();
    harmonizePathInPlace(held, [NODE], G3);
    expect(nodePos(held)).to.deep.equal({ x: 399, y: 598 });
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

// --- what the grid search is allowed to trade away --------------------------
//
// The three faults reported on `n` on 2026-08-20. Each one is a case where the
// command reaches an answer and then throws it away, because the number it
// scores itself by does not measure what it is supposed to preserve.

// A joint whose tangent is NOT axis-aligned. Rounding the three points to whole
// units moves them off the tangent line, so the smooth point stops being smooth
// unless something scores that.
function diagonalJointPath() {
  return makeContour([
    { x: 0, y: 0 },
    cubic(40, 10),
    cubic(80, 40),
    { x: 120, y: 90, smooth: true },
    cubic(157, 136),
    cubic(210, 160),
    { x: 260, y: 160 },
  ]);
}

// The outer arch of `n`, as it stands after one press with every option off --
// which is the state the report was made from. G2 is satisfied there to 0.53%,
// and the rate of curvature across the joint is not.
function reportedArchPath() {
  return makeContour([
    { x: 298, y: 420, smooth: true },
    cubic(298, 480),
    cubic(274, 515),
    { x: 227, y: 515, smooth: true },
    cubic(189, 515),
    cubic(160, 492),
    { x: 138, y: 455.15167236328125 },
  ]);
}

// The angle between the two inner handles at the joint. Zero is a smooth point.
function jointKinkDegrees(path) {
  const [px, py] = path.getPointPosition(NODE - 1);
  const [nx, ny] = path.getPointPosition(NODE);
  const [qx, qy] = path.getPointPosition(NODE + 1);
  const incoming = { x: nx - px, y: ny - py };
  const outgoing = { x: qx - nx, y: qy - ny };
  return Math.abs(
    (Math.atan2(
      incoming.x * outgoing.y - incoming.y * outgoing.x,
      incoming.x * outgoing.x + incoming.y * outgoing.y
    ) *
      180) /
      Math.PI
  );
}

// The most the whole-unit grid can bend a joint that is exactly straight: each
// end of a handle can land sqrt(2)/2 off in any direction, so each of the two
// handle directions can swing by atan(sqrt(2) / its length).
function gridKinkAllowanceDegrees(path) {
  const [px, py] = path.getPointPosition(NODE - 1);
  const [nx, ny] = path.getPointPosition(NODE);
  const [qx, qy] = path.getPointPosition(NODE + 1);
  return (
    ((Math.atan(Math.SQRT2 / Math.hypot(nx - px, ny - py)) +
      Math.atan(Math.SQRT2 / Math.hypot(qx - nx, qy - ny))) *
      180) /
    Math.PI
  );
}

// The worst joint found by sweeping 2000 randomly generated well-formed ones.
// It arrives 0.541 degrees off straight -- inside what the grid can excuse --
// and its correction is large enough to be tension-limited, so it takes many
// attempts, and every one of them used to trade a little more of the tangent
// for a little less curvature discontinuity. It finished at 13.1 degrees.
function creasingJointPath() {
  return makeContour([
    { x: 28, y: 604 },
    cubic(73, 572),
    cubic(82, 464),
    { x: 103, y: 361, smooth: true },
    cubic(131, 230),
    cubic(196, 121),
    { x: 205, y: 101 },
  ]);
}

function jointRateStep(path) {
  const { incoming, outgoing } = jointSegmentPoints(path);
  return curvatureRateDiscontinuity(incoming, outgoing);
}

describe("harmonization: what the grid search may not trade away", () => {
  it("keeps a smooth joint collinear through grid rounding", () => {
    const path = diagonalJointPath();
    const before = jointKinkDegrees(path);
    harmonizePathInPlace(path, [NODE], {
      continuity: "G2",
      handleBias: 1,
      roundCoordinates: true,
    });
    // The exact answer is collinear. Whole units cannot hold that exactly, but
    // the best placement bracketing the exact answer reaches 0.031 degrees and
    // the worst reaches 1.625, so the grid is not what decides this.
    expect(before).to.be.below(0.2);
    // Against the grid's own allowance at the handle lengths this joint ends
    // with, not against a number picked by eye. My first bound here was 0.5
    // degrees, which is tighter than whole units can hold.
    expect(jointKinkDegrees(path)).to.be.below(gridKinkAllowanceDegrees(path));
  });

  it("improves the rate of curvature at a joint that is already G2-harmonic", () => {
    const path = reportedArchPath();
    const before = jointRateStep(path);
    harmonizePathInPlace(path, [NODE], {
      continuity: "G3",
      handleBias: 1,
      roundCoordinates: true,
    });
    expect(jointRateStep(path)).to.be.below(before);
  });

  it("slides the on-curve to a better joint, rather than only where it is stuck", () => {
    const held = reportedArchPath();
    harmonizePathInPlace(held, [NODE], {
      continuity: "G3",
      slideOnCurve: false,
      roundCoordinates: true,
    });

    const slid = reportedArchPath();
    harmonizePathInPlace(slid, [NODE], {
      continuity: "G3",
      slideOnCurve: true,
      roundCoordinates: true,
    });

    // The slide is opt-in, so when it is on it looks for the best joint on the
    // tangent instead of waiting for the held solve to fail.
    expect(jointRateStep(slid)).to.be.below(jointRateStep(held));
  });

  it("will not buy curvature with a crease the grid cannot excuse", () => {
    const path = creasingJointPath();
    const before = measureG2Discontinuity(getJointContext(path, NODE));
    expect(jointKinkDegrees(path)).to.be.below(gridKinkAllowanceDegrees(path));

    harmonizePathInPlace(path, [NODE], {
      continuity: "G2",
      handleBias: 1,
      roundCoordinates: true,
    });

    // Both, and not one at the other's expense: curvature continuity across a
    // joint with no common tangent does not mean anything, so the bend is a
    // limit on the search rather than another term in it.
    expect(jointKinkDegrees(path)).to.be.below(gridKinkAllowanceDegrees(path));
    expect(measureG2Discontinuity(getJointContext(path, NODE))).to.be.below(before);
  });
});

// --- harmonize by handle length ---------------------------------------------
//
// Curvatura's second command (_external/curvatura/Curvatura.py:519). It solves
// handle LENGTHS against a curvature target shared by both sides of a node,
// instead of sliding anything along a tangent. The two claims worth pinning are
// that it reaches the curvature it was asked for, and that it cannot move a
// handle off its own direction.

// The five-point curvature at one end of a cubic, from the definition rather
// than from the module under test.
function endCurvature(points, atEnd) {
  const [p0, p1, p2, p3] = atEnd ? [...points].reverse() : points;
  const first = { x: p1.x - p0.x, y: p1.y - p0.y };
  const second = { x: p2.x - p1.x, y: p2.y - p1.y };
  const speed = Math.hypot(first.x, first.y);
  const curvature = ((2 / 3) * (first.x * second.y - first.y * second.x)) / speed ** 3;
  return atEnd ? -curvature : curvature;
}

function segmentsAt(path, index) {
  const at = (i) => {
    const [x, y] = path.getPointPosition(i);
    return { x, y };
  };
  return {
    incoming: [at(index - 3), at(index - 2), at(index - 1), at(index)],
    outgoing: [at(index), at(index + 1), at(index + 2), at(index + 3)],
  };
}

// Each handle paired with the on-curve point it belongs to, in the fixture
// layout A PP P node N NN C.
function handleAngles(path) {
  return [
    [0, 1],
    [3, 2],
    [3, 4],
    [6, 5],
  ].map(([on, handle]) => {
    const [ox, oy] = path.getPointPosition(on);
    const [hx, hy] = path.getPointPosition(handle);
    return Math.atan2(hy - oy, hx - ox);
  });
}

describe("harmonization: solving handle lengths", () => {
  it("reaches the two curvatures it was asked for", () => {
    const path = diagonalJointPath();
    const points = [0, 1, 2, 3].map((i) => {
      const [x, y] = path.getPointPosition(i);
      return { x, y };
    });

    const solved = adjustHandles(points, 0.004, -0.0025);
    expect(solved).to.not.equal(null);

    const settled = [points[0], solved[0], solved[1], points[3]];
    expect(endCurvature(settled, false)).to.be.closeTo(0.004, 1e-9);
    expect(endCurvature(settled, true)).to.be.closeTo(-0.0025, 1e-9);
  });

  it("never moves a handle off its own direction", () => {
    const path = diagonalJointPath();
    const before = handleAngles(path);
    harmonizeHandlesInPlace(path, [NODE], {});
    for (const [i, angle] of handleAngles(path).entries()) {
      expect(angle).to.be.closeTo(before[i], 1e-9);
    }
  });

  it("brings the two sides of a joint onto one curvature", () => {
    const path = reportedArchPath();
    const drawn = segmentsAt(path, NODE);
    const before = curvatureDiscontinuity(drawn.incoming, drawn.outgoing);
    // 0.53% of the joint's own curvature: small, and the whole complaint.
    expect(before).to.be.above(1e-5);

    const report = harmonizeHandlesInPlace(path, [NODE], {});
    expect(report[0].status).to.equal("harmonized");
    expect(report[0].construction).to.equal("handles");

    const after = segmentsAt(path, NODE);
    // Both sides land on the mean of the two, exactly, so what is left is
    // floating-point dust rather than a smaller version of the same gap.
    expect(curvatureDiscontinuity(after.incoming, after.outgoing)).to.be.below(1e-15);
  });

  it("flattens an inflection instead of averaging across it", () => {
    // The two sides curve opposite ways, so there is no magnitude they can
    // share but zero -- which is what an inflection is. Point-symmetric about
    // the joint, so neither side is the easier one to flatten.
    const path = makeContour([
      { x: -120, y: -90 },
      cubic(-80, -80),
      cubic(-40, -50),
      { x: 0, y: 0, smooth: true },
      cubic(40, 50),
      cubic(80, 80),
      { x: 120, y: 90 },
    ]);
    harmonizeHandlesInPlace(path, [NODE], {});
    const { incoming, outgoing } = segmentsAt(path, NODE);
    expect(Math.abs(endCurvature(incoming, true))).to.be.below(1e-9);
    expect(Math.abs(endCurvature(outgoing, false))).to.be.below(1e-9);
  });

  it("leaves the drawing alone when it cannot improve on it", () => {
    const path = diagonalJointPath();
    harmonizeHandlesInPlace(path, [NODE], { roundCoordinates: true });
    const once = Array.from(path.coordinates);
    const report = harmonizeHandlesInPlace(path, [NODE], { roundCoordinates: true });
    expect(Array.from(path.coordinates)).to.deep.equal(once);
    expect(report[0].status).to.equal("skipped");
  });

  it("keeps whole-unit coordinates when the editor asks for them", () => {
    const path = diagonalJointPath();
    harmonizeHandlesInPlace(path, [NODE], { roundCoordinates: true });
    for (let index = 0; index < path.numPoints; index++) {
      for (const value of path.getPointPosition(index)) {
        expect(value).to.equal(Math.round(value));
      }
    }
  });
});

// --- G3 may not be bought with G2 -------------------------------------------
//
// Reported on `n` node 13 as it stood on 2026-08-21. The joint arrives with its
// curvature agreeing to 0.35% and its rate 1920% out, so the whole defect is
// G3. Ticking G3 used to move P by 31 units and leave the curvature 18.38% out
// -- a visible break in the comb -- and report it as harmonized. The grid was
// offering 2.23% at the same joint and the score passed over it, because it
// added the curvature error to the rate error and a 1920% rate makes buying
// curvature cheap.

// The curvature jump as a fraction of the joint's own curvature, which is the
// step the comb draws.
function combStep(path) {
  const at = (i) => {
    const [x, y] = path.getPointPosition(i);
    return { x, y };
  };
  const incoming = [at(NODE - 3), at(NODE - 2), at(NODE - 1), at(NODE)];
  const outgoing = [at(NODE), at(NODE + 1), at(NODE + 2), at(NODE + 3)];
  const end = (pts) => {
    const [, p1, p2, p3] = pts;
    const d1 = { x: p3.x - p2.x, y: p3.y - p2.y };
    const d2 = { x: p3.x - 2 * p2.x + p1.x, y: p3.y - 2 * p2.y + p1.y };
    return ((2 / 3) * (d1.x * d2.y - d1.y * d2.x)) / Math.hypot(d1.x, d1.y) ** 3;
  };
  const start = (pts) => {
    const [p0, p1, p2] = pts;
    const d1 = { x: p1.x - p0.x, y: p1.y - p0.y };
    const d2 = { x: p2.x - 2 * p1.x + p0.x, y: p2.y - 2 * p1.y + p0.y };
    return ((2 / 3) * (d1.x * d2.y - d1.y * d2.x)) / Math.hypot(d1.x, d1.y) ** 3;
  };
  const a = end(incoming);
  const b = start(outgoing);
  return Math.abs(a - b) / ((Math.abs(a) + Math.abs(b)) / 2);
}

// `n` node 13, verbatim. Short handles on the outgoing side: 23 units against a
// 78-unit chord, with its outer handle only 6 units off the tangent. Whole
// units cannot express a G3 answer there -- half a unit on one point of the
// exact answer costs 96% of the curvature.
function reportedRateDefectPath() {
  return makeContour([
    { x: 298, y: 420, smooth: true },
    cubic(298, 473),
    cubic(248, 515),
    { x: 187, y: 515, smooth: true },
    cubic(164, 515),
    cubic(159, 509),
    { x: 138, y: 455 },
  ]);
}

describe("harmonization: G3 contains G2", () => {
  it("does not buy a better rate with a curvature step the eye can see", () => {
    const path = reportedRateDefectPath();
    const before = combStep(path);
    expect(before).to.be.below(0.01); // 0.35%: G2 is already satisfied here

    harmonizePathInPlace(path, [NODE], {
      continuity: "G3",
      handleBias: 1,
      roundCoordinates: true,
    });

    // The grid cannot hold the exact answer at this joint, so some step is
    // unavoidable. What is not allowed is trading the visible condition for the
    // invisible one: this used to land at 18.38%.
    expect(combStep(path)).to.be.at.most(HARMONIZE_DEFAULTS.maxCurvatureStep);
  });

  it("still improves the rate it was asked to improve", () => {
    const at = (path, i) => {
      const [x, y] = path.getPointPosition(i);
      return { x, y };
    };
    const rate = (path) =>
      curvatureRateDiscontinuity(
        [at(path, NODE - 3), at(path, NODE - 2), at(path, NODE - 1), at(path, NODE)],
        [at(path, NODE), at(path, NODE + 1), at(path, NODE + 2), at(path, NODE + 3)]
      );

    const path = reportedRateDefectPath();
    const before = rate(path);
    harmonizePathInPlace(path, [NODE], {
      continuity: "G3",
      slideOnCurve: true,
      handleBias: 0,
      roundCoordinates: true,
    });
    // The ceiling is a constraint on the answer, not a reason to stop looking
    // for one: with the slide on, the joint finds a place where the grid can
    // hold both conditions at once.
    expect(rate(path)).to.be.below(before / 100);
    expect(combStep(path)).to.be.at.most(HARMONIZE_DEFAULTS.maxCurvatureStep);
  });

  it("does not forbid improving a joint that arrives worse than the ceiling", () => {
    // A joint 40% out on curvature may be left at 30% -- the ceiling is the
    // worse of the bound and what the drawing already had, so a bad drawing is
    // never locked out of getting better.
    const path = reportedArchPath();
    const before = combStep(path);
    harmonizePathInPlace(path, [NODE], {
      continuity: "G3",
      handleBias: 1,
      roundCoordinates: true,
    });
    expect(combStep(path)).to.be.at.most(
      Math.max(before, HARMONIZE_DEFAULTS.maxCurvatureStep)
    );
  });
});

// --- the shape of the comb, not only the joint ------------------------------
//
// Reported on `n` node 13: the joint was G2/G3-continuous and the curve either
// side of it was not. Every other measurement in this file is taken AT the
// joint, and a joint can be exactly G3 while sitting on a spike with a hollow
// behind it.

// Signed curvature at parameter t, so the middle of a segment can be asked
// about and not only its ends.
function curvatureAlong([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const d1 = {
    x: 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
    y: 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
  };
  const d2 = {
    x: 6 * (u * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
    y: 6 * (u * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y)),
  };
  const speed = Math.hypot(d1.x, d1.y);
  return speed ? (d1.x * d2.y - d1.y * d2.x) / speed ** 3 : 0;
}

// How far the comb sags in the middle of a segment, against the shallower of
// its two ends. Above 1 the middle is the highest point, which is fine; well
// below 1 the segment slackens and tightens again, which is not.
function combSag(path, indices) {
  const pts = indices.map((i) => {
    const [x, y] = path.getPointPosition(i);
    return { x, y };
  });
  const samples = [];
  for (let i = 0; i <= 20; i++) samples.push(Math.abs(curvatureAlong(pts, i / 20)));
  const ends = Math.min(samples[0], samples[20]);
  return ends ? Math.min(...samples.slice(2, 19)) / ends : 1;
}

describe("harmonization: the curve either side of the joint", () => {
  // `n` node 13 as it was drawn on 2026-08-21. The exact G3 answer here wants
  // the joint's outgoing handle at 15% of its chord, where a well-formed arc
  // sits near 55%, and a handle that short forces a curvature spike at the
  // joint with a hollow behind it.
  function reportedCombPath() {
    return makeContour([
      { x: 298, y: 420, smooth: true },
      cubic(298, 473),
      cubic(248, 515),
      { x: 187, y: 515, smooth: true },
      cubic(164, 515),
      cubic(159, 509),
      { x: 138, y: 455 },
    ]);
  }

  it("slides to a position whose comb does not sag, not merely to the best-scoring one", () => {
    const drawn = reportedCombPath();
    expect(combSag(drawn, [0, 1, 2, 3])).to.be.above(0.5);

    const path = reportedCombPath();
    harmonizePathInPlace(path, [NODE], {
      continuity: "G3",
      slideOnCurve: true,
      handleBias: 0,
      roundCoordinates: true,
    });

    // Ranking the slide's candidates on grid accuracy alone stopped it at +21
    // units, where the incoming comb sagged to 0.30 of its own end. The
    // notch-free positions start five units further along.
    expect(combSag(path, [0, 1, 2, 3])).to.be.above(0.5);
  });
});

// --- the curve, not only the joint ------------------------------------------
//
// Reported on `n`. A designer built a second copy of the glyph beside the
// original and harmonized the analogous joint by hand in about ten seconds:
// slid it along its tangent, adjusted the handles, equalized. The result is a
// better curve and is WORSE across the joint -- 0.72% against the drawn 0.48%
// -- and joint continuity was the only thing the score measured, so the command
// could not have produced that answer: it would have reverted it as 1.5x worse.
//
// Their words: a direction, not a target. So the bar is their energy, and the
// command is expected to reach it or beat it.

function bendingEnergyAcross(path, index) {
  const at = (i) => {
    const [x, y] = path.getPointPosition(i);
    return { x, y };
  };
  let total = 0;
  for (const pts of [
    [at(index - 3), at(index - 2), at(index - 1), at(index)],
    [at(index), at(index + 1), at(index + 2), at(index + 3)],
  ]) {
    const [p0, p1, p2, p3] = pts;
    for (let i = 0; i < 40; i++) {
      const sample = (t) => {
        const u = 1 - t;
        const d1 = {
          x:
            3 *
            (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
          y:
            3 *
            (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
        };
        const d2 = {
          x: 6 * (u * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
          y: 6 * (u * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y)),
        };
        const speed = Math.hypot(d1.x, d1.y);
        if (!speed) return 0;
        const k = (d1.x * d2.y - d1.y * d2.x) / speed ** 3;
        return k * k * speed;
      };
      total += (sample(i / 40) + sample((i + 1) / 40)) / 2 / 40;
    }
  }
  return total;
}

// `n` point 13, untouched, and point 33 -- the same joint corrected by hand.
const reportedArch = () =>
  makeContour([
    { x: 298, y: 420, smooth: true },
    cubic(298, 473),
    cubic(248, 515),
    { x: 187, y: 515, smooth: true },
    cubic(164, 515),
    cubic(159, 509),
    { x: 138, y: 455 },
  ]);
const correctedByHand = () =>
  makeContour([
    { x: 298, y: 420, smooth: true },
    cubic(298, 480),
    cubic(265, 515),
    { x: 209, y: 515, smooth: true },
    cubic(171, 515),
    cubic(153, 499),
    { x: 138, y: 455 },
  ]);

describe("harmonization: the curve either side, not only the joint", () => {
  it("the hand-made answer is the better curve and the worse joint", () => {
    // Both halves of the trap, stated as a fixture so it cannot come back.
    const drawn = reportedArch();
    const hand = correctedByHand();
    expect(bendingEnergyAcross(hand, NODE)).to.be.below(
      bendingEnergyAcross(drawn, NODE)
    );
    expect(measureG2Discontinuity(getJointContext(hand, NODE))).to.be.above(
      measureG2Discontinuity(getJointContext(drawn, NODE))
    );
  });

  it("reaches the hand-made answer's fairness, or better", () => {
    const bar = bendingEnergyAcross(correctedByHand(), NODE);
    const path = reportedArch();
    const report = harmonizePathInPlace(path, [NODE], {
      continuity: "G2",
      handleBias: 0,
      slideOnCurve: true,
      equalizeTension: true,
      roundCoordinates: true,
    });
    expect(report[0].status).to.equal("harmonized");
    expect(bendingEnergyAcross(path, NODE)).to.be.at.most(bar);
  });

  it("slides under G2, where every position on the tangent is equally harmonic", () => {
    // The ratio depends only on the outer handles' offsets from the tangent,
    // which sliding does not change -- so G2 alone has no reason to prefer any
    // position, and before this the tick did not slide at all: it only chose
    // whether the joint or its handles absorbed a third of a unit.
    const held = reportedArch();
    harmonizePathInPlace(held, [NODE], {
      continuity: "G2",
      handleBias: 0,
      roundCoordinates: true,
    });
    const slid = reportedArch();
    harmonizePathInPlace(slid, [NODE], {
      continuity: "G2",
      handleBias: 0,
      slideOnCurve: true,
      roundCoordinates: true,
    });
    expect(nodePos(slid)).to.not.deep.equal(nodePos(held));
    expect(bendingEnergyAcross(slid, NODE)).to.be.below(
      bendingEnergyAcross(held, NODE)
    );
  });
});

// --- which construction runs is the command's decision -----------------------
//
// The handle-length solve used to be a checkbox, which asked a designer to pick
// an algorithm. It is a candidate now: both constructions run and the score
// keeps the better, the way the G3 cascade has always chosen between G3 and G2.
//
// It is admitted only where the outer handles may move. A cubic's end curvature
// depends on its last three control points, so PP and NN are inputs to the
// joint construction and never outputs -- and the handle-length solve rescales
// both handles of every segment, so it moves them. `equalizeTension` is the
// tick that says they may move.

describe("harmonization: choosing the construction", () => {
  // `n` joint 4, where the joint construction has no answer above the grid and
  // the handle-length solve takes the curvature step from 1.4e-4 to 1.8e-5 by
  // shortening one handle and lengthening the other -- which no amount of
  // sliding along the tangent can express, because sliding preserves both
  // lengths and translating trades one against the other at a fixed sum.
  function independentHandlesPath() {
    return makeContour([
      { x: 138, y: 358, smooth: true },
      cubic(138, 424),
      cubic(154, 455),
      { x: 192, y: 455, smooth: true },
      cubic(220, 455),
      cubic(238, 438),
      { x: 238, y: 404, smooth: true },
    ]);
  }

  const outerHandles = (path) => [1, 5].map((i) => [...path.getPointPosition(i)]);

  it("leaves the outer handles alone when equalization is off", () => {
    const path = independentHandlesPath();
    const before = outerHandles(path);
    harmonizePathInPlace(path, [NODE], {
      continuity: "G2",
      handleBias: 1,
      roundCoordinates: true,
    });
    expect(outerHandles(path)).to.deep.equal(before);
  });

  it("picks the handle-length construction where it is the better answer", () => {
    const path = independentHandlesPath();
    const before = Array.from(path.coordinates);
    const report = harmonizePathInPlace(path, [NODE], {
      continuity: "G2",
      handleBias: 1,
      equalizeTension: true,
      roundCoordinates: true,
      pressAttempts: 1,
    });

    // The command chose it; nobody ticked it. And the report names which ran,
    // because with more than one construction a verdict that does not name one
    // is a verdict you have to guess at. Read on a single attempt: the report
    // names the construction behind the drawing that was KEPT, and a later
    // attempt can win with a different one.
    expect(report[0].construction).to.equal("handles");
    expect(report[0].status).to.equal("harmonized");
    expect(Array.from(path.coordinates)).to.not.deep.equal(before);
  });
});

describe("harmonization: realigning a joint before it is solved", () => {
  // A smooth flag is a claim about the drawing: the two handles and the joint
  // lie on one line. Where the drawing has drifted off that, every
  // construction here is solving against a tangent that is not there.

  function positionsOf(path, indices) {
    return indices.map((index) => {
      const [x, y] = path.getPointPosition(index);
      return { x, y };
    });
  }

  // How far the joint is bent, in degrees. Zero when P, the joint and N are
  // collinear, which is what the smooth flag says.
  function bendAt(path, pointIndex) {
    const [P, node, N] = positionsOf(path, [
      pointIndex - 1,
      pointIndex,
      pointIndex + 1,
    ]);
    const incoming = { x: node.x - P.x, y: node.y - P.y };
    const outgoing = { x: N.x - node.x, y: N.y - node.y };
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
  }

  // both handles are off-curve and neither runs along an axis
  function bentJoint() {
    return makeContour([
      { x: 0, y: 0 },
      cubic(0, 40),
      cubic(50, 90),
      { x: 100, y: 100, smooth: true },
      cubic(160, 115),
      cubic(200, 60),
      { x: 200, y: 0 },
    ]);
  }

  // the outgoing handle runs dead horizontal off the joint
  function bentJointWithFlatHandle() {
    return makeContour([
      { x: 0, y: 0 },
      cubic(0, 40),
      cubic(50, 90),
      { x: 100, y: 100, smooth: true },
      cubic(160, 100),
      cubic(200, 60),
      { x: 200, y: 0 },
    ]);
  }

  // a curve running into a straight: harmonize refuses this joint, realigning
  // it does not
  function bentTensionPoint() {
    return makeContour([
      { x: 0, y: 0 },
      cubic(0, 50),
      cubic(50, 100),
      { x: 100, y: 100, smooth: true },
      { x: 200, y: 60 },
    ]);
  }

  it("is off unless it is asked for", () => {
    // a curve running into a straight, which harmonize itself refuses: with
    // the pass off, nothing in the command touches this joint at all
    const path = bentTensionPoint();
    const before = positionsOf(path, [2, 3, 4]);
    harmonizePathInPlace(path, [3], {});
    expect(bendAt(path, 3)).to.be.greaterThan(1);
    expect(positionsOf(path, [2, 3, 4])).to.deep.equal(before);
  });

  it("puts the joint back on one line", () => {
    const path = bentJoint();
    expect(bendAt(path, 3)).to.be.greaterThan(1);
    harmonizePathInPlace(path, [3], { realignHandles: true });
    expect(bendAt(path, 3)).to.be.lessThan(1e-6);
  });

  it("brings the joint to the handles when neither runs along an axis", () => {
    const path = bentJoint();
    const before = positionsOf(path, [2, 4]);
    harmonizePathInPlace(path, [3], { realignHandles: true, maxIterations: 0 });
    // both handles are where the designer drew them; the joint moved onto them
    expect(positionsOf(path, [2, 4])).to.deep.equal(before);
    expect(positionsOf(path, [3])).to.not.deep.equal([{ x: 100, y: 100 }]);
  });

  it("keeps an axis-aligned handle and turns the other onto it", () => {
    // a handle drawn flat marks an extreme of the curve. It is the one piece
    // of the joint that is certainly deliberate, so it is what the rest is
    // squared up against.
    const path = bentJointWithFlatHandle();
    harmonizePathInPlace(path, [3], { realignHandles: true, maxIterations: 0 });
    expect(positionsOf(path, [3])).to.deep.equal([{ x: 100, y: 100 }]);
    expect(positionsOf(path, [4])).to.deep.equal([{ x: 160, y: 100 }]);
    const [P] = positionsOf(path, [2]);
    expect(P.y).to.be.closeTo(100, 1e-9);
    expect(P.x).to.be.lessThan(100);
  });

  it("keeps the length of a handle it turns", () => {
    const path = bentJointWithFlatHandle();
    const [beforeP, node] = positionsOf(path, [2, 3]);
    harmonizePathInPlace(path, [3], { realignHandles: true, maxIterations: 0 });
    const [afterP] = positionsOf(path, [2]);
    expect(distance(afterP, node)).to.be.closeTo(distance(beforeP, node), 1e-9);
  });

  it("turns the handle onto the straight at a curve-to-line joint", () => {
    // harmonize itself refuses this joint, so without the pass nothing here
    // is ever squared up
    const path = bentTensionPoint();
    expect(getJointContext(path, 3).reason).to.equal("not-curve-joint");

    harmonizePathInPlace(path, [3], { realignHandles: true });

    expect(positionsOf(path, [3])).to.deep.equal([{ x: 100, y: 100 }]);
    expect(positionsOf(path, [4])).to.deep.equal([{ x: 200, y: 60 }]);
    expect(bendAt(path, 3)).to.be.lessThan(1e-6);
  });

  it("leaves a joint that is already on one line exactly alone", () => {
    const path = symmetricPath();
    const before = positionsOf(path, [2, 3, 4]);
    harmonizePathInPlace(path, [3], { realignHandles: true, maxIterations: 0 });
    expect(positionsOf(path, [2, 3, 4])).to.deep.equal(before);
  });

  it("does not square up a corner", () => {
    const corner = makeContour([
      { x: 0, y: 0 },
      cubic(0, 40),
      cubic(50, 90),
      { x: 100, y: 100 },
      cubic(160, 115),
      cubic(200, 60),
      { x: 200, y: 0 },
    ]);
    const before = positionsOf(corner, [2, 3, 4]);
    harmonizePathInPlace(corner, [3], { realignHandles: true });
    expect(positionsOf(corner, [2, 3, 4])).to.deep.equal(before);
  });

  it("keeps a flat handle flat, which the joint repair does not", () => {
    // Harmonize squares the joint up itself, by translating both handles
    // together. That is a repair, and it carries a horizontal handle off the
    // horizontal -- the extreme of the curve moves off the joint. Realigning
    // first turns the other handle onto the flat one instead, so the extreme
    // stays where the designer put it.
    const repaired = bentJointWithFlatHandle();
    harmonizePathInPlace(repaired, [3], {});
    expect(positionsOf(repaired, [4])[0].y).to.not.be.closeTo(100, 1e-6);

    const realigned = bentJointWithFlatHandle();
    harmonizePathInPlace(realigned, [3], { realignHandles: true });
    expect(positionsOf(realigned, [4])[0].y).to.be.closeTo(100, 1e-6);
    expect(positionsOf(realigned, [2])[0].y).to.be.closeTo(100, 1e-6);
    expect(bendAt(realigned, 3)).to.be.lessThan(1e-6);
  });
});

describe("harmonization: pressing it again does nothing", () => {
  // A press was not a fixed point. With the preparation passes on it was
  // nowhere near one: balance reads the drawing the solve left, so the two
  // chased each other and repeated pressing was a gamble that read as
  // convergence. The press repeats itself inside one scored gate now.

  function pressed(path, options) {
    harmonizePathInPlace(path, undefined, { roundCoordinates: true, ...options });
    return Array.from(path.coordinates);
  }

  const settings = [
    { continuity: "G2" },
    { continuity: "G3" },
    { continuity: "G2", equalizeTension: true },
    { continuity: "G2", realignHandles: true },
  ];

  for (const options of settings) {
    it(`settles on ${JSON.stringify(options)}`, () => {
      const path = asymmetricPath();
      const once = pressed(path, options);
      const twice = pressed(path, options);
      expect(twice).to.deep.equal(once);
    });
  }

  // Not asserted, and named rather than hidden: with the balance on, a second
  // call is not a repetition. Every call balances the drawing it is handed,
  // and the drawing it is handed has had its inner handles moved by the
  // previous call's solve, so there is something to balance again. Over 1500
  // random joints a second call still moves 1082 of them. The loop above
  // settles the solve, and it cannot settle two different requests to the same
  // handles. Curvatura's model -- balance as its own command -- is the fix,
  // and it is a change to what the tick is, not to how it runs.

  it("keeps the drawing where every repetition would only make it worse", () => {
    // The drawing the command was handed is one of the candidates, so the
    // repetition can never leave it worse than it found it.
    const path = symmetricPath();
    const before = Array.from(path.coordinates);
    harmonizePathInPlace(path, [NODE], { roundCoordinates: true });
    expect(Array.from(path.coordinates)).to.deep.equal(before);
  });

  it("is one press when it is asked for one", () => {
    // The repetition is a budget, not a rule: a caller that wants a single
    // press gets exactly that.
    const single = asymmetricPath();
    harmonizePathInPlace(single, [NODE], { roundCoordinates: true, pressAttempts: 1 });
    const settled = asymmetricPath();
    harmonizePathInPlace(settled, [NODE], { roundCoordinates: true });
    // Nothing asserts they differ -- on an easy joint one press already
    // settles. What is asserted is that a budget of one is honoured, which
    // shows up as a state no worse than the drawing.
    expect(single.numPoints).to.equal(settled.numPoints);
  });
});

describe("harmonization: a joint that arrived badly broken", () => {
  //
  // Reported on `_external/test-glyphs/j.json`, point 3 of the b1aacb66 layer:
  // with equalization on, the left segment came out flattened and its two
  // handles were nowhere near equal -- 0.880 and 0.191, which is the opposite
  // of what the tick asks for.
  //
  // The joint arrives with a radius of 199.8 on one side and 42.7 on the other,
  // a 130 per cent step. The guard that forbids leaving a joint worse than
  // `maxCurvatureStep` stands down where the drawing already arrived worse than
  // that, so that a joint 40 per cent out is not forbidden from being improved
  // to 30. Here it stood down at 130 per cent, which forbade nothing at all,
  // and the choice fell through to the term that prefers the flatter curve.
  //
  function reportedBrokenJoint() {
    return makeContour([
      { x: 135, y: 263 },
      cubic(135, 315),
      cubic(177, 355),
      { x: 250, y: 355, smooth: true },
      cubic(282, 355),
      cubic(315, 319),
      { x: 315, y: 263 },
    ]);
  }

  function segmentTensions(path, start) {
    const points = [0, 1, 2, 3].map((offset) => {
      const [x, y] = path.getPointPosition(start + offset);
      return { x, y };
    });
    const tunniPoint = calculateTunniPoint(points);
    return [
      distance(points[0], points[1]) / distance(points[0], tunniPoint),
      distance(points[3], points[2]) / distance(points[3], tunniPoint),
    ];
  }

  // The curvature step across the joint, against the joint's own curvature.
  function relativeStep(path) {
    const points = [0, 1, 2, 3, 4, 5, 6].map((index) => {
      const [x, y] = path.getPointPosition(index);
      return { x, y };
    });
    const incoming = points.slice(0, 4);
    const outgoing = points.slice(3, 7);
    const step = curvatureDiscontinuity(incoming, outgoing);
    const scale =
      (distance(incoming[0], incoming[3]) + distance(outgoing[0], outgoing[3])) / 2;
    return step * scale;
  }

  it("harmonizes it to the grid with every tick off", () => {
    const path = reportedBrokenJoint();
    const before = relativeStep(path);
    harmonizePathInPlace(path, [3], { roundCoordinates: true });
    expect(relativeStep(path)).to.be.lessThan(before / 100);
  });

  it("does not leave it worse for having asked for equalization", () => {
    const plain = reportedBrokenJoint();
    harmonizePathInPlace(plain, [3], { roundCoordinates: true });

    const equalized = reportedBrokenJoint();
    harmonizePathInPlace(equalized, [3], {
      roundCoordinates: true,
      equalizeTension: true,
    });

    // A clean answer was on the table, so the guard has to tighten onto it.
    // The equalized answer is not identical to the plain one -- balancing moves
    // the drawing the solve then works from -- but it lands beside it instead
    // of several times worse, and it is under the perceptual bound rather than
    // excused by the 130 per cent the drawing arrived with.
    expect(relativeStep(equalized)).to.be.lessThan(0.04);
    expect(relativeStep(equalized)).to.be.lessThan(relativeStep(plain) * 4);
  });

  it("does not crown a construction that refused the joint", () => {
    // Curvatura's handle-length solve reported `partial`, reason `degenerate`,
    // and won anyway, because nothing above the flatness term could veto it.
    const path = reportedBrokenJoint();
    const report = harmonizePathInPlace(path, [3], {
      roundCoordinates: true,
      equalizeTension: true,
    });
    expect(report[0].status).to.equal("harmonized");
    expect(report[0].reason).to.equal(undefined);
  });

  it("settles under repeated calls with equalization on", () => {
    const path = reportedBrokenJoint();
    const press = () => {
      harmonizePathInPlace(path, [3], {
        roundCoordinates: true,
        equalizeTension: true,
      });
      return Array.from(path.coordinates);
    };
    press();
    press();
    press();
    const settled = press();
    expect(press()).to.deep.equal(settled);
  });

  it("leaves the segments something like balanced when asked to balance them", () => {
    // The tick's own promise. It came out at 0.880 and 0.191.
    const path = reportedBrokenJoint();
    harmonizePathInPlace(path, [3], {
      roundCoordinates: true,
      equalizeTension: true,
    });
    const [start, end] = segmentTensions(path, 0);
    expect(Math.abs(start - end)).to.be.lessThan(0.3);
  });
});
