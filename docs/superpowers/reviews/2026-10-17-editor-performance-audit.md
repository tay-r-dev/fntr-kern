# Editor performance audit

Date: 2026-10-17  
Reviewed commit: `2b24e7c9aede562d7ed2dac67a0736c6505f8e33`  
Measurement environment: Windows, Node.js v24.12.0

## Scope and result

This review covers interactive rendering and calculation in the font editor: Speedpunk curvature visualization, fine and coarse grids, skeleton generation and overlays, and the redesigned UI's update paths. The assumed workload is one designer dragging points or parameters, hovering, zooming, and resizing panels, potentially with complex glyphs and several editable masters.

Six performance issues were confirmed through source inspection and targeted checks. Prioritize the Speedpunk cache's memory limit, whole-glyph skeleton regeneration, and repeated skeleton address searches. UI discovery and rebuilding are the next targets.

This is an inspection report, not an implemented optimization. No application code was changed. The earlier modifier correctness review and the interrupted bulb/serif correctness review are outside this report. Serif contours were used here only as a generation workload.

Measurements are synthetic Node checks, not browser frame timings. Mocked DOM and canvas checks count operations; they do not measure style calculation, layout, rasterization, or GPU time. The findings establish repeated work and retained memory, but do not establish the percentage of a real editor frame each consumes.

## Priority overview

| ID | Area | Confirmed cost | Priority |
| --- | --- | --- | --- |
| P01 | Speedpunk | 300 changed segment versions retained about 107 MiB | First |
| P02 | Skeleton generation | One-point edits rebuild unrelated contours; 24-contour case took 27.7 ms median | First |
| P03 | Skeleton ribs | 1,000 points caused 2,001,000 provenance reads in one pass | First |
| P04 | UI scrollbars | Root style changes trigger whole-tree discovery; overlapping roots repeat it | Next |
| P05 | Selection panel | Geometry changes recreate spacing, kerning, and selected-object controls | Next |
| P06 | Measurement labels | Unchanged paths are resampled into collision obstacles on every redraw | Next |

## P01 — Speedpunk retains too many old segment versions

**Source:** [curvature.js](../../../src-js/fontra-core/src/curvature.js), `SpeedPunkSegmentCache` at line 662 and `cachedSpeedPunkSamples` at line 390.

The segment cache is a module-level cache backed by a strong `Map`. Its default limit is 20,000 entries. Each entry contains all drawing quads for one combination of segment coordinates, sampling density, neighboring lengths, and display settings. A moving control point produces a new key on each distinct edit.

The cache is bounded by entry count, but entries vary greatly in size. The per-owner weak cache and its six-result limit do not release objects still held by this separate segment cache.

**Measured case:** 300 versions of one cubic, sampled at 724 steps, retained 217,200 quads and about **107.2 MiB** of additional JavaScript heap after explicit garbage collection. This was well below the 20,000-entry limit. The test did not include browser `Path2D` allocations.

**Smallest useful fix:** enforce a total sample or memory budget in the existing eviction policy. Keep reuse for unchanged segments, but evict historical versions before they consume a large heap. Do not replace this with an unbounded cache keyed by another object.

**If left unchanged:** editing can accumulate substantial memory and increase garbage-collection work even when only one glyph is visible.

**Acceptance check:** repeat a long sequence of distinct edits and verify that retained memory plateaus at the chosen budget. Confirm that unchanged segments still hit the cache and that generated quads are unchanged.

## P02 — Local skeleton edits regenerate all contours

**Sources:** [skeleton-editing.js](../../../src-js/views-editor/src/skeleton-editing.js), `applySkeletonMutation` at line 327; [skeleton-generator.js](../../../src-js/fontra-core/src/skeleton-generator.js), `generateFromSkeleton` at line 84 and `generateContoursFromGeneratorInput` at line 145.

A skeleton edit clones and normalizes the skeleton, applies the mutation, and calls `generateFromSkeleton`. The generator normalizes again and iterates through every contour. An edit to one contour therefore repeats construction and post-processing for the others. Editing multiple masters repeats this work for each layer.

**Measured case:** independent open cubic contours with a serif at their start. Only the first contour's starting point moved between calls. Four warm-up generations preceded 15 measured calls, with `bulbPreview: true`.

| Contours | Median generation time | Largest observed time |
| ---: | ---: | ---: |
| 1 | 2.2 ms | 4.4 ms |
| 8 | 11.7 ms | 20.3 ms |
| 24 | 27.7 ms | 36.0 ms |

The 24-contour median already exceeds a 60 Hz frame's approximately 16.7 ms budget. These numbers exclude edit transaction preparation, canvas drawing, DOM updates, and other masters. They are workload examples, not predicted timings for every glyph.

