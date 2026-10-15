import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import { applyChange } from "@fontra/core/changes.js";
import {
  applyTensionAwareEdit,
  curvesAreAboveFloor,
  solvePlainAxisScale,
  solveRigidLinkScale,
  scaleSegmentHandles,
} from "@fontra/core/tension-aware-edit.js";
import { parseSelection } from "@fontra/core/utils.ts";
import { EditBehaviorFactory } from "./edit-behavior.js";

export const TENSION_AWARE_BEHAVIOR_NAME = "tension-aware";
export const SKELETON_TENSION_AWARE_BEHAVIOR_NAME = "skeleton-tension-aware";
export const POWER_TENSION_AWARE_BEHAVIOR_NAME = "power-tension-aware";
export const SKELETON_POWER_TENSION_AWARE_BEHAVIOR_NAME =
  "skeleton-power-tension-aware";

// Alt on X or C: the same drag, and a tension point also slides along its
// straight, the way the X scale keeps a curve's proportions. It is a separate
// name because only a name change rebuilds the target entries, so Alt pressed
// with the button down takes effect on the next frame.
const PROPORTIONAL_SUFFIX = "-proportional";

const PATH_TENSION_AWARE_NAMES = [
  TENSION_AWARE_BEHAVIOR_NAME,
  POWER_TENSION_AWARE_BEHAVIOR_NAME,
];
const SKELETON_TENSION_AWARE_NAMES = [
  SKELETON_TENSION_AWARE_BEHAVIOR_NAME,
  SKELETON_POWER_TENSION_AWARE_BEHAVIOR_NAME,
];

// Every name the drag can carry, for the behavior registry.
export const TENSION_AWARE_DRAG_BEHAVIOR_NAMES = {
  path: PATH_TENSION_AWARE_NAMES.flatMap((name) => [name, name + PROPORTIONAL_SUFFIX]),
  skeleton: SKELETON_TENSION_AWARE_NAMES.flatMap((name) => [
    name,
    name + PROPORTIONAL_SUFFIX,
  ]),
};

export function isPathTensionAwareBehaviorName(name) {
  return TENSION_AWARE_DRAG_BEHAVIOR_NAMES.path.includes(name);
}

export function isSkeletonTensionAwareBehaviorName(name) {
  return TENSION_AWARE_DRAG_BEHAVIOR_NAMES.skeleton.includes(name);
}

// What a drag name asks for: the power run, and the slide.
function readTensionAwareBehaviorName(name) {
  const proportional = !!name?.endsWith(PROPORTIONAL_SUFFIX);
  const base = proportional ? name.slice(0, -PROPORTIONAL_SUFFIX.length) : name;
  return {
    power:
      base === POWER_TENSION_AWARE_BEHAVIOR_NAME ||
      base === SKELETON_POWER_TENSION_AWARE_BEHAVIOR_NAME,
    proportional,
  };
}

/**
 * X drives the correction on whatever geometry the selection holds: ordinary
 * path points take it directly, skeleton points take it on their centerline.
 * A rib selection is the width edit and keeps its own drag.
 *
 * C is the power variant of the same drag: the extremes between the dragged
 * point and the first fixed landmark on either side are carried along the
 * locked axis. It states the correction too, so it needs no X under it.
 *
 * Alt with either one adds the slide (see PROPORTIONAL_SUFFIX).
 * @param {Object} modifiers - Realtime modifier state from the pointer tool
 * @param {Set} targetKinds - Selection kinds present, from getSelectionTargetKinds
 * @param {Object} event - The pointer or key event, for Alt
 * @returns {string|null} The behavior name, or null
 */
export function getTensionAwareBehaviorName(modifiers, targetKinds, event = null) {
  const power = !!modifiers?.powerTensionAwareMode;
  if (!modifiers?.tensionAwareMode && !power) return null;
  // A rib drag is the width edit: it states a distance across the stroke, and
  // there is no tension along it for the correction to hold. X stays out.
  if (targetKinds?.has("skeletonRib")) return null;
  const suffix = event?.altKey ? PROPORTIONAL_SUFFIX : "";
  // The centerline is a path, so it takes the same correction - but only
  // through the skeleton write path, which the ordinary entry cannot reach.
  if (targetKinds?.has("skeletonPoint")) {
    return (
      (power
        ? SKELETON_POWER_TENSION_AWARE_BEHAVIOR_NAME
        : SKELETON_TENSION_AWARE_BEHAVIOR_NAME) + suffix
    );
  }
  return (
    (power ? POWER_TENSION_AWARE_BEHAVIOR_NAME : TENSION_AWARE_BEHAVIOR_NAME) + suffix
  );
}

