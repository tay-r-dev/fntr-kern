# Forkra feature audit: ui/ux-refactor

Review target: `02bbd755925f4eb8a5f00fc248853aac7ba1f756`.
Upstream: `fontra/fontra`, inspected at `ba03f8917e4df6cd783e755dd372b519b1f3225f`.
Comparison base: `1066c5cb3f0f0442037d9ea6394ab516553ca44c`, the merge base of upstream and the target. The older `googlefonts/fontra` repository is archived; comparing only with it would misclassify later upstream work as fork additions.

This review covers fork-specific features, with priority on skeleton editing and visualizations. It assesses correctness and code quality, performance, and consistency. It changes no application code. Findings are committed after each primary file review; related files are traced where needed. This is a growing report until the coverage ledger is complete. Subsequent installments use code inspection only, as requested; no further tests are run.

The reference set starts at `docs/superpowers/START-HERE.md`: glossary, architecture map, feature model and development log. Code takes precedence where those documents disagree. Ponytail's Markdown review guidance was read from a separate clone, without installation. Its simplicity checks supplement this review; they do not replace correctness checks. The requested `ste-writing` skill is not present in the repository or available skill directories; this report uses plain language.

P1 means a wrong result or serious scaling failure in a supported workflow. P2 means a bounded functional defect or significant avoidable cost. P3 means maintainability or presentation debt. “Confirmed” identifies executable evidence or a direct, complete code path; it does not imply a browser test. Timings are local Node 24.19.0 measurements, not browser frame-time claims.

## Review ledger

| Primary file | Lines at target | Review and result |
| --- | ---: | --- |
| `src-js/views-kerning/src/kerning.js` | 8,330 | Run, cache, source, table, class, preview and undo paths reviewed; K1–K7 below. Related worker/cache findings are included here. |
| `src-js/fontra-core/src/skeleton-generator.js` | 6,743 | Generation pipeline, cleanup, corners, cap construction, provenance and generation-option callers inspected; S1–S6. Static review, not a proof of the numerical solver. |
| `src-js/fontra-core/src/skeleton-model.js` | 5,859 | Schema, topology operations, ID transport, width/rib rules, generated-target lookup, transforms, rounding and cache ownership inspected; M1–M6. |
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

## Validation completed before the code-only request

- `npm ci --ignore-scripts --no-audit --no-fund` succeeded; no tracked dependency file changed.
- Core suite: **2,630 passing**.
- Kerning suite: **101 Mocha tests and 23 Node tests passing**.
- Targeted scratch probes execute actual controller/worker code with boundary stubs, and call real cache helpers. They do not change production files. Their setup and observations are stated above.
- No bundle was run, following START-HERE. No browser interaction matrix has been run. Passing unit tests do not establish canvas behavior or frame times.
