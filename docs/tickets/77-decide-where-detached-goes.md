# 77: Decide: where Detached goes

**Status:** needs-info

**Blocked by:** None (can start immediately)

## Today

The Ribs section has a Detached checkbox for generated handles. The redesigned Generation section has no place for it.

## Target

1. Ask the designer where Detached goes: a Lock icon, the Reset group, an overflow, or dropped.
2. Record it in spec §5.5 and amend ticket 47 (Skeleton block: Lock, Link and Reset icon groups).

## Done when

- [ ] Spec §5.5 names Detached's place.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
