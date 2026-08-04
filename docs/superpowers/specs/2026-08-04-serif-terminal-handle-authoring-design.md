# Serifed terminals: what a generated handle means when the stroke has been cut

**Date:** 2026-08-04
**Branch:** `feature/skeleton-serif-generator`
**Supersedes:** the standing note `SERIF-HANDLE-COUPLING.md`, which diagnosed one of the
three faults below and proposed the fix adopted here. That note and the commit it
described were both taken off the branch by a reset before this spec landed, so nothing
here has to retire them — see §6.

---

## 1. The problem

A serif is the only cap that consumes stroke: it trims a length off the end of each
outline side and splices its own terminal onto the cut. Everything downstream of that
cut is a piece of a curve rather than a curve.

Three separate faults follow from it. They were reported as one bug ("dragging a handle
next to a serif drags its neighbour") and are not one bug.

Measurements below are on a three-point stem with a curved approach and a serif on the
open end, generated directly. The drag is a handle adjustment of 30 units on the joint
away from the serif — the same input in every row.

|           | dragged handle | serif-side handle | joint's other handle |
| --------- | -------------- | ----------------- | -------------------- |
| plain cap | 26.6           | 0.0               | 0.0                  |
| serif     | 22.2           | 3.9               | 14.7                 |

### F1 — The trim drops the constructed handle axis

`buildSplitOffCurve` rebuilds each off-curve of the split segment as a bare `{x, y, type}`.
The `_axis` stamped at emission — the exact unit direction the handle was constructed on,
which exists precisely so `enforceSmoothColinearity` never has to infer a direction from a
rounded position — does not survive.

So at the smooth joint next to a serif, `sharedLockedAxis` returns null and the pass falls
back to its length-weighted estimate. Changing one handle's length then rotates the joint
and moves the handle on the **next segment**, which the serif has no business touching.

That is 14.7 units in the table, and it is a direct violation of the feature model's
"the axis must not be derived from handle length" (§3.6). The plain-cap row is the proof:
the same edit, axis intact, moves nothing.

This is the largest of the three and the cheapest to fix.

### F2 — The handle adjustment is authored on the wrong curve

A stored handle adjustment is consumed inside `offsetCubicSide`, i.e. against the segment
the generator solves. The serif then cuts that segment and the designer sees, and drags,
what survived.

A sub-arc responds to its parent's control points at a fraction of the rate, so:

- the drag is not one-for-one (22.2 units of movement for a 30-unit adjustment, and far
  worse on the serif-side handle: 1–4 units per 50 in earlier probes);
- moving either parent control point changes **both** control points of the sub-arc, so
  the adjustment leaks into the neighbour (3.9 units).

The leak is not a defect in the trim. As long as the emitted segment is a slice of a
constructed curve, its two handles are not independent — that is what a slice is. The
defect is that the designer is given a control on the slice while the write lands on the
parent.

### F3 — `ecc86efa5` traded shape for a partial fix to F2

That commit made the cut parameter handle-independent by taking the trim distance as a
fraction of the chord between the segment's two on-curves instead of walking the edge's
arc length. It does suppress one direction of the F2 leak. It also moves the drawn serif,
because on a curved terminal the chord is much shorter than the edge, so the same depth
cuts far more curve than intended and the survivor is stretched to reach the release:

| terminal curvature | worst point movement vs. before the commit |
| ------------------ | ------------------------------------------ |
| mild               | 14 units                                   |
| moderate           | 22 units                                   |
| strong             | 74 units                                   |

It is to be reverted in full. Once F2 is fixed the construction curve no longer changes
under a handle drag, so the arc-length measure — which is the one that matches the depth
the serif asked for — is stable on its own and needs no substitute.

---

## 2. The decision

**Apply the designer's handle adjustments after the trim, to the handles that survived
it.** (Option A of the two the coupling note offered; the alternative was to stop offering
those handles at all.)

Rationale:

- The handle a designer drags becomes the handle they see, moving one-for-one.
- The construction curve stops depending on the adjustment, so the cut stops moving, so
  the neighbour stops moving — F2's leak goes without touching how the cut is measured,
  which is what makes the F3 revert safe.
- The serif-side handle becomes a control worth having. Its direction is the serif's own
  depth axis, so its length says how far the flank runs straight out of the terminal.
  Today that control responds at a few percent of the pointer.

The coupling note lists three costs. One of them is wrong and one is not a cost:

- ✗ _"The join stops being automatically smooth."_ An attached adjustment can only change
  a handle's length along the direction the outline gave it — `placedLength` dot-products
  the stored vector onto that direction. The serif still aims the surviving handle; the
  designer only sets its length, so the join stays smooth by construction.
- ✗ _"Surgery on the curve solver."_ `offsetCubicSide` and the natural solver are not
  touched. They simply are not handed those adjustments for a serif-trimmed segment.
- ✓ **Existing glyphs shift.** A stored adjustment on a serif-trimmed segment currently
  means a displacement of the parent curve's control point and would come to mean a
  displacement of the emitted handle. Any glyph already carrying one changes shape once,
  on reopen. This is accepted: the population is small (serifs are new and unreleased),
  and the current meaning is the defect.

---

## 3. Design

### 3.1 F1 — carry the axis through the trim

`splitTerminalSideForRoundCap` rebuilds the segment's off-curves. Each rebuilt handle
gets the `_axis` of the original handle it descends from, since a de Casteljau split
never changes a control leg's direction:

- the far-end handle of each half keeps its own end's axis;
- the two handles adjacent to the cut are the ones whose direction genuinely changes, and
  the one that is kept is immediately re-aimed by `anchorTerminalSplit` anyway.

`anchorTerminalSplit` therefore stamps the kept handle's `_axis` with `intoStroke` — the
direction it just aimed it at — rather than leaving it bare.

This is a strict improvement for round and drop caps too: they trim as well, just less.

**Verification:** the plain-cap row of the table above is the oracle. With a serif on, the
joint's other handle must not move when a handle adjustment changes, and the joint's angle
must be invariant under a stroke-width sweep.

### 3.2 F2 — author the adjustments after the splice

Three parts.

**(a) A suppression set.** `generateOutlineFromSkeletonContour` already resolves
`startCapStyle` / `endCapStyle` and knows `isClosed`. Before the segment loop it builds the
set of `(skeletonPointId, side, role)` triples whose adjustments a serif will consume:

- if the contour is open and the start cap is `serif`: both handles of segment 0 — the
  start point's `out` and the end point's `in`, on both sides;
- likewise for the end cap and the last segment.

Both handles, not just the serif-side one: the far handle also shapes the construction
curve, so leaving it authored pre-trim would move the cut and reintroduce the leak from
the other direction.

The set is threaded into `generateOffsetPointsForSegment`, which passes `null` for a
suppressed `startAdjustment` / `endAdjustment` into `offsetCubicSide`. Nothing else about
that call changes.

**(b) A post-cap authoring pass.** After the caps are spliced (so after `buildSerifCap`
has run for both ends) and **before** `enforceSmoothColinearity`, walk each side array and,
for every off-curve whose provenance triple is in the suppression set:

- anchor = the adjacent emitted on-curve on the handle's own side of the segment;
- direction = the handle's `_axis` (guaranteed present by §3.1 — never re-derived from the
  rounded position, per the model's §3.6 rule);
- base length = the handle's current distance from the anchor;
- attached: new length = `placedLength(anchor, direction, adjustment, baseLength)`;
- detached: new length = `placedLength(anchor, direction, adjustment)`, floored at
  `MIN_HANDLE_LENGTH`, and applied after the attached pass — the established authored
  ordering, minus the pin, which stays where it is (§3.4).

**(c) A domain for the emitted segment.** The suppressed handles are no longer bounded by
the construction segment's box, so the pass computes the emitted segment's own box with
`buildHandleDomain(anchorA, anchorB, axisA, axisB)` and clamps both lengths into it. The
one-unit floor and the true forward tangent intersection are the same two limits as
everywhere else — this is the same rule applied to the curve that now exists, not a new
one. `buildHandleDomain` is already exported from `natural-handle-solver.js`.

A single-segment contour with a serif at each end collapses both trims onto one segment,
and the two surviving handles are then each a serif's own. The pass resolves its anchors
from the emitted array rather than from the segment list, so this needs no special branch
— but it must be tested, not assumed.

### 3.3 F3 — revert

`git revert ecc86efa5`, including its two tests. They assert F2's near-side symptom via
the chord measure; the replacements in §5 assert the same property via the real fix, in
both directions, and additionally assert the shape the revert restores.

### 3.4 What deliberately does not move

- **The curvature pin stays on the construction segment.** It is reproduced on the whole
  segment by design, and `constructionSegment` on the inserted point's provenance already
  exists so every reader measures the curve the pin governs. The authored layer moving
  after the trim does not change that. Order becomes: natural → pin → trim → attached →
  detached. The pin's harmonic mean is a statement about the constructed curve; the
  authored lengths are statements about the emitted one. They are about different curves
  and compose without a precedence rule, exactly as the pin and the split already do.
- **The pin bake gets more correct for free.** `makeGeneratedHandlePinBakeForEditing`
  measures how far each emitted handle moves when the pin is cleared and stores that as a
  handle adjustment. Today, on a serif-trimmed segment, it measures emitted movement and
  writes an adjustment that is applied to the parent — so "clearing the pin must not move
  anything" does not hold there. After this change the measurement and the application are
  in the same space. Add a test; do not change the code.
- **The editor's write path.** `makeEditableGeneratedHandleOffsetForEditing` projects the
  drag delta onto `address.direction` and adds it to the stored offset. If
  `address.direction` is the rendered handle's direction, that becomes one-for-one with no
  editor change. **Verify this before assuming it.** If it is derived from skeleton
  geometry instead, it must become the rendered direction for suppressed handles.
- **`getGeneratedHandleAdjustment`'s locked-side rule.** A locked side keeps its offsets
  and does not apply them; the post-cap pass must honour the same rule, or a locked serif
  side starts applying adjustments the rest of the pipeline suppresses.

### 3.5 Provenance hygiene (noted, out of scope)

The coupling note's closing observation stands and is not addressed here: every point a
serif emits is stamped with a guessed origin — no side, and an owner picked by position —
so one serifed stem produces a dozen points claiming to be the same handle of the same
skeleton point. Nothing reads them today because every lookup requires a real side. The
post-cap pass in §3.2(b) also requires a real side, so it is unaffected. File separately.

---

## 4. What must be preserved

Restating the constraints this change runs closest to, all from the feature model:

- **Point-count stability.** The pass changes handle lengths only. It must not add,
  remove, or reorder a point. Seven on-curves per terminal, unchanged.
- **The axis is never derived from handle length.** §3.1 exists to satisfy this; §3.2(b)
  consumes `_axis` rather than measuring the emitted position.
- **The positive non-crossing handle domain.** §3.2(c).
- **Grid rounding at authored placement.** `placedLength` already rounds; the pass reuses
  it rather than rounding its own way.
- **The three deliberate discontinuities** — collapsed-side threshold, forward/behind
  tangent intersection, grid rounding — are unchanged and no new one is introduced.
- **A pinned curvature is permanent.** §3.4.

---

## 5. Test strategy

`fontra-core` has the harness, and all of this is core. TDD throughout: each test below is
written and seen to fail before the code that satisfies it.

**F1**

1. With a serif, a handle adjustment at the joint away from the terminal moves that handle
   and leaves the joint's other handle exactly where it was. (Fails today by 14.7 units.)
2. The joint's outgoing handle angle is invariant across a stroke-width sweep with a serif
   on — the model's own width-independence property, currently only asserted off-serif.

**F2**

3. A handle adjustment on a serif-trimmed segment moves the emitted handle by the
   projection of the adjustment onto its axis, one-for-one, within grid rounding.
4. Adjusting either handle of a serif-trimmed segment leaves the other emitted handle
   exactly where it was — both directions, which is what today's tests only cover one of.
5. The serif's release and its straight run do not move under any handle adjustment.
   (Holds today; must keep holding.)
6. A curvature pin sweep still moves no on-curve, with a serif on and a handle adjustment
   stored — the model's zero-travel check, extended to the authored case.
7. Clearing a pin by dragging a handle on a serif-trimmed segment moves nothing else
   (the §3.4 bake property).
8. Both handles clamp to the emitted segment's own box: an adjustment beyond the forward
   tangent intersection saturates there and does not cross.
9. Point count is unchanged across the whole adjustment range including the degenerate
   values (wingless half, zero thickness, zero cup).
10. A single-segment contour with a serif at both ends: both terminals author correctly
    and nothing crosses.

**F3**

11. Golden-master fixtures regenerate to the pre-`ecc86efa5` shapes on a curved terminal.
    Regenerate `tests/data/skeleton-generator/fixtures.json` and diff deliberately —
    the revert is supposed to move those numbers back.

**Sweeps, not assertions.** Per the map's delegation recipe: for anything touching handle
lengths, hold the geometry fixed, walk one input through its range in fine steps, and
measure the worst single-step movement against the driver's own step. Sweep the handle
adjustment, the stroke width, and the serif reach. Start away from degenerate
configurations.

**Manual matrix** (no harness in `views-editor`): drag each of the two handles on a
serifed terminal on `_external/g.json` and confirm the handle tracks the pointer and its
neighbour is still; confirm the same on a round cap and a plain one; confirm a stored
adjustment survives a reload.

---

## 6. Sequencing

Three commits, in this order, each green on its own:

1. **Revert `ecc86efa5`.** Restores the drawn shape. Reintroduces the near-side leak,
   which step 3 removes properly. Regenerate fixtures.
2. **F1 — carry the axis through the trim.** Independent of the rest, largest measured
   effect, benefits round and drop caps too.
3. **F2 — author after the splice.** Suppression set, post-cap pass, emitted-segment box.

Then update `SKELETON-FEATURE-MODEL.md` §8 (the authored layer on a trimmed terminal),
its §9 table (the chord measure joins the closed dead ends), and `DEVELOPMENT-LOG.md`.

**Step 1 has already happened.** The branch was reset to `8c55cbf8b` and the chord-measure
changes discarded from the working tree, so `ecc86efa5` is no longer in this branch's
history and there is nothing to revert. Its §9 row is still owed, because a dead end that
leaves no trace gets rediscovered. Start at step 2.

---

## 7. Out of scope

- The provenance stamping in §3.5.
- The zero-pin reading in `shiftTensionsToMean` (architecture map §7 residue 4).
- Anything about the serif's own shape parameters.
