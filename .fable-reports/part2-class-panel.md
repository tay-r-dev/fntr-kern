# Kerning view layout overhaul — Part 2: Class panel (design doc §1.2)

## Artifacts touched

- `src-js/views-kerning/kerning.html` — `#autokern-class-panel-slot` populated
  with the class panel's static structure; the Derive button/tolerance
  field/proposals list removed from `#kerning-pairtable-class-controls` and
  the button+proposals-list (same element ids) relocated into the slot; the
  tolerance field deleted outright (design doc §0).
- `src-js/views-kerning/assets/kerning.css` — styling for the new class-panel
  elements; the orphaned `#kerning-derive-tolerance` rule removed.
- `src-js/views-kerning/src/kerning.js` — `deriveClasses()` trimmed to
  composite-inheritance-only (tactic 2 and its tolerance read removed);
  `buildGlyphScriptCategoryMaps` (only used by tactic 2) removed, along with
  its now-unused imports (`deriveKernRowClusters`, `getGlyphInfoFromCodePoint`,
  `getGlyphInfoFromGlyphName`, `scriptOfCodePoint`); one new import
  (`GlyphCell`); a new `AUTOKERN_CLASS_COLORS_CUSTOM_DATA_KEY` constant; a
  small rerun-scoping addition inside the existing `acceptDeriveProposal`
  (marks accepted/still-classed glyphs stale); a call to
  `this.initClassPanelSection()` added to `start()`; and one new, clearly
  delimited block (`// ---- Class panel (design doc §1.2) ----`) holding
  every method built for this workstream.

