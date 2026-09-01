# Serif axis tilt

**Source:** `_external/serif-lab-2.html`, the second lab. **Target:** `serif-geometry.js`,
`skeleton-model.js`, `skeleton-generator.js`, `panel-skeleton-parameters.js`.

---

## 1. What the lab does, and what of it we are building

### The lab's three new numbers

Lab II adds a **Frame** group of three fields on top of the v1 nine. All three live in
`makeWing`, which is nine lines:

```js
function makeWing(st, originY, inward) {
  const oy = originY - inward * st.backset; // backset
  const a = (st.axisTilt * Math.PI) / 180; // tilt
  const cos = Math.cos(a),
    sin = Math.sin(a);
  const dsign = st.depthSign * inward; // depth direction
  return (p) => {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;
    return V(rx, oy + dsign * ry);
  };
}
```

`W` is applied to the **tip points only** — `tipOuter` and `tipInner`. The corner, the release
and the two bracket controls are computed in glyph space at `flankX = hw*dir`, untouched by all
three. The lab states that split in its own comment: "The wing lives in the rotated terminal
frame. The bracket release lives on the stem flank, in glyph space, untouched by tilt."

**axisTilt** rotates the wing's own coordinate system by a signed angle. It is stated relative to
the perpendicular, not in glyph space, so it follows the stroke.

**depthSign** flips which way `p.y` grows in glyph space: `+1` into the stroke, `−1` against it.
With `−1` the wing block sits on the far side of the terminal plane while the release stays down
the stem, so the bracket sweeps from the stem, out past the terminal, to a tip standing above it.
That is the lab's "reverse block" and its lowercase entry serif.

**backset** slides the frame origin along the stroke, outward positive, so the wing can sit past
the terminal even at `depthSign` `+1`.

### What our generator already has

Our terminal is the same v1 construction with one thing the lab does not have: the **wall**. The
lab's flank is the line `u = ±hw`. Ours is the real stroke edge as solved from the centerline and
the widths, in frame coordinates, and every point the terminal shares with the stroke is found ON
it — the corner by a ray, the junction and the release by lengths along it. §8 of the feature
model holds the rule and §9 holds the two constructions it replaced.

Our frame already rotates. `axisMode` is `perpendicular`, `horizontal`, `vertical` or `absolute`,
and the last three all put the axis off the stroke's perpendicular. So the work the lab's tilt
would demand — a frame whose depth no longer agrees with the stroke direction, and a wall that
therefore has to be met rather than assumed — is **already done and already tested**. That is why
this is a small change.

What we do not have is a rotation stated **relative to the rib**. `absolute` names a glyph-space
angle, so on a leaning or interpolating stroke it does not follow the stroke; the lab's tilt does.

### What we are building

**One new mode, `tilt`, and one new terminal field, `axisTilt`.** The mode takes the perpendicular
axis — the rib, which is where a rib angle lock lands — and rotates it by `axisTilt` degrees. Every
other mode ignores the field. `perpendicular` is exactly `tilt` at 0, and stays the default, so the
tilt is opt-in and nothing already drawn moves.

**The rotation is applied in the frame's own sense, after the axis has been oriented toward the
contour's left.** Positive tilt turns the axis toward the stroke on the left side: the left wing
climbs the stem and the right one drops away from it. Applied before the orientation flip it would
read one way at a start terminal and the other way at an end terminal, on one and the same stroke.

The 15-degree axis-tangent separation still runs, after the tilt. A tilt large enough to lay the
axis along the stroke is clamped by the guard that already exists, continuously, exactly as an
`absolute` angle is.

Everything downstream is frame-relative and follows for free: the tip, the corner ray, the wall
meeting, the reach and ease lengths along the wall, the cup. Nothing in the generator learns about
the tilt beyond passing the number through.

### What we are NOT building, and why

**depthSign — not built.** Question asked, answer stated.

In the lab it turns the wing block inside out so the serif body grows away from the stroke. It
works there because the lab has no wall: its flank is a line at a fixed `u` and its release is
placed by arithmetic, so nothing cares which side of the terminal plane the tip is on.

