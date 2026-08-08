# Skeleton basics — open work

Standing reference for the gaps between the skeleton and the ordinary path tools.
The serif terminal had a list of its own. Every item on it is built, so the list
is retired: what they built is in feature model §8, and why is in the development
log.

Most items here have the same shape. An ordinary path already has the behavior.
The skeleton does not have it, or has a different one. Read the ordinary path's
implementation first in every case. The skeleton is a path (feature model C1), so
a difference in feel is a defect and not a design.

Items keep the numbering the user gave them. **A number is stable once assigned.**
New items take the next free number wherever they land in the order.

Status legend: **open** = agreed, not started · **undecided** = needs a decision
before anybody can plan it · **specced** = design written, no task plan yet ·
**planned** = spec and plan written, not built · **done** = built, kept here for
its findings.

| #   | Item                                           | Depth             | Status |
| --- | ---------------------------------------------- | ----------------- | ------ |
| 1.1 | Shift constrains the skeleton pen              | tool              | done   |
| 1.2 | Reverse contour from the skeleton context menu | menu + write path | done   |
| 1.3 | A single-sided skeleton pen                    | tool + registry   | done   |
| 1.4 | Harmonize accepts skeleton contours            | feature bridge    | open   |
| 1.5 | Control must not extend a selection            | selection         | done   |
| 1.6 | Split a skeleton contour at a point            | write path        | done   |
| 1.7 | A locked rib angle holds the serif upright     | serif geometry    | done   |

---

## 1.1 Shift constrains the skeleton pen

Hold shift with the ordinary pen and the next segment comes out straight, on the
constrained angle. The skeleton pen ignored shift.

### Done

The ordinary pen's own constraint is now exported and the skeleton pen calls it,
so there is one rule and the two pens cannot drift apart.

It applies only while a contour is being extended. The first point of a contour
has nothing to be square to, which is the same condition the ordinary pen
carries.

The skeleton pen has no drag-to-curve, so there was no second place to apply it,
and it draws no preview of the next point, so there was nothing that could show
an unconstrained position while a constrained one was about to land.

---

## 1.2 Reverse contour from the skeleton context menu

Right-click an ordinary contour and the menu offers **Reverse contour**. Right-click
a skeleton object and it did not.

### Done

**The flag was already there and nothing ever wrote it.** `reversed` is stored per
contour, normalized, and read by the generator, where it flips the winding of the
emitted outline. No code in the tree set it — the same dead level as the contour
serif block found in log entry 28. The menu item is its writer.

So reverse means: the letter's fill direction turns over, and the centerline stays
exactly as drawn. The alternative — reversing the point order, which is what an
ordinary contour does — was offered and not taken. It swaps which side is left, so
every per-side field would have to travel with it, which is the surgery mirroring
already does.

One menu entry, not two: the existing action now answers a skeleton selection as
well. A rib answers it as much as a centerline point does, since both name a
contour. Each selected contour flips its own state, which is what reversing a
mixed selection of ordinary contours does too.

The write goes through the one skeleton write path (rail R-C), by way of the
module the panel's contour settings already use.

**The point-key parser refuses a rib key**, because a rib carries a third field
for its side. The contour id is the first field of either key, so the menu takes
it directly rather than through that parser.

---

## 1.3 A single-sided skeleton pen

The quadratic pen sits beside the ordinary pen in the same tool dropdown. A
single-sided skeleton pen now sits beside the skeleton pen the same way.

It draws exactly what the skeleton pen draws. The one difference is that each new
contour starts single-sided.

### Done

The dropdown is the pen's own arrangement: a wrapper holding the two tools, which
is what turns one toolbar button into a button that opens. The skeleton pen was
registered directly before, so it gained a wrapper and moved its own name aside
for it.

The second pen is the first one with one value changed — which side a new contour
puts its width on. Everything else is inherited, the same way the quadratic pen
inherits the whole ordinary pen and changes its curve type.

New contours start on the left, which is the side the generator falls back to
everywhere else, and the panel flips it afterwards like any other contour.

Single-sided was already a contour flag with a panel control, so no geometry was
written for this.

---

## 1.4 Harmonize accepts skeleton contours

Harmonize reports skeleton-generated contours as skipped, with a reason. That is
correct for the generated outline. Nobody should harmonize a derived shape.

The **skeleton's own** points are a different case. They are an ordinary path and
they carry smooth flags, so harmonize applies to them unchanged.

