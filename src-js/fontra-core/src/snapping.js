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

export const SNAP_PARAMETERS_DEFAULTS = Object.freeze({
  reachPixels: 12,
  holdBonus: 1.3,
  noSnapPull: 0.15,
  pointerWeight: 0.5,
  pointerFalloffReaches: 8,
  overruleMargin: 1.6,
  overruleFrames: 4,
  weights: Object.freeze({
    [KIND.METRIC]: 1.0,
    [KIND.GUIDE_INTERSECTION]: 0.84,
    [KIND.GUIDE_ORTHOGONAL]: 0.8,
    [KIND.GUIDE_SLANTED]: 0.76,
    [KIND.SMART_INTERSECTION_ORTHOGONAL]: 0.52,
    [KIND.SMART_INTERSECTION_SLANTED]: 0.48,
    [KIND.SMART_ORTHOGONAL]: 0.44,
    [KIND.SMART_SLANTED]: 0.4,
    [KIND.OTHER]: 0.3,
  }),
});

export const CULL_PARAMETERS_DEFAULTS = Object.freeze({
  collectionRadiusPixels: 400,
  perSideCount: 1,
  maxCandidates: 200,
});

// The live numbers. Every reader below takes them from here, so the tuning panel
// can move one and the next frame answers with it. Reset restores the defaults.
export const SNAP_PARAMETERS = {
  ...SNAP_PARAMETERS_DEFAULTS,
  weights: { ...SNAP_PARAMETERS_DEFAULTS.weights },
};

export const CULL_PARAMETERS = { ...CULL_PARAMETERS_DEFAULTS };

export function setSnapParameter(path, value) {
  if (path.startsWith("weights.")) {
    SNAP_PARAMETERS.weights[path.slice("weights.".length)] = value;
  } else if (path in CULL_PARAMETERS) {
    CULL_PARAMETERS[path] = value;
  } else {
    SNAP_PARAMETERS[path] = value;
  }
}

export function resetSnapParameters() {
  Object.assign(SNAP_PARAMETERS, SNAP_PARAMETERS_DEFAULTS);
  SNAP_PARAMETERS.weights = { ...SNAP_PARAMETERS_DEFAULTS.weights };
  Object.assign(CULL_PARAMETERS, CULL_PARAMETERS_DEFAULTS);
}

function falloff(u) {
  return u >= 1 ? 0 : 1 - u * u;
}

function sameCandidate(a, b) {
  if (!a || !b || a.type !== b.type || a.kind !== b.kind) {
    return false;
  }
  if (a.type === "point") {
    return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  }
  const parallel = Math.abs(a.dx * b.dy - a.dy * b.dx) < 1e-9;
  return parallel && Math.abs((b.x - a.x) * a.dy - (b.y - a.y) * a.dx) < 1e-9;
}

export function candidatePull(candidate, cursor, { pixelUnit, held }) {
  const reach = SNAP_PARAMETERS.reachPixels * pixelUnit;
  const weight =
    SNAP_PARAMETERS.weights[candidate.kind] ?? SNAP_PARAMETERS.weights[KIND.OTHER];
  const bonus = sameCandidate(candidate, held) ? SNAP_PARAMETERS.holdBonus : 1;
  return weight * bonus * falloff(distanceToCandidate(candidate, cursor) / reach);
}

