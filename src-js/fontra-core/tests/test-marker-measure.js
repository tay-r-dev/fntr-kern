import {
  measureDimension,
  measureRay,
  walkRayIntersections,
} from "@fontra/core/marker-measure.js";
import { PathHitTester } from "@fontra/core/path-hit-tester.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { expect } from "chai";

function rectContour(x1, y1, x2, y2, clockwise = false) {
  const points = [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
  return { points: clockwise ? points.reverse() : points, isClosed: true };
}

function pathOf(...contours) {
  const path = new VarPackedPath();
  for (const contour of contours) {
    path.appendUnpackedContour(contour);
  }
  return path;
}

function hitTesterFor(path) {
  return new PathHitTester(path, path.getControlBounds());
}

describe("marker-measure — the winding walk", () => {
  it("crosses the interior edge of an overlapping contour", () => {
    // Two overlapping rectangles, 0..100 and 50..200. The black runs to 200, and the
    // shared edges at 50 and 100 are interior: the ray crosses them, it does not stop.
    const path = pathOf(rectContour(0, 0, 100, 100), rectContour(50, 0, 200, 100));
    const measured = measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 });
    expect(measured.distance).to.be.closeTo(200, 0.001);
    expect(measured.farPoint.x).to.be.closeTo(200, 0.001);
  });

  it("stops on entering a counter", () => {
    const path = pathOf(
      rectContour(0, 0, 200, 100),
      rectContour(50, 20, 150, 80, true)
    );
    const measured = measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 });
    expect(measured.distance).to.be.closeTo(50, 0.001);
  });

  it("reports null where the ray never leaves the black", () => {
    // An open contour the ray never crosses. A fabricated distance would be a lie.
    const path = pathOf({
      points: [
        { x: 0, y: 300 },
        { x: 100, y: 300 },
      ],
      isClosed: false,
    });
    expect(measureRay(hitTesterFor(path), { x: 0, y: 50 }, { x: 1, y: 0 })).to.equal(
      null
    );
  });

  it("accumulates winding across a hand-built crossing list", () => {
    const spans = walkRayIntersections([
      { x: 0, y: 0, winding: 1 },
      { x: 10, y: 0, winding: 1 },
      { x: 20, y: 0, winding: -1 },
      { x: 30, y: 0, winding: -1 },
    ]);
    expect(spans.map((span) => span.inside)).to.deep.equal([true, true, true]);
    expect(spans.map((span) => span.distance)).to.deep.equal([10, 10, 10]);
  });

  it("measures a dimension as the plain hypotenuse", () => {
    expect(measureDimension({ x: 0, y: 0 }, { x: 3, y: 4 })).to.equal(5);
  });
});
