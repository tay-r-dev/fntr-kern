# forkra Feature Architecture Map

**Date:** 2026-07-22, skeleton sections re-verified 2026-07-28 on `fix/skeleton-expand-math`
**Verified against:** `refactor-simple/ws17-parity-bugs`, diffed against `upstream/main` (`f70e2017f`)
**Scope:** every file forkra adds or changes on top of upstream Fontra, mapped to the feature that owns it.

This is the **inventory and ownership map**. It answers "what did we build, where does it live,
and what may I touch?" — so a fresh session or a delegated agent can start work without
re-deriving the architecture.

The skeleton was **re-integrated** from an older fork (the "donor") between
2026-07 and now — the geometry math ported, all plumbing redesigned. That work is
finished; the forward-looking integration roadmap that planned it has been retired
and its durable content folded into **§9 (skeleton design rationale)** of this doc.
So this file is now self-contained: what everything is, where it lives, and why the
skeleton is shaped the way it is.

The per-feature design specs and implementation plans have been retired the same way: the
`specs/` and `plans/` folders that carried the offset construction, the generated-segment
gizmos and the curvature pin are **dissolved**, their durable content folded into this doc and
the feature model. Nothing forward-looking is left in a plan — if it is still true, it is in one
of the three docs below.

| Doc                         | Answers                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SKELETON-FEATURE-MODEL.md` | The conceptual **mental model** of forkra's skeleton: what the feature is, how the generation pipeline works, what to preserve |
| `DEVELOPMENT-LOG.md`        | **What happened, in order**: one entry per feature or fix, with what went wrong on the way                                     |
| **this doc**                | Where everything **is**, who owns it, and (§9) why the skeleton is built this way                                              |

---

## 0. How to use this doc

- **Starting a feature task?** Find it in §3. That section lists every file you should need,
  plus the seams you must go through.
- **About to edit a shared file** (`editor.js`, `scene-model.js`, `edit-tools-pointer.js`,
  `visualization-layer-definitions.js`, `scene-controller.js`, `panel-transformation.js`)?
  Read §4 first — several features share those files and the hunks are not interleaved by accident.
- **Adding a new feature?** Read §2 (the rails) and §5 (infrastructure you extend rather than duplicate).
- **Line counts** are `git diff --numstat` against upstream: `+added / −removed`.
  For new files, added = file length.

**Totals:** 71 files under `src-js` (+28,809 / −131), 1 backend file, 3 docs, 1 test fixture font.
212 non-merge commits.

---

## 1. Feature inventory

| #   | Feature                 | Status                                            | Origin                         | Owned files                                              | Entry point                                 |
| --- | ----------------------- | ------------------------------------------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| F1  | **Coarse grid**         | shipped (WS-1)                                    | donor panel + forkra mechanics | 1 new core, 1 panel                                      | `fontra.coarse.grid` layer, `f`/`g` actions |
| F2  | **Q-measure**           | shipped (WS-2)                                    | donor port                     | 1 new editor module                                      | hold **Q** / **Alt+Q**                      |
| F3  | **SpeedPunk**           | shipped (WS-3)                                    | fork-original + donor panel    | `curvature.js`                                           | `fontra.curvature` layer                    |
| F4  | **Tunni**               | shipped (WS-4)                                    | fork-original, refactored      | 1 core + 1 editor module                                 | `fontra.tunni.*` layers                     |
| F5  | **Point labels**        | shipped (WS-4.5)                                  | fork-original, relocated       | inside `distance-angle.js`                               | `fontra.point.labels` layer                 |
| F6  | **Letterspacer**        | shipped (WS-5)                                    | donor port                     | engine + panel + overlay                                 | Selection-info sidebar                      |
| F7  | **Skeleton**            | shipped WS-6…WS-16; parity pass WS-17 in progress | re-integrated from donor       | 5 core + 9 editor + panel set                            | Skeleton Pen tool, right sidebar            |
| F8  | **Carried fork extras** | shipped, pre-dating the program                   | fork-original                  | `corner-overlap.js`, quad handles, equalize, pen-connect | scattered — see §3.8                        |

Feature sizes, owned code only (shared-file hunks excluded):

```
Skeleton      ████████████████████████████████████████  ~15,700 lines
Letterspacer  █████                                      ~1,900
Tunni         █████                                      ~1,850
Measure+labels████                                       ~2,050  (F2 + F5 share distance-angle.js)
SpeedPunk     █▌                                           ~460
Corner overlap█                                            ~350
Coarse grid   ▏                                             ~66
```

---

## 2. The rails (constraints every feature obeys)

These operationalize the skeleton design model (§9); a few predate the skeleton, from the
WS-1…5 program. They are the reason the file layout looks the way it does — violating one is
how you get a regression that tests can't catch.

**R-A — Layer placement is fixed.**
Pure geometry/math → `fontra-core/src/` (mocha-tested). Hit-testing → `scene-model.js` as
`*AtPoint` methods. Interaction → a dedicated `*-interactions.js` or `skeleton-*.js` module.
Rendering → a `visualization-layer-*.js` file or a render-only draw in
`visualization-layer-definitions.js`. `edit-tools-pointer.js` stays a **thin dispatcher**.

**R-B — One copy of every constant and geometry function.**
If a symbol exists anywhere in forkra, import it. This rail exists because the donor had
`projectRibPoint` twice and `DEFAULT_SKELETON_WIDTH` five times.

**R-C — Skeleton: one write path.** Every skeleton mutation goes through `editSkeleton`
(`views-editor/src/skeleton-editing.js:94`). No second call site of the generator on the
editing side. No skeleton customData written outside it.

**R-D — Skeleton: provenance forward, never recovered.** The generator emits the
skeleton-point → generated-point mapping. No geometric matching, no tolerance-based inverse
projection anywhere.

**R-E — No kind-branching in shared emit code.** `makeChangeForDelta` and below must not
contain `if (skeleton…)`. Kind decisions happen at construction time, via **target entries**.

**R-F — Cross-cutting modifiers are behavior names**, not bypass flags — see
`skeleton-model.js` (the semantics) and `skeleton-editing.js` (event/keys → behavior name).
There is no `skeleton-modifiers.js`: an earlier draft of this doc claimed one in each of
core and editor, and neither ever existed in the tree.

**R-G — Test split.** Only `fontra-core` has a harness (mocha + chai, `npm test`).
`views-editor` has none: those changes carry a manual test matrix in their plan.
Every commit: `node --check` on touched editor files, `npx prettier --write`, `npm run bundle` green.

---

## 3. Per-feature file maps

### F1 — Coarse grid

Snap-to-grid with presets and a panel. Mechanics were already in forkra; WS-1 added the UI.

| File                                                  | +/−      | Role                                             |
| ----------------------------------------------------- | -------- | ------------------------------------------------ |
| `fontra-core/src/coarse-grid-presets.js`              | +66      | **NEW** — preset table and resolution math       |
| `views-editor/src/panel-designspace-navigation.js`    | (shared) | Coarse-grid accordion                            |
| `views-editor/src/scene-controller.js`                | (shared) | `coarseGridSpacing` setting, `f`/`g` actions     |
| `views-editor/src/edit-behavior.js`                   | (shared) | the actual snapping during edits                 |
| `views-editor/src/visualization-layer-definitions.js` | (shared) | `fontra.coarse.grid` layer                       |
| `fontra-core/src/application-settings.js`             | +9       | app-level (localStorage) keys — **not** per-font |
| `fontra-core/tests/test-coarse-grid-presets.js`       | +80      | tests                                            |

Settings live in `applicationSettingsController` by decision D9: view preferences, never
written to project files.

### F2 — Q-measure

Hold **Q** for realtime measurement; **Alt+Q** for direct mode.

| File                                                  | +/−                   | Role                                                                                         |
| ----------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `views-editor/src/measure-interactions.js`            | +503                  | **NEW** — key state, hover detection, dispatch                                               |
| `fontra-core/src/distance-angle.js`                   | (shared, +1545 total) | `calculateHandleMeasure`, `calculateProjectedDistanceComponents`, `drawMeasureOverlay`       |
| `views-editor/src/scene-model.js`                     | (shared)              | `setMeasureActive`, `setMeasureShowDirect`, `setMeasureHoverTarget`, `getMeasureHoverTarget` |
| `views-editor/src/editor.js`                          | (shared)              | `action.realtime.measure`, `…measure-direct`; topic `realtime-hotkeys`                       |
| `views-editor/src/visualization-layer-definitions.js` | (shared)              | `fontra.measure.overlay`, registration-only                                                  |
| `fontra-core/tests/test-distance-angle.js`            | +84                   | tests                                                                                        |

Skeleton coverage: rib width, centerline segments, and skeleton handles all measure (4.12,
fixed 2026-07-22 — via `scene-model.js` `skeletonSegmentAtPoint` / `skeletonHandleAtPoint`).
Still owed from the same area: the z-order/hit-radius hygiene and drag-marker affordance on
branches 5.1/5.2.

### F3 — SpeedPunk

Curvature combs with app-level parameters (peak height, sharpness, opacity).

| File                                                  | +/−      | Role                                                |
| ----------------------------------------------------- | -------- | --------------------------------------------------- |
| `fontra-core/src/curvature.js`                        | +460     | **NEW** — sampling math + `computeSpeedPunkSamples` |
| `views-editor/src/visualization-layer-definitions.js` | (shared) | `fontra.curvature`, render-only                     |
| `views-editor/src/panel-designspace-navigation.js`    | (shared) | SpeedPunk accordion                                 |
| `fontra-core/src/application-settings.js`             | +9       | shared with F1                                      |
| `fontra-core/tests/test-curvature-sampling.js`        | +112     | tests                                               |

Peak height is UPM-relative — that normalization is what replaced the original hardcoded
`* -180000` magic constants.

### F4 — Tunni

The keystone refactor: 1,346-line monolith → pure math + interaction + render-only draws.

| File                                                  | +/−      | Role                                                          |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------- |
| `fontra-core/src/tunni-calculations.js`               | +668     | **NEW** — pure math only. Canonical `calculateSegmentTension` |
| `views-editor/src/tunni-interactions.js`              | +1621    | **NEW** — hit-tests, drag handlers, equalize trigger          |
| `views-editor/src/edit-tools-pointer.js`              | (shared) | thin dispatch hooks only                                      |
| `views-editor/src/visualization-layer-definitions.js` | (shared) | `fontra.tunni.handle`, `fontra.tunni.point`                   |
| `views-editor/src/panel-transformation.js`            | (shared) | settings keys                                                 |
| `fontra-core/tests/test-tunni-calculations.js`        | +82      | tests                                                         |

**Naming is settled and load-bearing** (decisions D2/D3/D4 — hard rename, no aliases):

| Geometry                                              | Canonical name                | Layer id              |
| ----------------------------------------------------- | ----------------------------- | --------------------- |
| Intersection of tangent rays = the _real_ Tunni point | `calculateTunniPoint`         | `fontra.tunni.point`  |
| Midpoint between the two control handles              | `calculateControlHandlePoint` | `fontra.tunni.handle` |

`calculateSegmentTension` is the **single** tension source (D5). `distance-angle.js` imports it;
its old `calculateTension` and duplicate tunni-point geometry are deleted.

### F5 — Point labels

Per-segment distance / tension / angle labels. Formerly "Tunni Labels" (D8).

| File                                                  | +/−              | Role                                         |
| ----------------------------------------------------- | ---------------- | -------------------------------------------- |
| `fontra-core/src/distance-angle.js`                   | (shared with F2) | `drawTunniLabels`, consuming central tension |
| `views-editor/src/visualization-layer-definitions.js` | (shared)         | `fontra.point.labels`, registration-only     |
| `views-editor/src/panel-transformation.js`            | (shared)         | label toggles                                |

Skeleton has its **own** label layer (`fontra.skeleton.point-labels`) — separated deliberately
by registry item 4.1. Do not merge them.

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

Persists through the `fontra.internal` customData section `letterspacer` at three entity levels:
`area`/`depth`/`overshoot` per source, `enabled` per font, `referenceGlyphName` per glyph.

**The one skeleton coupling that was deliberately kept out at port time is now back in scope:**
sidebearing changes should move skeleton data with them (the "letterspacer ↔ skeleton coupling").
Verify before assuming it is wired — see §7 residue #2.

### F7 — Skeleton

The largest feature by an order of magnitude: ~15,700 lines of owned code across 14 files.
Stroke-based design — the designer draws centerlines with per-point widths, and the filled
outline contours are generated live.

**Core (pure, mocha-tested):**

| File                                          | +/−   | Role                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/skeleton-model.js`           | +3393 | Schema, stable-id allocation, accessors/mutators, rib projection, normals, D/S/X/Z semantics (`applyFixedRibDelta`, the equalize family), generated-gizmo geometry. **The single home for skeleton geometry constants.**                                                                |
| `fontra-core/src/skeleton-generator.js`       | +4481 | Centerline → outline. Segments, offset curves, caps (butt/round/square/**drop**), corner rounding, single-sided, handle offsets, detached handles. Emits forward provenance (R-D).                                                                                                      |
| `fontra-core/src/skeleton-source-defaults.js` | +241  | Per-source defaults, resolved by glyph case                                                                                                                                                                                                                                             |
| `fontra-core/src/skeleton-tunni.js`           | +234  | Tunni math on skeleton segments                                                                                                                                                                                                                                                         |
| `fontra-core/src/offset-cubic.js`             | +508  | The closed-form offset construction for one cubic side, as five stages on a **feasible box** in tension space: seed (`λ = 1 + d·κ`), fixed correction passes, bounded equalization, attached adjustment, pin. Pure and **stateless** — same inputs, byte-identical output, every frame. |

**Editor (no test harness — manual matrices):**

| File                                               | +/−   | Role                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `views-editor/src/skeleton-editing.js`             | +1400 | **`editSkeleton` — the one write path (R-C).** Selection keys, target entries, contour-index bookkeeping, selection bounds; rib keys/addresses and their width/nudge executors; editable generated points and handles, provenance resolution, detach |
| `views-editor/src/edit-tools-skeleton.js`          | +855  | Skeleton Pen drawing tool                                                                                                                                                                                                                            |
| `views-editor/src/visualization-layer-skeleton.js` | +919  | 13 canvas layers                                                                                                                                                                                                                                     |
| `views-editor/src/panel-skeleton-parameters.js`    | +1181 | Numeric editing panel (right sidebar)                                                                                                                                                                                                                |
| `views-editor/src/skeleton-panel-edits.js`         | +741  | Panel → `editSkeleton` write helpers, streaming edits                                                                                                                                                                                                |
| `views-editor/src/skeleton-panel-model.js`         | +460  | Panel read model: selection summaries, mixed/uniform state                                                                                                                                                                                           |
| `views-editor/src/panel-skeleton-defaults.js`      | +483  | Per-source defaults panel                                                                                                                                                                                                                            |

> There is no `skeleton-ribs.js` and no `skeleton-generated.js`. An earlier draft of this doc
> listed both as separate editor modules with line counts; neither has ever existed in the tree,
> and their described contents live in `skeleton-editing.js`. Same class of error as the
> `skeleton-modifiers.js` claim corrected in R-F — **grep before trusting a filename here.**

**Selection kinds** — compound keys, all id-based (never path indices):

```
skeletonPoint/<contourId>/<pointId>                        on-curve AND handles (C1)
skeletonRib/<contourId>/<pointId>/<side>                   side ∈ left|right
editableGeneratedPoint/<contourId>/<pointId>/<side>
editableGeneratedHandle/<contourId>/<pointId>/<side>/<role>  role ∈ in|out
```

`fontra-core/src/utils.ts` was changed (+14/−6) precisely so `parseSelection` keeps the raw
remainder for these compound kinds instead of `parseInt`-ing them.

**Visualization layers (13):**
`width-shading`, `ribs`, `rib-points`, `centerline`, `handles`, `nodes`, `selected-nodes`,
`tunni`, `generated-tunni`, `generated-curvature-labels`, `insert-handles-preview`,
`editable-markers`, `point-labels` — all under `fontra.skeleton.*` in
`visualization-layer-skeleton.js`. The last two of the generated pair are the
outline's own gizmos and their readout, deliberately separate from `tunni`, which
controls the skeleton.

**Hit-testing** — all in `scene-model.js`, per R-A:
`skeletonPointAtPoint`, `skeletonRibAtPoint`, `skeletonTunniAtPoint`, `editableGeneratedAtPoint`,
`skeletonRibSelectionAtPoint`, `skeletonSegmentSelectionAtPoint`, plus `isGeneratedPathContour`.
The generated-segment gizmos are hit-tested by `generatedTunniHitTest` in `skeleton-model.js`,
because their placement math is shared with the drawing layer and must have exactly one copy
(R-B); `scene-model.js` also owns the curvature drag's readout.

**The gizmo mode's single source of truth is the layer switch** `fontra.skeleton.generated-tunni`.
The panel checkbox and the View menu both read and write that one setting, so they cannot drift,
and `editableGeneratedAtPoint` returns null while it is on — the two modes compete for the same
clicks, since the gizmos sit on and around the very handles direct manipulation targets.

**Tests:** `test-skeleton-generator.js` (1075), `test-skeleton-model.js` (1004),
`test-skeleton-tunni.js` (879), `test-skeleton-modifiers.js` (685), `test-skeleton-ribs.js` (641),
`test-offset-cubic.js` (724), `test-skeleton-source-defaults.js` (125),
`test-skeleton-interpolation.js` (99).
Golden-master fixtures: `tests/data/skeleton-generator/fixtures.json` (2183), regenerated by
`tests/scripts/make-skeleton-generator-fixtures.js` — which records **this** generator's own
output, not any pre-port reference.

**Other tools had to learn about generated contours** — these are small but essential:

| File                  | +/−     | What it learned                                                                                                       |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `edit-tools-knife.js` | +54/−1  | Never slice generated contours; carry identity through slicing via temporary point attributes, then re-derive indices |
| `edit-tools-pen.js`   | +125/−2 | Never insert into generated contours; record index shifts via `recordSkeletonContourIndexShift`                       |
| `edit-tools-shape.js` | +3      | Comment only — `appendPath` appends after the generated block, so no bookkeeping needed                               |

That third row is the pattern to copy: when a tool restructures the contour list, it must
either update the generated-contour mapping in the same change, or prove it doesn't need to.

### F8 — Carried fork extras

Features that pre-date the WS program and were kept through the refactor. They have no
workstream and thin documentation — flagging them so they aren't mistaken for upstream code.

| Feature                  | Files                                                                                                                          | Notes                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Corner overlap**       | `fontra-core/src/corner-overlap.js` (+350), consumed via `path-functions.js:addOverlapToPath`, action in `scene-controller.js` | Pre-program feature; keeps defensive path validation in `doAddOverlap`       |
| **Quad handles**         | `path-functions.js:insertHandles` (type/shiftKey params), `edit-tools-pen.js`                                                  | Shift modifier picks 1 vs 2 handles for quad curves                          |
| **Equalize**             | `edit-behavior.js`, `tunni-interactions.js`                                                                                    | Alt-drag. Explicitly frozen during WS-4 — regression-watch it                |
| **Pen connect**          | `edit-tools-pen.js:_getPathConnectTargetPoint`                                                                                 | Connect to an open contour's endpoint                                        |
| **Distance / Manhattan** | `distance-angle.js`, two layers                                                                                                | Frozen — superseded by Q-measure, kept because `distance-angle.js` is shared |

---

## 4. Shared-file reverse index

Twelve files carry hunks from more than one feature. **Read this before editing them.**

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

Access **only** through `fontra-core/src/fontra-internal-data.js`
(`getFontraInternalSection` / `setFontraInternalSection`), tested in `test-fontra-internal-data.js`.
customData is freeform and round-tripped by every Fontra backend, so this lands permanently in
users' project files (`.fontra` / `.designspace` / UFO lib).

### The one backend change

`src/fontra/core/classes.py` — **a single line**:

```python
class StaticGlyph:
    customData: CustomData = field(default_factory=dict)
```

Skeleton data is per-layer, and `StaticGlyph` had no `customData` upstream. Mirrored in
`src-js/fontra-core/src/classes.json` (+4).

> ⚠️ `classes.json` is **generated**. Regenerating it from an ambient Python environment
> silently reverts this. See the memory note on the venv layout — the venv imports this repo's
> `src`; ambient `python` may import a stale clone.

### App-level settings

`fontra-core/src/application-settings.js` (+9) — SpeedPunk and coarse-grid view preferences via
`applicationSettingsController` (localStorage). Deliberately **not** per-font (D9).

### Assets

`assets/images/skeleton-pen.svg`, `assets/tabler-icons/bone.svg` (skeleton),
`assets/tabler-icons/spacing-horizontal.svg` (letterspacer).

### Test fixture font

`test-py/data/fonts/SkeletonRendering.fontra/` — a glyph with skeleton data, for rendering checks.

---

## 6. Test coverage map

`cd src-js/fontra-core && npm test` — currently **1559 tests**.

| Feature                             | Automated                                                                                   | Manual only                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Coarse grid                         | presets math                                                                                | panel, snapping feel                                        |
| Q-measure                           | measure math                                                                                | overlay, hover, key handling                                |
| SpeedPunk                           | sampling math                                                                               | comb rendering, sliders                                     |
| Tunni                               | all math + tension                                                                          | drag, equalize, layers                                      |
| Letterspacer                        | engine + persistence round-trip                                                             | panel, apply, overlay                                       |
| Skeleton                            | model, generator (+ golden masters), modifiers, ribs, tunni, source defaults, interpolation | **all interaction** — drag, marquee, transform, tool, panel |
| Corner overlap / quad / pen-connect | none                                                                                        | all                                                         |

The asymmetry is structural, not an oversight: `views-editor` has no harness by forkra
convention. That is why every editor-side plan carries an explicit manual test matrix, and why
"I ran the bundle" is not evidence that an interaction works.

---

## 7. Known gaps and residue

**Bug snapshot** (the standalone parity-bugs registry is no longer kept; this is what was open
when the doc was last verified, 2026-07-22 — re-check against the code before relying on it):

| Item               | Summary                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| 6.10               | Detached handles "shiver" when adjusting skeleton handles (investigated, unresolved) |
| 4.4 / 5.1          | Deprecated 2026-07-22 — not reproduced on forkra; rationale kept in the registry     |
| 4.9–4.13, 5.2, 5.3 | Fixed 2026-07-21/22 — **manual test matrices still owed**                            |

**Structural debt, not yet filed as bugs:**

1. **Rib and editable-generated entries do not implement `makeChangeForTransformation`** — they
   return `null` (verified still true 2026-07-28). A rib-only marquee selection draws a transform
   box that does nothing. Note the skeleton **point** entry does implement it, and it is where the
   mirror side-swap now hooks in, so the shape of the fix is established.
2. **Letterspacer ↔ skeleton coupling** — verify whether sidebearing changes move skeleton
   data before assuming it works. (This is the coupling the sidebearing-variables work must
   route through — it is not yet in the base margin-set path.)
3. **`skeleton-generator.js` is 4,481 lines.** Justified by the port, but it is the single
   largest file in the fork — the one place defect **P6** (§9, monoliths) still bites.

---

## 8. Delegation recipes

Minimal reading sets for the most likely next tasks. Each assumes §2 (rails) has been read.

**"Add a skeleton parameter to the panel"**
`skeleton-model.js` (accessor) → `skeleton-panel-model.js` (summarize across selection) →
`skeleton-panel-edits.js` (write via `editSkeleton`) → `panel-skeleton-parameters.js` (widget) →
`lang/en.js`. Never call the generator or write customData directly (R-C).

**"Make feature X skeleton-aware"** (the Q-measure fix, 4.12, is the worked example)
`scene-model.js` for the hit-test (reuse the private skeleton iterators — `iterSkeletonCurveSegments`
etc. — don't duplicate them) → `skeleton-model.js` for geometry (rib positions, normals — do
**not** recompute them) → the feature's own interaction module, which just consumes and tags.
Provenance lookups go through `skeleton-generated.js`, never geometry matching (R-D).

**"Fix a skeleton editing behavior"**
`skeleton-editing.js` (target entries, and the key → behavior-name mapping) → the modifier
semantics in `skeleton-model.js` (`applyFixedRibDelta`, the equalize family) → the relevant
executor in `skeleton-ribs.js` / `skeleton-generated.js`. If the fix wants a branch inside
`makeChangeForDelta`, it is the wrong fix (R-E).

**"Change generated outline geometry"**
`skeleton-generator.js` + `test-skeleton-generator.js`, and `offset-cubic.js` +
`test-offset-cubic.js` for anything touching cubic handle lengths. TDD is available and expected
here. Four hard constraints, all in the feature model: generated **point-count stability** (or
cross-master interpolation breaks), the **continuity contract** on handle lengths (fixed trip
count, fixed seed, no convergence test, no threshold search), **the feasible box** (every stage of
the handle-length construction lands inside `[1/reach, 1]²` in tension space — a new stage that
clamps only on the way out reintroduces the jitter), and **a pinned curvature is permanent**.
Read the feature model's §8 first — it lists what has already been tried here and rejected on
measurement, including two ideas that were re-proposed and reverted twice, and three guards that
were deleted because the box subsumes them.

**Test this class of change with a sweep, not an assertion.** Hold the geometry fixed, walk one
input through its range in fine steps, and measure the worst single-step movement against the
driver's own step. A per-configuration assertion has missed every fault in this module so far.
Start the sweep away from degenerate configurations — a sweep that begins at zero-length handles
reports its own seed as a 700-unit jump.

**"Add a visualization"**
New draw in the feature's `visualization-layer-*.js`; register in
`visualization-layer-definitions.js` with `draw: <importedFn>` only.

---

## 9. Skeleton design rationale

The durable "why" behind the skeleton, folded in from the retired integration roadmap and
reframed as it now stands. The skeleton was **re-integrated, not merged**: the donor's proven
geometry math was ported; every piece of plumbing was redesigned around four concepts. This
section explains the rails in §2 and — just as important — names what must never creep back.

### The four concepts (C1–C4)

Everything in the skeleton is an instance of one of these.

- **C1 — A skeleton is a path.** Skeleton geometry uses the same point representation as glyph
  paths (x, y, on/off-curve type, smooth flag) plus per-point attributes (widths, nudges, flags,
  handle offsets). So the existing point-editing machinery — behavior rules, executors,
  hit-testing, selection — applies verbatim, parameterized only by _which_ path is edited and
  _where_ the change is recorded. On-curve points and handles are **one** selection kind
  (`skeletonPoint/contour/point`), never split. → rail R-A.
- **C2 — One write path.** `editSkeleton` (`skeleton-editing.js`) is the only caller of the
  generator on the editing side: apply `mutate()` to a working copy → regenerate → update
  provenance → return one combined change (customData + path) with rollback. Undo, incremental
  sync and multi-layer editing then come from the existing change system for free. → rail R-C.
- **C3 — Provenance forward, never recovered.** The generator emits the mapping (generated point
  → skeleton point / side / role) at generation time; stable ids make it survive edits. Every
  "which skeleton point owns this generated point?" is a map lookup. No geometric matching, no
  tolerance-based inverse projection anywhere. → rail R-D.
- **C4 — Derived handles are gizmos with one contract.** Rib endpoints, editable generated
  handles and Tunni points all share: `position(source)` for render/hit-test, `applyDrag(delta)
→ source mutation` for editing. Tunni is written once against "a path + an edit sink"; the
  skeleton sink is `editSkeleton`.

### The defects it answers (P1–P7)

The donor's structural defects — what the design deliberately avoids, and what a change must not
reintroduce:

- **P1 — Derived data with no link to its source.** Donor matched generated contours back to
  skeletons by geometry (inverse projection, a "recovery" routine). → answered by C3 + stable ids.
- **P2 — Selection kinds multiplied beyond the concepts.** Five kinds for ~three semantics, two
  existing only to reverse-map path-point indices. → C1/C3 dissolve the surplus.
- **P3 — No single write path.** Mutations from drag, nudge, transform and a ~7,000-line panel,
  each re-implementing regeneration/undo/bookkeeping until they drift. → C2.
- **P4 — Duplicated geometry.** Donor had `projectRibPoint` twice, `DEFAULT_SKELETON_WIDTH` five
  times; drift makes the outline and the edit targets disagree. → rail R-B (one copy of every
  constant and geometry fn).
- **P5 — Features bolted outside the behavior model.** X-equalize as a side channel regressed
  five times; interpolation, expressed _inside_ the rules, never did. → rail R-F (modifiers are
  behavior names + executor variants, not bypass flags).
- **P6 — Monolith files.** Donor pointer was 7,496 lines. The fork keeps the pointer thin, but
  `skeleton-generator.js` (~4,500 lines) is the one place this weight still lives (§7 residue #3).
- **P7 — In-place rearchitecting.** Four months of refactoring a live donor feature produced two
  successive architectures and a long regression tail with no new capability — the reason this
  was a clean re-integration, not a refactor.

### Schema — stable ids are the load-bearing choice

`customData["fontra.internal"].skeleton`; the full field list lives in `skeleton-model.js`.
Skeleton contours and points carry stable, **never-reused ids**. Selection, provenance and undo
reference those ids, not array indices, so structural edits can't silently retarget them — this
is what makes C3 cheap. Generated contours are tracked by `generatedContourIndices` plus a
per-point provenance map keyed by skeleton id.

The one seam outside `editSkeleton`: **path** contours have no id facility in Fontra, so a
generated contour's _index_ can still be invalidated when a non-skeleton contour is inserted or
deleted. Every editor operation that restructures the contour list must update the mapping in the
same change — the knife/pen bookkeeping in §3 F7 is that hook. The donor hit this exact bug
twice; ids + one write path are the structural answer, but the enumeration is real work, not an
afterthought.

### History (for archaeology)

Donor pinned at `fd76d3abe` (last pre-refactor commit, 2026-02-20) as the behavioral ground
truth; three generator bug-fixes from its later refactor branch were cherry-picked as semantics.
Built across WS-6…WS-16, with WS-17 the parity pass. The donor checkout still exists, read-only
and gitignored, at **`_external/skeleton`** (pinned at `fd76d3abe`) — a behavioral reference for
parity questions, reachable via `git -C _external/skeleton …`; never a source to port plumbing
from. The porting rules that governed the integration are retired — this doc, verified against
the code, is the reference now.

---

## Maintaining this doc

Update it when a feature gains or loses a file, when a selection kind changes, or when a rail
gets an exception. It is verified by construction — every path, count and export above came from
`git diff upstream/main...HEAD` and greps against the tree on 2026-07-22, not from the older
planning docs. Re-verify the same way rather than trusting this text: never trust a document
over the code (§9's own rule, inherited from the retired roadmap).
