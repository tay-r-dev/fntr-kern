# Skeleton Feature Model (forkra)

**Reframed:** 2026-07-25 — from a donor-code review into a description of
**forkra's own** skeleton code, verified against the tree.
**Companion to** `FEATURE-ARCHITECTURE-MAP.md`: that doc says _where_ the
skeleton files are and _who owns them_; this one is the conceptual **mental
model** — what the feature is, how the generation pipeline works, and which
behaviors must be preserved when you touch it. The design _rationale_ (C1–C4,
the defects it answers) lives in the map's §9.

The design specs and implementation plans that produced the offset construction,
the generated-segment gizmos and the curvature pin have been **dissolved into this
doc and the map** — §3.2, §7 and §8 here carry their durable content, and §8 in
particular is the register of what was tried and rejected. The narrative of how
each landed is in `DEVELOPMENT-LOG.md`.

Line numbers drift; **function names are the durable anchors** here. Verify
against the code before relying on any specific location (`skeleton-generator.js`
alone is ~5,200 lines).

---

## 1. What the feature is

Stroke-based glyph design. Instead of drawing filled outlines directly, the
designer draws **centerline contours** ("skeletons") — ordinary point/handle
paths — and attaches a **stroke width** to each on-curve point. The filled
outline contours are generated live: every edit regenerates the outline. The
generated contours are ordinary path contours (they export, interpolate and
render like hand-drawn ones); the skeleton itself lives in
`customData["fontra.internal"].skeleton` and is invisible to any consumer that
doesn't know about it.

Everything else is elaboration of that one idea:

- **Ribs** — the width at a point, drawn as a bar across the centerline,
  draggable at both endpoints.
- **Caps** — how open ends close: `butt` / `round` / `square` / **`drop`**
  (forkra added the drop cap), each parameterized.
- **Corner rounding** — sharp outline corners from non-smooth skeleton points,
  rounded per point, asymmetrically per side.
- **Editable generated geometry** — individual generated outline points and
  handles can be marked editable and offset from their computed positions
  (nudges, handle offsets, detached handles) while remaining _generated_.
- **Single-sided contours** — all width on one side; the other lies exactly on
  the skeleton.
- **Modifier behaviors** — D (fixed-rib), S (fixed-rib-compress), X (equalize),
  Z (tangent-only rib drag), held as realtime keys during drags. A plain rib drag
  changes the width; **Z** slides the rib end along its tangent instead and
  carries the adjacent generated handles with it, so it reads as an ordinary
  on-curve edit; **Z-Alt** slides the on-curve and leaves the handles. A generated
  handle moves only under Z, and Alt on one at a smooth point equalizes. Both
  entry points to the tangent nudge — the rib gizmo and the generated on-curve,
  which sit at the same place — derive the handle carry from the behavior name
  inside `createSkeletonRibTargetEntries`, so they cannot disagree about it.
- **D/S expansion offsets the centerline.** Every selected on-curve moves the same
  distance along its own normal, which makes each affected segment a
  constant-distance offset of itself — or a tapered one where only one of its ends
  is selected — so the drag runs `offsetCubicSide`, the generator's own
  construction, on the skeleton. Handle directions are kept and their lengths
  scale by `1 + d·κ`. It carries whole tied rib groups (§3.0), and on a
  single-sided contour it moves no skeleton at all: the centerline is one edge
  there, so only the width changes.

  **It stops where the ribs run out, per point.** No side may be driven under one
  unit of half-width, so no rib under two units of stroke. A point that reaches
  that floor stops narrowing _and stops moving_ — the two go together, because the
  whole point of the drag is that the anchor edge stays pinned, and a point that
  keeps travelling after its width has given out drags that edge along with it. Its
  neighbours are unaffected and carry on until they reach the floor too, so a
  narrow point cannot hold up a wide one, and the drag comes to a complete stop
  only when every affected rib is at the floor.

  Three things all have to be held back by that same per-point allowance, and each
  one was found leaking separately: the point's own travel, the **far** side's
  width (linked ribs move both sides by one amount, so the far side can reach the
  floor first — and when it does the drag is over, because that edge is down on the
  skeleton), and the segment's **handles**. The handles are the one that hides:
  scaled by the raw drag while the on-curves were held, they keep the shape moving
  after everything else has stopped, and only on a curved skeleton — which is every
  real one. A straight-skeleton test will not see it. A tied group is held to
  whichever member reaches the floor first, since the group shares one offset by
  definition.

  **On a single-sided contour the drag owns the total, not a side.** The visible
  edge is the sum of the two stored half-widths, so that sum is what the drag
  writes, and the split between the two sides is left exactly as it was. That split
  is the distribution the point returns to if the contour goes back to
  double-sided, and it is invisible while single-sided is on — a drag that rewrote
  it would be changing a shape the designer cannot see. It survives to within grid
  rounding, which is as well as it can survive: the sides are whole units, so a
  60/20 split at a total of 90 wants 67.5/22.5 and has to land on 68/22. The panel
  greys the per-side numbers and the distribution while single-sided is on, rather
  than hiding them, so it reads as kept rather than lost.

