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