export function resolveSnap(candidates, cursor, options) {
  const { constraint } = options;
  if (constraint) {
    // The constraint is a held line, so the gesture already stands at one degree of
    // freedom and the search below looks for the second. Shift is not overruled.
    const onConstraint = projectOntoLine(constraint, cursor);
    for (const candidate of candidates) {
      if (candidate.type !== "line") {
        continue;
      }
      if (candidatePull(candidate, cursor, options) <= SNAP_PARAMETERS.noSnapPull) {
        continue;
      }
      const crossing = crossLines(constraint, candidate);
      if (!crossing) {
        continue;
      }
      const pull = candidatePull(crossing, cursor, options);
      if (pull > SNAP_PARAMETERS.noSnapPull) {
        return {
          position: { x: crossing.x, y: crossing.y },
          pull,
          held: [candidate],
          freedom: "point",
        };
      }
    }
    return { position: onConstraint, pull: 0, held: [], freedom: "line" };
  }

  const { held } = options;
  // A held candidate is never culled. Sliding far along a guide takes the geometry
  // that produced it out of collection range, and the snap must not drop because
  // of that: the designer is still on the guide they chose.
  const pool =
    held && !candidates.some((candidate) => sameCandidate(candidate, held))
      ? [...candidates, held]
      : candidates;

  const scored = [];
  let near = null;
  for (const candidate of pool) {
    const pull = candidatePull(candidate, cursor, options);
    // The strongest candidate seen, whether or not it beats the floor. This is
    // what the indicator reads to show a snap coming before it takes.
    if (pull > 0 && (!near || pull > near.pull)) {
      near = { candidate, pull };
    }
    if (pull <= SNAP_PARAMETERS.noSnapPull) {
      continue;
    }
    if (scored.some(({ candidate: other }) => sameCandidate(other, candidate))) {
      continue;
    }
    scored.push({ candidate, pull });
  }
  scored.sort((a, b) => b.pull - a.pull);

  if (!scored.length) {
    return {
      position: { ...cursor },
      pull: 0,
      held: [],
      freedom: "free",
      suggestion: null,
      overrule: null,
      near: near
        ? {
            position:
              near.candidate.type === "point"
                ? { x: near.candidate.x, y: near.candidate.y }
                : projectOntoLine(near.candidate, cursor),
            pull: near.pull,
            kind: near.candidate.kind,
          }
        : null,
    };
  }

  // A guide the designer chose is not given up because a heavier one came within
  // range. Two things must both be true before a rival takes over. It must beat
  // the held candidate by a margin, and the designer must be moving away from the
  // guide they hold, for a run of frames. Sliding along a held guide keeps the
  // distance to it at nothing, so a metric crossing the path is only ever a
  // suggestion. Leaving that guide raises the distance every frame, which is what
  // deciding looks like, and then the rival takes the snap.
  let winning = scored[0];
  let suggestion = null;
  let nextOverrule = null;
  const heldEntry = held
    ? scored.find((entry) => sameCandidate(entry.candidate, held))
    : null;
  if (heldEntry) {
    const heldDistance = distanceToCandidate(held, cursor);
    const previous = options.overrule;
    const movingAway =
      previous && Number.isFinite(previous.heldDistance)
        ? heldDistance > previous.heldDistance + 1e-9
        : false;
    let count = 0;
    if (!sameCandidate(winning.candidate, held)) {
      const rival = winning;
      const beatsMargin = rival.pull >= heldEntry.pull * SNAP_PARAMETERS.overruleMargin;
      if (beatsMargin && movingAway) {
        count = sameCandidate(previous?.candidate, rival.candidate)
          ? previous.count + 1
          : 1;
      }
      if (count < SNAP_PARAMETERS.overruleFrames) {
        suggestion = rival.candidate;
        winning = heldEntry;
      }
      nextOverrule = { candidate: rival.candidate, count, heldDistance };
    } else {
      nextOverrule = { candidate: null, count: 0, heldDistance };
    }
  }

  const winner = winning.candidate;
  if (winner.type === "point") {
    return {
      position: { x: winner.x, y: winner.y },
      pull: winning.pull,
      held: winner.sources ? [...winner.sources] : [winner],
      freedom: "point",
      suggestion,
      overrule: nextOverrule,
    };
  }

  for (const { candidate } of scored) {
    if (candidate.type !== "line" || sameCandidate(candidate, winner)) {
      continue;
    }
    const crossing = crossLines(winner, candidate);
    if (!crossing) {
      continue;
    }
    const crossingPull = candidatePull(crossing, cursor, options);
    if (crossingPull > SNAP_PARAMETERS.noSnapPull) {
      return {
        position: { x: crossing.x, y: crossing.y },
        pull: crossingPull,
        held: [winner, candidate],
        freedom: "point",
        suggestion,
        overrule: nextOverrule,
      };
    }
  }

  return {
    position: projectOntoLine(winner, cursor),
    pull: winning.pull,
    held: [winner],
    freedom: "line",
    suggestion,
    overrule: nextOverrule,
  };
}

export function resolveSnapForPoints(candidates, points, cursor, options) {
  const reach = SNAP_PARAMETERS.reachPixels * options.pixelUnit;
  const pointerSpan = reach * SNAP_PARAMETERS.pointerFalloffReaches;
  const noWin = {
    delta: { x: 0, y: 0 },
    pointIndex: -1,
    position: null,
    pull: 0,
    held: [],
    freedom: "free",
    suggestion: null,
    overrule: null,
    near: null,
  };
  let best = { ...noWin };
  let bestScore = 0;

  // The balance between one anchor and the whole selection. At 0 the strongest
  // alignment anywhere takes the drag. In between, each point's pull is discounted
  // by how far that point is from the hand. At 1 the point under the hand is the
  // only one asked, so the end of the slider is an exact behavior and not merely a
  // steep discount.
  let anchorIndex = -1;
  if (SNAP_PARAMETERS.pointerWeight >= 1) {
    let nearest = Infinity;
    points.forEach((point, pointIndex) => {
      const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
      if (distance < nearest) {
        nearest = distance;
        anchorIndex = pointIndex;
      }
    });
  }

  points.forEach((point, pointIndex) => {
    if (anchorIndex >= 0 && pointIndex !== anchorIndex) {
      return;
    }
    // The hold belongs to the pair. A candidate held by another point earns no bonus here.
    const held =
      options.held && options.held.pointIndex === pointIndex
        ? options.held.candidate
        : null;
    const result = resolveSnap(candidates, point, {
      ...options,
      held,
      overrule: held ? options.overrule : null,
    });
    if (!result.held.length) {
      // Nothing took this point, but the strongest near miss still feeds the
      // indicator, so a snap coming is visible before it takes.
      if (result.near && (!best.near || result.near.pull > best.near.pull)) {
        best.near = result.near;
      }
      return;
    }
    const pointerDistance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
    const discount =
      1 - SNAP_PARAMETERS.pointerWeight * Math.min(1, pointerDistance / pointerSpan);
    const score = result.pull * discount;
    if (score > bestScore) {
      bestScore = score;
      best = {
        delta: { x: result.position.x - point.x, y: result.position.y - point.y },
        pointIndex,
        position: result.position,
        pull: result.pull,
        held: result.held,
        freedom: result.freedom,
        suggestion: result.suggestion,
        overrule: result.overrule,
        near: best.near,
      };
    }
  });

  return best;
}

