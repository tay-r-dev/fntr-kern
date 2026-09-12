# 54: Terminal: Rounded section

**Status:** ready-for-agent

**Blocked by:** 50 (Terminal: kind picker and one section per point), 26 (Visual: SpeedPunk compact scrub fields)

## Today

Round shows Cap radius ratio as a logarithmic slider and Cap tension in percent.

## Target

1. Rounded shows Radius and Roundness as compact scrub fields, keeping each value's display conversion.

## Done when

- [ ] Values match what the sliders wrote for the same shape.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
