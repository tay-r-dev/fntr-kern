# 16: Pair table: Class relationship dropdown

**Status:** ready-for-agent

**Blocked by:** 15 (Pair table: Unicode types dropdown)

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line.

## Target

1. The four relationship checks move into a multi-select dropdown on the filter row. The fieldset is removed.

## Done when

- [ ] Each check filters as its checkbox did, and survives a reload.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Uncheck Exceptions | Exception rows leave |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
