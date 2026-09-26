import { computeTunniHandleLengths } from "./tunni-calculations.js";
import * as vector from "./vector.js";

// The bulb starts at the endpoint rib. No part of this construction reads a
// wall curve: it receives two attachment points and their outward directions.
// Its four new on-curves are the outer shoulder, forward tip, inner extreme,
// and neck shoulder. They exist at every setting.
export function buildBulbTerminal({
  outer,
  inner,
  outerDirection,
  innerDirection,
  radius,
  shape,
  easing,
  tension,
}) {
  const across = vector.normalizeVector(vector.subVectors(inner, outer));
  const forward = vector.normalizeVector(outerDirection);
  const inwardHandle = vector.normalizeVector(innerDirection);
  const alongRadius = radius * (1 + 1.4 * shape);
  // Easing buys room for the neck by extending the terminal, never by taking
  // room from the stroke. Shape elongates the ball; easing extends its approach.
  const approach = alongRadius * (1 + easing);
  const at = (x, y) => ({
    x: outer.x + forward.x * x + across.x * y,
    y: outer.y + forward.y * x + across.y * y,
  });
  const ball = (angle) =>
    at(approach + alongRadius * Math.cos(angle), radius * (1 + Math.sin(angle)));
  const derivative = (angle) => ({
    x: -forward.x * alongRadius * Math.sin(angle) + across.x * radius * Math.cos(angle),
    y: -forward.y * alongRadius * Math.sin(angle) + across.y * radius * Math.cos(angle),
  });
  const handle = (point) => ({ ...point, type: "cubic" });
  const onCurve = (point) => ({ ...point, smooth: true, skipColinear: true });
  const moved = (point, direction, distance) =>
    vector.addVectors(point, vector.mulVectorScalar(direction, distance));

  // The approach starts in the unchanged wall's direction and reaches the
  // ball's outer shoulder in that same direction.
  const points = [
    handle(at(approach / 3, 0)),
    handle(at((approach * 2) / 3, 0)),
    onCurve(at(approach, 0)),
  ];
  let previous = -Math.PI / 2;
  for (const angle of [0, Math.PI / 2, (3 * Math.PI) / 4]) {
    const k = (4 / 3) * Math.tan((angle - previous) / 4);
    points.push(
      handle(moved(ball(previous), derivative(previous), k)),
      handle(moved(ball(angle), derivative(angle), -k)),
      onCurve(ball(angle))
    );
    previous = angle;
  }

  const shoulder = points.at(-1);
  const neckDirection = vector.normalizeVector(derivative(previous));
  const lengths = computeTunniHandleLengths(
    shoulder,
    neckDirection,
    inner,
    inwardHandle,
    tension
  );
  // A tangent intersection behind an attachment must not grow an unbounded
  // handle. The convex hull stays on the terminal's side of the rib. The
  // transverse rib may be tilted, so this is a frame coordinate, not a dot
  // product with the stroke direction.
  const determinant = forward.x * across.y - forward.y * across.x;
  const forwardComponent = (direction) =>
    Math.abs(determinant) < 1e-10
      ? 0
      : (direction.x * across.y - direction.y * across.x) / determinant;
  const shoulderAdvance = approach + alongRadius * Math.cos(previous);
  const chord = vector.distance(shoulder, inner);
  const bounded = (length, advance, direction) => {
    const rate = forwardComponent(direction);
    const ceiling = rate < 0 ? Math.max(advance / -rate, 0) : chord;
    return Math.min(Math.max(length, 0), chord, ceiling);
  };
  points.push(
    handle(
      moved(
        shoulder,
        neckDirection,
        bounded(lengths.startLen, shoulderAdvance, neckDirection)
      )
    ),
    handle(moved(inner, inwardHandle, bounded(lengths.endLen, 0, inwardHandle)))
  );
  return points;
}
