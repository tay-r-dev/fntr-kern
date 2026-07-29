# Continuous Skeleton Outline Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace candidate-dependent cubic offset refitting with a pure, stateless natural-handle solver: one strictly convex quadratic — a fixed-sample perpendicular fit plus a pull toward the skeleton's own tension — minimized exactly inside the handle box, so unrounded automatic handles are continuous within a fixed contour topology and meet explicit sweep-step ceilings.

**Architecture:** Add `natural-handle-solver.js` as the focused pure geometry unit for fixed offset samples, the two-variable perpendicular-error system, the reference answer, the pull weight, and exact box-constrained minimization. Keep `offset-cubic.js` as the cubic-side orchestrator that builds the shared handle domain and then applies attached adjustments, the curvature pin, and detached handles; keep `skeleton-generator.js` responsible for ribs, directions, collapsed sides, topology, provenance, nudges, caps, corners, and final grid emission.

**One term, three jobs.** The pull is a quadratic penalty on tension-space distance from the reference answer, weighted at `ρ·S`, where `S` is the fixed unprojected handle-influence scale. Because `S` stays positive even when the projected fit system is zero, the pull makes the system strictly convex for every finite input, supplies the answer wherever the fit has no information, and removes the rank branch and tie-break rule. It bounds each solve's condition number; the complete input-to-output sensitivity is accepted by high-resolution sweeps. The ratio `ρ` is computed from skeleton geometry and widths, never from the residual or answer. There is no confidence score and no blend between two computed answers; see the spec's §10 for why both were rejected.

**Tech Stack:** JavaScript ES modules, Mocha, Chai, Fontra core geometry utilities, npm workspaces, Webpack.

---

## Established boundaries

The implementation must follow the current architecture documents, not the historical shape of `offset-cubic.js`:

- `fontra-core/src/` owns pure geometry and is covered by Mocha.
- `skeleton-generator.js` remains the centerline-to-outline and provenance owner.
- `offset-cubic.js` remains the authored-state orchestrator for one cubic side.
- The new natural solver knows nothing about pins, attached offsets, detached handles, caps, corners, contour direction, provenance, selection, or editor state.
- `nudge` and `handleNudge` remain emission displacements and never enter the natural solve.
- The existing one-write-path and forward-provenance architecture is untouched.
- The shared finite reach definition remains single-source. The new solver exports the domain builder so both the outline frame and the skeleton frame behind the reference answer use exactly the same reach calculation.
- No editor files, persistence schema, gestures, panels, or selection kinds change.

## File structure

**Create**

- `src-js/fontra-core/src/natural-handle-solver.js` — fixed samples, handle domain, quadratic system, reference answer, pull weight, constrained solve.
- `src-js/fontra-core/tests/test-natural-handle-solver.js` — pure solver recovery, constraints, degeneracy, continuity, accuracy, and `U^1` sweeps.

**Modify**

- `src-js/fontra-core/src/offset-cubic.js` — replace seed/correction/split automatic construction with a call to the natural solver; retain authored semantics.
- `src-js/fontra-core/src/fit-cubic.js` — remove the now-unused offset-specific `solveHandleScale` helper and update its misleading comment; retain the generic fitter and parameterizer.
- `src-js/fontra-core/tests/test-offset-cubic.js` — reduce to orchestration/authored-state tests and integration coverage; move natural-fit properties to the new test file.
- `src-js/fontra-core/tests/test-skeleton-generator.js` — add generator-boundary invariants for automatic, pinned, attached, detached, and nudge behavior.
- `src-js/fontra-core/tests/test-skeleton-interpolation.js` — add cubic coordinate/width variants to the existing topology signature checks.
- `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` — regenerate only after focused properties and outline diffs are reviewed.
- `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` — record the new module and revised ownership.
- `docs/superpowers/SKELETON-FEATURE-MODEL.md` — replace the five-stage correction/equalization model with the one-convex-solve model: fixed-sample fit plus a pull toward the skeleton's own tension.
- `docs/superpowers/DEVELOPMENT-LOG.md` — append the implementation outcome and measured acceptance results.

## Shared test helpers and conventions

Use the same five fixed parameters everywhere:

```js
const OFFSET_SAMPLE_PARAMETERS = [0.125, 0.25, 0.5, 0.75, 0.875];
```

The pure solver request and result are:

```js
/**
 * @typedef {Object} NaturalHandleRequest
 * @property {Object[]} skeletonControlPoints
 * @property {number} startSignedWidth
 * @property {number} endSignedWidth
 * @property {Object} startOutlinePoint
 * @property {Object} endOutlinePoint
 * @property {Object} startHandleDirection
 * @property {Object} endHandleDirection
 * @property {Object} handleDomain
 */

/**
 * @typedef {Object} NaturalHandleResult
 * @property {number} startLength
 * @property {number} endLength
 * @property {number} pullWeightRatio    diagnostic only
 * @property {number} perpendicularRms   diagnostic only, measured on the answer
 */
```

The two diagnostics are for test messages only. No production code may branch on either.

`handleDomain` carries the reaches and the box **in tension coordinates**, matching the
shipped module. Tension 1 is the tangent intersection; the lower face is the one-unit grid
floor:

```js
{
  startReach,
  endReach,
  chordLength,
  minStartTension: 1 / startReach,
  maxStartTension: 1,
  minEndTension: 1 / endReach,
  maxEndTension: 1,
}
```

The solver works entirely in that space and multiplies by the reaches once, on return.
All solver assertions target unrounded lengths. Use `1e-9` only for algebraic identities, `1e-6` for direction/domain invariants, the existing accuracy ceilings for sampled outline deviation, and the spec's `3`-unit sweep ceiling for the `1.7`-unit skeleton-handle step.

### Task 1: Lock in the current `U^1` failure and acceptance measurements

**Files:**

- Modify: `src-js/fontra-core/tests/test-offset-cubic.js`

- [ ] **Step 1: Extract the existing reported geometry into named helpers**

Keep the already-committed numerical reproduction; `_external/U^1.json` is absent from this checkout and must not become a test dependency. Replace the duplicated constants in the final two suites with:

```js
const U1 = {
  p0: { x: 408, y: 105 },
  p3: { x: 936, y: 338 },
  startHandleLength: 337,
  endHandleLength: Math.hypot(30, 162),
  startDirection: { x: 1, y: 0 },
  endDirection: {
    x: -30 / Math.hypot(30, 162),
    y: -162 / Math.hypot(30, 162),
  },
};

function u1SkeletonAt(scale) {
  return {
    p0: U1.p0,
    p1: {
      x: U1.p0.x + U1.startDirection.x * U1.startHandleLength * scale,
      y: U1.p0.y + U1.startDirection.y * U1.startHandleLength * scale,
    },
    p2: {
      x: U1.p3.x + U1.endDirection.x * U1.endHandleLength * scale,
      y: U1.p3.y + U1.endDirection.y * U1.endHandleLength * scale,
    },
    p3: U1.p3,
  };
}

function sweepU1(side) {
  const forward = [];
  for (let step = 0; step <= 260; step++) {
    const scale = 0.5 + (step * 1.3) / 260;
    forward.push(
      offsetCubicSide({
        ...u1SkeletonAt(scale),
        u0: U1.startDirection,
        u1: U1.endDirection,
        ...side,
      })
    );
  }
  const reverse = [];
  for (let step = 260; step >= 0; step--) {
    const scale = 0.5 + (step * 1.3) / 260;
    reverse.push(
      offsetCubicSide({
        ...u1SkeletonAt(scale),
        u0: U1.startDirection,
        u1: U1.endDirection,
        ...side,
      })
    );
  }
  return { forward, reverse };
}
```

