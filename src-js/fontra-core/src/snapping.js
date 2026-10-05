import { cubicPointAt as cubicAt, cubicVelocityAt } from "./offset-contour.js";

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
  // A curve carried on past its own end. Not a direction and not a line: it is
  // the one candidate whose shape is the answer, which is why it has its own
  // geometry below rather than an angle.
  CURVATURE: "curvature",
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

// The four control points of a cubic, kept as they are. A cubic evaluated
// outside [0, 1] is the same polynomial, so it leaves the end with the curve's
// own bend rather than with its tangent - which is the whole of what this
// candidate offers. `extend` is how far past each end it runs, in the source
// parameter, so 1 doubles the curve.
export function makeCurveCandidate({ points, kind, extend, source, permanent }) {
  return {
    type: "curve",
    points,
    extend: extend ?? SNAP_PARAMETERS.curvatureExtend,
    kind,
    permanent: !!permanent,
    source: source || points[3],
  };
}

function cubicTangentAt(points, t) {
  const { x: dx, y: dy } = cubicVelocityAt(points, t);
  const length = Math.hypot(dx, dy);
  return length < 1e-12 ? { dx: 1, dy: 0 } : { dx: dx / length, dy: dy / length };
}

// The two runs outside the drawn segment, and only those. Snapping onto the
// drawn curve itself is a different feature: this one continues a curve, it does
// not trace one.
function projectionSpans(candidate) {
  const extend = Math.max(candidate.extend, 0);
  return [
    [-extend, 0],
    [1, 1 + extend],
  ];
}

const PROJECTION_SAMPLES = 24;
const PROJECTION_REFINEMENTS = 20;

// Bounded approximate nearest-point search on the two extensions. A fixed
// budget bounds the work; it does not guarantee continuity between local minima.
export function projectOntoCurve(candidate, point) {
  const { points } = candidate;
  let best = null;
  for (const [from, to] of projectionSpans(candidate)) {
    if (to - from < 1e-12) {
      continue;
    }
    for (let i = 0; i <= PROJECTION_SAMPLES; i++) {
      const t = from + ((to - from) * i) / PROJECTION_SAMPLES;
      const at = cubicAt(points, t);
      const distance = Math.hypot(at.x - point.x, at.y - point.y);
      if (!best || distance < best.distance) {
        best = { t, distance, from, to };
      }
    }
  }
  if (!best) {
    const at = cubicAt(points, 1);
    return { ...at, t: 1 };
  }
  // Bisect the bracket around the best sample, held inside its own span.
  const step = (best.to - best.from) / PROJECTION_SAMPLES;
  let low = Math.max(best.from, best.t - step);
  let high = Math.min(best.to, best.t + step);
  for (let i = 0; i < PROJECTION_REFINEMENTS; i++) {
    const middle = (low + high) / 2;
    const a = (low + middle) / 2;
    const b = (middle + high) / 2;
    const pa = cubicAt(points, a);
    const pb = cubicAt(points, b);
    const da = Math.hypot(pa.x - point.x, pa.y - point.y);
    const db = Math.hypot(pb.x - point.x, pb.y - point.y);
    if (da < db) {
      high = middle;
    } else {
      low = middle;
    }
  }
  const t = (low + high) / 2;
  return { ...cubicAt(points, t), t };
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
  const foot =
    candidate.type === "curve"
      ? projectOntoCurve(candidate, point)
      : projectOntoLine(candidate, point);
  return Math.hypot(point.x - foot.x, point.y - foot.y);
}

// Where a candidate puts a point that has fallen to it. One place, so the
// resolver, the rounding and the readout cannot disagree about it.
export function projectOntoCandidate(candidate, point) {
  if (candidate.type === "point") {
    return { x: candidate.x, y: candidate.y };
  }
  if (candidate.type === "curve") {
    return projectOntoCurve(candidate, point);
  }
  return projectOntoLine(candidate, point);
}

export const MIN_CROSSING_ANGLE_DEG = 15;

function kindWeight(kind) {
  return SNAP_PARAMETERS.weights[kind] ?? SNAP_PARAMETERS.weights[KIND.OTHER];
}

