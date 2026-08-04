# Serif presets: named terminal shapes, per master

**Date:** 2026-08-05
**Branch:** `feature/skeleton-serif-generator`
**Covers:** serif backlog items 4 (storage and editing) and 5 (apply, create, update).
**Blocking order:** 4 before 5. Both items sit behind §3, which changes the serif model.

---

## 1. What this is for

A serif terminal holds twenty numbers and one flag. To repeat a drawn foot on
another glyph, a designer must set all of them by hand. A preset is that set of
numbers under a name. The master holds it. One press applies it.

The width profile list and the cap profile list are the closest thing in the
tree. A serif preset uses their storage pattern. It does not use their
interface. A width profile is one number and a serif is twenty.

### What exists, and what does not

| Thing                         | Storage | Editor              | Reader                |
| ----------------------------- | ------- | ------------------- | --------------------- |
| Custom widths, per case       | yes     | yes, defaults panel | yes, parameters panel |
| Custom caps, square and round | yes     | **no**              | yes, parameters panel |

The cap profile lists have a reader and no writer. Nothing in the editor can
create one. The "existing template" that these backlog items cite is half built.
Half of the apparent precedent is dead storage. Build the serif list whole, and
do not touch the cap lists.

---

## 2. Decisions

The designer settled these on 2026-08-05. They are inputs to the design below,
not conclusions from it.

| Question                      | Decision                                                               |
| ----------------------------- | ---------------------------------------------------------------------- |
| Scope of one preset           | The whole terminal. Apply offers both wings, left only, or right only. |
| Does it carry the serif axis  | No. The axis places the terminal. It does not shape the terminal.      |
| Unset fields                  | There are none. Every serif number is always a number. See §3.         |
| A new serif starts at         | Wing length 20, tip thickness 20, wing slope 20. Everything else 0.    |
| Those three numbers           | Master source defaults, not code constants. Settable per master.       |
| How a preset gets its numbers | Two ways: capture from a terminal, and edit in the defaults panel.     |
| Where presets live            | Per master, in the source defaults. Already decided, unchanged.        |

---

## 3. First: the serif loses its inherit chain

**This is a model change and it is the deepest part of the work.** It is not
optional dressing on the preset feature. A preset that stores "unset" for a field
means something different from a preset that stores a number. The designer has
ruled that this difference must not exist.

### Today

Each of the nine wing fields holds a number or `null`. `null` means inherit. The
chain has two links, and neither one is what a first read suggests.

**Link one, the contour.** A contour can hold its own serif block, and the
generator and both panel readers fall through to it. **No code writes it.** The
editor cannot create one. The level exists in the data model and in three
readers, and nothing can put a value there.

**Link two, the constants.** A field that no level supplies falls through to a
default table. That table is **not all zeros**, which is the trap below.

| Field                                              | Default |
| -------------------------------------------------- | ------- |
| `wingLength`, `tipThickness`, `wingSlope`, `reach` | 0       |
| `tipCutAngle`, `easeDistance`                      | 0       |
| `tension`                                          | 0.7     |
| `concavity`                                        | 0.8     |
| `easeCurvature`                                    | 0.5     |

So an untouched serif already carries a bracket. It draws nothing only because
its three size fields are zero.

The panel uses the same `null` to clear a field. It uses `null` again to report a
mixed selection.

### After

A wing field always holds a number. `null` is not a stored value. Zero is a
setting, not an absence.

- **Reading.** Serif normalization fills a missing or non-finite field with 0.
  It never returns `null`.
- **Writing.** The panel writes a number. An empty box writes 0.
- **Mixed selections.** The panel still shows an empty box for a mixed
  selection. This is a display state that the panel computes from the selection.
  The file never holds it.
- **The contour level goes.** With every point field filled, the contour
  fallback can never fire. Remove it from the generator and from both panel
  readers. A fallback that cannot fire is worse than one that is documented.

### Migration

**An unset field becomes 0. Every one of them, with no exceptions.**

An earlier draft of this spec had `tension` migrate to 0.7, `concavity` to 0.8
and `easeCurvature` to 0.5, so that no serif already drawn would move. That
protected shapes at the cost of the rule the designer asked for, and it was
wrong twice over.

- The designer asked for zeros below the first three, and asked for zero
  concavity and zero tension again after seeing the result. A rule that keeps
  0.7 under a read is not that rule.
- It did not work anyway. See below.

### Where the 20-20-20 goes

Not into reading. If normalization filled an empty wing length with 20, every
serif in every existing file would draw a foot on load. Seeding is a **write**.
It happens at the moment a terminal becomes a serif.

One path makes a terminal a serif: the cap style select on a point. A contour
also carries a cap style, and nothing writes that either, so there is no second
route to seed. The point path already carries a preset-values argument for the
other cap styles, and seeding uses it.

The seed writes **all twenty numbers**, not the three from the source defaults.
Everything the source defaults do not name seeds at 0. A new serif is a chamfered
slab with no bracket and no rounding.

