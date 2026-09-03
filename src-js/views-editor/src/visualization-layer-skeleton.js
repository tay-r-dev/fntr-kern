import {
  drawCubicHandleLabelPair,
  drawPointStyleLabel,
} from "@fontra/core/distance-angle.js";
import {
  buildGeneratedTunniSegments,
  buildSkeletonTunniSegments,
  calculateGeneratedOnCurveGizmoPoint,
  calculateSkeletonTrueTunniPoint,
  calculateSkeletonTunniPoint,
  formatGeneratedCurvature,
  generatedSegmentHandleAxes,
  getGeneratedSegmentCurvature,
  getSkeletonData,
  getSkeletonHandleOffset,
  getSkeletonInsertionPosition,
  getSkeletonInsertionRibPosition,
  getSkeletonRibEndpoints,
  isSkeletonSideLocked,
  isSkeletonSideLockedAtAll,
  makeEditableGeneratedHandleKey,
  makeEditableGeneratedPointKey,
  SKELETON_INSERTION_KEY_KIND,
  makeSkeletonInsertionKey,
  skeletonInsertionKeyFromSelectionItem,
  makeSkeletonRibKey,
} from "@fontra/core/skeleton-model.js";
import {
  calculateCurvatureGizmoAxis,
  calculateCurvatureGizmoPoint,
} from "@fontra/core/tunni-calculations.js";
import { parseSelection } from "@fontra/core/utils.ts";

import {
  fillRoundNode,
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeLine,
} from "./visualization-layer-definitions.js";

// The layer the skeleton is being edited on. Its skeleton section and its path
// have to come off the same glyph: the generator addresses its own points by
// index into the path it produced, and one layer's indices say nothing about
// another's.
function getSkeletonLayerGlyph(positionedGlyph, model) {
  const editLayerName =
    model.sceneSettings?.editLayerName || positionedGlyph.glyph?.layerName;
  const layerGlyph =
    editLayerName && positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph;
  return layerGlyph || positionedGlyph.glyph;
}

function getSkeletonDataFromGlyph(positionedGlyph, model) {
  return getSkeletonData(getSkeletonLayerGlyph(positionedGlyph, model));
}

function getOnCurvePointIndices(contour) {
  const indices = [];
  for (let i = 0; i < contour.points.length; i++) {
    if (!contour.points[i].type) {
      indices.push(i);
    }
  }
  return indices;
}

function skeletonContourToPath2d(contour) {
  const path = new Path2D();
  const points = contour.points || [];
  const onCurveIndices = getOnCurvePointIndices(contour);
  if (!onCurveIndices.length) {
    return path;
  }

  const firstIndex = onCurveIndices[0];
  path.moveTo(points[firstIndex].x, points[firstIndex].y);

  let i = firstIndex + 1;
  const limit = contour.closed ? firstIndex + points.length + 1 : points.length;
  while (i < limit) {
    const point = points[i % points.length];
    if (!point.type) {
      path.lineTo(point.x, point.y);
      i += 1;
      continue;
    }

    // Open contours must not wrap: trailing off-curves (malformed data) would
    // otherwise draw a phantom segment from the last point back to the first
    const next = contour.closed ? points[(i + 1) % points.length] : points[i + 1];
    const afterNext = contour.closed ? points[(i + 2) % points.length] : points[i + 2];
    if (
      point.type === "cubic" &&
      next?.type === "cubic" &&
      afterNext &&
      !afterNext.type
    ) {
      path.bezierCurveTo(point.x, point.y, next.x, next.y, afterNext.x, afterNext.y);
      i += 3;
      continue;
    }
    if ((point.type === "quad" || point.type === "cubic") && next && !next.type) {
      path.quadraticCurveTo(point.x, point.y, next.x, next.y);
      i += 2;
      continue;
    }
    i += 1;
  }

  if (contour.closed) {
    path.closePath();
  }
  return path;
}

