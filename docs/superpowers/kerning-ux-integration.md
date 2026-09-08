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

### 8.1 Pair-input grammar and class-row expansion into preview pairs (F04, F06, F22) — APPROVED, corrected 2026-09-08

**Original framing in this section was wrong** — corrected by the designer directly, not a proposed
default. The Pair input does **not** hold pair-tokens at all. It holds a **comma-separated list of single
glyph-tokens** (literal character, `/glyphname`, `@ClassName`, or `%glyphname%!`) — the *other side* of
the pair. The actual preview pairs are the cross-product of the Glyph input's token(s) against the Pair
input's token(s): each Glyph-input token paired with each Pair-input token. E.g. Glyph = `A`, Pair =
`V, /Adieresis` produces the two pairs `A×V` and `A×Adieresis`. This is why the two inputs are named
"Glyph" and "Pair" rather than "Left"/"Right" — Pair only makes sense relative to whatever is in Glyph.
**Glyph input also holds a comma-separated list, not one token** — this follows directly from F07's own
Shift+Ctrl+Click append behavior (`appendGlyphToken`, comma-separated), which only makes sense if Glyph
already supports multiple entries. So the real relationship is many-to-many: every Glyph-input token
cross-produced against every Pair-input token.
A highlighted class-summary row still expands to the full cross-product of both sides' class membership,
capped at 50 pairs (matching the existing `truncateGlyphList` display convention) with the remainder
disclosed as a count, not silently dropped — that part of the original proposal stands.

### 8.2 Explicit non-Unicode name request vs. the unchecked inclusion filter (F09, F22) — APPROVED, corrected 2026-09-08

**Decided, not the originally proposed default.** The Non-Unicode filter governs the **results table**
only. It does **not** govern the **pair preview**. A non-Unicode glyph named explicitly (`/glyphname` or
`%glyphname%!`) still shows in the on-canvas pair preview whenever it actually forms a real pair — i.e.
whenever it's placed in Glyph or Pair input with the other input non-empty — regardless of the table
filter's state. It stays hidden from the results **table** while the filter is unchecked, same as before.
Table row visibility and preview eligibility are two separate gates; the filter only ever controls the
former.

### 8.3 Unicode category coverage, pair-side matching, mixed-class matching (F09) — APPROVED, Numbers added 2026-09-08

**Decided:** Numbers gets its own explicit category in the dropdown — the gap flagged below is real and
is now closed, not left open. Everything else in this section stands as proposed, using the confirmed CSV
fields (§7):

- Uppercase = `case === "upper"` (also count `smallCaps` as uppercase — visually cased-upper).
  Lowercase = `case === "lower"`.
- Punctuation = `category === "Punctuation"`. Symbols = `category === "Symbol"`.
- Combining diacritics = `category === "Mark"` (regardless of `subCategory`, so both `Nonspacing` and
  `Spacing Combining` marks are covered by one checkbox, matching the spec's six-item list which does not
  split marks further).
- **Numbers = `category === "Number"`, its own checkbox, seventh dropdown item** (approved). Any glyph
  with blank `case` and no other matching category (CJK, other uncased scripts not covered above) still
  has no home — not decided here, flag again if it becomes a real font's problem in practice.
- Pair-side matching: a pair matches a checked category if the glyph on the side named by the Side filter
  matches it, or (when Side = All) if *either* side matches — mirroring the spec's own resolution of
  Class-to-unique matching "either orientation."
- Mixed-category class summary: a class-summary row matches a checked category if *any* member belongs to
  it (inclusive), so a class is never hidden from review because one atypical member's category differs
  from the rest.

### 8.4 Glyphset matching, empty multi-select semantics, exposed-member relationship filtering (F14) — APPROVED, corrected 2026-09-08

**Decided, uniform "any" rule (not "both" for pair rows as originally proposed):**

- A flat/exception pair row matches a selected table glyphset if *either* of its two glyphs is a member
  of it.
- A class-summary row matches a selected glyphset if *any single member* of the class is a member of it.
- Same rule both times — a row matches if at least one glyph involved (either side of a pair, or any
  member of a class) belongs to the selected glyphset.
- An empty multi-select (zero categories or zero relationships checked) shows an explicit "nothing
  selected" empty state, distinct from "all," rather than silently defaulting back to showing everything.
- An exposed member with no saved exception is classified into the same relationship bucket as its class
  pairing (Class-to-class / Class-to-unique), not into "Class exceptions" — that bucket is reserved for
  rows where `explicitPairExists` (§5.1) is true.

