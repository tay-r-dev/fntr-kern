# Skeleton Curve Quality — Decisions of Record

**Date:** 2026-07-27
**Supersedes nothing.** Extends `2026-07-26-skeleton-offset-construction-design.md`, which
remains the spec for the closed-form construction itself. This document records what we
decided *after* that construction shipped and its curve quality was measured.

**Status:** step 1 done (`8adb3bb55`). Step 2 **withdrawn on measurement** — see §6.
Work order is at the end.

---

## 0. Why this document exists

The generated contour is functional but "too eager to collapse to minimum or maximum handle
length". Investigating that produced two corrections to earlier claims and a set of design
decisions that must not be re-litigated from scratch next session. Everything below is
either measured or explicitly chosen.

---

## 1. What was measured

Two sweeps, both fixing the endpoints (rib ends) and the handle directions (skeleton-owned),
leaving only the two handle lengths free — which is the actual degree of freedom the
generator has. Error is max distance from the true offset curve to the generated cubic,
against a numerically-found optimum for the same fixed endpoints and directions.

**Sweep A — synthetic, handle length as a fraction of chord.** 48 configurations.
Misleading: at shallow turn angles this invents skeletons nobody would draw (a 0.55·chord
handle on a 20° turn is already tension 1.03). Conclusions drawn from it about tension were
wrong. Recorded here only so the mistake is not repeated.

**Sweep B — realistic, parameterized by tension directly.** Tension 0.3–0.8 (a circular arc
is 0.5523), turns 15–75°, offsets 10–50% of the endpoint curvature radius, both sides.
149 configurations, of which 118 are geometry a single cubic can represent at all.

On the 118 representable cases:

| | mean error | hard-pinned at tension 1 | max tension wanted |
| --- | --- | --- | --- |
| current pipeline | 3.11 | 2 / 118 | 1.00 |
| with a reparameterized fit | 0.84 | 3 / 118 | 1.12 |
| numerical optimum | 0.67 | — | **1.04** |

---

## 2. Decisions

### D1 — Tension ≤ 1 stays as a ceiling. Not negotiable.

Tension above 1 is an abnormality in the intended use case. A circular arc sits at 0.5523;
tension 1 puts the handles on the tangent intersection, the fullest a cubic gets before it
distends. The measurement agrees: across the realistic sweep the accuracy optimum **never
asks for more than 1.04**.

*An earlier claim that the optimum wants tension 4–5 was an artifact of Sweep A and is
withdrawn.*

### D2 — The clamp is not the disease.

`tensionBoundStats.active` counts any touch inside the smooth-blend window, not hard
pinning. Hard pinning on realistic geometry is 2 of 118, not the "34%" that stat suggests.
The current pipeline still carries **4.6× the achievable error where nothing clamps at
all**. Fix the fit; leave the ceiling alone.

### D3 — Do not restore main's sample-and-fit path.

`simplifyOffsetCurves` on `main` ran bezier-js `.offset()` (variable curve count), sampled
it, and fed `fitCubic` inside an adaptive error-threshold loop. Four disqualifying
properties:

- the accepted threshold **jumps a step** when an input nudges, so output is not a
  continuous function of input — drag jitter, and two masters can land on different
  thresholds, breaking interpolation;
- `fitCubic`'s early bail (`prevMaxError - maxError < 0.5`) is a second discontinuity;
- endpoints are free samples, so generated on-curves do not land exactly on the ribs —
  this destroys provenance;
- variable curve count destroys point-count stability.

Dropping it was correct. **The mistake was keeping its interior — `solveHandleLengths` —
without the reparameterization that makes it meaningful, and clamping the result.**

### D4 — Fix the fit by reparameterizing, under a continuity contract.

`solveHandleLengths` is called once against samples at fixed `t`, which assumes the true
offset's point at `t` belongs at the generated curve's point at the same `t`. False for an
offset: it is stretched on the convex side and compressed on the concave one. The
correction therefore either does nothing (scale 0.98–1.05) or returns **negative** handle
lengths (α/analytic of −6, −30, −44, −83), which the clamps then convert into the
collapse-to-minimum.

The fix inherits D3's lesson as a hard contract:

- **fixed iteration count**, no convergence test, no early bail;
- **fixed seed** (the analytic λ construction);
- **no threshold search**.

Those three are exactly what made `main`'s version discontinuous. A fixed-trip-count
iteration from a fixed seed is a continuous function of its input; an adaptive one is not.

### D5 — Work in tension space, seeded from the skeleton.

