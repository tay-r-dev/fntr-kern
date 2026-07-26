# Skeleton offset: constructed, not fitted

**Date:** 2026-07-26
**Status:** design, approved
**Scope:** the cubic-segment branch of outline generation in
`fontra-core/src/skeleton-generator.js`. Line segments, caps, corner rounding
and assembly are untouched.

---

## 1. The problem

Generated outline handles are not a continuous function of the skeleton.

Regeneration runs every frame during a drag. Moving a skeleton point by one
unit can flip the adjacent generated segments into a completely different
handle configuration — one that fits the curve equally well but looks nothing
like the previous frame's. The result is unusable for planning geometry: a
designer cannot predict where a generated handle will land.

It shows up at small scale specifically:

- when the distance between skeleton points is small relative to the rib width
- when the generated segment is small relative to the skeleton's handles

Both are the same condition in disguise: **offset distance approaching the
radius of curvature**, `d·κ → −1`. That is the cusp condition for an offset
curve — the point where the speed factor `λ = 1 + d·κ` reaches zero — and it is
where the current pipeline is worst conditioned.

This is a stability problem, not an accuracy problem. Each frame's output is
geometrically fine. It just isn't continuous in the input.

## 2. Why the current pipeline jumps

The cubic path is a stack of step functions. Every one of these makes a
discrete decision inside a continuous drag.

| # | Location | Discontinuity |
|---|----------|---------------|
| a | `fit-cubic.js:55` | When a solved handle length comes out ≤ ~0, **both** handles are discarded and replaced with `segLength/3` along the tangents. Negative alpha is common on short or shallow sample sets. This is the visible "handles snapped to a generic shape" jump. |
| b | `bezier.js:572` `reduce()` | Subcurve count changes discontinuously — extrema entering/leaving [0,1] (`:582`), the S-shape test in `simple()` (`:559-561`). The second pass walks t in **0.01 steps** (`:604`), so split points are quantized: continuous input, staircase output. And `return []` at `:610` returns from the `forEach` callback rather than from `reduce`, so a span that cannot be made simple is **silently dropped** — the offset path loses a piece. Fires when curvature is high relative to length. |
| c | `skeleton-generator.js:2313-2315` | The fit's sample set is 5 samples per subcurve at uniform *local* t. When the `reduce()` partition changes, every sample moves. Chord-length parameterization (`:2327`) then compounds it. |
| d | `fit-cubic.js:110-121` | Branch on `maxError < error*1000`, then up to 20 Newton reparameterizations with break conditions `maxError < error` and `prevMaxError - maxError < 0.5`. The number of iterations actually run is an integer function of the input; output jumps when it changes. |
| e | `skeleton-generator.js:2334-2352` | Adaptive threshold loop returns the first of ~7 thresholds (2%…15% of halfWidth) that passes. Which one passes is a step function; each yields a different curve. |
| f | `:2630-2633`, `:2788-2800` | Offset is computed at the **average** half-width, then endpoints are swapped for the true rib points and the handles **rigidly translated** by the delta. On a short segment that translation is a large fraction of the handle length. |
| g | `:2466-2467`, `:2893-2900`, `:2258` | Grid rounding at multiple stages. `lockNearZeroHandleDirection` snaps sub-1.25-unit handles via `getMinimumGridStepFromDirection`, which has only **8 possible directions**. |

Note also a dimensional inconsistency: `computeMaxError` returns **squared**
distance (`fit-cubic.js:148`) but is compared against a linear tolerance at
`skeleton-generator.js:2341` and `fit-cubic.js:105`. The debug field is already
named `actualErrorSq`. The effective tolerance is therefore sqrt-distorted and
scale-dependent, which is part of why behavior differs by size.

## 3. Rejected: porting to `outline()` / graduated outline

`offset()` (`_external/bezierjs/src/bezier.js:520`) is `reduce()` → `scale(d)`
per subcurve (`:549-554`). `outline()` (`:723`) is `reduce()` → `scale(d1)` /
`scale(-d2)` per subcurve (`:756`, `:787-788`). **Same core.** Porting to
`outline()` inherits discontinuity (b) unchanged.

