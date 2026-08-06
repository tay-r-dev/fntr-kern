import {
  buildHalfSerif,
  buildSerifTerminal,
  computeSerifFrame,
  maxSerifEaseDistance,
} from "@fontra/core/serif-geometry.js";
import { expect } from "chai";

const CLOSE = 1e-9;

function expectClose(actual, expected, message) {
  expect(Math.abs(actual - expected), message).to.be.below(1e-6);
}

describe("serif frame", () => {
  // A stem running upward, terminal at the bottom, so the outward tangent
  // points down. rotateVector90CW of the upward direction is (1, 0), which the
  // generator treats as the left side.
  const downTerminal = {
    endpoint: { x: 0, y: 0 },
    tangent: { x: 0, y: -1 },
    normal: { x: 1, y: 0 },
  };

  it("puts the axis perpendicular to the tangent by default", () => {
    const frame = computeSerifFrame({ ...downTerminal, axisMode: "perpendicular" });
    expectClose(frame.axis.x, 1);
    expectClose(frame.axis.y, 0);
  });

  it("points the depth back into the stroke", () => {
    const frame = computeSerifFrame({ ...downTerminal, axisMode: "perpendicular" });
    expectClose(frame.depth.x, 0);
    expectClose(frame.depth.y, 1);
  });

  it("orients the axis toward the left side", () => {
    const frame = computeSerifFrame({ ...downTerminal, axisMode: "perpendicular" });
    expect(
      frame.axis.x * downTerminal.normal.x + frame.axis.y * downTerminal.normal.y
    ).to.be.above(0);
  });

  it("holds a horizontal axis while the tangent rotates", () => {
    for (const degrees of [-60, -30, 30, 60]) {
      const radians = (degrees * Math.PI) / 180;
      const tangent = { x: Math.sin(radians), y: -Math.cos(radians) };
      const frame = computeSerifFrame({
        endpoint: { x: 0, y: 0 },
        tangent,
        normal: { x: Math.cos(radians), y: Math.sin(radians) },
        axisMode: "horizontal",
      });
      expectClose(Math.abs(frame.axis.y), 0, `axis stayed horizontal at ${degrees}`);
    }
  });

  it("uses the absolute angle when asked", () => {
    const frame = computeSerifFrame({
      ...downTerminal,
      axisMode: "absolute",
      axisAngle: 30,
    });
    expectClose(frame.axis.x, Math.cos(Math.PI / 6));
    expectClose(frame.axis.y, Math.sin(Math.PI / 6));
  });

  it("keeps the axis at least 15 degrees off the tangent", () => {
    // Horizontal axis on a horizontal stroke would collapse the frame.
    const frame = computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: -1 },
      axisMode: "horizontal",
    });
    const cross = Math.abs(frame.axis.x * 0 - frame.axis.y * 1);
    expectClose(cross, Math.sin((15 * Math.PI) / 180));
  });

  it("keeps axis and depth orthonormal in every mode", () => {
    for (const axisMode of ["perpendicular", "horizontal", "vertical", "absolute"]) {
      const frame = computeSerifFrame({ ...downTerminal, axisMode, axisAngle: 20 });
      expectClose(
        Math.hypot(frame.axis.x, frame.axis.y),
        1,
        `axis unit in ${axisMode}`
      );
      expectClose(
        Math.hypot(frame.depth.x, frame.depth.y),
        1,
        `depth unit in ${axisMode}`
      );
      expectClose(
        frame.axis.x * frame.depth.x + frame.axis.y * frame.depth.y,
        0,
        `orthogonal in ${axisMode}`
      );
    }
  });

  it("round-trips a point through frame and glyph coordinates", () => {
    const frame = computeSerifFrame({
      ...downTerminal,
      axisMode: "absolute",
      axisAngle: 37,
    });
    const original = { x: 12.5, y: -8.25 };
    const back = frame.toGlyph(frame.toFrame(original));
    expectClose(back.x, original.x);
    expectClose(back.y, original.y);
  });
});

