# 07: Terminal presets cover the four kinds with fields

**Status:** done

**Blocked by:** None (can start immediately)

## Today

Each master's source defaults hold `customSerifs`, a list of serif presets, one wing plus the underside cup, read through `SERIF_PRESET_FIELDS`. Five built-ins ship in `SERIF_PRESETS`. A preset carries no axis. No other terminal kind has presets.

## Target

1. A terminal preset is a type (square, round, drop or serif; flat has no fields and no presets), a name, a case and that type's shape fields.
2. Existing serif presets and the five built-ins read as type serif, unchanged.
3. Square, round and drop presets store their own shape fields and apply to a point of that kind.
4. Applying a preset of one type to a point of another type changes the point's kind to the preset's.

## Constraints

- A preset shapes a terminal and never places it. Serif presets carry no axis mode, axis angle or tilt. Square presets carry no rib angle lock and no lock mode. Write this rule into the feature model §8 beside the serif one.
- Rail R-C: applying goes through `editSkeleton`.

## Done when

- [ ] Every existing serif preset test passes unchanged.
- [ ] A test stores and applies one preset of each of the other three types.
- [ ] A test asserts a square preset never writes a rib angle lock.
- [ ] `cd src-js/fontra-core && npm test` passes, with new tests that fail before the change.
- [ ] `npx prettier --write` has run on every touched file.

**Spec:** docs/superpowers/UI-REFACTOR.md §6.4; FEATURE-MODEL.md §8. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
