# Harmonize: what it does, and why it needs a rework

**Date:** 2026-09-01
**Status:** problem statement. No design decided.
**Measured on:** `_external/problem-glyphs/N^1.json`, point 12, and
`_external/g1_g2_g3_bezier_harmonizer.html`.

This document states the fault. It does not propose a fix. The feature model
(§10) describes the command as built; this describes what is wrong with it.

---

## 1. What the command is for

Two curves meet at a smooth on-curve point. The point is smooth, so the two
handles lie on one line and the outline has no visible corner. It can still have
a crease: the two curves arrive bending by different amounts, and the eye reads
that step under a reflection or on the curvature comb.

Harmonize removes the step. The designer presses a button and the two curves
come to agree at the joint.

**What the designer expects of it.** Fix the joint. Change as little else as
possible. The drawing is theirs; the crease is the only thing they asked to have
removed.

---

## 2. How it works today

Four things happen on one press.

**A preparation pass**, opt-in. It squares up a joint whose handles have drifted
off one line.

**A construction.** The default one moves the two handles either side of the
joint. It computes a canonical position — a specific ratio between the two sides
— and moves the handles until the joint sits at it. A second construction is
opt-in: it gives every selected point one curvature shared by both its sides,
and re-solves all four handle lengths of both curves to reach it.

**A repetition.** The press runs prepare-then-solve up to sixteen times, keeping
every state it lands on, and stops when a drawing comes round a second time.

**A scored gate.** Every state, including the drawing as it was handed in, is
ranked. The ranks in order: broken geometry, a handle past the tension ceiling, a
crease at a smooth point, a joint left worse than a bound, an answer its own
solver refused, then a residual, then how far the drawing moved.

The residual is dominated by bending energy. Lower means flatter.

---

## 3. What is wrong

### 3.1 The construction targets a canonical answer, not the nearest one

One equation — the two curvatures must be equal — and two handle lengths to
solve it with. There are infinitely many pairs that satisfy it. The construction
picks one particular pair, and that pair can sit a long way from the drawing.

On the reported joint, which arrives 4.27 per cent out:

|                                                     | joint left at | drawing moved |
| --------------------------------------------------- | ------------- | ------------- |
| the construction, one attempt                       | 0.57%         | 40 units      |
| the smallest change that fixes it, same two handles | 0.0000%       | 5.6 units     |

The nearest answer is exact and moves the drawing seven times less. Nothing is
being bought by the extra movement.

### 3.2 Once the joint is good enough, the command chooses on flatness

The joint rank is a bound, not a target: an answer that leaves the joint under
the bound scores the same as one that leaves it at zero. So as soon as every
answer on the table clears the bound, that rank ties and the decision falls to
the residual — bending energy. The flattest answer wins.

Every state the press drew for the reported joint, in the order it drew them:

| state          | joint left at | drawing moved | residual |
| -------------- | ------------- | ------------- | -------- |
| as handed in   | 4.27%         | 0             | 6.88     |
| first attempt  | 0.57%         | 40            | 6.34     |
| second attempt | **0.86%**     | 80            | 5.91     |
| third attempt  | 0.006%        | 85            | 5.86     |

The second attempt leaves the joint **worse** than the first and still beats it,
because it is flatter. The third wins outright. The command therefore spends 45
more units of movement, and nine per cent of the handle lengths, on a difference
in the joint that nobody can see.

This is the recorded design. It was chosen so a joint could go from 0.48 to 0.72
per cent "in exchange for a curve worth having". On a joint that arrives badly
broken that trade is right. On a joint that arrives nearly harmonic it buys
nothing and costs the drawing.

### 3.3 The two faults compound

Together they take a joint that was 4.27 per cent out to 85 units of movement and
segment tensions from 0.853/0.847 down to 0.773/0.777. The reference
implementation reaches an exact match on the same joint with two units.

### 3.4 The opt-in construction is a dead control on most joints

With the tick on and off the output is byte-identical at three of the four smooth
joints of the reported glyph. It changes the answer only where the ordinary
construction leaves the joint far out. It is a fallback, not a feature, and its
name says otherwise.

---

## 4. What the reference implementation does

`_external/g1_g2_g3_bezier_harmonizer.html`, about thirty lines of solver.

It treats the four handle lengths as four dials and asks one question: what is
the smallest turn of those dials that makes the two curvatures equal? It solves
that by Gauss-Newton, taking the minimum-norm step each time.

Four details matter.

