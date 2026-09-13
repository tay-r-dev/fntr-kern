# 15: Pair table: Unicode types dropdown

**Status:** done

**Blocked by:** 04 (Lift the pair table into a shared table component)

**Builds:** the multi-select dropdown. Later tickets reuse it: 16 (Pair table: Class relationship dropdown), 17 (Pair table: Glyphset dropdown), 48 (Skeleton block: Projection with its overflow), 69 (Skeleton settings: width preset filters), 72 (Skeleton settings: terminal preset filters). Build it once, where they can import it.

## Today

The pair table column holds, top to bottom: the Glyph field; a filter block with a Side select, Show hidden, Only marked pairs, a Columns fieldset of four checkboxes plus Hide zero current, a Unicode types fieldset of seven checkboxes and a note, a Class relationship fieldset of four checkboxes, a Glyphset select and Show members; the three action buttons; the two tabs; the table; a load-status line. The controller binds the seven Unicode checkboxes to its filters controller and shows the non-Unicode note from the Unicode fieldset.

## Target

1. A shared multi-select dropdown exists in `fontra-webcomponents`: a button showing a label, opening a list of labeled checks, closing on outside click or Escape, with a change event carrying the checked set.
2. A filter row under a rule holds a Unicode types dropdown with the seven types.
3. The non-Unicode note shows inside the open list.
4. The Unicode types fieldset is removed.

## Constraints

- The dropdown knows nothing about kerning. Later tickets use it for Side, Glyphset, Class relationship, preset filters and every overflow button.
- The filters controller keys do not change.

## Done when

- [ ] Each type check filters rows exactly as its checkbox did.
- [ ] Checked types survive a reload.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Open, uncheck Lowercase | Lowercase pairs leave the table |
| 2 | Press Escape | List closes |
| 3 | Reload | Lowercase still unchecked |

**Spec:** docs/superpowers/UI-REFACTOR.md §3.3; docs/superpowers/UI-NOMENCLATURE.md §14. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
