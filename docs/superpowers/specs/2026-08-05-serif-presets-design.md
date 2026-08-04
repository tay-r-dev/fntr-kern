# Serif presets: named terminal shapes, per master

**Date:** 2026-08-05
**Branch:** `feature/skeleton-serif-generator`
**Covers:** serif backlog items 4 (storage and editing) and 5 (apply, create, update).
**Blocking order:** 4 before 5. Both sit behind §3, which changes the serif model itself.

---

## 1. What this is for

A serif terminal holds twenty numbers and one flag. Reproducing a drawn foot on
another glyph means setting all of them by hand. A preset is that set of numbers
under a name, held in the master, applied in one press.

The width profile and cap profile lists are the closest thing already in the
tree. A serif preset follows their storage pattern. It does not follow their
interface, because a width profile is one number and a serif is twenty.

### What already exists, and what does not

| Thing                         | Storage | Editor              | Reader                |
| ----------------------------- | ------- | ------------------- | --------------------- |
| Custom widths, per case       | yes     | yes, defaults panel | yes, parameters panel |
| Custom caps, square and round | yes     | **no**              | yes, parameters panel |

The cap profile lists have a reader and no writer. Nothing in the editor can
create one. So the "existing template" this item leans on is only half built,
and half of what looks like precedent is dead storage. Build the serif list
whole, and leave the cap lists alone.

---

## 2. Decisions

Settled with the designer on 2026-08-05. These are inputs to the design below,
not conclusions from it.

| Question                      | Decision                                                               |
| ----------------------------- | ---------------------------------------------------------------------- |
| Scope of one preset           | The whole terminal. Apply offers both wings, left only, or right only. |
| Does it carry the serif axis  | No. The axis places the terminal, it does not shape it.                |
| Unset fields                  | There are none. Every serif number is always a number. See §3.         |
| A new serif starts at         | Wing length 20, tip thickness 20, wing slope 20. Everything else 0.    |
| Those three numbers           | Master source defaults, not code constants. Settable per master.       |
| How a preset gets its numbers | Two ways: captured off a terminal, and edited in the defaults panel.   |
| Where presets live            | Per master, in the source defaults. Already decided, unchanged.        |

---

## 3. First: the serif loses its inherit chain

**This is a model change and it is the deepest part of the work.** It is not
optional dressing on the preset feature. A preset that stores "unset" for a field
means something different from a preset that stores a number, and the designer
has ruled that the difference should not exist.

### Today

Each of the nine wing fields holds a number or `null`. `null` means inherit. The
geometry then reads every one of them as `params.x ?? 0`. So inherit resolves to
zero, and there is nothing above the point for it to inherit from. The chain is
a chain with one link.

The panel uses the same `null` to clear a field, and again to report a mixed
selection.

### After

A wing field always holds a number. `null` is not a stored value. Zero is a
setting, not an absence.

- **Reading.** Serif normalization fills any missing or non-finite field with 0.
- **Writing.** The panel writes a number. Clearing a box writes 0.
- **Mixed selections.** The panel still shows an empty box for a mixed
  selection. That is a display state computed from the selection. It is never
  stored.

### Migration

A stored `null` becomes 0. **No shape moves**, because the geometry already read
`null` as 0. This is a rename of a state, not a change of value, and no fixture
needs new numbers.

### Where the 20-20-20 goes

Not into reading. If normalization filled an empty wing length with 20, every
serif in every existing file would grow a foot on load. Seeding is a **write**,
performed at the moment a terminal becomes a serif.

Two paths turn a terminal into a serif, and both must seed:

1. The cap style select on a point.
2. The cap style select on a contour, which serifs both open ends.

The point cap style path already carries a preset-values argument for the other
cap styles. Seeding rides on it. The contour path needs the same argument added.

A point that has never held serif data draws at zero. It draws nothing. That is
correct and unreachable through the interface, because every route into the
serif style writes the seed first.

### New source defaults

Three keys, in the existing serif defaults block next to the units mode.

| Key                    | Path                            | Fallback |
| ---------------------- | ------------------------------- | -------- |
| `serifNewWingLength`   | `serifDefaults.newWingLength`   | 20       |
| `serifNewTipThickness` | `serifDefaults.newTipThickness` | 20       |
| `serifNewWingSlope`    | `serifDefaults.newWingSlope`    | 20       |

They seed a new serif, and they seed a new preset row in the defaults panel. One
number in one place feeds both. They are not per glyph case. A serif foot is a
serif foot in either case, and the width defaults split by case for a reason that
does not apply here.

The remaining six wing fields, the linked flag and the underside cup seed at 0
and false. They get no source default, because zero is already the answer.

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
  stem foot would otherwise slam a slanted terminal back to perpendicular.
  Excluding them makes one preset correct on every terminal in the font.
- `capStyle` is excluded. The serif section only appears when the terminal is
  already a serif, so a preset never has to switch the style.

**Included and easy to miss:** `undersideCup` is per terminal rather than per
wing, and it is shape. It travels with the preset. `linked` travels too, because
a symmetric preset applied to an asymmetric foot should leave a symmetric foot.

### Units

`serifUnitsMode` is a source default, so every preset in a master shares one
units mode. A preset stores raw numbers and never records the mode it was
captured under. Changing a master's units mode reinterprets its presets exactly
as it reinterprets every serif already drawn in that master. That is existing
behaviour and this feature adds nothing to it.

A preset copied by hand between masters of different units modes is wrong. Presets
are per master and there is no copy route, so nothing has to guard this.

### Storage

One new source default key, `customSerifs`, at path `serifProfiles`, holding an
array. Fallback is the empty array. This matches the width and cap profile lists,
which is what makes the value round-trip through the existing source-default
read, write and clone path with no new plumbing.

