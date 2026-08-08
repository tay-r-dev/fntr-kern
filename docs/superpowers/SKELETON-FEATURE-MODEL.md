# Skeleton Feature Model (forkra)

**Reframed:** 2026-07-25. It was a review of donor code. It is now a description of **forkra's
own** skeleton code, verified against the tree.

**Companion to `FEATURE-ARCHITECTURE-MAP.md`.** That doc says _where_ the skeleton files are and
_who owns them_. This doc is the conceptual **mental model**: what the feature is, how the
generation pipeline works, and which behaviors you must preserve when you touch it. The design
_rationale_ (C1–C4, and the defects they answer) lives in §9 of the architecture map. `GLOSSARY.md`
defines the terms both docs use.

We **dissolved** the design specs and implementation plans that produced the offset construction,
the generated-segment gizmos, the curvature pin, the continuous natural solver and the true
geometric handle ceiling. Sections §3.2, §7, §8 and §9 here carry their durable content. §9 in
particular is the register of what we tried and rejected. The serif's own spec and plan are the
last two still on disk, under `docs/superpowers/{specs,plans}/`. Their durable content is §8.
Apart from those two, a statement that is still true is either here or in the architecture map.
`DEVELOPMENT-LOG.md` tells the story of how each piece landed.

Line numbers drift. **Function names are the durable anchors here.** Verify any specific location
against the code before you rely on it. `skeleton-generator.js` alone is about 4,700 lines.

---

## 1. What the feature is

Stroke-based glyph design. The designer does not draw filled outlines directly. Instead the
designer draws **centerline contours** ("skeletons"), which are ordinary point and handle paths,
and attaches a **stroke width** to each on-curve point. The generator builds the filled outline
contours live, and every edit regenerates them.

The generated contours are ordinary path contours. They export, interpolate and render like
hand-drawn ones. The skeleton itself lives in `customData["fontra.internal"].skeleton`. Any
consumer that does not know about that key never sees it.

Everything below elaborates that one idea.

- **Ribs** — the width at a point, drawn as a bar across the centerline. Both endpoints drag.
- **Caps** — how an open end closes: `butt`, `round`, `square`, **`drop`** or **`serif`**. forkra
  added the last two. Each cap takes parameters, and the five are mutually exclusive. The serif is
  much the largest of them and has its own section, §8.
- **Corner rounding** — a non-smooth skeleton point makes a sharp outline corner. Rounding is set
  per point, and it can differ per side.
- **Editable generated geometry** — the designer can mark an individual generated outline point or
  handle editable and offset it from its computed position. The offsets are nudges, handle offsets
  and detached handles. The point stays _generated_.
- **Single-sided contours** — all width sits on one side. The other edge lies exactly on the
  skeleton.
- **Modifier behaviors** — D (fixed-rib), S (fixed-rib-compress), X (equalize) and Z
  (tangent-only rib drag). The designer holds them as realtime keys during a drag. See below.
- **Centerline expansion** — what D and S do to a whole selection. See §1.1.
- **Rib angle lock** — see below.
- **Tunni points** on skeleton curve segments.
- **Generated-segment gizmos** — two per generated cubic, on their own layers. One sets the
  segment's curvature. The other slides its two ends along the outline. See §7.
- **Per-source defaults** — a new point inherits widths and caps from source-level settings, keyed
  by glyph case.

**What each modifier key does to a rib drag.** A plain rib drag changes the width. **Z** instead
slides the rib end along its tangent, and carries the adjacent generated handles with it, so the
drag reads as an ordinary on-curve edit. **Z-Alt** slides the on-curve and leaves the handles
where they are. A generated handle moves only under Z. Alt on a generated handle at a smooth point
equalizes.

The tangent nudge has two entry points, the rib gizmo and the generated on-curve, and they sit at
the same place on screen. Both derive the handle carry from the behavior name, inside
`createSkeletonRibTargetEntries`. So the two entry points cannot disagree about it.

**Rib angle lock.** `ribAngleLock` on a point forces its rib onto an axis, either `"horizontal"`
or `"vertical"`. Those names describe the way the rib runs. The lock overrides the normal the
geometry computes, and keeps the sign, so the two sides stay on their own side. It is offered on
open-contour endpoints, where it makes a terminal read flat and axis-aligned whatever angle the
centerline arrives at. It applies under **every** cap style, because it sets the rib the cap is
built on. `getEffectiveNormal` in `skeleton-model.js` is its single implementation, and the
generator imports that function.

### 1.1 Centerline expansion (the D and S drags)

**A D or S drag offsets the centerline.** Every selected on-curve moves the same distance along
its own normal. That makes each affected segment a constant-distance offset of itself, or a
tapered offset where only one of its two ends is selected. So the drag runs `offsetCubicSide`,
which is the generator's own construction, on the skeleton. It keeps the handle directions and
scales their lengths by `1 + d·κ`. It carries whole tied rib groups (§3, step 0).

On a single-sided contour the drag moves no skeleton at all. The centerline is one edge there, so
only the width changes.

**The drag stops where the ribs run out, and it stops per point.** No side may go under one unit
of half-width, so no rib may go under two units of stroke. A point that reaches that floor stops
narrowing **and** stops moving. The two must go together. The whole purpose of the drag is that
the anchor edge stays pinned. A point that keeps travelling after its width has run out drags that
edge along with it.

The floor applies to one point at a time. Its neighbours carry on until they reach the floor too,
so a narrow point cannot hold up a wide one. The drag comes to a complete stop only when every
affected rib sits at the floor.

**Three quantities must obey that same per-point allowance.** We found each one leaking
separately.

1. The point's own travel.
2. The **far** side's width. Linked ribs move both sides by one amount, so the far side can reach
   the floor first. When it does, the drag is over, because that edge now lies on the skeleton.
3. The segment's **handles**. This is the one that hides. The code scaled them by the raw drag
   while it held the on-curves, so they kept the shape moving after everything else had stopped.
   It only shows on a curved skeleton, which is every real one. A straight-skeleton test will not
   catch it.

A tied group is held to whichever member reaches the floor first. The group shares one offset by
definition.

**On a single-sided contour the drag owns the total, not a side.** The visible edge is the sum of
the two stored half-widths, so the drag writes that sum. It leaves the split between the two sides
exactly as it was. That split is the distribution the point returns to if the contour goes back to
double-sided. It is invisible while single-sided is on, and a drag that rewrote it would change a
shape the designer cannot see.

The split survives to within grid rounding, which is as well as it can survive. The sides are
whole units, so a 60/20 split at a total of 90 wants 67.5/22.5 and must land on 68/22. While
single-sided is on, the panel greys the per-side numbers and the distribution instead of hiding
them, so they read as kept rather than lost.

## 2. The data model

The schema and the accessors live in `fontra-core/src/skeleton-model.js`. The load-bearing choice
is **stable ids**. Contours and points carry ids, and selection, provenance and undo reference
those ids instead of array indices. So a structural edit cannot silently retarget them
(architecture map §9).

An on-curve point carries:

- `x, y, smooth`, and the width fields.
- `nudge`, the tangential rib-end displacement.
- an `editable` flag per side.
- the cap parameters.
- the corner parameters: `cornerRoundness`, `cornerAsymmetry` and reach.
- the rib-angle overrides.
- the generated handle offsets and the detached flags.

An off-curve point is `{x, y, type: "cubic"}`.

**The width of a side is a fallback cascade, not a stored value.** It survived the port
(`getPointHalfWidth` and `getPointWidth`, `skeleton-generator.js:290,310`):

