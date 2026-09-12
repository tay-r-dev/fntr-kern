# 33: Metrics panel: Kerning heading and Go to kerning view

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

The kern group left and right fields sit in the form with no heading. The kerning view is reached from the Font menu, which reroutes the URL path to the kerning view and carries nothing. The kerning view reads its glyph field from its filters controller in local storage.

## Target

1. The kern group fields sit under a Kerning heading, with a Go to kerning view button on their row.
2. The button opens the kerning view in a new tab with the current glyph in the view's glyph field.
3. The kerning view reads a glyph from its URL on start and writes it into the glyph field and its filter, overriding the stored one.

## Constraints

- Reuse the Font menu's path reroute. Rail R-B.
- Read the URL after `start()` has initialized the font. The development log records a constructor read failing twice.

## Done when

- [ ] From the editor on glyph n, the button opens the kerning view filtered to n.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | On glyph n, press the button | Kerning view shows n's pairs |
| 2 | Open the kerning view from the Font menu | Glyph field keeps its stored value |

**Spec:** docs/superpowers/UI-REFACTOR.md §4.3. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