---

## 5. Item 4 — the defaults panel

Two jobs: the list, and the fields.

### The list

One row per preset: a name box, a delete button, and a disclosure toggle. Add
button under the list. This is the custom width row with one extra control.

- **Add** appends a preset seeded from §3 — wing length, tip thickness and wing
  slope from the source defaults, everything else 0, both wings the same, linked
  on. Auto-named `Serif 1`, `Serif 2`, in the pattern the width rows already use.
- **Rename** is the name box.
- **Delete** is the two-press confirm the width rows already use. Reuse the same
  armed-row state so a serif row and a width row cannot both be armed at once.

### The fields

The disclosure toggle expands one preset into its twenty numbers, laid out the
way the parameters panel lays out a serif: three groups per wing, then the linked
flag and the underside cup. One preset expanded at a time.

**This is the largest single piece of the two items, and it is the one worth
questioning.** The same result is reachable with no new interface: apply the
preset to a terminal, edit it there against the drawn shape, press update. The
designer asked for both routes and this spec builds both. If the work needs
trimming, cut the expanded editor and keep the list. Nothing else depends on it.

---

## 6. Item 5 — the parameters panel

Three controls, at the bottom of the serif section, above the axis group.

```
Preset  [ Slab foot        v ]  [ Apply to: both v ]  [Apply]
        [Create from selection]  [Update "Slab foot"]
```

### Apply

Armed, then confirmed, using the same two-press force-apply row the width and cap
profiles use. A preset apply overwrites numbers a designer drew, so it gets the
same guard those do.

The scope control decides what is written:

| Scope      | Writes                                                     |
| ---------- | ---------------------------------------------------------- |
| Both       | Both wings, the linked flag, and the underside cup.        |
| Left only  | The preset's left wing onto the left wing. Nothing else.   |
| Right only | The preset's right wing onto the right wing. Nothing else. |

Left goes to left and right goes to right, with no mirroring. A designer who
wants the mirror has the linked flag, which already does it.

A single-wing apply does not touch the linked flag. If the terminal is linked,
the existing mirroring copies the applied wing across, which is the correct
result and needs no special case.

Apply writes to **every** serifed terminal in the selection, the way every other
control in this panel does.

### Create from selection

Takes the twenty numbers off the selected terminal and appends a preset.

- **Disabled when the selection is mixed.** A preset built from two different
  terminals is neither of them. Refusing is clearer than picking the first one.
- Auto-named, renamed later in the defaults panel. No modal.
- The select switches to the new preset after the press.

### Update in place

Overwrites the selected preset from the selected terminal. Two-press confirm,
the same idiom as delete. Disabled when the selection is mixed, and when no
preset is selected.

The button carries the preset name so the press cannot be aimed at the wrong row
by a stale select.

---

## 7. Rails

- **R-B, one write path.** Apply, create-seed and the panel's own field edits all
  go through the one serif writer the panel already uses. A preset apply is that
  writer called with every field at once. No second route into serif data.
- **R-D, forward provenance.** Untouched. Presets are an input to the serif
  parameters and never reach generated geometry.
- **R-G, test harness.** The model half is testable and gets tests. The panel
  half has no harness and gets the manual matrix in §9.

---

## 8. What gets tested

In the core harness, written before the code:

1. Normalization fills a missing wing field with 0 and never returns null.
2. A stored null migrates to 0 and the generated outline is byte-identical.
3. Turning a point's cap style to serif seeds the three fields from the source
   defaults and zeroes the rest.
4. Turning a contour's cap style to serif seeds both open ends.
5. Seeding reads the master's values, not the fallbacks, when the master sets them.
6. Capture off a terminal returns twenty numbers and the flag, and excludes the
   axis fields.
7. Apply with scope "both" reproduces the captured terminal exactly.
8. Apply with scope "left" leaves the right wing, the cup and the linked flag
   untouched.
9. Apply on a linked terminal mirrors the applied wing.
10. A preset round-trips through the source-default read and write unchanged.
11. Point count is unchanged by any apply, at every value including all zeros.
    The interpolation contract does not relax for a preset.

---

## 9. Manual matrix

The panels have no harness, so these are walked by hand.

1. Add, rename and delete a preset in the master defaults. Reload. The list
   survives.
2. Delete arms on first press and deletes on second. Arming a serif row disarms
   an armed width row.
3. Expand a preset, change a number, collapse, reopen. The number holds.
4. Switch a terminal to serif on a fresh point. A visible slab foot appears.
5. Open a file drawn before this change. No serif moves.
6. Create from a terminal, apply it to a second terminal, compare. Identical.
7. Create with a mixed selection. The button is disabled.
8. Apply left only. The right wing does not move.
9. Apply to a multi-point selection. Every serifed terminal takes it.
10. Update in place, with the wrong preset selected in between. The button label
    names what it will overwrite.
11. Undo. One step returns the whole apply.
12. Change the master units mode. Presets reinterpret with the drawn serifs and
    do not diverge from them.

---

## 10. Left open

- **Wing-only presets.** A preset holds a terminal. The scope control covers
  applying half of one. Storing half of one is not built.
- **Reordering the list.** Add and delete only. The list is in creation order.
- **Sharing presets between masters.** No route, by design, because absolute
  lengths do not survive the trip.
- **The expanded editor in §5 is redundant with the update button in §6.** Both
  were asked for. If one has to go, it is the editor.

---

## 11. Cross-references

- Serif backlog items 4 and 5, which this replaces as the working description.
- Feature model §8 — the serif terminal, the point-count contract.
- Serif backlog ground rule — points collapse, they do not disappear. A preset of
  all zeros is a legal preset and emits a full point count.
