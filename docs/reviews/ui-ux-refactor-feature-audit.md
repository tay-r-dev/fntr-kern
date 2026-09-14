# Forkra feature audit: ui/ux-refactor

Review target: `02bbd755925f4eb8a5f00fc248853aac7ba1f756`.
Upstream: `fontra/fontra`, inspected at `ba03f8917e4df6cd783e755dd372b519b1f3225f`.
Comparison base: `1066c5cb3f0f0442037d9ea6394ab516553ca44c`, the merge base of upstream and the target. The older `googlefonts/fontra` repository is archived; comparing only with it would misclassify later upstream work as fork additions.

This review covers fork-specific features, with priority on skeleton editing and visualizations. It assesses correctness and code quality, performance, and consistency. It changes no application code. Findings are committed after each primary file review; related files are traced where needed. This is a growing report until the coverage ledger is complete.

The reference set starts at `docs/superpowers/START-HERE.md`: glossary, architecture map, feature model and development log. Code takes precedence where those documents disagree. Ponytail's Markdown review guidance was read from a separate clone, without installation. Its simplicity checks supplement this review; they do not replace correctness checks. The requested `ste-writing` skill is not present in the repository or available skill directories; this report uses plain language.

P1 means a wrong result or serious scaling failure in a supported workflow. P2 means a bounded functional defect or significant avoidable cost. P3 means maintainability or presentation debt. “Confirmed” identifies executable evidence or a direct, complete code path; it does not imply a browser test. Timings are local Node 24.19.0 measurements, not browser frame-time claims.

## Review ledger

| Primary file | Lines at target | Review and result |
| --- | ---: | --- |
| `src-js/views-kerning/src/kerning.js` | 8,330 | Run, cache, source, table, class, preview and undo paths reviewed; K1–K7 below. Related worker/cache findings are included here. |
| `src-js/fontra-core/src/skeleton-generator.js` | 6,743 | Generation pipeline, cleanup, corners, cap construction, provenance and generation-option callers inspected; S1–S6. Static review, not a proof of the numerical solver. |
| `src-js/fontra-core/src/skeleton-model.js` | 5,859 | Schema, topology operations, ID transport, width/rib rules, generated-target lookup, transforms, rounding and cache ownership inspected; M1–M6. |
| `src-js/views-editor/src/editor.js` | 4,307 | Fork diff and surrounding clipboard, delete, bulk metrics, tool lifecycle and registration code inspected; E1–E4, S2 and M3. |
| `src-js/views-editor/src/panel-designspace-navigation.js` | 3,895 | Fork-added visual controls, persistence, debug polling/subscriptions and source creation inspected; D1–D3 and M5. |
| `src-js/views-editor/src/scene-controller.js` | 3,062 | Fork command dispatch, arrow edits, skeleton conversion, mixed selections, harmonization, overlap and undo integration inspected; C1–C4. |
| `src-js/views-editor/src/visualization-layer-definitions.js` | 2,634 | Fork rendering additions and visibility filters inspected, including supporting `curvature.js` implementation; V1–V5. |
| `src-js/views-editor/src/scene-model.js` | 2,614 | Fork hit-testing, generated-path filters, drag readouts, measurement state and shaping changes inspected; SM1–SM3. |
| `src-js/views-editor/src/panel-skeleton-parameters.js` | 2,612 | Parameter controls, streaming edits, preset identity, source defaults, selection refresh and dispatch inspected; PS1–PS3. |
| `src-js/fontra-core/src/harmonization.js` | 2,452 | G2/G3 construction, candidate ranking, rounding, convergence, reports and balance inspected; H1–H5. Numerical accuracy is not exhaustively established by static inspection. |
| `src-js/views-editor/src/skeleton-editing.js` | 2,138 | Mutation/rollback pipeline, remapping, point/rib/insertion/generated-handle drags and tension adapters inspected; SE1–SE3, S2 and M4. |
| `src-js/views-editor/src/panel-transformation.js` | 2,109 | Transform/stream paths, bounds, boolean linkage, alignment, origin picking and harmonization UI inspected; T1–T5. |
| Remaining feature files | — | Pending; final coverage inventory will distinguish deep review from supporting inspection. |

## 1. Kerning view — kerning.js

The view correctly reuses Fontra's scene and metrics tools. Pair writes use the selected source identifier. Cache loads have a revision guard, and preview displacement is based on saved original positions, avoiding accumulation on repeated paints. These are useful foundations. The integration is not yet consistent enough to call optimal.

### K1 — P1, confirmed: autokern measures the default source under another source's name

Locations: `kerning.js:1353`, `1660`, `2065`; `font-controller.js:636–675`; source selection at `kerning.js:5929–5986`.

Full runs, scoped reruns and metrics recalculation all call `getGlyphInstance(glyphName, {})`. That API uses the supplied location; it does not read the view's selected source. Meanwhile `job.source` and the cache filename use `autokernSource`. Choosing Bold therefore labels measurements of the default location as Bold and can apply those suggestions to Bold's kerning. The scene itself changes location, making the disagreement harder to notice.

Evidence: executing the actual `runAutokern` method in the same VM style as the existing controller tests, with selected source `bold` at `{wght:900}`, recorded `{}` for each of `l`, `n`, and `o`, while the submitted job said `source: "bold"`. Existing source tests exercise kerning reads/writes, not raster input selection.

Recommendation: capture the selected source's source-space location with the run, and use it for every raster and metrics read. Cover full run, scoped run and recalculation with distinct master geometry.

### K2 — P1, confirmed: Cancel cannot interrupt the worker and can still install its result

Locations: `kerning.js:2165–2237`; `autokern-worker.js:45–153`.

`runJob` is declared async but has no await in calibration, candidate enumeration or the pair loop. The worker cannot receive the queued cancel message until that work finishes. The main thread waits for `runResult` on Cancel. The worker posts `done` before it handles Cancel, and the main thread's done handler installs and saves the cache without checking whether the user cancelled. The caller then reports cancellation even though results were installed; coverage/metrics updates after a successful return can be skipped.

Evidence: executing the actual worker body with a deterministic stub engine and a queued cancel produced `calibration, progress, progress, done, cancel-delivered`; all nine pairs ran. This isolates event-loop behavior, not engine speed.

Recommendation: either terminate the disposable worker on Cancel and refuse all late messages, or process bounded batches that yield to message delivery. Keep the entire run result local until success is accepted. Use a run identifier and geometry/source revision, not just a final source-name comparison.

### K3 — P1, measured: the worker copies the whole pair cache for every pair

Locations: `autokern-worker.js:128–146`; `autokern-cache.js:setPairValue`; `kerning.js:1988–1994`, `5125–5128`.

The worker uses immutable `setPairValue`, which creates `new Map(cache)` for each result. For P accepted pairs, a first run copies roughly P(P−1)/2 entries; a rerun copies the already-full map P times. With G glyphs, P can approach G², making cache maintenance alone approach G⁴. The worker owns its cache exclusively, so the copies preserve no consumer-visible snapshot. Junk overlay and multi-glyph stale marking also repeat whole-map copies.

Evidence, calling the production helper on an initially empty cache: 2,000 pairs took 96 ms; 4,000 took 415 ms; 8,000 took 2,466 ms. This excludes rasterization and the kerning solve. It is a scaling measurement, not a total-run benchmark.

