import { Bezier } from "bezier-js";
import { enumerate, range } from "./utils.ts";
import {
  addVectors,
  dotVector,
  mulVectorScalar,
  mulVectorVector,
  subVectors,
  vectorLength,
} from "./vector.js";

// The shared normal equations behind the two-handle fit used by
// solveHandleLengths. Runs inside every V-slide refit, so it allocates nothing
// per sample: the chord's cubic (both handles on its ends) is evaluated in
// closed form.
export function handleFitSystem(points, parameters, leftTangent, rightTangent) {
  const first = points[0];
  const last = points[points.length - 1];
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const u = parameters[i];
    const v = 1 - u;
    const a0 = 3 * v * v * u;
    const a1 = 3 * v * u * u;
    const ax = leftTangent.x * a0,
      ay = leftTangent.y * a0;
    const bx = rightTangent.x * a1,
      by = rightTangent.y * a1;
    const toLast = u * u * (3 - 2 * u);
    const tx = points[i].x - (first.x + (last.x - first.x) * toLast);
    const ty = points[i].y - (first.y + (last.y - first.y) * toLast);
    c00 += ax * ax + ay * ay;
    c01 += ax * bx + ay * by;
    c11 += bx * bx + by * by;
    x0 += ax * tx + ay * ty;
    x1 += bx * tx + by * ty;
  }
  return {
    C: [
      [c00, c01],
      [c01, c11],
    ],
    X: [x0, x1],
  };
}

export function solveHandleLengths(points, parameters, leftTangent, rightTangent) {
  const { C, X } = handleFitSystem(points, parameters, leftTangent, rightTangent);
  const C0_C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  const C0_X = C[0][0] * X[1] - C[1][0] * X[0];
  const X_C1 = X[0] * C[1][1] - X[1] * C[0][1];
  return {
    alphaL: C0_C1 == 0 ? 0 : X_C1 / C0_C1,
    alphaR: C0_C1 == 0 ? 0 : C0_X / C0_C1,
  };
}

// The four control points only. A refit loop calls this on every pass, and a
// Bezier object is costly to build there.
export function generateBezierPoints(points, parameters, leftTangent, rightTangent) {
  const bezierPoints = [points[0], undefined, undefined, points[points.length - 1]];
  const { alphaL, alphaR } = solveHandleLengths(
    points,
    parameters,
    leftTangent,
    rightTangent
  );
  const segLength = vectorLength(subVectors(points[0], points[points.length - 1]));
  const epsilonForAll = 1.0e-6 * segLength;
  if (alphaL < epsilonForAll || alphaR < epsilonForAll) {
    bezierPoints[1] = addVectors(
      bezierPoints[0],
      mulVectorScalar(leftTangent, segLength / 3.0)
    );
    bezierPoints[2] = addVectors(
      bezierPoints[3],
      mulVectorScalar(rightTangent, segLength / 3.0)
    );
  } else {
    bezierPoints[1] = addVectors(bezierPoints[0], mulVectorScalar(leftTangent, alphaL));
    bezierPoints[2] = addVectors(
      bezierPoints[3],
      mulVectorScalar(rightTangent, alphaR)
    );
  }
  return bezierPoints;
}

export function generateBezier(points, parameters, leftTangent, rightTangent) {
  return new Bezier(
    ...generateBezierPoints(points, parameters, leftTangent, rightTangent)
  );
}

function sumVector(point) {
  return point.x + point.y;
}

export function newtonRhapsonRootFind(bezier, point, t) {
  const d = subVectors(bezier.get(t), point);
  const qPrime = bezier.derivative(t);
  const qPrimePrime = bezier.dderivative(t);
  const numerator = sumVector(mulVectorVector(d, qPrime));
  const qPrimeDouble = mulVectorVector(qPrime, qPrime);
  const denominator = sumVector(
    addVectors(qPrimeDouble, mulVectorVector(qPrimePrime, d))
  );
  if (denominator === 0) {
    return t;
  } else {
    return t - numerator / denominator;
  }
}

function reparameterize(bezier, points, parameters) {
  return points.map((point, index) =>
    newtonRhapsonRootFind(bezier, point, parameters[index])
  );
}

//
// Where each point lands on the cubic through `controlPoints`, as a parameter.
//
// Split out of fitCubic's own loop so callers that build a cubic from handle
// lengths — offset construction — reuse this root find rather than growing a
// second copy (rail R-B). Unlike the private helper above it clamps the result
// into [0, 1] and keeps the incoming parameter when Newton returns nothing
// usable, so a caller can feed the answer straight back into solveHandleLengths.
//
// One Newton step per sample toward the cubic's nearest point, evaluated in
// closed form: this runs on every pass of every V-slide refit.
export function parameterizeAgainstCubic(controlPoints, points, parameters) {
  const [p0, p1, p2, p3] = controlPoints;
  return points.map((point, index) => {
    const t = parameters[index];
    const u = 1 - t;
    const bx =
      u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const by =
      u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    const d1x =
      3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x));
    const d1y =
      3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y));
    const d2x = 6 * (u * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x));
    const d2y = 6 * (u * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y));
    const dx = bx - point.x,
      dy = by - point.y;
    const denominator = d1x * d1x + d1y * d1y + d2x * dx + d2y * dy;
    const parameter = denominator === 0 ? t : t - (dx * d1x + dy * d1y) / denominator;
    return Number.isFinite(parameter) ? Math.min(Math.max(parameter, 0), 1) : t;
  });
}

export function fitCubic(points, leftTangent, rightTangent, error) {
  // Parameterize points, and attempt to fit curve
  let parameters = chordLengthParameterize(points);
  let bezier = generateBezier(points, parameters, leftTangent, rightTangent);
  let [maxError, splitPoint] = computeMaxError(points, bezier, parameters);
  if (maxError < error) {
    return bezier;
  }

  // If error not too large, try some reparameterization and iteration
  if (maxError < error * 1000) {
    let prevMaxError = maxError;
    for (let i = 0; i < 20; i++) {
      const parametersPrime = reparameterize(bezier, points, parameters);
      bezier = generateBezier(points, parametersPrime, leftTangent, rightTangent);
      [maxError, splitPoint] = computeMaxError(points, bezier, parametersPrime);
      if (maxError < error || prevMaxError - maxError < 0.5) {
        break;
      }
      prevMaxError = maxError;
      parameters = parametersPrime;
    }
  }

  return bezier;
}

export function chordLengthParameterize(points) {
  const parameters = [0.0];
  for (const i of range(1, points.length)) {
    parameters.push(
      parameters[i - 1] + vectorLength(subVectors(points[i], points[i - 1]))
    );
  }

  for (const [i] of enumerate(parameters)) {
    parameters[i] = parameters[i] / parameters[parameters.length - 1];
  }
  return parameters;
}

export function computeMaxError(points, bezier, parameters) {
  let maxDistance = 0.0;
  let splitPoint = points.length / 2;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const parameter = parameters[i];
    const pointAtParameter = bezier.get(parameter);
    const distance = vectorLength(subVectors(pointAtParameter, point)) ** 2;
    if (distance > maxDistance) {
      maxDistance = distance;
      splitPoint = i;
    }
  }
  return [maxDistance, splitPoint];
}
