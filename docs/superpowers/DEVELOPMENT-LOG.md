# forkra Development Log

One section per feature, holding what the other two documents do not: the faults
that came back, the measurements that settle a question, and the ideas that were
built and withdrawn. `FEATURE-MODEL.md` says how a feature works.
`FEATURE-ARCHITECTURE-MAP.md` says where the files are.

**Adding to it.** Finishing a task means editing its feature's section: add what
is new, delete what the work just made untrue. Do not append — a superseded
statement is worse than a missing one, because both read as current.

**What earns a line.** A fault that came back, a measurement that settles a
question, or an idea withdrawn. A fix that came back never, taught nothing
reusable and carried no number is not recorded; the commit holds it. A finding is
its claim and that number — no mechanism the code already shows, no rule the
feature model states, and no lesson learned twice, which goes in §0 instead. Keep
order inside a section only where the sequence is the lesson: the offset
construction says so, and it is the only one.

---

## 0. The lessons this log kept re-learning

Each was paid for in more than one feature.

- **Read the file at the moment of the question, and say which state a number
  came from.** Three investigations measured a glyph redrawn under them.
- **Test a geometry change with a sweep, not an assertion**, and start it away
  from a degenerate configuration or it reports its own seed as a 765-unit jump.
  A per-configuration assertion has missed nearly every fault in the generator.
- **Sweep design decides the answer.** Parameterizing by handle-length fraction
  claimed the optimum wants tension 4; by tension it never asks past 1.04. A
  serif sweep that rotated the axis instead of leaning the stroke measured its
  own clamp.
- **One number cannot hold two jobs.** Coordinate scale against geometric
  ceiling, ceiling against the pin's unit, colour ramp against fringe anchor,
  group visibility against a shared target. Five times; the fix is two numbers.
- **A dead level has a reader and no writer.** Four found. The check is who
  writes it, not who reads it.
- **A helper that identifies geometry by position re-identifies it when the
  geometry moves.** A comb probe slicing by bounding box reported an 89 per cent
  rise on an untouched segment.
- **A rollback is a statement about the whole gesture**, so every frame records
  against a fresh copy of the pre-drag state, never the live glyph.
- **Enumerate what a clamp has to cover before clamping anything.** Three things
  travelled with one drag and each leaked separately.
- **Two things can be coupled by the order they run in rather than by their
  geometry.** Check which runs first before calling a coupling unavoidable.
- **A stat that measures the wrong thing is worse than no stat**, and **check the
  instrument before the geometry.** A tension-bound counter read 34 per cent
  where the truth was 2 in 118; the comb drew 2.73 units for a joint 1.4 per cent
  out and 0.16 for the same joint 23 per cent out. Four rounds went into geometry
  that was right every time.
- **Quoting a rule is not applying it: apply it to a measurement.** Two commits
  cite a rule in the message and break it in the diff.
- **A test that asserts an exact identity for a least-squares answer is asserting
  the thing least squares exists because you cannot have.**

---

## The curvature comb (SpeedPunk, map F3)

**State: settled on a normalized reading.** Eleven rounds. Ten reworked the
drawing rule without settling and the comb was reverted to `2242d76b`; five
commits took both scales absolute, in radius; the eleventh replaced the radius
with a turn. **The readout was never allowed to carry a unit of length.**

Reported on `tildecomb.json`: against the then ramp of 400 to 180, 88.9 per cent
of a combining tilde pinned to the last stop, median radius 67, longest fringe
174 units on a mark 100 units tall.

- **The first diagnosis — the anchors are calibrated on the wrong glyphs — was
  half right and useless.** Two rounds of ramp-widening options were written up,
  including a per-glyph override. The designer refused all of it: a circle is a
  circle. **Scaling a drawing must not change what the comb says about it**, and
  no band fixes a length reading, it only moves which sizes read correctly.
- **The quantity is curvature times a length taken from the shape**, which is the
  turn. Harmonize scores a joint the same way.
- **The length must be continuous**: the mean of the arc lengths meeting at an
  on-curve, linear between a segment's ends. A per-segment length is closed —
  neighbours on the tilde differ by up to 54 per cent across smooth joints, the
  fault the per-segment curvature divisor showed at 27 per cent on `d`.
- **The cost is real and bounded.** A fringe moves when an immediate neighbour is
  redrawn. The rejected divisors were a peak _searched_ over a scope, so an edit
  anywhere inside rescaled everything; this reaches only the two segments that
  meet, and agreeing at a joint is what the comb is for.
- **A playground font is not a calibration set.** Three glyphs never drawn to be
  representative can show a scale is wrong and cannot tune one. The turn anchors
  need no tuning, which is the point of them.

Measured after, at reference turn 90 degrees and ramp 30 to 120. The tilde's
longest fringe fell from 174 units to 35 against a peak height of 24, and its 13
per cent of grey is its two inflections.

| glyph     | fringe p10 / median / p90 | distinct colours | pinned red | pinned grey |
| --------- | ------------------------- | ---------------- | ---------- | ----------- |
| j         | 16.9 / 22.2 / 28.4        | 173              | 0%         | 0%          |
| k         | 9.5 / 14.9 / 30.5         | 253              | 4%         | 2%          |
| tildecomb | 5.1 / 23.7 / 26.8         | 156              | 1%         | 13%         |

Two rules survive the change of unit from the absolute-in-radius era, when height
went absolute, then colour, and the run grouping was deleted with them — all
forced by the fact that **any relative scale is restretched by an edit anywhere
inside whatever it normalizes over**.

- **A scale needs an anchor a person can name.** Three colour rules took theirs
  from multiples of the peak height, and nobody could say what the top meant.
- **The ramp owns its own two numbers.** Deriving them from the height anchor
  shipped for a session reported as "everything is yellow": 16 to 1 against
  letters occupying about 2.2 to 1.

Two things given up, both real: an absolute colour cannot stretch the contrast on
a flat letter, which now draws nearly one colour; and colour and length encode
the same number twice, kept because they are read at different distances.

### Three things the comb does differently from the donor (`_external/speedpunk`)

|               | donor                                                    | this comb                                                                                              |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fringe length | curvature times a fixed gain, no ceiling, no floor       | the turn times a fixed gain, "full height at turn T", default 90 degrees, soft-ceilinged at twice that |
| Colour        | the glyph's own range, recomputed when the glyph changes | absolute, geometric between two named turns, 30 and 120 degrees                                        |
| Sample count  | a budget divided by the number of curve segments         | that, times √magnification, with the budget divided by magnification first                             |

The donor's fringe carries the size dependence the eleventh round removed — a
deliberate departure, not a port gap. **Ask what the original does before
inventing a rule**: the donor was in the tree for all ten rounds, and five of
them invented scales for a readout whose original states both choices in a few
lines.

### The soft ceiling, added later

The uncapped fringe was accepted knowingly and came back on `I^1`: a fringe of
79 units on an arc whose radius of curvature is 28. **A fringe longer than its
own radius is drawn along rays that meet at the centre of curvature and come out
the far side**, so the comb crosses itself exactly where the drawing is most in
question — 4261 crossing pairs on that one segment.

`softCeilingRatio` bends the height above the anchor toward twice it:
`1 + room * (1 - exp(-(ratio - 1) / room))`, room being the gap. Three
properties it was chosen for, all tested:

- **Below the anchor it is the identity.** A quarter circle still draws exactly
  the peak height at every radius, which is the whole calibration.
- **The slope is unbroken where it takes over**, so the ceiling adds no corner
  to a readout whose job is to show corners.
- **It is strictly rising and never arrives**, so a tighter turn always draws
  longer. A hard clip would have made "tight" and "very tight" one drawing.

**The ceiling is stated in peak heights, so it cannot see the radius.** It
shortened `I^1`'s worst fringe from 79 to 46 and its crossings from 4261 to
3586, which is an improvement and not a fix: 46 is still above that arc's 28.
Stating the ceiling as a fraction of the local radius would end the crossing —
and would put a unit of length back into a readout that eleven rounds took one
out of.

**Still open**, all three out with the revert: the comb does not repaint when a
comb setting changes; the three fields do not scrub and a number box keeps the
keyboard after an edit; sharpness and opacity store the full float of a drag.

### Rejected drawing rules

| Rule                                                                  | Why it went                                                                                                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Divide each fringe by the tallest curvature on its own segment        | Two segments meeting at equal curvature drew unequal fringe — 27 per cent apart on `d`, and a 2.7 per cent difference elsewhere drew as 21.                                      |
| Divide by the tallest curvature on the glyph                          | Redrawing one segment moved the glyph's peak, so every fringe changed at once and two glyphs never shared one scale.                                                             |
| Divide by the tallest curvature on its own run                        | Shipped one day. Same coupling at smaller scope: ten per cent on one segment took 21 per cent off its neighbour.                                                                 |
| A typed reference radius, with a floor and a ceiling                  | A readout you must tune before you can trust it is not a readout, and the ceiling drew two curvatures at one length.                                                             |
| Squeeze the height towards twice the peak                             | Nothing clipped and everything flattened: four times the reference tightness drew 1.6 times the height, eight times drew 1.8.                                                    |
| Colour straight off the curvature ratio                               | It spent 0.33 to 0.77 of the stops on radius 200 to 30, most letters' working range — one colour to the eye.                                                                     |
| Colour off the fringe length, last stop at three or five peak heights | At three, everything above handle tension 1 came out identical; at five it still painted a whole letter one colour.                                                              |
| Derive the colour ramp from the fringe-length anchor                  | "Everything is yellow" — 16 to 1 against letters occupying 2.2 to 1, and one number stating two unrelated things.                                                                |
| Colour relative to the segment, then to the run                       | A joint at the end of a run is an extreme of one of its two segments by construction: on `N^1.json`, two curvatures 0.29 per cent apart drew grey one side and orange the other. |
| Recalibrate the radius anchors — per font, per glyph, or on demand    | Refused before it was built. Every form keeps a length in the readout.                                                                                                           |
| Normalize the turn by each segment's own arc length                   | Closed on the reported tilde before it was built: the divisor steps at every joint, so a G2 joint draws a break.                                                                 |

---

## Harmonize (map F8, carried fork extras)

**State: shipped, reworked 2026-09-01.** One slider names one construction:
Nearest, Canonical, or Canonical with the joint free. G3 has one construction and
greys the slider out. Squaring a bent joint up always runs. It reaches skeleton
centerlines as well as ordinary paths. Feature model section 10 holds the rules;
this is what measured them.

### The 2026-09-01 rework

- **The tick boxes were not switches.** Each one added an answer to a ranked
  field, and the field then decided whether to keep it. The output was identical
  with the match-curvature tick on and off at three of the four smooth joints of
  `N^1.json`. This is the finding that decided the whole slider design.
- **The nearest answer is exact and moves the drawing seven times less on the
  reported joint.** `N^1.json` point 12 arrives 4.177 per cent out. The old
  command moved the drawing 85.0 units and left 0.006 per cent. The nearest
  answer restricted to the same two handles moved 5.6 units and left 0.000.
- **The 85 units are one joint, not the command.** On seven of nine measured
  joints the old command moved the drawing about as far as the nearest answer
  restricted to the two inner handles, and on two it moved less.
- **Four handles buy real accuracy on a broken joint.** `N^1.json` point 3: 11.1
  units against 36.2 for the same solve restricted to the two inner handles.
  Where one side is flat and the other bent, the two inner handles hit the
  tension ceiling and never match the joint at all; all four reach it exactly.
- **The grid search must be kept.** The nearest answer is exact in floats, and
  rounding each point to its own nearest unit leaves 1.206 per cent on
  `N^1.json` point 12 and 14.819 per cent on `I^1.json` point 4, against 0.000
  for the whole-unit search.
- **G2 nearest is continuous but unbounded near an inflection.** Over a
  quarter-unit drag sweep the answer steps by at most 0.06 units. Toward an
  inflection it simply grows: `I^1.json` point 19 over three units of drag goes
  curvature 6.5e-5 to -6.0e-6, tension 1.95 to 3.85, movement 1227 to 2517
  units. So the tension ceiling is a live constraint at position 1.
- **G3 nearest is discontinuous and unusable.** Over the same sweep its answer
  steps by 1397, 2149, 2421 and 2687 units between adjacent frames and reaches a
  tension of 11.34. That is why G3 has one construction.
- **Moving the on-curve under G3 is not wanted.** It moves the drawing 1013
  units on `I^1.json` against 201 under G2.
- **Realigning moves nothing on a healthy drawing.** Over every smooth joint of
  `N^1.json` and `I^1.json`, on all three layers, it moved 0 of 88 points. It
  fires only on a bent joint, so it became unconditional.
