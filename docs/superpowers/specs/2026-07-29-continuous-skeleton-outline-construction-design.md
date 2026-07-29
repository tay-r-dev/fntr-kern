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

The new construction computes two complete, continuous answers:

1. **Geometric answer.** A fixed convex fit minimizes perpendicular distance from the
   generated cubic to the requested offset. Samples never change identity.
2. **Inherited answer.** The skeleton's two handle tensions are transferred to the
   generated tangent reaches. This preserves the curve character when the mathematical
   offset is not representable by the allowed cubic.

A continuous representability score blends those answers. A small residual gives the
geometric answer full authority. A large residual smoothly transfers authority to the
inherited answer.

This is part of the geometry definition. It does not inspect pointer direction, previous
frames, or output motion. The same input always produces the same result.

The automatic path contains:

- no nearest-point projection;
- no root finding;
- no iterative refitting;
- no convergence test;
- no error-budget search;
- no equalization repair;
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

1. Within a fixed contour topology, every unrounded automatic handle position is a
   continuous function of skeleton coordinates and widths.
2. The construction is frame-independent. It cannot read prior generated geometry.
3. No threshold chooses between two automatic algorithms.
4. Active handle-domain constraints may change, but a full-rank constrained answer must
   meet continuously at the shared boundary. As rank disappears, the geometric answer's
   influence must continuously fall to zero.
5. Deliberate topology events remain explicit: collapsed-side activation, a
   forward/behind tangent-intersection change, and final grid rounding.
6. A high-resolution sweep must test each side and each supported width mode.

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
3. Grid rounding occurs only at the existing emission boundary. The solver introduces
   no intermediate rounding.
4. Invalid or rank-deficient geometry produces finite output by continuously preferring
   the inherited answer.
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
    addScaled(
      frame.startOutlinePoint,
      frame.startHandleDirection,
      startLength
    ),
    addScaled(
      frame.endOutlinePoint,
      frame.endHandleDirection,
      endLength
    ),
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
- `candidatePointᵢ(a, b)` be the generated cubic point;
- `a` and `b` be the two handle lengths.

The residual is:

\[
r_i(a,b)=
n_i\cdot\left(C_i(a,b)-O_i\right)
\]

Only perpendicular error is measured. Tangential displacement is excluded because it
primarily represents a difference in parameterization rather than a difference in
outline shape.

Each residual has the form:

\[
r_i(a,b)=c_i+\alpha_i a+\beta_i b
\]

The geometric objective is:

\[
E_\text{geometry}(a,b)=
\frac{1}{N}\sum_i w_i r_i(a,b)^2
\]

The implementation accumulates one two-by-two quadratic system:

```js
function buildPerpendicularErrorSystem(frame, offsetSamples) {
  const system = new HandleQuadraticSystem();

  for (const sample of offsetSamples) {
    const influence = getHandleInfluenceAt(sample.parameter, frame);
    const fixedPoint = getFixedCubicPointAt(sample.parameter, frame);

    const constantError = dot(
      sample.skeletonNormal,
      subtract(fixedPoint, sample.requestedPoint)
    );
    const startCoefficient = dot(
      sample.skeletonNormal,
      influence.startVector
    );
    const endCoefficient = dot(
      sample.skeletonNormal,
      influence.endVector
    );

    system.addSquaredResidual(
      constantError,
      startCoefficient,
      endCoefficient,
      sample.weight
    );
  }

  return system;
}
```

### 5.4 Geometric answer

Minimize the fixed quadratic inside the existing handle domain:

```js
function solveGeometricHandles(frame, offsetSamples, handleDomain) {
  const errorSystem = buildPerpendicularErrorSystem(frame, offsetSamples);
  return minimizeQuadraticInsideRectangle(errorSystem, handleDomain);
}
```

The domain is a rectangle because each handle has a minimum positive length and a
maximum non-crossing reach.

The solve has two ordered objectives. First, minimize perpendicular error. Second, among
answers with the same minimum error, select the answer closest to the inherited answer
in normalized tension space. This gives the constrained problem one deterministic
answer, including when the geometric system lacks rank.

The solve needs no iterative search. The implementation evaluates the interior minimum,
the four edge minima, and the four corners. It compares their perpendicular errors
first and their normalized distances from the inherited answer second. When an active
boundary changes in a full-rank system, both active sets meet at the same answer. When
rank disappears, the representability score defined below continuously removes the
geometric answer's influence. Straight and degenerate segments therefore need no
alternative fitting algorithm.

### 5.5 Inherited answer

The inherited answer transfers each skeleton handle's normalized tension to the
corresponding generated reach:

```js
function transferSkeletonTensions(skeletonCurve, outlineFrame, handleDomain) {
  const skeletonTensions = measureSkeletonHandleTensions(skeletonCurve);

  return handleDomain.constrain({
    startLength:
      skeletonTensions.start * outlineFrame.startTangentReach,
    endLength:
      skeletonTensions.end * outlineFrame.endTangentReach,
  });
}
```

This has three useful properties:

1. A circular arc keeps its familiar tension after offsetting.
2. An equal-tension skeleton produces an equal-tension generated segment.
3. A shoulder with intentionally unequal skeleton tensions retains that asymmetry.