`outline()` additionally returns a closed `PolyBezier` with line endcaps
(`:806-813`), which this codebase would have to tear apart — it builds its own
caps and corner rounding.

Graduated outline (`d3,d4`) is worse. It routes through the `scale(distanceFn)`
branch (`:703-719`), which places control points radially from the
normal-intersection point `o` and applies `if (distanceFn && !clockwise)
rc = -rc;` (`:711`). `clockwise` is a boolean from the sign of one angle
(`computedirection`, `:209-212`) that flips when P1 crosses the chord — a fresh
discontinuity, in exactly the regime this design targets.

The one idea worth taking from graduated outline is **per-endpoint distances**,
replacing the average-width hack (f). This design implements that directly in
closed form. It does not call `outline()`.

## 4. The construction

Offsetting a cubic preserves the tangent **direction** exactly:

```
O(t)  = P(t) + d·N(t)
O'(t) = P'(t)·(1 + d·κ(t))
```

with `N` the **clockwise** normal (`rotateVector90CW`, the convention this
codebase uses), `d` the signed offset distance positive along it, and `κ` the
standard signed curvature `cross(B′,B″)/|B′|³`. Direction identical, speed
scaled by `λ = 1 + d·κ`. Derivation: `dN_cw/dt = θ′·T`, so
`O′ = P′ + d·θ′·T = P′(1 + dκ)`. Independently re-derived and checked
numerically 2026-07-26.

For one-cubic-per-side output — already the topology contract — endpoints and
tangent directions are therefore known exactly, and the only free parameters are
two handle lengths. Those have a closed form too.

The rule a designer can hold: **the generated handle is the skeleton handle
scaled by (1 + width × curvature).**

### Direction is locked to the skeleton handle

**The current generator already locks generated handle direction to the skeleton
handle direction and fits only the length.** `lockNearZeroHandleDirection`
(`:2226-2236`) emits `anchor + ref·projectedLength` with
`ref = getSkeletonHandleDirection(...)`, unconditionally, on every generated
cubic handle — not only on short ones. This was mis-read as a degenerate-case
guard in an earlier draft of this spec; it is a behavior.

**That behavior is preserved.** Direction stays exactly as it is today. Only the
length changes, from fitted to constructed.

This was a deliberate choice (2026-07-26) over using the true offset tangent:

- Generated handles stay parallel to their skeleton handles, which is itself a
  predictability property — the feature's stated goal.
- The true offset tangent turns when the two end widths differ, by up to 37° on
  a strongly tapered stroke. That would move handle points by tens of units, not
  the unit or two a length-only change costs.
- It would also make `enforceSmoothColinearity` (§9, out of scope) active where
  it is currently inert: at a smooth skeleton point the two adjacent segments
  have different width gradients, so their generated handles would stop being
  colinear and the smoothing pass would rotate them — coupling segment A–B's
  handles to segment B–C's geometry and breaking the locality property in §7.

Accuracy where widths taper is recovered through the correction pass (§4.6),
which adjusts lengths, rather than through direction.

Revisiting the tilt is a separate, later change.

### 4.1 New module

`fontra-core/src/offset-cubic.js`. One pure function. No state, no `Bezier`
object construction, no history:

```js
offsetCubicSide({ p0, p1, p2, p3, d0, d3, q0, q3, u0, u1 })
  → { startLength, endLength }
```

- `p0..p3` — the skeleton cubic's control points
- `d0`, `d3` — the **signed** offset distance at each end, positive along the
  clockwise normal. The generator's left side is `+halfWidth`, right is
  `−halfWidth`, matching `projectPoint`'s sign argument.
- `q0`, `q3` — the projected rib endpoints exactly as today: **rounded**,
  already through `applyNudgeToRibPoint`. These are the endpoints of the curve
  that gets emitted, so they are the endpoints the construction must use.
