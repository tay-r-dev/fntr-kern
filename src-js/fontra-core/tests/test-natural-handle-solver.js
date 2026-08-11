import {
  buildHandleDomain,
  solveNaturalHandles,
} from "@fontra/core/natural-handle-solver.js";
import { offsetCubicSide } from "@fontra/core/offset-cubic.js";
import { calculateTunniPoint } from "@fontra/core/tunni-calculations.js";
import { expect } from "chai";

const KAPPA = 0.5522847498307933;

function quarterCircle(radius) {
  return [
    { x: radius, y: 0 },
    { x: radius, y: radius * KAPPA },
    { x: radius * KAPPA, y: radius },
    { x: 0, y: radius },
  ];
}

function arcRequest(sourceRadius, offset) {
  const skeletonControlPoints = quarterCircle(sourceRadius);
  const outline = quarterCircle(sourceRadius + offset);
  const startHandleDirection = { x: 0, y: 1 };
  const endHandleDirection = { x: 1, y: 0 };
  return {
    skeletonControlPoints,
    startSignedWidth: offset,
    endSignedWidth: offset,
    startOutlinePoint: outline[0],
    endOutlinePoint: outline[3],
    startHandleDirection,
    endHandleDirection,
    handleDomain: buildHandleDomain(
      outline[0],
      outline[3],
      startHandleDirection,
      endHandleDirection
    ),
  };
}

function unit(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function requestFor(points, startSignedWidth, endSignedWidth) {
  const [p0, p1, p2, p3] = points;
  const startHandleDirection = unit({ x: p1.x - p0.x, y: p1.y - p0.y });
  const endHandleDirection = unit({ x: p2.x - p3.x, y: p2.y - p3.y });
  const startNormal = {
    x: startHandleDirection.y,
    y: -startHandleDirection.x,
  };
  const endNormal = {
    x: -endHandleDirection.y,
    y: endHandleDirection.x,
  };
  const startOutlinePoint = {
    x: p0.x + startNormal.x * startSignedWidth,
    y: p0.y + startNormal.y * startSignedWidth,
  };
  const endOutlinePoint = {
    x: p3.x + endNormal.x * endSignedWidth,
    y: p3.y + endNormal.y * endSignedWidth,
  };
  return {
    skeletonControlPoints: points,
    startSignedWidth,
    endSignedWidth,
    startOutlinePoint,
    endOutlinePoint,
    startHandleDirection,
    endHandleDirection,
    handleDomain: buildHandleDomain(
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection
    ),
  };
}

function makeTightTaperRequest({
  startSkeletonLength = 40,
  endSkeletonLength = 100,
} = {}) {
  return requestFor(
    [
      { x: 0, y: 0 },
      { x: startSkeletonLength, y: 0 },
      { x: 140, y: 75 - endSkeletonLength },
      { x: 140, y: 75 },
    ],
    25,
    110
  );
}

function makeTightTurnRequest(width) {
  return requestFor(
    [
      { x: 0, y: 0 },
      { x: 20, y: 90 },
      { x: 120, y: 90 },
      { x: 140, y: 0 },
    ],
    -width,
    -width
  );
}

const quarterCirclePoints = quarterCircle(100);
const sCurve = [
  { x: 0, y: 0 },
  { x: 60, y: 60 },
  { x: 120, y: -60 },
  { x: 180, y: 0 },
];
const tightTurn = [
  { x: 0, y: 0 },
  { x: 20, y: 90 },
  { x: 120, y: 90 },
  { x: 140, y: 0 },
];
const shallowCurve = [
  { x: 0, y: 0 },
  { x: 50, y: 40 },
  { x: 150, y: 40 },
  { x: 200, y: 0 },
];
const unequalCurve = [
  { x: 0, y: 0 },
  { x: 25, y: 60 },
  { x: 150, y: 75 },
  { x: 190, y: 0 },
];

const accuracyCases = [
  ["circular outward", quarterCirclePoints, 25, 25, 1],
  ["circular inward", quarterCirclePoints, -40, -40, 1],
  ["S-curve left", sCurve, 35, 35, 2.5],
  ["S-curve right", sCurve, -35, -35, 2.5],
  ["tight inward turn", tightTurn, -70, -70, 1.5],
  ["shallow wide offset", shallowCurve, 70, 70, 1],
  ["unequal handles", unequalCurve, 50, 50, 1],
  ["moderate taper, left", sCurve, 25, 60, null],
  ["moderate taper, right", sCurve, -25, -60, null],
  ["strong taper, left", sCurve, 20, 110, null],
  ["strong taper, right", sCurve, -20, -110, null],
];

function trueOffsetPoints([p0, p1, p2, p3], d0, d3, count = 41) {
  const points = [];
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    const mt = 1 - t;
    const base = {
      x:
        mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
      y:
        mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
    };
    const derivative = {
      x:
        3 * mt * mt * (p1.x - p0.x) +
        6 * mt * t * (p2.x - p1.x) +
        3 * t * t * (p3.x - p2.x),
      y:
        3 * mt * mt * (p1.y - p0.y) +
        6 * mt * t * (p2.y - p1.y) +
        3 * t * t * (p3.y - p2.y),
    };
    const speed = Math.hypot(derivative.x, derivative.y);
    if (speed < 1e-9) {
      points.push(base);
      continue;
    }
    const width = d0 + (d3 - d0) * t;
    points.push({
      x: base.x + (derivative.y * width) / speed,
      y: base.y - (derivative.x * width) / speed,
    });
  }
  return points;
}

