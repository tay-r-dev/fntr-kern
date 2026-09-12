# 38: Selection: Transform rows as compact scrub fields

**Status:** ready-for-agent

**Blocked by:** 05 (Merge the Transformation and Skeleton parameters panels), 26 (Visual: SpeedPunk compact scrub fields)

## Today

Inside the merged Selection panel, the transform part holds: a nine-radio origin grid; typed origin X and Y; Move X Y; Scale X Y; Rotate; Skew X Y; Slide both tension points checkbox; Dimensions W H; Flip row; Align; Distribute; path operations; Harmonize. Each transform row's label is an icon button that applies it; its fields are plain number boxes.

## Target

1. Move, Rotate, Skew, Scale and Dimensions each show their values as compact scrub fields, with the row's icon inside the field.
2. A row still applies on its icon or on Enter.

## Constraints

- Scrubbing edits the parameter value only. It does not apply the transform on every frame.

## Done when

- [ ] Every transform applies as before with typed and scrubbed values.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Scrub Rotate to 30, press its icon | Selection turns 30 |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
