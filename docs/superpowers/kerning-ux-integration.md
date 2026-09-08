# Kerning UX — integration contracts (Task 1)

**Date:** 2026-09-08. **Branch:** `feature/kerning-view`. **Commit at time of writing:** `8f1d8c65ef7deb84ab46634bc1ecb188a3a14ba1`.

This document is Task 1 of `docs/superpowers/plans/2026-09-08-kerning-view-ux.md`: investigation and a
decision ledger only. It contains no behavior change. Later tasks in that plan consume this document
instead of guessing at omitted APIs.

Companion reading already in the repo, both accurate and more detailed than this document on the parts
they cover: `docs/superpowers/specs/KERNING-VIEW.md` (the feature's own design/build log — most of what
this plan calls "omitted code" is in fact built, and that document names the exact mechanism) and
`docs/superpowers/specs/KERNING-VIEW-BACKLOG.md`.

---

## 1. Repository state

- `git status --short` at start of this task: only the two new planning documents were untracked
  (`docs/superpowers/plans/2026-09-08-kerning-view-ux.md`,
  `docs/superpowers/specs/Fontra-Kerning-View-UX-Spec.md`). No other pending changes existed; none were
  disturbed.
- Root `CLAUDE.md` is present but empty. The applicable contributor instructions are
  `docs/superpowers/START-HERE.md` (onboarding: read `GLOSSARY.md`, `FEATURE-ARCHITECTURE-MAP.md`,
  `FEATURE-MODEL.md`, `DEVELOPMENT-LOG.md`; branch-only workflow, no worktrees/subagents, `git add .`
  before commit, no back-compat obligation) and `docs/superpowers/specs/KERNING-VIEW.md` (this feature's
  own spec/build log, already substantially implemented — see §3).
- No `AGENTS.md` exists outside `node_modules`.

## 2. Verified paths

The plan's file map (its own text: "proposed targets inferred from imports," not verified) matches the
real fork almost exactly. One path differs:

| Plan's guessed path | Real path | Note |
| --- | --- | --- |
| `src-js/views-kerning/src/kerning.js` | same | confirmed, 5197 lines |
| `src-js/views-kerning/kerning.html` | same | confirmed |
| `src-js/views-kerning/src/edit-tools-select.js` | same | confirmed, 73 lines |
| `src-js/views-kerning/src/start.js` | same | confirmed, 9 lines |
| `src-js/views-kerning/src/autokern-worker.js` | same | confirmed, 172 lines |
| `src-js/views-kerning/src/edit-tools-metrics.js` | **`src-js/views-editor/src/edit-tools-metrics.js`** | Does not live under `views-kerning`. It is imported cross-view from `views-editor`, exactly the pattern `KERNING-VIEW.md` §8 describes ("widen the `views-editor` exports map and import across views"). Holds `MetricsBaseTool`, `SidebearingTool`, `KerningTool`. |
| `src-js/fontra-core/src/kerning-controller.js` | same | confirmed, 629 lines |
| `src-js/fontra-core/src/autokern-cache.js` | same | confirmed, 317 lines |
| `src-js/fontra-core/src/autokern-engine.js` | same | confirmed, 457 lines |
| `src-js/fontra-core/src/glyph-data.js` | same | confirmed, 183 lines |
| (not named by the plan) | `src-js/fontra-core/src/autokern-classes.js` | Exists, 272 lines — composite-inheritance/kern-row-clustering helpers for class derivation. Relevant to F21's median-contributor investigation. |

No module named in the plan is missing. `edit-tools-metrics.js` is real, just not where the plan guessed —
confirms the plan's own warning ("an omitted module is not a missing capability") rather than contradicting it.

## 3. This is not a placeholder feature — it is a built one being redesigned

The plan's language ("supplied only part of the code," "omitted module") describes the *plan-writer's*
information state, not this repository's actual state. `KERNING-VIEW.md` records that autokern (the
halfkern-derived suggestion engine), the per-source OPFS cache, class folding, junk marking, and undo are
already built (its own §10: "Every numbered section above is built"). Task 1 does not need to treat
`autokern-cache.js` / `autokern-engine.js` as unknowns to investigate from scratch — their exports are
enumerated below (§6) and their behavior is documented in `KERNING-VIEW.md` §2–§5. Tasks 15/16's "autokern
placeholder" framing should read as "bind the UX to the real engine, respecting its real semantics,"
not "the calculation code does not exist yet."

## 4. Commands

- **Workspace module type:** `"type": "module"` at every relevant `package.json` (root, `fontra-core`,
  `views-kerning`). Real ES modules throughout, no bundler-only syntax needed for tests.
