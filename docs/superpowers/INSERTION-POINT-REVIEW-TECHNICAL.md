# Insertion points: the technical findings

**Date:** 2026-09-03. Range `d0a15b8ef..HEAD`, 30 commits, 20 files, +6074/−70.
Companion to `INSERTION-POINT-REVIEW.md`, which states the same findings in
designer terms. This file carries the addresses.

**On the line numbers.** They were taken during the review and one was found to
have drifted by seven lines before it was corrected. Others may drift by a
similar amount. Function names are the durable anchor, as the feature model
already says. Grep for the name, do not seek to the line.

**On one measurement.** The 9.57 units in finding 1 came from a probe that ran
once and was not repeated. The mechanism behind it was verified directly. Treat
the number as approximate and the cause as confirmed.

Verification actually run at review time: `npm test` gave 2416 passing and 0
failing, against a baseline of about 2347. `node --check` passed on all nine
touched `views-editor` files. No product code was changed.

---

## 1. `constructionSegment` is built from the centerline

`skeleton-generator.js:2456-2460`, inside `applyInsertionSplits`:

```js
const constructionSegment = [
  segment.startPoint,
  ...segment.controlPoints,
  segment.endPoint,
].map(({ x, y }) => ({ x, y }));
```

`segment` is the centerline. The proof is two lines of the same function:
`:2499` hands the same object to `skeletonSegmentPointAt` to get the centre
point. The value is stamped on both sides at `:2520-2526` and read back through
`storedConstructionSegment`, `untrimmedConstructionSegment` and
`generatedSegmentConstructionPoints` in `skeleton-model.js:5073-5135`.

Probe: uncut stroke reads tension 0.4516 left and 0.3768 right. The same stroke
cut reads 0.4000 on all four segments on both sides. The published points are the
four raw skeleton points, byte-identical left and right.

Precedent for the correct form, same file: `skeleton-generator.js:4837`, the
round-cap split, publishes `segmentPoints`. The corner join at `:5808` does the
same.

Violates FEATURE-MODEL §5, "a gizmo measures the curve its write governs, in the
unit that write is read back in". DEVELOPMENT-LOG carries the same fault class
twice: the serif's trimmed segment at 9.0 and 7.8 units, and the corner's inner
side at 213 and 232 units.

**Fix.** `splitSideAtParameter` already returns `{start, end}` and holds
`handles`. Publish `[start, handles[0], handles[1], end]`. One statement.

## 2. No check exists that could have failed

`docs/superpowers/plans/2026-09-02-insertion-points.md:1023` names the risk in
prose. Against it:

- grep of the range's test diff for `calculateGeneratedCurvatureEdits` and
  `buildGeneratedTunniSegments` returns 0.
- `git log d0a15b8e^..HEAD -- src-js/fontra-core/tests/test-skeleton-tunni.js` is
  empty.
- The 14-row manual matrix at `:2168` has no row for a curvature pin or tunni
  gizmo on a cut segment.

Violates R-G.

**Fix.** One assertion in `test-skeleton-tunni.js`: cut a curved stroke, read
`generatedSegmentConstructionPoints` on both sides, assert they differ. Fails
today, passes after finding 1 is fixed.

## 3. The manual matrix was never run and row 8 is stale

`plans/2026-09-02-insertion-points.md:2168` is `- [ ] **Step 4: Run the manual
matrix**`, unchecked. `:2170` says to record the result in DEVELOPMENT-LOG;
`grep -in insertion docs/superpowers/DEVELOPMENT-LOG.md` returns nothing.

Row 8 at `:2188` says the insertion point's width field is greyed.
`panel-skeleton-parameters.js:1235` says the opposite, and `:1241` sets
`const gate = { minValue: 0 }` with no `disabled`.

Violates R-G.

## 4. The second half of a cut segment addresses its pin to an insertion id

Provenance is stamped with the insertion id at `skeleton-generator.js:2520-2526`:
`skeletonPointId: insertion.id, role: "onCurve", insertion: true`. The write
address is taken straight off that in `skeleton-model.js:4731-4735` and returned
at `:4779-4782`, with no `insertion` guard in that region.

The insertion schema is `id, pointId, t, width, easing` and nothing else:
`normalizeSkeletonInsertion`, `skeleton-model.js:1372-1385`.

Probe: two of the four cut segments report `write: id=20`.

