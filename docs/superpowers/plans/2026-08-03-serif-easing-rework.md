# Serif easing rework — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the serif terminal's easing model — remove `reach`, `tension`,
`concavity` and `straightDepth`, and give each half one scoop across the wing's
inner face plus one explicit rounding at the junction with the stem.

**Architecture:** All shape work stays inside `serif-geometry.js`, which keeps
knowing nothing about strokes or trimming. The generator's only changes are the
field plumbing and the fact that the release point it anchors the trimmed edge to
is now the rounding's first point rather than the top of a straight run. The
terminal's on-curve count goes from 7 to 9 and stays fixed at every parameter
value.

**Tech stack:** JavaScript ES modules, mocha + chai (`cd src-js/fontra-core && npm test`).

## Global constraints

- **Point count is fixed.** Every serif terminal emits exactly **9 on-curve
  points** at every parameter value, including every degenerate one. Points may
  collapse onto each other at zero distance; they may never disappear. This is
  the cross-master interpolation contract.
- **The terminal is fixed in its own frame.** The release and everything below it
  are functions of the serif's own numbers only. The stroke edge is brought to
  them, never the reverse. Never read a terminal point off the cut in the edge —
  that was built and reverted once already (feature model §9).
- **Rail R-B:** one copy of every constant and geometry function. Nothing in this
  plan duplicates a symbol that already exists.
- **Rail R-A:** pure geometry in `fontra-core/src/`, nothing else.
- Every commit: `npx prettier --write` on touched files, `node --check` on
  touched editor files, and `npm test` green in `fontra-core`.
- Do **not** run `npm run bundle` — the user has a bundle watcher running and
  reports compile errors.

## Naming decisions taken in this plan

The backlog names the four parameters `amount`, `balance`, `distance`,
`curvature`. Those are the **panel labels**. The **stored field names** are
prefixed so it is unambiguous which easing a field belongs to when the two sit
side by side in one half object:

| Panel label (backlog name) | Stored field     | Was         |
| -------------------------- | ---------------- | ----------- |
| Amount                     | `easeAmount`     | `concavity` |
| Balance                    | `easeBalance`    | `tension`   |
| Distance                   | `roundDistance`  | new         |
| Curvature                  | `roundCurvature` | new         |

Removed entirely: `reach` (half-level), `straightDepth` (terminal-level).

## The construction, per half

All in frame coordinates (`u` along the serif axis, `v` back into the stroke),
`side` is `+1` for the left half and `−1` for the right.

```
flankU     = the rib end's u
wingInnerV = tipThickness + wingSlope
tipU       = flankU + side * wingLength

C  (corner)  = { u: flankU, v: wingInnerV }     -- where the wing's inner face meets the stem
T  (tip top) = { u: tipU,   v: tipThickness }   -- the wing's end, on the inner face
```

**The scoop** is one cubic from `C` to `T`. Its two controls sit at 1/3 and 2/3
along the straight chord `C→T`, displaced off that chord along the chord's
perpendicular by:

```
d  = easeAmount * |chord|
k1 = (8/3) * (1 - easeBalance)
k2 = (8/3) * easeBalance

control1 = C + chord/3     + n * d * k1
control2 = C + chord * 2/3 + n * d * k2
```

`n` is the unit perpendicular to the chord, sign-chosen so `n.v > 0` — i.e.
pointing back into the stroke, so positive `easeAmount` scoops inward and
negative bulges outward. The `8/3` is chosen so that at `easeBalance = 0.5` the
curve's deviation from the chord at its midpoint is exactly `d`.

**The rounding** replaces the corner at `C` with two on-curve points:

```
R1 = { u: flankU, v: wingInnerV + roundDistance }   -- on the stem's side
R2 = the scoop curve at t = clamp(roundDistance / |chord|, 0, 1)
```

The scoop cubic is **split at that same t** (de Casteljau), so `R2` and the two
handles either side of it are exact and the wing's inner face keeps its shape.
`R1`'s outgoing handle runs along the stem's side toward `C`, length
`roundCurvature * roundDistance`. `R2`'s incoming handle is the split's own
handle, scaled by `roundCurvature` — which is what makes it tangent to the scoop
curve at `R2`.

**Rounding is switched off when the scoop is inward.** When `easeAmount > 0` the
effective `roundDistance` is `0`, which snaps (the user chose snap over fade).
Both points then collapse onto `C` with zero-length handles — the correct output,
not a degenerate one.

**A half with no wing still contributes nothing.** `wingLength === 0` already
zeroes the hollow; it must now zero the rounding as well, for the same reason.

**Emission order per half** (was 5 items, now 8):

```
R1        on-curve, smooth
h1        handle out of R1 toward C
h2        handle into R2
R2        on-curve, smooth
h3, h4    the split scoop's remaining two handles
T         on-curve  (tipTop)
tipBottom on-curve
```

Four on-curves per half, plus the shared foot centre = **9 per terminal**.

## File structure

