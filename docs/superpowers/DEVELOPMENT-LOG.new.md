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

## F3 — SpeedPunk

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

## F9 — Harmonize

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

## F8 — Serif terminal

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
