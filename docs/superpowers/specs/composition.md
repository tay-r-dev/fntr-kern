# Anchor composition — design spec

**Date:** 2026-08-27. Branch `feature/anchors`.
**Status:** design agreed. Numbers and panel layout not yet chosen. Retire this file into
`FEATURE-MODEL.md` and `DEVELOPMENT-LOG.md` when the work lands.

---

## 1. What it is

A component in a composite glyph is attached to the glyph under it by an anchor pair. The editor
solves the attachment and writes the result into the component's own transform. Move the anchor
and the composite reports that it is out of date. The designer then updates it or overrides it.
The editor never rewrites a placement on its own.

Four capabilities, in build order:

1. **Manage** — attach a component, solve it, report its state, update it, override it, detach it.
2. **Build one** — from the open glyph's Unicode decomposition, add the components it names and
   attach each one.
3. **Build many** — the same action driven from the other direction, so selecting a mark composes
   every glyph that uses it.
4. **Preview** — draw the marks that can attach to the open base glyph, filtered by a saved set.

## 2. Vocabulary

These words are used exactly. Add them to `GLOSSARY.md` when the work lands.

**Base glyph** — the glyph a mark attaches to. The `a` in `aacute`.

**Mark** — a glyph that attaches to another. It carries at least one anchor whose name starts with
an underscore. A glyph with no contours whose every component is a mark is also a mark.

**Attachment** — the stored statement that one component hangs on an anchor of the thing below it.

**Anchor pair** — a plain anchor on the thing below, such as `top`, and the anchor of the same
name with an underscore in front on the component, `_top`. The pair is what an attachment names.

**Detached component** — an attached component the designer has moved by hand, and said so. The
solver stops setting it. The word is the skeleton's own, and it means the same thing there.

**Mark cloud** — the preview drawing of every mark that can attach to the open base glyph.

**Glyph set** — a list of glyph names and code points the project says the font should carry.
Fontra already holds these, per project and per user.

## 3. What exists today

**Anchors.** A name, an x and a y, per layer, on every glyph. They round-trip to UFO. They
interpolate by name, and a name mismatch between two sources is an interpolation error. Two
sources that carry the same names in a different order are both sorted by name first. The editor
can add, edit, move, select, copy and delete them, and two canvas layers draw them.

**Components.** A name, a transform and a location, per layer. They interpolate. Decompose already
carries a component's anchors into the parent, and a glyph's own anchor wins on a name collision.

**The underscore convention is already read in two places.** Propagated anchors give a glyph's own
anchors plus its components', with the glyphsLib rule about receiving anchors. The shaper emulates
mark-to-base, mark-to-mark, mark-to-ligature and cursive attachment from anchor names, for the
text line preview.

**Glyph sets.** The scene controller already builds a glyph sets controller and a combined glyph
map in the editor, the same one the font overview uses.

**What is absent.** Nothing writes a component transform from an anchor pair. Adding a component
inserts it at the identity transform. No attachment is stored anywhere.

## 4. What is stored

One new section under the `fontra.internal` key, beside the two the skeleton uses. Access is
through `fontra-internal-data.js` alone. That is the standing rule for this key, and
`test-fontra-internal-data.js` covers those two accessors already.

The section sits on the **glyph**, not on a layer. An attachment is structure, and structure is
identical in every layer. The offsets it produces are per layer, and they live where component
offsets already live.

The section holds one entry per component, in component order. The list is always the same length
as the component list. A component with no attachment holds an empty entry.

An entry carries four things.

| Field                    | Meaning                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Anchor name              | What matching landed on, such as `top`. Without the underscore.                         |
| Hangs on                 | The base, or the index of another component. This is what stacks a ring under an acute. |
| Detached                 | The designer moved this component by hand and meant it. The solver stops setting it.    |
| Solved offset as written | What the solver last wrote. One offset per layer, keyed by layer name.                  |

**The last field is what makes the two buttons possible.** Comparing the component transform
against a fresh solve says only that the two differ. Comparing both against the offset last
written says _which one moved_. The anchors moving is "out of date". The transform moving is a
hand edit.

It is also the one field in a glyph-level section that is per layer. It has to be: the solve
produces a different number in each master, and the record of what was written must match what was
written. It is a record of past writes, not a statement of structure, and no reader may treat it
as one. A layer name it does not carry reads as "never written", which is the state a freshly
attached component is in.

### 4.1 The positional risk, stated

Components have no stable ids in Fontra, so a positional list is invalidated by any operation that
restructures the component list. This is the same fault the generated contours have, and the
development log records that the donor hit it twice.

The difference is that the set of operations is small and enumerable. Five sites mutate the
component list: add component, paste, cut, delete selection, and decompose. Each one updates the
attachment list in the same change. This is the rule the knife and the pen already follow for
generated contours, and it is a work item in the plan rather than an assumption.

**The alternative was considered and rejected.** An id inside each component's own customData
survives reordering. It costs a per-layer field that every layer must carry identically, and it
raises a question about what interpolation does with it. The positional list plus five pieces of
bookkeeping is smaller and needs no schema change.

