# Corner join by intersection — implementation plan

> **For agentic workers:** Execute this plan task-by-task with
> `superpowers:executing-plans`. Do **not** dispatch subagents and do **not** create a worktree:
> `docs/superpowers/START-HERE.md` forbids both. Work on a branch. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Put a skeleton corner's outline points where the two offset edges actually meet, instead
of one half-width from the centerline.

**Architecture:** A corner today gets one shared outline point per side, placed one half-width
along the line that splits the angle between the two arms. The direction is already right. Only
the distance is wrong: the meeting place is the half-width divided by the cosine of half the turn.
The handle solver already takes the endpoint it must land on as an input separate from the shape
it must match, so moving that endpoint outward needs no solver change. Past a fixed limit of two
stroke widths, and where the two arms fold back, there is no usable meeting place, and that side
emits both arms' own edge ends with a straight line between them.

**Tech Stack:** JavaScript. `fontra-core` for pure geometry, tested with mocha and chai.
`views-editor` has no test harness, so its half carries a manual test matrix.

**Spec:** `docs/superpowers/specs/2026-08-30-corner-intersection-design.md`

## Global Constraints

- **R-A — layer placement.** Pure geometry goes in `fontra-core/src/` with mocha tests. Rendering
  goes in a `visualization-layer-*.js` file. `edit-tools-pointer.js` stays a thin dispatcher.
- **R-B — one copy of every constant and geometry function.** If a symbol exists anywhere in the
  tree, import it.
- **R-D — provenance forward, never recovered.** Nothing may find a generated point's owning
  skeleton point by comparing coordinates.
- **R-G — every commit runs three commands and all three must pass:**
  `node --check` on each touched editor file, then `npx prettier --write`, then
  `npm run bundle`. The user runs bundle-watch already, so report compile errors rather than
  running the bundle yourself, and run `node --check` and `prettier` yourself.
- **Tests:** `cd src-js/fontra-core && npm test`. The suite is about 1690 tests.
- **Point-count stability.** The number of generated on-curve points must not vary with a setting,
  except in the two cases the spec names: past the miter limit, and at a fold-back.
- **Commit after each task.** Stage with `git add .`.
- **The miter limit is 2 times the full stroke width**, measured from the skeleton point to the
  meeting place. The full stroke width at a point is its left half-width plus its right
  half-width.
- **Do not touch `calculateContourNormalAtPoint` in `offset-contour.js`.** The drag that offsets an
  ordinary hand-drawn outline reads it and must not change.

---

## File structure

| File                                                      | What it does in this work                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `fontra-core/src/skeleton-generator.js`                   | Owns the corner. `calculateCornerNormal` becomes `calculateCornerJoin` and returns a distance as well |
| `fontra-core/src/skeleton-model.js`                       | `calculateNormalAtSkeletonPoint` gives the rib bar its own direction at a corner                      |
| `fontra-core/tests/test-skeleton-generator.js`            | Corner geometry tests and the three sweeps                                                            |
| `fontra-core/tests/data/skeleton-generator/fixtures.json` | Golden masters. They move. Each move is reviewed, not regenerated blind                               |
| `docs/superpowers/DEVELOPMENT-LOG.md`                     | The measured numbers and what they cost                                                               |
| `docs/superpowers/FEATURE-MODEL.md`                       | Section 3, step 2. The corner rule                                                                    |

---

