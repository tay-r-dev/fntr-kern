# Gizmo coherence, mirroring, and the generated-contour controls

Date: 2026-07-27
Status: plan

Covers five reported bugs, one scope restriction, and four interaction additions on
the generated-contour gizmos. The five bugs are not five problems: three are
independent and small, and two are the same structural fault seen from two sides.

Reference: `docs/superpowers/specs/2026-07-27-pinned-curvature-and-tension-equalization-design.md`
(D14–D20, the harmonic-mean identity, and the continuity contract this plan
inherits without change).

## Invariant this plan must not break

**A pinned curvature is permanent.** Once the curvature gizmo has set a number,
the generator reproduces that number on every regeneration, through skeleton
edits, width edits and taper edits, clamping only its output and never the stored
value (D14/D15). Every change below is checked against this. Part 2 moves the
space the pin is measured in; it does not weaken the pin.

---

# Part 1 — Three independent fixes

These touch nothing the gizmos rely on and can land first, in any order.

## 1.1 Mirroring drops the side swap

### Fault

Mirroring a skeleton goes through the skeleton point target entry in
`skeleton-editing.js`, whose `makeChangeForTransformation` writes only `x`/`y`
back onto each skeleton point (the synthetic-path behavior produces positions and
nothing else). Two things therefore never happen:

1. Stored handle adjustment vectors are not transformed. They are offsets in
   glyph space and need the linear part of the affine.
2. Per-side data is not swapped. A mirror has negative determinant, so the
   geometric left of the mirrored centerline is what the stored data calls right.

Reproduced: an open contour with `width {left: 20, right: 90}` at one end and
`{left: 60, right: 15}` plus a nudge at the other generates

```
expected (generate, then mirror):  -119,95  -158,253c -306,227c -348,61 ...
actual   (mirror, then generate):   -81,105 -143,352c -405,325c -464,91 ...
```

Swapping `width` and `nudge` by hand on the mirrored data makes the two agree
exactly (same point set, traversed in reverse — see "winding" below). That
confirms the swap is the whole fix for those fields.

`transformSkeletonData` in `skeleton-model.js` already does part 1 correctly and
is called from nowhere but tests. It is the natural home for the rule.

### Fix

Give `transformSkeletonData` the swap, and make the transform path of the
skeleton target entry use the same rule so there is one implementation (rail
R-B).

Swap when `affine.xx * affine.yy - affine.xy * affine.yx < 0`.

Per on-curve point, swap:

| field              | swap                                         |
| ------------------ | -------------------------------------------- |
| `width`            | `left` ↔ `right`                             |
| `nudge`            | `left` ↔ `right`                             |
| `locked`           | `left` ↔ `right`                             |
| `segmentCurvature` | `left` ↔ `right`                             |
| `handleOffsets`    | `leftIn` ↔ `rightIn`, `leftOut` ↔ `rightOut` |
| `capBallSide`      | `"left"` ↔ `"right"` (`"auto"` unchanged)    |

Per on-curve point, negate:

