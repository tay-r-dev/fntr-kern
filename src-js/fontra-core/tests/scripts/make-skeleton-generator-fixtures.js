import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Fixtures record this generator's own output. Until 2026-07-26 this script ran
// the pre-port generator out of a gitignored checkout, which meant it could not
// be run outside one developer's machine.
import { generateContoursFromSkeleton } from "../../src/skeleton-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.join(
  __dirname,
  "..",
  "data",
  "skeleton-generator",
  "fixtures.json"
);

const CAP_CORNER_POINT_FIELDS = [
  "capStyle",
  "capRadiusRatio",
  "capTension",
  "capAngle",
  "capDistance",
  {
    name: "serif-slab",
    canonical: serifStem({
      wingLength: 80,
      tipThickness: 90,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 20,
      tension: 0.15,
      concavity: -0.05,
    }),
  },
  {
    name: "serif-didone",
    canonical: serifStem({
      wingLength: 90,
      tipThickness: 18,
      wingSlope: 0,
      tipCutAngle: 0,
      reach: 70,
      tension: 0.7,
      concavity: 0.8,
    }),
  },
  {
    name: "serif-one-sided",
    canonical: serifStem(
      {
        wingLength: 90,
        tipThickness: 18,
        wingSlope: 0,
        tipCutAngle: 0,
        reach: 70,
        tension: 0.7,
        concavity: 0.8,
      },
      {
        wingLength: 0,
        tipThickness: 0,
        wingSlope: 0,
        tipCutAngle: 0,
        reach: 40,
        tension: 0.6,
        concavity: 0.5,
      }
    ),
  },
  { name: "serif-horizontal-axis-curve-terminal", canonical: serifCurveTerminal() },
];

