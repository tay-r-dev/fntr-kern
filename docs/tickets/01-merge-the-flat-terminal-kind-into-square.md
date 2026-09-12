# 01: Merge the Flat terminal kind into Square

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

The skeleton model accepts five cap styles: butt, round, square, drop, serif. Butt is the default for a contour and for a point with no style. The panel's Cap style select labels butt as Flat. The generator emits no extra points for butt, and for square projects the end by a distance at an angle. Golden fixtures and several generator and rib tests use butt.

## Target

1. A square cap at distance zero draws exactly what butt draws today, point for point.
2. Normalization reads a stored butt as square with distance zero and angle zero.
3. Butt leaves the set of valid cap styles. The default for a contour and a point becomes square.
4. The panel's Cap style select loses Flat. Nothing else in the panel changes in this ticket.

## Constraints

- Point-count stability: a former butt cap must emit the same number of points it emits today. If square at distance zero emits more, make it emit the same, do not keep butt alive.
- Regenerate golden fixtures only where the output is identical or the point list is identical with coordinates equal to grid rounding. Any other movement is a failure.
- No migration code for old files beyond normalization. There is no production data (START-HERE).

## Done when

- [ ] A test builds one open contour with a butt cap and one with a square cap at distance zero, and asserts identical generated points.
- [ ] A test normalizes a stored butt style and reads square with distance zero.
- [ ] No source file outside tests refers to the butt style name.
- [ ] `cd src-js/fontra-core && npm test` passes, with new tests that fail before the change.
- [ ] `npx prettier --write` has run on every touched file.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Open a glyph whose terminal was Flat | It draws as before; the Cap style select reads Square |
| 2 | Set a Square cap's distance to 0 and back to 20 | The end is flat at 0 and projects at 20 |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.6. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.