## Task 1: The corner reaches the meeting place

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js` — `calculateCornerNormal` at line 2912,
  its four call sites at 2373, 2445, 2526 and 2539, and the local `projectPoint` at 2344
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `calculateCornerJoin(segment1, segment2)` returning
  `{ normal: {x, y}, miterScale: number }`. `normal` is the unit normal on the line that splits the
  angle between the two arms, exactly what `calculateCornerNormal` returns today. `miterScale` is
  one divided by the cosine of half the turn, and is `Infinity` where the two arms are exactly
  parallel. Task 2 reads `miterScale`.

- [ ] **Step 1: Write the failing test**

Add to `test-skeleton-generator.js`, at the end of the file:

```js
describe("skeleton-generator corner meeting place", () => {
  // A horizontal arm into a vertical arm, meeting at (100, 0). Half-width 40.
  // The two offset edges of one side are the lines y = -40 and x = 140, so
  // they cross at (140, -40). The other side's are y = 40 and x = 60, crossing
  // at (60, 40). Both are exact, with no rounding to argue about.
  function rightAngleSkeleton(defaultWidth = 80) {
    return {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false },
            { id: 3, x: 100, y: 0, type: null, smooth: false },
            { id: 4, x: 100, y: 100, type: null, smooth: false },
          ],
        },
      ],
      generated: [],
    };
  }

  function onCurvesOf(result) {
    return result.contours.flatMap((contour) =>
      contour.points.filter((point) => !point.type).map((p) => [p.x, p.y])
    );
  }

  function hasPoint(points, x, y) {
    return points.some(([px, py]) => Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1);
  }

  it("puts a right-angle corner where the two offset edges cross", () => {
    const points = onCurvesOf(generateFromSkeleton(rightAngleSkeleton()));
    expect(hasPoint(points, 140, -40), "outer corner at (140, -40)").to.be.true;
    expect(hasPoint(points, 60, 40), "inner corner at (60, 40)").to.be.true;
  });

  it("moves the corner in proportion to the stroke width", () => {
    // Half-width 20: the edges are y = -20 and x = 120, crossing at (120, -20).
    const points = onCurvesOf(generateFromSkeleton(rightAngleSkeleton(40)));
    expect(hasPoint(points, 120, -20), "outer corner at (120, -20)").to.be.true;
    expect(hasPoint(points, 80, 20), "inner corner at (80, 20)").to.be.true;
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: both tests FAIL. The corner sits at about (128, -28) and (72, 28) today, which is one
half-width out instead of 1.41 half-widths.

- [ ] **Step 3: Rename the function and give it the distance**

In `skeleton-generator.js`, replace `calculateCornerNormal` (line 2912) with:

```js
/**
 * The join at a corner between two arms.
 *
 * `normal` is the unit normal on the line that splits the angle between the two
 * arms. `miterScale` is how many half-widths along that line the two offset
 * edges of one side actually cross at. It is one over the cosine of half the
 * turn, and it is Infinity where the two arms are exactly parallel, which is a
 * centerline folded back on itself.
 */
function calculateCornerJoin(segment1, segment2) {
  // Get outgoing tangent from segment1 at its endpoint
  let dir1;
  if (segment1.controlPoints.length === 0) {
    dir1 = vector.normalizeVector(
      vector.subVectors(segment1.endPoint, segment1.startPoint)
    );
  } else {
    const bezier1 = createBezierFromPoints([
      segment1.startPoint,
      ...segment1.controlPoints,
      segment1.endPoint,
    ]);
    const deriv1 = bezier1.derivative(1);
    dir1 = vector.normalizeVector({ x: deriv1.x, y: deriv1.y });
  }

  // Get incoming tangent from segment2 at its start point
  let dir2;
  if (segment2.controlPoints.length === 0) {
    dir2 = vector.normalizeVector(
      vector.subVectors(segment2.endPoint, segment2.startPoint)
    );
  } else {
    const bezier2 = createBezierFromPoints([
      segment2.startPoint,
      ...segment2.controlPoints,
      segment2.endPoint,
    ]);
    const deriv2 = bezier2.derivative(0);
    dir2 = vector.normalizeVector({ x: deriv2.x, y: deriv2.y });
  }

  const dot = dir1.x * dir2.x + dir1.y * dir2.y;
  const cross = dir1.x * dir2.y - dir1.y * dir2.x;
  const angle = Math.atan2(cross, dot);

  const halfAngle = angle / 2;
  const cosH = Math.cos(halfAngle);
  const sinH = Math.sin(halfAngle);
  const bisector = {
    x: dir1.x * cosH - dir1.y * sinH,
    y: dir1.x * sinH + dir1.y * cosH,
  };

  // Each arm's edge is the arm offset sideways by the half-width. It ends
  // square to that arm's own direction, so the two edge ends are at two
  // different places. Carried on along their own arms' directions they meet
  // on the split line, one half-width over the cosine of half the turn out.
  // Placing the point at a plain half-width is what left the corner open.
  const cosHalfTurn = Math.abs(cosH);
  const miterScale = cosHalfTurn > 0 ? 1 / cosHalfTurn : Infinity;

  return { normal: { x: bisector.y, y: -bisector.x }, miterScale };
}
```

- [ ] **Step 4: Give `projectPoint` a scale**

At line 2344, replace the local `projectPoint` with:

```js
const projectPoint = (basePoint, normal, halfWidth, sign, miterScale = 1) => {
  if (isCollapsedSide(halfWidth)) {
    return { x: basePoint.x, y: basePoint.y };
  }
  const reach = halfWidth * miterScale;
  return {
    x: Math.round(basePoint.x + sign * normal.x * reach),
    y: Math.round(basePoint.y + sign * normal.y * reach),
  };
};
```

- [ ] **Step 5: Update the four call sites**

Each of the four places that calls `calculateCornerNormal` now needs the scale as well as the
normal. The pattern at every one of them is the same. Where the code today reads:

```js
startNormal = calculateCornerNormal(prevSegment, segment, startLeftHW);
```

it becomes:

```js
({ normal: startNormal, miterScale: startMiterScale } = calculateCornerJoin(
  prevSegment,
  segment
));
```

Declare `let startMiterScale = 1;` and `let endMiterScale = 1;` beside the existing
`let startNormal` and `let endNormal`, so that a point which is not a corner keeps a scale of 1.

The four sites are at lines 2373, 2445, 2526 and 2539. Sites 2373 and 2445 are in the straight-arm
branch. Sites 2526 and 2539 are in the curved-arm branch. Both branches need the same change.

**The third argument goes away.** `calculateCornerNormal` was handed the half-width and never used
it. That is the reason the corner shape does not depend on the stroke width today.

**A rib angle lock forces the scale back to 1.** `getEffectiveNormal` runs after the join and can
replace the normal outright. When it does, both arms' edge ends land on the forced rib and there is
nothing to carry on to. So at each of the four sites, after the `getEffectiveNormal` call, add:

```js
if (startNormal !== joinNormal) {
  startMiterScale = 1;
}
```

where `joinNormal` is the normal the join returned, kept in a local so the comparison can be made.
Do the same for the end side.

- [ ] **Step 6: Pass the scale where the points are placed**

In the curved-arm branch the four `projectPoint` calls at about line 2553 become:

```js
const fixedStartLeft = projectPoint(
  segment.startPoint,
  startNormal,
  startLeftHW,
  1,
  startMiterScale
);
const fixedStartRight = projectPoint(
  segment.startPoint,
  startNormal,
  startRightHW,
  -1,
  startMiterScale
);
const fixedEndLeft = projectPoint(
  segment.endPoint,
  endNormal,
  endLeftHW,
  1,
  endMiterScale
);
const fixedEndRight = projectPoint(
  segment.endPoint,
  endNormal,
  endRightHW,
  -1,
  endMiterScale
);
```

Do the same for every `projectPoint` call in the straight-arm branch.

**Nothing else needs to change for the fit.** `fixedStartLeft` and its three siblings are handed to
`offsetCubicSide` as `q0` and `q3`, which is the endpoint the cubic must land on. The shape the
cubic must match comes from `p0`, `p1`, `p2`, `p3`, `d0` and `d3`, which are the skeleton points
and the half-widths and are untouched. So the solver fits the same true edge and lands on the new
endpoint, which is exactly what the design asks for.

- [ ] **Step 7: Run the new tests and confirm they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: PASS.

- [ ] **Step 8: Run the whole suite and read the failures**

Run: `cd src-js/fontra-core && npm test`

Expected: the golden-master fixtures fail, because every corner in them has moved. Nothing else
should fail. **Do not regenerate the fixtures yet.** Task 4 reviews them.

Write down which non-fixture tests failed, if any. A non-fixture failure means this task broke
something and must be understood before going on.

- [ ] **Step 9: Format and check**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-generator.js fontra-core/tests/test-skeleton-generator.js
node --check fontra-core/src/skeleton-generator.js
```

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "fix(skeleton): a corner sits where the two offset edges meet

calculateCornerNormal took the stroke width and never used it, so the corner
was placed one half-width out whatever the width and whatever the turn. The
edges cross at one half-width over the cosine of half the turn. It is now
calculateCornerJoin and returns that distance beside the direction it already
returned.

Golden masters move. They are reviewed in a later commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The miter limit and the fold-back

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js` — the four call sites from Task 1, the
  `shouldAddStart` and `shouldAddEnd` decisions at about lines 2363 and 2497, and
  `pointProvenance` at line 2842
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: `calculateCornerJoin(segment1, segment2)` from Task 1, returning
  `{ normal, miterScale }`.
- Produces: a corner past the limit emits two on-curve points on that side, each carrying
  `_provenance.arm` set to `"in"` or `"out"`. Nothing later in this plan reads that field. It
  exists so that a reader which needs one specific point of the two can name it.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("skeleton-generator corner meeting place")` block from Task 1:

```js
// Arms (0,0) -> (100,0) -> (0,10). The incoming direction is (1, 0) and the
// outgoing one is close to (-1, 0), so the turn is about 174 degrees and the
// meeting place is about 20 half-widths out. The limit is 2 full stroke
// widths, which is 4 half-widths when the two sides are equal, so this
// corner is well past it.
function foldingSkeleton(defaultWidth = 80) {
  return {
    version: 1,
    nextId: 5,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth,
        singleSided: null,
        points: [
          { id: 2, x: 0, y: 0, type: null, smooth: false },
          { id: 3, x: 100, y: 0, type: null, smooth: false },
          { id: 4, x: 0, y: 10, type: null, smooth: false },
        ],
      },
    ],
    generated: [],
  };
}

