# forkra Development Log

One section per feature. Each section holds what the other two documents do not:
the faults that came back, the measurements that settle a question, and the ideas
that were built and withdrawn.

It does not say how a feature works. `FEATURE-MODEL.md` says that.
It does not say where the files are. `FEATURE-ARCHITECTURE-MAP.md` says that.

**Adding to it.** Finishing a task means editing its feature's section: add what
is new, and delete what the work just made untrue. Do not append. A superseded
statement is worse than a missing one, because both read as current.

Keep order inside a section only where the sequence is the lesson.

---

## The curvature comb (SpeedPunk, map F3)

**State: settled on a normalized reading.** Entries 45 to 56 reworked the drawing
rule over ten rounds without settling, and the comb was reverted to `2242d76b`.
Five commits then took both scales absolute, in radius. That is what the section
below records. The eleventh round replaced the radius with a turn, which is what
the ten rounds had all been circling: **the readout was never allowed to carry a
unit of length.**

### The eleventh round: a radius is a size, and the comb was reporting size

Reported on `_external/skeletron.fontra/glyphs/tildecomb.json` — the comb went
insane on a combining tilde. Measured on the file as it then stood, against the
default ramp of 400 to 180:

- 88.9 per cent of the outline sat at radius 180 or tighter and pinned to the
  last stop. The mark drew as one flat red with a grey notch at each inflection.
- Its median radius was 67, roughly four times tighter than the ramp's tight end.
- With no ceiling on the fringe, the longest drew 174 units on a mark 100 units
  tall, so the comb was several times the size of the thing it described.

**The first diagnosis was that the anchors were calibrated on the wrong glyphs,
and it was half right and useless.** The anchors came from an N and a U sitting
between radius 170 and 370. This font's median is 116 and `j` — an ordinary
letter, not a diacritic — is entirely between 95 and 152, so it pinned red too.
Widening or re-centring the ramp was the obvious next move. Two whole rounds of
options were written up around it, including a per-glyph override.

The designer refused all of it in one sentence: a circle is a circle. **Scaling a
drawing must not change what the comb says about it.** Curvature carries one over
length, so an absolute reading of it is a statement about size, and no choice of
band fixes that — it only moves which sizes read correctly.

**The quantity is curvature times a length taken from the shape**, which is
dimensionless and is the angle the outline turns through. Harmonize already
scores a joint this way, and its reason is the same one: an absolute curvature
difference lets the tightest joint own the whole number.

**Which length is the whole of the remaining design, and it must be continuous.**
Each on-curve takes the mean of the arc lengths of the curve segments meeting
there, and the length runs linearly along a segment between its two ends. A
per-segment length was the first thing tried on paper and is closed: on the
reported tilde, neighbouring segments differ in length by 4, 5, 31, 33, 42 and 54
per cent across its own smooth joints, so a segment-scoped divisor would have
drawn a false break at each one. That is the same fault the per-segment
_curvature_ divisor was rejected for at 27 per cent on `d`, arriving through a
different door.

Measured after, at the new defaults — reference turn 90 degrees, ramp 30 to 120:

| glyph     | fringe p10 / median / p90 | distinct colours | pinned red | pinned grey |
| --------- | ------------------------- | ---------------- | ---------- | ----------- |
| j         | 16.9 / 22.2 / 28.4        | 173              | 0%         | 0%          |
| k         | 9.5 / 14.9 / 30.5         | 253              | 4%         | 2%          |
| tildecomb | 5.1 / 23.7 / 26.8         | 156              | 1%         | 13%         |

The tilde's longest fringe fell from 174 units to 35, against a peak height of 24. Its 13 per cent of grey is the two inflections, which is what an inflection
should draw.

**The cost, stated because it is real.** A segment's fringe now moves when an
immediate neighbour is redrawn, since the two share the length at the joint. The
five rejected rows in the table below were all rejected for a version of this,
so the difference matters: those divisors were a peak _searched_ over a scope, so
an edit anywhere inside the scope rescaled everything in it. This is a unit taken
from the two segments that meet at a point, it reaches nothing further, and
agreeing at a joint is the one thing the comb exists to do.

**Three sessions were spent measuring the wrong file.** `tildecomb.json` was
redrawn twice while the investigation ran — 20 points and one contour, then 26
and three. Every number taken before that described a drawing that no longer
existed. This is the third time this log records the same lesson: **read the file
at the moment of the question, and say which state a number came from.**

**A playground font is not a calibration set.** Every measurement above comes
from three glyphs in a test file that was never drawn to be representative. They
are enough to show a scale is wrong and not enough to tune one. The turn anchors
need no tuning, which is the point of them.

### Three things the comb does differently from the donor

The donor is in `_external/speedpunk`. It states both of its choices plainly.

|               | donor                                                                          | this comb                                                                                            |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Fringe length | curvature times a fixed gain. Straight proportion, no ceiling, no floor        | the turn times a fixed gain, stated as "full height at turn T", default 90 degrees                   |
| Colour        | the glyph's own range, gentlest to tightest, recomputed when the glyph changes | absolute, on a ramp between two named turns: 30 and 120 degrees, geometric in between                |
| Sample count  | a budget divided by the number of curve segments                               | that, times the square root of the magnification, with the budget divided by the magnification first |

The donor's fringe is a length reading and carries the same size dependence the
eleventh round removed. That is a deliberate departure, not a port gap.

### Three fixes went out with the revert and are not present

1. The comb does not repaint when a comb setting changes. A new peak height,
   sharpness or opacity sits unused until another edit repaints the canvas.
2. The three fields do not scrub, and a number box in that panel keeps the
   keyboard after an edit, so the canvas answers no shortcut until it is clicked.
3. Sharpness and opacity store the full floating point result of a drag.

### Findings

**Ask what the original does before inventing a rule.** The donor was in the tree
for all ten entries. Five of them invented scales for a readout whose original states both of its
choices in a few lines.

**Absolute and relative are two readouts, not two answers to one question.**
Every attempt made one rule serve both comparing two letters and reading one
letter. Length answers the first. Colour answers the second.

**A normalized readout cannot compare across whatever it normalizes over.**
Per segment, it cannot compare two segments, and comparing two segments is what a
joint is. Per glyph, it cannot compare two moments, so the comb breathed under
the cursor. Each fix moved that boundary without removing it.

**A soft limit is still a limit when the working range sits inside it.** A squeeze
towards twice the peak height never clipped. It flattened instead, which loses
what a clip loses and is harder to see. A letter bends past a reference of a
quarter of the em over almost all of its length. Almost every fringe therefore
came from the flat part.

**Spread is a property of the pair, not of the curve.** The height rule and the
colour rule went wrong together twice. Once they used different readings. Once
they used one reading through different shapes. Check anything the eye compares
over the range it will be read in, not at its endpoints.

**A scale needs an anchor a person can name.** Three colour rules took their anchor from
multiples of the peak height. That is a number about the drawing rule, not about
the drawing. Nobody could say what the top of the scale meant.

**A count is not a size.** The screen parameters exist so a stroke holds its width
on screen at any zoom. The magnification therefore divided a sample budget
put among them. That is how the view got into the geometry, and the comb changed
height with the drawing untouched.

**The instrument is worth checking before the geometry.** A joint 1.4 per cent out
drew a 2.73 unit step. The same joint 23 per cent out drew 0.16 units. The comb
reported the reverse of what was there. Four rounds went into the geometry first,
and the geometry was right every time.

### The height scale is the run's, not the segment's

The restored comb divided each fringe by the tallest curvature on its **own
segment**, so two segments meeting at one curvature drew two heights whenever
their own peaks differed. The eleventh entry in the rejected table below is that
same rule, measured at a 27 per cent false step on `d` and rejected once
already; the revert brought it back with everything else.

The divisor is the **run** now — a maximal chain of curve segments joined at
smooth on-curve points, broken by a line, a corner or a contour end. The break
rule is not a tuning choice: a fringe is only comparable across a joint that
claims one curve, and a corner is the outline saying it does not. On the two-cubic
fixture, one curvature across a smooth joint drew 4.97 units of fringe from the
left and 3.60 from the right; both draw 4.97 now.

**This moved the boundary the normalization cannot see across. It did not
remove it, and the next report was the proof.** Changing one segment of
21-24-27 rescaled the other: a ten per cent handle change on the neighbour took
21 per cent off an untouched fringe, and half the mean at ×0.7. The height scale
is absolute now — see below. The run survives as the **colour** scope only.

**Colour was left per segment for one round, and reported the next day.** On
`N^1.json` layer `5daac8f8`, points 3 and 24: two curvatures agreeing to 0.29
per cent, drawn grey on one side of the joint and orange on the other. The cause
is the per-segment range's **lower** end rather than its peak — the joint is the
flattest place on the segment arriving at it, so `k = segMin`, so `t` is exactly
0 and the fringe is the bottom of the scale whatever it measures. The other side
sat at 0.362 of its own range. Both read 0.266 and 0.272 on the run's range now,
and point 24 reads 0.420 on both sides against 0.420 and 0.000.

**Every joint at the end of a run is an extreme of one of its two segments**, so
this was not a rare configuration — it was structural, and the two scales are
both the run's now.

**A fixture can be too kind, and nearly hid it.** The first colour test used the
synthetic two-cubic fixture from the height round, where the joint happens to be
the minimum of _both_ segments, so both sides already read 0 and the test failed
by five parts in 255. The reported geometry, dropped in as the fixture, fails by 73. **Take the case the report names.**

### The height went absolute, and the anchor was the whole of the design (radius era)

Reported one day after the run scale shipped: changing one segment of the
21-24-27 chain changed the height **and the peakiness** of its neighbour. It
did, by construction. `runPeak` is the tallest curvature in the run, so a
tighter neighbour lengthens the divisor under geometry nobody touched, and
because `sharpness` is an exponent on that ratio the profile flattens as well as
shrinking — which is why the mean fell much faster than the max.

| 24→27 handles | 21→24 max fringe | 21→24 mean |
| ------------- | ---------------- | ---------- |
| as drawn      | 24.00            | 18.85      |
| × 0.9         | 18.85            | 14.91      |
| × 0.7         | 17.51            | 7.50       |
| × 0.5         | 17.52            | 3.42       |

**This is not a fault of the run grouping. It is what relative normalization
is**, and the same complaint already stands in the rejected table below against
the glyph-wide divisor: "redrawing one segment moved the glyph's peak". Per run
is that fault in smaller scope. There is no scope that removes it, because the
coupling is the scope.

So length went absolute, which is the donor's rule and what this section's own
heading rule has said three times: **length answers "compare two letters", and a
readout that rescales when a neighbour moves cannot answer that.** Colour stays
relative and stays scoped to the run. The two readouts now differ in kind rather
than in radius.

**The gain is stated as an anchor rather than as a gain.** A bare multiplier is
the thing the colour rules were rejected for three times over — nobody could say
what the top of the scale meant. The anchor is also invariant to sharpness, so
the two controls do not multiply into one quantity. Both points still hold. The
anchor was a radius then, default 200 units, and **that part is superseded**: a
radius is a length, so the readout was reporting size. It is a turn now, default
90 degrees. See the eleventh round at the top of this section.

Measured after: the neighbour sweep above moves 21→24 by 0.00 at every pull.
The whole N at the default anchor draws min 11.55, median 17.33, max 29.57
against a peak height of 24.

**The stated cost is the ceiling.** There is none, so a tight corner draws a
spike as long as its curvature asks for, and a near-cusp draws an enormous one.
That is the donor's behaviour and it was accepted knowingly, not overlooked.

### Colour went absolute the next day, and the run went with it (radius era)

Reported immediately: colour still restretched when a neighbour changed. It did,
by the same mechanism and in the same scope — the height had gone absolute and
the colour had not. **Half a fix reads exactly like the fault it half fixed.**

Colour became a fixed function of radius, geometric between two named ends, so
equal ratios were equal steps of colour. **The geometric spacing survives and the
radius does not** — the ends are two turns now. What follows is why the ends have
to be named separately from the height anchor, which is still true whatever unit
they are in.

**The spread is the whole of the design, and the first attempt got it wrong in
the commit that said so.** Colour taken straight off a 0–1 curvature ratio was
measured and rejected once: radius 200 down to 30 is the working range of most
letters and that rule spent 0.33 to 0.77 of the stops on it, which is one colour
to the eye. The first ramp derived its two ends from the height anchor, four
times either side — radius 50 to 800, 16 to 1 — and reported back as "everything
is yellow, and you have to push curvature too far to see pink". It had
re-inherited the very objection it quoted.

Measured afterwards, at 50 samples per segment over both external glyphs:

| glyph | p5  | p25 | median | p75 | p95  |
| ----- | --- | --- | ------ | --- | ---- |
| N     | 168 | 190 | 278    | 325 | 365  |
| U     | 183 | 214 | 275    | 434 | 1587 |

**Letters occupy about 2.2 to 1 in radius.** A 16 to 1 ramp therefore lands the
whole drawing inside its middle stop, and the last stop needs a radius four
times tighter than anything drawn. The ramp is 400 to 180 now, named outright.
On N that draws 1 per cent pinned flat, 61 per cent in the lower half, 20 in the
upper and 18 pinned tight; on U, 30 / 42 / 24 / 4. Both letters use all three
stops.

**And the ramp owns its own two numbers.** Deriving them from the height anchor
was one number doing two jobs — the span of a colour ramp and the anchor of a
fringe length are unrelated, so retuning the length moved every colour. That
trap has its own row in this log four times over, and it was walked into inside
the commit that cited the rule. **Quoting a rule is not applying it: apply it to
a measurement.**

Measured on the reported joints: point 3 is byte-identical after the neighbour
two segments away is halved, and point 24's two sides agree to the digit where
one read grey and the other orange three days ago.

**The run grouping is deleted.** It was the scope of a relative scale, both
scales are absolute, and nothing read it — the same "who writes it, not who
reads it" check that found four dead levels in the skeleton. It lived three
days. The break rule it encoded is not lost: it was never about the drawing, it
was about what a relative scale may compare, and an absolute one compares
everything.

**Two ideas that had to be given up to get here**, both of them real:

- A relative colour stretches the contrast on a letter that has little curvature
  variation. Absolute cannot, so a very flat glyph now draws nearly one colour —
  which is the truth about that glyph, told less legibly.
- Colour and length now encode the same number twice. That is redundancy, not
  information. It is kept because two encodings of one number are read at
  different distances: length at a glance across a word, colour at a point.

**The probe measured the wrong quads first, and it looked like a result.** It
picked a segment's quads by the bounding box of its two end points, so once the
neighbour's handles moved into that box its quads were counted too — reporting
an 89 per cent _rise_ on an untouched segment. Slicing by emission order gives
0.00. Same class as the bulb's rejoin helper: **a helper that identifies
geometry by position re-identifies it when the geometry moves.**

### Rejected drawing rules

We built and measured each one. None is in the tree.

| Rule                                                                                              | Why it went                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Divide each fringe by the tallest curvature on its own segment                                    | Two segments meeting at equal curvature drew unequal fringe. On glyph `d` the two sides of a joint peak 27 per cent apart. That 27 per cent was the whole of the step on screen. Elsewhere a 2.7 per cent difference in the curve drew as a 21 per cent step, eight times the thing it measures.                                                                                               |
| Divide by the tallest curvature on the glyph                                                      | Redrawing one segment moved the glyph's peak. Every fringe then changed length at once, and two glyphs never shared one scale.                                                                                                                                                                                                                                                                 |
| Divide by the tallest curvature on its own **run**                                                | Shipped for one day. It fixes the false step at a joint and keeps the coupling above at smaller scope: a ten per cent handle change on one segment took 21 per cent off its untouched neighbour. Any relative length is rescaled by whatever it normalizes over. The run survives as the colour scope.                                                                                         |
| A typed reference radius, with a floor and a ceiling                                              | A readout you must tune before you can trust it is not a readout. The ceiling drew two different curvatures at one length. That is the same false reading the per-segment divisor gave.                                                                                                                                                                                                        |
| Squeeze the height towards twice the peak                                                         | Nothing clipped and everything flattened. Four times the reference tightness drew 1.6 times the height and eight times drew 1.8: two peaks, one drawn length.                                                                                                                                                                                                                                  |
| Colour straight off the curvature ratio                                                           | Radius 200 to 30 is the working range of most letters. This rule spent 0.33 to 0.77 of the stops on it, which is one colour to the eye.                                                                                                                                                                                                                                                        |
| Colour off the fringe length, last stop at three peak heights                                     | An arc with its handles half way out already sat past the middle stop, and everything above handle tension 1 came out identical.                                                                                                                                                                                                                                                               |
| Colour off the fringe length, last stop at five peak heights                                      | Better: a well-formed arc read a third along and red waited for tension 1.5. Still absolute, so it painted a whole letter one colour like the two before it. Where a letter's curvature sits depends on the letter.                                                                                                                                                                            |
| Derive the colour ramp from the fringe-length anchor                                              | Shipped for one session, reported as "everything is yellow". Four times either side of the anchor is 16 to 1, and letters occupy about 2.2 to 1, so the drawing sat inside the middle stop and the last stop was unreachable. It also made one number state two unrelated things. The ramp names its own two ends, in degrees of turn.                                                         |
| Colour relative to the segment, and then to the run                                               | Both shipped and both went. A joint that is an extreme of one of its two segments took the end of that scale by construction; per run, an edit anywhere restretched every colour in the run. The absolute ramp above is the same idea as the two rows over this one, with the stops placed on the working range rather than on 0–1 — which is what those rows were actually complaining about. |
| Recalibrate the radius anchors — per font, per glyph, or by fitting them to the drawing on demand | Written up as three options and refused before any was built. Every one of them keeps a length in the readout and only moves which sizes read correctly, so a scaled drawing still says something different about itself. A circle is a circle. The anchors are angles now and there is nothing left to calibrate.                                                                             |
| Normalize the turn by each segment's own arc length                                               | The obvious first form, closed on the reported tilde before it was built: neighbouring segments there differ in length by up to 54 per cent across smooth joints, so the divisor steps at each one and a G2 joint draws a break. Same fault as the per-segment curvature divisor at the top of this table. The length is continuous across joints instead.                                     |

---

## Harmonize (map F8, carried fork extras)

**State: shipped.** Three constructions: G3 tried first with G2 as its fallback,
and Curvatura's handle-length solve as a separate check that replaces both. It
reaches skeleton centerlines as well as ordinary paths. Two opt-in preparation
passes run ahead of the solve: realign, then equalize.

### Findings

**G2 and G3 answer different questions, and the eye reads the second one.** The
reported joint on glyph `d` had curvature agreeing to 1.6 per cent, so G2 was
already satisfied and no setting of it changed anything. What disagreed was the
rate of change of curvature: arriving it fell at 0.0000404 per unit of arc,
leaving it rose at 0.0000497. The sign reverses, so curvature has a local minimum
at the joint, and the joint sat 41 per cent below the hump behind it. That notch is a G3 defect.
The G3 construction cut the rate step by a factor of 77.

