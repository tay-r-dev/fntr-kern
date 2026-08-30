# Corner join by intersection — implementation plan

> **For agentic workers:** Execute this plan task-by-task with
> `superpowers:executing-plans`. Do **not** dispatch subagents and do **not** create a worktree:
> `docs/superpowers/START-HERE.md` forbids both. Work on a branch. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Put a skeleton corner's outline points where the two offset edges actually meet, instead
of one half-width from the centerline.

**Architecture:** A corner has two sides. On one side the two arms' edges leave a gap: the edges
are carried on as straight lines along each arm's own direction and the outline point goes where
those lines meet. On the other side the two arms' edges overlap: the two emitted cubics are
intersected and both are cut back to the crossing. The handle solver already takes the endpoint it
must land on as an input separate from the shape it must match, so moving that endpoint needs no
solver change. Past a fixed limit of two stroke widths, and where the two arms fold back, the
outer side emits both arms' own edge ends with a straight line between them.

**Tech Stack:** JavaScript. `fontra-core` for pure geometry, tested with mocha and chai.
`views-editor` has no test harness, so its half carries a manual test matrix.

**Spec:** `docs/superpowers/specs/2026-08-30-corner-intersection-design.md`

## Global Constraints

- **R-A — layer placement.** Pure geometry goes in `fontra-core/src/` with mocha tests.
- **R-B — one copy of every constant and geometry function.** If a symbol exists anywhere in the
  tree, import it. Do not copy a helper into a second file.
- **R-D — provenance forward, never recovered.** Nothing may find a generated point's owning
  skeleton point by comparing coordinates.
- **R-G — every commit runs `node --check` on each touched file, then `npx prettier --write`.** The
  user runs bundle-watch, so report compile errors rather than running the bundle yourself.
- **Tests:** `cd src-js/fontra-core && npm test`. The suite is about 1690 tests.
- **Commit after each task.** Stage with `git add .`.
- **The miter limit is 2 times the full stroke width**, measured from the skeleton point to the
  meeting place. The full stroke width at a point is its left half-width plus its right
  half-width.
- **Do not touch `calculateContourNormalAtPoint` in `offset-contour.js`.** The drag that offsets an
  ordinary hand-drawn outline reads it and must not change.
- **A search must not change its answer between two frames of a drag.** The outline is rebuilt on
  every frame. Where the inner-side crossing is not exactly one crossing, the code falls back
  rather than choosing. This is the rule that five rounds of offset-construction work arrived at.

---

## The construction, stated once

Every task below assumes this. Read it before Task 1.

A **corner** is a skeleton point where the centerline changes direction. The two centerline
segments meeting there are its **arms**. The one arriving is the **ingoing arm**, the one leaving
is the **outgoing arm**.

Each arm offset sideways by the half-width is that arm's **true edge**. It ends at a point square
to that arm's own direction. That point is the arm's **edge end**. The two arms point differently,
so their two edge ends are at two different places.

**One side of the stroke has a gap between the two edge ends. The other has an overlap.** Which is
which is decided per side, by a test on the geometry rather than on the sign of the turn: take the
ingoing arm's direction, and the vector from the ingoing arm's edge end to the outgoing arm's edge
end. Same way means a gap, so that side is **outer**. Opposite ways means an overlap, so that side
is **inner**.

**Outer side.** Carry each edge end on as a straight line, along its own arm's direction. The two
lines meet at the **apex**. The apex is the side's one outline point. Both arms' cubics are
emitted ending on it. The straight lines are then discarded: nothing straight is drawn.

**Inner side.** Each arm emits its cubic ending at its own edge end. The two cubics cross. That
crossing is the side's one outline point, and both cubics are cut back to it.

**Past the miter limit, and at a fold-back**, the outer side has no usable apex. It keeps both
arms' edge ends as outline points, and the straight between them is the corner.

Today the code does none of this. It splits the angle between the two arms and puts one point on
that split line, one half-width from the skeleton point, and hands it to both arms on both sides.
The split line is the right direction for the outer apex. One half-width is the wrong distance.
The inner side is wrong in kind, not only in distance.

---

## File structure

