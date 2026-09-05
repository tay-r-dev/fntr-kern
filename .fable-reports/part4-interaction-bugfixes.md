# Part 4 — interaction bugfixes (right splitter, font-mode modifier-click, Derive classes)

## Tooling note (read this first)

The brief asked for the `run` skill and `claude-in-chrome` tooling. Neither exists
in this environment (checked `C:\Users\frena\.claude\skills` and the tool list
available to me — no browser-automation tool, no `run` skill). Rather than
static-guess or fake a click I didn't make, I built an equivalent, real
interaction harness from tools I do have: launched the actual Fontra Python
server (`venv/Scripts/python.exe -m fontra --http-port 8901 filesystem
_external/skeletron.fontra`, chosen per project memory's `external-folder.md`
pointer to the skeletron.fontra test project — it has a real composite glyph,
`Atilde` = `A` + `tildecomb`), built the real webpack bundle it serves
(`npx webpack --config webpack.config.cjs --mode development`, output is
gitignored `src/fontra/client/`, rebuilt after each source edit), and drove a
real headless Microsoft Edge instance via the Chrome DevTools Protocol using
only Node's built-in `fetch`/`WebSocket` (no puppeteer/playwright installed) —
dispatching real `Input.dispatchMouseEvent` sequences (mousedown → N
intermediate mousemoves → mouseup, with real modifier bitmasks) at real
`getBoundingClientRect()` coordinates, and reading back real in-page state
(`window.kerningViewController`, exposed by `views-kerning/src/start.js`, plus
`getComputedStyle`/DOM). This is real, driven interaction against the actual
running app, not code reading — every claim below has the literal
before/after values it produced.

Also note: this file was being actively worked on by a concurrent stage
(`part5-class-panel-fixes.md`, unrelated: delete-class, "1st/2nd"→"Left/Right"
labels, split-color swatches) — its edits landed in the working tree before I
started reading in earnest, which is why my line numbers moved between my
first and later reads. Confirmed via `git log` that these were already-settled
prior work, not a live collision — I re-read the exact functions immediately
before touching them and made one surgical, well-isolated edit.

## Bug 1 — right column splitter

**Root cause, confirmed by reading + `git log -p -- src-js/views-editor/src/sidebar.js`:**
`Sidebar.initResizeGutter`'s `onPointerMove` used to hardcode which CSS custom
property a drag writes to, based only on `growDirection`, ignoring
`this.identifier` entirely:

```js
if (growDirection === "left") {
  cssProperty = "--sidebar-content-width-right";
} else {
  cssProperty = "--sidebar-content-width-left";
}
```

