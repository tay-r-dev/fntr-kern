# Kerning View UX Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementation is requested. Steps use checkbox syntax for tracking. This deliverable is a plan; none of its implementation steps has been executed.

**Goal:** Implement the 33-finding Fontra kerning-view UX specification, preserving class inheritance while making selection, filtering, pair exceptions, and stale-result review explicit.

**Architecture:** Keep the existing kerning view and shared Fontra scene/controller integration. Extract small, view-local modules for selection, row presentation, input tokens, and numeric filtering; keep font writes in the existing kerning controller. Place an explicit adapter boundary around autokern results and scoped reruns so user-facing work can proceed with fixtures while calculation semantics are investigated.

**Tech Stack:** Existing Fontra JavaScript modules, HTML/CSS, ObservableController, shared scene and glyph-cell components, existing kerning edit contexts, and the project's established test tooling. No framework replacement or new production dependency is planned.

**Spec:** [Fontra-Kerning-View-UX-Spec.md](../../../deliverables/Fontra-Kerning-View-UX-Spec.md). The spec and this plan must travel together; after copying into a repository, update this link to the spec's repository location.

**Planning method:** [obra/superpowers writing-plans skill](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md), read on 2026-09-08. The user's explicit request permits autokern placeholders, overriding that skill's normal prohibition. Placeholders below have named deliverables and completion criteria; they are not speculative implementations.

## Global constraints

- Exactly 33 original findings are traced at the end. Task count is independent of finding count.
- Shift-click toggles individual rows. It never selects a range.
- Highlights control preview; ticks control Apply selected and Reset selected.
- Reset selected writes explicit zero and requires two presses.
- Empty Pair input does not restrict the table and does not automatically preview the entire table.
- Grouped members are hidden individually by default. Explicit exposure retains class summaries and does not create an exception.
- `/glyphname` names any glyph. Non-Unicode means no Unicode assignment and is off by default.
- `%glyphname%!` exposes a member; it does not remove membership or save an override.
- Saved exceptions remain in Default. Potential exceptions are unsaved candidates in their own tab.
- Zero is a valid explicit kerning value. Never use nonzero as a proxy for rule existence.
- Removing an exception restores inheritance by deletion, not by copying a number.
- Numeric thresholds filter absolute Delta; class tolerance is a separate concept.
- No algorithm, invalidation, contributor-eligibility, or pair-coverage assumptions may fill an autokern placeholder.
- Preserve active-source consistency and existing shared-editor behavior.
- The user supplied only part of the code. An omitted module is not a missing capability.
- No fontra-pak change is required by the UX design itself. Check packaging only if the actual fork needs registration of added assets/modules.

## Execution status and boundaries

This is a source-grounded implementation sequence, not a claim that the full fork has been inspected. We have six supplied files and the completed UX spec, not a complete checkout or verified package scripts.

Task 1 resolves exact repository paths, test commands, and existing controller APIs before integration code is written. Paths below are the proposed targets inferred from imports and the supplied design document. Do not create a second workspace at these paths if the actual fork uses a different layout; update the map once and use the real files.

Code blocks for small pure functions are concrete proposed implementations. Integration steps name observed call sites and required behavior; their adapters must be bound to the real APIs discovered in Task 1. They are not purported drop-in patches against omitted files.

The table/input/exception work is one coupled subsystem, so it stays in one plan. Autokern investigations form a separately gated lane: UI tasks can use controlled fixtures, but no algorithm-dependent feature is complete until its gate is closed.

## File map

| Proposed repository path | Action | Responsibility / observed anchor |
| --- | --- | --- |
| `src-js/views-kerning/src/kerning.js` | Modify | Supplied `kerning.js`; table, inputs, preview, actions, panels. |
| `src-js/views-kerning/kerning.html` | Verify location, then modify | Supplied `kerning.html`; controls and inline styles. |
| `src-js/views-kerning/src/edit-tools-select.js` | Modify | Supplied pointer tool; modifier-click forwarding. |
| `src-js/views-kerning/src/start.js` | Inspect; change only if necessary | Supplied entry point; readiness and module loading. |
| `src-js/views-kerning/src/edit-tools-metrics.js` | Locate and inspect | Omitted tool; exception-aware preview edit targeting. |
| `src-js/views-kerning/src/autokern-worker.js` | Inspect at autokern gates | Supplied worker; imports `pairsForRerun` and accepts `everything`/`marked`. Do not infer their semantics. |
| `src-js/fontra-core/src/kerning-controller.js` | Inspect; minimally extend only if needed | Winning address, fallback, explicit-rule deletion, edits and undo. |
| `src-js/fontra-core/src/autokern-cache.js` | Inspect at autokern gates | Omitted cache, freshness, median/re-run helpers. |
| `src-js/fontra-core/src/autokern-engine.js` | Inspect only as required | Omitted calculation engine. |
| `src-js/fontra-core/src/glyph-data.js` | Inspect | Existing metadata lookup; actual glyph map supplies Unicode assignments. |
| `src-js/views-kerning/src/results-selection.js` | Create | Highlight/tick transitions and Reset arming. |
| `src-js/views-kerning/src/results-model.js` | Create | Stable row identity, presentation and numeric predicates. |
| `src-js/views-kerning/src/input-tokens.js` | Create | Token syntax and serialization; pair expansion added only after grammar decision. |
| `src-js/views-kerning/src/kerning-data-adapter.js` | Create if existing API cannot be consumed directly | View-facing rule provenance, read/write/delete and event subscriptions. No duplicated resolver cascade. |
| `src-js/views-kerning/src/autokern-view-adapter.js` | Create if needed | Normalize resolved autokern contracts. No replacement algorithm. |
| `src-js/views-kerning/tests/ux-*.test.mjs` | Create | Focused pure-function tests. Adapt location to project convention in Task 1. |
| `docs/superpowers/kerning-ux-integration.md` | Create | Verified paths, commands, decisions, adapter bindings and gate results. |
| `docs/superpowers/kerning-ux-acceptance.md` | Create | Browser scenario results and finding coverage. |

