# 49: Skeleton block: Generation preset header

**Status:** done

**Blocked by:** 46 (Skeleton block: Generation layout), 06 (Width presets as one list with a side)

## Today

A force-apply row under Point widths picks base, horizontal, contrast or a custom width and applies it with a two-click confirm.

## Target

1. The Generation header carries a preset dropdown, an add button and an update button.
2. Picking a preset applies it to the selected points with the two-click confirm.
3. Add stores the selected points' width and side as a new preset; update overwrites the chosen one.
4. The force-apply row is removed.

## Done when

- [ ] Add then pick on another point writes the same width and side.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
