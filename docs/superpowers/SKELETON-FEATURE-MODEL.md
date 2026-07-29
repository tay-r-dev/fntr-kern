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
`skeleton-generator.js:264,284`):

```
halfWidth = point.<side>Width  ??  point.width / 2  ??  contour.defaultWidth / 2
```

This matters: a point with no width fields is a _live consumer_ of the contour
default — change `defaultWidth` and un-overridden points follow. Keep this
cascade intact; materializing widths onto every point silently kills it. (An
earlier normalization draft did exactly that; the current code does not.)

## 3. The generation pipeline

`generateFromSkeleton(skeletonData)` (`skeleton-generator.js:51`) is the entry
point: it loops contours (`generateContoursFromSkeleton`) and, per contour, runs
`generateOutlineFromSkeletonContour` (`:1322`), then **emits forward
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
   skeleton handle directions and construct handle lengths with `λ = 1 + d·κ` in
   `offset-cubic.js`, followed by one fixed least-squares correction pass;
   endpoints remain the exact construction rib positions. Handle length has one
   ordered pipeline, all in that construction space: fit, bounded equalization,
   attached per-handle adjustment, curvature pin, then bound. The adjustment
   owns the split; the pin adds one shared tension increment and owns the
   magnitude. Detached handles remain absolute and bypass the attached
   adjustment and pin stages.

   **λ is applied per end, and that is where an uneven split is born.** Each
   handle is scaled by the curvature at _its own_ endpoint, so on any cubic that
   is not an arc the two factors differ — 1.07 against 2.61 on the segment in
   §7's sweep. The λ seed is a starting point, not an answer; the equalization
   stage is what keeps that asymmetry from reaching the outline, and it has to
   be sized to do so (§7).

   **The final bound comes in three forms, one per author of the length.** A
   pinned segment is not bounded at all, because the pin saturates its own two
   tensions at 1. A handle carrying a nonzero attached adjustment gets the ceiling
   stated **exactly**. Everything else — the fit's own answer — gets it **eased**
   over a blend window, because the fit has to be a continuous function of the
   skeleton. The eased form lands a few percent under what it is given, which is
   right for a fit and wrong for a length a designer chose: it cost 5 units at
   tension 1, so a hand-dragged handle could never quite reach the tangent
   intersection and a curvature baked out of a pin (§7) came back shaved. Tension
   1 is still the wall either way; the exact form just puts the wall where the
   number says it is. A side under ~0.5 units ("collapsed") skips all of
   this and copies the skeleton verbatim — this is what makes single-sided
   contours exact.

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

   **The continuity contract governs every stage of this pipeline, and it is the
   reason the construction exists.** Regeneration runs on every frame of a drag,
   so the output must be a continuous function of the input: a one-unit skeleton
   move must not reshape a generated segment. Four properties buy that, and all
   four are non-negotiable in any future change to handle lengths — **fixed trip
   count, fixed seed, no convergence test, no threshold search.** An iteration
   that stops when it is happy is a step function of its input; a fixed-count
   iteration from a fixed seed is not. This is what disqualified the old
   sample-and-fit path, whose adaptive error threshold both jittered under the
   cursor and let two masters land on different answers, breaking interpolation.
   Three discontinuities are deliberate and no continuity test may span them: the
   0.5-unit collapsed-side threshold, the forward/behind flip of the tangent-ray
   intersection, and grid rounding at emission.

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
- **The continuity contract on handle lengths** (§3.2) — fixed trip count, fixed
  seed, no convergence test, no threshold search. Losing it brings back drag
  jitter and breaks interpolation, and neither failure is visible in a unit test.
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
- **The generator is the monolith.** `skeleton-generator.js` at ~5,200 lines is
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
- **A pinned segment is not bounded twice.** The ordinary smooth tension ceiling
  eases into its limit over a blend window, so a handle sitting exactly on the
  limit comes back about 3.75% short. Where a pin is present it enforces the
  ceiling itself and the older bound stands down. The chord backstop and the
  one-unit floor still apply.
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

### Equalization of the split

Inside the construction, the two handle tensions are walked toward each other,
stopping when the segment's deviation from the true offset has grown past the
fitted best by **a quarter of that best, plus a quarter unit**, or at fully
equal. Fixed-count bisection, per the continuity contract. Symmetric geometry is
untouched to floating point; mild asymmetry closes by half or fully; a faithful
asymmetry like a shoulder barely moves, which is the allowance doing its job.

**Each candidate split is measured at its own best magnitude**, re-solved in
closed form (`solveHandleScale`, the two-handle normal equations collapsed onto
one unknown along the ray through the candidate) and normalized to the fitted
pair's magnitude first. Without that, a candidate is judged carrying a magnitude
nobody would pair it with, and the walk rejects magnitudes while believing it is
rejecting splits. The re-solve is exactly inert on the fitted pair, which is
already the joint optimum and therefore optimal along every ray through itself —
so a segment the fit got right passes through unchanged.

