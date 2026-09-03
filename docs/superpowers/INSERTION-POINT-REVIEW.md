# Insertion points: what is wrong, and what to do

**Date:** 2026-09-03. Reviewed range `d0a15b8ef..HEAD`, 30 commits, 20 files.

This document is written for the designer, not for a reader of the code. Every
problem below is stated as what you would see in the editor, then as what causes
it. The second half proposes a fix for each one.

This file is temporary. Its durable content belongs in `FEATURE-MODEL.md`,
`FEATURE-ARCHITECTURE-MAP.md` and `DEVELOPMENT-LOG.md`. Delete it once that move
is made. Section 22 covers that move.

---

## The short version

The feature is built on the right foundations. The new geometry sits in its own
core module, exactly the way the serif terminal is built. Every edit goes through
the one skeleton write path. Nothing recovers a relationship by guessing from
coordinates. The hardest trap in the project's history was avoided on purpose,
and the code says so in a comment.

Two things went wrong.

The first is a real defect in the shape. On a segment that an insertion point has
cut, the curvature gizmo reads the wrong curve. It shows a number that describes
the centerline instead of the edge it writes to. Grab that gizmo and the shape
jumps.

The second matters more. That defect was written down as a risk in the plan
before the code was written. Nothing was ever run that could have caught it. No
test touches a curvature gizmo on a cut segment. The manual test list that the
project's own rules say **is** the evidence was never run. So the reasoning that
would have caught the defect now lives only in a plan file, which the project's
convention says to delete, while the four documents that survive say nothing
about this feature at all.

The test suite is green at 2,416 tests, up about 69. The suite grew where the
module was already easy to test. It did not grow where the risk was.

---

# Part one: the problems

## 1. The curvature gizmo on a cut segment shows a number for the wrong curve

**What you see.** Put an insertion point on a curve. The curve is now drawn in
two pieces. Each piece gets its own curvature gizmo. Grab one of those gizmos
and the shape jumps before you have moved the mouse. The number the gizmo shows
is not the number that describes the piece you are looking at.

**What causes it.** Every generated curve carries a note saying which curve it
really is, so that a gizmo measures the same curve the generator will rebuild.
When an insertion point cuts a curve, that note is filled in with the
**centerline**, which is the spine you drew, rather than with the **edge**, which
is the black shape the gizmo actually controls. The two are far apart. On a
stroke 60 units wide they are 30 units apart at every point.

**How far it moves.** Writing back the number the gizmo displays moves the
outline by about 9.6 units at worst. That figure came from a probe run once and
was not repeated, so treat the exact number as approximate. The cause is
confirmed and is not approximate.

**Why this one stings.** The project has recorded this same class of fault twice
before. Once on the serif terminal, worth 9.0 and 7.8 units. Once on the inner
side of a corner, worth 213 and 232 units. The correct way to do it already
exists in the same file, about 2,300 lines away, where a round cap does exactly
the right thing.

## 2. Nothing was run that could have caught problem 1

**What you see.** Nothing. That is the point.

**What causes it.** The plan document states this exact risk in plain words. It
says that a gizmo reading a piece would display a number that means something
else, and that the first drag would jump. An attempt was made to prevent it. No
check was written that could fail if the attempt was wrong.

Three gaps, all confirmed:

- No test anywhere in the change touches a curvature gizmo on a cut segment.
- The test file that owns curvature gizmos was not edited at all during this
  work.
- The manual test list of 14 rows was written and never run.

## 3. The manual test list was never run, and one of its rows is already wrong

**What you see.** The insertion point's width field is editable. The test list
says it should be greyed out.

**What causes it.** The list was written early. The behaviour changed later, on
purpose, and a comment in the panel now argues the opposite. Nobody went back to
the list. Because the list was never run, nobody noticed the contradiction.

The project's rule is that the editor half of the app has no automatic tests, so
a manual list is the only evidence that an interaction works. There is no
evidence for this feature.

## 4. Half the curvature gizmos on a cut segment cannot save what you set

**What you see.** On a cut curve, set the curvature on the second piece. It does
not stick.

**What causes it.** A curvature setting is stored against the point the segment
starts from. For the second piece, that starting point is the insertion point
itself. An insertion point stores five things: its identity, which segment it
sits on, how far along it sits, its width, and its easing. There is no place in
it to keep a curvature. So the setting is written to an address that does not
exist.

## 5. A cut straight line grows four gizmos that do nothing

**What you see.** Put an insertion point on a straight segment. Four curvature
gizmos appear, two per side. They draw on screen. They respond to the mouse
pointer. They refuse every drag.

