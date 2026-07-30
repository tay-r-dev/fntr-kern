# Serif generator — design

**Date:** 2026-07-30
**Status:** design approved, not yet planned
**Companions:** `../SKELETON-FEATURE-MODEL.md` (§3 pipeline, §5 what must be preserved),
`../FEATURE-ARCHITECTURE-MAP.md` (§2 rails, §3 F7 file map)
**Mockup:** `../serif-lab.html` — the parameter model and the interactive proof. Its
geometry is the reference; two things in it are wrong and are corrected below (§4.3, §6).

Scope of this document is **the generator**: given a terminal and a parameter set, emit
the outline. The panel, the preset library UI, terminal auto-classification and a
class-level cascade are explicitly out of scope and get their own specs.

---

## 1. The model

A serif is not a shape attached to a point. It is **two independent half-serifs attached to
a local frame**, plus a small set of terminal-level values the two halves share.

This is the load-bearing decision. Nearly every case that would otherwise need its own serif
type — one-sided arms, the flat-terminal S, a pure flare with no wing, an unbracketed slab —
falls out of degenerate values on one topology. Discrete style types are rejected: they
multiply code paths, they cannot interpolate, and they make presets incomparable.

### 1.1 A serif is a cap style

`VALID_CAP_STYLES` (`skeleton-model.js:59`) gains `"serif"`, alongside
`butt | round | square | drop`. Selection, per-point override and contour fallback all work
as they already do: `generateOutlineFromSkeletonContour` reads
`point.capStyle ?? contour.capStyle` and normalizes through `normalizeCapStyle`
(`skeleton-generator.js:2714`).

The four cap styles remain **mutually exclusive**. Corner rounding composing on top of any
cap style is desired but is a separate change and is **not in this spec** — see §9.

### 1.2 The frame

Computed per terminal, never stored:

| Element      | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| origin       | the terminal's rib centre (the skeleton endpoint)                       |
| **axis**     | the direction the wings extend — **its own property**, see below        |
| depth        | perpendicular to the axis, pointing back along the stroke               |
| unit scale   | not used; parameters are absolute (§3)                                  |

**The serif axis is independent of `ribAngleLock`.** The rib angle lock keeps doing exactly
what it does now — it sets the rib the cap is built on, via `getEffectiveNormal`, under
every cap style. The serif axis is a *separate* property that decides which way the wings
run. Both exist and compose; neither absorbs the other.

Axis modes, stored per terminal:

- `perpendicular` — perpendicular to the stroke tangent (default; correct for I, H, E stems)
- `horizontal`
- `vertical`
- `absolute` — plus an angle in degrees

`horizontal` with the body sitting upward is the flat-terminal S, with no new serif type and
no special case in the generator.

**Expected consequence, not a defect:** when the serif axis diverges from the rib direction,
the two halves come out geometrically unequal from equal parameter values, because the two
flank release points sit at different distances along that axis. This is the behaviour the
axis modes exist to produce.

---

## 2. Parameters

### 2.1 Per half-serif (7 numbers, absolute font units)

| Name            | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `wingLength`    | how far the wing reaches along the axis past the stroke flank. 0 = no wing                 |
| `tipThickness`  | serif depth at its outer end. Thick = slab, thin = didone                                  |
| `wingSlope`     | how far the inner corner sits above the tip. Positive gives the old-style rise             |
| `tipCutAngle`   | slant of the outer edge, degrees. Positive splays the foot outward                         |
| `reach`         | how far back up the stroke flank the transition curve extends                              |
| `tension`       | 0 collapses the transition to a straight line (angular wedge); 1 hugs the inner corner     |
| `concavity`     | signed. Negative = convex fillet, 0 = flat chamfer, positive = classic hollow transition   |

**`tipRadius` is deferred.** Rounding the tip corner needs the corner-rounding machinery,
and rounding composing over caps is out of scope (§9). Adding it later costs two more
emitted points per half, always emitted, per §5.