Picking serif in the style select applies the master's new-serif numbers, with
no condition attached. The select only fires on a change, so this is exactly
"became a serif", and picking it is a request for the default shape.

**Do not gate the seed on the point holding no serif data.** Point normalization
materializes a serif block on every on-curve point in the file, so that block is
always there and the test can never pass. A first attempt did gate on it, the
seed never fired once, and every terminal switched to serif came up carrying the
old fallbacks - 0.7 tension and 0.8 concavity out of nowhere, with no size.

### No master numbers for it

An earlier draft gave the three seed numbers their own master source defaults,
edited under a "New serif" header. That is gone. The default shape is a preset
like any other, so a master that wants a different starting serif changes the
preset, not a second set of numbers describing the same thing.

---

## 4. What one preset holds

```
{
  name: "Didone",
  wingLength, tipThickness, wingSlope, tipCutAngle,
  reach, tension, concavity, easeDistance, easeCurvature,
  undersideCup
}
```

**One wing, ten numbers.** Applying it writes that wing to both sides.

Asymmetry is a decision about the terminal being edited, not about the shape
that was saved, so the link flag does not travel with a preset and a preset
never stores two different wings. A preset that held both wings carried twice
the information it needed and made every symmetric shape say the same thing
twice.

The underside cup stays. It belongs to the terminal rather than to a wing, and
it is stored once either way, so it is not part of the duplication.

Capture takes the **left** wing. A preset holds one wing, so capturing an
asymmetric terminal has to pick, and picking is better than refusing a shape the
designer can see.

**Excluded, and why:**

- `axisMode` and `axisAngle` place the terminal. A preset captured on an upright
  stem foot would force a slanted terminal back to perpendicular. Without them,
  one preset stays correct on every terminal in the font.
- `linked` is the asymmetry decision, which now lives only on the terminal.
- `capStyle` is excluded. The serif section appears only when the terminal is
  already a serif, so a preset never has to change the style.

### The built-in presets

Ported from the serif lab. Its numbers are already one wing and already this
project's fields, with projection reading as wing length. The lab draws at stem
width 150, so lengths divide by 7.5 onto the 20-unit scale. The tip cut is an
angle and the two bracket numbers are ratios, so all three carry across
untouched. The lab predates contour easing, so that pair is 0.

|           | wing | tip | slope | cut | cup | reach | tension | concavity |
| --------- | ---- | --- | ----- | --- | --- | ----- | ------- | --------- |
| Egyptian  | 20   | 20  | 20    | 0   | 0   | 0     | 0       | 0         |
| Clarendon | 18   | 10  | 1     | 0   | 0   | 19    | 0.9     | 0.85      |
| Didone    | 19   | 3   | 0     | 0   | 0   | 13    | 0.7     | 0.8       |
| Old style | 15   | 5   | 7     | 22  | 3   | 20    | 0.62    | 0.66      |
| Wedge     | 13   | 2   | 13    | 0   | 0   | 5     | 0.05    | −0.18     |

The lab's "Sans" is dropped. It is all zeros, which is what a serif with no
shape already draws, so it is a preset for switching the feature off rather than
for choosing a foot.

**Egyptian is the default.** It is the plain slab — three 20s and nothing else —
and it is what a terminal gets when it becomes a serif. It replaces the lab's
own Egyptian numbers, which had a shallow bracket.

The built-ins list first in the preset select, then the master's own, the same
order the width and cap selects use. A built-in cannot be updated in place.

### Units

`serifUnitsMode` is a source default, so every preset in a master shares one units
mode. A preset stores raw numbers. It never records the mode of its capture. A
change of the master units mode reinterprets its presets exactly as it
reinterprets every serif already drawn in that master. That is existing behavior.
This feature adds nothing to it.

A preset copied by hand between masters of different units modes is wrong. Presets
are per master and no copy route exists, so nothing must guard this.

### Storage

One new source default key, `customSerifs`, at path `serifProfiles`, holding an
array. The fallback is the empty array. This matches the width and cap profile
lists. The match is what lets the value survive the existing source-default read,
write and clone path with no new plumbing.

---

## 5. Item 4 — the defaults panel

Two jobs: the list, and the fields.

### The list

One row per preset: a name box, a delete button, and a disclosure toggle. An add
button sits under the list. This is the custom width row with one extra control.

- **Add** appends a preset with the seed from §3. Wing length, tip thickness and
  wing slope come from the source defaults. Everything else is 0. Both wings
  match, and linked is on. The row auto-names as `Serif 1`, `Serif 2`, in the
  pattern the width rows use.
- **Rename** is the name box.
- **Delete** is the two-press confirm that the width rows use. Reuse the same
  armed-row state, so a serif row and a width row cannot arm at the same time.

### The fields

The disclosure toggle expands one preset into its twenty numbers. The layout
matches the parameters panel: three groups per wing, then the linked flag and the
underside cup. Only one preset expands at a time.

**This is the largest single piece of the two items, and it is the one to
question.** A designer can reach the same result with no new interface. Apply the
preset to a terminal, edit it there against the drawn shape, then press update.
The designer asked for both routes and this spec builds both. If the work needs a
cut, remove the expanded editor and keep the list. Nothing else depends on it.

