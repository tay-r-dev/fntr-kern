# 06: Width presets as one list with a side

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

Each master's skeleton source defaults hold, per case, a base, a horizontal and a contrast width and a distribution (`widthCapitalBase` and siblings, `widthLowercaseBase` and siblings), plus a custom width list per case (`customWidthsUppercase`, `customWidthsLowercase`) of name and value. The skeleton panel's force-apply row offers base, horizontal, contrast and the custom widths.

## Target

1. A width preset is a name, a width, a side (left, right or both) and a case. It lives in its master's source defaults, in one list.
2. Reading old defaults turns base, horizontal and contrast into three presets with those names, side both, one per case, and turns each custom width into a preset.
3. The distribution default is dropped. A point's own distribution stays.
4. Applying a preset writes its width to its side only, or to both.

## Constraints

- Rail R-C: applying goes through `editSkeleton`.
- The width cascade survives: applying a preset writes point widths, it never rewrites the contour default.

## Done when

- [ ] A test reads a defaults block with base 60, horizontal 50, contrast 40 and one custom width, and gets four presets with those widths.
- [ ] A test applies a left-side preset and asserts the right width is untouched.
- [ ] Nothing reads or writes a distribution default.
- [ ] `cd src-js/fontra-core && npm test` passes, with new tests that fail before the change.
- [ ] `npx prettier --write` has run on every touched file.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