- `u0`, `u1` — the locked handle directions (§4.3), unit vectors pointing into
  the curve from each endpoint. Supplied by the caller, which already computes
  them.
- returns the two handle **lengths** in float. The caller places each handle at
  `q + u·length` and rounds once at emission, as it does today (§5).

Returning lengths rather than positions is deliberate: the direction is
unchanged from today, so the length is the entire output delta and the interface
says so.

Same inputs produce byte-identical output, every frame. Nearby inputs produce
nearby output. That is the entire point.

`n0` and `n3` are **not** inputs. The corner-aware rib normals position `q0` and
`q3`, which the caller supplies; the construction uses the curve's own geometry.
One consequence, noted rather than fixed: where a corner normal or a
`forceHorizontal`/`forceVertical` override tilts the rib away from the true
perpendicular, the effective offset is `halfWidth·cos θ` and `λ` is slightly
over-estimated. No worse than today's average-width approximation.

### 4.2 Endpoint curvature

Direct from the derivative control points, avoiding reversal-sign ambiguity:

```
B'(0) = 3(P1−P0)      B''(0) = 6(P2 − 2P1 + P0)
B'(1) = 3(P3−P2)      B''(1) = 6(P3 − 2P2 + P1)
κ(t)  = cross(B'(t), B''(t)) / |B'(t)|³
```

### 4.3 Direction

`getSkeletonHandleDirection(segment, position, role)` — the same reference the
current code locks to, with the segment tangent as its fallback for a retracted
handle. Unchanged from today, bit for bit.

### 4.4 Handle lengths

```
L = h_skeleton · λ        λ = 1 + d·κ
```

where `h_skeleton` is the corresponding skeleton handle's length.

This is exact when the two end widths are equal: `|O′(0)| = |P′(0)|·λ` and
`|P′(0)|/3` is exactly the skeleton handle length.

With the direction locked, the width-gradient term drops out at the endpoints:
its contribution is along `N`, and `N` is perpendicular to the locked direction,
so it projects to zero. Taper is therefore handled entirely by the correction
pass (§4.6) adjusting lengths — not by tilting. This is why locking direction
costs so little: the gradient term never affected length in the first place.

Retires discontinuity source (f): widths enter per endpoint through `d`, not as
an average followed by a rigid correction.

### 4.5 Saturation

Two complementary bounds, one per side of a turn. Both smooth — a hard clamp
would be C⁰ but not C¹, leaving a felt "catch" when dragging through the
threshold.

**Inner side — cusp floor.** `λ = 1 + d·κ` crosses zero exactly at the cusp.
Smooth floor, C^∞ and monotone in λ:

```
λ_safe = ½(λ + √(λ² + 4c²))     c = 0.02
```

`c = 0.02`, not 0.05. The floor is never *exactly* inert — it shifts `λ` by
`c²/λ` — and at 0.05 that is 0.14 units on a 55-unit handle, which the emission
rounding would not absorb. At 0.02 it is 0.006 units. Set from that requirement,
not from taste.

**Outer side — tension ceiling.** Where the offset is on the outside of a turn,
`λ > 1` and handles lengthen. Bound them so they cannot overshoot the tangent-ray
intersection `I` (`calculateTunniPoint`, `tunni-calculations.js:103` — rail R-B,
do not recompute it):

```
a ≤ |I − P0|        c ≤ |I − P3|
```

applied as a smooth min. Use the **polynomial** form, not a p-norm:

```
smoothMin(a, b, w):  h = max(w − |a − b|, 0) / w
                     return min(a, b) − h²·w/4
```

The p-norm form an earlier draft specified returns `a/2^(1/n)` when `a = b` — a
16% shortfall at n=4 even when the bound is not binding, so it is never inert.
The polynomial form is **exactly** `min(a, b)` outside the blend window `w`, and
C¹ at the join (its derivative reaches ½ from both sides), which is what makes
"no saturation on ordinary input" an exact invariant rather than an approximate
one. Window `w = 0.15 × the bound being approached`.