describe("half serif in frame coordinates", () => {
  const base = {
    wingLength: 60,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 80,
    tension: 0.7,
    concavity: 0.8,
  };
  const build = (overrides = {}, side = 1) =>
    buildHalfSerif({
      side,
      flankU: side * 50,
      params: { ...base, ...overrides },
    });

  it("puts the tip bottom on the foot line, out past the flank", () => {
    const half = build();
    expectClose(half.tipBottom.v, 0);
    expectClose(half.tipBottom.u, 110);
  });

  it("raises the tip top by the tip thickness", () => {
    const half = build();
    expectClose(half.tipTop.u, 110);
    expectClose(half.tipTop.v, 30);
  });

  it("splays the tip with a positive cut angle", () => {
    const half = build({ tipCutAngle: 45 });
    // The outer edge leans out by tipThickness * tan(45) = 30.
    expectClose(half.tipBottom.u, 140);
    expectClose(half.tipTop.u, 110);
  });

  it("mirrors every u for the right half", () => {
    const left = build();
    const right = build({}, -1);
    expectClose(right.tipBottom.u, -left.tipBottom.u);
    expectClose(right.tipTop.v, left.tipTop.v);
  });

  it("puts the junction reach above the wing inner corner, on the flank", () => {
    const half = build({ wingSlope: 12 });
    expectClose(half.wingInnerV, 42);
    expectClose(half.corner.v, 42);
    expectClose(half.junction.v, 122);
    expectClose(half.junction.u, 50);
  });

  const belly = (half) => {
    const p = [half.tipTop, half.control1, half.control2, half.junction];
    return {
      u: (p[0].u + 3 * p[1].u + 3 * p[2].u + p[3].u) / 8,
      v: (p[0].v + 3 * p[1].v + 3 * p[2].v + p[3].v) / 8,
    };
  };

  const chordVAt = (half, u) =>
    half.tipTop.v +
    ((u - half.tipTop.u) / (half.junction.u - half.tipTop.u)) *
      (half.junction.v - half.tipTop.v);

  it("collapses the transition to the chord at concavity zero", () => {
    for (const tension of [0, 0.5, 1]) {
      const half = build({ tension, concavity: 0 });
      expectClose(half.control1.v, chordVAt(half, half.control1.u));
      expectClose(half.control2.v, chordVAt(half, half.control2.u));
    }
  });

  it("collapses the transition to the chord at tension zero", () => {
    for (const concavity of [-1, 0.5, 1]) {
      const half = build({ tension: 0, concavity });
      expectClose(half.control1.u, half.tipTop.u);
      expectClose(half.control1.v, half.tipTop.v);
      expectClose(half.control2.u, half.junction.u);
      expectClose(half.control2.v, half.junction.v);
    }
  });

  it("puts both handles on the wing's inner corner at full tension and concavity", () => {
    const half = build({ tension: 1, concavity: 1 });
    expectClose(half.control1.u, half.corner.u);
    expectClose(half.control1.v, half.corner.v);
    expectClose(half.control2.u, half.corner.u);
    expectClose(half.control2.v, half.corner.v);
  });

  it("leaves the junction tangent to the flank at full concavity", () => {
    for (const tension of [0.2, 0.6, 1]) {
      const half = build({ tension, concavity: 1 });
      expectClose(half.control2.u, half.junction.u, `tension ${tension}`);
    }
  });

  it("deepens the bracket with concavity", () => {
    const flat = belly(build({ concavity: 0 })).v;
    const shallow = belly(build({ concavity: 0.25 })).v;
    const deep = belly(build({ concavity: 1 })).v;
    expect(deep).to.be.below(shallow);
    expect(shallow).to.be.below(flat);
  });

  it("bulges the transition convex at negative concavity", () => {
    const bulged = belly(build({ concavity: -0.8 })).v;
    const flat = belly(build({ concavity: 0 })).v;
    expect(bulged).to.be.above(flat);
  });

  it("deepens the bracket with tension, at one attractor", () => {
    const slack = belly(build({ tension: 0.2, concavity: 0.8 })).v;
    const taut = belly(build({ tension: 0.9, concavity: 0.8 })).v;
    expect(taut).to.be.below(slack);
  });

  it("does not let wing slope and reach stand in for each other", () => {
    const bySlope = build({ wingSlope: 40, reach: 0, concavity: 0.8 });
    const byReach = build({ wingSlope: 0, reach: 40, concavity: 0.8 });
    expectClose(bySlope.junction.v, byReach.junction.v);
    expect(Math.abs(bySlope.control1.v - byReach.control1.v)).to.be.above(1);
  });

  it("keeps a wingless half flat on the flank without a special case", () => {
    const half = build({ wingLength: 0, concavity: 1, tension: 1 });
    for (const point of [
      half.tipTop,
      half.tipBottom,
      half.corner,
      half.junction,
      half.control1,
      half.control2,
    ]) {
      expectClose(point.u, 50);
    }
  });

  it("returns the same key set at every value", () => {
    const keys = (params) => Object.keys(build(params)).sort().join(",");
    expect(keys({})).to.equal(keys({ wingLength: 0, reach: 0, concavity: -1 }));
  });

  const eased = (overrides = {}) =>
    build({ concavity: -0.4, easeDistance: 20, easeCurvature: 0.6, ...overrides });

  it("puts the release back along the flank by the ease distance", () => {
    const half = eased();
    expectClose(half.release.u, half.junction.u);
    expectClose(half.release.v - half.junction.v, 20);
  });

  // The rounding is one curve across a corner. Both of its ends step back from
  // that corner by the ease distance, each along its own surface. One end
  // measured in units and the other in curve parameter is what made the two
  // sides of the scoop grow at different rates and stop at different times.
  it("steps both ends back from the junction by the same distance", () => {
    const gap = (point, other) => Math.hypot(point.u - other.u, point.v - other.v);
    for (const easeDistance of [5, 20, 40]) {
      const half = eased({ easeDistance });
      expectClose(
        gap(half.easeOnBracket, half.junction),
        gap(half.release, half.junction),
        `ease distance ${easeDistance}`
      );
    }
  });

  // The rounding runs out where the bracket meets the wing, and not before.
  // The bracket end lands on the top of the tip, having eaten the whole
  // bracket, and the flank end is the same distance from the junction.
  it("stops both ends where the bracket meets the wing", () => {
    const gap = (point, other) => Math.hypot(point.u - other.u, point.v - other.v);
    const far = eased({ easeDistance: 4000 });
    expectClose(far.easeOnBracket.u, far.tipTop.u);
    expectClose(far.easeOnBracket.v, far.tipTop.v);
    expectClose(far.release.v - far.junction.v, gap(far.tipTop, far.junction));
  });

  // The scrub reads its ceiling from here, so it has to agree with the shape.
  it("reports the ease ceiling the geometry actually stops at", () => {
    const params = { wingLength: 60, wingSlope: 10, reach: 30 };
    const half = build({ ...params, easeDistance: 4000 });
    expectClose(
      maxSerifEaseDistance(params),
      Math.hypot(half.tipTop.u - half.junction.u, half.tipTop.v - half.junction.v)
    );
  });

  it("collapses the rounding onto the junction at ease distance zero", () => {
    const half = eased({ easeDistance: 0 });
    for (const point of [
      half.release,
      half.easeFlankHandle,
      half.easeOnBracket,
      half.easeBracketHandle,
    ]) {
      expectClose(point.u, half.junction.u);
      expectClose(point.v, half.junction.v);
    }
  });

  const legs = (half) => ({
    flank: Math.hypot(
      half.easeFlankHandle.u - half.release.u,
      half.easeFlankHandle.v - half.release.v
    ),
    bracket: Math.hypot(
      half.easeBracketHandle.u - half.easeOnBracket.u,
      half.easeBracketHandle.v - half.easeOnBracket.v
    ),
  });

  it("gives the rounding two handles of equal length", () => {
    // A rounding is symmetric or it is not a rounding. Pulling each handle
    // toward its own neighbour instead makes the two legs different lengths,
    // because the split bracket's control leg has nothing to do with the ease
    // distance, and the curve reads as a lopsided scoop.
    for (const concavity of [-0.9, -0.4, 0, 0.5, 0.95]) {
      for (const easeCurvature of [0.2, 0.6, 1]) {
        const half = eased({ concavity, easeCurvature });
        const { flank, bracket } = legs(half);
        expectClose(
          flank,
          bracket,
          `concavity ${concavity} curvature ${easeCurvature}`
        );
        expect(flank).to.be.above(0);
      }
    }
  });

  it("runs the flank handle along the flank and the other along the bracket", () => {
    const half = eased();
    // The flank leg is on the flank line, straight toward the junction.
    expectClose(half.easeFlankHandle.u, half.release.u);
    expect(half.easeFlankHandle.v).to.be.below(half.release.v);
    // The bracket leg continues the bracket's own tangent at the landing point,
    // which is the direction from its incoming handle to the landing point.
    const tangent = {
      u: half.easeOnBracket.u - half.control2.u,
      v: half.easeOnBracket.v - half.control2.v,
    };
    const leg = {
      u: half.easeBracketHandle.u - half.easeOnBracket.u,
      v: half.easeBracketHandle.v - half.easeOnBracket.v,
    };
    expectClose(tangent.u * leg.v - tangent.v * leg.u, 0);
  });

  it("collapses both handles onto their own ends at zero curvature", () => {
    const half = eased({ easeCurvature: 0 });
    const { flank, bracket } = legs(half);
    expectClose(flank, 0);
    expectClose(bracket, 0);
  });

  it("keeps the rounding on a hollow bracket", () => {
    // Only a fully scooped wing snaps it off. Anything short of that still has
    // a corner at the junction and still wants it rounded.
    const half = build({ concavity: 0.4, easeDistance: 20, easeCurvature: 0.6 });
    expectClose(half.release.v - half.junction.v, 20);
    expect(legs(half).flank).to.be.above(0);
  });

  it("snaps the rounding off at full concavity", () => {
    const half = build({ concavity: 1, easeDistance: 20, easeCurvature: 0.6 });
    expectClose(half.release.v, half.junction.v);
    expectClose(half.easeOnBracket.u, half.junction.u);
  });
});

