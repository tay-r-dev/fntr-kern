# forkra Feature Architecture Map

**Date:** 2026-07-22. Skeleton sections re-verified 2026-07-28 on `fix/skeleton-expand-math`.
**Verified against:** `refactor-simple/ws17-parity-bugs`, diffed against `upstream/main` (`f70e2017f`)
**Scope:** every file forkra adds or changes on top of upstream Fontra, mapped to the feature that owns it.

This is the **inventory and ownership map**. It names what we built, where each part lives, and
what you may touch. A fresh session or a delegated agent can start work from it without deriving
the architecture again.

We re-integrated the skeleton from an older fork (the "donor") between 2026-07 and now. We ported
the geometry math and redesigned all of the plumbing. That work is finished. The integration
roadmap that planned it is retired, and its durable content is now **§9 (skeleton design
rationale)**. So this file stands alone, and §9 covers why the skeleton has the shape it has.

We retired the per-feature design specs and implementation plans the same way. The `specs/` and
`plans/` folders held the offset construction, the generated-segment gizmos, the curvature pin,
the continuous natural solver and the true geometric handle ceiling. Those folders are
**dissolved**, and their durable content is now in this doc and in the feature model. No plan
still holds a forward-looking statement. If a statement is still true, it is in one of the docs
in the table below.

Two files remain under those folders. They are the serif generator's design and plan, dated
2026-07-30, plus the `serif-lab.html` mockup they were written against. The serif is shipped, so
their durable content is now in feature model §8 and in log entries 20–22. Retire them the same
way once nothing references them.

