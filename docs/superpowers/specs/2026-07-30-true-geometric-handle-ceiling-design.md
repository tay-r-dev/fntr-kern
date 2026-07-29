# True Geometric Handle Ceiling

**Date:** 2026-07-30  
**Status:** Approved

## Problem

The continuous outline solver uses a stabilized `reach` as both:

1. the coordinate scale for normalized handle tension; and
2. the maximum non-crossing handle length.

Those roles disagree when a forward tangent intersection lies closer than one
third of the outline chord. The stabilized reach is raised to the chord floor,
so a normalized tension at or below 1 can still place the handle beyond the real
tangent intersection. The generated curve then has a geometric handle tension
above 1 even though the solver reports that its answer is inside the
"non-crossing" domain.

The curvature label has a separate read-path error: it passes
`[onCurve, control1, control2, onCurve]` directly to a function whose arguments
are `[control1, onCurve, control2, onCurve]`. This further inflates the displayed
segment tension.

Grid rounding can move a boundary handle fractionally past its ceiling, but that
is deliberately outside this correction.

## Design

Keep the existing stabilized reach as the solver's coordinate scale:

```text
scaleReach = clamp(realForwardReach, chord / 3, chord * 2)
```

Give the domain a separate per-end maximum normalized tension:

```text
maxTension =
    realForwardReach > epsilon
        ? min(1, realForwardReach / scaleReach)
        : 1
```

The resulting maximum emitted length is:

```text
maxTension * scaleReach <= realForwardReach
```

For a forward intersection between the floor and cap, this reduces to the
existing maximum tension of 1. For a forward intersection below the floor, the
normalization remains stable while the maximum tension falls below 1. For a
forward intersection beyond the cap, the cap remains the conservative maximum.
Parallel or behind intersections have no forward crossing ceiling and retain
the existing chord-cap fallback with maximum tension 1.

The one-unit minimum is also expressed in the same domain, but it cannot exceed
the maximum:

```text
minTension = min(1 / scaleReach, maxTension)
```

Therefore, if a real forward reach is shorter than one unit, non-crossing wins
and the only feasible boundary length is the real reach. This is preferable to
creating a loop merely to preserve a direction that cannot be represented on
the integer grid.

`getGeneratedSegmentCurvature` will pass the control and on-curve points in the
canonical order expected by `calculateSegmentTension`. No rounding compensation
or label clamping will be added.

## Scope

The correction changes only:

- construction of the shared handle domain;
- consumers that already honor its per-end minimum and maximum;
- the generated-curvature tension read;
- focused unit and generator regressions;
- architecture documentation whose current wording equates stabilized reach
  with the true tangent intersection.

It does not change fixed samples, the quadratic objective, the reference pull,
handle directions, grid emission, topology, provenance, caps, corners, detached
handles, or stored curvature values.

## Tests

Tests will prove:

1. a short positive forward reach retains the stabilized scale but produces a
   smaller maximum tension whose length equals the true intersection;
2. the minimum never exceeds that maximum when the true reach is below one unit;
3. the refreshed `c`-shaped tapered geometry generates unrounded automatic
   handles no farther than the true forward intersection;
4. generated-curvature labels use the canonical segment-tension argument order;
5. existing behind, parallel, ordinary, taper, continuity, mirror, reversal,
   authored-adjustment, and pin behavior remains green.

