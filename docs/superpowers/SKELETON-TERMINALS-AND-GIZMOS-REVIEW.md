# Skeleton review: serif, ball and curvature gizmos

**Date:** 2026-09-17
**Branch read:** `ui/ux-refactor` at `0cab9b42f`
**Scope:** every control the Skeleton section of the Selection panel offers, the code behind the three areas the designer named (serif, ball, curvature gizmos), and a suggestions list for each.

This is a report, not a plan. Nothing in the tree changed. Each finding carries the area, the problem in plain words with the code beside it, a proposed change, and step-by-step instructions for an agent who has not read the code.

---

## 0. How to use this document

**For the designer.** Read §1 to check the mental model against your own. Read §3 for the findings. Each finding has a priority: **P1** changes what draws, **P2** changes what a control can do or how honest it is, **P3** removes weight or cost. Decide which ones to hand out.

**For an agent doing one finding.** Read §0.1, then the one finding. Do not read the rest of the code first. Every finding names the files, the functions and the test that proves it.

### 0.1 Rules for every change

1. Read `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` §2 (the rails). Rail R-B, R-C and R-D apply to every finding here.
2. Write the test first. Run it. It must fail. Then change the code. Run it again. It must pass.
3. Run the core suite after every finding: `cd src-js/fontra-core && npm test`. The count at the time of this review must not go down.
4. Run `npx prettier --write` on every file you touched.
5. Do not run `npm run bundle`. The designer runs bundle-watch and reports compile errors.
6. Do not regenerate the golden fixtures under `src-js/fontra-core/tests/data/skeleton-generator/` unless a finding says so. If a fixture test fails and the finding did not predict it, stop and report.
7. Commit after each finding with `git add .`. One finding, one commit.
8. Finish by editing the feature's section of `docs/superpowers/DEVELOPMENT-LOG.md`: add what is new, delete what is now untrue. Do not append.

### 0.2 File map for this review

| File | What it holds |
| --- | --- |
| `src-js/views-editor/src/panel-skeleton-parameters.js` | the panel, 3,004 lines |
| `src-js/fontra-core/src/skeleton-generator.js` | the generator, 6,743 lines. Serif cap at `buildSerifCap` (6494). Ball at `buildDropCap` (6226). Authored serif handles at 752 to 904. |
| `src-js/fontra-core/src/serif-geometry.js` | the serif shape in its own frame, 852 lines |
| `src-js/fontra-core/src/offset-cubic.js` | the authored layers on a generated cubic: attached offset, pin, detached |
| `src-js/fontra-core/src/natural-handle-solver.js` | `buildHandleDomain`, the one handle domain |
| `src-js/fontra-core/src/tunni-calculations.js` | the pin shift, the gizmo point, the drag scale |
| `src-js/fontra-core/src/skeleton-model.js` | `calculateGeneratedCurvatureEdits`, `buildGeneratedTunniSegments`, `getGeneratedSegmentCurvature` |
| `src-js/views-editor/src/tunni-interactions.js` | the gizmo drag and the writes it makes |
| `src-js/views-editor/src/tunni-gizmos.js` | `findTunniGizmo`, the live hit test |
| `src-js/fontra-core/tests/test-serif-geometry.js` | 103 serif tests |
| `src-js/fontra-core/tests/test-skeleton-tunni.js` | 66 gizmo tests |
| `src-js/fontra-core/tests/test-skeleton-generator.js` | generator tests, ball at 1073, serif at 2099 onward |

The architecture map's line counts are stale by about a factor of 1.5. Trust the numbers above.

---

## 1. The panel, control by control

The Skeleton section of the Selection tab is the functional reference. Every control below exists, and each one maps to one mechanism. Where the reference docs say something different, the note says so.

### 1.1 Header

**Gizmo / Handles.** One switch, `fontra.skeleton.generated-tunni`. Gizmo mode draws the two controls on every generated cubic and refuses direct drags on generated points. Handles mode is the reverse. The View menu reads and writes the same setting.

### 1.2 Generation

**Preset control.** A width preset is a total width and a projection side, held per master and per glyph case. Pick applies it. Add captures the selection. Update overwrites the picked preset after a second press. Lock binds the selected points to the preset, which greys the width fields and marks them stale when they drift. Refresh brings bound points back. Reset returns the points to the contour default.

**Total, Distribution, Left, chain, Right.** Total is the two half-widths added. Distribution is the split, minus 100 to 100, left positive. Left and Right are the half-widths. The chain is `width.linked`. Closed, Right is greyed and a typed Left carries across by share. A drag never reads the chain. On a single-sided contour the per-side fields and the distribution are greyed and blank, because only the total is on screen. A drag on Total, Left or Right moves each selected point by the change from where the drag started, so a mixed selection stays mixed.

**Projection D / L / R with overflow.** The contour's `singleSided`. D is both sides. L or R puts the whole width on that side and the other edge on the centerline. The overflow holds two application settings: Keep shape moves the centerline so the drawn edges stay put, and Preserve changes keeps authored handle offsets through that move.

**Reset: handle, slide, all.** Reset handle clears the generated handle offsets of the selected ribs, or of the one selected generated handle. Reset slide zeroes the tangential nudge. Reset all clears both and the curvature pin of the segment leaving the point.

**Rib: Tied ribs and the Rib card.** Tied ribs is the per-straight opt-out of the shared offset. It is greyed where no selected point has a straight to tie across. The card holds Rib angle (Free, Vertical, Horizontal), the rib angle lock. Under it, Keep the footprint is the lock's mode: off, the rib reaches for the edge and the stem keeps its width. On, the rib bar keeps its stated length and the stroke draws thinner. Lock handles, Lock on-curve slide and Lock width are three holds per rib side. A handle lock also takes the curvature gizmo away from every segment the rib touches.

### 1.3 Terminal

Shown only when every selected point is an open endpoint.

**Kind chips: Flat, Square, Rounded, Ball, Serif.** The cap style. Picking Serif applies the Egyptian preset. Each kind but Flat carries a preset control on its own heading. A terminal bound to a preset shows every field greyed.

**Square: Project angle, Distance.** The angled cut and the projection past the end.

