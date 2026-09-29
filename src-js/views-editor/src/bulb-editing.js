import {
  bulbRoleOfSide,
  findGeneratedPathAddress,
  getSkeletonCapBallEdit,
  getSkeletonData,
  parseEditableGeneratedHandleKey,
  parseEditableGeneratedPointKey,
  setSkeletonCapBallEdit,
} from "@fontra/core/skeleton-model.js";
import { parseSelection } from "@fontra/core/utils.ts";
import {
  makeEditSkeletonChange,
  resolveSkeletonAddressAcrossLayers,
} from "./skeleton-editing.js";

// A bulb's own points take Z and Alt the way every generated point does, and
// write the cap's edit block rather than a rib's nudge. See the feature model,
// the drop cap: the entry, the ball's bottom and side apexes, the neck's start
// and the release are the cap's, and their edits are applied after the bulb is
// built.
//
// On an on-curve, Z slides it along its tangent and carries its two handles;
// Z with Alt slides it alone. A plain drag moves nothing: derived geometry
// answers to a modifier. On a handle, Z (or an arrow key) lengthens it along
// its own line, and Alt gives the handle across the on-curve the same length.

export function isBulbSelectionItem(item) {
  return bulbRoleOfSide(`${item}`.split("/")[2]) !== null;
}

export function createBulbPointTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  options
) {
  const carry = behaviorName === "rib-tangent";
  if (!carry && behaviorName !== "rib-tangent-interpolate") {
    return [];
  }
  const items = (parseSelection([...selection]).editableGeneratedPoint || [])
    .filter(isBulbSelectionItem)
    .map((item) => parseEditableGeneratedPointKey(`editableGeneratedPoint/${item}`));
  return makeBulbEntries(layerGlyph, items, options, (station, stored) => (delta) => {
    const along = dot(delta, station.tangent);
    return {
      slide: Math.round(stored.slide + along),
      carry: carry ? Math.round(stored.carry + along) : stored.carry,
    };
  });
}

export function createBulbHandleTargetEntries(
  layerGlyph,
  selection,
  behaviorName,
  options
) {
  if (behaviorName === "generated-handle-turn") {
    // Every bulb point is smooth, and turning one handle would kink it.
    return [];
  }
  const equalize =
    behaviorName?.startsWith("equalize") === true ||
    behaviorName === "alternate" ||
    behaviorName === "alternate-constrain";
  const items = (parseSelection([...selection]).editableGeneratedHandle || [])
    .filter(isBulbSelectionItem)
    .map((item) => parseEditableGeneratedHandleKey(`editableGeneratedHandle/${item}`));
  return makeBulbEntries(layerGlyph, items, options, (station, stored, item) => {
    const slot = item.role;
    const other = slot === "in" ? "out" : "in";
    const handle = slot === "in" ? station.before : station.after;
    const opposite = slot === "in" ? station.after : station.before;
    const axis =
      unit(station.point, handle) ??
      (slot === "in" ? scale(station.tangent, -1) : station.tangent);
    return (delta) => {
      const along = dot(delta, axis);
      const values = { [slot]: Math.round(stored[slot] + along) };
      if (equalize && opposite) {
        const length = distance(station.point, handle) + along;
        values[other] = Math.round(
          stored[other] + length - distance(station.point, opposite)
        );
      }
      return values;
    };
  });
}

// One target entry per layer. Every frame rewrites the cap's edit block from
// the values it held at mouse-down, so a rollback states the whole gesture.
function makeBulbEntries(layerGlyph, items, options, makeWriter) {
  const skeletonData = getSkeletonData(layerGlyph);
  const reference = options?.referenceSkeletonData || skeletonData;
  if (!skeletonData || !items.length) {
    return [];
  }
  const originalLayerGlyph = {
    ...layerGlyph,
    path: layerGlyph.path.copy(),
    customData: structuredClone(layerGlyph.customData || {}),
  };
  const writers = [];
  for (const item of items) {
    const role = bulbRoleOfSide(item.side);
    const address = resolveSkeletonAddressAcrossLayers(
      reference,
      skeletonData,
      Number(item.contourId),
      Number(item.pointId)
    );
    if (!address) continue;
    const station = readStation(
      skeletonData,
      originalLayerGlyph.path,
      address.contour.id,
      address.point.id,
      item.side
    );
    if (!station?.tangent) continue;
    writers.push({
      contourIndex: address.contourIndex,
      pointIndex: address.pointIndex,
      role,
      write: makeWriter(station, getSkeletonCapBallEdit(address.point, role), item),
    });
  }
  if (!writers.length) {
    return [];
  }
  let rollbackChange = null;
  return [
    {
      get rollbackChange() {
        return rollbackChange;
      },
      makeChangeForDelta(delta) {
        const changes = makeEditSkeletonChange(originalLayerGlyph, (working) => {
          for (const { contourIndex, pointIndex, role, write } of writers) {
            const point = working.contours?.[contourIndex]?.points?.[pointIndex];
            if (point) setSkeletonCapBallEdit(point, role, write(delta));
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

// Where one bulb point and its two handles stand on the outline, and its
// tangent, read the way the generator reads it: from the handle before to the
// handle after.
function readStation(skeletonData, path, contourId, pointId, side) {
  const at = (slot) => {
    const address = findGeneratedPathAddress(
      skeletonData,
      contourId,
      pointId,
      side,
      slot
    );
    if (!address) return null;
    try {
      return path.getPoint(
        path.getAbsolutePointIndex(address.pathContourIndex, address.contourPointIndex)
      );
    } catch {
      return null;
    }
  };
  const point = at("onCurve");
  if (!point) return null;
  const before = at("in");
  const after = at("out");
  const tangent =
    (before && after && unit(before, after)) ||
    (after && unit(point, after)) ||
    (before && unit(before, point));
  return { point, before, after, tangent };
}

function unit(from, to) {
  if (!from || !to) return null;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 1e-9
    ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
    : null;
}

function scale(v, factor) {
  return v ? { x: v.x * factor, y: v.y * factor } : null;
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function distance(a, b) {
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}
