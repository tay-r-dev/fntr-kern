# Kerning view layout overhaul — Part 3: Font mode (design doc §2)

## Artifacts touched

- `src-js/views-kerning/kerning.html` — chip selector gets a `data-chip="font"`
  button; a new `#kerning-font-grid-container` div added inside
  `#kerning-view-container`, hidden by default.
- `src-js/views-kerning/assets/kerning.css` — visibility rule for the grid
  container, its `glyph-cell-view` host box, and a small rule for the new
  `#kerning-font-mode-actions` block.
- `src-js/views-kerning/src/kerning.js` — new imports (`GlyphCellView`,
  `GlyphOrganizer`, `glyphMapToItemList`, `markGlyphStale`, `MenuItemDivider`/
  `showMenu`); `setChipMode`/`initChipSection` extended with a `font` branch;
  a new `showFontModeGrid` toggle; and a new block (`initFontModeSection`,
  `initFontModeAddToClassActions`, `updateFontModeAddToClassButton`,
  `addFontModeSelectionToClass`, `handleFontModeContextMenu`,
  `showFontModeAddToDialog`), wrapped in
  `// ---- Font mode add-to-class actions (design doc §2) ----`.

## What was built, by scope item

### A. Third chip mode

`kerning.html`'s `#kerning-chip-selector` gained `<button data-chip="font">`
(starts enabled, unlike `pair` which starts `disabled` until a row is
clicked). `initChipSection`'s existing generic `[data-chip]` click-wiring
loop needed no change — it already dispatches by `dataset.chip` to
`setChipMode`. `setChipMode` gained a `font` branch that calls a new
`showFontModeGrid(show)`, which toggles `.kerning-font-grid-hidden` on
`#kerning-font-grid-container` and toggles `visibility` on `#edit-canvas`/
`#metric-handle-container` (not `display`, so the canvas's own size/state is
untouched — just not painted). The tool switcher and chip selector stay
visible/overlaid in every mode, unchanged; nothing in the design doc or task
brief asked for them to be disabled in font mode, so leaving them alone was a
deliberate non-decision, not an oversight (noted below as a leftover others
may want to revisit).

### Reuse path for the grid (rail R-A)

Chosen: **composition of `GlyphCellView` + `GlyphOrganizer`**, the same two
pieces `font-overview.js` itself composes to build its own grid — not
importing/instantiating `FontOverviewController` (that class is a whole view:
menu bar, its own undo stack, copy/paste/build/paste-replace dialogs, window-
location persistence — none of which this scope wants or could cleanly
suppress), and not writing a second grid implementation.

Confirmed before choosing this: both packages already export broadly enough
that no exports-map widening was needed (unlike part 1's `sidebar.js`, which
lived behind a narrow `views-editor` exports map and had to be added to it).
`fontra-webcomponents/package.json` exports `"./*": "./src/*"`, so
`@fontra/web-components/glyph-cell-view.js` already resolves.
`fontra-core/package.json` exports `"./*": "./src/*"` too, so
`@fontra/core/glyph-organizer.js` already resolves. Verified by reading both
`package.json` files directly.

`initFontModeSection` (called from `start()`, not the constructor, because it
reads `this.fontController.glyphMap` — font data not yet available before
`super.start()` per this file's own existing constructor-vs-start() rule,
documented at length on `start()` itself) builds:
- a small `ObservableController` carrying exactly the three keys
  `GlyphCellView`'s constructor reads by default
  (`glyphSelection`/`closedGlyphSections`/`fontLocationSourceMapped`) — traced
  by reading `glyph-cell-view.js` in full, not guessed;
- one `GlyphCellView` instance, mounted into `#kerning-font-grid-container`;
- one `GlyphOrganizer`, used with its defaults (no search string, no group-by
  keys) — this gives one flat, alphabetically sorted section, i.e. "a
  glyph grid that supports multi-select" reduced to its multi-select-relevant
  core. No search/group-by UI was built (not named in this task's scope; see
  Leftovers).