**Bound per end, not the aggregate.** `calculateSegmentTension`
(`tunni-calculations.js:40`) computes `2ac/(ad + bc)`, which is the *harmonic
mean* of the two per-end ratios `a/b` and `c/d`. It can therefore read 1.0 while
one handle overshoots — `a/b = 1.5` with `c/d = 0.75` gives exactly 1.0.
Bounding each end independently is the constraint actually wanted, and since the
harmonic mean never exceeds the max, it **implies** `calculateSegmentTension ≤ 1`.
Bounding the aggregate instead would require an arbitrary rule for splitting the
reduction between the two ends.

This bound is a **guard, not a shaper** — see the measurement decision below.

**The limit needs a floor, not just smoothing.** Corrected 2026-07-26 after
review. The tangent-ray intersection can slide *backwards* onto the start point:
if the end tangent, extended backwards, passes through the start point, then the
intersection **is** the start point and `|I − P0| → 0`, so the bound drives the
handle to zero. One step further and the intersection lands behind the endpoint,
the bound goes inert, and the handle springs back. Measured on an ordinary
curve: the handle is squeezed to 0.6 units, then jumps 41.9 units.

This is not the ≥180°-turn edge case an earlier draft claimed. It is reachable
whenever a start tangent points near the far endpoint.

**Decision: measure before choosing a floor.** A floor ratio would be exactly the
kind of arbitrary constant the tension bound was adopted to *remove*, and the
review showed the bound may not earn its place at all:

- Offsetting a circular arc **preserves tension exactly** — larger radius, longer
  handles, longer chord, same ratio. So for the clean case the bound provably
  cannot bind, however thick the stroke. Analytically `rK + 0.54d < r + d` always.
- Every test written to exercise it in an earlier draft of the plan failed to
  trigger it.

So the bound is not a shaper — an earlier draft of this spec claimed it was
"active on the outer side of exactly the tight-turn configurations this design
targets", which is **wrong**. It is a guard against curvature varying sharply
*within* one segment.

Implement the bound with an activation counter and measure it over the fixture
corpus and `test-py/data/fonts/SkeletonRendering.fontra/`. Then:

- **Never fires** → delete the mechanism. The chord backstop already covers the
  guard role with a constant that is already in the codebase.
- **Fires** → the recorded configurations determine the floor, from data rather
  than taste. The candidate is `chord/3`, which at least has meaning: it is the
  handle length of a neutral cubic, and already the fallback in `fit-cubic.js`.

A floor shrinks the jump but does not remove it, so "delete" is the better
outcome if the data allows it.

**Chord backstop.** `calculateTunniPoint` returns null for parallel tangents.
The smooth min goes inert on its own as `|I − P0| → ∞`; keep a smooth ceiling
against `k·chord` as the always-defined backstop. Start `k` at 2.0, the value
`MAX_HANDLE_TO_CHORD_RATIO` already uses, applied as a smooth min rather than
the current hard clamp.

**Absolute minimum length — an existing guardrail, kept.** The cusp floor is
*relative* (`λ ≥ c`), so it cannot guarantee a usable handle: at `λ` near zero
the constructed length rounds to zero and emits an off-curve point coincident
with its on-curve point.

`getMinimumGridStepFromDirection` (`:2258`) is the current guarantee — a step of
one unit on X, one on Y, or one on both. Keep the guarantee; drop the mechanism.

With direction locked (§4.3), a smooth **floor of 1 unit on the length** gives
the identical protection: a unit-length step along any direction has at least one
component ≥ 0.71, so it always rounds to at least one whole unit on some axis.
That is precisely what the eight-direction snap was arranging by hand. Same
guarantee, no direction quantization, continuous — so discontinuity source (g)
goes away as a side effect rather than needing its own fix.

Together these replace `lockNearZeroHandleDirection`'s 8-direction snap and
`stabilizeSingleCubicHandles`' hard clamps.

**Ordering:** saturation runs *after* the correction pass (§4.6), not before.
The least-squares solve can push a handle past the intersection, so bounding
first would be undone. Every stage is smooth, so the composition is smooth.