describe("serif terminal assembly", () => {
  const half = {
    wingLength: 60,
    tipThickness: 30,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 80,
    tension: 0.7,
    concavity: 0.8,
  };

  function terminal(overrides = {}) {
    const frame = computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: 0, y: -1 },
      normal: { x: 1, y: 0 },
      axisMode: "perpendicular",
    });
    return buildSerifTerminal({
      frame,
      leftFlankU: 50,
      rightFlankU: -50,
      left: half,
      right: half,
      undersideCup: 0,
      ...overrides,
    });
  }

  it("emits exactly seven on-curve points", () => {
    const { points } = terminal();
    expect(points.filter((point) => !point.type)).to.have.length(7);
  });

  it("keeps seven on-curve points at every degenerate value", () => {
    const flat = {
      wingLength: 0,
      tipThickness: 0,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 0,
      tension: 0,
      concavity: 0,
    };
    const { points } = terminal({ left: flat, right: flat, undersideCup: 0 });
    expect(points.filter((point) => !point.type)).to.have.length(7);
  });

  it("keeps seven on-curve points with the rounding switched on", () => {
    const rounded = { ...half, concavity: -0.4, easeDistance: 20, easeCurvature: 0.6 };
    const { points } = terminal({ left: rounded, right: rounded });
    expect(points.filter((point) => !point.type)).to.have.length(7);
  });

  it("starts and ends with a handle, not an on-curve", () => {
    const { points } = terminal();
    expect(points[0].type).to.equal("cubic");
    expect(points[points.length - 1].type).to.equal("cubic");
  });

  it("puts the foot centre on the skeleton endpoint with no cup", () => {
    const { points } = terminal();
    const centre = points.filter((point) => !point.type)[3];
    expect(Math.abs(centre.x)).to.be.below(1e-9);
    expect(Math.abs(centre.y)).to.be.below(1e-9);
  });

  it("lifts the foot centre by the cup amount, along the depth", () => {
    const { points } = terminal({ undersideCup: 18 });
    const centre = points.filter((point) => !point.type)[3];
    expectClose(centre.y, 18);
  });

  // The cup is two numbers: the depth places the foot centre, the tension sets
  // how long the four handles that reach it are. Tension 1 puts each pair on
  // the middle of its own half-span, which is as full as the sweep gets before
  // the two handles of one segment change places.
  describe("underside cup tension", () => {
    // The four controls between the two tip bottoms, in emission order.
    const cupControls = (overrides) =>
      terminal(overrides)
        .points.slice(7, 9)
        .concat(terminal(overrides).points.slice(10, 12));

    it("defaults to the shape it drew before the control existed", () => {
      const [first] = cupControls({ undersideCup: 18 });
      const tipBottom = terminal({ undersideCup: 18 }).points.filter(
        (point) => !point.type
      )[2];
      expectClose(first.x, tipBottom.x - (tipBottom.x - 0) * (1 / 3));
    });

    it("collapses every handle onto its own end at tension 0", () => {
      const points = terminal({ undersideCup: 18, undersideCupTension: 0 }).points;
      const onCurve = points.filter((point) => !point.type);
      expectClose(points[7].x, onCurve[2].x);
      expectClose(points[8].x, onCurve[3].x);
      expectClose(points[10].x, onCurve[3].x);
      expectClose(points[11].x, onCurve[4].x);
    });

    it("puts both handles of a half on its midpoint at tension 1", () => {
      const points = terminal({ undersideCup: 18, undersideCupTension: 1 }).points;
      const onCurve = points.filter((point) => !point.type);
      const midpoint = (onCurve[2].x + onCurve[3].x) / 2;
      expectClose(points[7].x, midpoint);
      expectClose(points[8].x, midpoint);
    });

    it("keeps each handle at its own end's depth, whatever the tension", () => {
      const points = terminal({ undersideCup: 18, undersideCupTension: 0.8 }).points;
      const onCurve = points.filter((point) => !point.type);
      expectClose(points[7].y, onCurve[2].y);
      expectClose(points[8].y, onCurve[3].y);
    });

    it("still emits seven on-curve points at either extreme", () => {
      for (const undersideCupTension of [0, 1]) {
        const { points } = terminal({ undersideCup: 18, undersideCupTension });
        expect(points.filter((point) => !point.type)).to.have.length(7);
      }
    });
  });

  it("keeps the foot centre on the skeleton when the halves are unequal", () => {
    const { points } = terminal({
      left: { ...half, wingLength: 20 },
      right: { ...half, wingLength: 120 },
    });
    const centre = points.filter((point) => !point.type)[3];
    expect(Math.abs(centre.x)).to.be.below(1e-9);
  });

  it("runs from the left release to the right release", () => {
    const { points } = terminal();
    const onCurve = points.filter((point) => !point.type);
    expect(onCurve[0].x).to.be.above(0);
    expect(onCurve[6].x).to.be.below(0);
  });

  it("emits one cup curve across the whole foot, not one per half", () => {
    const { points } = terminal({ undersideCup: 18 });
    const centreIndex = points.findIndex(
      (point) => !point.type && Math.abs(point.y - 18) < 1e-9
    );
    expect(points[centreIndex - 1].type).to.equal("cubic");
    expect(points[centreIndex + 1].type).to.equal("cubic");
  });

  it("leaves the foot tangent to the baseline at the tips and flat at the centre", () => {
    const { points } = terminal({ undersideCup: 18 });
    const centreIndex = points.findIndex(
      (point) => !point.type && Math.abs(point.y - 18) < 1e-9
    );
    expectClose(points[centreIndex - 2].y, 0);
    expectClose(points[centreIndex - 1].y, 18);
  });

  it("returns the frame-space halves for the caller's trimming maths", () => {
    const { halves } = terminal();
    expectClose(halves.left.junction.u, 50);
    expectClose(halves.right.junction.u, -50);
  });
});