## 5. The solve

### 5.1 Matching

An attachment is made by matching, never by typing. The component's underscore anchors are
compared against the plain anchors of the thing below. The pair both sides carry becomes the
attachment, and the name is recorded in the entry.

Where the two sides share more than one name, the attachment is ambiguous. The panel reports it
and offers the names. It does not pick one silently. Three of the five reference tools treat a
mark carrying more than one anchor name as an error worth reporting.

Where the recorded name no longer exists on either side, the attachment is **broken**. Matching
runs again and offers a replacement.

### 5.2 The offset

The offset is the base anchor position minus the mark anchor position. Both are read at the same
layer. So one attachment produces a different offset in each master, which is the whole point of
storing the intent instead of the number.

The offset is written into the component transform's translation. Nothing else in the transform is
touched, so a scaled or rotated component keeps its scale and its rotation.

### 5.3 Stacking

A component may hang on another component instead of on the base. The solver places the components
in order. After a component is placed, its own plain anchors are read at their placed positions,
and they become available to the components after it.

This is the Anchor Overlay rule, and it is what makes `Aringacute` work: the ring attaches to the
`A`, and the acute attaches to the ring's own `top`.

**A cycle is refused.** A component that hangs on itself, directly or through a chain, reports as
broken.

### 5.4 What the solve does not do

It does not touch the advance width, except in the build action of §7. It does not create anchors
on the composite. It does not read or write feature code.

## 6. States and actions

Four states per component. The panel shows one per row.

| State       | Condition                                                               |
| ----------- | ----------------------------------------------------------------------- |
| In sync     | The transform equals the solve, and both equal the offset last written. |
| Out of date | The solve differs from the offset last written. The anchors moved.      |
| Detached    | The designer moved the component by hand and said so.                   |
| Broken      | An anchor named by the entry does not exist, or the chain is a cycle.   |

Three actions.

**Update.** Write the solved offset into the component transform, in every layer, and record it as
the offset last written. The row returns to in sync.

**Override.** Keep the transform as it stands, and mark the entry detached. The row stops reporting
as out of date. The entry keeps its anchor name, so the designer can bring it back later.

**Detach.** Drop the attachment. The component keeps its transform and becomes an ordinary
component.

### 6.1 A hand-drag detaches

Dragging an attached component marks it detached and records its new transform. The skeleton
settled the same question once: a direct handle drag clears the segment's curvature pin, because
the hand is the later and more specific answer to the same question. The panel then shows the
component as detached, with one action to put it back under the anchors.

### 6.2 When the solve runs

The solve runs when the glyph is opened and when the glyph is edited. It writes nothing. It only
produces the state the panel shows.

A write happens only when the designer presses Update, presses the build action, or drags a
component.

**A glyph nobody opens keeps its old transform.** This is deliberate. The alternative is a cascade
that rewrites every dependent glyph on every frame of an anchor drag, across every layer, with an
undo that has to cover all of them. The batch action of §7.2 is the answer for a whole font.

## 7. The build actions

### 7.1 Build one

On the open glyph, one action:

1. Read the glyph's Unicode decomposition. `unicodeMadeOf` in `unicode-utils.js` already gives it,
   and the Related Glyphs panel already displays it.
2. Map each code point to a glyph name through the font's character map, and through the combined
   glyph map where the font does not carry it.
3. Add the components the decomposition names that are not already present. Existing components
   are left alone, whatever put them there.
4. Match and attach each added component.
5. Set the advance width from the base glyph, once. Every reference tool does this. Managing does
   not keep enforcing it afterwards, because a designer must be able to respace an accented glyph
   without the tool arguing.
6. Solve and write.

**Nothing records how a component arrived.** A component the designer added by hand and a
component this action added are the same thing, and they attach the same way.

### 7.2 Build many

The same action over a list of glyphs. Two ways to name the list.

- **From a mark.** With a mark glyph open, compose every glyph that uses it. `unicodeUsedBy` gives
  the list, and the Related Glyphs panel already displays it.
- **From a selection.** Compose each selected glyph.

**The glyph set bounds the list.** A target is a glyph in the combined glyph map, which is the
font's own glyphs plus the selected project and user glyph sets. A character in the Unicode table
but in no selected glyph set is not a target, and is not reported as missing.

**A target in the glyph set but not in the font is created.** The glyph set is the project's
statement that the font should carry that glyph, so creating it needs no second question.

The batch reports what it did: composed, skipped because already in sync, and refused with a
reason. A refusal names the missing anchor or the missing component glyph.

## 8. The preview

On a base glyph, draw every mark whose underscore anchor matches one of this glyph's plain
anchors, each placed by the solve of §5.2. It writes nothing.

It redraws while an anchor is dragged, so the designer sees the whole family of accents move.

**Filtering.** A font has many marks and the cloud is unreadable at full size. The designer builds
named sets of mark glyphs and shows one set at a time. Mark Tool does exactly this, and stores the
choice per glyph.