Violates FEATURE-MODEL §7, "a pin is stored per segment per side, keyed on the
segment's START point".

**Fix.** Either give the second half's on-curve provenance the parent skeleton
point's pin address, or refuse `insertion === true` as a segment start inside
`buildGeneratedTunniSegments`. The second option gives finding 7's dead flag a
reader.

## 5. A cut straight enumerates four gizmos that all refuse to drag

The outer handles a cut straight creates carry `role: null`:
`skeleton-generator.js:2528-2545`.

`calculateGeneratedCurvatureEdits` refuses any segment whose two middles are not
`in`/`out`: `skeleton-model.js:4674-4688`.

The enumerator applies no such filter: `skeleton-model.js:4828-4856` checks only
off-curve type, non-null provenance, and a single side.

Probe on a two-point straight with one insertion: four segments enumerated, all
four return `edit: NULL`. `buildGeneratedTunniSegments` at
`skeleton-model.js:4798-4808` is the one join both the visualization layer and
the pointer tool use, so both drawing and hit-testing see them.

Violates FEATURE-MODEL §7, "a drawn control that cannot move is worse than no
control".

**Fix.** Reject `role: null` in the enumerator's provenance check at
`skeleton-model.js:4845-4856`. One clause, and it covers any future unstamped
handle.

## 6. Insertions have no cross-layer address resolution

Add mints per layer via `allocateSkeletonId(working)` off each layer's own
`nextId`: `skeleton-model.js:4308`. No sync step.

Delete matches literally: `editor.js:2629-2637` builds a `Set` of
`contourId/insertionId` and applies it to every layer;
`skeleton-model.js:1390-1396` filters on the same literal pair. Panel edits do
the same and `continue` on a miss: `skeleton-panel-edits.js:443` and `:474`.

The sibling branch in the same handler does it correctly: `editor.js:2652-2667`
resolves through `resolveSkeletonAddressAcrossLayers`, under the comment at
`:2621` "Selection ids are canonical in the edit layer; other layers resolve by
structural ordinal (WS-9)". That helper has 17 call sites. The two new insertion
target-entry builders at `skeleton-editing.js:1122` and `:1176` use bare
`getSkeletonInsertion`.

The comment at `skeleton-panel-edits.js:454-456` asserts insertion ids are
"stable across layers the same way a point id is". That is the claim the point
code declines to rely on.

Mechanism confirmed by reading. Divergence of `nextId` in the field was reasoned,
not reproduced.

**Fix.** Route the insertion branch through the pattern at `editor.js:2652`, or
state in a comment why insertion ids need no ordinal fallback where point ids do.

## 7. `insertion: true` is a dead level

Written four times in production: `skeleton-generator.js:2524`, `:2532`, `:2540`,
`:2556`. Read only in tests: `test-skeleton-generator.js:4136`, `:4153`, `:4231`.
The lookup it exists to disambiguate matches on `skeletonPointId` alone:
`skeleton-panel-edits.js:406`.

DEVELOPMENT-LOG §0 counts four dead levels. This is five.

**Fix.** Delete it, or make finding 4's guard read it.

## 8. `cubicTangentAt` now exists in four places

`harmonization.js:916`, `harmonization.js:992`, `snapping.js:79` (not exported),
and new at `skeleton-model.js:1299`.

Two lines above the new copy, `skeletonSegmentPointAt` at
`skeleton-model.js:1276` correctly calls the shared `cubicPointAt`, which this
same diff added at `offset-contour.js:465`.

Violates R-B.

**Fix.** Export `cubicTangentAt` beside `cubicPointAt` in `offset-contour.js`.

## 9. The new module re-implements cubic evaluation, against its own comment

`offset-contour.js:465-489`, added by this diff, reads: "The one copy. The
generator's corner search and **the skeleton's insertion points** both evaluate
cubics, and an evaluator that disagreed with itself would put a rib somewhere the
outline does not go."

`skeleton-insertions.js:100-109` (`evaluatePiece`) is a second de Casteljau
evaluator, with its own `lerp` at `:194-196`. The module's only import is
`intersect` from `./vector.js`.

Violates R-B, the rule that exists because the donor had `projectRibPoint` twice.

**Fix.** Import `cubicPointAt`. Nine lines removed.

## 10. A third `splitCubic`