- **It solves for the nearest answer.** One equation, four unknowns, and of the
  infinitely many answers it takes the one closest to the drawing.
- **It works in proportional terms.** The unknowns are multipliers on the
  handles as drawn, in log space, so "a small change" means a small percentage of
  each handle rather than a small number of units. The correction spreads across
  the four handles in proportion to what each can contribute.
- **It caps each step and undershoots.** No dial turns by more than forty per
  cent in one iteration, and each step is taken at nine tenths.
- **It stops at zero.** There is no candidate field, no score and no second
  pass. When the mismatch is gone it is finished.

It never moves an on-curve point.

Measured against ours on the reported joint:

|                                         | tensions      | joint left at | drawing moved |
| --------------------------------------- | ------------- | ------------- | ------------- |
| as drawn                                | 0.853 / 0.847 | 4.27%         | —             |
| reference, four handles                 | 0.851 / 0.849 | 0.0000%       | 2.0 units     |
| the same, restricted to our two handles | 0.848 / 0.852 | 0.0000%       | 5.6 units     |
| ours                                    | 0.773 / 0.777 | 0.0064%       | 85.0 units    |

**Which difference matters.** Restricting the nearest-answer solve to the same
two handles ours uses still fixes the joint exactly, with 5.6 units. So spreading
the work over four handles is worth a little. The gap from 6 units to 85 is
almost entirely §3.1 and §3.2.

---

## 5. What is not known

**G3 is a different problem, and the reference does not solve it gently.**
Matching the rate of change of curvature as well is two equations. On the same
joint:

|               | tensions          | joint   | rate step | drawing moved |
| ------------- | ----------------- | ------- | --------- | ------------- |
| reference, G3 | **1.265 / 1.263** | 0.0000% | 5e-17     | 461.6 units   |
| ours, G3      | 0.525 / 0.531     | 0.65%   | 3.1e-7    | 288.0 units   |

The reference's answer puts both handles **past the tension ceiling**, where a
segment's two handle lines cross and the curve doubles back. Our domain forbids
that, and rightly. So the nearest-answer approach cannot simply be adopted for
G3: it needs the ceiling as a constraint, and with the ceiling enforced the
nearest answer may not exist at all.

Neither number here is good. G3 on this joint is expensive whichever way it is
solved, and it is not clear that either answer is what a designer wants.

**Three questions a rework has to answer.**

1. Does the nearest-answer solve stay continuous while the designer drags? Every
   frame is recomputed, so an answer that jumps between two configurations is
   unusable however accurate it is. Gauss-Newton from a fixed start with a fixed
   trip count is deterministic; deterministic is not continuous, and this project
   has paid for that distinction before.
2. What happens on a joint that arrives badly broken, where the nearest answer
   may be a poor shape and a canonical one may be what is wanted?
3. What is left of the scoring layer? With one answer instead of a field, most
   of it has nothing to choose between. The parts that are invariants rather
   than preferences — the tension ceiling, the crease bound — still have to hold.

---

## 6. What a rework must keep

These are not preferences. Each was paid for.

- **A press is a fixed point.** Press it twice and the second press does
  nothing. Two separate loops in the current code failed this and were fixed.
- **No answer may cross the tension ceiling.** Past it a segment's two handle
  lines cross and the curve doubles back.
- **No answer may buy continuity with a crease.** Curvature agreement across a
  joint with no common tangent means nothing. The answer is rounded to whole
  units and the next attempt reads the tangent off the rounded handles, so a
  search will walk a joint off the line one step at a time unless something
  scores it.
- **The verdict describes the drawing that was kept.** A command that reports
  success on a state it discarded is worse than one that reports nothing.
- **A point is written only where it is not already there.** A command with
  nothing to do must not take an undo step.
- **Whole units.** The grid is where the drawing lives, and an answer is judged
  where it will land, not where the exact solution is.
- **It reaches a skeleton centerline.** A centerline is an ordinary path, and
  what it generates follows from it.

---

## 7. Not part of this

Balancing was split out of this command on 2026-09-01 and is now its own. It
brings a curve's two handles to one shared tension while holding the curve's own
fullness fixed. It is not implicated in anything above, and a rework of
harmonizing should leave it alone.

---

## 8. The panel, as the designer asked for it (2026-09-01)

The checkboxes go. One positional slider replaces them. Each position says how
much the command is allowed to move. The positions run from least movement to
most.

1. **The reference solve.** Handle lengths only. The nearest answer. It moves no
   point.
2. **Our construction, holding the joint still.**
3. **Our construction, allowed to move the joint along its tangent.**

