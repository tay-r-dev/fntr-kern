# Backlog

**Date:** 2026-09-02. Written on `fix/skeleton-backlog`, verified against the tree at `6ee54dc3c`.

What is wanted and not built. Each row states what you would see, what it costs, and where it
lands. **This is a backlog, not a spec.** A row marked architectural owes its own design document
before any code.

A row is here because somebody asked for it or because a measurement found it. A shape we
deliberately do not draw belongs in the feature model's rejected table instead, and the two must
not disagree: where a row and that table name the same subject, the table records the approach that
was closed and the row records the shape that is still wanted.

| #   | Item                                        | Status | Size              | Owns                                         |
| --- | ------------------------------------------- | ------ | ----------------- | -------------------------------------------- |
| S1  | The serif body grows against the stroke     | open   | **architectural** | `serif-geometry.js`, `skeleton-generator.js` |
| S2  | Backset — the terminal sits past the stroke | open   | **architectural** | `serif-geometry.js`, `skeleton-generator.js` |
| S3  | The tip's line stops crossing the wall      | open   | bounded           | `serif-geometry.js`                          |
| S4  | The corner ray runs parallel to the wall    | open   | bounded           | `serif-geometry.js`                          |
| S5  | The manual matrix for the axis tilt         | open   | bounded           | manual only (rail R-G)                       |

All five came out of the axis tilt, `docs/superpowers/plans/serif-axis-tilt.md`, and its source
`_external/serif-lab-2.html`. S1 and S2 are the two of the lab's three frame numbers that are not
here. S3 and S4 are what the tilt sweep measured on the way past its own range.

---

## S1 — The serif body grows against the stroke

The lab's **depth direction**, and the shape behind it is the lowercase entry serif, or the
reverse block.

**What you would see.** A head serif whose block sits above the stem top rather than inside it. The
bracket sweeps from the stem, out past the terminal, and up to a tip standing clear of it. Serif
Lab II reaches it with `depthSign: -1`, and every one of its head-serif presets uses it — Garamond
entry, Steep blade, Slab reverse.

**Why the sign flip is not the implementation.** The lab flips which way `p.y` grows and nothing
else, because it has no wall: its flank is the line `u = ±hw` and its release is placed by
arithmetic, so nothing there cares which side of the terminal plane the tip is on. Our terminal
finds every point it shares with the stroke ON the wall — the corner by a ray, the junction and the
release by lengths along it — and outward of the rib end there is no wall to find them on.

Inventing one is the straight line from the rib end, and that construction is closed
(feature model §9, 2026-08-08: it is the wall only on a straight stem, and on a curved one tip
thickness reshaped the stem by up to 23 units).

**What the design owes an answer to.** What the terminal attaches to on the outward side, stated
so that the release rule still holds — the terminal meets the stem where the stem actually is, and
the wall it meets is the wall as solved from the centerline and the widths. Three candidate
readings, none of them settled:

1. The terminal still releases on the real wall, at a release **inside** the stroke, and only the
   wing and the tip live outward. That is what the lab actually draws: its `cornerY` and `release`
   use `inward` and ignore `depthSign` — only `tipOuter` and `tipInner` go through the rotated,
   signed frame. So the bracket spans from a release down the stem to a tip above the terminal.
   **This is the reading to try first**, because nothing has to be invented: the wall is the wall,
   and the tip simply sits at negative depth.
2. The wall is extended past the rib end by its own tangent. Closed as a construction, unless
   something states why an extension is not the straight-flank model wearing a hat.
3. A second wall, solved outward from the terminal. There is no stroke out there to solve one from.

**What it must not break.** Seven on-curves at every parameter value. The tip limit — the top of
the tip stands straight above the wing's end and stops where the wall crosses that line — has no
meaning when the tip is on the far side; state what replaces it rather than dropping it.

**Also decide** whether this is a fourth axis-adjacent mode, a per-half flag, or a terminal-level
one. The lab makes it terminal-level.

---

## S2 — Backset: the terminal sits past the stroke

The lab's third frame number. `backset` slides the frame origin along the stroke, outward positive,
so the wing can sit past the terminal at ordinary depth.

**What you would see.** The whole terminal lifted off the end of the stroke, joined to it by its
two brackets alone. The lab's head presets pair it with the depth flip — 22 units on Garamond
entry, 60 on Steep blade, 70 on Slab reverse — but the two are independent numbers.

**Where our frame stands today.** The origin is the skeleton endpoint, full stop
(`computeSerifFrame`, `origin = endpoint`). A backset of `b` moves it outward, so the wall's foot
lands at `v = b` and the wall runs inward from there, while the tip sits at `v = 0` — outside the
stroke.

**Why it is architectural rather than one line.** Nothing in `makeSerifWall` assumes the wall
starts at zero depth, so the wall itself is probably fine. What is not settled is what the shape
means: at a backset the corner ray from the tip has to cross a gap before it reaches the wall, the
wing's inner corner lands high on the stem, and the underside cup spans two tips standing off the
end of the stroke. Whether that reads as a serif or as two spurs is a question for a drawing, not
for a plan.