`skeleton-insertions.js:260` (new), `serif-geometry.js:469` (returns
`{first, second}`, UV coordinates), `skeleton-generator.js:1297`
(`splitCubicInHalf`, t = 0.5 only).

Violates R-B.

**Fix.** One exported `splitCubic(p0..p3, t)` beside `cubicPointAt`;
`splitCubicInHalf` becomes a call with `t = 0.5`.

## 11. The selection key kind is not exported and is hand-assembled

`SKELETON_INSERTION_KEY_KIND` is defined at `skeleton-model.js:3501` and not
exported. The literal `"skeletonInsertion"` is hardcoded at
`skeleton-editing.js:1134`, `skeleton-panel-model.js:128`, and
`visualization-layer-skeleton.js:219`, where the key is rebuilt by hand:

```js
(parseSelection(selection).skeletonInsertion || []).map(
  (item) => `skeletonInsertion/${item}`
)
```

The comment on that block records the fault it caused, fixed in `891206d31`.

Violates R-B in its constants form.

**Fix.** Export the kind, or add one `parseSkeletonInsertionSelectionItem(item)`
helper so the "put the kind back on after `parseSelection`" ritual happens once.

## 12. Two width references, and the exported one is dead

`skeleton-panel-edits.js:362` exports `insertionWidthReference`. Its only other
mention repo-wide is a now-false doc comment at `skeleton-panel-model.js:615`.

The real reader is `insertionWidthReferenceFromSkeleton`
(`skeleton-panel-edits.js:386`), which computes `distance / ratio` at `:417`.
`skeleton-model.js:3669` computes the same quantity from the drawn path.

Same formula, two implementations, two data sources, while
`panel-skeleton-parameters.js:1219-1221` claims "The conversion has one home".

Violates R-B and DEVELOPMENT-LOG §0, dead level.

**Fix.** Delete `:362-377` and fix the comment at `skeleton-panel-model.js:615`,
or promote the dead one to be the one home, which also fixes finding 13.

## 13. A full generator pass per insertion, per side, per panel rebuild

`panel-skeleton-parameters.js:1242-1248` sits inside
`for (const side of ["left","right"])`. The chain is `:1290`
`_insertionWidthSummary` → `:1291` `_insertionReference` → `:1309`
`insertionWidthReferenceFromSkeleton` → `skeleton-panel-edits.js:397`
`generateFromSkeleton(skeletonData)`.

The scrub adds two more setup runs at `:2326` and `:2365`.
`skeleton-generator.js` is about 4,730 lines.

Not a named rail. It is the practical cost of finding 12.

**Fix.** Use the layer path the visualization layer already reads,
`getSkeletonInsertionRibPosition` at `visualization-layer-skeleton.js:188-189`,
which is the dead export. Or memoize one generation per rebuild.

## 14. `collectTiedRibGroups` shares its body and not its precondition

Call sites: `skeleton-generator.js:4106`, `skeleton-model.js:606`, `:3245`,
`:3274`. Every caller must remember to pass the cut set.

`skeleton-generator.js:4111` carries the warning: "Must match skeleton-model.js
exactly, or the gizmo and the outline disagree about where a rib is, which is the
fault the tie report was."

**Fix.** Have `collectTiedRibGroups` derive the cut set from the contour it is
already given.

## 15. Two constants written and never read; one function with no product caller

`SPLIT_MIN_PARAMETER` and `SPLIT_MAX_PARAMETER` appear only at their definitions,
`skeleton-insertions.js:13` and `:14`. The parameter is clamped elsewhere by
`Math.min(1, Math.max(0, t))` at `skeleton-insertions.js:148` and again by
`normalizeSkeletonInsertion` at `skeleton-model.js:1382`. The constants state a
bound the code does not apply.

`makeSkeletonInsertion` is defined at `skeleton-model.js:1387` and called only
from `tests/test-skeleton-model.js`.

DEVELOPMENT-LOG §0, dead level.

## 16. `INSERTION_STUB_LENGTH` is 0 and two comments say one unit

`skeleton-insertions.js:21` is `export const INSERTION_STUB_LENGTH = 0;`. Used at
`:252`. Against it, `skeleton-insertions.js:478-481` says "handles start one unit
long" and `tests/test-skeleton-generator.js:4233` says "the one-unit handles
either side of each".

Probe: on the emitted straight, the handles at indices 2 and 4 sit at exactly the
on-curve's coordinates.