Avoid splitting the entire 5,000-line controller as a prerequisite. Extract only the small state/predicate pieces that this change needs.

## Test and commit conventions

Each numbered implementation step should be one small action, typically a few minutes. A task can contain several such steps and take longer. Do not turn one checkbox into an entire feature rewrite.

For pure helpers, the snippets below use Node's built-in test runner and strict assertions, without adding a test dependency. Task 1 must confirm the workspace's ES-module configuration and Node version; use the existing runner instead if it already supplies the required environment. Record the exact replacement command in the integration document before coding.

Proposed focused command, from the verified repository root:

```bash
node --test src-js/views-kerning/tests/ux-selection.test.mjs
```

Each behavioral task follows: add a failing assertion, observe the intended failure, implement, rerun the focused check, then commit only the task's named files. For simple copy/layout removals, use a focused browser check rather than tests that merely duplicate markup. Git commands in this plan are future execution instructions, not actions taken while writing the plan.

## Task 1: Bind the plan to the full fork and resolve UX decisions

**Dependencies:** none. **Coverage:** prerequisites for all findings.

**Files:** inspect the mapped files, root package manifests and applicable `AGENTS.md`; create `docs/superpowers/kerning-ux-integration.md`.

**Interfaces:** produces verified file paths, runnable test/start commands, controller method bindings, and a decision ledger. Later tasks consume that ledger rather than guessing omitted APIs.

- [ ] Run `git status --short` in the actual fork and read applicable contributor instructions. Preserve unrelated user changes.
- [ ] Locate the supplied implementation and supporting code:

```bash
rg --files -g 'AGENTS.md' -g 'package.json' -g '*kerning*' -g '*glyph-data*' -g '*glyphset*' -g '*test*'
rg -n 'getGlyphPairValueForLocation|getPairsToTry|getEditContext|pairsForRerun|medianDroppingOutliers' src-js
```

- [ ] Record the exact source paths, current commit, workspace module type, test command, and development-server command from the actual manifests/instructions. Run the relevant existing baseline once and record any pre-existing failures.
- [ ] Inspect how rule absence differs from zero, how a rule is deleted, how edits expose undo data, and how active source/location and kerning-change notifications work. Record exact methods; do not implement a parallel cascade.
- [ ] Resolve the spec's remaining non-algorithm decisions: Pair grammar; summary expansion into preview; non-Unicode explicit-request precedence; category/pair/glyphset matching; empty multiselect behavior; exposed-member relationship filtering; summary hide scope; and final analytics metrics. Use a compact decision table with scenario examples. Ask only where a product choice changes behavior; do not reopen confirmed audit decisions.
- [ ] Record proposed defaults separately from approved outcomes. Gate only the affected task while other work proceeds.
- [ ] Commit the integration ledger: `git commit -m "docs: record kerning UX integration contracts"` after staging only that document.

**Done when:** all non-autokern integration paths/commands are concrete, and unresolved UX branches have explicit task-local gates. A repository that is not available is a preflight limitation, not permission to fabricate bindings.

## Task 2: Introduce stable row identity and rule provenance

**Dependencies:** Task 1. **Coverage:** F11, F12, F21, F26, F29, F32 foundations.

**Files:** create `results-model.js`, optionally `kerning-data-adapter.js`, and `tests/ux-model.test.mjs`; modify `kerning.js` at `pairRowData`, `wouldShadowClassCell`, `describeShadowedClassCell`.

**Interfaces:** `rowId(sourceId, leftName, rightName)` returns a string. The proposed adapter `readPair(left, right, sourceId)` returns `{current, winningAddress, fallbackAddress, fallbackValue, explicitPairExists}`. Addresses are `{leftName, rightName, sourceIdentifier}`. The adapter delegates to Task 1's verified APIs.

- [ ] Add the following focused test:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { rowId, valuesForDisplay } from "../src/results-model.js";
test("source and rule scope are part of identity; stale has no delta", () => {
  assert.notEqual(rowId("s1", "@A", "@V"), rowId("s1", "A", "V"));
  assert.notEqual(rowId("s1", "A", "V"), rowId("s2", "A", "V"));
  assert.deepEqual(valuesForDisplay(-80, -30, true),
    { current: -80, proposed: null, delta: null, stale: true });
});
```

- [ ] Run `node --test src-js/views-kerning/tests/ux-model.test.mjs`; expect the new import/assertion to fail before implementation.
- [ ] Implement the pure functions:

```js
export function rowId(sourceId, leftName, rightName) {
  return JSON.stringify([sourceId, leftName, rightName]);
}
export function valuesForDisplay(current, proposed, stale) {
  const available = !stale && Number.isFinite(proposed);
  return { current, proposed: available ? proposed : null,
    delta: available ? proposed - current : null, stale };
}
```

- [ ] Bind rule provenance to the real resolver. Add controller-level assertions for inherited zero, explicit pair zero, mixed class/glyph winner, and fallback after deletion. Expected: explicit pair existence is true for a stored zero and false for absence.
- [ ] Normalize rows to `{id, address, kind, leftName, rightName, current, proposed, delta, stale, hidden, previewPairs}`; `kind` is `class-rule`, `unique-pair`, `member-pair`, or `pair-exception`. A member row with no pair rule uses a prospective pair address for deliberate writes and separately records its winning inherited address.
- [ ] Rerun the focused checks and commit: `refactor: model kerning rows by source and rule address`.

**Done when:** class membership is no longer used as proof of the winning rule, and rows can survive rerenders with stable identity.

## Task 3: Implement highlight and tick state

**Dependencies:** Task 2. **Coverage:** F04, F24, F25.

**Files:** create `results-selection.js`, `tests/ux-selection.test.mjs`; modify `kerning.js` at `buildPairRowElement`, selection accessors, and render completion.

**Interfaces:** `selectRow(state,id,additive)`, `tickRow(state,id,checked)`, `retainVisible(state,ids)` return `{highlighted:Set, ticked:Set}`. State lives outside DOM nodes.

- [ ] Add a failing test for non-range highlights and group ticking:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { selectRow, tickRow, retainVisible } from "../src/results-selection.js";
test("nonadjacent preview choice and visible-only ticks", () => {
  let s = { highlighted: new Set(), ticked: new Set() };
  s = selectRow(s, "a", false);
  s = selectRow(s, "c", true);
  assert.deepEqual([...s.highlighted], ["a", "c"]);
  s = tickRow(s, "a", true);
  s = retainVisible(s, new Set(["c"]));
  assert.deepEqual([...s.highlighted], ["c"]);
  assert.deepEqual([...s.ticked], ["c"]);
  s = tickRow(s, "c", false);
  assert.equal(s.ticked.size, 0);
});
```