export function crossLines(a, b) {
  // Only two lines make a crossing. A projected curve is a shape rather than a
  // direction, so there is no second constraint to meet it with.
  if (a.type !== "line" || b.type !== "line") {
    return null;
  }
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
  // A dragged point usually starts on guides from its neighbours, so a snap on
  // the first frame holds it where it stands. The drag snaps nothing until the
  // cursor has travelled this far from where it went down.
  startTravelPixels: 12,
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
  // A curve carried past its own end. Held under a key rather than left on: it
  // answers away from the drawn shape, where nothing else does, and that is a
  // deliberate reach rather than an everyday one.
  curvatureEnabled: 0,
  // How far past each end the projection runs, in the source parameter. One
  // doubles the curve.
  curvatureExtend: 1,
  // A fixed-rib drag pins one edge and follows the cursor with the other, so a
  // snap moving the point is fighting the gesture. Off, with a switch, because
  // the drag is also the one place a designer might want the width to land on a
  // metric.
  snapDuringFixedRib: 0,
  // The other modified drags, each with its own switch, all off: each states
  // its own geometry, and a magnet pulling the point elsewhere fights it.
  snapDuringAlt: 0,
  snapDuringTangentRib: 0,
  snapDuringTensionAware: 0,
  snapDuringPowerTensionAware: 0,
  snapDuringIndependentRib: 0,
  snapDuringPointSlide: 0,
  snapDuringHandleLength: 0,
  // An Alt drag of corner points only still snaps, as a plain drag does. A
  // corner has no tangent for Alt to hold.
  altCornersSnap: 1,
  // Per-kind reach, as a multiple of reachPixels. This is what lets reach and
  // precedence move apart: a kind can grab from further away without also winning
  // ties it should lose, which raising its weight would do.
  reaches: Object.freeze({
    [KIND.ORTHOGONAL]: 1,
    [KIND.DIAGONAL]: 1,
    [KIND.INTERSECTION]: 1,
    [KIND.OFF_CURVE]: 1,
    [KIND.CURVATURE]: 1,
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
    [KIND.CURVATURE]: 1.0,
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
  if (a.type === "curve") {
    // Two projections are the same one where they were built on the same four
    // points. A curve has no normal form to compare, so this is the comparison.
    return (
      Math.abs(a.extend - b.extend) < 1e-9 &&
      a.points.every(
        (point, i) =>
          Math.abs(point.x - b.points[i].x) < 1e-9 &&
          Math.abs(point.y - b.points[i].y) < 1e-9
      )
    );
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

// One cache per frame. Collection, resolution and diagnostics share these feet;
// the cache dies with the frame so a changed scene or zoom cannot leave stale data.
export function createSnapEvaluator() {
  const cache = new Map();
  return (candidate, point) => {
    let points = cache.get(candidate);
    if (!points) {
      points = new Map();
      cache.set(candidate, points);
    }
    if (!points.has(point)) {
      const position = projectOntoCandidate(candidate, point);
      points.set(point, {
        position,
        distance: Math.hypot(position.x - point.x, position.y - point.y),
      });
    }
    return points.get(point);
  };
}

function pullAtDistance(candidate, distance, pixelUnit, held) {
  const reach = reachForKind(candidate.kind, pixelUnit);
  const bonus = sameCandidate(candidate, held) ? SNAP_PARAMETERS.holdBonus : 1;
  return reach > 0 ? kindWeight(candidate.kind) * bonus * falloff(distance / reach) : 0;
}

export function candidatePull(candidate, cursor, { pixelUnit, held }) {
  return pullAtDistance(
    candidate,
    distanceToCandidate(candidate, cursor),
    pixelUnit,
    held
  );
}

function targetSources(candidate) {
  return candidate.sources || [candidate];
}

function samePair(a, b) {
  return (
    a && b && a.pointIndex === b.pointIndex && sameCandidate(a.candidate, b.candidate)
  );
}

// Preserve the existing preference for meeting two constraints when possible.
// Within that class compare pull, then distance and coordinates for stable ties.
function compareSnaps(a, b) {
  return (
    Number(b.candidate.type === "point") - Number(a.candidate.type === "point") ||
    b.score - a.score ||
    a.distance - b.distance ||
    a.position.x - b.position.x ||
    a.position.y - b.position.y ||
    a.candidate.kind.localeCompare(b.candidate.kind) ||
    a.pointIndex - b.pointIndex
  );
}

function resolvePoints(candidates, points, cursor, options) {
  const { pixelUnit, held } = options;
  const evaluate = options.evaluate || createSnapEvaluator();
  const settled = (options.speed || 0) <= SNAP_PARAMETERS.acquireSpeedPixels;
  const previous = options.overrule;
  const escape = { armed: false, refused: null, ...options.escape };
  const heldPoint = held && points[held.pointIndex];
  const heldDistance = heldPoint ? evaluate(held.candidate, heldPoint).distance : 0;
  const movingAway =
    heldPoint &&
    Number.isFinite(previous?.heldDistance) &&
    heldDistance > previous.heldDistance + 1e-9;
  if (escape.refused) {
    const owner = points[escape.pointIndex ?? 0];
    if (
      !owner ||
      evaluate(escape.refused, owner).distance >
        reachForKind(escape.refused.kind, pixelUnit)
    ) {
      escape.refused = null;
    }
  }
  if (!heldPoint) {
    escape.armed = false;
  } else if (settled) {
    escape.armed = true;
  }

  const fallback =
    options.constraint && points.length
      ? projectOntoLine(options.constraint, points[0])
      : null;
  const noWin = {
    delta: fallback
      ? { x: fallback.x - points[0].x, y: fallback.y - points[0].y }
      : { x: 0, y: 0 },
    pointIndex: -1,
    position: fallback,
    pull: 0,
    held: [],
    target: null,
    freedom: fallback ? "line" : "free",
    suggestion: null,
    overrule: null,
    escape,
    near: null,
    byKind: {},
  };
  if (
    heldPoint &&
    escape.armed &&
    movingAway &&
    (options.speed || 0) > SNAP_PARAMETERS.escapeSpeedPixels
  ) {
    return {
      ...noWin,
      escaped: held.candidate,
      escape: { armed: false, refused: held.candidate, pointIndex: held.pointIndex },
    };
  }

  let anchorIndex = -1;
  if (SNAP_PARAMETERS.pointerWeight >= 1) {
    let nearest = Infinity;
    points.forEach((point, i) => {
      const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
      if (distance < nearest) {
        nearest = distance;
        anchorIndex = i;
      }
    });
  }
  const entries = [];
  const byKind = noWin.byKind;
  const pointerSpan =
    SNAP_PARAMETERS.reachPixels * pixelUnit * SNAP_PARAMETERS.pointerFalloffReaches;
  const refused = (candidate) =>
    escape.refused &&
    targetSources(candidate).some((source) =>
      targetSources(escape.refused).some((other) => sameCandidate(source, other))
    );
  points.forEach((point, pointIndex) => {
    if (anchorIndex >= 0 && pointIndex !== anchorIndex) return;
    const ownHeld = held?.pointIndex === pointIndex ? held.candidate : null;
    // Each source travels on its own parallel rail, at its original offset from
    // the first source. Applying a single correction therefore preserves shape.
    const constraint = options.constraint
      ? {
          ...options.constraint,
          x: options.constraint.x + point.x - points[0].x,
          y: options.constraint.y + point.y - points[0].y,
        }
      : null;
    const query = constraint ? projectOntoLine(constraint, point) : point;
    const pointerDistance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
    const discount =
      1 -
      SNAP_PARAMETERS.pointerWeight * Math.min(1, pointerDistance / (pointerSpan || 1));
    const pool = [...candidates];
    if (ownHeld) {
      for (const source of targetSources(ownHeld)) {
        if (!pool.some((candidate) => sameCandidate(source, candidate)))
          pool.push(source);
      }
    }
    const local = [];
    const add = (candidate) => {
      if (refused(candidate)) return;
      const geometry = evaluate(candidate, query);
      const pull = pullAtDistance(candidate, geometry.distance, pixelUnit, ownHeld);
      byKind[candidate.kind] = Math.max(byKind[candidate.kind] || 0, pull);
      const entry = {
        ...geometry,
        candidate,
        pointIndex,
        pull,
        score: pull * discount,
      };
      if (pull > 0 && (!noWin.near || entry.score > noWin.near.score)) {
        noWin.near = {
          position: geometry.position,
          pull,
          score: entry.score,
          kind: candidate.kind,
        };
      }
      if (
        pull <= SNAP_PARAMETERS.noSnapPull ||
        (!settled && !sameCandidate(candidate, ownHeld))
      )
        return;
      if (!local.some((other) => sameCandidate(other.candidate, candidate)))
        local.push(entry);
    };
    const lines = [];
    for (const candidate of pool) {
      if (refused(candidate)) continue;
      if (constraint) {
        const crossing = crossLines(constraint, candidate);
        if (crossing) add({ ...crossing, sources: [candidate] });
        else if (
          candidate.type === "point" &&
          distanceToCandidate(constraint, candidate) < 1e-9
        )
          add(candidate);
      } else {
        add(candidate);
        if (
          candidate.type === "line" &&
          pullAtDistance(
            candidate,
            evaluate(candidate, point).distance,
            pixelUnit,
            ownHeld
          ) > SNAP_PARAMETERS.noSnapPull &&
          !lines.some((line) => sameCandidate(line, candidate))
        )
          lines.push(candidate);
      }
    }
    // Crossings are evaluated before selection, never accepted by list order.
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const crossing = crossLines(lines[i], lines[j]);
        if (crossing) add(crossing);
      }
    }
    entries.push(...local);
  });
  if (!entries.length) return noWin;
  entries.sort(compareSnaps);
  let winner = entries[0];
  let suggestion = null;
  let overrule = null;
  const heldEntry = held && entries.find((entry) => samePair(entry, held));
  if (heldEntry) {
    let count = 0;
    const refinement =
      winner.pointIndex === held.pointIndex &&
      held.candidate.type !== "point" &&
      targetSources(winner.candidate).some((source) =>
        sameCandidate(source, held.candidate)
      );
    if (!samePair(winner, held) && !refinement) {
      const rival = winner;
      if (
        rival.score >= heldEntry.score * SNAP_PARAMETERS.overruleMargin &&
        movingAway
      ) {
        count = samePair(previous, rival) ? previous.count + 1 : 1;
      }
      if (count < SNAP_PARAMETERS.overruleFrames) {
        suggestion = rival.candidate;
        winner = heldEntry;
      }
      overrule = {
        candidate: rival.candidate,
        pointIndex: rival.pointIndex,
        count,
        heldDistance,
      };
    } else {
      overrule = { candidate: null, pointIndex: -1, count: 0, heldDistance };
    }
  }
  const { candidate, position, pointIndex, pull } = winner;
  return {
    ...noWin,
    position,
    pointIndex,
    pull,
    target: candidate,
    delta: {
      x: position.x - points[pointIndex].x,
      y: position.y - points[pointIndex].y,
    },
    held: targetSources(candidate),
    freedom: candidate.type === "point" ? "point" : "line",
    suggestion,
    overrule,
    evaluation: winner,
  };
}

export function resolveSnap(candidates, cursor, options) {
  const result = resolvePoints(candidates, [cursor], cursor, {
    ...options,
    held: options.held ? { pointIndex: 0, candidate: options.held } : null,
    // Pointer discount is one for the sole source, regardless of the setting.
    overrule: options.overrule ? { pointIndex: 0, ...options.overrule } : null,
  });
  return { ...result, position: result.position || { ...cursor } };
}

export function resolveSnapForPoints(candidates, points, cursor, options) {
  return resolvePoints(candidates, points, cursor, options);
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
// What the frame is allowed to offer. A held key names one kind and clears
// everything else out of the way, which is the point of holding it; otherwise
// each switchable kind answers to its own switch.
function candidateFilter(only) {
  if (only === "guides") {
    return (candidate) => candidate.guide === true;
  }
  if (only) {
    const kind = only === "curvature" ? KIND.CURVATURE : KIND.DIAGONAL;
    return (candidate) => candidate.kind === kind;
  }
  return (candidate) => {
    if (candidate.kind === KIND.DIAGONAL) {
      return !!SNAP_PARAMETERS.diagonalsEnabled;
    }
    if (candidate.kind === KIND.CURVATURE) {
      return !!SNAP_PARAMETERS.curvatureEnabled;
    }
    return true;
  };
}

export function collectCandidates(scene, cursor, { pixelUnit, only }) {
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
    candidates.push({
      ...makeLineCandidate({
        x: guide.x,
        y: guide.y,
        angle: guide.angle,
        kind: isOrthogonal(guide.angle) ? KIND.ORTHOGONAL : KIND.DIAGONAL,
        source: { x: guide.x, y: guide.y },
        permanent: true,
      }),
      guide: true,
    });
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

  // A projection is anchored on the end it leaves, so that is what the
  // collection radius asks about.
  for (const curve of scene.curves || []) {
    if (!curve.points?.some(inRadius)) {
      continue;
    }
    candidates.push(
      makeCurveCandidate({
        points: curve.points,
        kind: KIND.CURVATURE,
        source: curve.points[3],
      })
    );
  }

  const allowed = candidates.filter(candidateFilter(only));
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
  const candidate = held[0];
  if (candidate.type === "curve") {
    // Rounding across the curve throws the point off it, so the whole unit is
    // taken along the tangent at the foot and the result is projected back.
    const foot = projectOntoCurve(candidate, position);
    const tangent = cubicTangentAt(candidate.points, foot.t);
    const stepped = {
      x: foot.x + (roundFunc(foot.x) - foot.x) * tangent.dx * tangent.dx,
      y: foot.y + (roundFunc(foot.y) - foot.y) * tangent.dy * tangent.dy,
    };
    const back = projectOntoCurve(candidate, stepped);
    return { x: back.x, y: back.y };
  }
  const line = candidate;
  const along = (position.x - line.x) * line.dx + (position.y - line.y) * line.dy;
  const rounded = roundFunc(along);
  return { x: line.x + rounded * line.dx, y: line.y + rounded * line.dy };
}

// A modified drag states its own geometry, and a magnet pulling the point
// somewhere else fights it: Alt equalizes, Z slides along a tangent, X and C
// hold the drawn shape, A moves one rib end alone, V slides the point and B
// slides a handle along itself. D and
// S pin one edge of the stroke and carry a switch, because a designer may want
// a width to land on a metric. Read every frame, so a key pressed mid-drag
// takes on the next one.
export function dragSuppressesSnapping(
  event,
  modes,
  snapDuringFixedRib = SNAP_PARAMETERS.snapDuringFixedRib
) {
  return dragSnapPolicy(event, modes, { snapDuringFixedRib }).suppressed;
}

// Which modifier each switch answers to. Alt is read off the event, the rest off
// the tool's modes.
const MODIFIER_SNAP_SWITCHES = [
  ["tangentRibMode", "snapDuringTangentRib"],
  ["tensionAwareMode", "snapDuringTensionAware"],
  ["powerTensionAwareMode", "snapDuringPowerTensionAware"],
  ["independentRibMode", "snapDuringIndependentRib"],
  ["pointSlideMode", "snapDuringPointSlide"],
  ["handleLengthMode", "snapDuringHandleLength"],
  ["fixedRibMode", "snapDuringFixedRib"],
  ["fixedRibCompressMode", "snapDuringFixedRib"],
];

// What a modified drag may snap to: `suppressed`, or `only` a narrower set.
// `cornersOnly` says every dragged point is a corner, which lets an Alt drag
// snap.
export function dragSnapPolicy(
  event,
  modes,
  { cornersOnly = false, snapDuringFixedRib = SNAP_PARAMETERS.snapDuringFixedRib } = {}
) {
  const switches = { ...SNAP_PARAMETERS, snapDuringFixedRib };
  for (const [mode, key] of MODIFIER_SNAP_SWITCHES) {
    if (modes?.[mode] && !switches[key]) {
      return { suppressed: true, only: undefined };
    }
  }
  if (event?.altKey && !switches.snapDuringAlt) {
    return cornersOnly && switches.altCornersSnap
      ? { suppressed: false, only: undefined }
      : { suppressed: true, only: undefined };
  }
  return { suppressed: false, only: undefined };
}