Recommendation: build or update one worker-local map, publishing once. Add a batch operation for main-thread overlays. Keep immutable operations where observers actually depend on old snapshots. Transfer typed raster buffers rather than expanding them to plain arrays (`kerning.js:2079`) and reconstructing them in the worker. Candidate enumeration also materializes multiple O(G²) collections; stream or batch candidates once cache copying is removed.

### K4 — P2, confirmed by data flow: table refresh destroys the pair-preview fallback before reading it

Locations: `kerning.js:3737`, `3776–3789`, `3962–3990`, `7712–7758`.

`renderPairTable` clears `_pairTableItems` and the class-member maps before calling `expandHighlightedRowsToPairs` to preserve the previous selection. That function iterates `_pairTableItems`, so `pairsBeforePrune` is always empty at this call. A selected row removed by an edit or filter has no fallback, despite the comment promising to preserve pair mode. With no explicit pair filter, `updatePairPreview` can return to phrase mode.

Recommendation: capture the previous selected pairs before clearing any old table model or address map. Test a real refresh that removes the last selected row, not only the standalone preview helper.

### K5 — P2, confirmed: ordinary class creation and assignment have no local undo record

Locations: `kerning.js:4983–5010`, `5066–5079`, `7427–7462`, compared with `4764–4890`, `5337–5391`, `5541–5573`, `8165–8189`.

`addGlyphsToClass` writes each membership and refreshes the UI, but never records before/after membership in `autokernUndoStack`. New-class and font-grid assignment paths call it. Derived-class acceptance, deletion and removal do create such records. The same user action category therefore has different undo behavior depending on its entry point. Font-grid assignment additionally calls this helper once per glyph, rebuilding the full table and class list after every member.

Recommendation: use one batch membership operation that collects successful before/after changes and pushes one undo record. Refresh once after the batch. Preserve the existing partial-failure handling rather than introducing a second policy.

### K6 — P2, confirmed; documented tradeoff: a bounding-box fingerprint can incorrectly clear genuine shape staleness

Locations: `kerning.js:383–392`, `1347–1390`; `autokern-cache.js:343–430`.

The metrics-only shortcut treats equal coordinate count, ink width, y-min and y-max as proof that the shape stayed the same. Moving a non-extreme handle or an interior point can preserve every field while changing the outline's spacing profile. Recalculation then keeps the old suggestion and clears `stale`, reporting it as current. This is a known Ponytail simplification in the source comment, not a newly discovered hidden assumption. It is still a correctness tradeoff, not an optimization with equivalent results.

Evidence: a production `recalculateMetricsOnly` call with a stale pair and equal fingerprints returned the same value with `stale: false`. The fingerprints contain no information that can distinguish an interior outline edit from no edit.

Recommendation: compare geometry normalized for x-translation, including point types, contours and flattened components, or refuse to clear shape staleness unless the change is known to affect metrics only. Verify with an interior-handle edit that preserves bounds.

### K7 — P3, code quality: state ownership and repeated refresh lists are the costly part of the monolith

The 8,330-line controller owns worker lifetime, persistence, source state, class edits, table derivation, row DOM, preview layout and multiple undo domains. Size alone is not a defect, but K1, K2, K4 and K5 show concrete disagreements across these responsibilities. Repeated refresh lists have already caused faults recorded in the development log. The file also repeats long histories beside current behavior, some no longer true (for example the working preview fallback claim).

Recommendation: first consolidate the source-bound run lifecycle and batch class-edit operation, then let the existing results model own table derivation. Reuse the shared data table. Do not split every method into a file or replace the existing scene with a second implementation. Move historical narratives to the development log; keep contracts beside code. No defensible net line/dependency saving is claimed without an implementation.

## 2. Skeleton generation — skeleton-generator.js

This file is entirely fork-specific at the comparison base. The staged solve, insertion, join, rounding and cap pipeline is a useful separation. Coupled rib widths are computed once for the solve, and insertions commit both sides together. Publishing construction geometry for trimmed handles is also preferable to reconstructing it from rounded display coordinates. These choices should be retained.

### S1 — P1, confirmed by code and algebra: cleanup can delete real curve geometry

Locations: `skeleton-generator.js:506–579`, called on the complete open-stroke outline at `3216–3218`.

`removeCoincidentOnCurves` deletes all intervening handles whenever the two on-curves coincide within tolerance. Equal endpoints do not establish a collapsed curve: a cubic from (0,0), through (100,100) and (-100,100), back to (0,0) has a nonzero loop. This routine deletes that loop without examining either handle.

`removeStraightSegmentHandles` checks perpendicular distance to the infinite chord line but not extent along it. For a cubic with x coordinates 0, 200, 200, 100 and all y coordinates zero, the midpoint is x=162.5. Replacing it with the line from 0 to 100 loses the overshoot. The comment that doubling back still draws the same straight line confuses the supporting line with the occupied segment. This is an algebraic counterexample, not a newly executed test.

The setting lives under serif defaults, but cleanup runs over every point in every open skeleton outline, including non-serif strokes. Its geometric assumptions must therefore hold for the whole output. Closed skeletons return earlier at `2741` and never run cleanup: either document that scope explicitly or move a safe cleanup into shared finalization. The closed/open difference alone is a scope inconsistency, not proof that closed strokes were intended to be cleaned.

Recommendation: drop a coincident-endpoint segment only when its entire curve is collapsed; remove collinear controls only when the curve stays within the replacement segment and the intended traversal is preserved. Keep topology-changing cleanup opt-in, as it already is.

### S2 — P1, confirmed cross-file mismatch: regeneration options are not tied to the layer being edited

Locations: `editor.js:228–246`; `skeleton-editing.js:219–284`, `1735`; `skeleton-panel-edits.js:1400`, `1577`; `tunni-interactions.js:407`; `skeleton-generator.js:130–133`, `6484–6523`.

The central edit path obtains options from a module-global zero-argument reader. The editor installs a reader using its active scene location. It does not receive the edited layer or that layer's source location. When multiple source layers are edited together, each generation therefore receives the active source's serif units and cleanup policy, even if the sources differ.

Separately, reset, detach/reattach and pin-baking calculations call `generateFromSkeleton(scratch)` without options. That means absolute serif units and cleanup disabled. The subsequent actual edit uses the active source's options. With normalized serif units, a stored length of 0.2 at stroke width 100 means 20 units in the actual outline but 0.2 in the scratch calculation. Offsets calculated against those different constructions cannot generally preserve position. Cleanup can also change which handles exist between the two calculations.

Recommendation: resolve a generation context for each edited source layer and pass it explicitly through actual and scratch generation. A single context should describe both sides of every position-preserving calculation. Avoid another implicit reader dedicated to scratch paths.

### S3 — P2, static complexity: cleanup and corner processing introduce avoidable quadratic work

Locations: `skeleton-generator.js:555–579`, `1441–1486`, `1489–1497`, `1525–1619`, `1766–2070`.

For each on-curve, cleanup copies and reverses the entire growing `kept` array to find the previous on-curve. A contour with N ordinary on-curves therefore allocates and visits O(N²) entries even when no point is removed. Maintain the last retained on-curve directly.

The inner-corner pass repeatedly searches from index zero and reconstructs the contour after each merge. Rounding repeatedly splices into a growing array. With O(N) corners these also reach O(N²) bookkeeping, before curve solving. These paths run during regeneration on drag frames. This is a complexity finding; no new timings or frame-rate claim are made.

