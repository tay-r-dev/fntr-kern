# Skeleton Offset Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sample-and-fit offset path for cubic skeleton segments with a closed-form construction, so generated outline handles are a continuous function of the skeleton.

**Architecture:** A new pure module computes each generated handle as a vector — direction and length — in closed form from the skeleton cubic, the two half-widths and the signed offset distance. Endpoint tangent direction is exact (offsetting preserves it); handle length follows from `λ = 1 + d·κ`. One fixed least-squares pass corrects mid-segment drift. Two smooth bounds keep the result finite at the cusp and stop handles overshooting the tangent-ray intersection. No `reduce()`, no adaptive thresholds, no iteration counts.

**Tech Stack:** JavaScript ES modules, mocha + chai, bezier-js (retained for unrelated call sites only).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-26-skeleton-offset-construction-design.md`. Read it before Task 1.
- Test command: `cd src-js/fontra-core && npm test`. This is the only harness in the repo.
- Do **not** run `npm run bundle`. The user runs bundle-watch and reports compile errors.
- Run `npx prettier --write` on every touched file before committing.
- Point-count stability is a hard constraint: exactly one cubic per side per segment. Cross-master interpolation breaks otherwise.
- Rail R-B: one copy of every constant and geometry function. Import, never duplicate.
- Sign convention, verified 2026-07-26: `rotateVector90CW(v) = (v.y, −v.x)`. The generator's left side is `+halfWidth` along the CW normal, right side is `−halfWidth`. Signed curvature is `κ = cross(B′, B″)/|B′|³`. With those conventions the offset speed factor is **`λ = 1 + d·κ`**, `d` signed.
- Scope: the cubic-segment branch only. Line segments, caps, corner rounding, assembly and `enforceSmoothColinearity` are untouched.
- Two discontinuities are **intentional and must survive**: the 0.5-unit collapsed-side threshold, and the forward/behind flip of the tangent-ray intersection. Continuity tests must exclude both.

## File Structure

| File | Responsibility |
|------|----------------|
| `src-js/fontra-core/src/offset-cubic.js` | **NEW.** The whole construction. Pure, no state, no `Bezier` objects. |
| `src-js/fontra-core/tests/test-offset-cubic.js` | **NEW.** Unit tests for the above. |
| `src-js/fontra-core/src/fit-cubic.js` | Gains `solveHandleLengths`. `generateBezier` behavior unchanged. |
| `src-js/fontra-core/tests/test-fit-cubic.js` | One added test for the extraction. |
| `src-js/fontra-core/src/skeleton-generator.js` | Cubic branch calls the new module. Dead code removed. |
| `src-js/fontra-core/tests/test-skeleton-generator.js` | Golden-master suite retitled. |
| `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` | Regenerated. |
| `docs/superpowers/SKELETON-FEATURE-MODEL.md` | Records the donor divergence and the pipeline change. |

---

### Task 1: Extract the least-squares solve from `fit-cubic.js`

`generateBezier` solves exactly the two-handle-length problem the new module needs, but bakes in a fallback that discards both solved handles for `segLength/3` whenever either comes out non-positive. Extract the solve so the new module can supply its own smooth fallback, leaving `generateBezier` behaviorally identical for its three existing importers.

**Files:**
- Modify: `src-js/fontra-core/src/fit-cubic.js:20-72`
- Test: `src-js/fontra-core/tests/test-fit-cubic.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `solveHandleLengths(points, parameters, leftTangent, rightTangent) → {alphaL: number, alphaR: number}`. `points` is an array of `{x, y}` whose first and last elements are the curve endpoints; `parameters` is a parallel array of numbers in [0,1]; the tangents are unit `{x, y}` pointing *into* the curve from each endpoint. Returns the two handle lengths along those tangents. Returns `{alphaL: 0, alphaR: 0}` when the normal equations are singular.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-fit-cubic.js`:

```js
describe("solveHandleLengths", () => {
  it("returns the alphas generateBezier places its control points at", () => {
    const points = [
      { x: -28, y: 138 },
      { x: 72, y: 188 },
      { x: 118, y: 190 },
      { x: 192, y: 160 },
      { x: 262, y: 134 },
      { x: 296, y: 86 },
      { x: 318, y: 18 },
    ];
    const parameters = [
      0.0, 0.25257093967929206, 0.3565860188512732, 0.5369718939837534,
      0.7056620562778243, 0.8385441379333622, 1.0,
    ];
    const leftTangent = { x: 0.7071067811865475, y: 0.7071067811865475 };
    const rightTangent = { x: -0.31622776601683794, y: 0.9486832980505138 };

    const { alphaL, alphaR } = solveHandleLengths(
      points,
      parameters,
      leftTangent,
      rightTangent
    );
    const [b1, b2, b3, b4] = generateBezier(
      points,
      parameters,
      leftTangent,
      rightTangent
    ).points;

    expect(b2.x).to.be.closeTo(b1.x + leftTangent.x * alphaL, 1e-9);
    expect(b2.y).to.be.closeTo(b1.y + leftTangent.y * alphaL, 1e-9);
    expect(b3.x).to.be.closeTo(b4.x + rightTangent.x * alphaR, 1e-9);
    expect(b3.y).to.be.closeTo(b4.y + rightTangent.y * alphaR, 1e-9);
  });

  it("returns zeros when the normal equations are singular", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    const { alphaL, alphaR } = solveHandleLengths(
      points,
      [0, 0.5, 1],
      { x: 1, y: 0 },
      { x: -1, y: 0 }
    );
    expect(alphaL).to.equal(0);
    expect(alphaR).to.equal(0);
  });
});
```

Add `solveHandleLengths` to the import list at the top of that file (it already imports `generateBezier` and uses `expect`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-fit-cubic.js --extension js`
Expected: FAIL — `solveHandleLengths is not a function` (or an import error).

- [ ] **Step 3: Extract the solve**

In `src-js/fontra-core/src/fit-cubic.js`, replace the whole of `generateBezier` (lines 20-72) with:

```js
export function solveHandleLengths(points, parameters, leftTangent, rightTangent) {
  const bezierLinear = new Bezier(
    points[0],
    points[0],
    points[points.length - 1],
    points[points.length - 1]
  );
  const A = zeros(parameters.length, 2, 2);
  for (const [i, u] of enumerate(parameters)) {
    A[i][0] = mulVectorScalar(leftTangent, 3 * (1 - u) ** 2 * u);
    A[i][1] = mulVectorScalar(rightTangent, 3 * (1 - u) * u ** 2);
  }
  const C = zeros(2, 2);
  const X = zeros(2);

  for (let i = 0; i < points.length; i++) {
    const u = parameters[i];
    const point = points[i];
    C[0][0] += dotVector(A[i][0], A[i][0]);
    C[0][1] += dotVector(A[i][0], A[i][1]);
    C[1][0] += dotVector(A[i][0], A[i][1]);
    C[1][1] += dotVector(A[i][1], A[i][1]);
    const tmp = subVectors(point, bezierLinear.get(u));
    X[0] += dotVector(A[i][0], tmp);
    X[1] += dotVector(A[i][1], tmp);
  }

  const C0_C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  const C0_X = C[0][0] * X[1] - C[1][0] * X[0];
  const X_C1 = X[0] * C[1][1] - X[1] * C[0][1];
  return {
    alphaL: C0_C1 == 0 ? 0 : X_C1 / C0_C1,
    alphaR: C0_C1 == 0 ? 0 : C0_X / C0_C1,
  };
}

export function generateBezier(points, parameters, leftTangent, rightTangent) {
  const bezierPoints = [points[0], undefined, undefined, points[points.length - 1]];
  const { alphaL, alphaR } = solveHandleLengths(
    points,
    parameters,
    leftTangent,
    rightTangent
  );
  const segLength = vectorLength(subVectors(points[0], points[points.length - 1]));
  const epsilonForAll = 1.0e-6 * segLength;
  if (alphaL < epsilonForAll || alphaR < epsilonForAll) {
    bezierPoints[1] = addVectors(
      bezierPoints[0],
      mulVectorScalar(leftTangent, segLength / 3.0)
    );
    bezierPoints[2] = addVectors(
      bezierPoints[3],
      mulVectorScalar(rightTangent, segLength / 3.0)
    );
  } else {
    bezierPoints[1] = addVectors(bezierPoints[0], mulVectorScalar(leftTangent, alphaL));
    bezierPoints[2] = addVectors(
      bezierPoints[3],
      mulVectorScalar(rightTangent, alphaR)
    );
  }
  return new Bezier(...bezierPoints);
}
```

This is a pure move. No arithmetic changes.

- [ ] **Step 4: Run the full suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS, including the pre-existing `generateBezier` and `fitCubic` cases with their exact hardcoded values. If either of those shifted, the extraction was not faithful — revert and redo.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/fit-cubic.js src-js/fontra-core/tests/test-fit-cubic.js
git add .
git commit -m "refactor: expose the two-handle least-squares solve from fit-cubic

generateBezier discards both solved handle lengths for a chord/3 default
whenever either comes out non-positive. The offset construction needs the
raw solve so it can apply a smooth fallback instead. Pure extraction -
generateBezier's behavior is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The closed-form construction

The core: endpoint curvature, offset end derivatives with the width-gradient term, and handle placement. No correction pass and no tension bound yet — those are Tasks 3 and 4.

**Files:**
- Create: `src-js/fontra-core/src/offset-cubic.js`
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Consumes: nothing from Task 1 yet.
- Produces:
  - `endpointCurvature(p0, p1, p2, p3, atEnd) → number` — signed curvature at `t=0` (`atEnd` false) or `t=1` (true). Returns `0` for a degenerate end tangent.
  - `offsetCubicSide({p0, p1, p2, p3, d0, d3, q0, q3}) → {h1, h2}` — `p0..p3` are the skeleton cubic's control points; `d0`, `d3` are the **signed** offset distances at each end (positive along the CW normal, so `+halfWidth` for the left side and `−halfWidth` for the right); `q0`, `q3` are the already-projected rib endpoints. Returns the two generated handle positions as floats.

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
import { endpointCurvature, offsetCubicSide } from "@fontra/core/offset-cubic.js";
import { expect } from "chai";

// Standard cubic approximation of a quarter circle.
const KAPPA = 0.5522847498307933;

// Quarter circle, radius 100, centre at the origin, from (100,0) to (0,100),
// travelling counter-clockwise. Signed curvature is +1/100.
function quarterCircle(radius) {
  return {
    p0: { x: radius, y: 0 },
    p1: { x: radius, y: radius * KAPPA },
    p2: { x: radius * KAPPA, y: radius },
    p3: { x: 0, y: radius },
  };
}

describe("offset-cubic: endpointCurvature", () => {
  it("is 1/r on a counter-clockwise quarter circle", () => {
    const { p0, p1, p2, p3 } = quarterCircle(100);
    expect(endpointCurvature(p0, p1, p2, p3, false)).to.be.closeTo(0.01, 1e-6);
    expect(endpointCurvature(p0, p1, p2, p3, true)).to.be.closeTo(0.01, 1e-6);
  });

  it("is zero on a straight segment", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: 20, y: 0 };
    const p3 = { x: 30, y: 0 };
    expect(endpointCurvature(p0, p1, p2, p3, false)).to.be.closeTo(0, 1e-9);
    expect(endpointCurvature(p0, p1, p2, p3, true)).to.be.closeTo(0, 1e-9);
  });

  it("is zero when the end tangent is degenerate", () => {
    const p0 = { x: 0, y: 0 };
    expect(endpointCurvature(p0, p0, { x: 10, y: 5 }, { x: 20, y: 0 }, false)).to.equal(
      0
    );
  });
});