- [ ] Run the focused selection test and observe failure.
- [ ] Implement:

```js
export function selectRow(state, id, additive) {
  const highlighted = additive ? new Set(state.highlighted) : new Set();
  if (additive && highlighted.has(id)) highlighted.delete(id);
  else highlighted.add(id);
  return { highlighted, ticked: new Set(state.ticked) };
}
export function tickRow(state, id, checked) {
  const targets = state.highlighted.has(id) ? state.highlighted : [id];
  const ticked = new Set(state.ticked);
  for (const key of targets) checked ? ticked.add(key) : ticked.delete(key);
  return { highlighted: new Set(state.highlighted), ticked };
}
export function retainVisible(state, ids) {
  return {
    highlighted: new Set([...state.highlighted].filter(id => ids.has(id))),
    ticked: new Set([...state.ticked].filter(id => ids.has(id))),
  };
}
```

- [ ] Wire ordinary row clicks to `selectRow(...,false)` and Shift-click to `true`. Keep input/button clicks out of that handler. Render checkbox state from `ticked`; Deselect assigns two empty sets.
- [ ] At each filtered-result or tab update, retain only displayed row IDs. Do not prune simply because a row is outside the scroll viewport. Update pair preview and action counts from the resulting state.
- [ ] Run the test, then manually click/check/uncheck nonadjacent rows and verify preview is not replaced by checkbox interaction. Commit: `feat: separate kerning preview and action selection`.

## Task 4: Make bulk actions scope-aware and Reset double-press

**Dependencies:** Tasks 2–3. **Coverage:** F20, plus F04/F25 action consequences.

**Files:** modify `results-selection.js`, `tests/ux-selection.test.mjs`, `kerning.js` at `writePairValues`, `resetSelectedPairRows`, bulk apply handlers; modify table action markup.

**Interfaces:** `pressReset(armedKey,targetIds)` returns `{commit,armedKey}`. The write adapter consumes explicit addresses and numeric values; it must not convert class addresses into literal pairs.

- [ ] Add the test:

```js
test("reset needs two presses on the same target set", () => {
  const a = pressReset(null, ["a", "b"]);
  assert.equal(a.commit, false);
  assert.equal(pressReset(a.armedKey, ["b", "a"]).commit, true);
  assert.equal(pressReset(a.armedKey, ["a"]).commit, false);
  assert.equal(pressReset(null, []).commit, false);
});
```

Add `pressReset` to the test import; run the test and observe the missing function failure.

- [ ] Implement:

```js
export function pressReset(armedKey, targetIds) {
  if (!targetIds.length) return { commit: false, armedKey: null };
  const key = JSON.stringify([...new Set(targetIds)].sort());
  return key === armedKey
    ? { commit: true, armedKey: null }
    : { commit: false, armedKey: key };
}
```

- [ ] Store the armed key separately from selection. Clear it on any target change, hide/filter/tab change, source change, other action, or view exit. Set the armed button label to `Reset N rows to 0 — press again`.
- [ ] Replace DOM-wide row collection with ticked IDs resolved against current row objects. Snapshot addresses before asynchronous writes. Disable repeat execution while the write is pending; preserve honest error state if it fails.
- [ ] Route class rows to class addresses and individual rows to literal pair addresses. Reset writes zero; Apply writes a finite available proposal. Preserve undo through the verified edit path. If both a class and member are ticked, explain that both rules are written and the explicit pair takes precedence.
- [ ] Remove Apply all, Reset to current, and manual-value controls and listeners. Run the focused test plus a real class/pair write-and-undo check. Commit: `feat: make selected kerning writes explicit and reset deliberate`.

## Task 5: Add numeric filters and migrate saved controls

**Dependencies:** Task 2. **Coverage:** F05, F13, F16, F18 numeric interval.

**Files:** modify `results-model.js`, `tests/ux-model.test.mjs`, `kerning.js` at `initPairTableSection`, `pairRowVisible`, `initParametersSection`; modify `kerning.html`.

**Interfaces:** `passesNumericFilters(row,filters)` uses `minDelta`, `maxDelta`, `hideZeroCurrentSuggestions`. Columns use separate state and never enter this predicate.

- [ ] Add numeric assertions and run them before implementation:

```js
test("column visibility cannot filter; delta bounds are absolute", () => {
  const f = { minDelta: 5, maxDelta: 20, hideZeroCurrentSuggestions: false };
  assert.equal(passesNumericFilters({current:-80,proposed:-60,delta:20}, f), true);
  assert.equal(passesNumericFilters({current:-80,proposed:-100,delta:-20}, f), true);
  assert.equal(passesNumericFilters({current:0,proposed:10,delta:10},
    {...f, hideZeroCurrentSuggestions:true}), false);
});
```

- [ ] Add the named import and implement:

```js
export function passesNumericFilters(row, filters) {
  if (filters.hideZeroCurrentSuggestions && row.current === 0 &&
      Number.isFinite(row.proposed) && row.proposed !== 0) return false;
  if (!Number.isFinite(row.delta)) return true;
  const magnitude = Math.abs(row.delta);
  return magnitude >= filters.minDelta &&
    (filters.maxDelta === null || magnitude <= filters.maxDelta);
}
```

- [ ] Add minimum/maximum controls; normalize blank maximum to `null`. Reject nonfinite/negative values and reversed bounds inline; retain the last valid filter rather than emptying the table accidentally. Class tolerance remains independently stored and unwired to numeric-row filtering.
- [ ] Add Columns controls for Current, Proposed, Delta; default all visible as a recommended migration default. Add Hide zero-current suggestions with its exact predicate in help text.
- [ ] Remove Hide current and sign controls/listeners. Version the UI settings so old `showCurrent`, sign, bucket and status values cannot silently suppress the redesigned table; preserve unrelated user settings.
- [ ] Run focused numeric checks and verify toggling Proposed leaves the row count unchanged. Commit: `feat: separate kerning columns from numeric row filters`.

**Decision note:** unknown/stale deltas pass this numeric predicate so their warnings remain discoverable; confirm this spec recommendation in Task 1 if a different policy is desired.

## Task 6: Implement named input tokens and modifier-click serialization

**Dependencies:** Task 1 decisions. **Coverage:** F07, F22 syntax.

**Files:** create `input-tokens.js`, `tests/ux-input.test.mjs`; modify `kerning.js` Glyph input listener and selected-glyph synchronization; modify `edit-tools-select.js`.

**Interfaces:** `parseToken(text)` returns `{kind,name}` with kinds `literal`, `glyph`, `class`, `member`. Pair-text grammar is separate and must use Task 1's decision. `appendGlyphToken(input,name)` returns comma-separated text using `/name` serialization.

- [ ] Add test and observe failure:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseToken, appendGlyphToken } from "../src/input-tokens.js";
test("named glyphs and member exposure are different", () => {
  assert.deepEqual(parseToken("/A"), {kind:"glyph",name:"A"});
  assert.deepEqual(parseToken("%Adieresis%!"), {kind:"member",name:"Adieresis"});
  assert.deepEqual(parseToken("@A"), {kind:"class",name:"A"});
  assert.equal(appendGlyphToken("/A", "V"), "/A, /V");
});
```

- [ ] Implement token syntax only:

```js
export function parseToken(text) {
  const t = text.trim();
  if (t.startsWith("%") && t.endsWith("%!")) {
    const name = t.slice(1, -2);
    if (!name) throw new Error("Enter a glyph name between % and %!");
    return {kind:"member", name};
  }
  if ((t[0] === "/" || t[0] === "@") && t.length > 1)
    return {kind:t[0] === "/" ? "glyph" : "class", name:t.slice(1)};
  if ([...t].length === 1 && !["/", "@", "%"].includes(t))
    return {kind:"literal", name:t};
  throw new Error("Use a character, /glyphname, @class, or %glyphname%!");
}
export function appendGlyphToken(input, name) {
  const parts = input.split(",").map(s => s.trim()).filter(Boolean);
  const token = "/" + name;
  return [...new Set([...parts, token])].join(", ");
}
```

- [ ] Resolve parsed names against the actual glyph map/class maps and show unknown-name errors. Do not infer Unicode status from a leading slash. Extend token escaping only if Task 1 establishes names requiring it.
- [ ] Remove the automatic selected-glyph-to-input assignment in `initPairTableSection`. From a concrete pointer hit, ordinary click updates preview selection only; Ctrl+Click replaces input with `/name`; Shift+Ctrl+Click calls `appendGlyphToken`. Keep double-click/open-editor behavior intact.
- [ ] Confirm the shared editor's pointer behavior has not changed. Run input tests and modifier-click browser checks. Commit: `feat: add explicit kerning input tokens and pointer shortcuts`.

## Task 7: Connect Pair input and multi-pair preview

**Dependencies:** Tasks 3, 6; Task 1 Pair grammar and summary-preview decisions. **Coverage:** F06, F04 preview, F22 expansion.

**Files:** modify `kerning.js` at `initPairTableSection`, `selectPairForScene`, `setChipMode`; modify `kerning.html`; extend `input-tokens.js` and its tests using the approved grammar.

**Interfaces:** introduce view method `setPreviewPairs(pairs)` where each pair is `[leftGlyphName,rightGlyphName]`. It uses existing scene text/character-line APIs and keeps phrase text separate. Input matching returns concrete pairs plus an explicit-choice flag.

- [ ] Encode the approved Pair grammar as test examples: literal pair, named glyph pair, class token, exposed member, comma-separated choices, invalid name, and empty input. Each example must name the exact expected pairs; do not leave expansion to an implicit string trick.
- [ ] Run the parser/matching tests and observe failure, then implement those examples using the existing glyph-map and class lookup APIs verified in Task 1.
- [ ] Replace the exception input with Pair. Empty Pair removes only that input restriction and sets its explicit-choice flag false.
- [ ] Add this arbitration at the controller boundary, where `selectedPairs` are expanded highlighted rows and `inputPairs` come from approved input matching:

```js
const previewPairs = selectedPairs.length ? selectedPairs :
  inputsSpecifyPairs ? inputPairs : [];