`tension` is the corner/smooth control. There is **no discrete smooth-vs-corner flag**: at
`tension = 0` the transition's control points collapse onto its endpoints and the join reads
as a corner; at higher values it reads smooth. Keeping it continuous is what lets two presets
interpolate.

`wingLength = 0` with `reach > 0` is a pure flare into the terminal — the same object, same
topology, no branch.

### 2.2 Per terminal (shared by both halves)

| Name             | Meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `serifAxisMode`  | `perpendicular` \| `horizontal` \| `vertical` \| `absolute`                      |
| `serifAxisAngle` | degrees; consulted only when mode is `absolute`                                  |
| `undersideCup`   | how far the middle of the foot lifts off the baseline (§4.3)                     |
| `straightDepth`  | depth of the straight parallel-sided section between stroke and serif (§4.4)     |

`undersideCup` is deliberately **not** per half. See §4.3.

### 2.3 Units are absolute, with a normalization switch

Absolute font units by default, matching `width`, `capDistance`, `cornerReach` and every
other length in the skeleton. A switch stored with the per-source defaults may store the
same values as ratios of local stroke width instead.

Rationale for absolute as the default: **in real type, serif length does not scale with
weight.** A bold's serifs stay close to the regular's while the stem doubles. Normalizing by
stroke width by default would fight that on every weight axis. Absolute also matches what a
designer measures on the drawing, and keeps debugging free of hidden multiplication.

Rationale for offering normalized at all: one preset then works across weights and optical
sizes without re-entry, and a tapered stroke gets a proportionally-sized serif at each
terminal automatically. Some designs want exactly that.

The switch converts on read, at the point the generator resolves a parameter to a length.
Stored values are never rewritten by flipping it.

---

## 3. Storage

### 3.1 Canonical shape

Per-side fields follow the existing `{left, right}` sub-object convention used by `width`,
`nudge`, `handleNudge`, `locked` and `segmentCurvature`:

```js
point.serif = {
  left:  { wingLength, tipThickness, wingSlope, tipCutAngle, reach, tension, concavity },
  right: { ...same },
  axisMode, axisAngle, undersideCup, straightDepth,
};
```

Every field nullable, falling back to the contour and then to source defaults, matching the
existing three-level cascade. A class level between contour and point is **out of scope**.

### 3.2 The generator translation trap

`canonicalToGeneratorInput` / `canonicalPointToGeneratorPoint`
(`skeleton-generator.js:174`) flattens every point before generation, and the model's
accessors do not work on the far side of it. **A new per-point field is invisible to the
generator until it is copied across explicitly.** This has already caused one silent
failure (the segment-curvature pin, feature model §7) and the `ribAngleLock` copy carries a
comment saying so.

Serif fields must be added to that translation. Prefer extending the existing
`CAP_POINT_FIELDS`-style list over hand-copying each field.

### 3.3 Mirroring

`transformSkeletonPointMetadata` (`skeleton-model.js:2101`) swaps per-side fields on a
determinant flip via a field-name list. Adding `"serif"` to that list swaps the two halves
correctly, because the halves are sibling keys of one object.

Two values need explicit handling beyond the swap:

- `serifAxisAngle` **negates**, like `capAngle` and `cornerAsymmetry` already do.
- `axisMode` does not change: `horizontal` stays horizontal under a mirror.

`tipCutAngle` and `wingSlope` do **not** negate — they are measured within their own half's
frame, and swapping the halves is the whole correction.

---

## 4. Construction

Runs where the other caps run, in the open-contour branch of
`generateOutlineFromSkeletonContour` (`skeleton-generator.js:1463`), after
`roundSharpCornersOnSide` and before final assembly and `enforceSmoothColinearity`.

### 4.1 Per half

1. Resolve the frame (§1.2).
2. Trim the flank back by `reach`, clamped per §4.5. This is the same trim-and-splice the
   round and drop caps already perform, via `splitTerminalSideForRoundCap` /
   `trimSideForRoundCapEmission`. Provenance must be re-attached across the rebuilt region
   the way `withRoundCapProvenance` does — the drop cap's history shows that skipping it
   makes the whole trimmed region unaddressable.
