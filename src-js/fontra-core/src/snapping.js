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

export const MIN_CROSSING_ANGLE_DEG = 15;

const GUIDE_KINDS = new Set([KIND.METRIC, KIND.GUIDE_ORTHOGONAL, KIND.GUIDE_SLANTED]);
const ORTHOGONAL_KINDS = new Set([
  KIND.METRIC,
  KIND.GUIDE_ORTHOGONAL,
  KIND.SMART_ORTHOGONAL,
]);

export function crossLines(a, b) {
  const cross = a.dx * b.dy - a.dy * b.dx;
  const sinLimit = Math.sin((MIN_CROSSING_ANGLE_DEG * Math.PI) / 180);
  if (Math.abs(cross) < sinLimit) {
    return null;
  }
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / cross;
  const x = a.x + t * a.dx;
  const y = a.y + t * a.dy;
  let kind;
  if (GUIDE_KINDS.has(a.kind) && GUIDE_KINDS.has(b.kind)) {
    kind = KIND.GUIDE_INTERSECTION;
  } else if (ORTHOGONAL_KINDS.has(a.kind) && ORTHOGONAL_KINDS.has(b.kind)) {
    kind = KIND.SMART_INTERSECTION_ORTHOGONAL;
  } else {
    kind = KIND.SMART_INTERSECTION_SLANTED;
  }
  return { ...makePointCandidate({ x, y, kind, source: a.source }), sources: [a, b] };
}