**Note on concurrency:** a font-mode worker was editing the same three files
at the same time. Both `kerning.html` and `kerning.js` had already changed on
disk mid-task (font mode's chip button/grid, and — critically —
`this.selectedClass`-consuming code, `initFontModeAddToClassActions`,
`addFontModeSelectionToClass`, `showFontModeAddToDialog`, already landed
before I wrote my own class-list code). I re-read both files fresh after
noticing the disk-modified warning and read the font-mode worker's own block
in full before writing mine, specifically to match `this.selectedClass`'s
shape exactly rather than guess at it. No merge conflict occurred; my edits
and theirs turned out non-overlapping (theirs is a `// ---- Font mode
add-to-class actions (design doc §2) ----` block appended after mine, both
only *appending* children into `#autokern-class-panel-slot` at runtime, never
touching each other's markup or methods).

## What was built, by scope item

### A. New class control

Three buttons (`#autokern-class-new-side1`/`-side2`/`-both`), each opening
`createNewClassViaDialog(sides)`. The data model has no way to record a class
with zero members (a class exists only as glyphs' own membership —
`kerning-controller.js`'s `editGroupSide1`/`editGroupSide2` are the only
write path, and there is no separate class-name registry), so — an inference,
not stated verbatim in the design doc — the dialog
(`promptClassNameAndMembers`) asks for a class name **and** at least one
starting member (comma/space separated, reusing `parseExcludedGlyphNames`,
the same parser the excluded-glyph field already uses). "Both" performs two
independent `addGlyphsToClass` calls (side1 then side2), matching the design
doc's "two independent classes, one per side's group dictionary, with the
same name and the same starting membership."

### B. Derive control

Relocated, not rewritten: `#kerning-derive-button` and `#kerning-derive-proposals`
moved (same element ids) from the pair-table section into the class panel's
static HTML, so `initPairTableSection`'s existing click-wiring and
`renderDeriveProposals`'s existing `querySelector` calls needed no change —
only their DOM location moved. Per design doc §0: kern-row clustering
(`deriveKernRowClusters`) call site removed from `deriveClasses()`, along with
the tolerance field/control and `buildGlyphScriptCategoryMaps` (which existed
solely to feed that tactic's script/category merge guard). Composite
inheritance is now the only tactic; `deriveClasses()` itself, and proposal
rendering/accept (`renderDeriveProposals`/`buildDeriveProposalElement`/
`acceptDeriveProposal`), are otherwise unchanged — proposals still render
marked "PROPOSED" until individually accepted. `autokern-classes.js` itself
was not touched; `deriveKernRowClusters` and `classSpread`/`inheritCompositeClasses`
remain exported and unmodified there, only the import/call site in
`kerning.js` is gone.

### C. Class list

`getAllClassPanelEntries()` reads `kerningController.kernData.groupsSide1`/
`groupsSide2` directly and returns one flat, sorted array of
`{side, name, members}`. `renderClassList()`/`buildClassListRowElement`
render each as a row: a "1st"/"2nd" badge, a color swatch button, the class
name, and `truncateGlyphList(entry.members)` — the exact same truncation
function `buildClassClassRowElement`/derive-proposal rendering already use
(`GLYPH_LIST_TRUNCATE_AT = 6`), not a new convention. Clicking a row calls
`selectClass(side, name)`.

### D. Glyph-swatch strip

`renderClassSwatchStrip()` reads the selected class's membership and calls
`renderGlyphSwatches(container, glyphNames)`, which builds one
`GlyphCell` custom element per glyph (`@fontra/web-components/glyph-cell.js`
— the same tile component `GlyphCellView`/font-overview's own grid wraps for
full accordion+selection UI). I used bare `GlyphCell` instances directly
rather than a second `GlyphCellView`, since this strip is a plain,
non-selectable read of one class's membership, not a selectable grid — the
right level of reuse for what's needed. Each `GlyphCell` is built with a
fixed, shared `ObservableController({ location: {} })`
(`this._classPanelLocationController`), built once in `initClassPanelSection`,
since this view has no per-glyph location concept — every swatch renders at
the font's default (non-variable) instance. `renderGlyphSwatches` is shared
between this strip and the "Show class" dialog's live preview (F) — one tile
builder, not two.

### E. Class color

Customdata key: **`fontra.autokernClassColors`**, shaped exactly as the
design doc states: `{ side1: { <className>: <color> }, side2: { ... } }`.
`getClassColor(side, name)` reads `fontController.customData[KEY]?.[side]?.[name]`.
`setClassColor(side, name, color)` writes through
`fontController.performEdit("kerning view: set class color", "customData", (root) => {...}, this)`
— the identical pattern `writeJunkMarksToProject` uses (read directly before
writing this), preserving every other stored color by shallow-copying both
side objects before mutating the one entry. Each class-list row's color
swatch is a `<button>` (so it can double as the picker affordance) whose
click opens a hidden native `<input type="color">`; `change` on that input
calls `setClassColor`. Display-only, per design doc §3: the color is read
nowhere except this row's own swatch background — not on canvas, not in the
font-mode grid (I did not touch the font-mode grid at all).

### F. "Show class" context menu

`initClassPanelSection` registers the **first** `contextmenu` listener on
this view's own scene canvas (`this.canvasController.canvas`) — grepped the
whole file first; the font-mode worker's `showMenu` usage is on a *different*
element (`this.fontModeGlyphCellView`, the grid), so this does not collide.
Mirrors `editor.js`'s own convention exactly:
`canvas.addEventListener("contextmenu", (event) => ...)` →
`showMenu(items, {x: x+1, y: y-1})`, using the already-imported
`showMenu`/`MenuItemDivider` from `@fontra/web-components/menu-panel.js`
(imported by the font-mode worker's concurrent edit — I reused it rather
than re-importing). `classPanelContextMenuHandler` resolves the glyph under
the cursor via `sceneController.localPoint(event)` +
`sceneModel.glyphAtPoint(point)` (same mechanism `edit-tools-select.js`'s
pointer tool already uses), then offers one menu item, "Show class."

`openShowClassDialog(sourceGlyphName)` reads the glyph's side-1/side-2 class
names off `leftPairGroupMapping`/`rightPairGroupMapping`; if neither exists,
shows a message and stops. Otherwise opens a dialog with one text input
(target glyphs, comma/space separated, same style/parser as the
excluded-glyph field) and a live swatch preview below it (via
`renderGlyphSwatches`) that updates on every keystroke. On OK,
`showClassPreviewInScene` builds one `"/member /target"` (side-1 class) or
`"/target /member"` (side-2 class) line per (class member × target glyph)
pair and sets it directly as the scene text via
`sceneSettingsController.setItem("text", ...)` — bypassing the phrase/pair
chip machinery entirely, the same way `selectPairForScene` already bypasses
the phrase textarea for its own two-glyph preview. This is a third, temporary
scene text, not a new chip mode; switching to "phrase" or "pair" afterward
replaces it exactly as `setChipMode`'s existing restore logic always did.

### G. Rerun scoping

`markGlyphsStaleForClassEdit(glyphNames)` calls `autokern-cache.js`'s
`markGlyphStale` (pure, unmodified) per glyph and persists the cache
(`writeAutokernCacheToStorage`). **Confirmed, not assumed:** grepped the
whole tree before writing this — `markGlyphStale` has no existing call site
tied to an outline-edit change listener anywhere in this codebase (the font
mode worker's own report independently confirms the same finding). So this
calls the underlying mechanism directly, the same way `togglePairJunk`
already calls `markPairJunk` directly for the same kind of per-pair mark —
there is no separate "outline-edit marking function" to route through
instead. Wired at both required points:
- `addGlyphsToClass` (called by "New class", item A) marks every glyph it
  writes.
- `acceptDeriveProposal` (existing method, one delimited addition each in its
  full-success and partial-failure-with-still-classed-glyphs branches) marks
  every glyph that ended up actually classed, since a derive-accept is a
  class-membership change exactly like any other.
- The font-mode worker's own `addFontModeSelectionToClass` independently
  calls `markGlyphStale` itself (confirmed by reading their code) rather than
  calling my `markGlyphsStaleForClassEdit` — both reach the same underlying
  mechanism, so behavior is correct either way, but it is a small,
  easy-to-notice duplication if someone wants to consolidate later.

Explicitly **not built**: a narrower "classes-only" rerun-scope button — the
design doc leaves this as an unresolved implementation detail, and the task
said to skip it.

## Public surface for the font-mode worker (and anyone else)

- **`this.selectedClass`**: `{ side: "side1" | "side2", name: string } | null`.
  Set by `selectClass(side, name)` (called from a class-list row click).
  Confirmed to match exactly what the font-mode worker's own
  `addFontModeSelectionToClass`/`updateFontModeAddToClassButton` already read
  (I read their landed code before finalizing this shape) — no
  reconciliation needed on this point.
- **`addGlyphsToClass(side, className, glyphNames)`** (async): the one write
  path for joining glyphs to a class through this view. `side` is
  `"side1"`/`"side2"` (matching `kernData`'s own property names and
  `editGroupSide1`/`editGroupSide2`'s naming, not `"left"`/`"right"`). Writes
  each glyph through `kerningController.editGroupSide1`/`editGroupSide2`,
  marks every glyph stale (G), and refreshes the class list, swatch strip
  (if the edited class is currently selected), and pair table. This is the
  method the font-mode worker's own `showFontModeAddToDialog` — which
  currently duplicates the "pick side(s) + name, write two independent
  classes for 'both'" logic inline (their own comment flags this as a likely
  duplicate) — should call instead of its direct `editGroupSide1`/
  `editGroupSide2` loop, once reconciled. I did not make that edit myself,
  since it falls inside the font-mode worker's own delimited block and
  editing it would risk exactly the collision both workstreams were asked to
  avoid.
- **`renderClassList()`** / **`renderClassSwatchStrip()`**: safe to call from
  outside (e.g. after an external class-membership write) to refresh the
  panel; both no-op gracefully if their DOM containers or
  `this.kerningController` aren't ready yet.

## Confirmed facts vs. inferences

**Confirmed** (read directly, in full or the cited part, before writing any
code): the design doc's §0, §1.2, §3, §4; `KERNING-VIEW.md` §5.1/§5.2/§5.3/§9;
`part1-panes.md`'s report in full; the CURRENT `kerning.js`, `kerning.html`,
`kerning.css` (re-read after the concurrent worker's edits landed mid-task);
`kerning-controller.js`'s `editGroupSide1`/`editGroupSide2`/`_editGroup`/
`getPairsToTry`/`kernData` in full; `autokern-classes.js`'s
`inheritCompositeClasses`/`deriveKernRowClusters`/`classSpread` signatures;
the existing derive section (`deriveClasses`/`renderDeriveProposals`/
`buildDeriveProposalElement`/`acceptDeriveProposal`) before editing it;
`autokern-cache.js`'s `markGlyphStale` in full, plus a grep confirming no
other call site exists; `fontra-webcomponents/src/glyph-cell.js` and
`glyph-cell-view.js` in full; `fontra-webcomponents/src/menu-panel.js`'s
`showMenu`/`MenuItemDivider`/item-shape handling; `modal-dialog.js`'s
`dialogSetup`/`askString`; `editor.js`'s canvas `contextmenu` wiring and
`buildContextMenuItems`; `scene-model.js`'s `glyphAtPoint`; both packages'
`package.json` exports maps (no widening needed — `GlyphCell` resolves via
the existing `"./*": "./src/*"` wildcard); the font-mode worker's own landed
code (`initFontModeSection` through `showFontModeAddToDialog`), read in full
before writing `this.selectedClass`-dependent code, to confirm shape
agreement.

**Inferences** (stated as such in the code comments too): that "New class"
must ask for starting members, not just a name, since the data model cannot
represent a truly empty class; that a single-item context menu (rather than
a bare dialog with no menu) is the right way to satisfy "find how context
menus are registered... and follow that convention" for a scope that only
ever defines one action; that bypassing the phrase/pair chip machinery for
the "Show class" preview (a third, temporary scene text) rather than
building a new chip mode is the right reading of "previews... in the scene"
given the chip selector was explicitly out of this scope; that a native
`<input type="color">` behind a swatch button is an adequate "simple
color-picker affordance" per the task's own "keep it simple" instruction.

## Verification

**Pass condition:** `node --input-type=module --check < src-js/views-kerning/src/kerning.js`
must produce no output.

Ran, against the file as it stands now (after all edits from this workstream,
with the concurrent font-mode worker's own edits already present too):

```
node --input-type=module --check < src-js/views-kerning/src/kerning.js
```

Output: none (clean exit).

Additional sanity checks (not the named pass condition): `kerning.html`'s
`<div>`/`</div>` counts match (40/40); `kerning.css`'s `{`/`}` counts match
(66/66); grepped for every new element id used in `kerning.js` against
`kerning.html` to confirm each has exactly one matching definition (no typos,
no duplicates); grepped for `kerning-derive-tolerance` and
`deriveKernRowClusters`/`buildGlyphScriptCategoryMaps` afterward to confirm
only comments reference them now, no live code.

**Not run:** the webpack build (bundle-watch already running in the
background, per instruction not to run build/dev-server commands). If it
surfaces a resolution error around `@fontra/web-components/glyph-cell.js`,
that would be the next thing to check — it is plain-JS syntax-checked above,
and resolves under the same wildcard export map `glyph-cell-view.js` already
uses successfully elsewhere in this same file, but webpack's own resolution
was not exercised.

## Leftovers / recommendations (not built, correctly out of scope)

- Reconciling the font-mode worker's `showFontModeAddToDialog` (an inline
  duplicate of "pick side(s) + name, write independent classes") to call
  `this.addGlyphsToClass` instead of its own direct `editGroupSide1`/
  `editGroupSide2` loop — flagged by both workers' reports now; a small,
  independent follow-up.
- The font-mode worker's own `addFontModeSelectionToClass` calls
  `markGlyphStale` directly rather than through my
  `markGlyphsStaleForClassEdit` — harmless duplication (same underlying
  mechanism), noted for anyone doing a later consolidation pass.
- No "classes-only" narrower rerun-scope button — explicitly left as an
  unresolved implementation detail per the design doc, and per this task's
  explicit instruction to skip it.
- Class-list sorting is `side + name` alphabetical only; no sort-by-color or
  sort-by-membership-count was requested or built.