**Match the rate per unit of arc, not per unit of parameter.** The donor matches
the parameter. Two segments run through a joint at different speeds, so equal
rates in the parameter leave a rate mismatch equal to the ratio of the two, which
was 10 per cent on the reported glyph. A designer reads the curvature comb, and
the comb runs against arc length. The arc form is the same shape of closed form,
one square root and one division. It holds to machine precision on both
conditions.

**The G3 answer is exact and unique, so nothing iterates.** Equal curvature and
equal rate are two equations. The two inner handle lengths are two unknowns. The joint and both outer handles hold still. Nothing is left to choose between.

**One pass is exact at any bias, on an isolated joint.** The ratio depends only
on the perpendicular offsets of the two outer points from the tangent line.
Neither the joint nor the handles moving along the tangent changes those offsets.
Iteration earns its keep only on coupled joints. There one joint's outer point is
its neighbour's inner one.

**The five-point stencil is complete.** A cubic's endpoint curvature depends only
on its last three control points, so the two outer points are inputs and never
outputs. That is why the default algorithm leaves the outer handles alone, and
why Tunni equalization, which moves them, has to be a separate opt-in pass.

**A sweep that stops early stops permanently.** Three separate causes took a
joint out of the loop for good. A cusp floor read the handle it was limiting. A
tension ceiling ran once at the start instead of each pass. Whole-unit rounding
nudged a point the sweep never looked at again. Each one left a joint that
improved on a second press, which is the report.

**Doing nothing is a result that has to be arrived at, not assumed.** The command
took an undo step on an already-harmonic contour. The report said
"already-harmonic" for those joints, and The writes underneath recorded the
change. The sweep writes a point several times on the way to an answer. A joint
two thirds of a unit out takes a correction, takes another, then rounds back onto
the coordinate it started from. The code now writes a point only where it is not
already there, and the editor runs the sweep on a copy and writes back only the
points that ended up somewhere else.

**Write per point, never a whole path.** Assign `layerGlyph.path` inside the
change recorder and it records a live class instance. That fails on replay, and
it broke multi-source editing. This is a general rule for any geometry
operation, not a harmonize quirk.

**Read the file at the moment of the question.** The first three answers about
the reported joint each described a different geometry, because the glyph was
redrawn between the report and each measurement. The same joint was an
inflection, then harmonic to 1.5 per cent, then 38 per cent out. Say which state
a number came from.

**Reports are addressed, not indexed.** The path built to run the pass over a
skeleton centerline is thrown away, so an index into it means nothing afterwards.
Each entry carries the contour and point id it came from.

**A dragged slider does not deliver its value through the field-change callback.**
It fires once at the start of the drag, carrying the pre-drag value. Every later value arrives on
a stream. The stored setting was therefore always one drag stale.
`displayValue: true` is also not a boolean: it is a placeholder string, and the
number box read "true".

### The grid was eating the whole answer, and the report was covering for it

Reported on the outer arch of `n`: a visible step in the comb, and harmonize
saying "1 harmonized" while nothing moved, under every combination of the three
checkboxes. Two defects, and the second is what made the first take three
sessions to find.

**A harmonic answer is a ratio, so rounding the two ends independently can undo
all of it.** Curvature at a cubic's end is the outer handle's offset over the
square of the inner handle's length, so the entire correction lives in the ratio
of the two inner handles. On the reported joint the exact G2 answer is a move of
**0.344 units** — small because the handles are only 51 and 38 units long, and
the square doubles the sensitivity: 0.344 is 0.67% of one handle and 1.35% of
its curvature, 0.90% of the other and 1.80% of its curvature, in opposite
senses. Those add to 3.15%, which is the mismatch exactly.

Rounded to the nearest whole unit the ratio came back as **51/40 = 1.2750**
against the drawn **65/51 = 1.2745**. Four digits. The answer was gone.

| state                | mismatch |
| -------------------- | -------- |
| as drawn             | 3.156%   |
| nearest whole units  | 3.537%   |
| best bracketing pair | 0.430%   |
| exact                | 0%       |

Nearest rounding lands **worse than doing nothing**, the best-state gate then
reverts the lot, and the command writes nothing. The grid position is chosen now
rather than taken: snap to nearest, then let each moved point try the whole-unit
positions bracketing its own exact answer. Arch joint 3.156% → 0.423%. A ring
whose every correction is sub-grid, 6.42e-5 → 4.90e-5.

**A verdict read off a discarded state is worse than no verdict.** When no
attempt beat the drawing, `bestStates` stayed null and the report came from the
last attempt's states, which said `harmonized`. So the one instrument pointing at
the fault was reporting success. The verdict is read against the drawing as it
arrived now, and a joint whose stencil did not move reports `skipped` with reason
`below-grid`.

**Three sessions went into the rounding because the rounding is where the chain
starts, not where it ends.** Grid rounding forces a scoring gate, because a
rounded answer can be worse than the drawing; the gate then reverts silently; and
the report describes the reverted state. Every session found a link and treated
it as the cause.

### The score was measuring the wrong thing, twice

Reported on `n` node 13, across all seven combinations of the checkboxes: press
once and two points move by a unit each; press again, and again, and nothing is
written at all, every joint reporting `skipped/below-grid`. Four faults behind
it, all measured, and two of them are the same fault — the number the command
scores itself by did not measure what the command was doing.

**The score had no rate term, so G3 was judged on G2.** `jointResidual` summed
the curvature discontinuity only, and it drives both the grid search and the
best-state gate. From a G2-optimised drawing, all four whole-unit placements
bracketing the exact G3 answer score **worse on curvature alone** than the
drawing they came from — so all four were reverted, and G3 could never take over
from a joint that was already G2-harmonic. The score now measures the condition
it was asked for.

The first attempt at that term normalised by the joint's curvature and broke the
inflection fallback: `|dk| / mean(|k|)` saturates at exactly 2 at every
inflection, because the two curvatures have opposite signs there. A score with no
gradient at an inflection cannot tell the G2 fallback's answer from the drawing
it started on. Normalising by the joint's **length** instead makes every term an
angle — curvature times length is the angle a segment turns through — so the
three terms add with no weight to choose.

**The slide was a fallback, so it never ran.** `g3AfterSlide` was reached only
when holding the joint still returned null, which on a healthy joint does not
happen: G3 with the slide on and off produced byte-identical output. It is
opt-in, so when it is on it is now the whole search.

**G1 was preserved by definition and therefore never checked.** Every
construction moves points along the tangent, so the tangent survives — until the
answer is rounded, the next attempt reads the tangent off the rounded handles,
and the grid search, scoring curvature alone, buys another bend with another
sliver of continuity. On the worst of 2000 random well-formed joints the residual
fell from 31.7 to 1.1 while the joint creased from 0.5 to 13.1 degrees, one
attempt at a time, and every step of it scored as an improvement. 17.9% of that
population finished bent past anything the grid could account for.

| over the grid's allowance, 2000 joints | before | after                        |
| -------------------------------------- | ------ | ---------------------------- |
| count                                  | 358    | 0                            |
| the worst one                          | 13.1°  | 0.95° (its allowance: 1.91°) |

That worst joint now finishes straight **and** with its curvature discontinuity
42x smaller than the drawing's. The cost is real and worth naming: mean curvature
discontinuity after the command rises from 6.8e-3 to 7.7e-3 over the same
population, because some of what the old number called an improvement was a
crease.

**Freezing the tangent was the wrong fix, and the trace said so.** The first
attempt held each joint's tangent from the drawing as it arrived and projected
every correction onto it. It broke the coupled-ring tests, because on a ring the
tangent legitimately rotates as neighbours move and a frozen axis is a stale one.
The per-attempt trace then showed the drift was not coming from the construction
at all: the residual fell monotonically while the kink grew, which is a search
choosing bent candidates because nothing scored the bend.

**The attempt loop earns its keep.** Mean residual over 2000 well-formed joints
is 1.52 at 40 attempts and 3.27 at one, so deleting it is not the fix for what it
does to the tangent — putting G1 in the score is.

**The comb fabricates the step a designer reads.** `computeSpeedPunkSamples`
normalises each segment's fringe by that segment's own peak curvature. At joint
13 after G2, a true mismatch of 0.53% draws as a 6.96-unit, 38.9% step; after an
**exact** G3 answer it still draws 2.54 units and 11.2%. At joint 4 it draws 0.66
units over a 22.37% mismatch, and 3.73 units after the mismatch is fixed to
2.36% — the reverse of the truth. Not fixed, at the user's instruction; recorded
here so it is not re-derived.

### The on-curve slide under G3, measured both ways

Proposed: disable "move the on-curve" under G3, on the reasoning that G3 always
moves the two inner handles and holds the joint. Measured, that is the wrong
call on an isolated joint and the right instinct on a ring.

Over 2000 random isolated joints, G3 with the slide against G3 without it: the
curvature step improves on 1723 and worsens on 253, and the rate step improves
on 1742 and worsens on 237. It is the most effective option under G3, not a
dead one.

Over 400 random coupled rings the answer reverses: better on 77 and worse on 322. Every joint sliding at once moves its neighbours' stencils, so the ring
fights itself. It is also the slowest thing in the module — 64 sampled
positions per joint per attempt.

The real complaint behind the proposal stands: one label covers two different
actions. Under G2 the tick picks who carries the correction, and the curve is
the same shape either way. Under G3 it turns on a search over the tangent. That
is a naming problem.

### The second donor command, and what it is for

`harmonize_contour` answers "fix this joint". `harmonizehandles_contour`
(Curvatura.py:519) answers "make these curves harmonious", and is not a variation
on the first: it gives every node a target curvature — the mean of its two
magnitudes, zero at an inflection — and then solves **both** handle lengths of
every segment to reach its own two ends' targets. Handles keep their directions,
so it cannot bend a joint at all, which is the property the joint command had to
have a scoring rule added to guarantee.

**Roots are bracketed, not Newton-from-zero with deflation.** The donor's
`newton_roots` folds each root's error into the next, and Newton from a fixed
start reaches whichever root it reaches — on a quartic with two admissible
answers there is no telling which, and the caller is choosing between them by
bending energy. Between two turning points a polynomial is monotone, so the
derivative's roots and a root-radius bound cut the line into intervals bisection
resolves exactly. Fixed trip count, no starting guess.

**The quartic was rederived rather than trusted, and the donor is right.**
Writing the handles as `a(cos A, sin A)` and `(1,0) + b(-cos B, sin B)` gives
`ka = (2/3)(b*sin(A+B) - sin A)/a^2`, and eliminating `a` between that and its
mirror reproduces the donor's five coefficients exactly.

**It is refused more often than the joint command, and says so.** The answer is
one pair of lengths, not a direction to step along, so a cusp floor or a tension
ceiling cannot be met by scaling back — it is taken whole or not at all. Where
every solve is refused, the report says `clamped`, `tension-limited` or
`degenerate`; saying "already harmonic" there would be a lie about a joint whose
answer exists and was not drawn.

Measured on `n`. On the outer arch joint it takes the two curvatures, 1.0563e-2
and 1.0619e-2, to their mean exactly on both sides. Per joint, against the other
two constructions, whole-unit output:

| joint | as drawn | G2                   | G3 + slide  | handle lengths    |
| ----- | -------- | -------------------- | ----------- | ----------------- |
| 4     | 1.44e-4  | 1.44e-4 (below grid) | 6.61e-4     | **9.08e-5**       |
| 13    | 4.30e-3  | 4.81e-5              | **6.73e-6** | 1.15e-4           |
| 33    | 2.73e-2  | 4.81e-5              | **6.73e-6** | 1.30e-2 (refused) |

No construction wins everywhere, which is why it is a third check rather than a
replacement. Joint 4 is the case that matters: the joint command's answer is
smaller than the grid can hold and G3 leaves the curvature step larger than it
found it, and only the handle solve improves it.

### Two things the donors settled

**The G2 construction is confirmed from two independent directions.** SuperTool
intersects the outer handle lines at `D` and takes
`r = sqrt((|PP−P|/|P−D|)·(|D−N|/|N−NN|))`. Curvatura never builds `D`: it takes
the perpendicular offsets `d2`, `l2` of the two outer handles from the tangent and
uses `t = (d2 − sqrt(d2·l2))/(d2 − l2)`. They are the same construction —
`PP` lies on `P→D`, so `d2 = h·|PP−P|/|D−P|` and `l2 = h·|NN−N|/|D−N|`, hence
`r = sqrt(d2/l2)` — and both place the joint so that
`dist(node,N)/dist(P,node) = sqrt(l2/d2)`. Ours agrees. The target was never the
bug, and that now rests on the donors as well as on measurement.

**Romer removed the G3 algorithm we run.** Curvatura's documentation, section 6.5:
"the handles may exceed the tangent triangle, which means that an additional
inflection point occurs on the segment. Therefore, this algorithm has been removed
from Curvatura." Exceeding the tangent triangle is exactly what `maxHandleTension`
forbids — a handle past its segment's Tunni point, where the two handle lines
cross. So we run an algorithm its author withdrew, and the ceiling in `g3Attempt`
is the guard he did not have. Not a defect to chase; the reason the algorithm is
usable here. He also records that Fontlab 6 and 7 implement it for single nodes.

**Neither donor refuses a joint because a neighbouring on-curve is a corner**, and
neither do we — `jointSegments` checks only that the far point is an on-curve.
Both donors do refuse a joint where a straight meets a curve, as we do: SuperTool
needs all four neighbours `OFFCURVE`, and Curvatura's `segments_selected_cubic`
needs both neighbouring segments to be cubics. On `n` that rules out points 1, 7
and 10, the springing points where the stems meet the arches. Matching a straight's
zero curvature means flattening the curve, not harmonizing it.

### The glyph was redrawn in the middle of the investigation

`n.json` went from two contours with integer coordinates to one 20-point contour
carrying fractional ones, and the reported joint moved from index 16 to index 13,
while the session was running. Every number measured before that described a
drawing that no longer existed. Same lesson as the first harmonize round, and it
cost a full round of wrong conclusions: **read the file at the moment of the
question, and say which state a number came from.**

### Three donors read side by side, and what came of it

Five more donors were read against ours: Green Harmony, Grey Harmony, Curve
Equalizer, and the Bezier Fixer and Positional Harmonize scripts. Three of them
carry constructions we already run, function for function.

- **Green Harmony** is our G2 target reached by moving the on-curve.
- **Grey Harmony** is the same target reached by translating both handles.
  Those two are our second checkbox, and their equivalence is the reason it is
  a checkbox and not a slider.
- **Curve Equalizer's Balance** was our equalize exactly: the plain mean of the
  two tensions.

So the G2 target now rests on four independent sources. Two things were new.

**Equalize belongs before the solve.** The Bezier Fixer panel runs realign,
then tunnify, then harmonize. Curvatura keeps its tunnify a separate command.
Two donors putting the balance first is what closed the defect this section
carried: ours ran last, inside the best-state gate. It balanced each segment
against inner handles the solve had just placed, so it overwrote the exact
answer, and a harmonic answer the gate declined took the equalization out with
it. On the arch joint the G3 rate step goes from 5.8e-5 to 1.6e-19, and the
curvature step to 1.4e-17.

The stated cost is that the drawing does not end balanced. The solve moves the
two inner handles after the balance, so the tick now means "start from balanced
segments" rather than "finish with them". Both other donors accept the same
trade.

**A balance has one free number, and the plain mean is not always it.** Both
handles go to one fraction of the way to the Tunni point. The fraction that
moves the drawing least is a least-squares fit over the whole segment, and it
has a closed form — every point of the curve is a straight line in the
fraction, so the answer is one projection with nothing to search:

```
    (4|u|² + 3 u·v) t₁  +  (4|v|² + 3 u·v) t₂
    ------------------------------------------
             4|u|² + 6 u·v + 4|v|²
```

where `u` and `v` are the two tangent rays. Where they reach equally far this
IS the plain mean, so the donors' rule is the symmetric case of it. The gain is
small and honest: on the worst deviation from the drawn curve, 5.44 against
5.67 units on an uneven-reach fixture, 0.891 against 0.913 on a flatter one.
The denominator is positive for every pair of rays, because 4a + 4b always
exceeds 6√(ab). The answer is clamped into the span of the two tensions, since
a fraction outside that span is not a balance.

Two guards came with it. A segment whose two handles sit on opposite sides of
its chord is refused, which Curve Equalizer also does: no one tension describes
an S. And an already-balanced segment returns itself, so a second press moves
nothing.

**The midpoint form was built and dropped inside the hour.** Bezier Fixer picks
the fraction whose curve comes closest to the original point at t = 0.5,
searched over a fixed sweep. The same idea has a closed form, and it was built
before the least-squares one — it is worse on every fixture measured, because
one sample is not the curve. It was also written into a test as "keeps the
curve's own midpoint", which is false: the balanced midpoints lie on a line the
original midpoint is not on, so the answer is the nearest point and not the
point. **A test that asserts an exact identity for a least-squares answer is
asserting the thing least squares exists because you cannot have.**

### Pressing the button again, and what the loop can and cannot settle

Reported as "multiple presses give a better and better picture". Measured, the
report was half right and it named a defect.

A press was not a fixed point. Over 2000 random joints a second press moved
points on 21 of them under G2 and 35 under G3 — the small tail the rounding
loop inside the sweep leaves — and with the two preparation passes on it moved
1115, improved 660 and made **430 worse**. So repeated pressing was a gamble
that read as convergence.

The whole press repeats inside one scored gate now, the rule the rounding loop
already used, one level up. Without the preparation ticks it settles
completely: 0 of 1500 second calls move anything, against 21 and 35.

**It cannot settle the balance, and the reason is what the balance is.** Every
call balances the drawing it is handed, and that drawing has had its inner
handles moved by the previous call's solve. So there is always something left
to balance, and 1082 of 1500 second calls still move. This is not a bug in the
loop. It is two different requests to the same four handles inside one command.
Curvatura keeps its tunnify separate, and the log has said that is the better
model twice now. **A loop can make one answer settle. It cannot make two
answers agree.**

**Three attempts at a floor, and why none of them work.** The gate needs a state
it may never fall beneath, or the balance is reverted and the tick does nothing
— the defect this section already carried. Making that floor the prepared
drawing fixes the reversion and costs idempotence, because the next call's floor
is the prepared version of the kept state and the kept state is not itself a
candidate. Making it the arriving drawing restores idempotence and brings the
reversion straight back. There is no third place to put it while the balance
lives inside the command.

**A test that pins coordinates cannot survive a search.** "Balances the segments
off the arriving drawing" asserted an outer handle's exact position, which was
true of one press and false of the best of several. Deleted rather than
loosened: the contract it was reaching for — the joint is as exact with the
balance on as with it off — is already pinned by its own test, and that one is
a statement rather than a coordinate.

