# Tuning snapping

Open **Designspace navigation → Snapping (debug)**. The groups and labels below
match that panel. Every row shows its default and a short explanation. Settings
are saved in this browser. **Reset to defaults** resets these controls and the
separate **Modifier snapping (debug)** switches.

A change is used on the next resolve event. A redraw alone does not recompute a
snap: move the pointer slightly to judge the new setting. Defaults are starting
points for tuning, not measured ideal values.

## Start here

1. Reset. Use a single point near one horizontal guide, then a diagonal and a
   curve extension. Adjust **Base reach** until acquisition feels comfortable.
2. Adjust **Minimum pull** if weak snaps engage too easily. Adjust **Held-target
   bonus** if an acquired snap needs more stability.
3. Drag a selection with widely spaced points. Adjust **Pointer preference** to
   decide how much distant points influence the drag.
4. Move slowly between competing guides, then sweep past them quickly. Tune the
   switching and speed controls separately.
5. Adjust per-kind weights and reaches only after those checks. Increase the
   collection controls only if a useful source is missing.

Repeat at two zoom levels. Reach and pointer speed use screen pixels; zoom
should not change their apparent scale. Change one setting at a time.

## What chooses the winner

Each candidate gets a **raw pull** from its weight and distance, multiplied by
the held-target bonus only at the point that owns the hold. Pull falls smoothly
to zero at that kind's reach. It must be **greater than Minimum pull** to qualify.
The same floor controls acquisition and release.

The **score** is raw pull after the pointer-distance discount. Eligible point
targets, including crossings, take priority over line and curve targets. Within
that class, score wins; distance and coordinates break ties. A held target has
the switching protection described below. Thus the highest raw pull in the
readout is not necessarily the winner.

All valid crossings are compared. Their weight is not a slider for choosing
"crossings versus lines": a crossing that qualifies already has priority.
Setting its weight to zero disables it. Shift uses the same chooser, with
positions constrained before collection. A multi-point winner supplies one
translation for the whole selection.

## Reach and holding

| Slider | Default; range | How to set it |
| --- | --- | --- |
| **Base reach** | 12 px; 1–60 | Raise it if you must aim too precisely. Lower it if guides catch from too far away. Per-kind reaches multiply this value. |
| **Minimum pull** | 0.15; 0–1 | Raise it to reject weak snaps and release sooner. Lower it to allow weaker or more distant snaps. The floor is applied before pointer weighting. |
| **Held-target bonus** | 1.3×; 1–3 | Raise it to strengthen the target already held by its owning point. Lower it toward 1 to make switching easier. It cannot extend a hold beyond the kind's maximum reach. |

Base reach is a maximum, not an acquisition guarantee. At the defaults, a
weight-1 line needs to be within about 11.1 px to clear the 0.15 floor, even
though its reach is 12 px. Raising its weight also changes this effective
distance. Use the reach controls first when distance is the thing to change.

## Selection

| Slider | Default; range | How to set it |
| --- | --- | --- |
| **Pointer preference** | 0.5; 0–1 | At 0, all selected points have equal influence within the target class. At 1, only the point nearest the pointer can win. Between them, distant points receive a lower score. Raise it if the far side of a selection keeps choosing the snap. |
| **Preference distance** | 8 base reaches; 1–20 | The pointer discount grows over this distance, then stops growing. Raise it to keep distant points more competitive; lower it to apply the full discount sooner. Disabled at pointer preference 0 or 1, where it has no effect. |

At the defaults, preference distance is 8 × 12 = **96 px**. Beyond that, a point's
score is half its raw pull. At 1 the nearest-point rule is exact: if that point
has nothing eligible, another point cannot supply the snap. A crossing can
still outrank a line at intermediate preference values because target class is
compared before score. These controls have no effect on a single moving point.

## Movement

