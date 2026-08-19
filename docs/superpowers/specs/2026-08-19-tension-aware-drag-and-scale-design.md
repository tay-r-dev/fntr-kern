# Tension-aware drag and scale — design

**Date:** 2026-08-19. **Branch:** `feature/tension-curvature-aware-scale`.
**Status:** design agreed, not built.

Retire this file when the work ships. Its durable content goes to a new feature model section and
to a new log section, the same way the base-curve expansion spec was retired.

---

## 1. What it is

Hold **X** and drag, or hold **X** and pull a transform handle. Every curved segment that the edit
reaches keeps its drawn shape instead of going slack or pinching.

Today a drag on one end of a curve carries that end's own handle and leaves the far handle where it
was. The chord changes length and one handle does not. The curve flattens on the far side and fills
out on the near side. X removes that.

**The invariant, in one sentence: no handle turns, every handle keeps its tension, and a tension
point slides along its straight to keep its segment's tangent corner in proportion.**

X does not replace any existing behavior. The ordinary rules run first and decide where every point
and handle goes. X then corrects handle lengths and slides tension points. Smooth points stay
colinear, straights stay straight, and shift-constrain still constrains, because X touches no angle.

## 2. The three rules

### Rule 1 — no handle turns

X changes handle lengths and nothing else. It never rotates a handle and never moves an on-curve
point, except for the one slide in rule 3.

This is what keeps every existing behavior intact. A smooth joint on the boundary of the selection
cannot break, because neither of its two handles changes direction.

### Rule 2 — each handle keeps its tension

Extend a curved segment's two end tangents until they cross. That crossing is the segment's Tunni
point. A handle's tension is how far it reaches from its own on-curve point toward that crossing, as
a fraction. X reads both fractions before the edit and reproduces them after it.

Picture a quarter circle. It starts at the bottom with a vertical tangent and ends at the right with
a horizontal tangent. The two tangents cross at the corner between them. Both handles reach 55
percent of the way to that corner.

Now drag the right end 100 units further right. The corner does not move, because neither tangent
turned. The vertical leg is therefore unchanged, so the bottom handle keeps its length. The
horizontal leg doubles, so the right handle doubles. What comes out is the same quarter shape
stretched sideways — a quarter ellipse. Without X the right handle stays where it was, and the curve
goes slack at exactly the end that moved.

**A segment with both ends in the selection needs no special case.** Both ends take the same delta,
so the crossing translates with them and both legs keep their length. The handles come out
unchanged. "Fully selected segments are just moved" falls out of the rule rather than being written
into it.

**Where the crossing is unusable, fall back to the chord.** Two tangents that are parallel never
cross. Two that cross behind an endpoint give a leg that points the wrong way, and a crossing far
past the segment gives a length that swings wildly for a small input move. In all three cases X
scales the handle by the chord's own length ratio instead. The two answers agree exactly whenever
the corner stays in proportion, which is the ordinary case, so the switch is invisible there.

### Rule 3 — a tension point slides along its straight

A **tension point** is a smooth on-curve point that carries one handle, with a line segment on its
other side. It owns no direction of its own: smoothness forces its handle colinear with that line,
so the line sets the direction. This is the same rule that ties skeleton ribs across a straight.

Such a point may slide **along its own straight**. The slide changes the straight's length and never
its angle.

**How far it slides.** Take the segment's tangent corner again. One leg runs from the tension point
to the crossing, along the straight. The other runs from the far end to the crossing. The far end
moves, so its leg changes length. Multiply the near leg by the same ratio, and put the tension point
at the end of it. The corner is then in proportion, and with rule 2 the whole segment is the same
drawing at a new size.

Picture the arch of an **n**. Measured on `_external/skeletron.fontra/glyphs/a.json`, the inner arch
runs from a tension point on the left stem's inner wall at height 385, up to an apex 65 units to the
right at height 463. The tangent at the tension point is vertical, the tangent at the apex is
horizontal, and they cross directly above the tension point. The vertical leg is 78 and the
horizontal leg is 65.

Drag the apex 10 units left. The horizontal leg becomes 55, a ratio of 0.846. The vertical leg
becomes 66, so the tension point rises 12 units to height 397 and the stem's inner wall grows 12
units taller. The apex radius goes from 73.6 to 62.3, which is the original radius at the new size.
That is the arch keeping its shape and the stem absorbing the difference.

Without the slide the tension point stays at 385, the vertical leg stays at 78 against a horizontal
leg of 55, and the apex radius drops to 52.7. The arch tightens by 28 percent and reads pinched.

**One hop, always.** A slid tension point does not start a chain. The segment on its other side is a
straight, and a straight has no shape to preserve. If that straight ends at another tension point,
that point's own curve did not move, so nothing propagates. The reach of one edit is therefore the
selection plus one tension point per affected segment.

**The slide moves points outside the selection.** This is deliberate and it is what the arch case
asks for. It is stated here so nobody reports it as a defect.

