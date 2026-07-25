import {
  HARMONIZE_DEFAULTS,
  calculateHarmonicTarget,
  expandToJoints,
  getJointContext,
  harmonizePath,
  measureG2Discontinuity,
} from "@fontra/core/harmonization.js";
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
// past the 15% floor of the outgoing handle -> clamping territory
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

  it("clamps instead of collapsing a handle, and reports partial", () => {
    const path = clampPath();
    const b0 = distance(
      { x: 150, y: 100 },
      { x: 110, y: 100 } // outgoing handle length before: 40
    );
    const result = harmonizePath(path, [NODE], { handleBias: 1 });

    expect(result.report[0].status).to.equal("partial");
    expect(result.report[0].reason).to.equal("clamped");

    const ctx = getJointContext(result.path, NODE);
    const remaining = distance(ctx.node, ctx.N);
    expect(remaining).to.be.closeTo(
      (1 - HARMONIZE_DEFAULTS.cuspSafetyMargin) * b0,
      1e-6
    );
    expect(remaining).to.be.greaterThan(0);
  });

  it("clamps at handleBias 0 as well - the node slides toward the handle", () => {
    const result = harmonizePath(clampPath(), [NODE], { handleBias: 0 });
    expect(result.report[0].status).to.equal("partial");
    const ctx = getJointContext(result.path, NODE);
    expect(distance(ctx.node, ctx.N)).to.be.closeTo(0.15 * 40, 1e-6);
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