- **What the rework withdrew.** The sixteen prepare-then-solve rounds; the rank
  on bending energy; the rank on distance moved as a chooser between
  constructions; the perceptual curvature bound and the ratchet that stood it
  down; the rank on an answer its own solver refused; and the handle-length
  construction with its quartic root finder. Twenty-eight tests went with them
  and seventeen arrived. The suite went 2315 to 2313.
- **Three losses were paid for knowingly.** Two joints that only reached a G3
  answer after repeated rounds now stop at the G2 fallback. The comb-sag
  position the grid search used to reach through bending energy is no longer
  reached. And the reported arch joint, whose correction is 0.344 units, is now
  written rather than discarded at position 2 and slid 11 units at position 3.

### The constructions

- **G2 and G3 answer different questions, and the eye reads the second one.** The
  reported joint on `d` had curvature agreeing to 1.6 per cent, so no setting of
  G2 changed anything; the rate of change of curvature reversed sign across it
  and the joint sat 41 per cent below the hump behind it. G3 cut the rate step by
  a factor of 77.
- **Match the rate per unit of arc, not of parameter.** Two segments run through
  a joint at different speeds, so equal parameter rates leave a mismatch equal to
  their ratio — 10 per cent on the reported glyph. Same closed form.
- **The G3 answer is exact and unique, and one pass is exact at any bias on an
  isolated joint**, since the ratio depends only on the outer points'
  perpendicular offsets from the tangent. Iteration earns its keep on coupled
  joints alone: mean residual over 2000 joints is 1.52 at 40 attempts, 3.27 at
  one.
- **The five-point stencil is complete.** A cubic's endpoint curvature depends
  only on its last three control points, so the outer points are inputs and never
  outputs — why the default leaves the outer handles alone, and why Tunni
  equalization is a separate pass.
- **Roots are bracketed, not Newton-from-zero with deflation.** The donor's
  `newton_roots` folds each root's error into the next, and on a quartic with two
  admissible answers Newton reaches whichever it reaches while the caller is
  choosing between them. Between two turning points a polynomial is monotone, so
  the derivative's roots and a root-radius bound give exact bisection intervals.
- **The quartic was rederived rather than trusted, and the donor is right.**
  Handles as `a(cos A, sin A)` and `(1,0) + b(−cos B, sin B)` give
  `ka = (2/3)(b·sin(A+B) − sin A)/a²`; eliminating `a` reproduces its five
  coefficients exactly.

Per joint on `n`, whole-unit output. No construction wins everywhere, which is
why the third is a check rather than a replacement — joint 4 is the case that
matters, where the joint command's answer is below the grid and G3 leaves the
step larger than it found it.

| joint | as drawn | G2                   | G3 + slide  | handle lengths    |
| ----- | -------- | -------------------- | ----------- | ----------------- |
| 4     | 1.44e-4  | 1.44e-4 (below grid) | 6.61e-4     | **9.08e-5**       |
| 13    | 4.30e-3  | 4.81e-5              | **6.73e-6** | 1.15e-4           |
| 33    | 2.73e-2  | 4.81e-5              | **6.73e-6** | 1.30e-2 (refused) |

- **The on-curve slide, measured both ways.** Over 2000 isolated joints it
  improves the curvature step on 1723 against 253 — the most effective option
  under G3. Over 400 coupled rings it reverses, 77 against 322, because every
  joint sliding at once moves its neighbours' stencils. The complaint behind the
  deletion proposal is a naming problem: under G2 the tick picks who carries the
  correction, under G3 it turns on a search.
- **Realign is worth two things, and not the one it was argued for.** Every
  construction re-collinearizes the joint as a side effect, and two tests written
  from the "solved against a tangent that is not there" reasoning failed against
  a joint that came out straight to 6e-15 without the pass. It is worth keeping a
  flat handle flat, 104.955 against 100 on the bent fixture, and reaching joints
  harmonize refuses outright, a curve running into a straight having no stencil.

### The grid was eating the whole answer, and the report was covering for it

Reported on the outer arch of `n`: a step in the comb, and harmonize saying "1
harmonized" while nothing moved.

- **A harmonic answer is a ratio, so rounding the two ends independently can undo
  all of it.** The exact G2 answer is a move of 0.344 units; rounded to nearest
  the ratio came back as 51/40 = 1.2750 against the drawn 65/51 = 1.2745. Nearest
  rounding lands **worse than doing nothing**, 3.537 per cent against 3.156, the
  gate reverts, and the command writes nothing. The grid position is chosen now —
  snap to nearest, then try the whole-unit positions bracketing each point's own
  exact answer. Arch joint 3.156 to 0.423 per cent.
- **A verdict read off a discarded state is worse than no verdict.** When no
  attempt beat the drawing the report came from the last attempt's states, which
  said `harmonized`. The one instrument pointing at the fault reported success.
- **Three sessions went into the rounding because the rounding is where the chain
  starts, not where it ends.** Rounding forces a scoring gate, the gate reverts
  silently, the report describes the reverted state; every session found a link
  and treated it as the cause.

### The score was measuring the wrong thing, twice

- **The score had no rate term, so G3 was judged on G2.** From a G2-optimised
  drawing, all four whole-unit placements bracketing the exact G3 answer score
  worse on curvature alone, so G3 could never take over from an already-harmonic
  joint.
- **The first rate term normalised by curvature and broke the inflection
  fallback.** `|dk| / mean(|k|)` saturates at exactly 2 at every inflection, and a
  score with no gradient there cannot tell the G2 fallback's answer from the
  drawing it started on. Normalising by the joint's **length** makes every term
  an angle, so the three add with no weight to choose.
- **G1 was preserved by definition and therefore never checked.** Rounding lets
  the next attempt read the tangent off rounded handles, so the search buys a
  bend with each sliver of continuity: on the worst of 2000 joints the residual
  fell 31.7 to 1.1 while the joint creased from 0.5 to 13.1 degrees, and 17.9 per
  cent of the population finished bent past anything the grid could account for.
  Joints over the grid's allowance: 358 before, 0 after. The cost is mean
  curvature discontinuity rising from 6.8e-3 to 7.7e-3, because some of what the
  old number called an improvement was a crease.
- **Freezing the tangent was the wrong fix, and the trace said so.** It broke the
  coupled-ring tests, since on a ring the tangent legitimately rotates; the trace
  then showed the residual falling monotonically while the kink grew, which is a
  search choosing bent candidates because nothing scored the bend.

### The ranking, and the four reports that built it

Four reports on the same tick, each the same fault in different clothes. The
ranking that answers them is feature model §10.5.

- **`j.json` point 3 — a bad drawing disarmed the guard.** The joint arrives 130
  per cent out, and with equalization on the left segment came out at
  0.880 / 0.191 — the opposite of what the tick asks. The balance was fine at
  0.609 / 0.609; what overwrote it was the handle-length solve, which **reported
  `partial`, reason `degenerate`** and won the gate anyway. The curvature bound
  stands down where the drawing arrived worse, so read off the arriving drawing
  alone it is permanent: it forbade nothing at 130 per cent and the choice fell
  to bending energy, twenty to fifty times the joint terms and preferring the
  flatter curve. **The fix is the ratchet** — the bound is the worse of the
  perceptual one and the best step anything on the table reached — which also
  forced the constructions to be drawn first and chosen afterwards. G3 with both
  ticks went from 430 to 255 joints left over 3 per cent and worse than drawn.
- **`B^1.json` point 3 — an answer its own solver had refused**, this time inside
  the perceptual bound, so the ratchet had nothing to say. Refusal is a rank now,
  below the hard defects and above everything measuring the curve. **The same
  three words mean different things to the two constructions**: a joint
  construction scales its step back at a limit, so `clamped` there is a real
  answer partly applied, while the handle-length solve is taken whole or not at
  all. Counting the first as refusals made four tests report `skipped` where they
  had reported `partial`, which is how the distinction was found.
- **`B^1` redrawn — the tick did two unrelated things, and they fought.** It
  balances the segments before the solve and admits the handle-length
  construction, **which has no balancing property at all**, so whenever that wins
  the tick's promise goes with it, and under G2 it usually wins. An answer
  leaving a segment's two tensions more than 0.05 apart now loses — a count and a
  flat bound, so the tick means the same thing on every drawing. Two softer forms
  were rejected: a tolerance of 0.25 leaves 0.605 against 0.826, and bounding by
  how lopsided the drawing had it leaves 0.651 against 0.739. Cost over 1500
  joints: median step 2.69e-2 to 3.13e-2 under G2, 3.12e-2 to 3.99e-2 under G3.
  **Exact equality and an exact joint cannot both hold in general** — balancing
  sets the ratio of a segment's two handles and harmonizing sets the inner one.
- **`B^1` again — the repetition was not repeating.** One press left the joint
  137 per cent out, and **raising `pressAttempts` changed nothing**, which is the
  tell. A drawing the balance has just prepared is perfectly balanced, so the
  handle-length solve **refusing to move** outranked a real answer on the balance
  rank added the round before, and the loop saw its own starting point come round
  and stopped. **Where to look next and which answer to keep are different
  questions.** Self-inflicted, one round old, and invisible to every test: 2003
  passed while the loop ran once.

### Balancing became its own command

Reported on `N^1` point 12: with the tick on, every press flattened the curve a
little more. Segment tensions went 0.853/0.847, then 0.858/0.839, 0.838/0.857,
and on down to 0.815/0.815 after about forty presses. With the tick off one
press settled and a hundred more moved nothing.

- **Two exact answers to the same two numbers do not exist.** A curve's end
  curvature is set by its last three control points, so the inner handle is what
  harmonizing moves and it is also half of what balancing sets. Whichever runs
  last wins outright. Inside one press they chased each other and each round
  trip lost a little handle length.
- **The designer's own proposal — balance, harmonize, balance — was built and
  measured before anything else.** It gives up the joint entirely: on the same
  point the mismatch ran 6.9, 9.5, 13.0, 17.8, 33.6 and 63.1 per cent over eight
  presses while the handles stayed exactly balanced. It diverges. Reported back
  with the numbers and the model was chosen instead.
- **Splitting it exposed a second non-settling loop the balance had been
  masking.** The repetition took the joint construction's answer and stopped
  when it had seen it before — and where that construction has nothing left to
  do, its answer IS the state the attempt started from. So the loop stopped on
  its first attempt while the curvature-matching construction still had
  somewhere to go, and the drawing advanced one step per button press for eight
  presses. The walk falls through to the next construction drawn now. The
  attempt ceiling went from 8 to 16 with it: it is a ceiling and not a cost,
  since the loop stops as soon as everything has come round.
- **The round count inside the handle-length solve was innocent**, and checking
  it first is what showed the loop was the subject: 5, 20 and 60 rounds all
  settled at press 9.
- Measured after, on the reported point: one press and forty presses are the
  same drawing, with the tick on and off alike.
- **The balance rule was wrong on its first outing, and the designer named the
  right one.** It picked the shared fraction by least squares over the curve,
  which moves the drawing least in POSITION — and that inflates the segment's
  own tension on anything lopsided: 21 per cent at 0.375 against 1.125, 64 at
  0.225 against 1.200, 136 at 0.150 against 1.350. Holding the HARMONIC MEAN of
  the two tensions fixed changes the split and nothing else, because that mean
  IS the segment's tension. It is the rule the Tunni gizmo's equalize gesture
  already used, so the fix was to stop having two.
- **Balanced then rounded is no longer balanced**, so one pass left a little for
  the next press and the command took two. Three fixed passes reach the position
  the rounding is a fixed point of, and a segment that cannot be improved on
  whole units reports `already-balanced` rather than a refusal.
- **Two promises came out of the press with the balance.** It no longer leaves
  the drawing balanced, and it no longer keeps a handle off the tension ceiling
  — the stalled-joint fixture now lands a handle exactly on its crossing and
  reports `partial/tension-limited`, which is honest. Balancing afterwards takes
  it off. Both were the tick's doing rather than the solve's, and both are now a
  second press.

### Pressing the button again

A press was not a fixed point: over 2000 joints a second press moved 21 under G2
and 35 under G3, and with both ticks on it moved 1115, improved 660 and made
**430 worse** — a gamble that read as convergence. The whole press repeats inside
one scored gate now, and without the ticks it settles completely, 0 of 1500.

- **It cannot settle the balance.** Every call balances the drawing it is handed,
  and that drawing has had its inner handles moved by the previous solve, so 1082
  of 1500 second calls still move. **A loop can make one answer settle. It cannot
  make two answers agree.** Curvatura keeps its tunnify separate, and this log
  has said that is the better model twice.
- **Three attempts at a floor, and why none work.** Making the gate's floor the
  prepared drawing fixes the reversion and costs idempotence; making it the
  arriving drawing restores idempotence and brings the reversion back. There is
  no third place while the balance lives inside the command.