// Which of the three locks are on, drawn so that they can be told apart. Each
// mark lies along the freedom it removes: the width lock across the rib, the
// slide lock along it, and the handle lock as an arc, because what it holds is
// a curvature rather than a direction. A rib end with no lock gets no marks,
// and its endpoint keeps the plain pink treatment.
function drawSideLockMarks(context, parameters, sourcePoint, ribEnd, side) {
  // The rib direction is the direction width moves the end; the slide runs
  // across it. A collapsed side has no length, so it states no directions and
  // only the arc can be drawn.
  const dx = ribEnd.x - sourcePoint.x;
  const dy = ribEnd.y - sourcePoint.y;
  const length = Math.hypot(dx, dy);
  const along = length > 1e-9 ? { x: dx / length, y: dy / length } : null;
  const across = along ? { x: -along.y, y: along.x } : null;
  const gap = parameters.lockMarkGap;
  const half = parameters.lockMarkLength / 2;

  const tick = (direction, offset) => {
    if (!direction) {
      return;
    }
    const cx = ribEnd.x + offset.x * gap;
    const cy = ribEnd.y + offset.y * gap;
    strokeLine(
      context,
      cx - direction.x * half,
      cy - direction.y * half,
      cx + direction.x * half,
      cy + direction.y * half
    );
  };

  if (isSkeletonSideLocked(sourcePoint, side, "width") && along) {
    tick(along, across);
  }
  if (isSkeletonSideLocked(sourcePoint, side, "slide") && across) {
    tick(across, { x: -across.x, y: -across.y });
  }
  if (isSkeletonSideLocked(sourcePoint, side, "handles")) {
    context.beginPath();
    context.arc(
      ribEnd.x,
      ribEnd.y,
      parameters.lockArcRadius,
      0.15 * Math.PI,
      0.85 * Math.PI
    );
    context.stroke();
  }
}

function getRibPoints(contour, pointIndex, outline) {
  const point = contour.points[pointIndex];
  const activeSingleSide =
    contour.singleSided === "left" || contour.singleSided === "right"
      ? contour.singleSided
      : null;
  const { left, right } = getSkeletonRibEndpoints(contour, point, outline);
  return {
    center: point,
    left,
    unlockedLeft:
      activeSingleSide === "right" ? false : !isSkeletonSideLockedAtAll(point, "left"),
    right,
    unlockedRight:
      activeSingleSide === "left" ? false : !isSkeletonSideLockedAtAll(point, "right"),
  };
}

// An insertion point's two rib ends, both read off the drawn outline through the
// one reader. Null where the outline has not been generated yet, in which case
// nothing is drawn: an insertion point states a ratio of a width the skeleton
// never states between two ribs, so there is nothing to reconstruct it from.
function getInsertionRibPoints(contour, insertion, outline) {
  const left = getSkeletonInsertionRibPosition(outline, contour, insertion, "left");
  const right = getSkeletonInsertionRibPosition(outline, contour, insertion, "right");
  if (!left || !right) {
    return null;
  }
  return { center: getSkeletonInsertionPosition(contour, insertion), left, right };
}

function getSkeletonRibSelectionSets(model) {
  return {
    selected: new Set(
      (parseSelection(model.selection).skeletonRib || []).map(
        (item) => `skeletonRib/${item}`
      )
    ),
    hovered: new Set(
      (parseSelection(model.hoverSelection).skeletonRib || []).map(
        (item) => `skeletonRib/${item}`
      )
    ),
  };
}

function getSkeletonInsertionSelectionSets(model) {
  const keys = (selection) =>
    new Set(
      (parseSelection(selection)[SKELETON_INSERTION_KEY_KIND] || []).map(
        skeletonInsertionKeyFromSelectionItem
      )
    );
  return {
    selected: keys(model.selection),
    hovered: keys(model.hoverSelection),
  };
}

function getEditableGeneratedSelectionSets(model) {
  return {
    selectedPoints: new Set(
      (parseSelection(model.selection).editableGeneratedPoint || []).map(
        (item) => `editableGeneratedPoint/${item}`
      )
    ),
    hoveredPoints: new Set(
      (parseSelection(model.hoverSelection).editableGeneratedPoint || []).map(
        (item) => `editableGeneratedPoint/${item}`
      )
    ),
    selectedHandles: new Set(
      (parseSelection(model.selection).editableGeneratedHandle || []).map(
        (item) => `editableGeneratedHandle/${item}`
      )
    ),
    hoveredHandles: new Set(
      (parseSelection(model.hoverSelection).editableGeneratedHandle || []).map(
        (item) => `editableGeneratedHandle/${item}`
      )
    ),
  };
}

function getSkeletonPointSelectionSets(model) {
  return {
    selected: new Set(parseSelection(model.selection).skeletonPoint || []),
    hovered: new Set(parseSelection(model.hoverSelection).skeletonPoint || []),
  };
}

function strokeRoundNode(context, point, size) {
  context.beginPath();
  context.arc(point.x, point.y, size / 2, 0, 2 * Math.PI);
  context.stroke();
}

function strokeSquareNode(context, point, size) {
  context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
}

function drawDiamondNode(context, point, size, fill) {
  const half = size / 2;
  context.beginPath();
  context.moveTo(point.x, point.y - half);
  context.lineTo(point.x + half, point.y);
  context.lineTo(point.x, point.y + half);
  context.lineTo(point.x - half, point.y);
  context.closePath();
  if (fill) {
    context.fill();
  }
  context.stroke();
}

function fillSquareNode(context, point, size) {
  context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
}