```
halfWidth = point.<side>Width  ??  point.width / 2  ??  contour.defaultWidth / 2
```

This matters. A point with no width fields is a _live consumer_ of the contour default. Change
`defaultWidth`, and every point that does not override it follows. Keep the cascade intact.
Writing a width onto every point silently kills it. An earlier normalization draft did exactly
that. The current code does not.

## 3. The generation pipeline

`generateFromSkeleton(skeletonData)` (`skeleton-generator.js:56`) is the entry point. It loops the
contours through `generateContoursFromSkeleton`. Per contour it runs
`generateOutlineFromSkeletonContour` (`:1311`). It then **emits forward provenance**:
`annotateGeneratedContourProvenance` stamps every generated point with
`{skeletonPointId, side, role}` (architecture map C3).

The per-contour pipeline is pure and independent. The output of contour _i_ depends only on
contour _i_.

### Step 0 — Direction ownership

Before any offsetting, find the on-curve points that do **not** own their own direction. A smooth
point with only **one** handle cannot be defined by that handle. Smoothness forces the handle to
be colinear with the straight segment on the point's other side. So the straight sets the
direction, and the handle follows. The rib at such a point is perpendicular to that straight, not
to a miter average (`isStraightControlledSmoothPoint` → `straightSegmentNormal`).

**One such point anywhere on a straight ties the ribs at _both_ ends of that straight** to a
shared offset. The whole projected straight then moves as a unit. `collectTiedRibGroups` is the
single definition of the rule. `coupledHalfWidths` then gives every point in a group the mean of
the group's stored half-widths, per side, so adjusting any one width moves them all. We chose the
mean because it is symmetric and continuous in every input.

The far end does not have to be straight-controlled itself. An ordinary corner or a contour
terminal is tied just the same. What forces the coupling is the controlled point, not the pair.
Straights that share an end point merge into one group, because that shared point has one rib and
cannot sit at two offsets.

**This is the one place where ribs are deliberately coupled.** Ribs at different offsets tilt the
generated rib-to-rib line away from the skeleton straight. `enforceSmoothColinearity` then
re-collinearizes the generated handle at the smooth point against that tilted line, to keep the
outline smooth (the on-curve neighbour cases). So the handle rotates as the width changes. Over a
half-width sweep of 8..34 we measured 8.5° with both ends controlled, and about 16° with one end
controlled, and the two sides shear opposite ways. Two tests lock this in: "keeps handles fixed
when width changes across a mutually-controlled straight" and "…when only one end of the straight
is controlled". The `mutually-controlled-straight` and `one-ended-controlled-straight` fixtures
lock it in as well.

At a corner far end, what survives the coupling is second-order. The miter normal is the
straight's normal _rotated_ by a quarter of the corner's turn. So the part of it that still tilts
the projected straight is `2·hw·sin²(turn/4)`. That is 0.4 units at the widest end of the sweep
above, which is under the 0.3° the grid itself imposes on a handle that long. Do not chase it.

**Opt-out:** `width.tied` on either end. The panel calls it "Tied ribs", under "Linked". It
defaults to on, so existing data keeps the coupling. Clearing it on _either_ end frees that
straight, and the handles rotate with width again, by 16.3° over the same sweep. That is a
deliberate trade for independent rib widths, not a bug. Do not "fix" the rotation while a straight
is untied. Only the shared _offset_ is optional. The rib staying perpendicular to the straight is
not optional, because it follows from the point having no direction of its own.

**Everything that shows or edits a tied rib must use the coupled value, not the stored one.**
`getEffectiveRibHalfWidth` returns the coupled value, and `getTiedRibGroup` is the membership
test. Both live in `skeleton-model.js`, beside the normal computation the gizmo uses. A rib drag
pulls its whole tied group into the executor set through `collectSkeletonRibSelection`, gated to
width-changing drags, because a nudge is not tied. So all the stored widths move together and the
outline tracks the cursor exactly. Skipping either function produced the original report: the
dragged gizmo travelled twice as far as the outline, and its partner did not move at all.

### Step 1 — Segmentation

`buildSegmentsFromPoints` splits the point list into on-curve-to-on-curve segments. Each segment
carries its own off-curve controls.

### Step 2 — Per-segment offsetting

Each side's outline is offset by its half-width. A line segment projects its endpoints along the
rib normal. A cubic segment keeps the skeleton handle directions, and its endpoints stay at the
exact construction rib positions. So the only free numbers are the two handle lengths, and
choosing them is the whole job of `offset-cubic.js`.

The durable construction is:

```text
exact rib endpoints + skeleton-owned directions
    -> fixed requested-offset samples at source parameters
    -> convex perpendicular-error fit inside the handle domain
       + a pull toward the skeleton's own tension, with a ratio from the
         skeleton and widths and a positive fixed frame-influence scale
    -> attached handle adjustments
    -> pinned harmonic-mean tension
    -> detached absolute handles
    -> generator emission and grid rounding
```

**The automatic answer.** `natural-handle-solver.js` owns it. The solver samples the true
requested offset at `t = 1/8, 1/4, 1/2, 3/4, 7/8`. Sample identity never changes, and the solver
never projects a sample onto a candidate curve. The endpoints and the axes are fixed, so each
sampled perpendicular error is affine in the two normalized handle tensions. Their squared sum is
therefore one two-variable quadratic.

The fit is pulled toward the skeleton's own normalized start and end tensions. The solver computes
the pull ratio before the solve, from cusp proximity and normalized width taper only. It never
reads a residual or a candidate answer. The absolute pull uses the fixed frame's unprojected
influence scale, with a positive floor, so a rank-deficient projected fit cannot also erase the
regularizer. The resulting objective is strictly convex and has one answer.

The solver finds the exact minimizer inside the positive non-crossing rectangle. It compares the
interior stationary point, the four edge minima and the four corners, all on that one objective.
There is no iterative refit, no candidate rematching, no magnitude re-solve, no error-budget walk
and no tie-break. The active box faces can change, and the minimizer meets continuously where they
do.

**The authored layers come after that automatic answer**, and `offset-cubic.js` owns them.
Attached adjustments are grid-resolved displacements from the automatic answer. A stored pin then
shifts both normalized tensions to the requested harmonic mean. Detached handles finally replace
their side with the absolute grid position the designer placed. This ordering is product behavior,
not an implementation detail.

**The domain separates its coordinate scale from its geometric ceiling.** The scale that
normalizes each handle is the signed tangent-ray distance, floored at a third of the chord and
capped at twice the chord. The floor stops a forward intersection from squeezing a handle to
almost zero as it slides onto an endpoint, and then springing it back. The cap stops near-parallel
rays from giving the fit an unbounded lever arm. A parallel or behind intersection keeps the
chord-cap fallback.

A positive forward intersection remains the actual non-crossing maximum. If it lies below the
scale floor, that end's maximum normalized tension is `realReach / scaleReach`, which is below 1.
The emitted length therefore still lands no farther than the intersection. Between the floor and
the cap, geometric tension 1 and normalized tension 1 coincide. Beyond the cap, the cap is
conservative. The scale stays finite and positive, so every stage works in one tension coordinate
system. No stage mistakes the stabilizer for the geometry.

The ordinary lower face is the one-unit handle floor. If a real forward reach is shorter than one
unit, non-crossing wins and the minimum contracts to the maximum. Creating a loop cannot preserve
a meaningful grid direction. The automatic fit, the attached adjustments and the pins all consume
these same per-end limits. Detached handles stay deliberately absolute authored geometry, and the
code applies them after the constrained construction.