- **The two-press flip, and the candidate that was missing all along.** On `j`
  point 3, a period-two cycle between x = 260 and x = 190, seventy units apart,
  with identical curvature and rate to every printed digit. **The state a press
  keeps is not a candidate of the next press** — every press prepares first, so
  what the designer is looking at was never on the table. It is a candidate now.
  Built and reverted once, when the balance ran inside the gate; what makes it
  safe is that a crease, an unbalanced segment and a curvature step all rank
  above the curve.
- **Ranks needed a tie tolerance.** The flip states differed in the twelfth digit
  under an exact comparison, so dust settled which was kept. Ranks tie within a
  relative 1e-9, and travel breaks what is left.

Over 1500 random joints, against the previous round. Both stability and quality
improved, which is the sign a candidate was missing rather than a trade made:

|                                 | 2nd call moves | 2nd call worse | over 3% and worse than drawn |
| ------------------------------- | -------------- | -------------- | ---------------------------- |
| G2 + equalize                   | 1050 → **615** | 579 → **252**  | 223 → 201                    |
| G3 + equalize + realign         | 863 → **371**  | 476 → **122**  | 257 → 239                    |
| G3 + slide + equalize + realign | —              | —              | **19**, median step 1.03e-2  |

**A test that pins coordinates cannot survive a search**, and **one report fault
silenced six tests at once**: the fallback report was `field[1]`, which had been
the first solved answer and became the arriving drawing, whose report is null.

### What the donors settled

- **The G2 construction is confirmed from four independent directions.**
  SuperTool intersects the outer handle lines at `D` and takes
  `r = sqrt((|PP−P|/|P−D|)·(|D−N|/|N−NN|))`; Curvatura never builds `D`, using
  `t = (d2 − sqrt(d2·l2))/(d2 − l2)` on the two perpendicular offsets. `PP` lies
  on `P→D`, so `r = sqrt(d2/l2)` — the same construction. Green Harmony reaches
  it by moving the on-curve and Grey Harmony by translating both handles, which
  is our second checkbox and why it is a checkbox and not a slider.
- **Romer removed the G3 algorithm we run.** Curvatura §6.5: the handles may
  exceed the tangent triangle, so an additional inflection occurs, "therefore
  this algorithm has been removed". That is exactly what `maxHandleTension`
  forbids, so the ceiling in `g3Attempt` is the guard he did not have — the
  reason the algorithm is usable here, not a defect.
- **Neither donor refuses a joint because a neighbouring on-curve is a corner**,
  and neither do we. Both refuse a curve running into a straight, as we do: on
  `n` that rules out points 1, 7 and 10. Matching a straight's zero curvature
  means flattening the curve.
- **Equalize belongs before the solve**, which two donors putting it first
  closed. Ours ran last, inside the gate, so it overwrote the exact answer, and a
  harmonic answer the gate declined took the equalization out with it. On the
  arch joint the G3 rate step goes from 5.8e-5 to 1.6e-19. The drawing does not
  end balanced; both other donors accept the same trade.
- **A balance has one free number, and the plain mean is not always it.** The
  fraction that moves the drawing least is a least-squares fit with a closed
  form: `((4|u|² + 3u·v)t₁ + (4|v|² + 3u·v)t₂) / (4|u|² + 6u·v + 4|v|²)` over the
  tangent rays. Where they reach equally far this IS the plain mean, which is
  what Curve Equalizer's Balance and our old rule did; the gain is 5.44 against
  5.67 units of worst deviation on an uneven-reach fixture. The denominator is
  positive for every pair, since 4a + 4b always exceeds 6√(ab). A segment whose
  handles sit on opposite sides of its chord is refused — no one tension
  describes an S.

### Findings

- **A sweep that stops early stops permanently.** Three causes took a joint out
  of the loop for good: a cusp floor reading the handle it was limiting, a
  tension ceiling run once at the start, and rounding nudging a point the sweep
  never looked at again.
- **Doing nothing is a result that has to be arrived at, not assumed.** The sweep
  writes a point several times, so a joint two thirds of a unit out takes a
  correction, takes another, and rounds back onto its starting coordinate — an
  undo step on an already-harmonic contour.
- **Write per point, never a whole path.** Assigning `layerGlyph.path` inside the
  change recorder records a live class instance, which fails on replay. A general
  rule for any geometry operation.
- **A dragged slider does not deliver its value through the field-change
  callback.** It fires once at drag start with the pre-drag value, so the stored
  setting was always one drag stale. `displayValue: true` is a placeholder
  string, not a boolean, and the number box read "true".

### Open

- **A joint the inner gate reverts is invisible to the outer field.** Under G3,
  where the only reachable answer is the tension-limited G2 fallback, the inner
  gate reverts it and the outer field then holds nothing else, so the ratchet
  takes that step as its bound and forbids nothing. `B^1.json` point 3 is left at
  189 per cent under G3 and reaches 1.20 under G2, reporting `skipped/reverted`
  rather than pretending. Letting the outer field see the inner gate's discards
  is the fix, and it is not small.
- **Rounding happens after the tension ceiling**, so a handle at exactly tension
  1 can land a fraction over. Sub-unit, and no candidate avoids it.

### Rejected

| Idea                                                          | Why it went                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A bias slider between moving the joint and moving the handles | The values between its two ends were never asked for.                                                                                      |
| Freezing each joint's tangent from the arriving drawing       | On a ring the tangent legitimately rotates. The drift was the grid search buying bends.                                                    |
| The on-curve slide as a fallback for a failed held solve      | Holding the joint still almost never fails — byte-identical output with it on and off. Opt-in, and when on it is the whole search.         |
| Bound the on-curve slide's range by the inner handles         | They are what the construction replaces. It stopped the search 25 units short where the first admissible slide is 45 and the handle is 20. |
| Harmonize the generated outline                               | Derived, and thrown away on the next regeneration. The skeleton's centerline is an ordinary path and takes the pass unchanged.             |
| Pick the balanced fraction by the curve's midpoint alone      | Built and dropped the same hour. One sample is not the curve.                                                                              |

---

## Serif terminal (map F7, skeleton)

**State: built, backlog retired.** Eleven rounds. Suite 1,805 at the last change.

### The ground rule, and what it costs

Seven on-curve points at every parameter value, coincident where a point has
nowhere to go, tested directly at a wingless half, at zero thickness and at zero
cup rather than inferred from the shape.

- **A half with no wing must add nothing**, and two leaks broke that: the shared
  straight run pushed a spur outside the stroke, and the hollow dimpled the foot
  line by half a unit by bending toward a corner collapsed onto the tip.
- **The rule cost the smooth-release guarantee its unconditional form.** The
  minimum-separation clamps came out with the one-attractor rework, so a handle
  can reach zero and at zero the release is a corner. One clamp survives, the
  15-degree axis-tangent separation.

### The wall is a curve, not a line

Reported on `_external/b.json`: moving tip thickness reshaped the whole stem. The
terminal built itself on a straight line from the rib end along the endpoint
tangent, so on a curved stem the generator cut the real wall at the release
depth, dragged the cut end sideways and turned the surviving handle onto the
tangent — both corrections growing with the depth the serif reaches at.

Greatest distance from the emitted stem wall to the wall emitted with no tip:

| tip thickness | 0    | 20   | 63   | 100  |
| ------------- | ---- | ---- | ---- | ---- |
| before        | 0.5  | 2.6  | 11.2 | 22.8 |
| after         | 0.00 | 0.05 | 0.05 | 0.06 |

- **The construction curve's control point never moved through the sweep**, which
  proved the offset solver innocent and put the fault in the splice.
- **Two stored numbers changed meaning and shift once on reopen**: a curvature
  pin now describes the emitted piece, and wing slope is the incline of the
  wing's top surface. Both agree with the old reading on a straight stem, which
  is why no fixture moved.
- **Reach and ease distance had to become lengths along the wall in the same
  change.** The straight-line model could only advance by depth, carrying the
  point further than the number says by the number over the cosine of the lean:
  an ease distance of 15 moved its wall end 17.3 at a 30 degree lean while its
  other end moved 15. Tip thickness stays a depth, because the thickness of a tip
  is measured square to its foot.
- **Deleting the anchoring took the surviving handle's axis with it**, and three
  tests went quiet rather than loud. The handle at a cut is tangent to the curve
  there, so its own direction is the axis. It has less headroom — a drag that
  reached 30 units stops at 23 — because the old axis pointed somewhere the curve
  does not go.
- **A one-unit floor on the cut is right for a round cap and wrong for a serif.**
  A round cap builds its tip from the direction the leftover piece gives it; a
  serif reads no direction off it and can release at the rib end.

### Faults that came back

- **The pin moved the release**, 25.7 and 22.4 units across the curvature range,
  against 0.000000 of on-curve travel over 400 steps after. The cost is that the
  wall bends back to meet the terminal, 2.6 units on the reported glyph and up to
  about 32 at the bottom of the range. The reasoning that said the coupling was
  unavoidable was wrong, and the designer caught it (§0, coupled by order).
- **The pin nonetheless goes last among the placements.** Detached placement ran
  after it and overwrote it, so a pin on a segment carrying a detached handle did
  nothing to that handle. Both kinds place a handle; the pin states the tension.
- **The gizmo read the trimmed segment**, reporting 0.7487 where the stroke's own
  value was 0.8725, so typing the displayed number moved handles by 9.0 and 7.8
  units. The same defect is present on round caps at 0.0002 — four orders of
  magnitude apart, which is why it survived so long.

### Handles on a serifed terminal

Three faults reported as one, measured against a plain cap on identical input,
which is the oracle.

| fault                                                              | before                                               | after                     |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------- |
| the trim rebuilt off-curves bare and lost the constructed axis     | neighbour swings 14.7 units on a width change        | 0.00, same as a plain cap |
| the offset was authored on the parent curve, consumed on the slice | drag arrives fractional, leaks 3.9 units             | one-for-one, leaks 0.01   |
| a prior fix took the cut off the chord instead of the edge         | serif moves 14 units on a mild curve, 74 on a strong | reverted, 0               |

- **The oracle was worth building before the fix.** A width sweep first returned
  zero for both and looked like it disproved the hypothesis: with no stored
  offset the two joint handles are already colinear, so the inferred direction
  agrees by accident. Two of the three faults were invisible until a probe
  carried an actual offset.
- **The symptom was honest geometry.** While the emitted segment is a slice of a
  constructed curve, a neighbour that moves is correct. The defect was a control
  handed to the designer on the slice while the write landed on the parent.

### Where each bound was written

Four defects with one thing in common: the code did the right thing in one place
and a different thing in another, and the two were never compared.

- A serif drew a wing on the dead side of a single-sided stroke, twenty units
  past the skeleton, because it built both wings from its own numbers where every
  other cap honours the collapse.
- Contour easing grew at two different rates and stopped at one — both ends step
  back by the ease distance, one along the wall in units and one along the
  bracket **as a curve parameter**, and only the bracket end had a bound. Both
  are found by distance now. The reported fix, "clamp both at the wing's corner",
  would have stopped the wall end at twice the reach; said rather than
  substituted quietly.
- **The same ceiling, written in three wrong places.** A bound on the scrub
  missed the typed field and the preset; the bound belongs in the writer — and
  the symptom did not change, because the value was already clamped and the input
  box was showing something else. The panel refuses to write back into the field
  the user just touched, and that refusal was still on at the end-of-drag
  refresh. **Two rounds were spent on the model because the report said the value
  was wrong.** It was not. **A panel that can show a number the model rejected
  makes a correct fix look like no fix at all.**

### Presets

A preset is **one wing plus the underside cup**, ten numbers, written to both
sides on apply, because asymmetry is a decision about the terminal being edited
rather than about the shape that was saved. Five built-ins ported from the serif
lab, which draws at stem width 150, so lengths divide by 7.5 onto the 20-unit
scale while the tip cut angle and the two bracket ratios carry across untouched:

|           | wing | tip | slope | cut | cup | reach | tension | concavity |
| --------- | ---- | --- | ----- | --- | --- | ----- | ------- | --------- |
| Egyptian  | 20   | 20  | 20    | 0   | 0   | 0     | 0       | 0         |
| Clarendon | 18   | 10  | 1     | 0   | 0   | 19    | 0.9     | 0.85      |
| Didone    | 19   | 3   | 0     | 0   | 0   | 13    | 0.7     | 0.8       |
| Old style | 15   | 5   | 7     | 22  | 3   | 20    | 0.62    | 0.66      |
| Wedge     | 13   | 2   | 13    | 0   | 0   | 5     | 0.05    | −0.18     |