/**
 * The correction one drag frame applies to one contour, shared by the outline
 * entry and the centerline entry. `after` is what the ordinary rules did with
 * the locked delta, and is corrected in place.
 *
 * Without Alt nothing slides: the designer's own placement stands, and the
 * tension is what the correction holds (see `applyTensionAwareEdit`). With Alt
 * a tension point slides along its straight, as under the X scale, on the
 * drag's own axis and with the scale's setting for straights across that axis.
 */
export function correctTensionAwareDragContour(
  before,
  after,
  closed,
  movedIndices,
  delta,
  behaviorName
) {
  const { power, proportional } = readTensionAwareBehaviorName(behaviorName);
  const settings = applicationSettingsController.model;
  const slideOptions = proportional
    ? {
        slide: true,
        axis: axisForDelta(delta),
        slideBothTensionPoints: !!settings.slideBothTensionPoints,
      }
    : { slide: false };
  if (!power) {
    applyTensionAwareEdit(before, after, closed, slideOptions);
    return;
  }
  applyTensionAwareEdit(before, after, closed, { slide: false });
  applyPowerAxisScale(before, after, closed, movedIndices, delta, {
    carrySlantedSmooths: !!settings.powerDragCarriesSlantedSmooths,
  });
  // The run has moved, so the handles around it are read again, and this is
  // the pass that slides: it is the one that sees the stretched shape.
  applyTensionAwareEdit(before, after, closed, slideOptions);
}

const POWER_EPSILON = 1e-9;

function axisForDelta(delta) {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? "x" : "y";
}

// The on-curve points of one contour, in contour order, as indices into its
// unpacked point list. The run is walked along the contour, not along the axis:
// a closed shape sorts its two sides into each other, so an axis order pairs a
// point with a partner across the counter.
function onCurvePointIndices(points) {
  const indices = [];
  points.forEach((point, index) => {
    if (!point.type) indices.push(index);
  });
  return indices;
}

// How far off square a handle may sit and still call its point an extreme,
// as a fraction of the handle's own length - about two degrees. A drawn glyph
// is not the ideal on paper: an extreme placed by hand, or one carried over
// from an interpolation, misses the axis by a fraction of a unit, and an exact
// test calls it a corner and stops the run there.
const POWER_SQUARE_TOLERANCE = 0.035;

// A neighbour index inside the contour, wrapped where the contour closes.
function wrapContourIndex(index, length, closed) {
  if (index >= 0 && index < length) return index;
  return closed ? ((index % length) + length) % length : null;
}

// A point the power scale may carry: an on-curve whose handles leave it square
// across the axis, which is what makes it an extreme the run can stretch
// through. The smooth flag is not asked for - the geometry is the statement,
// and many drawn extremes carry no flag. Both neighbours are read with a wrap,
// so the point that sits at the contour's seam is judged like any other.
//
// `carrySlantedSmooths` also admits a smooth point at any angle: two handles
// on one line through the point, within the same tolerance. A point with one
// handle is not admitted that way, because its other side is a straight and
// carrying it would move the straight.
function isEligiblePowerPoint(points, index, axis, closed, carrySlantedSmooths) {
  const point = points[index];
  if (!point || point.type) return false;
  const crossAxis = axis === "x" ? "y" : "x";
  const controls = [index - 1, index + 1]
    .map((neighbourIndex) => {
      const wrapped = wrapContourIndex(neighbourIndex, points.length, closed);
      return wrapped === null ? null : points[wrapped];
    })
    .filter((neighbour) => neighbour?.type);
  if (!controls.length) return false;
  const lengths = controls.map((control) =>
    Math.hypot(control.x - point.x, control.y - point.y)
  );
  if (lengths.some((length) => length <= POWER_EPSILON)) return false;
  const square = controls.every(
    (control, i) =>
      Math.abs(control[crossAxis] - point[crossAxis]) <=
      lengths[i] * POWER_SQUARE_TOLERANCE
  );
  if (square || !carrySlantedSmooths || controls.length !== 2) return square;
  // Two unit directions on one line add up to nothing.
  const [a, b] = controls.map((control, i) => ({
    x: (control.x - point.x) / lengths[i],
    y: (control.y - point.y) / lengths[i],
  }));
  return Math.hypot(a.x + b.x, a.y + b.y) <= 2 * POWER_SQUARE_TOLERANCE;
}

