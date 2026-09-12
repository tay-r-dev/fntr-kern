# 44: Selection: Gizmo and Handles pair

**Status:** ready-for-agent

**Blocked by:** 42 (Selection: Harmonize method as a segmented control), 05 (Merge the Transformation and Skeleton parameters panels)

## Today

The skeleton panel's Ribs section has a Generated gizmos checkbox writing the `fontra.skeleton.generated-tunni` layer key, which is the single source of truth for gizmo mode and is also in the View menu.

## Target

1. A Skeleton heading starts the skeleton part, with a two-way segmented control Gizmo and Handles at its right, bound to that key.
2. The Generated gizmos checkbox is removed.

## Done when

- [ ] The pair and the View menu always agree.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Pick Handles | Gizmos vanish, handles draggable |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