- **The seed never fired once.** It tested whether the point held serif data, and
  normalization materializes a serif block on every on-curve point, so the test
  could not pass and every terminal switched to serif came up with no size and a
  bracket out of nowhere. Picking serif applies the default, unconditionally.
- **Protection of existing shapes cost the rule that was asked for.** The stated
  rule was "20-20-20 and all zeroes from down there"; it was built with tension
  migrated to 0.7 and concavity to 0.8 so nothing already drawn would move — a
  guarantee never requested, and exactly what the unseeded terminals were
  displaying. Reported wrong twice before it came out. **A stated requirement
  softened to fit the existing design is still a requirement missed.**
- **Unset stopped existing**, having resolved through a table that was not all
  zeros, so a stored "unset" differed from a stored number on three fields,
  invisibly. **The migration table and the seed were close enough to confuse** —
  they agree on six fields and differ on three, and the field writer reached for
  the wrong one, so an emptied tension box put 0.7 back in.

### The cup

The lowest point sat on the skeleton endpoint, which reads correctly only while
the two halves match. The centre is the midpoint of the two tip bottoms now,
which are the two ends of the cup curve itself — one line and no single-sided
branch, because a collapsed half puts its tip on its own wall. The alternative
offered was the middle of the two stem walls; the designer chose the foot.

Contact height over a stem leaning to 30 degrees, old rule / new rule, in the
perpendicular axis mode. Under a flat foot every row is identical at every tilt,
and that is arithmetic rather than luck: an axis with no rise cannot carry the
contact point off the alignment zone.

| wings              | 0 deg       | 10 deg      | 20 deg      | 30 deg      |
| ------------------ | ----------- | ----------- | ----------- | ----------- |
| 60/60              | 18.0 / 18.0 | 17.7 / 17.7 | 16.9 / 16.9 | 15.6 / 15.6 |
| 20/120             | 18.0 / 18.0 | 17.7 / 26.4 | 16.9 / 34.0 | 15.6 / 40.6 |
| one half collapsed | 18.0 / 18.0 | 17.7 / 12.5 | 16.9 / 6.7  | 15.6 / 0.6  |

The balance is a **fraction of the half-span between the tips**, not a distance,
so it reads the same on a narrow serif and a wide one and a preset carries it
between masters. The alternative offered was a signed distance in units, which
would have joined the length fields and changed meaning with the wing size.

### The serif ties the straight it sits on

A serif terminal qualifies a straight the same way a straight-controlled smooth
point does, so the coupling arrives through the rule that already existed, with
no editor change at all. Attached to a **straight** is the whole condition.

- **The first pass was a separate width override**, with the gizmos taken off the
  outline. Widths are resolved in one place and read back by rendering and
  hit-testing through the same lookup, so an override the editor knew nothing
  about drew a correct outline under handles that had stopped describing it. The
  existing rule made the editor side disappear — rail R-B demonstrated rather
  than asserted.
- **The condition was wrong twice before it was right.** First "the neighbour is
  a corner where the stem turns", which describes nothing real; then "the
  neighbour is non-smooth", which fires on a neighbour non-smooth only because
  its own segment carries handles. **Neither wrong version would have failed a
  test written from it.**
- Cap geometry read stored half widths rather than resolved ones, so a cap on a
  tied endpoint sat off the end of the stroke it caps. Nothing could reach it
  before, because an endpoint could not be tied.

### Two panel mechanics that came out of serif work

- **Every scrub field carries a multiply**, the button showing where that field's
  number lands rather than the ratio: 1.1 says nothing about where a 40 goes, 44
  does. Applied per point.
- **Right-click abandons a drag.** Zero is a legal thing to drag to, so a cancel
  cannot be one; the stream carries a frozen sentinel. Its cost is that every
  consumer draining a value stream must refuse it, including two upstream panels
  that know nothing about this.

### Gaps, and what is left alone

- **The golden fixtures moved for none of the geometry changes above.** They
  carry no non-zero ease distance, no pin plus detached handle on one segment,
  and no asymmetric terminal. **A suite that passes is not evidence for these
  changes**; the direct measurements are.
- **Faults chased in the wrong order.** A half-unit tolerance in the split
  bisection and grid snapping that moved the release in steps up to 0.91 units
  were both blamed first. Both real, neither the subject. **Take a reported
  symptom literally instead of matching it to the nearest defect in hand.**
- `shiftTensionsToMean` treats a pin of exactly 0 as "no pin". It is in every
  curvature pin's code path, so it stays. Architecture map §7, residue 4.
- `7055e87cd` reverted: it made the terminal read its release off the cut in the
  emitted edge.
- **Open — every point a serif emits carries a guessed origin.** There is no
  side, and the owner is picked by a count of position along the contour, so one
  serifed stem produces a dozen points claiming to be the same handle of the same
  skeleton point. Nothing reads them, because every lookup needs a real side.

---

## The offset construction (map F7, skeleton)

**State: settled.** Nine rounds. **Read this section in order — the sequence is
the lesson**, because four reworks each removed the previous one's machinery.

**Why continuity is the requirement.** The contour is rebuilt every frame while
the designer drags, and each frame's output can be geometrically sound with the
drag still unusable: one unit of skeleton movement flipped the handles into a
configuration that fitted the curve just as well and looked nothing like the
frame before. Worst when the distance between skeleton points is small against
the rib width. Accuracy against the true offset is what gets traded for it.

### Round 1: closed form instead of sampling and fitting

Offsetting a cubic preserves the tangent direction and scales its speed by
`1 + width × curvature`, so the only free numbers are two handle lengths. **The
generated handle is the skeleton handle scaled by one plus width times
curvature.**

- Seven discrete decisions came out of the pipeline with this: an adaptive
  error-threshold loop, variable curve splitting, a Newton iteration with an
  early bail, an eight-direction snap for short handles, and the
  average-width-then-translate hack for tapered sides. Locking the direction
  bounded the one-time output change to 1–3 units on a 60-unit stroke, zero at
  the ends; tilting to the true offset tangent would have moved handle points by
  tens of units on tapered strokes.
- **The fixture script could not be run at all.** It imported the pre-port
  generator from a path resolving to a directory that does not exist, in a
  gitignored checkout, at a commit that is not an object in this repo. Fixed
  before any geometry changed, proved by a byte-identical regeneration.
- **Two smoothing forms that look inert are not.** A square-root cusp floor
  shifts its input by a constant then multiplied by the handle length — 0.022
  units on a 55-unit handle. A p-norm smooth minimum returns 84 per cent of its
  argument when both arguments are equal. A polynomial form is _exactly_ the min
  or max outside its blend window.
- **The tangent-ray bound needed a floor for an ordinary reason.** The
  intersection slides backwards onto the start point whenever a start tangent
  points near the far endpoint, not only past a 180-degree turn as first assumed:
  the handle squeezed to 0.6 units, then sprang back 41.9. Floored at a third of
  the chord, the handle length of a neutral cubic.
- **An error function was compared against a linear tolerance while it returned a
  squared distance**, so the tolerance was distorted and scale-dependent — part
  of why the old behaviour differed by glyph size.

### Round 2: the correction pass had the wrong correspondence

It assumed the true offset's point at a given parameter belongs at the generated
curve's point at the same parameter. False for an offset, which is stretched on
the convex side and compressed on the concave one, so the correction either did
nothing or asked for **negative** handle lengths, which the bounds turned into a
collapse. Reparameterizing took mean error 3.11 to 0.89 against an achievable
0.67.

- **The clamp was not the disease.** The instrumentation counted any touch inside
  a blend window rather than hard pinning, while the pipeline still carried 4.6
  times the achievable error where nothing clamped at all.
- **Some geometry a single cubic cannot represent**: a bold stroke on a tight
  curve, 31 of 149 realistic cases, errors in the hundreds for every strategy
  including a numerical optimum, and point-count stability forbidding a split.
  The strongest argument for a designer-facing control.

### Round 3: one handle always sat on a bound

Two skeleton contours identical but for the tension of one segment's own handles,
both equal-tension within themselves. One generated a sound outline; the other's
inner edge cut straight across the bend on the 1-unit floor. The collapse was the
visible half — both had **one generated handle on a bound in every case**, from a
symmetric skeleton.

| side        | tensions before | ratio | after         | ratio |
| ----------- | --------------- | ----- | ------------- | ----- |
| low, outer  | 0.403 / 0.993   | 2.46  | 0.447 / 0.740 | 1.66  |
| low, inner  | 0.30 / 0.009    | 33.0  | 0.610 / 0.592 | 1.03  |
| high, outer | 0.60 / 0.97     | 1.62  | 0.626 / 0.889 | 1.42  |
| high, inner | 1.00 / 0.345    | 2.90  | 1.000 / 0.638 | 1.57  |

- **The asymmetry is born in the seed.** `1 + d × κ` is applied per end and the
  two ends of a cubic have different curvature, so the handles were scaled by
  1.07 and 2.61 here and the band confined each to a window around its own seed.
  Equalization could not rebalance them: its allowance was an absolute 0.25
  units, nothing on a tapered segment, and it judged every candidate split at the
  fitted magnitude.
- **Three wrong diagnoses came first, each disproved by a measurement.** That the
  offset was unrepresentable past the cusp, disproved by rendering the balanced
  pair. That the least squares was ill-conditioned, disproved by the normal
  matrix at condition number 1.3. That the fit had no information at the dead
  end, true of that end and irrelevant, because the fault was on the healthy
  contour too. The report that settled it was the designer's: both contours show
  it, so stop explaining the collapsed one.
- **The sweep is what found it.** Walking the segment's own tension, one handle
  stepped 1, 1, 1, 2, 5, 7, 11, 17, 34 while its partner went 104, 70, 163 — a
  33.9-unit jump per unit of skeleton handle, in the healthy range.

### Round 4: a saturated handle dragged its partner backwards

At the step where one handle reached the ceiling the other moved backwards, 90.6
to 59.4 in one step: the ceiling was applied _after_ the equalization walk, so
the walk balanced a pair that could never be emitted.

- **A bounded measurement changes the baseline, not just the answer.** Judging
  candidates by the emitted curve was correct and silently made the allowance
  more generous, since the allowance is a fraction of that measurement. Two
  golden fixtures caught it; without them the accuracy loss would have shipped as
  "rebalancing". The allowance came down from 25 to 15 per cent to pay it back.
- **The first version of the test swept one side and passed while two faults were
  live.** When a fault is a property of a sweep, sweep every side and both signs.

### Round 5: the feasible box

Reported on a `U`: sweeping in one direction the generated handles jumped and
rebounded by 20 units per step while the skeleton handle moved 1.7.

The wider complaint was structural. Every fix since the construction shipped had
added a guard — a correction band, a chord cap, a handle floor, a cusp floor, a
tension ceiling in an eased form and an exact form and an exemption for pins, a
scale band on the magnitude re-solve, and a null return meaning "this end has no
reach, skip the stage". Every one was a correct answer to a real measurement, and
together they were an incomplete list of exceptions, because none addressed why
an infeasible answer was produced at all. **One invariant replaced all of them**:
both handle lengths are carried as tensions and every stage produces a point
inside the feasible box, with `reach` defined once for every stage alike.

- **The jitter was the correction loop reparameterizing against a curve that
  loops.** Where a cubic cannot represent the offset the least squares asks for a
  start handle at 2.4 times its reach and a negative end handle; the band clamped
  one and left the other free, so the iterate self-intersected and Newton's root
  find on it is multivalued. One sample's parameter walked 0.907, 0.200, 0.319,
  0.635 across four passes.
- **A fixed trip count buys determinism, not continuity.** Fixed count, fixed
  seed, no convergence test and no threshold search were all satisfied here and
  the output still jumped, because the map being iterated was not continuous.
  Both are required and neither implies the other.
- **The eased ceiling was the root of the three-variant bound.** It existed so
  the fit's answer would be C1, but the contract asks only for continuity, and a
  clamp is continuous and 1-Lipschitz. Easing cost a few per cent of whatever it
  was given, wrong for a hand-placed length and wrong for a pin — hence the other
  two variants.

### Round 6: the walk was bisecting a plateau

The metric returned the **max** over five samples, and a max is exactly flat in
whichever handle does not own the current worst sample, so the walk converged on
the edge where the max changes owner: the end tension moved 0.097 to 0.353,
tripling one handle, without shifting the max in the fourth decimal. It returns
an RMS now — nonzero gradient everywhere, and the norm the fit itself minimizes.
**A bisection is only as continuous as the function under it.**

**The allowance floor is not a free parameter — it is stated in a norm.** An RMS
over five samples is between 0.447 and 1 times the max over the same five, so the
0.25-unit floor restates into 0.11 to 0.25. At 0.25 one accuracy ceiling failed
at 1.043 against 1; at 0.20 every ceiling holds and the jitter is the lowest
tried, with values below both looser on accuracy and worse on jitter — the sign
of a real optimum rather than a fudge.