// Walk the contour away from one edge of the moved body, one on-curve point at
// a time, and collect the run the scale carries. The walk ends at the first
// point that is not an eligible extreme - that point is the anchor, and it
// stays where it is - or where the contour turns back along the axis, which
// makes the far extreme already collected the anchor instead. A walk that
// reaches the moved body again has no fixed end to scale against.
function collectPowerRun(
  points,
  order,
  edgeOrdinal,
  step,
  axis,
  closed,
  movedOrdinals,
  carrySlantedSmooths
) {
  const pivot = points[order[edgeOrdinal]][axis];
  const run = [];
  let reach = 0;
  for (let n = 1; n <= order.length; n++) {
    let ordinal = edgeOrdinal + n * step;
    if (closed) {
      ordinal = ((ordinal % order.length) + order.length) % order.length;
      if (ordinal === edgeOrdinal) break;
    } else if (ordinal < 0 || ordinal >= order.length) {
      break;
    }
    if (movedOrdinals.has(ordinal)) return null;
    const index = order[ordinal];
    const distance = Math.abs(points[index][axis] - pivot);
    if (distance <= reach + POWER_EPSILON) {
      const anchor = run.pop();
      return anchor === undefined ? null : { run, anchor };
    }
    if (!isEligiblePowerPoint(points, index, axis, closed, carrySlantedSmooths)) {
      return { run, anchor: index };
    }
    run.push(index);
    reach = distance;
  }
  return null;
}

/**
 * The power propagation under C. The selected points have already travelled
 * with the ordinary rules; this pass carries the run of extremes between the
 * moved body and the first fixed landmark beyond it, so the stretch is
 * proportional instead of the selection sliding through a shape that stands
 * still.
 *
 * The run grows from every edge of the moved body, not from the one point under
 * the cursor: a selection holds a whole leg as often as a single point, and
 * each of its two ends has a side of the letter to carry.
 *
 * Only the locked axis is written. The anchor does not move, and the handles
 * are left to the tension correction that runs after this pass.
 *
 * @param {Array} before - The contour's points before the drag
 * @param {Array} after - The same points as the ordinary rules left them, written in place
 * @param {boolean} closed - Whether the contour is closed
 * @param {Set} movedIndices - Indices, into this contour, of the points the drag moved
 * @param {Object} delta - The locked drag delta
 * @param {Object} options
 * @param {boolean} options.carrySlantedSmooths - Also carry smooth points that
 *   are not square across the axis. The Edit menu's setting.
 */
export function applyPowerAxisScale(
  before,
  after,
  closed,
  movedIndices,
  delta,
  { carrySlantedSmooths = false } = {}
) {
  if (!movedIndices?.size) return;
  const axis = axisForDelta(delta);
  const amount = delta[axis];
  if (!amount) return;
  const order = onCurvePointIndices(before);
  const movedOrdinals = new Set();
  order.forEach((index, ordinal) => {
    if (movedIndices.has(index)) movedOrdinals.add(ordinal);
  });
  if (!movedOrdinals.size || movedOrdinals.size === order.length) return;
  for (const edgeOrdinal of movedOrdinals) {
    const pivot = before[order[edgeOrdinal]][axis];
    for (const step of [-1, 1]) {
      const collected = collectPowerRun(
        before,
        order,
        edgeOrdinal,
        step,
        axis,
        closed,
        movedOrdinals,
        carrySlantedSmooths
      );
      if (!collected?.run.length) continue;
      const span = before[collected.anchor][axis] - pivot;
      if (Math.abs(span) < POWER_EPSILON) continue;
      // The anchor holds and the moved edge follows the drag, so the run is
      // remapped from the span it had onto the span it has.
      const factor = (span - amount) / span;
      for (const index of collected.run) {
        const scaled = Math.round(
          pivot + amount + (before[index][axis] - pivot) * factor
        );
        const shift = scaled - before[index][axis];
        after[index] = { ...after[index], [axis]: scaled };
        // The handles travel with their point. Left behind, a handle that
        // reached forward ends up reaching back once its point has passed it,
        // and the segment turns through half a circle. The correction that
        // runs after this reads the handles it is given, so it cannot put back
        // a phase that was lost here.
        for (const neighbourIndex of [index - 1, index + 1]) {
          const handleIndex = wrapContourIndex(neighbourIndex, before.length, closed);
          if (handleIndex === null || !before[handleIndex]?.type) continue;
          after[handleIndex] = {
            ...after[handleIndex],
            [axis]: before[handleIndex][axis] + shift,
          };
        }
      }
    }
  }
}

