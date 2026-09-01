# Harmonize Rework Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This
> project does not use subagents or worktrees. Execute the tasks in order on the
> current branch, and commit after each task.

**Goal:** Make one control name one construction, so a press produces one answer
instead of a ranked field of answers.

**Architecture:** A new pure module solves for the smallest change to four handle
lengths that makes the two curvatures at a joint equal. `harmonization.js` gains
a sweep that applies it over a contour. The press loses its field of competing
constructions, its sixteen rounds and the ranks that compared constructions. What
survives of the scoring is two refusals and the whole-unit search. The panel's
four tick boxes become one slider with three positions.

**Tech Stack:** JavaScript, ES modules. Tests are mocha and chai, run from
`src-js/fontra-core` with `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-01-harmonize-rework-design.md`, with the
measurements in `docs/superpowers/specs/2026-09-01-harmonize-rework-problem.md`.

## Global Constraints

- **Test baseline is 2315 passing** (`cd src-js/fontra-core && npm test`). It must
  never go down. Deleted features take their tests with them, so state the new
  number in each commit that removes tests.
- **Rail R-A.** Pure geometry and math go in `fontra-core/src/` with mocha tests.
  The editor gets no math.
- **Rail R-B.** One copy of every constant and geometry function. Import
  `calculateTunniPoint` from `tunni-calculations.js`. Do not write a second
  tangent-crossing routine.
- **Rail R-G.** `views-editor` has no test harness. Every editor change carries a
  manual test matrix in this plan. Every commit runs `node --check` on each
  touched editor file and `npx prettier --write` on every touched file. The user
  runs the bundle watcher and reports compilation errors.
- **Write per point, never a whole path.** Every write goes through
  `writePoint`, which skips a point already at the position asked for.
- **Whole units.** The editor turns rounding on. The math stays exact.
- **The tension ceiling is 1.** No handle may reach past its segment's
  tangent-ray crossing.
- **The handle floor is one unit** for an automatic answer.

---

### Task 1: The nearest-answer solver

A pure module. It knows about seven points and nothing about paths, contours or
reports.

**Files:**

- Create: `src-js/fontra-core/src/harmonize-nearest.js`
- Test: `src-js/fontra-core/tests/test-harmonize-nearest.js`

**Interfaces:**

- Consumes: `calculateTunniPoint(segmentPoints)` from
  `src-js/fontra-core/src/tunni-calculations.js`. It takes an array of four
  points `[start, control1, control2, end]` and returns the crossing of the two
  tangent rays, or `null` where they do not cross ahead.
- Produces:
  `solveNearestHandleScales(stencil, options) -> { scales, status, reason, curvatureStep }`
  - `stencil` is an array of seven points, in this order:
    `[A, PP, P, node, N, NN, C]`. `A` and `C` are on-curve. `node` is the smooth
    on-curve joint. `PP` and `NN` are the outer off-curve points. `P` and `N` are
    the inner off-curve points. Each point is `{x, y}`.
  - `options` is `{ maxHandleTension = 1, minHandleLength = 1, iterations = 80 }`.
  - `scales` is an array of four multipliers, in the order
    `[A→PP, node→P, node→N, C→NN]`. A multiplier of 1 leaves that handle where it
    is.
  - `status` is `"solved"`, `"partial"` or `"skipped"`.
  - `reason` is `undefined` when solved, `"tension-limited"` where a handle sits
    on a limit and the curvatures still differ, `"degenerate"` where the two
    sides curve to opposite sides of the tangent so no set of lengths can match
    them, and `"already-harmonic"` where the drawing arrived matched.
  - `curvatureStep` is the relative curvature difference left behind:
    `|kIn - kOut| / max(|kIn|, |kOut|, 1e-12)`.

- [ ] **Step 1: Write the failing tests**

Create `src-js/fontra-core/tests/test-harmonize-nearest.js`:

```js
import { solveNearestHandleScales } from "@fontra/core/harmonize-nearest.js";
import { expect } from "chai";

// A joint whose two sides bend by different amounts. The stencil order is
// [A, PP, P, node, N, NN, C].
function askewJoint() {
  return [
    { x: 0, y: 0 },
    { x: 0, y: 60 },
    { x: 40, y: 100 },
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 200, y: 60 },
    { x: 200, y: 0 },
  ];
}

// Both sides identical about the joint, so nothing needs to move.
function symmetricJoint() {
  return [
    { x: 0, y: 0 },
    { x: 0, y: 50 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 200, y: 50 },
    { x: 200, y: 0 },
  ];
}

function build(stencil, scales) {
  const scaled = (from, handle, scale) => ({
    x: from.x + (handle.x - from.x) * scale,
    y: from.y + (handle.y - from.y) * scale,
  });
  const [A, PP, P, node, N, NN, C] = stencil;
  return [
    A,
    scaled(A, PP, scales[0]),
    scaled(node, P, scales[1]),
    node,
    scaled(node, N, scales[2]),
    scaled(C, NN, scales[3]),
    C,
  ];
}

function curvatureStepOf(points) {
  const [A, PP, P, node, N, NN, C] = points;
  const kIn = endCurvature([A, PP, P, node], true);
  const kOut = endCurvature([node, N, NN, C], false);
  return Math.abs(kIn - kOut) / Math.max(Math.abs(kIn), Math.abs(kOut), 1e-12);
}

// Signed curvature at one end of a cubic, from its own control points.
function endCurvature([p0, p1, p2, p3], atEnd) {
  const [a, b, c] = atEnd ? [p3, p2, p1] : [p0, p1, p2];
  const first = { x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) };
  const second = { x: 6 * (c.x - 2 * b.x + a.x), y: 6 * (c.y - 2 * b.y + a.y) };
  const speed = Math.hypot(first.x, first.y);
  if (speed < 1e-9) {
    return 0;
  }
  const cross = first.x * second.y - first.y * second.x;
  return cross / (speed * speed * speed);
}

describe("solveNearestHandleScales", () => {
  it("matches the two curvatures exactly", () => {
    const stencil = askewJoint();
    const solved = solveNearestHandleScales(stencil, {});
    expect(solved.status).to.equal("solved");
    expect(curvatureStepOf(build(stencil, solved.scales))).to.be.below(1e-6);
  });

  it("leaves an already matched joint alone", () => {
    const solved = solveNearestHandleScales(symmetricJoint(), {});
    expect(solved.status).to.equal("skipped");
    expect(solved.reason).to.equal("already-harmonic");
    for (const scale of solved.scales) {
      expect(scale).to.equal(1);
    }
  });

  it("moves the drawing less than a construction that moves two handles", () => {
    const stencil = askewJoint();
    const four = solveNearestHandleScales(stencil, {});
    const travel = (scales) => {
      const before = build(stencil, [1, 1, 1, 1]);
      const after = build(stencil, scales);
      let total = 0;
      for (let i = 0; i < before.length; i++) {
        total += Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y);
      }
      return total;
    };
    // the outer two handles hold still, which is what the other constructions do
    const two = solveNearestHandleScales(stencil, { outerHandlesHold: true });
    expect(travel(four.scales)).to.be.below(travel(two.scales));
  });

  it("never lets a handle past the tension ceiling", () => {
    // both sides nearly straight, so matching two near-zero curvatures asks for
    // very long handles
    const stencil = [
      { x: 0, y: 0 },
      { x: 30, y: 1 },
      { x: 70, y: 2 },
      { x: 100, y: 2 },
      { x: 140, y: 2 },
      { x: 180, y: 1 },
      { x: 220, y: 0 },
    ];
    const solved = solveNearestHandleScales(stencil, {});
    const points = build(stencil, solved.scales);
    for (const [segment, nearSide] of [
      [points.slice(0, 4), "start"],
      [points.slice(0, 4), "end"],
      [points.slice(3, 7), "start"],
      [points.slice(3, 7), "end"],
    ]) {
      expect(tensionOf(segment, nearSide)).to.be.at.most(1 + 1e-9);
    }
  });

  it("says tension-limited rather than harmonized where a limit stopped it", () => {
    const stencil = [
      { x: 0, y: 0 },
      { x: 30, y: 1 },
      { x: 70, y: 2 },
      { x: 100, y: 2 },
      { x: 140, y: 2 },
      { x: 180, y: 1 },
      { x: 220, y: 0 },
    ];
    const solved = solveNearestHandleScales(stencil, {});
    if (solved.curvatureStep > 1e-6) {
      expect(solved.status).to.equal("partial");
      expect(solved.reason).to.equal("tension-limited");
    }
  });

  it("keeps every handle at one unit or longer", () => {
    const stencil = askewJoint();
    const solved = solveNearestHandleScales(stencil, {});
    const points = build(stencil, solved.scales);
    const lengths = [
      Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y),
      Math.hypot(points[4].x - points[3].x, points[4].y - points[3].y),
      Math.hypot(points[5].x - points[6].x, points[5].y - points[6].y),
    ];
    for (const length of lengths) {
      expect(length).to.be.at.least(1 - 1e-9);
    }
  });

  it("is continuous in its input", () => {
    // Walk the far on-curve point through 120 units in quarter-unit steps and
    // measure the worst single-step movement of the answer. A per-configuration
    // assertion has missed every fault of this kind in this project.
    const base = askewJoint();
    let worst = 0;
    let previous = null;
    for (let d = -60; d <= 60 + 1e-9; d += 0.25) {
      const stencil = base.map((p) => ({ x: p.x, y: p.y }));
      stencil[6] = { x: stencil[6].x + d, y: stencil[6].y };
      const solved = solveNearestHandleScales(stencil, {});
      const points = build(stencil, solved.scales);
      // measured against the input, so the driver's own travel does not count
      const answer = points.map((p, i) => ({
        x: p.x - stencil[i].x,
        y: p.y - stencil[i].y,
      }));
      if (previous) {
        let step = 0;
        for (let i = 0; i < answer.length; i++) {
          step += Math.hypot(answer[i].x - previous[i].x, answer[i].y - previous[i].y);
        }
        worst = Math.max(worst, step);
      }
      previous = answer;
    }
    expect(worst).to.be.below(2);
  });
});

// The tension of one handle: its length over the distance from its own on-curve
// point to the segment's tangent-ray crossing.
function tensionOf(points, nearSide) {
  const [p0, p1, p2, p3] = points;
  const direction = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  const d1 = direction(p0, p1);
  const d2 = direction(p3, p2);
  const denominator = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denominator) < 1e-12) {
    return 0;
  }
  const t = ((p3.x - p0.x) * d2.y - (p3.y - p0.y) * d2.x) / denominator;
  if (t <= 0) {
    return 0;
  }
  const crossing = { x: p0.x + d1.x * t, y: p0.y + d1.y * t };
  const [onCurve, handle] = nearSide === "start" ? [p0, p1] : [p3, p2];
  const reach = Math.hypot(crossing.x - onCurve.x, crossing.y - onCurve.y);
  return reach
    ? Math.hypot(handle.x - onCurve.x, handle.y - onCurve.y) / reach
    : Infinity;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-harmonize-nearest.js`
Expected: FAIL, cannot resolve `@fontra/core/harmonize-nearest.js`.

- [ ] **Step 3: Write the module**

Create `src-js/fontra-core/src/harmonize-nearest.js`:

```js
//
// The nearest answer.
//
// One equation -- the two curvatures at a joint must be equal -- and four
// unknowns, one multiplier per handle length. Infinitely many sets of
// multipliers satisfy it. This module returns the set nearest to the drawing.
//
// It is ported from `_external/g1_g2_g3_bezier_harmonizer.html`, which is about
// thirty lines of solver. Three details of that solver are load-bearing and are
// kept exactly.
//
//   * The unknowns are the LOGARITHMS of the multipliers. So a small change is a
//     small percentage of each handle rather than a small number of units, and
//     the correction spreads over the four handles in proportion to what each
//     one can contribute.
//   * The step is the minimum-norm Gauss-Newton step. That is what makes the
//     answer the nearest one rather than one particular one.
//   * Each step is capped at forty per cent of any one multiplier and then taken
//     at nine tenths. Without the cap and the undershoot a step near an
//     ill-conditioned joint overshoots and the next step comes back.
//
// Two limits are added here and are not in the reference. Neither is optional.
//
//   * No handle may pass its segment's tangent-ray crossing. Past it the two
//     handle lines cross and the curve doubles back. Where the two curvatures
//     both approach zero -- a joint near an inflection -- matching them asks for
//     arbitrarily long handles, so this limit is reached in ordinary use rather
//     than at an extreme. Measured on point 19 of `_external/problem-glyphs/I^1.json`:
//     over three units of drag the answer asks for a tension of 3.85.
//   * No handle may be shorter than one unit. This is the automatic answer's
//     floor, the same one the offset construction uses. A hand may put a handle
//     on its own point; a solver may not, because below a unit a handle
//     expresses only three directions on the grid.
//
// Both limits are computed ONCE, before the first step, and they do not move.
// The handles keep their directions, so the tangent-ray crossing is fixed for
// the whole solve.
//
import { calculateTunniPoint } from "./tunni-calculations.js";

// The residual is scaled by a fixed length so that the Gauss-Newton system is
// conditioned in the same range whatever the glyph's units are. With one
// equation the scale cancels out of the step exactly; it is kept because the
// reference has it and because it will not cancel if a second equation is ever
// added here.
const RESIDUAL_SCALE = 200;

// The finite difference used to build the Jacobian, in log space.
const DERIVATIVE_STEP = 1e-4;

// No multiplier's logarithm may change by more than this in one iteration.
const MAX_LOG_STEP = 0.4;

// Each step is taken at this fraction of its full length.
const UNDERSHOOT = 0.9;

// The answer is matched when the relative curvature difference is under this.
const MATCHED = 1e-6;

const MAX_ITERATIONS = 80;

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v) {
  return Math.hypot(v.x, v.y);
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Signed curvature at one end of a cubic, from that end's last three control
// points. This is the whole of what the end curvature depends on.
function endCurvature([p0, p1, p2, p3], atEnd) {
  const [a, b, c] = atEnd ? [p3, p2, p1] : [p0, p1, p2];
  const first = { x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) };
  const second = { x: 6 * (c.x - 2 * b.x + a.x), y: 6 * (c.y - 2 * b.y + a.y) };
  const speed = length(first);
  if (speed < 1e-9) {
    return 0;
  }
  return cross(first, second) / (speed * speed * speed);
}

// The four handles of a joint, each as the on-curve point it grows from, its
// direction and its present length. The order is the order of `scales`:
// [A -> PP, node -> P, node -> N, C -> NN].
function handlesOf(stencil) {
  const [A, PP, P, node, N, NN, C] = stencil;
  const one = (from, handle) => {
    const delta = subtract(handle, from);
    const len = length(delta) || 1e-9;
    return { from, ux: delta.x / len, uy: delta.y / len, length: len };
  };
  return [one(A, PP), one(node, P), one(node, N), one(C, NN)];
}

function buildStencil(stencil, handles, scales) {
  const placed = handles.map((h, k) => ({
    x: h.from.x + h.ux * h.length * scales[k],
    y: h.from.y + h.uy * h.length * scales[k],
  }));
  return [
    stencil[0],
    placed[0],
    placed[1],
    stencil[3],
    placed[2],
    placed[3],
    stencil[6],
  ];
}

function segmentsOf(points) {
  return [points.slice(0, 4), points.slice(3, 7)];
}

function curvatureStepOf(points) {
  const [incoming, outgoing] = segmentsOf(points);
  const kIn = endCurvature(incoming, true);
  const kOut = endCurvature(outgoing, false);
  return Math.abs(kIn - kOut) / Math.max(Math.abs(kIn), Math.abs(kOut), 1e-12);
}

function residualOf(points) {
  const [incoming, outgoing] = segmentsOf(points);
  return (
    (endCurvature(incoming, true) - endCurvature(outgoing, false)) * RESIDUAL_SCALE
  );
}

//
// The largest multiplier each handle may take, from the tangent-ray crossing of
// its own segment. Where the two rays do not cross ahead of the segment there
// is nothing to pass, so that handle has no ceiling here.
//
function ceilingScales(stencil, handles, maxHandleTension) {
  const [incoming, outgoing] = segmentsOf(stencil);
  const reach = (segment, nearSide) => {
    const crossing = calculateTunniPoint(segment);
    if (!crossing) {
      return Infinity;
    }
    const onCurve = nearSide === "start" ? segment[0] : segment[3];
    return length(subtract(crossing, onCurve));
  };
  const reaches = [
    reach(incoming, "start"),
    reach(incoming, "end"),
    reach(outgoing, "start"),
    reach(outgoing, "end"),
  ];
  return reaches.map((r, k) =>
    Number.isFinite(r) ? (maxHandleTension * r) / handles[k].length : Infinity
  );
}

export function solveNearestHandleScales(stencil, options = {}) {
  const {
    maxHandleTension = 1,
    minHandleLength = 1,
    iterations = MAX_ITERATIONS,
    // Hold the two outer handles still. This exists so a test can compare the
    // four-handle answer against the same solve restricted to the two handles
    // the other constructions move. Production never sets it.
    outerHandlesHold = false,
  } = options;

  const handles = handlesOf(stencil);
  const scales = [1, 1, 1, 1];
  const arrived = curvatureStepOf(stencil);
  if (arrived <= MATCHED) {
    return {
      scales,
      status: "skipped",
      reason: "already-harmonic",
      curvatureStep: arrived,
    };
  }

  const dials = outerHandlesHold ? [0, 1, 1, 0] : [1, 1, 1, 1];
  const ceilings = ceilingScales(stencil, handles, maxHandleTension);
  const floors = handles.map((h, k) =>
    Math.min(minHandleLength / h.length, ceilings[k])
  );
  const onALimit = () =>
    scales.some(
      (s, k) => dials[k] && (s >= ceilings[k] - 1e-12 || s <= floors[k] + 1e-12)
    );

  for (let iteration = 0; iteration < iterations; iteration++) {
    const residual = residualOf(buildStencil(stencil, handles, scales));
    if (Math.abs(residual) < 1e-10) {
      break;
    }

    // One row, four columns: how the residual answers a small change in each
    // multiplier's logarithm.
    const jacobian = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      if (!dials[k]) {
        continue;
      }
      const stepped = scales.slice();
      stepped[k] *= Math.exp(DERIVATIVE_STEP);
      const other = residualOf(buildStencil(stencil, handles, stepped));
      jacobian[k] = (other - residual) / DERIVATIVE_STEP;
    }

    // The minimum-norm solution of one equation in four unknowns: the step lies
    // along the Jacobian's own direction. The small addition keeps the division
    // finite where the joint gives the solver nothing to pull on.
    let normal = 1e-7;
    for (let k = 0; k < 4; k++) {
      normal += jacobian[k] * jacobian[k];
    }
    const multiplier = -residual / normal;

    let largest = 0;
    for (let k = 0; k < 4; k++) {
      largest = Math.max(largest, Math.abs(jacobian[k] * multiplier));
    }
    if (largest === 0) {
      break;
    }
    const damping = largest > MAX_LOG_STEP ? MAX_LOG_STEP / largest : 1;

    for (let k = 0; k < 4; k++) {
      if (!dials[k]) {
        continue;
      }
      scales[k] *= Math.exp(jacobian[k] * multiplier * damping * UNDERSHOOT);
      scales[k] = Math.min(ceilings[k], Math.max(floors[k], scales[k]));
    }
  }

  const curvatureStep = curvatureStepOf(buildStencil(stencil, handles, scales));
  if (curvatureStep <= MATCHED) {
    return { scales, status: "solved", reason: undefined, curvatureStep };
  }
  return {
    scales,
    status: "partial",
    // A limit stopped it, or no set of lengths can match these two sides at all.
    // The second happens where the two sides curve to opposite sides of the
    // tangent: one curvature is positive and the other negative, and scaling a
    // length cannot change a sign.
    reason: onALimit() ? "tension-limited" : "degenerate",
    curvatureStep,
  };
}

// The four handle positions an answer asks for, in the stencil's own order.
export function applyHandleScales(stencil, scales) {
  return buildStencil(stencil, handlesOf(stencil), scales);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-harmonize-nearest.js`
