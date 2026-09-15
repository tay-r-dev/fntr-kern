# Directed investigation: zoom stalls, oscillating settings, RAM growth

Source: `ui/ux-refactor` at `02bbd755925f4eb8a5f00fc248853aac7ba1f756`. Static code review only; no application changes, tests, benchmarks, or runtime reproduction. Inherited-source comparison: `1066c5cb3f0f0442037d9ea6394ab516553ca44c`. References below use paths relative to the repository; line numbers refer to that source snapshot. This report investigates the reported symptoms rather than repeating the general optimization inventory or the fork audit. Kerning view is excluded.

**Updated symptom constraint:** the user reports slow, continuing RAM consumption without user input, potentially exhausting 32 GB. Ordinary editing history and cache occupancy are not adequate explanations for that observation. M1 remains a retention defect, but is not a complete idle-growth diagnosis without identifying a producer that continues calling it. The idle-producer follow-up below supersedes the earlier investigation priority for this specific symptom.

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

## Zoom stalls after a pause

### Z1. The overlay workload is real, but does not by itself explain the cold/warm timing

The wheel path is `canvas-controller.js:193–224` → `_doPinchMagnify:288–307` → `editor.js:1437–1440` → `VisualizationLayers.scaleFactor:33–36`. It changes the transform, invalidates layer parameters, schedules a canvas draw, and dispatches a view-box notification. Layer rebuilding happens on subsequent draw (`visualization-layers.js:54–85`). It happens on **every magnification change**, not just the first one after a pause.

SpeedPunk (`visualization-layer-definitions.js:1968–2032`) recomputes sample quads and creates/fills Path2D objects each draw. The existing fork audit's V1/V4 already covers its parameter-scaling and repeated-work defects; these are supporting evidence here, not new duplicate findings. They make allocation/collection and drawing cost credible contributors, particularly with complex glyphs. However, no warm sample cache or seconds-based expiry exists in this draw path. Geometry work should recur during continuous zoom too.

Measurements need to be distinguished by layer. The two-selected-point distance/angle overlay (`distance-angle.js:545–605`) handles one pair. The all-handle labels (`drawPointLabels:1188–1393`, invoked by `visualization-layer-definitions.js:2556`) traverse contours and then scan decomposed segments again for each off-curve point to determine whether it belongs to a cubic. That membership phase can approach O(points × segments), with fresh decomposed data and label drawing on each repaint. This is a much stronger measurement-specific workload suspect than the single distance badge. It still has no time-based cache explaining several seconds of warm behavior.

For a future fix, determine cubic membership once per path revision and separate geometry-derived values from zoom-dependent label placement. Cache SpeedPunk geometry using explicit path/settings validity, as already recommended in the fork audit. These would reduce per-frame work; they should not be presented as proven cures for the pause-triggered stall.

### Z2. Deferred view-state serialization is a separate main-thread contributor

`editor.js:215–224,354–357,3958–3973` schedules persistent view-state updates after 200 ms without a superseding update. View box is part of that state. `utils.ts:625–626,646–673` performs JSON serialization, synchronous zlib compression and base64 encoding before comparing/writing the URL fragment. This work is postponed during continuous interaction and runs after a pause. Its cost depends on the entire serialized view state, including text and selection, not just four view-box coordinates.

This is a plausible explanation for a delayed hitch around gesture boundaries, especially with large editor text/state. **Its actual timeout is 200 ms; it is not a demonstrated multi-second cooldown, and it is not called synchronously at the start of each zoom.** It can delay a subsequent gesture only if the work or resulting browser work overlaps it. There is no timing measurement here. Corrective direction: keep serialization outside the interaction-critical task and avoid recompressing unrelated large state for every view-box update, while preserving shareable URL behavior.

### Z3. Checks that narrow the explanation

- `representation-cache.js` stores representations on their owners until explicit invalidation; it has no idle expiry. An assertion that geometry is deliberately evicted after a few seconds is unsupported in the inspected implementation.
- `scene-model.js:95–150` updates scene layout for text, shaping, selection and glyph/location changes; its principal layout listeners do not include viewBox. `scene-controller.js:311–345` guards view-box reflection using sender identity and actual rectangle comparison. Ordinary zoom does not directly request a new shaper through these paths.
- The document wheel-target guard (`canvas-controller.js:59–74`) resets after 100 ms. It can reject scrolling started outside the canvas, but it is not a costly geometry operation or a seconds-long timeout.
- Tunni reveal uses a hover delay and bounded-duration animation (`tunni-gizmos.js:255–420`); it can request extra redraws during reveal, but the inspected timer does not expire a geometry cache.
- The existing real-time review R04/R05 describes timer-based draw scheduling and repeated DOM geometry reads. Those can amplify main-thread stalls. They do not independently establish the observed cold/warm cycle.

