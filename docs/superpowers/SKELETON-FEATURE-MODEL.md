# Skeleton Feature Model (forkra)

**Reframed:** 2026-07-25 — from a donor-code review into a description of
**forkra's own** skeleton code, verified against the tree.
**Companion to** `FEATURE-ARCHITECTURE-MAP.md`: that doc says *where* the
skeleton files are and *who owns them*; this one is the conceptual **mental
model** — what the feature is, how the generation pipeline works, and which
behaviors must be preserved when you touch it. The design *rationale* (C1–C4,
the defects it answers) lives in the map's §9.

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
  (nudges, handle offsets, detached handles) while remaining *generated*.
- **Single-sided contours** — all width on one side; the other lies exactly on
  the skeleton.
- **Modifier behaviors** — D (fixed-rib), S (fixed-rib-compress), X (equalize),
  Z (tangent-only rib drag), held as realtime keys during drags.
- **Tunni points** on skeleton curve segments.
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

This matters: a point with no width fields is a *live consumer* of the contour
default — change `defaultWidth` and un-overridden points follow. Keep this
cascade intact; materializing widths onto every point silently kills it. (An
earlier normalization draft did exactly that; the current code does not.)

## 3. The generation pipeline

`generateFromSkeleton(skeletonData)` (`skeleton-generator.js:51`) is the entry
point: it loops contours (`generateContoursFromSkeleton`) and, per contour, runs
`generateOutlineFromSkeletonContour` (`:1322`), then **emits forward
provenance** — `annotateGeneratedContourProvenance` stamps every generated point
with `{skeletonPointId, side, role}` (arch map C3). The per-contour pipeline is
pure and independent (contour *i*'s output depends only on contour *i*):

0. **Direction ownership** — before any offsetting, note which on-curve points do
   **not** own their own direction. A smooth point with only **one** handle
   cannot be defined by that handle: smoothness forces the handle to be colinear
   with the straight segment on its other side, so the straight sets the
   direction and the handle follows. Its rib is perpendicular to that straight,
   not to a miter average (`isStraightControlledSmoothPoint` →
   `straightSegmentNormal`).

   When **both** ends of a straight are such points, they define each other and
   neither has an independent direction (`isMutuallyControlledPair`). Their ribs
   are locked parallel *and* to a shared offset — `coupledHalfWidths` gives both
   the mean of the two stored half-widths per side, so adjusting either width
   moves both ribs together. The mean is chosen because it is symmetric and
   continuous in both inputs.

   **This is the one place ribs are deliberately coupled.** Ribs at different
   offsets tilt the generated rib-to-rib line away from the skeleton straight,
   and the generated handles stay colinear with that line in order to keep the
   outline smooth, so they rotate as width changes (measured: 8.5° of drift over
   a width sweep, the two sides shearing opposite ways). Locked in by "keeps
   handles fixed when width changes across a mutually-controlled straight" and
   the `mutually-controlled-straight` fixture.

   **Opt-out:** `width.tied` on either point (panel: "Tied ribs", under
   "Linked"). Default on, so existing data keeps the coupling; clearing it on
   *either* point frees the pair and the handles rotate with width again (16.3°
   over the same sweep). That is a deliberate trade for independent rib widths
   here, not a bug — do not "fix" the rotation while a pair is untied. Only the
   shared *offset* is optional; the rib staying perpendicular to the straight is
   not, because it follows from the point having no direction of its own.

   **Everything that shows or edits a tied rib must use the coupled value, not
   the stored one.** `getEffectiveRibHalfWidth` is that value and
   `getTiedRibPartner` is the pairing test, both in `skeleton-model.js` beside
   the normal computation the gizmo uses. A rib drag pulls its tied partner into
   the executor set (`collectSkeletonRibSelection`, gated to width-changing
   drags — nudge is not tied), so both stored widths move together and the
   outline tracks the cursor exactly. Skipping either of these produced the
   original report: the dragged gizmo travelled twice as far as the outline and
   its partner did not move at all.
1. **Segmentation** — `buildSegmentsFromPoints` splits the point list into
   on-curve→on-curve segments carrying their off-curve controls.
2. **Per-segment offsetting** — each side's outline is offset by its half-width.
   Line segments project endpoints along the rib normal (`applyNudgeToRibPoint`
   applies nudges). Cubic segments keep skeleton handle directions and construct
   handle lengths with `λ = 1 + d·κ` in `offset-cubic.js`, followed by one fixed
   least-squares correction pass; endpoints remain the exact rib positions; user
   handle offsets apply via
   `applyHandleOffsetToControlPoint`. A side under ~0.5 units ("collapsed") skips
   all of this and copies the skeleton verbatim — this is what makes single-sided
   contours exact.
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
   before the axis was taken from the skeleton. Deriving it from the *rounded*
   handle positions is the same trap, because the grid snap is what makes the
   direction length-dependent in the first place. Locked in by
   "keeps the smooth-junction handle axis independent of rib width".

   This pass writes handle positions **unrounded**, deliberately: re-snapping
   to the grid here would undo the colinearity it just established, and worst
   on short handles, where a unit of rounding is a large angle.

**Grid rounding happens at every stage**, not once at the end. It is also what
makes handle *direction* length-dependent: a handle emitted at
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
