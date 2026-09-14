# 60: Terminal: serif preset controls

**Status:** ready-for-agent

**Blocked by:** 57 (Terminal: Serif Wing and Bracket groups with chains), 07 (Terminal presets cover the four kinds with fields), 49 (Skeleton block: Generation preset header)

## Today

Serif presets are a select, a scope select (both, left, right), an apply button and an update button, plus Create from selection.

## Target

1. The Serif carries one preset control (decided 2026-09-14). A preset stores both halves, every link, the angle and the cup, and applying it writes all of them.

## Done when

- [ ] Add, then pick on another endpoint, reproduces both halves, the links and the angle.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
