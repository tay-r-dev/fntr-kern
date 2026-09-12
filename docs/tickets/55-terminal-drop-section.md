# 55: Terminal: Drop section

**Status:** ready-for-agent

**Blocked by:** 50 (Terminal: kind picker and one section per point), 26 (Visual: SpeedPunk compact scrub fields)

## Today

Drop shows Ball size, Ball shape and Easing rows.

## Target

1. Ball shows Size, Shape and Ease as compact scrub fields.

## Done when

- [ ] Values write as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
