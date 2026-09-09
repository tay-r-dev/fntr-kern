import {
  buildHalfSerif,
  buildSerifTerminal,
  computeSerifFrame,
  makeSerifWall,
  maxSerifEaseDistance,
} from "@fontra/core/serif-geometry.js";
import { expect } from "chai";

const CLOSE = 1e-9;

// A wall standing straight up the frame's depth from `u`. This is exactly what
// the old straight-flank model assumed, so every test built on it keeps its
// existing expected numbers — which is the evidence a straight stem does not
// move.
const wallAt = (u) =>
  makeSerifWall([
    { u, v: 0 },
    { u, v: 1000 },
  ]);

function expectClose(actual, expected, message, tolerance = 1e-6) {
  expect(Math.abs(actual - expected), message).to.be.below(tolerance);
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

  it("runs the perpendicular axis along the rib, not square to the tangent", () => {
    // A rib angle lock forces the rib onto an axis whatever way the centerline
    // arrives. "Perpendicular to the stroke" is the foot that sits on the rib,
    // so the lock has to reach the serif through it.
    for (const degrees of [-60, -30, 30, 60]) {
      const radians = (degrees * Math.PI) / 180;
      const tangent = { x: Math.sin(radians), y: -Math.cos(radians) };
      const frame = computeSerifFrame({
        endpoint: { x: 0, y: 0 },
        tangent,
        normal: { x: 1, y: 0 }, // the rib, locked horizontal
        axisMode: "perpendicular",
      });
      expectClose(Math.abs(frame.axis.y), 0, `foot stayed on the rib at ${degrees}`);
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
    for (const axisMode of [
      "perpendicular",
      "horizontal",
      "vertical",
      "absolute",
      "tilt",
    ]) {
      const frame = computeSerifFrame({
        ...downTerminal,
        axisMode,
        axisAngle: 20,
        axisTilt: 20,
      });
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

describe("serif axis tilt", () => {
  // One upright stroke, drawn from the bottom up, so its two terminals share a
  // rib normal and face opposite ways.
  const startTerminal = {
    endpoint: { x: 0, y: 0 },
    tangent: { x: 0, y: -1 },
    normal: { x: 1, y: 0 },
  };
  const endTerminal = {
    endpoint: { x: 0, y: 500 },
    tangent: { x: 0, y: 1 },
    normal: { x: 1, y: 0 },
  };

  const dot = (a, b) => a.x * b.x + a.y * b.y;

  it("turns the axis off the rib by the stated angle", () => {
    const base = computeSerifFrame({ ...startTerminal, axisMode: "perpendicular" });
    for (const degrees of [-40, -12, 12, 40]) {
      const radians = (degrees * Math.PI) / 180;
      const frame = computeSerifFrame({
        ...startTerminal,
        axisMode: "tilt",
        axisTilt: degrees,
      });
      expectClose(
        dot(frame.axis, base.axis),
        Math.cos(radians),
        `tilt along the axis at ${degrees}`
      );
      expectClose(
        dot(frame.axis, base.depth),
        Math.sin(radians),
        `tilt toward the depth at ${degrees}`
      );
    }
  });

  it("reads the same at both ends of one stroke", () => {
    // The tilt is applied after the axis is oriented toward the contour's left,
    // so it means the same thing at a start terminal and an end terminal.
    // Rotated before that orientation, one number turns the two frames opposite
    // ways on one and the same stroke.
    for (const degrees of [-30, 30]) {
      const radians = (degrees * Math.PI) / 180;
      for (const terminal of [startTerminal, endTerminal]) {
        const base = computeSerifFrame({ ...terminal, axisMode: "perpendicular" });
        const frame = computeSerifFrame({
          ...terminal,
          axisMode: "tilt",
          axisTilt: degrees,
        });
        expectClose(dot(frame.axis, base.axis), Math.cos(radians));
        expectClose(dot(frame.axis, base.depth), Math.sin(radians));
      }
    }
  });

  it("draws the perpendicular at a tilt of zero", () => {
    for (const degrees of [-40, 0, 25]) {
      const radians = (degrees * Math.PI) / 180;
      const terminal = {
        endpoint: { x: 0, y: 0 },
        tangent: { x: Math.sin(radians), y: -Math.cos(radians) },
        normal: { x: Math.cos(radians), y: Math.sin(radians) },
      };
      const base = computeSerifFrame({ ...terminal, axisMode: "perpendicular" });
      const frame = computeSerifFrame({ ...terminal, axisMode: "tilt", axisTilt: 0 });
      expectClose(frame.axis.x, base.axis.x, `axis x at lean ${degrees}`);
      expectClose(frame.axis.y, base.axis.y, `axis y at lean ${degrees}`);
      expectClose(frame.depth.x, base.depth.x, `depth x at lean ${degrees}`);
      expectClose(frame.depth.y, base.depth.y, `depth y at lean ${degrees}`);
    }
  });

  it("follows the stroke, which is the whole difference from an absolute angle", () => {
    // The tilt is stated against the rib, so the angle between the two holds
    // however the stroke leans. An absolute angle is a direction in glyph space
    // and does not.
    for (const lean of [-40, -15, 15, 40]) {
      const radians = (lean * Math.PI) / 180;
      const terminal = {
        endpoint: { x: 0, y: 0 },
        tangent: { x: Math.sin(radians), y: -Math.cos(radians) },
        normal: { x: Math.cos(radians), y: Math.sin(radians) },
      };
      const base = computeSerifFrame({ ...terminal, axisMode: "perpendicular" });
      const frame = computeSerifFrame({
        ...terminal,
        axisMode: "tilt",
        axisTilt: 20,
      });
      expectClose(
        dot(frame.axis, base.axis),
        Math.cos((20 * Math.PI) / 180),
        `tilt held against the rib at lean ${lean}`
      );
    }
  });

  it("is held off the tangent by the guard that was already there", () => {
    // A tilt of 89 degrees would lay the axis along the stroke. The separation
    // runs after the tilt, so this is the same clamp an absolute angle meets.
    const frame = computeSerifFrame({
      ...startTerminal,
      axisMode: "tilt",
      axisTilt: 89,
    });
    const tangent = startTerminal.tangent;
    expectClose(
      Math.abs(frame.axis.x * tangent.y - frame.axis.y * tangent.x),
      Math.sin((15 * Math.PI) / 180)
    );
    // Still on the left, which is what the second orientation pass is for.
    expect(dot(frame.axis, startTerminal.normal)).to.be.above(0);
  });

  it("clamps to the near side of the tangent, not across it", () => {
    // An axis five degrees off the stroke belongs fifteen degrees off on the
    // side it came in on. Pushed across, it leaves thirty degrees from where it
    // arrived, which under a tilt is a 150 degree flip of the whole frame at one
    // value of one slider. Stated on an absolute angle, because the fault was
    // reachable there before the tilt existed.
    const frame = computeSerifFrame({
      ...startTerminal,
      axisMode: "absolute",
      axisAngle: -85,
    });
    expectClose(frame.axis.x, Math.cos((-75 * Math.PI) / 180));
    expectClose(frame.axis.y, Math.sin((-75 * Math.PI) / 180));
  });

  it("ignores the tilt in every other mode", () => {
    for (const axisMode of ["perpendicular", "horizontal", "vertical", "absolute"]) {
      const without = computeSerifFrame({ ...startTerminal, axisMode, axisAngle: 20 });
      const with_ = computeSerifFrame({
        ...startTerminal,
        axisMode,
        axisAngle: 20,
        axisTilt: 35,
      });
      expectClose(with_.axis.x, without.axis.x, `axis x in ${axisMode}`);
      expectClose(with_.axis.y, without.axis.y, `axis y in ${axisMode}`);
    }
  });

  // A sweep rather than an assertion, per the log's own rule: hold the geometry
  // fixed, walk the tilt through its range in fine steps, and measure the worst
  // single-step movement of any emitted point against the step the driver took.
  //
  // The range swept is the range offered, plus or minus 40. Past that the wing
  // runs so far along the stem that the construction's own searches meet the
  // wall tangentially, and the shape steps: measured at 38 (the documented
  // wing-swallowed snap), 47 (the tip's line stops crossing the wall) and 66
  // (the corner ray runs parallel to it). None of the three belongs to the tilt.
  // Each is reachable today through an absolute axis at the same effective
  // angle, and each is its own piece of work.
  it("moves the terminal continuously across the range it is offered", () => {
    const params = {
      wingLength: 40,
      tipThickness: 20,
      wingSlope: 20,
      tipCutAngle: 0,
      reach: 30,
      tension: 0.5,
      concavity: 0.5,
      easeDistance: 12,
      easeCurvature: 0.5,
    };
    // Both walls in glyph space, curving into the stroke. They stand still; only
    // the frame turns.
    const leftWallPoints = [
      { x: 50, y: 0 },
      { x: 50, y: 200 },
      { x: 70, y: 400 },
      { x: 90, y: 600 },
    ];
    const rightWallPoints = leftWallPoints.map((point) => ({
      x: -point.x,
      y: point.y,
    }));
    const terminalAt = (axisTilt) => {
      const frame = computeSerifFrame({
        ...startTerminal,
        axisMode: "tilt",
        axisTilt,
      });
      const wall = (points) => makeSerifWall(points.map((p) => frame.toFrame(p)));
      return buildSerifTerminal({
        frame,
        leftWall: wall(leftWallPoints),
        rightWall: wall(rightWallPoints),
        left: params,
        right: params,
        undersideCup: 10,
        undersideCupBalance: 0,
      }).points;
    };

    const step = 0.5;
    let worst = 0;
    let worstAt = 0;
    let previous = terminalAt(-37);
    for (let tilt = -37 + step; tilt <= 37 + 1e-9; tilt += step) {
      const current = terminalAt(tilt);
      expect(current.length).to.equal(previous.length);
      for (let i = 0; i < current.length; i++) {
        const moved = Math.hypot(
          current[i].x - previous[i].x,
          current[i].y - previous[i].y
        );
        if (moved > worst) {
          worst = moved;
          worstAt = tilt;
        }
      }
      previous = current;
    }
    // The whole movement here is the rotation: the furthest point turns 0.83
    // units per half degree. The bound is that and nothing more, so a branch
    // change of even a few units fails rather than hiding inside headroom.
    expect(worst, `worst step ${worst.toFixed(2)} at tilt ${worstAt}`).to.be.below(1);
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
      wall: wallAt(side * 50),
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
      leftWall: wallAt(50),
      rightWall: wallAt(-50),
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

  it("puts the foot centre midway between the two tips with no cup", () => {
    const { points } = terminal();
    const onCurve = points.filter((point) => !point.type);
    const centre = onCurve[3];
    expectClose(centre.x, (onCurve[2].x + onCurve[4].x) / 2);
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

  it("moves the foot centre with the tips when the halves are unequal", () => {
    const { points } = terminal({
      left: { ...half, wingLength: 20 },
      right: { ...half, wingLength: 120 },
    });
    const onCurve = points.filter((point) => !point.type);
    const centre = onCurve[3];
    expectClose(centre.x, (onCurve[2].x + onCurve[4].x) / 2);
    // Left tip at 50 + 20, right tip at −50 − 120: the middle of the drawn foot
    // sits well off the skeleton.
    expectClose(centre.x, -50);
  });

  // Single-sided mode collapses one half to zeros, so the whole terminal sits on
  // one side of the skeleton. A centre pinned to the skeleton lands on the foot's
  // own edge there and the cup reads as a lopsided scoop.
  it("centres the cup on the one wing a collapsed half leaves", () => {
    const zeros = {
      wingLength: 0,
      tipThickness: 0,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 0,
      tension: 0,
      concavity: 0,
    };
    const { points } = terminal({
      leftWall: wallAt(100),
      rightWall: wallAt(0),
      right: zeros,
      undersideCup: 18,
    });
    const onCurve = points.filter((point) => !point.type);
    expectClose(onCurve[3].x, (onCurve[2].x + onCurve[4].x) / 2);
    expectClose(onCurve[3].x, 80);
  });

  it("keeps seven on-curve points with one half collapsed", () => {
    const zeros = {
      wingLength: 0,
      tipThickness: 0,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 0,
      tension: 0,
      concavity: 0,
    };
    const { points } = terminal({
      leftWall: wallAt(100),
      rightWall: wallAt(0),
      right: zeros,
    });
    expect(points.filter((point) => !point.type)).to.have.length(7);
  });

  // The balance slides the centre along the axis, as a fraction of the half-span
  // between the two tips. Zero is the midpoint, so a foot drawn before the
  // control existed does not move.
  describe("underside cup balance", () => {
    const centreOf = (overrides) =>
      terminal(overrides).points.filter((point) => !point.type)[3];

    it("draws the midpoint at zero", () => {
      expectClose(centreOf({ undersideCupBalance: 0 }).x, centreOf({}).x);
    });

    it("carries the centre onto a tip at either extreme", () => {
      const onCurve = terminal().points.filter((point) => !point.type);
      expectClose(centreOf({ undersideCupBalance: 1 }).x, onCurve[2].x);
      expectClose(centreOf({ undersideCupBalance: -1 }).x, onCurve[4].x);
    });

    it("moves it a fraction of the half-span in between", () => {
      const onCurve = terminal().points.filter((point) => !point.type);
      const middle = (onCurve[2].x + onCurve[4].x) / 2;
      const halfSpan = (onCurve[2].x - onCurve[4].x) / 2;
      expectClose(centreOf({ undersideCupBalance: 0.5 }).x, middle + halfSpan / 2);
    });

    it("stops at the tips rather than running past them", () => {
      const onCurve = terminal().points.filter((point) => !point.type);
      expectClose(centreOf({ undersideCupBalance: 4 }).x, onCurve[2].x);
      expectClose(centreOf({ undersideCupBalance: -4 }).x, onCurve[4].x);
    });

    it("keeps the centre's depth whatever the balance", () => {
      for (const undersideCupBalance of [-1, -0.3, 0, 0.6, 1]) {
        expectClose(centreOf({ undersideCup: 18, undersideCupBalance }).y, 18);
      }
    });

    it("keeps seven on-curve points at either extreme", () => {
      for (const undersideCupBalance of [-1, 1]) {
        const { points } = terminal({ undersideCup: 18, undersideCupBalance });
        expect(points.filter((point) => !point.type)).to.have.length(7);
      }
    });

    // The sweep's two halves are wildly unequal here, and each handle still
    // takes its own end's depth, so the foot arrives flat at the centre and
    // leaves the tips along the baseline however far it is pushed.
    it("keeps each cup handle at its own end's depth off centre", () => {
      const points = terminal({
        undersideCup: 18,
        undersideCupBalance: 0.8,
      }).points;
      const onCurve = points.filter((point) => !point.type);
      expectClose(points[7].y, onCurve[2].y);
      expectClose(points[8].y, onCurve[3].y);
      expectClose(points[10].y, onCurve[3].y);
      expectClose(points[11].y, onCurve[4].y);
    });
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

describe("a serif frame the stroke is not square to", () => {
  // A rib angle lock holds the rib flat while the stem leans, and the three
  // named axis modes state a direction outright, so the axis is routinely not
  // square to the stroke. The wall still leaves the rib end along the stroke.
  // Everything the serif hands back to the wall therefore has to be found on
  // that line — measured straight up the frame instead it slides sideways, the
  // same way on both sides, so one wall moves in and the other out.
  function tilted(degrees) {
    const radians = (degrees * Math.PI) / 180;
    return {
      // Into the stroke, along the wall.
      inward: { x: Math.sin(radians), y: Math.cos(radians) },
      frame: computeSerifFrame({
        endpoint: { x: 0, y: 0 },
        tangent: { x: -Math.sin(radians), y: -Math.cos(radians) },
        normal: { x: 1, y: 0 }, // the rib, locked horizontal
        axisMode: "perpendicular",
      }),
    };
  }

  const params = {
    wingLength: 40,
    tipThickness: 20,
    wingSlope: 20,
    tipCutAngle: 0,
    reach: 30,
    tension: 0.5,
    concavity: 0.5,
    easeDistance: 15,
    easeCurvature: 0.5,
  };
  const tilts = [-40, -20, 20, 40];
  // The wall leaves the rib end along the stroke, so in the frame it is the line
  // from the rib end along `inward`. On a lean that is not the frame's own depth
  // axis, which is the whole point of these tests.
  const half = (frame, inward, side) => {
    const ribEnd = frame.toGlyph({ u: side * 50, v: 0 });
    const far = { x: ribEnd.x + inward.x * 1000, y: ribEnd.y + inward.y * 1000 };
    const wall = makeSerifWall([frame.toFrame(ribEnd), frame.toFrame(far)]);
    return buildHalfSerif({ side, wall, params });
  };

  it("keeps the junction, corner and release on the wall", () => {
    for (const degrees of tilts) {
      const { frame, inward } = tilted(degrees);
      for (const side of [1, -1]) {
        const ribEnd = frame.toGlyph({ u: side * 50, v: 0 });
        const built = half(frame, inward, side);
        for (const name of ["corner", "junction", "release"]) {
          const point = frame.toGlyph(built[name]);
          expectClose(
            (point.x - ribEnd.x) * inward.y - (point.y - ribEnd.y) * inward.x,
            0,
            `${name} off the wall at ${degrees}, side ${side}`
          );
        }
      }
    }
  });

  // The decision of record. The serif's own shape is square to its foot and
  // reads nothing off the stem — only the wall follows the stroke. So the lean
  // lands on the bracket, which reaches further sideways on one side than the
  // other by the wing slope times the lean, and it never reaches the wing.
  it("keeps the wing square to the foot at every lean", () => {
    for (const degrees of [0, ...tilts]) {
      const { frame, inward } = tilted(degrees);
      const along = (point, other) =>
        (point.x - other.x) * frame.axis.x + (point.y - other.y) * frame.axis.y;
      for (const side of [1, -1]) {
        const built = half(frame, inward, side);
        const bottom = frame.toGlyph(built.tipBottom);
        const top = frame.toGlyph(built.tipTop);
        expectClose(along(top, bottom), 0, `tip edge leaned at ${degrees}, ${side}`);
        expectClose(
          along(bottom, frame.toGlyph({ u: side * 50, v: 0 })),
          side * params.wingLength,
          `wing length moved at ${degrees}, ${side}`
        );
      }
    }
  });
});

describe("half serif on a wall", () => {
  const params = {
    wingLength: 48,
    tipThickness: 63,
    wingSlope: 12,
    tipCutAngle: 0,
    reach: 10,
    tension: 0.5,
    concavity: 0.5,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const straightWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 30, v: 600 },
    ]);
  const curvedWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 24, v: 120 },
      { u: 4, v: 240 },
      { u: -40, v: 360 },
    ]);

  it("places the corner where the old straight model placed it", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: straightWall(),
      params,
    });
    // Straight up the depth axis, the wing's top surface meets the wall at
    // exactly the old rise: tip thickness plus wing slope.
    expect(Math.abs(half.corner.u - 30)).to.be.lessThan(0.01);
    expect(Math.abs(half.corner.v - 75)).to.be.lessThan(0.01);
  });

  it("puts the corner, junction and release on a curved wall", () => {
    const wall = curvedWall();
    const half = buildHalfSerif({ side: 1, wall, params });
    for (const point of [half.corner, half.junction, half.release]) {
      const onWall = wall.pointAt(wall.parameterAtDepth(point.v));
      expect(Math.abs(onWall.u - point.u)).to.be.lessThan(0.05);
    }
    // And it is not where the straight model would have put them.
    expect(half.release.u).to.be.lessThan(28);
  });

  it("reports the release's own parameter on the wall", () => {
    const wall = curvedWall();
    const half = buildHalfSerif({ side: 1, wall, params });
    const at = wall.pointAt(half.releaseParameter);
    expect(Math.abs(at.u - half.release.u)).to.be.lessThan(0.05);
    expect(Math.abs(at.v - half.release.v)).to.be.lessThan(0.05);
  });

  it("clamps reach and ease against the wall it may consume", () => {
    // A short wall: the limit is the wall's own, not a number handed in beside
    // it, so there is one place the terminal's reach can be bounded.
    const wall = makeSerifWall([
      { u: 30, v: 0 },
      { u: 30, v: 200 },
    ]);
    const half = buildHalfSerif({
      side: 1,
      wall,
      params: { ...params, reach: 900, easeDistance: 900 },
    });
    expect(half.release.v).to.be.at.most(wall.maxDepth + 0.01);
    expect(half.depthClamped).to.equal(true);
  });

  it("emits every point with a wingless half", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: curvedWall(),
      params: { ...params, wingLength: 0, tipThickness: 0, wingSlope: 0 },
    });
    for (const key of [
      "junction",
      "corner",
      "release",
      "easeFlankHandle",
      "easeOnBracket",
      "easeBracketHandle",
      "control1",
      "control2",
      "tipTop",
      "tipBottom",
    ]) {
      expect(half[key], key).to.be.an("object");
      expect(Number.isFinite(half[key].u), key).to.equal(true);
      expect(Number.isFinite(half[key].v), key).to.equal(true);
    }
  });
});

describe("a tip that reaches the wall on its own", () => {
  const params = {
    wingLength: 48,
    tipThickness: 100,
    wingSlope: 25,
    tipCutAngle: 0,
    reach: 20,
    tension: 0.5,
    concavity: 0.5,
    easeDistance: 0,
    easeCurvature: 0,
  };
  // A wall that runs outward fast, so by the tip's own thickness it stands past
  // the tip's outer edge. The stem has swallowed the wing.
  const outwardWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 60, v: 60 },
      { u: 90, v: 120 },
      { u: 110, v: 180 },
    ]);
  const tipU = 30 + 48;

  it("puts the corner where the tip's own edge crosses the wall", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: outwardWall(),
      params,
    });
    expect(Math.abs(half.corner.u - tipU)).to.be.lessThan(0.05);
    expect(half.corner.v).to.be.lessThan(params.tipThickness);
  });

  it("does not emit the wing slope there", () => {
    const build = (wingSlope) =>
      buildHalfSerif({
        side: 1,
        wall: outwardWall(),
        params: { ...params, wingSlope },
      });
    // No wing is left for a slope to climb, so the number cannot move anything.
    for (const wingSlope of [0, 25, 60]) {
      expect(Math.abs(build(wingSlope).corner.v - build(0).corner.v)).to.be.lessThan(
        0.05
      );
    }
  });

  it("still climbs the slope while the wing survives", () => {
    const build = (wingSlope) =>
      buildHalfSerif({
        side: 1,
        wall: wallAt(30),
        params: { ...params, tipThickness: 40, wingSlope },
      });
    expect(build(25).corner.v - build(0).corner.v).to.be.closeTo(25, 0.05);
  });
});

