# 74: Skeleton settings: terminal preset edit dialog

**Status:** ready-for-agent

**Blocked by:** 71 (Skeleton settings: terminal presets table), 51 (Terminal: Square section), 54 (Terminal: Rounded section), 55 (Terminal: Drop section), 58 (Terminal: Serif Easing and Cup groups), 59 (Terminal: Serif Angle group)

## Today

Serif preset fields expand inline under the row.

## Target

1. The pencil opens a `modal-dialog` with every shape field of that preset's kind, built from the Terminal section's own controls.
2. Inline expansion is removed.

## Constraints

- The dialog shows shape fields only. No axis, angle or lock.

## Done when

- [ ] Editing a field in the dialog updates the stored preset.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
