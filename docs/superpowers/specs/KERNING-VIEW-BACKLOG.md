# Kerning view backlog

Post-build UX/functionality gaps the designer raised after using the feature (§10 marks the spec
itself as fully built; these are additions on top, not unbuilt spec). Grounded in the actual
implementation as of `feature/kerning-view`. No code changed to produce this document.

---

## 1. Preset phrase file needs an "Add" button with a file browser

**Problem.** The preset dropdown (`kerning.html:60-62`, `#kerning-preset-select`) is populated once,
at load, from a single hardcoded asset fetched by URL:
`src-js/views-kerning/src/kerning.js:421` — `const response = await fetch("./assets/phrase-presets.txt");`
followed by `parsePhrasePresets(presetsText)` (`character-lines.js`). There is no UI path to point at
a different presets file; the only way to change the preset list today is to edit
`src-js/views-kerning/assets/phrase-presets.txt` in the repo and rebuild.

**Suggested approach.** Add a button beside `#kerning-preset-select` (in the
`#kerning-phrase-section` block, `kerning.html:59-68`) that opens a file picker (a hidden
`<input type="file" accept=".txt">` triggered by the button, the same pattern used elsewhere in the
tree for file import — e.g. `panel-reference-font.js`'s dropped-file handling, which already reads a
local file into memory for this app). On selection, read the file's text with `FileReader`/
`file.text()`, run it through the same `parsePhrasePresets` already imported at
`kerning.js:105-106`, and either replace or append to `this.phrasePresets` before repopulating
`#kerning-preset-select`'s `<option>` list (the loop at `kerning.js:424-428`). Whether "Add" replaces
the built-in list or appends to it is a product decision the designer should make; either way it
should go through `parsePhrasePresets` unchanged, since that parser is already spec-correct
(§7.1) and untouched.

**Resolved (2026-09-06, `8569eab13`).** An "Add…" button beside `#kerning-preset-select` opens a
file picker (hidden `<input type="file" accept=".txt">`); the chosen file's presets are parsed with
the existing `parsePhrasePresets` and **appended** to the dropdown's existing option list, not a
replacement.

---

## 2. "Flush cache" button in the right pane

**Problem.** There is no way to discard a stale or corrupt per-source cache and start over. The
cache module `src-js/fontra-core/src/autokern-cache.js` exports `createCache` (line 107),
`setPairValue` (125), `markPairJunk` (150), `markGlyphStale` (173), and `pairsForRerun` (201), but no
`clearCache`/`flushCache` function — there is no bulk-clear primitive at all, only per-pair and
per-glyph mutation. On the view side, `kerning.js` reads/writes the OPFS-persisted cache file via
`readAutokernCacheFromOPFS`/`writeAutokernCacheToOPFS` (`kerning.js:196-218`) but exposes no action
that empties it; the only way to reset today is to re-run the whole font, which does not remove
stale/junk-marked history first (§4 keeps marked rows "in place" by design, which is correct for a
glyph edit, but is not the same as a designer-initiated full flush).

**Suggested approach.** Add a "Flush cache" button to the status strip (§7.5,
`kerning.html:230-239`, `#kerning-status-section`), gated on the currently-selected source
(`this.autokernSource`, read the same way `initRunSection`'s load path does at `kerning.js:538-547`).
On click: set `this.autokernCache = createCache()` (or `new Map()`, matching what
`readAutokernCacheFromOPFS` returning `null` already falls back to per the comment at
`kerning.js:191-195`), call `writeAutokernCacheToOPFS` for the current source to persist the empty
cache, then `renderPairTable()` and update the status counts (`updateStatusCounts`-equivalent code
around `kerning.js:1808-1823`). This should almost certainly require a confirmation step, matching
"apply all" states how many cells it will write and needs a second press" (§7.3) — flushing is
similarly destructive and per-source, not per-font, so the confirmation copy should name the source.

---

## 3. Category-adder shortcuts for the excluded-glyph field

**Problem.** The excluded-glyph field (`#kerning-pairtable-excluded`, `kerning.html:101-106`) is a
single free-text input parsed by `parseExcludedGlyphNames` (`kerning.js:1015`), which only knows how
to split a hand-typed list — there is no bulk "add all punctuation" or "add all diacritics" control.
Typing every glyph name in a category by hand is the exact blunt-instrument use case §4.2 names for
this field ("The excluded-glyph field is the blunt instrument for whole categories"), but the UI
gives no shortcut for it.

Category data already exists elsewhere in the tree and is not glyph-name guesswork: `glyph-data.js`
resolves a `category`/`subCategory` pair per glyph from `fontra-core/assets/data/glyph-data.csv`
(referenced at `glyph-data.js:178`, `info?.category === "Letter"`), and Font Overview's
`glyph-organizer.js` already groups glyphs by exactly this data (`glyph-organizer.js:59-60`,
`groupByInfo.category`/`.subCategory` at lines 257-262). Nothing in `views-kerning` currently imports
this module.

**Suggested approach.** Add a small menu or button row beside the excluded-glyph input, one entry per
category value the font's `glyphMap` actually contains (querying `glyph-data.js`'s lookup, mirroring
how `glyph-organizer.js` groups by it), e.g. "Add all Punctuation", "Add all Marks" (which is the
category `glyph-data.csv` uses for diacritics/combining marks, not a literal "diacritics" label —
confirm the exact category/subCategory strings the CSV uses before wording the buttons). Each button
appends the matching glyph names to `#kerning-pairtable-excluded`'s current value (comma-separated,
consistent with the existing manual format) and fires the same `"change"` handling already wired at
`kerning.js:902-915`, so no second write path is needed — this is presentation on top of the existing
field, not a new excluded-glyph mechanism (§4.2's two mechanisms, excluded-glyph field and per-pair
junk mark, stay exactly as they are; this is only faster data entry into the first one).

