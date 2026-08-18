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

### 6. Serif model rework

Replaced the corner-aimed bracket with the single-attractor construction so reach and wing slope produce independent geometry. Removed the straight section and duplicate release on-curve, added optional contour easing, and restored tension/concavity interaction with defaults that make a fresh serif a real bracket.

`f9338db5a` the pin moves handles only; `a476b73e4` the gizmo reads its own
segment; `f64138557` S/D drags ignore the link flag.

---

## 23. Scale sliders became draggable labels — rework

### 1. Problem

Every serif length and the point's total width carried a relative scale slider on
the same row as its number. Two costs. Each slider ate a third of the row, and the
serif section had eleven of them. And the control was indirect: the thumb reported
a percentage, so setting a length meant knowing what it currently was, working out
the ratio, and watching the number rather than the slider.

### 2. Solution

The label scrubs. Pressing a parameter's name and moving sideways moves its number
one unit per pixel; shift is a tenth, control is ten. Linear, deliberately — an
accelerating scrub returns a different number for the same hand movement depending
on how fast the hand moved, so nothing about it can be learned and no round value
can be landed on without watching the readout.

Whole numbers throughout, whatever the modifier. Everything a scrub reaches is in
font units and the generator quantizes to the grid anyway, so a fraction only
stores a value the outline never uses and leaves the next drag starting from a
number the panel is not showing.

Three pieces, deliberately separate:

- `number-scrub.js` in fontra-core: pixels, modifiers, step, clamping, rounding.
  No DOM, which is the only way any of it gets tested — the view packages carry no
  harness.
- `_attachScrub` in the shared form component: the pointer events, on the label
  rather than the input. An input is a place to select text and type into, and a
  drag starting inside one fights both.
- The panel routes it. Every number field in the section now scrubs; the routing
  is checked before the other streaming branches, because a scrubbed number would
  otherwise be read as an absolute value by whichever branch claims its group.

What travels down the stream is the CHANGE from where the drag started, not a
value. Adding that change per point is what keeps a mixed selection mixed — a 40
and a 60 dragged up by 10 become 50 and 70 instead of collapsing onto one number.
The existing streaming helper already restored the pre-drag skeleton before each
frame, which is exactly what a relative drag needs, so this was routing rather
than new machinery. That helper was split so contours can use it too.

### 3. Commits

### 4. Challenges and findings

**Multiplication is gone and that is a real loss.** A scale slider grows a serif as
a unit, keeping its proportions; a scrub adds a fixed amount to each number and
changes them. Deliberate, and to be reinstated separately — likely as a modifier on
the same scrub rather than as a returning slider.

**Two clamps disagreed with the panel.** The nudge floored every serif length at
zero, copied from the scale path, but `wingSlope` is signed and the whole lower
half of its range is a real family of shapes. And the number fields declared no
minimum at all, so a drag past the bottom kept counting down in the box while the
shape had already stopped, and the number snapped back on release — the same defect
that had just been fixed on the bracket sliders. Both fixed by putting the bound
where the panel can see it.

**`resetAfterEdit` died with the sliders.** It existed so a relative thumb returned
to neutral after a drag; the value-refresh path's exception for it is gone, and the
rule is now simply that the field the user is in is left alone.

**Clamping and rounding cannot be the same call.** They were, and the first pass
shipped fractions into the boxes because nothing asked for rounding. Turning it on
in that one function would have broken the fine modifier instead: the caller folds
the clamped value back into its accumulated travel so an overshoot turns around
immediately, and folding a ROUNDED value back cancels each fine move before the
next can build on it — a tenth of a unit per pixel would move nothing at all. They
are two functions now, and the travel is only ever folded back through the clamp.
Both halves are pinned by tests.

**Shift is the fine adjust, not the coarse one.** Figma's scrub has it the other
way and the first pass followed Figma. Shift-as-precision is the stronger
convention across everything else, and it is what this repo's user expects. Note
the arrow keys in these same fields still take shift as coarse, from upstream —
inconsistent, unchanged here because it is shared with every other Fontra panel.

---

## 24. Handles on a serifed terminal — fixes

### 1. Problem

Dragging a generated handle next to a serif moved its neighbour and barely
followed the pointer. Three faults reported as one; measured against a plain cap
on identical input, which is the oracle.

The trim rebuilt its off-curves bare, dropping the constructed direction every
generated handle is stamped with. The smooth joint next to a serif therefore fell
back to inferring a direction from rounded positions, which makes it depend on
handle length — and rib width sets handle length. A length change swung the
handle on the next segment by 14.7 units where a plain cap moved it by nothing.

The offset was authored on the wrong curve. It was consumed against the segment
the generator solves; the serif eats the end of that segment, so what the designer
drags is a slice of it. A slice answers its parent's control points at a fraction
of the rate and both of its handles depend on both of the parent's, so the drag
arrived fractional and leaked 3.9 units sideways.

A prior fix had taken the cut parameter off the chord between the segment's
on-curves rather than walking the edge. That does make the cut independent of the
handles, and it moves the drawn serif: 14 units on a mild curve, 74 on a strong
one, because the chord is far shorter than the edge and the same depth then cuts
far more curve than it asked for.

### 2. Solution

The constructed axis is carried through the trim, so the smoothing pass keeps
using the direction the handle was built on rather than estimating one back out
of the rounded position.

Both of the terminal segment's offsets are withheld from the solve and applied to
the surviving handles after the splice, along that stamped axis, bounded by the
emitted segment's own reach. Both, not just the near one: the far handle shapes
the curve the cut parameter is measured along. Because an offset is a scalar
length on a fixed axis rather than a free move, the joint stays smooth by
construction and the solver is untouched — two of the three costs the original
report predicted do not exist.

The construction curve then no longer depends on anything a designer drags, so
the chord measure bought nothing and was reverted to the edge walk.

The editor reads the axis from provenance for these handles. Its usual source is
the skeleton's own handle direction, which is right for every ordinary generated
handle and wrong for one a serif anchors, because that one runs along the
terminal's depth axis instead.

Files that already carry an offset on a serifed terminal shift once on reopen.
That is the migration, and it is the whole of it.

### 3. Result

| Fault | Before                                                      | After                         |
| ----- | ----------------------------------------------------------- | ----------------------------- |
| 1     | next segment's handle swings 14.7 units on a length change  | 0.00, same as a plain cap     |
| 2     | drag arrives fractional, leaks 3.9 units into its neighbour | moves one-for-one, leaks 0.01 |
| 3     | drawn serif moves 14 units on a mild curve, 74 on a strong  | measure reverted, 0           |

Release and straight run fixed under any adjustment, point count constant, and
an adjustment past the emitted segment's reach clamps rather than running away.

### 4. Challenges and findings

**The oracle was worth building before the fix.** A width sweep comparing serif
against plain cap returned zero for both and looked like it disproved the whole
hypothesis. With no stored offset the two joint handles are already colinear, so
the inferred direction happens to agree; only a probe carrying an actual offset
separates them. Two of the three faults were invisible until then.

**The symptom was honest geometry.** While the emitted segment is a slice of a
constructed curve, a neighbour moving is correct. The defect was handing the
designer a control on the slice while the write landed on the parent.

**Every point a serif emits carries a guessed origin.** No side, and an owner
picked by counting position along the contour, so one serifed stem produces a
dozen points claiming to be the same handle of the same skeleton point. Found
while measuring, causing none of this, and read by nothing because every lookup
requires a real side. Backlog item, not fixed here.

---

## 25. Three readers disagreed about what a tension is — fix

### 1. Problem

Grabbing the curvature gizmo and releasing it without moving jumped the curve by
up to 128 units. Worst on the first grab and quiet afterwards only because the
error drove the tension to its ceiling and stuck there. Not a serif fault; the
serif work only made it easy to reach.

A handle's tension is its length over its own distance to the segment's tangent
intersection, so one is the Tunni point. The gizmo measured exactly that. The
generator normalizes against a reach clamped to a third of the chord, whose
ceiling drops below one wherever that clamp bites (§19 built it that way on
purpose), and applied the pin against that scale. Two different units, so the
number written was not the number read.

