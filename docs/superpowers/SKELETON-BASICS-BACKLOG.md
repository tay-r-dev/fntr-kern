# Skeleton basics — open work

Standing reference for the gaps between the skeleton and the ordinary path tools.
Companion to `SERIF-BACKLOG.md`, which holds the serif terminal's own list.

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
| 1.1 | Shift constrains the skeleton pen              | tool              | open   |
| 1.2 | Reverse contour from the skeleton context menu | menu + write path | open   |
| 1.3 | A single-sided skeleton pen                    | tool + registry   | open   |
| 1.4 | Harmonize accepts skeleton contours            | feature bridge    | open   |
| 1.5 | Control must not extend a selection            | selection         | open   |
| 1.6 | Split a skeleton contour at a point            | write path        | open   |
| 1.7 | A locked rib angle holds the serif upright     | serif geometry    | open   |

---

## 1.1 Shift constrains the skeleton pen

Hold shift with the ordinary pen and the next segment comes out straight, on the
constrained angle. The skeleton pen ignores shift.

Give the skeleton pen the same mechanic. Take it from the ordinary pen rather
than write a second one (rail R-B).

---

## 1.2 Reverse contour from the skeleton context menu

Right-click an ordinary contour and the menu offers **Reverse contour**. Right-click
a skeleton object and it does not.

Offer it on every skeleton object that answers a right-click. That is the
centerline and the rib today.

The skeleton already stores a `reversed` flag per contour, and mirroring already
swaps the per-side fields. Check what the flag does before you add a second way to
express the same thing. The write goes through the one skeleton write path
(rail R-C).

---

## 1.3 A single-sided skeleton pen

The quadratic pen sits beside the ordinary pen in the same tool dropdown. Add a
single-sided skeleton pen beside the skeleton pen the same way.

It draws exactly what the skeleton pen draws. The one difference is that each new
contour starts single-sided.

Single-sided already exists as a contour flag, and the panel already toggles it.
This item is a tool entry, not new geometry.

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

Control-click adds to the selection today. It should not.

Confirm which modifier the editor means to own union before you change anything.
The ordinary path and the skeleton share one selection mode function, so a change
here reaches both.

---

## 1.6 Split a skeleton contour at a point

Right-click an ordinary on-curve point and the menu offers to split the contour
there. A skeleton point offers nothing.

Give the skeleton the same operation. One closed contour becomes one open contour.
One open contour becomes two.

This restructures the contour list, so it must update the generated-contour
mapping inside the same change (architecture map §9). The knife and the pen carry
that bookkeeping already. Copy it.

Point ids survive a split. Widths, caps and every per-point field travel with
their point. The point that the split duplicates needs a new id, and the two
copies each need a cap.

---

## 1.7 A locked rib angle holds the serif upright

A rib angle lock forces the rib flat horizontal or dead vertical, whatever angle
the centerline arrives at. The serif does not follow it. A perpendicular serif
still runs along the stroke, so a slanted stem draws a slanted foot.

The two properties compose today. The lock sets the rib the cap is built on. The
axis mode sets the direction the serif runs. Both apply, and the reported behavior
says that composition is wrong for this case.

Expected: with the lock set, the serif stays horizontal or vertical whatever the
skeleton does.

The decision this needs first is whether the lock **overrides** the axis mode, or
whether it seeds a different default. A user who sets a lock and then names an
absolute axis angle has asked for two things. State which one wins before anybody
builds it.

Item 1 of the serif backlog is the deeper version of the same question. That item
rewrites the terminal's coordinate model so the foot direction and the flank
direction stop being the same thing. Check whether this item survives that
rewrite, or whether the rewrite subsumes it.
