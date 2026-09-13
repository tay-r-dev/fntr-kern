# 18: Pair table: Side dropdown

**Status:** done

**Blocked by:** 17 (Pair table: Glyphset dropdown)

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line. Side is a plain select with Left or right, Glyph on left, Glyph on right.

## Target

1. Side is a single-choice dropdown on the filter row, first on the row.

## Done when

- [ ] Each choice filters as before.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Pick Glyph on left | Only pairs with the glyph on the left |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