| File                                              | Responsibility                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `fontra-core/src/skeleton-model.js`               | field lists, normalization, migration of old data                              |
| `fontra-core/src/serif-geometry.js`               | the whole shape change — scoop, rounding, split, emission                      |
| `fontra-core/src/skeleton-generator.js`           | defaults, unit-scaled field set, `buildSerifCap` release + clamp               |
| `views-editor/src/skeleton-panel-model.js`        | drop `straightDepth` from the terminal summary                                 |
| `views-editor/src/panel-skeleton-parameters.js`   | the rows, grouped under two headers                                            |
| `fontra-core/assets/lang/en.js`                   | labels                                                                         |
| `fontra-core/tests/test-serif-geometry.js`        | all geometry tests                                                             |
| `fontra-core/tests/data/skeleton-generator/fixtures.json` | regenerated                                                            |
| `docs/superpowers/*`                              | feature model §5/§8/§9, backlog, development log                               |

---

### Task 1: Field lists, normalization and migration

Old data on disk carries `reach`, `tension`, `concavity` and `straightDepth`.
`reach` and `straightDepth` are dropped; `concavity` and `tension` carry their
values across to `easeAmount` and `easeBalance`, whose ranges match (−1…1 and
0…1). The shape will differ — that is the point of the rework — but no file
fails to load.

**Files:**
- Modify: `fontra-core/src/skeleton-model.js` (`SERIF_HALF_FIELDS` at :86,
  `SERIF_TERMINAL_FIELDS` at :99, `normalizeSerifHalf` at :3106, `normalizeSerif`
  at :3114, `setSkeletonSerifParameters` at :2030)
- Test: `fontra-core/tests/test-skeleton-model.js`

**Interfaces:**
- Produces: `SERIF_HALF_FIELDS = ["wingLength", "tipThickness", "wingSlope",
  "tipCutAngle", "easeAmount", "easeBalance", "roundDistance", "roundCurvature"]`
  and `SERIF_TERMINAL_FIELDS = ["axisAngle", "undersideCup"]`, both consumed by
  the panel, the panel model and the generator.

- [ ] **Step 1: Write the failing tests**

Add to `fontra-core/tests/test-skeleton-model.js`, in the serif describe block:

```js
it("migrates concavity and tension onto the new easing fields", () => {
  const point = { serif: { left: { concavity: -0.5, tension: 0.25 } } };
  const normalized = normalizeSkeletonPoint(point);
  expect(normalized.serif.left.easeAmount).to.equal(-0.5);
  expect(normalized.serif.left.easeBalance).to.equal(0.25);
  expect(normalized.serif.left).to.not.have.property("concavity");
  expect(normalized.serif.left).to.not.have.property("tension");
});

it("drops reach and straightDepth from old serif data", () => {
  const point = { serif: { left: { reach: 30 }, straightDepth: 40 } };
  const normalized = normalizeSkeletonPoint(point);
  expect(normalized.serif.left).to.not.have.property("reach");
  expect(normalized.serif).to.not.have.property("straightDepth");
});

it("leaves the new easing fields null when nothing is stored", () => {
  const normalized = normalizeSkeletonPoint({ serif: { left: {} } });
  expect(normalized.serif.left.easeAmount).to.equal(null);
  expect(normalized.serif.left.roundDistance).to.equal(null);
});
```

Use whichever normalization entry point the neighbouring serif tests in that file
already use; `normalizeSerif` is not exported, so go through the exported point
normalizer the existing tests call.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-model.js -g "serif"`
Expected: FAIL — the new properties are `undefined`.

- [ ] **Step 3: Update the field lists**

In `skeleton-model.js`, replace the two exported lists:

```js
// One half-serif's shape. Absolute font units unless the source's serif units
// mode says otherwise; `tipCutAngle` is degrees, and `easeAmount`, `easeBalance`
// and `roundCurvature` are dimensionless in every mode. Null means "inherit", so
// the contour and source defaults stay live consumers the way stroke width does.
export const SERIF_HALF_FIELDS = Object.freeze([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "tipCutAngle",
  "easeAmount",
  "easeBalance",
  "roundDistance",
  "roundCurvature",
]);

// Shared by both halves of one terminal. The underside cup is deliberately NOT
// per half: the foot is one curve across the whole terminal, and one cup per
// half produces two scoops meeting at a break in the middle.
export const SERIF_TERMINAL_FIELDS = Object.freeze(["axisAngle", "undersideCup"]);
```

- [ ] **Step 4: Add the migration to `normalizeSerifHalf`**

Replace the function:

```js
// Data written before the easing rework carries `concavity` and `tension`, whose
// ranges match the fields that replaced them, plus a `reach` that only ever
// lifted the bracket's start point and has no equivalent. Read the old names
// once, here, so nothing downstream has to know they existed.
const LEGACY_SERIF_HALF_ALIASES = { easeAmount: "concavity", easeBalance: "tension" };

function normalizeSerifHalf(half) {
  const normalized = {};
  for (const field of SERIF_HALF_FIELDS) {
    const stored = Number.isFinite(half?.[field])
      ? half[field]
      : half?.[LEGACY_SERIF_HALF_ALIASES[field]];
    normalized[field] = Number.isFinite(stored) ? stored : null;
  }
  return normalized;
}
```

- [ ] **Step 5: Drop `straightDepth` from the terminal normalization and writer**

In `normalizeSerif`, change the terminal loop to use the exported list:

```js
  for (const field of SERIF_TERMINAL_FIELDS) {
    if (field === "axisAngle") continue;
    normalized[field] = Number.isFinite(serif?.[field]) ? serif[field] : null;
  }