**Rounded: Radius, Roundness.** Radius is a 1 to 20 position on a logarithmic scale between one 128th and one quarter of the width. Roundness is the cap tension in percent.

**Ball: Size, Shape, Ease, Ball side.** Size is the ball's lateral diameter as a percent of the stroke width, 50 to 300. Shape stretches the ball back along the stroke, 0 to 100, and never resizes it. Ease is a fraction of the run from the ball's crossing on the inner edge back to the next on-curve, and at 100 the neck's far end lands on that on-curve. Ball side is Auto, Left or Right. A fifth number, the neck's curvature, has no field. The curvature gizmo on the neck writes it into `capBallEaseCurvature`.

**Serif.** The sides overflow has a Left and a Right check. A side that is off contributes points and no shape. Three groups of half fields, each row Left, chain, Right: Wing (Width, Height, Slope, Tip cut), Bracket (Reach, Tension, Concavity), Easing (Distance, Curvature). Each chain is that field's own link. Right-click on a field opens Force: copy this field, its group, or all nine onto the other side. Angle holds Tilt alone, minus 40 to 40, live only while the axis is free. The axis direction itself is not on this panel: the rib angle lock sets it. Cup holds Cup (depth), Cup balance (minus 100 to 100, a fraction of the half-span between the tips) and Cup tension.

A serif preset is the whole terminal: both halves, every link, the axis mode with its angle and tilt, and the cup. Five ship. The master keeps its own beside them.

### 1.4 Corner rounding

Shown only for a selected corner point that is not an endpoint. Distance L, chain, Distance R in font units. Distribution moves distance between the two sides while linked. Curvature L, chain, Curvature R in percent, on the same scale as the serif's easing curvature and the gizmo. Both chains are `corner.linked`.

### 1.5 Insertion point

Shown for a selected insertion point. Left, chain, Right are the widths as a percent of the stroke where the point stands. Left easing and Right easing, minus 100 to 100, open or tighten the joint. The chain governs both pairs.

This feature is not in the reference docs. It is in the code and on the panel, with about fifteen commits behind it.

### 1.6 Where the docs disagree with the panel

| Doc statement | What the code does |
| --- | --- |
| Feature model §8: the serif axis has modes `perpendicular`, `horizontal`, `vertical`, `absolute`, `tilt`. | The selection panel offers Tilt only. The defaults panel still offers Vertical and Horizontal. A terminal stored with `absolute` lights no segment and cannot be changed from the panel. See S4. |
| Architecture map §7 residue 4: a pin of exactly zero reads as no pin. | `shiftTensionsToMean` takes zero as the bottom of the shift. Fixed. The residue is stale. |
| Architecture map: `skeleton-generator.js` is 4,730 lines, `skeleton-model.js` 3,744, `serif-geometry.js` 268. | 6,743, 5,971 and 852. |
| Feature model §1: the feature list. | No insertion points, no preset bonds, no Gizmo/Handles switch, no ball easing curvature. |
| Glossary. | No entry for insertion point, preset bond, or the ball's ease. |

---

## 2. How each area works, in one paragraph each

**Serif.** The generator finds the terminal segment on each side after the corner join and the corner rounding. It maps that segment into the serif frame and hands it to `makeSerifWall` as a curve with fixed-count searches on it. `buildHalfSerif` finds the wing's inner corner where the wing's top surface meets the wall, then the junction a reach above it and the release an ease distance above that, all as lengths along the wall. It bends one bracket cubic around one attractor and rounds the junction with one symmetric cubic. `buildSerifTerminal` joins the two halves with one cup curve. The generator cuts each side at the release parameter, discards the piece past it, and emits the 19 cap points between the two releases. The pin and the two handle offsets on the terminal segment are withheld from the solve and applied to the surviving piece afterward by `applySerifAuthoredHandles` and `applySerifPinnedCurvature`.

**Ball.** `buildDropCap` picks the outer side, cuts the outer edge back by a search over cut positions so the ball's forward extreme lands on the terminal plane, and sits an affine circle tangent to the cut. It scans the inner edge backward for the rear-most crossing of the ball. With no easing it trims the inner edge at the crossing and closes the arc there as a corner. With easing it slides the trim back along the crossing's own segment, backs the arc off, and bridges with one neck cubic whose curvature is the cap field the gizmo writes. A ball that never reaches the inner edge bridges to the inner terminal instead.

**Curvature gizmo.** `buildGeneratedTunniSegments` joins every generated cubic with the provenance of its four points. The gizmo sits at the curve's apex. A drag projects onto the axis toward the tangent crossing, converts distance into one shared tension increment, and measures the moved handles back into one number, the harmonic mean, through the same handle domain the generator uses. That number is stored on the skeleton segment's start point per side. Below the shorter handle's zero the drag continues as a displacement on the surviving handle, marked as the gizmo's own so a later drag can release it. The generator reproduces the pin on every regeneration after the natural fit and the attached offsets, and before detached handles. A serifed terminal applies it after the cut instead.

---

## 3. Findings

Each finding: **Area**, **Problem**, **Evidence**, **Proposal**, **Instructions**, **Done when**.

### Serif

#### S1 — Every cap point carries a guessed origin — P1

**Area.** `buildSerifCap`, and the same for the ball's arc and the round cap.

**Problem.** The serif stamps its 19 points with the owner's provenance, but the owner it is handed is a skeleton point, which has no provenance to copy. The stamp does nothing. The fallback annotator then guesses an owner for each point by its position along the contour, with no side and with alternating handle roles. One serif produces a dozen points that claim to be handles of skeleton points they have nothing to do with. The log records this as open under "Gaps". Every reader that resolves a skeleton point's generated points by provenance, such as the snapping exclusion during a drag of the terminal point, gets wrong points.

**Evidence.**

```js
// skeleton-generator.js:6585
for (const point of capPoints) withRoundCapProvenance(point, ownerPoint);

// skeleton-generator.js:4620 — copies _provenance, which a skeleton input point does not have
function withRoundCapProvenance(point, sourcePoint) {
  if (point && sourcePoint?._provenance) {
    point._provenance = { ...sourcePoint._provenance };
  }
  ...
}

// skeleton-generator.js:190 — the fallback that then runs
const sourceIndex = Math.round((i / (contour.points.length - 1)) * lastSourceIndex);
point._provenance = generatedHandle(point, sourcePoint, null, cubicRole)._provenance;
cubicRole = cubicRole === "out" ? "in" : "out";
```