A smooth joint then rotates the drawn handle after the solve, keeping its length
and moving the intersection — 38 degrees in the case measured. So even in
matching units, the direction being measured against was never the one the length
was built on.

And entry 24 had stopped publishing a serif terminal's untrimmed construction
curve once a handle was authored there, on the reasoning that the gizmo would
otherwise read stale geometry. It left the gizmo measuring the trimmed piece and
writing the answer onto the whole curve.

### 2. Solution

The pin is rescaled onto the ceiling before it is applied, where both ends read
one at the tangent intersection and the gizmo's number means what it says.

Every generated handle already carries the axis it was constructed on. That axis
is now published with its provenance, and the drawn directions are used for
nothing — which is the forward-provenance rail applied to a reader that had been
recovering the direction from geometry all along.

The untrimmed curve stays published. The pin governs the curve the generator
solves; an authored handle is the later, separate layer, and withdrawing the
first to describe the second conflated them.

One reader for all three call sites, so the number a drag writes is the number
the label shows and the number the generator reproduces.

### 3. Result

Grab the gizmo, release without moving. Handle movement in units:

| Case                            | Before | After |
| ------------------------------- | ------ | ----- |
| plain cap                       | 128.3  | 1.0   |
| plain cap, handle dragged first | 112.2  | 1.0   |
| serif cap                       | 34.8   | 0.8   |
| serif cap, handle dragged first | 40.1   | 0.8   |

Swept over cap styles, widths, smooth and corner joints, both sides and both
drag orders: 156 of 162 cases under one unit, the rest at 1.9.

### 4. Challenges and findings

**The saturation hid the size of it.** "First adjustment jumps, then it is
smooth" reads like a state that gets initialized once. It was the error running
the tension to its ceiling in two or three grabs and having nowhere further to
go. Iterating the round trip rather than measuring it once is what showed that.

**The published axis belongs to the emitted handle, not to whatever is being
measured.** Where the reader substitutes the untrimmed snapshot, the axes are the
wrong pair — a trim re-aims the handle it anchors onto the terminal's depth axis
and stamps that. The snapshot predates colinearity, so its own drawn directions
need no correction. Getting this backwards passes most tests.

**A residual two-unit oscillation remains.** Six of 162 swept cases alternate
between two states about 1.9 units apart, all round caps on one narrow geometry.
It alternates rather than drifting, so it is grid quantization on the trim rather
than a residual error in the units. Left alone.

---

## 26. Three more items off the serif backlog — features

Grouped because they are small and independent. Each is a backlog item closed;
none needed a plan.

### 1. Problem

**A serif and its neighbour disagreed about the stem's width.** A serif sits on
the end of a straight run of stem, and that run is one wall with one thickness.
The two skeleton points holding it kept independent widths, so a disagreement
drew a wall that changed thickness where nothing was drawn to change it.

**Proportional resize had no control.** The scale sliders grew a serif as a unit
and kept its proportions; the scrubbable labels that replaced them (§23) only
add, so a 40 and a 60 dragged up by 10 become 50 and 70 — the shape changes
rather than scaling.

**A drag could not be abandoned.** Once a scrub or a slider was under way the
only exits were committing it or undoing afterwards, and dragging back to the
starting value is not the same thing: it commits an edit that happens to change
nothing and costs an undo to get past.

### 2. Solution

**The serif ties the straight it sits on.** A straight already tied the ribs at
its two ends when either was a straight-controlled smooth point. A serif terminal
now qualifies a straight the same way, so the coupling arrives through the rule
that already existed rather than beside it: rendering and hit-testing read it
back through the same group lookup, the tied flag is the opt-out, and the rib
drag carries the group with no editor change at all.

Attached to a **straight** is the whole condition — a serif on a curve has no
flat wall behind it and ties nothing.

**Every scrub field carries a multiply.** `× [ratio] [preview - Apply]` in the
same row, ratio stepping by 0.1. The button shows where that field's number
lands rather than the ratio, because a ratio is not a shape: 1.1 says nothing
about where a 40 goes, 44 does. Applied per point, so a mixed selection grows
each point from its own value. A scrub adds to what a point holds and this
scales it, so the per-point writers, the bounds and the undo labels are shared
and only the arithmetic is passed in.

**Right-click abandons a drag.** The shape returns to where the press found it
and nothing is recorded. The streaming path already rebuilt from the original
every frame, so abandoning is that restore plus the rollback notification, then
returning no changes — the ending a drag that never crossed the dead zone
already had.

### 3. Result

| Item | Before                                                  | After                                     |
| ---- | ------------------------------------------------------- | ----------------------------------------- |
| 9    | serif and neighbour hold independent widths, wall kinks | one shared width, either end moves it     |
| 11   | no proportional resize since the sliders were removed   | a ratio and an apply on every scrub field |
| 10   | a drag can only be committed, then undone               | right-click leaves no undo step at all    |

### 4. Challenges and findings

**The first pass at the rib coupling was a separate width override, and the
gizmos came off the outline.** Widths are resolved in one place and read back by
rendering and hit-testing through the same lookup; an override the editor knew
nothing about drew a correct outline under handles that had stopped describing
it. Reaching the same result through the existing rule made the editor side
disappear entirely — which is the argument for the rail, demonstrated rather
than asserted.

**The condition was wrong twice before it was right.** First "the neighbour is a
corner where the stem turns", which describes nothing real; then "the neighbour
is non-smooth", which fires on a neighbour that is non-smooth only because its
own segment carries handles. The condition is the SERIF's own segment being
straight. Neither wrong version would have failed a test written from it.

**Cap geometry was reading stored half widths, not resolved ones.** So a cap on
a tied endpoint sat off the end of the stroke it caps. Nothing could reach it
before, because an endpoint could not be tied.

**Zero is a legal thing to drag to, so a cancel cannot be one.** The stream
carries the change from where the drag started, which makes zero the obvious way
to say "put it back" — and indistinguishable from arriving there by hand. A
frozen sentinel object instead, which no amount of dragging produces by accident.
Its cost is that every consumer draining a value stream has to refuse it,
including two upstream panels that share the slider and know nothing about any
of this.

---

## 27. The minimum-separation clamps came out with the easing rework — note

Backlog item 3 asked for the clamps that stop a serif collapsing points to zero
to be lifted, so the ground rule — every point emitted at every parameter value,
coincident where it has nowhere to go — would actually hold. It was never worked
on directly. The one-attractor rework (§21, backlog item 2) removed them on its
way past, and the audit was only checked back against the code afterwards.

| Clamp                             | Item 3 asked for       | What happened                                                                               |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `MIN_HANDLE_SHARE` / `MAX_`       | remove                 | gone with the construction that had them                                                    |
| `clampReach`'s one-unit floor     | remove, keep ownership | gone; the depth clamp floors at zero and still refuses to consume more than its own segment |
| `MAX_HANDLE_TO_CORNER`            | **keep**               | gone as a named constant, kept as geometry                                                  |
| `Math.round` on emitted points    | keep                   | kept                                                                                        |
| `MIN_AXIS_TANGENT_SEPARATION_DEG` | revisit with item 1    | still there, still waiting on item 1                                                        |

The one divergence is the third row, and it is a divergence in spelling rather
than in behaviour. The bracket rounding bounds each handle by the distance to the
corner its two surfaces would meet at, and by the ease distance — so neither
handle can pass the corner and loop the curve, which is what the constant was
for. Expressed as the geometry it was standing in for rather than as a number.

**Still owed:** feature model §5 says any non-zero handle length preserves both
tangents at the release. With the share clamps gone a handle can reach zero, and
at zero the release is a corner. That is the correct output under the ground
rule, but it makes the smooth-release guarantee conditional and the model still
states it as unconditional.

---

## 28. Serif presets — feature

Backlog items 4 and 5, built together because item 4 exists only to be consumed
by item 5. [Design](specs/2026-08-05-serif-presets-design.md),
[plan](plans/2026-08-05-serif-presets.md).

### 1. Problem

