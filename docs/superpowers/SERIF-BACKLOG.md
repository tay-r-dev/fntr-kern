# Serif terminal — open work

Standing reference for everything still to decide or build on the serif cap
style. Companion to feature model §8 (what the serif is and what must not
change), arch map §7 (open residue), development log entries 20–22 (how it got
here).

Items are ordered by **how much of the code's structure has to move**, deepest
first, with blocking relationships allowed to override that order. The numbering
here is this document's own; the origin of each item is noted so the original
list stays traceable.

Status legend: **open** = agreed, not started · **undecided** = needs a decision
before it can be planned.

| #   | Item                                | Depth               | Origin | Status    |
| --- | ----------------------------------- | ------------------- | ------ | --------- |
| 1   | Axis modes other than perpendicular | core geometry model | (1)    | open      |
| 2   | Shape-and-easing reframe            | stored model?       | (4)    | undecided |
| 3   | Preset storage and editing          | source defaults     | (6.1)  | undecided |
| 4   | Preset apply / create / update      | panel               | (6.2)  | open      |
| 5   | Live update for scale sliders       | edit pipeline       | (3)    | open      |
| 6   | Scale sliders produce integers      | edit pipeline       | (5)    | open      |
| 7   | Scale sliders inline with inputs    | panel layout        | (2)    | open      |

Blocking: 1 → 2 (the axis rework may change the field set that 2 regroups) ·
2 → 3 (a preset stores a bundle of field names; freeze the taxonomy first) ·
3 → 4 · 5 and 6 are one change and must land together (see item 6).

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

**Open:** whether the foot baseline stays a line of constant `v` through the
skeleton endpoint (a slanted foot in horizontal mode on an upright stem) or
becomes a line perpendicular to the axis. These differ as soon as the frame is
sheared and they are visibly different serifs.

**Open:** whether the 15° minimum separation between axis and tangent survives.
It exists because a parallel axis leaves no flank to release onto. In a sheared
frame the degeneracy is the same but the clamp may need to act on the shear
factor rather than the angle.

### Constraints that still hold

Point-count stability across the whole parameter range including every axis mode
and angle — the interpolation contract does not relax for this. Seven on-curves
per terminal at every setting. Test it directly (feature model §8), do not infer
it from the shape looking right.

---

## 2. Shape-and-easing reframe

**Undecided: this is either a panel regrouping or a schema change, and the two
have very different costs.**

The proposal is to present the serif's construction as two concerns — the shape
(where the material is) and the easing (how the transition gets there) — rather
than as seven flat numbers per half.

The existing seven map onto that split cleanly enough:

| Concern | Fields                                                   |
| ------- | -------------------------------------------------------- |
| Shape   | `wingLength`, `tipThickness`, `wingSlope`, `tipCutAngle` |
| Easing  | `reach`, `tension`, `concavity`                          |

plus the terminal-level `undersideCup` and `straightDepth`, which are shape, and
`axisMode` / `axisAngle`, which are neither — they place the terminal rather than
form it.

**If it is presentation only** — two headers in the parameters panel, existing
keys untouched — it is a small change to `_buildSerifSection` and belongs at the
bottom of this list, not here.

**If it changes the stored model** — renaming fields, nesting them under `shape`
and `easing`, or replacing any of the seven with a derived pair — then it is a
schema change and carries the full weight: normalization, the inherit-via-null
chain through point → contour → source, mirroring, the golden fixtures, and a
migration for any file already saved with a serif. It also has to preserve the
guarantee that no field can cancel another (development log 21: `tension` and
`concavity` used to multiply, and either at zero killed the other).

**Question to settle before this can be planned:** is the reframe about what the
panel shows, or about what a serif _is_? Item 3 depends on the answer, because a
preset stores field names.

---

## 3. Preset storage and editing

There is already a working template for this in the codebase, and the serif
should follow it rather than invent a second mechanism.

`panel-skeleton-defaults.js` edits named lists held in the source defaults —
`customWidthsUppercase`, `customWidthsLowercase`, `customCapSquare`,
`customCapRounded` — with add, rename, edit and confirm-delete rows.
`panel-skeleton-parameters.js` reads the same lists and offers them as options in
the width-profile and cap-preset selects. A serif preset list is the same shape:
a new key in `SKELETON_SOURCE_DEFAULT_KEYS` holding an array of
`{ name, ...fields }`, a new block of rows in the defaults panel, and a new
option source in the parameters panel.

### The one real decision

The original request says presets belong **in font info**. Every preset list that
exists today lives in the **source defaults**, edited from the editor's skeleton
defaults sidebar. These are different scopes with different consequences:

- **Source defaults** (existing pattern) — per master. Each master can hold its
  own serif proportions, which is what you want when the serif thickens with
  weight. Costs: a preset must be created in each master, and the two can drift.
