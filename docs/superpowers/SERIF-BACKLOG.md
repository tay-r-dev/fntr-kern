# Serif terminal — open work

Standing reference for everything still to decide or build on the serif cap
style. Companion to feature model §8 (what the serif is and what must not
change), arch map §7 (open residue), development log entries 20–28 (how it got
here).

Items are ordered by **how much of the code's structure has to move**, deepest
first, with blocking relationships allowed to override that order. The numbering
here is this document's own; the origin of each item in the original list is
noted so it stays traceable. **A number is stable once assigned** — the table is
re-sorted as items arrive, so a new item keeps the next free number wherever it
lands in the order, and commits and notes referring to an item stay valid.

Status legend: **open** = agreed, not started · **undecided** = needs a decision
before it can be planned · **specced** = design written, no task plan yet ·
**planned** = spec and plan written, not built · **done** = built and kept here
for its findings.

| #   | Item                                               | Depth             | Origin | Status |
| --- | -------------------------------------------------- | ----------------- | ------ | ------ |
| 15  | The cup sits off-center when one side is collapsed | terminal geometry | new    | open   |

Items 1 through 14 are all closed. Their entries were deleted rather than kept
here: what they built is in the feature model, why it was built that way is in
the development log, and the entries themselves are in git history.

### Ground rule: points collapse, they do not disappear

Every point a serif can emit is emitted at every parameter value, including
values where it has nowhere to go and lands on top of its neighbour. **A serif is
allowed to collapse points to zero distance — on-curves and off-curves alike —
and the one-unit minimum separation that applies elsewhere does not apply
inside a terminal.** Coincident points and zero-length segments are the correct
output, not a degenerate one.

That is what keeps point count constant across the whole range, which is the
cross-master interpolation contract. Removing them is opt-in per master via
`serifRemoveCollapsedPoints`, and taking that option forfeits interpolation for
serifed glyphs in that master — already stated at the source-default.

Consequences when planning anything below:

- A new field never needs a minimum value to keep its points apart. Zero is
  always a legal setting and must emit the same points as any other setting.
- "Switched off" means contributing no _shape_, not contributing no _points_ —
  the obligation a wingless half already carries (feature model §8).
- A discontinuity in a coupled parameter is a jump in shape only, never a jump in
  topology. That makes it a drag-feel problem, not an interpolation problem.

---

## 15. The cup sits off-center when one side is collapsed

**Reported bug, not a new feature.** It contradicts a decision the feature model
states, so read that decision before you change anything.

### What is wrong

The underside cup is one curve across the whole terminal, tip to tip. Its lowest
point sits on the **skeleton endpoint**. Feature model §8 says so, and gives the
reason: the axis modes routinely produce unequal halves, and a centre anchored at
the midpoint of the two tips would drag the contact geometry off the alignment
zone as the axis rotates.

Single-sided mode breaks that reasoning. All of the width moves to one side, so
the other side lies on the skeleton and its half of the serif collapses to zeros
(dev log §29, item 1). The terminal is then entirely on one side of the skeleton
endpoint. The cup's lowest point lands on the terminal's **edge** instead of its
middle, and the foot reads as a lopsided scoop.

### Expected

The cup's lowest point sits at the centre of the serif.

### The decision this needs first

Those two rules agree on a symmetric terminal and disagree everywhere else. Pick
one statement that covers both cases, rather than adding a single-sided branch to
the cup (rail R-E).

Two candidates:

- **The centre of the foot the serif actually draws.** Correct here. Check it
  against the case §8 rejected it for: sweep the axis through the tilted modes and
  measure whether the contact point leaves the alignment zone.
- **The skeleton, offset by the collapsed side's own half-width.** Keeps the
  alignment-zone guarantee on a two-sided terminal and re-centres the one-sided
  one. It is the same number in both cases, which is the sign it may be the rule
  §8 was reaching for.

### Constraints that still hold

Point-count stability across every parameter value, including a collapsed side and
a zero cup. Whatever the centre becomes, both wings still emit all of their points.
Test the count directly (feature model §8), do not infer it from the shape.
