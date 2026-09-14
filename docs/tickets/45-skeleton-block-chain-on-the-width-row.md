# 45: Skeleton block: chain on the width row

**Status:** done

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels)

**Builds:** the chain. Later tickets reuse it: 46 (Skeleton block: Generation layout), 57 (Terminal: Serif Wing and Bracket groups with chains), 61 (Corner rounding: chained rows). Build it once, where they can import it.

## Today

The Point widths section has a Linked checkbox and Total, Left and Right number rows. Linked governs how typed numbers are shared.

## Target

1. A shared chain element exists: a small icon button between two fields, closed or open.
2. Left and Right sit on one row with a chain between them, bound to `width:linked`. Closed greys Right and writes both from Left.
3. The Linked checkbox is removed.

## Constraints

- A drag's geometry never reads the linked flag (feature model §5). The chain only changes how numbers are typed.

## Done when

- [ ] Closing the chain and typing Left writes both sides.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Close chain, type Left 40 | Both 40 |
| 2 | Open chain, type Left 30 | Right stays 40 |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.8; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
