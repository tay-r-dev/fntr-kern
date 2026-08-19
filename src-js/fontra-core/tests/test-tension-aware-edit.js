import {
  buildIndexedSegments,
  restoreSegmentTensions,
  segmentTensions,
} from "@fontra/core/tension-aware-edit.js";
import { expect } from "chai";

// Unpacked VarPackedPath points: on-curves carry no `type`, off-curves carry
// `type: "cubic"`.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });
const copy = (points) => points.map((point) => ({ ...point }));

// A quarter circle: up from (0, -100) with a vertical tangent, round to
// (100, 0) with a horizontal tangent. The two tangents cross at the origin, and
// both handles reach 0.5523 of the way to it.
const quarter = () => [
  onCurve(0, -100),
  control(0, -44.77),
  control(44.77, 0),
  onCurve(100, 0),
];

describe("tension-aware edit — segments and tensions", () => {
  it("walks an open contour into one segment per on-curve pair", () => {
    const segments = buildIndexedSegments(quarter(), false);
    expect(segments.length).to.equal(1);
    expect(segments[0]).to.deep.equal({
      startIndex: 0,
      endIndex: 3,
      controlIndices: [1, 2],
    });
  });

  it("closes the loop on a closed contour", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const segments = buildIndexedSegments(points, true);
    expect(segments.length).to.equal(3);
    expect(segments[2]).to.deep.equal({
      startIndex: 2,
      endIndex: 0,
      controlIndices: [],
    });
  });

  it("reads both handle tensions off the tangent crossing", () => {
    const points = quarter();
    const tensions = segmentTensions(points, buildIndexedSegments(points, false)[0]);
    expect(tensions.start).to.be.closeTo(0.5523, 0.001);
    expect(tensions.end).to.be.closeTo(0.5523, 0.001);
  });
});

describe("tension-aware edit — the restore", () => {
  it("stretches a quarter circle into a quarter ellipse", () => {
    const before = quarter();
    const after = copy(before);
    after[3] = onCurve(200, 0); // the right end dragged 100 units right
    restoreSegmentTensions(before, after, false);
    // The crossing does not move, because neither tangent turned. The vertical
    // leg is unchanged, so its handle keeps its length. The horizontal leg
    // doubles, so its handle doubles.
    expect(after[1].x).to.equal(0);
    expect(after[1].y).to.equal(-45);
    expect(after[2].x).to.equal(90);
    expect(after[2].y).to.equal(0);
  });

  it("leaves a segment alone when both ends take the same delta", () => {
    const before = quarter();
    const after = copy(before).map((point) => ({ ...point, x: point.x + 30 }));
    const changed = restoreSegmentTensions(before, after, false);
    expect(changed).to.equal(false);
    expect(after[1].y).to.equal(-44.77);
    expect(after[2].x).to.be.closeTo(74.77, 1e-9);
  });

  it("falls back to the chord ratio where the tangents are parallel", () => {
    // Both handles point straight up, so the tangent rays never cross.
    const before = [onCurve(0, 0), control(0, 40), control(100, 40), onCurve(100, 0)];
    const after = copy(before);
    // The ordinary rules carry a point's own handle with it, so the end handle
    // moves with the end point and its direction does not turn.
    after[2] = control(200, 40);
    after[3] = onCurve(200, 0);
    restoreSegmentTensions(before, after, false);
    // Chord 100 -> 200, so each handle doubles along its own direction.
    expect(after[1].y).to.equal(80);
    expect(after[2].y).to.equal(80);
  });

  it("falls back where the crossing sits behind an end", () => {
    // The start handle points away from the segment, so the crossing is behind
    // the start point.
    const before = [onCurve(0, 0), control(-30, 0), control(70, 40), onCurve(100, 0)];
    const after = copy(before);
    after[3] = onCurve(150, 0);
    restoreSegmentTensions(before, after, false);
    expect(after[1].x).to.equal(-45); // 30 * 1.5, along its own direction
  });

  it("leaves a segment whose two ends land on the same place", () => {
    const before = quarter();
    const after = copy(before);
    after[3] = onCurve(0, -100);
    const changed = restoreSegmentTensions(before, after, false);
    expect(changed).to.equal(false);
  });
});
