import { buildHandleDomain, solveNaturalHandles } from "./natural-handle-solver.js";
import { shiftTensionsToMean } from "./tunni-calculations.js";

const MIN_HANDLE_LENGTH = 1;

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

function constrain(handles, domain) {
  const tensions = lengthsToTensions(handles, domain);
  return tensionsToLengths(
    {
      start: clamp(tensions.start, domain.minStartTension, domain.maxStartTension),
      end: clamp(tensions.end, domain.minEndTension, domain.maxEndTension),
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
  const attached = (adjustment, anchor, direction, length) =>
    !adjustment || adjustment.detached
      ? length
      : placedLength(anchor, direction, adjustment, length);
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
    domain
  );
}

function applyPinnedTension(handles, pinnedTension, domain) {
  if (!Number.isFinite(pinnedTension)) {
    return handles;
  }
  return constrain(
    tensionsToLengths(
      shiftTensionsToMean(lengthsToTensions(handles, domain), pinnedTension, 1),
      domain
    ),
    domain
  );
}

function applyDetachedHandles(handles, request) {
  return {
    startLength: request.startAdjustment?.detached
      ? Math.max(
          placedLength(request.q0, request.u0, request.startAdjustment),
          MIN_HANDLE_LENGTH
        )
      : handles.startLength,
    endLength: request.endAdjustment?.detached
      ? Math.max(
          placedLength(request.q3, request.u1, request.endAdjustment),
          MIN_HANDLE_LENGTH
        )
      : handles.endLength,
  };
}

export function offsetCubicSide(request) {
  const domain = buildHandleDomain(request.q0, request.q3, request.u0, request.u1);
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
  const attached = applyAttachedAdjustments(natural, request, domain);
  const pinned = applyPinnedTension(attached, request.pinnedTension, domain);
  return applyDetachedHandles(pinned, request);
}