### 8.5 Hiding scope for class-summary rows (F10) — APPROVED 2026-09-08

Hiding a class-summary row hides only that displayed aggregate row. It never cascades to its exposed
members or saved exceptions — each row's visibility is tracked by its own stable identity (Task 2).

### 8.6 Final analytics metrics (F03) — APPROVED 2026-09-08

Stale glyphs, saved pair exceptions, potential exceptions, hidden results — each labeled with its exact
scope (active source vs. filtered vs. all). No invented quality/confidence score.

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

---

## 10. Task 15 — Freshness and scoped-rerun contract (F01, F02, F23)

**Date:** 2026-09-09. **Branch:** `feature/kerning-view`. **Commit at time of writing:**
`4663b22ff55eba6b9a69d7a61c6ce88cd88c8409`. This section is Task 15 of the same plan. It appends to,
and does not overwrite, §1–§9 above. All commits Tasks 2–14 made since Task 1 was written were read
(`git log --oneline main..HEAD`); none touch `autokern-worker.js` or `autokern-cache.js`'s stale
primitives — the code traced below is exactly what §6 already enumerated, now traced line-by-line rather
than only listed.

### 10.1 The mechanism, exactly as it exists today

- `markGlyphStale(cache, glyphName)` (`autokern-cache.js:225-233`): marks every cache entry with
  `glyphName` on either side `stale: true`. Pure, returns a new Map, never deletes a row. A junk pair is
  not exempt (junk and stale are independent flags, same file, comment at 221-224).
- `pairsForRerun(cache, mode, candidatePairsList)` (`autokern-cache.js:253-287`): mode `"marked"` returns
  every non-junk entry with `stale: true`, reading **only the cache's own stored entries** — it never
  looks at `candidatePairsList` in this mode (`autokern-cache.js:254-263`). Mode `"everything"` returns
  every non-junk cached entry, plus (only if a candidate list is supplied) any brand-new pair from that
  list not already in the cache (`264-287`).
- `setPairValue` (`autokern-cache.js:128-144`) is what clears `stale` — a fresh measurement is
  definitionally not stale (comment at 114-116). A pair is never un-staled any other way.
- `autokern-worker.js`'s `runJob` (`autokern-worker.js:74-155`) already fully respects `job.mode`: line
  123 calls `pairsForRerun(cache, mode, candidates)` directly, unmodified, and loops only over whatever
  that returns. **Mode `"marked"` is not a placeholder — it is live, correct code, already exercised by
  this task's own reproduction test (§10.3).**
- `markGlyphStale` **does have a real caller today**: `kerning.js`'s `markGlyphsStaleForClassEdit`
  (`kerning.js:3630-3635`), invoked from `addGlyphsToClass` (`kerning.js:3604-3618`) whenever a glyph
  joins/leaves a class. Its own comment (`kerning.js:3620-3629`) states plainly that nothing else in this
  view calls it — no outline-edit change-listener wires it yet, confirmed by grep, matching
  `KERNING-VIEW.md` §4's own "the font controller's change listener names the glyph that changed" being
  the intended trigger, not yet built.
- **`pairsForRerun` has zero callers in `kerning.js`.** `runAutokern()` (`kerning.js:1101-1217`) hardcodes
  `const mode = "everything";` at line 1198 and never reads or writes `"marked"` anywhere — grepped the
  whole file for the literal string `"marked"`, zero matches. There is no UI entry point, button, or
  method anywhere in `kerning.js` that requests a scoped rerun. `no autokern-view-adapter.js file exists
  in the repo at all` (confirmed by glob/grep, both empty).

### 10.2 What "successful partial completion" means today — it doesn't exist yet

- Progress: `postMessage({type:"progress", source, done, total})` (`autokern-worker.js:144-146`), every 25
  pairs and on the last one. `done`/`total` count **pairs**, not glyphs, and there is no `unit` field —
  the plan's guessed `onProgress({completed, total, unit})` shape does not match; the real shape is
  `{done, total, source}` with the unit implicit (always pairs).
- Completion: `postMessage({type:"done", source, cache, calibration})` (`autokern-worker.js:149-154`) sends
  the **entire** resulting cache (every entry, not just the ones this job ran) — there is no
  `completedGlyphs`/`remainingGlyphs` breakdown anywhere in the message.
