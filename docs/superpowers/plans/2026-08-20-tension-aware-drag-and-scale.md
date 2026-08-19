# Tension-aware drag and scale — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. This project forbids subagents and worktrees, so subagent-driven development
> does not apply here. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold **X** while dragging or scaling, and every curved segment the edit reaches keeps its
drawn shape instead of going slack or pinching.

**Architecture:** One pure core module holds the geometry and takes mocha tests. One editor module
holds the target entry, in the shape base-curve expansion already uses. The drag keeps the ordinary
match tree and corrects after it. The scale runs an empty match tree and writes everything from the
entry.

**Tech Stack:** JavaScript ES modules, mocha + chai in `fontra-core`, no harness in `views-editor`.

**Spec:** `docs/superpowers/specs/2026-08-19-tension-aware-drag-and-scale-design.md`

## Global Constraints

- **Rails.** Pure geometry in `fontra-core` with tests. Interaction in its own `views-editor`
  module. `edit-tools-pointer.js` stays a dispatcher (R-A). Import the Tunni point and the
  straight-controlled smooth point test rather than deriving them again (R-B). No kind branching in
  `makeChangeForDelta`; the entry decides (R-E).
- **Every commit runs three commands:** `node --check` on each touched editor file, then
  `npx prettier --write` on every touched file, then `npm run bundle` in `src-js`. The user runs
  bundle-watch, so report a compile error rather than chasing it.
- **Tests:** `cd src-js/fontra-core && npm test`. The suite must not lose a test.
- **`views-editor` has no harness (R-G).** Editor tasks carry a manual matrix instead.
- **Grid.** Every frame is computed from a copy of the path as it stood at mouse-down. Never from
  the frame before it.
- **Generated contours are never touched.**
- **Commit after each task.** Stage with `git add .`.

---

### Task 1: The segment walk and the tension restore

Rules 1 and 2 of the spec. Pure geometry, no editor.

**Files:**
- Create: `src-js/fontra-core/src/tension-aware-edit.js`
- Test: `src-js/fontra-core/tests/test-tension-aware-edit.js`

**Interfaces:**
- Consumes: `calculateTunniPoint` from `tunni-calculations.js`, which is the one home of the
  tangent crossing (R-B); `addVectors`, `distance`, `dotVector`, `mulVectorScalar`,
  `normalizeVector`, `subVectors` from `vector.js`.
- Produces:
  - `buildIndexedSegments(points, closed) -> [{startIndex, endIndex, controlIndices}]`
  - `isCubicSegment(segment) -> boolean`
  - `segmentTensions(points, segment) -> {start, end} | null`
  - `restoreSegmentTensions(beforePoints, afterPoints, closed, {round}) -> boolean`

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-tension-aware-edit.js`:

```js
import {
  buildIndexedSegments,
  restoreSegmentTensions,
  segmentTensions,
} from "@fontra/core/tension-aware-edit.js";
import { expect } from "chai";

// Unpacked VarPackedPath points: on-curves carry no `type`, off-curves carry
// `type: "cubic"`.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });
const copy = (points) => points.map((point) => ({ ...point }));

// A quarter circle: up from (0, -100) with a vertical tangent, round to
// (100, 0) with a horizontal tangent. The two tangents cross at the origin, and
// both handles reach 0.5523 of the way to it.
const quarter = () => [
  onCurve(0, -100),
  control(0, -44.77),
  control(44.77, 0),
  onCurve(100, 0),
];

describe("tension-aware edit — segments and tensions", () => {
  it("walks an open contour into one segment per on-curve pair", () => {
    const segments = buildIndexedSegments(quarter(), false);
    expect(segments.length).to.equal(1);
    expect(segments[0]).to.deep.equal({
      startIndex: 0,
      endIndex: 3,
      controlIndices: [1, 2],
    });
  });

  it("closes the loop on a closed contour", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const segments = buildIndexedSegments(points, true);
    expect(segments.length).to.equal(3);
    expect(segments[2]).to.deep.equal({
      startIndex: 2,
      endIndex: 0,
      controlIndices: [],
    });
  });

  it("reads both handle tensions off the tangent crossing", () => {
    const points = quarter();
    const tensions = segmentTensions(points, buildIndexedSegments(points, false)[0]);
    expect(tensions.start).to.be.closeTo(0.5523, 0.001);
    expect(tensions.end).to.be.closeTo(0.5523, 0.001);
  });
});