**What causes it.** The code that decides which gizmos to draw is more generous
than the code that decides which gizmos can be dragged. The drawing code accepts
these four. The dragging code rejects them, because the handles a cut straight
creates are unlabelled.

The project's own rule, written in the feature model, is that a drawn control
that cannot move is worse than no control.

## 6. Insertion points can drift apart between masters

**What you see.** Possibly nothing, for a long time. Then a glyph stops
interpolating between two masters and there is no error message.

**What causes it.** When you add an insertion point, each master mints its own
name for it, counting from its own counter. Deleting one, or editing one from the
panel, then matches those names literally across masters. If two masters ever
disagree about the counter, the edit silently misses in one of them. The two
masters then have different numbers of points and the letter stops interpolating.

Every other part of the skeleton solves this by resolving an address across
masters through a shared helper. That helper has 17 call sites. The insertion
code does not use it. The code right next to the insertion code, in the same
function, does use it.

The mechanism is confirmed by reading. Whether the counters actually drift in
practice was reasoned about, not reproduced. Treat the risk as high and the
trigger as unproven.

## 7. Four pieces of the same geometry now exist in more than one copy

**What you see.** Nothing today. This is the fault that produces tomorrow's
mystery, where the outline and the handles disagree about where something is.

**What causes it.** The project has one rule about this, and it exists because
the older fork had one function written twice and one constant written five
times. The rule is: if a piece of geometry exists anywhere, import it, do not
write it again.

Four breaches, all confirmed:

- The formula for the direction of a curve at a point now exists in four places.
  One of those four is new in this change.
- The code that evaluates a point on a curve was written a second time inside the
  new module. In the same change, a comment was added to the shared copy naming
  insertion points as the exact consumer that must not do this.
- The code that splits a curve in two now exists three times.
- The conversion between a width in units and a width as a ratio exists twice,
  computed two different ways from two different sources, while a comment in the
  panel claims it has one home.

## 8. The name of a selected insertion point is assembled by hand in three places

**What you see.** This already caused one bug, which was found and fixed inside
this range. A selected insertion point did not show that it was selected.

**What causes it.** There is a constant holding the word that names this kind of
selection. It is not shared out of the file it lives in. So three other files
type the word by hand, and one of them also rebuilds the whole name by hand.

## 9. The panel rebuilds the entire letter twice per insertion point, every time it refreshes

**What you see.** The parameters panel feels slow when an insertion point is
selected.

**What causes it.** To show the two width fields, the panel needs to know how
wide the stroke is at the insertion point. To find that out, it regenerates the
whole glyph from the skeleton. It does this once for the left side and once for
the right side, on every rebuild of the panel. Dragging a value adds two more
full regenerations for setup.

The generator is the largest file in the fork, at about 4,700 lines. Running it
to fill in a number in a panel is the wrong cost.

There is a cheaper answer already in the tree. The drawing layer reads the same
quantity from the already-drawn shape. The function that would let the panel do
the same is written, exported, and called by nobody.

## 10. Three things are written and never read

**What you see.** Nothing. Dead code accumulates and misleads the next reader.

**What causes it.** Three cases, all confirmed:

- Two constants define the safe range for where along a segment an insertion may
  sit. Nothing uses them. The range is enforced elsewhere by different numbers.
- A flag marks every generated point that belongs to an insertion point. It is
  written in four places in the working code and read only by tests. The one
  lookup it was created to make unambiguous ignores it.
- A function that computes the width reference is exported and never called. A
  second function, written differently, is what the panel actually uses.

The project's log already counts four of these. This makes seven.

## 11. A constant says zero and two comments say one

**What you see.** Nothing visible. The comments lie to the next reader.

**What causes it.** The length of the small handles created either side of an
insertion point is set to zero. Two comments, one in the source and one in a
test, both say the handles are one unit long. A probe confirmed they sit at
exactly zero length.

## 12. The same limit is written in three and four places

**What you see.** A value that refuses to go where the panel says it can, or a
number box that keeps counting past where the shape has stopped.

**What causes it.** The easing range is clamped in three separate places, plus
the widget has its own range. The width floor of zero is written in four places.

The project's log already records this exact fault under the serif work. The
lesson recorded there was that the limit belongs in the code that writes the
value, and nowhere else. Two rounds were spent chasing a model that was correct,
because a panel was showing a number the model had already rejected.

## 13. One checkbox controls two different things

**What you see.** The checkbox is labelled as a width link. Ticking it also links
the easing on the two sides.