**A starved iteration budget is now partly made up by the repetition.** The
not-converged test used to expect two partials; one of the two joints comes out
harmonized, because the second solve starts where the first ran out. The budget
is not the hard stop it reads as.

### The j joint: a bad drawing disarmed the guard

Reported on `_external/test-glyphs/j.json`, point 3 of the `b1aacb66` layer.
Three complaints, and they are one fault.

The joint arrives with a radius of 199.8 on one side and 42.7 on the other, a
130 per cent step. With every tick off the command is exact: 109.3 against
108.4, a 0.90 per cent step, and without the grid it is 0.000. The 0.90 is
whole-unit rounding and nothing else. Realign is a no-op there, correctly — the
joint and both handles already sit at y = 355, so the smooth flag is telling the
truth and there is nothing to repair.

With equalization on, the left segment came out flattened and its handles read
0.880 and 0.191 — the opposite of what the tick asks for. The balance itself was
fine and left them at 0.609 and 0.609. What overwrote it was Curvatura's
handle-length solve, which **reported `partial`, reason `degenerate`** — its own
solver refused the joint — and won the gate anyway.

**Why the refused answer won.** A joint may not be left worse than
`maxCurvatureStep`, and that bound stands down where the drawing arrived worse,
so that a joint 40 per cent out may still be improved to 30. Read off the
arriving drawing alone, the stand-down is permanent. Here it stood down at 130
per cent, forbade nothing, and the choice fell to the term below it, which under
G2 is bending energy — twenty to fifty times the size of the joint terms, and it
prefers the flatter curve. So the tick that admits the handle-length
construction was the tick that flattened the stroke.

It never showed with the tick off because there is only one answer then, and
never under G3 because there the rate has its own rank above the curve term and
cannot be outvoted.

**The fix is the ratchet**, not a veto on the refused construction. The bound is
now the worse of the perceptual one and the best step anything on the table
actually reached. Both fixes close this report; the ratchet closes the class.
It also forced the constructions to be drawn first and chosen afterwards,
because a ratchet cannot rank a field it has not seen.

On the reported joint: 4.21 per cent to 2.37, the construction `g2` rather than
a refused `handles`, and the left segment at 0.609/0.417 rather than
0.880/0.191. Over 1500 random joints:

|                         | median step           | left over 3% and worse than drawn |
| ----------------------- | --------------------- | --------------------------------- |
| G2, no ticks            | 5.12e-2 unchanged     | 186 unchanged                     |
| G3, no ticks            | 2.96e-1 unchanged     | 317 unchanged                     |
| G2 + equalize           | 2.27e-2 → 2.17e-2     | 223 → 215                         |
| G3 + equalize + realign | 9.01e-2 → **2.93e-2** | 430 → **255**                     |

Byte-identical with no ticks, which is the check that matters: the ratchet only
bites where there is more than one answer to rank. The stated cost is under G3
with the ticks on, where the median rate step rises from 5.25 to 13.3 — the
answers it now vetoes were flatter and some of them had the better rate. That is
the module's own ordering: a visible break at the joint outranks any amount of
residual.

**Repeated calls settle now.** On the reported joint they converge by the fourth
press and hold. Over 800 random joints with equalization on the median is two
calls and the 90th percentile six, against a drift that never converged. Ten per
cent still have not settled inside twelve, and that is the balance's own nature
rather than the loop's — see the section above.

### The B^1 joint: an answer its own solver had refused

Reported on `_external/test-glyphs/B^1.json`, point 3, with equalize and realign
on. The first press left the two segments at 0.116/0.979 and 0.988/0.108 — as
far from balanced as a segment gets, from the tick that asks for balance. Later
presses then flattened both sides.

Same construction as the `j` report, and the ratchet did not catch it: this
answer landed inside the perceptual bound, so nothing above the flatness term
had anything to say. What was wrong with it is not its curvature step. It is
that **Curvatura's handle-length solve reported `partial`, reason `degenerate`
— it gave up on the joint — and the ranking crowned it anyway.**

Refusal is a rank now, below the hard defects and above everything that
measures the curve. An answer its own solver refused is not an answer, however
flat it draws.

**The same three words mean different things to the two constructions, and only
one of them means refusal.** The joint constructions step toward their answer
and scale the step back at a limit, so a `clamped` joint answer is real and
partly applied — counting those as refusals made four existing tests report
`skipped` where they had reported `partial`, which is how the distinction was
found. The handle-length solve states one pair of lengths, taken whole or not at
all, so there the same word means it drew nothing.

**The fix let the refused construction win properly.** On the reported joint the
handle-length solve now wins, and wins well: 0.28 per cent across the joint,
0.605/0.621 and 0.600/0.627, and a second press does nothing. It was never the
wrong construction. It was being crowned on the attempt where it had failed,
which also fed that failed drawing to the next attempt.

Both reported joints settle now and settle nearer the drawing:

|               | first press | settles at | settled tensions         |
| ------------- | ----------- | ---------- | ------------------------ |
| `B^1` point 3 | 0.28%       | call 1     | 0.605/0.621, 0.600/0.627 |
| `j` point 3   | 2.37%       | call 3     | 0.500/0.496, 0.692/0.685 |

Over 1500 random joints, against the previous round: no ticks unchanged to the
byte; G2 with equalize, joints left over 3% and worse than drawn 215 to 212;
G3 with both ticks, 255 to 251. The rank is a tie-break in the population and a
correction on the two reported joints, which is what a rank below the hard
defects should look like.

### The balance tick did two unrelated things, and they fought

`B^1.json` redrawn, point 3, still with equalization on: one press left the left
segment at 0.961 against 0.246. Not refused this time — the handle-length solve
converged and won honestly.

The tick does two unrelated things. It balances the segments before the solve,
and it admits Curvatura's handle-length construction. **That construction has no
balancing property at all** — it solves handle lengths against a curvature
target and says nothing about how the two of them compare. So whenever it wins,
the tick's own promise goes with it, and under G2 it usually wins, because there
the ranking is carried by the term that prefers the flatter curve. All three
reports on this tick were this one fault wearing different clothes.

**A tick states what the designer wants, so it belongs in what makes one answer
better than another.** Where it is on, an answer that leaves a segment's two
tensions more than 0.05 apart loses to one that does not. It is a count and not
a magnitude, like the curvature bound above it in the ranking: inside the
tolerance an answer may move tension about freely.

Both reported joints now balance in one press and hold:

|                       | joint | left segment  | right segment | settles |
| --------------------- | ----- | ------------- | ------------- | ------- |
| `B^1` point 3, before | 0.48% | 0.961 / 0.246 | 0.441 / 0.588 | never   |
| `B^1` point 3, now    | 0.48% | 0.767 / 0.739 | 0.568 / 0.549 | call 2  |
| `j` point 3, before   | 2.37% | 0.609 / 0.417 | 0.769 / 0.565 | call 3  |
| `j` point 3, now      | 0.79% | 0.467 / 0.461 | 0.662 / 0.652 | call 1  |

**Two softer forms were built and measured, and both were rejected.** A
tolerance of 0.25 is cheap in the population and leaves the reported joint at
0.605 against 0.826, which nobody would call equal. Bounding each segment by how
lopsided the DRAWING had it — the same stand-down the curvature bound uses —
leaves it at 0.651 against 0.739, better than it was drawn and still not what
the tick says. The bound is flat, so the tick means the same thing on every
drawing.

**The stated cost, over 1500 random joints.** Nothing changes with the tick off.
With it on, the median curvature step rises from 2.69e-2 to 3.13e-2 under G2 and
from 3.12e-2 to 3.99e-2 under G3, and the joints left both over the perceptual
bound and worse than drawn rise from 212 to 235 and from 251 to 327. That is the
price of the tick doing what it says, and it is paid only by the presses that
ask for it.

**Exact equality and an exact joint cannot both hold in general**, and it is
worth saying why rather than chasing it again. Balancing a segment sets the
ratio of its two handles; harmonizing sets the inner one. They are the same
number. What the ranking can do, and now does, is refuse the answers that are
not even close.

### The repetition was not repeating, and the balance rank is what stopped it

`B^1.json` point 3 redrawn again, with equalization and realign on: one press
left the left segment at 0.535 against 1.000, the inner handle pinned on the
tension ceiling and the joint still 137 per cent out. **Raising `pressAttempts`
to any value changed nothing**, which is the tell — the loop was stopping on its
first attempt.

The loop chose which state to carry on from by ranking the answers, and a
drawing the balance has just prepared is perfectly balanced. So the
handle-length solve **refusing to move** outranked the joint construction's real
answer on the balance rank added the round before. The loop then carried on from
a state it had already seen, saw its own starting point come round, and stopped.

**Where to look next and which answer to keep are different questions.** The
whole field is ranked at the end. The walk goes through the joint construction's
answer, always. Self-inflicted, one round old, and invisible to every test:
2003 of them passed while the loop ran once.

The joint needs several rounds because of the ceiling, not because of the
ranking. As drawn it is a radius of 4.3 against 787.5. The first solve wants an
inner handle longer than the tangent crossing allows, clamps at tension 1 and
stops; the balance then lengthens the outer handle, which gives the next solve
room. Three rounds of that reach the answer, and they now happen inside one
press: 0.736/0.754 and 0.471/0.500, 1.20 per cent across the joint.

The population improves with it: over 1500 random joints the joints left both
over the perceptual bound and worse than drawn fall from 235 to 223 under G2 and
from 327 to 257 under G3, and the median G3 step from 3.99e-2 to 3.42e-2.

**Known gap, honestly reported.** Under G3 this joint is refused outright:
`skipped`, reason `reverted`, leaving the balanced drawing at 189 per cent. The
G2 fallback answer is tension-limited, and under G3 the rate term ranks it below
the drawing, so the inner gate reverts it before the outer field ever sees it —
and with every field member then carrying the same bad step, the curvature
ratchet takes that step as its own bound and stops forbidding anything. G2
reaches 1.20 per cent on the same joint. Letting the outer field see the inner
gate's discards is the fix, and it is not a small one.

### The two-press flip, and the candidate that was missing all along

Reported: G3 with the on-curve move on still took several presses. Traced on
`j` point 3 with the balance on, and it is a clean period-two cycle — the joint
alternates between x = 260 and x = 190, seventy units apart, **with identical
curvature and identical rate to every digit printed**. Two mirror answers, both
harmonic, both balanced, and each press took the other one.

The cause is the hole this loop has had since it was built: **the state a press
keeps is not a candidate of the next press.** Every press prepares the drawing
before it does anything, so what the designer is looking at was never on the
table. From 260 the field held 190 and not 260, so 190 won; from 190 it held 260. For ever.

The drawing exactly as handed is a candidate now, beside the prepared one.
Every combination on both reported glyphs settles on the first press.

**It was built and reverted once before**, when the balance ran inside the gate:
back then the arriving drawing reverted the balance and the tick did nothing at
all. What makes it safe now is everything added since — a crease, an unbalanced
segment and a curvature step all rank above the curve, so the drawing has to be
better by the measures that matter, not merely flatter.

**Ranks needed a tie tolerance.** The two flip states agreed on the residual to
every printed digit and differed in the twelfth, and the comparison was exact,
so dust settled which was kept — differently each press, because the drawing it
measured had moved by a rounding step in between. Ranks tie within a relative
1e-9 now, and a last rank breaks what is left: how far the answer moved the
drawing. Two answers that are equally good are not equally welcome.

**The reverted preparation pass shows up in exactly one place**, and it is a
configuration no press uses: with the solver switched off entirely, the gate can
prefer the drawing to a realigned joint, because straightening a joint inside
the grid's own allowance buys nothing the score reads. The test that covered it
reads the pass directly now rather than through a whole press.

**One report fault came with it, and it silenced six tests at once.** The
fallback report was `field[1]`, which had been the first solved answer and was
now the arriving drawing, whose report is null. Six tests reported an empty
report and failed on the entry that was not there.

Over 1500 random joints, against the previous round:

|                                 | 2nd call moves | 2nd call worse | over 3% and worse than drawn |
| ------------------------------- | -------------- | -------------- | ---------------------------- |
| G2 + equalize                   | 1050 → **615** | 579 → **252**  | 223 → 201                    |
| G3 + equalize + realign         | 863 → **371**  | 476 → **122**  | 257 → 239                    |
| G3 + slide + equalize + realign | —              | —              | **19**, median step 1.03e-2  |

Both stability and quality improved, which is the sign that the candidate was
missing rather than that a trade was made.

### Realign, and what it is actually worth

The pass squares a smooth joint up before anything is solved. mekkablue's rule,
carried unchanged: a handle running dead horizontal or vertical off the joint
is kept and the other is turned onto it, otherwise both handles hold and the
joint comes to them, and where a curve meets a straight the straight states the
direction.

**The obvious argument for it is wrong, and the measurement said so.** The
reasoning was that a joint arriving bent is solved against a tangent that is
not there. It is not: every construction here re-collinearizes the joint itself
as a side effect. Under G2 the two handles translate by one delta, so the line
through them translates with them and the joint lands on it whatever the bias
is. Two tests written from that reasoning failed against a joint that came out
straight to 6e-15 without the pass.

What the pass is actually worth is two things.

1. **It keeps a flat handle flat.** Harmonize's own repair translates both
   handles, which carries a horizontal handle off the horizontal and the
   extreme of the curve off the joint. On the bent fixture the outgoing handle
   lands at y = 104.955 without the pass and at 100 with it.
2. **It reaches joints harmonize refuses.** A curve running into a straight has
   no five-point stencil, so the command declines it outright. Nothing else in
   the tree ever squares one up.

It is a fifth checkbox, off by default, so no existing press changes.

### Rejected

| Idea                                                          | Why it went                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bias slider between moving the joint and moving the handles | The values between its two ends were never asked for. Checkboxes replace it: one picks the target and so the cascade, one says whether the joint may move, one swaps the construction outright.                                                                   |
| Freezing each joint's tangent from the arriving drawing       | On a ring the tangent legitimately rotates as neighbours move, so a frozen axis is a stale one and the coupled-ring fixtures stopped converging. The drift it was aimed at was the grid search buying bends, not the construction drifting.                       |
| The on-curve slide as a fallback for a failed held solve      | Holding the joint still almost never fails, so the option did nothing on any healthy joint - G3 with it on and off produced byte-identical output. It is opt-in, so when it is on it is the whole search.                                                         |
| Bound the on-curve slide's range by the inner handles         | They are what the construction replaces, so their present lengths say nothing about where the joint may go. It stopped the search 25 units short on the overshoot fixture, where the first admissible slide is about 45 units and the shorter inner handle is 20. |
| Harmonize the generated outline                               | It is derived and would be thrown away on the next regeneration. The skeleton's own centerline is an ordinary path and takes the pass unchanged.                                                                                                                  |
| Pick the balanced fraction by the curve's midpoint alone      | Built, dropped the same hour. It is the Bezier Fixer rule, and it has a closed form rather than the donor's sweep. One sample is not the curve: least squares over the whole segment beats it on every fixture measured, and is the same shape of answer.         |

---

## Serif terminal (map F7, skeleton)

**State: built, backlog retired.** Eleven rounds. The terminal draws, the presets
carry it between glyphs, and the cup has a balance. Suite 1,805 at the last serif
change.

### The ground rule, and what it costs

Seven on-curve points at every parameter value, coincident where a point has
nowhere to go. This is what keeps a serifed terminal interpolable against a plain
one and a one-wing terminal against a two-wing one. It was tested directly at a
wingless half, at zero thickness and at zero cup, not inferred from the shape.

A half with no wing must add nothing, and two separate leaks broke that. The
shared straight run pushed a spur outside the stroke. The hollow dimpled the foot
line by half a unit, by bending toward a corner that had collapsed onto the tip.

The ground rule also cost the smooth-release guarantee its unconditional form.
The minimum-separation clamps came out with the one-attractor rework, so a handle
can now reach zero, and at zero the release is a corner. Correct under the ground
rule. `FEATURE-MODEL.md` section 5 still states the guarantee unconditionally,
which is now false. One clamp survives, the 15-degree axis-tangent separation,
waiting on the axis item.

### Faults that came back

**The pin moved the release.** Before, the release and the straight run's bottom
travelled 25.7 and 22.4 units across the curvature range. After, total on-curve
travel over 400 steps was 0.000000 and the join held at 0.0000 degrees. The
stated cost: the wall bends back to meet the terminal, 2.6 units on the reported
glyph and up to about 32 at the bottom of the curvature range.

The reasoning that said the coupling was unavoidable — the release is found on
the wall, so anything that reshapes the wall moves it — was wrong, and the
designer caught it. The pin is applied when the wall is solved and the cut is
taken afterwards. Move the cut ahead of the authoring and the release is immune.
**Two things are coupled by the order they run in, not by their geometry, until
you check which runs first.**

The pin nonetheless goes **last** among the placements: natural answer, attached
adjustments, detached placement, pin. The gizmo measures the drawn curve and
writes a pin, and a placement that runs after it overwrites it, so the measured
number cannot be reproduced. A round-trip test caught the reversed order.

**The gizmo read the trimmed segment.** It reported 0.7487 where the stroke's own
value was 0.8725, and typing the displayed number moved handles by 9.0 and 7.8
units. The same defect is present on round caps at 0.0002 — four orders of
magnitude apart, which is why it survived so long.

**A drag consulted the panel's link flag.** Fixed; no test changed.

**The transition was not tangent at any ordinary setting**, 10 to 37 degrees off,
and nobody reported it. It came out while a different report about the release
point's smooth flag was checked.

**Detached placement ran after the pin and overwrote it**, so a pin on a segment
that carried a detached handle did nothing to that handle. Both kinds of
adjustment place a handle; the pin states what the tension is, so the pin runs
last.

### The wall is a curve, not a line

Reported on `_external/b.json`: one cubic skeleton segment with a serif, where
moving tip thickness reshaped the whole stem. The terminal built itself on a
straight line that ran from the rib end along the endpoint tangent. On a curved
stem the real wall departs from that line, and by more the deeper you go. The
generator cut the real wall at the release depth, dragged the cut end sideways
and turned the surviving handle onto the tangent. Both corrections grow with
depth, on a segment whose two handles shape the whole curve.

Greatest distance from the emitted stem wall to the wall emitted with no tip:

| tip thickness | before | after |
| ------------- | ------ | ----- |
| 0             | 0.5    | 0.00  |
| 20            | 2.6    | 0.05  |
| 63            | 11.2   | 0.05  |
| 100           | 22.8   | 0.06  |

The construction curve's control point never moved through the sweep. That proved
the offset solver innocent and put the fault in the splice.

Two stored numbers changed meaning and shift once on reopen. A curvature pin on a
serifed terminal now describes the emitted piece rather than the whole solved
wall. Wing slope is now the incline of the wing's top surface rather than a rise
on the assumed line. The two agree on a straight stem, which is why no fixture
moved.

