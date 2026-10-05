# The snapping parameters

What each slider in **Designspace navigation → Snapping (debug)** does, and what
happens when you move it. The panel writes to the live numbers, so a change takes
effect on the next frame. **Reset to defaults** puts them all back.

The default values are the starting point, not the answer. They were chosen on
paper. Tuning them against a real glyph is the point of the panel.

---

## How a snap is decided

Every candidate — a metric line, a guide, a ray off a point, a segment extended —
produces a **pull** at each moving source:

- The **weight** says how much that kind of candidate is worth.
- The **falloff** says how much of that weight survives the distance. It is full
  at zero distance and nothing at the reach.

Results must clear the release floor. A point target or valid crossing takes
precedence over a line or curve; within that class the strongest pull wins,
after the pointer-distance discount. A held result keeps the hold and overrule
rules below. All crossings are compared, so list order does not decide placement.
The same chooser runs for free movement, Shift and a whole selection.

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

## Acquire below speed (px/s)

**Default 600.** Above this pointer speed no new snap is taken up. Whatever is
already held stays held.

This is what stops a guide you sweep past from grabbing the cursor on the way by,
which is the usual cause of jitter. Below the threshold you are placing a point.
Above it you are travelling, and a magnet that fires while travelling is noise.

Inkscape does the same thing and calls it postponing the snap. Its threshold is
much lower, near a standstill, because it pairs the hold with a watchdog timer
that fires the snap once motion stops. This editor resolves on pointer motion and
has no such timer, so the threshold sits higher: stopping dead has to leave a
slow frame behind it for the snap to be taken.

- **Too small:** snapping only engages when you are almost still, and stopping
  dead may leave the point unsnapped until you nudge it.
- **Too large:** the threshold never bites, and guides grab as you sweep past.

## Break free above speed (px/s)

**Default 1400.** How fast you must leave a guide to break free of it.

Breaking free is a gesture in two parts, and both are needed so that ordinary
dragging cannot do it by accident:

1. **Settle** on the guide. Any frame slower than the acquire threshold above
   arms the escape.
2. **Leave it fast.** While armed, moving away from that guide above this speed
   releases it at once, without waiting for the pull to fall under the release
   floor.

The guide you escaped is then refused until the cursor has left its reach, or it
would simply take the point back on the next frame.

Inkscape has no equivalent. It holds no snap between frames, so it has nothing to
break free of — it recomputes from scratch every time, and escaping means either
moving out of tolerance or switching snapping off.

- **Too small:** an ordinary quick drag throws the snap away.
- **Too large:** you cannot flick free, and have to drag out past the reach.

Set it above the top of the slider's useful range to switch the gesture off and
rely on the release floor alone.

## Free travel at drag start (px)

**Default 12.** How far the cursor must travel from where the drag started before
snapping engages. Measured in screen pixels, like the reach.

A point usually starts on guides from its neighbours. Without this zone, a snap on
the first frame holds the point where it stands, and a small move does nothing.
Inside the zone the point follows the cursor freely and no ring shows. After the
cursor leaves the zone once, snapping works as normal for the rest of the drag,
including a return to the start.

Only the pointer tool's drag has this zone (`SnappingSession.resolveSet`). The pen
and the skeleton pen snap on hover, so they have no drag start.

- **At 0:** the old behavior. The first frame can snap.
- **Too small:** the neighbours' guides still catch the point before it leaves them.
- **Too large:** a short, deliberate drag onto a nearby guide does not snap.

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

**Default 400.** How far from each moving source geometry is collected. Under
Shift, these are the constrained positions, not the raw cursor positions.

Point, segment and curve sources must be near at least one moving source.
Metrics and explicit guides are exempt. This is a cost control; keep it
comfortably wider than the snap reach.

- **Too small:** guides stop appearing near the edges of the working area.
- **Too large:** a dense glyph slows the drag down.

A guide you already hold is exempt. Sliding far along one takes its source out of
range, and the snap must not drop because of that.

## Sources per side

**Default 1.** How many points on each side of each moving source may offer a ray.

A 40-point glyph would otherwise offer 80 lines, and crossings would be available
almost everywhere. Only the nearest source above, below, left and right survives.

- **At 1:** the nearest point in each direction only. Clean.
- **Higher:** more alignment options, and more accidental crossings.

Metrics and guides you placed are never culled this way. There are few of them,
and you put them there.

The cull runs **per kind and per moving source** (`collectCandidates`). Its
results are united before the cap. One source's nearest ray cannot hide the
better alignment at a different selected point, and kinds do not hide each other.

The neighbours of the dragged points are exempt (`alwaysKeep`). They are what the
designer aligns to, so a nearer point elsewhere must not hide them.

## Candidate cap

**Default 200.** The hard ceiling on the candidate list, after the culls.

Kept in weight order, then distance to the nearest moving source, so the cap takes the least useful
candidates first. You should not need to touch it. If you hit it, lower the
collection radius instead.

## The seven kinds

