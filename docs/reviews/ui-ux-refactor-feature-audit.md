# Forkra feature audit: ui/ux-refactor

Review target: `02bbd755925f4eb8a5f00fc248853aac7ba1f756`.
Upstream: `fontra/fontra`, inspected at `ba03f8917e4df6cd783e755dd372b519b1f3225f`.
Comparison base: `1066c5cb3f0f0442037d9ea6394ab516553ca44c`, the merge base of upstream and the target. The older `googlefonts/fontra` repository is archived; comparing only with it would misclassify later upstream work as fork additions.

This review covers fork-specific features, with priority on skeleton editing and visualizations. It assesses correctness and code quality, performance, and consistency. It changes no application code. Findings are committed after each primary file review; related files are traced where needed. This is a growing report until the coverage ledger is complete. The initial PR contains the kerning review; the skeleton and visualization reviews remain pending. Following the request made after the first review, subsequent findings will use code inspection only, with no further test runs.

The reference set starts at `docs/superpowers/START-HERE.md`: glossary, architecture map, feature model and development log. Code takes precedence where those documents disagree. Ponytail's Markdown review guidance was read from a separate clone, without installation. Its simplicity checks supplement this review; they do not replace correctness checks. The requested `ste-writing` skill is not present in the repository or available skill directories; this report uses plain language.

P1 means a wrong result or serious scaling failure in a supported workflow. P2 means a bounded functional defect or significant avoidable cost. P3 means maintainability or presentation debt. “Confirmed” identifies executable evidence or a direct, complete code path; it does not imply a browser test. Timings are local Node 24.19.0 measurements, not browser frame-time claims.

## Review ledger

| Primary file | Lines at target | Review and result |
| --- | ---: | --- |
| `src-js/views-kerning/src/kerning.js` | 8,330 | Run, cache, source, table, class, preview and undo paths reviewed; K1–K7 below. Related worker/cache findings are included here. |
| `src-js/fontra-core/src/skeleton-generator.js` | 6,743 | Next |
| `src-js/fontra-core/src/skeleton-model.js` | 5,859 | Pending |
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

## Validation so far

- `npm ci --ignore-scripts --no-audit --no-fund` succeeded; no tracked dependency file changed.
- Core suite: **2,630 passing**.
- Kerning suite: **101 Mocha tests and 23 Node tests passing**.
- Targeted scratch probes execute actual controller/worker code with boundary stubs, and call real cache helpers. They do not change production files. Their setup and observations are stated above.
- No bundle was run, following START-HERE. No browser interaction matrix has been run. Passing unit tests do not establish canvas behavior or frame times.
