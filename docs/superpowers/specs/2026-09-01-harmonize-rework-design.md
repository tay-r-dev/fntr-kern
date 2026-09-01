# Harmonize: the rework

**Date:** 2026-09-01
**Status:** design, approved. No implementation plan yet.
**Companion to:** `2026-09-01-harmonize-rework-problem.md`, which states the fault
and holds every measurement cited here.

---

## 1. What changes, in one paragraph

Today one press draws several answers and ranks them. The ranking is what spends
85 units of movement on a joint that arrived 4.177 per cent out. The rework makes
the designer name the answer. One control names one construction. One
construction gives one answer. The ranking has nothing left to choose between, so
it goes, and what survives of it is two refusals and one rule for landing on
whole units.

---

## 2. The panel

One slider with three positions replaces four tick boxes. The positions run from
least movement to most.

| position | name                  | what it may move                             |
| -------- | --------------------- | -------------------------------------------- |
| 1        | Nearest               | the four handle lengths, as little as it can |
| 2        | Canonical             | the two inner handle lengths                 |
| 3        | Canonical, joint free | the two inner handle lengths, and the joint  |

Three tick boxes go: the one admitting the second construction, the one
realigning the handles, and the one moving the on-curve point.

One tick box stays: applying the command to other sources. It says which layers
are edited. It says nothing about what the command computes.

**Why a slider and not tick boxes.** A tick box on this panel is not a switch.
The tick admitting the second construction adds an answer to a field, and the
field then decides whether to keep it — which is why the output is identical with
that tick on and off at three of the four smooth joints of the N glyph. The G3
tick means "try G3, fall back to G2 at any joint where G3 has no admissible
answer", so one press can leave neighbouring joints solved two different ways. A
slider position names the construction that runs. The designer gets what the
control says.

---

## 3. Position 1: the nearest answer

Ported from `_external/g1_g2_g3_bezier_harmonizer.html`.

Four multipliers, one per handle length, all starting at one. The solver asks for
the smallest set of multipliers that makes the two curvatures at the joint equal.

- **It works on the logarithms of the multipliers.** A small change is therefore a
  small percentage of each handle, not a small number of units. The correction
  spreads over the four handles in proportion to what each can contribute.
- **It steps by Gauss-Newton and takes the minimum-norm step.** One equation and
  four unknowns has infinitely many answers. The minimum-norm step is what picks
  the one nearest the drawing.
- **It caps each step and undershoots.** No multiplier changes by more than forty
  per cent in one iteration. Each step is taken at nine tenths.
- **It stops at zero.** No candidate field, no score, no second pass.
- **It never moves an on-curve point.**

### It moves the four handles, and that is a departure

The two outer handles are inputs to the other two positions and never outputs,
because a cubic's end curvature depends only on its last three control points.
Position 1 moves them. That is what buys the accuracy: on point 3 of the N glyph
the four-handle answer moves the drawing 11.1 units and the same solve restricted
to the two inner handles moves 36.2.

Moving an outer handle changes the curvature at the next joint along. The sweep
(section 5) is what settles that, and it already exists for the same reason.

### It obeys the tension ceiling

No handle may reach past the point where its segment's two handle lines cross.
Past there the curve doubles back.

This is a live constraint at position 1, not a formality. Where a drag carries a
joint toward an inflection, both curvatures fall toward zero and matching them
asks for arbitrarily long handles. Measured on point 19 of the I glyph, over
three units of drag: curvature 6.5e-5 to -6.0e-6, largest tension 1.95 to 3.85,
handle movement 1227 to 2517 units. Nothing jumps. The answer simply grows.

The solver holds every multiplier inside the ceiling. Where a handle lands on the
ceiling the two curvatures do not match, and the joint reports `tension-limited`.
It does not report `harmonized`.

### G2 only

Position 1 is one equation. On two equations the same solver is unusable, and
this is measured, not assumed. Over a quarter-unit drag sweep its answer steps by
up to 2687 units between two adjacent frames. It reaches a tension of 11.34. It
moves the drawing 461 to 2611 units on the joints where it converges at all.

---

## 4. Positions 2 and 3

Today's construction, unchanged. Position 2 holds the joint still. Position 3
lets the joint slide along its own tangent.

The slide is a real difference and not a dead control. Measured on the I glyph it
changes 18 points and 201 units of drawing.

---

## 5. What survives the field

### The sweep stays

Every joint on a closed contour shares a segment with the two beside it, so
correcting one joint disturbs its neighbours. The loop runs over the ring until
nothing moves anywhere. This is one construction applied repeatedly to reach one
answer. It is not a field.

### Realigning always runs

It squares up a joint whose handles have drifted off one line. Every construction
here solves against the tangent at the joint, so a joint that arrives bent limits
the answer.

It becomes unconditional. Measured over every smooth joint of the N glyph and the
I glyph, on all three layers, it moved 0 of 88 points. It fires only on a bent
joint. There is no reason for the designer to switch it off, and a control that
does nothing on a healthy drawing is a control that teaches nothing.

### Two invariants stay, as refusals rather than ranks

- **No handle past the tension ceiling.**
- **No crease at a smooth point.** Curvature agreement across a joint with no
  common tangent means nothing. Every construction moves points along the
  tangent and so preserves the joint exactly, but the answer is rounded to whole
  units and the next sweep reads the tangent off the rounded handles. Without a
  check the search walks the joint off the line one step at a time.

An answer breaking either is not written. The joint reports what stopped it.

### The grid rule

The exact answer sits between whole units, and rounding each point to its own
nearest unit throws most of the answer away. Measured, the joint left behind:

| joint            | arrives | exact  | nearest-unit rounding |
| ---------------- | ------- | ------ | --------------------- |
| N glyph point 12 | 4.177%  | 0.000% | 1.206%                |
| I glyph point 4  | 77.021% | 0.000% | 14.819%               |

So the command tries the whole-unit positions around the exact answer and keeps
the one that leaves the smallest curvature step. A tie goes to the position that
moves the drawing less.

**The drawing as it stands is one of those positions.** A command with nothing to
gain therefore writes nothing, and a second press does nothing. This is the whole
of the fixed-point promise now: there is no press-level repetition left to settle.

### What goes

- The sixteen rounds of prepare-then-solve.
- The rank on bending energy. This is the second fault: once every answer clears
  the joint bound the ranks tie, the flattest answer wins, and the command spends
  45 more units of movement on a difference nobody can see.
- The rank on distance moved, as a chooser between constructions.
- The bound on the joint, and the ratchet that stood it down.
- The rank on an answer its own solver refused. With one construction there is no
  second answer for it to lose to.

---

## 6. G3

One control. One construction. Ours, with the joint held still.

Turning G3 on greys the slider out. Position 1 cannot apply, for the reasons in
section 3. Position 3 is refused: moving the on-curve point under G3 moves the
drawing 1013 units on the I glyph against 201 under G2, and the shape it draws is
not wanted.

---

## 7. What must still hold

Carried from the problem statement. Each was paid for.

- A press is a fixed point.
- No answer crosses the tension ceiling.
- No answer buys curvature agreement with a crease.
- The verdict describes the drawing that was kept.
- A point is written only where it is not already there.
- Whole units. An answer is judged where it will land.
- It reaches a skeleton centerline, which is an ordinary path.

---

## 8. Not part of this

Balancing is its own command and stays alone. It brings a curve's two handles to
one shared tension while holding the curve's own fullness fixed.
