# Continuous Skeleton Outline Construction

**Date:** 2026-07-29  
**Status:** proposed design  
**Branch:** `fix/skeleton-continuous-outline-solver`

## 1. Problem

A cubic skeleton segment produces one cubic outline segment on each visible side.
The outline endpoints are fixed by the ribs. The outline handle directions are fixed
by the skeleton handles. Only the two outline handle lengths are unknown.

The current construction does not solve those two unknowns once. It builds a candidate,
projects offset samples onto that candidate, solves new lengths, and repeats. It then
searches for an acceptable handle balance and applies further authored adjustments.

This makes the objective depend on the candidate being solved:

1. A sample can switch to a different part of the candidate curve.
2. A local projection can switch between roots.
3. An error-budget search can move from one side of a plateau or kink to another.
4. A later bound can change the curve that an earlier stage measured.

Fixed iteration counts make these decisions reproducible. They do not make them
continuous.

The failure is visible in `_external/U^1.json`. Its two straights are joined by one
cubic skeleton segment. During a one-direction tension sweep, generated handles can
jump and rebound although the skeleton changes smoothly. Earlier revisions produced
changes above one hundred units between adjacent inputs. The latest feasible-domain
and RMS repairs reduce the largest measured changes, but they retain candidate
rematching and the error-budget search.

The accumulated repairs are individually reasonable. The structure requiring them is
not. This feature replaces the automatic handle construction rather than adding another
motion guard or exceptional case.

## 2. Geometric limitation

A general variable-width offset of a cubic is not itself a cubic. A single generated
cubic cannot simultaneously satisfy all of these:

- exact rib endpoints;
- skeleton-owned handle directions;
- exact agreement with the mathematical offset;
- one generated segment for one skeleton segment.

The first, second, and fourth requirements are product invariants. Therefore the
automatic result is necessarily an approximation.

The mathematical offset also becomes a poor target near a cusp or loop. In that region,
blindly minimizing offset error asks one handle to collapse or cross its tangent
intersection. The outline must then inherit the skeleton's curve character instead of
following an unrepresentable target at any cost.

## 3. Solution summary

The new construction is **one convex minimization**, solved once in closed form.

Its objective has two terms:

1. **The fit.** Perpendicular distance from the generated cubic to the requested offset,
   measured at fixed sample identities. Affine in the two handle lengths, so this term is
   a convex quadratic.
2. **The pull.** A quadratic penalty on the distance, in tension space, from the
   **reference answer** — the skeleton's own two handle tensions transferred to the
   generated tangent reaches.

The pull's weight is a dimensionless multiple of the frame's fixed **unprojected
handle-influence scale**, so the two terms are always commensurate. Unlike `trace(H)`,
that scale remains positive when the perpendicular fit has no information. In healthy
geometry the calibrated ratio stays near its floor and the answer is fit-led. As cusp
health degrades the ratio rises; where the fit has no information in some direction, the
pull determines the answer in that direction and resolves to the skeleton's curve
character.

The sum is minimized inside the existing handle box. Because the pull is strictly
positive-definite, the total is **strictly convex for every finite input**: the minimizer
always exists and is unique. Away from the declared topology events, its coefficients,
reference, and box vary continuously, so the answer varies continuously too. The pull
also bounds the condition number of each solve; end-to-end motion is accepted by the
required sweeps rather than claimed from conditioning alone.

That single term does three jobs that would otherwise be three mechanisms — it supplies
the rank-deficient answer, it breaks ties in a flat valley, and it is how an
unrepresentable offset inherits the skeleton's shape instead of landing on a face of the
box. There is no separate confidence score, no blend between two computed answers, and no
branch on the rank of the system.

This is part of the geometry definition. It does not inspect pointer direction, previous
frames, or output motion. The same input always produces the same result.

The automatic path contains:

- no nearest-point projection;
- no root finding;
- no iterative refitting;
- no convergence test;
- no error-budget search;
- no equalization repair;
- no rank branch or degeneracy threshold;
- no blend between two separately computed answers;
- no motion override;
- no history or hysteresis.