- [ ] **Step 2: Add the strict acceptance assertion**

```js
function expectContinuousMonotoneSweep(values) {
  let worstStep = 0;
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    worstStep = Math.max(
      worstStep,
      Math.abs(current.startLength - previous.startLength),
      Math.abs(current.endLength - previous.endLength)
    );
    expect(current.startLength + 1e-9).to.be.at.least(previous.startLength);
    expect(current.endLength + 1e-9).to.be.at.least(previous.endLength);
  }
  expect(worstStep, "jump per 1.7-unit skeleton-handle step").to.be.at.most(3);
}

for (const [name, side] of Object.entries({
  "single-sided right": {
    d0: -80,
    d3: -290,
    q0: { x: 408, y: 185 },
    q3: { x: 650, y: 388 },
  },
  "single-sided left": {
    d0: 80,
    d3: 290,
    q0: { x: 408, y: 25 },
    q3: { x: 1222, y: 288 },
  },
  "double-sided outer": {
    d0: 40,
    d3: 145,
    q0: { x: 408, y: 65 },
    q3: { x: 1079, y: 313 },
  },
  "double-sided inner": {
    d0: -40,
    d3: -145,
    q0: { x: 408, y: 145 },
    q3: { x: 793, y: 363 },
  },
})) {
  it(`is monotone and frame-independent for ${name}`, () => {
    const { forward, reverse } = sweepU1(side);
    expectContinuousMonotoneSweep(forward);
    expect(reverse).to.deep.equal([...forward].reverse());
  });
}
```

- [ ] **Step 3: Run the focused reproduction and record the failure**

Run:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "U\\^1|frame-independent"
```

Expected: at least one new monotonicity or `3`-unit ceiling assertion fails on the current candidate-rematching/error-budget implementation. Record the observed worst step and side in the eventual development-log entry; do not loosen the acceptance ceiling.

- [ ] **Step 4: Commit the failing reproduction**

```powershell
git add src-js/fontra-core/tests/test-offset-cubic.js
git commit -m "test: reproduce continuous skeleton outline failure"
```

### Task 2: Add the fixed-sample quadratic natural solver

**Files:**

- Create: `src-js/fontra-core/src/natural-handle-solver.js`
- Create: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Write tests for exact fixed-correspondence recovery**

Start the new test file with independent cubic helpers and an exact representable request:

```js
import {
  buildHandleDomain,
  solveNaturalHandles,
} from "@fontra/core/natural-handle-solver.js";
import { expect } from "chai";

const KAPPA = 0.5522847498307933;

function quarterCircle(radius) {
  return [
    { x: radius, y: 0 },
    { x: radius, y: radius * KAPPA },
    { x: radius * KAPPA, y: radius },
    { x: 0, y: radius },
  ];
}

function arcRequest(sourceRadius, offset) {
  const skeletonControlPoints = quarterCircle(sourceRadius);
  const outline = quarterCircle(sourceRadius + offset);
  const startHandleDirection = { x: 0, y: 1 };
  const endHandleDirection = { x: 1, y: 0 };
  return {
    skeletonControlPoints,
    startSignedWidth: offset,
    endSignedWidth: offset,
    startOutlinePoint: outline[0],
    endOutlinePoint: outline[3],
    startHandleDirection,
    endHandleDirection,
    handleDomain: buildHandleDomain(
      outline[0],
      outline[3],
      startHandleDirection,
      endHandleDirection
    ),
  };
}