**Conclusion:** overlays are credible cost amplifiers; the specific after-pause root cause remains unconfirmed. The shortest useful future trace would cover the end of one zoom, the idle gap, and the next first wheel event. Distinguish time in `computeSpeedPunkSamples` / `drawPointLabels`, synchronous URL compression, layout/style work, garbage collection, and canvas/browser rendering. JS code inspection alone cannot attribute browser-native cache behavior or prove a GC pause. No profiling or tests were run.

## Priority and investigation coverage

1. **RAM:** investigate M1 first because its retained graph includes whole shapers/font resources and per-call trace state. M2 and M3 are independently actionable inherited cleanup defects; neither is proof of the reported all-RAM event.
2. **Switches:** S1 is the strongest explanation shared by both controls if multiple same-origin editor documents are open. S2 adds a concrete one-tab stale-event race for Gizmo mode, but does not alone explain endless alternating state.
3. **Zoom:** distinguish overlay CPU time from the post-gesture serialization task and collection/rendering costs before choosing a fix. No cold-cache expiry was found.

Read-throughs covered the observable dispatch/storage implementation, both current widget implementations and panel bindings, gizmo coupling/reveal, canvas wheel/draw logic, visualization orchestration and the relevant SpeedPunk/measurement functions, view-box and URL persistence listeners, representation and LRU caches, font instance eviction/invalidation/undo/request ownership, RemoteObject request settlement, HBShaper construction/shaping/message integration, ShaperController replacement callers, and the installed HarfBuzz 1.4.0 callback/finalization implementations. The inherited files `observable-object.ts`, `font-controller.js`, `remote.js`, `shaper.js`, and `shaper-controller.js` are unchanged between the comparison upstream and reviewed fork snapshot. This is a directed investigation, not an exhaustive proof of all application or browser memory ownership.

## Follow-up: growth with no user input

The required explanation now has two parts: an autonomous or externally driven producer, and an accumulation mechanism. Finding a leak in a function that is never called while idle is insufficient. No 32 GB estimate is inferred from the static findings.

### I1. Inherited glyph-cache classification can feed back into its own input

`shaper-controller.js:53–59` subscribes to glyph-cache changes and debounces a scan of cached glyph names by 10 ms. `updateAdHocMarkSetFromCachedGlyphs:242–246` filters names using membership in `_adHocMarkGlyphs`, then starts `updateAdHocMarkSet` without awaiting/returning its promise. That method (`212–239`) awaits `getGlyphInstance(name, {})` for every name.

Two concrete weaknesses matter for background work:

- For an unrecorded non-mark, `isAdHocMark` is false and `!!this._adHocMarkGlyphs[name]` is also false. The conditional assignment does not run. Consequently the supposedly already-checked filter never remembers these negative results, so later cache notifications schedule them again.
- The debounce cancels only pending starts. It neither cancels nor serializes asynchronous scans already running. Additional notifications during a scan can start overlapping scans.

`font-controller.js:449–466` increments the cache notification counter on glyph-cache misses. Classification instantiates glyphs and may load their components. With eviction/component-loading churn, that consumer can therefore produce more cache notifications and more scans, even after input stops. This is a **conditional feedback candidate**, not a demonstrated infinite cycle: a stable working set whose instances remain cached can drain and become idle. Repeated negative classifications alone also do not invalidate the shaper, since `didChange` stays false. A complete link from this path to perpetual M1 shaper creation has not been established.

Corrective direction: record both positive and negative classifications, track pending names, and serialize/coalesce classification work. Check whether scans introduce cache misses and outlive their triggering state before attributing the reported idle runaway to this path.

### I2. Other inspected idle producers and their limits

