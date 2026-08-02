# Serif model rework — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the serif terminal's bracket construction with the one from `docs/superpowers/serif-lab.html`, remove the straight section, and add contour easing — a two-point tangential rounding of the junction where the serif lets go of the stroke.

**Architecture:** The bracket becomes a single-attractor construction. `concavity` places one attractor point between the midpoint of the chord (wing end → junction) and the wing's true inner corner; `tension` is how far both handles travel from their own end toward that attractor. This is the whole fix for the reported bug: the shipped code aims both handles at the fixed corner and measures `reach` from that same corner, which makes `reach` and `wingSlope` emit identical geometry. In the new construction `wingSlope` moves the attractor and `reach` does not, so they stop being interchangeable. The straight section is deleted outright. Contour easing then rounds the junction, which the new construction leaves as a corner at every concavity below 1.

**Tech Stack:** Plain ES modules. `src-js/fontra-core/src/serif-geometry.js` (pure shape in the serif's own frame), `src-js/fontra-core/src/skeleton-generator.js` (trimming, anchoring, splicing), `src-js/fontra-core/src/skeleton-model.js` (field lists, normalization, mirroring), `src-js/views-editor/src/` (panel). Tests are mocha + chai in `src-js/fontra-core/tests/`.

---

## Global Constraints

- **Seven on-curve points per serif terminal, at every parameter value.** Three per half (the rounding's bracket-side point, the wing's tip top, the wing's tip bottom) plus the foot centre. Cross-master interpolation breaks if this varies.
- **Points collapse, they do not disappear.** Zero-length segments and coincident points are correct output inside a terminal. The one-unit minimum separation that applies elsewhere does not apply here.
- **The terminal's on-curves are fixed in the serif's own frame; the stroke edge is brought to them, never the reverse.** Building the terminal off the cut has been tried and reverted — it made a curvature pin walk two on-curves along the stroke. A curvature pin may move handles and nothing else.
- **`serif-geometry.js` never hears about the stroke.** It takes flank positions and numbers, returns points in frame coordinates. Trimming, anchoring and splicing stay in `skeleton-generator.js`. This split is deliberate and is the counter-example to the generator-monolith defect; do not collapse it.
- **Null means inherit.** Serif fields cascade point → contour → source defaults. Never write a resolved value back onto a point to "fix" a null.
- **One copy of every constant and geometry function** (rail R-B). No second implementation of the bracket, the split, or the frame.
- **`fontra-core` has a mocha harness; `views-editor` does not.** Core changes carry automated tests. Panel changes carry a written manual test matrix instead.
- Format with `npx prettier --write <files>` from the repo root before every commit.
- Syntax-check each touched file with `node --check <file>`.
- Run `npm test --workspace src-js/fontra-core` before every commit. Baseline at the time of writing: 1690 passing.
- **Do not run `npm run bundle` or `npm run bundle-watch`.** The user has a bundle watcher running and reports compile errors.

## Assumptions Taken

State these back to the user if any turns out to be wrong; do not silently re-decide them.

1. **Presets and blending are out of scope.** The lab's six named presets and its A→B blend slider are serif backlog items 4 and 5, not shape building. This plan makes them possible — after it, every serif is the same vector of numbers with no discrete types, so any two blend by straight lerp — but it does not build the storage or the UI for them.
2. **The underside cup stays exactly as shipped.** One curve across the whole terminal, centre on the skeleton. The lab's per-half quadratic cup is explicitly rejected. `undersideCup` stays a terminal-level field.
3. **`tipCutAngle` stays an angle.** The lab uses a straight length offset for `tipCut`; forkra uses an angle whose offset is `tipThickness * tan(angle)`. The angle is what a designer thinks about, and it only degenerates at zero tip thickness, where there is no outer edge to slant. Deliberate deviation.
4. **`serifUnitsMode` keeps its `absolute` default.** The lab stores everything divided by stem width. forkra already offers that as `serifUnitsMode: "normalized"` at source level. Flipping the default would silently reinterpret every existing file, so it stays where it is.
5. **Contour easing snaps off when the bracket is hollow, taken literally.** Rounding is off when `concavity > 0`, on at `concavity <= 0`. **Consequence to be aware of:** in the new construction the bracket only meets the flank tangentially at `concavity === 1`. Between 0 and 1 the junction is a corner and, under this rule, no rounding is available to soften it. The alternative — scaling the rounding by `1 - concavity` so it fades out exactly where the bracket becomes tangent on its own — is a one-line change if the user wants it after seeing it on screen. Implement the literal rule.

## File Structure

| File                                                                                   | Responsibility                                  | Change                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-js/fontra-core/src/serif-geometry.js`                                             | Pure serif shape in the serif's own frame       | Rewrite `buildHalfSerif`; add `splitCubic`; rewrite the emission list in `buildSerifTerminal`; drop `straightDepth`, `MIN_HANDLE_SHARE`, `MAX_HANDLE_SHARE`, `MAX_HANDLE_TO_CORNER` |
| `src-js/fontra-core/src/skeleton-generator.js`                                         | Trimming, anchoring, splicing, field resolution | `SERIF_HALF_DEFAULTS`, `SERIF_LENGTH_FIELDS`, `buildSerifCap` release point and depth clamp                                                                                         |
| `src-js/fontra-core/src/skeleton-model.js`                                             | Field lists, normalization, mirroring           | `SERIF_HALF_FIELDS`, `SERIF_TERMINAL_FIELDS`, `normalizeSerif`, `setSkeletonSerifParameters`                                                                                        |
| `src-js/views-editor/src/panel-skeleton-parameters.js`                                 | Serif panel section                             | New rows, group headers, straight-section row removed                                                                                                                               |
| `src-js/views-editor/src/skeleton-panel-model.js`                                      | Panel summary                                   | Drop `straightDepth` from the summary                                                                                                                                               |
| `src-js/fontra-core/assets/lang/en.js`                                                 | UI strings                                      | New keys, one removed                                                                                                                                                               |
| `src-js/fontra-core/tests/test-serif-geometry.js`                                      | Geometry tests                                  | Rewritten                                                                                                                                                                           |
| `src-js/fontra-core/tests/test-skeleton-generator.js`                                  | Generator tests                                 | Field lists in fixtures, clamp tests                                                                                                                                                |
| `src-js/fontra-core/tests/test-skeleton-model.js`                                      | Model tests                                     | Field counts                                                                                                                                                                        |
| `src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js`                 | Fixture generator                               | Drop `straightDepth` from the serif cases                                                                                                                                           |
| `docs/superpowers/SKELETON-FEATURE-MODEL.md`, `SERIF-BACKLOG.md`, `DEVELOPMENT-LOG.md` | Standing docs                                   | Updated in the final task                                                                                                                                                           |

## Field Changes At A Glance

**Half fields** (`SERIF_HALF_FIELDS`, per side, null = inherit):

| Field           | Status                | Meaning                                                                                                                     |
| --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `wingLength`    | unchanged             | How far the wing reaches along the terminal axis. 0 = sans.                                                                 |
| `tipThickness`  | unchanged             | Serif depth at its outer end.                                                                                               |
| `wingSlope`     | unchanged             | How far the inner corner is raised past the tip.                                                                            |
| `tipCutAngle`   | unchanged             | Slant of the outer edge, in degrees.                                                                                        |
| `reach`         | kept, **new meaning** | How far back along the stem flank the transition starts. Now genuinely reshapes the curve.                                  |
| `tension`       | kept, **new meaning** | How far both handles travel toward the attractor. 0 = straight wedge, 1 = both handles on the attractor.                    |
| `concavity`     | kept, **new meaning** | Signed. Places the attractor. Negative bulges convex, 0 is a flat chamfer, 1 puts the attractor on the wing's inner corner. |
| `easeDistance`  | **new**               | How far back from the junction the rounding starts. 0 = no rounding.                                                        |
| `easeCurvature` | **new**               | How hard the rounding bends. 0 = flat chamfer across the corner, 1 = full round.                                            |

**Terminal fields** (`SERIF_TERMINAL_FIELDS`, shared by both halves):

| Field           | Status      |
| --------------- | ----------- |
| `axisAngle`     | unchanged   |
| `undersideCup`  | unchanged   |
| `straightDepth` | **removed** |

`straightDepth` is removed with no migration. `normalizeSerif` stops copying it, so it disappears from any point on the next write; stale values already in files are ignored from the moment this lands.

---

## Task 1: The bracket construction

Replace the handle-length bracket with the lab's single-attractor construction, and delete the straight section from the geometry module. The terminal still emits the junction as an on-curve here, exactly where `straightBottom` was emitted, so the generator keeps working unchanged apart from one renamed field. Contour easing comes in Task 2.

**Files:**

- Modify: `src-js/fontra-core/src/serif-geometry.js:82-268`
- Modify: `src-js/fontra-core/src/skeleton-generator.js:4530-4559`
- Test: `src-js/fontra-core/tests/test-serif-geometry.js`

**Interfaces:**

- Produces: `buildHalfSerif({ side, flankU, params })` → `{ junction, corner, control1, control2, tipTop, tipBottom, wingInnerV }`. All points are `{ u, v }` in frame coordinates. `straightTop` and `straightBottom` no longer exist; `junction` replaces both.
- Produces: `buildSerifTerminal({ frame, leftFlankU, rightFlankU, left, right, undersideCup })` → `{ halves, points }`. The `straightDepth` argument is gone.
- Consumes: `computeSerifFrame` unchanged.

- [ ] **Step 1: Rewrite the geometry tests for the new bracket**

Replace the whole `describe("half serif in frame coordinates", ...)` block in `src-js/fontra-core/tests/test-serif-geometry.js` (lines 113–274) with this. Note `build` no longer takes a `straightDepth` argument.

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
  const build = (overrides = {}, side = 1) =>
    buildHalfSerif({
      side,
      flankU: side * 50,
      params: { ...base, ...overrides },
    });

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

  it("puts the junction reach above the wing inner corner, on the flank", () => {
    const half = build({ wingSlope: 12 });
    expectClose(half.wingInnerV, 42);
    expectClose(half.corner.v, 42);
    expectClose(half.junction.v, 122);
    expectClose(half.junction.u, 50);
  });

  // The midpoint of the transition cubic, which is where the bracket is deepest.
  const belly = (half) => {
    const p = [half.tipTop, half.control1, half.control2, half.junction];
    return {
      u: (p[0].u + 3 * p[1].u + 3 * p[2].u + p[3].u) / 8,
      v: (p[0].v + 3 * p[1].v + 3 * p[2].v + p[3].v) / 8,
    };
  };

  const chordVAt = (half, u) =>
    half.tipTop.v +
    ((u - half.tipTop.u) / (half.junction.u - half.tipTop.u)) *
      (half.junction.v - half.tipTop.v);

  it("collapses the transition to the chord at concavity zero", () => {
    // The attractor starts life at the chord midpoint, so with no concavity both
    // handles slide along the chord and the cubic is the chord. A flat chamfer
    // is a real shape, not a failure.
    for (const tension of [0, 0.5, 1]) {
      const half = build({ tension, concavity: 0 });
      expectClose(half.control1.v, chordVAt(half, half.control1.u));
      expectClose(half.control2.v, chordVAt(half, half.control2.u));
    }
  });

  it("collapses the transition to the chord at tension zero", () => {
    // Both handles sit on their own ends, whatever the attractor is doing.
    for (const concavity of [-1, 0.5, 1]) {
      const half = build({ tension: 0, concavity });
      expectClose(half.control1.u, half.tipTop.u);
      expectClose(half.control1.v, half.tipTop.v);
      expectClose(half.control2.u, half.junction.u);
      expectClose(half.control2.v, half.junction.v);
    }
  });

  it("puts both handles on the wing's inner corner at full tension and concavity", () => {
    const half = build({ tension: 1, concavity: 1 });
    expectClose(half.control1.u, half.corner.u);
    expectClose(half.control1.v, half.corner.v);
    expectClose(half.control2.u, half.corner.u);
    expectClose(half.control2.v, half.corner.v);
  });

  it("leaves the junction tangent to the flank at full concavity", () => {
    // The attractor lands on the corner, which is straight down the flank from
    // the junction, so the bracket departs along the flank with no corner.
    for (const tension of [0.2, 0.6, 1]) {
      const half = build({ tension, concavity: 1 });
      expectClose(half.control2.u, half.junction.u, `tension ${tension}`);
    }
  });

  it("deepens the bracket with concavity", () => {
    const flat = belly(build({ concavity: 0 })).v;
    const shallow = belly(build({ concavity: 0.25 })).v;
    const deep = belly(build({ concavity: 1 })).v;
    // The inner corner is below the chord, so a deeper hollow means a lower belly.
    expect(deep).to.be.below(shallow);
    expect(shallow).to.be.below(flat);
  });

  it("bulges the transition convex at negative concavity", () => {
    const bulged = belly(build({ concavity: -0.8 })).v;
    const flat = belly(build({ concavity: 0 })).v;
    expect(bulged).to.be.above(flat);
  });

  it("deepens the bracket with tension, at one attractor", () => {
    const slack = belly(build({ tension: 0.2, concavity: 0.8 })).v;
    const taut = belly(build({ tension: 0.9, concavity: 0.8 })).v;
    expect(taut).to.be.below(slack);
  });

  // This is the bug the rework exists to fix. Under the shipped model these two
  // produced identical geometry, because both handles aimed at the corner and
  // reach was measured from it, so slope's only effect was lifting the junction.
  it("does not let wing slope and reach stand in for each other", () => {
    const bySlope = build({ wingSlope: 40, reach: 0, concavity: 0.8 });
    const byReach = build({ wingSlope: 0, reach: 40, concavity: 0.8 });
    expectClose(bySlope.junction.v, byReach.junction.v);
    // Same junction, different corner, so different attractor and curve.
    expect(Math.abs(bySlope.control1.v - byReach.control1.v)).to.be.above(1);
  });

  it("keeps a wingless half flat on the flank without a special case", () => {
    // Everything collapses onto the flank line on its own: tip, corner, junction
    // and both handles all sit at flankU, so a half with no wing adds nothing.
    const half = build({ wingLength: 0, concavity: 1, tension: 1 });
    for (const point of [
      half.tipTop,
      half.tipBottom,
      half.corner,
      half.junction,
      half.control1,
      half.control2,
    ]) {
      expectClose(point.u, 50);
    }
  });

  it("returns the same key set at every value", () => {
    const keys = (params) => Object.keys(build(params)).sort().join(",");
    expect(keys({})).to.equal(keys({ wingLength: 0, reach: 0, concavity: -1 }));
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test --workspace src-js/fontra-core`
Expected: FAIL. `buildHalfSerif` still returns `straightTop`/`straightBottom`, so every test that reads `half.junction` or `half.corner` fails on undefined.

- [ ] **Step 3: Rewrite `buildHalfSerif`**

In `src-js/fontra-core/src/serif-geometry.js`, delete the three handle-share constants at lines 84–93:

```js
// How lopsided the two transition handles are allowed to get. ...
const MIN_HANDLE_SHARE = 0.25;
const MAX_HANDLE_SHARE = 0.75;

// A handle that reaches the corner exactly is the deepest bracket available. ...
const MAX_HANDLE_TO_CORNER = 1;
```

They exist only to stop the old construction from degenerating. In the new one `tension` and `concavity` are plain interpolation factors over their own full ranges, and neither can produce a crossed or looped curve: both handles interpolate toward one shared point, so at worst they meet on it.

Then replace `buildHalfSerif` (lines 99–187) with:

```js
// One half-serif, entirely in frame coordinates. `side` is +1 for the left half
// and -1 for the right, so the same numbers describe both and the caller never
// mirrors anything by hand.
//
// The bracket is one cubic from the wing's tip top to the junction on the flank,
// built around a single attractor:
//
//   concavity places the attractor. It starts at the midpoint of the chord from
//   the tip to the junction and travels toward the wing's inner corner. At 0 it
//   stays on the chord and the bracket is a flat chamfer; at 1 it lands on the
//   corner, which is straight down the flank from the junction, so the bracket
//   leaves the flank tangentially; negative sends it across the chord the other
//   way for a convex bulge.
//
//   tension is how far both handles travel from their own end toward that
//   attractor. At 0 they sit on their ends and the bracket is a straight wedge.
//
// The wing's inner corner is NOT a returned point in the sense of being emitted.
// It is the attractor's anchor, and it is returned only so the caller and the
// tests can talk about it. Emitting it would split the sweep from tip to flank
// into two segments and destroy the bracketed look.
//
// This is the construction from the serif-lab mockup. The shipped one aimed both
// handles at the corner directly and measured reach from the corner, which made
// wingSlope and reach interchangeable — slope lifted the junction and that lift
// was all reach did. Here slope moves the attractor and reach does not, so the
// two are independent.
export function buildHalfSerif({ side, flankU, params }) {
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

  const wingInnerV = tipThickness + wingSlope;
  const tipU = flankU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };
  const corner = { u: flankU, v: wingInnerV };
  // Where the serif lets go of the stroke. It sits on the flank line, straight
  // out from the rib end, and is a function of the serif's own numbers alone.
  //
  // Reading it off the stroke edge instead is tempting, because on a curved
  // approach the edge has drifted off the flank by the time it gets this far.
  // But then anything that reshapes the edge - a curvature pin above all - slides
  // this on-curve along the stroke, and a curvature pin is only allowed to change
  // handles. The caller brings the edge to this point instead.
  const junction = { u: flankU, v: wingInnerV + reach };

  const midChord = lerpUV(tipTop, junction, 0.5);
  // Lerp past either end is intended: concavity is signed, and -1 puts the
  // attractor as far across the chord from the corner as +1 puts it on the corner.
  const attractor = lerpUV(midChord, corner, concavity);
  const control1 = lerpUV(tipTop, attractor, tension);
  const control2 = lerpUV(junction, attractor, tension);

  return { junction, corner, control1, control2, tipTop, tipBottom, wingInnerV };
}
```

Note what is gone besides the constants: the `depthOfStraight` line, the `hollow = wingLength === 0 ? 0 : concavity` special case, and the `share`/`clampShare`/`handle` helpers. The wingless case needs no guard now — with `wingLength` at 0 the tip, corner, junction and both handles all land on `flankU`, so the half is a straight run down the flank and adds nothing on its own.

- [ ] **Step 4: Update `buildSerifTerminal` for the renamed points**

In the same file, drop `straightDepth` from the parameter list and both `buildHalfSerif` calls, and swap the two emitted `straightBottom` references for `junction`. The emission list is otherwise unchanged in this task.

```js
export function buildSerifTerminal({
  frame,
  leftFlankU,
  rightFlankU,
  left,
  right,
  undersideCup,
}) {
  const halves = {
    left: buildHalfSerif({ side: 1, flankU: leftFlankU, params: left }),
    right: buildHalfSerif({ side: -1, flankU: rightFlankU, params: right }),
  };
```

and in the returned `points` array, `smoothOnCurve(halves.left.straightBottom)` becomes `smoothOnCurve(halves.left.junction)`, and likewise for the right half. Update the two comment blocks at lines 204–212 and 246–249 that name `straightTop`/`straightBottom` and the straight section — the straight section no longer exists, and the junction is where the trimmed edge ends.

- [ ] **Step 5: Point the generator at the renamed release**

In `src-js/fontra-core/src/skeleton-generator.js`, in `buildSerifCap`:

- Delete the `straightDepth` entry from `terminalArgs` (lines 4548–4549).
- In `releaseSide`, change `const release = frame.toGlyph(half.straightTop);` to `const release = frame.toGlyph(half.junction);`.

- [ ] **Step 6: Update the terminal-assembly tests**

In `src-js/fontra-core/tests/test-serif-geometry.js`, in `describe("serif terminal assembly", ...)`:

- Remove `straightDepth: 0,` from the `buildSerifTerminal` call in the `terminal` helper.
- Change the last test's body to read `junction` instead of `straightBottom`:

```js
it("returns the frame-space halves for the caller's trimming maths", () => {
  const { halves } = terminal();
  expectClose(halves.left.junction.u, 50);
  expectClose(halves.right.junction.u, -50);
});
```

- [ ] **Step 7: Drop `straightDepth` from the generator test fixtures**

In `src-js/fontra-core/tests/test-skeleton-generator.js`, remove the `straightDepth: 0,` line from the four inline serif objects at lines 1514, 1578, 1634 and 1683. In `src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js`, remove it at lines 413 and 451.

- [ ] **Step 8: Regenerate the generator fixtures**

Serif outlines change shape, so the recorded fixtures no longer match.

Run: `node src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js`

Then inspect the diff on `src-js/fontra-core/tests/data/skeleton-generator/fixtures.json` and confirm **only** the four serif cases moved — `serif-slab`, `serif-didone`, `serif-one-sided`, `serif-horizontal-axis-curve-terminal`. If anything non-serif moved, stop: something outside the serif path changed and needs explaining before the commit.

Run: `git diff --stat src-js/fontra-core/tests/data/skeleton-generator/fixtures.json`

- [ ] **Step 9: Run the tests**

Run: `npm test --workspace src-js/fontra-core`
Expected: PASS.

- [ ] **Step 10: Format, check and commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-serif-geometry.js src-js/fontra-core/tests/test-skeleton-generator.js src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js
node --check src-js/fontra-core/src/serif-geometry.js
node --check src-js/fontra-core/src/skeleton-generator.js
npm test --workspace src-js/fontra-core
git add .
git commit -m "feat: rebuild the serif bracket around one attractor"
```

---

## Task 2: Contour easing

Round the junction where the serif lets go of the stroke, with two on-curve points whose handles run tangent to the surface each one sits on — one on the stem flank, one on the bracket. The point on the flank becomes the new release: the stroke edge is brought to it, and the terminal stops emitting an on-curve there, which also removes a duplicate point that the shipped code has been emitting at every default terminal.

**Files:**

- Modify: `src-js/fontra-core/src/serif-geometry.js`
- Modify: `src-js/fontra-core/src/skeleton-generator.js:4558-4567`
- Test: `src-js/fontra-core/tests/test-serif-geometry.js`

**Interfaces:**

- Produces: `buildHalfSerif` gains `easeDistance` and `easeCurvature` in `params` and returns four more fields — `release`, `easeFlankHandle`, `easeOnBracket`, `easeBracketHandle`. `control1` and `control2` become the split bracket's handles rather than the full bracket's.
- Produces: `buildSerifTerminal` emits 19 points, 7 on-curve, and its first element is a control point rather than an on-curve.
- Consumes: `buildSerifCap` now brings the edge to `half.release`, not `half.junction`.

**Why the release stops being emitted:** `trimSideForRoundCapEmission` splices out the original stroke endpoint and keeps the inserted release point, so the trimmed side already ends at the release. The shipped terminal then emits `straightBottom` as its first on-curve — which, at the default `straightDepth` of 0, is the same point. Every default serif terminal has therefore been emitting a duplicate on-curve at each release. With the straight section gone that duplicate would be permanent, so the terminal now starts with the release's outgoing handle instead. The on-curve count per terminal stays at seven.

- [ ] **Step 1: Write the failing tests**

Append to `src-js/fontra-core/tests/test-serif-geometry.js`, inside the `describe("half serif in frame coordinates", ...)` block, before its closing brace:

```js
const eased = (overrides = {}) =>
  build({ concavity: -0.4, easeDistance: 20, easeCurvature: 0.6, ...overrides });

it("puts the release back along the flank by the ease distance", () => {
  const half = eased();
  expectClose(half.release.u, half.junction.u);
  expectClose(half.release.v - half.junction.v, 20);
});

it("collapses the rounding onto the junction at ease distance zero", () => {
  const half = eased({ easeDistance: 0 });
  for (const point of [
    half.release,
    half.easeFlankHandle,
    half.easeOnBracket,
    half.easeBracketHandle,
  ]) {
    expectClose(point.u, half.junction.u);
    expectClose(point.v, half.junction.v);
  }
});

it("leaves the bracket untouched at ease distance zero", () => {
  const plain = build({ concavity: -0.4 });
  const half = eased({ easeDistance: 0 });
  expectClose(half.control1.u, plain.control1.u);
  expectClose(half.control1.v, plain.control1.v);
  expectClose(half.control2.u, plain.control2.u);
  expectClose(half.control2.v, plain.control2.v);
});

it("runs the flank handle along the flank, toward the junction", () => {
  const half = eased();
  expectClose(half.easeFlankHandle.u, half.release.u);
  expect(half.easeFlankHandle.v).to.be.below(half.release.v);
  expect(half.easeFlankHandle.v).to.be.above(half.junction.v - 1e-9);
});

it("scales both rounding handles with the curvature", () => {
  const soft = eased({ easeCurvature: 0.2 });
  const hard = eased({ easeCurvature: 1 });
  const reachOf = (half) =>
    Math.hypot(
      half.easeFlankHandle.u - half.release.u,
      half.easeFlankHandle.v - half.release.v
    );
  expect(reachOf(hard)).to.be.above(reachOf(soft));
});

it("collapses both rounding handles onto their points at curvature zero", () => {
  const half = eased({ easeCurvature: 0 });
  expectClose(half.easeFlankHandle.u, half.release.u);
  expectClose(half.easeFlankHandle.v, half.release.v);
  expectClose(half.easeBracketHandle.u, half.easeOnBracket.u);
  expectClose(half.easeBracketHandle.v, half.easeOnBracket.v);
});

it("keeps the bracket handle tangent to the bracket at the rounding", () => {
  // easeBracketHandle and control2 both leave easeOnBracket, one toward the
  // junction and one toward the tip. They are the same tangent split in two, so
  // the point is smooth and stays smooth when it is dragged.
  const cross = (a, b) => Math.abs(a.u * b.v - a.v * b.u);
  for (const easeCurvature of [0.2, 0.6, 1]) {
    for (const side of [1, -1]) {
      const half = build({ concavity: -0.4, easeDistance: 20, easeCurvature }, side);
      const out = {
        u: half.easeBracketHandle.u - half.easeOnBracket.u,
        v: half.easeBracketHandle.v - half.easeOnBracket.v,
      };
      const back = {
        u: half.control2.u - half.easeOnBracket.u,
        v: half.control2.v - half.easeOnBracket.v,
      };
      expectClose(cross(out, back), 0, `curvature ${easeCurvature} side ${side}`);
    }
  }
});

it("snaps the rounding off once the bracket is hollow", () => {
  // A scooped wing is meant to run into the flank; a rounding there fights it.
  const hollow = build({ concavity: 0.4, easeDistance: 20, easeCurvature: 0.6 });
  expectClose(hollow.release.v, hollow.junction.v);
  expectClose(hollow.easeOnBracket.u, hollow.junction.u);
});

it("keeps the rounding on a flat or convex bracket", () => {
  for (const concavity of [0, -0.5, -1]) {
    const half = build({ concavity, easeDistance: 20, easeCurvature: 0.6 });
    expect(half.release.v - half.junction.v, `concavity ${concavity}`).to.equal(20);
  }
});

it("never lets the rounding eat more than half the bracket", () => {
  const half = eased({ easeDistance: 10000 });
  // The split point stays past the middle of the bracket, measured from the tip.
  const chord = Math.hypot(
    half.junction.u - half.tipTop.u,
    half.junction.v - half.tipTop.v
  );
  const fromTip = Math.hypot(
    half.easeOnBracket.u - half.tipTop.u,
    half.easeOnBracket.v - half.tipTop.v
  );
  expect(fromTip).to.be.above(chord * 0.3);
});
```

And replace the terminal-assembly point-count tests in `describe("serif terminal assembly", ...)` — the two `it` blocks at lines 306–323 — with:

```js
it("emits exactly seven on-curve points", () => {
  const { points } = terminal();
  expect(points.filter((point) => !point.type)).to.have.length(7);
});

it("keeps seven on-curve points at every degenerate value", () => {
  const flat = {
    wingLength: 0,
    tipThickness: 0,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 0,
    tension: 0,
    concavity: 0,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const { points } = terminal({ left: flat, right: flat, undersideCup: 0 });
  expect(points.filter((point) => !point.type)).to.have.length(7);
});

it("keeps seven on-curve points with the rounding switched on", () => {
  const rounded = { ...half, concavity: -0.4, easeDistance: 20, easeCurvature: 0.6 };
  const { points } = terminal({ left: rounded, right: rounded });
  expect(points.filter((point) => !point.type)).to.have.length(7);
});

it("starts and ends with a handle, not an on-curve", () => {
  // The trimmed stroke edge already ends at the release, so the terminal opens
  // with that release's outgoing handle. Emitting the release again would stack
  // two on-curves on one spot.
  const { points } = terminal();
  expect(points[0].type).to.equal("cubic");
  expect(points[points.length - 1].type).to.equal("cubic");
});
```

The foot-centre tests in that block index the on-curve list at `[3]`, which is still the centre with three on-curves per half. Leave them alone.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test --workspace src-js/fontra-core`
Expected: FAIL on `half.release` being undefined, and on the terminal's first point being an on-curve.

- [ ] **Step 3: Add the cubic split helper**

In `src-js/fontra-core/src/serif-geometry.js`, next to `lerpUV`:

```js
// De Casteljau. Returns both halves of a cubic cut at t, each as its own four
// points, so the caller gets the split point's tangent on both sides for free.
function splitCubic(p0, p1, p2, p3, t) {
  const a = lerpUV(p0, p1, t);
  const b = lerpUV(p1, p2, t);
  const c = lerpUV(p2, p3, t);
  const d = lerpUV(a, b, t);
  const e = lerpUV(b, c, t);
  const f = lerpUV(d, e, t);
  return { first: [p0, a, d, f], second: [f, e, c, p3] };
}
```

- [ ] **Step 4: Add the easing constant**

Below `MAX_TIP_CUT_ANGLE`:

```js
// The rounding is cut off the bracket by chord fraction, so a distance larger
// than the bracket would otherwise consume all of it and leave no bracket to
// round. Half is as far as it may go.
const MAX_EASE_FRACTION = 0.5;
```

- [ ] **Step 5: Extend `buildHalfSerif`**

Insert after the `control1`/`control2` lines, before the return:

```js
// Contour easing. In this construction the bracket only meets the flank
// tangentially at concavity 1; below that the junction is a corner. The
// rounding replaces that corner with two on-curves, one on the flank and one on
// the bracket, each carrying a handle along the surface it sits on.
//
// It snaps off the moment the bracket goes hollow. A scooped wing is meant to
// run into the flank, and a rounding there would fight it.
const easeOff = concavity > 0;
const easeDistance = easeOff ? 0 : Math.max(params.easeDistance ?? 0, 0);
const easeCurvature = Math.min(Math.max(params.easeCurvature ?? 0, 0), 1);
const chord = Math.hypot(junction.u - tipTop.u, junction.v - tipTop.v);
const easeFraction = chord > 0 ? Math.min(easeDistance / chord, MAX_EASE_FRACTION) : 0;

// Cut the bracket short of the junction. At fraction 0 the split is a no-op and
// `first` is the original cubic, so everything below collapses onto the
// junction without a branch.
const bracket = splitCubic(tipTop, control1, control2, junction, 1 - easeFraction);
const easeOnBracket = bracket.first[3];
// Where the serif now lets go of the stroke. With no easing this is the
// junction itself.
const release = { u: flankU, v: junction.v + easeDistance };
const easeFlankHandle = lerpUV(release, junction, easeCurvature);
const easeBracketHandle = lerpUV(easeOnBracket, bracket.second[1], easeCurvature);

return {
  junction,
  corner,
  release,
  easeFlankHandle,
  easeOnBracket,
  easeBracketHandle,
  control1: bracket.first[1],
  control2: bracket.first[2],
  tipTop,
  tipBottom,
  wingInnerV,
};
```

and delete the old one-line `return { junction, corner, control1, control2, ... }` from Task 1.

Note the returned `control1`/`control2` are now the split bracket's handles. At ease distance 0 the split is at t = 1, which reproduces the input cubic exactly, so they are unchanged — that is what the "leaves the bracket untouched" test pins.

The rounding's own segment runs from `release` to `easeOnBracket`. The flank handle interpolates from the release toward the junction, so at curvature 1 it lands on the junction and at 0 it collapses onto the release, giving a straight chamfer across the corner. The bracket handle does the same along the bracket's tangent at the split.

A distance larger than the bracket's chord is clamped on the bracket side but not on the flank side, so the two ends of the rounding stop being symmetric there. That is bounded and continuous, and the generator clamps the whole terminal depth against the available segment anyway.

- [ ] **Step 6: Rewrite the terminal emission**

Replace the `points` array in `buildSerifTerminal` and the comment above it:

```js
    // The release is NOT emitted. The trimmed stroke edge already ends there, so
    // emitting it too would stack a second on-curve on the same spot. What the
    // terminal owns is that release's outgoing handle, which is why this list
    // opens and closes with a control point.
    //
    // Per half, from the stroke edge inward: the rounding's two handles, its
    // on-curve on the bracket, the bracket's own two handles, the wing's tip top
    // and tip bottom. Three on-curves a half, plus the foot centre, is seven.
    points: [
      control(halves.left.easeFlankHandle),
      control(halves.left.easeBracketHandle),
      smoothOnCurve(halves.left.easeOnBracket),
      control(halves.left.control2),
      control(halves.left.control1),
      onCurve(halves.left.tipTop),
      onCurve(halves.left.tipBottom),
      control(leftCup1),
      control(leftCup2),
      smoothOnCurve(centre),
      control(rightCup1),
      control(rightCup2),
      onCurve(halves.right.tipBottom),
      onCurve(halves.right.tipTop),
      control(halves.right.control1),
      control(halves.right.control2),
      smoothOnCurve(halves.right.easeOnBracket),
      control(halves.right.easeBracketHandle),
      control(halves.right.easeFlankHandle),
    ],
```

Update the `smoothOnCurve` comment above it: the two smooth points are now the rounding's bracket-side on-curve, whose handles are one tangent split in two, and the foot centre, which sits mid-curve in the single underside sweep.

- [ ] **Step 7: Bring the edge to the release**

In `src-js/fontra-core/src/skeleton-generator.js`, in `buildSerifCap`'s `releaseSide`, change `frame.toGlyph(half.junction)` back to `frame.toGlyph(half.release)`.

- [ ] **Step 8: Verify the splice still holds**

The terminal's first emitted element is now a control point where it used to be an on-curve. Read the two call sites — `skeleton-generator.js:1702-1723` and `:1904-1925` — and confirm nothing indexes `capPoints[0]` expecting an on-curve, and that `withRoundCapProvenance` is applied per point regardless of type (it is, at line 4573). Also confirm `buildInsertedRoundCapPoint` sets `smooth: true` on the release (it does, at line 3047), so the release reads as a smooth point in the editor now that it has a tangential handle on both sides.

If either call site does index the first cap point, note it and stop — that is a real coupling and needs its own fix, not a workaround here.

- [ ] **Step 9: Regenerate the fixtures and check the diff**

Run: `node src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js`

The four serif cases lose one point per terminal side — the duplicate release. Confirm nothing non-serif moved.

- [ ] **Step 10: Run the tests**

Run: `npm test --workspace src-js/fontra-core`
Expected: PASS.

- [ ] **Step 11: Format, check and commit**

```bash
npx prettier --write src-js/fontra-core/src/serif-geometry.js src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-serif-geometry.js
node --check src-js/fontra-core/src/serif-geometry.js
node --check src-js/fontra-core/src/skeleton-generator.js
npm test --workspace src-js/fontra-core
git add .
git commit -m "feat: ease the serif's junction with the stroke into a rounding"
```

---

## Task 3: Model fields

Make the two new half fields storable and drop the straight section from the schema.

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-model.js:82-103, 2030-2060, 3106-3130`
- Test: `src-js/fontra-core/tests/test-skeleton-model.js:1012-1056`

**Interfaces:**

- Produces: `SERIF_HALF_FIELDS` is nine names — the seven that exist plus `easeDistance` and `easeCurvature`. `SERIF_TERMINAL_FIELDS` is two — `axisAngle` and `undersideCup`.
- Consumes: nothing from Tasks 1 and 2.

Mirroring needs no work: `skeleton-model.js:2204` swaps the whole `left` and `right` serif objects on a determinant flip, so new half fields ride along. Verify with the test in Step 1 rather than trusting this note.

- [ ] **Step 1: Write the failing tests**

In `src-js/fontra-core/tests/test-skeleton-model.js`, in `describe("skeleton-model serif schema", ...)`:

- Change `expect(Object.keys(point.serif.left)).to.have.length(7);` at line 1027 to `.to.have.length(9);`
- Delete `expect(point.serif.straightDepth).to.equal(null);` at line 1049
- Add after it:

```js
it("defaults the easing fields to inherit", () => {
  const point = normalizeSkeletonPoint({
    x: 0,
    y: 0,
    capStyle: "serif",
    serif: { left: { wingLength: 40 } },
  });
  expect(point.serif.left.easeDistance).to.equal(null);
  expect(point.serif.left.easeCurvature).to.equal(null);
});

it("drops the removed straight section", () => {
  const point = normalizeSkeletonPoint({
    x: 0,
    y: 0,
    capStyle: "serif",
    serif: { straightDepth: 30 },
  });
  expect(point.serif.straightDepth).to.equal(undefined);
});
```

And in `describe("skeleton-model serif mirroring", ...)`, add:

```js
it("swaps the easing fields with the rest of the half", () => {
  const point = normalizeSkeletonPoint({
    x: 0,
    y: 0,
    capStyle: "serif",
    serif: {
      left: { easeDistance: 12 },
      right: { easeDistance: 40 },
    },
  });
  mirrorSkeletonPointForTransform(point, { xx: -1, xy: 0, yx: 0, yy: 1 });
  expect(point.serif.left.easeDistance).to.equal(40);
  expect(point.serif.right.easeDistance).to.equal(12);
});
```

Match the mirroring helper's real name and call shape to the ones already used in that describe block at lines 1058–1110; do not invent a signature.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test --workspace src-js/fontra-core`
Expected: FAIL on the key count and on `easeDistance` being undefined.

- [ ] **Step 3: Update the field lists**

In `src-js/fontra-core/src/skeleton-model.js`:

```js
// One half-serif's shape. Absolute font units unless the source's serif units
// mode says otherwise; `tipCutAngle` is degrees and `tension`, `concavity` and
// `easeCurvature` are dimensionless in every mode. Null means "inherit", so the
// contour and source defaults stay live consumers the way stroke width does.
export const SERIF_HALF_FIELDS = Object.freeze([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "tipCutAngle",
  "reach",
  "tension",
  "concavity",
  "easeDistance",
  "easeCurvature",
]);

// Shared by both halves of one terminal. The underside cup is deliberately NOT
// per half: the foot is one curve across the whole terminal, and one cup per
// half produces two scoops meeting at a break in the middle.
export const SERIF_TERMINAL_FIELDS = Object.freeze(["axisAngle", "undersideCup"]);
```

- [ ] **Step 4: Route the two hardcoded lists through the exported ones**

`setSkeletonSerifParameters` at line 2053 loops a hardcoded `["axisAngle", "undersideCup", "straightDepth"]`. Replace it with `SERIF_TERMINAL_FIELDS`. `normalizeSerif` at line 3124 loops `["undersideCup", "straightDepth"]` — that one deliberately excludes `axisAngle`, which is normalized separately just above with its own default of 0, so replace it with a filtered read rather than the bare list:

```js
for (const field of SERIF_TERMINAL_FIELDS) {
  if (field === "axisAngle") continue;
  normalized[field] = Number.isFinite(serif?.[field]) ? serif[field] : null;
}
```

Match the surrounding code's actual variable names when you write this — read lines 3114–3130 first.

- [ ] **Step 5: Run the tests**

Run: `npm test --workspace src-js/fontra-core`
Expected: PASS.

- [ ] **Step 6: Format, check and commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-model.js src-js/fontra-core/tests/test-skeleton-model.js
node --check src-js/fontra-core/src/skeleton-model.js
npm test --workspace src-js/fontra-core
git add .
git commit -m "feat: store the serif's easing fields, drop the straight section"
```

---

## Task 4: Generator plumbing

Give the new fields defaults and unit scaling, and replace the reach clamp with one that bounds the terminal's whole depth.

**Files:**

- Modify: `src-js/fontra-core/src/skeleton-generator.js:4455-4473, 4527-4550`
- Test: `src-js/fontra-core/tests/test-skeleton-generator.js:1483-1545`

**Interfaces:**

- Produces: `SERIF_HALF_DEFAULTS` gains `easeDistance: 0` and `easeCurvature: 0.5`, and its `tension`/`concavity` defaults change to 0.7 and 0.8. `SERIF_LENGTH_FIELDS` gains `easeDistance`.
- Produces: `buildSerifCap` returns `depthClamped` in place of `reachClamped`.
- Consumes: `buildHalfSerif`'s `params` shape from Task 2.

**On the defaults:** the development log records that letting tension and concavity scale each other was built and reverted. The revert was about defaults, not the model: both defaulted to zero, so a fresh serif drew a flat bevel and neither slider appeared to do anything. In the lab's model a flat chamfer at concavity 0 is an intended shape, and the defaults are a real serif. Task 6 records this so the reverted row is not read as a standing prohibition.

`reachClamped` is currently returned by `buildSerifCap` and read by nobody. It is renamed here rather than deleted, on the grounds that a clamp that reports nothing is worse than one nobody has wired up yet.

- [ ] **Step 1: Write the failing tests**

In `src-js/fontra-core/tests/test-skeleton-generator.js`, replace `describe("skeleton-generator serif reach clamping", ...)` (lines 1483–1545) with:

```js
describe("skeleton-generator serif terminal depth clamping", () => {
  function shortStem(overrides) {
    const half = {
      wingLength: 80,
      tipThickness: 30,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 0,
      tension: 0.7,
      concavity: -0.4,
      easeDistance: 0,
      easeCurvature: 0.6,
      ...overrides,
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
                left: half,
                right: half,
                axisMode: "perpendicular",
                axisAngle: 0,
                undersideCup: 0,
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

  it("never consumes more than the terminal segment with reach alone", () => {
    const result = generateFromSkeleton(shortStem({ reach: 400 }));
    const ys = result.contours[0].points.map((point) => point.y);
    expect(Math.max(...ys)).to.be.closeTo(400, 2);
  });

  it("never consumes more than the terminal segment with the easing on top", () => {
    // The rounding sits further back along the flank than the junction does, so
    // the clamp has to bound reach and ease distance together, not one at a time.
    const result = generateFromSkeleton(shortStem({ reach: 30, easeDistance: 400 }));
    const ys = result.contours[0].points.map((point) => point.y);
    expect(Math.max(...ys)).to.be.closeTo(400, 2);
  });

  it("keeps the emitted point count stable at the clamped terminal", () => {
    const clamped = generateFromSkeleton(shortStem({ reach: 400 }));
    const roomy = generateFromSkeleton(shortStem({ reach: 20 }));
    expect(clamped.contours[0].points.length).to.equal(roomy.contours[0].points.length);
  });

  it("produces a finite outline when the terminal far exceeds the segment", () => {
    const result = generateFromSkeleton(
      shortStem({ reach: 10000, easeDistance: 10000 })
    );
    for (const point of result.contours[0].points) {
      expect(Number.isFinite(point.x)).to.equal(true);
      expect(Number.isFinite(point.y)).to.equal(true);
    }
  });
});
```

Then extend the sweep list in `describe("skeleton-generator serif stability", ...)` at lines 1692–1700 with the two new fields, and add them to its `base` object:

```js
const base = {
  wingLength: 80,
  tipThickness: 30,
  wingSlope: 10,
  tipCutAngle: 5,
  reach: 60,
  tension: 0.7,
  // Negative so the easing is live across the sweep; the rounding snaps off on
  // a hollow bracket and a sweep through the snap is the point of the next test.
  concavity: -0.4,
  easeDistance: 20,
  easeCurvature: 0.6,
};
```

```js
  for (const [field, from, to] of [
    ["wingLength", 20, 140],
    ["tipThickness", 10, 90],
    ["wingSlope", -20, 60],
    ["tipCutAngle", -30, 30],
    ["reach", 20, 200],
    ["tension", 0.05, 0.95],
    ["concavity", -0.9, 0.9],
    ["easeDistance", 0, 120],
    ["easeCurvature", 0, 1],
  ]) {
```

The `concavity` sweep from -0.9 to 0.9 now crosses the point where the rounding snaps off. The point count must not move across it — that is exactly what "points collapse, they do not disappear" buys, and it is the test that proves the snap is safe.

And add `easeDistance` to the ratios in `describe("skeleton-generator serif units mode", ...)` at line 1548 so the normalized-units test covers it:

```js
const ratios = {
  wingLength: 0.8,
  tipThickness: 0.3,
  wingSlope: 0,
  tipCutAngle: 10,
  reach: 0.6,
  tension: 0.7,
  concavity: -0.4,
  easeDistance: 0.2,
  easeCurvature: 0.6,
};
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test --workspace src-js/fontra-core`
Expected: FAIL on the ease-distance clamp test — the terminal reaches past 400 because only `reach` is bounded.

- [ ] **Step 3: Update the defaults and the length set**

```js
const SERIF_HALF_DEFAULTS = Object.freeze({
  wingLength: 0,
  tipThickness: 0,
  wingSlope: 0,
  tipCutAngle: 0,
  reach: 0,
  // A fresh serif should read as a serif, so the transition starts as a real
  // bracket rather than a straight chamfer. In this construction concavity places
  // the attractor and tension travels toward it, so concavity at 0 gives a flat
  // chamfer whatever the tension - which is a shape worth having, but not the one
  // to open on. Both are dimensionless, so they need no unit scaling.
  tension: 0.7,
  concavity: 0.8,
  // The rounding is opt-in, like the cup: distance at 0 leaves the junction as
  // the construction drew it. The curvature is parked mid-range so the first drag
  // of the distance does something visible.
  easeDistance: 0,
  easeCurvature: 0.5,
});

const SERIF_LENGTH_FIELDS = new Set([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "reach",
  "easeDistance",
]);
```

- [ ] **Step 4: Replace the reach clamp with a terminal-depth clamp**

Replace `clampReach` and its two call sites (lines 4527–4539) with:

```js
// A terminal may only consume its own segment. Clamp before constructing the
// serif as well as before splitting the outline, otherwise the splice stays
// local while the emitted terminal still reaches into the next segment.
//
// The terminal's depth is the wing's inner corner, plus reach to the junction,
// plus the easing's run further back along the flank. Reach gets first call on
// whatever room is left past the corner and the easing takes the remainder, so
// shortening the segment eats the rounding before it eats the bracket.
const clampTerminalDepth = (side, half) => {
  const available = getTerminalSegmentLength(side, position) * 0.95;
  const room = Math.max(available - (half.tipThickness + half.wingSlope), 0);
  const wantedReach = Math.max(half.reach, 0);
  const reach = Math.min(wantedReach, room);
  const wantedEase = Math.max(half.easeDistance, 0);
  const easeDistance = Math.min(wantedEase, Math.max(room - reach, 0));
  return {
    half: { ...half, reach, easeDistance },
    clamped: wantedReach > reach || wantedEase > easeDistance,
  };
};
const leftDepth = clampTerminalDepth(leftSide, left);
const rightDepth = clampTerminalDepth(rightSide, right);
```

The `Math.max(..., 1)` floor on `available` is dropped with it: it let a terminal reach a full unit into a sub-unit segment, which is the floor serif backlog item 3 complains about. The one-unit floor inside `splitTerminalSideForRoundCap` is shared with round caps and stays where it is — that one is out of scope.

Then update `terminalArgs` to read `leftDepth.half` and `rightDepth.half`, and the return to read:

```js
    depthClamped: leftDepth.clamped || rightDepth.clamped,
```

- [ ] **Step 5: Regenerate the fixtures and check the diff**

The four serif fixtures move again: the default tension and concavity changed, and the fixture cases that leave them unset now resolve differently.

Run: `node src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js`

- [ ] **Step 6: Run the tests**

Run: `npm test --workspace src-js/fontra-core`
Expected: PASS.

- [ ] **Step 7: Format, check and commit**

```bash
npx prettier --write src-js/fontra-core/src/skeleton-generator.js src-js/fontra-core/tests/test-skeleton-generator.js
node --check src-js/fontra-core/src/skeleton-generator.js
npm test --workspace src-js/fontra-core
git add .
git commit -m "feat: bound the whole serif terminal depth, default to a real bracket"
```

---

## Task 5: Panel

Put the two new fields on screen, take the straight section off it, and group the rows the way the lab does.

**Files:**

- Modify: `src-js/views-editor/src/panel-skeleton-parameters.js:185-227, 1153-1290, 1652-1663`
- Modify: `src-js/views-editor/src/skeleton-panel-model.js:373-410`
- Modify: `src-js/fontra-core/assets/lang/en.js:505-524`

**Interfaces:**

- Consumes: `SERIF_HALF_FIELDS` from Task 3. The panel's read and write paths are already generic over that list and the `serif:<scope>-<field>` key shape, so `easeDistance` and `easeCurvature` are picked up by both without new plumbing — except for the percent conversion and the panel rows themselves.

`views-editor` has no test harness, so this task ends in a manual test matrix rather than assertions.

- [ ] **Step 1: Add the strings**

In `src-js/fontra-core/assets/lang/en.js`, remove:

```js
  "sidebar.skeleton-parameters.serif-straight-depth": "Straight section",
```

and add:

```js
  "sidebar.skeleton-parameters.serif-group-wing": "Wing",
  "sidebar.skeleton-parameters.serif-group-bracket": "Bracket",
  "sidebar.skeleton-parameters.serif-group-easing": "Contour easing",
  "sidebar.skeleton-parameters.serif-ease-distance": "Ease distance",
  "sidebar.skeleton-parameters.serif-ease-curvature": "Ease curvature",
```

Check whether the repo carries other language files alongside `en.js` and mirror the change into any that already hold the serif keys. If `en.js` is the only one, say so and move on.

- [ ] **Step 2: Convert the new percentage field**

In `panel-skeleton-parameters.js`, `serifHalfValueFromField` at line 186 divides tension and concavity by 100. `easeCurvature` is the same kind of number:

```js
function serifHalfValueFromField(field, value) {
  if (field === "tension" || field === "concavity" || field === "easeCurvature") {
    return Number(value) / 100;
  }
  return Number(value);
}
```

- [ ] **Step 3: Drop the straight section from the scale targets and the write path**

In `serifScaleTargets` at line 212, delete the `depth` branch:

```js
if (name === "depth") {
  return [{ field: "straightDepth" }];
}
```

`easeDistance` needs no branch here — it is a half field, so the generic tail of that function already returns the right target.

In `_onSerifChange` at line 1656, delete:

```js
if (name === "depth") {
  await apply({ straightDepth: value == null ? null : Number(value) });
  return;
}
```

- [ ] **Step 4: Regroup the half's rows and add the new ones**

Replace `pushHalf` in `_buildSerifSection` with:

```js
const pushGroup = (labelKey) => {
  formContents.push({
    type: "header",
    label: translate(`sidebar.skeleton-parameters.${labelKey}`),
  });
};

const pushHalf = (scope, half) => {
  pushGroup("serif-group-wing");
  pushLength(`serif:${scope}-wingLength`, "serif-wing-length", half.wingLength);
  pushLength(`serif:${scope}-tipThickness`, "serif-tip-thickness", half.tipThickness);
  pushLength(`serif:${scope}-wingSlope`, "serif-wing-slope", half.wingSlope);
  this._pushSummarySlider(
    formContents,
    `serif:${scope}-tipCutAngle`,
    "serif-tip-cut",
    half.tipCutAngle,
    SERIF_TIP_CUT_MIN,
    SERIF_TIP_CUT_MAX,
    0,
    { step: 1, disabled: !canEdit }
  );

  pushGroup("serif-group-bracket");
  // How far back along the stem flank the transition starts. It moves the
  // junction, which moves the attractor the bracket bends around, so it is
  // not a longer version of wing slope.
  pushLength(`serif:${scope}-reach`, "serif-reach", half.reach);
  // How far both handles travel toward the attractor. At 0 the bracket is a
  // straight wedge; there is no separate corner-or-smooth switch.
  this._pushSummarySlider(
    formContents,
    `serif:${scope}-tension`,
    "serif-tension",
    percentSummary(half.tension),
    0,
    100,
    0,
    { step: 1, disabled: !canEdit }
  );
  // Signed, and it places the attractor: negative bulges the transition
  // convex, 0 is a flat chamfer, 100 puts it on the wing's inner corner.
  this._pushSummarySlider(
    formContents,
    `serif:${scope}-concavity`,
    "serif-concavity",
    percentSummary(half.concavity),
    -100,
    100,
    0,
    { step: 1, disabled: !canEdit }
  );

  pushGroup("serif-group-easing");
  // Rounds the junction between the flank and the bracket. It switches itself
  // off on a hollow bracket, which is why these two do nothing at positive
  // concavity.
  pushLength(`serif:${scope}-easeDistance`, "serif-ease-distance", half.easeDistance);
  this._pushSummarySlider(
    formContents,
    `serif:${scope}-easeCurvature`,
    "serif-ease-curvature",
    percentSummary(half.easeCurvature),
    0,
    100,
    0,
    { step: 1, disabled: !canEdit }
  );
};
```

And at the bottom of `_buildSerifSection`, delete the straight-section row:

```js
pushLength("serif:depth", "serif-straight-depth", serif.straightDepth);
```

- [ ] **Step 5: Drop the straight section from the summary**

In `src-js/views-editor/src/skeleton-panel-model.js`, delete `straightDepth: terminal("straightDepth"),` at line 409. The half-field loop at line 379 is generic over `SERIF_HALF_FIELDS`, so it picks up the two new fields on its own — confirm by reading it rather than assuming.

- [ ] **Step 6: Syntax-check and format**

```bash
node --check src-js/views-editor/src/panel-skeleton-parameters.js
node --check src-js/views-editor/src/skeleton-panel-model.js
node --check src-js/fontra-core/assets/lang/en.js
npx prettier --write src-js/views-editor/src/panel-skeleton-parameters.js src-js/views-editor/src/skeleton-panel-model.js src-js/fontra-core/assets/lang/en.js
npm test --workspace src-js/fontra-core
```

Do not run the bundle. The user has a watcher running and will report compile errors.

- [ ] **Step 7: Commit, then hand the matrix to the user**

```bash
git add .
git commit -m "feat: put contour easing on the serif panel, retire the straight section"
```

Then ask the user to walk this matrix, since `views-editor` has no harness:

| #   | Do this                                                                        | Expect                                                                                       |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | Select a serif terminal point with halves linked                               | Three groups per half — Wing, Bracket, Contour easing — and no Straight section row anywhere |
| 2   | Unlink the halves                                                              | Left half and Right half each carry their own three groups                                   |
| 3   | Set concavity to 0                                                             | The bracket is a straight chamfer whatever the tension                                       |
| 4   | Set tension to 0                                                               | The bracket is a straight wedge whatever the concavity                                       |
| 5   | Set concavity to 100                                                           | The bracket meets the stem flank with no corner                                              |
| 6   | Sweep wing slope with reach at 0, then reach with slope at 0                   | The two produce visibly different curves                                                     |
| 7   | With concavity negative, drag ease distance up from 0                          | The corner at the flank rounds off; at 0 it is a hard corner again                           |
| 8   | With ease distance set, drag ease curvature 0 → 100                            | 0 is a flat cut across the corner, 100 is a full round                                       |
| 9   | Drag concavity from negative through 0 into positive with easing set           | The rounding disappears the moment concavity goes positive, and nothing jumps or flickers    |
| 10  | Drag a curvature pin on the segment feeding a serif terminal                   | Only handles move; no on-curve walks along the stroke                                        |
| 11  | Mirror a glyph containing an asymmetric serif                                  | The halves swap, easing included, and the shape is a clean mirror                            |
| 12  | Undo each of the above                                                         | One step per edit, restoring the previous value                                              |
| 13  | Put a serif on a very short terminal segment and raise reach and ease distance | The terminal stops at the segment's end and stays finite                                     |
| 14  | Open a file saved before this change that used the straight section            | It opens, the straight section is gone, nothing else shifts                                  |

---

## Task 6: Documentation

**Files:**

- Modify: `docs/superpowers/SKELETON-FEATURE-MODEL.md`
- Modify: `docs/superpowers/SERIF-BACKLOG.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`

- [ ] **Step 1: Update the feature model**

Read the serif sections first — the parameter table, the terminal anatomy, and the "tried and rejected" table — then:

- Replace the bracket description with the attractor construction: concavity places one attractor between the chord midpoint and the wing's inner corner, tension is how far both handles travel toward it.
- Give `reach` its new description: how far back along the stem flank the transition starts, and note that it now moves the attractor, which is what makes it independent of wing slope.
- Add `easeDistance` and `easeCurvature` to the half-field table, and record that the rounding switches off at positive concavity.
- Remove `straightDepth` from the terminal-field table and every mention of the straight section.
- Update the emitted-points description: seven on-curves per terminal, three per half plus the foot centre, and the terminal's emitted list opens and closes with a control point because the trimmed edge already ends at the release.
- In the "tried and rejected" table, annotate the row for letting tension and concavity scale each other: it was reverted because both defaulted to zero and a fresh serif drew a flat bevel, not because the model was wrong. It is back, with defaults of 0.7 and 0.8, and a flat chamfer at concavity 0 is now a documented shape rather than a symptom.
- Record the deliberate deviations from `serif-lab.html`: the underside cup stays one curve across the whole terminal with its centre on the skeleton, and `tipCutAngle` stays an angle rather than the lab's length offset.

- [ ] **Step 2: Close and correct the backlog**

In `docs/superpowers/SERIF-BACKLOG.md`:

- Mark item 2 (rework the easing model) done, and correct its text where it says contour easing is disabled across serif easing 0 → −1 and enabled on positive values. That is backwards. The rounding is off when the bracket is hollow — positive concavity — and on when it is flat or convex.
- Mark item 3 done for the parts this plan covers: `MIN_HANDLE_SHARE`, `MAX_HANDLE_SHARE` and `MAX_HANDLE_TO_CORNER` are gone, and the one-unit floor on the terminal's available depth is gone. Note that the one-unit floor inside `splitTerminalSideForRoundCap` remains, because it is shared with round caps.
- Under items 4 and 5 (presets), add that this plan cleared the way for them: there are no discrete serif types, every serif is the same vector of numbers, and any two blend by straight lerp. Carry the lab's six presets in as the starting set — Sans, Egyptian, Clarendon, Didone, Old style, Wedge — noting their numbers are stated at a stem width of 150 and need dividing by it for a normalized source.
- Add a new item: the rounding currently snaps off at positive concavity, which leaves the junction a hard corner anywhere between 0 and 1 where the bracket is not yet tangent on its own. The alternative is scaling the rounding by `1 - concavity` so it fades out exactly where the bracket takes over. Flagged for the user to judge on screen.

- [ ] **Step 3: Add the development log entry**

Append a numbered entry in the log's existing style covering: the bug (reach and wing slope emitting identical geometry, and the release collapsing to a hard corner at reach 0), the cause (both handles aimed at the fixed corner, and reach measured from that same corner), the fix (the lab's single-attractor construction), the straight section's removal, contour easing, the duplicate on-curve at the release that the shipped code emitted at every default terminal and that this removes, and the reinstatement of tension and concavity scaling each other with the reason the first attempt was reverted.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "docs: record the serif model rework"
```

---

## Self-Review Notes

- **Naming used consistently across tasks:** `junction` (flank meets bracket, un-rounded), `corner` (the wing's inner corner, the attractor's anchor, never emitted), `release` (where the stroke edge is brought — the junction when easing is off, the flank rounding point when it is on), `easeOnBracket`, `easeFlankHandle`, `easeBracketHandle`, `easeDistance`, `easeCurvature`, `clampTerminalDepth`, `depthClamped`.
- **`straightDepth` removal is complete across:** geometry, generator resolution and terminal args, model field list and normalization and the parameter setter, panel row and write branch and scale target, panel summary, language file, four inline test fixtures, the fixture generator script, and the three standing docs.
- **On-curve count is pinned in three places:** the terminal-assembly tests in Task 2, the generator stability sweeps in Task 4 including one that crosses the easing snap-off, and manual matrix row 9.
- **Nothing in this plan writes a resolved value back onto a point.** All three new or changed defaults live in `SERIF_HALF_DEFAULTS` and stay inheritable.