/**
 * One target entry for the whole path. It reproduces the ordinary edit on a
 * scratch copy of the pre-drag path, corrects it, and records the result. Every
 * frame is measured from that copy, never from the frame before it, so a slow
 * drag and a fast one ending in the same place give the same shape and the
 * rollback describes the whole gesture.
 */
export function createTensionAwareTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  { isGeneratedContour = null, scalingEditBehavior = false } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  // The same flag the caller built its own factory with. The entry measures
  // every write against what that factory put on the glyph, so a factory built
  // on the other setting hands it a baseline the glyph never held.
  const baseFactory = new EditBehaviorFactory(
    { ...layerGlyph, path: originalPath },
    selection,
    scalingEditBehavior
  );
  // The correction runs on top of what the ordinary rules produce, so the
  // rules have to run somewhere.
  const baseBehavior = baseFactory.getBehavior("default");

  // The moved body, resolved once: the selected points of each contour, as
  // indices into that contour. The run grows from its edges.
  const movedByContour = new Map();
  for (const pointIndex of pointSelection) {
    const [contourIndex, contourPointIndex] =
      originalPath.getContourAndPointIndex(pointIndex);
    if (!movedByContour.has(contourIndex)) {
      movedByContour.set(contourIndex, new Set());
    }
    movedByContour.get(contourIndex).add(contourPointIndex);
  }

  let rollbackChange = null;
  // The axis the drag latches onto, held for the whole gesture.
  const lockDeltaToAxis = makeAxisLock();
  // Every point this entry has ever written during the gesture. See the write
  // loop below for why it has to remember them.
  const touched = new Set();
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(rawDelta) {
        // X states an axis. The larger of the two components wins and the other
        // is dropped, whatever the selection holds. The correction reads a
        // shape one axis at a time — the chain walk sorts bodies along the axis
        // being scaled, and a tension point travels on its own straight — so a
        // diagonal asks it two questions at once and neither answer is the one
        // the designer is watching.
        //
        // The axis is the drag's, not the frame's. Once the pointer has left
        // the dead zone the choice is latched, so reaching further across than
        // the drag ever went along cannot turn a narrowing into a lowering
        // halfway through. Inside the dead zone nothing is settled yet, and the
        // larger component still leads.
        const delta = lockDeltaToAxis(rawDelta);
        // What the match tree wrote to the glyph, which is the raw delta and
        // knows nothing of the lock. Every comparison below is against this,
        // because this is the state the entry's own change lands on top of.
        const written = { ...layerGlyph, path: originalPath.copy() };
        applyChange(written, baseBehavior.makeChangeForDelta(rawDelta));
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          // What the ordinary rules do with the locked delta, on its own copy.
          const moved = { ...layerGlyph, path: originalPath.copy() };
          applyChange(moved, baseBehavior.makeChangeForDelta(delta));
          for (
            let contourIndex = 0;
            contourIndex < moved.path.numContours;
            contourIndex++
          ) {
            if (isGeneratedContour?.(contourIndex)) continue;
            const before = originalPath.getUnpackedContour(contourIndex);
            const after = moved.path.getUnpackedContour(contourIndex);
            const uncorrected = written.path.getUnpackedContour(contourIndex).points;
            // The power pass belongs to the contours the selection moved.
            correctTensionAwareDragContour(
              before.points,
              after.points,
              after.isClosed,
              movedByContour.get(contourIndex),
              delta,
              behaviorName
            );
            const startIndex = moved.path.getAbsolutePointIndex(contourIndex, 0);
            for (let i = 0; i < after.points.length; i++) {
              const point = after.points[i];
              const absoluteIndex = startIndex + i;
              // Write wherever this differs from what the match tree put
              // there. That covers a correction that puts a point back where it
              // started, and the axis lock, which the match tree never saw.
              //
              // A point this entry has written once is written on every frame
              // after it, even where it now agrees with the match tree. Each
              // frame is measured from the pre-drag path, so a frame states the
              // whole answer or it states a lie: a point dropped from the set
              // keeps whatever an abandoned frame left on it, and the last
              // frame's rollback never names it, so the undo restores part of
              // the drag and leaves the rest.
              if (
                !touched.has(absoluteIndex) &&
                point.x === uncorrected[i].x &&
                point.y === uncorrected[i].y
              ) {
                continue;
              }
              touched.add(absoluteIndex);
              layerGlyphProxy.path.setPointPosition(absoluteIndex, point.x, point.y);
            }
          }
        });
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
      makeChangeForTransformation() {
        return null;
      },
    },
  ];
}

