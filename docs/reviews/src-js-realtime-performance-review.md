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

<!-- review checkpoint -->
