# Serif terminal — open work

Standing reference for everything still to decide or build on the serif cap
style. Companion to feature model §8 (what the serif is and what must not
change), arch map §7 (open residue), development log entries 20–22 (how it got
here).

Items are ordered by **how much of the code's structure has to move**, deepest
first, with blocking relationships allowed to override that order. The numbering
here is this document's own; the origin of each item in the original list is
noted so it stays traceable.

Status legend: **open** = agreed, not started · **undecided** = needs a decision
before it can be planned.

| #   | Item                                     | Depth               | Origin | Status    |
| --- | ---------------------------------------- | ------------------- | ------ | --------- |
| 1   | Axis modes other than perpendicular      | core geometry model | (1)    | undecided |
| 2   | `reach` and `wingSlope` are redundant    | core geometry model | (4)    | open      |
| 3   | Preset storage and editing               | source defaults     | (6.1)  | open      |
| 4   | Preset apply / create / update           | panel               | (6.2)  | open      |
| 5   | Scale sliders: live update, integer step | edit pipeline       | (3, 5) | open      |
| 6   | Scale sliders inline with inputs         | panel layout        | (2)    | open      |
| 7   | Shape-and-easing reframe                 | panel labels        | (4)    | open      |

Blocking: 3 → 4 · 2 → 7 (the reframe groups the fields item 2 may redefine, but
the reframe is cheap to redo, so this only sets the order, not a gate).

Items 5 and 6 both touch the same sliders and should ship as one pass, but they
are independent of each other and either can land alone.

### Decided

- **Presets are per master**, held in the source defaults, not per font. This
  removes the units problem a font-wide preset would have had (absolute lengths
  are wrong in every master but one) and lets item 3 follow the existing custom
  width / cap preset pattern exactly.
- **The shape-and-easing reframe is presentation only.** No field is renamed,
  renested or replaced. That drops it from a schema change to a panel change and
  moves it to the bottom of this list.

---

## 1. Axis modes other than perpendicular

**Deepest item. It is a rewrite of the terminal's coordinate model, not a set of
local fixes.**

### What is wrong

`computeSerifFrame` builds an orthonormal frame from a single input direction:
`axis` runs along the serif's foot, and `depth` is forced perpendicular to it,
pointing back into the stroke. Every point in `buildHalfSerif` is placed in that
frame — the tips, the wing inner corner, the release (`straightTop`) and the
bottom of the straight run (`straightBottom`) all sit at a constant `u`, on what
the code calls the flank line.

The flank line is only the stroke wall when `depth` is parallel to the tangent —
that is, when the axis is perpendicular to the centerline. In every other mode
the wall still runs along the centerline while the terminal's straight run leans
with the axis, and the two disagree by exactly the axis tilt.

The generator then papers over the disagreement. `buildSerifCap` computes the
release from the serif's own numbers and `anchorTerminalSplit` drags the trimmed
edge onto it, bending the wall over. That is the correct behaviour when the gap
is small and caused by curvature (feature model §8, and it is what keeps a
curvature pin from moving on-curves). It is the wrong behaviour when the gap is
structural and grows linearly with the axis angle.

Secondary consequence: the two rib ends project into a tilted frame at different
depths, so the two halves are trimmed by different amounts and start at different
heights even when their seven parameters are identical. That is why a tilted
serif reads as lopsided rather than slanted.

### Direction

The frame needs **three** directions rather than two: the foot direction (the
axis, which the mode chooses), and the flank direction (which must follow the
stroke walls, i.e. the tangent, in every mode). `depth` stops being
`rotate90(axis)`.

That makes the frame non-orthonormal — a sheared basis — so `toFrame` /
`toGlyph` become a general 2×2 solve instead of two dot products, and every
place that assumes `u` and `v` are independent distances has to be re-read. In
particular:

- the tip cut offset, computed as `tipThickness · tan(cutAngle)` along `u`
- the wing inner corner, currently at the same `u` as the release
- the underside controls in `footControls`, which hold each end's `v`
- the reach and straight-run heights, currently measured along `v` from a
  baseline through the skeleton endpoint

### The decision this needs first

**Which reference does the wing use once the two disagree?** Today every height
is measured square to the foot, so the wings are an even slab whichever way the
foot points. Once the flank has to follow the wall, the wing must pick one:

- **Even slab** — thickness stays square to the foot. Constant wing thickness
  end to end; the join where the wing meets the stem becomes a shallow wedge.
- **Follows the stem** — thickness is measured along the stem. The flank lies
  exactly on the wall with no join, and the wing becomes a parallelogram,
  visibly thicker at the stem than at the tip.

Identical on an upright stem with a perpendicular foot; they only diverge in the
tilted modes. This is a drawing decision, and it determines the whole
construction below it, so it is a gate on planning this item.

### Also open

Whether the 15° minimum separation between axis and tangent survives. It exists
because a parallel axis leaves no flank to release onto. In a sheared frame the
degeneracy is the same, but the clamp may need to act on the shear factor rather
than on the angle.

### Constraints that still hold

Point-count stability across the whole parameter range including every axis mode
and angle — the interpolation contract does not relax for this. Seven on-curves
per terminal at every setting. Test it directly (feature model §8), do not infer
it from the shape looking right.

---

## 2. `reach` and `wingSlope` are redundant

Reported as "I can't figure out what reach does — in practice it's the same as
slope, with the curve apex changing if there's easing." That is exactly right,
and it is measurable.

### Evidence

`buildHalfSerif`, wing 40, tip thickness 20, tension 0.5. Comparing
`wingSlope: 15, reach: 0` against `wingSlope: 0, reach: 15`:

| `concavity` | Emitted on-curves       | Handles                                       |
| ----------- | ----------------------- | --------------------------------------------- |
| 0           | identical to 3 decimals | identical — the two settings give one outline |
| 0.5         | identical to 3 decimals | `control1` and `control2` differ              |
| 1           | identical to 3 decimals | `control1` and `control2` differ              |

The two fields move **no emitted point differently at any setting**. Every
difference between them lives in the two transition handles, and only when
`concavity` is non-zero.

### Why

```js
const wingInnerV = tipThickness + wingSlope;
const corner = { u: flankU, v: wingInnerV };
const straightBottom = { u: flankU, v: wingInnerV + reach };
```

`reach` is measured **from the corner**, and `wingSlope` raises the corner. So
slope lifts the release by its own amount as a side effect of steering the
bracket, and that lift is all reach does. The redundancy is the lift.

Second symptom in the same construction: `control2 = lerp(straightBottom, corner,
…)`, so at `reach === 0` the lower handle collapses onto the release at every
easing value. Measured above: with slope 15 and reach 0, `control2` equals
`straightBottom` at concavity 0.5 and 1. The release is a corner regardless of
easing, which means **slope alone cannot produce a bracket** — it needs a
non-zero reach before it does anything visible.

### Direction

Give the release its own height above the foot instead of an offset from the
corner, leaving `wingSlope` to steer the bracket's departure from the tip and
nothing else. Clamp the release to stay above the corner, since the corner has to
lie between the tip and the release for the bracket to run the right way.

Small in code — one construction line plus a clamp — but it is a shape change for
every serif already drawn, so it needs the fixtures regenerated and a note in the
log. It is a model change, not a panel one: two controls with one effect cannot
be relabelled apart.

---

## 3. Preset storage and editing

**Per master, in the source defaults.** There is already a working template for
this and the serif should follow it rather than invent a second mechanism.

`panel-skeleton-defaults.js` edits named lists held in the source defaults —
`customWidthsUppercase`, `customWidthsLowercase`, `customCapSquare`,
`customCapRounded` — with add, rename, edit and confirm-delete rows.
`panel-skeleton-parameters.js` reads the same lists and offers them as options in
the width-profile and cap-preset selects. A serif preset list is the same shape:
a new key in `SKELETON_SOURCE_DEFAULT_KEYS` holding an array of
`{ name, ...fields }`, a new block of rows in the defaults panel, and a new
option source in the parameters panel.

### To settle when planning

- Does a preset cover both halves, or one half that can be applied to either
  side? Applying a single-half preset to the right side is the mirroring case,
  which the model already handles.
- Does a preset include `axisMode` / `axisAngle`? Those place the terminal rather
  than shape it, and carrying them makes a preset non-portable between a stem
  foot and a slanted terminal.
- Does a preset include `undersideCup` and `straightDepth`? They are per-terminal
  rather than per-half.
- Absolute or normalized lengths. `serifUnitsMode` already exists at source
  level; a per-master preset can safely store absolute units, but a preset copied
  between masters cannot.

---

