# forkra Development Log

Running record of work done on `main` since the post-refactor baseline
(`df2076171`, 2026-07-24, "fork feature set squashed onto current upstream").

One entry per feature or fix, newest last. Each entry has the same four parts:

1. **Problem** — what was wrong or missing.
2. **Solution** — what we did, in plain language.
3. **Commits** — every commit that belongs to the entry, oldest first.
4. **Challenges and findings** — what went wrong on the way, and what we learned
   that isn't obvious from the diff.

Companion docs: `FEATURE-ARCHITECTURE-MAP.md` (what lives where) and
`SKELETON-FEATURE-MODEL.md` (skeleton mental model). Dated implementation specs
and plans may exist under `specs/` and `plans/`, but their durable conclusions
must be folded into these standing documents. Where an older entry names a
retired spec, its durable content is in the feature model.

---

## 1. Curve harmonization (F9) — feature

**Branch:** `feature/harmonize` → merged to `main`
**Dates:** 2026-07-25 – 2026-07-26
**Specs:** retired in `28db0e869` ("docs: cleanup"); the durable content is in this entry.

### 1. Problem

A smooth on-curve point guarantees only G1 continuity: the two handles are
collinear, so the tangent direction matches across the joint, but the curvature
usually jumps. That jump shows up as a visible crease under a reflection or a
curvature comb, and it has to be fixed by hand, one joint at a time.