describe("a tip that would push past the wall", () => {
  const params = {
    wingLength: 48,
    tipThickness: 100,
    wingSlope: 25,
    tipCutAngle: 0,
    reach: 20,
    tension: 0.5,
    concavity: 0.5,
    easeDistance: 0,
    easeCurvature: 0,
  };
  const outwardWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 60, v: 60 },
      { u: 90, v: 120 },
      { u: 110, v: 180 },
    ]);
  const build = (overrides) =>
    buildHalfSerif({
      side: 1,
      wall: outwardWall(),
      params: { ...params, ...overrides },
    });

  it("stops the top of the tip at the wall", () => {
    const half = build({});
    // The top of the tip sits ON the crossing, not past it. Past it the tip
    // pokes through the stem wall and the outline notches.
    expect(half.tipTop.v).to.be.lessThan(params.tipThickness);
    expect(Math.abs(half.tipTop.v - half.corner.v)).to.be.lessThan(0.05);
    expect(Math.abs(half.tipTop.u - half.corner.u)).to.be.lessThan(0.05);
  });

  it("holds there however much further the tip is pushed", () => {
    const reference = build({ tipThickness: 100 });
    for (const tipThickness of [140, 200, 400]) {
      const half = build({ tipThickness });
      expect(Math.abs(half.tipTop.v - reference.tipTop.v)).to.be.lessThan(0.05);
    }
  });

  it("says it was clamped", () => {
    expect(build({}).depthClamped).to.equal(true);
  });

  it("leaves a tip that stays inside the wall alone", () => {
    const half = build({ tipThickness: 20, wingSlope: 0 });
    expect(half.tipTop.v).to.be.closeTo(20, 1e-6);
    expect(half.depthClamped).to.equal(false);
  });
});