**Two of the solver's return values are diagnostics.** Beside the two lengths it returns the pull
ratio it used, and the answer's perpendicular RMS against the true offset. They exist so that a
failing accuracy test can tell a poor fit from a segment the pull deliberately holds near the
skeleton's shape. **No production code may branch on either number.** If it did, the answer would
feed back into how much the answer counts.

**A collapsed side skips all of this.** A side under about 0.5 units copies the skeleton exactly.
That is what makes single-sided contours exact.

**A nudge is an emission post-step, never an input to handle construction.**
`ribNudgeDisplacement` moves the emitted on-curve along its corner-aware tangent. The interaction
contract holds two scalars per side, and accumulates them independently.

- `nudge` is the rendered on-curve displacement.
- `handleNudge` is the portion that ordinary Z-mode drags accumulate. The generator emits it on
  the adjacent handles after the construction pipeline.

A default gizmo drag and a Z-Alt drag change only `nudge`, so the adjacent off-curves stay
byte-identical. A Z-normal drag changes both scalars, so it behaves like an ordinary on-curve edit
and carries the off-curves. A later Alt-style edit leaves the earlier carried handle position
intact. This is deliberately separate from `handleOffsets`, because the carry must also work where
no forward tension reach exists and an attached adjustment therefore cannot apply.

On-curve provenance publishes the nonzero on-curve nudge vector, so a screen-space gizmo can
subtract it and recover the construction rib end exactly. The `nudged-cubic-endpoints` fixture
deliberately records the default and Alt contract.

**The continuity contract governs the automatic answer.** Regeneration runs on every frame of a
drag, so a one-directional skeleton edit must not reshape the generated segment by jumping or
backtracking. The contract is now structural, and it has five parts.

1. Fixed sample identity.
2. No projection, root finding, iterative refit, convergence decision or error-budget threshold
   search.
3. One strictly convex objective.
4. One input-only pull ratio.
5. Exact minimization in the positive non-crossing rectangle.

A fixed trip count alone gives determinism, not continuity. It did not make the superseded
candidate-rematching path continuous.

Three discontinuities are deliberate. No continuity test may span any of them.

- The 0.5-unit collapsed-side threshold.
- The forward-to-behind tangent-intersection event.
- Grid rounding, at authored placement or at generator emission.

**Two limits here are permanent, and neither is a bug to chase.**

The first limit is direction. The skeleton owns the generated handle direction (§3, and that
ownership is what keeps the smoothing pass inert). On a **tapered** stroke the true offset's
tangent is not parallel to the skeleton's. We measured 6°–79° across realistic tapers. So a
tapered segment deviates from the true offset by 3.6–14.4 units, against 0.11–0.49 at constant
width. No choice of handle _length_ can absorb a direction error. Tilting the axis per end would
recover almost all of it, and we **reject** that fix. The axis is skeleton-owned and stays that
way.

The second limit is representability. A bold stroke on a tight curve brings the offset distance
close to half the endpoint curvature radius. There a single cubic **cannot** represent the offset
at all, and point-count stability forbids splitting the segment. Errors there run into the
hundreds for every strategy, including a numerical optimum.

Both limits are why the curvature gizmo (§7) exists. Where the automatic answer cannot be right,
the designer gets the control instead of the collapse.

### Step 3 — Corner rounding

`roundSharpCornersOnSide` replaces a non-smooth generated corner with an arc, which is two
on-curves plus their handles. Corner metadata rides on the generated on-curve points
(`buildGeneratedOnCurve`), and `stripCornerRoundMetadata` removes it before output. A pairwise
pass shrinks adjacent trims so that they cannot overlap.

### Step 4 — Caps

Open contours only. The generator builds butt, round, square and drop caps from the two side ends
plus the tip points. It takes the handle lengths from a tension parameter. The **serif** is the one
cap that does not simply close the two side ends. It trims a length off each side first, and
splices its own terminal on. See §8.

### Step 5 — Assembly

`left + endCap + reverse(right) + startCap` gives one closed contour, through `reverseContour`. A
closed skeleton instead emits **two** contours, an outer one and a counter-wound inner one.

### Step 6 — Smoothing

`enforceSmoothColinearity` re-collinearizes the handle pairs around smooth on-curves. When both
handles descend from the same skeleton point, they carry the axis they were constructed on. That
axis is `_axis`, stamped at emission and stripped with `_provenance`, and `sharedLockedAxis` uses
it directly. Only handles without that axis fall back to the length-weighted, rotation-capped
estimate. Those are the handles from caps, from line-segment ribs and from corner-rounding output.

**The axis must not be derived from handle length.** Rib width changes the generated handle
length, so a length-weighted axis rotates whenever the width changes. Before we took the axis from
the skeleton, we measured 1.1° mean and 12.5° worst per single unit of width. Deriving the axis
from the _rounded_ handle positions is the same trap, because the grid snap is what makes the
direction length-dependent in the first place. The test "keeps the smooth-junction handle axis
independent of rib width" locks this in.

This pass writes handle positions **unrounded**, and it does so deliberately. Re-snapping to the
grid here would undo the colinearity the pass just established. It would be worst on short
handles, where one unit of rounding is a large angle.

### Grid rounding and the handle floor

**Grid rounding happens at every stage**, not once at the end. It is also what makes handle
_direction_ depend on handle length. A handle emitted at `round(ribPoint + axis · length)` carries
its axis only to within `atan(0.7 / length)`. That is about 1.3° at 32 units, 4° at 10 units, and
45° at 1 unit, where the eight lattice neighbours are the only directions a handle can express at
all. So any later stage that re-derives a direction from rounded coordinates inherits a width
dependence, because the width sets the length.

Handles at the 1-unit floor therefore express only three directions, axis-aligned and diagonal,
and they degrade colinearity at that size. The floor is `MIN_HANDLE_LENGTH`, plus the
`Math.max(along, 1)` clamp in `projectHandleOntoDirection`. **This is accepted, not a defect.**
Ordinary on-curve points behave the same way at that scale, so the generated outline stays
consistent with hand-drawn geometry. Do not "fix" it by raising the floor, and do not allow
sub-unit handle coordinates.

**Point-count stability is a hard constraint.** The generated point count must stay constant
across parameter values, or cross-master interpolation breaks. Any change to outline geometry must
preserve it (architecture map §8, delegation recipe).

## 4. How forkra differs from the donor (the redesign)

forkra re-integrated the feature. It did **not** merge the donor's plumbing. The donor still sits
read-only at **`_external/skeleton`**, pinned at `fd76d3abe` and gitignored. Reach it with
`git -C _external/skeleton …`. It is a behavioral reference, and never a source to copy plumbing
from.

Three differences are load-bearing. Do not undo them. The full rationale is in architecture map
§9.

- **One write path.** All editing-side mutation flows through `editSkeleton`
  (`skeleton-editing.js`), the only caller of the generator on the edit side. The donor mutated
  from dozens of call sites. forkra does not.
- **Forward provenance, never geometric recovery.** "Which skeleton point owns this generated
  point?" is a provenance-map lookup. The donor reverse-mapped by re-projecting ribs and comparing
  coordinates with tolerances. **None of that is in forkra.** Do not reintroduce it.
- **Modifiers inside the behavior model.** D, S, X and Z are behavior names and executor variants.
  The donor used inline pointer branches and bypass flags, which regressed equalize five times.

## 5. What must be preserved

If the code loses any of these, the product regresses.