At most four positions. Three are named here.

**The match-curvature tick goes.** Position 1 takes its place.

**G3 stays opt-in, and it has one position.** It is a separate control. Turning
it on greys the slider out.

The slider does not apply under G3. Position 1 cannot: the reference solve on two
equations is discontinuous and asks for handles far past the tension ceiling
(section 9.1). Position 3 is refused: moving the on-curve draws a shape the
designer does not want under G3, and it moves the drawing 1013 units on `I^1`
against 201 under G2. What is left is one answer, which is our own construction
with the joint held still.

---

## 9. The unknowns, measured 2026-09-01

Measured on `_external/problem-glyphs/N^1.json` and `I^1.json`, over the nine
smooth joints in them that arrive with a curvature step. The reference solve was
ported into a throwaway probe and run against our own command.

### 9.1 Continuity: G2 holds, G3 does not

A drag moves an on-curve point and carries its two handles. Under that drag, in
steps of a quarter unit, the reference G2 answer moves at most 0.06 units per
step on every joint of `N^1`, and at most 0.15 on four of the six joints of
`I^1`. The solve is continuous.

**It is continuous and it is not bounded.** On the two remaining `I^1` joints the
node drag carries the joint toward an inflection. The two curvatures fall toward
zero, and the answer grows smoothly to match them. Point 19, over three units of
drag: curvature 6.5e-5 to -6.0e-6, the answer's largest tension 1.95 to 3.85, and
the handle movement 1227 to 2517 units. Nothing jumps. The answer simply asks for
handles far past the tension ceiling.

**G3 is discontinuous.** Over the same sweeps the G3 answer steps by 1397, 2149,
2421 and 2687 units between two adjacent frames, and reaches a tension of 11.34.

### 9.2 The grid takes most of the nearest answer back

The nearest answer is exact in floating point and does not survive whole units.
Rounded, the joint it leaves:

| joint      | arrives | exact  | rounded |
| ---------- | ------- | ------ | ------- |
| `N^1` pt12 | 4.177%  | 0.000% | 1.206%  |
| `I^1` pt4  | 77.021% | 0.000% | 14.819% |
| `I^1` pt19 | 15.137% | 0.000% | 3.936%  |
| `I^1` pt13 | 11.229% | 0.000% | 0.568%  |

A grid search is therefore still needed. This is the rule the log already states:
a harmonic answer is a ratio, so rounding the two ends independently can undo all
of it.

### 9.3 A badly broken joint: ours is not worse

Movement of the drawing, per joint. `ref4` is the reference over four handles,
`ref2` the same restricted to the two handles ours moves, `ours` the present
command with whole-unit output.

| joint      | arrives | ref4 | ref2 | ours |
| ---------- | ------- | ---- | ---- | ---- |
| `N^1` pt12 | 4.177%  | 2.0  | 5.6  | 85.0 |
| `N^1` pt3  | 17.382% | 11.1 | 36.2 | 36.0 |
| `N^1` pt10 | 26.855% | 25.2 | 56.6 | 56.0 |
| `I^1` pt4  | 77.021% | 38.5 | 43.1 | 34.2 |
| `I^1` pt19 | 15.137% | 4.2  | 10.6 | 13.6 |
| `I^1` pt3  | 3.783%  | 1.4  | 1.2  | 1.0  |
| `I^1` pt6  | 0.947%  | 0.5  | 0.4  | 1.0  |
| `I^1` pt13 | 11.229% | 8.7  | 7.0  | 7.0  |
| `I^1` pt16 | 9.960%  | 5.2  | 4.6  | 5.0  |

**The 85 units are one joint, not the command.** On seven of the nine joints ours
moves the drawing about as far as the nearest answer restricted to the same two
handles, and on two of them less. On `N^1` pt12 it moves fifteen times further.

**Four handles buy something real on a broken joint.** `N^1` pt3 and pt10: 11.1
against 36.2, and 25.2 against 56.6.

**Ours leaves less residual than the reference does on the grid.** Ours leaves
0.006% to 0.995% at these joints. The reference rounded leaves 0.433% to 14.819%.
The grid search is what buys that, and it is the part that must be kept.

### 9.4 Realign moves nothing

Run over every smooth joint of both glyphs, on all three layers, realign moved no
point at all. It moved 0 of 88 points. It fires only on a joint whose handles have
drifted off the line, and no joint in either glyph has.

### 9.5 What is left of the scoring layer

Not answered by measurement. It is a design question, and it is the next one to
settle.
