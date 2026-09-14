# 47: Skeleton block: Lock, Link and Reset icon groups

**Status:** done

**Blocked by:** 46 (Skeleton block: Generation layout), 11 (Autokern panel: alignment row)

## Today

The Ribs section has three lock checkboxes (handles, slide, width), a Detached checkbox, and reset buttons: reset rib, reset handles, and reset this handle when one generated handle is selected. Point widths has Linked and Tied ribs checkboxes.

## Target

1. Under Generation, one row of labeled icon groups: Lock with three on-state icon buttons for the three lock kinds; Link with two for Linked and Tied ribs; Reset with three buttons for rib, handles and this handle.
2. Mixed selections show a lock icon in an indeterminate look.

## Constraints

- Detached has no place in the image. Keep it as a checkbox under the row and tell the designer.

## Done when

- [ ] Every lock, link and reset does what its checkbox or button did.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.5. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
