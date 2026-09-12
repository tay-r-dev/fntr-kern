# 20: Pair table: windowed loading

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

## Today

The controller builds the full filtered item list, renders the first 100, and a Load next 100 button raises a load limit by 100 and appends. The limit never falls and no row is ever removed.

## Target

1. The table renders at most 100 rows.
2. Scrolling within a few rows of the bottom appends the next 25 and removes the first 25. Scrolling near the top prepends the previous 25 and removes the last 25.
3. The scroll position stays on the row the designer was looking at while rows are added and removed.
4. The Load next 100 button is removed.

## Constraints

- The shared table stays unaware of windowing. The window lives in the kerning controller.
- Rebuild the window from the item list on every re-render; do not keep row elements as the source of truth.

## Done when

- [ ] On a filter admitting 1,000 rows, the table never holds more than 100 row elements.
- [ ] Scrolling from top to bottom and back shows every row once, in order.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Scroll a 1,000-row result to the end | Last row reachable, no jump |
| 2 | Scroll back to the top | First row reachable, no jump |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
