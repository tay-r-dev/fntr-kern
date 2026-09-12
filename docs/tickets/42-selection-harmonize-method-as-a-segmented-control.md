# 42: Selection: Harmonize method as a segmented control

**Status:** ready-for-agent

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels)

**Builds:** the segmented control. Later tickets reuse it: 43 (Selection: G3 toggle and Calculate in the Harmonize header), 44 (Selection: Gizmo and Handles pair), 48 (Skeleton block: Projection with its overflow), 50 (Terminal: kind picker and one section per point), 52 (Skeleton block: Force angle in Generation). Build it once, where they can import it.

## Today

Inside the merged Selection panel, the transform part holds: a nine-radio origin grid; typed origin X and Y; Move X Y; Scale X Y; Rotate; Skew X Y; Slide both tension points checkbox; Dimensions W H; Flip row; Align; Distribute; path operations; Harmonize. The Harmonize method is a three-position slider bound to application setting `harmonizeMethod` (1 nearest, 2 canonical, 3 canonical with the joint free), with the position's name written beside it. G3 greys it. The skeleton serif section hand-builds a three-way segmented row for Both, L and R.

## Target

1. A shared segmented control exists in `fontra-webcomponents`: a row of text buttons, one on, a disabled state, a change event.
2. The Harmonize method is a segmented control: preserve, recompute, move on-curve, writing 1, 2, 3.
3. G3 on greys it, as it greys the slider today.

## Constraints

- Lift the look from the serif sides row, then leave that row alone; it is replaced by chains in `tm-serif-wing`.

## Done when

- [ ] Each segment runs its construction on the next press.
- [ ] The setting survives a reload.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Pick move on-curve, press Harmonize | Position 3 runs |
| 2 | Turn G3 on | Control greys |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.4; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