A kind is a **direction, not a source** (`KIND` in `snapping.js`). A metric, a
guide you placed, a point's own ray and a skeleton rib end all pull the same when
they run the same way. The source decides only how the line is drawn: a metric
or a placed guide draws solid (`permanent`), a derived ray draws faint. Three
kinds are not directions. Each is a class of source that you switch on and off
as a whole.

| Kind                  | Weight | What it is                                                          |
| --------------------- | ------ | ------------------------------------------------------------------- |
| Upright               | 1.0    | Any horizontal or vertical line: metrics, guides, point rays, edges |
| Diagonal              | 0.8    | Any slanted line: slanted guides and edges. Off by default          |
| Crossing              | 1.05   | Where two lines meet. Just above either line alone                  |
| Off-curve point       | 0.7    | Rays from handles. Off by default                                   |
| Curve projection      | 1.0    | A curve carried past its own end. Off by default                    |
| Own generated outline | 0      | The outline the drag is making. Collected, and never wins at 0      |
| Alignment band        | 0.3    | The overshoot bands of the alignment zones                          |

A metric and a guide you placed no longer outrank a derived ray. They are all
"upright" or "diagonal". An older version of this guide described clusters by
source (metric, placed, derived, skeleton). That model is gone.

**Own generated outline** is the geometry that follows the point being dragged:
move a skeleton point and its outline moves with it. Raise its weight to place a
skeleton point by the edge it makes rather than by the centerline. The rest of
the generated outline is ordinary outline and answers to the other kinds.

A weight of 0 means it: a weightless line is also refused as one half of a
crossing, so a kind cannot come back in through the crossing weight.

## Weights

The relative worth of each kind. They decide only near-ties: a light candidate
close to the cursor still beats a heavy one far away.

**Raising a weight to get more reach is the wrong move.** It also changes who
wins ties. Use the kind's own reach below.

## Reaches

One per kind, as a **multiple of the master reach** above. The readout beside
each slider shows the multiple.

This is the knob to use when a kind must grab from further away without also
winning ties it must lose. Raising a weight does both at once.

- **Below 1:** that kind engages only when you are already close. Useful for the
  bands and for diagonals, which are the usual source of snaps nobody asked for.
- **Above 1:** that kind catches early. Useful for curve projections, which you
  aim at on purpose.

## Switches

These sit in the same panel as the numbers, and **Reset to defaults** resets them
too.

- **Diagonals (shift+R).** Offers the diagonal kind. Hold the "snap to diagonals
  only" key to get diagonals and nothing else, whatever the switch says.
- **Off-curve points cast rays.** Offers the off-curve kind. A handle states a
  direction rather than a place, so it is off by default.
- **Curve projections (hold T).** Offers the curve-projection kind. Hold the
  "snap to curve projections only" key to get projections and nothing else. If
  both keys are down, projections win.
- **Projection length (segments).** How far a projection runs past each end, in
  the curve's own parameter. 1 doubles the curve.

## Modifier snapping (debug)

A separate accordion, one switch per modified drag (`dragSnapPolicy`). A modified
drag states its own geometry, and a magnet that moves the point fights it. So
every switch is off by default, except one.

| Switch                               | Default | Drag                                               |
| ------------------------------------ | ------- | -------------------------------------------------- |
| Alt                                  | off     | Alt drag (equalize)                                |
| Alt: corners snap                    | **on**  | Alt drag where every dragged point is a corner     |
| Snap during a fixed-rib drag (D / S) | off     | D and S. Also shown in "Snapping and smart guides" |
| Z (tangent rib)                      | off     | Z                                                  |
| X (tension-aware)                    | off     | X                                                  |
| C (power tension-aware)              | off     | C                                                  |
| A (independent rib)                  | off     | A                                                  |
| V (point slide)                      | off     | V                                                  |
| B (handle length)                    | off     | B                                                  |

A corner has no tangent for Alt to hold, so an Alt drag of corners only snaps
like a plain drag. The switches are read on every frame, so a key pressed in the
middle of a drag takes effect on the next frame.

---

## The readout

Below the sliders, updating live:

- **candidates** — how many survived both culls this frame. Watch this while
  moving around a dense glyph to see whether the culls are doing their job.
- **freedom** — `free` (nothing held), `line` (on a guide, sliding along it), or
  `point` (on a crossing, pinned).
- **winner** — which kind took the snap; a crossing reports `intersection`.
- **pull** — the winning pull. Compare it against the release floor to see how
  close you are to letting go.
- **the ranked list** — each kind's strongest evaluated pull across the moving
  sources, including hold bonuses. It reuses the resolver's evaluations; it
  does not project the candidates again at the cursor. Pointer discounts and
  hold protection also affect the winner.

## The ring

- **Opens outward** when a candidate comes near, faint, growing with the pull.
- **Pulls in tight** and firms up when the snap takes.
- **Goes slack and fades** when you leave.

A faint dashed line that is not the guide in force is a **suggestion**: a rival
that is currently stronger but has not earned the overrule yet. Move toward it
and it will take over.
