// A terminal depends on its own settings and its adjoining skeleton segment.
// The next rib's width/nudge and the rest of the contour do not rebuild its ball.
import { bulbEndCurvature } from "./bulb-harmonization.js";

function terminalInput(contour, atStart, ignoreEdits = false) {
  const points = atStart ? contour.points : [...contour.points].reverse();
  const next = points.findIndex((p, i) => i > 0 && !p.type);
  if (next < 0) return null;
  const terminal = { ...points[0] };
  delete terminal.locked;
  if (ignoreEdits)
    terminal.capBallEdits = {
      neck: { vslide: terminal.capBallEdits?.neck?.vslide ?? 0 },
    };
  return JSON.stringify({
    terminal,
    segment: points
      .slice(1, next + 1)
      .map(({ x, y, type, smooth }) => ({ x, y, type, smooth })),
    singleSided: contour.singleSided,
    reversed: contour.reversed,
    defaultWidth: contour.defaultWidth,
    capStyle: contour.capStyle,
    capBallRatio: contour.capBallRatio,
    capBallShape: contour.capBallShape,
    capBallSide: contour.capBallSide,
  });
}

export function collectUnchangedBulbs(
  before,
  after,
  path,
  { allowEditDeltas = false } = {}
) {
  const retained = new Map();
  for (const contour of after?.contours || []) {
    if (contour.closed) continue;
    const previous = before?.contours?.find((c) => c.id === contour.id);
    if (!previous || previous.closed) continue;
    for (const atStart of [true, false]) {
      const terminal = atStart ? contour.points[0] : contour.points.at(-1);
      if (!terminal || (terminal.capStyle ?? contour.capStyle) !== "drop") continue;
      if (
        terminalInput(previous, atStart, allowEditDeltas) !==
        terminalInput(contour, atStart, allowEditDeltas)
      )
        continue;
      for (const entry of before.generated || []) {
        if (
          entry.skeletonContourId !== contour.id ||
          !Number.isInteger(entry.pathContourIndex) ||
          entry.pathContourIndex < 0 ||
          entry.pathContourIndex >= path.numContours
        )
          continue;
        const map = entry.pointMap || [];
        const indices = ["entry", "bottom", "side", "neck"].map((role) =>
          map.findIndex(
            (p) =>
              p?.skeletonPointId === terminal.id &&
              p.bulbRole === role &&
              p.bulbSlot === "onCurve"
          )
        );
        if (indices.some((i) => i < 0)) continue;
        const source = path.getUnpackedContour(entry.pathContourIndex).points;
        const count = source.length;
        const step = (indices[0] + 3) % count === indices[1] ? 1 : -1;
        if (
          !indices.every(
            (index, i) => (indices[0] + step * i * 3 + count) % count === index
          )
        )
          continue;
        const at = (i) => {
          const index = (indices[0] + step * i + count * 2) % count;
          return { ...source[index], _provenance: structuredClone(map[index]) };
        };
        const origin = map[indices[0]];
        const snapshot = origin.constructionSegment;
        const originalWall = snapshot && (atStart ? [...snapshot].reverse() : snapshot);
        retained.set(`${contour.id}/${terminal.id}`, {
          points: Array.from({ length: 13 }, (_, i) => at(i)),
          wall: Array.from({ length: 4 }, (_, i) => at(i - 3)),
          originalWall,
          tangents: indices.map((i) => map[i].bulbTangent),
          entryParameter: origin.bulbEntryParameter,
          entryBallParameter: origin.bulbEntryBallParameter,
          orthogonalEntry: origin.bulbEntryOrthogonal,
          error: origin.bulbHarmonizationError,
          editDeltas: allowEditDeltas
            ? bulbEditDeltas(
                (atStart ? previous.points[0] : previous.points.at(-1)).capBallEdits,
                terminal.capBallEdits
              )
            : null,
        });
      }
    }
  }
  return retained;
}

export function reconnectRetainedBulb(retained, wall, inner) {
  const result = structuredClone(retained);
  const q = inner.at(-1);
  const previousQ = result.points[12];
  // Keep the bulb-owned anchors and handles. Only the existing wall endpoint
  // and its incoming handle follow that rib's displacement.
  result.points[11].x += q.x - previousQ.x;
  result.points[11].y += q.y - previousQ.y;
  result.points[12] = { ...q };
  for (const i of [0, 1]) {
    const original = result.originalWall?.[i];
    if (original) {
      result.wall[i].x += wall[i].x - original.x;
      result.wall[i].y += wall[i].y - original.y;
    }
  }
  result.keptInner = [result.points[12]];
  if (result.editDeltas) applyBulbEditDeltas(result, result.editDeltas);
  return result;
}

function bulbEditDeltas(before, after) {
  return ["entry", "bottom", "side", "neck"].map((role) =>
    Object.fromEntries(
      ["slide", "normal", "turn", "in", "out", "carry"].map((field) => [
        field,
        (after?.[role]?.[field] ?? 0) - (before?.[role]?.[field] ?? 0),
      ])
    )
  );
}

// Direct manipulation starts from the outline the user grabbed. Apply the
// stored-edit delta to that snapshot; do not solve a new bulb under the cursor.
export function applyBulbEditDeltas(result, deltas) {
  const p = result.points;
  const unit = (x, y) => {
    const n = Math.hypot(x, y) || 1;
    return { x: x / n, y: y / n };
  };
  for (let k = 0; k < 4; k++) {
    const edit = deltas[k];
    if (!edit || !Object.values(edit).some(Boolean)) continue;
    const i = 3 * k,
      anchor = { ...p[i] };
    const tangent = unit(p[i + 1].x - anchor.x, p[i + 1].y - anchor.y);
    const slide = k ? edit.slide : 0,
      normal = k === 3 ? edit.normal : 0;
    p[i].x += tangent.x * slide - tangent.y * normal;
    p[i].y += tangent.y * slide + tangent.x * normal;
    for (const [h, sign, slot] of [
      [i - 1, -1, "in"],
      [i + 1, 1, "out"],
    ]) {
      if (h < 0) continue;
      const dx = p[h].x - anchor.x,
        dy = p[h].y - anchor.y;
      const direction = unit(dx, dy),
        angle = k === 3 ? edit.turn : 0;
      const length = Math.max(
        0,
        Math.hypot(dx, dy) + edit[slot] + sign * ((k ? edit.carry : 0) - slide)
      );
      p[h].x =
        p[i].x +
        length * (direction.x * Math.cos(angle) - direction.y * Math.sin(angle));
      p[h].y =
        p[i].y +
        length * (direction.x * Math.sin(angle) + direction.y * Math.cos(angle));
    }
    result.tangents[k] = unit(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
  }
  // Retained diagnostics must describe the edited curves, not the old fit.
  const errors = [
    Math.abs(bulbEndCurvature(result.wall, true) - bulbEndCurvature(p.slice(0, 4))),
  ];
  for (const i of [3, 6, ...(p[9].smooth ? [9] : [])])
    errors.push(
      Math.abs(
        bulbEndCurvature(p.slice(i - 3, i + 1), true) -
          bulbEndCurvature(p.slice(i, i + 4))
      )
    );
  result.error =
    Math.max(...errors) * Math.max(1, Math.hypot(p[3].x - p[6].x, p[3].y - p[6].y));
}
