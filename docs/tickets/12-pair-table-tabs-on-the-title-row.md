# 12: Pair table: tabs on the title row

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line. The two tabs are buttons in a tablist, switched by the controller's results-tab setter.

## Target

1. A title reads Kerning above the Glyph field.
2. The two tabs sit at the title's right, drawn as one pill with the active half filled.
3. Switching behaves as before. One tab is active, never both.

## Constraints

- Styling and placement only. Keep the tablist roles and the setter.

## Done when

- [ ] Clicking Potential exceptions shows that tab's rows and fills that half.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Switch tabs twice | Rows and fill follow |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.2. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
