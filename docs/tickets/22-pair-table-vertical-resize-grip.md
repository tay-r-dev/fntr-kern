# 22: Pair table: vertical resize grip

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

## Today

The table grows with its content. The middle column already has a resize gutter.

## Target

1. A grip at the table's bottom edge sets its height by drag.
2. The height survives a reload.

## Constraints

- Reuse the middle column gutter's drag code. Rail R-B.

## Done when

- [ ] Dragging the grip changes the height and the rows scroll inside it.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Drag the grip up, reload | Table keeps the shorter height |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
