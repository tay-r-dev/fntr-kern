import {
  eventMatchesActionBaseKey,
  eventMatchesActionShortCut,
} from "@fontra/core/actions.js";
import { centeredRect } from "@fontra/core/rectangle.ts";
import {
  getSkeletonPointHalfWidth,
  getSkeletonPointWidth,
  getSkeletonRibAddress,
  getSkeletonRibPosition,
} from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";

const REALTIME_MEASURE_ACTION = "action.realtime.measure";
const REALTIME_MEASURE_DIRECT_ACTION = "action.realtime.measure-direct";

export class MeasureInteraction {
  constructor(tool) {
    this.tool = tool;
    this._boundKeyUp = null;
    this._boundAltKeyDown = null;
    this._boundAltKeyUp = null;
    this._boundWindowBlur = null;
  }

  get sceneController() {
    return this.tool.sceneController;
  }

  get sceneModel() {
    return this.tool.sceneModel;
  }

  get canvasController() {
    return this.tool.canvasController;
  }

  get isActive() {
    return this.sceneModel.measureMode;
  }

  handleKeyDown(event) {
    if (
      eventMatchesActionShortCut(REALTIME_MEASURE_ACTION, event) ||
      eventMatchesActionShortCut(REALTIME_MEASURE_DIRECT_ACTION, event)
    ) {
      if (!this.sceneModel.measureMode) {
        this.sceneModel.setMeasureActive(true, {
          showDirect:
            eventMatchesActionShortCut(REALTIME_MEASURE_DIRECT_ACTION, event) ||
            event.altKey,
        });
        this._boundKeyUp = (e) => this._handleKeyUp(e);
        window.addEventListener("keyup", this._boundKeyUp);
        this._boundAltKeyDown = (e) => this._handleAltKeyDown(e);
        window.addEventListener("keydown", this._boundAltKeyDown);
        this._boundAltKeyUp = (e) => this._handleAltKeyUp(e);
        window.addEventListener("keyup", this._boundAltKeyUp);
        this._boundWindowBlur = () => this._end();
        window.addEventListener("blur", this._boundWindowBlur);
        this.canvasController.requestUpdate();
      }
      return true;
    }
    return false;
  }

  handleHover(event) {
    if (!this.sceneModel.measureMode) return false;
    const point = this.sceneController.localPoint(event);
    const size = this.sceneController.mouseClickMargin;
    this.sceneModel.setMeasureShowDirect(event.altKey);
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();

    const handle = this._findControlPointForMeasure(point, size, positionedGlyph);
    let target = handle ? { kind: "handle", payload: handle } : null;
    if (!target) {
      const rib = this._findSkeletonRibForMeasure(point, size, positionedGlyph);
      if (rib) target = { kind: "skeletonRib", payload: rib };
    }
    if (!target) {
      const segment = this._findSegmentForMeasure(point, size, positionedGlyph);
      if (segment) target = { kind: "segment", payload: segment };
    }
    if (!target) {
      const points = this._getMeasurePointsFromSelection();
      if (points) target = { kind: "points", payload: points };
    }

    const current = this.sceneModel.getMeasureHoverTarget();
    if (!this._targetsEqual(target, current)) {
      this.sceneModel.setMeasureHoverTarget(
        target?.kind ?? null,
        target?.payload ?? null
      );
      this.canvasController.requestUpdate();
    }
    return true;
  }

