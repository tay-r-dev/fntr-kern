# 04: Lift the pair table into a shared table component

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

**Builds:** the shared table. Later tickets reuse it: 12 (Pair table: tabs on the title row), 13 (Pair table: action buttons below the table), 14 (Pair table: switch row), 15 (Pair table: Unicode types dropdown), 19 (Pair table: column toggles on header right-click), 20 (Pair table: windowed loading), 22 (Pair table: vertical resize grip), 62 (Markers: Rays table), 68 (Skeleton settings: width presets table), 71 (Skeleton settings: terminal presets table). Build it once, where they can import it.

## Today

The kerning view's pair table is markup in the view's HTML plus rendering in its controller: a table head with sortable headers and a select-all tick, a body the controller fills with pair rows and class-summary rows, row selection by click and shift-click held by row identity, and a load-status line with a Load next 100 button. Sort state lives in the view's filters controller. Nothing in `fontra-webcomponents` renders a table.

## Target

1. A shared table component in `fontra-webcomponents` renders a head from column descriptions and a body from row data the caller supplies.
2. It owns: sortable headers with the sort indicator, the select-all tick, row selection by identity with click and shift-click, and a hook for per-cell rendering.
3. The pair table renders through it. Pair rows, class-summary rows, apply and hide cells are the caller's cell renderers.
4. Loading stays the caller's: the component renders the rows it is given. Windowing is ticket 20 (Pair table: windowed loading).

## Constraints

- The component knows nothing about kerning, pairs or classes.
- Rail R-B: after this ticket there is one table implementation. Delete the pair table's own head and selection code.
- Selection is held by row identity, never by element or index. Later tickets remove rows from the document while they stay selected.

## Done when

- [ ] The view's test suite passes without edited expectations.
- [ ] Sort, select-all, shift-click range selection, Apply selected, Reset to zero, hide and restore all behave as before.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Sort by Delta, then by Glyph L | Order and indicator change as before |
| 2 | Click a row, shift-click a row five below | Six rows selected |
| 3 | Tick select-all, Apply selected | Every loaded row applies |
| 4 | Hide a row, turn on Show hidden, restore it | Row returns |

**Spec:** docs/superpowers/UI-REFACTOR.md §3, §7; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