Where a tangent reach is geometrically unavailable, the same finite chord-based reach
used by the existing authored-tension controls is used. One reach definition remains
shared by the automatic and authored layers.

### 5.6 Representability score

The geometric answer's perpendicular root-mean-square residual measures how well one
allowed cubic can represent the requested offset.

Normalize that residual by the generated chord:

\[
e=
\frac{\operatorname{RMS}(r_i)}
     {\max(\text{chord},1)}
\]

The geometric confidence is:

\[
c_\text{error}=
\frac{1}{1+(e/0.02)^6}
\]

The quadratic system's nonnegative normalized determinant supplies a continuous rank
score. Let \(d=\max(\det(H),0)\); this only removes a possible negative roundoff error
from a positive-semidefinite system.

\[
c_\text{rank}=
\frac{d}
     {d+10^{-6}\operatorname{trace}(H)^2}
\]

Define \(c_\text{rank}=0\) when both numerator and denominator are zero.

The final confidence is:

\[
c=c_\text{error}c_\text{rank}
\]

Both scores are continuous. Neither performs a threshold comparison.

The natural automatic answer is:

```js
function chooseNaturalHandles(geometricAnswer, inheritedAnswer, fitQuality) {
  const errorRatio =
    fitQuality.perpendicularRms / Math.max(fitQuality.chordLength, 1);
  const errorConfidence =
    1 / (1 + Math.pow(errorRatio / 0.02, 6));

  const nonnegativeDeterminant = Math.max(fitQuality.determinant, 0);
  const rankScale =
    nonnegativeDeterminant +
    1e-6 * fitQuality.trace * fitQuality.trace;
  const rankConfidence =
    rankScale === 0 ? 0 : nonnegativeDeterminant / rankScale;

  const geometricConfidence = errorConfidence * rankConfidence;

  return interpolateHandleLengths(
    inheritedAnswer,
    geometricAnswer,
    geometricConfidence
  );
}
```

This blend is not a motion correction. It is computed only from the current segment's
representability. A mathematical offset that fits well receives the geometric answer.
An impossible offset cannot drag the outline into a collapsed or crossed solution merely
because its raw coordinates are far away.

The constants are global model constants. They cannot vary by glyph, side, mode, or
fixture. The values above come from the initial disposable prototype:

- `U^1` single-sided tension sweep: worst unrounded handle step about `1.14` units,
  with no backtracking;
- circular offsets: approximately `0.03–0.05` units maximum deviation;
- tested S-curves: approximately `2.38` units;
- tested tight turn: approximately `0.52` units;
- tested shallow wide offset: approximately `0.18` units;
- tested unequal-handle curve: approximately `0.29` units.

These measurements establish feasibility. The committed implementation must reproduce
them through repository tests before replacing the current construction.

### 5.7 Authored-handle layer

The natural answer is followed by the existing authored semantics in one explicit layer:

```js
function applyAuthoredHandleState(naturalHandles, authoredState, frame) {
  const attached = applyAttachedHandleAdjustments(
    naturalHandles,
    authoredState,
    frame
  );

  const curvaturePinned = authoredState.hasPinnedCurvature
    ? setHarmonicMeanTension(
        attached,
        authoredState.pinnedCurvature,
        frame
      )
    : attached;

  return replaceDetachedHandles(
    curvaturePinned,
    authoredState,
    frame
  );
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
  const offsetSamples = buildRequestedOffsetSamples(input);

  const geometricAnswer = solveGeometricHandles(
    frame,
    offsetSamples,
    handleDomain
  );
  const inheritedAnswer = transferSkeletonTensions(
    input.skeletonCurve,
    frame,
    handleDomain
  );
  const naturalHandles = chooseNaturalHandles(
    geometricAnswer.handles,
    inheritedAnswer,
    geometricAnswer.fitQuality
  );
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
    -> requested offset samples
    -> geometric answer + inherited answer
    -> continuous representability blend
    -> authored handle state
    -> emitted cubic
```

No downstream stage asks how an upstream answer was obtained.

## 7. Code boundaries

### 7.1 Natural-handle solver

Add one focused geometry module beside the existing cubic construction module. It owns:

- fixed offset sampling;
- quadratic-system assembly;
- exact two-variable constrained minimization;
- inherited-tension transfer;
- representability scoring;
- the natural-handle blend.

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
 * @property {number} geometricConfidence
 * @property {number} perpendicularRms
 */
```

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

The new implementation must meet the current ceilings. It must also record the
representability confidence so failures distinguish a bad geometric fit from an
intentional inherited-shape result.

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
5. Implement inherited-tension transfer and representability scoring.
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

### Fixed subdivision

Emit multiple cubics for every skeleton cubic.

This can improve approximation, but it changes point topology, provenance, interpolation,
and all segment-level controls. It is unnecessary for the reported problem.

## 11. Completion criteria

The feature is complete when:

1. The current iterative correction and split-search machinery is absent from the automatic
   path.
2. `U^1` sweeps without generated-handle jumps or rebound in every supported width mode.
3. Generated directions remain skeleton-owned.
4. Existing accuracy ceilings pass.
5. Authored handle behavior remains unchanged.
6. Point counts and interpolation remain stable.
7. Core tests and the production bundle pass.
8. The standing architecture and feature-model documents describe the new pipeline.
