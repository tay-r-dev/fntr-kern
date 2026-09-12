# 21: Pair table: selection, count and select-all across the window

**Status:** ready-for-agent

**Blocked by:** 20 (Pair table: windowed loading)

## Today

The count line reads Showing loaded of total. Select-all ticks every loaded row and its tooltip says loaded rows. Selection is held by row identity.

## Target

1. The count line counts every row the filters admit.
2. Select-all selects every admitted row, in and out of the window. Its tooltip says so.
3. A row selected while out of the window shows selected when it scrolls back in.
4. Apply selected and Reset selected to zero act on every selected row, in or out of the window.

## Done when

- [ ] A test selects all on 300 rows and asserts 300 selected with 100 rendered.
- [ ] The view's test suite passes.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Select a row, scroll far away and back | Still selected |
| 2 | Select all on a long result, Apply selected | Every admitted row applies |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
