# 19: Pair table: column toggles on header right-click

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line. The Columns fieldset toggles Current, Proposed, Delta and Apply columns by class. Hiding one changes display only.

## Target

1. Right-clicking the table head opens a context menu with Current, Proposed, Delta and Apply as checked entries.
2. The Columns fieldset is removed. Hide zero current already moved in `pt-switches`.

## Constraints

- Use the shared `popup-menu`.
- A hidden column changes no row and no action target.

## Done when

- [ ] Each entry hides and shows its column and survives a reload.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Right-click the head, uncheck Proposed | Column hides; rows unchanged |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