The ball's `dropCapOnCurve` and `dropCapHandle` and the round cap's `buildRoundCapSegment` emit points with no provenance at all, so they get the same guess.

**Proposal.** One helper, `capProvenance(ownerPoint)`, returns `{ skeletonPointId: ownerPoint._sourcePointId, side: null, role: "cap" }`. Apply it in `generateOutlineFromSkeletonContour` to every point of `startCap` and `endCap` that has no provenance yet, before assembly. Then the fallback annotator never runs on a cap. `buildGeneratedTunniSegments` already skips a segment whose side is null, so no gizmo appears on cap geometry, and the neck keeps its own provenance because it is stamped first.

**Instructions.**

1. In `test-skeleton-generator.js`, add a test in the serif block: generate `curvedSerifSkeleton(63)`, read `result.provenance[0].pointMap`, and assert that every entry with `role === "cap"` has `skeletonPointId` equal to the endpoint's id, and that no entry has `side === null` with a role of `"in"` or `"out"`. Run it. It fails.
2. Add the same test for a ball (`horizontalDrop({})`) and a round cap.
3. In `skeleton-generator.js`, write `capProvenance` next to `pointProvenance` (line 428).
4. In `generateOutlineFromSkeletonContour`, after the end cap and start cap are built and before `outlinePoints.push(...)` at line 3195, loop both arrays and set `point._provenance = capProvenance(ownerPoint)` for each point with no `_provenance`. The owner is `lastOnCurvePoint` for the end cap and `firstOnCurvePoint` for the start cap.
5. Delete the loop at line 6585.
6. Run the suite. The golden fixtures record points, not provenance, so they must not move. If `test-skeleton-tunni.js` reports a changed gizmo count, a cap segment was previously guessed as left or right. That is the bug being fixed. Read the test and update its expectation.

**Done when.** The three new tests pass, the suite passes, and the log's "every point a serif emits carries a guessed origin" line is deleted.

#### S2 — The easing switches off at full concavity and jumps — P2

**Area.** `buildHalfSerif`, `serif-geometry.js:589`.

**Problem.** At concavity 100 the rounding is switched off. At 99 it is fully on. So the release, which is an on-curve, moves back by the whole ease distance in one step of the slider. The reason given, that the bracket already leaves along the flank at full concavity, is true only while tension is above zero and the wall is straight. At tension 0 the bracket is a straight chamfer whatever the concavity, and it meets the flank at an angle that wants rounding. The gate turns the rounding off exactly there.

**Evidence.**

```js
// serif-geometry.js:589
const easeOff = concavity >= 1;
const wantedEase = easeOff ? 0 : Math.max(params.easeDistance ?? 0, 0);

// serif-geometry.js:633 — at tension 0 both controls sit on their ends: a chamfer
const attractor = lerpUV(midChord, corner, concavity);
const control1 = lerpUV(tipTop, attractor, tension);
const control2 = lerpUV(junction, attractor, tension);
```

**Proposal.** Delete the gate. The rounding degenerates on its own: where the bracket leaves along the flank, the two surface directions are parallel, `lineIntersection` returns null, the reach falls back to the ease distance, and the rounding is a straight run along the flank. Same shape, no jump.

**Instructions.**

1. In `test-serif-geometry.js`, replace the test "snaps the rounding off at full concavity" (line 642) with a sweep: build the half at `easeDistance: 20, easeCurvature: 0.6, tension: 0.7` for concavity from 0.90 to 1.00 in steps of 0.005, and assert that the release moves less than 1 unit between adjacent steps. Add a second case at `tension: 0` asserting the release sits `easeDistance` along the wall above the junction at concavity 1. Run. Both fail.
2. Delete lines 589 and 590 and let `wantedEase` read `Math.max(params.easeDistance ?? 0, 0)`.
3. Run the suite. The generator's serif fixtures carry no concavity of 1, so nothing else moves. If one does, report the fixture name.

**Done when.** Both tests pass and the feature model §8 sentence "Easing switches itself off at concavity 1" is deleted.

#### S3 — `depthClamped` is computed and never read — P3

**Area.** `serif-geometry.js:599` and `skeleton-generator.js:6598`.

**Problem.** Both halves compute whether a clamp bit, the terminal returns it, and nothing reads it.

**Evidence.**

```
$ grep -rn depthClamped src-js/fontra-core/src src-js/views-editor/src
serif-geometry.js:599, 729   skeleton-generator.js:6598
```

**Proposal.** Delete it. If a "clamped" mark in the panel is wanted later, that is a feature to design, and the log's lesson about panels showing a number the model rejected says it must reach the field, not sit in a return value.

**Instructions.** Delete the `depthClamped` constant and the three return lines. Run the suite.

**Done when.** The grep returns nothing and the suite passes.

#### S4 — Three axis modes the panel cannot reach — P3

**Area.** `rawAxisForMode` in `serif-geometry.js:15`, `VALID_SERIF_AXIS_MODES` in `skeleton-model.js`, `panel-skeleton-defaults.js:1171` to 1195.

**Problem.** The selection panel offers Tilt and nothing else, because the rib angle lock already makes a foot flat. `horizontal`, `vertical` and `absolute` survive in the geometry, in the model's validation, in the preset schema, and in the defaults panel, which still offers Vertical and Horizontal. A terminal in one of those modes shows a greyed Tilt and no way out but the defaults panel. Two panels disagree about what a serif can be.

**Evidence.**

```js
// panel-skeleton-parameters.js:2510 — the panel's whole view of the mode
const free = axisMode === "perpendicular" || axisMode === "tilt";
this._refreshCompactField(this.serifAxisTiltField, "serif:axistilt", serif.axisTilt, {
  disabled: !canEdit || !free, ...
});

// panel-skeleton-defaults.js:1191 — the other panel still offers two of the old modes
: ["vertical", "horizontal"].includes(working.axisMode) ? working.axisMode
```