function maxDeviationForHandles(points, d0, d3, handles) {
  const request = requestFor(points, d0, d3);
  const c1 = {
    x:
      request.startOutlinePoint.x +
      request.startHandleDirection.x * handles.startLength,
    y:
      request.startOutlinePoint.y +
      request.startHandleDirection.y * handles.startLength,
  };
  const c2 = {
    x: request.endOutlinePoint.x + request.endHandleDirection.x * handles.endLength,
    y: request.endOutlinePoint.y + request.endHandleDirection.y * handles.endLength,
  };
  const generated = [];
  for (let index = 0; index <= 400; index++) {
    const t = index / 400;
    const mt = 1 - t;
    generated.push({
      x:
        mt ** 3 * request.startOutlinePoint.x +
        3 * mt * mt * t * c1.x +
        3 * mt * t * t * c2.x +
        t ** 3 * request.endOutlinePoint.x,
      y:
        mt ** 3 * request.startOutlinePoint.y +
        3 * mt * mt * t * c1.y +
        3 * mt * t * t * c2.y +
        t ** 3 * request.endOutlinePoint.y,
    });
  }
  let worst = 0;
  for (const target of trueOffsetPoints(points, d0, d3)) {
    let nearest = Infinity;
    for (const point of generated) {
      nearest = Math.min(
        nearest,
        (point.x - target.x) ** 2 + (point.y - target.y) ** 2
      );
    }
    worst = Math.max(worst, Math.sqrt(nearest));
  }
  return worst;
}

function measureCurrentOffset(points, d0, d3) {
  const request = requestFor(points, d0, d3);
  return maxDeviationForHandles(
    points,
    d0,
    d3,
    offsetCubicSide({
      p0: points[0],
      p1: points[1],
      p2: points[2],
      p3: points[3],
      d0,
      d3,
      q0: request.startOutlinePoint,
      q3: request.endOutlinePoint,
      u0: request.startHandleDirection,
      u1: request.endHandleDirection,
    })
  );
}

function measureNaturalOffset(points, d0, d3, solve = solveNaturalHandles) {
  const result = solve(requestFor(points, d0, d3));
  return {
    maxDeviation: maxDeviationForHandles(points, d0, d3, result),
    pullWeightRatio: result.pullWeightRatio,
    perpendicularRms: result.perpendicularRms,
  };
}

const U1 = {
  p0: { x: 408, y: 105 },
  p3: { x: 936, y: 338 },
  startHandleLength: 337,
  endHandleLength: Math.hypot(30, 162),
  startDirection: { x: 1, y: 0 },
  endDirection: {
    x: -30 / Math.hypot(30, 162),
    y: -162 / Math.hypot(30, 162),
  },
};

