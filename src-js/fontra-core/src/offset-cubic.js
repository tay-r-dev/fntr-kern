import { buildHandleDomain, solveNaturalHandles } from "./natural-handle-solver.js";
import { shiftTensionsToMean } from "./tunni-calculations.js";

// The floor on handle length is the generator's own, and it holds only for the
// generator's own answer: below it the solved handle stops holding still and
// starts riding along with the rib end. A hand on the handle outranks that —
// an authored offset, a detached placement and a pinned curvature may all put a
// handle exactly on its point, because zero is a legal setting. The point it
// lands on is the DRAWN one, so where emission slides the on-curve out from
// under the handle, that hand floor sits a slide below the constructed zero:
// `handFloor*Tension` in the domain.
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function lengthsToTensions(handles, domain) {
  return {
    start: handles.startLength / domain.startReach,
    end: handles.endLength / domain.endReach,
  };
}

function tensionsToLengths(tensions, domain) {
  return {
    startLength: tensions.start * domain.startReach,
    endLength: tensions.end * domain.endReach,
  };
}

function constrain(handles, domain, { startByHand = false, endByHand = false } = {}) {
  const tensions = lengthsToTensions(handles, domain);
  return tensionsToLengths(
    {
      start: clamp(
        tensions.start,
        startByHand ? 0 : domain.minStartTension,
        domain.maxStartTension
      ),
      end: clamp(
        tensions.end,
        endByHand ? 0 : domain.minEndTension,
        domain.maxEndTension
      ),
    },
    domain
  );
}

// Authored handles are resolved on the grid: the point a designer placed must
// remain the point they see. The natural solver itself stays in floating point.
function placedLength(anchor, direction, adjustment, baseLength = 0) {
  const base = {
    x: anchor.x + direction.x * baseLength,
    y: anchor.y + direction.y * baseLength,
  };
  const placed = {
    x: Math.round(base.x + (adjustment.x || 0)),
    y: Math.round(base.y + (adjustment.y || 0)),
  };
  return (placed.x - anchor.x) * direction.x + (placed.y - anchor.y) * direction.y;
}

// What a hand asked for below the construction's own zero. Emission slides the
// on-curve along its edge and leaves the handles, so the drawn handle is longer
// than the constructed one by that slide, and the drawn handle reaches its own
// point only where the constructed one goes behind its rib point. A negative
// constructed length is not a curve anyone solves: the pin, the tension identity
// and the domain all read it as a length, so the curvature gizmo measured one
// number and the generator reproduced another, and a bare grab jumped.
//
// So the construction keeps its floor at zero and the remainder is handed to
// emission, which is where every other slide already lives. The handle lands
// exactly where the designer put it, the construction segment stays a curve, and
// the gizmo's reader takes this slide off with the rest (rail R-D: it is
// published, never recovered).
function slideBelowFloor(requestedLength, anchor, direction, floorTension, reach) {
  if (requestedLength >= 0) {
    return null;
  }
  const length = Math.max(requestedLength, Math.min(floorTension * reach, 0));
  if (!(length < 0)) {
    return null;
  }
  // The construction handle sits exactly on its rib point whenever this fires,
  // and emission rounds that point before adding the slide. Measure from the
  // rounded point, so the sum is the grid position the designer placed.
  const rounded = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
  return {
    length,
    displacement: {
      x: anchor.x + direction.x * length - rounded.x,
      y: anchor.y + direction.y * length - rounded.y,
    },
  };
}

function applyAttachedAdjustments(handles, request, domain) {
  const byHand = (adjustment) => !!adjustment && !adjustment.detached;
  const attached = (adjustment, anchor, direction, length) =>
    !byHand(adjustment) ? length : placedLength(anchor, direction, adjustment, length);
  const requested = {
    startLength: attached(
      request.startAdjustment,
      request.q0,
      request.u0,
      handles.startLength
    ),
    endLength: attached(
      request.endAdjustment,
      request.q3,
      request.u1,
      handles.endLength
    ),
  };
  return {
    lengths: constrain(requested, domain, {
      startByHand: byHand(request.startAdjustment),
      endByHand: byHand(request.endAdjustment),
    }),
    startSlide: byHand(request.startAdjustment)
      ? slideBelowFloor(
          requested.startLength,
          request.q0,
          request.u0,
          domain.handFloorStartTension,
          domain.startReach
        )
      : null,
    endSlide: byHand(request.endAdjustment)
      ? slideBelowFloor(
          requested.endLength,
          request.q3,
          request.u1,
          domain.handFloorEndTension,
          domain.endReach
        )
      : null,
  };
}