- **Rib angle lock** — `ribAngleLock` on a point forces its rib onto an axis
  (`"horizontal"` / `"vertical"`, named for the way the rib runs), overriding the
  normal the geometry computes and keeping the sign so the sides stay put. Offered
  on open-contour endpoints, where it makes a terminal read flat and axis-aligned
  whatever angle the centerline arrives at, and it applies under **every** cap
  style — it sets the rib the cap is built on. `getEffectiveNormal` in
  `skeleton-model.js` is its single implementation; the generator imports it.
- **Tunni points** on skeleton curve segments.
- **Generated-segment gizmos** — two per generated cubic, on their own layers:
  one sets the segment's curvature, one slides its two ends along the outline.
  See §7.
- **Per-source defaults** — new points inherit widths/caps from source-level
  settings, keyed by glyph case.

## 2. The data model

Schema and accessors live in `fontra-core/src/skeleton-model.js`. The
load-bearing choice is **stable ids**: contours and points carry ids that
selection, provenance and undo reference instead of array indices, so structural
edits can't silently retarget them (arch map §9).

Per on-curve point: `x, y, smooth`, width fields, `nudge` (tangential rib-end
displacement), `editable` flags per side, cap params, corner params
(`cornerRoundness`, `cornerAsymmetry`, reach), rib-angle overrides, and generated
handle offsets/detached flags. Off-curve points are `{x, y, type: "cubic"}`.

**The width of a side is a fallback cascade, not a stored value** — and it
survived the port (`getPointHalfWidth` / `getPointWidth`,
`skeleton-generator.js:290,310`):

```
halfWidth = point.<side>Width  ??  point.width / 2  ??  contour.defaultWidth / 2
```

This matters: a point with no width fields is a _live consumer_ of the contour
default — change `defaultWidth` and un-overridden points follow. Keep this
cascade intact; materializing widths onto every point silently kills it. (An
earlier normalization draft did exactly that; the current code does not.)

## 3. The generation pipeline

