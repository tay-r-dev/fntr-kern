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
before it can be planned · **specced** = design written, no task plan yet ·
**planned** = spec and plan written, not built · **done** = built and kept here
for its findings.

| #   | Item                                     | Depth               | Origin | Status     |
| --- | ---------------------------------------- | ------------------- | ------ | ---------- |
| 1   | Axis modes other than perpendicular      | core geometry model | (1)    | undecided  |
| 2   | Rework the easing model                  | core geometry model | (4)    | done       |
| 3   | Lift the minimum-separation clamps       | core geometry       | new    | done       |
| 9   | Couple a serif's rib to its neighbour    | core geometry model | new    | done       |
| 4   | Preset storage and editing               | source defaults     | (6.1)  | done       |
| 5   | Preset apply / create / update           | panel               | (6.2)  | done       |
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

## 3. Lift the minimum-separation clamps — done

Not worked on directly. The one-attractor easing rework (item 2, dev log §21)
removed them on its way past, and the audit below was checked back against the
code afterwards. Dev log §27 has the row-by-row result.

One divergence: `MAX_HANDLE_TO_CORNER` was to be kept and is gone as a named
constant — but kept as geometry, since the bracket rounding bounds each handle
by the distance to the corner its two surfaces would meet at. Same guard against
a looped curve, spelled as the thing it stood for.

**Still owed:** feature model §5 states the smooth release unconditionally. With
the share clamps gone a handle can reach zero, and at zero the release is a
corner — correct under the ground rule, but the model has not been amended to
say the guarantee is now conditional.

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

## 4. Preset storage and editing — done

## 5. Preset apply / create / update — done

Built together, dev log §28.
[Design](specs/2026-08-05-serif-presets-design.md),
[plan](plans/2026-08-05-serif-presets.md).

As built, and differing from the two entries below:

- **A preset is one wing plus the underside cup**, not a whole terminal. Ten
  numbers. Applying it writes the wing to both sides, and asymmetry stays a
  decision about the terminal being edited. That answers the first open question
  below and reverses the answer the spec first gave it.
- **Five built-ins ship**, ported from the serif lab and scaled onto 20 units.
  The master's own list sits beside them. A built-in cannot be overwritten.
- **Egyptian is the default shape**, applied whenever a terminal becomes a
  serif. There are no separate "new serif" numbers in the master defaults: the
  default shape is a preset like any other.
- **No axis**, as the second open question suggested. No `linked` either, since
  that is the asymmetry decision.
- **The serif lost its inherit chain** on the way, which was the deepest part of
  the work and was not in either entry. Every field always holds a number.

Also found: the custom cap lists have a reader and **no writer**. Nothing in the
editor can create one. Half the precedent these entries cite is dead storage,
and it was left alone.

### The original entries

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

### Item 5's original entry

The control in the parameters panel: a select listing the presets, with apply,
create-new, and a double-press update-in-place. Additive on top of item 4. Two
notes:

- **Create** needs a name. The defaults panel currently auto-names
  (`Custom ${n + 1}`) and lets the row be renamed afterwards; doing the same here
  avoids a modal.
- **Double-press to update** is a destructive action behind a repeated click. The
  defaults panel already has a confirm-on-second-press idiom for delete
  (`_customDeleteConfirm`); reuse it rather than adding a second interaction
  grammar for the same kind of confirmation.

---