function cornerOnCurves(result, skeletonPointId, side) {
  return result.contours.flatMap((contour) =>
    contour.points.filter(
      (point) =>
        !point.type &&
        point._provenance?.skeletonPointId === skeletonPointId &&
        point._provenance?.side === side
    )
  );
}

it("holds the corner at two stroke widths and cuts across it", () => {
  const result = generateFromSkeleton(foldingSkeleton());
  const outer = cornerOnCurves(result, 3, "left").concat(
    cornerOnCurves(result, 3, "right")
  );
  // Nothing sits further than 2 full stroke widths from the skeleton point.
  for (const point of outer) {
    const reach = Math.hypot(point.x - 100, point.y - 0);
    expect(reach, `point at (${point.x}, ${point.y})`).to.be.at.most(2 * 80 + 1);
  }
});

it("gives that side two on-curve points, one per arm", () => {
  const result = generateFromSkeleton(foldingSkeleton());
  const left = cornerOnCurves(result, 3, "left");
  const right = cornerOnCurves(result, 3, "right");
  // The side past the limit has two. The other side still has one.
  const counts = [left.length, right.length].sort();
  expect(counts).to.deep.equal([1, 2]);
  const two = left.length === 2 ? left : right;
  expect(two.map((point) => point._provenance.arm).sort()).to.deep.equal(["in", "out"]);
});

