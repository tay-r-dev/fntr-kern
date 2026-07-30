import {
  buildHalfSerif,
  buildSerifTerminal,
  computeSerifFrame,
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
  const build = (overrides = {}, side = 1, straightDepth = 0) =>
    buildHalfSerif({
      side,
      flankU: side * 50,
      params: { ...base, ...overrides },
      straightDepth,
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

  it("ends the transition curve at reach above the wing inner corner", () => {
    const half = build({ wingSlope: 12 });
    expectClose(half.wingInnerV, 42);
    expectClose(half.straightBottom.v, 122);
    expectClose(half.straightBottom.u, 50);
  });

  it("collapses the straight run at depth zero", () => {
    const half = build();
    expect(half.straightTop).to.deep.equal(half.straightBottom);
  });

  it("raises the straight top by the straight depth, at constant u", () => {
    const half = build({}, 1, 25);
    expectClose(half.straightTop.u, half.straightBottom.u);
    expectClose(half.straightTop.v - half.straightBottom.v, 25);
  });

  // The midpoint of the transition cubic, which is where the hollow is deepest.
  const transitionBelly = (half) => {
    const p = [half.tipTop, half.control1, half.control2, half.straightBottom];
    return {
      u: (p[0].u + 3 * p[1].u + 3 * p[2].u + p[3].u) / 8,
      v: (p[0].v + 3 * p[1].v + 3 * p[2].v + p[3].v) / 8,
    };
  };

  it("collapses the transition to a straight line at concavity zero", () => {
    for (const tension of [0, 0.5, 1]) {
      const half = build({ tension, concavity: 0 });
      // Every control sits on the chord, so the cubic is the chord, whatever the
      // tension. Depth is concavity's job alone.
      const chordV = (u) =>
        half.tipTop.v +
        ((u - half.tipTop.u) / (half.straightBottom.u - half.tipTop.u)) *
          (half.straightBottom.v - half.tipTop.v);
      expectClose(half.control1.v, chordV(half.control1.u));
      expectClose(half.control2.v, chordV(half.control2.u));
    }
  });

  it("keeps the hollow depth independent of tension", () => {
    const depths = [0, 0.25, 0.5, 1].map(
      (tension) => transitionBelly(build({ tension, concavity: 1 })).v
    );
    for (const depth of depths) {
      expectClose(depth, depths[0]);
    }
  });

  it("deepens the hollow with concavity", () => {
    const shallow = transitionBelly(build({ concavity: 0.25 })).v;
    const deep = transitionBelly(build({ concavity: 1 })).v;
    const flat = transitionBelly(build({ concavity: 0 })).v;
    // The inner corner is below the chord, so a deeper hollow means a lower belly.
    expect(deep).to.be.below(shallow);
    expect(shallow).to.be.below(flat);
  });

  it("never lets a transition control cross its own flank", () => {
    for (const tension of [0, 0.5, 1]) {
      for (const concavity of [1, -1]) {
        const left = build({ tension, concavity });
        expect(left.control1.u).to.be.within(50, left.tipTop.u);
        expect(left.control2.u).to.be.within(50, left.tipTop.u);
        const right = build({ tension, concavity }, -1);
        expect(right.control1.u).to.be.within(right.tipTop.u, -50);
        expect(right.control2.u).to.be.within(right.tipTop.u, -50);
      }
    }
  });

  it("bulges the transition outward at negative concavity", () => {
    const hollow = build({ concavity: 0.8 });
    const bulged = build({ concavity: -0.8 });
    // Concavity moves the attractor across the chord, so the controls swap sides.
    expect(bulged.control1.u).to.be.above(hollow.control1.u);
  });

  it("emits a wingless half without losing any point", () => {
    const half = build({ wingLength: 0 });
    expectClose(half.tipBottom.u, 50);
    expectClose(half.tipTop.u, 50);
    expect(Object.keys(half)).to.have.length(7);
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
      straightDepth: 0,
      ...overrides,
    });
  }

  it("emits exactly nine on-curve points", () => {
    const { points } = terminal();
    expect(points.filter((point) => !point.type)).to.have.length(9);
  });

  it("keeps nine on-curve points at every degenerate value", () => {
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
    expect(points.filter((point) => !point.type)).to.have.length(9);
  });

  it("puts the foot centre on the skeleton endpoint with no cup", () => {
    const { points } = terminal();
    const centre = points.filter((point) => !point.type)[4];
    expect(Math.abs(centre.x)).to.be.below(1e-9);
    expect(Math.abs(centre.y)).to.be.below(1e-9);
  });

  it("lifts the foot centre by the cup amount, along the depth", () => {
    const { points } = terminal({ undersideCup: 18 });
    const centre = points.filter((point) => !point.type)[4];
    expectClose(centre.y, 18);
  });

  it("keeps the foot centre on the skeleton when the halves are unequal", () => {
    const { points } = terminal({
      left: { ...half, wingLength: 20 },
      right: { ...half, wingLength: 120 },
    });
    const centre = points.filter((point) => !point.type)[4];
    expect(Math.abs(centre.x)).to.be.below(1e-9);
  });

  it("runs from the left straight top to the right straight top", () => {
    const { points } = terminal();
    const onCurve = points.filter((point) => !point.type);
    expect(onCurve[0].x).to.be.above(0);
    expect(onCurve[8].x).to.be.below(0);
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
    expectClose(halves.left.straightBottom.u, 50);
    expectClose(halves.right.straightBottom.u, -50);
  });
});
