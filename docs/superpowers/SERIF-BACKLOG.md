# Serif terminal — open work

Standing reference for everything still to decide or build on the serif cap
style. Companion to feature model §8 (what the serif is and what must not
change), arch map §7 (open residue), development log entries 20–22 (how it got
here).

Items are ordered by **how much of the code's structure has to move**, deepest
first, with blocking relationships allowed to override that order. The numbering
here is this document's own; the origin of each item in the original list is
noted so it stays traceable. **A number is stable once assigned** — the table is
re-sorted as items arrive, so a new item keeps the next free number wherever it
lands in the order, and commits and notes referring to an item stay valid.

Status legend: **open** = agreed, not started · **undecided** = needs a decision
before it can be planned · **planned** = spec and plan written, not built ·
**done** = built and kept here for its findings.

| #   | Item                                     | Depth               | Origin | Status     |
| --- | ---------------------------------------- | ------------------- | ------ | ---------- |
| 1   | Axis modes other than perpendicular      | core geometry model | (1)    | undecided  |
| 2   | Rework the easing model                  | core geometry model | (4)    | done       |
| 3   | Lift the minimum-separation clamps       | core geometry       | new    | open       |
| 9   | Couple a serif's rib to its neighbour    | core geometry model | new    | done       |
| 4   | Preset storage and editing               | source defaults     | (6.1)  | open       |
| 5   | Preset apply / create / update           | panel               | (6.2)  | open       |
| 10  | Cancel a drag with right-click           | edit pipeline       | new    | done       |
| 11  | Multiply, not just add, from a scrub     | edit pipeline       | new    | done       |
| 12  | Handles on a serifed terminal            | core geometry       | new    | done       |
| 6   | Scale sliders: live update, integer step | edit pipeline       | (3, 5) | superseded |
| 7   | Scale sliders inline with inputs         | panel layout        | (2)    | superseded |
| 8   | Shape-and-easing reframe                 | panel labels        | (4)    | done       |

Blocking: 4 → 5. Item 2 shipped without item 3 under it, so the clamps are still
in place and item 3 now stands alone: lifting them is what makes the ground rule
below actually true, and it reaches past the serif into shared geometry.

Items 6 and 7 both touch the same sliders and should ship as one pass, but they
are independent of each other and either can land alone.

### Decided

- **Presets are per master**, held in the source defaults, not per font. This
  removes the units problem a font-wide preset would have had (absolute lengths
  are wrong in every master but one) and lets item 4 follow the existing custom
  width / cap preset pattern exactly.
- **The shape-and-easing reframe is presentation only.** No field is renamed,
  renested or replaced. That drops it from a schema change to a panel change and
  moves it to the bottom of this list.

### Ground rule: points collapse, they do not disappear

Every point a serif can emit is emitted at every parameter value, including
values where it has nowhere to go and lands on top of its neighbour. **A serif is
allowed to collapse points to zero distance — on-curves and off-curves alike —
and the one-unit minimum separation that applies elsewhere does not apply
inside a terminal.** Coincident points and zero-length segments are the correct
output, not a degenerate one.

That is what keeps point count constant across the whole range, which is the
cross-master interpolation contract. Removing them is opt-in per master via
`serifRemoveCollapsedPoints`, and taking that option forfeits interpolation for
serifed glyphs in that master — already stated at the source-default.

Consequences when planning anything below:

- A new field never needs a minimum value to keep its points apart. Zero is
  always a legal setting and must emit the same points as any other setting.
- "Switched off" means contributing no _shape_, not contributing no _points_ —
  the obligation a wingless half already carries (feature model §8).
- A discontinuity in a coupled parameter is a jump in shape only, never a jump in
  topology. That makes it a drag-feel problem, not an interpolation problem.

---

## 1. Axis modes other than perpendicular

**Deepest item. It is a rewrite of the terminal's coordinate model, not a set of
local fixes.**

### What is wrong

