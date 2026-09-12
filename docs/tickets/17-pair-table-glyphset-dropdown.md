# 17: Pair table: Glyphset dropdown

**Status:** ready-for-agent

**Blocked by:** 15 (Pair table: Unicode types dropdown)

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line. Glyphset is a plain select.

## Target

1. Glyphset is a dropdown on the filter row, same look as the others. It stays single-choice: its list checks one entry.

## Constraints

- If the multi-select dropdown cannot hold one-of-many without a second component, add a single-choice mode to it rather than build a second dropdown.

## Done when

- [ ] Choosing a glyphset filters as before and survives a reload.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Pick a glyphset | Rows narrow |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