A serif terminal held twenty numbers and a flag. Repeating a drawn foot on
another glyph meant setting all of them by hand, from memory, against a shape
that is only correct once every number is.

Two things got in the way of a preset, and both were older than the request.

**A serif field could be unset**, and unset resolved through a table that was
not all zeros — tension 0.7, concavity 0.8, ease curvature 0.5. So a preset that
stored "unset" meant something different from one that stored a number, on three
fields, invisibly.

**A fresh serif drew nothing.** Its three size fields defaulted to zero, so
picking serif from the cap style select produced an invisible terminal with a
bracket nobody could see.

### 2. Direction

Unset stops existing. Every serif field always holds a number, and zero is a
setting rather than an absence. The default shape moves out of a fallback table
and into a **write**, applied the moment a terminal becomes a serif.

A preset is **one wing** plus the underside cup — ten numbers, not twenty-one.
Applying it writes that wing to both sides. Asymmetry is a decision about the
terminal being edited, not about the shape that was saved.

Five built-ins ported from the serif lab, whose numbers are already one wing and
already these fields. It draws at stem width 150, so lengths divide by 7.5 onto
the 20-unit scale; the tip cut is an angle and the two bracket numbers are
ratios, so those carry across untouched.

### 3. Result

|           | wing | tip | slope | cut | cup | reach | tension | concavity |
| --------- | ---- | --- | ----- | --- | --- | ----- | ------- | --------- |
| Egyptian  | 20   | 20  | 20    | 0   | 0   | 0     | 0       | 0         |
| Clarendon | 18   | 10  | 1     | 0   | 0   | 19    | 0.9     | 0.85      |
| Didone    | 19   | 3   | 0     | 0   | 0   | 13    | 0.7     | 0.8       |
| Old style | 15   | 5   | 7     | 22  | 3   | 20    | 0.62    | 0.66      |
| Wedge     | 13   | 2   | 13    | 0   | 0   | 5     | 0.05    | −0.18     |

Egyptian is the default and is what a terminal gets when it becomes a serif. The
master defaults panel lists and edits the master's own presets. The parameters
panel applies one, with a scope of both wings, left only or right only, and
captures or overwrites one from the selected terminal. A built-in cannot be
overwritten. Apply and update both ride the armed force-apply row the width and
cap profiles already use.

### 4. Challenges and findings

**The seed never fired once.** It tested whether the point held serif data, and
point normalization materializes a serif block on every on-curve point in the
file — the block is always there, so the test could not pass. Every terminal
switched to serif came up with no size and a bracket out of nowhere, which is
exactly what the fallbacks were. The condition is gone entirely now: picking
serif applies the default, unconditionally, because the select only fires on a
change and picking it is a request for the default shape.

**Protecting shapes cost the rule that was asked for.** The stated rule was
"20-20-20 and all zeroes from down there". This was built with tension migrating
to 0.7 and concavity to 0.8, so that no serif already drawn would move when the
field became a real number. That guarantee was never requested, it is what the
unseeded terminals above were displaying, and it had to be reported wrong twice
before it came out. A stated requirement softened to fit the existing design is
still a requirement missed.

**The inherit chain had a level nothing could write.** A contour can hold its own
serif block and three readers fell through to it — the generator and both panel
readers — and no code in the tree ever set one. Removed with the null, since
with every point field filled it could never have fired again. The contour cap
style has the same shape: read by the generator, written by nothing. Left alone,
because that is cap work.

**The migration table and the seed were close enough to confuse.** They agree on
six fields and differ on three, and the field writer reached for the wrong one,
so emptying a tension box put 0.7 straight back into it. A table for reading old
data and a table for starting a new shape should not have looked alike.

**A missing import in a panel is a runtime error and nothing before it.** One
edit missed its anchor, the built-in list was never imported, and the whole serif
preset section threw on the next panel build. `fontra-core` has the only test
harness in the tree, so neither panel has anything that would have caught it.

---

## 29. Four reported bugs, and where each bound was written

Not a feature. Four defects reported together, fixed in order. They have one
thing in common: in every case the code did the right thing in one place and a
different thing in another, and the two were never compared.

### 1. A serif drew a wing on a side that has no stroke

Single-sided mode moves all the width to one side, so the other side copies the
skeleton exactly. Every other cap honours that. The serif did not: it built both
wings from its own numbers, so a default terminal reached twenty units past the
skeleton onto the dead side.

The collapsed half now resolves to zeros — no shape. It still emits all of its
points, all collapsed, which is what keeps a single-sided serif interpolable
against a two-sided one. Checked directly, not inferred from the shape.

### 2. The curvature gizmo could not reach a detached handle

Handle placement ran in three steps: the natural answer, the authored
adjustments, the pin. Detached placement ran **after** the pin and overwrote it,
so pinning a segment that had a detached handle on it did nothing to that
handle.

Both kinds of adjustment place a handle. The pin then states what the segment's
tension is. So the pin runs last. Detaching a handle takes it off the natural
answer, not out of the gizmo's reach.

This changes any existing glyph carrying both a pin and a detached handle on one
segment. No golden fixture had the combination, which is a gap in the fixtures
rather than evidence the change is inert.

### 3. Contour easing grew at two different rates and stopped at one

The rounding is one curve across the corner where the serif meets the stem. Both
ends step back from that corner by the ease distance — one along the stem wall,
one along the bracket.

The wall end did that, in units. The bracket end took the same number, divided
it by the bracket's chord length, and used the result as a **curve parameter**.
Different quantity, different unit. The two ends never moved by the same amount
at any setting. Only the bracket end had a bound, so only it ever stopped.

Both ends are found by distance now, by bisection on the split parameter. The
bound moved from half the bracket to the whole of it: the rounding runs until it
has replaced the bracket, ending where the bracket meets the wing.

The reported fix was "clamp at the wing's corner, both points". The wing's inner
corner sits below the junction, inside the serif, and the wall end travels the
other way — clamping both there would have stopped the wall end at twice the
reach from where it belongs. The end of the bracket is the only bound that reads
as one corner from both ends. Said so rather than substituting quietly.

### 4. The same ceiling, written in three wrong places

Then three rounds on one symptom: the scrub went past the ceiling.

**First attempt — bound the scrub.** The scrub is not the only way a value gets
in. The typed field and a preset write directly and went around it.

**Second attempt — bound the writer.** Correct, and it is where the bound lives
now: every serif edit comes through one writer, so the value stops there
whichever way it is reached. The symptom did not change.

**The actual bug was in neither.** The value _was_ being clamped. The input box
was showing something else. The panel deliberately refuses to write back into
the field the user just touched, so an arrow-key run is not interrupted
mid-keystroke, and that refusal was still on when the refresh ran at the end of
a drag. A "force a rebuild" added in between was useless for exactly that
reason: the rebuild ran and skipped the one field that needed it.

A drag is finished by the time that refresh happens, so the field is released
for a stream and held for a typed change, which is the case the hold-back exists
for.

**Two attempts were spent fixing the model because the report said the value was
wrong.** It was not. The stored number was right after the second attempt and
the report was unchanged, which was the signal that the model was not the
subject — and it took a third round to read it that way. A panel that can show a
number the model rejected can make a correct fix look like no fix at all.

### What this run says about the fixtures

Three of the four changed serif or handle geometry. The golden fixtures moved
for none of them. They carry no case with a non-zero ease distance, and none
with a pin and a detached handle on one segment. The suite passing is not
evidence here; the direct measurements are.

---

## 30. The cup's lowest point moved to the middle of the foot — fix

The last item on the serif backlog, which is retired with this entry: every item
on it is built, what they built is in the feature model, and why is here.

### 1. Problem

The underside cup is one curve across the whole terminal, and its lowest point sat
on the skeleton endpoint. Single-sided mode moves all of the width to one side, so
the other half of the serif collapses to zeros and the terminal stands entirely on
one side of the skeleton. The lowest point then landed on the foot's own edge
rather than its middle, and the foot read as a lopsided scoop.

### 2. Solution

The centre is the midpoint of the two tip bottoms — the two ends of the cup curve
itself. One line, no single-sided branch, and the collapsed case falls out of it
because a collapsed half puts its tip on its own wall.