Other editors solve this (Glyphs' Harmonize, Supertool, Green Harmony). forkra
had nothing.

### 2. Solution

A **Harmonize** action, on F9 and in the context menu, plus a section in the
Transformation sidebar panel.

For each selected smooth on-curve point we look at a five-point stencil —
`PP P node N NN` — and compute where the joint would have to sit for the
curvature to be continuous. The construction is Simon Cozens': intersect the two
outer handle lines to get a point `D`, take
`ratio = √((|NN−N|/|N−D|) · (|D−P|/|P−PP|))`, and the harmonic target is
`lerp(N, P, ratio/(ratio+1))`.

That target differs from the current joint by a fixup vector. A **bias slider**
decides who absorbs it: at one end the on-curve point moves and the handles stay
put, at the other the two handles move and the on-curve point stays put. The
relative displacement is identical either way, so the resulting curve is the same
shape — only its position at the joint differs.

Two extra passes:

- A **tension ceiling**: no handle is allowed past its Tunni point (tension 1),
  because beyond that the segment's two handle lines cross and the curve loops.
  Handles that already start over 1 are pulled back under it.
- **Optional Tunni equalization**, off by default: balances the outer handles
  before harmonizing. It moves `PP`/`NN`, which are inputs to the math, so it
  costs exactness in return for a more even segment.

All coordinates are rounded to whole units on the way out. Multi-source is
supported (apply to other sources on/off). Points that can't be harmonized —
corners, non-curve joints, degenerate geometry, skeleton-generated contours —
are reported with a reason rather than silently skipped.

Math lives in `fontra-core/src/harmonization.js` (pure, 49 mocha tests). The
editor calls it from `scene-controller.js`; the UI is in
`panel-transformation.js`.

### 3. Commits

| Commit      | Subject                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| `4df999813` | docs: add curve harmonization (F9) design spec                                        |
| `0cbaf2174` | docs: split the two deferred skeleton items in the F9 spec                            |
| `fb956451d` | feat: initial implementation                                                          |
| `9dfe9f4ff` | fix(harmonize): write through setPointPosition, not a path assignment                 |
| `482a4158c` | feat(harmonize): report why each point was skipped or left partial                    |
| `1c4b24b50` | feat(harmonize): optional Tunni equalization, the pass that moves outer handles       |
| `f72e9cebe` | fix(harmonize): drain the slider's valueStream, so the applied bias is the shown bias |
| `92f660621` | fix(harmonize): show the bias number; rename the slider end to "point"                |
| `e479f706c` | fix(harmonize): apply the bias the slider shows, not the one the model stored         |
| `c1f76ebe1` | feat(harmonize): cap each handle's tension at 1 so handles cannot cross               |
| `aa1adcaa5` | feat(harmonize): pull an over-tension handle back under the ceiling                   |
| `251f96cd6` | feat(harmonize): round the moved points to whole units                                |

### 4. Challenges and findings

**Harmonization converges in one pass, at any bias.** The spec assumed
iteration was needed and that a handle-heavy bias would take more passes. It
doesn't. The ratio depends only on the perpendicular offsets of `PP` and `NN`
from the tangent line, and neither the joint nor the handles moving _along_ the
tangent changes those offsets. `D`'s own offset cancels out of the formula. So
one pass is exact regardless of where the bias puts the correction. Iteration
earns its keep only on **coupled** joints — adjacent smooth points that share a
handle, where joint B's `N` is joint C's `PP`.

**The five-point stencil is complete.** Endpoint curvature of a cubic depends
only on its last three control points, so `PP` and `NN` are inputs to the
calculation, never outputs. That is why the default algorithm doesn't touch the
outer handles, and why Tunni equalization — which does touch them — has to be a
separate opt-in pass.

**Writing a whole path inside `recordChanges` doesn't survive the round trip.**
The first implementation assigned `layerGlyph.path = newPath`. The change
recorder wraps the subject in a Proxy and records the assignment as a live class
instance, which fails on replay with `this.coordinates.addItemwise is not a
function`. Multi-source editing was broken as a result. Fix: write per point via
`setPointPosition`, which the recorder proxies into an `=xy` change with proper
rollback (`change-recorder.js:69`). This is a general rule for any future
geometry operation, not a harmonization quirk.

**A dragged `edit-number-slider` doesn't deliver its value through
`onFieldChange`.** It fires once at `dragBegin` with the _pre-drag_ value; every
subsequent value arrives on a `valueStream` `QueueIterator`. So the setting we
stored was always one drag stale — the node kept moving in full-handle mode
because the code was reading bias 0.2 while the slider showed 1.0. Two fixes:
drain the `valueStream` in `onFieldChange`, and register getters/setters for
sliders in `ui-form.js` so the applied value can be read straight off the DOM.

**Chasing that bug took far too long** because the model was assumed correct and
the UI was assumed innocent. The user's console dump of the options object is
what settled it. When reported behaviour contradicts the math, instrument the
boundary between them first.

**`displayValue: true` is not a boolean.** It's a placeholder _string_ that
blanks the number box (`range-slider.js:256-262`), so the box literally read
"true".

**Supertool moves more handles than its `harmonize:` method does.** The method
itself only moves the joint's immediate neighbours, but the Harmonize _command_
brackets it with `[self balance]`, which moves the adjacent segments' handles
too. That's the source of the "it moves adjacent handles" observation, and it
maps to our optional Tunni equalization pass, not to the core algorithm.

**Tension above 1 is abnormal in practice.** Real handles sit around 0.4–0.7.
A tension over 1 means the segment's handle lines cross, so the ceiling both
prevents the algorithm from creating that state and repairs it where it already
existed.

**Known caveat:** rounding happens after the tension ceiling, so a handle at
exactly tension 1 can land a fraction over it. Sub-unit, not visible. A small
margin (ceiling 0.98) would remove it if it ever matters.

---

## 2. Segment selection deselected shared points — fix

**Branch:** `fix/segment-selection-deselect-bug` → merged to `main`
**Date:** 2026-07-26

### 1. Problem

Clicking a segment selects its two on-curve points. Shift-clicking an adjacent
segment should have added its two points to the selection, but instead it
_removed_ the point the two segments share — so you could never build a
selection by walking along a contour.

### 2. Solution

Shift-click on a segment now toggles the segment as a unit instead of XOR-ing
its individual points: add the segment's points unless all of them are already
selected, in which case remove them. Adding an adjacent segment therefore keeps
the shared point, and shift-clicking a fully selected segment still deselects it.

`selectionAtPoint` now flags segment hits with `isSegment: true` so the pointer
tool can tell a segment click from a point click. Both path segments and
skeleton centerline segments flow through that one function, so the fix covers
basic and skeletal points together.

Unmodified click (replace), ⌘-click (union) and ⌘⇧-click (subtract) are
unchanged.

### 3. Commits

| Commit      | Subject                                               |
| ----------- | ----------------------------------------------------- |
| `f757a2e53` | fix(selection): make shift-clicking segments additive |

Files: `scene-model.js` (two return sites), `edit-tools-pointer.js`
(`toggleSegmentSelection`, applied only when the hit is a segment and the mode
is symmetric difference).

### 4. Challenges and findings

**The bug was in the selection _mode_, not the hit test.** `getSelectModeFunction`
maps shift to `symmetricDifference`, which is right for a single point and wrong
for a multi-point hit. The hit test was returning the correct two points all
along.

**Segment granularity is the right unit for the toggle.** Plain union would have
fixed the reported bug but removed any way to shift-click a segment off again.
Toggling the whole segment keeps both behaviours.

**One flag covers both geometry kinds.** Path and skeleton segment hits both
return from `selectionAtPoint`, and the pointer tool is the only entry point for
either, so there was no second code path to patch.

**`edit-tools-pointer.js` reads the global `window.event`** at the mode-function
call site (the local parameter is named `initialEvent`). It works, but it is
fragile — worth cleaning up if that function is touched again.

**Prettier reports both edited files as unformatted, and did so before the
change.** Left alone deliberately; reformatting them would bury the fix in
noise.

---

## 3. Generated outline handles jumped during a drag — rework

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Dates:** 2026-07-26
**Spec:** dissolved into `SKELETON-FEATURE-MODEL.md` §3.2

### 1. Problem

Moving a skeleton point by one unit could flip the adjacent generated segments
into a completely different handle configuration — one that fitted the curve just
as well but looked nothing like the previous frame's. Each frame's output was
geometrically fine; it just wasn't continuous in the input, so a designer could
not predict where a generated handle would land. Worst exactly where it matters:
when the distance between skeleton points is small relative to the rib width.

### 2. Solution

Replaced sampling-and-fitting with a closed-form construction. Offsetting a cubic
preserves the tangent direction exactly and scales its speed by `1 + width ×
curvature`, so for one cubic per side the endpoints and directions are known and
the only free numbers are two handle lengths — which have a closed form too. The
rule a designer can hold: **the generated handle is the skeleton handle scaled by
one plus width times curvature.**

Handle direction stays locked to the skeleton's, exactly as before. One fixed
least-squares correction pass recovers accuracy where the widths taper, then
smooth bounds replace the old hard clamps. Seven discrete decisions came out of
the pipeline — an adaptive error-threshold loop, variable curve splitting, a
Newton iteration with early bail, an eight-direction snap for short handles, and
the average-width-then-translate hack for tapered sides.

### 3. Commits

| Commit      | Subject                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `1ad572170` | docs: add skeleton offset construction design spec                         |
| `6862cd7e7` | docs: bound generated handles by tangent-ray intersection                  |
| `91c99f2a8` | docs: pin the offset spec's integration surface                            |
| `0b894092d` | docs: withdraw the unrounded-rib-endpoint plan                             |
| `9f321429e` | docs: cover collapsed sides and single-sided contours                      |
| `055d16ce3` | docs: initial plan                                                         |
| `118e59919` | docs: add skeleton offset construction implementation plan                 |
| `b8d189f27` | docs: drop the quadratic-segment handling from the plan                    |
| `12c7f5e96` | docs: lock generated handle direction to the skeleton; fix review findings |
| `2885f91db` | docs: keep the minimum-handle guardrail; measure the tension bound first   |
| `a78c51cda` | docs: reconcile spec drift after the direction-locking revision            |
| `b2c750e5d` | docs: rewrite the implementation plan for the length-only construction     |
| `52346b21a` | docs: drop the donor-parity framing from the fixture work                  |
| `4ea94c37e` | fix: generate skeleton fixtures from this generator, not the pre-port one  |
| `864c0bbe9` | refactor: expose the two-handle least-squares solve from fit-cubic         |
| `4acb82a34` | fix(plan): make the cusp floor exactly inert                               |
| `c1bd7bc5d` | fix: make the cusp floor exactly inert in offset-cubic                     |
| `79d3914e9` | feat: bound generated handle length                                        |
| `f1510b084` | feat: one fixed correction pass for the offset construction                |
| `5dfdff706` | test: cover continuity of the offset cubic construction                    |
| `597038307` | feat: construct generated handle lengths instead of fitting them           |
| `8bdef4f34` | feat: floor the tension limit at a third of the chord                      |
| `0479d309d` | docs: retitle generator fixtures and update cubic pipeline                 |
| `db2710771` | docs: update the skeleton cubic construction model                         |
| `6158aa278` | refactor: remove disabled handle-direction alignment                       |
| `be4bd3f55` | refactor: remove superseded offset machinery                               |
| `40b6cc12b` | fix: ease the offset correction band                                       |

### 4. Challenges and findings

**The fixture script could not be run at all.** It was a leftover from the
porting era: it imported the pre-port generator from a path that resolves to a
directory that does not exist, in a checkout that is gitignored, referencing a
commit that is not an object in this repo. So the golden masters could not be
regenerated by anyone, from a fresh clone, or in CI. Fixed first, before any
geometry changed, and proved by regenerating byte-identically.

**Two smoothing forms that look inert are not.** A square-root cusp floor shifts
its input by a small constant over the input, and that shift is then multiplied by
the handle length — 0.022 units on a 55-unit handle, growing with the handle, so
no fixed test tolerance survives it. A p-norm smooth minimum returns 84% of its
argument when both arguments are equal, a 16% shortfall even when the bound is not
binding. The polynomial forms are _exactly_ the min or max outside a blend window,
which is what makes "no saturation on ordinary input" an exact invariant instead
of an approximate one. Mixing an exactly-inert form with a never-inert one is what
produced a miscalculation in the first draft.

**The bound needed a floor for an ordinary reason, not an exotic one.** The
tangent-ray intersection can slide backwards onto the start point whenever a start
tangent points near the far endpoint — not only past a 180° turn, as first
assumed. Measured on an ordinary curve: the handle squeezed to 0.6 units, then
sprang back 41.9. Floored at a third of the chord, which at least means something
— it is the handle length of a neutral cubic.

**An error function was being compared against a linear tolerance while returning
a squared distance**, so the effective tolerance was distorted and scale-dependent.
Part of why the old behaviour differed by glyph size.

**A one-time output change, bounded by locking direction.** Endpoints don't move
and directions don't move, so mid-segment deviation lands within the range the old
fit already tolerated — 1–3 units on a 60-unit stroke, zero at the ends. Had the
handles been tilted to the true offset tangent instead, the same change would have
moved handle points by tens of units on tapered strokes.

---

## 4. Rib width rotated the handles it should not touch — fix

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-26

### 1. Problem

Two faults with one shape. A smooth skeleton point with a single handle has no
direction of its own — smoothness forces the handle collinear with the straight on
its other side — so the straight owns the direction. But the ribs at the two ends
of that straight sat at independent offsets, which tilts the generated
rib-to-rib line away from the skeleton straight, and the generated handle was then
re-collinearized against the tilted line. Changing a rib width therefore rotated
handles: measured 8.5° over a half-width sweep with both ends controlled, ~16°
with one. Separately, the smoothing pass estimated its axis from handle _lengths_,
and rib width sets handle length, so width rotated the axis there too — 1.1° mean
and 12.5° worst per single unit of width.

### 2. Solution

Take the smooth-junction axis from the skeleton, not from the emitted handles:
when both handles descend from the same skeleton point they carry the axis they
were constructed on. And tie the ribs at both ends of a straight controlled by a
tension point to one shared offset, so the whole projected straight moves as a
unit. Tied groups merge where straights share an end point — a shared point has
one rib and cannot sit at two offsets. A "Tied ribs" opt-out is on by default, and
untying deliberately brings the rotation back in exchange for independent widths.

Everything that shows or edits a tied rib had to use the coupled value rather than
the stored one, and a rib drag pulls its whole group into the executor set.

### 3. Commits

| Commit      | Subject                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `2ad2b04b1` | fix(skeleton): take the smooth-junction handle axis from the skeleton      |
| `130a75ddf` | fix(skeleton): couple ribs across a mutually-controlled straight segment   |
| `bd572be5c` | feat(skeleton): add a Tied ribs opt-out for coupled straight segments      |
| `8c1b2ea14` | fix(skeleton): make the rib gizmo and drag agree with coupled geometry     |
| `149a6962d` | fix(skeleton): tie the whole projected straight, not just controlled pairs |
| `d4d1dcfac` | fix(skeleton): make a nudge carry its generated handles                    |

### 4. Challenges and findings

**Deriving a direction from rounded coordinates inherits a width dependence.** A
handle emitted at `round(anchor + axis × length)` carries its axis only to within
about `atan(0.7 / length)` — 1.3° at 32 units, 4° at 10, 45° at 1. So any later
stage that re-derives a direction from the emitted points is length-dependent, and
width sets the length. This is the general trap behind both faults here.

**The first coupling rule was too narrow.** Tying only _pairs_ of controlled
points missed the common case: one tension point anywhere on a straight ties the
ribs at both of its ends, and the far end does not have to be controlled itself. An
ordinary corner or a contour terminal is tied just the same, because what forces
the coupling is the controlled point, not the pair.

**Skipping the coupled accessor in the gizmo produced the original report** — the
dragged gizmo travelled twice as far as the outline and its partner did not move at
all. Coupling that only the generator knows about is worse than no coupling.

**One residual tilt was measured and deliberately left.** At a corner far end the
miter normal is the straight's normal rotated by a quarter of the turn, leaving a
second-order term of `2·hw·sin²(turn/4)` — 0.4 units at the widest end of the
sweep, under the ~0.3° the grid itself imposes on a handle that long.

---

## 5. Generated curves collapsed to minimum or maximum handle length — fix

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-27
**Spec:** dissolved into `SKELETON-FEATURE-MODEL.md` §3.2 and §8

### 1. Problem

After the construction shipped, the generated contour was "too eager to collapse
to minimum or maximum handle length".

### 2. Solution

The correction pass was solving against the wrong correspondence. It assumed the
true offset's point at a given parameter belongs at the generated curve's point at
the same parameter — false for an offset, which is stretched on the convex side and
compressed on the concave one. So the correction either did nothing or returned
_negative_ handle lengths, which the bounds then turned into the collapse.
Reparameterizing fixed it, under a hard contract inherited from the old pipeline's
failure: fixed iteration count, fixed seed, no convergence test, no threshold
search. Mean error 3.11 → 0.89 against an achievable 0.67, hard-pinning 2 → 1 of
118, arcs unchanged.

### 3. Commits

| Commit      | Subject                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `0374a884d` | docs(skeleton): record the curve-quality decisions                     |
| `8adb3bb55` | fix(skeleton): fit the offset against the right correspondence         |
| `cbd92a0a9` | docs(skeleton): withdraw the equalize/harmonize step on measurement    |
| `b8f29354e` | docs(skeleton): pin the handle axis to the skeleton, drop equalize too |
| `005a6e43c` | docs(skeleton): settle the two gizmo mechanics                         |

### 4. Challenges and findings

**A synthetic sweep produced wrong conclusions and had to be thrown away.**
Parameterizing by handle length as a fraction of chord invents skeletons nobody
would draw — a 0.55-chord handle on a 20° turn is already past tension 1. It
supported a claim that the accuracy optimum wants tension 4–5. Re-parameterized by
tension directly, over geometry a designer would actually draw, the optimum never
asks for more than 1.04. **Sweep design decided the answer here, twice.**

**The clamp was not the disease.** The instrumentation counted any touch inside a
smooth blend window, not hard pinning, which read as 34% of cases where the true
figure was 2 in 118 — and the pipeline still carried 4.6× the achievable error
where nothing clamped at all.

**Three things were then withdrawn on measurement**, and all three are recorded in
the feature model §8 so they are not re-derived: a harmonize pass (the generated
contour already reproduces the true offset's joint curvature to 1.7%, and the
mismatches that remain are the skeleton's own, faithfully reproduced —
harmonizing would erase a curvature the designer asked for); unconditional
equalization (a no-op where it is safe, a 3.3× fidelity loss where it is not); and
tilting the handle axis to the true offset tangent, which would recover almost all
of the taper defect and was rejected because the axis is skeleton-owned.

**Some geometry a single cubic simply cannot represent** — a bold stroke on a
tight curve, 31 of 149 realistic cases — with errors in the hundreds for every
strategy including a numerical optimum, and point-count stability forbidding a
split. That is the strongest argument for handing the designer a control.

---

## 6. Generated-segment gizmos, and a curvature that survives a skeleton edit — feature

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Dates:** 2026-07-27
**Spec:** dissolved into `SKELETON-FEATURE-MODEL.md` §7

### 1. Problem

Where the automatic answer cannot be right — taper, and offsets a single cubic
cannot express — the generator collapsed instead of deferring. There was no way to
say "make this segment rounder". And the first version of that control stored a
positional handle displacement, so changing the skeleton, the width or the taper
afterwards moved the base handle, left the displacement behind, and drifted the
curvature the designer had set: they set a number, the model stored a nudge.

### 2. Solution

Two gizmos per generated segment. A **curvature** gizmo on the curve, dragging
along the axis toward the tangent intersection, and an **on-curve** gizmo that
slides the segment's two ends along the outline. Nothing new is stored for the
second: it writes the same nudge the panel writes.

The curvature gizmo stores the **segment tension it arrived at** — a number.
Regeneration reproduces it whatever the skeleton has done since; where the geometry
cannot express it the output clamps and the stored value is never rewritten, so the
segment returns to exactly what was set once the skeleton comes back into range.

What makes that clean is an identity: a segment's tension is exactly the harmonic
mean of its two handles' tensions. So two handle lengths decompose into a
magnitude, which the pin owns, and a split, which per-handle adjustments own. They
are orthogonal, so the two stored things compose without a precedence rule.

### 3. Commits

| Commit      | Subject                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| `aba940073` | feat(tunni): add the curvature gizmo geometry                                    |
| `5bac71b6e` | feat(skeleton): map a curvature drag onto skeleton handle offsets                |
| `b200c00f5` | feat(skeleton): draw the two gizmos on generated segments                        |
| `9cad17298` | feat(skeleton): make the generated gizmos draggable                              |
| `408dc586b` | feat(skeleton): make gizmo editing the default, direct handles the opt-out       |
| `7008c78c1` | fix(skeleton): stop the gizmo drag throwing, and hide generated handle lines     |
| `b5ba9e25f` | fix(skeleton): unstick the curvature gizmo, respec the on-curve one              |
| `de317addc` | fix(skeleton): unblock reversed-contour gizmos, hold handles on an on-curve drag |
| `9f2a4173d` | feat(skeleton): pin generated curvature and equalize handle tensions             |
| `c4e7d9069` | fix(skeleton): make the pinned curvature control reach 1 and hold still          |
| `4914a7b0b` | fix(skeleton): stop the curvature gizmo moving the curve when it is grabbed      |

### 4. Challenges and findings

**A new per-point field is invisible to the generator until it is copied across
explicitly.** Points are flattened into a different shape before generation, and
the model's own accessors do not work on the far side of that translation. This
failed _silently_: the pin stored, read back correctly, and did nothing at all,
because the generator saw an undefined value on every segment. Any future
per-point field has the same trap.

**Reproducing a pinned mean by scaling both tensions cannot work.** A preserved
ratio caps the reachable mean at `2r/(1+r)` — 0.6 on a 0.3/0.7 split — so the
control stopped at a value that was neither 1 nor stable, and moved whenever the
geometry moved. It is also not what the drag does: the drag adds one shared
increment to both ends, and reproduction has to do the same or the number cannot
round-trip.

**Saturating both handles at the leading one's ceiling hides part of the control's
range.** When the leading handle reaches tension 1 it stays; the trailing one must
remain responsive until it reaches 1 too.

**A zero-delta grab must be exactly a no-op, and it wasn't.** The underlying math
equalizes two coupled tensions regardless of the delta, so differencing against
the incoming geometry fired that equalization the moment the gizmo was grabbed — a
152-unit jump before the pointer moved. Fixed by differencing against the same
call at zero drag.

**A pinned segment must not be bounded twice.** The pre-existing smooth ceiling
eases into its limit, so a handle exactly on the limit comes back ~3.75% short: a
pin of 1 rendered as 0.91–0.96 depending on how the on-curve gizmo had been used.
Where a pin is present it now enforces the ceiling itself and the older bound
stands down.

---

## 7. The two generated controls fought each other — fix

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Dates:** 2026-07-27 – 2026-07-28
**Plan:** dissolved into `SKELETON-FEATURE-MODEL.md` §3.2 and §7

### 1. Problem

Grabbing the curvature gizmo moved the curve; its reachable range looked
arbitrary; and dragging a generated on-curve moved the neighbouring off-curves.
All three were one fault. Three things wrote a generated handle's length — the
fit, the pin, and stored per-handle adjustments — and the nudge translated each
handle along with its rib end, so the on-curve drag had to store an equal and
opposite adjustment to hold the handle still. The moment the on-curve gizmo was
touched, that adjustment existed and overwrote the pin. It only behaved while no
on-curve had ever been touched, which was exactly the report.

Two smaller faults alongside: mirroring a skeleton produced the wrong shape,
because a mirror has negative determinant and the geometric left of the mirrored
centerline is what the stored data calls right; and with handle lines hidden in
gizmo mode, the off-curve points were circles attached to nothing.

### 2. Solution

One space for the whole handle-length pipeline. The nudge stops carrying the
handle and becomes a pure emission post-step: handles are emitted from un-nudged
geometry, on-curves carry their nudge. Net rendered geometry is identical to what
the two mechanisms produced when they worked — the difference is that there is one
mechanism instead of two that cancel, so nothing is stored to make the
cancellation happen and nothing downstream can defeat it. An on-curve drag then
_cannot_ move an off-curve, a nudge cannot push curvature past the ceiling on its
own, and the pin becomes independent of the on-curve gizmo rather than coupled to
it. Ordinary carry-the-handles semantics survive as a separately accumulated
scalar that is emitted after construction and never enters the math.

Also: the mirror side-swap, the rib reset clearing the pin it had been leaving
behind, the on-curve gizmo moved off the curve along the outward normal and
restricted to ends that can actually move, and double-click resets.

### 3. Commits

| Commit      | Subject                                                   |
| ----------- | --------------------------------------------------------- |
| `e2309c358` | docs: gizmo plan                                          |
| `7b78a3b32` | fix: preserve skeleton side semantics through gizmo edits |
| `8ba6546ec` | fix: unify generated handle construction space            |
| `465f878e1` | fix: preserve generated on-curve drag mode semantics      |
| `fc82cb9d8` | fix: stabilize generated gizmo controls                   |
| `8764a5df6` | revert: keep observable storage behavior unchanged        |
| `7ce15a04a` | feat: complete generated gizmo controls                   |

### 4. Challenges and findings

**This reversed a decision made one day earlier, and both were right in turn.**
Measuring the pin in rendered space was necessary while the nudge carried handles;
once it stopped, construction space became strictly better because it makes the
pin independent of the on-curve gizmo. The lesson recorded in the feature model is
the ordering: fix the mechanics, then choose the space, not the other way round.

**A nudge could push a rendered tension past the ceiling on an untouched
segment** — 1.18 at nudge 20, 1.48 at nudge 40 — because the length was preserved
while the reach shrank. Sliding a rib end toward its handle now reduces both, and
the ratio stays under 1 by arithmetic.

**Mirroring was verified by construction, not by eye:** generate-then-mirror and
mirror-then-generate must produce the same point set. Swapping the per-side fields
by hand on the mirrored data made the two agree exactly, which is what confirmed
the swap was the whole fix. Contour-wide side ownership can only be swapped when
the entire contour is selected, so a partial selection deliberately leaves it.

**Hiding the on-curve points along with the handle lines would have been wrong.**
On-curve points say where the outline is; off-curve points with no lines are
floating circles. Only the off-curves are hidden.

---

## 8. Second round of live use — fixes

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-28

### 1. Problem

Five reports from using the controls in earnest. Basic points, both real and
generated, rendered black as if selected. The equalize gesture fired on
button-down, so a modified drag was unreachable, and it fired on both gizmos
rather than only the one that owns the split. The D/S expansion drag sheared the
skeleton's segments instead of offsetting them, which negates the point of the
tool — and did nothing at all on a single-sided contour. There was no way to see a
segment's curvature number, or to tell a pinned segment from an automatic one.
And a segment kept reproducing a pinned curvature underneath a handle the designer
had since placed by hand.

### 2. Solution

The black points were a null index list read as "every point" by the node
iterator, and an empty selection parses to no list at all — so the selected-node
layer painted the whole path. Two iterators now, one per meaning.

D/S expansion now moves every selected on-curve the same distance along its own
normal, which makes each affected segment a constant-distance offset of itself, and
runs the generator's own construction on the skeleton to get the handle lengths.
It carries whole tied rib groups, and on a single-sided contour it moves no
skeleton at all — the centerline is one edge there, so only the half-width changes.

Equalize became a click on the curvature gizmo only, deciding after it sees
whether the pointer moves. A switchable label layer shows each segment's tension
with a dot when it is a pin, and the drag readout shows the same number whatever
the switch is set to. A direct handle drag now clears the pin on that handle's own
segment: the hand is the later and more specific answer, and has to win or the
segment fights the cursor.

### 3. Commits

| Commit      | Subject                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `6a4080a1e` | fix: stop an empty selection painting every node as selected                |
| `10515143d` | fix: make the generated equalize a click, on the curvature gizmo only       |
| `537b83eec` | fix: make the S/D drag offset the skeleton instead of shearing it           |
| `dee00f852` | feat: label the curvature gizmo, and hand generated geometry the plain drag |
| `5f2e0afdc` | docs: record the gizmo and modifier corrections                             |
| `f5f172043` | revert: keep the rib modifiers as they were                                 |
| `aa9f80b41` | fix: restore the modifiers, and make Z carry the handles from either grip   |
| `4aecabf91` | feat: let a direct handle drag discard the curvature it overrules           |
| `0f82e404f` | docs: correct the pin-override exceptions                                   |
| `36dfc70af` | refactor: drop the tension-bound instrumentation                            |

### 4. Challenges and findings

**Two modifier rearrangements were built and both were reverted the same day.**
Swapping the rib pair — plain for width, Z for the tangent slide — ignores why Z
exists: a tangential rib move is the _rarer_ intent, and a plain drag reaching for
the width is what the tool is for. Dropping Z as the gate on generated geometry
removes the safety on derived geometry. Both are now in the feature model's §8 as
closed, with the reasons, because both were arrived at twice.

**A real defect was hiding under the second attempt.** Z carried the adjacent
handles when the drag came in through the generated on-curve and not when it came
in through the rib grip — two entry points to the same nudge, sitting at the same
place on screen, and only one of them passed the carry flag. Under Z the rib grip
therefore behaved exactly like Z-Alt. The flag is now derived from the behavior
name where both callers pass through, so they cannot disagree.

**The previous round's fix for the black points was to hide all generated points**,
which is not a fix — it removes the symptom and the feature together. Withdrawn,
along with the iterator change made to support it.

**A stat that measures the wrong thing is worse than no stat.** The tension-bound
counter answered its question in generation 1 and was then read once as hard
pinning, which it never was. Removed with the script that consumed it; the ceiling
and its floor stay.

---

## 9. The plans and specs were dissolved — docs

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-28

### 1. Problem

Five design specs and implementation plans, 3,783 lines, all describing work that
had shipped. A plan that outlives its implementation is worse than no plan: it
still reads as an instruction, and a reader has no way to tell which parts are the
design of record and which were withdrawn three rounds ago.

### 2. Solution

Folded the durable content into the two docs that are actually read at the start of
a session, and deleted the rest. The feature model gained the continuity contract
that governs handle lengths, the two permanent limits (taper, and offsets a single
cubic cannot represent), a section on the generated-contour controls and the
curvature pin, and a register of everything tried and rejected on measurement. The
architecture map gained the construction module, the gizmo hit-test and mode
switch, and corrected sizes and counts.

The register is the part worth having. Eleven rows, each with the measurement or
the use that closed it — including two ideas that were built and reverted twice.

### 3. Commits

| Commit      | Subject                                                       |
| ----------- | ------------------------------------------------------------- |
| `9671505ec` | docs: dissolve the plans and specs into the two standing docs |

### 4. Challenges and findings

**The map named two editor modules that have never existed** — with line counts,
which is what made them credible. Same error as the phantom modifiers file
corrected a few days earlier, so the correction now carries a "grep before trusting
a filename here" note rather than just fixing the row.

**A code comment had been pointing at a deleted spec for several commits.** Cited
paths rot silently; the comment now states the fix it was deferring instead.

**Documents that were already unformatted were left that way.** Reformatting them
would have buried the change in noise, which is the same call made on the segment
selection fix in entry 2.

---

## 10. Placement and readout of the generated controls — fixes

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-28

### 1. Problem

Three small things, all about what sits where. The curvature label was drawn along
the gizmo's own axis, competing for space with the node and the dashed stub drawn
from the same anchor. The on-curve gizmo's distance from its curve was a screen
constant, which holds its pixel size at every zoom but grows without bound in glyph
space — zoomed out, the control sat a large fraction of the letter away from the
segment it belongs to. And the rib width plaque appeared during a Z-drag, which
slides the rib end along its tangent and changes no width at all.

### 2. Solution

The label sits straight above the node. An offset that follows the axis also swings
the number around as the segment turns, and a label the eye has to hunt for is
worse than one that occasionally crosses the stub.

The gizmo distance is one constant in glyph units. It was briefly scaled by the
local stroke half-width — defensible, since the gizmo does mark an offset from an
outline — and that read as unsettled in use, because the gap then moves with every
width edit. Both rejected rules are recorded in the feature model.

The plaque now reads the drag's behavior name, which the pointer tool publishes on
the scene model because the readouts have no route to the realtime modifier state
of their own.

### 3. Commits

| Commit      | Subject                                                                                |
| ----------- | -------------------------------------------------------------------------------------- |
| `a168b107d` | fix: place the curvature label above its gizmo, scale the on-curve gizmo by the stroke |
| `fea8aa622` | fix: put the on-curve gizmo at a constant distance from its curve                      |
| `f811b0589` | fix: hide the rib width plaque during a tangent slide                                  |

### 4. Challenges and findings

**Defensible on paper, unsettled in use.** Tying the gizmo offset to the stroke
thickness is the better-argued design and was rejected on sight of it. Worth
recording as a decision rather than a mistake — the argument will be just as
convincing next time.

**The suppression predicate had to be narrowed after it was written.** "Not one of
the two width behaviors" and "is one of the two tangent behaviors" look equivalent
and are not: a rib drag can carry a fixed-rib behavior instead, and that one does
change widths, so the broader form would have silenced a plaque that was telling
the truth.

**Publishing the behavior name where it is set** rather than at drag start is what
makes a Z pressed mid-drag take effect on the next frame instead of the next drag.

---

## 11. A pinned curvature did not survive the hand that overruled it — fix

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-28

### 1. Problem

Set a curvature with the gizmo, switch to direct handle editing, drag a handle:
the handles jumped back to where the automatic fit had put them before the
curvature was set, and the drag then continued from a position the designer never
chose. Fixed once, and the first drag after a curvature adjust still dragged heavy
and then broke loose — while every drag after it was smooth.

### 2. Solution

Two causes, one behind the other.

A direct handle drag discards the pin on its own segment, which is right — the
hand is the later and more specific answer. But the discard was destructive: the
pin contributes length to both of the segment's handles, so dropping it bare snaps
them back to the fit. The pin is now **baked** before it is dropped. One
regeneration with it cleared measures how far each handle moves, and that
difference is stored as a per-handle offset, so rendered geometry is unchanged
across the clear.

Underneath that: a pinned segment bypasses the ordinary tension ceiling, because
the pin saturates its own tensions at 1. Clearing the pin puts that ceiling back —
and it eases into its limit over a blend window, so it re-shaved exactly what the
bake had restored, and the drag spent its first units of travel inside the window.
The ceiling now comes in three forms, one per author of the length: none for a
pinned segment, exact for a handle carrying a hand-placed adjustment, eased for the
fit's own answer.

### 3. Commits

| Commit      | Subject                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `53e4d3be8` | fix: preserve the curve when a handle drag discards its pinned curvature |
| `757a27ab0` | fix: state the tension ceiling exactly for a hand-placed handle          |

### 4. Challenges and findings

**"From the correct position, but a jump."** The report distinguished a wrong
starting position from a wrong first movement, and that distinction is what
separated the two causes. The first fix was verified by a zero-delta drag, which
proves the start position and says nothing about travel — so it passed while the
second fault was still there.

**Both handles, not just the dragged one.** The pin sets the two lengths together
and only one is ever under the cursor, so baking the dragged handle alone would
have held half the segment still and moved the other half.

**The eased ceiling is right for the fit and wrong for a hand.** The fit's answer
has to be a continuous function of the skeleton; a length the designer chose has no
such obligation, and easing it lands a few percent short of what was asked for.
Measured at 5.0 units short at tension 1 — which also meant a hand-dragged handle
could never quite reach the tangent intersection. Tension 1 is still the wall; the
wall is now where the number says it is.

**Measured, not reasoned.** The residual was 0.00 units below a pin of 0.8 and grew
to 5.0 at 1.0, which is why it presented as intermittent — it depended entirely on
how far the curvature had been pushed.

---

## 12. Three faults in the fixed-rib drag — fixes

**Branch:** `fix/skeleton-expand-math` (not yet merged)
**Date:** 2026-07-28

### 1. Problem

**Single-sided drags rewrote the width distribution.** A single-sided contour
renders the sum of its two half-widths on the visible side, so the split between
them is nothing the drag should touch — but it wrote one side and left the other,
which moved the split. That split is the distribution the point returns to when
the contour goes back to double-sided, so the drag was changing a shape the
designer cannot see while they work.

**The single-sided floor was on the wrong quantity.** Flooring one side at a
half-width of one stopped the visible edge a whole far-side width away from the
skeleton — 41 units short of the centerline on a 40-unit far side.

**The drag did not stop.** Widths clamped and everything else carried on, so past
the floor the anchor edge the drag exists to pin walked away with it.

### 2. Solution

Single-sided drags write the **total**, which preserves the split by construction
and puts the floor on the width the designer can see: two units. The panel greys
the per-side numbers and the distribution while single-sided is on, rather than
hiding them, so they read as kept rather than lost.

For the floor, one allowance is computed per point — how much of the drag that
point's ribs can actually pay for — and everything that travels with the drag is
held to it: the point's own movement, both sides' widths, and the segment's
handles. Points are independent, so a narrow one cannot hold up a wide one and the
drag stands completely still only when every affected rib is at the floor. A tied
group is held to whichever member gets there first, since the group shares one
offset by definition.

### 3. Commits

| Commit      | Subject                                                              |
| ----------- | -------------------------------------------------------------------- |
| `61b35caea` | fix: three faults in the fixed-rib drag                              |
| `efe4d4b2c` | fix: stop the fixed-rib drag's handles and far side at the floor too |

### 4. Challenges and findings

**A straight-skeleton test cannot see a handle bug.** The first round of tests used
a two-point line fixture, so the handle-scaling path never ran — the fix tested
green and was still wrong in the editor, because every real skeleton has curves.
The property that actually catches it is idempotence past the floor: a drag far
past it must produce geometry identical to one exactly at it. That is now asserted
on the arc fixture.

**Three things travel with one drag, and each leaked separately.** The point's
position, the far side's width, and the handles. Fixing them one at a time meant
three rounds of "still doesn't stop"; the lesson is to enumerate what a clamp has
to cover before clamping anything.

**Linked ribs move both sides by one amount**, so with an uneven distribution the
far side reaches the floor while the anchor still has room. It was pinned at zero
there while the drag carried on compressing the anchor alone.

**My own test asserted the wrong direction twice.** Plain fixed-rib anchors the far
side, which grows; only compress anchors the side the drag moves toward, and only
that side shrinks. Nothing hits a floor without compress.

**The distribution can only be preserved to within grid rounding.** Whole-unit
sides cannot hold 60/20 at a total of 90 — it wants 67.5/22.5 and lands on 68/22,
about 1% of distribution. Chasing that would need fractional widths. Rounding both
sides independently, which is what the shared total-width mutator did, also missed
the total itself by a unit and put the visible edge past the cursor; one side is
now rounded and the other taken as the remainder.

---

## 13. The rib angle lock was never ported — feature

**Branch:** `fix/skeleton-expand-math`
**Date:** 2026-07-29

### 1. Problem

The donor could force a terminal rib onto an axis, so an open contour's end reads
flat and horizontal or flat and vertical however the centerline arrives at it.
The port carried the geometry — `getEffectiveNormal` existed in both the generator
and the model — but nothing else: no canonical field, no copy across
`canonicalToGeneratorInput`, no panel control. Both copies read
`point.forceHorizontal` / `point.forceVertical`, fields the schema drops on
normalization, so the override could not fire at all.

Exactly the trap the feature model §7 names: a per-point field is invisible to the
generator until it is copied across explicitly.

### 2. Solution

One canonical field, `ribAngleLock` ∈ `null | "horizontal" | "vertical"`, named for
the direction the **rib** runs — which is what the designer sees, since a flat
terminal is drawn along the rib. Normalized in `normalizeSkeletonPoint`, written by
`setSkeletonPointRibAngleLock`, copied into the generator dialect flat, and moved
with the cap data when a terminal is deleted, since it describes that terminal.

`getEffectiveNormal` is now one exported copy in `skeleton-model.js` that the
generator imports (rail R-B); it previously existed twice, and both copies read the
dead donor field names.

The panel exposes it as a select in the cap section, gated to open-contour
endpoints like the cap style is. Unlike the donor, where it was only offered on the
flat cap, it is offered under **every** cap style: it decides the rib the cap is
built on, so it supersedes the style rather than belonging to one.

### 3. Commits

Single commit on `fix/skeleton-expand-math`.

### 4. Challenges and findings

**Two dead code paths looked like a working feature.** Grepping for the donor's
field names found the math in place in two files and made the port look half-done
when in fact none of it could ever run. The check that matters is whether the field
survives `normalizeSkeletonPoint` and `canonicalToGeneratorInput`, not whether the
consumer exists.

**Round and drop caps put points past the rib**, so the "every cap style" test can
only assert the rib line itself on the flat-ended styles; for the others it asserts
that the lock changes the outline at all.

---

## 14. One generated handle always on a bound — fix

**Branch:** `fix/skeleton-expand-math`
**Date:** 2026-07-29

### 1. Problem

A glyph with two skeleton contours, identical but for the tension of one curved
segment's own handles — same endpoints, same tangents, same 40 → 114 taper, and
both equal-tension to three decimals within themselves. One generated a sound
outline; the other's inner edge cut straight across the bend, with its handle on
the 1-unit floor.

The collapse was the visible half. Both contours had the same fault: **one
generated handle on a bound in every case** — the tension ceiling or the
collapse floor — from a skeleton whose own two handles were symmetric.

| side        | tensions before | ratio | after         | ratio |
| ----------- | --------------- | ----- | ------------- | ----- |
| low, outer  | 0.403 / 0.993   | 2.46  | 0.447 / 0.740 | 1.66  |
| low, inner  | 0.30 / 0.009    | 33.0  | 0.610 / 0.592 | 1.03  |
| high, outer | 0.60 / 0.97     | 1.62  | 0.626 / 0.889 | 1.42  |
| high, inner | 1.00 / 0.345    | 2.90  | 1.000 / 0.638 | 1.57  |

### 2. Solution

The asymmetry is born in the seed: λ = 1 + d·κ is applied per end, and the two
ends of a cubic have different curvature, so the two handles are scaled by
different factors — 1.07 and 2.61 here. The band then confines each handle to a
window around **its own** seed, so neither can migrate toward the other; the
bound clamps whichever ended up over its reach; and the equalization stage, the
one thing that could have rebalanced the pair, could not:

- its allowance was an absolute 0.25 units, which is room on a constant-width
  segment and nothing on a tapered one — and tapered is exactly where the fit
  comes out lopsided;
- it judged every candidate split at the fitted magnitude, so a re-split curve
  was charged for a scale nobody would pair it with.

Both were fixed in that stage. The allowance is now a quarter of the fit's own
deviation plus the flat quarter unit, and each candidate is measured at its own
best magnitude, re-solved in closed form by `solveHandleScale` — the same normal
equations as the two-handle fit collapsed onto one unknown. It is exactly inert
on the fitted pair, so segments the fit already got right do not move.

### 3. Commits

Single commit on `fix/skeleton-expand-math`.

### 4. Challenges and findings

**Three wrong diagnoses came before the right one, and each was disproved by a
measurement.** That the offset was geometrically unrepresentable past the cusp —
disproved by rendering the balanced pair, which produces the waist. That the
least-squares was ill-conditioned and sliding along a flat direction — disproved
by the normal matrix, condition number 1.3. That the fit had no information at
the dead end — true of that one end and irrelevant, since the fault was present
on the _healthy_ contour too. The report that settled it was the user's: both
contours show it, so stop explaining the collapsed one.

**A sweep is the test this class of bug needs.** Hold the segment fixed and walk
its own tension: the generated handle stepped 1, 1, 1, 2, 5, 7, 11, 17, 34 while
its partner went 104, 70, 163 — a 33.9-unit jump per unit of skeleton handle,
sitting in the middle of the healthy range where nothing about the skeleton
jumps. Monotone now, worst step 5.4. No single-configuration assertion would
have caught either fault.

**Cost, measured per segment against the true offset:** of the four generated
segments that moved across the fixture set, three improved (7.47 → 6.96,
13.00 → 12.84, 12.90 → 12.73) and one lost 0.28 units (0.79 → 1.07). That last
is the allowance being spent, and it is the trade the change exists to make.
Every accuracy ceiling in the suite still holds unchanged.

---

## 15. A saturated handle dragged its partner backwards — fix

**Branch:** `fix/skeleton-expand-math`
**Date:** 2026-07-29

### 1. Problem

Follow-up to §14, reported against it. With the collapse gone, one artifact
remained: sweeping a skeleton segment's own tension, at the step where one
generated handle reached the tension ceiling, **the other handle moved backwards**
— 90.6 → 59.4 in one step, then back up through 70.4, 91.4, 110.4. Reaching the
ceiling is normal in that configuration; the partner reversing is not.

### 2. Solution

The ceiling was applied _after_ the equalization walk. So the walk balanced a pair
that could never be emitted, and sized the free handle against a partner that was
about to be truncated. It now measures every candidate through the same bound the
emitted geometry gets, so it optimizes the curve that will actually be drawn.

Bounding inside the walk also raises the baseline the allowance is a fraction of,
which loosened the walk by a side effect — the `controlled-straight` fixtures lost
2.9 units. The ratio came down from 25% to 15% to pay that back: 1.7 units on
those fixtures, and every side of the reported glyph still inside the balance the
§14 tests assert.

Backtracking over a 240-step tension sweep, worst step: double-sided 8.1 → 1.2,
single-sided inside 10.9 → 0.2, single-sided outside 9.5 → 2.5. What is left is
about 1% of a handle and comes from the allowance itself moving with the driver.

### 3. Commits

Single commit on `fix/skeleton-expand-math`.

### 4. Challenges and findings

**The first version of the test only swept one side and passed while two faults
were still live.** Sweeping the other side of the same configuration found both.
When a fault is a property of a sweep, sweep every side and both signs of the
offset.

**A bounded measurement changes the baseline, not just the answer.** Judging
candidates by the emitted curve was correct and silently made the allowance more
generous, because the allowance is a fraction of that same measurement. Two golden
fixtures caught it; without them the accuracy loss would have shipped as
"rebalancing".

### 5. Still open

Two faults in single-sided mode, found while investigating and **not fixed here**:

- **The collapse survives at low tension on the inside.** With the full width on
  one side (−80/−228 on the reported segment) the fit's own answer collapses —
  analytic start 71.4 → corrected 19.9, end on the cusp floor — and the walk
  normalizes candidates to the fitted magnitude, so it inherits the collapse and
  emits (4.5, 2.1) against reaches of 100.7/49.6. It also jumps: at one step
  further the fit flips to asking for tension 3.0 and the pair becomes (216, 33).
- **The outside side is the least balanced case anywhere**, 0.43/0.85 on the
  reported glyph, because doubling the offset distance drives λ per end further
  apart (1.14 against 4.2) and full equalization there genuinely costs 24.8 → 54.9.

---

## 16. The offset construction was rebuilt around one invariant — rework

**Branch:** `fix/skeleton-tension-overflow`
**Date:** 2026-07-29
**Design of record:** `SKELETON-FEATURE-MODEL.md` §3.2 (the feasible box), §7, §8

### 1. Problem

The two faults §15 left open, reported from use on a `U`: two straights joined by
one curved segment, both joints straight-controlled, the contour single-sided so
the whole width lands on the inside of the bend. Sweeping the curved segment's
own tension in **one** direction, the generated handles jumped and rebounded —
±20 units per step while the skeleton handle moved 1.7.

The wider complaint was structural, and it is the one this entry answers. Each
fix since the construction shipped had added a guard: a correction band, a chord
cap, a handle floor, a cusp floor on λ, a tension ceiling in an eased form and an
exact form and an exemption for pins, a scale band on the magnitude re-solve, a
rule that a candidate split must be judged as it will be emitted, and a null
return meaning "this end has no reach, skip the stage". Every one of them was a
correct answer to a real measurement. Together they were a list of exceptions
that was still incomplete, because none of them addressed why an infeasible
answer was being produced in the first place.

### 2. Solution

One invariant, stated once and held everywhere: **both handle lengths are carried
as tensions, and every stage produces a point inside the feasible box** —
`[1/reach, 1]` on each axis, where tension 1 is the tangent-ray intersection and
the lower face is the one-unit grid floor.

`reach` gets a single definition — the tangent-ray distance, floored at a third
of the chord and capped at twice it — used by the seed, the correction, the
equalization walk, the hand adjustment, the pin and the emitted length alike.
Because it is finite and positive by construction, a tension always exists.

The pipeline is then five stages on a compact box, in order: seed (λ = 1 + d·κ),
correction (four fixed least-squares passes), split (the bounded equalization
walk), attached adjustment, pin. Every one of the guards above is either the box
or a consequence of it, and all of them are gone from the source. `handleTensions`
went with them — its whole purpose was the null return.

### 3. Commits

Single commit on `fix/skeleton-tension-overflow`.

### 4. Challenges and findings

**The jitter was the correction loop reparameterizing against a curve that
loops.** Where a cubic cannot represent the offset — and on the reported segment
it cannot, the fit's own deviation running to ~90 units — the least squares asks
for a start handle at 2.4× its reach and a **negative** end handle. The band
clamped the negative one and left the other free, so the loop's iterate was
self-intersecting, and Newton's root find on a self-intersecting curve is
multivalued: one sample's parameter walked 0.907 → 0.200 → 0.319 → 0.635 across
the four passes, and a one-unit move of the skeleton sent it down a different
branch. That magnitude then reached the outline through the equalization walk,
which normalizes candidates to the fit's own magnitude.

**A fixed trip count buys determinism, not continuity.** This is the correction
to the contract as it was written down after entry §3. Fixed count, fixed seed,
no convergence test and no threshold search were all satisfied here, and the
output still jumped, because the map being iterated was not continuous in its
input. The box is what makes the iterated map well-behaved; the trip count only
stops the loop from _deciding_ when to stop. Both are required and neither
implies the other.

**The eased ceiling was the root of the three-variant bound.** It was introduced
so the fit's answer would be C1, but the contract only asks for continuity, and a
clamp is continuous and 1-Lipschitz. Easing cost a few percent of whatever it was
given — which is wrong for a hand-placed length, hence the exact variant, and
wrong for a pin, hence the exemption. One exact ceiling collapses three cases
into one.

**Measured, on every cubic side the fixture set and the reported glyph generate
(33 sides, 13 moved by more than half a unit):** 8 improved against the true
offset, 5 lost, net −1.10 units of deviation, worst single loss 0.68. One side of
`open-smooth-cubic-junction` had a handle sitting on the 1-unit collapse floor at
52.8/1.1 and now comes out 62.1/20.8 — the §14 fault, still live on a fixture
after §14 shipped. Three of eleven golden fixtures moved and were regenerated.

**Worst single-step movement of any generated point, sweeping the reported glyph
in every mode** (200 steps; driver step in brackets):

| driver          | mode               | before | after |
| --------------- | ------------------ | ------ | ----- |
| segment tension | single-sided right | 36.67  | 2.15  |
| segment tension | single-sided left  | 196.00 | 4.12  |
| segment tension | double-sided       | 122.00 | 15.00 |
| segment tension | pinned curvature   | 1.85   | 1.85  |
| rib width       | single-sided right | 53.01  | 16.03 |
| rib width       | double-sided       | 35.00  | 10.43 |
| rib width       | pinned curvature   | 69.01  | 20.02 |
| on-curve drag   | single-sided right | 14.35  | 2.00  |
| on-curve drag   | double-sided       | 11.25  | 12.69 |
| on-curve drag   | pinned curvature   | 300.00 | 2.00  |

**A sweep harness that starts at a degenerate configuration lies.** The first
run of that table drove the segment's tension from zero-length skeleton handles
and reported 765- and 625-unit steps in both the old and new code — all of it the
first step out of the degenerate seed. Re-run from 30% of the drawn handle, the
same sweep tells the story above. This is the same lesson as §5's synthetic
sweep: sweep design decides the answer.

**What is left is the cusp, and it is not jitter.** The residual 16 and 10-unit
steps under a width drag land where `1 + d·κ` crosses zero — the offset genuinely
cusps there and the handle genuinely collapses. Both are ~3.3× better than
before, and chasing them further means representing a cusp with one cubic, which
is the limit the curvature gizmo exists for.

---

## 17. The equalization walk was bisecting a plateau — fix

**Branch:** `fix/skeleton-tension-overflow`
**Date:** 2026-07-29
**Design of record:** `SKELETON-FEATURE-MODEL.md` §7 (equalization of the split)

### 1. Problem

Reported against §16. On the same glyph, converting the contour to single-sided
was quiet, and converting it **back** to double-sided brought the jumps back —
11 units of generated handle per 1.7 units of skeleton.

The toggle was innocent: `setSkeletonContourSingleSided` writes one flag and
nothing else, and a single → double → single round trip was verified
byte-identical. Double-sided simply still jittered on its own, and §16's own
measurements had said so — 15.00 in the mode table, reported and not chased.

### 2. Solution

The fault was the metric the equalization walk bisects on. `offsetDeviation`
returned the **max** over its five samples, and a max is exactly flat in
whichever handle does not own the current worst sample. So the walk was
bisecting a plateau and converging on its **edge** — the amount at which the max
changes owner, which is a kink whose position slides fast when the two branches
run close.

It now returns an RMS. That has a nonzero gradient in both handles everywhere,
and it is the norm the fit itself minimizes, so the walk judges candidates by the
same measure that produced the one it started from.

### 3. Commits

Single commit on `fix/skeleton-tension-overflow`.

### 4. Challenges and findings

**A bisection is only as continuous as the function under it.** This is the
sharper form of the contract, and §16's version of it was not sharp enough.
Fixed trip count, fixed seed, no convergence test and no threshold search were
all satisfied — and the search was still over a plateau, which makes the answer a
step function of where the plateau's edge happens to be. Measured: the end
tension moved 0.097 → 0.353, more than tripling one handle, without shifting the
max in the fourth decimal; `affordable` then stepped 0.984 → 0.906 → 0.813 →
0.750 → 0.688 on a smoothly moving input.

**The allowance floor is not a free parameter — it is stated in a norm.** An RMS
over five samples is between 0.447× and 1× the max over the same five, so the
0.25-unit floor restates into 0.11–0.25. At 0.25 one accuracy ceiling failed
(1.043 against 1); 0.20 holds every ceiling **and** gives the lowest jitter of
the values tried. Values below it were both looser on accuracy and slightly worse
on jitter, which is the sign that this is a real optimum rather than a fudge.

**The regression test was watched failing against the metric it replaced**, on
the inner side only — the outer side of the same contour passed throughout. Same
lesson as §15: when a fault is a property of a sweep, sweep every side.

**Worst single-step movement, sweeping the glyph in every mode** — original,
after §16, after this:

| driver          | mode               | orig   | §16   | now   |
| --------------- | ------------------ | ------ | ----- | ----- |
| segment tension | single-sided right | 36.67  | 2.15  | 2.15  |
| segment tension | single-sided left  | 196.00 | 4.12  | 3.13  |
| segment tension | double-sided       | 122.00 | 15.00 | 5.00  |
| rib width       | single-sided right | 53.01  | 16.03 | 8.00  |
| rib width       | double-sided       | 35.00  | 10.43 | 6.00  |
| rib width       | pinned curvature   | 69.01  | 20.02 | 11.05 |
| on-curve drag   | single-sided right | 14.35  | 2.00  | 2.00  |
| on-curve drag   | double-sided       | 11.25  | 12.69 | 5.67  |

The one row §16 made worse (on-curve drag, double-sided) is fixed by the same
change. Accuracy across the fixture corpus improved again: of 16 sides that
moved, 8 better and 8 worse, net −1.84 units against the true offset, worst
single loss 0.68.

**One self-inflicted detour worth recording.** A `git checkout` of the source
file, run to strip debug instrumentation, silently discarded the uncommitted fix
along with it — the file was clean of instrumentation and also clean of the work.
Check what a revert actually reverted when the fix is not yet committed.

---

## 18. Cubic outline construction became one continuous solve — rework

**Branch:** `fix/skeleton-continuous-outline-solver`
**Date:** 2026-07-29
**Design of record:** `SKELETON-FEATURE-MODEL.md` §3.2, §5, §7, §8

### 1. Problem

The boxed five-stage construction from §§16–17 was deterministic and still not
continuous. Its fixed correction loop rematched samples to the candidate cubic,
and its split walk selected the last candidate inside an error allowance. Both
operations could change branch while the skeleton moved smoothly.

On the fixed U¹ tension sweep, the old automatic path passed single-sided right
but failed the other generated sides: single-sided left reached a 3.139117-unit
step/backtrack, double-sided outer backtracked 1.43315 units, and double-sided
inner reached a 4.77523-unit step with 2.07709 units of backtracking. The last
two fixes had reduced the visible failures without removing the decision
structure that caused them.

### 2. Solution

`natural-handle-solver.js` now builds one quadratic from five fixed
source-parameter offset samples. It minimizes perpendicular error in normalized
tension space together with a pull toward the skeleton's own tension, inside the
positive non-crossing rectangle. The pull ratio reads only the skeleton and
widths; its absolute weight uses a positive unprojected frame-influence scale.
The exact answer is the best interior, edge, or corner point on that one
strictly convex objective.

`offset-cubic.js` is now only the authored orchestrator: natural answer,
attached grid adjustment, pinned harmonic-mean tension, detached absolute
handle. The correction/refit loop, split bisection, candidate magnitude
re-solve, and their tests were removed. Generator ownership of ribs, axes,
collapsed sides, topology, provenance, nudges, caps, corners, and grid emission
did not move.

The calibrated global constants are:

| constant   | value |
| ---------- | ----: |
| pull floor | 0.001 |
| cusp gain  | 0.005 |
| taper gain |     1 |
| cusp gate  |  0.05 |

Every tuple tried before the first pass used `floor=0.001` and
`cuspGain=0.005`:

| taper gain | cusp gates tried            | first failure                                                                 |
| ---------: | --------------------------- | ----------------------------------------------------------------------------- |
|       0.05 | 0.05, 0.075, 0.1, 0.15, 0.2 | single-sided right backtrack 1.314095 at every gate                           |
|        0.1 | 0.05, 0.075, 0.1, 0.15, 0.2 | single-sided right backtrack 0.746824 at every gate                           |
|        0.2 | 0.05, 0.075, 0.1, 0.15, 0.2 | single-sided right backtrack 0.198037 at every gate                           |
|        0.5 | 0.05, 0.075, 0.1, 0.15, 0.2 | double-sided outer backtrack 0.110314, 0.110314, 0.110314, 0.110314, 0.110313 |
|          1 | 0.05                        | PASS                                                                          |

This is the lexicographically first passing tuple; no glyph, side, or fixture
has its own constants.

### 3. Measurements

Final U¹ sweep results, all with zero backtracking:

| generated side     | worst adjacent step |
| ------------------ | ------------------: |
| single-sided right |            2.174284 |
| single-sided left  |            2.250511 |
| double-sided outer |            2.477796 |
| double-sided inner |            2.703904 |

The additional taper sweeps measured 0.710573 left and 0.484189 right. The
near-cusp normalized tension split peaked at 1.0000000000000078, below the
3-to-1 ceiling.

Independent true-offset deviation before and after routing production:

| case                  |    before |     after |      delta |
| --------------------- | --------: | --------: | ---------: |
| circular outward      |  0.029513 |  0.029534 |  +0.000021 |
| circular inward       |  0.047331 |  0.047254 |  -0.000077 |
| S-curve left          |  1.999582 |  2.405062 |  +0.405481 |
| S-curve right         |  1.999582 |  2.405062 |  +0.405481 |
| tight inward turn     |  0.687162 |  0.523590 |  -0.163571 |
| shallow wide offset   |  0.353324 |  0.191762 |  -0.161561 |
| unequal handles       |  0.920123 |  0.331487 |  -0.588636 |
| moderate taper, left  |  3.460796 |  7.062596 |  +3.601801 |
| moderate taper, right |  8.734695 |  8.794356 |  +0.059661 |
| strong taper, left    |  9.801322 | 24.071712 | +14.270390 |
| strong taper, right   | 46.403016 | 46.403016 |   0.000000 |

Four cases improved, six lost, and one was unchanged; the summed change in the
eleven maximum deviations is +17.828989, with the strong left taper the worst
single loss at +14.270390. The seven inherited constant-width ceilings all
remain green. Taper intentionally has no implementation-derived ceiling: its
skeleton-owned handle axes cannot reproduce the true tapered-offset tangents,
and the stronger pull is what removes backtracking. The ledger makes that
stability/accuracy trade explicit rather than hiding it in regenerated fixtures.

### 4. Commits

Implementation and evidence, oldest first:

- `5a82b84b3` — reproduce the U¹ failure;
- `03005198b`, `99ad000c6` — fixed quadratic fit and handle domain;
- `8af4bec45` — skeleton-tension reference pull;
- `669a280b0` — calibrated accuracy, perturbation, U¹, taper, and cusp suites;
- `88837b1ae` — production routing and authored ordering;
- `e423466ac` — generator/provenance/interpolation invariants;
- `04d6e14dd` — reviewed natural-outline fixtures.

The predictor redesign and review corrections are recorded in `b4f759bf8`,
`6b2344863`, `03e62bc62`, and `ed7ae10ed`.

### 5. Verification and fixture review

- `natural-handle-solver`: 42 passing.
- `offset-cubic`: 27 passing.
- architecture suite excluding golden masters: 1,612 passing.
- full `fontra-core`: 1,624 passing.
- `npm.cmd run bundle`: passed; only the repository's existing asset and
  entrypoint size warnings remain.

Five cubic fixtures changed: `open-cubic-round-cap`,
`open-cubic-butt-cap`, `open-smooth-cubic-junction`,
`mutually-controlled-straight`, and `one-ended-controlled-straight`. The audit
found zero structural changes: canonical inputs, contour counts, point counts,
point types, line fixtures, and non-round on-curves are unchanged. The round-cap
fixture also moves its existing derived trim on-curves and cap controls because
that cap is split from the terminal side cubic; its topology and provenance
ownership remain unchanged.

### 6. Challenges and findings

**A cusp-only predictor could not satisfy both accuracy and continuity.** The
reported U¹ taper remains healthy by the cusp factor, so it needed a separate
input-only taper signal.

**One shared cusp/taper strength also could not pass.** Enough shared authority
to stabilize the tapered side made the inward near-cusp transition too steep.
Independent global gains preserve one deterministic model without coupling the
two failure modes.

**The first fixture-review rule was too strict for split-outline round caps.**
Those caps intentionally compute trim points and tangents from the terminal side
cubic. Changing the cubic must move those derived on-curves and cap controls.
The correct preservation boundary is their topology, provenance, and cap inputs,
not frozen derived coordinates.

---

## 19. Stabilized reach was mistaken for the geometric ceiling — fix

**Branch:** `fix/skeleton-continuous-outline-solver`
**Date:** 2026-07-30
**Design of record:** `2026-07-30-true-geometric-handle-ceiling-design.md`

### 1. Problem

The handle domain used one number for two jobs: a stable scale for normalized
tension and the maximum non-crossing length. A short positive tangent reach was
floored to a third of the chord, so a solver answer at tension 1 could be almost
twice the real reach. The refreshed `c.json` exposed left-side individual
tensions of `1.002/1.993` and `0.837/1.473`; their harmonic segment tensions
were `1.334` and `1.068`.

The label reader separately called `calculateSegmentTension` with its first
on-curve and control point reversed. It displayed `3.968`, `1.389`, `2.291`, and
`1.266` for four segments whose correctly ordered means were `1.334`, `0.820`,
`1.068`, and `0.775`.

### 2. Solution

`buildHandleDomain` keeps the floored/capped reach as the quadratic's stable
coordinate scale. For a real positive forward reach below that scale, its
per-end maximum becomes `realReach / scaleReach`; multiplying the two lands
exactly on the true intersection. The minimum is capped by the maximum, so
non-crossing wins if a real reach is shorter than the ordinary one-unit floor.
Parallel and behind intersections retain the chord-cap fallback because they
have no forward crossing ceiling.

`getGeneratedSegmentCurvature` now passes
`control1, onCurve1, control2, onCurve2` to the canonical tension calculation.
It neither clamps nor hides the result.

### 3. Result

Regenerating both supplied configurations gives harmonic segment tensions
`0.9995`, `0.8198`, `0.9817`, and `0.7752`. The only individual values still
fractionally above 1 are `1.0024` and `1.0044`, both caused by final integer-grid
emission at the boundary; grid rounding was deliberately left unchanged.

Two straight-controlled golden fixtures moved only their four affected handle
coordinates. Focused regression coverage includes the reported short-forward
geometry, a real reach below one unit, canonical label argument order, and the
existing solver/generator architecture suites.

---

## 20. The serif cap style — feature

**Branch:** `feature/skeleton-serif-generator`
**Dates:** 2026-07-30 – 2026-08-02
**Spec / plan:** `specs/2026-07-30-serif-generator-design.md`,
`plans/2026-07-30-serif-generator.md`, `serif-lab.html` (the mockup they were
written against). Durable content is now feature model §8.

### 1. Problem

Open ends could close four ways — butt, round, square, drop — all of which just
cap the two side ends. None of them can draw a serif, which is not a cap over the
stroke's end but a terminal that **consumes** some of the stroke and replaces it
with its own shape: two wings, a bracketed transition into each, and one
underside curve across the foot.

### 2. Solution

A fifth cap style, `serif`, mutually exclusive with the rest and offered only on
open-contour endpoints.

The terminal's shape is a new pure core module, `serif-geometry.js` (268 lines):
a frame with the origin on the skeleton endpoint, `u` along the serif axis and
`v` into the stroke, then `buildHalfSerif` and `buildSerifTerminal` on top of it.
That module has never heard of a stroke, a rib or a contour. Everything about
attaching the shape to a stroke — trimming each side, bringing the loose end to
the terminal, splicing — is `buildSerifCap` in the generator.

Two independent halves of seven fields each (`wingLength`, `tipThickness`,
`wingSlope`, `tipCutAngle`, `reach`, `tension`, `concavity`) with a `linked` flag,
plus four terminal-level values (`axisMode`, `axisAngle`, `undersideCup`,
`straightDepth`). Null means inherit, so contour and source defaults stay live
consumers the way stroke width does.

The axis is its own property with four modes and composes with `ribAngleLock`
rather than replacing it; it is held at least 15° off the tangent. A source-level
`serifUnitsMode` scales the four distance fields by stroke width when set to
`normalized`. Panel controls live in the skeleton parameters sidebar.

### 3. Commits

`ecd436f1d` schema and cap style; `3d0782dac` mirroring; `eda8270b6` source-level
units mode and the collapsed-point switch; `e767c2a93` the frame; `f4928aafb` the
half; `461954d6f` terminal assembly; `9563fe0c1` trimming and splicing;
`773d53273` reach clamping; `250084ed4` normalized units; `d853f85f3` opt-in
collapsed-point removal; `5d89ddb31` stability sweeps and fixtures;
`52ce5c9e7` panel controls.

### 4. Challenges and findings

**Point-count stability is harder for a terminal than for a cap.** Seven
on-curves per terminal at _every_ parameter value, including a wingless half,
zero thickness and zero cup. The straight run's top is not one of them — it is
where the trimmed edge already ends — and at `straightDepth === 0` the run has no
length and its two ends coincide, which is a zero-length segment rather than a
missing point. Tested directly rather than inferred.

**A half with no wing must add nothing.** Two separate leaks: the shared straight
run still pushed a spur out of the disabled side, and since the run is straight
while the edge it leaves is not, that spur landed _outside_ the stroke; and the
hollow still bent toward a corner that had collapsed onto the tip, dimpling the
foot line by half a unit.

**The underside is one curve across the whole terminal, not one per half**, and
its centre sits on the skeleton rather than midway between the two tips. The axis
modes routinely produce unequal halves, and a midpoint-anchored centre drags the
contact geometry off the alignment zone as the axis rotates.

---

## 21. The serif under live use — fixes

**Branch:** `feature/skeleton-serif-generator`
**Date:** 2026-07-30

### 1. Problem

Six rounds of reports from drawing with it. Two were shape, four were the panel.

- `tension` and `concavity` did not emit sensible off-curves. Both defaulted to
  zero, and a fresh serif drew a flat bevel.
- Arrow keys in a numeric field moved the value once and then lost focus.
- Each length wanted a relative scale slider beside it, like stroke width has.
- The tip-cut, tension and concavity sliders did not update live, and got stuck
  on the value they had when the point was selected.
- The scale sliders held their thumb position after a drag instead of returning
  to neutral, so the next drag re-applied the old factor.
- The release point drew as a square, not a dot.

### 2. Solution

**Shape.** `tension` and `concavity` were multiplying: the off-chord component of
both handles was `tension · concavity · (corner − mid)`, so either at zero
cancelled the other. They are now two independent readings of one construction —
both transition handles lie on the line from their own end toward the wing's
inner corner; concavity is the handle length as a fraction of the distance to
that corner, tension is the balance between the two, bounded so neither can
vanish. Aiming both at the corner is also what makes the tangents unconditional.
Defaults moved to tension 0.5, concavity 1, so a fresh serif reads as a serif.

`wingSlope` and `reach` were reported as indistinguishable and are not: slope
raises the wing's inner corner above the tip, reach is the run of stroke edge
above that corner before the transition starts.

**Panel.** Every field change rebuilt the whole form through
`setFieldDescriptions`, which clears `innerHTML` — so the edit destroyed the
input it came from. The panel now compares a layout signature and writes values
in place when only values changed, skipping whichever field the user is in. The
serif sliders were missing from the streaming branch entirely, so they only
committed on release; they stream now, with the scale sliders deliberately
excluded because they multiply what is stored and streaming would compound the
factor once per frame. Scale sliders carry `resetAfterEdit`, which the width
scale slider needed too.

### 3. Commits

`76229419c` tension/concavity; `d15ac81b8` focus, streaming and scale sliders;
`67a9a6fa5` scale sliders return to neutral; `9b84e6cac` the release's smooth
flag.

### 4. Challenges and findings

**The transition was not actually tangent, at any ordinary setting** — 10–37° off,
and exactly tangent only where an unrelated clamp happened to pin it. Nobody
reported that; it was found while checking a report that the release _point_
should be smooth. The corner-aimed construction fixes both, and the `smooth` flag
was separately never being set.

**A depth clamp is the wrong tool for a degenerate half.** Killing the half-unit
baseline dimple that way broke ordinary serif shapes, because it bit at concavity
0.5–1 with no wing slope. The narrow fix — no hollow when there is no wing — is
the correct one.

**`7055e87cd` in this range was reverted by entry 22.** It made the terminal read
its release off the cut it made in the edge, which fixes a real step on a curved
approach and introduces a worse problem. Recorded in feature model §9 so it is
not re-derived.

---

## 22. Three faults the serif exposed in shared code — fixes

**Branch:** `feature/skeleton-serif-generator`
**Date:** 2026-08-02

### 1. Problem

All three were reported as serif bugs. None of them was.

The serif is more sensitive to the rest of the pipeline than any previous cap,
because it _derives_ geometry from the trimmed stroke edge rather than closing an
endpoint — so it leans on shared code that nothing else was leaning on hard
enough to notice.

1. Dragging the curvature gizmo moved the serif's release and the bottom of its
   straight run along the stroke. A curvature pin is supposed to change handle
   tension and nothing else.
2. Grabbing the curvature gizmo on a segment with no pin yet jumped the shape,
   then dragged smoothly, and jumped again after every reset back to generated.
3. An S/D (fixed-rib) drag turned the panel's per-side widths, total and
   distribution to mixed, differently depending on drag direction — and kept
   doing it after the serif was switched off and its values cleared.

### 2. Solution

**1 — the terminal is fixed in its own frame.** The release and the straight
run's bottom are back to being functions of the serif's own numbers, on the flank
line. The cut in the edge now only decides how much curve to keep;
`anchorTerminalSplit` pulls the loose end onto the release and turns the
surviving handle onto the frame's depth axis, so the join stays smooth and the
pin has nothing left to move but handle lengths.

**2 — the gizmo reads the segment its pin governs.** A trim makes the emitted
segment shorter than the one the generator solved, so the number read and the
number written described different curves. `splitTerminalSideForRoundCap` now
publishes the uncut segment on the inserted point's provenance as
`constructionSegment`, and `generatedSegmentConstructionPoints` resolves it for
every reader — the drag, the label and equalize.

**3 — a drag does not consult the panel's link flag.** `applyFixedRibDelta` took
its width out of the anchor side alone when `width.linked` was false and out of
both sides when it was true. Both sides now always move, and the flag is put back
afterwards instead of being overwritten by the write that moved them.

### 3. Result

Measured on `_external/g.json`.

| Fault | Before                                                                    | After                                         |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------- |
| 1     | release and straight-run bottom travel 25.7 and 22.4 units over the range | total on-curve travel 0.000000 over 400 steps |
| 1     | join at the release opened as the pin moved                               | 0.0000° at every pin value                    |
| 2     | gizmo reads 0.7487 for a stroke whose own value is 0.8725                 | reads 0.8725, same as the serif switched off  |
| 2     | setting the number it displayed moved the handles 9.0 and 7.8 units       | moves nothing                                 |
| 3     | three points at 20/20, middle one unlinked: 30/20 against 30/30, mirrored | all three 30/30, both drag directions         |

Full suite 1690 passing throughout. Fault 3's fix changed no test, which is a
decent sign the linked path was the intended semantics all along.

### 4. Challenges and findings

**Fault 1 has a cost, and it is stated rather than hidden.** Where the stroke wall
has curved off the flank by the height the serif grabs at, the wall is now bent
back to meet the terminal — 2.6 units on that G as drawn, up to ~32 at the very
bottom of the curvature range, where the wall is a chord nowhere near the flank.
The lever for that is the serif's reach, not the pin.

**Fault 2 was present on round caps too, at 0.0002.** They trim a sliver; the
serif trims 83 units. Same defect, four orders of magnitude apart, which is why
it had survived this long.

**Faults chased in the wrong order.** Before fault 2 was found, the same report
was attributed twice to smaller defects that are real but were not causing it: a
half-unit tolerance in the split bisection, and integer grid snapping on the edge
handles the trim solves against. Both were measured — the release moved in steps
up to 0.91 units that reversed direction at every grid snap — and neither was
what was being reported. The lesson, now in memory: take a reported symptom
literally instead of matching it to the nearest defect already in hand.

**One finding left alone deliberately.** `shiftTensionsToMean` treats a pin of
exactly 0 as "no pin", so the shape falls back to the natural solve there while
the smallest positive value snaps to nearly-collapsed handles — tens of units of
jump at the very bottom of the gizmo's range. Verified identical with the serif
switched off. It is in the code path of every curvature pin in the app, so it was
reported rather than fixed as a side effect of serif work. Arch map §7 residue #4.

### 5. Commits

`f9338db5a` the pin moves handles only; `a476b73e4` the gizmo reads its own
segment; `f64138557` S/D drags ignore the link flag.