`computeSerifFrame` builds an orthonormal frame from a single input direction:
`axis` runs along the serif's foot, and `depth` is forced perpendicular to it,
pointing back into the stroke. Every point in `buildHalfSerif` is placed in that
frame — the tips, the wing inner corner, the release (`straightTop`) and the
bottom of the straight run (`straightBottom`) all sit at a constant `u`, on what
the code calls the flank line.

The flank line is only the stroke wall when `depth` is parallel to the tangent —
that is, when the axis is perpendicular to the centerline. In every other mode
the wall still runs along the centerline while the terminal's straight run leans
with the axis, and the two disagree by exactly the axis tilt.

The generator then papers over the disagreement. `buildSerifCap` computes the
release from the serif's own numbers and `anchorTerminalSplit` drags the trimmed
edge onto it, bending the wall over. That is the correct behaviour when the gap
is small and caused by curvature (feature model §8, and it is what keeps a
curvature pin from moving on-curves). It is the wrong behaviour when the gap is
structural and grows linearly with the axis angle.

Secondary consequence: the two rib ends project into a tilted frame at different
depths, so the two halves are trimmed by different amounts and start at different
heights even when their seven parameters are identical. That is why a tilted
serif reads as lopsided rather than slanted.

### Direction

The frame needs **three** directions rather than two: the foot direction (the
axis, which the mode chooses), and the flank direction (which must follow the
stroke walls, i.e. the tangent, in every mode). `depth` stops being
`rotate90(axis)`.

That makes the frame non-orthonormal — a sheared basis — so `toFrame` /
`toGlyph` become a general 2×2 solve instead of two dot products, and every
place that assumes `u` and `v` are independent distances has to be re-read. In
particular:

- the tip cut offset, computed as `tipThickness · tan(cutAngle)` along `u`
- the wing inner corner, currently at the same `u` as the release
- the underside controls in `footControls`, which hold each end's `v`
- the reach and straight-run heights, currently measured along `v` from a
  baseline through the skeleton endpoint

### The decision this needs first

**Which reference does the wing use once the two disagree?** Today every height
is measured square to the foot, so the wings are an even slab whichever way the
foot points. Once the flank has to follow the wall, the wing must pick one:

- **Even slab** — thickness stays square to the foot. Constant wing thickness
  end to end; the join where the wing meets the stem becomes a shallow wedge.
- **Follows the stem** — thickness is measured along the stem. The flank lies
  exactly on the wall with no join, and the wing becomes a parallelogram,
  visibly thicker at the stem than at the tip.

Identical on an upright stem with a perpendicular foot; they only diverge in the
tilted modes. This is a drawing decision, and it determines the whole
construction below it, so it is a gate on planning this item.

### Also open

Whether the 15° minimum separation between axis and tangent survives. It exists
because a parallel axis leaves no flank to release onto. In a sheared frame the
degeneracy is the same, but the clamp may need to act on the shear factor rather
than on the angle.

### Constraints that still hold

Point-count stability across the whole parameter range including every axis mode
and angle — the interpolation contract does not relax for this. Seven on-curves
per terminal at every setting. Test it directly (feature model §8), do not infer
it from the shape looking right.

---

## 2. Rework the easing model — done

Reported as "I can't figure out what reach does — in practice it's the same as
slope, with the curve apex changing if there's concavity." That is exactly right,
and it is measurable. The fix is not a repair of `reach`; the easing model is
replaced. See **Direction** below.

### Evidence

`buildHalfSerif`, wing 40, tip thickness 20, tension 0.5. Comparing
`wingSlope: 15, reach: 0` against `wingSlope: 0, reach: 15`:

| `concavity` | Emitted on-curves       | Handles                                       |
| ----------- | ----------------------- | --------------------------------------------- |
| 0           | identical to 3 decimals | identical — the two settings give one outline |
| 0.5         | identical to 3 decimals | `control1` and `control2` differ              |
| 1           | identical to 3 decimals | `control1` and `control2` differ              |

The two fields move **no emitted point differently at any setting**. Every
difference between them lives in the two transition handles, and only when
`concavity` is non-zero.

### Why