**Deleting the anchoring took the surviving handle's axis with it**, and three
tests went quiet rather than loud. The handle at a cut is tangent to the curve
there, so its own direction is the axis. That is a true statement where the old
one was fabricated. The honest axis has less headroom: a drag that used to reach
30 units stops at 23, because the ceiling is where the segment's two handles
would cross, and the true tangent puts that crossing nearer. The clamp was always
there; the old axis pointed somewhere the curve does not go.

**A one-unit floor on the cut is right for a round cap and wrong for a serif.** A
round cap builds its tip from the direction the leftover piece gives it, so it
needs a piece. A serif reads no direction off it and can release at the rib end,
which is legal under the ground rule. The floor moved an on-curve point that
nobody asked to move, and a fully collapsed serif on a straight stem drifted a
unit.

### Handles on a serifed terminal

Three faults reported as one, measured against a plain cap on identical input,
which is the oracle.

| fault                                                              | before                                               | after                     |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------- |
| the trim rebuilt off-curves bare and lost the constructed axis     | neighbour swings 14.7 units on a width change        | 0.00, same as a plain cap |
| the offset was authored on the parent curve, consumed on the slice | drag arrives fractional, leaks 3.9 units             | one-for-one, leaks 0.01   |
| a prior fix took the cut off the chord instead of the edge         | serif moves 14 units on a mild curve, 74 on a strong | reverted, 0               |

**The oracle was worth building before the fix.** A width sweep of serif against
plain cap first returned zero for both and looked like it disproved the
hypothesis. With no stored offset the two joint handles are already colinear, so
the inferred direction agrees by accident. Only a probe that carries an actual
offset separates them, and two of the three faults were invisible until then.

**The symptom was honest geometry.** While the emitted segment is a slice of a
constructed curve, a neighbour that moves is correct. The defect was a control
handed to the designer on the slice while the write landed on the parent.

### Where each bound was written

Four reported defects with one thing in common: the code did the right thing in
one place and a different thing in another, and the two were never compared.

A serif drew a wing on the dead side of a single-sided stroke, twenty units past
the skeleton, because it built both wings from its own numbers where every other
cap honours the collapse. The collapsed half resolves to zeros now, and still
emits all of its points.

Contour easing grew at two different rates and stopped at one. The rounding is
one curve across the corner. Both ends step back by the ease distance, one along
the stem wall in units, one along the bracket **as a curve parameter** — a
different quantity in a different unit. Only the bracket end had a bound, so only
it ever stopped. Both ends are found by distance now, by bisection. The reported
fix was "clamp both at the wing's corner"; that corner sits inside the serif and
the wall end travels the other way, so it would have stopped the wall end at
twice the reach. The end of the bracket is the only bound that reads as one
corner from both ends. That was said, rather than substituted quietly.

**The same ceiling, written in three wrong places.** A bound on the scrub missed
the typed field and the preset. A bound in the writer is correct and is where the
bound lives now, and the symptom did not change — because the value was already
clamped and the input box was showing something else. The panel refuses to write
back into the field the user just touched, so that an arrow-key run is not
interrupted, and that refusal was still on when the end-of-drag refresh ran. **Two
rounds were spent on the model because the report said the value was wrong.** It
was not. A panel that can show a number the model rejected makes a correct fix
look like no fix at all.

### Presets

Twenty numbers and a flag per terminal. A preset is **one wing plus the underside
cup**, ten numbers, written to both sides on apply, because asymmetry is a
decision about the terminal being edited rather than about the shape that was
saved.

Two older things blocked it. A serif field could be **unset**, and unset resolved
through a table that was not all zeros (tension 0.7, concavity 0.8, ease
curvature 0.5), so a stored "unset" meant something different from a stored
number on three fields, invisibly. And a fresh serif drew nothing, because its
three size fields defaulted to zero. Unset stopped existing, and the default
shape moved out of a fallback table into a write applied the moment a terminal
becomes a serif.

Five built-ins ported from the serif lab, which draws at stem width 150, so
lengths divide by 7.5 onto the 20-unit scale while the tip cut angle and the two
bracket ratios carry across untouched:

|           | wing | tip | slope | cut | cup | reach | tension | concavity |
| --------- | ---- | --- | ----- | --- | --- | ----- | ------- | --------- |
| Egyptian  | 20   | 20  | 20    | 0   | 0   | 0     | 0       | 0         |
| Clarendon | 18   | 10  | 1     | 0   | 0   | 19    | 0.9     | 0.85      |
| Didone    | 19   | 3   | 0     | 0   | 0   | 13    | 0.7     | 0.8       |
| Old style | 15   | 5   | 7     | 22  | 3   | 20    | 0.62    | 0.66      |
| Wedge     | 13   | 2   | 13    | 0   | 0   | 5     | 0.05    | −0.18     |

**The seed never fired once.** It tested whether the point held serif data, and
point normalization materializes a serif block on every on-curve point in the
file. The block is always there, so the test could not pass, and every terminal
switched to serif came up with no size and a bracket out of nowhere. The
condition is gone: to pick serif applies the default, unconditionally.

**Protection of existing shapes cost the rule that was asked for.** The stated
rule was "20-20-20 and all zeroes from down there". It was built with tension
migrated to 0.7 and concavity to 0.8, so that nothing already drawn would move —
a guarantee that was never requested, and exactly what the unseeded terminals
were displaying. It had to be reported wrong twice before it came out. **A stated
requirement softened to fit the existing design is still a requirement missed.**

**The inherit chain had a level nothing could write.** A contour can hold its own
serif block; three readers fell through to it, and no code ever set one. Removed.
The contour cap style has the same shape, read by the generator and written by
nothing, and is left alone as cap work.

**The migration table and the seed were close enough to confuse.** They agree on
six fields and differ on three, and the field writer reached for the wrong one,
so an emptied tension box put 0.7 straight back in.

### The cup

The lowest point of the underside cup sat on the skeleton endpoint. Under
single-sided mode the terminal stands entirely on one side of the skeleton, so
that point landed on the foot's edge rather than its middle, and the foot read as
a lopsided scoop. The centre is the midpoint of the two tip bottoms now, which
are the two ends of the cup curve itself. One line, no single-sided branch: a
collapsed half puts its tip on its own wall, so the case falls out. The
alternative offered was the middle of the two stem walls, which equals the
skeleton whenever the widths match. The designer chose the foot.

Contact height over a stem that leans to 30 degrees, old rule / new rule, in the
perpendicular axis mode:

| wings              | 0 deg       | 10 deg      | 20 deg      | 30 deg      |
| ------------------ | ----------- | ----------- | ----------- | ----------- |
| 60/60              | 18.0 / 18.0 | 17.7 / 17.7 | 16.9 / 16.9 | 15.6 / 15.6 |
| 20/120             | 18.0 / 18.0 | 17.7 / 26.4 | 16.9 / 34.0 | 15.6 / 40.6 |
| one half collapsed | 18.0 / 18.0 | 17.7 / 12.5 | 16.9 / 6.7  | 15.6 / 0.6  |

Under a flat foot every row is identical before and after, at every tilt, and
that is arithmetic rather than luck: the centre only slides along the axis, and
an axis with no rise cannot carry the contact point off the alignment zone. The
guarantee survives in the modes that exist to provide it.

The balance number that followed is a **fraction of the half-span between the
tips**, not a distance, so it reads the same on a narrow serif and a wide one,
the units mode never touches it, and a preset carries it between masters
unchanged. Zero is the midpoint. Plus or minus one lands on a tip, where one half
of the sweep collapses to nothing — legal under the ground rule, and the point
count holds. The alternative offered was a signed distance in units, which would
have joined the length fields and changed meaning with the wing size.

**The first sweep measured nothing and looked like it measured everything.** It
rotated the axis toward the stroke instead of leaning the stroke under a fixed
axis, so most of what it reported was the 15-degree separation clamp that pushed
the axis back off the tangent. The question was about a leaning stem, so the stem
is what has to move. Sweep design decides the answer.

### The serif ties the straight it sits on

A straight already tied the ribs at its two ends when either end was a
straight-controlled smooth point. A serif terminal qualifies a straight the same
way, so the coupling arrives through the rule that already existed rather than
beside it, with no editor change at all. Attached to a **straight** is the whole
condition: a serif on a curve has no flat wall behind it and ties nothing.

The first pass was a separate width override, with the gizmos taken off the
outline. Widths are resolved in one place and read back by rendering and
hit-testing through the same lookup, so an override the editor knew nothing about
drew a correct outline under handles that had stopped describing it. The same
result through the existing rule made the editor side disappear, which is the
argument for rail R-B, demonstrated rather than asserted.

**The condition was wrong twice before it was right.** First "the neighbour is a
corner where the stem turns", which describes nothing real. Then "the neighbour
is non-smooth", which fires on a neighbour that is non-smooth only because its
own segment carries handles. Neither wrong version would have failed a test
written from it.

Cap geometry was reading stored half widths rather than resolved ones, so a cap
on a tied endpoint sat off the end of the stroke it caps. Nothing could reach it
before, because an endpoint could not be tied.

### Two panel mechanics that came out of serif work

**Every scrub field carries a multiply**, with the ratio in steps of 0.1, and the
button shows where that field's number lands rather than the ratio: 1.1 says
nothing about where a 40 goes, 44 does. It is applied per point, so a mixed
selection grows each point from its own value.

**Right-click abandons a drag.** Zero is a legal thing to drag to, so a cancel
cannot be one. The stream carries a frozen sentinel instead, which no amount of
dragging produces by accident. Its cost is that every consumer that drains a
value stream must refuse it, including two upstream panels that share the slider
and know nothing about this.

### Fixture gaps, stated as gaps

The golden fixtures moved for none of the geometry changes above. They carry no
case with a non-zero ease distance, none with a pin and a detached handle on one
segment, and none with an asymmetric terminal. A suite that passes is not
evidence for these changes. The direct measurements are.

### Faults chased in the wrong order

Two smaller real defects were blamed before the real cause of one report: a
half-unit tolerance in the split bisection, and integer grid snapping on edge
handles that moved the release in steps up to 0.91 units, reversing at every
snap. Both real, neither the subject. **Take a reported symptom literally instead
of matching it to the nearest defect in hand.**

### Left alone deliberately

`shiftTensionsToMean` treats a pin of exactly 0 as "no pin". It is in every
curvature pin's code path, so it stays. Architecture map section 7, residue 4.

### Reverted

`7055e87cd`, which made the terminal read its release off the cut in the emitted
edge.

### Every point a serif emits carries a guessed origin

There is no side, and the owner is picked by a count of position along the
contour, so one serifed stem produces a dozen points that claim to be the same
handle of the same skeleton point. Nothing reads them, because every lookup needs
a real side. Backlog item.

---

## The offset construction (map F7, skeleton)

**State: settled.** Nine rounds. The generated outline is now one continuous
solve. Read this section in order — the sequence is the lesson, because four
reworks each removed the previous one's machinery.

### What it must do, and why continuity is the requirement

The generated contour is rebuilt every frame while the designer drags. Each
frame's output can be geometrically sound and the drag still unusable, because
the output was not continuous in the input: one unit of skeleton movement flipped
the handles into a different configuration that fitted the curve just as well and
looked nothing like the frame before. Worst exactly where it matters, when the
distance between skeleton points is small against the rib width.

So the requirement is continuity in the input, and every rework below is a step
toward it. Accuracy against the true offset is the thing that gets traded.

### Round 1: closed form instead of sampling and fitting

Offsetting a cubic preserves the tangent direction exactly and scales its speed
by `1 + width × curvature`. For one cubic per side the endpoints and the
directions are therefore known, and the only free numbers are two handle lengths.
The rule a designer can hold: **the generated handle is the skeleton handle
scaled by one plus width times curvature.**

Handle direction stays locked to the skeleton's. Seven discrete decisions came
out of the pipeline with this: an adaptive error-threshold loop, variable curve
splitting, a Newton iteration with an early bail, an eight-direction snap for
short handles, and the average-width-then-translate hack for tapered sides.

Locking the direction is what bounded the one-time output change. Endpoints do
not move and directions do not move, so mid-segment deviation landed inside the
range the old fit already tolerated: 1 to 3 units on a 60-unit stroke, zero at
the ends. Had the handles been tilted to the true offset tangent instead, the
same change would have moved handle points by tens of units on tapered strokes.

**The fixture script could not be run at all.** It imported the pre-port
generator from a path that resolves to a directory that does not exist, in a
gitignored checkout, at a commit that is not an object in this repo. The golden
masters could not be regenerated by anyone, from a fresh clone, or in CI. Fixed
before any geometry changed, and proved by a byte-identical regeneration.

**Two smoothing forms that look inert are not.** A square-root cusp floor shifts
its input by a small constant, and that shift is then multiplied by the handle
length: 0.022 units on a 55-unit handle, growing with the handle, so no fixed
test tolerance survives it. A p-norm smooth minimum returns 84 percent of its
argument when both arguments are equal — a 16 percent shortfall even where the
bound does not bind. A polynomial form is _exactly_ the min or the max outside
its blend window, which is what makes "no saturation on ordinary input" an exact
invariant instead of an approximate one. Mixing an exactly-inert form with a
never-inert one produced a miscalculation in the first draft.

**The tangent-ray bound needed a floor for an ordinary reason.** The intersection
slides backwards onto the start point whenever a start tangent points near the
far endpoint, not only past a 180-degree turn as first assumed. Measured on an
ordinary curve: the handle squeezed to 0.6 units, then sprang back 41.9. Floored
at a third of the chord, which is the handle length of a neutral cubic and
therefore means something.

**An error function was compared against a linear tolerance while it returned a
squared distance**, so the effective tolerance was distorted and scale-dependent.
Part of why the old behaviour differed by glyph size.

### Round 2: the correction pass had the wrong correspondence

The generated contour came out too eager to collapse to the minimum or the
maximum handle length. The correction assumed the true offset's point at a given
parameter belongs at the generated curve's point at the same parameter. That is
false for an offset, which is stretched on the convex side and compressed on the
concave one, so the correction either did nothing or asked for **negative**
handle lengths, which the bounds turned into the collapse. Reparameterizing fixed
it: mean error 3.11 to 0.89 against an achievable 0.67, hard pinning 2 of 118
rather than 2, arcs unchanged.

**A synthetic sweep produced wrong conclusions and was thrown away.** It
parameterized by handle length as a fraction of chord, which invents skeletons
nobody would draw: a 0.55-chord handle on a 20-degree turn is already past
tension 1. It supported a claim that the accuracy optimum wants tension 4 to 5.
Re-parameterized by tension directly, over geometry a designer would draw, the
optimum never asks for more than 1.04. **Sweep design decided the answer here,
twice.**

**The clamp was not the disease.** The instrumentation counted any touch inside a
smooth blend window rather than hard pinning, and read 34 percent of cases where
the true figure was 2 in 118 — while the pipeline still carried 4.6 times the
achievable error where nothing clamped at all.

**Some geometry a single cubic cannot represent**: a bold stroke on a tight
curve, 31 of 149 realistic cases, with errors in the hundreds for every strategy
including a numerical optimum, and point-count stability that forbids a split.
That is the strongest argument for a designer-facing control, which is what the
curvature gizmo became.

### Withdrawn on measurement, so they are not re-derived

- **A harmonize pass over the generated contour.** The generated contour already
  reproduces the true offset's joint curvature to 1.7 percent, and the mismatches
  that remain are the skeleton's own, faithfully reproduced. Harmonizing would
  erase a curvature the designer asked for.
- **Unconditional equalization.** A no-op where it is safe, a 3.3 times fidelity
  loss where it is not.
- **Tilting the handle axis to the true offset tangent.** It would recover almost
  all of the taper defect, and it is rejected because the axis is skeleton-owned.

### Round 3: one handle always sat on a bound

Two skeleton contours identical but for the tension of one curved segment's own
handles — same endpoints, same tangents, same 40 to 114 taper, both equal-tension
to three decimals within themselves. One generated a sound outline; the other's
inner edge cut straight across the bend with its handle on the 1-unit floor.

The collapse was the visible half. Both contours had the same fault: **one
generated handle on a bound in every case**, from a skeleton whose own two
handles were symmetric.

| side        | tensions before | ratio | after         | ratio |
| ----------- | --------------- | ----- | ------------- | ----- |
| low, outer  | 0.403 / 0.993   | 2.46  | 0.447 / 0.740 | 1.66  |
| low, inner  | 0.30 / 0.009    | 33.0  | 0.610 / 0.592 | 1.03  |
| high, outer | 0.60 / 0.97     | 1.62  | 0.626 / 0.889 | 1.42  |
| high, inner | 1.00 / 0.345    | 2.90  | 1.000 / 0.638 | 1.57  |

The asymmetry is born in the seed. `1 + d × κ` is applied per end and the two
ends of a cubic have different curvature, so the two handles are scaled by
different factors — 1.07 and 2.61 here. The band then confined each handle to a
window around **its own** seed, so neither could migrate toward the other. The
equalization stage was the one thing that could have rebalanced the pair, and it
could not: its allowance was an absolute 0.25 units, which is room on a
constant-width segment and nothing on a tapered one, and tapered is exactly where
the fit comes out lopsided; and it judged every candidate split at the fitted
magnitude, so a re-split curve was charged for a scale nobody would pair it with.

**Three wrong diagnoses came first, each disproved by a measurement.** That the
offset was geometrically unrepresentable past the cusp, disproved by rendering
the balanced pair, which produces the waist. That the least squares was
ill-conditioned and sliding along a flat direction, disproved by the normal
matrix at condition number 1.3. That the fit had no information at the dead end,
true of that one end and irrelevant, because the fault was present on the
_healthy_ contour too. The report that settled it was the designer's: both
contours show it, so stop explaining the collapsed one.

**A sweep is the test this class of fault needs.** Holding the segment fixed and
walking its own tension, the generated handle stepped 1, 1, 1, 2, 5, 7, 11, 17,
34 while its partner went 104, 70, 163 — a 33.9-unit jump per unit of skeleton
handle, in the middle of the healthy range where nothing about the skeleton
jumps. No single-configuration assertion would have caught either fault.

### Round 4: a saturated handle dragged its partner backwards

At the step where one generated handle reached the tension ceiling, the other
moved backwards: 90.6 to 59.4 in one step, then back up through 70.4, 91.4,
110.4. Reaching the ceiling is normal there; the partner reversing is not.

The ceiling was applied _after_ the equalization walk, so the walk balanced a
pair that could never be emitted and sized the free handle against a partner
about to be truncated. It now measures every candidate through the same bound the
emitted geometry gets.

**A bounded measurement changes the baseline, not just the answer.** Judging
candidates by the emitted curve was correct and silently made the allowance more
generous, because the allowance is a fraction of that same measurement. Two
golden fixtures caught it. Without them the accuracy loss would have shipped as
"rebalancing". The allowance ratio came down from 25 to 15 percent to pay it
back.

**The first version of the test swept one side and passed while two faults were
live.** When a fault is a property of a sweep, sweep every side and both signs of
the offset.