// A pin is written by the curvature gizmo, which measures each handle against
// its own true tangent intersection: one is the Tunni point at either end, and
// the pin is the harmonic mean of the two in that unit.
//
// The domain's reach is a stable coordinate scale, not that intersection. Where
// it is clamped the intersection sits at the end's ceiling instead of at one, so
// a tension read against the reach is a different number from the one the gizmo
// wrote. Shifting against the reach therefore aimed at a mean nobody asked for,
// and the first pin on a segment outside the clamp band snapped the curve; the
// clamp then hid the rest of the error, so later drags looked well behaved.
//
// Rescale onto the ceiling, where both ends read one at the tangent
// intersection and the gizmo's number means what it says, shift there, and
// rescale back.
function applyPinnedTension(handles, pinnedTension, domain) {
  if (!Number.isFinite(pinnedTension)) {
    return handles;
  }
  // The unit is the tangent intersection of the curve the generator solved,
  // which is what the gizmo measured. Not the ceiling: emission can slide a
  // handle, and the ceiling moves with that slide while the gizmo's number does
  // not. Rescaling by the ceiling made the pin mean a different thing on any
  // segment whose handles are nudged.
  const startUnit = domain.intersectionStartTension ?? domain.maxStartTension;
  const endUnit = domain.intersectionEndTension ?? domain.maxEndTension;
  const tensions = lengthsToTensions(handles, domain);
  const shifted = shiftTensionsToMean(
    {
      start: tensions.start / startUnit,
      end: tensions.end / endUnit,
    },
    pinnedTension,
    1
  );
  return constrain(
    tensionsToLengths(
      {
        start: shifted.start * startUnit,
        end: shifted.end * endUnit,
      },
      domain
    ),
    domain,
    // A pin is the curvature gizmo's own statement about this segment, so it
    // may take either handle all the way down.
    { startByHand: true, endByHand: true }
  );
}

// A detached handle is absolute, and it reaches below the construction's zero
// the same way an attached one does: through emission, not through a negative
// constructed length.
function applyDetachedHandles(handles, slides, request, domain) {
  const place = (adjustment, anchor, direction, floorTension, reach, length) => {
    if (!adjustment?.detached) {
      return { length, slide: null };
    }
    const requested = placedLength(anchor, direction, adjustment);
    return {
      length: Math.max(requested, 0),
      slide: slideBelowFloor(requested, anchor, direction, floorTension, reach),
    };
  };
  const start = place(
    request.startAdjustment,
    request.q0,
    request.u0,
    domain.handFloorStartTension,
    domain.startReach,
    handles.startLength
  );
  const end = place(
    request.endAdjustment,
    request.q3,
    request.u1,
    domain.handFloorEndTension,
    domain.endReach,
    handles.endLength
  );
  return {
    lengths: { startLength: start.length, endLength: end.length },
    startSlide: request.startAdjustment?.detached ? start.slide : slides.startSlide,
    endSlide: request.endAdjustment?.detached ? end.slide : slides.endSlide,
  };
}

export function offsetCubicSide(request) {
  const domain = buildHandleDomain(request.q0, request.q3, request.u0, request.u1, {
    startNudge: request.startHandleNudge || 0,
    endNudge: request.endHandleNudge || 0,
    startOnCurveSlide: request.startOnCurveSlide || 0,
    endOnCurveSlide: request.endOnCurveSlide || 0,
  });
  const natural = solveNaturalHandles({
    skeletonControlPoints: [request.p0, request.p1, request.p2, request.p3],
    startSignedWidth: request.d0,
    endSignedWidth: request.d3,
    startOutlinePoint: request.q0,
    endOutlinePoint: request.q3,
    startHandleDirection: request.u0,
    endHandleDirection: request.u1,
    handleDomain: domain,
  });
  // Both kinds of adjustment place a handle, and the pin then states what the
  // segment's tension is. Running the detached placement last instead made it
  // overwrite the pin, so the gizmo did nothing on a detached handle.
  const attached = applyAttachedAdjustments(natural, request, domain);
  const placed = applyDetachedHandles(attached.lengths, attached, request, domain);
  // How much of each attached adjustment survived the ceiling. A stored offset
  // is a request, and the clamp above can refuse most of it; a caller that
  // keeps the request has to be able to see what was granted, or the store
  // climbs past the ceiling and a drag back does nothing until it returns.
  // Measured before the pin, because the pin is a separate contribution that
  // its own callers already account for.
  // A slide below the floor was granted in full, so it counts as honored: the
  // handle is where the designer put it, and a caller that trims its stored
  // request against this number must not claw that part back.
  const granted = (slide) => slide?.length ?? 0;
  return {
    ...applyPinnedTension(placed.lengths, request.pinnedTension, domain),
    startSlide: placed.startSlide?.displacement ?? null,
    endSlide: placed.endSlide?.displacement ?? null,
    honoredStartAdjustment:
      attached.lengths.startLength + granted(placed.startSlide) - natural.startLength,
    honoredEndAdjustment:
      attached.lengths.endLength + granted(placed.endSlide) - natural.endLength,
  };
}