describe("a wingless tip against the wall", () => {
  it("keeps its thickness, because a collapsed wing is not a notch", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: wallAt(30),
      params: {
        wingLength: 0,
        tipThickness: 30,
        wingSlope: 0,
        tipCutAngle: 0,
        reach: 20,
        tension: 0.5,
        concavity: 0.5,
      },
    });
    expect(half.tipTop.v).to.be.closeTo(30, 1e-6);
    expect(half.depthClamped).to.equal(false);
  });
});

describe("the rounding when the wing has been swallowed", () => {
  const outwardWall = () =>
    makeSerifWall([
      { u: 30, v: 0 },
      { u: 60, v: 60 },
      { u: 90, v: 120 },
      { u: 110, v: 180 },
    ]);
  const tipU = 30 + 48;
  const build = (overrides = {}) =>
    buildHalfSerif({
      side: 1,
      wall: outwardWall(),
      params: {
        wingLength: 48,
        tipThickness: 100,
        wingSlope: 25,
        tipCutAngle: 0,
        reach: 20,
        tension: 0.5,
        concavity: 0.5,
        easeDistance: 15,
        easeCurvature: 0.5,
        ...overrides,
      },
    });

  it("puts the rounding's far end on the tip's own edge", () => {
    const half = build();
    // Down the tip's edge from the corner, not back along a bracket that has no
    // length left to step along.
    expect(Math.abs(half.easeOnBracket.u - tipU)).to.be.lessThan(0.05);
    expect(half.corner.v - half.easeOnBracket.v).to.be.closeTo(15, 0.05);
  });

  it("brings the top of the tip down with it", () => {
    const half = build();
    expect(Math.abs(half.tipTop.u - half.easeOnBracket.u)).to.be.lessThan(0.05);
    expect(Math.abs(half.tipTop.v - half.easeOnBracket.v)).to.be.lessThan(0.05);
  });

  it("leaves its handle on the tip's edge, pointing at the corner", () => {
    const half = build();
    expect(Math.abs(half.easeBracketHandle.u - tipU)).to.be.lessThan(0.05);
    expect(half.easeBracketHandle.v).to.be.greaterThan(half.easeOnBracket.v);
    expect(half.easeBracketHandle.v).to.be.at.most(half.corner.v + 0.05);
  });

  it("cannot eat past the bottom of the tip", () => {
    const half = build({ easeDistance: 10000 });
    expect(half.easeOnBracket.v).to.be.at.least(-0.05);
  });

  it("collapses to the corner at ease distance zero", () => {
    const half = build({ easeDistance: 0 });
    expect(Math.abs(half.easeOnBracket.v - half.corner.v)).to.be.lessThan(0.05);
  });
});