**The allowance is proportional for a reason, and this was learned the hard
way.** A flat quarter unit is room on a constant-width segment (they fit to
0.11–0.49) and nothing at all on a tapered one (3.6–14.4, because handle
direction is skeleton-owned and no length can absorb a direction error). That
was once described as the allowance doing its job — going quiet where there is
no accuracy to spare. It was the opposite: a tapered segment is exactly where
the fit comes out lopsided, so the walk fell silent on the only segments that
needed it. Two states of one skeleton, differing only in the tension of the
segment's own handles and equal-tension to three decimals in both, generated
pairs of (0.40, 0.99) and (0.60, 0.97) on one side and (0.73, 0.016) on the
other — one handle on the tension ceiling or on the collapse floor in every
case, and a visibly broken outline in the last. Sized against the fit's own
error, the room appears where the error is: those four became (0.45, 0.74),
(0.63, 0.89), (0.61, 0.59) and (1.00, 0.64).

**A near-symmetric skeleton must not generate a near-degenerate pair.** That is
the property to test, and the way to test it is a sweep: hold the segment fixed
and walk its own tension through the range. Before, the generated handle stepped
1, 1, 1, 2, 5, 7, 11, 17, 34 while its partner went 104, 70, 163 — a 33.9-unit
jump for one unit of skeleton handle. It is monotone now, worst step 5.4.

The correction band on the fit (0.25×–4× the analytic length) is **not** an error
allowance and must not be reused as one — it bounds where the solver's answer may
land, and says nothing about acceptable deviation.

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

| Idea                                                             | Why it is closed                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restore the old sample-and-fit offset path**                   | Adaptive threshold jumps a step when an input nudges, so output is discontinuous and two masters land on different answers; endpoints become free samples, destroying provenance; variable curve count destroys point-count stability.                                                            |
| **Tilt the generated handle axis to the true offset tangent**    | Recovers nearly all of the taper defect and is still rejected: the axis is skeleton-owned (§3.2). A single shared tilt recovers under half the gain and is _worse than pinned_ on some cases.                                                                                                     |
| **A harmonize pass on generated joints**                         | Measured: unrounded, the generated contour already reproduces the true offset's joint curvature to within 1.7%, and to floating point where the skeleton is G2. Where a step does exist it is the skeleton's, faithfully reproduced — harmonizing would erase a curvature the designer asked for. |
| **Unconditional equalization to fully equal**                    | Where it is safe it is a no-op (the fit already produces equal tensions on symmetric geometry); where it would change something it degrades fidelity 3.3×. Survives only as the bounded walk above.                                                                                               |
| **An absolute-only allowance on that walk**                      | Closed the other way round: a flat 0.25 units silences the walk on tapered segments, which are the ones whose fit is lopsided. See §7 — the allowance is now proportional to the fit's own deviation with the flat quarter unit kept as a floor. Do not restore the absolute-only form.           |
| **Judging a candidate split at the fitted magnitude**            | The split and the magnitude are orthogonal (§7), so a re-split curve wants its own scale; measured at the old one, every candidate looks worse than it is and the walk stalls. `solveHandleScale` re-solves it in closed form and is inert on the fitted pair.                                    |
| **Measure the pin in rendered (post-nudge) space**               | Correct while nudges carried handles; superseded once they stopped. Construction space makes the pin _independent_ of the on-curve gizmo instead of coupled to it.                                                                                                                                |
| **Reproduce a pinned mean by scaling both tensions**             | A preserved ratio caps the reachable mean at `2r/(1+r)` — 0.6 on a 0.3/0.7 split — so the control stopped at a value that was neither 1 nor stable. It is also not what the drag does. One shared increment instead.                                                                              |
| **Swap the rib modifier pair** (plain for width ↔ Z for tangent) | Built twice, reverted twice. Z exists precisely because a tangential rib move is the _rarer_ intent, and a plain drag reaching for the width is what the tool is for.                                                                                                                             |
| **Drop Z as the gate on generated geometry**                     | Built, reverted. The gate is the safety on derived geometry, not an accident.                                                                                                                                                                                                                     |
| **Equalize the reaches from the on-curve gizmo**                 | Built, removed. Only the curvature gizmo equalizes. (The closed form, if ever wanted: the control's one degree of freedom moves one end by `−s` and the other by `+s`, so `s = (r₀−r₁)/2`.)                                                                                                       |
| **Hide all generated nodes to stop them looking selected**       | Wrong fix for a real bug — the node iterator read a null index list as "every point", and an empty selection parses to no list. Only off-curve nodes are hidden, and only in gizmo mode.                                                                                                          |
| **Delete the tension bound because it never fires**              | It fires. Kept, floored at a third of the chord. The instrumentation that answered the question has been removed, and its `active` count is not a hard-pinning measure — it counts any touch inside the blend window, which was misread once as 34% where the true figure was 2 cases in 118.     |
