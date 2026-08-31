import {
  getSkeletonData,
  getSkeletonPointAddress,
  getSkeletonRibEndpoints,
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
import { parseSelection } from "@fontra/core/utils.js";
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
// The skeleton points the drag moves: the ones selected outright, plus the ones
// the moved path points were generated from. Always a provenance lookup, never a
// geometric match (R-D).
function movedSkeletonPointKeys(sceneController, movedPointIndices) {
  const moved = new Set(parseSelection(sceneController.selection).skeletonPoint || []);
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  const path = positionedGlyph?.glyph?.path;
  const skeletonData = getSkeletonData(positionedGlyph?.glyph);
  if (!path || !skeletonData) {
    return moved;
  }
  for (const pointIndex of movedPointIndices) {
    const provenance = resolveGeneratedPointProvenance(skeletonData, path, pointIndex);
    if (provenance) {
      moved.add(`${provenance.contourId}/${provenance.pointId}`);
    }
  }
  return moved;
}

// `excluded` is the geometry the drag moves and so cannot snap to: the moved
// points themselves. `ownGenerated` is the outline those moved skeleton points
// generate. It moves too, which is why it is weightless by default rather than
// simply absent - the designer can give it a weight and snap a point to the
// outline it is making.
function partitionMovedPointIndices(sceneController, movedPointIndices) {
  const excluded = new Set(movedPointIndices);
  const ownGenerated = new Set();
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  const path = positionedGlyph?.glyph?.path;
  const skeletonData = getSkeletonData(positionedGlyph?.glyph);
  if (!path || !skeletonData) {
    return { excluded, ownGenerated };
  }

  const movedSkeletonPoints = movedSkeletonPointKeys(sceneController, excluded);
  if (!movedSkeletonPoints.size) {
    return { excluded, ownGenerated };
  }

  for (let pointIndex = 0; pointIndex < path.numPoints; pointIndex++) {
    if (excluded.has(pointIndex)) {
      continue;
    }
    const provenance = resolveGeneratedPointProvenance(skeletonData, path, pointIndex);
    if (
      provenance &&
      movedSkeletonPoints.has(`${provenance.contourId}/${provenance.pointId}`)
    ) {
      ownGenerated.add(pointIndex);
    }
  }
  return { excluded, ownGenerated };
}

function isOrthogonalAngle({ x, y }) {
  return Math.abs(x) < 1e-9 || Math.abs(y) < 1e-9;
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
    // Its kind is the direction it runs, like every other line. It is never
    // weighed against anything - a constraint is held, not chosen - so the kind
    // matters only where the resolver crosses it with a candidate.
    kind: isOrthogonalAngle(constrained) ? KIND.ORTHOGONAL : KIND.DIAGONAL,
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
  const { excluded, ownGenerated } = partitionMovedPointIndices(
    sceneController,
    excludePointIndices
  );

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
    // An off-curve is offered under its own kind, and the switch in the resolver
    // decides whether it is collected at all. Marking it here rather than
    // dropping it is what lets the switch answer on the next frame, without the
    // frozen scene having to be rebuilt.
    points.push({
      x: point.x,
      y: point.y,
      offCurve: !!point.type,
      kind: ownGenerated.has(i) ? KIND.OWN_GENERATED : undefined,
    });
  }
  for (const segment of iterPathSegments(path)) {
    if (segment.pointIndices.some((i) => excluded.has(i) || ownGenerated.has(i))) {
      // A segment of the moved outline is not offered at all. Only its points
      // are, and only weightlessly.
      continue;
    }
    segments.push(segment.candidate);
  }

  // The skeleton is not in the glyph path, so the loops above never reach it: it
  // entered snapping as a mover and was never a target. Its on-curve points and
  // both ends of every rib are targets now. Not its segments - a centerline is
  // construction, and aligning to one says less than aligning to what it makes.
  // Rib ends come from the model, never recomputed here.
  const skeletonData = getSkeletonData(glyph);
  const movedSkeletonPoints = movedSkeletonPointKeys(sceneController, excluded);
  for (const contour of skeletonData?.contours || []) {
    // The contour the drag came from is the one whose own points the designer is
    // aligning to - the neighbour a stem should stay level with is on it. Any
    // nearer point elsewhere in the glyph would win the per-side cull and hide
    // them, so this contour's sources are exempt from that contest.
    const isDraggedContour = (contour.points || []).some((point) =>
      movedSkeletonPoints.has(`${contour.id}/${point.id}`)
    );
    for (const point of contour.points || []) {
      if (movedSkeletonPoints.has(`${contour.id}/${point.id}`)) {
        continue;
      }
      const source = {
        x: point.x,
        y: point.y,
        offCurve: !!point.type,
        alwaysKeep: isDraggedContour,
      };
      points.push(source);
      if (point.type) {
        continue; // a handle has no rib
      }
      const ribEnds = getSkeletonRibEndpoints(contour, point);
      for (const end of [ribEnds.left, ribEnds.right]) {
        // A collapsed side returns the centerline point itself, which is
        // already in the list.
        if (end && end !== point) {
          points.push({ x: end.x, y: end.y, alwaysKeep: isDraggedContour });
        }
      }
    }
  }

  return { metrics, guides, points, segments };
}