- **The width fallback cascade** (§2). It gives the designer a one-field "reweight this whole
  contour".
- **The collapsed-side rule** (§3.2). A side under about 0.5 units lies exactly on the skeleton.
  This is what makes single-sided and open-counter constructions predictable.
- **Corner metadata riding on generated points** (`buildGeneratedOnCurve` →
  `roundSharpCornersOnSide`). It puts a per-skeleton-point parameter at the right place in outline
  space, after both sides exist. It is also the natural carrier for provenance.
- **Pairwise corner-trim limiting.** It stops adjacent rounded corners from eating each other. A
  reimplementation loses it easily.
- **Point-count stability** across parameter values (§3). This is the interpolation contract.
- **Fixed sample identity** (§3.2). The automatic solve always uses the same five source
  parameters. No projection, root finding, iterative refit or error-budget search belongs in this
  path.
- **One strictly convex automatic objective.** The perpendicular fit and the skeleton-reference
  pull are minimized together, so there is one minimizer and no candidate tie-break.
- **An input-only pull ratio.** It may read only skeleton geometry and endpoint widths. It may
  never read the achieved residual or the answer. Its absolute weight uses a positive unprojected
  influence scale, which cannot vanish with the projected Hessian.
- **The positive non-crossing handle domain.** Automatic, attached and pinned lengths all stay
  between the one-unit floor and the true forward tangent intersection. Where that intersection is
  shorter than one unit, non-crossing wins. The stabilized tension scale never replaces the
  geometric ceiling.
- **The authored ordering.** Natural answer, then attached adjustments, then pinned harmonic-mean
  tension, then detached absolute handles.
- **The three explicit topology and emission events.** They are the collapsed-side threshold, the
  forward-to-behind tangent-intersection event, and grid rounding. A continuity test must not
  silently span any of them.
- **A pinned curvature is permanent** (§7). The generator reproduces the stored number through
  skeleton, width and taper edits, and clamps only its output. A pin that drifts makes the control
  pointless.
- **The release is smooth only while both its handles are non-zero.** The share clamps that used
  to guarantee this are gone (dev log §27), so a handle can now reach zero, and at zero the release
  is a corner. That is the correct output under the serif ground rule — points collapse, they do
  not disappear — but the guarantee is conditional, not unconditional. Do not write a test that
  asserts tangency across the whole range.
- **A curvature pin moves handles, and nothing else.** No on-curve may move when only the pin
  changes. Not a rib end, not a terminal's release, not the bottom of a serif's straight run. This
  is what forces the serif's release to be fixed in its own frame (§8). It is also checkable:
  sweep the pin, and sum each emitted on-curve's travel. The sum must be exactly zero.
- **A gizmo measures the curve its write governs.** The generator reproduces the curvature gizmo's
  pin on the whole segment, so the gizmo must read its starting value from the whole segment. Use
  `constructionSegment` where a terminal has trimmed one. Reading the emitted points directly
  makes the first drag jump, because the number displayed and the number written then describe
  different curves.
- **A drag's geometry does not consult the panel's link flag.** `width.linked` says how the
  designer types numbers in. A fixed-rib drag is a statement about which of the two edges is
  pinned. Reading one from the other made the same drag behave two ways inside one selection.
- **The rules-tables interaction feel.** Skeleton points behave exactly like path points under
  Shift and Alt, because they run the same rules (C1). The designer learns one set of habits and
  they hold everywhere.

## 6. Known cleanup candidates (verified in the current tree)

These are not bugs. They are carried-over cruft and structural weight. Each one is verified
present today. Treat them as opportunities, not mandates, and confirm before you act.

- **Round once instead of at every stage.** Grid quantization at every pipeline stage (§3) is the
  reason `lockNearZeroHandleDirection`, the `NEAR_ZERO_*` constants and the rotation clamp exist.
  Keeping interior handles in floats and rounding once at the boundary
  (`outlineContourToPackedPath`) would let several defensive subsystems shrink. This is a large
  change. Measure first.
- **The generator is the monolith.** `skeleton-generator.js` is the single largest file in the
  fork, and it is where defect **P6** (architecture map §9) still bites. The architecture map
  carries the current line count. Do not restate the count here, because two copies drift.

The donor's dead `mergeCap` branches and its `generateSampledOffsetPoints` are already absent from
forkra. There is nothing to do there.

## 7. The generated-contour controls

Each generated cubic segment carries two gizmos per side. They do different jobs and must not be
merged into one. One owns the segment's **curvature**. The other owns where the segment's two ends
**sit along the outline**. They draw on separate visual layers, so they do not crowd each other.
Both are the affordance that the two permanent limits in §3.2 call for.

### The curvature gizmo pins a number, not a displacement

It sits **on** the curve, at `t = 0.5`. It drags along the axis from there toward the segment's
tangent-ray intersection. Dragging toward that intersection fills the curve out. Dragging away
flattens it.

What the gizmo stores is the **segment tension it arrived at**. That is a number, not a positional
offset, and regeneration reproduces that number whatever the skeleton has done since. This is the
whole purpose of the control. An adjusted curvature that drifts when the skeleton moves is not an
adjustment.

The number is meaningful because a cubic segment's tension is **exactly the harmonic mean of its
two handles' individual tensions**. With `t₁ = a/b` and `t₂ = c/d`, `τ = 2·t₁·t₂/(t₁+t₂)`. So two
handle lengths decompose into two orthogonal quantities. The **magnitude** is the mean, and the
pin owns it. The **split** is how the two tensions sit either side of that mean, and per-handle
adjustments and equalization own it. Because the two quantities are orthogonal, the pin and a
hand-placed handle compose without a precedence rule, and neither overwrites the other. That
identity is the load-bearing fact behind the whole pipeline order in §3.2. The conversions live
once in `tunni-calculations.js`. Do not derive them again anywhere else.

Rules that hold everywhere:

- **The ceiling is 1.** Tension 1 puts the handles on the tangent intersection, which is the
  fullest a cubic gets before it distends. A circular arc sits at 0.5523, and across a realistic
  sweep the accuracy optimum never asked for more than 1.04. A drag cannot store more than 1. The
  two handles saturate **independently**. When the leading handle reaches 1 it stays there, and
  the trailing one stays responsive until it reaches 1 too. Otherwise part of the control's valid
  range is unreachable.
- **An unreachable pin clamps. It never releases.** Where the geometry cannot express the stored
  number, the generator clamps the _output_ and never rewrites the _stored number_. So the segment
  returns to exactly what the designer set, once the skeleton comes back into range. Nothing in
  generation ever writes this field. Only a drag writes it.
- **A pin is bounded by the same box as everything else, and needs no exemption.** It used to need
  one. The ordinary tension ceiling eased into its limit over a blend window, so a handle sitting
  exactly on the limit came back about 3.75% short. A pin of 1 therefore rendered as 0.91–0.96.
  The pin had to enforce the ceiling itself, and the older bound had to stand down for it. With one
  exact ceiling (§3.2), the pin saturates at tension 1 and so does the box. They now agree by
  construction, and the old "not bounded twice" rule has nothing left to say.
- **A pin is stored per segment per side, keyed on the segment's START point.** That key is
  direction-independent. This matters because the right-side contour is emitted backwards, and its
  segments carry `in` before `out`. Keying on emission order would therefore address the two sides
  inconsistently. An `out` handle owns the pin at its own skeleton point, and an `in` handle's pin
  belongs to the previous on-curve point.