`kerning.css`'s grid only reads `--sidebar-content-width-kerning-left` /
`--sidebar-content-width-kerning-right` (deliberately renamed to avoid
colliding with the editor's own sidebar widths). Under the old code, dragging
either kerning-view gutter wrote to the *editor's* unused `-left`/`-right`
variables instead — the grid column driving what's on screen would never move.

**This defect is already fixed in the current working tree**, in commit
`9de7c86a0` (already present before this task started): `onPointerMove` now
reads `let cssProperty = \`--sidebar-content-width-${this.identifier}\`;`
generically. I could not find any remaining asymmetry in the current
`sidebar.js`/`kerning.js`/`kerning.css` between the left and right columns
(both `Sidebar("kerning-left")`/`Sidebar("kerning-right")` instances, both
`initResizeGutter()`-attached, symmetric `data-grow-direction` values,
symmetric CSS).

**Live re-verification performed** (viewport 1440×900, real dispatched
pointer-drag on the actual `.sidebar-resize-gutter` element's rect, 20
intermediate mousemoves, cache disabled to guarantee the freshly-built bundle
was in effect):

```
BEFORE:           {"left":"420px","right":"320px"}
drag RIGHT gutter by -60px (grow-direction=left):
AFTER:            {"left":"420px","right":"380px"}
right column rect after drag: {"x":1060,...,"width":380,...}
```

Both the CSS custom property and the actual on-screen column width changed
correctly. I could not reproduce "dragging the right gutter does nothing" on
the current code under repeated tests at two viewport sizes (750×485 and
1440×900) in both directions.

**No code change made for bug 1** — the one real defect I found for this
symptom was already fixed before I started; I verified the fix rather than
re-doing it. **Leftover note (not a defect I could confirm, flagged
honestly):** I cannot explain why the *original*, pre-`9de7c86a0` bug would
have looked asymmetric (both sides' drags should have written to equally
wrong/unused properties) — most likely the reporter tested primarily on the
right column and never rigorously confirmed the left one actually tracked the
drag either, back when this defect was present. Not re-litigated further since
the current code has no defect to fix.

## Bug 2 — font mode Shift/Ctrl-click

**Root cause, confirmed by reading `glyph-cell-view.js` in full, then
live-testing the exact reported symptom:** `GlyphCellView.handleSingleClick`
(shared by font-overview.js and this view) gives Shift a Finder-style
**range-select** (`handleSingleClickShift` → `extendSelection` →
`getGlyphNamesForRange`, walking every cell between the last-clicked cell and
this one), and gives additive toggle only to `event.metaKey || event.altKey` —
`event.ctrlKey` is checked **nowhere** in that file. On a non-Mac keyboard,
Ctrl is the platform's multi-select modifier, but `metaKey` there is the
Windows key, so a Ctrl-click there just falls through to the plain-click
branch.

Live-verified against the *unmodified* code (glyph cells alphabetically:
`A,F,G,N,b,d,j,k,l,n,o,Atilde,atilde,tildecomb`; cache disabled to avoid
testing a stale bundle):

```
click A                       -> ["A"]
shift-click N                 -> ["A","F","G","N"]   (full range A..N, not {A,N})
click A, then ctrl-click on G -> ["A","F","G","N"]   (unchanged -- ctrl did nothing observable)
```

This reproduces both halves of the reported bug exactly.

**Fix (`src-js/views-kerning/src/kerning.js`, `initFontModeSection`):**
font-overview.js is told to keep reusing this exact shared class/behavior (its
own Shift range-select convention was read and left untouched — changing
`glyph-cell-view.js` itself would have silently changed font-overview.js too).
Instead, only *this view's own* `GlyphCellView` instance
(`this.fontModeGlyphCellView`) gets its `handleSingleClick` method replaced
with an own-property override — JS property lookup means this shadows the
shared prototype method for every internal caller
(`onclick`/`ondblclick`/`oncontextmenu`, all of which already call it via
`this.handleSingleClick(...)`), with zero further wiring needed. The override:
Shift, Ctrl, Cmd, or Alt all mean "toggle this glyph in the selection"
(add if absent, remove if present); no modifier means "replace the selection
with just this glyph." `difference`/`union` are imported from
`@fontra/core/set-ops.js` (the same module `glyph-cell-view.js` itself uses)
rather than reimplemented.

**Live re-verification after the fix** (fresh webpack build, browser cache
disabled):

```
click A                       -> ["A"]
shift-click N                 -> ["A","N"]
click A, then ctrl-click on G -> ["A","G"]
```

Additional checks run to confirm the fix doesn't regress anything nearby:

```
click A, shift+N, shift+b           -> ["A","N","b"]   (three-way additive)
...then shift+N again (toggle off)  -> ["A","b"]
...then plain click G (no modifier) -> ["G"]            (replace still works)
```

`font-overview.js`'s own grid was not touched — grep confirms no reference to
`GlyphCellView`'s prototype or `glyph-cell-view.js` itself in this diff; the
override lives entirely on kerning.js's one instance.

## Bug 3 — Derive classes

Read `deriveClasses`/`buildCompositeBases`/`renderDeriveProposals`/
`acceptDeriveProposal` in full per the brief. One candidate defect I
considered and ruled out by reading further: `buildCompositeBases` reads
`glyphInstance?.components?.[0]?.compo?.name`, which looks suspicious (a
`StaticGlyphController`'s raw `.instance.components` entries are plain
objects with `.name` directly) — but `StaticGlyphController.setupComponents`
(called by `instantiateController`, which `fontController.getGlyphInstance`
always goes through) wraps each raw component in a `ComponentController`
whose constructor does `this.compo = compo`, so `glyphInstance.components[0]`
**is** a `ComponentController` and `.compo.name` **is** correct. Verified live,
not just by re-reading: `window.kerningViewController.buildCompositeBases()`
returned `[["Atilde","A"]]` on skeletron.fontra — correct.

**Set up the exact scenario the brief asks for** (a composite whose base has
an existing class): skeletron.fontra ships zero classed glyphs among its
composite bases, so I assigned one live, through the real write path a
designer's own "New class" action would use —
`kerningController.editGroupSide1("A", "capRound")` — then drove the actual
`#kerning-derive-button` DOM element's `click()`.

**Result: it worked correctly, on every axis named in the brief:**

- (a) `this.autokernDeriveProposals` **did** populate:
  `[{"id":0,"tactic":"composite","side":"left","editSide":"side1","className":"capRound","members":["Atilde"]}]`.
- (b) `#kerning-derive-proposals`'s DOM **did** update: its `innerHTML` showed
  the real proposal row (`PROPOSED (composite, left): Atilde -> capRound`,
  with an Accept button).
- (c) It was **not** hidden by CSS: `getComputedStyle` on the row showed
  `display: flex; visibility: visible; opacity: 1; height: 141px` (an early
  test at the browser's tiny default 750×485 viewport, with stale
  extreme-width `localStorage` column values left over from an earlier test,
  did show a `width: 0` container — but that was the viewport/test-harness
  artifact, not the bug: repeating at a realistic 1440×900 viewport with
  `localStorage` cleared gave a normal, fully-visible `659×32` row inside the
  scrollable class panel, at `scrollTop: 0` with plenty of room before the
  container's `scrollHeight` limit).
- Clicking the real Accept button end-to-end: `kerningController.leftPairGroupMapping`
  went from `{"A":"capRound"}` to `{"A":"capRound","Atilde":"capRound"}`, and
  `autokernDeriveProposals` correctly emptied afterward.
- Clicking Derive twice in a row with **no** classed base (the font's
  original, unmodified state) correctly produced zero proposals **both**
  times, with no stale/duplicate DOM rows accumulating either time.

**No code defect found; no fix made for bug 3.** The behavior matches the
design doc's own stated contract exactly (§0: composite inheritance requires
the base to already carry a class — it is the *only* derive tactic, and it is
exact, not tolerant): before any base glyph has a class, Derive correctly
produces nothing, which is very plausibly what the reporter's "not working
until 'Add selection' is pressed" describes — "Add selection to selected
class" (design doc §2) is exactly the action that gives a base glyph its
first class, after which Derive starts producing proposals, as designed.
That's expected behavior, not a bug, once composite-inheritance's precondition
is understood — flagging this as a possible **documentation/UX gap** (the
Derive button gives no feedback distinguishing "correctly found nothing to
propose" from "broken"), not a code defect, since a UI change wasn't in this
task's scope.

## Files touched

- `src-js/views-kerning/src/kerning.js` — the only file I edited: one import
  addition (`difference`, `union` from `@fontra/core/set-ops.js`) and the
  `handleSingleClick` override inside `initFontModeSection` (bug 2's fix).

## Pass condition

```
node --input-type=module --check < src-js/views-kerning/src/kerning.js
```

Output: **none** (empty — check passed). No other `.js` file was modified by
this task, so no other file needed this check.

**Live-verification status, explicitly, per bug:**

- Bug 1: **live-verified working** on the current code (no fix needed from
  this task — root cause already fixed by a prior commit, confirmed via
  `git log -p`).
- Bug 2: **live-verified fixed** — reproduced the exact broken behavior first,
  then reproduced the exact corrected behavior after the fix, against a
  rebuilt bundle with browser caching explicitly disabled.
- Bug 3: **live-verified working, no defect found** — full Derive→Accept flow
  exercised end-to-end against real font data with a real classed composite
  base, matching every check named in the brief (proposals array, DOM
  content, and CSS visibility).

## Facts vs. inferences

- **Confirmed** (by reading + `git log`): the bug-1 defect existed and was
  already fixed in `sidebar.js` before this task started.
- **Confirmed** (by reading + live testing): the bug-2 defect (`ctrlKey` never
  checked; Shift does range-select) was real, in the shared
  `glyph-cell-view.js`, and is now overridden for this view only.
- **Confirmed** (by reading + live testing): `buildCompositeBases`'s
  `.compo.name` chain is correct, not a bug; the full derive/accept pipeline
  works correctly once a base glyph has a class.
- **Inference:** the reporter's bug-3 symptom is most likely the
  composite-inheritance precondition (no classed base yet) being
  misread as "broken," per the design doc's own stated derivation contract —
  I could not interview the reporter to confirm this is what actually
  happened, so it's stated as the most likely explanation, not a fact.

## Leftovers / recommendations (not built, out of scope for this task)

- **Tooling gap:** this environment has no `run` skill or browser-automation
  MCP tool for a fable stage-worker to use. I built a one-off CDP harness
  (Node's native `fetch`/`WebSocket` + headless Edge) to do this task's live
  verification; it was not persisted anywhere in the repo (scratch files only,
  in the session scratchpad) since it's task-specific tooling, not a repo
  artifact — worth naming as a real, recurring gap for any future task in this
  family that says "launch the app and click around."
- **UX gap (not a code defect):** Derive classes gives no feedback when it
  correctly finds zero proposals, which plausibly reads as "broken" to a
  designer who hasn't yet given any composite's base a class. A one-line
  status message ("No composite bases have a class to inherit yet") would
  close this gap; not built here since it's a UI addition beyond this task's
  three named bugs.
- Bug 1's original asymmetry (why left reportedly looked fine while right
  didn't, when the pre-fix code should have broken both identically) is
  unresolved — noted above, not re-investigated further since the current
  code has no defect to chase.