- a `glyphMap`-keyed `addChangeListener` that rebuilds the grid's sections on
  any font glyph-map change, the same listener shape `fontoverview.js` itself
  registers for the same reason.

Multi-select itself needed zero new code: `GlyphCellView`'s own pointer/
keyboard selection machinery (`glyphSelection`, a `Set`, backed by the
settings controller) is used completely unmodified, read via
`this.fontModeGlyphCellView.glyphSelection`.

### B. Add-to-class actions

**Button.** `initFontModeAddToClassActions` queries
`#autokern-class-panel-slot` and **appends** a new child (`#kerning-font-mode-
actions`, containing the button) — it never reads or replaces whatever the
class-panel worker has put there, so append order relative to their own
insertion is irrelevant and cannot collide. Wrapped in the
`// ---- Font mode add-to-class actions (design doc §2) ----` comment block
as instructed, placed as a new block rather than editing the class panel
worker's own delimited block or the code around it. Disabled by default;
`updateFontModeAddToClassButton` re-enables it only when both
`this.fontModeGlyphCellView.glyphSelection.size` and `this.selectedClass?.name`
are truthy. Wired to react to grid-selection changes (a real
`addKeyListener("glyphSelection", ...)`); it also gets recomputed as a matter
of course whenever anything else re-renders, since there is no change event
to listen for on the class-panel side yet (see the assumption below) — see
the concern under "Risks."

**Context menu.** `this.fontModeGlyphCellView.oncontextmenu` is set to
`handleFontModeContextMenu`, following the **exact convention already in this
codebase**: `font-overview.js` itself sets `this.glyphCellView.oncontextmenu
= (event) => this.handleContextMenu(event)`, relying on the native
`contextmenu` event bubbling up from a right-clicked cell (glyph-cell-view.js's
own per-cell `oncontextmenu` handler never calls `preventDefault`/
`stopPropagation`, so the event reaches the view element). Grepped
`views-kerning`/`views-editor` for any other "context menu" convention first
(none found besides this one) before adopting it — no new menu-wiring
mechanism invented. The menu itself uses `showMenu`/`MenuItemDivider` from
`@fontra/web-components/menu-panel.js` (already imported by
`fontoverview.js`, confirmed by reading that file), with two plain
`{title, callback, enabled}` items (verified this shape against
`menu-panel.js`'s own `getMenuElement`, which reads exactly those three
fields when `actionIdentifier` is absent): "Add to selected class" (disabled
when no class is selected) and "Add to…".

**"Add to…" dialog.** At the time this was written, the class panel's own
"new class" function was not visible in `kerning.js` (grepped for
`selectedClass`/`Class panel (design doc §1.2)`/`initClassPanel` — none
present yet), so this is a **minimal inline equivalent**, explicitly flagged
here as a likely duplicate to reconcile once the class panel lands: a side
picker (`side1`/`side2`/`both`, mirroring §1.2's New-class convenience of
writing two independent single-side classes under one action) plus a class-
name text input backed by a `<datalist>` of the font's existing class names
(read from `this.kerningController.kernData.groupsSide1`/`groupsSide2`
directly, since that data structure was already traced for other reasons
below). Picking an existing name or typing a new one both flow through the
same `addFontModeSelectionToClass` write path.