| Slider | Default; range | How to set it |
| --- | --- | --- |
| **Acquire at or below** | 600 px/s; 50–3000 | Raise it if snapping engages only after an awkward slow nudge. Lower it if guides grab while you sweep past. Above this speed, no new target is acquired; an existing hold may remain. |
| **Break free above** | 1400 px/s; 200–6000 | Raise it if ordinary fast movement releases a hold. Lower it if a deliberate flick cannot release it. Keep it above the acquisition speed. |
| **Drag-start travel** | 12 px; 0–60 | Raise it if a drag immediately sticks to its starting neighbours. Lower it if short deliberate drags cannot snap. At 0, the first movement event can acquire. |

A flick release needs two steps: settle while holding a target, then move away
from it faster than the break-free threshold. Escape also requires being above
the acquisition speed. Putting the break-free threshold below acquisition does
not allow an escape during slow placement. A finite high value makes escape
harder; it does not switch escape off.

The escaped target is refused until its owning moved point leaves its reach.
Dropping the hold does not erase that refusal. For a crossing, its constituent
guides are refused too.

There is **no idle snap timer**. Stopping immediately after a fast movement can
leave the point unsnapped until another slow event arrives. Drag-start travel is
measured from mouse-down and applies once per pointer drag. It does not affect
pen hover, and returning to the starting position does not re-arm it.

## Switching targets

| Slider | Default; range | How to set it |
| --- | --- | --- |
| **Rival score ratio** | 1.6×; 1–4 | A rival's weighted score must reach this multiple of the held score. Raise it if rivals take over too readily; lower it if deliberate switches feel too hard. |
| **Rival updates** | 4; 1–20 | The same rival must clear that ratio during this many consecutive resolver updates while the held point moves away from its target. Lower it for faster switching; raise it to resist brief movements. |

These are **resolver updates, not display frames or milliseconds**. The delay
therefore depends on event delivery. Returning toward the held target resets
the run. Sliding along it does not build a run. A faint suggested guide is a
rival that has not yet earned the hold.

Two exceptions matter when tuning: a held line may acquire a crossing on that
same line directly, and a target whose raw pull falls below the floor releases
without waiting for a rival. Moving toward a suggestion alone is not enough;
the ratio, update count and movement-away rule must all hold.

## Collection cost

| Slider | Default; range | How to set it |
| --- | --- | --- |
| **Source search radius** | 400 px; 50–2000 | Search around every moved point, after Shift constraining. Raise it if a visible source is missing; lower it to reduce work in dense drawings. Keep it comfortably above the reaches you use. |
| **Ray sources per side** | 1; 1–5 | Keep this many nearest ray sources above, below, left and right, separately for each kind and each moved point. Raise it only if nearer sources hide an alignment you need. More rays also create more crossings. |
| **Candidate limit** | 200; 20–500 | Cap the combined base candidates after collection. Raise it if the limit is hiding needed sources; lower it for dense drawings. It is not a cap on generated crossings: pair work can grow roughly with its square. |

Metrics and explicit guides bypass the radius and side culls. Marked neighbours
bypass the side cull. They still enter the combined cap, which keeps candidates
by weight and then distance to the nearest moved point. Held targets can survive
spatial culling, but cannot survive a mode switch that excludes their kind.
Off-screen geometry is excluded when the scene is built, before these controls.

## Guide types

| Control | Default | Use |
| --- | --- | --- |
| **Allow diagonals** | Off | Offer slanted guides during normal snapping. Hold **R** to request diagonals alone, regardless of this switch. |
| **Off-curve points cast rays** | Off | Let handle positions offer horizontal and vertical alignment rays. Enable it when handle alignment is useful. |
| **Allow curve extensions** | Off | Offer the continuation of cubic curves beyond their endpoints. Hold **T** to request only these extensions. If both mode keys are held, curve extensions win. |
| **Curve extension per end** | 1; 0.25–4 | Raise it to continue farther beyond each endpoint. Lower it if the continuation extends beyond the area you need. This is a curve-parameter interval, not a physical length or a segment count. |

The drawn cubic occupies parameter 0 through 1. An extension value of 1 offers
−1 through 0 and 1 through 2. It adds a full parameter interval at **each** end;
it does not mean "double the physical curve length." Changing the value also
replaces a held curve with the new extension. The drawn segment itself is not a
curvature target. Curve-line intersections are not generated.

## Weights and reach multipliers

