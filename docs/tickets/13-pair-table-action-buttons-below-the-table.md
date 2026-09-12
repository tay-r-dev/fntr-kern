# 13: Pair table: action buttons below the table

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line.

## Target

1. Apply selected, Reset selected to zero and Deselect sit under the count line.

## Done when

- [ ] All three act on the selection as before.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Select two rows, Apply selected | Both apply |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.2. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
