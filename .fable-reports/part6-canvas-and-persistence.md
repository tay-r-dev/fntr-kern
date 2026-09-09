# Part 6 — main-scene coordinate-space bug, row-resizable middle column, autokern cache persistence

## Tooling note

No `run` skill or browser-automation tool exists in this environment. Built the
same kind of harness prior workers used (`.fable-reports/part4-interaction-
bugfixes.md`): the real Fontra Python server (`venv/Scripts/python.exe -m
fontra --http-port 8901 filesystem _external/skeletron.fontra`), the real
webpack bundle rebuilt after each edit (`npx webpack --config webpack.config.cjs
--mode development`), and headless Microsoft Edge (`--headless=new
--remote-debugging-port=9333`, fresh `--user-data-dir` per browser-cache-
sensitive test) driven via Node's native `fetch`/`WebSocket` over raw Chrome
DevTools Protocol — real `Input.dispatchMouseEvent` sequences, real
`Runtime.evaluate` reads of `window.kerningViewController` and the live DOM,
and one real `navigator.storage.getDirectory()` OPFS read for task 3. Scratch
driver scripts live only in the session scratchpad, not the repo, per that
report's own precedent.

One environment gotcha worth naming for the next stage-worker: reusing an
Edge `--user-data-dir` across a build meant a stale disk-cached JS chunk was
served to `Runtime.evaluate` even with `Network.setCacheDisabled` set on that
tab's session — the fix was killing the browser and using a fresh profile
directory, not just re-navigating. Caught this myself via `.toString()` on
the live `localPoint` function to see literally which code was loaded, before
concluding a fix hadn't landed.

## Task 1 — main scene canvas coordinate-space mismatch

**Root cause, confirmed live, not guessed:** loaded phrase mode, typed
`HAMBURG`, computed each positioned glyph's real on-screen rect from
`canvasController.canvasPoint` + the canvas's own `getBoundingClientRect()`,
then dispatched a real click at the screen midpoint of "A" (screen x-range
560.8–628.4). Selection landed on **"G"** instead
(`sceneSettings.selectedGlyphName === "G"`), a ~408px miss — this reproduces
the reported symptom exactly ("can't properly select the objects in canvas").

Traced to `CanvasController.localPoint`/`getViewBox`
(`src-js/fontra-core/src/canvas-controller.js`), which computed a click's
local scene coordinate as `event.x - canvas.parentElement.offsetLeft -
origin.x`. `offsetLeft`/`offsetTop` are relative to the element's
**offsetParent** (the nearest ancestor with `position` other than `static`),
**not the viewport** — they are only usable as a stand-in for "on-screen
position" when there is exactly one positioned ancestor between the canvas
container and the page's own top-left corner. Live-checked the actual DOM:

```
#kerning-view-container.offsetLeft  = 0
#kerning-view-container.offsetParent = #kerning-middle-top   (itself position:relative)
#kerning-view-container.getBoundingClientRect() = {x: 420, y: 35, ...}   <- real screen position
```

`#kerning-middle-top` (an extra positioned wrapper this view's two-row middle
column introduces, which `editor.js`'s flatter canvas-container structure
does not have — `editor.js`'s own `.main-container`'s offsetParent,
`.editor-container`, happens to sit flush at the viewport origin, so its
`offsetLeft` accidentally equals its real screen position) becomes
`#kerning-view-container`'s offsetParent, so `offsetLeft` reads `0` while the
container is actually 420px from the left edge (the left column's width).
Every click was off by exactly the left column's width — which is why the
reported symptom is a genuine, structural regression tied to this view's own
three-column-grid layout, not a general canvas bug that would also show up
in `editor.js`.

**Fix (`src-js/fontra-core/src/canvas-controller.js`):** added a
`canvasRect` getter (`canvas.parentElement.getBoundingClientRect()`, the same
call `canvasWidth`/`canvasHeight` already correctly use) and switched
`localPoint`, `getViewBox`, and `setupSize`'s scroll-position-preserving
delta calculation from `offsetLeft`/`offsetTop` to this getter.
`getBoundingClientRect()` is always viewport-relative regardless of how many
positioned ancestors sit in between, so this fix is DOM-nesting-independent
— it is a general correctness fix shared by every view that uses
`CanvasController` (editor.js included), not a kerning-view-only patch, since
the class itself is the shared, reused component (rail R-A/R-B).

**Live re-verification after the fix**, same click, same coordinates:

```
Clicking at (594.6, 341.5) for glyph "A"  ->  selectedGlyphName: "A"   (was "G")
```

**Re-verified after a column-splitter resize** (the brief's own second
check): dragged the left column's gutter +150px (420px → 500px, real
`pointerdown`/`pointermove`×10/`pointerup` sequence). Canvas container moved
to `x: 500` (`getBoundingClientRect`), and a click on the middle of "B"
(recomputed post-resize screen rect) correctly selected `"B"`:

```
AFTER RESIZE: leftWidth 500px, canvas rect {x:500,...}
click on "B" -> selectedGlyphName: "B"
```

No override in v1/backlog note needed here; this is purely a coordinate-math
fix.

