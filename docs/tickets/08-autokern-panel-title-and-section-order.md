# 08: Autokern panel: title and section order

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

The autokern column is the kerning view's right-hand column. Its sections, top to bottom, are: source select and counts; Stale and new glyphs; Analytics; Presets and phrase; thresholds with Run and a Parameters disclosure; Visual settings, built in the controller; Calibration, a disclosure.

## Target

1. A title reads Autokern at the top.
2. Order becomes: source and counts; thresholds with Run; Stale and new glyphs; presets and phrase; Visual settings; Analytics.
3. Visual settings and Analytics open by default and remember open or closed across reloads.

## Constraints

- Reorder the markup. Do not change any section's behavior or ids.

## Done when

- [ ] The view's test suite passes; the controller-wiring test still finds every id.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Load the view | Sections in the new order, both collapsibles open |
| 2 | Close Analytics, reload | Analytics still closed |

**Spec:** docs/superpowers/UI-REFACTOR.md §1.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