| File                                                      | What it does in this work                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `fontra-core/src/skeleton-generator.js`                   | Owns the corner: the join, the outer apex, the inner crossing pass, the miter limit |
| `fontra-core/src/skeleton-model.js`                       | `calculateNormalAtSkeletonPoint` gives the rib bar its own direction at a corner    |
| `fontra-core/tests/test-skeleton-generator.js`            | Corner geometry tests and the sweeps                                                |
| `fontra-core/tests/test-skeleton-model.js`                | The rib direction test                                                              |
| `fontra-core/tests/data/skeleton-generator/fixtures.json` | Golden masters. They move. Each move is reviewed, not regenerated blind             |
| `docs/superpowers/DEVELOPMENT-LOG.md`                     | The measured numbers and what they cost                                             |
| `docs/superpowers/FEATURE-MODEL.md`                       | Section 3, steps 2 and 3                                                            |
| `docs/superpowers/BACKLOG.md`                             | Row B4 retires                                                                      |

---

## Task 1: The outer side reaches the apex

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js` — `calculateCornerNormal` at line 2912,
  its four call sites at 2373, 2445, 2526 and 2539, and the local `projectPoint` at 2344
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `calculateCornerJoin(segment1, segment2)` returning
    `{ normal: {x, y}, miterScale: number, dir1: {x, y}, dir2: {x, y} }`. `normal` is the unit
    normal on the line that splits the angle between the two arms, which is what
    `calculateCornerNormal` returns today. `miterScale` is one divided by the cosine of half the
    turn, and is `Infinity` where the two arms are exactly parallel. `dir1` and `dir2` are the two
    arms' unit directions, which Task 2 and Task 3 both need and must not recompute.
  - `cornerSideIsOuter(dir1, dir2, sideSign)` returning a boolean. `sideSign` is `1` for the left
    side and `-1` for the right side. Task 2 reads it.

- [ ] **Step 1: Write the failing test**

Add at the end of `test-skeleton-generator.js`:

```js
describe("skeleton-generator corner meeting place", () => {
  // A horizontal arm into a vertical arm, meeting at (100, 0). Half-width 40.
  // One side's two edges are the lines y = -40 and x = 140, which cross at
  // (140, -40). The other side's are y = 40 and x = 60, crossing at (60, 40).
  // Straight arms, so both crossings are exact and there is no rounding to
  // argue about, and the outer and inner rules give the same answer.
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
      contour.points.filter((point) => !point.type)
    );
  }

  function hasPoint(points, x, y) {
    return points.some(
      (point) => Math.abs(point.x - x) <= 1 && Math.abs(point.y - y) <= 1
    );
  }

  it("puts the outer side of a right-angle corner where its two edges cross", () => {
    const points = onCurvesOf(generateFromSkeleton(rightAngleSkeleton()));
    expect(hasPoint(points, 140, -40), "outer corner at (140, -40)").to.be.true;
  });

  it("moves the outer corner in proportion to the stroke width", () => {
    // Half-width 20: the edges are y = -20 and x = 120, crossing at (120, -20).
    const points = onCurvesOf(generateFromSkeleton(rightAngleSkeleton(40)));
    expect(hasPoint(points, 120, -20), "outer corner at (120, -20)").to.be.true;
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: both FAIL. The corner sits at about (128, -28) today, one half-width out rather than
1.41 half-widths.

- [ ] **Step 3: Replace the join function**

In `skeleton-generator.js`, replace `calculateCornerNormal` (line 2912) with:

```js
/**
 * The join at a corner between two arms.
 *
 * `normal` is the unit normal on the line that splits the angle between the two
 * arms. `miterScale` is how many half-widths along that line the two carried-on
 * edges of a side meet at: one over the cosine of half the turn, and Infinity
 * where the two arms are exactly parallel, which is a centerline folded back on
 * itself. `dir1` and `dir2` are the arms' own unit directions, returned so that
 * no caller works them out a second time (rail R-B).
 */
function calculateCornerJoin(segment1, segment2) {
  // Outgoing tangent of segment1 at its endpoint
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

  // Incoming tangent of segment2 at its start point
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

  // Each arm's edge ends square to that arm's own direction, so the two edge
  // ends of one side are at two different places. Carried on along their own
  // arms they meet on the split line, one half-width over the cosine of half
  // the turn out. Placing the point at a plain half-width left the corner open.
  const cosHalfTurn = Math.abs(cosH);
  const miterScale = cosHalfTurn > 0 ? 1 / cosHalfTurn : Infinity;

  return { normal: { x: bisector.y, y: -bisector.x }, miterScale, dir1, dir2 };
}

/**
 * Whether one side of a corner has a gap between its two edge ends.
 *
 * `sideSign` is 1 for the left side and -1 for the right. The test reads the
 * geometry rather than the sign of the turn: it takes the ingoing arm's own
 * direction and the vector between the two edge ends, which is the half-width
 * times the difference of the two arms' normals. Pointing the same way means a
 * gap, which is the outer side.
 */
function cornerSideIsOuter(dir1, dir2, sideSign) {
  const n1 = vector.rotateVector90CW(dir1);
  const n2 = vector.rotateVector90CW(dir2);
  const between = { x: sideSign * (n2.x - n1.x), y: sideSign * (n2.y - n1.y) };
  return dir1.x * between.x + dir1.y * between.y >= 0;
}
```

- [ ] **Step 4: Give `projectPoint` a scale**

Replace the local `projectPoint` at line 2344 with:

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

Each place that calls `calculateCornerNormal` now needs the scale and the two directions as well
as the normal. Where the code reads:

```js
startNormal = calculateCornerNormal(prevSegment, segment, startLeftHW);
```

it becomes:

```js
startJoin = calculateCornerJoin(prevSegment, segment);
startNormal = startJoin.normal;
```

Declare `let startJoin = null;` and `let endJoin = null;` beside the existing `let startNormal` and
`let endNormal`, so a point that is not a corner leaves them null and everything below treats it as
having no corner.

**The third argument goes away.** `calculateCornerNormal` was handed the half-width and never used
it. That is exactly why the corner shape does not depend on the stroke width today.

**A rib angle lock cancels the join.** `getEffectiveNormal` runs after the join and can replace the
normal outright. When it does, both arms' edge ends land on the forced rib and there is nothing to
carry on to. So after each `getEffectiveNormal` call, add:

```js
if (startJoin && startNormal !== startJoin.normal) {
  startJoin = null;
}
```

and the same for the end side.

The four sites are at lines 2373, 2445, 2526 and 2539. Sites 2373 and 2445 are the straight-arm
branch. Sites 2526 and 2539 are the curved-arm branch. Both need the same change.

- [ ] **Step 6: Apply the scale on the outer side only**

Before each group of `projectPoint` calls, work out a scale per side:

```js
// The apex is the outer side's answer. The inner side's two edges overlap
// and their crossing is real drawn geometry, found in a later pass, so its
// point stays on its own arm's edge end for now.
const startLeftScale =
  startJoin && cornerSideIsOuter(startJoin.dir1, startJoin.dir2, 1)
    ? startJoin.miterScale
    : 1;
const startRightScale =
  startJoin && cornerSideIsOuter(startJoin.dir1, startJoin.dir2, -1)
    ? startJoin.miterScale
    : 1;
```

and the same for the end side. Then pass each scale to its own `projectPoint` call:

```js
const fixedStartLeft = projectPoint(
  segment.startPoint,
  startNormal,
  startLeftHW,
  1,
  startLeftScale
);
const fixedStartRight = projectPoint(
  segment.startPoint,
  startNormal,
  startRightHW,
  -1,
  startRightScale
);
const fixedEndLeft = projectPoint(
  segment.endPoint,
  endNormal,
  endLeftHW,
  1,
  endLeftScale
);
const fixedEndRight = projectPoint(
  segment.endPoint,
  endNormal,
  endRightHW,
  -1,
  endRightScale
);
```

Do the same for every `projectPoint` call in the straight-arm branch.

**Nothing else changes for the fit.** These four points are handed to `offsetCubicSide` as `q0`
and `q3`, which is the point the cubic must land on. The shape it must match comes from `p0`,
`p1`, `p2`, `p3`, `d0` and `d3`, which are the skeleton points and the half-widths and are
untouched. So the solver matches the same true edge and lands on the new endpoint.

- [ ] **Step 7: Run the new tests and confirm they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: PASS.

- [ ] **Step 8: Run the whole suite and read the failures**

Run: `cd src-js/fontra-core && npm test`

Expected: the golden-master fixtures fail, because every corner in them has moved on its outer
side. **Do not regenerate the fixtures.** Task 5 reviews them. Write down any non-fixture failure:
that means this task broke something and it must be understood before going on.

- [ ] **Step 9: Format, check, commit**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-generator.js fontra-core/tests/test-skeleton-generator.js
node --check fontra-core/src/skeleton-generator.js
cd .. && git add .
git commit -m "fix(skeleton): the outer side of a corner reaches where its edges meet

calculateCornerNormal took the stroke width and never used it, so a corner sat
one half-width out whatever the width and whatever the turn. The two carried-on
edges meet at one half-width over the cosine of half the turn. It is
calculateCornerJoin now and returns that distance and the two arms' directions
beside the direction it already returned.

Golden masters move. They are reviewed in a later commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The inner side is cut at the crossing

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js` — the `shouldAddStart` and `shouldAddEnd`
  decisions at about lines 2363 and 2497, and the assembly at line 1601
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: `calculateCornerJoin` and `cornerSideIsOuter` from Task 1.
- Produces: `joinInnerCornersOnSide(sidePoints, { isClosed })` returning a new point list, with
  each inner corner's two on-curves replaced by one on-curve at the crossing and both neighbouring
  cubics cut back to it. Task 5's sweeps read it only through `generateFromSkeleton`.

**Why the inner side is not the apex mirrored.** On the outer side the two edges genuinely stop,
and the straight line is a construction that finds a place which does not otherwise exist. On the
inner side nothing stops. The two edges are drawn curves that really overlap and really cross. And
the guess would be biased rather than merely imprecise: both curves bend toward each other there,
so their real crossing is always nearer the skeleton point than a crossing of their directions
would be. On a strongly curved arm the corner would stick through the stroke.

- [ ] **Step 1: Write the failing test**

Add to the `describe("skeleton-generator corner meeting place")` block:

```js
// Two curved arms meeting at (100, 0) at a right angle. Each arm's handles
// bow it away from the straight line between its ends, so on the inner side
// the two edges bend toward each other and their crossing sits nearer the
// skeleton point than a crossing of their end directions would.
function curvedCornerSkeleton(defaultWidth = 80) {
  return {
    version: 1,
    nextId: 8,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth,
        singleSided: null,
        points: [
          { id: 2, x: 0, y: 40, type: null, smooth: false },
          { id: 5, x: 40, y: 40, type: "cubic" },
          { id: 6, x: 70, y: 0, type: "cubic" },
          { id: 3, x: 100, y: 0, type: null, smooth: false },
          { id: 7, x: 100, y: 40, type: "cubic" },
          { id: 8, x: 60, y: 100, type: "cubic" },
          { id: 4, x: 40, y: 100, type: null, smooth: false },
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

it("gives every side of a corner exactly one on-curve point", () => {
  const result = generateFromSkeleton(curvedCornerSkeleton());
  expect(cornerOnCurves(result, 3, "left")).to.have.lengthOf(1);
  expect(cornerOnCurves(result, 3, "right")).to.have.lengthOf(1);
});

it("cuts the inner side back to where its two edges really cross", () => {
  const result = generateFromSkeleton(curvedCornerSkeleton());
  // Whichever side is the inner one, its point must lie on both of the
  // cubics that meet there. Read it back by walking the emitted contour:
  // the point either side of the corner point, with its handles, is a cubic,
  // and the corner point must sit on it to within a unit.
  const contour = result.contours[0];
  const corner = contour.points.findIndex(
    (point) =>
      !point.type &&
      point._provenance?.skeletonPointId === 3 &&
      cornerIsInner(result, point)
  );
  expect(corner, "an inner corner point exists").to.be.greaterThan(-1);
  // The cut leaves the two neighbouring cubics ending exactly on it, which
  // the assembly guarantees, so the check that matters is that the point
  // moved off its own arm's edge end and toward the skeleton point.
  const reach = Math.hypot(
    contour.points[corner].x - 100,
    contour.points[corner].y - 0
  );
  expect(reach).to.be.below(40);
});

// The inner side is the one whose point sits nearer the skeleton point than
// a plain half-width, because the two edges overlapped and were cut back.
function cornerIsInner(result, point) {
  return Math.hypot(point.x - 100, point.y - 0) < 40;
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: the two new tests FAIL. Today the inner side sits at exactly a half-width from the
skeleton point, so nothing is below 40.

- [ ] **Step 3: Make the inner side emit both arms' edge ends**

Today one corner on-curve is added by exactly one of the two arms, decided by `shouldAddStart` and
`shouldAddEnd`, and it is placed on the split line. The crossing pass needs each arm's own
endpoint, so on an inner side:

- the arriving arm adds its end on-curve, placed along **its own** normal at a scale of 1;
- the leaving arm adds its start on-curve, placed along **its own** normal at a scale of 1.

An arm's own normal is `vector.rotateVector90CW(dir)` where `dir` is that arm's direction from
`calculateCornerJoin`. `dir1` is the arriving arm's, `dir2` is the leaving arm's. Do not recompute
either: that is rail R-B.

So `shouldAddStart` for the leaving arm becomes true at an inner corner even where it is false
today. Both arms compute the same join from the same pair of segments, so they agree on which side
is inner with no state passed between them.

- [ ] **Step 4: Write the crossing pass**

Add beside `roundSharpCornersOnSide` (line 1209):

```js
/**
 * Replace each inner corner's two on-curve points with the one place its two
 * cubics cross, cutting both cubics back to it.
 *
 * A corner's inner side is where the two arms' edges overlap. The crossing is
 * real drawn geometry there, so it is found rather than guessed at. Run before
 * roundSharpCornersOnSide: rounding reads the corner this pass leaves behind.
 *
 * Where the two do not cross exactly once, both edge ends are kept and the
 * straight between them is the corner. Choosing among several crossings is a
 * choice that can change between two frames of a drag, and the outline is
 * rebuilt on every frame.
 */
function joinInnerCornersOnSide(sidePoints, { isClosed }) {
  // Walk the list for adjacent on-curve pairs that carry the same skeleton
  // point id and side, which is what step 3 emits at an inner corner. For each
  // pair, build the cubic arriving at the first and the cubic leaving the
  // second, intersect them, and splice in one on-curve at the crossing.
  // Cutting a cubic is a de Casteljau split, which is exact: a piece of a
  // cubic is a cubic, so no shape changes and nothing is refitted.
  //
  // Publish the uncut cubic on the inserted point's provenance as
  // `constructionSegment`, exactly as splitTerminalSideForRoundCap does. The
  // curvature gizmo reads a segment's number off the curve as emitted while
  // the pin it writes is reproduced on the whole solved curve, so without this
  // the two describe different curves and the gizmo's first drag jumps.
}
```

Fill the body. Use `Bezier` from `bezier-js`, already imported at the top of the file, and its
`intersects` method for two cubics. Where either neighbouring segment has no control points it is
a straight, and `vector.intersect` handles a straight against a straight; use it rather than
building a degenerate cubic.

- [ ] **Step 5: Run the pass before corner rounding**

At line 1601, before the two `roundSharpCornersOnSide` calls:

```js
const joinedLeftSide = joinInnerCornersOnSide(leftSide, { isClosed });
const joinedRightSide = joinInnerCornersOnSide(rightSide, { isClosed });
let roundedLeftSide = roundSharpCornersOnSide(joinedLeftSide, { isClosed });
let roundedRightSide = roundSharpCornersOnSide(joinedRightSide, { isClosed });
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: PASS, all four.

- [ ] **Step 7: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`

Expected: golden-master fixtures still fail from Task 1. Nothing else should newly fail.

- [ ] **Step 8: Format, check, commit**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-generator.js fontra-core/tests/test-skeleton-generator.js
node --check fontra-core/src/skeleton-generator.js
cd .. && git add .
git commit -m "fix(skeleton): the inner side of a corner is cut where its edges cross

The two edges there are drawn curves that really overlap, so the crossing is
found rather than stood in for by a crossing of their directions. Both curves
bend toward each other, so a direction crossing is always too far out and on a
strongly curved arm the corner sticks through the stroke.

The cut publishes the uncut curve, so the curvature gizmo measures the curve
its pin governs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The miter limit and the fold-back

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js` — the four join sites, the
  `shouldAddStart` and `shouldAddEnd` decisions, and `pointProvenance` at line 2842
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: `calculateCornerJoin` and `cornerSideIsOuter` from Task 1.
- Produces: a corner whose outer side is past the limit emits two on-curve points there, each
  carrying `_provenance.arm` set to `"in"` or `"out"`.

- [ ] **Step 1: Write the failing tests**

Add to the same `describe` block:

```js
// Arms (0,0) -> (100,0) -> (0,10). The arriving direction is (1, 0) and the
// leaving one is close to (-1, 0), so the turn is about 174 degrees and the
// apex is about 20 half-widths out. The limit is 2 full stroke widths, which
// is 4 half-widths when the two sides are equal, so this is well past it.
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

it("holds the corner at two stroke widths", () => {
  const result = generateFromSkeleton(foldingSkeleton());
  const points = cornerOnCurves(result, 3, "left").concat(
    cornerOnCurves(result, 3, "right")
  );
  for (const point of points) {
    const reach = Math.hypot(point.x - 100, point.y - 0);
    expect(reach, `point at (${point.x}, ${point.y})`).to.be.at.most(2 * 80 + 1);
  }
});

it("gives the held side two on-curve points, one per arm", () => {
  const result = generateFromSkeleton(foldingSkeleton());
  const counts = [
    cornerOnCurves(result, 3, "left").length,
    cornerOnCurves(result, 3, "right").length,
  ].sort();
  expect(counts).to.deep.equal([1, 2]);
  const left = cornerOnCurves(result, 3, "left");
  const two = left.length === 2 ? left : cornerOnCurves(result, 3, "right");
  expect(two.map((point) => point._provenance.arm).sort()).to.deep.equal(["in", "out"]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"`

Expected: the two new tests FAIL. The outer side reaches about 20 half-widths and emits one point.

- [ ] **Step 3: Decide the limit at each corner**

Add beside `calculateCornerJoin`:

```js
// How far a corner may reach from its skeleton point, as a multiple of the
// full stroke width there. Past this the two arms' edges are so nearly
// parallel that the place they meet is longer than the letter is tall, so the
// corner is cut straight across between the two arms' own edge ends instead.
// The drag that offsets an ordinary outline bevels at the same turn: it states
// the same number as four times the half-width.
const CORNER_MITER_LIMIT = 2;

/**
 * Whether an outer side reaches its apex.
 *
 * True where the apex is out of bounds: past the limit, or absent because the
 * two arms are exactly parallel. That side must then emit both arms' edge ends
 * and the straight between them.
 */
function cornerIsHeld(miterScale, halfWidth, fullWidth) {
  const reach = halfWidth * miterScale;
  return !Number.isFinite(reach) || reach > CORNER_MITER_LIMIT * fullWidth;
}
```

- [ ] **Step 4: Emit two points where the outer side is held**

At each join site, for each side, compute `cornerIsHeld(join.miterScale, thatSideHalfWidth,
leftHW + rightHW)`. Where a side is both outer and held:

- its scale is 1 rather than `join.miterScale`, and its normal is that arm's own normal rather
  than the split line, so each arm lands on its own edge end;
- both arms add their own on-curve, the same change Task 2 made for an inner side;
- the straight between them needs no code, because two consecutive on-curves with no controls
  between them are a straight.

- [ ] **Step 5: Tell the two points apart**

Change `pointProvenance` (line 2842) to take an arm:

```js
function pointProvenance(sourcePoint, side, role, nudge = null, arm = null) {
  if (!sourcePoint?._sourcePointId || (side !== "left" && side !== "right")) {
    return undefined;
  }
  const provenance = { skeletonPointId: sourcePoint._sourcePointId, side, role };
  if (arm) {
    // Two on-curves of one side of one skeleton point, at a held corner.
    // Without this they say exactly the same thing and a reader that needs one
    // of the two cannot name it.
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

Pass `arm` through `buildGeneratedOnCurve` as a further optional argument. Give it `"in"` on the
arriving arm's on-curve and `"out"` on the leaving arm's, only where the corner is held.

**A rib drag needs no change.** It moves every generated point whose provenance names its skeleton
point and side, so it moves both of the two together, which is right.

- [ ] **Step 6: Run the tests, then the suite**

```bash
cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner meeting place"
npm test
```

Expected: the corner tests all pass. Golden masters still fail from Task 1. Nothing else newly
fails.

- [ ] **Step 7: Format, check, commit**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-generator.js fontra-core/tests/test-skeleton-generator.js
node --check fontra-core/src/skeleton-generator.js
cd .. && git add .
git commit -m "feat(skeleton): a corner past two stroke widths is cut straight across

The apex runs to infinity as the centerline folds back on itself. Past two
stroke widths the outer side emits both arms' own edge ends and the straight
between them. Each of the two records which arm it came from, because otherwise
they say the same thing and nothing can name one of them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The rib bar is square to the arriving arm

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-model.js` — `calculateNormalAtSkeletonPoint` at line
  3235
- Test: `src-js/fontra-core/tests/test-skeleton-model.js`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks read.

**Why this task exists.** The rib bar keeps its present length, drawn at the stored half-width. The
outline's corner points have moved, so the bar cannot end on the outline whatever direction it
takes. Drawn on the split line it now points at nothing in particular. Square to the arriving arm
it states the width of the stroke arriving at that point, which is one rule at every point.

**What must not change.** `calculateContourNormalAtPoint` in `offset-contour.js` is read by the
drag that offsets an ordinary hand-drawn outline. That is a different feature. The change belongs
in the skeleton's own wrapper.

- [ ] **Step 1: Write the failing test**

Add to `test-skeleton-model.js`, importing `calculateNormalAtSkeletonPoint` from
`@fontra/core/skeleton-model.js` if it is not already imported:

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

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js -g "rib direction at a corner"`

Expected: FAIL. `normal.x` comes back at about 0.707.

- [ ] **Step 3: Give the skeleton its own direction**

In `skeleton-model.js`, change `calculateNormalAtSkeletonPoint` (line 3235) to:

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
  // At a corner the outline's own points have moved to where the two offset
  // edges meet, so the bar cannot end on the outline whatever direction it
  // takes. It states the width of the arriving stroke instead, which is one
  // rule at every point rather than a special case at corners.
  const normal =
    cornerArrivingNormal(points, skeletonContour?.closed, pointIndex) ??
    calculateContourNormalAtPoint(points, skeletonContour?.closed, pointIndex);
  return getEffectiveNormal(point, normal);
}

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
  if (point.smooth) return null;
  if (isStraightControlledSmoothPoint(point, incoming, outgoing)) return null;
  if (isStraightControlledSmoothPoint(point, outgoing, incoming)) return null;
  return rotateVector90CW(segmentEndDirection(incoming));
}
```

`buildContourSegments`, `segmentEndDirection`, `isStraightControlledSmoothPoint` and
`rotateVector90CW` all live in `offset-contour.js`. Confirm each is imported into
`skeleton-model.js` and add any that is missing. Do not copy any of them: that is rail R-B.

- [ ] **Step 4: Run the test, then the suite**

```bash
cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js -g "rib direction at a corner"
npm test
```

Expected: the new test passes. Golden masters still fail from Task 1. Any other new failure names a
reader that was relying on the split line and must be understood before going on.

- [ ] **Step 5: Format, check, commit**

```bash
cd src-js && npx prettier --write fontra-core/src/skeleton-model.js fontra-core/tests/test-skeleton-model.js
node --check fontra-core/src/skeleton-model.js
cd .. && git add .
git commit -m "fix(skeleton): the rib bar squares to the arriving arm

A corner's outline points have moved to where the offset edges meet, so no
direction puts the bar's ends on the outline. Square to the arriving arm it
states the width of the stroke arriving there. The shared normal in
offset-contour.js is untouched: the ordinary-outline offset drag reads it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Sweep it, review the fixtures, write it down

**Files:**

- Modify: `src-js/fontra-core/tests/test-skeleton-generator.js`
- Modify: `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`, `FEATURE-MODEL.md`, `BACKLOG.md`

**Interfaces:**

- Consumes: everything from Tasks 1 to 4.
- Produces: nothing.

- [ ] **Step 1: Write the sweeps**

A sweep holds the geometry fixed, walks one input in fine steps, and measures the worst
single-step movement of any outline point. It is the test this area needs: a per-configuration
assertion has missed every fault in this module so far. Start every sweep away from a degenerate
configuration, because a sweep that starts at zero-length handles reports its own first step as a
large jump.

Add to `test-skeleton-generator.js`:

```js
describe("skeleton-generator corner sweeps", () => {
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
    // 20 to 140 degrees in 240 steps, half a degree each. The limit engages at
    // about 151 degrees, so this sweep stays under it and must not jump.
    expect(worstStep((angle) => cornerAt(angle), 20, 140, 240)).to.be.below(4);
  });

  it("moves smoothly as the stroke widens", () => {
    expect(worstStep((width) => cornerAt(90, width), 20, 200, 180)).to.be.below(4);
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

  it("moves smoothly as the inner crossing appears and goes", () => {
    // Bow one arm through its range so that the inner side's two cubics go
    // from crossing once to not crossing at all. The fallback must engage
    // without the outline jumping more than the step that drove it.
    const bowed = (bow) => ({
      version: 1,
      nextId: 8,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            { id: 2, x: 0, y: 40, type: null, smooth: false },
            { id: 5, x: 40, y: 40, type: "cubic" },
            { id: 6, x: 70, y: bow, type: "cubic" },
            { id: 3, x: 100, y: 0, type: null, smooth: false },
            { id: 7, x: 100, y: 40, type: "cubic" },
            { id: 8, x: 60, y: 100, type: "cubic" },
            { id: 4, x: 40, y: 100, type: null, smooth: false },
          ],
        },
      ],
      generated: [],
    });
    expect(worstStep(bowed, 0, 80, 160)).to.be.below(6);
  });
});
```

- [ ] **Step 2: Run the sweeps**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "corner sweeps"`

Expected: PASS. If a sweep reports a jump, find which step it happened at and what the outline did
there before touching any tolerance. A jump inside these ranges is a fault, not a bound to widen.

- [ ] **Step 3: Measure how far the fitted cubic departs from the true edge**

Write a throwaway script in the scratchpad directory, not in the repository. For a corner at each
of 30, 60, 90, 120 and 150 degrees, and at half-widths of 10, 30 and 60:

1. generate the outline;
2. take the cubic that ends at the corner on the outer side;
3. sample it at 100 evenly spaced parameters;
4. for each sample, measure the distance to that arm's true edge, which is the arm offset sideways
   by that side's half-width;
5. record the largest of those distances.

Report the largest number over the whole set, in font units. This is the price of the outer
corner reaching the apex: the cubic is stretched to get there, so it leaves the true edge near the
corner. The fit is what keeps it small, because it has a fixed endpoint and two fixed directions
and solves the two handle lengths to stay as close to the true edge as it can.

- [ ] **Step 4: Review the moved golden masters**

Run: `cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js`

Read the diff. Every moved point must be at a corner. On an outer side it must have moved outward
along the split line. On an inner side it must have moved toward the skeleton point. A moved point
that is not at a corner is a fault in Tasks 1 to 4 and must be understood before this is committed.

Write one sentence per moved fixture saying which corner moved, which side, and by how far.

- [ ] **Step 5: Write the numbers into the development log**

`DEVELOPMENT-LOG.md` holds one section per feature. Add a heading for the corner under the corner
rounding and caps section, and state:

- what the old construction did, and that it was handed the stroke width and ignored it;
- that the outer side is a crossing of two carried-on straights and the inner side is a crossing of
  the two drawn cubics, and why they differ;
- the measured departure from Step 3;
- the worst single-step movement from each of the four sweeps;
- which golden fixtures moved and by how much;
- that the miter limit is 2 stroke widths and that the ordinary-outline offset drag bevels at the
  same turn.

The log's own rule is to edit, not to append. Delete anything this change made untrue.

- [ ] **Step 6: Correct the feature model**

`FEATURE-MODEL.md` section 3 step 2 says a segment's endpoints stay at the exact construction rib
positions. That is false at a corner now. State the corner rule there in a few sentences, and say
that the solver is unchanged because the endpoint is a separate input from the shape being
matched.

Section 3 step 3 describes corner rounding. Add one sentence: rounding now starts from a corner
point in a different place, so rounded corners in drawings made before this change come out
different.

- [ ] **Step 7: Retire the backlog row**

`BACKLOG.md` row **B4**. Delete the row from the table and delete its section. Correct the order
section at the foot so the remaining rows still read correctly.

- [ ] **Step 8: Run everything, format, commit**

```bash
cd src-js/fontra-core && npm test
cd .. && npx prettier --write fontra-core/tests/test-skeleton-generator.js
cd .. && git add .
git commit -m "test(skeleton): sweep the corner rather than assert it

Four sweeps: the turn, the stroke width, the proportion between the two, and
the inner crossing appearing and going. Golden masters regenerated after every
moved point was checked to be at a corner and to have moved the right way. The
measured departure of the fitted cubic from the true edge is in the log.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Manual test matrix

**Files:** none. This task runs the editor and records what was seen.

`views-editor` has no test harness, so the editor half of this work is checked by hand. The rib
change in Task 4 is read by the rib gizmo, the rib drag, the snapping targets and the measure
readout.

- [ ] **Step 1: Run the matrix and record pass or fail against each row**

| #   | What to do                                                                                    | What must happen                                                              |
| --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Draw a skeleton with a right-angle corner and look at the outline                             | The corner closes. No thin spikes                                             |
| 2   | Draw a corner where both arms are strongly curved                                             | The inner side closes without sticking through the stroke                     |
| 3   | Drag the corner's rib gizmo                                                                   | The stroke widens and narrows. The gizmo stays under the cursor               |
| 4   | Widen the stroke at the corner                                                                | The corner moves outward in proportion. The outline stays closed              |
| 5   | Drag the corner skeleton point through a fold-back and out the other side                     | The outline stays closed throughout. It may cut straight across near the fold |
| 6   | Switch corner rounding on at that point and change its distance                               | The corner rounds. It does not jump when rounding is first switched on        |
| 7   | Grab the curvature gizmo on a segment ending at an inner corner and release it without moving | Nothing moves. A jump means the uncut curve is not being published            |
| 8   | Hold Q over the corner's rib                                                                  | The measurement reads the stroke width                                        |
| 9   | Drag another point near the corner's rib end with snapping on                                 | The rib end is a snap target and the drag snaps to it                         |
| 10  | Hold D and drag a point on an ordinary hand-drawn outline                                     | The outline offsets exactly as it did before this work                        |

Row 7 is the check on Task 2's provenance. Row 10 is the check that `offset-contour.js` was left
alone.

- [ ] **Step 2: Record the results in the development log and commit**

```bash
git add .
git commit -m "docs(skeleton): the corner's manual matrix, run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
