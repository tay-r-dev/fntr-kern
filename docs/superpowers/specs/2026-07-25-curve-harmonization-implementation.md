# Curve Harmonization (F9) — Implementation Report

**Date:** 2026-07-25
**Branch:** `feature/harmonize`
**Design doc:** `2026-07-25-curve-harmonization-design.md`

What landed, where it differs from the spec, and where to look when something
needs changing.

---

## 1. What landed

| File | Change |
| --- | --- |
| `fontra-core/src/harmonization.js` | **NEW**, ~300 lines. All the math. Pure — no editor imports. |
| `fontra-core/tests/test-harmonization.js` | **NEW**, 35 tests including a donor-parity reference |
| `fontra-core/src/application-settings.js` | `harmonizeHandleBias: 1`, `harmonizeOtherSources: true` |
| `fontra-core/assets/lang/en.js` | `action.harmonize` + 10 `sidebar.selection-transformation.harmonize.*` keys |
| `views-editor/src/scene-controller.js` | `doHarmonize(options)`, action registration, context-menu entry |
| `views-editor/src/panel-transformation.js` | Harmonize section, `doHarmonize()`, report formatting, 2 style rules |

**Verified:** `npm test` → 1430 passing, 0 failing. `npx webpack --mode
development` → clean. `node --check` on every edited file → clean. Prettier
applied to the JS.

**Not verified:** anything in `views-editor` — R-G, no harness there. The manual
matrix in design §8 has not been run; it needs a running editor.

---

## 2. The finding that changed the design

**Harmonization is exact in one pass at every bias.** The spec said handle-move
would need to iterate, because moving the handles moves `D` and therefore the
target. It does move `D` — but not the answer.

Put the tangent line on the x-axis; `P`, `node` and `N` all lie on it. Let `h₁`
and `h₂` be the perpendicular offsets of `PP` and `NN` from that line. `PP` lies
on segment `P→D`, so `h₁ = s·H` where `H` is `D`'s perpendicular offset and
`s = |P−PP|/|P−D|`; likewise `h₂ = q·H`. Then

```
ratio = √(q/s) = √((h₂/H)/(h₁/H)) = √(h₂/h₁)
```

`H` cancels. The ratio depends only on how far the two outer handles sit off the
tangent line — and on nothing about where `P`, `node` and `N` sit *along* it.
Every motion the bias produces is along that line, so `h₁` and `h₂` never change,
so `ratio` and `t` never change. `target = N + t(P−N)` translates exactly with
the handles, and one correction lands on it.

Confirmed numerically: residual after one pass is 1.4e-14 units.

**So what is the iteration loop for?** Coupled joints. Adjacent smooth joints
share handles — joint *B*'s `N` is joint *C*'s `PP`. Harmonizing *B* changes
*C*'s `h₁`, which genuinely moves *C*'s answer. The loop sweeps the whole
candidate set repeatedly until every residual is under tolerance. The two coupled
joints in the test fixture take 4 and 3 passes at the default 0.01-unit
tolerance.

Consequence for the UI: `maxIterations` is a budget of *sweeps*, and it only
binds on multi-joint selections. A single-joint apply cannot report
`not-converged`.

Design doc §1 consequence 2 and §4 have been corrected to say this.

---

## 3. The clamp was specified wrong

Spec §4 said the shrink to bound is `F = b·|fixup|` — bias times correction. It
is `|fixup|`, full stop.

The node and its handles always end up exactly `fixup` apart no matter how the
bias splits the motion; that separation *is* the correction. So at bias 0 the
node slides onto a handle exactly as far as, at bias 1, the handle slides onto
the node. Both are equally capable of collapsing a handle, and clamping only at
bias 1 would have left bias 0 unguarded.

Second correction: the floor is captured from the geometry **before the first
pass** and held across passes. Re-deriving it each pass would let ten sweeps
shrink a handle to `0.15¹⁰` of its length — precisely what the margin exists to
prevent.

One thing the spec made more alarming than it is: `t ∈ (0,1)` strictly, so the
exact target always lands strictly between the two handles. The node cannot cross
a handle and no cusp is ever produced. What the clamp prevents is a handle
collapsing to a sliver — a legal but unusable curve. It is a quality guard, not a
correctness guard.

---

## 3.5 First-round bug: the write path (fixed)

First hands-on test produced four symptoms at once: both bias modes appeared to
move nodes *and* handles, results were usually `partial`, unselected points
seemed to move, multi-source did nothing, and the console showed
`this.coordinates.addItemwise is not a function`.

All of it came from one line. The original `doHarmonize` did

```js
const { path, report } = harmonizePath(layerGlyph.path, ...);
layerGlyph.path = path;   // ← wrong
```

inside `editLayersAndRecordChanges`. Two things break:

1. `layerGlyph` is a **change-recorder Proxy**. `path.copy()` inside
   `harmonizePath` therefore ran against a proxied `VarPackedPath`, hitting the
   fork's `typeof this.coordinates.copy === 'function' ? … : this.coordinates.slice()`
   fallback in `var-path.js` — the branch that exists *because* the proxy does
   not forward `copy()`.
2. Assigning the whole path records `{f: "=", a: ["path", <live VarPackedPath>]}`.
   A class instance in a change payload does not survive the round trip; what
   comes back is a plain object with plain arrays, so the next interpolation
   calls `coordinates.addItemwise` on an `Array` and throws. From there the glyph
   controller cannot build an instance and the canvas shows nonsense — which is
   what "both modes move everything" and "unselected points moved" actually
   were.

Fix: `harmonizePathInPlace(path, …)` writes each correction through
`setPointPosition`, which the recorder explicitly proxies into an `=xy` change
with a matching rollback (`change-recorder.js:69`). `harmonizePath` survives as a
pure wrapper for the tests. Undo granularity improves as a side effect: the
change is now a handful of coordinate edits rather than a whole-path swap.

Two guards added at the same time:

- `maxIterations` 10 → **50**. A ring of coupled joints (an `o`) needs ~8 sweeps;
  10 left no headroom for longer chains, which would surface as
  `partial / not-converged`.
- Clamp floors are captured for **all** candidates before the first sweep. They
  were previously captured lazily on each point's first visit, by which time
  earlier points in the same sweep had already moved its handles.

Regression test: `records a change the editor can round-trip` runs
`harmonizePathInPlace` inside `recordChanges` and asserts the recorded ops are
exactly `["=xy", "=xy"]` at bias 1 (the two handles, nothing else), that
`coordinates` is still a `VarArray`, that replaying the change reproduces the
result, and that the rollback restores the original.

**`doAddOverlap` has the same `layerGlyph.path = newPath` shape and is presumably
broken the same way.** Not touched here.

---

## 4. Decisions taken during implementation

Numbered `I*`. Each row says where to change it.

| # | Decision | Where |
| --- | --- | --- |
| I1 | `getJointContext(path, pointIndex)` takes an **absolute** point index, not `(contourIndex, pointIndex)` as sketched. Selections are absolute; the contour index is derived and returned. | `harmonization.js` `getJointContext` |
| I2 | Rejection returns `{reason}`, not `null`, so `harmonizePath` can report *why* a point was skipped without a second traversal. Discriminate on `ctx.reason`. | same |
| I3 | The stencil requires all four neighbours to be **cubic** off-curves; quadratics report `not-curve-joint`. The construction is defined for cubics — a quad joint has no second control point to intersect. | `isCubicOffCurve` |
| I4 | Contours with fewer than 5 points report `not-curve-joint`, closed or open. On a closed contour the ±2 lookups would otherwise alias onto the node itself. | `getJointContext` |
| I5 | Two `reason` values the spec did not list: `clamped` and `not-converged`, both under `status: "partial"`. A partial result with no reason is not actionable. | `harmonizePath` |
| I6 | `expandToJoints` is **exported and called by the caller**, not folded into `harmonizePath`. The generated-contour guard has to run between expansion and harmonizing, and it belongs in the editor (it needs `sceneModel`), not in a pure core module. | `harmonization.js` / `doHarmonize` |
| I7 | `harmonizePath` reads an **empty** `pointIndices` as "whole path". `doHarmonize` therefore returns early when the generated-contour guard empties the candidate set — otherwise refusing every selected point would silently harmonize the entire glyph. | `doHarmonize`, the `if (!pointIndices.length)` guard |
| I8 | The editor writes **in place** via `harmonizePathInPlace`, never `layerGlyph.path = newPath`. See §3.5 — this was the first-round bug. Nothing is written when nothing is harmonizable, so no empty undo step is possible. | `doHarmonize`, `harmonizePathInPlace` |
| I9 | Candidate expansion and the generated-contour exclusion are computed **once**, from the glyph on screen, and reused for every layer. Sound because multi-source editing already requires structurally compatible layers. | `doHarmonize` |
| I10 | `action.harmonize` gets a glyph-edit context-menu entry, **no** default shortcut (nothing free that both donors use), and **no** enabled-predicate — an empty selection is valid input, meaning the whole layer. | `scene-controller.js` `getContextMenuItems` |
| I11 | Settings live in `applicationSettingsController` and are read there by `doHarmonize` itself, so the action and the panel button behave identically. | `application-settings.js`, `doHarmonize` defaults |
| I12 | The bias slider is a `universal-row`: `auxiliaryElement` span "node" in the label slot, `edit-number-slider` in the middle, `auxiliaryElement` span "handles" after it. Not `type: "text"` for the end labels — `_addText` sets `innerText` on the shared value element and would wipe the slider. | `panel-transformation.js`, harmonize section |
| I13 | "Other sources" is a real `checkbox` field, routed through `onFieldChange`, not a hand-rolled `auxiliaryElement`. Safe **only** because the section is appended after Point labels — §6. | same |
| I14 | The report line is an `auxiliaryElement` span held as `this.harmonizeReportElement` and written imperatively, not a keyed `text` field. A keyed field would need a `Form.setValue` round trip plus a non-empty placeholder just to register its setter. | `setHarmonizeReport` |
| I15 | The report is cleared on any selection or glyph change. A count describing a selection you have since left is misinformation. | the `sceneSettingsController` key listener in the constructor |

