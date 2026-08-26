import { parseSelection } from "@fontra/core/utils.js";
import {
  getSkeletonData,
  getSkeletonPointAddress,
  resolveGeneratedPointProvenance,
} from "@fontra/core/skeleton-model.js";
import {
  KIND,
  SNAP_PARAMETERS,
  candidatePull,
  collectCandidates,
  makeLineCandidate,
  resolveSnap,
  resolveSnapForPoints,
  roundSnapped,
} from "@fontra/core/snapping.js";
import { constrainHorVerDiag } from "./edit-behavior.js";

function segmentAngle(from, to) {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

// Every segment of the path, as the plain records `collectCandidates` consumes.
// A straight segment states its own direction. A curve states the tangent at
// each of its two ends, anchored on the on-curve point.
function* iterPathSegments(path) {
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    for (const segment of path.iterContourSegmentPointIndices(contourIndex)) {
      const pointIndices = segment.pointIndices;
      if (segment.type === "quadBlob" || pointIndices.length < 2) {
        continue;
      }
      const points = pointIndices.map((i) => path.getPoint(i));
      if (points.some((point) => !point)) {
        continue;
      }
      if (segment.type === "line") {
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

// Shift constrains the drag to a horizontal, a vertical or a diagonal. That axis
// enters the resolver as a line through the anchor, so the gesture starts at one
// degree of freedom and the snap only chooses where along it the point sits.
export function constraintLineForDelta(delta, anchor) {
  if (!anchor) {
    return null;
  }
  const constrained = constrainHorVerDiag(delta);
  if (!constrained.x && !constrained.y) {
    return null;
  }
  return makeLineCandidate({
    x: anchor.x,
    y: anchor.y,
    angle: (Math.atan2(constrained.y, constrained.x) * 180) / Math.PI,
    kind: KIND.METRIC,
    source: { x: anchor.x, y: anchor.y },
  });
}

// The path points the current selection moves. This is what the session excludes.
export function selectedPointIndices(sceneController) {
  return parseSelection(sceneController.selection).point || [];
}

// The points the drag asks the resolver about, at their positions before the drag.
// On-curves only: a handle states a direction, so aligning it to a metric means
// nothing, and a handle generates no rays of its own either. Where the selection
// holds no on-curve, which is a handle drag, that one handle is asked instead.
export function draggedSnapPositions(sceneController, layerGlyph) {
  const path = layerGlyph?.path;
  const positions = [];
  if (path) {
    const selected = selectedPointIndices(sceneController);
    const onCurves = selected.filter((i) => !path.getPoint(i)?.type);
    for (const i of onCurves.length ? onCurves : selected) {
      const point = path.getPoint(i);
      if (point) {
        positions.push({ x: point.x, y: point.y });
      }
    }
  }

  const skeletonData = getSkeletonData(layerGlyph);
  for (const key of parseSelection(sceneController.selection).skeletonPoint || []) {
    const [contourId, pointId] = key.split("/").map(Number);
    const address = getSkeletonPointAddress(skeletonData, contourId, pointId);
    if (address?.point) {
      positions.push({ x: address.point.x, y: address.point.y });
    }
  }
  return positions;
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
    this.excludePointIndices = excludePointIndices;
    this.scene = buildSnapScene(sceneController, excludePointIndices);
    this.held = null;
  }

  // A drag freezes its scene, because the moved geometry must not chase itself.
  // The pen adds geometry as it goes, so it re-reads before every hover.
  refresh() {
    this.scene = buildSnapScene(this.sceneController, this.excludePointIndices);
  }

  get enabled() {
    return this.sceneController.sceneSettings.snappingEnabled ?? true;
  }

  // What the indicator draws and what the tuning panel reads. Published on every
  // resolve, so a frame that snapped nothing still clears the last frame's ring.
  _publish(candidates, cursor, result, position) {
    const sceneModel = this.sceneController.sceneModel;
    sceneModel.snapHeldCandidates = result.held;
    sceneModel.snapIndicator = result.held.length
      ? { x: position.x, y: position.y, snapped: true, strength: 1 }
      : result.near
        ? {
            x: result.near.position.x,
            y: result.near.position.y,
            snapped: false,
            strength: Math.min(1, result.near.pull / SNAP_PARAMETERS.noSnapPull),
          }
        : null;

    const byKind = {};
    for (const candidate of candidates) {
      const pull = candidatePull(candidate, cursor, {
        pixelUnit: this.sceneController.onePixelUnit,
        held: null,
      });
      if (pull > (byKind[candidate.kind] || 0)) {
        byKind[candidate.kind] = pull;
      }
    }
    sceneModel.snapDebugReadout = {
      candidateCount: candidates.length,
      winningPull: result.pull,
      winningKind: result.held[0]?.kind || null,
      freedom: result.freedom,
      byKind,
    };
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
    const rounded = roundSnapped(result, (value) => Math.round(value));
    this._publish(candidates, point, result, rounded);
    return rounded;
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
    if (best.pointIndex < 0) {
      this.held = null;
      this._publish(candidates, cursor, best, cursor);
      return { x: 0, y: 0 };
    }
    // The hold is the pair. A candidate held by one point earns no bonus on another.
    this.held = { pointIndex: best.pointIndex, candidate: best.held[0] };
    const winner = points[best.pointIndex];
    const rounded = roundSnapped(
      { position: best.position, held: best.held, freedom: best.freedom },
      (value) => Math.round(value)
    );
    this._publish(candidates, cursor, best, rounded);
    return { x: rounded.x - winner.x, y: rounded.y - winner.y };
  }

  end() {
    this.held = null;
    this.sceneController.sceneModel.snapHeldCandidates = [];
    this.sceneController.sceneModel.snapIndicator = null;
  }
}