### 4.5.1 Tunables

`c`, `n` and `k` are the only tunables, and all three are **code constants in
`offset-cubic.js` — not user-facing.** They act only in degenerate or extreme
configurations; a control that does nothing in ordinary use is a bad control,
and exposing a max-tension invites requests for tension > 1.

Testable invariant: **on non-degenerate input, no saturation fires.** If one
fires on an ordinary glyph, that is a bug rather than a tuning opportunity.

A designer-facing *target* tension for generated curves — a style parameter
acting everywhere rather than a ceiling — is a coherent separate feature and is
out of scope here.

### 4.6 The one correction pass

The closed form matches the true offset's position and first derivative exactly
at both ends when the two widths are equal — first-order contact, not second:
the constructed cubic's endpoint curvature also depends on the far control
point, which is not being solved for. It therefore drifts mid-segment when
`|d·κ|` is large, or when the widths taper. One fixed correction pass pins that
down without reintroducing any adaptive machinery.

Sample the true offset at five **fixed** source parameters
`t ∈ {⅛, ¼, ½, ¾, ⅞}`. Solve the two handle lengths along the already-fixed
directions from §4.3 by least squares, parameterized by the **source t** — not
by chord length of the sample set. Fixed sample count, fixed single pass, fixed
parameterization: continuous.

This is the linear algebra `generateBezier` already performs. But
`generateBezier` embeds fallback (a). So:

- Extract `solveHandleLengths(points, parameters, leftTangent, rightTangent)
  → {alphaL, alphaR}` from `fit-cubic.js`, containing the 2×2 solve and nothing
  else.
- `generateBezier` calls it and keeps its existing `segLength/3` fallback, so
  its current callers are unaffected.
- `offsetCubicSide` calls it and applies its **own** smooth fallback: a
  multiplicative band around the analytic value from §4.4, which is already
  correct to first order.

One copy of the geometry function (rail R-B).

### 4.7 Collapsed sides and single-sided contours

The collapsed-side rule is **preserved unchanged**. A side whose average
half-width is under 0.5 units copies the skeleton's control points verbatim
(`:2698`) rather than offsetting them. `projectPoint` and `applyNudgeToRibPoint`
have matching guards. This is what makes single-sided contours exact and is
listed as must-preserve in `SKELETON-FEATURE-MODEL.md` §5.

Single-sided mode sets one side's half-widths to exactly 0 at both ends
(`:1377-1392`), so the collapsed branch always fires and `offsetCubicSide` is
never called for that side. **Single-sided contours are unaffected by this
change.**

The 0.5 threshold is a **deliberate discontinuity** — below it the side lies on
the skeleton, at it the side is offset. Do not smooth it: the point of the rule
is exactness, and softening it would make single-sided approximate. It is the
one intentional step function in the pipeline, and §7 excludes it from the
continuity test.

Note for the implementer: the collapse test uses the *average* of the two end
half-widths, so a side tapering 0 → 0.9 counts as collapsed. Sub-unit, and
preserving current behavior is preferred over fixing it here.

**Tapered sides improve.** Today a side is offset at the average of its two
half-widths and the endpoints are corrected afterwards (§2 source f). The
construction takes both half-widths exactly (§4.3), so the wider the taper, the
larger the improvement. Same defect family as the small-scale instability this
spec targets.

## 5. Rounding

**Rib point rounding is not changed.** An earlier draft of this spec proposed
feeding the handle math an unrounded rib endpoint. That was wrong and is
withdrawn: the handle would then be anchored to a different origin than the
emitted on-curve point, which is written out rounded. The two would disagree by
up to a unit — worse than the half-unit it was meant to save.

The rule instead:

- `projectPoint` (`:2461-2469`) and `applyNudgeToRibPoint` (`:406`) are
  untouched. They still round, and they stay shared with the line-segment
  branch.
- `offsetCubicSide` computes the handle as a **vector** — direction and length —
  in exact arithmetic from the skeleton control points, widths and normals. The
  rib position is not an input to that calculation.