Recommendation: remove the needless cleanup copies first. For corner processing, collect candidates and use a controlled traversal or emission pass that preserves adjacency and wrap-around semantics. Keep edits local to the generation-owned arrays; no immutable consumer requires a fresh full contour after each corner.

### S4 — P2, static complexity: the crossing search's guard does not bound its work

Locations: `skeleton-generator.js:1291–1292`, `1347–1385`.

`CROSSING_MAX_SPANS` is checked against the pending DFS stack length, not the number of spans processed. A depth-first subdivision can visit a very large search tree while keeping a small stack. Long coincident or nearly coincident spans keep overlapping until the fixed 0.01 coordinate precision is reached, so this guard does not provide the apparent 4,000-span work budget. The result list and subsequent clustering can grow as well. Returning a partial crossing list when the guard trips also does not distinguish incomplete search from a complete result.

Recommendation: count processed work explicitly, detect overlapping/degenerate spans, and return an explicit unresolved result when a budget is exhausted. The caller already supports retaining an unmerged corner when a crossing is not uniquely established. Preserve that fallback rather than accepting a partial search as a unique crossing.

### S5 — P2, confirmed data-flow mismatch: “respect changes” omits the final carried-handle displacement

Locations: `skeleton-generator.js:2114–2159`, `2184–2277`, `3953–4088`, `1194–1206`.

The single-sided conversion reads positions from `solveSkeletonContourSides`, copies its handles into the centerline, and clears the collapsing side's `handleNudge`. The solve stores carried displacement in `_handleNudge`; it does not add that displacement to the handle coordinates. The later `enforceSmoothColinearity` pass applies it. Thus the conversion takes pre-displacement handle positions and then erases the authored displacement that would have moved them. For a nonzero carried nudge, this does not preserve the edge as drawn, contrary to the conversion's contract. Final collinearity adjustments are also absent from the sampled solve.

Recommendation: provide an explicitly finalized, pre-cap side representation for this conversion, with authored carry applied exactly once and stable point ownership. Do not simply copy the fully capped outline into the centerline: cap topology does not match skeleton topology.

### S6 — P3, maintainability: unreachable cap implementations and eager debug payloads obscure the active path

Locations: `skeleton-generator.js:6603–6735`, dispatch at `2776–3176`; `5444–5451`; `5079–5087`, `5136–5142`, `5311–5329`, `5419–5440`, `3350–3361`.

Both active cap dispatches handle round and square before the fallback `generateCap` call. Its round and square implementations are therefore unreachable from these callers, leaving a second description of geometry that the app does not use. `assembleOpenOutlineWithRoundCaps` is also unused. Removing those private dead paths would reduce review and maintenance cost without introducing abstractions.

Debug payloads serialize points and allocate arrays before `logSkeletonDebug` checks whether logging is enabled. Gate construction at the caller or accept a lazy payload. This is a bounded allocation reduction, not evidence that debug preparation dominates generation time.

Review limits: the numerical cap/offset solvers were inspected structurally, not proven over all inputs. S1–S6 are based on source control flow, arithmetic and call contracts. No tests, benchmarks or browser runs were performed for this review installment.

## 3. Skeleton model — skeleton-model.js

The shared mutation helpers, ordinary-path harmonization reuse, and immutable-section normalization cache are sound architectural choices. The cache is a `WeakMap` keyed by the stored section object (`4642–4657`), so it does not by itself retain every discarded glyph revision. Local maps/sets are temporary. No unbounded global retention was identified in this file. Allocation churn below should not be described as a memory leak.

### M1 — P2, static complexity: rib queries repeatedly rebuild whole-contour data

Locations: `skeleton-model.js:3632–3652`, `3699–3710`, `3793–3848`, `4217–4265`; generator `271–303`; model `3240–3267`.

`getSkeletonRibPosition` calculates left and right effective widths, then calculates the requested side again for an ordinary two-sided stroke. Each call to `getEffectiveRibHalfWidth` rebuilds segments, serif-terminal sets, insertion-cut sets and all tied groups. Drawing both ends therefore makes six group builds per point on the ordinary path. Across N points this is at least O(N²) work, even when none of the points are tied. Normal and reach also call the same geometry calculation separately, and `indexOf` repeats point lookup.

The same overhead reaches generation: every normalized on-curve has a corner object, so `canonicalPointToGeneratorPoint` resolves corner distances even at default zero distance. Linked-corner resolution calls the same two full-contour width queries per point. The generator's later efficient `coupledHalfWidths` pass does not remove this earlier duplication.

Recommendation: derive point indices, normals/reaches, tied groups and effective widths once per contour revision and share them through a read context. At minimum, stop calculating unused widths and skip zero-distance corner geometry. Use per-operation data or revision-aware weak caches; a permanent map keyed by glyph names would create a retention problem while solving an allocation problem.

### M2 — P1, confirmed cross-file disagreement: width locks affect the rib reader but not the generator's coupled width

Locations: `skeleton-model.js:3699–3710`; `skeleton-generator.js:4172–4203`, `2396–2411`.

The model explicitly returns a locked side's own stored width instead of its tied group's mean. The generator computes the mean for every group member and resolves each width from that map without checking the copied `leftLockedWidth`/`rightLockedWidth` fields. With tied widths 20 and 40, a locked member storing 20 is read as 20 by the rib model but generated at 30. Changing a sibling can move the supposedly locked generated edge. The two consumers share group detection but not the complete width policy.

Recommendation: share the effective-width resolution as well as group collection, including lock behavior. Resolve once and use the same result for generation, rendering and editing constraints.

### M3 — P1, confirmed: insertion references are omitted from topology and identity operations

Locations: `skeleton-model.js:1575–1619`, `1642–1677`, `1743–1791`, `1900–1912`, `3556–3612`; paste caller `editor.js:2467–2477`.

These paths predate or incompletely integrate the separate insertion list:

- Paste rekeys contour and point IDs but neither allocates insertion IDs nor remaps insertion `pointId`. Regeneration normalizes insertions against the new on-curve IDs (`1270–1284`), so old references can be dropped or accidentally match a different point. The published `nextId` also excludes insertion IDs.
- Joining concatenates only `points`, then removes the absorbed contour. Its insertions are not transferred. When a contour is reversed for joining, its insertions retain the old segment start and parameter; the preserved geometric address should use the former segment end and `1 - t`, with side values transposed.
- Splitting an open contour clones its insertion list into the tail, but renames the split point. An insertion on the segment leaving that point retains the old ID and is lost from the tail during normalization.
- Deletion keeps an insertion whenever its start point survives. If the segment's end was deleted, the insertion is silently applied to the replacement segment, contradicting the comment that insertions on merged segments are removed.
- Reflection swaps ordinary point-side metadata but does not swap insertion width/easing sides.

Recommendation: define insertion transport alongside the segment operation, not as a later point-ID cleanup. Explicitly map retained segments, endpoints, direction and IDs. For operations that cannot preserve an insertion, make the removal policy deliberate and consistent. This is one cross-cutting feature integration issue, not five unrelated utility rewrites.

### M4 — P2, static allocation cost: repeated normalization copies data that the next stage discards

Locations: `skeleton-model.js:384–438`, `1226–1240`; `skeleton-editing.js:280–284`; `skeleton-generator.js:100–103`; model `5295–5462`; visualization `visualization-layer-skeleton.js:946`, `1013`, `1064`.