Expected: PASS, 7 passing.

If the continuity test fails, do not raise its bound. Print the worst step and
the input it happened at, and find out what the answer did there. The bound of 2
units against a quarter-unit driver step is eight times the driver, which is
already generous.

- [ ] **Step 5: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`
Expected: 2322 passing.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(harmonize): the nearest answer, as a solver of its own"
```

---

### Task 2: Apply the nearest answer over a contour

**Files:**

- Modify: `src-js/fontra-core/src/harmonization.js`
- Test: `src-js/fontra-core/tests/test-harmonization.js`

**Interfaces:**

- Consumes: `solveNearestHandleScales` and `applyHandleScales` from Task 1.
  Consumes these existing private helpers of `harmonization.js`, unchanged:
  `getJointContext(path, pointIndex)`, which returns `{node, P, N, ...}` or
  `{reason}`; `jointStencil(path, ctx)`, which returns
  `{incoming: [p0,p1,p2,p3], outgoing: [q0,q1,q2,q3]}` or `null`;
  `jointSegments(path, ctx)`, which returns `[{nearSide, indices}, ...]`;
  `expandToJoints(path, pointIndices)`; `writePoint(path, touched, index, point)`;
  `snapToGrid(path, touched, jointResidual, isBetter)`; `scoreJoints`; `isBetter`.
- Produces: `harmonizeNearestInPlace(path, pointIndices, options) -> report`,
  exported. The report is an array of per-joint states of the same shape the
  other construction produces: `{pointIndex, contourIndex, status, reason,
construction, everMoved}`. `status` is `"harmonized"`, `"partial"` or
  `"skipped"`. `construction` is `"nearest"`.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-harmonization.js`:

```js
describe("harmonizeNearestInPlace", () => {
  it("matches the two curvatures at a joint", () => {
    const path = asymmetricPath();
    harmonizeNearestInPlace(path, [NODE], {});
    const ctx = getJointContext(path, NODE);
    expect(measureG2Discontinuity(ctx)).to.be.below(1e-6);
  });

  it("moves the outer handles, which the joint construction does not", () => {
    const path = asymmetricPath();
    const before = [...path.coordinates];
    harmonizeNearestInPlace(path, [NODE], {});
    // PP is point 1 and NN is point 5 of the fixture contour
    const outerMoved =
      path.coordinates[2] !== before[2] ||
      path.coordinates[3] !== before[3] ||
      path.coordinates[10] !== before[10] ||
      path.coordinates[11] !== before[11];
    expect(outerMoved).to.be.true;
  });

  it("never moves an on-curve point", () => {
    const path = asymmetricPath();
    const before = [...path.coordinates];
    harmonizeNearestInPlace(path, [NODE], {});
    for (const index of [0, 3, 6]) {
      expect(path.coordinates[index * 2]).to.equal(before[index * 2]);
      expect(path.coordinates[index * 2 + 1]).to.equal(before[index * 2 + 1]);
    }
  });

  it("writes nothing on a joint that is already harmonic", () => {
    const path = symmetricPath();
    const before = [...path.coordinates];
    const report = harmonizeNearestInPlace(path, [NODE], {});
    expect([...path.coordinates]).to.deep.equal(before);
    expect(report[0].status).to.equal("skipped");
    expect(report[0].reason).to.equal("already-harmonic");
  });

  it("is a fixed point: a second call moves nothing", () => {
    const path = asymmetricPath();
    harmonizeNearestInPlace(path, [NODE], { roundCoordinates: true });
    const after = [...path.coordinates];
    harmonizeNearestInPlace(path, [NODE], { roundCoordinates: true });
    expect([...path.coordinates]).to.deep.equal(after);
  });

  it("settles a ring where every joint disturbs its neighbours", () => {
    const path = roundContourPath();
    const report = harmonizeNearestInPlace(path, null, { roundCoordinates: true });
    expect(report.length).to.be.above(1);
    for (const state of report) {
      expect(state.status).to.not.equal("partial");
    }
  });
});
```

`asymmetricPath`, `symmetricPath` and `NODE` already exist in this test file. If
`roundContourPath` does not exist, add it beside the other fixtures:

```js
// A closed ring of four curve segments, so every joint shares a segment with
// two others and one joint's answer disturbs them.
function roundContourPath() {
  return makeContour([
    { x: 0, y: 100 },
    cubic(0, 155),
    cubic(45, 200),
    { x: 100, y: 200, smooth: true },
    cubic(155, 200),
    cubic(200, 155),
    { x: 200, y: 100, smooth: true },
    cubic(200, 45),
    cubic(155, 0),
    { x: 100, y: 0, smooth: true },
    cubic(45, 0),
    cubic(0, 45),
  ]);
}
```

Add `harmonizeNearestInPlace` to the import list at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-harmonization.js -g harmonizeNearestInPlace`
Expected: FAIL, `harmonizeNearestInPlace is not a function`.

- [ ] **Step 3: Write the sweep**

Add to `src-js/fontra-core/src/harmonization.js`, beside
`harmonizeByJointInPlace`. Add the import at the top of the file:

```js
import { solveNearestHandleScales } from "./harmonize-nearest.js";
```

Then:

```js
//
// The nearest answer, applied over a selection.
//
// The solver moves the two OUTER handles as well as the two inner ones, which
// is what buys its accuracy: on point 3 of `_external/problem-glyphs/N^1.json`
// the four-handle answer moves the drawing 11.1 units and the same solve
// restricted to the two inner handles moves 36.2.
//
// An outer handle of one joint is an inner handle of the next joint along, so a
// joint's answer changes its neighbours' inputs. That is what the sweep is for,
// and it is the same reason the other construction sweeps.
//
export function harmonizeNearestInPlace(path, pointIndices, options = {}) {
  const { toleranceUnits, maxIterations, maxHandleTension, roundCoordinates } = {
    ...HARMONIZE_DEFAULTS,
    ...options,
  };

  const candidates = pointIndices?.length
    ? [...new Set(pointIndices)].sort((a, b) => a - b)
    : expandToJoints(path, undefined);

  const touched = new Set();
  const states = new Map();
  for (const pointIndex of candidates) {
    states.set(pointIndex, {
      pointIndex,
      contourIndex: path.getContourIndex(pointIndex),
      status: undefined,
      reason: undefined,
      construction: "nearest",
      everMoved: false,
    });
  }

  // What each joint arrived with, captured before anything moves, so the score
  // can tell a joint this command broke from one that was already unreadable.
  const arrival = new Map();
  for (const pointIndex of candidates) {
    const ctx = getJointContext(path, pointIndex);
    if (!ctx.reason) {
      arrival.set(pointIndex, relativeCurvatureStep(path, ctx));
    }
  }

  const scoreLimits = { maxHandleTension };
  const jointResidual = () => scoreJoints(path, candidates, "G2", scoreLimits, arrival);

  for (let pass = 0; pass < maxIterations; pass++) {
    let anyMoved = false;

    for (const pointIndex of candidates) {
      const state = states.get(pointIndex);
      const ctx = getJointContext(path, pointIndex);
      if (ctx.reason) {
        state.status = "skipped";
        state.reason = ctx.reason;
        continue;
      }
      const stencil = jointStencil(path, ctx);
      if (!stencil) {
        state.status = "skipped";
        state.reason = "not-curve-joint";
        continue;
      }

      const segments = jointSegments(path, ctx);
      const [incoming, outgoing] = segments;
      const seven = [
        stencil.incoming[0],
        stencil.incoming[1],
        stencil.incoming[2],
        stencil.incoming[3],
        stencil.outgoing[1],
        stencil.outgoing[2],
        stencil.outgoing[3],
      ];

      const solved = solveNearestHandleScales(seven, { maxHandleTension });
      state.status = solved.status === "solved" ? "harmonized" : solved.status;
      state.reason = solved.reason;
      if (solved.status === "skipped") {
        continue;
      }

      // The four handle point indices, in the solver's own order:
      // A -> PP, node -> P, node -> N, C -> NN.
      const handleIndices = [
        incoming.indices[1],
        incoming.indices[2],
        outgoing.indices[1],
        outgoing.indices[2],
      ];
      const placed = applyHandleScales(seven, solved.scales);
      const placedHandles = [placed[1], placed[2], placed[4], placed[5]];

      for (let k = 0; k < 4; k++) {
        const [x, y] = path.getPointPosition(handleIndices[k]);
        const target = placedHandles[k];
        if (Math.hypot(target.x - x, target.y - y) > toleranceUnits) {
          anyMoved = true;
          state.everMoved = true;
        }
        writePoint(path, touched, handleIndices[k], target);
      }
    }

    if (!anyMoved) {
      break;
    }
  }

  if (roundCoordinates) {
    snapToGrid(path, touched, jointResidual, isBetter);
  }

  // A joint whose handles all came back to where they started did nothing, and
  // the verdict describes the drawing that was kept.
  for (const state of states.values()) {
    if (state.status === "harmonized" && !state.everMoved) {
      state.status = "skipped";
      state.reason = "below-grid";
    }
  }

  return [...states.values()];
}
```

Add `applyHandleScales` to the same import line as `solveNearestHandleScales`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-harmonization.js -g harmonizeNearestInPlace`
Expected: PASS, 6 passing.

- [ ] **Step 5: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`
Expected: 2328 passing.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(harmonize): sweep the nearest answer over a selection"
```

---

### Task 3: Cut the score down to the refusals and the grid

The ranks that compared one construction against another have nothing to compare
once a control names the construction. Two ranks are invariants and stay. The
grid search keeps using the score, so it must gain the tie-breaker the outer gate
used to add.

**Files:**

- Modify: `src-js/fontra-core/src/harmonization.js`
- Test: `src-js/fontra-core/tests/test-harmonization.js`

**Interfaces:**

- Produces: `scoreJoints(path, candidates, continuity, limits, arrival)` returns
  `{broken, crossed, creased, residual, travel}` and nothing else. `limits` is
  `{maxHandleTension}`. The `ceilings` and `balanceTolerance` entries are gone.
  `SCORE_RANKS` is `["broken", "crossed", "creased", "residual", "travel"]`.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-harmonization.js`:

```js
describe("the score", () => {
  it("ranks a crease above any amount of curvature agreement", () => {
    const better = { broken: 0, crossed: 0, creased: 1, residual: 0, travel: 0 };
    const worse = { broken: 0, crossed: 0, creased: 0, residual: 10, travel: 0 };
    expect(isBetterForTest(worse, better)).to.be.true;
  });

  it("breaks a tie by how far the drawing moved", () => {
    const near = { broken: 0, crossed: 0, creased: 0, residual: 1, travel: 5 };
    const far = { broken: 0, crossed: 0, creased: 0, residual: 1, travel: 50 };
    expect(isBetterForTest(near, far)).to.be.true;
  });

  it("has no rank for bending energy", () => {
    const path = asymmetricPath();
    const score = scoreJointsForTest(
      path,
      [NODE],
      "G2",
      { maxHandleTension: 1 },
      new Map()
    );
    expect(score).to.not.have.property("unfair");
    expect(score).to.not.have.property("stepped");
    expect(score).to.not.have.property("refused");
    expect(score).to.not.have.property("unbalanced");
  });
});
```

Export the two names the test needs from `harmonization.js`, for the test alone:

```js
export { scoreJoints as scoreJointsForTest, isBetter as isBetterForTest };
```

Add both to the test file's import list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-harmonization.js -g "the score"`
Expected: FAIL, the score still carries `unfair`, `stepped`, `refused` and
`unbalanced`.

- [ ] **Step 3: Cut the score**

In `src-js/fontra-core/src/harmonization.js`:

1. In `scoreJoints`, delete the `stepped`, `unfair` and `unbalanced` counters and
   every line that writes them. That removes the `arrived` and `ceiling` block,
   the `jointUnfairness` call and the whole `limits.balanceTolerance` block.
2. Keep the `broken` counter, both of its cases, and the `arrival` argument that
   feeds it.