Every kind has both sliders. All weights range from **0 to 1.5**, in steps of
**0.01**, so the 1.05 crossing default is selectable. Every reach defaults to
**1× Base reach**. Reach multipliers range from **0.25 to 4**, except own generated
outline, whose maximum is **3**. The panel shows the multiplier and its distance
in pixels.

| Kind (panel suffix) | Default weight | When to adjust |
| --- | --- | --- |
| **upright** | 1 | Horizontal and vertical metrics, placed guides, point rays and edges. Raise reach if these need to catch sooner; lower weight if they dominate other line or curve kinds. |
| **diagonal** | 0.8 | Slanted guides and edges. Raise weight if eligible diagonals lose too often; lower reach if nearby slants catch unintentionally. |
| **crossing** | 1.05 | Controls qualification and competition with an existing hold. Lower reach if crossings pin points from too far away. Lowering a positive weight does not remove their priority over lines once they qualify. |
| **off-curve point** | 0.7 | Rays cast by handles. Enable their switch first. Raise weight or reach only if those alignments are useful but too hard to acquire. |
| **curve projection** | 1 | Cubic extensions. Enable their switch or hold T. Raise reach if the extension is hard to aim at; raise weight if it loses to nearby lines during normal snapping. |
| **own generated outline** | 0 | The frozen outline produced by the dragged skeleton. Raise weight to align against that outline; leave it at 0 to ignore it. Other generated outline remains ordinary geometry. |
| **alignment band** | 0.3 | Overshoot bands beside font metrics. Raise reach if useful bands are hard to find; lower weight if they compete too much with the metric itself. |

A weight of **0 disables that kind**. A weightless line also cannot contribute
to a crossing. For a free crossing, both lines must clear their own eligibility
checks and the crossing must clear its own reach and minimum pull. Under Shift,
the fixed rail is already required, so its crossing with an offered line is
evaluated directly using the crossing settings.

Weights compare targets in the same class. Increasing a line's weight cannot
make it outrank an eligible unheld point target. Increasing a reach widens its
falloff without changing its zero-distance weight. Both can affect the outcome;
use reach for distance and weight for relative influence.

## Modifier snapping (debug)

These switches live in a separate accordion. A modified drag keeps its own
geometric constraints and grid rules; enabling snapping does not replace them.

| Switch | Default | Drag |
| --- | --- | --- |
| **Alt** | Off | Alt equalize |
| **Alt: corners snap** | On | Alt with only corner points selected |
| **Snap during a fixed-rib drag (D / S)** | Off | D or S; also shown in Snapping and smart guides |
| **Z (tangent rib)** | Off | Tangent rib |
| **X (tension-aware)** | Off | Tension-aware |
| **C (power tension-aware)** | Off | Power tension-aware |
| **A (independent rib)** | Off | Independent rib |
| **V (point slide)** | Off | Point slide |
| **B (handle length)** | Off | Handle length |

Enable one at a time and judge it in that drag. Disable it if the snap fights the
gesture. Corners have no tangent for Alt to preserve, so their exception starts
on. Modifier switches are read on each resolve event.

## Readout and indicator

- **candidates:** base candidates after collection; excludes generated crossings
  and any held target restored after culling.
- **freedom:** `free`, `line` or `point`. `line` can also mean a Shift rail without
  an acquired snap; check the winner and source fields.
- **winner:** the kind that took the snap. Crossings report `intersection`.
- **source:** the winning point's 1-based position in the moving selection list,
  not its glyph point ID. A dash means no acquired target.
- **raw pull:** the winning pull, including its hold bonus, before pointer weighting.
  Compare this with **Minimum pull**.
- **score:** that pull after the pointer discount. This is what the rival ratio
  compares. Class priority and hold protection also affect the winner.
- **Best raw pull per kind:** the strongest evaluated pull across moving points,
  with hold bonuses. This reuses the resolver's results. The rows can refer to
  different points and are not a final ranking of winners.

The ring grows faintly as a candidate approaches, tightens at the final snapped
position, and fades on release. Faint dashed lines or curves show a suggested
rival. For ordinary point edits and both pens, the displayed snapped position
is preserved through placement instead of being rounded again across the guide.