- The fork's snapping-debug readout (`panel-designspace-navigation.js:1836–1849`) does schedule animation frames forever; visibility gates text replacement, not scheduling. This is continuing background work, but each update replaces text rather than appending retained history. It also cannot explain the user's pre-fork history. It is not evidence of a 32 GB leak by itself.
- Tunni reveal stops scheduling when tweens finish (`tunni-gizmos.js:400–420`); it is not an unconditional permanent redraw loop.
- Incoming backend changes can reload state without local input (`view-controller.js:122–149`). Initial inspection of `src/fontra/backends/filewatcher.py` shows change-driven callbacks and self-write filtering, and `src/fontra/core/fonthandler.py:114–149` waits for a write event and drains pending writes. Their `while`/watch loops are not by themselves evidence of busy allocation. Repeated filesystem notifications remain a possible external producer, not a confirmed notification storm.

The next decisive fact is **which process grows**: browser renderer/tab, browser GPU process, or Fontra/Python backend. These lead to different ownership investigations. Total system RAM consumption alone does not locate the leak. No profiling, reproduction, or tests were performed for this follow-up.

## Fork-inclusive browser idle-memory follow-up

The user subsequently confirmed **browser RAM growth without input**, and requested that fork code remain in scope despite the historical pre-fork symptom. Accordingly, the following checks examine fork-specific producers and ownership as possible additional causes or amplifiers. They do not presume the historical and current incidents have the same cause. No tests or application changes were made.

### F1. Debug readout: permanent producer and missing teardown, not demonstrated continuous retention

Expanded the I2 read-through to `_setupSnappingDebugControls`, `_startSnappingDebugReadout` and `_formatSnappingReadout` in `panel-designspace-navigation.js:1731–1868`. The animation callback always schedules its successor, even when the panel is hidden. When visible, it allocates formatted lines, sorted entries and a joined string, then replaces `textContent`. No historical array of those strings or nodes is retained by this code. One callback chain is pending per setup, not one additional permanent chain per frame.

There is a real lifecycle weakness: no frame handle is saved for cancellation; the closure retains the panel/editor and DOM references. The same setup ignores the unsubscribe returned by `subscribeSnapParameters` (`snapping.js:303–307`), allowing the module-level listener Set to retain the panel too. However, the normal startup path constructs one DesignspaceNavigationPanel (`editor.js:1256`) and invokes its setup from its initialization promise (`panel-designspace-navigation.js:467–469`). Merely hiding/reopening the panel has not been shown to construct more instances or start more chains. Thus accumulating detached panels is conditional on reconstruction, not established as the explanation for growth while an unchanged page sits idle.

Corrective direction: schedule only while visible, skip identical text, cancel on disposal, and retain/call the subscription cleanup. These address unnecessary background allocation and lifecycle retention without claiming they account for 32 GB.

### F2. Gizmo and snapping animations: normal transitions terminate

`tunni-gizmos.js:282–420` has one pending reveal timer and one pending animation frame per reveal instance. Replacing a pending hover clears its timer. Fading old alpha/hot entries to zero removes them from `_tweens`; completed active entries hold only small numeric transition state and keys. `_animate` reschedules only while a tween remains in progress. `edit-tools-pointer.js:164–170` shares one reveal on the scene model rather than creating a new one per hover or pointer tool. This does not support an autonomous geometry-history leak.

`visualization-layer-snapping.js:17–34,174–240` holds module-level state for one indicator and permits one pending frame. The draw requests another frame only while the 180 ms transition is incomplete. Stable indicator state stops the chain. State is global to the module, so distinct scene controllers drawing different states could interfere, but multiple such active scenes in the inspected editor startup were not established. Do not label this a proven infinite animation loop.

### F3. Settings oscillation can drive expensive fork redraws after input stops

The already-documented S1/S2 feedback deserves consideration as an **idle producer**, not only a switch defect. `editor.js:197–200` immediately handles every visualization-setting change by invalidating the layer configuration and requesting a canvas redraw. Coarse-grid changes also request redraw through `scene-controller.js:612–615`. Therefore continuing settings oscillation can keep the canvas allocating/drawing geometry without further user input.

This establishes a route from settings churn to repeated overlay allocations. It does **not** establish monotonically retained geometry: the inspected SpeedPunk and skeleton drawing paths create temporary geometry without appending it to a permanent collection. It also does not directly call `updateShaperInfo`; the connection to M1 cannot simply be assumed. Timer/event backlog, GC/native allocation behavior and actual settings activity would need evidence to connect this producer to the RAM incident.

The debug parameter subscriber (`panel-designspace-navigation.js:1826–1829`) synchronizes controls and persists a fresh settings object; it does not call `setSnapParameter` again. The inspected setup therefore does not establish a synchronous self-recursive notification loop. The shared asynchronous storage transport remains the separate risk described in S1.