describe("offset-cubic: circular arc exactness", () => {
  it("offsets outward to the larger arc", () => {
    const { p0, p1, p2, p3 } = quarterCircle(100);
    const outer = quarterCircle(120);
    const { h1, h2 } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0: 20,
      d3: 20,
      q0: outer.p0,
      q3: outer.p3,
    });
    expect(h1.x).to.be.closeTo(outer.p1.x, 0.01);
    expect(h1.y).to.be.closeTo(outer.p1.y, 0.01);
    expect(h2.x).to.be.closeTo(outer.p2.x, 0.01);
    expect(h2.y).to.be.closeTo(outer.p2.y, 0.01);
  });

  it("offsets inward to the smaller arc", () => {
    const { p0, p1, p2, p3 } = quarterCircle(100);
    const inner = quarterCircle(80);
    const { h1, h2 } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0: -20,
      d3: -20,
      q0: inner.p0,
      q3: inner.p3,
    });
    expect(h1.x).to.be.closeTo(inner.p1.x, 0.01);
    expect(h1.y).to.be.closeTo(inner.p1.y, 0.01);
    expect(h2.x).to.be.closeTo(inner.p2.x, 0.01);
    expect(h2.y).to.be.closeTo(inner.p2.y, 0.01);
  });

  it("reproduces the source curve at zero offset", () => {
    const { p0, p1, p2, p3 } = quarterCircle(100);
    const { h1, h2 } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0: 0,
      d3: 0,
      q0: p0,
      q3: p3,
    });
    expect(h1.x).to.be.closeTo(p1.x, 0.01);
    expect(h1.y).to.be.closeTo(p1.y, 0.01);
    expect(h2.x).to.be.closeTo(p2.x, 0.01);
    expect(h2.y).to.be.closeTo(p2.y, 0.01);
  });
});

