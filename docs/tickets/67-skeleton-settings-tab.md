# 67: Skeleton settings tab

**Status:** ready-for-agent

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels), 14 (Pair table: switch row)

## Today

The Source defaults block is embedded in the Selection info panel. The skeleton panel shows Drop points that draw nothing as a checkbox with a warning.

## Target

1. A right-sidebar tab called Skeleton settings takes the slot the old Skeleton tab held.
2. It shows Delete collapsing points as a labeled toggle with the warning under it.
3. The Source defaults block leaves the Metrics panel.

## Done when

- [ ] The toggle writes the same stored setting.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.1, §6.2. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