3. Keep the `creased` check and the `crossed` check.
4. Replace the two return objects with one:
   `return { broken, crossed, creased, residual, travel: 0 };`
   The residual keeps its `jointError(stencil, continuity)` term, so a G3 caller
   still measures the rate. The G2 and G3 branches differed only by where
   `unfair` went, and `unfair` is gone.
5. Replace `SCORE_RANKS` with
   `const SCORE_RANKS = ["broken", "crossed", "creased", "residual", "travel"];`
   and keep the comment block above it, cut down to the five that remain.
6. Delete `jointUnfairness`, `bendingEnergyOf`, `combHasNotch`,
   `curvatureAtParameter`, `cubicVelocity`, `COMB_SAMPLES`, `segmentImbalance`,
   `BALANCE_TOLERANCE`, `REFUSAL_REASONS` and `refusalCount`, unless a grep shows
   another caller. Run this grep before deleting each one:
   `grep -rn "<name>" --include=*.js src-js`
   `balancePathInPlace` may use some of them. Anything it uses stays.
7. In `harmonizeByJointInPlace`, make the grid search's score carry travel.
   Immediately before `const jointResidual = ...`, add:

```js
// How far the drawing has moved from where the command found it. The grid
// search needs this to break a tie between two whole-unit positions that
// leave the joint equally good: the one that changed less of what the
// designer drew is the one to keep.
const startedAt = Array.from(path.coordinates);
const travelSoFar = () => {
  let travel = 0;
  for (let index = 0; index < path.numPoints; index++) {
    const [x, y] = path.getPointPosition(index);
    travel += Math.hypot(x - startedAt[index * 2], y - startedAt[index * 2 + 1]);
  }
  return travel;
};
```

and change `jointResidual` to

```js
const jointResidual = () => ({
  ...scoreJoints(path, candidates, continuity, scoreLimits, arrivalCurvature),
  travel: travelSoFar(),
});
```

8. Do the same in `harmonizeNearestInPlace`, which Task 2 gave the same
   `jointResidual` shape.

- [ ] **Step 4: Run the tests**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS. Tests asserting the removed ranks fail. Delete those tests, and
say in the commit message how many went and why. Do not weaken a test to keep it.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "refactor(harmonize): the score keeps the refusals and drops the preferences"
```

---

### Task 4: One control, one construction

**Files:**

- Modify: `src-js/fontra-core/src/harmonization.js`
- Test: `src-js/fontra-core/tests/test-harmonization.js`

**Interfaces:**

- Produces: `harmonizePathInPlace(path, pointIndices, options)` and
  `harmonizePath(path, pointIndices, options)`, with these options:
  - `method`: `"nearest"`, `"canonical"` or `"canonical-slide"`. Default
    `"canonical"`.
  - `continuity`: `"G2"` or `"G3"`. Default `"G2"`. Under `"G3"` the method is
    forced to `"canonical"`.
  - `cuspSafetyMargin`, `toleranceUnits`, `maxIterations`, `maxHandleTension`,
    `roundCoordinates`, unchanged.
  - Gone: `slideOnCurve`, `handleBias`, `matchCurvature`, `realignHandles`,
    `pressAttempts`, `maxCurvatureStep`.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-harmonization.js`:

```js
describe("harmonizePathInPlace, one construction per press", () => {
  it("presses to a fixed point", () => {
    for (const method of ["nearest", "canonical", "canonical-slide"]) {
      const path = asymmetricPath();
      harmonizePathInPlace(path, [NODE], { method, roundCoordinates: true });
      const after = [...path.coordinates];
      harmonizePathInPlace(path, [NODE], { method, roundCoordinates: true });
      expect([...path.coordinates], method).to.deep.equal(after);
    }
  });

  it("runs the nearest construction when it is asked for", () => {
    const path = asymmetricPath();
    const report = harmonizePathInPlace(path, [NODE], { method: "nearest" });
    expect(report[0].construction).to.equal("nearest");
  });

  it("forces the canonical construction under G3", () => {
    const path = asymmetricPath();
    const report = harmonizePathInPlace(path, [NODE], {
      method: "nearest",
      continuity: "G3",
    });
    expect(report[0].construction).to.not.equal("nearest");
  });

  it("realigns without being asked", () => {
    const path = bentSmoothJointPath();
    harmonizePathInPlace(path, [NODE], { method: "canonical" });
    const ctx = getJointContext(path, NODE);
    // the joint and its two handles are back on one line
    const cross =
      (ctx.node.x - ctx.P.x) * (ctx.N.y - ctx.node.y) -
      (ctx.node.y - ctx.P.y) * (ctx.N.x - ctx.node.x);
    expect(Math.abs(cross)).to.be.below(1);
  });
});
```

`bentSmoothJointPath` already exists in this test file as the fixture the realign
tests use. If it is named differently, use that name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-harmonization.js -g "one construction per press"`
Expected: FAIL, `method` is not read.

- [ ] **Step 3: Rewrite the press**

In `HARMONIZE_DEFAULTS`, delete `slideOnCurve`, `handleBias`, `matchCurvature`,
`realignHandles`, `pressAttempts` and `maxCurvatureStep`. Add:

```js
  // Which construction runs. The designer names it, so one press draws one
  // answer.
  //
  //   nearest          the smallest change to the four handle lengths that
  //                    makes the two curvatures equal
  //   canonical        the two inner handle lengths, moved to one particular
  //                    ratio, with the joint held still
  //   canonical-slide  the same, and the joint may slide along its tangent
  //
  // Until 2026-09-01 the press drew several of these at once and ranked them,
  // and the rank on bending energy is what spent 85 units of movement on a
  // joint that arrived 4.177% out. A tick box on the panel was therefore not a
  // switch: it added an answer to a field which then decided whether to keep
  // it. See the design document.
  method: "canonical",