const u1Sides = {
  "single-sided right": {
    d0: -80,
    d3: -290,
    q0: { x: 408, y: 185 },
    q3: { x: 650, y: 388 },
  },
  "single-sided left": {
    d0: 80,
    d3: 290,
    q0: { x: 408, y: 25 },
    q3: { x: 1222, y: 288 },
  },
  "double-sided outer": {
    d0: 40,
    d3: 145,
    q0: { x: 408, y: 65 },
    q3: { x: 1079, y: 313 },
  },
  "double-sided inner": {
    d0: -40,
    d3: -145,
    q0: { x: 408, y: 145 },
    q3: { x: 793, y: 363 },
  },
};

function u1RequestAt(scale, side) {
  const skeletonControlPoints = [
    U1.p0,
    {
      x: U1.p0.x + U1.startDirection.x * U1.startHandleLength * scale,
      y: U1.p0.y + U1.startDirection.y * U1.startHandleLength * scale,
    },
    {
      x: U1.p3.x + U1.endDirection.x * U1.endHandleLength * scale,
      y: U1.p3.y + U1.endDirection.y * U1.endHandleLength * scale,
    },
    U1.p3,
  ];
  return {
    skeletonControlPoints,
    startSignedWidth: side.d0,
    endSignedWidth: side.d3,
    startOutlinePoint: side.q0,
    endOutlinePoint: side.q3,
    startHandleDirection: U1.startDirection,
    endHandleDirection: U1.endDirection,
    handleDomain: buildHandleDomain(
      side.q0,
      side.q3,
      U1.startDirection,
      U1.endDirection
    ),
  };
}

function sweepRequests(requestAt, solve = solveNaturalHandles) {
  const forward = [];
  for (let step = 0; step <= 260; step++) {
    forward.push(solve(requestAt(0.5 + (step * 1.3) / 260)));
  }
  const reverse = [];
  for (let step = 260; step >= 0; step--) {
    reverse.push(solve(requestAt(0.5 + (step * 1.3) / 260)));
  }
  return { forward, reverse };
}

function sweepMetrics(values) {
  let worstStep = 0;
  let worstBacktrack = 0;
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    worstStep = Math.max(
      worstStep,
      Math.abs(current.startLength - previous.startLength),
      Math.abs(current.endLength - previous.endLength)
    );
    worstBacktrack = Math.max(
      worstBacktrack,
      previous.startLength - current.startLength,
      previous.endLength - current.endLength
    );
  }
  return { worstStep, worstBacktrack };
}

function scaledHandles(points, scale) {
  const [p0, p1, p2, p3] = points;
  return [
    p0,
    {
      x: p0.x + (p1.x - p0.x) * scale,
      y: p0.y + (p1.y - p0.y) * scale,
    },
    {
      x: p3.x + (p2.x - p3.x) * scale,
      y: p3.y + (p2.y - p3.y) * scale,
    },
    p3,
  ];
}