describe("natural-handle-solver: fixed perpendicular fit", () => {
  it("recovers a circular offset without rematching samples", () => {
    const result = solveNaturalHandles(arcRequest(100, 25));
    expect(result.startLength).to.be.closeTo(125 * KAPPA, 0.1);
    expect(result.endLength).to.be.closeTo(125 * KAPPA, 0.1);
    expect(result.perpendicularRms).to.be.below(0.1);
    expect(result.pullWeightRatio).to.be.below(0.01);
  });

  it("is deterministic and does not mutate its request", () => {
    const request = arcRequest(100, -25);
    const before = structuredClone(request);
    expect(solveNaturalHandles(request)).to.deep.equal(solveNaturalHandles(request));
    expect(request).to.deep.equal(before);
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing-module failure**

Run:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver: fixed"
```

Expected: FAIL because `@fontra/core/natural-handle-solver.js` does not exist.

- [ ] **Step 3: Implement fixed sampling and the quadratic system**

Create the module with these constants and complete primitives:

```js
import { calculateTunniPoint } from "./tunni-calculations.js";

const EPSILON = 1e-9;
const MIN_HANDLE_LENGTH = 1;
const REACH_FLOOR_RATIO = 1 / 3;
const REACH_CAP_RATIO = 2;
const OFFSET_SAMPLE_PARAMETERS = [0.125, 0.25, 0.5, 0.75, 0.875];

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function cubicBasis(t) {
  const mt = 1 - t;
  return {
    b0: mt ** 3,
    b1: 3 * mt * mt * t,
    b2: 3 * mt * t * t,
    b3: t ** 3,
  };
}

function cubicPointAndDerivative(points, t) {
  const [p0, p1, p2, p3] = points;
  const { b0, b1, b2, b3 } = cubicBasis(t);
  const mt = 1 - t;
  return {
    point: {
      x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
      y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    },
    derivative: {
      x:
        3 * mt * mt * (p1.x - p0.x) +
        6 * mt * t * (p2.x - p1.x) +
        3 * t * t * (p3.x - p2.x),
      y:
        3 * mt * mt * (p1.y - p0.y) +
        6 * mt * t * (p2.y - p1.y) +
        3 * t * t * (p3.y - p2.y),
    },
    secondDerivative: {
      x: 6 * mt * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
      y: 6 * mt * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y),
    },
  };
}

function curvatureAt(points, parameter) {
  const { derivative, secondDerivative } = cubicPointAndDerivative(points, parameter);
  const speed = Math.hypot(derivative.x, derivative.y);
  if (speed === 0) return null;
  return (
    (derivative.x * secondDerivative.y - derivative.y * secondDerivative.x) / speed ** 3
  );
}

function buildOffsetSamples(points, startSignedWidth, endSignedWidth) {
  return OFFSET_SAMPLE_PARAMETERS.map((parameter) => {
    const { point, derivative } = cubicPointAndDerivative(points, parameter);
    const speed = Math.hypot(derivative.x, derivative.y);
    const normal =
      speed === 0
        ? { x: 0, y: 0 }
        : { x: derivative.y / speed, y: -derivative.x / speed };
    const width = startSignedWidth + (endSignedWidth - startSignedWidth) * parameter;
    return {
      parameter,
      skeletonNormal: normal,
      requestedPoint: {
        x: point.x + normal.x * width,
        y: point.y + normal.y * width,
      },
      weight: 1,
    };
  });
}

// Coefficients are emitted against TENSIONS, not lengths: each handle's basis
// vector is scaled by its own reach. Everything downstream - the box, the pull,
// the emitted answer - is then in one space, which is what lets the pull be a
// single scalar weight instead of a per-axis one.
function buildPerpendicularErrorSystem(request, samples, domain) {
  const system = {
    aa: 0,
    ab: 0,
    bb: 0,
    ac: 0,
    bc: 0,
    cc: 0,
    weight: 0,
    influenceScale: 0,
  };
  for (const sample of samples) {
    const { b0, b1, b2, b3 } = cubicBasis(sample.parameter);
    const fixedPoint = {
      x:
        (b0 + b1) * request.startOutlinePoint.x + (b2 + b3) * request.endOutlinePoint.x,
      y:
        (b0 + b1) * request.startOutlinePoint.y + (b2 + b3) * request.endOutlinePoint.y,
    };
    const constant = dot(
      sample.skeletonNormal,
      subtract(fixedPoint, sample.requestedPoint)
    );
    const startInfluence = b1 * domain.startReach;
    const endInfluence = b2 * domain.endReach;
    const start =
      startInfluence * dot(sample.skeletonNormal, request.startHandleDirection);
    const end = endInfluence * dot(sample.skeletonNormal, request.endHandleDirection);
    const weight = sample.weight;
    system.aa += weight * start * start;
    system.ab += weight * start * end;
    system.bb += weight * end * end;
    system.ac += weight * start * constant;
    system.bc += weight * end * constant;
    system.cc += weight * constant * constant;
    system.weight += weight;
    // Deliberately unprojected: positive even when the perpendicular fit has
    // no handle information and both projected coefficients are zero.
    system.influenceScale +=
      weight * (startInfluence * startInfluence + endInfluence * endInfluence);
  }
  return system;
}

function objective(system, startTension, endTension) {
  return (
    system.aa * startTension * startTension +
    2 * system.ab * startTension * endTension +
    system.bb * endTension * endTension +
    2 * system.ac * startTension +
    2 * system.bc * endTension +
    system.cc
  );
}
```

- [ ] **Step 4: Implement the single shared finite handle domain**

```js
export function buildHandleDomain(startPoint, endPoint, startDirection, endDirection) {
  const chordLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
  const floor = Math.max(chordLength * REACH_FLOOR_RATIO, MIN_HANDLE_LENGTH);
  const cap = Math.max(chordLength * REACH_CAP_RATIO, floor);
  const tunni = calculateTunniPoint([
    startPoint,
    {
      x: startPoint.x + startDirection.x,
      y: startPoint.y + startDirection.y,
    },
    {
      x: endPoint.x + endDirection.x,
      y: endPoint.y + endDirection.y,
    },
    endPoint,
  ]);
  const projectedReach = (anchor, direction) => {
    if (!tunni) return cap;
    const reach = dot(subtract(tunni, anchor), direction);
    return reach > EPSILON ? clamp(reach, floor, cap) : cap;
  };
  const startReach = projectedReach(startPoint, startDirection);
  const endReach = projectedReach(endPoint, endDirection);
  return {
    startReach,
    endReach,
    chordLength,
    minStartTension: MIN_HANDLE_LENGTH / startReach,
    maxStartTension: 1,
    minEndTension: MIN_HANDLE_LENGTH / endReach,
    maxEndTension: 1,
  };
}
```

This is the current `feasibleBox` reach rule: a missing/parallel or behind intersection
uses the chord cap, while a forward signed reach is clamped between the floor and cap. It
therefore preserves the current `EPSILON`-defined forward/behind tangent-intersection
topology event and the one-unit/non-crossing domain. Do not change that existing boundary
as part of the solver replacement.

- [ ] **Step 5: Add a temporary unconstrained solve sufficient for the circular test**

```js
function unconstrainedMinimum(system) {
  const determinant = system.aa * system.bb - system.ab * system.ab;
  return {
    start: (system.ab * system.bc - system.bb * system.ac) / determinant,
    end: (system.ab * system.ac - system.aa * system.bc) / determinant,
  };
}
```

Once the pull exists this is total, because the penalized determinant is at least the
squared pull weight. Do not add a null return for a singular system — Task 3 removes the
condition rather than guarding it.

Wire `solveNaturalHandles()` to build samples and system, clamp the unconstrained result
into the box, and return it with its RMS. This is an intentionally short green step; Task 3
replaces the temporary clamp with the exact constrained solve and adds the pull.

- [ ] **Step 6: Run and format**

Run:

```powershell
npx.cmd prettier --write src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver: fixed"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
git commit -m "feat: add fixed quadratic outline fit"
```

### Task 3: Implement the pull and exact box minimization

**Files:**

- Modify: `src-js/fontra-core/src/natural-handle-solver.js`
- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Add constraint, degeneracy, and motion tests**

```js
function unit(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function requestFor(points, startSignedWidth, endSignedWidth) {
  const [p0, p1, p2, p3] = points;
  const startHandleDirection = unit({ x: p1.x - p0.x, y: p1.y - p0.y });
  const endHandleDirection = unit({ x: p2.x - p3.x, y: p2.y - p3.y });
  const startNormal = {
    x: startHandleDirection.y,
    y: -startHandleDirection.x,
  };
  const endNormal = {
    x: -endHandleDirection.y,
    y: endHandleDirection.x,
  };
  const startOutlinePoint = {
    x: p0.x + startNormal.x * startSignedWidth,
    y: p0.y + startNormal.y * startSignedWidth,
  };
  const endOutlinePoint = {
    x: p3.x + endNormal.x * endSignedWidth,
    y: p3.y + endNormal.y * endSignedWidth,
  };
  return {
    skeletonControlPoints: points,
    startSignedWidth,
    endSignedWidth,
    startOutlinePoint,
    endOutlinePoint,
    startHandleDirection,
    endHandleDirection,
    handleDomain: buildHandleDomain(
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection
    ),
  };
}

function makeTightTaperRequest({
  startSkeletonLength = 40,
  endSkeletonLength = 100,
} = {}) {
  return requestFor(
    [
      { x: 0, y: 0 },
      { x: startSkeletonLength, y: 0 },
      { x: 140, y: 75 - endSkeletonLength },
      { x: 140, y: 75 },
    ],
    25,
    110
  );
}

function makeTightTurnRequest(width) {
  return requestFor(
    [
      { x: 0, y: 0 },
      { x: 20, y: 90 },
      { x: 120, y: 90 },
      { x: 140, y: 0 },
    ],
    -width,
    -width
  );
}

describe("natural-handle-solver: constrained answer", () => {
  it("keeps both lengths inside the positive non-crossing domain", () => {
    const request = {
      ...arcRequest(30, -80),
      startSignedWidth: -80,
      endSignedWidth: -80,
    };
    const { handleDomain } = request;
    const result = solveNaturalHandles(request);
    expect(result.startLength / handleDomain.startReach).to.be.within(
      handleDomain.minStartTension,
      handleDomain.maxStartTension
    );
    expect(result.endLength / handleDomain.endReach).to.be.within(
      handleDomain.minEndTension,
      handleDomain.maxEndTension
    );
  });

  for (const { name, points, expected } of [
    {
      name: "coincident controls",
      points: Array(4).fill({ x: 10, y: 10 }),
      expected: { startLength: 1, endLength: 1 },
    },
    {
      name: "retracted handles",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
      ],
      expected: { startLength: 1, endLength: 1 },
    },
    {
      name: "straight control polygon",
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 60, y: 0 },
        { x: 90, y: 0 },
      ],
      expected: { startLength: 30, endLength: 30 },
    },
  ]) {
    it(`returns the finite reference answer for ${name}`, () => {
      const start = points[0];
      const end = points[3];
      const startDirection = { x: 1, y: 0 };
      const endDirection = { x: -1, y: 0 };
      const startOutlinePoint = { x: start.x, y: start.y + 25 };
      const endOutlinePoint = { x: end.x, y: end.y + 25 };
      const result = solveNaturalHandles({
        skeletonControlPoints: points,
        startSignedWidth: 25,
        endSignedWidth: 25,
        startOutlinePoint,
        endOutlinePoint,
        startHandleDirection: startDirection,
        endHandleDirection: endDirection,
        handleDomain: buildHandleDomain(
          startOutlinePoint,
          endOutlinePoint,
          startDirection,
          endDirection
        ),
      });
      expect(Number.isFinite(result.startLength)).to.equal(true);
      expect(Number.isFinite(result.endLength)).to.equal(true);
      expect(result.startLength).to.be.closeTo(expected.startLength, 1e-6);
      expect(result.endLength).to.be.closeTo(expected.endLength, 1e-6);
    });
  }

  it("meets the representative coordinate-step ceiling", () => {
    const base = makeTightTurnRequest(120);
    const points = base.skeletonControlPoints.map((point, index) =>
      index === 1 ? { ...point, x: point.x + 1 } : point
    );
    const perturbed = requestFor(points, base.startSignedWidth, base.endSignedWidth);
    const before = solveNaturalHandles(base);
    const after = solveNaturalHandles(perturbed);
    const moved = Math.max(
      Math.abs(after.startLength - before.startLength),
      Math.abs(after.endLength - before.endLength)
    );
    expect(moved).to.be.at.most(3);
  });

  it("takes the reference tension along a rank-one null direction", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ];
    const startOutlinePoint = { x: 0, y: 25 };
    const endOutlinePoint = { x: 90, y: 25 };
    const startHandleDirection = { x: 1, y: 0 };
    const endHandleDirection = { x: 0, y: -1 };
    const domain = buildHandleDomain(
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection
    );
    const result = solveNaturalHandles({
      skeletonControlPoints: points,
      startSignedWidth: 25,
      endSignedWidth: 25,
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection,
      handleDomain: domain,
    });
    // Skeleton start tension is 30 / 180; transfer it to this outline reach.
    // The fit has no start-handle information, so the pull supplies this
    // coordinate exactly.
    const expected = (30 / 180) * domain.startReach;
    expect(result.startLength).to.be.closeTo(expected, 1e-9);
  });
});
```

- [ ] **Step 2: Run the tests and verify the temporary implementation fails**

Run:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "constrained answer"
```

