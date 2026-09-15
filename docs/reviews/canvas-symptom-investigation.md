# Directed investigation: zoom stalls, oscillating settings, RAM growth

Source: `ui/ux-refactor` at `02bbd755925f4eb8a5f00fc248853aac7ba1f756`. Static code review only; no application changes, tests, benchmarks, or runtime reproduction. Inherited-source comparison: `1066c5cb3f0f0442037d9ea6394ab516553ca44c`. References below use paths relative to the repository; line numbers refer to that source snapshot. This report investigates the reported symptoms rather than repeating the general optimization inventory or the fork audit. Kerning view is excluded.

## Oscillating Gizmo/Handles and coarse-grid switches

### S1. Shared persistence can replay obsolete settings and echo them between tabs

**Confirmed mechanism; conditional explanation for sustained oscillation.** `src-js/fontra-core/src/observable-object.ts:165–197,286–330` dispatches ordinary listeners with separate zero-delay timers. Each carries the value at dispatch time. The persistence listener subsequently writes `event.newValue`, even if the model has already moved on. The storage listener applies incoming values as ordinary local changes, so they are eligible for another write back to storage. There is no remote-origin suppression or version check. Equality checks suppress identical values, but not delayed alternating values.

Both reported controls use the visualization controller persisted under `fontra-editor-visualization-layers.` (`src-js/views-editor/src/editor.js:4181–4197`). Thus another editor tab/window on the same origin is a concrete common source of feedback, even when it is displaying a different font.

A possible event ordering illustrates the defect, without claiming it was observed at runtime:

1. Tab A changes a boolean to true then false before its deferred writers drain. Tab B initially has false.
2. A's writers publish true then false. B receives both storage events and queues its own true and false writers.
3. B's true writer now disagrees with storage's false value, so it publishes true; its following writer publishes false.
4. A receives that pair and can replay it in the same way. Timing determines whether the exchange continues or converges; this is not an unconditional loop after every click.

The storage event is not sent back to the document that performed the write. **A single controller in one tab does not sustain this loop by itself.** If the symptom occurs with only one editor document, this hypothesis needs an additional writer/controller and is not yet a complete explanation. The synchronization implementation is unchanged from the upstream comparison revision.

Corrective direction: distinguish incoming storage updates from local intent and never echo them; persist the current accepted revision/value, not an obsolete notification. Treat coupled settings as one atomic state transition. Merely changing the visible control cannot repair this transport behavior.

### S2. Gizmo coupling can resurrect a setting after it was switched off

**Confirmed stale-event race; insufficient alone for indefinite back-and-forth.** `src-js/views-editor/src/tunni-gizmos.js:85–102` installs asynchronous listeners in both directions: entering generated-gizmo mode enables curvature; leaving it disables curvature and on-curve gizmos; a notification that either gizmo became visible re-enables mode. A queued curvature=true notification can run after a newer mode=false assignment and switch mode back on. It examines the old event value, not the current visibility value.

The reverse listener only assigns mode=true. It cannot supply the recurring mode=false assignments needed for sustained oscillation. S1 or another state writer is therefore needed to explain an indefinite loop. Coarse-grid visibility has no equivalent coupling in the inspected binding (`panel-designspace-navigation.js:1402–1418`), making S1 the stronger shared hypothesis. Grid-spacing normalization is a separate setting path and already includes sender guards; it should not be confused with visibility.

### S3. Current widget setters do not themselves emit change events

Read-through of `src-js/fontra-webcomponents/src/segmented-control.js` and `labeled-toggle.js`: assigning `.value` or `.checked` updates rendering/state; only user click/input handlers dispatch `change`. The panel bindings write settings on change and reflect settings back into those properties (`panel-skeleton-parameters.js:412–425`; coarse-grid binding above). This rules out a simple setter-emits-change recursion in these widgets and supports investigating shared state first.

**Most useful discriminator, not performed:** whether closing all other same-origin editor tabs stops the oscillation. If it does, inspect the sequence of storage values and their originating documents. If it does not, capture the setting key, old/new values, sender and assignment stack inside the existing model setter to identify the missing false writer. A browser event trace would distinguish these hypotheses; no instrumentation has been added.

## RAM growth: inherited ownership defects

### M1. Highest-priority lead: HarfBuzz callbacks remain rooted in the WASM function table

**Strong static evidence of retained callbacks and shapers, not a reproduced out-of-memory diagnosis.** The lockfile pins `harfbuzzjs` 1.4.0, also present in the upstream comparison. The locally available package has that exact version. Its implementation was read directly, including the generated module; no dependency was installed or executed for this investigation.

There are two related retention paths:

- `src-js/fontra-core/src/shaper.js:121–140` registers nominal-glyph and horizontal-advance callbacks that close over the `HBShaper` instance. In `node_modules/harfbuzzjs/dist/index.mjs:904–909,988–998`, each registration allocates a function-table entry using `Module.addFunction`. The callback is passed to HarfBuzz with a null destruction callback. These setters neither store the entry for later removal nor release it. The generated `dist/harfbuzz.js` implements `addFunction` by placing the callback/wrapper into the WASM table; `removeFunction` clears that slot, but these paths never call it. Consequently the table can retain the JS callback, which retains the shaper, which owns its font, face, blob, glyph order and associated closures. Replacing a shaper does not make that older graph unreachable.
- `shaper.js:151,192–201,287–403` allocates a buffer for each nonempty shape and conditionally installs a message callback. `dist/index.mjs:1218–1225` allocates another function-table slot for each `Buffer.setMessageFunc` and again provides no destruction callback or removal. This path runs with shaping-debugger tracing **or** lookup-positioned emulated feature insertion; it is not restricted to the debugger. Every invocation creates a fresh closure. That closure captures the shaper and per-call state, including the message array when tracing. Old trace arrays can remain retained even after the shaper replaces its current `_messages` field.

