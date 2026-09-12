# 53: Skeleton block: Force angle lock-mode overflow

**Status:** ready-for-agent

**Blocked by:** 52 (Skeleton block: Force angle in Generation), 48 (Skeleton block: Projection with its overflow)

## Today

The lock mode is a select, stroke or rib, disabled with no lock.

## Target

1. An overflow at the end of the Force angle row offers keep the stem width (stroke) and keep the footprint (rib), one checked, disabled while Force angle is Free.
2. The lock mode select is removed.

## Done when

- [ ] The mode writes as the select did.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