DEVELOPMENT-LOG §0, "Quoting a rule is not applying it".

## 17. The easing bound is written in three places, the width floor in four

Easing: `panel-skeleton-parameters.js:1319`, `skeleton-panel-edits.js:503`,
`skeleton-model.js:4345`, plus the widget's own `-100/100` at
`panel-skeleton-parameters.js:1261-1262`.

Width floor: `panel-skeleton-parameters.js:1241`, `skeleton-panel-edits.js:421`,
`skeleton-model.js:3678`, `:4354-4355`.

DEVELOPMENT-LOG, "Where each bound was written": "The same ceiling, written in
three wrong places… the bound belongs in the writer."

**Fix.** Drop the clamp at `panel-skeleton-parameters.js:1319`, leaving a pure
`/100`.

## 18. One `linked` flag governs both the width link and the easing link

One checkbox, `key: "insertion:linked"`, at
`panel-skeleton-parameters.js:1229-1233`. `skeleton-panel-edits.js:505-507`:
`if (insertion.width.linked !== false) { insertion.easing[opposite] = value; }`.
`setInsertionWidthLinked` at `:513-519` also overwrites `insertion.easing.right`.
The model has no `easing.linked`: `skeleton-model.js:4343-4350`.

Deliberate. Commit `6f27b3196` argues it and the rationale is in the core comment
at `skeleton-model.js:4335-4341`. Listed because the panel label does not say it,
and because DEVELOPMENT-LOG §0 records "one number cannot hold two jobs" five
times.

## 19. No documentation dissolution was performed

`git log --oneline d0a15b8e^..HEAD` restricted to `FEATURE-MODEL.md`,
`FEATURE-ARCHITECTURE-MAP.md`, `DEVELOPMENT-LOG.md` and `GLOSSARY.md` is empty.

`grep -ci insertion`: FEATURE-MODEL 0, FEATURE-ARCHITECTURE-MAP 1 (line 431,
unrelated, a `panel-designspace-navigation.js` row), DEVELOPMENT-LOG 0,
GLOSSARY 0.

`serif-geometry.js`, the module this feature's seam was modelled on, is
documented at `FEATURE-ARCHITECTURE-MAP.md:240` with its line count and role.
`skeleton-insertions.js` (556 lines) and `test-skeleton-insertions.js` (450
lines) appear in zero docs.

Two plan files were added and left on disk:
`docs/superpowers/plans/insertion-points.md` and
`docs/superpowers/plans/2026-09-02-insertion-points.md`, 2,583 lines together.
The map header's own rule: "the `specs/` and `plans/` folders are dissolved… if a
statement is still true, it is in one of the docs below." The surviving
`serif-axis-tilt.md` is not a precedent, because the map header discloses it as a
tracked leftover. These two are undisclosed.

Ten `fix(skeleton)` commits in the range are the class of fault DEVELOPMENT-LOG
exists to record. None was recorded.

## 20. Stale comment: the width reference no longer tries two glyphs

`panel-skeleton-parameters.js:1284-1288` describes a two-candidate lookup, "both
are tried rather than one being assumed". The method calls `_insertionReference`
at `:1304-1315`, which reads one layer and returns
`insertionWidthReferenceFromSkeleton`. One candidate, no path lookup. Superseded
by `4733a320f`.

## 21. The model-side test additions are per-configuration assertions

The 23 added `it(...)` blocks in `test-skeleton-model.js` and
`test-skeleton-ribs.js` are single-configuration assertions. By contrast
`test-skeleton-insertions.js:253`, `:299` and `:353` are genuine 400 to 500 step
continuity sweeps, and `:343` is a genuine invariant.

A grep of the test files for `easing` near `-1` returns one normalization
assertion, `test-skeleton-model.js:2364`. The negative branches at
`skeleton-insertions.js:407-409` and `:419-420`, and the −1 clamp at
`skeleton-model.js:4344-4351`, are exercised by nothing that draws.

Violates R-G and DEVELOPMENT-LOG §0, "test a geometry change with a sweep, not an
assertion".

---

# Reasoned, not reproduced

Listed separately because no failing check was run for any of them.