- The handle is placed at `roundedRibPoint + vector` and rounded once, as today.
  Origin and curve start agree by construction.
- The correction pass (§4.6) and the tension bound (§4.5) use the **rounded**
  endpoints, because those are the endpoints of the curve actually emitted. The
  fit then compensates for endpoint quantization rather than ignoring it.
- Stored detached-handle offsets keep their existing anchor, so nothing
  hand-placed moves.

Rounding was listed as discontinuity source (g) in §2. Only one part of it
matters here: `lockNearZeroHandleDirection` snapping sub-unit handles to one of
eight directions. That is already on the deletion list (§6), superseded by the
smooth saturation. On-curve rounding costs a bounded half unit and is the price
of grid-aligned coordinates, which is wanted.

Pipeline-wide round-once (caps, corner rounding, `outlineContourToPackedPath`)
remains the separate task already listed in `SKELETON-FEATURE-MODEL.md` §6.

## 6. Deletions

All in the cubic path, all superseded:

- `simplifyOffsetCurves` and its constants — `SIMPLIFY_OFFSET_CURVES`,
  `SAMPLES_PER_CURVE`, `MIN_ERROR_PERCENT`, `MAX_ERROR_PERCENT`,
  `ERROR_STEP_PERCENT`
- both `bezier.offset()` calls (`:2632-2633`)
- `stabilizeSingleCubicHandles` and `ENABLE_EXPERIMENTAL_HANDLE_STABILIZATION`
  — dead since the port, now superseded
- `lockNearZeroHandleDirection` and `getMinimumGridStepFromDirection` — verified
  2026-07-26: only callers are `:2853` and `:2860`, both in the cubic branch.
  **Both of its roles must be carried over first, or this is a regression.**
  Direction locking moves to the caller, which supplies `u0`/`u1` (§4.3); the
  guaranteed non-zero handle length moves into the module as a smooth 1-unit
  floor (§4.5). Its third role, the chord cap, is already in §4.5.
- `normalizeDirectionOrFallback` — all nine call sites are inside functions being
  deleted here, so it goes too.
- `fitCubic` in the `skeleton-generator.js` import list — its only uses are
  inside `simplifyOffsetCurves`. Remove it alongside `chordLengthParameterize`
  and `computeMaxError`, but **not** from `fit-cubic.js`, where it is exported
  and tested.
- The "fallback: use original curves without simplification" branch
  (`:2999-3160`) — already unreachable today, since `simplifyOffsetCurves`
  returns null only for an empty input, which is caught earlier at `:2731`.

Note the `:2731` empty-offset fallback currently emits **zero** handles, so an
`offset()` returning `[]` changes that side's point count. Removing it is a net
improvement to interpolation stability, not just a simplification.

`MAX_HANDLE_TO_CHORD_RATIO` is **retained** but demoted — it becomes the
always-defined backstop behind the tension bound (§4.5), and is applied as a
smooth min rather than the current hard clamp. It is currently read at `:2106`
and `:2851`; the first is inside `stabilizeSingleCubicHandles`, which is being
deleted.
- `alignHandleDirections` — dead since the port (both call sites commented out),
  and sits in this exact path. `SKELETON-FEATURE-MODEL.md` §6 already flags it.

`createBezierFromPoints` stays — other callers use it.

Removing `reduce()` (up to ~100 splits with a `simple()` test each, per curve per
side) and `fitCubic`'s up-to-7×20 Newton iterations is also a substantial
per-frame speedup.

## 7. Tests

### New — `fontra-core/tests/test-offset-cubic.js`

- **Circular-arc tracking.** Offsetting a Bézier quarter-circle by `d` yields
  approximately the `r±d` arc. **Not exact**, and the oracle must not assume it
  is: a Bézier quarter-circle is not a circle, and its endpoint curvature is
  `2(1−K)/(3K²r)` — about `0.0097855` at `r=100`, not `0.01`. Corrected
  2026-07-26 after review; an earlier draft asserted the circle's value and
  would have failed by 214× its own tolerance. Use the Bézier's own curvature as
  the oracle, or assert the round-trip invariant (offset by `+d` then `−d`
  returns the original) which holds exactly. Doubles as the sign-convention
  check — this code uses CW normals, bezier-js uses CCW.
