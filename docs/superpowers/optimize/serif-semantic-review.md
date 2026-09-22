# Serif code: semantic review

**Date:** 2026-09-23. **Branch:** `feat/width-rate-axis`, at `5f5069663`.
**Scope:** `fontra-core/src/serif-geometry.js`; `buildSerifCap`, `mergeSerifEasings`,
`applySerifAuthoredHandles`, `applySerifPinnedCurvature` and the two serif cap branches in
`fontra-core/src/skeleton-generator.js`; the serif writers and presets in
`fontra-core/src/skeleton-model.js`; the serif panel code in `views-editor/src/`.
**Companion:** `serif-ponytail-review.md` in this folder covers size and duplication only. This
document covers behavior: what the code tries to do, and where it does not do it.

## How this review was made

The aim of each part was inferred **from the code**: its guards, its clamps, the values it
records, the comments beside the code, and how two paths treat the same data. The reference docs
were not used as the statement of intent, because they have drifted from the code (Part C lists
where they disagree). Each fault in Part B was measured with a probe script against the real
modules, not only reasoned. The probe scripts are at the end of this file, so the numbers can be
reproduced.

Line numbers are from the commit above and will drift. Function names are the stable anchors.

---

## Part A — What the code aims to do

1. **A terminal frame that does not flip.** `computeSerifFrame` builds `u` (across, positive toward
   the contour's left) and `v` (depth, into the stroke), orthonormal. The depth sign comes from the
   neighbouring on-curve (`continuation`), not from the tangent, and the axis is rebuilt from the
   depth at the end. Every step is there so that the frame cannot turn 180 degrees as the stroke
   moves.
2. **Build on the wall as it was solved.** `buildSerifCap` takes the terminal segment of each side
   as it is before any hand edit, and makes it a `makeSerifWall` in frame coordinates. Every point
   the serif shares with the stroke (corner, junction, release) is found ON that wall. The side is
   then split at the release parameter, and the part that is left is emitted unchanged.
3. **Consume the terminal segment and nothing more.** `MAX_CONSUMED_FRACTION = 0.95` caps the wall.
   `buildHalfSerif` limits `reach` to the room left above the corner, and limits `easeDistance` to
   the bracket chord and the room left above the junction. It records that it limited them
   (`depthClamped`).
4. **The same points for every value.** `buildSerifTerminal` always returns 19 points (7
   on-curves). Zero is a legal value everywhere, and a side that is switched off gets a half of
   zeros (`SERIF_HALF_ZEROS`), which still emits all its points.
5. **Hand edits apply to the part that survives the cut.** The generator holds back the attached
   handle offsets and the pin on a serif's terminal segment (`authoredKeys`, near L4375 and L4453).
   It applies them after the splice (`applySerifAuthoredHandles`, then
   `applySerifPinnedCurvature`), so that they cannot move the release.
6. **Optional merge of a fully eased corner** (`simplifyEasing`). When the easing has used up the
   whole bracket, `mergeSerifEasings` replaces the wall's last piece plus the rounding with one
   curve, fitted by the editor's point-deletion fit and harmonized (G2) to the segment before it.
7. **The panel shows what draws.** The serif writer limits `undersideCupBalance` "so the number the
   panel shows is the number that draws" (`setSkeletonSerifParameters`, L3187-3191), and the panel
   limits `tipCutAngle` to `MAX_TIP_CUT_ANGLE` for the same reason.

---

## Part B — Where the code does not achieve its aim

Priority: B1 to B4 are behavior faults. B5 to B8 work but are weaker than they need to be.

### B1. Tip thickness is not limited to the wall (fault)

**Aim it breaks:** A3. Reach and ease are limited to the terminal segment. Tip thickness also uses
up wall, but it is not limited.

**Code** (`serif-geometry.js`, `buildHalfSerif`, L516-522):

```js
const tipThickness = wantedTipThickness;          // no limit
const tipU = wall.pointAt(wall.parameterAtDepth(tipThickness)).u + side * wingLength;
...
const tipTop = { u: tipU, v: tipThickness };        // stands at the requested height
```

`parameterAtDepth` stops at the wall's deepest point (`peakParameter`), so `tipU` is read from the
top of the wall. But `tipTop.v` is still the requested thickness. The corner, junction and release
all stay on the wall, at or below its usable depth.

**Measured** (probe A): a straight wall 30 units deep, wing 20, slope 10, reach 10.

| tip thickness | tipTop v | corner v | junction v | release v |
| --- | --- | --- | --- | --- |
| 20 | 20 | 28.5 | 28.5 | 28.5 |
| 30 | 30 | 28.5 | 28.5 | 28.5 |
| 40 | 40 | 28.5 | 28.5 | 28.5 |
| 60 | 60 | 28.5 | 28.5 | 28.5 |

From about 28.5 up, the bracket runs DOWN from the top of the tip to a junction below it. The
outline folds back over itself. This happens only when the terminal segment is short compared with
the tip, for example a short straight at the end of a stroke.

**Fix suggestion.** Limit the tip to the wall's usable depth, and report the limit with the other
two:

```js
const tipThickness = Math.min(wantedTipThickness, wall.maxDepth);
...
const depthClamped =
  wantedTipThickness > tipThickness || wantedReach > reach || wantedEase > easeDistance;
```

- `Math.min` is continuous, so it adds no jump. The point count does not change.
- `cutOffset` reads `tipThickness`, so it follows the limit automatically.
- Check whether the limit should leave room for the corner above the tip, that is
  `wall.maxDepth - Math.max(wingSlope, 0)`. Decide with a sweep of tip thickness on a short wall.
  The worst single-step movement must stay at grid size.
- Add a test: on a 30-unit wall, `tipTop.v <= corner.v` for every tip thickness from 0 to 80.

### B2. A detached handle on a serif terminal is not absolute (fault)

**Aim it breaks:** A5, together with the generator's own meaning of "detached". On the ordinary
path a detached handle is an absolute 2D position measured from the rib point, and it is placed
after every other layer (`startDetachedAnchor: ribStart` near L4438, and the comment near L4534:
"a detached handle is absolute and never met the ceiling").

**Code** (`skeleton-generator.js`, `applySerifAuthoredHandles`, L911-928):

```js
const baseLength = adjustment.detached ? 0 : (point.x - anchor.x) * axis.x + ...;
const adjustmentLength = Math.hypot(adjustment.x || 0, adjustment.y || 0);
const adjustmentSign = (adjustment.x || 0) * axis.x + (adjustment.y || 0) * axis.y < 0 ? -1 : 1;
const requested = baseLength + adjustmentSign * adjustmentLength;
const clamped = Math.min(Math.max(requested / domain.startReach, 0), domain.maxStartTension)
  * domain.startReach;
points[index] = { ...point, x: Math.round(anchor.x + axis.x * clamped), ... };
```

For a detached handle this does three things that the ordinary path does not do:

1. It measures from `anchor`, which is the release (the cut point), not the rib point.
2. It keeps only the length of the stored 2D offset, and throws away its direction. The handle is
   put on the cut's tangent.
3. It limits the length to the non-crossing range.

**Measured** (probe B): the curved top terminal of the `l` test stroke. The left `out` handle is
stored as `{ x: -12, y: 20, detached: true }`. Only the tip thickness changes.

| tip thickness | detached handle | attached handle | no offset |
| --- | --- | --- | --- |
| 10 | 260, 534 | 122, 632 | 140.8, 618.7 |
| 20 | 252, 539 | 118, 628 | 137.2, 615.0 |
| 40 | 234, 549 | 110, 619 | 129.9, 607.1 |

An absolute handle would stay at the rib point plus the offset, (278, 472) + (−12, 20) = (266, 492),
at every tip thickness. It moves about 30 units instead, and is not near that position at all.

**Fix suggestion.** Carry the rib point to the post-splice pass, and place a detached handle from
it, exactly as the ordinary path does:

```js
// at emission, beside the existing `_authoredAdjustment` stamp (near L4555):
if (authoredKeys?.has(`${owner?.id}/${side}/${role}`)) {
  const adjustment = getGeneratedHandleAdjustment(owner, axis, side, role);
  if (adjustment) generated._authoredAdjustment = adjustment;
  if (adjustment?.detached) {
    const rib = role === "out" ? ribStart : ribEnd;   // the ordinary path's detached anchors
    generated._detachedAnchor = { x: rib.x, y: rib.y };
  }
}

// withRoundCapProvenance must copy `_detachedAnchor` like `_authoredAdjustment`,
// and the strip at L231 must delete it.

// in applySerifAuthoredHandles, before the attached branch:
if (adjustment.detached && point._detachedAnchor) {
  points[index] = {
    ...point,
    x: Math.round(point._detachedAnchor.x + adjustment.x),
    y: Math.round(point._detachedAnchor.y + adjustment.y),
    _provenance: authoredProvenance,
  };
  continue;
}
```

Things to check when doing this:

- Check that `ribStart` and `ribEnd` near L4438 are the construction rib points before any slide.
  That is what the ordinary path uses.
- The release is emitted as a smooth on-curve, so `enforceSmoothColinearity` may turn a handle
  there. Check what the ordinary path does with a detached handle beside a smooth point, and do the
  same thing here.
- The detach toggle in the editor converts a position into an offset and checks the result against
  a regeneration (development log, "Detaching moved handles"). With this fix that check has a
  simple target. Run the toggle on and off on a serif terminal handle: the handle must not move.
- Add a test: repeat probe B and expect the detached handle to stay the same over the tip thickness
  sweep.

### B3. The limit on reach and ease never reaches the panel (fault)

**Aim it breaks:** A7. The geometry calculates `depthClamped` (L594), `buildSerifCap` returns it
(L7928), and both generator callers (L3094, L3298) ignore it. Nothing reads it except two tests. So
when the wall is too short, the panel keeps the typed reach and ease while the shape uses less.

The comment in `skeleton-panel-edits.js` near L1349 says: "The ease distance is not bounded here.
Its ceiling is the bracket's own length ... the writer applies it on every write." The writer
(`setSkeletonSerifParameters`) does not do this. It limits only `undersideCupBalance`. The ceiling
depends on the wall, so the writer cannot calculate it without generating the glyph.

**Fix suggestion.** Publish the values that were drawn, not a flag, the same way the cut walls are
published:

```js
// buildHalfSerif: return what it used
return { ..., reachUsed: reach, easeUsed: easeDistance, tipUsed: tipThickness };

// buildSerifCap, beside _serifCutWalls:
capPoints[0]._serifUsed = {
  left:  pick(terminal.halves.left),   // { reach, easeDistance, tipThickness } as drawn
  right: pick(terminal.halves.right),
};
// L214: publish it into the provenance like serifCutWalls; L231: strip it.
```

- The panel reads it through `skeletonData.generated[*].pointMap`, the same path that
  `visualization-layer-skeleton.js` L657-659 uses for `serifCutWalls`.
- When the value drawn is different from the value stored, show both, for example "20 → 14". This
  is the same pattern as the metrics-key field, which shows the value it would take in the mark's
  colour.
- Delete `depthClamped` after this change. It is replaced.
- Correct or delete the comment in `skeleton-panel-edits.js` near L1349.

### B4. The merged easing curve cannot be edited, and a pin on it is lost (fault)

**Aim it breaks:** A5 and A6 together. The merge makes its two new handles as bare points:

```js
// mergeOneSerifEasing, L3558-3562
const handles = [merged[1], merged[2]].map(({ x, y }) => ({
  x: Math.round(x), y: Math.round(y), type: "cubic",
}));
```

They carry no `_provenance`. The curvature gizmo and editable generated handles need an address on
all four points of a segment, so the merged segment has no gizmo and no editable handles. Also, the
pin for the terminal segment is applied to the wall piece before the merge (L3325-3336), and then
the merge replaces that piece's handles. The pin has no effect, and nothing reports this.

**Fix suggestion.** This needs a decision first:

- **(a) The merged curve is a result, not a control.** Keep the code. Make it explicit in the panel,
  for example by disabling the terminal segment's gizmo while "simplify and harmonize" is on for the
  master. This is the smaller change.
- **(b) The merged curve stays editable.** Give the two new handles the addresses of the wall
  piece's handles, which are the terminal segment's `out` handle at the rib end and `in` handle at
  the neighbour. Then apply the pin after the merge instead of before:

```js
const wallHandles = [at(wallIndex + step), at(wallIndex + 2 * step)];   // the wall piece's handles
const handles = [merged[1], merged[2]].map(({ x, y }, k) => ({
  x: Math.round(x), y: Math.round(y), type: "cubic",
  _provenance: wallHandles[k]._provenance && { ...wallHandles[k]._provenance },
  _axis: /* unit direction from its own on-curve */,
}));
```

With (b), check the order in which the pin and the harmonize step run: the pin states the tension,
and harmonize changes the handle lengths. Pinning after harmonize gives up the G2 join. Harmonizing
after the pin gives up the pin. That conflict is the reason (a) exists.

### B5. The merge finds cap points by their position in the list (weak)

`buildSerifCap` marks the points for the merge by fixed positions in `terminal.points`:

```js
for (const [side, emitted, easeEndIndex, tipIndex] of [
  ["left", emittedLeft, 2, 5],
  ["right", emittedRight, 16, 13],
]) { ... terminal.points[easeEndIndex]._easeMerge = ...; terminal.points[tipIndex]._easeMerge = ...; }
```

These numbers are only correct while `buildSerifTerminal` builds its list in the current order. If
the order changes, the wrong points get marked, and nothing reports an error.

**Fix suggestion.** Let the module that builds the list say where the roles are:

```js
// buildSerifTerminal
const points = [ ... ];   // unchanged
return {
  halves,
  points,
  roles: { left: { ease: 2, tip: 5 }, right: { ease: 16, tip: 13 } },
};
// buildSerifCap
for (const side of ["left", "right"]) {
  const { ease, tip } = terminal.roles[side];
  ...
}
```

Better still, build `roles` with `points.indexOf(...)` at construction, so the numbers cannot drift
from the list. Add a test that `points[roles.left.tip]` equals `halves.left.tipTop` in glyph space.

### B6. The frame decides the axis direction three times (weak)

`computeSerifFrame` orients the axis toward the left side (L119), orients it again after the
tangent guard (L143), and then rebuilds it from the depth by handedness (L155-156). Only the last
one decides the result:

- The depth (`depthForAxis`) does not change when the axis sign changes. It takes the perpendicular
  and orients it by the continuation.
- The final axis is taken from the depth.

So the second orientation (L143) has no effect. The first one (L119) matters only because the tilt
turns the axis toward the depth, and that needs a consistent sign. A clearer order is: build the
untilted frame once, then turn both vectors by the tilt.

```js
// sketch — the existing frame tests must pass unchanged before this replaces anything
let line = rawAxisForMode(axisMode, axisAngle, outward, normal);         // a line, not a ray
let depth = depthForAxis(line, outward, continuation);
let axis = axisFromDepth(depth, normal, outward);                          // handedness rule
if (axisMode === "tilt" && axisTilt) {
  const c = Math.cos(rad(axisTilt)), s = Math.sin(rad(axisTilt));
  axis = { x: axis.x * c + depth.x * s, y: axis.y * c + depth.y * s };
  depth = depthForAxis(separateFromTangent(axis, outward), outward, continuation);
  axis = axisFromDepth(depth, normal, outward);
}
```

**The tangent guard only acts on a large tilt.** Normalization clears `ribAngleLock` on every serif
end (`skeleton-model.js` L1502-1515). So `normal` in perpendicular mode is always exactly square to
the tangent, and `separateFromTangent` never fires there. It can only fire when the tilt is more
than 75 degrees. Two options:

- Limit `axisTilt` in `setSkeletonSerifParameters` to ±75 and delete the guard from the tilt path.
  This also follows A7: the panel then shows the tilt that draws.
- Keep the guard, but apply it only to the tilt, and delete it from the perpendicular path.

### B7. On a one-segment stroke, the start serif is built first (weak)

An `l` or an `I` drawn as one straight is one segment. The start serif is built on the whole
segment and may use up to 95% of it. The end serif is then built on what is left (it reads
`roundedLeftSide` after the start cap has changed it), and may use 95% of that. So the order of
the two branches decides which end gets the length, not the shape. It shows only with a very large
reach or ease, and the stroke never folds, because the end cannot pass the start's release.

**Fix suggestion** (low priority): when `segments.length === 1` and both caps are serifs, build both
walls from the uncut sides before either cut, and give each wall half the budget:

```js
const budget = bothEndsSerifOnOneSegment ? 0.475 : MAX_CONSUMED_FRACTION;
makeSerifWall(points, { maxConsumedFraction: budget });
```

This means `makeSerifWall` takes the fraction as an option, and the end cap's split must use a
parameter on the whole segment. Only do this if a real glyph shows the problem.

### B8. The code still reads old data formats (weak)

The project does not need to read old data (START-HERE: no production release, no migration).
These readers exist only for data from before a change:

| Where | What it reads | Action |
| --- | --- | --- |
| `skeleton-model.js` L5349, `normalizeSerif` | `sides === "split"` and `linked === false` → all links open | Delete. A missing link reads as closed. |
| `skeleton-model.js` L3225-3228, `normalizeSerifPreset` | a flat preset, or a `left` block alone, as one wing | Delete the flat read. Presets store `left` and `right`. |
| `skeleton-generator.js` L327 | `serif: contour.serif` copied into the generator input | Delete. Nothing in the generator reads a contour-level serif. It is a dead copy. |
| `skeleton-generator.js` L814-840, `getGeneratedHandleAdjustment` | legacy 1D offset keys (`leftHandleInOffset` …) | Delete if no writer produces them. Grep the writers first. This is shared with non-serif handles. |
| `skeleton-model.js` L202-207, `SERIF_FIELD_DEFAULTS` | cup tension 2/3 "so a terminal drawn before the control existed keeps its foot" | **Check first.** It is also the default for a new terminal. Without it an unset tension is 0, which draws a sharp V as soon as a cup is set. Keep the value, and correct the comment. |

---

## Part C — Places where the code disagrees with the docs

Each item needs a check. It is not automatically a fault in the code. In most cases the doc is out
of date. In some cases the doc states a rule that the code has lost.

| # | Doc says | Code does | Check |
| --- | --- | --- | --- |
| C1 | FEATURE-MODEL §8: a half with `wingLength === 0` is switched off and adds nothing. | The wing is measured from the wall at the tip's height (`buildHalfSerif` L502-517). On a wall leaning 0.3 per unit, wing 0 with tip 20 puts the tip 6 units outside the stroke foot (leaning away) or 6 units inside it (leaning in). | Decide which rule holds. If wing 0 is a legal "square tip against the stroke", update §8, and say that the side checks are the only way to switch a half off. |
| C2 | FEATURE-MODEL §8: "The tip stops at the wall", "The rounding moves to the corner that is left", "This is the one place a serif snaps". The development log (tilt section) gives "the wing is swallowed at about 38 degrees". | There is no tip limit and no wing-swallowed case (`buildHalfSerif` L511-516 explains why it was removed). | Delete those parts of §8. Note that B1 exists because the old limit was removed and nothing replaced it. |
| C3 | FEATURE-MODEL §8: both easing handles are the same length. The code comment at L651-657 says the same. | Each handle is the curvature times its own end's distance to the corner (`computeTunniHandleLengths`, L671-685). Measured at curvature 1: 20.7 against 10.0. | Update §8 and delete the old comment. The comment at L671-677 has the current reason. |
| C4 | FEATURE-MODEL §8: easing turns off at concavity 1, and only there. | Nothing turns easing off (comment at L585-590). | Update §8. |
| C5 | FEATURE-MODEL §8: the serif axis works together with `ribAngleLock`; a locked terminal keeps its foot flat. The comment in `rawAxisForMode` L32-37 says the same. | The lock is cleared on every serif end at normalization (`skeleton-model.js` L1502-1515). | Update §8 and the comment. See also B6. |
| C6 | FEATURE-MODEL §8: the code holds the axis at least 15 degrees off the tangent (all modes). | Only in perpendicular and tilt modes (L137-144), and it is reachable only with a tilt over 75 degrees (B6). | Update §8 after B6 is decided. |
| C7 | FEATURE-MODEL §8, release rule: the wing's surface "ends directly above the wall's foot". The comment at L532-542 says the same. | It ends above the wall at the tip's height (`tipU` is measured there). | Correct the text. The corner logic is still continuous where the ray stops meeting the segment (checked by hand for a straight wall that leans either way). |
| C8 | Code comment in `buildHalfSerif` L600-620: concavity is the handle length, tension is the balance, "at 0.5 they are equal", and a wingless half "stays straight". | The code uses the attractor model: concavity moves the attractor from the chord's midpoint toward the corner, and tension moves both handles toward it (L621-624). There is no wingless branch. | Replace the comment with the attractor description that FEATURE-MODEL §8 already has. |
| C9 | Code comment in `mergeSerifEasings` L3389-3390: a run the fit cannot hold as one curve is not merged, and neither is a result that bends both ways. | The only check is that the two end directions meet ahead of both ends (L3516-3521). The fitted curve is not measured. | Add a deviation check, or change the comment to state the actual check. Also delete the stale comment at L3497-3507 (see the simplification review). |
| C10 | `skeleton-panel-edits.js` comment near L1349: the writer limits the ease distance on every write. | The writer does not (B3). | Fixed by B3. |
| C11 | GLOSSARY, **Serif preset**: one wing and the cup, and it holds no axis. | A preset holds both halves, the links, the axis mode, the angle and the tilt (`normalizeSerifPreset`). | Update the glossary. |
| C12 | FEATURE-ARCHITECTURE-MAP: `serif-geometry.js` has 268 lines, and `skeleton-generator.js` has 4,730. | 828 and 8,073. | Update the counts, and check whether the map should mention the easing merge. |

---

## Probe scripts

The probes import the real modules. Put them in the scratchpad and run them with `node`. Change
`base` if the repository moves.

```js
// probe A — tip thickness against a short wall (B1)
const base = "file:///C:/Users/frena/Documents/___coding/glyphcad/src-js/fontra-core/src/";
const { makeSerifWall, buildHalfSerif } = await import(base + "serif-geometry.js");
for (const tip of [20, 30, 40, 60]) {
  const h = buildHalfSerif({
    side: 1,
    wall: makeSerifWall([{ u: 40, v: 0 }, { u: 40, v: 30 }]),
    params: { wingLength: 20, tipThickness: tip, wingSlope: 10, reach: 10 },
  });
  console.log(tip, h.tipTop.v, h.corner.v, h.junction.v, h.release.v);
}
```

```js
// probe B — a detached handle on a serif terminal (B2)
const { generateFromSkeleton } = await import(base + "skeleton-generator.js");
const { normalizeSkeletonData } = await import(base + "skeleton-model.js");
const make = (tip, detached) => normalizeSkeletonData({ contours: [{ id: 4, defaultWidth: 80,
  capStyle: "butt", points: [
    { id: 8, x: 278, y: 472, capStyle: "serif", editable: { left: true, right: true },
      ...(detached === null ? {} : { handleOffsets: { leftOut: { x: -12, y: 20, detached } } }),
      serif: { axisMode: "perpendicular",
        left:  { tipThickness: tip, wingLength: 20, wingSlope: 20 },
        right: { tipThickness: tip, wingLength: 20, wingSlope: 20 } } },
    { id: 9, x: 157, y: 572, type: "cubic" }, { id: 10, x: 91, y: 503, type: "cubic" },
    { id: 7, x: 91, y: 435, smooth: true }, { id: 6, x: 91, y: 377 }, { id: 5, x: 94, y: 0 },
  ] }] });
const handleOf = (data) => {
  const r = generateFromSkeleton(data);
  const pts = r.contours[0].points, map = r.provenance[0].pointMap;
  const i = map.findIndex((m, k) => m?.skeletonPointId === 8 && m.side === "left" && pts[k]?.type);
  return pts[i];
};
for (const tip of [10, 20, 40]) {
  console.log(tip, handleOf(make(tip, true)), handleOf(make(tip, false)), handleOf(make(tip, null)));
}
```

Note: handle offsets must use the canonical `handleOffsets: { leftOut: {...} }` form. The flat
`leftHandleOutOffsetX` keys do not survive normalization, so a probe written with them measures
nothing.