**P1. Point count can depend on geometry in three guarded exits.** Each returns
one side unchanged while the other gains three points:
`skeleton-insertions.js:216-218` (zero-length straight returns one bare point
instead of five); `skeleton-insertions.js:144-146` (null on an unexpected handle
count) with `skeleton-generator.js:2497-2499` returning the side untouched; and
`skeleton-generator.js:2488-2490` (null anchor). No input was constructed that
reaches any of the three. Violates FEATURE-MODEL §3 point-count stability. The
smaller form is one refusal taken before either side is cut.

**P2. `coupledEnds`' comment and its return disagree.** `offset-contour.js:66-71`
says the run from the controlled end to the cut is held and the far end released.
`:113-118` returns `[]` whenever fewer than two ends are held, so with one
controlled end a cut releases both. The behaviour is deliberate and correct, per
the inline comment at `:114-116` and locked in by `test-skeleton-ribs.js`. The
comment a reader reaches first says something else.

**P3. The rib selection kind now addresses two things.**
`makeSkeletonRibKey(contour.id, insertion.id, side)` is reused for insertion ribs
at `visualization-layer-skeleton.js:529`, so `skeletonRib/<contourId>/<id>/<side>`
means either a point's rib or an insertion's rib. It is disambiguated by hand at
`skeleton-panel-model.js:97-108`, `skeleton-editing.js:1199`, and
`edit-tools-pointer.js:881`/`:891`. Collision was checked and is not present:
insertion ids come from the same allocator as point ids (`skeleton-model.js:1571`
against `:1166`/`:1180`), so ids are unique within a skeleton. The cost is three
hand-written orderings a future consumer must reproduce.

**P4. A side stored at width 0 may be a one-way trip.**
`skeleton-panel-edits.js:417` returns null unless `ratio > 0`, and
`skeleton-model.js:3665` does the same. The reference is recovered by dividing
the measured distance by the stored ratio, so a side at 0 has no recoverable
reference and the field blanks. The width floor is 0
(`panel-skeleton-parameters.js:1241`), so a designer can reach it. Matrix row
candidate.

**P5. The held-key machine exists in two copies.**
`edit-tools-skeleton.js:56-104` reimplements the mode machine at
`edit-tools-pointer.js:1475-1545`. Commit `195bc0710` argues this deliberately
and the code carries the argument at `edit-tools-skeleton.js:43-51`. R-B names
constants and geometry functions, not event plumbing, so this is not a violation.
Recorded so it is not later rediscovered as accidental.

**P6. Terminology collision.** `FEATURE-MODEL.md:1166` already uses "the inserted
point's provenance" for a different concept, a generated point on a trimmed
curve. The new designer-placed "insertion point" shares the name.

---

# Rail compliance, one line each

- **R-A, layer placement.** PASS. Hit-testing in `scene-model.js:1084`
  (`skeletonInsertionAtPoint`, dispatched at `:797`); interaction in
  `skeleton-editing.js:1120-1176`; rendering inside the existing `ribs` and
  `rib-points` layer definitions at `visualization-layer-skeleton.js:429`/`:520`.
  `edit-tools-pointer.js` is +23/−0: two guarded `return create…TargetEntries(…)`
  calls with ordering comments and one `.length` check. Still a dispatcher.
- **R-B, one copy.** FAIL, repeatedly. Findings 8, 9, 10, 12, with 11 and 14 as
  the constants-and-contract variants. The most repeated fault in the change.
- **R-C, one write path.** PASS. Every mutation goes through `editSkeleton` /
  `makeEditSkeletonChange` / `runSkeletonPanelEdit`: `editor.js:2634`,
  `edit-tools-skeleton.js:871`, `skeleton-editing.js:1155`, `:1225`,
  `skeleton-panel-edits.js:449`, `:479`. No `customData` write and no
  `recordChanges` bypass. The one new generator call at
  `skeleton-panel-edits.js:397` is a read-only measurement, but see finding 13.
- **R-D, provenance forward.** PASS. `getSkeletonInsertionRibPosition`
  (`skeleton-model.js:3362-3392`) resolves through `findGeneratedPathAddress`,
  never by proximity. `insertionWidthReferenceFromSkeleton` resolves by
  provenance lookup at `skeleton-panel-edits.js:404-409` and only then measures.
- **R-E, no kind-branching in shared emit.** PASS. `edit-behavior.js` contains
  zero occurrences of "insertion".
