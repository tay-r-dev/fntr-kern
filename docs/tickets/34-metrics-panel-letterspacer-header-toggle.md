# 34: Metrics panel: Letterspacer header toggle

**Status:** ready-for-agent

**Blocked by:** 14 (Pair table: switch row)

## Today

The Letterspacer block's header carries an Enabled checkbox that writes the per-font enabled flag, and a Reverse button beside it.

## Target

1. The header carries the shared toggle instead of the checkbox, bound to the same flag.

## Constraints

- Reverse moves in `mx-reverse`. Keep it working here until then.

## Done when

- [ ] Toggle off hides the section's controls as the checkbox did; on shows them.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Toggle off and on | Section hides and returns; flag persists |

**Spec:** docs/superpowers/UI-REFACTOR.md §4.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
