import { calculateTunniPoint } from "./tunni-calculations.js";

const EPSILON = 1e-9;
const MIN_HANDLE_LENGTH = 1;
const REACH_FLOOR_RATIO = 1 / 3;
const REACH_CAP_RATIO = 2;
const OFFSET_SAMPLE_PARAMETERS = [0.125, 0.25, 0.5, 0.75, 0.875];
const PULL_FLOOR = 1e-3;
const PULL_CUSP = 4;

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function cubicBasis(t) {
  const mt = 1 - t;
  return {
    b0: mt ** 3,
    b1: 3 * mt * mt * t,
    b2: 3 * mt * t * t,
    b3: t ** 3,
  };
}

function cubicPointAndDerivative(points, t) {
  const [p0, p1, p2, p3] = points;
  const { b0, b1, b2, b3 } = cubicBasis(t);
  const mt = 1 - t;
  return {
    point: {
      x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
      y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    },
    derivative: {
      x:
        3 * mt * mt * (p1.x - p0.x) +
        6 * mt * t * (p2.x - p1.x) +
        3 * t * t * (p3.x - p2.x),
      y:
        3 * mt * mt * (p1.y - p0.y) +
        6 * mt * t * (p2.y - p1.y) +
        3 * t * t * (p3.y - p2.y),
    },
    secondDerivative: {
      x: 6 * mt * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
      y: 6 * mt * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y),
    },
  };
}

function curvatureAt(points, parameter) {
  const { derivative, secondDerivative } = cubicPointAndDerivative(points, parameter);
  const speed = Math.hypot(derivative.x, derivative.y);
  if (speed === 0) return null;
  return (
    (derivative.x * secondDerivative.y - derivative.y * secondDerivative.x) / speed ** 3
  );
}

function buildOffsetSamples(points, startSignedWidth, endSignedWidth) {
  return OFFSET_SAMPLE_PARAMETERS.map((parameter) => {
    const { point, derivative } = cubicPointAndDerivative(points, parameter);
    const speed = Math.hypot(derivative.x, derivative.y);
    const normal =
      speed === 0
        ? { x: 0, y: 0 }
        : { x: derivative.y / speed, y: -derivative.x / speed };
    const width = startSignedWidth + (endSignedWidth - startSignedWidth) * parameter;
    return {
      parameter,
      skeletonNormal: normal,
      requestedPoint: {
        x: point.x + normal.x * width,
        y: point.y + normal.y * width,
      },
      weight: 1,
    };
  });
}

function buildPerpendicularErrorSystem(request, samples, domain) {
  const system = {
    aa: 0,
    ab: 0,
    bb: 0,
    ac: 0,
    bc: 0,
    cc: 0,
    weight: 0,
    influenceScale: 0,
  };
  for (const sample of samples) {
    const { b0, b1, b2, b3 } = cubicBasis(sample.parameter);
    const fixedPoint = {
      x:
        (b0 + b1) * request.startOutlinePoint.x + (b2 + b3) * request.endOutlinePoint.x,
      y:
        (b0 + b1) * request.startOutlinePoint.y + (b2 + b3) * request.endOutlinePoint.y,
    };
    const constant = dot(
      sample.skeletonNormal,
      subtract(fixedPoint, sample.requestedPoint)
    );
    const startInfluence = b1 * domain.startReach;
    const endInfluence = b2 * domain.endReach;
    const start =
      startInfluence * dot(sample.skeletonNormal, request.startHandleDirection);
    const end = endInfluence * dot(sample.skeletonNormal, request.endHandleDirection);
    const weight = sample.weight;
    system.aa += weight * start * start;
    system.ab += weight * start * end;
    system.bb += weight * end * end;
    system.ac += weight * start * constant;
    system.bc += weight * end * constant;
    system.cc += weight * constant * constant;
    system.weight += weight;
    system.influenceScale +=
      weight * (startInfluence * startInfluence + endInfluence * endInfluence);
  }
  return system;
}

function objective(system, startTension, endTension) {
  return (
    system.aa * startTension * startTension +
    2 * system.ab * startTension * endTension +
    system.bb * endTension * endTension +
    2 * system.ac * startTension +
    2 * system.bc * endTension +
    system.cc
  );
}

export function buildHandleDomain(startPoint, endPoint, startDirection, endDirection) {
  const chordLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
  const floor = Math.max(chordLength * REACH_FLOOR_RATIO, MIN_HANDLE_LENGTH);
  const cap = Math.max(chordLength * REACH_CAP_RATIO, floor);
  const tunni = calculateTunniPoint([
    startPoint,
    {
      x: startPoint.x + startDirection.x,
      y: startPoint.y + startDirection.y,
    },
    {
      x: endPoint.x + endDirection.x,
      y: endPoint.y + endDirection.y,
    },
    endPoint,
  ]);
  const projectedReach = (anchor, direction) => {
    if (!tunni) return cap;
    const reach = dot(subtract(tunni, anchor), direction);
    return reach > EPSILON ? clamp(reach, floor, cap) : cap;
  };
  const startReach = projectedReach(startPoint, startDirection);
  const endReach = projectedReach(endPoint, endDirection);
  return {
    startReach,
    endReach,
    chordLength,
    minStartTension: MIN_HANDLE_LENGTH / startReach,
    maxStartTension: 1,
    minEndTension: MIN_HANDLE_LENGTH / endReach,
    maxEndTension: 1,
  };
}

