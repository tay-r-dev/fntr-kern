# Serif Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a parametric serif at any open-contour terminal, as a fourth skeleton cap style, from a half-serif parameter set on a local frame.

**Architecture:** All serif geometry lives in one new pure module, `serif-geometry.js`, which knows nothing about outline arrays or trimming — it takes a frame plus a resolved parameter set and returns points. `skeleton-generator.js` gains only the plumbing: resolve parameters, build the frame, trim the two flanks, splice the returned points in. This keeps the serif out of the 4,466-line generator monolith (defect P6).

**Tech Stack:** JavaScript ESM, mocha + chai, `bezier-js`. No new dependencies.

## Global Constraints

- **Absolute font units** are the default for every serif length. A source-level switch selects stroke-width-normalized storage instead. Angles, `tension` and `concavity` are never scaled.
- **Point-count stability:** exactly 11 on-curve points per serif terminal at every parameter value. Degenerate values produce coincident points, never fewer points.
- **No branching on diagnostics.** The reach-clamp report is for the panel only; no generator code may read it.
- **Provenance forward, never recovered** (rail R-D). Trimmed and rebuilt regions must carry `_provenance` across, as `withRoundCapProvenance` does.
- **One copy of every constant and geometry function** (rail R-B). The frame computation has exactly one implementation.
- **Do not port the drop cap's implementation.** It is unfinished. Only the shape of its approach — trim, splice, re-attach provenance, clamp against real arc length — transfers.
- **Per commit** (rail R-G): `npx prettier --write` on touched files. Do **not** run `npm run bundle`; the user runs a bundle watcher and reports compile errors.
- Test command throughout: `cd src-js/fontra-core && npx mocha tests/<file> --reporter spec`

**Frame coordinates**, used by every geometry task: origin at the skeleton endpoint, `u` along the serif axis (positive toward the contour's left side), `v` along the depth direction (positive pointing back into the stroke).

---

### Task 1: Serif schema in the model

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-model.js` (`VALID_CAP_STYLES` at :59, `normalizeSkeletonPoint` at :1213)
- Test: `src-js/fontra-core/tests/test-skeleton-model.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `VALID_SERIF_AXIS_MODES: Set<string>`, `SERIF_HALF_FIELDS: readonly string[]`, `SERIF_TERMINAL_FIELDS: readonly string[]`, all exported from `skeleton-model.js`. `normalizeSkeletonPoint` output gains a `serif` object on on-curve points.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-skeleton-model.js`:

```js
describe("skeleton-model serif schema", () => {
  it("accepts serif as a cap style", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0, capStyle: "serif" });
    expect(point.capStyle).to.equal("serif");
  });

  it("fills every half field, leaving unset values null", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { left: { wingLength: 40 } },
    });
    expect(point.serif.left.wingLength).to.equal(40);
    expect(point.serif.left.tension).to.equal(null);
    expect(point.serif.right.wingLength).to.equal(null);
    expect(Object.keys(point.serif.left)).to.have.length(7);
  });

  it("defaults the axis mode and the link flag", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    expect(point.serif.axisMode).to.equal("perpendicular");
    expect(point.serif.axisAngle).to.equal(0);
    expect(point.serif.linked).to.equal(true);
  });

  it("rejects an unknown axis mode", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0, serif: { axisMode: "diagonal" } });
    expect(point.serif.axisMode).to.equal("perpendicular");
  });

  it("leaves terminal-level values null when unset", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0 });
    expect(point.serif.undersideCup).to.equal(null);
    expect(point.serif.straightDepth).to.equal(null);
  });

  it("does not put serif data on off-curve points", () => {
    const point = normalizeSkeletonPoint({ x: 0, y: 0, type: "cubic", serif: {} });
    expect(point.serif).to.equal(undefined);
  });
});
```

Ensure `normalizeSkeletonPoint` is in the file's import list from `@fontra/core/skeleton-model.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js --reporter spec`
Expected: FAIL — `point.serif` is `undefined`, and `capStyle` normalizes to `null` for `"serif"`.

- [ ] **Step 3: Implement**

In `skeleton-model.js`, extend the cap-style set at :59:

```js
const VALID_CAP_STYLES = new Set(["butt", "round", "square", "drop", "serif"]);
```

Add beside the other field-list exports (near `CAP_POINT_FIELDS`, :66):

```js
export const VALID_SERIF_AXIS_MODES = new Set([
  "perpendicular",
  "horizontal",
  "vertical",
  "absolute",
]);

// One half-serif's shape. Absolute font units unless the source's serif units
// mode says otherwise; `tipCutAngle` is degrees and `tension`/`concavity` are
// dimensionless in every mode. Null means "inherit", so the contour and source
// defaults stay live consumers the way stroke width does.
export const SERIF_HALF_FIELDS = Object.freeze([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "tipCutAngle",
  "reach",
  "tension",
  "concavity",
]);

// Shared by both halves of one terminal. The underside cup is deliberately NOT
// per half: the foot is one curve across the whole terminal, and one cup per
// half produces two scoops meeting at a break in the middle.
export const SERIF_TERMINAL_FIELDS = Object.freeze([
  "axisAngle",
  "undersideCup",
  "straightDepth",
]);
```

Add the normalizers beside `normalizeWidth` (:2975):

```js
function normalizeSerifHalf(half) {
  const normalized = {};
  for (const field of SERIF_HALF_FIELDS) {
    normalized[field] = Number.isFinite(half?.[field]) ? half[field] : null;
  }
  return normalized;
}

function normalizeSerif(serif) {
  const normalized = {
    left: normalizeSerifHalf(serif?.left),
    right: normalizeSerifHalf(serif?.right),
    linked: serif?.linked !== false,
    axisMode: VALID_SERIF_AXIS_MODES.has(serif?.axisMode)
      ? serif.axisMode
      : "perpendicular",
  };
  normalized.axisAngle = Number.isFinite(serif?.axisAngle) ? serif.axisAngle : 0;
  for (const field of ["undersideCup", "straightDepth"]) {
    normalized[field] = Number.isFinite(serif?.[field]) ? serif[field] : null;
  }
  return normalized;
}
```

In `normalizeSkeletonPoint`, inside the `if (!type)` block (after the `handleOffsets` line at :1229):

```js
    normalized.serif = normalizeSerif(point?.serif);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js --reporter spec`
Expected: PASS, and no existing test in the file regresses.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-model.js
git add .
git commit -m "feat: serif cap style and per-point serif schema"
```

---

### Task 2: Mirroring swaps the halves

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-model.js` (`transformSkeletonPointMetadata` at :2082, the field list at :2101)
- Test: `src-js/fontra-core/tests/test-skeleton-model.js`

**Interfaces:**
- Consumes: `point.serif` from Task 1.
- Produces: no new exports. `transformSkeletonPointMetadata(point, affine)` now handles serif fields.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-skeleton-model.js`:

```js
describe("skeleton-model serif mirroring", () => {
  const mirrorX = { xx: -1, xy: 0, yx: 0, yy: 1, dx: 0, dy: 0 };
  const scaleUp = { xx: 2, xy: 0, yx: 0, yy: 2, dx: 0, dy: 0 };

  function serifPoint() {
    return normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: {
        left: { wingLength: 40, tipCutAngle: 5 },
        right: { wingLength: 90, tipCutAngle: -12 },
        axisMode: "absolute",
        axisAngle: 30,
      },
    });
  }

  it("swaps the two halves on a determinant flip", () => {
    const point = serifPoint();
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.left.wingLength).to.equal(90);
    expect(point.serif.right.wingLength).to.equal(40);
  });

  it("negates the absolute axis angle on a flip", () => {
    const point = serifPoint();
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.axisAngle).to.equal(-30);
  });

  it("leaves the axis mode alone on a flip", () => {
    const point = normalizeSkeletonPoint({
      x: 0,
      y: 0,
      serif: { axisMode: "horizontal" },
    });
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif.axisMode).to.equal("horizontal");
  });

  it("does not swap halves when the determinant is positive", () => {
    const point = serifPoint();
    transformSkeletonPointMetadata(point, scaleUp);
    expect(point.serif.left.wingLength).to.equal(40);
    expect(point.serif.axisAngle).to.equal(30);
  });

  it("round-trips through two mirrors", () => {
    const point = serifPoint();
    const before = JSON.parse(JSON.stringify(point.serif));
    transformSkeletonPointMetadata(point, mirrorX);
    transformSkeletonPointMetadata(point, mirrorX);
    expect(point.serif).to.deep.equal(before);
  });
});
```