```

In `setSkeletonSerifParameters` (:2053), replace the hardcoded array
`["axisAngle", "undersideCup", "straightDepth"]` with `SERIF_TERMINAL_FIELDS`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npm test`
Expected: the three new tests PASS. Serif generator tests and fixtures will fail
— that is task 4; leave them.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "refactor: serif easing field lists, with migration off the old names"
```

---

### Task 2: The scoop across the wing's inner face

Replaces the corner-attractor construction. `reach` disappears from the geometry
and the two handle-share clamps come out with it (serif backlog item 3 — balance
must reach 0 and 1).

**Files:**
- Modify: `fontra-core/src/serif-geometry.js` (`buildHalfSerif` at :107, the
  constants at :88–93)
- Test: `fontra-core/tests/test-serif-geometry.js`

**Interfaces:**
- Consumes: `SERIF_HALF_FIELDS` from task 1.
- Produces: `buildHalfSerif({ side, flankU, params })` — note `straightDepth` is
  gone from the signature — returning
  `{ corner, tipTop, tipBottom, wingInnerV, scoop }` where `scoop` is
  `{ start, control1, control2, end }` in frame coordinates. Task 3 consumes
  `scoop` and replaces `corner` in the emitted output.

- [ ] **Step 1: Write the failing tests**

Add to `fontra-core/tests/test-serif-geometry.js`:

```js
const scoopParams = {
  wingLength: 40,
  tipThickness: 20,
  wingSlope: 15,
  easeAmount: 0.25,
  easeBalance: 0.5,
};

// The deviation of a cubic from its own chord, at the parameter given.
function chordDeviation(scoop, t) {
  const at = (k) => {
    const m = 1 - t;
    return (
      m * m * m * scoop.start[k] +
      3 * m * m * t * scoop.control1[k] +
      3 * m * t * t * scoop.control2[k] +
      t * t * t * scoop.end[k]
    );
  };
  const point = { u: at("u"), v: at("v") };
  const chord = {
    u: scoop.end.u - scoop.start.u,
    v: scoop.end.v - scoop.start.v,
  };
  const length = Math.hypot(chord.u, chord.v);
  const n = { u: -chord.v / length, v: chord.u / length };
  const sign = n.v >= 0 ? 1 : -1;
  return (
    ((point.u - scoop.start.u) * n.u + (point.v - scoop.start.v) * n.v) * sign
  );
}

it("scoops the wing's inner face by amount times the chord length", () => {
  const half = buildHalfSerif({ side: 1, flankU: 10, params: scoopParams });
  const chord = Math.hypot(
    half.scoop.end.u - half.scoop.start.u,
    half.scoop.end.v - half.scoop.start.v
  );
  expect(chordDeviation(half.scoop, 0.5)).to.be.closeTo(0.25 * chord, 1e-9);
});

it("bulges the other way on a negative amount", () => {
  const half = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...scoopParams, easeAmount: -0.25 },
  });
  expect(chordDeviation(half.scoop, 0.5)).to.be.lessThan(0);
});

it("is a straight chamfer at amount zero", () => {
  const half = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...scoopParams, easeAmount: 0 },
  });
  for (const t of [0.25, 0.5, 0.75]) {
    expect(chordDeviation(half.scoop, t)).to.be.closeTo(0, 1e-9);
  }
});

it("lets balance reach both ends of its range", () => {
  for (const easeBalance of [0, 1]) {
    const half = buildHalfSerif({
      side: 1,
      flankU: 10,
      params: { ...scoopParams, easeBalance },
    });
    expect(chordDeviation(half.scoop, 0.5)).to.be.greaterThan(0);
  }
  const low = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...scoopParams, easeBalance: 0 },
  });
  const high = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...scoopParams, easeBalance: 1 },
  });
  // Balance 0 loads the control nearest the stem, balance 1 the one nearest the
  // wing's end, so the deep part of the curve moves from one to the other.
  expect(chordDeviation(low, 0.25)).to.be.greaterThan(chordDeviation(high, 0.25));
  expect(chordDeviation(high, 0.75)).to.be.greaterThan(chordDeviation(low, 0.75));
});

it("adds no scoop when the half has no wing", () => {
  const half = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...scoopParams, wingLength: 0 },
  });
  for (const t of [0.25, 0.5, 0.75]) {
    expect(chordDeviation(half.scoop, t)).to.be.closeTo(0, 1e-9);
  }
});