Expected: FAIL on the degenerate cases and at least one constrained case.

- [ ] **Step 3: Add the pull, then enumerate exactly**

Add the reference answer and the penalty term first, because the penalty is what makes the
enumeration below need no rank branch and no tie-break:

```js
function constrainTensions(tensions, domain) {
  return {
    start: clamp(tensions.start, domain.minStartTension, domain.maxStartTension),
    end: clamp(tensions.end, domain.minEndTension, domain.maxEndTension),
  };
}

// The reference answer, in tension coordinates: the skeleton's own two tensions,
// measured against ITS OWN frame's reaches, transferred unchanged.
function referenceHandles(request) {
  const [p0, p1, p2, p3] = request.skeletonControlPoints;
  const startVector = subtract(p1, p0);
  const endVector = subtract(p2, p3);
  const startLength = Math.hypot(startVector.x, startVector.y);
  const endLength = Math.hypot(endVector.x, endVector.y);
  const startDirection =
    startLength === 0
      ? request.startHandleDirection
      : { x: startVector.x / startLength, y: startVector.y / startLength };
  const endDirection =
    endLength === 0
      ? request.endHandleDirection
      : { x: endVector.x / endLength, y: endVector.y / endLength };
  const skeletonDomain = buildHandleDomain(p0, p3, startDirection, endDirection);
  return constrainTensions(
    {
      start: startLength / skeletonDomain.startReach,
      end: endLength / skeletonDomain.endReach,
    },
    request.handleDomain
  );
}

// The pull: one quadratic term on tension-space distance from the reference
// answer. Adding it is a modification of the same 2x2 system, never a second
// solve. Because the fit's system is positive semi-definite, the penalized
// determinant is at least the weight squared. The unprojected influence scale
// stays positive even when the fit's projected Hessian is exactly zero.
function addReferencePull(system, reference, weightRatio) {
  const weight = weightRatio * system.influenceScale;
  return {
    ...system,
    aa: system.aa + weight,
    bb: system.bb + weight,
    ac: system.ac - weight * reference.start,
    bc: system.bc - weight * reference.end,
  };
}

function minimizeInsideRectangle(system, domain) {
  const candidates = [];
  const add = (start, end) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    candidates.push({
      start: clamp(start, domain.minStartTension, domain.maxStartTension),
      end: clamp(end, domain.minEndTension, domain.maxEndTension),
    });
  };

  // The penalized system is strictly convex, so the interior stationary point
  // always exists. No rank branch, and no fallback for a zero system.
  const interior = unconstrainedMinimum(system);
  if (
    interior.start >= domain.minStartTension &&
    interior.start <= domain.maxStartTension &&
    interior.end >= domain.minEndTension &&
    interior.end <= domain.maxEndTension
  ) {
    add(interior.start, interior.end);
  }

  for (const start of [domain.minStartTension, domain.maxStartTension]) {
    add(start, -(system.bc + system.ab * start) / system.bb);
  }
  for (const end of [domain.minEndTension, domain.maxEndTension]) {
    add(-(system.ac + system.ab * end) / system.aa, end);
  }
  for (const start of [domain.minStartTension, domain.maxStartTension]) {
    for (const end of [domain.minEndTension, domain.maxEndTension]) {
      add(start, end);
    }
  }

  let best = candidates[0];
  let bestError = objective(system, best.start, best.end);
  for (const candidate of candidates.slice(1)) {
    const error = objective(system, candidate.start, candidate.end);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return { tensions: best, error: Math.max(bestError, 0) };
}
```

`system.influenceScale` is positive because the sample parameters are interior and both
reaches are positive. `system.aa` and `system.bb` are therefore each at least the positive
pull weight, and the determinant is at least the weight squared, so every division above
is safe by construction. Do not add a guard against zero — if one is needed, the
unprojected scale or pull has been dropped somewhere.

There is no tie-break rule. A strictly convex objective has one minimizer, so the
comparison is on the single penalized objective only.

- [ ] **Step 4: Implement the pull weight**

```js
const PULL_FLOOR = 1e-3;
const PULL_CUSP = 4;

// The predictor of an unrepresentable offset is the cusp factor at the
// endpoints and the same five fixed interior parameters used by the fit. The
// offset is singular where 1 + d*curvature reaches zero, and one cubic fails
// well before that. A zero source derivative is treated as zero health: the
// offset normal is undefined there and the reference must own the answer.
//
// It reads the skeleton and the widths ONLY. Never the residual, the system,
// or the answer - a weight driven by the achieved error closes a feedback path
// from the answer into how much the answer counts, and puts its own steepest
// region on tapered segments, whose error is a direction error no handle
// length can absorb.
function pullWeightRatio(request) {
  const points = request.skeletonControlPoints;
  let health = 1;
  for (const parameter of [0, ...OFFSET_SAMPLE_PARAMETERS, 1]) {
    const curvature = curvatureAt(points, parameter);
    if (curvature === null) {
      health = 0;
      break;
    }
    const width =
      request.startSignedWidth +
      (request.endSignedWidth - request.startSignedWidth) * parameter;
    health = Math.min(health, clamp(1 + width * curvature, 0, 1));
  }
  return PULL_FLOOR + (PULL_CUSP - PULL_FLOOR) * (1 - health) ** 2;
}
```

