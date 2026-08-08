# Serif On A Curved Stem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents and do not use worktrees — this project works on a branch.

**Goal:** Make a serif terminal attach to the stem wall where the wall actually
runs, so that the serif's own parameters stop reshaping the stem on a curved
skeleton.

**Architecture:** The serif currently assumes the stem wall is a straight line
from the rib end into the stroke, places its release on that line, cuts the real
wall at the same depth, then drags the cut end onto the release and turns the
surviving handle onto a fixed direction. On a curved stem the drag and the turn
grow with the depth the serif reaches at, and tip thickness sets that depth. This
plan replaces the straight-line assumption with the wall itself: the wing's top
surface is extended until it meets the wall, the wall is cut exactly there, and
the surviving piece is emitted unchanged. To keep the cut immune to the three
things a designer can author on that wall — a curvature pin, a nudged handle and
a detached handle — the cut is taken on the wall as solved from the centerline
and the widths, and all three authored layers are applied to the piece that
survives.

**Tech Stack:** JavaScript ES modules, `fontra-core` with mocha + chai.

## Global Constraints

- **Rail R-A — layer placement.** Pure geometry goes in `fontra-core/src/` with
  mocha tests. The generator owns trimming and splicing. The serif's own geometry
  module never learns what a stroke is.
- **Rail R-B — one copy of every constant and geometry function.** Import, never
  re-derive.
- **Rail R-G — test split and per-commit checks.** Every commit runs
  `node --check` on each touched editor file, then `npx prettier --write`, then
  `npm run bundle`. The user runs bundle-watch, so do not run the bundle
  yourself — the user reports compile errors.
- **Point-count stability.** The generated point count must not vary with any
  parameter value. Seven on-curve points per serif terminal at every value,
  including degenerate ones.
- **Points collapse, they do not disappear.** Zero is a legal setting for every
  serif field and must emit the same points as any other setting.
- **A curvature pin moves handles and nothing else.** Sweeping the pin, the sum
  of every emitted on-curve's travel must be exactly zero.
- **A straight stem must not move.** A straight wall is exactly what the current
  code assumes, so every existing straight-stem fixture must come out
  byte-identical.
- **No thresholds, searches or convergence tests in the shape path.** Fixed
  sample counts and fixed bisection counts only.
- Commit after each task with `git add .`.

---

## File Structure

| File                                                  | Responsibility                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-js/fontra-core/src/serif-wall.js`                | **NEW.** One curve in an abstract 2D frame, and the four questions the serif asks of it: where is it at a depth, where does a ray meet it, which way does it run, how deep may it be consumed. Knows nothing about serifs, strokes or ribs. |
| `src-js/fontra-core/tests/test-serif-wall.js`         | **NEW.** Tests for the above.                                                                                                                                                                                                               |
| `src-js/fontra-core/src/serif-geometry.js`            | `buildHalfSerif` takes a wall instead of a start point and a lean. The wing corner becomes a ray/wall intersection. Junction, release and the ease rounding's flank direction all come off the wall.                                        |
| `src-js/fontra-core/tests/test-serif-geometry.js`     | Straight-wall parity, curved-wall placement, degenerate values.                                                                                                                                                                             |
| `src-js/fontra-core/src/skeleton-generator.js`        | Builds the wall from the terminal segment, splits at the release's own parameter, deletes the anchoring, and moves the curvature pin behind the cut alongside the handle adjustments that already live there.                               |
| `src-js/fontra-core/tests/test-skeleton-generator.js` | Sweeps: tip thickness must not reshape the stem, the pin must move no on-curve, point count holds.                                                                                                                                          |
| `docs/superpowers/SKELETON-FEATURE-MODEL.md`          | §8 release rule and §9 closed decisions restated.                                                                                                                                                                                           |
| `docs/superpowers/DEVELOPMENT-LOG.md`                 | New entry.                                                                                                                                                                                                                                  |

---

## Task 1: The wall model

A pure curve module. Additive — nothing consumes it yet, so this task cannot
change any output.

**Files:**

- Create: `src-js/fontra-core/src/serif-wall.js`
- Test: `src-js/fontra-core/tests/test-serif-wall.js`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `makeSerifWall(points)` → wall, where `points` is an array of 2 (line) or 4
    (cubic) `{u, v}` frame points, ordered from the rib end into the stroke.
  - `wall.pointAt(t)` → `{u, v}`
  - `wall.tangentAt(t)` → unit `{u, v}`, pointing into the stroke
  - `wall.parameterAtDepth(v)` → `t`, the first parameter at or before
    `wall.maxParameter` whose depth reaches `v`; `wall.maxParameter` when the
    wall never gets that deep
  - `wall.meetRay(origin, direction)` → `t` or `null`
  - `wall.maxParameter` → number, the parameter at 95% of the wall's own length
  - `wall.maxDepth` → number, the depth at `maxParameter`

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-serif-wall.js`:

```js
import { expect } from "chai";
import { makeSerifWall } from "@fontra/core/serif-wall.js";

// A line wall standing straight up the depth axis from u = 50. This is exactly
// what the old straight-flank model assumed, so it is the parity case.
const straight = () =>
  makeSerifWall([
    { u: 50, v: 0 },
    { u: 50, v: 400 },
  ]);

// A wall that leans and bends away from the depth axis, which is what a curved
// stem produces.
const curved = () =>
  makeSerifWall([
    { u: 50, v: 0 },
    { u: 40, v: 100 },
    { u: 10, v: 200 },
    { u: -60, v: 300 },
  ]);

const close = (actual, expected, tolerance = 1e-6) =>
  expect(Math.abs(actual - expected)).to.be.lessThan(tolerance);

describe("serif wall", () => {
  it("finds a point at a requested depth on a straight wall", () => {
    const wall = straight();
    const point = wall.pointAt(wall.parameterAtDepth(120));
    close(point.v, 120, 1e-4);
    close(point.u, 50, 1e-4);
  });

  it("finds a point at a requested depth on a curved wall", () => {
    const wall = curved();
    const point = wall.pointAt(wall.parameterAtDepth(120));
    close(point.v, 120, 1e-3);
    // The curved wall has moved inward by that depth, which the straight model
    // could not see at all.
    expect(point.u).to.be.lessThan(45);
  });

  it("clamps a depth request past its own reach to its maximum", () => {
    const wall = curved();
    expect(wall.parameterAtDepth(100000)).to.equal(wall.maxParameter);
  });

  it("meets a ray that crosses it", () => {
    const wall = curved();
    // A ray from out on the wing, running inward and slightly deeper.
    const t = wall.meetRay({ u: 200, v: 60 }, { u: -1, v: 0.2 });
    expect(t).to.be.a("number");
    const hit = wall.pointAt(t);
    // The hit lies on the ray as well as on the wall.
    close((hit.u - 200) * 0.2 - (hit.v - 60) * -1, 0, 1e-3);
  });

  it("returns null for a ray that runs away from it", () => {
    const wall = curved();
    expect(wall.meetRay({ u: 200, v: 60 }, { u: 1, v: 0 })).to.equal(null);
  });

  it("points its tangent into the stroke", () => {
    const wall = curved();
    expect(wall.tangentAt(0.3).v).to.be.greaterThan(0);
  });

  it("stops short of consuming its whole segment", () => {
    const wall = straight();
    expect(wall.maxParameter).to.be.lessThan(1);
    expect(wall.maxDepth).to.be.lessThan(400);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-wall.js`