Worst single-step movement of any generated point, 200 steps — original, after
the box, after the RMS:

| driver          | mode               | orig   | box   | now   |
| --------------- | ------------------ | ------ | ----- | ----- |
| segment tension | single-sided right | 36.67  | 2.15  | 2.15  |
| segment tension | single-sided left  | 196.00 | 4.12  | 3.13  |
| segment tension | double-sided       | 122.00 | 15.00 | 5.00  |
| rib width       | single-sided right | 53.01  | 16.03 | 8.00  |
| rib width       | double-sided       | 35.00  | 10.43 | 6.00  |
| rib width       | pinned curvature   | 69.01  | 20.02 | 11.05 |
| on-curve drag   | single-sided right | 14.35  | 2.00  | 2.00  |
| on-curve drag   | double-sided       | 11.25  | 12.69 | 5.67  |

**One self-inflicted detour.** A checkout run to strip debug instrumentation
silently discarded the uncommitted fix with it.

### Round 7: one continuous solve, and the accuracy that paid for it

The boxed construction was deterministic and still not continuous: its correction
loop rematched samples to the candidate cubic and its split walk selected the
last candidate inside an error allowance, and both could change branch while the
skeleton moved smoothly — a 3.139-unit step on one side, 4.775 with 2.077 of
backtracking on another. The solver now builds **one quadratic** from five fixed
source-parameter samples, minimized inside the positive non-crossing rectangle.
The correction loop, the split bisection, the candidate magnitude re-solve and
their tests were deleted.

- **Four global constants**, the same for every glyph, side and fixture: pull
  floor 0.001, cusp gain 0.005, taper gain 1, cusp gate 0.05 — the
  lexicographically first passing tuple. Taper gains of 0.05, 0.1, 0.2 and 0.5
  failed at every cusp gate with the backtrack shrinking monotonically (1.314,
  0.747, 0.198, 0.110), which identified the gain as the right knob. Final sweep:
  zero backtracking on every side, worst adjacent step 2.174 and 2.251
  single-sided, 2.478 and 2.704 double-sided.
- **The accuracy ledger, stated rather than hidden in regenerated fixtures.**
  Four cases improved, six lost, one unchanged; the summed change over eleven
  maximum deviations is +17.83 units, the strong left taper the worst single loss
  at +14.27. The seven inherited constant-width ceilings stay green. Taper has no
  ceiling, because skeleton-owned handle axes cannot reproduce the true
  tapered-offset tangents.
- **A cusp-only predictor could not satisfy both accuracy and continuity**, since
  the reported taper case stays healthy by the cusp factor; **and one shared
  cusp-and-taper strength also could not pass**, since enough shared authority to
  stabilize the tapered side made the inward near-cusp transition too steep.
- **The first fixture-review rule was too strict for split-outline round caps**,
  which compute trim points from the terminal side cubic. The correct
  preservation boundary is topology, provenance and cap inputs, not frozen
  derived coordinates.

### Round 8: stabilized reach was mistaken for the geometric ceiling

One number held two jobs (§0). A short positive reach was floored to a third of
the chord, so an answer at tension 1 could be almost twice the real reach —
individual tensions of 1.002 / 1.993 and 0.837 / 1.473. The domain keeps the
floored reach as the coordinate scale and takes the per-end maximum as the real
reach over the scale reach; regenerated, the only values still above 1 are 1.0024
and 1.0044, both from final integer-grid emission at the boundary.

### Round 9: a nudged handle was measured and bounded on a curve nobody was looking at

Reported on `_external/k.json`. Two faults with one origin: the generator applies
two emission displacements after the construction, one on the on-curve and one on
its handles.

- **The curvature gizmo jumped**, moving the two handles 29 and 30 units on a
  grab and release, because the reader could subtract the on-curve's
  displacement, which provenance published, and not the handle's, which nothing
  published. Zero-delta grab: 30.00 to 0.00 left of the point, 1.00 to 0.00
  right.
- **The handle on the other side would not move**, 0 honored of 5 asked at every
  value from 5 to 60. The ceiling is the forward intersection of the constructed
  curve, 0.76 units from the rib end, but the curve being dragged had its
  on-curve nudged 51 units back along the same tangent. The slide comes off the
  ceiling now.
- **The two faults measured as one and were not.** Zeroing the handle nudge made
  the first disappear exactly and left the second untouched, twice over — which
  separated a reader fault from a bounds fault before either was touched.
- **Rescaling the pin by the ceiling was built and reverted inside the hour.**
  The obvious way to keep one number, and it made the jump worse: the zero-delta
  grab went from 0.00 back to 16 units.
- **The backwards direction is still conservative**, recovering room only where
  the real intersection sits below the scale. Left alone, because the handle
  moves, which was the complaint.

### The grid invented a ceiling, and one handle sat on it

Reported on the `j` of skeletron.fontra: move the first handle of the stem and one
generated edge draws as a straight until the other handle moves. The stem is a
cubic with its handles on the exact thirds, so nudging one opens the tangent rays
by a couple of degrees and puts their crossing a few units _behind_ the start
point — the domain's parallel case, and the right answer. But the endpoints are
rounded before the domain is built, and at two degrees the crossing slides about
twenty-six units per unit of sideways endpoint movement, so half a unit of
rounding at each end carries it _ahead_ instead. The start handle was held at 8
units where the drawing asks for 128.

**The fix is to refuse a crossing the grid could have invented.** The
amplification is one over the sine of the angle between the rays, so the
uncertainty is a unit and a half times that, less the unit and a half already in
the endpoints. Where the rays are square nothing is amplified and a short honest
crossing keeps its ceiling. The defect predates the corner work.

### The limit that remains, and the fixture gap

One segment reports no tension at all at the far end of its range, its drawn
handles passing the crossing, and the reader declines to invent a number. It
offsets 54 units on a bend tight enough that one cubic cannot hold it — the limit
round 2 measured at 31 of 149 cases, and why the curvature gizmo exists. The
residual 16- and 10-unit steps under a width drag land where `1 + d × κ` crosses
zero, where the offset genuinely cusps. Not jitter.

The corpus carries no handle nudge at all, so it cannot see round 9. No golden
fixture moved for it — a gap rather than a result.

---

## Rib and skeleton editing (map F7, skeleton)

**State: settled.** Nine rounds around the centerline itself.

### The rule the width distribution is stated in

Three writers held two rules. A rib drag applied the same delta to both ribs, so
a point at 60/0 answered a drag of 10 with 70/10 — a distribution of 75 where the
designer had set 100. The panel honoured the distribution instead.

- **Preserving the difference between the two sides is not preserving the
  distribution. Preserving the SHARE is.** One function carries the rule and all
  three entry points go through it. The same-delta rule survives for exactly one
  caller, the fixed-rib drag, where one edge is held while the point follows the
  cursor.
- A side holding zero has no share, so it cannot state a total; that rib is
  pinned on the centerline and the drag refuses. The designer's decision.
- **A comment claimed the rule the code did not implement.** And **the first fix
  touched the canvas path alone**, on the reasoning that changing the panel's
  per-side meaning was more than the report asked. The report asked for the two
  to agree, and one rule in one place is the only way they cannot drift apart.

### Ribs tied across a straight

The ribs at the two ends of a straight-controlled straight sat at independent
offsets, tilting the generated rib-to-rib line away from the skeleton straight,
and the generated handle was then re-collinearized against the tilted line — so
changing a rib width rotated handles 8.5 degrees over a half-width sweep with
both ends controlled, about 16 with one. Separately the smoothing pass estimated
its axis from handle **lengths**, and rib width sets handle length, so width
rotated the axis there too: 1.1 degrees mean and 12.5 worst per unit of width.

- **Deriving a direction from rounded coordinates inherits a width dependence.**
  A handle carries its axis only to within `atan(0.7 / length)`: 1.3 degrees at
  32 units, 4 at 10, 45 at 1. The general trap behind both faults.
- **The first coupling rule was too narrow.** Tying only _pairs_ of controlled
  points missed the common case: one tension point anywhere on a straight ties
  both of its ends, and the far end need not be controlled itself.
- **Skipping the coupled accessor in the gizmo produced the original report** —
  the dragged gizmo travelled twice as far as the outline and its partner did not
  move at all. **Coupling that only the generator knows about is worse than no
  coupling.**
- **One residual tilt was measured and deliberately left**, `2·hw·sin²(turn/4)`
  at a corner far end: 0.4 units at the widest end of the sweep, under the 0.3
  degrees the grid itself imposes on a handle that long.

### The fixed-rib drag

- **Single-sided drags rewrote the width distribution**, writing one side and
  leaving the other — a shape the designer cannot see while they work. They write
  the **total** now.
- **The single-sided floor was on the wrong quantity**, flooring one side at a
  half-width of one and stopping the visible edge 41 units short of the
  centerline on a 40-unit far side. It is on the width the designer can see now.
- **The drag did not stop.** Widths clamped and everything else carried on, so
  past the floor the anchor edge the drag exists to pin walked away with it. One
  allowance per point now, and everything travelling with the drag is held to it.
- **A straight-skeleton test cannot see a handle bug.** The first tests used a
  two-point line fixture, so the handle-scaling path never ran and the fix tested
  green while still wrong in the editor. The property that catches it is
  idempotence past the floor, now asserted on the arc fixture.
- **The test asserted the wrong direction twice.** Plain fixed-rib anchors the
  far side, which grows; only compress anchors the side the drag moves toward,
  and nothing hits a floor without compress.
- **The distribution can only be preserved to within grid rounding.** 60/20 at a
  total of 90 wants 67.5/22.5 and lands on 68/22. Rounding both sides
  independently also missed the total by a unit and put the visible edge past the
  cursor; one side is rounded and the other taken as the remainder.

### The rib angle lock was never ported

The port carried the geometry and nothing else — no canonical field, no copy
across the generator dialect, no panel control — and both copies read donor field
names the schema drops on normalization, so the override could not fire at all.
**Two dead code paths looked like a working feature.** The check that matters is
whether the field survives normalization and the dialect copy, not whether a
consumer exists.

- **A locked corner does not cancel the corner, it re-places it.** The first
  build threw the join away when the lock fired, which holds only while both arms
  read the same side of the forced rib. Past a quarter turn they read opposite
  signs and their edge ends stand a full stroke width apart; cancelling emitted
  one point instead of two, the outline pinched to a cusp, and on the `b` that
  drew a pair of 250 unit spikes. The lock makes the side per-arm now.
- **The lock was making the stroke thinner instead of cutting it at an angle.**
  On the `N` every rib reads 60 and the diagonal drew 51, because walking a plain
  half-width along a forced rib puts the point inside the edge the width sets, by
  the cosine of the turn — 15 per cent at 58 degrees. **The stroke's width is
  measured across the centerline, and a lock does not change it**; what it
  changes is the angle the stroke is cut at. The diagonals now measure 60.2 and
  59.6. The rib bar reaches with it, because it is the cut and not a measure of
  the cut, and `skeletonRibReach` is the single copy the generator imports.
- **The forced rib cannot do two things at once.** Reaching for the edge draws
  the stated width at every master and does not survive interpolation: one over a
  cosine curves upward, so blending two outlines lands above the reach the
  blended angle needs. On the `N` with its rib turned 72, 51 and 32 degrees
  across three weights, each master drawing 60, the blend ran 60, 79, 90, 96,
  **97**, 96, 91, 85, 78, 69, 60. So `ribAngleLockMode` says which the point
  holds on to, `stroke` or `rib`, both tested in the generator and on the rib bar
  so neither can be dropped by accident.
- **Two fixtures moved and one was measuring the grid.** The serif wall fixture
  compared every wall against the first one; on a tilted stem no two walls round
  to the same distance.
- **The sign flip is a discontinuity and it is not new.** The forced normal jumps
  to its opposite as an arm's own normal crosses square to the forced axis, so
  the edge end jumps a full stroke width. It was invisible while the lock was
  offered only at a terminal, where there is one arm and no second sign.

### Structural editing

- **Segment selection.** Shift-clicking an adjacent segment _removed_ the shared
  point, so a selection could never be built by walking a contour. The fault was
  the selection **mode**, not the hit test: shift maps to symmetric difference,
  right for a single point and wrong for a multi-point hit. It toggles the
  segment as a unit now — plain union would have fixed the report and removed any
  way to shift-click a segment off.
