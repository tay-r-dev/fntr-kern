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

## Natural handle solve

Primary source: [natural-handle-solver.js](../../src-js/fontra-core/src/natural-handle-solver.js). Called by offsetCubicSide, which is used in skeleton generation and interactive ordinary-outline expansion.

### R09 — Moderate: the same derivative samples are evaluated twice per side solve

**Evidence:** `buildOffsetSamples:73–92` calls cubicPointAndDerivative at five fixed parameters. Later `pullWeightRatio:339–362` evaluates curvature at those same five parameters plus endpoints, invoking the same point/derivative helper again. The first pass also computes second derivatives that it discards.

Reuse a per-solve table containing point, velocity, speed and curvature. Share skeleton-only samples across the two side solves where their input control points agree; width-dependent requested positions and cusp factors must remain side-specific. This is constant-factor work per segment, multiplied across regenerated segments, not a claim of an unbounded numerical solver.

### R10 — Low priority: constant Bernstein coefficients are recomputed

**Evidence:** `cubicBasis:28–36` is evaluated in both sample construction and `buildPerpendicularErrorSystem:106`, although the five sample parameters are fixed constants.

Precompute the five basis records once. This saves repeated arithmetic and tiny objects, but its maximum gain per solve is small; prioritize projection and topology costs first. Do not turn this into a global geometry cache or change the quadrature/sample locations.

### R11 — Low priority: discarded diagnostics still evaluate the objective

**Evidence:** `solveNaturalHandles:365–389` computes perpendicularRms with another objective evaluation and square root. `offset-cubic.js:148–178` consumes the natural lengths and emits its own result without that RMS or the diagnostic pullWeightRatio field.

Make diagnostic output opt-in or separate it from the interactive result if profiling later shows this code is hot. The pull ratio itself is necessary for regularization and must still be calculated; only the unused output and final RMS evaluation are avoidable.

### R12 — Rejected: rectangle minimization has an uncontrolled search budget

**Evidence:** `minimizeInsideRectangle:295–336` considers at most one interior solution, four boundary solutions and four corners. It has no recursive refinement or convergence loop.

Its arrays and slice are small, bounded allocations. Scalar best-candidate tracking is possible, but this is not a likely major performance problem and should not be redesigned as an approximate solver merely because nested loops appear in the scan.

## Snap candidate selection and projection

Primary source: [snapping.js](../../src-js/fontra-core/src/snapping.js). SnappingSession.resolve/resolveSet call these routines during pointer interaction. Defaults include maxCandidates = 200 and perSideCount = 1.

### R13 — Prioritize: the collection sort recomputes curve projections in its comparator

**Evidence:** `collectCandidates:816–824` compares distanceToCandidate whenever weights tie. For curves that calls `projectOntoCurve:104–148`, performing a 50-sample coarse sweep and 20 refinements. The 200-candidate cap is applied only after sorting.

For C equal-weight candidates, O(C log C) comparisons can each invoke full projection twice. Decorate each candidate with its weight and distance once per query, then sort those scalar keys and preserve original order on ties. A bounded top-K selection can follow if needed. The candidate cap does not bound preprocessing before it.

### R14 — Moderate: each refinement evaluates the same cubic twice per point

**Evidence:** `projectOntoCurve:132–139` calls cubicAt(points, a) separately for x and y and does the same for b. Across 20 refinements that is 80 evaluations where 40 suffice.

Store each evaluated point once. Squared distance can also compare candidates without square roots, provided tolerance semantics remain unchanged. This is an exact algebraic simplification of the existing search, not a change to its bracket or convergence policy.

### R15 — Moderate: nearest-per-side sorts whole partitions to keep one item

**Evidence:** `nearestPerSide:677–703` builds contested, above and below arrays, sorts both sides, then slices each to perSideCount, whose default is 1. It is called for both axes of each point kind.

Use a single minimum per side for the default, or a bounded top-K container for configurable K. Carry alwaysKeep sources separately and preserve input-order tie breaking. This reduces O(P log P) ordering to O(P) in the common case while preserving the exemption for sources on the dragged contour.

### R16 — Moderate: disabled and zero-weight kinds are processed too late