- **Lipschitz continuity.** The property that is missing today. Over a grid of
  configurations including the pathological regime — short segments, `w·κ` near
  1, retracted handles — perturb each input coordinate by ε and assert every
  output coordinate moves by less than K·ε. **This test fails against the
  current code.** It is the acceptance criterion for the whole change.
  **Exclude the collapsed-side transition** (§4.7): the 0.5 threshold is an
  intentional step, and a continuity test that spans it fails for the wrong
  reason.
- **Collapsed sides.** A side under the threshold reproduces the skeleton's
  control points exactly. A single-sided contour's zero-width side is
  byte-identical to the skeleton, before and after this change.
- **Tapered sides.** A side with strongly differing end widths lands closer to
  the true offset than the current average-width path does.
- **Monotonicity sweep.** March a skeleton point 200 steps along a line; assert
  no handle-length jump above threshold.
- **Tension bound.** No generated handle overshoots the tangent-ray
  intersection, and `calculateSegmentTension` ≤ 1 **on segments with a forward
  intersection**. Scoped deliberately: where the intersection is absent or below
  the floor the bound is inert by design (§4.5), so the aggregate is not
  constrained there. The test must use a configuration where the bound actually
  binds — a quarter circle never does, since `rK + 0.54d < r + d` always. Use a
  short chord with a large outer-side offset.
- **Degenerate tangent triangle.** Sweep the end tangent through the start point
  and assert no jump. This is the case an earlier draft dismissed as a
  ≥180°-turn edge case; it produced a 41.9-unit jump on an ordinary curve.
- **No saturation on ordinary input.** Over a corpus of non-degenerate
  configurations, assert the tension ceiling, chord backstop and length floor
  are all exactly inert, and that the cusp floor perturbs `λ` by under 0.5%.
  Saturation firing on an ordinary glyph is a bug. Note the cusp floor is never
  *exactly* inert — it shifts `λ` by `c²/λ` — so its constant must stay small
  enough that the shift is well under half a unit on a normal handle.
- **Cusp regime.** `|d·κ| > 1` produces finite, bounded, non-flipped handles
  **of at least one unit**. The length floor is what this checks; without it the
  handle rounds to zero and emits an off-curve point coincident with its
  on-curve point.
- **End to end.** A `generateFromSkeleton`-level drag sweep, not just the module
  in isolation. The user-visible symptom lives downstream of the construction,
  past corner rounding, the smoothing pass and the surviving grid rounding — the
  module can be green while the drag still jumps. Note
  `test-skeleton-interpolation.js` does **not** cover this: its fixtures are
  two-point skeletons with no off-curve points, so they never reach the cubic
  branch.
- **Degenerates.** Zero-length handles, collinear control points, zero width,
  coincident endpoints, parallel end tangents (no Tunni intersection), and a
  tangent intersection lying behind an endpoint.

### Existing

- **The fixture script cannot regenerate these fixtures as it stands.** Found
  2026-07-26 in review. `tests/scripts/make-skeleton-generator-fixtures.js`
  imports the reference generator from `../../../../skeleton/…`, a path that does
  not exist — the donor lives at `_external/skeleton/`. Its
  `CAP_REFERENCE_COMMIT` is also not an object in this repo. And even with both
  fixed, it computes `expectedContours` **from the donor**, so running it would
  re-pin donor geometry and the suite would still fail.

  Fixing this is its own piece of work, not a step inside another task: the
  script must record forkra's output for the cubic path, or the suite must split
  into a donor-parity part and a forkra-baseline part.
- **The golden-master suite is currently titled "matches donor output". After
  this change it no longer does.** Retitle it and record the divergence in
  `SKELETON-FEATURE-MODEL.md`. The donor at `_external/skeleton` stays the
  behavioral reference for everything else; offset construction is now
  deliberately forkra's own.