**Proposal.** Keep one mode. `tilt` at 0 is the perpendicular. Delete `horizontal`, `vertical`, `absolute` and `axisAngle` from the geometry, the model, the presets and the defaults panel. There is no production release, so no migration. A file holding an old mode normalizes to tilt 0.

**Instructions.**

1. In `test-serif-geometry.js`, delete the tests that name the removed modes: "holds a horizontal axis while the tangent rotates" (55), "uses the absolute angle when asked" (86), "ignores the tilt in every other mode" (285), and the mode loop in "keeps axis and depth orthonormal in every mode" (108). Keep the tilt tests.
2. In `serif-geometry.js`, reduce `rawAxisForMode` to return the rib normal, and delete `unitFromDegrees`. Delete the `axisAngle` parameter of `computeSerifFrame`.
3. In `skeleton-model.js`, set `VALID_SERIF_AXIS_MODES` to `tilt` only, remove `axisAngle` from `SERIF_TERMINAL_FIELDS` and from `normalizeSerif`, and have `normalizeSerif` map any other stored mode to `tilt`.
4. Grep for `axisAngle` and `axisMode` across `src-js` and remove each read. The mirror in `skeleton-model.js` negates `axisAngle`. Delete that line.
5. In `panel-skeleton-defaults.js`, replace the mode select with the Tilt field alone.
6. In `panel-skeleton-parameters.js`, delete the `axismode` branch of `_onSerifChange` and the `free` gate.
7. Run the suite and `npx prettier --write` on every file touched.

**Done when.** `grep -rn "axisAngle\|absolute\|\"horizontal\"" src-js/fontra-core/src/serif-geometry.js` returns nothing, the suite passes, and feature model §8 lists tilt as the one axis control.

#### S5 — A failed serif build falls back to a flat cap in silence — P2

**Area.** `generateOutlineFromSkeletonContour:2955` and 3155, `buildSerifCap`.

**Problem.** `buildSerifCap` returns null in four cases: an unusable tangent, a side with fewer than two on-curves, a wall that could not be built, and a split that failed. The caller then emits no cap at all. The terminal draws flat with no message. The pin and the handle offsets on that segment are still withheld from the solve because the segment is still claimed as serif-owned, and `applySerifPinnedCurvature` then runs on the uncut segment. The ball has the same shape of fallback at 2932 and 3132.

**Evidence.**

```js
// skeleton-generator.js:2955
if (serifCap) {
  roundedLeftSide = serifCap.leftSide;
  roundedRightSide = serifCap.rightSide;
  startCap = serifCap.capPoints;
}
// no else: startCap stays [], and authoredKeys still claims the segment
```

**Proposal.** Make the null paths unreachable rather than louder. The serif ground rule says points collapse and never disappear. A degenerate wall should still give 19 points collapsed on the rib end. The one real null is a side with no terminal segment, which cannot happen after `solveSkeletonContourSides` returned segments. For the ball, a ball that cannot fit should emit its 4 arc on-curves collapsed on the outer edge's terminal point, not vanish.

**Instructions.**

1. Write a test: a two-point contour of length 1 with `capStyle: "serif"` on both ends, widths 20. Assert the outline has 14 more on-curves than the same contour with flat caps (7 per serif). Run. It fails or throws.
2. In `buildSerifCap`, replace `if (!isUsableDirection(outward)) return null` with a fallback direction from the segment chord, using `resolveRoundCapFallbackDirection` (line 4654).
3. In `wallForSide`, when `getRoundCapTerminalSegment` returns null, build the wall from a two-point line of length 1 along the depth axis, so every search has something to run on.
4. Keep `if (!leftSplit || !rightSplit) return null` for one more step: read `splitTerminalSideAtParameter` and confirm that with `minimumTrim: 0` it never returns null on a two-point segment. If it can, the synthesized point at 4752 is the fallback and the return should use it.
5. Where a null is still possible after that, add `logSkeletonDebug` with the reason so the failure is visible in the debug log, and set `startCap` to `generateCap(..., "butt", ...)` explicitly in the caller so the fallback is stated rather than implied.
6. Repeat the same reading for `buildDropCap`. Its `return null` at 6271 and 6177 are the ones reachable in use. For each, decide with the designer whether a collapsed ball is preferred to a flat cap. Do not change the ball's behaviour without that decision.

**Done when.** The serif test passes, the suite passes, and every remaining null return in the two cap builders has a `logSkeletonDebug` beside it.

#### S6 — The ease ceiling is the chord, not the bracket — P3

**Area.** `maxSerifEaseDistance` in `serif-geometry.js:420`, its use in `setSkeletonSerifParameters` at `skeleton-model.js:2871`.

**Problem.** The writer clamps the stored ease distance to the straight-line distance from junction to tip top. The rounding's bracket end walks the bracket curve by arc length, and a hollow bracket is longer than its chord. So the panel refuses values the geometry could draw. The clamp also uses the unclamped reach, while the geometry may have clamped reach against the wall. Small, and it errs on the safe side.

**Proposal.** Leave it unless a designer hits it. If they do, replace the chord with the bracket's arc length, which `buildHalfSerif` can return beside `releaseParameter`. Record the decision in the log.

**Instructions.** None until asked.

#### S7 — The serif's authored layers duplicate `offset-cubic.js` — P3

**Area.** `applySerifAuthoredHandles` and `applySerifPinnedCurvature` in `skeleton-generator.js:768` to 904.

**Problem.** The post-splice path re-implements the domain scaling that `applyAttachedAdjustments` and `applyPinnedTension` already own. Today the two agree because the post-splice domain carries no nudge, so `maxStartTension` and `intersectionStartTension` coincide. The main path was corrected once already for exactly that pair, and the serif path was not, because it had no nudge. The next such correction will miss one of them.

**Evidence.**

```js
// skeleton-generator.js:875 — the serif path shifts against maxStartTension
start: vector.distance(anchor, handle1) / domain.startReach / domain.maxStartTension,

// offset-cubic.js:110 — the main path shifts against the intersection unit
const startUnit = domain.intersectionStartTension ?? domain.maxStartTension;
```