// The wall the terminal attaches to, on its own: one curve and the questions
// the serif asks of it.
const straightWallSample = () =>
  makeSerifWall([
    { u: 50, v: 0 },
    { u: 50, v: 400 },
  ]);
const curvedWallSample = () =>
  makeSerifWall([
    { u: 50, v: 0 },
    { u: 40, v: 100 },
    { u: 10, v: 200 },
    { u: -60, v: 300 },
  ]);

describe("serif wall", () => {
  it("finds a point at a requested depth on a straight wall", () => {
    const wall = straightWallSample();
    const point = wall.pointAt(wall.parameterAtDepth(120));
    expectClose(point.v, 120, undefined, 1e-4);
    expectClose(point.u, 50, undefined, 1e-4);
  });

  it("finds a point at a requested depth on a curved wall", () => {
    const wall = curvedWallSample();
    const point = wall.pointAt(wall.parameterAtDepth(120));
    expectClose(point.v, 120, undefined, 1e-3);
    // The curved wall has moved inward by that depth, which the straight model
    // could not see at all.
    expect(point.u).to.be.lessThan(45);
  });

  it("clamps a depth request past its own reach to its maximum", () => {
    const wall = curvedWallSample();
    expect(wall.parameterAtDepth(100000)).to.equal(wall.maxParameter);
  });

  it("meets a ray that crosses it", () => {
    const wall = curvedWallSample();
    // A ray from out on the wing, running inward and slightly deeper.
    const t = wall.meetRay({ u: 200, v: 60 }, { u: -1, v: 0.2 });
    expect(t).to.be.a("number");
    const hit = wall.pointAt(t);
    // The hit lies on the ray as well as on the wall.
    expectClose((hit.u - 200) * 0.2 - (hit.v - 60) * -1, 0, undefined, 1e-3);
  });

  it("returns null for a ray that runs away from it", () => {
    const wall = curvedWallSample();
    expect(wall.meetRay({ u: 200, v: 60 }, { u: 1, v: 0 })).to.equal(null);
  });

  it("points its tangent into the stroke", () => {
    const wall = curvedWallSample();
    expect(wall.tangentAt(0.3).v).to.be.greaterThan(0);
  });

  it("stops short of consuming its whole segment", () => {
    const wall = straightWallSample();
    expect(wall.maxParameter).to.be.lessThan(1);
    expect(wall.maxDepth).to.be.lessThan(400);
  });
});