3. Emit, from the flank outward: release point → transition curve → straight section start →
   wing inner corner → tip top → tip bottom. The straight section (§4.4) is the run between
   the last two of those; at depth 0 they coincide.

**Do not port the drop cap's implementation.** It is unfinished and its ball-solving,
crossing-search and three-way `soft`/`corner`/`bridge` fallback are not a model to follow.
What transfers is the *shape of the problem*: trim both flanks, splice, re-attach
provenance, clamp against real arc length.

### 4.2 Foot

The two halves are joined by a single underside curve running left tip bottom → foot centre →
right tip bottom.

### 4.3 The underside cup is one curve, not two

**The mockup is wrong here.** It builds a `cup` control inside each half, so the foot gets
two scoops meeting at the centre with a visible break between them.

The underside is **one** curve across the whole terminal, driven by one terminal-level
`undersideCup`. Only the tips touch the baseline.

The foot centre sits **on the skeleton**, not at the midpoint of the two tips. With unequal
halves — which the axis modes produce routinely (§1.2) — a midpoint-anchored centre would
drag the contact geometry off the alignment zone as the axis rotates.

### 4.4 The straight section

A parallel-sided rectangle of stroke width, inserted between the stroke and the serif, depth
`straightDepth`.

**The serif's outer face stays on the skeleton endpoint.** The terminal never grows; the
transition curve and the flank release point move further up the stroke instead. Alignment
zones are therefore invariant under this parameter.

Geometrically, in frame coordinates (`u` along the axis, `v` along the depth, origin at the
skeleton endpoint), for a half whose flank crosses the rib at `flankU`:

```
wingInnerV      = tipThickness + wingSlope        // the corner the transition sweeps around
straightBottom  = (flankU, wingInnerV + reach)    // transition curve ends here
straightTop     = (flankU, wingInnerV + reach + straightDepth)
release         = the flank's own endpoint after trimming
```

The straight run is `straightBottom → straightTop`, at constant `u`, so it is exactly stroke
width and parallel-sided. The transition curve spans `straightBottom → tipTop`, meaning
`reach` measures the curve's own extent and `straightDepth` adds beyond it. The flank is
trimmed so it lands on `straightTop`.

At `straightDepth = 0` the two straight points coincide. On a straight flank perpendicular to
the axis, `release` also coincides with `straightTop`. Both are collapsed-point cases; all
points are still emitted (§5).

### 4.5 Reach clamping

`reach` is capped at the true arc length of the terminal segment and **never walks back into
earlier segments**. This is the rule the existing caps already use — the drop cap clamps its
trim to 95% of the terminal segment length, and the round-cap split clamps to the segment
length outright.

Consuming earlier segments is rejected: it makes the emitted point count depend on how many
segments got consumed, which breaks interpolation (§5), and it collides with corner rounding
further up the stroke.

The clamp is reported so the panel can show that a deep transition was limited — most likely
on short terminal curves, the S being the motivating case. Reporting only; **no generator
code may branch on it**, following the diagnostics rule the natural handle solver already
obeys.

---

## 5. Point-count stability

Eleven on-curve points per serif terminal, **constant at every parameter value**:

| Per half (×2)      | Shared        |
| ------------------ | ------------- |
| release point      | foot centre   |
| straight top       |               |
| straight bottom    |               |
| tip top            |               |
| tip bottom         |               |

The wing inner corner is **not** emitted — it is the attractor the transition curve bends
around, as in the mockup. Emitting it would split the sweep and destroy the bracketed look.

Degenerate values produce coincident points, never fewer points. `wingLength = 0`,
`straightDepth = 0`, `tipThickness = 0` and `reach = 0` all still emit their points.

This is the interpolation contract (feature model §5) and it is why one topology was chosen
over discrete style types.

### 5.1 Collapsed-point removal is an opt-out

A switch stored with the per-source defaults (`SKELETON_SOURCE_DEFAULT_KEYS`), **off by
default**. When on, coincident points are dropped at emission.