  _findSkeletonRibForMeasure(
    point,
    size,
    positionedGlyph = this.sceneModel.getSelectedPositionedGlyph()
  ) {
    const hit = this.sceneModel.skeletonRibAtPoint(point, size, positionedGlyph);
    if (!hit) {
      return null;
    }
    const skeletonData = this.sceneModel._getEditLayerSkeletonData(positionedGlyph);
    const address = getSkeletonRibAddress(
      skeletonData,
      hit.contourId,
      hit.pointId,
      hit.side
    );
    if (!address) {
      return null;
    }
    const { contour, point: skeletonPoint, side, defaultWidth } = address;
    const sideWidths = {
      left: getSkeletonPointHalfWidth(skeletonPoint, defaultWidth, "left"),
      right: getSkeletonPointHalfWidth(skeletonPoint, defaultWidth, "right"),
    };
    return {
      p1: { x: skeletonPoint.x, y: skeletonPoint.y },
      p2: getSkeletonRibPosition(contour, skeletonPoint, side),
      width: getSkeletonPointWidth(skeletonPoint, defaultWidth),
      sideWidths,
      side,
      type: "skeletonRib",
    };
  }

  _handleKeyUp(event) {
    if (
      eventMatchesActionBaseKey(REALTIME_MEASURE_ACTION, event) ||
      eventMatchesActionBaseKey(REALTIME_MEASURE_DIRECT_ACTION, event)
    ) {
      this._end();
    }
  }

  _handleAltKeyDown(event) {
    if (!this.sceneModel.measureMode) return;
    if (event.key === "Alt" || event.altKey) {
      this.sceneModel.setMeasureShowDirect(true);
      this.canvasController.requestUpdate();
    }
  }

  _handleAltKeyUp(event) {
    if (!this.sceneModel.measureMode) return;
    if (event.key === "Alt" || !event.altKey) {
      this.sceneModel.setMeasureShowDirect(false);
      this.sceneModel.setMeasureHoverTarget(null, null);
      this.canvasController.requestUpdate();
    }
  }

  _end() {
    if (!this.sceneModel.measureMode) return;
    this.sceneModel.resetMeasureState();
    for (const [eventName, bound] of [
      ["keyup", this._boundKeyUp],
      ["keydown", this._boundAltKeyDown],
      ["keyup", this._boundAltKeyUp],
      ["blur", this._boundWindowBlur],
    ]) {
      if (bound) window.removeEventListener(eventName, bound);
    }
    this._boundKeyUp =
      this._boundAltKeyDown =
      this._boundAltKeyUp =
      this._boundWindowBlur =
        null;
    this.canvasController.requestUpdate();
  }

  _findControlPointForMeasure(
    point,
    size,
    positionedGlyph = this.sceneModel.getSelectedPositionedGlyph()
  ) {
    // Skeleton off-curve handles take precedence over the generated outline's
    // path handles, so hovering a skeleton handle measures its length/tension.
    const skeletonHandle = this.sceneModel.skeletonHandleAtPoint(
      point,
      size,
      positionedGlyph
    );
    if (skeletonHandle) {
      return { ...skeletonHandle, type: "skeleton" };
    }

    if (!positionedGlyph?.glyph?.path) {
      return null;
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };

    const path = positionedGlyph.glyph.path;
    const candidatePointIndices = [];
    const searchRect = centeredRect(glyphPoint.x, glyphPoint.y, size);
    for (const hit of path.iterPointsInRect(searchRect)) {
      const pointType = path.pointTypes[hit.pointIndex];
      const isOnCurve = (pointType & 0x03) === 0;
      if (!isOnCurve) {
        candidatePointIndices.push(hit.pointIndex);
      }
    }

    const pointIndex = path.pointIndexNearPointFromPointIndices(
      glyphPoint,
      size,
      candidatePointIndices
    );
    if (pointIndex === undefined) return null;

    const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
    const contourInfo = path.contourInfo[contourIndex];
    const numContourPoints = path.getNumPointsOfContour(contourIndex);
    const contourStart = pointIndex - contourPointIndex;
    const contourEnd = contourStart + numContourPoints;

    const getPrevIdx = (idx) => {
      if (idx > contourStart) return idx - 1;
      return contourInfo.isClosed ? contourEnd - 1 : null;
    };
    const getNextIdx = (idx) => {
      if (idx < contourEnd - 1) return idx + 1;
      return contourInfo.isClosed ? contourStart : null;
    };

    const prevIdx = getPrevIdx(pointIndex);
    const nextIdx = getNextIdx(pointIndex);
    const prevType = prevIdx == null ? null : path.pointTypes[prevIdx];
    const nextType = nextIdx == null ? null : path.pointTypes[nextIdx];
    const prevIsOnCurve = prevType != null && (prevType & 0x03) === 0;
    const nextIsOnCurve = nextType != null && (nextType & 0x03) === 0;

    let anchorIdx;
    if (prevIsOnCurve) {
      anchorIdx = prevIdx;
    } else if (nextIsOnCurve) {
      anchorIdx = nextIdx;
    }
    if (anchorIdx === undefined) return null;

    const handlePos = path.getPoint(pointIndex);
    const anchorPos = path.getPoint(anchorIdx);
    if (!handlePos || !anchorPos) return null;

    return {
      p1: { x: handlePos.x, y: handlePos.y },
      p2: { x: anchorPos.x, y: anchorPos.y },
      tensionContext: this._buildPathTensionContext(path, contourIndex, pointIndex),
      type: "path",
    };
  }