## 4. Preset apply / create / update

The control in the parameters panel: a select listing the presets, with apply,
create-new, and a double-press update-in-place.

Additive on top of item 3. Two notes:

- **Create** needs a name. The defaults panel currently auto-names
  (`Custom ${n + 1}`) and lets the row be renamed afterwards; doing the same here
  avoids a modal.
- **Double-press to update** is a destructive action behind a repeated click. The
  defaults panel already has a confirm-on-second-press idiom for delete
  (`_customDeleteConfirm`); reuse it rather than adding a second interaction
  grammar for the same kind of confirmation.

---

## 5. Scale sliders: live update and integer step

One change, not two. Doing either half alone is a regression.

### Live update

The serif scale sliders are deliberately excluded from the streaming path today,
and the exclusion is load-bearing:

> Scale sliders are excluded: they multiply what is stored, so streaming them
> would compound the factor once per frame.

A relative control cannot stream while it reads its multiplicand from live
storage. The fix is a **drag baseline**: snapshot the affected values when the
drag starts, and have each streamed frame apply the current factor to the
snapshot rather than to whatever the last frame wrote. On commit, one undo record
from baseline to final.

### Integer step

`scalePanelSerifValue` writes `Math.max(0, current * factor)` with no rounding,
so scaling a wing of 40 by 95% stores 38 but by 97% stores 38.8. Compare
`scalePanelPointWidth`, which rounds and re-normalizes so the two halves still
sum to the intended total.

### Why they are one change

Rounding a value recomputed from live storage every frame quantizes the
compounding and makes the drift worse. Rounding a value recomputed from a fixed
baseline is stable. Baseline plus rounding is one behaviour.

Neither half is serif-specific. The point-width scale slider is relative in
exactly the same way and has the same limitation, so the baseline belongs in the
shared panel edit path, not in the serif branch — Rail R-B (one write path) and
R-D (no kind-branching in shared code).

To settle: rounding under `serifUnitsMode: normalized`, where the stored number
is a ratio of stroke width and an integer is meaningless. Either round the
resulting font units rather than the stored ratio, or do not round in that mode.

---

## 6. Scale sliders inline with inputs

Each serif length currently emits two form rows: the number input, then an
`edit-number-slider` row beneath it carrying its own "Scale" label. Four lengths
per half plus two terminal-level ones means the section is mostly scale sliders.

The shared form component already supports the layout. `_addUniversalRow` renders
`field1` into the label cell and `field2` / `field3` into the value cell, which is
exactly a labelled input with a slider beside it. `_pushScaleSlider` becomes part
of the length's own row rather than a row of its own, and the redundant label
disappears.

The work is not in the rendering. It is in the parameters panel's in-place update
path: `_applyFormContents` walks top-level items and matches `item.key` against
the form's registered keys, and `formContentsLayoutSignature` builds its signature
the same way. Neither descends into a universal row's nested fields, so both need
to — otherwise the section falls back to a full rebuild on every edit and
reintroduces the focus loss that development log 21 fixed.

---

## 7. Shape-and-easing reframe

**Presentation only.** No field renamed, renested or replaced; the stored model
is untouched, so there is no migration, no fixture change and no interpolation
consequence.

Two headers in the serif section of the parameters panel, splitting the seven
half-fields by what they do:

| Concern | Fields                                                   |
| ------- | -------------------------------------------------------- |
| Shape   | `wingLength`, `tipThickness`, `wingSlope`, `tipCutAngle` |
| Easing  | `reach`, `tension`, `concavity`                          |

`undersideCup` and `straightDepth` are shape but terminal-level; `axisMode` and
`axisAngle` are neither — they place the terminal rather than form it, and should
stay in their own group below the divider where they already are.

Sequenced after item 2 because that item may move `reach` from easing to shape,
or remove the need for it to appear as its own control at all. The reframe is
cheap enough to redo that this is an ordering preference, not a gate.

---

## Cross-references

- Feature model §8 — the serif terminal: frame, halves, the release rule and its
  cost, point count, the `constructionSegment` obligation.
- Feature model §9 — dead ends, including reading the release off the cut.
- Arch map §7 residue #4 — the zero-pin curvature fallback in shared Tunni code.
  Not serif work, but it is in the path of every curvature pin and is felt at the
  bottom of the gizmo range on a serif'd stem.
- Development log 20, 21, 22.