// A single-point drag states its own axis, and the dead zone is how far the
// pointer must travel before it counts as having stated it. Two units, so the
// first frame of a drag cannot settle the gesture on a jitter.
const AXIS_LOCK_DEADZONE = 2;

export function makeAxisLock() {
  let axis = null;
  return (rawDelta) => {
    const leading = Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? "x" : "y";
    if (
      !axis &&
      Math.max(Math.abs(rawDelta.x), Math.abs(rawDelta.y)) >= AXIS_LOCK_DEADZONE
    ) {
      axis = leading;
    }
    return (axis || leading) === "x"
      ? { x: rawDelta.x, y: 0 }
      : { x: 0, y: rawDelta.y };
  };
}

export const TENSION_AWARE_SCALE_BEHAVIOR_NAME = "tension-aware-scale";

/**
 * The transform-box half. It reads the transformation's factor and origin on
 * the one axis being scaled, solves the rigid links, then runs the same slide
 * and restore the drag uses.
 *
 * It keeps the last solve that passed the curve floor and emits that again
 * where the current one fails, so the shape stands still while the drag runs on.
 * @param {string} axis - "x" or "y"
 */
export function createTensionAwareTransformEntries(
  layerGlyph,
  selection,
  axis,
  { isGeneratedContour = null } = {}
) {
  const { point: pointSelection } = parseSelection(selection || new Set());
  if (!pointSelection?.length || !layerGlyph?.path) return [];

  const originalPath = layerGlyph.path.copy();
  // Only a contour that holds a selected point takes part. A contour outside
  // the selection is not the box's to move, and it must not join the solve
  // either: its bodies would take a share of the change.
  const selectedContours = new Set(
    pointSelection.map(
      (pointIndex) => originalPath.getContourAndPointIndex(pointIndex)[0]
    )
  );
  const contourIndices = [];
  for (const i of selectedContours) {
    if (!isGeneratedContour?.(i)) contourIndices.push(i);
  }
  contourIndices.sort((a, b) => a - b);
  if (!contourIndices.length) return [];
  const solver = makeTensionAwareAxisScaleSolver(originalPath, contourIndices, axis);

  let rollbackChange = null;
  // Same rule as the drag entry: once written, written on every frame after.
  const touched = new Set();
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta() {
        return null;
      },
      makeChangeForTransformation(transformation) {
        const frames = solver.solve(transformation);
        if (!frames) {
          return null;
        }
        const scratch = { ...layerGlyph, path: originalPath.copy() };
        const changes = recordChanges(scratch, (layerGlyphProxy) => {
          frames.forEach(({ points }, i) => {
            const { startIndex, contour } = solver.originals[i];
            for (let p = 0; p < points.length; p++) {
              const absoluteIndex = startIndex + p;
              if (
                !touched.has(absoluteIndex) &&
                points[p].x === contour.points[p].x &&
                points[p].y === contour.points[p].y
              ) {
                continue;
              }
              touched.add(absoluteIndex);
              layerGlyphProxy.path.setPointPosition(
                absoluteIndex,
                points[p].x,
                points[p].y
              );
            }
          });
        });
        rollbackChange = changes.rollbackChange;
        return changes.change;
      },
    },
  ];
}