## 4. Hard requirements

### 4.1 Geometry

1. Generated endpoints remain the exact rib endpoints supplied by the contour
   generator.
2. Generated handle directions always remain parallel to the corresponding skeleton
   handle directions.
3. One skeleton cubic continues to produce one cubic per visible side.
4. Output point count remains stable across all parameter values and compatible masters.
5. Lines remain direct rib-to-rib projections.
6. A collapsed side continues to copy the skeleton exactly.
7. Closed, open, double-sided, single-sided, reversed, and mirrored contours remain
   supported.
8. Width taper remains supported.
9. Corner construction, corner rounding, and cap construction remain separate later
   stages.
10. The automatic result remains inside the existing positive, non-crossing handle
    domain.

### 4.2 Continuity

1. Within a fixed contour topology, and while the sampled skeleton tangents remain
   nonzero, every unrounded automatic handle position is a continuous function of
   skeleton coordinates and widths. An exact zero derivative makes the requested normal
   undefined; that invalid input is covered by the finiteness requirement rather than a
   continuity claim.
2. The construction is frame-independent. It cannot read prior generated geometry.
3. No threshold chooses between two automatic algorithms.
4. The minimized objective is strictly convex for every finite input, so the minimizer is
   unique and no tie-break rule exists. Active handle-box constraints may change; the
   answer must meet continuously at each shared boundary.
5. Continuity is not sufficient on its own. The pull must bound the condition number of
   every solve rather than leave it to the perpendicular fit. Because the frame,
   reference, box, and pull weight all vary with the input, the end-to-end sensitivity
   requirement is empirical: the high-resolution sweep step ceiling is the acceptance
   criterion.
6. Deliberate topology events remain explicit: collapsed-side activation, a
   forward/behind tangent-intersection change, and final grid rounding. The
   forward/behind change occurs independently on the outline frame and on the skeleton
   frame used by the reference answer; both must be swept.
7. A high-resolution sweep must test each side and each supported width mode.

### 4.3 Authored geometry

1. Attached handle adjustments continue to modify the automatic handle lengths.
2. A stored curvature continues to set the harmonic-mean tension after attached
   adjustments.
3. Detached handles remain absolute and bypass the automatic answer.
4. Clearing a stored curvature before a direct handle edit must still preserve the
   rendered curve.
5. A generated on-curve nudge remains an emission displacement and does not enter the
   automatic handle solve.
6. Mirroring continues to swap side-owned data.

### 4.4 Operational

1. The solver remains pure and stateless.
2. All internal calculations remain floating point.
3. The solver introduces no rounding at all. Existing generator rounding and the existing
   resolution of hand-placed attached or detached handles onto the grid in the
   orchestrator remain unchanged. The pin runs after the authored-handle resolution, so
   that resolution cannot be deferred without changing rendered authored geometry.
4. Rank-deficient geometry with defined normals produces finite output through the
   reference pull. Invalid geometry such as an exact zero sampled derivative also produces
   finite output, with the cusp-health predictor assigning maximum reference authority.
5. The work stays in the geometry core and retains automated test coverage.
6. No persistence schema, editor gesture, panel, or selection change is required.

## 5. Geometry model

### 5.1 Fixed segment frame

For one generated side, define:

- `startOutlinePoint` and `endOutlinePoint`: exact rib endpoints;
- `startHandleDirection` and `endHandleDirection`: unit directions copied from the
  skeleton;
- `startLength` and `endLength`: the two unknown positive lengths.

The generated cubic is:

```js
function buildOutlineCubic(frame, startLength, endLength) {
  return [
    frame.startOutlinePoint,
    addScaled(frame.startOutlinePoint, frame.startHandleDirection, startLength),
    addScaled(frame.endOutlinePoint, frame.endHandleDirection, endLength),
    frame.endOutlinePoint,
  ];
}
```

At every fixed parameter, the generated point is affine in the two lengths. Squared
linear residuals therefore produce a convex quadratic objective.

### 5.2 Requested offset samples

Use the existing symmetric sample positions:

```js
const OFFSET_SAMPLE_PARAMETERS = [0.125, 0.25, 0.5, 0.75, 0.875];
```

For each parameter:

1. Evaluate the skeleton cubic.
2. Evaluate its unit normal.
3. Interpolate the signed side width.
4. Move the skeleton point along the normal by that width.

Each sample keeps its original skeleton parameter for the entire solve. It is never
projected onto the candidate cubic.

### 5.3 Perpendicular-error system

For sample `i`, let:

- `requestedPointᵢ` be the requested offset point;
- `skeletonNormalᵢ` be the skeleton normal;
- `candidatePointᵢ(τₐ, τᵦ)` be the generated cubic point;
- `τₐ` and `τᵦ` be the two handle tensions, whose lengths are `Rₐτₐ` and
  `Rᵦτᵦ`.

The residual is:

\[
r_i(\tau_a,\tau_b)=
n_i\cdot\left(C_i(\tau_a,\tau_b)-O_i\right)
\]

Only perpendicular error is measured. Tangential displacement is excluded because it
primarily represents a difference in parameterization rather than a difference in
outline shape.

Each residual has the form:

\[
r_i(\tau_a,\tau_b)=c_i+\alpha_i\tau_a+\beta_i\tau_b
\]

The geometric objective is:

\[
E_\text{geometry}(\tau_a,\tau_b)=
\frac{1}{N}\sum_i w_i r_i(\tau_a,\tau_b)^2
\]

The implementation accumulates one two-by-two quadratic system:

```js
function buildPerpendicularErrorSystem(frame, offsetSamples, handleDomain) {
  const system = new HandleQuadraticSystem();

  for (const sample of offsetSamples) {
    const influence = getHandleInfluenceAt(sample.parameter, frame);
    const fixedPoint = getFixedCubicPointAt(sample.parameter, frame);
    const startTensionInfluence = scale(influence.startVector, handleDomain.startReach);
    const endTensionInfluence = scale(influence.endVector, handleDomain.endReach);

    const constantError = dot(
      sample.skeletonNormal,
      subtract(fixedPoint, sample.requestedPoint)
    );
    const startCoefficient = dot(sample.skeletonNormal, startTensionInfluence);
    const endCoefficient = dot(sample.skeletonNormal, endTensionInfluence);

    system.addSquaredResidual(
      constantError,
      startCoefficient,
      endCoefficient,
      sample.weight
    );
    system.addInfluenceScale(
      sample.weight *
        (squaredLength(startTensionInfluence) + squaredLength(endTensionInfluence))
    );
  }

  return system;
}
```

The system coefficients and box are therefore both in tension coordinates. The
unprojected scale is accumulated beside the projected residual coefficients from the same
fixed influences; it is not recovered from the Hessian after projection.

### 5.4 Reference answer

The reference answer transfers each skeleton handle's normalized tension to the
corresponding generated reach:

```js
function transferSkeletonTensions(skeletonCurve, handleDomain) {
  const skeletonDomain = buildHandleDomain(
    skeletonCurve.startPoint,
    skeletonCurve.endPoint,
    skeletonCurve.startHandleDirection,
    skeletonCurve.endHandleDirection
  );
  const skeletonTensions = {
    start: skeletonCurve.startHandleLength / skeletonDomain.startReach,
    end: skeletonCurve.endHandleLength / skeletonDomain.endReach,
  };
  return constrainTensions(skeletonTensions, handleDomain);
}
```

This has three useful properties:

1. A circular arc keeps its familiar tension after offsetting.
2. An equal-tension skeleton produces an equal-tension generated segment.
3. A shoulder with intentionally unequal skeleton tensions retains that asymmetry.

Where a tangent reach is geometrically unavailable, the same finite chord-based reach
used by the existing authored-tension controls is used. One reach definition remains
shared by the automatic and authored layers.

The skeleton's own frame has its own forward/behind tangent-intersection change,
independent of the outline's. It is the same declared topology event, in a second place,
and §8 requires sweeping it.

### 5.5 The pull