Depth is untouched. The centre still lifts by the cup amount along the frame's
depth, and the four cup handles still keep their own end's depth.

The alternative offered was the middle of the two stem walls, which is the same
number as the skeleton whenever the widths match and would have kept the old
guarantee intact. The designer chose the foot.

### 3. Result

Contact height over a stem leaning to 30 degrees, old rule against new, in the
perpendicular axis mode:

| wings              | 0°          | 10°         | 20°         | 30°         |
| ------------------ | ----------- | ----------- | ----------- | ----------- |
| 60/60              | 18.0 / 18.0 | 17.7 / 17.7 | 16.9 / 16.9 | 15.6 / 15.6 |
| 20/120             | 18.0 / 18.0 | 17.7 / 26.4 | 16.9 / 34.0 | 15.6 / 40.6 |
| one half collapsed | 18.0 / 18.0 | 17.7 / 12.5 | 16.9 / 6.7  | 15.6 / 0.6  |

Under a flat foot — the horizontal axis mode — every row is identical before and
after, at every tilt, because an axis with no rise cannot lift the centre that
slides along it. So the alignment-zone guarantee survives exactly where it is
asked for, and what moves is a foot that was leaning with the stem anyway.

Full suite 1,774 passing.

### 4. Challenges and findings

**The first sweep measured nothing, and looked like it measured everything.** It
rotated the axis toward the stroke instead of leaning the stroke under a fixed
axis, so most of what it reported was the 15 degree separation clamp pushing the
axis back off the tangent. The question was about a leaning stem, so the stem is
what has to move. Same lesson as entries 5 and 16: sweep design decides the
answer.

**A flat foot cannot be tilted by this change, and that is arithmetic rather than
luck.** The centre only ever slides along the axis. An axis with no rise has no
way to carry the contact point off the alignment zone, whatever the halves do. So
the guarantee the old rule was written for survives in the modes that exist to
provide it.

**No golden fixture moved, and that is a gap rather than a result.** None of them
carries an asymmetric terminal, so the corpus cannot see this change at all. The
same gap was reported one entry earlier for ease distance and for a pin sharing a
segment with a detached handle.

---

## 31. The cup got a balance — feature

Asked for straight after entry 30, and it is the other half of the same control:
that entry decided where the foot centre sits by default, and this one hands the
designer the number.

### 1. Problem

The cup's lowest point was wherever the geometry put it. A foot that wanted its
scoop nearer one wing than the other could not be drawn.

### 2. Solution

`undersideCupBalance`, a third terminal-level cup number beside the depth and the
tension, travelling in a preset like they do. Zero is the midpoint of the two
tips, so nothing already drawn moves. Plus or minus one carries the centre onto a
tip, where one half of the sweep collapses to nothing — a legal shape under the
ground rule, and the point count holds.

It is a **fraction of the half-span between the tips**, not a distance. The foot
it divides sets the scale, so the number reads the same on a narrow serif and a
wide one, the units mode never touches it, and a preset carries it between masters
unchanged. The alternative offered was a signed distance in units, which would
have joined the length fields and changed meaning with the wing size.

The panel shows it as a percentage slider under the cup depth, at the same
−100…100 range the width distribution already uses.

### 3. Result

Seven tests: neutral draws the midpoint, either extreme lands on a tip, halfway
lands halfway, past the extremes it stops, depth is unchanged at every value, the
count holds at both extremes, and each cup handle keeps its own end's depth well
off centre. Full suite 1,781 passing.

### 4. Challenges and findings

**The field reached the generator with no copy line, which is worth stating
because it usually does not.** A per-point field is invisible to the generator
until something copies it across, and that trap has caught this project twice.
The serif is the exception: its whole block travels as one object, so a new field
inside it arrives for free. The check is still the same one — look at what the
flattening actually copies, rather than assuming either answer.

**The bound went in the writer, not the slider.** Entry 29 spent three rounds
learning that the scrub, the typed field and a preset are three ways into the
same number, and only the writer sits under all of them.

---

## 32. Three gaps between the skeleton and the ordinary path — fixes

Skeleton basics backlog items 1.1, 1.2 and 1.5, done together because each is
small and none touches geometry.

### 1. Problem

- The ordinary pen constrains the next point to a whole angle under shift. The
  skeleton pen ignored shift.
- Right-click offers **Reverse contour** on an ordinary contour and offered
  nothing on a skeleton one.
- Control-click added to the selection, and control is spoken for in this fork.

### 2. Solution

**Shift.** The ordinary pen's constraint is exported and the skeleton pen calls
it, so there is one rule. It applies only while a contour is being extended,
which is the ordinary pen's own condition.

**Reverse.** The `reversed` flag turned out to be a level with a reader and no
writer: stored per contour, normalized, read by the generator, set by nothing.
The menu is its writer. Reversing a skeleton therefore flips the emitted
outline's winding and leaves the centerline as drawn. The existing menu entry now
answers a skeleton selection too, and a rib answers it as much as a centerline
point does. Each selected contour flips its own state, matching what an ordinary
mixed selection does.

**Control.** Adding to a selection is now the Mac's command key alone. Shift
still builds a selection up on both platforms.

### 3. Result

Full suite 1,782 passing. The three editor changes carry a manual matrix, per the
test split (rail R-G): draw with shift held from an endpoint and from nothing;
reverse from a centerline point and from a rib, on one contour and on several;
and check that control-drag still snaps to the coarse grid while control-click no
longer extends.

### 4. Challenges and findings

**Two of the three items were not what they said they were.** The reverse item
asked for a menu entry and the work was almost entirely deciding what reverse
means for a stroke. The control item read as a forkra defect and was upstream
behaviour, correct on its own terms, colliding with a modifier this fork had
taken. Neither could be planned from its own sentence.

**A dead level is worth grepping for before designing around it.** This is the
third one found: the contour serif block in entry 28, the contour cap style
beside it, and now this flag. The check is the same each time — who writes it,
not who reads it.

**The point-key parser refuses a rib key.** It requires exactly two fields and a
rib carries three. It returns null rather than throwing, so the menu item would
have been quietly enabled and done nothing on a rib.

---

## 33. Splitting a skeleton contour — feature

Skeleton basics backlog item 1.6.

### 1. Problem

Right-click an ordinary on-curve point and the menu offers to break the contour
there. A centerline point offered nothing.

### 2. Solution

The same menu entry answers a centerline point now. A closed contour opens at
that point and stays one contour; an open one becomes two, the second appended.
The point appears at both ends of the cut, one copy keeping its id and the other
taking a fresh one, because two points cannot share a name.

The cut itself is one pure function in the model, with the editor supplying only
the selection. Every per-point setting travels with its point, and both copies of
the cut point keep all of it.

### 3. Result

Seven tests on the cut. Generation measured across the change: a closed
contour's two generated loops become one open stroke of 10 points, and an open
one's single 8-point stroke becomes two of 4 and 6. Full suite 1,789 passing.

The menu wiring carries a manual matrix: cut a closed contour, cut an open one,
cut the same contour at two points at once, and try it at an open contour's own
end, where it must do nothing.

### 4. Challenges and findings

**Two of the three warnings the item carried did not apply.** It asked for the
generated-contour mapping to be updated in the same change, which the ordinary
path does need — but the skeleton's one write path already replaces the contours
whenever the topology changes, and a split is exactly that. It also asked for a
cap on each new end, and cap style falls through a cascade, so an unset one draws
butt like any other untouched endpoint. Both were true of the donor and are not
true here. **An item's own warnings are as old as the item.**

**The smooth flag had to be cleared on the two new ends.** A smooth point with a
single handle has no direction of its own, which is the condition that ties ribs
across a straight. Carried onto a cut end, a split would have quietly reweighted
the stroke beside it — a geometry change nobody asked for, from a structural
command.

**Resolving all the ids before the first cut is what makes multiple splits
work.** The cross-layer resolver reads structure, and a cut changes it. Each
point is then found by its own id rather than through its original contour,
because cutting one contour twice moves the second point onto the new half.

---