- **Splitting a contour.** **Two of the three warnings the item carried did not
  apply** — the mapping update the one write path already does, and a cap on each
  new end, which falls through a cascade. Both were true of the donor. **An
  item's own warnings are as old as the item.** **The smooth flag had to be
  cleared on the two new ends**, or a split would have quietly reweighted the
  stroke beside it, and **resolving all the ids before the first cut is what
  makes multiple splits work.**
- **Three gaps between the skeleton and the ordinary path**, and **two of the
  three were not what they said they were**: the reverse item asked for a menu
  entry and the work was deciding what reverse means for a stroke, and the
  control-click item read as a forkra defect and was upstream behaviour colliding
  with a modifier this fork had taken. **Neither could be planned from its own
  sentence.** The reversed flag was a third dead level, with a reader and no
  writer.
- **The point-key parser refuses a rib key**, requiring exactly two fields where
  a rib carries three. It returns null rather than throwing, so a menu item would
  have been quietly enabled and done nothing.
- **A single-sided skeleton pen.** **The request was to copy the file and adjust
  it**, and the pattern it pointed at is not a copy: the quadratic pen is a
  twelve-line subclass. One file, and the two pens cannot fall out of step — rail
  R-B paying for itself rather than being argued for.

### Three small items

- **A hand may collapse a generated handle to zero.** The one-unit floor is the
  automatic answer's problem, not the designer's. The curvature gizmo follows it
  down, writing the pin to the floor and carrying the rest as a displacement on
  the one handle still off its point. **A pin of zero also renders now**; it used
  to read as no pin, which threw the last step of the descent away on reload.
- **A handle offset stopped climbing past the ceiling.** The store kept the whole
  request, so a drag pushing against the ceiling left a value far beyond it and
  the next drag back moved nothing until it had walked down. The generator
  publishes the part it honored.
- **The hosted glyph panels draw on first load.** Their update ran before the
  glyph info form that hosts them existed. They refresh on the rebuild that
  re-attaches their host and only on that one, because the form is rebuilt on
  every selection change and redrawing there would replace a control still under
  the cursor.

**Manual matrix owed** (rail R-G): type into left and right with the sides linked
and unlinked, scrub both labels, drag both ribs at a distribution of 100, and
drag the total in the panel while watching the other three fields.

**Manual matrix owed for A** (rail R-G): drag a rib with A on a linked point, on
an unlinked one, on a side holding zero and on a width-locked side; press and
release A with the button down; drag a multi-rib selection; and hold A with D.

---

## The generated-segment gizmos and the curvature pin (map F7, skeleton)

**State: settled, one defect open.** Six rounds. The designer's control over the
output the offset construction cannot get right on its own.

### What the pin stores, and why it is a number

The first version stored a positional handle displacement, so a later change to
the skeleton, the width or the taper drifted the curvature: the designer set a
number and the model stored a nudge. The gizmo stores **the segment tension it
arrived at**, and what makes that clean is an identity — **a segment's tension is
exactly the harmonic mean of its two handles' tensions** — so magnitude and split
are orthogonal and the pin and a hand-placed handle compose without a precedence
rule.

- **A new per-point field is invisible to the generator until it is copied across
  explicitly.** This failed _silently_: the pin stored, read back correctly, and
  did nothing, because the generator saw undefined on every segment.
- **Reproducing a pinned mean by scaling both tensions cannot work.** A preserved
  ratio caps the reachable mean at `2r/(1+r)` — 0.6 on a 0.3/0.7 split — so the
  control stopped at a value that was neither 1 nor stable. It is also not what
  the drag does, which adds one shared increment to both ends.
- **Saturating both handles at the leading one's ceiling hides part of the
  range.** The trailing handle must stay responsive until it reaches 1 too.
- **A zero-delta grab must be exactly a no-op, and it was not.** The underlying
  math equalizes two coupled tensions regardless of the delta, so differencing
  against the incoming geometry fired that equalization the moment the gizmo was
  grabbed — 152 units before the pointer moved. This symptom returns twice below,
  from two different causes.

### One construction space, because two mechanisms were cancelling

Grabbing the curvature gizmo moved the curve, its reachable range looked
arbitrary, and dragging a generated on-curve moved the neighbouring off-curves —
all one fault. Three things wrote a generated handle's length, and the nudge
translated each handle along with its rib end, so the on-curve drag had to store
an equal and opposite adjustment to hold the handle still; the moment the
on-curve gizmo was touched, that adjustment existed and overwrote the pin. It
behaved only while no on-curve had ever been touched, which was exactly the
report. The nudge became a pure emission post-step: net rendered geometry is
identical, with one mechanism instead of two that cancel.

- **This reversed a decision made one day earlier, and both were right in turn.**
  Measuring the pin in rendered space was necessary while the nudge carried
  handles. **Fix the mechanics, then choose the space, not the other way round.**
- **A nudge could push a rendered tension past the ceiling on an untouched
  segment** — 1.18 at nudge 20, 1.48 at nudge 40 — because the length was
  preserved while the reach shrank.
- **Mirroring was verified by construction, not by eye.** Generate-then-mirror
  and mirror-then-generate must produce the same point set; swapping the per-side
  fields by hand on the mirrored data made them agree exactly.
- **Hiding the on-curve points along with the handle lines would have been
  wrong.** On-curve points say where the outline is; off-curve points with no
  lines are floating circles.

### Three readers disagreed about what a tension is

A grab and release with no movement jumped the curve by up to 128 units — worst
on the first grab, and quiet afterwards only because the error drove the tension
to its ceiling and stuck there. The gizmo measured length over distance to the
tangent intersection while the generator normalized against a reach clamped to a
third of the chord: two different units. A smooth joint then rotates the drawn
handle after the solve, 38 degrees in the case measured, so even in matching
units the direction measured against was never the one the length was built on.
Every handle's constructed axis is published with its provenance now — rail R-D
applied to a reader that had been recovering direction from geometry all along.

Grab-and-release movement: plain cap 128.3 to 1.0, serif cap 34.8 to 0.8. Swept
over cap styles, widths, joints, sides and drag orders, 156 of 162 cases fall
under one unit.

- **The saturation hid the size of it.** "First adjustment jumps, then it is
  smooth" reads like a state initialized once; it was the error running the
  tension to its ceiling in two or three grabs. Iterating the round trip rather
  than measuring it once is what showed that.
- **The published axis belongs to the emitted handle, not to whatever is being
  measured.** Where the reader substitutes the untrimmed snapshot the axes are
  the wrong pair, and getting this backwards passes most tests.
- **A residual two-unit oscillation remains**, six of 162 cases alternating
  between two states 1.9 units apart, all round caps on one narrow geometry. It
  alternates rather than drifting, so it is grid quantization on the trim. Left
  alone.

### The right curve, measured the wrong way

Reported on `b.json`: the two gizmos on the inner side of the stroke read 0.18
and 0.35, and grabbing either one without moving the pointer threw the shape.
A zero-delta grab wrote exactly the number shown and redrew at 0.055 and 0.135,
moving handles 213 and 232 units.

**The inner side of a corner is the side the join cuts back**, so both of its
curves publish an untrimmed snapshot and the reader correctly measures that
instead of the leftover piece. It then threw the axes away and fell through to
the plain tangent-intersection formula, while the generator went on reproducing
the pin through the handle domain. Where the domain has no usable forward
crossing it scales by twice the chord instead, so the two are not the same
quantity: stored against displayed ran 0.05 to 0.014, 0.5 to 0.152, 1.0 to
0.305 — a flat factor of 3.28, which also put the whole top two thirds of the
control out of reach. The uncut side of the same stroke round-tripped to within
0.0007 throughout, and is what identified the reader rather than the generator.

- **Substituting the right curve and measuring it a different way is the same
  defect as measuring the wrong curve.** The serif round fixed which points;
  this one fixes which unit. Both readings build the domain now.
- **A cut segment's axes are the snapshot's own end tangents.** The snapshot is
  taken before emission, so nothing has rotated them. The published axis belongs
  to the emitted handle and is right only for a segment that reached the outline
  whole — which is why the fallback looked defensible.
- **The displayed numbers moved, and that is the fix rather than a cost.** Those
  two gizmos read 0.585 and 0.907 now. The old figures were the same handles in
  a unit nothing else used.
- **A grab that moves nothing is the test**, not a per-value assertion: the
  round trip is checked against the uncut side of the same stroke, which is the
  oracle. Zero-delta grab, both segments: 213 and 232 units before, 0.00 after.
- **Left alone**: the round trip still drifts at the bottom of the range, 0.05
  reading back as 0.24, because the cut moves when the handles shorten and the
  curve measured is not quite the curve the pin was reproduced on. The designer
  ruled that drift acceptable and jumps not.

### A pin must survive the hand that overrules it

Set a curvature, switch to direct handle editing, drag a handle: the handles
jumped back to the automatic fit. Fixed once, and the first drag still dragged
heavy and then broke loose — two causes, one behind the other.

A direct handle drag discards the pin on its own segment, which is right, but the
discard was destructive because the pin contributes length to both handles. The
pin is **baked** before it is dropped, and **both handles, not just the dragged
one**, since only one is ever under the cursor. Underneath that, a pinned segment
bypasses the ordinary ceiling; clearing the pin put that ceiling back, and it
eased into its limit over a blend window, re-shaving exactly what the bake had
restored.

- **The eased ceiling is right for the fit and wrong for a hand.** It measured
  5.0 units short at tension 1, so a hand-dragged handle could never quite reach
  the tangent intersection.
- **"From the correct position, but a jump."** The report distinguished a wrong
  starting position from a wrong first movement, which separated the two causes.
  The first fix was verified by a zero-delta drag, which proves the start
  position and says nothing about travel, so it passed while the second fault was
  live.
- **Measured, not reasoned.** The residual was 0.00 units below a pin of 0.8 and
  grew to 5.0 at 1.0, which is why it presented as intermittent.

### Two bugs the detached flag exposed

- **A handle had a limit it should not have.** With the flag off a placement was
  refused, 32 units asked and 7.77 honored against 55 units of real room, because
  the ceiling was stored as a multiple of the coordinate scale and capped at 1.
  **The conservative note in the previous round was the bug** — recorded as a
  limitation and dismissed, because the handle moved, which was that report's
  complaint. It took a second report to be read as a wrong unit.
- **The detach toggle changed the shape by itself**, moving a handle 4 units on
  and back off, because detaching read the handle's position off the screen after
  the pin had been applied and the generator then applied the pin again. The
  conversion measures against a regeneration with this side's segment pins
  cleared; re-attaching measures the other way round, because there both sides of
  the subtraction carry the pin. One solver test was corrected in that round: it
  asserted the old cap, which is the bug written as an expectation.

### Placement and readout

- The curvature label sits straight above the node; an offset following the
  gizmo's own axis swings the number around as the segment turns.
- The on-curve gizmo's distance is one constant in glyph units. **Scaling it by
  the local stroke half-width is the better-argued design and was rejected on
  sight of it** — the gap then moves with every width edit. Recorded as a
  decision rather than a mistake, because the argument will be just as convincing
  next time.
- **The suppression predicate for the rib width plaque had to be narrowed after
  it was written**: "not one of the two width behaviors" and "is one of the two
  tangent behaviors" look equivalent and are not, because a rib drag can carry a
  fixed-rib behavior, which does change widths. **Publishing the behavior name
  where it is set** is what makes a key pressed mid-drag take effect on the next
  frame.

**One defect open.** The detach conversion anchors the offset on the emitted
on-curve, which carries the on-curve nudge, while the generator anchors a
detached placement on the un-nudged rib point and adds the handle nudge. They
agree only where the two nudges are equal; on the file it was found on both are
45, so it is invisible there. Provenance already publishes both vectors.

---

## Corner rounding, caps and the bulb (map F7, skeleton)

**State: built, two defects open.**

### Corner rounding is distance and curvature

Four sliders became two numbers per side. Three of the four — roundness, reach
and strength — multiplied into one trim distance, so no one of them said what the
corner would measure; the fourth, asymmetry, scaled roundness down on one side,
one number for a thing that is two. The arc's fullness had no control at all.

- **Distance is absolute units rather than a fraction of the arm**, because a
  fraction rescales itself when a neighbour moves, so the drawn corner would
  change when nothing about the corner changed. Three clamps hold it, and they
  are the geometry rather than a fixed fraction standing in for it.
- The old fields are gone with no migration, which the designer chose. A corner
  drawn before this comes back sharp.
- **The half-width gate reads two ways, and the code already chose.**
  Single-sided mode is the deliberate exception, and the first test asserted the
  general rule and failed against it. **The test was wrong, not the code.**
- **The arc's fallback fired at exactly the setting that wants nothing.** Under a
  curvature control a zero-length handle is the chamfer the designer asked for,
  not a near-zero length to repair with a circular-arc estimate.