  _buildPathTensionContext(path, contourIndex, hoveredPointIndex) {
    for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
      if (!segment?.points || segment.points.length !== 4) {
        continue;
      }
      const parentIndices = segment.parentPointIndices || [];
      if (parentIndices.length !== 4) {
        continue;
      }
      const off1IsCubic = (path.pointTypes[parentIndices[1]] & 0x03) === 0x02;
      const off2IsCubic = (path.pointTypes[parentIndices[2]] & 0x03) === 0x02;
      if (!off1IsCubic || !off2IsCubic) {
        continue;
      }
      let hoveredHandleSide = null;
      if (parentIndices[1] === hoveredPointIndex) {
        hoveredHandleSide = "start";
      } else if (parentIndices[2] === hoveredPointIndex) {
        hoveredHandleSide = "end";
      }
      if (!hoveredHandleSide) {
        continue;
      }
      return {
        segmentPoints: segment.points.map((pt) => ({ x: pt.x, y: pt.y })),
        hoveredHandleSide,
      };
    }
    return null;
  }

  _findSegmentForMeasure(
    point,
    size,
    positionedGlyph = this.sceneModel.getSelectedPositionedGlyph()
  ) {
    // The skeleton centerline is checked before the generated outline so that
    // hovering the centerline measures the skeleton segment (blue), while the
    // outline edges still measure as a path (green).
    const skeletonSegment = this.sceneModel.skeletonSegmentAtPoint(
      point,
      size * 1.5,
      positionedGlyph
    );
    if (skeletonSegment) {
      return { ...skeletonSegment, type: "skeleton" };
    }

    if (!positionedGlyph?.glyph?.path) {
      return null;
    }

    const glyphPoint = {
      x: point.x - positionedGlyph.x,
      y: point.y - positionedGlyph.y,
    };

    return this._findPathSegmentNear(
      positionedGlyph.glyph.path,
      glyphPoint,
      size * 1.5
    );
  }

  _findPathSegmentNear(path, point, margin) {
    const contourInfo = path.contourInfo;
    if (!contourInfo?.length) return null;

    for (let contourIdx = 0; contourIdx < contourInfo.length; contourIdx++) {
      const info = contourInfo[contourIdx];
      const startPoint =
        contourIdx === 0 ? 0 : contourInfo[contourIdx - 1].endPoint + 1;
      const endPoint = info.endPoint;
      const onCurveIndices = [];
      for (let i = startPoint; i <= endPoint; i++) {
        if ((path.pointTypes[i] & 0x03) === 0) {
          onCurveIndices.push(i);
        }
      }

      for (let i = 0; i < onCurveIndices.length; i++) {
        const idx1 = onCurveIndices[i];
        const idx2 = onCurveIndices[(i + 1) % onCurveIndices.length];
        if (!info.isClosed && i === onCurveIndices.length - 1) continue;

        const p1 = path.getPoint(idx1);
        const p2 = path.getPoint(idx2);
        const controlPoints = [];
        let j = idx1 + 1;
        const limit = idx2 > idx1 ? idx2 : endPoint + 1 + idx2 - startPoint;
        while (j < limit) {
          const actualIdx = j <= endPoint ? j : startPoint + (j - endPoint - 1);
          const cp = path.getPoint(actualIdx);
          if ((path.pointTypes[actualIdx] & 0x03) !== 0) {
            controlPoints.push(cp);
          }
          j++;
        }

        const dist = this._distanceToCurve(point, p1, p2, controlPoints);
        if (dist <= margin) {
          return {
            p1: { x: p1.x, y: p1.y },
            p2: { x: p2.x, y: p2.y },
            type: "path",
          };
        }
      }
    }

    return null;
  }

  _getMeasurePointsFromSelection() {
    const { point: pointSelection } = parseSelection(this.sceneController.selection);
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    const path = positionedGlyph?.glyph?.path;
    if (!pointSelection?.length || !path) return null;

    const points = [];
    for (const idx of pointSelection) {
      const pt = path.getPoint(idx);
      if (!pt) continue;
      points.push({ x: pt.x, y: pt.y });
    }

    if (points.length !== 2) {
      return null;
    }

    return {
      p1: points[0],
      p2: points[1],
      type: "path",
    };
  }

  _distanceToCurve(point, p1, p2, controlPoints) {
    if (!controlPoints?.length) {
      return this._distanceToSegment(point, p1, p2);
    }

    const samples = 16;
    let minDist = Infinity;

    for (let i = 0; i < samples; i++) {
      const t1 = i / samples;
      const t2 = (i + 1) / samples;
      const pt1 = this._evaluateBezier(t1, p1, p2, controlPoints);
      const pt2 = this._evaluateBezier(t2, p1, p2, controlPoints);
      const dist = this._distanceToSegment(point, pt1, pt2);
      if (dist < minDist) {
        minDist = dist;
      }
    }

    return minDist;
  }

  _evaluateBezier(t, p1, p2, controlPoints) {
    if (controlPoints.length === 2) {
      const cp1 = controlPoints[0];
      const cp2 = controlPoints[1];
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;
      return {
        x: mt3 * p1.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p2.x,
        y: mt3 * p1.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p2.y,
      };
    }
    if (controlPoints.length === 1) {
      const cp = controlPoints[0];
      const mt = 1 - t;
      const mt2 = mt * mt;
      const t2 = t * t;
      return {
        x: mt2 * p1.x + 2 * mt * t * cp.x + t2 * p2.x,
        y: mt2 * p1.y + 2 * mt * t * cp.y + t2 * p2.y,
      };
    }
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    };
  }

  _distanceToSegment(point, p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      return Math.hypot(point.x - p1.x, point.y - p1.y);
    }

    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;

    return Math.hypot(point.x - projX, point.y - projY);
  }

  _targetsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    return this._measurePointsEqual(a.payload, b.payload);
  }

  _measurePointsEqual(mp1, mp2) {
    if (mp1 === mp2) return true;
    if (!mp1 || !mp2) return false;
    const t1 = mp1.tensionContext;
    const t2 = mp2.tensionContext;
    const sameTension =
      (!t1 && !t2) ||
      (t1 &&
        t2 &&
        t1.hoveredHandleSide === t2.hoveredHandleSide &&
        JSON.stringify(t1.segmentPoints) === JSON.stringify(t2.segmentPoints));
    return (
      mp1.type === mp2.type &&
      mp1.p1?.x === mp2.p1?.x &&
      mp1.p1?.y === mp2.p1?.y &&
      mp1.p2?.x === mp2.p2?.x &&
      mp1.p2?.y === mp2.p2?.y &&
      sameTension
    );
  }
}
