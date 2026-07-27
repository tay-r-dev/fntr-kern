# Pinned Curvature and Tension Equalization — Design

**Date:** 2026-07-27
**Extends** `2026-07-27-skeleton-curve-quality-decisions.md`. Amends **D10** and
**reopens D6/D7**, both of which that document closed. Everything else there —
notably **D1** (tension ceiling 1), **D11** (handle direction is skeleton-owned)
and the continuity contract from **D4** — stands unchanged and constrains this
work.

---

## 0. The two defects

**Defect A — an adjusted curvature does not survive a skeleton edit.**
The curvature gizmo writes a _positional_ handle offset: a stored x/y
displacement from wherever the generator placed the handle. Change the skeleton,
the width or the taper afterwards and the base handle moves, the stored
displacement does not, and the curvature the designer set drifts. The designer
set a _number_; the model stored a _nudge_.

**Defect B — no attempt is made to balance the two handle tensions.**
D6/D7 were withdrawn after measurement, on the reading that equalizing trades
offset fidelity for balance. That reading was too coarse: the measurement snapped
straight to fully-equal, which is the far end of the available travel, and
reported its cost (0.38 → 1.26 deviation, 3.3×) as though it were the only
option. The near end of that travel is close to free.

## 1. The fact that unifies them

For a cubic segment, the segment's Tunni tension is **exactly the harmonic mean
of its two handles' individual tensions**.

With `T` the tangent-ray intersection, `a = |P1P2|`, `b = |P1T|`, `c = |P4P3|`,
`d = |P4T|`, the code's canonical tension is `τ = 2ac / (ad + bc)`. Writing
`t₁ = a/b` and `t₂ = c/d` gives

```
τ = 2·t₁·t₂ / (t₁ + t₂)
```

Verified against `calculateSegmentTension` to floating point.

So a segment's two handle lengths decompose into two independent quantities:

- the **magnitude** — the harmonic mean, which is what the curvature gizmo
  controls and what defect A is about;
- the **split** — how the two tensions sit either side of that mean, which is
  what defect B is about.

They are orthogonal. Fixing one does not disturb the other, and the two fixes
compose in a single pipeline without a precedence rule between them.

## 2. Decisions

### D14 — The curvature gizmo pins a number, not a displacement

A curvature drag stores the **segment tension** it arrived at. Regeneration
reproduces that number, whatever the skeleton has done in between.

Absolute, not relative to the generator's own fit: the fit is fully overridden on
a pinned segment. "Regardless of skeleton configuration" is the requirement.

### D15 — Unreachable pins clamp; they never release

Where the geometry cannot express the stored number — the D1 ceiling, the
one-unit handle floor, a collapsed side — the **output** is clamped to the
nearest reachable value. The **stored number is never rewritten**. When the
skeleton moves back into range the segment returns to exactly what was set.

Corollary: nothing in generation ever writes to this field. Only a drag does.

### D16 — The pin is per segment per side, keyed by the segment's start point

One number for one generated cubic. Stored against the skeleton segment's start
point id together with the side, which is direction-independent — the right-side
contour is emitted backwards and its segments carry `in` before `out`, so keying
on emission order would address the two sides inconsistently.

### D17 — The ceiling stays at 1

Unchanged from D1. A drag cannot produce a pin above 1, so a clamp on
regeneration only ever means the skeleton moved under a legitimately-set value.

**Amended by §8.2.** The second clause is false: a nudged rib end shortens the
reach without moving its handle, so a segment can render above 1 untouched, and a
drag on it records that. The ceiling limits where a drag may go; it never pulls a
curve back to satisfy itself, and storage does not clamp to it.

### D18 — Equalize the split, holding the mean, under a fixed error allowance

Walk the two handle tensions toward each other with their harmonic mean held
fixed, and stop when the segment's maximum deviation from the true offset has
grown **0.25 units** beyond the fitted best, or at fully equal, whichever comes
first.

Absolute units, not a ratio, chosen deliberately: it is meaningful against the
0.11–0.49 total deviation constant-width segments currently show, and it is noise
against the 3.6–14.4 that tapered ones show under D11. Equalization therefore
acts on constant-width strokes and goes quiet on tapered ones. That is the
intent — do not spend accuracy where D11 has already left none to spare.

The existing correction band (0.25×–4× the analytic handle length) is **not** an
error allowance and must not be reused as one. It bounds where the solver's
answer may land relative to the analytic construction; it says nothing about how
much deviation is acceptable.

### D19 — The walk obeys the existing continuity contract