- **A direct handle drag on a segment clears that segment's pin**, before it writes its offset.
  The hand is the later and more specific answer to the same question, so the hand has to win, or
  the segment fights the cursor. It clears only that one segment, and the handle's other neighbour
  keeps its own pin. Moving a generated **on-curve** does not clear the pin, because the pin is
  independent of the nudge by construction (§3.2). Neither of the panel's two handle controls
  clears it either, because neither places a handle by hand. "Reset handles" is deliberately
  narrower than a rib reset, and the detach toggle writes offsets only to hold a handle where it
  already is.
- **Clearing the pin must not move anything.** The pin contributes length to both of its segment's
  handles, so a bare clear snaps them back to the fit's own answer. That throws away the curvature
  the designer just set, the instant a handle is touched. The code therefore **bakes** the pin
  first. One regeneration with the pin cleared measures how far each of the two handles moves, and
  it stores that difference as a per-handle offset. It does this for both handles, because only
  one of them is ever under the cursor. It skips detached handles, which are absolute and never
  saw the pin.
- **The full rib reset does clear the pin**, alongside the nudge and the handle adjustments, on
  the segment _leaving_ that point.

**A new per-point field is invisible to the generator until something copies it across
explicitly.** `canonicalToGeneratorInput` flattens every point before generation, and the model's
own accessors do not work on the far side of that translation. The pin failed silently in exactly
this way once. It stored correctly and read back correctly through the accessor, and it did
nothing at all, because the generator saw `undefined` on every segment. The pin travels as
`leftSegmentCurvature` and `rightSegmentCurvature`. Any future per-point field has the same trap.

### The automatic split follows the skeleton reference

The natural solver does not equalize in a later stage. The skeleton's own normalized handle
tensions are the reference, inside the same strictly convex objective as the perpendicular fit. An
ordinary representable offset uses only the small conditioning floor. Near-cusp and tapered inputs
raise the reference pull, through one global input-only formula. So the fit and the reference
negotiate one answer, instead of handing a candidate to a second error-budget decision.

The calibrated ratio has four global constants: a small positive floor, a sharp near-zero cusp
gate, and independent cusp and taper gains. Separating the two gains matters. A shared peak
coupled two different failures, so giving it enough authority to stabilize a tapered outward side
made an inward near-cusp transition too steep. The development log records the selected constants.
They are not tuned per glyph, per side or per fixture.

**A near-symmetric skeleton must not generate a near-degenerate pair.** A test covers that
property directly, across near-cusp widths. Monotone U¹ sweeps cover the rest: both single-sided
directions, both double-sided generated sides, taper, pins, attached adjustments and detached
handles. The pull is a regularizer inside one objective. It is not an error allowance, and it is
not a second-stage threshold.

### The on-curve gizmo

It sits **off** the curve. It is anchored at the segment midpoint and displaced along the
**outward** normal. Outward follows from the contour's signed area, so counters come out correct.
One placement function serves both the drawing layer and the hit test. Both take the distance from
the same constant, so they cannot disagree about where the control is.

**The displacement is one constant, in glyph units.** It is the same everywhere on the glyph, and
it zooms with the letter. We built two rules that vary it and rejected both in use. Do not
reintroduce either without a fresh reason.

- A **screen** constant holds its pixel size at every zoom, and grows without bound in glyph
  space. Zoomed out, the control drifted a large fraction of the letter away from the outline.
- Scaling by the **local stroke thickness** is defensible on paper, because the gizmo does mark an
  offset from an outline. In use it reads as unsettled, because the gap then changes with every
  width edit.

The gizmo is tangent-constrained, like every on-curve gizmo in this editor. It writes the same
`nudge` the panel writes, so one number has two affordances. The code reads its drag in
**absolute** coordinates. Up or right spreads the segment's two ends apart along their own curves,
whichever way the segment happens to point. A control whose meaning rotated with its segment would
need re-learning at every joint.

**The gizmo is offered only where an end can actually move.** An end may be nudged in two cases
only. The skeleton segment on the _far_ side of it is a straight line, or that segment does not
exist because the contour ends there. A curve attached there holds that end. Where one end can
move, it takes the whole
spread. Where neither can move, the code does not draw the gizmo and does not hit-test it. A drawn
control that cannot move is worse than no control.

### Gestures and readout

- **Drag** — the gizmo's own function.
- **Ctrl+Shift click on the curvature gizmo** — equalize the two handle tensions fully, and leave
  the segment's curvature exactly where it is. The code waits to see whether the pointer moves
  before it decides, so holding the modifiers never costs the drag. Only the curvature gizmo has
  this gesture, because it owns the split. The on-curve gizmo has no modified gesture.
- **Double-click** — reset. On the curvature gizmo, clear the pin and both handle adjustments, so
  the segment returns to what the fit produces. On the on-curve gizmo, zero the nudge at both ends.
- **A switchable label layer** draws each generated segment's construction-space tension just
  above its curvature gizmo, in the point-label face. A dot marks a number that is a stored pin
  rather than the fit's own answer. During a curvature drag, the drag readout shows the same value
  whatever the switch is set to. This is how the designer tells a pinned segment from an automatic
  one.

Undo labels name the **effect**, never a donor control: "Equalize Generated Handles", "Reset
Generated Curvature", "Reset Generated On-Curves".

### Mirroring swaps sides

A mirror has a negative determinant, so the geometric left of the mirrored centerline is what the
stored data calls right. On a determinant flip, every per-side field swaps: `width`, `nudge`,
`handleNudge`, `locked`, `segmentCurvature`, the four handle offsets, and `capBallSide`. `capAngle`
and `cornerAsymmetry` negate.

Handle adjustment vectors take the affine's linear part only, never the translation, whether or
not the sides swap. `reversed` needs no change, because mirroring flips the outline's winding and
swapping the sides flips the emission order back. Contour-wide ownership (`singleSided` and
`capBallSide`) may swap only when the **entire** contour is in the selection.

## 8. The serif terminal

The serif is a cap style, so it is mutually exclusive with the other four, and it is offered only
on open-contour endpoints. It is the only cap that **consumes stroke** instead of just closing it.
It trims a length off each side of the outline and splices its own terminal in.

The split between the two files is deliberate. Keep it.

- `serif-geometry.js` (core, 268 lines) holds the terminal's shape as pure geometry in its own
  frame: `computeSerifFrame`, `buildHalfSerif`, `buildSerifTerminal`. It contains no concept of a
  stroke, a rib, a trim or a contour.
- `buildSerifCap` in `skeleton-generator.js` owns everything about attaching that shape to a
  stroke: where each side is cut, how the loose end is brought to the terminal, and the splice.

This is the counter-example to defect **P6** (architecture map §9). The generator did not need to
grow another 300 lines of geometry.

### Ground rule: points collapse, they do not disappear

Every point a serif can emit is emitted at every parameter value, including values where it has
nowhere to go and lands on top of its neighbour. **A serif is allowed to collapse points to zero
distance — on-curves and off-curves alike — and the one-unit minimum separation that applies
elsewhere does not apply inside a terminal.** Coincident points and zero-length segments are the
correct output, not a degenerate one.

That is what keeps the point count constant across the whole range, which is the cross-master
interpolation contract. Removing them is opt-in per master through `serifRemoveCollapsedPoints`,
and taking that option forfeits interpolation for serifed glyphs in that master — already stated
at the source default.

Three consequences, and they govern anything new added to the terminal:

- A new field never needs a minimum value to keep its points apart. Zero is always a legal setting
  and must emit the same points as any other setting.