```js
const wingInnerV = tipThickness + wingSlope;
const corner = { u: flankU, v: wingInnerV };
const straightBottom = { u: flankU, v: wingInnerV + reach };
```

`reach` is measured **from the corner**, and `wingSlope` raises the corner. So
slope lifts the release by its own amount as a side effect of steering the
bracket, and that lift is all reach does. The redundancy is the lift.

Second symptom in the same construction: `control2 = lerp(straightBottom, corner,
…)`, so at `reach === 0` the lower handle collapses onto the release at every
easing value. Measured above: with slope 15 and reach 0, `control2` equals
`straightBottom` at concavity 0.5 and 1. The release is a corner regardless of
easing, which means **slope alone cannot produce a bracket** — it needs a
non-zero reach before it does anything visible.

### Direction — two separate easings

Not a repair of the existing three fields. The easing model is replaced by two
independently engaged easings.

**Serif easing** — the hollow in the wing's slope. It spans the **whole** slope,
so the slope's own length is the curve's length and `reach` disappears as a
field. Signed: negative bulges convex, 0 is a flat chamfer, positive is the
classic hollow bracket. Two parameters:

| New name  | Was         | Meaning                                  |
| --------- | ----------- | ---------------------------------------- |
| `amount`  | `concavity` | how deep the hollow is                   |
| `balance` | `tension`   | which end of the slope the curve favours |

The current construction is kept as-is — both handles aimed at the wing's inner
corner, one length split between them (development log 21). Only the names, the
span and the removal of `reach` change.

**Contour easing** — corner rounding where the serif meets the stem, at the one
corner on that side. Independent of the hollow: it applies even at serif easing
0, which is what lets a slab or Didone terminal have a softened junction without
a bracket. Two parameters, matching the pattern used everywhere else in the
feature:

| Field       | Meaning                                   |
| ----------- | ----------------------------------------- |
| `distance`  | how far back from the corner it starts    |
| `curvature` | how the rounding bends over that distance |

**Coupling.** As built: easing is disabled at concavity 1 and only there. That is
the single value where the bracket already leaves the junction along the flank,
so there is no corner left to round. Every other value — hollow, flat chamfer or
convex bulge — meets the flank at an angle and keeps its rounding.

This paragraph previously said the opposite (disabled across 0 → −1, enabled on
positive values). That was wrong and was never what was asked for.

### Consequences

**Done** (2026-08-03). As built, and differing from the sketch above:

- `reach` was **kept**, not removed. Under the one-attractor construction it and
  `wingSlope` move the attractor by different routes, so they stop being
  interchangeable and no migration is needed.
- `straightDepth` was removed instead, with no migration: the trimmed stroke edge
  already ends at the release, so the terminal never owned that point.
- Two new fields per half, `easeDistance` and `easeCurvature` — the
  inherit-via-null chain, mirroring, the panel and the source defaults all follow.
- Contour easing emits its points at every setting, including zero distance and
  at concavity 1 where they collapse onto the junction. See the ground rule
  above: disabled means no shape, not no points.
- The snap-off is at concavity 1, an endpoint of the range, so there is no
  discontinuity to walk through mid-slider and the drag-feel question below does
  not arise.

---

## 3. Lift the minimum-separation clamps

The ground rule above says a serif may collapse any point to zero distance. The
code does not currently allow it: several clamps exist specifically to stop
things reaching zero, and they have to come out before the rule is true.

### The clamps, and what to do with each

| Clamp                                             | Purpose as written                                                       | Verdict                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `MIN_HANDLE_SHARE` 0.25 / `MAX_HANDLE_SHARE` 0.75 | "keep both handles alive… a handle of zero length gives up the tangency" | **Remove.** This is the rule stated as a constant. Balance must reach 0 and 1.                                          |
| `MAX_HANDLE_TO_CORNER` 1                          | stops the two controls crossing and looping the curve                    | **Keep.** Prevents a self-intersecting outline, not a collapse.                                                         |
| `MIN_AXIS_TANGENT_SEPARATION_DEG` 15              | a parallel axis leaves no flank to release onto                          | **Revisit with item 1.** May become a shear-factor limit instead.                                                       |
| `clampReach`'s `Math.max(…, 1)` floor             | a terminal may only consume its own segment                              | **Split.** Segment ownership is a real constraint and stays; the one-unit floor under it is the collapse rule and goes. |
| `Math.round` on emitted points                    | integer grid quantization                                                | **Keep.** The grid is the grid; two points rounding onto each other is a collapse, which is now legal.                  |

