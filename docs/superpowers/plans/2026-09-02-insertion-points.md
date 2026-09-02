# Insertion Points Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not dispatch subagents and do not create worktrees.** This project forbids both (`docs/superpowers/START-HERE.md`). Work on one branch.

**Goal:** Add a second kind of skeleton point that slides along a centerline segment, changes nothing about the centerline, and emits one rib whose two generated on-curve points appear on the outline without changing its shape until the designer gives the rib a width ratio other than one.

**Architecture:** The generator solves the contour whole, exactly as it does today, and then cuts each side's emitted geometry at the insertion point's source parameter. The cut is a de Casteljau split on a cubic and a linear interpolation on a straight, so the drawn curve is unchanged. A ratio other than one then displaces the two emitted on-curves along the rib normal, and an easing number shapes the four handles around them. All of the new geometry lives in one new pure core module. The generator gains one call site.

**Tech Stack:** JavaScript ES modules. `fontra-core` has mocha and chai (`npm test` from `src-js/fontra-core`). `views-editor` has no harness, but pure editor functions are imported into core tests already, as `tests/test-skeleton-ribs.js` does.

**Spec:** `docs/superpowers/plans/insertion-points.md`. Read it before Task 1. Sections 4, 5 and 6 carry the rules this plan implements.

## Global Constraints

- **Rail R-A.** Pure geometry goes in `fontra-core/src/`. Hit-testing goes in `scene-model.js` as an `*AtPoint` method. Interaction goes in `skeleton-editing.js`. Rendering goes in `visualization-layer-skeleton.js`.
- **Rail R-B.** One copy of every constant and geometry function. If a symbol exists, import it.
- **Rail R-C.** Every skeleton mutation goes through `editSkeleton` in `views-editor/src/skeleton-editing.js`. Nothing else calls the generator on the editing side. Nothing writes skeleton customData outside it.
- **Rail R-D.** Provenance forward, never recovered. No geometric matching and no tolerance-based inverse projection.
- **Rail R-E.** No kind-branching in `makeChangeForDelta`. Target entries decide the kind at construction time.
- **Rail R-G.** Every commit runs three commands in this order: `node --check` on each touched editor file, then `npx prettier --write` on every touched file, then `npm run bundle` from the repo root. All three must pass. The user runs bundle-watch, so a bundle error will be reported back rather than found here.
- **Point-count stability.** The emitted point count must not vary with a parameter value. Two points per insertion point, at every `t`, every ratio and every easing.
- **Ratio default is 1.** Easing default is 0. Neither field has an unset state.
- **Ids are never reused.** Insertion ids come from `allocateSkeletonId`, the same counter skeleton points and contours use.
- **Commit after each task.** Stage with `git add .`.

---

## File Structure

| File                                               | Responsibility                                                                                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/skeleton-insertions.js`           | **NEW.** Pure geometry: split a side's emitted points at a parameter, measure the reference half-width, apply the ratio move, apply easing. Knows nothing about skeletons, contours or provenance. |
| `fontra-core/src/skeleton-model.js`                | Schema, normalization, id allocation, accessors, the slide math, the tie cut wrapper                                                                                                               |
| `fontra-core/src/offset-contour.js`                | `collectCoupledPointGroups` cuts a straight's coupled run at an insertion point                                                                                                                    |
| `fontra-core/src/skeleton-generator.js`            | Segment anchors, the one call into the insertion module, provenance, the construction segment                                                                                                      |
| `views-editor/src/skeleton-editing.js`             | Selection keys, target entries, the slide executor                                                                                                                                                 |
| `views-editor/src/scene-model.js`                  | `skeletonInsertionAtPoint` and its place in the hit cascade                                                                                                                                        |
| `views-editor/src/visualization-layer-skeleton.js` | Drawing the insertion point and its rib                                                                                                                                                            |
| `views-editor/src/panel-skeleton-parameters.js`    | The ratio field, shown in units, and the easing field                                                                                                                                              |
| `views-editor/src/skeleton-panel-model.js`         | The selection summary across insertion points                                                                                                                                                      |
| `views-editor/src/skeleton-panel-edits.js`         | The panel writes, through `editSkeleton`                                                                                                                                                           |
| `fontra-core/assets/lang/en.js`                    | The labels                                                                                                                                                                                         |

New geometry lives in a new module rather than in `skeleton-generator.js`, which is 4,730 lines and is where defect P6 still bites. The serif did the same thing and the architecture map names it the counter-example.

## Phases

Three phases. Each one leaves the tree working and testable.

- **Phase A, Tasks 1 to 6.** The data model and the identity. An insertion point exists, stores a ratio of one, and adds two outline points that change nothing.
- **Phase B, Tasks 7 to 9.** The ratio, easing, and the tie cut.
- **Phase C, Tasks 10 to 14.** The editor: selection, dragging, hit-testing, drawing, the panel.

---

## Task 1: The schema and normalization

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-model.js`
- Test: `src-js/fontra-core/tests/test-skeleton-model.js`

**Interfaces:**

- Consumes: `normalizeId`, `allocateSkeletonId`, `asFiniteNumber`, `asNonNegativeNumber`, all private to `skeleton-model.js` already.
- Produces:
  - `normalizeSkeletonInsertion(insertion, skeletonData, usedIds)` returns `{id, pointId, t, width: {left, right, linked}, easing}`.
  - `DEFAULT_INSERTION_RATIO` is `1`.
  - `makeSkeletonInsertion(data, skeletonData)` returns a normalized entry.
  - `normalizeSkeletonContour` gains an `insertions` array, always present, possibly empty.

Note there is **no `tied` flag** on an insertion's width. An insertion point never opts a straight out of a tie. The straight's own two ends carry that flag and it already reaches the whole group.

- [ ] **Step 1: Write the failing test**

Add to `src-js/fontra-core/tests/test-skeleton-model.js`, in a new `describe` block at the end of the file:

```js
describe("skeleton insertion points", () => {
  it("normalizes a contour with no insertions to an empty list", () => {
    const data = normalizeSkeletonData({
      contours: [makeSkeletonContour({ id: 10, points: [] })],
    });
    expect(data.contours[0].insertions).to.deep.equal([]);
  });

  it("fills every insertion field and never leaves one unset", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [{ id: 12, pointId: 11 }],
        }),
      ],
    });
    expect(data.contours[0].insertions[0]).to.deep.equal({
      id: 12,
      pointId: 11,
      t: 0.5,
      width: { left: 1, right: 1, linked: true },
      easing: 0,
    });
  });

  it("clamps t into 0 to 1 and keeps a stated ratio", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [
            { id: 12, pointId: 11, t: 2, width: { left: 1.5, right: 0.5 }, easing: 3 },
          ],
        }),
      ],
    });
    const insertion = data.contours[0].insertions[0];
    expect(insertion.t).to.equal(1);
    expect(insertion.width.left).to.equal(1.5);
    expect(insertion.width.right).to.equal(0.5);
    expect(insertion.easing).to.equal(1);
  });

  it("allocates an insertion id from the same counter points use", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [{ pointId: 11 }],
        }),
      ],
    });
    const insertion = data.contours[0].insertions[0];
    expect(insertion.id).to.be.a("number");
    expect(insertion.id).to.not.equal(10);
    expect(insertion.id).to.not.equal(11);
    expect(data.nextId).to.be.greaterThan(insertion.id);
  });

  it("drops an insertion whose start point is not on the contour", () => {
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          points: [makeSkeletonPoint({ id: 11, x: 0, y: 0 })],
          insertions: [{ id: 12, pointId: 999 }],
        }),
      ],
    });
    expect(data.contours[0].insertions).to.deep.equal([]);
  });
});
```

Add `makeSkeletonInsertion` to the import list at the top of that test file even though these tests do not call it yet. Task 2 uses it.

- [ ] **Step 2: Run the test and confirm it fails**

Run from `src-js/fontra-core`:

```
npm test -- --grep "skeleton insertion points"
```

Expected: every test fails. The first fails because `insertions` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src-js/fontra-core/src/skeleton-model.js`, beside `normalizeWidth` (about line 3918), add:

```js
// An insertion point's width is a ratio of the half-width the stroke already
// draws where the point stands, not a length. The point's whole gesture is
// sliding along the centerline, and on a tapering stroke a stored length would
// hold still while the stroke under it moved — so the slide would change the
// shape the slide exists not to change. A ratio slides and changes nothing.
// There is no `tied` flag: an insertion point never opts a straight out of its
// tie, and the straight's own two ends already carry that flag.
function normalizeInsertionWidth(width) {
  return {
    left: asNonNegativeNumber(width?.left, DEFAULT_INSERTION_RATIO),
    right: asNonNegativeNumber(width?.right, DEFAULT_INSERTION_RATIO),
    linked: width?.linked !== false,
  };
}
```

Add the constant beside the other skeleton defaults, near `DEFAULT_SKELETON_WIDTH`:

```js
// One means the stroke as it stands. The identity the whole feature rests on.
export const DEFAULT_INSERTION_RATIO = 1;
```

Add the normalizer beside `normalizeSkeletonPoint`:

```js
// One insertion point. `pointId` names the START point of the segment it sits
// on, and `t` is the source parameter along that segment. Nothing stores a
// coordinate: the position is read live from the segment, the way a rib's is.
export function normalizeSkeletonInsertion(
  insertion,
  skeletonData = null,
  usedIds = null
) {
  return {
    id: normalizeId(insertion?.id, skeletonData, usedIds),
    pointId: Number.isInteger(insertion?.pointId) ? insertion.pointId : null,
    t: Math.min(1, Math.max(0, asFiniteNumber(insertion?.t, 0.5))),
    width: normalizeInsertionWidth(insertion?.width),
    easing: Math.min(1, Math.max(0, asFiniteNumber(insertion?.easing, 0))),
  };
}