describe("serif wall arc length", () => {
  it("advances by true distance along a straight wall", () => {
    const wall = straightWallSample();
    const from = wall.parameterAtDepth(100);
    const to = wall.parameterAtDistance(from, 40);
    expectClose(wall.pointAt(to).v, 140, undefined, 1e-3);
  });

  it("advances by true distance along a curved wall", () => {
    const wall = curvedWallSample();
    const from = wall.parameterAtDepth(100);
    const a = wall.pointAt(from);
    const b = wall.pointAt(wall.parameterAtDistance(from, 40));
    // Straight-line distance is a touch under the arc it travelled, and nowhere
    // near the 40 of depth the old measurement would have advanced.
    expect(Math.hypot(b.u - a.u, b.v - a.v)).to.be.greaterThan(39);
    expect(Math.hypot(b.u - a.u, b.v - a.v)).to.be.at.most(40.001);
    expect(b.v - a.v).to.be.lessThan(39);
  });

  it("stops at its own limit", () => {
    const wall = curvedWallSample();
    expect(wall.parameterAtDistance(0, 100000)).to.equal(wall.maxParameter);
  });

  it("reports the length it may be consumed for", () => {
    const wall = straightWallSample();
    expectClose(wall.maxLength, 380, undefined, 1e-3);
    expectClose(wall.lengthAt(wall.parameterAtDepth(100)), 100, undefined, 1e-3);
  });
});

