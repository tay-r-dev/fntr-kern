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

**State: reverted.** Entries 45 to 56 reworked the drawing rule over ten rounds
and did not settle. The comb is back to its state at `2242d76b`.

### Three things the restored comb does differently from the donor

The donor is in `_external/speedpunk`. It states both of its choices plainly.

|               | donor                                                                          | restored comb                                                                                        |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Fringe length | curvature times a fixed gain. Straight proportion, no ceiling, no floor        | divided by the tallest curvature on its own segment, so every segment's peak draws the full height   |
| Colour        | the glyph's own range, gentlest to tightest, recomputed when the glyph changes | each segment's own range                                                                             |
| Sample count  | a budget divided by the number of curve segments                               | that, times the square root of the magnification, with the budget divided by the magnification first |

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

### Rejected drawing rules

We built and measured each one. None is in the tree.

| Rule                                                           | Why it went                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Divide each fringe by the tallest curvature on its own segment | Two segments meeting at equal curvature drew unequal fringe. On glyph `d` the two sides of a joint peak 27 per cent apart. That 27 per cent was the whole of the step on screen. Elsewhere a 2.7 per cent difference in the curve drew as a 21 per cent step, eight times the thing it measures. |
| Divide by the tallest curvature on the glyph                   | Redrawing one segment moved the glyph's peak. Every fringe then changed length at once, and two glyphs never shared one scale.                                                                                                                                                                   |
| A typed reference radius, with a floor and a ceiling           | A readout you must tune before you can trust it is not a readout. The ceiling drew two different curvatures at one length. That is the same false reading the per-segment divisor gave.                                                                                                          |
| Squeeze the height towards twice the peak                      | Nothing clipped and everything flattened. Four times the reference tightness drew 1.6 times the height and eight times drew 1.8: two peaks, one drawn length.                                                                                                                                    |
| Colour straight off the curvature ratio                        | Radius 200 to 30 is the working range of most letters. This rule spent 0.33 to 0.77 of the stops on it, which is one colour to the eye.                                                                                                                                                          |
| Colour off the fringe length, last stop at three peak heights  | An arc with its handles half way out already sat past the middle stop, and everything above handle tension 1 came out identical.                                                                                                                                                                 |
| Colour off the fringe length, last stop at five peak heights   | Better: a well-formed arc read a third along and red waited for tension 1.5. Still absolute, so it painted a whole letter one colour like the two before it. Where a letter's curvature sits depends on the letter.                                                                              |

---

## Harmonize (map F8, carried fork extras)

**State: shipped.** Two constructions, G3 tried first with G2 as its fallback.
It reaches skeleton centerlines as well as ordinary paths.

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

### Known defect, not fixed

**A correction under half a unit reports harmonized and writes nothing.** The correction on the reported joint was 0.46 units. Whole-unit rounding discards all of it. The report should say the correction is below the grid.

### Rejected

| Idea                                                          | Why it went                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bias slider between moving the joint and moving the handles | The values between its two ends were never asked for. Two checkboxes replace it: one picks the target and so the cascade, the other says whether the joint may move.                                                                                              |
| Bound the repair slide's range by the inner handles           | They are what the construction replaces, so their present lengths say nothing about where the joint may go. It stopped the search 25 units short on the overshoot fixture, where the first admissible slide is about 45 units and the shorter inner handle is 20. |
| Harmonize the generated outline                               | It is derived and would be thrown away on the next regeneration. The skeleton's own centerline is an ordinary path and takes the pass unchanged.                                                                                                                  |

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
bound does not bind. A polynomial form is *exactly* the min or the max outside
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
*healthy* contour too. The report that settled it was the designer's: both
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

The ceiling was applied *after* the equalization walk, so the walk balanced a
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
stops the loop from *deciding* when to stop. Both are required and neither
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

**The first coupling rule was too narrow.** Tying only *pairs* of controlled
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

### Segment selection

Clicking a segment selects its two on-curve points, and shift-clicking an
adjacent segment *removed* the point the two shared, so a selection could never
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
failed *silently*: the pin stored, read back correctly, and did nothing, because
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
