# 46: Skeleton block: Generation layout

**Status:** done

**Blocked by:** 45 (Skeleton block: chain on the width row), 26 (Visual: SpeedPunk compact scrub fields)

## Today

The Point widths section shows Linked, Tied ribs, Total, Left, Right, a Distribution slider, Rib angle lock, lock mode and a force-apply row, each on its own row.

## Target

1. A Generation accordion shows Total and Distribution on one row, and Left, chain, Right on the next, as compact scrub fields.

## Constraints

- Distribution stays a per-point value. Only the default distribution is dropped, in `width-preset-model`.
- Single-sided greys and blanks the per-side values and distribution, as today.

## Done when

- [ ] Every value scrubs and types as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