**Smallest useful fix:** reuse generated results for unchanged contours. Include all generation settings and contour dependencies in invalidation, and retain both geometry and provenance. Caller-side dirty-contour tracking or bounded contour-result reuse needs a dependency check before implementation; simply skipping all but the directly selected contour is not sufficient for every operation.

**If left unchanged:** local gestures get slower as unrelated contours and editable masters are added.

**Acceptance check:** compare output and provenance against full generation for local edits, shared-setting changes, insertion changes, and undo/redo. Measure the local-edit workload again. Preserve preview/final behavior and topology rules.

## P03 — Rib rendering repeatedly searches generated point maps

**Sources:** [skeleton-model.js](../../../src-js/fontra-core/src/skeleton-model.js), `getSkeletonRibEndpoints` at line 4540 and `findGeneratedPathAddress` at line 4559; [visualization-layer-skeleton.js](../../../src-js/views-editor/src/visualization-layer-skeleton.js), rib drawing at lines 439 and 500.

For a smooth point or qualifying corner, each rib endpoint searches the generated provenance map from the beginning to find its address. Doing this for every point makes the total search work quadratic in contour size. Rib lines and rib markers call the same endpoint reader in separate drawing passes. Snapping also uses that reader.

**Counted case:** one contour of smooth points, with two generated provenance entries per point. A proxy counted numeric reads from the point map during one complete endpoint pass.

| Skeleton points | Provenance reads |
| ---: | ---: |
| 100 | 20,100 |
| 500 | 500,500 |
| 1,000 | 2,001,000 |

These are operation counts from synthetic valid address data, not elapsed drawing times. They exclude additional searches and the second drawing pass.

**Smallest useful fix:** create an address index once per skeleton-data version and use it in the shared reader. Include contour, point, side or bulb role, and slot in the key. Preserve the current first-match behavior when duplicate provenance exists.

**If left unchanged:** dense skeletons pay disproportionately more for both drawing and interaction.

**Acceptance check:** verify address equivalence for ordinary points, insertions, corners, and bulb roles. Confirm invalidation after regeneration and near-linear lookup counts as point counts grow.

## P04 — Scrollbar discovery scans the page during resizing

**Sources:** [scrollbars.js](../../../src-js/fontra-webcomponents/src/scrollbars.js), `drawScrollbarsEverywhere` at line 159; [sidebar.js](../../../src-js/views-editor/src/sidebar.js), `initResizeGutter` at line 160.

The global scrollbar observer watches `class` and `style` changes. For each changed element, it walks the entire descendant tree, including open shadow roots, to discover scroll containers. Sidebar resizing writes a CSS property on `<html>`, making the scan root the whole page.

The pending set deduplicates identical nodes, but does not remove descendants whose ancestor is already queued. One batch can therefore visit the same subtree more than once. Scrollbar rails have an exclusion, but ordinary panel elements do not.

**Counted case:** a mocked root with a panel containing 1,000 non-scrollable elements produced **1,001 computed-style reads** for one root style change. Queuing both the root and panel produced **2,002 reads**. This demonstrates traversal and style-query counts, not real browser layout cost.

**Smallest useful fix:** exclude known size-only updates from discovery and deduplicate overlapping scan roots. Existing attached scrollbars already have resize observers. Retain discovery for newly inserted elements and changes that actually introduce scrolling.

**If left unchanged:** sidebar and split-pane resizing can trigger work proportional to the entire UI, including unrelated controls.

**Acceptance check:** resizing an existing sidebar must not rediscover the entire page. Newly inserted scroll boxes and class changes that enable scrolling must still receive bars.

## P05 — Selection-panel updates rebuild unrelated controls

**Source:** [panel-selection-info.js](../../../src-js/views-editor/src/panel-selection-info.js), glyph-change listener at line 87, card construction at line 225, and form replacement at line 469.

Visible selection-panel updates run after glyph changes, throttled to 100 ms. They recreate spacing and kerning cards even when only outline coordinates changed and the kerning groups stayed the same. Selected-object forms call `setFieldDescriptions`, which clears and rebuilds their input DOM in [ui-form.js](../../../src-js/fontra-webcomponents/src/ui-form.js), line 356.

This is confirmed from the update path; no DOM rebuild duration was measured. The panel has a hidden-state guard and an own-edit guard, so this is not a claim that every event always rebuilds it. Ordinary canvas edits still reach this path.

**Smallest useful fix:** retain controls while their structure is unchanged and update their displayed values. Refresh kerning controls only when their inputs change. The existing `_applyFormContents` approach in [panel-skeleton-parameters.js](../../../src-js/views-editor/src/panel-skeleton-parameters.js) provides a local pattern to reuse.

**If left unchanged:** canvas drags keep allocating controls and triggering DOM observation, styling, and potentially layout work alongside geometry calculation.

