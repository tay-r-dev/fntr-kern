export function normalizePairsPerRow(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100 ? number : 6;
}

// Arrange independently shaped pair lines without introducing cross-pair kerns.
// Called once on a freshly built scene, before its geometry is published.
export function layoutPairPreview(scene, pairsPerRow, unitsPerEm) {
  const lines = scene.positionedLines;
  if (!lines.length) return scene;
  const columns = normalizePairsPerRow(pairsPerRow);
  const em = unitsPerEm || 1000;
  // Use advances, not kerned widths, so dragging a kern cannot move other cells.
  const cellWidth = Math.max(em, ...lines.map((line) =>
    line.glyphs.reduce((width, item) => width + (item.glyph.xAdvance || 0), 0))) + em * 0.5;
  const rowHeight = em * 1.1;
  const moveBounds = (bounds, dx, dy) => bounds && ({
    xMin: bounds.xMin + dx, xMax: bounds.xMax + dx,
    yMin: bounds.yMin + dy, yMax: bounds.yMax + dy,
  });
  let rightEdge = 0;
  lines.forEach((line, index) => {
    const x = (index % columns) * cellWidth;
    const y = -Math.floor(index / columns) * rowHeight || 0;
    const dx = x - line.origin.x;
    const dy = y - line.origin.y;
    line.origin = { x, y };
    line.endPoint = { x: line.endPoint.x + dx, y: line.endPoint.y + dy };
    line.bounds = moveBounds(line.bounds, dx, dy);
    for (const glyph of line.glyphs) {
      glyph.x += dx;
      glyph.y += dy;
      glyph.bounds = moveBounds(glyph.bounds, dx, dy);
    }
    rightEdge = Math.max(rightEdge, line.endPoint.x, line.bounds?.xMax || 0);
  });
  scene.longestLineLength = rightEdge;
  return scene;
}
