# 11: Autokern panel: alignment row

**Status:** ready-for-agent

**Blocked by:** 08 (Autokern panel: title and section order)

**Builds:** the icon button's on state. Later tickets reuse it: 23 (Designspace panel: Phrase group), 36 (Metrics panel: Reverse as an icon in the Area field), 47 (Skeleton block: Lock, Link and Reset icon groups), 66 (Markers: group rows). Build it once, where they can import it.

## Today

The kerning view sets its scene alignment to left in the controller and offers no control. The shared `icon-button` has an icon, a disabled state and a click, and no on state. The editor's Text Entry panel hand-builds an alignment row from bare inline icons with its own selected class, using `/images/alignleft.svg`, `aligncenter.svg` and `alignright.svg`.

## Target

1. `icon-button` gains an on state: a boolean property and attribute, drawn with the theme's selected background.
2. Under the phrase box, three icon buttons set the preview alignment to left, center or right. Exactly one is on.
3. The chosen alignment persists across reloads.

## Constraints

- Every existing `icon-button` defaults to off and must look unchanged.
- `icon-button` declares a setter for its click handler and no getter, so reading the handler back gives nothing. Do not read it; the development log records this breaking a hotkey once.
- Do not convert the Text Entry panel's row. It is upstream and works.
- The row is not a component. One listener sets the on state on three buttons.

## Done when

- [ ] Clicking center centres the preview phrase and turns only center on.
- [ ] A grep of every `icon-button` use shows none passing the new property except this row.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Click right | Phrase right-aligned, right on |
| 2 | Reload | Still right |
| 3 | Open the editor | Its icon buttons look unchanged |

**Spec:** docs/superpowers/UI-REFACTOR.md §1.3; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