`generateFromSkeleton(skeletonData)` (`skeleton-generator.js:56`) is the entry
point: it loops contours (`generateContoursFromSkeleton`) and, per contour, runs
`generateOutlineFromSkeletonContour` (`:1311`), then **emits forward
provenance** — `annotateGeneratedContourProvenance` stamps every generated point
with `{skeletonPointId, side, role}` (arch map C3). The per-contour pipeline is
pure and independent (contour _i_'s output depends only on contour _i_):

0. **Direction ownership** — before any offsetting, note which on-curve points do
   **not** own their own direction. A smooth point with only **one** handle
   cannot be defined by that handle: smoothness forces the handle to be colinear
   with the straight segment on its other side, so the straight sets the
   direction and the handle follows. Its rib is perpendicular to that straight,
   not to a miter average (`isStraightControlledSmoothPoint` →
   `straightSegmentNormal`).

   **One such point anywhere on a straight ties the ribs at _both_ of its ends**
   to a shared offset, so the whole projected straight moves as a unit
   (`collectTiedRibGroups`, the single definition of the rule; `coupledHalfWidths`
   then gives every point in a group the mean of the group's stored half-widths
   per side, so adjusting any one width moves them all). The mean is chosen
   because it is symmetric and continuous in every input. The far end does not
   have to be straight-controlled itself — an ordinary corner or a contour
   terminal is tied just the same, because what forces the coupling is the
   controlled point, not the pair. Straights that share an end point merge into
   one group: that shared point has one rib and cannot sit at two offsets.

   **This is the one place ribs are deliberately coupled.** Ribs at different
   offsets tilt the generated rib-to-rib line away from the skeleton straight,
   and the generated handle at the smooth point is re-collinearized against that
   line in order to keep the outline smooth (`enforceSmoothColinearity`, the
   on-curve neighbour cases), so it rotates as width changes: measured over a
   half-width sweep of 8..34 at 8.5° with both ends controlled and ~16° with
   one, the two sides shearing opposite ways. Locked in by "keeps handles fixed
   when width changes across a mutually-controlled straight" and "…when only one
   end of the straight is controlled", plus the `mutually-controlled-straight`
   and `one-ended-controlled-straight` fixtures.

   What survives the coupling at a corner far end is second-order: the miter
   normal is the straight's normal _rotated_ by a quarter of the corner's turn,
   so the part of it that still tilts the projected straight is
   `2·hw·sin²(turn/4)` — 0.4 units at the widest end of that sweep, under the
   ~0.3° the grid itself imposes on a handle this long. Do not chase it.

   **Opt-out:** `width.tied` on either end (panel: "Tied ribs", under "Linked").
   Default on, so existing data keeps the coupling; clearing it on _either_ end
   frees that straight and the handles rotate with width again (16.3° over the
   same sweep). That is a deliberate trade for independent rib widths here, not
   a bug — do not "fix" the rotation while a straight is untied. Only the shared
   _offset_ is optional; the rib staying perpendicular to the straight is not,
   because it follows from the point having no direction of its own.

   **Everything that shows or edits a tied rib must use the coupled value, not
   the stored one.** `getEffectiveRibHalfWidth` is that value and
   `getTiedRibGroup` is the membership test, both in `skeleton-model.js` beside
   the normal computation the gizmo uses. A rib drag pulls its whole tied group
   into the executor set (`collectSkeletonRibSelection`, gated to width-changing
   drags — nudge is not tied), so all the stored widths move together and the
   outline tracks the cursor exactly. Skipping either of these produced the
   original report: the dragged gizmo travelled twice as far as the outline and
   its partner did not move at all.

1. **Segmentation** — `buildSegmentsFromPoints` splits the point list into
   on-curve→on-curve segments carrying their off-curve controls.
2. **Per-segment offsetting** — each side's outline is offset by its half-width.
   Line segments project endpoints along the rib normal. Cubic segments keep
   skeleton handle directions; endpoints remain the exact construction rib
   positions, so the only free numbers are two handle lengths, and choosing them
   is the whole of `offset-cubic.js`.

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

   `natural-handle-solver.js` owns the automatic answer. It samples the true
   requested offset at `t = 1/8, 1/4, 1/2, 3/4, 7/8`; sample identity never
   changes and no sample is projected onto a candidate curve. With the endpoints
   and axes fixed, each sampled perpendicular error is affine in the two
   normalized handle tensions, so their squared sum is one two-variable
   quadratic.

   The fit is pulled toward the skeleton's own normalized start/end tensions.
   Its ratio is computed before the solve from only cusp proximity and normalized
   width taper; it never reads a residual or a candidate answer. The absolute
   pull uses the fixed frame's unprojected influence scale, with a positive
   floor, so a rank-deficient projected fit cannot also erase the regularizer.
   The resulting objective is strictly convex and has one answer.

   The exact minimizer is found inside the positive non-crossing rectangle by
   comparing the interior stationary point, the four edge minima, and the four
   corners on that one objective. There is no iterative refit, candidate
   rematching, magnitude re-solve, error-budget walk, or tie-break. Active box
   faces can change, but the minimizer meets continuously where they do.

   `offset-cubic.js` owns the authored layers after that automatic answer.
   Attached adjustments are grid-resolved displacements from it; a stored pin
   then shifts both normalized tensions to the requested harmonic mean; detached
   handles finally replace their side with the absolute grid position the
   designer placed. This ordering is product behavior, not an implementation
   detail.

   **The domain separates its coordinate scale from its geometric ceiling.**
   The scale used to normalize each handle is the signed tangent-ray distance,
   floored at a third of the chord and capped at twice it. The floor prevents a
   forward intersection sliding onto an endpoint from squeezing a handle to
   almost zero and then springing it back; the cap prevents near-parallel rays
   from giving the fit an unbounded lever arm. A parallel or behind intersection
   retains the chord-cap fallback.

   A positive forward intersection remains the actual non-crossing maximum. If
   it lies below the scale floor, that end's maximum normalized tension is
   `realReach / scaleReach`, below 1, so the emitted length can still land no
   farther than the intersection. Between the floor and cap, geometric and
   normalized tension 1 coincide. Beyond the cap, the cap is conservative.
   Because the scale remains finite and positive, every stage still works in one
   tension coordinate system without mistaking its stabilizer for geometry.

   The ordinary lower face is the one-unit handle floor. If a real forward reach
   is shorter than one unit, non-crossing wins and the minimum contracts to the
   maximum; creating a loop cannot preserve a meaningful grid direction.
   Automatic fit, attached adjustments, and pins all consume these same per-end
   limits. Detached handles remain intentionally absolute authored geometry and
   are applied after the constrained construction.

   A side under ~0.5 units ("collapsed") skips all of this and copies the
   skeleton verbatim — this is what makes single-sided contours exact.

   **A nudge is an emission post-step, never an input to handle construction.**
   `ribNudgeDisplacement` moves the emitted on-curve along its corner-aware
   tangent. The interaction contract has two independently accumulated scalars
   per side:

   - `nudge` is the rendered on-curve displacement;
   - `handleNudge` is the portion accumulated by ordinary Z-mode drags and is
     emitted on adjacent handles after the construction pipeline.

   Default gizmo drags and Z-Alt drags change only `nudge`, so adjacent
   off-curves remain byte-identical. Z-normal changes both scalars, so it behaves
   like an ordinary on-curve edit and carries the off-curves. A later Alt-style
   edit leaves the earlier carried handle position intact. This is deliberately
   separate from `handleOffsets`: carry must also work where no forward tension
   reach exists and an attached adjustment is therefore inapplicable.

   On-curve provenance publishes the nonzero on-curve nudge vector so a
   screen-space gizmo can subtract it and recover the construction rib end
   exactly. The `nudged-cubic-endpoints` fixture deliberately records the
   default/Alt contract.

   **The continuity contract governs the automatic answer.** Regeneration runs
   on every frame of a drag, so a one-directional skeleton edit must not reshape
   the generated segment by jumping or backtracking. The contract is now
   structural: fixed sample identity; no projection, root finding, iterative
   refit, convergence decision, or error-budget threshold search; one strictly
   convex objective; one input-only pull ratio; and exact minimization in the
   positive non-crossing rectangle. Fixed trip count alone is only determinism
   and did not make the superseded candidate-rematching path continuous.

   Three discontinuities are deliberate and no continuity test may span them:
   the 0.5-unit collapsed-side threshold, the forward/behind tangent-intersection
   event, and grid rounding at authored placement or generator emission.

   **Two limits here are permanent, and neither is a bug to chase.** First,
   generated handle direction is skeleton-owned (§3, and it is what keeps the
   smoothing pass inert). On a **tapered** stroke the true offset's tangent is
   not parallel to the skeleton's — measured at 6°–79° across realistic tapers —
   so a tapered segment deviates from the true offset by 3.6–14.4 units against
   0.11–0.49 at constant width, and no choice of handle _length_ can absorb a
   direction error. Tilting the axis per end would recover almost all of it and
   is **rejected**: the axis is skeleton-owned and stays that way. Second, where
   the offset distance approaches half the endpoint curvature radius — a bold
   stroke on a tight curve — a single cubic **cannot** represent the offset at
   all, and point-count stability forbids splitting the segment. Errors there run
   into the hundreds for every strategy including a numerical optimum. Both
   limits are why the curvature gizmo (§7) exists: where the automatic answer
   cannot be right, the designer gets the control rather than the collapse.

3. **Corner rounding** — `roundSharpCornersOnSide` replaces non-smooth generated
   corners with an arc (two on-curves + handles). Corner metadata rides on the
   generated on-curve points (`buildGeneratedOnCurve`) and is stripped before
   output (`stripCornerRoundMetadata`). A pairwise pass shrinks adjacent trims so
   they can't overlap.
4. **Caps** (open contours) — butt / round / square / drop, built from the two
   side ends plus tip points; handle lengths come from a tension parameter.
5. **Assembly** — `left + endCap + reverse(right) + startCap` → one closed
   contour (`reverseContour`). Closed skeletons instead emit **two** contours
   (outer + counter-wound inner).
6. **Smoothing** — `enforceSmoothColinearity` re-collinearizes handle pairs
   around smooth on-curves. When both handles descend from the same skeleton
   point they carry the axis they were constructed on (`_axis`, stamped at
   emission, stripped with `_provenance`) and `sharedLockedAxis` uses it
   directly. Only handles without that axis — caps, line-segment ribs,
   corner-rounding output — fall back to the length-weighted, rotation-capped
   estimate.

   **The axis must not be derived from handle length.** Rib width changes
   generated handle length, so a length-weighted axis rotates whenever width
   changes: measured at 1.1° mean and 12.5° worst per single unit of width
   before the axis was taken from the skeleton. Deriving it from the _rounded_
   handle positions is the same trap, because the grid snap is what makes the
   direction length-dependent in the first place. Locked in by
   "keeps the smooth-junction handle axis independent of rib width".

   This pass writes handle positions **unrounded**, deliberately: re-snapping
   to the grid here would undo the colinearity it just established, and worst
   on short handles, where a unit of rounding is a large angle.

**Grid rounding happens at every stage**, not once at the end. It is also what
makes handle _direction_ length-dependent: a handle emitted at
`round(ribPoint + axis · length)` carries its axis only to within
`atan(0.7 / length)` — about 1.3° at 32 units, 4° at 10, and 45° at 1, where the
eight lattice neighbours are the only directions expressible at all. So any
later stage that re-derives a direction from rounded coordinates inherits a
width dependence, because width sets the length.

Handles at the 1-unit floor (`MIN_HANDLE_LENGTH`, plus the `Math.max(along, 1)`
clamp in `projectHandleOntoDirection`) therefore express only three directions —
axis-aligned and diagonal — and degrade colinearity at that size. **This is
accepted, not a defect:** ordinary on-curve points behave the same way at that
scale, so the generated outline is consistent with hand-drawn geometry. Do not
"fix" it by raising the floor or by allowing sub-unit handle coordinates.

**Point-count stability is a hard constraint.** The generated point count must
stay constant across parameter values, or cross-master interpolation breaks. Any
change to outline geometry must preserve it (arch map §8 delegation recipe).

## 4. How forkra differs from the donor (the redesign)

forkra re-integrated the feature; it did **not** merge the donor's plumbing. The
donor still sits read-only at **`_external/skeleton`** (pinned at `fd76d3abe`,
gitignored) as a behavioral reference — `git -C _external/skeleton …` — never a
source to copy plumbing from. Three differences are load-bearing and must not be
undone (full rationale: arch map §9):

- **One write path.** All editing-side mutation flows through `editSkeleton`
  (`skeleton-editing.js`), the only caller of the generator on the edit side.
  The donor mutated from dozens of call sites; forkra does not.
- **Forward provenance, never geometric recovery.** "Which skeleton point owns
  this generated point?" is a provenance-map lookup. The donor reverse-mapped by
  re-projecting ribs and comparing coordinates with tolerances; **none of that is
  in forkra** — do not reintroduce it.
- **Modifiers inside the behavior model.** D/S/X/Z are behavior names and
  executor variants, not the inline pointer branches / bypass flags the donor
  used (which regressed equalize five times).

## 5. What must be preserved

Losing any of these regresses the product:

- **The width fallback cascade** (§2) — one-field "reweight this whole contour."
- **The collapsed-side rule** (§3.2) — a side under ~0.5 units lies exactly on
  the skeleton; this is what makes single-sided and open-counter constructions
  predictable.
- **Corner metadata riding on generated points** (`buildGeneratedOnCurve` →
  `roundSharpCornersOnSide`) — a per-skeleton-point parameter acting at the right
  place in outline space, after both sides exist. It's also the natural carrier
  for provenance.
- **Pairwise corner-trim limiting** — stops adjacent rounded corners eating each
  other; easy to lose in a reimplementation.
- **Point-count stability** across parameter values (§3) — the interpolation
  contract.
- **Fixed sample identity** (§3.2) — the automatic solve always uses the same
  five source parameters. No projection, root finding, iterative refit, or
  error-budget search belongs in this path.
- **One strictly convex automatic objective** — the perpendicular fit and
  skeleton-reference pull are minimized together, so there is one minimizer and
  no candidate tie-break.
- **An input-only pull ratio** — it may read only skeleton geometry and endpoint
  widths, never the achieved residual or answer. Its absolute weight uses a
  positive unprojected influence scale that cannot vanish with the projected
  Hessian.
- **The positive non-crossing handle domain** — automatic and attached/pinned
  lengths remain between the one-unit floor and the true forward tangent
  intersection. Where the intersection is shorter than one unit, non-crossing
  wins; the stabilized tension scale never replaces the geometric ceiling.
- **Authored ordering** — natural answer, attached adjustments, pinned
  harmonic-mean tension, then detached absolute handles.
- **The three explicit topology/emission events** — collapsed-side threshold,
  forward/behind tangent-intersection event, and grid rounding. Continuity tests
  must not silently span them.
- **A pinned curvature is permanent** (§7) — the generator reproduces the stored
  number through skeleton, width and taper edits, clamping only its output. A pin
  that drifts makes the control pointless.
- **The rules-tables interaction feel** — skeleton points behave exactly like
  path points under Shift/Alt because they run the same rules (C1). This is the
  feature's best UX decision.

## 6. Known cleanup candidates (verified in the current tree)

Not bugs — carried-over cruft and structural weight. Each is verified present
today; treat as opportunities, not mandates, and confirm before acting.

- **Round-once opportunity.** Grid quantization at every pipeline stage (§3) is
  the reason `lockNearZeroHandleDirection`, the `NEAR_ZERO_*` constants and the
  rotation clamp exist. Keeping interior handles in floats and rounding once at
  the boundary (`outlineContourToPackedPath`) would let several defensive
  subsystems shrink. Larger change; measure first.
- **The generator is the monolith.** `skeleton-generator.js` at 4,466 lines is
  defect **P6** (arch map §9) still biting — the single largest file in the fork.

(The donor's dead `mergeCap` branches and `generateSampledOffsetPoints` are
already absent from forkra — nothing to do there.)

## 7. The generated-contour controls

Two gizmos per generated cubic segment, per side. They are different animals and
must not be collapsed into one: one owns the segment's **curvature**, the other
owns where its two ends **sit along the outline**. Both are separate visual
layers, so density is a non-issue, and both are the affordance the two permanent
limits in §3.2 call for.

### The curvature gizmo pins a number, not a displacement

It sits **on** the curve, at `t = 0.5`, and drags along the axis from there
toward the segment's tangent-ray intersection: toward it fills the curve out,
away flattens it. What it stores is the **segment tension it arrived at** — a
number, not a positional offset — and regeneration reproduces that number
whatever the skeleton has done since. This is the whole point of the control: an
adjusted curvature that drifts when the skeleton moves is not an adjustment.

The number is meaningful because a cubic segment's tension is **exactly the
harmonic mean of its two handles' individual tensions**: with `t₁ = a/b` and
`t₂ = c/d`, `τ = 2·t₁·t₂/(t₁+t₂)`. So two handle lengths decompose into two
orthogonal quantities — a **magnitude** (the mean, which the pin owns) and a
**split** (how the two sit either side of it, which per-handle adjustments and
equalization own). Because they are orthogonal, the pin and a hand-placed handle
compose without a precedence rule, and neither overwrites the other. That
identity is the load-bearing fact behind the whole pipeline order in §3.2; the
conversions live once in `tunni-calculations.js` and must not be re-derived.

Rules that hold everywhere:

- **The ceiling is 1.** Tension 1 puts the handles on the tangent intersection,
  the fullest a cubic gets before it distends; a circular arc sits at 0.5523, and
  across a realistic sweep the accuracy optimum never asked for more than 1.04.
  A drag cannot store more than 1. The two handles saturate **independently** —
  when the leading one reaches 1 it stays, and the trailing one stays responsive
  until it reaches 1 too, or part of the control's valid range is unreachable.
- **Unreachable pins clamp; they never release.** Where the geometry cannot
  express the stored number, the _output_ is clamped and the _stored number is
  never rewritten_, so the segment returns to exactly what was set once the
  skeleton comes back into range. Nothing in generation ever writes this field —
  only a drag does.
- **A pin is bounded by the same box as everything else, and needs no exemption.**
  It used to need one: the ordinary tension ceiling eased into its limit over a
  blend window, so a handle sitting exactly on the limit came back about 3.75%
  short, and a pin of 1 therefore rendered as 0.91–0.96. The pin had to enforce
  the ceiling itself and the older bound had to stand down for it. With one exact
  ceiling (§3.2) the pin saturates at tension 1 and so does the box, so they
  agree by construction and the "not bounded twice" rule has nothing left to say.
- **Stored per segment per side, keyed on the segment's START point.** Direction-
  independent, which matters because the right-side contour is emitted backwards
  and its segments carry `in` before `out` — keying on emission order would
  address the two sides inconsistently. So an `out` handle owns the pin at its own
  skeleton point, and an `in` handle's pin belongs to the previous on-curve point.
- **A direct handle drag on a segment clears that segment's pin**, before writing
  its offset. The hand is the later and more specific answer to the same question
  and has to win, or the segment fights the cursor. Only that one segment; the
  handle's other neighbour keeps its own pin. Moving a generated **on-curve** does
  not clear it — the pin is independent of the nudge by construction (§3.2) — and
  neither of the panel's two handle controls clears it, because neither places a
  handle by hand: "reset handles" is deliberately narrower than a rib reset, and
  the detach toggle writes offsets only to hold a handle where it already is.
- **Clearing the pin must not move anything.** The pin contributes length to both
  of its segment's handles, so a bare clear snaps them back to the fit's own
  answer — the curvature just set, thrown away the instant a handle is touched.
  The pin is therefore **baked** first: one regeneration with it cleared measures
  how far each of the two handles moves, and that difference is stored as a
  per-handle offset. Both handles, because only one is ever under the cursor.
  Detached handles are skipped — they are absolute and never saw the pin.
- **The full rib reset does clear it**, alongside the nudge and the handle
  adjustments, on the segment _leaving_ that point.

**A new per-point field is invisible to the generator until it is copied across
explicitly.** `canonicalToGeneratorInput` flattens every point before generation,
and the model's own accessors do not work on the far side of that translation.
The pin failed silently exactly this way once — stored fine, read back fine
through the accessor, did nothing at all, because the generator saw `undefined` on
every segment. It travels as `leftSegmentCurvature` / `rightSegmentCurvature`.
Any future per-point field has the same trap.

### The automatic split follows the skeleton reference

The natural solver does not equalize in a later stage. The skeleton's own
normalized handle tensions are the reference inside the same strictly convex
objective as the perpendicular fit. Ordinary representable offsets use only the
small conditioning floor; near-cusp and tapered inputs raise the reference pull
by one global, input-only formula. The fit and reference therefore negotiate one
answer instead of handing a candidate to a second error-budget decision.

The calibrated ratio has four global constants: a small positive floor, a sharp
near-zero cusp gate, and independent cusp and taper gains. Separating the gains
matters: a shared peak coupled two different failures, so enough authority to
stabilize a tapered outward side made an inward near-cusp transition too steep.
The selected constants are recorded in the development log, not tuned per glyph,
side, or fixture.

**A near-symmetric skeleton must not generate a near-degenerate pair.** That
property is tested directly across near-cusp widths, while monotone U¹ sweeps
cover both single-sided directions, both double-sided generated sides, taper,
pins, attached adjustments, and detached handles. The pull is a regularizer
inside one objective, not an error allowance and not a second-stage threshold.

### The on-curve gizmo

Sits **off** the curve: anchored at the segment midpoint and displaced along the
**outward** normal. Outward follows from the contour's signed area, so counters
come out correct. One placement function serves both the drawing layer and the
hit test, and both take the distance from the same constant, so they cannot
disagree about where the control is.

**The displacement is one constant, in glyph units** — the same everywhere on the
glyph, zooming with the letter. Two rules that vary it were built and rejected in
use, and are not to be reintroduced without a fresh reason: a **screen** constant,
which holds its pixel size at every zoom but grows without bound in glyph space, so
zoomed out the control drifted a large fraction of the letter away from the outline;
and scaling by the **local stroke thickness**, which is defensible on paper — the
gizmo does mark an offset from an outline — and reads as unsettled in use, because
the gap then changes with every width edit.

It is tangent-constrained, like every on-curve gizmo in this editor, and it
writes the same `nudge` the panel writes — one number, two affordances. Its drag
is read in **absolute** coordinates: up or right spreads the segment's two ends
apart along their own curves whichever way the segment happens to point, because
a control whose meaning rotated with its segment would need re-learning at every
joint.

**It is only offered where an end can actually move.** An end may be nudged only
if the skeleton segment on the _far_ side of it is a straight line, or does not
exist because the contour ends there; a curve attached there holds that end. With
one end movable the whole spread goes to it; with neither, the gizmo is not drawn
and not hit-tested. A drawn control that cannot move is worse than no control.

### Gestures and readout

- **Drag** — the gizmo's own function.
- **Ctrl+shift click on the curvature gizmo** — equalize the two handle tensions
  fully, leaving the segment's curvature exactly where it is. It waits to see
  whether the pointer moves before deciding, so holding the modifiers never costs
  the drag. Only the curvature gizmo has this: it owns the split. The on-curve
  gizmo has no modified gesture.
- **Double-click** — reset. On the curvature gizmo, clear the pin and both handle
  adjustments, returning the segment to what the fit produces. On the on-curve
  gizmo, zero the nudge at both ends.
- **A switchable label layer** draws each generated segment's construction-space
  tension just above its curvature gizmo, in the point-label face, with a dot when the
  number is a stored pin rather than the fit's own answer. During a curvature drag
  the drag readout shows the same value whatever the switch is set to. This is how
  a pinned segment is told from an automatic one.

Undo labels name the **effect**, never a donor control: "Equalize Generated
Handles", "Reset Generated Curvature", "Reset Generated On-Curves".

### Mirroring swaps sides

A mirror has negative determinant, so the geometric left of the mirrored
centerline is what the stored data calls right. On a determinant flip, every
per-side field swaps (`width`, `nudge`, `handleNudge`, `locked`,
`segmentCurvature`, the four handle offsets, `capBallSide`) and `capAngle` and
`cornerAsymmetry` negate. Handle adjustment vectors get the affine's linear part
only, never the translation, whether or not sides swap. `reversed` needs no
change: mirroring flips the outline's winding and swapping the sides flips the
emission order back. Contour-wide ownership (`singleSided`, `capBallSide`) can
only be swapped when the **entire** contour is in the selection.

## 8. Closed decisions and dead ends

Each of these was designed or built, then measured or used, and withdrawn.
Recorded so none is re-derived from first principles — several were re-proposed
once already.

| Idea                                                                 | Why it is closed                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restore the old sample-and-fit offset path**                       | Adaptive threshold jumps a step when an input nudges, so output is discontinuous and two masters land on different answers; endpoints become free samples, destroying provenance; variable curve count destroys point-count stability.                                                                                                                                                                                                |
| **Tilt the generated handle axis to the true offset tangent**        | Recovers nearly all of the taper defect and is still rejected: the axis is skeleton-owned (§3.2). A single shared tilt recovers under half the gain and is _worse than pinned_ on some cases.                                                                                                                                                                                                                                         |
| **A harmonize pass on generated joints**                             | Measured: unrounded, the generated contour already reproduces the true offset's joint curvature to within 1.7%, and to floating point where the skeleton is G2. Where a step does exist it is the skeleton's, faithfully reproduced — harmonizing would erase a curvature the designer asked for.                                                                                                                                     |
| **A post-fit equalization walk, absolute or proportional allowance** | Removed. It makes the automatic answer depend on whether a candidate crosses an error budget. A fixed trip count makes the search deterministic but cannot make that threshold map continuous. The skeleton reference now participates in the one convex objective instead.                                                                                                                                                           |
| **Judging or rescaling candidate splits after the fit**              | Removed with the walk. `solveHandleScale` and candidate normalization optimized a second answer on a second objective. The current solver has no candidate family: fit, reference, and bounds produce one minimizer.                                                                                                                                                                                                                  |
| **Measure the pin in rendered (post-nudge) space**                   | Correct while nudges carried handles; superseded once they stopped. Construction space makes the pin _independent_ of the on-curve gizmo instead of coupled to it.                                                                                                                                                                                                                                                                    |
| **Reproduce a pinned mean by scaling both tensions**                 | A preserved ratio caps the reachable mean at `2r/(1+r)` — 0.6 on a 0.3/0.7 split — so the control stopped at a value that was neither 1 nor stable. It is also not what the drag does. One shared increment instead.                                                                                                                                                                                                                  |
| **Swap the rib modifier pair** (plain for width ↔ Z for tangent)     | Built twice, reverted twice. Z exists precisely because a tangential rib move is the _rarer_ intent, and a plain drag reaching for the width is what the tool is for.                                                                                                                                                                                                                                                                 |
| **Drop Z as the gate on generated geometry**                         | Built, reverted. The gate is the safety on derived geometry, not an accident.                                                                                                                                                                                                                                                                                                                                                         |
| **Equalize the reaches from the on-curve gizmo**                     | Built, removed. Only the curvature gizmo equalizes. (The closed form, if ever wanted: the control's one degree of freedom moves one end by `−s` and the other by `+s`, so `s = (r₀−r₁)/2`.)                                                                                                                                                                                                                                           |
| **Hide all generated nodes to stop them looking selected**           | Wrong fix for a real bug — the node iterator read a null index list as "every point", and an empty selection parses to no list. Only off-curve nodes are hidden, and only in gizmo mode.                                                                                                                                                                                                                                              |
| **Delete the tension bound because it never fires**                  | It fires. Kept, floored at a third of the chord. The instrumentation that answered the question has been removed, and its `active` count is not a hard-pinning measure — it counts any touch inside the blend window, which was misread once as 34% where the true figure was 2 cases in 118.                                                                                                                                         |
| **Iteratively rematch samples to a candidate cubic**                 | This was the jitter. Where one cubic cannot represent the offset, the least-squares iterate can self-intersect; Newton projection onto it is multivalued — one sample walked t = 0.907 → 0.200 → 0.319 → 0.635. Bounding the loop reduced symptoms but did not remove branch changes. Fixed trip count gives determinism, not continuity. The automatic path now keeps fixed source-parameter samples and has no projection or refit. |
| **Ease the fit's tension ceiling over a blend window**               | Bought C1 where the contract only asks for continuity, at the price of landing a few percent under whatever it was given — and it is what forced the ceiling into three variants (eased / exact / exempt) and the pin into an exemption. One exact clamp is continuous and 1-Lipschitz. Do not reintroduce a smooth bound to "protect" a stage; put the stage inside the box.                                                         |
| **Judge a split walk by max or RMS sample error**                    | Both belong to the removed threshold search. Max exposed the fault first because its plateau edge moved abruptly; RMS reduced that symptom but still left a candidate-dependent decision. Neither metric is part of the current automatic path.                                                                                                                                                                                       |
| **Keep `handleTensions`' null return for "no reach ahead"**          | The null existed so its one caller could skip the whole shaping stage — which meant a segment whose tangent rays met behind an endpoint silently got no equalization, no pin and no ceiling. Defining `reach` once, finite and positive (§3.2), deletes the case rather than the check. The function is gone from `tunni-calculations.js`.                                                                                            |