## 34. A single-sided skeleton pen — feature

Skeleton basics backlog item 1.3.

### 1. Problem

A single-sided contour puts all of its width on one side, so the line drawn is
the edge of the letter rather than its middle. It was a flag to set after
drawing, never a way to draw.

### 2. Solution

A second pen beside the first, in a dropdown, laid out exactly as the ordinary
pen holds its cubic and quadratic pens: a wrapper class naming the two, which is
what turns one toolbar button into a button that opens.

The second pen is the first with one value changed — which side a new contour is
born on. It inherits everything else, so the two cannot drift. New contours start
on the left, the side the generator falls back to everywhere else, and the panel
flips them afterwards like any other contour.

The skeleton pen was registered directly, so it moved its own name onto the
wrapper and took a new one for itself. Nothing keyed off that name: it appeared
in one import and one label.

### 3. Result

Full suite 1,789 passing, which says only that nothing else broke — this is
entirely editor-side. Manual matrix: both pens appear under one button, each
draws, and a contour drawn with the second reads as single-sided in the panel
with its per-side numbers greyed.

### 4. Challenges and findings

**The request was to copy the file and adjust it.** The pattern it pointed at is
not a copy: the quadratic pen is a twelve-line subclass of the ordinary one. Same
result, one file, and the two pens cannot fall out of step — which is the rail
against duplicated code (R-B) paying for itself rather than being argued for.

**The generated copy of the icons folder is gitignored**, so a new tool icon goes
in the source assets only. The bundle puts it where the page reads it.

---

## 35. A serif on a curved stem — fix

Reported on `_external/b.json`: a skeleton of one cubic segment with a serif on
one endpoint. Moving the serif's tip thickness changed the curvature of the stem
radically.

### 1. Problem

The serif built its terminal on a straight line, running from the rib end along
the endpoint tangent into the stroke. Every point it shared with the stroke sat
on that line, at a depth the serif's own numbers decided, and the release's depth
is tip thickness plus wing slope plus reach plus ease distance. In the reported
file tip thickness set that depth almost alone.

On a curved stem the real wall departs from that line, and by more the deeper you
go. The generator cut the real wall at the release's depth, dragged the cut end
sideways onto the release, and turned the surviving handle onto the endpoint
tangent. Both corrections grow with the depth. Because the wall is one cubic with
two handles, moving its end and rotating its handle reshapes the whole segment.

Measured on the reported file, greatest distance from the emitted right-hand stem
wall to the wall emitted with no tip at all:

| tip thickness | before | after |
| ------------- | ------ | ----- |
| 0             | 0.5    | 0.00  |
| 20            | 2.6    | 0.05  |
| 40            | 6.0    | 0.05  |
| 63            | 11.2   | 0.05  |
| 80            | 16.0   | 0.05  |
| 100           | 22.8   | 0.06  |

The construction curve's control point never moved through the whole sweep, which
proved the offset solver innocent and put the fault in the splice.

### 2. Solution

The wall itself, as a curve, replaces the straight line. A new module carries one
curve in the terminal's own frame and answers four questions about it: where it
is at a depth, where a ray meets it, which way it runs, and how deep it may be
consumed. It knows nothing about serifs or strokes.

The wing's top surface is now extended inward from the top of the tip until it
meets that wall. Where it meets is the wing's inner corner. The junction and the
release sit at their own depths further up the same wall. The generator cuts at
the release's own parameter and emits what survives, unchanged. The anchoring
that dragged the end and turned the handle is deleted, along with the frame's
lean value, which nothing reads once the wall carries its own shape.

The cut is taken on the wall as solved from the centerline and the widths, before
any authored layer touches it. All three authored layers — the curvature pin, a
nudged handle and a detached handle — are applied to the piece that survives. The
first two already were; the pin moved across in this work.

### 3. Result

Full suite 1,805 passing. No fixture moved, which is the evidence that a straight
stem is untouched: a straight wall is exactly what the old model assumed, so the
two answers are the same point. The serif geometry tests kept every one of their
existing expected numbers for the same reason.

New tests: the emitted stem wall stays within two units of itself across tip
thickness 20 through 100; the point count holds; sweeping a curvature pin over
its whole range moves no on-curve point by exactly zero; the pin still moves
handles; no second curve is published on a serif split.

Two stored numbers change meaning. **The curvature pin on a serifed terminal**
described the tension of the whole solved wall and now describes the tension of
the emitted piece, so a file already carrying one shifts once on reopen. That is
also what lets the gizmo stop being handed a snapshot of a curve it is not
looking at. **Wing slope** was a rise measured on the assumed line and is now the
incline of the wing's top surface, whose run is decided by where the wall is. The
two agree on a straight stem.

### 4. Challenges and findings

**The claim that a pin must move the release was wrong, and the designer caught
it.** The reasoning was that the release is found on the wall, so anything that
reshapes the wall moves it. True — but the pin is applied when the wall is
solved, and the cut is taken afterwards. The coupling is a consequence of the
order, not of the geometry. Move the cut ahead of the authoring and the release
is immune. **Check which step runs first before concluding two things are
coupled.**

**The pin goes last, not first.** The plan put it before the handle placements,
reasoning that a pin states the tension and placements come after. The solve does
the opposite — natural answer, attached adjustments, detached placement, pin —
and it has to: the gizmo measures the drawn curve and writes a pin, and if a
placement runs after the pin it overwrites it and the measured number cannot be
reproduced. The round-trip test is what caught this.

**A one-unit floor on the cut is right for a round cap and wrong for a serif.** A
round cap builds its tip from the direction the leftover piece gives it, so it
needs a piece. A serif reads no direction off it and may release the stroke at
the rib end itself, which is a legal shape under the ground rule. Flooring it
there moved an on-curve nobody asked to move, and a fully collapsed serif on a
straight stem drifted a unit.

**Deleting the anchoring took the surviving handle's axis with it.** That axis is
what an authored adjustment moves along and what the editor publishes as the
handle's construction axis, and three tests went quiet rather than loud. The
handle at a cut is tangent to the curve there, so its own direction is the axis —
stamping that is a true statement, and the old one was a fabricated direction.

**The honest axis has less headroom than the fabricated one.** A handle drag that
used to reach 30 units now stops at 23, because the ceiling is where the
segment's two handles would cross and the true tangent puts that crossing nearer.
The clamp was always there; the old axis was pointing somewhere the curve did not
go.

## 36. Harmonize accepts a skeleton — feature

Skeleton basics backlog item 1.4.

### 1. Problem

Harmonize reported every skeleton contour as skipped. That is correct for the
generated outline, which is derived and would be thrown away. It is wrong for
the skeleton's own centerline, which is an ordinary path carrying ordinary
smooth flags.

### 2. Solution

Build the centerline as a path, run the ordinary harmonize over it, write the
moved points back. The pass is untouched, and nothing in the new code knows
about widths, ribs or the outline.

The write goes through the one skeleton write path, so the outline is
regenerated for free.

A skeleton selection answers the command itself, the way break and reverse do.
An ordinary selection takes the path route it always took.

### 3. Result

Full suite 1,826 passing. Two new tests: a smooth centerline joint moves its
handles and holds its on-curve points, and a point that is not a joint moves
nothing.

### 4. Challenges and findings

**The first fixture harmonized in one iteration and moved nothing.** Its two
handles at the smooth point were not just colinear but already equal in
curvature, so the pass had nothing to correct. A real test needs a joint that is
smooth and unbalanced: colinear handles of very different length.

**Reports are addressed, not indexed.** The path built to run the pass is thrown
away, so an index into it means nothing afterwards. Each entry carries the
contour and point id it came from.

**Only the edit layer reports.** Structure is shared across compatible layers, so
every layer reaches the same verdict on the same point; the numbers behind it are
the edit layer's. Each layer is still recomputed from its own handles, because a
different set of handles has a different harmonic target.

---

## 37. Corner rounding became distance and curvature — rework

### 1. Problem

Corner rounding had four sliders. Three of them — roundness, reach and strength
— multiplied into one number, the distance the corner is trimmed back by. Reach
capped that distance against the neighbouring point, roundness took a fraction
of the cap, strength scaled roundness again and the product was clamped to one.
So three controls drove one quantity, at different strengths, and no one of them
said what the corner would measure.

