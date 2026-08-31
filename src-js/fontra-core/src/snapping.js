// A kind is a direction, not a source. Two lines that run the same way pull the
// same, whether one came from a guide the designer placed, a font metric, a
// point's own ray or a skeleton rib end. What the source was decides how the
// line is DRAWN - that travels as the `permanent` flag - and it decides nothing
// about who wins. The three exceptions below are not directions: each is a class
// of source the designer switches on and off as a whole.
export const KIND = Object.freeze({
  ORTHOGONAL: "orthogonal",
  DIAGONAL: "diagonal",
  INTERSECTION: "intersection",
  // Off-curve points. Their own kind because they are their own switch: a handle
  // states a direction rather than a place, so aligning to one is a choice.
  OFF_CURVE: "offCurve",
  // The generated geometry that follows the very thing being dragged. It moves
  // with the drag, so it is weightless by default and never wins; raise the
  // weight to snap a point to the outline it is making.
  OWN_GENERATED: "ownGenerated",
  // Everything that is present and deliberately weak: an alignment zone's band.
  OTHER: "other",
});

export function makeLineCandidate({ x, y, angle, kind, source, permanent }) {
  const radians = (angle * Math.PI) / 180;
  return {
    type: "line",
    x,
    y,
    dx: Math.cos(radians),
    dy: Math.sin(radians),
    kind,
    permanent: !!permanent,
    source: source || { x, y },
  };
}