it("leaves an ordinary corner with one on-curve point per side", () => {
  const result = generateFromSkeleton(rightAngleSkeleton());
  expect(cornerOnCurves(result, 3, "left")).to.have.lengthOf(1);
  expect(cornerOnCurves(result, 3, "right")).to.have.lengthOf(1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: the first two FAIL. The corner runs about 20 half-widths out and emits one point per
side. The third test should already PASS from Task 1.

- [ ] **Step 3: Decide the limit at each corner**

Add beside `calculateCornerJoin` in `skeleton-generator.js`:

```js
// How far a corner may reach from its skeleton point, as a multiple of the
// full stroke width there. Past this the two arms' edges are so nearly
// parallel that the place they meet is longer than the letter is tall, so the
// corner is cut straight across between the two arms' own edge ends instead.
// The drag that offsets an ordinary outline bevels at the same turn: it states
// the same number as four times the half-width.
const CORNER_MITER_LIMIT = 2;

/**
 * Whether a corner reaches its meeting place, and how far out that is.
 *
 * `reach` is the distance from the skeleton point to the meeting place, capped
 * at nothing. `bevelled` says the meeting place is out of bounds — past the
 * limit, or absent because the two arms are exactly parallel — and that side
 * must emit both arms' edge ends instead.
 */
function resolveCornerReach(miterScale, halfWidth, fullWidth) {
  const reach = halfWidth * miterScale;
  const bevelled = !Number.isFinite(reach) || reach > CORNER_MITER_LIMIT * fullWidth;
  return { reach, bevelled };
}
```

- [ ] **Step 4: Emit two points where the corner is bevelled**

At each of the four join sites, after the scale is known, compute for each side:

```js
const startFullWidth = startLeftHW + startRightHW;
const startLeftBevel = resolveCornerReach(
  startMiterScale,
  startLeftHW,
  startFullWidth
).bevelled;
const startRightBevel = resolveCornerReach(
  startMiterScale,
  startRightHW,
  startFullWidth
).bevelled;
```

and the same for the end side.

Today the corner's single on-curve is added by exactly one of the two arms, decided by
`shouldAddStart` and `shouldAddEnd`. A bevelled side needs both arms to add their own. So where a
side is bevelled:

- the arm that arrives adds its end on-curve, placed with a scale of 1, which is its own edge end;
- the arm that leaves adds its start on-curve, also with a scale of 1;
- the straight line between them is what the two on-curves already produce, because consecutive
  on-curves with no controls between them are a straight.

So `shouldAddStart` for the leaving arm becomes true at a bevelled corner even where it is false
today, and the scale used for that side's `projectPoint` becomes 1 rather than `miterScale`.

Both arms compute the same `miterScale` from the same pair of segments, so they agree on whether
the corner is bevelled with no state passed between them.

- [ ] **Step 5: Tell the two points apart**

In `pointProvenance` (line 2842), add an optional arm:

```js
function pointProvenance(sourcePoint, side, role, nudge = null, arm = null) {
  if (!sourcePoint?._sourcePointId || (side !== "left" && side !== "right")) {
    return undefined;
  }
  const provenance = { skeletonPointId: sourcePoint._sourcePointId, side, role };
  if (arm) {
    // Two on-curves of one side of one skeleton point, at a bevelled corner.
    // Without this they say exactly the same thing, and a reader that needs
    // one of the two cannot name it.
    provenance.arm = arm;
  }
  if (
    role === "onCurve" &&
    nudge &&
    (Math.abs(nudge.x) > 1e-9 || Math.abs(nudge.y) > 1e-9)
  ) {
    provenance.nudge = { x: nudge.x, y: nudge.y };
  }
  return provenance;
}
```

Pass `arm` through `buildGeneratedOnCurve` as a further optional argument, and give it `"in"` on
the arriving arm's on-curve and `"out"` on the leaving arm's, only where the corner is bevelled.

**A rib drag needs no change.** It moves every generated point whose provenance names its skeleton
point and side, so it moves both of the two together, which is correct.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: PASS, all five.

- [ ] **Step 7: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`

Expected: golden-master fixtures still fail from Task 1. Nothing else should newly fail.

- [ ] **Step 8: Format, check, commit**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-generator.js fontra-core/tests/test-skeleton-generator.js
node --check fontra-core/src/skeleton-generator.js
cd .. && git add .
git commit -m "feat(skeleton): a corner past two stroke widths is cut straight across

The meeting place runs to infinity as the centerline folds back on itself. Past
two stroke widths the corner emits both arms' own edge ends and the straight
between them. Each of those two records which arm it came from, because
otherwise the two say the same thing and nothing can name one of them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The rib bar is square to the arriving arm

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-model.js` — `calculateNormalAtSkeletonPoint` at line
  3235
- Test: `src-js/fontra-core/tests/test-skeleton-model.js`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks read.

**Why this task exists.** The rib bar keeps its present length, drawn at the stored half-width. The
outline's corner point has moved outward, so the bar no longer ends on the outline. Drawn on the
line that splits the angle it now points at nothing in particular. Square to the arriving arm it at
least states the width of the stroke arriving at that point.

**What must not change.** `calculateContourNormalAtPoint` in `offset-contour.js` is read by the
drag that offsets an ordinary hand-drawn outline. That is a different feature. The change belongs
in the skeleton's own wrapper, not in the shared function.

- [ ] **Step 1: Write the failing test**

Add to `test-skeleton-model.js`:

```js
describe("skeleton rib direction at a corner", () => {
  // (0,0) -> (100,0) -> (100,100). The arriving arm runs along +x, so its
  // normal is (0, -1). The split line's normal is about (0.707, -0.707).
  const contour = {
    id: 1,
    closed: false,
    defaultWidth: 80,
    singleSided: null,
    points: [
      { id: 2, x: 0, y: 0, type: null, smooth: false },
      { id: 3, x: 100, y: 0, type: null, smooth: false },
      { id: 4, x: 100, y: 100, type: null, smooth: false },
    ],
  };

  it("is square to the arriving arm, not to the split line", () => {
    const normal = calculateNormalAtSkeletonPoint(contour, 1);
    expect(normal.x).to.be.closeTo(0, 1e-9);
    expect(Math.abs(normal.y)).to.be.closeTo(1, 1e-9);
  });
});
```

Import `calculateNormalAtSkeletonPoint` from `@fontra/core/skeleton-model.js` at the top of the
file if it is not already imported.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js -g "rib direction at a corner"`

Expected: FAIL. `normal.x` comes back at about 0.707.

- [ ] **Step 3: Give the skeleton its own direction**

In `skeleton-model.js`, change `calculateNormalAtSkeletonPoint` (line 3235) so that at a corner it
takes the direction of the arriving arm rather than the shared split line. Leave every other case
alone: a smooth point, a straight-controlled smooth point and a contour end all keep the answer
they get today, because `calculateContourNormalAtPoint` already returns the right thing for them
and the outline's own points still sit on the rib there.

```js
export function calculateNormalAtSkeletonPoint(skeletonContour, pointIndexOrPointId) {
  const points = skeletonContour?.points || [];
  const pointIndex =
    pointIndexOrPointId >= 0 && pointIndexOrPointId < points.length
      ? pointIndexOrPointId
      : points.findIndex((point) => point.id === pointIndexOrPointId);
  const point = points[pointIndex];
  if (!point || point.type) {
    return calculateContourNormalAtPoint(points, skeletonContour?.closed, pointIndex);
  }
  // At a corner the outline's own points have moved out to where the two
  // offset edges meet, so the bar cannot end on the outline whatever direction
  // it takes. It states the width of the arriving stroke instead, which is one
  // rule at every point rather than a special case at corners.
  const normal =
    cornerArrivingNormal(points, skeletonContour?.closed, pointIndex) ??
    calculateContourNormalAtPoint(points, skeletonContour?.closed, pointIndex);
  return getEffectiveNormal(point, normal);
}
```

Write `cornerArrivingNormal` beside it. It returns the normal of the arriving arm where the point
is a corner, and `null` everywhere else so the existing answer stands:

```js
// The normal of the arm arriving at a corner. Null where the point is not a
// corner, so every other case keeps the answer it has today.
function cornerArrivingNormal(points, closed, pointIndex) {
  const point = points[pointIndex];
  const segments = buildContourSegments(points, closed);
  let incoming = null;
  let outgoing = null;
  for (const segment of segments) {
    if (segment.endPoint === point) incoming = segment;
    if (segment.startPoint === point) outgoing = segment;
  }
  if (!incoming || !outgoing) return null;
  if (isStraightControlledSmoothPoint(point, incoming, outgoing)) return null;
  if (isStraightControlledSmoothPoint(point, outgoing, incoming)) return null;
  if (point.smooth) return null;
  return rotateVector90CW(segmentEndDirection(incoming));
}
```

`buildContourSegments`, `segmentEndDirection`, `isStraightControlledSmoothPoint` and
`rotateVector90CW` all live in `offset-contour.js` and are already imported by `skeleton-model.js`.
Confirm each import before writing the function and add any that is missing. Do not copy any of
them: that is rail R-B.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js -g "rib direction at a corner"`

Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`

Expected: golden-master fixtures still fail from Task 1. Any other new failure names a reader of
the rib direction that was relying on the split line, and must be understood before going on.

- [ ] **Step 6: Format, check, commit**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-model.js fontra-core/tests/test-skeleton-model.js
node --check fontra-core/src/skeleton-model.js
cd .. && git add .
git commit -m "fix(skeleton): the rib bar squares to the arriving arm

A corner's outline points have moved out to where the offset edges meet, so no
direction puts the bar's ends on the outline. Square to the arriving arm it
states the width of the stroke arriving there. The shared normal in
offset-contour.js is untouched: the ordinary-outline offset drag reads it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Measure it, review the fixtures, write it down

**Files:**

- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json`
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`
- Modify: `docs/superpowers/FEATURE-MODEL.md`
- Modify: `docs/superpowers/BACKLOG.md`

**Interfaces:**

- Consumes: everything from Tasks 1 to 3.
- Produces: nothing.

- [ ] **Step 1: Write the three sweeps**

A sweep holds the geometry fixed, walks one input in fine steps, and measures the worst single-step
movement of any outline point against the step of the input that drove it. It is the test this area
needs: a per-configuration assertion has missed every fault in this module so far. Start every
sweep away from a degenerate configuration, because a sweep that starts at zero-length handles
reports its own first step as a large jump.

Add to `test-skeleton-generator.js`:

```js
describe("skeleton-generator corner sweeps", () => {
  // Worst distance any on-curve point moves between two neighbouring steps.
  function worstStep(makeSkeleton, from, to, steps) {
    let worst = 0;
    let previous = null;
    for (let i = 0; i <= steps; i++) {
      const value = from + ((to - from) * i) / steps;
      const points = generateFromSkeleton(makeSkeleton(value)).contours.flatMap(
        (contour) => contour.points.filter((point) => !point.type)
      );
      if (previous && previous.length === points.length) {
        for (let j = 0; j < points.length; j++) {
          worst = Math.max(
            worst,
            Math.hypot(points[j].x - previous[j].x, points[j].y - previous[j].y)
          );
        }
      }
      previous = points;
    }
    return worst;
  }

  function cornerAt(angleDegrees, defaultWidth = 80) {
    const radians = (angleDegrees * Math.PI) / 180;
    return {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 0, type: null, smooth: false },
            { id: 3, x: 100, y: 0, type: null, smooth: false },
            {
              id: 4,
              x: 100 + 100 * Math.cos(radians),
              y: 100 * Math.sin(radians),
              type: null,
              smooth: false,
            },
          ],
        },
      ],
      generated: [],
    };
  }

  it("moves smoothly as the corner turns, up to the limit", () => {
    // 20 to 140 degrees of turn in 240 steps, which is half a degree each. The
    // limit engages at about 151 degrees, so this sweep stays under it and
    // must not jump at all.
    const worst = worstStep((angle) => cornerAt(angle), 20, 140, 240);
    expect(worst).to.be.below(4);
  });

  it("moves smoothly as the stroke widens", () => {
    const worst = worstStep((width) => cornerAt(90, width), 20, 200, 180);
    expect(worst).to.be.below(4);
  });

  it("moves in proportion to the stroke width", () => {
    // Doubling the width doubles how far the corner sits from the skeleton
    // point. This is what the old code failed to do, because it was handed the
    // width and did not use it.
    const reachAt = (width) => {
      const points = generateFromSkeleton(cornerAt(90, width)).contours.flatMap(
        (contour) => contour.points.filter((point) => !point.type)
      );
      const corner = points.filter((point) => point._provenance?.skeletonPointId === 3);
      return Math.max(...corner.map((point) => Math.hypot(point.x - 100, point.y)));
    };
    expect(reachAt(160) / reachAt(80)).to.be.closeTo(2, 0.05);
  });
});
```

- [ ] **Step 2: Run the sweeps**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner sweeps"`