describe("offset-cubic: degenerate inputs", () => {
  const cases = {
    "retracted start handle": {
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 0 },
      p2: { x: 50, y: 40 },
      p3: { x: 100, y: 0 },
    },
    "retracted end handle": {
      p0: { x: 0, y: 0 },
      p1: { x: 50, y: 40 },
      p2: { x: 100, y: 0 },
      p3: { x: 100, y: 0 },
    },
    "all four points coincident": {
      p0: { x: 10, y: 10 },
      p1: { x: 10, y: 10 },
      p2: { x: 10, y: 10 },
      p3: { x: 10, y: 10 },
    },
    "collinear control polygon": {
      p0: { x: 0, y: 0 },
      p1: { x: 30, y: 0 },
      p2: { x: 60, y: 0 },
      p3: { x: 90, y: 0 },
    },
  };

  for (const [name, curve] of Object.entries(cases)) {
    it(`produces finite handles for ${name}`, () => {
      const { h1, h2 } = offsetCubicSide({
        ...curve,
        d0: 25,
        d3: 25,
        q0: { x: curve.p0.x, y: curve.p0.y + 25 },
        q3: { x: curve.p3.x, y: curve.p3.y + 25 },
      });
      for (const value of [h1.x, h1.y, h2.x, h2.y]) {
        expect(Number.isFinite(value), `${name} produced ${value}`).to.equal(true);
      }
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: FAIL — cannot resolve `@fontra/core/offset-cubic.js`.

- [ ] **Step 3: Write the module**

Create `src-js/fontra-core/src/offset-cubic.js`:

```js
import * as vector from "./vector.js";

// Softness of the cusp floor, as a fraction of the un-offset handle length.
// At the cusp (offset distance == radius of curvature) the handle collapses to
// this fraction rather than to zero. Small enough that ordinary configurations
// are perturbed by well under half a unit.
const CUSP_FLOOR = 0.02;

const EPSILON = 1e-9;

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Smooth floor at zero. Equals `value` for value >> softness, equals `softness`
// at zero, and approaches zero from above as value goes negative. C-infinity and
// monotone in `value`, so it can never introduce a jump.
function softPositive(value, softness) {
  return 0.5 * (value + Math.sqrt(value * value + 4 * softness * softness));
}

// First and second derivative of the cubic at t=0 or t=1.
function endDerivatives(p0, p1, p2, p3, atEnd) {
  if (atEnd) {
    return {
      d1: { x: 3 * (p3.x - p2.x), y: 3 * (p3.y - p2.y) },
      d2: { x: 6 * (p3.x - 2 * p2.x + p1.x), y: 6 * (p3.y - 2 * p2.y + p1.y) },
    };
  }
  return {
    d1: { x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) },
    d2: { x: 6 * (p2.x - 2 * p1.x + p0.x), y: 6 * (p2.y - 2 * p1.y + p0.y) },
  };
}

/**
 * Signed curvature of a cubic at one of its endpoints.
 * Positive when the centre of curvature lies along the counter-clockwise normal.
 */
export function endpointCurvature(p0, p1, p2, p3, atEnd) {
  const { d1, d2 } = endDerivatives(p0, p1, p2, p3, atEnd);
  const speed = Math.hypot(d1.x, d1.y);
  if (speed < EPSILON) {
    return 0;
  }
  return cross(d1, d2) / speed ** 3;
}

/**
 * Derivative of the offset curve at one endpoint.
 *
 * For O(t) = P(t) + d(t)·N(t) with N the clockwise normal and d linear in t:
 *
 *   O'(t) = P'(t)·(1 + d(t)·k(t)) + d'(t)·N(t)
 *
 * The first term is exact: offsetting scales speed and preserves tangent
 * direction. The second tilts the end tangent when the two widths differ.
 * Returns null when the source tangent is degenerate.
 */
function offsetEndDerivative(p0, p1, p2, p3, d0, d3, atEnd) {
  const { d1 } = endDerivatives(p0, p1, p2, p3, atEnd);
  const speed = Math.hypot(d1.x, d1.y);
  if (speed < EPSILON) {
    return null;
  }
  const tangent = { x: d1.x / speed, y: d1.y / speed };
  const normalCW = vector.rotateVector90CW(tangent);
  const curvature = endpointCurvature(p0, p1, p2, p3, atEnd);
  const distance = atEnd ? d3 : d0;
  const lambda = softPositive(1 + distance * curvature, CUSP_FLOOR);
  const gradient = d3 - d0;
  return {
    x: d1.x * lambda + gradient * normalCW.x,
    y: d1.y * lambda + gradient * normalCW.y,
  };
}

/**
 * Construct one side's offset handles for a single cubic skeleton segment.
 *
 * Endpoints are given, not computed: q0 and q3 are the rib positions the
 * generator has already projected. Only the two handles are produced.
 */
export function offsetCubicSide({ p0, p1, p2, p3, d0, d3, q0, q3 }) {
  const chordVector = { x: q3.x - q0.x, y: q3.y - q0.y };
  const chord = Math.hypot(chordVector.x, chordVector.y);
  const chordDirection =
    chord > EPSILON
      ? { x: chordVector.x / chord, y: chordVector.y / chord }
      : { x: 1, y: 0 };

  const startDerivative = offsetEndDerivative(p0, p1, p2, p3, d0, d3, false);
  const endDerivative = offsetEndDerivative(p0, p1, p2, p3, d0, d3, true);

  // Handle directions point into the curve from each endpoint, matching the
  // tangent convention solveHandleLengths expects.
  const u0 = startDerivative
    ? vector.normalizeVector(startDerivative)
    : chordDirection;
  const u1 = endDerivative
    ? vector.normalizeVector({ x: -endDerivative.x, y: -endDerivative.y })
    : { x: -chordDirection.x, y: -chordDirection.y };

  const length0 = startDerivative
    ? Math.hypot(startDerivative.x, startDerivative.y) / 3
    : chord / 3;
  const length1 = endDerivative
    ? Math.hypot(endDerivative.x, endDerivative.y) / 3
    : chord / 3;

  return {
    h1: { x: q0.x + u0.x * length0, y: q0.y + u0.y * length0 },
    h2: { x: q3.x + u1.x * length1, y: q3.y + u1.y * length1 },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: PASS, all cases.

If the two arc tests fail with the handles on the wrong side, the sign convention is inverted: check that `rotateVector90CW` still returns `{x: v.y, y: -v.x}` and that the quarter circle in the test is traversed counter-clockwise.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "feat: closed-form offset construction for cubic segments

Offsetting a cubic preserves tangent direction exactly and scales speed by
(1 + d*curvature), so the endpoints and directions of a one-cubic offset are
known in closed form and only the two handle lengths are free. Computes them
directly instead of fitting samples.

Widths enter per endpoint, including the gradient term that tilts the end
tangent when the two differ - replacing the average-width approximation.

Exact on circular arcs, which the test pins in both directions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Smooth saturation

Two bounds. The cusp floor is already in place from Task 2 (inside `offsetEndDerivative`). This task adds the outer-side bounds: handles may not overshoot the tangent-ray intersection, with the chord ratio as the always-defined backstop.

Both use a polynomial smooth-min that is **exactly** `min(a, b)` outside a blend window, so the "no saturation on ordinary input" invariant is exact rather than approximate.

**Files:**
- Modify: `src-js/fontra-core/src/offset-cubic.js`
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Consumes: `calculateTunniPoint(segmentPoints) → {x, y} | undefined` from `./tunni-calculations.js`. Takes `[p1, p2, p3, p4]` and returns the intersection of the ray from `p1` toward `p2` with the ray from `p4` toward `p3`, or `undefined` when they are parallel.
- Produces: no new exports. `offsetCubicSide`'s return shape is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
import { calculateSegmentTension } from "@fontra/core/tunni-calculations.js";

describe("offset-cubic: tension bound", () => {
  // A tight quarter turn offset well outside its own radius of curvature:
  // lambda = 1 + d*k is large, so the unbounded handles would overshoot.
  const tight = quarterCircle(30);

  it("keeps each handle at or inside the tangent-ray intersection", () => {
    const outer = quarterCircle(110);
    const { h1, h2 } = offsetCubicSide({
      ...tight,
      d0: 80,
      d3: 80,
      q0: outer.p0,
      q3: outer.p3,
    });
    // The intersection of the two end tangents of a quarter circle sits at
    // (r, r); each endpoint is r away from it.
    const limit = 110;
    expect(Math.hypot(h1.x - outer.p0.x, h1.y - outer.p0.y)).to.be.at.most(
      limit + 1e-6
    );
    expect(Math.hypot(h2.x - outer.p3.x, h2.y - outer.p3.y)).to.be.at.most(
      limit + 1e-6
    );
  });

  it("keeps segment tension at or under 1", () => {
    const outer = quarterCircle(110);
    const { h1, h2 } = offsetCubicSide({
      ...tight,
      d0: 80,
      d3: 80,
      q0: outer.p0,
      q3: outer.p3,
    });
    const tension = calculateSegmentTension(h1, outer.p0, h2, outer.p3);
    expect(tension).to.be.at.most(1 + 1e-6);
  });

  it("is exactly inert on an ordinary configuration", () => {
    const source = quarterCircle(100);
    const outer = quarterCircle(115);
    const bounded = offsetCubicSide({
      ...source,
      d0: 15,
      d3: 15,
      q0: outer.p0,
      q3: outer.p3,
    });
    // A quarter circle's handles sit at 0.55 of the distance to the tangent
    // intersection, far outside any blend window, so the bound must not move
    // them at all. Compare against the analytic length 3 handles would have.
    const analytic = 115 * KAPPA;
    expect(Math.hypot(bounded.h1.x - outer.p0.x, bounded.h1.y - outer.p0.y)).to.be.closeTo(
      analytic,
      0.05
    );
  });

  it("falls back to the chord ratio when the end tangents are parallel", () => {
    // An S-curve: both end tangents point the same way, so there is no
    // forward intersection and only the chord backstop applies.
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 40, y: 0 };
    const p2 = { x: -40, y: 60 };
    const p3 = { x: 0, y: 60 };
    const { h1, h2 } = offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0: 10,
      d3: 10,
      q0: { x: 0, y: -10 },
      q3: { x: 10, y: 60 },
    });
    const chord = Math.hypot(10 - 0, 60 - -10);
    expect(Math.hypot(h1.x - 0, h1.y - -10)).to.be.at.most(chord * 2 + 1e-6);
    expect(Math.hypot(h2.x - 10, h2.y - 60)).to.be.at.most(chord * 2 + 1e-6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: the two overshoot tests FAIL — unbounded handles exceed the limit. The inert and parallel cases may already pass.

- [ ] **Step 3: Add the bounds**

In `src-js/fontra-core/src/offset-cubic.js`, add to the imports:

```js
import { calculateTunniPoint } from "./tunni-calculations.js";
```

Add after the `CUSP_FLOOR` constant:

```js
// Blend window for the smooth minimum, as a fraction of the bound being
// approached. Outside the window the bound is exactly inert.
const SMOOTH_MIN_WINDOW = 0.15;

// Backstop when the tangent-ray intersection is unavailable. Same value the
// generator used before, now applied as a smooth minimum rather than a clamp.
const MAX_HANDLE_TO_CHORD_RATIO = 2.0;
```

Add after `softPositive`:

```js
// Polynomial smooth minimum. Exactly min(a, b) when the two differ by more
// than `window`; blends quadratically inside it. C1, so the result has no
// kink in its rate of change as a handle eases into its bound.
function smoothMin(a, b, window) {
  if (!(window > EPSILON)) {
    return Math.min(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.min(a, b) - h * h * window * 0.25;
}

// Signed distance from each endpoint to the intersection of the two end
// tangent rays. Infinity means "no bound": either the tangents are parallel,
// or the intersection lies behind the endpoint.
function tangentIntersectionDistances(q0, u0, q3, u1) {
  const point = calculateTunniPoint([
    q0,
    { x: q0.x + u0.x, y: q0.y + u0.y },
    { x: q3.x + u1.x, y: q3.y + u1.y },
    q3,
  ]);
  if (!point) {
    return { limit0: Infinity, limit1: Infinity };
  }
  const limit0 = (point.x - q0.x) * u0.x + (point.y - q0.y) * u0.y;
  const limit1 = (point.x - q3.x) * u1.x + (point.y - q3.y) * u1.y;
  return {
    limit0: limit0 > EPSILON ? limit0 : Infinity,
    limit1: limit1 > EPSILON ? limit1 : Infinity,
  };
}

// Bound a handle length by the tangent-ray intersection, with the chord ratio
// as the always-defined backstop.
function boundHandleLength(length, limit, chord) {
  const chordCap = Math.max(chord * MAX_HANDLE_TO_CHORD_RATIO, EPSILON);
  let bounded = length;
  if (Number.isFinite(limit)) {
    bounded = smoothMin(bounded, limit, SMOOTH_MIN_WINDOW * limit);
  }
  return smoothMin(bounded, chordCap, SMOOTH_MIN_WINDOW * chordCap);
}
```

In `offsetCubicSide`, replace the `return` block with:

```js
  const { limit0, limit1 } = tangentIntersectionDistances(q0, u0, q3, u1);
  const bounded0 = boundHandleLength(length0, limit0, chord);
  const bounded1 = boundHandleLength(length1, limit1, chord);

  return {
    h1: { x: q0.x + u0.x * bounded0, y: q0.y + u0.y * bounded0 },
    h2: { x: q3.x + u1.x * bounded1, y: q3.y + u1.y * bounded1 },
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: PASS, all cases including the Task 2 arc tests. The arc tests use gentle offsets, so the bound must remain inert for them — if they now fail, `SMOOTH_MIN_WINDOW` is too wide.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "feat: bound generated handles by the tangent-ray intersection

On the outer side of a turn the offset speed factor exceeds 1 and handles
lengthen, so they can overshoot the point where the two end tangents meet.
Bounds each end independently, which implies segment tension <= 1; bounding
the harmonic-mean aggregate instead would not.

Uses a polynomial smooth minimum, exactly inert outside a blend window, so
ordinary configurations are untouched and no bound introduces a kink.

Chord ratio is retained as the backstop for parallel tangents and for
intersections lying behind an endpoint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The correction pass

The closed form has second-order contact at the endpoints but drifts mid-segment when the offset distance approaches the radius of curvature — the regime this whole change targets. One fixed least-squares pass against five fixed samples pins it down. Fixed sample count, fixed single pass, parameterized by source `t`: no adaptive machinery, so continuity survives.

**Files:**
- Modify: `src-js/fontra-core/src/offset-cubic.js`
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Consumes: `solveHandleLengths` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
// Maximum distance from a sampled point on the constructed curve to the true
// offset of the source curve at the same parameter.
function maxOffsetError({ p0, p1, p2, p3, d0, d3, q0, q3 }, h1, h2) {
  const at = (a, b, c, d, t) => {
    const mt = 1 - t;
    return {
      x: mt ** 3 * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t ** 3 * d.x,
      y: mt ** 3 * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t ** 3 * d.y,
    };
  };
  const derivativeAt = (a, b, c, d, t) => {
    const mt = 1 - t;
    return {
      x: 3 * mt * mt * (b.x - a.x) + 6 * mt * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
      y: 3 * mt * mt * (b.y - a.y) + 6 * mt * t * (c.y - b.y) + 3 * t * t * (d.y - c.y),
    };
  };

  let worst = 0;
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const base = at(p0, p1, p2, p3, t);
    const deriv = derivativeAt(p0, p1, p2, p3, t);
    const speed = Math.hypot(deriv.x, deriv.y);
    const normal = { x: deriv.y / speed, y: -deriv.x / speed };
    const distance = d0 + (d3 - d0) * t;
    const truth = {
      x: base.x + normal.x * distance,
      y: base.y + normal.y * distance,
    };
    const built = at(q0, h1, h2, q3, t);
    worst = Math.max(worst, Math.hypot(built.x - truth.x, built.y - truth.y));
  }
  return worst;
}

describe("offset-cubic: correction pass", () => {
  it("tracks the true offset on a strongly tapered side", () => {
    const input = {
      p0: { x: 0, y: 0 },
      p1: { x: 60, y: 90 },
      p2: { x: 180, y: 90 },
      p3: { x: 240, y: 0 },
      d0: 5,
      d3: 70,
      q0: { x: 0, y: -5 },
      q3: { x: 240, y: -70 },
    };
    const { h1, h2 } = offsetCubicSide(input);
    expect(maxOffsetError(input, h1, h2)).to.be.at.most(3);
  });

  it("tracks the true offset at high curvature", () => {
    const source = quarterCircle(40);
    const outer = quarterCircle(70);
    const input = {
      ...source,
      d0: 30,
      d3: 30,
      q0: outer.p0,
      q3: outer.p3,
    };
    const { h1, h2 } = offsetCubicSide(input);
    expect(maxOffsetError(input, h1, h2)).to.be.at.most(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: the tapered case FAILS — endpoint-only matching drifts in the middle when the two widths differ by a factor of 14.

- [ ] **Step 3: Add the correction pass**

In `src-js/fontra-core/src/offset-cubic.js`, add to the imports:

```js
import { solveHandleLengths } from "./fit-cubic.js";
```

Add after the `MAX_HANDLE_TO_CHORD_RATIO` constant:

```js
// Fixed sample parameters for the single correction pass. Fixed count, fixed
// values, fixed one pass: the correction cannot introduce a step function.
const CORRECTION_SAMPLE_TS = [0.125, 0.25, 0.5, 0.75, 0.875];

// The correction is trusted only within this multiplicative band around the
// analytic length, and eased into the band smoothly rather than clamped.
const CORRECTION_BAND_LOW = 0.25;
const CORRECTION_BAND_HIGH = 4;
const CORRECTION_BAND_SOFTNESS = 0.05;
```

Add after `boundHandleLength`:

```js
// A point on the true offset of the source cubic at parameter t.
function offsetPointAt(p0, p1, p2, p3, d0, d3, t) {
  const mt = 1 - t;
  const base = {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
  };
  const deriv = {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
  const speed = Math.hypot(deriv.x, deriv.y);
  if (speed < EPSILON) {
    return base;
  }
  const normalCW = vector.rotateVector90CW({ x: deriv.x / speed, y: deriv.y / speed });
  const distance = d0 + (d3 - d0) * t;
  return { x: base.x + normalCW.x * distance, y: base.y + normalCW.y * distance };
}

// Ease a solved length into a multiplicative band around the analytic length.
// Both edges use the same smooth floor as the cusp bound, so a solve that runs
// negative or wild is absorbed continuously instead of snapping.
function easeIntoBand(solved, analytic) {
  if (!Number.isFinite(solved) || !(analytic > EPSILON)) {
    return analytic;
  }
  const softness = CORRECTION_BAND_SOFTNESS * analytic;
  const low = CORRECTION_BAND_LOW * analytic;
  const high = CORRECTION_BAND_HIGH * analytic;
  const floored = low + softPositive(solved - low, softness);
  return high - softPositive(high - floored, softness);
}
```

In `offsetCubicSide`, insert between the `length1` assignment and the `tangentIntersectionDistances` call:

```js
  const samples = CORRECTION_SAMPLE_TS.map((t) =>
    offsetPointAt(p0, p1, p2, p3, d0, d3, t)
  );
  const { alphaL, alphaR } = solveHandleLengths(
    [q0, ...samples, q3],
    [0, ...CORRECTION_SAMPLE_TS, 1],
    u0,
    u1
  );
  const corrected0 = easeIntoBand(alphaL, length0);
  const corrected1 = easeIntoBand(alphaR, length1);
```

Then change the two `boundHandleLength` calls to use `corrected0` and `corrected1` instead of `length0` and `length1`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS. The whole suite, not just the new file — Task 1 changed a shared module.

The Task 2 arc tests use a 0.01 tolerance. A circular arc's true offset is another circular arc, so the correction should agree with the analytic result to well inside that. If those tests now fail, the sample targets are being computed with the wrong normal sign.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "feat: one fixed correction pass for the offset construction

Endpoint-only matching drifts mid-segment when the offset distance nears the
radius of curvature, or when the two end widths differ sharply. Corrects the
two handle lengths by least squares against five fixed samples of the true
offset, parameterized by source t.

Fixed sample count, fixed single pass, no reparameterization and no error
thresholds, so the correction cannot reintroduce a step function. A solve that
runs negative eases into a band around the analytic length instead of snapping
to a default.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The continuity test suite

This is the acceptance criterion for the whole change. The property is that the construction is a continuous function of its inputs — the thing the current pipeline fails at, and the reason handles jump during a drag.

**Files:**
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Consumes: `offsetCubicSide` as completed in Task 4.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Append to `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
describe("offset-cubic: continuity", () => {
  // Configurations spanning the regime where the old pipeline broke down:
  // short segments relative to width, high curvature, retracted handles.
  const configurations = [
    {
      name: "ordinary curve",
      p0: { x: 0, y: 0 },
      p1: { x: 40, y: 60 },
      p2: { x: 120, y: 60 },
      p3: { x: 160, y: 0 },
      d0: 25,
      d3: 25,
    },
    {
      name: "segment shorter than the stroke width",
      p0: { x: 0, y: 0 },
      p1: { x: 6, y: 9 },
      p2: { x: 18, y: 9 },
      p3: { x: 24, y: 0 },
      d0: 40,
      d3: 40,
    },
    {
      name: "offset near the radius of curvature",
      p0: { x: 0, y: 0 },
      p1: { x: 20, y: 30 },
      p2: { x: 60, y: 30 },
      p3: { x: 80, y: 0 },
      d0: -38,
      d3: -38,
    },
    {
      name: "short generated segment, long skeleton handles",
      p0: { x: 0, y: 0 },
      p1: { x: 90, y: 70 },
      p2: { x: -70, y: 70 },
      p3: { x: 20, y: 0 },
      d0: 30,
      d3: 30,
    },
    {
      name: "strongly tapered width",
      p0: { x: 0, y: 0 },
      p1: { x: 40, y: 50 },
      p2: { x: 120, y: 50 },
      p3: { x: 160, y: 0 },
      d0: 2,
      d3: 60,
    },
    {
      name: "near-retracted start handle",
      p0: { x: 0, y: 0 },
      p1: { x: 0.4, y: 0.3 },
      p2: { x: 100, y: 60 },
      p3: { x: 150, y: 0 },
      d0: 20,
      d3: 20,
    },
  ];

  // Project the rib endpoints the way the generator does, so the perturbation
  // moves the endpoints along with the skeleton rather than pinning them.
  function ribEndpoints(config) {
    const startTangent = {
      x: config.p1.x - config.p0.x,
      y: config.p1.y - config.p0.y,
    };
    const endTangent = { x: config.p3.x - config.p2.x, y: config.p3.y - config.p2.y };
    const unit = (v) => {
      const length = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / length, y: v.y / length };
    };
    const n0 = unit(startTangent);
    const n1 = unit(endTangent);
    return {
      q0: { x: config.p0.x + n0.y * config.d0, y: config.p0.y - n0.x * config.d0 },
      q3: { x: config.p3.x + n1.y * config.d3, y: config.p3.y - n1.x * config.d3 },
    };
  }

  function build(config) {
    return offsetCubicSide({ ...config, ...ribEndpoints(config) });
  }

  const KEYS = ["p0", "p1", "p2", "p3"];
  const AXES = ["x", "y"];
  const EPS = 1e-4;
  // Generous: the point is to catch jumps, which are orders of magnitude
  // larger than any legitimate sensitivity.
  const MAX_GAIN = 2000;

  for (const config of configurations) {
    for (const key of KEYS) {
      for (const axis of AXES) {
        it(`moves smoothly when ${key}.${axis} moves — ${config.name}`, () => {
          const before = build(config);
          const nudged = {
            ...config,
            [key]: { ...config[key], [axis]: config[key][axis] + EPS },
          };
          const after = build(nudged);
          const moved = Math.max(
            Math.hypot(after.h1.x - before.h1.x, after.h1.y - before.h1.y),
            Math.hypot(after.h2.x - before.h2.x, after.h2.y - before.h2.y)
          );
          expect(moved).to.be.at.most(MAX_GAIN * EPS);
        });
      }
    }

    it(`moves smoothly when the width changes — ${config.name}`, () => {
      const before = build(config);
      const after = build({ ...config, d0: config.d0 + EPS, d3: config.d3 + EPS });
      const moved = Math.max(
        Math.hypot(after.h1.x - before.h1.x, after.h1.y - before.h1.y),
        Math.hypot(after.h2.x - before.h2.x, after.h2.y - before.h2.y)
      );
      expect(moved).to.be.at.most(MAX_GAIN * EPS);
    });
  }

  it("has no jump anywhere along a 200-step drag", () => {
    const base = {
      p0: { x: 0, y: 0 },
      p1: { x: 30, y: 45 },
      p2: { x: 90, y: 45 },
      p3: { x: 120, y: 0 },
      d0: 35,
      d3: 35,
    };
    let previous = null;
    let worst = 0;
    for (let step = 0; step <= 200; step++) {
      // March p2 across the segment, sweeping through high curvature and an
      // S-shape on the way.
      const config = {
        ...base,
        p2: { x: 90 - step * 0.8, y: 45 },
      };
      const current = build(config);
      if (previous) {
        worst = Math.max(
          worst,
          Math.hypot(current.h1.x - previous.h1.x, current.h1.y - previous.h1.y),
          Math.hypot(current.h2.x - previous.h2.x, current.h2.y - previous.h2.y)
        );
      }
      previous = current;
    }
    // Each step moves an input by 0.8 units. A well-behaved response moves the
    // handles by a comparable amount; a fit flip moves them by tens of units.
    expect(worst).to.be.at.most(8);
  });
});
```

Note the two exclusions required by the spec: this suite never crosses the 0.5-unit collapsed-side threshold (it calls the construction directly, which the generator only does for non-collapsed sides), and no configuration places the tangent-ray intersection behind an endpoint. Both are intentional step functions.

- [ ] **Step 2: Run the tests**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: PASS.

If a case fails, the failure is real — find which term is discontinuous rather than widening `MAX_GAIN`. Likely suspects in order: a `Math.min`/`Math.max` that should be a smooth minimum, a `Number.isFinite` guard on a value that passes through zero, or `easeIntoBand` receiving a near-zero analytic length.

- [ ] **Step 3: Commit**

```bash
npx prettier --write src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "test: pin the offset construction's continuity

Perturbs every control point and the width across six configurations
spanning the regime the old pipeline broke down in, and asserts the handles
move proportionally. Adds a 200-step drag sweep that asserts no jump.

This is the property the sample-and-fit path lacked and the reason handles
flipped configuration mid-drag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the construction into the generator

Replace the cubic branch's offset-and-fit path with a call to the new module. Preserve the collapsed-side bypass exactly.

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` — imports, and the `addOffsetCurves` helper plus its two call sites inside `generateOffsetPointsForSegment`
- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` (regenerated)

**Interfaces:**
- Consumes: `offsetCubicSide({p0, p1, p2, p3, d0, d3, q0, q3}) → {h1, h2}` from Task 4.
- Produces: no signature changes. Every export of `skeleton-generator.js` keeps its current signature and return shape.

- [ ] **Step 1: Read the current cubic branch end to end**

Read `src-js/fontra-core/src/skeleton-generator.js` from the `} else {` that opens the bezier branch (near line 2590) through the end of `generateOffsetPointsForSegment` (near line 3202). Do not start editing until you can name every consumer of `fixedStartLeft`, `fixedEndLeft`, `fixedStartRight` and `fixedEndRight`.

The three consumers, for reference:
1. `buildGeneratedOnCurve` — the emitted on-curve point. Unchanged.
2. `applyHandleOffsetToControlPoint` — the base for detached handles. Unchanged.
3. The handle construction. This is the only one being replaced.

- [ ] **Step 2: Add the import**

At the top of `src-js/fontra-core/src/skeleton-generator.js`, after the `fit-cubic.js` import:

```js
import { offsetCubicSide } from "./offset-cubic.js";
```

- [ ] **Step 3: Replace the handle computation**

Inside `generateOffsetPointsForSegment`, in the `addOffsetCurves` helper:

Keep unchanged:
- the collapsed-side early return (`isCollapsedSide(sideHalfWidth) && segment.controlPoints.length > 0`) — this is what makes single-sided contours exact
- the `shouldAddStart` / `shouldAddEnd` `buildGeneratedOnCurve` pushes
- the `applyHandleOffsetToControlPoint` calls for `adjustedHandle1` and `adjustedHandle2`
- the `handle1Point` / `handle2Point` construction with `_provenance`
- the final `Math.round` on both handles

Delete from that helper:
- the `if (!curves || curves.length === 0)` straight-line fallback — the construction cannot fail
- the `simplifyOffsetCurves` call and the `simplifiedCurve` block that derives handles from `pts[1]` and `pts[2]` and translates them by `h1Offset` / `h2Offset`
- the `lockNearZeroHandleDirection` calls and the `startNearZeroLock` / `endNearZeroLock` locals
- the `ENABLE_EXPERIMENTAL_HANDLE_STABILIZATION` block and `stabilizedHandles`
- the trailing "Fallback: use original curves without simplification" branch
- every field of the `logSkeletonDebug` payload that reads from the locals above

Replace the handle derivation with:

```js
      const sideSign = isLeftSide ? 1 : -1;
      const constructed = offsetCubicSide({
        p0: segment.startPoint,
        p1: segment.controlPoints[0],
        p2: segment.controlPoints[1] ?? segment.controlPoints[0],
        p3: segment.endPoint,
        d0: sideSign * startHalfWidth,
        d3: sideSign * endHalfWidth,
        q0: fixedStart,
        q3: fixedEnd,
      });
      let adjustedHandle1 = constructed.h1;
      let adjustedHandle2 = constructed.h2;
```

Then remove the now-unused `curves` and `sideHalfWidth` parameters from `addOffsetCurves` and drop the corresponding arguments at both call sites — except `sideHalfWidth`, which the collapsed check still needs. Keep `sideHalfWidth`; remove only `curves`.

Replace the surviving `logSkeletonDebug` payload with:

```js
      logSkeletonDebug(
        { ...debugContext, side },
        {
          stage: "offsetCubicSide",
          startHalfWidth,
          endHalfWidth,
          startHandleLength: Math.hypot(
            adjustedHandle1.x - fixedStart.x,
            adjustedHandle1.y - fixedStart.y
          ),
          endHandleLength: Math.hypot(
            adjustedHandle2.x - fixedEnd.x,
            adjustedHandle2.y - fixedEnd.y
          ),
          chordLength: Math.hypot(fixedEnd.x - fixedStart.x, fixedEnd.y - fixedStart.y),
        }
      );
```

- [ ] **Step 4: Delete the offset calls**

Remove these two lines from the bezier branch (near line 2632):

```js
    const offsetLeftCurves = bezier.offset(-avgLeftHW);
    const offsetRightCurves = bezier.offset(avgRightHW);
```

`avgLeftHW` and `avgRightHW` are still used as the `sideHalfWidth` argument at both `addOffsetCurves` call sites, so keep their assignments. The `bezier` local is still used for the endpoint normals above, so keep it.

- [ ] **Step 5: Run the suite and expect golden-master failures**

Run: `cd src-js/fontra-core && npm test`
Expected: the golden-master cases FAIL with coordinate differences in handle positions only. On-curve coordinates must be identical — if any on-curve point moved, an endpoint consumer was disturbed and the change is wrong. Stop and fix before regenerating.

Every non-golden-master test must pass, including `test-skeleton-interpolation.js` and the provenance cases.

- [ ] **Step 6: Verify point counts are unchanged**

Before regenerating, confirm the structure is identical and only coordinates moved:

```bash
cd src-js/fontra-core && node -e "
const fs = require('fs');
import('./src/skeleton-generator.js').then(async (mod) => {
  const fixtures = JSON.parse(fs.readFileSync('tests/data/skeleton-generator/fixtures.json', 'utf8'));
  let bad = 0;
  for (const fixture of fixtures) {
    const result = mod.generateFromSkeleton(fixture.canonical);
    if (result.contours.length !== fixture.expectedContours.length) {
      console.log('CONTOUR COUNT', fixture.name);
      bad++;
      continue;
    }
    for (let i = 0; i < result.contours.length; i++) {
      if (result.contours[i].points.length !== fixture.expectedContours[i].points.length) {
        console.log('POINT COUNT', fixture.name, i,
          result.contours[i].points.length, '!=', fixture.expectedContours[i].points.length);
        bad++;
      }
    }
  }
  console.log(bad === 0 ? 'POINT COUNTS UNCHANGED' : bad + ' MISMATCHES');
});
"
```

Expected: `POINT COUNTS UNCHANGED`. Anything else breaks cross-master interpolation — stop and fix.

- [ ] **Step 7: Regenerate the golden masters**

```bash
cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js
git add .
git commit -m "feat: generate outline handles by construction instead of fitting

The cubic branch offset each side with bezier-js, sampled the resulting
subcurves and refitted them to a single cubic under an adaptive error
threshold. Every stage of that was a step function - the subcurve partition,
the sample set derived from it, the iteration count, the threshold index -
so a one-unit move of a skeleton point could land on a completely different
handle configuration.

Computes the handles directly instead. Endpoints, provenance, point counts
and the collapsed-side bypass are unchanged; only handle coordinates move.

Golden masters regenerated: they no longer match donor output, which is
deliberate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Remove the superseded code

Everything deleted here is unreachable after Task 6 or was already dead.

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. No exported symbol is removed.

- [ ] **Step 1: Confirm each symbol is unreferenced**

```bash
cd src-js && for sym in simplifyOffsetCurves stabilizeSingleCubicHandles lockNearZeroHandleDirection getMinimumGridStepFromDirection alignHandleDirections clampNearZeroDirection rotateDirection SIMPLIFY_OFFSET_CURVES SAMPLES_PER_CURVE MIN_ERROR_PERCENT MAX_ERROR_PERCENT ERROR_STEP_PERCENT NEAR_ZERO_HANDLE_THRESHOLD NEAR_ZERO_HANDLE_TARGET MAX_NEAR_ZERO_ROTATION_DEG ENABLE_EXPERIMENTAL_HANDLE_STABILIZATION; do
  echo "$sym: $(grep -rn "$sym" --include=*.js . | grep -v node_modules | wc -l)"
done