**What causes it.** This one is deliberate. The commit argues it and the code
carries the reasoning. It is listed here only because the label does not say it,
and because the project's log records "one number cannot hold two jobs" as a
lesson paid for five times.

## 14. The permanent documents say nothing about this feature

**What you see.** A future session, or a future you, reads the four reference
documents and finds no trace of insertion points.

**What causes it.** None of the four reference documents was touched during this
work. The counts are zero mentions in the feature model, zero in the development
log, zero in the glossary, and one in the architecture map which is unrelated.

Meanwhile two plan files were added and left in place, totalling 2,583 lines.

The sharpest form of it. The serif geometry module is the pattern this feature
correctly copied. That module is documented in the architecture map with its line
count and its role. The new insertion module, at 556 lines, and its test file, at
450 lines, appear in no document at all.

The project's own rule, written in two places, is that plans are dissolved into
the reference documents when the work ships, because a plan that outlives its
implementation still reads as an instruction and nobody can tell which parts were
withdrawn.

Ten commits in this range are fixes. That is exactly the class of thing the
development log exists to record. None was recorded.

## 15. Smaller items

- A comment in the panel describes a lookup that tries two sources. The code now
  tries one. The comment was left behind by a later fix.
- The new tests in two of the four test files are single-configuration
  assertions. The project's own rule is to test geometry with a sweep, because a
  single assertion has missed nearly every fault in the generator. The tests in
  the new module's own file do this correctly, with sweeps of 400 to 500 steps.
- The negative half of the easing range is exercised by no test that draws
  anything.
- Three guarded exits inside the split can return one side of a stroke cut and
  the other side untouched. That would give the two edges of one stroke different
  numbers of points, which is what breaks interpolation. No input was found that
  reaches any of the three, so this is a reasoned risk and not an observed one.

---

# Part two: what to do

Ordered by cost. The first four are minutes. The fifth is the important one.

## Step 1. Delete the two unused constants

Remove the two constants that define the safe parameter range and are read by
nothing. Two lines. Alternatively apply them where the clamping actually
happens, which is what their own comment says they are for. Pick one. Leaving
both a stated rule and a different applied rule is the worst of the three
options.

Fixes problem 10, first case.

## Step 2. Make the handle-length comments match the constant

The constant is zero. Two comments say one unit. Either change the two comments
to say zero, or change the constant to one and accept that the shape changes.
Changing the comments is almost certainly right, because the shape is correct
today.

Fixes problem 11.

## Step 3. Delete the stale panel comment

Two sentences in the panel describe a lookup that tries two sources. That lookup
was replaced by a single-source one. Delete the two sentences.

Fixes the first item of problem 15.

## Step 4. Remove one of the three easing clamps

The easing value is clamped in the panel, in the write code, and in the model.
The project's own recorded lesson is that a limit belongs in the code that
writes the value. Keep the write code's clamp and the model's clamp, which is the
final gate. Drop the panel's clamp, leaving that line as a plain division by 100.

Fixes half of problem 12. The width floor, written in four places, is worth the
same treatment but is a larger edit.

## Step 5. Publish the correct curve on a cut segment

**This is the headline fix and it is one statement.**

The code that cuts a side already computes the start point, the end point and
the two handles of the piece it produces. It holds all four. Today it throws them
away and publishes the centerline instead. Publish those four points.

The correct precedent is in the same file, where the round cap publishes the
side's own points for exactly this reason, under a comment explaining exactly
this failure.

Fixes problem 1.

## Step 6. Add the one test that fails today

Cut a curved stroke with an insertion point. Read the published curve for the
left side and for the right side. Assert that the two differ.

They are byte-identical today, because both publish the same centerline. That
assertion fails now and passes after step 5. One test, and this class of fault
cannot come back a fourth time silently.

Fixes problem 2 at its root.

## Step 7. Stop drawing the four dead gizmos on a cut straight

The code that lists gizmos to draw checks that a handle has a label but does not
check what the label says. Add one clause rejecting handles whose role is
missing. The four gizmos on a cut straight stop being drawn, which is correct,
because they refuse every drag anyway.

The clause also covers any future unlabelled handle, so this is not a patch for
one case.

Fixes problem 5.

## Step 8. Choose one home for the width reference

Two functions compute the same quantity. One is exported and dead. The other is
live and regenerates the whole glyph to answer.

Two options, and the second is better.

- Delete the dead one and fix the false comment that still points at it. This
  fixes the dead code and leaves the slow panel.
- Promote the dead one, which reads the already-drawn shape, and delete the slow
  one. This fixes the dead code **and** removes the full regeneration from the
  panel refresh.