**Proposal.** Export `applyAttachedAdjustments` and `applyPinnedTension` from `offset-cubic.js` and call them from the serif path with a request built from the surviving piece. Then there is one copy (R-B).

**Instructions.**

1. Read `offset-cubic.js` in full, 178 lines. Note the request shape: `q0, q3, u0, u1, startAdjustment, endAdjustment, pinnedTension`.
2. In `applySerifAuthoredHandles`, replace the block from `const baseLength` to `points[index] = ...` with a call to `applyAttachedAdjustments({ startLength, endLength }, request, domain)` where the request carries the anchor, the far point and the two axes, and read the result back into the two handle positions.
3. In `applySerifPinnedCurvature`, replace the `shiftTensionsToMean` block with `applyPinnedTension`.
4. Run the suite. The tests "a curvature pin on a serifed terminal" (2934 to 3000) and "skeleton-generator serif terminal handles" (2681) must pass unchanged. If a coordinate moves by one unit, the rounding order changed. Match the old order.

**Done when.** `shiftTensionsToMean` is imported by `offset-cubic.js` only, and the suite passes.

### Ball

#### B1 — Three neck modes, three point counts — P1

**Area.** `buildDropCap`, `skeleton-generator.js:6303` to 6461.

**Problem.** The ball has three ways to meet the inner edge and they emit different numbers of points. With easing at 0, the panel default, the arc's last on-curve is dropped and no neck handles exist. With easing above 0, the arc keeps all four on-curves and two neck handles follow. When the ball is too small to reach the inner edge, the bridge emits the arc and the neck but no trim point. So a master with Ease 0 and a master with Ease 1 do not interpolate, and neither does a master whose ball reaches the edge against one whose ball does not. The serif solved this by the ground rule: every point is emitted at every value, collapsed where it has nowhere to go. The ball does not follow it.

**Evidence.**

```js
// skeleton-generator.js:6457 — corner mode drops a point and adds no handles
} else {
  capForwardToInner = arc.slice(0, -1);
}
// soft mode: ...arc, handle, handle   — one more on-curve, two handles
// bridge mode: ...arc, handle, handle — and the side keeps its terminal
```

**Proposal.** One structure for all three modes: the full arc, then two neck handles, then the inner attachment on-curve. In corner mode the two handles and the attachment sit on the crossing, a zero-length neck. In bridge mode the attachment is the inner terminal, which the side already emits, so the arc's last on-curve is dropped there instead and the count still matches, because the trim in the other two modes replaced the terminal rather than adding to it. Check the count in a test before trusting this sentence.

**Instructions.**

1. In `test-skeleton-generator.js`, next to "capBallEasing 1 collapses the neck's far end" (1403), add a test that generates `horizontalDrop` at `capBallEasing` 0, 0.01, 0.5 and 1 and asserts the same `points.length` for all four. Add a second test that sweeps `capBallRatio` from 0.5 to 3 in 50 steps and asserts the count never changes. Run. Both fail.
2. In corner mode, replace `arc.slice(0, -1)` with the arc plus two `dropCapHandle` points at `ballCross.crossing`, stamped with `withNeckProvenance` exactly as soft mode does, and keep the arc's last on-curve. The trimmed side's crossing on-curve then follows it at the same spot. Two on-curves on one spot is the ground rule working.
3. Run the count tests. If bridge mode is off by one, apply the same reading: the bridge's attachment is the side's own terminal, so drop the arc's last on-curve there, or keep it and let the terminal collapse onto it. Pick the one that makes all three counts equal.
4. Run the whole suite. "places the ball continuously as the skeleton moves under a curved terminal" (1321) asserts a constant count across a sweep and must still pass. "never reaches past the terminal" must still pass, because a collapsed neck adds no reach.
5. Also add the test's collapsed points to `removeCollapsedOutlinePoints` coverage: with `removeCollapsedPoints` on, the zero-length neck must be removed. Check the existing test "drops coincident points only when requested" (2458) still passes.

**Done when.** The two count tests pass, the suite passes, and feature model §3 step 4 gains one sentence: the ball follows the collapse rule.

The case where the ball swallows a whole earlier segment still changes the count. That is inherent and stays.

#### B2 — The neck's handles are placed by one formula and read by another — P2

**Area.** `buildDropCap:6372` and 6426, `computeTunniHandleLengths:4500`, `getGeneratedSegmentCurvature`, `constructionSegmentAxes`.

**Problem.** The neck's two handles are placed by `computeTunniHandleLengths`, which takes the absolute distance to the tangent crossing even when the crossing is behind an end, and then clamps to the chord. The gizmo reads the neck through `calculateSegmentTension`, the plain distance formula, because the neck's handles carry no construction axis. The two formulas agree while the clamp does not bite and the crossing is ahead. Where the clamp bites, a pin above the clamp is stored and never drawn. Where the crossing is behind, the label hides because `hasForwardTangentIntersection` says no, while the drag still moves the handles. Every other generated cubic goes through `buildHandleDomain`, which handles both cases and is the one copy of the reach (R-B).

**Evidence.**

```js
// skeleton-generator.js:4512 — abs() throws the sign away
const distStartToTunni = Math.abs(intersection.t1);

// skeleton-generator.js:6379 — the clamp the gizmo cannot see
const clampNeckLen = (value) =>
  Math.min(Math.max(Number.isFinite(value) ? value : NECK_HANDLE_FRACTION * chord, 0), chord);
```

**Proposal.** Place the neck through `buildHandleDomain(ballAttach, innerTrim, sweepTangent, innerTangent)` and `tensionsToLengths({ start: t, end: t }, domain)` with `t` the cap field, clamped to the domain's ceilings. Stamp `_axis` on both neck handles so `publishConstructionAxes` publishes them and the reader's `constructionSegmentAxes` finds them. Then the reader and the writer share one unit by construction, and a behind crossing falls back to the domain's cap the way it does everywhere else.

**Instructions.**