export function makePointCandidate({ x, y, kind, source, permanent }) {
  return {
    type: "point",
    x,
    y,
    kind,
    permanent: !!permanent,
    source: source || { x, y },
  };
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

function kindWeight(kind) {
  return SNAP_PARAMETERS.weights[kind] ?? SNAP_PARAMETERS.weights[KIND.OTHER];
}

export function crossLines(a, b) {
  // A line that pulls nothing cannot help form a point. Without this a
  // weightless kind would come back at the intersection weight, and setting a
  // weight to zero would not mean what it says.
  if (!kindWeight(a.kind) || !kindWeight(b.kind)) {
    return null;
  }
  const cross = a.dx * b.dy - a.dy * b.dx;
  const sinLimit = Math.sin((MIN_CROSSING_ANGLE_DEG * Math.PI) / 180);
  if (Math.abs(cross) < sinLimit) {
    return null;
  }
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / cross;
  const x = a.x + t * a.dx;
  const y = a.y + t * a.dy;
  // A crossing is one kind. Two constraints met at once is the fact worth
  // weighing; which two directions produced it is not.
  return {
    ...makePointCandidate({
      x,
      y,
      kind: KIND.INTERSECTION,
      source: a.source,
      permanent: a.permanent && b.permanent,
    }),
    sources: [a, b],
  };
}

export const SNAP_PARAMETERS_DEFAULTS = Object.freeze({
  reachPixels: 12,
  holdBonus: 1.3,
  noSnapPull: 0.15,
  pointerWeight: 0.5,
  pointerFalloffReaches: 8,
  overruleMargin: 1.6,
  overruleFrames: 4,
  acquireSpeedPixels: 600,
  escapeSpeedPixels: 1400,
  // Switches, held as 0 or 1 so that they persist and reset through the same
  // path every other number does.
  //
  // Slanted candidates are off. A diagonal alignment is a rarer intent than an
  // upright one, and offered by default it takes the cursor on the way past far
  // more often than it is wanted. The key that holds diagonals on is separate:
  // it asks for them ALONE, which is what makes it worth pressing.
  diagonalsEnabled: 0,
  // Off-curve points cast no rays until asked. A handle states a direction
  // rather than a place.
  offCurveSources: 0,
  // A fixed-rib drag pins one edge and follows the cursor with the other, so a
  // snap moving the point is fighting the gesture. Off, with a switch, because
  // the drag is also the one place a designer might want the width to land on a
  // metric.
  snapDuringFixedRib: 0,
  // Per-kind reach, as a multiple of reachPixels. This is what lets reach and
  // precedence move apart: a kind can grab from further away without also winning
  // ties it should lose, which raising its weight would do.
  reaches: Object.freeze({
    [KIND.ORTHOGONAL]: 1,
    [KIND.DIAGONAL]: 1,
    [KIND.INTERSECTION]: 1,
    [KIND.OFF_CURVE]: 1,
    [KIND.OWN_GENERATED]: 1,
    [KIND.OTHER]: 1,
  }),
  weights: Object.freeze({
    [KIND.ORTHOGONAL]: 1.0,
    [KIND.DIAGONAL]: 0.8,
    // A crossing meets two constraints at once, so it stands just above either
    // of them on its own.
    [KIND.INTERSECTION]: 1.05,
    [KIND.OFF_CURVE]: 0.7,
    // Zero: present, collected, reported in the readout, and never winning
    // until the designer asks for it.
    [KIND.OWN_GENERATED]: 0,
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
  reaches: { ...SNAP_PARAMETERS_DEFAULTS.reaches },
  weights: { ...SNAP_PARAMETERS_DEFAULTS.weights },
};

export const CULL_PARAMETERS = { ...CULL_PARAMETERS_DEFAULTS };

// A parameter has two writers - the panel, and the keys that toggle a switch
// mid-gesture - so the panel is told when something else moved one. Otherwise a
// checkbox goes on saying "off" about a switch that is on.
const parameterListeners = new Set();

export function subscribeSnapParameters(listener) {
  parameterListeners.add(listener);
  return () => parameterListeners.delete(listener);
}

function notifySnapParameters() {
  for (const listener of parameterListeners) {
    listener();
  }
}

export function setSnapParameter(path, value) {
  if (path.startsWith("reaches.")) {
    SNAP_PARAMETERS.reaches[path.slice("reaches.".length)] = value;
  } else if (path.startsWith("weights.")) {
    SNAP_PARAMETERS.weights[path.slice("weights.".length)] = value;
  } else if (path in CULL_PARAMETERS) {
    CULL_PARAMETERS[path] = value;
  } else {
    SNAP_PARAMETERS[path] = value;
  }
  notifySnapParameters();
}

export function resetSnapParameters() {
  Object.assign(SNAP_PARAMETERS, SNAP_PARAMETERS_DEFAULTS);
  SNAP_PARAMETERS.reaches = { ...SNAP_PARAMETERS_DEFAULTS.reaches };
  SNAP_PARAMETERS.weights = { ...SNAP_PARAMETERS_DEFAULTS.weights };
  Object.assign(CULL_PARAMETERS, CULL_PARAMETERS_DEFAULTS);
  notifySnapParameters();
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

export function reachForKind(kind, pixelUnit) {
  return SNAP_PARAMETERS.reachPixels * (SNAP_PARAMETERS.reaches[kind] ?? 1) * pixelUnit;
}

export function candidatePull(candidate, cursor, { pixelUnit, held }) {
  const reach = reachForKind(candidate.kind, pixelUnit);
  const weight = kindWeight(candidate.kind);
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

  const { held, pixelUnit } = options;
  const speed = options.speed || 0;
  // Below this the designer is placing, above it they are travelling. Inkscape
  // postpones snapping the same way while the pointer is moving, which is what
  // stops a guide swept past from grabbing the cursor on the way by.
  const settled = speed <= SNAP_PARAMETERS.acquireSpeedPixels;

  const heldDistance = held ? distanceToCandidate(held, cursor) : 0;
  const previous = options.overrule;
  const movingAway =
    held && previous && Number.isFinite(previous.heldDistance)
      ? heldDistance > previous.heldDistance + 1e-9
      : false;

  // The escape is a gesture in two parts, and both are needed so that ordinary
  // dragging cannot perform it by accident. Settling on a guide arms it. Leaving
  // that guide fast, while armed, breaks free. The candidate escaped from is then
  // refused until the cursor has left its reach, or it would take the point back
  // on the next frame.
  const escapeIn = options.escape || { armed: false, refused: null };
  let escapeOut = { armed: escapeIn.armed, refused: escapeIn.refused };
  if (
    escapeOut.refused &&
    distanceToCandidate(escapeOut.refused, cursor) >
      reachForKind(escapeOut.refused.kind, pixelUnit)
  ) {
    escapeOut.refused = null;
  }
  if (!held) {
    escapeOut.armed = false;
  } else if (settled) {
    escapeOut.armed = true;
  } else if (
    escapeOut.armed &&
    movingAway &&
    speed > SNAP_PARAMETERS.escapeSpeedPixels
  ) {
    return {
      position: { ...cursor },
      pull: 0,
      held: [],
      freedom: "free",
      suggestion: null,
      overrule: null,
      near: null,
      escape: { armed: false, refused: held },
      escaped: held,
    };
  }

  // A held candidate is never culled. Sliding far along a guide takes the geometry
  // that produced it out of collection range, and the snap must not drop because
  // of that: the designer is still on the guide they chose.
  let pool = escapeOut.refused
    ? candidates.filter((candidate) => !sameCandidate(candidate, escapeOut.refused))
    : candidates;
  if (held && !pool.some((candidate) => sameCandidate(candidate, held))) {
    pool = [...pool, held];
  }
  // Travelling: whatever is already held stays, and nothing new is taken up.
  if (!settled) {
    pool = held ? [held] : [];
  }

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
      escape: escapeOut,
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
      escape: escapeOut,
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
        escape: escapeOut,
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
    escape: escapeOut,
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
    escape: options.escape || null,
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
      escape: held ? options.escape : null,
    });
    if (held) {
      // Only the point that holds owns the escape state; the rest were never on
      // a guide to break free of.
      best.escape = result.escape;
    }
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
        escape: result.escape,
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
  // A source marked `alwaysKeep` is not entered into the contest at all. The cull
  // keeps whichever ray stands nearest the cursor, which is the right answer for
  // a glyph full of unrelated geometry and the wrong one for the very contour the
  // drag came from: its own neighbours are what the designer is aligning to, and
  // any nearer point elsewhere would hide them.
  const kept = [];
  const contested = [];
  for (const source of sources) {
    (source.alwaysKeep ? kept : contested).push(source);
  }
  const above = [];
  const below = [];
  for (const source of contested) {
    (source[axis] >= cursor[axis] ? above : below).push(source);
  }
  const byDistance = (a, b) =>
    Math.abs(a[axis] - cursor[axis]) - Math.abs(b[axis] - cursor[axis]);
  above.sort(byDistance);
  below.sort(byDistance);
  return [
    ...kept,
    ...above.slice(0, CULL_PARAMETERS.perSideCount),
    ...below.slice(0, CULL_PARAMETERS.perSideCount),
  ];
}

// What slanted candidates the frame is allowed. "off" and "on" come from the
// switch; "only" comes from the key held down, and overrules the switch in both
// directions - the point of the key is to clear the upright ones out of the way.
function diagonalFilter(mode) {
  const resolved = mode || (SNAP_PARAMETERS.diagonalsEnabled ? "on" : "off");
  if (resolved === "only") {
    return (candidate) => candidate.kind === KIND.DIAGONAL;
  }
  if (resolved === "on") {
    return () => true;
  }
  return (candidate) => candidate.kind !== KIND.DIAGONAL;
}

export function collectCandidates(scene, cursor, { pixelUnit, diagonals }) {
  const radius = CULL_PARAMETERS.collectionRadiusPixels * pixelUnit;
  const inRadius = (p) => Math.hypot(p.x - cursor.x, p.y - cursor.y) <= radius;
  const candidates = [];

  for (const metric of scene.metrics || []) {
    candidates.push(
      makeLineCandidate({
        x: cursor.x,
        y: metric.value,
        angle: 0,
        kind: metric.kind === "band" ? KIND.OTHER : KIND.ORTHOGONAL,
        source: { x: cursor.x, y: metric.value },
        permanent: true,
      })
    );
  }

  for (const guide of scene.guides || []) {
    candidates.push(
      makeLineCandidate({
        x: guide.x,
        y: guide.y,
        angle: guide.angle,
        kind: isOrthogonal(guide.angle) ? KIND.ORTHOGONAL : KIND.DIAGONAL,
        source: { x: guide.x, y: guide.y },
        permanent: true,
      })
    );
  }

  // Rays are chosen per kind, not across all points at once: the nearest point
  // of one kind must not hide the nearest of another, or raising a weight would
  // not be enough to reach a kind that is standing behind a closer one.
  const pointsByKind = new Map();
  for (const point of (scene.points || []).filter(inRadius)) {
    if (point.offCurve && !SNAP_PARAMETERS.offCurveSources) {
      continue;
    }
    const kind = point.kind || (point.offCurve ? KIND.OFF_CURVE : KIND.ORTHOGONAL);
    if (!pointsByKind.has(kind)) {
      pointsByKind.set(kind, []);
    }
    pointsByKind.get(kind).push(point);
  }
  for (const [kind, points] of pointsByKind) {
    for (const [axis, angle] of [
      ["y", 0],
      ["x", 90],
    ]) {
      for (const source of nearestPerSide(points, cursor, axis)) {
        candidates.push(
          makeLineCandidate({ x: source.x, y: source.y, angle, kind, source })
        );
      }
    }
  }

  for (const segment of (scene.segments || []).filter(inRadius)) {
    candidates.push(
      makeLineCandidate({
        x: segment.x,
        y: segment.y,
        angle: segment.angle,
        kind: isOrthogonal(segment.angle) ? KIND.ORTHOGONAL : KIND.DIAGONAL,
        source: { x: segment.x, y: segment.y },
      })
    );
  }

  const allowed = candidates.filter(diagonalFilter(diagonals));
  candidates.length = 0;
  candidates.push(...allowed);

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
