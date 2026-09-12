# 03: Delete the Balance command

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

Balance is a separate command. The Transformation panel draws a Balance header, a button and a report line, and holds its report state and formatter. The scene controller registers `action.balance`, lists it in the glyph context menu, and implements it for paths and, through the skeleton panel edits module, for skeleton points. Harmonize's own finishing pass reuses the balance rule from core.

## Target

1. Remove the Balance section, its report state and its formatter from the Transformation panel.
2. Remove `action.balance`, its context-menu entry and the scene controller's balance method.
3. Remove the skeleton panel edits entry that only Balance calls.
4. Remove the Balance strings from the English localization file.

## Constraints

- Keep the core balance rule. Harmonize's finishing pass calls it. Delete a core function only if nothing else imports it after this change, and grep to prove it.

## Done when

- [ ] A grep for `doBalance`, `action.balance` and `balancePanelSkeletonPoints` finds nothing.
- [ ] Harmonize with the finishing pass on still balances the handles it touches.
- [ ] `cd src-js/fontra-core && npm test` passes.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Right-click a curve | No Balance entry |
| 2 | Harmonize a joint with the finishing pass on | Handles come out balanced as before |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
