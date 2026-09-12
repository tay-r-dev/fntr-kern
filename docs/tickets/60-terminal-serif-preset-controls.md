# 60: Terminal: serif preset controls

**Status:** ready-for-agent

**Blocked by:** 57 (Terminal: Serif Wing and Bracket groups with chains), 07 (Terminal presets cover all four kinds), 49 (Skeleton block: Generation preset header)

## Today

Serif presets are a select, a scope select (both, left, right), an apply button and an update button, plus Create from selection.

## Target

1. The Serif header carries a left preset control and a right preset control with a chain between them. Closed applies one preset to both wings.

## Done when

- [ ] Applying left-only leaves the right wing unchanged.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