function forEachSkeletonContour(positionedGlyph, model, callback) {
  const layerGlyph = getSkeletonLayerGlyph(positionedGlyph, model);
  const skeletonData = getSkeletonData(layerGlyph);
  if (!skeletonData?.contours?.length) {
    return;
  }
  // Handed to the rib readers, so a rib end at a corner is the outline's own
  // point rather than a reconstruction of it, and cannot stand off it.
  const outline = layerGlyph?.path ? { skeletonData, path: layerGlyph.path } : null;
  for (const contour of skeletonData.contours) {
    if (contour.points?.length) {
      callback(contour, outline);
    }
  }
}

function forEachEditableGeneratedTarget(positionedGlyph, model, callback) {
  const skeletonData = getSkeletonDataFromGlyph(positionedGlyph, model);
  const path = positionedGlyph.glyph.path;
  if (!skeletonData?.generated?.length || !path) {
    return;
  }
  for (const entry of skeletonData.generated) {
    if (!Number.isInteger(entry.pathContourIndex)) {
      continue;
    }
    for (const [contourPointIndex, provenance] of (entry.pointMap || []).entries()) {
      if (
        !provenance ||
        (provenance.role !== "onCurve" &&
          provenance.role !== "in" &&
          provenance.role !== "out") ||
        (provenance.side !== "left" && provenance.side !== "right")
      ) {
        continue;
      }
      const contourId = provenance.skeletonContourId ?? entry.skeletonContourId;
      const contour = (skeletonData.contours || []).find(
        (contour) => contour.id === contourId
      );
      const sourcePoint = (contour?.points || []).find(
        (point) => point.id === provenance.skeletonPointId
      );
      // Adjustable is the default since side locks landed, so marking every
      // adjustable target would mark nearly the whole outline. Mark the
      // exceptional state instead: generated targets whose side is LOCKED.
      // Each target answers to its own lock: the on-curve to the slide lock,
      // the two handles to the handle lock.
      const lockKind = provenance.role === "onCurve" ? "slide" : "handles";
      if (
        !contour ||
        sourcePoint?.type ||
        !isSkeletonSideLocked(sourcePoint, provenance.side, lockKind)
      ) {
        continue;
      }
      let pathPointIndex;
      try {
        pathPointIndex = path.getAbsolutePointIndex(
          entry.pathContourIndex,
          contourPointIndex
        );
      } catch {
        continue;
      }
      callback({
        point: path.getPoint(pathPointIndex),
        contour,
        sourcePoint,
        contourId,
        pointId: sourcePoint.id,
        side: provenance.side,
        role: provenance.role,
      });
    }
  }
}

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.width-shading",
  name: "Skeleton width shading",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 446,
  colors: {
    fillColor: "rgba(34, 121, 210, 0.12)",
  },
  colorsDarkMode: {
    fillColor: "rgba(95, 178, 255, 0.18)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    context.fillStyle = parameters.fillColor;
    forEachSkeletonContour(positionedGlyph, model, (contour, outline) => {
      const onCurveIndices = getOnCurvePointIndices(contour);
      const segmentCount = contour.closed
        ? onCurveIndices.length
        : onCurveIndices.length - 1;
      for (let i = 0; i < segmentCount; i++) {
        const a = getRibPoints(contour, onCurveIndices[i], outline);
        const b = getRibPoints(
          contour,
          onCurveIndices[(i + 1) % onCurveIndices.length],
          outline
        );
        context.beginPath();
        context.moveTo(a.left.x, a.left.y);
        context.lineTo(b.left.x, b.left.y);
        context.lineTo(b.right.x, b.right.y);
        context.lineTo(a.right.x, a.right.y);
        context.closePath();
        context.fill();
      }
    });
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.ribs",
  name: "Skeleton ribs",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 452,
  screenParameters: {
    lineWidth: 1,
  },
  colors: {
    strokeColor: "rgba(34, 121, 210, 0.45)",
  },
  colorsDarkMode: {
    strokeColor: "rgba(95, 178, 255, 0.55)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    context.lineWidth = parameters.lineWidth;
    context.strokeStyle = parameters.strokeColor;
    forEachSkeletonContour(positionedGlyph, model, (contour, outline) => {
      for (const pointIndex of getOnCurvePointIndices(contour)) {
        const rib = getRibPoints(contour, pointIndex, outline);
        strokeLine(context, rib.left.x, rib.left.y, rib.right.x, rib.right.y);
      }
      for (const insertion of contour.insertions || []) {
        const rib = getInsertionRibPoints(contour, insertion, outline);
        if (rib) {
          strokeLine(context, rib.left.x, rib.left.y, rib.right.x, rib.right.y);
        }
      }
    });
  },
});