- **Test command (verified by running it):** `npm test` from the repo root. It runs
  `npm run --workspace src-js test`, which resolves through the workspace globs in the root
  `package.json` to `mocha tests --extension js --extension ts --reporter spec` inside
  `src-js/fontra-core` (the only workspace with a real suite), plus a no-op `echo` for every other
  workspace including `views-kerning` (`src-js/views-kerning/package.json`: `"test": "echo \"No test
  specified for @fontra/views-kerning\""`).
- **Baseline result:** `npm test` — **2518 passing, 0 failing**, all in `fontra-core`'s mocha suite
  (includes `autokern-cache.js`'s and `autokern-classes.js`'s own test files: `pairEnvelopesCanTouch`,
  `pairKey`, `createCache`, `setPairValue`, `markPairJunk`, `markPairOverride`,
  `medianDroppingOutliers`, `markGlyphStale`, `pairsForRerun`, `candidatePairs`,
  `inheritCompositeClasses`, and many more unrelated to kerning). No pre-existing failures were found.
- **The plan's proposed test convention does not match this project.** Its snippets use
  `node --test ...ux-*.test.mjs` (Node's built-in runner). This repo uses **Mocha + Chai**, tests live in
  a `tests/` directory per workspace with `.js`/`.ts` extensions, and `views-kerning` currently has
  **no `tests/` directory and no working `test` script at all**. Any test files this plan's later tasks
  add under `src-js/views-kerning/tests/` must (a) use Mocha/Chai's `describe`/`it`/`chai.expect`
  convention to match `fontra-core`'s existing suite, and (b) replace `views-kerning/package.json`'s
  `test` script with a real `mocha tests --extension js --reporter spec` invocation (mirroring
  `fontra-core`'s), or the new tests will never run under `npm test`. This is a real gap, not a style
  preference — the current script silently reports "no test specified" and exits 0.
- **Dev-server command:** no root `dev`/`start`/`serve` npm script exists. The actual dev workflow (per
  `README.md` and `docs/superpowers/START-HERE.md`) is a Python server: `fontra --dev --launch
  filesystem /path/to/a/folder`, with `npm run bundle-watch` (webpack `--watch`, defined in root
  `package.json`) running alongside for the JS bundle. Per this project's own convention (`START-HERE.md`),
  the user runs `bundle-watch` themselves in the background; workers should not start it.
- **Packaging:** the kerning view is already registered — `pyproject.toml`
  `[project.entry-points."fontra.views"]` has `kerning = "fontra.client"` alongside the other four views,
  and `src-js/views-kerning/package.json` already declares `"fontra": {"view": "kerning"}` and its
  `exports` map. No fontra-pak change is needed for anything in this plan.

## 5. Rule provenance, deletion, undo, active source, and change notification — exact mechanisms

All claims below are grounded in reading `src-js/fontra-core/src/kerning-controller.js` and
`src-js/views-kerning/src/kerning.js` directly; file:line references are to the commit above.

### 5.1 Rule absence vs. a stored zero

`KerningController.getPairValueForSource(leftName, rightName, sourceIdentifier)`
(`kerning-controller.js:99-117`) is the exact-address (not cascade-resolved) read, and its own docstring
states the distinction precisely:

- returns **`undefined`** — no kerning data exists for this literal pair at all.
- returns **`null`** — kerning data exists for this pair, but this specific source's value is null
  (sparse).
- returns a **number** (including `0`) — an explicit value is stored for this pair at this source.

`getPairValues(leftName, rightName)` (`kerning-controller.js:119-121`) returns
`this.kernData.values[leftName]?.[rightName]` — `undefined` if the pair has no entry at all, an array
otherwise. This is the correct primitive for "does an explicit pair rule exist," addressed by literal
name (glyph or `@Class`), independent of which value it currently holds.

**This is not what the view currently uses to decide provenance.** `kerning.js`'s
`wouldShadowClassCell(left, right)` (`kerning.js:1822-1829`) is explicitly documented in its own comment
as "a conservative, honestly-approximate detector, not the override-transparency feature" — it treats
"either side is classed AND the resolved cascade value is nonzero" as evidence a class cell is currently
answering. It cannot distinguish an explicit stored zero from "nothing stored, cascade fell through to
0." This is a confirmed, in-code-acknowledged limitation, exactly the gap Task 2 (`explicitPairExists`)
must close by switching to `getPairValueForSource`/`getPairValues` at the literal address instead.

### 5.2 How an explicit rule is deleted (vs. writing zero)

`KerningEditContext.delete(undoLabel)` (`kerning-controller.js:566-589`) performs real deletion:
`delete values[leftName][rightName]`, and removes the now-empty `values[leftName]` object too. This
restores inheritance by removing the key, never by writing a zero. It calls
`fontController.editFinal(changes.change, changes.rollbackChange, undoLabel, true)` — note the trailing
`true`, versus `editContinuous`'s trailing `false` at the equivalent call (`kerning-controller.js:556-561`);
the exact meaning of that fourth argument was not traced further (out of scope for a non-behavior task)
but the two call sites are visibly not identical and a later task should read `fontController.editFinal`
before assuming they're interchangeable.

**`KerningEditContext.delete()` has zero current callers in `kerning.js`.** Grepping the whole file for
`.delete(` finds none. The only writes performed by `kerning.js` today are `writePairValues`
(`kerning.js:3812`, always writes a number, including 0) and `applyFoldedParentRow`
(`kerning.js:2365`, writes a class-cell median). Task 10 ("remove explicit pair") will be the *first*
caller of this existing method, not a modification of existing removal logic — there is no removal UI
today at all.

### 5.3 How edits expose undo data

Confirmed exactly as `docs/superpowers/specs/KERNING-VIEW.md`'s own "Open" section already documents
(that document's account was re-verified against source, not just trusted): kerning writes touch the
font's `kerning` root key, not a single glyph, so they cannot use `fontController`'s per-glyph
`undoStacks`. `KerningViewController` therefore owns its own font-level stack,
`this.autokernUndoStack = new UndoStack()` (`kerning.js:382`). `writePairValues` captures the
`{change, rollbackChange}` that `kerningController.getEditContext(...).edit(...)` already returns (that
call internally invokes `fontController.editFinal`) and pushes it onto `autokernUndoStack`
(`kerning.js:3863-3874`). `doAutokernUndoRedo` (`kerning.js:5061`) pops and replays it. Class-derivation
accepts (`acceptDeriveProposal`) push a differently-shaped record (before/after group names) because
`editGroupSide1`/`editGroupSide2` don't return a capturable `{change, rollbackChange}`. A pair *deletion*
via `KerningEditContext.delete()` has no existing undo-push call site to imitate — Task 10 must add one,
following the same `{change, rollbackChange, info: {label, kind}}` shape `writePairValues` already uses.

### 5.4 Active source and location

There is a real source selector: `#kerning-status-source-select`
(`initAutokernStatusSection`, `kerning.js:3466-3498`), populated from
`fontController.getSortedSourceIdentifiers()`, stored in `this._autokernSourceIdentifier` (getter
`autokernSource`, `kerning.js:853-854`). Changing it does two confirmed things: (a) updates
`this.sceneSettingsController`'s `fontLocationSourceMapped`, so the **left-pane scene preview** redraws
for the chosen source, and (b) reloads `this.autokernCache` from that source's own OPFS file via
`loadAutokernCacheFromStorage`, so the **Proposed column** reflects the chosen source (`KERNING-VIEW.md`
§4.1's "per source, and it is stored" is real and verified).

**Confirmed inconsistency, not a guess:** `writePairValues` (`kerning.js:3816-3820`) and
`applyFoldedParentRow` (`kerning.js:2366-2370`) both resolve the write target via
`this.fontController.fontSourcesInstancer.getSourceIdentifierForLocation({}, false)` — an empty location
object, not `this._autokernSourceIdentifier`. Reading `FontSourcesInstancer.getSourceIdentifierForLocation`
(`font-sources-instancer.js:37-46`) confirms `{}` always merges with `defaultSourceLocation`
(`font-sources-instancer.js:38`), so this call **always resolves to the font's default source**,
regardless of which source is selected in the status strip. The same `{}`-location call is also what
every "Current" read goes through (`wouldShadowClassCell`, `pairRowData`'s current column, etc., via
`getGlyphPairValueForLocation(left, right, {})`). Net effect: switching the source selector changes what
the scene draws and which Proposed values are shown, but **Current always reads the default source, and
Apply/Reset always writes the default source**, no matter which source is selected. This directly
contradicts the spec's own invariant ("Respect the active font/source consistently across the preview,
displayed values, and action targets," F26) and `KERNING-VIEW.md` §4.1 ("where an apply writes" is framed
as governed by the source selector). This is a real defect for a later task (most naturally Task 12, which
already owns "preserve active-source consistency") to fix — not something to silently work around while
building on top of it.

### 5.5 Kerning-change notifications

`KerningController`'s own constructor (`kerning-controller.js:12-35`) subscribes to
`fontController.addChangeListener` for `{kerning: {[wildcard]: {sourceIdentifiers: null}}}` (clears its
internal pair-function cache) and `{kerning: {[wildcard]: {values: null}}}` (clears the specific pair's
cache entry, via `getKernPairsFromChange`). These exist and work at the controller level.

**`kerning.js` itself does not subscribe to either.** The only `addChangeListener` call in the whole file
is for `{glyphMap: null}` (`kerning.js:4372`, unrelated to kerning values — used for font-mode glyph
tiles). The pair table is refreshed only by explicit local calls to `renderPairTable()` after actions this
view itself performs (`writePairValues`, `applyFoldedParentRow`, undo/redo, a cache reload). An external
kerning edit — another open tab, or (untraced, but plausible) `KerningTool`'s own preview-drag edits in
this same view's left pane — would not visibly update the table today unless some other code path already
happens to call `renderPairTable()`. This is exactly Task 12/F26's subject, and it currently does not
exist as a subscription; Task 12 is adding it, not modifying it.

## 6. Autokern module exports (verified, for Tasks 15/16's binding, not investigated further here)

`src-js/fontra-core/src/autokern-cache.js`: `pairEnvelopesCanTouch`, `pairKey`, `createCache`,
`setPairValue`, `markPairJunk`, `markPairOverride`, `medianDroppingOutliers`, `markGlyphStale`,
`pairsForRerun`, `candidatePairs`.

`src-js/fontra-core/src/autokern-classes.js`: `inheritCompositeClasses`, `deriveKernRowClusters`,
`classSpread`.

`kerning.js` itself already implements class-summary aggregation logic the plan's Task 16 assumes is
missing: `wouldShadowClassCell`, `describeShadowedClassCell`, `overrideDivergence`,
`isOverrideCandidate` (`kerning.js:1822-1876`), and a full per-fold-group stats function,
`computeFoldGroupStats` (referenced in `KERNING-VIEW.md`'s dev log, not re-quoted here), which reads the
class×class product from the whole cache rather than only rows touching the currently typed glyph. Tasks
15/16 should read these before writing new aggregate logic — the risk named in the plan ("no algorithm ...
may fill an autokern placeholder") cuts the other way here too: duplicating an existing, working median
function would itself be an invented parallel path.

## 7. Unicode/category data actually available (for the F09/F14 decisions below)

`src-js/fontra-core/src/glyph-data.js` loads `assets/data/glyph-data.csv` (GlyphsApp's `GlyphData.xml`,
converted). Confirmed CSV columns: `unicode;name;category;subCategory;case;direction;script;description;
production`. Confirmed value sets (scanned the actual file):

- `category`: `Letter`, `Mark`, `Number`, `Punctuation`, `Separator`, `Symbol`.
- `case`: `lower`, `minor`, `smallCaps`, `upper` (blank for uncased glyphs — digits, CJK, etc.).
- `subCategory` includes `Nonspacing` and `Spacing Combining` under `Mark` — the actual field for
  "combining diacritic."

`getCodePointFromGlyphName(glyphName)` (`glyph-data.js:85-108`) is the existing lookup; a glyph with no
`unicode` field and no recognized `uniXXXX`/`uXXXXXX` name pattern returns `null` — this is the correct,
existing primitive for "non-Unicode," no new detection logic is needed.

---

## 8. Decision ledger — spec §12.2 open decisions

Every entry below is a **PROPOSED default only. None of these is approved by the designer yet.** They
are grounded in the spec's own "Recommended detail" text where one exists, and in the concrete data
schema found in §7 above. A later task must get explicit designer sign-off before treating any of these
as settled; nothing here overrides a decision the spec itself already marks Must/settled.

### 8.1 Pair-input grammar and class-row expansion into preview pairs (F04, F06, F22)

**Proposed:** the Pair input accepts a comma-separated list of pair-tokens. Each pair-token is exactly two
space-separated glyph-tokens (literal character, `/glyphname`, `@ClassName`, or `%glyphname%!`), e.g.
`A V, /Adieresis /W, @A @V`. No adjacent-character-string expansion (do not read `AVW` as the pairs
`A-V`, `V-W`) — the spec explicitly flags this as unresolved and unresolved ambiguity should fail loud,
not guess; a bare multi-character run with no separator is an inline error, not a silent adjacent-pair
guess. A highlighted class-summary row expands to the full cross-product of both sides' class membership,
capped at 50 pairs (matching the existing `truncateGlyphList` display convention already used for class
member lists) with the remainder disclosed as a count, not silently dropped.

### 8.2 Explicit non-Unicode name request vs. the unchecked inclusion filter (F09, F22)

**Proposed:** adopt the spec's own stated default verbatim — retain the filter. An explicit `/glyphname`
or `%glyphname%!` request for a glyph with no Unicode assignment is still excluded by an unchecked
"Non-Unicode glyphs" filter, and the UI names the exact reason ("excluded by the Non-Unicode filter") next
to the input rather than a silent empty result.

### 8.3 Unicode category coverage, pair-side matching, mixed-class matching (F09)

**Proposed**, using the confirmed CSV fields (§7):

- Uppercase = `case === "upper"` (also count `smallCaps` as uppercase — visually cased-upper).
  Lowercase = `case === "lower"`.
- Punctuation = `category === "Punctuation"`. Symbols = `category === "Symbol"`.
- Combining diacritics = `category === "Mark"` (regardless of `subCategory`, so both `Nonspacing` and
  `Spacing Combining` marks are covered by one checkbox, matching the spec's six-item list which does not
  split marks further).
- **Gap not covered by the spec's six-item list:** `Number` (digits) and any glyph with blank `case`
  (CJK, uncased scripts) have no home in Uppercase/Lowercase/Punctuation/Symbols/Marks/Non-Unicode. Do
  not silently fold Numbers into Symbols — flag this to the designer explicitly as a seventh item the
  spec's dropdown needs, or an accepted "falls through every filter" behavior, before Task 9 builds the
  dropdown.
- Pair-side matching: a pair matches a checked category if the glyph on the side named by the Side filter
  matches it, or (when Side = All) if *either* side matches — mirroring the spec's own resolution of
  Class-to-unique matching "either orientation."
- Mixed-category class summary: a class-summary row matches a checked category if *any* member belongs to
  it (inclusive), so a class is never hidden from review because one atypical member's category differs
  from the rest.

### 8.4 Glyphset matching, empty multi-select semantics, exposed-member relationship filtering (F14)

**Proposed:**

- A flat/exception pair row matches a selected table glyphset only if *both* glyphs are members of it.
- A class-summary row matches a selected glyphset if the class contains *any* member of it (consistent
  with the mixed-category rule above, so switching glyphsets doesn't make classes disappear entirely).
- An empty multi-select (zero categories or zero relationships checked) shows an explicit "nothing
  selected" empty state, distinct from "all," rather than silently defaulting back to showing everything.
- An exposed member with no saved exception is classified into the same relationship bucket as its class
  pairing (Class-to-class / Class-to-unique), not into "Class exceptions" — that bucket is reserved for
  rows where `explicitPairExists` (§5.1) is true.

### 8.5 Hiding scope for class-summary rows (F10)

**Proposed:** hiding a class-summary row hides only that displayed aggregate row. It never cascades to
its exposed members or saved exceptions — each row's visibility is tracked by its own stable identity
(Task 2), and the spec's instruction not to silently cascade is taken at face value.

### 8.6 Final analytics metrics (F03)

**Proposed:** adopt the spec's own recommended initial set verbatim — stale glyphs, saved pair
exceptions, potential exceptions, hidden results — each labeled with its exact scope (active source vs.
filtered vs. all). No invented quality/confidence score, per the spec's explicit prohibition.

---

## 9. Summary for Tasks 2–19

- Bind `explicitPairExists`/provenance reads to `getPairValueForSource`/`getPairValues`
  (`kerning-controller.js:99-121`), not `wouldShadowClassCell`.
- Bind exception removal to `KerningEditContext.delete(undoLabel)` (`kerning-controller.js:566`) — first
  caller, following `writePairValues`'s existing undo-push pattern.
- Fix (Task 12, most likely) the confirmed default-source-vs-selected-source mismatch (§5.4) before or
  while implementing "preserve active-source consistency" — it is not new work the plan invents, it is an
  existing bug the plan's own invariant already requires fixing.
- Add a `{kerning: ...}` change subscription in `kerning.js` (Task 12) — none exists today (§5.5).
- Add a real `tests/` directory and Mocha `test` script to `src-js/views-kerning/package.json` before any
  focused test file is written; the plan's Node-runner snippets need translating to Mocha/Chai syntax to
  actually run under `npm test`.
- Tasks 15/16 should read `autokern-cache.js`, `autokern-classes.js`, and `kerning.js`'s own
  `wouldShadowClassCell`/`overrideDivergence`/`isOverrideCandidate`/`computeFoldGroupStats` before writing
  any new aggregation code (§6) — most of what those tasks call "investigation" is already built and
  documented in `KERNING-VIEW.md`.