The edit path clones and normalizes the skeleton, then `generateFromSkeleton` normalizes it again. That second normalization deep-copies the old generated provenance, including construction snapshots, although `canonicalToGeneratorInput` never uses `generated`. The defaults reader similarly clones and normalizes all source defaults/preset arrays for a single scalar lookup; the editor asks it separately for units and cleanup on each regeneration.

Generated Tunni data is rebuilt separately by curvature, on-curve and label layers. Each build walks the packed contours, allocates point/provenance arrays, and repeatedly linearly searches skeleton points for movability and locks. This combines repeated linear allocation with potentially quadratic address lookup. The normalized-section cache does not cache these derived results.

Recommendation: normalize at the ownership boundary, expose a generation entry for already-normalized canonical input, and exclude obsolete derived provenance from that conversion. Read source defaults once per generation context. Build generated-segment descriptors once per geometry revision and share them among drawing and hit-testing, with path revision invalidation because packed paths can change in place.

### M5 — P1, confirmed unit mismatch: creating a source rounds normalized serif ratios as font units

Locations: `skeleton-model.js:4683–4729`; `panel-designspace-navigation.js:3044–3048`; generator `6484–6491`.

`roundSkeletonCoordinates` always rounds the serif length fields to integers. In normalized units these values are stroke-width ratios: 0.2 becomes 0 even though the generator interprets it as 20 font units at width 100. Source creation calls this routine without units context. It rounds the already-instantiated path separately but does not regenerate from the rounded skeleton at that point, so the stored outline and skeleton can disagree until the next edit, which then changes the shape.

Recommendation: pass the source's units mode, round only absolute lengths, and keep the canonical data and its derived outline synchronized when a new source is created. Preserve dimensionless ratios.

### M6 — P3, functioning but unnecessarily indirect code

`isFarSkeletonSegmentStraight` (`5465–5482`) has a loop whose first iteration always returns: it is a one-neighbor check disguised as a contour traversal. Replace it with that check, retaining the intended open/closed boundary rule.

`collectInsertionCutSegments` (`4513–4525`) scans every segment for each insertion. Build a segment-start lookup once with the rest of the contour context. `getGeneratedSegmentLocks` (`5421–5439`) repeatedly searches the same point list for four handle checks and two slide checks; reuse resolved addresses rather than repeating the search under different predicates.

There is no reason to replace every small side/role conditional with a class hierarchy. The useful simplification is to make data ownership and repeated derived work explicit. Existing finite-value checks and refusals at unsupported geometry should remain.

Review limits: source inspection only. Geometry helpers were traced through their consumers; this is not an exhaustive proof of all setter combinations or interpolation behavior.

## 4. Editor integration — editor.js

The review here targets the fork diff, not an audit of all inherited editor behavior. Existing window listeners and the root resize observer belong to the page-lifetime upstream controller; their existence alone is not evidence of a new memory leak. New tool classes are instantiated with the editor, rather than repeatedly on every selection.

### E1 — P2, confirmed: Cut copies a skeleton but does not remove it

Locations: `editor.js:1701–1744`, `1892–1955`, `1979–2083`, `2600–2603`, `2681`.

The clipboard sidecar copies contours selected through skeleton points, including when `doCut` is true. The actual cut helper only parses ordinary points, components, anchors, guidelines and background images. It never removes skeleton points or contours. Cut therefore behaves like Copy for a skeleton and then clears its selection. Alt-delete routes through the same helper and explicitly bypasses ordinary skeleton deletion, so it also leaves those points intact.

Recommendation: decide whether a skeleton cut means selected points or whole copied contours, then perform the matching removal through the existing skeleton edit path in the same undo operation. Keep clipboard selection and removal scope identical.

### E2 — P2, confirmed: pasted skeleton layers do not follow the regular layer-matching policy

Locations: `editor.js:2354–2377`, `2435–2440`, `2458–2461`.

Ordinary pasted outlines select a source layer by name, then location string, then first-layer fallback. The skeleton sidecar uses name, then first-layer fallback only. Copying between glyphs with equivalent source locations but different layer names can paste each ordinary outline from its correct source while giving every target layer the first source's skeleton. Subsequent regeneration follows that mismatched skeleton.

Recommendation: resolve one clipboard source-layer identity for each target layer and use it for both ordinary data and the skeleton sidecar. Do not maintain parallel fallback policies.

### E3 — P2/P3, functioning but wasteful: repeated parsing and complete regeneration within one delete

Locations: `editor.js:2554–2574`, `2640–2711`.

The delete handler parses the same selection three times. More significantly, a mixed skeleton-point/insertion deletion makes a full `editSkeleton` call for insertions and another for points, per layer. Each call clones, normalizes, regenerates the full skeleton, remaps generated contours and records changes. Only the final outline is needed. The intermediate generation also increases the complexity of reference-address handling.

Recommendation: parse once, resolve both sets against one pre-edit reference, and apply both mutations in one skeleton edit per layer. This preserves one undo operation while eliminating a complete generation pass. Marker deletion currently returns early and clears the whole selection; if mixed marker/object selections are supported, that path must either handle the remaining selected objects or preserve their selection rather than silently deselecting undeleted objects.

### E4 — P2, static scalability: font-wide metrics update repeatedly sweeps unchanged dependencies

Locations: `editor.js:3436–3540`.

The command loads every glyph sequentially to identify keyed glyphs, then resolves every keyed glyph on each pass, up to the full glyph count. A dependency chain settles one link per pass. In unfavorable order this means O(G²) glyph-resolution work and repeated backend commits/invalidations, while independent keyed glyphs are rechecked unnecessarily. The explicit confirmation and lack of multi-glyph undo are documented product choices; those are not reported as accidental defects.

Recommendation: derive the metrics dependency graph once, process acyclic dependencies in order, and isolate cycles according to the existing resolver's policy. Batch independent loads with a concurrency limit rather than serially awaiting each glyph or launching an unbounded `Promise.all`. Report affected glyphs, and retain progress/cancellation if the operation remains long-running. No runtime timing is claimed.

The module-global generation-options reader is covered by S2; insertion paste IDs are covered by M3. Avoid treating the same issue as an additional independent finding here.

## 5. Designspace and visual controls — panel-designspace-navigation.js

### D1 — P2, confirmed idle work; retention risk on removal: debug polling never stops

Locations: `panel-designspace-navigation.js:1826–1848`; `snapping.js:303–313`; base `panel.js`.

`_startSnappingDebugReadout` unconditionally schedules another animation frame. The visibility check only suppresses its body; it does not stop polling. It checks the accordion item, whose header can remain visible while its content is collapsed, instead of the readout's visibility. The loop also rewrites the text even when the readout has not changed. A debug aid therefore schedules work throughout the editor session.

The callback captures the panel, and there is no stored frame ID or disconnect cleanup. The global snapping subscription likewise returns an unsubscribe function that this panel discards. If a panel is removed or replaced within the same document, both are retention paths for the detached panel and its editor. This is a concrete lifetime hazard, not a claim that normal tab use creates an ever-growing number of panels: the current editor constructs this panel once.

Recommendation: start polling only while the readout is visible and a gesture is active, stop on close/disconnect, and update text only on change. Retain and invoke the subscription disposer. An existing gesture-update signal would eliminate polling entirely.

### D2 — P2/P3, functioning but redundant: snapping controls synchronize and persist twice per input

