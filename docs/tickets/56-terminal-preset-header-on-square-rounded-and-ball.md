# 56: Terminal: preset header on Square, Rounded and Ball

**Status:** ready-for-agent

**Blocked by:** 51 (Terminal: Square section), 54 (Terminal: Rounded section), 55 (Terminal: Drop section), 07 (Terminal presets cover all four kinds), 49 (Skeleton block: Generation preset header)

## Today

Only serifs have presets.

## Target

1. Each of the three section headers carries a preset dropdown, add and update, listing that kind's presets.

## Constraints

- Reuse the Generation preset header. Rail R-B.

## Done when

- [ ] Add then apply on another endpoint reproduces the shape.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
