# 41: Selection: Smart scale toggles

**Status:** needs-info

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels), 14 (Pair table: switch row)

## Today

Inside the merged Selection panel, the transform part holds: a nine-radio origin grid; typed origin X and Y; Move X Y; Scale X Y; Rotate; Skew X Y; Slide both tension points checkbox; Dimensions W H; Flip row; Align; Distribute; path operations; Harmonize. Slide both tension points is a checkbox bound to application setting `slideBothTensionPoints`. No setting named preserve aspect ratio exists. The tension-aware scale runs while X is held.

## Target

1. A Smart scale heading with two labeled toggles: preserve aspect ratio, and slide adjacent tension points bound to `slideBothTensionPoints`.

## Constraints

- Preserve aspect ratio has no setting and no defined effect. Ask the designer what it changes in the tension-aware scale before building it. The development log section on tension-aware drag and scale is the reference.

## Done when

- [ ] Slide adjacent tension points behaves as the checkbox did.
- [ ] Preserve aspect ratio does what the designer defined.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

**Spec:** docs/superpowers/UI-REFACTOR.md §5.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