**Evidence:** `collectCandidates:732–812` constructs metric/guide/point/segment/curve candidates before candidateFilter applies the enabled/only-kind rules. Zero-weight kinds can survive into sorting; `candidatePull:365–369` computes their distance before multiplying by zero.

Apply the existing kind rule before construction where possible and short-circuit exactly zero weight before distance evaluation. Preserve held-candidate behavior and explicit only-mode semantics. Benefits are largest when curvature or diagonals are disabled or own-generated weight is zero. Removing merely weak, nonzero kinds would change behavior and is not recommended.

### R17 — Moderate, bounded: scored candidate deduplication is quadratic

**Evidence:** `resolveSnap:468–483` scans scored with some/sameCandidate for each qualifying candidate. Up to 200 collected candidates plus a held entry can reach the resolver.

This is O(C²) identity comparison per point, though the configured cap limits it. Prefer stable geometry/source identities plus a carefully defined equivalent-line key. Do not replace epsilon-based equivalence with naive rounded keys without checking boundary semantics. Optimize expensive projection first; this bounded scalar work is a second-tier target.

### R18 — Prioritize for large selections: every selected anchor runs a full resolver

**Evidence:** `resolveSnapForPoints:609–660` chooses one nearest anchor only when pointerWeight >= 1. At the default 0.5 it calls resolveSnap for every point, each doing candidate scoring, deduplication and sorting. Candidate collection is shared but solving is not.

For P anchors, the bounded candidate work is multiplied by P; curve projection amplifies the cost. Reuse query-independent candidate geometry and prune anchors only with a conservative upper bound on discounted pull, retaining the current winner and near-indicator semantics. Simply resolving the clicked point would change the default interaction. This issue remains after fixing collection sorting and candidate deduplication.

### R19 — Moderate: curve snapping repeats projection after resolving its winner

**Evidence:** `resolveSnap:572–581` projects the winner. `roundSnapped:835–845` projects that result again to recover t/tangent, then projects the rounded trial a third time.

Carry the winning projection's t and tangent through the result. The final projection of the rounded trial is still needed to keep the emitted point on the curve; the intermediate re-search is avoidable. Reuse must be scoped to the same candidate and query, not an approximate cache across moving cursor positions.

## Snapping session and scene preparation

Primary source: [snapping-interactions.js](../../src-js/views-editor/src/snapping-interactions.js); supporting callers in the ordinary and skeleton pen tools.

### R20 — Prioritize: pen hover rebuilds a geometry snapshot even when geometry is unchanged

**Evidence:** `edit-tools-pen.js:46–47` and `edit-tools-skeleton.js:221–223` call session.refresh on hover. `SnappingSession.refresh:563–571` calls buildSnapScene, which scans path points, segments and skeleton geometry.

Pointer movement changes the query, not necessarily the scene. Reuse the snapshot until glyph geometry, exclusion/selection, source metrics/guides or viewport changes. Because the builder performs viewport culling, a geometry-only revision would be insufficient. Preserve the explicit force-refresh epoch and the frozen baseline semantics during drags. This finding is the unnecessary refresh frequency, independent of the already-documented cost of rib derivation.

### R21 — Prioritize: disabled/suppressed snapping still prepares the hover scene

**Evidence:** the same pen callers invoke refresh before setting suppression or calling resolve. The enabled check is inside `resolve:629–634`, after refresh has already done its work; the SnappingSession constructor also eagerly builds a scene.

Skip or lazily defer scene construction while snapping is disabled or the tool is performing a gesture that suppresses snapping. Clear published guides/indicator immediately and mark the snapshot dirty for re-enabling. This provides a no-snapping fast path even when revisions cannot yet be introduced for R20.

### R22 — Prioritize: debug publication repeats candidate scoring unconditionally

**Evidence:** `_publish:592–626` calls candidatePull for every candidate to compute byKind on every resolve, regardless of whether the debug UI is visible. Curves therefore incur another complete projection search after collection/resolution.

Separate the cheap visual publication from debug aggregation. Compute diagnostics only while observed, or reuse the exact matching query scores when available. In resolveSet, debug scores use the cursor while candidate selection evaluates anchors, so not every score can be reused blindly. This concerns producer-side scoring, not the debug-panel polling already reported.