- `test-skeleton-interpolation.js` must still pass. Point-count stability is
  preserved trivially — still exactly one cubic per side per segment.

### Expected output change

One-time, at the change. Not ongoing.

Endpoints do not move: both old and new pin them to the exact rib positions.
Handle **directions** do not move either — they stay locked to the skeleton
handle directions exactly as today (§4.3). Only handle **lengths** change, so
mid-segment deviation lands within the range the current fit already tolerates:
roughly 1–3 units at mid-segment for a 60-unit stroke, zero at the ends.

That estimate is only valid because direction is locked. With the true offset
tangent it would have been an order of magnitude larger on tapered strokes —
a 37° tilt on a 70-unit handle moves the handle point about 20 units.

`enforceSmoothColinearity` stays inert for the same reason. Locking direction
keeps generated handles colinear at smooth skeleton points, so the smoothing
pass has nothing to rotate — which is what preserves locality below.

Locality is unchanged from today. Moving skeleton point B affects segments A–B
and B–C and nothing beyond. Within A–B it does move the generated handle at the
A end, because endpoint curvature depends on the whole control polygon — but
proportionally and smoothly, which is the entire difference.

**Stored relative handle offsets shift.** A designer's non-detached handle
offset is stored relative to the *computed* handle, so it moves by the same
delta as its base handle. Detached offsets are anchored to the rib point and are
unaffected (§5).

## 8. Integration surface

Caller counts verified against the tree 2026-07-26.

**What changes:** the *length* of `adjustedHandle1` and `adjustedHandle2` at
`:2964-2977`. Their directions are unchanged. That is the entire output delta.

**Unchanged:**

- Generated handle directions — still exactly the skeleton handle directions
  (§4.3).
- `enforceSmoothColinearity`, which stays inert because of the above.

- Emitted point shape — `{x, y, type: "cubic"}` plus `_provenance` from
  `pointProvenance(…, side, "out"/"in")`.
- Point sequence per segment side — `[onCurve?] handle1 handle2 [onCurve?]`.
- `buildGeneratedOnCurve` and its corner metadata.
- Every `skeleton-generator.js` export: `generateFromSkeleton`,
  `generateContoursFromSkeleton`, `generateOutlineFromSkeletonContour`,
  `getPointWidth`, `getPointHalfWidth`, `getEffectiveNormal`,
  `calculateNormalAtSkeletonPoint`, `outlineContourToPackedPath`.
- `editSkeleton` (R-C), provenance emission (R-D / C3), selection kinds,
  `skeleton-generated.js` resolution, `applyHandleOffsetToControlPoint`.
- Corner rounding, caps, `enforceSmoothColinearity`, assembly, `reverseContour`.
- `skeleton-model.js`, `skeleton-modifiers.js`, `skeleton-tunni.js`,
  `skeleton-source-defaults.js`, all editor files.

**`fit-cubic.js` is additive only.** Importers: `path-functions.js:3`,
`skeleton-model.js:2`, `skeleton-generator.js:2`, `tests/test-fit-cubic.js:7`.
Adding `solveHandleLengths` and having `generateBezier` call it leaves
`generateBezier` — including its `segLength/3` fallback — behaviorally
identical, so `fitCubic` is identical and the other two importers are
unaffected. `test-fit-cubic.js` covers the refactor.

The alternative is a private 2×2 solve inside `offset-cubic.js` and no edit to
`fit-cubic.js`, at the cost of violating R-B.

## 9. What is not in scope

- Line segments, caps (butt/round/square/drop), corner rounding, assembly,
  `enforceSmoothColinearity`
- Pipeline-wide round-once
- Splitting the `skeleton-generator.js` monolith (defect P6)
- Any editor-side change. This is `fontra-core` only, so the mocha harness
  covers it and no manual test matrix is owed — though a visual check against
  `test-py/data/fonts/SkeletonRendering.fontra/` is worth doing.
