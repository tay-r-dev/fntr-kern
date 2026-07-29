# Continuous Skeleton Outline Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace candidate-dependent cubic offset refitting with a pure, stateless natural-handle solver whose fixed quadratic fit, inherited-tension fallback, and representability blend make unrounded automatic handles continuous within a fixed contour topology.

**Architecture:** Add `natural-handle-solver.js` as the focused pure geometry unit for fixed offset samples, the two-variable perpendicular-error system, exact box-constrained minimization, inherited skeleton tension, and confidence blending. Keep `offset-cubic.js` as the cubic-side orchestrator that builds the shared handle domain and then applies attached adjustments, the curvature pin, and detached handles; keep `skeleton-generator.js` responsible for ribs, directions, collapsed sides, topology, provenance, nudges, caps, corners, and final grid emission.

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
- The shared finite reach definition remains single-source. The new solver exports the domain builder so both the outline and the inherited skeleton tension use exactly the same reach calculation.
- No editor files, persistence schema, gestures, panels, or selection kinds change.

## File structure

**Create**

- `src-js/fontra-core/src/natural-handle-solver.js` — fixed samples, handle domain, quadratic system, constrained solve, inherited answer, fit confidence, natural blend.
- `src-js/fontra-core/tests/test-natural-handle-solver.js` — pure solver recovery, constraints, degeneracy, continuity, accuracy, and `U^1` sweeps.

**Modify**

- `src-js/fontra-core/src/offset-cubic.js` — replace seed/correction/split automatic construction with a call to the natural solver; retain authored semantics.
- `src-js/fontra-core/src/fit-cubic.js` — remove the now-unused offset-specific `solveHandleScale` helper and update its misleading comment; retain the generic fitter and parameterizer.
- `src-js/fontra-core/tests/test-offset-cubic.js` — reduce to orchestration/authored-state tests and integration coverage; move natural-fit properties to the new test file.
- `src-js/fontra-core/tests/test-skeleton-generator.js` — add generator-boundary invariants for automatic, pinned, attached, detached, and nudge behavior.
- `src-js/fontra-core/tests/test-skeleton-interpolation.js` — add cubic coordinate/width variants to the existing topology signature checks.
- `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` — regenerate only after focused properties and outline diffs are reviewed.
- `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` — record the new module and revised ownership.
- `docs/superpowers/SKELETON-FEATURE-MODEL.md` — replace the five-stage correction/equalization model with the fixed-fit/inherited/blend model.
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
 * @property {number} geometricConfidence
 * @property {number} perpendicularRms
 */
```

`handleDomain` uses lengths plus the normalization reaches:

```js
{
  startReach,
  endReach,
  minStartLength: 1,
  maxStartLength: startReach,
  minEndLength: 1,
  maxEndLength: endReach,
}
```

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
    expect(result.geometricConfidence).to.be.above(0.99);
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
  };
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

function buildPerpendicularErrorSystem(request, samples) {
  const system = { aa: 0, ab: 0, bb: 0, ac: 0, bc: 0, cc: 0, weight: 0 };
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
    const start = b1 * dot(sample.skeletonNormal, request.startHandleDirection);
    const end = b2 * dot(sample.skeletonNormal, request.endHandleDirection);
    const weight = sample.weight;
    system.aa += weight * start * start;
    system.ab += weight * start * end;
    system.bb += weight * end * end;
    system.ac += weight * start * constant;
    system.bc += weight * end * constant;
    system.cc += weight * constant * constant;
    system.weight += weight;
  }
  return system;
}

function objective(system, startLength, endLength) {
  return (
    system.aa * startLength * startLength +
    2 * system.ab * startLength * endLength +
    system.bb * endLength * endLength +
    2 * system.ac * startLength +
    2 * system.bc * endLength +
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
    return reach > 0 ? clamp(reach, floor, cap) : cap;
  };
  const startReach = projectedReach(startPoint, startDirection);
  const endReach = projectedReach(endPoint, endDirection);
  return {
    startReach,
    endReach,
    minStartLength: MIN_HANDLE_LENGTH,
    maxStartLength: startReach,
    minEndLength: MIN_HANDLE_LENGTH,
    maxEndLength: endReach,
    chordLength,
  };
}
```

This preserves the current forward/behind tangent-intersection topology event and the one-unit/non-crossing domain. Do not add a near-zero threshold that chooses another fit.

- [ ] **Step 5: Add a temporary unconstrained solve sufficient for the circular test**