The current path works in *length* space and converts to tension only at the end, to clamp.
That is why it can leave the valid domain at all. Instead: seed from the skeleton segment's
own tension, and shift both ends **simultaneously**. Tension ≤ 1 then becomes the edge of
the parameter rather than a patch applied afterwards.

The skeleton's tension is a **starting point, not a target and not a bound** — expansion
shifts tension in both directions and copying it outright measures worse than doing nothing
clever (mean 9.67).

Two primitives for this already exist and must be reused, not re-derived (rail R-B):

- `computeTunniHandleLengths(start, startDir, end, endDir, tension)` in the generator —
  tension in, two handle lengths out. Currently used for caps and necks; the offset path is
  the one place that ignores it.
- `calculateSkeletonControlPointsFromTunniDelta(..., preserveTensions = true)` in the model
  — already shifts both handles proportionally.

### D6 — Pipeline order: fit → equalize → harmonize.

Confirmed by the code's own reasoning: `equalizeJointSegments` notes that the donor's
trailing balance "perturbs the very curvature match harmonization just established", so
equalize must come *first*. Harmonize runs with `handleBias: 1.0` so the node never moves —
only the two inner handles slide along the shared tangent, which is precisely the freedom
available on a generated contour (rib positions are not ours to move).

Harmonize's `maxHandleTension: 1` default is consistent with D1 and stays.

### D7 — Equalize to the **maximum available**, never unconditionally and never as a snap.

Equalize forces a segment's two tensions together, which overrides the fit wherever
asymmetry is *correct* — asymmetric skeleton handles, or a tapering width. Measured optimal
tensions in asymmetric cases: 1.17/0.56 and 0.37/1.31, nowhere near equal.

So: equalize as far as the geometry allows, and no further. Not a snap to equal, not
skipped either.

### D8 — Two gizmos per generated segment, and they are different animals.

- **Curvature gizmo** — sits at **the centre of the generated curve** and changes its
  curvature. This is **not** the Tunni centreline gizmo; do not implement it as one. It is
  the "make this rounder / flatter" control, e.g. a more geometrically round inner contour
  of an *O* against a more oval outer.
- **Tunni point** — as on skeletons and basic points; controls **generated on-curve
  placement**, for when handle manipulation alone cannot reach the wanted geometry.

Gizmo density is a non-issue: these are independent visual layers.

Both have skeleton-side counterparts already in the model, to be generalized rather than
copied (R-B): `calculateSkeletonTunniPoint`, `calculateSkeletonTrueTunniPoint`,
`calculateSkeletonControlPointsFromTunniDelta`, `calculateSkeletonOnCurveFromTunni`.

### D9 — This gizmo mode becomes the default; z-shift becomes an opt-in override.

Flag lives on the skeleton panel.

### D10 — One stored state, two views. No independent storage, nothing to reset.

For a generated segment with rib endpoints and directions fixed, the entire available
freedom is: two handle lengths, plus one tangential slide per endpoint. z-shift exposes
those as raw per-point scalars (`handleOffsets`, `nudge`); the gizmos expose the same
numbers as two draggable points. **Same degrees of freedom, different affordance.**

Therefore: **store the deltas, derive the gizmos.** Already concept C4 ("derived handles are
gizmos") and rail R-C (one write path). A Tunni point is a pure function of the four control
points, so it is always recoverable — nothing to persist for it, nothing to reset on opt-out.

The panel flag selects which gizmos are drawn and how a drag is distributed: a **behavior
name** (rail R-F), not a data mode.

Rejected: independent storage (two sources of truth for one geometry; forces a precedence
rule; makes interpolation ambiguous about which a master reads) and "z-shift overwrites
tunnis, reset on opt-out" (destructive on toggle — flipping the flag to look at the other
mode loses work).

The only genuine difference is that a gizmo drag *distributes* a change across both handles
while z-shift edits one number. Both write the same fields. That is a distribution rule, not
a schema.

---

## 3. Known limit, not a bug to chase

31 of 149 realistic cases are geometry where a single cubic **cannot** represent the offset
— offset distance near half the endpoint curvature radius, i.e. a bold stroke on a tight
curve. Errors run into the hundreds for every strategy *including the numerical optimum*.
Point-count stability forbids splitting the segment, so no fit removes this.

This is very likely a large part of the collapse behaviour observed in the editor.

It is the strongest argument for D8: where the automatic answer cannot be right, hand it to
the designer rather than collapsing.

---

## 4. Open questions

- **Is the on-curve (Tunni) gizmo tangent-constrained or free?** Tangent-constrained is what
  `nudge` already does and keeps the neighbouring segment's endpoint valid — a generated
  on-curve point is a rib end shared by two adjacent generated segments, so moving it
  reshapes the neighbour too. Free movement does not preserve that. Undecided.