describe("natural-handle-solver: fixed perpendicular fit", () => {
  it("uses the chord cap when a tangent intersection is behind an endpoint", () => {
    const domain = buildHandleDomain(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 1, y: 0 },
      { x: 0, y: 1 }
    );
    expect(domain.startReach).to.be.closeTo(100, 1e-9);
    expect(domain.endReach).to.be.closeTo(200 * Math.sqrt(2), 1e-9);
  });

  it("uses a short forward intersection as the geometric maximum", () => {
    const start = { x: 157, y: 205 };
    const end = { x: 145, y: 133 };
    const startDirection = { x: 0, y: -1 };
    const endDirection = unit({ x: 54, y: 14 });
    const domain = buildHandleDomain(start, end, startDirection, endDirection);
    const tunni = calculateTunniPoint([
      start,
      add(start, startDirection),
      add(end, endDirection),
      end,
    ]);
    const realEndReach = dot(subtract(tunni, end), endDirection);

    expect(domain.endReach).to.be.greaterThan(realEndReach);
    expect(domain.maxEndTension * domain.endReach).to.be.closeTo(realEndReach, 1e-9);
  });

  it("lets the geometric ceiling beat the one-unit floor", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 10, y: 0.5 };
    const startDirection = { x: 1, y: 0 };
    const endDirection = unit({ x: -0.1, y: -0.5 });
    const domain = buildHandleDomain(start, end, startDirection, endDirection);

    expect(domain.maxEndTension * domain.endReach).to.be.closeTo(
      Math.hypot(0.1, 0.5),
      1e-9
    );
    expect(domain.minEndTension).to.equal(domain.maxEndTension);
  });

  // The handle nudge slides the emitted handle along its own direction after the
  // construction. What may not cross is the DRAWN curve, so the ceiling on the
  // constructed length is the forward reach less that slide. The on-curve's own
  // nudge cancels out: it moves the drawn end and the drawn intersection by the
  // same amount along the same line.
  it("takes the handle's emission nudge off the geometric ceiling", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 10, y: 0.5 };
    const startDirection = { x: 1, y: 0 };
    const endDirection = unit({ x: -0.1, y: -0.5 });
    const plain = buildHandleDomain(start, end, startDirection, endDirection);
    const realEndReach = plain.maxEndTension * plain.endReach;

    // Slid backwards: the drawn handle starts further from the intersection, so
    // the constructed one may run further before the drawn one crosses.
    const slack = buildHandleDomain(start, end, startDirection, endDirection, {
      endNudge: -8,
    });
    expect(slack.maxEndTension * slack.endReach).to.be.closeTo(
      Math.min(realEndReach + 8, slack.endReach),
      1e-9
    );
    expect(slack.maxEndTension).to.be.greaterThan(plain.maxEndTension);

    // Slid forwards: it eats the room instead, which is what stops an untouched
    // segment rendering past its own ceiling.
    const tight = buildHandleDomain(
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 1, y: 0 },
      { x: 0, y: -1 }
    );
    const nudged = buildHandleDomain(
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { startNudge: 20 }
    );
    expect(nudged.maxStartTension * nudged.startReach).to.be.closeTo(
      tight.maxStartTension * tight.startReach - 20,
      1e-9
    );
  });

  it("recovers a circular offset without rematching samples", () => {
    const result = solveNaturalHandles(arcRequest(100, 25));
    expect(result.startLength).to.be.closeTo(125 * KAPPA, 0.1);
    expect(result.endLength).to.be.closeTo(125 * KAPPA, 0.1);
    expect(result.perpendicularRms).to.be.below(0.1);
    expect(result.pullWeightRatio).to.be.below(0.01);
  });

  it("is deterministic and does not mutate its request", () => {
    const request = arcRequest(100, -25);
    const before = structuredClone(request);
    expect(solveNaturalHandles(request)).to.deep.equal(solveNaturalHandles(request));
    expect(request).to.deep.equal(before);
  });
});

describe("natural-handle-solver: reference answer", () => {
  it("transfers equal skeleton tension to equal outline tension", () => {
    const request = arcRequest(100, 25);
    const result = solveNaturalHandles(request);
    expect(result.startLength / request.handleDomain.startReach).to.be.closeTo(
      result.endLength / request.handleDomain.endReach,
      1e-9
    );
  });

  it("retains deliberate unequal skeleton tension near a cusp", () => {
    const request = makeTightTaperRequest({
      startSkeletonLength: 40,
      endSkeletonLength: 100,
    });
    const result = solveNaturalHandles(request);
    expect(result.pullWeightRatio).to.be.above(0.001);
    expect(result.endLength / request.handleDomain.endReach).to.be.above(
      result.startLength / request.handleDomain.startReach
    );
  });

  it("does not read the outline frame when choosing the ratio", () => {
    const request = makeTightTaperRequest();
    const startOutlinePoint = {
      x: request.startOutlinePoint.x + 80,
      y: request.startOutlinePoint.y - 30,
    };
    const endOutlinePoint = {
      x: request.endOutlinePoint.x - 40,
      y: request.endOutlinePoint.y + 60,
    };
    const changedFrame = {
      ...request,
      startOutlinePoint,
      endOutlinePoint,
      handleDomain: buildHandleDomain(
        startOutlinePoint,
        endOutlinePoint,
        request.startHandleDirection,
        request.endHandleDirection
      ),
    };
    expect(solveNaturalHandles(changedFrame).pullWeightRatio).to.equal(
      solveNaturalHandles(request).pullWeightRatio
    );
  });
});

function resultDelta(left, right) {
  return Math.max(
    Math.abs(left.startLength - right.startLength),
    Math.abs(left.endLength - right.endLength)
  );
}