The perpendicular system above already carries both unknowns as tensions: its handle
influence vectors have been multiplied by their reaches before projection.

Add one quadratic term penalizing distance from the reference answer
\((\hat\tau_a,\hat\tau_b)\):

\[
P(\tau)=\mu\left[(\tau_a-\hat\tau_a)^2+(\tau_b-\hat\tau_b)^2\right]
\qquad
\mu=\rho S
\]

The scale \(S\) is the weighted squared magnitude of the two handle influences **before**
they are projected onto the skeleton normals:

\[
S=\sum_i w_i\left[(B_1(t_i)R_a)^2+(B_2(t_i)R_b)^2\right]
\]

Every sample parameter lies strictly between zero and one, every weight is positive, and
both reaches are finite and positive, so \(S>0\) even when the projected system is zero.
Scaling \(\mu\) this way makes \(\rho\) dimensionless and makes the construction invariant
to glyph scale and sample count. Because projection onto a unit normal cannot increase a
vector's magnitude, \(\operatorname{trace}(H)\le S\).

Adding the pull is a **modification of the same two-by-two system**, not a second solve:

```js
function addReferencePull(system, reference, weightRatio) {
  const weight = weightRatio * system.influenceScale;
  return {
    ...system,
    aa: system.aa + weight,
    bb: system.bb + weight,
    ac: system.ac - weight * reference.startTension,
    bc: system.bc - weight * reference.endTension,
  };
}
```

Three consequences follow directly, and they are why this replaces three mechanisms:

- **Strict convexity, always.** The unpenalized system is positive semi-definite and
  \(\mu>0\), so the penalized determinant is at least \(\mu^2>0\). The minimizer exists
  and is unique for every finite input, including a coincident, retracted, or perfectly
  straight segment. There is no rank branch and no tie-break rule.
- **A conditioning bound you set.** The smallest eigenvalue is at least \(\mu\), while
  the largest eigenvalue of the unpenalized system is at most \(S\). The condition number
  is therefore at most \(1+1/\rho\). This bounds amplification inside each solve; the
  required geometry sweeps measure the complete input-to-output sensitivity, including
  changes in the frame, reference, domain, and weight ratio.
- **Unrepresentable offsets inherit shape.** Where one cubic cannot express the offset,
  the pull biases the constrained optimum toward the skeleton's own split instead of
  allowing the fit alone to dictate a collapsed pair. It does not prohibit a legitimate
  active box constraint, and the reference itself may lie on a face.

### 5.6 The pull weight

\(\rho\) has a floor that is always present, and rises as the offset approaches a cusp.

The predictor is the **cusp factor** \(\lambda=1+d\kappa\), evaluated at the endpoints and
the same five fixed interior sample parameters used by the fit. The offset of a curve is
singular where this reaches zero, and a single cubic already fails to represent the
offset well before it. This is the same quantity the superseded seed scaled by; it
survives as a weight predictor rather than as a starting point.

\[
s=\operatorname{clamp}\!\left(\min_{t\in\{0,\frac18,\frac14,\frac12,
\frac34,\frac78,1\}}\lambda(t),0,1\right)
\qquad
\rho=\rho_\text{floor}+(\rho_\text{cusp}-\rho_\text{floor})(1-s)^2
\]

Starting values, to be calibrated by the sweeps in §8 and then frozen as global model
constants: \(\rho_\text{floor}=10^{-3}\), \(\rho_\text{cusp}=4\).

**The ratio \(\rho\) is computed only from the skeleton and the widths.** It does not read
the fit's residual, the fit's answer, or anything else the solve produces. The absolute
weight \(\mu\) also uses the fixed frame influence scale \(S\), never the projected
Hessian. A ratio driven by the achieved residual would put its own steepest region on
tapered segments, whose error is commonly a direction error no handle length can absorb.
Taper is therefore not a separate weighting rule: the global floor must pass the taper
sweeps, while cusp proximity can raise the ratio continuously.

### 5.7 The solve

Minimize the penalized quadratic inside the handle box:

```js
function solveNaturalHandles(request) {
  const samples = buildRequestedOffsetSamples(request);
  const reference = transferSkeletonTensions(request);
  const system = addReferencePull(
    buildPerpendicularErrorSystem(request, samples),
    reference,
    pullWeightRatio(request)
  );
  return minimizeQuadraticInsideRectangle(system, request.handleDomain);
}
```

The box is a rectangle because each handle has a minimum positive length and a maximum
non-crossing reach.

The solve needs no iterative search. Because the penalized system is strictly convex, the
minimizer is the interior stationary point when it lies inside the rectangle, and
otherwise the best of the four edge minima and four corners. It is compared on the single
penalized objective. When an active boundary changes, both active sets meet at the same
answer, because the objective is one continuous strictly convex function on both sides of
the boundary. Straight and degenerate segments need no alternative algorithm and no
special case: the pull supplies the answer in any direction the fit does not constrain.

`pullWeightRatio` reads only the skeleton control points and the two signed widths. It may
evaluate those inputs at the fixed parameters, but it must not be given access to the
assembled system, its residual, or the answer. `addReferencePull` separately reads the
precomputed frame influence scale needed to give that ratio physical scale.

The pull constants are global model constants. They cannot vary by glyph, side, mode, or
fixture. The prototype measurements below were taken with the superseded blend and stand
only as feasibility evidence for the fixed-sample fit; the committed implementation must
reproduce them through repository tests, after `ρ_floor` and `ρ_cusp` are calibrated
against the §8 sweeps:

- `U^1` single-sided tension sweep: worst unrounded handle step about `1.14` units,
  with no backtracking;
- circular offsets: approximately `0.03–0.05` units maximum deviation;
- tested S-curves: approximately `2.38` units;
- tested tight turn: approximately `0.52` units;
- tested shallow wide offset: approximately `0.18` units;
- tested unequal-handle curve: approximately `0.29` units.

These measurements establish feasibility. The committed implementation must reproduce
them through repository tests before replacing the current construction.

### 5.8 Authored-handle layer

The solved answer is followed by the existing authored semantics in one explicit layer:

```js
function applyAuthoredHandleState(naturalHandles, authoredState, frame) {
  const attached = applyAttachedHandleAdjustments(naturalHandles, authoredState, frame);

  const curvaturePinned = authoredState.hasPinnedCurvature
    ? setHarmonicMeanTension(attached, authoredState.pinnedCurvature, frame)
    : attached;

  return replaceDetachedHandles(curvaturePinned, authoredState, frame);
}
```

These operations are not automatic-fit repairs:

- attached adjustments represent a designer's relative handle placement;
- a curvature pin represents a designer's chosen magnitude;
- detached handles represent absolute geometry.

Each operation retains its existing ownership and undo behavior.

## 6. Pipeline

The complete cubic-side pipeline becomes:

```js
function constructOutlineSide(input) {
  if (input.sideIsCollapsed) {
    return copySkeletonSideExactly(input);
  }

  const frame = buildFixedSegmentFrame(input);
  const handleDomain = buildHandleDomain(frame);

  const naturalHandles = solveNaturalHandles({
    ...input,
    frame,
    handleDomain,
  });
  const authoredHandles = applyAuthoredHandleState(
    naturalHandles,
    input.authoredState,
    frame
  );

  return emitOutlineCubic(frame, authoredHandles);
}
```

Data flows in one direction:

```text
skeleton geometry
    -> fixed segment frame
    -> requested offset samples  +  reference answer  +  pull weight
    -> one strictly convex quadratic
    -> exact minimization inside the handle box
    -> authored handle state
    -> emitted cubic
```

No downstream stage asks how an upstream answer was obtained.

## 7. Code boundaries

### 7.1 Natural-handle solver

Add one focused geometry module beside the existing cubic construction module. It owns:

- fixed offset sampling;
- quadratic-system assembly;
- the reference answer (skeleton-tension transfer);
- the pull weight, from the skeleton and the widths only;
- exact two-variable constrained minimization of the penalized system.

It has no knowledge of pins, attached offsets, detached handles, provenance, caps,
corners, contour direction, or editor state.