**It composes with S1 rather than competing with it**, and it composes with the tilt the same way.
Do S1 first: reading 1 above is the same geometry question one step further on, and an answer there
probably answers this row too.

---

## S3 — The tip's line stops crossing the wall

**What you would see.** Dragging the axis tilt, the terminal steps: the wing's inner corner jumps
about 40 units up the stem, in one frame. On the wall the tilt sweep was run against that is at
about 47 degrees.

**The angle is the wall's, not the feature's.** Where the tip's line and the wall reach tangency is
set by how hard the wall curves, so a stroke curved harder reaches it sooner. Do not read 47 as a
range the shape is safe inside — see the note at the end of S4.

**What it is.** `buildHalfSerif` limits the tip's thickness by where the wall crosses the line
standing straight above the wing's end (`wall.meetRay({u: tipU, v: 0}, {u: 0, v: 1})`). As the
frame turns, that line and the wall approach tangency: the crossing slides down toward the wall's
foot, the corner comes with it, and then the ray misses the wall entirely. `meetRay` returns null,
`tipLimit` becomes `Infinity`, the tip unclamps, and the corner jumps back to
`wall.parameterAtDepth(tipThickness + wingSlope)`.

Measured on a curved wall at wing 40, tip 20, slope 20, reach 30, ease 12: the left corner runs
`(74.1, 0.1)` at 47.0 degrees and `(120.8, 40.0)` at 47.5.

**This is not the tilt's.** The same configuration is reachable through an `absolute` axis at the
same effective angle, and it predates the tilt.

**The shape of a fix.** A near-tangential crossing is the same species as the tangent-ray
intersection in the offset construction, which is floored rather than trusted (feature model §3.2,
and log round 1). The answer is probably to decide when the tip's line no longer meaningfully
crosses the wall and to make the transition to "no limit" continuous, rather than to let a null
return flip a branch. **A threshold with a slope is not the answer** — that is the eased ceiling,
withdrawn twice.

---

## S4 — The corner ray runs parallel to the wall

**What you would see.** The terminal steps again, and harder: about 127 units in one frame, at
about 66 degrees on the wall the tilt sweep was run against.

**What it is.** The wing's inner corner is where the wing's top surface meets the wall
(`wall.meetRay(tipTop, cornerRay)`, with `cornerRay = {u: -side * wingLength, v: wingSlope}`). The
ray's angle is fixed by the wing — `atan(wingSlope / wingLength)` — while the wall's angle in the
frame turns with the tilt. They become parallel, and the meeting point runs away before the ray
misses the wall altogether.

Measured on the same geometry: the left corner runs `(-95.9, 97.7)` at −67 degrees and `(19.9,
45.9)` at −66.5. With slope 20 over wing 40 the ray sits 26.6 degrees off the axis, which puts the
parallel at a tilt of about −63 — so **where this bites is set by the wing's own proportions**, not
by a fixed angle.

**Not the tilt's either**, for the same reason as S3, and the two are probably one piece of work:
both are `meetRay` asked a question near tangency.

**Note for whoever takes it.** `meetRay` scans 256 samples and bisects the first sign change. Near
parallel the sign change is genuine and the answer is genuinely far away; the fault is not the
search. What is missing is a statement of when the wing's top surface stops meeting the wall in any
useful sense.

### Both of them fire inside the range the panel offers

The 47 and the 66 above were measured on one wall. They are properties of that wall, and a stroke
curved harder reaches both sooner. On `_external/problem-glyphs/braceright.json`, an Egyptian foot
at wing 20, tip 20, slope 20, this row's own step lands at **28 degrees of tilt** and is worth 77
units — inside the ±40 the panel offers.

So the tilt has no safe range to state, and the earlier claim that it moves smoothly out to 40 was
one sweep's configuration read as a property of the feature. Whoever takes S3 and S4 should measure
on a strongly curved stroke as well as a gentle one, and should not restore an angle to the panel
or to the docs as though it were a bound.

### Not an item: the snap at 38 degrees

The third step the sweep found, about 29 units at around 38 degrees, is the wing being swallowed by
the stem. That one is deliberate, documented and correct — feature model §8, "This is the one place
a serif snaps." The two shapes either side of it are each right and there is no in-between surface
to slide along. **Do not file it.**

---

## S5 — The manual matrix for the axis tilt

`views-editor` has no test harness (rail R-G), so the panel side of the tilt is covered by nothing.
Owed, and listed in the development log's serif section:

- tilt a foot serif on an upright stem, and on a stem leaning 20 degrees
- tilt both ends of one stroke, and check the two read the same way
- tilt with a rib angle lock on
- tilt with one half collapsed
- tilt to either end of the range and back
- mirror a tilted terminal
- switch a tilted terminal to `absolute` and back

The two rows worth doing first are the second and the sixth. Both test a rule that was reasoned
rather than seen: that the rotation lands after the axis is oriented, and that the tilt negates on
a determinant flip.