### Why it matters beyond tidiness

`MIN_HANDLE_SHARE` is the reason the tangency argument in feature model §8 holds
— "any non-zero handle length preserves both tangents". Removing it means a
handle _can_ hit zero, and at zero the release becomes a corner. That is the
correct output under the ground rule, but it means the smooth-release guarantee
becomes conditional rather than unconditional, and feature model §5 needs
amending to say so.

Test the ends of every range directly. A clamp that is removed but still enforced
somewhere downstream is worse than one that is documented.

---

## 9. Couple a serif's rib to its neighbour — done

**A serif attached to a straight ties the ribs at both ends of that straight.**

A serif sits on the end of a straight run of stem, and that run is one wall with
one thickness. Two widths across it draw a wall that changes thickness where
nothing was drawn to change it.

Attached to a **straight** is the whole condition. A serif on a curve has no flat
wall behind it and ties nothing.

Both ends control the shared width, as a mean — drag either rib and the wall
moves. Not one-way from the serif.

### How it is built

Through the tie-across-a-straight rule that already existed, not beside it. That
rule tied a straight's two ends when either was a straight-controlled smooth
point; a serif terminal is now a second thing that qualifies a straight. Which
means:

- Rendering and hit-testing read the coupling back through the same group
  lookup, so the rib gizmo, the stored width and the outline cannot disagree.
  Doing this as a separate width override instead left the gizmos floating off
  the outline, which is what gave the game away.
- The tied flag is the opt-out, already in the panel. Untick it on either end
  and the two ribs are independent again.
- The rib drag already pulls a tied group along, so dragging either end moves
  both with no editor change at all.

### Fixed on the way

Cap geometry was reading each endpoint's **stored** half width rather than the
resolved one, so a cap on a tied endpoint sat off the end of the stroke it
caps. Nothing could reach that before, because an endpoint could not be tied.

### Left open

- **Nothing finer than the tied flag.** Opting out frees both ends; there is no
  way to keep the coupling on one side and not the other.

An earlier draft of this item described the neighbour as "a corner where the
stem turns" and made the coupling one-way. Both were wrong. The condition is the
serif's own segment being straight, and both ends control the result.

---

## 4. Preset storage and editing

**Per master, in the source defaults.** There is already a working template for
this and the serif should follow it rather than invent a second mechanism.

`panel-skeleton-defaults.js` edits named lists held in the source defaults —
`customWidthsUppercase`, `customWidthsLowercase`, `customCapSquare`,
`customCapRounded` — with add, rename, edit and confirm-delete rows.
`panel-skeleton-parameters.js` reads the same lists and offers them as options in
the width-profile and cap-preset selects. A serif preset list is the same shape:
a new key in `SKELETON_SOURCE_DEFAULT_KEYS` holding an array of
`{ name, ...fields }`, a new block of rows in the defaults panel, and a new
option source in the parameters panel.

### To settle when planning

- Does a preset cover both halves, or one half that can be applied to either
  side? Applying a single-half preset to the right side is the mirroring case,
  which the model already handles.
- Does a preset include `axisMode` / `axisAngle`? Those place the terminal rather
  than shape it, and carrying them makes a preset non-portable between a stem
  foot and a slanted terminal.
- Does a preset include `undersideCup` and `straightDepth`? They are per-terminal
  rather than per-half.
- Absolute or normalized lengths. `serifUnitsMode` already exists at source
  level; a per-master preset can safely store absolute units, but a preset copied
  between masters cannot.

---

## 5. Preset apply / create / update

The control in the parameters panel: a select listing the presets, with apply,
create-new, and a double-press update-in-place.