describe("serif wall that turns back", () => {
  // The left stem wall of `braceright` in the terminal's own frame, at an axis
  // laid 33 degrees off the rib. The stroke is curved enough that the wall's
  // depth rises to about 200 and comes back down to 19 by the far end, so the
  // depth a serif asks for is reached early and is BELOW the wall's last point.
  const turningWall = () =>
    makeSerifWall([
      { u: 25.016, v: 16.068 },
      { u: -87.281, v: 189.779 },
      { u: -243.537, v: 201.66 },
      { u: -345.38, v: 18.799 },
    ]);

  it("finds a depth the wall reaches before it turns back", () => {
    const wall = turningWall();
    // 40 is an Egyptian foot's junction depth: tip thickness 20 plus wing
    // slope 20. The wall passes it a twentieth of the way along and never
    // returns to it, so reading the far end's depth as the wall's deepest
    // sends the whole terminal to the other end of the stroke.
    const at = wall.pointAt(wall.parameterAtDepth(40));
    expectClose(at.v, 40, "reaches the depth asked for", 0.05);
    expect(at.u).to.be.greaterThan(0);
  });

  it("keeps the requested depth continuous across the wall's last depth", () => {
    // A sweep rather than an assertion: the far end sits at v = 18.8, so a
    // request either side of it is where a guard reading that number as the
    // limit changes branch.
    const wall = turningWall();
    let previous = wall.pointAt(wall.parameterAtDepth(10));
    let worst = 0;
    for (let depth = 10.5; depth <= 60; depth += 0.5) {
      const current = wall.pointAt(wall.parameterAtDepth(depth));
      worst = Math.max(
        worst,
        Math.hypot(current.u - previous.u, current.v - previous.v)
      );
      previous = current;
    }
    expect(worst).to.be.lessThan(5);
  });

  it("holds at its deepest point once the request passes it", () => {
    const wall = turningWall();
    const peak = wall.parameterAtDepth(1e6);
    expect(wall.pointAt(peak).v).to.be.greaterThan(150);
    expect(wall.parameterAtDepth(1e9)).to.equal(peak);
  });
});