export function makeSkeletonInsertion(data = {}, skeletonData = null) {
  return normalizeSkeletonInsertion(data, skeletonData);
}
```

In `normalizeSkeletonContour`, after the point loop, add:

```js
// An insertion whose start point is not on this contour addresses a segment
// that does not exist. Dropping it is the honest answer: keeping it would put
// a point on the outline that no reader can place.
const onCurveIds = new Set(
  normalized.points.filter((point) => !point.type).map((point) => point.id)
);
normalized.insertions = [];
for (const insertion of Array.isArray(contour?.insertions) ? contour.insertions : []) {
  const entry = normalizeSkeletonInsertion(insertion, skeletonData, usedIds);
  if (entry.pointId !== null && onCurveIds.has(entry.pointId)) {
    normalized.insertions.push(entry);
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npm test -- --grep "skeleton insertion points"
```

Expected: five passing.

- [ ] **Step 5: Run the whole suite**

```
npm test
```

Expected: the previous count plus five. Nothing else changes. If a golden fixture moved, stop: the contour shape gained a field and the fixture comparison may include it. Fixtures compare `expectedContours`, which is generated output, so an empty `insertions` list on the input must not reach it.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-model.js
git add .
git commit -m "feat(skeleton): the insertion point schema"
```

---

## Task 2: Address, position, and the slide

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-model.js`
- Test: `src-js/fontra-core/tests/test-skeleton-model.js`

**Interfaces:**

- Consumes: `buildSegmentsFromSkeletonPoints` and `getSkeletonContour`, both exported from `skeleton-model.js` today.
- Produces:
  - `getSkeletonInsertion(skeletonData, contourId, insertionId)` returns the entry or `null`.
  - `getSkeletonInsertionSegment(contour, insertion)` returns the segment object or `null`.
  - `getSkeletonInsertionPosition(contour, insertion)` returns `{x, y}` or `null`.
  - `projectSkeletonInsertionParameter(contour, insertion, point)` returns the `t` in 0 to 1 nearest the given point.
  - `appendSkeletonInsertion(skeletonData, contourId, data)` returns the new entry or `null`.
  - `deleteSkeletonInsertions(skeletonData, keys)` where `keys` is a set of `"contourId/insertionId"` strings.

`projectSkeletonInsertionParameter` samples the segment at a fixed 64 steps and then bisects twice around the best sample. A fixed trip count is required. A search that picks its own trip count cannot be continuous in its input, which is the rule the grid search and the arc-length split both follow.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("skeleton insertion points", ...)` block:

```js
const straightWithInsertion = (t) =>
  normalizeSkeletonData({
    contours: [
      makeSkeletonContour({
        id: 10,
        defaultWidth: 60,
        points: [
          makeSkeletonPoint({ id: 11, x: 0, y: 0 }),
          makeSkeletonPoint({ id: 12, x: 100, y: 0 }),
        ],
        insertions: [{ id: 13, pointId: 11, t }],
      }),
    ],
  });

it("reads an insertion's position off the segment, live", () => {
  const data = straightWithInsertion(0.25);
  const contour = getSkeletonContour(data, 10);
  const insertion = getSkeletonInsertion(data, 10, 13);
  expect(getSkeletonInsertionPosition(contour, insertion)).to.deep.equal({
    x: 25,
    y: 0,
  });
  contour.points[1].x = 200;
  expect(getSkeletonInsertionPosition(contour, insertion)).to.deep.equal({
    x: 50,
    y: 0,
  });
});

it("projects a point onto the segment to give a parameter", () => {
  const data = straightWithInsertion(0.5);
  const contour = getSkeletonContour(data, 10);
  const insertion = getSkeletonInsertion(data, 10, 13);
  const t = projectSkeletonInsertionParameter(contour, insertion, { x: 70, y: 40 });
  expect(t).to.be.closeTo(0.7, 0.02);
});

it("holds the projected parameter inside the segment", () => {
  const data = straightWithInsertion(0.5);
  const contour = getSkeletonContour(data, 10);
  const insertion = getSkeletonInsertion(data, 10, 13);
  expect(
    projectSkeletonInsertionParameter(contour, insertion, { x: -50, y: 0 })
  ).to.equal(0);
  expect(
    projectSkeletonInsertionParameter(contour, insertion, { x: 150, y: 0 })
  ).to.equal(1);
});

it("appends an insertion with a fresh id and deletes it by key", () => {
  const data = straightWithInsertion(0.5);
  const added = appendSkeletonInsertion(data, 10, { pointId: 11, t: 0.25 });
  expect(added.id).to.not.equal(13);
  expect(getSkeletonContour(data, 10).insertions).to.have.length(2);
  deleteSkeletonInsertions(data, new Set([`10/${added.id}`]));
  expect(getSkeletonContour(data, 10).insertions).to.have.length(1);
  expect(getSkeletonContour(data, 10).insertions[0].id).to.equal(13);
});

it("deletes the insertions on a segment when its start point goes", () => {
  const data = straightWithInsertion(0.5);
  deleteSkeletonPoints(data, new Set(["10/11"]));
  expect(getSkeletonContour(data, 10).insertions).to.deep.equal([]);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "skeleton insertion points"
```

Expected: the five new tests fail on undefined functions.

- [ ] **Step 3: Write the implementation**

In `skeleton-model.js`, beside `getSkeletonPoint`:

```js
export function getSkeletonInsertion(skeletonData, contourId, insertionId) {
  const contour = getSkeletonContour(skeletonData, contourId);
  return contour?.insertions?.find((entry) => entry.id === insertionId) ?? null;
}

// The segment an insertion point sits on: the one whose START point carries the
// stored id. Built from the contour's own points, so it is always current.
export function getSkeletonInsertionSegment(contour, insertion) {
  if (!contour || !insertion) {
    return null;
  }
  const segments = buildSegmentsFromSkeletonPoints(
    contour.points || [],
    contour.closed === true
  );
  return (
    segments.find((segment) => segment.startPoint.id === insertion.pointId) ?? null
  );
}

// The point on the centerline. Read live and never stored: a stored coordinate
// drifts the moment the segment is redrawn.
export function getSkeletonInsertionPosition(contour, insertion) {
  const segment = getSkeletonInsertionSegment(contour, insertion);
  return segment ? skeletonSegmentPointAt(segment, insertion.t) : null;
}
```

Add the segment evaluator beside the other segment helpers. It handles a straight and a cubic with one rule each, and it is the single copy:

```js
// A segment's point at a source parameter. A straight interpolates; a cubic is
// evaluated by de Casteljau. Nothing else in this file evaluates a segment.
export function skeletonSegmentPointAt(segment, t) {
  const p0 = segment.startPoint;
  const p3 = segment.endPoint;
  if (!segment.controlPoints?.length) {
    return { x: p0.x + (p3.x - p0.x) * t, y: p0.y + (p3.y - p0.y) * t };
  }
  const [p1, p2] = segment.controlPoints;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}
```

The slide, with a fixed trip count:

```js
// The parameter nearest a given point. Sixty-four samples, then two bisections
// around the best one. The trip count is fixed on purpose: a search that picks
// its own trip count cannot be continuous in its input, and this runs on every
// frame of a drag.
const INSERTION_PROJECTION_SAMPLES = 64;
const INSERTION_PROJECTION_REFINEMENTS = 2;

export function projectSkeletonInsertionParameter(contour, insertion, point) {
  const segment = getSkeletonInsertionSegment(contour, insertion);
  if (!segment || !point) {
    return insertion?.t ?? 0.5;
  }
  const distanceAt = (t) => {
    const at = skeletonSegmentPointAt(segment, t);
    const dx = at.x - point.x;
    const dy = at.y - point.y;
    return dx * dx + dy * dy;
  };
  let best = 0;
  let bestDistance = distanceAt(0);
  for (let i = 1; i <= INSERTION_PROJECTION_SAMPLES; i++) {
    const t = i / INSERTION_PROJECTION_SAMPLES;
    const distance = distanceAt(t);
    if (distance < bestDistance) {
      best = t;
      bestDistance = distance;
    }
  }
  let span = 1 / INSERTION_PROJECTION_SAMPLES;
  for (let round = 0; round < INSERTION_PROJECTION_REFINEMENTS; round++) {
    for (const candidate of [best - span / 2, best + span / 2]) {
      const t = Math.min(1, Math.max(0, candidate));
      const distance = distanceAt(t);
      if (distance < bestDistance) {
        best = t;
        bestDistance = distance;
      }
    }
    span /= 2;
  }
  return best;
}
```

The mutators, beside `appendSkeletonPoint`:

```js
export function appendSkeletonInsertion(skeletonData, contourId, data = {}) {
  const contour = getSkeletonContour(skeletonData, contourId);
  if (!contour) {
    return null;
  }
  const insertion = normalizeSkeletonInsertion(data, skeletonData);
  if (insertion.pointId === null) {
    return null;
  }
  contour.insertions.push(insertion);
  return insertion;
}

export function deleteSkeletonInsertions(skeletonData, keys) {
  for (const contour of skeletonData?.contours || []) {
    contour.insertions = (contour.insertions || []).filter(
      (entry) => !keys.has(`${contour.id}/${entry.id}`)
    );
  }
}
```

In `deleteSkeletonPoints`, after the points are removed from a contour, drop the insertions that addressed a removed point:

```js
// Deleting a point merges the two segments beside it, so an insertion that
// addressed one of them would now address a different curve at the same
// parameter and slide on its own. Deleting it is the honest answer.
const survivingOnCurveIds = new Set(
  contour.points.filter((point) => !point.type).map((point) => point.id)
);
contour.insertions = (contour.insertions || []).filter((entry) =>
  survivingOnCurveIds.has(entry.pointId)
);
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npm test -- --grep "skeleton insertion points"
```

Expected: ten passing.

- [ ] **Step 5: Run the whole suite and commit**

```
npm test
npx prettier --write src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-model.js
git add .
git commit -m "feat(skeleton): an insertion point's address, position and slide"
```

---

## Task 3: The generator sees the insertions

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js`
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Produces: `canonicalToGeneratorInput` copies `contour.insertions` onto the generator's own contour object, with each entry's `pointId` still the canonical stable id.

This task exists on its own because of a fault this project has already paid for. A new per-point or per-contour field is invisible to the generator until something copies it across explicitly. The curvature pin stored correctly, read back correctly, and did nothing, because the generator saw `undefined` on every segment. Prove the copy with a test before anything depends on it.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-skeleton-generator.js`:

```js
describe("skeleton insertion points reach the generator", () => {
  it("carries the insertion list across canonicalToGeneratorInput", () => {
    const canonical = normalizeSkeletonData({
      contours: [
        {
          id: 10,
          defaultWidth: 60,
          points: [
            { id: 11, x: 0, y: 0 },
            { id: 12, x: 100, y: 0 },
          ],
          insertions: [{ id: 13, pointId: 11, t: 0.25 }],
        },
      ],
    });
    const input = canonicalToGeneratorInput(canonical);
    expect(input.contours[0].insertions).to.have.length(1);
    expect(input.contours[0].insertions[0]).to.include({ pointId: 11, t: 0.25 });
  });
});
```

Export `canonicalToGeneratorInput` from `skeleton-generator.js` for this test, and import it in the test file. It is private today. Exporting it is the smallest way to test the copy directly, and the copy is exactly what failed silently last time.

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "reach the generator"
```

Expected: FAIL, `canonicalToGeneratorInput is not a function`.

- [ ] **Step 3: Write the implementation**

In `skeleton-generator.js`, change `function canonicalToGeneratorInput` to `export function canonicalToGeneratorInput`, and inside the per-contour build add:

```js
    // A new field is invisible to the generator until something copies it here.
    // The curvature pin stored, read back and did nothing for exactly this
    // reason. Insertions carry their canonical point ids through unchanged.
    insertions: (contour.insertions || []).map((entry) => ({
      id: entry.id,
      pointId: entry.pointId,
      t: entry.t,
      width: { ...entry.width },
      easing: entry.easing,
    })),
```

- [ ] **Step 4: Run the test and confirm it passes, then the suite**

```
npm test -- --grep "reach the generator"
npm test
```

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat(skeleton): the generator sees the insertion list"
```

---

## Task 4: Segment anchors on the solved sides

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js:2253-2382` (`solveSkeletonContourSides`)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Produces: `solveSkeletonContourSides` returns two more fields, `leftSegmentAnchors` and `rightSegmentAnchors`. Each is an array with one entry per segment. Entry `i` is the index, in that side's point array, of the on-curve point at which segment `i`'s emitted geometry begins, or `null` where that side emitted nothing for it.

A segment pushes its start on-curve only when the previous segment did not already push it, so the index cannot be derived after the fact. Record it while the loop runs. Task 5 needs it to find the cubic to cut.

- [ ] **Step 1: Write the failing test**

Append to the new `describe` block in `test-skeleton-generator.js`:

```js
it("publishes the index each segment's emitted geometry starts at", () => {
  const canonical = normalizeSkeletonData({
    contours: [
      {
        id: 10,
        defaultWidth: 60,
        points: [
          { id: 11, x: 0, y: 0 },
          { id: 12, x: 100, y: 0 },
          { id: 13, x: 200, y: 100 },
        ],
      },
    ],
  });
  const input = canonicalToGeneratorInput(canonical);
  const solved = solveSkeletonContourSides(input.contours[0]);
  expect(solved.leftSegmentAnchors).to.have.length(solved.segments.length);
  for (let i = 0; i < solved.segments.length; i++) {
    const anchor = solved.leftSegmentAnchors[i];
    expect(anchor).to.be.a("number");
    expect(solved.leftSide[anchor].type).to.equal(undefined);
  }
  expect(solved.leftSegmentAnchors[0]).to.equal(0);
  expect(solved.leftSegmentAnchors[1]).to.be.greaterThan(0);
});
```

Import `solveSkeletonContourSides` in the test file. It is already exported.

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "emitted geometry starts at"
```

Expected: FAIL, `leftSegmentAnchors` is undefined.

- [ ] **Step 3: Write the implementation**

In `solveSkeletonContourSides`, beside the `leftSide` and `rightSide` declarations, add:

```js
// Where each segment's emitted geometry begins, per side. A segment pushes
// its own start on-curve only when the segment before it did not, so this
// cannot be recovered afterwards by counting. Recorded while the loop runs.
const leftSegmentAnchors = [];
const rightSegmentAnchors = [];
const lastOnCurveIndex = (side) => {
  for (let i = side.length - 1; i >= 0; i--) {
    if (!side[i].type) {
      return i;
    }
  }
  return null;
};
```

Inside the per-segment loop, immediately before `leftSide.push(...offsetPoints.left)`:

```js
const leftStartsOnCurve = offsetPoints.left.length && !offsetPoints.left[0].type;
const rightStartsOnCurve = offsetPoints.right.length && !offsetPoints.right[0].type;
leftSegmentAnchors.push(
  leftStartsOnCurve ? leftSide.length : lastOnCurveIndex(leftSide)
);
rightSegmentAnchors.push(
  rightStartsOnCurve ? rightSide.length : lastOnCurveIndex(rightSide)
);
```

Add both arrays to the returned object.

- [ ] **Step 4: Run the test, then the suite**

```
npm test -- --grep "emitted geometry starts at"
npm test
```

Expected: passing, and no golden fixture moves. The change adds two return fields and touches no geometry.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat(skeleton): the solved sides publish their segment anchors"
```

---

## Task 5: The split, in a new pure module

**Files:**

- Create: `src-js/fontra-core/src/skeleton-insertions.js`
- Create: `src-js/fontra-core/tests/test-skeleton-insertions.js`

**Interfaces:**

- Consumes: nothing from the generator. This module knows about a list of points and a parameter, and nothing about skeletons, ribs or contours.
- Produces:
  - `splitSideAtParameter(sidePoints, anchorIndex, t)` returns `{points, insertedIndex, start, end}` or `null`. `points` is a new array. `insertedIndex` is where the new on-curve landed in it. `start` and `end` are the two on-curve points the cut sat between, taken from the input.
  - `SPLIT_MIN_PARAMETER` is `1e-9` and `SPLIT_MAX_PARAMETER` is `1 - 1e-9`.

The cut is exact. On a cubic it is de Casteljau, which draws the same curve. On a straight it is a linear interpolation, which is exact there. At `t` of 0 or 1 the emitted point coincides with a neighbour and is emitted anyway, because points collapse and do not disappear. That is the ground rule the serif terminal already states.

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-skeleton-insertions.js`:

```js
import { splitSideAtParameter } from "@fontra/core/skeleton-insertions.js";
import { Bezier } from "bezier-js";
import { expect } from "chai";

const cubicSide = () => [
  { x: 0, y: 0 },
  { x: 30, y: 60, type: "cubic" },
  { x: 70, y: 60, type: "cubic" },
  { x: 100, y: 0 },
];

const straightSide = () => [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

// Twenty places along the curve. The split must draw the same curve, so the two
// pieces sampled together must land on the original at every one of them.
function sampleDeparture(original, points, insertedIndex) {
  const whole = new Bezier(original.map(({ x, y }) => ({ x, y })));
  const first = new Bezier(
    points.slice(0, insertedIndex + 1).map(({ x, y }) => ({ x, y }))
  );
  const second = new Bezier(points.slice(insertedIndex).map(({ x, y }) => ({ x, y })));
  let worst = 0;
  for (let i = 0; i <= 20; i++) {
    for (const piece of [first, second]) {
      const at = piece.get(i / 20);
      const near = whole.project(at);
      worst = Math.max(worst, Math.hypot(at.x - near.x, at.y - near.y));
    }
  }
  return worst;
}

describe("splitSideAtParameter", () => {
  it("cuts a cubic and draws the same curve", () => {
    const side = cubicSide();
    const result = splitSideAtParameter(side, 0, 0.25);
    expect(result.points).to.have.length(7);
    expect(result.insertedIndex).to.equal(3);
    expect(sampleDeparture(side, result.points, result.insertedIndex)).to.be.lessThan(
      1e-9
    );
  });

  it("puts the new on-curve on the curve", () => {
    const side = cubicSide();
    const result = splitSideAtParameter(side, 0, 0.4);
    const at = new Bezier(side.map(({ x, y }) => ({ x, y }))).get(0.4);
    const inserted = result.points[result.insertedIndex];
    expect(inserted.x).to.be.closeTo(at.x, 1e-9);
    expect(inserted.y).to.be.closeTo(at.y, 1e-9);
    expect(inserted.type).to.equal(undefined);
  });

  it("cuts a straight by interpolation and adds no handles", () => {
    const result = splitSideAtParameter(straightSide(), 0, 0.25);
    expect(result.points).to.have.length(3);
    expect(result.insertedIndex).to.equal(1);
    expect(result.points[1]).to.include({ x: 25, y: 0 });
    expect(result.points[1].type).to.equal(undefined);
  });

  it("emits the point at a collapsed parameter rather than dropping it", () => {
    for (const t of [0, 1]) {
      const result = splitSideAtParameter(cubicSide(), 0, t);
      expect(result.points).to.have.length(7);
      expect(result.points[result.insertedIndex].type).to.equal(undefined);
    }
  });

  it("leaves the input array untouched", () => {
    const side = cubicSide();
    const before = JSON.stringify(side);
    splitSideAtParameter(side, 0, 0.5);
    expect(JSON.stringify(side)).to.equal(before);
  });

  it("returns null where the anchor names no segment", () => {
    expect(splitSideAtParameter(cubicSide(), 3, 0.5)).to.equal(null);
    expect(splitSideAtParameter([], 0, 0.5)).to.equal(null);
  });

  it("moves the split point continuously as the parameter sweeps", () => {
    const side = cubicSide();
    let previous = null;
    let worst = 0;
    for (let i = 0; i <= 500; i++) {
      const t = i / 500;
      const result = splitSideAtParameter(side, 0, t);
      const at = result.points[result.insertedIndex];
      if (previous) {
        worst = Math.max(worst, Math.hypot(at.x - previous.x, at.y - previous.y));
      }
      previous = at;
    }
    expect(worst).to.be.lessThan(0.5);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "splitSideAtParameter"
```

Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src-js/fontra-core/src/skeleton-insertions.js`:

```js
// An insertion point's geometry, as a pure operation on a side's emitted point
// list. This module knows nothing about skeletons, ribs, contours or
// provenance: the generator owns all of that, the way it owns everything about
// attaching a serif terminal to a stroke. Keeping the geometry out of
// skeleton-generator.js is deliberate — that file is the fork's largest and is
// where defect P6 still bites.

// A parameter is never pushed off its own ends. Zero and one are legal
// settings: the emitted point lands on its neighbour and is emitted anyway,
// because points collapse and do not disappear.
export const SPLIT_MIN_PARAMETER = 1e-9;
export const SPLIT_MAX_PARAMETER = 1 - 1e-9;

/**
 * Cut one side's emitted geometry at a source parameter.
 *
 * The cut is exact. On a cubic it is a de Casteljau split, so the two pieces
 * draw the curve the one piece drew. On a straight it is a linear
 * interpolation, which is exact there. Nothing is refitted and nothing is
 * approximated, which is the whole promise of the feature: adding an insertion
 * point leaves the letter as it was.
 *
 * @param {Array} sidePoints - the side's emitted points, on-curves and handles
 * @param {number} anchorIndex - index of the on-curve the segment starts at
 * @param {number} t - the source parameter, 0 to 1
 * @returns {Object|null} {points, insertedIndex, start, end}
 */
export function splitSideAtParameter(sidePoints, anchorIndex, t) {
  if (!Array.isArray(sidePoints) || !Number.isInteger(anchorIndex)) {
    return null;
  }
  const start = sidePoints[anchorIndex];
  if (!start || start.type) {
    return null;
  }
  let endIndex = -1;
  for (let i = anchorIndex + 1; i < sidePoints.length; i++) {
    if (!sidePoints[i].type) {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    return null;
  }
  const handles = sidePoints.slice(anchorIndex + 1, endIndex);
  if (handles.length !== 0 && handles.length !== 2) {
    return null;
  }
  const end = sidePoints[endIndex];
  const parameter = Math.min(1, Math.max(0, t));

  const cut =
    handles.length === 2
      ? splitCubic(start, handles[0], handles[1], end, parameter)
      : splitLine(start, end, parameter);

  const points = [
    ...sidePoints.slice(0, anchorIndex + 1),
    ...cut,
    ...sidePoints.slice(endIndex),
  ];
  return {
    points,
    insertedIndex: anchorIndex + 1 + (handles.length === 2 ? 2 : 0),
    start,
    end,
  };
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function splitLine(start, end, t) {
  const at = lerp(start, end, t);
  return [{ x: at.x, y: at.y }];
}

// De Casteljau. The six points it returns replace the two handles between the
// two on-curves: the first segment's two handles, the new on-curve, and the
// second segment's two handles.
function splitCubic(p0, p1, p2, p3, t) {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const at = lerp(d, e, t);
  return [
    { x: a.x, y: a.y, type: "cubic" },
    { x: d.x, y: d.y, type: "cubic" },
    { x: at.x, y: at.y },
    { x: e.x, y: e.y, type: "cubic" },
    { x: c.x, y: c.y, type: "cubic" },
  ];
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npm test -- --grep "splitSideAtParameter"
```

Expected: seven passing.

- [ ] **Step 5: Run the suite and commit**

```
npm test
npx prettier --write src-js/fontra-core/src/skeleton-insertions.js src-js/fontra-core/tests/test-skeleton-insertions.js
git add .
git commit -m "feat(skeleton): the insertion split, as pure geometry"
```

---

## Task 6: Wire the split into the generator, with provenance

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js:2392-2430` (`generateOutlineFromSkeletonContour`)
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Consumes: `splitSideAtParameter` from Task 5, `leftSegmentAnchors` and `rightSegmentAnchors` from Task 4, `insertions` from Task 3.
- Produces: the emitted contour carries, per insertion point and per side, one on-curve and its two neighbouring handles, each with `_provenance` naming `{skeletonPointId: <insertion id>, side, role, insertion: true}`. The on-curve's provenance also carries `constructionSegment`, the four points of the uncut segment.

The `insertion: true` flag is what lets a reader tell an insertion's emitted point from an ordinary rib's. Every reader that resolves a skeleton point by id must accept an insertion id, and the flag says which list to look in. Without it a lookup would search the point list and find nothing, which reads as a missing point rather than a different kind.

The construction segment matters for the same reason it matters at a round cap. The curvature pin is keyed on the original segment's start point and the generator reproduces it on the segment it solved, which is the uncut one. A gizmo reading a piece would display a number that means something else, and the first drag would jump.

- [ ] **Step 1: Write the failing test**

Append to the insertion `describe` block in `test-skeleton-generator.js`:

```js
const curvedStroke = (insertions = []) =>
  normalizeSkeletonData({
    contours: [
      {
        id: 10,
        defaultWidth: 60,
        capStyle: "butt",
        points: [
          { id: 11, x: 0, y: 0 },
          { id: 14, x: 40, y: 120, type: "cubic" },
          { id: 15, x: 160, y: 120, type: "cubic" },
          { id: 12, x: 200, y: 0 },
        ],
        insertions,
      },
    ],
  });

it("adds exactly two points and moves none of the others", () => {
  const without = generateFromSkeleton(curvedStroke());
  const with_ = generateFromSkeleton(curvedStroke([{ id: 13, pointId: 11, t: 0.4 }]));
  expect(with_.contours[0].points).to.have.length(
    without.contours[0].points.length + 2
  );
  // Every original point is still there, to the unit, in order.
  const original = without.contours[0].points.map((p) => `${p.x},${p.y},${p.type}`);
  const after = with_.contours[0].points.map((p) => `${p.x},${p.y},${p.type}`);
  let cursor = 0;
  for (const point of original) {
    const found = after.indexOf(point, cursor);
    expect(found, `original point ${point} moved or vanished`).to.be.greaterThan(-1);
    cursor = found + 1;
  }
});

it("holds the count at every parameter", () => {
  const counts = new Set();
  for (let i = 0; i <= 40; i++) {
    const result = generateFromSkeleton(
      curvedStroke([{ id: 13, pointId: 11, t: i / 40 }])
    );
    counts.add(result.contours[0].points.length);
  }
  expect([...counts]).to.have.length(1);
});

it("names the insertion in the provenance of both emitted on-curves", () => {
  const result = generateFromSkeleton(curvedStroke([{ id: 13, pointId: 11, t: 0.4 }]));
  const owned = result.provenance[0].pointMap.filter(
    (entry) => entry?.skeletonPointId === 13
  );
  expect(owned.filter((entry) => entry.role === "onCurve")).to.have.length(2);
  expect(new Set(owned.map((entry) => entry.side))).to.deep.equal(
    new Set(["left", "right"])
  );
  for (const entry of owned) {
    expect(entry.insertion).to.equal(true);
  }
});

it("publishes the uncut segment on the inserted on-curve", () => {
  const result = generateFromSkeleton(curvedStroke([{ id: 13, pointId: 11, t: 0.4 }]));
  const inserted = result.provenance[0].pointMap.find(
    (entry) => entry?.skeletonPointId === 13 && entry.role === "onCurve"
  );
  expect(inserted.constructionSegment).to.have.length(4);
});

it("takes two insertion points on one segment", () => {
  const one = generateFromSkeleton(curvedStroke([{ id: 13, pointId: 11, t: 0.3 }]));
  const two = generateFromSkeleton(
    curvedStroke([
      { id: 13, pointId: 11, t: 0.3 },
      { id: 16, pointId: 11, t: 0.7 },
    ])
  );
  expect(two.contours[0].points).to.have.length(one.contours[0].points.length + 2);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "skeleton insertion points reach the generator"
```

Expected: the five new tests fail. The first fails on the point count.

- [ ] **Step 3: Write the implementation**

In `skeleton-generator.js`, import the new module at the top:

```js
import { splitSideAtParameter } from "./skeleton-insertions.js";
```

In `generateOutlineFromSkeletonContour`, after destructuring `solved` and **before** `joinInnerCornersOnSide`, add:

```js
// The insertion split runs here: after the solve and after every authored
// layer, and before the corner join. The pieces it makes draw the curve the
// solve produced, so nothing above this line sees it and nothing below it
// needs to know a cut happened.
const { leftSide: insertedLeftSide, rightSide: insertedRightSide } =
  applyInsertionSplits({
    leftSide,
    rightSide,
    leftSegmentAnchors: solved.leftSegmentAnchors,
    rightSegmentAnchors: solved.rightSegmentAnchors,
    segments,
    insertions: skeletonContour.insertions || [],
  });

const joinedLeftSide = joinInnerCornersOnSide(insertedLeftSide, { isClosed });
const joinedRightSide = joinInnerCornersOnSide(insertedRightSide, { isClosed });
```

Delete the two old `joinInnerCornersOnSide` lines that used `leftSide` and `rightSide`.

Add the helper beside `buildSegmentsFromPoints`:

```js
// Cut both sides at every insertion point on the contour.
//
// Insertions on one segment are applied from the highest parameter down, so an
// earlier cut cannot move the index a later cut was measured against. The
// anchors are recorded once, against the uncut sides, and stay correct under
// that order.
function applyInsertionSplits({
  leftSide,
  rightSide,
  leftSegmentAnchors,
  rightSegmentAnchors,
  segments,
  insertions,
}) {
  if (!insertions.length) {
    return { leftSide, rightSide };
  }
  let left = leftSide;
  let right = rightSide;
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    const onSegment = insertions
      .filter((entry) => entry.pointId === segment.startPoint._sourcePointId)
      .sort((a, b) => b.t - a.t);
    if (!onSegment.length) {
      continue;
    }
    const constructionSegment = [
      segment.startPoint,
      ...segment.controlPoints,
      segment.endPoint,
    ].map(({ x, y }) => ({ x, y }));
    for (const insertion of onSegment) {
      left = applyOneInsertionToSide(
        left,
        leftSegmentAnchors[index],
        insertion,
        "left",
        constructionSegment
      );
      right = applyOneInsertionToSide(
        right,
        rightSegmentAnchors[index],
        insertion,
        "right",
        constructionSegment
      );
    }
  }
  return { leftSide: left, rightSide: right };
}

function applyOneInsertionToSide(
  sidePoints,
  anchorIndex,
  insertion,
  side,
  constructionSegment
) {
  if (anchorIndex === null || anchorIndex === undefined) {
    return sidePoints;
  }
  const cut = splitSideAtParameter(sidePoints, anchorIndex, insertion.t);
  if (!cut) {
    return sidePoints;
  }
  const points = cut.points;
  const at = cut.insertedIndex;
  // The emitted on-curve and its two neighbouring handles are the insertion
  // point's own geometry. `insertion: true` says which list a reader resolving
  // this id must look in: an insertion id is not a point id, and a lookup that
  // searched the point list would report a missing point rather than a
  // different kind of one.
  points[at]._provenance = {
    skeletonPointId: insertion.id,
    side,
    role: "onCurve",
    insertion: true,
    constructionSegment,
  };
  if (points[at - 1]?.type) {
    points[at - 1]._provenance = {
      skeletonPointId: insertion.id,
      side,
      role: "in",
      insertion: true,
    };
  }
  if (points[at + 1]?.type) {
    points[at + 1]._provenance = {
      skeletonPointId: insertion.id,
      side,
      role: "out",
      insertion: true,
    };
  }
  return points;
}
```

`_sourcePointId` is the field `canonicalPointToGeneratorPoint` already stamps on every generator point. Confirm the name with a grep before writing the filter, and use whatever the tree actually holds. Do not guess a filename or a field name in this file.

- [ ] **Step 4: Run the tests and confirm they pass**

```
npm test -- --grep "skeleton insertion points reach the generator"
npm test
```

Expected: all passing, and every golden fixture unchanged. A fixture that moves means the split ran on a contour with no insertion points, which it must not.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat(skeleton): the generator cuts its sides at an insertion point"
```

**Phase A ends here.** An insertion point exists, is stored, is normalized, reaches the generator and adds two outline points that change nothing.

---

## Task 7: The ratio move

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-insertions.js`
- Modify: `src-js/fontra-core/src/skeleton-generator.js`
- Test: `src-js/fontra-core/tests/test-skeleton-insertions.js`, `src-js/fontra-core/tests/test-skeleton-generator.js`

**Interfaces:**

- Produces: `applyInsertionRatio(points, insertedIndex, centerPoint, ratio)` returns a new point array with the on-curve at `insertedIndex` moved along the line from `centerPoint` out to it, scaled by `ratio`. It returns the input array unchanged where `ratio` is exactly 1.
- The generator passes `skeletonSegmentPointAt(segment, insertion.t)` as `centerPoint`, imported from `skeleton-model.js` per rail R-B.

The reference is the distance from the centerline point at that parameter out to the emitted point, read off the geometry the split just made. It is not interpolated between the two neighbouring ribs, because the generator states no width between ribs and inventing one would be a second answer to a question the outline already answers.

- [ ] **Step 1: Write the failing test**

Append to `test-skeleton-insertions.js`:

```js
import { applyInsertionRatio } from "@fontra/core/skeleton-insertions.js";

describe("applyInsertionRatio", () => {
  const points = [
    { x: 0, y: 30 },
    { x: 50, y: 30 },
    { x: 100, y: 30 },
  ];

  it("returns the same array at a ratio of one", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 1);
    expect(result).to.equal(points);
  });

  it("moves the on-curve out along the line from the centerline", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 2);
    expect(result[1]).to.include({ x: 50, y: 60 });
    expect(result[0]).to.deep.equal(points[0]);
    expect(result[2]).to.deep.equal(points[2]);
  });

  it("moves it in at a ratio below one", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 0.5);
    expect(result[1]).to.include({ x: 50, y: 15 });
  });

  it("takes the point onto the centerline at a ratio of zero", () => {
    const result = applyInsertionRatio(points, 1, { x: 50, y: 0 }, 0);
    expect(result[1]).to.include({ x: 50, y: 0 });
  });

  it("moves continuously as the ratio sweeps", () => {
    let previous = null;
    let worst = 0;
    for (let i = 0; i <= 400; i++) {
      const ratio = i / 200;
      const at = applyInsertionRatio(points, 1, { x: 50, y: 0 }, ratio)[1];
      if (previous) {
        worst = Math.max(worst, Math.hypot(at.x - previous.x, at.y - previous.y));
      }
      previous = at;
    }
    expect(worst).to.be.lessThan(0.5);
  });

  it("leaves the input array untouched", () => {
    const before = JSON.stringify(points);
    applyInsertionRatio(points, 1, { x: 50, y: 0 }, 3);
    expect(JSON.stringify(points)).to.equal(before);
  });
});
```

Append to the generator's insertion `describe` block:

```js
it("swells the stroke at a ratio above one and nowhere else", () => {
  const plain = generateFromSkeleton(curvedStroke([{ id: 13, pointId: 11, t: 0.4 }]));
  const swollen = generateFromSkeleton(
    curvedStroke([{ id: 13, pointId: 11, t: 0.4, width: { left: 1.5, right: 1.5 } }])
  );
  const moved = [];
  for (let i = 0; i < plain.contours[0].points.length; i++) {
    const a = plain.contours[0].points[i];
    const b = swollen.contours[0].points[i];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 0.5) {
      moved.push(i);
    }
  }
  // The two emitted on-curves move. Nothing else does.
  expect(moved).to.have.length(2);
});

it("slides a swell along a tapered stroke without changing anything else", () => {
  // The sweep the ratio exists for. An absolute width fails it.
  const tapered = (t) =>
    normalizeSkeletonData({
      contours: [
        {
          id: 10,
          defaultWidth: 60,
          capStyle: "butt",
          points: [
            { id: 11, x: 0, y: 0, width: { left: 15, right: 15 } },
            { id: 12, x: 200, y: 0, width: { left: 45, right: 45 } },
          ],
          insertions: [{ id: 13, pointId: 11, t, width: { left: 1.4, right: 1.4 } }],
        },
      ],
    });
  let previous = null;
  let worst = 0;
  for (let i = 5; i <= 95; i++) {
    const result = generateFromSkeleton(tapered(i / 100));
    const points = result.contours[0].points;
    if (previous) {
      expect(points).to.have.length(previous.length);
      for (let k = 0; k < points.length; k++) {
        worst = Math.max(
          worst,
          Math.hypot(points[k].x - previous[k].x, points[k].y - previous[k].y)
        );
      }
    }
    previous = points;
  }
  // One percent of a 200-unit stroke is two units of travel per step, and the
  // swell is 40 per cent of a stroke that runs 30 to 90. Nothing may jump past
  // that. A backtrack or a topology change shows up here as a large number.
  expect(worst).to.be.lessThan(6);
});
```

- [ ] **Step 2: Run both and confirm they fail**

```
npm test -- --grep "applyInsertionRatio"
npm test -- --grep "swells the stroke"
```

- [ ] **Step 3: Write the implementation**

In `skeleton-insertions.js`:

```js
/**
 * Move an emitted on-curve out from the centerline by a ratio.
 *
 * The reference is what the split already drew: the distance from the
 * centerline point at that parameter out to the emitted point. It is read off
 * the geometry rather than interpolated between the two neighbouring ribs,
 * because the generator states no width between ribs and inventing one would be
 * a second answer to a question the outline already answers.
 *
 * A ratio of exactly one returns the input array. That identity is the whole
 * promise of the feature and it is asserted rather than assumed.
 *
 * @param {Array} points - the side's points, after the split
 * @param {number} insertedIndex - the split point's index
 * @param {Object} centerPoint - the centerline point at the same parameter
 * @param {number} ratio - the stored multiplier
 * @returns {Array} a new array, or the input where the ratio is one
 */
export function applyInsertionRatio(points, insertedIndex, centerPoint, ratio) {
  if (ratio === 1 || !centerPoint || !points?.[insertedIndex]) {
    return points;
  }
  const at = points[insertedIndex];
  const moved = points.slice();
  moved[insertedIndex] = {
    ...at,
    x: centerPoint.x + (at.x - centerPoint.x) * ratio,
    y: centerPoint.y + (at.y - centerPoint.y) * ratio,
  };
  return moved;
}
```

In `skeleton-generator.js`, import `skeletonSegmentPointAt` from `skeleton-model.js` and extend `applyOneInsertionToSide`. Take the ratio from the side's own field and apply it after the provenance is stamped:

```js
const ratio = side === "left" ? insertion.width.left : insertion.width.right;
return applyInsertionRatio(
  points,
  at,
  skeletonSegmentPointAt(segment, insertion.t),
  ratio
);
```

Pass `segment` into `applyOneInsertionToSide` from `applyInsertionSplits`. Note that the generator's segment points carry the canonical coordinates, so `skeletonSegmentPointAt` reads them directly.

- [ ] **Step 4: Run both, then the suite**

```
npm test -- --grep "applyInsertionRatio"
npm test -- --grep "swells the stroke"
npm test -- --grep "slides a swell"
npm test
```

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-insertions.js src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-insertions.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat(skeleton): an insertion point's width is a ratio of the stroke"
```

---

## Task 8: Easing

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-insertions.js`
- Modify: `src-js/fontra-core/src/skeleton-generator.js`
- Test: `src-js/fontra-core/tests/test-skeleton-insertions.js`

**Interfaces:**

- Produces: `applyInsertionEasing(points, insertedIndex, easing)` returns a new array with the two handles either side of `insertedIndex` turned toward the chord between the two on-curves that bracket them, by the fraction `easing`. It returns the input array where `easing` is 0 or where either neighbour is not a handle.

At 0 the two handles keep the directions the split gave them. After a perpendicular move that is a corner, which is the setting the field starts at. At 1 both handles lie on one line through the emitted point, so the joint is smooth. Between the two it opens gradually.

Easing shapes handles and moves no on-curve. It may not change the neighbouring ribs' widths.

**The spec marks this section as the one part inferred rather than stated.** Read `docs/superpowers/plans/insertion-points.md` section 5 before starting. If the designer has since said easing is a length along the outline, this task changes and Tasks 1 to 7 do not.

- [ ] **Step 1: Write the failing test**

Append to `test-skeleton-insertions.js`:

```js
import { applyInsertionEasing } from "@fontra/core/skeleton-insertions.js";

// The angle the outline turns through at the emitted point, in degrees. Zero is
// a smooth pass and anything above it is a corner.
function jointAngle(points, at) {
  const incoming = {
    x: points[at].x - points[at - 1].x,
    y: points[at].y - points[at - 1].y,
  };
  const outgoing = {
    x: points[at + 1].x - points[at].x,
    y: points[at + 1].y - points[at].y,
  };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

describe("applyInsertionEasing", () => {
  // A cut cubic whose middle on-curve has been displaced, so the joint is bent.
  const bent = () => [
    { x: 0, y: 0 },
    { x: 20, y: 20, type: "cubic" },
    { x: 40, y: 20, type: "cubic" },
    { x: 50, y: 40 },
    { x: 60, y: 20, type: "cubic" },
    { x: 80, y: 20, type: "cubic" },
    { x: 100, y: 0 },
  ];

  it("returns the same array at zero", () => {
    const points = bent();
    expect(applyInsertionEasing(points, 3, 0)).to.equal(points);
  });

  it("leaves the joint bent at zero and straightens it at one", () => {
    const points = bent();
    expect(jointAngle(applyInsertionEasing(points, 3, 0), 3)).to.be.greaterThan(20);
    expect(jointAngle(applyInsertionEasing(points, 3, 1), 3)).to.be.lessThan(1e-6);
  });

  it("moves no on-curve point at any value", () => {
    const points = bent();
    for (let i = 0; i <= 20; i++) {
      const result = applyInsertionEasing(points, 3, i / 20);
      for (const index of [0, 3, 6]) {
        expect(result[index]).to.deep.equal(points[index]);
      }
    }
  });

  it("closes the joint angle without stepping", () => {
    const points = bent();
    let previous = null;
    let worst = 0;
    for (let i = 0; i <= 400; i++) {
      const angle = jointAngle(applyInsertionEasing(points, 3, i / 400), 3);
      if (previous !== null) {
        worst = Math.max(worst, Math.abs(angle - previous));
      }
      previous = angle;
    }
    expect(worst).to.be.lessThan(1);
  });

  it("leaves the input array untouched", () => {
    const points = bent();
    const before = JSON.stringify(points);
    applyInsertionEasing(points, 3, 0.5);
    expect(JSON.stringify(points)).to.equal(before);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "applyInsertionEasing"
```

- [ ] **Step 3: Write the implementation**

In `skeleton-insertions.js`:

```js
/**
 * Open the joint at an emitted insertion point.
 *
 * The ratio move displaces one on-curve and leaves the four handles around it
 * pointing where the split put them, so the outline turns a corner there.
 * Easing turns the two handles either side of that point toward one shared
 * direction, by a fraction. At zero they keep the directions the split gave
 * them. At one they lie on one line through the point and the joint is smooth.
 *
 * The shared direction is the chord between the two on-curves that bracket the
 * pair. It is symmetric in the two sides, which a rounding has to be, and it
 * needs nothing the caller does not already have.
 *
 * This moves handles only. No on-curve moves at any value, and no neighbouring
 * rib's width is touched — a rib states a width, and a control that quietly
 * restated one would make the panel disagree with the shape.
 *
 * @param {Array} points - the side's points, after the split and the ratio
 * @param {number} insertedIndex - the emitted on-curve's index
 * @param {number} easing - 0 to 1
 * @returns {Array} a new array, or the input where easing is zero
 */
export function applyInsertionEasing(points, insertedIndex, easing) {
  const before = points?.[insertedIndex - 1];
  const after = points?.[insertedIndex + 1];
  if (!easing || !before?.type || !after?.type) {
    return points;
  }
  const outerBefore = points[insertedIndex - 2];
  const outerAfter = points[insertedIndex + 2];
  if (!outerBefore || !outerAfter) {
    return points;
  }
  const chord = normalize({
    x: outerAfter.x - outerBefore.x,
    y: outerAfter.y - outerBefore.y,
  });
  if (!chord) {
    return points;
  }
  const at = points[insertedIndex];
  const eased = points.slice();
  eased[insertedIndex - 1] = turnToward(
    before,
    at,
    { x: -chord.x, y: -chord.y },
    easing
  );
  eased[insertedIndex + 1] = turnToward(after, at, chord, easing);
  return eased;
}

// A handle turned toward a direction by a fraction, keeping its own length.
// Length is kept because easing is a statement about the joint's angle and not
// about how full the two curves are. Changing the length here would move the
// curve where the designer asked only for the corner to open.
function turnToward(handle, anchor, direction, fraction) {
  const current = { x: handle.x - anchor.x, y: handle.y - anchor.y };
  const length = Math.hypot(current.x, current.y);
  if (length < 1e-9) {
    return handle;
  }
  const unit = { x: current.x / length, y: current.y / length };
  const blended = normalize({
    x: unit.x + (direction.x - unit.x) * fraction,
    y: unit.y + (direction.y - unit.y) * fraction,
  });
  if (!blended) {
    return handle;
  }
  return {
    ...handle,
    x: anchor.x + blended.x * length,
    y: anchor.y + blended.y * length,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return length < 1e-9 ? null : { x: vector.x / length, y: vector.y / length };
}
```

In `skeleton-generator.js`, call it in `applyOneInsertionToSide` after the ratio, and return its result:

```js
const moved = applyInsertionRatio(
  points,
  at,
  skeletonSegmentPointAt(segment, insertion.t),
  ratio
);
return applyInsertionEasing(moved, at, insertion.easing);
```

- [ ] **Step 4: Run the tests, then the suite**

```
npm test -- --grep "applyInsertionEasing"
npm test
```

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-insertions.js src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-insertions.js
git add .
git commit -m "feat(skeleton): easing opens the joint at an insertion point"
```

---

## Task 9: An insertion point cuts a tie

**Files:**

- Modify: `src-js/fontra-core/src/offset-contour.js:81-160`
- Modify: `src-js/fontra-core/src/skeleton-model.js` (`collectTiedRibGroups`, `getTiedRibGroup`, `getSkeletonRibTieGroup`)
- Modify: `src-js/fontra-core/src/skeleton-generator.js` (`coupledHalfWidths`)
- Test: `src-js/fontra-core/tests/test-skeleton-ribs.js`

**Interfaces:**

- Produces: `collectCoupledPointGroups(segments, isClosed, isCoupled, forcedCouplingPoints, cutPoints)` takes a fifth argument, a `Set` of segment objects that carry at least one insertion point. A straight in that set couples only the end that is straight-controlled, and not both ends.
- `collectTiedRibGroups` gains a matching fifth argument and passes it through.

A tie is a run along a straight, from the straight-controlled point to whatever stops it. Today only the far end stops it. An insertion point stops it too. So on a straight running from a tension point to a corner, an insertion point takes the corner's place in the tie, and the corner's rib changes width freely. Where both ends are controlled, nothing is released, because both runs still have to come out straight.

A tied insertion point takes the group's offset and its own ratio is inert. It contributes nothing to the group's mean. A ratio is a statement about the stroke where the point stands, and while tied there is no local stroke for it to be relative to. Resolving the ratio to feed the mean is circular, because the mean is what decides the stroke.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-skeleton-ribs.js`:

```js
describe("an insertion point cuts a tie", () => {
  // A straight from a tension point to a corner. Point 11 is a smooth point
  // carrying one handle, so the straight sets its direction and ties the
  // straight's two ends. Point 12 is an ordinary corner.
  const tiedStraight = (insertions = []) =>
    normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          defaultWidth: 60,
          points: [
            makeSkeletonPoint({ id: 9, x: -80, y: 60 }),
            makeSkeletonPoint({ id: 8, x: -40, y: 30, type: "cubic" }),
            makeSkeletonPoint({ id: 7, x: -20, y: 0, type: "cubic" }),
            makeSkeletonPoint({ id: 11, x: 0, y: 0, smooth: true }),
            makeSkeletonPoint({ id: 12, x: 200, y: 0 }),
          ],
          insertions,
        }),
      ],
    });

  it("ties both ends of the straight with no insertion point", () => {
    const data = tiedStraight();
    const contour = getSkeletonContour(data, 10);
    const group = getTiedRibGroup(contour, contour.points[3]);
    expect(group.map((point) => point.id).sort()).to.deep.equal([11, 12]);
  });

  it("takes the far end's place in the tie", () => {
    const data = tiedStraight([{ id: 13, pointId: 11, t: 0.5 }]);
    const contour = getSkeletonContour(data, 10);
    const group = getTiedRibGroup(contour, contour.points[3]);
    expect(group.map((point) => point.id)).to.deep.equal([11]);
    expect(getTiedRibGroup(contour, contour.points[4])).to.equal(null);
  });

  it("frees the far end's width", () => {
    const data = tiedStraight([{ id: 13, pointId: 11, t: 0.5 }]);
    const contour = getSkeletonContour(data, 10);
    setSkeletonPointSideWidth(contour.points[4], "left", 45);
    expect(getEffectiveRibHalfWidth(contour, contour.points[4], "left")).to.equal(45);
    expect(getEffectiveRibHalfWidth(contour, contour.points[3], "left")).to.equal(30);
  });

  it("releases nothing where both ends are controlled", () => {
    // A second curve arriving at point 12 makes it straight-controlled too.
    const data = normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          defaultWidth: 60,
          closed: true,
          points: [
            makeSkeletonPoint({ id: 11, x: 0, y: 0, smooth: true }),
            makeSkeletonPoint({ id: 12, x: 200, y: 0, smooth: true }),
            makeSkeletonPoint({ id: 7, x: 240, y: 60, type: "cubic" }),
            makeSkeletonPoint({ id: 8, x: -40, y: 60, type: "cubic" }),
          ],
          insertions: [{ id: 13, pointId: 11, t: 0.5 }],
        }),
      ],
    });
    const contour = getSkeletonContour(data, 10);
    const group = getTiedRibGroup(contour, contour.points[0]);
    expect(group.map((point) => point.id).sort()).to.deep.equal([11, 12]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "cuts a tie"
```

Expected: the second, third and fourth fail. The first passes today.

- [ ] **Step 3: Write the implementation**

In `offset-contour.js`, change `couplesItsEnds` to return which ends it couples rather than a boolean:

```js
/**
 * Which of a segment's two ends the segment couples to a shared offset.
 *
 * A straight carrying a straight-controlled smooth point couples both ends: the
 * whole projected straight has to move as a unit or the handle at that point
 * rotates with the width.
 *
 * A `cutPoints` entry breaks that run. A tie is a run along the straight, from
 * the controlled point to whatever stops it, and today only the far end stops
 * it. An insertion point stops it too, so the run from the controlled end to
 * the cut is held and the far end is released. Where BOTH ends are controlled
 * nothing is released, because both runs still have to come out straight.
 *
 * @returns {Array} the coupled end points, possibly empty
 */
function coupledEnds(
  segment,
  prevSegment,
  nextSegment,
  isCoupled,
  forcedCouplingPoints,
  cutSegments
) {
  const startPoint = segment?.startPoint;
  const endPoint = segment?.endPoint;
  if (!startPoint || !endPoint || startPoint === endPoint) {
    return [];
  }
  if (!isCoupled(startPoint) || !isCoupled(endPoint)) {
    return [];
  }
  const isStraight = segment.controlPoints.length === 0;
  const forced =
    isStraight &&
    (forcedCouplingPoints.has(startPoint) || forcedCouplingPoints.has(endPoint));
  const startControlled = isStraightControlledSmoothPoint(
    startPoint,
    segment,
    prevSegment
  );
  const endControlled = isStraightControlledSmoothPoint(endPoint, segment, nextSegment);
  if (!forced && !startControlled && !endControlled) {
    return [];
  }
  if (!cutSegments.has(segment)) {
    return [startPoint, endPoint];
  }
  // Cut. Each end is held only where it is the one that needs the run straight.
  const held = [];
  if (startControlled || (forced && forcedCouplingPoints.has(startPoint))) {
    held.push(startPoint);
  }
  if (endControlled || (forced && forcedCouplingPoints.has(endPoint))) {
    held.push(endPoint);
  }
  // One held end alone has nothing to share an offset with: the run it holds
  // ends at the insertion point, which carries no stored width of its own.
  return held.length > 1 ? held : [];
}
```

In `collectCoupledPointGroups`, take `cutSegments = new Set()` as a fifth parameter, call `coupledEnds`, and skip a segment whose result is empty. Where the result has two points, build the group from those two exactly as the code does today.

In `skeleton-model.js`, add the parameter to `collectTiedRibGroups` and pass it through. Add a helper beside it:

```js
// The straight segments an insertion point sits on. A tie is a run, and an
// insertion point is a thing that stops one.
export function collectInsertionCutSegments(segments, insertions) {
  const cut = new Set();
  for (const insertion of insertions || []) {
    const segment = segments.find(
      (candidate) => candidate.startPoint.id === insertion.pointId
    );
    if (segment && segment.controlPoints.length === 0) {
      cut.add(segment);
    }
  }
  return cut;
}
```

Pass `collectInsertionCutSegments(segments, contour.insertions)` from `getTiedRibGroup`, `getSkeletonRibTieGroup` and `coupledHalfWidths`. In the generator, `coupledHalfWidths` must match `skeleton-model.js` exactly or the gizmo and the outline disagree, which is the fault the original tie report was.

- [ ] **Step 4: Run the tests, then the suite**

```
npm test -- --grep "cuts a tie"
npm test
```

Expected: all passing. If a golden fixture moved, check that the fixture carries no insertion point. A contour with none must reach `coupledEnds` with an empty cut set and take the two-point branch, which is today's behaviour exactly.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/offset-contour.js src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-ribs.js
git add .
git commit -m "feat(skeleton): an insertion point cuts the tie on its straight"
```

**Phase B ends here.** The width and the tie behave as the spec states.

---

## Task 10: Selection keys and the target entries

**Files:**

- Modify: `src-js/views-editor/src/skeleton-editing.js`
- Test: `src-js/fontra-core/tests/test-skeleton-ribs.js`

**Interfaces:**

- Produces:
  - The selection kind `skeletonInsertion/<contourId>/<insertionId>`.
  - `createSkeletonInsertionTargetEntries(...)`, matching the shape `createSkeletonRibTargetEntries` already returns.
  - The rib kind `skeletonRib/<contourId>/<insertionId>/<side>` resolves to an insertion point where the id names one.

`parseSelection` in `utils.ts` already keeps a non-integer remainder raw, so the compound key parses today. Check that before changing it.

The slide executor writes `t` only. Every frame is recorded against a fresh copy of the pre-drag skeleton, never the live one, so the rollback describes the gesture rather than its last frame. That is the rule this project has recorded under `§0, rollback` and it has been broken twice.

- [ ] **Step 1: Write the failing test**

```js
describe("the insertion point slide", () => {
  const withInsertion = () =>
    normalizeSkeletonData({
      contours: [
        makeSkeletonContour({
          id: 10,
          defaultWidth: 60,
          points: [
            makeSkeletonPoint({ id: 11, x: 0, y: 0 }),
            makeSkeletonPoint({ id: 12, x: 100, y: 0 }),
          ],
          insertions: [{ id: 13, pointId: 11, t: 0.5 }],
        }),
      ],
    });

  it("writes only the parameter", () => {
    const data = withInsertion();
    const executor = createSkeletonInsertionExecutor(data, "10/13");
    const result = executor({ x: 25, y: 10 });
    expect(result.t).to.be.closeTo(0.25, 0.02);
    const contour = getSkeletonContour(data, 10);
    expect(contour.points[0]).to.include({ x: 0, y: 0 });
    expect(contour.points[1]).to.include({ x: 100, y: 0 });
  });

  it("holds the parameter inside the segment", () => {
    const data = withInsertion();
    const executor = createSkeletonInsertionExecutor(data, "10/13");
    expect(executor({ x: -100, y: 0 }).t).to.equal(0);
    expect(executor({ x: 300, y: 0 }).t).to.equal(1);
  });
});
```

Name the executor to match whatever `createSkeletonRibExecutor` does in the tree. Read that function before writing this one and copy its shape, including how it returns its result and how `applySkeletonRibExecutorResult` consumes it.

- [ ] **Step 2: Run the test and confirm it fails**

```
npm test -- --grep "insertion point slide"
```

- [ ] **Step 3: Write the implementation**

Read `createSkeletonRibTargetEntries` and `createSkeletonRibExecutor` in `skeleton-editing.js` first. Follow their shape exactly. The slide entry:

- parses the key into a contour id and an insertion id;
- resolves the insertion through `getSkeletonInsertion`;
- on each frame, calls `projectSkeletonInsertionParameter` against a fresh copy of the pre-drag skeleton and writes the answer into `t` through `editSkeleton`;
- writes the same field on every frame, never a field set that depends on the frame. A point written once must be written on every frame after it, or the rollback names a field an abandoned frame left behind.

The rib entries need one change: where a rib key's point id names an insertion, resolve the width through the insertion's `width` block rather than a point's. The ratio is what a rib drag on an insertion point writes, so the drag must divide the cursor's distance by the reference before storing. Read the reference off the generated path through the published provenance, the way the corner rib already reads its ends off the outline.

- [ ] **Step 4: Run the tests, then the suite, then the checks**

```
npm test
node --check src-js/views-editor/src/skeleton-editing.js
npx prettier --write src-js/views-editor/src/skeleton-editing.js src-js/fontra-core/tests/test-skeleton-ribs.js
npm run bundle
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(skeleton): the insertion point slides through one write path"
```

---

## Task 11: Hit-testing

**Files:**

- Modify: `src-js/views-editor/src/scene-model.js`

**Interfaces:**

- Produces: `skeletonInsertionAtPoint(point, size)` returning `{contourId, insertionId}` or `null`.

The place in the cascade matters. An insertion point sits on the centerline, where a skeleton on-curve and a skeleton segment already compete for the click. Put it **after** `skeletonPointAtPoint` and **before** `skeletonSegmentSelectionAtPoint`. An ordinary point wins over an insertion point, because dragging an ordinary point is the more consequential gesture and it is the one the designer reaches for by aiming at the point itself. An insertion point wins over the bare segment, because otherwise it could never be grabbed.

- [ ] **Step 1: Write the hit test**

Follow `skeletonPointAtPoint` exactly, including how it takes its radius from the shared constant rather than a literal. Iterate every contour's insertions, take the position from `getSkeletonInsertionPosition`, and return the first inside the radius.

- [ ] **Step 2: Place it in the cascade**

Find where `skeletonPointAtPoint` is called in the pointer tool's dispatch and add the new call after it. Do not add a branch inside `makeChangeForDelta` (rail R-E).

- [ ] **Step 3: Run the checks**

```
node --check src-js/views-editor/src/scene-model.js
npx prettier --write src-js/views-editor/src/scene-model.js
npm run bundle
```

- [ ] **Step 4: Manual check**

Draw an open stroke, add an insertion point through the action from Task 14, and click it. Confirm the click selects the insertion point and not the segment under it. Then click the neighbouring on-curve and confirm the ordinary point still wins.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(skeleton): an insertion point can be clicked"
```

---

## Task 12: Drawing

**Files:**

- Modify: `src-js/views-editor/src/visualization-layer-skeleton.js`

An insertion point draws on the existing `fontra.skeleton.rib-points` and `fontra.skeleton.ribs` layers, not on new ones. It is a rib, and a designer reading the drawing should see it as one. It needs one visual difference so it can be told from an ordinary rib at a glance: draw the centerline marker as a hollow ring rather than a filled dot.

- [ ] **Step 1: Draw the rib**

In the ribs draw, after the loop over the contour's points, loop over its insertions. Take both ends from the generated path through the published provenance, exactly as the corner rib does. Do not reconstruct them from a normal and a half-width: the emitted point is not at the rib end, and reconstructing it would stand the bar off the outline.

- [ ] **Step 2: Draw the marker**

In the rib-points draw, add the hollow ring at `getSkeletonInsertionPosition`.

- [ ] **Step 3: Run the checks**

```
node --check src-js/views-editor/src/visualization-layer-skeleton.js
npx prettier --write src-js/views-editor/src/visualization-layer-skeleton.js
npm run bundle
```

- [ ] **Step 4: Manual check**

Add an insertion point on a curve and on a straight. Confirm the bar's two ends sit exactly on the outline at every parameter, at a ratio of one and at a ratio of 1.5. Confirm the ring moves with the drag with no lag.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(skeleton): an insertion point and its rib are drawn"
```

---

## Task 13: The panel

**Files:**

- Modify: `src-js/views-editor/src/skeleton-panel-model.js`
- Modify: `src-js/views-editor/src/panel-skeleton-parameters.js`
- Modify: `src-js/views-editor/src/skeleton-panel-edits.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- The panel shows two groups for a selected insertion point: **Width**, with a left and a right field and the link checkbox, and **Easing**, with one field.
- **The width fields read and write units, and the model stores the ratio.** A designer thinks in units. The field shows the resulting half-width, which is the reference times the stored ratio, and a typed number is divided by the reference before it is stored. The conversion is one function in `skeleton-panel-edits.js` and every writer goes through it.
- **Where the insertion point is tied, the panel greys the two width fields**, the way single-sided mode already greys the per-side numbers. A tied insertion point takes the group's offset and its own ratio is inert.

The panel rebuilds in place when only values changed. Follow `formContentsLayoutSignature`: adding a group changes the layout signature, and a field the user is inside must keep its focus across an edit.

- [ ] **Step 1: Add the read model**

In `skeleton-panel-model.js`, summarize the selected insertion points the way the existing code summarizes selected skeleton points, including the mixed and uniform states.

- [ ] **Step 2: Add the writes**

In `skeleton-panel-edits.js`, add the unit-to-ratio conversion and the two writers, both through `editSkeleton`.

- [ ] **Step 3: Add the fields**

In `panel-skeleton-parameters.js`, add the two groups. Reuse the scrubbable label, which every numeric field in this panel already carries. Shift is the fine adjust in these fields, not the coarse one.

- [ ] **Step 4: Add the labels** to `lang/en.js`.

- [ ] **Step 5: Run the checks**

```
node --check src-js/views-editor/src/skeleton-panel-model.js src-js/views-editor/src/panel-skeleton-parameters.js src-js/views-editor/src/skeleton-panel-edits.js
npx prettier --write src-js/views-editor/src/skeleton-panel-model.js src-js/views-editor/src/panel-skeleton-parameters.js src-js/views-editor/src/skeleton-panel-edits.js src-js/fontra-core/assets/lang/en.js
npm run bundle
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(skeleton): the insertion point panel"
```

---

## Task 14: Adding and deleting an insertion point

**Files:**

- Modify: `src-js/views-editor/src/skeleton-editing.js`
- Modify: `src-js/views-editor/src/editor.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- An action, on the context menu, that adds an insertion point at the clicked place on a selected skeleton segment. It resolves the segment through `skeletonSegmentSelectionAtPoint` and the parameter through `projectSkeletonInsertionParameter`.
- Delete removes a selected insertion point through `deleteSkeletonInsertions`.

Both go through `editSkeleton`. The undo labels name the effect: "Add Insertion Point" and "Delete Insertion Point".

- [ ] **Step 1: Add the two actions** in `editor.js`, registered the way the existing skeleton actions are.

- [ ] **Step 2: Route delete.** Find where the delete action collects selected skeleton points and add the insertion keys to the same collection, so one keystroke removes a mixed selection in one change.

- [ ] **Step 3: Run the checks**

```
node --check src-js/views-editor/src/skeleton-editing.js src-js/views-editor/src/editor.js
npx prettier --write src-js/views-editor/src/skeleton-editing.js src-js/views-editor/src/editor.js src-js/fontra-core/assets/lang/en.js
npm run bundle
```

- [ ] **Step 4: Run the manual matrix**

Rail R-G. `views-editor` has no harness, so this matrix is the evidence. Record the result in `docs/superpowers/DEVELOPMENT-LOG.md`.

1. Add an insertion point on a curved segment. Confirm the letter does not change.
2. Add one on a straight segment. Confirm the letter does not change.
3. Drag it from one end of its segment to the other. Confirm nothing but the two emitted points moves.
4. Set the left ratio above one, then below one. Confirm the swell is on the left alone.
5. Unlink the two sides and set them differently. Confirm each side answers alone.
6. Sweep easing from 0 to 1. Confirm the corner opens and no on-curve moves.
7. Add two insertion points on one segment and drag one past the other.
8. Add one on a straight running from a tension point to a corner. Confirm the corner's width now changes alone, and the insertion point's own width field is greyed.
9. Undo every one of the above, one step at a time. Confirm each undo restores the whole gesture and not its last frame.
10. Delete an insertion point and undo the delete.
11. Mirror a contour carrying an insertion point with unequal side ratios. Confirm the two sides swap.
12. Reverse a contour carrying an insertion point. Confirm it stays where it was on screen.
13. Delete the skeleton point that starts the segment. Confirm the insertion point goes with it and the undo brings it back.
14. Save, reload, and confirm the insertion point comes back with its ratio and its easing.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(skeleton): add and delete an insertion point"
```

---

## Task 15: The documents

**Files:**

- Modify: `docs/superpowers/FEATURE-MODEL.md`
- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md`
- Modify: `docs/superpowers/GLOSSARY.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`
- Delete: `docs/superpowers/plans/insertion-points.md`, `docs/superpowers/plans/2026-09-02-insertion-points.md`

A plan that outlives its implementation is worse than no plan. It still reads as an instruction, and a reader cannot tell which parts are the design of record and which were withdrawn. Dissolve both documents into the three permanent ones and delete them.

- [ ] **Step 1: The glossary.** Add **Insertion point** and **Width ratio**. Follow the house form: what the thing is or what you would see first, then the rule.

- [ ] **Step 2: The feature model.** Add a new section at the end, numbered after the last one. Do not renumber sections 1 to 9. Carry across: what it is, the storage rule and why it is not in the point list, the split, the ratio and why it is relative, easing, the tie cut, and what it refuses. Add the ratio's identity to section 5's "what must be preserved".

- [ ] **Step 3: The architecture map.** Add `skeleton-insertions.js` to the F7 core table with its line count. Add the two new selection kinds to the F7 selection list. Add the tie-cut argument to the F9 note about what the skeleton adds to the shared module.

- [ ] **Step 4: The development log.** Add a section under the skeleton. Record only what earns a line: a fault that came back, a measurement that settles a question, or an idea withdrawn. The measurements from Task 7's sweeps belong here. So does the fixture gap, if the corpus still carries no insertion point.

- [ ] **Step 5: Add the golden fixtures.** Add one fixture with an insertion point on a curve and one on a tied straight, through `tests/scripts/make-skeleton-generator-fixtures.js`. The log records three times that a suite passing is not evidence for a change the corpus cannot see.

- [ ] **Step 6: Run the suite and commit**

```
npm test
npx prettier --write docs/superpowers
git add .
git commit -m "docs(skeleton): dissolve the insertion point plan into the reference set"
```

---

## Self-Review Notes

**Spec coverage.** Every section of `insertion-points.md` has a task. Section 2 is Task 1 and Task 2. Section 3 is Tasks 3 to 6. Section 4 is Task 7. Section 5 is Task 8. Section 6 is Task 9. Section 7 is Tasks 10, 11 and 14. Section 8 is enforced by omission and is checked in the Task 14 matrix. Section 9 is Task 6's count test. Section 10 is the file structure above. Section 11 is spread across the tasks.

**Two things this plan tells the implementer to verify rather than assume.**

1. **`_sourcePointId` in Task 6.** The field the generator stamps on a canonical point may have another name. Grep it before writing the filter. The architecture map's own rule is to grep before trusting a filename or a field name in this file.
2. **The executor shape in Task 10.** Read `createSkeletonRibExecutor` and copy it. Do not invent a return shape.

**One thing to expect.** Task 9's change to `couplesItsEnds` touches the single definition of the coupling, which the generator, the rib drag, the rib rendering and the base-curve expansion drag all read. Run the whole suite before committing it, and read the failures rather than adjusting the expectations. A test that changes here is either a real regression or a test that was measuring the grid.