// Donor parity (donor "fontra.skeleton.rib.points", zIndex 560): rib endpoints
// are stroked diamonds drawn ABOVE the other skeleton layers so they stay
// visible; selected diamonds are filled.
//
// Since side locks landed, adjustable is the DEFAULT state, so the plain
// (smaller, pink) style is the default and the emphatic purple one marks the
// exceptional state — a LOCKED side. Both distinctions (selected/unselected,
// locked/unlocked) must be readable at a glance.
registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.rib-points",
  name: "Skeleton rib points",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 560,
  screenParameters: {
    endpointSize: 10,
    lockedEndpointSize: 12,
    strokeWidth: 2,
    lockMarkLength: 7,
    lockMarkGap: 4,
    lockArcRadius: 8,
  },
  colors: {
    endpointColor: "rgba(220, 60, 120, 0.7)",
    endpointHoverColor: "rgba(220, 60, 120, 1)",
    endpointSelectedColor: "rgba(255, 64, 0, 0.9)",
    lockedColor: "rgba(160, 40, 180, 0.9)",
    lockedHoverColor: "rgba(160, 40, 180, 1)",
    lockedSelectedColor: "rgba(160, 40, 180, 1)",
  },
  colorsDarkMode: {
    endpointColor: "rgba(220, 100, 140, 0.7)",
    endpointHoverColor: "rgba(220, 100, 140, 1)",
    endpointSelectedColor: "rgba(255, 96, 64, 0.9)",
    lockedColor: "rgba(180, 80, 200, 0.9)",
    lockedHoverColor: "rgba(180, 80, 200, 1)",
    lockedSelectedColor: "rgba(180, 80, 200, 1)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const ribSelection = getSkeletonRibSelectionSets(model);
    const insertionSelection = getSkeletonInsertionSelectionSets(model);
    context.lineWidth = parameters.strokeWidth;
    forEachSkeletonContour(positionedGlyph, model, (contour, outline) => {
      for (const pointIndex of getOnCurvePointIndices(contour)) {
        const point = contour.points[pointIndex];
        const rib = getRibPoints(contour, pointIndex, outline);
        for (const side of ["left", "right"]) {
          if (contour.singleSided && contour.singleSided !== side) {
            continue;
          }
          const key = makeSkeletonRibKey(contour.id, point.id, side);
          // Locked is the marked state: it gets the larger purple treatment.
          const locked = side === "left" ? !rib.unlockedLeft : !rib.unlockedRight;
          const selected = ribSelection.selected.has(key);
          const hovered = ribSelection.hovered.has(key);
          const color = selected
            ? locked
              ? parameters.lockedSelectedColor
              : parameters.endpointSelectedColor
            : hovered
              ? locked
                ? parameters.lockedHoverColor
                : parameters.endpointHoverColor
              : locked
                ? parameters.lockedColor
                : parameters.endpointColor;
          context.strokeStyle = color;
          context.fillStyle = color;
          const size = locked ? parameters.lockedEndpointSize : parameters.endpointSize;
          drawDiamondNode(context, rib[side], size, selected);
          if (locked) {
            drawSideLockMarks(context, parameters, point, rib[side], side);
          }
        }
      }
      // An insertion point's ribs draw on this same layer, because they are
      // ribs and a designer reading the drawing should see them as ribs. The
      // centerline marker is a hollow ring rather than a filled diamond, which
      // is the one difference that says an insertion point does not bend the
      // centerline it stands on.
      for (const insertion of contour.insertions || []) {
        const rib = getInsertionRibPoints(contour, insertion, outline);
        if (!rib) {
          continue;
        }
        for (const side of ["left", "right"]) {
          if (contour.singleSided && contour.singleSided !== side) {
            continue;
          }
          const key = makeSkeletonRibKey(contour.id, insertion.id, side);
          const color = ribSelection.selected.has(key)
            ? parameters.endpointSelectedColor
            : ribSelection.hovered.has(key)
              ? parameters.endpointHoverColor
              : parameters.endpointColor;
          context.strokeStyle = color;
          context.fillStyle = color;
          drawDiamondNode(
            context,
            rib[side],
            parameters.endpointSize,
            ribSelection.selected.has(key)
          );
        }
        if (rib.center) {
          const key = makeSkeletonInsertionKey(contour.id, insertion.id);
          const selected = insertionSelection.selected.has(key);
          const hovered = insertionSelection.hovered.has(key);
          const color = selected
            ? parameters.endpointSelectedColor
            : hovered
              ? parameters.endpointHoverColor
              : parameters.endpointColor;
          context.strokeStyle = color;
          context.fillStyle = color;
          // Selected fills the ring and adds an outer circle, the way a
          // selected rib end is filled. Hollow is the resting state, and it is
          // what says the point does not bend the line it stands on.
          const radius = parameters.endpointSize / 2;
          context.beginPath();
          context.arc(rib.center.x, rib.center.y, radius, 0, 2 * Math.PI);
          context.stroke();
          if (selected) {
            context.fill();
            context.beginPath();
            context.arc(
              rib.center.x,
              rib.center.y,
              radius + parameters.strokeWidth * 2,
              0,
              2 * Math.PI
            );
            context.stroke();
          }
        }
      }
    });
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.centerline",
  name: "Skeleton centerline",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 455,
  screenParameters: {
    strokeWidth: 1.5,
  },
  colors: {
    strokeColor: "#2279d2",
  },
  colorsDarkMode: {
    strokeColor: "#5fb2ff",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.strokeColor;
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      context.stroke(skeletonContourToPath2d(contour));
    });
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.handles",
  name: "Skeleton handles",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 545,
  screenParameters: {
    strokeWidth: 1,
  },
  colors: {
    strokeColor: "rgba(34, 121, 210, 0.55)",
  },
  colorsDarkMode: {
    strokeColor: "rgba(95, 178, 255, 0.65)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.strokeColor;
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      const points = contour.points;
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!point.type) {
          continue;
        }
        const previous = points[(i - 1 + points.length) % points.length];
        const next = points[(i + 1) % points.length];
        if (previous && !previous.type) {
          strokeLine(context, previous.x, previous.y, point.x, point.y);
        } else if (previous?.type && next && !next.type) {
          strokeLine(context, next.x, next.y, point.x, point.y);
        }
      }
    });
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.nodes",
  name: "Skeleton nodes",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 550,
  screenParameters: {
    cornerSize: 7,
    handleSize: 5,
    smoothSize: 7,
  },
  colors: {
    fillColor: "#2279d2",
  },
  colorsDarkMode: {
    fillColor: "#5fb2ff",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    context.fillStyle = parameters.fillColor;
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      for (const point of contour.points) {
        if (point.type) {
          fillRoundNode(context, point, parameters.handleSize);
        } else if (point.smooth) {
          fillRoundNode(context, point, parameters.smoothSize);
        } else {
          fillSquareNode(context, point, parameters.cornerSize);
        }
      }
    });
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.selected-nodes",
  name: "Selected skeleton nodes",
  selectionFunc: glyphSelector("editing"),
  zIndex: 552,
  screenParameters: {
    cornerSize: 8,
    handleSize: 6,
    smoothSize: 8,
    strokeWidth: 1.5,
    hoverStrokeOffset: 4,
    underlayOffset: 2,
  },
  colors: {
    hoveredColor: "rgba(34, 121, 210, 0.95)",
    selectedColor: "rgba(255, 128, 0, 0.95)",
    underColor: "#FFFA",
  },
  colorsDarkMode: {
    hoveredColor: "rgba(95, 178, 255, 1)",
    selectedColor: "rgba(255, 174, 68, 1)",
    underColor: "#0008",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const { selected, hovered } = getSkeletonPointSelectionSets(model);
    if (!selected.size && !hovered.size) {
      return;
    }
    const nodeSize = (point, offset = 0) =>
      point.type
        ? parameters.handleSize + offset
        : point.smooth
          ? parameters.smoothSize + offset
          : parameters.cornerSize + offset;
    const fillNode = (point, offset = 0) => {
      if (!point.type && !point.smooth) {
        fillSquareNode(context, point, nodeSize(point, offset));
      } else {
        fillRoundNode(context, point, nodeSize(point, offset));
      }
    };
    const strokeNode = (point, offset = 0) => {
      if (!point.type && !point.smooth) {
        strokeSquareNode(context, point, nodeSize(point, offset));
      } else {
        strokeRoundNode(context, point, nodeSize(point, offset));
      }
    };
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      for (const point of contour.points) {
        const key = `${contour.id}/${point.id}`;
        const isSelected = selected.has(key);
        const isHovered = hovered.has(key);
        if (!isSelected && !isHovered) {
          continue;
        }
        if (isSelected) {
          context.fillStyle = parameters.underColor;
          fillNode(point, parameters.underlayOffset);
          context.fillStyle = parameters.selectedColor;
          fillNode(point);
        } else {
          context.strokeStyle = parameters.hoveredColor;
          context.lineWidth = parameters.strokeWidth;
          strokeNode(point, parameters.hoverStrokeOffset);
        }
      }
    });
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.tunni",
  name: "Skeleton Tunni",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 547,
  screenParameters: {
    lineDash: [4, 4],
    midpointSize: 7,
    strokeWidth: 1,
    truePointSize: 8,
  },
  colors: {
    lineColor: "rgba(34, 121, 210, 0.55)",
    midpointColor: "rgba(0, 185, 220, 0.95)",
    truePointColor: "rgba(255, 128, 0, 0.95)",
  },
  colorsDarkMode: {
    lineColor: "rgba(95, 178, 255, 0.65)",
    midpointColor: "rgba(77, 213, 236, 1)",
    truePointColor: "rgba(255, 174, 68, 1)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    context.save();
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.lineColor;
    context.setLineDash(parameters.lineDash);
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      for (const segment of buildSkeletonTunniSegments(contour)) {
        if (segment.controlPoints.length !== 2) {
          continue;
        }
        const [control1, control2] = segment.controlPoints;
        strokeLine(
          context,
          segment.startPoint.x,
          segment.startPoint.y,
          control1.x,
          control1.y
        );
        strokeLine(
          context,
          segment.endPoint.x,
          segment.endPoint.y,
          control2.x,
          control2.y
        );
        strokeLine(context, control1.x, control1.y, control2.x, control2.y);
      }
    });
    context.setLineDash([]);
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      for (const segment of buildSkeletonTunniSegments(contour)) {
        if (segment.controlPoints.length !== 2) {
          continue;
        }
        const midpoint = calculateSkeletonTunniPoint(segment);
        const truePoint = calculateSkeletonTrueTunniPoint(segment);
        if (midpoint) {
          context.fillStyle = parameters.midpointColor;
          fillRoundNode(context, midpoint, parameters.midpointSize);
        }
        if (truePoint) {
          context.fillStyle = parameters.truePointColor;
          drawDiamondNode(context, truePoint, parameters.truePointSize, true);
        }
      }
    });
    context.restore();
  },
});