- "Switched off" means contributing no _shape_, not contributing no _points_ — the obligation a
  wingless half already carries.
- A discontinuity in a coupled parameter is a jump in shape only, never a jump in topology. That
  makes it a drag-feel problem, not an interpolation problem.

### The frame

The origin is the skeleton endpoint. **u** runs along the serif axis, positive toward the contour's
left side, which matches the generator's own rib convention. So a half stored as "left" is the half
on the left. **v** is depth. It is perpendicular to the axis, not to the tangent, and positive back
into the stroke, so the frame stays orthonormal in every mode.

`axisMode` is `perpendicular`, `horizontal`, `vertical` or `absolute`. The last one takes
`axisAngle`. The code holds the axis at least `MIN_AXIS_TANGENT_SEPARATION_DEG` (15°) off the
tangent. An axis that approaches the tangent makes the terminal degenerate, and the wings start to
lie along the stroke instead of across it.

**The serif axis is its own property, and it composes with `ribAngleLock`** instead of replacing
it. The lock sets the rib the cap is built on. The axis sets the direction the serif runs. Both
apply.

They meet in one place. **`perpendicular` runs the foot along the rib**, and the rib is where a
lock lands, so a locked terminal keeps its foot flat while the centerline leans. The other three
modes name a direction outright and never read the stroke, so a lock does not reach them — a
terminal set to `horizontal` was already horizontal. Squaring the tangent a second time instead is
the same answer on an unlocked terminal and the wrong one on a locked one, which is how a slanted
stem came to draw a slanted foot under a flat rib.

Whenever the axis is not square to the tangent — under a lock, or in any of the three named modes on
a leaning stroke — the frame's depth stops agreeing with the stroke direction, and everything the
serif hands back to the stroke has to be found along the stroke instead. See the release rule below.

### The two halves

Nine fields per half, independent left and right, with a `linked` flag that copies left onto right:

`wingLength`, `tipThickness`, `wingSlope`, `tipCutAngle`, `reach`, `tension`, `concavity`,
`easeDistance`, `easeCurvature`.

Five fields sit at terminal level and both halves share them: `axisMode`, `axisAngle`,
`undersideCup`, `undersideCupTension` and `undersideCupBalance`.

**Every one of these fields always holds a number.** There is no inherit state and no null. An
unset field is zero, and zero is a setting rather than an absence. This is the one place the serif
does not follow stroke width, which does inherit (§2).

A contour can still hold a serif block in an old file. Nothing reads it. Point normalization
materializes a serif on every on-curve point, so a point-level fallthrough can never fire, and a
fallback that cannot fire is worse than one that is documented.

`SERIF_LENGTH_FIELDS` names the five fields that are distances. They are the only ones the source's
`serifUnitsMode` scales. That mode is `absolute` or `normalized`, and `normalized` multiplies by
the stroke width. `tipCutAngle` is in degrees. `tension`, `concavity` and `easeCurvature` are
dimensionless in every mode, and nothing scales them.

### Presets, and what a fresh serif is

**A serif preset is one wing plus the underside cup.** Ten numbers under a name. Applying it writes
that wing to both sides. Asymmetry is a decision about the terminal being edited, not about the
shape that was saved, so `linked` does not travel with a preset and a preset never stores two
different wings. The cup belongs to the terminal rather than to a wing, and is stored once either
way.

A preset carries no `axisMode` and no `axisAngle`. Those place the terminal rather than shape it. A
preset captured on an upright stem foot would otherwise force a slanted terminal back to
perpendicular, and one preset has to stay correct on every terminal in the font.

Five built-ins ship with the feature: **Egyptian, Clarendon, Didone, Old style, Wedge**. A master
holds its own list beside them, in the source defaults, per master because absolute lengths do not
survive a trip between masters.

**Picking serif in the cap style select applies Egyptian**, unconditionally. The select only fires
on a change, so that is exactly "became a serif", and picking it is a request for the default
shape. Do not gate that write on the point holding no serif data: the block is always there, so the
test can never pass, and a terminal seeded by nothing shows whatever the fallbacks happen to be.

Egyptian is the plain slab — wing length, tip thickness and wing slope all 20, everything else 0.

**The bracket bends around one attractor.** `concavity` places the attractor. The attractor starts
at the midpoint of the chord from the wing's tip to the junction with the stem. From there it
travels toward the **wing's inner corner**. `tension` is how far both handles then travel from
their own end toward that one point. This is the serif-lab construction, ported unchanged.

The two fields cannot cancel each other. Concavity at 0 leaves the attractor on the chord, so the
bracket is a straight chamfer whatever tension says. Tension at 0 leaves both handles on their own
ends, which is the same chamfer. Negative concavity sends the attractor to the other side of the
chord, and the bracket bulges convex.

The attractor is also what keeps `wingSlope` and `reach` from standing in for each other. Slope
moves the attractor through the corner. Reach moves it through the chord midpoint. An earlier
construction aimed both handles at the corner and measured reach from the corner, which made those
two fields emit identical geometry.

The cost is that the bracket meets the stem flank tangentially **only at concavity 1**. Everywhere
else the junction is a corner, and that is what contour easing is for. A fresh serif starts at
tension 0 and concavity 0, so it arrives as a flat chamfer and the bracket is something the
designer asks for.

**Contour easing rounds that junction.** `easeDistance` moves the release back along the flank and
cuts the same amount off the bracket end. The cut is a de Casteljau split, so the surviving bracket
is the same curve, not a redrawn one. The rounding that fills the gap has one handle on each
surface: one along the flank, one along the bracket's own tangent. **Both handles are the same
length.** A rounding is symmetric or it is not a rounding. Giving each handle a fraction of its own
neighbour instead makes the two legs unequal. The split bracket's control leg has nothing to do
with the ease distance. The result reads as a lopsided scoop.

`easeCurvature` is the fraction of the way to the corner where those two surfaces would meet. At 0
it leaves both handles on their ends and cuts a straight chamfer. At 1 it carries them onto that
corner. Near full concavity the two surfaces are nearly parallel and that corner runs far away, so
the ease distance bounds the reach as well.

Easing switches itself off at concavity 1, and **only** there. That is the one value where the
bracket already leaves the junction along the flank, so no corner is left to round. A partly hollow
bracket still meets the flank at an angle, and wants rounding as much as a bulging one does.

A half with `wingLength === 0` is **switched off**, and it must add nothing to the outline. Two
consequences follow, and we found both the hard way.

1. It contributes no straight depth. The terminal shares the straight run, so without this rule a
   disabled side still pushes a spur out. The run is straight while the edge it leaves is not, so
   that spur lands outside the stroke.
2. It does no hollowing. The corner has collapsed onto the tip, so bending toward the corner only
   dimples the foot line.

### The release — the one rule to keep

**The terminal meets the stem where the stem actually is, and the wall it meets is the wall as
solved from the centerline and the widths.**

The wing's top surface is extended inward from the top of the tip until it meets that wall. Where
it meets is the wing's inner corner. The junction and the release sit at their own depths further
up the same wall. The wall is cut at the release, and the surviving piece is emitted unchanged.
Nothing is dragged onto a target and no handle is turned.

The rule this replaces placed those points on a straight line running up the frame's depth from the
rib end, and brought the edge to them. That line is the wall only on a straight stem. On a curved
one the wall had to be dragged onto it and its surviving handle turned onto the endpoint tangent,
and both grew with the depth the serif reached at. Tip thickness sets that depth almost alone, so
moving tip thickness reshaped the stem: on `_external/b.json` the emitted wall departed from the
curve the generator solved by 11 units at tip thickness 63 and 23 at 100, with the segment's tension
sliding from 1.33 to 0.85. It now moves under a tenth of a unit across that whole range, which is
grid rounding.