Locations: `panel-designspace-navigation.js:1740–1780`, `1790–1800`, `1817–1830`; `snapping.js:310–334`.

`setSnapParameter` synchronously notifies subscribers. The panel subscriber synchronizes every row and persists every parameter. The input handler then repeats that same full synchronization and persistence. Reset duplicates the same work. Each synchronization performs multiple DOM queries per row, even for unrelated scalar changes.

Recommendation: let the subscription be the single synchronization/persistence path, as the comment already claims. Capture control elements once during setup. Update dependent reach readouts when the master reach changes; other changes need only their own row and duplicate toggle. Keep whole-state persistence at commit/debounce boundaries where live persistence is not required.

### D3 — P3, consistency and maintainability: ordinary visual settings use several parallel binding styles

Locations: `panel-designspace-navigation.js:495–558`, `1162–1240`, `1402–1470`, `1506–1647`, `1870–1950`.

The same control lifecycle—read, normalize, display, write, synchronize an external change, persist—is handwritten differently for grid, SpeedPunk, measurement and Tunni controls. SpeedPunk alone maintains field getters, private state, scene settings and persisted app settings with separate lists. That is more state and repetition than the feature requires. Grid and SpeedPunk settings also have different external-change synchronization paths.

Recommendation: use a small field descriptor table and one binding helper for these repeated scalar controls, retaining feature-specific normalization. The existing Tunni/debug tables demonstrate that this fits the codebase. Do not turn the entire designspace panel into a generic form framework. New ordinary UI strings such as “Phrase” and alignment tooltips bypass `translate`, unlike neighboring controls; route user-facing labels through localization while leaving explicitly developer-only debug labels under their documented policy.

Source rounding is covered by M5. No new tests or profiling were performed.

## 6. Scene commands — scene-controller.js

### C1 — P2, confirmed: custom coarse-grid presets and keyboard stepping disagree

Locations: `scene-controller.js:712–762`; `panel-designspace-navigation.js:1383–1398`; `coarse-grid-presets.js:26–73`.

The grid shortcuts hard-code a step of 5 and limits of 5/40. The panel then snaps that requested value to its configurable preset list. With custom values 5, 15, 25, 35, pressing increase at 5 requests 10; the nearest-value tie resolves to 5, so the shortcut does nothing. Other increments can skip entries. The slider and keyboard are two entry points for the same setting but use different stepping rules.

Recommendation: move to the previous/next entry in the shared normalized preset list. Remove duplicated magic steps and bounds from action handlers.

### C2 — P2, confirmed: harmonization's other-source switch is ignored for skeleton selections

Locations: `scene-controller.js:2516–2560`, `2600–2611`; `skeleton-panel-edits.js:854–886` and `runSkeletonPanelEdit`.

`doHarmonize` reads `applyToOtherSources`, then its skeleton branch calls the panel helper without that option. The helper uses the normal all-editing-layers path. Only the ordinary-outline branch narrows targets when the option is false. The same command can therefore affect additional skeleton sources despite the chosen scope.

Recommendation: resolve the target layers once before kind-specific dispatch, or pass an explicit scope into both paths. Keep each layer's independent solve and the current no-op change filtering.

### C3 — P2, confirmed: mixed-selection commands lack a consistent transaction scope

Locations: `scene-controller.js:2134–2195`, `2328–2334`, `2540–2560`.

Reverse handles skeleton and ordinary contours in two awaited edit operations, so one user action can require two undos. Break returns immediately after its skeleton branch and ignores selected ordinary points. Harmonize similarly chooses its skeleton branch exclusively. Mixed ordinary/skeleton selections are explicitly supported by Reverse's own comment and by Select All, so “a skeleton selection is never also a path selection” elsewhere is not a valid general assumption.

Recommendation: collect all applicable target kinds and execute their writes in one outer edit transaction. Keep generation restricted to skeleton-owned data. Avoid solving this with another chain of early returns for individual combinations.

### C4 — P3, functioning but overcomplicated: Add Overlap repeats internal type checks and hides failures

Locations: `scene-controller.js:2441–2505`; `path-functions.js:1223–1226`.

The command checks object-ness, `instanceof VarPackedPath`, six method names, `getPoint` a second time, and `numContours`, before calling a one-line adapter to the geometry function. This is an internal typed path, not an untrusted plugin protocol. The layered checks obscure the actual operation; per-layer catch-and-continue then clears selection and returns a success label even if a layer failed. That can leave a multi-source operation partly applied without a useful user-facing result.

Recommendation: rely on the internal path contract (or one boundary assertion), perform the geometry operation on scratch paths, and commit once all intended layers have a defined result. Remove the repeated `getPoint` check and redundant adapter if it serves no public API purpose. Report unsupported geometry explicitly rather than swallowing programming errors.

The realization path deliberately avoids regeneration so detached outlines remain in place; that is justified, not a violation to repair mechanically. Conversion batches the final skeleton regeneration, although contour-remap work can still be consolidated when many ordinary contours are consumed.

## 7. Visualization definitions — visualization-layer-definitions.js

### V1 — P1, confirmed by arithmetic and call chain: SpeedPunk's sample budget is incorrectly scaled with zoom

Locations: `visualization-layer-definitions.js:1975–2013`; `visualization-layers.js:62–67`; `editor.js:1438`; `curvature.js:203–216`, `451–466`.

`baseSegmentBudget: 400` and `minSegmentsPerCurve: 5` live in `screenParameters`. The visualization framework multiplies numeric values there by inverse magnification. The sampler then multiplies the already-scaled budget by square-root magnification. The effective total becomes approximately 400/sqrt(m), so zooming in reduces rather than increases detail. The minimum becomes 5/m and can be fractional.

At magnification 100, with more than 40 curve segments, the floored budget per curve is zero and the minimum is 0.05. The sampling loop produces only its t=0 sample; quad assembly requires two samples and emits nothing. This is a code-derived scenario within the canvas's allowed zoom range, not a browser reproduction.

Recommendation: put dimensionless settings and sampling counts outside `screenParameters`; reserve that object for lengths that must remain constant in screen pixels. Enforce an integer minimum at the sampling boundary as well.

### V2 — P2, confirmed algebra: quadratic curvature uses doubled derivatives

Locations: `curvature.js:44–61`, `84–97`, `222–233`, `419–470`.

The quadratic solver already includes the correct factor of 2 in both derivative expressions and then multiplies both by 2 again. Curvature is therefore half its correct value, and the arc-length estimator is doubled. Those errors can cancel in the normalized comb on an all-quadratic run, which makes the defect less obvious. At a shared quadratic/cubic joint, both segments use the same mean length but only the quadratic curvature is halved, producing a false discontinuity even if the geometry has equal curvature.

Recommendation: correct the derivative formula, rather than compensating downstream in color or height. Keep the cubic and quadratic curvature-from-derivatives implementation shared; the current two functions contain the same formula.

### V3 — P2, confirmed coverage gap: SpeedPunk duplicates a segment walker that omits implicit quadratic on-curves

Locations: `curvature.js:264–306`, `collectCurveSegments`, `forEachCurveSegment:531–571`; compare the supported `VarPackedPath.iterContourDecomposedSegments` API already used in `skeleton-model.js:5317`.

