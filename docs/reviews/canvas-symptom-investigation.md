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