Expected: PASS. If the first sweep reports a jump, find which step it happened at and what the
outline did there before changing any threshold. A jump inside this range is a real fault, not a
tolerance to widen.

- [ ] **Step 3: Measure how far the fitted cubic departs from the true edge**

Write a throwaway script under the scratchpad directory, not in the repository. For a corner at
each of 30, 60, 90, 120 and 150 degrees, and at half-widths of 10, 30 and 60:

- generate the outline;
- take the cubic that ends at the corner on one side;
- sample it at 100 places;
- for each sample, measure the distance to the true edge of that arm, which is the arm offset
  sideways by that side's half-width;
- record the largest of those distances.

Report the largest number over the whole set, in font units. This number is the price of the
corner point reaching the meeting place. The fit is what keeps it small: the solver has a fixed
endpoint and two fixed directions and solves the two handle lengths to stay as close to the true
edge as it can.

- [ ] **Step 4: Review the moved golden masters**

Run: `cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js`

Then read the diff. Every moved point must be at a corner, and it must have moved outward along
the line that splits that corner's angle. A moved point that is not at a corner is a fault in Tasks
1 to 3 and must be understood before this is committed.

Write one sentence per moved fixture saying which corner moved and by how far.

- [ ] **Step 5: Write the numbers into the development log**