The fourth, asymmetry, scaled roundness down on the left or the right side of
the stroke. One number for a thing that is two.

The arc's own fullness was fixed at the default cap tension. There was no
control for it at all.

### 2. Solution

Two numbers per side of the stroke, shaped like `width`. **Distance** is how far
back along each arm the rounding starts, in font units. **Curvature** is how full
the arc is, on the tension scale the serif's contour easing and the curvature
gizmo already use: 0 cuts a straight chamfer, 1 puts both handles on the corner
point. The two sides start linked and unlink from a checkbox.

Distance is absolute units rather than a fraction of the arm. A fraction
rescales itself when a neighbour moves, so the drawn corner changes when nothing
about the corner changed.

Three clamps hold the distance, and they are the geometry rather than a fixed
fraction standing in for it: the run to the neighbouring on-curve, the handle on
a curved arm, and the pairwise pass that splits one segment between the two
corners sharing it.

The old fields are gone, with no migration, which the designer chose. A corner
drawn before this change comes back sharp.

### 3. Result

Full suite 1,841 passing. Seven new generator tests: distance zero is byte-equal
to a sharp corner, each arm trims by its own distance, curvature 0 draws a
chamfer, curvature 1 lands both handles on the corner, unlinked sides round
independently, an over-long distance clamps rather than running away, and a
collapsed side stays sharp. Four model tests cover the linked and unlinked
writes, the bound, and the mirror swap.

No golden fixture moved. That is a gap rather than a result: the corpus carries
no rounded corner at all, so it cannot see this change. The same gap was
reported for ease distance in entry 29 and for the cup centre in entry 30.

Editor side carries a manual matrix, per rail R-G: round a corner from the
panel, scrub the distance label, unlink and give the two sides different
numbers, and check that a mirrored corner keeps the wide side on the wide side.

### 4. Challenges and findings

**The half-width gate reads two ways, and the code already chose.** A side under
half a unit lies on the skeleton, so rounding it pulls that edge off the drawn
line. Single-sided mode is the deliberate exception: the collapsed side borrows
the live side's base and rounds with it, so the two edges of the stroke agree.
The first test asserted the general rule and failed against the exception. The
test was wrong, not the code — the exception is shipped behaviour and changing
it was not what was asked for.

**The arc's fallback fired at exactly the setting that wants nothing.** The old
code repaired a near-zero handle length with a circular-arc estimate. Under a
curvature control, a zero-length handle is the chamfer the designer asked for.
The fallback now fires only on a degenerate chord, which is the case it was for.

**A fourth dead level.** The contour-level `cornerTrimRatio` and
`cornerRadiusBoost` were read by the generator and normalization and written by
nothing in the tree. That is the fourth found by the same check — who writes it,
not who reads it — after the contour serif block, the contour cap style and the
`reversed` flag.

**The point count still varies with the parameter**, because distance zero emits
no arc. So a corner rounded in one master and sharp in another does not
interpolate. That predates this work, and the serif's collapse rule was
deliberately not extended to corners without being asked.

**One thing found and left alone.** `CAP_CORNER_POINT_FIELDS` in the fixture
script is a field-name list with the serif fixture objects merged into it, so
those fixtures are never generated and the loop over the list indexes points by
object. It is a dev script, it predates this work, and fixing it here would be a
change nobody asked for.

---

## 38. A nudged handle was measured and bounded on a curve nobody was looking at — fix

Reported on `_external/k.json`, against the fourth point of the skeleton — the
smooth one where the diagonal meets the stem. Two faults, one origin.

### 1. Problem

**The curvature gizmo jumped.** Grabbing it on the segment to the left of that
point and releasing without moving moved the two handles 29 and 30 units. Every
later drag was smooth, so the control worked once it had thrown the shape away.

**The handle to the right of the point would not move.** Every offset the
designer asked for was refused in full: 5 units asked, 0 honored, at every value
from 5 to 60.

Both come from the two emission displacements. An on-curve carries `nudge` and
its handles carry `handleNudge`, and the generator applies both after the
construction is finished.

For the jump: the reader that recovers construction space subtracted the
on-curve's displacement, which provenance published, and could not subtract the
handle's, which nothing published. So it measured an end from one curve and a
handle from another, wrote that number as a pin, and the generator reproduced
the pin on the real construction.

For the stuck handle: the ceiling on handle length is the forward tangent
intersection of the constructed curve. On that segment the intersection sits
0.76 units from the rib end, so the window closed completely — the one-unit
floor is capped by the ceiling, and minimum equalled maximum. The curve the
designer was dragging is not that one. Its on-curve had been nudged 51 units
back along the same tangent, which leaves the drawn intersection where it was
and the drawn end 51 units further from it.

### 2. Solution

**Publish the handle's own slide**, the way the on-curve has published its own
all along, and take both off together when recovering construction space.

**Take that slide off the ceiling**, which is a statement about the drawn curve.
Forwards it takes room away, which is what stops an untouched segment rendering
past its own crossing. Backwards it gives room back. The on-curve nudge does not
enter it and cancels by arithmetic.

That left one number doing two jobs again, so the domain now carries two: the
ceiling, which moves with the slide, and the intersection tension, which is where
tension 1 sits on the curve the generator solved and is the unit the gizmo reads
and writes in. Rescaling a pin by the ceiling was the first attempt and it made
the jump worse — the stored number then meant something different on every
nudged segment.

### 3. Result

Measured on the reported file, grabbing each gizmo and releasing without moving:

| segment            | before | after |
| ------------------ | ------ | ----- |
| left of the point  | 30.00  | 0.00  |
| right of the point | 1.00   | 0.00  |

Dragging the left one now tracks the cursor one-for-one in both directions, and
the number written equals the number read back to three decimals. The stuck
handle moves one-for-one to 11.7 units and then stops at the drawn curve's own
crossing, against 0 at every value before.

Full suite 1,850 passing. No golden fixture moved, and that is a gap rather than
a result: the corpus carries no handle nudge at all, so it cannot see this
change. The same gap was reported for ease distance in entry 29, the cup centre
in entry 30 and corner rounding in entry 37.

### 4. Challenges and findings

**The two faults measured as one and were not.** Zeroing the handle nudge made
the first disappear exactly — a zero-delta grab moving 0.00 — and left the second
untouched. Zeroing the on-curve nudge as well left the second untouched again.
That pair of measurements is what separated a reader fault from a bounds fault
before either was touched.

**Rescaling the pin by the ceiling was built and reverted inside the hour.** It
is the obvious way to keep one number, and it reintroduced the entry-25 fault at
larger size: the zero-delta grab went from 0.00 back to 16 units. Two jobs, two
numbers, stated for the third time in this file.

**The backwards direction is still conservative.** The ceiling is capped at
tension 1 on a scale that is itself capped at twice the chord, so a backwards
slide recovers room only where the real intersection sits below that scale —
which is the frozen case, and is why the fix does what was asked. On ordinary
geometry a slid handle stops short of its drawn crossing rather than at it. Left
alone: the handle moves, which was the complaint.

**One segment on that glyph still reports no tension at all** at the far end of
its range, because its drawn handles pass the crossing and the reader declines to
invent a number rather than report one above the ceiling. That segment offsets 54
units on a bend tight enough that one cubic cannot hold it, which is the limit the
curvature gizmo exists for.

## 39. The bulb's neck had a number that could not be aimed and a gizmo that was not there

### 1. Problem

Three faults in one control.

The bulb's easing was named tension, which it is not: it sets how far back along
the inner edge the neck starts. It was also indirect. The value grew a second,
inflated ball and took whatever crossing that ball happened to make with the
inner edge, so no reading of the number told you where the neck would land, and
the crossing search was free to walk past on-curves and eat whole segments.

The curvature gizmo was absent from the whole terminal region. The segment walk
takes a segment only when all four of its points carry addresses on one side. Cap
points carry none, and the trim rebuilt the inner edge's two handles from a
bezier split without re-attaching theirs. So neither the neck nor the edge above
the incision had one.