It is a production-stage decision: once a serif's form is settled and the designer is no
longer experimenting, the redundant points are dead weight in the exported font. Turning it
on forfeits cross-master interpolation for those terminals, by choice.

Source-level rather than per-terminal because it is a property of how the font is being
worked on, not of any one letter.

---

## 6. Editing

Serif outline points carry provenance and are editable, like the rest of the generated
outline: nudges, handle offsets and detach all apply. Panel overrides sit on top of the
resolved preset rather than replacing it.

This is the escape hatch. The parametric model covers the 90% case; ball terminals,
teardrops and swashes remain separate cap styles that satisfy the same
`(params, frame) → path` contract without interpolating against the serif vector, and that
is acceptable.

---

## 7. Presets

A preset is a **named vector of the full parameter set** — nothing more. Because every
preset shares topology and parameter count, blending two is a straight component-wise
interpolation, and a morph slider costs nothing extra.

Precedent exists: `capProfiles` and `widthProfiles` in the source defaults are already named
value lists (`skeleton-model.js:225`). Serif presets follow that shape.

Preset library UI is out of scope. The generator needs only to consume a resolved vector.

---

## 8. Testing

`fontra-core` has the harness; this is generator work, so TDD applies (rail R-G).

- **Topology:** emitted point count is identical across a sweep of every parameter through
  its full range, including all degenerate values.
- **Degenerate equivalence:** `wingLength = 0, reach = 0, tipThickness = 0` reproduces the
  butt cap's outline to within grid rounding.
- **Axis modes:** a terminal whose tangent is rotated through 360° emits a serif whose wing
  direction is invariant under `horizontal`, and tracks the tangent under `perpendicular`.
- **Mirroring:** mirror a serifed glyph, mirror it back, assert the skeleton data round-trips
  exactly.
- **Clamping:** reach beyond the terminal segment length is limited and never consumes the
  previous segment.
- **Continuity, by sweep not assertion:** hold the geometry fixed, walk one parameter through
  its range in fine steps, measure worst single-step outline movement against the driver's
  own step. Per-configuration assertions have missed every fault in this area so far
  (arch map §8). Start away from degenerate configurations.
- **Golden masters:** new fixtures in `tests/data/skeleton-generator/fixtures.json` via
  `tests/scripts/make-skeleton-generator-fixtures.js`.

Editor-side work (panel, hit-testing, layers) has no harness and carries a manual test
matrix in its plan.

---

## 9. Explicitly out of scope

| Item                                   | Why deferred                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Corner rounding composing over caps     | Rounding currently runs before caps and only sees the stroke's own corners. Reordering it risks the pairwise corner-trim limiting, which is load-bearing. Own change. |
| Cascade rework (class level)             | Needs new schema and new panel. The three-level cascade is enough for a working generator.       |
| Terminal auto-classification             | The largest piece of the original proposal. Useless without a working generator to classify into. |
| Preset library UI and morph slider       | Generator consumes a resolved vector; where it comes from is a panel concern.                    |
| Plugin terminals (ball, teardrop, swash) | Separate cap styles satisfying the same contract. No interpolation with the serif vector.        |

---

## 10. Rails this change is bound by

- **R-A** — geometry in `fontra-core`, hit-testing in `scene-model.js`, interaction in its own
  module, rendering in a `visualization-layer-*` file.
- **R-B** — one copy of every constant and geometry function. The frame computation has
  exactly one implementation, shared by generator, drawing layer and hit test.
- **R-C** — every skeleton mutation goes through `editSkeleton`.
- **R-D** — provenance forward, never recovered by geometry matching.
- **R-E** — no kind-branching in shared emit code.
- **R-G** — `node --check`, `npx prettier --write`, `npm run bundle` green on every commit.

Preserved behaviours this must not regress (feature model §5): the width fallback cascade,
the collapsed-side rule, point-count stability, pairwise corner-trim limiting, and the
rules-table interaction feel.