`PULL_FLOOR` sets the conditioning bound: because the unprojected influence scale bounds
the projected Hessian from above, the penalized condition number is at most
`1 + 1 / PULL_FLOOR`. The complete geometry response is still measured by sweeps because
the frame, domain, reference, and ratio also move with the input. Both constants are
calibrated in Task 5 against the complete accuracy and sweep suite and then frozen. They
may not vary by glyph, side, mode, or fixture.

- [ ] **Step 5: Wire the penalized solve into the public solver**

```js
export function solveNaturalHandles(request) {
  const domain = request.handleDomain;
  const reference = referenceHandles(request);
  const samples = buildOffsetSamples(
    request.skeletonControlPoints,
    request.startSignedWidth,
    request.endSignedWidth
  );
  const fit = buildPerpendicularErrorSystem(request, samples, domain);
  const ratio = pullWeightRatio(request);
  const { tensions } = minimizeInsideRectangle(
    addReferencePull(fit, reference, ratio),
    domain
  );
  return {
    startLength: tensions.start * domain.startReach,
    endLength: tensions.end * domain.endReach,
    pullWeightRatio: ratio,
    perpendicularRms: Math.sqrt(
      objective(fit, tensions.start, tensions.end) / Math.max(fit.weight, 1)
    ),
  };
}
```

The reported residual is measured against the **unpenalized** fit at the answer the solver
returned, so it means "how far this outline is from the true offset" rather than "what the
fit alone would have scored".

- [ ] **Step 6: Run and commit**

Run:

```powershell
npx.cmd prettier --write src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver"
```

Expected: PASS.

```powershell
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
git commit -m "feat: constrain outline fit inside handle domain"
```

### Task 4: Prove the pull carries reference shape without output feedback

**Files:**

- Modify: `src-js/fontra-core/src/natural-handle-solver.js`
- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Add reference-shape tests**

```js
describe("natural-handle-solver: reference answer", () => {
  it("transfers equal skeleton tension to equal outline tension", () => {
    const request = arcRequest(100, 25);
    const result = solveNaturalHandles(request);
    expect(result.startLength / request.handleDomain.startReach).to.be.closeTo(
      result.endLength / request.handleDomain.endReach,
      1e-9
    );
  });

  it("retains deliberate unequal skeleton tension near a cusp", () => {
    const request = makeTightTaperRequest({
      startSkeletonLength: 40,
      endSkeletonLength: 100,
    });
    const result = solveNaturalHandles(request);
    expect(result.pullWeightRatio).to.be.above(0.001);
    expect(result.endLength / request.handleDomain.endReach).to.be.above(
      result.startLength / request.handleDomain.startReach
    );
  });

  it("does not read the outline frame when choosing the ratio", () => {
    const request = makeTightTaperRequest();
    const startOutlinePoint = {
      x: request.startOutlinePoint.x + 80,
      y: request.startOutlinePoint.y - 30,
    };
    const endOutlinePoint = {
      x: request.endOutlinePoint.x - 40,
      y: request.endOutlinePoint.y + 60,
    };
    const changedFrame = {
      ...request,
      startOutlinePoint,
      endOutlinePoint,
      handleDomain: buildHandleDomain(
        startOutlinePoint,
        endOutlinePoint,
        request.startHandleDirection,
        request.endHandleDirection
      ),
    };
    expect(solveNaturalHandles(changedFrame).pullWeightRatio).to.equal(
      solveNaturalHandles(request).pullWeightRatio
    );
  });
});
```

The literal request helpers were added in Task 3 so this task can run immediately; reuse
them here. They construct inputs only, and the accuracy expectations remain independent
of the implementation.

- [ ] **Step 2: Run the reference tests**

Run:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "reference answer"
```

Expected: PASS with the provisional global constants. Calibration waits until Task 5 has
created the complete accuracy and sweep suite.

- [ ] **Step 3: Add perturbation continuity coverage**

For every nondegenerate accuracy fixture, perturb each of the eight skeleton coordinates and both widths by `1e-5`, on both signed sides. Compare the base result with perturbations of `1e-5` and `5e-6`; require the smaller perturbation's handle delta to be no greater than the larger perturbation's delta plus `1e-8`, and require both to remain below `1e-2`. Skip only the three explicit topology events named in the design.

- [ ] **Step 4: Run and commit**

```powershell
npx.cmd prettier --write src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver"
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
git commit -m "feat: pull outline handles toward the skeleton's own tension"
```

Expected: PASS.

### Task 5: Reproduce the prototype accuracy and `U^1` sweep in the pure solver

**Files:**

- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Move and parameterize the independent true-offset accuracy helper**

Move `trueOffsetPoints` and the generated-curve distance calculation from
`test-offset-cubic.js` into the new solver test. Split the old `maxDeviation` helper into:

- `maxDeviationForHandles(points, d0, d3, handles)`, which only constructs the generated
  cubic and compares it with the independently sampled true offset;
- `measureCurrentOffset(points, d0, d3)`, which calls the still-unmodified
  `offsetCubicSide` path and passes its lengths to `maxDeviationForHandles`;
- `measureNaturalOffset(points, d0, d3, solve = solveNaturalHandles)`, which calls
  `solve(requestFor(points, d0, d3))` and passes its lengths to the same measurement
  helper. The callback keeps the measurement identical during the finite calibration
  grid below.

Do this before Task 6 routes `offsetCubicSide` through the new solver, so the first
measurement is a genuine before value. Have `measureNaturalOffset` return:

```js
return {
  maxDeviation: worst,
  pullWeightRatio: result.pullWeightRatio,
  perpendicularRms: result.perpendicularRms,
};
```

Keep the target curve generation and nearest-distance measurement independent of both
implementations. Do not call solver sampling helpers from the test.

- [ ] **Step 2: Add all accuracy cases with pull diagnostics**

```js
for (const testCase of [
  ["circular outward", quarterCirclePoints, 25, 25, 1],
  ["circular inward", quarterCirclePoints, -40, -40, 1],
  ["S-curve left", sCurve, 35, 35, 2.5],
  ["S-curve right", sCurve, -35, -35, 2.5],
  ["tight inward turn", tightTurn, -70, -70, 1.5],
  ["shallow wide offset", shallowCurve, 70, 70, 1],
  ["unequal handles", unequalCurve, 50, 50, 1],
  // Taper has no inherited accuracy ceiling. These rows enter the accuracy
  // ledger and must remain finite; their motion is accepted by the sweep.
  ["moderate taper, left", sCurve, 25, 60, null],
  ["moderate taper, right", sCurve, -25, -60, null],
  ["strong taper, left", sCurve, 20, 110, null],
  ["strong taper, right", sCurve, -20, -110, null],
]) {
  const [name, points, d0, d3, ceiling] = testCase;
  it(`records offset accuracy for ${name}`, () => {
    const before = measureCurrentOffset(points, d0, d3);
    const measured = measureNaturalOffset(points, d0, d3);
    const diagnostic =
      `before=${before}, after=${measured.maxDeviation}, ` +
      `delta=${measured.maxDeviation - before}, ` +
      `pull=${measured.pullWeightRatio}, rms=${measured.perpendicularRms}`;
    expect(Number.isFinite(before), diagnostic).to.equal(true);
    expect(Number.isFinite(measured.maxDeviation), diagnostic).to.equal(true);
    if (ceiling !== null) {
      expect(measured.maxDeviation, diagnostic).to.be.at.most(ceiling);
    }
  });
}
```

Record the before value, after value, and delta for every row in the Task 9 accuracy
ledger. For the four taper rows, do not create an implementation-derived ceiling in the
same change.

- [ ] **Step 3: Add the pure `U^1` sweep**

Use the `U1` geometry from Task 1 and construct `NaturalHandleRequest` objects for single-sided right, single-sided left, double-sided outer, and double-sided inner. Assert:

- both natural lengths are monotone with a `1e-9` numerical allowance;
- worst adjacent step is at most `3`;
- forward and reverse requests return byte-identical reversed result arrays;
- all pull weights and RMS values are finite;
- at least the unrepresentable single-sided case has a higher pull weight than the accurately representable circular cases.

Add a tapered sweep alongside, held to the same `3`-unit ceiling, since the taper cases are new and nothing else sweeps them.

- [ ] **Step 4: Add the near-cusp shape acceptance**

Sweep `makeTightTurnRequest(width)` for every integer width from `10` through `160`.
Require the larger normalized tension divided by the smaller to remain at most `3`.
This rejects a near-degenerate split; it does not claim that neither handle may
legitimately touch a box face.

- [ ] **Step 5: Calibrate the two global ratios against the complete suite**

Evaluate this finite grid in ascending order:

```js
const PULL_FLOOR_CANDIDATES = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2];
const PULL_CUSP_CANDIDATES = [0.25, 0.5, 1, 2, 4, 8, 16];
```

Make the grid executable without environment variables or source rewriting:

1. Refactor the private solver body to accept `pullFloor` and `pullCusp`; keep the public
   `solveNaturalHandles(request)` wrapper fixed to the two production constants.
2. Temporarily export a clearly named
   `_solveNaturalHandlesForCalibration(request, pullFloor, pullCusp)` wrapper from the
   solver module.
3. Parameterize the accuracy, `U^1`, taper, near-cusp, and perturbation check helpers with
   a `solve` callback. Build one `firstAcceptanceFailure(solve)` evaluator that runs those
   same checks and returns either the first diagnostic string or `null`.
4. In one temporary calibration test, iterate the grid lexicographically and bind each
   pair to the calibration wrapper. Log the pair and returned diagnostic, stopping at the
   first `null`.

Select the first floor value for which at least one cusp value passes everything; for
that floor, select the first passing cusp value. This is a lexicographic rule, not
fixture-by-fixture tuning. Record every tried pair and its first failing assertion for
the development log. If no pair passes, stop before routing production geometry and
report that the one-pull model does not meet the combined accuracy/stability contract.

- [ ] **Step 6: Freeze the selected constants**

Replace the provisional `PULL_FLOOR` and `PULL_CUSP` values with the selected pair.
Remove the candidate arrays, temporary calibration test, calibration-only export, and
parameter override from the public module surface. Keep the parameterized test helpers
where they make the frozen suite clearer, but every committed test must call the normal
one-argument public solver. Only the two frozen global constants remain in production.

- [ ] **Step 7: Run the focused suite and record measurements**

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver"
```