---

## 6. Item 5 — the parameters panel

Three controls, at the bottom of the serif section, above the axis group.

```
Preset  [ Slab foot        v ]  [ Apply to: both v ]  [Apply]
        [Create from selection]  [Update "Slab foot"]
```

### Apply

The row arms on the first press and applies on the second. This is the
force-apply row that the width and cap profiles use. An apply overwrites numbers
a designer drew, so it takes the same guard those have.

The scope control decides what the apply writes:

| Scope      | Writes                                                     |
| ---------- | ---------------------------------------------------------- |
| Both       | Both wings, the linked flag, and the underside cup.        |
| Left only  | The preset's left wing onto the left wing. Nothing else.   |
| Right only | The preset's right wing onto the right wing. Nothing else. |

Left goes to left and right goes to right, with no mirror. The linked flag
already gives a designer the mirror.

A single-wing apply does not write the linked flag. On a linked terminal, the
existing mirror copies the applied wing across. That is the correct result and it
needs no special case.

An apply writes to **every** serifed terminal in the selection. Every other
control in this panel does the same.

### Create from selection

This reads the twenty numbers from the selected terminal and appends a preset.

- **Disabled on a mixed selection.** A preset built from two different terminals
  is neither of them. A refusal is clearer than a silent choice of the first one.
- The row auto-names. The designer renames it later in the defaults panel. No
  modal.
- The select moves to the new preset after the press.

### Update in place

This overwrites the selected preset from the selected terminal. It arms on the
first press and writes on the second, the same as delete. It is disabled on a
mixed selection, and disabled when no preset is selected.

The button carries the preset name, so a stale select cannot aim the press at the
wrong row.

---

## 7. Rails

- **R-B, one write path.** Apply, the seed, and the panel's own field edits all
  use the one serif writer the panel already has. An apply is that writer with
  every field at once. No second route into serif data.
- **R-D, forward provenance.** Untouched. A preset is an input to the serif
  parameters. It never reaches generated geometry.
- **R-G, test harness.** The model half is testable and gets tests. The panel half
  has no harness and gets the manual matrix in §9.

---

## 8. What gets tested

In the core harness. Write these before the code.

1. Normalization fills a missing wing field with its migration value and never
   returns null.
2. A serif that stored nulls generates the same outline before and after the
   migration. Cover `tension`, `concavity` and `easeCurvature`, the three that do
   not migrate to 0.
3. A contour-level serif block no longer reaches the generated outline.
4. Set a point's cap style to serif. The write seeds the three fields from the
   source defaults and zeroes the other seventeen.
5. Set a terminal to butt and back to serif. The numbers survive.
6. The seed reads the master's values, not the fallbacks, when the master holds
   values.
7. A capture returns twenty numbers and the flag, and excludes the axis fields.
8. An apply with scope "both" repeats the captured terminal exactly.
9. An apply with scope "left" leaves the right wing, the cup and the linked flag
   unchanged.
10. An apply on a linked terminal mirrors the applied wing.
11. A preset survives a source-default write and read unchanged.
12. An apply never changes the point count, at every value including all zeros.
    The interpolation contract does not relax for a preset.

---

## 9. Manual matrix

The panels have no harness. Test these by hand.

1. Add, rename and delete a preset in the master defaults. Reload. The list
   survives.
2. Delete arms on the first press and deletes on the second. An armed serif row
   disarms an armed width row.
3. Expand a preset, change a number, collapse it, open it again. The number holds.
4. Set a fresh point's terminal to serif. A visible slab foot appears.
5. Open a file drawn before this change. No serif moves.
6. Create from a terminal, then apply the preset to a second terminal. The two
   match.
7. Press create with a mixed selection. The button is disabled.
8. Apply left only. The right wing does not move.
9. Apply to a multi-point selection. Every serifed terminal takes the values.
10. Select a different preset between the two presses of update. The button label
    names the preset it will overwrite.
11. Undo. One step reverses the whole apply.
12. Change the master units mode. The presets and the drawn serifs reinterpret
    together and do not diverge.

---

## 10. Left open

- **Wing-only presets.** A preset holds a terminal. The scope control applies half
  of one. Storage of half of one is not built.
- **Order of the list.** Add and delete only. The list keeps creation order.
- **Presets shared between masters.** No route, by design. Absolute lengths do not
  survive the trip.
- **The expanded editor in §5 repeats the update button in §6.** The designer
  asked for both. If one must go, it is the editor.
- **A contour cap style has no writer either.** The generator reads
  `contour.capStyle` and no editor control sets it. This work removes the contour
  serif block, which is dead in the same way. It leaves the contour cap style
  alone, because that is cap work and not serif work. File it if it matters.

---

## 11. Cross-references

- Serif backlog items 4 and 5. This spec replaces them as the working description.
- Feature model §8 — the serif terminal, the point-count contract.
- Serif backlog ground rule — points collapse, they do not disappear. A preset of
  all zeros is a legal preset and emits a full point count.