### R23 — Moderate: scene construction walks path segments twice

**Evidence:** `buildSnapScene:336–360` first iterates all path segments for straight candidates, discarding curves, then repeats iterPathSegments to collect curves. That iterator materializes segment geometry.

Collect both outputs in one traversal while preserving their different exclusion rules: moved straight/generated geometry is excluded, but ordinary cubic projections can intentionally refer to the frozen pre-drag curve. This reduces scene-build work and allocations without changing which targets exist. It helps even for legitimately required snapshot rebuilds.

## Tension-aware geometry

Primary source: [tension-aware-edit.js](../../src-js/fontra-core/src/tension-aware-edit.js). Pointer and transform entries call applyTensionAwareEdit; the skeleton adapters use the same math.

### R24 — Prioritize for long coupled groups: repeated group serialization just to deduplicate

**Evidence:** `carryCoupledStraights:916–920` iterates groups.values, maps each group to indices, copies/sorts those indices and joins a string before testing seen. The collector in `offset-contour.js:175–176` assigns the same group array to every member.

A group of G members therefore repeats a G-element map/sort G times: O(G² log G) deduplication work. Check group-array identity in a Set before building indices. This relies on the collector's current shared-array contract; document it or expose unique groups explicitly. It removes duplicate downstream processing rather than changing how coupling is calculated.

### R25 — Prioritize for multi-point correction: each carried point scans every segment for its handles

**Evidence:** `moveOnCurveWithHandles:860–881` traverses all segments to find the cubic handles adjacent to one on-curve. `carryCoupledStraights:927–940` can call it for multiple points.

For M moved points and S segments this is O(MS), although an on-curve has only a small local adjacency. Build a point-to-adjacent-handle-index map once per immutable topology and visit those entries directly. Preserve both incidences on closed contours and update each intended handle once. This is within the math routine, separate from the previously reported whole-skeleton mapping cost.

### R26 — Prioritize: rigid-link scale reconstructs invariant topology every frame

**Evidence:** `solveRigidLinkScale:659–709` rebuilds indexed segments, straight bodies, curve runs, body bounds and their axis ordering on every call. `makeTensionAwareAxisScaleSolver` in `tension-aware-editing.js:277–305` captures unchanged original contours but invokes that preparation again for each transform frame.

Prepare the body/run graph, bounds, order and gap proportions once per gesture and axis; then solve the factor/origin-dependent displacement each frame. Parameter-dependent correction still runs afterward. This avoids repeated topology work without caching a previous frame's answer or introducing path dependence.

### R27 — Rejected: tension restoration always solves unchanged segments

**Evidence:** `restoreSegmentTensions:191–213` compares the displacement of the two endpoints and skips a segment when both take the same delta. This covers unchanged segments and pure translation before tangent/tension calculations.

The segment walk itself still occurs, but the expensive correction is already guarded. Preserve this fast path. A claim that every segment receives a full solve on every drag would be inaccurate.

## Base-offset support

Primary source: [offset-contour.js](../../src-js/fontra-core/src/offset-contour.js), reached by the ordinary-outline base-expand gesture.

### R28 — Moderate: expanded group members repeatedly search the original point array

**Evidence:** `expandIndicesToCoupledGroups:844–857` loops selected points, then each selected point's group, and calls points.indexOf(member). Multiple selected points in one group also revisit the same members.

Build an object-identity-to-index map once and process each distinct group once. For N points and repeated membership visits V, replace O(VN) lookup work with O(N + V), reducing V too through group identity. Precompute expanded selection for a gesture whose baseline topology and selection stay fixed. This is the base-offset index mapping, not a repeat of the earlier rib-reader finding.

### R29 — Rejected: the wrapping control-point loop necessarily risks an infinite loop

**Evidence:** `getControlPointIndicesBetween:817–830` is called by offsetSegmentHandles with start/end indices drawn from its own onCurveIndices array. Valid endpoints are therefore within the same finite point array; closed traversal reaches the end index, while open traversal also stops at array length.

For these internal call sites, the while loop is bounded by contour length. No malformed-input scenario is needed to explain normal performance, and adding arbitrary iteration limits would not solve an established problem here.

<!-- review checkpoint -->