| Doc                         | Answers                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SKELETON-FEATURE-MODEL.md` | The conceptual **mental model** of forkra's skeleton: what the feature is, how the generation pipeline works, what to preserve |
| `DEVELOPMENT-LOG.md`        | **What happened, in order**: one entry per feature or fix, with what went wrong on the way                                     |
| `GLOSSARY.md`               | **What the words mean**: type-design terms, plus every term forkra invented or redefined                                       |
| **this doc**                | Where everything **is**, who owns it, and (§9) why the skeleton is built this way                                              |

---

## 0. How to use this doc

- **To start a feature task**, find the feature in §3. That section lists every file you need,
  and every interface you must call through.
- **Before you edit a shared file** (`editor.js`, `scene-model.js`, `edit-tools-pointer.js`,
  `visualization-layer-definitions.js`, `scene-controller.js`, `panel-transformation.js`),
  read §4. Several features share those files, and the hunks are not interleaved by accident.
- **To add a new feature**, read §2 for the rails. Then read §5 for the infrastructure you must
  extend instead of duplicate.
- **Line counts** come from `git diff --numstat` against upstream, as `+added / −removed`.
  For a new file, the added count is the file length.

**Totals:** 71 files under `src-js` (+28,809 / −131), 1 backend file, 4 docs, 1 test fixture font.
212 non-merge commits.

---

## 1. Feature inventory

| #   | Feature                 | Status                          | Origin                         | Owned files                                              | Entry point                                 |
| --- | ----------------------- | ------------------------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| F1  | **Coarse grid**         | shipped (WS-1)                  | donor panel + forkra mechanics | 1 new core, 1 panel                                      | `fontra.coarse.grid` layer, `f`/`g` actions |
| F2  | **Q-measure**           | shipped (WS-2)                  | donor port                     | 1 new editor module                                      | hold **Q** / **Alt+Q**                      |
| F3  | **SpeedPunk**           | shipped (WS-3)                  | fork-original + donor panel    | `curvature.js`                                           | `fontra.curvature` layer                    |
| F4  | **Tunni**               | shipped (WS-4)                  | fork-original, refactored      | 1 core + 1 editor module                                 | `fontra.tunni.*` layers                     |
| F5  | **Point labels**        | shipped (WS-4.5)                | fork-original, relocated       | inside `distance-angle.js`                               | `fontra.point.labels` layer                 |
| F6  | **Letterspacer**        | shipped (WS-5)                  | donor port                     | engine + panel + overlay                                 | Selection-info sidebar                      |
| F7  | **Skeleton**            | shipped WS-6…WS-17              | re-integrated from donor       | 5 core + 7 editor + panel set                            | Skeleton Pen tool, right sidebar            |
| F8  | **Carried fork extras** | shipped, pre-dating the program | fork-original                  | `corner-overlap.js`, quad handles, equalize, pen-connect | scattered — see §3.8                        |

Feature sizes, owned code only. Shared-file hunks are excluded.

```
Skeleton      ████████████████████████████████████████  ~16,300 lines
Letterspacer  █████                                      ~1,900
Tunni         █████                                      ~1,850
Measure+labels████                                       ~2,050  (F2 + F5 share distance-angle.js)
SpeedPunk     █▌                                           ~460
Corner overlap█                                            ~350
Coarse grid   ▏                                             ~66
```

---

## 2. The rails (constraints every feature obeys)

These rails put the skeleton design model (§9) into practice. A few of them predate the skeleton
and come from the WS-1…5 program. They are the reason the file layout looks the way it does.
Break one and you get a regression the tests cannot catch.

**R-A — Layer placement is fixed.**
Pure geometry and math go in `fontra-core/src/`, with mocha tests. Hit-testing goes in
`scene-model.js` as `*AtPoint` methods. Interaction goes in a dedicated `*-interactions.js` or
`skeleton-*.js` module. Rendering goes in a `visualization-layer-*.js` file, or in a render-only
draw in `visualization-layer-definitions.js`. `edit-tools-pointer.js` stays a **thin dispatcher**.

**R-B — One copy of every constant and geometry function.**
If a symbol exists anywhere in forkra, import it. This rail exists because the donor had
`projectRibPoint` twice and `DEFAULT_SKELETON_WIDTH` five times.

**R-C — Skeleton: one write path.** Every skeleton mutation goes through `editSkeleton`
(`views-editor/src/skeleton-editing.js:94`). On the editing side, nothing else calls the
generator. Nothing writes skeleton customData outside `editSkeleton`.

**R-D — Skeleton: provenance forward, never recovered.** The generator emits the map from
skeleton point to generated point. Nothing in the tree recovers that map by geometric matching or
by tolerance-based inverse projection.

**R-E — No kind-branching in shared emit code.** `makeChangeForDelta` and the code below it must
not contain `if (skeleton…)`. **Target entries** decide the kind at construction time instead.

**R-F — Cross-cutting modifiers are behavior names**, not bypass flags. `skeleton-model.js` holds
the semantics. `skeleton-editing.js` maps an event or a key to a behavior name.

> There is no `skeleton-modifiers.js`. An earlier draft of this doc claimed one file in core and
> one in the editor. Neither has ever existed in the tree.

**R-G — Test split.** Only `fontra-core` has a test harness (mocha + chai, `npm test`).
`views-editor` has no harness, so a change to `views-editor` carries a manual test matrix in its
plan. Every commit runs three commands: `node --check` on each touched editor file, then
`npx prettier --write`, then `npm run bundle`. All three must pass.

---

## 3. Per-feature file maps

### F1 — Coarse grid

Snap-to-grid with presets and a panel. forkra already had the mechanics. WS-1 added the UI.

| File                                                  | +/−      | Role                                             |
| ----------------------------------------------------- | -------- | ------------------------------------------------ |
| `fontra-core/src/coarse-grid-presets.js`              | +66      | **NEW** — preset table and resolution math       |
| `views-editor/src/panel-designspace-navigation.js`    | (shared) | Coarse-grid accordion                            |
| `views-editor/src/scene-controller.js`                | (shared) | `coarseGridSpacing` setting, `f`/`g` actions     |
| `views-editor/src/edit-behavior.js`                   | (shared) | the actual snapping during edits                 |
| `views-editor/src/visualization-layer-definitions.js` | (shared) | `fontra.coarse.grid` layer                       |
| `fontra-core/src/application-settings.js`             | +9       | app-level (localStorage) keys — **not** per-font |
| `fontra-core/tests/test-coarse-grid-presets.js`       | +80      | tests                                            |

Settings live in `applicationSettingsController` by decision D9. They are view preferences, and
nothing writes them to a project file.

### F2 — Q-measure

Hold **Q** for realtime measurement. Hold **Alt+Q** for direct mode.

| File                                                  | +/−                   | Role                                                                                         |
| ----------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `views-editor/src/measure-interactions.js`            | +503                  | **NEW** — key state, hover detection, dispatch                                               |
| `fontra-core/src/distance-angle.js`                   | (shared, +1545 total) | `calculateHandleMeasure`, `calculateProjectedDistanceComponents`, `drawMeasureOverlay`       |
| `views-editor/src/scene-model.js`                     | (shared)              | `setMeasureActive`, `setMeasureShowDirect`, `setMeasureHoverTarget`, `getMeasureHoverTarget` |
| `views-editor/src/editor.js`                          | (shared)              | `action.realtime.measure`, `…measure-direct`; topic `realtime-hotkeys`                       |
| `views-editor/src/visualization-layer-definitions.js` | (shared)              | `fontra.measure.overlay`, registration-only                                                  |
| `fontra-core/tests/test-distance-angle.js`            | +84                   | tests                                                                                        |

Q-measure also measures the skeleton: rib width, centerline segments and skeleton handles. That
is item 4.12, fixed 2026-07-22 through `skeletonSegmentAtPoint` and `skeletonHandleAtPoint` in
`scene-model.js`. Two jobs in the same area are still open. Branch 5.1 owes the z-order and
hit-radius cleanup. Branch 5.2 owes the drag-marker affordance.

### F3 — SpeedPunk

Curvature combs with app-level parameters: peak height, sharpness and opacity.

| File                                                  | +/−      | Role                                                |
| ----------------------------------------------------- | -------- | --------------------------------------------------- |
| `fontra-core/src/curvature.js`                        | +460     | **NEW** — sampling math + `computeSpeedPunkSamples` |
| `views-editor/src/visualization-layer-definitions.js` | (shared) | `fontra.curvature`, render-only                     |
| `views-editor/src/panel-designspace-navigation.js`    | (shared) | SpeedPunk accordion                                 |
| `fontra-core/src/application-settings.js`             | +9       | shared with F1                                      |
| `fontra-core/tests/test-curvature-sampling.js`        | +112     | tests                                               |

Peak height is UPM-relative. That normalization replaced the original hardcoded `* -180000`
magic constants.

### F4 — Tunni

The keystone refactor. A 1,346-line monolith became pure math, plus interaction, plus render-only
draws.

| File                                                  | +/−      | Role                                                          |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------- |
| `fontra-core/src/tunni-calculations.js`               | +668     | **NEW** — pure math only. Canonical `calculateSegmentTension` |
| `views-editor/src/tunni-interactions.js`              | +1621    | **NEW** — hit-tests, drag handlers, equalize trigger          |
| `views-editor/src/edit-tools-pointer.js`              | (shared) | thin dispatch hooks only                                      |
| `views-editor/src/visualization-layer-definitions.js` | (shared) | `fontra.tunni.handle`, `fontra.tunni.point`                   |
| `views-editor/src/panel-transformation.js`            | (shared) | settings keys                                                 |
| `fontra-core/tests/test-tunni-calculations.js`        | +82      | tests                                                         |

**The naming is settled and load-bearing** (decisions D2, D3 and D4: a hard rename, with no
aliases).

| Geometry                                              | Canonical name                | Layer id              |
| ----------------------------------------------------- | ----------------------------- | --------------------- |
| Intersection of tangent rays = the _real_ Tunni point | `calculateTunniPoint`         | `fontra.tunni.point`  |
| Midpoint between the two control handles              | `calculateControlHandlePoint` | `fontra.tunni.handle` |

`calculateSegmentTension` is the **single** tension source (D5). `distance-angle.js` imports it.
Its old `calculateTension` and its duplicate tunni-point geometry are both deleted.

### F5 — Point labels

Per-segment distance, tension and angle labels. Formerly "Tunni Labels" (D8).

| File                                                  | +/−              | Role                                         |
| ----------------------------------------------------- | ---------------- | -------------------------------------------- |
| `fontra-core/src/distance-angle.js`                   | (shared with F2) | `drawTunniLabels`, consuming central tension |
| `views-editor/src/visualization-layer-definitions.js` | (shared)         | `fontra.point.labels`, registration-only     |
| `views-editor/src/panel-transformation.js`            | (shared)         | label toggles                                |

The skeleton has its **own** label layer, `fontra.skeleton.point-labels`. Registry item 4.1
separated them on purpose. Do not merge them.

### F6 — Letterspacer

HTLetterspacer-style automatic sidebearings.

| File                                                     | +/−      | Role                                           |
| -------------------------------------------------------- | -------- | ---------------------------------------------- |
| `fontra-core/src/letterspacer-engine.js`                 | +215     | **NEW** — pure area/margin math                |
| `views-editor/src/panel-letterspacer.js`                 | +1528    | **NEW** — panel UI                             |
| `views-editor/src/visualization-layer-letterspacer.js`   | +150     | **NEW** — `letterspacer-visualization` overlay |
| `views-editor/src/panel-selection-info.js`               | (shared) | hosts the panel                                |
| `fontra-core/assets/tabler-icons/spacing-horizontal.svg` | +7       | icon                                           |
| `fontra-core/tests/test-letterspacer-engine.js`          | +93      | tests                                          |

It persists through the `fontra.internal` customData section `letterspacer`, at three entity
levels: `area`, `depth` and `overshoot` per source, `enabled` per font, and `referenceGlyphName`
per glyph.

**The port deliberately left out one coupling, and that coupling is wanted again.** A sidebearing
change should move the skeleton data with it. Verify whether the code does this before you assume
it. See §7 residue #2.

### F7 — Skeleton

The largest feature by an order of magnitude. It owns about 16,300 lines across 12 files. Below
that, it also changed the tools that had to learn about generated contours.
The design is stroke-based. The designer draws centerlines with per-point widths, and the
generator builds the filled outline contours live.

**Core (pure, mocha-tested):**

| File                                       | Lines | Role                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/skeleton-model.js`        | 3744  | Schema, stable-id allocation, source defaults, accessors/mutators, rib projection, normals, D/S/X/Z semantics (`applyFixedRibDelta`, the equalize family), Tunni/gizmo geometry. **The single home for skeleton geometry constants.**                |
| `fontra-core/src/skeleton-generator.js`    | 4730  | Centerline → outline. Owns segmentation, ribs, skeleton handle axes, collapsed sides, contour topology, provenance, nudges, grid emission, caps (butt/round/square/**drop**/**serif**), and corner rounding.                                         |
| `fontra-core/src/serif-geometry.js`        | 268   | **NEW** — the serif terminal as pure frame geometry: `computeSerifFrame`, `buildHalfSerif`, `buildSerifTerminal`. Knows nothing about strokes, trimming or splicing; the generator owns all of that. See feature model §8.                           |
| `fontra-core/src/natural-handle-solver.js` | 320   | Pure automatic cubic-side geometry: fixed source-parameter offset samples, normalized perpendicular-error quadratic, skeleton-tension reference, input-only cusp/taper pull, positive frame-influence scale, and exact box-constrained minimization. |
| `fontra-core/src/offset-cubic.js`          | 118   | Stateless authored cubic-side orchestrator. Builds the shared handle domain, calls the natural solver, then applies attached grid adjustments, pinned harmonic-mean tension, and detached absolute handles in that order.                            |

