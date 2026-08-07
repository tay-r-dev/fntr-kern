# Serif terminal — open work

Standing reference for everything still to decide or build on the serif cap
style. Companion to feature model §8 (what the serif is and what must not
change), arch map §7 (open residue), development log entries 20–28 (how it got
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

| #   | Item                                               | Depth               | Origin | Status    |
| --- | -------------------------------------------------- | ------------------- | ------ | --------- |
| 1   | Axis modes other than perpendicular                | core geometry model | (1)    | undecided |
| 14  | Drop the points that draw nothing                  | generator + panel   | new    | open      |
| 15  | The cup sits off-center when one side is collapsed | terminal geometry   | new    | open      |
| 13  | S and D drag from a rib point                      | edit pipeline       | new    | open      |

Items 2 through 12 are all closed. Their entries were deleted rather than kept
here: what they built is in the feature model, why it was built that way is in
the development log, and the entries themselves are in git history.

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

**The decision was made in practice, once, under the rib-angle-lock case of this
same conflict.** A flat foot under a leaning stem was found to draw the same
disagreement this item describes: the wall stands further along the axis by the
time it reaches the top of the wing. Three answers were built and compared —
even slab, follow the stem, and slide the whole foot to meet the wall — and
**even slab** is what shipped (2026-08-07, `_external/c.json`). The other two
were rejected: following the stem deforms the wing into a parallelogram, and
sliding the foot moves its centre off the skeleton point. The accepted cost is
the one this section already names — the wing's join to the stem becomes a
shallow wedge, and the two slope edges reach unequally, growing with the tilt
and with wing slope. See feature model §8 for the measured numbers.

This does not close the item. The lock is a two-value special case of the axis
tilt this item is about, and it was fixed by moving three points to the wall
rather than by rewriting the frame. The frame itself is still orthonormal and
still papers over the general case the way described above.

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

## 14. Drop the points that draw nothing

The switch already exists in the source defaults, and the generator honours it.
**No panel draws a control for it**, so there is no way to turn it on. It reads
as a missing feature rather than a hidden one.

Three pieces. Any subset can land, but the third is the one with teeth.

**Draw the control**, in the master defaults, beside the other serif-wide
settings.

**Name it for what it does.** "Delete collapsed points" is a misnomer. The
option drops points that are not needed to draw the visible outline. Something
like "Drop points that draw nothing" says it. The interpolation warning belongs
on it: taking the option forfeits cross-master interpolation for serifed glyphs
in that master.

**Widen the removal.** Today it walks the outline and drops any on-curve within
half a unit of the on-curve before it, taking the handles between them along. So
it already covers stacked on-curves. It does **not** cover a curve segment whose
two handles both sit on their own on-curves — a straight line by geometry, still
stored as a curve, carrying two points that draw nothing.

### What the option is for

By default every point that any control could move is emitted, whatever the
controls are set to. Concavity and tension both at zero still emit the two
handles of the concave segment, at zero length. That is the ground rule above,
and it is what makes a master interpolable against another.

The option is for the case where the serif shape is settled and interpolation is
only expected across a narrower range of the parameters. Then the points that
never move are dead weight and can go.

### What it costs

Widening the removal changes generator output, so the golden fixtures move for
every case that has the option on. That is expected, not a regression.

---

## 15. The cup sits off-center when one side is collapsed

**Reported bug, not a new feature.** It contradicts a decision the feature model
states, so read that decision before you change anything.

### What is wrong

The underside cup is one curve across the whole terminal, tip to tip. Its lowest
point sits on the **skeleton endpoint**. Feature model §8 says so, and gives the
reason: the axis modes routinely produce unequal halves, and a centre anchored at
the midpoint of the two tips would drag the contact geometry off the alignment
zone as the axis rotates.

Single-sided mode breaks that reasoning. All of the width moves to one side, so
the other side lies on the skeleton and its half of the serif collapses to zeros
(dev log §29, item 1). The terminal is then entirely on one side of the skeleton
endpoint. The cup's lowest point lands on the terminal's **edge** instead of its
middle, and the foot reads as a lopsided scoop.

### Expected

The cup's lowest point sits at the centre of the serif.

### The decision this needs first

Those two rules agree on a symmetric terminal and disagree everywhere else. Pick
one statement that covers both cases, rather than adding a single-sided branch to
the cup (rail R-E).

Two candidates:

- **The centre of the foot the serif actually draws.** Correct here. Check it
  against the case §8 rejected it for: sweep the axis through the tilted modes and
  measure whether the contact point leaves the alignment zone.
- **The skeleton, offset by the collapsed side's own half-width.** Keeps the
  alignment-zone guarantee on a two-sided terminal and re-centres the one-sided
  one. It is the same number in both cases, which is the sign it may be the rule
  §8 was reaching for.

### Constraints that still hold

Point-count stability across every parameter value, including a collapsed side and
a zero cup. Whatever the centre becomes, both wings still emit all of their points.
Test the count directly (feature model §8), do not infer it from the shape.

---

## 13. S and D drag from a rib point

The S and D drag on a skeleton point already exists: both modifiers do the same
thing, and the drag direction decides whether it compresses or expands against
the opposite rib.

Same mechanism, new entry point. Grab a **rib** point, hold S or D, and the
skeleton drag runs — skeleton and all. Nothing about the behaviour changes; only
where the drag can start from.

The rib already has its own drag, which changes width. This is a different
gesture on the same handle, told apart by the modifier.

---
