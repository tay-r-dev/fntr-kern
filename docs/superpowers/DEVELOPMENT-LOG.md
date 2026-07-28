# forkra Development Log

Running record of work done on `main` since the post-refactor baseline
(`df2076171`, 2026-07-24, "fork feature set squashed onto current upstream").

One entry per feature or fix, newest last. Each entry has the same four parts:

1. **Problem** — what was wrong or missing.
2. **Solution** — what we did, in plain language.
3. **Commits** — every commit that belongs to the entry, oldest first.
4. **Challenges and findings** — what went wrong on the way, and what we learned
   that isn't obvious from the diff.

Companion docs: `FEATURE-ARCHITECTURE-MAP.md` (what lives where),
`SKELETON-FEATURE-MODEL.md` (skeleton mental model), `specs/` (per-feature
design and implementation specs).

---

## 1. Curve harmonization (F9) — feature

**Branch:** `feature/harmonize` → merged to `main`
**Dates:** 2026-07-25 – 2026-07-26
**Specs:** `specs/2026-07-25-curve-harmonization-design.md`,
`specs/2026-07-25-curve-harmonization-implementation.md`

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

| Commit | Subject |
| --- | --- |
| `4df999813` | docs: add curve harmonization (F9) design spec |
| `0cbaf2174` | docs: split the two deferred skeleton items in the F9 spec |
| `fb956451d` | feat: initial implementation |
| `9dfe9f4ff` | fix(harmonize): write through setPointPosition, not a path assignment |
| `482a4158c` | feat(harmonize): report why each point was skipped or left partial |
| `1c4b24b50` | feat(harmonize): optional Tunni equalization, the pass that moves outer handles |
| `f72e9cebe` | fix(harmonize): drain the slider's valueStream, so the applied bias is the shown bias |
| `92f660621` | fix(harmonize): show the bias number; rename the slider end to "point" |
| `e479f706c` | fix(harmonize): apply the bias the slider shows, not the one the model stored |
| `c1f76ebe1` | feat(harmonize): cap each handle's tension at 1 so handles cannot cross |
| `aa1adcaa5` | feat(harmonize): pull an over-tension handle back under the ceiling |
| `251f96cd6` | feat(harmonize): round the moved points to whole units |

### 4. Challenges and findings

**Harmonization converges in one pass, at any bias.** The spec assumed
iteration was needed and that a handle-heavy bias would take more passes. It
doesn't. The ratio depends only on the perpendicular offsets of `PP` and `NN`
from the tangent line, and neither the joint nor the handles moving *along* the
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
`onFieldChange`.** It fires once at `dragBegin` with the *pre-drag* value; every
subsequent value arrives on a `valueStream` `QueueIterator`. So the setting we
stored was always one drag stale — the node kept moving in full-handle mode
because the code was reading bias 0.2 while the slider showed 1.0. Two fixes:
drain the `valueStream` in `onFieldChange`, and register getters/setters for
sliders in `ui-form.js` so the applied value can be read straight off the DOM.

**Chasing that bug took far too long** because the model was assumed correct and
the UI was assumed innocent. The user's console dump of the options object is
what settled it. When reported behaviour contradicts the math, instrument the
boundary between them first.

**`displayValue: true` is not a boolean.** It's a placeholder *string* that
blanks the number box (`range-slider.js:256-262`), so the box literally read
"true".

**Supertool moves more handles than its `harmonize:` method does.** The method
itself only moves the joint's immediate neighbours, but the Harmonize *command*
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
*removed* the point the two segments share — so you could never build a
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

| Commit | Subject |
| --- | --- |
| `f757a2e53` | fix(selection): make shift-clicking segments additive |

Files: `scene-model.js` (two return sites), `edit-tools-pointer.js`
(`toggleSegmentSelection`, applied only when the hit is a segment and the mode
is symmetric difference).

### 4. Challenges and findings

**The bug was in the selection *mode*, not the hit test.** `getSelectModeFunction`
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