pairModeButton.disabled = previewPairs.length === 0;
if (previewPairs.length) this.setPreviewPairs(previewPairs);
```

- [ ] Implement `setPreviewPairs` with the verified scene API so pairs remain separate samples; never concatenate them in a way that introduces unintended cross-pair kerning. If the active Pair mode loses every pair, restore Phrase mode and its phrase.
- [ ] Verify input-driven preview, selection-driven preview, Deselect fallback, and empty Pair behavior. Commit: `feat: connect kerning pair queries to multi-pair preview`.

## Task 8: Replace buckets with one row list and two tabs

**Dependencies:** Tasks 2, 3, 5, 7. **Coverage:** F11, F19 presentation, F22 exposure, F32.

**Files:** modify `kerning.js` at `renderPairTable`, class row builders and `buildPairRowElement`; modify `kerning.html` table structure.

**Interfaces:** controller `getVisibleResultRows()` returns normalized rows from Task 2. It consumes a candidate list supplied by the autokern adapter; it does not calculate candidates. `activeResultsTab` is `default` or `potential`.

- [ ] Create a fixture with one class summary, one unique pair, one exposed member, one saved exception, and one candidate. Assert Default contains summary/unique/exception, explicit exposure adds the member without losing the summary, and Potential shows the supplied candidate.
- [ ] Remove bucket selectors and bucket `<tbody>` containers. Use one result `<tbody>` and this header order; place the tick inside the left-name cell so it does not add an unrequested column:

```html
<tr>
  <th scope="col">Glyph L (name)</th><th scope="col" data-column="current">Current</th>
  <th scope="col" data-column="proposed">Proposed</th><th scope="col" data-column="delta">Delta</th>
  <th scope="col">Glyph R (name)</th><th scope="col">Exception</th><th scope="col">Hide</th>
