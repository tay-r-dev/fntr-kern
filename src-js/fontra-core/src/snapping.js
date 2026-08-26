export const KIND = Object.freeze({
  METRIC: "metric",
  GUIDE_INTERSECTION: "guideIntersection",
  GUIDE_ORTHOGONAL: "guideOrthogonal",
  GUIDE_SLANTED: "guideSlanted",
  SMART_INTERSECTION_ORTHOGONAL: "smartIntersectionOrthogonal",
  SMART_INTERSECTION_SLANTED: "smartIntersectionSlanted",
  SMART_ORTHOGONAL: "smartOrthogonal",
  SMART_SLANTED: "smartSlanted",
  OTHER: "other",
});

export function makeLineCandidate({ x, y, angle, kind, source }) {
  const radians = (angle * Math.PI) / 180;
  return {
    type: "line",
    x,
    y,
    dx: Math.cos(radians),
    dy: Math.sin(radians),
    kind,
    source: source || { x, y },
  };
}

export function makePointCandidate({ x, y, kind, source }) {
  return { type: "point", x, y, kind, source: source || { x, y } };
}

export function projectOntoLine(candidate, point) {
  const vx = point.x - candidate.x;
  const vy = point.y - candidate.y;
  const along = vx * candidate.dx + vy * candidate.dy;
  return {
    x: candidate.x + along * candidate.dx,
    y: candidate.y + along * candidate.dy,
  };
}

export function distanceToCandidate(candidate, point) {
  if (candidate.type === "point") {
    return Math.hypot(point.x - candidate.x, point.y - candidate.y);
  }
  const foot = projectOntoLine(candidate, point);
  return Math.hypot(point.x - foot.x, point.y - foot.y);
}
