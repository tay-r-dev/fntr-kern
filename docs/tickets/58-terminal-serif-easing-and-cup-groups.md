# 58: Terminal: Serif Easing and Cup groups

**Status:** done

**Blocked by:** 57 (Terminal: Serif Wing and Bracket groups with chains)

## Today

Contour easing has Ease distance and Ease curvature per half. Underside cup, Cup balance and Cup tension are terminal-level.

## Target

1. Easing: Distance, Curvature as chained rows. Cup: Cup, Cup balance, Cup tension as single fields, since the cup belongs to the terminal.

## Done when

- [ ] Values write as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