### Round 5: the feasible box

Two faults survived round 4, reported on a `U`: two straights joined by one
curved segment, both joints straight-controlled, single-sided so the whole width
lands inside the bend. Sweeping in **one** direction the generated handles jumped
and rebounded by 20 units per step while the skeleton handle moved 1.7.

The wider complaint was structural. Every fix since the construction shipped had
added a guard — a correction band, a chord cap, a handle floor, a cusp floor, a
tension ceiling in an eased form and an exact form and an exemption for pins, a
scale band on the magnitude re-solve, a rule about judging a candidate as it will
be emitted, and a null return meaning "this end has no reach, skip the stage".
Every one was a correct answer to a real measurement. Together they were an
incomplete list of exceptions, because none addressed why an infeasible answer
was produced in the first place.

One invariant replaced all of them: **both handle lengths are carried as
tensions, and every stage produces a point inside the feasible box** —
`[1/reach, 1]` on each axis, where tension 1 is the tangent-ray intersection and
the lower face is the one-unit grid floor. `reach` gets a single definition, the
tangent-ray distance floored at a third of the chord and capped at twice it, used
by the seed, the correction, the walk, the hand adjustment, the pin and the
emitted length alike. Because it is finite and positive by construction, a
tension always exists.

**The jitter was the correction loop reparameterizing against a curve that
loops.** Where a cubic cannot represent the offset — and on the reported segment
it cannot, the fit's own deviation running to about 90 units — the least squares
asks for a start handle at 2.4 times its reach and a **negative** end handle. The
band clamped the negative one and left the other free, so the iterate was
self-intersecting, and Newton's root find on a self-intersecting curve is
multivalued: one sample's parameter walked 0.907, 0.200, 0.319, 0.635 across four
passes, and a one-unit skeleton move sent it down a different branch.

**A fixed trip count buys determinism, not continuity.** Fixed count, fixed seed,
no convergence test and no threshold search were all satisfied here and the
output still jumped, because the map being iterated was not continuous in its
input. The box is what makes the iterated map well-behaved. The trip count only
stops the loop from _deciding_ when to stop. Both are required and neither
implies the other.

**The eased ceiling was the root of the three-variant bound.** It existed so the
fit's answer would be C1, but the contract only asks for continuity, and a clamp
is continuous and 1-Lipschitz. Easing cost a few percent of whatever it was
given, which is wrong for a hand-placed length — hence the exact variant — and
wrong for a pin — hence the exemption. One exact ceiling collapses three cases
into one.

**A sweep harness that starts at a degenerate configuration lies.** The first run
of the mode table drove the segment's tension from zero-length skeleton handles
and reported 765- and 625-unit steps in both the old and the new code, all of it
the first step out of the degenerate seed. Re-run from 30 percent of the drawn
handle, the same sweep told the real story. Same lesson as round 2.

### Round 6: the walk was bisecting a plateau

Converting the reported contour to single-sided was quiet and converting it back
to double-sided brought the jumps back, 11 units of generated handle per 1.7 of
skeleton. The toggle was innocent — it writes one flag, and a round trip was
verified byte-identical. Double-sided still jittered on its own, and round 5's
own mode table had said so at 15.00, reported and not chased.

The fault was the metric the walk bisects on. It returned the **max** over five
samples, and a max is exactly flat in whichever handle does not own the current
worst sample, so the walk bisected a plateau and converged on its **edge** — the
amount at which the max changes owner, a kink whose position slides fast when the
two branches run close. Measured: the end tension moved 0.097 to 0.353, more than
tripling one handle, without shifting the max in the fourth decimal, and the
affordable amount stepped 0.984, 0.906, 0.813, 0.750, 0.688 on a smoothly moving
input.

It returns an RMS now. That has a nonzero gradient in both handles everywhere,
and it is the norm the fit itself minimizes, so the walk judges candidates by the
measure that produced the one it started from.

**A bisection is only as continuous as the function under it.** This is the
sharper form of the contract, and round 5's version was not sharp enough.

**The allowance floor is not a free parameter — it is stated in a norm.** An RMS
over five samples is between 0.447 and 1 times the max over the same five, so the
0.25-unit floor restates into 0.11 to 0.25. At 0.25 one accuracy ceiling failed
at 1.043 against 1. At 0.20 every ceiling holds **and** the jitter is the lowest
of the values tried. Values below it were both looser on accuracy and slightly
worse on jitter, which is the sign of a real optimum rather than a fudge.

Worst single-step movement of any generated point over the reported glyph, 200
steps — original, after the box, after the RMS:

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

**One self-inflicted detour.** A checkout of the source file, run to strip debug
instrumentation, silently discarded the uncommitted fix with it. Check what a
revert actually reverted when the fix is not yet committed.

### Round 7: one continuous solve, and the accuracy that paid for it

The boxed five-stage construction was deterministic and still not continuous. Its
fixed correction loop rematched samples to the candidate cubic and its split walk
selected the last candidate inside an error allowance, and both could change
branch while the skeleton moved smoothly. On a fixed tension sweep the automatic
path reached a 3.139-unit step on one side, backtracked 1.433 on another, and
reached 4.775 with 2.077 of backtracking on a third.

The natural handle solver now builds **one quadratic** from five fixed
source-parameter offset samples. It minimizes perpendicular error in normalized
tension space together with a pull toward the skeleton's own tension, inside the
positive non-crossing rectangle, and the answer is the best interior, edge or
corner point on one strictly convex objective. The correction loop, the split
bisection, the candidate magnitude re-solve and their tests were deleted. What
remains around it is only orchestration: natural answer, attached grid
adjustment, pinned harmonic-mean tension, detached absolute handle.

Four global constants, the same for every glyph, side and fixture: pull floor
0.001, cusp gain 0.005, taper gain 1, cusp gate 0.05. This is the
lexicographically first passing tuple. Taper gains of 0.05, 0.1, 0.2 and 0.5
failed at every cusp gate tried, with the backtrack shrinking monotonically —
1.314, 0.747, 0.198, 0.110 — which is what identified the gain as the right knob.

Final sweep, zero backtracking on every side: worst adjacent step 2.174 and 2.251
single-sided, 2.478 and 2.704 double-sided.

**The accuracy ledger, stated rather than hidden in regenerated fixtures.** Four
cases improved, six lost, one unchanged; the summed change over eleven maximum
deviations is +17.83 units, with the strong left taper the worst single loss at
+14.27. The seven inherited constant-width ceilings all stay green. Taper
deliberately has no implementation-derived ceiling: skeleton-owned handle axes
cannot reproduce the true tapered-offset tangents, and the stronger pull is what
removes the backtracking.

**A cusp-only predictor could not satisfy both accuracy and continuity**, because
the reported taper case stays healthy by the cusp factor. It needed a separate
input-only taper signal. **One shared cusp-and-taper strength also could not
pass**: enough shared authority to stabilize the tapered side made the inward
near-cusp transition too steep. Two independent global gains keep one
deterministic model without coupling the two failure modes.

**The first fixture-review rule was too strict for split-outline round caps.**
Those caps compute trim points and tangents from the terminal side cubic, so
changing the cubic must move those derived on-curves and cap controls. The
correct preservation boundary is topology, provenance and cap inputs, not frozen
derived coordinates.

### Round 8: stabilized reach was mistaken for the geometric ceiling

The handle domain used one number for two jobs: a stable scale for normalized
tension, and the maximum non-crossing length. A short positive tangent reach was
floored to a third of the chord, so a solver answer at tension 1 could be almost
twice the real reach — individual tensions of 1.002 / 1.993 and 0.837 / 1.473 on
the reported file.

The domain keeps the floored and capped reach as the quadratic's stable
coordinate scale. For a real positive forward reach below that scale, the per-end
maximum becomes the real reach divided by the scale reach, so multiplying the two
lands exactly on the true intersection. The minimum is capped by the maximum, so
non-crossing wins where a real reach is shorter than the one-unit floor. Parallel
and behind intersections keep the chord-cap fallback, because they have no
forward crossing ceiling.

Regenerated, the harmonic segment tensions are 0.9995, 0.8198, 0.9817 and 0.7752.
The only individual values still above 1 are 1.0024 and 1.0044, both from final
integer-grid emission at the boundary. Grid rounding was deliberately left
unchanged.

Separately, the label reader called the tension calculation with its first
on-curve and control point reversed, and displayed 3.968, 1.389, 2.291 and 1.266
for four segments whose correctly ordered means were 1.334, 0.820, 1.068 and
0.775.

### Round 9: a nudged handle was measured and bounded on a curve nobody was looking at

Reported on `_external/k.json`, at the smooth point where the diagonal meets the
stem. Two faults with one origin: the generator applies two emission
displacements after the construction is finished, one on the on-curve and one on
its handles.

**The curvature gizmo jumped.** Grabbing it and releasing without moving moved
the two handles 29 and 30 units. The reader that recovers construction space
subtracted the on-curve's displacement, which provenance published, and could not
subtract the handle's, which nothing published. So it measured an end from one
curve and a handle from another, wrote that as a pin, and the generator
reproduced the pin on the real construction.

**The handle on the other side would not move**, refusing every offset in full,
0 honored of 5 asked at every value from 5 to 60. The ceiling is the forward
tangent intersection of the constructed curve, which sits 0.76 units from the rib
end there, so the window closed completely and the floor equalled the ceiling.
The curve the designer was dragging is not that one: its on-curve had been nudged
51 units back along the same tangent, which leaves the drawn intersection where
it was and the drawn end 51 units further from it.

The handle publishes its own slide now, the way the on-curve always has, and both
come off together when construction space is recovered. The slide also comes off
the ceiling, which is a statement about the drawn curve: forwards it takes room
away, which is what stops an untouched segment rendering past its own crossing,
and backwards it gives room back. The on-curve nudge does not enter it and
cancels by arithmetic.

That left one number doing two jobs again, so the domain carries two: the
ceiling, which moves with the slide, and the intersection tension, which is where
tension 1 sits on the curve the generator solved and is the unit the gizmo reads
and writes in.

| segment            | zero-delta grab before | after |
| ------------------ | ---------------------- | ----- |
| left of the point  | 30.00                  | 0.00  |
| right of the point | 1.00                   | 0.00  |

**The two faults measured as one and were not.** Zeroing the handle nudge made
the first disappear exactly and left the second untouched; zeroing the on-curve
nudge as well left the second untouched again. That pair of measurements
separated a reader fault from a bounds fault before either was touched.

**Rescaling the pin by the ceiling was built and reverted inside the hour.** It
is the obvious way to keep one number, and it made the jump worse: the zero-delta
grab went from 0.00 back to 16 units, because the stored number then meant
something different on every nudged segment. Two jobs, two numbers, stated for
the third time in this section.

**The backwards direction is still conservative.** The ceiling is capped at
tension 1 on a scale itself capped at twice the chord, so a backwards slide
recovers room only where the real intersection sits below that scale — the frozen
case, which is why the fix does what was asked. On ordinary geometry a slid
handle stops short of its drawn crossing rather than at it. Left alone, because
the handle moves, which was the complaint.

### The limit that remains

One segment on the reported glyph reports no tension at all at the far end of its
range, because its drawn handles pass the crossing and the reader declines to
invent a number rather than report one above the ceiling. It offsets 54 units on
a bend tight enough that one cubic cannot hold it. That is the same limit round 2
measured at 31 of 149 realistic cases, and it is why the curvature gizmo exists.

The residual 16- and 10-unit steps under a width drag land where `1 + d × κ`
crosses zero. The offset genuinely cusps there and the handle genuinely
collapses. That is not jitter.

### Fixture gaps in this area

The corpus carries no handle nudge at all, so it cannot see round 9. No golden
fixture moved for it, which is a gap rather than a result.

---

## Rib and skeleton editing (map F7, skeleton)

**State: settled.** Nine rounds of editor and model work around the centerline
itself: what a rib is worth, who may write it, and what the skeleton pen can do.

### The rule the width distribution is stated in

Three writers held two rules. A rib drag on canvas applied the same delta to both
ribs, so a point at 60/0 answered a drag of 10 with 70/10 — a distribution of 75
where the designer had set 100. The panel honoured the distribution instead.

**Preserving the difference between the two sides is not preserving the
distribution. Preserving the SHARE is.** A linked write that names one side
states a total through that side's share, which is the panel's total-width write
reached through one side. Unlinked, the two sides are independent and the write
states one side. One function carries the rule and all three entry points go
through it: the rib gizmo, the panel's left and right boxes, and the label scrubs
on both.

The same-delta rule survives for exactly one caller, the fixed-rib drag, where it
is the right statement, because there one edge is held while the point follows
the cursor.

A side holding zero has no share, so it cannot state a total. That rib is pinned
on the centerline and the drag refuses; only the distribution or the total lifts
it off. This was the designer's decision when asked.

**A comment claimed the rule the code did not implement.** The shared per-side
writer said it preserved the distribution and preserved the difference.

**The first fix touched the canvas path alone**, on the reasoning that changing
the panel's per-side meaning was more than the report asked. That was wrong: the
report asked for the two to agree, and one rule in one place is the only way they
cannot drift apart again. The designer said so.

### Ribs tied across a straight

A smooth skeleton point with a single handle has no direction of its own, because
smoothness forces the handle collinear with the straight on its other side, so
the straight owns the direction. But the ribs at the two ends of that straight
sat at independent offsets, which tilts the generated rib-to-rib line away from
the skeleton straight, and the generated handle was then re-collinearized against
the tilted line. Changing a rib width therefore rotated handles: 8.5 degrees over
a half-width sweep with both ends controlled, about 16 with one.

Separately the smoothing pass estimated its axis from handle **lengths**, and rib
width sets handle length, so width rotated the axis there too — 1.1 degrees mean
and 12.5 worst per single unit of width.

The junction axis comes from the skeleton now: when both handles descend from the
same skeleton point they carry the axis they were constructed on. And the ribs at
both ends of a straight controlled by a tension point are tied to one shared
offset, so the whole projected straight moves as a unit. Tied groups merge where
straights share an end point, because a shared point has one rib and cannot sit
at two offsets. A "Tied ribs" opt-out is on by default, and untying deliberately
brings the rotation back in exchange for independent widths.

**Deriving a direction from rounded coordinates inherits a width dependence.** A
handle emitted at the rounded anchor plus axis times length carries its axis only
to within about the arctangent of 0.7 over the length: 1.3 degrees at 32 units, 4
at 10, 45 at 1. Any later stage that re-derives a direction from emitted points
is therefore length-dependent, and width sets the length. That is the general
trap behind both faults here.

**The first coupling rule was too narrow.** Tying only _pairs_ of controlled
points missed the common case: one tension point anywhere on a straight ties the
ribs at both of its ends, and the far end does not have to be controlled itself.
An ordinary corner or a contour terminal is tied just the same, because what
forces the coupling is the controlled point, not the pair.

**Skipping the coupled accessor in the gizmo produced the original report** — the
dragged gizmo travelled twice as far as the outline and its partner did not move
at all. Coupling that only the generator knows about is worse than no coupling.

**One residual tilt was measured and deliberately left.** At a corner far end the
miter normal is the straight's normal rotated by a quarter of the turn, which
leaves a second-order term of twice the half-width times the square of the sine
of a quarter turn: 0.4 units at the widest end of the sweep, under the 0.3
degrees the grid itself imposes on a handle that long.

### The fixed-rib drag

Three faults. **Single-sided drags rewrote the width distribution**: a
single-sided contour renders the sum of its two half-widths on the visible side,
so the split is nothing the drag should touch, but it wrote one side and left the
other. That split is what the point returns to when the contour goes back to
double-sided, so the drag was changing a shape the designer cannot see while they
work. Single-sided drags write the **total** now, which preserves the split by
construction. The panel greys the per-side numbers rather than hiding them, so
they read as kept rather than lost.

**The single-sided floor was on the wrong quantity**, flooring one side at a
half-width of one and stopping the visible edge a whole far-side width from the
skeleton — 41 units short of the centerline on a 40-unit far side. The floor is
on the width the designer can see now, at two units.

**The drag did not stop.** Widths clamped and everything else carried on, so past
the floor the anchor edge the drag exists to pin walked away with it. One
allowance is computed per point — how much of the drag that point's ribs can pay
for — and everything travelling with the drag is held to it: the point's own
movement, both sides' widths, and the segment's handles. Points are independent,
so a narrow one cannot hold up a wide one, and the drag stands completely still
only when every affected rib is at the floor. A tied group is held to whichever
member gets there first, since the group shares one offset by definition.

**A straight-skeleton test cannot see a handle bug.** The first tests used a
two-point line fixture, so the handle-scaling path never ran: the fix tested
green and was still wrong in the editor, because every real skeleton has curves.
The property that catches it is idempotence past the floor — a drag far past it
must produce geometry identical to one exactly at it — now asserted on the arc
fixture.

**Three things travel with one drag and each leaked separately**: the point's
position, the far side's width, and the handles. Fixing them one at a time meant
three rounds of "still does not stop". Enumerate what a clamp has to cover before
clamping anything.

**Linked ribs move both sides by one amount**, so with an uneven distribution the
far side reaches the floor while the anchor still has room.

**The test asserted the wrong direction twice.** Plain fixed-rib anchors the far
side, which grows; only compress anchors the side the drag moves toward, and only
that side shrinks. Nothing hits a floor without compress.

**The distribution can only be preserved to within grid rounding.** Whole-unit
sides cannot hold 60/20 at a total of 90 — it wants 67.5/22.5 and lands on 68/22,
about 1 percent of distribution. Chasing that needs fractional widths. Rounding
both sides independently, which the shared total-width mutator did, also missed
the total itself by a unit and put the visible edge past the cursor. One side is
rounded now and the other taken as the remainder.

### The rib angle lock was never ported

The donor could force a terminal rib onto an axis, so an open contour's end reads
flat however the centerline arrives at it. The port carried the geometry — the
effective-normal function existed in both the generator and the model — and
nothing else: no canonical field, no copy across the generator dialect, no panel
control. Both copies read donor field names that the schema drops on
normalization, so the override could not fire at all.

The canonical field is named for the direction the **rib** runs, which is what
the designer sees, since a flat terminal is drawn along the rib. It is offered
under **every** cap style, unlike the donor, where it was only offered on the
flat cap: it decides the rib the cap is built on, so it supersedes the style
rather than belonging to one. The effective-normal function is now one exported
copy that the generator imports, per rail R-B.

**Two dead code paths looked like a working feature.** Grepping for the donor's
field names found the math in place in two files and made the port look
half-done, when in fact none of it could ever run. The check that matters is
whether the field survives normalization and the generator dialect copy, not
whether a consumer exists.

**Round and drop caps put points past the rib**, so the "every cap style" test
can only assert the rib line itself on the flat-ended styles; for the others it
asserts that the lock changes the outline at all.

