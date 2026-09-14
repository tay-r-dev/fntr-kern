# 52: Skeleton block: Force angle in Generation

**Status:** done

**Blocked by:** 46 (Skeleton block: Generation layout), 42 (Selection: Harmonize method as a segmented control)

## Today

Rib angle lock is a select in Point widths: auto, horizontal, vertical. It applies at every point, ends and corners alike. It was offered at every point in commit 06ce4ab21 because the field and the generator were always per point.

## Target

1. Generation shows a Force angle row under the widths: a segmented control Free, Vertical, Horizontal bound to the rib angle lock (auto, vertical, horizontal).
2. It shows for every selected skeleton point, not only ends.
3. The Rib angle lock select is removed.

## Done when

- [ ] A corner point and an end point both offer Force angle and write the lock.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Select an end, pick Horizontal | Terminal squares to the baseline |
| 2 | Select a corner of N, pick Horizontal | Corner cut flat on the forced rib, stroke width kept |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
