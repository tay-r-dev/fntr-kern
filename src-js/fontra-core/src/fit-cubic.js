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

function zeros(length, ...rest) {
  if (rest.length === 0) {
    return new Array(length).fill(0);
  } else {
    return Array.from(range(length)).map((_) => zeros(...rest));
  }
}

// The normal equations behind the two-handle fit, exposed so a caller can also
// solve them with the SPLIT held fixed — see solveHandleScale.
export function handleFitSystem(points, parameters, leftTangent, rightTangent) {
  const bezierLinear = new Bezier(
    points[0],
    points[0],
    points[points.length - 1],
    points[points.length - 1]
  );
  const A = zeros(parameters.length, 2, 2);
  for (const [i, u] of enumerate(parameters)) {
    A[i][0] = mulVectorScalar(leftTangent, 3 * (1 - u) ** 2 * u);
    A[i][1] = mulVectorScalar(rightTangent, 3 * (1 - u) * u ** 2);
  }
  const C = zeros(2, 2);
  const X = zeros(2);

  for (let i = 0; i < points.length; i++) {
    const u = parameters[i];
    const point = points[i];
    C[0][0] += dotVector(A[i][0], A[i][0]);
    C[0][1] += dotVector(A[i][0], A[i][1]);
    C[1][0] += dotVector(A[i][0], A[i][1]);
    C[1][1] += dotVector(A[i][1], A[i][1]);
    const tmp = subVectors(point, bezierLinear.get(u));
    X[0] += dotVector(A[i][0], tmp);
    X[1] += dotVector(A[i][1], tmp);
  }
  return { C, X };
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

// The best scale for a handle pair whose RATIO is already decided: the same
// least squares as solveHandleLengths, collapsed onto one unknown along the ray
// through (startLength, endLength).
//
// This is what lets the split be chosen on its own merits. Redistributing
// tension between the two handles changes the curve, so a candidate split
// judged at the fitted magnitude is judged unfairly - it is being charged for a
// magnitude nobody would pair it with. Re-solving the magnitude here means each
// split is measured at its own best, which is the only comparison that says
// anything about the split itself.
//
// Returns 1 when the pair is already the joint optimum, exactly: the joint
// solution is optimal along every ray through itself, this one included.
export function solveHandleScale(
  points,
  parameters,
  leftTangent,
  rightTangent,
  startLength,
  endLength
) {
  const { C, X } = handleFitSystem(points, parameters, leftTangent, rightTangent);
  const numerator = startLength * X[0] + endLength * X[1];
  const denominator =
    startLength * startLength * C[0][0] +
    2 * startLength * endLength * C[0][1] +
    endLength * endLength * C[1][1];
  return denominator > 0 ? numerator / denominator : 1;
}

export function generateBezier(points, parameters, leftTangent, rightTangent) {
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
  return new Bezier(...bezierPoints);
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
export function parameterizeAgainstCubic(controlPoints, points, parameters) {
  const bezier = new Bezier(...controlPoints);
  return points.map((point, index) => {
    const parameter = newtonRhapsonRootFind(bezier, point, parameters[index]);
    return Number.isFinite(parameter)
      ? Math.min(Math.max(parameter, 0), 1)
      : parameters[index];
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