- Cancellation: `if (cancelled) { postMessage({type:"cancelled", source}); return; }`
  (`autokern-worker.js:127-130`) discards the in-progress `cache` variable entirely — **every pair already
  remeasured in that run before the cancel is thrown away**, not persisted. `kerning.js`'s handler for
  `"cancelled"` (`kerning.js:1265-1266`) does nothing but resolve the promise; `this.autokernCache` is
  never touched, so a cancelled run correctly leaves prior state exactly as it was (satisfies F02's "must
  not label unprocessed results fresh" by construction, since nothing is written) — but it also means
  cancellation has no partial-credit concept at all: a run cancelled at 99% redoes 99% of the work next
  time.
- **Missing-raster silent skip, confirmed by this task's own reproduction test (§10.3, second case):** the
  worker's per-pair loop (`autokern-worker.js:126-147`) does `if (!leftRaster || !rightRaster) continue;`
  (134-139) with no error, no count, no signal of any kind — a pair whose raster wasn't supplied is simply
  never measured, and the run still ends by posting `"done"`. If a caller built a job's `rasters`/`envelopes`
  covering only the glyph that was marked stale (the literal shortcut the plan's own text warns against:
  "not an inferred shortcut such as restricting both sides to the stale set"), every stale pair whose OTHER
  side lacks a raster is **silently left `stale: true` forever**, in a run that self-reports success. This
  is not hypothetical — the second reproduction test below demonstrates it against the real,
  unmodified worker file.
- **No `completedGlyphs`/`remainingGlyphs` result shape exists anywhere in the current worker or
  `kerning.js`.** Building the plan's proposed `runStale(...) -> Promise<{completedGlyphs, remainingGlyphs}>`
  return value requires new code (deriving which glyph names the recomputed pairs actually cover, and
  which stale pairs — if any, e.g. from a raster that failed to build — remain stale after the run). This
  does not require new WORKER code (the worker already reports the full resulting cache, from which
  completed/remaining can be derived on the main thread by diffing `stale` flags before and after), but it
  does require new `kerning.js`/adapter code that does not exist today.

### 10.3 Reproduction test — real `autokern-worker.js`, unmodified

`src-js/views-kerning/tests/test-stale-rerun.js` (new file, this task). Drives the actual
`autokern-worker.js` module through its real `onmessage`/`postMessage` protocol (predefining those two
globals before a dynamic `import()`, since the file's top-level `onmessage = ...` assumes a Worker
context and throws under plain Node/mocha otherwise — confirmed by a throwaway `node --input-type=module`
repro before writing the test). No worker code was modified.

Two cases, three glyphs (`l`, `n`, `o` — reused as autokern's own control glyphs, so one raster fixture
serves calibration and the pairs under test):

1. **Full partner coverage.** Seed a 3×3 cache (all fresh), `markGlyphStale(cache, "n")` (marks the 5
   entries touching `n`), run `mode: "marked"` with rasters/envelopes for **all three** glyphs. Result:
   exactly those 5 entries come back `stale: false` (recomputed); the 4 entries never touching `n`
   (`l×l`, `l×o`, `o×l`, `o×o`) are untouched (still the seeded value `999`). **Confirms `"marked"` mode
   is correct when given full partner coverage.**
2. **Restricted-to-the-marked-glyph coverage** (the shortcut the plan warns against). Same seed, same
   `markGlyphStale(cache, "n")`, but `rasters`/`envelopes` supplied for `"n"` only. Result: the worker
   still reports `"done"` (no error), and the 4 pairs needing a partner raster (`l×n`, `n×l`, `n×o`,
   `o×n`) come back **still `stale: true`** — silently unresolved. **Confirms the missing-raster silent
   skip in §10.2 against real code, not inference.**

Run (`npx mocha tests/test-stale-rerun.js --extension js --reporter spec` from
`src-js/views-kerning`, and `npm test` from repo root):

```
Task 15: stale-glyph scoped rerun, real autokern-worker.js
  ✔ mode 'marked' recomputes only pairs touching the stale glyph, when rasters cover BOTH sides of every stale pair
  ✔ mode 'marked' with rasters restricted to ONLY the marked glyph silently leaves its stale pairs unresolved -- confirms the plan's warned-against shortcut is unsafe

2 passing (7ms)
```

Full-repo `npm test` after adding this file: **2608 passing, 0 failing** (2518 in `fontra-core` + 90 in
`views-kerning`, up from the 88 recorded in §4 before this task's 2 new tests).

### 10.4 Class membership and aggregate (class-summary row) staleness — confirmed open, not answered

- A glyph joining/leaving a class already marks it stale via the real caller in §10.1 — class-membership
  change is handled today, for the glyph itself.
- **Required pair coverage for a correct rerun is "every pair with the stale glyph on either side," not
  "only pairs against other members of its own class."** `markGlyphStale` marks by literal glyph identity
  on either side of the flat cache (`autokern-cache.js:225-233`) — the cache has no concept of class
  membership at all (§4's own header comment: "never by a class"). A stale glyph's rerun scope is exactly
  `pairsForRerun(cache, "marked")`'s output; no class-aware narrowing or widening exists or is implied by
  any code read for this task.
- **Aggregate (class-summary row) staleness is not computed anywhere.** `computeFoldGroupStats`
  (`kerning.js:2903-2937`) collects every cache entry whose `left`/`right` fall inside the two classes and
  folds them into a median (`entries.map((entry) => ({ value: entry.value, divergence: ... }))`,
  `kerning.js:2926-2932`) — it reads `entry.value` but **never reads `entry.stale`**. A class-summary row
  whose contributors include a stale pair shows a median computed as if every contributor were current,
  with no warning. This is F23's own open investigation question ("determine when a class-summary
  suggestion becomes stale because of its contributors") and it is **not decided by any existing code** —
  whether "any contributor stale" or "all contributors stale" (or some threshold) should trigger the `!`
  on a class-summary row is a real open decision for whoever builds Task 17's F23 display, not something
  this investigation found already answered.

### 10.5 Source ownership — confirmed gap, already named by the plan for Task 17

`runAutokernWorker`'s `"done"` handler (`kerning.js:1249-1264`) applies `data.cache` to
`this.autokernCache` unconditionally — it never checks `data.source === this.autokernSource` first. If the
source selector (§5.4) is changed while a run for the previous source is still in flight, that run's
result silently overwrites the cache now displayed for the newly selected source. This is not a new
finding invented here — it is exactly the item the plan's own Task 17 checklist already names ("reject
results belonging to another active source," plan line 585) — recorded here only because "which source
owns staleness" was this task's explicit question. Not fixed in this task, per Task 15's own scope.

### 10.6 The UI-facing contract, adjusted to what real code supports

```text
getStaleGlyphs(sourceId) -> string[]           // NEW code, thin: derive from
                                                // pairsForRerun(cache, "marked") by
                                                // collecting left/right names into a
                                                // Set, ordered however the caller wants
                                                // (no ordering primitive exists today).

runStale({ sourceId, glyphNames, signal, onProgress })
  -> Promise<{ completedGlyphs: string[], remainingGlyphs: string[] }>
                                                // NEW code: build a job exactly like
                                                // runAutokern() does (kerning.js:1101-1217)
                                                // but with mode: "marked" instead of the
                                                // hardcoded "everything", and rasters/
                                                // envelopes covering every glyph that
                                                // appears on EITHER side of ANY stale pair
                                                // (not just `glyphNames` itself -- §10.2's
                                                // silent-skip finding is exactly what
                                                // happens if this is gotten wrong).
                                                // completedGlyphs/remainingGlyphs must be
                                                // derived on the main thread by diffing
                                                // `stale` flags before/after -- the worker
                                                // itself reports no such breakdown (§10.2).
                                                // `signal` (cancellation) has no existing
                                                // hookup point beyond the worker's own
                                                // {type:"cancel"} postMessage
                                                // (kerning.js:1293), which already exists
                                                // and already discards in-flight work
                                                // cleanly (§10.2) -- reusable as-is.

onProgress({ done, total, source })            // ADJUSTED shape, not the plan's guess:
                                                // real worker messages are
                                                // {type:"progress", source, done, total} --
                                                // no `unit` field, `done` not `completed`,
                                                // pair counts not glyph counts
                                                // (autokern-worker.js:144-146).
```

### 10.7 Status: blocked, not ready for Task 17 to bind directly

**Ready:** the cache-layer primitives (`markGlyphStale`, `pairsForRerun` mode `"marked"`) and the worker's
mode dispatch are correct, tested (both by the pre-existing `test-autokern-cache.js` suite and by this
task's new `test-stale-rerun.js`), and need no changes.

**Blocked on new code Task 17 must write (not a worker/cache change — a `kerning.js`/adapter change),
listed so Task 17 does not have to re-derive it:**

1. No caller anywhere requests mode `"marked"` — Task 17 is the first. It must build the job's
   `rasters`/`envelopes` from the full set of glyphs touching any currently-stale pair, not from the
   glyph(s) the designer marked/edited — §10.2's reproduction proves the silent-skip failure mode if this
   is gotten wrong.
2. `getStaleGlyphs`/`runStale`'s `completedGlyphs`/`remainingGlyphs` return shape must be computed on the
   main thread (diff `stale` flags before/after) — the worker does not provide it.
3. The source-ownership check named in §10.5 (already on the plan's own Task 17 checklist) must guard the
   `"done"` handler before any stale-rerun result is applied, or a source switch mid-run corrupts the
   cache silently.
4. Aggregate/class-summary staleness (§10.4, F23's open question) has no existing answer and must be
   designed, not assumed, before a class-summary row's `!` can be shown correctly.

This task did **not** write any of items 1–4 — per its own scope (investigation + contract only; building
the rerun action is Task 17's job, and any of 1–4 would be exactly that). The two commits from this task
are the reproduction test and this ledger section.

---

## 11. Task 16 — Aggregate proposals and potential exceptions (F18, F19, F21)

**Date:** 2026-09-09. **Branch:** `feature/kerning-view`. **Commit at time of writing:**
`3b8ce8fc466d0172d83254213f9cc6b469b4d153`. This section is Task 16 of the same plan. It appends to,
and does not overwrite, §1–§10 above. This task's own question: **which suggestions contribute to a
class median, and what baseline determines an out-of-tolerance candidate?**

### 11.1 The mechanism, exactly as it exists today — confirmed already built, already wired

§6 already named `computeFoldGroupStats`, `overrideDivergence`, `isOverrideCandidate`,
`wouldShadowClassCell`, and `medianDroppingOutliers`. This section traces them line-by-line and confirms
they are not a stub: `buildClassClassGroups` (`kerning.js:2774-2841`, Task 8) already calls
`computeFoldGroupStats` for every class×class row in **both** table tabs, and `rowVisibleInPotential`
(`results-model.js:90-92`, Task 8) already gates the Potential tab on `isOverrideCandidate`'s own output.
There is no separate "candidate calculation" left to build — Tasks 8/9 already bound the real functions to
both tabs.

- `isLeftClassed`/`isRightClassed` (`kerning.js:2285-2291`): whether a glyph name is a key in
  `kerningController.leftPairGroupMapping`/`rightPairGroupMapping`.
- `wouldShadowClassCell(left, right)` (`kerning.js:2325-2330`): false if neither side is classed;
  otherwise true **only when no literal rule already exists** for this exact pair
  (`kerningController.getPairValues(left, right) === undefined`). A pair with any explicit stored value —
  including a saved exception, including an explicit zero — returns false here.
- `overrideDivergence(left, right, suggestedValue)` (`kerning.js:2358-2366`): `suggestedValue -
  (kerningController.getGlyphPairValueForSource(left, right, this.autokernSource) ?? 0)`. The baseline is
  **always the pair's own current, cascade-resolved value at the active source** — for a pair with a saved
  exception, that cascade resolution (`getGlyphPairValueForSource`, `kerning-controller.js:233-251`,
  most-specific-first) returns the **exception's own stored value**, not the class value. **This answers
  F18/F19's "current versus proposed class baseline" question directly: there is no "proposed class
  baseline" concept anywhere in this code. The comparison is always against the pair's own current
  effective value, exactly the way an ordinary row's Delta is computed** — `overrideDivergence` and
  `pairRowData`'s `delta` read the identical cascade call, just named separately (kerning.js:2348-2354's own
  comment already says so).
- `isOverrideCandidate(left, right, suggestedValue)` (`kerning.js:2374-2382`): `wouldShadowClassCell(left,
  right) && Math.abs(overrideDivergence(...)) >= groupThreshold`. `groupThreshold` is a single existing,
  real, already-wired UI control (`#kerning-param-group-threshold`, `kerning.html:587-591`, default `10`,
  `autokernParamsController.model.groupThreshold`) — this is the same value spec F18 calls "Class
  tolerance" (its label currently reads "Group threshold," a copy-only mismatch, not a missing feature —
  Task 17's job to rename, not build).
- `computeFoldGroupStats(group, groupThreshold)` (`kerning.js:2903-2937`): collects every entry in
  `this.autokernCache` (the **whole** cache, not merely rows currently displayed) whose `left` is a member
  of `group.leftClassName` and `right` a member of `group.rightClassName`, then calls
  `medianDroppingOutliers` (`autokern-cache.js:206-214`) on `{value, divergence: overrideDivergence(...)}`
  for every one of those entries. **No filter in this loop reads `entry.junk` or `entry.stale` at all** —
  confirmed by reading the loop body (`kerning.js:2910-2915`), not inferred.
- `medianDroppingOutliers(samples, groupThreshold)` (`autokern-cache.js:206-214`): drops any sample whose
  `|divergence| >= groupThreshold`; if that leaves zero inliers, falls back to the **unfiltered** median of
  every sample rather than producing `NaN`. The median itself (`(sorted[mid-1] + sorted[mid]) / 2` for an
  even count) is a **plain arithmetic average of the two middle values — no rounding is applied anywhere in
  this function or in `computeFoldGroupStats`.** Rounding happens only once, later, at write time:
  `applyFoldedParentRow` (`kerning.js:3126-3145`) calls `editContext.edit([Math.round(median)], ...)` —
  the on-screen aggregate Proposed value (`kerning.js:2559`, `row.delta = median`, displayed via
  `.toFixed(1)`) can therefore show a value like `-80.5` that the actual write would round to `-81` or
  `-80`. This is a real, confirmed display/write rounding split, not a bug this task is asked to fix.

### 11.2 The six-pair fixture and reproduction test

`src-js/views-kerning/tests/test-aggregate-proposals.js` (new file, this task). The class×class product of
`@A = [A, Adieresis, Aacute]` × `@V = [V, W]`, exactly six pairs, one of each kind the plan's own text
names:

| Pair | Kind | Cache entry | Notes |
| --- | --- | --- | --- |
| `A × V` | ordinary | value −82 | small divergence from the class's −80 (inlier) |
| `A × W` | ordinary | value −150 | large divergence (outlier, and a candidate) |
| `Adieresis × V` | hidden | value −79, `junk: true` | small divergence |
| `Adieresis × W` | stale | value −83, `stale: true` | small divergence |
| `Aacute × V` | **missing** | no cache entry at all | — |
| `Aacute × W` | saved exception | value −28, kernData has an explicit `Aacute → W = −30` | current resolves to −30, not the class's −80 |

**Confirmed blocker, before the results:** `kerning.js` could not be imported directly under Mocha/Node for
this test. Reproduced directly (not assumed) with three throwaway `node --import <loader>` runs from
`src-js/views-kerning`: (1) `kerning.js`'s own transitive graph (via `edit-tools-select.js` →
`views-editor`) reaches `views-editor/src/snapping-interactions.js`, which imports
`"@fontra/core/utils.js"` — a specifier that does not resolve, because only `utils.ts` exists on disk and
no other working import in this codebase relies on extension substitution (every other caller uses the
real `.ts` extension explicitly, e.g. `kerning-controller.js:4`); (2) past a throwaway loader that maps an
unresolvable `*.js` specifier to `*.ts`, the same graph hits real browser-only side effects at **module
top level**: `fontra-core/src/localization.js` calls `synchronizeWithLocalStorage` at import time
(`localStorage`, `window.addEventListener`), and past a shim for those, `fontra-core/src/theme-settings.js`
touches `document.documentElement.classList` at import time too. This is a real, deep, cascading chain of
browser dependencies — not a single fixable specifier — and building a DOM shim deep enough to satisfy it
would mean emulating a browser, which the dispatch brief's "no live-server/CDP browser-testing harness"
rules out building as new scope for an investigation task. No test in this repo imports `kerning.js`
directly today (grepped every file in `views-kerning/tests/`); this is the first attempt, and it is the
reason no earlier task's tests do either.

Given that confirmed blocker, the test runs the **verbatim current source text** of the six methods above
(copied character-for-character from the line numbers cited in §11.1, at the commit named at the top of
this section — not reimplemented or paraphrased) as plain methods on a throwaway probe object, against real
fixture data built from the actually-importable `KerningController` and `autokern-cache.js` primitives
(both used unmodified, no import problem). This observes real numeric output from the real algorithm as it
exists today; a future edit to `kerning.js`'s own copies of these methods will not be reflected here
automatically, so they must be re-diffed against the cited line numbers if `kerning.js` changes them — the
test file's own header comment says so.

Run (`npx mocha tests --extension js --reporter spec` from `src-js/views-kerning`):

```
Task 16: aggregate class-median and candidate-detection contract, real KerningController + real cache primitives, verbatim kerning.js method copies
  ✔ current baseline resolves through the cascade -- explicit exception wins over the class value, exactly like an ordinary read
  ✔ isOverrideCandidate: a pair with an existing saved exception can NEVER be a candidate, regardless of divergence
  ✔ isOverrideCandidate evaluates hidden and stale entries at face value -- neither flag gates candidacy
  ✔ computeFoldGroupStats: median contributors include hidden and stale entries, exclude only genuinely MISSING pairs
  ✔ computeFoldGroupStats: outlier-dropped median, groupThreshold=10 -- A x W (divergence -70) is dropped, the rest (all |divergence|<10) are averaged
  ✔ computeFoldGroupStats: when EVERY contributor is an outlier (groupThreshold below every real divergence), medianDroppingOutliers falls back to the unfiltered median of all 5 present entries
  ✔ computeFoldGroupStats: zero cache coverage falls back to medianOf(group.rows), which returns NaN for an empty group -- confirmed, not asserted safe

7 passing (7ms)
```

Full-repo `npm test` after adding this file: **2518 passing in `fontra-core` + 97 in `views-kerning`** (up
from the 90 recorded in §10.3), **0 failing**.

### 11.3 Resolved investigation questions

- **Median contributors.** Every cache entry whose glyphs fall inside the two classes contributes,
  **regardless of `junk` (hidden) or `stale`** — confirmed by the fixture (`Adieresis × V`, junk, and
  `Adieresis × W`, stale, both appear in `stats.entries`) and by reading the loop, which never touches
  either flag. A **missing** pair (no cache entry, `Aacute × V`) is naturally absent — there is nothing to
  include. **Hiding a result is display-only for this calculation, exactly as §12.1's own required outcome
  asked to establish** — the hidden filter (`rowVisibleForHiddenState`/`pairRowVisible`) only ever runs on
  `group.rows` (the table's rendered child rows), never on `computeFoldGroupStats`'s own `entries` loop,
  which reads the raw cache directly.
- **Saved-exception treatment.** No special exclusion exists for a pair with a saved exception **in the
  median**: it contributes an ordinary entry, and whether it survives `medianDroppingOutliers`'s
  outlier-drop depends purely on its own divergence from its own current (exception) value, the identical
  test every other contributor gets — confirmed by the fixture (`Aacute × W` stayed an inlier because its
  suggestion was close to its *own* −30, not because of any exception-specific carve-out). Saved exceptions
  ARE specially excluded from **candidacy** (`isOverrideCandidate`/the Potential tab) — but that exclusion
  is a side effect of `wouldShadowClassCell` (a pair with any existing literal rule can never "shadow" a
  class cell, since none currently answers for it), not a divergence comparison. No circular dependency
  exists between the two: candidacy exclusion and median inclusion are two independent code paths that
  happen to both read the same cache entry.
- **Outlier handling.** `medianDroppingOutliers` drops any contributor whose `|divergence| >= groupThreshold`
  and falls back to the **unfiltered** median if that would drop every contributor — confirmed both ways by
  the fixture (`groupThreshold=10` drops only `A × W`; `groupThreshold=0.5` drops everything and falls back
  to the plain median of all 5 present entries).
- **Rounding.** None, anywhere in the median computation (`medianDroppingOutliers`/`computeFoldGroupStats`);
  the aggregate value can be a `.5` fraction, and the table displays it unrounded via `.toFixed(1)`.
  Rounding happens exactly once, at write time, via `Math.round` in `applyFoldedParentRow`
  (`kerning.js:3139`) — confirmed by reading that call site, not by the fixture (writing was out of this
  task's scope).
- **No-valid-contributor / empty-aggregate behavior.** Confirmed by the fixture's last case:
  `computeFoldGroupStats` on a class pair with **zero** cache coverage falls through to
  `medianOf(group.rows.map(...))`, and an empty `group.rows` produces `NaN` (not `null`, not `0`). This path
  is **unreachable through the real UI today** — `buildClassClassGroups` only calls
  `computeFoldGroupStats` after its own `hasCoverage` check already found at least one entry
  (`kerning.js:2794-2803`) — but the raw function itself has no guard against it, which matters directly to
  Task 16's own proposed contract (`value: number|null`): `NaN` satisfies neither branch of that type, so
  any future direct caller of `computeFoldGroupStats` (bypassing `buildClassClassGroups`'s gate) must add
  an explicit `Number.isNaN` guard, not assume the existing code already returns `null` safely.
- **Tolerance comparison baseline.** Always the pair's own current, cascade-resolved value — confirmed
  directly above (§11.1) and by the fixture. There is no "proposed class value" concept anywhere in this
  code for the comparison to use instead.

### 11.4 The UI-facing contract, adjusted to what real code already supports

```text
getAggregateProposal(address, sourceId)
  -> { value: number|null, stale: boolean, includedCount: number, excludedCount: number }
```

**Mostly already satisfied, one real gap.** `computeFoldGroupStats` already returns `{ leftMembers,
rightMembers, entries, median, spread }` — `median` is `value` (add a `Number.isNaN` guard per §11.3's
empty-aggregate finding to produce `null` instead, since that never happens via the real UI path today but
would violate the contract's own type if it ever did). **No `stale` field exists on this return at all** —
this is exactly F21's own still-open question, already recorded as unresolved in §10.4 ("Aggregate
(class-summary row) staleness is not computed anywhere... a real open decision for whoever builds Task 17's
F23 display"); this task's own tracing confirms that finding again from the aggregate side and does not
re-open or re-decide it. **`includedCount`/`excludedCount` do not exist as a return value anywhere** — the
real gap this task found: `medianDroppingOutliers` computes its own `inliers` array internally
(`autokern-cache.js:207-210`) but does not return its length to its caller, and `computeFoldGroupStats`
never asks for it. The row-detail tooltip that already exists (`kerning.js:3003-3006`,
`` `${stats.entries.length} pairs, spread ...` ``) only discloses the **total** contributor count, not a
included-vs-excluded split — so F21's own recommended detail ("disclose contributing-pair count and
excluded-result count") is only half-built today. **This is genuinely new, small code Task 17 must add**
(have `medianDroppingOutliers` return `{ median, includedCount, excludedCount }` instead of a bare number,
or compute the same inlier count a second time at the call site) — not a algorithm change, a return-shape
change to an already-correct calculation.

```text
getPotentialExceptions(sourceId, tolerance)
  -> [{ left, right, proposed, baselineValue, baselineAddress, divergence }]
```

**Already fully satisfied by Tasks 8/9's existing code — no new binding work needed here.**
`buildClassClassGroups` → `pairRowData` → `isOverrideCandidate` already computes exactly this per row
(`row.suggestion` is `proposed`; `row.current`, read via the same cascade call `overrideDivergence` uses, is
`baselineValue`; `row.delta` is `divergence`), and `rowVisibleInPotential` (`results-model.js:90-92`)
already filters the Potential tab to exactly the candidate set, already reactive to the `groupThreshold`
("tolerance") control via `isOverrideCandidate`'s own read of
`autokernParamsController.model.groupThreshold`. The only field the plan's shape names that the real row
does not carry as its own explicit property is `baselineAddress` (which class/pair address the baseline
value came from) — but this is derivable on demand from the same inputs `describeShadowedClassCell`
already computes (`kerning.js:2339-2346`) and is not needed by anything Task 17's own checklist asks for; it
is not a gap worth flagging as blocking.

### 11.5 Status: ready for Task 17, with one small named gap and one testing-infrastructure leftover

**Ready, and already doing real work today, not merely a fixture:** `computeFoldGroupStats`,
`overrideDivergence`, `isOverrideCandidate`, `wouldShadowClassCell`, `medianDroppingOutliers`, and their
wiring into both the Default and Potential tabs (Tasks 8/9) are correct, exercised by the passing 2518 + 97
suite (including this task's 7 new tests against verbatim real-code copies), and need **no algorithm
changes**. `getPotentialExceptions`'s contract is fully satisfied by existing code today. F18's "Class
tolerance" concept is already one real, wired control (`groupThreshold`) shared correctly by both the
median outlier-drop and candidate detection — not two concepts that need reconciling.

**Left for Task 17 (small, named, not algorithmic):**

1. Have the median calculation return an included/excluded contributor-count split (§11.4) — a return-shape
   change to `medianDroppingOutliers`/`computeFoldGroupStats`, not a new calculation — so F21's own
   "disclose... excluded-result count" recommendation is fully met, not half-met.
2. Add a `NaN` guard to whatever wraps `computeFoldGroupStats` for the `getAggregateProposal`-shaped
   contract, per §11.3's empty-aggregate finding — currently unreachable via the UI, but not
   type-safe if reused directly.
3. Rename the `#kerning-param-group-threshold` control's label from "Group threshold" to spec's "Class
   tolerance" (F18) — copy-only, already the correct single control underneath.
4. Aggregate/class-summary staleness for F23's `!` marker (already recorded as open in §10.4, reconfirmed
   here, not newly found) — a real design decision, not something this task's code reading resolved.

**Testing-infrastructure leftover, not gating Task 17's UI work:** `kerning.js` cannot be imported under
plain Node/Mocha today (§11.2's confirmed blocker: a wrong `.js`/`.ts` extension in
`views-editor/src/snapping-interactions.js`, plus real browser-only top-level side effects in
`fontra-core/src/localization.js` and `theme-settings.js`). Fixing the first (a one-line specifier
correction) is unrelated to Task 16's own subject and was not made here, per this task's own
investigation-only scope — flagged for whoever next needs to test `kerning.js`'s own class methods
directly rather than through verbatim copies or full-browser acceptance testing.