**It is offered at every skeleton point now, not only at a contour's ends.** The
field was always per point and the geometry always applied per point. Only the
panel was gated, and only because the control was drawn beside the cap style. It
moved to the point section, and the writer dropped the endpoint check that
matched the old placement. At a corner the lock replaces the line that splits the
angle between the two arms, so there is no meeting place to reach: both arms' edge
ends land on the forced rib and the corner sits at a plain half-width along it,
one outline point per side. A right angle at a half-width of 40 with a horizontal
lock puts them at (140, 0) and (60, 0).

### Segment selection

Clicking a segment selects its two on-curve points, and shift-clicking an
adjacent segment _removed_ the point the two shared, so a selection could never
be built by walking along a contour. The fault was in the selection **mode**, not
the hit test: shift maps to symmetric difference, which is right for a single
point and wrong for a multi-point hit. The hit test was returning the correct two
points all along.

Shift-click toggles the segment as a unit now — add its points unless all are
already selected, in which case remove them. Plain union would have fixed the
report and removed any way to shift-click a segment off again.

Path and skeleton segment hits both return from one hit-test function and the
pointer tool is the only entry point for either, so one flag covered both
geometry kinds with no second code path to patch.

Left alone: the pointer tool reads the global event object at the mode-function
call site while a local parameter holds the event. It works and it is fragile.

### Three gaps between the skeleton and the ordinary path

The skeleton pen ignored shift. The ordinary pen's whole-angle constraint is
exported and the skeleton pen calls it, so there is one rule, applied only while
a contour is being extended.

**Reverse contour** offered nothing on a skeleton. The reversed flag was a level
with a reader and no writer — stored per contour, normalized, read by the
generator, set by nothing. The menu is its writer. Reversing a skeleton flips the
emitted outline's winding and leaves the centerline as drawn.

Control-click added to the selection, and control is spoken for in this fork.
Adding is the Mac's command key alone now.

**Two of the three items were not what they said they were.** The reverse item
asked for a menu entry, and the work was almost entirely deciding what reverse
means for a stroke. The control item read as a forkra defect and was upstream
behaviour, correct on its own terms, colliding with a modifier this fork had
taken. Neither could be planned from its own sentence.

**A dead level is worth grepping for before designing around it.** Third one
found: the contour serif block, the contour cap style beside it, and this flag.
The check is the same each time — who writes it, not who reads it.

**The point-key parser refuses a rib key**, because it requires exactly two
fields and a rib carries three. It returns null rather than throwing, so a menu
item would have been quietly enabled and done nothing on a rib.

### Splitting a skeleton contour

The break-contour menu entry answers a centerline point now. A closed contour
opens at that point and stays one contour; an open one becomes two. The point
appears at both ends of the cut, one copy keeping its id and the other taking a
fresh one, because two points cannot share a name. The cut is one pure function
in the model, with the editor supplying only the selection.

Measured across the change: a closed contour's two generated loops become one
open stroke of 10 points, and an open one's single 8-point stroke becomes two of
4 and 6.

**Two of the three warnings the item carried did not apply.** It asked for the
generated-contour mapping to be updated in the same change, which the ordinary
path does need — but the skeleton's one write path already replaces the contours
whenever the topology changes, and a split is exactly that. It also asked for a
cap on each new end, and cap style falls through a cascade, so an unset one draws
butt like any other untouched endpoint. Both were true of the donor and are not
true here. **An item's own warnings are as old as the item.**

**The smooth flag had to be cleared on the two new ends.** A smooth point with a
single handle has no direction of its own, which is the condition that ties ribs
across a straight. Carried onto a cut end, a split would have quietly reweighted
the stroke beside it — a geometry change nobody asked for, from a structural
command.

**Resolving all the ids before the first cut is what makes multiple splits
work.** The cross-layer resolver reads structure and a cut changes it, so each
point is found by its own id rather than through its original contour: cutting
one contour twice moves the second point onto the new half.

### A single-sided skeleton pen

A single-sided contour puts all of its width on one side, so the line drawn is
the edge of the letter rather than its middle. It was a flag to set after
drawing, never a way to draw. There is a second pen in a dropdown now, laid out
as the ordinary pen holds its cubic and quadratic pens. It is the first pen with
one value changed — which side a new contour is born on — and it inherits
everything else, so the two cannot drift.

**The request was to copy the file and adjust it.** The pattern it pointed at is
not a copy: the quadratic pen is a twelve-line subclass of the ordinary one. Same
result, one file, and the two pens cannot fall out of step, which is rail R-B
paying for itself rather than being argued for.

**The generated copy of the icons folder is gitignored**, so a new tool icon goes
in the source assets only. The bundle puts it where the page reads it.

### Five small items

**Point indices on a skeleton.** The existing point-indices layer reads the glyph
path and a skeleton is not in it, so a second switchable layer counts the
skeleton's own points, on-curves and handles alike, from 0 across every skeleton
contour.

**A continued stroke keeps its own width.** The pen gave every new point the
model's fallback width, so extending a stroke stepped back to that width at the
next point. An appended point takes the width of the endpoint it extends.

**A hand may collapse a generated handle to zero.** The one-unit floor stops the
solved handle riding along with the rib end, and that is the automatic answer's
problem rather than the designer's. An attached adjustment, a pinned curvature
and a detached placement may now put a handle exactly on its point. The ceiling
is untouched.

The curvature gizmo follows it down. The shared shift bottoms out when the
shorter handle lands on its point, and the stored mean cannot describe anything
past that — it reads zero for every length the survivor still has. So the drag
writes the pin down to that floor and carries the rest as a displacement on the
one handle still off its point. The generator applies the displacement first and
the pin after, and a pin of zero leaves an already-collapsed pair alone, so the
two compose. **A pin of zero also renders now**; it used to read as no pin at
all, which threw the last step of the descent away on reload.

**A handle offset stopped climbing past the ceiling.** A stored offset is a
request and the clamp can refuse most of it. The store kept the whole request, so
a drag that pushed against the ceiling left a value far beyond it and the next
drag back moved nothing until it had walked all the way down. The generator
publishes the part of each attached offset it honored, and a drag starts from
that.

**The hosted glyph panels draw on first load.** The letterspacer and the skeleton
defaults live in host elements that enter the DOM only when the glyph info form
is rebuilt. Their own update runs when the panel is switched on, which on a fresh
load happens before that form exists, so both drew nothing and had no later event
to bring them back. They refresh on the rebuild that re-attaches their host, and
only on that one: the form is rebuilt on every selection change, and redrawing
there would replace a control still under the cursor.

### Manual matrices owed

Per rail R-G, the editor halves of this work carry manual matrices rather than
tests. Outstanding: type into left and right with the sides linked and unlinked,
scrub both labels, drag both ribs at a distribution of 100, and drag the total in
the panel while watching the other three fields.

---

## The generated-segment gizmos and the curvature pin (map F7, skeleton)

**State: settled, one defect open.** Six rounds. This is the designer's control
over the output the offset construction cannot get right on its own.

### Why a control exists at all

Where the automatic answer cannot be right — taper, and offsets a single cubic
cannot express — the generator collapsed instead of deferring. There was no way
to say "make this segment rounder".

There are two gizmos per generated segment. A **curvature** gizmo on the curve,
dragged along the axis toward the tangent intersection, and an **on-curve** gizmo
that slides the segment's two ends along the outline. The second stores nothing
new: it writes the same nudge the panel writes.

### What the pin stores, and why it is a number

The first version of the curvature control stored a positional handle
displacement, so a later change to the skeleton, the width or the taper moved the
base handle, left the displacement behind and drifted the curvature: the designer
set a number and the model stored a nudge.

The gizmo stores **the segment tension it arrived at**. Regeneration reproduces
it whatever the skeleton has done since, and where the geometry cannot express it
the output clamps while the stored value is never rewritten, so the segment
returns to exactly what was set once the skeleton comes back into range.

What makes that clean is an identity: **a segment's tension is exactly the
harmonic mean of its two handles' tensions.** Two handle lengths therefore
decompose into a magnitude, which the pin owns, and a split, which per-handle
adjustments own. They are orthogonal, so the two stored things compose without a
precedence rule.

**A new per-point field is invisible to the generator until it is copied across
explicitly.** Points are flattened into a different shape before generation and
the model's own accessors do not work on the far side of that translation. This
failed _silently_: the pin stored, read back correctly, and did nothing, because
the generator saw an undefined value on every segment.

**Reproducing a pinned mean by scaling both tensions cannot work.** A preserved
ratio caps the reachable mean at twice the ratio over one plus the ratio — 0.6 on
a 0.3/0.7 split — so the control stopped at a value that was neither 1 nor
stable, and moved whenever the geometry moved. It is also not what the drag does:
the drag adds one shared increment to both ends, and reproduction has to do the
same or the number cannot round-trip.

**Saturating both handles at the leading one's ceiling hides part of the range.**
When the leading handle reaches tension 1 it stays; the trailing one must remain
responsive until it reaches 1 too.

**A zero-delta grab must be exactly a no-op, and it was not.** The underlying math
equalizes two coupled tensions regardless of the delta, so differencing against
the incoming geometry fired that equalization the moment the gizmo was grabbed —
a 152-unit jump before the pointer moved. Fixed by differencing against the same
call at zero drag. This same symptom returns twice more below, from two different
causes.

### One construction space, because two mechanisms were cancelling

Grabbing the curvature gizmo moved the curve, its reachable range looked
arbitrary, and dragging a generated on-curve moved the neighbouring off-curves.
All three were one fault. Three things wrote a generated handle's length — the
fit, the pin, and stored per-handle adjustments — and the nudge translated each
handle along with its rib end, so the on-curve drag had to store an equal and
opposite adjustment to hold the handle still. The moment the on-curve gizmo was
touched that adjustment existed and overwrote the pin. It behaved only while no
on-curve had ever been touched, which was exactly the report.

The nudge stopped carrying the handle and became a pure emission post-step:
handles are emitted from un-nudged geometry and on-curves carry their nudge. Net
rendered geometry is identical to what the two mechanisms produced while they
worked. The difference is that there is one mechanism instead of two that cancel,
so nothing is stored to make the cancellation happen and nothing downstream can
defeat it. Ordinary carry-the-handles semantics survive as a separately
accumulated scalar, emitted after construction and never entering the math.

**This reversed a decision made one day earlier, and both were right in turn.**
Measuring the pin in rendered space was necessary while the nudge carried
handles; once it stopped, construction space became strictly better, because it
makes the pin independent of the on-curve gizmo. **Fix the mechanics, then choose
the space, not the other way round.**

**A nudge could push a rendered tension past the ceiling on an untouched
segment** — 1.18 at nudge 20, 1.48 at nudge 40 — because the length was preserved
while the reach shrank. Sliding a rib end toward its handle reduces both now, and
the ratio stays under 1 by arithmetic.

**Mirroring was verified by construction, not by eye.** Generate-then-mirror and
mirror-then-generate must produce the same point set. A mirror has negative
determinant, so the geometric left of the mirrored centerline is what the stored
data calls right; swapping the per-side fields by hand on the mirrored data made
the two agree exactly, which confirmed the swap was the whole fix. Contour-wide
side ownership can only be swapped when the entire contour is selected, so a
partial selection deliberately leaves it.

**Hiding the on-curve points along with the handle lines would have been wrong.**
On-curve points say where the outline is; off-curve points with no lines are
floating circles. Only the off-curves are hidden.

### Three readers disagreed about what a tension is

Grabbing the curvature gizmo and releasing without moving jumped the curve by up
to 128 units. Worst on the first grab, and quiet afterwards only because the
error drove the tension to its ceiling and stuck there.

A handle's tension is its length over its own distance to the segment's tangent
intersection, so one is the Tunni point. The gizmo measured exactly that. The
generator normalizes against a reach clamped to a third of the chord, whose
ceiling drops below one wherever that clamp bites, and applied the pin against
that scale. Two different units, so the number written was not the number read.

A smooth joint then rotates the drawn handle after the solve, keeping its length
and moving the intersection — 38 degrees in the case measured — so even in
matching units the direction being measured against was never the one the length
was built on.

The pin is rescaled onto the ceiling before it is applied, so both ends read one
at the tangent intersection. Every generated handle already carries the axis it
was constructed on; that axis is published with its provenance now and the drawn
directions are used for nothing, which is rail R-D applied to a reader that had
been recovering direction from geometry all along. One reader serves all three
call sites, so the number a drag writes is the number the label shows and the
number the generator reproduces.

Handle movement on a grab-and-release with no movement:

| case                            | before | after |
| ------------------------------- | ------ | ----- |
| plain cap                       | 128.3  | 1.0   |
| plain cap, handle dragged first | 112.2  | 1.0   |
| serif cap                       | 34.8   | 0.8   |
| serif cap, handle dragged first | 40.1   | 0.8   |

Swept over cap styles, widths, smooth and corner joints, both sides and both drag
orders: 156 of 162 cases under one unit, the rest at 1.9.

**The saturation hid the size of it.** "First adjustment jumps, then it is
smooth" reads like a state that gets initialized once. It was the error running
the tension to its ceiling in two or three grabs and having nowhere further to
go. Iterating the round trip rather than measuring it once is what showed that.

**The published axis belongs to the emitted handle, not to whatever is being
measured.** Where the reader substitutes the untrimmed snapshot the axes are the
wrong pair, because a trim re-aims the handle it anchors onto the terminal's
depth axis and stamps that, while the snapshot predates colinearity and needs no
correction. Getting this backwards passes most tests.

**A residual two-unit oscillation remains.** Six of 162 swept cases alternate
between two states about 1.9 units apart, all round caps on one narrow geometry.
It alternates rather than drifting, so it is grid quantization on the trim rather
than a residual error in the units. Left alone.

### A pin must survive the hand that overrules it

Set a curvature with the gizmo, switch to direct handle editing, drag a handle:
the handles jumped back to where the automatic fit had put them, and the drag
continued from a position the designer never chose. Fixed once, and the first
drag after a curvature adjustment still dragged heavy and then broke loose, while
every drag after it was smooth. Two causes, one behind the other.

A direct handle drag discards the pin on its own segment, which is right — the
hand is the later and more specific answer. But the discard was destructive,
because the pin contributes length to both of the segment's handles. The pin is
**baked** before it is dropped: one regeneration with it cleared measures how far
each handle moves, and that difference is stored as a per-handle offset, so
rendered geometry is unchanged across the clear.

Underneath that, a pinned segment bypasses the ordinary tension ceiling because
the pin saturates its own tensions at 1. Clearing the pin put that ceiling back,
and it eased into its limit over a blend window, so it re-shaved exactly what the
bake had restored and the drag spent its first units of travel inside the window.

**The eased ceiling is right for the fit and wrong for a hand.** The fit's answer
has to be a continuous function of the skeleton; a length the designer chose has
no such obligation, and easing lands a few percent short of what was asked. It
measured 5.0 units short at tension 1, which also meant a hand-dragged handle
could never quite reach the tangent intersection. (The three ceiling variants
this produced were later collapsed back to one exact clamp — see the offset
construction section, round 5.)

**"From the correct position, but a jump."** The report distinguished a wrong
starting position from a wrong first movement, and that distinction separated the
two causes. The first fix was verified by a zero-delta drag, which proves the
start position and says nothing about travel, so it passed while the second fault
was live.

**Both handles, not just the dragged one.** The pin sets the two lengths together
and only one is ever under the cursor, so baking the dragged handle alone would
have held half the segment still and moved the other half.

**Measured, not reasoned.** The residual was 0.00 units below a pin of 0.8 and
grew to 5.0 at 1.0, which is why it presented as intermittent: it depended
entirely on how far the curvature had been pushed.

### Two bugs the detached flag exposed

**A handle had a limit it should not have.** With the detached flag on the
designer placed the handles where they wanted them; with it off the same
placement was refused, 32 units asked and 7.77 honored against 55 units of real
room. The ceiling was stored as a multiple of the coordinate scale and capped at
1, so it could never pass that scale. Where a short real reach floors the scale
and a backward handle slide moves the drawn crossing far beyond it, the ceiling
refused most of an authored offset. A detached handle skips the domain entirely,
which is why the flag made the difference. The ceiling is bounded by the drawn
crossing and by the absolute cap of twice the chord now, not by the scale.

**The conservative note in the previous round was the bug.** It had been recorded
as a limitation of the backwards direction and dismissed, because the handle
moved, which was that report's complaint. It was a wrong unit, and it took a
second report to be read as one.

**The detach toggle changed the shape by itself**, moving a handle 4 units on and
back off. Detaching converts the handle's position into an absolute placement and
read that position off the screen, after the pin had been applied, so the
generator applied the pin again to a number that already carried it. Because the
pin holds the segment's mean rather than either handle, it answered the changed
input with a different split. The conversion measures against a regeneration with
this side's two segment pins cleared now, so it stores the construction rather
than the screen. Re-attaching measures the other way round, against a
regeneration without this side's offsets, because there both sides of the
subtraction carry the pin and have to agree.

One existing solver test was corrected in that round: it asserted the old cap,
which is the bug written as an expectation.

### Placement and readout

The curvature label sits straight above the node. An offset that follows the
gizmo's own axis also swings the number around as the segment turns, and a label
the eye has to hunt for is worse than one that occasionally crosses the stub.

The on-curve gizmo's distance from its curve is one constant in glyph units. A
screen constant holds its pixel size at every zoom and grows without bound in
glyph space, so zoomed out the control sat a large fraction of the letter from
its segment. **Scaling it by the local stroke half-width is the better-argued
design and was rejected on sight of it** — the gap then moves with every width
edit. Worth recording as a decision rather than a mistake, because the argument
will be just as convincing next time.

The rib width plaque appeared during a tangent slide, which changes no width at
all. It reads the drag's behavior name now, which the pointer tool publishes on
the scene model, because the readouts have no route to the realtime modifier
state of their own.

**The suppression predicate had to be narrowed after it was written.** "Not one
of the two width behaviors" and "is one of the two tangent behaviors" look
equivalent and are not: a rib drag can carry a fixed-rib behavior instead, and
that one does change widths, so the broader form would have silenced a plaque
that was telling the truth.

**Publishing the behavior name where it is set** rather than at drag start is
what makes a key pressed mid-drag take effect on the next frame instead of the
next drag.

### One defect open

The detach conversion anchors the offset on the emitted on-curve, which carries
the on-curve nudge, while the generator anchors a detached placement on the
un-nudged rib point and adds the handle nudge. The two agree only where the two
nudges are equal. On the file it was found on both are 45, so it is invisible
there. Provenance already publishes both vectors.

---

## Corner rounding, caps and the bulb (map F7, skeleton)

**State: built, two defects open.**

### Corner rounding is distance and curvature

It had four sliders, and three of them — roundness, reach and strength —
multiplied into one number, the distance the corner is trimmed back by. Reach
capped that distance against the neighbouring point, roundness took a fraction of
the cap, strength scaled roundness again, and the product was clamped to one. So
three controls drove one quantity at different strengths and no one of them said
what the corner would measure. The fourth, asymmetry, scaled roundness down on
one side of the stroke — one number for a thing that is two. The arc's own
fullness was fixed at the default cap tension, with no control at all.

