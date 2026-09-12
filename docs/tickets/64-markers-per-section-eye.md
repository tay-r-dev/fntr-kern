# 64: Markers: per-section eye

**Status:** ready-for-agent

**Blocked by:** 62 (Markers: Rays table)

## Today

The Markers panel shows a Rays header and a Dimensions header, each followed by one form row per marker: label and place, measurement with delta, an editable target, a group select, a visibility dot and a delete cross. Under them, Hide all and a two-press Erase all whose arming lapses on a timer. Then Groups: a row per group with a visibility checkbox, a name field and a count with a delete cross, and New group.

## Target

1. An eye in each section header hides or shows that section's markers only. Hide all is removed.

## Done when

- [ ] Hiding rays leaves dimensions visible.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §7.2. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