Its public input and output are plain objects:

```js
/**
 * @typedef {Object} NaturalHandleRequest
 * @property {Object[]} skeletonControlPoints
 * @property {number} startSignedWidth
 * @property {number} endSignedWidth
 * @property {Object} startOutlinePoint
 * @property {Object} endOutlinePoint
 * @property {Object} startHandleDirection
 * @property {Object} endHandleDirection
 * @property {Object} handleDomain
 */

/**
 * @typedef {Object} NaturalHandleResult
 * @property {number} startLength
 * @property {number} endLength
 * @property {number} pullWeightRatio    diagnostic only
 * @property {number} perpendicularRms   diagnostic only, measured on the answer
 */
```

The two diagnostics exist so a failing accuracy test can distinguish a poor fit from a
segment the pull deliberately holds near the skeleton's shape. Nothing downstream may
branch on either.

### 7.2 Cubic-side orchestrator

The existing cubic-side module becomes a short orchestrator. It owns:

- construction of the handle domain;
- calling the natural solver;
- attached adjustments;
- pinned curvature;
- detached handles.

The repeated correction loop, sample projection, magnitude re-solve, split walk, and
their constants are removed after the new solver passes acceptance.

### 7.3 Contour generator

The contour generator keeps its current responsibilities:

- widths and single-sided redistribution;
- corner-aware rib endpoints;
- skeleton-owned handle directions;
- segment assembly;
- provenance;
- caps and corners;
- final emission and rounding.

No editor-side code changes.

## 8. Testing requirements

### 8.1 Reproduction sweep

Promote `_external/U^1.json` into a focused test fixture or reproduce its segment
numerically in the geometry tests.

Sweep the skeleton segment tension through the full useful range for:

- single-sided right;
- single-sided left;
- double-sided, both generated sides;
- pinned curvature;
- attached handle adjustments;
- detached handles where applicable.

For the reported single-sided sweep:

- both automatic handle lengths must be monotone;
- no unrounded handle may move more than `3` units for the existing `1.7`-unit
  skeleton-handle step;
- repeating the sweep in reverse must visit the same geometry in reverse order.

### 8.2 Perturbation continuity

For every nondegenerate fixture cubic:

1. Perturb every source coordinate by `1e-5`.
2. Perturb each endpoint width by `1e-5`.
3. Confirm that the unrounded handle change tends to zero with the perturbation.
4. Repeat on both signed sides.

The test must target the natural solver directly so grid rounding cannot hide a jump.

### 8.3 Accuracy

Retain the existing true-offset accuracy cases:

- circular arcs in both directions;
- S-curves on both sides;
- tight inward turn;
- shallow curve at wide offset;
- unequal skeleton handles.

Add, because the current suite has no case with unequal endpoint widths and taper is
common:

- a tapered segment at moderate ratio, both sides;
- a tapered segment at strong ratio, both sides;
- a tension sweep on a tapered segment, held to the same step ceiling as §8.1.

The new implementation must meet the current ceilings. It must also record the pull
weight and the answer's residual so a failure distinguishes a poor fit from a segment the
pull deliberately holds near the skeleton's shape.

### 8.3.1 Accuracy ledger

Before routing production geometry through the new solver, evaluate both the current
automatic `offsetCubicSide` path and `solveNaturalHandles` against the same independent
true-offset samples for every case named in §8.3. Report how many cases improved, how
many lost, the net change in maximum deviation, and the worst single loss. Keep the
current ceilings as the acceptance contract; the ledger is additional evidence and must
not manufacture new ceilings from the implementation under test.

### 8.4 Invariants

Add tests for:

- exact rib endpoints;
- exact skeleton-owned handle directions before grid rounding;
- one-unit minimum;
- non-crossing maximum;
- identical output for identical input;
- stable point count;
- mirror equivalence;
- reversal equivalence;
- exact collapsed-side copy;
- finite output for coincident points and retracted handles.

### 8.5 Authored behavior

Retain or add tests proving:

- a stored curvature survives skeleton, width, and taper changes;
- unreachable stored curvature remains stored;
- attached adjustments preserve their split contribution;
- detached handles remain absolute;
- clearing a curvature before direct manipulation preserves the rendered curve;
- nudging a generated on-curve does not alter the natural solve.

### 8.6 Full verification

Before fixture regeneration:

```powershell
npm.cmd test --workspace src-js/fontra-core -- --grep "offset|skeleton"
```

Before completion:

```powershell
npm.cmd test
npm.cmd run bundle
```

Golden fixtures change only after the focused properties pass and the new outlines have
been reviewed.

## 9. Migration sequence

1. Add the `U^1` failing sweep against the current implementation.
2. Add pure tests for the new natural-handle solver.
3. Implement fixed offset sampling and the quadratic system.
4. Implement exact minimization inside the handle domain.
5. Implement the reference answer and the pull weight.
6. Verify the prototype measurements in repository tests.
7. Route only the automatic natural handles through the new solver.
8. Keep authored adjustments, pins, detached handles, contour assembly, caps, corners,
   and provenance unchanged.
9. Run focused, full, bundle, and interpolation verification.
10. Review changed outlines.
11. Remove the superseded correction and split machinery.
12. Regenerate golden fixtures and update the standing feature documents.

Each step is independently testable. No step requires an editor or persistence migration.

## 10. Rejected approaches

### Motion clamping

Reject output motion based on the previous frame.

This hides a discontinuous geometry function, adds history, and makes output depend on edit
direction.

### Pure endpoint-curvature scaling

Use only the local parallel-curve speed at each endpoint.

This is continuous but too local. Strong taper or a cusp can collapse one handle while the
other remains healthy.

### Candidate rematching

Repeatedly project samples onto the current candidate.

This recreates the current changing-objective problem. A bounded intermediate curve reduces
its failures but does not remove root switching or correspondence drift.

### Error-budget equalization

Fit freely, then search how much imbalance repair an error allowance can afford.

This makes balance a later correction. Plateaus, active sample changes, and allowance
constants become part of the geometry.

### Blending two computed answers by a representability score

Solve the fit, score how well it did, and interpolate between it and the reference answer
by that score.

Three faults. The score's steep region lands on tapered segments, which are common and
whose error is a direction error no handle length can absorb, so the most ordinary
non-trivial case sits in the fastest-moving part of the control. A weight read off the
achieved residual closes a feedback path from the answer into how much the answer counts.
And a steep sigmoid is a threshold with a slope — the same species as the eased tension
ceiling that had already been withdrawn twice, and it puts a large slope in the output
precisely where the two answers are furthest apart.

Superseded by the pull: one term inside the objective, with a ratio derived from the
skeleton and widths and an absolute scale derived from the fixed frame. It gives each
solve an explicit conditioning bound; the complete geometry response is then accepted by
the required sweeps.

### A determinant-based rank score

Multiply the answer by a continuous function of the normalized determinant so the fit's
influence falls away as rank disappears.

It is calibrated in the wrong place. A score reaching half strength at a determinant of
`1e-6` of the squared trace corresponds to a condition number near one million, while the
answer's sensitivity is already large at ten thousand — so the guard does nothing across
the entire range where conditioning actually degrades the answer. Making it strictly
convex from the start removes the quantity being measured.

### Fixed subdivision

Emit multiple cubics for every skeleton cubic.

This can improve approximation, but it changes point topology, provenance, interpolation,
and all segment-level controls. It is unnecessary for the reported problem.

## 11. Completion criteria

The feature is complete when:

1. The current iterative correction and split-search machinery is absent from the automatic
   path, and no confidence score, rank branch or blend has replaced it.
2. `U^1` sweeps without generated-handle jumps or rebound in every supported width mode,
   and a tapered segment sweeps to the same ceiling.
3. Generated directions remain skeleton-owned.
4. Existing accuracy ceilings pass.
5. Authored handle behavior remains unchanged.
6. Point counts and interpolation remain stable.
7. Core tests and the production bundle pass.
8. The standing architecture and feature-model documents describe the new pipeline.