- What the curvature gizmo's drag axis is (curve normal at the midpoint is the obvious
  candidate) and whether it is clamped by D1 directly.

---

## 5. Work order

1. ~~**Fix the fit** (D4, D5).~~ **Done**, `8adb3bb55`. Mean error 3.11 → 0.89 against an
   achievable 0.67; hard-pinning 2 → 1 of 118; arcs unchanged. Implemented D4 only —
   reparameterization alone reached the target, so D5 (working in tension space) was not
   needed and is not implemented.
2. ~~**Equalize and harmonize passes** (D6, D7).~~ **Withdrawn.** See §6 — there is nothing
   at the joints for these passes to fix, and running them would destroy curvature steps the
   skeleton legitimately asks for. Replaced by the taper question in §6.
3. **Gizmos** (D8, D9, D10), once there is a good default for them to adjust.

---

## 6. Post-step-1 measurements: why step 2 was withdrawn

### 6.1 The 6% joint mismatch in the old work order was grid noise

The baseline quoted for step 2 (inner radii 152.9/161.6 against an ideal 160) came from a
5-point endpoint-curvature stencil applied to the **rounded** generated contour. Endpoint
curvature is a second-derivative quantity: jiggling each off-curve point inside its own
rounding cell (±0.5 in x and y) moves the implied radius over **136.9–156.3** on that same
joint. The 6% "mismatch" sits entirely inside that band. The stencil cannot resolve anything
at this scale and must not be used as a quality measure on rounded output.

Radial fidelity on the same geometry — max distance from the ideal circle — is 0.219 outer
and 0.402 inner. That is the trustworthy number, and it is good.

### 6.2 Unrounded, the joints are already right

Measured on `offsetCubicSide` directly, bypassing `Math.round`:

- **Arc skeletons, constant width.** Generated joint curvature is within **1.7%** of the true
  offset's on every case tried (R 90–300, turns 40–80°, both sides). Where the skeleton is
  exactly G2 the two generated sides agree to floating point — joint step is `1e-17`.
- **Arbitrary geometry, constant width.** Taking one cubic and splitting it at t = 0.5 gives
  two segments that are exactly G2 at the joint by construction. Feeding each half through
  the generator independently, the joint step is **0.0–0.9%** of the local curvature across
  round, shallow, tight, asymmetric and shoulder shapes.

So the generated contour already reproduces the true offset's curvature at joints. A
harmonize pass has nothing to remove there.

### 6.3 …and the mismatch that *is* there is the skeleton's, faithfully reproduced

On arcs of differing radius either side of a joint, the generated joint step runs up to
**80%** — and matches the true offset's own step to within 1.7%. That step is genuine: the
designer asked for two different curvatures. **Harmonizing would erase it.** Equalize has
the same problem, already noted in D7 for a different reason.

### 6.4 The real remaining defect is taper, and neither pass touches it

Max deviation from the true offset, one segment, after step 1:

| | constant width | tapered |
| --- | --- | --- |
| deviation | 0.11 – 0.49 | **3.6 – 14.4** |

Cause: the generated handle **axis** is pinned to the skeleton handle direction. On a tapered
stroke the true offset's tangent is not parallel to the skeleton's — it tilts by
`atan(d′ / speed)`, measured at **6°–79°** across realistic tapers (55/20, 70/10, 30/60,
−20/−55 against half-widths of 40). No handle *length* can compensate for a wrong direction,
and both equalize and harmonize only slide handles along the existing axis.

At constant width the tilt measures −0.01°, so this is exactly targeted: it changes tapered
strokes and nothing else.

Refitting handle lengths numerically for each axis choice, over 20 tapered cases:

| axis | mean deviation |
| --- | --- |
| pinned to the skeleton (current) | 6.65 |
| tilted per end, to the true offset's tangent | **0.44** |
| one shared tilt for both ends | 2.52 |

Per-end tilt brings tapered strokes to the same quality as constant-width ones. A single
shared tilt — the variant that would keep two adjacent generated segments trivially G1 at the
rib they share — recovers less than half the gain and is *worse than pinned* on two cases.

### 6.5 The decision this forces

Per-end tilt means the outline's tangent at a rib is no longer the skeleton's direction. Two
adjacent segments still agree at a shared rib whenever the width ramp's slope agrees across
it; where the designer changes the taper rate at a point, they would disagree and the outline
would corner there. That corner is geometrically honest — a stroke that tapers and then stops
tapering really does break — but it is a change to a property the outline has always had, and
it would make the `smooth` flag on generated on-curve points a lie unless it is recomputed.

**Undecided:** whether to take it. Blocking the taper fix.