| field             | why                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capAngle`        | the square cap shifts `avgHW + angleShift` on the left and `avgHW - angleShift` on the right (`skeleton-generator.js` ~4381); reflection swaps which end leads |
| `cornerAsymmetry` | scales the left arm when negative and the right when positive (~957)                                                                                           |

Per contour, swap `singleSided` and `capBallSide` — but **only when every point of
the contour is in the selection**. These are contour-wide, and a mirror applied to
part of a contour cannot meaningfully swap them. With a partial selection, leave
them and note it in the deviations section of the spec.

Handle adjustment vectors get the linear part (`xx, xy, yx, yy`), never the
translation, both when swapping and when not.

Nudge magnitudes keep their sign. Verified empirically: the swap alone reproduces
the mirror exactly, including the nudged end.

`reversed` needs no change. Mirroring flips the winding of the generated outline
and swapping the sides flips the emission order back, so the mirrored generation
comes out with the same fill sense as the original. This is what the reproduction
above shows — the two point lists are reverses of each other, not different
shapes.

Out of scope: the `forceHorizontal` / `forceVertical` normal overrides. They are
axis-locked and survive an axis mirror unchanged; a general rotation already
mishandles them and that is a pre-existing, separate question.

### Verification

A script that, for a skeleton with asymmetric widths, nudges, handle adjustments
and a curvature pin, asserts that generating-then-mirroring and
mirroring-then-generating produce the same point set. Run it for a horizontal
mirror, a vertical mirror, and a plain rotation (which must NOT swap).

## 1.2 Rib reset leaves the curvature pin behind

### Fault

`resetSkeletonEditableRib` clears the side's nudge and both handle adjustments.
It does not clear `segmentCurvature`, which was added yesterday. A reset
therefore returns everything except the pinned curvature, and the shape keeps it.

### Fix

Clear this side's `segmentCurvature` in `resetSkeletonEditableRib`, alongside the
nudge and the handle adjustments.

Note the ownership rule so this reads correctly: a pin is stored on the skeleton
point where its generated segment **starts**, per side. Resetting a rib therefore
clears the pin on the segment leaving that point, not the one arriving at it.
That is the right scope for "reset this point's adjustments" — the arriving
segment's pin belongs to the point at its own far end and is that point's to
reset.

`resetSkeletonEditableRibHandles` (the handles-only variant) must **not** clear
the pin: the panel's "reset handles" is deliberately narrower.

Two callers inherit the fix and both want it: the panel rib reset, and the round
cap style, which resets both ribs when applied.

## 1.3 Floating circles

### Fault

`7008c78c1` hid the handle **lines** on generated contours while gizmo mode is on,
and deliberately kept the points — "they say where the outline is". For on-curve
points that is true. For off-curve points it is not: with the lines gone, they are
circles attached to nothing.

### Fix

In `visualization-layer-definitions.js`, extend the existing
`getGizmoHiddenContourIndices` suppression from the handle-line layer to the node
layers: on a suppressed contour, skip points whose type is off-curve; keep
on-curve points. Apply to `fontra.nodes` and, for consistency, to the hovered and
selected node layers (generated points are never in a `point/N` selection, so
those two are belt and braces).

The dashed curvature axis also contributes to the floating impression: it is drawn
from the curve out to the tangent intersection, which runs to the edge of the
canvas on a flat segment. Shorten it to a fixed-length stub in the same direction
— see 3.2, where the on-curve gizmo stops living at that intersection.

---

# Part 2 — One space for the whole handle-length pipeline

This is the substantial change and the one that fixes both "curve jumps after
on-curve adjust" and "moving on-curves shifts the off-curves".

## 2.1 The fault

Three independent things write a generated handle's length, in this order:

1. the offset fit (analytic construction + fixed correction passes + bounded
   equalization), in `offsetCubicSide`;
2. the pinned curvature, currently applied inside `offsetCubicSide` against the
   **rendered** (post-nudge) rib ends;
3. stored per-handle adjustments, applied afterwards in `addOffsetCurves` and
   projected onto the handle axis.

The gizmo measures its number off the **finished** path — after all three.

The on-curve gizmo writes step 3. It has to, under the current mechanics: the
generator translates each handle along with its nudged rib end
(`adjustedHandle1 = translateRibPoint(adjustedHandle1, startNudge)`), so the drag
stores an equal and opposite handle adjustment to hold the handle still.

So the moment the on-curve gizmo is touched, step 3 exists on that segment and
overwrites step 2. The number the gizmo reads is no longer the number the
generator reproduces. Consequences, all reported:

- **Grabbing the curvature gizmo moves the curve.** The grab writes the measured
  tension; the generator applies it at step 2 and step 3 then displaces the
  handles again.
- **The reachable range looks arbitrary.** The ceiling is computed against
  geometry that step 3 subsequently changes.
- **Off-curves move when on-curves are dragged.** Two reasons at once: the
  cancellation is projected onto the handle's own axis, so at a corner — where the
  nudge tangent and the handle axis differ — it is only partial; and the pin is
  re-satisfied against rib ends the nudge has just moved, which changes the
  lengths on top.

It only behaves when no on-curve has been touched, which is exactly the report.

## 2.2 The model

Per generated segment side, in the generator:

- `q0`, `q3` — construction rib ends: each skeleton on-curve projected along its
  corner-aware normal by its half-width. **Un-nudged.**
- `u0`, `u1` — handle unit directions, taken from the skeleton (D11).
- `T` — intersection of the rays `q0 + s·u0` and `q3 + s·u1`.
  `r0`, `r1` — signed reaches `q0→T` along `u0`, `q3→T` along `u1`. A reach that
  is not ahead of its own rib end is no reach (existing rule, unchanged).
- `L0`, `L1` — handle lengths along `u0`, `u1`.
- handle tensions `t = L/r`; segment tension `τ = 2·t0·t1/(t0+t1)`, the harmonic
  mean (spec §1).
- `n0`, `n1` — nudge displacement vectors, along the corner-aware tangent.

**Everything stored and every bound lives in this construction space.** The nudge
is a pure post-step applied to the emitted points and nothing else.

### The change

The nudge stops carrying the handle.

Emitted geometry becomes:

| point          | today             | after                 |
| -------------- | ----------------- | --------------------- |
| start on-curve | `q0 + n0`         | `q0 + n0` (unchanged) |
| start handle   | `q0 + u0·L0 + n0` | `q0 + u0·L0`          |
| end handle     | `q3 + u1·L1 + n1` | `q3 + u1·L1`          |
| end on-curve   | `q3 + n1`         | `q3 + n1` (unchanged) |

and the on-curve drag stops writing `handleCompensation` at all.

Net rendered geometry is **identical** to what the two mechanisms produce today
when they are working. The difference is that there is now one mechanism instead
of two that cancel, so nothing is stored to make the cancellation happen and
nothing downstream can defeat it.

Three consequences, and they are the fixes:

1. **An on-curve drag cannot move an off-curve.** The handle is emitted from
   un-nudged geometry and the nudge does not enter its expression. This holds for
   the neighbouring segment sharing the rib end too, and at corners, where the
   old cancellation was only partial.
2. **The nudge cannot push curvature past the ceiling on its own.** Sliding a rib
   end toward its handle by `n` reduces the reach to `r - n` and the length to
   `L - n`, and `(L-n)/(r-n) < 1` whenever `L/r < 1`. Under the old mechanics the
   length was preserved while the reach shrank, which is how a rendered tension of
   1.18 at nudge 20 and 1.48 at nudge 40 arose on an untouched segment — the
   measurements behind the round-2 fix. That whole pathology disappears.
3. **The pin becomes independent of the on-curve gizmo.** `q0`, `q3`, `r0`, `r1`
   do not depend on the nudge, so a pinned number reproduces to the same `L0`,
   `L1` whatever the on-curve gizmo has done. The pin is preserved _more_ strongly
   than today, not less.

### Pipeline order

Per segment side:

1. **Fit** — analytic `λ = 1 + d·κ` construction plus the fixed correction passes.
   → `L0`, `L1`. Unchanged.
2. **Equalize** — slide the two handle tensions toward each other under the fixed
   0.25-unit error allowance, holding `τ` exactly fixed. Unchanged, and still in
   construction space, which is where fidelity to the true offset is defined.
3. **Per-handle adjustments** — apply each stored handle offset and project onto
   the handle axis, yielding an adjusted `L`. **Moved earlier**: today this happens
   after the segment is built. Detached handles are absolute by definition and
   bypass steps 3 and 4 as they do now.
4. **Pin** — if the segment's start point carries a pin for this side, shift both
   handle tensions by one shared increment `δ` so their harmonic mean equals the
   pinned number, using construction reaches. Bisection on `δ`, fixed trip count,
   as today. Cap `δ` so neither tension exceeds 1, with headroom floored at zero
   so an end already past the ceiling blocks further travel up without being
   dragged down (D17 as amended).
5. **Bound** — minimum handle length and chord cap. A pinned segment keeps the
   existing bypass of the smooth tension ceiling so its number is not shaved twice.
6. **Emit** — handles at `q + u·L`, on-curves at `q + n`, then grid-round.

Steps 3 and 4 are orthogonal by the harmonic-mean identity: step 3 owns the
**split** between the two handles, step 4 owns the **magnitude**. Neither can
overwrite the other, which is the property the current ordering violates and the
whole reason for the restructure.

### What gets deleted

- the handle translation by the nudge in `addOffsetCurves`;
- `renderedQ0` / `renderedQ3` and the rendered-reach plumbing through
  `offsetCubicSide` and `shapeTensions`;
- `handleCompensation` in `calculateGeneratedOnCurveEdits` and its apply branch in
  `tunni-interactions.js`.

## 2.3 Plumbing: the gizmo measures on screen, stores in construction space

The curvature gizmo reads the path, which carries nudged on-curve points. It must
store a construction-space number. The conversion is exact and needs one new piece
of published data.

**Publish the nudge vector on on-curve provenance entries.** `pointProvenance`
gains `nudge: {x, y}` for `role === "onCurve"` (omitted when zero). Handles need
nothing: they are already emitted un-nudged.

The curvature drag then reconstructs the construction quad:

```
q0 = path[0] - provenance[0].nudge
h1 = path[1]                       (already un-nudged)
h2 = path[2]                       (already un-nudged)
q3 = path[3] - provenance[3].nudge
```

and runs the existing delta → increment → tension math on it.

**Axis and scale.** The drag axis stays the one drawn on screen — the direction
from the rendered curve's midpoint toward the rendered tangent intersection —
because that is the line the pointer is following. The scale that converts a
dragged distance into a tension increment uses the **construction** reaches,
`2·dot(delta, axis) / (r0 + r1)`, because that is the space the increment is
applied in. The two axes coincide exactly when the nudge is zero and differ only
slightly otherwise; the control stays monotone and smooth either way.

**Grab is a no-op** by construction: at zero delta the increment is zero, the
construction lengths are unchanged, and the measured `τ` equals the stored one.
The residual is grid rounding only — the ~1 grid step at non-smooth ends already
documented in spec §8.3, which is not removable without making the output
discontinuous in the skeleton.

**The ceiling reaches 1 again.** Because construction tensions no longer move with
the nudge, headroom is genuine at every nudge and the control's felt range is the
same everywhere. That is the "arbitrary limits" report.

## 2.4 Spec consequence

This reverses the round-1 decision to measure the pin in rendered space (spec
§7.1 / §8). That decision was correct under the old mechanics, where the nudge
moved handles and construction-space pinning made a pinned segment jump and
collapse the moment the on-curve gizmo was touched. Once the nudge stops moving
handles the conversion is exact in both directions, and construction space is
strictly better: it makes the pin independent of the on-curve gizmo instead of
coupled to it.

Amend the spec: mark §7.1 and §8's rendered-space decision superseded, and record
the new one — one canonical space, nudge as pure post-step, four ordered stages
with split and magnitude orthogonal.

## 2.5 Verification

By measurement, not by tests written after the fact.

- Grab-at-zero movement, at nudges 0 / 20 / 40, at a smooth junction and at a
  plain cubic. Target: zero at smooth junctions, ≤ 1 grid step elsewhere.
- Handle positions before and after a full on-curve drag: byte-identical, on a
  segment with a pin, on one without, and at a corner.
- The same for the neighbouring segment's handle at the shared rib end.
- Pinned number held across a skeleton-handle sweep, a 3.5× width change, and a
  nudge sweep — the D14 invariant, re-measured under the new space.
- Curvature control reaching exactly 1.000 at nudges 0 / 20 / 40, with both
  handles stopping together.
- Continuity: a 6000-step parameter sweep with a max step under one grid unit.
- `npm test` green.
- Generator fixtures: unchanged for every fixture without a nudge. The two nudged
  fixtures (`asymmetric-editable-nudge`, `nudged-cubic-endpoints`) change by
  design and are regenerated; diff them by hand first and confirm the change is
  the handle no longer riding along.

---

# Part 3 — On-curve gizmo scope and placement

## 3.1 Only at straight-adjacent ends

### Rule

An end of a generated segment may be nudged only if the skeleton segment on the
**far** side of that end — away from this segment — is a straight line, or does
not exist because the skeleton contour ends there. If a curve is attached, that
end holds.

### Implementation

Each end maps to a skeleton on-curve point through provenance
(`skeletonContourId`, `skeletonPointId`). Resolve it, find its index in the
skeleton contour, and take the neighbour on the far side. Which neighbour is
"far" follows from the segment's orientation, which is already read off the roles:
`provenance[1].role === "out"` means the generated segment runs in skeleton order,
so index 0's far neighbour is the previous skeleton segment and index 3's is the
next; the right side is emitted backwards and the two swap.

"Straight" means the neighbouring skeleton segment carries no off-curve points
between its two on-curves.

### Behaviour

- Both ends movable: the control spreads as it does now.
- One end movable: the whole spread goes to that end. The control becomes
  "extend or retract this end", the existing handle-inversion limit applies to it
  alone.
- Neither end movable: the gizmo is not drawn and not hit-tested for that segment.
  A drawn control that cannot move is worse than no control.

## 3.2 Placed outside the glyph

### Fault

The on-curve gizmo sits at the segment's tangent intersection. On a flat segment
that runs off toward infinity — a marker with no visible relationship to the curve
it belongs to, and part of what reads as floating.

### Fix

Anchor it at the segment's midpoint (`t = 0.5`) displaced along the **outward**
normal.

- Outward normal: the unit normal at `t = 0.5`, oriented away from the filled
  side. The fill side follows from the generated contour's signed area, computed
  once per contour, so counters come out correct (outward is into the hole, which
  is outside the glyph).
- Offset: a screen-space constant, so it holds a steady distance at any zoom. The
  drawing layer already receives screen parameters converted to glyph units; the
  hit test receives a glyph-space hit radius from the pointer tool and gains an
  explicit offset option computed the same way.
- One placement function, called by both the drawing layer and the hit test, so
  they cannot disagree about where the control is (rail R-B).

The curvature gizmo stays on the curve at `t = 0.5`. Its dashed axis becomes a
fixed-length stub in the tangent-intersection direction instead of a line drawn
all the way out to it.

Hit-test order: the on-curve gizmo is now off the curve and the curvature gizmo on
it, so they no longer compete. Keep on-curve first anyway.

---

# Part 4 — Interactions

All four hook into `edit-tools-pointer.js`. Note the ordering trap: the generated
gizmo branch runs **before** the general double-click dispatch and before the
existing ctrl+shift+click branch reaches it, so both new gestures are handled
inside that branch rather than in the general paths.

## 4.1 Ctrl+Shift+click on the curvature gizmo — equalize handles

Set both handle tensions equal while leaving the segment's curvature exactly where
it is: both go to the segment's harmonic mean `τ`, so the number the curvature
gizmo owns does not move. This is the `amount = 1` case of the equalization the
generator already performs under an error allowance.

Stored as per-handle adjustments on the two owning skeleton points and roles:
`offset = u·(L_target − L_current)`, added to whatever adjustment is already
there. Pipeline step 3 consumes them, step 4 leaves the mean alone, so the result
is stable under regeneration whether or not the segment is pinned.

No-op when the two tensions are already equal within tolerance, mirroring the
existing skeleton Tunni equalize.

## 4.2 Ctrl+Shift+click on the on-curve gizmo — equalize the reaches

Make the tangent intersection equidistant from the segment's two on-curve points.

The control already has exactly this one degree of freedom: it moves one end by
`−s` and the other by `+s`. So `s = (r0 − r1) / 2` measured on the rendered curve,
with the existing orientation sign, is the closed-form answer — no search.

Subject to 3.1: with one end held, the whole correction goes to the movable end;
with both held, no-op. The existing handle-inversion limit still applies.

## 4.3 Double-click to reset

Handled inside the gizmo branch, before the drag starts.

- **Curvature gizmo**: clear the segment's pin for this side and remove the
  per-handle adjustments on both of the segment's handles. The segment returns to
  exactly what the fit produces. This is the affordance to clear a pin that spec
  §6.4 recorded as missing.
- **On-curve gizmo**: zero the nudge on both of the segment's rib ends for this
  side.

Each is one undoable edit applied across every edited layer, the same shape as
the drags.

## 4.4 Naming

Undo labels describe the effect, never a donor control's name: "Equalize Generated
Handles", "Equalize Generated On-Curves", "Reset Generated Curvature", "Reset
Generated On-Curves". New strings go through the translation table.

---

# Order of work

1. **Part 1** — mirroring, rib reset, floating circles. Independent, low risk,
   ship first so the mirror fix is not entangled with the restructure.
2. **Part 2** — the pipeline restructure. Stop here and get it verified in the
   editor before anything is built on top; both previous rounds of regressions
   were found in the running app, not by any check run here.
3. **Part 3** — straight-adjacent restriction and outward placement.
4. **Part 4** — the four interactions.

# Testing policy

No tests are written after the implementation they would confirm. Existing suites
must stay green and fixtures must stay byte-identical except where Part 2 changes
nudged output by design. Everything else is verified by measurement scripts whose
numbers are reported, and finally by the editor.
