//
// The B drag: a handle moves along its own line, so its length changes and its
// angle does not.
//
// Pure geometry, shared by drawn contours and skeleton centerlines. Both hand
// over plain point lists, where an on-curve point has no `type`.
//

//
// The on-curve point a handle grows from, as an index into `points`, or -1.
//
// A handle belongs to the on-curve next to it. Where both neighbours are
// on-curve points the handle is a single quadratic control point that belongs
// to two on-curves at once, and where neither is it sits inside a quadratic
// chain: moving either along a line turns something else, so neither has an
// owner.
//
export function handleOwnerIndex(points, isClosed, index) {
  const count = points.length;
  if (!points[index]?.type) {
    return -1;
  }
  const neighbour = (offset) => {
    const at = index + offset;
    if (at >= 0 && at < count) {
      return at;
    }
    return isClosed ? (at + count) % count : -1;
  };
  const isOnCurve = (at) => at >= 0 && !points[at].type;
  const previous = neighbour(-1);
  const next = neighbour(1);
  const previousOn = isOnCurve(previous);
  const nextOn = isOnCurve(next);
  if (previousOn === nextOn) {
    return -1;
  }
  return previousOn ? previous : next;
}

//
// Where the handle lands for a pointer that has moved by `delta` since the
// drag started. The movement along the handle's own direction changes its
// length; the movement across it is ignored.
//
// The handle stops on its own on-curve point rather than passing through it,
// because past it the handle would point the opposite way. A handle that
// already lies on its on-curve point has no direction, so it does not move.
//
export function slideHandleAlongItself(owner, handle, delta) {
  const dx = handle.x - owner.x;
  const dy = handle.y - owner.y;
  const length = Math.hypot(dx, dy);
  if (!length) {
    return { x: handle.x, y: handle.y };
  }
  const ux = dx / length;
  const uy = dy / length;
  const newLength = Math.max(0, length + delta.x * ux + delta.y * uy);
  return { x: owner.x + ux * newLength, y: owner.y + uy * newLength };
}
