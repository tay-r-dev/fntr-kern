import {
  buildHalfSerif,
  buildSerifTerminal,
  computeSerifFrame,
  makeSerifWall,
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

  it("keeps a free axis at least 15 degrees off the tangent", () => {
    // Tilted 90 degrees off the rib, the axis would lie along the stroke and
    // collapse the frame. A forced angle is not held off it: see below.
    const frame = computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: -1 },
      axisMode: "tilt",
      axisTilt: 90,
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
    // value of one slider. (A forced angle is not held off the stroke at all.)
    const tangent = startTerminal.tangent;
    const crossWithTangent = (axis) => axis.x * tangent.y - axis.y * tangent.x;
    const arriving = computeSerifFrame({
      ...startTerminal,
      axisMode: "tilt",
      axisTilt: 70,
    });
    for (const axisTilt of [80, 85, 89]) {
      const frame = computeSerifFrame({ ...startTerminal, axisMode: "tilt", axisTilt });
      expectClose(
        Math.abs(crossWithTangent(frame.axis)),
        Math.sin((15 * Math.PI) / 180),
        `separation at tilt ${axisTilt}`
      );
      expect(
        Math.sign(crossWithTangent(frame.axis)),
        `side at tilt ${axisTilt}`
      ).to.equal(Math.sign(crossWithTangent(arriving.axis)));
    }
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
    // The movement is the rotation, 0.81 units per half degree at no tilt, plus
    // the tip following the wall: the wing is measured from where the wall
    // stands at the tip's height, and that moves as the frame turns. Measured,
    // it rises evenly to 1.25 at either end of the range with no spike. The
    // bound is that and little more, so a branch change of even a few units
    // fails rather than hiding inside headroom.
    expect(worst, `worst step ${worst.toFixed(2)} at tilt ${worstAt}`).to.be.below(1.3);
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

  // Reported on the `l` of skeletron: easing stopped at the wing slope's value.
  // Its ceiling was the bracket's length worked out from the numbers alone, as
  // if the wall stood straight up: across by the wing, up by the slope and the
  // reach. With no wing and no reach that is the slope, 10, while the bracket
  // actually drawn up that leaning wall was many times longer.
  it("stops the easing at the bracket as drawn, on a leaning wall", () => {
    const wall = makeSerifWall([
      { u: -90, v: 0 },
      { u: 30, v: 400 },
    ]);
    const params = { wingLength: 0, tipThickness: 20, wingSlope: 10, reach: 0 };
    const unlimited = buildHalfSerif({
      side: -1,
      wall,
      params: { ...params, easeDistance: 4000 },
    });
    const bracket = Math.hypot(
      unlimited.tipTop.u - unlimited.junction.u,
      unlimited.tipTop.v - unlimited.junction.v
    );
    expect(bracket, "the bracket this wall draws").to.be.above(10);
    const asked = Math.min(bracket, 30);
    const eased = buildHalfSerif({
      side: -1,
      wall,
      params: { ...params, easeDistance: asked },
    });
    expectClose(
      Math.hypot(
        eased.easeOnBracket.u - eased.junction.u,
        eased.easeOnBracket.v - eased.junction.v
      ),
      asked,
      "easing along the bracket",
      1e-3
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

  // The same rule as corner rounding: each handle is the curvature times its
  // own end's distance to the corner the two surfaces make, so at 1 both land
  // on that corner. Reported on the `l` of skeletron: both handles took one
  // length, the shorter of the two distances and no more than the easing
  // distance, so on a curved wall the bracket's handle stopped 8.5 short of the
  // corner at full curvature, and halfway at an easing of 40.
  it("puts each handle the curvature's share of the way to the corner", () => {
    const corner = (half) => {
      const flank = {
        u: half.easeFlankHandle.u - half.release.u,
        v: half.easeFlankHandle.v - half.release.v,
      };
      const bracket = {
        u: half.easeBracketHandle.u - half.easeOnBracket.u,
        v: half.easeBracketHandle.v - half.easeOnBracket.v,
      };
      const denominator = flank.u * bracket.v - flank.v * bracket.u;
      const t =
        ((half.easeOnBracket.u - half.release.u) * bracket.v -
          (half.easeOnBracket.v - half.release.v) * bracket.u) /
        denominator;
      return { u: half.release.u + flank.u * t, v: half.release.v + flank.v * t };
    };
    for (const concavity of [-0.4, 0, 0.5]) {
      const full = eased({ concavity, easeCurvature: 1 });
      const meeting = corner(full);
      for (const [from, handle] of [
        [full.release, full.easeFlankHandle],
        [full.easeOnBracket, full.easeBracketHandle],
      ]) {
        expectClose(handle.u, meeting.u, `concavity ${concavity}`, 1e-6);
        expectClose(handle.v, meeting.v, `concavity ${concavity}`, 1e-6);
        expect(Math.hypot(from.u - meeting.u, from.v - meeting.v)).to.be.above(0);
      }
      const partial = eased({ concavity, easeCurvature: 0.4 });
      const { flank, bracket } = legs(partial);
      expectClose(
        flank,
        0.4 * Math.hypot(full.release.u - meeting.u, full.release.v - meeting.v),
        `flank share at concavity ${concavity}`,
        1e-6
      );
      expectClose(
        bracket,
        0.4 *
          Math.hypot(
            full.easeOnBracket.u - meeting.u,
            full.easeOnBracket.v - meeting.v
          ),
        `bracket share at concavity ${concavity}`,
        1e-6
      );
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

  // Easing used to stand down at full concavity, on the reasoning that the
  // bracket then leaves along the wall and leaves no corner to round. That is
  // true of a straight wall only; on the curved one of the `l` of skeletron the
  // bracket met the wall at 16 and 19 degrees and the easing did nothing.
  it("rounds at full concavity too", () => {
    const half = build({ concavity: 1, easeDistance: 20, easeCurvature: 0.6 });
    expectClose(half.release.v - half.junction.v, 20);
    expect(legs(half).flank).to.be.above(0);
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

  describe("foot centre on a leaning stroke", () => {
    // Both walls lean the same way, as a curving stroke does near its end, so
    // the tips travel sideways as the height grows.
    const leaningTerminal = (height, balance = 0, rightWing = 60) => {
      const frame = computeSerifFrame({
        endpoint: { x: 0, y: 0 },
        tangent: { x: 0, y: -1 },
        normal: { x: 1, y: 0 },
        axisMode: "perpendicular",
      });
      return buildSerifTerminal({
        frame,
        leftWall: makeSerifWall([
          { u: 50, v: 0 },
          { u: 150, v: 1000 },
        ]),
        rightWall: makeSerifWall([
          { u: -50, v: 0 },
          { u: 50, v: 1000 },
        ]),
        left: { ...half, tipThickness: height },
        right: { ...half, tipThickness: height, wingLength: rightWing },
        undersideCup: 0,
        undersideCupBalance: balance,
      });
    };
    const centreOf = (terminal) => terminal.points.filter((p) => !p.type)[3];

    it("stays where the stroke meets the foot line, whatever the height", () => {
      for (const height of [0, 30, 90, 150]) {
        expectClose(centreOf(leaningTerminal(height)).x, 0, `height ${height}`);
      }
    });

    it("sits between the wings where they differ", () => {
      expectClose(centreOf(leaningTerminal(90, 0, 20)).x, 20);
    });

    it("still lands on a tip at either end of the balance", () => {
      const terminal = leaningTerminal(90, 1);
      const onCurve = terminal.points.filter((p) => !p.type);
      expectClose(onCurve[3].x, onCurve[2].x);
      const other = leaningTerminal(90, -1).points.filter((p) => !p.type);
      expectClose(other[3].x, other[4].x);
    });
  });

  describe("negative height", () => {
    const onCurves = (overrides) =>
      terminal(overrides).points.filter((point) => !point.type);

    it("puts the shoulder on the foot line and grows the platform outward", () => {
      const { halves } = terminal({
        left: { ...half, tipThickness: -12, wingSlope: 10 },
        right: { ...half, tipThickness: -12, wingSlope: 10 },
      });
      expectClose(halves.left.tipTop.v, 0);
      expectClose(halves.left.tipBottom.v, -12);
      // The slope still climbs the stem from the shoulder.
      expectClose(halves.left.corner.v, 10);
    });

    it("moves the cup with the platform", () => {
      const flat = { ...half, tipThickness: -12 };
      const centre = terminal({
        left: flat,
        right: flat,
        undersideCup: 5,
      }).points.filter((point) => !point.type)[3];
      // The frame's depth runs up the glyph here, so v is y.
      expectClose(centre.y, -7);
    });

    it("keeps seven on-curves and does not step through zero", () => {
      let previous = null;
      for (let step = -80; step <= 80; step++) {
        const height = step / 4;
        const shaped = {
          ...half,
          tipThickness: height,
          wingSlope: 10,
          tipCutAngle: 20,
        };
        const points = onCurves({ left: shaped, right: shaped, undersideCup: 4 });
        expect(points).to.have.length(7);
        if (previous) {
          const worst = Math.max(
            ...points.map((p, i) =>
              Math.hypot(p.x - previous[i].x, p.y - previous[i].y)
            )
          );
          expect(worst, `step at height ${height}`).to.be.below(1);
        }
        previous = points;
      }
    });
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

  // The serif's own shape is square to its foot at every lean, and the wing is
  // measured from where the stem crosses the foot line.
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
        const ribEnd = frame.toGlyph({ u: side * 50, v: 0 });
        expectClose(
          along(top, ribEnd),
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

describe("a wing corner past the rib end", () => {
  // The rib end stands 20 inside the foot line, as a forced axis on a leaning
  // stroke puts it. The wall has nothing below that, so the corner goes onto
  // the stem's edge continued straight past the rib end.
  const params = { wingLength: 60, tipThickness: 0, tipCutAngle: 0, reach: 0 };
  const upright = makeSerifWall([
    { u: 50, v: 20 },
    { u: 50, v: 1000 },
  ]);

  it("meets the stem's edge continued, at a flat wing", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: upright,
      params: { ...params, wingSlope: 0 },
    });
    expectClose(half.corner.u, 50);
    expectClose(half.corner.v, 0);
  });

  it("follows a negative slope down the continued edge", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: upright,
      params: { ...params, wingSlope: -10 },
    });
    expectClose(half.corner.u, 50);
    expectClose(half.corner.v, -10);
  });

  it("continues a leaning edge along its own direction", () => {
    const leaning = makeSerifWall([
      { u: 50, v: 20 },
      { u: 70, v: 1020 },
    ]);
    const half = buildHalfSerif({
      side: 1,
      wall: leaning,
      params: { ...params, wingSlope: -30 },
    });
    // On the continued edge: 50 less a fiftieth of the depth travelled back.
    expectClose(half.corner.u, 50 - (half.corner.v - 20) / -50);
    expect(half.corner.v).to.be.below(0);
  });

  it("does not step where the corner crosses the rib end", () => {
    let previous = null;
    for (let step = -160; step <= 160; step++) {
      const wingSlope = step / 4;
      const { corner } = buildHalfSerif({
        side: 1,
        wall: upright,
        params: { ...params, wingSlope },
      });
      if (previous) {
        expect(Math.hypot(corner.u - previous.u, corner.v - previous.v)).to.be.below(1);
      }
      previous = corner;
    }
  });

  it("takes the bracket's stem end down to the corner", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: upright,
      params: { ...params, wingSlope: -10, tension: 0, concavity: 0 },
    });
    expectClose(half.junction.u, 50);
    expectClose(half.junction.v, -10);
    expectClose(half.release.v, -10);
    // The stroke is still cut at the rib end.
    expect(half.releaseParameter).to.equal(0);
    // A flat bracket keeps its handles collapsed on their own ends.
    expectClose(half.control2.v, half.junction.v);
    expectClose(half.control1.v, half.tipTop.v);
  });

  it("measures the reach up the continued edge and onto the wall", () => {
    const half = buildHalfSerif({
      side: 1,
      wall: upright,
      params: { ...params, wingSlope: -10, reach: 50 },
    });
    expectClose(half.junction.v, 40);
    expect(half.releaseParameter).to.be.above(0);
  });
});

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

describe("a wall that leans away from the wing", () => {
  const params = {
    wingLength: 20,
    tipThickness: 20,
    wingSlope: 20,
    tipCutAngle: 0,
    reach: 0,
    tension: 0,
    concavity: 0,
    easeDistance: 0,
    easeCurvature: 0,
  };
  // The foot is flat and the stem leans, so on this side the wall runs AWAY
  // from the wing as it climbs. `lean` is how far it runs out per unit of
  // depth: at 1 it recedes exactly as fast as the wing's top surface climbs
  // inward, and the two are parallel.
  const leaningWall = (lean) =>
    makeSerifWall([
      { u: 40, v: 0 },
      { u: 40 - lean * 372, v: 372 },
    ]);
  const cornerAt = (lean) =>
    buildHalfSerif({ side: 1, wall: leaningWall(lean), params }).corner;

  it("keeps the corner above the tip on a stem the wing cannot reach", () => {
    // Measured on the P of skeletron-test: the wing's top surface, extended as
    // a ray, does meet this wall — 346 units up the stem, because the two are
    // within seven degrees of parallel. The wing is 20 units long and stops at
    // the wall's own foot, so it never gets there. The corner is the depth the
    // slope states.
    const corner = cornerAt(0.8844);
    expect(corner.v).to.be.closeTo(params.tipThickness + params.wingSlope, 0.05);
  });

  it("moves the corner continuously as the stem leans", () => {
    let previous = cornerAt(0.5);
    let worst = 0;
    for (let lean = 0.502; lean <= 1.2; lean += 0.002) {
      const current = cornerAt(lean);
      worst = Math.max(
        worst,
        Math.hypot(current.u - previous.u, current.v - previous.v)
      );
      previous = current;
    }
    expect(worst).to.be.lessThan(1);
  });
});

// The serif is drawn in three steps: the foot goes out from the stem at the foot
// line, the height goes straight up, and the slope runs back to the stem. So the
// wing is measured from the stem at the foot line, and the height never moves
// the tips. Measured at the tip's own height instead, both tips slid along a
// curving stem as the height grew, 41 units on the `f` of skeletron.
describe("serif wing on a leaning wall", () => {
  // A straight wall leaning `lean` units across per unit of depth.
  const leaningWall = (footU, lean) =>
    makeSerifWall([
      { u: footU, v: 0 },
      { u: footU + lean * 400, v: 400 },
    ]);

  for (const side of [1, -1]) {
    for (const lean of [3, -3, 0.5, -0.5]) {
      for (const wingLength of [0, 10, 40]) {
        it(`stands the tip ${wingLength} out from the stem at the foot line (side ${side}, lean ${lean})`, () => {
          const half = buildHalfSerif({
            side,
            wall: leaningWall(-side * 90, lean),
            params: { wingLength, tipThickness: 20, wingSlope: 20 },
          });
          expectClose(side * (half.tipTop.u + side * 90), wingLength, "tip top", 1e-6);
          expectClose(
            side * (half.tipBottom.u + side * 90),
            wingLength,
            "tip bottom",
            1e-6
          );
        });
      }
    }
  }

  it("measures from the rib end where the stem stops short of the foot line", () => {
    // The stroke leaves along the axis and never reaches the foot line: its
    // edge continued would cross it thousands of units away.
    const alongAxis = makeSerifWall([
      { u: 0, v: 24 },
      { u: -400, v: 24.2 },
    ]);
    const half = buildHalfSerif({
      side: -1,
      wall: alongAxis,
      params: { wingLength: 16, tipThickness: 21, wingSlope: 6 },
    });
    expectClose(half.tipTop.u, -16);
  });

  it("holds the tips still while the height changes", () => {
    for (const tipThickness of [0, 20, 80, 200]) {
      const half = buildHalfSerif({
        side: 1,
        wall: leaningWall(-90, 1.5),
        params: { wingLength: 30, tipThickness, wingSlope: 20 },
      });
      expectClose(half.tipTop.u, -60, `tip top at height ${tipThickness}`);
    }
  });

  it("stops the height where the tip's edge meets the stem", () => {
    // The wall stands at u = -90 + 1.5 v, so the edge at u = -60 meets it at 20.
    for (const tipThickness of [20, 80, 200]) {
      const half = buildHalfSerif({
        side: 1,
        wall: leaningWall(-90, 1.5),
        params: {
          wingLength: 30,
          tipThickness,
          wingSlope: 20,
          tension: 0.8,
          concavity: 0.6,
        },
      });
      expectClose(half.tipTop.v, 20, `tip top at height ${tipThickness}`);
      // The slope, the corner and the bracket collapse onto that point, and the
      // stem is cut there.
      for (const name of ["corner", "junction", "release", "control1", "control2"]) {
        expectClose(half[name].u, -60, `${name} u at ${tipThickness}`);
        expectClose(half[name].v, 20, `${name} v at ${tipThickness}`);
      }
    }
  });

  it("does not step as the height reaches the stem", () => {
    let previous = null;
    for (let step = 0; step <= 160; step++) {
      const half = buildHalfSerif({
        side: 1,
        wall: leaningWall(-90, 1.5),
        params: {
          wingLength: 30,
          tipThickness: step / 4,
          wingSlope: 20,
          tension: 0.8,
          concavity: 0.6,
        },
      });
      if (previous) {
        for (const name of ["tipTop", "corner", "junction", "release"]) {
          const moved = Math.hypot(
            half[name].u - previous[name].u,
            half[name].v - previous[name].v
          );
          expect(moved, `${name} at ${step / 4}`).to.be.below(1);
        }
      }
      previous = half;
    }
  });

  it("leaves a wall that stands straight up exactly where it was", () => {
    // The stem stands at one place across at every height there, so nothing
    // already drawn on an upright stem moves.
    const half = buildHalfSerif({
      side: 1,
      wall: wallAt(0),
      params: { wingLength: 40, tipThickness: 20, wingSlope: 20 },
    });
    expectClose(half.tipTop.u, 40);
    expectClose(half.tipBottom.u, 40);
  });
});

// A forced angle is forced. Reported on the `l` of skeletron: a serif set to
// Vertical turned off vertical as its stroke was dragged toward vertical, because
// the guard that holds an axis 15 degrees off the stroke also held a forced one.
describe("a serif's forced angle", () => {
  const frameFor = (axisMode, degreesFromVertical) => {
    const radians = (degreesFromVertical * Math.PI) / 180;
    return computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: -Math.sin(radians), y: -Math.cos(radians) },
      normal: { x: Math.cos(radians), y: -Math.sin(radians) },
      axisMode,
    });
  };

  for (const degrees of [5, 12, 30]) {
    it(`stays vertical with the stroke ${degrees} degrees off vertical`, () => {
      const { axis } = frameFor("vertical", degrees);
      expectClose(axis.x, 0, `axis x at ${degrees}`);
      expectClose(Math.abs(axis.y), 1, `axis y at ${degrees}`);
    });
    it(`stays horizontal with the stroke ${degrees} degrees off horizontal`, () => {
      const { axis } = frameFor("horizontal", 90 - degrees);
      expectClose(Math.abs(axis.x), 1, `axis x at ${degrees}`);
      expectClose(axis.y, 0, `axis y at ${degrees}`);
    });
  }
});

// A serif grows against its stroke, toward the on-curve next to the terminal.
// Reported on the `l` of skeletron: a Vertical serif whose stroke left its point
// vertically turned right over when the point moved a quarter unit. Which way
// the serif faced was read off the stroke's lean at the terminal, and where the
// axis lies along the stroke that lean is zero, so its sign was a rounding. The
// foot's own direction was read the same way, so the two went over together and
// the terminal came back turned rather than mirrored.
describe("a forced axis almost along its stroke", () => {
  // A start terminal: the stroke leaves upward, leaning by `degrees`, and bends
  // to one side over its own length, as the reported terminals both do. The
  // bend is what the next on-curve carries and the terminal's own tangent does
  // not, so the sweep runs the lean through vertical with the bend held.
  const frameAt = (degrees, bend = 60) => {
    const radians = (degrees * Math.PI) / 180;
    const travel = { x: Math.sin(radians), y: Math.cos(radians) };
    return computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: -travel.x, y: -travel.y },
      normal: { x: travel.y, y: -travel.x },
      axisMode: "vertical",
      continuation: {
        x: travel.x * 200 + travel.y * bend,
        y: travel.y * 200 - travel.x * bend,
      },
    });
  };

  it("holds its whole frame through vertical", () => {
    const reference = frameAt(0);
    for (const degrees of [-10, -3, -0.1, 0.1, 3, 10]) {
      const frame = frameAt(degrees);
      expectClose(frame.depth.x, reference.depth.x, `depth x at ${degrees}`, 1e-9);
      expectClose(frame.depth.y, reference.depth.y, `depth y at ${degrees}`, 1e-9);
      expectClose(frame.axis.x, reference.axis.x, `axis x at ${degrees}`, 1e-9);
      expectClose(frame.axis.y, reference.axis.y, `axis y at ${degrees}`, 1e-9);
    }
  });

  it("grows toward the next on-curve, at every lean and either bend", () => {
    for (const bend of [60, -60]) {
      for (const degrees of [-40, -16, -10, -0.1, 0, 0.1, 10, 16, 40]) {
        const radians = (degrees * Math.PI) / 180;
        const travel = { x: Math.sin(radians), y: Math.cos(radians) };
        const next = {
          x: travel.x * 200 + travel.y * bend,
          y: travel.y * 200 - travel.x * bend,
        };
        const { depth } = frameAt(degrees, bend);
        expect(
          depth.x * next.x + depth.y * next.y,
          `depth toward the next on-curve at ${degrees}, bend ${bend}`
        ).to.be.above(0);
      }
    }
  });

  it("keeps positive u on the contour's left", () => {
    // The same stroke walked the other way: left swaps with the heading, so the
    // foot must swap with it rather than hold a direction in the glyph.
    const up = frameAt(0);
    const radians = Math.PI;
    const travel = { x: Math.sin(radians), y: Math.cos(radians) };
    const down = computeSerifFrame({
      endpoint: { x: 0, y: 0 },
      tangent: { x: -travel.x, y: -travel.y },
      normal: { x: travel.y, y: -travel.x },
      axisMode: "vertical",
      continuation: {
        x: travel.x * 200 + travel.y * 60,
        y: travel.y * 200 - travel.x * 60,
      },
    });
    expectClose(up.axis.x, -down.axis.x, "axis x swaps with the heading");
    expectClose(up.axis.y, -down.axis.y, "axis y swaps with the heading");
  });
});