**What keeps a curvature pin out of the serif is not the straight line but the ordering.** The cut
is taken on the wall before any authored layer touches it, and all three authored layers — the
curvature pin, a nudged handle and a detached handle — are applied to the piece that survives. So a
pin states the tension of the segment on screen, which is the segment the gizmo measures, and none
of the three can move the serif.

**The wall carries its own shape, so the frame no longer reports a lean.** A rib angle lock, or any
of the three named axis modes on a leaning stroke, tilts the axis away from the stroke; the old
model handled that with a `flankSlope` on the frame and a straight line at that slope. The wall is
the true curve in frame coordinates, which covers the lean and the curve together. Placed at the rib
end's own `u` at every depth instead, both releases slide the same way along the axis, which is
inward on one wall and outward on the other: the stem changed thickness above a serif that had only
been switched on.

**Wing slope is the incline of the wing's top surface**, whose run is decided by where the wall is,
rather than a rise measured on an assumed line. The two agree on a straight stem.

#### What absorbs the lean, and why it is the bracket

A flat foot under a leaning stroke is a genuine conflict, not a bug to be solved away. The wall
crosses the foot line in one place and stands further along by the time the bracket has climbed the
wing. Something has to absorb that distance. There are exactly two places it can go, and **the
designer chose the bracket** (2026-08-07, on `_external/c.json`: a 17 degree stem, a 20 unit wing
slope, 12 units to absorb).

**The serif's own shape is square to its foot and reads nothing off the stem.** Wing length, tip
thickness and the tip's outer edge are what the fields say at every lean. Only the wall follows the
stroke. The visible cost is that one bracket reaches further sideways than the other. At wing slope
0 the two are identical, because then the bracket does not climb.

The rejected alternative was to keep the serif rigid to the release and let the stem absorb it. That
is the state the bug was reported from: the stem sat about 12 units off the skeleton at the foot and
straightened out going up, measuring 27 units to one wall and 49 to the other. A stem that is not
where the skeleton says is worse than a bracket that is not symmetric.

Leaning the whole frame — shearing the terminal so the halves match under the lean — was built and
rejected in between. It puts the tip's outer edge parallel to the stem, which deforms the wing, and
it does not even remove the bracket asymmetry in glyph space. See §9.

**Reading the release off the EMITTED edge is still wrong**, and remains the mistake this feature
made and reverted once. The emitted edge carries the authored layers, so a point taken from it is a
function of everything a designer has done to that segment, and a curvature pin moves two on-curves
along the stroke. Reading it off the wall as solved is not the same thing, and is what the terminal
now does: the wall is decided by the centerline and the widths alone, before any authoring.

### Point count

**Seven on-curve points per terminal, at every parameter value**, including every degenerate one:
a wingless half, zero thickness, zero cup. The release is not one of the seven. It is where the
trimmed edge already ends, so emitting it again would stack a second on-curve on the same spot.
What the terminal owns instead is that release's outgoing handle, which is why its point list opens
and closes with a control point.

At ease distance 0 the rounding has no length and its two ends coincide. That is a zero-length
segment, not a missing point, and the count holds. The test "keeps seven on-curve points at every
degenerate value" covers this directly, because this is the interpolation contract (§3).

### The underside is one curve

One cup value drives a single curve across the whole terminal, tip to tip. It is not one curve per
half. The foot centre sits **midway between the two tips** — the middle of the foot the serif
actually draws, and the two ends of this very curve.

It used to sit on the skeleton, which reads correctly only while the two halves match. Single-sided
mode collapses one half to zeros, so the whole terminal stands on one side of the skeleton and the
cup's lowest point lands on the foot's own edge instead of its middle.

**The balance slides that centre along the foot.** It is a fraction of the half-span between the
two tips, not a distance: the foot it divides is what sets the scale, so one number reads the same
on a narrow serif and a wide one, the units mode never touches it, and a preset carries it between
masters unchanged. Zero is the midpoint, so a terminal drawn before the control existed does not
move. At either extreme the centre lands on a tip and one half of the sweep collapses to nothing,
which is the correct output under the ground rule. Positive runs toward the contour's left, which
is the frame's own convention, so the number agrees with the half the panel calls left. The bound
is written in the serif writer, so the panel cannot show a value the shape has already refused.

The cost is the one the old rule existed to avoid: unequal halves carry the contact point off the
skeleton with them, by half of the difference. Measured on a stem leaning up to 30 degrees, as the
contact height, old rule against new: equal halves are identical at every tilt, and under a flat
foot — the horizontal axis mode — every case is identical, because an axis with no rise cannot
lift the centre it slides along. Only the perpendicular mode with unequal halves moves, by 25 units
over that lean against 2.4 before. That mode leans the whole foot with the stem regardless, so a
foot wanted on the alignment zone is asked for with the flat modes or the rib angle lock.

### What a trimmed terminal owes the rest of the editor

A trim makes the **emitted** segment shorter than the segment the generator solved. A terminal whose
pin is reproduced on the whole solved segment therefore owes every reader that segment, published on
the inserted point's provenance as `constructionSegment`; `generatedSegmentConstructionPoints`
resolves it. Round caps trim, and still do this.

A serif does not. Its pin is applied after the cut, so the piece on screen is the curve the pin
governs and there is no second curve to hand anyone. The reader's absent case is the ordinary answer
there, and it falls back to the emitted segment, which is the right one to measure.

---

## 9. Closed decisions and dead ends

We designed or built each of these, then measured or used it, and withdrew it. They are recorded
here so that nobody derives them again from first principles. Several have already been re-proposed
once.