function unconstrainedMinimum(system) {
  const determinant = system.aa * system.bb - system.ab * system.ab;
  return {
    start: (system.ab * system.bc - system.bb * system.ac) / determinant,
    end: (system.ab * system.ac - system.aa * system.bc) / determinant,
  };
}

function constrainTensions(tensions, domain) {
  return {
    start: clamp(tensions.start, domain.minStartTension, domain.maxStartTension),
    end: clamp(tensions.end, domain.minEndTension, domain.maxEndTension),
  };
}

function referenceHandles(request) {
  const [p0, p1, p2, p3] = request.skeletonControlPoints;
  const startVector = subtract(p1, p0);
  const endVector = subtract(p2, p3);
  const startLength = Math.hypot(startVector.x, startVector.y);
  const endLength = Math.hypot(endVector.x, endVector.y);
  const startDirection =
    startLength === 0
      ? request.startHandleDirection
      : { x: startVector.x / startLength, y: startVector.y / startLength };
  const endDirection =
    endLength === 0
      ? request.endHandleDirection
      : { x: endVector.x / endLength, y: endVector.y / endLength };
  const skeletonDomain = buildHandleDomain(p0, p3, startDirection, endDirection);
  return constrainTensions(
    {
      start: startLength / skeletonDomain.startReach,
      end: endLength / skeletonDomain.endReach,
    },
    request.handleDomain
  );
}

function addReferencePull(system, reference, weightRatio) {
  const weight = weightRatio * system.influenceScale;
  return {
    ...system,
    aa: system.aa + weight,
    bb: system.bb + weight,
    ac: system.ac - weight * reference.start,
    bc: system.bc - weight * reference.end,
  };
}

function minimizeInsideRectangle(system, domain) {
  const candidates = [];
  const add = (start, end) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    candidates.push({
      start: clamp(start, domain.minStartTension, domain.maxStartTension),
      end: clamp(end, domain.minEndTension, domain.maxEndTension),
    });
  };

  const interior = unconstrainedMinimum(system);
  if (
    interior.start >= domain.minStartTension &&
    interior.start <= domain.maxStartTension &&
    interior.end >= domain.minEndTension &&
    interior.end <= domain.maxEndTension
  ) {
    add(interior.start, interior.end);
  }

  for (const start of [domain.minStartTension, domain.maxStartTension]) {
    add(start, -(system.bc + system.ab * start) / system.bb);
  }
  for (const end of [domain.minEndTension, domain.maxEndTension]) {
    add(-(system.ac + system.ab * end) / system.aa, end);
  }
  for (const start of [domain.minStartTension, domain.maxStartTension]) {
    for (const end of [domain.minEndTension, domain.maxEndTension]) {
      add(start, end);
    }
  }

  let best = candidates[0];
  let bestError = objective(system, best.start, best.end);
  for (const candidate of candidates.slice(1)) {
    const error = objective(system, candidate.start, candidate.end);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return { tensions: best, error: Math.max(bestError, 0) };
}

function pullWeightRatio(request) {
  const points = request.skeletonControlPoints;
  let health = 1;
  for (const parameter of [0, ...OFFSET_SAMPLE_PARAMETERS, 1]) {
    const curvature = curvatureAt(points, parameter);
    if (curvature === null) {
      health = 0;
      break;
    }
    const width =
      request.startSignedWidth +
      (request.endSignedWidth - request.startSignedWidth) * parameter;
    health = Math.min(health, clamp(1 + width * curvature, 0, 1));
  }
  return PULL_FLOOR + (PULL_CUSP - PULL_FLOOR) * (1 - health) ** 2;
}

export function solveNaturalHandles(request) {
  const domain = request.handleDomain;
  const reference = referenceHandles(request);
  const samples = buildOffsetSamples(
    request.skeletonControlPoints,
    request.startSignedWidth,
    request.endSignedWidth
  );
  const fit = buildPerpendicularErrorSystem(request, samples, domain);
  const ratio = pullWeightRatio(request);
  const { tensions } = minimizeInsideRectangle(
    addReferencePull(fit, reference, ratio),
    domain
  );
  return {
    startLength: tensions.start * domain.startReach,
    endLength: tensions.end * domain.endReach,
    pullWeightRatio: ratio,
    perpendicularRms: Math.sqrt(
      objective(fit, tensions.start, tensions.end) / Math.max(fit.weight, 1)
    ),
  };
}
