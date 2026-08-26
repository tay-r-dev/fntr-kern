# Snapping — design spec

**Date:** 2026-08-26. Branch `feature/snapping`.
**Status:** design agreed, numbers not chosen. Retire this file into `FEATURE-MODEL.md` and
`DEVELOPMENT-LOG.md` when the work lands.

---

## 1. What it is

The cursor is attracted to lines and points the editor derives from the drawing. When it is close
enough, the edited point leaves the cursor and sits on the line instead. It then slides along the
line while the cursor moves.

Two kinds of attractor:

- **Permanent guide** — a guideline in the font or glyph data. The designer placed it.
- **Smart guide** — a line the editor derives from existing geometry and discards. Nothing stores
  it.

It applies to the pointer and to the pen. The pointer snaps while dragging. The pen snaps while
hovering, because the preview must show the result before the click.

## 2. What generates a candidate

A candidate is a **line** or a **point**. A line removes one degree of freedom, so the cursor
projects onto it. A point removes two, so the edited point goes there.

| Source | Produces |
| --- | --- |
| Baseline, x-height, cap height | line, horizontal |
| Ascender, descender, overshoot bands | line, horizontal |
| Permanent guides | line, at the guide's own angle |
| Existing on-curve points | line, horizontal and vertical through the point |
| Straight segments | line, the segment extended in both directions |
| Curve segments | line, the endpoint tangent extended in both directions |
| Two lines already in reach | point, at their crossing |

Skeleton geometry and generated outlines are ordinary geometry here. They contribute the same
candidates as any other contour. There are no skeleton-specific candidates.

**Crossings are not enumerated.** N lines give N² crossings. Only the crossing of the two lines the
cursor is already near is ever needed, so it is computed at resolution time and stored nowhere.

**Refuse a shallow crossing.** Two near-parallel lines cross far away and at an angle that carries
no information. Reject the crossing below a stated angle. Precedent: the miter limit of 4 in
`offset-contour.js`, and `MIN_AXIS_TANGENT_SEPARATION_DEG` in the serif.

## 3. The pull model

Every candidate produces a pull at the cursor position.

```
pull = weight × falloff(distance)
```

`falloff` is 1 at zero distance and 0 at the candidate's reach. `weight` comes from the rank table
in §4. The strongest pull wins.

**"No snap" is a candidate.** Its pull rises as the cursor moves away from the currently held
candidate. So a cursor pull that is strong enough overrides a held line, and there is no separate
release rule to write.

**Weight sets reach, not only precedence.** At equal distance a heavy candidate wins. At unequal
distance a light candidate close to the cursor can beat a heavy one far away. Rank decides
near-ties; distance decides the rest.

**Distance is measured in pixels**, so the behaviour holds at every zoom level. Nothing derived from
pixels reaches the stored geometry.

## 4. Ranking

0 is strongest.

| Rank | Candidate |
| --- | --- |
| 0 | Baseline, x-height, cap height |
| 1 | Intersection of two permanent guides |
| 2 | Permanent guide at a right angle |
| 3 | Permanent guide at a slant |
| 4 | Intersection of two right-angle smart guides |
| 5 | Intersection involving a slanted smart guide |
| 6 | Right-angle smart guide |
| 7 | Slanted smart guide |
| 8 | Everything else, including ascender, descender and overshoot bands |

Two rules hold inside each family: an intersection beats a single line, and a right angle beats a
slant.

**The weights are clustered, not evenly spaced.**

| Cluster | Ranks | Weight |
| --- | --- | --- |
| Metrics | 0 | highest |
| Permanent guides | 1, 2, 3 | high, closely spaced |
| Smart guides | 4, 5, 6, 7 | low, closely spaced |
| Everything else | 8 | lowest |

So the rule a designer can hold is: **a guide you placed beats a guide the editor invented.**

Consequence, accepted rather than fixed: a permanent guide near the working area suppresses smart
guides around it. Placing a guide is not free.

Tuning is four cluster weights plus small offsets inside each cluster. It is not nine independent
numbers.

## 5. States

| State | Free to move | Behaviour |
| --- | --- | --- |
| Free | 2 axes | The point follows the cursor. |
| On a line | along the line | The cursor projects onto the line. The point slides. |
| At an intersection | nothing | The point holds the crossing. |

