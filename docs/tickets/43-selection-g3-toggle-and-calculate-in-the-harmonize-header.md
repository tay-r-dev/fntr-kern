# 43: Selection: G3 toggle and Run in the Harmonize header

**Status:** ready-for-agent

**Blocked by:** 42 (Selection: Harmonize method as a segmented control), 14 (Pair table: switch row)

## Today

Inside the merged Selection panel, the transform part holds: a nine-radio origin grid; typed origin X and Y; Move X Y; Scale X Y; Rotate; Skew X Y; Slide both tension points checkbox; Dimensions W H; Flip row; Align; Distribute; path operations; Harmonize. G3, Equalize and Other sources are checkboxes. A Harmonize button runs the command.

## Target

1. G3 is a labeled toggle. Equalize handles and Other sources stay checkboxes.
2. The run button keeps its Run label and sits at the right of the Harmonize header.

## Done when

- [ ] All three settings and the run behave as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.4. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