**Write mechanism.** Both the button and both menu actions call
`addFontModeSelectionToClass(targetClass)`, which loops the grid's selected
glyph names through `kerningController.editGroupSide1`/`editGroupSide2` —
confirmed by reading `kerning-controller.js`'s `_editGroup` in full: passing
a `groupName` adds the glyph to that group (creating it if it doesn't exist)
and removes it from any other group on that side first. This is the same
call `acceptDeriveProposal` (existing code, `initPairTableSection`'s derive-
accept path) already uses per member glyph — no second write mechanism
invented. Unlike `acceptDeriveProposal`, this does **not** implement its
all-or-nothing rollback: a partial success (some glyphs added, one glyph's
write failed) is a normal, reportable outcome for "add this selection to an
existing class," not a single derived-proposal decision that needs
atomicity — a deliberate, smaller-scope choice, stated in the code comment.

### D. Rerun scoping

After each successful `editGroupSide1`/`editGroupSide2` call,
`addFontModeSelectionToClass` calls `markGlyphStale(this.autokernCache,
glyphName)` (imported from `autokern-cache.js`, already imported in this file
for `markPairJunk`/`pairKey`) — a pure function, confirmed by reading its
full implementation and its own test file, that flags every cache row
touching that glyph as `stale`, which is exactly the "marked-only rerun mode"
condition `pairsForRerun(cache, "marked", ...)` reads. **Confirmed, not
inferred:** grepped the entire `src-js` tree for `markGlyphStale` before
calling it — the only existing call sites are its own tests
(`test-autokern-cache.js`); there is **no existing call site anywhere in
`kerning.js` today that marks a glyph stale on an outline edit** (grepped for
`glyphChanged`/`addChangeListener`/`externalChange` in `kerning.js`: none).
The task brief's framing ("the same per-glyph marking mechanism... likely
near outline-edit-triggered marking") assumes that wiring already exists; it
does not. This is stated as a confirmed fact, not a guess, and is flagged
under "Concerns" below rather than silently treated as present. What this
change does is call the underlying mechanism directly — the same way
`togglePairJunk` (existing code) calls `markPairJunk` directly — so a newly-
classed glyph's cache rows are marked stale exactly the way `pairsForRerun`'s
"marked" mode expects, even though nothing in this codebase yet marks a
glyph stale for an outline edit either. After marking, `renderPairTable()`
and `writeAutokernCacheToStorage()` are called, mirroring `togglePairJunk`'s
own persist-then-rerender pattern exactly.

## Assumption stated per the task brief: `this.selectedClass`

Before writing any of this, ran `grep -n selectedClass
src-js/views-kerning/src/kerning.js` — no matches, confirming the class panel
had not landed at the time this workstream started (and it still had not by
the time this report was written — checked again just now, same result: no
`selectedClass`, no `Class panel (design doc §1.2)` block, no
`initClassPanel`). Per the task brief's explicit instruction, every read is
written as `this.selectedClass?.side` / `this.selectedClass?.name`, treated
as a state field the class panel provides, shaped `{side, name}` with `side`
one of `"side1"`/`"side2"` (chosen to match `editGroupSide1`/`editGroupSide2`'s
own naming exactly, so no side-name translation is needed at the call site).

**Mismatch risk, named plainly:** if the class panel worker's landed field is
named differently (e.g. `this.classPanel.selectedClass`, or a different key
than `side`/`name`, or `side` values like `1`/`2` or `"left"`/`"right"`),
every reference is confined to three places: `updateFontModeAddToClassButton`,
`addFontModeSelectionToClass`'s default parameter, and
`handleFontModeContextMenu`'s first menu item's `enabled` callback — a
small, localized find-and-fix, not a rewrite. This is stated as the
orchestrator's item to verify once both parts have landed, per the brief.

## Confirmed facts vs. inferences

**Confirmed** (read directly, in full or in the relevant part, before
writing any code): the design doc's §2 and the font-mode-relevant slice of
§3; `part1-panes.md`'s report in full; `views-fontoverview/src/fontoverview.js`
in full (1244 lines); `fontra-webcomponents/src/glyph-cell-view.js`'s
constructor, `getContentElement`, `setGlyphSections`, `_updateAccordionItem`,
`getSelectedGlyphInfo`, `glyphSelection` getter/setter, and the per-cell
`oncontextmenu` wiring (~lines 1–430); `fontra-core/src/glyph-organizer.js`
in full (178 lines); `fontra-webcomponents/src/menu-panel.js`'s `showMenu`,
`MenuItemDivider`, and `getMenuElement`'s item-shape handling; the CURRENT
`kerning.js` (re-read after the concurrent worker's edit landed — see below),
`kerning.html`, and `kerning.css` as written at the time of this edit;
`kerning-controller.js`'s `editGroupSide1`/`editGroupSide2`/`_editGroup`/
`kernData` in full; `autokern-cache.js`'s `markGlyphStale`/`pairsForRerun` in
full, plus a grep confirming no other call site of `markGlyphStale` exists
yet; both packages' `package.json` exports maps (no widening needed).

**Inferences** (stated as such in the code comments too): the exact shape and
naming of `this.selectedClass` (per the brief's own instruction to assume
it); that a flat, unsorted-by-search grid (no search/group-by controls) is
an acceptable reading of "a font-overview-style glyph grid that supports
multi-select" for this scope; that leaving the tool switcher visible-but-
inert during font mode is acceptable rather than disabling it.

## Concerns (2 — below the 3-item threshold, surfaced anyway since one is
material)

1. **Confirmed, pre-existing-but-newly-surfaced bug, not mine to fix:** while
   working, `kerning.html` changed on disk (the concurrent class-panel
   worker relocated the Derive button/tolerance field out of
   `#kerning-pairtable-class-controls` into the class panel, per that
   section's own new comment: "The Derive button, its tolerance field and
   the proposals list moved to the class panel"). `kerning.js`'s existing
   `deriveClasses()` (line ~1689, untouched by this workstream — outside its
   scope) still does
   `document.querySelector("#kerning-derive-tolerance").value`, and that
   element no longer exists in the DOM. Calling Derive today would throw
   (`Cannot read properties of null`). Verified directly: re-read
   `kerning.html` after the concurrent edit and grepped `kerning.js` for
   `kerning-derive-tolerance` — exactly one reference, in `deriveClasses`,
   dead. Not fixed here (out of this workstream's scope: the pair table's
   own derive wiring, §1.1/§5.3, not §2) — flagged for the orchestrator to
   route to whichever worker owns the Derive button's new home now.
2. **No search/filter UI in font mode's grid** (see "Inferences" above) —
   a real, usable multi-select grid exists, but a font with many hundreds of
   glyphs has no way to narrow it down before selecting, unlike
   font-overview's own grid. Not built because it was not named in this
   task's scope (§2 only asks for "a font-overview-style glyph grid that
   supports multi-select"); a one-line addition
   (`this.fontModeGlyphOrganizer.setSearchString(...)` plus a text input) if
   wanted later.

## Verification

**Pass condition:** `node --input-type=module --check < src-js/views-kerning/src/kerning.js`
produces no output.

Ran, against the file exactly as it exists now (the class-panel worker's own
edits to `kerning.js` had **not** landed as of this run — confirmed by the
`selectedClass` grep above returning no matches at time of writing):

```
node --input-type=module --check < src-js/views-kerning/src/kerning.js
```

Output: none (clean exit).

Additional sanity checks (not the named pass condition): `kerning.html`'s
`<div>`/`</div>` counts match (35/35, checked after this workstream's own
edits, including the class-panel worker's already-landed HTML change);
`kerning.css`'s `{`/`}` counts match (53/53).

**Not run:** the webpack build (bundle-watch already running in the
background per the task's instruction not to run build commands). If
bundle-watch surfaces a resolution error after this session (e.g. around
`@fontra/web-components/glyph-cell-view.js` or `@fontra/core/glyph-organizer.js`),
that would be the next thing to check — both are plain-JS syntax-checked
above, but webpack's own module resolution was not exercised.

## Leftovers / recommendations (not built, out of scope)

- Search/group-by controls for the font-mode grid (see Concern 2).
- Disabling the tool switcher (pointer/sidebearing/kerning/hand) while font
  mode is active — currently left visible and clickable but inert, since
  nothing named this as in-scope.
- The "Add to…" dialog's create-new-class path is a minimal inline
  duplicate of whatever the class panel worker's own new-class control will
  end up being (§1.2) — reconcile once both land, per the note above.
- Item 1 under "Concerns": the dead `#kerning-derive-tolerance` reference in
  `deriveClasses()`, introduced by the concurrent class-panel worker's HTML
  relocation, not by this workstream.