function perturbAccuracyCase(points, d0, d3, dimension, amount) {
  const changedPoints = points.map((point) => ({ ...point }));
  let changedD0 = d0;
  let changedD3 = d3;
  if (dimension < 8) {
    const pointIndex = Math.floor(dimension / 2);
    const coordinate = dimension % 2 === 0 ? "x" : "y";
    changedPoints[pointIndex][coordinate] += amount;
  } else if (dimension === 8) {
    changedD0 += amount;
  } else {
    changedD3 += amount;
  }
  return requestFor(changedPoints, changedD0, changedD3);
}

describe("natural-handle-solver: perturbation continuity", () => {
  for (const [name, points, d0, d3] of accuracyCases) {
    it(`moves continuously for ${name}`, () => {
      const base = solveNaturalHandles(requestFor(points, d0, d3));
      for (let dimension = 0; dimension < 10; dimension++) {
        for (const sign of [-1, 1]) {
          const large = solveNaturalHandles(
            perturbAccuracyCase(points, d0, d3, dimension, sign * 1e-5)
          );
          const small = solveNaturalHandles(
            perturbAccuracyCase(points, d0, d3, dimension, sign * 5e-6)
          );
          const largeDelta = resultDelta(base, large);
          const smallDelta = resultDelta(base, small);
          const diagnostic =
            `${name}, dimension=${dimension}, sign=${sign}, ` +
            `large=${largeDelta}, small=${smallDelta}`;
          expect(largeDelta, diagnostic).to.be.below(1e-2);
          expect(smallDelta, diagnostic).to.be.below(1e-2);
          expect(smallDelta, diagnostic).to.be.at.most(largeDelta + 1e-8);
        }
      }
    });
  }
});

describe("natural-handle-solver: offset accuracy", () => {
  for (const [name, points, d0, d3, ceiling] of accuracyCases) {
    it(`records offset accuracy for ${name}`, () => {
      const before = measureCurrentOffset(points, d0, d3);
      const measured = measureNaturalOffset(points, d0, d3);
      const diagnostic =
        `before=${before}, after=${measured.maxDeviation}, ` +
        `delta=${measured.maxDeviation - before}, ` +
        `pull=${measured.pullWeightRatio}, rms=${measured.perpendicularRms}`;
      expect(Number.isFinite(before), diagnostic).to.equal(true);
      expect(Number.isFinite(measured.maxDeviation), diagnostic).to.equal(true);
      if (ceiling !== null) {
        expect(measured.maxDeviation, diagnostic).to.be.at.most(ceiling);
      }
    });
  }
});

describe("natural-handle-solver: U^1 sweep", () => {
  for (const [name, side] of Object.entries(u1Sides)) {
    it(`is monotone and continuous for ${name}`, () => {
      const { forward, reverse } = sweepRequests((scale) => u1RequestAt(scale, side));
      const { worstStep, worstBacktrack } = sweepMetrics(forward);
      const diagnostic = `worst step=${worstStep}, backtrack=${worstBacktrack}`;
      expect(worstBacktrack, diagnostic).to.be.at.most(1e-9);
      expect(worstStep, diagnostic).to.be.at.most(3);
      expect(reverse).to.deep.equal([...forward].reverse());
      for (const result of forward) {
        expect(Number.isFinite(result.pullWeightRatio)).to.equal(true);
        expect(Number.isFinite(result.perpendicularRms)).to.equal(true);
      }
    });
  }

  it("uses more pull for the unrepresentable side than a circular offset", () => {
    const circularPull = solveNaturalHandles(arcRequest(100, 25)).pullWeightRatio;
    const sidePull = solveNaturalHandles(
      u1RequestAt(1, u1Sides["single-sided right"])
    ).pullWeightRatio;
    expect(sidePull).to.be.above(circularPull);
  });

  for (const [name, d0, d3] of [
    ["taper left", 20, 110],
    ["taper right", -20, -110],
  ]) {
    it(`keeps adjacent steps bounded for ${name}`, () => {
      const { forward, reverse } = sweepRequests((scale) =>
        requestFor(scaledHandles(sCurve, scale), d0, d3)
      );
      const { worstStep } = sweepMetrics(forward);
      expect(worstStep, `worst step=${worstStep}`).to.be.at.most(3);
      expect(reverse).to.deep.equal([...forward].reverse());
    });
  }
});