- **Open: the point count still varies with the parameter**, because distance
  zero emits no arc, so a corner rounded in one master and sharp in another does
  not interpolate. Predates this work; the serif's collapse rule was deliberately
  not extended to corners without being asked.
- **Left alone**: the cap-corner field-name list in the fixture script has the
  serif fixture objects merged into it, so those fixtures are never generated. A
  dev script, and it predates this work.

### Rounding a curved corner reshaped the curve it was rounding

Reported on `I^1`: the corner where the stem meets the shoulder bulged outward
the moment it was rounded. The rounding gave up 36 units and the surviving arm
left its own path by **19.0 units on the right side and 17.8 on the left**, worst
around the middle of the curve where nothing had been asked to move.

**A curved arm was given up by translating**, not by cutting. The end on-curve
stepped 36 units along the chord toward its handle and that handle was carried by
the same vector, while the far end and the far handle stayed. That is a rigid
move of one end of a cubic, and a cubic with one end moved is a different curve:
the far handle kept its full 203 units while the span it had to cover fell from
411 to 397, so the curve bowed out to take up the difference.

- **The cut is the operation, and the code already had it twice.** The corner
  join cuts, and the serif's easing cuts so that "the surviving bracket is the
  same curve, not a redrawn one". Only the rounding did not.
- **The translation put the end off the curve as well as changing it.** Stepping
  36 along the chord landed 1.80 units away from the curve, because a straight
  step is not a step along a bend. Measured on the same arm, a proper cut departs
  by 0.087 — grid rounding and nothing else.
- **The arc's tangent has to come from the cut, not from the corner.** The old
  chord direction is the tangent at the corner, which is not the tangent at the
  new end, so the joint the rounding exists to smooth arrived with a kink of its
  own. This was invisible while the arm's shape was already wrong.
- **The distance is a length along the curve**, found by bisecting on arc length.
  Arc length rises strictly with the parameter, so the answer is continuous in the
  input and a fixed trip count is enough — the case the sweep rule warns about is
  a bisection on something that is not monotone.
- Measured after, same glyph and same 36 units: 0.158 and 0.112. Point count is
  unchanged across distances 1 to 140.
- **No golden fixture moved, and that is the gap and not the result.** The corpus
  still carries no rounded corner at all, which is why a translation survived in
  the tree. The new test is a departure measurement on the reported geometry.

**The first fix shipped with two faults that cancelled on the test and not on the
glyph**, and it came back the same day as "the rounding is inside out".

- **The cut wrote its result back into the corner point, which BOTH arms share.**
  One object, two arms: cutting the first moved the second's curve out from under
  it before that arm had been cut, and the straight arm's step was then taken
  from a corner that had already moved — 25 units off its own line. Only the two
  handles are written now. The far on-curve does not move under a cut and the
  near one is the corner, which the arc replaces.
- **The old translation was still running after the cut.** Carrying the
  neighbouring handle with the moved on-curve belongs to the straight step alone;
  on a cut arm it added the whole trim a second time, putting the handle a
  trim's length past where the curve goes. That is what drew the arc bowing away
  from the corner instead of into it.
- **Neither fault was visible on the fixture, because they cancelled there.** The
  corner write moved the corner to where the translation measured its delta from,
  so the delta came out near zero and the departure read 0.158. Removing one
  alone took it to 12.4. **A test that passes while two faults are live is
  measuring their sum**, and the departure measure alone could not see the
  direction.
- Two guards were added for what the departure measure cannot see: the arc's ends
  must lie on the arms they join, and the arc must bow toward the corner it
  replaces, both across a range of distances. Both fail on the first fix and pass
  now. Departure on the reported glyph: 0.112 and 0.158.

### The corner sat one half-width out whatever the width and whatever the turn

The routine that placed a corner's outline point took the stroke width as an
argument and never used it, so a corner's shape did not depend on the width at
all and a diagonal arm meeting a vertical stem ran out into two thin spikes.
**The two edges of one side meet at one half-width over the cosine of half the
turn** — 1.41 half-widths at a right angle, 2 at a 120 degree turn.

- **The two sides of a corner are different problems, and they are solved
  differently.** The side with the gap carries each edge on as a straight and
  takes the place they meet, discarding the straights. The side with the overlap
  has nothing that stops, so the crossing there is drawn geometry and is found,
  not stood in for by a crossing of the two end directions — both curves bend
  toward each other over the reach, so on a strongly curved arm a direction
  crossing sticks through the stroke.
- **Where the inner curves do not cross exactly once, the code does not choose.**
  Choosing among several crossings can change its answer between two frames of a
  drag. The rule the offset construction arrived at over five rounds.
- **The miter limit is four half-widths, measured per side.** At 178 degrees on a
  60 unit stroke the meeting place stands about 1719 units out. It was first
  written as two full stroke widths, the same number wherever the sides are equal
  and different wherever they are not: on an unlinked 10/50 stroke the narrow
  side was allowed twelve of its own half-widths while the wide side was cut at
  two and a half, so one side spiked and the other bevelled at the same turn.
- **A smooth point is not a corner.** Applying the corner treatment there broke
  two serif tests at once: a nominally smooth point with a 60 degree kink got the
  whole construction, and its inner side then rebuilt both handles from the cut.
- **A closed contour's last straight segment was dropping its corner join.** The
  branch treated the last index as the end of the contour, true only for an open
  one. It never showed before, because a closed contour's segments emit only
  their start points, so the dropped join had nothing to place.
- **The rib bar is square to the arriving arm now**, keeping its length at the
  stored half-width, so it stops short of the outline at every corner. It states
  how wide the stroke is; it no longer states where the edges are.
  `cornerArrivingNormal` returns null everywhere but a corner, so the shared
  normal in `offset-contour.js` is untouched.
- **The outline point count changes in three cases**: a side past the miter
  limit, a fold-back, and an inner side whose curves cross zero times or several.
  Two masters whose corners fall in different rows do not interpolate at that
  corner. The designer accepted this: contours rarely change this much between
  masters, and this is not animation software.

The fit costs nothing measurable. Worst departure in font units, with the
departure before the reach in brackets — the whole departure is the reach itself,
the half-width times the tangent of half the turn:

| turn | half-width 10 | half-width 30 | half-width 60 |
| ---- | ------------- | ------------- | ------------- |
| 30   | 3.0 (0.3)     | 8.0 (0.7)     | 16.0 (1.8)    |
| 60   | 6.0 (0.4)     | 17.0 (1.2)    | 35.0 (2.6)    |
| 90   | 10.0 (0.6)    | 30.0 (1.9)    | 60.0 (3.5)    |
| 120  | 17.0 (1.0)    | 52.0 (3.3)    | 104.0 (5.3)   |
| 150  | 37.0 (2.5)    | 112.0 (7.1)   | 224.0 (12.5)  |

Four sweeps rather than assertions: the turn from 20 to 140 degrees in half
degree steps, the width from 10 to 100, the proportion between the two, and an
arm bowed until the inner crossing goes away.

### The bulb

**The ball is solved for, not tested for.** The trim was guessed, tested against a
hard fit predicate and grown until it passed, and four faults followed: the
accepted trim was the first that passed, leaving the ball 21 units deep against
55 across on a ball asked for at 75; past the predicate the search returned its
first guess, reusing a trim distance as a ball radius, with which of the two a
glyph got turning on a margin of two hundredths of a unit; where no cut delivered
the depth the search took whatever sat at the end of the run, so at ball ratio 2
and above the bulb vanished; and a ball whose sideways swell alone passes the
terminal plane satisfied the pin at no cut, so the terminal fell through to a
plain cap.

The trim is bisected for. Sweeping the far skeleton point 40 units, worst
single-step outline movement 93.94 before and 3.00 after; sweeping ball ratio 0.5
to 3, six steps drew a plain cap before and none now. **A predicate answers
whether, and the question was how much** — the fit predicate was correct and
useless, able to confirm a trim and not to rank two.

**The neck's easing was named tension, which it is not**, and it was indirect:
the value grew a second, inflated ball and took whatever crossing that made, so
no reading of the number told you where the neck would land. It is a 0 to 1
fraction of the run from the plain ball crossing back to the next on-curve now,
with one run serving both the geometry and the panel's top of range.

- The curvature gizmo was absent from the whole terminal region, because the
  segment walk takes a segment only when all four points carry addresses and the
  trim rebuilt the inner edge's handles without re-attaching theirs.
- **Naming the point is not the same as owning it.** The neck names the
  cap-owning skeleton point so the gizmo can find it, and that alone made every
  neck point resolve as an editable generated handle — a drag would have moved
  the rib the neck hangs off. Three readers had to be told the difference.
  **Provenance that names a point is an address, not a claim of ownership.**
- **A straight stroke cannot test this.** The inner edge's terminal segment is a
  line there and a line has no curvature gizmo.
- **Open: where the ball grows large enough to swallow the whole inner edge**,
  the crossing that anchors the neck flips between the terminal and the contour's
  far end. That drives the remaining jumps under a ball ratio or shape sweep.

### Fixture gap

No golden fixture moved for the corner rounding rework, the corpus carries no
rounded corner at all, and no external glyph uses a bulb. Two fixtures moved for
the corner join: `closed-triangle` moved every outer point outward from one
half-width to two, and its inner contour, drawn wider than the triangle's own
inradius, is inverted and self-crossing with two corners falling back to two
points each; `one-ended-controlled-straight` moved its corner by one to two
units. The canonical inputs also gained a `corner` field — the recorded fixtures
were stale.

---

## Base-curve expansion (map F9)

**State: shipped.** The geometry already existed inside the skeleton's fixed-rib
drag, and copying it would have put two copies in the tree against rail R-B. It
moved to a core module that reads no width, id or cap. Behaviour-preserving: core
suite 1,894 before and 1,913 after, 19 new tests, no existing test edited, and
the fixed-rib block passed untouched throughout.

- **An undo did not fully restore** (§0, rollback). A three-frame drag rolled
  back to frame two; the skeleton's own entry never had this.
- **A corner point took the miter whatever was selected, and that was two
  separate faults.** Dragging one edge of a rectangle down 20 sent both corner
  points diagonally outward, the edge sinking 14 and widening by 28. The first
  attempt fixed only the distance, making the corner travel far enough for both
  segments to land at the offset — right when both are being offset and wrong
  when one is not. The designer rejected it and named the derivation: **each
  segment moves along its own normal by its own offset, and the corner point
  lands where its two moved segments cross.** Measured against that, the code
  agrees to grid rounding at turns of 90, 63 and 11 degrees. **Stating a
  construction as a rule instead of as its derivation cost a round trip** — "the
  corner point travels the miter length" names a quantity and explains nothing.
- **The projection axis had the same fault**, projecting onto the clicked point's
  own normal, which at a corner read 14 of a 20-unit drag.
- **The crossing needs a bound, and it is the only limit in this drag**, four
  times the offset, biting at about 151 degrees. The spec says there are no
  limits and means drag distance against curvature radius; this is a different
  thing and an addition to what the spec asked for.
- **The plan's own test asserted the wrong answer once**: its chaining fixture
  put a curve where the comment said a straight, demanding three coupled points
  where the answer is one. A curve is never coupled. **The plan's baseline had
  also drifted by 329 tests** — the ordinary cost of a plan written four weeks
  before it was run.

**Still owed:** four rows of the manual matrix — the mixed selection, the
generated contour, the drag started on a handle, and the key pressed and released
mid-drag.

---

## Panel mechanics (map F7, skeleton)

**State: settled.** The scrubbable label replaced eleven relative scale sliders in
the serif section alone, each eating a third of a row, and the control was
indirect: the thumb reported a percentage, so setting a length meant knowing what
it currently was and working out the ratio.

- **Linear, deliberately** — an accelerating scrub returns a different number for
  the same hand movement depending on how fast the hand moved. **Whole numbers
  throughout**, because everything a scrub reaches is in font units and the
  generator quantizes anyway.
- **Three pieces, deliberately separate**: the arithmetic in a core module with
  no DOM, which is the only way any of it gets tested (rail R-G); the pointer
  events on the **label** rather than the input, because a drag starting inside
  an input fights both; and the panel routing it before the other streaming
  branches.
- **What travels down the stream is the change from where the drag started, not a
  value.** Adding it per point keeps a mixed selection mixed: a 40 and a 60
  dragged up by 10 become 50 and 70.
- **Clamping and rounding cannot be the same call.** They were, and the first
  pass shipped fractions into the boxes. Turning rounding on in that one function
  would have broken the fine modifier instead: the caller folds the clamped value
  back into its accumulated travel, and folding a _rounded_ value back cancels
  each fine move before the next can build on it.