Concretely: parameterize the split by `s ∈ [0, 1]`, `s = 0` the fitted split and
`s = 1` fully equal, with the harmonic mean held fixed along the way. Deviation
grows monotonically enough in `s` that a **fixed number of bisection steps** on
"deviation ≤ fitted + 0.25" lands on the stop point. Fixed count, taken every
time, whatever the answer — never "iterate until".

Fixed trip count, fixed seed, no convergence test, no early bail, no threshold
search — the same four properties that made D4's fit a continuous function of its
input, and whose absence disqualified `main`'s sample-and-fit path (D3). A drag
must not jitter and two masters must not land on different answers.

### D20 — D10 is amended: two stored things, stacked in a stated order

D10 ("one stored state, two views") said the gizmo and the raw-handle mode write
the same fields and differ only in affordance. That is no longer true, and cannot
be: a number that survives skeleton edits is by definition not a positional
offset.

After this change there are two stored things and they **stack**:

1. the pinned segment tension (written only by the curvature gizmo),
2. the positional handle offsets (written by the raw-handle mode, and by the
   on-curve gizmo's `nudge` as before).

The positional offsets apply **on top of** the pinned result. Neither destroys
the other; flipping modes still loses no work. What is lost is the property that
the two modes are the same edit seen twice.

The curvature gizmo stops writing handle offsets entirely. Existing documents are
not migrated: their handle offsets simply remain as positional offsets with no
pin, which is what they already are.

## 3. Pipeline

Inside the per-side offset construction, which is where the geometry needed to
compute a tension already exists:

| Step | What it does                                                                                                                                                                                | Status    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1    | Closed-form construction plus one correction pass → two handle lengths                                                                                                                      | unchanged |
| 2    | **Equalize the split** (D18, D19) — hold the harmonic mean, walk toward equal, stop at the allowance                                                                                        | new       |
| 3    | **Apply the pin** (D14, D15) if the segment has one — rescale both handles so the harmonic mean equals the stored number, keeping step 2's ratio; clamp at tension 1 and the one-unit floor | new       |
| 4    | Bounds, positional handle offsets, direction projection, grid rounding                                                                                                                      | unchanged |

**Step 2 precedes step 3** because equalization chooses the split and the pin
sets the magnitude, and the pin must win. Step 2's error allowance is measured
against the fitted curve, which only has meaning before the pin overrides it —
and once a segment is pinned the offset-fidelity argument no longer applies at
all, because the designer overrode it deliberately.

**Step 3 preserves step 2's ratio.** Rescaling two tensions by a common factor
scales their harmonic mean by the same factor, so hitting a target mean while
holding the ratio is a closed-form division, not a search.

**Rounding.** A drag computes the pin from the finished, rounded path geometry;
generation reproduces it before rounding. The two therefore differ by sub-unit
amounts, on the same order as every other rounding effect in this pipeline
(§3 of the feature model). This is accepted and is not to be closed by rounding
the pin or by re-deriving it from rounded output — the latter is the
length-dependent-direction trap the feature model warns about.

**Point-count stability is unaffected.** Only handle lengths change.

## 4. Components

Each unit below has one job and is testable without the others.

**Tension algebra** — in `tunni-calculations.js`, beside the existing tension
code. Converts between a pair of handle lengths and the (mean, split) pair, both
ways. Pure functions of four points. One copy (R-B): the drag, the generator and
the tests all use these and must not each derive their own.

**Equalization** — in `offset-cubic.js`, applied to the corrected lengths. Needs
the true-offset sampler that already exists there for the correction pass, so it
adds no new geometry machinery. Fixed-trip-count walk per D19.

**Pin application** — also in `offset-cubic.js`, taking the stored number as an
optional input to the side construction. Absent means today's behavior exactly,
which is the regression test for the whole change.

**Storage and accessors** — in `skeleton-model.js`, alongside the handle-offset
accessors, normalized like every other stored field. Get, set, and clear.

**The drag** — in `tunni-interactions.js`. The curvature drag computes the
resulting segment tension and writes the pin, instead of computing two positional
offsets. It keeps its existing provenance-addressed refusal behavior: no
provenance, no edit (R-D).

**Clearing a pin** — a context-menu action on the curvature gizmo, "Reset
curvature to automatic". The plan must confirm this against the editor's existing
context-menu plumbing before committing to it; if generated-contour gizmos have
no context menu today, the panel is the fallback.

## 5. Testing

- **Equality identity.** The harmonic-mean relation holds against
  `calculateSegmentTension` across a spread of segments, including ones whose
  tangent rays meet behind an endpoint.
- **Pin survives a skeleton edit.** Set a pin, then move the skeleton point,
  change the width, and taper the width. The regenerated segment's tension equals
  the stored number each time.
- **Pin clamps without being rewritten.** Drive the skeleton until the pin is
  unreachable, assert the output clamps, then restore the skeleton and assert the
  original number returns exactly.
- **Equalization is inert where it should be.** Symmetric geometry already has
  equal tensions; the change must move it by nothing. Tapered geometry must move
  by nothing, since the allowance is noise there.
- **Equalization does not exceed its allowance.** Across the asymmetric cases in
  §6.6 of the prior spec, deviation grows by at most 0.25 units — and the split
  is measurably more equal than before.
- **Continuity.** Extend the existing perturbation and 200-step drag sweeps to
  cover a pinned segment and an equalized one. No jumps.
- **No pin, no change.** The full existing generator fixture set must be
  reproduced byte-for-byte with equalization disabled, isolating step 2's effect
  from step 3's. With it enabled the fixtures shift on asymmetric cases and are
  regenerated — deliberately, as a reviewable diff, and only after the
  byte-identical run has passed.

---

## 6. As built

Three things the design did not anticipate, recorded so they are not rediscovered.

### 6.1 The generator does not see canonical skeleton points

`canonicalToGeneratorInput` translates every point into a flattened shape —
`leftWidth`, `leftNudge`, `leftLocked` — before generation. A new canonical field
is therefore invisible to the generator until it is copied across explicitly, and
the model's own accessor cannot be used on the far side of that translation.

This failed silently: the pin stored, read back correctly through the model
accessor, and did nothing at all, because the generator read `undefined` on every
segment. Any future per-point field has the same trap. The pin travels as
`leftSegmentCurvature` / `rightSegmentCurvature` and is read directly off the
generator point.

### 6.2 Preserving the split bounds which pins are reachable

Step 3 scales both tensions by a common factor, so the ratio between them is
fixed and the larger tension hits the D1 ceiling first. Where the fit leaves a
very lopsided split — a heavy stroke on the concave side, where the inner handle
is already at the one-unit floor — the reachable range of the harmonic mean is
much narrower than `(0, 1]`, and a pin outside it clamps.

This is correct under D15 and not a defect: a drag can only ever store a number
it actually reached on real geometry, so a clamp always means the skeleton moved
afterwards. It does mean a pin is not reachable at every width, which is visible
on strokes heavy enough to collapse a side.

### 6.3 Measured effect of equalization

Handle-tension spread, fitted split → equalized split, at half-widths 15 and 40:

| shape                    | fitted | equalized |
| ------------------------ | ------ | --------- |
| round arc                | 0.000  | 0.000     |
| shallow                  | 0.000  | 0.000     |
| asymmetric handles, d=15 | 0.040  | 0.019     |
| asymmetric handles, d=40 | 0.017  | 0.000     |
| shoulder, d=15           | 0.106  | 0.094     |
| shoulder, d=40           | 0.230  | 0.218     |

Symmetric shapes are untouched to floating point. Mild asymmetry closes by half
or fully. The shoulder — whose asymmetry is faithful to the skeleton, and the
case §6.6 of the prior spec measured a 3.3× fidelity loss on — barely moves,
which is the allowance doing its job.

Three golden-master fixtures shifted, all on asymmetric geometry. With the walk
disabled the full fixture set reproduces byte-for-byte, so the fit itself is
untouched and the whole diff is equalization.

### 6.4 Not implemented: clearing a pin

There is no affordance for returning a pinned segment to automatic. The gizmo can
always set a new value, so a pin is not a trap, but "undo my override" is
currently only reachable through edit history. The context-menu action §4
proposed was not built.

---

## 7. Corrections after first use

The first implementation broke the control in three visible ways. All three trace
to two mistakes, recorded here because both are easy to make again.

### 7.1 D14 amended — the pin shifts both tensions, it does not scale them

Reproducing a pinned mean by scaling both tensions by a common factor preserves
their ratio, and a preserved ratio caps the reachable mean at `2r/(1+r)`: 0.6 on
a 0.3/0.7 split, 0.4 on a 0.2/0.8 one. The control therefore stopped at a value
that was neither 1 nor stable — it moved whenever the geometry moved.

It is also not what the drag does. The drag adds one shared increment to both
ends; reproduction must do the same or the number cannot round-trip.

**Corrected:** one shared increment, solved by fixed-count bisection.

**Superseded again by §9.** Live verification established that stopping both
ends at the leading handle was the defect: the trailing handle must remain
responsive until it reaches tension 1 too.

### 7.2 D15 amended — the pin is measured and applied in rendered space

**Superseded — see §8.** This was the necessary correction while nudges carried
handles, but that coupling has since been removed.

The offset construction works with the rib ends it computes; the finished contour
has them slid along their tangents by each point's nudge. A nudge moves an
endpoint together with its handle, so handle _vectors_ are untouched but the
tangent intersection is not — the tension either side of a nudge is a different
number.

The pin was read off the rendered curve and applied to the constructed one. After
any use of the on-curve gizmo, grabbing the curvature gizmo therefore jumped, and
where the demanded length fell under the floor the handles collapsed to it and
the drag continued from there.

**Corrected:** the construction takes the rendered rib ends as well, and the pin
is stated against those. Equalization still uses the constructed ones, because it
is about fidelity to the true offset, which is a property of the curve as built.

### 7.3 A pinned segment must not be bounded twice

The pre-existing tension bound eases into its limit over a blend window, so a
handle exactly on the limit comes back ~3.75% short — and, being measured against
the constructed rib ends, that shortfall moved with the nudge. A pin of 1
rendered as 0.91–0.96 depending on how the on-curve gizmo had been used.

**Corrected:** where a pin is present it enforces the ceiling itself, against the
rendered ends, and the older bound stands down. The chord backstop and the
one-unit floor still apply. Unpinned segments are untouched — the full fixture
set regenerates byte-for-byte.

### 7.4 Measured after the corrections

Round-trip and range, across nudges of 0, ±25 and 50 on the same segment:

| nudge | rendered | grab at zero drag → regenerated | max pin → rendered |
| ----- | -------- | ------------------------------- | ------------------ |
| 0     | 0.2587   | 0.2587 → 0.2599                 | 1.0000 → 1.0000    |
| 25    | 0.2787   | 0.2787 → 0.2757                 | 1.0000 → 1.0000    |
| −25   | 0.2413   | 0.2413 → 0.2414                 | 1.0000 → 1.0000    |
| 50    | 0.2983   | 0.2983 → 0.2992                 | 1.0000 → 1.0000    |

The maximum is 1 at every nudge, grabbing the gizmo no longer moves anything, and
residuals are grid rounding. A 4000-step drag sweep moves the segment tension by
at most 0.00025 per step, monotone, with no jump where the per-handle cap engages.

---

## 8. Construction space is canonical

The rendered-space decision in §7.2 is superseded. The default gizmo and Z-Alt
move only the emitted on-curve; generated handles remain at their construction
positions. Z-normal retains ordinary on-curve semantics by accumulating a
separate per-side `handleNudge` and emitting it on adjacent handles after
construction. This carry scalar never enters fit, adjustment, reach, or pin
math. The on-curve's provenance carries its nonzero `nudge` vector, allowing the
curvature gizmo to reconstruct the construction endpoints by subtraction. Its
visible drag axis still comes from the rendered curve, while distance-to-tension
conversion uses construction reaches.

Per segment side, handle length is resolved in this order:

1. fit the true offset;
2. equalize the fitted split within the fidelity allowance;
3. apply attached per-handle adjustments along each construction handle axis;
4. apply a pinned curvature as one shared tension increment, saturating each
   handle independently at tension 1;
5. apply the ordinary minimum and maximum bounds;
6. emit handles with any Z-normal `handleNudge`, and separately emit on-curves
   with their full nudges.

The per-handle adjustment owns the split and the pin owns the magnitude; neither
overwrites the other. Detached handles remain absolute and bypass stages 3 and 4. A zero-delta grab therefore reproduces the existing construction tension;
default/Alt nudge cannot move an off-curve; and width, nudge, carry, and
attached-handle edits do not change the stored pin except for unavoidable
output-grid residuals.

---

## 9. Corrections after live editor verification

### 9.1 The ceiling saturates each handle independently

The curvature gizmo applies one shared tension increment while both handles are
below tension 1. When the leading handle reaches 1 it stays there; the trailing
handle continues with the same pointer drag until it also reaches 1. Stopping
both at the leading ceiling left part of the control's valid range unreachable.

Pinned regeneration uses the identical independently saturated shift while
solving the stored harmonic mean. The drag and regeneration therefore reproduce
the same asymmetric-to-saturated path without allowing either handle beyond its
tangent intersection.

### 9.2 Storage events do not echo

Visualization settings are synchronized through local storage. An update
received from a storage event updates the local observable but is not written
back to storage. Echoing it can make two editor contexts race and alternate the
gizmo mode indefinitely.