Expected: PASS. Record the selected pair, worst sweep steps, and every accuracy maximum
for Task 9. Summarize improved-case count, lost-case count, net change in maximum
deviation, and worst single loss from the before/after rows. The implementation must meet
the inherited ceilings; do not regenerate fixtures to hide a miss.

- [ ] **Step 8: Commit**

```powershell
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
git commit -m "test: verify continuous natural outline solver"
```

### Task 6: Route `offset-cubic.js` through the natural solver and preserve authored semantics

**Files:**

- Modify: `src-js/fontra-core/src/offset-cubic.js`
- Modify: `src-js/fontra-core/src/fit-cubic.js`
- Modify: `src-js/fontra-core/tests/test-offset-cubic.js`

- [ ] **Step 1: Add authored-layer tests before changing the orchestrator**

Retain/add tests that demonstrate the explicit operation order:

```js
describe("offset-cubic: authored handle state", () => {
  it("applies attached adjustments after the natural answer", () => {
    const base = offsetCubicSide(baseRequest());
    const adjusted = offsetCubicSide({
      ...baseRequest(),
      startAdjustment: { x: 8, y: 0, detached: false },
    });
    expect(adjusted.startLength - base.startLength).to.be.closeTo(8, 1e-9);
    expect(adjusted.endLength).to.be.closeTo(base.endLength, 1e-9);
  });

  it("sets the pinned harmonic-mean tension after attached adjustments", () => {
    const request = {
      ...baseRequest(),
      pinnedTension: 0.55,
      startAdjustment: { x: 8, y: 0, detached: false },
      endAdjustment: { x: -4, y: 0, detached: false },
    };
    const result = offsetCubicSide(request);
    expect(harmonicMeanTension(result, request)).to.be.closeTo(0.55, 1e-9);
  });

  it("keeps detached handles absolute when skeleton and widths change", () => {
    const adjustment = { x: 24, y: 0, detached: true };
    const first = offsetCubicSide({
      ...baseRequest(),
      startAdjustment: adjustment,
    });
    const second = offsetCubicSide({
      ...changedSkeletonAndWidthRequest(),
      startAdjustment: adjustment,
    });
    expect(first.startLength).to.equal(second.startLength);
  });
});
```

Use a base request whose start direction is `{x: 1, y: 0}` so the attached and detached expectations are unambiguous. Define `harmonicMeanTension` in the test from the request's `buildHandleDomain()` output; do not import a private orchestrator helper.

- [ ] **Step 2: Run and preserve the current green authored behavior**

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "authored handle state"
```

Expected: PASS before the rewrite, and unchanged after it. Attached and detached handles keep their grid resolution, so assert the current observed grid tolerance rather than `1e-9` — these tests exist to prove the rewrite did **not** move authored geometry.

- [ ] **Step 3: Replace the automatic path in `offset-cubic.js`**

The rewritten module keeps only domain conversion and authored operations:

```js
import { buildHandleDomain, solveNaturalHandles } from "./natural-handle-solver.js";
import { shiftTensionsToMean } from "./tunni-calculations.js";

const MIN_HANDLE_LENGTH = 1;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function lengthsToTensions(handles, domain) {
  return {
    start: handles.startLength / domain.startReach,
    end: handles.endLength / domain.endReach,
  };
}

function tensionsToLengths(tensions, domain) {
  return {
    startLength: tensions.start * domain.startReach,
    endLength: tensions.end * domain.endReach,
  };
}

function constrain(handles, domain) {
  const tensions = lengthsToTensions(handles, domain);
  return tensionsToLengths(
    {
      start: clamp(tensions.start, domain.minStartTension, domain.maxStartTension),
      end: clamp(tensions.end, domain.minEndTension, domain.maxEndTension),
    },
    domain
  );
}

// Resolved on the grid, exactly as today: the handle a designer dropped must
// land where they dropped it, and the pin is applied after this, so rounding
// later would move it. Do not "clean this up" to match the solver's floats.
function placedLength(anchor, direction, adjustment, baseLength = 0) {
  const base = {
    x: anchor.x + direction.x * baseLength,
    y: anchor.y + direction.y * baseLength,
  };
  const placed = {
    x: Math.round(base.x + (adjustment.x || 0)),
    y: Math.round(base.y + (adjustment.y || 0)),
  };
  return (placed.x - anchor.x) * direction.x + (placed.y - anchor.y) * direction.y;
}