</tr>
```

- [ ] Add Default / Potential exceptions tabs and Show individual class members. Resolve row visibility from rule kind/exposure/tab; keep saved exceptions visible in Default even if absent from the latest proposal cache.
- [ ] Render class-to-class and class-to-unique summaries using aggregate proposals supplied by the gated adapter. Do not compute a new median in the renderer.
- [ ] Keep existing useful sorting, but apply it uniformly to normalized numeric fields. Remove status sorting when the status column disappears; use a stable row-ID tie-breaker. Preserve scroll and surviving selection.
- [ ] Run the fixture and browser header/order/exposure checks. Commit: `feat: replace kerning buckets with rule rows and exception review`.

## Task 9: Add category, relationship, and glyphset filters

**Dependencies:** Tasks 1 filter decisions, 6, 8. **Coverage:** F09, F14.

**Files:** modify `results-model.js`, `kerning.js` filter initialization and `glyphCategory` consumers, `kerning.html`; add `tests/ux-filters.test.mjs` in the verified harness.

**Interfaces:** predicates consume normalized rows and actual glyph metadata; UI state includes `side`, `unicodeTypes`, `relationships`, and `tableGlyphsetId`. Preview glyphset state is separate.

- [ ] Write tests for encoded `/A`, accented uppercase, combining mark, unencoded alternate, both mixed class/glyph orientations, selected glyphset, and a mixed-category class. Expected matches must come from Task 1's decision table.
- [ ] Use the actual glyph map's Unicode assignments to classify non-Unicode entries. Consult the existing metadata service for character categories and casing; record an unknown category rather than guessing from outlines.
- [ ] Create the three main filter controls and the table glyphset selector. The core state distinguishes category and syntax:

```js
const tableFilters = {
  side: "all",
  unicodeTypes: new Set(["uppercase", "lowercase", "punctuation", "symbols", "marks"]),
  relationships: new Set(["class-class", "class-unique", "unique-unique", "exceptions"]),
  tableGlyphsetId: null,
};
// null glyphset means All. "non-unicode" is deliberately not selected.
// Add handling for other encoded categories using the Task 1 decision.
```

- [ ] OR selected choices within a filter and AND independent filters. Class-to-unique covers either orientation; Side narrows the glyph-focus position. Normalize persisted arrays into Sets at the UI boundary and back into arrays for storage.
- [ ] Apply approved non-Unicode explicit-request precedence; if the filter still excludes a named request, explain the empty result rather than silently showing nothing unexplained.
- [ ] Run focused filtering checks, confirm selection pruning, and commit: `feat: add kerning category relationship and glyphset filters`.

## Task 10: Implement exception creation, removal, and preview targeting

**Dependencies:** Tasks 1 controller bindings, 2, 4, 8. **Coverage:** F12, F29, F19 accept action.

**Files:** modify `kerning.js` pair actions, `kerning-data-adapter.js` if used, and the located `edit-tools-metrics.js`; extend existing controller integration tests.

**Interfaces:** proposed adapter methods `setRules([{address,value}])`, `removeRule(address)`, and `readPair(left,right,sourceId)`. Bind to actual transaction/undo APIs from Task 1. `removeRule` means actual deletion, not a zero write.

- [ ] Add a font fixture: `@A × @V = -80`, members `A/Adieresis` and `V/W`. Assert the following sequence against the real controller:

```text
read Adieresis/W -> -80, explicitPairExists false
create explicit Adieresis/W = -80 -> explicitPairExists true
edit explicit pair to -30 -> pair is -30; A/W remains -80
edit class to -90 -> explicit pair remains -30
remove explicit pair -> pair is -90; explicitPairExists false
undo removal -> explicit pair is -30
```

- [ ] Observe the relevant failing behavior. Add create/remove lock handlers using exact pair addresses and source ID. For candidate acceptance, save its available Proposed value; for plain lock creation, save Current.
- [ ] Replace cached/nonzero exception detection with resolver provenance. Keep the saved-exception indicator visible, and reveal create controls on hover/focus for eligible exposed members. Do not offer a pair lock on an ambiguous class summary.
- [ ] In the preview kerning tool, target the explicit pair when one exists. Otherwise preserve the verified class-default targeting. Do not change class membership or edit unrelated glyph values.
- [ ] Replace “shadow” copy with “Pair exception,” “Inherited value,” and “Remove exception.” Show inherited value for removal and maintain undo via the established edit path.
- [ ] Run the sequence including explicit zero and source-switch variants. Commit: `feat: make pair exception editing explicit and reversible`.

## Task 11: Add hidden-result controls and category styling

**Dependencies:** Tasks 3, 8, 10; summary hiding decision from Task 1. **Coverage:** F10, F15, F17.

**Files:** modify `kerning.js` at `togglePairJunk` and row rendering, `kerning.html` styles and controls.

**Interfaces:** retain backend/cache compatibility behind the UI label if existing storage uses `junk`; introduce no data rename unless migration requires it. `hidden` on normalized rows is presentation state.

- [ ] In a browser fixture, hide an individually selected result, enable Show hidden, and restore it. Expected: kerning numbers do not change, hidden selection is cleared, restored selection does not return automatically.
- [ ] Replace Mark junk with eye controls and Show junk with Show hidden; use the approved summary-hide scope.
- [ ] Add focus-visible parity and distinct exception/category styling using existing theme tokens:

```css
.kerning-result .row-hover-action { opacity: 0; }
.kerning-result:hover .row-hover-action,
.kerning-result:focus-within .row-hover-action { opacity: 1; }
.kerning-result[data-kind="pair-exception"] .exception-action { opacity: 1; }
.kerning-result[data-hidden="true"] .glyph-name { text-decoration: line-through; }
```

- [ ] Give each eye/lock button an accessible name naming the action and pair. Add non-color indicators for class, unique, exception, and hidden state.
- [ ] Check keyboard access and both supported themes; commit: `feat: clarify hidden results and kerning rule categories`.

## Task 12: Refresh table values from preview edits without losing state

**Dependencies:** Tasks 2–4, 8, 10. **Coverage:** F26.

**Files:** modify `kerning.js` subscriptions/startup/teardown and row update path; bind through the optional data adapter.

**Interfaces:** the verified change subscription produces source-aware notifications. Add a view-local revision counter only to reject outdated asynchronous reads, not to invent freshness semantics.

- [ ] Add an integration scenario: highlight/tick two rows, scroll, edit one in preview, and assert updated Current/Delta plus preserved surviving selection and scroll.
- [ ] Subscribe to actual kerning data changes and active source changes. Use this ownership pattern around asynchronous row reads:

```js
const revision = ++this.resultReadRevision;
const sourceId = this.activeKerningSourceId;
const rows = await this.readResultRowsForSource(sourceId);
if (revision !== this.resultReadRevision || sourceId !== this.activeKerningSourceId) return;
this.installResultRows(rows);
```

Here `activeKerningSourceId`, `readResultRowsForSource(sourceId)`, and `installResultRows(rows)` are new view integration members: the first reflects the verified source selector, the second composes Task 2 reads with adapter proposals, and the third updates row state, applies filters, prunes selection, and renders. Define these exact members when wiring the pattern.

- [ ] Update inherited rows after class edits while preserving explicit pair winners. Recompute Delta from unchanged Proposed and new Current; do not run autokern as a refresh shortcut.
- [ ] On view disposal, release subscriptions; on source change, cancel Reset arming and prevent cross-source action targets.
- [ ] Verify rapid edits and source switching do not install older data. Commit: `fix: synchronize preview kerning edits with result rows`.

## Task 13: Rebuild preview toolbar and restore phrase readiness

**Dependencies:** Tasks 1, 7. **Coverage:** F08, F27, F28.

**Files:** modify `kerning.html`, `kerning.js` at `initPhraseSection`, `initChipSection`, `setChipMode`, and `initFontModeAddToClassActions`; inspect `start.js` only if startup ordering needs it.

**Interfaces:** reuse `applyPhraseText`; separate saved phrase from pair preview text. Use distinct `fontPreviewGlyphsetId` and `tableGlyphsetId` values.

- [ ] Reproduce the empty-after-refresh issue with a persisted phrase before editing startup behavior.
- [ ] Restore phrase input early but call `applyPhraseText()` after scene/font readiness. Scope persistence to project. Do not depend on fetching preset text to render the saved phrase; preset-load failure must not suppress it.
- [ ] Move the chip selector out of its absolute-position overlay into a real toolbar with opaque theme background. Add the Font glyphset selector there and disable it in Phrase/Pair modes.
- [ ] Feed that selector into the existing Font glyph-section filtering, using the verified glyphset registry. Table glyphset state remains unchanged.
- [ ] Move Add selection to group into Left/Right/Both's row and use responsive layout:

```css
#autokern-class-new-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .4em; }
.kerning-preview-toolbar { display: flex; align-items: center; gap: .5em; flex-wrap: wrap; }
```

Remove the chip selector's inline absolute positioning. Resolve parent sizing instead of setting overflow hidden on inaccessible controls.

- [ ] Verify refresh, preset-load failure, all three modes, independent glyphset selectors, and the smallest supported window size. Commit: `fix: stabilize kerning preview controls and phrase restoration`.

## Task 14: Clarify Font tiles and preserve context-menu selection

**Dependencies:** Task 1 glyph-cell API binding. **Coverage:** F30, F31, F33.

**Files:** modify `kerning.js` at `initFontModeSection`, `renderGlyphSwatches`, font context-menu construction, and tile styles in `kerning.html`.

**Interfaces:** the existing class-color map supplies side-specific indicators. A context-menu action closes over the clicked glyph name, not the current selection.

- [ ] Reproduce right-click on an unselected glyph while other glyphs are selected. Record existing selection mutation before changing handlers.
- [ ] Prevent the Font-view instance's context-menu path from running its selection-changing click handler. Preserve ordinary and modifier left-click behavior. Do not modify the shared component prototype globally.
- [ ] Bind menu actions to a captured target:

```js
const contextGlyphName = glyphCell.glyphName;
// Every single-glyph menu callback uses contextGlyphName.
// Do not assign glyphSelection while opening this menu.
```

- [ ] Reuse class-swatch colors for left/right membership markers in Font tiles. Add class-name tooltips and remove editor-status color input for this view only.
- [ ] Verify a glyph with different side classes shows both indicators, and a context action on an unselected glyph preserves the selected set. Commit: `feat: show font-mode class membership and preserve context selection`.

## Task 15: AUTOKERN PLACEHOLDER A — Freshness and scoped-rerun contract

**Dependencies:** Task 1. **Coverage:** F01, F02, F23 calculation dependency.

**Files:** inspect `autokern-worker.js`, `autokern-cache.js`, `autokern-engine.js` only as needed, and `kerning.js` run/cache/source handlers; update the integration ledger. Bind `autokern-view-adapter.js` only after the investigation.

**Question to resolve:** what exact work is necessary to make stale glyph results reliable again, and which existing APIs already perform it?

- [ ] Trace `markGlyphStale`, `pairsForRerun`, worker `marked` mode, cache merge, and source identity in the full fork. Record actual behavior with source references.
- [ ] Establish invalidation events, required pair partners, class-member effects, source ownership, and what counts as successful partial completion.
- [ ] Reproduce success, cancellation, worker error, and persistence failure with a tiny font. Ensure the completion signal cannot falsely clear unprocessed stale state.
- [ ] Define and bind these proposed UI contracts without prescribing the underlying algorithm:

```text
getStaleGlyphs(sourceId) -> ordered glyph names
runStale({sourceId, glyphNames, signal, onProgress})
  -> Promise<{completedGlyphs, remainingGlyphs}>