**Editor (no test harness — manual matrices):**

| File                                               | +/−   | Role                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views-editor/src/skeleton-editing.js`             | +1400 | **`editSkeleton` — the one write path (R-C).** Selection keys, target entries, contour-index bookkeeping, selection bounds; rib keys/addresses and their width/nudge executors; editable generated points and handles, provenance resolution, detach |
| `views-editor/src/edit-tools-skeleton.js`          | +855  | Skeleton Pen drawing tool                                                                                                                                                                                                                            |
| `views-editor/src/visualization-layer-skeleton.js` | +919  | 13 canvas layers                                                                                                                                                                                                                                     |
| `views-editor/src/panel-skeleton-parameters.js`    | +1695 | Numeric editing panel (right sidebar). Rebuilds in place when only values changed (`formContentsLayoutSignature`), so a field keeps focus across an edit                                                                                             |
| `views-editor/src/skeleton-panel-edits.js`         | +1012 | Panel → `editSkeleton` write helpers, streaming edits, relative scale helpers                                                                                                                                                                        |
| `views-editor/src/skeleton-panel-model.js`         | +573  | Panel read model: selection summaries, mixed/uniform state                                                                                                                                                                                           |
| `views-editor/src/panel-skeleton-defaults.js`      | +483  | Per-source defaults panel                                                                                                                                                                                                                            |

> There is no `skeleton-ribs.js` and no `skeleton-generated.js`. An earlier draft of this doc
> listed both as separate editor modules with line counts. Neither has ever existed in the tree,
> and the contents it described live in `skeleton-editing.js`. This is the same class of error as
> the `skeleton-modifiers.js` claim corrected in R-F. **Grep before you trust a filename here.**

**Selection kinds** — compound keys, all id-based, never path indices:

```
skeletonPoint/<contourId>/<pointId>                        on-curve AND handles (C1)
skeletonRib/<contourId>/<pointId>/<side>                   side ∈ left|right
editableGeneratedPoint/<contourId>/<pointId>/<side>
editableGeneratedHandle/<contourId>/<pointId>/<side>/<role>  role ∈ in|out
```

`fontra-core/src/utils.ts` changed (+14/−6) for one reason. `parseSelection` must keep the raw
remainder for these compound kinds instead of running `parseInt` on it.

**Visualization layers (13):**
`width-shading`, `ribs`, `rib-points`, `centerline`, `handles`, `nodes`, `selected-nodes`,
`tunni`, `generated-tunni`, `generated-curvature-labels`, `insert-handles-preview`,
`editable-markers`, `point-labels`. All of them sit under `fontra.skeleton.*` in
`visualization-layer-skeleton.js`. The last two of the generated pair are the outline's own
gizmos and their readout. They stay separate from `tunni`, which controls the skeleton.

**Hit-testing** — all in `scene-model.js`, per R-A:
`skeletonPointAtPoint`, `skeletonRibAtPoint`, `skeletonTunniAtPoint`, `editableGeneratedAtPoint`,
`skeletonRibSelectionAtPoint`, `skeletonSegmentSelectionAtPoint`, plus `isGeneratedPathContour`.
`generatedTunniHitTest` in `skeleton-model.js` hit-tests the generated-segment gizmos, because
the drawing layer shares their placement math and there must be exactly one copy of it (R-B).
`scene-model.js` also owns the curvature drag's readout.

**The layer switch `fontra.skeleton.generated-tunni` is the gizmo mode's single source of truth.**
The panel checkbox and the View menu both read and write that one setting, so they cannot drift.
`editableGeneratedAtPoint` returns null while the switch is on. The two modes compete for the
same clicks, because the gizmos sit on and around the very handles that direct manipulation
targets.

**Tests:** `test-skeleton-generator.js` (1454), `test-skeleton-model.js` (1052),
`test-skeleton-tunni.js` (879), `test-skeleton-modifiers.js` (861),
`test-skeleton-ribs.js` (641), `test-natural-handle-solver.js` (695),
`test-offset-cubic.js` (385), `test-serif-geometry.js` (377),
`test-skeleton-source-defaults.js` (125), `test-skeleton-interpolation.js` (138).
Golden-master fixtures live in `tests/data/skeleton-generator/fixtures.json` (2183).
`tests/scripts/make-skeleton-generator-fixtures.js` regenerates them. It records **this**
generator's own output, not any pre-port reference.

**Other tools had to learn about generated contours.** These changes are small but essential.

| File                  | +/−     | What it learned                                                                                                       |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `edit-tools-knife.js` | +54/−1  | Never slice generated contours; carry identity through slicing via temporary point attributes, then re-derive indices |
| `edit-tools-pen.js`   | +125/−2 | Never insert into generated contours; record index shifts via `recordSkeletonContourIndexShift`                       |
| `edit-tools-shape.js` | +3      | Comment only — `appendPath` appends after the generated block, so no bookkeeping needed                               |

Copy the pattern in the `edit-tools-shape.js` row. When a tool restructures the contour list, it
must do one of two things. It must update the generated-contour mapping in the same change, or it
must prove that the mapping cannot move.

### F8 — Carried fork extras

These features predate the WS program, and the refactor kept them. They have no workstream and
thin documentation. This section flags them so nobody mistakes them for upstream code.

| Feature                  | Files                                                                                                                          | Notes                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Corner overlap**       | `fontra-core/src/corner-overlap.js` (+350), consumed via `path-functions.js:addOverlapToPath`, action in `scene-controller.js` | Pre-program feature; keeps defensive path validation in `doAddOverlap`       |
| **Quad handles**         | `path-functions.js:insertHandles` (type/shiftKey params), `edit-tools-pen.js`                                                  | Shift modifier picks 1 vs 2 handles for quad curves                          |
| **Equalize**             | `edit-behavior.js`, `tunni-interactions.js`                                                                                    | Alt-drag. Explicitly frozen during WS-4 — regression-watch it                |
| **Pen connect**          | `edit-tools-pen.js:_getPathConnectTargetPoint`                                                                                 | Connect to an open contour's endpoint                                        |
| **Distance / Manhattan** | `distance-angle.js`, two layers                                                                                                | Frozen — superseded by Q-measure, kept because `distance-angle.js` is shared |

---

## 4. Shared-file reverse index

Twelve files carry hunks from more than one feature. **Read this before you edit them.**

| File                                                  | +/−      | Feature split                                                                                                             |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `views-editor/src/scene-model.js`                     | +604/−9  | **Skeleton** (6 `*AtPoint` methods, generated-contour predicate) ≫ **Q-measure** (hover state) > Tunni                    |
| `views-editor/src/edit-tools-pointer.js`              | +507/−19 | **Skeleton** (drag/marquee/transform dispatch) > **Tunni** (thin hooks) > measure, equalize. Must stay a dispatcher (R-A) |
| `views-editor/src/panel-designspace-navigation.js`    | +503/−0  | **Coarse grid** ≈ **SpeedPunk**. Pure insertion — two accordions                                                          |
| `views-editor/src/visualization-layer-definitions.js` | +415/−0  | **Tunni** > **Coarse grid** > SpeedPunk, measure, labels, quad handles. Registration + render-only                        |
| `views-editor/src/scene-controller.js`                | +345/−11 | **Skeleton** ≫ **Coarse grid**. Also corner-overlap action, labels, speedpunk                                             |
| `views-editor/src/editor.js`                          | +318/−18 | **Skeleton** (tool + panel + actions) ≫ measure actions, letterspacer                                                     |
| `views-editor/src/panel-transformation.js`            | +259/−24 | **Skeleton** ≈ **point labels**                                                                                           |
| `views-editor/src/edit-behavior.js`                   | +167/−15 | **Coarse grid** (snapping) > ribs, equalize. Kept close to upstream on purpose (R-E)                                      |
| `views-editor/src/edit-tools-pen.js`                  | +125/−2  | **Quad handles** + **pen connect** + skeleton index bookkeeping                                                           |
| `fontra-core/src/glyph-controller.js`                 | +67/−0   | **Skeleton** only — selection bounds parse skeleton keys                                                                  |
| `fontra-webcomponents/src/range-slider.js`            | +53/−10  | **Skeleton panel** — `allowInputBeyondRange`, `displayValue`, `values`, `step`                                            |
| `fontra-webcomponents/src/ui-form.js`                 | +56/−0   | **Skeleton panel** — passes those slider options through; adds checkbox with indeterminate                                |
| `views-editor/src/panel-selection-info.js`            | +24/−1   | Hosts **letterspacer** + **skeleton-defaults** sub-panels                                                                 |
| `fontra-core/assets/lang/en.js`                       | +107/−0  | skeleton-parameters 73, designspace-navigation 11, letterspacer 7, realtime shortcuts 5, skeleton tool 6                  |

Small shared edits worth knowing about:

| File                                | +/−     | Why                                                                   |
| ----------------------------------- | ------- | --------------------------------------------------------------------- |
| `fontra-core/src/utils.ts`          | +14/−6  | `parseSelection` must not `parseInt` compound skeleton keys           |
| `fontra-core/src/var-glyph.js`      | +3      | `customData` survives glyph copy — skeleton persistence depends on it |
| `fontra-core/src/var-path.js`       | +8/−2   | `copy()` tolerates a Proxy-wrapped `coordinates`                      |
| `fontra-core/src/path-functions.js` | +45/−12 | quad handles + corner-overlap entry                                   |
| `fontra-core/src/mouse-tracker.js`  | +2/−1   | —                                                                     |

---

## 5. Cross-cutting infrastructure

### Persistence — `fontra.internal` customData

One key, three sections (`fontra-core/src/fontra-internal-schema.js`):

```js
FONTRA_INTERNAL_KEY = "fontra.internal";
FONTRA_INTERNAL_SECTIONS = { LETTERSPACER, SKELETON, SKELETON_DEFAULTS };
```

Access it **only** through `fontra-core/src/fontra-internal-data.js`, with
`getFontraInternalSection` and `setFontraInternalSection`. `test-fontra-internal-data.js` covers
them. customData is freeform, and every Fontra backend round-trips it, so this data lands
permanently in the user's project files (`.fontra`, `.designspace`, UFO lib).

### The one backend change

`src/fontra/core/classes.py` gets **a single line**:

```python
class StaticGlyph:
    customData: CustomData = field(default_factory=dict)