Up to two lines are held at once. The intersection state is what two held lines produce. Losing one
returns the point to sliding along the other.

**No state survives the gesture.** The held candidate is discarded when the drag or the click ends.
The file records coordinates only.

## 6. Exclusions

A point sits exactly on its own horizontal and vertical, so without exclusion it would never come
free.

- The geometry being moved generates no candidates.
- In the pen, the point being placed generates none. The previous point of the chain does, and it is
  the most useful one there. Do not exclude it.
- **Generated geometry derived from the moved geometry generates none.** Dragging a skeleton point
  moves the generated points carrying its provenance, every frame. A guide coming off one of those
  would chase the drag. Provenance answers which points those are; it is a map lookup, per rail R-D.

**Generated geometry is a candidate source, never a snap subject.** The editor may snap a point to a
generated outline point. It may not place a generated point by snapping, because generated geometry
is editable only through its own gizmo and detach routes.

## 7. The grid

Magnetic grid snapping is removed. `edit-behavior.js:29-147` loses `magneticSnapEnabled`,
`toggleMagneticSnap`, its `console.log` and the 35 per cent band.

What remains:

- Ctrl or Cmd held → round to the coarse spacing.
- Otherwise → round to whole units.

**The grid is not a candidate.** It rounds whatever freedom the winning candidate left.

| State | Grid action |
| --- | --- |
| Free | Round both axes. |
| On a line | Round along the line. Leave the perpendicular position alone. |
| At an intersection | Nothing to round. |

On a horizontal or vertical line this is the current behaviour, which is the check that the rule is
the right one. The grid can never be outranked into silence, which is what a fallback needs.

## 8. Drawing

A snap the designer cannot account for reads as a bug. Every held candidate is drawn, and it is
drawn back to the geometry it came from, so the reason is visible.

- A held line is drawn from its source geometry through the snapped point.
- An intersection draws both of its lines.
- Permanent and smart guides are distinguishable, because they behave differently.

## 9. Where the code goes

Per rail R-A.

| Layer | Content |
| --- | --- |
| `fontra-core/src/snapping.js` | Candidate construction, the pull model, resolution. Pure. Mocha. |
| `views-editor/src/snapping-interactions.js` | Gesture state, exclusions, the pointer and pen entry points. |
| `views-editor/src/visualization-layer-snapping.js` | The guide draws. |
| `views-editor/src/edit-behavior.js` | Loses the magnetic code. Keeps grid rounding. |

Skeleton points are written through `editSkeleton` and nothing else (rail R-C). The resolver returns
a position; it never writes.

`views-editor` has no test harness, so the editor half carries a manual matrix (rail R-G).

## 10. Tests

Pure module:

- Nearest wins at equal weight; heavier wins at equal distance.
- A shallow crossing is refused.
- Duplicate candidates at one position collapse to one.
- Projection onto a slanted line is exact before rounding.
- The resolver is a function of the cursor alone. The same input gives the same output whatever
  preceded it, apart from the declared held-candidate bonus.

Sweeps, not single assertions, per the delegation recipe: walk the cursor across a candidate in fine
steps and measure the worst single-step movement of the edited point against the cursor's own step.
The snap itself is a step, so the measurement is of everything else.

## 11. Out of scope

- Origin and advance width as candidates.
- Equal-spacing and equal-size guides.
- Snapping between glyphs, or to a background layer.
- Any stored record that a snap occurred.

## 12. Open

1. **The weight numbers, the falloff shape and the reach.** Tuned against a real glyph, not chosen
   on paper.
2. **Candidate density.** A 40-point glyph gives 80 axis rays, so crossings are available almost
   everywhere and will pull the point to corners nobody asked for. Two possible limits: only
   contours near the cursor, or only extremes and corners rather than every on-curve. This is a
   generation problem, not a ranking problem.
3. **The sub-unit error on a slanted snap.** Coordinates are whole units, so a point projected onto
   a slant is moved off it by up to 0.71 units on emission. Accept it, or refuse to hold a slant
   when the projection would not land on whole units. Recommendation: accept. Refusing makes the
   magnet work at some angles and not others.
4. **The suppress key.** A held modifier that turns snapping off for the duration. Not yet chosen.
   Ctrl is taken by the coarse grid and control-click is already spoken for in this fork.