### 2. Solution

Easing is now a 0–1 fraction of the run from the plain ball crossing back to the
next on-curve on the inner edge, placed directly. At 1 the far end collapses onto
that on-curve. One run serves both the geometry and the panel's top of range, so
the stop cannot disagree with the number. The panel keeps a slider, now 0–100.

The trim publishes what the round-cap split already publishes: the original
handles' addresses on the rebuilt handles, and the untrimmed segment on the
crossing on-curve. That gives the edge above the incision a gizmo that measures
the curve its pin governs. It is published only when easing is off, because
exactly one gizmo belongs at a bulb's terminal.

Once easing is on, the neck gets that gizmo instead. A neck has no skeleton
segment behind it, so its curvature is stored in `capBallEaseCurvature` on the
cap-owning point, and its four points name that point and that field. The drag
measures the tension the same way and writes it there.

### 3. Result

Full suite 1,860 passing. Easing 1 puts the neck's far end on the next on-curve
to half a unit, the far end moves monotonically across the whole range, and the
neck's curvature changes its handles without moving either end. No external glyph
uses a bulb, so nothing else moved.

### 4. Challenges and findings

**The obvious test helper measured two different points.** The rejoin was read as
the furthest-forward on-curve on the inner edge. Once easing is on, the ball
attachment also lands near that edge and sits forward of the neck's far end, so
the helper reported the attachment at small easing and the far end at large.
The continuity check failed at 0.05 and passed everywhere else, which reads as a
geometry bug and was a measurement bug.

**A straight stroke cannot test this.** The inner edge's terminal segment is a
line there, and a line has no curvature gizmo, so the first version of the
addressability test asserted against geometry that could never satisfy it.

**Naming the point is not the same as owning it.** The neck names the cap-owning
skeleton point so the gizmo can find it, and that alone made every neck point
resolve as an editable generated handle — a drag would have moved the rib the
neck hangs off. Three readers had to be told the difference: the segment walk,
the on-curve gizmo's eligibility, and the editable-target resolver. Provenance
that names a point is an address, not a claim of ownership, and each reader
decides for itself what it may do with one.

## 40. Five small items around the skeleton editor — features and fixes

Short entries. None of these carried a design of its own.

**Point indices on a skeleton.** The existing point-indices layer reads the
glyph path, and a skeleton is not in it. A second switchable layer counts the
skeleton's own points, on-curves and handles alike, from 0 across every skeleton
contour. Off by default, drawn in the same box and place as the path layer's
numbers.

**A continued stroke keeps its own width.** The skeleton pen gave every new point
the model's fallback width, so extending an existing stroke stepped back to that
width at the next point. An appended point now takes the width of the endpoint it
extends. The first point of a new contour takes the master default, which until
this change landed on the contour alone and was never read for geometry.

**A hand may collapse a generated handle to zero.** The one-unit handle floor
stops the solved handle riding along with the rib end. That is the automatic
answer's problem, not the designer's. An attached adjustment, a pinned curvature
and a detached placement may now put a handle exactly on its point, on the
ordinary path and inside a serif terminal alike. The ceiling is untouched.

The curvature gizmo follows it down. The shared shift bottoms out when the
shorter handle lands on its point, and the stored mean cannot describe anything
past that — it reads zero for every length the survivor still has. So the drag
writes the pin down to that floor and carries the rest as a displacement on the
one handle still off its point. The generator applies the displacement first and
the pin after, and a pin of zero leaves an already-collapsed pair alone, so the
two compose. A pin of zero also renders now. It used to read as no pin at all,
which threw the last step of the descent away on reload.

**A handle offset stopped climbing past the ceiling.** A stored offset is a
request, and the clamp on handle length can refuse most of it. The store kept the
whole request, so a drag that pushed against the ceiling left a value far beyond
it, and the next drag back moved nothing until it had walked all the way down.
The generator now publishes the part of each attached offset it honored, and a
drag starts from that instead of from the raw store.

**The hosted glyph panels draw on first load.** The letterspacer and the skeleton
defaults live in host elements that enter the DOM only when the glyph info form
is rebuilt. Their own update runs when the panel is switched on, which on a fresh
load happens before that form exists, so both drew nothing and had no later event
to bring them back. They now refresh on the rebuild that re-attaches their host,
and only on that one: the form is rebuilt on every selection change, and
redrawing there would replace a control still under the cursor.

## 41. The bulb's ball was tested for, not solved for — fixes

Three fixes on one control, measured on `_external/skeletron.fontra` glyph `d`.

### 1. Problem

Placing the ball trims the outer edge back and sits the ball tangent there, deep
enough that its forward extreme lands on the terminal. The trim was guessed,
tested against a hard fit predicate, and grown until the predicate passed.

Two faults followed. The accepted trim was the first one that passed, and a trim
that only just passes leaves the ball almost no depth — 21 units deep against 55
across, on a ball asked for at 75. Past the predicate the search gave up and
returned its first guess, reusing a trim distance as a ball radius. Which of the
two a glyph got turned on a margin of two hundredths of a unit.

Two more faults sat behind it. Where no cut on the terminal delivered the
requested depth, the search ran to the end of the usable run and took whatever
sat there, which was no depth at all — on a curved terminal at ball ratio 2 and
above the ball came out one unit deep and the bulb vanished. And a ball whose
sideways swell alone already passes the terminal plane has no depth that
satisfies the pin at any cut, so the terminal fell through to a plain cap.

### 2. Solution

The trim is bisected for. The depth the terminal allows rises as the cut moves
back and runs away where the edge turns square to the stroke, so the requested
depth is a root, and the search finds it from the deep end. The ball is the shape
the settings asked for, and the cut moves to deliver it.

Where the request does not fit, the search carries the deepest ball the run
allows and falls back to it, refined between the samples either side so the
answer moves rather than stepping. The two answers meet where the deepest
available reaches the request.

Where the ball is too wide for any cut, it is narrowed until one cut holds it.
The bulb stops growing past that width and stays a bulb.

### 3. Result

Sweeping the far skeleton point 40 units in quarter-unit steps, worst single-step
outline movement 93.94 before, 3.00 after.

On the curved terminal at ball shape 0.25:

| ball ratio | before | after the fallback | after the narrowing |
| ---------- | ------ | ------------------ | ------------------- |
| 2.00       | 132.6  | 253.8              | —                   |
| 2.50       | 158.5  | 239.3              | —                   |
| 3.00       | 187.9  | 239.7              | 239.3               |

Sweeping ratio 0.5 to 3 in 51 steps, 6 steps drew a plain cap before and 0 draw
one now.

### 4. Challenges and findings

**A predicate answers whether, and the question was how much.** Every fault here
comes from testing a guess instead of solving for the number. The fit predicate
was correct and useless: it could confirm a trim and could not rank two.

**One fault is left and is not this one.** Where the ball grows large enough to
swallow the whole inner edge, the crossing that anchors the neck flips between
the terminal and the contour's far end. It drives the remaining jumps under a
ball ratio or ball shape sweep.

## 42. Two bugs the detached flag exposed — fixes

Both reported on `_external/k.json`, on the third skeleton point's rib.

### 1. Problem

**A handle had a limit it should not have.** With the detached flag on, the
designer placed the handles where they wanted them. With the flag off, the same
placement was refused: 32 units asked, 7.77 honored, against 55 units of real
room.

**The detach toggle changed the shape by itself.** With a curvature set through
the gizmo, turning the flag on moved a handle 4 units. Turning it off moved it
back.

### 2. Solution

The first is a bound written in the wrong unit. The ceiling on handle length was
stored as a multiple of the coordinate scale and capped at 1, so it could never
pass that scale. Where a short real reach floors the scale and a backward handle
slide moves the drawn crossing far beyond it, the ceiling refused most of an
authored offset. A detached handle skips the domain entirely, which is why the
flag made the difference. The ceiling is now bounded by the drawn crossing and by
the absolute cap of twice the chord, and not by the scale.

