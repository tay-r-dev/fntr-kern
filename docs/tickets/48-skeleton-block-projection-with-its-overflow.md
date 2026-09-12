# 48: Skeleton block: Projection with its overflow

**Status:** ready-for-agent

**Blocked by:** 47 (Skeleton block: Lock, Link and Reset icon groups), 42 (Selection: Harmonize method as a segmented control), 15 (Pair table: Unicode types dropdown)

**Builds:** the overflow button. Later tickets reuse it: 53 (Skeleton block: Force angle lock-mode overflow), 59 (Terminal: Serif Angle group). Build it once, where they can import it.

## Today

The Contour section has a Sides select (both, left, right) and two checkboxes, Keep form and Keep edits, bound to application settings `skeletonSideModeKeepsForm` and `skeletonSideModeKeepsEdits`. Keep edits is disabled while Keep form is off.

## Target

1. A Projection group on the icon row: a segmented control D, L, R for sides both, left, right.
2. A shared overflow button, a vertical three dots, opens a multi-select dropdown with keep shape and preserve changes, bound to the two settings, with preserve changes disabled while keep shape is off.
3. The Sides select and the two checkboxes are removed.

## Done when

- [ ] Switching sides behaves as the select did, honoring both settings.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Keep shape on, switch to L | Letter holds its form |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