**Designer follow-up (2026-09-06).** Concrete categories wanted as one-click filter-outs:
non-standalone glyphs (combining marks / anything that doesn't advance on its own), numbers, and
punctuation. Decision made: these go in the **filter panel** (`autokernFiltersController`,
`kerning.js:868`), not the excluded-glyph field. Everything is still computed and cached on the run;
these are view-only toggles that hide the matching rows from the table. Add them as filter-panel
checkboxes alongside the existing side/grouping/sign/state filters. Category membership comes from
`glyph-data.js` (`info?.category` — "Number", "Punctuation", "Mark"; confirm exact strings against
`glyph-data.csv`); "non-standalone" needs its own predicate (zero-advance / combining) since it is
not a single CSV category.

Note: these checkboxes do not exist yet in the filter panel — this is new UI, not a wiring fix.

**Resolved (2026-09-06, `ad3251705`).** Three filter-panel checkboxes added — hide non-standalone/
marks, hide numbers, hide punctuation — pure display filters (nothing about the run or the cache
changes, only which rows the table shows). Category membership comes from `glyph-data.js`, matching
the exact category strings confirmed against `glyph-data.csv`.

---

## 4. Autokern cache storage location: OPFS vs. disk beside the .fontra file

**Problem — investigated, not assumed.** The cache is stored in the browser's Origin Private File
System, not on disk near the font file. Confirmed in
`src-js/views-kerning/src/kerning.js:117` (`import { getOPFS } from "@fontra/core/opfs.js"`),
`kerning.js:168` (`AUTOKERN_CACHE_OPFS_DIR = ["kerning-autokern-cache"]`), and the read/write pair at
`kerning.js:196-218` (`readAutokernCacheFromOPFS`/`writeAutokernCacheToOPFS`), which key each cache
file by `${projectIdentifier}--${source}.json` (`autokernCacheFileName`, `kerning.js:187-189`). No
IndexedDB or localStorage usage exists for the cache itself (localStorage is used only for the
filter-panel UI state, via `autokernFiltersController`'s `synchronizeWithLocalStorage`, a separate,
much smaller thing). The file-top comment at `kerning.js:142-167` states this was a deliberate choice
following the established pattern in `panel-reference-font.js`, which uses OPFS the same way for
dropped reference font files.

**Tension with spec §4.1, flagged rather than silently overridden.** §4.1's own stated rationale for
"browser-side storage" is specifically that the cache "can always be recomputed" and should not be
written into the designer's font sources ("Writing a cache of that size into the project file would
put derived data permanently into the designer's sources, which every backend round-trips"). That
argument is about *not* putting the cache in the `.fontra` project file itself (i.e., not routing it
through `fontController.performEdit`/backend round-trip) — it does not, on its own, require the
*browser's* storage specifically; a file written to local disk beside the `.fontra` file, outside the
project's own data model, would equally satisfy "derived, recomputable, not in the sources." The
real cost of OPFS the designer is likely reacting to: OPFS is sandboxed per browser origin/profile,
so the cache does not survive a browser profile change, a different browser, or being found/inspected
by hand next to the font file the way the designer might expect "stored" to mean.

**Suggested approach, offered as an option rather than a decision.** If a disk-based cache is wanted,
it needs a backend endpoint (this app's client has no direct filesystem access outside OPFS/dropped
files), analogous to how the `.fontra` backend already reads/writes project data — e.g. a sibling
file such as `<fontname>.fontra/autokern-cache/<source>.json` written through a new backend route,
not through `fontController.performEdit` (that path is reserved, per §4.1 and the existing comment at
`kerning.js:156-167`, for the *decisions* — junk marks and excluded glyphs — not the derived cache).
This is a larger change than the other items here (new backend surface, not just view code) and
should be scoped as its own workstream if the designer confirms OPFS's per-browser-profile
non-portability is the actual pain point, rather than assumed.

---

## 5. Bug: accepted derive-classes proposal's membership is not visible anywhere after Accept

**Problem — verified in code, appears to be a display gap, not a data-loss bug.** Before Accept, a
derive proposal's membership is shown as a truncated list right on its row:
`kerning.js:1635-1637` (`members.textContent = truncateGlyphList(proposal.members)`), inside
`buildDeriveProposalElement` (`kerning.js:1626-1664`), rendered into `#kerning-derive-proposals`
(`renderDeriveProposals`, `kerning.js:1618-1624`). Accepting writes real group membership through
`kerningController.editGroupSide1`/`editGroupSide2` (`acceptDeriveProposal`, `kerning.js:1690` on —
the same call `panel-selection-info.js`'s own per-glyph class field uses, confirmed at
`panel-selection-info.js:324-333`, `kerningController.editGroupSide2(glyphName, value.trim())` /
`editGroupSide1`), so the data write itself is real. But once accepted, the proposal is removed from
`this.autokernDeriveProposals` and `renderDeriveProposals()` re-runs (`kerning.js:1801`, "Proposals
are only removed from the pending list on full success") — its membership list disappears from the
UI along with the proposal row.

The only other place a class's full membership renders anywhere in this view is the pair table's
folded parent row, via `computeFoldGroupStats` (per spec §10's own note, "the folded parent's
membership... come[s] from the full class×class product") and `truncateGlyphList` at
`kerning.js:1400`/`1408`. That only appears when: a fold row happens to exist for the *currently
typed* glyph (`buildFoldGroups`, gated on `group.rows` being non-empty), a run has already been done,
and the typed glyph is a member of one of the two classes shown. `panel-selection-info.js`'s own
per-glyph field (lines 321-333) shows only the class's *name* (the address), never its membership —
consistent with spec §5.2's point that "a class's stored name is an address," but that means neither
existing UI reliably shows "here is everyone now in the class you just created" immediately after
Accept, unless the designer separately types a member glyph into the pair table's glyph field.

**Suggested approach.** After a successful `acceptDeriveProposal`, surface the just-written class's
membership somewhere durable — e.g. a small confirmation line ("`o ó ö` -> class `X`, N members")
left in place of the removed proposal row for a few seconds, or (more durably) auto-populating the
pair table's glyph field (`#kerning-pairtable-glyph`) with one of the newly-classed members so
`computeFoldGroupStats`'s existing membership display (`kerning.js:1400`/`1408`) picks it up
immediately without the designer having to know to type a name in. Either approach reuses
`truncateGlyphList` and the data `acceptDeriveProposal` already has in hand (`proposal.members`,
`className`) — no new membership-tracking mechanism is needed, only a render step that survives past
the proposal's removal from the pending list.

**Resolved (2026-09-06) — investigated, not a bug.** Confirmed directly in code:
`acceptDeriveProposal`'s success path (`kerning.js:2252-2254`) already calls `this.renderClassList()`
immediately after the write, alongside `renderDeriveProposals()`/`renderPairTable()`. The class panel
already refreshes and shows the new class with its membership right away — no further designer
action needed, and no code change was made (no commit exists for this item).

---

## 6. Left pane shows no numeric readout while dragging the sidebearing/kerning tools

**Problem — root cause found, appears to be a missing stylesheet, not missing logic.** The kerning
view reuses `views-editor`'s `SidebearingTool`/`KerningTool` classes unmodified (per §8's
import-across-views architecture), and their DOM-handle machinery is wired up identically to the
editor: both `kerning.html` and `editor.html` contain a `#metric-handle-container` div
(`kerning.html:38`, `editor.html:36`), which `edit-tools-metrics.js:36-37` requires
(`document.querySelector("#metric-handle-container")`, `assert(this.handleContainer)`) and appends
`<sidebearing-handle>`/`<kerning-handle>` custom elements into
(`SidebearingTool.addHandle`, `edit-tools-metrics.js:457-462`; the kerning equivalent at
`kerning.js:1221-1223`). Those elements' `update()` methods do set numeric text
(`SidebearingHandle.update`, `edit-tools-metrics.js:866-901`, sets `innerText` to
`formatMetricValue(...)` for advance/left/right) and inline `style.left`/`style.top` positions.

The positioning CSS that makes those inline styles do anything, however — `position: absolute` on
`.advance`/`.left-sidebearing`/`.right-sidebearing`/`kerning-handle` — lives only in
`src-js/views-editor/assets/editor.css:504-598` (`sidebearing-handle > .advance`,
`kerning-handle { position: absolute; ... }`, etc.). `kerning.html:1-16` links only `shared.css`,
`core.css`, `kerning.css`, and `tooltip.css` — it does not link `editor.css`. Without that stylesheet,
the handle child elements default to `position: static`, so the inline `top`/`left` assignments have
no effect: the numeric labels are present in the DOM and populated with real values, but not
positioned over the glyph at all (most likely collapsed at the top of `#metric-handle-container`,
which is why the designer sees no usable readout while dragging).

**Suggested approach.** Move the relevant CSS rules (`sidebearing-handle`, `kerning-handle`, and their
child selectors, `editor.css:504-598`) into a stylesheet both views load — either `kerning.css` (a
copy, if `views-kerning` is meant to stay decoupled from `views-editor`'s asset file) or a small
shared CSS file both `editor.html` and `kerning.html` link, whichever this codebase's asset-sharing
convention prefers (check whether other view pairs already share a CSS file the way they share JS
through the exports map in §8, before duplicating). No JS change should be needed — the handle
elements and their `update()` logic are already correct and already firing.

**Status (2026-09-06): still not fixed.** Designer re-raised: the basic kerning tool shows no numeric
readout at all while dragging. Same missing-stylesheet root cause as above until verified otherwise.

**Resolved (2026-09-06, `532ab2584`).** Copied the missing rules into `kerning.css` (no existing
view-pair CSS-sharing convention to hook into, so copy not link). Live-verified: `getComputedStyle`
on a real handle now reports `position: absolute` with a real non-zero bounding rect, where it
previously read `static`.

---

## 7. On-canvas numeric labels are not clamped to the viewport

**Problem.** Two independent label mechanisms in this view position text without checking whether the
result stays visible:

- The metrics-tool handles (`sidebearing-handle`/`kerning-handle`, item 6 above) are positioned by
  `canvasController.canvasPoint(...)` in `SidebearingHandle.update`
  (`edit-tools-metrics.js:866-884`) and the equivalent in `KerningHandle`
  (`edit-tools-metrics.js:1455` on), writing straight to `style.left`/`style.top` with a CSS
  `transform: translate(...)` offset (`editor.css:519`, `547`, `554`, `576`) and no bounds check
  against the canvas or container size. A glyph positioned near the edge of the visible pane —
  common while scrolled or zoomed in — can push the handle partly or fully outside
  `#metric-handle-container`.
- The on-canvas suggestion label (workstream "on-canvas display of a suggestion", spec §10) draws
  directly into the 2D canvas context with `context.fillText` at `kerning.js:2487-2488`
  (`` `suggest: ${round(suggestionValue, 1)}` ``), inside
  `buildAutokernSuggestionVisualizationLayerDefinition` (`kerning.js:2423` on). Canvas `fillText` has
  no notion of the surrounding page layout at all — it will draw past the edge of the canvas element
  outright if the glyph's screen position plus the label's width/offset exceeds the canvas bounds,
  and, being on a plain 2D canvas, it can never be "behind other UI" (there is no other UI sharing
  that canvas's z-order) but it can go off the visible edge of the pane the same way the DOM handles
  can.

**Suggested approach.** These are two different rendering mechanisms and need two different clamps,
not one shared fix:
- For the DOM handles: after setting `style.left`/`style.top` in `SidebearingHandle.update`/
  `KerningHandle`'s equivalent, measure the container's bounding box
  (`this.handleContainer.getBoundingClientRect()`, already available via `this.handleContainer` at
  `edit-tools-metrics.js:36`) and clamp the computed left/top so the handle's own rendered width/height
  stays within it, the same general technique tooltip positioning already uses elsewhere in this tree
  (`tooltip.css`/whatever JS drives it — worth checking before writing a second clamping routine from
  scratch).
- For the canvas-drawn suggestion label: clamp the `fillText` x/y coordinates against
  `context.canvas.width`/`height` (adjusted for the current scene transform, since the draw call
  works in glyph-space coordinates before the canvas's own transform is applied — the clamp needs to
  happen in screen space, so either transform the intended point first or compute the clamp using
  `canvasController.canvasPoint`, the same helper `SidebearingHandle.update` already uses at
  `edit-tools-metrics.js:867`).

**Suggestion label resolved (2026-09-06, `f2ca0d86e`) as a HUD line instead of a clamp** — see the
designer follow-up below; this made the canvas-label half of the clamp work moot. The DOM-handle
clamp (SidebearingHandle/KerningHandle, first bullet above) is still open and was explicitly left
untouched this round.

**Designer follow-up (2026-09-06): still absolutely-positioned, still not fixed.** The designer's
preferred fix for the suggestion number specifically is not an edge-clamp that keeps it near the
glyph — it's to pin the suggestion readout to a fixed spot at the top of the viewport (a small HUD
line), so it never tracks the glyph and never needs clamping. That is a different treatment from the
metrics-tool handles, which should still be positioned on the glyph and edge-clamped as above.

**HUD line resolved (2026-09-06, `f2ca0d86e`).** The `suggest: N` draw call resets to canvas CSS-pixel
space and draws at a fixed `(canvasWidth/2, 20)`, no longer glyph-relative. Live-verified via pan+zoom:
identical screen position across two screenshots while the glyph itself moved. Metrics-tool handles
(`edit-tools-metrics.js`) untouched — their edge-clamp is still open, tracked in item 6/7 above.

---

## 8. Override transparency: a unique value shadowing an existing class

**Problem.** Spec §5.1 already names the hazard: a literal glyph×glyph kerning value always wins over
a class cell that would otherwise answer for that pair (the lookup cascade tries the most specific
address first), so writing a unique value onto a pair whose sides are both classed silently and
permanently shadows the class for that one pair — the class stays in the file, stays in the panel, and
stops affecting that pair, with no error and no warning at write time. The
`2026-09-05-kerning-view-layout-overhaul-design.md` redesign (§1.1) makes this visible as a filter
bucket (unique×class / class×unique rows) but deliberately ships with override disabled rather than
deciding how to make it transparent, per the designer's explicit call: "right now no override."

**What already exists (v1 "no override" stopgap).** `wouldShadowClassCell(left, right)`
(`kerning.js:1791`) is a conservative detector: at least one side classed **and** the cascade
currently resolves that pair to a nonzero value. When it fires today, the row's select checkbox is
**disabled** (`kerning.js:3460-3464`) so the pair can't be applied at all, and a `shadows @L × @R`
note is shown beside the junk button (`kerning.js:3505-3510`, address string from
`describeShadowedClassCell`, `kerning.js:1807`). The four cascade buckets already exist
(`bucketForPair`, `kerning.js:1767`: unique×unique / unique×class / class×unique / class×class). The
unique-threshold param (`autokernParamsController`, default 5, `#kerning-param-threshold`) is a
display filter comparing `|suggestion − current stored value|` (`isRowAboveThreshold`,
`kerning.js:1644`). class×class rows already display the **median** of the full class product as the
aggregate suggestion (`computeFoldGroupStats`, `kerning.js:2114`; `medianOf` helper).

---

### Decided design (2026-09-07)

**1. New param: group divergence threshold.** A second threshold control beside
`#kerning-param-threshold`, same style, display-only (never touches the run or the cache). Default
**10** font units. It measures a different quantity from the unique threshold — divergence from the
group, not from the current stored value.

**2. New per-row quantity: divergence from the group value.** For any row where `wouldShadowClassCell`
is true, compute `suggestedValue − groupResolvedValue`. The group value is already in hand —
`wouldShadowClassCell` reads it via `getGlyphPairValueForLocation(left, right, {})`
(`kerning.js:1796`). A row is an **override candidate** when `|divergence| ≥ groupThreshold`. This is
orthogonal to `isRowAboveThreshold` (which compares against the current stored value, not the group).

**3. "Potential overrides" bucket in the pair table.** Override candidates are surfaced as their own
visible section at the **bottom** of the pair table, labelled "Potential overrides", below the four
cascade buckets, drawn from the three classed buckets. Structurally this is a **filter**, not a fifth
`bucketForPair` value — `bucketForPair`'s return is a statement about which cascade address is most
specific (`kerning.js:1764-1766`), a structural fact, whereas "override candidate" is a judgement
about magnitude. Implement as an extra state in the existing `state` filter (pending / applied /
stale → + "override candidate") or a dedicated toggle; render the matching rows in their own
`<tbody>`/section so it reads as a bucket to the user without corrupting the cascade-bucket model.

**4. Replace the hard-disable with a confirmation dialogue.** Re-enable the select checkbox for
shadowing rows. Any apply that would shadow a class cell — row apply, apply-selected, the
manual-value apply, apply-all — routes through a dialogue that names the shadowed address
(`describeShadowedClassCell`) and shows both numbers (group value vs. the value about to be written).
Two actions:
- **Apply as override** — proceed through `writePairValues` unchanged, then set an `override` flag on
  the pair's cache entry (see 5).
- **Cancel** — nothing is written.

"Take the glyph out of its group" was considered and **dropped**: group membership is global per side,
so removing a glyph to fix one pair changes every other pair that glyph forms. The per-pair opt-out
*is* the individual override (the first action) — that is the only resolution the dialogue offers.
Editing real group membership stays where it already lives (the class panel /
`panel-selection-info.js`), untouched by this feature.

**5. Persistent override marker.** Store `override: true` on the pair's cache entry, alongside the
existing junk mark. `autokern-cache.js` currently exposes `markPairJunk` and is "called, not edited"
under the file-ownership rule — this item needs a sibling `markPairOverride` there, so the ownership
boundary moves for this one module. Persist it in the OPFS cache file so it survives reload, matching
how junk marks persist. Render it as a badge on the row wherever the pair shows; the existing
`shadows @L × @R` note (`kerning.js:3505-3510`) changes from a red-flag warning to a neutral state
label once the override is deliberate.

**6. Group suggestion = median with outliers dropped.** `computeFoldGroupStats` (`kerning.js:2114`)
already returns `medianOf(entries.map(e => e.value))` over the full class×class product. Add one
filter step: before the median, drop member pairs whose own divergence exceeds the group threshold
(the test from 2), so the aggregate isn't dragged by the very pairs that are override candidates.
`classClassRowVisible` and the expanded child rows are unaffected.

**Out of scope this pass.** The self-scaling sensitivity knob (cutoff derived from each group's own
spread via median-absolute-deviation instead of a fixed font-unit value) — a later refinement, agreed
in the design conversation. Also out: any way to edit real group membership from this dialogue.

**Resolved (2026-09-07).** All six parts built.

1. **Group threshold param** — `groupThreshold` on `autokernParamsController`, default 10, bound to a
   new `#kerning-param-group-threshold` number input beside `#kerning-param-threshold`, with the same
   `Number`-converting `change` binding and a `renderPairTable` key listener. Display-only: it is read
   only on the pair-table render path, never by `runAutokern` or any cache write.
2. **Per-row divergence** — `overrideDivergence(left, right, suggestedValue)` returns
   `suggestedValue − getGlyphPairValueForLocation(left, right, {})`; `isOverrideCandidate(...)` gates
   that on `wouldShadowClassCell` being true and `|divergence| ≥ groupThreshold`. Both parts 3 and 6
   call these. (Note: the divergence equals a normal row's `delta`, since `pairRowData.current` reads
   the same cascade value — the distinction is purely the threshold constant and the shadow gate.)
3. **"Potential overrides" section** — a fifth `<tbody>`/section
   (`#kerning-pairtable-body-potential-overrides`, `data-bucket="potential-overrides"`) rendered below
   the four cascade buckets, kept visible in every grouping mode. `bucketForPair` is untouched
   (still four-valued). Candidate rows are **lifted out** of their home cascade bucket rather than
   shown in both, because `getSelectedPairTableRows`, apply-all's `tbody tr` scan and
   `syncSelectAllCheckboxes` all query row checkboxes document-wide and assume each pair-row appears
   once. Implemented as the dedicated section (not a new `state`-filter value). When "Fold classes" is
   on (default), class×class candidates stay reachable only as fold-parent child rows and are not also
   lifted here, to avoid double-rendering their checkboxes; when unfolded they are lifted like the
   other classed buckets. The section only populates when a glyph is typed, same anchoring as the
   three glyph-anchored buckets.
4. **Confirmation dialogue** — the `checkbox.disabled` hard-disable in `buildPairRowElement` is
   removed. `writePairValues` takes a new `confirmShadow` arg, passed `true` by apply-selected,
   apply-all and the manual-value apply, left `false` by the reset paths (reset-to-current /
   reset-to-zero are deliberate flat-exception writes, not accidental shadows). When set and the batch
   contains any `wouldShadowClassCell` pair, one `dialogSetup`/`run` modal (the codebase's standard
   one) summarises the batch — shadowed address via `describeShadowedClassCell`, group value vs. value
   to be written, up to 6 pairs then a count — with **Apply as override** / **Cancel**. Cancel writes
   nothing.
5. **Persistent `override` flag** — `markPairOverride` added to `autokern-cache.js` as a pure sibling
   of `markPairJunk` (new Map, same entry-shape/guard, independent flag). `setPairValue` and
   `markPairJunk` now carry an existing `override` through so a re-run or a junk toggle doesn't drop
   it. It round-trips the OPFS cache file with no whitelist change (whole entry objects are
   serialised and rebuilt). On a confirmed override the row's `shadows @L × @R` note becomes a neutral
   `override: @L × @R` label (`.kerning-pairtable-override-note`); the warning note stays for an
   un-confirmed candidate.
6. **Outlier-dropped median** — `medianDroppingOutliers(samples, groupThreshold)` added to
   `autokern-cache.js` (pure); `computeFoldGroupStats` takes `groupThreshold` (threaded through
   `buildClassClassGroups` from `renderPairTable`, same as `threshold`) and feeds it each member
   pair's `{value, divergence}`. Members with `|divergence| ≥ groupThreshold` are dropped from the
   aggregate median; if every member is an outlier it falls back to the unfiltered median.
   `classClassRowVisible` and the expanded child rows are unchanged.

Files: `src-js/fontra-core/src/autokern-cache.js` (+ `tests/test-autokern-cache.js`),
`src-js/views-kerning/src/kerning.js`, `kerning.html`, `assets/kerning.css`.

**Verified:** `npm run bundle` clean (only the pre-existing asset-size warnings); fontra-core mocha
suite green (2518 passing) including two new `test-autokern-cache.js` cases — `markPairOverride`
round-trips `override: true` leaving other fields intact and returning a new Map, and
`medianDroppingOutliers` excludes a gross outlier / falls back when all are outliers; `prettier
--check` clean on every touched file except `kerning.html`, which was already non-conformant at HEAD
(whole-file reflow) and was left as-is — the added lines themselves match prettier output.

**Not verified (no live server this pass):** the dialogue's actual on-screen appearance and
button wiring, the OPFS round-trip of the `override` flag across a real browser reload, and the
"Potential overrides" section's live show/hide and lift-out behaviour against a real run. All reasoned
from code, not exercised in a browser.

---

## 9. A visibility toggle (eye icon + hotkey) for the on-canvas suggestion display

**Problem.** The on-canvas suggestion overlay (spec §10's "on-canvas display of a suggestion",
`buildAutokernSuggestionVisualizationLayerDefinition` at `kerning.js:2423`) is deliberately built
non-optional today: `userSwitchable: false` (`kerning.js:2432`), with a comment stating this outright
— "gating is entirely on pair mode + a cache entry existing... not a designer-facing visibility
toggle." Visibility is currently controlled only by being in `pair` chip mode with a cache entry for
the selected pair; there is no way to hide it on demand while still in pair mode, and it never appears
in `phrase` mode at all (gated to pair mode by the draw function's own no-op check).

**Ask.** An eye icon in the preview pane's upper-right corner, plus a keyboard shortcut, to control the
suggestion overlay's visibility — described as wanting a "real-time suggestion preview."

**Resolved (2026-09-06, `a856c030b`..`cf356d97c`), built as one combined feature with item 10.** First
pass wrongly substituted a settings-accordion checkbox for the eye icon; corrected in `cf356d97c` to an
actual `<icon-button>` in the preview pane's own upper-right corner plus a "P" hotkey
(`action.kerning.toggle-suggestion-preview`), matching this section's original ask exactly. This is the
one master on/off switch for the whole feature (re-spacing + band + label, see item 10). The accordion
(opacity, show numbers, show band) remains as secondary settings below it, not a second on/off switch.
The all/selected design below was superseded: phrase mode always previews every visible pair (no
selected-only mode within phrase), decided when item 10 was scoped as one combined ask rather than two.

**Resolved: it's a selector, not a binary toggle.** Two states, `all` / `selected`:
- **Selected** — today's behavior, kept as the default: only the one selected pair's suggestion draws.
- **All** — every visible pair in the current preview draws its own suggestion live, not just the
  selected one. This is the phrase-mode extension called out below, now in scope rather than deferred:
  the eye icon (plus hotkey to cycle the two states) is what exposes it, so the icon isn't a plain
  show/hide but a two-position switch, mirroring how a design tool's "show all guides" vs. "show
  selected guide's guides" toggle usually reads.

**What this means for implementation.**
- The `selected` state is the existing mechanism: flip `userSwitchable` to `true` (or add a dedicated
  control, since the existing mechanism assumes a design-space-style layer list this eye icon may not
  want to reuse verbatim) so the same pair-mode, cache-gated overlay can be hidden/shown on demand.
  `this.visualizationLayers.toggle(...)` plus `this.canvasController.requestUpdate()` already do this
  for every other layer in this codebase (constructor's `visualizationLayersSettings.addListener`,
  `kerning.js:264`); a hotkey is a `registerAction` call in the same style already used for this view's
  own actions (e.g. `action.kerning.toggle-chip`, `kerning.js:2278-2284`).
- The `all` state is genuinely new behavior: today's draw function no-ops outside pair mode by design,
  and even within a phrase it only ever draws for the one selected pair. Needs its own short design
  pass before implementing — at minimum: performance across a full phrase's worth of pairs, and whether
  every pair's suggestion draws regardless of magnitude or only ones above the existing threshold (to
  avoid cluttering the preview with near-zero suggestions).

Both fixes are additive positioning logic on top of existing, working draw calls — no change to what
data is shown or when (the gating logic in item 6's handles and this item's suggestion layer,
`kerning.js:2446-2462`, stays as is).

**Resolved (2026-09-06, `a856c030b` + `7dc3a31ff` + `25824d413`), together with item 10.** Built as
one settings-driven mechanism instead of a canvas eye icon + hotkey: a "Suggestion preview" accordion
in the right pane (below Parameters), reusing the exact `Accordion`/`ui-accordion.js` convention
views-editor's own grid-layer settings already use (`panel-designspace-navigation.js`'s
`coarse-grid-accordion-item`). The accordion's own master checkbox is the visibility control this
item asked for — on by default, matching the pre-existing label's `defaultOn: true` — replacing the
originally-floated eye icon/hotkey design, which was never built. See item 10's own resolution note
for the accordion's other two settings and the full re-spacing mechanism this visibility toggle now
gates.

---

## 10. Live non-destructive suggestion preview (actually move the letters in the preview pane)

**Ask (2026-09-06).** Still no true preview of a suggestion. Today the overlay only draws a
`suggest: N` text label (§7/§9, `kerning.js:2487-2488`); the glyphs in the preview stay at their
current (unkerned or already-applied) spacing. The designer wants the preview pane to actually
re-space the letters by the suggested delta so the kerning can be judged visually, without writing
anything to the font.

**Not yet code-investigated.** Distinct from §9 (§9 is a visibility selector for the numeric label).
This one needs the scene/positioning layer to offset glyph advances by a per-pair preview delta that
is display-only — never routed through `fontController.performEdit` or the pair-table write path.
Scope with §9's `all`/`selected` design pass, since "preview every visible pair" has the same
per-phrase performance question.

**Resolved (2026-09-06, `a856c030b` + `7dc3a31ff` + `25824d413`), together with item 9.** Closed as
one combined feature across three commits:

- `a856c030b`: the settings accordion (item 9's visibility control, plus opacity/show-numbers/
  show-band) — UI only, no behavior yet.
- `7dc3a31ff`: pair mode — the selected pair's right-hand glyph is genuinely moved on screen by
  `this.autokernCache`'s entry for that pair (the same lookup/gating the `suggest: N` label already
  used, reused unchanged, not recomputed a second way).
- `25824d413`: phrase mode — every adjacent glyph pair in the current phrase shifts simultaneously,
  each by its own cache entry, threaded cumulatively along the line the way a real applied kern
  accumulates (matched against `shaper.js`'s own `previousGlyph.xAdvance += kernValue` convention
  before picking the sign).

Mechanism: a positioned-glyph's `x` is mutated directly on the scene's own positioned-line objects,
never through `fontController.performEdit` or the pair-table write path — display-only, confirmed by
inspection (no new write call was added) and live-verified (`suggestionPreviewSettings.enabled =
false` snaps every shifted glyph back to its pre-shift position on the next repaint, `= true`
reproduces the identical shift, byte-for-byte, every time).

One flagged divergence: the settings accordion's opacity control applies to the highlight band and
the numeric label (the two visual elements this feature draws under its own control), not to the
re-spaced glyph's own fill — that fill is drawn by views-editor's shared `fontra.context.glyphs`
layer (`visualization-layer-definitions.js`), which this work was constrained to import, not edit.
The glyph is still genuinely repositioned; only its fill's opacity isn't independently adjustable
from this accordion.

---

## 11. Sortable table columns (click a column header to sort by it)

**Ask (2026-09-06).** Sorting the results table by an arbitrary column. Today sorting is a single
two-state toggle button, `#kerning-pairtable-sort-toggle` — "worst delta first" (default) vs
"alphabetical" (`kerning.js:1021-1034`, sort logic at `kerning.js:1382-1445`). Designer wants
click-a-header, asc/desc, per column (glyph, current value, suggestion, delta, state).

**Not yet code-investigated.** The two existing sort orders already cover delta and name; this is
extending `autokernFiltersController`'s `sortAlphabetical` boolean into a `{column, direction}` pair
and moving the control onto the `<th>` cells. Check whether the fold-classes grouping
(`buildFoldGroups`) constrains which columns can be sorted before promising all of them.

**Resolved (2026-09-06, `b6335e273`).** `sortAlphabetical` replaced with `{sortColumn,
sortDirection}`; each bucket table's `<th>` cells (Left/Right, Delta, Current, and a new "State"
header on what was previously an unlabeled actions column) are clickable, flip direction on a
second click, and carry a ▲/▼ indicator. The old `#kerning-pairtable-sort-toggle` button was
removed rather than kept alongside header clicks, to avoid two competing sort UIs. Confirmed via
`buildFoldGroups`/`computeFoldGroupStats` before implementing that a folded class×class parent row
has no per-row current or state value; clicking those two headers while folded falls back to the
bucket's own default (worst median first) instead of sorting on an undefined field. Live-verified
against a real Fontra server + webpack build + headless Edge over raw CDP: each header click
produced the correct new row order and label/arrow, a second click flipped direction, and the
class×class fallback updated the model without crashing (only one class×class group existed in the
test cache, so the fallback's multi-row ordering itself wasn't exercised, noted as a limitation).