```js
function unconstrainedMinimum(system) {
  const determinant = system.aa * system.bb - system.ab * system.ab;
  if (!(determinant > 0)) return null;
  return {
    startLength: (system.ab * system.bc - system.bb * system.ac) / determinant,
    endLength: (system.ab * system.ac - system.aa * system.bc) / determinant,
  };
}
```

Wire `solveNaturalHandles()` to build samples/system and return the clamped unconstrained result, its RMS, and confidence `1` for now. This is an intentionally short green step; Task 3 immediately replaces the temporary clamp with the exact constrained solver and real confidence.

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

### Task 3: Implement exact box minimization and rank-safe confidence

**Files:**

- Modify: `src-js/fontra-core/src/natural-handle-solver.js`
- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Add constraint, tie-break, and degeneracy tests**

```js
describe("natural-handle-solver: constrained geometric answer", () => {
  it("keeps both lengths inside the positive non-crossing domain", () => {
    const request = {
      ...arcRequest(30, -80),
      startSignedWidth: -80,
      endSignedWidth: -80,
    };
    const result = solveNaturalHandles(request);
    expect(result.startLength).to.be.within(
      request.handleDomain.minStartLength,
      request.handleDomain.maxStartLength
    );
    expect(result.endLength).to.be.within(
      request.handleDomain.minEndLength,
      request.handleDomain.maxEndLength
    );
  });

  for (const points of [
    Array(4).fill({ x: 10, y: 10 }),
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ],
  ]) {
    it("returns finite inherited geometry when the fit loses rank", () => {
      const start = points[0];
      const end = points[3];
      const startDirection = { x: 1, y: 0 };
      const endDirection = { x: -1, y: 0 };
      const result = solveNaturalHandles({
        skeletonControlPoints: points,
        startSignedWidth: 25,
        endSignedWidth: 25,
        startOutlinePoint: { x: start.x, y: start.y + 25 },
        endOutlinePoint: { x: end.x, y: end.y + 25 },
        startHandleDirection: startDirection,
        endHandleDirection: endDirection,
        handleDomain: buildHandleDomain(start, end, startDirection, endDirection),
      });
      expect(Number.isFinite(result.startLength)).to.equal(true);
      expect(Number.isFinite(result.endLength)).to.equal(true);
      expect(result.geometricConfidence).to.equal(0);
    });
  }

  it("uses inherited normalized tension along a rank-one null direction", () => {
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
    expect(result.startLength).to.be.closeTo((30 / 180) * domain.startReach, 1e-9);
    expect(result.geometricConfidence).to.equal(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify the temporary implementation fails**

Run:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "constrained geometric answer"
```

Expected: FAIL on rank-deficient confidence and at least one constrained case.

- [ ] **Step 3: Replace the temporary clamp with exact candidate enumeration**

Add:

```js
function normalizedDistance(candidate, inherited, domain) {
  const start =
    candidate.startLength / domain.startReach -
    inherited.startLength / domain.startReach;
  const end =
    candidate.endLength / domain.endReach - inherited.endLength / domain.endReach;
  return start * start + end * end;
}

function constrainLengths(handles, domain) {
  return {
    startLength: clamp(
      handles.startLength,
      domain.minStartLength,
      domain.maxStartLength
    ),
    endLength: clamp(handles.endLength, domain.minEndLength, domain.maxEndLength),
  };
}

function inheritedHandles(request) {
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
  return constrainLengths(
    {
      startLength:
        (startLength / skeletonDomain.startReach) * request.handleDomain.startReach,
      endLength: (endLength / skeletonDomain.endReach) * request.handleDomain.endReach,
    },
    request.handleDomain
  );
}

function minimizeInsideRectangle(system, domain, inherited) {
  const candidates = [];
  const add = (startLength, endLength) => {
    if (!Number.isFinite(startLength) || !Number.isFinite(endLength)) return;
    candidates.push({
      startLength: clamp(startLength, domain.minStartLength, domain.maxStartLength),
      endLength: clamp(endLength, domain.minEndLength, domain.maxEndLength),
    });
  };

  const determinant = system.aa * system.bb - system.ab * system.ab;
  if (determinant > 0) {
    const interior = unconstrainedMinimum(system);
    if (
      interior.startLength >= domain.minStartLength &&
      interior.startLength <= domain.maxStartLength &&
      interior.endLength >= domain.minEndLength &&
      interior.endLength <= domain.maxEndLength
    ) {
      add(interior.startLength, interior.endLength);
    }
  } else if (system.aa > 0 || system.bb > 0) {
    // Rank one: project the inherited answer onto the affine minimum in
    // normalized-tension distance. Edge candidates below cover the case where
    // this projection lies outside the rectangle.
    const useFirstRow =
      system.aa * system.aa + system.ab * system.ab >=
      system.ab * system.ab + system.bb * system.bb;
    const rowStart = useFirstRow ? system.aa : system.ab;
    const rowEnd = useFirstRow ? system.ab : system.bb;
    const target = -(useFirstRow ? system.ac : system.bc);
    const missing =
      target - rowStart * inherited.startLength - rowEnd * inherited.endLength;
    const denominator =
      rowStart * rowStart * domain.startReach * domain.startReach +
      rowEnd * rowEnd * domain.endReach * domain.endReach;
    if (denominator > 0) {
      add(
        inherited.startLength +
          (missing * rowStart * domain.startReach * domain.startReach) / denominator,
        inherited.endLength +
          (missing * rowEnd * domain.endReach * domain.endReach) / denominator
      );
    }
  } else {
    add(inherited.startLength, inherited.endLength);
  }

  for (const startLength of [domain.minStartLength, domain.maxStartLength]) {
    const endLength =
      system.bb > 0
        ? -(system.bc + system.ab * startLength) / system.bb
        : inherited.endLength;
    add(startLength, endLength);
  }
  for (const endLength of [domain.minEndLength, domain.maxEndLength]) {
    const startLength =
      system.aa > 0
        ? -(system.ac + system.ab * endLength) / system.aa
        : inherited.startLength;
    add(startLength, endLength);
  }
  for (const startLength of [domain.minStartLength, domain.maxStartLength]) {
    for (const endLength of [domain.minEndLength, domain.maxEndLength]) {
      add(startLength, endLength);
    }
  }

  let best = candidates[0] ?? inherited;
  let bestError = objective(system, best.startLength, best.endLength);
  let bestDistance = normalizedDistance(best, inherited, domain);
  for (const candidate of candidates.slice(1)) {
    const error = objective(system, candidate.startLength, candidate.endLength);
    const distance = normalizedDistance(candidate, inherited, domain);
    if (error < bestError || (error === bestError && distance < bestDistance)) {
      best = candidate;
      bestError = error;
      bestDistance = distance;
    }
  }
  return { handles: best, error: Math.max(bestError, 0) };
}
```

The branch at determinant zero is the mathematical rank boundary, not a model threshold. Full-rank active sets meet on the same constrained answer; rank confidence removes the geometric answer as rank disappears.

- [ ] **Step 4: Implement the representability score**

```js
function fitQuality(system, geometricError, domain) {
  const perpendicularRms = Math.sqrt(geometricError / Math.max(system.weight, 1));
  const errorRatio = perpendicularRms / Math.max(domain.chordLength, 1);
  const errorConfidence = 1 / (1 + (errorRatio / 0.02) ** 6);
  const determinant = Math.max(system.aa * system.bb - system.ab * system.ab, 0);
  const trace = system.aa + system.bb;
  const rankScale = determinant + 1e-6 * trace * trace;
  const rankConfidence = rankScale === 0 ? 0 : determinant / rankScale;
  return {
    perpendicularRms,
    geometricConfidence: errorConfidence * rankConfidence,
  };
}
```

Do not use an epsilon comparison to force rank confidence to zero. Only clamp a negative determinant caused by roundoff, exactly as the design specifies.

- [ ] **Step 5: Wire the exact geometric result into the public solver**

At this checkpoint the public result is the constrained geometric answer, while the inherited answer is already calculated for deterministic tie-breaking:

```js
export function solveNaturalHandles(request) {
  const inherited = inheritedHandles(request);
  const samples = buildOffsetSamples(
    request.skeletonControlPoints,
    request.startSignedWidth,
    request.endSignedWidth
  );
  const system = buildPerpendicularErrorSystem(request, samples);
  const geometric = minimizeInsideRectangle(system, request.handleDomain, inherited);
  return {
    ...geometric.handles,
    ...fitQuality(system, geometric.error, request.handleDomain),
  };
}
```

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

### Task 4: Add inherited tension and the continuous representability blend

**Files:**

- Modify: `src-js/fontra-core/src/natural-handle-solver.js`
- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Add inherited-shape tests**