1. In `test-skeleton-tunni.js`, in "the curvature gizmo at a bulb terminal", add a round-trip test: build the bulb at `capBallEasing: 0.5` with `capBallEaseCurvature` at 0.2, 0.55 and 0.9. For each, read `getGeneratedSegmentCurvature(skeletonData, neck).tension` and assert it is within 0.02 of the stored value. Run. The 0.9 case fails on the chord clamp.
2. In `buildDropCap`, in the soft branch, replace the `computeTunniHandleLengths` and `clampNeckLen` block with the domain call. `tensionsToLengths` is not exported from `offset-cubic.js`. Export it, or write the two multiplications inline.
3. Set `_axis` on the two neck handles: the first to `sweepTangent`, the second to `innerTangent`. The neck's start on-curve is a ball point with `skipColinear`, so the axes are not rotated.
4. Do the same in the bridge branch.
5. Run the suite. "capBallEaseCurvature shapes the eased neck without moving its ends" (1420) must pass. The "places the ball continuously" sweep must pass.

**Done when.** The round-trip test passes for all three values and `computeTunniHandleLengths` has no caller in `buildDropCap`.

#### B3 — The straight-terminal search rebuilds the side array per probe — P3

**Area.** `solveDropCapBallOnTerminal:6135` to 6156, `searchDropCapTrim`.

**Problem.** On a straight terminal segment every probe of the cut position calls `splitTerminalSideForRoundCap`, which slices and rebuilds the whole side array, to read back a point and a tangent that are closed-form on a line. One search is about 76 probes. When the ball does not fit at the asked width, the width is bisected 14 times and each step runs the search again, so about 1,100 array rebuilds per regeneration per straight bulb. A cubic terminal probes the bezier directly and costs a few hundred evaluations. The straight case, which is the commonest stem, is the expensive one.

**Evidence.**

```js
// skeleton-generator.js:6136
const splitAt = (s) => splitTerminalSideForRoundCap(outerSideArr, position, trimAt(s), {...});
frameAt = (s, radius) => {
  const split = splitAt(s);          // full side rebuild, per probe
  ...
```

**Proposal.** On a line, the frame at cut `s` is `tangency = endpoint - forward * trimAt(s)`, `edgeTangent = forward`. Compute it inline and call `splitAt` once with the chosen `s`. Better still, on a line `edgeAlignment` is 1 and `alongRadius` equals the trim distance, so the search has a closed answer: `chosen = (wanted - MIN) / (max - MIN)` clamped to [0, 1]. Keep the search for the cubic case.

**Instructions.**

1. Add a test in the drop-cap block: generate `horizontalDrop({})` before and after the change and assert byte-equal points. Write it first, with the "after" being the current output saved in the test as a fixture literal.
2. In the `else` branch (line 6135), replace `frameAt` with a version that calls `probeDropCapBallFrame` directly on `{ tangency: endpoint - forward * trimAt(s), edgeTangent: forward }` and never calls `splitAt`.
3. Leave `cutAt = splitAt` as it is, so the one real cut still goes through the shared split.
4. Run the byte-equal test. If it fails by one unit, the old path's synthesized point at trim under 1 unit is the cause. Match it by flooring the trim at `MIN_BALL_TRIM`, which is already 1.

**Done when.** The byte-equal test passes and the suite passes.

#### B4 — Ball side Auto flips on a nearly straight terminal — P2

**Area.** `resolveDropCapOuterSide:5519`.

**Problem.** Auto takes the convex side from the cross product of the terminal segment's two tangents, with a threshold of one thousandth. A terminal that is straight to within a twentieth of a degree picks its side by sign noise, and a drag of the skeleton through straight moves the whole ball to the other side in one frame. The panel shows Auto and does not say which side was picked.

**Evidence.**

```js
const cross = tangentStart.x * tangentEnd.y - tangentStart.y * tangentEnd.x;
if (Math.abs(cross) > 1e-3) {
  return cross > 0 ? "left" : "right";
}
return rightHW > leftHW ? "right" : "left";
```

**Proposal.** Resolve Auto once, at the moment the terminal becomes a ball, and write Left or Right into the point. Auto stays in the panel as an action, "pick the convex side now", not as a stored state. The stored side is then stable under every drag and interpolates.

**Instructions.**

1. In `skeleton-panel-edits.js`, find `setPanelCapStyle`. When the new style is `drop` and the point's `capBallSide` is `auto` or unset, compute the side with the same rule `resolveDropCapOuterSide` uses and store it. Export that rule from the generator or move it to `skeleton-model.js` so there is one copy.
2. In the panel's Ball side select, keep the three options. Picking Auto writes the resolved side, not the word `auto`.
3. Keep `auto` in `VALID_CAP_BALL_SIDES` so old files still read, and keep the generator's fallback.
4. Write a test in `test-skeleton-model.js` for the resolver on a straight, a left-turning and a right-turning terminal.

**Done when.** A file saved after picking Ball holds `left` or `right`, never `auto`.

#### B5 — Contour-level cap fields have a reader and no writer — P3

**Area.** `generateOutlineFromSkeletonContour` fallbacks, `canonicalToGeneratorInput:247`, `skeleton-model.js:1260`.

**Problem.** Every cap parameter is read as `point.x ?? contour.x ?? DEFAULT`. The generator input copies four contour fields: `capStyle`, `capBallRatio`, `capBallShape`, `capBallSide`. The other four, `capRadiusRatio`, `capTension`, `capAngle`, `capDistance`, are read from the contour and never copied, so those reads are always undefined. Of the four that are copied, nothing writes them except the mirror, which swaps `capBallSide`. This is the dead level the log has found four times.

**Evidence.**

```js
// skeleton-generator.js:2781 — a read that is always undefined at the contour
const capRadiusRatio = firstOnCurvePoint.capRadiusRatio ?? skeletonContour.capRadiusRatio ?? DEFAULT_CAP_RADIUS_RATIO;
```

**Proposal.** Delete the contour level for every cap field. Cap style stays on the contour only if the pen writes it. Check that first.

**Instructions.**