## Task 2 — drag-resizable divider between the middle column's two rows

**Read `sidebar.js` in full first**, per the brief, to decide (a) generalize
`Sidebar` to a vertical/row mode or (b) a narrow, view-local handler. Chose
**(b)**, for reasons found by reading, not by default caution — documented in
full in `kerning.js`'s own `initMiddleRowSplitter` comment:

- `Sidebar`'s `MIN_SIDEBAR_WIDTH`/`MAX_SIDEBAR_WIDTH` (200–500) are
  module-level constants shared by every instance; this row split needs an
  **asymmetric** pair of minimums (200px top / 140px bottom, the design
  doc's own `grid-template-rows` values) that `Sidebar` has no parameter for.
- `Sidebar.attach()`/`toggle()`/`addPanel()` are bundled with tab/shadow-box
  show-hide machinery this split neither has nor wants; `attach()` calling
  `initResizeGutter()` as a side effect of that unrelated machinery means
  "just call attach()" isn't actually available standalone.
- `Sidebar`'s own selectors (`.sidebar-container.${identifier}
  .sidebar-resize-gutter`) assume the `sidebar-container`/`sidebar-content`
  class contract the two outer kerning columns already carry (see
  `kerning.html`'s own comment on why) — the two middle rows are not
  sidebar-containers and were never going to be turned into one just for
  this.

**What is reused, deliberately:** the mechanism, not the class — one CSS
custom property (`--kerning-middle-bottom-height`, mirroring the columns'
own `--sidebar-content-width-kerning-*`), written on `pointerdown`/
`pointermove`/`pointerup`, the same `:root.<x>-resizing` cursor-lock class
convention (`:root.kerning-row-resizing`, parallel to `:root.sidebar-
resizing`), and the same `localStorage` persistence key shape
(`fontra-kerning-middle-bottom-height`, parallel to
`fontra-sidebar-width-${identifier}`).

**Structural pitfall found and fixed during this task itself, live-caught
before landing:** the gutter was first placed nested inside
`#kerning-middle-top`, straddling its bottom edge (`bottom: -2px`, mirroring
`.sidebar-resize-gutter`'s own `-2px` overlap convention). `#kerning-middle-
top` has `overflow: hidden` (needed for the canvas to actually shrink in the
grid), which silently clipped the half of the gutter sitting outside its own
box — confirmed via `document.elementFromPoint()` at the gutter's own
center, which returned `#kerning-middle-bottom`, not the gutter, meaning no
drag could ever start. Fixed by moving the gutter to be a **direct child of
`.kerning-middle`** (which has no `overflow` rule, only its row children do),
positioned via `bottom: calc(var(--kerning-middle-bottom-height) - 2px)` so
it always tracks the row boundary regardless of the current height.

**`.kerning-middle`'s CSS**, changed from the old fixed
`grid-template-rows: minmax(200px, 1fr) minmax(140px, auto)` to
`minmax(200px, 1fr) var(--kerning-middle-bottom-height)` — same
one-fixed/one-flexible convention the three-column grid already uses (outer
columns fixed via a custom property, middle `1fr`); here the bottom row is
the fixed/draggable one, the top row keeps its own 200px min via `minmax`.
The JS clamps the bottom row's height between 140px and `(total height -
200px)` on every drag frame, so the top row's own minimum can never be
violated by a drag, regardless of what height was last dragged to or
restored from storage.

**Live re-verification (drag):**

```
BEFORE:  top height 630px, bottom height 140px, --kerning-middle-bottom-height: 140px
dragged gutter UP by 100px (real pointerdown/10×pointermove/pointerup)
AFTER:   top height 530px, bottom height 240px, --kerning-middle-bottom-height: 240px
         canvas pixel buffer also resized to match (530px), localStorage: "240"
```

**Live re-verification (persistence across reload):** a fresh real
navigation (`Page.navigate`) to the same page in the same profile came back
with `#kerning-middle-bottom`'s height already `240px` (read back from
`localStorage`), confirming the stored height survives exactly the way the
outer columns' widths already do.

## Task 3 — autokern cache persistence across reload

Read `autokern-cache.js` in full (pure data-transform module — `pairKey`,
`setPairValue`, `markPairJunk`, `markGlyphStale`, `pairsForRerun`,
`candidatePairs`; no OPFS code lives here) and `kerning.js`'s own
`readAutokernCacheFromOPFS`/`writeAutokernCacheToOPFS` (module-level
functions) plus `loadAutokernCacheFromStorage`/`writeAutokernCacheToStorage`
(instance methods) in full. The read/write path: one JSON file per
`(projectIdentifier, source)` under OPFS directory `kerning-autokern-cache`,
written as a plain array of cache entries (`[...cache.values()]`) and read
back into a fresh `Map` keyed by `pairKey(left, right)`, with the project's
own junk marks overlaid afterward (`applyStoredJunkMarksToCache`). The write
is `await`ed inside the worker's `"done"` handler, before the run's own
promise resolves.

**Live-tested, not just read:** ran a **real** autokern pass end-to-end
against skeletron.fontra by dispatching a real `click()` on
`#kerning-run-button`, polling `this.autokernCache.size` until the run
completed.