Expected: FAIL — cannot find module `serif-wall.js`.

- [ ] **Step 3: Write the module**

Create `src-js/fontra-core/src/serif-wall.js`:

```js
// The stem wall as the serif sees it: one curve in the terminal's own frame,
// running from the rib end into the stroke, with depth (v) growing inward.
//
// This module knows nothing about serifs, strokes, ribs or contours. It is one
// curve and four questions asked of it. That is what lets the serif's geometry
// attach to the real wall without learning what a stroke is, and lets the
// generator stay out of curve algebra.
//
// Every search here has a fixed sample count and a fixed bisection count. There
// is no convergence test and no tolerance to cross, because a threshold in a
// shape path makes the output a step function of its input.

// Samples used to bracket a crossing before bisecting into it.
const SCAN_SAMPLES = 256;
// Bisection steps. 40 halvings take a bracket of one parameter unit below
// 1e-12, which is far under the grid the result is rounded onto.
const BISECT_STEPS = 40;
// A terminal may consume its own segment and no more. The wall stops short of
// its own far end so a splice always has curve left on both sides of the cut.
const MAX_CONSUMED_FRACTION = 0.95;
// Samples in the arc-length table that resolves that fraction.
const LENGTH_SAMPLES = 256;

function lerp(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

function evaluate(points, t) {
  if (points.length === 2) {
    return lerp(points[0], points[1], t);
  }
  const a = lerp(points[0], points[1], t);
  const b = lerp(points[1], points[2], t);
  const c = lerp(points[2], points[3], t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

function derivative(points, t) {
  if (points.length === 2) {
    return { u: points[1].u - points[0].u, v: points[1].v - points[0].v };
  }
  const s = 1 - t;
  return {
    u:
      3 * s * s * (points[1].u - points[0].u) +
      6 * s * t * (points[2].u - points[1].u) +
      3 * t * t * (points[3].u - points[2].u),
    v:
      3 * s * s * (points[1].v - points[0].v) +
      6 * s * t * (points[2].v - points[1].v) +
      3 * t * t * (points[3].v - points[2].v),
  };
}

function normalize(direction) {
  const length = Math.hypot(direction.u, direction.v);
  if (!(length > 0)) {
    return { u: 0, v: 1 };
  }
  return { u: direction.u / length, v: direction.v / length };
}

// The parameter at `fraction` of the curve's own length. A fixed table rather
// than a solve, for the same reason as everything else here.
function parameterAtLengthFraction(points, fraction) {
  let total = 0;
  const cumulative = [0];
  let previous = evaluate(points, 0);
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    const current = evaluate(points, i / LENGTH_SAMPLES);
    total += Math.hypot(current.u - previous.u, current.v - previous.v);
    cumulative.push(total);
    previous = current;
  }
  if (!(total > 0)) {
    return fraction;
  }
  const target = total * fraction;
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    if (cumulative[i] >= target) {
      const span = cumulative[i] - cumulative[i - 1];
      const within = span > 0 ? (target - cumulative[i - 1]) / span : 0;
      return (i - 1 + within) / LENGTH_SAMPLES;
    }
  }
  return 1;
}

// Bisect a function that changes sign between `low` and `high`.
function bisect(signAt, low, high) {
  const lowSign = signAt(low) < 0;
  let a = low;
  let b = high;
  for (let step = 0; step < BISECT_STEPS; step++) {
    const mid = (a + b) / 2;
    if (signAt(mid) < 0 === lowSign) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/**
 * A wall built from a line (2 points) or a cubic (4 points), in frame
 * coordinates, ordered from the rib end into the stroke.
 * @param {Array<{u: number, v: number}>} points
 */
export function makeSerifWall(points) {
  const maxParameter = parameterAtLengthFraction(points, MAX_CONSUMED_FRACTION);
  const maxDepth = evaluate(points, maxParameter).v;

  const pointAt = (t) => evaluate(points, t);
  const tangentAt = (t) => normalize(derivative(points, t));

  // The first parameter whose depth reaches `depth`. "First" matters: a wall
  // that turns far enough can reach one depth twice, and the serif wants the
  // one nearer the rib end. A wall that never gets that deep is consumed to its
  // limit, which is the continuous answer — as the request grows the parameter
  // slides up to the limit and stays there.
  const parameterAtDepth = (depth) => {
    if (!(depth > pointAt(0).v)) {
      return 0;
    }
    if (depth >= maxDepth) {
      return maxParameter;
    }
    const below = (t) => pointAt(t).v - depth;
    let previous = 0;
    for (let i = 1; i <= SCAN_SAMPLES; i++) {
      const t = (i / SCAN_SAMPLES) * maxParameter;
      if (below(t) >= 0) {
        return bisect(below, previous, t);
      }
      previous = t;
    }
    return maxParameter;
  };

  // Where the wall crosses a ray. The sign function is the cross product of the
  // ray direction with the offset to the wall, so its zeros are where the wall
  // meets the ray's line; a crossing behind the ray's origin is discarded.
  const meetRay = (origin, direction) => {
    const cross = (t) => {
      const p = pointAt(t);
      return direction.u * (p.v - origin.v) - direction.v * (p.u - origin.u);
    };
    const ahead = (t) => {
      const p = pointAt(t);
      return direction.u * (p.u - origin.u) + direction.v * (p.v - origin.v) >= 0;
    };
    let previous = 0;
    let previousCross = cross(0);
    if (previousCross === 0 && ahead(0)) {
      return 0;
    }
    for (let i = 1; i <= SCAN_SAMPLES; i++) {
      const t = (i / SCAN_SAMPLES) * maxParameter;
      const current = cross(t);
      if (current === 0) {
        if (ahead(t)) return t;
      } else if (previousCross !== 0 && previousCross < 0 !== current < 0) {
        const hit = bisect(cross, previous, t);
        if (ahead(hit)) return hit;
      }
      previous = t;
      previousCross = current;
    }
    return null;
  };

  return { pointAt, tangentAt, parameterAtDepth, meetRay, maxParameter, maxDepth };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-wall.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Format and commit**

```bash
cd src-js/fontra-core && npx prettier --write src/serif-wall.js tests/test-serif-wall.js
cd ../.. && git add . && git commit -m "feat(serif): add the wall model the terminal will attach to"
```

---

## Task 2: The half serif attaches to a wall

`buildHalfSerif` currently receives the wall as a start point (`flankU`) and a
lean (`flankSlope`), and derives every shared point from
`flankAt(v) = flankU + flankSlope * v`. It now receives a wall.

Three things change. The wing's inner corner is found by extending the wing's
top surface until it meets the wall, instead of being placed at
`tipThickness + wingSlope` on the assumed line. The junction and the release are
found at their depths **on the wall**. The ease rounding's flank handle runs
along the wall's own tangent at the release, instead of along the chord back to
the junction.

Reach and ease distance stay depths, exactly as tip thickness is a depth. Only
the sideways position of each point changes, and on a straight wall it does not
change at all.

**Files:**

- Modify: `src-js/fontra-core/src/serif-geometry.js`
- Test: `src-js/fontra-core/tests/test-serif-geometry.js`

**Interfaces:**

- Consumes: `makeSerifWall` from Task 1.
- Produces:
  - `buildHalfSerif({ side, wall, params, maxDepth })` — `flankU` and
    `flankSlope` are gone. `maxDepth` is how deep this half may consume, and
    the half clamps `reach` and `easeDistance` against it.
  - the returned half gains `depthClamped` (boolean) and
    `releaseParameter` (number) beside its existing fields.
  - `buildSerifTerminal({ frame, leftWall, rightWall, leftMaxDepth,
rightMaxDepth, left, right, undersideCup, undersideCupTension,
undersideCupBalance })` — `leftFlankU` and `rightFlankU` are gone.

- [ ] **Step 1: Write the failing tests**

Add to `src-js/fontra-core/tests/test-serif-geometry.js`:

```js
import { makeSerifWall } from "@fontra/core/serif-wall.js";