it("puts the scoop's start where the wing's inner face meets the stem", () => {
  const half = buildHalfSerif({ side: 1, flankU: 10, params: scoopParams });
  expect(half.scoop.start).to.deep.equal({ u: 10, v: 35 });
  expect(half.scoop.end).to.deep.equal({ u: 50, v: 20 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js`
Expected: FAIL — `half.scoop` is `undefined`.

- [ ] **Step 3: Replace the construction in `buildHalfSerif`**

Delete the `MIN_HANDLE_SHARE` / `MAX_HANDLE_SHARE` / `MAX_HANDLE_TO_CORNER`
constants at :88–93 and the `lerpUV` / `handle` / `clampShare` helpers that only
served them. Replace the body from the `reach` read down to the `return` with:

```js
export function buildHalfSerif({ side, flankU, params }) {
  const wingLength = params.wingLength ?? 0;
  const tipThickness = params.tipThickness ?? 0;
  const wingSlope = params.wingSlope ?? 0;
  const easeBalance = Math.min(Math.max(params.easeBalance ?? 0.5, 0), 1);
  const cutAngle = Math.min(
    Math.max(params.tipCutAngle ?? 0, -MAX_TIP_CUT_ANGLE),
    MAX_TIP_CUT_ANGLE
  );

  const wingInnerV = tipThickness + wingSlope;
  const tipU = flankU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };
  // Where the wing's inner face meets the side of the stem. The scoop runs from
  // here out to the wing's end; the rounding replaces this point with two.
  //
  // It is a function of the serif's own numbers alone. Reading it off the stroke
  // edge instead is tempting, because on a curved approach the edge has drifted
  // off the flank by the time it gets this far. But then anything that reshapes
  // the edge — a curvature pin above all — slides this on-curve along the stroke,
  // and a curvature pin is only allowed to change handles.
  const corner = { u: flankU, v: wingInnerV };

  // A half with no wing is a half that is switched off and must add nothing to
  // the outline: the corner has collapsed onto the tip, so scooping toward it
  // only dimples the foot line.
  const amount = wingLength === 0 ? 0 : (params.easeAmount ?? 0);

  // The scoop is one cubic across the whole inner face. Its controls sit at a
  // third and two thirds along the straight chord and are displaced off it;
  // amount is the depth as a fraction of the chord's length, signed, and balance
  // splits that depth between the two controls, which is what walks the deep
  // part of the curve from one end to the other. The 8/3 makes the curve's
  // midpoint deviation exactly `depth` when the split is even.
  const chord = { u: tipTop.u - corner.u, v: tipTop.v - corner.v };
  const chordLength = Math.hypot(chord.u, chord.v);
  const depth = amount * chordLength;
  // Perpendicular to the chord, pointing back into the stroke, so a positive
  // amount scoops inward and a negative one bulges out.
  const raw = chordLength === 0 ? { u: 0, v: 0 } : { u: -chord.v / chordLength, v: chord.u / chordLength };
  const n = raw.v >= 0 ? raw : { u: -raw.u, v: -raw.v };
  const offset = (fraction, share) => ({
    u: corner.u + chord.u * fraction + n.u * depth * share,
    v: corner.v + chord.v * fraction + n.v * depth * share,
  });
  const scoop = {
    start: corner,
    control1: offset(1 / 3, (8 / 3) * (1 - easeBalance)),
    control2: offset(2 / 3, (8 / 3) * easeBalance),
    end: tipTop,
  };

  return { corner, scoop, tipTop, tipBottom, wingInnerV };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js`
Expected: the six new tests PASS. `buildSerifTerminal` tests fail — task 3.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/tests/test-serif-geometry.js
git add .
git commit -m "feat: the serif's scoop spans the wing's whole inner face"
```

---

### Task 3: The rounding at the junction with the stem

Two on-curve points either side of the corner, each with a handle running
tangentially along the surface it sits on. Off when the scoop is inward, and off
when the half has no wing — in both cases the two points collapse onto the corner
and the terminal still emits nine on-curves.

**Files:**
- Modify: `fontra-core/src/serif-geometry.js` (`buildHalfSerif`,
  `buildSerifTerminal` at :213)
- Test: `fontra-core/tests/test-serif-geometry.js`

**Interfaces:**
- Consumes: `buildHalfSerif`'s `scoop` from task 2.
- Produces: `buildHalfSerif` additionally returns
  `{ release, roundControl1, roundControl2, roundEnd, faceControl1, faceControl2 }`.
  `release` is the point on the stem's side that task 4's `buildSerifCap`
  anchors the trimmed edge to. `buildSerifTerminal({ frame, leftFlankU,
  rightFlankU, left, right, undersideCup })` — `straightDepth` gone — emits 15
  points, 9 of them on-curve.

- [ ] **Step 1: Write the failing tests**

Add to `fontra-core/tests/test-serif-geometry.js`:

```js
const roundedParams = { ...scoopParams, roundDistance: 8, roundCurvature: 0.55 };

function countOnCurves(points) {
  return points.filter((point) => point.type !== "cubic").length;
}

it("puts the release back along the stem by the rounding distance", () => {
  const half = buildHalfSerif({ side: 1, flankU: 10, params: roundedParams });
  expect(half.release).to.deep.equal({ u: 10, v: 43 });
});

it("aims the stem-side rounding handle straight along the stem", () => {
  const half = buildHalfSerif({ side: 1, flankU: 10, params: roundedParams });
  expect(half.roundControl1.u).to.be.closeTo(half.release.u, 1e-9);
  expect(half.roundControl1.v).to.be.lessThan(half.release.v);
});

it("lands the second rounding point on the scoop curve", () => {
  const half = buildHalfSerif({ side: 1, flankU: 10, params: roundedParams });
  const t = 8 / Math.hypot(40, -15);
  const m = 1 - t;
  const at = (k) =>
    m * m * m * half.scoop.start[k] +
    3 * m * m * t * half.scoop.control1[k] +
    3 * m * t * t * half.scoop.control2[k] +
    t * t * t * half.scoop.end[k];
  expect(half.roundEnd.u).to.be.closeTo(at("u"), 1e-9);
  expect(half.roundEnd.v).to.be.closeTo(at("v"), 1e-9);
});

it("collapses both rounding points onto the corner when the scoop is inward", () => {
  const half = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...roundedParams, easeAmount: 0.25 },
  });
  expect(half.release).to.deep.equal(half.corner);
  expect(half.roundEnd).to.deep.equal(half.corner);
});

it("keeps the rounding when the wing bulges outward", () => {
  const half = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...roundedParams, easeAmount: -0.25 },
  });
  expect(half.release.v).to.be.greaterThan(half.corner.v);
});

it("collapses the rounding when the half has no wing", () => {
  const half = buildHalfSerif({
    side: 1,
    flankU: 10,
    params: { ...roundedParams, wingLength: 0 },
  });
  expect(half.release).to.deep.equal(half.corner);
  expect(half.roundEnd).to.deep.equal(half.corner);
});

it("keeps nine on-curve points at every degenerate value", () => {
  const frame = computeSerifFrame({
    endpoint: { x: 0, y: 0 },
    tangent: { x: 0, y: 1 },
    normal: { x: -1, y: 0 },
    axisMode: "perpendicular",
  });
  const degenerate = [
    {},
    { wingLength: 0 },
    { tipThickness: 0 },
    { wingSlope: 0 },
    { roundDistance: 0 },
    { roundCurvature: 0 },
    { easeAmount: 0 },
    { easeAmount: 1 },
    { easeAmount: -1 },
    { easeBalance: 0 },
    { easeBalance: 1 },
    { roundDistance: 1000 },
  ];
  for (const override of degenerate) {
    for (const undersideCup of [0, 25]) {
      const params = { ...roundedParams, ...override };
      const terminal = buildSerifTerminal({
        frame,
        leftFlankU: 40,
        rightFlankU: -40,
        left: params,
        right: params,
        undersideCup,
      });
      expect(countOnCurves(terminal.points), JSON.stringify(override)).to.equal(9);
      expect(terminal.points.length, JSON.stringify(override)).to.equal(15);
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js`
Expected: FAIL — `half.release` is `undefined`.

- [ ] **Step 3: Add the rounding to `buildHalfSerif`**

Insert after the `scoop` object, before the `return`:

```js
  // The rounding replaces the corner with two on-curve points, one on the stem's
  // side and one on the wing's inner face, each carrying a handle that runs
  // tangentially along the surface it sits on.
  //
  // It is switched off wherever there is nothing to soften: a half with no wing
  // has no junction at all, and an inward scoop already reads as a bracket. Off
  // means the two points sit exactly on the corner with no handle length — the
  // points are always emitted, they just collapse. That keeps the terminal's
  // point count fixed, which is the interpolation contract.
  const rounds = wingLength !== 0 && amount <= 0;
  const roundDistance = rounds
    ? Math.min(Math.max(params.roundDistance ?? 0, 0), chordLength)
    : 0;
  const roundCurvature = Math.min(Math.max(params.roundCurvature ?? 0, 0), 1);

  const release = { u: corner.u, v: corner.v + roundDistance };
  // The stem's side runs straight, so the handle that leaves the release along
  // it is simply a step back toward the corner.
  const roundControl1 = {
    u: release.u,
    v: release.v - roundDistance * roundCurvature,
  };

  // Split the scoop where the rounding takes over, so the second rounding point
  // sits exactly on the wing's inner face and the handle either side of it is
  // the curve's own — which is what makes it tangent there. What is left of the
  // scoop runs on from that split to the wing's end unchanged in shape.
  const t = chordLength === 0 ? 0 : roundDistance / chordLength;
  const split = splitCubic(scoop, t);
  const roundEnd = split.end;
  const roundControl2 = lerpUV(roundEnd, split.leftControl2, roundCurvature);

  return {
    corner,
    scoop,
    release,
    roundControl1,
    roundControl2,
    roundEnd,
    faceControl1: split.rightControl1,
    faceControl2: split.rightControl2,
    tipTop,
    tipBottom,
    wingInnerV,
  };
```

Keep `lerpUV` (it is still used here) and add the split helper above
`buildHalfSerif`:

```js
// de Casteljau at t. Returns the point at t plus the control adjacent to it on
// each side, which is everything the rounding and the surviving face need.
function splitCubic(cubic, t) {
  const a = lerpUV(cubic.start, cubic.control1, t);
  const b = lerpUV(cubic.control1, cubic.control2, t);
  const c = lerpUV(cubic.control2, cubic.end, t);
  const d = lerpUV(a, b, t);
  const e = lerpUV(b, c, t);
  return {
    end: lerpUV(d, e, t),
    leftControl2: d,
    rightControl1: e,
    rightControl2: c,
  };
}
```

- [ ] **Step 4: Update `buildSerifTerminal`'s signature and emission**

Drop `straightDepth` from the destructured arguments and from both
`buildHalfSerif` calls. Replace the `points` array with:

```js
    // The release is NOT the top of anything the terminal draws — it is where
    // the trimmed stroke edge already ends, and the generator brings that edge
    // to it. Everything from the release inward is the terminal's own.
    points: [
      smoothOnCurve(halves.left.release),
      control(halves.left.roundControl1),
      control(halves.left.roundControl2),
      smoothOnCurve(halves.left.roundEnd),
      control(halves.left.faceControl1),
      control(halves.left.faceControl2),
      onCurve(halves.left.tipTop),
      onCurve(halves.left.tipBottom),
      control(leftCup1),
      control(leftCup2),
      smoothOnCurve(centre),
      control(rightCup1),
      control(rightCup2),
      onCurve(halves.right.tipBottom),
      onCurve(halves.right.tipTop),
      control(halves.right.faceControl2),
      control(halves.right.faceControl1),
      smoothOnCurve(halves.right.roundEnd),
      control(halves.right.roundControl2),
      control(halves.right.roundControl1),
      smoothOnCurve(halves.right.release),
    ],
```

That is 21 entries, 9 of them on-curve. Update the `expect(terminal.points.length)`
assertion in the step 1 test from 15 to 21 before running — the count in the test
above is deliberately wrong so the arithmetic gets checked against the real array
rather than assumed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-serif-geometry.js`
Expected: PASS. Fix any existing test in that file that still passes
`straightDepth` or reads `straightTop` / `straightBottom` / `control1` /
`control2` — those names are gone.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/tests/test-serif-geometry.js
git add .
git commit -m "feat: the serif rounds its junction with the stem, as two tangent points"
```

---

### Task 4: Generator plumbing — defaults, units, release and clamp

`buildSerifCap` changes in three places: the defaults and the unit-scaled field
set, the release it anchors the edge to (now `half.release`), and the clamp,
which stops being about `reach` and becomes about how deep the terminal reaches
into the stroke. The one-unit floor under that clamp comes out (serif backlog
item 3).

**Files:**
- Modify: `fontra-core/src/skeleton-generator.js` (`SERIF_HALF_DEFAULTS` at :4455,
  `SERIF_LENGTH_FIELDS` at :4468, `buildSerifCap` at :4488)
- Test: `fontra-core/tests/test-skeleton-generator.js`
- Regenerate: `fontra-core/tests/data/skeleton-generator/fixtures.json`

**Interfaces:**
- Consumes: `buildHalfSerif`'s `release` from task 3.

- [ ] **Step 1: Write the failing test**

Add to `fontra-core/tests/test-skeleton-generator.js`, beside the existing serif
tests:

```js
it("does not move a serif's on-curve points when only a curvature pin changes", () => {
  // The terminal is fixed in its own frame, so a pin has nothing to move but
  // handle lengths. Sweeping the pin and summing on-curve travel is the direct
  // check; anything above zero means a terminal point is being read off the cut.
  const base = serifTestSkeleton();
  let previous = null;
  let travel = 0;
  for (let step = 0; step <= 40; step++) {
    const data = withSegmentCurvature(base, 0.05 + (step * 0.9) / 40);
    const points = generatedOnCurvePoints(generateFromSkeleton(data));
    if (previous) {
      for (let i = 0; i < points.length; i++) {
        travel += Math.hypot(points[i].x - previous[i].x, points[i].y - previous[i].y);
      }
    }
    previous = points;
  }
  expect(travel).to.equal(0);
});
```

Reuse whatever skeleton builder and pin helper the existing serif and curvature
tests in that file already define; if none is reusable, build a two-point open
contour with `capStyle: "serif"` on the end point and set
`leftSegmentCurvature` / `rightSegmentCurvature` on the start point, matching the
existing curvature-pin tests in the same file.

- [ ] **Step 2: Run it to see the current state**

Run: `cd src-js/fontra-core && npx mocha tests/test-skeleton-generator.js -g "serif"`
Expected: FAIL — most serif tests fail because `buildSerifTerminal`'s signature
changed in task 3. This test is the one that must be green at the end.

- [ ] **Step 3: Update the defaults and the unit-scaled field set**

```js
const SERIF_HALF_DEFAULTS = Object.freeze({
  wingLength: 0,
  tipThickness: 0,
  wingSlope: 0,
  tipCutAngle: 0,
  // A fresh serif should read as a serif, so the wing's inner face starts with a
  // real scoop in it and the junction with the stem starts softened rather than
  // square. `easeAmount`, `easeBalance` and `roundCurvature` are dimensionless,
  // so they need no unit scaling.
  easeAmount: 0.25,
  easeBalance: 0.5,
  roundDistance: 0,
  roundCurvature: 0.5523,
});

const SERIF_LENGTH_FIELDS = new Set([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "roundDistance",
]);
```

- [ ] **Step 4: Replace the reach clamp with a terminal-depth clamp**

In `buildSerifCap`, delete `clampReach`, `leftReach` and `rightReach`, and put
this in their place:

```js
  // A terminal may only consume its own segment. What it reaches into the stroke
  // is the depth of its release — the wing's inner face plus whatever the
  // rounding steps back — so that is what is clamped, by pulling the rounding
  // distance in first. Clamp before constructing the serif as well as before
  // splitting the outline, otherwise the splice stays local while the emitted
  // terminal still reaches into the next segment.
  //
  // There is no floor under this. A terminal is allowed to collapse its points
  // to zero distance; the one-unit minimum that applies elsewhere does not apply
  // inside one.
  const clampDepth = (side, half) => {
    const available = Math.max(getTerminalSegmentLength(side, position) * 0.95, 0);
    const wingInner = (half.tipThickness ?? 0) + (half.wingSlope ?? 0);
    const requested = Math.max(half.roundDistance ?? 0, 0);
    const room = Math.max(available - wingInner, 0);
    return {
      half: { ...half, roundDistance: Math.min(requested, room) },
      clamped: requested > room,
    };
  };
  const leftDepth = clampDepth(leftSide, left);
  const rightDepth = clampDepth(rightSide, right);
```

Rename the two uses below: `left: leftDepth.half`, `right: rightDepth.half`, and
`reachClamped: leftDepth.clamped || rightDepth.clamped`. Keep the returned
property name `reachClamped` only if callers use it — grep for it; if the only
consumer is inside this file, rename it to `depthClamped` at both ends.

- [ ] **Step 5: Point the release at the new point and drop `straightDepth`**

In `terminalArgs`, delete the `straightDepth` line entirely. In `releaseSide`,
change one line:

```js
    const release = frame.toGlyph(half.release);
```

- [ ] **Step 6: Regenerate the golden fixtures**

Run: `cd src-js/fontra-core && node tests/scripts/make-skeleton-generator-fixtures.js`

Then **read the diff on `fixtures.json` before staging it.** Serif fixtures are
expected to change shape. Any non-serif fixture that moves is a bug in this task
— stop and find it rather than accepting the new numbers.

- [ ] **Step 7: Run the whole suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS, including the pin-travel test from step 1 at exactly `0`.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
git add .
git commit -m "feat: the serif cap builds on the rounded release, and clamps its own depth"
```

---

### Task 5: Panel and labels

Four rows change per half and one terminal row disappears. Grouped under two
headers, which is serif backlog item 8 landing early for the two easing groups
only — the rest of that item is a separate pass.

**Files:**
- Modify: `views-editor/src/panel-skeleton-parameters.js` (`_buildSerifSection`
  at :1153)
- Modify: `views-editor/src/skeleton-panel-model.js` (:409)
- Modify: `fontra-core/assets/lang/en.js` (:511–524)

**Interfaces:**
- Consumes: `SERIF_HALF_FIELDS` and `SERIF_TERMINAL_FIELDS` from task 1. The
  panel's read and write paths are generic over those lists and over the
  `serif:<scope>-<field>` key shape, so nothing else needs touching — verify by
  grepping for `serif:` in `skeleton-panel-edits.js` and confirming it parses the
  field name out of the key rather than matching known names.

- [ ] **Step 1: Remove the dropped rows**

In `_buildSerifSection`, delete the `serif:${scope}-reach` row and the
`pushLength("serif:depth", "serif-straight-depth", serif.straightDepth)` line.
In `skeleton-panel-model.js`, delete `straightDepth: terminal("straightDepth"),`.

- [ ] **Step 2: Replace the two easing sliders with four, under headers**

In `pushHalf`, after the tip-cut slider, replace the tension and concavity
sliders with:

```js
      formContents.push({
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-ease"),
      });
      // Signed: negative bulges the wing's inner face outward, 0 is a flat
      // angled cut, positive scoops it inward.
      this._pushSummarySlider(
        formContents,
        `serif:${scope}-easeAmount`,
        "serif-ease-amount",
        percentSummary(half.easeAmount),
        -100,
        100,
        0,
        { step: 1, disabled: !canEdit }
      );
      this._pushSummarySlider(
        formContents,
        `serif:${scope}-easeBalance`,
        "serif-ease-balance",
        percentSummary(half.easeBalance),
        0,
        100,
        0,
        { step: 1, disabled: !canEdit }
      );
      formContents.push({
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-round"),
      });
      pushLength(`serif:${scope}-roundDistance`, "serif-round-distance", half.roundDistance);
      this._pushSummarySlider(
        formContents,
        `serif:${scope}-roundCurvature`,
        "serif-round-curvature",
        percentSummary(half.roundCurvature),
        0,
        100,
        0,
        { step: 1, disabled: !canEdit }
      );
```

Check the two ratio-stored fields against the existing percent handling at
`panel-skeleton-parameters.js:198` and `:220` — those two guards test
`SERIF_HALF_FIELDS.includes(field)` and then decide whether a field is a percent.
`easeAmount`, `easeBalance` and `roundCurvature` are percent-displayed ratios;
`roundDistance` is a length. Extend whatever set those guards consult so the
three new ratios are in it and the old two names are out.

- [ ] **Step 3: Update the labels**

In `fontra-core/assets/lang/en.js`, delete the `serif-reach`, `serif-tension`,
`serif-concavity` and `serif-straight-depth` keys and add:

```js
  "sidebar.skeleton-parameters.serif-ease": "Serif easing",
  "sidebar.skeleton-parameters.serif-ease-amount": "Amount",
  "sidebar.skeleton-parameters.serif-ease-balance": "Balance",
  "sidebar.skeleton-parameters.serif-round": "Contour easing",
  "sidebar.skeleton-parameters.serif-round-distance": "Distance",
  "sidebar.skeleton-parameters.serif-round-curvature": "Curvature",
```

- [ ] **Step 4: Syntax-check**

Run: `cd src-js && node --check views-editor/src/panel-skeleton-parameters.js && node --check views-editor/src/skeleton-panel-model.js && node --check fontra-core/assets/lang/en.js`
Expected: no output.

- [ ] **Step 5: Manual test matrix**

`views-editor` has no test harness, so this is the evidence. Run each and record
the result:

1. Select an open-contour endpoint, set its cap to Serif. It draws as a serif
   with a scooped inner face on both wings.
2. Drag **Amount** from +100% to −100%. The wing's inner face goes from scooped,
   through a flat angled cut at 0, to bulging. The rounding disappears the moment
   it goes positive and comes back the moment it goes negative or zero.
3. Drag **Balance** across its whole range. The deep part of the scoop walks from
   the stem end of the wing to its far end. Both extremes are reachable.
4. With Amount at 0 or negative, drag **Distance**. The junction with the stem
   rounds off, growing back along the stem.
5. Drag **Curvature** at a fixed Distance. The rounding changes how hard it
   bends; the two points do not move.
6. Set **Wing length** to 0 on one half. That half adds nothing — no spur, no
   dimple in the foot line, and the other half is unaffected.
7. Unlink the halves and set all four easing values differently on each. Both
   sides honour their own numbers.
8. Arrow-key any of the four fields repeatedly. Focus stays in the field.
9. Drag each slider. The shape updates live, not only on release.
10. Open a glyph saved before this change with a serif on it. It loads, and the
    old tension/concavity values have carried over to Balance and Amount.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src-js/views-editor/src/panel-skeleton-parameters.js src-js/views-editor/src/skeleton-panel-model.js src-js/fontra-core/assets/lang/en.js
git add .
git commit -m "feat: serif panel gains the two easing groups, loses reach and straight section"
```

---

### Task 6: Documentation

The three standing docs are the reference; a change that is not in them will be
re-derived wrongly later. Two of them currently state things this rework makes
false.

**Files:**
- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md` (§5, §8, §9)
- Modify: `docs/superpowers/SERIF-BACKLOG.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`

- [ ] **Step 1: Feature model §8**

Rewrite the field list: seven fields per half becomes eight — `wingLength`,
`tipThickness`, `wingSlope`, `tipCutAngle`, `easeAmount`, `easeBalance`,
`roundDistance`, `roundCurvature`. Terminal-level becomes `axisMode`,
`axisAngle`, `undersideCup` — `straightDepth` is gone.

Replace the "`tension` and `concavity` must not multiply" paragraph with the new
construction: one scoop across the whole inner face measured off its own chord,
and a separate rounding of two tangent points at the junction, switched off when
the scoop is inward or the half has no wing.

Change "Seven on-curve points per terminal" to **nine**, in the §8 point-count
heading and anywhere else it appears.

Update the release rule: the release is now the stem-side rounding point. The
rule itself is unchanged and still load-bearing — it is fixed in the serif's own
frame and the edge is brought to it.

- [ ] **Step 2: Feature model §5**

The bullet asserting that any non-zero handle length preserves both tangents is
no longer the mechanism. Replace it with: the wing's inner face is tangent-free
at the stem end by design, and the rounding is what makes that junction smooth
when it is wanted.

- [ ] **Step 3: Feature model §9**

Add a row:

```
| **Aim both bracket handles at the wing's inner corner** | Superseded. The corner became the curve's own start point once `reach` and the straight section were removed, so it could no longer be an attractor. The scoop is now measured off its own chord and the junction is rounded explicitly. |
```

Leave the existing tension/concavity row — it records a real dead end that still
should not be re-derived.

- [ ] **Step 4: Backlog**

Mark item 2 done with a short account, the way items 6 and 7 are written. Fold
item 3 into it as done as well, since the handle-share clamps and the one-unit
reach floor both came out here — note that `MAX_HANDLE_TO_CORNER` went too, made
unnecessary by the new construction rather than deliberately dropped, and that
`MIN_AXIS_TANGENT_SEPARATION_DEG` still stands and is still item 1's business.

**Correct the coupling direction in item 2's text.** The document says contour
easing is disabled across serif easing 0 → −1 and enabled on positive values.
That is backwards: it is disabled when the scoop is inward (positive) and present
otherwise. It snaps rather than fading.

Add a line under item 8 noting that the two easing groups already have their
headers, so what is left of it is the Shape group.

- [ ] **Step 5: Development log entry 23**

Follow the existing format — Problem / Solution / Result / Challenges and
findings / Commits. The problem is that reach and slope moved no emitted point
differently at any setting, and that at reach 0 the lower handle collapsed so
slope alone could not produce a bracket. Record the measured evidence from
backlog item 2, the removal of the straight section in the same pass, and that
the terminal went from seven on-curve points to nine.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "docs: the serif easing rework, and the coupling direction corrected"
```

---

## Self-review

**Spec coverage.** Backlog item 2: `reach` removed (task 1, 2, 4), two easings
with the four named parameters (tasks 2, 3, 5), coupling with snap (task 3),
migration (task 1), fixtures regenerated (task 4), panel and inherit chain (task
5), docs (task 6). Mirroring needs no work — it swaps whole `left`/`right`
objects generically, verified at `skeleton-model.js:2204`. Item 3's clamps: two
removed (task 2), the reach floor removed (task 4), `MAX_HANDLE_TO_CORNER`
removed as unnecessary (task 2), the axis separation left to item 1 (task 6).
Straight section removed (tasks 1, 3, 4, 5). The user's correction to the
coupling direction is carried in tasks 3 and 6.

**Types.** `easeAmount`, `easeBalance`, `roundDistance`, `roundCurvature` are
used identically in every task. `buildHalfSerif` returns `release`,
`roundControl1`, `roundControl2`, `roundEnd`, `faceControl1`, `faceControl2`,
`corner`, `scoop`, `tipTop`, `tipBottom`, `wingInnerV`; task 3's emission and
task 4's `releaseSide` consume exactly those names.

**Deliberate gap.** Task 3's step 1 test asserts a point-array length of 15,
which is wrong on purpose — step 4 says to correct it against the real array
rather than trust the arithmetic in this plan.
