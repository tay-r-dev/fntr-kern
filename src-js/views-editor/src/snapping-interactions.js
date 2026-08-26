import { parseSelection } from "@fontra/core/utils.js";
import {
  getSkeletonData,
  resolveGeneratedPointProvenance,
} from "@fontra/core/skeleton-model.js";
import {
  collectCandidates,
  resolveSnap,
  resolveSnapForPoints,
  roundSnapped,
} from "@fontra/core/snapping.js";

function segmentAngle(from, to) {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

// Every segment of the path, as the plain records `collectCandidates` consumes.
// A straight segment states its own direction. A curve states the tangent at
// each of its two ends, anchored on the on-curve point.
function* iterPathSegments(path) {
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    for (const pointIndices of path.iterContourSegmentPointIndices(contourIndex)) {
      const points = pointIndices.map((i) => path.getPoint(i));
      if (points.some((point) => !point)) {
        continue;
      }
      if (points.length === 2) {
        yield {
          pointIndices,
          candidate: {
            type: "line",
            x: points[0].x,
            y: points[0].y,
            angle: segmentAngle(points[0], points[1]),
          },
        };
        continue;
      }
      const last = points.length - 1;
      yield {
        pointIndices,
        candidate: {
          type: "tangent",
          x: points[0].x,
          y: points[0].y,
          angle: segmentAngle(points[0], points[1]),
        },
      };
      yield {
        pointIndices,
        candidate: {
          type: "tangent",
          x: points[last].x,
          y: points[last].y,
          angle: segmentAngle(points[last], points[last - 1]),
        },
      };
    }
  }
}

// Spec section 6. The moved geometry contributes nothing, and neither does the
// generated geometry that follows it. Which generated points those are is a
// provenance lookup, never a geometric match (R-D).
function excludedPointIndices(sceneController, movedPointIndices) {
  const excluded = new Set(movedPointIndices);
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  const path = positionedGlyph?.glyph?.path;
  const skeletonData = getSkeletonData(positionedGlyph?.glyph);
  if (!path || !skeletonData) {
    return excluded;
  }

  const movedSkeletonPoints = new Set(
    parseSelection(sceneController.selection).skeletonPoint || []
  );
  for (const pointIndex of excluded) {
    const provenance = resolveGeneratedPointProvenance(skeletonData, path, pointIndex);
    if (provenance) {
      movedSkeletonPoints.add(`${provenance.contourId}/${provenance.pointId}`);
    }
  }
  if (!movedSkeletonPoints.size) {
    return excluded;
  }

  for (let pointIndex = 0; pointIndex < path.numPoints; pointIndex++) {
    const provenance = resolveGeneratedPointProvenance(skeletonData, path, pointIndex);
    if (
      provenance &&
      movedSkeletonPoints.has(`${provenance.contourId}/${provenance.pointId}`)
    ) {
      excluded.add(pointIndex);
    }
  }
  return excluded;
}

export function buildSnapScene(sceneController, excludePointIndices) {
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  const glyph = positionedGlyph?.glyph;
  if (!glyph) {
    return { metrics: [], guides: [], points: [], segments: [] };
  }
  const excluded = excludedPointIndices(sceneController, excludePointIndices);

  const metrics = [];
  const lineMetrics =
    sceneController.sceneModel.fontSourceInstance?.lineMetricsHorizontalLayout || {};
  for (const [name, metric] of Object.entries(lineMetrics)) {
    metrics.push({ name, value: metric.value, kind: "metric" });
    if (metric.zone) {
      metrics.push({
        name: `${name}Zone`,
        value: metric.value + metric.zone,
        kind: "band",
      });
    }
  }

  const guides = [
    ...(glyph.guidelines || []),
    ...(sceneController.sceneModel.fontSourceInstance?.guidelines || []),
  ].map((guideline) => ({
    x: guideline.x,
    y: guideline.y,
    angle: guideline.angle || 0,
  }));

  const points = [];
  const segments = [];
  const path = glyph.path;
  for (let i = 0; i < path.numPoints; i++) {
    if (excluded.has(i)) {
      continue;
    }
    const point = path.getPoint(i);
    if (point.type) {
      continue; // off-curve points contribute no rays
    }
    points.push({ x: point.x, y: point.y });
  }
  for (const segment of iterPathSegments(path)) {
    if (segment.pointIndices.some((i) => excluded.has(i))) {
      continue;
    }
    segments.push(segment.candidate);
  }
  return { metrics, guides, points, segments };
}

export class SnappingSession {
  constructor(sceneController, { excludePointIndices = [] } = {}) {
    this.sceneController = sceneController;
    this.scene = buildSnapScene(sceneController, excludePointIndices);
    this.held = null;
  }

  get enabled() {
    return this.sceneController.sceneSettings.snappingEnabled ?? true;
  }

  resolve(point, { constraint } = {}) {
    if (!this.enabled) {
      return point;
    }
    const pixelUnit = this.sceneController.onePixelUnit;
    const candidates = collectCandidates(this.scene, point, { pixelUnit });
    const result = resolveSnap(candidates, point, {
      pixelUnit,
      held: this.held?.candidate || null,
      constraint,
    });
    this.held = result.held.length
      ? { pointIndex: 0, candidate: result.held[0] }
      : null;
    this.sceneController.sceneModel.snapHeldCandidates = result.held;
    return roundSnapped(result, (value) => Math.round(value));
  }

  resolveSet(points, cursor, { constraint } = {}) {
    if (!this.enabled || !points.length) {
      return { x: 0, y: 0 };
    }
    const pixelUnit = this.sceneController.onePixelUnit;
    // The candidate set is built against the cursor once per frame, and every point is
    // then resolved against that one set.
    const candidates = collectCandidates(this.scene, cursor, { pixelUnit });
    const best = resolveSnapForPoints(candidates, points, cursor, {
      pixelUnit,
      held: this.held,
      constraint,
    });
    this.sceneController.sceneModel.snapHeldCandidates = best.held;
    if (best.pointIndex < 0) {
      this.held = null;
      return { x: 0, y: 0 };
    }
    // The hold is the pair. A candidate held by one point earns no bonus on another.
    this.held = { pointIndex: best.pointIndex, candidate: best.held[0] };
    const winner = points[best.pointIndex];
    const rounded = roundSnapped(
      { position: best.position, held: best.held, freedom: best.freedom },
      (value) => Math.round(value)
    );
    return { x: rounded.x - winner.x, y: rounded.y - winner.y };
  }

  end() {
    this.held = null;
    this.sceneController.sceneModel.snapHeldCandidates = [];
  }
}