---

## 12. "?" tooltip in the class pane explaining what "Left" / "Right" name

**Ask (2026-09-06).** The Left/Right labels in the class/group pane are ambiguous: does "Right" mean
"this class is used on the right side of a pair" (i.e. the kern sits to this glyph's left) or "the
glyph on the right"? Spec §5.2 treats a class name as an address, but the side label's meaning is not
spelled out in the UI. Add a `?` affordance next to the Left/Right labels that shows a one-line
tooltip stating the convention (reuse `tooltip.css`, already linked by `kerning.html`).

**Resolved (2026-09-06, `bcca4a06d`).** `?` badge added next to the New-class Left/Right buttons using
the existing `[data-tooltip]` CSS-only convention. Wording checked against `kerning-controller.js`
(`groupsSide1`/left name vs `groupsSide2`/right name in `getPairsToTry`) before writing it, not guessed.

---

## 13. Select-all checkbox in the pair table header

**Ask (2026-09-06).** No way to select every visible row at once. Per-row selection already exists
(`getSelectedPairTableRows`, consumed by apply-selected / reset-* at `kerning.js:1039-1051`); this is
one checkbox in the header row that toggles all currently-visible (post-filter) rows, with the usual
indeterminate state when only some are checked.

**Resolved (2026-09-06, `8c0b72bd3`, indeterminate fix `f08f5dce8`).** One checkbox per bucket's own
`<thead>` (each bucket is its own `<table>`, no single shared header across buckets), reusing the
existing per-row checkboxes. Live testing (CDP) caught a real bug — indeterminate stayed `true` after
clicking select-all, since a programmatic `.checked =` doesn't auto-clear it — fixed by clearing it
explicitly in the change handler, then re-verified live.

---

## 14. Editable value cells in the pair table

**Ask (2026-09-06).** Edit a pair's value directly in its table cell. Today the only in-table write
path is the manual-value input plus "apply" button (`#kerning-pairtable-manual-value` /
`#kerning-pairtable-manual-apply`, `kerning.js:1071-1079`), which writes one value to all selected
rows. Designer wants to type into a row's value cell and commit that single pair. Reuse
`writePairValues` (the same function manual-apply calls); the new surface is an inline editable cell
per row instead of the shared input.

---

## 15. Table-wide "hide suggestion" toggle, same as "show current"

**Ask (2026-09-06).** The table has a `#kerning-pairtable-show-current` checkbox that turns the
current-value column on/off for the whole table (`kerning.js:1007-1011`). Want the mirror control for
the suggestion column — one checkbox that hides/shows the suggested values across the entire table,
not a per-row control. Add a `showSuggestion` item to `autokernFiltersController` (`kerning.js:868`)
and a matching checkbox; `renderPairTable` reads it to skip the suggestion column.

**Resolved (2026-09-06, `be4686667`).** `showSuggestion` filter added, checkbox beside show-current.
There's no separately-labeled "Suggestion" column — Delta is the table's suggestion display — so that
column is what toggles. Live-verified: `th`/`td` both switch to `display: none` on uncheck.

---

## 16. Right panel lacks a vertical divider

**Ask (2026-09-06).** The right panel has no vertical rule separating it from the canvas / adjacent
column, so the boundary reads as ambiguous. CSS-only: a `border-left` (or a divider element) on the
right-panel container in `kerning.css`, matching whatever the other panel edges in this view already
use.

**Resolved (2026-09-06, `6eb3a7225`).** `border-left` on `#kerning-panel-container`, matching the
existing `border-right` on `#kerning-pairtable-section`'s opposite edge. Confirmed visually in a live
screenshot.

---

## 17. On-canvas "suggest: N" overlay only shows a value for the first pair in a multi-pair preview

**Problem (found 2026-09-08, during the kerning UX rework's Task 7).** Since Task 7 added multi-pair
preview (several highlighted or typed pairs shown together, each on its own line), the suggestion
overlay's numeric label — `buildAutokernSuggestionVisualizationLayerDefinition` /
`_applySuggestionPreviewRepositioning` in `kerning.js` — still only ever draws for
`positionedLines[0]`, i.e. the first previewed pair. Every other pair in the set shows no "suggest: N"
label at all, even when it has a real cached suggestion.

**Not yet fixed.** Left alone by the Task 7 worker since the relevant draw code sits outside that
task's file scope (not `initPairTableSection`/`selectPairForScene`/`setChipMode`) — flagged rather than
touched speculatively. Needs its own pass: either loop the label draw over every positioned line instead
of hardcoding index 0, or decide the label should only ever apply to one "primary" pair by design and
say so explicitly in the UI (not just as a silent limitation).

---

# UX round 2 — designer review 2026-09-09

Ten issues raised after using the rebuilt view. Grounded in the tree at `544e34a53`. No code changed
to produce this section. They are ordered as the designer listed them; each is meant to be fixed on
its own commit. Items 18–20 and 24 are one cluster (the Glyph/Pair inputs never actually drive the
table); fix them together or in that order.

---

## 18. Ctrl+Click inserts `/name`; the token grammar should accept a bare glyph name and drop `%name%!`

**Problem.** The Glyph/Pair token grammar (`input-tokens.js:17-33`, `parseToken`) recognises four
token shapes: a single literal character, `/glyphname`, `@ClassName`, and `%glyphname%!` (kind
`member`). A bare multi-character string such as `Adieresis` throws
`"Use a character, /glyphname, @class, or %glyphname%!"`. `replaceGlyphToken`
(`input-tokens.js:61-63`) and `appendGlyphToken` (`input-tokens.js:51-58`) both serialise a
Ctrl+Click / Shift+Ctrl+Click as `"/" + name`, so a click always writes `/name` into the field.

The designer's model is simpler: a bare glyph name **is** the glyph token. `%…%` in the review
notes was only a way to point at "this is a name" in prose, not proposed syntax — `%glyphname%!`
should not exist as a user-facing shape at all, and its job (name a class member directly, bypassing
the character map) is covered by a bare name.

**What the fix needs.**
- `parseToken`: a token that is not a single character and does not start with `/` or `@` resolves as
  kind `glyph` (bare name). Keep `/name` accepted as an explicit synonym so existing typed input and
  serialised clicks still parse. A single character stays kind `literal` (character-map lookup);
  a one-character string that is also a real glyph name is the one genuine ambiguity — decide
  literal-wins (current behaviour) unless the designer wants `/` to force the name reading.
- Remove kind `member` and the `%…%!` branch. Every reader of kind `member` must move to kind
  `glyph`: `resolveTokenToGlyphNames` (`input-tokens.js:83-89`, already identical handling),
  `getExposedMemberNames` (`kerning.js:3028-3045`, the `token.kind === "member"` test — see item 20
  for what "exposed member" should mean afterward).
- `replaceGlyphToken` / `appendGlyphToken`: write the bare `name`, not `"/" + name`.
- `.kerning-pairtable-input-error` copy and the two input `placeholder`s
  (`kerning.html`, `#kerning-pairtable-glyph` / `#kerning-pairtable-pair`) lose the `%…%!` example.

---

## 19. The Glyph/Pair inputs must filter the results table, not only feed the preview

**Problem.** Typing in `#kerning-pairtable-glyph` sets `filters.glyphName` to the **raw trimmed
field text** (`kerning.js:1769-1772`) and calls `updatePairPreview()`. `updatePairPreview`
(`kerning.js:6378-6429`) only sets the scene preview pairs. The table is re-rendered because
`autokernFiltersController`'s own listener calls `renderPairTable` (`kerning.js:2067`), but
`renderPairTable` filters unique-pair rows with a raw identity compare —
`if (entry.left !== glyphName && entry.right !== glyphName) continue;` (`kerning.js:2920-2924`) —
against `glyphName = filters.glyphName` (`kerning.js:2770`), i.e. the un-parsed field text.

So the table only narrows when the field holds **exactly one bare glyph name**. A literal character
(`A`), a `/name` token, an `@class` token, or any comma-separated list never matches
`entry.left`/`entry.right` and the `if (glyphName)` block yields nothing — combined with item 21,
that reads as "the table went blank / ignored me."

`#kerning-pairtable-pair` does not filter the table at all. Its `input` listener
(`kerning.js:1790-1801`) calls `updatePairPreview` + `renderPairTable`, but nothing in
`renderPairTable` reads the Pair field as a row filter — only `getExposedMemberNames`
(`kerning.js:3034`) reads it, for member-exposure.

**What the fix needs.**
- Resolve both fields through `input-tokens.js` (`parseTokenList` + `resolveTokenToGlyphNames`, or
  `pairsFromInputs` when both are non-empty) to concrete glyph-name sets, once per render, the way
  `updatePairPreview` already does via `pairInputResolver()` (`kerning.js:6489-6503`).
- Glyph field only: keep every cache row (and every class-summary row) that involves any resolved
  Glyph-field name on either side — the existing `if (glyphName)` anchor generalised from one string
  to a set, and applied to the class-summary path too (`buildClassClassGroups`'s `glyphName`
  argument, `kerning.js:3116-3133`, currently a single string `.includes` test).
- Both fields non-empty: restrict to the cross-product pairs `pairsFromInputs` returns (this is
  also the preview set — one resolution, two consumers).
- The `filters.side` "glyph on left/right" tests (`pairRowVisible`, `kerning.js:2445-2450`) compare
  `row.left`/`row.right` against the single `glyphName` string — regeneralise to "is on the named
  side" against the resolved set.

---

## 20. A typed class must collapse to one class row, `@ClassName (glyph)`, unless "Show individual class members" is on

**Problem.** When the Glyph field holds a glyph that belongs to a class, `renderPairTable` still
emits that glyph's individual pair rows. Rows where the glyph is classed on **one** side only
(bucket `class-unique`) go through the `if (glyphName)` unique-pair path (`kerning.js:2920-2946`)
and `pairRowVisible`, which has **no** `showIndividualMembers` gate — only `member-pair` rows (both
sides classed, no saved rule) are gated, in `rowVisibleInDefault`
(`results-model.js`, via `kerning.js:2977`). So a one-side-classed member spills its rows whatever
the checkbox says.

The designer wants the opposite default: a typed glyph that resolves into a class is represented
**by its class** — a single summary row labelled `@ClassName (typedGlyph)` so it is clear which
class and why it is shown — and the individual member pairs appear only when **Show individual
class members** (`filters.showIndividualMembers`, `kerning.js:2850`) is ticked.

**What the fix needs.**
- Decide the label form: the class-summary row builder (`buildClassSummaryRowElement`,
  around `kerning.js:3320`/`3380`/`3436`) currently shows full membership per side
  (`truncateGlyphList`). Add the `(typedGlyph)` annotation on the side the typed glyph is a member
  of when the table is glyph-anchored.
- Extend the `showIndividualMembers` gate so it also suppresses `class-unique` / `unique`-anchored
  rows for a glyph that is classed on the relevant side — not just `member-pair` rows. The class
  summary for that side stands in for them.
- Interacts with item 19: "resolve the field to a set" must know, per name, whether it is classed
  (`isLeftClassed`/`isRightClassed`, `kerning.js:2285-2291`) to choose class-row vs pair-row
  representation.

---

## 21. Empty Glyph input must show the whole table

**Problem.** `renderPairTable` guards all non-class-summary rows behind `if (glyphName)`
(`kerning.js:2920`). With the field empty, `glyphName` is `""`, the block is skipped, and the table
shows **only** class×class summary rows — every unique×unique, unique×class and class×unique row in
the cache is invisible until a glyph is typed.

The designer expects an empty field to mean "no glyph filter" — show every cached pair (still
subject to the other filters: threshold, side, Unicode types, relationships, glyphset, hidden).

**What the fix needs.** An `else` branch (or drop the guard) that iterates the whole
`this.autokernCache` through the same `pairRowData` → `pairRowVisible` path the `if (glyphName)`
block uses, with no glyph anchor. Watch cost: a few hundred glyphs is tens of thousands of cache
rows (spec §4), all built into DOM — confirm `pairRowVisible`'s threshold/filters cut it to a sane
count first, or page it, before shipping. The class-summary path already runs font-wide with no
anchor and can stay as is.

---

## 22. Selecting a pair previews only one direction

**Problem.** `selectPairForScene(left, right)` (`kerning.js:6364-6367`) sets exactly one ordered
pair: `setPreviewPairs([[left, right]])`. A row click for `A V` previews `A V` and never `V A`, so
the designer cannot judge the reverse pair without retyping.

**What the fix needs.** Decide the product behaviour: preview both `left right` and `right left`
(two lines) on a row click, or add a control to flip. If both lines: `setPreviewPairs`
(`kerning.js:6519`) already emits one line per pair, so `[[left, right], [right, left]]` is enough
for the scene — but the suggestion overlay only repositions/draws for `positionedLines[0]` in pair
mode (item 25 / existing item 17), so this needs item 25 fixed first or the second line shows no
shift and no number.

---

## 23. "Unicode types" filter appears to do nothing — confirm the intended model

**Problem.** The filter is fully wired: `filters.unicodeTypes` → `this._unicodeTypesSet`
(`kerning.js:2776`) → `pairMatchesUnicodeTypes` in `pairRowVisible` (`kerning.js:2482-2486`) and
`classClassRowVisible` (`kerning.js:3216`), with per-glyph category resolution through the real
`glyph-data.js` service (`results-model.js:102-122`, `glyphMatchesCategory` — `case === "upper"` etc.).
It is not ignored in code.

Why it reads as inert:
- The default has **every** category checked except `non-unicode` (`kerning.js:1707-1712`), and a
  row matches if **any** glyph on **any** tested side belongs to **any** checked category
  (`pairMatchesCategory`, `results-model.js:134-143`). With six of seven boxes checked, essentially
  every real pair passes — the filter only visibly bites once the designer *unchecks* most of it.
- Unchecking everything hits the "nothing selected" empty state (`kerning.js:2785-2806`), not "show
  all" — deliberate (ledger §8.4) but easy to read as broken.
- With an empty Glyph field the table today shows only class-summary rows (item 21), and their
  Unicode test is "any member of the class matches" — the most permissive form.

**What the fix needs.** A decision, not code first: does the designer want this as a positive
include filter (check `uppercase` → show only pairs where the tested side is uppercase), which is
what it already is once you invert the default? If so, flip the default to few/none checked and
label it as an include filter. If the intent is different (e.g. exclude, or "both sides must
match"), state it and rewire `pairMatchesCategory`'s side logic. Blocked on designer input.

---

## 24. Ctrl+Click token not recognised by the table filter

**Problem.** Same root as items 18 + 19, called out separately because the designer listed it
separately: Ctrl+Click writes `/name` (`replaceGlyphToken`), the preview parser accepts it
(`parseToken`, `input-tokens.js:26-28`), but the table filter's raw `entry.left !== glyphName`
compare (`kerning.js:2922`) sees `/name` and never matches a bare cache name. Fixed for free once
18 (bare-name serialisation) and 19 (resolve the field through `input-tokens.js` before filtering)
land. No separate work — listed so it is ticked off explicitly.

---

## 25. Pair-mode suggestion preview is broken; make it use the phrase-mode mechanism

**Problem.** `_applySuggestionPreviewRepositioning` (`kerning.js:6781-6825`) has two code paths:
- **phrase** mode (`kerning.js:6811-6815`): every glyph after the first shifts by
  `cache.get(pairKey(prev, cur))?.value`, accumulated along the line — correct, and what the
  designer wants everywhere.
- **pair** mode (`kerning.js:6800-6810`): shifts only when `line === positionedLines[0]` **and**
  `i === 1` **and** `glyphs[0].glyphName === this._selectedPairLeft` **and**
  `glyph.glyphName === this._selectedPairRight`. So only the first previewed pair on the first line
  ever moves or draws a band/number. Multi-pair pair-mode previews (items 17, 22) and the reverse
  direction get nothing.

The overlay draw (`buildAutokernSuggestionVisualizationLayerDefinition`, `kerning.js:6650-6745`)
already reads `this._previewPairValue.get(positionedGlyph)` per glyph and would draw per pair — it
is starved only because the repositioning pass populates `_previewPairValue` for one glyph.

**What the fix needs.** Drop the pair-mode special case: run the phrase-mode per-adjacent-pair
cumulative logic in both chip modes (a pair-mode line is just a two-glyph line, so the same loop
handles it). Keep `this._selectedPairLeft/Right` only for the HUD "which pair is primary" text if
that distinction is still wanted; the band + glyph-space number should draw for every pair with a
cache entry, same as phrase mode. This also closes existing item 17.

---

## 26. Kerning-tool handle should show the suggested value, at the bottom of the ribbon

**Problem.** With the kerning tool engaged, the `<kerning-handle>` custom element
(`edit-tools-metrics.js`, imported unmodified from `views-editor` per spec §8) shows the **stored**
kern value on the handle ribbon, always visible. There is no readout of the autokern **suggestion**
for the pair under the tool. The designer wants the suggestion shown the same always-on way,
positioned at the bottom edge of the ribbon (so stored value and suggestion read as two rows).

**What the fix needs — scope carefully.** `kerning-handle` lives in the shared
`views-editor/src/edit-tools-metrics.js`; editing it changes the editor too. Options, cheapest
first:
- Draw the suggestion as part of this view's own visualization layer
  (`buildAutokernSuggestionVisualizationLayerDefinition`) gated to "kerning tool active" instead of
  "pair chip mode", positioned at the band's bottom — no shared-file edit, but it is canvas text,
  not part of the DOM handle.
- A `kerning.css`-only `::after` on `kerning-handle` fed by a CSS custom property this view sets per
  hovered pair — only if the handle's DOM exposes a hook.
- Subclass `KerningTool`/`KerningHandle` in `views-kerning` (the pattern spec §8 and the
  single-sided-pen precedent both endorse over copying) and add the second line there.
Decide with the designer whether the suggestion tracks the hovered pair or the selected one.

---

## 27. Font mode: class colours still not shown; Fontra status-colour labels still not dropped

**Problem.** `decorateFontModeGlyphCell` (`kerning.js:6067-6102`) already tries both halves:
- drops the status colour by shadowing the cell instance's `_glyphStatusColor` with a getter
  returning `"var(--cell-background-color)"` (`kerning.js:6073-6077`);
- sets `--kerning-font-tile-left-color` / `--kerning-font-tile-right-color` from `getClassColor`
  (`kerning.js:6079-6090`), consumed by the `#kerning-font-grid-container glyph-cell` `box-shadow`
  rule in `kerning.css:762-766`.

The designer reports neither works, so one or more of these is true and needs checking on a live
run:
- the `MutationObserver` wiring (`kerning.js:5920-5933`) is not finding the `<glyph-cell>` nodes,
  or runs before `cell.glyphName` is set, so `decorateFontModeGlyphCell` never resolves a class;
- `glyph-cell.js` no longer reads an instance field named `_glyphStatusColor` (renamed, or the
  colour now comes from a shadow-DOM element / a `::part`), so the `defineProperty` shadow is inert;
- the `box-shadow` custom-property rule does not match — element name (`glyph-cell` vs
  `glyph-cell-view`), or the host box is overpainted inside the shadow DOM;
- `getClassColor` returns null because `leftPairGroupMapping`/`rightPairGroupMapping`
  (`kerning.js:6079-6080`) are empty for these glyphs (no classes in the test font, or mapping not
  loaded yet).

**What the fix needs.** Live-verify against a real Fontra server which of the above it is, then fix
that one. Confirm the exact status-colour mechanism in the current `glyph-cell.js` before trusting
the `_glyphStatusColor` shadow. This is a debugging pass, not a design decision.
