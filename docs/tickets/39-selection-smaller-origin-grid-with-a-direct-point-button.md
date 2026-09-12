# 39: Selection: smaller origin grid with a direct-point button

**Status:** ready-for-agent

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels), 02 (Reproduce and fix: the origin reportedly steers only Flip)

## Today

Inside the merged Selection panel, the transform part holds: a nine-radio origin grid; typed origin X and Y; Move X Y; Scale X Y; Rotate; Skew X Y; Slide both tension points checkbox; Dimensions W H; Flip row; Align; Distribute; path operations; Harmonize.

## Target

1. The nine-position grid is smaller and sits on the Origin row with the typed X and Y.
2. A button beside it enters a pick mode: the next canvas click sets typed X and Y to that point. Escape leaves pick mode.

## Done when

- [ ] A picked point becomes the pin for the next transform.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Pick a point, Rotate 90 | Turns about the picked point |
| 2 | Enter pick, press Escape | No change |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
