# 02: Reproduce and fix: the origin reportedly steers only Flip

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

The designer reports that the Transformation panel's origin works for Flip and for nothing else. The code does not show that fault directly: Move, Scale, Rotate, Skew, Dimensions and both Flips all go through the panel's one transform entry, which pins every transform at the point the origin control names. Move is a translation, so its pin has no visible effect by construction. The fault, if it is real, is somewhere that reading does not show: the origin grid's radio state, the typed X and Y origin fields, a stale value, or a transform that recomputes its bounds per layer.

## Target

1. Reproduce the report in the editor before changing anything. Record the exact steps and what happened.
2. Find the cause by reading the running state, not by guessing from the source.
3. Fix the cause at the one shared transform entry if that is where it lives.
4. If the report does not reproduce, write down the steps that were tried and stop. Do not change code.

## Constraints

- Rail R-A: the fix belongs in the transform entry or the origin state, not in each button's handler.

## Done when

- [ ] The ticket's closing comment names the cause, or states that it did not reproduce and lists the steps tried.
- [ ] If fixed: every row of the matrix passes.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Select a rectangle, origin top-left, Rotate 90 | It turns about its top-left corner |
| 2 | Same, origin bottom-right, Scale 200 | It grows away from its bottom-right corner |
| 3 | Same, origin centre, Skew 20 0 | It shears about its centre |
| 4 | Type an origin X and Y, then Rotate | It turns about the typed point |
| 5 | Change the origin, then Flip | Flip still mirrors about the chosen origin |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