1. Grep `views-editor/src` for `capStyle` writes on a contour object. If the pen sets `contour.capStyle` for a new contour, keep `capStyle` at the contour level and delete the other seven. If not, delete all eight.
2. Delete the `?? skeletonContour.x` clauses in the generator, the four copies in `canonicalToGeneratorInput`, the contour normalization at `skeleton-model.js:1260` to 1266, and the mirror swap at 3673.
3. Run the suite. The fixtures carry no contour-level cap fields, so nothing moves.

**Done when.** `grep -n "skeletonContour\.cap\|contour\.cap" skeleton-generator.js skeleton-model.js` returns only `capStyle`, or nothing.

#### B6 — The eased inner trim loses its provenance and axis on purpose — P3

**Area.** `rebuildTrimmedSide` at `buildDropCap:6308`.

**Problem.** With easing on, the inner edge's trimmed segment is rebuilt without `addressable`, so its two handles carry no provenance and no axis. The reason given is to keep a second gizmo from appearing above the neck. The cost is that the segment's handles get guessed provenance (S1) and the colinearity pass estimates their axis from rounded positions. Provenance and gizmo eligibility are two questions answered with one flag.

**Proposal.** After S1 lands, always pass `addressable: true` and suppress the gizmo by not publishing `constructionSegment` on that point. `buildGeneratedTunniSegments` needs one more skip: a segment whose provenance carries a `noGizmo` mark. Or accept two gizmos a few units apart. Ask the designer which.

**Instructions.** None until S1 is done and the designer has answered.

### Curvature gizmos

#### G1 — Two hit tests for one set of gizmos, and one is dead — P3

**Area.** `generatedTunniHitTest` in `skeleton-model.js:5868`, `findTunniGizmo` in `tunni-gizmos.js:156`.

**Problem.** The editor finds gizmos with `findTunniGizmo`. `generatedTunniHitTest` has no caller outside the tests. Two functions answer "which gizmo is under the point", with different order rules: one prefers the on-curve gizmo, the other takes the nearest. Rail R-B.

**Evidence.**

```
$ grep -rn generatedTunniHitTest src-js --include=*.js | grep -v skeleton-model.js
test-skeleton-tunni.js:14, 660, 673, 684, 697, 777   — tests only
```

**Proposal.** Delete `generatedTunniHitTest`. Move its five tests onto `findTunniGizmo`. `findTunniGizmo` lives in `views-editor`, which has no harness, so move the pure part of it, the loop over segments and the nearest-wins rule, into `skeleton-model.js` as `findGeneratedGizmo(point, radius, skeletonData, path, { onCurve, curvature })`, and have `findTunniGizmo` call it. Then the tests keep a home.

**Instructions.**

1. Read `findTunniGizmo` lines 224 to 248. That block is the generated part.
2. Write `findGeneratedGizmo` in `skeleton-model.js` with that block's body, returning `{ key, distance, gizmoPoint, kind, type, segment }` or null.
3. Rewrite the five tests at `test-skeleton-tunni.js:660` to 777 against it. They pass `includeOnCurve`, `includeCurvature` and `onCurveOffset` options, so the new function takes the same three. The old function checked the on-curve gizmo first and the live one takes the nearest. Keep nearest, which is what the editor already does, and check that no test depended on the old order.
4. Delete `generatedTunniHitTest`. Replace the block in `findTunniGizmo` with a call.

**Done when.** The suite passes and `generatedTunniHitTest` is gone.

#### G2 — A beveled segment has a gizmo but no readout — P2

**Area.** `getGeneratedSegmentCurvature:5814`, `hasForwardTangentIntersection:912`.

**Problem.** The drag on a segment the gizmo has flattened works: it takes the crossing from the published axes because a collapsed handle draws no line. The label and the drag readout go through `hasForwardTangentIntersection`, which is called without the axes, so on the same segment it reports no crossing and the readout is blank. The designer sees a control that moves and no number.

**Evidence.**

```js
// skeleton-model.js:5814 — no axes passed
if (!hasForwardTangentIntersection(points)) {
  return null;
}
// tunni-calculations.js:921 — the function already accepts them, one line down
const directions = handleDirections(segmentPoints);
```

**Proposal.** Give `hasForwardTangentIntersection` a second parameter, `handleAxes`, pass it to `handleDirections` and `tangentIntersection`, and pass `constructionSegmentAxes(...)` from the reader.

**Instructions.**

1. In `test-skeleton-tunni.js`, in "a beveled segment" (429), add a test that drags the gizmo down until one handle collapses, regenerates, and asserts `getGeneratedSegmentCurvature` returns a number rather than null. Run. It fails.
2. Change `hasForwardTangentIntersection(segmentPoints, handleAxes = null)` to use `tangentIntersection(segmentPoints, handleAxes)` instead of `calculateTunniPoint` and `handleDirections(segmentPoints, handleAxes)`.
3. In `getGeneratedSegmentCurvature`, compute the axes once before the check and pass them to both calls.
4. Run the suite.

**Done when.** The new test passes and the label appears on a beveled segment in the editor.

#### G3 — The drag's ceiling and the generator's ceiling are different numbers on a flat segment — P2

**Area.** `calculateCurvatureDragScale:815`, `buildHandleDomain:154`, `MAX_STORED_SEGMENT_TENSION` at `skeleton-model.js:84`.

**Problem.** The drag measures each handle against the true tangent crossing and stops at tension 1 there. The generator measures against a reach capped at twice the chord, so on a flat segment whose crossing sits further away than that, the generator's ceiling is lower than the drag's. The drag lets the readout climb past what the generator will draw, the stored pin goes above the drawable value, up to the sanity cap of 4, and the shape stops moving while the number keeps going. The same segment also drifts on the way back, because the stored number has to walk down to the ceiling before anything moves.

**Evidence.**

```js
// tunni-calculations.js:838 — the drag's unit is the true reach
const units = reaches.map((reach, index) => reach > CURVATURE_EPSILON ? reach : lengths[index]);

// natural-handle-solver.js:227 — the generator's ceiling is min(cap, drawnReach) / reach, cap = 2 × chord
maxTension: drawnReach > EPSILON ? Math.min(cap, drawnReach) / reach : 0,
```