describe("natural-handle-solver: near-cusp shape", () => {
  it("does not split normalized tensions by more than three", () => {
    for (let width = 10; width <= 160; width++) {
      const request = makeTightTurnRequest(width);
      const result = solveNaturalHandles(request);
      const start = result.startLength / request.handleDomain.startReach;
      const end = result.endLength / request.handleDomain.endReach;
      const ratio = Math.max(start, end) / Math.min(start, end);
      expect(ratio, `width=${width}, start=${start}, end=${end}`).to.be.at.most(3);
    }
  });
});

describe("natural-handle-solver: constrained answer", () => {
  it("keeps both lengths inside the positive non-crossing domain", () => {
    const request = {
      ...arcRequest(30, -80),
      startSignedWidth: -80,
      endSignedWidth: -80,
    };
    const { handleDomain } = request;
    const result = solveNaturalHandles(request);
    expect(result.startLength / handleDomain.startReach).to.be.within(
      handleDomain.minStartTension,
      handleDomain.maxStartTension
    );
    expect(result.endLength / handleDomain.endReach).to.be.within(
      handleDomain.minEndTension,
      handleDomain.maxEndTension
    );
  });

  for (const { name, points, expected } of [
    {
      name: "coincident controls",
      points: Array(4).fill({ x: 10, y: 10 }),
      expected: { startLength: 1, endLength: 1 },
    },
    {
      name: "retracted handles",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
      ],
      expected: { startLength: 1, endLength: 1 },
    },
    {
      name: "straight control polygon",
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 60, y: 0 },
        { x: 90, y: 0 },
      ],
      expected: { startLength: 30, endLength: 30 },
    },
  ]) {
    it(`returns the finite reference answer for ${name}`, () => {
      const start = points[0];
      const end = points[3];
      const startDirection = { x: 1, y: 0 };
      const endDirection = { x: -1, y: 0 };
      const startOutlinePoint = { x: start.x, y: start.y + 25 };
      const endOutlinePoint = { x: end.x, y: end.y + 25 };
      const result = solveNaturalHandles({
        skeletonControlPoints: points,
        startSignedWidth: 25,
        endSignedWidth: 25,
        startOutlinePoint,
        endOutlinePoint,
        startHandleDirection: startDirection,
        endHandleDirection: endDirection,
        handleDomain: buildHandleDomain(
          startOutlinePoint,
          endOutlinePoint,
          startDirection,
          endDirection
        ),
      });
      expect(Number.isFinite(result.startLength)).to.equal(true);
      expect(Number.isFinite(result.endLength)).to.equal(true);
      expect(result.startLength).to.be.closeTo(expected.startLength, 1e-6);
      expect(result.endLength).to.be.closeTo(expected.endLength, 1e-6);
    });
  }

  it("meets the representative coordinate-step ceiling", () => {
    const base = makeTightTurnRequest(120);
    const points = base.skeletonControlPoints.map((point, index) =>
      index === 1 ? { ...point, x: point.x + 1 } : point
    );
    const perturbed = requestFor(points, base.startSignedWidth, base.endSignedWidth);
    const before = solveNaturalHandles(base);
    const after = solveNaturalHandles(perturbed);
    const moved = Math.max(
      Math.abs(after.startLength - before.startLength),
      Math.abs(after.endLength - before.endLength)
    );
    expect(moved).to.be.at.most(3);
  });

  it("takes the reference tension along a rank-one null direction", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ];
    const startOutlinePoint = { x: 0, y: 25 };
    const endOutlinePoint = { x: 90, y: 25 };
    const startHandleDirection = { x: 1, y: 0 };
    const endHandleDirection = { x: 0, y: -1 };
    const domain = buildHandleDomain(
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection
    );
    const result = solveNaturalHandles({
      skeletonControlPoints: points,
      startSignedWidth: 25,
      endSignedWidth: 25,
      startOutlinePoint,
      endOutlinePoint,
      startHandleDirection,
      endHandleDirection,
      handleDomain: domain,
    });
    const expected = (30 / 180) * domain.startReach;
    expect(result.startLength).to.be.closeTo(expected, 1e-9);
  });
});