describe("half serif on a wall", () => {
  const params = {
    wingLength: 48,
    tipThickness: 63,
    wingSlope: 12,
    tipCutAngle: 0,
    reach: 10,
    tension: 0.5,
    concavity: 0.5,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const straightWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 30, v: 600 },
    ]);
  const curvedWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 24, v: 120 },
      { u: 4, v: 240 },
      { u: -40, v: 360 },
    ]);

  it("places the corner where the old straight model placed it", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: straightWall(),
      params,
      maxDepth: 500,
    });
    // Straight up the depth axis, the wing's top surface meets the wall at
    // exactly the old rise: tip thickness plus wing slope.
    expect(Math.abs(half.corner.u - 30)).to.be.lessThan(0.01);
    expect(Math.abs(half.corner.v - 75)).to.be.lessThan(0.01);
  });

  it("puts the corner, junction and release on a curved wall", () => {
    const wall = curvedWall();
    const half = buildHalfSerif({ side: 1, wall, params, maxDepth: 500 });
    for (const point of [half.corner, half.junction, half.release]) {
      const onWall = wall.pointAt(wall.parameterAtDepth(point.v));
      expect(Math.abs(onWall.u - point.u)).to.be.lessThan(0.05);
    }
    // And it is not where the straight model would have put them.
    expect(half.release.u).to.be.lessThan(28);
  });

  it("reports the release's own parameter on the wall", () => {
    const wall = curvedWall();
    const half = buildHalfSerif({ side: 1, wall, params, maxDepth: 500 });
    const at = wall.pointAt(half.releaseParameter);
    expect(Math.abs(at.u - half.release.u)).to.be.lessThan(0.05);
    expect(Math.abs(at.v - half.release.v)).to.be.lessThan(0.05);
  });

  it("clamps reach and ease against the depth it may consume", () => {
    const wall = curvedWall();
    const half = buildHalfSerif({
      side: 1,
      wall,
      params: { ...params, reach: 900, easeDistance: 900 },
      maxDepth: 120,
    });
    expect(half.release.v).to.be.at.most(120.01);
    expect(half.depthClamped).to.equal(true);
  });

  it("emits every point with a wingless half", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: curvedWall(),
      params: { ...params, wingLength: 0, tipThickness: 0, wingSlope: 0 },
      maxDepth: 500,
    });
    for (const key of [
      "junction",
      "corner",
      "release",
      "easeFlankHandle",
      "easeOnBracket",
      "easeBracketHandle",
      "control1",
      "control2",
      "tipTop",
      "tipBottom",
    ]) {
      expect(half[key], key).to.be.an("object");
      expect(Number.isFinite(half[key].u), key).to.equal(true);
      expect(Number.isFinite(half[key].v), key).to.equal(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js`
Expected: FAIL — `buildHalfSerif` ignores `wall` and throws on the missing
`flankU`.

- [ ] **Step 3: Rewrite the wall-dependent part of `buildHalfSerif`**

In `src-js/fontra-core/src/serif-geometry.js`, import the wall model at the top:

```js
import { makeSerifWall } from "./serif-wall.js";
```

Change the signature and replace the block that runs from `const wingInnerV`
down to the `const junction` line, and the `const corner` and `const release`
lines, as follows. Everything between them — the attractor, the two bracket
controls, the ease bisection — is untouched.

```js
export function buildHalfSerif({ side, wall, params, maxDepth = Infinity }) {
  const wingLength = params.wingLength ?? 0;
  const tipThickness = params.tipThickness ?? 0;
  const wingSlope = params.wingSlope ?? 0;
  const tension = Math.min(Math.max(params.tension ?? 0, 0), 1);
  const concavity = Math.min(Math.max(params.concavity ?? 0, -1), 1);
  const cutAngle = Math.min(
    Math.max(params.tipCutAngle ?? 0, -MAX_TIP_CUT_ANGLE),
    MAX_TIP_CUT_ANGLE
  );

  const footU = wall.pointAt(0).u;
  const tipU = footU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };

  // The wing's inner corner is where the wing's top surface reaches the stem.
  // The surface leaves the top of the tip running inward, rising by the wing
  // slope over the wing's own length, and it is extended until it MEETS THE
  // WALL. Placing it at a depth of tipThickness + wingSlope instead assumes the
  // wall stands straight up from the rib end, which is true of a straight stem
  // and false of every curved one. On a straight wall the two answers are the
  // same point, so nothing already drawn moves.
  const cornerRay = { u: -side * wingLength, v: wingSlope };
  const cornerParameter =
    wingLength > 0
      ? (wall.meetRay(tipTop, cornerRay) ??
        wall.parameterAtDepth(tipThickness + wingSlope))
      : wall.parameterAtDepth(tipThickness + wingSlope);
  const corner = wall.pointAt(cornerParameter);

  // Reach and ease distance are depths above the corner, as tip thickness is a
  // depth. Only their sideways position follows the wall.
  const room = Math.max(maxDepth - corner.v, 0);
  const wantedReach = Math.max(params.reach ?? 0, 0);
  const reach = Math.min(wantedReach, room);
  const easeOff = concavity >= 1;
  const wantedEase = easeOff ? 0 : Math.max(params.easeDistance ?? 0, 0);
  const easeDistance = Math.min(
    wantedEase,
    maxSerifEaseDistance(params),
    Math.max(room - reach, 0)
  );
  const depthClamped = wantedReach > reach || wantedEase > easeDistance;

  const junctionParameter = wall.parameterAtDepth(corner.v + reach);
  const junction = wall.pointAt(junctionParameter);
  const releaseParameter = wall.parameterAtDepth(junction.v + easeDistance);
  const release = wall.pointAt(releaseParameter);
  const easeCurvature = Math.min(Math.max(params.easeCurvature ?? 0, 0), 1);
```

Then delete the two now-dead lines further down — the local `const easeOff`,
`const requestedEase`, `const easeCurvature` and `const easeDistance` — because
all four are computed above. Keep the bisection that finds the bracket end.

The ease rounding's flank handle must now leave along the wall rather than along
the chord back to the junction. Replace:

```js
const flankDirection = subUV(junction, release);
```

with:

```js
// Out of the stroke along the wall itself. The chord back to the junction is
// the same line only while the wall is straight, and a rounding whose handle
// leaves off the surface it sits on is not tangent to it.
const wallOut = wall.tangentAt(releaseParameter);
const flankDirection = { u: -wallOut.u, v: -wallOut.v };
```

Finally add the two new fields to the returned object:

```js
    depthClamped,
    releaseParameter,
```

and delete `wingInnerV` from the return, replacing every use of it in this
function with `corner.v`.

- [ ] **Step 3b: Retire the frame's lean**

`computeSerifFrame` computes `flankSlope`, which existed to tell the half serif
how the wall leans away from the frame's depth. The wall now carries its own
shape, so nothing reads it. Delete the `flankSlope` computation, the field on the
returned frame, the comment block above it, and the test at
`tests/test-serif-geometry.js:707` that asserts it.

This project has found three dead levels already — a contour serif block, a
contour cap style and a `reversed` flag — and the check each time was who writes
a value, not who reads it. Leaving a computed value nothing consumes is the same
trap in the other direction.

- [ ] **Step 3c: Update the existing tests that pass the old shape**

Four places in `tests/test-serif-geometry.js` build a half or a terminal with
`flankU`, `flankSlope`, `leftFlankU` or `rightFlankU`: lines 423–424, 555–556,
575 and 704. Replace each with a straight wall standing at the same `u`:

```js
const wallAt = (u) =>
  makeSerifWall([
    { u, v: 0 },
    { u, v: 1000 },
  ]);
```

so a half becomes `buildHalfSerif({ side, wall: wallAt(side * 50), params, maxDepth: 900 })`
and a terminal takes `leftWall: wallAt(100), rightWall: wallAt(0)` with both max
depths at 900. Every one of these tests must keep its existing expected numbers —
they are the parity evidence that a straight stem does not move.

The one exception is line 176, which asserts `half.wingInnerV`. Change it to
assert `half.corner.v` against the same value.

- [ ] **Step 4: Rewrite `buildSerifTerminal`'s signature**

Replace the destructured `leftFlankU` and `rightFlankU` with `leftWall`,
`rightWall`, `leftMaxDepth` and `rightMaxDepth`, drop the `flankSlope` local, and
build the halves as:

```js
const halves = {
  left: buildHalfSerif({
    side: 1,
    wall: leftWall,
    params: left,
    maxDepth: leftMaxDepth,
  }),
  right: buildHalfSerif({
    side: -1,
    wall: rightWall,
    params: right,
    maxDepth: rightMaxDepth,
  }),
};
```

Nothing else in that function changes: the foot centre is already the midpoint of
the two tip bottoms, and the balance already slides along the axis.

- [ ] **Step 5: Run the whole core suite**

Run: `cd src-js/fontra-core && npm test`
Expected: the new serif-geometry tests PASS. The generator suite FAILS, because
the generator still calls with `flankU`. That is Task 3.

- [ ] **Step 6: Commit**

```bash
cd src-js/fontra-core && npx prettier --write src/serif-geometry.js tests/test-serif-geometry.js
cd ../.. && git add . && git commit -m "feat(serif): attach the half serif to the wall instead of a straight line"
```

---

## Task 3: The generator supplies the wall and stops bending it

The generator builds the wall from the terminal segment on each side, hands it to
the terminal, then splits at the release's own parameter and emits the surviving
piece unchanged. `anchorTerminalSplit` goes away: with the release on the wall,
there is nothing to drag and nothing to turn.

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js`
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: `makeSerifWall`, and `buildSerifTerminal`'s new signature.
- Produces: `splitTerminalSideAtParameter(sidePoints, sidePosition, parameter)`,
  a sibling of `splitTerminalSideForRoundCap` that takes the parameter directly
  instead of solving for an arc-length distance. Same return shape.

- [ ] **Step 1: Write the failing test**

Add to `src-js/fontra-core/tests/test-skeleton-generator.js`:

```js
// A curved stem with a serif on one end: the configuration the fault was
// reported from.
function curvedSerifSkeleton(tipThickness) {
  return {
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 60,
        points: [
          {
            id: 4,
            x: 372,
            y: 331,
            capStyle: "serif",
            width: { left: 30, right: 30, linked: true, tied: true },
            serif: {
              axisMode: "perpendicular",
              axisAngle: 0,
              sides: "right",
              linked: false,
              undersideCup: 0,
              undersideCupTension: 2 / 3,
              undersideCupBalance: 0,
              left: {
                wingLength: 48,
                tipThickness,
                wingSlope: 0,
                tipCutAngle: 0,
                reach: 0,
                tension: 0,
                concavity: 0,
                easeDistance: 0,
                easeCurvature: 0,
              },
              right: {
                wingLength: 48,
                tipThickness,
                wingSlope: 0,
                tipCutAngle: 0,
                reach: 0,
                tension: 0,
                concavity: 0,
                easeDistance: 0,
                easeCurvature: 0,
              },
            },
          },
          { id: 9, x: 317, y: 457, type: "cubic" },
          { id: 10, x: 252, y: 492, type: "cubic" },
          {
            id: 2,
            x: 63,
            y: 492,
            width: { left: 40, right: 40, linked: true, tied: true },
          },
        ],
      },
    ],
  };
}

// The emitted stem wall next to the serif, as a cubic.
function emittedStemWall(result, side) {
  const points = result.contours[0].points;
  const map = result.provenance[0].pointMap;
  for (let i = 0; i < points.length; i++) {
    const p = map[i];
    if (!p || p.role !== "onCurve" || p.skeletonPointId !== 4 || p.side !== side)
      continue;
    for (const step of [1, -1]) {
      const at = (k) => (k + points.length * 4) % points.length;
      const c1 = points[at(i + step)];
      const c2 = points[at(i + 2 * step)];
      const far = points[at(i + 3 * step)];
      const farProvenance = map[at(i + 3 * step)];
      if (!c1?.type || !c2?.type || far?.type) continue;
      if (farProvenance?.skeletonPointId !== 2 || farProvenance?.side !== side)
        continue;
      return [points[i], c1, c2, far].map((q) => ({ x: q.x, y: q.y }));
    }
  }
  return null;
}

function cubicPoint(p, t) {
  const s = 1 - t;
  return {
    x:
      s ** 3 * p[0].x +
      3 * s * s * t * p[1].x +
      3 * s * t * t * p[2].x +
      t ** 3 * p[3].x,
    y:
      s ** 3 * p[0].y +
      3 * s * s * t * p[1].y +
      3 * s * t * t * p[2].y +
      t ** 3 * p[3].y,
  };
}

function maxDeviation(a, b) {
  let worst = 0;
  for (let i = 0; i <= 100; i++) {
    const q = cubicPoint(a, i / 100);
    let nearest = Infinity;
    for (let j = 0; j <= 2000; j++) {
      const r = cubicPoint(b, j / 2000);
      nearest = Math.min(nearest, Math.hypot(r.x - q.x, r.y - q.y));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

describe("a serif on a curved stem", () => {
  it("does not reshape the stem as the tip thickens", () => {
    const reference = emittedStemWall(
      generateFromSkeleton(curvedSerifSkeleton(0)),
      "right"
    );
    for (const tip of [20, 40, 63, 80, 100]) {
      const wall = emittedStemWall(
        generateFromSkeleton(curvedSerifSkeleton(tip)),
        "right"
      );
      // The emitted piece is a slice of the same curve, so every point on it
      // lies on the reference wall. Two units covers grid rounding at both
      // ends and nothing else.
      expect(maxDeviation(wall, reference), `tip ${tip}`).to.be.lessThan(2);
    }
  });

  it("keeps its point count as the tip thickens", () => {
    const counts = [0, 20, 63, 100].map(
      (tip) => generateFromSkeleton(curvedSerifSkeleton(tip)).contours[0].points.length
    );
    expect(new Set(counts).size).to.equal(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "curved stem"`
Expected: FAIL — the deviation runs past two units and grows with the tip.

- [ ] **Step 3: Add the parameter split**

In `src-js/fontra-core/src/skeleton-generator.js`, add beside
`splitTerminalSideForRoundCap`:

```js
// Split a terminal side at a parameter that the caller already knows, rather
// than at an arc-length distance the split has to solve for. A serif finds its
// release ON the wall, so the parameter comes with it, and solving for a
// distance again would only reintroduce the half-unit tolerance that solve
// carries.
function splitTerminalSideAtParameter(
  sidePoints,
  sidePosition,
  parameter,
  fallbackDirections
) {
  const terminalSegment = getRoundCapTerminalSegment(sidePoints, sidePosition);
  if (!terminalSegment) {
    return null;
  }
  const { segmentPoints } = terminalSegment;
  // A serif on a straight stem has a LINE for its terminal segment, which is the
  // ordinary case and must keep working. On a line, parameter and distance are
  // exactly proportional, so the existing distance split is exact there and
  // there is nothing to solve. Only a cubic needs the parameter carried through.
  if (segmentPoints.length === 2) {
    const length = vector.distance(segmentPoints[0], segmentPoints[1]);
    return splitTerminalSideForRoundCap(
      sidePoints,
      sidePosition,
      parameter * length,
      fallbackDirections
    );
  }
  if (segmentPoints.length !== 4) {
    return null;
  }
  const bezier = createBezierFromPoints(segmentPoints);
  // A collapsed half — single-sided mode, or a terminal built on one side only —
  // asks for its release at the rib end, and a zero-length first half leaves the
  // splice no direction to work with. Floor the cut at one unit, which is the
  // same minimum the distance split already carries. This bounds the cut, not
  // the shape, so it never touches a terminal that has any depth at all.
  const floorParameter =
    bezier.length() > 2 ? solveTerminalSplitForDistance(bezier, false, 1) : 0;
  parameter = Math.max(parameter, floorParameter);
  // A start terminal's segment already runs from the rib end into the stroke,
  // which is the wall's own direction. An end terminal's runs the other way.
  const splitT = sidePosition === "end" ? 1 - parameter : parameter;
  return splitTerminalSideAtT(
    sidePoints,
    sidePosition,
    terminalSegment,
    bezier,
    splitT,
    {
      // A pin on a serifed terminal governs the piece that survives the trim, not
      // the curve the generator solved, so there is no other curve for a reader to
      // be handed. Task 4 is what makes that true; publishing it here would leave
      // the gizmo measuring one curve and writing onto another.
      publishConstructionSegment: false,
    }
  );
}
```

and refactor the tail of `splitTerminalSideForRoundCap` — everything from
`const split = bezier.split(splitT);` to its `return` — into a shared

```js
function splitTerminalSideAtT(
  sidePoints,
  sidePosition,
  terminalSegment,
  bezier,
  splitT,
  { publishConstructionSegment = true } = {}
)
```

that both callers use, with the `insertedPoint._provenance.constructionSegment`
assignment guarded by that flag. Do not change any other behaviour:
`splitTerminalSideForRoundCap` keeps solving for its distance, keeps its
synthesized-point fallbacks, and passes the flag's default.

- [ ] **Step 4: Build the wall in `buildSerifCap` and stop anchoring**

Replace `clampTerminalDepth`, the `terminalArgs` block and `releaseSide` in
`buildSerifCap` with:

```js
// The wall, in frame coordinates, running from the rib end into the stroke.
// A start terminal's side points run outward, so its segment is reversed.
const wallForSide = (sidePoints) => {
  const terminalSegment = getRoundCapTerminalSegment(sidePoints, position);
  if (!terminalSegment) return null;
  const ordered =
    position === "end"
      ? [...terminalSegment.segmentPoints].reverse()
      : terminalSegment.segmentPoints;
  return makeSerifWall(ordered.map((point) => frame.toFrame(point)));
};
const leftWall = wallForSide(leftSide);
const rightWall = wallForSide(rightSide);
if (!leftWall || !rightWall) return null;

const terminal = buildSerifTerminal({
  frame,
  leftWall,
  rightWall,
  leftMaxDepth: leftWall.maxDepth,
  rightMaxDepth: rightWall.maxDepth,
  left,
  right,
  undersideCup: (pointSerif?.undersideCup ?? 0) * lengthScale,
  undersideCupTension: pointSerif?.undersideCupTension,
  undersideCupBalance: pointSerif?.undersideCupBalance,
});

// The release sits ON the wall, so the split lands on it and the surviving
// piece is a slice of the curve the generator solved. Nothing is dragged onto
// a target and no handle is turned: the old anchoring existed only because
// the release was placed off the wall, and bending the wall back to it is
// what let tip thickness reshape the stem.
const fallbackDirections = { endpointTangent: outward, capTangent: outward };
const leftSplit = splitTerminalSideAtParameter(
  leftSide,
  position,
  terminal.halves.left.releaseParameter,
  fallbackDirections
);
const rightSplit = splitTerminalSideAtParameter(
  rightSide,
  position,
  terminal.halves.right.releaseParameter,
  fallbackDirections
);
if (!leftSplit || !rightSplit) return null;
```

Update the returned `depthClamped` to
`terminal.halves.left.depthClamped || terminal.halves.right.depthClamped`.

Delete `anchorTerminalSplit` entirely — after this change it has no caller.

Add the import at the top of the file:

```js
import { makeSerifWall } from "./serif-wall.js";
```

- [ ] **Step 5: Run the tests**

Run: `cd src-js/fontra-core && npm test`
Expected: the two new curved-stem tests PASS. Serif fixtures on curved stems
move; straight-stem fixtures must not. Inspect any fixture diff before
regenerating: a straight-stem fixture that moved is a bug in this task, not a
fixture to refresh.

- [ ] **Step 6: Commit**

```bash
cd src-js/fontra-core && npx prettier --write src/skeleton-generator.js tests/test-skeleton-generator.js
cd ../.. && git add . && git commit -m "fix(serif): cut the stem wall where the serif meets it, and stop bending it back"
```

---

## Task 4: The curvature pin moves behind the cut

After Task 3 the release is on the wall, so anything that reshapes the wall moves
the release. Hand-placed and detached handle adjustments on a serif terminal are
already withheld from the solve and applied after the splice. The curvature pin
is the one authored layer still applied before it. This task moves it across, so
all three sit behind the cut and none of them can move the serif.

The stored pin then describes the tension of the **emitted** piece rather than
the whole solved wall. That is what the gizmo has always measured on screen, so
the control and the stored number finally agree without a snapshot in between.

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js`
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: `collectSerifAuthoredHandles` and `applySerifAuthoredHandles`, which
  already exist and already name exactly the handles on a serif terminal segment.
- Produces: `applySerifPinnedCurvature(sidePoints, side, authoredKeys, pins)`,
  where `pins` maps `` `${skeletonPointId}/${side}` `` to a stored tension.

- [ ] **Step 1: Write the failing test**

Add to `src-js/fontra-core/tests/test-skeleton-generator.js`, reusing
`curvedSerifSkeleton` from Task 3:

```js
describe("a curvature pin on a serifed terminal", () => {
  function withPin(tension) {
    const skeleton = curvedSerifSkeleton(63);
    skeleton.contours[0].points[0].segmentCurvature = {
      left: null,
      right: tension,
    };
    return skeleton;
  }

  function onCurvePositions(result) {
    return result.contours[0].points
      .filter((point) => !point.type)
      .map((point) => ({ x: point.x, y: point.y }));
  }

  it("moves no on-curve point over its whole range", () => {
    const reference = onCurvePositions(generateFromSkeleton(withPin(0.1)));
    let travel = 0;
    for (let step = 1; step <= 40; step++) {
      const positions = onCurvePositions(
        generateFromSkeleton(withPin(0.1 + step * 0.02))
      );
      expect(positions.length).to.equal(reference.length);
      for (let i = 0; i < positions.length; i++) {
        travel += Math.hypot(
          positions[i].x - reference[i].x,
          positions[i].y - reference[i].y
        );
      }
    }
    expect(travel).to.equal(0);
  });

  it("still changes the handles it is supposed to change", () => {
    const low = generateFromSkeleton(withPin(0.2)).contours[0].points;
    const high = generateFromSkeleton(withPin(0.9)).contours[0].points;
    const moved = low.filter(
      (point, i) => point.type && (point.x !== high[i].x || point.y !== high[i].y)
    );
    expect(moved.length).to.be.greaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "curvature pin on a serifed"`
Expected: FAIL — travel is greater than zero, because the pin reshapes the wall
before the cut is taken.

- [ ] **Step 3: Withhold the pin on a serif terminal segment**

In `addOffsetCurves`, the `pinnedTension` argument to `offsetCubicSide` currently
reads the point's stored curvature unconditionally. Gate it on the same key set
that already gates the two adjustments:

```js
        pinnedTension: authoredKeys?.has(`${segment.startPoint?.id}/${side}/out`)
          ? undefined
          : isLeftSide
            ? segment.startPoint.leftSegmentCurvature
            : segment.startPoint.rightSegmentCurvature,
```

The `out` handle at a segment's start point is claimed for exactly the segments a
serif terminal owns, so this withholds the pin on those and leaves every other
segment alone.

- [ ] **Step 4: Apply the pin after the splice**

Add beside `applySerifAuthoredHandles`:

```js
// A pin states what a segment's tension is, and the segment it states it about
// is the one on screen. On a serifed terminal that is the piece left after the
// trim, not the curve the generator solved, so the pin is applied here — after
// the splice, alongside the two handle adjustments that already wait for it.
// Applying it before the cut would let a pin reshape the wall the serif's own
// release is found on, and walk the terminal up and down the stem.
function applySerifPinnedCurvature(sidePoints, side, authoredKeys, pins) {
  if (!authoredKeys?.size || !pins?.size) return sidePoints;
  const points = [...sidePoints];
  const isOffCurve = (point) => !!point?.type;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  for (let index = 0; index + 3 < points.length; index++) {
    const anchor = points[index];
    const handle1 = points[index + 1];
    const handle2 = points[index + 2];
    const far = points[index + 3];
    if (isOffCurve(anchor) || isOffCurve(far)) continue;
    if (!isOffCurve(handle1) || !isOffCurve(handle2)) continue;
    // A pin is keyed on its segment's START point, which is this anchor: the
    // side arrays are still in forward order here, so a start terminal's anchor
    // is the release and an end terminal's is the far on-curve. Both are the
    // segment's start point, which is what makes the key direction-independent.
    const owner = anchor._provenance?.skeletonPointId;
    if (owner === undefined) continue;
    if (!authoredKeys.has(`${owner}/${side}/out`)) continue;
    const pin = pins.get(`${owner}/${side}`);
    if (!Number.isFinite(pin)) continue;
    const axis1 = handle1._axis;
    const axis2 = handle2._axis;
    if (!axis1 || !axis2) continue;
    const domain = buildHandleDomain(anchor, far, axis1, axis2);
    // The gizmo measures each handle against its own true tangent intersection,
    // and the domain's reach is a stable coordinate scale rather than that
    // intersection. So rescale onto the ceiling, shift there, and rescale back —
    // the same three steps the pre-splice path takes, for the same reason.
    const shifted = shiftTensionsToMean(
      {
        start:
          vector.distance(anchor, handle1) / domain.startReach / domain.maxStartTension,
        end: vector.distance(far, handle2) / domain.endReach / domain.maxEndTension,
      },
      pin,
      1
    );
    const startLength =
      clamp(
        shifted.start * domain.maxStartTension,
        domain.minStartTension,
        domain.maxStartTension
      ) * domain.startReach;
    const endLength =
      clamp(
        shifted.end * domain.maxEndTension,
        domain.minEndTension,
        domain.maxEndTension
      ) * domain.endReach;
    points[index + 1] = {
      ...handle1,
      x: Math.round(anchor.x + axis1.x * startLength),
      y: Math.round(anchor.y + axis1.y * startLength),
    };
    points[index + 2] = {
      ...handle2,
      x: Math.round(far.x + axis2.x * endLength),
      y: Math.round(far.y + axis2.y * endLength),
    };
  }
  return points;
}
```

`shiftTensionsToMean` takes an object of the two tensions, the target mean, and a
maximum — not three scalars. `buildHandleDomain` comes from
`./natural-handle-solver.js` and returns `startReach`, `endReach`,
`minStartTension`, `maxStartTension`, `minEndTension` and `maxEndTension`. Add
whichever of the two imports the generator does not already carry.

Build the pin map next to where `authoredKeys` is built, at roughly line 1535:

```js
const serifPins = new Map();
if (authoredKeys.size) {
  for (const segment of segments) {
    const owner = segment.startPoint;
    if (owner?.id === undefined) continue;
    if (Number.isFinite(owner.leftSegmentCurvature))
      serifPins.set(`${owner.id}/left`, owner.leftSegmentCurvature);
    if (Number.isFinite(owner.rightSegmentCurvature))
      serifPins.set(`${owner.id}/right`, owner.rightSegmentCurvature);
  }
}
```

Then call it immediately **before** `applySerifAuthoredHandles`, so the authored
order stays natural answer, pin, adjustments, detached — matching the ordering
entry 29 settled, where the pin states the tension and the placements come after:

```js
roundedLeftSide = applySerifPinnedCurvature(
  roundedLeftSide,
  "left",
  authoredKeys,
  serifPins
);
roundedRightSide = applySerifPinnedCurvature(
  roundedRightSide,
  "right",
  authoredKeys,
  serifPins
);
roundedLeftSide = applySerifAuthoredHandles(roundedLeftSide, "left", authoredKeys);
roundedRightSide = applySerifAuthoredHandles(roundedRightSide, "right", authoredKeys);
```

- [ ] **Step 5: Confirm the construction segment is no longer published here**

Task 3 already stopped publishing it on a serif split, and this task is what
makes that correct: with the pin behind the cut, the segment the gizmo measures
and the segment the pin governs are the same curve, so there is no second curve
to hand a reader.

Check it directly. Generate `curvedSerifSkeleton(63)` and assert that no
provenance entry on the emitted contour carries a `constructionSegment`:

```js
it("hands the gizmo no second curve to measure", () => {
  const result = generateFromSkeleton(curvedSerifSkeleton(63));
  const published = result.provenance[0].pointMap.filter(
    (entry) => entry?.constructionSegment
  );
  expect(published.length).to.equal(0);
});
```

Round caps must still publish theirs. Confirm that an existing round-cap fixture
test still passes rather than asserting it again here.

- [ ] **Step 6: Run the tests**

Run: `cd src-js/fontra-core && npm test`
Expected: both new pin tests PASS, both Task 3 tests still PASS.

- [ ] **Step 7: Commit**

```bash
cd src-js/fontra-core && npx prettier --write src/skeleton-generator.js tests/test-skeleton-generator.js
cd ../.. && git add . && git commit -m "fix(serif): apply the curvature pin to the piece the trim leaves"
```

---

## Task 5: Fixtures, the reported glyph, and the docs

**Files:**

- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json`
- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`

- [ ] **Step 1: Audit the fixture diff before regenerating**

Run: `cd src-js/fontra-core && npm test`

For every fixture that fails, check which kind of stem it carries. A serif on a
curved stem is expected to move. A serif on a straight stem, or any fixture with
no serif, must not move. If one of those moved, stop and find out why — do not
regenerate over it.

- [ ] **Step 2: Regenerate the fixtures that legitimately moved**

Run: `cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js`

Then re-read the diff and confirm that contour counts, point counts, point types
and provenance ownership are unchanged everywhere, and that only coordinates on
curved serif terminals moved.

- [ ] **Step 3: Measure the reported glyph**

Write a throwaway script in the scratchpad that loads
`_external/b.json`, sweeps the serif's tip thickness over 0, 20, 40, 63, 80 and
100, and reports for each value the greatest distance from the emitted right-side
stem wall to the wall emitted at tip thickness 0. Before this change those
distances run 0.5, 2.6, 6.0, 11.2, 16.0 and 22.8 units. After it they must be
grid rounding only, under two units at every value.

Record the measured table — it goes into the log entry in Step 5.

- [ ] **Step 4: Restate the release rule in the feature model**

In `SKELETON-FEATURE-MODEL.md` §8, replace the section headed "The release — the
one rule to keep" with the rule as it now stands:

> **The terminal meets the stem where the stem actually is, and the wall it meets
> is the wall as solved from the centerline and the widths.**
>
> The wing's top surface is extended inward from the top of the tip until it
> meets that wall. Where it meets is the wing's inner corner. The junction and
> the release sit at their own depths further up the same wall. The wall is cut
> at the release and the surviving piece is emitted unchanged.
>
> The rule this replaces placed those points on a straight line running up the
> frame's depth from the rib end. That line is the wall only on a straight stem.
> On a curved one the wall had to be dragged onto it and its handle turned, and
> both grew with the depth the serif reached at — so tip thickness, which sets
> that depth, reshaped the stem.
>
> What keeps a curvature pin out of it is not the straight line but the
> **ordering**. The cut is taken on the wall before any authored layer touches
> it, and all three authored layers — the pin, a nudged handle and a detached
> handle — are applied to the piece that survives. A pin therefore states the
> tension of the segment on screen, which is the segment the gizmo measures.

Then update §9. The row "Build the serif terminal against the cut it made in the
edge" stays closed and gains a sentence: reading the release off the **emitted**
edge is still wrong, because the emitted edge carries the authored layers;
reading it off the wall as solved is not the same thing and is what the terminal
now does. Add a new row for the straight flank itself, closed by this work.

Also update the §8 point-count paragraph if the release's parameter changed
anything about what the terminal owns. It should not have: the terminal still
opens and closes with a control point, and the release is still supplied by the
trimmed edge.

- [ ] **Step 5: Write the log entry**

Append entry 35 to `DEVELOPMENT-LOG.md`, in the four-part form the file uses:
problem, solution, result, challenges and findings. Include the measured table
from Step 3, and record two things explicitly:

- The stored curvature number on a serifed terminal changes meaning, from the
  tension of the whole solved wall to the tension of the emitted piece, so files
  already carrying one shift once on reopen.
- The wing slope changes meaning, from a rise measured on an assumed straight
  line to the incline of the wing's top surface, whose run is decided by where
  the wall is. The two agree on a straight stem.

- [ ] **Step 6: Commit**

```bash
cd src-js/fontra-core && npx prettier --write tests/data/skeleton-generator/fixtures.json
cd ../.. && git add . && git commit -m "docs(serif): record the wall-following terminal, and regenerate its fixtures"
```

---

## Manual test matrix

No editor file changes here, so rail R-G's manual matrix is short. Open
`_external/b.json` and check each of these by eye:

1. Drag tip thickness across its range. The stem's curve must not change. Only
   the serif's tip gets thicker and the bracket's top slides up the wall.
2. Do the same with reach and with ease distance. Same result.
3. Drag the curvature gizmo on the stem segment beside the serif. The serif must
   not move at all — not the release, not the tip, not the foot.
4. Drag a generated handle on that segment directly. It must follow the pointer
   one-for-one and must not move the serif.
5. Open a glyph with a serif on a straight stem. Nothing about it may have moved.
6. Set wing slope to zero, then to its extremes in both directions. The bracket
   must stay attached to the wall at every value.
7. Set tip thickness past the length of the segment. The terminal must stop at
   the segment's own end rather than reaching into the next one.