`DEVELOPMENT-LOG.md` has a section per feature. The corner belongs with the skeleton. Add a heading
under the corner rounding and caps section, and state:

- what the old construction did and that it ignored the stroke width it was given;
- the measured departure from Step 3;
- the worst single-step movement from each of the three sweeps;
- which golden fixtures moved and by how much;
- that the miter limit is 2 stroke widths and that the ordinary-outline offset drag bevels at the
  same turn.

The log's own rule is to edit, not to append. Delete anything the change made untrue.

- [ ] **Step 6: Correct the feature model**

`FEATURE-MODEL.md`, section 3 step 2, describes how a segment's endpoints are placed. It says the
endpoints stay at the exact construction rib positions. That is now false at a corner. State the
corner rule there in two sentences and say that the solver is unchanged, since the endpoint is a
separate input from the shape being matched.

Section 3 step 3 describes corner rounding. Add one sentence saying that rounding now starts from a
corner point further out than before, so rounded corners in drawings made before this change come
out different.

- [ ] **Step 7: Retire the backlog row**

`BACKLOG.md`, row **B4**. Delete the row from the table and delete its section. Add a line to the
order section at the foot saying B4 is done, so that the remaining rows still read correctly.

- [ ] **Step 8: Run everything**

```bash
cd src-js/fontra-core && npm test
cd .. && npx prettier --write fontra-core/tests/test-skeleton-generator.js
```

