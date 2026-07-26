# Skeleton Offset Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sample-and-fit offset path for cubic skeleton segments with a closed-form construction, so generated outline handle *lengths* are a continuous function of the skeleton.

**Architecture:** Generated handle direction is already locked to the skeleton handle direction and stays that way — only the length changes, from fitted to constructed. Length is the skeleton handle length scaled by `λ = 1 + d·κ`, corrected by one fixed least-squares pass, then bounded. No `reduce()`, no adaptive thresholds, no iteration counts.

**Tech Stack:** JavaScript ES modules, mocha + chai, bezier-js (retained for unrelated call sites only).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-26-skeleton-offset-construction-design.md`. Read it before Task 1.
- Test command: `cd src-js/fontra-core && npm test`. Single-file: `npx mocha tests/<file> --extension js`.
- Do **not** run `npm run bundle`. The user runs bundle-watch and reports compile errors. This knowingly relaxes rail R-G.
- Run `npx prettier --write` on every touched file before committing.
- Exactly one cubic per side per segment. Cross-master interpolation depends on it.
- Rail R-B: one copy of every constant and geometry function.
- **Sign convention**, verified 2026-07-26: `rotateVector90CW(v) = (v.y, −v.x)`; left side is `+halfWidth` along it, right is `−halfWidth`; `κ = cross(B′,B″)/|B′|³`. Therefore **`λ = 1 + d·κ`**. Getting this backwards inverts everything while still looking plausible.
- **Handle direction never changes.** It is `getSkeletonHandleDirection`, exactly as today. Any diff showing a direction change is a bug.
- Three intentional discontinuities must survive, and no continuity test may span them: the 0.5-unit collapsed-side threshold; the forward/behind flip of the tangent-ray intersection; and grid rounding at emission.

## File Structure

| File | Responsibility |
|------|----------------|
| `src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js` | Fixed in Task 1 to record this generator's own output. |
| `src-js/fontra-core/src/fit-cubic.js` | Gains `solveHandleLengths`. `generateBezier` behavior unchanged. |
| `src-js/fontra-core/src/offset-cubic.js` | **NEW.** The construction. Pure, no state, no `Bezier` objects of its own. |
| `src-js/fontra-core/tests/test-offset-cubic.js` | **NEW.** Unit tests. |
| `src-js/fontra-core/src/skeleton-generator.js` | Cubic branch calls the new module. Dead code removed. |
| `src-js/fontra-core/tests/test-skeleton-generator.js` | Collapsed-side test, end-to-end continuity sweep, suite retitled. |
| `docs/superpowers/SKELETON-FEATURE-MODEL.md` | Pipeline description updated. |

---

### Task 1: Make the fixture script able to regenerate

Nothing in this plan can be verified until this works.

The script is a leftover from the porting era: it runs the pre-port generator and transcribes *its* output as the expected answer. Three problems, any one fatal:

- it imports that generator from `../../../../skeleton/…`, which resolves to `<repo>/skeleton` and does not exist
- the checkout it means, `_external/skeleton`, is **gitignored** — so the script cannot be run from a fresh clone, by anyone else, or in CI
- `CAP_REFERENCE_COMMIT` is not an object in this repo

Nothing here needs preserving. Porting is finished and no parity with the pre-port code is being maintained. The committed values are simply the outlines the generator emits today — the suite passes, so they already agree. The script just needs to record that.

**Files:**
- Modify: `src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js:1-8`, `:225-235`

**Interfaces:**
- Consumes: nothing.
- Produces: a script that regenerates `fixtures.json` from `generateContoursFromSkeleton` in `src-js/fontra-core/src/skeleton-generator.js`.

- [ ] **Step 1: Confirm the script is broken as described**

```bash
cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js
```
Expected: FAIL — module not found for `../../../../skeleton/…`.

- [ ] **Step 2: Point it at forkra's generator**

Replace the import at `:1-8`:

```js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Fixtures record this generator's own output. Until 2026-07-26 this script ran
// the pre-port generator out of a gitignored checkout, which meant it could not
// be run outside one developer's machine.
import { generateContoursFromSkeleton } from "../../src/skeleton-generator.js";
```

`execSync` and `pathToFileURL` become unused — remove them from the import list.

- [ ] **Step 3: Generate from the canonical input**

Replace the generation block near `:225`:

```js
for (const fixture of fixtures) {
  fixture.donorInput = canonicalToDonor(fixture.canonical);
  fixture.expectedContours = generateContoursFromSkeleton(fixture.canonical);
}
```

`donorInput` is kept in the JSON for archaeology — it is not used to generate.

Delete `CAP_REFERENCE_COMMIT`, `capReferenceDir`, `loadCapReferenceGenerator`, the `generateCapReferenceContours` assignment, and the trailing `fs.rmSync(capReferenceDir, …)`. Leave each fixture's `capReference: true` field in place; it is now inert metadata recording which fixtures came from the reworked cap branch.

- [ ] **Step 4: Verify the script reproduces current behavior exactly**

This is the acceptance test. Run the fixed script **before any geometry changes**; the output must be byte-identical to what is committed.

```bash
cd src-js/fontra-core && cp tests/data/skeleton-generator/fixtures.json /tmp/fixtures-before.json
node tests/scripts/make-skeleton-generator-fixtures.js
git diff --stat tests/data/skeleton-generator/fixtures.json
```

Expected: **no diff**. If the file changed, the generator and the recorded values already disagree somewhere, and that has nothing to do with this change — do not let it ride along. Investigate and report rather than accepting the new values.

- [ ] **Step 5: Run the suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js
git add .
git commit -m "fix: generate skeleton fixtures from this generator, not the pre-port one

The script was a leftover from the port: it ran the pre-port generator and
transcribed its output as the expected answer. It could not run at all - the
path it imported does not exist, the checkout it meant is gitignored so no
fresh clone or CI could reach it, and its cap-reference commit is not an object
in this repo.

Porting is finished and no parity with the pre-port code is maintained. The
committed values are just the outlines this generator emits, so the script now
records that directly. Verified byte-identical to the committed fixtures before
any geometry change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract the least-squares solve

`generateBezier` solves the two-handle-length problem the construction needs, but discards both solved handles for `segLength/3` whenever either comes out non-positive. Extract the solve so the new module can apply its own smooth fallback, leaving `generateBezier` identical for its three importers.

**Files:**
- Modify: `src-js/fontra-core/src/fit-cubic.js:20-72`
- Test: `src-js/fontra-core/tests/test-fit-cubic.js`

**Interfaces:**
- Produces: `solveHandleLengths(points, parameters, leftTangent, rightTangent) → {alphaL, alphaR}`. `points` is `{x,y}[]` whose first and last are the endpoints; `parameters` a parallel number array in [0,1]; tangents unit vectors pointing *into* the curve from each endpoint. Returns `{alphaL: 0, alphaR: 0}` when the normal equations are singular.

- [ ] **Step 1: Write the failing test**

Add `solveHandleLengths` to the existing import list in `src-js/fontra-core/tests/test-fit-cubic.js`, then append:

```js
describe("solveHandleLengths", () => {
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

  it("returns the alphas generateBezier places its control points at", () => {
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
    const { alphaL, alphaR } = solveHandleLengths(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [0, 0.5, 1],
      { x: 1, y: 0 },
      { x: -1, y: 0 }
    );
    expect(alphaL).to.equal(0);
    expect(alphaR).to.equal(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-fit-cubic.js --extension js`
Expected: FAIL. Because the missing export is a link-time error, **every** test in the file fails with a `SyntaxError` about `solveHandleLengths` not being exported — not just the new ones.

- [ ] **Step 3: Extract**

Replace `generateBezier` (`:20-72`) with:

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

Pure move. No arithmetic changes. No import changes needed.

- [ ] **Step 4: Run the full suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS, including the pre-existing `generateBezier` and `fitCubic` cases with their hardcoded values. If either shifted, the extraction was not faithful.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/fit-cubic.js src-js/fontra-core/tests/test-fit-cubic.js
git add .
git commit -m "refactor: expose the two-handle least-squares solve from fit-cubic

generateBezier discards both solved handle lengths for a chord/3 default
whenever either comes out non-positive. The offset construction needs the raw
solve so it can ease into a band instead. Pure extraction - generateBezier's
behavior is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The construction

Endpoint curvature and the analytic handle length, with the cusp floor. No correction and no bounds yet.

**Files:**
- Create: `src-js/fontra-core/src/offset-cubic.js`
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Produces:
  - `endpointCurvature(p0, p1, p2, p3, atEnd) → number` — signed curvature at `t=0` (`atEnd` false) or `t=1`. Returns `0` for a degenerate end tangent.
  - `offsetCubicSide({p0, p1, p2, p3, d0, d3, q0, q3, u0, u1}) → {startLength, endLength}` — `d0`/`d3` signed offset distances (positive along the clockwise normal); `q0`/`q3` the rounded rib endpoints; `u0`/`u1` the locked handle directions, unit, pointing into the curve.

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
import { endpointCurvature, offsetCubicSide } from "@fontra/core/offset-cubic.js";
import { expect } from "chai";

const KAPPA = 0.5522847498307933;

// Cubic approximation of a quarter circle, radius r, centre at the origin,
// from (r,0) to (0,r), travelling counter-clockwise.
function quarterCircle(r) {
  return {
    p0: { x: r, y: 0 },
    p1: { x: r, y: r * KAPPA },
    p2: { x: r * KAPPA, y: r },
    p3: { x: 0, y: r },
  };
}

// A Bezier quarter circle is NOT a circle. Its endpoint curvature is
// 2(1-K)/(3 K^2 r), about 0.0097855 at r=100 - not 1/r.
function arcEndpointCurvature(r) {
  return (2 * (1 - KAPPA)) / (3 * KAPPA ** 2 * r);
}

describe("offset-cubic: endpointCurvature", () => {
  it("matches the closed form at both ends of an arc", () => {
    const { p0, p1, p2, p3 } = quarterCircle(100);
    const expected = arcEndpointCurvature(100);
    expect(endpointCurvature(p0, p1, p2, p3, false)).to.be.closeTo(expected, 1e-9);
    expect(endpointCurvature(p0, p1, p2, p3, true)).to.be.closeTo(expected, 1e-9);
  });

  it("is positive for a counter-clockwise arc and negative for clockwise", () => {
    const ccw = quarterCircle(100);
    expect(endpointCurvature(ccw.p0, ccw.p1, ccw.p2, ccw.p3, false)).to.be.above(0);
    expect(endpointCurvature(ccw.p3, ccw.p2, ccw.p1, ccw.p0, false)).to.be.below(0);
  });

  it("is zero on a straight segment", () => {
    expect(
      endpointCurvature(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        false
      )
    ).to.be.closeTo(0, 1e-9);
  });

  it("is zero when the end tangent is degenerate", () => {
    const p0 = { x: 0, y: 0 };
    expect(endpointCurvature(p0, p0, { x: 10, y: 5 }, { x: 20, y: 0 }, false)).to.equal(
      0
    );
  });
});

describe("offset-cubic: analytic length", () => {
  // Directions for a quarter circle: +y at the start, +x at the end (pointing
  // into the curve from (0,r)).
  const u0 = { x: 0, y: 1 };
  const u1 = { x: 1, y: 0 };

  function lengthsFor(sourceRadius, d) {
    const source = quarterCircle(sourceRadius);
    const outer = quarterCircle(sourceRadius + d);
    return offsetCubicSide({
      ...source,
      d0: d,
      d3: d,
      q0: outer.p0,
      q3: outer.p3,
      u0,
      u1,
    });
  }

  it("scales the skeleton handle by 1 + d*curvature, outward", () => {
    const k = arcEndpointCurvature(100);
    const expected = 100 * KAPPA * (1 + 20 * k);
    const { startLength, endLength } = lengthsFor(100, 20);
    expect(startLength).to.be.closeTo(expected, 0.01);
    expect(endLength).to.be.closeTo(expected, 0.01);
  });

  it("scales the skeleton handle by 1 + d*curvature, inward", () => {
    const k = arcEndpointCurvature(100);
    const expected = 100 * KAPPA * (1 - 20 * k);
    const { startLength, endLength } = lengthsFor(100, -20);
    expect(startLength).to.be.closeTo(expected, 0.01);
    expect(endLength).to.be.closeTo(expected, 0.01);
  });

  it("reproduces the skeleton handle length at zero offset", () => {
    const { startLength, endLength } = lengthsFor(100, 0);
    expect(startLength).to.be.closeTo(100 * KAPPA, 0.01);
    expect(endLength).to.be.closeTo(100 * KAPPA, 0.01);
  });
});

describe("offset-cubic: degenerate inputs", () => {
  const cases = {
    "retracted start handle": [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ],
    "retracted end handle": [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
    ],
    "all four coincident": [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ],
    "collinear control polygon": [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ],
  };

  for (const [name, [p0, p1, p2, p3]] of Object.entries(cases)) {
    it(`produces finite lengths for ${name}`, () => {
      const { startLength, endLength } = offsetCubicSide({
        p0,
        p1,
        p2,
        p3,
        d0: 25,
        d3: 25,
        q0: { x: p0.x, y: p0.y + 25 },
        q3: { x: p3.x, y: p3.y + 25 },
        u0: { x: 1, y: 0 },
        u1: { x: -1, y: 0 },
      });
      expect(Number.isFinite(startLength), `${name} start`).to.equal(true);
      expect(Number.isFinite(endLength), `${name} end`).to.equal(true);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: FAIL — cannot resolve `@fontra/core/offset-cubic.js`.

- [ ] **Step 3: Write the module**

Create `src-js/fontra-core/src/offset-cubic.js`:

```js
// Floor on the offset speed factor lambda, as a fraction of the un-offset
// handle length. A handle far past the cusp keeps this fraction rather than
// collapsing.
const CUSP_FLOOR = 0.02;

// Blend window for every smooth min/max in this module, so each bound is
// EXACTLY inert outside its window. Do not substitute a sqrt-based soft floor:
// that form is never exactly inert, shifts lambda by c^2/lambda, and the shift
// scales with handle length - 0.022 units on a 55-unit handle at c = 0.02.
const CUSP_FLOOR_WINDOW = 0.1;

const EPSILON = 1e-9;

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Polynomial smooth minimum: exactly min(a, b) when they differ by more than
// `window`, blending quadratically inside it. C1 at the join.
function smoothMin(a, b, window) {
  if (!(window > EPSILON) || !Number.isFinite(b)) {
    return Math.min(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.min(a, b) - h * h * window * 0.25;
}

// Mirror of smoothMin: exactly max(a, b) outside the window.
function smoothMax(a, b, window) {
  if (!(window > EPSILON) || !Number.isFinite(b)) {
    return Math.max(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.max(a, b) + h * h * window * 0.25;
}

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
 * Signed curvature of a cubic at one endpoint. Positive when the centre of
 * curvature lies along the counter-clockwise normal.
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
 * Handle lengths for one side of one cubic skeleton segment.
 *
 * Offsetting preserves tangent direction and scales speed by
 * lambda = 1 + d*curvature, with d signed positive along the clockwise normal.
 * Direction is supplied by the caller and is not changed here; only the length
 * is computed.
 */
export function offsetCubicSide({ p0, p1, p2, p3, d0, d3, q0, q3, u0, u1 }) {
  const startHandle = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const endHandle = Math.hypot(p3.x - p2.x, p3.y - p2.y);

  const startLambda = smoothMax(
    1 + d0 * endpointCurvature(p0, p1, p2, p3, false),
    CUSP_FLOOR,
    CUSP_FLOOR_WINDOW
  );
  const endLambda = smoothMax(
    1 + d3 * endpointCurvature(p0, p1, p2, p3, true),
    CUSP_FLOOR,
    CUSP_FLOOR_WINDOW
  );

  return {
    startLength: startHandle * startLambda,
    endLength: endHandle * endLambda,
  };
}
```

`q0`, `q3`, `u0`, `u1` are unused at this stage. Keep them in the signature — Tasks 4 and 5 use them, and changing the signature later would churn the call site.

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: PASS.

If the outward and inward cases are swapped, the sign convention is inverted — recheck `rotateVector90CW` and that the test's quarter circle runs counter-clockwise.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "feat: closed-form handle length for offset cubic segments

Offsetting a cubic preserves tangent direction and scales speed by
1 + d*curvature, so with direction already locked to the skeleton handle the
generated handle length follows in closed form from the skeleton handle length
and the endpoint curvature.

Widths enter per endpoint rather than as an average.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Bounds

Three, applied after the construction: the tension ceiling (instrumented, not yet trusted), the chord backstop, and the minimum-length guardrail carried over from the code being deleted.

**Files:**
- Modify: `src-js/fontra-core/src/offset-cubic.js`
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Consumes: `calculateTunniPoint(segmentPoints) → {x,y} | undefined` from `./tunni-calculations.js` — takes `[p1,p2,p3,p4]`, returns where the ray `p1→p2` meets the ray `p4→p3`, or `undefined` if parallel.
- Produces: `tensionBoundStats` — a mutable `{evaluated, active}` counter, exported for Task 9's measurement. `resetTensionBoundStats()` zeroes it.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
import {
  resetTensionBoundStats,
  tensionBoundStats,
} from "@fontra/core/offset-cubic.js";

describe("offset-cubic: bounds", () => {
  // A short chord with a large outer-side offset - the only shape that can
  // actually push a handle past the tangent-ray intersection. A quarter circle
  // never can: r*K + 0.54d < r + d always.
  const tight = {
    p0: { x: 0, y: 0 },
    p1: { x: 8, y: 26 },
    p2: { x: 32, y: 26 },
    p3: { x: 40, y: 0 },
  };

  it("never lets a handle overshoot the tangent-ray intersection", () => {
    const q0 = { x: -60, y: 0 };
    const q3 = { x: 100, y: 0 };
    const u0 = { x: 0, y: 1 };
    const u1 = { x: 0, y: 1 };
    const { startLength } = offsetCubicSide({
      ...tight,
      d0: 60,
      d3: 60,
      q0,
      q3,
      u0,
      u1,
    });
    // Both directions are +y, so the rays are parallel and the bound is inert;
    // the chord backstop must still hold.
    expect(startLength).to.be.at.most(
      2 * Math.hypot(q3.x - q0.x, q3.y - q0.y) + 1e-6
    );
  });

  it("floors every handle at one unit", () => {
    // lambda driven hard negative: offset far past the radius of curvature.
    const { startLength, endLength } = offsetCubicSide({
      p0: { x: 0, y: 0 },
      p1: { x: 6, y: 9 },
      p2: { x: 18, y: 9 },
      p3: { x: 24, y: 0 },
      d0: -40,
      d3: -40,
      q0: { x: 0, y: 40 },
      q3: { x: 24, y: 40 },
      u0: { x: 1, y: 0 },
      u1: { x: -1, y: 0 },
    });
    expect(startLength).to.be.at.least(1);
    expect(endLength).to.be.at.least(1);
  });

  it("is exactly inert on an ordinary configuration", () => {
    resetTensionBoundStats();
    const source = quarterCircle(100);
    const outer = quarterCircle(115);
    const k = (2 * (1 - KAPPA)) / (3 * KAPPA ** 2 * 100);
    const { startLength } = offsetCubicSide({
      ...source,
      d0: 15,
      d3: 15,
      q0: outer.p0,
      q3: outer.p3,
      u0: { x: 0, y: 1 },
      u1: { x: 1, y: 0 },
    });
    expect(startLength).to.be.closeTo(100 * KAPPA * (1 + 15 * k), 0.01);
    expect(tensionBoundStats.active).to.equal(0);
  });

  it("counts evaluations and activations", () => {
    resetTensionBoundStats();
    const source = quarterCircle(100);
    offsetCubicSide({
      ...source,
      d0: 10,
      d3: 10,
      q0: { x: 110, y: 0 },
      q3: { x: 0, y: 110 },
      u0: { x: 0, y: 1 },
      u1: { x: 1, y: 0 },
    });
    expect(tensionBoundStats.evaluated).to.equal(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: FAIL — `resetTensionBoundStats` is not exported, so the whole file fails to link.

- [ ] **Step 3: Add the bounds**

Add to the top of `src-js/fontra-core/src/offset-cubic.js`:

```js
import { calculateTunniPoint } from "./tunni-calculations.js";
```

Add after `CUSP_FLOOR`:

```js
// Blend window for the smooth minimum, as a fraction of the bound being
// approached. Outside the window the bound is exactly inert.
const SMOOTH_MIN_WINDOW = 0.15;

// Always-defined backstop. Same value the generator used before, applied as a
// smooth minimum rather than a hard clamp.
const MAX_HANDLE_TO_CHORD_RATIO = 2.0;

// Carried over from getMinimumGridStepFromDirection, which guaranteed a step of
// one unit on X, on Y, or on both. With direction locked, a one-unit length
// gives the identical guarantee: some component is always >= 0.71, so it always
// survives rounding on some axis - without quantizing the direction.
const MIN_HANDLE_LENGTH = 1;
const MIN_HANDLE_WINDOW = 0.5;

/**
 * Activation counter for the tension bound. The bound is a guard, not a shaper:
 * offsetting a circular arc preserves tension exactly, so it provably cannot
 * fire in the clean case. Measured before deciding whether to keep it - see the
 * spec's 4.5.
 */
export const tensionBoundStats = { evaluated: 0, active: 0 };

export function resetTensionBoundStats() {
  tensionBoundStats.evaluated = 0;
  tensionBoundStats.active = 0;
}
```

Add after `smoothMax` (both smooth helpers already exist from Task 3 — do not redefine them):

```js
// Distance from each endpoint to the intersection of the two handle rays.
// Infinity means no bound: parallel rays, or an intersection behind the
// endpoint.
function tangentIntersectionDistances(q0, u0, q3, u1) {
  const point = calculateTunniPoint([
    q0,
    { x: q0.x + u0.x, y: q0.y + u0.y },
    { x: q3.x + u1.x, y: q3.y + u1.y },
    q3,
  ]);
  if (!point) {
    return { startLimit: Infinity, endLimit: Infinity };
  }
  const startLimit = (point.x - q0.x) * u0.x + (point.y - q0.y) * u0.y;
  const endLimit = (point.x - q3.x) * u1.x + (point.y - q3.y) * u1.y;
  return {
    startLimit: startLimit > EPSILON ? startLimit : Infinity,
    endLimit: endLimit > EPSILON ? endLimit : Infinity,
  };
}

function boundLength(length, limit, chord) {
  let bounded = length;
  tensionBoundStats.evaluated += 1;
  if (Number.isFinite(limit)) {
    const tensioned = smoothMin(bounded, limit, SMOOTH_MIN_WINDOW * limit);
    if (tensioned < bounded - EPSILON) {
      tensionBoundStats.active += 1;
    }
    bounded = tensioned;
  }
  const chordCap = Math.max(chord * MAX_HANDLE_TO_CHORD_RATIO, EPSILON);
  bounded = smoothMin(bounded, chordCap, SMOOTH_MIN_WINDOW * chordCap);
  return smoothMax(bounded, MIN_HANDLE_LENGTH, MIN_HANDLE_WINDOW);
}
```

Replace `offsetCubicSide`'s return with:

```js
  const chord = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const { startLimit, endLimit } = tangentIntersectionDistances(q0, u0, q3, u1);

  return {
    startLength: boundLength(startHandle * startLambda, startLimit, chord),
    endLength: boundLength(endHandle * endLambda, endLimit, chord),
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: PASS, including Task 3's analytic-length cases. Those use gentle offsets, so all three bounds must stay inert for them — if they now fail, the blend window or the length floor is too aggressive.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "feat: bound generated handle length

Three bounds after the construction: a tension ceiling so a handle cannot
overshoot the tangent-ray intersection, the existing chord ratio as the
always-defined backstop, and a one-unit floor.

The floor carries over the guarantee from getMinimumGridStepFromDirection,
which reached it by snapping direction to one of eight axis-aligned steps. With
direction locked, a one-unit length gives the same guarantee without
quantizing anything.

The tension ceiling ships with an activation counter rather than a floor
constant. Offsetting a circular arc preserves tension exactly, so the bound may
never fire in practice; measure before keeping it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The correction pass

The construction matches the true offset's position and first derivative at the ends, but drifts mid-segment when `|d·κ|` is large or the widths taper. One fixed least-squares pass against five fixed samples fixes that, with no adaptive machinery.

**Files:**
- Modify: `src-js/fontra-core/src/offset-cubic.js`
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

**Interfaces:**
- Consumes: `solveHandleLengths` from Task 2.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
// Worst distance from the constructed curve to the true offset of the source,
// compared at the same parameter.
function maxOffsetError({ p0, p1, p2, p3, d0, d3, q0, q3, u0, u1 }, lengths) {
  const at = (a, b, c, d, t) => {
    const mt = 1 - t;
    return {
      x: mt ** 3 * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t ** 3 * d.x,
      y: mt ** 3 * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t ** 3 * d.y,
    };
  };
  const deriv = (a, b, c, d, t) => {
    const mt = 1 - t;
    return {
      x: 3 * mt * mt * (b.x - a.x) + 6 * mt * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
      y: 3 * mt * mt * (b.y - a.y) + 6 * mt * t * (c.y - b.y) + 3 * t * t * (d.y - c.y),
    };
  };
  const h1 = { x: q0.x + u0.x * lengths.startLength, y: q0.y + u0.y * lengths.startLength };
  const h2 = { x: q3.x + u1.x * lengths.endLength, y: q3.y + u1.y * lengths.endLength };

  let worst = 0;
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const base = at(p0, p1, p2, p3, t);
    const dv = deriv(p0, p1, p2, p3, t);
    const speed = Math.hypot(dv.x, dv.y);
    const normalCW = { x: dv.y / speed, y: -dv.x / speed };
    const distance = d0 + (d3 - d0) * t;
    const truth = {
      x: base.x + normalCW.x * distance,
      y: base.y + normalCW.y * distance,
    };
    const built = at(q0, h1, h2, q3, t);
    worst = Math.max(worst, Math.hypot(built.x - truth.x, built.y - truth.y));
  }
  return worst;
}

// Rib endpoint and handle direction derived from the curve itself, the way the
// generator derives them. Endpoints placed anywhere else are not offsets of the
// source and make maxOffsetError meaningless.
function ribInputs(p0, p1, p2, p3, d0, d3) {
  const unit = (v) => {
    const length = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / length, y: v.y / length };
  };
  const startTangent = unit({ x: p1.x - p0.x, y: p1.y - p0.y });
  const endTangent = unit({ x: p3.x - p2.x, y: p3.y - p2.y });
  const n0 = { x: startTangent.y, y: -startTangent.x };
  const n1 = { x: endTangent.y, y: -endTangent.x };
  return {
    q0: { x: p0.x + n0.x * d0, y: p0.y + n0.y * d0 },
    q3: { x: p3.x + n1.x * d3, y: p3.y + n1.y * d3 },
    u0: startTangent,
    u1: { x: -endTangent.x, y: -endTangent.y },
  };
}

describe("offset-cubic: correction pass", () => {
  it("tracks the true offset on a strongly tapered side", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 60, y: 90 };
    const p2 = { x: 180, y: 90 };
    const p3 = { x: 240, y: 0 };
    const input = { p0, p1, p2, p3, d0: 5, d3: 70, ...ribInputs(p0, p1, p2, p3, 5, 70) };
    expect(maxOffsetError(input, offsetCubicSide(input))).to.be.at.most(3);
  });

  it("tracks the true offset at high curvature", () => {
    const { p0, p1, p2, p3 } = quarterCircle(40);
    const input = { p0, p1, p2, p3, d0: 30, d3: 30, ...ribInputs(p0, p1, p2, p3, 30, 30) };
    expect(maxOffsetError(input, offsetCubicSide(input))).to.be.at.most(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: the tapered case FAILS. Endpoint-only matching drifts in the middle when the widths differ by a factor of 14.

- [ ] **Step 3: Add the correction**

Add to the imports:

```js
import { solveHandleLengths } from "./fit-cubic.js";
```

Add after `MIN_HANDLE_SOFTNESS`:

```js
// Fixed sample parameters for the single correction pass. Fixed count, fixed
// values, fixed one pass: the correction cannot introduce a step function.
const CORRECTION_SAMPLE_TS = [0.125, 0.25, 0.5, 0.75, 0.875];

// The solve is trusted only within this multiplicative band around the analytic
// length, eased in rather than clamped. The band uses the same exactly-inert
// smooth min/max as every other bound, so a solve comfortably inside the band
// passes through untouched - no systematic bias.
const CORRECTION_BAND_LOW = 0.25;
const CORRECTION_BAND_HIGH = 4;
const CORRECTION_BAND_WINDOW = 0.05;
```

Add after `boundLength`:

```js
// A point on the true offset of the source cubic at parameter t.
function offsetPointAt(p0, p1, p2, p3, d0, d3, t) {
  const mt = 1 - t;
  const base = {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
  };
  const deriv = {
    x:
      3 * mt * mt * (p1.x - p0.x) +
      6 * mt * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * mt * mt * (p1.y - p0.y) +
      6 * mt * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
  };
  const speed = Math.hypot(deriv.x, deriv.y);
  if (speed < EPSILON) {
    return base;
  }
  const normalCW = { x: deriv.y / speed, y: -deriv.x / speed };
  const distance = d0 + (d3 - d0) * t;
  return { x: base.x + normalCW.x * distance, y: base.y + normalCW.y * distance };
}

// Ease a solved length into a multiplicative band around the analytic length.
// Both edges use the module's smooth min/max, so a solve inside the band passes
// through exactly and one that runs negative is absorbed continuously instead of
// snapping to a default.
function easeIntoBand(solved, analytic) {
  if (!Number.isFinite(solved) || !(analytic > EPSILON)) {
    return analytic;
  }
  const window = CORRECTION_BAND_WINDOW * analytic;
  const low = CORRECTION_BAND_LOW * analytic;
  const high = CORRECTION_BAND_HIGH * analytic;
  return smoothMin(smoothMax(solved, low, window), high, window);
}
```

In `offsetCubicSide`, insert before the `chord` line:

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
  const correctedStart = easeIntoBand(alphaL, startHandle * startLambda);
  const correctedEnd = easeIntoBand(alphaR, endHandle * endLambda);
```

and change the return to bound `correctedStart` / `correctedEnd` instead of the raw products.

- [ ] **Step 4: Run the full suite**

Run: `cd src-js/fontra-core && npm test`

Task 3's analytic cases assert the closed-form length to ±0.01. **The correction pass is expected to move those values** — that is its whole purpose: the true offset of a Bézier quarter-circle is not itself a Bézier arc, so the best-fit lengths differ slightly from the closed form. A shift there is correct behavior, not a regression.

So: if those three cases now fail, read the actual numbers before changing anything.

- **Shift under ~0.5 units, same sign, outward still longer than inward** — expected. Retarget those three assertions to the post-correction values, and add a comment saying the closed form is asserted at Task 3's stage and the correction refines it. Keep the tolerance tight.
- **Outward and inward swapped, or a shift of several units** — the sample targets are using the wrong normal sign. Fix that, do not retarget.

The `endpointCurvature` and degenerate-input cases must pass unchanged either way.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "feat: one fixed correction pass for the offset construction

The closed form matches the true offset's position and first derivative at the
ends, but drifts mid-segment when the offset distance nears the radius of
curvature or the two widths differ sharply. Corrects the two lengths by least
squares against five fixed samples, parameterized by source t.

Fixed sample count, fixed single pass, no reparameterization and no error
thresholds. A solve that runs negative eases into a band around the analytic
length instead of snapping to a default.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Continuity

The acceptance criterion. The property the current pipeline lacks.

**Files:**
- Test: `src-js/fontra-core/tests/test-offset-cubic.js`

- [ ] **Step 1: Write the test**

Append to `src-js/fontra-core/tests/test-offset-cubic.js`:

```js
describe("offset-cubic: continuity", () => {
  const configurations = [
    {
      name: "ordinary curve",
      pts: [
        { x: 0, y: 0 },
        { x: 40, y: 60 },
        { x: 120, y: 60 },
        { x: 160, y: 0 },
      ],
      d: 25,
    },
    {
      name: "segment shorter than the stroke width",
      pts: [
        { x: 0, y: 0 },
        { x: 6, y: 9 },
        { x: 18, y: 9 },
        { x: 24, y: 0 },
      ],
      d: 40,
    },
    {
      name: "offset near the radius of curvature",
      pts: [
        { x: 0, y: 0 },
        { x: 20, y: 30 },
        { x: 60, y: 30 },
        { x: 80, y: 0 },
      ],
      d: -38,
    },
    {
      name: "short generated segment, long skeleton handles",
      pts: [
        { x: 0, y: 0 },
        { x: 90, y: 70 },
        { x: -70, y: 70 },
        { x: 20, y: 0 },
      ],
      d: 30,
    },
    {
      name: "near-retracted start handle",
      pts: [
        { x: 0, y: 0 },
        { x: 0.4, y: 0.3 },
        { x: 100, y: 60 },
        { x: 150, y: 0 },
      ],
      d: 20,
    },
  ];

  function build([p0, p1, p2, p3], d0, d3) {
    return offsetCubicSide({
      p0,
      p1,
      p2,
      p3,
      d0,
      d3,
      ...ribInputs(p0, p1, p2, p3, d0, d3),
    });
  }

  const EPS = 1e-4;
  // Generous on purpose: this catches jumps, which are orders of magnitude
  // larger than any legitimate sensitivity.
  const MAX_GAIN = 2000;

  function moved(before, after) {
    return Math.max(
      Math.abs(after.startLength - before.startLength),
      Math.abs(after.endLength - before.endLength)
    );
  }

  for (const { name, pts, d } of configurations) {
    for (let index = 0; index < 4; index++) {
      for (const axis of ["x", "y"]) {
        it(`moves smoothly when point ${index}.${axis} moves — ${name}`, () => {
          const nudged = pts.map((point, i) =>
            i === index ? { ...point, [axis]: point[axis] + EPS } : point
          );
          expect(moved(build(pts, d, d), build(nudged, d, d))).to.be.at.most(
            MAX_GAIN * EPS
          );
        });
      }
    }

    it(`moves smoothly when the width changes — ${name}`, () => {
      expect(moved(build(pts, d, d), build(pts, d + EPS, d + EPS))).to.be.at.most(
        MAX_GAIN * EPS
      );
    });

    it(`moves smoothly when the width tapers — ${name}`, () => {
      expect(moved(build(pts, d, d), build(pts, d, d + EPS))).to.be.at.most(
        MAX_GAIN * EPS
      );
    });
  }

  it("has no jump anywhere along a 200-step drag", () => {
    const base = [
      { x: 0, y: 0 },
      { x: 30, y: 45 },
      { x: 90, y: 45 },
      { x: 120, y: 0 },
    ];
    let previous = null;
    let worst = 0;
    for (let step = 0; step <= 200; step++) {
      // March the second handle across the segment, sweeping through high
      // curvature and an S-shape on the way.
      const pts = [base[0], base[1], { x: 90 - step * 0.8, y: 45 }, base[3]];
      const current = build(pts, 35, 35);
      if (previous) {
        worst = Math.max(worst, moved(previous, current));
      }
      previous = current;
    }
    // Each step moves an input 0.8 units. A well-behaved response moves the
    // lengths comparably; a fit flip moves them by tens of units.
    expect(worst).to.be.at.most(8);
  });
});
```

- [ ] **Step 2: Run**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-cubic.js --extension js`
Expected: PASS.

If a case fails the failure is real. Find the discontinuous term rather than widening `MAX_GAIN`. Likeliest causes, in order: a `Math.min`/`Math.max` that should be a smooth minimum; a `Number.isFinite` guard on a value passing through zero; `easeIntoBand` handed a near-zero analytic length.

Note what this suite deliberately does not cover: the collapsed-side threshold (the generator never calls the construction below it) and the tangent-intersection flip (Task 9 measures whether that path is reachable at all).

- [ ] **Step 3: Commit**

```bash
npx prettier --write src-js/fontra-core/tests/test-offset-cubic.js
git add .
git commit -m "test: pin the offset construction's continuity

Perturbs every control point, the width and the taper across five
configurations spanning the regime the old pipeline broke down in, and asserts
the lengths move proportionally. Adds a 200-step drag sweep asserting no jump.

This is the property the sample-and-fit path lacked and the reason handles
flipped configuration mid-drag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire into the generator

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` — imports, and the `addOffsetCurves` helper inside `generateOffsetPointsForSegment`
- Modify: `src-js/fontra-core/tests/test-skeleton-generator.js`
- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` (regenerated)

**Interfaces:**
- Consumes: `offsetCubicSide` as completed in Task 5.

- [ ] **Step 1: Read the branch end to end**

Read from the `} else {` opening the bezier branch (near `:2590`) through the end of `generateOffsetPointsForSegment` (near `:3202`). Do not edit until you can name every consumer of `fixedStartLeft` / `fixedEndLeft` / `fixedStartRight` / `fixedEndRight`. There are three: the emitted on-curve point, the detached-handle base, and the handle math. Only the third changes.

Note the current order of operations, which must be preserved: the handle is computed, **then** `applyHandleOffsetToControlPoint` applies the user's stored offset, **then** the direction lock projects the result back onto the skeleton handle direction. The user's offset is therefore projected too. Keep that.

- [ ] **Step 2: Add the import**

After the `fit-cubic.js` import:

```js
import { offsetCubicSide } from "./offset-cubic.js";
```

- [ ] **Step 3: Replace the handle computation**

Inside `addOffsetCurves`, keep unchanged: the collapsed-side early return, the `buildGeneratedOnCurve` pushes, the `applyHandleOffsetToControlPoint` calls, the `handle1Point` / `handle2Point` construction with `_provenance`, and the final `Math.round`.

Delete: the `curves.length === 0` fallback, the `simplifyOffsetCurves` block, the `lockNearZeroHandleDirection` calls and their locals, the `ENABLE_EXPERIMENTAL_HANDLE_STABILIZATION` block, the trailing "use original curves without simplification" branch, and every `logSkeletonDebug` field reading from those locals.

Add this helper next to `getSegmentTangent`:

```js
/**
 * Project a handle back onto its locked direction and floor its length.
 * Reproduces what lockNearZeroHandleDirection did, minus the eight-direction
 * grid snap: direction comes from the skeleton handle, so only the length along
 * it survives.
 */
function projectHandleOntoDirection(anchor, handlePoint, direction) {
  const along =
    (handlePoint.x - anchor.x) * direction.x + (handlePoint.y - anchor.y) * direction.y;
  const length = Math.max(along, 1);
  return { x: anchor.x + direction.x * length, y: anchor.y + direction.y * length };
}
```

Replace the handle derivation with:

```js
      const controls = segment.controlPoints;
      const sideSign = isLeftSide ? 1 : -1;
      const startTangentFallback = getSegmentTangent(segment, "start");
      const endTangentFallback = getSegmentTangent(segment, "end");
      const startHandleDir = getSkeletonHandleDirection(segment, "start", "out");
      const endHandleDir = getSkeletonHandleDirection(segment, "end", "in");
      const startDir = startHandleDir ?? startTangentFallback;
      const endDir = endHandleDir ?? {
        x: -endTangentFallback.x,
        y: -endTangentFallback.y,
      };

      const { startLength, endLength } = offsetCubicSide({
        p0: segment.startPoint,
        p1: controls[0],
        p2: controls[controls.length - 1],
        p3: segment.endPoint,
        d0: sideSign * startHalfWidth,
        d3: sideSign * endHalfWidth,
        q0: fixedStart,
        q3: fixedEnd,
        u0: startDir,
        u1: endDir,
      });

      let adjustedHandle1 = {
        x: fixedStart.x + startDir.x * startLength,
        y: fixedStart.y + startDir.y * startLength,
      };
      let adjustedHandle2 = {
        x: fixedEnd.x + endDir.x * endLength,
        y: fixedEnd.y + endDir.y * endLength,
      };
```

Then, **after** the two existing `applyHandleOffsetToControlPoint` calls, add:

```js
      adjustedHandle1 = projectHandleOntoDirection(fixedStart, adjustedHandle1, startDir);
      adjustedHandle2 = projectHandleOntoDirection(fixedEnd, adjustedHandle2, endDir);
```

Replace the surviving debug payload with:

```js
      logSkeletonDebug(
        { ...debugContext, side },
        {
          stage: "offsetCubicSide",
          startHalfWidth,
          endHalfWidth,
          startLength,
          endLength,
          chordLength: Math.hypot(fixedEnd.x - fixedStart.x, fixedEnd.y - fixedStart.y),
        }
      );
```

`segment.controlPoints` always holds exactly two off-curve points for a curve segment: the pen tool and the model only emit handles in pairs, and every branch in the generator tests `controlPoints.length === 0` against everything else. Indexing first and last rather than `[0]` and `[1]` costs nothing and degrades to a sane curve rather than `NaN` if malformed data ever arrives.

- [ ] **Step 4: Delete the offset calls**

Remove from the bezier branch (near `:2632`):

```js
    const offsetLeftCurves = bezier.offset(-avgLeftHW);
    const offsetRightCurves = bezier.offset(avgRightHW);
```

Keep `avgLeftHW` / `avgRightHW` — both are still the `sideHalfWidth` argument at the `addOffsetCurves` call sites, which the collapsed check needs. Keep `bezier`; the endpoint normals above still use it. Remove the `curves` parameter from `addOffsetCurves` and both call sites' first argument.

- [ ] **Step 5: Verify structure before regenerating**

Run: `cd src-js/fontra-core && npm test`
Expected: golden-master cases FAIL with coordinate differences. Everything else passes.

Then check what actually moved:

```bash
cd src-js/fontra-core && node -e "
const fs = require('fs');
import('./src/skeleton-generator.js').then((mod) => {
  const fixtures = JSON.parse(fs.readFileSync('tests/data/skeleton-generator/fixtures.json','utf8'));
  let counts = 0, onCurves = 0, dirs = 0;
  for (const f of fixtures) {
    const got = mod.generateFromSkeleton(f.canonical).contours;
    if (got.length !== f.expectedContours.length) { counts++; continue; }
    for (let i = 0; i < got.length; i++) {
      const a = got[i].points, b = f.expectedContours[i].points;
      if (a.length !== b.length) { counts++; continue; }
      for (let j = 0; j < a.length; j++) {
        if (!a[j].type && (a[j].x !== b[j].x || a[j].y !== b[j].y)) onCurves++;
        if (a[j].type) {
          const prev = a[j-1] ?? a[a.length-1], pb = b[j-1] ?? b[b.length-1];
          const ca = Math.atan2(a[j].y-prev.y, a[j].x-prev.x);
          const cb = Math.atan2(b[j].y-pb.y, b[j].x-pb.x);
          if (Math.abs(ca-cb) > 0.05 && !prev.type) dirs++;
        }
      }
    }
  }
  console.log('point-count mismatches:', counts);
  console.log('on-curve points moved:', onCurves);
  console.log('handle directions changed:', dirs);
});
"
```

Expected: **all three zero**. Point counts must not change (interpolation), on-curve points must not move (endpoint consumers untouched), and handle directions must not change (direction is locked). Any non-zero result means the change is wrong — stop and fix before regenerating.

- [ ] **Step 6: Pin the collapsed-side bypass**

Append to `src-js/fontra-core/tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator collapsed sides", () => {
  function singleSidedContour(direction) {
    return {
      contours: [
        {
          id: 1,
          closed: false,
          singleSided: direction,
          defaultWidth: 80,
          points: [
            { id: 1, x: 0, y: 0, smooth: false },
            { id: 2, x: 40, y: 100, type: "cubic" },
            { id: 3, x: 160, y: 100, type: "cubic" },
            { id: 4, x: 200, y: 0, smooth: false },
          ],
        },
      ],
    };
  }

  for (const direction of ["left", "right"]) {
    it(`copies the skeleton verbatim on the zero-width side (${direction})`, () => {
      const points = generateFromSkeleton(singleSidedContour(direction)).contours[0]
        .points;
      const matches = points.filter(
        (point) =>
          point.type === "cubic" &&
          ((point.x === 40 && point.y === 100) || (point.x === 160 && point.y === 100))
      );
      expect(matches.length).to.be.at.least(2);
    });
  }
});
```

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --extension js`
Expected: the collapsed-side cases PASS (golden masters still fail until Step 8).

- [ ] **Step 7: Add the end-to-end continuity sweep**

The module-level suite can be green while the drag still jumps, because corner rounding, the smoothing pass and grid rounding all sit downstream. Append to the same file:

```js
describe("skeleton-generator drag continuity", () => {
  function contourWithHandleAt(x) {
    return {
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 70,
          points: [
            { id: 1, x: 0, y: 0, smooth: false },
            { id: 2, x: 30, y: 45, type: "cubic" },
            { id: 3, x: x, y: 45, type: "cubic" },
            { id: 4, x: 120, y: 0, smooth: false },
          ],
        },
      ],
    };
  }

  it("moves every generated point smoothly across a 200-step drag", () => {
    let previous = null;
    let worst = 0;
    for (let step = 0; step <= 200; step++) {
      const points = generateFromSkeleton(contourWithHandleAt(90 - step * 0.5))
        .contours[0].points;
      if (previous && previous.length === points.length) {
        for (let i = 0; i < points.length; i++) {
          worst = Math.max(
            worst,
            Math.hypot(points[i].x - previous[i].x, points[i].y - previous[i].y)
          );
        }
      }
      previous = points;
    }
    // Each step moves the input half a unit. Grid rounding allows about 1.5
    // units of legitimate movement; a fit flip is tens.
    expect(worst).to.be.at.most(6);
  });
});
```

Run it. Expected: PASS. **This test fails against the pre-change generator** — worth confirming on a stash to know the suite has teeth.

- [ ] **Step 8: Regenerate and verify**

```bash
cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js && npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: construct generated handle lengths instead of fitting them

The cubic branch offset each side with bezier-js, sampled the resulting
subcurves and refitted them to one cubic under an adaptive error threshold.
Every stage of that was a step function - the subcurve partition, the sample
set derived from it, the iteration count, the threshold index - so a one-unit
move of a skeleton point could land on a completely different handle
configuration.

Handle direction was already locked to the skeleton handle direction and is
unchanged. Only the length is now constructed rather than fitted. Endpoints,
provenance, point counts and the collapsed-side bypass are untouched.

Adds an end-to-end drag sweep, which the previous generator fails.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Remove the superseded code

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js`

- [ ] **Step 1: Confirm reference counts**

```bash
cd src-js && for sym in simplifyOffsetCurves stabilizeSingleCubicHandles \
  lockNearZeroHandleDirection getMinimumGridStepFromDirection \
  alignHandleDirections clampNearZeroDirection rotateDirection \
  normalizeDirectionOrFallback SIMPLIFY_OFFSET_CURVES SAMPLES_PER_CURVE \
  MIN_ERROR_PERCENT MAX_ERROR_PERCENT ERROR_STEP_PERCENT \
  NEAR_ZERO_HANDLE_THRESHOLD NEAR_ZERO_HANDLE_TARGET \
  MAX_NEAR_ZERO_ROTATION_DEG MAX_HANDLE_TO_CHORD_RATIO \
  ENABLE_EXPERIMENTAL_HANDLE_STABILIZATION; do
  echo "$sym: $(grep -rn "\b$sym\b" --include=*.js --include=*.ts . | grep -v node_modules | wc -l)"
done
```

Record the counts. A symbol is safe to delete when **every** remaining hit is either its own definition or sits inside another symbol being deleted in this task. Do not use "count is 1" as the rule — the definition always counts, so nothing reaches 1.

- [ ] **Step 2: Delete**

Working bottom-up through `src-js/fontra-core/src/skeleton-generator.js` so earlier line numbers stay valid:

- `simplifyOffsetCurves` and `SIMPLIFY_OFFSET_CURVES`, `SAMPLES_PER_CURVE`, `MIN_ERROR_PERCENT`, `MAX_ERROR_PERCENT`, `ERROR_STEP_PERCENT`
- `stabilizeSingleCubicHandles`, `ENABLE_EXPERIMENTAL_HANDLE_STABILIZATION`, and its private helpers `clampNearZeroDirection` and `rotateDirection`
- `lockNearZeroHandleDirection`, `getMinimumGridStepFromDirection`, `NEAR_ZERO_HANDLE_THRESHOLD`, `NEAR_ZERO_HANDLE_TARGET`, `MAX_NEAR_ZERO_ROTATION_DEG`
- `normalizeDirectionOrFallback` — all its call sites are inside the above
- `MAX_HANDLE_TO_CHORD_RATIO` — now owned by `offset-cubic.js`. Leaving a second copy here violates rail R-B.
- `alignHandleDirections`, plus the two commented-out call sites naming it
- `chordLengthParameterize`, `computeMaxError` and `fitCubic` from the `fit-cubic.js` import at `:2` — all three were used only inside `simplifyOffsetCurves`. Do **not** remove them from `fit-cubic.js`.

- [ ] **Step 3: Verify**

```bash
cd src-js/fontra-core && node --check src/skeleton-generator.js && npm test
```
Expected: no output from `node --check`, and PASS with **no golden-master change**. This task removes only unreachable code — a fixture moving means something live was deleted.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js
git add .
git commit -m "refactor: drop the superseded offset machinery

Removes the offset-curve simplifier and its adaptive error constants, the
near-zero handle direction lock and its eight-direction grid snap, the
experimental handle stabilizer that has sat behind a false flag since the port,
and alignHandleDirections, whose call sites were commented out as O(n^3) at the
same time.

The direction lock's two live roles were carried over first: direction is now
supplied by the caller, and the minimum handle length is a smooth floor in the
construction.

All unreachable. Golden masters unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Measure the tension bound, then decide

The bound was adopted to replace an arbitrary constant, and then needed an arbitrary floor of its own to stop it collapsing. Before adding that constant, find out whether the bound ever fires.

**Files:**
- Create: `src-js/fontra-core/tests/scripts/measure-tension-bound.js`
- Possibly modify: `src-js/fontra-core/src/offset-cubic.js`

- [ ] **Step 1: Write the measurement script**

Create `src-js/fontra-core/tests/scripts/measure-tension-bound.js`:

```js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { resetTensionBoundStats, tensionBoundStats } from "../../src/offset-cubic.js";
import { generateFromSkeleton } from "../../src/skeleton-generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "data", "skeleton-generator", "fixtures.json"),
    "utf8"
  )
);

resetTensionBoundStats();
for (const fixture of fixtures) {
  generateFromSkeleton(fixture.canonical);
}
console.log("fixtures:", JSON.stringify(tensionBoundStats));

// Sweep a wide configuration space: curvature, width and taper, including the
// regimes the fixtures do not reach.
resetTensionBoundStats();
for (let handle = 5; handle <= 120; handle += 5) {
  for (let width = 5; width <= 120; width += 5) {
    for (let taper = 0; taper <= 4; taper++) {
      generateFromSkeleton({
        contours: [
          {
            id: 1,
            closed: false,
            defaultWidth: width * 2,
            points: [
              { id: 1, x: 0, y: 0, smooth: false, width: { left: width, right: width } },
              { id: 2, x: handle, y: handle, type: "cubic" },
              { id: 3, x: 120 - handle, y: handle, type: "cubic" },
              {
                id: 4,
                x: 120,
                y: 0,
                smooth: false,
                width: { left: width * (1 + taper), right: width * (1 + taper) },
              },
            ],
          },
        ],
      });
    }
  }
}
console.log("sweep:", JSON.stringify(tensionBoundStats));
```

- [ ] **Step 2: Run it**

```bash
cd src-js/fontra-core && node tests/scripts/measure-tension-bound.js
```

Record both lines in the commit message.

- [x] **Step 3: Decide from the numbers**

**Measured 2026-07-26 — the bound stays.**

```
fixtures: {"evaluated":20,"active":2}
sweep:    {"evaluated":11520,"active":3872}
```

It fires on 2 of 20 fixture evaluations and 34% of the small-scale sweep, so the
"delete it" branch below does not apply. The floor is already in place
(`TENSION_LIMIT_FLOOR_RATIO = 1/3`, commit `8bdef4f34`) and is load-bearing:
without it, a segment whose rib chord collapses pins both handles to the tangent
intersection — observed at half-width 30 on a scale-1 junction, where a 6-unit
rib chord drove both handles to exactly 6.71. That is the collapse-and-snap
failure mode the floor exists to stop. The `chord/3` value was the user's
concern about a magic number; it is now justified by measurement rather than
taste, and it is the same neutral-cubic length `fit-cubic.js` already falls back
to.

The decision rules as originally written:

**If `active` is 0 in both runs:** delete the tension bound. Remove `tangentIntersectionDistances`, the `calculateTunniPoint` import, `tensionBoundStats`, `resetTensionBoundStats`, and the tension branch of `boundLength`. Keep the chord backstop and the length floor. Delete the tests that reference the removed exports. This is the preferred outcome — it removes a mechanism, a dependency and a constant, and the collapse-and-snap failure mode goes with them.

**If `active` is non-zero:** keep the bound and add the floor. Print the configurations where it fired, choose the floor from them, and add `chord/3` as the lower bound on the limit:

```js
const TENSION_LIMIT_FLOOR_RATIO = 1 / 3;
```

with `limit = Math.max(rawLimit, TENSION_LIMIT_FLOOR_RATIO * chord)`. A third of the chord is the handle length of a neutral cubic and is already the fallback in `fit-cubic.js`, so it is at least a quantity with meaning. Then add a continuity test that sweeps the end tangent through the start point and asserts no jump — the case that motivated the floor.

- [ ] **Step 4: Run the suite and commit**

```bash
cd src-js/fontra-core && npm test
npx prettier --write src-js/fontra-core/src/offset-cubic.js
git add .
git commit -m "<either: 'refactor: drop the tension bound, it never fires' or 'feat: floor the tension limit at a third of the chord'>

<paste both measurement lines here>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Fix the misleading test title and update the feature model

**Files:**
- Modify: `src-js/fontra-core/tests/test-skeleton-generator.js:12-14`
- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md`

- [ ] **Step 1: Retitle the golden-master suite**

The per-case title reads `matches donor output for ${fixture.name}`. Porting is finished and no parity with the pre-port code is maintained, so that title makes a failure read as a parity question instead of a regression. Change it to `matches the recorded outline for ${fixture.name}` and add above the `describe`:

```js
// The recorded outlines this generator currently emits. Regenerate with
// tests/scripts/make-skeleton-generator-fixtures.js.
```

- [ ] **Step 2: Update the feature model**

In `docs/superpowers/SKELETON-FEATURE-MODEL.md` §3 step 2, replace the sentence describing cubic offsetting with:

```markdown
Cubic segments: the generated handle *direction* is the skeleton handle
direction, and its *length* is the skeleton handle length scaled by
`λ = 1 + d·κ` (`offset-cubic.js`), corrected by one fixed least-squares pass and
bounded below at one unit. Endpoints are the exact rib positions. This replaced
a bezier-js `offset()` + adaptive `fitCubic` path on 2026-07-26 because that
path was not a continuous function of the skeleton — see
`specs/2026-07-26-skeleton-offset-construction-design.md`.
```

In §4, append:

```markdown
- **The generator fixtures are self-recorded.** Until 2026-07-26 the fixture
  script ran the pre-port generator out of the gitignored `_external/skeleton`
  checkout, so it could not be run from a fresh clone or in CI. It now records
  this generator's own output.
```

In §6, delete the `alignHandleDirections` and `stabilizeSingleCubicHandles` cleanup entries — both are resolved. Leave the round-once and monolith entries.

- [ ] **Step 3: Verify and commit**

```bash
cd src-js/fontra-core && npm test
npx prettier --write src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "docs: retitle the generator fixtures and update the pipeline description

The suite's per-case title claimed the fixtures match pre-port output. Porting
is finished and no parity is maintained, so that made a failure read as a parity
question instead of a regression.

Updates the feature model's description of cubic offsetting, and drops the two
cleanup candidates this work resolved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

**Handle direction must not change.** It is the skeleton handle direction, before and after. Task 7 Step 5 checks this explicitly. Any diff showing rotated handles is a bug, not an improvement.

**Three intentional discontinuities.** Do not smooth them, and do not write a continuity test that spans them:

1. The 0.5-unit collapsed-side threshold — what makes single-sided contours exact.
2. The forward/behind flip of the tangent-ray intersection — Task 9 decides whether this code path survives at all.
3. Grid rounding at emission — the price of integer coordinates.

**If a continuity test fails**, find the discontinuous term. Do not widen the threshold.

**Do not run `npm run bundle`.** The user runs bundle-watch and reports compile errors.