There are two numbers per side of the stroke now, shaped like width. **Distance**
is how far back along each arm the rounding starts, in font units. **Curvature**
is how full the arc is, on the tension scale the contour easing and the curvature
gizmo already use: 0 cuts a straight chamfer, 1 puts both handles on the corner
point. The two sides start linked.

Distance is absolute units rather than a fraction of the arm, because a fraction
rescales itself when a neighbour moves, so the drawn corner would change when
nothing about the corner changed. Three clamps hold it, and they are the geometry
rather than a fixed fraction standing in for it: the run to the neighbouring
on-curve, the handle on a curved arm, and the pairwise pass that splits one
segment between the two corners sharing it.

The old fields are gone with no migration, which the designer chose. A corner
drawn before this comes back sharp.

**The half-width gate reads two ways, and the code already chose.** A side under
half a unit lies on the skeleton, so rounding it pulls that edge off the drawn
line. Single-sided mode is the deliberate exception: the collapsed side borrows
the live side's base and rounds with it, so the two edges agree. The first test
asserted the general rule and failed against the exception. The test was wrong,
not the code.

**The arc's fallback fired at exactly the setting that wants nothing.** The old
code repaired a near-zero handle length with a circular-arc estimate. Under a
curvature control a zero-length handle is the chamfer the designer asked for, so
the fallback fires only on a degenerate chord now, which is the case it was for.

**A fourth dead level.** Two contour-level corner fields were read by the
generator and by normalization and written by nothing. Fourth found by the same
check — who writes it, not who reads it — after the contour serif block, the
contour cap style and the reversed flag.

**Open: the point count still varies with the parameter**, because distance zero
emits no arc, so a corner rounded in one master and sharp in another does not
interpolate. That predates this work, and the serif's collapse rule was
deliberately not extended to corners without being asked.

**Left alone.** The cap-corner field-name list in the fixture script has the
serif fixture objects merged into it, so those fixtures are never generated and
the loop over the list indexes points by object. It is a dev script and it
predates this work.

### The bulb's ball is solved for, not tested for

Placing the ball trims the outer edge back and sits the ball tangent there, deep
enough that its forward extreme lands on the terminal. The trim was guessed,
tested against a hard fit predicate, and grown until the predicate passed.

Two faults followed. The accepted trim was the first that passed, and a trim that
only just passes leaves the ball almost no depth — 21 units deep against 55
across, on a ball asked for at 75. Past the predicate the search gave up and
returned its first guess, reusing a trim distance as a ball radius. Which of the
two a glyph got turned on a margin of two hundredths of a unit.

Two more sat behind it. Where no cut delivered the requested depth the search ran
to the end of the usable run and took whatever sat there, which was no depth at
all: on a curved terminal at ball ratio 2 and above the ball came out one unit
deep and the bulb vanished. And a ball whose sideways swell alone already passes
the terminal plane has no depth that satisfies the pin at any cut, so the
terminal fell through to a plain cap.

The trim is bisected for. The depth the terminal allows rises as the cut moves
back and runs away where the edge turns square to the stroke, so the requested
depth is a root and the search finds it from the deep end. The ball is the shape
the settings asked for, and the cut moves to deliver it. Where the request does
not fit, the search carries the deepest ball the run allows and falls back to it,
refined between the samples either side so the answer moves rather than stepping.
Where the ball is too wide for any cut it is narrowed until one cut holds it.

Sweeping the far skeleton point 40 units in quarter-unit steps, worst single-step
outline movement 93.94 before and 3.00 after. Sweeping ball ratio 0.5 to 3 in 51
steps, 6 steps drew a plain cap before and 0 draw one now.

**A predicate answers whether, and the question was how much.** Every fault here
came from testing a guess instead of solving for the number. The fit predicate
was correct and useless: it could confirm a trim and could not rank two.

**Open: where the ball grows large enough to swallow the whole inner edge**, the
crossing that anchors the neck flips between the terminal and the contour's far
end. That drives the remaining jumps under a ball ratio or ball shape sweep.

### The bulb's neck

Its easing was named tension, which it is not: it sets how far back along the
inner edge the neck starts. It was also indirect, because the value grew a
second, inflated ball and took whatever crossing that ball happened to make with
the inner edge. No reading of the number told you where the neck would land, and
the crossing search was free to walk past on-curves and eat whole segments.
Easing is a 0 to 1 fraction of the run from the plain ball crossing back to the
next on-curve on the inner edge now, placed directly, with one run serving both
the geometry and the panel's top of range so the stop cannot disagree with the
number.

The curvature gizmo was absent from the whole terminal region. The segment walk
takes a segment only when all four of its points carry addresses on one side; cap
points carry none, and the trim rebuilt the inner edge's two handles from a
bezier split without re-attaching theirs. The trim publishes what the round-cap
split already publishes — the original handles' addresses on the rebuilt handles,
and the untrimmed segment on the crossing on-curve — and only when easing is off,
because exactly one gizmo belongs at a bulb's terminal. Once easing is on the
neck gets that gizmo instead; a neck has no skeleton segment behind it, so its
curvature is stored on the cap-owning point and its four points name that point
and that field.

**Naming the point is not the same as owning it.** The neck names the cap-owning
skeleton point so the gizmo can find it, and that alone made every neck point
resolve as an editable generated handle — a drag would have moved the rib the
neck hangs off. Three readers had to be told the difference: the segment walk,
the on-curve gizmo's eligibility, and the editable-target resolver. **Provenance
that names a point is an address, not a claim of ownership**, and each reader
decides for itself what it may do with one.

**The obvious test helper measured two different points.** The rejoin was read as
the furthest-forward on-curve on the inner edge. Once easing is on, the ball
attachment also lands near that edge and sits forward of the neck's far end, so
the helper reported the attachment at small easing and the far end at large. The
continuity check failed at 0.05 and passed everywhere else, which reads as a
geometry bug and was a measurement bug.

**A straight stroke cannot test this.** The inner edge's terminal segment is a
line there and a line has no curvature gizmo, so the first version of the
addressability test asserted against geometry that could never satisfy it.

### The corner sat one half-width out whatever the width and whatever the turn

The routine that placed a corner's outline point took the stroke width as an
argument and never used it. It returned the right direction, the normal on the
line that splits the angle between the two arms, and the caller then walked a
plain half-width along it. So a corner's shape did not depend on the stroke width
at all, and a diagonal arm meeting a vertical stem ran out into two thin spikes
instead of closing.

**The two edges of one side meet at one half-width over the cosine of half the
turn.** At a right angle that is 1.41 half-widths, at a 120 degree turn it is 2.
The routine is `calculateCornerJoin` now and returns that distance beside the
direction it already returned.

**The two sides of a corner are different problems, and they are solved
differently.** One side has a gap between the two arms' edge ends and the other an
overlap. The side with the gap carries each edge on as a straight along its own
arm and takes the place they meet: those straights are a construction that finds
a point which does not otherwise exist, and they are discarded. The side with the
overlap has nothing that stops, so the crossing there is drawn geometry and it is
found, not stood in for by a crossing of the two end directions. Both curves bend
toward each other over the reach, so a direction crossing sits in the wrong place
and on a strongly curved arm the corner sticks through the stroke.

**Where the inner curves do not cross exactly once, the code does not choose.**
Both edge ends stay and the straight between them is the corner. Choosing among
several crossings can change its answer between two frames of a drag, and the
outline is rebuilt on every frame. This is the same rule the offset construction
arrived at over five rounds.

**The miter limit is two stroke widths.** At 178 degrees on a 60 unit stroke the
meeting place stands about 1719 units out, longer than the letter is tall. Past
two stroke widths, and where the two arms are exactly parallel and there is no
meeting place at all, the side ends each arm at its own edge end and the straight
between them is the corner. It reuses the inner side's path: two edge ends with a
gap do not cross, so the crossing pass finds none and leaves both standing. The
drag that offsets an ordinary hand-drawn outline bevels at the same turn; it
states the same number as four times the half-width.

**The fit costs nothing measurable.** The emitted cubic follows its arm's true
edge and is then stretched to reach the meeting place. Measured over turns of 30
to 150 degrees, half-widths of 10 to 60 and two arm curvatures, the whole
departure is the reach itself: it is the half-width times the tangent of half the
turn, which is exactly the distance from the edge end to the meeting place. Over
the first four fifths of the curve, before that reach begins, the departure is
0.3 units at 30 degrees and a half-width of 10, and 12.5 units at 150 degrees and
a half-width of 60. Worst overall is 224 units, at 150 degrees and a half-width of
60, which is the reach and not a fitting error.

| turn | half-width 10 | half-width 30 | half-width 60 |
| ---- | ------------- | ------------- | ------------- |
| 30   | 3.0 (0.3)     | 8.0 (0.7)     | 16.0 (1.8)    |
| 60   | 6.0 (0.4)     | 17.0 (1.2)    | 35.0 (2.6)    |
| 90   | 10.0 (0.6)    | 30.0 (1.9)    | 60.0 (3.5)    |
| 120  | 17.0 (1.0)    | 52.0 (3.3)    | 104.0 (5.3)   |
| 150  | 37.0 (2.5)    | 112.0 (7.1)   | 224.0 (12.5)  |

Worst departure in font units, with the departure before the reach in brackets.

**A smooth point is not a corner.** The centerline does not change direction
there, so it keeps the averaged normal at a plain half-width and one outline point
per side. Applying the corner treatment at smooth points broke two serif tests at
once: a nominally smooth skeleton point with a 60 degree kink between its handles
got the whole construction, and its inner side then rebuilt both handles from the
cut, which coupled a handle to its neighbour that must stay still.

**A closed contour's last straight segment was dropping its corner join.** The
branch treated the last index as the end of the contour, which is only true for an
open one. It never showed before, because a closed contour's segments emit only
their start points, so the dropped join had nothing to place. A closed triangle's
inner contour came out asymmetric. At a half-width inside the triangle's inradius
it is now the exact inset triangle.

**Sweeps, not assertions.** Four of them: the turn from 20 to 140 degrees in half
degree steps, the stroke width from 10 to 100, the proportion between the two, and
an arm bowed until the inner crossing goes away. No step moves an outline point
more than a few units. A per-configuration assertion has missed every fault in
this area so far.

**The rib bar is square to the arriving arm now.** It keeps its length, drawn at
the stored half-width, so it stops short of the outline at every corner and by
more the sharper the turn. It states how wide the stroke is. It no longer states
where the edges are. `cornerArrivingNormal` returns null everywhere but a corner,
so the shared normal in `offset-contour.js` is untouched and the drag that offsets
an ordinary hand-drawn outline reads exactly what it read before.

**The outline point count changes in three cases.** An ordinary corner is one
outline point per side, which is what it was. A side past the miter limit, a
fold-back, and an inner side whose curves cross zero times or several are two.
Two masters whose corners fall in different rows do not interpolate at that
corner. The designer accepted this: contours rarely change this much between
masters, and this is not animation software.

### Fixture gap

No golden fixture moved for the corner rounding rework, and the corpus carries no
rounded corner at all, so it cannot see that change. No external glyph uses a
bulb.

Two fixtures moved for the corner join. `closed-triangle` moved every outer point
outward along its split line, from one half-width to two, which is one over the
cosine of half a 120 degree turn. Its inner contour is drawn at a half-width wider
than the triangle's own inradius, so the stroke swallows the shape, that contour
is inverted and self-crossing, and two of its three corners fall back to two
points each. `one-ended-controlled-straight` moved its corner by one to two units.
The canonical inputs in the fixture file also gained a `corner` field, which
predates this work: the recorded fixtures were stale.

---

## Base-curve expansion (map F9)

**State: shipped.** Holding D or S and dragging an on-curve offsets the stroke.
It worked on skeleton points only, so an ordinary outline could be moved and not
expanded. The geometry the gesture needs already existed inside the skeleton's
fixed-rib drag, and copying it would have put two copies in the tree against rail
R-B.

The geometry moved to where both features reach it: a core module holding the
segment walk, the per-point normal, the coupling rule and the offset construction
itself, none of which reads a width, an id or a cap. The skeleton model keeps its
exported names as wrappers and adds the three things only a skeleton has — the
rib tied-flag opt-out, the serif terminals that also couple a straight, and the
per-point rib-angle override. Ordinary outline points gain no stored field: what
travels together is the rule that was already there, that a straight carrying a
tension point holds both its ends to one offset and straights sharing an end
merge into one group.

Both keys do the same thing here, as they do on a single-sided stroke: the drag
direction alone decides whether the shape grows or shrinks. The gesture engages
only where the selection holds no skeleton geometry, so a mixed selection runs
the skeleton drag exactly as before, and generated contours are never touched.

**There is no floor.** A base curve has no width to run out of, so an inward drag
follows the cursor as far as it is pushed and cusps where the offset passes the
local radius. That is ordinary outline geometry, reachable by hand and undoable.

The extraction was behaviour-preserving: core suite 1,894 before and 1,913 after,
19 new tests, no existing test edited, and the fixed-rib block in the skeleton
modifier tests — the floor and the past-the-floor idempotence assertions included
— passed untouched throughout.

**An undo did not fully restore, and the reason was where the change was recorded
from.** Every frame recorded against the live glyph, which already carried the
frame before it, so the rollback described one frame rather than the drag, and a
three-frame drag rolled back to frame two. The skeleton's own entry never had
this, because it copies the pre-drag glyph once and records each frame against a
fresh copy of that copy. **A rollback is a statement about the whole gesture, so
it has to be measured from where the gesture started, not from where the last
frame did.**

**A corner point took the miter whatever was selected, and that was two separate
faults.** Selecting one edge of a rectangle and dragging it down 20 sent both its
corner points diagonally outward: the edge sank 14 and widened by 28, and the two
side edges slanted.

The first attempt fixed only the distance. It made the corner point travel far
enough for both its segments to land at the offset, which is right when both
segments are being offset and wrong when one is not. The designer rejected it and
named the derivation that settles it: **each segment moves along its own normal
by its own offset, and the corner point lands where its two moved segments
cross.** A segment whose far end stays put has an offset of zero, so it does not
move, the crossing stays on it, and the point travels square to the one segment
that did move. Measured against that derivation afterwards, the code agrees to
grid rounding at turns of 90, 63 and 11 degrees, and in the one-edge case.

**The projection axis had the same fault.** The cursor was projected onto the
clicked point's own normal, which at a corner point read 14 of a 20-unit drag, so
how far a drag reached depended on the angle of the point it started from. It
projects onto the direction that point will actually travel in now.

**The crossing needs a bound, and it is the only limit in this drag.** Two
segments doubling back move to parallel positions and never cross, so the
distance runs to infinity and at exactly doubled back it is not a number. It is
held at four times the offset, the standard miter limit, which starts to bite at
a turn of about 151 degrees. The spec says there are no limits and means the drag
distance against the curvature radius. This is a different thing and an addition
to what the spec asked for.

**Stating a construction as a rule instead of as its derivation cost a round
trip.** "The corner point travels the miter length" names a quantity and explains
nothing. "Each segment moves along its own normal, and the point lands where they
cross" is the same number and answers the question.

**The plan's own test asserted the wrong answer once.** Its chaining fixture put
a curve where the comment said a straight, so it demanded three coupled points
where the correct answer is one. A curve is never coupled.

**The plan's baseline had drifted by 329 tests** and the coupling collector had
gained a serif argument since it was written. Neither changed the work. Both are
the ordinary cost of a plan written four weeks before it was run.

**Still owed.** Four rows of the manual matrix have not been run: the mixed
selection, the generated contour, the drag started on a handle, and the key
pressed and released mid-drag. Live use covered the gesture, both keys, the
direction, the ghost, the readout, undo and the rectangle cases, which is what
produced the two faults above.

---

## Panel mechanics (map F7, skeleton)

**State: settled.** The scrubbable label replaced eleven relative scale sliders
in the serif section alone. Each slider ate a third of a row, and the control was
indirect: the thumb reported a percentage, so setting a length meant knowing what
it currently was, working out the ratio, and watching the number rather than the
slider.

Pressing a parameter's name and moving sideways moves its number one unit per
pixel, shift a tenth, control ten. **Linear, deliberately** — an accelerating
scrub returns a different number for the same hand movement depending on how fast
the hand moved, so nothing about it can be learned and no round value can be
landed on without watching the readout.

Whole numbers throughout, whatever the modifier. Everything a scrub reaches is in
font units and the generator quantizes to the grid anyway, so a fraction only
stores a value the outline never uses and leaves the next drag starting from a
number the panel is not showing.

Three pieces, deliberately separate: the pixels, modifiers, step, clamping and
rounding live in a core module with no DOM, which is the only way any of it gets
tested, because the view packages carry no harness (rail R-G); the pointer events
attach to the **label** rather than the input, because an input is a place to
select text and type into and a drag starting inside one fights both; and the
panel routes it, checked before the other streaming branches, because a scrubbed
number would otherwise be read as an absolute value by whichever branch claims
its group.

**What travels down the stream is the change from where the drag started, not a
value.** Adding that change per point is what keeps a mixed selection mixed: a 40
and a 60 dragged up by 10 become 50 and 70 instead of collapsing onto one number.
The existing streaming helper already restored the pre-drag skeleton before each
frame, which is exactly what a relative drag needs, so this was routing rather
than new machinery.

**Clamping and rounding cannot be the same call.** They were, and the first pass
shipped fractions into the boxes because nothing asked for rounding. Turning it
on in that one function would have broken the fine modifier instead: the caller
folds the clamped value back into its accumulated travel so an overshoot turns
around immediately, and folding a **rounded** value back cancels each fine move
before the next can build on it, so a tenth of a unit per pixel would move
nothing at all. Two functions now, and the travel is only ever folded back
through the clamp. Both halves are pinned by tests.

**Two clamps disagreed with the panel.** The nudge floored every serif length at
zero, copied from the scale path, but wing slope is signed and the whole lower
half of its range is a real family of shapes. And the number fields declared no
minimum at all, so a drag past the bottom kept counting down in the box while the
shape had already stopped, and the number snapped back on release. Both fixed by
putting the bound where the panel can see it.

**Shift is the fine adjust, not the coarse one.** Figma's scrub has it the other
way and the first pass followed Figma. Shift-as-precision is the stronger
convention across everything else and is what this repo's user expects. The arrow
keys in these same fields still take shift as coarse, from upstream —
inconsistent, and unchanged here because it is shared with every other Fontra
panel.

**Multiplication was a real loss and was reinstated separately**, as a ratio
field on the same scrub row. See the serif terminal section.

---

## Modifiers and the early live-use rounds (map F7, skeleton)

**State: settled.** Kept because two of these were arrived at twice.

