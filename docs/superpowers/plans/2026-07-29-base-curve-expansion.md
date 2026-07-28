# Base-Curve Expansion Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the D/S expansion drag to ordinary outline points, so a contour with no skeleton behind it offsets outward or inward under the cursor.

**Architecture:** The offset construction currently buried in `applyFixedRibDelta` is generic — it walks a point list, moves on-curves along their normals and rebuilds each segment's handles by the curvature rule. Tasks 1–3 lift it into a new pure core module (`offset-contour.js`) with the skeleton keeping thin delegating wrappers, and add the base-curve pieces (coupled-group expansion, drag projection) beside it. Tasks 4–7 wire it into the editor as a new behavior name plus a target entry, with a ghost of the pre-drag path and an offset-distance readout.

**Tech Stack:** JavaScript ES modules, mocha + chai (`fontra-core` only), esbuild bundle, prettier.

## Global Constraints

Copied from `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` §2 and the design spec.

- **R-A — Layer placement is fixed.** Pure geometry/math → `fontra-core/src/` (mocha-tested). Hit-testing → `scene-model.js` as `*AtPoint` methods. Interaction → a dedicated `*-interactions.js` / `*-editing.js` module. Rendering → a `visualization-layer-*.js` file. `edit-tools-pointer.js` stays a **thin dispatcher**.
- **R-B — One copy of every constant and geometry function.** If a symbol exists anywhere in forkra, import it. After this work the offset construction must exist in **one** copy, not two.
- **R-C — Skeleton: one write path.** Every skeleton mutation goes through `editSkeleton`. This feature adds no skeleton mutation at all.
- **R-E — No kind-branching in shared emit code.** `makeChangeForDelta` and below must not contain `if (skeleton…)`. Kind decisions happen at construction time, via **target entries**.
- **R-F — Cross-cutting modifiers are behavior names**, not bypass flags.
- **R-G — Test split.** Only `fontra-core` has a harness. `views-editor` has none; those changes carry a manual test matrix.
- **No behavior change to the skeleton drag.** Tasks 1–3 are refactoring. The existing suite must stay green **without editing any existing test**. If an existing test needs changing, the extraction is wrong — stop and re-derive.
- **Baseline:** `cd src-js/fontra-core && npm test` → **1565 passing** before any change.
- **Per-commit hygiene:** `npx prettier --write <touched files>` and `node --check <touched editor files>`. Do **not** run `npm run bundle` — the user has a bundle watcher running and reports compile errors.
- **Grid rounding:** every emitted coordinate goes through the caller's `round` (default `Math.round`), matching the existing drag.
- **Commit message trailer:** end every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src-js/fontra-core/src/offset-contour.js` | **NEW.** Pure contour-offset geometry: segment building, per-point normals, coupled-point groups, the on-curve travel + handle rebuild, and the base-curve drag's offset map. No skeleton concepts. |
| `src-js/fontra-core/tests/test-offset-contour.js` | **NEW.** Tests for the above, all on plain contours carrying no skeleton fields. |
| `src-js/fontra-core/src/skeleton-model.js` | Loses the moved geometry; keeps its existing exported names as delegating wrappers so no other file in the tree changes. |
| `src-js/views-editor/src/base-expand-editing.js` | **NEW.** Behavior-name resolution and the path target entry for the base drag. |
| `src-js/views-editor/src/edit-behavior.js` | Adds the `base-expand` behavior type (empty match tree — the rules move nothing; the target entry does the work). |
| `src-js/views-editor/src/edit-tools-pointer.js` | Dispatch only: pick the behavior name, build the target entry, publish the ghost. |
| `src-js/views-editor/src/scene-model.js` | The ghost snapshot and the offset-distance readout. |
| `src-js/views-editor/src/visualization-layer-definitions.js` | The ghost layer. |

---

### Task 1: Generic contour geometry — segments, normals, coupled groups

Move the parts of `skeleton-model.js` that never read a skeleton field into a new pure module, leaving delegating wrappers behind.

**Files:**
- Create: `src-js/fontra-core/src/offset-contour.js`
- Create: `src-js/fontra-core/tests/test-offset-contour.js`
- Modify: `src-js/fontra-core/src/skeleton-model.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `buildContourSegments(points, closed) -> Array<{startPoint, endPoint, controlPoints}>`
  - `calculateContourNormalAtPoint(points, closed, pointIndex) -> {x, y}`
  - `isStraightControlledSmoothPoint(point, straightSegment, curveSegment) -> boolean`
  - `straightSegmentNormal(straightSegment) -> {x, y}`
  - `collectCoupledPointGroups(segments, isClosed, isCoupled?) -> Map<point, Array<point>>` — `isCoupled` defaults to `() => true`

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-offset-contour.js`:

```js
import { expect } from "chai";
import {
  buildContourSegments,
  calculateContourNormalAtPoint,
  collectCoupledPointGroups,
} from "@fontra/core/offset-contour.js";

// Plain contour points, exactly as they come out of VarPackedPath's unpacked
// form: on-curves have no `type`, off-curves carry `type: "cubic"`. Nothing here
// has a width, an id, or any other skeleton field — that is the whole point.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });

describe("offset-contour geometry", () => {
  it("takes the normal at a corner from the miter bisector", () => {
    // A right angle at (100, 0): incoming direction +x, outgoing +y. The
    // bisector points up-right, so its CW normal is down-right, normalized.
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const normal = calculateContourNormalAtPoint(points, false, 1);
    expect(normal.x).to.be.closeTo(Math.SQRT1_2, 1e-9);
    expect(normal.y).to.be.closeTo(-Math.SQRT1_2, 1e-9);
  });

  it("takes the normal at a one-handled smooth point from its straight", () => {
    // Point 1 is smooth and has a handle only on the curve side, so it owns no
    // direction: the straight 0-1 sets it, and the normal is perpendicular to
    // that straight rather than to a miter average.
    const points = [
      onCurve(0, 0),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    const normal = calculateContourNormalAtPoint(points, false, 1);
    expect(normal.x).to.be.closeTo(0, 1e-9);
    expect(normal.y).to.be.closeTo(-1, 1e-9);
  });

  it("couples the two ends of a straight carrying a one-handled smooth point", () => {
    const points = [
      onCurve(0, 0),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    const groups = collectCoupledPointGroups(buildContourSegments(points, false), false);
    expect(groups.get(points[0])).to.have.members([points[0], points[1]]);
    expect(groups.get(points[1])).to.have.members([points[0], points[1]]);
    expect(groups.get(points[4])).to.equal(undefined);
  });

  it("leaves a plain straight between two corners uncoupled", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const groups = collectCoupledPointGroups(buildContourSegments(points, false), false);
    expect(groups.size).to.equal(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-contour.js`
Expected: FAIL — cannot resolve `@fontra/core/offset-contour.js`.

- [ ] **Step 3: Create the module by moving code out of `skeleton-model.js`**

Create `src-js/fontra-core/src/offset-contour.js`. Move these **verbatim** out of `skeleton-model.js` (delete them there):

- `makeSegment`, `makeWrappingSegment`, `createBezierFromSegment`, `segmentStartDirection`, `segmentEndDirection` — private helpers
- `isStraightControlledSmoothPoint`, `straightSegmentNormal` — keep the exported names
- `tiesTheRibsAtItsEnds`, renamed to `couplesItsEnds`, with its `isTied` parameter renamed `isCoupled` (body otherwise unchanged; keep the doc comment and update it to say "coupled" rather than "tied")
- `buildSegmentsFromSkeletonPoints`, renamed `buildContourSegments`
- `collectTiedRibGroups`, renamed `collectCoupledPointGroups`, with the default changed from `ribTiedByDefault` to `() => true` (the rib opt-out is a skeleton concept and stays in `skeleton-model.js`)

Then add the generic normal, which is the body of `calculateNormalAtSkeletonPoint` **without** the id resolution and **without** `getEffectiveNormal`:

```js
/**
 * The outward-ish normal at an on-curve point of any contour: the CW rotation of
 * the miter bisector of its two segment directions. A smooth point carrying a
 * single handle has no direction of its own — the straight on its other side
 * sets one — so its normal is perpendicular to that straight instead.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {number} pointIndex - Index of the on-curve point
 * @returns {Object} Normal {x, y}
 */
export function calculateContourNormalAtPoint(points, closed, pointIndex) {
  if (!points || points.length < 2) {
    return { x: 0, y: 1 };
  }
  const point = points[pointIndex];
  if (!point || point.type) {
    return { x: 0, y: 1 };
  }

  const segments = buildContourSegments(points, closed);
  let incomingSegment = null;
  let outgoingSegment = null;
  for (const segment of segments) {
    if (segment.endPoint === point) {
      incomingSegment = segment;
    }
    if (segment.startPoint === point) {
      outgoingSegment = segment;
    }
  }

  const dir1 = incomingSegment ? segmentEndDirection(incomingSegment) : null;
  const dir2 = outgoingSegment ? segmentStartDirection(outgoingSegment) : null;

  if (!dir1 && dir2) {
    return rotateVector90CW(dir2);
  }
  if (dir1 && !dir2) {
    return rotateVector90CW(dir1);
  }
  if (!dir1 && !dir2) {
    return { x: 0, y: 1 };
  }

  if (isStraightControlledSmoothPoint(point, incomingSegment, outgoingSegment)) {
    return straightSegmentNormal(incomingSegment);
  }
  if (isStraightControlledSmoothPoint(point, outgoingSegment, incomingSegment)) {
    return straightSegmentNormal(outgoingSegment);
  }

  const dot = dir1.x * dir2.x + dir1.y * dir2.y;
  const cross = dir1.x * dir2.y - dir1.y * dir2.x;
  const halfAngle = Math.atan2(cross, dot) / 2;
  const cosH = Math.cos(halfAngle);
  const sinH = Math.sin(halfAngle);
  const bisector = normalizeVector({
    x: dir1.x * cosH - dir1.y * sinH,
    y: dir1.x * sinH + dir1.y * cosH,
  });
  return rotateVector90CW(bisector);
}
```

The module's imports:

```js
import { Bezier } from "bezier-js";
import { normalizeVector, rotateVector90CW, subVectors } from "./vector.js";
```

- [ ] **Step 4: Add the delegating wrappers in `skeleton-model.js`**

Add the import:

```js
import {
  buildContourSegments,
  calculateContourNormalAtPoint,
  collectCoupledPointGroups,
  isStraightControlledSmoothPoint,
  straightSegmentNormal,
} from "./offset-contour.js";
```

Re-export the two names other files already import, and wrap the two that carry skeleton semantics:

```js
export { isStraightControlledSmoothPoint, straightSegmentNormal };

export function buildSegmentsFromSkeletonPoints(points, closed) {
  return buildContourSegments(points, closed);
}

const ribTiedByDefault = (point) => point?.width?.tied !== false;

// The rib opt-out is skeleton-only: `width.tied` on either end frees a straight
// from the shared offset. Base contours have no such field and always couple, so
// the generic collector defaults to always-coupled and this supplies the flag.
export function collectTiedRibGroups(segments, isClosed, isTied = ribTiedByDefault) {
  return collectCoupledPointGroups(segments, isClosed, isTied);
}

// The generic normal plus the skeleton's per-point rib-angle override, which is
// a pure post-transform of the result and so composes after it.
export function calculateNormalAtSkeletonPoint(skeletonContour, pointIndexOrPointId) {
  const points = skeletonContour?.points || [];
  const pointIndex =
    pointIndexOrPointId >= 0 && pointIndexOrPointId < points.length
      ? pointIndexOrPointId
      : points.findIndex((point) => point.id === pointIndexOrPointId);
  const normal = calculateContourNormalAtPoint(
    points,
    skeletonContour?.closed,
    pointIndex
  );
  const point = points[pointIndex];
  return point && !point.type ? getEffectiveNormal(point, normal) : normal;
}
```

Keep `getEffectiveNormal` and `makeWrappingSegment`'s callers in mind: if any remaining code in `skeleton-model.js` referenced a moved private helper, import it from the new module rather than keeping a second copy (R-B).

- [ ] **Step 5: Run the new tests**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-contour.js`
Expected: PASS, 4 passing.

- [ ] **Step 6: Run the full suite — no existing test may change**

Run: `cd src-js/fontra-core && npm test`
Expected: **1569 passing** (1565 baseline + 4 new). If any pre-existing test fails, the extraction changed behavior — fix the extraction, never the test.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-contour.js src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-offset-contour.js
git add src-js/fontra-core/src/offset-contour.js src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-offset-contour.js
git commit -m "refactor: lift contour segments, normals and coupling out of the skeleton

None of it reads a skeleton field. The rib opt-out and the per-point rib-angle
override stay behind as the skeleton's own layer on top.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Move the offset construction itself

The on-curve travel and the handle rebuild are the part the base drag actually needs. They move next, with the skeleton drag calling into them.

**Files:**
- Modify: `src-js/fontra-core/src/offset-contour.js`
- Modify: `src-js/fontra-core/src/skeleton-model.js:330-523` (`applyFixedRibDelta` and the four helpers below it)
- Modify: `src-js/fontra-core/tests/test-offset-contour.js`

**Interfaces:**
- Consumes: `calculateContourNormalAtPoint`, `buildContourSegments` from Task 1.
- Produces:
  - `offsetContourAlongNormals(points, closed, offsetsByIndex, workingPoints, options?) -> boolean`
    - `points`: original point objects (read-only)
    - `closed`: boolean
    - `offsetsByIndex`: `Map<number, number>` — signed distance per **on-curve** point index
    - `workingPoints`: array of the same length, mutated in place
    - `options.round`: defaults to `Math.round`
    - `options.normalAt`: `(pointIndex) => {x, y}`, defaults to the generic normal
    - returns `true` when anything moved

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-offset-contour.js`:

```js
import { offsetContourAlongNormals } from "@fontra/core/offset-contour.js";

// A quarter-circle cubic of radius 100 about the origin, in the same form the
// skeleton fixtures use. kappa = 0.5522847498 is the standard circular constant.
const K = 0.5522847498307936;
const makeArc = () => [
  onCurve(100, 0),
  control(100, 100 * K),
  control(100 * K, 100),
  onCurve(0, 100),
];

const midRadius = (points) => {
  // The cubic's own midpoint, by de Casteljau at t = 0.5: (p0 + 3p1 + 3p2 + p3)/8.
  const [p0, p1, p2, p3] = points;
  const x = (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8;
  const y = (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8;
  return Math.hypot(x, y);
};

describe("offsetContourAlongNormals", () => {
  it("offsets a curved segment instead of shearing its handles", () => {
    const points = makeArc();
    const working = structuredClone(points);
    const radiusBefore = midRadius(points);

    const changed = offsetContourAlongNormals(
      points,
      false,
      new Map([
        [0, 20],
        [3, 20],
      ]),
      working
    );

    expect(changed).to.equal(true);
    expect(working[0]).to.include({ x: 120, y: 0 });
    expect(working[3]).to.include({ x: 0, y: 120 });
    // The middle of the arc has to travel the same 20 units as its ends.
    // Displacing the handles by an interpolation of the two endpoint deltas
    // leaves it about 6 units short, because that can never lengthen a handle.
    expect(midRadius(working) - radiusBefore).to.be.closeTo(20, 0.6);
  });

  it("tapers a segment when only one of its ends is offset", () => {
    const points = makeArc();
    const working = structuredClone(points);

    offsetContourAlongNormals(points, false, new Map([[0, 20]]), working);

    expect(working[0]).to.include({ x: 120, y: 0 });
    expect(working[3]).to.include({ x: 0, y: 100 });
  });

  it("offsets a straight segment into a parallel straight", () => {
    const points = [onCurve(0, 0), onCurve(100, 0)];
    const working = structuredClone(points);

    offsetContourAlongNormals(
      points,
      false,
      new Map([
        [0, 10],
        [1, 10],
      ]),
      working
    );

    expect(working[0]).to.include({ x: 0, y: -10 });
    expect(working[1]).to.include({ x: 100, y: -10 });
  });

  it("uses a caller-supplied normal when one is given", () => {
    const points = [onCurve(0, 0), onCurve(100, 0)];
    const working = structuredClone(points);

    offsetContourAlongNormals(points, false, new Map([[0, 10]]), working, {
      normalAt: () => ({ x: 1, y: 0 }),
    });

    expect(working[0]).to.include({ x: 10, y: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-contour.js`
Expected: FAIL — `offsetContourAlongNormals is not a function`.

- [ ] **Step 3: Move the construction into `offset-contour.js`**

Move out of `skeleton-model.js` (delete there): `offsetControlPointsWithFixedRibSegments`, `offsetFixedRibSegmentHandles`, `interpolateFixedRibSegmentHandles`, `getControlPointIndicesBetween`, `interpolateDelta`. Rename the first three to `offsetSegmentHandles`, `rebuildSegmentHandles`, `carrySegmentHandles`; keep every comment. They currently take `(points, workingContour, …)` and read `workingContour.points` — change them to take `workingPoints` directly.

Add the entry point:

```js
/**
 * Move each listed on-curve along its own normal and rebuild the handles of every
 * segment that has an end moving, so each affected segment stays an offset of
 * itself — a constant-distance one where both ends move, a tapered one where one
 * does. Handle directions are preserved and their lengths scale by 1 + d·kappa,
 * the generator's own construction.
 * @param {Array} points - Original points, read-only
 * @param {boolean} closed - Whether the contour is closed
 * @param {Map} offsetsByIndex - Point index -> signed distance along its normal
 * @param {Array} workingPoints - Points to mutate, same length as `points`
 * @param {Object} options - `round`, and `normalAt` to override the normal
 * @returns {boolean} Whether anything moved
 */
export function offsetContourAlongNormals(
  points,
  closed,
  offsetsByIndex,
  workingPoints,
  { round = Math.round, normalAt = null } = {}
) {
  const pointDeltas = new Map();
  const pointOffsets = new Map();
  let changed = false;
  for (const [pointIndex, offset] of offsetsByIndex) {
    const original = points[pointIndex];
    const working = workingPoints?.[pointIndex];
    if (!original || !working || original.type) continue;
    const normal = normalAt
      ? normalAt(pointIndex)
      : calculateContourNormalAtPoint(points, closed, pointIndex);
    const delta = { x: normal.x * offset, y: normal.y * offset };
    pointDeltas.set(pointIndex, delta);
    pointOffsets.set(pointIndex, offset);
    working.x = round(original.x + delta.x);
    working.y = round(original.y + delta.y);
    changed = true;
  }
  if (pointDeltas.size) {
    offsetSegmentHandles(points, closed, workingPoints, pointDeltas, pointOffsets, round);
  }
  return changed;
}
```

`offsetSegmentHandles` is the moved `offsetControlPointsWithFixedRibSegments` with `originalContour`/`workingContour` replaced by `(points, closed, workingPoints)`.

- [ ] **Step 4: Rewire `applyFixedRibDelta`**

Inside its per-contour loop, replace the inline move-and-scale with a two-pass shape: build the offsets map first, then call the shared construction once. The width write stays exactly where it is, and the normal override is passed through so `forceHorizontal` / `forceVertical` points keep behaving as they do today:

```js
const offsetsByIndex = new Map();
for (const pointId of affected) {
  const originalPointIndex = originalContour.points.findIndex(
    (point) => point.id === pointId
  );
  const originalPoint = originalContour.points[originalPointIndex];
  const workingPoint = workingContour.points?.[originalPointIndex];
  if (!originalPoint || !workingPoint || originalPoint.type) continue;
  // Each point travels only as far as its own rib can pay for. A point at the
  // floor stops narrowing AND stops moving - otherwise the drag carries on and
  // the edge that width was pinning walks away with it. Its neighbours are
  // unaffected and keep going until they reach the floor too, at which point
  // the drag has nothing left to move and stands still.
  const allowedDelta = allowed.has(pointId) ? allowed.get(pointId) : projectedDelta;
  // On a single-sided contour the skeleton IS one edge of the stroke, so it has
  // to hold still: the drag moves the other edge, which is the sum of the two
  // half-widths, and nothing else.
  if (!singleSided) {
    offsetsByIndex.set(originalPointIndex, allowedDelta);
  }
  applyFixedRibWidthDelta(
    workingPoint,
    originalPoint,
    originalContour.defaultWidth,
    anchorSide,
    allowedDelta,
    round,
    singleSided
  );
  changed = true;
}
if (offsetsByIndex.size) {
  offsetContourAlongNormals(
    originalContour.points,
    originalContour.closed,
    offsetsByIndex,
    workingContour.points,
    {
      round,
      rebuildHandles: scaleControlPoints,
      normalAt: (pointIndex) =>
        calculateNormalAtSkeletonPoint(originalContour, pointIndex),
    }
  );
}
```

`scaleControlPoints: false` is an existing option of `applyFixedRibDelta` and must keep working, so `offsetContourAlongNormals` takes a third option for it. Its signature line in Step 3 becomes:

```js
  { round = Math.round, normalAt = null, rebuildHandles = true } = {}
```

and its handle pass is guarded accordingly:

```js
  if (rebuildHandles && pointDeltas.size) {
    offsetSegmentHandles(points, closed, workingPoints, pointDeltas, pointOffsets, round);
  }
```

- [ ] **Step 5: Run the new tests**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-contour.js`
Expected: PASS, 8 passing.

- [ ] **Step 6: Run the full suite**

Run: `cd src-js/fontra-core && npm test`
Expected: **1573 passing**. No existing test edited. In particular `test-skeleton-modifiers.js`'s "fixed-rib drag geometry" block — including the floor and past-the-floor idempotence assertions — must pass untouched.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-contour.js src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-offset-contour.js
git add src-js/fontra-core/src/offset-contour.js src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-offset-contour.js
git commit -m "refactor: move the offset construction beside the geometry it uses

One copy of the on-curve travel and the handle rebuild, with the widths, the
per-point floor and the rib-angle override left on the skeleton's side of it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The base-curve drag's offset map

Everything a base drag needs to turn a cursor delta into an offsets map: expand the selection through coupled groups, project the delta onto the clicked point's normal, give every affected point that same distance. No floor — see Global Constraints and spec §5.

**Files:**
- Modify: `src-js/fontra-core/src/offset-contour.js`
- Modify: `src-js/fontra-core/tests/test-offset-contour.js`

**Interfaces:**
- Consumes: `buildContourSegments`, `collectCoupledPointGroups`, `calculateContourNormalAtPoint` from Task 1.
- Produces:
  - `expandIndicesToCoupledGroups(points, closed, pointIndices) -> Set<number>`
  - `computeContourExpandOffsets(points, closed, selectedIndices, clickedIndex, delta) -> Map<number, number>` — empty map when the clicked point is not a usable on-curve

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-offset-contour.js`:

```js
import {
  computeContourExpandOffsets,
  expandIndicesToCoupledGroups,
} from "@fontra/core/offset-contour.js";

describe("base-curve expansion offsets", () => {
  // Point 1 is smooth with a single handle, so the straight 0-1 owns its
  // direction and both its ends must travel. Point 4 is free.
  const makeTensionContour = () => [
    onCurve(0, 0),
    onCurve(100, 0, true),
    control(150, 0),
    control(200, 50),
    onCurve(200, 100),
  ];

  it("carries a tension point's whole straight, not just the dragged end", () => {
    const points = makeTensionContour();
    expect([...expandIndicesToCoupledGroups(points, false, new Set([0]))]).to.have.members(
      [0, 1]
    );
    expect([...expandIndicesToCoupledGroups(points, false, new Set([1]))]).to.have.members(
      [0, 1]
    );
  });

  it("leaves a plain straight between two corners free to taper", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    expect([...expandIndicesToCoupledGroups(points, false, new Set([0]))]).to.have.members(
      [0]
    );
  });

  it("chains coupling through a shared point", () => {
    // The straights 0-2 and 2-3 each carry a one-handled smooth point, and they
    // share point 2 — which has one position and cannot sit at two offsets, so
    // all three on-curves travel as one.
    const chained = [
      onCurve(0, 100),
      control(0, 50),
      onCurve(0, 0, true),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    expect(
      [...expandIndicesToCoupledGroups(chained, false, new Set([0]))].sort()
    ).to.deep.equal([0, 2, 3]);
  });

  it("gives every affected point the drag projected on the clicked normal", () => {
    const points = makeTensionContour();
    // The clicked point's normal is (0, -1): straight 0-1 runs along +x. A drag
    // of (5, -20) projects to 20 units of outward travel.
    const offsets = computeContourExpandOffsets(points, false, new Set([0]), 0, {
      x: 5,
      y: -20,
    });
    expect([...offsets.keys()].sort()).to.deep.equal([0, 1]);
    expect(offsets.get(0)).to.be.closeTo(20, 1e-9);
    expect(offsets.get(1)).to.be.closeTo(20, 1e-9);
  });

  it("does not clamp an inward drag past the curvature radius", () => {
    // A quarter arc of radius 100 pushed 250 units inward. There is no width to
    // run out of on a base curve, so the drag simply follows the cursor and the
    // result cusps - ordinary outline geometry, reachable by hand and undoable.
    const points = makeArc();
    const offsets = computeContourExpandOffsets(
      points,
      false,
      new Set([0, 3]),
      0,
      { x: -250, y: 0 }
    );
    expect(offsets.get(0)).to.be.closeTo(-250, 1e-9);
    expect(offsets.get(3)).to.be.closeTo(-250, 1e-9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-contour.js`
Expected: FAIL — `expandIndicesToCoupledGroups is not a function`.

- [ ] **Step 3: Implement both functions**

Append to `src-js/fontra-core/src/offset-contour.js`:

```js
/**
 * Grow a set of on-curve indices to include every point coupled to one of them.
 * A segment carrying a tension point — a smooth on-curve with a single handle —
 * has no direction of its own, so moving one of its ends alone would rotate it
 * rather than offset it. Groups sharing a point merge, so the coupling chains.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {Set} pointIndices - Selected on-curve indices
 * @returns {Set} The expanded index set
 */
export function expandIndicesToCoupledGroups(points, closed, pointIndices) {
  const groupByPoint = collectCoupledPointGroups(
    buildContourSegments(points, closed),
    closed
  );
  const expanded = new Set(pointIndices);
  if (!groupByPoint.size) return expanded;
  for (const pointIndex of pointIndices) {
    for (const member of groupByPoint.get(points[pointIndex]) || []) {
      const memberIndex = points.indexOf(member);
      if (memberIndex >= 0) expanded.add(memberIndex);
    }
  }
  return expanded;
}

/**
 * The signed distance each affected on-curve travels for one frame of a base
 * expansion drag: the cursor's travel projected onto the clicked point's normal,
 * given to every point in the expanded selection.
 *
 * There is no floor. A base curve has no width to run out of, so an inward drag
 * follows the cursor as far as it is pushed and cusps where the offset distance
 * passes the local radius — ordinary outline geometry, and undoable.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {Set} selectedIndices - Selected on-curve indices in this contour
 * @param {number} clickedIndex - Index of the point under the cursor, or -1
 * @param {Object} delta - Cursor travel {x, y} since mousedown
 * @returns {Map} Point index -> signed distance
 */
export function computeContourExpandOffsets(
  points,
  closed,
  selectedIndices,
  clickedIndex,
  delta
) {
  const offsets = new Map();
  const clicked = points?.[clickedIndex];
  if (!clicked || clicked.type || !selectedIndices?.size) return offsets;
  const normal = calculateContourNormalAtPoint(points, closed, clickedIndex);
  if (!(Math.hypot(normal.x, normal.y) > 1e-6)) return offsets;
  const projected = delta.x * normal.x + delta.y * normal.y;
  for (const pointIndex of expandIndicesToCoupledGroups(points, closed, selectedIndices)) {
    if (points[pointIndex] && !points[pointIndex].type) {
      offsets.set(pointIndex, projected);
    }
  }
  return offsets;
}
```

- [ ] **Step 4: Run the new tests**

Run: `cd src-js/fontra-core && npx mocha tests/test-offset-contour.js`
Expected: PASS, 13 passing.

- [ ] **Step 5: Run the full suite**

Run: `cd src-js/fontra-core && npm test`
Expected: **1578 passing**.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-contour.js src-js/fontra-core/tests/test-offset-contour.js
git add src-js/fontra-core/src/offset-contour.js src-js/fontra-core/tests/test-offset-contour.js
git commit -m "feat: offsets map for the base-curve expansion drag

Coupled-group expansion, the drag projected on the clicked point's normal, and
no floor - a base curve has no width to run out of.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The behavior name and the path target entry

The editor half. A new behavior name, a behavior type whose point rules move nothing, and a target entry that writes the offset onto the layer's path.

**Files:**
- Create: `src-js/views-editor/src/base-expand-editing.js`
- Modify: `src-js/views-editor/src/edit-behavior.js:1406` (the `behaviorTypes` table)

**Interfaces:**
- Consumes: `computeContourExpandOffsets`, `offsetContourAlongNormals` from Tasks 2–3.
- Produces:
  - `BASE_EXPAND_BEHAVIOR_NAME` — the string `"base-expand"`
  - `getBaseExpandBehaviorName(modifiers, targetKinds, selection) -> "base-expand" | null`
  - `createBaseExpandTargetEntries(layerGlyph, selection, clickedPointIndex, { isGeneratedContour }) -> Array<targetEntry>`

- [ ] **Step 1: Add the behavior type**

In `src-js/views-editor/src/edit-behavior.js`, in the `behaviorTypes` table, after the `"fixed-rib-compress"` entry:

```js
  // The base expansion drag moves nothing through the point rules: the whole
  // edit is the offset construction, which runs in the target entry. An empty
  // match tree matches no point, so no edit func is built and the path change
  // comes entirely from the entry (R-E - the kind decision is at construction).
  "base-expand": {
    matchTree: buildPointMatchTree([]),
    actions: actionFactories,
  },
```

- [ ] **Step 2: Write the module**

Create `src-js/views-editor/src/base-expand-editing.js`:

```js
import {
  computeContourExpandOffsets,
  offsetContourAlongNormals,
} from "@fontra/core/offset-contour.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import { parseSelection } from "@fontra/core/utils.ts";

export const BASE_EXPAND_BEHAVIOR_NAME = "base-expand";

/**
 * The expansion keys drive the skeleton version wherever a skeleton point is in
 * the selection; only a selection with none of them reaches this one. Both keys
 * do the same thing here, exactly as they do on a single-sided stroke, where the
 * anchored edge is decided by the contour rather than by which key is held: the
 * drag direction alone decides whether the shape grows or shrinks.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Set} selection - The current selection
 * @returns {string|null} The behavior name, or null
 */
export function getBaseExpandBehaviorName(modifiers, targetKinds, selection) {
  if (!modifiers?.fixedRibMode && !modifiers?.fixedRibCompressMode) return null;
  if (targetKinds?.has("skeletonPoint")) return null;
  const { point: pointSelection } = parseSelection(selection || new Set());
  return pointSelection?.length ? BASE_EXPAND_BEHAVIOR_NAME : null;
}

/**
 * Group the selected path point indices by contour, dropping generated contours
 * and any point that is not an on-curve.
 */
function collectSelectedOnCurvesByContour(path, pointIndices, isGeneratedContour) {
  const byContour = new Map();
  for (const pointIndex of pointIndices) {
    const point = path.getPoint(pointIndex);
    if (!point || point.type) continue;
    const [contourIndex] = path.getContourAndPointIndex(pointIndex);
    if (isGeneratedContour?.(contourIndex)) continue;
    let indices = byContour.get(contourIndex);
    if (!indices) {
      indices = new Set();
      byContour.set(contourIndex, indices);
    }
    indices.add(pointIndex);
  }
  return byContour;
}

/**
 * One target entry for the whole path. It captures the pre-drag geometry once at
 * construction and recomputes absolute positions from it every frame, so the
 * shape cannot creep and a drag back to zero restores the original exactly.
 * @param {Object} layerGlyph - The layer glyph being edited
 * @param {Set} selection - The current selection
 * @param {number} clickedPointIndex - Absolute index of the point under the cursor
 * @param {Object} options - `isGeneratedContour(contourIndex) => boolean`
 * @returns {Array} Zero or one target entry
 */
export function createBaseExpandTargetEntries(
  layerGlyph,
  selection,
  clickedPointIndex,
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];
  const path = layerGlyph.path;
  const byContour = collectSelectedOnCurvesByContour(
    path,
    pointSelection,
    isGeneratedContour
  );
  if (!byContour.size) return [];

  // The clicked point owns the projection axis for the whole drag. When the
  // gesture started somewhere without one - a marquee selection dragged from
  // empty space - the first selected on-curve stands in, so the axis is still a
  // point on the geometry rather than the cursor's own direction.
  const clickedIsUsable =
    byContour.size > 0 &&
    [...byContour.values()].some((indices) => indices.has(clickedPointIndex));
  const axisPointIndex = clickedIsUsable
    ? clickedPointIndex
    : [...byContour.values()][0].values().next().value;
  const [axisContourIndex] = path.getContourAndPointIndex(axisPointIndex);
  const axisContour = path.getUnpackedContour(axisContourIndex);
  const axisContourStart = path.getAbsolutePointIndex(axisContourIndex, 0);

  // Captured once: every frame is measured from here, never accumulated.
  const originals = new Map();
  for (const contourIndex of byContour.keys()) {
    originals.set(contourIndex, {
      contour: path.getUnpackedContour(contourIndex),
      startIndex: path.getAbsolutePointIndex(contourIndex, 0),
    });
  }

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const changes = recordChanges(layerGlyph, (layerGlyphProxy) => {
          for (const [contourIndex, selectedAbsolute] of byContour) {
            const { contour, startIndex } = originals.get(contourIndex);
            const selectedIndices = new Set(
              [...selectedAbsolute].map((absolute) => absolute - startIndex)
            );
            const clickedIndex =
              contourIndex === axisContourIndex
                ? axisPointIndex - axisContourStart
                : -1;
            // The axis is one point's normal for the whole drag, so a contour
            // that does not contain it borrows the projected distance rather
            // than re-projecting on a normal of its own - otherwise two
            // contours in one selection would travel different distances.
            const offsets =
              clickedIndex >= 0
                ? computeContourExpandOffsets(
                    contour.points,
                    contour.isClosed,
                    selectedIndices,
                    clickedIndex,
                    delta
                  )
                : borrowOffsets(contour, selectedIndices, axisContour, axisPointIndex - axisContourStart, delta);
            if (!offsets.size) continue;
            const workingPoints = structuredClone(contour.points);
            if (
              !offsetContourAlongNormals(
                contour.points,
                contour.isClosed,
                offsets,
                workingPoints
              )
            ) {
              continue;
            }
            for (let i = 0; i < workingPoints.length; i++) {
              const before = contour.points[i];
              const after = workingPoints[i];
              if (after.x === before.x && after.y === before.y) continue;
              layerGlyphProxy.path.setPointPosition(startIndex + i, after.x, after.y);
            }
          }
        });
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}

/**
 * The same offsets for a contour that does not hold the axis point: expand its
 * own coupled groups, but take the distance from the axis contour's projection.
 */
function borrowOffsets(contour, selectedIndices, axisContour, axisIndex, delta) {
  const axisOffsets = computeContourExpandOffsets(
    axisContour.points,
    axisContour.isClosed,
    new Set([axisIndex]),
    axisIndex,
    delta
  );
  const distance = axisOffsets.get(axisIndex);
  if (distance === undefined) return new Map();
  const own = computeContourExpandOffsets(
    contour.points,
    contour.isClosed,
    selectedIndices,
    [...selectedIndices][0],
    { x: 0, y: 0 }
  );
  for (const key of own.keys()) own.set(key, distance);
  return own;
}
```

- [ ] **Step 3: Syntax-check and format**

Run:
```bash
node --check src-js/views-editor/src/base-expand-editing.js
node --check src-js/views-editor/src/edit-behavior.js
npx prettier --write src-js/views-editor/src/base-expand-editing.js src-js/views-editor/src/edit-behavior.js
```
Expected: no output from `node --check`; prettier rewrites both files.

- [ ] **Step 4: Verify the empty match tree moves nothing**

Run: `cd src-js/fontra-core && npm test`
Expected: **1578 passing** — unchanged. This step is a regression check on the `edit-behavior.js` edit, not a test of the new module (`views-editor` has no harness, R-G).

- [ ] **Step 5: Commit**

```bash
git add src-js/views-editor/src/base-expand-editing.js src-js/views-editor/src/edit-behavior.js
git commit -m "feat: base expansion behavior name and path target entry

The rules move nothing; the offset construction runs in the entry, measured
from the geometry captured at mousedown so the shape cannot creep.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Pointer dispatch

Wire the behavior name and the target entry into the existing drag loop, so the key can be pressed or released mid-drag and the behavior switches with it — the same as the skeleton version.

**Files:**
- Modify: `src-js/views-editor/src/edit-tools-pointer.js:743-749` (behavior-name resolution), `:766-821` (target entries)

**Interfaces:**
- Consumes: `getBaseExpandBehaviorName`, `createBaseExpandTargetEntries`, `BASE_EXPAND_BEHAVIOR_NAME` from Task 4.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the import**

Near the other editor imports in `edit-tools-pointer.js`:

```js
import {
  BASE_EXPAND_BEHAVIOR_NAME,
  createBaseExpandTargetEntries,
  getBaseExpandBehaviorName,
} from "./base-expand-editing.js";
```

- [ ] **Step 2: Extend the behavior-name resolution**

Replace the body of `getSelectionBehaviorName` (currently at `:743`) with:

```js
      const getSelectionBehaviorName = (event) =>
        getSkeletonModifierBehaviorName(event, getRealtimeModifiers(), targetKinds) ||
        getBaseExpandBehaviorName(
          getRealtimeModifiers(),
          targetKinds,
          sceneController.selection
        ) ||
        (hasRibLikeSelection(sceneController.selection)
          ? getSkeletonRibBehaviorName(event, getRealtimeModifiers())
          : hasEditableGeneratedHandleSelection(sceneController.selection)
            ? getGeneratedHandleBehaviorName(event, getRealtimeModifiers())
            : getBehaviorName(event));
```

The skeleton resolver runs first, so a mixed selection keeps today's behavior and the outline points sit still (spec §2).

- [ ] **Step 3: Produce the target entry**

At the top of `makeSkeletonTargetEntries` (currently `:766`), before the `modifierOptions` construction:

```js
      const makeSkeletonTargetEntries = (layerGlyph, name) => {
        if (name === BASE_EXPAND_BEHAVIOR_NAME) {
          return createBaseExpandTargetEntries(
            layerGlyph,
            sceneController.selection,
            sceneController.sceneModel.initialClickedPointIndex,
            {
              isGeneratedContour: (contourIndex) =>
                this.sceneModel.isGeneratedPathContour(contourIndex),
            }
          );
        }
        const modifierOptions = makeSkeletonModifierOptions(name, {
```

Nothing else in the loop changes: the existing mid-drag rebuild at `:851-878` already rolls back and rebuilds the factory whenever the behavior name changes, which is exactly what a key pressed or released mid-drag needs.

- [ ] **Step 4: Syntax-check and format**

Run:
```bash
node --check src-js/views-editor/src/edit-tools-pointer.js
npx prettier --write src-js/views-editor/src/edit-tools-pointer.js
```
Expected: no output from `node --check`.

- [ ] **Step 5: Manual check in the editor**

The user has a bundle watcher running. Ask them to confirm, on a glyph with an ordinary outline and no skeleton:

1. Select two on-curves of a curved segment, hold D, drag — the segment offsets and the curve's middle keeps up with its ends.
2. Hold S instead — identical result.
3. Drag the other way — the shape shrinks.
4. Select one end only — the segment tapers.
5. Press and release D mid-drag — the drag switches between offsetting and ordinary translation, with no jump.

- [ ] **Step 6: Commit**

```bash
git add src-js/views-editor/src/edit-tools-pointer.js
git commit -m "feat: dispatch the base expansion drag from the pointer

Resolved after the skeleton behaviors, so a mixed selection is unaffected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The ghost of the pre-drag shape

A base curve has no centerline to measure the offset against, so the shape as it stood at mousedown is drawn underneath for the length of the gesture.

**Files:**
- Modify: `src-js/views-editor/src/edit-tools-pointer.js` (publish and clear the snapshot)
- Modify: `src-js/views-editor/src/visualization-layer-definitions.js` (the layer)

**Interfaces:**
- Consumes: `BASE_EXPAND_BEHAVIOR_NAME` from Task 4.
- Produces: `sceneModel.baseExpandGhostPath` — a `VarPackedPath` in glyph space, or `undefined`.

- [ ] **Step 1: Publish the snapshot**

In `handleDragSelection`, immediately after `let behaviorName = getSelectionBehaviorName(initialEvent);` and the line that publishes `skeletonDragBehaviorName`:

```js
      // A base curve has no centerline to read the offset against, so the shape
      // as it stood at mousedown is drawn underneath for the length of the drag.
      // Captured from the edit layer only - the ghost is a reading aid, not
      // geometry, and there is one cursor.
      const publishGhost = (name) => {
        sceneController.sceneModel.baseExpandGhostPath =
          name === BASE_EXPAND_BEHAVIOR_NAME
            ? layerInfo[0]?.layerGlyph?.path?.copy()
            : undefined;
      };
```

Call `publishGhost(behaviorName)` immediately after `layerInfo[0].isPrimaryLayer = true;` (so `layerInfo` exists), and again inside the mid-drag rebuild block, after `layer.editBehavior = layer.behaviorFactory.getBehavior(behaviorName);` closes its loop — i.e. right before `await sendIncrementalChange(consolidateChanges(rollbackChanges));`. At that point the rollback has already been applied to `layer.layerGlyph`, so the snapshot is the pre-drag shape.

- [ ] **Step 2: Clear it when the drag ends**

Beside the existing `delete this.sceneController.sceneModel.skeletonDragBehaviorName;` at `:560`:

```js
      delete this.sceneController.sceneModel.baseExpandGhostPath;
```

- [ ] **Step 3: Add the layer**

In `src-js/views-editor/src/visualization-layer-definitions.js`, beside the other registration-only definitions:

```js
registerVisualizationLayerDefinition({
  identifier: "fontra.base-expand.ghost",
  name: "Base expansion ghost",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: false,
  defaultOn: true,
  zIndex: 440,
  screenParameters: {
    lineWidth: 1,
  },
  colors: {
    strokeColor: "rgba(120, 120, 120, 0.55)",
  },
  colorsDarkMode: {
    strokeColor: "rgba(190, 190, 190, 0.5)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const ghostPath = model.baseExpandGhostPath;
    if (!ghostPath) {
      return;
    }
    context.lineWidth = parameters.lineWidth;
    context.strokeStyle = parameters.strokeColor;
    const path2d = new Path2D();
    ghostPath.drawToPath2d(path2d);
    context.stroke(path2d);
  },
});
```

`userSwitchable: false` deliberately: it is visible only during a drag and there is nothing to switch off between drags. `zIndex: 440` puts it under the skeleton's width shading (446) and so under the live outline.

- [ ] **Step 4: Syntax-check and format**

Run:
```bash
node --check src-js/views-editor/src/edit-tools-pointer.js
node --check src-js/views-editor/src/visualization-layer-definitions.js
npx prettier --write src-js/views-editor/src/edit-tools-pointer.js src-js/views-editor/src/visualization-layer-definitions.js
```
Expected: no output from `node --check`.

`drawToPath2d(path2d)` is `VarPackedPath`'s own draw method (`var-path.js:780`); the other layers in this file stroke pre-built `Path2D` objects hanging off the glyph controller, which the ghost has no equivalent of because it is a raw snapshot.

- [ ] **Step 5: Manual check**

Ask the user to confirm: holding D and dragging an ordinary outline point shows a faint copy of the pre-drag shape underneath; it disappears on release with no jump; pressing D mid-drag makes it appear at the pre-drag shape, not at the current one; releasing D mid-drag makes it disappear.

- [ ] **Step 6: Commit**

```bash
git add src-js/views-editor/src/edit-tools-pointer.js src-js/views-editor/src/visualization-layer-definitions.js
git commit -m "feat: ghost the pre-drag shape during a base expansion

The reference a base curve has no centerline to provide.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The offset-distance readout

**Files:**
- Modify: `src-js/views-editor/src/scene-model.js:1050-1063` (`getDragReadouts`), plus a new private method beside `_getRibDragReadout` at `:1105`

**Interfaces:**
- Consumes: `BASE_EXPAND_BEHAVIOR_NAME` from Task 4, `baseExpandGhostPath` from Task 6.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the readout method**

In `scene-model.js`, beside `_getRibDragReadout`:

```js
  // How far the base expansion drag has travelled, beside the point under the
  // cursor. Measured against the ghost rather than against the drag's own delta,
  // so it reports what the geometry actually did - the same rule the other
  // readouts follow (re-read from live geometry, not captured at mousedown).
  _getBaseExpandDragReadout(positionedGlyph) {
    if (this.skeletonDragBehaviorName !== BASE_EXPAND_BEHAVIOR_NAME) {
      return null;
    }
    const ghostPath = this.baseExpandGhostPath;
    const pointIndex = this.initialClickedPointIndex;
    const path = positionedGlyph?.glyph?.path;
    if (!ghostPath || !path || pointIndex === undefined) {
      return null;
    }
    const before = ghostPath.getPoint(pointIndex);
    const after = path.getPoint(pointIndex);
    if (!before || !after) {
      return null;
    }
    return {
      x: after.x,
      y: after.y,
      kind: "skeleton",
      label: Math.hypot(after.x - before.x, after.y - before.y).toFixed(1),
    };
  }
```

Add the import at the top of the file:

```js
import { BASE_EXPAND_BEHAVIOR_NAME } from "./base-expand-editing.js";
```

- [ ] **Step 2: Consult it from `getDragReadouts`**

Insert before the rib readout, so a base drag never falls through to the Tunni readouts:

```js
    const baseExpandReadout = this._getBaseExpandDragReadout(positionedGlyph);
    if (baseExpandReadout) {
      return [baseExpandReadout];
    }
```

- [ ] **Step 3: Syntax-check and format**

Run:
```bash
node --check src-js/views-editor/src/scene-model.js
npx prettier --write src-js/views-editor/src/scene-model.js
```
Expected: no output from `node --check`.

- [ ] **Step 4: Manual check**

Ask the user to confirm the number beside the dragged point counts up as the shape grows, counts up again as it shrinks the other way (it is a distance), reads 0 at the start, and disappears on release.

- [ ] **Step 5: Commit**

```bash
git add src-js/views-editor/src/scene-model.js
git commit -m "feat: report the offset distance during a base expansion drag

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Manual test matrix and documentation

`views-editor` has no harness (R-G), so the interaction's evidence is a written matrix that someone actually runs.

**Files:**
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md` (append a numbered entry)
- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` (§1 inventory, §3 file maps, §4 shared-file index)
- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md` (§3.0, noting the coupling collector is now shared)

- [ ] **Step 1: Run the matrix and record the result**

On a glyph with an ordinary outline and no skeleton, and a second glyph that has both:

| # | Check | Expected |
| --- | --- | --- |
| 1 | D-drag two on-curves of a curve segment outward | Segment offsets; the curve's middle keeps up with its ends |
| 2 | S-drag the same | Identical to #1 |
| 3 | Drag the other way | Shape shrinks |
| 4 | One end of a curve segment selected | Segment tapers |
| 5 | One end of a straight carrying a one-handled smooth point | Both ends travel; the straight stays straight |
| 6 | One end of a plain straight between two corners | Tapers into a slanted straight |
| 7 | Two coupled straights sharing a point, one end selected | All three points travel |
| 8 | Whole closed contour selected | Offsets uniformly |
| 9 | Drag far inward past a tight curve's radius | Cusps, then loops; no clamp; undo restores in one step |
| 10 | Mixed selection with skeleton points | Skeleton drag runs; outline points sit still |
| 11 | Selection containing generated contour points | Generated contour untouched |
| 12 | Drag started on a handle | No expansion; ordinary handle drag |
| 13 | Press D mid-drag, then release it | Switches both ways, no jump; ghost appears and disappears with it |
| 14 | Ghost through a whole gesture | Faint pre-drag shape underneath; gone on release with no jump |
| 15 | Readout | Reads 0 at start, counts up in both directions, gone on release |
| 16 | Drag back to the start position | Geometry identical to before the drag |
| 17 | Undo after a completed drag | One step back to the original |

- [ ] **Step 2: Write the development-log entry**

Append a new numbered section to `docs/superpowers/DEVELOPMENT-LOG.md` in the existing format: **1. Problem**, **2. Solution**, **3. Commits** (a table of the commits from Tasks 1–7), **4. Challenges and findings**. Record what the matrix actually showed, including anything that failed and had to be fixed. Do not write it before running the matrix.

- [ ] **Step 3: Update the architecture map**

- §1 inventory: add a row for the base-curve expansion, or fold it into F8 if that reads better against the table as it stands.
- §3: add `offset-contour.js` and `base-expand-editing.js` with their line counts from `git diff --numstat upstream/main...HEAD`.
- §4 shared-file reverse index: `edit-tools-pointer.js`, `scene-model.js`, `edit-behavior.js` and `visualization-layer-definitions.js` all gain a hunk — add the feature to each row.

- [ ] **Step 4: Update the feature model**

In `SKELETON-FEATURE-MODEL.md` §3.0, note that `collectTiedRibGroups` is now a thin wrapper over the shared collector and that the rib opt-out is what the wrapper adds. Keep the existing prose about why the coupling exists — it is unchanged and still the reason.

- [ ] **Step 5: Commit**

```bash
npx prettier --write docs/superpowers/DEVELOPMENT-LOG.md docs/superpowers/FEATURE-ARCHITECTURE-MAP.md docs/superpowers/SKELETON-FEATURE-MODEL.md
git add docs/superpowers
git commit -m "docs: log the base-curve expansion drag and its test matrix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-07-29-base-curve-expansion-design.md`:

| Spec section | Covered by |
| --- | --- |
| §2 gesture, both keys, projection | Tasks 3, 4, 5 |
| §2 gate on no skeleton points | Task 4 step 2, Task 5 step 2 |
| §2 generated contours excluded | Task 4 (`isGeneratedContour`), Task 5 step 3 |
| §2 on-curve only | Task 3 (`computeContourExpandOffsets` returns empty for an off-curve) |
| §3 normal travel, taper, handle scaling, fallback | Task 2 |
| §4 tension-point coupling, chaining, no new field | Tasks 1, 3 |
| §5 no limits | Task 3 (explicit test) |
| §6 live offset, ghost, no jump, readout | Tasks 5, 6, 7 |
| §7 one shared construction, placement | Tasks 1, 2, and the file table above |
| §8 TDD in core, manual matrix in the editor | Tasks 1–3 are test-first; Task 8 is the matrix |
| §9 out of scope | No task changes skeleton behavior; the wrappers preserve every signature |

Two judgement calls the implementer should know are calls, not oversights:

- **Multi-contour selections** need one projection axis or the two contours travel different distances. The clicked point owns it, and other contours borrow the distance (Task 4, `borrowOffsets`). The spec does not name this case.
- **A drag with no clicked point** (marquee selection dragged from empty space) falls back to the first selected on-curve for the axis, rather than refusing to run.