The first path grows with **shaper creation**. `shaper-controller.js:69–111` constructs replacements; `scene-controller.js:507–526,570–602` requests them at initialization and on glyph-map, feature, glyph-info and shaper-invalidation notifications. It even requests the real shaper alongside the fallback shaper in `updateShaperInfo`, regardless of which is currently selected. Thus merely disabling text shaping does not guarantee that no HB shaper was constructed. The second path grows with **layout/shaping calls while message callbacks are required**, including normal editor scene layout (`scene-model.js:554–667`), not a separate kerning view.

Important counterevidence: the library *does* use `FinalizationRegistry` to destroy ordinary blob/face/font/buffer handles (`dist/index.mjs:8–14,134,157,450–471,1109–1112`). Therefore “there is no explicit buffer.destroy() in Fontra” is not itself a leak finding. The defect here is the rooted callback ownership and missing function-table cleanup, which ordinary handle finalization does not solve. Font callbacks also create temporary referenced Font wrappers per invocation; their deferred cleanup adds possible native-memory pressure, but is not by itself proof of permanent retention.

This is a substantially stronger lead for large RAM growth than retained cache-key strings. However, neither path allocates forever in a completely inactive page: continuing growth requires new shapers, new message-enabled shape calls, or another producer. It also cannot establish how far back the user's historical symptom began; the verified statement is that the current fork and its comparison upstream contain this integration and dependency version.

Corrective direction: audit/fix callback ownership in the dependency with the appropriate HarfBuzz destroy-notify lifecycle and explicit function-table removal. Avoid a finalizer design whose own callback closes over and roots the object it should free. Reusing shapers can reduce allocation frequency but does not repair the per-buffer callback leak. Any dependency upgrade should be checked for this specific fix rather than assumed to solve it.

### M2. Glyph-instance cache evictions delete the wrong bookkeeping key

**Confirmed inherited cleanup bug, smaller retained payload.** In `font-controller.js:636–661`, the LRU returns `{key, value}` for the evicted instance. Cleanup obtains the evicted glyph name but deletes **the incoming `instanceCacheKey`**, not `deletedItem.key`, from that glyph's companion Set. It then adds the incoming key. For a sequence of distinct locations, evicted keys remain recorded indefinitely despite the instance LRU's 2,000-entry limit.

`_purgeCachesRelatedToAxesAndSourcesChanges:917–927` additionally clears the LRU without clearing its companion index. `_purgeInstanceCache:908–914` and `reloadEverything:933–940` do clear the relevant metadata, so the lifetime is conditional on those invalidations. Retention is primarily strings and Set entries: this bug does **not** prove that the evicted geometry objects remain alive. It can grow during prolonged variation-location exploration without edits; it does not grow merely because time passes. Corrective direction: delete the evicted key and clear both structures together, including unresolved/failed-instance cases.

### M3. Disconnected or unanswered RPCs have no settlement/cleanup path

**Confirmed missing failure cleanup; growth depends on requests and failures.** `src-js/fontra-core/src/remote.js:127–149,176–200` deletes `_callReturnCallbacks[id]` only when the corresponding server response arrives. Close/error handlers do not reject and remove outstanding calls, and there is no request deadline. Reconnection retains the same callback map but does not resend those calls. Lost requests therefore retain pending promise resolution functions and potentially the awaiting callers' state for the lifetime of the RemoteObject. Continued requests under repeated failure can accumulate more.

This could appear unprovoked when background requests encounter a backend/network problem, but code review does not prove that such requests were active during the reported incident, nor the size of their retained graphs. An idle healthy connection does not continuously add entries. Corrective direction: settle all in-flight requests on connection loss and bound request lifetime, with a deliberate reconnect/retry policy.

### M4. Undo history has no memory budget, but this is not an idle leak

`font-controller.js:959–973,1315–1345` retains forward changes, rollback changes and undo information in per-glyph stacks without a count/byte limit. Ordinary glyph LRU eviction does not discard these histories. Large edits across many glyphs can retain substantial intentional history. `GlyphEditContext.editFinal:1289–1310` pushes the record at the end of the edit: this is **not a history snapshot for every drag frame**. External glyph reload clears the affected stack. This is a resource-policy concern, and fits accumulated editing load better than growth during inactivity.

### Distinguishing the RAM paths

| Retained owner | What would support this diagnosis | What would weaken it |
| --- | --- | --- |
| WASM function table → callback → HBShaper / trace state | Increasing old shaper count or message-callback closures despite replacement and collection | No HB shapers or message-enabled layout calls in the affected session |
| `_glyphInstancePromiseCacheKeys` | Sets keep growing while live instance cache remains at its limit | No new glyph/location combinations |
| `RemoteObject._callReturnCallbacks` | Outstanding entries survive disconnect/reconnect | Responses settle normally and map drains |
| `FontController.undoStacks` | Retained size follows completed edits and change payload size | RAM grows without edits |

These are code-derived discriminator suggestions, not measurements performed. A heap retaining-path snapshot and browser process-memory breakdown are still needed to attribute a particular all-RAM event. No unconditional autonomous allocation loop has been established by this review.