- **Font info** (as requested) — one list for the whole font. Create once, use
  everywhere. Costs: absolute lengths in a shared preset are wrong in every
  master but one, unless the preset is stored in normalized units.

The `serifUnitsMode` source default (`absolute` | `normalized`) already exists
and scales the four `SERIF_LENGTH_FIELDS` by stroke width. A font-level preset
stored in normalized units is coherent; stored in absolute units it is not.

**Question to settle:** font-level list, source-level list, or font-level list
that is required to be normalized. This decides where the editing UI goes and
whether it can reuse the defaults panel's rows at all.

### Also to settle

- Does a preset cover both halves, or one half that can be applied to either
  side? Applying a single-half preset to the right side is the mirroring case,
  which the model already handles.
- Does a preset include `axisMode` / `axisAngle`? Those place the terminal rather
  than shape it, and carrying them makes a preset non-portable between a stem
  foot and a slanted terminal.
- Does a preset include `undersideCup` and `straightDepth`? They are per-terminal
  rather than per-half.

---

## 4. Preset apply / create / update

The control in the parameters panel: a select listing the presets, with apply,
create-new, and a double-press update-in-place.

Additive once item 3 has settled storage. Two notes:

- **Create** needs a name. The defaults panel currently auto-names
  (`Custom ${n + 1}`) and lets the row be renamed afterwards; doing the same here
  avoids a modal.
- **Double-press to update** is a destructive action behind a repeated click.
  The defaults panel already has a confirm-on-second-press idiom for delete
  (`_customDeleteConfirm`); reuse it rather than adding a second interaction
  grammar for the same kind of confirmation.

---

## 5. Live update for scale sliders

The serif scale sliders are deliberately excluded from the streaming path today,
and the exclusion is load-bearing:

> Scale sliders are excluded: they multiply what is stored, so streaming them
> would compound the factor once per frame.

A relative control cannot stream while it reads its multiplicand from live
storage. The fix is a **drag baseline**: snapshot the affected values when the
drag starts, and each streamed frame applies the current factor to the snapshot
rather than to whatever the last frame wrote. On commit, one undo record from
baseline to final.

This is not serif-specific. The point-width scale slider is relative in exactly
the same way and has the same limitation, so the baseline belongs in the shared
panel edit path, not in the serif branch — Rail R-B (one write path) and R-D (no
kind-branching in shared code).

It removes a stated constraint from that shared path, which is why this sits
above the layout items despite being smaller in line count.

---

## 6. Scale sliders produce integers

`scalePanelSerifValue` writes `Math.max(0, current * factor)` with no rounding,
so scaling a wing of 40 by 95% stores 38 but by 97% stores 38.8. Compare
`scalePanelPointWidth`, which rounds and re-normalizes so the two halves still
sum to the intended total.

**This must land with item 5, not before or after it.** Rounding a value that is
recomputed from live storage every frame quantizes the drift and makes it worse;
rounding a value recomputed from a fixed baseline is stable. Baseline plus
rounding is one change with one behaviour; either alone is a regression.

To settle: rounding under `serifUnitsMode: normalized`, where the stored number
is a ratio of stroke width and an integer is meaningless. Either round the
resulting font units rather than the stored ratio, or don't round in that mode.

---

## 7. Scale sliders inline with inputs

Each serif length currently emits two form rows: the number input, then a full
`edit-number-slider` row beneath it carrying its own "Scale" label. Four lengths
per half plus two terminal-level ones means the section is mostly scale sliders.

The shared form component already supports this. `_addUniversalRow` renders
`field1` into the label cell and `field2` / `field3` into the value cell, which
is exactly a labelled input with a slider beside it. `_pushScaleSlider` becomes
part of the length's own row rather than a row of its own, and the redundant
label disappears.

The work is not in the rendering. It is in the parameters panel's in-place update
path: `_applyFormContents` walks top-level items and matches `item.key` against
the form's registered keys, and `formContentsLayoutSignature` builds its
signature the same way. Neither descends into a universal row's nested fields, so
both need to — otherwise the section falls back to a full rebuild on every edit
and reintroduces the focus loss that entry 21 fixed.

Lowest structural cost of the seven, and it reads as the largest improvement per
line changed.

---

## Cross-references

- Feature model §8 — the serif terminal: frame, halves, the release rule and its
  cost, point count, the `constructionSegment` obligation.
- Feature model §9 — dead ends, including reading the release off the cut.
- Arch map §7 residue #4 — the zero-pin curvature fallback in shared Tunni code.
  Not serif work, but it is in the path of every curvature pin and is felt at the
  bottom of the gizmo range on a serif'd stem.
- Development log 20, 21, 22.