Additive on top of item 4. Two notes:

- **Create** needs a name. The defaults panel currently auto-names
  (`Custom ${n + 1}`) and lets the row be renamed afterwards; doing the same here
  avoids a modal.
- **Double-press to update** is a destructive action behind a repeated click. The
  defaults panel already has a confirm-on-second-press idiom for delete
  (`_customDeleteConfirm`); reuse it rather than adding a second interaction
  grammar for the same kind of confirmation.

---

## 12. Handles on a serifed terminal — done

Built, dev log §24. Kept here for the account of the three faults and for the
loose end at the bottom, which is not fixed.
[Design](specs/2026-08-04-serif-terminal-handle-authoring-design.md),
[plan](plans/2026-08-04-serif-terminal-handle-authoring.md).

Fixing this exposed a fourth fault in shared code that had nothing to do with
serifs — the curvature gizmo and the generator had never agreed on what a tension
number means, and a pin jumped the curve by up to 128 units on the first grab.
Dev log §25.

Three faults, reported as one.

**The trim drops the constructed handle direction.** Every generated handle
carries the exact direction it was built on, so the smoothing pass never has to
infer one from a rounded position — inferring makes the direction depend on
handle length, and rib width sets handle length (feature model §3.6). The trim
rebuilds its handles bare, so the smooth joint next to a serif falls back to
inferring, and changing one handle's length swings the handle on the **next**
segment by 14.7 units. The same edit under a plain cap moves it by nothing,
which is the oracle. Largest of the three and the cheapest to fix.

**The offset is authored on the wrong curve.** It is consumed against the segment
the generator solves; the serif then eats the end of that segment, so what the
designer drags is a piece of it. A piece responds to its parent's control points
at a fraction of the rate, and both of its handles depend on both of the
parent's — so the drag arrives fractional and leaks 3.9 units into its
neighbour. The fix withholds **both** of the terminal segment's offsets from the
solve and applies them after the splice, which migrates any file that already
carries an offset there.

**The chord trim measure traded shape for half of the second fault.** Taking the
cut parameter off the chord between the segment's on-curves rather than walking
the edge does make it handle-independent, and it moves the drawn serif: 14 units
on a mild curve, 74 on a strong one, because the chord is far shorter than the
edge and the same depth then cuts far more curve than it asked for. Reverted.
With the second fault fixed, nothing a designer drags reaches the construction
curve, so the edge measure is stable on its own.

**Still open, found while measuring and causing none of it:** every point a serif
emits is stamped
with a guessed origin — no side, and an owner picked by counting position along
the contour — so one serifed stem produces a dozen points claiming to be the same
handle of the same skeleton point. Nothing reads them, because every lookup
requires a real side. File separately if it ever matters.

---

## 10. Cancel a drag with right-click — done

Right-click while dragging a scrubbed label or a slider abandons the drag: the
shape returns to where the press found it and **no undo step is recorded**. The
other hand is already on the mouse, which Escape cannot say for itself mid-drag.

Landing back on the starting value by dragging is not the same thing and must
stay different — that commits an edit that happens to change nothing, and costs
an undo to get past. So the stream carries a sentinel rather than a zero: a
frozen object no amount of dragging can produce by accident.

The streaming edit path already rebuilt from the original every frame, so
abandoning is that restore plus the rollback notification, and then returning no
changes — which is the ending a drag that never crossed the dead zone already
had.

Every consumer that drains a value stream now refuses the sentinel rather than
committing it as a value, including the two upstream panels that share the
slider.

### Left open

- **A slider cancelled by a click on its track** returns to the value the drag
  reported at its start, which for a track click is already the clicked-to one.
  The shape is correct either way; only the thumb can be a step out until the
  next panel refresh.

---

## 11. Multiply, not just add, from a scrub — done

Every scrub field now carries `× [ratio] [preview - Apply]` in its own row. The
ratio steps by 0.1 and the button shows where that field's number lands, live, so
the ratio does not have to be read as a shape: 1.1 says nothing about where a 40
goes, 44 does.

