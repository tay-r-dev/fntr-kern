# 62: Markers: Rays table

**Status:** ready-for-agent

**Blocked by:** 04 (Lift the pair table into a shared table component)

## Today

The Markers panel shows a Rays header and a Dimensions header, each followed by one form row per marker: label and place, measurement with delta, an editable target, a group select, a visibility dot and a delete cross. Under them, Hide all and a two-press Erase all whose arming lapses on a timer. Then Groups: a row per group with a visibility checkbox, a name field and a count with a delete cross, and New group.

## Target

1. Rays render in the shared table: ID, Nodes, Value, Goal, Group, Action.
2. Goal is an editable number with the delta after it. Group is a dropdown. Action is an eye and a trash.

## Constraints

- A stale marker reads broken in Value with no delta.
- Every edit goes through the markers write path.

## Done when

- [ ] Every edit a row allowed, the table allows.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §7.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