// The two gizmos on a GENERATED segment (D8). Deliberately a separate layer
// from fontra.skeleton.tunni: that one controls the skeleton, this one controls
// the outline the skeleton produced, and a designer switches between the two
// questions independently.
registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.generated-tunni",
  name: "Generated contour gizmos",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 548,
  screenParameters: {
    lineDash: [3, 3],
    curvatureSize: 7,
    strokeWidth: 1,
    onCurveSize: 8,
    curvatureAxisLength: 18,
  },
  colors: {
    axisColor: "rgba(0, 160, 120, 0.5)",
    curvatureColor: "rgba(0, 175, 130, 0.95)",
    onCurveColor: "rgba(210, 90, 190, 0.95)",
  },
  colorsDarkMode: {
    axisColor: "rgba(80, 220, 180, 0.6)",
    curvatureColor: "rgba(96, 232, 190, 1)",
    onCurveColor: "rgba(240, 140, 220, 1)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const skeletonData = getSkeletonDataFromGlyph(positionedGlyph, model);
    const segments = buildGeneratedTunniSegments(
      skeletonData,
      positionedGlyph.glyph.path
    );
    if (!segments.length) {
      return;
    }
    context.save();
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.axisColor;
    context.setLineDash(parameters.lineDash);
    // The axis first, so both nodes sit on top of it. Drawing the axis at all
    // is what makes the curvature control legible: it is the direction the
    // curve swells in, and without it the node looks free to go anywhere.
    for (const segment of segments) {
      if (segment.handlesLocked) {
        continue;
      }
      const anchor = calculateCurvatureGizmoPoint(segment.points);
      const axis = calculateCurvatureGizmoAxis(
        segment.points,
        generatedSegmentHandleAxes(segment.provenance)
      );
      if (anchor && axis) {
        strokeLine(
          context,
          anchor.x,
          anchor.y,
          anchor.x + axis.x * parameters.curvatureAxisLength,
          anchor.y + axis.y * parameters.curvatureAxisLength
        );
      }
    }
    context.setLineDash([]);
    for (const segment of segments) {
      const gizmoPoint = segment.onCurveMovable?.some(Boolean)
        ? calculateGeneratedOnCurveGizmoPoint(segment)
        : null;
      if (gizmoPoint) {
        context.fillStyle = parameters.onCurveColor;
        drawDiamondNode(context, gizmoPoint, parameters.onCurveSize, true);
      }
      // A handle-locked side has no curvature gizmo: the control is gone, not
      // merely inert.
      const anchor = segment.handlesLocked
        ? null
        : calculateCurvatureGizmoPoint(segment.points);
      if (anchor) {
        context.fillStyle = parameters.curvatureColor;
        fillRoundNode(context, anchor, parameters.curvatureSize);
      }
    }
    context.restore();
  },
});

