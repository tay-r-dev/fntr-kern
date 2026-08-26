# The snapping parameters

What each slider in **Designspace navigation → Snapping (debug)** does, and what
happens when you move it. The panel writes to the live numbers, so a change takes
effect on the next frame. **Reset to defaults** puts them all back.

The default values are the starting point, not the answer. They were chosen on
paper. Tuning them against a real glyph is the point of the panel.

---

## How a snap is decided

Every candidate — a metric line, a guide, a ray off a point, a segment extended —
produces a **pull** at the cursor:

- The **weight** says how much that kind of candidate is worth.
- The **falloff** says how much of that weight survives the distance. It is full
  at zero distance and nothing at the reach.

The strongest pull wins, if it clears the release floor. So weight decides
near-ties, and distance decides everything else.

Distance is measured in screen pixels, not glyph units. The magnet grabs from the
same distance on screen at every zoom level.

---

## Reach (px)

**Default 12.** How far a candidate can pull from, in screen pixels.

This is the master scale. Every other number is judged against it, so tune this
first and re-check the rest afterwards.

- **Too small:** you have to aim. The magnet feels dead.
- **Too large:** everything grabs. Points land on guides you were not thinking
  about, and free movement near geometry becomes impossible.

## Release floor

**Default 0.15.** The pull a candidate must beat to count at all.

This is also the release rule. A held guide's pull falls as you move away from
it, and when it drops under this floor the point comes free. There is no separate
release setting.

- **Too small:** snaps hang on far past where you meant to leave them.
- **Too large:** the magnet lets go the moment you move, and weak candidates
  never engage.

## Hold bonus

**Default 1.3.** How much extra weight a candidate gets while you are already on
it.

This is what stops the point flickering between two candidates of nearly equal
strength. The one you are on has to lose by more than this before anything else
takes it.

- **Too small:** flicker between neighbors.
- **Too large:** snaps feel glued, and moving off one takes a shove.

## Anchor vs multi-point

**Default 0.5.** The balance between snapping by one anchor and snapping by the
whole selection.

When you drag several points, every one of them is asked where it would like to
land, and the strongest answer moves the whole selection. This number discounts
each answer by how far that point is from the cursor.

- **At 0:** pure multi-point. The strongest alignment anywhere in the selection
  takes the drag, however far it is from your hand.
- **At 0.5:** a distant point has to be roughly twice as good to take the drag.
- **At 1:** single anchor. Only the point nearest the cursor is asked at all. If
  that point has nothing in reach, the drag snaps to nothing, rather than
  borrowing an alignment from the far side of the selection.

Both ends are exact behaviors, not just steep settings of the same discount.

This has no effect when you drag a single point.

## Anchor preference range (reaches)

**Default 8.** How far from your hand, counted in reaches, the preference above
stops growing. It does nothing at either end of the balance slider — only in
between.

Past this distance every point is discounted the same. Below it the discount
grows with distance.

- **Small:** the preference for your hand hits full strength almost immediately,
  so only nearby points compete.
- **Large:** the discount grows slowly, so far points stay competitive.

## Overrule margin

**Default 1.6.** How much stronger a rival must be before it can take a snap you
already hold.

Once you are on a guide, another guide crossing your path does not steal the
point. It is drawn faintly as a suggestion instead. To take over, it must beat
what you hold by this factor **and** satisfy the frame count below.

- **Too small:** heavy candidates like metrics keep stealing light ones.
- **Too large:** you cannot move from one guide to a neighbor without leaving the
  snap entirely first.

## Overrule frames

**Default 4.** How many frames running a rival must lead, while you are moving
away from the guide you hold, before it takes over.

The two conditions together are how the editor tells a guide you passed through
from a guide you chose. Sliding along a held guide keeps your distance to it at
nothing, so nothing counts and nothing is stolen. Moving off it raises that
distance every frame, which is what deciding looks like.

