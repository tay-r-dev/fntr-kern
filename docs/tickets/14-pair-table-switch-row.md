# 14: Pair table: switch row

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

**Builds:** the labeled toggle. Later tickets reuse it: 24 (Visual: Coarse Grid header toggle with the freeze), 34 (Metrics panel: Letterspacer header toggle), 41 (Selection: Smart scale toggles), 43 (Selection: G3 toggle and Calculate in the Harmonize header), 67 (Skeleton settings tab). Build it once, where they can import it.

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line. Every filter here is a plain checkbox. The Analytics Hidden results counter finds the Show hidden checkbox by id and turns it on.

## Target

1. A shared toggle element exists in `fontra-webcomponents`: a pill that slides, with a label, a checked state, a disabled state and a change event, following the theme tokens.
2. One row holds, in order: Only marked as a labeled toggle, then zero-current, group members and show hidden as checkboxes.
3. Zero-current is the Hide zero current filter with a shorter label. Its behavior does not change.
4. Group members is Show members with a shorter label.

## Constraints

- The Hidden results counter must still turn Show hidden on. Update its lookup if the id changes.
- The toggle is one shared element. Ticket `coarse-toggle` reuses it in a header.

## Done when

- [ ] Each of the four filters changes the rows exactly as before.
- [ ] Clicking Hidden results in Analytics turns show hidden on.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Toggle Only marked | Only marked rows remain |
| 2 | Click Hidden results | Show hidden ticks, hidden rows appear |
| 3 | Switch theme | Toggle legible in both |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.2; docs/superpowers/UI-NOMENCLATURE.md §14.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