Take the second. It fixes problems 9 and 10 together.

## Step 9. Share the selection name instead of typing it three times

Share the constant that holds the name out of its file, or add one small helper
that assembles the name. Route the three places that type it by hand through
that. The bug this already caused, where a selected insertion point did not look
selected, cannot come back.

Fixes problem 8.

## Step 10. Collapse the duplicated geometry

Three separate collapses, in order of payoff.

- Share out the function that gives the direction of a curve at a point. Four
  copies become one.
- Import the shared point-on-a-curve evaluator into the new module and delete
  the local one. This removes nine lines rather than adding any. The shared copy
  already names insertion points as the reason it exists.
- Make one shared function that splits a curve at any position. The existing
  half-way splitter becomes a call to it with the position set to the middle.
  Three copies become one.

Fixes problem 7 and satisfies the rule that exists because the older fork
duplicated a function and let the two copies drift apart.

## Step 11. Give the curvature setting a real address on the second piece

Two ways, and either is acceptable.

- Give the second piece's starting point the address of the parent skeleton
  point, so the setting lands somewhere that can hold it.
- Or refuse to offer a gizmo whose segment starts at an insertion point. That
  leaves one working gizmo per original segment instead of two broken ones.

The second option has a side benefit. It requires reading the flag that marks
insertion geometry, which is currently written four times and read never. One
change gives the flag a reader and fixes the defect.

Fixes problems 4 and 10, second case.

## Step 12. Resolve insertion addresses across masters

Route the delete path and the panel edit path through the same helper that every
other part of the skeleton uses to resolve an address across masters. The code
immediately below the insertion code, in the same function, already does this and
is the model to copy.

If there is a real reason insertion names need no such resolution when point
names do, write that reason in a comment instead. Right now a comment asserts
that insertion names are stable across masters the same way point names are,
which is exactly the claim the point code declines to rely on.

Fixes problem 6.

## Step 13. Run the manual test list

Run the 14 rows. Strike row 8, which describes behaviour that was deliberately
changed. Add two rows:

- Grab the curvature gizmo on both pieces of a cut curve and confirm the shape
  does not jump.
- Set a side width to zero, then type it back up, and confirm the field recovers.

Record the result in the development log. Under the project's rules this list is
the evidence that the editor half of the feature works. There is currently no
such evidence.

Fixes problems 3 and the second-to-last item of 15.

## Step 14. Write the feature into the permanent documents, then delete the plans

Five small edits and two deletions.

- Add a row for the new geometry module to the skeleton's file table in the
  architecture map, with its line count and its role, exactly the way the serif
  geometry module is listed.
- Add the new test file to the tests line in the same section.
- Add a passage to the feature model describing what an insertion point is, that
  it cuts the emitted edge rather than the centerline, and that adding one leaves
  the letter unchanged.
- Add a glossary entry. Word it to distinguish this designer-placed insertion
  point from the existing use of "inserted point", which already means something
  else in the feature model.
- Add a development log section for insertion points, narrating the ten fix
  commits in this range. Those are the faults that came back, which is precisely
  what that document is for.
- Then delete both plan files.

Fixes problem 14.

## Step 15. Two remaining items, both optional

- Have the tie-group function work out for itself which segments carry a cut,
  instead of requiring all four callers to remember to pass that in. A comment at
  one call site already warns that the callers must match exactly or the gizmo and
  the outline will disagree about where a rib is. That warning is a design
  problem, not a caution.
- Either split the easing link from the width link, or relabel the checkbox so it
  says it governs both. The current coupling is deliberate and defensible. The
  label is what is wrong.

Fixes problem 13.

---

# What is sound, stated once

The module seam is the right one. The new geometry module is the serif geometry
pattern properly applied, with pure geometry in the module and the splicing kept
in the generator. The 452 lines added to the model are placement, not padding.

Every insertion edit goes through the one skeleton write path. Nothing writes the
stored data directly. Nothing recovers a relationship by comparing coordinates.
The pointer tool is still a thin dispatcher. The modifier key is a named action,
not a raw key check.

The hardest recorded trap in the project, where a new field is invisible to the
generator because nothing copies it across, was avoided on purpose, with a
comment naming the earlier failure.

Point-count stability is genuinely tested with a sweep over 41 values. The
ordering of the authored layers survives the cut. Adding and deleting an
insertion point both span every editable master. The tie rule was generalised in
place rather than copied. The reverted attempt at a separate shortcuts file is
clean and left nothing behind.