- **Too small:** a stray movement hands the snap away.
- **Too large:** switching guides feels like it is ignoring you.

## Collection radius (px)

**Default 400.** How far from the cursor geometry is looked at at all.

Nothing outside this radius contributes a candidate. It is a cost control, not a
behavior control — set it comfortably wider than the reach.

- **Too small:** guides stop appearing near the edges of the working area.
- **Too large:** a dense glyph slows the drag down.

A guide you already hold is exempt. Sliding far along one takes its source out of
range, and the snap must not drop because of that.

## Sources per side

**Default 1.** How many points on each side of the cursor may offer a ray.

A 40-point glyph would otherwise offer 80 lines, and crossings would be available
almost everywhere. Only the nearest source above, below, left and right survives.

- **At 1:** the nearest point in each direction only. Clean.
- **Higher:** more alignment options, and more accidental crossings.

Metrics and guides you placed are never culled this way. There are few of them,
and you put them there.

## Candidate cap

**Default 200.** The hard ceiling on the candidate list, after the culls.

Kept in weight order, then distance order, so the cap takes the least useful
candidates first. You should not need to touch it. If you hit it, lower the
collection radius instead.

## The nine reaches

One per kind of candidate, as a **multiple of the master reach** above. The
pixels each one comes to are shown beside its slider, and they all move when you
move the master reach.

This is the knob to use when a kind should grab from further away without also
winning ties it ought to lose. Raising a weight does both at once, which is why
it is the wrong tool for that job.

Worked example: metrics that catch early without overpowering a nearby guide.
Set **Reach: metric** to 2 and leave every weight alone. The baseline now pulls
from twice as far, and a guide at the same distance still beats it.

- **Below 1:** that kind only engages when you are already close. Useful for the
  bands, and for slanted smart guides, which are the usual source of snaps
  nobody asked for.
- **Above 1:** that kind catches early. Useful for metrics, which are the lines
  a designer aims at deliberately.

## The nine weights

The relative worth of each kind of candidate. They only decide near-ties: a light
candidate close to the cursor still beats a heavy one far away.

They are clustered rather than evenly spread, so that one rule survives:
**a guide you placed beats a guide the editor invented.**

| Cluster           | Default weights | Meaning                                |
| ----------------- | --------------- | -------------------------------------- |
| Metric            | 1.0             | Baseline, x-height, cap height         |
| Guides you placed | 0.84 – 0.76     | Crossing, then right angle, then slant |
| Guides derived    | 0.52 – 0.40     | Crossing, then right angle, then slant |
| Other             | 0.3             | Ascender, descender, overshoot bands   |

Inside each cluster two rules hold: a crossing beats a single line, and a right
angle beats a slant.

**Raising a weight to get more reach is the wrong move.** It also changes who wins
ties. If a kind needs to grab from further away while still losing ties, use its
own reach above.

One consequence, accepted rather than fixed: a guide you placed near the working
area suppresses the derived guides around it. Placing a guide is not free.

---

## The readout

Below the sliders, updating live:

- **candidates** — how many survived both culls this frame. Watch this while
  moving around a dense glyph to see whether the culls are doing their job.
- **freedom** — `free` (nothing held), `line` (on a guide, sliding along it), or
  `point` (on a crossing, pinned).
- **winner** — which kind took the snap.
- **pull** — the winning pull. Compare it against the release floor to see how
  close you are to letting go.
- **the ranked list** — every kind's strongest pull this frame. A near-tie here
  is what the weights exist to break, so this is where to look when a snap picks
  something you did not expect.

## The ring

- **Opens outward** when a candidate comes near, faint, growing with the pull.
- **Pulls in tight** and firms up when the snap takes.
- **Goes slack and fades** when you leave.

A faint dashed line that is not the guide in force is a **suggestion**: a rival
that is currently stronger but has not earned the overrule yet. Move toward it
and it will take over.
