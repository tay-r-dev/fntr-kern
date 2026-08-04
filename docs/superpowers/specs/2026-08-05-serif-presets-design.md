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
geometry then reads every one of them as `params.x ?? 0`. Inherit resolves to
zero, and no level above the point supplies a value. The chain has one link.

The panel uses the same `null` to clear a field. It uses `null` again to report a
mixed selection.

### After

A wing field always holds a number. `null` is not a stored value. Zero is a
setting, not an absence.

- **Reading.** Serif normalization fills a missing or non-finite field with 0.
- **Writing.** The panel writes a number. An empty box writes 0.
- **Mixed selections.** The panel still shows an empty box for a mixed
  selection. This is a display state that the panel computes from the selection.
  The file never holds it.

### Migration

A stored `null` becomes 0. **No shape moves.** The geometry already read `null` as 0. This renames a state. It does not change a value, and no fixture needs new
numbers.

### Where the 20-20-20 goes

Not into reading. If normalization filled an empty wing length with 20, every
serif in every existing file would draw a foot on load. Seeding is a **write**.
It happens at the moment a terminal becomes a serif.

Two paths make a terminal a serif, and both must seed:

1. The cap style select on a point.
2. The cap style select on a contour, which serifs both open ends.

The point cap style path already carries a preset-values argument for the other
cap styles. Seeding uses that argument. The contour path needs the same argument.

A point that has never held serif data draws at zero. It draws nothing. This is
correct, and the interface cannot reach it. Every route into the serif style
writes the seed first.

### New source defaults

Three keys, in the serif defaults block next to the units mode.

| Key                    | Path                            | Fallback |
| ---------------------- | ------------------------------- | -------- |
| `serifNewWingLength`   | `serifDefaults.newWingLength`   | 20       |
| `serifNewTipThickness` | `serifDefaults.newTipThickness` | 20       |
| `serifNewWingSlope`    | `serifDefaults.newWingSlope`    | 20       |

They seed a new serif. They also seed a new preset row in the defaults panel. One
number in one place feeds both. They do not split by glyph case. A serif foot is a
serif foot in either case, and the reason the width defaults split does not apply
here.

The other six wing fields, the linked flag and the underside cup seed at 0 and
false. They get no source default, because zero is already the answer.

---

## 4. What one preset holds

```
{
  name: "Slab foot",
  linked: true,
  undersideCup: 0,
  left:  { wingLength, tipThickness, wingSlope, tipCutAngle,
           reach, tension, concavity, easeDistance, easeCurvature },
  right: { …the same nine… }
}
```

Twenty numbers, one flag, one name.

**Excluded, and why:**

- `axisMode` and `axisAngle` place the terminal. A preset captured on an upright
  stem foot would force a slanted terminal back to perpendicular. Without them,
  one preset stays correct on every terminal in the font.
- `capStyle` is excluded. The serif section appears only when the terminal is
  already a serif, so a preset never has to change the style.

**Easy to miss:** `undersideCup` belongs to the terminal rather than to one wing,
and it is shape. The preset holds it. The preset holds `linked` too. A symmetric
preset must leave a symmetric foot, even on a terminal that was asymmetric.

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

1. Normalization fills a missing wing field with 0 and never returns null.
2. A stored null becomes 0 and the generated outline does not change.
3. Set a point's cap style to serif. The write seeds the three fields from the
   source defaults and zeroes the rest.
4. Set a contour's cap style to serif. The write seeds both open ends.
5. The seed reads the master's values, not the fallbacks, when the master holds
   values.
6. A capture returns twenty numbers and the flag, and excludes the axis fields.
7. An apply with scope "both" repeats the captured terminal exactly.
8. An apply with scope "left" leaves the right wing, the cup and the linked flag
   unchanged.
9. An apply on a linked terminal mirrors the applied wing.
10. A preset survives a source-default write and read unchanged.
11. An apply never changes the point count, at every value including all zeros.
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

---

## 11. Cross-references

- Serif backlog items 4 and 5. This spec replaces them as the working description.
- Feature model §8 — the serif terminal, the point-count contract.
- Serif backlog ground rule — points collapse, they do not disappear. A preset of
  all zeros is a legal preset and emits a full point count.