In our generator the terminal is defined by the wall. The wall runs from the rib end **into** the
stroke, and every one of the serif's shared points is found on it — that is the release rule, and
it is the one mistake this feature has already made and reverted twice (feature model §9: "Build
the serif terminal against the cut it made in the EMITTED edge", and "Place the serif's shared
points on a straight flank line from the rib end"). Growing the body against the stroke means
finding a corner and a release on a wall that does not exist out there, which is to say inventing a
straight line from the rib end — the exact construction closed on 2026-08-08 because it is the wall
only on a straight stem.

There is a real shape behind the switch, and it is the reverse block / lowercase entry serif. It is
a **second feature**, not a sign flip: it needs a stated answer for what the terminal attaches to
on the outward side. It is not in this plan.

**backset — not built.** Not asked for, and it has the same shape of question: sliding the origin
outward by `b` puts the wing at negative depth and leaves the terminal joined to the stroke by the
two brackets alone. It composes with the tilt rather than competing with it, so it can be added
later without reworking this.

---

## 2. Constraints this change must not break

- **Point count is unchanged.** The tilt rotates a frame; it emits nothing and removes nothing.
  Seven on-curves per terminal at every tilt.
- **The release stays on the wall.** The tilt turns the frame the wall is expressed in. It does not
  move the release off it.
- **`perpendicular` is byte-identical to `tilt` at 0**, and every existing serif fixture is
  unmoved. This is the evidence that nothing drawn moves.
- **The frame stays orthonormal** at every tilt, as it does in every existing mode.
- **The tilt negates under a determinant flip**, like `axisAngle` and `capAngle`. Derivation: a
  mirror maps the frame to `(−M(axis), M(depth))`, because the axis is re-oriented to the new left
  while depth still points into the stroke. A tilt of `θ` on the old frame is a tilt of `−θ` on
  that one. `wingSlope` and `tipCutAngle` do not negate, because swapping the halves is their whole
  correction; the tilt belongs to the terminal, which has no half to swap.
- **A preset carries no tilt.** A preset places nothing — it holds no `axisMode` and no
  `axisAngle`, for the reason in feature model §8, and the tilt is the same kind of number.

---

## 3. Steps

### Step 1 — the frame (`fontra-core/src/serif-geometry.js`)

`computeSerifFrame` gains `axisTilt` and the `tilt` mode. Reorder so the tilt lands after the
orientation:

1. `outward = normalize(tangent)`
2. raw axis for the mode — `tilt` returns the same rib normal `perpendicular` does
3. orient the axis toward the normal (**moved up** from after the separation)
4. rotate by `axisTilt`, in the axis→depth sense, when the mode is `tilt`
5. `separateFromTangent`
6. orient again — the separation builds its axis off the tangent angle and can return either
   direction, so the second pass is what keeps positive `u` on the left. It is a no-op whenever the
   separation did not fire.
7. depth as now

Tests, in `tests/test-serif-geometry.js`:

- a tilt of `θ` puts the axis exactly `θ` off the perpendicular
- tilt 0 reproduces `perpendicular` on a leaning stroke
- the tilt reads the same at a start terminal and at an end terminal of one stroke — the test that
  would fail if the rotation ran before the orientation
- the tilt follows the stroke: sweep the tangent, and the angle between the axis and the rib holds
- the axis stays 15 degrees off the tangent at a tilt that would lay it along the stroke
- orthonormal under `tilt`, added to the existing every-mode loop
- **a sweep**, per the log's own rule rather than an assertion: tilt from −80 to 80 in half-degree
  steps on a curved wall, measuring the worst single-step movement of the emitted terminal points
  against the step. It must stay small through the separation guard's boundary, which is the one
  place a clamp could have introduced a step.

### Step 2 — the model (`fontra-core/src/skeleton-model.js`)

- `"tilt"` into `VALID_SERIF_AXIS_MODES`
- `"axisTilt"` into `SERIF_TERMINAL_FIELDS`, treated like `axisAngle`: a non-finite value keeps
  what is stored rather than writing zero, because a summary slider over a mixed selection delivers
  an empty value and zeroing every terminal from it is not what the designer touched
- `normalizeSerif` defaults it to 0
- `mirrorSkeletonPointMetadata` negates it, beside `axisAngle`
- it stays out of `SERIF_PRESET_FIELDS`

Tests: normalization default, the writer, the mirror negation, and that a preset does not carry it.

### Step 3 — the generator (`fontra-core/src/skeleton-generator.js`)

One line in `buildSerifCap`: pass `axisTilt: pointSerif?.axisTilt ?? 0` into `computeSerifFrame`.
Nothing else in the generator changes. `canonicalToGeneratorInput` copies `point.serif` whole, so
the new field travels — but this is the trap feature model §7 records, so verify it rather than
assume it.

### Step 4 — the panel (`views-editor`)

- `panel-skeleton-parameters.js`: a `tilt` option in the axis select; a summary slider for
  `serif:axistilt` shown when the mode is `tilt`, in the place the `absolute` angle slider takes;
  the field-change branch; the streaming branch beside `axisangle`
- `skeleton-panel-model.js`: `axisTilt: terminal("axisTilt", 0)`
- `lang/en.js`: `serif-axis.tilt` and `serif-axis-tilt`

Range −90 to 90, step 1, matching the existing angle field. No new clamp: the separation guard is
the only limit, it is the same one `absolute` has always had, and inventing a second number for it
is how one number comes to hold two jobs.

### Step 5 — docs and the manual matrix

`FEATURE-MODEL.md` §8: the tilt in the frame section, and in the list of ways the axis comes to be
not square to the tangent. `DEVELOPMENT-LOG.md`, serif section: what the lab's three fields are and
why two of them are not here — so nobody derives the depthSign answer again.

Manual matrix owed (rail R-G): tilt a foot serif on an upright stem and on a stem leaning 20
degrees; tilt both ends of one stroke and check the two read the same way; tilt with a rib angle
lock on; tilt with one half collapsed; tilt past the guard and back; mirror a tilted terminal;
switch a tilted terminal to `absolute` and back.