Both counting and sampling recognize only an explicit on-curve followed by either two cubic controls or one quadratic control and another explicit on-curve. Consecutive quadratic controls and all-off-curve quadratic contours, which Fontra represents with implicit on-curves, are not decomposed and are omitted. The code also uses wrap-around indexing without consulting whether a contour is open.

Recommendation: collect canonical decomposed segments once, then derive the count and samples from that collection. Retain explicit shared endpoint identity for the normalizer, including synthetic identities for implicit joins. Do not maintain separate handwritten recognizers for count, length and drawing.

### V4 — P2, functioning but expensive: rendering rebuilds sampling geometry on every unrelated redraw

Locations: `visualization-layer-definitions.js:1983–2028`, `2035–2057`; `curvature.js:383–513`, `135–144`.

Every redraw recounts curves, constructs segments, integrates arc lengths, samples curvature, builds on/off-curve arrays and quad arrays, parses the same color-stop strings for each quad, and creates one `Path2D` per quad. The sampling loop evaluates each Bezier twice: once to obtain curvature and again for position/tangent. Even opacity zero performs all geometry work. With generated contours hidden, `speedPunkPath` also unpacks and repacks the whole selected path every draw, defeating simple object-identity caching.

Recommendation: return early for zero opacity; calculate position, derivatives and curvature together; parse color stops once; collect segments once. Cache geometry by path revision and the settings that actually change it, separating opacity from geometry and zoom-dependent sample density from arc lengths. Consider a bounded per-glyph render cache and direct canvas quad paths; preserve ordering/alpha semantics if batching fills. Repeated allocation is established; no memory leak or measured frame-time dominance is claimed.

### V5 — P2/P3, static rendering cost: grid and hidden-contour paths lack efficient common-case handling

Locations: `visualization-layer-definitions.js:1355–1404`, `2255–2300`; `strokeLine:2118–2123`.

The coarse grid draws each line with its own begin/stroke pair and has no screen-density cutoff. At small magnification, a viewport covers many glyph units, so it draws thousands of indistinguishable lines. The original unit-grid layer already skips low zoom. Batch grid lines into one path and suppress or decimate a grid denser than a meaningful pixel interval.

Hidden-contour outline paths are rebuilt each time a fill/stroke layer asks for them. Node filtering calls `getContourIndex` for every point even when neither hidden set exists. Use the ordinary iterator directly in that common case and derive filtered paths once per geometry/settings revision. These changes simplify functioning code without altering the visual model.

The skeleton SpeedPunk switch is intentionally scoped by its source comment to hidden generated outlines; this review does not call that choice a defect. Existing saved canvas state around each layer is appropriate and should be retained.

## 8. Scene model — scene-model.js

### SM1 — P2, confirmed visibility inconsistency: hidden generated handles can still capture clicks

Locations: `scene-model.js:813–820`, `1126–1173`; `visualization-layer-definitions.js:1338–1348`; contrast `tunni-gizmos.js:isTunniControlLive`.

Direct generated-point/handle hit-testing refuses gizmo mode but never checks `skeletonShowGeneratedGeometry`. Turning off generated geometry while direct editing is enabled hides those nodes and handles yet leaves their hit targets active. An invisible target can take the click before ordinary points or markers. The Tunni eligibility helper does check the visibility setting, so direct and gizmo editing disagree.

Recommendation: use one generated-control eligibility rule for rendering, pointer hit-testing and keyboard target collection, preserving any deliberate behavior for already-selected hidden targets explicitly.

### SM2 — P2, functioning but allocation-heavy: each hit-test recreates global candidate lists

Locations: `scene-model.js:914–936`, `875–902`, `1540–1580`, `1214–1234`; supporting costs in M1 and M4.

The ordinary-point filter builds a Set containing every generated point index, then builds an array of every non-generated point index. These can be rebuilt in several paths during one pointer query. Rib selection may enumerate all targets once for selection preference and then enumerate and materialize them again merely to reverse the order. Each enumeration triggers the expensive rib derivation described in M1. A single curvature drag readout rebuilds every generated Tunni segment to find one target.

Recommendation: maintain contour ranges or a revision-bound point mask, allow reverse target traversal without a temporary reversed array, and share the target descriptors between selection preference, fallback, drawing and readouts. Preserve the existing hit priority; a faster query that changes which overlapping target wins is not equivalent.

### SM3 — P3, duplicated and indirect code with an accuracy tradeoff

`_getEditLayerGlyph` is defined twice (`938–946`, `995–1004`). JavaScript silently uses the later method; their current behavior is equivalent. Remove the shadowed definition so later changes cannot be made to an inactive copy.

`iterSkeletonCurveSegments` (`2517–2547`) reimplements the skeleton segment walk already exposed by the core model. Its companion `skeletonSegmentDistance` (`2564–2614`) embeds another quadratic/cubic evaluator and samples exactly 24 line pieces regardless of zoom or curve shape. At high magnification, approximation error is enlarged while click tolerance in glyph units shrinks, so the sampled polyline is not guaranteed to match a visibly targeted curve. This is a static accuracy limitation, not a measured missed-click rate.

Recommendation: use the existing core segment representation and shared Bezier evaluation, with a bounding-box rejection and tolerance-aware hit distance. The measurement state also stores four mutually exclusive nullable fields, clears all four, then recovers a kind through four branches (`202–258`); a single `{kind, payload}` target would state that invariant directly and simplify each transition.

The new measurement reset clears geometry references when measurement stops. Existing scene subscription reconciliation is inherited and not counted as a fork leak. No new tests were run.

## 9. Skeleton parameters — panel-skeleton-parameters.js

### PS1 — P1, confirmed units mismatch: normalized serif lengths are edited as integers

Locations: `panel-skeleton-parameters.js:889–895`, `983–1008`, `2040–2090`, `2140–2150`, `2479–2530`; `compact-scrub-field.js:371–390`, `457–458`; `number-scrub.js:67–72`.

Every compact field is constructed with `integer: true`. Serif lengths and cup depth display and write their raw model values; only the designated ratio fields convert through percent. There is no branch for the source's normalized serif units. A stored length of 0.2 can be displayed, but committing that same typed value passes through `Math.round` and writes 0. Dragging also lands on integers. With a reference width of 100, the available adjacent normalized values represent a 100-unit change in outline length.

Recommendation: declare units and precision for each parameter and make the display/write conversion aware of normalized mode. Either expose fractional coefficients with appropriate scrub steps or convert to a clearly labelled display unit and invert that conversion on write. This is separate from M5's source-creation rounding and S2's missing generation context; together they show the same units contract is missing at several boundaries.

### PS2 — P2, confirmed identity mismatch: a preset index survives a change of master

Locations: `panel-skeleton-parameters.js:1156–1162`, `1206–1222`, `1255–1271`, `1320–1346`, `1387–1401`, `1755–1763`; `preset-header-control.js:90–120`.

The preset control remembers `lastPicked` as a numeric index into the current master's list. Refresh clears it only if the index no longer appears. Switching to another master with an entry at that index preserves the pick, even though that entry was never selected. Update then overwrites the entry in the new master. Serif controls can also display that unrelated entry as selected. Changing terminal kind explicitly resets the pick, but changing source does not.

Recommendation: scope remembered picks to source identity and terminal kind, and reset on a scope change. Stable preset IDs would additionally avoid index drift after list edits. The existence check in the shared control is useful but does not establish identity across different lists.

### PS3 — P2/P3, functioning but indirect: preset application regenerates twice and splits one action into two edits