Route the write through the one skeleton write path. Harmonize moves on-curve
points and handles, so the outline follows for free.

---

## 1.5 Control must not extend a selection

Control-click added to the selection. It should not.

### Done

**It was not a forkra decision, and it still had to go.** Upstream spells "the
command key" as command on a Mac and control on Windows, and command-click means
add to the selection everywhere in the editor. So control-click adding was
upstream behaviour on this platform.

It conflicts with this fork, which took control for itself twice: control forces
the coarse grid during a drag, and control with shift is the equalize gesture.

Adding is now the Mac's command key alone. On Windows nothing extends a selection
with control, and shift builds one up as it always did, so nothing is lost.

The ordinary path and the skeleton share one selection mode function, so this
reaches both, which is what makes it one rule rather than a skeleton exception.

---

## 1.6 Split a skeleton contour at a point

Right-click an ordinary on-curve point and the menu offers to split the contour
there. A skeleton point offered nothing.

### Done

The same menu entry the ordinary path uses — **Break Contour** — now answers a
centerline point. A closed contour opens at that point and stays one contour; an
open one becomes two. The point sits at both ends of the cut, one copy keeping
its id and the other taking a fresh one.

**Two of the three warnings in the original item did not apply.**

The generated-contour mapping needs no bookkeeping here. The one skeleton write
path regenerates and replaces the contours whenever the topology changes, which
is exactly what a split is. Measured: a closed contour's two generated loops
become one open stroke, and an open one's single stroke becomes two.

Neither new end needs a cap written. Cap style falls through a cascade, so an
unset one draws butt, the same as every other untouched endpoint.

**Nothing is orphaned, so nothing is dropped.** Rotating a closed contour to
start at the cut keeps the segment that used to close it, and cutting an open one
at an on-curve leaves each handle pair on the side it was drawn for.

**The two new ends are made non-smooth.** A smooth point carrying a single handle
has no direction of its own, which is the condition that ties the ribs across a
straight. A cut is not a request to tie anything, so leaving the flag would have
made a split quietly reweight the stroke next to it.

**Ids are resolved for every selected point before the first cut**, because a cut
changes the structure the cross-layer resolver reads. Each point is then found by
its own id rather than through the contour it started in: cutting one contour
twice moves the second point onto the new half, which carries a different contour
id. Layers may end up with different ids for the new contour, which is already
how skeleton ids work — they are per layer, matched by position.

---

## 1.7 A locked rib angle holds the serif upright

A rib angle lock forces the rib flat horizontal or dead vertical, whatever angle
the centerline arrives at. The serif does not follow it. A perpendicular serif
still runs along the stroke, so a slanted stem draws a slanted foot.

### Done

**The decision turned out not to be a decision.** The doubt was whether the lock
overrides the axis mode or only seeds it. Neither. Only one of the four axis modes
reads the stroke at all, and that is the one the lock belongs in.

`perpendicular` means "the foot that sits on the rib". It was squaring up the
tangent to find that rib, which produces the rib only while nothing has locked it.
It now takes the rib itself. `horizontal`, `vertical` and `absolute` state a
direction outright, so a lock has nothing to add to them.

Measured on a stem swept through five tilts, as the angle of the drawn foot:

| stem tilt | no lock | horizontal lock | vertical lock |
| --------- | ------- | --------------- | ------------- |
| 0°        | 172.87  | 172.87          | 67.75         |
| 10°       | 162.87  | 172.87          | 72.47         |
| 20°       | 152.87  | 172.87          | 82.87         |
| 30°       | 142.87  | 172.87          | 82.87         |
| −20°      | 12.87   | 172.87          | 82.87         |

Unlocked, the foot follows the stem one degree for one. Under a horizontal lock it
does not move. Under a vertical lock it does not move either, once the stem clears
the 15° minimum separation between the axis and the tangent. Below that the
existing clamp pushes the axis off, which is what it is for: a foot along the
stroke has no wings and no flank to release onto.

The deeper version of this question is what splits the foot direction from the
flank direction, which are still one thing here. This fix did not answer it.

A follow-up report on this same lock (2026-08-07) reached it directly: a flat foot
under a leaning stem stretches the wing unevenly. That is now settled — the
serif's own shape stays square to its foot, only the wall follows the stroke, and
the bracket absorbs the lean. Feature model §8 states the rule and §9 records the
two constructions tried and withdrawn on the way.