- **R-F, modifiers are behavior names.** PASS.
  `REALTIME_INSERTION_POINT_ACTION = "action.realtime.insertion-point"` at
  `edit-tools-skeleton.js:52`, registered at `editor.js:756`, matched through
  `eventMatchesActionShortCut`. No raw key comparison.
- **R-G, evidence.** FAIL, the largest gap. Findings 2, 3, 21.

# Hard constraints

- **Point-count stability.** PASS with a reservation. Sweep-tested over 41
  parameter values at `test-skeleton-generator.js:4069`, and add and delete both
  span all editable layers. Reservations are P1 and finding 6.
- **Construction segment rule.** FAIL. Finding 1, reproduced.
- **Curvature pin.** FAIL. Findings 4 and 5.
- **Authored-state ordering.** PASS. The split runs after
  `solveSkeletonContourSides` and after every authored layer, before the corner
  join and the rounding: `skeleton-generator.js:2603-2616`. Cuts descend by
  parameter for index stability at `:2431-2434`.

# Known traps

- **`canonicalToGeneratorInput` copy.** AVOIDED on purpose. All five new fields
  are copied at `skeleton-generator.js:250-259`, with a comment naming the prior
  failure. `width` and `easing` travel as spreads, so future subfields arrive
  without a copy line.
- **Geometry by position.** AVOIDED. See R-D.
- **Rollback against the live glyph.** AVOIDED. Both new target-entry builders
  capture `cloneLayerGlyphForSkeletonEdit(layer)` before the drag, at
  `skeleton-editing.js:1150` and `:1220`, and rebuild each frame from that copy.
- **Dead level.** HIT three times: findings 7, 12, 15.
- **One number, two jobs.** HIT once, knowingly: finding 18.
- **Bound in the wrong place.** HIT: finding 17.

# Structure

The seam is right. `skeleton-insertions.js` is the `serif-geometry.js` pattern
properly applied: pure point-list geometry out, splicing and provenance kept in
the generator. Nothing in the generator's +243 (anchor bookkeeping at `:2288-2310`
plus the splice at `:2429-2571`) or the model's +452 (schema, accessors, keys, two
executors, placed beside where `createSkeletonRibExecutor` already lives) belongs
in the new module. The +452 is placement, not padding.

The coupling and tie rule was generalized in place, from a boolean to a list of
coupled ends, rather than copied. That is the right call.

Editor-side duplication is the weak part: finding 12, finding 11, and P5.

The revert of the separate shortcuts file is complete. `realtime-modifiers.js`
(94 lines) is gone, and `_realtimeModifierKeyUpHandlers` appears 7 times in
`edit-tools-pointer.js` both before the range and at HEAD, so those are
pre-existing pointer internals and not orphans.

---

# Fix order

Numbered to match `INSERTION-POINT-REVIEW.md` part two.

| # | change | finding |
| - | ------ | ------- |
| 1 | delete `SPLIT_MIN_PARAMETER` / `SPLIT_MAX_PARAMETER`, `skeleton-insertions.js:13-14` | 15 |
| 2 | fix the stub-length comments at `skeleton-insertions.js:478-481` and `test-skeleton-generator.js:4233` | 16 |
| 3 | delete the two stale sentences at `panel-skeleton-parameters.js:1284-1288` | 20 |
| 4 | drop the clamp at `panel-skeleton-parameters.js:1319` | 17 |
| 5 | **publish the side's own points at `skeleton-generator.js:2456-2460`** | 1 |
| 6 | one assertion in `test-skeleton-tunni.js`; fails today | 2 |
| 7 | reject `role: null` at `skeleton-model.js:4845-4856` | 5 |
| 8 | one home for the width reference; delete `skeleton-panel-edits.js:362-377` or promote it | 12, 13 |
| 9 | export `SKELETON_INSERTION_KEY_KIND` or add a parse helper | 11 |
| 10 | export `cubicTangentAt`; import `cubicPointAt` into the new module; one `splitCubic` | 8, 9, 10 |
| 11 | guard the insertion pin address in `buildGeneratedTunniSegments` | 4, 7 |
| 12 | route insertion delete and panel edits through `resolveSkeletonAddressAcrossLayers` | 6 |
| 13 | run the 14-row matrix, strike row 8, add two rows, record it | 3, P4 |
| 14 | dissolve the docs, then delete both plan files | 19 |
| 15 | `collectTiedRibGroups` derives its own cut set; split or relabel the linked flag | 14, 18 |