onProgress({completed, total, unit})
```

- [ ] Replace this placeholder's investigation record with exact implementation steps/tests against the discovered APIs. If a worker change is necessary, make it a reviewed follow-up within this task, not an inferred shortcut such as restricting both sides to the stale set.
- [ ] Commit the resolved contract and its evidence: `docs: define stale kerning rerun integration`.

**Exit gate:** exact runnable scope and freshness tests pass. Until then, Task 17 can use a fixture adapter but must not claim production rerun completion.

## Task 16: AUTOKERN PLACEHOLDER B — Aggregate proposals and potential exceptions

**Dependencies:** Task 1. **Coverage:** F18 tolerance, F19, F21; hidden/stale interactions.

**Files:** inspect the omitted median/cache/class helpers and existing `classClassStats`, `overrideDivergence`, and `isOverrideCandidate`; update integration ledger; bind `autokern-view-adapter.js` after resolution.

**Question to resolve:** which suggestions contribute to a class median, and what baseline determines an out-of-tolerance candidate?

- [ ] Trace existing aggregation and candidate code with a six-pair fixture containing ordinary, hidden, stale, missing, and saved-exception cases. Record outputs; do not bless observed behavior automatically.
- [ ] Resolve median contributors, outlier handling, rounding, empty aggregate behavior, and whether tolerance compares against current class kerning or proposed class kerning.
- [ ] Resolve existing-exception handling and the risk of circular dependency between candidate exclusions and aggregate proposals. Record a deterministic order only after inspecting the algorithm and choosing intended behavior.
- [ ] Bind the UI output contract:

```text
getAggregateProposal(address, sourceId)
  -> {value: number|null, stale: boolean, includedCount: number, excludedCount: number}
getPotentialExceptions(sourceId, tolerance)
  -> [{left, right, proposed, baselineValue, baselineAddress, divergence}]