const fixtures = [
  {
    name: "open-line-butt-cap",
    canonical: {
      version: 1,
      nextId: 4,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [point(2, 0, 0), point(3, 100, 0)],
        },
      ],
      generated: [],
    },
  },
  {
    name: "closed-triangle",
    canonical: {
      version: 1,
      nextId: 5,
      contours: [
        {
          id: 1,
          closed: true,
          defaultWidth: 60,
          singleSided: null,
          points: [point(2, 0, 0), point(3, 100, 0), point(4, 50, 80)],
        },
      ],
      generated: [],
    },
  },
  {
    name: "open-cubic-round-cap",
    capReference: true,
    canonical: {
      version: 1,
      nextId: 6,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 70,
          singleSided: null,
          points: [
            point(2, 0, 0, { capStyle: "round" }),
            offCurve(3, 40, 120),
            offCurve(4, 120, 120),
            point(5, 160, 0, { capStyle: "round" }),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    // Same geometry as open-cubic-round-cap with default (butt) caps: rib and
    // handle provenance stays fully observable because no cap consumes the
    // terminal side geometry.
    name: "open-cubic-butt-cap",
    canonical: {
      version: 1,
      nextId: 6,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 70,
          singleSided: null,
          points: [
            point(2, 0, 0),
            offCurve(3, 40, 120),
            offCurve(4, 120, 120),
            point(5, 160, 0),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    // Two cubic segments meeting at a smooth on-curve point. No other fixture
    // has one, which is why a smooth-junction handle defect went unrecorded:
    // the generated handles either side of point 5 must stay exactly colinear.
    name: "open-smooth-cubic-junction",
    canonical: {
      version: 1,
      nextId: 9,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 60,
          singleSided: null,
          points: [
            point(2, 0, 0),
            offCurve(3, 20, 40),
            offCurve(4, 50, 40),
            point(5, 60, 60, { smooth: true }),
            offCurve(6, 70, 80),
            offCurve(7, 100, 100),
            point(8, 120, 60),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    // Two cubic segments joined by a straight in the middle, between two smooth
    // points (5 and 6) that each carry only ONE handle, on the far side. Neither
    // has an independent direction — the straight defines both — so their ribs
    // are locked parallel and share an offset. Widths deliberately differ (30 vs
    // 18) so the coupling is exercised rather than coincidentally satisfied.
    name: "mutually-controlled-straight",
    canonical: {
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 40,
          singleSided: null,
          points: [
            point(2, 0, 0),
            offCurve(3, 10, 50),
            offCurve(4, 20, 40),
            point(5, 60, 60, { smooth: true, width: { left: 30, right: 30 } }),
            point(6, 140, 100, { smooth: true, width: { left: 18, right: 18 } }),
            offCurve(7, 180, 120),
            offCurve(8, 190, 60),
            point(9, 200, 0),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    // Only ONE end of the straight is a one-handle smooth point (5); point 6 is
    // an ordinary corner into the following cubic and owns its own direction.
    // One such point is still enough to tie the whole projected straight, so
    // both ribs sit at the mean of 30 and 18 here too.
    name: "one-ended-controlled-straight",
    canonical: {
      version: 1,
      nextId: 10,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 40,
          singleSided: null,
          points: [
            point(2, 0, 0),
            offCurve(3, 10, 50),
            offCurve(4, 20, 40),
            point(5, 60, 60, { smooth: true, width: { left: 30, right: 30 } }),
            point(6, 140, 100, { width: { left: 18, right: 18 } }),
            offCurve(7, 200, 160),
            offCurve(8, 240, 60),
            point(9, 200, 0),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    name: "single-sided-left",
    canonical: {
      version: 1,
      nextId: 4,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: "left",
          points: [point(2, 0, 0), point(3, 120, 0)],
        },
      ],
      generated: [],
    },
  },
  {
    name: "asymmetric-editable-nudge",
    canonical: {
      version: 1,
      nextId: 4,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            point(2, 0, 0, {
              width: { left: 20, right: 45, linked: false },
              editable: { left: true, right: true },
              nudge: { left: 8, right: -6 },
            }),
            point(3, 140, 0, {
              width: { left: 35, right: 10, linked: false },
              editable: { left: true, right: true },
              nudge: { left: -4, right: 5 },
            }),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    // Nudges on the endpoints of a CUBIC segment, which asymmetric-editable-nudge
    // (a line) cannot cover: the nudge has to translate each generated on-curve
    // point together with its handle, rather than being fed to the offset
    // construction as an endpoint constraint.
    name: "nudged-cubic-endpoints",
    canonical: {
      version: 1,
      nextId: 6,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 40,
          singleSided: null,
          points: [
            point(2, 0, 0, {
              width: { left: 20, right: 20 },
              editable: { left: true, right: true },
              nudge: { left: 17, right: -9 },
            }),
            offCurve(3, 40, 60),
            offCurve(4, 120, 60),
            point(5, 160, 0, {
              width: { left: 20, right: 20 },
              editable: { left: true, right: true },
              nudge: { left: -11, right: 6 },
            }),
          ],
        },
      ],
      generated: [],
    },
  },
  {
    name: "detached-handle-offsets",
    canonical: {
      version: 1,
      nextId: 6,
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          singleSided: null,
          points: [
            point(2, 0, 0, {
              editable: { left: true, right: true },
              handleOffsets: {
                leftOut: { x: -12, y: 20, detached: true },
                rightOut: { x: 12, y: -16, detached: true },
              },
            }),
            offCurve(3, 40, 90),
            offCurve(4, 100, 90),
            point(5, 140, 0, {
              editable: { left: true, right: true },
              handleOffsets: {
                leftIn: { x: 10, y: 22, detached: true },
                rightIn: { x: -10, y: -18, detached: true },
              },
            }),
          ],
        },
      ],
      generated: [],
    },
  },
];

for (const fixture of fixtures) {
  fixture.donorInput = canonicalToDonor(fixture.canonical);
  fixture.expectedContours = generateContoursFromSkeleton(fixture.canonical);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const newline =
  fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf-8").includes("\r\n")
    ? "\r\n"
    : "\n";
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(fixtures, null, 2).replaceAll("\n", newline)}${newline}`
);

function point(id, x, y, extra = {}) {
  return {
    id,
    x,
    y,
    type: null,
    smooth: false,
    width: { left: 40, right: 40, linked: true },
    nudge: { left: 0, right: 0 },
    editable: { left: false, right: false },
    handleOffsets: {},
    ...extra,
  };
}

function serifStem(left, right = left) {
  return {
    version: 1,
    nextId: 4,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 100,
        capStyle: "serif",
        points: [
          point(2, 0, 0, {
            serif: {
              left,
              right,
              axisMode: "perpendicular",
              axisAngle: 0,
              undersideCup: 0,
            },
          }),
          point(3, 0, 400),
        ],
      },
    ],
    generated: [],
  };
}

function serifCurveTerminal() {
  const half = {
    wingLength: 80,
    tipThickness: 24,
    wingSlope: 0,
    tipCutAngle: 0,
    reach: 30,
    tension: 0.7,
    concavity: 0.8,
  };
  return {
    version: 1,
    nextId: 6,
    contours: [
      {
        id: 1,
        closed: false,
        defaultWidth: 100,
        capStyle: "serif",
        points: [
          point(2, 0, 0, {
            serif: {
              left: half,
              right: half,
              axisMode: "horizontal",
              axisAngle: 0,
              undersideCup: 0,
            },
          }),
          offCurve(3, 10, 20),
          offCurve(4, 30, 40),
          point(5, 60, 60),
        ],
      },
    ],
    generated: [],
  };
}

function offCurve(id, x, y) {
  return { id, x, y, type: "cubic", smooth: false };
}

function canonicalToDonor(skeletonData) {
  return {
    contours: skeletonData.contours.map((contour) => ({
      isClosed: contour.closed,
      defaultWidth: contour.defaultWidth,
      singleSided: contour.singleSided !== null,
      singleSidedDirection: contour.singleSided || "left",
      capStyle: contour.capStyle || "butt",
      reversed: contour.reversed === true,
      points: contour.points.map(canonicalPointToDonor),
    })),
  };
}

function canonicalPointToDonor(point) {
  const donorPoint = {
    x: point.x,
    y: point.y,
    smooth: point.smooth === true,
  };
  if (point.type) {
    donorPoint.type = point.type;
    return donorPoint;
  }

  donorPoint.leftWidth = point.width?.left ?? 40;
  donorPoint.rightWidth = point.width?.right ?? 40;
  donorPoint.leftNudge = point.nudge?.left ?? 0;
  donorPoint.rightNudge = point.nudge?.right ?? 0;
  donorPoint.leftEditable = point.editable?.left === true;
  donorPoint.rightEditable = point.editable?.right === true;
  donorPoint.corner = point.corner ?? null;
  for (const field of CAP_CORNER_POINT_FIELDS) {
    if (point[field] !== null && point[field] !== undefined) {
      donorPoint[field] = point[field];
    }
  }

  copyHandleOffsetsToDonor(donorPoint, "left", point.handleOffsets?.leftIn, "In");
  copyHandleOffsetsToDonor(donorPoint, "left", point.handleOffsets?.leftOut, "Out");
  copyHandleOffsetsToDonor(donorPoint, "right", point.handleOffsets?.rightIn, "In");
  copyHandleOffsetsToDonor(donorPoint, "right", point.handleOffsets?.rightOut, "Out");
  return donorPoint;
}

function copyHandleOffsetsToDonor(donorPoint, side, offset, inOut) {
  if (!offset) {
    return;
  }
  const prefix = `${side}Handle${inOut}`;
  donorPoint[`${prefix}OffsetX`] = offset.x ?? 0;
  donorPoint[`${prefix}OffsetY`] = offset.y ?? 0;
  donorPoint[`${prefix}Detached`] = offset.detached === true;
  // The donor generator gates detached positioning on a per-SIDE flag; the
  // canonical model is per handle. Without this the donor silently ignores
  // detached offsets and the fixture captures attached behavior.
  if (offset.detached === true) {
    donorPoint[`${side}HandleDetached`] = true;
  }
}
