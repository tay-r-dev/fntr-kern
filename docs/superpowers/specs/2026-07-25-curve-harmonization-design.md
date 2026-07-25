# Curve Harmonization (F9) — Design

**Date:** 2026-07-25
**Status:** implemented — `2026-07-25-curve-harmonization-implementation.md` records
what landed, the decisions taken while building it, and the two places this
document was corrected afterwards (§1 consequence 2, §4 clamping)
**Donors:** `_external/supertool` (`SuperTool+Harmonize.m`), `_external/green-harmony`
**Companion docs:** `FEATURE-ARCHITECTURE-MAP.md` (§2 rails, §3 file maps), `SKELETON-FEATURE-MODEL.md`

G2-harmonize smooth on-curve joints on ordinary glyph contours, driven from a
section in the glyph transformation panel.

---

## 1. The finding that shaped this design

**SuperTool's Harmonize and Green Harmony are the same algorithm.** Both credit
[Simon Cozens' gist](https://gist.github.com/simoncozens/3c5d304ae2c14894393c6284df91be5b).
Verified term by term:

| | Green Harmony (`plugin.py:32`) | SuperTool (`SuperTool+Harmonize.m:44`) |
| --- | --- | --- |
| ratio | `r0 = \|NN,N\|/\|N,D\|`, `r1 = \|D,P\|/\|P,PP\|` | `p0 = \|PP,P\|/\|P,D\|`, `p1 = \|D,N\|/\|N,NN\|` |
| blend | `t = √(r0·r1)/(√(r0·r1)+1)` | `t = √(p0·p1)/(√(p0·p1)+1)` |
| target | `lerp(N, P, t)` | `lerp(P, N, t)` |

SuperTool's `r` is the reciprocal of Green Harmony's, so `t_ST = 1 − t_GH`, and
lerping the other direction lands on the **identical point**. `D` is the
intersection of the two outer handle lines — line(`PP`,`P`) with line(`N`,`NN`).

The real difference is which points absorb the correction:

- **Green Harmony** moves the on-curve **node** to the target; handles stay put.
- **SuperTool** keeps the node fixed and translates **both handles** by
  `fixup = node − target`. It also brackets the operation with Tunni `balance`.

Because the node is smooth, `P`, `node`, `N` are collinear and the target lies on
that same line — so **`fixup` is parallel to the tangent**. Green Harmony slides
the node along the tangent; SuperTool slides the handles along it by the same
distance the other way, one handle growing as the other shrinks. G1 is preserved
either way. One correction, split two ways.

Three consequences:

1. There is no second algorithm to escalate to. A two-stage
   "SuperTool then Green Harmony" pipeline would run the same math twice.
2. **Node-move is exact in one pass** — the target does not depend on the node
   position. Handle-move was expected to need iteration, since sliding the
   handles moves `D` and therefore the target. **Implementation proved otherwise:
   it is exact in one pass too, at every bias** — see the implementation doc §2
   for the proof. Iteration is still needed, but for coupled joints, not for the
   bias.
3. The natural failure limit is **geometric, not a percentage**. When `|fixup|`
   approaches the shrinking handle's length, that handle shrinks toward nothing.
   A fixed "delta > 40% of handle length" threshold measures the wrong thing.

**Not ported:** SuperTool's `balance` (Tunni tension equalization). forkra
already has it — `balanceSegment` and `calculateEqualizedControlPoints` in
`tunni-calculations.js` — and it is a separate shape change forkra already
exposes as its own equalize (F4/F8). Bundling it would make harmonize alter
shapes more than asked and make results depend on two algorithms at once.
**Harmonize does one thing.** (R-B.)

**Also not ported:** `_external/harmonic-move`. It is a different feature —
curvature-*preserving* dragging, holding `k` constant at a joint while a handle
moves (`plugin.py:32-45`). Out of scope; no shared code.

---

## 2. Decisions

Numbered `H*` to avoid colliding with the architecture map's own `D*` decisions,
which this doc also cites.

| # | Decision | Rationale |
| --- | --- | --- |
| H1 | Default `handleBias = 1.0` — **node never moves** | Preserves extrema, metric-line alignment and start points. Costs iteration. |
| H2 | Bias is **user-exposed** as a slider, 0…1 | Both donor behaviours reachable; named in forkra's own terms, not the donors'. |
| H3 | v1 harmonizes **ordinary contours only** | One write path, one test surface. Skeleton centerlines are a clean follow-up. |
| H4 | Generated contours are **refused** | R-D: derived geometry, regenerated on every edit. Guarded by `isGeneratedPathContour`. A v1 boundary, not a permanent verdict — see §9. |
| H5 | Selection **widens** to touched smooth points | Handles map to their parent on-curve, so marquee-over-a-curve works. Empty selection = whole layer (both donors). |
| H6 | Over-limit points are **clamped and reported `partial`** | Never produces a cusp, never silently does nothing. |
| H7 | Multi-source is **recompute per layer**, gated by a panel flag | Blind delta propagation is geometrically meaningless here. See §5. |
| H8 | No Tunni `balance` wrapper | §1. |
| H9 | Iteration limits in **font units**, not percentages | `|fixup| < 0.01` units or 10 passes. |
| H10 | No visualization layer in v1 | SpeedPunk (F3) already renders curvature discontinuity. Revisit after use. |

---

## 3. File map

| File | +/− | Role |
| --- | --- | --- |
| `fontra-core/src/harmonization.js` | **NEW** ~300 | All math: joint extraction, G2 target, iteration, clamping, reporting. Pure. |
| `fontra-core/tests/test-harmonization.js` | **NEW** | Mocha suite incl. donor-parity reference |
| `views-editor/src/scene-controller.js` | shared | `doHarmonize(options)` + `action.harmonize` registration |
| `views-editor/src/panel-transformation.js` | shared | "Harmonize" section (appended after Point labels — see §7) |
| `fontra-core/src/application-settings.js` | shared | `harmonizeHandleBias`, `harmonizeOtherSources` |
| `fontra-core/assets/lang/en.js` | shared | labels, action name, report strings |

**Rails compliance:** math in `fontra-core` under mocha (R-A, R-G); `intersect`
and `distance` imported from `vector.js`, not rewritten (R-B); no new
hit-testing, no new visualization layer, `edit-tools-pointer.js` untouched;
nothing goes near `makeChangeForDelta` (R-E) because harmonize is a recompute,
not a delta.

Settings persist via `applicationSettingsController` (localStorage) — view and
operation preferences, never written to project files — consistent with the
architecture map's **D9** (coarse grid, SpeedPunk).

---

## 4. Core module

```js
export const HARMONIZE_DEFAULTS = {
  handleBias: 1.0,        // 0 = move node … 1 = move handles
  cuspSafetyMargin: 0.85, // never shrink a handle below 15% of its length
  toleranceUnits: 0.01,
  maxIterations: 10,
};

getJointContext(path, pointIndex)                // → {…stencil} | {reason}
calculateHarmonicTarget(ctx)                     // → {target, fixup} | null
measureG2Discontinuity(ctx)                      // → number (curvature jump)
expandToJoints(path, pointIndices)               // → on-curve point indices
harmonizePath(path, pointIndices, options)       // → {path, report}
```

`measureG2Discontinuity` is public and tested even though nothing renders it in
v1 — it is the definition harmonize is written against, so the tests measure
results with it instead of re-deriving the algorithm, and exposing it makes
H10's reversal a rendering change rather than a math change. Convergence itself
is checked on `|fixup|` in font units, per H9.

### How the bias blends

`fixup` is parallel to the tangent, so the whole joint translates along it; the
bias only decides who absorbs the motion:

```
node    += -(1 - b) * fixup
P, N    +=      b   * fixup
```

The relative displacement between node and handles is always exactly `fixup`,
which is what makes the joint G2 at that instant. One pass is exact at **every**
bias (implementation doc §2). Iteration exists for a different reason: adjacent
smooth joints share handles, so correcting one perturbs its neighbour's stencil.
Sweep the whole candidate set until every `|fixup| < toleranceUnits`, or
`maxIterations` passes.

### Clamping

Only one handle shrinks, and it shrinks by exactly `|fixup|` — the bias splits
*who moves*, not *how far apart they end up*. Let `L` be the shrinking handle's
length **as it was before the first pass**, so repeated passes cannot nibble it
away:

```
resulting length ≥ (1 − cuspSafetyMargin) · L  → apply fully, "harmonized"
otherwise                                      → scale the step back to that
                                                 floor, "partial"
```

### Report

Entries are `{pointIndex, contourIndex, status, reason, iterations}`:

- `status` ∈ `harmonized` | `partial` | `skipped`
- `reason` ∈ `clamped` | `not-converged` (partial) |
  `not-smooth` | `not-curve-joint` | `degenerate` | `already-harmonic` |
  `generated-contour` (skipped)

`degenerate` covers parallel outer handle lines, which `vector.js:intersect`
already signals by returning `undefined`.

`harmonizePath` is **total** — it does not throw for geometric reasons. Parallel
handles, zero-length handles and non-convergence all resolve to report entries.

---

## 5. Write path and data flow

### Entry points

The panel's Apply button is primary. `action.harmonize` is also registered
alongside the add-overlap registration (`scene-controller.js:774`), giving a
context-menu item and a user-assignable shortcut. Both donors ship a shortcut.

### Selection → harmonizable set

`parseSelection(this.selection)` yields point indices. Widening:

1. selected **on-curve** point → itself
2. selected **off-curve** handle → its parent on-curve point
3. deduplicate
4. keep only smooth curve joints (both neighbours off-curve)
5. empty selection → **every point in the layer**

Everything dropped at step 4 lands in the report with a reason, so "I selected it
and nothing happened" is always answerable.

### Generated-contour guard

Computed once from the current layer via
`sceneModel.isGeneratedPathContour(contourIndex)`, applied as an exclusion set to
every target layer. Excluded points are dropped before `harmonizePath` is called
and reported as `skipped / generated-contour`.

This keeps `harmonization.js` **completely skeleton-agnostic** — it never learns
what a skeleton is. Both deferred skeleton items (§9) then remain open: the core
presumes nothing about how they will eventually work.

*Cross-source assumption:* the current layer's excluded set is reused for all
layers. Sound because multi-source editing already requires structurally
compatible layers — if contour structure differed, shared point indices would not
address the same points either, and multi-edit would be broken independently of
this feature.

### Multi-source

forkra already has the apparatus: `editLayersAndRecordChanges` hands back exactly
the layers the source panel has marked editable. This feature owns **no source
selection of its own**. The panel flag only decides whether harmonize recomputes
on those layers or restricts itself to the current edit layer:

```js
await this.editLayersAndRecordChanges((layerGlyphs) => {
  const editLayerName = this.sceneSettings.editLayerName;
  const targets = applyToOtherSources
    ? Object.entries(layerGlyphs)
    : [[editLayerName, layerGlyphs[editLayerName]]];

  for (const [layerName, layerGlyph] of targets) {
    const { path, report } = harmonizePath(layerGlyph.path, pointIndices, options);
    layerGlyph.path = path;
    reports.set(layerName, report);
  }
  return translate("action.harmonize");
});
```

**Recompute, not delta propagation.** Applying one source's `fixup` vector to
another source's points is meaningless — the other source has different handle
positions, a different `D`, and a different target. This is also exactly what
Green Harmony's Opt key does: `plugin.py:100-103` re-runs the full
`harmonize(otherLayer, i, j)` per compatible layer rather than copying a
displacement. And it matches forkra's own convention for computed operations —
`doAddOverlap` recomputes `addOverlapToPath` per layer inside
`editLayersAndRecordChanges`.

> The *pattern* borrowed from `doAddOverlap` is `editLayersAndRecordChanges` plus
> per-layer recompute — a method used ~25 times across the editor. Its body is
> **not** a model: the defensive `typeof path.getPoint !== "function"` validation
> block there is not reproduced.

Default flag state is **on**: marking sources editable is already an explicit
opt-in, so ignoring it would be surprising. Off is the escape hatch for
harmonizing a single master.

Clamping is evaluated per source, so a point can be `harmonized` in one source
and `partial` in another where handles are shorter. The report names the source.

### Change recording

One `editLayersAndRecordChanges` call, one undo step labelled
`translate("action.harmonize")`.

If the harmonizable set is empty, or every point returns `skipped`, **the call is
never made** — no empty undo step, only a report line. A no-op that consumes an
undo slot is worse than nothing.

No `try/catch` swallowing in the action. If something throws there it is a real
bug and should surface.

---

## 6. Panel section

Appended to `panel-transformation.js` using the idiom already in that file —
`universal-row` with `field1: {type: "auxiliaryElement", auxiliaryElement: …}`,
which accepts arbitrary DOM. The Apply button and report line therefore need **no
`ui-form.js` changes**. The slider uses `edit-number-slider`, already extended by
F7 with `displayValue` and `step`.

```
──────────── Harmonize ────────────
 Move          [node ●────────── handles]   1.00
 ☑ Other sources
              [ Harmonize ]
 12 harmonized · 3 partial
```

Naming is forkra's own: the slider ends read **node ↔ handles**, describing what
moves. Donor names belong in the tooltip at most — a designer reading the panel
wants to know the effect, not which plugin the mode came from.

The report line is a plain text node updated after each apply and cleared when
the selection changes. With the flag on and results differing per source it names
them: `Regular: 12 harmonized · Black: 10 harmonized, 2 partial`.

---

## 7. Known issue inherited, not addressed here

`panel-transformation.js:769-818` attaches the Point-labels checkbox listeners by
**positional lookup**:

```js
setTimeout(() => {
  const allCheckboxes = this.infoForm.contentElement
    .querySelectorAll('input[type="checkbox"]');
  if (allCheckboxes.length >= 3) {
    const distanceCheckbox = allCheckboxes[0];   // ← positional
    const tensionCheckbox  = allCheckboxes[1];
    const angleCheckbox    = allCheckboxes[2];
```

Any checkbox added ahead of those three silently rebinds the Distance / Tension /
Angle toggles to the wrong controls. The elements are already held as JS
references at `:680-693`, so the fix is to attach listeners at creation and
delete the `setTimeout` block.

**Deliberately out of scope for F9.** The Point-labels toggles are slated for
deprecation in their current form, so the fix would be thrown away. F9 avoids the
collision for free by appending its section **after** Point labels, leaving
indices 0–2 intact.

*Whoever deprecates or reworks those toggles should remove the positional lookup
at the same time.*

---

## 8. Testing

### Automated — `fontra-core/tests/test-harmonization.js`

Nearly all the risk lives here and all of it is reachable.

- **Donor parity.** The test file carries a direct transcription of Green
  Harmony's `harmonize()` as a reference implementation and asserts our
  `handleBias = 0` output matches it across a fixture set. This converts "I
  believe the port is correct" into evidence, and is cheap — the donor function
  is 20 lines.
- Already-G2 joint → no-op, `already-harmonic`
- `handleBias = 0` converges in exactly one pass
- `handleBias = 1` converges; node position bit-identical before and after
- Intermediate bias converges to the same G2 measure
- Clamp path: short handle → `partial`; shrinking handle never drops below 15%
- Degenerate: parallel outer handles → `skipped / degenerate`
- Non-smooth point, line-curve joint, curve-line joint → `skipped`
- Closed-contour wraparound; open-contour endpoints
- **Point count and contour count unchanged** — the interpolation contract
- **Idempotence**: harmonizing twice is a no-op the second time

### Manual matrix (R-G — `views-editor` has no harness)

| # | Case | Expected |
| --- | --- | --- |
| 1 | Slider at 0, 0.5, 1.0 | 0 moves node only; 1 moves handles only, node pixel-stable |
| 2 | Other sources **on**, 2+ editable sources | every editable source harmonized, each recomputed |
| 3 | Other sources **off**, 2+ editable sources | only the current edit layer changes |
| 4 | Undo after a multi-source apply | all touched layers revert in **one** step |
| 5 | Mixed full/partial across sources | report names each source separately |
| 6 | Marquee over a curve | endpoints harmonize (handles widened to parents) |
| 7 | Empty selection | whole layer harmonizes |
| 8 | Glyph with skeleton-generated contours | generated contours untouched; reported `generated-contour` |
| 9 | Apply with nothing harmonizable | no undo entry created; report line only |
| 10 | Point-labels toggles after F9 lands | Distance/Tension/Angle still bind correctly (§7) |

---

## 9. Deferred

- **Skeleton centerline harmonization** (H3). Centerlines join the harmonization
  pool later. They are paths (C1), so the same math applies; the write path must
  route through `editSkeleton` (R-C). Out of scope for this plan.
- **Harmonization of generated geometry** (H4). Skeleton-generated outline
  contours will eventually be harmonizable too, but **through a different
  interaction model than base points** — direct path editing of generated
  contours is precluded by R-D, so it cannot simply reuse this feature's
  selection-and-apply flow. The form it takes is undecided and deliberately not
  designed here. What matters for F9: the v1 refusal is a scope boundary, and
  `harmonization.js` stays skeleton-agnostic so it presumes nothing about the
  eventual interaction.
- **Discontinuity visualization** (H10). Reconsider once there is real usage data
  on whether SpeedPunk's curvature comb is sufficient feedback.
- **`harmonic-move`** — curvature-preserving drag. Separate feature, separate
  brainstorm, no shared code.