/**
 * The solve behind the transform box, on whatever path it is handed. The
 * outline entry runs it on the glyph's own path and the skeleton entry runs it
 * on the synthetic centerline path, so the rule has one copy and the two
 * callers differ only in how they write the answer back.
 *
 * It keeps the last solve that passed the curve floor and returns that again
 * where the current one fails, so the shape stands still while the drag runs on.
 *
 * @param {Object} originalPath - the pre-drag path, not written to
 * @param {number[]} contourIndices - the contours taking part, ascending
 * @param {string} axis - "x" or "y"
 */
export function makeTensionAwareAxisScaleSolver(originalPath, contourIndices, axis) {
  const originals = contourIndices.map((contourIndex) => ({
    contourIndex,
    startIndex: originalPath.getAbsolutePointIndex(contourIndex, 0),
    contour: originalPath.getUnpackedContour(contourIndex),
  }));
  let lastGood = null;
  return {
    originals,
    solve(transformation) {
      // The box hands over a full affine, already pinned about its own
      // point. On one axis it is a scale plus a shift, which are the only two
      // numbers this rule reads: `new = factor * old + shift`, so the fixed
      // coordinate is `shift / (1 - factor)`.
      const factor = axis === "x" ? transformation.xx : transformation.yy;
      const shift = axis === "x" ? transformation.dx : transformation.dy;
      if (Math.abs(factor - 1) < 1e-9) {
        return null;
      }
      const origin = shift / (1 - factor);

      // The two axes read the same shape differently. Across x a straight is
      // the drawn width and holds, while the curves take the change. Along y
      // a straight is the length the scale has to change, so every point
      // takes the plain scale and the tension correction holds the curves.
      const solve = axis === "x" ? solveRigidLinkScale : solvePlainAxisScale;
      const solved = solve(
        originals.map(({ contour }) => contour),
        axis,
        factor,
        origin
      );
      const frames = solved ? buildFrames(originals, solved, axis) : null;
      if (
        frames &&
        frames.every(({ points, isClosed }) => curvesAreAboveFloor(points, isClosed))
      ) {
        lastGood = frames;
      }
      return lastGood;
    },
  };
}

// Move every on-curve to its solved coordinate on the scaled axis, then run the
// slide and the restore over the result.
function buildFrames(originals, solved, axis) {
  return originals.map(({ contour }, i) => {
    const before = contour.points;
    const after = before.map((point) => ({ ...point }));
    for (const [index, coordinate] of solved[i]) {
      after[index][axis] = Math.round(coordinate);
    }
    // Every handle takes its own segment's factor along the scaled axis. A
    // segment the scale only moved has a factor of one, so this carries it with
    // its own point the way the point rules do, and a segment the scale pulled
    // wider keeps the proportions of the curve that was drawn.
    scaleSegmentHandles(before, after, contour.isClosed, axis);
    // The axis tells the slide which straights are tracks for this scale. A
    // straight lying across the axis, held only by the curves at its two ends,
    // is not one: sliding on it moves the drawing in the direction the scale
    // never touched.
    // A straight that runs exactly across the scaled axis stands still unless
    // the designer asks for it to travel. The setting is app-wide, next to skew
    // in the transform panel. A slanted straight travels either way: it has
    // extent along the axis, so the scale does touch it.
    // Preserve aspect ratio off, the scale slides nothing and only adjusts the
    // handles. Both settings sit in the Scale row's overflow.
    applyTensionAwareEdit(before, after, contour.isClosed, {
      axis,
      slide: applicationSettingsController.model.preserveAspectRatio !== false,
      slideBothTensionPoints:
        !!applicationSettingsController.model.slideBothTensionPoints,
    });
    return { points: after, isClosed: contour.isClosed };
  });
}