The second is a pin counted twice. Detaching converts the handle's position into
an absolute placement, and it read that position off the screen — after the
curvature pin had been applied. The generator then applied the pin again to a
number that already carried it. Because the pin holds the segment's mean rather
than either handle, it answered the changed input with a different split. The
conversion now measures against a regeneration with this side's two segment pins
cleared, so it stores the construction rather than the screen. Re-attaching
measures the other way round, against a regeneration without this side's offsets,
because there both sides of the subtraction carry the pin and have to agree.

### 3. Result

Full suite 1,869 passing, with one existing solver test corrected: it asserted
the old cap, which is the bug written as an expectation. Entry 38 had already
recorded that cap as conservative and left it alone.

On the reported file the refused handle now moves one-for-one, and the detach
toggle is a round trip in both directions.

### 4. Challenges and findings

**The conservative note in entry 38 was the bug.** It was recorded as a
limitation of the backwards direction and dismissed, because the handle moved,
which was that report's complaint. It was a wrong unit, and it took a second
report to be read as one.

**One defect is left.** The detach conversion anchors the offset on the emitted
on-curve, which carries the on-curve nudge, while the generator anchors a
detached placement on the un-nudged rib point and adds the handle nudge. The two
agree only where the two nudges are equal. On the reported file both are 45, so
the fault is invisible there. Provenance already publishes both vectors.

## 43. The width distribution had three writers and two rules — fixes

Reported on `_external/one.json`, on a third skeleton point with a distribution
of 100.

### 1. Problem

**A rib drag on canvas overrode the distribution.** Setting the width through the
panel honored it. Dragging the rib applied the same delta to both ribs, which on
a 60/0 point answers a drag of 10 with 70/10 — a distribution of 75, where the
designer set 100.

**The panel would not refresh during its own drag.** Under a canvas drag the
total, left, right and distribution all followed live. Dragging the total in the
panel left the other three static until the mouse came off.

### 2. Solution

Preserving the difference between the two sides is not preserving the
distribution. Preserving the SHARE is. A linked write that names one side now
states a total through that side's share, which is the panel's total-width write
reached through one side. Unlinked, the two sides are independent and the write
states one.

One function carries that rule, and all three entry points go through it: the rib
gizmo on canvas, the panel's left and right boxes, and the label scrubs on both.
The same-delta rule survives for exactly one caller, the fixed-rib drag, where it
is the right statement — there one edge is held while the point follows the
cursor.

A side holding zero has no share, so it cannot state a total. That rib is pinned
on the centerline, and the drag refuses. Only the distribution or the total lifts
it off. This was the designer's own decision when asked.

For the panel: it blocked its own update for the whole duration of a field edit,
to stop a rebuild replacing the input under the hand. The block is now on the
rebuild alone. The values-only refresh runs, and it already leaves the active
field alone.

### 3. Result

Full suite 1,869 passing. Seven new tests: four on the rib executor and three
direct model tests, covering a linked drag at an asymmetric distribution, a zero
far side, a refused drag on a zero side, and an unlinked drag.

### 4. Challenges and findings

**A comment claimed the rule the code did not implement.** The shared per-side
writer said it preserved the distribution and preserved the difference. The
comment now names the edges, which is what that branch is for.

**The first fix touched the canvas path alone.** The panel was left on the old
rule, reasoning that changing its per-side meaning was more than the report
asked. That was wrong — the report asked for the two to agree, and one rule in
one place is the only way they cannot drift apart again. The designer said so.

**The editor-side halves owe a manual test matrix**, per rail R-G. Type into left
and right with the sides linked and unlinked, scrub both labels, drag both ribs
at a distribution of 100, and drag the total in the panel while watching the
other three fields.

## 44. Harmonize answered the wrong question — feature

Reported on `_external/skeletron.fontra` glyph `d`, at the joint between the
two cubic segments.

### 1. Problem

Harmonize was run and the curvature comb kept a deep notch at the joint. The
report said harmonized.

Two separate things, and the visible one was not a step in curvature.

The two curvature values agreed to 1.6 per cent, 0.005853 arriving against
0.005949 leaving. The radius differed by 2.77 units on 170.

What did not agree was the rate of change of curvature. It arrived falling at
0.0000404 per unit of arc and left rising at 0.0000497. The sign reverses, so
curvature has a local minimum exactly at the joint. Measured along the two
segments, the comb ran 0.009940 at the middle of the incoming one, 0.005853 at
the joint and 0.008408 at the middle of the outgoing one. The joint sat 41 per
cent below the hump behind it.

Matching two curvature values is G2, and G2 was already satisfied. The notch is
a G3 defect and no setting of the existing operation addressed it.

### 2. Solution

A second construction, tried first, with the old one as its fallback.

**G3 by the two inner handles.** The joint and both outer handles hold still.
Equal curvature and equal rate are two equations, and the two inner handle
lengths are two unknowns, so the answer is exact and unique. There is nothing
to iterate and nothing to choose between. It is Linus Romer's construction from
`_external/curvatura`, section 6.5 of its documentation, in the arc-length form
described below.

**The cascade.** G3 runs at every joint. Where it has no admissible answer the
joint drops to G2, which starts from the geometry as it stands. Two things make
an answer inadmissible. An inflection, where the construction asks for the
square root of a negative product. And an answer outside the two limits the G2
path already obeys, which are the cusp floor on the handle that shrinks and the
tangent intersection on the handle that grows.

**The repair slide**, between the two rungs and optional. Where holding the
joint still leaves no admissible answer, the joint slides along its tangent by
the smallest distance that produces one, and the two inner handles take the
rest. The search runs outward from zero, so a joint that does not need it does
not move. Its range is the far on-curve of either segment, measured along the
tangent, with each direction bounded separately.

**Two checkboxes replace the bias slider.** One picks the target and so the
cascade. The other says whether the joint itself may move. Under G2 that is the
whole of the old bias, and under G3 it turns the repair slide on. The values
between the slider's two ends were never asked for.

### 3. Result

On the reported glyph, with the whole-unit rounding the editor applies:

| run          | joint     | handles             | curvature step | rate step |
| ------------ | --------- | ------------------- | -------------- | --------- |
| as drawn     | 399, 598  | 412, 518 / 388, 670 | 9.65e-5        | 9.01e-5   |
| G2           | unchanged | unchanged           | 9.65e-5        | 9.01e-5   |
| G3           | unchanged | 410, 530 / 389, 659 | 5.91e-5        | 1.17e-6   |
| G3 and slide | unchanged | 410, 530 / 389, 659 | 5.91e-5        | 1.17e-6   |

The rate step falls by a factor of 77. The joint does not move, because this
one never needed the slide. Full suite 1,888 passing.

The editor side owes a manual matrix, per rail R-G. Harmonize a joint with each
of the four combinations of the two checks. Check that the G3 runs leave the
on-curve where it is. Check that an inflected joint still reports harmonized and
names G2 in the hover detail.

### 4. Challenges and findings

**The donor matches the rate per unit of parameter, not per unit of arc.** The
two segments run through the joint at different speeds, so equal rates in the
parameter leave a rate mismatch equal to the ratio of the two, which was 10 per
cent on the reported glyph. The curvature comb is drawn against arc length, and
arc length is what a designer reads. Solving for the arc-length rate is the same
shape of closed form, one square root and one division, and the two answers are
0.03 units of handle apart. The arc form is exact to machine precision on both
conditions.

**The first three answers about this joint were about a different geometry each
time.** The glyph was redrawn between the report and each measurement, and the
same joint was an inflection, then already harmonic to 1.5 per cent, then 38 per
cent out. Read the file at the moment of the question, and say which state the
numbers came from.

**G2 reports harmonized while writing nothing.** The correction on the reported
joint was 0.46 units, and whole-unit rounding discards all of it. That is a real
defect and it is not fixed here. A correction under half a unit should report
that it is below the grid.

**The slide's range cannot be bounded by the inner handles.** They are what the
construction replaces, so their present lengths say nothing about where the
joint may go. Bounding by them stopped the search 25 units short of the answer
on the overshoot fixture, where the first admissible slide is about 45 units and
the shorter inner handle is 20.