export class SnappingSession {
  constructor(sceneController, { excludePointIndices = [] } = {}) {
    this.sceneController = sceneController;
    this.excludePointIndices = excludePointIndices;
    this.scene = buildSnapScene(sceneController, excludePointIndices);
    this.held = null;
    // Carried between frames so the resolver can tell a guide passed through from
    // one the designer is moving toward. See the overrule rule in snapping.js.
    this.overrule = null;
    this.escape = null;
    // Set per frame by the tool. A gesture that states its own geometry - a
    // fixed-rib drag, a tangent-only rib move, an equalize, a tension-aware
    // edit - has nothing to gain from a magnet moving the point somewhere else.
    this.suppressed = false;
    this._lastCursor = null;
    this._lastTime = 0;
  }

  // "only" while the diagonal key is held. Otherwise the switch answers, inside
  // the resolver, so a switch moved mid-drag takes on the next frame.
  get _diagonals() {
    return this.sceneController.sceneModel.snapDiagonalOnly ? "only" : undefined;
  }

  // Pointer speed in screen pixels per second. The resolver takes it in pixels so
  // that the thresholds mean the same thing at every zoom level, exactly as reach
  // does. A first frame reports nothing, so it counts as settled.
  _speed(cursor) {
    const now = Date.now();
    const previous = this._lastCursor;
    const elapsed = now - this._lastTime;
    this._lastCursor = { x: cursor.x, y: cursor.y };
    this._lastTime = now;
    if (!previous || elapsed <= 0) {
      return 0;
    }
    const pixelUnit = this.sceneController.onePixelUnit || 1;
    const moved = Math.hypot(cursor.x - previous.x, cursor.y - previous.y) / pixelUnit;
    return (moved * 1000) / elapsed;
  }

  // A drag freezes its scene, because the moved geometry must not chase itself.
  // The pen adds geometry as it goes, so it re-reads before every hover.
  refresh() {
    this.scene = buildSnapScene(this.sceneController, this.excludePointIndices);
  }

  get enabled() {
    return (
      !this.suppressed && (this.sceneController.sceneSettings.snappingEnabled ?? true)
    );
  }

  // A suppressed frame must also take the last frame's ring and guide lines off
  // the canvas. Leaving them up says the snap is still in force while the drag
  // has stopped listening to it.
  _clearPublished() {
    const sceneModel = this.sceneController.sceneModel;
    sceneModel.snapHeldCandidates = [];
    sceneModel.snapSuggestion = null;
    sceneModel.snapIndicator = null;
    sceneModel.snapDebugReadout = null;
    this.held = null;
    this.overrule = null;
    this.escape = null;
  }

  // What the indicator draws and what the tuning panel reads. Published on every
  // resolve, so a frame that snapped nothing still clears the last frame's ring.
  _publish(candidates, cursor, result, position) {
    const sceneModel = this.sceneController.sceneModel;
    sceneModel.snapHeldCandidates = result.held;
    sceneModel.snapSuggestion = result.suggestion || null;
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
      this._clearPublished();
      return point;
    }
    const pixelUnit = this.sceneController.onePixelUnit;
    const candidates = collectCandidates(this.scene, point, {
      pixelUnit,
      diagonals: this._diagonals,
    });
    const result = resolveSnap(candidates, point, {
      pixelUnit,
      held: this.held?.candidate || null,
      overrule: this.overrule,
      escape: this.escape,
      speed: this._speed(point),
      constraint,
    });
    this.overrule = result.overrule || null;
    this.escape = result.escape || null;
    this.held = result.held.length
      ? { pointIndex: 0, candidate: result.held[0] }
      : null;
    const rounded = roundSnapped(result, (value) => Math.round(value));
    this._publish(candidates, point, result, rounded);
    return rounded;
  }

  resolveSet(points, cursor, { constraint } = {}) {
    if (!this.enabled || !points.length) {
      this._clearPublished();
      return { x: 0, y: 0 };
    }
    const pixelUnit = this.sceneController.onePixelUnit;
    // The candidate set is built against the cursor once per frame, and every point is
    // then resolved against that one set.
    const candidates = collectCandidates(this.scene, cursor, {
      pixelUnit,
      diagonals: this._diagonals,
    });
    const best = resolveSnapForPoints(candidates, points, cursor, {
      pixelUnit,
      held: this.held,
      overrule: this.overrule,
      escape: this.escape,
      speed: this._speed(cursor),
      constraint,
    });
    this.overrule = best.overrule || null;
    this.escape = best.escape || null;
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
    this.overrule = null;
    this.escape = null;
    this._lastCursor = null;
    this.sceneController.sceneModel.snapSuggestion = null;
    this.sceneController.sceneModel.snapHeldCandidates = [];
    this.sceneController.sceneModel.snapIndicator = null;
  }
}