Expected: the whole suite passes, fixtures included.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "test(skeleton): sweep the corner rather than assert it

Three sweeps: the turn, the stroke width, and the proportion between the two.
Golden masters regenerated after every moved point was checked to be at a
corner and moved outward. The measured departure of the fitted cubic from the
true edge is in the development log.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Manual test matrix

**Files:** none. This task runs the editor and records what was seen.

`views-editor` has no test harness, so the editor half of this work is checked by hand. The rib
change in Task 3 is read by the rib gizmo, the rib drag, the snapping targets and the measure
readout. Run each row and record pass or fail beside it in the development log.

- [ ] **Step 1: Run the matrix**

| #   | What to do                                                                | What must happen                                                              |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Draw a skeleton with a right-angle corner. Look at the outline            | The corner closes. No thin spikes                                             |
| 2   | Drag the corner's rib gizmo                                               | The stroke gets wider and narrower. The gizmo stays under the cursor          |
| 3   | Widen the stroke at the corner                                            | The corner moves outward in proportion. The outline stays closed              |
| 4   | Drag the corner skeleton point through a fold-back and out the other side | The outline stays closed throughout. It may cut straight across near the fold |
| 5   | Switch corner rounding on at that point and change its distance           | The corner rounds. The rounding does not jump when it is first switched on    |
| 6   | Hold Q over the corner's rib                                              | The measurement reads the stroke width                                        |
| 7   | Drag another point near the corner's rib end with snapping on             | The rib end is a snap target and the drag snaps to it                         |
| 8   | Hold D and drag a point on an ordinary hand-drawn outline                 | The outline offsets exactly as it did before this work                        |

Row 8 is the check that `offset-contour.js` was left alone.

- [ ] **Step 2: Record the results in the development log and commit**

```bash
git add .
git commit -m "docs(skeleton): the corner's manual matrix, run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deferred

**The inner side takes the crossing of the two arms' directions, not of the two cubics.** The spec
allows the true crossing of the two emitted cubics on the inner side, cut back to it. That is more
exact and it costs a great deal more: each arm must first emit its own endpoint, a later pass must
find the crossing, and a root find between two cubics can return a different crossing from one
frame to the next while the designer drags. It also has to publish the uncut cubic on the inserted
point's provenance, or the curvature gizmo measures a curve nobody is looking at.

This plan uses the direction crossing on both sides, which is one formula, symmetric, and needs no
change to how the outline is assembled.

**Build the true crossing only if a measurement asks for it.** Task 4 Step 3 produces the number.
If the inner side's departure from the true edge is large enough to see, reopen this with that
number in hand. Do not build it on the argument that it is more correct.