Applied per point, not against one number. Scaling a mixed selection by 1.1 grows
each point from its own value, which is the whole reason a multiply is not a
scrub with the answer worked out in advance.

A scrub and a multiply share their per-point writers and undo labels; only the
arithmetic differs, so that is the argument. Reaches the same five groups the
scrub does — the two point widths and the total, contour default width, cap
distance, and every serif half field.

### Left open

- **Normalized units.** Under `serifUnitsMode: normalized` the stored number is
  already a ratio of stroke width, and multiplying it multiplies the ratio. That
  is arguably right, and it was not thought through.
- **Rounding is per apply.** Each press rounds to the grid, so 1.1 twice is not
  1.21. No fractions are carried between presses.

---

## 6. Scale sliders: live update and integer step — SUPERSEDED

Both of these landed and both were then removed with the scale sliders themselves
(dev log §23). Kept for the findings, which outlived the feature: the streaming
helper's restore-before-apply is what makes any relative drag safe, and it is now
what the scrub rides on.

### The original entry

Both scale sliders — the serif lengths and the point width — now stream, and both
round what they store.

The predicted drag baseline turned out to already exist. The shared streaming
helper snapshots every editable layer when the drag opens and restores that
snapshot before applying each frame, so a relative factor multiplies the values
the drag started from every time and cannot compound. The exclusion comment was
describing a hazard the helper had already removed. Streaming a scale slider is
therefore just routing it through the same helper the absolute sliders use.

Rounding moved into the per-point scale, next to the clamp at zero, so the
committed path and the streamed path round identically — one function, called
from both.

Still open: rounding under `serifUnitsMode: normalized`, where the stored number
is a ratio of stroke width and an integer is meaningless. The rounding as landed
applies to the stored number in both modes.

---

## 7. Scale sliders inline with inputs — SUPERSEDED

Each serif length is one row now: label, number input, scale slider. Same for
point width, where the scale slider sits on the total — the number it actually
moves.

The rendering was free, as expected: the shared form component already packs
several inputs into one row. The work was the parameters panel's in-place update
path. Both the layout signature and the value refresh walked top-level items
only, so a packed row read as keyless and every edit fell back to a full rebuild.
Both now flatten a packed row into its nested fields first, which is what keeps
the in-place refresh — and so the focus and the live drag — working.

---

## 8. Shape-and-easing reframe — done

Built. The panel emits three group headers per half — wing, bracket, easing — and
the axis fields stay in their own group below the divider. The groups follow the
fields item 2 actually shipped (`reach`, `tension`, `concavity`, `easeDistance`,
`easeCurvature`) rather than the renamed set sketched below, since no field was
renamed.

**Presentation only.** No field renamed, renested or replaced; the stored model
is untouched, so there is no migration, no fixture change and no interpolation
consequence.

Headers in the serif section of the parameters panel, grouping the half-fields by
what they do. Assuming item 2 has landed:

| Group          | Fields                                                   |
| -------------- | -------------------------------------------------------- |
| Shape          | `wingLength`, `tipThickness`, `wingSlope`, `tipCutAngle` |
| Serif easing   | `amount`, `balance`                                      |
| Contour easing | `distance`, `curvature`                                  |

`undersideCup` and `straightDepth` are shape but terminal-level; `axisMode` and
`axisAngle` are neither — they place the terminal rather than form it, and should
stay in their own group below the divider where they already are.

Sequenced after item 2, which defines the two easing groups this is grouping by.
The reframe is cheap enough to redo that this is an ordering preference, not a
gate.

---

## Cross-references

- Feature model §8 — the serif terminal: frame, halves, the release rule and its
  cost, point count, the `constructionSegment` obligation.
- Feature model §9 — dead ends, including reading the release off the cut.
- Arch map §7 residue #4 — the zero-pin curvature fallback in shared Tunni code.
  Not serif work, but it is in the path of every curvature pin and is felt at the
  bottom of the gizmo range on a serif'd stem.
- Development log 20, 21, 22.