---

## 5. Naming

Per the standing rule that user-facing names are forkra's own:

- Action: **"Harmonize Curves"** (`action.harmonize`)
- Panel section: **"Harmonize"**
- Slider: ends read **node** and **handles**; the tooltip on the "node" end says
  *"Which side absorbs the correction: the on-curve point, or its two handles"*
- Flag: **"Other sources"**
- Report: `12 harmonized · 3 partial`, or per source when several were touched:
  `Regular: 12 harmonized · Black: 10 harmonized · 2 partial`

No donor product name appears in any user-facing string. They appear in source
comments and in these docs, which is where they belong.

---

## 6. The Point-labels landmine, again

`panel-transformation.js` binds the Distance / Tension / Angle checkbox listeners
by `querySelectorAll('input[type="checkbox"]')[0..2]` inside a `setTimeout`. The
Harmonize section adds a fourth checkbox — and is appended **after** those three,
so indices 0–2 still resolve correctly.

This ordering is load-bearing. A comment saying so sits directly above the
Harmonize section. **If anyone reorders these sections, the toggles silently
rebind to the wrong controls.** The real fix (attach listeners at creation,
delete the `setTimeout`) stays out of scope — those toggles are slated for
deprecation. Design doc §7 has the detail.

---

## 7. Test coverage

`fontra-core/tests/test-harmonization.js`, 35 tests. Notables:

- **Donor parity** — Green Harmony's `harmonize()` transcribed verbatim as a
  reference implementation, and `calculateHarmonicTarget` matched against it on
  three fixtures to 1e-9. Evidence the port is right, not a claim that it is.
- One-pass exactness at bias 0, 0.25, 0.5 and 1.
- Coupled joints iterate and converge; budget exhaustion reports
  `not-converged`.
- Clamping at bias 1 **and** at bias 0, with the surviving handle landing exactly
  on the 15% floor.
- Degenerate (parallel outer handles), zero-length outer handle, non-smooth
  point, line-curve joint, quadratic joint, open-contour endpoints,
  closed-contour wraparound.
- Point count, contour count and point types unchanged — the interpolation
  contract.
- Idempotence; input path not mutated.

**Fixture note:** every fixture is a 7-point closed contour with the joint at
absolute index 3, so `NODE = 3` throughout. A new fixture that departs from that
shape stops working with the shared helpers.

Not covered by automation, and needing the manual matrix in design §8: the panel
wiring, multi-source behaviour, undo granularity, and the generated-contour
refusal (which needs a glyph with a skeleton).

---

## 8. Where to look

| To change… | Go to |
| --- | --- |
| the algorithm itself | `harmonization.js` `calculateHarmonicTarget` |
| which points get written | `applyFixup` (bias 1 = the two flanking off-curves, matching `SuperTool+Harmonize.m:52-54`) |
| how changes reach the document | `harmonizePathInPlace` — `setPointPosition` only, never a path assignment (§3.5) |
| what counts as a harmonizable joint | `getJointContext` (I3, I4) |
| the 15% safety floor | `HARMONIZE_DEFAULTS.cuspSafetyMargin` |
| convergence tolerance / sweep budget | `HARMONIZE_DEFAULTS.toleranceUnits`, `.maxIterations` |
| which points a selection implies | `expandToJoints` |
| what gets refused, and why | `doHarmonize`, the `refused` loop |
| multi-source semantics | `doHarmonize`, the `targets` array |
| when an undo step is created | `doHarmonize`, the `report.some(...)` guard (I8) |
| panel layout | `panel-transformation.js`, "Harmonize section" comment |
| report wording | `summarizeHarmonizeReport` / `formatHarmonizeReport`, plus `en.js` |
| defaults on a fresh install | `application-settings.js` |

---

## 9. Still open

- **Manual test matrix** (design §8) — the first round surfaced §3.5; needs a
  full re-run now that the write path is fixed.
- **`doAddOverlap` writes a whole path object** the same way F9 did. Same bug,
  out of scope here.
- **Curvature visualization** (H10) — still deferred. `measureG2Discontinuity`
  is exported and tested, so this stays a rendering change.
- **Skeleton centerlines** and **generated geometry** (design §9) — untouched.
  `harmonization.js` never learns what a skeleton is; the guard lives entirely at
  the call site, so neither is constrained by what landed here.
- **`harmonic-move`** — separate feature, no shared code.