```

- [ ] Add expected-output fixtures for class-to-class and both class-to-unique orientations, explicit zero, existing exception, hidden/stale contributor, all-excluded aggregate, and tolerance boundary.
- [ ] Replace the placeholder with exact adapter bindings and verified calculations; commit: `docs: define class proposal and exception candidate integration`.

**Exit gate:** those fixtures have reviewed expected values and pass against production helpers. Merely passing values through a test stub does not close the gate.

## Task 17: Wire stale panel, warnings, and candidate proposals

**Dependencies:** Tasks 8, 12, 15–16 for production; controlled fixtures permit earlier UI work. **Coverage:** F01, F02, F18, F19, F21, F23 completion.

**Files:** modify `kerning.js` at `initAutokernStatusSection`, `initRunSection`, row rendering and class proposals; modify `kerning.html`; bind `autokern-view-adapter.js`.

**Interfaces:** consume the five contracts from Tasks 15–16. Keep run progress separate from removed row-state filtering.

- [ ] Render a fixture with two stale glyphs, one stale member row and one stale aggregate. Verify list/count and `!` presentation; no old numeric proposal should look valid.
- [ ] Remove the current/applied/stale filter and its persisted interpretation. Add Stale glyphs, Re-run stale glyphs, progress, empty state, and concise failure/retry state to the right panel.
- [ ] Render stale Proposed as `!` with an accessible explanation. Under the spec's recommended policy, show no stale delta and disallow applying stale proposals; keep manual Reset separate.
- [ ] Capture source and stale names when starting the rerun. Use Task 15's contract, disable duplicate runs, preserve remaining stale entries after cancellation/failure, and reject results belonging to another active source.
- [ ] Wire tolerance to Task 16's candidate contract and class summaries to its aggregate contract. Show contributor counts. Accepting a candidate uses Task 10, not a special untracked write path.
- [ ] Run real tiny-font rerun and aggregate fixtures after both gates close. Commit: `feat: connect stale review and class exception proposals`.

## Task 18: Add scoped analytics

**Dependencies:** Tasks 8, 11, 17; Task 1 metric choice. **Coverage:** F03.

**Files:** modify `kerning.js` status/panel rendering and `kerning.html`.

**Interfaces:** consume existing normalized row sets and adapter counts. Count saved exceptions from saved rules, not proposal-cache flags.

- [ ] Build a known fixture and record expected glyph-versus-pair counts for the approved metrics.
- [ ] Add analytics with explicit scope labels. Recommended initial set: stale glyphs, saved pair exceptions, potential exceptions, hidden results. Do not display an unapproved quality/confidence score.
- [ ] Reuse existing navigation: stale count focuses Stale glyphs; potential count selects Potential exceptions; hidden count enables Show hidden. If a metric cannot navigate meaningfully, render it as text rather than a dead button.
- [ ] Recount after edits, source changes, hiding/restoring and completed runs without triggering new computation.
- [ ] Verify no double counting of summary/member/candidate representations. Commit: `feat: add scoped kerning review analytics`.

## Task 19: Verify the complete audit and packaging integration

**Dependencies:** Tasks 1–18, with production autokern gates closed. **Coverage:** all F01–F33.

**Files:** create `docs/superpowers/kerning-ux-acceptance.md`; modify implementation only for failures found; inspect actual build/package manifests and fontra-pak only if asset registration requires it.

- [ ] Run the focused tests added by this plan and the relevant existing controller/view suite using the recorded commands. Do not call a fixture-only autokern result a production pass.
- [ ] Execute spec section 11's six end-to-end scenarios and record outcomes, active source, and fixture font.
- [ ] Check the following regression matrix: explicit zero versus absence; summary plus member selected; nonadjacent Shift-click; filtered-out ticks; stale proposal action; empty Pair; exposed member plus retained summary; source change during async read/run; refresh before presets finish; right-click outside selection; keyboard access to hover actions; both themes and narrow layout.
- [ ] Confirm all removed controls/listeners are gone using a targeted search, then inspect intentional legacy storage identifiers rather than blindly deleting them:

```bash
rg -n 'Apply all|Reset to current|Mark junk|Show junk|Hide current|wouldShadowClassCell|describeShadowedClassCell' src-js/views-kerning
```

- [ ] Run the verified application build and open the built view. Confirm newly imported local modules are included. Run a fontra-pak smoke build only if this fork's packaging requires it; do not add packaging edits speculatively.
- [ ] Record all 33 outcomes and any unresolved blockers. Commit the acceptance record and necessary verified fixes with focused commit messages. Do not mark the overall implementation complete while either autokern gate remains open.

## Finding-to-task coverage

| Finding | Primary task(s) | Deliverable |
| --- | --- | --- |
| F01 | 15, 17 | Stale section instead of status filter |
| F02 | 15, 17 | Verified stale-only rerun |
| F03 | 18 | Scoped analytics |
| F04 | 3, 7 | Individual additive highlights, ticks, multi-pair preview |
| F05 | 5 | Hide current removed |
| F06 | 7 | Pair input and empty/selected preview behavior |
| F07 | 6 | Ctrl-click replacement and additive input |
| F08 | 13 | Opaque preview toolbar and glyphset selector |
| F09 | 9 | Unicode/non-Unicode dropdown |
| F10 | 11 | Hover/focus eye action |
| F11 | 8 | Bucket-free table |
| F12 | 10 | Explicit exception creation/removal and tool targeting |
| F13 | 5 | Separate columns and zero-current filter |
| F14 | 9 | Main filters and independent table glyphset |
| F15 | 11 | Rule category colors and non-color cues |
| F16 | 5 | Sign filter removed |
| F17 | 11 | Show hidden and restore |
| F18 | 5, 16, 17 | Delta bounds and investigated class tolerance |
| F19 | 8, 10, 16, 17 | Potential tab, classification, acceptance |
| F20 | 4 | Removed actions and double-press zero reset |
| F21 | 8, 16, 17 | Median class proposal integration |
| F22 | 6, 7, 8 | Notation and individual exposure with summaries retained |
| F23 | 15, 17 | Stale warning in Proposed |
| F24 | 3 | Deselect highlights and ticks |
| F25 | 3 | Selection pruned on filtering |
| F26 | 12 | Immediate source-aware value refresh |
| F27 | 13 | Phrase restoration after refresh |
| F28 | 13 | Class action row and responsive pane |
| F29 | 2, 10 | Provenance and exception terminology |
| F30 | 14 | Class colors on Font tiles |
| F31 | 14 | Editor-status tile colors removed |
| F32 | 8 | Required headers and action columns |
| F33 | 14 | Right-click preserves selection and targets clicked glyph |

**Coverage total: 33 unique original findings.**

## Review and handoff

Before execution, read the spec and Task 1 together. Autokern placeholders are intentional; other unresolved UX decisions are explicitly listed in Task 1 rather than quietly converted into requirements. The implementation team must replace verified repository bindings and close only the affected gates as evidence becomes available.

The plan may be executed inline with checkpoints or task-by-task through the requested Superpowers execution workflow. Neither implementation nor subagent execution was started as part of writing this document.