function applyAttachedAdjustments(handles, request, domain) {
  const attached = (adjustment, anchor, direction, length) =>
    !adjustment || adjustment.detached
      ? length
      : placedLength(anchor, direction, adjustment, length);
  return constrain(
    {
      startLength: attached(
        request.startAdjustment,
        request.q0,
        request.u0,
        handles.startLength
      ),
      endLength: attached(
        request.endAdjustment,
        request.q3,
        request.u1,
        handles.endLength
      ),
    },
    domain
  );
}

function applyPinnedTension(handles, pinnedTension, domain) {
  if (!Number.isFinite(pinnedTension)) return handles;
  return constrain(
    tensionsToLengths(
      shiftTensionsToMean(lengthsToTensions(handles, domain), pinnedTension, 1),
      domain
    ),
    domain
  );
}

function applyDetachedHandles(handles, request) {
  return {
    // Detached and attached handles are resolved ON THE GRID, as today: the
    // point they describe is one the designer placed and sees, and rounding it
    // after the pin would move it. This is the one place in the module where
    // rounding is correct; the solver stays entirely in floating point.
    startLength: request.startAdjustment?.detached
      ? Math.max(
          placedLength(request.q0, request.u0, request.startAdjustment),
          MIN_HANDLE_LENGTH
        )
      : handles.startLength,
    endLength: request.endAdjustment?.detached
      ? Math.max(
          placedLength(request.q3, request.u1, request.endAdjustment),
          MIN_HANDLE_LENGTH
        )
      : handles.endLength,
  };
}

export function offsetCubicSide(request) {
  const domain = buildHandleDomain(request.q0, request.q3, request.u0, request.u1);
  const natural = solveNaturalHandles({
    skeletonControlPoints: [request.p0, request.p1, request.p2, request.p3],
    startSignedWidth: request.d0,
    endSignedWidth: request.d3,
    startOutlinePoint: request.q0,
    endOutlinePoint: request.q3,
    startHandleDirection: request.u0,
    endHandleDirection: request.u1,
    handleDomain: domain,
  });
  const attached = applyAttachedAdjustments(natural, request, domain);
  const pinned = applyPinnedTension(attached, request.pinnedTension, domain);
  return applyDetachedHandles(pinned, request);
}
```

Keep the grid resolution on attached and detached handles exactly as it is today: a hand-placed handle must land on the point it was dropped on, and the pin runs after it, so moving the rounding to emission would move the handle. The **solver** stays entirely in floating point; this orchestrator is the one place rounding is correct.

- [ ] **Step 4: Delete superseded automatic machinery**

Remove from `offset-cubic.js`:

- imports of `parameterizeAgainstCubic`, `solveHandleLengths`, `solveHandleScale`, `calculateTunniPoint`, and `equalizeTensions`;
- `CORRECTION_SAMPLE_TS`, `CORRECTION_PASSES`, `EQUALIZE_ALLOWANCE`, `EQUALIZE_ALLOWANCE_RATIO`, and `EQUALIZE_STEPS`;
- endpoint-curvature seed functions;
- candidate projection and `offsetDeviation`;
- correction passes;
- magnitude re-solve and split bisection;
- comments that describe the old five-stage automatic path.

Remove `solveHandleScale` from `fit-cubic.js`, because its only production caller was the deleted split walk. Change the `handleFitSystem` comment to describe only the shared normal equations used by `solveHandleLengths`. Keep `parameterizeAgainstCubic` and the generic fitting code; they remain valid APIs but are absent from the automatic skeleton path.

- [ ] **Step 5: Replace obsolete tests**

Delete tests whose product contract was the old implementation detail:

- endpoint `1 + d·curvature` seed values;
- correction-pass reparameterization;
- bounded equalization ratios;
- error-budget plateau behavior.

Keep orchestration bounds, finite output, authored ordering, deterministic calls, and the strict `U^1` integration sweep.

- [ ] **Step 6: Sweep the `U^1` geometry through authored states**

Reuse the Task 1 sweep helper and add:

- a reachable pinned tension on each generated side, with identical reverse geometry and adjacent handle steps at most `3`;
- fixed attached start/end adjustments, with the same monotonicity and step assertions applied after subtracting the constant projected adjustments;
- one detached handle, which remains byte-identical through the sweep while the still-automatic partner remains continuous;
- both double-sided generated sides and both single-sided directions.

These tests prove authored composition remains continuous without asking a detached absolute handle to be monotone with skeleton tension.

- [ ] **Step 7: Run focused tests and confirm the original reproduction turns green**

```powershell
npx.cmd prettier --write src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/src/fit-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
npm.cmd test --workspace src-js/fontra-core -- --grep "offset-cubic|natural-handle-solver"
```

Expected: PASS, including the Task 1 monotonicity and `3`-unit ceiling.

- [ ] **Step 8: Commit**

```powershell
git add src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/src/fit-cubic.js src-js/fontra-core/tests/test-offset-cubic.js
git commit -m "feat: route cubic outlines through natural solver"
```

### Task 7: Verify generator invariants, authored behavior, and interpolation

**Files:**

- Modify: `src-js/fontra-core/tests/test-skeleton-generator.js`
- Modify: `src-js/fontra-core/tests/test-skeleton-interpolation.js`

- [ ] **Step 1: Add a cubic topology signature test**

Extend `makeSkeleton` in `test-skeleton-interpolation.js` to optionally include two cubic controls, then add:

```js
it("keeps cubic point topology across coordinate, width, and taper variants", () => {
  const variants = [
    makeCubicSkeleton({ width0: 20, width1: 20, handleScale: 0.5 }),
    makeCubicSkeleton({ width0: 20, width1: 90, handleScale: 1 }),
    makeCubicSkeleton({ width0: 90, width1: 20, handleScale: 1.5 }),
  ].map((skeleton) => generateFromSkeleton(skeleton));
  for (const variant of variants.slice(1)) {
    expect(contourSignature(variant.contours)).to.deep.equal(
      contourSignature(variants[0].contours)
    );
  }
});
```

Use the same contour/point ids and types in all variants. Vary only coordinates and widths.

- [ ] **Step 2: Add generator-boundary invariants**

In `test-skeleton-generator.js`, add focused assertions for:

- exact collapsed-side copy from skeleton control points;
- stable generated point count across the four `U^1` width modes;
- mirror equivalence and reversal equivalence using existing provenance roles rather than geometric recovery;
- finite output for coincident points and retracted skeleton handles;
- emitted cubic handles remain on the skeleton-owned axes within the unavoidable grid-rounding angle;
- line segments remain direct rib-to-rib projections.

Use existing helpers such as `nudgedRibGeometry`, provenance maps, and `contourSignature`. Do not duplicate generator geometry in test helpers beyond independent dot/cross checks.

- [ ] **Step 3: Retain and tighten authored integration tests**

The existing tests already cover a construction-space pin through nudge and attached offsets. Add:

```js
it("leaves the natural solve unchanged by an on-curve nudge", () => {
  const base = nudgedRibGeometry(0);
  const moved = nudgedRibGeometry(17);
  expect(moved.segmentPoints[1]).to.deep.equal(base.segmentPoints[1]);
  expect(moved.segmentPoints[2]).to.deep.equal(base.segmentPoints[2]);
});