**Two modifier rearrangements were built and both reverted the same day.**
Swapping the rib pair, so a plain drag takes the width and the Z key takes the
tangent slide, ignores why Z exists: a tangential rib move is the _rarer_
intent, and a plain drag reaching for the width is what the tool is for.
Dropping Z as the gate on generated geometry removes the safety on derived
geometry. Both are closed in the feature model's rejected register with their
reasons.

**A real defect was hiding under the second attempt.** Z carried the adjacent
handles when the drag came in through the generated on-curve and not when it came
in through the rib grip — two entry points to the same nudge, at the same place
on screen, and only one passed the carry flag. The flag is derived from the
behavior name where both callers pass through now, so they cannot disagree.

**Every basic point rendered black as if selected.** A null index list read as
"every point" by the node iterator, and an empty selection parses to no list at
all, so the selected-node layer painted the whole path. Two iterators now, one
per meaning. **The previous round's fix was to hide all generated points**, which
is not a fix — it removes the symptom and the feature together.

**A stat that measures the wrong thing is worse than no stat.** The tension-bound
counter answered its question once and was then read as hard pinning, which it
never was. Removed with the script that consumed it.

Equalize fired on button-down, so a modified drag was unreachable, and it fired
on both gizmos rather than only the one that owns the split. It is a click on the
curvature gizmo, deciding after it sees whether the pointer moves.

---

## Tension-aware drag and scale (map F10)

**State: built, in live use, unfinished.** Hold X and every curved segment the
edit reaches keeps its drawn shape instead of going slack or pinching. The drag
works, both directions of the scale work, and the arrow keys run the same
correction. Nothing here has been through a manual matrix. The spec and the plan
stay in place for the next round, against the usual practice of retiring them at
the end.

The geometry is one core module with mocha tests. The interaction is one editor
module holding a target entry, in the shape base-curve expansion already uses.
The drag keeps the ordinary match tree and corrects on top of it. The scale runs
an empty match tree, so the entry is the only writer.

### The four rules

No handle turns. Every handle keeps its tension, which is its length as a
fraction of the way to the segment's tangent crossing. A tension point slides
along its own straight until its segment's corner is back in proportion — **under
the scale only**, for the reason below. Under a scale a straight is a rigid link
across the axis being scaled, and its extent along that axis is free.

The invariant was settled by measurement, not by preference. On the n's inner
arch narrowed to 0.846, no slide gives an apex radius of 52.7 and equal travel
gives 60.5, against an original 73.6. The similar corner gives 62.3, which is
the original radius at the new size. That is the rule.

### The slide belongs to the scale, and not to the drag

Every curve in the n has exactly one end that can travel:

```
curve  0 ->  3   ends: 0 slides,  3 STUCK
curve  3 ->  6   ends: 3 STUCK,   6 slides
curve  9 -> 12   ends: 9 slides, 12 STUCK
curve 12 -> 15   ends: 12 STUCK, 15 slides
```

The four stem-side points sit on a straight and travel on it. The two apexes
have curves on both sides and have no rail. So under a drag the rule fired on
one end of a curve and never the other, and the same gesture read as corrected
from one grip and ignored from the opposite one. Pulling the apex sideways slid
the springing point and put the corner back in proportion. Pulling the springing
point owed the same travel at the apex and could not pay it: the arch went 40
units taller with one leg scaled by 1.29 and the other untouched.

A scale is where the rule belongs. It states a size and nothing else, so the
slide is the only thing that can restore a corner, and it has the whole
selection's straights to work with. A drag states a position, and the point
under the cursor is usually the one the slide would have moved.

The drag keeps the rest. A dragged tension point still carries its whole
straight, its handle still ends up on that straight, and every segment the edit
reaches still keeps its tension. What that last part is worth, on the n's outer
arch with the springing point pulled 40 down its own stem: without it the handle
stays 69 units while the leg it fills grows, tension falls 0.496 to 0.385, and
the apex radius collapses 158 to 101. Pushed 80 the other way the handle passes
the tangent crossing at tension 1.169 and the segment doubles back on itself.
Tension is the coordinate in which the springing point can travel its whole
range and still describe a curve. It holds proportion and not shape, and that is
all a single grip has to distribute.

**The extension that would restore shape, unbuilt:** let a stuck point slide
along its own tangent, a straight being the case where a segment happens to lie
on that tangent. The apex's tangent is shared with the next curve, so moving it
changes that curve's reach and asks its far end to slide in turn. On the n the
cascade terminates one step later at a point that does have a straight. Whether
it always terminates is unproven, and a closed contour of nothing but curves has
no stuck-free end anywhere.

### A frame states the whole answer, or it states a lie

The entry wrote only the points whose correction differed from what the match
tree put there, and that set changed from frame to frame:

```
raw x=46 y=5  -> writes [0,1,2,3]
raw x=24 y=21 -> writes [0,1,2,3]
raw x=16 y=22 -> writes [1,2]      <- 0 and 3 go stale
raw x=2  y=6  -> writes [1,2]
```

Every frame is measured from the pre-drag path, so a point dropped from the set
kept whatever an abandoned frame left on it, and the last frame's rollback never
named it. The undo restored part of the drag and left the rest, which is how it
was reported. It also reads as a lag, because a point can sit a frame or more
behind the cursor. A point written once is written on every frame after it, in
the drag entry and in the transform entry alike.

**This is a general trap for any target entry whose write set depends on its
input.** The base-expand entry writes the same points every frame and does not
have it.

### Every rule that fires has to say what carries with it

Six separate faults, all the same shape. A point moved and something that
belongs to it stayed behind, or a handle was turned and nothing turned it back.

The slide moved a tension point and left its handle. The point rose past the
handle, the handle then sat below the point, and the restore rebuilt it pointing
down instead of up — a 36-unit flip on a quarter-unit step, caught by the
200-step continuity sweep rather than by any assertion written for it. The scale
moved on-curve points through the entry, where no point rule runs, and left
every handle behind, which broke collinearity at each tension point. Two tests
in the plan moved an on-curve point without its handle and measured a state the
editor never produces.

The sixth runs the other way and took the longest to see. **The ordinary point
rules keep a tension point's handle collinear themselves**: `RotateNext` turns it
onto the line from the far end of the straight to the point. They turn it onto
the straight as they see it, with the far end still standing where it was, so on
a drag across, that line is tilted. The coupling then moves the far end and takes
the tilt back out, and nothing turned the handle back. On `n.json`, dragging the
tenth node 30 units across left a 4.1 degree kink at a smooth point, and a sweep
of the whole range reached 6.1. The handle now goes back onto the straight after
the coupling has settled where the straight is, at whatever length it has. That
turns no handle a designer placed — it undoes a turn the ordinary rules made
against a tilt this module removes, which is why it runs after the coupling and
not before.

The remedy in all six: whatever moves a point moves its handles, and whatever
un-tilts a line squares what was turned onto it.

### The axis lock, and two writers with one baseline

X states an axis. The larger component wins and the other is dropped, whatever
the selection holds. The correction reads a shape one axis at a time — the chain
walk sorts bodies along the axis being scaled, and a tension point travels on its
own straight — so a diagonal asks it two questions at once and neither answer is
the one the designer is watching.

**The axis is the drag's, not the frame's.** Deciding it per frame let a later
reach across overrule an earlier reach along, halfway through a gesture. It
latches once the pointer leaves a two-unit dead zone, so the opening frame cannot
settle it on a jitter.

**X+Shift is just X.** An axis is the stronger of the two constraints and
0/45/90 has no diagonal left to offer under it. The variant is deleted rather
than exempted — behavior name, table entry, base-name mapping and all — and the
resolver no longer reads the event.

**Two writers need one baseline.** The lock was in the code and never reached
the canvas. The match tree writes first with the raw delta, the entry writes on
top, and the entry wrote only where its result differed from a baseline it
computed from the **locked** delta. For the dragged point those two agreed, so
nothing was written and the raw diagonal position stood. Horizontal drags looked
locked because the correction rewrites the arch points anyway. Vertical drags had
no such cover and moved freely, which is how it was found. The baseline has to be
what the other writer actually wrote.

The same fault a second time, in a second parameter: the entry builds its own
copy of the ordinary behavior to measure against, and built it with scaling off
while its caller may have built the live one with scaling on. On the scale
sub-tool that is a baseline the glyph never held. The flag is passed in from
both call sites now. **Anything the caller's factory was built with, the entry's
copy must be built with too.**

### Which points may slide, three times wrong

History of the slide, which now runs under the scale alone.

The first gate demanded a smooth point, on the reasoning that a corner owns its
own tangent. The reasoning does not hold. The slide never reads a point's handle
angle off the straight — it moves the point along the straight and the handle
travels with it, so the drawn angle survives. Corner points slide.

The second gate skipped a point the edit had already moved. But the slide owns
exactly one number, how far the point sits from the far end of its straight, and
a drag that carries a whole stem sideways changes that number not at all. It is
skipped only where the edit changed that distance itself. That distance is
measured on the straight **as it stood before the edit**: measuring on the tilted
one reads the tilt as travel.

The third gate asked the far end of the curve to move. Dragging a stem moves the
near ends and leaves the apexes still, so the gate stood down on the commonest
gesture of all. The corner is made by both ends. Only a segment that took the
same delta at both ends is unchanged, and that one already keeps its drawing.

### The slide answers to the far leg alone

Pulling an apex straight down carried the tangent crossing down with it, so both
tension points followed and the whole arch travelled as one piece. The near leg
answers to the far leg and to nothing else. Where the far leg is the length it
was, the corner asks for no travel, whatever the crossing did.

### The coupling rule already existed

A tension point dragged sideways tilted its own stem, because the foot stayed.
The rule that fixes it was written twice before, for the skeleton ribs and for
base-curve expansion: a smooth point with one handle cannot own its direction,
so the straight states it, and one such point ties both ends of that straight.
The first cut here walked neighbours by hand instead of calling
`collectCoupledPointGroups`, which is rail R-B, and it was wrong.

Only the part of the move across the straight is carried. The part along it is
the straight growing or shrinking, which a straight may do. So the same point
dragged sideways takes its stem with it and dragged upward only shortens it.

### Content-aware scale: the chain walk, and why the axes differ

Across x the construction is a chain walk. On-curve points joined by straights
form a body. A maximal chain of curves is a run. Bodies sort along the axis, the
gaps between them share the change in proportion, and each run's interior
interpolates between its own two moved ends. That last part is what lets two
runs between the same pair of bodies take different factors: on the n narrowed
to 230 the inner run takes 0.846 and the outer 0.895, putting the apexes at 115
and 142.3 against the hand-drawn 115 and 142.

An earlier reading of the same idea, mapping intervals of the axis rather than
walking the chain, does break — two runs project onto one interval and the outer
arch's points inside the right stem's interval freeze. The chain walk does not
have that fault, and the file the feature was designed against reproduces to the
unit.

**Along y the rule cannot hold straights rigid, and this is not a defect.** A
stem is 60 units of width across x and 500 units of length along y. Across x the
width is the drawn detail and the length is free. Along y the same stem is the
length the scale has to change, and in the n the tallest straight body already
spans 500 of the glyph's 516, so freezing it forbids nearly all of the change.
The first vertical build held the curves rigid instead and slid them whole,
which is arithmetically sound and was rejected on sight: it moves the curves and
compresses nothing. What ships is the plain height scale on every on-curve point
with the tension correction on top. A curve keeps its tangents and its tension
but not its proportions, so a round shoulder squashed in height flattens, and
the glyph's width never changes.

Three stand-downs on the horizontal solve, each meaning the rule has nothing to
distribute: a contour with no elastic run, a contour where every run returns to
the body it started from — a stem with a bowl hung off it — and a gap total of
zero.

### The arrow keys

An arrow key is a drag of one grid step, so X means there what it means under the
pointer, and the nudge runs the same target entry. It needs no lock, because an
arrow key names its own axis. Shift stays the step size: the event goes to the
behavior-name resolver without its modifiers, so it cannot be read as the
pointer's constrain.

`scene-controller.handleArrowKeys` builds its own target entries and had never
reached this one. Anything added to the pointer's dispatch has a second dispatch
to be added to, and the two are 300 lines apart in different files.

### Open

- The transform box reads the X state once, at mouse-down. Pressing or releasing
  it during a box drag does nothing until the next drag. The pointer drag
  re-reads it every frame, because it rebuilds its factory on a behavior change.
- The slide's along-the-straight gate may now be redundant. It exists because a
  straight could tilt under a drag, the coupling stops that, and the drag no
  longer slides at all.
- No manual matrix has been run for any of the three halves — drag, scale, arrow
  keys. The plan carries two, of eight rows each, and neither covers the keys.
- The outer-left junction of the n is a corner the demonstration file moved by
  hand, 8.9 units. It no longer slides under a drag, so the question of whether
  it lands where the hand put it now belongs to the scale.
- The architecture map has no F10 row. The inventory in §1 stops at F9, and this
  feature's files are in neither the per-feature map nor the shared-file reverse
  index.

## The documents themselves

Five design specs and implementation plans, 3,783 lines, all describing work that
had shipped, were dissolved into the feature model and the architecture map. **A
plan that outlives its implementation is worse than no plan**: it still reads as
an instruction, and a reader cannot tell which parts are the design of record and
which were withdrawn three rounds ago. The part worth having is the register of
what was tried and rejected on measurement, with the measurement that closed each
one.

**The map named two editor modules that have never existed**, with line counts,
which is what made them credible. Same error as a phantom modifiers file
corrected days earlier, so the map carries a "grep before trusting a filename
here" note rather than just a fixed row.

**A code comment pointed at a deleted spec for several commits.** Cited paths rot
silently.

**Documents that were already unformatted are left that way**, here and at the
segment selection fix, because reformatting buries a change in noise.

---

# Markers

## The anchor check collapsed from three cases to one

The design started with three cases and resplit arithmetic: the count unchanged,
the count changed near the anchor, the count changed elsewhere — with a tolerance
deciding which. Telling a shifted index from a resized contour is a search, and a
search that gets it wrong reports a confident wrong number.

It collapsed to one rule: **the point count under an anchor changes, the marker
goes stale; anything else, it rides the geometry.** A count change on any contour
stales, which is deliberately over-eager.

**What it bought.** No tool that restructures a point list owes marker anchors any
bookkeeping — not the pen, the knife, shape append, delete-selection, paste or
break-contour. The alternative was an audit of every one of them, with a quiet
wrong measurement as the cost of missing one. The donor's generated-contour
indices produced that exact quiet failure twice.

**What it cost.** Inserting a point on a contour stales every marker on it, even
where the curve through the anchor is unchanged. That is an ordinary edit and it
will be felt. Re-anchoring is one click.

**Stale is derived on read, never written.** So an undo past the structural edit
brings the marker back with no code. A stale flag in the file would survive the
undo and leave a dead marker on a healthy contour.

## Reverse contour is the one exception, and it declares rather than fudges

It keeps the point count and the closed flag and turns the point order around, so
every anchor on the contour would name a different place while the signature said
fine. It writes those markers an explicit broken flag in the same change. A
signature written to disagree on purpose would be a signature that lies.

Measured, as the plan asked: a skeleton reversal leaves the centerline as drawn,
so a centerline anchor is safe; it turns the generated outline over at the same
point count, so an anchor on one of those is declared broken too.

## The hit tester does not order its crossings along the ray

Found while testing the double-sided centerline case, which returned null, and
the single-sided case, which returned zero. The crossings come back in the hit
tester's own order, and the winding walk reads a sequence — so measuring outward
from a point **inside** the black picked the span behind the anchor as the one in
front of it.

The Power Ruler never hit this because it always measures a whole line across the
glyph, where the walk's direction does not matter: over a closed path the total
winding is zero, so accumulating in either direction marks the same spans inside.
Measuring outward from an anchor is the first caller that starts mid-line. The
crossings are now sorted along the ray before the walk, which the ruler shares.

## The sweeps

Three, each walking one input in fine steps and measuring the worst single-step
movement of the reported distance against its driver.

| Sweep                                           | Worst single step           |
| ----------------------------------------------- | --------------------------- |
| A moving neighbour, 200 steps of 1 unit         | 0 — follows exactly         |
| Anchor dragged along a straight edge, 260 steps | 0 — constant, as it must be |
| Anchor dragged along a wedge of slope 1-in-2    | 0.5000000000000284/unit     |

The wedge number is the slope and nothing more. Each sweep starts away from a
degenerate configuration, so none reports its own seed as a jump — a fault this
project has recorded twice.

## Deviations from the plan, recorded

**The end field is `segmentIndex`, not the spec's `segmentStart`.** It is what
the nearest-hit returns and what resolution consumes; the other name needs a
translation at both ends for no gain.

**`measureRay` takes a hit tester, not a glyph controller.** `fontra-core` has no
business knowing what a glyph controller is, and the tests build a hit tester in
three lines.

**A stale marker is still resolved where it can be**, so it draws greyed at the
place it used to point and can be re-anchored there. It carries no number: the
number is exactly what must not be trusted. The spec allowed greyed or nothing;
this is the greyed reading, without inventing any stored coordinate to do it.

**`parseSelection` now keeps any non-integer remainder raw**, rather than only
compound keys. Marker ids are names, not numbers, and the old rule turned them
into NaN.

## The count rule was wrong, and use showed it in a day

The one rule — the point count changes, the marker goes stale — was chosen to delete an
obligation: no tool that restructures a point list would owe marker anchors any
bookkeeping. It did delete it. It also broke every marker in a glyph whenever a point was
added anywhere in it, including on a contour the marker had nothing to do with. That is
not a price worth paying; it is a feature that cries wolf until it is switched off.

The replacement keeps the same refusal and moves the question. **An anchor is a place,
not an index.** The signature no longer decides whether a marker is broken — it decides
only whether the indices still mean what they meant, which selects between two readings
of the outline:

- indices intact → the address is the truth, and the marker rides. Points moving under it
  is this case, and it is still free.
- indices moved → check the outline against where the anchor last stood. Still there: the
  address is rewritten. Gone: stale, in place.

**The one stored coordinate.** This needs the anchor's last position on disk, which the
first design forbade outright. The prohibition was against _recovering_ an anchor by
geometric matching — searching among candidates for a plausible one — and that is still
refused. What this does is verify: one question, _is the outline still where this anchor
was_, answered within half a font unit, with no second-best and no fallback. Subdividing
a curve is exact, so an intact outline answers yes however it was resubdivided.

**A test caught the first attempt.** Preferring the remembered position over the live
address made a marker snap back to where the stem used to be instead of riding it — case
1 broken by the machinery meant to fix case 2. The fix is precedence: while the indices
hold, the memory is only a memory.

**Reverse contour stopped being a special case.** It moves no geometry, so the rewrite
handles it like any other index shift. The explicit break it used to need is gone, and
with it the last piece of marker bookkeeping any tool owed.

**Markers drag anywhere now**, onto another contour or off the outline entirely, with the
outline magnetic within reach. That is what makes a stale marker repairable rather than
merely visible, and it is the same gesture either way.
