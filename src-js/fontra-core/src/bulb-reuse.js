// A terminal depends on its own settings and its adjoining skeleton segment.
// The next rib's width/nudge and the rest of the contour do not rebuild its ball.
function terminalInput(contour, atStart) {
  const points = atStart ? contour.points : [...contour.points].reverse();
  const next = points.findIndex((p, i) => i > 0 && !p.type);
  if (next < 0) return null;
  const terminal = { ...points[0] };
  delete terminal.locked;
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

export function collectUnchangedBulbs(before, after, path) {
  const retained = new Map();
  for (const contour of after?.contours || []) {
    if (contour.closed) continue;
    const previous = before?.contours?.find((c) => c.id === contour.id);
    if (!previous || previous.closed) continue;
    for (const atStart of [true, false]) {
      const terminal = atStart ? contour.points[0] : contour.points.at(-1);
      if (!terminal || (terminal.capStyle ?? contour.capStyle) !== "drop") continue;
      if (terminalInput(previous, atStart) !== terminalInput(contour, atStart))
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
  return result;
}
