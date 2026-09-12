# 30: Visual: Skeleton switches

**Status:** needs-info

**Blocked by:** 24 (Visual: Coarse Grid header toggle with the freeze)

## Today

No setting named Show generated geometry or Speedpunk on skeleton exists. Skeleton drawing layers are `fontra.skeleton.width-shading`, `fontra.skeleton.centerline` and siblings. SpeedPunk has one layer, `fontra.curvature`.

## Target

1. A Skeleton accordion in the Visual group with two labeled toggles, Show generated geometry and Speedpunk on skeleton.

## Constraints

- Neither switch has a defined behavior or a setting behind it. Get from the designer what each one hides or draws before building. Do not bind them to an existing layer by guess.

## Done when

- [ ] Each toggle does what the designer defined, and survives a reload.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §2.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