| Idea                                                                          | Why it is closed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restore the old sample-and-fit offset path**                                | An adaptive threshold jumps a step when an input nudges. The output is therefore discontinuous, and two masters land on different answers. Endpoints become free samples, which destroys provenance. A variable curve count destroys point-count stability.                                                                                                                                                                                                                                                 |
| **Tilt the generated handle axis to the true offset tangent**                 | It recovers nearly all of the taper defect, and we still reject it. The axis is skeleton-owned (§3.2). A single shared tilt recovers under half the gain, and on some cases it is _worse than pinned_.                                                                                                                                                                                                                                                                                                      |
| **A harmonize pass on generated joints**                                      | Measured. Unrounded, the generated contour already reproduces the true offset's joint curvature to within 1.7%, and to floating point where the skeleton is G2. Where a step does exist it is the skeleton's own step, faithfully reproduced. Harmonizing would erase a curvature the designer asked for.                                                                                                                                                                                                   |
| **A post-fit equalization walk, absolute or proportional allowance**          | Removed. It makes the automatic answer depend on whether a candidate crosses an error budget. A fixed trip count makes the search deterministic, and cannot make that threshold map continuous. The skeleton reference now participates in the one convex objective instead.                                                                                                                                                                                                                                |
| **Judging or rescaling candidate splits after the fit**                       | Removed with the walk. `solveHandleScale` and candidate normalization optimized a second answer on a second objective. The current solver has no candidate family. Fit, reference and bounds produce one minimizer.                                                                                                                                                                                                                                                                                         |
| **Measure the pin in rendered (post-nudge) space**                            | Correct while nudges carried handles. Superseded once they stopped. Construction space makes the pin _independent_ of the on-curve gizmo, instead of coupled to it.                                                                                                                                                                                                                                                                                                                                         |
| **Reproduce a pinned mean by scaling both tensions**                          | A preserved ratio caps the reachable mean at `2r/(1+r)`, which is 0.6 on a 0.3/0.7 split. The control then stopped at a value that was neither 1 nor stable. It is also not what the drag does. Use one shared increment instead.                                                                                                                                                                                                                                                                           |
| **Swap the rib modifier pair** (plain for width ↔ Z for tangent)              | Built twice, reverted twice. Z exists precisely because a tangential rib move is the _rarer_ intent. A plain drag reaching for the width is what the tool is for.                                                                                                                                                                                                                                                                                                                                           |
| **Drop Z as the gate on generated geometry**                                  | Built, reverted. The gate is the safety on derived geometry, not an accident.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Equalize the reaches from the on-curve gizmo**                              | Built, removed. Only the curvature gizmo equalizes. The closed form, if anyone ever wants it: the control's one degree of freedom moves one end by `−s` and the other by `+s`, so `s = (r₀−r₁)/2`.                                                                                                                                                                                                                                                                                                          |
| **Hide all generated nodes to stop them looking selected**                    | The wrong fix for a real bug. The node iterator read a null index list as "every point", and an empty selection parses to no list. Only off-curve nodes are hidden, and only in gizmo mode.                                                                                                                                                                                                                                                                                                                 |
| **Delete the tension bound because it never fires**                           | It does fire. Kept, floored at a third of the chord. The instrumentation that answered the question is removed. Its `active` count was not a measure of hard pinning: it counted any touch inside the blend window, and someone misread it once as 34% where the true figure was 2 cases in 118.                                                                                                                                                                                                            |
| **Iteratively rematch samples to a candidate cubic**                          | This was the jitter. Where one cubic cannot represent the offset, the least-squares iterate can self-intersect, and Newton projection onto it is multivalued. One sample walked t = 0.907 → 0.200 → 0.319 → 0.635. Bounding the loop reduced the symptoms and did not remove the branch changes. A fixed trip count gives determinism, not continuity. The automatic path now keeps fixed source-parameter samples.                                                                                         |
| **Ease the fit's tension ceiling over a blend window**                        | It bought C1 continuity where the contract asks only for continuity. The price was landing a few percent under whatever it was given. It is also what forced the ceiling into three variants (eased, exact, exempt) and forced the pin into an exemption. One exact clamp is continuous and 1-Lipschitz. Do not reintroduce a smooth bound to "protect" a stage. Put the stage inside the box instead.                                                                                                      |
| **Judge a split walk by max or RMS sample error**                             | Both metrics belong to the removed threshold search. Max exposed the fault first, because its plateau edge moved abruptly. RMS reduced that symptom and still left a candidate-dependent decision. Neither metric is part of the current automatic path.                                                                                                                                                                                                                                                    |
| **Clamp how far a generated handle may move between frames**                  | It is the only fix that works on a discontinuous geometry function, and it buys continuity by adding history. The output then depends on which direction the designer dragged from, and two masters reaching the same skeleton disagree. Continuity is a property of the construction, or it is nothing.                                                                                                                                                                                                    |
| **Scale the handles by endpoint parallel-curve speed alone**                  | Continuous, and too local to be right. Strong taper or an approaching cusp collapses one handle while the other reads healthy, because neither endpoint can see what the middle of the segment is doing.                                                                                                                                                                                                                                                                                                    |
| **Blend the fit and the skeleton answer by a representability score**         | Three separate faults. The score's steep region lands on tapered segments, which are the most ordinary non-trivial case, and whose error is a direction error that no handle length can absorb. A weight read off the achieved residual closes a feedback path from the answer into how much the answer counts. A steep sigmoid is a threshold with a slope, the same species as the eased ceiling withdrawn twice.                                                                                         |
| **Score the system's rank by its normalized determinant**                     | Calibrated in the wrong place. Half strength at a determinant of `1e-6` of the squared trace is a condition number near a million, while the answer is already too sensitive at ten thousand. So it does nothing across the whole range where conditioning actually bites. Making the objective strictly convex deletes the quantity it was measuring.                                                                                                                                                      |
| **Emit several cubics per skeleton cubic**                                    | It would improve the approximation. It also changes point topology, provenance, interpolation and every segment-level control at once. Point-count stability is the interpolation contract (§3). The curvature gizmo is the affordance for what one cubic cannot express.                                                                                                                                                                                                                                   |
| **Keep `handleTensions`' null return for "no reach ahead"**                   | The null existed so that its one caller could skip the whole shaping stage. That meant a segment whose tangent rays met behind an endpoint silently got no equalization, no pin and no ceiling. Defining `reach` once, finite and positive (§3.2), deletes the case instead of the check. The function is gone from `tunni-calculations.js`.                                                                                                                                                                |
| **Build the serif terminal against the cut it made in the EMITTED edge**      | Built, reverted, and still closed. It does fix the step a flank-built terminal leaves on a curved approach, and it fixes it by making the terminal a function of the emitted edge's shape. So a curvature pin, whose whole job is to reshape that edge, walked the release and the straight run's bottom along the stroke. Reading the wall as SOLVED, before any authored layer touches it, is not the same thing and is what the terminal does now (§8).                                                  |
| **Place the serif's shared points on a straight flank line from the rib end** | Closed 2026-08-08. The line is the wall only on a straight stem. On a curved one the wall was dragged onto the line and its handle turned, and both grew with the depth the serif reached at — so tip thickness, which sets that depth, reshaped the stem by up to 23 units. The wing's top surface now meets the wall itself, and the wall is cut where it is met.                                                                                                                                         |
| **Apply a curvature pin to a serifed terminal before the trim**               | Closed with the above. The serif finds its release ON the wall, so a pin applied before the cut reshapes the wall the release is found on and walks the whole terminal up and down the stem. All three authored layers now go behind the cut, which also makes the stored pin mean the segment the gizmo measures.                                                                                                                                                                                          |
| **Lean the whole serif frame with the stroke**                                | Built, reverted. Under a rib angle lock the wall leans against a flat foot, so shearing the frame makes the two halves match under the lean and puts the cupped foot centre back on the skeleton. It also puts the tip's outer edge parallel to the stem, which deforms the wing, and it does not remove the bracket asymmetry in glyph space — it only makes it symmetric in a coordinate system nobody is looking at. The serif's own shape is square to its foot; only the wall follows the stroke (§8). |
| **Let `tension` and `concavity` scale each other**                            | Built, reverted. Two sliders over one product means that either one at zero cancels the other. Both defaulted to zero, so a fresh serif drew a flat bevel and neither slider appeared to do anything. They are now a length and a balance over the same corner-aimed construction, and they are independent.                                                                                                                                                                                                |
| **Rebuild the parameter form on every field change**                          | `setFieldDescriptions` exists for this, and it clears `innerHTML`. So an arrow-key edit destroyed the input it came from and took the focus with it, one increment per click. The panel now compares a layout signature, and writes values in place when only values changed, skipping whichever field the user is currently in.                                                                                                                                                                            |
| **Read a generated segment's curvature from its emitted points**              | Correct until a terminal trimmed one. The generator reproduces the pin on the whole segment, while the emitted part can be much shorter, by 83 units on a real serif. The gizmo therefore displayed a number that meant something else, and the first drag jumped the shape. `constructionSegment` on the inserted point's provenance is the fix. Every reader goes through `generatedSegmentConstructionPoints`.                                                                                           |