Sets are a view preference. They go in `applicationSettingsController`, which is localStorage, by
decision D9. Nothing writes them to a project file.

**One mark, one anchor name.** Adjust Anchors refuses a mark carrying more than one underscore
anchor name, and reports it. The preview does the same: it draws such a mark once per name and
flags it in the panel.

## 9. Where the code goes

Rails R-A, R-B and R-G govern this. The file structure is appended to, not rearranged.

| File                                                  | New or shared | Role                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/composition.js`                      | **new**       | Pure logic. Matching, the offset solve, the chain order, the four states, the decomposition to a component list. No DOM, no glyph controller, no editor. Mocha-tested.                                         |
| `fontra-core/src/fontra-internal-schema.js`           | shared        | One name added to the section list.                                                                                                                                                                            |
| `views-editor/src/composition-editing.js`             | **new**       | The one write path. Attach, update, override, detach, build one, build many. Every write goes through `editLayersAndRecordChanges` and records the attachment list and the component transforms in one change. |
| `views-editor/src/visualization-layer-composition.js` | **new**       | The mark cloud draw.                                                                                                                                                                                           |
| `views-editor/src/panel-related-glyphs.js`            | shared        | A composition section: the component rows, their states, the three actions, the build actions, the preview switches.                                                                                           |
| `views-editor/src/visualization-layer-definitions.js` | shared        | Registers the cloud layer with an imported draw only.                                                                                                                                                          |
| `views-editor/src/editor.js`                          | shared        | Menu actions. Component-list bookkeeping at the four sites it owns.                                                                                                                                            |
| `views-editor/src/scene-controller.js`                | shared        | Component-list bookkeeping at decompose.                                                                                                                                                                       |
| `fontra-core/assets/lang/en.js`                       | shared        | Strings.                                                                                                                                                                                                       |
| `fontra-core/tests/test-composition.js`               | **new**       | Tests for the core module.                                                                                                                                                                                     |

**One write path.** Nothing outside `composition-editing.js` writes the attachment section, and
nothing outside it writes a component transform on behalf of an attachment. This is rail R-C
applied to a second feature, for the same reason: undo, incremental sync and multi-layer editing
then come from the existing change system unchanged.

**The panel is a reader.** It computes nothing. It asks the core module for the state and calls the
write path for the actions.

## 10. Testing

`fontra-core` has a harness and `views-editor` does not, per rail R-G. So the split is:

**Automated, in `test-composition.js`:**

- Matching: one shared name, several shared names, none, a name on one side only.
- The offset: a plain pair, a chained pair, a mark on a mark, a component with a scale.
- Chain order: two marks on one base, a mark on a mark, a cycle.
- The four states, including the case that separates "the anchors moved" from "the hand moved it".
- Decomposition to a component list, including a code point the font does not carry.
- Per-layer solve: two masters with different anchor positions produce two different offsets.

**Manual matrix, owed with the editor work:**

- Attach, update, override, detach on a two-component glyph.
- Drag an attached component and confirm it reports detached.
- Move an anchor in the base glyph, reopen the accented glyph, confirm it reports out of date.
- Build one on an empty glyph, on a glyph that already holds one component, and on a glyph with no
  decomposition.
- Build many from a mark, with a glyph set selected and with none.
- Add, paste, cut and delete a component, and confirm the attachment list still names the right
  components.
- Decompose a composite that holds an attachment.
- The cloud on a base glyph with two anchor names, and with a set selected.

## 11. Out of scope

Each of these is a feature of its own size, and each is easier once this one exists.

- **A construction language.** Glyph Construction's text syntax, its parser, its window and its
  saved recipe files. This spec takes the language's position rule and leaves the language.
- **Writing anchors onto a composite.** Mark Tool propagates a component's anchors up into the
  parent glyph and writes them. Fontra already computes propagated anchors for reading, which is
  what the shaper needs. Writing them is a separate decision.
- **Automatic anchor placement.** Anchor Dropper's rule: the y from a named font dimension per
  glyph class, the x from the midpoint of the outline's crossings at that height. Useful, and
  unrelated to composition.
- **Mark feature generation.** Writing `mark` and `mkmk` feature code from the anchors.

## 12. Open questions

1. **Ambiguous matching.** Where both sides share two anchor names, the panel offers them. Whether
   it refuses to attach until the designer picks, or attaches to the first and flags it, is not
   decided.
2. **Ligature components.** The references lay ligature components out side by side by advance
   width plus kerning, and they use numbered anchor names. This spec does not cover ligatures. A
   ligature component simply carries no attachment.
3. **Right-to-left.** The shaper swaps entry and exit for cursive attachment in RTL. Mark
   attachment itself is direction-independent, so nothing here changes. Confirm against a real RTL
   font before saying so in the feature model.
4. **Panel layout.** Which controls sit in the Related Glyphs panel and which belong in a menu is
   not decided. The panel already holds five glyph-cell sections and is a single file.
