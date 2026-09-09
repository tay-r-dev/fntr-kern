import { buildHandleDomain, solveNaturalHandles } from "./natural-handle-solver.js";
import { shiftTensionsToMean } from "./tunni-calculations.js";

// The floor on handle length is the generator's own, and it holds only for the
// generator's own answer: below it the solved handle stops holding still and
// starts riding along with the rib end. A hand on the handle outranks that —
// an authored offset, a detached placement and a pinned curvature may all put a
// handle exactly on its point, because zero is a legal setting.
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

function applyAttachedAdjustments(handles, request, domain) {
  const byHand = (adjustment) => !!adjustment && !adjustment.detached;
  const attached = (adjustment, anchor, direction, length) =>
    !byHand(adjustment) ? length : placedLength(anchor, direction, adjustment, length);
  return constrain(
    {
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
    },
    domain,
    {
      startByHand: byHand(request.startAdjustment),
      endByHand: byHand(request.endAdjustment),
    }
  );
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

function applyDetachedHandles(handles, request) {
  return {
    startLength: request.startAdjustment?.detached
      ? Math.max(placedLength(request.q0, request.u0, request.startAdjustment), 0)
      : handles.startLength,
    endLength: request.endAdjustment?.detached
      ? Math.max(placedLength(request.q3, request.u1, request.endAdjustment), 0)
      : handles.endLength,
  };
}

export function offsetCubicSide(request) {
  const domain = buildHandleDomain(request.q0, request.q3, request.u0, request.u1, {
    startNudge: request.startHandleNudge || 0,
    endNudge: request.endHandleNudge || 0,
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
  const placed = applyDetachedHandles(attached, request);
  // How much of each attached adjustment survived the ceiling. A stored offset
  // is a request, and the clamp above can refuse most of it; a caller that
  // keeps the request has to be able to see what was granted, or the store
  // climbs past the ceiling and a drag back does nothing until it returns.
  // Measured before the pin, because the pin is a separate contribution that
  // its own callers already account for.
  return {
    ...applyPinnedTension(placed, request.pinnedTension, domain),
    honoredStartAdjustment: attached.startLength - natural.startLength,
    honoredEndAdjustment: attached.endLength - natural.endLength,
  };
}