describe("tension-aware edit — the restore", () => {
  it("stretches a quarter circle into a quarter ellipse", () => {
    const before = quarter();
    const after = copy(before);
    after[3] = onCurve(200, 0); // the right end dragged 100 units right
    restoreSegmentTensions(before, after, false);
    // The crossing does not move, because neither tangent turned. The vertical
    // leg is unchanged, so its handle keeps its length. The horizontal leg
    // doubles, so its handle doubles.
    expect(after[1].x).to.equal(0);
    expect(after[1].y).to.equal(-45);
    expect(after[2].x).to.equal(90);
    expect(after[2].y).to.equal(0);
  });

  it("leaves a segment alone when both ends take the same delta", () => {
    const before = quarter();
    const after = copy(before).map((point) => ({ ...point, x: point.x + 30 }));
    const changed = restoreSegmentTensions(before, after, false);
    expect(changed).to.equal(false);
    expect(after[1].y).to.equal(-44.77);
    expect(after[2].x).to.equal(74.77);
  });

  it("falls back to the chord ratio where the tangents are parallel", () => {
    // Both handles point straight up, so the tangent rays never cross.
    const before = [
      onCurve(0, 0),
      control(0, 40),
      control(100, 40),
      onCurve(100, 0),
    ];
    const after = copy(before);
    after[3] = onCurve(200, 0);
    restoreSegmentTensions(before, after, false);
    // Chord 100 -> 200, so each handle doubles along its own direction.
    expect(after[1].y).to.equal(80);
    expect(after[2].y).to.equal(80);
  });

  it("falls back where the crossing sits behind an end", () => {
    // The start handle points away from the segment, so the crossing is behind
    // the start point.
    const before = [
      onCurve(0, 0),
      control(-30, 0),
      control(70, 40),
      onCurve(100, 0),
    ];
    const after = copy(before);
    after[3] = onCurve(150, 0);
    restoreSegmentTensions(before, after, false);
    expect(after[1].x).to.equal(-45); // 30 * 1.5, along its own direction
  });

  it("leaves a segment whose two ends land on the same place", () => {
    const before = quarter();
    const after = copy(before);
    after[3] = onCurve(0, -100);
    const changed = restoreSegmentTensions(before, after, false);
    expect(changed).to.equal(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-tension-aware-edit.js`
Expected: FAIL, cannot resolve `@fontra/core/tension-aware-edit.js`.

- [ ] **Step 3: Write the module**

Create `src-js/fontra-core/src/tension-aware-edit.js`:

```js
import { calculateTunniPoint } from "./tunni-calculations.js";
import {
  addVectors,
  distance,
  dotVector,
  mulVectorScalar,
  normalizeVector,
  subVectors,
} from "./vector.js";

// Tension-aware editing, as pure geometry. Three rules: no handle turns, every
// handle keeps its tension, and a tension point slides along its straight. The
// editor supplies the path as it stood before the edit and the path as the
// ordinary rules left it; this module corrects the second one.

const EPSILON = 1e-9;

// Past this the crossing is so far away that a small input move swings the
// answer, so the chord is the steadier measure. Stated as a multiple of the
// chord, the same shape of bound the offset construction uses for its own
// coordinate scale.
const MAX_REACH_CHORDS = 2;

/**
 * The contour's segments, as indices into its point list. `offset-contour.js`
 * builds the same segments as point objects for its own readers. A write path
 * needs indices, and neither shape can serve the other.
 * @param {Array} points - Unpacked contour points
 * @param {boolean} closed - Whether the contour is closed
 * @returns {Array} `[{startIndex, endIndex, controlIndices}]`
 */
export function buildIndexedSegments(points, closed) {
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  const segments = [];
  if (onCurveIndices.length < 2) {
    return segments;
  }
  const controlsBetween = (from, to) => {
    const controls = [];
    for (let i = from; i < to; i++) {
      if (points[i]?.type) {
        controls.push(i);
      }
    }
    return controls;
  };
  for (let i = 0; i < onCurveIndices.length - 1; i++) {
    const startIndex = onCurveIndices[i];
    const endIndex = onCurveIndices[i + 1];
    segments.push({
      startIndex,
      endIndex,
      controlIndices: controlsBetween(startIndex + 1, endIndex),
    });
  }
  if (closed) {
    const startIndex = onCurveIndices[onCurveIndices.length - 1];
    const endIndex = onCurveIndices[0];
    segments.push({
      startIndex,
      endIndex,
      controlIndices: [
        ...controlsBetween(startIndex + 1, points.length),
        ...controlsBetween(0, endIndex),
      ],
    });
  }
  return segments;
}

export function isCubicSegment(segment) {
  return segment?.controlIndices?.length === 2;
}

export function samePosition(pointA, pointB) {
  return pointA.x === pointB.x && pointA.y === pointB.y;
}

// The direction a handle leaves its own on-curve point. Null where the handle
// sits on the point, which is a collapsed handle and carries no direction.
function handleDirection(handlePoint, onCurvePoint) {
  const delta = subVectors(handlePoint, onCurvePoint);
  if (Math.hypot(delta.x, delta.y) < EPSILON) {
    return null;
  }
  return normalizeVector(delta);
}

// How far the tangent crossing lies along each handle's own axis. Null where
// the crossing cannot carry a measurement: no crossing, a crossing behind
// either end, or one further than twice the chord.
function tangentReaches(startPoint, startDirection, endPoint, endDirection) {
  if (!startDirection || !endDirection) {
    return null;
  }
  // The crossing goes through the one function that owns it (R-B). It reads a
  // segment's four points and uses only the two handle directions, so a
  // synthetic handle one unit out states the direction exactly.
  const crossing = calculateTunniPoint([
    startPoint,
    addVectors(startPoint, startDirection),
    addVectors(endPoint, endDirection),
    endPoint,
  ]);
  if (!crossing) {
    return null;
  }
  const startReach = dotVector(subVectors(crossing, startPoint), startDirection);
  const endReach = dotVector(subVectors(crossing, endPoint), endDirection);
  if (startReach < EPSILON || endReach < EPSILON) {
    return null;
  }
  const chord = distance(startPoint, endPoint);
  if (chord < EPSILON) {
    return null;
  }
  if (startReach > MAX_REACH_CHORDS * chord || endReach > MAX_REACH_CHORDS * chord) {
    return null;
  }
  return { crossing, startReach, endReach, chord };
}

/**
 * Both handle tensions of a cubic segment: each handle's length as a fraction
 * of the way to the segment's Tunni point.
 * @returns {Object|null} `{start, end}`, or null where the crossing is unusable
 */
export function segmentTensions(points, segment) {
  if (!isCubicSegment(segment)) {
    return null;
  }
  const [firstControl, secondControl] = segment.controlIndices;
  const startPoint = points[segment.startIndex];
  const endPoint = points[segment.endIndex];
  const startDirection = handleDirection(points[firstControl], startPoint);
  const endDirection = handleDirection(points[secondControl], endPoint);
  const reaches = tangentReaches(startPoint, startDirection, endPoint, endDirection);
  if (!reaches) {
    return null;
  }
  return {
    start: distance(points[firstControl], startPoint) / reaches.startReach,
    end: distance(points[secondControl], endPoint) / reaches.endReach,
  };
}

function writeHandle(afterPoints, controlIndex, onCurvePoint, direction, length, round) {
  const target = addVectors(onCurvePoint, mulVectorScalar(direction, Math.max(length, 0)));
  const x = round(target.x);
  const y = round(target.y);
  const handle = afterPoints[controlIndex];
  if (handle.x === x && handle.y === y) {
    return false;
  }
  afterPoints[controlIndex] = { ...handle, x, y };
  return true;
}

/**
 * Rules 1 and 2. For every cubic segment whose ends moved, set both handle
 * lengths so that each keeps the tension it had, along the direction the
 * ordinary edit left it. Where the crossing is unusable at either the before or
 * the after state, scale the handle by the chord's own ratio instead.
 *
 * `afterPoints` is mutated. `beforePoints` is read only.
 * @returns {boolean} Whether anything moved
 */
export function restoreSegmentTensions(
  beforePoints,
  afterPoints,
  closed,
  { round = Math.round } = {}
) {
  let changed = false;
  for (const segment of buildIndexedSegments(beforePoints, closed)) {
    if (!isCubicSegment(segment)) {
      continue;
    }
    const [firstControl, secondControl] = segment.controlIndices;
    const beforeStart = beforePoints[segment.startIndex];
    const beforeEnd = beforePoints[segment.endIndex];
    const afterStart = afterPoints[segment.startIndex];
    const afterEnd = afterPoints[segment.endIndex];
    if (samePosition(beforeStart, afterStart) && samePosition(beforeEnd, afterEnd)) {
      continue;
    }
    // A handle that is still on its own point after the edit carries no
    // direction, so it keeps the one it had before. A handle that was collapsed
    // before stays collapsed, because its stored tension is zero.
    const startDirection =
      handleDirection(afterPoints[firstControl], afterStart) ||
      handleDirection(beforePoints[firstControl], beforeStart);
    const endDirection =
      handleDirection(afterPoints[secondControl], afterEnd) ||
      handleDirection(beforePoints[secondControl], beforeEnd);
    if (!startDirection || !endDirection) {
      continue;
    }
    const beforeChord = distance(beforeStart, beforeEnd);
    const afterChord = distance(afterStart, afterEnd);
    if (beforeChord < EPSILON || afterChord < EPSILON) {
      continue;
    }
    const tensions = segmentTensions(beforePoints, segment);
    const afterReaches = tensions
      ? tangentReaches(afterStart, startDirection, afterEnd, endDirection)
      : null;
    let startLength;
    let endLength;
    if (tensions && afterReaches) {
      startLength = tensions.start * afterReaches.startReach;
      endLength = tensions.end * afterReaches.endReach;
    } else {
      const ratio = afterChord / beforeChord;
      startLength = distance(beforePoints[firstControl], beforeStart) * ratio;
      endLength = distance(beforePoints[secondControl], beforeEnd) * ratio;
    }
    changed =
      writeHandle(
        afterPoints,
        firstControl,
        afterStart,
        startDirection,
        startLength,
        round
      ) || changed;
    changed =
      writeHandle(afterPoints, secondControl, afterEnd, endDirection, endLength, round) ||
      changed;
  }
  return changed;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-tension-aware-edit.js`
Expected: PASS, 8 passing.

Then run the whole suite: `cd src-js/fontra-core && npm test`
Expected: no test lost.

- [ ] **Step 5: Format and commit**

```bash
cd src-js && npx prettier --write fontra-core/src/tension-aware-edit.js fontra-core/tests/test-tension-aware-edit.js
cd .. && git add . && git commit -m "feat: the tension restore for tension-aware editing"
```

---

### Task 2: The tension point slide

Rule 3 of the spec, and the entry point the editor calls.

**Files:**
- Modify: `src-js/fontra-core/src/tension-aware-edit.js`
- Test: `src-js/fontra-core/tests/test-tension-aware-edit.js`

**Interfaces:**
- Consumes: task 1's `buildIndexedSegments`, `isCubicSegment`, `samePosition`, `segmentTensions`,
  `restoreSegmentTensions`; `isStraightControlledSmoothPoint` from `offset-contour.js`.
- Produces:
  - `slideTensionPoints(beforePoints, afterPoints, closed, {round}) -> boolean`
  - `applyTensionAwareEdit(beforePoints, afterPoints, closed, {round}) -> boolean`

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-tension-aware-edit.js`:

```js
import { applyTensionAwareEdit, slideTensionPoints } from "@fontra/core/tension-aware-edit.js";

// The inner arch of the n in _external/skeletron.fontra/glyphs/a.json, in local
// coordinates with the left stem's outer wall at x = 0. Point 0 is the foot of
// the stem's inner wall, point 1 is the tension point at the top of that wall,
// and the arch runs from there to the apex at point 4.
const archContour = () => [
  onCurve(60, 0),
  onCurve(60, 385, true),
  control(60, 432),
  control(86, 463),
  onCurve(125, 463, true),
];

describe("tension-aware edit — the slide", () => {
  it("slides the tension point to keep the corner in proportion", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(115, 463, true); // the apex dragged 10 units left
    slideTensionPoints(before, after, false);
    // The horizontal leg goes 65 -> 55, a ratio of 0.846. The vertical leg goes
    // 78 -> 66, so the tension point rises 12 units.
    expect(after[1].x).to.equal(60);
    expect(after[1].y).to.equal(397);
  });

  it("leaves a tension point that is itself in the edit", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(115, 463, true);
    after[1] = onCurve(60, 390, true); // the ordinary edit already moved it
    slideTensionPoints(before, after, false);
    expect(after[1].y).to.equal(390);
  });

  it("does not slide a corner point", () => {
    const before = archContour();
    before[1] = onCurve(60, 385); // no smooth flag, so it owns its direction
    const after = copy(before);
    after[4] = onCurve(115, 463, true);
    slideTensionPoints(before, after, false);
    expect(after[1].y).to.equal(385);
  });

  it("does not slide past the far end of its own straight", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(1000, 463, true); // an absurd pull outward
    slideTensionPoints(before, after, false);
    // The straight runs from y = 0 up to the tension point, so the slide stops
    // one unit short of its far end rather than crossing it.
    expect(after[1].y).to.be.at.least(1);
  });

  it("slides first and restores the handles after", () => {
    const before = archContour();
    const after = copy(before);
    after[4] = onCurve(115, 463, true);
    applyTensionAwareEdit(before, after, false);
    // The whole segment is the same drawing at 0.846 of the size: the vertical
    // handle is 47 * 0.846 and the horizontal one is 39 * 0.846.
    expect(after[1].y).to.equal(397);
    expect(after[2].y).to.equal(397 + 40);
    expect(after[3].x).to.equal(115 - 33);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-tension-aware-edit.js`
Expected: FAIL, `slideTensionPoints is not a function`.

- [ ] **Step 3: Write the slide**

Append to `src-js/fontra-core/src/tension-aware-edit.js`, and add
`import { isStraightControlledSmoothPoint } from "./offset-contour.js";` at the top:

```js
// A straight may not be run below this, and a slide may not cross its far end.
const MIN_STRAIGHT_LENGTH = 1;

// The shape `isStraightControlledSmoothPoint` reads: it wants the segments as
// point objects, and this module carries them as indices.
function segmentAsPoints(points, segment) {
  return {
    controlPoints: segment.controlIndices.map((index) => points[index]),
  };
}

// The segment on the other side of `pointIndex` from `segment`.
function neighbourSegment(segments, segmentIndex, atStart, closed) {
  const count = segments.length;
  if (atStart) {
    if (segmentIndex === 0 && !closed) {
      return null;
    }
    return segments[(segmentIndex - 1 + count) % count];
  }
  if (segmentIndex === count - 1 && !closed) {
    return null;
  }
  return segments[(segmentIndex + 1) % count];
}

/**
 * Rule 3. A smooth on-curve point with one handle and a straight on its other
 * side owns no direction of its own, so it may slide along that straight. It
 * slides until its segment's tangent corner is back in proportion: the near leg
 * takes the same ratio the far leg took.
 *
 * `afterPoints` is mutated. `beforePoints` is read only.
 * @returns {boolean} Whether anything moved
 */
export function slideTensionPoints(
  beforePoints,
  afterPoints,
  closed,
  { round = Math.round } = {}
) {
  const segments = buildIndexedSegments(beforePoints, closed);
  let changed = false;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (!isCubicSegment(segment)) {
      continue;
    }
    for (const atStart of [true, false]) {
      const straight = neighbourSegment(segments, segmentIndex, atStart, closed);
      if (!straight) {
        continue;
      }
      const nearIndex = atStart ? segment.startIndex : segment.endIndex;
      const farIndex = atStart ? segment.endIndex : segment.startIndex;
      const nearControl = segment.controlIndices[atStart ? 0 : 1];
      const farControl = segment.controlIndices[atStart ? 1 : 0];
      if (
        !isStraightControlledSmoothPoint(
          beforePoints[nearIndex],
          segmentAsPoints(beforePoints, straight),
          segmentAsPoints(beforePoints, segment)
        )
      ) {
        continue;
      }
      // A point the edit already moved travels with the edit. It does not also
      // slide. A far end that did not move asks for no slide at all.
      if (!samePosition(beforePoints[nearIndex], afterPoints[nearIndex])) {
        continue;
      }
      if (samePosition(beforePoints[farIndex], afterPoints[farIndex])) {
        continue;
      }
      const nearPoint = beforePoints[nearIndex];
      const nearDirection =
        handleDirection(afterPoints[nearControl], nearPoint) ||
        handleDirection(beforePoints[nearControl], nearPoint);
      const beforeFar = beforePoints[farIndex];
      const afterFar = afterPoints[farIndex];
      const beforeFarDirection = handleDirection(beforePoints[farControl], beforeFar);
      const afterFarDirection =
        handleDirection(afterPoints[farControl], afterFar) || beforeFarDirection;
      const beforeReaches = tangentReaches(
        nearPoint,
        nearDirection,
        beforeFar,
        beforeFarDirection
      );
      const afterReaches = tangentReaches(
        nearPoint,
        nearDirection,
        afterFar,
        afterFarDirection
      );
      if (!beforeReaches || !afterReaches) {
        continue;
      }
      const ratio = afterReaches.endReach / beforeReaches.endReach;
      const nearReach = beforeReaches.startReach * ratio;
      let target = subVectors(
        afterReaches.crossing,
        mulVectorScalar(nearDirection, nearReach)
      );
      // The straight's far end holds the slide. Keep the straight at least one
      // unit long and on the side it started.
      const anchor =
        straight.startIndex === nearIndex
          ? beforePoints[straight.endIndex]
          : beforePoints[straight.startIndex];
      const axis = normalizeVector(subVectors(nearPoint, anchor));
      const travel = dotVector(subVectors(target, anchor), axis);
      if (travel < MIN_STRAIGHT_LENGTH) {
        target = addVectors(anchor, mulVectorScalar(axis, MIN_STRAIGHT_LENGTH));
      }
      const x = round(target.x);
      const y = round(target.y);
      if (afterPoints[nearIndex].x !== x || afterPoints[nearIndex].y !== y) {
        afterPoints[nearIndex] = { ...afterPoints[nearIndex], x, y };
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * The whole correction, in the order it has to run: the slide moves an on-curve
 * point, and the restore reads every on-curve position, so the slide goes first.
 * @returns {boolean} Whether anything moved
 */
export function applyTensionAwareEdit(beforePoints, afterPoints, closed, options = {}) {
  const slid = slideTensionPoints(beforePoints, afterPoints, closed, options);
  const restored = restoreSegmentTensions(beforePoints, afterPoints, closed, options);
  return slid || restored;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-tension-aware-edit.js`
Expected: PASS, 13 passing.

Then: `cd src-js/fontra-core && npm test` — no test lost.

- [ ] **Step 5: Write the sweep**

The architecture map asks for a sweep rather than a per-configuration assertion. Append:

```js
describe("tension-aware edit — continuity", () => {
  it("moves no point by more than the step that drove it, over a 200-step sweep", () => {
    let worst = 0;
    let previous = null;
    for (let step = 0; step <= 200; step++) {
      const apexX = 125 - step * 0.25; // 50 units of travel in quarter units
      const before = archContour();
      const after = copy(before);
      after[4] = onCurve(apexX, 463, true);
      applyTensionAwareEdit(before, after, false);
      if (previous) {
        for (let i = 0; i < after.length; i++) {
          const moved = Math.hypot(after[i].x - previous[i].x, after[i].y - previous[i].y);
          worst = Math.max(worst, moved);
        }
      }
      previous = after;
    }
    // A quarter unit of input, plus whole-unit grid rounding on both axes.
    expect(worst).to.be.at.most(2);
  });
});
```

- [ ] **Step 6: Run it, then format and commit**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS.

```bash
cd src-js && npx prettier --write fontra-core/src/tension-aware-edit.js fontra-core/tests/test-tension-aware-edit.js
cd .. && git add . && git commit -m "feat: the tension point slide"
```

---

### Task 3: The X drag

The editor half for the delta path. After this task the feature works on a drag.

**Files:**
- Create: `src-js/views-editor/src/tension-aware-editing.js`
- Modify: `src-js/views-editor/src/edit-behavior.js` (the `behaviorTypes` table, beside
  `"base-expand"`)
- Modify: `src-js/views-editor/src/edit-tools-pointer.js` (the realtime action list near line 85,
  the constructor near line 146, `getRealtimeModifiers` near line 745, and the behavior-name
  resolution below it)
- Modify: `src-js/views-editor/src/editor.js` (the realtime action block near line 710)
- Modify: `src-js/fontra-core/assets/lang/en.js` (near line 327)

**Interfaces:**
- Consumes: `applyTensionAwareEdit` from `tension-aware-edit.js`; `EditBehaviorFactory` from
  `edit-behavior.js`; `recordChanges` from `change-recorder.js`; `applyChange` from `changes.js`.
- Produces:
  - `TENSION_AWARE_BEHAVIOR_NAME`, `TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME`
  - `getTensionAwareBehaviorName(modifiers, targetKinds, event) -> string|null`
  - `createTensionAwareTargetEntries(layerGlyph, selection, behaviorName, {isGeneratedContour})`

- [ ] **Step 1: Write the module**

Create `src-js/views-editor/src/tension-aware-editing.js`:

```js
import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import { applyTensionAwareEdit } from "@fontra/core/tension-aware-edit.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { EditBehaviorFactory } from "./edit-behavior.js";

export const TENSION_AWARE_BEHAVIOR_NAME = "tension-aware";
export const TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME = "tension-aware-constrain";

/**
 * X drives the correction wherever the selection is ordinary path geometry.
 * A selection holding skeleton geometry keeps the skeleton drag, which has its
 * own width semantics.
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Object} event - The pointer event, for shift-constrain
 * @returns {string|null} The behavior name, or null
 */
export function getTensionAwareBehaviorName(modifiers, targetKinds, event) {
  if (!modifiers?.tensionAwareMode) return null;
  if (targetKinds?.has("skeletonPoint") || targetKinds?.has("skeletonRib")) return null;
  return event?.shiftKey
    ? TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME
    : TENSION_AWARE_BEHAVIOR_NAME;
}

// The ordinary behavior name behind each of ours. The correction runs on top of
// what the ordinary rules produce, so the rules have to run somewhere.
const BASE_BEHAVIOR_NAMES = {
  [TENSION_AWARE_BEHAVIOR_NAME]: "default",
  [TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME]: "constrain",
};

/**
 * One target entry for the whole path. It reproduces the ordinary edit on a
 * scratch copy of the pre-drag path, corrects it, and records the result. Every
 * frame is measured from that copy, never from the frame before it, so a slow
 * drag and a fast one ending in the same place give the same shape and the
 * rollback describes the whole gesture.
 */
export function createTensionAwareTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  const baseFactory = new EditBehaviorFactory(
    { ...layerGlyph, path: originalPath },
    selection,
    false
  );
  const baseBehavior = baseFactory.getBehavior(
    BASE_BEHAVIOR_NAMES[behaviorName] || "default"
  );

  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          // What the ordinary rules do with this delta, on its own copy.
          const moved = { ...layerGlyph, path: originalPath.copy() };
          applyChange(moved, baseBehavior.makeChangeForDelta(delta));
          for (let contourIndex = 0; contourIndex < moved.path.numContours; contourIndex++) {
            if (isGeneratedContour?.(contourIndex)) continue;
            const before = originalPath.getUnpackedContour(contourIndex);
            const after = moved.path.getUnpackedContour(contourIndex);
            applyTensionAwareEdit(before.points, after.points, after.isClosed);
            const startIndex = moved.path.getAbsolutePointIndex(contourIndex, 0);
            for (let i = 0; i < after.points.length; i++) {
              const point = after.points[i];
              const original = before.points[i];
              if (point.x === original.x && point.y === original.y) continue;
              layerGlyphProxy.path.setPointPosition(startIndex + i, point.x, point.y);
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
```

- [ ] **Step 2: Add the two behavior types**

In `src-js/views-editor/src/edit-behavior.js`, in the `behaviorTypes` table, directly after the
`"base-expand"` entry:

```js
  // The ordinary match tree, plus a target entry that corrects handle lengths
  // afterwards. X changes no angle, so every rule above stays as it is.
  "tension-aware": {
    matchTree: buildPointMatchTree(defaultRules),
    actions: actionFactories,
  },

  "tension-aware-constrain": {
    matchTree: buildPointMatchTree(constrainRules),
    actions: actionFactories,
    constrainDelta: constrainHorVerDiag,
  },
```

- [ ] **Step 3: Register the key**

In `src-js/views-editor/src/editor.js`, inside the `realtime-hotkeys` block, after the
`fixed-rib-compress` registration:

```js
      registerActionInfo("action.realtime.tension-aware", {
        topic,
        titleKey: "shortcuts.realtime.tension-aware",
        defaultShortCuts: [{ baseKey: "x" }],
      });
```

In `src-js/fontra-core/assets/lang/en.js`, after `"shortcuts.realtime.fixed-rib-compress"`:

```js
  "shortcuts.realtime.tension-aware": "Tension aware (hold)",
```

- [ ] **Step 4: Wire the pointer tool**

In `src-js/views-editor/src/edit-tools-pointer.js`:

Add the action constant beside the other three near line 87:

```js
const REALTIME_TENSION_AWARE_ACTION = "action.realtime.tension-aware";
```

Add to `REALTIME_MODIFIER_ACTIONS`:

```js
  {
    action: REALTIME_TENSION_AWARE_ACTION,
    modeProperty: "tensionAwareMode",
  },
```

Add to the constructor beside `this.fixedRibCompressMode = false;`:

```js
    this.tensionAwareMode = false;
```

Add to `getRealtimeModifiers` in `handleDragSelection`:

```js
        tensionAwareMode: this.tensionAwareMode,
```

Import at the top:

```js
import {
  createTensionAwareTargetEntries,
  createTensionAwareTransformEntries,
  getTensionAwareBehaviorName,
  TENSION_AWARE_BEHAVIOR_NAME,
  TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME,
  TENSION_AWARE_SCALE_BEHAVIOR_NAME,
} from "./tension-aware-editing.js";
```

Task 5 uses the last two of those. Import all six now, so the import block is written once.

In `getSelectionBehaviorName`, put it first in the chain, before the skeleton modifier name:

```js
      const getSelectionBehaviorName = (event) =>
        getTensionAwareBehaviorName(getRealtimeModifiers(), targetKinds, event) ||
        getSkeletonModifierBehaviorName(event, getRealtimeModifiers(), targetKinds) ||
```

In `makeSkeletonTargetEntries`, beside the `BASE_EXPAND_BEHAVIOR_NAME` branch:

```js
        if (
          name === TENSION_AWARE_BEHAVIOR_NAME ||
          name === TENSION_AWARE_CONSTRAIN_BEHAVIOR_NAME
        ) {
          return createTensionAwareTargetEntries(layerGlyph, sceneController.selection, name, {
            isGeneratedContour: (contourIndex) =>
              this.sceneModel.isGeneratedPathContour(contourIndex),
          });
        }
```

- [ ] **Step 5: Check and bundle**

```bash
cd src-js
node --check views-editor/src/tension-aware-editing.js
node --check views-editor/src/edit-tools-pointer.js
node --check views-editor/src/edit-behavior.js
node --check views-editor/src/editor.js
npx prettier --write views-editor/src/tension-aware-editing.js views-editor/src/edit-tools-pointer.js views-editor/src/edit-behavior.js views-editor/src/editor.js fontra-core/assets/lang/en.js
npm run bundle
```

Expected: all three clean.

- [ ] **Step 6: Run the manual matrix**

Open `_external/skeletron.fontra` at glyph `a`, which holds two n's.

| # | Action | Expected |
| - | ------ | -------- |
| 1 | Select the inner apex. Drag it 10 left with no key | The arch pinches. The tension point holds at 385 |
| 2 | Undo. Hold X and drag it 10 left | The tension point rises to about 397 and the arch keeps its shape |
| 3 | Hold X and drag a whole segment's two ends together | Nothing but a translation. No handle length changes |
| 4 | Hold X and drag across a smooth joint at the selection boundary | The joint stays smooth |
| 5 | Press X mid-drag, then release it mid-drag | The correction starts and stops on the next frame |
| 6 | Hold X and shift, drag | The delta constrains to 0, 45 and 90 degrees as it always did |
| 7 | Undo after each of the above | The glyph returns to where the gesture started, in one step |
| 8 | Hold X and drag a skeleton point in a skeleton glyph | The ordinary skeleton drag, unchanged |

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat: the X drag keeps a curve's tension"
```

---

### Task 4: The rigid-link scale solve

Rule 4 of the spec. Pure geometry.

**Files:**
- Modify: `src-js/fontra-core/src/tension-aware-edit.js`
- Test: `src-js/fontra-core/tests/test-tension-aware-edit.js`

**Interfaces:**
- Consumes: task 1's `buildIndexedSegments`, `isCubicSegment`.
- Produces:
  - `solveRigidLinkScale(contours, axis, factor, origin) -> [Map|null]`, one map per contour of
    point index to new axis coordinate, or `null` for the whole call, meaning stand down.
  - `MIN_CURVE_EXTENT`

The construction, stated once so the code can be read against it. Walk each contour. On-curve
points joined by straight segments form a **body**. A maximal chain of curve segments is a **run**,
and its two ends belong to bodies. Sort the bodies along the axis by their lowest coordinate. The
distance between one body's top and the next body's bottom is a **gap**. The scale's whole change
is shared out over the gaps in proportion to their size, which fixes every body's displacement. A
run's interior on-curve points then interpolate between the run's own two moved ends, which is what
lets two runs between the same pair of bodies take different factors.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-tension-aware-edit.js`:

```js
import { solveRigidLinkScale } from "@fontra/core/tension-aware-edit.js";

// The whole outer contour of the n, in local coordinates. Two stems of 60 units
// joined by an inner arch and an outer arch.
const nContour = () => ({
  points: [
    onCurve(0, 500),
    onCurve(0, 0),
    onCurve(60, 0),
    onCurve(60, 385, true),
    control(60, 432),
    control(86, 463),
    onCurve(125, 463, true),
    control(164, 463),
    control(190, 429),
    onCurve(190, 378, true),
    onCurve(190, 0),
    onCurve(250, 0),
    onCurve(250, 407, true),
    control(250, 471),
    control(210, 516),
    onCurve(152, 516, true),
    control(108, 516),
    control(75, 491),
    onCurve(60, 455),
    onCurve(60, 500),
  ],
  isClosed: true,
});

describe("tension-aware edit — the rigid-link scale", () => {
  it("narrows the n to 230 and keeps both stems at 60", () => {
    const contour = nContour();
    const [coordinates] = solveRigidLinkScale([contour], "x", 230 / 250, 0);
    expect(coordinates.get(1)).to.equal(0); // left outer wall
    expect(coordinates.get(2)).to.equal(60); // left inner wall
    expect(coordinates.get(9)).to.equal(170); // right inner wall
    expect(coordinates.get(11)).to.equal(230); // right outer wall
  });

  it("gives each run its own factor", () => {
    const contour = nContour();
    const [coordinates] = solveRigidLinkScale([contour], "x", 230 / 250, 0);
    // The inner run spans 60 to 190 and takes 110 of 130. The outer run spans
    // 60 to 250 and takes 170 of 190. The two apexes therefore move by
    // different amounts.
    expect(coordinates.get(6)).to.be.closeTo(115, 0.5);
    expect(coordinates.get(15)).to.be.closeTo(142.3, 0.5);
  });

  it("stands down where a contour has no elastic run", () => {
    const rectangle = {
      points: [onCurve(0, 0), onCurve(100, 0), onCurve(100, 50), onCurve(0, 50)],
      isClosed: true,
    };
    expect(solveRigidLinkScale([rectangle], "x", 0.5, 0)).to.equal(null);
  });

  it("stands down where every run returns to its own body", () => {
    // A stem with a bowl hung off it: the bowl's two ends sit on the same run
    // of straights, so nothing can be distributed.
    const bowl = {
      points: [
        onCurve(0, 0),
        onCurve(0, 500),
        onCurve(60, 500),
        control(200, 500),
        control(200, 0),
        onCurve(60, 0),
      ],
      isClosed: true,
    };
    expect(solveRigidLinkScale([bowl], "x", 0.5, 0)).to.equal(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-tension-aware-edit.js`
Expected: FAIL, `solveRigidLinkScale is not a function`.

- [ ] **Step 3: Write the solve**

Append to `src-js/fontra-core/src/tension-aware-edit.js`:

```js
// No curved segment's bounding box may go under this in either direction. The
// scale stops when the first one gets there.
export const MIN_CURVE_EXTENT = 2;

function bodiesOfContour(points, closed) {
  const segments = buildIndexedSegments(points, closed);
  const bodyOf = new Map();
  const bodies = [];
  const join = (indexA, indexB) => {
    const bodyA = bodyOf.get(indexA);
    const bodyB = bodyOf.get(indexB);
    if (bodyA && bodyB) {
      if (bodyA === bodyB) return;
      for (const index of bodyB) {
        bodyA.add(index);
        bodyOf.set(index, bodyA);
      }
      bodies.splice(bodies.indexOf(bodyB), 1);
      return;
    }
    const body = bodyA || bodyB || new Set();
    if (!bodyA && !bodyB) bodies.push(body);
    for (const index of [indexA, indexB]) {
      body.add(index);
      bodyOf.set(index, body);
    }
  };
  for (const segment of segments) {
    if (!isCubicSegment(segment)) {
      join(segment.startIndex, segment.endIndex);
    }
  }
  return { segments, bodies, bodyOf };
}

// A run is a maximal chain of curve segments. Its two ends are on-curve points
// that belong to bodies, and its interior on-curves belong to no body.
function runsOfContour(segments, bodyOf) {
  const runs = [];
  let current = null;
  const flush = () => {
    if (current) runs.push(current);
    current = null;
  };
  for (const segment of segments) {
    if (!isCubicSegment(segment)) {
      flush();
      continue;
    }
    if (!current) {
      current = { startIndex: segment.startIndex, interior: [], endIndex: null };
    } else {
      current.interior.push(segment.startIndex);
    }
    current.endIndex = segment.endIndex;
  }
  flush();
  // On a closed contour a run that ends where another begins is one run.
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (last.endIndex === first.startIndex && !bodyOf.get(first.startIndex)) {
      last.interior.push(first.startIndex, ...first.interior);
      last.endIndex = first.endIndex;
      runs.shift();
    }
  }
  return runs;
}

/**
 * Rule 4. Straights are rigid links along the axis being scaled, and the curves
 * absorb the change.
 * @param {Array} contours - `[{points, isClosed}]`, the contours in the selection
 * @param {string} axis - "x" or "y"
 * @param {number} factor - The scale factor the transform box asks for
 * @param {number} origin - The coordinate the scale is taken about
 * @returns {Array|null} One Map per contour of point index to new coordinate,
 *   or null where the rule has nothing to distribute and must stand down
 */
export function solveRigidLinkScale(contours, axis, factor, origin) {
  const perContour = contours.map(({ points, isClosed }) => {
    const { segments, bodies, bodyOf } = bodiesOfContour(points, isClosed);
    return { points, isClosed, segments, bodies, bodyOf, runs: runsOfContour(segments, bodyOf) };
  });

  const allBodies = [];
  let hasDistributableRun = false;
  for (const contour of perContour) {
    for (const body of contour.bodies) {
      const coordinates = [...body].map((index) => contour.points[index][axis]);
      allBodies.push({
        body,
        min: Math.min(...coordinates),
        max: Math.max(...coordinates),
        displacement: 0,
      });
    }
    for (const run of contour.runs) {
      if (contour.bodyOf.get(run.startIndex) !== contour.bodyOf.get(run.endIndex)) {
        hasDistributableRun = true;
      }
    }
  }
  if (!hasDistributableRun || allBodies.length < 2) {
    return null;
  }

  allBodies.sort((a, b) => a.min - b.min);
  const gaps = [];
  let gapTotal = 0;
  for (let i = 0; i < allBodies.length - 1; i++) {
    const gap = Math.max(0, allBodies[i + 1].min - allBodies[i].max);
    gaps.push(gap);
    gapTotal += gap;
  }
  if (gapTotal < EPSILON) {
    return null;
  }

  const lowest = allBodies[0].min;
  const highest = allBodies[allBodies.length - 1].max;
  const scaled = (coordinate) => origin + (coordinate - origin) * factor;
  const change = scaled(highest) - scaled(lowest) - (highest - lowest);

  allBodies[0].displacement = scaled(lowest) - lowest;
  for (let i = 0; i < gaps.length; i++) {
    allBodies[i + 1].displacement =
      allBodies[i].displacement + (change * gaps[i]) / gapTotal;
  }
  const displacementOf = new Map();
  for (const entry of allBodies) {
    displacementOf.set(entry.body, entry.displacement);
  }

  return perContour.map((contour) => {
    const coordinates = new Map();
    const place = (index, value) => coordinates.set(index, value);
    for (const body of contour.bodies) {
      const displacement = displacementOf.get(body);
      for (const index of body) {
        place(index, contour.points[index][axis] + displacement);
      }
    }
    for (const run of contour.runs) {
      const startBefore = contour.points[run.startIndex][axis];
      const endBefore = contour.points[run.endIndex][axis];
      const startAfter = coordinates.get(run.startIndex) ?? startBefore;
      const endAfter = coordinates.get(run.endIndex) ?? endBefore;
      const span = endBefore - startBefore;
      for (const index of run.interior) {
        if (Math.abs(span) < EPSILON) {
          place(index, contour.points[index][axis] + (startAfter - startBefore));
          continue;
        }
        const t = (contour.points[index][axis] - startBefore) / span;
        place(index, startAfter + t * (endAfter - startAfter));
      }
    }
    return coordinates;
  });
}

/**
 * Does every cubic segment still measure at least `MIN_CURVE_EXTENT` in both
 * directions? The scale stops at the first one that does not.
 */
export function curvesAreAboveFloor(points, closed) {
  for (const segment of buildIndexedSegments(points, closed)) {
    if (!isCubicSegment(segment)) continue;
    const involved = [segment.startIndex, ...segment.controlIndices, segment.endIndex].map(
      (index) => points[index]
    );
    const xs = involved.map((point) => point.x);
    const ys = involved.map((point) => point.y);
    if (
      Math.max(...xs) - Math.min(...xs) < MIN_CURVE_EXTENT &&
      Math.max(...ys) - Math.min(...ys) < MIN_CURVE_EXTENT
    ) {
      return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS, all four new tests green and nothing lost.

- [ ] **Step 5: Format and commit**

```bash
cd src-js && npx prettier --write fontra-core/src/tension-aware-edit.js fontra-core/tests/test-tension-aware-edit.js
cd .. && git add . && git commit -m "feat: the rigid-link scale solve"
```

---

### Task 5: The X scale

The editor half for the transform box.

**Files:**
- Modify: `src-js/views-editor/src/tension-aware-editing.js`
- Modify: `src-js/views-editor/src/edit-behavior.js` (one more behavior type)
- Modify: `src-js/views-editor/src/edit-tools-pointer.js` (the scale block near lines 1060-1150)

**Interfaces:**
- Consumes: `solveRigidLinkScale`, `curvesAreAboveFloor`, `applyTensionAwareEdit`.
- Produces: `createTensionAwareTransformEntries(layerGlyph, selection, axis, {isGeneratedContour})`
  and `TENSION_AWARE_SCALE_BEHAVIOR_NAME`.

- [ ] **Step 1: Add the behavior type**

In `src-js/views-editor/src/edit-behavior.js`, after the two from task 3:

```js
  // The entry is the only writer under an X scale, so the match tree matches no
  // point (R-E, the same shape as base-expand).
  "tension-aware-scale": {
    matchTree: buildPointMatchTree([]),
    actions: actionFactories,
  },
```

- [ ] **Step 2: Add the transform entry**

Append to `src-js/views-editor/src/tension-aware-editing.js`:

```js
import { curvesAreAboveFloor, solveRigidLinkScale } from "@fontra/core/tension-aware-edit.js";

export const TENSION_AWARE_SCALE_BEHAVIOR_NAME = "tension-aware-scale";

/**
 * The transform-box half. It reads the transformation's factor and origin on
 * the one axis being scaled, solves the rigid links, then runs the same slide
 * and restore the drag uses.
 *
 * It keeps the last solve that passed the curve floor and emits that again
 * where the current one fails, so the shape stands still while the drag runs on.
 * @param {string} axis - "x" or "y"
 */
export function createTensionAwareTransformEntries(
  layerGlyph,
  selection,
  axis,
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  const contourIndices = [];
  for (let i = 0; i < originalPath.numContours; i++) {
    if (!isGeneratedContour?.(i)) contourIndices.push(i);
  }
  const originals = contourIndices.map((contourIndex) => ({
    contourIndex,
    startIndex: originalPath.getAbsolutePointIndex(contourIndex, 0),
    contour: originalPath.getUnpackedContour(contourIndex),
  }));

  let rollbackChange = null;
  let lastGood = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta() {
        return null;
      },
      makeChangeForTransformation(transformation) {
        // The box hands over a full affine, already pinned about its own
        // point. On one axis it is a scale plus a shift, which are the only two
        // numbers this rule reads: `new = factor * old + shift`, so the fixed
        // coordinate is `shift / (1 - factor)`.
        const factor = axis === "x" ? transformation.xx : transformation.yy;
        const shift = axis === "x" ? transformation.dx : transformation.dy;
        if (Math.abs(factor - 1) < 1e-9) {
          return null;
        }
        const origin = shift / (1 - factor);

        const solved = solveRigidLinkScale(
          originals.map(({ contour }) => contour),
          axis,
          factor,
          origin
        );
        const frames = solved ? buildFrames(originals, solved, axis) : null;
        if (frames && frames.every(({ points, isClosed }) => curvesAreAboveFloor(points, isClosed))) {
          lastGood = frames;
        }
        if (!lastGood) {
          return null;
        }
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          lastGood.forEach(({ points }, i) => {
            const { startIndex, contour } = originals[i];
            for (let p = 0; p < points.length; p++) {
              if (points[p].x === contour.points[p].x && points[p].y === contour.points[p].y) {
                continue;
              }
              layerGlyphProxy.path.setPointPosition(startIndex + p, points[p].x, points[p].y);
            }
          });
        });
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
    },
  ];
}

// Move every on-curve to its solved coordinate on the scaled axis, then run the
// slide and the restore over the result.
function buildFrames(originals, solved, axis) {
  return originals.map(({ contour }, i) => {
    const before = contour.points;
    const after = before.map((point) => ({ ...point }));
    for (const [index, coordinate] of solved[i]) {
      after[index][axis] = Math.round(coordinate);
    }
    applyTensionAwareEdit(before, after, contour.isClosed);
    return { points: after, isClosed: contour.isClosed };
  });
}
```

- [ ] **Step 3: Wire the transform box**

In `src-js/views-editor/src/edit-tools-pointer.js`, in the scale block, the handle already tells
which axis is being scaled: a handle whose name holds `middle` scales x alone, one whose name holds
`center` scales y alone, and anything else is a corner. Add above the `layerInfo` build:

```js
      // A corner handle scales both axes at once, so the mode bypasses and the
      // ordinary scale applies.
      const tensionAwareAxis = !this.tensionAwareMode
        ? null
        : clickedHandle.includes("middle")
          ? "x"
          : clickedHandle.includes("center")
            ? "y"
            : null;
```

In the same block, add the entry to the factory's target entries and pick the behavior name:

```js
        const tensionAwareEntries = tensionAwareAxis
          ? createTensionAwareTransformEntries(
              layerGlyph,
              sceneController.selection,
              tensionAwareAxis,
              {
                isGeneratedContour: (contourIndex) =>
                  this.sceneModel.isGeneratedPathContour(contourIndex),
              }
            )
          : [];
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          sceneController.selection,
          this.scalingEditBehavior,
          {
            targetEntries: [
              ...(skeletonEntry ? [skeletonEntry] : []),
              ...tensionAwareEntries,
            ],
          }
        );
```

and where the behavior is taken:

```js
          editBehavior: behaviorFactory.getTransformBehavior(
            tensionAwareEntries.length ? TENSION_AWARE_SCALE_BEHAVIOR_NAME : "default"
          ),
```

- [ ] **Step 4: Check and bundle**

```bash
cd src-js
node --check views-editor/src/tension-aware-editing.js
node --check views-editor/src/edit-tools-pointer.js
node --check views-editor/src/edit-behavior.js
npx prettier --write views-editor/src/tension-aware-editing.js views-editor/src/edit-tools-pointer.js views-editor/src/edit-behavior.js
npm run bundle
```

- [ ] **Step 5: Run the manual matrix**

Glyph `a` of `_external/skeletron.fontra`, the first n.

| # | Action | Expected |
| - | ------ | -------- |
| 1 | Select the whole n. Drag the right middle handle to 230 wide with no key | Everything scales. The stems come out 55 wide |
| 2 | Undo. Hold X and do the same | The stems hold 60. The inner walls land at 60 and 170 |
| 3 | Read the two apexes in the panel | About 115 and 142 |
| 4 | Keep dragging left, far past the counter | The shape stops when a curve reaches 2 units and stands still |
| 5 | Hold X and drag a corner handle | The ordinary scale, both axes |
| 6 | Hold X and drag the top centre handle | The mode runs on y. The shoulder stretches, which is the known cost |
| 7 | Select a rectangle contour. Hold X and scale | It scales normally |
| 8 | Undo after each | One step back to where the gesture started |

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat: the X scale holds straights rigid"
```

---

### Task 6: Fold the design into the reference set

**Files:**
- Modify: `docs/superpowers/FEATURE-MODEL.md` (add §13 at the end)
- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` (§1 inventory, a new §3 F10 block, §4
  shared-file index, §6 coverage)
- Modify: `docs/superpowers/GLOSSARY.md` (tension point, rigid link, elastic run)
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md` (a new section)
- Delete: `docs/superpowers/specs/2026-08-19-tension-aware-drag-and-scale-design.md`
- Delete: `docs/superpowers/plans/2026-08-20-tension-aware-drag-and-scale.md`

- [ ] **Step 1: Write the feature model section**

Add §13 to `FEATURE-MODEL.md`, carrying the four rules, the quarter-ellipse picture, the n numbers,
the bounds, and what must be preserved. Take the wording from the spec, in the present tense.

- [ ] **Step 2: Write the log section**

Add a section to `DEVELOPMENT-LOG.md` holding what the model does not: the measurements that
settled the invariant (the three candidate slides and the apex radius each gives: 52.7 with no
slide, 60.5 under equal travel, 62.3 under the similar corner, against the original 73.6), the
interval-map formulation that was proposed and withdrawn, and the vertical-axis cost measured on
the n.

- [ ] **Step 3: Update the architecture map**

Add F10 to the §1 inventory with its owned files. Add the F10 file table. Add the new hunks to the
§4 shared-file reverse index for `edit-behavior.js`, `edit-tools-pointer.js`, `editor.js` and
`lang/en.js`. Add the row to §6.

- [ ] **Step 4: Add the glossary entries**

`GLOSSARY.md`, in the forkra terms: **tension point**, **rigid link**, **elastic run**.

- [ ] **Step 5: Retire the spec and this plan**

```bash
git rm docs/superpowers/specs/2026-08-19-tension-aware-drag-and-scale-design.md
git rm docs/superpowers/plans/2026-08-20-tension-aware-drag-and-scale.md
```

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "docs: fold tension-aware editing into the reference set"
```