it("keeps detached handles absolute across width and taper changes", () => {
  const narrow = detachedHandleGeometry({ startWidth: 20, endWidth: 20 });
  const tapered = detachedHandleGeometry({ startWidth: 20, endWidth: 80 });
  expect(tapered.leftStartHandle).to.deep.equal(narrow.leftStartHandle);
});
```

Retain the model/modifier tests proving that a direct handle edit bakes then clears a pin without moving the rendered curve. No editor change is needed.

- [ ] **Step 4: Run the focused architecture-preservation suite**

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "offset|interpolation compatibility|provenance|near-zero|natural solve|detached handles|collapsed|mirror|reversal|rib-to-rib"
```

Expected: PASS without selecting the golden-master coordinate suite. Any provenance, authored, topology, or interpolation failure must be fixed before fixture regeneration.

- [ ] **Step 5: Commit**

```powershell
git add src-js/fontra-core/tests/test-skeleton-generator.js src-js/fontra-core/tests/test-skeleton-interpolation.js
git commit -m "test: preserve skeleton outline architecture"
```

### Task 8: Review and regenerate golden outlines

**Files:**

- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json`

- [ ] **Step 1: Regenerate the working-tree fixture and review against Git**

Git already retains the committed baseline, so no second fixture copy is needed:

```powershell
node src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js
git diff -- src-js/fontra-core/tests/data/skeleton-generator/fixtures.json
```

Review every changed cubic fixture. Expected changes are generated off-curve coordinates only. Reject changes to:

- contour counts;
- point counts or point types;
- rib on-curve endpoints;
- provenance ownership;
- line-only fixtures;
- collapsed-side skeleton copies;
- caps or corner topology.

- [ ] **Step 2: Run golden and focused suites**

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "golden master|offset|skeleton"
```

Expected: PASS.

- [ ] **Step 3: Commit the reviewed fixture**

```powershell
git add src-js/fontra-core/tests/data/skeleton-generator/fixtures.json
git commit -m "test: update natural outline fixtures"
```

### Task 9: Update the standing architecture and feature documents

**Files:**

- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md`
- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`

- [ ] **Step 1: Update the architecture inventory**

In the F7 core table:

- add `natural-handle-solver.js` as the fixed-sample quadratic fit, the reference answer, the pull, and the exact box-constrained solve;
- change `offset-cubic.js` to the authored cubic-side orchestrator;
- update test filenames and measured line/test counts from the actual tree;
- preserve rails R-A through R-G and the generator/provenance ownership.

- [ ] **Step 2: Replace the obsolete feature-model construction**

Rewrite §3.2 so its durable pipeline is:

```text
exact rib endpoints + skeleton-owned directions
    -> fixed requested-offset samples at source parameters
    -> convex perpendicular-error fit inside the handle domain
       + a pull toward the skeleton's own tension, with a ratio from the
         skeleton and widths and a positive fixed frame-influence scale
    -> attached handle adjustments
    -> pinned harmonic-mean tension
    -> detached absolute handles
    -> generator emission and grid rounding
```

Delete statements that fixed iteration count, candidate projection, magnitude re-solve, or error-budget bisection are part of the current continuity contract. Retain them only in §8 as historical rejected approaches, with the corrected conclusion: fixed trip count gives determinism but cannot make candidate rematching or threshold search continuous.

Update §5 preservation requirements to name:

- fixed sample identity;
- no projection/root finding/iterative refit/error-budget search in the automatic path;
- one strictly convex objective, so a unique minimizer and no tie-break;
- a pull ratio that reads only the skeleton and widths;
- a positive unprojected influence scale that cannot vanish with the Hessian;
- positive non-crossing domain;
- authored adjustment/pin/detach ordering;
- the three explicit topology/emission events.

- [ ] **Step 3: Append the development-log result**

Record:

- the original failing side and worst step from Task 1;
- every calibrated ratio pair tried, its first failure, and the selected global pair;
- the final worst `U^1` step in each width mode;
- circular, S-curve, tight-turn, shallow-wide, unequal-handle, and taper deviation;
- the before/after accuracy ledger, including net change and worst loss;
- focused/full/bundle commands;
- fixture review scope;
- commit hashes after the implementation commits exist.

Do not copy the full spec into the log; summarize the cause, replacement architecture, and measured outcome.

- [ ] **Step 4: Format and inspect documentation**

```powershell
npx.cmd prettier --write docs/superpowers/FEATURE-ARCHITECTURE-MAP.md docs/superpowers/SKELETON-FEATURE-MODEL.md docs/superpowers/DEVELOPMENT-LOG.md
git diff --check
```

Expected: no formatting errors, no remaining current-tense description of the superseded five-stage automatic construction.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/FEATURE-ARCHITECTURE-MAP.md docs/superpowers/SKELETON-FEATURE-MODEL.md docs/superpowers/DEVELOPMENT-LOG.md
git commit -m "docs: record continuous outline construction"
```

### Task 10: Full verification and completion audit

**Files:**

- Verify all changed files.

- [ ] **Step 1: Prove the forbidden machinery is absent from the automatic path**

Run:

```powershell
rg -n "parameterizeAgainstCubic|solveHandleLengths|solveHandleScale|CORRECTION_PASSES|EQUALIZE_STEPS|offsetDeviation|balanceSplit" src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/src/natural-handle-solver.js
```

Expected: no matches.

Run:

```powershell
rg -n "Math\\.round|previous|history|hysteresis|pointer|motion" src-js/fontra-core/src/natural-handle-solver.js
```

Expected: no matches other than words in comments that explicitly deny such dependencies; there must be no intermediate rounding or frame state.

- [ ] **Step 2: Run focused verification**

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "offset|skeleton"
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

```powershell
npm.cmd test
```

Expected: PASS.

- [ ] **Step 4: Build the production bundle**

```powershell
npm.cmd run bundle
```

Expected: Webpack production build succeeds with no module-resolution or syntax error.

- [ ] **Step 5: Run repository hygiene checks**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; status contains only the intended implementation, tests, fixture, and documentation changes (or is clean after commits).

- [ ] **Step 6: Audit the completion criteria**

Confirm from tests and source inspection:

- the automatic path contains no projection, root finding, iterative refit, convergence test, error-budget search, equalization repair, motion override, or history;
- endpoints, directions, one-cubic topology, collapsed sides, lines, side modes, reversal, mirroring, taper, caps, corners, and point counts retain their owners;
- natural handles are continuous for coordinate and width perturbations;
- the penalized system remains finite and strictly convex when the projected Hessian is
  zero;
- the selected global pull ratios pass the complete accuracy and sweep grid;
- `U^1` is monotone with no step above `3`;
- authored adjustments, pinned curvature, detached handles, pin clearing, and nudge independence are preserved;
- identical input returns identical output;
- invalid/rank-deficient geometry is finite;
- architecture and feature-model docs describe the shipped pipeline.

- [ ] **Step 7: Commit any verification-only corrections**

If verification required source or test corrections, repeat the narrow failing command, then Steps 2–5, and commit only those corrections:

```powershell
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/src/offset-cubic.js src-js/fontra-core/src/fit-cubic.js src-js/fontra-core/tests/test-natural-handle-solver.js src-js/fontra-core/tests/test-offset-cubic.js src-js/fontra-core/tests/test-skeleton-generator.js src-js/fontra-core/tests/test-skeleton-interpolation.js src-js/fontra-core/tests/data/skeleton-generator/fixtures.json docs/superpowers/FEATURE-ARCHITECTURE-MAP.md docs/superpowers/SKELETON-FEATURE-MODEL.md docs/superpowers/DEVELOPMENT-LOG.md
git commit -m "fix: complete continuous outline verification"
```

Do not create an empty verification commit.