function isOrthogonal(angle) {
  const a = ((angle % 180) + 180) % 180;
  return Math.abs(a) < 1e-9 || Math.abs(a - 90) < 1e-9;
}

function nearestPerSide(sources, cursor, axis) {
  // axis "y": horizontal rays, compared by the source's y. axis "x": vertical rays.
  const above = [];
  const below = [];
  for (const source of sources) {
    (source[axis] >= cursor[axis] ? above : below).push(source);
  }
  const byDistance = (a, b) =>
    Math.abs(a[axis] - cursor[axis]) - Math.abs(b[axis] - cursor[axis]);
  above.sort(byDistance);
  below.sort(byDistance);
  return [
    ...above.slice(0, CULL_PARAMETERS.perSideCount),
    ...below.slice(0, CULL_PARAMETERS.perSideCount),
  ];
}

export function collectCandidates(scene, cursor, { pixelUnit }) {
  const radius = CULL_PARAMETERS.collectionRadiusPixels * pixelUnit;
  const inRadius = (p) => Math.hypot(p.x - cursor.x, p.y - cursor.y) <= radius;
  const candidates = [];

  for (const metric of scene.metrics || []) {
    candidates.push(
      makeLineCandidate({
        x: cursor.x,
        y: metric.value,
        angle: 0,
        kind: metric.kind === "band" ? KIND.OTHER : KIND.METRIC,
        source: { x: cursor.x, y: metric.value },
      })
    );
  }

  for (const guide of scene.guides || []) {
    candidates.push(
      makeLineCandidate({
        x: guide.x,
        y: guide.y,
        angle: guide.angle,
        kind: isOrthogonal(guide.angle) ? KIND.GUIDE_ORTHOGONAL : KIND.GUIDE_SLANTED,
        source: { x: guide.x, y: guide.y },
      })
    );
  }

  const points = (scene.points || []).filter(inRadius);
  for (const source of nearestPerSide(points, cursor, "y")) {
    candidates.push(
      makeLineCandidate({
        x: source.x,
        y: source.y,
        angle: 0,
        kind: KIND.SMART_ORTHOGONAL,
        source,
      })
    );
  }
  for (const source of nearestPerSide(points, cursor, "x")) {
    candidates.push(
      makeLineCandidate({
        x: source.x,
        y: source.y,
        angle: 90,
        kind: KIND.SMART_ORTHOGONAL,
        source,
      })
    );
  }

  for (const segment of (scene.segments || []).filter(inRadius)) {
    candidates.push(
      makeLineCandidate({
        x: segment.x,
        y: segment.y,
        angle: segment.angle,
        kind: isOrthogonal(segment.angle) ? KIND.SMART_ORTHOGONAL : KIND.SMART_SLANTED,
        source: { x: segment.x, y: segment.y },
      })
    );
  }

  candidates.sort((a, b) => {
    const weightDelta =
      (SNAP_PARAMETERS.weights[b.kind] ?? 0) - (SNAP_PARAMETERS.weights[a.kind] ?? 0);
    if (Math.abs(weightDelta) > 1e-12) {
      return weightDelta;
    }
    return distanceToCandidate(a, cursor) - distanceToCandidate(b, cursor);
  });
  return candidates.slice(0, CULL_PARAMETERS.maxCandidates);
}

export function roundSnapped(result, roundFunc) {
  const { position, held, freedom } = result;
  if (freedom === "point") {
    return { ...position };
  }
  if (freedom === "free" || !held.length) {
    return { x: roundFunc(position.x), y: roundFunc(position.y) };
  }
  const line = held[0];
  const along = (position.x - line.x) * line.dx + (position.y - line.y) * line.dy;
  const rounded = roundFunc(along);
  return { x: line.x + rounded * line.dx, y: line.y + rounded * line.dy };
}
