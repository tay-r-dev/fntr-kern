import {
  buildContourSegments,
  calculateContourNormalAtPoint,
  collectCoupledPointGroups,
} from "@fontra/core/offset-contour.js";
import { expect } from "chai";

// Plain contour points, exactly as they come out of VarPackedPath's unpacked
// form: on-curves have no `type`, off-curves carry `type: "cubic"`. Nothing here
// has a width, an id, or any other skeleton field — that is the whole point.
const onCurve = (x, y, smooth = false) => ({ x, y, smooth });
const control = (x, y) => ({ x, y, type: "cubic" });

describe("offset-contour geometry", () => {
  it("takes the normal at a corner from the miter bisector", () => {
    // A right angle at (100, 0): incoming direction +x, outgoing +y. The
    // bisector points up-right, so its CW normal is down-right, normalized.
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const normal = calculateContourNormalAtPoint(points, false, 1);
    expect(normal.x).to.be.closeTo(Math.SQRT1_2, 1e-9);
    expect(normal.y).to.be.closeTo(-Math.SQRT1_2, 1e-9);
  });

  it("takes the normal at a one-handled smooth point from its straight", () => {
    // Point 1 is smooth and has a handle only on the curve side, so it owns no
    // direction: the straight 0-1 sets it, and the normal is perpendicular to
    // that straight rather than to a miter average.
    const points = [
      onCurve(0, 0),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    const normal = calculateContourNormalAtPoint(points, false, 1);
    expect(normal.x).to.be.closeTo(0, 1e-9);
    expect(normal.y).to.be.closeTo(-1, 1e-9);
  });

  it("couples the two ends of a straight carrying a one-handled smooth point", () => {
    const points = [
      onCurve(0, 0),
      onCurve(100, 0, true),
      control(150, 0),
      control(200, 50),
      onCurve(200, 100),
    ];
    const groups = collectCoupledPointGroups(
      buildContourSegments(points, false),
      false
    );
    expect(groups.get(points[0])).to.have.members([points[0], points[1]]);
    expect(groups.get(points[1])).to.have.members([points[0], points[1]]);
    expect(groups.get(points[4])).to.equal(undefined);
  });

  it("leaves a plain straight between two corners uncoupled", () => {
    const points = [onCurve(0, 0), onCurve(100, 0), onCurve(100, 100)];
    const groups = collectCoupledPointGroups(
      buildContourSegments(points, false),
      false
    );
    expect(groups.size).to.equal(0);
  });
});