**Acceptance check:** count control creation during a canvas drag. Existing nodes should survive value-only updates; selection-type changes must still rebuild the required fields. Preserve focus and active-input behavior.

## P06 — Label obstacles are resampled on unchanged redraws

**Source:** [distance-angle.js](../../../src-js/fontra-core/src/distance-angle.js), `registerLabelContours` at line 1232 and `devicePoint` immediately above it.

Label placement caches selected positions, but the collision-obstacle collection is cleared after each drawing task. On the next redraw, the same path is decomposed and sampled again. Curves receive eight steps, with fresh coordinate objects and a canvas transform read for every sampled point.

**Counted case:** registering an unchanged path containing 100 cubic segments caused **900 `getTransform()` calls on each of three successive simulated frames**. The path was already deduplicated within each frame; the repetition is between frames.

**Smallest useful fix:** cache glyph-space contour samples by geometry version, then transform them using one captured matrix per registration. Geometry may be edited in place, so path identity alone is not sufficient invalidation. Keep screen-space collision behavior correct under zoom, pan, and glyph translation.

**If left unchanged:** hover and other redraws resample unchanged curves even when label placement itself is reused.

**Acceptance check:** unchanged redraws should reuse samples; edits must invalidate them. Compare label placement after pan, zoom, and geometry changes.

## Existing safeguards worth keeping

- Canvas redraw requests are consolidated to animation frames.
- Speedpunk caches complete sample results by owner and sampling rung, reuses unchanged segment results, and caches grouped `Path2D` fills.
- Fine-grid lines use one path and stroke. Dense coarse-grid dots use repeated tiles with a bounded tile cache.
- Skeleton-data normalization has an identity cache for readers.
- Hidden selection panels avoid update work. The skeleton parameter panel already supports value-only control refreshes.
- Data tables render a bounded row window.

No comparable grid bottleneck was established in the inspected paths. This is not a claim that grid rasterization is free or that every zoom and display configuration was profiled.

## Verification and reproduction

The following focused suite passed: **72 tests, 0 failures**. Run from the repository root:

```powershell
node node_modules/mocha/bin/mocha.js src-js/fontra-core/tests/test-curvature-sampling.js src-js/fontra-core/tests/test-coarse-grid-presets.js src-js/fontra-webcomponents/tests/test-scrollbars.js src-js/fontra-webcomponents/tests/test-data-table-model.js src-js/fontra-webcomponents/tests/test-table-selection.js --reporter dot
```

The passing tests establish existing functional checks, not performance acceptance for the proposed fixes. The measurement probes were run inline and were not added to the test suite. Their inputs were:

- **P01:** instantiate the default `SpeedPunkSegmentCache`; for `i = 0..299`, sample an open cubic `(0,0), (0,100 + 0.1i), (100,100), (100,0)` with `contourSegmentBudget: 724`. Run Node with `--expose-gc`; compare `heapUsed` after collection before and after the loop, retaining the cache.
- **P02:** use 1, 8, or 24 independent open cubic contours with points `(500j,0), (500j,120), (500j+200,200), (500j+240,400)`, unique IDs, and width 80. Put a serif on each first point, both halves set to `wingLength:20`, `tipThickness:20`, `wingSlope:20`, `reach:20`, `easeDistance:0.3`, `easeCurvature:0.55`. Normalize once, warm up four calls, then measure 15 calls while incrementing only the first contour's first x coordinate by one. Report median and maximum `performance.now()` durations.
- **P03:** use 100, 500, or 1,000 smooth on-curves with distinct IDs; supply a generated map containing left and right on-curve entries for each ID. Count numeric map reads with a proxy while calling `getSkeletonRibEndpoints` for all points.
- **P04:** mock mutation delivery and animation-frame scheduling around `drawScrollbarsEverywhere`; count `getComputedStyle` calls for a root/panel tree with 1,000 non-scrollable children. Deliver a root style mutation, then a batch containing both root and panel mutations.
- **P06:** create 100 translated copies of the open cubic `(0,0), (0,100), (100,100), (100,0)`. Call `registerLabelContours` with a context whose `getTransform` returns identity and increments a counter. Allow microtasks to finish between registrations to model separate draws.

## Recommended follow-up

Implement P01 first because its retained-memory cost was directly measured and its fix can stay within the existing cache. Address P03 next for a shared lookup improvement, then P02 with explicit generation dependency and invalidation checks. P04 and P05 reduce UI work that competes with geometry; P06 removes repeated visualization work.

After each change, rerun its acceptance check and the relevant functional tests. Use a browser profile of real drag, hover, zoom, and resize sessions to establish actual frame-time gains. Do not add the measurements in this report together: they use different workloads, and some costs interact.

Not checked: a live browser profile, GPU/rasterization costs, every UI component, the complete test suite, or a full multi-master timing run. No optimization or numerical approximation was applied by this audit.