```

Keep `handleBias` OUT of the defaults and pass it into
`harmonizeByJointInPlace` from `method` instead: `canonical` passes
`{slideOnCurve: false, handleBias: 1}` and `canonical-slide` passes
`{slideOnCurve: true, handleBias: 0}`. `harmonizeByJointInPlace` keeps reading
those two names internally and does not change.

Rewrite the body of `harmonizePathInPlace` to this shape:

```js
export function harmonizePathInPlace(path, pointIndices, options = {}) {
  const { continuity, method, ...rest } = { ...HARMONIZE_DEFAULTS, ...options };

  const candidates = pointIndices?.length
    ? [...new Set(pointIndices)].sort((a, b) => a - b)
    : expandToJoints(path, undefined);

  // G3 has one construction. The nearest answer on two equations steps by up to
  // 2687 units between two adjacent frames of a quarter-unit drag and reaches a
  // tension of 11.34, and moving the on-curve under G3 moves the drawing 1013
  // units on `_external/problem-glyphs/I^1.json` against 201 under G2. Both
  // measured 2026-09-01.
  const construction = continuity === "G3" ? "canonical" : method;

  // The preparation pass. It squares up a joint whose handles have drifted off
  // one line, and every construction here solves against the tangent at the
  // joint. It always runs: it fires only on a bent joint, and over every smooth
  // joint of `N^1.json` and `I^1.json` it moved 0 of 88 points.
  realignSmoothJointsInPlace(path, candidates, new Set());

  if (construction === "nearest") {
    return harmonizeNearestInPlace(path, candidates, { ...rest, continuity });
  }

  return harmonizeByJointInPlace(path, candidates, {
    ...rest,
    continuity,
    slideOnCurve: construction === "canonical-slide",
    handleBias: construction === "canonical-slide" ? 0 : 1,
  });
}
```

Delete from the old body: `solveOnce`, the `field` array, the `seen` set, the
`for (let attempt = 0; attempt < Math.max(1, pressAttempts); attempt++)` loop,
the `ceilings` map, `travelOf`, `rank`, the best-state loop, and the write-back
loop that copied the winner into `path`. The constructions write into `path`
themselves.

Keep whatever the old body did to build the returned report if the two
constructions' reports need reconciling. Both now return an array of per-joint
states, so the return is the construction's own array.

In `harmonizeByJointInPlace`, delete `maxCurvatureStep` from the destructuring
and from `scoreLimits`.

- [ ] **Step 4: Run the tests**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS. Tests asserting the old options fail. Rewrite each one to the new
option names where the behaviour it checks still exists, and delete it where the
behaviour is gone. State the count in the commit message.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(harmonize): one control names one construction"
```

---

### Task 5: Delete the handle-length construction

It has no caller left. Its tick box is gone, and the field that admitted it is
gone.

**Files:**

- Modify: `src-js/fontra-core/src/harmonization.js`
- Modify: `src-js/fontra-core/tests/test-harmonization.js`

- [ ] **Step 1: Find every reference**

Run: `grep -rn "harmonizeHandlesInPlace\|adjustHandles\|handleTargets\|writeSolvedHandles\|HARMONIZE_HANDLES_ROUNDS\|scaleHandles\|bendingEnergy\|realRoots\|bisectPolynomial\|evaluatePolynomial\|derivePolynomial\|chordFrame\|safeSqrt" --include=*.js src-js`

Expected: matches only in `harmonization.js` and `test-harmonization.js`. If
`balancePathInPlace` uses any of them, that one stays and its helpers stay with
it.

- [ ] **Step 2: Delete**

Delete `harmonizeHandlesInPlace`, `handleTargets`, `writeSolvedHandles`,
`HARMONIZE_HANDLES_ROUNDS`, `adjustHandles`, `scaleHandles`, `chordFrame`,
`bendingEnergy`, `safeSqrt`, `realRoots`, `bisectPolynomial`,
`evaluatePolynomial`, `derivePolynomial` and `BISECTION_STEPS`, minus anything
the grep showed `balancePathInPlace` needs.

Delete their tests from `test-harmonization.js` and their names from its import
list.

- [ ] **Step 3: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS, with a lower count. State the count and the number of deleted
tests in the commit message.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "refactor(harmonize): delete the handle-length construction, which has no caller"
```

---

### Task 6: The panel

**Files:**

- Modify: `src-js/fontra-core/src/application-settings.js:23-28`
- Modify: `src-js/fontra-core/assets/lang/en.js:736-772`
- Modify: `src-js/views-editor/src/panel-transformation.js:753-900,969-1010`
- Modify: `src-js/views-editor/src/scene-controller.js:2499-2620`

**Interfaces:**

- Consumes: `harmonizePathInPlace` with the options from Task 4.
- Produces: the setting `harmonizeMethod`, an integer 1, 2 or 3.

- [ ] **Step 1: The settings**

In `application-settings.js`, replace the harmonize block with:

```js
  // fork: harmonize panel settings (app-level, per D9 — not written to project files)
  harmonizeG3: false,
  harmonizeOtherSources: true,
  // 1 nearest, 2 canonical, 3 canonical with the joint free. See the design
  // document: one control names one construction.
  harmonizeMethod: 2,
```

- [ ] **Step 2: The strings**

In `assets/lang/en.js`, delete these five keys and their tooltips:
`harmonize.move-on-curve`, `harmonize.move-on-curve.tooltip`,
`harmonize.match-curvature`, `harmonize.match-curvature.tooltip`,
`harmonize.realign-handles`, `harmonize.realign-handles.tooltip`.

Add:

```js
  "sidebar.selection-transformation.harmonize.method": "Movement",
  "sidebar.selection-transformation.harmonize.method.tooltip":
    "How much the command may move. Position 1 changes the four handle lengths as little as it can. Position 2 moves the two inner handle lengths to one particular ratio. Position 3 also lets the joint slide along its own tangent. G3 has one construction and greys this out.",
  "sidebar.selection-transformation.harmonize.method.1": "Nearest",
  "sidebar.selection-transformation.harmonize.method.2": "Canonical",
  "sidebar.selection-transformation.harmonize.method.3": "Canonical, joint free",
```

- [ ] **Step 3: The panel**

In `panel-transformation.js`, replace the three tick boxes for
`harmonizeMoveOnCurve`, `harmonizeRealignHandles` and `harmonizeMatchCurvature`
with one slider and one name row. Keep `harmonizeG3` and `harmonizeOtherSources`
as they are, and keep the whole harmonize section last, for the reason its
existing comment gives.

```js
formContents.push({
  type: "edit-number-slider",
  key: "harmonizeMethod",
  label: translate("sidebar.selection-transformation.harmonize.method"),
  value: applicationSettingsController.model.harmonizeMethod,
  minValue: 1,
  maxValue: 3,
  values: [1, 2, 3],
  // G3 has one construction, so there is nothing for the slider to say.
  disabled: !!applicationSettingsController.model.harmonizeG3,
});

