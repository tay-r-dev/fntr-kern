# Inserting a skeleton point changes the outline it was inserted into

**Date:** 2026-09-02
**Status:** problem statement and proposed solution. Not built, not designed in
detail.
**Measured on:** `_external/problem-glyphs/F^1.json` and `I^1.json`.

This document states one fault and the way out of it. It is not a spec.

---

## 1. What happens now

A skeleton is a centerline. The outline the reader sees is generated from it:
each skeleton point carries a width, a rib is laid across the centerline at that
width, and the two edges are drawn through the rib ends.

The Skeleton Pen can put a new point into an existing centerline. Two things
follow from that, and one of them is wanted.

**The width is right.** The new point takes the width the stroke already has
where it landed, measured out to the drawn edge on each side. This part is
built and works. Measured on `F^1.json`: 158 and 158, against 158 and 158
stored. On `I^1.json`: 30 and 30.

**The shape is not.** The outline is regenerated from the centerline after the
insertion, and the new point is a new rib, so the two edges are now drawn
through one more place than before. They come out close to where they were, and
not on it. The designer inserted a point to have somewhere to work; they did not
ask for the drawing to move.

---

## 2. What the designer expects

Inserting a point adds a handle to hold. It changes nothing else. The outline
after the insertion is the outline before it.

This is what inserting a point into an ordinary contour already does: the curve
is split at the place clicked, and splitting a curve is exact, so nothing moves.
The skeleton has no such guarantee, because the outline is not the thing being
split.

---

## 3. Why it is fixable

Every generated handle can be moved by hand. When it is, the move is stored on
the skeleton point, for that side of the stroke and that end of the handle. The
outline's shape is therefore already fully controllable from the skeleton, by a
store that exists and is already written to.

Writing those stored moves from code is the same act as dragging the handles.

---

## 4. Proposed solution

One insertion becomes three: one on the centerline, one on each edge.

**The centerline split** is the one that already works.

**Where each edge is split** is not a guess. The new point's rib end lands
exactly on the drawn edge — that is what the width measurement establishes — so
the edge is split at the point where the rib meets it.

**What the split gives.** Splitting a curve at a point on it is exact and hands
back four control points: two for the new point's own handles on that side, and
two shortened ones for the two neighbours it was inserted between.

**How they are written.** Generate the outline once, read what the generator
produced by itself, and store the difference as the handle moves. Four per side,
eight in all, per master.

---

## 5. What makes it more than a small job

**Neighbouring handles may already be held.** The two neighbours' handles on that
side can carry moves of their own, from earlier hand edits. Those are
overwritten. There is no way to keep both.

**A side is not always one plain curve.** A corner, a serif or a rounded join can
merge points on a side or add them, so the edge does not always have one curve
where the centerline has one.

**Every master is its own drawing.** The whole measure-split-write pass runs per
master, against that master's own outline.

---

## 6. Recommendation

Build it, and stand down without writing anything whenever the side is not a
plain single curve. An insertion that quietly changes the shape is worse than
one that stands still and says so.
