# 37: Metrics panel: Calculated table

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

Two header rows read `Current: LSB=…, RSB=…` and `Calculated: LSB=…, RSB=…`, updated in place. Calculate and Apply sit in a button container under the section.

## Target

1. A small table with columns L and R and rows Current and Calculated.
2. Calculate and Apply stack to its right.

## Constraints

- Keep the in-place value update without a form rebuild.

## Done when

- [ ] Calculate fills the Calculated row; Apply writes margins; both grey out as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Calculate | Calculated row fills |
| 2 | Change Area | Calculated row clears |

**Spec:** docs/superpowers/UI-REFACTOR.md §4.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