```

Skeleton data is per-layer, and upstream `StaticGlyph` had no `customData`. The change is
mirrored in `src-js/fontra-core/src/classes.json` (+4).

> ⚠️ `classes.json` is **generated**. If you regenerate it from a Python environment outside the
> venv, the regeneration silently deletes this field again. See the memory note on the venv
> layout. The venv imports this repo's `src`. A `python` on the ambient path may import a stale
> clone instead.

### App-level settings

`fontra-core/src/application-settings.js` (+9) holds the SpeedPunk and coarse-grid view
preferences in `applicationSettingsController` (localStorage). They are deliberately **not**
per-font (D9).

### Assets

`assets/images/skeleton-pen.svg` and `assets/tabler-icons/bone.svg` for the skeleton.
`assets/tabler-icons/spacing-horizontal.svg` for the letterspacer.

### Test fixture font

`test-py/data/fonts/SkeletonRendering.fontra/` holds a glyph with skeleton data, for rendering
checks.

---

## 6. Test coverage map

Run `cd src-js/fontra-core && npm test`. The suite currently holds **1690 tests**.

| Feature                             | Automated                                                                                   | Manual only                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Coarse grid                         | presets math                                                                                | panel, snapping feel                                        |
| Q-measure                           | measure math                                                                                | overlay, hover, key handling                                |
| SpeedPunk                           | sampling math                                                                               | comb rendering, sliders                                     |
| Tunni                               | all math + tension                                                                          | drag, equalize, layers                                      |
| Letterspacer                        | engine + persistence round-trip                                                             | panel, apply, overlay                                       |
| Skeleton                            | model, generator (+ golden masters), modifiers, ribs, tunni, source defaults, interpolation | **all interaction** — drag, marquee, transform, tool, panel |
| Corner overlap / quad / pen-connect | none                                                                                        | all                                                         |

The gap in that right-hand column is structural, not an oversight. By forkra convention
`views-editor` has no test harness. That is why every editor-side plan carries an explicit manual
test matrix, and why "I ran the bundle" is not evidence that an interaction works.

---

## 7. Known gaps and residue

**Bug snapshot.** We no longer keep the standalone parity-bugs registry. This is what was open
when the doc was last verified, on 2026-07-22. Re-check it against the code before you rely on it.

| Item               | Summary                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| 6.10               | Detached handles "shiver" when adjusting skeleton handles (investigated, unresolved) |
| 4.4 / 5.1          | Deprecated 2026-07-22 — not reproduced on forkra; rationale kept in the registry     |
| 4.9–4.13, 5.2, 5.3 | Fixed 2026-07-21/22 — **manual test matrices still owed**                            |

**Structural debt, not yet filed as bugs:**

1. **Rib and editable-generated entries do not implement `makeChangeForTransformation`.** Both
   return `null`. We verified this again on 2026-07-28. So a rib-only marquee selection draws a
   transform box that does nothing. The skeleton **point** entry does implement the method, and
   the mirror side-swap hooks into that implementation. Copy it.
2. **Letterspacer-to-skeleton coupling.** Verify whether a sidebearing change moves the skeleton
   data before you assume it works. The sidebearing-variables work must route through this
   coupling. It is not yet in the base margin-set path.
3. **`skeleton-generator.js` is 4,730 lines.** The port justifies it, but it is the single
   largest file in the fork. It is the one place where defect **P6** (§9, monoliths) still bites.
   We built the serif the other way as a deliberate counter-example. Its geometry is a separate
   268-line core module, and only the trimming and splicing live in the generator.
4. **A pin of exactly zero reads as "no pin"** in `shiftTensionsToMean`
   (`tunni-calculations.js`). A pin of zero therefore falls back to the natural solve. The
   smallest positive pin instead snaps the handles to nearly collapsed. Between those two values
   the shape steps by tens of units, at the very bottom of the curvature gizmo's range. We
   measured this on `_external/g.json` and reproduced it with the serif switched off. Every
   curvature pin in the app shares this code, so we left the code alone instead of changing it as
   a side effect of serif work. Reported 2026-08-02, undecided.

---

## 8. Delegation recipes

Minimal reading sets for the most likely next tasks. Each one assumes you have read §2 (the
rails).

**"Add a skeleton parameter to the panel"**
`skeleton-model.js` (accessor) → `skeleton-panel-model.js` (summarize across the selection) →
`skeleton-panel-edits.js` (write through `editSkeleton`) → `panel-skeleton-parameters.js`
(widget) → `lang/en.js`. Never call the generator, and never write customData directly (R-C).

**"Make feature X skeleton-aware"** (the Q-measure fix, item 4.12, is the worked example)
`scene-model.js` for the hit-test. Reuse the private skeleton iterators such as
`iterSkeletonCurveSegments`, and do not duplicate them. Then `skeleton-model.js` for the geometry:
rib positions and normals, which you must **not** recompute. Then the feature's own interaction
module, which only consumes and tags. `skeleton-generator.js` emits provenance, and the helpers in
`skeleton-model.js` resolve it. Never recover it by geometry matching (R-D).

**"Fix a skeleton editing behavior"**
`views-editor/src/skeleton-editing.js` holds the target entries, the map from key to behavior
name, and the behavior executors. `skeleton-model.js` holds the modifier semantics
(`applyFixedRibDelta`, the equalize family). If the fix wants a branch inside `makeChangeForDelta`,
it is the wrong fix (R-E).

**"Change generated outline geometry"**
Use `skeleton-generator.js` with `test-skeleton-generator.js`. If the change touches cubic handle
lengths, also use `natural-handle-solver.js` and `offset-cubic.js` with their matching tests. TDD
is available here, and expected.

The feature model holds the hard constraints. Every one of them must survive the change:

- **Point-count stability.** The generated point count must not vary, or cross-master
  interpolation breaks.
- **Fixed sample identity.** The solve uses the same five source parameters every time. Add no
  projection, no refit and no candidate search.
- **One strictly convex objective.** Its positive pull may read only the input skeleton and the
  input widths.
- **The positive, non-crossing handle domain.** Keep the existing floor and ceiling.
- **The authored-state order.** Natural answer, then attached adjustments, then the pinned
  tension, then detached handles.
- **A pinned curvature is permanent.** Generation may clamp the output, and may never rewrite the
  stored number.

Read the feature model's §9 before you start. It lists what we already tried here and rejected on
measurement. That list includes two ideas we re-proposed and reverted twice, and three guards we
deleted because the handle domain already enforces them.

**Test a geometry change with a sweep, not an assertion.** Hold the geometry fixed, walk one
input through its range in fine steps, and measure the worst single-step movement against the
driver's own step. A per-configuration assertion has missed every fault in this module so far.
Start the sweep away from degenerate configurations. A sweep that begins at zero-length handles
reports its own seed as a 700-unit jump.

**"Change the serif terminal"**
Use `serif-geometry.js` and `test-serif-geometry.js` for anything about the terminal's own shape.
Use `buildSerifCap` in `skeleton-generator.js` for how it is trimmed onto the stroke and spliced
in. Keep that split. The geometry module never learns what a stroke is.

Read feature model §8 first. Read the release rule in particular: **the terminal's on-curves are
fixed in the serif's own frame, and the edge is brought to them, never the reverse.** A terminal
built off the cut is the one mistake this feature has already made and reverted.

**"Touch anything a terminal trims"**
A trimmed terminal makes the emitted segment shorter than the segment the generator solved.
Anything that measures the emitted one then measures the wrong curve.
`splitTerminalSideForRoundCap` publishes the uncut segment on the inserted point's provenance, as
`constructionSegment`. `generatedSegmentConstructionPoints` in `skeleton-model.js` is the one
reader that resolves it. Go through that reader. Do not measure a generated segment's shape from
`segment.points` directly.

**"Add a visualization"**
Add a new draw in the feature's `visualization-layer-*.js`. Register it in
`visualization-layer-definitions.js` with `draw: <importedFn>` only.

---

## 9. Skeleton design rationale

This section holds the durable "why" behind the skeleton. It comes from the retired integration
roadmap, updated to what the code does today. We **re-integrated** the skeleton, we did not merge
it. We ported the donor's proven geometry math, and we redesigned every piece of plumbing around
four concepts. This section explains the rails in §2. It also names what must never come back.

### The four concepts (C1–C4)

Everything in the skeleton is an instance of one of these.

- **C1 — A skeleton is a path.** Skeleton geometry uses the same point representation as glyph
  paths: x, y, on/off-curve type and smooth flag, plus per-point attributes for widths, nudges,
  flags and handle offsets. So the existing point-editing machinery applies unchanged: behavior
  rules, executors, hit-testing and selection. That machinery takes only two parameters, _which_
  path it edits and _where_ it records the change. On-curve points and handles are **one**
  selection kind (`skeletonPoint/contour/point`), never split. → rail R-A.
- **C2 — One write path.** `editSkeleton` (`skeleton-editing.js`) is the only caller of the
  generator on the editing side. It applies `mutate()` to a working copy, regenerates, updates
  provenance, and returns one combined change (customData plus path) with rollback. Undo,
  incremental sync and multi-layer editing then come from the existing change system for free.
  → rail R-C.
- **C3 — Provenance forward, never recovered.** At generation time the generator emits the map
  from a generated point to its skeleton point, side and role. Stable ids make the map survive
  edits. Every question of the form "which skeleton point owns this generated point?" is a map
  lookup. No part of the tree does geometric matching or tolerance-based inverse projection.
  → rail R-D.
- **C4 — Derived handles are gizmos with one contract.** Rib endpoints, editable generated
  handles and Tunni points all share two operations: `position(source)` for render and hit-test,
  and `applyDrag(delta) → source mutation` for editing. Tunni is written once against "a path plus
  an edit sink". The skeleton sink is `editSkeleton`.

### The defects it answers (P1–P7)

These are the donor's structural defects. They are what the design deliberately avoids, and what
a change must not reintroduce.

- **P1 — Derived data with no link to its source.** The donor matched generated contours back to
  skeletons by geometry, through inverse projection and a "recovery" routine. → answered by C3
  plus stable ids.
- **P2 — More selection kinds than concepts.** Five kinds carried about three meanings. Two of
  them existed only to reverse-map path-point indices. → C1 and C3 dissolve the surplus.
- **P3 — No single write path.** Mutations came from drag, nudge, transform and a 7,000-line
  panel. Each one re-implemented regeneration, undo and bookkeeping until they drifted. → C2.
- **P4 — Duplicated geometry.** The donor had `projectRibPoint` twice and `DEFAULT_SKELETON_WIDTH`
  five times. Drift then makes the outline and the edit targets disagree. → rail R-B: one copy of
  every constant and geometry function.
- **P5 — Features bolted outside the behavior model.** X-equalize as a side channel regressed five
  times. Interpolation, expressed _inside_ the rules, never did. → rail R-F: modifiers are
  behavior names and executor variants, not bypass flags.
- **P6 — Monolith files.** The donor pointer was 7,496 lines. The fork keeps the pointer thin, but
  `skeleton-generator.js` at about 4,700 lines is the one place this weight still lives (§7
  residue #3).
- **P7 — Rebuilding the architecture in place.** Four months of refactoring a live donor feature
  produced two successive architectures and a long regression tail, with no new capability. That
  is why we did a clean re-integration instead of a refactor.

### Schema — stable ids are the load-bearing choice

The data lives at `customData["fontra.internal"].skeleton`. The full field list is in
`skeleton-model.js`. Skeleton contours and points carry stable ids that are **never reused**.
Selection, provenance and undo reference those ids instead of array indices, so a structural edit
cannot silently retarget them. This is what makes C3 a simple lookup. `generatedContourIndices`
tracks generated contours, together with a per-point provenance map keyed by skeleton id.

One case sits outside `editSkeleton`. **Path** contours have no ids in Fontra, so inserting or
deleting a non-skeleton contour can still invalidate a generated contour's _index_. Every editor
operation that restructures the contour list must update the mapping in the same change. The
knife and pen bookkeeping in §3 F7 does exactly that. The donor hit this bug twice. Ids plus one
write path are the structural answer, but finding every operation that restructures the list is
real work, not an afterthought.

### History (for archaeology)

The donor is pinned at `fd76d3abe`, the last pre-refactor commit, from 2026-02-20. It is the
behavioral ground truth. We cherry-picked three generator bug-fixes from its later refactor branch
as semantics. We built the feature across WS-6…WS-16, with WS-17 as the parity pass. The donor
checkout still exists at **`_external/skeleton`**, read-only and gitignored, pinned at
`fd76d3abe`. Reach it with `git -C _external/skeleton …`. It is a behavioral reference for parity
questions, and never a source to port plumbing from. The porting rules that governed the
integration are retired. This doc, verified against the code, is the reference now.

---

## Maintaining this doc

Update it when a feature gains or loses a file, when a selection kind changes, or when a rail gets
an exception. It is verified by construction. Every path, count and export above came from
`git diff upstream/main...HEAD` and from greps against the tree on 2026-07-22, not from the older
planning docs. Re-verify the same way instead of trusting this text. Never trust a document over
the code. That is §9's own rule, inherited from the retired roadmap.