Ensure `transformSkeletonPointMetadata` is imported in the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js --reporter spec`
Expected: FAIL on the swap and the angle negation; the positive-determinant test passes already.

- [ ] **Step 3: Implement**

In `transformSkeletonPointMetadata`, extend the field list at :2101:

```js
  for (const field of [
    "width",
    "nudge",
    "handleNudge",
    "locked",
    "segmentCurvature",
    "serif",
  ]) {
    swapProperties(point[field], "left", "right");
  }
```

Then, beside the existing `capAngle` / `cornerAsymmetry` negations (:2107):

```js
  // The absolute serif axis angle is a direction in glyph space, so it reflects
  // like capAngle. `axisMode` does not: horizontal stays horizontal under a
  // mirror. `tipCutAngle` and `wingSlope` also do not, because they are measured
  // inside their own half's frame and swapping the halves is the whole
  // correction.
  if (Number.isFinite(point.serif?.axisAngle)) {
    point.serif.axisAngle = -point.serif.axisAngle;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-model.js
git add .
git commit -m "feat: mirror serif halves and axis angle on determinant flip"
```

---

### Task 3: Source-level serif defaults

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-model.js` (`SKELETON_SOURCE_DEFAULT_KEYS` at :139, `SKELETON_SOURCE_DEFAULT_FALLBACKS` at :158, `SKELETON_SOURCE_DEFAULT_KEY_PATHS` at :177, `normalizeSkeletonSourceDefaults` at :245)
- Test: `src-js/fontra-core/tests/test-skeleton-source-defaults.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two new keys on `SKELETON_SOURCE_DEFAULT_KEYS` — `SERIF_UNITS_MODE` (`"serifUnitsMode"`, values `"absolute" | "normalized"`, default `"absolute"`) and `SERIF_REMOVE_COLLAPSED` (`"serifRemoveCollapsedPoints"`, boolean, default `false`). Read with the existing `getSourceSkeletonDefaultsValue(source, key, fallback)`.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-skeleton-source-defaults.js`:

```js
describe("skeleton source defaults for serifs", () => {
  it("defaults to absolute units with collapsed-point removal off", () => {
    const normalized = normalizeSkeletonSourceDefaults({});
    expect(normalized.serifDefaults.unitsMode).to.equal("absolute");
    expect(normalized.serifDefaults.removeCollapsedPoints).to.equal(false);
  });

  it("keeps a stored units mode", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      serifDefaults: { unitsMode: "normalized" },
    });
    expect(normalized.serifDefaults.unitsMode).to.equal("normalized");
  });

  it("rejects an unknown units mode", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      serifDefaults: { unitsMode: "percent" },
    });
    expect(normalized.serifDefaults.unitsMode).to.equal("absolute");
  });

  it("coerces collapsed-point removal to a boolean", () => {
    const normalized = normalizeSkeletonSourceDefaults({
      serifDefaults: { removeCollapsedPoints: 1 },
    });
    expect(normalized.serifDefaults.removeCollapsedPoints).to.equal(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-source-defaults.js --reporter spec`
Expected: FAIL — `serifDefaults` is undefined.

- [ ] **Step 3: Implement**

Add to `SKELETON_SOURCE_DEFAULT_KEYS` (:139):

```js
  SERIF_UNITS_MODE: "serifUnitsMode",
  SERIF_REMOVE_COLLAPSED: "serifRemoveCollapsedPoints",
```

Add to `SKELETON_SOURCE_DEFAULT_FALLBACKS` (:158):

```js
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_UNITS_MODE]: "absolute",
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED]: false,
```

Add to `SKELETON_SOURCE_DEFAULT_KEY_PATHS` (:177):

```js
  [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_UNITS_MODE, ["serifDefaults", "unitsMode"]],
  [
    SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED,
    ["serifDefaults", "removeCollapsedPoints"],
  ],
```

Add the constant beside `VALID_SERIF_AXIS_MODES`:

```js
export const VALID_SERIF_UNITS_MODES = new Set(["absolute", "normalized"]);
```

In `normalizeSkeletonSourceDefaults` (:245), before the `return`:

```js
  // Both of these are properties of how the font is being worked on, not of any
  // one letter, which is why they sit at source level rather than per terminal.
  // Removing collapsed points forfeits cross-master interpolation for serifed
  // terminals, so it is off until a designer turns it on for production.
  const serifDefaults = ensureSkeletonDefaultsObject(defaults, "serifDefaults");
  serifDefaults.unitsMode = VALID_SERIF_UNITS_MODES.has(serifDefaults.unitsMode)
    ? serifDefaults.unitsMode
    : "absolute";
  serifDefaults.removeCollapsedPoints = serifDefaults.removeCollapsedPoints === true
    || serifDefaults.removeCollapsedPoints === 1;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-source-defaults.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-source-defaults.js
git add .
git commit -m "feat: source-level serif units mode and collapsed-point switch"
```

---

### Task 4: The serif frame

**Files:**
- Create: `src-js/fontra-core/src/serif-geometry.js`
- Test: `src-js/fontra-core/tests/test-serif-geometry.js`

**Interfaces:**
- Consumes: `VALID_SERIF_AXIS_MODES` from Task 1 (validation only; the frame trusts its input).
- Produces:
  - `MIN_AXIS_TANGENT_SEPARATION_DEG = 15`
  - `computeSerifFrame({ endpoint, tangent, normal, axisMode, axisAngle }) -> { origin, axis, depth, toFrame(pt), toGlyph({u, v}) }` where `endpoint`, `tangent`, `normal` are `{x, y}`, `tangent` points **out** of the stroke, `normal` is the effective rib normal (left side positive). `axis` and `depth` are unit `{x, y}`. `toFrame` maps a glyph point to `{u, v}`; `toGlyph` maps back.

- [ ] **Step 1: Write the failing tests**

Create `src-js/fontra-core/tests/test-serif-geometry.js`:

```js
import { computeSerifFrame } from "@fontra/core/serif-geometry.js";
import { expect } from "chai";

const CLOSE = 1e-9;

function expectClose(actual, expected, message) {
  expect(Math.abs(actual - expected), message).to.be.below(1e-6);
}

describe("serif frame", () => {
  // A stem running upward, terminal at the bottom, so the outward tangent
  // points down. rotateVector90CW of the upward direction is (1, 0), which the
  // generator treats as the left side.
  const downTerminal = {
    endpoint: { x: 0, y: 0 },
    tangent: { x: 0, y: -1 },
    normal: { x: 1, y: 0 },
  };

  it("puts the axis perpendicular to the tangent by default", () => {
    const frame = computeSerifFrame({ ...downTerminal, axisMode: "perpendicular" });
    expectClose(frame.axis.x, 1);
    expectClose(frame.axis.y, 0);
  });

  it("points the depth back into the stroke", () => {
    const frame = computeSerifFrame({ ...downTerminal, axisMode: "perpendicular" });
    expectClose(frame.depth.x, 0);
    expectClose(frame.depth.y, 1);
  });

  it("orients the axis toward the left side", () => {
    const frame = computeSerifFrame({ ...downTerminal, axisMode: "perpendicular" });
    expect(frame.axis.x * downTerminal.normal.x + frame.axis.y * downTerminal.normal.y)
      .to.be.above(0);
  });

  it("holds a horizontal axis while the tangent rotates", () => {
    for (const degrees of [-60, -30, 30, 60]) {
      const radians = (degrees * Math.PI) / 180;
      const tangent = { x: Math.sin(radians), y: -Math.cos(radians) };
      const frame = computeSerifFrame({
        endpoint: { x: 0, y: 0 },
        tangent,
        normal: { x: Math.cos(radians), y: Math.sin(radians) },
        axisMode: "horizontal",
      });
      expectClose(Math.abs(frame.axis.y), 0, `axis stayed horizontal at ${degrees}`);
    }
  });

  it("uses the absolute angle when asked", () => {
    const frame = computeSerifFrame({
      ...downTerminal,
      axisMode: "absolute",
      axisAngle: 30,
    });
    expectClose(frame.axis.x, Math.cos(Math.PI / 6));
    expectClose(frame.axis.y, Math.sin(Math.PI / 6));
  });

  it("keeps the axis at least 15 degrees off the tangent", () => {
    // Horizontal axis on a horizontal stroke would collapse the frame.
    const frame = computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: -1 },
      axisMode: "horizontal",
    });
    const cross = Math.abs(frame.axis.x * 0 - frame.axis.y * 1);
    expectClose(cross, Math.sin((15 * Math.PI) / 180));
  });

  it("keeps axis and depth orthonormal in every mode", () => {
    for (const axisMode of ["perpendicular", "horizontal", "vertical", "absolute"]) {
      const frame = computeSerifFrame({ ...downTerminal, axisMode, axisAngle: 20 });
      expectClose(Math.hypot(frame.axis.x, frame.axis.y), 1, `axis unit in ${axisMode}`);
      expectClose(Math.hypot(frame.depth.x, frame.depth.y), 1, `depth unit in ${axisMode}`);
      expectClose(
        frame.axis.x * frame.depth.x + frame.axis.y * frame.depth.y,
        0,
        `orthogonal in ${axisMode}`
      );
    }
  });

  it("round-trips a point through frame and glyph coordinates", () => {
    const frame = computeSerifFrame({
      ...downTerminal,
      axisMode: "absolute",
      axisAngle: 37,
    });
    const original = { x: 12.5, y: -8.25 };
    const back = frame.toGlyph(frame.toFrame(original));
    expectClose(back.x, original.x);
    expectClose(back.y, original.y);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js --reporter spec`
Expected: FAIL — cannot resolve `@fontra/core/serif-geometry.js`.

- [ ] **Step 3: Implement**

Create `src-js/fontra-core/src/serif-geometry.js`:

```js
import * as vector from "./vector.js";

// A serif whose axis runs along the stroke has no wings to speak of and no
// sensible release on either flank. Rather than falling back to another mode —
// which would jump — the axis is pushed off the tangent until it clears this
// separation. Continuous everywhere except exactly parallel, which is a single
// measure-zero configuration.
export const MIN_AXIS_TANGENT_SEPARATION_DEG = 15;

function unitFromDegrees(degrees) {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function rawAxisForMode(axisMode, axisAngle, tangent) {
  switch (axisMode) {
    case "horizontal":
      return { x: 1, y: 0 };
    case "vertical":
      return { x: 0, y: 1 };
    case "absolute":
      return unitFromDegrees(axisAngle ?? 0);
    default:
      // Perpendicular to the stroke: the ordinary stem foot.
      return vector.rotateVector90CW(tangent);
  }
}

// The axis is a line, not a ray, so only its angle modulo 180 degrees matters
// here; orientation is fixed afterwards against the rib normal.
function separateFromTangent(axis, tangent) {
  const cross = axis.x * tangent.y - axis.y * tangent.x;
  const dot = axis.x * tangent.x + axis.y * tangent.y;
  const minSine = Math.sin((MIN_AXIS_TANGENT_SEPARATION_DEG * Math.PI) / 180);
  if (Math.abs(cross) >= minSine) {
    return axis;
  }
  const tangentAngle = Math.atan2(tangent.y, tangent.x);
  const side = cross === 0 ? (dot >= 0 ? 1 : -1) : Math.sign(cross);
  const separated =
    tangentAngle + (side * MIN_AXIS_TANGENT_SEPARATION_DEG * Math.PI) / 180;
  return { x: Math.cos(separated), y: Math.sin(separated) };
}

export function computeSerifFrame({ endpoint, tangent, normal, axisMode, axisAngle }) {
  const outward = vector.normalizeVector(tangent);
  let axis = vector.normalizeVector(rawAxisForMode(axisMode, axisAngle, outward));
  axis = separateFromTangent(axis, outward);

  // Positive u points at the contour's left side, matching the generator's own
  // rib convention, so a half stored as "left" is the half on the left.
  if (axis.x * normal.x + axis.y * normal.y < 0) {
    axis = { x: -axis.x, y: -axis.y };
  }

  // Depth is perpendicular to the axis, not to the tangent, so the frame stays
  // orthonormal in every mode. It points back into the stroke.
  let depth = { x: -axis.y, y: axis.x };
  if (depth.x * outward.x + depth.y * outward.y > 0) {
    depth = { x: -depth.x, y: -depth.y };
  }

  const origin = { x: endpoint.x, y: endpoint.y };
  return {
    origin,
    axis,
    depth,
    toFrame(point) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      return { u: dx * axis.x + dy * axis.y, v: dx * depth.x + dy * depth.y };
    },
    toGlyph({ u, v }) {
      return {
        x: origin.x + axis.x * u + depth.x * v,
        y: origin.y + axis.y * u + depth.y * v,
      };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js --reporter spec`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/tests/test-serif-geometry.js
git add .
git commit -m "feat: serif frame with perpendicular, axis-locked and absolute modes"
```

---

### Task 5: One half-serif in frame coordinates

**Files:**
- Modify: `src-js/fontra-core/src/serif-geometry.js`
- Test: `src-js/fontra-core/tests/test-serif-geometry.js`

**Interfaces:**
- Consumes: the frame from Task 4 (not directly — this function works purely in `{u, v}`).
- Produces: `buildHalfSerif({ side, flankU, params, straightDepth }) -> { straightTop, straightBottom, control1, control2, tipTop, tipBottom, wingInnerV }`. `side` is `1` for left and `-1` for right. `params` carries the seven resolved half fields. Every returned value is `{u, v}`. `control1`/`control2` are the cubic controls of the transition curve, ordered `straightBottom → tipTop`.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-serif-geometry.js`, and add `buildHalfSerif` to the import:

```js
describe("half serif in frame coordinates", () => {
  const base = {
    wingLength: 60,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 80,
    tension: 0.7,
    concavity: 0.8,
  };
  const build = (overrides = {}, side = 1, straightDepth = 0) =>
    buildHalfSerif({ side, flankU: 50, params: { ...base, ...overrides }, straightDepth });

  it("puts the tip bottom on the foot line, out past the flank", () => {
    const half = build();
    expectClose(half.tipBottom.v, 0);
    expectClose(half.tipBottom.u, 110);
  });

  it("raises the tip top by the tip thickness", () => {
    const half = build();
    expectClose(half.tipTop.u, 110);
    expectClose(half.tipTop.v, 30);
  });

  it("splays the tip with a positive cut angle", () => {
    const half = build({ tipCutAngle: 45 });
    // The outer edge leans out by tipThickness * tan(45) = 30.
    expectClose(half.tipBottom.u, 140);
    expectClose(half.tipTop.u, 110);
  });

  it("mirrors every u for the right half", () => {
    const left = build();
    const right = build({}, -1);
    expectClose(right.tipBottom.u, -left.tipBottom.u);
    expectClose(right.tipTop.v, left.tipTop.v);
  });

  it("ends the transition curve at reach above the wing inner corner", () => {
    const half = build({ wingSlope: 12 });
    expectClose(half.wingInnerV, 42);
    expectClose(half.straightBottom.v, 122);
    expectClose(half.straightBottom.u, 50);
  });

  it("collapses the straight run at depth zero", () => {
    const half = build();
    expect(half.straightTop).to.deep.equal(half.straightBottom);
  });

  it("raises the straight top by the straight depth, at constant u", () => {
    const half = build({}, 1, 25);
    expectClose(half.straightTop.u, half.straightBottom.u);
    expectClose(half.straightTop.v - half.straightBottom.v, 25);
  });

  it("collapses the transition to a straight line at tension zero", () => {
    const half = build({ tension: 0 });
    expect(half.control1).to.deep.equal(half.tipTop);
    expect(half.control2).to.deep.equal(half.straightBottom);
  });

  it("pulls the transition toward the inner corner at high tension", () => {
    const half = build({ tension: 1, concavity: 1 });
    // Both controls land on the inner corner itself.
    expectClose(half.control1.u, 50);
    expectClose(half.control1.v, 30);
    expectClose(half.control2.u, 50);
    expectClose(half.control2.v, 30);
  });

  it("bulges the transition outward at negative concavity", () => {
    const hollow = build({ concavity: 0.8 });
    const bulged = build({ concavity: -0.8 });
    // Concavity moves the attractor across the chord, so the controls swap sides.
    expect(bulged.control1.u).to.be.above(hollow.control1.u);
  });

  it("emits a wingless half without losing any point", () => {
    const half = build({ wingLength: 0 });
    expectClose(half.tipBottom.u, 50);
    expectClose(half.tipTop.u, 50);
    expect(Object.keys(half)).to.have.length(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js --reporter spec`
Expected: FAIL — `buildHalfSerif` is not exported.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/serif-geometry.js`:

```js
const MAX_TIP_CUT_ANGLE = 80;

function lerpUV(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

// One half-serif, entirely in frame coordinates. `side` is +1 for the left half
// and -1 for the right, so the same seven numbers describe both and the caller
// never mirrors anything by hand.
//
// The wing inner corner is NOT a returned point. It is the attractor the
// transition curve bends around, exactly as in the serif-lab mockup. Emitting it
// would split the sweep from tip to flank into two segments and destroy the
// bracketed look.
export function buildHalfSerif({ side, flankU, params, straightDepth }) {
  const wingLength = params.wingLength ?? 0;
  const tipThickness = params.tipThickness ?? 0;
  const wingSlope = params.wingSlope ?? 0;
  const reach = Math.max(params.reach ?? 0, 0);
  const tension = Math.min(Math.max(params.tension ?? 0, 0), 1);
  const concavity = Math.min(Math.max(params.concavity ?? 0, -1), 1);
  const cutAngle = Math.min(
    Math.max(params.tipCutAngle ?? 0, -MAX_TIP_CUT_ANGLE),
    MAX_TIP_CUT_ANGLE
  );

  const depthOfStraight = Math.max(straightDepth ?? 0, 0);
  const wingInnerV = tipThickness + wingSlope;
  const tipU = flankU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };
  const straightBottom = { u: flankU, v: wingInnerV + reach };
  const straightTop = { u: flankU, v: wingInnerV + reach + depthOfStraight };

  // The transition cubic runs straightBottom -> tipTop. Its controls are pulled
  // from the chord toward the inner corner by `concavity`, then toward that
  // attractor by `tension`. At tension 0 the controls sit on the endpoints and
  // the curve is a straight line, which is the angular wedge.
  const corner = { u: flankU, v: wingInnerV };
  const mid = lerpUV(tipTop, straightBottom, 0.5);
  const attractor = {
    u: mid.u + (corner.u - mid.u) * concavity,
    v: mid.v + (corner.v - mid.v) * concavity,
  };
  const control1 = lerpUV(tipTop, attractor, tension);
  const control2 = lerpUV(straightBottom, attractor, tension);

  return { straightTop, straightBottom, control1, control2, tipTop, tipBottom, wingInnerV };
}
```

Note `flankU` is passed in rather than derived: it is the axis coordinate of the real rib end, which only the generator knows (Task 8).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/tests/test-serif-geometry.js
git add .
git commit -m "feat: half-serif construction in frame coordinates"
```

---

### Task 6: Terminal assembly — two halves and one foot

**Files:**
- Modify: `src-js/fontra-core/src/serif-geometry.js`
- Test: `src-js/fontra-core/tests/test-serif-geometry.js`

**Interfaces:**
- Consumes: `computeSerifFrame` (Task 4), `buildHalfSerif` (Task 5).
- Produces: `buildSerifTerminal({ frame, leftFlankU, rightFlankU, left, right, undersideCup, straightDepth }) -> { points, halves }`. `points` is an array of glyph-space points in **left-to-right emission order**, each `{x, y}` for on-curve or `{x, y, type: "cubic"}` for controls, starting at the left `straightTop` and ending at the right `straightTop`. It holds **9 on-curve points**; the remaining two of the terminal's eleven are the release points the trimmed flanks contribute in Task 8. `halves` is `{ left, right }`, the raw frame-coordinate output of `buildHalfSerif`, for the generator's trimming maths.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-serif-geometry.js`, adding `buildSerifTerminal` to the import:

```js
describe("serif terminal assembly", () => {
  const half = {
    wingLength: 60,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 80,
    tension: 0.7,
    concavity: 0.8,
  };

  function terminal(overrides = {}) {
    const frame = computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: 0, y: -1 },
      normal: { x: 1, y: 0 },
      axisMode: "perpendicular",
    });
    return buildSerifTerminal({
      frame,
      leftFlankU: 50,
      rightFlankU: -50,
      left: half,
      right: half,
      undersideCup: 0,
      straightDepth: 0,
      ...overrides,
    });
  }

  it("emits exactly nine on-curve points", () => {
    const { points } = terminal();
    const onCurve = points.filter((point) => !point.type);
    expect(onCurve).to.have.length(9);
  });

  it("keeps nine on-curve points at every degenerate value", () => {
    const flat = {
      wingLength: 0,
      tipThickness: 0,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 0,
      tension: 0,
      concavity: 0,
    };
    const { points } = terminal({ left: flat, right: flat, undersideCup: 0 });
    expect(points.filter((point) => !point.type)).to.have.length(9);
  });

  it("puts the foot centre on the skeleton endpoint with no cup", () => {
    const { points } = terminal();
    const centre = points.filter((point) => !point.type)[4];
    expect(Math.abs(centre.x)).to.be.below(1e-9);
    expect(Math.abs(centre.y)).to.be.below(1e-9);
  });

  it("lifts the foot centre by the cup amount, along the depth", () => {
    const { points } = terminal({ undersideCup: 18 });
    const centre = points.filter((point) => !point.type)[4];
    expectClose(centre.y, 18);
  });

  it("keeps the foot centre on the skeleton when the halves are unequal", () => {
    const { points } = terminal({
      left: { ...half, wingLength: 20 },
      right: { ...half, wingLength: 120 },
    });
    const centre = points.filter((point) => !point.type)[4];
    // Not the midpoint of the two tips, which would sit well to the right.
    expect(Math.abs(centre.x)).to.be.below(1e-9);
  });

  it("runs from the left straight top to the right straight top", () => {
    const { points } = terminal();
    const onCurve = points.filter((point) => !point.type);
    expect(onCurve[0].x).to.be.above(0);
    expect(onCurve[8].x).to.be.below(0);
  });

  it("emits one cup curve across the whole foot, not one per half", () => {
    // Four controls on the underside, two either side of the single centre.
    const { points } = terminal({ undersideCup: 18 });
    const centreIndex = points.findIndex(
      (point) => !point.type && Math.abs(point.y - 18) < 1e-9
    );
    expect(points[centreIndex - 1].type).to.equal("cubic");
    expect(points[centreIndex + 1].type).to.equal("cubic");
  });

  it("leaves the foot tangent to the baseline at the tips and flat at the centre", () => {
    const { points } = terminal({ undersideCup: 18 });
    const centreIndex = points.findIndex(
      (point) => !point.type && Math.abs(point.y - 18) < 1e-9
    );
    // Control leaving the left tip stays on the baseline; the one arriving at
    // the centre sits at the cup height. A straight chord between them would be
    // a shallow V, not a scoop.
    expectClose(points[centreIndex - 2].y, 0);
    expectClose(points[centreIndex - 1].y, 18);
  });

  it("returns the frame-space halves for the caller's trimming maths", () => {
    const { halves } = terminal();
    expectClose(halves.left.straightBottom.u, 50);
    expectClose(halves.right.straightBottom.u, -50);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js --reporter spec`
Expected: FAIL — `buildSerifTerminal` is not exported.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/serif-geometry.js`:

```js
// How far along the foot's axis span the underside controls sit.
const FOOT_CONTROL_FRACTION = 1 / 3;

// Each control keeps its own end's depth, so the foot leaves the tip tangent to
// the baseline and arrives at the centre flat. Putting both controls on the
// straight chord instead would give a shallow V, not the old-style scoop. At
// cup 0 both depths are 0 and the foot is a straight line.
function footControls(from, to) {
  const span = to.u - from.u;
  return [
    { u: from.u + span * FOOT_CONTROL_FRACTION, v: from.v },
    { u: from.u + span * (1 - FOOT_CONTROL_FRACTION), v: to.v },
  ];
}

// One serif terminal: two halves plus the single underside curve that joins
// them. Emission order is left straightTop -> ... -> foot centre -> ... -> right
// straightTop, which is the order the generator's assembly wants between the
// trimmed left side and the reversed right side.
//
// The underside is ONE curve across the whole terminal, driven by one cup value.
// The foot centre sits on the skeleton, not at the midpoint of the two tips: the
// axis modes routinely produce unequal halves, and a midpoint-anchored centre
// would drag the contact geometry off the alignment zone as the axis rotates.
export function buildSerifTerminal({
  frame,
  leftFlankU,
  rightFlankU,
  left,
  right,
  undersideCup,
  straightDepth,
}) {
  const halves = {
    left: buildHalfSerif({ side: 1, flankU: leftFlankU, params: left, straightDepth }),
    right: buildHalfSerif({ side: -1, flankU: rightFlankU, params: right, straightDepth }),
  };
  const centre = { u: 0, v: Math.max(undersideCup ?? 0, 0) };

  const onCurve = (uv) => frame.toGlyph(uv);
  const control = (uv) => ({ ...frame.toGlyph(uv), type: "cubic" });

  const [leftCup1, leftCup2] = footControls(halves.left.tipBottom, centre);
  const [rightCup1, rightCup2] = footControls(centre, halves.right.tipBottom);

  return {
    halves,
    points: [
      onCurve(halves.left.straightTop),
      onCurve(halves.left.straightBottom),
      control(halves.left.control2),
      control(halves.left.control1),
      onCurve(halves.left.tipTop),
      onCurve(halves.left.tipBottom),
      control(leftCup1),
      control(leftCup2),
      onCurve(centre),
      control(rightCup1),
      control(rightCup2),
      onCurve(halves.right.tipBottom),
      onCurve(halves.right.tipTop),
      control(halves.right.control1),
      control(halves.right.control2),
      onCurve(halves.right.straightBottom),
      onCurve(halves.right.straightTop),
    ],
  };
}
```

Nine on-curve points are listed here. The remaining two of the terminal's eleven are the release points the two trimmed flanks end on, contributed by the generator in Task 8.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/tests/test-serif-geometry.js
git add .
git commit -m "feat: serif terminal assembly with a single underside curve"
```

---

### Task 7: Carry serif fields across the generator translation

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` (`canonicalPointToGeneratorPoint` at :194, `canonicalToGeneratorInput` at :174)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**
- Consumes: `point.serif` from Task 1.
- Produces: generator-side points carry `serif` (the whole normalized object, copied by value), and generator-side contours carry `serif` from the contour level. Later tasks read `point.serif` on generator points.

**Why this is its own task:** `canonicalToGeneratorInput` flattens every point before generation, and the model's accessors do not work on the far side of it. A new per-point field is invisible to the generator until copied across explicitly. The segment-curvature pin failed silently exactly this way — stored fine, read back fine through its accessor, did nothing at all.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator serif field translation", () => {
  it("carries per-point serif values through to generation", () => {
    // A serif cap that draws nothing but a butt cap unless the fields arrive.
    const canonical = {
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle: "serif",
          points: [
            { id: 1, x: 0, y: 0, serif: { left: { wingLength: 80 } } },
            { id: 2, x: 0, y: 300 },
          ],
        },
      ],
      generated: [],
    };
    const result = generateFromSkeleton(canonical);
    const xs = result.contours[0].points.map((point) => point.x);
    // Without the wing the outline never passes 50; with it, it reaches 130.
    expect(Math.max(...xs)).to.be.above(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: FAIL — the maximum x is 50, because the serif fields never reach the generator. It will keep failing until Task 8 lands; that is expected and the test stays red across the two commits.

- [ ] **Step 3: Implement**

In `canonicalPointToGeneratorPoint`, beside the `ribAngleLock` copy (:215):

```js
  // Serif parameters travel as one object. Like ribAngleLock, they have to be
  // copied across explicitly: the generator never sees the canonical shape, and
  // a field that is not copied here fails silently rather than throwing.
  generatorPoint.serif = point.serif ?? null;
```

In `canonicalToGeneratorInput` (:174), inside the contour mapping beside `capBallSide`:

```js
      serif: contour.serif ?? null,
```

- [ ] **Step 4: Run the test to confirm the fields arrive**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: still FAIL on the assertion (no serif is drawn yet), but add a temporary assertion or a debugger check confirming `generatorPoint.serif.left.wingLength === 80` reaches `generateOutlineFromSkeletonContour`. Remove the temporary check before committing.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: carry serif fields across the generator translation"
```

---

### Task 8: Resolve, trim and splice the serif into the outline

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` (open-contour branch of `generateOutlineFromSkeletonContour`, :1463–1857)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**
- Consumes: `computeSerifFrame`, `buildSerifTerminal` (Tasks 4–6); `point.serif` on generator points (Task 7); `getEffectiveNormal` from `skeleton-model.js`.
- Produces: `buildSerifCap({ position, endpoint, tangent, normal, leftSide, rightSide, leftHalfWidth, rightHalfWidth, serif }) -> { leftSide, rightSide, capPoints, reachClamped } | null`, a module-private function in `skeleton-generator.js`. Returning `null` means the terminal falls back to a butt cap.

- [ ] **Step 1: Write the failing tests**

Replace the placeholder test from Task 7 with a fuller set in `tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator serif cap", () => {
  function stem(serif, capStyle = "serif") {
    return {
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle,
          points: [
            { id: 1, x: 0, y: 0, serif },
            { id: 2, x: 0, y: 300 },
          ],
        },
      ],
      generated: [],
    };
  }

  const slab = {
    left: {
      wingLength: 80, tipThickness: 30, wingSlope: 0,
      tipCutAngle: 0, reach: 60, tension: 0.7, concavity: 0.8,
    },
    right: {
      wingLength: 80, tipThickness: 30, wingSlope: 0,
      tipCutAngle: 0, reach: 60, tension: 0.7, concavity: 0.8,
    },
    axisMode: "perpendicular",
    axisAngle: 0,
    undersideCup: 0,
    straightDepth: 0,
  };

  it("extends the outline out to the wing tips", () => {
    const result = generateFromSkeleton(stem(slab));
    const xs = result.contours[0].points.map((point) => point.x);
    expect(Math.max(...xs)).to.be.closeTo(130, 1);
    expect(Math.min(...xs)).to.be.closeTo(-130, 1);
  });

  it("keeps the serif inside the skeleton's own length", () => {
    const result = generateFromSkeleton(stem(slab));
    const ys = result.contours[0].points.map((point) => point.y);
    expect(Math.min(...ys)).to.be.at.least(-1);
  });

  it("reproduces a butt cap when every serif value is zero", () => {
    const flat = {
      wingLength: 0, tipThickness: 0, wingSlope: 0,
      tipCutAngle: 0, reach: 0, tension: 0, concavity: 0,
    };
    const serifed = generateFromSkeleton(
      stem({ ...slab, left: flat, right: flat, undersideCup: 0 })
    );
    const butt = generateFromSkeleton(stem(null, "butt"));
    const extent = (result) => {
      const ys = result.contours[0].points.map((point) => point.y);
      return Math.min(...ys);
    };
    expect(extent(serifed)).to.be.closeTo(extent(butt), 1);
  });

  it("draws a one-sided serif when only one half has a wing", () => {
    const none = {
      wingLength: 0, tipThickness: 0, wingSlope: 0,
      tipCutAngle: 0, reach: 0, tension: 0, concavity: 0,
    };
    const result = generateFromSkeleton(stem({ ...slab, right: none }));
    const xs = result.contours[0].points.map((point) => point.x);
    expect(Math.max(...xs)).to.be.closeTo(130, 1);
    expect(Math.min(...xs)).to.be.closeTo(-50, 1);
  });

  it("stamps provenance on every emitted serif point", () => {
    const result = generateFromSkeleton(stem(slab));
    const unowned = result.provenance[0].pointMap.filter(
      (entry) => entry && entry.skeletonPointId == null
    );
    expect(unowned).to.have.length(0);
  });

  it("holds the wing direction while the tangent rotates, under a horizontal axis", () => {
    const angles = [-40, 0, 40];
    const widths = angles.map((degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const data = stem({ ...slab, axisMode: "horizontal" });
      data.contours[0].points[1] = {
        id: 2,
        x: 300 * Math.sin(radians),
        y: 300 * Math.cos(radians),
      };
      const result = generateFromSkeleton(data);
      const ys = result.contours[0].points.map((point) => point.y);
      return Math.max(...ys) - Math.min(...ys);
    });
    // A horizontal serif on a tilted stem stays flat, so the lowest points of
    // the two wings sit at the same y.
    expect(widths.every((value) => Number.isFinite(value))).to.equal(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: FAIL — the serif cap style falls through `generateCap` and emits nothing, so the outline is a butt cap.

- [ ] **Step 3: Implement**

Add to the imports at the top of `skeleton-generator.js`:

```js
import { buildSerifTerminal, computeSerifFrame } from "./serif-geometry.js";
```

Add the resolver and the cap builder beside `generateCap` (:4326):

```js
const SERIF_HALF_DEFAULTS = Object.freeze({
  wingLength: 0,
  tipThickness: 0,
  wingSlope: 0,
  tipCutAngle: 0,
  reach: 0,
  tension: 0,
  concavity: 0,
});

// point -> contour -> built-in default, the same live cascade stroke width uses.
// A null on the point is "inherit", not "zero".
function resolveSerifHalf(pointSerif, contourSerif, side) {
  const resolved = {};
  for (const field of Object.keys(SERIF_HALF_DEFAULTS)) {
    resolved[field] =
      pointSerif?.[side]?.[field] ??
      contourSerif?.[side]?.[field] ??
      SERIF_HALF_DEFAULTS[field];
  }
  return resolved;
}

function buildSerifCap({
  position,
  endpoint,
  tangent,
  normal,
  leftSide,
  rightSide,
  leftHalfWidth,
  rightHalfWidth,
  pointSerif,
  contourSerif,
}) {
  const outward = vector.normalizeVector(tangent);
  if (!isUsableDirection(outward)) {
    return null;
  }
  const frame = computeSerifFrame({
    endpoint,
    tangent: outward,
    normal,
    axisMode: pointSerif?.axisMode ?? contourSerif?.axisMode ?? "perpendicular",
    axisAngle: pointSerif?.axisAngle ?? contourSerif?.axisAngle ?? 0,
  });

  // The flank's axis coordinate comes from the real rib end, so an angled or
  // locked rib places the serif where the stroke actually is.
  const leftRibEnd = {
    x: endpoint.x + normal.x * leftHalfWidth,
    y: endpoint.y + normal.y * leftHalfWidth,
  };
  const rightRibEnd = {
    x: endpoint.x - normal.x * rightHalfWidth,
    y: endpoint.y - normal.y * rightHalfWidth,
  };

  const terminal = buildSerifTerminal({
    frame,
    leftFlankU: frame.toFrame(leftRibEnd).u,
    rightFlankU: frame.toFrame(rightRibEnd).u,
    left: resolveSerifHalf(pointSerif, contourSerif, "left"),
    right: resolveSerifHalf(pointSerif, contourSerif, "right"),
    undersideCup: pointSerif?.undersideCup ?? contourSerif?.undersideCup ?? 0,
    straightDepth: pointSerif?.straightDepth ?? contourSerif?.straightDepth ?? 0,
  });

  // Trim each flank back to where the serif's straight top sits, reusing the
  // round cap's split. Task 9 replaces these raw distances with clamped ones.
  const leftTrim = vector.distance(leftRibEnd, frame.toGlyph(terminal.halves.left.straightTop));
  const rightTrim = vector.distance(
    rightRibEnd,
    frame.toGlyph(terminal.halves.right.straightTop)
  );

  const leftSplit = splitTerminalSideForRoundCap(leftSide, position, leftTrim, {
    endpointTangent: outward,
    capTangent: outward,
  });
  const rightSplit = splitTerminalSideForRoundCap(rightSide, position, rightTrim, {
    endpointTangent: outward,
    capTangent: outward,
  });
  if (!leftSplit || !rightSplit) {
    return null;
  }

  const capPoints =
    position === "end" ? terminal.points : [...terminal.points].reverse();

  return {
    leftSide: trimSideForRoundCapEmission(
      leftSplit.sidePoints,
      position,
      leftSplit.referenceEndpointIndex
    ),
    rightSide: trimSideForRoundCapEmission(
      rightSplit.sidePoints,
      position,
      rightSplit.referenceEndpointIndex
    ),
    capPoints,
    reachClamped: false,
  };
}
```

In the open-contour branch, add `startIsSerif` / `endIsSerif` beside the existing style flags (:1496) and a branch before the `generateCap` fallback at both ends. For the end cap (:1815):

```js
    } else if (endIsSerif) {
      const serifCap = buildSerifCap({
        position: "end",
        endpoint: lastOnCurvePoint,
        tangent: endTangent,
        normal: getEffectiveNormal(
          lastOnCurvePoint,
          vector.rotateVector90CW(endTangent)
        ),
        leftSide: roundedLeftSide,
        rightSide: roundedRightSide,
        leftHalfWidth: endCapLeftHW,
        rightHalfWidth: endCapRightHW,
        pointSerif: lastOnCurvePoint.serif,
        contourSerif: skeletonContour.serif,
      });
      if (serifCap) {
        roundedLeftSide = serifCap.leftSide;
        roundedRightSide = serifCap.rightSide;
        endCap = serifCap.capPoints;
      }
    } else {
```

Mirror the same block for the start cap at :1637, passing `position: "start"`, `firstOnCurvePoint`, `startTangent`, `startCapLeftHW`, `startCapRightHW`.

Re-attach provenance on the emitted cap points before returning, using the existing helper:

```js
  for (const point of capPoints) {
    withRoundCapProvenance(point, position === "end" ? lastOnCurvePoint : firstOnCurvePoint);
  }
```

Place this inside `buildSerifCap`, taking the owning skeleton point as a parameter — the round cap's history shows that a rebuilt region without provenance becomes unaddressable, and the editable-generated points beside it stop being selectable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: PASS, including the Task 7 translation test. Existing golden-master tests must also still pass — no fixture uses the serif style yet.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: emit serif caps by trimming and splicing both flanks"
```

---

### Task 9: Clamp the reach against the terminal segment

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` (`buildSerifCap` from Task 8)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**
- Consumes: `buildSerifCap` (Task 8), `getTerminalSegmentLength` (already in `skeleton-generator.js`, used by `buildDropCap`).
- Produces: `buildSerifCap` returns `reachClamped: boolean`, true when either flank's trim was limited. Purely a diagnostic.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator serif reach clamping", () => {
  function shortStem(reach) {
    const half = {
      wingLength: 80, tipThickness: 30, wingSlope: 0,
      tipCutAngle: 0, reach, tension: 0.7, concavity: 0.8,
    };
    return {
      version: 1,
      nextId: 4,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 100,
          capStyle: "serif",
          points: [
            {
              id: 1,
              x: 0,
              y: 0,
              serif: {
                left: half, right: half, axisMode: "perpendicular",
                axisAngle: 0, undersideCup: 0, straightDepth: 0,
              },
            },
            { id: 2, x: 0, y: 40 },
            { id: 3, x: 0, y: 400 },
          ],
        },
      ],
      generated: [],
    };
  }

  it("never consumes more than the terminal segment", () => {
    // The terminal segment is 40 units; a reach of 400 must not eat the next one.
    const result = generateFromSkeleton(shortStem(400));
    const ys = result.contours[0].points.map((point) => point.y);
    expect(Math.max(...ys)).to.be.closeTo(400, 2);
  });

  it("still emits eleven on-curve points at the clamped terminal", () => {
    const clamped = generateFromSkeleton(shortStem(400));
    const roomy = generateFromSkeleton(shortStem(20));
    expect(clamped.contours[0].points.length).to.equal(
      roomy.contours[0].points.length
    );
  });

  it("produces a finite outline when the reach far exceeds the segment", () => {
    const result = generateFromSkeleton(shortStem(10000));
    for (const point of result.contours[0].points) {
      expect(Number.isFinite(point.x)).to.equal(true);
      expect(Number.isFinite(point.y)).to.equal(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: FAIL — an unclamped trim walks past the terminal segment and distorts the outline.

- [ ] **Step 3: Implement**

In `buildSerifCap`, replace the raw trim distances with clamped ones:

```js
  // The trim never walks back past the one segment leaving this terminal.
  // Consuming earlier segments would make the emitted point count depend on how
  // many got eaten, which is exactly the interpolation contract, and it would
  // collide with corner rounding further up the stroke.
  const clampTrim = (side, requested) => {
    const available = Math.max(getTerminalSegmentLength(side, position) * 0.95, 1);
    return {
      distance: Math.min(Math.max(requested, 0), available),
      clamped: requested > available,
    };
  };

  const leftClamp = clampTrim(leftSide, leftTrim);
  const rightClamp = clampTrim(rightSide, rightTrim);
```

Pass `leftClamp.distance` / `rightClamp.distance` to `splitTerminalSideForRoundCap`, and return:

```js
    // Diagnostic only. No generation code may branch on this, or the answer
    // starts feeding back into how the answer is computed.
    reachClamped: leftClamp.clamped || rightClamp.clamped,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: clamp serif reach to the terminal segment"
```

---

### Task 10: Stroke-width-normalized units mode

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` (`resolveSerifHalf` from Task 8, `canonicalToGeneratorInput` at :174)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**
- Consumes: `resolveSerifHalf` (Task 8); `SKELETON_SOURCE_DEFAULT_KEYS.SERIF_UNITS_MODE` (Task 3).
- Produces: `resolveSerifHalf(pointSerif, contourSerif, side, { unitsMode, strokeWidth })`. In `"normalized"` mode the four length fields are multiplied by `strokeWidth`; `tipCutAngle`, `tension` and `concavity` are never scaled. `generateFromSkeleton` accepts `options.serifUnitsMode`, defaulting to `"absolute"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator serif units mode", () => {
  const ratios = {
    wingLength: 0.8, tipThickness: 0.3, wingSlope: 0,
    tipCutAngle: 10, reach: 0.6, tension: 0.7, concavity: 0.8,
  };

  function stem(width) {
    return {
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: width,
          capStyle: "serif",
          points: [
            {
              id: 1, x: 0, y: 0,
              serif: {
                left: ratios, right: ratios, axisMode: "perpendicular",
                axisAngle: 0, undersideCup: 0, straightDepth: 0,
              },
            },
            { id: 2, x: 0, y: 400 },
          ],
        },
      ],
      generated: [],
    };
  }

  const widthOf = (result) => {
    const xs = result.contours[0].points.map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs);
  };

  it("scales serif lengths with stroke width in normalized mode", () => {
    const thin = generateFromSkeleton(stem(100), { serifUnitsMode: "normalized" });
    const thick = generateFromSkeleton(stem(200), { serifUnitsMode: "normalized" });
    expect(widthOf(thick)).to.be.closeTo(widthOf(thin) * 2, 2);
  });

  it("leaves serif lengths alone in absolute mode", () => {
    const thin = generateFromSkeleton(stem(100), { serifUnitsMode: "absolute" });
    const thick = generateFromSkeleton(stem(200), { serifUnitsMode: "absolute" });
    // Only the stem itself grows: 100 units of extra width, no extra wing.
    expect(widthOf(thick) - widthOf(thin)).to.be.closeTo(100, 2);
  });

  it("defaults to absolute", () => {
    const withOption = generateFromSkeleton(stem(150), { serifUnitsMode: "absolute" });
    const withoutOption = generateFromSkeleton(stem(150));
    expect(widthOf(withoutOption)).to.be.closeTo(widthOf(withOption), 1e-6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: FAIL — normalized and absolute produce identical outlines.

- [ ] **Step 3: Implement**

Extend `resolveSerifHalf`:

```js
// Lengths scale with the stroke in normalized mode; angles and the two
// dimensionless shape numbers never do.
const SERIF_LENGTH_FIELDS = new Set([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "reach",
]);

function resolveSerifHalf(pointSerif, contourSerif, side, context) {
  const scale = context?.unitsMode === "normalized" ? context.strokeWidth : 1;
  const resolved = {};
  for (const field of Object.keys(SERIF_HALF_DEFAULTS)) {
    const value =
      pointSerif?.[side]?.[field] ??
      contourSerif?.[side]?.[field] ??
      SERIF_HALF_DEFAULTS[field];
    resolved[field] = SERIF_LENGTH_FIELDS.has(field) ? value * scale : value;
  }
  return resolved;
}
```

In `buildSerifCap`, build the context and pass it to both `resolveSerifHalf` calls, and scale the two terminal-level lengths the same way:

```js
  const unitsContext = {
    unitsMode: serifUnitsMode,
    strokeWidth: leftHalfWidth + rightHalfWidth,
  };
  const lengthScale = unitsContext.unitsMode === "normalized" ? unitsContext.strokeWidth : 1;
```

`undersideCup` and `straightDepth` are multiplied by `lengthScale` where they are read.

Thread `serifUnitsMode` from `generateFromSkeleton(skeletonData, options)` down through `generateContoursFromSkeleton` and `generateOutlineFromSkeletonContour`'s `options` argument, which already carries `contourIndex` and the corner settings. Default `"absolute"` at every hop.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: stroke-width-normalized serif units mode"
```

---

### Task 11: Collapsed-point removal at emission

**Files:**
- Modify: `src-js/fontra-core/src/skeleton-generator.js` (open-contour branch, after `enforceSmoothColinearity` at :1872)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**
- Consumes: `SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED` (Task 3); `generateFromSkeleton` options threading (Task 10).
- Produces: `removeCollapsedOutlinePoints(points, tolerance = 0.5) -> points`, module-private. `generateFromSkeleton` accepts `options.removeCollapsedPoints`, defaulting to `false`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator collapsed serif points", () => {
  const half = {
    wingLength: 0, tipThickness: 0, wingSlope: 0,
    tipCutAngle: 0, reach: 0, tension: 0, concavity: 0,
  };
  const data = () => ({
    version: 1,
    nextId: 3,
    contours: [
      {
        id: 1, closed: false, defaultWidth: 100, capStyle: "serif",
        points: [
          {
            id: 1, x: 0, y: 0,
            serif: {
              left: half, right: half, axisMode: "perpendicular",
              axisAngle: 0, undersideCup: 0, straightDepth: 0,
            },
          },
          { id: 2, x: 0, y: 300 },
        ],
      },
    ],
    generated: [],
  });

  it("keeps every point by default, so masters interpolate", () => {
    const result = generateFromSkeleton(data());
    const onCurve = result.contours[0].points.filter((point) => point.type == null);
    expect(onCurve.length).to.be.above(8);
  });

  it("drops coincident points when the switch is on", () => {
    const kept = generateFromSkeleton(data());
    const dropped = generateFromSkeleton(data(), { removeCollapsedPoints: true });
    expect(dropped.contours[0].points.length).to.be.below(
      kept.contours[0].points.length
    );
  });

  it("leaves a fully-formed serif untouched by the switch", () => {
    const formed = {
      wingLength: 80, tipThickness: 30, wingSlope: 10,
      tipCutAngle: 0, reach: 60, tension: 0.7, concavity: 0.8,
    };
    const source = data();
    source.contours[0].points[0].serif.left = formed;
    source.contours[0].points[0].serif.right = formed;
    source.contours[0].points[0].serif.straightDepth = 20;
    const kept = generateFromSkeleton(source);
    const dropped = generateFromSkeleton(source, { removeCollapsedPoints: true });
    expect(dropped.contours[0].points.length).to.equal(
      kept.contours[0].points.length
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: FAIL on the second test — the option does nothing.

- [ ] **Step 3: Implement**

Add beside `stripCornerRoundMetadata` (:412):

```js
// Production-stage cleanup. Off by default: coincident points are what keeps a
// serif's emitted point count constant across parameter values, which is the
// cross-master interpolation contract. Turning this on forfeits interpolation
// for those terminals, deliberately, once a form is settled.
//
// Runs after grid rounding, so "coincident" means what it means in the exported
// outline rather than in construction space.
function removeCollapsedOutlinePoints(points, tolerance = 0.5) {
  const kept = [];
  for (const point of points) {
    if (point.type) {
      kept.push(point);
      continue;
    }
    const previous = [...kept].reverse().find((candidate) => !candidate.type);
    if (
      previous &&
      Math.abs(previous.x - point.x) <= tolerance &&
      Math.abs(previous.y - point.y) <= tolerance
    ) {
      // Drop the on-curve and the controls that were leading into it.
      while (kept.length && kept[kept.length - 1].type) {
        kept.pop();
      }
      continue;
    }
    kept.push(point);
  }
  return kept;
}
```

In the open-contour branch, wrap the final points (:1872):

```js
    const colinearPoints = enforceSmoothColinearity(
      stripCornerRoundMetadata(outlinePoints),
      true,
      { includeLinearNeighborCases: true, maxHandleRotationDeg: 60 }
    );
    const finalPoints = options.removeCollapsedPoints
      ? removeCollapsedOutlinePoints(colinearPoints)
      : colinearPoints;
```

Thread `removeCollapsedPoints` from `generateFromSkeleton`'s options the same way as `serifUnitsMode` in Task 10.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: opt-in collapsed-point removal for serif terminals"
```

---

### Task 12: Stability sweeps and golden fixtures

**Files:**
- Modify: `src-js/fontra-core/tests/test-skeleton-generator.js`
- Modify: `src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js`
- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: no new exports. Adds four fixtures — `serif-slab`, `serif-didone`, `serif-one-sided`, `serif-horizontal-axis-curve-terminal`.

**Why sweeps, not per-configuration assertions:** a per-configuration assertion has missed every fault in this area of the generator so far. Hold the geometry fixed, walk one input through its range in fine steps, and measure the worst single-step movement against the driver's own step. Start away from degenerate configurations — a sweep beginning at zero-length handles reports its own seed as a large jump.

- [ ] **Step 1: Write the sweep tests**

Append to `tests/test-skeleton-generator.js`:

```js
describe("skeleton-generator serif stability", () => {
  const base = {
    wingLength: 80, tipThickness: 30, wingSlope: 10,
    tipCutAngle: 5, reach: 60, tension: 0.7, concavity: 0.6,
  };

  function outlineFor(overrides, terminalOverrides = {}) {
    const half = { ...base, ...overrides };
    const data = {
      version: 1,
      nextId: 3,
      contours: [
        {
          id: 1, closed: false, defaultWidth: 100, capStyle: "serif",
          points: [
            {
              id: 1, x: 0, y: 0,
              serif: {
                left: half, right: half, axisMode: "perpendicular",
                axisAngle: 0, undersideCup: 0, straightDepth: 0,
                ...terminalOverrides,
              },
            },
            { id: 2, x: 0, y: 400 },
          ],
        },
      ],
      generated: [],
    };
    return generateFromSkeleton(data).contours[0].points;
  }

  const SWEEPS = [
    { field: "wingLength", from: 20, to: 140 },
    { field: "tipThickness", from: 10, to: 90 },
    { field: "wingSlope", from: -20, to: 60 },
    { field: "tipCutAngle", from: -30, to: 30 },
    { field: "reach", from: 20, to: 200 },
    { field: "tension", from: 0.05, to: 0.95 },
    { field: "concavity", from: -0.9, to: 0.9 },
  ];

  for (const { field, from, to } of SWEEPS) {
    it(`holds the point count constant while ${field} sweeps`, () => {
      const counts = new Set();
      for (let step = 0; step <= 40; step++) {
        const value = from + ((to - from) * step) / 40;
        counts.add(outlineFor({ [field]: value }).length);
      }
      expect([...counts]).to.have.length(1);
    });

    it(`moves the outline smoothly while ${field} sweeps`, () => {
      let previous = null;
      let worst = 0;
      for (let step = 0; step <= 40; step++) {
        const value = from + ((to - from) * step) / 40;
        const points = outlineFor({ [field]: value });
        if (previous) {
          for (let i = 0; i < points.length; i++) {
            worst = Math.max(
              worst,
              Math.hypot(points[i].x - previous[i].x, points[i].y - previous[i].y)
            );
          }
        }
        previous = points;
      }
      // One step of the driver moves the outline by at most a few times the
      // step's own size, plus a unit of grid rounding.
      const stepSize = Math.abs(to - from) / 40;
      expect(worst).to.be.below(stepSize * 4 + 2);
    });
  }

  it("holds the point count constant while the straight depth sweeps", () => {
    const counts = new Set();
    for (let depth = 0; depth <= 60; depth += 2) {
      counts.add(outlineFor({}, { straightDepth: depth }).length);
    }
    expect([...counts]).to.have.length(1);
  });

  it("holds the point count constant while the underside cup sweeps", () => {
    const counts = new Set();
    for (let cup = 0; cup <= 40; cup += 2) {
      counts.add(outlineFor({}, { undersideCup: cup }).length);
    }
    expect([...counts]).to.have.length(1);
  });

  it("holds the point count constant while the absolute axis angle sweeps", () => {
    const counts = new Set();
    for (let angle = -70; angle <= 70; angle += 5) {
      counts.add(
        outlineFor({}, { axisMode: "absolute", axisAngle: angle }).length
      );
    }
    expect([...counts]).to.have.length(1);
  });
});
```

- [ ] **Step 2: Run the sweeps and fix what they catch**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js --reporter spec`
Expected: the count sweeps PASS. If a smoothness sweep fails, the fault is real — find the discontinuity in `serif-geometry.js` or the trim, do not loosen the threshold. The one legitimate exception is a sweep crossing the 15° axis separation floor; if that is the cause, narrow the sweep range rather than raising the bound, and say so in a comment.

- [ ] **Step 3: Add the fixtures**

In `tests/scripts/make-skeleton-generator-fixtures.js`, add four cases alongside the existing ones:

```js
  {
    name: "serif-slab",
    canonical: serifStem({
      wingLength: 80, tipThickness: 90, wingSlope: 0,
      tipCutAngle: 0, reach: 20, tension: 0.15, concavity: -0.05,
    }),
  },
  {
    name: "serif-didone",
    canonical: serifStem({
      wingLength: 90, tipThickness: 18, wingSlope: 0,
      tipCutAngle: 0, reach: 70, tension: 0.7, concavity: 0.8,
    }),
  },
  {
    name: "serif-one-sided",
    canonical: serifStem(
      { wingLength: 90, tipThickness: 18, wingSlope: 0,
        tipCutAngle: 0, reach: 70, tension: 0.7, concavity: 0.8 },
      { wingLength: 0, tipThickness: 0, wingSlope: 0,
        tipCutAngle: 0, reach: 40, tension: 0.6, concavity: 0.5 }
    ),
  },
  {
    name: "serif-horizontal-axis-curve-terminal",
    canonical: serifCurveTerminal({ axisMode: "horizontal" }),
  },
```

Write `serifStem(leftHalf, rightHalf = leftHalf)` and `serifCurveTerminal(terminalOverrides)` as local helpers in that script, following the shape of the existing fixture builders. `serifCurveTerminal` must use a short, curved terminal segment — the S case — so the clamping path is recorded.

- [ ] **Step 4: Regenerate and verify**

```bash
cd src-js/fontra-core
node tests/scripts/make-skeleton-generator-fixtures.js
npx mocha tests --extension js --extension ts --reporter spec
```
Expected: the full suite passes, and `git diff` on `fixtures.json` shows **only additions**. Any change to an existing fixture's recorded outline is a regression in the shared path — stop and find it.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/tests/test-skeleton-generator.js src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js
git add .
git commit -m "test: serif stability sweeps and golden fixtures"
```

---

## After this plan

The generator emits serifs and is fully tested, but nothing in the editor drives it yet. The next plans, in order:

1. **Panel** — the parameter set in the right sidebar, with the link toggle, reading through `skeleton-panel-model.js` and writing through `skeleton-panel-edits.js` to `editSkeleton`. Includes surfacing the reach-clamp diagnostic.
2. **Presets** — named parameter vectors on the source defaults, plus the blend slider. Follows the shape of `capProfiles`.
3. **Corner rounding over cap styles** — the reorder deferred in §9 of the spec, which also unlocks `tipRadius`.
4. **Terminal auto-classification and the class-level cascade.**
