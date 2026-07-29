# True Geometric Handle Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the continuous solver's stabilized tension coordinates while preventing automatic generated handles from crossing a real forward tangent intersection.

**Architecture:** `buildHandleDomain` continues to expose the stabilized per-end reaches used by the quadratic system, but derives each maximum normalized tension from the real signed forward reach. Existing solver and authored-layer clamps consume those per-end maxima unchanged. The generated-curvature reader is corrected independently to call the canonical tension function with its documented argument order.

**Tech Stack:** JavaScript ES modules, Mocha, Chai, npm workspaces.

---

### Task 1: Express the true ceiling in the handle domain

**Files:**
- Modify: `src-js/fontra-core/tests/test-natural-handle-solver.js`
- Modify: `src-js/fontra-core/src/natural-handle-solver.js`

- [ ] **Step 1: Write failing short-forward-reach tests**

Add tests that build the domain from the reported tapered `c` geometry and independently calculate the real forward reach:

```js
it("uses a short forward intersection as the geometric maximum", () => {
  const start = { x: 157, y: 205 };
  const end = { x: 145, y: 133 };
  const startDirection = { x: 0, y: -1 };
  const length = Math.hypot(54, 14);
  const endDirection = { x: 54 / length, y: 14 / length };
  const domain = buildHandleDomain(start, end, startDirection, endDirection);
  const tunni = calculateTunniPoint([
    start,
    add(start, startDirection),
    add(end, endDirection),
    end,
  ]);
  const realEndReach = dot(subtract(tunni, end), endDirection);

  expect(domain.endReach).to.be.greaterThan(realEndReach);
  expect(domain.maxEndTension * domain.endReach).to.be.closeTo(realEndReach, 1e-9);
});

it("lets the geometric ceiling beat the one-unit floor", () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0.5 };
  const startDirection = { x: 1, y: 0 };
  const endLength = Math.hypot(0.1, 0.5);
  const endDirection = { x: -0.1 / endLength, y: -0.5 / endLength };
  const domain = buildHandleDomain(start, end, startDirection, endDirection);

  expect(domain.maxEndTension * domain.endReach).to.be.closeTo(endLength, 1e-9);
  expect(domain.minEndTension).to.equal(domain.maxEndTension);
});
```

Use small local `add`, `subtract`, and `dot` helpers in the test file if equivalent helpers are not already present.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node.exe node_modules/mocha/bin/mocha.js src-js/fontra-core/tests/test-natural-handle-solver.js --reporter spec
```

Expected: both new tests fail because both domain maxima are currently always 1.

- [ ] **Step 3: Implement the separate scale and ceiling**

Change each projected domain end to return a stabilized reach and its true maximum:

```js
const projectedDomain = (anchor, direction) => {
  if (!tunni) return { reach: cap, maxTension: 1 };
  const realReach = dot(subtract(tunni, anchor), direction);
  if (!(realReach > EPSILON)) return { reach: cap, maxTension: 1 };
  const reach = clamp(realReach, floor, cap);
  return {
    reach,
    maxTension: Math.min(1, realReach / reach),
  };
};
```

Build each minimum as `Math.min(MIN_HANDLE_LENGTH / reach, maxTension)` and expose the computed per-end maxima.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2.

Expected: all natural-handle-solver tests pass.

- [ ] **Step 5: Commit the domain correction**

```powershell
git add src-js/fontra-core/src/natural-handle-solver.js src-js/fontra-core/tests/test-natural-handle-solver.js
git commit -m "fix: enforce the true outline handle ceiling"
```

### Task 2: Correct generated tension labels

**Files:**
- Modify: `src-js/fontra-core/tests/test-skeleton-tunni.js`
- Modify: `src-js/fontra-core/src/skeleton-model.js`

- [ ] **Step 1: Write the failing canonical-order regression**

Add a test for:

```js
const curvature = getGeneratedSegmentCurvature(
  {},
  {
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 80 },
      { x: 160, y: 80 },
      { x: 200, y: 0 },
    ],
  }
);
expect(curvature.tension).to.be.closeTo(0.4, 1e-9);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node.exe node_modules/mocha/bin/mocha.js src-js/fontra-core/tests/test-skeleton-tunni.js --reporter spec
```

Expected: the new assertion fails because the reader currently treats the first on-curve as an off-curve.

- [ ] **Step 3: Correct the argument order**

Use:

```js
calculateSegmentTension(points[1], points[0], points[2], points[3])
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: all skeleton Tunni tests pass.

- [ ] **Step 5: Commit the read-path correction**

```powershell
git add src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-tunni.js
git commit -m "fix: report generated segment tension correctly"
```

### Task 3: Verify production geometry and align documentation

**Files:**
- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`

- [ ] **Step 1: Regenerate the supplied `c.json` skeletons diagnostically**

Run a read-only Node script that calls `generateFromSkeleton`, computes each forward handle's real signed reach, and asserts every unrounded automatic length is no greater than that reach plus `1e-9`.

Expected: unrounded construction respects the true ceiling. Any remaining fractional emitted excess must be attributable only to integer grid emission.

- [ ] **Step 2: Update the architecture wording**

Document that stabilized reach is the tension coordinate scale, while a short positive real reach lowers the domain maximum. State that non-crossing wins when the real reach is below one unit. Remove claims that the floored reach itself is always the tangent intersection.

- [ ] **Step 3: Run focused and full verification**

Run:

```powershell
node.exe node_modules/mocha/bin/mocha.js src-js/fontra-core/tests/test-natural-handle-solver.js src-js/fontra-core/tests/test-skeleton-tunni.js src-js/fontra-core/tests/test-skeleton-generator.js --reporter spec
npm.cmd test
npm.cmd run bundle
git diff --check
```

Expected: all tests pass, the bundle succeeds with only pre-existing size/Browserslist warnings, and `git diff --check` reports no errors.

- [ ] **Step 4: Commit documentation and final verification record**

```powershell
git add docs/superpowers/SKELETON-FEATURE-MODEL.md docs/superpowers/DEVELOPMENT-LOG.md
git commit -m "docs: clarify the true outline handle ceiling"
```