**Proposal.** After the drag computes the pinned handle positions, measure the pin as it already does, then clamp it to the tension the same segment reads back at its ceiling: build the domain once in `calculateGeneratedCurvatureEdits`, compute `generatedSegmentTension` of the pair `(maxStartTension × startReach, maxEndTension × endReach)`, and clamp `tension` to that. The stored number then never exceeds what draws. Lower `MAX_STORED_SEGMENT_TENSION` to 1 after that, because nothing above 1 can be reached any more.

**Instructions.**

1. In `test-skeleton-tunni.js`, add a sweep: a generated segment whose skeleton handles are nearly parallel (a long, gently bent stem, chord 400, handles at 10 degrees off the chord), drag the gizmo outward in 40 steps of 5 units, and after each step regenerate and assert `getGeneratedSegmentCurvature(...).tension` is within 0.01 of the stored pin. Run. It fails where the crossing passes twice the chord.
2. In `calculateGeneratedCurvatureEdits`, after `tension` is computed, build `buildHandleDomain(constructionPoints[0], constructionPoints[3], axes[0], axes[1])` with the same axes `generatedSegmentTension` used, compute the ceiling tension, and clamp.
3. Run the suite. The pinned fixtures store values at or under 1, so nothing moves.
4. Set `MAX_STORED_SEGMENT_TENSION = 1` and run again.

**Done when.** The sweep test passes and no stored pin in any fixture exceeds 1.

#### G4 — The segment join is rebuilt three times per frame — P3

**Area.** `buildGeneratedTunniSegments:5407`, its callers in `tunni-gizmos.js`, `visualization-layer-skeleton.js` and `scene-model.js`.

**Problem.** Every hover pass and every draw of each generated layer rebuilds the list from scratch. Per segment it does two linear searches over the skeleton contour's points for locks and two more for movability. For the glyph sizes in this project that is under a millisecond. It is listed so nobody adds a fifth caller without a cache.

**Proposal.** Nothing now. If profiling ever shows it, memoize on the identity of `skeletonData` and `path` in the scene model and hand the list to the layers.

**Instructions.** None.

#### G5 — The collapse tail is the cost of storing one number — design note, not a defect

**Area.** `collapsedByCurvature` in `skeleton-model.js`, `collapsedSegmentBase` and the `fromBase` seed in `tunni-interactions.js:376` to 449, the `collapse` and `releaseCollapse` writes in `calculateGeneratedCurvatureEdits`, the pin bake in `skeleton-editing.js:1727`.

**Problem.** The pin is the harmonic mean of the two handle tensions. Below the shorter handle's zero the mean reads zero for every length the longer handle still has, so the drag carries the rest as a displacement, marks it as its own, releases it on the way up, regenerates a base at drag start to seed the drag, and bakes the pin into offsets before a direct handle drag clears it. About 300 lines across four files exist to let one number describe a range it cannot. Each round of it was measured and is correct. The weight is the finding.

**Alternative.** Store the pin as the two tensions, start and end, in the same construction unit. The mean and the split are then both stored. The drag writes both. Equalize writes the mean into both. A direct handle drag overwrites its own handle's tension and leaves the other. There is no floor tail, no mark, no base regeneration and no bake. The cost is the property feature model §7 names: today a hand-placed handle and a pin compose with no precedence rule. Under the alternative the last writer wins per handle. There is no production release, so the schema can change.

**Proposal.** A decision for the designer, not an instruction. If yes, it is a plan of its own: schema, generator, drag, equalize, reset, mirror, interpolation, presets, and the deletion of the four mechanisms above.

### Panel

#### P1 — The panel is sound. Three small things — P3

- `_onSerifChange("axismode")` has no field that reaches it. It goes with S4.
- `TERMINAL_FIELD_FALLBACKS.capBallEaseCurvature` puts the neck's curvature into a ball preset, but no field shows it. A preset applied to a ball with easing 0 carries a value the designer cannot see. Either show it as a fourth Ball field, or drop it from the preset. Ask.
- `capValuesFromField("balleasing")` clamps to [0, 1] and `clampCapBallEasing` clamps again in the generator, and the field bounds clamp a third time. Three copies of one bound. The writer is the place. Delete the panel's `Math.min(Math.max(...))` and rely on the field bound plus the model.

---

## 4. Priority list

| # | Finding | Priority | Effort | Touches fixtures |
| --- | --- | --- | --- | --- |
| S1 | Cap points get guessed provenance | P1 | half a day | no |
| B1 | Ball point count changes with easing and size | P1 | one day | maybe, predicted |
| B2 | Neck placed and read by two formulas | P2 | half a day | no |
| G3 | Drag ceiling above the generator's on flat segments | P2 | half a day | no |
| G2 | No readout on a beveled segment | P2 | one hour | no |
| S2 | Easing jumps at full concavity | P2 | one hour | no |
| S5 | Silent flat-cap fallback | P2 | half a day | no |
| B4 | Ball side Auto flips | P2 | two hours | no |
| S4 | Three unreachable axis modes | P3 | half a day | no |
| S7 | Serif authored layers duplicate offset-cubic | P3 | half a day | no |
| G1 | Dead hit test | P3 | two hours | no |
| B3 | Straight-terminal ball search cost | P3 | two hours | no |
| B5 | Contour-level cap fields | P3 | one hour | no |
| S3 | `depthClamped` | P3 | ten minutes | no |
| B6, S6, G4, P1 | small, wait for a reason | P3 | — | — |
| G5 | Store two tensions instead of one | decision | a plan | yes |

Order for an agent: S3, B5, G1 first, because they delete and cannot break a shape. Then S1, G2, S2. Then B2, G3. Then B1 with the designer watching the point-count tests. Then the rest.

---

## 5. What was not found

- The natural solver, the domain and the pin plumbing on an ordinary segment read consistently. The units agree in every branch traced: reach under the floor, between floor and cap, and over the cap, with and without a handle nudge.
- The serif's release rule holds. The cut is on the wall as solved, and the three authored layers land on the surviving piece. The test "moves no on-curve point over its whole range" is the guard and it is right.
- The gizmo's write path is addressed by provenance throughout. No geometric matching was found.
- The panel's streaming and rebuild discipline is careful and no focus-loss path was found by reading. That needs a manual matrix, not a reading.
