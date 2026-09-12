# 40: Selection: Flip, Align, Distribute and Bools rows

**Status:** ready-for-agent

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels)

## Today

Inside the merged Selection panel, the transform part holds: a nine-radio origin grid; typed origin X and Y; Move X Y; Scale X Y; Rotate; Skew X Y; Slide both tension points checkbox; Dimensions W H; Flip row; Align; Distribute; path operations; Harmonize. Flip is a row of two icon buttons. Align, Distribute and path operations each have a header and a row of icon buttons.

## Target

1. Flip and Align share one row under two small labels.
2. Distribute, with its spacing number, and Bools, the path operations, share the next row.

## Done when

- [ ] Every button does what it did.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Press each button once | Same result as before |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