**Two bounds.** A slide may not pass the far end of its own straight, and it may not run the
straight to zero length. Where the bound bites, the slide stops there and the corner is no longer in
proportion, so the segment's shape is no longer preserved. A point that is itself in the selection
moves with the edit and does not also slide.

## 3. What this feature is not

**It is not content-aware scale.** The demonstration in `a.json` narrows an **n** by 20 units while
both stems keep their 60-unit width. Stem preservation is a one-dimensional layout problem over the
whole glyph, and it breaks where two runs project onto the same interval of the scale axis — the
left stem of an **n** and the shoulder above it are the standard case. That is a separate feature
with its own decision to make. This one scales stem widths like any other scale, and only keeps the
curves' shape.

Also out of scope: skeleton centerlines, quadratic segments, and generated contours. The first is a
later decision, because every skeleton write goes through the one skeleton write path and the
outline regenerates behind it. The second has implied on-curve points that no corner can be measured
against. The third is derived geometry and no editing tool touches it.

## 4. Corner cases

| Case                                                      | What X does                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Smooth point on the selection boundary                    | Nothing. No handle turns, so colinearity cannot break                        |
| Corner point between two half-selected curves             | Each segment sets its own handle. A corner promises nothing about its sides   |
| Off-curve point in the selection                          | The ordinary rules move it. X reads the tension before the edit, not after    |
| Both ends of a segment selected                           | The handles come out unchanged, by rule 2                                     |
| Tension point in the selection                            | It moves with the edit and does not slide                                     |
| Tangents parallel, or crossing behind an end              | Chord-ratio fallback, rule 2                                                  |
| Endpoints land on the same place                          | No chord and no corner. The segment is left alone                             |
| Mirrored or zero scale factor                             | Falls into the two rows above rather than needing its own case                |
| Quadratic segment                                         | Left to the ordinary rules                                                    |
| Generated contour                                         | Skipped                                                                       |
| X pressed or released mid-drag                            | Read per frame, like the other realtime keys                                  |

**Grid rounding.** Handles round to whole units on every frame. Every frame must be computed from a
copy of the path as it stood at mouse-down, never from the frame before it. Otherwise a slow drag
and a fast drag ending in the same place give different shapes, and undo restores the second-to-last
frame. Base-curve expansion shipped this fault once.

**Point count is unaffected.** X inserts and removes nothing, so the interpolation contract is not at
risk.

## 5. Where the code goes

| File                                              | Role                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/tension-aware-edit.js`           | **NEW.** Pure geometry: which segments are affected, the tension restore, the slide, the two bounds           |
| `fontra-core/tests/test-tension-aware-edit.js`    | **NEW.** Unit tests and sweeps                                                                                |
| `views-editor/src/tension-aware-editing.js`       | **NEW.** Behavior-name resolution and the target entry, for both the delta path and the transformation path   |
| `views-editor/src/edit-behavior.js`               | Two behavior types, plain and shift-constrained, both carrying the ordinary match tree                        |
| `views-editor/src/edit-tools-pointer.js`          | X key state, dispatch on drag, and the entry on the transform box                                             |
| `views-editor/src/editor.js`                      | The realtime action, default shortcut **X**                                                                   |
| `fontra-core/assets/lang/en.js`                   | The shortcut's name                                                                                           |

**Rails this obeys.** Pure geometry in core with tests, interaction in its own editor module, and
the pointer left as a dispatcher (R-A). The Tunni point and the tension calculation are imported
from `tunni-calculations.js`, which is their one home, and are not derived again (R-B, D5). The
match tree stays as it is and the whole correction runs in a target entry, so no kind decision
enters the shared emit code (R-E).

**Why a target entry and not a rule.** The rules table decides one point from its neighbours. This
rule needs both ends of a segment and both of its handles as one unit. Base-curve expansion sits in
the tree for the same reason.

**How the entry sees the ordinary result.** Entry changes are consolidated after the path change, so
the entry may assume the ordinary edit has landed. It reproduces that edit on a scratch copy of the
pre-drag path, using the ordinary behavior for the same selection, and corrects from there. The
correction is written as absolute positions, so applying it after the path change is exact. The
rollback is recorded against the pre-drag copy, so undo restores the whole gesture.

## 6. Testing

**Core, automated.** The restore and the slide are pure, so they take ordinary unit tests: the
quarter-ellipse case, a segment with both ends moved, each fallback, each bound, and a tension point
that is in the selection.

**Core, sweeps.** Per the architecture map, a geometry change is tested with a sweep and not with a
per-configuration assertion. Hold the geometry fixed, walk the drag through its range in fine steps,
and measure the worst single-step movement of any output point against the step that drove it. Start
away from degenerate configurations. Sweep both directions and both sides.

**Editor, manual matrix.** `views-editor` has no harness (R-G), so the interaction half owes a
matrix: drag one end of a curve, drag a whole segment, drag across a smooth boundary, drag with the
key pressed and released mid-drag, scale from the transform box, scale with shift, and undo after
each.