```
BEFORE RUN:  cacheSize 0, source "1fdd732e"
RUN RESULT:  cacheSize 163  (worker completed, dialog closed)
```

**Confirmed the OPFS write actually happened**, not just that the run call
didn't throw, via `navigator.storage.getDirectory()` evaluated in-page:

```
OPFS file: kerning-autokern-cache/skeletron.fontra--1fdd732e.json
length: 12408 bytes
first entries: [{"left":"A","right":"A","value":58.064...},
                {"left":"A","right":"Atilde","value":58.0647...}, ...]
```

**Then did a real reload** — a brand-new browser tab (`newTab` + a fresh
`Page.navigate`, not re-running JS in the same page) to the same URL in the
same profile — and read `this.autokernCache` back:

```
IMMEDIATELY AFTER NAV: cacheSize 163
AFTER RELOAD (5 sample entries, byte-for-byte identical to the pre-reload run):
  A/A       = 58.06426925038813
  A/Atilde  = 58.06477860360386
  A/F       = 2.461866996550792
  A/G       = 0
  A/N       = 0.6671656194733342
```

**Pass: the cache persists correctly across a real reload.** All 163
entries and their exact values survived. No bug found; no fix needed for
task 3.

## Files touched

- `src-js/fontra-core/src/canvas-controller.js` — task 1's fix
  (`canvasRect` getter; `localPoint`/`getViewBox`/`setupSize` switched from
  `offsetLeft`/`offsetTop` to it).
- `src-js/views-kerning/src/kerning.js` — task 2's `initMiddleRowSplitter`,
  called from `initColumnSplitters`.
- `src-js/views-kerning/kerning.html` — task 2's gutter element
  (`#kerning-middle-resize-gutter`, direct child of `.kerning-middle`).
- `src-js/views-kerning/assets/kerning.css` — task 2's
  `--kerning-middle-bottom-height` custom property, `.kerning-middle`'s
  `grid-template-rows`, the gutter's own positioning rule, and
  `:root.kerning-row-resizing`.

## Pass condition

```
node --input-type=module --check < src-js/views-kerning/src/kerning.js
node --input-type=module --check < src-js/fontra-core/src/canvas-controller.js
```

Output for both: **none** (empty — both checks passed).

**Live-verification status, explicitly, per task:**

- Task 1: **live-verified fixed** — reproduced the exact broken click-to-glyph
  mismatch first (click on "A" selected "G"), traced it to the exact DOM
  property (`offsetLeft` reading 0 against a real 420px on-screen offset),
  fixed it, then reproduced the corrected behavior (click on "A" selects
  "A") both at the default layout and after a real column-splitter drag.
- Task 2: **live-verified working** — a real pointer-drag on the new gutter
  resized both rows and the canvas's own pixel buffer, persisted the new
  height to `localStorage`, and that height survived a real page reload. One
  real structural defect (the gutter being clipped by `overflow: hidden` when
  nested inside `#kerning-middle-top`) was found and fixed during this same
  task, before final verification, via `document.elementFromPoint`.
- Task 3: **live-verified working, no defect found** — a real autokern run's
  163-entry cache was confirmed written to OPFS by reading the file directly
  from `navigator.storage.getDirectory()`, then confirmed to survive a real
  new-tab navigation with every checked value identical.

## Facts vs. inferences

- **Confirmed** (live click-and-read): task 1's coordinate mismatch was real,
  reproduced before the fix and gone after it, at two different column
  widths.
- **Confirmed** (reading `sidebar.js` in full + the constraints listed
  above): generalizing `Sidebar` to a vertical mode would need new, unused-
  by-`views-editor` parameters (asymmetric min/max, no tab machinery) and was
  judged higher-risk than a narrow, mechanism-reusing handler — a judgement
  call, stated with its reasoning, not asserted as the only correct choice.
- **Confirmed** (live drag + `elementFromPoint`): the first gutter placement
  was actually broken by `overflow: hidden` clipping, not a hypothetical
  risk — caught and fixed before claiming task 2 done.
- **Confirmed** (live OPFS read + a real new-tab reload): the autokern cache
  persistence path has no defect; task 3's brief's own "pass/fail with actual
  before/after data" is satisfied with real, byte-identical values.

## Leftovers / recommendations (not built, out of scope for this task)

- `CanvasController`'s fix (task 1) is a general correctness fix in a file
  shared by every view (`editor.js` included). It was not observed to change
  `editor.js`'s own behavior in this session (not explicitly re-tested there,
  since `editor.js`'s canvas is out of this task's scope and was stated as
  "known-working, reused unchanged") — worth a quick sanity click-test in
  `editor.js` itself if a future stage-worker touches that view, purely as a
  belt-and-suspenders check, since the fix should be a strict improvement
  (viewport-relative math is correct regardless of nesting depth) but wasn't
  independently re-verified against `editor.js`'s own live behavior here.
- Task 2's gutter uses a fixed 4px hit target, same as the existing column
  gutters' 4px width — no accessibility/keyboard-resize affordance was added
  (parallel gap already exists for the column splitters, not introduced by
  this task).