// The number the curvature gizmo owns, beside the gizmo. Its own layer because it
// answers a different question from the control itself — "what is this segment at"
// rather than "let me change it" — and a designer wants the second without the
// first once the numbers stop being news. While a curvature drag is running the
// drag readout shows the same value regardless of this switch.
registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.generated-curvature-labels",
  name: "Generated curvature labels",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 549,
  screenParameters: { labelOffset: 13, labelInset: 5 },
  colors: { color: "rgba(0, 120, 90, 1)", pinnedColor: "rgba(190, 60, 20, 1)" },
  colorsDarkMode: {
    color: "rgba(96, 232, 190, 1)",
    pinnedColor: "rgba(255, 150, 90, 1)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const skeletonData = getSkeletonDataFromGlyph(positionedGlyph, model);
    for (const segment of buildGeneratedTunniSegments(
      skeletonData,
      positionedGlyph.glyph.path
    )) {
      const curvature = getGeneratedSegmentCurvature(skeletonData, segment);
      const anchor = calculateCurvatureGizmoPoint(segment.points);
      if (!curvature || !anchor) {
        continue;
      }
      // Straight above the gizmo, clear of the node. Placing it along the axis
      // instead put it where the gizmo and its stub already are, and an offset
      // that follows the axis moves the number around as the segment turns —
      // a label the eye has to hunt for is worse than one that occasionally
      // crosses the stub.
      drawPointStyleLabel(
        context,
        anchor.x + parameters.labelInset,
        anchor.y + parameters.labelOffset,
        formatGeneratedCurvature(curvature),
        curvature.pinned ? parameters.pinnedColor : parameters.color
      );
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.insert-handles-preview",
  name: "Skeleton insert handles preview",
  selectionFunc: glyphSelector("editing"),
  zIndex: 565,
  screenParameters: {
    nodeSize: 5,
  },
  colors: {
    fillColor: "rgba(34, 121, 210, 0.6)",
  },
  colorsDarkMode: {
    fillColor: "rgba(95, 178, 255, 0.7)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const preview = model.skeletonInsertHandles;
    if (!preview?.points?.length) {
      return;
    }
    context.fillStyle = parameters.fillColor;
    for (const point of preview.points) {
      fillRoundNode(context, point, parameters.nodeSize);
    }
  },
});