formContents.push({
  type: "text",
  label: "",
  value: translate(
    `sidebar.selection-transformation.harmonize.method.${
      applicationSettingsController.model.harmonizeG3
        ? 2
        : applicationSettingsController.model.harmonizeMethod
    }`
  ),
});
```

In the key list at line 892, replace `"harmonizeMoveOnCurve"`,
`"harmonizeMatchCurvature"` and `"harmonizeRealignHandles"` with
`"harmonizeMethod"`. Leave `"harmonizeG3"` and `"harmonizeOtherSources"` there:
both already rebuild the panel, which is what redraws the name row and the
greying.

In `doHarmonize`, replace the option read with:

```js
  async doHarmonize() {
    const settings = applicationSettingsController.model;
    const options = {
      useG3: !!settings.harmonizeG3,
      method: settings.harmonizeMethod,
      applyToOtherSources: settings.harmonizeOtherSources,
    };
```

- [ ] **Step 4: The controller**

In `scene-controller.js`, replace the head of `doHarmonize`:

```js
  async doHarmonize(options = {}) {
    const {
      useG3 = applicationSettingsController.model.harmonizeG3,
      method = applicationSettingsController.model.harmonizeMethod,
      applyToOtherSources = applicationSettingsController.model.harmonizeOtherSources,
    } = options;

    // One control names one construction. G3 has one, so the position is not
    // read under it.
    const continuity = useG3 ? "G3" : "G2";
    const construction =
      { 1: "nearest", 2: "canonical", 3: "canonical-slide" }[method] ?? "canonical";
```

Then replace every `{ continuity, slideOnCurve, handleBias, matchCurvature,
realignHandles }` option object in this function with
`{ continuity, method: construction }`. There are at least two, one on the
skeleton path and one on the ordinary path.

- [ ] **Step 5: Check the editor files parse**

Run:

```bash
node --check src-js/views-editor/src/panel-transformation.js
node --check src-js/views-editor/src/scene-controller.js
npx prettier --write src-js/views-editor/src/panel-transformation.js src-js/views-editor/src/scene-controller.js src-js/fontra-core/src/application-settings.js src-js/fontra-core/assets/lang/en.js
```

Expected: no output from `node --check`.

- [ ] **Step 6: The manual test matrix**

`views-editor` has no test harness (rail R-G), so run these by hand and record
the result in the commit message.

1. Select a smooth joint. Set the slider to 1. Press Harmonize. The two outer
   handles move as well as the two inner ones. No on-curve point moves.
2. Same joint, slider at 2. Press. Only the two inner handles move.
3. Same joint, slider at 3. Press. The joint itself may move along its tangent.
4. Press twice at each position. The second press changes nothing.
5. Tick G3. The slider greys out and the name row reads "Canonical".
6. Press with G3 on. The report names a status for every selected joint.
7. Untick G3. The slider comes back at the position it was left on.
8. Select a whole contour with no selection at all and press. Every smooth joint
   is reached.
9. Select a skeleton centerline point and press. The centerline moves and the
   generated outline follows.
10. Press on a drawing that is already harmonic. Nothing moves and no undo step
    is taken.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(harmonize): one slider replaces four tick boxes"
```

---

### Task 7: The documents

**Files:**

- Modify: `docs/superpowers/FEATURE-MODEL.md`, section 10
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`, the Harmonize section
- Modify: `docs/superpowers/GLOSSARY.md`

- [ ] **Step 1: The feature model**

Rewrite section 10 to describe the command as it now is. Delete what the work
made untrue rather than appending to it. In particular:

- Section 10.2's three constructions become three positions of one control, and
  the handle-length construction goes.
- Section 10.2b, "The press repeats itself", goes. There is no press-level
  repetition.
- Section 10.5's rules about the field, the ratchet, the refusal rank, the
  drawing as a candidate and the ranking of a field all go. The rules about
  writing per point, the five-point stencil, the grid position being chosen, and
  the verdict describing the kept drawing all stay.
- Add the nearest construction: what it solves for, that it works on the
  logarithms of four multipliers, that it moves the outer handles, that the
  tension ceiling and the one-unit floor bound it, and that it is G2 only.

- [ ] **Step 2: The log**

Add to the Harmonize section what this work measured and what it withdrew. One
line per finding, with its number:

- The tick boxes were not switches. Each added an answer to a ranked field, so
  the output was identical with the match-curvature tick on and off at three of
  the four smooth joints of `N^1.json`.
- The nearest answer is exact and moves the drawing seven times less on the
  reported joint: 5.6 units against 40 for one attempt of the canonical
  construction, and 85 for the whole press.
- The 85 units are one joint. On seven of the nine measured joints the old
  command moved the drawing about as far as the nearest answer restricted to the
  same two handles, and on two of them less.
- Four handles against two, on a broken joint: 11.1 units against 36.2 at
  `N^1` point 3.
- The nearest answer does not survive whole units: 0.000% becomes 1.206% at
  `N^1` point 12 and 14.819% at `I^1` point 4. The grid search is what buys the
  0.006% the old command reached.
- The nearest answer is continuous under one equation and unbounded near an
  inflection: over three units of drag the largest tension goes 1.95 to 3.85.
- On two equations it is discontinuous: steps of up to 2687 units between two
  adjacent frames, and a tension of 11.34.
- Realign moved 0 of 88 points over both problem glyphs, and became
  unconditional rather than a tick box.

- [ ] **Step 3: The glossary**

Add the terms this work introduced, in the glossary's own style:

- **Nearest answer** — the smallest change to the four handle lengths at a joint
  that makes the two curvatures equal.
- **Canonical answer** — the two inner handle lengths moved to one particular
  ratio.
- **Field** — mark this dead. The press no longer draws several answers and ranks
  them.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "docs(harmonize): the command as it now is"
```

---

## Self-Review

**Spec coverage.** Every section of the design has a task. The panel is Task 6.
Position 1 is Tasks 1 and 2. Positions 2 and 3 are Task 4, which routes to the
construction that already exists. The tension ceiling under position 1 is Task 1.
The sweep is Task 2. Realigning always running is Task 4. The two refusals and
the grid rule are Task 3. What goes is Tasks 3, 4 and 5. G3 is Task 4 and Task 6.

**One gap, stated rather than hidden.** The design says a press is a fixed point.
Task 2 and Task 4 both test it, on a fixture and on a ring. Neither test runs on
the reported glyphs, because the test harness has no glyph loader. Confirm it by
hand on `_external/problem-glyphs/N^1.json` at step 4 of Task 6's matrix.

**Type consistency.** `solveNearestHandleScales` returns `scales`, `status`,
`reason` and `curvatureStep` in Task 1, and Task 2 reads exactly those four.
`applyHandleScales` takes the seven-point stencil and the four scales in both
tasks. `scoreJoints` returns the same five keys in Task 3 and is read with those
five keys by `isBetter` and by both constructions' `jointResidual`. The option
name is `method` in Tasks 4 and 6, and the setting name is `harmonizeMethod` in
Task 6 alone.