Locations: `panel-skeleton-parameters.js:1177–1201`; related writers in `skeleton-panel-edits.js`.

When a width preset changes projection, `_applyWidthPreset` first awaits `setPanelContourSingleSided`, then separately awaits `setPanelPointWidthPreset`. Each helper performs a scene edit and skeleton regeneration. `_runOwnEdit` suppresses panel rebuilding during the operation; it does not combine the two undo records or the two geometry passes. Selecting one preset therefore exposes an intermediate state and can require two undos. Preserve the required projection-before-width ordering inside one recorded edit and regenerate once after both mutations.

The panel also repeatedly maps, filters and maps preset lists to retain indices (`1209–1218`, `1297–1301`), then the shared control scans them for existence and selection and maps again. This is a small-list allocation/clarity issue, not a demonstrated bottleneck: one indexed pass can construct the displayed entries, and one `find` can establish both existence and the picked item. The simple command-dispatch branches are not themselves a performance problem; replace repeated metadata and conversions where that removes duplication, rather than replacing every conditional with a framework.

Persistent compact controls and guards against rewriting an active field are appropriate. Their event listeners belong to those owned controls; this inspection does not establish a new leak in this panel. No tests were run for this review.

## 10. Harmonization — harmonization.js

### H1 — P2, confirmed comparison defect: infinite scores are treated as tied with finite scores

Locations: `harmonization.js:897–909`; nonfinite residual handling at `715–716`.

`tied(a, b)` compares `abs(a-b)` with a relative tolerance based on `max(abs(a), abs(b))`. For a finite value and Infinity, both sides evaluate to Infinity, so the comparison is true. For two Infinities the left side is NaN, so it is false. Consequently the ranking can ignore a finite-versus-infinite residual and decide on travel, while equal infinite residuals stop comparison before travel. This contradicts the explicit intent that finite candidates beat infinite incumbents.

Recommendation: handle exact equality first, then order unequal nonfinite values explicitly, applying relative tolerance only to finite pairs. Reject NaN at the score boundary. The arithmetic defect is certain; its frequency in normal glyphs is not measured.

### H2 — P2, static scaling problem: a local grid trial recomputes the entire global score

Locations: `harmonization.js:1412–1453`, `1502–1516`, `1673–1688`, `1960–1987`.

For each moved point, `snapToGrid` tries up to four placements over up to three passes. Every placement calls `scoreJoints` over all candidates and `travelSoFar` over every path point. With T touched points, J joints and N path points, one rounding pass costs O(T × (J + N)), before the canonical solver's up-to-40 settling attempts. Unselected contours contribute to every travel scan even though their displacement is zero. Each global score also reconstructs segment arrays and point objects.

Recommendation: precompute the dependency from point indices to affected joint stencils. A trial changes only those scores and one travel contribution; update an aggregate score and restore the small affected set on rejection. Retain the existing lexicographic order and candidate traversal. Scope cycle keys and snapshots to potentially changed coordinates rather than serializing every point each attempt. The current `seen` Set is bounded and local, so this is temporary memory pressure, not a persistent leak.

### H3 — P2, confirmed curve-type inconsistency: Balance accepts quadratic handles as cubic handles

Locations: `harmonization.js:2305–2318`, `2356–2400`; contrast `isCubicOffCurve` and `getJointContext`.

Balance accepts a four-point window whenever its endpoints are on-curve and both middle points have any off-curve type. It then applies cubic Tunni geometry. A valid quadratic run `[on, quadratic-off, quadratic-off, on]` represents two quadratic segments with an implied on-curve midpoint, not one cubic. The command can therefore move those quadratic controls according to the wrong curve model. Harmonization itself correctly requires cubic types.

Recommendation: explicitly require cubic off-curves for this implementation, or decompose and implement the quadratic operation separately. Do not silently reinterpret the topology. The balancing finish also always rounds its handles (`2366–2367`), even when the enclosing `harmonizePathInPlace` caller requests `roundCoordinates: false`; thread the rounding policy through that shared operation.

### H4 — P2, result consistency: final reports are not fully measured against the retained geometry

Locations: `harmonization.js:1550–1552`, `1579–1594`, `1931–1955`, `2025–2045`, `2240–2253`.

The nearest solver records a joint's status when it visits that joint, then later joints can move shared handles and the grid pass can move them again. The final pass only consults `everMoved`, which records movement before rounding; it does not recompute final continuity or compare final coordinates. It can therefore report success for a result rounded back to its starting coordinates, or for a joint disturbed after its last solve. The canonical path checks final movement but retains the pre-rounding convergence status. The finishing report also deliberately preserves an initial `partial` status despite having run repair on that same nonstructural joint; its comment that repair never ran there disagrees with the `reached` filter.

Recommendation: distinguish construction outcome, retained movement and final residual, then derive the public status once after all preparation, rounding, balancing and repair. This also avoids describing a preparation-only alignment as an unchanged skipped command. Static inspection establishes the missing final checks; it does not quantify misleading reports in use.

### H5 — P3, unnecessary work and stale explanations obscure the current algorithm

`bendingEnergyOf` computes velocity once inside `curvatureAtParameter` and again for its speed at each of 21 sample positions (`914–983`). G3 slide evaluation samples both segments again for notch detection after energy sampling (`1190–1227`); collect curvature, speed, energy and notch information in one traversal per emitted segment. `combHasNotch` materializes all samples merely to retain the two endpoints and minimum. G2 slide considers zero in both directions (`1116–1123`). These are functioning paths with avoidable work inside an already nested search.

The trailing `report` helper (`2431–2450`) is unused. Several comments still describe scoring multiple constructions or fairness in `scoreJoints`, although the outer dispatcher now chooses one construction and that score contains no fairness term. The Balance introduction says it cannot be a harmonization step immediately after code that uses it as a finishing step. Remove the dead helper and revise these comments to explain the current stages and their invariants. Keep the rationale for numerical limits, but move historical experiments out of repetitive inline blocks. No tests were run.

## 11. Skeleton editing — skeleton-editing.js

### SE1 — P1, confirmed cross-layer addressing defects in several drag paths

Locations: `skeleton-editing.js:1068–1087`, `1122–1137`, `1162–1191`, `1226–1257`, `1609–1629`, `1638–1649`, `2104–2130`; `edit-tools-pointer.js:920–933`.

Ordinary rib and generated-handle entry construction correctly resolves the edit layer's selection into each target layer. However, the executor record retains the reference layer's IDs. During a frame it asks a resolver whose reference argument is now the target layer's `skeletonData` to find those original IDs. If master-local IDs differ, resolution fails and the target layer is skipped; coincident IDs can resolve a different point. The point-drag implementation correctly keeps target IDs, demonstrating the intended contract.

Insertion and insertion-rib drag constructors take no reference skeleton at all. Pointer dispatch passes the unchanged edit-layer selection to each layer, so these paths also fail when IDs differ, despite `resolveSkeletonInsertionAcrossLayers` already existing in the same file. Generated-handle direction additionally reads `publishedAuthoredAxis` from the reference layer even after resolving a target point in a different master; it should derive the target master's axis, as its fallback already does.

Recommendation: translate selection identity exactly once when creating each layer's entry and retain a target ordinal/address for every frame. Use the shared insertion resolver too. This removes redundant searching as well as the mixed identity domains. The failure condition is compatible masters with different IDs, a supported condition explicitly documented by these resolvers.