- **Two clamps disagreed with the panel.** The nudge floored every serif length
  at zero, but wing slope is signed and the whole lower half of its range is a
  real family of shapes; and the number fields declared no minimum, so a drag
  past the bottom kept counting down in the box while the shape had stopped.
- **Shift is the fine adjust, not the coarse one.** Figma has it the other way
  and the first pass followed Figma. The arrow keys in these same fields still
  take shift as coarse, from upstream — inconsistent, and unchanged because it is
  shared with every other Fontra panel.

---

## Modifiers and the early live-use rounds (map F7, skeleton)

**State: settled.** Kept because two of these were arrived at twice.

- **Two modifier rearrangements were built and both reverted the same day.**
  Swapping the rib pair ignores why Z exists: a tangential rib move is the
  _rarer_ intent. Dropping Z as the gate on generated geometry removes the safety
  on derived geometry.
- **A real defect was hiding under the second attempt.** Z carried the adjacent
  handles through the generated on-curve and not through the rib grip — two entry
  points to the same nudge, at the same place on screen, and only one passed the
  carry flag. It is derived from the behavior name where both callers pass
  through now.
- **Every basic point rendered black as if selected.** A null index list read as
  "every point" by the node iterator, and an empty selection parses to no list.
  **The previous round's fix was to hide all generated points**, which removes
  the symptom and the feature together.
- Equalize fired on button-down, so a modified drag was unreachable, and on both
  gizmos rather than only the one that owns the split.

---

## Tension-aware drag and scale (map F10)

**State: built, in live use, unfinished.** Hold X and every curved segment the
edit reaches keeps its drawn shape. Drag, scale and arrow keys all work. Nothing
has been through a manual matrix, so the spec and the plan stay in place for the
next round.

**The invariant was settled by measurement, not preference.** On the n's inner
arch narrowed to 0.846, no slide gives an apex radius of 52.7 and equal travel
gives 60.5, against an original 73.6. The similar corner gives 62.3, which is the
original radius at the new size.

- **The slide belongs to the scale, and not to the drag.** Every curve in the n
  has exactly one end that can travel — the stem-side points sit on a straight,
  the apexes have curves on both sides and no rail — so under a drag the rule
  fired on one end of a curve and never the other, and the same gesture read as
  corrected from one grip and ignored from the opposite one. Pulling the
  springing point owed the same travel at the apex and could not pay it: the arch
  went 40 units taller with one leg scaled by 1.29. A scale states a size and
  nothing else, so the slide is the only thing that can restore a corner; a drag
  states a position, and the point under the cursor is usually the one the slide
  would have moved.
- **The drag keeps the rest, and it is worth keeping.** On the n's outer arch
  with the springing point pulled 40 down its own stem, without the tension rule
  tension falls 0.496 to 0.385 and the apex radius collapses 158 to 101; pushed
  80 the other way the handle passes the tangent crossing at 1.169 and the
  segment doubles back. **Tension is the coordinate in which the springing point
  can travel its whole range and still describe a curve.**
- **The extension that would restore shape, unbuilt:** let a stuck point slide
  along its own tangent, a straight being the case where a segment lies on that
  tangent. The apex's tangent is shared with the next curve, so moving it asks
  that curve's far end to slide in turn. On the n the cascade terminates one step
  later; whether it always terminates is unproven, and a closed contour of
  nothing but curves has no stuck-free end anywhere.

### A frame states the whole answer, or it states a lie

The entry wrote only the points whose correction differed from what the match
tree put there, and that set changed from frame to frame. Every frame is measured
from the pre-drag path, so a point dropped from the set kept whatever an
abandoned frame left on it, and the last frame's rollback never named it — the
undo restored part of the drag and left the rest, and it also reads as a lag. A
point written once is written on every frame after it. **This is a general trap
for any target entry whose write set depends on its input**; the base-expand
entry writes the same points every frame and does not have it.

### Every rule that fires has to say what carries with it

Six faults, all the same shape: a point moved and something belonging to it
stayed behind, or a handle was turned and nothing turned it back. The slide moved
a tension point and left its handle, so the restore rebuilt it pointing down
instead of up — a 36-unit flip on a quarter-unit step, caught by the 200-step
continuity sweep rather than by any assertion written for it. The scale moved
on-curve points through the entry and left every handle behind.

The sixth runs the other way and took the longest to see. **The ordinary point
rules keep a tension point's handle collinear themselves**, turning it onto the
straight as they see it with the far end still standing where it was — so on a
drag across that line is tilted, the coupling then moves the far end and takes
the tilt back out, and nothing turned the handle back. On `n.json` a 30-unit drag
left a 4.1 degree kink at a smooth point, and a sweep of the range reached 6.1.
The handle goes back onto the straight after the coupling has settled, which is
why it runs after and not before.

**The remedy in all six: whatever moves a point moves its handles, and whatever
un-tilts a line squares what was turned onto it.**

### The axis lock, and two writers with one baseline

X states an axis; the larger component wins. The correction reads a shape one
axis at a time, so a diagonal asks it two questions at once.

- **The axis is the drag's, not the frame's.** Deciding it per frame let a later
  reach across overrule an earlier reach along, halfway through a gesture. It
  latches once the pointer leaves a two-unit dead zone.
- **X+Shift is just X.** An axis is the stronger constraint and 0/45/90 has no
  diagonal left to offer under it. Deleted rather than exempted.
- **Two writers need one baseline.** The lock was in the code and never reached
  the canvas: the entry wrote only where its result differed from a baseline
  computed from the **locked** delta, so for the dragged point those agreed and
  nothing was written. Horizontal drags looked locked because the correction
  rewrites the arch points anyway. **The baseline has to be what the other writer
  actually wrote.**
- The same fault a second time: the entry builds its own copy of the ordinary
  behavior to measure against, and built it with scaling off while its caller may
  have built the live one with scaling on. **Anything the caller's factory was
  built with, the entry's copy must be built with too.**

### Which points may slide, three times wrong

- The first gate demanded a smooth point, on the reasoning that a corner owns its
  own tangent. The slide moves the point along the straight and the handle
  travels with it, so corner points slide.
- The second gate skipped a point the edit had already moved. But the slide owns
  exactly one number, how far the point sits from the far end of its straight,
  and a drag carrying a whole stem sideways changes that not at all. It is
  skipped only where the edit changed that distance itself, measured on the
  straight **as it stood before the edit**: measuring on the tilted one reads the
  tilt as travel.
- The third gate asked the far end of the curve to move, so it stood down on the
  commonest gesture of all — dragging a stem moves the near ends and leaves the
  apexes still. The corner is made by both ends.
- **The slide answers to the far leg alone.** Pulling an apex straight down
  carried the tangent crossing with it, so both tension points followed and the
  whole arch travelled as one piece. Where the far leg is the length it was, the
  corner asks for no travel, whatever the crossing did.
- **The coupling rule already existed**, written twice before for the skeleton
  ribs and for base-curve expansion. The first cut here walked neighbours by hand
  instead of calling `collectCoupledPointGroups`, which is rail R-B.

### Content-aware scale: the chain walk, and why the axes differ

Across x, on-curve points joined by straights form a body and a maximal chain of
curves is a run; bodies sort along the axis, the gaps share the change in
proportion, and each run's interior interpolates between its own two moved ends.
That last part lets two runs between the same pair of bodies take different
factors: on the n narrowed to 230 the inner run takes 0.846 and the outer 0.895,
putting the apexes at 115 and 142.3 against the hand-drawn 115 and 142. An
earlier reading, mapping intervals of the axis rather than walking the chain,
does break — two runs project onto one interval and the outer arch's points
inside the right stem's interval freeze.

**Along y the rule cannot hold straights rigid, and this is not a defect.** Across
x a stem's 60 units of width are the drawn detail and its 500 of length are free;
along y the same stem is the length the scale has to change, and in the n the
tallest straight body already spans 500 of the glyph's 516. The first vertical
build held the curves rigid and slid them whole, which is arithmetically sound
and was rejected on sight: it moves the curves and compresses nothing. What ships
is the plain height scale with the tension correction on top, so a round shoulder
squashed in height flattens.

Three stand-downs on the horizontal solve, each meaning the rule has nothing to
distribute: no elastic run, every run returning to the body it started from, and
a gap total of zero.

### Open

- The arrow keys needed their own dispatch: `scene-controller.handleArrowKeys`
  builds its own target entries and had never reached this one. **Anything added
  to the pointer's dispatch has a second dispatch to be added to**, and the two
  are 300 lines apart in different files.
- The transform box reads the X state once, at mouse-down; the pointer drag
  re-reads it every frame.
- The slide's along-the-straight gate may now be redundant, since the coupling
  stops a straight tilting under a drag and the drag no longer slides.
- No manual matrix has been run for any of the three halves. The plan carries
  two, of eight rows each, and neither covers the keys.
- The outer-left junction of the n is a corner the demonstration file moved by
  hand, 8.9 units. Whether it lands where the hand put it now belongs to the
  scale.
- The architecture map has no F10 row. This feature's files are in neither the
  per-feature map nor the shared-file reverse index.

---

## Markers (map F11)

**The count rule was wrong, and use showed it in a day.** The design started with
three cases and resplit arithmetic decided by a tolerance; telling a shifted
index from a resized contour is a search, and a search that gets it wrong reports
a confident wrong number. It collapsed to one rule — the point count under an
anchor changes, the marker goes stale — which bought the thing it was chosen for:
**no tool that restructures a point list owes marker anchors any bookkeeping**,
against an audit of the pen, the knife, shape append, delete-selection, paste and
break-contour, with a quiet wrong measurement as the cost of missing one. The
donor's generated-contour indices produced that exact quiet failure twice. It
also broke every marker in a glyph whenever a point was added anywhere in it — a
feature that cries wolf until it is switched off.

The replacement keeps the refusal and moves the question. **An anchor is a place,
not an index.** The signature decides only whether the indices still mean what
they meant: intact, the address is the truth and the marker rides; moved, check
the outline against where the anchor last stood.

- **The one stored coordinate.** This needs the anchor's last position on disk,
  which the first design forbade. The prohibition was against _recovering_ an
  anchor by geometric matching, and that is still refused. This verifies: one
  question, answered within half a font unit, with no second-best and no
  fallback. Subdividing a curve is exact, so an intact outline answers yes
  however it was resubdivided.
- **A test caught the first attempt.** Preferring the remembered position over
  the live address made a marker snap back to where the stem used to be instead
  of riding it — case 1 broken by the machinery meant to fix case 2. The fix is
  precedence: while the indices hold, the memory is only a memory.
- **Reverse contour stopped being a special case.** It moves no geometry, so the
  rewrite handles it like any other index shift. Under the earlier rule it was
  the one structural change that had to declare its markers broken by hand, and
  writing a signature to disagree on purpose would have been a signature that
  lies.
- **Stale is derived on read, never written**, so an undo past the structural
  edit brings the marker back with no code.
- **The hit tester does not order its crossings along the ray.** Found while
  testing the double-sided centerline case, which returned null, and the
  single-sided case, which returned zero: the crossings come back in the hit
  tester's own order and the winding walk reads a sequence, so measuring outward
  from a point **inside** the black picked the span behind the anchor. The Power
  Ruler never hit this because it measures a whole line across the glyph, where
  the total winding is zero and either direction marks the same spans.

Three sweeps: a moving neighbour over 200 steps and an anchor dragged along a
straight edge over 260 both report 0, and an anchor on a wedge of slope 1-in-2
reports 0.5000000000000284 per unit, which is the slope and nothing more.

**Deviations from the plan, recorded.** The end field is `segmentIndex`, not the
spec's `segmentStart`, because that is what the nearest-hit returns and what
resolution consumes. `measureRay` takes a hit tester, not a glyph controller,
because `fontra-core` has no business knowing what a glyph controller is. A stale
marker is still resolved where it can be, drawing greyed where it used to point
and carrying no number — the number is exactly what must not be trusted. And
`parseSelection` keeps any non-integer remainder raw, because marker ids are
names and the old rule turned them into NaN.

---

## The documents themselves

Five design specs and implementation plans, 3,783 lines, all describing shipped
work, were dissolved into the feature model and the architecture map. **A plan
that outlives its implementation is worse than no plan**: it still reads as an
instruction, and a reader cannot tell which parts are the design of record and
which were withdrawn three rounds ago. The part worth having is the register of
what was tried and rejected on measurement, with the measurement that closed it.

**The map named two editor modules that have never existed**, with line counts,
which is what made them credible — the same error as a phantom modifiers file
corrected days earlier. The map carries a "grep before trusting a filename here"
note rather than just a fixed row. **A code comment pointed at a deleted spec for
several commits**: cited paths rot silently. **Documents that were already
unformatted are left that way**, because reformatting buries a change in noise.
