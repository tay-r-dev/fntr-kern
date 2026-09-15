# Real-time canvas performance review: 30 candidates

Target: `02bbd755925f4eb8a5f00fc248853aac7ba1f756`, branch `ui/ux-refactor`.

Scope: interactive editor canvas, geometry, snapping, skeleton-related math and visualization orchestration, including inherited Fontra code. The kerning view is excluded. Entries were checked against the existing feature audit to avoid repeating its findings. This is a deeper inspection of 30 selected pattern candidates, not a claim that all remaining src-js code has been reviewed.

Method: read the candidate routines and their relevant callers, trace lifetime and data dependencies, and distinguish per-frame work from gesture setup and bounded numerical work. No tests, benchmarks or application code were run or changed. “Prioritize” means the source establishes avoidable work on an interactive path; it does not assert measured frame-time impact. “Moderate” and “low priority” reflect expected scope of savings, not timings. Conditional lifecycle risks require the stated lifecycle to occur.

Full source links are relative to this repository; cited line numbers refer to the target commit. A completed section is committed independently after each primary-file review.

## Results and recommended order

The 30 candidates yield **22 worthwhile optimization candidates, two minor cleanups, one conditional lifecycle concern and five rejected suspicions**. The detailed entries state the evidence and behavioral constraints for each; optimization candidates are not all correctness bugs.

Start with R13 (projection during sorting), R20–R22 (snapshot and diagnostic work), and R24–R26 (coupling and topology work). Next consider R01–R02 (path queries), R18 (large-selection snapping), R30 (multi-contour expansion), and R04 (redraw scheduling). Read the dependency notes: optimizing an inner routine and reducing its invocation count are complementary, and their estimated gains must not be added as if independent.

The five rejected suspicions are R03, R08, R12, R27 and R29. R10–R11 are small constant-factor cleanups. R06 is conditional; no accumulating leak during an ordinary editor session has been demonstrated.

## Path hit-testing

Primary source: [path-hit-tester.js](../../src-js/fontra-core/src/path-hit-tester.js). This file is unchanged from the upstream comparison base.

### R01 — Prioritize: sort-all nearest-point selection

**Evidence:** `findNearest:45–67` projects every segment, collects results, filters endpoints, sorts by distance and returns only the first. Editor callers include Power Ruler (`edit-tools-power-ruler.js:181`) and marker attachment (`marker-editing.js:471`).

For S segments, selection adds O(S log S) sorting and O(S) result storage after projection. Keep the closest eligible hit during traversal instead. Preserve the strict endpoint exclusion and first-in-order winner for equal distances. This removes work without changing the projection algorithm; it does not make projection itself constant-time.

### R02 — Prioritize: intersection queries skip the available bounding boxes

**Evidence:** `lineIntersections:89–121` invokes intersection math for every segment after loading all contours. In contrast, `hitTest:25–43` rejects contour and segment bounds before projection. Power Ruler, knife preview and marker measurement call line/ray intersections.

A line/rectangle broad-phase can avoid curve-root calculations for segments the query cannot cross. For finite lines, use their bounds; for rays, use the constructed finite extent. Preserve tangent and boundary cases conservatively. This is a separate cost from selecting the nearest result: it affects intersection queries even when every returned hit is needed.

### R03 — Rejected: Bezier objects are rebuilt on every hover

**Evidence:** `_ensureContourIsLoaded:124–139` returns immediately when segments exist; `_ensureAllContoursAreLoaded:142–150` also guards repeated work. `glyph-controller.js:972–979` constructs hit testers through its representation cache.

The allocations occur on first access for that controller/geometry, not on every unchanged hover. Geometry invalidation can require rebuilding, but this candidate alone does not justify an additional cache. Retain lazy loading while improving R01/R02.

## Canvas scheduling and layout

Primary source: [canvas-controller.js](../../src-js/fontra-core/src/canvas-controller.js); helper [utils.ts](../../src-js/fontra-core/src/utils.ts). The scheduling/lifecycle mechanisms are inherited; the rectangle-based positioning has fork changes.

### R04 — Prioritize: redraw coalescing is timer-based rather than frame-based

**Evidence:** the constructor assigns `requestUpdate = consolidateCalls(() => this.draw())` at `canvas-controller.js:53`; `utils.ts:44–59` implements consolidation with `setTimeout(..., 0)`. Wheel events call it, while `draw:172–185` clears and redraws the whole scene.

Calls pending behind one timer are combined, but events in separate tasks can schedule several full draws before the next browser paint. Use one pending animation-frame request for ordinary visual invalidation, retaining an explicit immediate draw only where necessary. Static code establishes the scheduling mismatch, not a measured number of wasted frames.

### R05 — Moderate: one view-box query makes five DOM rectangle reads

**Evidence:** `getViewBox:353–373` reads width and height through getters, reads `canvasRect`, then calls `localPoint` twice, each reading the rectangle again. Snapping scene construction and visualization layers request the view box.

Read one rectangle and derive both corners using the same origin/magnification snapshot. This also avoids internally inconsistent readings if layout changes. Five reads do not imply five forced reflows: the browser can reuse clean layout. The confirmed issue is redundant querying on an interactive path, with forced-layout cost conditional on preceding DOM writes.

### R06 — Conditional lifecycle issue: a canvas controller has no disposal path

**Evidence:** `constructor:21–26` keeps its ResizeObserver only in a local variable; `_setupScrollBlocker:58–70` installs an anonymous document wheel listener closing over the controller. No teardown method retains and releases both resources.

If controllers are created and discarded within a live document, the global listener retains the old controller and wheel/timer work multiplies. The inspected editor normally owns its controller for the page lifetime, so this is not a demonstrated leak during ordinary drawing. Add explicit disposal if supporting in-page controller replacement; do not label existing page-lifetime ownership a leak.

## Visualization orchestration

Primary source: [visualization-layers.js](../../src-js/views-editor/src/visualization-layers.js), unchanged from the upstream comparison base.

### R07 — Moderate: selection buckets are reconstructed for each draw

**Evidence:** `editor.js:250–266` creates a new VisualizationContext for each normal or clean-scene draw. Its constructor calls `getGlyphsBySelectionMode:106–127`, which flattens all positioned lines and filters the glyph list twice, eagerly constructing buckets whether the active layers use them or not.

For G positioned glyphs this adds O(G) traversal and arrays per repaint, including cursor-only repaints. Prepare buckets on positioned-line/selection/hover revisions, or compute only requested buckets within the frame. Preserve object identity and editing-mode semantics. This concerns orchestration of glyph lists, not the geometry sampling findings already reported elsewhere.

### R08 — Rejected: every draw rebuilds every layer's parameter object

**Evidence:** `drawVisualizationLayers:79–96` calls `buildLayers` only when `this.layers` is absent. Setters and toggles invalidate it deliberately. Unchanged draws reuse the prepared layers.

Zoom/theme/visibility changes legitimately rebuild parameters. There is no unconditional per-draw layer rebuild here, and replacing the existing cache would add complexity without establishing a gain.

<!-- review checkpoint -->