// What the skeleton pen has under the pointer, and what a click would do with
// it. Four marks, because the pen has four answers: a ring with a filled centre
// closes the contour, a plain ring resumes drawing from that end, a dashed ring
// says the point can only be selected - the pen cannot draw on from the middle
// of a contour - and a small ring on the centerline says W will put an
// insertion point there.
registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.pen-hover",
  name: "Skeleton pen hover",
  selectionFunc: glyphSelector("editing"),
  zIndex: 566,
  screenParameters: {
    ringSize: 13,
    dotSize: 5,
    strokeWidth: 1.5,
    dashLength: 2.5,
  },
  colors: {
    activeColor: "#2279d2",
    inertColor: "rgba(80, 80, 80, 0.7)",
  },
  colorsDarkMode: {
    activeColor: "#5fb2ff",
    inertColor: "rgba(200, 200, 200, 0.7)",
  },
  draw: (context, positionedGlyph, parameters, model) => {
    const target = model.skeletonPenHoverTarget;
    if (!target) {
      return;
    }
    const isInert = target.kind === "select";
    context.save();
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = isInert ? parameters.inertColor : parameters.activeColor;
    if (isInert) {
      context.setLineDash([parameters.dashLength, parameters.dashLength]);
    }
    // The insertion mark is the ring the point itself is drawn with, so what
    // the hover promises and what lands are the same shape.
    const ringSize =
      target.kind === "insertion" ? parameters.dotSize * 2 : parameters.ringSize;
    context.beginPath();
    context.arc(target.x, target.y, ringSize / 2, 0, 2 * Math.PI, false);
    context.stroke();
    context.restore();
    if (target.kind === "close") {
      context.fillStyle = parameters.activeColor;
      fillRoundNode(context, target, parameters.dotSize);
    }
  },
});

registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.editable-markers",
  name: "Skeleton locked markers",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 560,
  screenParameters: {
    handleSize: 7,
    pointSize: 11,
    strokeWidth: 2,
  },
  colors: {
    fillColor: "rgba(161, 73, 184, 0.22)",
    hoverFillColor: "rgba(161, 73, 184, 0.35)",
    selectedFillColor: "rgba(255, 128, 0, 0.28)",
    strokeColor: "rgba(161, 73, 184, 0.95)",
    hoverStrokeColor: "rgba(161, 73, 184, 1)",
    selectedStrokeColor: "rgba(255, 128, 0, 0.95)",
  },
  colorsDarkMode: {
    fillColor: "rgba(199, 119, 221, 0.28)",
    hoverFillColor: "rgba(199, 119, 221, 0.42)",
    selectedFillColor: "rgba(255, 174, 68, 0.35)",
    strokeColor: "rgba(199, 119, 221, 0.95)",
    hoverStrokeColor: "rgba(199, 119, 221, 1)",
    selectedStrokeColor: "rgba(255, 174, 68, 1)",
  },
  // Locked rib endpoints are drawn (purple, larger) by the rib-points layer;
  // this layer marks the GENERATED targets on the outline that are blocked by
  // that same lock.
  draw: (context, positionedGlyph, parameters, model) => {
    context.lineWidth = parameters.strokeWidth;
    context.strokeStyle = parameters.strokeColor;
    context.fillStyle = parameters.fillColor;
    const generatedSelection = getEditableGeneratedSelectionSets(model);
    forEachEditableGeneratedTarget(positionedGlyph, model, (target) => {
      const isHandle = target.role === "in" || target.role === "out";
      const key = isHandle
        ? makeEditableGeneratedHandleKey(
            target.contourId,
            target.pointId,
            target.side,
            target.role
          )
        : makeEditableGeneratedPointKey(target.contourId, target.pointId, target.side);
      const selected = isHandle
        ? generatedSelection.selectedHandles.has(key)
        : generatedSelection.selectedPoints.has(key);
      const hovered = isHandle
        ? generatedSelection.hoveredHandles.has(key)
        : generatedSelection.hoveredPoints.has(key);
      context.strokeStyle = selected
        ? parameters.selectedStrokeColor
        : hovered
          ? parameters.hoverStrokeColor
          : parameters.strokeColor;
      context.fillStyle = selected
        ? parameters.selectedFillColor
        : hovered
          ? parameters.hoverFillColor
          : parameters.fillColor;
      if (isHandle) {
        fillRoundNode(context, target.point, parameters.handleSize);
        context.stroke();
        if (
          getSkeletonHandleOffset(target.sourcePoint, target.side, target.role).detached
        ) {
          drawDiamondNode(context, target.point, parameters.handleSize + 4, false);
        }
      } else {
        drawDiamondNode(context, target.point, parameters.pointSize, true);
      }
    });
  },
});

// 4.1: skeleton centerline handle labels live on their own switchable layer;
// basic and generated path points share the regular "Point labels" layer.
registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.point-labels",
  name: "Skeleton point labels",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 500,
  screenParameters: { strokeWidth: 1 },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const skeletonData = getSkeletonDataFromGlyph(positionedGlyph, model);
    if (!skeletonData?.contours?.length) {
      return;
    }
    const show = {
      distance: model.sceneSettings?.showLabelsDistance ?? true,
      tension: model.sceneSettings?.showLabelsTension ?? true,
      angle: model.sceneSettings?.showLabelsAngle ?? true,
    };
    for (const contour of skeletonData.contours) {
      const points = contour.points || [];
      const numPoints = points.length;
      for (let i = 0; i < numPoints; i++) {
        const p1 = points[i];
        if (!p1 || p1.type) {
          continue;
        }
        const at = (offset) =>
          contour.closed ? points[(i + offset) % numPoints] : points[i + offset];
        const p2 = at(1);
        const p3 = at(2);
        const p4 = at(3);
        if (p2?.type === "cubic" && p3?.type === "cubic" && p4 && !p4.type) {
          try {
            drawCubicHandleLabelPair(context, [p1, p2, p3, p4], show);
          } catch (error) {
            // Skip segments where tension calculation fails
          }
        }
      }
    }
  },
});

// The skeleton is not in the glyph path, so "fontra.point.index" cannot see it.
// This layer counts the skeleton's own points, in its own run: one sequence
// across every skeleton contour, on-curves and handles alike, starting at 0.
// The numbers are deliberately unrelated to the path point indices.
registerVisualizationLayerDefinition({
  identifier: "fontra.skeleton.point-index",
  name: "sidebar.user-settings.glyph.skeleton.point.index",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 600,
  screenParameters: { fontSize: 10 },
  colors: { boxColor: "#FFFB", color: "#000" },
  colorsDarkMode: { boxColor: "#1118", color: "#FFF" },
  draw: (context, positionedGlyph, parameters, model) => {
    const { selected } = getSkeletonPointSelectionSets(model);
    if (!selected.size) {
      return;
    }

    const fontSize = parameters.fontSize;
    const margin = 0.2 * fontSize;
    const boxHeight = (1.68 * fontSize) / 2;
    const bottomY = -0.75 * fontSize * 2;

    context.font = `${fontSize}px fontra-ui-regular, sans-serif`;
    context.textAlign = "center";
    context.scale(1, -1);

    let pointIndex = 0;
    forEachSkeletonContour(positionedGlyph, model, (contour) => {
      for (const point of contour.points) {
        const index = pointIndex++;
        if (!selected.has(`${contour.id}/${point.id}`)) {
          continue;
        }
        const label = `${index}`;
        const width = context.measureText(label).width + 2 * margin;
        context.fillStyle = parameters.boxColor;
        context.fillRect(
          point.x - width / 2,
          -point.y - bottomY + margin,
          width,
          -boxHeight - 2 * margin
        );
        context.fillStyle = parameters.color;
        context.fillText(label, point.x, -point.y - bottomY);
      }
    });
  },
});