### SE2 — P2, functioning but costly: each pointer frame copies and searches far more than it changes

Locations: `skeleton-editing.js:251–266`, `286–317`, `667–693`, `788–823`, `1508–1544`; `canUpdateGeneratedContoursInPlace:387–411`.

The synthetic path includes every skeleton contour. Ordinary point drags copy every mapped point back, resolving each point by IDs through `getSkeletonPointAddress`, even for untouched contours. Those repeated linear searches can make mapping O(N²). Tension-aware dragging also unpacks and corrects every contour, whereas its transform counterpart explicitly limits the solve to contours containing selection. Each frame clones the whole layer path and custom data, then clones and normalizes the skeleton again before generation (M4). The in-place compatibility check materializes each old contour just to compare topology.

Recommendation: precompute ordinal mappings and affected contours at drag start, carry the ordinary behavior's changed-point set into the skeleton copy, and compare packed point types/flags without unpacking. Retain one immutable drag baseline and isolate only the mutable data required by the generator. This is a simplification of ownership, not permission to mutate the baseline or skip neighboring handles affected by the behavior. Keep the sticky contour-replacement rule: it protects positional change application after topology changes. Its WeakSet does not retain finished drags.

`computeGeneratedContourRemap` also executes a structural operation on a full scratch path before its real execution. That is a defensible compatibility adapter, but expensive for complex edits; an operation returning its contour-index mapping would avoid the second run and temporary marker traversal.

### SE3 — P2, confirmed interacting edits: pin baking is repeated independently for both selected handles

Locations: `skeleton-editing.js:1609–1629`, `1638–1649`, `1709–1788`, `1861–1885`, `1938–1946`.

Each selected generated handle creates its own pin bake, regenerating the entire skeleton with that segment pin cleared. For two selected handles A and B of the same pinned segment, A's executor adds B's bake and sets A's offset including A's bake. B's executor then adds A's bake to A's already-baked offset before setting B's own offset. A receives the contribution twice; which endpoint gets it depends on selection iteration order. This requires nonzero pin contribution and attached handles, not malformed data.

Recommendation: prepare one bake per segment/side, apply it once to the working skeleton, then apply each selected handle's delta against the common post-bake baseline. This simultaneously removes repeated full generation and makes the result independent of selection order. Generation must use the same source options as the final mutation (S2). No tests were run.

## 12. Transformation panel — panel-transformation.js

### T1 — P1, confirmed integration gap: master-local skeleton bounds are not resolved with the movement targets

Locations: `panel-transformation.js:1241–1277`, `1387–1422`, `1752–1768`, `1843–1848`; `glyph-controller.js:863–882`; `skeleton-editing.js:577–598`.

The transform entry resolves skeleton IDs across masters by ordinal, but both bounds readers receive the original selection IDs and search each target master literally. A skeleton-only selection can therefore have a valid movement entry but undefined bounds in another master. `getPinPoint` immediately dereferences those bounds. With coincident but unrelated IDs, the transform instead uses the wrong origin. Align/distribute has the same mismatch: its per-layer bounds are computed without the reference skeleton and its descriptors assume all bounds exist.

Recommendation: resolve each layer's selection once and use that same resolved selection for bounds, point movement, metadata and eligibility. Handle an incompatible layer before any edit is applied. Avoid keeping a second ad hoc skeleton-bounds pass beside `getSelectionBounds`, which already handles skeleton points.

### T2 — P1, acknowledged but still unsafe integration: whole-path booleans retain obsolete generated linkage

Locations: `panel-transformation.js:1184–1191`; `skeleton-editing.js:325–382`.

Whole-path union/subtract/intersect/exclude replace the path but leave skeleton data and its generated contour indices intact. The inline comment acknowledges this limitation. A later skeleton edit trusts any old indices still within the new path's range, deleting or overwriting whatever boolean-result contours now occupy them. If no old index remains valid, regeneration can instead append the skeleton outline alongside the boolean result. The problem is delayed corruption of the linkage, not merely that a boolean changed generated geometry.

Recommendation: define the operation's contract: reject unsupported linked operations, or explicitly realize/detach the affected skeleton representation in the same undoable edit. Do not retain indices that no longer identify generated contours. Existing upstream boolean code is not itself classified as a fork addition; retaining the fork's new metadata across it is the integration defect.

### T3 — P2/P3, avoidable repeated work: alignment regenerates per object and transform setup is duplicated

Locations: `panel-transformation.js:1761–1787`, `1850–1872`, `1209–1317`, `1335–1457`.

Every selected skeleton point becomes a separate movable object. Each object builds its own synthetic path and baseline, applies one delta, and regenerates the whole skeleton before the next object starts. K selected points therefore pay K complete edit/generation pipelines per layer. Batch point-specific deltas inside one skeleton mutation while preserving the intended smooth-handle interactions. The newly corrected reverse rollback order is necessary, but repeated `unshift` also shifts the accumulated array on every object; append and reverse once.

The one-shot and streaming transform methods duplicate selection eligibility, reference-layer selection, factory setup, bounds and pinned-transform construction. T1 appears in both copies. Extract their common prepared operation, leaving stream throttling, cancellation and final commit in the stream owner. The existing stream correctly flushes its final value and restores on cancellation; those behaviors should survive the simplification.

### T4 — P2, lifecycle inconsistency: hidden origin-pick mode still intercepts canvas input

Locations: `panel-transformation.js:1547–1596`, `1804–1808`; `panel-selection.js:40–43`.

Origin picking installs capture listeners on the canvas and window and changes the cursor. Normal pick/Escape cleanup exists, but `toggle(false)` never invokes it. Switching away from the Selection panel leaves a hidden mode that consumes the next canvas click as an origin pick. If the part is removed while armed, the global listener can also retain it until cleanup; ordinary page-lifetime ownership alone is not a leak. The one-shot pointerup suppressor is installed separately and is not removed on pointer cancellation.

Recommendation: stop picking on panel deactivation, tool/context change and disposal; own the gesture's pointerup/cancel listeners in the same cleanup function. A single explicit lifecycle is simpler than independent once-listeners that may outlive the gesture.

### T5 — P2, new interaction inconsistency: typed and scrubbed zero values mean different things

Locations: `panel-transformation.js:554–570`, `685–698`, `724–739`.

The inherited typed Scale Y path uses truthiness to treat 0 as an absent value and substitutes Scale X. The new Y scrub path applies 0 literally. Typed dimensions similarly substitute the old dimension for a zero target, while the new scrub path can collapse it to zero. Typing and dragging the same displayed value therefore produce different geometry. This is an inherited edge case newly exposed by a second input path, not a claim that the old truthiness code originated in this fork.

Recommendation: define absent versus zero once with explicit null/undefined handling and share the conversion across typed and streamed input. Define the zero-size selection case before division as well. No tests were run.

## Validation completed before the code-only request

- `npm ci --ignore-scripts --no-audit --no-fund` succeeded; no tracked dependency file changed.
- Core suite: **2,630 passing**.
- Kerning suite: **101 Mocha tests and 23 Node tests passing**.
- Targeted scratch probes execute actual controller/worker code with boundary stubs, and call real cache helpers. They do not change production files. Their setup and observations are stated above.
- No bundle was run, following START-HERE. No browser interaction matrix has been run. Passing unit tests do not establish canvas behavior or frame times.