```js
describe("natural-handle-solver: inherited answer", () => {
  it("transfers equal skeleton tension to equal outline tension", () => {
    const request = arcRequest(100, 25);
    const result = solveNaturalHandles(request);
    expect(result.startLength / request.handleDomain.startReach).to.be.closeTo(
      result.endLength / request.handleDomain.endReach,
      1e-9
    );
  });

  it("retains deliberate unequal skeleton tension when the offset is unrepresentable", () => {
    const request = makeTightTaperRequest({
      startSkeletonLength: 40,
      endSkeletonLength: 100,
    });
    const result = solveNaturalHandles(request);
    expect(result.geometricConfidence).to.be.below(0.25);
    expect(result.endLength / request.handleDomain.endReach).to.be.above(
      result.startLength / request.handleDomain.startReach
    );
  });

  it("moves continuously from geometric to inherited authority", () => {
    const confidences = [];
    let previous = null;
    for (let width = 10; width <= 160; width += 1) {
      const result = solveNaturalHandles(makeTightTurnRequest(width));
      confidences.push(result.geometricConfidence);
      if (previous) {
        expect(Math.abs(result.startLength - previous.startLength)).to.be.below(3);
        expect(Math.abs(result.endLength - previous.endLength)).to.be.below(3);
      }
      previous = result;
    }
    expect(confidences[0]).to.be.above(confidences.at(-1));
  });
});
```

Define the requests from literal geometry:

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
```

These helpers only construct inputs; accuracy expectations remain independent of the implementation.

- [ ] **Step 2: Run and verify the unequal/unrepresentable test fails**

Run:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "inherited answer"
```

Expected: FAIL because the current result is still the geometric answer.

- [ ] **Step 3: Use the shared inherited answer in the final blend**

`inheritedHandles()` and `constrainLengths()` were added in Task 3 because the constrained solver needs the inherited answer for its secondary objective. Keep those functions single-source; do not copy their calculations into the blend.

- [ ] **Step 4: Finish `solveNaturalHandles`**

```js
export function solveNaturalHandles(request) {
  const inherited = inheritedHandles(request);
  const samples = buildOffsetSamples(
    request.skeletonControlPoints,
    request.startSignedWidth,
    request.endSignedWidth
  );
  const system = buildPerpendicularErrorSystem(request, samples);
  const geometric = minimizeInsideRectangle(system, request.handleDomain, inherited);
  const quality = fitQuality(system, geometric.error, request.handleDomain);
  const confidence = quality.geometricConfidence;
  return {
    startLength:
      inherited.startLength +
      (geometric.handles.startLength - inherited.startLength) * confidence,
    endLength:
      inherited.endLength +
      (geometric.handles.endLength - inherited.endLength) * confidence,
    geometricConfidence: confidence,
    perpendicularRms: quality.perpendicularRms,
  };
}
```

- [ ] **Step 5: Add perturbation continuity coverage**

For every nondegenerate accuracy fixture, perturb each of the eight skeleton coordinates and both widths by `1e-5`, on both signed sides. Compare the base result with perturbations of `1e-5` and `5e-6`; require the smaller perturbation's handle delta to be no greater than the larger perturbation's delta plus `1e-8`, and require both to remain below `1e-2`. Skip only the three explicit topology events named in the design.

- [ ] **Step 6: Run and commit**

```powershell
npx.cmd prettier --write src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver"
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
git commit -m "feat: blend geometric and inherited outline handles"
```

Expected: PASS.

### Task 5: Reproduce the prototype accuracy and `U^1` sweep in the pure solver

**Files:**

- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`

- [ ] **Step 1: Move the independent true-offset accuracy helper**

Move `trueOffsetPoints` and `maxDeviation` from `test-offset-cubic.js` into the new solver test. Change `maxDeviation` to call `solveNaturalHandles()` and return both:

```js
return {
  maxDeviation: worst,
  geometricConfidence: result.geometricConfidence,
  perpendicularRms: result.perpendicularRms,
};
```

Keep the target curve generation and nearest-distance measurement independent of the solver. Do not call solver sampling helpers from the test.

- [ ] **Step 2: Add all accuracy cases with confidence diagnostics**

```js
for (const testCase of [
  ["circular outward", quarterCirclePoints, 25, 25, 0.1],
  ["circular inward", quarterCirclePoints, -40, -40, 0.1],
  ["S-curve left", sCurve, 35, 35, 2.5],
  ["S-curve right", sCurve, -35, -35, 2.5],
  ["tight inward turn", tightTurn, -70, -70, 0.6],
  ["shallow wide offset", shallowCurve, 70, 70, 0.25],
  ["unequal handles", unequalCurve, 50, 50, 0.4],
]) {
  const [name, points, d0, d3, ceiling] = testCase;
  it(`meets the existing accuracy ceiling for ${name}`, () => {
    const measured = maxDeviation(points, d0, d3);
    expect(
      measured.maxDeviation,
      `confidence=${measured.geometricConfidence}, rms=${measured.perpendicularRms}`
    ).to.be.at.most(ceiling);
  });
}
```

- [ ] **Step 3: Add the pure `U^1` sweep**

Use the `U1` geometry from Task 1 and construct `NaturalHandleRequest` objects for single-sided right, single-sided left, double-sided outer, and double-sided inner. Assert:

- both natural lengths are monotone with a `1e-9` numerical allowance;
- worst adjacent step is at most `3`;
- forward and reverse requests return byte-identical reversed result arrays;
- all confidences and RMS values are finite;
- at least the unrepresentable single-sided case has lower geometric confidence than the accurately representable circular cases.

- [ ] **Step 4: Run the focused suite and record measurements**

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "natural-handle-solver"
```

Expected: PASS. Record the measured worst step and each accuracy maximum for Task 9. The implementation must meet the ceilings; do not regenerate fixtures to hide a miss.

- [ ] **Step 5: Commit**

```powershell
git add src-js/fontra-core/tests/test-natural-handle-solver.js
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

Expected: PASS before the rewrite. If the pin tolerance is limited by current intermediate rounding, assert the current observed grid tolerance for this pre-change run, then tighten it to `1e-9` after Step 3 removes internal rounding.

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
  return {
    startLength: clamp(
      handles.startLength,
      domain.minStartLength,
      domain.maxStartLength
    ),
    endLength: clamp(handles.endLength, domain.minEndLength, domain.maxEndLength),
  };
}

function dotAdjustment(adjustment, direction) {
  return (adjustment?.x ?? 0) * direction.x + (adjustment?.y ?? 0) * direction.y;
}

function applyAttachedAdjustments(handles, request, domain) {
  return constrain(
    {
      startLength:
        handles.startLength +
        (request.startAdjustment?.detached
          ? 0
          : dotAdjustment(request.startAdjustment, request.u0)),
      endLength:
        handles.endLength +
        (request.endAdjustment?.detached
          ? 0
          : dotAdjustment(request.endAdjustment, request.u1)),
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
    startLength: request.startAdjustment?.detached
      ? Math.max(dotAdjustment(request.startAdjustment, request.u0), MIN_HANDLE_LENGTH)
      : handles.startLength,
    endLength: request.endAdjustment?.detached
      ? Math.max(dotAdjustment(request.endAdjustment, request.u1), MIN_HANDLE_LENGTH)
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

Do not round attached or detached calculations here. `skeleton-generator.js` already rounds generated handle coordinates at emission, and the natural solver must stay entirely floating point.

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

- add `natural-handle-solver.js` as the fixed-sample quadratic fit, inherited-tension fallback, and representability blend;
- change `offset-cubic.js` to the authored cubic-side orchestrator;
- update test filenames and measured line/test counts from the actual tree;
- preserve rails R-A through R-G and the generator/provenance ownership.

- [ ] **Step 2: Replace the obsolete feature-model construction**

Rewrite §3.2 so its durable pipeline is:

```text
exact rib endpoints + skeleton-owned directions
    -> fixed requested-offset samples at source parameters
    -> convex perpendicular-error fit inside the handle domain
       + inherited skeleton tension inside the same domain
    -> continuous residual/rank confidence blend
    -> attached handle adjustments
    -> pinned harmonic-mean tension
    -> detached absolute handles
    -> generator emission and grid rounding
```

Delete statements that fixed iteration count, candidate projection, magnitude re-solve, or error-budget bisection are part of the current continuity contract. Retain them only in §8 as historical rejected approaches, with the corrected conclusion: fixed trip count gives determinism but cannot make candidate rematching or threshold search continuous.

Update §5 preservation requirements to name:

- fixed sample identity;
- no projection/root finding/iterative refit/error-budget search in the automatic path;
- continuous rank and residual confidence;
- positive non-crossing domain;
- authored adjustment/pin/detach ordering;
- the three explicit topology/emission events.

- [ ] **Step 3: Append the development-log result**

Record:

- the original failing side and worst step from Task 1;
- the final worst `U^1` step in each width mode;
- circular, S-curve, tight-turn, shallow-wide, and unequal-handle deviation;
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
